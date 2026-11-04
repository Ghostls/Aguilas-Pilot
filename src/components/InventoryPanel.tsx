// src/components/InventoryPanel.tsx
// VALKYRON OS v2.4 — Inventario completo, paginación, impresión y sincronización
// CAMBIO v2.1:
//   - Filtro jerárquico: Sede (Lara / Maturín) → Almacén (OMA / OPERACIONES)
//   - HangarLocation: 'Lara-OMA' | 'Lara-OPERACIONES' | 'Maturín-OMA' | 'Maturín-OPERACIONES'
//   - Selects de ubicación muestran sede + almacén agrupados con <optgroup>

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { SparePart, Vendor, HangarLocation } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  Package, ArrowDownCircle, ArrowUpCircle, ScanLine, Plus,
  X, MapPin, ClipboardList, ShieldCheck, Loader2, Pencil, Trash2,
  Box, AlertCircle, Search, FileText, CheckCircle2, Clock, XCircle,
  RefreshCw, Warehouse, Printer, Download, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface InventoryPanelProps {
  parts: SparePart[];
  setParts: React.Dispatch<React.SetStateAction<SparePart[]>>;
  transactions: any[];
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  vendors: Vendor[];
  userRole?: string;
}

interface Requisicion {
  id: string;
  part_number: string;
  part_name: string;
  cantidad_solicitada: number;
  justificacion: string;
  solicitante: string;
  status: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  notas_admin?: string;
}

// ── Constantes de almacenes ───────────────────────────────────────────────────

const SEDES = ['Lara', 'Maturín'] as const;
type Sede = typeof SEDES[number];

const ALMACENES: Record<Sede, HangarLocation[]> = {
  'Lara':    ['Lara-OMA', 'Lara-OPERACIONES'],
  'Maturín': ['Maturín-OMA', 'Maturín-OPERACIONES'],
};

const ALMACEN_LABEL: Record<HangarLocation, string> = {
  'Lara-OMA':             'Lara · OMA',
  'Lara-OPERACIONES':     'Lara · Operaciones',
  'Maturín-OMA':          'Maturín · OMA',
  'Maturín-OPERACIONES':  'Maturín · Operaciones',
};

type LocationFilter = 'all' | Sede | HangarLocation;

function matchesFilter(partLocation: HangarLocation, filter: LocationFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'Lara') return String(partLocation ?? '').toLowerCase().startsWith('lara');
  if (filter === 'Maturín') return String(partLocation ?? '').toLowerCase().startsWith('matur');
  return partLocation === filter;
}

// Lecturas por lotes: no depender de max_rows (normalmente 1000) de PostgREST.
const FETCH_BATCH = 500;
const PAGE_SIZES = [25, 50, 100] as const;
const escapeHtml = (value: unknown) => String(value ?? '—')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

// ── Helpers CSS ────────────────────────────────────────────────────────────────

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20`;

const EMPTY_FORM = {
  name: '', partNumber: '', quantity: 0, location: 'Lara-OMA' as HangarLocation,
  unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
};

const EMPTY_EDIT = {
  name: '', partNumber: '', quantity: 0, location: 'Lara-OMA' as HangarLocation,
  unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
};

// ── Status badge ───────────────────────────────────────────────────────────────

const ReqBadge = ({ status }: { status: Requisicion['status'] }) => {
  const cfg = {
    PENDIENTE:  { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20', icon: Clock,        label: 'PENDIENTE'  },
    APROBADA:   { color: 'text-green-400 bg-green-400/10 border-green-400/20',    icon: CheckCircle2, label: 'APROBADA'   },
    RECHAZADA:  { color: 'text-red-400 bg-red-400/10 border-red-400/20',          icon: XCircle,      label: 'RECHAZADA'  },
  }[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-black uppercase tracking-widest ${cfg.color}`}>
      <Icon size={10} />{cfg.label}
    </span>
  );
};

// ── Select de ubicación reutilizable ──────────────────────────────────────────

const LocationSelect = ({
  value, onChange, className,
}: {
  value: HangarLocation;
  onChange: (v: HangarLocation) => void;
  className?: string;
}) => (
  <select
    className={className ?? SELECT_CLS}
    value={value}
    onChange={e => onChange(e.target.value as HangarLocation)}
  >
    <optgroup label="— LARA —">
      <option value="Lara-OMA">LARA · OMA</option>
      <option value="Lara-OPERACIONES">LARA · OPERACIONES</option>
    </optgroup>
    <optgroup label="— MATURÍN —">
      <option value="Maturín-OMA">MATURÍN · OMA</option>
      <option value="Maturín-OPERACIONES">MATURÍN · OPERACIONES</option>
    </optgroup>
  </select>
);

// ══════════════════════════════════════════════════════════════════════════════

export const InventoryPanel = ({
  parts, setParts, transactions, setTransactions, vendors, userRole = 'MECANICO',
}: InventoryPanelProps) => {

  const isAdminOrCEO = ['ADMIN', 'CEO'].includes(userRole.toUpperCase());

  // ── Tabs & filtros ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]         = useState<'parts' | 'log' | 'scan' | 'requisiciones'>('parts');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');
  const [searchQuery, setSearchQuery]     = useState('');
  const [loading, setLoading]             = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const fetchVersion = useRef(0);

  // Lee todos los repuestos visibles para el usuario y SOLO reemplaza el estado
  // después de completar todos los lotes; evita mostrar inventarios parciales.
  const refreshAllParts = useCallback(async () => {
    const version = ++fetchVersion.current;
    setSyncing(true);
    setSyncError(null);
    try {
      const all: SparePart[] = [];
      for (let from = 0; ; from += FETCH_BATCH) {
        const { data, error } = await supabase.from('inventario_repuestos')
          .select('id,numero_parte,nombre,cantidad,stock_minimo,ubicacion_hangar,precio_unitario,certificado_numero')
          .order('id', { ascending: true })
          .range(from, from + FETCH_BATCH - 1);
        if (error) throw error;
        if (version !== fetchVersion.current) return;
        const batch = data ?? [];
        all.push(...batch.map((p: any) => ({
          id: p.id,
          partNumber: p.numero_parte ?? '',
          name: p.nombre ?? '',
          quantity: Number(p.cantidad ?? 0),
          minStock: Number(p.stock_minimo ?? 0),
          unitPrice: Number(p.precio_unitario ?? 0),
          location: (p.ubicacion_hangar ?? 'Lara-OMA') as HangarLocation,
          category: 'Repuestos',
          certificateNumber: p.certificado_numero ?? '',
        })));
        if (batch.length < FETCH_BATCH) break;
      }
      if (version !== fetchVersion.current) return;
      setParts(all);
      setLastSynced(new Date());
    } catch (err: unknown) {
      if (version === fetchVersion.current) {
        setSyncError(err instanceof Error ? err.message : 'No se pudo sincronizar el inventario.');
      }
    } finally {
      if (version === fetchVersion.current) setSyncing(false);
    }
  }, [setParts]);

  useEffect(() => {
    void refreshAllParts();
    return () => { fetchVersion.current += 1; };
  }, [refreshAllParts]);


  // ── Modales ────────────────────────────────────────────────────────────────
  const [isAddOpen, setIsAddOpen]         = useState(false);
  const [isEditOpen, setIsEditOpen]       = useState(false);
  const [isDeleteOpen, setIsDeleteOpen]   = useState(false);
  const [isReqOpen, setIsReqOpen]         = useState(false);
  const [isReviewOpen, setIsReviewOpen]   = useState(false);
  const [targetPart, setTargetPart]       = useState<SparePart | null>(null);
  const [targetReq, setTargetReq]         = useState<Requisicion | null>(null);

  // ── Scan ───────────────────────────────────────────────────────────────────
  const [scanInput, setScanInput]         = useState('');
  const [scanResult, setScanResult]       = useState<SparePart | 'NOT_FOUND' | null>(null);

  // ── Forms ──────────────────────────────────────────────────────────────────
  const [newPart, setNewPart]             = useState({ ...EMPTY_FORM });
  const [editForm, setEditForm]           = useState({ ...EMPTY_EDIT });

  // ── Requisiciones ──────────────────────────────────────────────────────────
  const [requisiciones, setRequisiciones] = useState<Requisicion[]>([]);
  const [reqLoading, setReqLoading]       = useState(false);
  const [reqForm, setReqForm]             = useState({
    part_number: '', part_name: '', cantidad_solicitada: 1,
    justificacion: '', solicitante: '',
  });
  const [adminNota, setAdminNota]         = useState('');

  // ── Filtrado ───────────────────────────────────────────────────────────────

  const filteredParts = useMemo(() => {
    let list = parts.filter(p => matchesFilter(p.location, locationFilter));
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase().trim();
      list = list.filter(p =>
        String(p.name ?? '').toUpperCase().includes(q) || String(p.partNumber ?? '').toUpperCase().includes(q)
      );
    }
    return [...list].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }) ||
      String(a.partNumber).localeCompare(String(b.partNumber), 'es', { sensitivity: 'base' })
    );
  }, [parts, locationFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredParts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleParts = useMemo(() => filteredParts.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredParts, safePage, pageSize]);
  useEffect(() => { setPage(1); }, [searchQuery, locationFilter, pageSize]);
  const lowStockCount = filteredParts.filter(p => Number(p.quantity) > 0 && Number(p.quantity) <= Number(p.minStock ?? 5)).length;
  const zeroStockCount = filteredParts.filter(p => Number(p.quantity) <= 0).length;
  const totalUnits = filteredParts.reduce((sum, p) => sum + Number(p.quantity || 0), 0);
  const inventoryValue = filteredParts.reduce((sum, p) => sum + Number(p.quantity || 0) * Number(p.unitPrice || 0), 0);

  const printParts = () => {
    if (syncing || syncError) return;
    const win = window.open('', '_blank', 'width=1100,height=850');
    if (!win) { alert('Permite ventanas emergentes para imprimir.'); return; }
    const rows = filteredParts.map((part, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(part.partNumber)}</td><td>${escapeHtml(part.name)}</td><td>${escapeHtml(part.location)}</td><td style="text-align:right">${Number(part.quantity)}</td><td style="text-align:right">${Number(part.minStock || 0)}</td><td style="text-align:right">${Number(part.unitPrice || 0).toFixed(2)}</td></tr>`).join('');
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Existencias OMA</title><style>
      body{font:12px Arial,sans-serif;color:#111;margin:24px}h1{margin:0}p{color:#555}
      table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border:1px solid #ccc;padding:7px;text-align:left}
      th{background:#f3f3f3}tr{break-inside:avoid}@page{size:A4 landscape;margin:12mm}
      </style></head><body><h1>ÁGUILAS PILOT · INVENTARIO</h1>
      <p>Generado: ${escapeHtml(new Date().toLocaleString('es-VE'))} · Filtro: ${escapeHtml(locationFilter)} · Registros: ${filteredParts.length}</p>
      <p>Unidades: ${totalUnits} · Valor estimado: $${inventoryValue.toFixed(2)} · Documento de consulta, no certificado aeronáutico.</p>
      <table><thead><tr><th>#</th><th>P/N</th><th>Descripción</th><th>Almacén</th><th>Cantidad</th><th>Mínimo</th><th>Costo USD</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const exportCsv = () => {
    if (syncing || syncError) return;
    const header = ['P/N', 'Descripción', 'Almacén', 'Stock', 'Stock mínimo', 'Costo unitario USD'];
    const lines = [header, ...filteredParts.map(p => [p.partNumber, p.name, p.location, p.quantity, p.minStock, p.unitPrice])]
      .map(row => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF', lines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventario_aguilas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const filteredTransactions = transactions.filter(t => locationFilter === 'all' || matchesFilter(String(t.location ?? '') as HangarLocation, locationFilter));

  // Conteo por sede y almacén para el filtro
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: parts.length };
    SEDES.forEach(sede => {
      c[sede] = parts.filter(p => String(p.location ?? '').toLowerCase().startsWith(sede.toLowerCase().slice(0, 4))).length;
      ALMACENES[sede].forEach(alm => {
        c[alm] = parts.filter(p => p.location === alm).length;
      });
    });
    return c;
  }, [parts]);

  // ── Scan ───────────────────────────────────────────────────────────────────

  const handleScanSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const found = parts.find(p =>
      String(p.partNumber ?? '').toUpperCase().trim() === scanInput.toUpperCase().trim()
    );
    setScanResult(found || 'NOT_FOUND');
  };

  // ── AGREGAR ────────────────────────────────────────────────────────────────

  const handleAddPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const dbEntry = {
      numero_parte:       newPart.partNumber.toUpperCase(),
      nombre:             newPart.name.toUpperCase(),
      cantidad:           Number(newPart.quantity),
      stock_minimo:       5,
      ubicacion_hangar:   newPart.location,
      precio_unitario:    Number(newPart.unitPrice),
      certificado_numero: newPart.certificateNumber.toUpperCase(),
      factura_numero:     newPart.invoiceNumber.toUpperCase(),
      vendor_id:          newPart.vendorId || null,
    };
    const { data, error } = await supabase.from('inventario_repuestos').insert([dbEntry]).select();
    if (error) {
      alert('ERROR: ' + error.message);
    } else if (data?.length) {
      const row = data[0] as any;
      const added: SparePart = {
        id: row.id, partNumber: row.numero_parte, name: row.nombre,
        quantity: row.cantidad, minStock: row.stock_minimo,
        location: row.ubicacion_hangar as HangarLocation,
        unitPrice: row.precio_unitario, category: 'Repuestos',
        certificateNumber: row.certificado_numero,
      };
      setParts(prev => [added, ...prev]);
      await supabase.from('transacciones_inventario').insert([{
        tipo_movimiento: 'INBOUND', item_id: row.numero_parte, item_name: row.nombre,
        cantidad: row.cantidad, tecnico: 'ADMIN_VALKYRON', ubicacion: row.ubicacion_hangar,
        notas: `FACTURA: ${row.factura_numero} | FORM 8130: ${row.certificado_numero}`,
      }]);
      setIsAddOpen(false);
      setNewPart({ ...EMPTY_FORM });
      void refreshAllParts();
    }
    setLoading(false);
  };

  // ── EDITAR ─────────────────────────────────────────────────────────────────

  const openEdit = (part: SparePart) => {
    setTargetPart(part);
    setEditForm({
      name: part.name, partNumber: part.partNumber,
      quantity: part.quantity, location: part.location,
      unitPrice: part.unitPrice, vendorId: '',
      invoiceNumber: '', certificateNumber: part.certificateNumber ?? '',
    });
    setIsEditOpen(true);
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetPart) return;
    setLoading(true);
    const payload: Record<string, any> = {
      nombre:             editForm.name.toUpperCase(),
      numero_parte:       editForm.partNumber.toUpperCase(),
      cantidad:           Number(editForm.quantity),
      ubicacion_hangar:   editForm.location,
      precio_unitario:    Number(editForm.unitPrice),
      certificado_numero: editForm.certificateNumber.toUpperCase(),
    };
    if (editForm.invoiceNumber) payload.factura_numero = editForm.invoiceNumber.toUpperCase();
    if (editForm.vendorId)      payload.vendor_id      = editForm.vendorId;

    const { error } = await supabase
      .from('inventario_repuestos').update(payload).eq('id', targetPart.id);

    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      if (targetPart.quantity === 0 && Number(editForm.quantity) > 0) {
        await supabase.from('transacciones_inventario').insert([{
          tipo_movimiento: 'INBOUND',
          item_id:   editForm.partNumber.toUpperCase(),
          item_name: editForm.name.toUpperCase(),
          cantidad:  Number(editForm.quantity),
          tecnico:   'REPOSICION_MANUAL',
          ubicacion: editForm.location,
          notas:     `REPOSICIÓN desde stock cero. ${editForm.invoiceNumber ? 'FAC: ' + editForm.invoiceNumber : ''}`,
        }]);
      }
      setParts(prev => prev.map(p =>
        p.id === targetPart.id
          ? { ...p, name: payload.nombre, partNumber: payload.numero_parte,
              quantity: payload.cantidad, location: payload.ubicacion_hangar,
              unitPrice: payload.precio_unitario, certificateNumber: payload.certificado_numero }
          : p
      ));
      setIsEditOpen(false);
      setTargetPart(null);
      void refreshAllParts();
    }
    setLoading(false);
  };

  // ── ELIMINAR ───────────────────────────────────────────────────────────────

  const openDelete = (part: SparePart) => { setTargetPart(part); setIsDeleteOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!targetPart) return;
    setLoading(true);
    const { error } = await supabase.from('inventario_repuestos').delete().eq('id', targetPart.id);
    if (error) { alert('ERROR: ' + error.message); }
    else {
      setParts(prev => prev.filter(p => p.id !== targetPart.id));
      setIsDeleteOpen(false); setTargetPart(null);
      void refreshAllParts();
    }
    setLoading(false);
  };

  // ── REQUISICIONES ──────────────────────────────────────────────────────────

  const fetchRequisiciones = async () => {
    setReqLoading(true);
    const { data, error } = await supabase
      .from('requisiciones_inventario').select('*').order('created_at', { ascending: false });
    if (!error && data) setRequisiciones(data as Requisicion[]);
    setReqLoading(false);
  };

  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'requisiciones') fetchRequisiciones();
  };

  const handleCreateReq = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase
      .from('requisiciones_inventario')
      .insert([{
        part_number:         reqForm.part_number.toUpperCase(),
        part_name:           reqForm.part_name.toUpperCase(),
        cantidad_solicitada: Number(reqForm.cantidad_solicitada),
        justificacion:       reqForm.justificacion,
        solicitante:         reqForm.solicitante.toUpperCase(),
        status:              'PENDIENTE',
      }]).select();
    if (error) { alert('ERROR: ' + error.message); }
    else if (data?.length) {
      setRequisiciones(prev => [data[0] as Requisicion, ...prev]);
      setIsReqOpen(false);
      setReqForm({ part_number: '', part_name: '', cantidad_solicitada: 1, justificacion: '', solicitante: '' });
    }
    setLoading(false);
  };

  const openReqFromZeroStock = (part: SparePart) => {
    setReqForm({
      part_number: part.partNumber, part_name: part.name,
      cantidad_solicitada: 1,
      justificacion: `Stock agotado (0 unidades) en ${ALMACEN_LABEL[part.location] ?? part.location}. Reposición urgente.`,
      solicitante: '',
    });
    setIsReqOpen(true);
  };

  const handleReviewReq = async (newStatus: 'APROBADA' | 'RECHAZADA') => {
    if (!targetReq) return;
    setLoading(true);
    const { error } = await supabase
      .from('requisiciones_inventario')
      .update({ status: newStatus, notas_admin: adminNota, approved_at: new Date().toISOString() })
      .eq('id', targetReq.id);
    if (error) { alert('ERROR: ' + error.message); }
    else {
      setRequisiciones(prev =>
        prev.map(r => r.id === targetReq.id ? { ...r, status: newStatus, notas_admin: adminNota } : r)
      );
      setIsReviewOpen(false); setTargetReq(null); setAdminNota('');
    }
    setLoading(false);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* ── Toolbar con filtro jerárquico ── */}
      <div className="bg-[#0f0f0f] p-5 rounded-2xl border border-white/10 space-y-4">

        {/* Fila superior: título + botón agregar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Warehouse className="text-[#E1AD01] h-4 w-4 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/60">
              Almacenes
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void refreshAllParts()} disabled={syncing}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 text-slate-300 text-[9px] font-bold uppercase disabled:opacity-40">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button type="button" onClick={printParts} disabled={syncing || !!syncError}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 text-slate-300 text-[9px] font-bold uppercase disabled:opacity-40">
              <Printer size={14} /> Imprimir todo
            </button>
            <button type="button" onClick={exportCsv} disabled={syncing || !!syncError}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 text-slate-300 text-[9px] font-bold uppercase disabled:opacity-40">
              <Download size={14} /> CSV
            </button>
            <button onClick={() => setIsAddOpen(true)}
              className="bg-[#E1AD01] text-black px-4 py-2.5 rounded-xl font-black text-[10px]
                         uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
              <Plus className="h-4 w-4" /> Ingreso Certificado
            </button>
          </div>
        </div>

        {syncError && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          Error sincronizando: {syncError}. Los datos previos pueden estar desactualizados; reintenta antes de imprimir.
        </div>}
        <p className="text-[9px] text-slate-500 font-mono">
          {syncing ? 'Consultando todas las páginas de Supabase…' : `${parts.length} registros cargados`}
          {lastSynced ? ` · Actualizado ${lastSynced.toLocaleTimeString('es-VE')}` : ''}
        </p>

        {/* Filtro jerárquico: Ver Todo → Sede → Almacén */}
        <div className="flex flex-wrap gap-2">

          {/* Ver todo */}
          <button onClick={() => setLocationFilter('all')}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all border
              ${locationFilter === 'all'
                ? 'bg-[#E1AD01] text-black border-[#E1AD01]'
                : 'bg-black text-white/40 border-white/10 hover:border-white/20 hover:text-white/70'}`}>
            Todo ({counts.all})
          </button>

          {/* Por sede */}
          {SEDES.map(sede => (
            <div key={sede} className="flex items-center gap-1">
              {/* Botón sede */}
              <button
                onClick={() => setLocationFilter(sede)}
                className={`px-4 py-2 rounded-l-xl text-[9px] font-black uppercase tracking-wider transition-all border-y border-l
                  ${locationFilter === sede
                    ? 'bg-[#E1AD01]/20 text-[#E1AD01] border-[#E1AD01]/40'
                    : 'bg-black text-white/40 border-white/10 hover:border-white/20 hover:text-white/70'}`}>
                <MapPin className="inline h-3 w-3 mr-1 -mt-0.5" />
                {sede} ({counts[sede] ?? 0})
              </button>

              {/* Almacenes de la sede */}
              {ALMACENES[sede].map((alm, i) => {
                const isLast = i === ALMACENES[sede].length - 1;
                const label = alm.includes('OMA') ? 'OMA' : 'OPER.';
                return (
                  <button key={alm}
                    onClick={() => setLocationFilter(alm)}
                    className={`px-3 py-2 text-[8px] font-black uppercase tracking-wider transition-all border-y border-r
                      ${isLast ? 'rounded-r-xl' : ''}
                      ${locationFilter === alm
                        ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30'
                        : 'bg-black/60 text-white/25 border-white/[0.07] hover:text-white/50 hover:border-white/15'}`}>
                    {label} ({counts[alm] ?? 0})
                  </button>
                );
              })}

              {/* Separador entre sedes */}
              {sede !== SEDES[SEDES.length - 1] && (
                <div className="w-px h-6 bg-white/[0.07] mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Breadcrumb del filtro activo */}
        {locationFilter !== 'all' && (
          <div className="flex items-center gap-2">
            <span className="text-[8px] text-white/20 font-mono uppercase tracking-widest">Viendo:</span>
            <span className="text-[8px] font-black text-[#E1AD01] uppercase tracking-widest">
              {locationFilter in ALMACEN_LABEL
                ? ALMACEN_LABEL[locationFilter as HangarLocation]
                : locationFilter === 'Lara'
                ? 'Lara · Todos los almacenes'
                : 'Maturín · Todos los almacenes'}
            </span>
            <span className="text-[8px] text-white/20 font-mono">({filteredParts.length} repuestos)</span>
            <button onClick={() => setLocationFilter('all')}
              className="text-white/20 hover:text-white/50 transition-colors ml-1">
              <X size={10} />
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
        {[
          { id: 'parts',         label: 'Existencias (WAC)', icon: Package       },
          { id: 'log',           label: 'Trazabilidad MRO',  icon: ClipboardList  },
          { id: 'scan',          label: 'Terminal Scan',     icon: ScanLine       },
          { id: 'requisiciones', label: 'Requisiciones',     icon: FileText       },
        ].map(tab => (
          <button key={tab.id} onClick={() => handleTabChange(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-4 text-[9px] font-black uppercase
              tracking-[0.2em] transition-all border-b-2 whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-[#E1AD01] text-[#E1AD01] bg-white/5'
                : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">

        {/* ══ TAB — EXISTENCIAS ══ */}
        {activeTab === 'parts' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input type="text" placeholder="Buscar por nombre o P/N..."
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-2xl
                           pl-11 pr-4 py-4 text-white text-[11px] font-mono uppercase
                           outline-none focus:border-[#E1AD01] transition-all
                           placeholder:text-white/20 placeholder:normal-case" />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-all">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Repuestos filtrados', filteredParts.length.toLocaleString('es-VE')],
                ['Unidades totales', totalUnits.toLocaleString('es-VE')],
                ['Agotados / Bajo mínimo', `${zeroStockCount} / ${lowStockCount}`],
                ['Valor estimado USD', `$${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`],
              ].map(([label, value]) => <div key={label} className="bg-[#0b0b0b] border border-white/10 rounded-xl p-4">
                <p className="text-[9px] uppercase text-slate-500 font-black">{label}</p>
                <p className="text-lg text-[#E1AD01] font-black mt-1">{value}</p>
              </div>)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-400">
              <span>Mostrando {filteredParts.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filteredParts.length)} de {filteredParts.length} repuestos</span>
              <label className="flex items-center gap-2">Filas por página
                <select aria-label="Filas por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                  className="bg-black border border-white/10 rounded-lg px-3 py-2 text-white">
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-x-auto shadow-2xl">
              <table className="w-full min-w-[760px] text-left font-mono">
                <thead>
                  <tr className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-black
                                 bg-white/5 border-b border-white/10">
                    <th className="p-5">P/N — Componente</th>
                    <th className="p-5 text-center">Stock</th>
                    <th className="p-5">Costo Unit.</th>
                    <th className="p-5">Almacén</th>
                    <th className="p-5 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {visibleParts.map(part => {
                    const isZero = part.quantity === 0;
                    const isLow  = !isZero && part.quantity <= (part.minStock || 5);
                    return (
                      <tr key={part.id}
                        className={`transition-colors group ${isZero ? 'bg-red-500/[0.03]' : 'hover:bg-white/[0.02]'}`}>
                        <td className="p-5">
                          <span className="text-white block font-black uppercase">{part.name}</span>
                          <span className="text-[#E1AD01] text-[9px] font-bold uppercase tracking-widest">
                            {part.partNumber}
                          </span>
                        </td>
                        <td className="p-5 text-center">
                          <span className={`text-lg font-black ${
                            isZero ? 'text-red-500 animate-pulse'
                            : isLow ? 'text-orange-400'
                            : 'text-white'
                          }`}>{part.quantity}</span>
                          {isZero && <span className="block text-[7px] text-red-500/70 font-black uppercase tracking-widest mt-0.5">AGOTADO</span>}
                          {isLow  && <span className="block text-[7px] text-orange-400/70 font-black uppercase tracking-widest mt-0.5">BAJO MIN</span>}
                        </td>
                        <td className="p-5 text-white font-black">${Number(part.unitPrice || 0).toFixed(2)}</td>
                        <td className="p-5">
                          <span className="text-[9px] font-black uppercase text-white/50 block">
                            {ALMACEN_LABEL[part.location] ?? part.location}
                          </span>
                        </td>
                        <td className="p-5">
                          <div className="flex items-center justify-center gap-2">
                            {isZero && (
                              <button onClick={() => openReqFromZeroStock(part)}
                                className="p-2 rounded-lg bg-red-500/10 border border-red-500/20
                                           text-red-400 hover:bg-red-500/20 hover:border-red-500/40
                                           transition-all text-[8px] font-black uppercase flex items-center gap-1">
                                <RefreshCw size={11} />
                                <span className="hidden md:inline">Reponer</span>
                              </button>
                            )}
                            <button onClick={() => openEdit(part)}
                              className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]
                                         text-zinc-500 hover:text-[#E1AD01] hover:border-[#E1AD01]/30
                                         transition-all opacity-0 group-hover:opacity-100">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => openDelete(part)}
                              className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]
                                         text-zinc-500 hover:text-red-400 hover:border-red-500/30
                                         transition-all opacity-0 group-hover:opacity-100">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredParts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-zinc-700 text-[10px] font-black uppercase tracking-widest">
                        {searchQuery ? `Sin resultados para "${searchQuery}"` : 'Sin repuestos en este almacén'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0a0a0a] p-3">
              <span className="text-[9px] font-mono text-slate-500">Página {safePage} de {totalPages}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="rounded-lg border border-white/10 p-2 disabled:opacity-30" aria-label="Página anterior"><ChevronLeft size={16}/></button>
                <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-white/10 p-2 disabled:opacity-30" aria-label="Página siguiente"><ChevronRight size={16}/></button>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB — LOG MRO ══ */}
        {activeTab === 'log' && (
          <div className="space-y-4">
            {filteredTransactions.length === 0 && (
              <div className="text-center py-16 text-zinc-700 text-[10px] font-black uppercase tracking-widest">
                Sin transacciones para este almacén
              </div>
            )}
            {filteredTransactions.map((tx, idx) => (
              <div key={idx}
                className="bg-[#0f0f0f] border border-white/10 p-5 rounded-2xl flex items-center justify-between text-left">
                <div className="flex items-center gap-5">
                  <div className={`p-3 rounded-xl ${tx.type === 'inbound' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                    {tx.type === 'inbound' ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white">{tx.itemName}</h4>
                    <p className="text-[9px] text-slate-500 font-mono mt-1">P/N: {tx.itemId} | MOV: {tx.quantity}</p>
                    <p className="text-[8px] text-white/20 font-mono mt-0.5">{ALMACEN_LABEL[tx.location as HangarLocation] ?? tx.location}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[8px] font-black text-slate-500 block uppercase">{new Date(tx.date).toLocaleString()}</span>
                  <span className="text-[8px] font-black text-[#E1AD01] uppercase italic">TEC: {tx.technician}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ TAB — SCAN ══ */}
        {activeTab === 'scan' && (
          <div className="max-w-2xl mx-auto space-y-8 py-10 animate-in fade-in">
            <div className="text-center space-y-4">
              <ScanLine className="h-12 w-12 text-[#E1AD01] mx-auto animate-pulse" />
              <h2 className="text-[10px] font-black uppercase tracking-[0.5em]">Terminal de Despacho Inmediato</h2>
              <form onSubmit={handleScanSearch}>
                <input autoFocus
                  className="w-full bg-black border-2 border-white/10 rounded-2xl p-6 text-center
                             text-xl font-black tracking-widest text-[#E1AD01] outline-none focus:border-[#E1AD01]"
                  placeholder="P/N O ESCANEE CÓDIGO"
                  value={scanInput} onChange={e => setScanInput(e.target.value)} />
              </form>
            </div>
            {scanResult && scanResult !== 'NOT_FOUND' && (
              <div className="bg-[#0f0f0f] border-2 border-[#E1AD01] rounded-3xl p-8 shadow-2xl text-left">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="bg-[#E1AD01] text-black px-3 py-1 rounded text-[8px] font-black uppercase">Detectado</span>
                    <h3 className="text-2xl font-black text-white mt-2 uppercase">{scanResult.name}</h3>
                  </div>
                  <Box className="h-10 w-10 text-[#E1AD01]" />
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-black/50 p-4 rounded-xl border border-white/5">
                    <p className="text-[8px] text-slate-500 uppercase font-black">Stock</p>
                    <p className="text-2xl font-black text-white">{scanResult.quantity}</p>
                  </div>
                  <div className="bg-black/50 p-4 rounded-xl border border-white/5">
                    <p className="text-[8px] text-slate-500 uppercase font-black">Almacén</p>
                    <p className="text-xl font-black text-[#E1AD01] uppercase italic leading-tight">
                      {ALMACEN_LABEL[scanResult.location] ?? scanResult.location}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {scanResult === 'NOT_FOUND' && (
              <div className="text-center py-8">
                <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">P/N no encontrado en inventario</p>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB — REQUISICIONES ══ */}
        {activeTab === 'requisiciones' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                {isAdminOrCEO ? 'Panel de Aprobación · ADMIN / CEO' : 'Mis Solicitudes'}
              </p>
              <div className="flex items-center gap-3">
                <button onClick={fetchRequisiciones}
                  className="p-2.5 rounded-xl border border-white/10 text-slate-500 hover:text-white hover:border-white/20 transition-all">
                  <RefreshCw size={14} className={reqLoading ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setIsReqOpen(true)}
                  className="bg-[#E1AD01] text-black px-5 py-2.5 rounded-xl font-black text-[10px]
                             uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5" /> Nueva Requisición
                </button>
              </div>
            </div>
            {reqLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-[#E1AD01]" />
              </div>
            ) : (
              <div className="space-y-3">
                {requisiciones.map(req => (
                  <div key={req.id}
                    className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-5
                               flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono">
                    <div className="flex items-start gap-4 flex-1">
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] shrink-0">
                        <Package className="h-5 w-5 text-[#E1AD01]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white font-black uppercase text-[11px]">{req.part_name}</span>
                          <ReqBadge status={req.status} />
                        </div>
                        <p className="text-[9px] text-[#E1AD01] font-bold mb-1">P/N: {req.part_number}</p>
                        <p className="text-[9px] text-slate-500 leading-relaxed">{req.justificacion}</p>
                        {req.notas_admin && (
                          <p className="text-[9px] text-slate-400 italic mt-1 border-l-2 border-[#E1AD01]/30 pl-2">
                            Admin: {req.notas_admin}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-[9px] text-slate-600 font-black uppercase">
                          {req.cantidad_solicitada} unid · {req.solicitante}
                        </p>
                        <p className="text-[8px] text-slate-700">
                          {new Date(req.created_at).toLocaleDateString('es-VE')}
                        </p>
                      </div>
                      {isAdminOrCEO && req.status === 'PENDIENTE' && (
                        <button onClick={() => { setTargetReq(req); setAdminNota(''); setIsReviewOpen(true); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                                     bg-[#E1AD01]/10 border border-[#E1AD01]/30 text-[#E1AD01]
                                     text-[8px] font-black uppercase hover:bg-[#E1AD01]/20 transition-all">
                          <ShieldCheck size={11} /> Revisar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {requisiciones.length === 0 && (
                  <div className="text-center py-16 text-zinc-700 text-[10px] font-black uppercase tracking-widest">
                    Sin requisiciones registradas
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ MODAL — AGREGAR ══ */}
      {isAddOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><ShieldCheck className="h-4 w-4" /> Ingreso Certificado</div>
              <button onClick={() => setIsAddOpen(false)} className="hover:rotate-90 transition-all"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAddPart} className="p-8 space-y-4 text-left font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Part Number *</label>
                  <input required className={INPUT_CLS} placeholder="EJ: 123456-001"
                    value={newPart.partNumber}
                    onChange={e => setNewPart({ ...newPart, partNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre *</label>
                  <input required className={INPUT_CLS} placeholder="EJ: FILTRO ACEITE"
                    value={newPart.name}
                    onChange={e => setNewPart({ ...newPart, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase ml-1">Cantidad *</label>
                  <input type="number" min="1" step="1" required
                    className={`${INPUT_CLS} text-2xl font-black`} placeholder="0"
                    value={newPart.quantity || ''}
                    onChange={e => setNewPart({ ...newPart, quantity: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Precio Unit. ($)</label>
                  <input type="number" min="0" step="0.01"
                    className={`${INPUT_CLS} text-2xl font-black`} placeholder="0.00"
                    value={newPart.unitPrice || ''}
                    onChange={e => setNewPart({ ...newPart, unitPrice: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Almacén *</label>
                  <LocationSelect value={newPart.location}
                    onChange={v => setNewPart({ ...newPart, location: v })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Proveedor *</label>
                  <select required className={SELECT_CLS} value={newPart.vendorId}
                    onChange={e => setNewPart({ ...newPart, vendorId: e.target.value })}>
                    <option value="">SELECCIONAR...</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">N° Factura</label>
                  <input className={INPUT_CLS} placeholder="FAC-2024-001"
                    value={newPart.invoiceNumber}
                    onChange={e => setNewPart({ ...newPart, invoiceNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Form 8130 / Cert.</label>
                  <input className={INPUT_CLS} placeholder="8130-XXXXX"
                    value={newPart.certificateNumber}
                    onChange={e => setNewPart({ ...newPart, certificateNumber: e.target.value })} />
                </div>
              </div>
              {newPart.quantity > 0 && newPart.name && (
                <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/20 rounded-xl p-3">
                  <p className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest mb-0.5">Vista Previa</p>
                  <p className="text-[11px] text-white font-black uppercase">{newPart.name}</p>
                  <p className="text-[9px] text-zinc-400 font-mono">
                    {newPart.quantity} unid · ${(newPart.unitPrice * newPart.quantity).toFixed(2)} total · {ALMACEN_LABEL[newPart.location]}
                  </p>
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl
                           disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="animate-spin h-4 w-4" /> Inyectando...</> : <><ShieldCheck className="h-4 w-4" /> Autorizar Ingreso</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL — EDITAR ══ */}
      {isEditOpen && targetPart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-white/10 border-b border-[#E1AD01]/20 p-5 flex justify-between items-center font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic text-[#E1AD01]">
                <Pencil className="h-4 w-4" />
                {targetPart.quantity === 0 ? 'Reposición de Stock' : 'Editar Repuesto'}
              </div>
              <span className="text-[8px] text-slate-600 font-mono mr-auto ml-3">
                #{targetPart.id.slice(0, 8).toUpperCase()}
              </span>
              <button onClick={() => { setIsEditOpen(false); setTargetPart(null); }}
                className="text-white hover:rotate-90 transition-all"><X className="h-5 w-5" /></button>
            </div>
            {targetPart.quantity === 0 && (
              <div className="bg-red-500/10 border-b border-red-500/20 px-8 py-3 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-[9px] text-red-400 font-black uppercase tracking-widest">
                  Stock agotado — actualiza la cantidad para registrar la reposición
                </p>
              </div>
            )}
            <form onSubmit={handleEditSave} className="p-8 space-y-4 text-left font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Part Number *</label>
                  <input required className={INPUT_CLS} value={editForm.partNumber}
                    onChange={e => setEditForm({ ...editForm, partNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre *</label>
                  <input required className={INPUT_CLS} value={editForm.name}
                    onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase ml-1">
                    Cantidad * {targetPart.quantity === 0 && <span className="text-red-400">(ERA 0)</span>}
                  </label>
                  <input type="number" min="0" step="1" required
                    className={`${INPUT_CLS} text-2xl font-black ${targetPart.quantity === 0 ? 'border-red-500/30 focus:border-red-500' : ''}`}
                    value={editForm.quantity}
                    onChange={e => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Precio Unit. ($)</label>
                  <input type="number" min="0" step="0.01"
                    className={`${INPUT_CLS} text-2xl font-black`} value={editForm.unitPrice}
                    onChange={e => setEditForm({ ...editForm, unitPrice: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Almacén</label>
                  <LocationSelect value={editForm.location}
                    onChange={v => setEditForm({ ...editForm, location: v })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Proveedor</label>
                  <select className={SELECT_CLS} value={editForm.vendorId}
                    onChange={e => setEditForm({ ...editForm, vendorId: e.target.value })}>
                    <option value="">SIN CAMBIO</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">N° Factura</label>
                  <input className={INPUT_CLS} placeholder="Dejar vacío = sin cambio"
                    value={editForm.invoiceNumber}
                    onChange={e => setEditForm({ ...editForm, invoiceNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Form 8130 / Cert.</label>
                  <input className={INPUT_CLS} value={editForm.certificateNumber}
                    onChange={e => setEditForm({ ...editForm, certificateNumber: e.target.value })} />
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-white/10 border border-[#E1AD01]/40 text-[#E1AD01] py-5 rounded-2xl
                           font-black uppercase text-[10px] tracking-[0.4em] hover:bg-[#E1AD01]/20
                           transition-all shadow-xl disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="animate-spin h-4 w-4" /> Guardando...</> : <><Pencil className="h-4 w-4" /> Guardar Cambios</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL — ELIMINAR ══ */}
      {isDeleteOpen && targetPart && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-red-500/30 w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-red-600 p-5 flex justify-between items-center text-white font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><Trash2 className="h-4 w-4" /> Confirmar Eliminación</div>
              <button onClick={() => setIsDeleteOpen(false)} className="hover:rotate-90 transition-all"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-8 space-y-5 text-left font-mono">
              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                <p className="text-[9px] text-red-400 font-black uppercase tracking-widest mb-1">Repuesto a eliminar</p>
                <p className="text-[13px] text-white font-black uppercase">{targetPart.name}</p>
                <p className="text-[10px] text-[#E1AD01] font-mono">{targetPart.partNumber}</p>
                <p className="text-[9px] text-zinc-500 mt-1">
                  {targetPart.quantity} unid · {ALMACEN_LABEL[targetPart.location]}
                </p>
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Esta acción eliminará el repuesto permanentemente. El historial MRO se conserva.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setIsDeleteOpen(false)}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                  Cancelar
                </button>
                <button onClick={handleDeleteConfirm} disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-red-600 text-white text-[10px] font-black
                             uppercase hover:bg-red-500 transition-all disabled:opacity-40
                             flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <Trash2 size={14} />}
                  {loading ? 'Eliminando...' : 'Eliminar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL — CREAR REQUISICIÓN ══ */}
      {isReqOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><FileText className="h-4 w-4" /> Nueva Requisición</div>
              <button onClick={() => setIsReqOpen(false)} className="hover:rotate-90 transition-all"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreateReq} className="p-8 space-y-5 text-left font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Part Number *</label>
                  <input required className={INPUT_CLS} placeholder="P/N DEL REPUESTO"
                    value={reqForm.part_number}
                    onChange={e => setReqForm({ ...reqForm, part_number: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre *</label>
                  <input required className={INPUT_CLS} placeholder="EJ: FILTRO ACEITE"
                    value={reqForm.part_name}
                    onChange={e => setReqForm({ ...reqForm, part_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase ml-1">Cantidad *</label>
                  <input type="number" min="1" step="1" required
                    className={`${INPUT_CLS} text-2xl font-black`}
                    value={reqForm.cantidad_solicitada}
                    onChange={e => setReqForm({ ...reqForm, cantidad_solicitada: parseInt(e.target.value) || 1 })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Solicitante *</label>
                  <input required className={INPUT_CLS} placeholder="TU NOMBRE"
                    value={reqForm.solicitante}
                    onChange={e => setReqForm({ ...reqForm, solicitante: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Justificación *</label>
                <textarea required rows={3}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                             outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 resize-none"
                  placeholder="DESCRIBE POR QUÉ SE NECESITA..."
                  value={reqForm.justificacion}
                  onChange={e => setReqForm({ ...reqForm, justificacion: e.target.value })} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl
                           disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="animate-spin h-4 w-4" /> Enviando...</> : <><FileText className="h-4 w-4" /> Enviar Requisición</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL — REVISAR REQUISICIÓN ══ */}
      {isReviewOpen && targetReq && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-white/10 border-b border-[#E1AD01]/20 p-5 flex justify-between items-center font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic text-[#E1AD01]">
                <ShieldCheck className="h-4 w-4" /> Revisión de Requisición
              </div>
              <button onClick={() => { setIsReviewOpen(false); setTargetReq(null); }}
                className="text-white hover:rotate-90 transition-all"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-8 space-y-5 font-mono">
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-black uppercase text-sm">{targetReq.part_name}</p>
                    <p className="text-[#E1AD01] text-[10px]">P/N: {targetReq.part_number}</p>
                  </div>
                  <span className="text-lg font-black text-white shrink-0">× {targetReq.cantidad_solicitada}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed border-t border-white/5 pt-3">
                  {targetReq.justificacion}
                </p>
                <p className="text-[9px] text-slate-600">
                  Solicitante: <span className="text-slate-400 font-black uppercase">{targetReq.solicitante}</span>
                  {' · '}{new Date(targetReq.created_at).toLocaleString('es-VE')}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nota (opcional)</label>
                <textarea rows={2}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                             outline-none focus:border-[#E1AD01] transition-all resize-none placeholder:text-white/20"
                  placeholder="EJ: PENDIENTE HASTA SIGUIENTE COMPRA..."
                  value={adminNota} onChange={e => setAdminNota(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => handleReviewReq('RECHAZADA')} disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-red-600/20 border border-red-500/30 text-red-400
                             text-[10px] font-black uppercase hover:bg-red-600/30 transition-all
                             disabled:opacity-40 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <XCircle size={14} />}
                  Rechazar
                </button>
                <button onClick={() => handleReviewReq('APROBADA')} disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400
                             text-[10px] font-black uppercase hover:bg-green-500/30 transition-all
                             disabled:opacity-40 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <CheckCircle2 size={14} />}
                  Aprobar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default InventoryPanel;
// src/components/InventoryPanel.tsx
// VALKYRON OS v2.5.1 — Stock · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.5.1:
//   [FIX] Un proveedor sin nombre (nombre_empresa NULL) tumbaba Stock y todo el
//         Centro de Mando: el <select> de proveedores hacía v.name.toUpperCase()
//         y BmModal evalúa su contenido aunque esté cerrado. Ahora se normaliza
//         con String(v.name ?? ''). Detectado en la verificación de la fase 5.
//
// CHANGELOG v2.5 — REBRAND B&M + CONEXIONES:
//   [FIX] Trazabilidad MRO vacía siempre: la pestaña leía `transactions` de
//         Index, pero nadie cargaba esos datos. Ahora, al abrir la pestaña, se
//         leen todas las filas de transacciones_inventario por lotes y se
//         publican con setTransactions (prop existente). Paginada a 50.
//   [FIX] Ingreso certificado y reposición: el registro del movimiento INBOUND
//         ignoraba errores (traza perdida en silencio). Ahora se avisa si el
//         repuesto se guardó pero el movimiento no.
//   [FIX] Editar / eliminar aparecían solo con hover del mouse: en celulares y
//         tablets no se podían usar. Ahora siempre están visibles.
//   [UI]  Mobile-first: en móvil cada repuesto es una tarjeta con sus acciones;
//         desde md, tabla. Filtros de almacén como segmentos desplazables,
//         pestañas como control segmentado, modales B&M (hoja inferior en móvil).
//   [UI]  Impresión y CSV con marca B&M.
// PRESERVADO ÍNTEGRO (v2.4): lectura completa por lotes con control de versión,
//   filtro jerárquico Sede → Almacén, conteos, búsqueda, orden, paginación
//   (25/50/100), KPIs, impresión, CSV, escáner por P/N, alta / edición /
//   eliminación con los mismos payloads, reposición desde stock cero,
//   requisiciones (crear, revisar, aprobar / rechazar) y permisos ADMIN / CEO.
// ─────────────────────────────────────────────────────────────────────────────
// VALKYRON OS v2.4 — Inventario completo, paginación, impresión y sincronización
// CAMBIO v2.1:
//   - Filtro jerárquico: Sede (Lara / Maturín) → Almacén (OMA / OPERACIONES)
//   - HangarLocation: 'Lara-OMA' | 'Lara-OPERACIONES' | 'Maturín-OMA' | 'Maturín-OPERACIONES'
//   - Selects de ubicación muestran sede + almacén agrupados con <optgroup>

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { SparePart, Vendor, HangarLocation } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  BmModal, BmField, BmSelect, BmBadge, BmEmpty, BmNotice,
  bmInput, bmTextarea, bmSelectCls, bmBtn,
} from './brand/bm-ui';
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
const TX_MAX_ROWS = 100000;   // [v2.5] tope de seguridad de la trazabilidad
const TX_PAGE_SIZE = 50;      // [v2.5] movimientos por página
const escapeHtml = (value: unknown) => String(value ?? '—')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

// ── Helpers CSS ────────────────────────────────────────────────────────────────

// [v2.5] Controles B&M (antes: campos negros con borde dorado)
const SELECT_CLS = bmSelectCls;

const INPUT_CLS = `${bmInput} uppercase placeholder:normal-case`;

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
    PENDIENTE:  { tone: 'warn'   as const, icon: Clock,        label: 'Pendiente' },
    APROBADA:   { tone: 'ok'     as const, icon: CheckCircle2, label: 'Aprobada'  },
    RECHAZADA:  { tone: 'danger' as const, icon: XCircle,      label: 'Rechazada' },
  }[status] ?? { tone: 'neutral' as const, icon: Clock, label: String(status) };
  const Icon = cfg.icon;
  return (
    <BmBadge tone={cfg.tone} icon={<Icon className="h-3.5 w-3.5" />}>{cfg.label}</BmBadge>
  );
};

// ── Select de ubicación reutilizable ──────────────────────────────────────────

const LocationSelect = ({
  value, onChange, className, id,
}: {
  value: HangarLocation;
  onChange: (v: HangarLocation) => void;
  className?: string;
  id?: string;
}) => (
  <BmSelect
    id={id}
    className={className ?? ''}
    value={value}
    onChange={e => onChange(e.target.value as HangarLocation)}
  >
    <optgroup label="Lara">
      <option value="Lara-OMA">Lara · OMA</option>
      <option value="Lara-OPERACIONES">Lara · Operaciones</option>
    </optgroup>
    <optgroup label="Maturín">
      <option value="Maturín-OMA">Maturín · OMA</option>
      <option value="Maturín-OPERACIONES">Maturín · Operaciones</option>
    </optgroup>
  </BmSelect>
);

// [v2.5] Segmento de filtro de almacén
const segBtn = (active: boolean) =>
  `h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors ${
    active ? 'bg-bm-red-tint font-semibold text-bm-red-deep' : 'font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink'
  }`;

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

  // [v2.5] Trazabilidad
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError]     = useState<string | null>(null);
  const [txPage, setTxPage]       = useState(1);
  const txVersion = useRef(0);

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

  // ── [FIX v2.5] TRAZABILIDAD: carga completa de transacciones_inventario ────
  // Publica en el estado de Index (setTransactions) con la forma que ya usaba
  // la pestaña: { type, itemName, itemId, quantity, location, date, technician }.
  const fetchTransactions = useCallback(async () => {
    const version = ++txVersion.current;
    setTxLoading(true);
    setTxError(null);
    try {
      const all: any[] = [];
      for (let from = 0; from < TX_MAX_ROWS; from += FETCH_BATCH) {
        const { data, error } = await supabase.from('transacciones_inventario')
          .select('id,tipo_movimiento,item_id,item_name,cantidad,tecnico,ubicacion,fecha,notas')
          .order('fecha', { ascending: false }).order('id', { ascending: false })
          .range(from, from + FETCH_BATCH - 1);
        if (error) throw error;
        if (version !== txVersion.current) return;
        const batch = data ?? [];
        all.push(...batch.map((t: any) => ({
          id:         t.id,
          type:       String(t.tipo_movimiento ?? '').toUpperCase() === 'INBOUND' ? 'inbound' : 'outbound',
          itemName:   t.item_name ?? '',
          itemId:     t.item_id ?? '',
          quantity:   Number(t.cantidad ?? 0),
          location:   t.ubicacion ?? '',
          date:       t.fecha,
          technician: t.tecnico ?? '—',
          notes:      t.notas ?? '',
        })));
        if (batch.length < FETCH_BATCH) {
          if (version !== txVersion.current) return;
          setTransactions(all);
          setTxPage(1);
          return;
        }
      }
      throw new Error(`Trazabilidad mayor de ${TX_MAX_ROWS} movimientos: requiere paginación en servidor.`);
    } catch (err: unknown) {
      if (version === txVersion.current) {
        setTxError(err instanceof Error ? err.message : 'No se pudo cargar la trazabilidad.');
      }
    } finally {
      if (version === txVersion.current) setTxLoading(false);
    }
  }, [setTransactions]);

  useEffect(() => () => { txVersion.current += 1; }, []);


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
    // [v2.5] Encabezado B&M
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>B&amp;M — Existencias</title><style>
      body{font:12px Arial,sans-serif;color:#1b1d22;margin:24px}h1{margin:0;padding-bottom:10px;border-bottom:3px solid #d42125}p{color:#5f6670}
      table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border:1px solid #c9ccd2;padding:7px;text-align:left}
      th{background:#f2f3f5}tr{break-inside:avoid}@page{size:A4 landscape;margin:12mm}
      </style></head><body><h1>B&amp;M MANTENIMIENTO AERONÁUTICO · INVENTARIO</h1>
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
    a.href = url; a.download = `inventario_bym_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const filteredTransactions = transactions.filter(t => locationFilter === 'all' || matchesFilter(String(t.location ?? '') as HangarLocation, locationFilter));
  // [v2.5] Paginación de la trazabilidad
  const txPages = Math.max(1, Math.ceil(filteredTransactions.length / TX_PAGE_SIZE));
  const txSafePage = Math.min(txPage, txPages);
  const visibleTransactions = filteredTransactions.slice((txSafePage - 1) * TX_PAGE_SIZE, txSafePage * TX_PAGE_SIZE);
  useEffect(() => { setTxPage(1); }, [locationFilter]);

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
      const { error: txErr } = await supabase.from('transacciones_inventario').insert([{
        tipo_movimiento: 'INBOUND', item_id: row.numero_parte, item_name: row.nombre,
        cantidad: row.cantidad, tecnico: 'ADMIN_VALKYRON', ubicacion: row.ubicacion_hangar,
        notas: `FACTURA: ${row.factura_numero} | FORM 8130: ${row.certificado_numero}`,
      }]);
      // [FIX v2.5] El movimiento ya no se pierde en silencio
      if (txErr) {
        alert(`Repuesto registrado, pero el movimiento de ingreso NO quedó en la trazabilidad: ${txErr.message}`);
      }
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
        const { error: txErr } = await supabase.from('transacciones_inventario').insert([{
          tipo_movimiento: 'INBOUND',
          item_id:   editForm.partNumber.toUpperCase(),
          item_name: editForm.name.toUpperCase(),
          cantidad:  Number(editForm.quantity),
          tecnico:   'REPOSICION_MANUAL',
          ubicacion: editForm.location,
          notas:     `REPOSICIÓN desde stock cero. ${editForm.invoiceNumber ? 'FAC: ' + editForm.invoiceNumber : ''}`,
        }]);
        // [FIX v2.5]
        if (txErr) {
          alert(`Reposición guardada, pero el movimiento NO quedó en la trazabilidad: ${txErr.message}`);
        }
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
    if (tab === 'log') void fetchTransactions(); // [FIX v2.5]
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

  // ── [v2.5] Piezas de presentación ──────────────────────────────────────────

  const filterLabel = locationFilter in ALMACEN_LABEL
    ? ALMACEN_LABEL[locationFilter as HangarLocation]
    : locationFilter === 'Lara'
    ? 'Lara, todos los almacenes'
    : 'Maturín, todos los almacenes';

  const stockState = (part: SparePart) => {
    const isZero = part.quantity === 0;
    const isLow  = !isZero && part.quantity <= (part.minStock || 5);
    return { isZero, isLow };
  };

  const pager = (current: number, total: number, onPrev: () => void, onNext: () => void, label: string) => (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-bm-line bg-white px-4 py-2.5 text-[13px] text-bm-steel">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={current <= 1} onClick={onPrev}
          className={bmBtn.icon} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" disabled={current >= total} onClick={onNext}
          className={bmBtn.icon} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );

  const TABS = [
    { id: 'parts',         label: 'Existencias',   icon: Package       },
    { id: 'log',           label: 'Trazabilidad',  icon: ClipboardList },
    { id: 'scan',          label: 'Escáner',       icon: ScanLine      },
    { id: 'requisiciones', label: 'Requisiciones', icon: FileText      },
  ] as const;

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* ── Barra de herramientas con filtro jerárquico ── */}
      <div className="space-y-4 rounded-[24px] border border-bm-line bg-white p-4 sm:p-5">

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
              <Warehouse className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="bm-heading text-lg leading-tight sm:text-xl">Almacenes</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-bm-steel" aria-live="polite">
                {syncing && <Loader2 className="h-3.5 w-3.5 animate-spin text-bm-red" />}
                {syncing ? 'Consultando todas las páginas de Supabase…' : `${parts.length.toLocaleString('es-VE')} registros cargados`}
                {lastSynced && !syncing ? `, actualizado ${lastSynced.toLocaleTimeString('es-VE')}` : ''}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button type="button" onClick={() => void refreshAllParts()} disabled={syncing}
              className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Actualizar
            </button>
            <button type="button" onClick={printParts} disabled={syncing || !!syncError}
              className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <Printer className="h-4 w-4" /> Imprimir
            </button>
            <button type="button" onClick={exportCsv} disabled={syncing || !!syncError}
              className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={() => setIsAddOpen(true)}
              className={`${bmBtn.primary} col-span-3 sm:col-span-1`}>
              <Plus className="h-5 w-5" /> Ingreso certificado
            </button>
          </div>
        </div>

        {syncError && (
          <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
            Error sincronizando: {syncError}. Los datos previos pueden estar desactualizados; reintente antes de imprimir.
          </BmNotice>
        )}

        {/* Filtro jerárquico: Todo → Sede → Almacén */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filtrar por almacén">
          <div className="flex w-max items-center gap-2">
            <div className="inline-flex rounded-xl border border-bm-line p-1">
              <button type="button" onClick={() => setLocationFilter('all')} className={segBtn(locationFilter === 'all')}
                aria-pressed={locationFilter === 'all'}>
                Todo <span className="bm-num opacity-70">({counts.all})</span>
              </button>
            </div>
            {SEDES.map(sede => (
              <div key={sede} className="inline-flex items-center gap-1 rounded-xl border border-bm-line p-1">
                <button type="button" onClick={() => setLocationFilter(sede)} className={segBtn(locationFilter === sede)}
                  aria-pressed={locationFilter === sede}>
                  <MapPin className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                  {sede} <span className="bm-num opacity-70">({counts[sede] ?? 0})</span>
                </button>
                <span className="h-5 w-px bg-bm-line" aria-hidden="true" />
                {ALMACENES[sede].map(alm => {
                  const label = alm.includes('OMA') ? 'OMA' : 'Operaciones';
                  return (
                    <button key={alm} type="button" onClick={() => setLocationFilter(alm)} className={segBtn(locationFilter === alm)}
                      aria-pressed={locationFilter === alm}>
                      {label} <span className="bm-num opacity-70">({counts[alm] ?? 0})</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Filtro activo */}
        {locationFilter !== 'all' && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-bm-steel">Viendo:</span>
            <BmBadge tone="danger">{filterLabel}</BmBadge>
            <span className="text-bm-steel">({filteredParts.length} repuestos)</span>
            <button type="button" onClick={() => setLocationFilter('all')}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
              <X className="h-3.5 w-3.5" /> Quitar filtro
            </button>
          </div>
        )}
      </div>

      {/* ── Pestañas ── */}
      <div role="tablist" aria-label="Secciones de inventario"
        className="flex gap-1 overflow-x-auto rounded-2xl border border-bm-line bg-white p-1">
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={active}
              onClick={() => handleTabChange(tab.id)}
              className={`flex h-11 min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors ${
                active ? 'bg-bm-ink font-semibold text-white' : 'font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink'
              }`}>
              <tab.icon className="h-4 w-4" /> {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-[400px]">

        {/* ══ TAB — EXISTENCIAS ══ */}
        {activeTab === 'parts' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
              <input type="search" placeholder="Buscar por nombre o P/N"
                aria-label="Buscar repuesto"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                className={`${bmInput} pl-11 pr-11 uppercase placeholder:normal-case`} />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                { label: 'Repuestos filtrados', value: filteredParts.length.toLocaleString('es-VE'), cls: 'text-bm-ink' },
                { label: 'Unidades totales', value: totalUnits.toLocaleString('es-VE'), cls: 'text-bm-ink' },
                { label: 'Agotados / bajo mínimo', value: `${zeroStockCount} / ${lowStockCount}`, cls: zeroStockCount > 0 ? 'text-bm-red' : lowStockCount > 0 ? 'text-bm-warn' : 'text-bm-ok' },
                { label: 'Valor estimado USD', value: `$${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cls: 'text-bm-ink' },
              ].map(k => (
                <div key={k.label} className="rounded-[20px] border border-bm-line bg-white p-4">
                  <p className="text-[13px] text-bm-steel">{k.label}</p>
                  <p className={`bm-figure mt-2 truncate text-[22px] sm:text-[26px] ${k.cls}`}>{k.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[13px] text-bm-steel">
              <span>Mostrando {filteredParts.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filteredParts.length)} de {filteredParts.length} repuestos</span>
              <label className="flex items-center gap-2">Filas por página
                <select aria-label="Filas por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                  className="h-9 rounded-lg border border-bm-field bg-white px-2 text-sm text-bm-ink outline-none focus:border-bm-red">
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            {/* Móvil: tarjetas */}
            <ul className="space-y-2.5 md:hidden">
              {visibleParts.map(part => {
                const { isZero, isLow } = stockState(part);
                return (
                  <li key={part.id} className={`rounded-[20px] border bg-white p-4 ${isZero ? 'border-bm-red/30' : 'border-bm-line'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold uppercase leading-snug">{part.name}</p>
                        <p className="mt-0.5 truncate font-data text-xs text-bm-steel">{part.partNumber}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`bm-figure text-[28px] ${isZero ? 'text-bm-red' : isLow ? 'text-bm-warn' : 'text-bm-ink'}`}>{part.quantity}</p>
                        {isZero && <BmBadge tone="danger" className="mt-1">Agotado</BmBadge>}
                        {isLow && <BmBadge tone="warn" className="mt-1">Bajo mínimo</BmBadge>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-bm-steel">
                      <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{ALMACEN_LABEL[part.location] ?? part.location}</span>
                      <span className="bm-num">${Number(part.unitPrice || 0).toFixed(2)} c/u</span>
                    </div>
                    <div className="mt-3 flex gap-2 border-t border-bm-line pt-3">
                      {isZero && (
                        <button type="button" onClick={() => openReqFromZeroStock(part)} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1 !text-bm-red-deep`}>
                          <RefreshCw className="h-4 w-4" /> Reponer
                        </button>
                      )}
                      <button type="button" onClick={() => openEdit(part)} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1`}>
                        <Pencil className="h-4 w-4" /> Editar
                      </button>
                      <button type="button" onClick={() => openDelete(part)} className={bmBtn.icon} aria-label={`Eliminar ${part.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Tablet y escritorio: tabla */}
            <div className="hidden overflow-x-auto rounded-[20px] border border-bm-line bg-white md:block">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-bm-line bg-bm-canvas text-xs font-semibold text-bm-steel">
                    <th className="px-5 py-3">P/N — Componente</th>
                    <th className="px-5 py-3 text-center">Stock</th>
                    <th className="px-5 py-3">Costo unit.</th>
                    <th className="px-5 py-3">Almacén</th>
                    <th className="px-5 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bm-line text-sm">
                  {visibleParts.map(part => {
                    const { isZero, isLow } = stockState(part);
                    return (
                      <tr key={part.id}
                        className={`group transition-colors ${isZero ? 'bg-bm-red-tint/40' : 'hover:bg-bm-canvas/60'}`}>
                        <td className="px-5 py-3.5">
                          <span className="block font-semibold uppercase">{part.name}</span>
                          <span className="font-data text-xs text-bm-steel">{part.partNumber}</span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          <span className={`bm-num text-lg font-bold ${
                            isZero ? 'text-bm-red'
                            : isLow ? 'text-bm-warn'
                            : 'text-bm-ink'
                          }`}>{part.quantity}</span>
                          {isZero && <span className="block text-[11px] font-semibold text-bm-red">Agotado</span>}
                          {isLow  && <span className="block text-[11px] font-semibold text-bm-warn">Bajo mínimo</span>}
                        </td>
                        <td className="bm-num px-5 py-3.5 font-medium">${Number(part.unitPrice || 0).toFixed(2)}</td>
                        <td className="px-5 py-3.5 text-bm-steel">
                          {ALMACEN_LABEL[part.location] ?? part.location}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {isZero && (
                              <button type="button" onClick={() => openReqFromZeroStock(part)}
                                className={`${bmBtn.secondary} ${bmBtn.sm} !text-bm-red-deep`}>
                                <RefreshCw className="h-4 w-4" />
                                <span className="hidden lg:inline">Reponer</span>
                              </button>
                            )}
                            <button type="button" onClick={() => openEdit(part)} className={bmBtn.icon} aria-label={`Editar ${part.name}`}>
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => openDelete(part)} className={bmBtn.icon} aria-label={`Eliminar ${part.name}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredParts.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-bm-line bg-white">
                <BmEmpty
                  icon={<Package className="h-5 w-5" />}
                  title={searchQuery ? `Sin resultados para "${searchQuery}"` : 'Sin repuestos en este almacén'}
                  text={searchQuery ? 'Revise el P/N o busque por nombre.' : 'Registre un ingreso certificado para empezar.'}
                />
              </div>
            )}

            {pager(safePage, totalPages, () => setPage(p => Math.max(1, p - 1)), () => setPage(p => Math.min(totalPages, p + 1)), `Página ${safePage} de ${totalPages}`)}
          </div>
        )}

        {/* ══ TAB — TRAZABILIDAD ══ */}
        {activeTab === 'log' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-[13px] text-bm-steel" aria-live="polite">
                {txLoading ? 'Cargando movimientos…' : `${filteredTransactions.length.toLocaleString('es-VE')} movimientos`}
              </p>
              <button type="button" onClick={() => void fetchTransactions()} disabled={txLoading}
                className={`${bmBtn.secondary} ${bmBtn.sm}`}>
                <RefreshCw className={`h-4 w-4 ${txLoading ? 'animate-spin' : ''}`} /> Recargar
              </button>
            </div>

            {txError && (
              <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
                No se pudo cargar la trazabilidad: {txError}
              </BmNotice>
            )}

            {txLoading && transactions.length === 0 && (
              <div className="flex items-center justify-center gap-3 rounded-[24px] border border-bm-line bg-white p-12 text-sm text-bm-steel" role="status">
                <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Cargando movimientos…
              </div>
            )}

            {!txLoading && !txError && filteredTransactions.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-bm-line bg-white">
                <BmEmpty
                  icon={<ClipboardList className="h-5 w-5" />}
                  title="Sin movimientos para este almacén"
                  text="Los ingresos certificados y las salidas a aeronaves aparecerán aquí."
                />
              </div>
            )}

            {visibleTransactions.length > 0 && (
              <ul className="divide-y divide-bm-line overflow-hidden rounded-[20px] border border-bm-line bg-white">
                {visibleTransactions.map((tx, idx) => (
                  <li key={tx.id ?? idx}
                    className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tx.type === 'inbound' ? 'bg-bm-ok-tint text-bm-ok' : 'bg-bm-red-tint text-bm-red'}`}>
                        {tx.type === 'inbound' ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold uppercase">{tx.itemName}</p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-bm-steel">
                          <span className="font-data">{tx.itemId}</span>
                          <span className={`bm-num font-semibold ${tx.type === 'inbound' ? 'text-bm-ok' : 'text-bm-red'}`}>
                            {tx.type === 'inbound' ? '+' : '−'}{tx.quantity}
                          </span>
                          <span>{ALMACEN_LABEL[tx.location as HangarLocation] ?? tx.location}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-x-3 text-xs text-bm-steel sm:flex-col sm:items-end">
                      <span>{tx.date ? new Date(tx.date).toLocaleString('es-VE') : '—'}</span>
                      <span className="font-medium text-bm-ink">{tx.technician}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {filteredTransactions.length > TX_PAGE_SIZE &&
              pager(txSafePage, txPages, () => setTxPage(p => Math.max(1, p - 1)), () => setTxPage(p => Math.min(txPages, p + 1)), `Página ${txSafePage} de ${txPages}`)}
          </div>
        )}

        {/* ══ TAB — ESCÁNER ══ */}
        {activeTab === 'scan' && (
          <div className="mx-auto max-w-xl space-y-4 py-2 sm:py-6">
            <div className="rounded-[24px] border border-bm-line bg-white p-5 text-center sm:p-8">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
                <ScanLine className="h-6 w-6" />
              </span>
              <h2 className="bm-heading mt-4 text-lg">Consulta inmediata por P/N</h2>
              <p className="mt-1 text-sm text-bm-steel">Escriba el número de parte o use un lector de código.</p>
              <form onSubmit={handleScanSearch} className="mt-5 flex flex-col gap-2 sm:flex-row">
                <input autoFocus
                  aria-label="Número de parte"
                  className={`${bmInput} h-14 text-center font-data text-lg uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal sm:flex-1`}
                  placeholder="P/N o código escaneado"
                  value={scanInput} onChange={e => setScanInput(e.target.value)} />
                <button type="submit" className={`${bmBtn.primary} h-14`}>
                  <Search className="h-4 w-4" /> Buscar
                </button>
              </form>
            </div>
            {scanResult && scanResult !== 'NOT_FOUND' && (
              <div className="rounded-[24px] border-2 border-bm-ok/40 bg-white p-5 text-left sm:p-7">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <BmBadge tone="ok" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>Encontrado</BmBadge>
                    <h3 className="bm-heading mt-2 text-xl uppercase leading-tight sm:text-2xl">{scanResult.name}</h3>
                    <p className="mt-0.5 font-data text-xs text-bm-steel">{scanResult.partNumber}</p>
                  </div>
                  <Box className="h-9 w-9 shrink-0 text-bm-red" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-bm-canvas p-4">
                    <p className="text-xs text-bm-steel">Stock</p>
                    <p className={`bm-figure mt-1 text-[32px] ${scanResult.quantity === 0 ? 'text-bm-red' : 'text-bm-ink'}`}>{scanResult.quantity}</p>
                  </div>
                  <div className="rounded-xl bg-bm-canvas p-4">
                    <p className="text-xs text-bm-steel">Almacén</p>
                    <p className="mt-1 text-base font-semibold leading-tight">
                      {ALMACEN_LABEL[scanResult.location] ?? scanResult.location}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {scanResult === 'NOT_FOUND' && (
              <div className="rounded-[24px] border border-bm-red/25 bg-white">
                <BmEmpty
                  icon={<AlertCircle className="h-5 w-5 text-bm-red" />}
                  title="P/N no encontrado en inventario"
                  text="Verifique el número de parte. Si es un repuesto nuevo, regístrelo con Ingreso certificado."
                />
              </div>
            )}
          </div>
        )}

        {/* ══ TAB — REQUISICIONES ══ */}
        {activeTab === 'requisiciones' && (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] font-medium text-bm-steel">
                {isAdminOrCEO ? 'Panel de aprobación (ADMIN / CEO)' : 'Mis solicitudes'}
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={fetchRequisiciones} className={bmBtn.icon} aria-label="Recargar requisiciones">
                  <RefreshCw className={`h-4 w-4 ${reqLoading ? 'animate-spin' : ''}`} />
                </button>
                <button type="button" onClick={() => setIsReqOpen(true)} className={`${bmBtn.primary} ${bmBtn.sm} flex-1 sm:flex-none`}>
                  <Plus className="h-4 w-4" /> Nueva requisición
                </button>
              </div>
            </div>
            {reqLoading ? (
              <div className="flex items-center justify-center py-20" role="status">
                <Loader2 className="h-6 w-6 animate-spin text-bm-red" />
              </div>
            ) : (
              <div className="space-y-2.5">
                {requisiciones.map(req => (
                  <div key={req.id}
                    className="flex flex-col justify-between gap-4 rounded-[20px] border border-bm-line bg-white p-4 sm:p-5 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bm-canvas text-bm-red">
                        <Package className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-semibold uppercase">{req.part_name}</span>
                          <ReqBadge status={req.status} />
                        </div>
                        <p className="mb-1 font-data text-xs text-bm-steel">{req.part_number}</p>
                        <p className="text-sm leading-relaxed text-bm-steel">{req.justificacion}</p>
                        {req.notas_admin && (
                          <p className="mt-2 border-l-2 border-bm-red/40 pl-2.5 text-sm italic text-bm-ink">
                            Administración: {req.notas_admin}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-bm-line pt-3 md:flex-col md:items-end md:border-0 md:pt-0">
                      <div className="text-left md:text-right">
                        <p className="text-[13px] font-semibold">
                          <span className="bm-num">{req.cantidad_solicitada}</span> unid., {req.solicitante}
                        </p>
                        <p className="text-xs text-bm-steel">
                          {new Date(req.created_at).toLocaleDateString('es-VE')}
                        </p>
                      </div>
                      {isAdminOrCEO && req.status === 'PENDIENTE' && (
                        <button type="button" onClick={() => { setTargetReq(req); setAdminNota(''); setIsReviewOpen(true); }}
                          className={`${bmBtn.dark} ${bmBtn.sm}`}>
                          <ShieldCheck className="h-4 w-4" /> Revisar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {requisiciones.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-bm-line bg-white">
                    <BmEmpty
                      icon={<FileText className="h-5 w-5" />}
                      title="Sin requisiciones registradas"
                      text="Cree una requisición cuando un repuesto necesite reposición o compra."
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ MODAL — AGREGAR ══ */}
      <BmModal open={isAddOpen} onClose={() => setIsAddOpen(false)} busy={loading}
        title="Ingreso certificado" subtitle="Alta de repuesto con factura y certificado"
        icon={<ShieldCheck className="h-5 w-5" />} tone="red" z={100}>
        <form onSubmit={handleAddPart} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Part number" htmlFor="inv-pn" required>
              <input id="inv-pn" required className={`${INPUT_CLS} font-data`} placeholder="Ej.: 123456-001"
                value={newPart.partNumber}
                onChange={e => setNewPart({ ...newPart, partNumber: e.target.value })} />
            </BmField>
            <BmField label="Nombre" htmlFor="inv-nombre" required>
              <input id="inv-nombre" required className={INPUT_CLS} placeholder="Ej.: filtro de aceite"
                value={newPart.name}
                onChange={e => setNewPart({ ...newPart, name: e.target.value })} />
            </BmField>
            <BmField label="Cantidad" htmlFor="inv-cant" required>
              <input id="inv-cant" type="number" min="1" step="1" required inputMode="numeric"
                className={`${bmInput} bm-num text-lg font-semibold`} placeholder="0"
                value={newPart.quantity || ''}
                onChange={e => setNewPart({ ...newPart, quantity: parseInt(e.target.value) || 0 })} />
            </BmField>
            <BmField label="Precio unitario (USD)" htmlFor="inv-precio">
              <input id="inv-precio" type="number" min="0" step="0.01" inputMode="decimal"
                className={`${bmInput} bm-num text-lg font-semibold`} placeholder="0.00"
                value={newPart.unitPrice || ''}
                onChange={e => setNewPart({ ...newPart, unitPrice: parseFloat(e.target.value) || 0 })} />
            </BmField>
            <BmField label="Almacén" htmlFor="inv-alm" required>
              <LocationSelect id="inv-alm" value={newPart.location}
                onChange={v => setNewPart({ ...newPart, location: v })} />
            </BmField>
            <BmField label="Proveedor" htmlFor="inv-prov" required>
              <BmSelect id="inv-prov" required value={newPart.vendorId}
                onChange={e => setNewPart({ ...newPart, vendorId: e.target.value })}>
                <option value="">Seleccione el proveedor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{String(v.name ?? '').toUpperCase() || 'PROVEEDOR SIN NOMBRE'}</option>)}
              </BmSelect>
            </BmField>
            <BmField label="N.º de factura" htmlFor="inv-fac">
              <input id="inv-fac" className={INPUT_CLS} placeholder="FAC-2026-001"
                value={newPart.invoiceNumber}
                onChange={e => setNewPart({ ...newPart, invoiceNumber: e.target.value })} />
            </BmField>
            <BmField label="Form 8130 / certificado" htmlFor="inv-cert">
              <input id="inv-cert" className={INPUT_CLS} placeholder="8130-XXXXX"
                value={newPart.certificateNumber}
                onChange={e => setNewPart({ ...newPart, certificateNumber: e.target.value })} />
            </BmField>
          </div>
          {newPart.quantity > 0 && newPart.name && (
            <div className="rounded-xl bg-bm-canvas p-3.5">
              <p className="text-xs text-bm-steel">Vista previa</p>
              <p className="text-sm font-semibold uppercase">{newPart.name}</p>
              <p className="bm-num text-[13px] text-bm-steel">
                {newPart.quantity} unid., ${(newPart.unitPrice * newPart.quantity).toFixed(2)} total, {ALMACEN_LABEL[newPart.location]}
              </p>
            </div>
          )}
          <button type="submit" disabled={loading} className={`${bmBtn.primary} w-full`}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Registrando…</> : <><ShieldCheck className="h-4 w-4" /> Autorizar ingreso</>}
          </button>
        </form>
      </BmModal>

      {/* ══ MODAL — EDITAR ══ */}
      <BmModal open={isEditOpen && !!targetPart} onClose={() => { setIsEditOpen(false); setTargetPart(null); }} busy={loading}
        title={targetPart?.quantity === 0 ? 'Reposición de stock' : 'Editar repuesto'}
        subtitle={targetPart ? `Registro #${targetPart.id.slice(0, 8).toUpperCase()}` : undefined}
        icon={<Pencil className="h-5 w-5" />} tone="neutral" z={100}>
        {targetPart && (
          <form onSubmit={handleEditSave} className="space-y-4">
            {targetPart.quantity === 0 && (
              <BmNotice tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
                Stock agotado: actualice la cantidad para registrar la reposición.
              </BmNotice>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <BmField label="Part number" htmlFor="edit-pn" required>
                <input id="edit-pn" required className={`${INPUT_CLS} font-data`} value={editForm.partNumber}
                  onChange={e => setEditForm({ ...editForm, partNumber: e.target.value })} />
              </BmField>
              <BmField label="Nombre" htmlFor="edit-nombre" required>
                <input id="edit-nombre" required className={INPUT_CLS} value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              </BmField>
              <BmField label={<>Cantidad {targetPart.quantity === 0 && <span className="font-normal text-bm-red">(era 0)</span>}</>} htmlFor="edit-cant" required>
                <input id="edit-cant" type="number" min="0" step="1" required inputMode="numeric"
                  className={`${bmInput} bm-num text-lg font-semibold ${targetPart.quantity === 0 ? '!border-bm-red/50' : ''}`}
                  value={editForm.quantity}
                  onChange={e => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 0 })} />
              </BmField>
              <BmField label="Precio unitario (USD)" htmlFor="edit-precio">
                <input id="edit-precio" type="number" min="0" step="0.01" inputMode="decimal"
                  className={`${bmInput} bm-num text-lg font-semibold`} value={editForm.unitPrice}
                  onChange={e => setEditForm({ ...editForm, unitPrice: parseFloat(e.target.value) || 0 })} />
              </BmField>
              <BmField label="Almacén" htmlFor="edit-alm">
                <LocationSelect id="edit-alm" value={editForm.location}
                  onChange={v => setEditForm({ ...editForm, location: v })} />
              </BmField>
              <BmField label="Proveedor" htmlFor="edit-prov">
                <BmSelect id="edit-prov" value={editForm.vendorId}
                  onChange={e => setEditForm({ ...editForm, vendorId: e.target.value })}>
                  <option value="">Sin cambio</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{String(v.name ?? '').toUpperCase() || 'PROVEEDOR SIN NOMBRE'}</option>)}
                </BmSelect>
              </BmField>
              <BmField label="N.º de factura" htmlFor="edit-fac" hint="Vacío: sin cambio.">
                <input id="edit-fac" className={INPUT_CLS} placeholder="FAC-2026-001"
                  value={editForm.invoiceNumber}
                  onChange={e => setEditForm({ ...editForm, invoiceNumber: e.target.value })} />
              </BmField>
              <BmField label="Form 8130 / certificado" htmlFor="edit-cert">
                <input id="edit-cert" className={INPUT_CLS} value={editForm.certificateNumber}
                  onChange={e => setEditForm({ ...editForm, certificateNumber: e.target.value })} />
              </BmField>
            </div>
            <button type="submit" disabled={loading} className={`${bmBtn.primary} w-full`}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : <><Pencil className="h-4 w-4" /> Guardar cambios</>}
            </button>
          </form>
        )}
      </BmModal>

      {/* ══ MODAL — ELIMINAR ══ */}
      <BmModal open={isDeleteOpen && !!targetPart} onClose={() => setIsDeleteOpen(false)} busy={loading}
        title="Eliminar repuesto" subtitle="Esta acción no se puede deshacer"
        icon={<Trash2 className="h-5 w-5" />} tone="danger" size="sm" z={110}>
        {targetPart && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-bm-red/25 bg-bm-red-tint/50 p-4">
              <p className="text-[15px] font-semibold uppercase">{targetPart.name}</p>
              <p className="font-data text-xs text-bm-steel">{targetPart.partNumber}</p>
              <p className="mt-1 text-[13px] text-bm-steel">
                {targetPart.quantity} unid., {ALMACEN_LABEL[targetPart.location]}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-bm-steel">
              El repuesto se elimina de forma permanente. El historial MRO se conserva.
            </p>
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={() => setIsDeleteOpen(false)} disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
                Cancelar
              </button>
              <button type="button" onClick={handleDeleteConfirm} disabled={loading} className={`${bmBtn.danger} sm:flex-1`}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {loading ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        )}
      </BmModal>

      {/* ══ MODAL — CREAR REQUISICIÓN ══ */}
      <BmModal open={isReqOpen} onClose={() => setIsReqOpen(false)} busy={loading}
        title="Nueva requisición" subtitle="Solicitud de reposición o compra"
        icon={<FileText className="h-5 w-5" />} tone="red" z={110}>
        <form onSubmit={handleCreateReq} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Part number" htmlFor="req-pn" required>
              <input id="req-pn" required className={`${INPUT_CLS} font-data`} placeholder="P/N del repuesto"
                value={reqForm.part_number}
                onChange={e => setReqForm({ ...reqForm, part_number: e.target.value })} />
            </BmField>
            <BmField label="Nombre" htmlFor="req-nombre" required>
              <input id="req-nombre" required className={INPUT_CLS} placeholder="Ej.: filtro de aceite"
                value={reqForm.part_name}
                onChange={e => setReqForm({ ...reqForm, part_name: e.target.value })} />
            </BmField>
            <BmField label="Cantidad" htmlFor="req-cant" required>
              <input id="req-cant" type="number" min="1" step="1" required inputMode="numeric"
                className={`${bmInput} bm-num text-lg font-semibold`}
                value={reqForm.cantidad_solicitada}
                onChange={e => setReqForm({ ...reqForm, cantidad_solicitada: parseInt(e.target.value) || 1 })} />
            </BmField>
            <BmField label="Solicitante" htmlFor="req-sol" required>
              <input id="req-sol" required className={INPUT_CLS} placeholder="Su nombre"
                value={reqForm.solicitante}
                onChange={e => setReqForm({ ...reqForm, solicitante: e.target.value })} />
            </BmField>
          </div>
          <BmField label="Justificación" htmlFor="req-just" required>
            <textarea id="req-just" required rows={3}
              className={bmTextarea}
              placeholder="Describa por qué se necesita"
              value={reqForm.justificacion}
              onChange={e => setReqForm({ ...reqForm, justificacion: e.target.value })} />
          </BmField>
          <button type="submit" disabled={loading} className={`${bmBtn.primary} w-full`}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><FileText className="h-4 w-4" /> Enviar requisición</>}
          </button>
        </form>
      </BmModal>

      {/* ══ MODAL — REVISAR REQUISICIÓN ══ */}
      <BmModal open={isReviewOpen && !!targetReq} onClose={() => { setIsReviewOpen(false); setTargetReq(null); }} busy={loading}
        title="Revisión de requisición" subtitle={targetReq ? `Solicitada por ${targetReq.solicitante}` : undefined}
        icon={<ShieldCheck className="h-5 w-5" />} tone="dark" size="sm" z={110}>
        {targetReq && (
          <div className="space-y-4">
            <div className="space-y-3 rounded-2xl bg-bm-canvas p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold uppercase">{targetReq.part_name}</p>
                  <p className="font-data text-xs text-bm-steel">{targetReq.part_number}</p>
                </div>
                <span className="bm-figure shrink-0 text-2xl">×{targetReq.cantidad_solicitada}</span>
              </div>
              <p className="border-t border-bm-line pt-3 text-sm leading-relaxed">
                {targetReq.justificacion}
              </p>
              <p className="text-xs text-bm-steel">
                {targetReq.solicitante}, {new Date(targetReq.created_at).toLocaleString('es-VE')}
              </p>
            </div>
            <BmField label="Nota" htmlFor="rev-nota" hint="Opcional. Se muestra a quien solicitó.">
              <textarea id="rev-nota" rows={2}
                className={bmTextarea}
                placeholder="Ej.: pendiente hasta la siguiente compra"
                value={adminNota} onChange={e => setAdminNota(e.target.value)} />
            </BmField>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => handleReviewReq('RECHAZADA')} disabled={loading}
                className={`${bmBtn.secondary} !text-bm-red-deep`}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Rechazar
              </button>
              <button type="button" onClick={() => handleReviewReq('APROBADA')} disabled={loading}
                className={bmBtn.success}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Aprobar
              </button>
            </div>
          </div>
        )}
      </BmModal>

    </div>
  );
};

export default InventoryPanel;

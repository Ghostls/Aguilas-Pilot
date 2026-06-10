// src/components/InventoryPanel.tsx
// VALKYRON OS v2.0 — Grado Militar
// NUEVO: Buscador en tiempo real · Modal Editar funcional · Reposición stock-cero · Módulo Requisiciones (ADMIN/CEO)

import { useState, useMemo } from 'react';
import { SparePart, Vendor, HangarLocation } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  Package, ArrowDownCircle, ArrowUpCircle, ScanLine, Plus,
  X, MapPin, ClipboardList, ShieldCheck, Loader2, Pencil, Trash2,
  Box, AlertCircle, Search, FileText, CheckCircle2, Clock, XCircle,
  RefreshCw, ChevronDown,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface InventoryPanelProps {
  parts: SparePart[];
  setParts: React.Dispatch<React.SetStateAction<SparePart[]>>;
  transactions: any[];
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  vendors: Vendor[];
  userRole?: string; // 'ADMIN' | 'CEO' | 'PILOTO' | 'MECANICO' etc.
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

// ── Helpers CSS ────────────────────────────────────────────────────────────────

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20`;

const EMPTY_FORM = {
  name: '', partNumber: '', quantity: 0, location: 'Lara' as HangarLocation,
  unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
};

const EMPTY_EDIT = {
  name: '', partNumber: '', quantity: 0, location: 'Lara' as HangarLocation,
  unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
};

// ── Status badge para requisiciones ───────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════════════════
export const InventoryPanel = ({
  parts, setParts, transactions, setTransactions, vendors, userRole = 'MECANICO',
}: InventoryPanelProps) => {

  const isAdminOrCEO = ['ADMIN', 'CEO'].includes(userRole.toUpperCase());

  // ── Tabs & filtros ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]           = useState<'parts' | 'log' | 'scan' | 'requisiciones'>('parts');
  const [locationFilter, setLocationFilter] = useState<'all' | HangarLocation>('all');
  const [searchQuery, setSearchQuery]       = useState('');
  const [loading, setLoading]               = useState(false);

  // ── Modales ────────────────────────────────────────────────────────────────
  const [isAddOpen, setIsAddOpen]           = useState(false);
  const [isEditOpen, setIsEditOpen]         = useState(false);
  const [isDeleteOpen, setIsDeleteOpen]     = useState(false);
  const [isReqOpen, setIsReqOpen]           = useState(false);       // crear requisición
  const [isReviewOpen, setIsReviewOpen]     = useState(false);       // revisar requisición (admin)
  const [targetPart, setTargetPart]         = useState<SparePart | null>(null);
  const [targetReq, setTargetReq]           = useState<Requisicion | null>(null);

  // ── Scan ───────────────────────────────────────────────────────────────────
  const [scanInput, setScanInput]           = useState('');
  const [scanResult, setScanResult]         = useState<SparePart | 'NOT_FOUND' | null>(null);

  // ── Forms ──────────────────────────────────────────────────────────────────
  const [newPart, setNewPart]               = useState({ ...EMPTY_FORM });
  const [editForm, setEditForm]             = useState({ ...EMPTY_EDIT });

  // ── Requisiciones ──────────────────────────────────────────────────────────
  const [requisiciones, setRequisiciones]   = useState<Requisicion[]>([]);
  const [reqLoading, setReqLoading]         = useState(false);
  const [reqForm, setReqForm]               = useState({
    part_number: '', part_name: '', cantidad_solicitada: 1,
    justificacion: '', solicitante: '',
  });
  const [adminNota, setAdminNota]           = useState('');

  // ── Filtrado de partes (búsqueda + sede) ───────────────────────────────────
  const filteredParts = useMemo(() => {
    let list = locationFilter === 'all' ? parts : parts.filter(p => p.location === locationFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toUpperCase().trim();
      list = list.filter(p =>
        p.name.toUpperCase().includes(q) || p.partNumber.toUpperCase().includes(q)
      );
    }
    return list;
  }, [parts, locationFilter, searchQuery]);

  const filteredTransactions = locationFilter === 'all'
    ? transactions
    : transactions.filter(t => t.location === locationFilter);

  // ── Scan ───────────────────────────────────────────────────────────────────
  const handleScanSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const found = parts.find(p => p.partNumber.toUpperCase().trim() === scanInput.toUpperCase().trim());
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
    }
    setLoading(false);
  };

  // ── EDITAR — abrir (pre-poblar form) ──────────────────────────────────────
  const openEdit = (part: SparePart) => {
    setTargetPart(part);
    setEditForm({
      name:              part.name,
      partNumber:        part.partNumber,
      quantity:          part.quantity,
      location:          part.location,
      unitPrice:         part.unitPrice,
      vendorId:          '',
      invoiceNumber:     '',
      certificateNumber: part.certificateNumber ?? '',
    });
    setIsEditOpen(true);
  };

  // ── EDITAR — guardar ──────────────────────────────────────────────────────
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
      .from('inventario_repuestos')
      .update(payload)
      .eq('id', targetPart.id);

    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      // Si es reposición (cantidad anterior era 0), loguear movimiento INBOUND
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
          ? {
              ...p,
              name:              payload.nombre,
              partNumber:        payload.numero_parte,
              quantity:          payload.cantidad,
              location:          payload.ubicacion_hangar,
              unitPrice:         payload.precio_unitario,
              certificateNumber: payload.certificado_numero,
            }
          : p
      ));
      setIsEditOpen(false);
      setTargetPart(null);
    }
    setLoading(false);
  };

  // ── ELIMINAR ───────────────────────────────────────────────────────────────
  const openDelete = (part: SparePart) => { setTargetPart(part); setIsDeleteOpen(true); };

  const handleDeleteConfirm = async () => {
    if (!targetPart) return;
    setLoading(true);
    const { error } = await supabase.from('inventario_repuestos').delete().eq('id', targetPart.id);
    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      setParts(prev => prev.filter(p => p.id !== targetPart.id));
      setIsDeleteOpen(false);
      setTargetPart(null);
    }
    setLoading(false);
  };

  // ── REQUISICIONES — cargar ────────────────────────────────────────────────
  const fetchRequisiciones = async () => {
    setReqLoading(true);
    const { data, error } = await supabase
      .from('requisiciones_inventario')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setRequisiciones(data as Requisicion[]);
    setReqLoading(false);
  };

  // Cargar cuando se abre el tab
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'requisiciones') fetchRequisiciones();
  };

  // ── REQUISICIONES — crear ─────────────────────────────────────────────────
  const handleCreateReq = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase
      .from('requisiciones_inventario')
      .insert([{
        part_number:          reqForm.part_number.toUpperCase(),
        part_name:            reqForm.part_name.toUpperCase(),
        cantidad_solicitada:  Number(reqForm.cantidad_solicitada),
        justificacion:        reqForm.justificacion,
        solicitante:          reqForm.solicitante.toUpperCase(),
        status:               'PENDIENTE',
      }])
      .select();
    if (error) {
      alert('ERROR: ' + error.message);
    } else if (data?.length) {
      setRequisiciones(prev => [data[0] as Requisicion, ...prev]);
      setIsReqOpen(false);
      setReqForm({ part_number: '', part_name: '', cantidad_solicitada: 1, justificacion: '', solicitante: '' });
    }
    setLoading(false);
  };

  // ── REQUISICIONES — abrir review desde stock cero ────────────────────────
  const openReqFromZeroStock = (part: SparePart) => {
    setReqForm({
      part_number:          part.partNumber,
      part_name:            part.name,
      cantidad_solicitada:  1,
      justificacion:        `Stock agotado (0 unidades). Reposición urgente.`,
      solicitante:          '',
    });
    setIsReqOpen(true);
  };

  // ── REQUISICIONES — aprobar/rechazar (ADMIN/CEO) ──────────────────────────
  const handleReviewReq = async (newStatus: 'APROBADA' | 'RECHAZADA') => {
    if (!targetReq) return;
    setLoading(true);
    const { error } = await supabase
      .from('requisiciones_inventario')
      .update({
        status:      newStatus,
        notas_admin: adminNota,
        approved_at: new Date().toISOString(),
      })
      .eq('id', targetReq.id);
    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      setRequisiciones(prev =>
        prev.map(r => r.id === targetReq.id ? { ...r, status: newStatus, notas_admin: adminNota } : r)
      );
      setIsReviewOpen(false);
      setTargetReq(null);
      setAdminNota('');
    }
    setLoading(false);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* ── Toolbar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4
                      bg-[#0f0f0f] p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-3 flex-wrap">
          <MapPin className="text-[#E1AD01] h-4 w-4 shrink-0" />
          <div className="flex bg-black rounded-xl p-1 border border-white/5">
            {(['all', 'Lara', 'Maturín'] as const).map(loc => (
              <button key={loc} onClick={() => setLocationFilter(loc)}
                className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all
                  ${locationFilter === loc ? 'bg-[#E1AD01] text-black shadow-lg' : 'text-slate-500 hover:text-white'}`}>
                {loc === 'all' ? 'Ver Todo' : loc}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setIsAddOpen(true)}
          className="bg-[#E1AD01] text-black px-6 py-2.5 rounded-xl font-black text-[10px]
                     uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
          <Plus className="h-4 w-4" /> Ingreso Certificado
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
        {[
          { id: 'parts',         label: 'Existencias (WAC)', icon: Package      },
          { id: 'log',           label: 'Trazabilidad MRO',  icon: ClipboardList },
          { id: 'scan',          label: 'Terminal Scan',     icon: ScanLine     },
          { id: 'requisiciones', label: 'Requisiciones',     icon: FileText     },
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

        {/* ══════════════════════════════════════════════════════
            TAB — EXISTENCIAS
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'parts' && (
          <div className="space-y-4">

            {/* Buscador */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar por nombre o P/N..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-white/10 rounded-2xl
                           pl-11 pr-4 py-4 text-white text-[11px] font-mono uppercase
                           outline-none focus:border-[#E1AD01] transition-all
                           placeholder:text-white/20 placeholder:normal-case"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-white transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-black
                                 bg-white/5 border-b border-white/10">
                    <th className="p-5">P/N — Componente</th>
                    <th className="p-5 text-center">Stock</th>
                    <th className="p-5">Costo Unit.</th>
                    <th className="p-5">Ubicación</th>
                    <th className="p-5 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {filteredParts.map(part => {
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
                          {isZero && (
                            <span className="block text-[7px] text-red-500/70 font-black uppercase tracking-widest mt-0.5">
                              AGOTADO
                            </span>
                          )}
                          {isLow && (
                            <span className="block text-[7px] text-orange-400/70 font-black uppercase tracking-widest mt-0.5">
                              BAJO MIN
                            </span>
                          )}
                        </td>
                        <td className="p-5 text-white font-black">${part.unitPrice.toFixed(2)}</td>
                        <td className="p-5 text-slate-500 uppercase font-bold text-[9px]">{part.location}</td>
                        <td className="p-5">
                          <div className="flex items-center justify-center gap-2">
                            {/* Reposición rápida si stock = 0 */}
                            {isZero && (
                              <button
                                onClick={() => openReqFromZeroStock(part)}
                                title="Solicitar reposición"
                                className="p-2 rounded-lg bg-red-500/10 border border-red-500/20
                                           text-red-400 hover:bg-red-500/20 hover:border-red-500/40
                                           transition-all text-[8px] font-black uppercase flex items-center gap-1">
                                <RefreshCw size={11} />
                                <span className="hidden md:inline">Reponer</span>
                              </button>
                            )}
                            {/* Editar */}
                            <button
                              onClick={() => openEdit(part)}
                              title="Editar"
                              className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.07]
                                         text-zinc-500 hover:text-[#E1AD01] hover:border-[#E1AD01]/30
                                         transition-all opacity-0 group-hover:opacity-100">
                              <Pencil size={13} />
                            </button>
                            {/* Eliminar */}
                            <button
                              onClick={() => openDelete(part)}
                              title="Eliminar"
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
                        {searchQuery ? `Sin resultados para "${searchQuery}"` : 'Sin repuestos registrados'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            TAB — LOG MRO
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'log' && (
          <div className="space-y-4">
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

        {/* ══════════════════════════════════════════════════════
            TAB — SCAN
        ══════════════════════════════════════════════════════ */}
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
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)} />
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
                    <p className="text-[8px] text-slate-500 uppercase font-black">Ubicación</p>
                    <p className="text-2xl font-black text-[#E1AD01] uppercase italic">{scanResult.location}</p>
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

        {/* ══════════════════════════════════════════════════════
            TAB — REQUISICIONES
        ══════════════════════════════════════════════════════ */}
        {activeTab === 'requisiciones' && (
          <div className="space-y-6">

            {/* Header requisiciones */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                  {isAdminOrCEO ? 'Panel de Aprobación · ADMIN / CEO' : 'Mis Solicitudes'}
                </p>
              </div>
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

            {/* Lista */}
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
                      {/* Solo ADMIN/CEO puede revisar pendientes */}
                      {isAdminOrCEO && req.status === 'PENDIENTE' && (
                        <button
                          onClick={() => { setTargetReq(req); setAdminNota(''); setIsReviewOpen(true); }}
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL — AGREGAR
      ══════════════════════════════════════════════════════════════ */}
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
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Ubicación</label>
                  <select className={SELECT_CLS} value={newPart.location}
                    onChange={e => setNewPart({ ...newPart, location: e.target.value as HangarLocation })}>
                    <option value="Lara">LARA</option>
                    <option value="Maturín">MATURÍN</option>
                  </select>
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
                    {newPart.quantity} unid · ${(newPart.unitPrice * newPart.quantity).toFixed(2)} total · {newPart.location}
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL — EDITAR REPUESTO
      ══════════════════════════════════════════════════════════════ */}
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

            {/* Banner reposición si stock = 0 */}
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
                  <input required className={INPUT_CLS}
                    value={editForm.partNumber}
                    onChange={e => setEditForm({ ...editForm, partNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre *</label>
                  <input required className={INPUT_CLS}
                    value={editForm.name}
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
                    className={`${INPUT_CLS} text-2xl font-black`}
                    value={editForm.unitPrice}
                    onChange={e => setEditForm({ ...editForm, unitPrice: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Ubicación</label>
                  <select className={SELECT_CLS} value={editForm.location}
                    onChange={e => setEditForm({ ...editForm, location: e.target.value as HangarLocation })}>
                    <option value="Lara">LARA</option>
                    <option value="Maturín">MATURÍN</option>
                  </select>
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
                  <input className={INPUT_CLS}
                    value={editForm.certificateNumber}
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL — CONFIRMAR ELIMINACIÓN
      ══════════════════════════════════════════════════════════════ */}
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
                <p className="text-[9px] text-zinc-500 mt-1">{targetPart.quantity} unid · {targetPart.location}</p>
              </div>
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Esta acción eliminará el repuesto de la base de datos permanentemente.
                El historial de trazabilidad MRO se conserva.
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL — CREAR REQUISICIÓN
      ══════════════════════════════════════════════════════════════ */}
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
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre del Repuesto *</label>
                  <input required className={INPUT_CLS} placeholder="EJ: FILTRO ACEITE"
                    value={reqForm.part_name}
                    onChange={e => setReqForm({ ...reqForm, part_name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase ml-1">Cantidad Solicitada *</label>
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
                  placeholder="DESCRIBE POR QUÉ SE NECESITA ESTE REPUESTO..."
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL — REVISAR REQUISICIÓN (ADMIN / CEO)
      ══════════════════════════════════════════════════════════════ */}
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
              {/* Detalle */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-white font-black uppercase text-sm">{targetReq.part_name}</p>
                    <p className="text-[#E1AD01] text-[10px]">P/N: {targetReq.part_number}</p>
                  </div>
                  <span className="text-lg font-black text-white shrink-0">
                    × {targetReq.cantidad_solicitada}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed border-t border-white/5 pt-3">
                  {targetReq.justificacion}
                </p>
                <p className="text-[9px] text-slate-600">
                  Solicitante: <span className="text-slate-400 font-black uppercase">{targetReq.solicitante}</span>
                  {' · '}{new Date(targetReq.created_at).toLocaleString('es-VE')}
                </p>
              </div>
              {/* Nota admin */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase ml-1">
                  Nota para el solicitante (opcional)
                </label>
                <textarea rows={2}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                             outline-none focus:border-[#E1AD01] transition-all resize-none placeholder:text-white/20"
                  placeholder="EJ: PENDIENTE HASTA SIGUIENTE COMPRA..."
                  value={adminNota}
                  onChange={e => setAdminNota(e.target.value)} />
              </div>
              {/* Botones */}
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
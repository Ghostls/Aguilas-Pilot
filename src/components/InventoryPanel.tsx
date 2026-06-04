import { useState } from 'react';
import { SparePart, Vendor, HangarLocation } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  Package, ArrowDownCircle, ArrowUpCircle, ScanLine, Plus,
  X, MapPin, ClipboardList, ShieldCheck, Loader2, Pencil, Trash2, Box, AlertCircle
} from 'lucide-react';

interface InventoryPanelProps {
  parts: SparePart[];
  setParts: React.Dispatch<React.SetStateAction<SparePart[]>>;
  transactions: any[];
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  vendors: Vendor[];
}

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20`;

const EMPTY_FORM = {
  name: '', partNumber: '', quantity: 0, location: 'Lara' as HangarLocation,
  unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
};

export const InventoryPanel = ({
  parts, setParts, transactions, setTransactions, vendors,
}: InventoryPanelProps) => {
  const [activeTab, setActiveTab]           = useState<'parts' | 'log' | 'scan'>('parts');
  const [locationFilter, setLocationFilter] = useState<'all' | HangarLocation>('all');
  const [loading, setLoading]               = useState(false);

  // Modales
  const [isAddOpen, setIsAddOpen]           = useState(false);
  const [isEditOpen, setIsEditOpen]         = useState(false);
  const [isDeleteOpen, setIsDeleteOpen]     = useState(false);
  const [targetPart, setTargetPart]         = useState<SparePart | null>(null);

  // Scan
  const [scanInput, setScanInput]           = useState('');
  const [scanResult, setScanResult]         = useState<SparePart | 'NOT_FOUND' | null>(null);

  // Form agregar
  const [newPart, setNewPart]               = useState({ ...EMPTY_FORM });

  // Form editar — espeja los campos editables
  const [editForm, setEditForm] = useState({
    name: '', partNumber: '', quantity: 0, location: 'Lara' as HangarLocation,
    unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '',
  });

  const filteredParts = locationFilter === 'all'
    ? parts
    : parts.filter(p => p.location === locationFilter);

  const filteredTransactions = locationFilter === 'all'
    ? transactions
    : transactions.filter(t => t.location === locationFilter);

  const handleScanSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const found = parts.find(
      p => p.partNumber.toUpperCase().trim() === scanInput.toUpperCase().trim()
    );
    setScanResult(found || 'NOT_FOUND');
  };

  // ── AGREGAR ───────────────────────────────────────────────────────────────
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
    const { data, error } = await supabase
      .from('inventario_repuestos').insert([dbEntry]).select();
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

  // ── EDITAR ────────────────────────────────────────────────────────────────
  const openEdit = (part: SparePart) => {
    setTargetPart(part);
    setEditForm({
      name:              part.name,
      partNumber:        part.partNumber,
      quantity:          part.quantity,
      location:          part.location,
      unitPrice:         part.unitPrice,
      vendorId:          '',          // vendor_id no está en SparePart — se deja vacío
      invoiceNumber:     '',
      certificateNumber: part.certificateNumber ?? '',
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
    if (editForm.invoiceNumber)  payload.factura_numero = editForm.invoiceNumber.toUpperCase();
    if (editForm.vendorId)       payload.vendor_id      = editForm.vendorId;

    const { error } = await supabase
      .from('inventario_repuestos').update(payload).eq('id', targetPart.id);
    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      setParts(prev => prev.map(p =>
        p.id === targetPart.id
          ? { ...p, name: payload.nombre, partNumber: payload.numero_parte,
              quantity: payload.cantidad, location: payload.ubicacion_hangar,
              unitPrice: payload.precio_unitario, certificateNumber: payload.certificado_numero }
          : p
      ));
      setIsEditOpen(false);
      setTargetPart(null);
    }
    setLoading(false);
  };

  // ── ELIMINAR ──────────────────────────────────────────────────────────────
  const openDelete = (part: SparePart) => {
    setTargetPart(part);
    setIsDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!targetPart) return;
    setLoading(true);
    const { error } = await supabase
      .from('inventario_repuestos').delete().eq('id', targetPart.id);
    if (error) {
      alert('ERROR: ' + error.message);
    } else {
      setParts(prev => prev.filter(p => p.id !== targetPart.id));
      setIsDeleteOpen(false);
      setTargetPart(null);
    }
    setLoading(false);
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4
                      bg-[#0f0f0f] p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-3">
          <MapPin className="text-[#E1AD01] h-4 w-4" />
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

      {/* Tabs */}
      <div className="flex gap-4 border-b border-white/5">
        {[
          { id: 'parts', label: 'Existencias (WAC)', icon: Package },
          { id: 'log',   label: 'Trazabilidad MRO',  icon: ClipboardList },
          { id: 'scan',  label: 'Terminal Scan',      icon: ScanLine },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-4 text-[9px] font-black uppercase
              tracking-[0.2em] transition-all border-b-2
              ${activeTab === tab.id
                ? 'border-[#E1AD01] text-[#E1AD01] bg-white/5'
                : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">

        {/* ── TAB EXISTENCIAS ── */}
        {activeTab === 'parts' && (
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
                {filteredParts.map(part => (
                  <tr key={part.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="p-5">
                      <span className="text-white block font-black uppercase">{part.name}</span>
                      <span className="text-[#E1AD01] text-[9px] font-bold uppercase tracking-widest">
                        {part.partNumber}
                      </span>
                    </td>
                    <td className="p-5 text-center">
                      <span className={`text-lg font-black ${
                        part.quantity <= (part.minStock || 5) ? 'text-red-500 animate-pulse' : 'text-white'
                      }`}>{part.quantity}</span>
                    </td>
                    <td className="p-5 text-white font-black">${part.unitPrice.toFixed(2)}</td>
                    <td className="p-5 text-slate-500 uppercase font-bold text-[9px]">{part.location}</td>
                    <td className="p-5">
                      <div className="flex items-center justify-center gap-2">
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
                ))}
                {filteredParts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-zinc-700 text-[10px]
                                               font-black uppercase tracking-widest">
                      Sin repuestos registrados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── TAB LOG MRO ── */}
        {activeTab === 'log' && (
          <div className="space-y-4">
            {filteredTransactions.map((tx, idx) => (
              <div key={idx}
                className="bg-[#0f0f0f] border border-white/10 p-5 rounded-2xl
                           flex items-center justify-between text-left">
                <div className="flex items-center gap-5">
                  <div className={`p-3 rounded-xl ${
                    tx.type === 'inbound' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                  }`}>
                    {tx.type === 'inbound'
                      ? <ArrowDownCircle className="h-5 w-5" />
                      : <ArrowUpCircle className="h-5 w-5" />}
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white">{tx.itemName}</h4>
                    <p className="text-[9px] text-slate-500 font-mono mt-1">
                      P/N: {tx.itemId} | MOV: {tx.quantity}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[8px] font-black text-slate-500 block uppercase">
                    {new Date(tx.date).toLocaleString()}
                  </span>
                  <span className="text-[8px] font-black text-[#E1AD01] uppercase italic">
                    TEC: {tx.technician}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── TAB SCAN ── */}
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
                    <span className="bg-[#E1AD01] text-black px-3 py-1 rounded text-[8px] font-black uppercase">
                      Detectado
                    </span>
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
                <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
                  P/N no encontrado en inventario
                </p>
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
          MODAL — EDITAR
      ══════════════════════════════════════════════════════════════ */}
      {isEditOpen && targetPart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><Pencil className="h-4 w-4" /> Editar Repuesto</div>
              <button onClick={() => setIsEditOpen(false)} className="hover:rotate-90 transition-all text-black"><X className="h-5 w-5" /></button>
            </div>
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
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase ml-1">Cantidad *</label>
                  <input type="number" min="0" step="1" required
                    className={`${INPUT_CLS} text-2xl font-black`}
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
                className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl
                           disabled:opacity-40 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="animate-spin h-4 w-4" /> Guardando...</> : <><ShieldCheck className="h-4 w-4" /> Guardar Cambios</>}
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
                <p className="text-[9px] text-zinc-500 mt-1">
                  {targetPart.quantity} unid · {targetPart.location}
                </p>
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
    </div>
  );
};

export default InventoryPanel;
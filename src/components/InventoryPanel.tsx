import { useState, useEffect } from 'react';
import { SparePart, Vendor, HangarLocation } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient'; 
import { 
  Package, ArrowDownCircle, ArrowUpCircle, ScanLine, Plus, 
  X, MapPin, ClipboardList, Search, AlertCircle, FileText, 
  ShieldCheck, DollarSign, Calendar, Download, Loader2, Truck,
  History, Box
} from 'lucide-react';

interface InventoryPanelProps {
  parts: SparePart[];
  setParts: React.Dispatch<React.SetStateAction<SparePart[]>>;
  transactions: any[];
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  vendors: Vendor[];
}

// Mantenemos el export nombrado para compatibilidad futura
export const InventoryPanel = ({ parts, setParts, transactions, setTransactions, vendors }: InventoryPanelProps) => {
  const [activeTab, setActiveTab] = useState<'parts' | 'log' | 'scan'>('parts');
  const [locationFilter, setLocationFilter] = useState<'all' | HangarLocation>('all');
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<SparePart | "NOT_FOUND" | null>(null);

  const [newPart, setNewPart] = useState({
    name: '', 
    partNumber: '', 
    quantity: 0, 
    location: 'Lara' as HangarLocation, 
    unitPrice: 0,
    vendorId: '', 
    invoiceNumber: '',
    certificateNumber: ''
  });

  const filteredParts = locationFilter === 'all' 
    ? parts 
    : parts.filter(p => p.location === locationFilter);

  const filteredTransactions = locationFilter === 'all'
    ? transactions
    : transactions.filter(t => t.location === locationFilter);

  const handleScanSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const found = parts.find(p => p.partNumber.toUpperCase().trim() === scanInput.toUpperCase().trim());
    setScanResult(found || "NOT_FOUND");
  };

  const handleAddPart = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const dbEntry = {
      numero_parte: newPart.partNumber.toUpperCase(),
      nombre: newPart.name.toUpperCase(),
      cantidad: newPart.quantity,
      stock_minimo: 5,
      ubicacion_hangar: newPart.location,
      precio_unitario: newPart.unitPrice,
      certificado_numero: newPart.certificateNumber.toUpperCase(),
      factura_numero: newPart.invoiceNumber.toUpperCase(),
      vendor_id: newPart.vendorId 
    };

    const { data: partData, error: partError } = await supabase
      .from('inventario_repuestos')
      .insert([dbEntry])
      .select();

    if (partError) {
      alert("ERROR: " + partError.message);
    } else if (partData && partData.length > 0) {
      const [row]: any[] = partData;
      
      const partToAdd: SparePart = { 
        id: row.id,
        partNumber: row.numero_parte,
        name: row.nombre,
        quantity: row.cantidad,
        minStock: row.stock_minimo,
        location: row.ubicacion_hangar as HangarLocation,
        unitPrice: row.precio_unitario,
        category: 'Repuestos',
        certificateNumber: row.certificado_numero
      };
      
      setParts([partToAdd, ...parts]);

      await supabase.from('transacciones_inventario').insert([{
          tipo_movimiento: 'INBOUND',
          item_id: row.numero_parte,
          item_name: row.nombre,
          cantidad: row.cantidad,
          tecnico: "ADMIN_VALKYRON",
          ubicacion: row.ubicacion_hangar,
          notas: `FACTURA: ${row.factura_numero} | FORM 8130: ${row.certificado_numero}`
      }]);

      setIsModalOpen(false);
      setNewPart({ name: '', partNumber: '', quantity: 0, location: 'Lara', unitPrice: 0, vendorId: '', invoiceNumber: '', certificateNumber: '' });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0f0f0f] p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-3">
          <MapPin className="text-[#E1AD01] h-4 w-4" />
          <div className="flex bg-black rounded-xl p-1 border border-white/5">
            {(['all', 'Lara', 'Maturín'] as const).map((loc) => (
              <button key={loc} onClick={() => setLocationFilter(loc)}
                className={`px-5 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${locationFilter === loc ? 'bg-[#E1AD01] text-black shadow-lg' : 'text-slate-500 hover:text-white'}`}>
                {loc === 'all' ? 'Ver Todo' : loc}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-[#E1AD01] text-black px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
          <Plus className="h-4 w-4" /> Ingreso Certificado
        </button>
      </div>

      <div className="flex gap-4 border-b border-white/5">
        {[
          { id: 'parts', label: 'Existencias (WAC)', icon: Package },
          { id: 'log', label: 'Trazabilidad MRO', icon: ClipboardList },
          { id: 'scan', label: 'Terminal Scan', icon: ScanLine },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-4 text-[9px] font-black uppercase tracking-[0.2em] transition-all border-b-2 ${activeTab === tab.id ? 'border-[#E1AD01] text-[#E1AD01] bg-white/5' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[400px]">
        {activeTab === 'parts' && (
          <div className="bg-[#0a0a0a] rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
            <table className="w-full text-left font-mono">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.3em] text-slate-500 font-black bg-white/5 border-b border-white/10">
                  <th className="p-5">P/N - Componente</th>
                  <th className="p-5 text-center">Stock</th>
                  <th className="p-5">Costo Unit.</th>
                  <th className="p-5">Ubicación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {filteredParts.map((part) => (
                  <tr key={part.id} className="hover:bg-white/[0.02] transition-colors text-left">
                    <td className="p-5">
                      <span className="text-white block font-black uppercase">{part.name}</span>
                      <span className="text-[#E1AD01] text-[9px] font-bold uppercase tracking-widest">{part.partNumber}</span>
                    </td>
                    <td className="p-5 text-center">
                      <span className={`text-lg font-black ${part.quantity <= (part.minStock || 5) ? 'text-red-500 animate-pulse' : 'text-white'}`}>{part.quantity}</span>
                    </td>
                    <td className="p-5 text-white font-black">${part.unitPrice.toFixed(2)}</td>
                    <td className="p-5 text-slate-500 uppercase font-bold text-[9px]">{part.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'log' && (
          <div className="space-y-4">
            {filteredTransactions.map((tx, idx) => (
              <div key={idx} className="bg-[#0f0f0f] border border-white/10 p-5 rounded-2xl flex items-center justify-between text-left">
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

        {activeTab === 'scan' && (
          <div className="max-w-2xl mx-auto space-y-8 py-10 animate-in fade-in">
            <div className="text-center space-y-4">
              <ScanLine className="h-12 w-12 text-[#E1AD01] mx-auto animate-pulse" />
              <h2 className="text-[10px] font-black uppercase tracking-[0.5em]">Terminal de Despacho Inmediato</h2>
              <form onSubmit={handleScanSearch}>
                <input autoFocus className="w-full bg-black border-2 border-white/10 rounded-2xl p-6 text-center text-xl font-black tracking-widest text-[#E1AD01] outline-none focus:border-[#E1AD01]" placeholder="P/N O ESCANEE CÓDIGO" value={scanInput} onChange={(e) => setScanInput(e.target.value)} />
              </form>
            </div>
            {scanResult && scanResult !== "NOT_FOUND" && (
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
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><ShieldCheck className="h-4 w-4" /> Registro Valkyron</div>
              <button onClick={() => setIsModalOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAddPart} className="p-8 space-y-5 text-left font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Part Number</label>
                  <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs uppercase" onChange={e => setNewPart({...newPart, partNumber: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Nombre</label>
                  <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs uppercase" onChange={e => setNewPart({...newPart, name: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Ubicación</label>
                  <select className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-[10px]" onChange={e => setNewPart({...newPart, location: e.target.value as HangarLocation})}>
                    <option value="Lara">LARA</option>
                    <option value="Maturín">MATURÍN</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-500 uppercase ml-1">Proveedor</label>
                  <select required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-[10px]" onChange={e => setNewPart({...newPart, vendorId: e.target.value})}>
                    <option value="">SELECCIONAR...</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl">
                {loading ? "INYECTANDO..." : "AUTORIZAR INGRESO"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// LA LÍNEA DE ORO: Solución al SyntaxError del Index.tsx
export default InventoryPanel;
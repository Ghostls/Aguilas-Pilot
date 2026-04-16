import React, { useState, useMemo, useEffect } from 'react';
import { InventoryLog, SparePart } from '../Types/Maintenance'; 
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import { PlusCircle, X, ArrowRightLeft, AlertTriangle, Database, Search, CheckCircle2, Loader2 } from 'lucide-react';

interface InventoryCheckoutProps {
  parts?: SparePart[];
  onCheckoutSuccess?: (partNumber: string, quantity: number, aircraftId: string) => void;
  selectedAircraft?: string;
}

export const InventoryCheckout: React.FC<InventoryCheckoutProps> = ({ 
  parts = [], 
  onCheckoutSuccess,
  selectedAircraft 
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [history, setHistory] = useState<InventoryLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<string>('Operador Sistema');

  // Sincronización Real con el Estado Maestro
  const activeInventory = useMemo(() => {
    return parts.map(p => ({
      id: p.id,
      pn: p.partNumber.toUpperCase(),
      sn: p.id?.toString().slice(0, 8).toUpperCase() || 'N/A', 
      stock: p.quantity,
      desc: p.name,
      minStock: p.minStock || 5,
      location: p.location
    }));
  }, [parts]);

  const [formData, setFormData] = useState({
    partNumber: '',
    description: '',
    quantity: 1,
    assignedAircraft: selectedAircraft || '', 
    location: 'Lara'
  });

  useEffect(() => {
    const fetchSessionAndHistory = async () => {
      // 1. Identificar al operador activo
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from('perfiles').select('nombre_completo').eq('id', user.id).single();
        if (prof) setCurrentUser(prof.nombre_completo);
      }

      // 2. Cargar historial de egresos desde Supabase
      const { data, error: histError } = await supabase
        .from('transacciones_inventario')
        .select('*')
        .eq('tipo_movimiento', 'OUTBOUND')
        .order('fecha', { ascending: false })
        .limit(10);
      
      if (!histError && data) {
        setHistory(data.map((t: any) => ({
          id: t.id,
          partNumber: t.item_id,
          description: t.item_name,
          quantity: t.cantidad,
          assignedAircraft: t.notas?.includes(': ') ? t.notas.split(': ')[1].split('.')[0] : 'S/N',
          dispatchedBy: t.tecnico,
          timestamp: new Date(t.fecha),
          location: t.ubicacion,
          serialNumberOut: t.item_id?.slice(0,8) || 'N/A'
        })));
      }
    };
    fetchSessionAndHistory();
  }, [selectedAircraft]);

  const sugerencias = useMemo(() => {
    if (!searchTerm || formData.partNumber) return [];
    const term = searchTerm.toLowerCase();
    return activeInventory.filter(item => 
      item.desc.toLowerCase().includes(term) || 
      item.pn.toLowerCase().includes(term)
    );
  }, [searchTerm, activeInventory, formData.partNumber]);

  const handleSelectItem = (item: any) => {
    setFormData({
      ...formData,
      partNumber: item.pn,
      description: item.desc,
      location: item.location
    });
    setSearchTerm(item.desc);
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const normalizedPN = formData.partNumber.toUpperCase();
    const targetItem = activeInventory.find(item => item.pn === normalizedPN);

    if (!targetItem || formData.quantity > targetItem.stock) {
      setError(`ALERTA: Stock insuficiente o P/N [${normalizedPN}] no localizado.`);
      setLoading(false);
      return;
    }

    try {
      // 1. ACTUALIZACIÓN EN DB (REGLA DE ORO)
      const { error: updateError } = await supabase
        .from('inventario_repuestos')
        .update({ cantidad: targetItem.stock - formData.quantity })
        .eq('numero_parte', normalizedPN);

      if (updateError) throw updateError;

      // 2. REGISTRO DE AUDITORÍA
      const { data: txData, error: txError } = await supabase
        .from('transacciones_inventario')
        .insert([{
          tipo_movimiento: 'OUTBOUND',
          item_id: normalizedPN,
          item_name: formData.description,
          cantidad: formData.quantity,
          tecnico: currentUser,
          ubicacion: targetItem.location,
          notas: `Despacho para Aeronave: ${formData.assignedAircraft}.`
        }])
        .select();

      if (txError) throw txError;

      // 3. SINCRONIZACIÓN CON EL INDEX (CEREBRO)
      if (onCheckoutSuccess) {
        onCheckoutSuccess(normalizedPN, formData.quantity, formData.assignedAircraft);
      }

      const [newRow] = txData as any[];
      setHistory(prev => [{
        id: newRow.id,
        partNumber: normalizedPN,
        description: formData.description,
        quantity: formData.quantity,
        assignedAircraft: formData.assignedAircraft,
        dispatchedBy: currentUser,
        timestamp: new Date(newRow.fecha),
        location: targetItem.location, 
        serialNumberOut: normalizedPN.slice(0,8)
      }, ...prev]);

      setIsAdding(false);
      setSearchTerm('');
      setFormData(prev => ({ ...prev, partNumber: '', description: '', quantity: 1 }));

    } catch (err: any) {
      setError(`FALLA DE CONEXIÓN: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {activeInventory.slice(0, 3).map((item) => (
          <div key={item.pn} className={`p-5 rounded-2xl border backdrop-blur-xl transition-all ${item.stock <= item.minStock ? 'bg-red-500/10 border-red-500/30' : 'bg-[#0f0f0f] border-white/5 shadow-xl'}`}>
            <div className="flex justify-between items-start">
              <span className="text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.2em]">{item.pn}</span>
              {item.stock <= item.minStock && <AlertTriangle className="h-3 w-3 text-red-500 animate-pulse" />}
            </div>
            <div className="flex items-end gap-2 mt-2">
              <p className="text-3xl font-black text-white font-mono leading-none">{item.stock}</p>
              <p className="text-[8px] text-slate-500 font-black mb-1 uppercase">Units</p>
            </div>
            <p className="text-[9px] text-slate-500 uppercase mt-3 truncate font-mono">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.4em] italic text-left">
            <Database className="h-4 w-4 text-[#E1AD01]" /> Logística de Despacho Técnico
        </h2>
        <button onClick={() => setIsAdding(true)} className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] hover:bg-white transition-all shadow-xl active:scale-95 uppercase tracking-widest flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Generar Salida
        </button>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <Card className="bg-[#050505] border border-white/10 w-full max-w-lg rounded-[2rem] overflow-hidden shadow-2xl">
            <CardHeader className="bg-white/[0.02] border-b border-white/5 p-6 flex flex-row items-center justify-between">
              <CardTitle className="text-[#E1AD01] text-[10px] font-black tracking-[0.4em] uppercase flex items-center gap-3">
                <Search className="h-4 w-4" /> Formulario de Egreso Aeronáutico
              </CardTitle>
              <button onClick={() => setIsAdding(false)} className="text-slate-500 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </CardHeader>
            <CardContent className="p-8">
              <form onSubmit={handleCheckout} className="space-y-6">
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <p className="text-[9px] text-red-500 font-black uppercase">{error}</p>
                  </div>
                )}
                <div className="relative">
                  <input 
                    type="text" required
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-white outline-none focus:border-[#E1AD01] uppercase text-xs"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      if(formData.partNumber) setFormData({...formData, partNumber: '', description: ''});
                    }}
                    placeholder="BUSCAR COMPONENTE..."
                  />
                  {sugerencias.length > 0 && (
                    <div className="absolute w-full mt-2 bg-[#0a0a0a] border border-white/10 rounded-xl shadow-2xl z-[110] max-h-48 overflow-y-auto">
                      {sugerencias.map((item) => (
                        <div key={item.pn} onClick={() => handleSelectItem(item)} className="p-4 hover:bg-[#E1AD01] hover:text-black cursor-pointer text-left border-b border-white/5 last:border-0">
                          <p className="text-[10px] font-black uppercase">{item.desc}</p>
                          <p className="text-[8px] opacity-60">P/N: {item.pn} | STOCK: {item.stock}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                      <label className="text-[8px] text-slate-600 font-black uppercase ml-1">Cant.</label>
                      <input type="number" min="1" className="w-full bg-black border border-white/10 p-4 rounded-xl text-white font-black text-xs outline-none" value={formData.quantity} onChange={e => setFormData({...formData, quantity: parseInt(e.target.value) || 1})} />
                   </div>
                   <div className="space-y-1">
                      <label className="text-[8px] text-slate-600 font-black uppercase ml-1">Unidad Destino</label>
                      <select required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white outline-none text-[10px] font-black uppercase" value={formData.assignedAircraft} onChange={e => setFormData({...formData, assignedAircraft: e.target.value})}>
                        <option value="">AERONAVE...</option>
                        <option value="YV-2841">YV-2841</option>
                        <option value="YV-1503">YV-1503</option>
                        <option value="YV-3127">YV-3127</option>
                      </select>
                   </div>
                </div>
                <button type="submit" disabled={!formData.partNumber || loading} className="w-full font-black py-5 rounded-2xl bg-[#E1AD01] text-black hover:bg-white transition-all uppercase text-[10px] tracking-[0.4em]">
                  {loading ? "PROCESANDO..." : "AUTORIZAR DESPACHO"}
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-[10px] font-black text-slate-500 mb-6 flex items-center gap-3 uppercase tracking-[0.5em] italic">
          Auditoría de Movimientos — Base de Datos Central
        </h2>
        <div className="space-y-3">
          {history.length > 0 ? history.map((entry) => (
            <div key={entry.id} className="bg-[#0f0f0f] p-6 rounded-2xl border border-white/5 flex justify-between items-center border-l-4 border-l-[#E1AD01]">
              <div className="flex items-center gap-5">
                <ArrowRightLeft className="h-5 w-5 text-[#E1AD01]" />
                <div className="font-mono text-left">
                  <p className="font-black text-white text-xs uppercase">{entry.partNumber} <span className="text-[#E1AD01] mx-2">→</span> {entry.assignedAircraft}</p>
                  <p className="text-[8px] text-slate-500 mt-1 uppercase font-bold">{entry.description} | POR: {entry.dispatchedBy}</p>
                </div>
              </div>
              <span className="text-[8px] border border-green-500/20 bg-green-500/5 px-3 py-1 rounded-full text-green-500 font-black tracking-widest uppercase italic">VERIFICADO</span>
            </div>
          )) : (
            <div className="p-20 text-center border-2 border-dashed border-white/5 rounded-[2rem]">
              <p className="text-slate-700 font-mono text-[10px] font-black uppercase tracking-[0.5em]">Esperando Transacciones...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
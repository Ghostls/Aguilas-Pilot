// src/components/FuelPanel.tsx
// Evolución Grado Militar - Valkyron OS (Sistema de Tabla Única)
import React, { useState, useEffect, useCallback } from 'react';
import { Vendor, HangarLocation } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient'; 
import { PlusCircle, X, History, Loader2, Warehouse, Plane, ShieldCheck } from 'lucide-react';

interface FuelPanelProps {
  fleet?: any[];
  vendors?: Vendor[];
}

export const FuelPanel: React.FC<FuelPanelProps> = ({ fleet = [], vendors = [] }) => {
  const [activeMode, setActiveMode] = useState<'AIRCRAFT' | 'HANGAR'>('AIRCRAFT');
  const [isAdding, setIsAdding] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [stockStatus, setStockStatus] = useState({ lara: 0, maturin: 0 });
  const [loading, setLoading] = useState(false);
  
  const fuelVendors = vendors.filter(v => v.category.includes('Consumibles') || v.category.includes('Servicios Técnicos'));

  const [newRecord, setNewRecord] = useState({
    aircraftId: '',
    gallons: 0,
    fuelType: 'AVGAS 100LL',
    location: 'Lara' as HangarLocation,
    vendorId: '',
    ticketNumber: '',
    technician: '',
    hobbsAtCharge: 0
  });

  const fetchGlobalFuelData = useCallback(async () => {
    try {
      const { data: allLogs, error } = await supabase.from('registros_combustible').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      if (allLogs) {
        const calculateStock = (loc: string) => {
          return allLogs
            .filter(r => r.location?.toLowerCase() === loc.toLowerCase())
            .reduce((acc, curr) => curr.operation_type === 'IN' ? acc + Number(curr.gallons) : acc - Number(curr.gallons), 0);
        };

        setStockStatus({ lara: calculateStock('lara'), maturin: calculateStock('maturín') });
        setRecords(allLogs.slice(0, 15));
      }
    } catch (err) { console.error("ERROR TELEMETRÍA:", err); }
  }, []);

  useEffect(() => { fetchGlobalFuelData(); }, [fetchGlobalFuelData]);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const dbEntry = {
      operation_type: activeMode === 'HANGAR' ? 'IN' : 'OUT',
      aircraft_id: activeMode === 'AIRCRAFT' ? newRecord.aircraftId.toUpperCase() : 'STOCK_HANGAR',
      gallons: Number(newRecord.gallons),
      fuel_type: String(newRecord.fuelType),
      location: String(newRecord.location),
      vendor_id: newRecord.vendorId || null,
      ticket_number: String(newRecord.ticketNumber).toUpperCase(),
      technician: String(newRecord.technician).toUpperCase(),
      hobbs_at_charge: activeMode === 'AIRCRAFT' ? Number(newRecord.hobbsAtCharge) : null
    };

    const { error } = await supabase.from('registros_combustible').insert([dbEntry]);

    if (error) {
      alert(`FALLA TÁCTICA: ${error.message}`);
      console.error(error);
    } else {
      await fetchGlobalFuelData();
      setIsAdding(false);
      setNewRecord({ ...newRecord, aircraftId: '', gallons: 0, ticketNumber: '', technician: '', hobbsAtCharge: 0 });
      alert(`[VALKYRON OPS] Movimiento ${activeMode} certificado.`);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 p-6 rounded-3xl">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-2">Tanque Lara</p>
          <div className="flex items-end gap-2"><h3 className="text-4xl font-black text-[#E1AD01] font-mono">{stockStatus.lara.toFixed(1)}</h3><span className="text-[10px] text-[#E1AD01]/40 font-black">GAL</span></div>
          <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-[#E1AD01]" style={{ width: `${Math.min((stockStatus.lara/3000)*100, 100)}%` }}></div></div>
        </div>
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 p-6 rounded-3xl">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-2">Tanque Maturín</p>
          <div className="flex items-end gap-2"><h3 className="text-4xl font-black text-[#E1AD01] font-mono">{stockStatus.maturin.toFixed(1)}</h3><span className="text-[10px] text-[#E1AD01]/40 font-black">GAL</span></div>
          <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-[#E1AD01]" style={{ width: `${Math.min((stockStatus.maturin/3000)*100, 100)}%` }}></div></div>
        </div>
        <div className="grid grid-cols-1 gap-2">
            <button onClick={() => { setActiveMode('HANGAR'); setIsAdding(true); }} className="bg-white/5 hover:bg-[#E1AD01]/10 text-white p-4 rounded-2xl border border-white/10 flex items-center gap-4 transition-all">
                <Warehouse className="h-5 w-5 text-[#E1AD01]" />
                <span className="text-[9px] font-black uppercase tracking-widest">Entrada Stock</span>
            </button>
            <button onClick={() => { setActiveMode('AIRCRAFT'); setIsAdding(true); }} className="bg-[#E1AD01] hover:bg-white text-black p-4 rounded-2xl flex items-center gap-4 transition-all">
                <Plane className="h-5 w-5" />
                <span className="text-[9px] font-black tracking-widest italic uppercase">Despacho Avión</span>
            </button>
        </div>
      </div>

      <div className="bg-[#050505] border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/5 bg-white/[0.01] flex justify-between items-center">
          <h3 className="text-white font-black text-[10px] uppercase tracking-[0.4em] italic flex items-center gap-2">
            <History className="h-4 w-4 text-[#E1AD01]" /> Bitácora de Suministro Unificada
          </h3>
        </div>
        <table className="w-full font-mono text-left text-[10px]">
          <thead className="text-slate-600 uppercase tracking-widest bg-white/[0.02] border-b border-white/5">
            <tr><th className="p-5">Unidad</th><th className="p-5">Cant.</th><th className="p-5">Sede</th><th className="p-5 text-right">Firma</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {records.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.01] transition-colors">
                <td className="p-5 font-black uppercase text-white">
                  <span className={r.operation_type === 'IN' ? 'text-green-500 mr-2' : 'text-[#E1AD01] mr-2'}>{r.operation_type === 'IN' ? '▲' : '▼'}</span>
                  {r.aircraft_id} <span className="block text-[7px] text-slate-500 font-normal">Ticket: {r.ticket_number}</span>
                </td>
                <td className={`p-5 font-black ${r.operation_type === 'IN' ? 'text-green-500' : 'text-[#E1AD01]'}`}>{r.operation_type === 'IN' ? '+' : '-'}{r.gallons} GAL</td>
                <td className="p-5 text-slate-400 font-bold uppercase">{r.location}</td>
                <td className="p-5 text-right text-slate-600 italic uppercase font-black">{r.technician}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <Card className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-xl shadow-2xl rounded-[2.5rem] overflow-hidden">
            <CardHeader className="bg-[#E1AD01] p-6 flex justify-between items-center text-black">
              <CardTitle className="text-[11px] font-black uppercase tracking-[0.4em] italic flex items-center gap-2">
                {activeMode === 'HANGAR' ? <Warehouse className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
                {activeMode === 'HANGAR' ? 'ORDEN DE RECEPCIÓN' : 'ORDEN DE DESPACHO'}
              </CardTitle>
              <button onClick={() => setIsAdding(false)} className="text-black hover:rotate-90 transition-all"><X className="h-6 w-6" /></button>
            </CardHeader>
            <CardContent className="p-10 text-white">
              <form onSubmit={handleAction} className="space-y-6 font-mono">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                      <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block">Objetivo</label>
                      {activeMode === 'AIRCRAFT' ? (
                        <select required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase" onChange={e => setNewRecord({...newRecord, aircraftId: e.target.value})}>
                            <option value="">-- SELECCIONAR --</option>
                            {fleet.map(a => <option key={a.id} value={a.tailNumber}>{a.tailNumber}</option>)}
                        </select>
                      ) : (
                        <select required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase" onChange={e => setNewRecord({...newRecord, vendorId: e.target.value})}>
                            <option value="">-- PROVEEDOR --</option>
                            {fuelVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      )}
                  </div>
                  <div className="space-y-2"><label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Energía</label>
                    <select className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none" onChange={e => setNewRecord({...newRecord, fuelType: e.target.value})}>
                      <option value="AVGAS 100LL">AVGAS 100LL</option><option value="JET-A1">JET-A1</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2"><label className="text-[9px] text-white font-black uppercase tracking-widest block">Volumen (GAL)</label>
                    <input type="number" step="0.1" required className="w-full bg-black border border-white/10 p-4 text-3xl font-black text-white outline-none focus:border-[#E1AD01]" onChange={e => setNewRecord({...newRecord, gallons: parseFloat(e.target.value)})} />
                  </div>
                  <div className="space-y-2"><label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Ticket #</label>
                    <input required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none uppercase" onChange={e => setNewRecord({...newRecord, ticketNumber: e.target.value})} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2"><label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Sede</label>
                    <select className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none" onChange={e => setNewRecord({...newRecord, location: e.target.value as any})}>
                      <option value="Lara">Lara</option><option value="Maturín">Maturín</option>
                    </select>
                  </div>
                  <div className="space-y-2"><label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Auditor</label>
                    <input required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none uppercase" value={newRecord.technician} onChange={e => setNewRecord({...newRecord, technician: e.target.value})} />
                  </div>
                </div>
                {activeMode === 'AIRCRAFT' && (
                  <div className="space-y-2"><label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Hobbs</label>
                    <input type="number" step="0.1" className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-[10px] outline-none" onChange={e => setNewRecord({...newRecord, hobbsAtCharge: parseFloat(e.target.value)})} />
                  </div>
                )}
                <button type="submit" disabled={loading} className="w-full bg-[#E1AD01] text-black font-black py-6 rounded-3xl mt-6 uppercase text-[11px] tracking-[0.5em] shadow-2xl flex items-center justify-center gap-3">
                   {loading ? <Loader2 className="animate-spin h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                   {loading ? "SINCRO..." : "CERTIFICAR MOVIMIENTO"}
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
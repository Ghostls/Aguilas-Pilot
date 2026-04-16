// src/components/FleetDashboard.tsx
// Evolución Grado Militar - Valkyron OS (Fix Real-Time Type Error & Normalization)
// REGLA DE ORO: CERO OMISIONES.
import React, { useState, useEffect } from 'react';
import { Aircraft, HangarLocation } from '@/Types/Maintenance';
import AircraftCard from './AircraftCard'; 
import AircraftDetail from './AircraftDetail';
import { supabase } from '../lib/supabaseClient'; 
import { 
  Plane, Plus, X, Gauge, ShieldCheck, Loader2 
} from 'lucide-react';

// --- MOTOR DE NORMALIZACIÓN DE ESTADOS (GRADO MILITAR) ---
const normalizeAircraftStatus = (rawStatus: string): 'operational' | 'maintenance' | 'grounded' | 'flight' => {
  if (!rawStatus) return 'operational';
  const s = rawStatus.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight')) return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  if (s.includes('operativa') || s.includes('operational')) return 'operational';
  return 'operational'; // Por defecto Operativa
};

const FleetDashboard = ({ fleetData, setFleetData }: { fleetData: Aircraft[], setFleetData: any }) => {
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // SUSCRIPCIÓN TÁCTICA CORREGIDA (TYPE-SAFE)
  useEffect(() => {
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes' as any, // Bypass de sobrecarga para compatibilidad de SDK
        {
          event: '*',
          schema: 'public',
          table: 'flota_aviones',
        },
        (payload: any) => {
          const updatedRow = payload.new;
          
          setFleetData((currentFleet: Aircraft[]) => {
            if (payload.eventType === 'INSERT') {
              const mappedNew: Aircraft = {
                id: updatedRow.id,
                tailNumber: updatedRow.matricula,
                model: updatedRow.modelo,
                status: normalizeAircraftStatus(updatedRow.estado),
                location: updatedRow.sede || 'LARA',
                hours_vuelo_totales: updatedRow.horas_vuelo_totales,
                components: updatedRow.componentes || []
              };
              // Evitar duplicados si el insert manual ya ocurrió
              const exists = currentFleet.some(ac => ac.id === mappedNew.id);
              return exists ? currentFleet : [...currentFleet, mappedNew];
            }
            
            if (payload.eventType === 'UPDATE') {
              return currentFleet.map(ac => 
                ac.id === updatedRow.id 
                  ? { 
                      ...ac, 
                      status: normalizeAircraftStatus(updatedRow.estado), 
                      hours_vuelo_totales: updatedRow.horas_vuelo_totales,
                      location: updatedRow.sede || ac.location
                    } 
                  : ac
              );
            }

            if (payload.eventType === 'DELETE') {
              return currentFleet.filter(ac => ac.id !== payload.old.id);
            }
            
            return currentFleet;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [setFleetData]);

  const [newAircraft, setNewAircraft] = useState({ 
    tailNumber: '', 
    model: '', 
    totalHours: 0, 
    status: 'operational' as const,
    sede: 'LARA' as 'LARA' | 'MATURIN'
  });

  const handleRegisterAircraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const aircraftToAdd = {
      matricula: newAircraft.tailNumber.toUpperCase(),
      modelo: newAircraft.model.toUpperCase(),
      estado: newAircraft.status, // Enviamos el estado crudo, el mapeo lo arregla en la lectura de la DB
      horas_vuelo_totales: newAircraft.totalHours,
      sede: newAircraft.sede
    };

    const { error } = await supabase
      .from('flota_aviones')
      .insert([aircraftToAdd]);

    if (!error) {
      setIsModalOpen(false);
      setNewAircraft({ tailNumber: '', model: '', totalHours: 0, status: 'operational', sede: 'LARA' });
    } else {
      alert("ERROR TÁCTICO: " + error.message);
    }
    setLoading(false);
  };

  if (selectedAircraft) return <AircraftDetail aircraft={selectedAircraft} onBack={() => setSelectedAircraft(null)} />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">
      <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
            <Gauge className="text-[#E1AD01] h-5 w-5" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 font-mono">Telemetría de Flota en Vivo</span>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="bg-[#E1AD01] text-black px-6 py-2.5 rounded-lg font-black text-xs hover:bg-white transition-all flex items-center gap-2 uppercase tracking-widest shadow-lg">
          <Plus className="h-4 w-4" /> Registrar Aeronave
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {fleetData.map((ac) => (
            <AircraftCard key={ac.id} aircraft={ac} onSelect={setSelectedAircraft} />
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="p-6 bg-[#E1AD01] flex justify-between items-center text-black font-black">
              <h3 className="uppercase text-[10px] tracking-[0.4em] italic flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Registro Multi-Sede
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:rotate-90 transition-all"><X className="h-6 w-6" /></button>
            </div>

            <form onSubmit={handleRegisterAircraft} className="p-10 space-y-6 font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Matrícula</label>
                  <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:border-[#E1AD01] outline-none uppercase text-xs" onChange={e => setNewAircraft({...newAircraft, tailNumber: e.target.value})} placeholder="YV-XXXX" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Sede Operativa</label>
                  <select 
                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-[10px] outline-none focus:border-[#E1AD01]"
                    value={newAircraft.sede}
                    onChange={e => setNewAircraft({...newAircraft, sede: e.target.value as any})}
                  >
                    <option value="LARA">BASE LARA</option>
                    <option value="MATURIN">BASE MATURÍN</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Modelo / Aeronave</label>
                <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:border-[#E1AD01] outline-none text-xs uppercase" onChange={e => setNewAircraft({...newAircraft, model: e.target.value})} placeholder="CESSNA" />
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Estatus Inicial</label>
                <select 
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-[10px] font-black outline-none focus:border-[#E1AD01]"
                  value={newAircraft.status}
                  onChange={e => setNewAircraft({...newAircraft, status: e.target.value as any})}
                >
                  <option value="operational">OPERATIVA</option>
                  <option value="maintenance">EN MANTENIMIENTO</option>
                  <option value="grounded">EN TIERRA (AOG)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Horas Totales (TT)</label>
                <input type="number" step="0.1" required className="w-full bg-black border border-white/10 rounded-xl p-5 text-white focus:border-[#E1AD01] outline-none text-4xl font-black text-center" onChange={e => setNewAircraft({...newAircraft, totalHours: parseFloat(e.target.value)})} placeholder="0.0" />
              </div>

              <button type="submit" disabled={loading} className="w-full bg-[#E1AD01] text-black py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl mt-4 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "DESPLEGAR UNIDAD"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FleetDashboard;
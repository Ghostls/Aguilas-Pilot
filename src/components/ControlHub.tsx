// src/components/ControlHub.tsx
// Terminal de Operaciones Hangar - VALKYRON OS v4.6
// Evolución: Fix Export Nominal y Sincronización Inmediata de Flota (Mantenimiento/Operativo)
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.
import React, { useState, useEffect } from 'react';
import { SparePart } from '../Types/Maintenance'; 
import { Card, CardHeader, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient'; 
import { 
  PlusCircle, X, Wrench, AlertCircle, 
  PackageCheck, Loader2 
} from 'lucide-react';

interface ControlHubProps {
  tasks?: any[];
  setTasks?: React.Dispatch<React.SetStateAction<any[]>>;
  fleet?: any[];
  setFleet?: React.Dispatch<React.SetStateAction<any[]>>; 
  inventory?: SparePart[];
  onPartsUsage?: (partsUsed: {pn: string, qty: number}[], aircraftId: string) => void;
}

// FIX QUIRÚRGICO: Exportación nominal para compatibilidad con App.tsx
export const ControlHub: React.FC<ControlHubProps> = ({ 
  tasks: externalTasks = [], 
  setTasks: setExternalTasks = () => {},
  fleet = [],
  setFleet = () => {}, // Agregado para actualizar la flota en tiempo real localmente
  inventory = []
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [newTask, setNewTask] = useState({
    matricula: '',
    descripcion: '',
    sede: 'Lara' as 'Lara' | 'Maturín',
    mecanico: ''
  });

  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*')
        .neq('estado', 'Completed')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setExternalTasks(data);
      }
    };
    fetchOrders();
  }, [setExternalTasks]);

  const activeTasks = externalTasks.filter(t => t.estado !== 'Completed');

  // --- QUIRÚRGICO: DISPARADOR DE CAMBIO DE ESTATUS (MAINTENANCE) ---
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    const matriculaUpper = newTask.matricula.toUpperCase();
    const targetAircraft = fleet.find(ac => ac.tailNumber === matriculaUpper);
    const modeloDetectado = targetAircraft?.model || "MODELO NO DETECTADO";

    const dbEntry = {
      matricula: matriculaUpper,
      modelo: modeloDetectado,
      descripcion_tarea: newTask.descripcion,
      sede: newTask.sede, 
      nombre_mecanico: newTask.mecanico || "POR ASIGNAR",
      estado: 'In Progress',
      observaciones: `REGISTRO GENERADO POR VALKYRON TERMINAL.`
    };

    // 1. Insertar la orden de trabajo
    const { data, error } = await supabase.from('ordenes_trabajo').insert([dbEntry]).select();

    if (!error && data) {
      // 2. EVOLUCIÓN: Cambiar estado del avión a mantenimiento (Actualiza la Base de Datos)
      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'maintenance' }) 
        .eq('matricula', matriculaUpper);

      if (fleetError) {
        console.error("FALLA CAMBIO ESTATUS FLOTA:", fleetError);
      } else {
        // 3. EVOLUCIÓN: Actualizar el estado local de la flota para reflejo inmediato
        setFleet(prevFleet => 
          prevFleet.map(ac => 
            ac.tailNumber === matriculaUpper ? { ...ac, status: 'maintenance' } : ac
          )
        );
      }

      setExternalTasks([data[0], ...externalTasks]);
      setIsAdding(false);
      setNewTask({ matricula: '', descripcion: '', sede: 'Lara', mecanico: '' });
      alert(`[OPERACIÓN] ${matriculaUpper} EN MANTENIMIENTO. FLOTA ACTUALIZADA.`);
    } else {
      console.error("ERROR DB:", error);
      alert(`FALLA TÁCTICA: ${error?.message}`);
    }
    setLoading(false);
  };

  // --- QUIRÚRGICO: DISPARADOR DE LIBERACIÓN (OPERATIONAL) ---
  const handleFinalCertification = async (task: any) => {
    try {
      // 1. Cerrar la orden de trabajo
      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({ 
          estado: 'Completed', 
          fecha_cierre: new Date().toISOString()
        })
        .eq('id', task.id);

      if (error) throw error;

      // 2. EVOLUCIÓN: Devolver avión a estado Operativo (Base de Datos)
      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'operational' })
        .eq('matricula', task.matricula);

      if (fleetError) {
        console.error("FALLA LIBERACIÓN FLOTA:", fleetError);
      } else {
        // 3. EVOLUCIÓN: Actualizar estado local inmediatamente
        setFleet(prevFleet => 
          prevFleet.map(ac => 
            ac.tailNumber === task.matricula ? { ...ac, status: 'operational' } : ac
          )
        );
      }

      setExternalTasks(prev => prev.filter(t => t.id !== task.id));
      alert(`[CERTIFICADO] ${task.matricula} LIBERADA Y OPERATIVA.`);
    } catch (err: any) {
      alert(`ERROR: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">
      <div className="flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/10 backdrop-blur-md text-left">
        <div className="flex items-center gap-3">
          <Wrench className="h-5 w-5 text-[#E1AD01]" />
          <div className="text-left">
            <h2 className="text-white font-black text-xs uppercase tracking-[0.3em]">Hangar Operations Hub</h2>
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-tighter italic">MIA v2.6 // Sincronización Nuclear</p>
          </div>
        </div>
        <button onClick={() => setIsAdding(true)} className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] hover:bg-white transition-all uppercase tracking-widest shadow-xl flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Abrir Tarjeta
        </button>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs tracking-widest">
              <span>Registrar Intervención</span>
              <button onClick={() => setIsAdding(false)}><X className="h-6 w-6" /></button>
            </div>
            <form onSubmit={handleAddTask} className="p-8 space-y-5 text-left">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">Unidad</label>
                  <select required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-xs outline-none" value={newTask.matricula} onChange={e => setNewTask({...newTask, matricula: e.target.value})}>
                    <option value="">---</option>
                    {fleet.map(ac => <option key={ac.id} value={ac.tailNumber}>{ac.tailNumber}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">Sede</label>
                  <select className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-xs outline-none" value={newTask.sede} onChange={e => setNewTask({...newTask, sede: e.target.value as any})}>
                    <option value="Lara">Lara</option>
                    <option value="Maturín">Maturín</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">Descripción Técnica</label>
                <textarea required className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-xs h-24 resize-none outline-none" value={newTask.descripcion} onChange={e => setNewTask({...newTask, descripcion: e.target.value})} placeholder="Detalle técnico de la intervención..." />
              </div>
              <button type="submit" disabled={loading} className="w-full bg-[#E1AD01] text-black font-black py-5 rounded-2xl uppercase text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl">
                {loading ? <Loader2 className="animate-spin mx-auto h-4 w-4" /> : "Certificar Apertura"}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeTasks.map((task) => (
          <Card key={task.id} className="bg-[#0f0f0f] border border-white/10 shadow-2xl transition-all relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#E1AD01] shadow-[0_0_15px_#E1AD01]"></div>
            <CardHeader className="border-b border-white/5 pb-4">
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="font-black text-white text-2xl font-mono uppercase">{task.matricula}</span>
                  <span className="text-[9px] text-[#E1AD01] font-black uppercase italic tracking-widest">{task.modelo}</span>
                </div>
                <span className="text-[8px] px-2 py-0.5 rounded border border-[#E1AD01]/20 text-[#E1AD01] font-black uppercase">{task.estado}</span>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-4 text-left font-mono">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 text-slate-600 mt-0.5" />
                <p className="text-[10px] text-slate-300 uppercase leading-relaxed">{task.descripcion_tarea}</p>
              </div>
              <div className="border-t border-white/5 pt-4">
                <div className="text-[9px] text-slate-500 uppercase mb-4 font-black tracking-widest">Base: {task.sede}</div>
                <button onClick={() => handleFinalCertification(task)} className="w-full bg-[#E1AD01] text-black font-black py-4 rounded-xl hover:bg-white transition-all text-[10px] tracking-[0.2em] flex items-center justify-center gap-2">
                  <PackageCheck className="h-4 w-4" /> Finalizar Misión
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
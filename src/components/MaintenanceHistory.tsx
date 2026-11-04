// src/components/MaintenanceHistory.tsx
// Valkyron OS — Historial MRO existente + acceso al archivo histórico completo de la OMA.
import React, { useState } from 'react';
import type { WorkOrder } from '../Types/Maintenance';
import { Archive, ClipboardCheck, MapPin, User, Clock, Box, ShieldCheck, Plane, ArrowLeft } from 'lucide-react';
import AircraftArchive from './AircraftArchive';

interface MaintenanceHistoryProps {
  completedTasks: WorkOrder[];
}

export const MaintenanceHistory: React.FC<MaintenanceHistoryProps> = ({ completedTasks }) => {
  const [showArchive, setShowArchive] = useState(false);

  if (showArchive) return <div className="mt-12 animate-in fade-in duration-300">
    <button type="button" onClick={() => setShowArchive(false)}
      className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs uppercase font-black text-white hover:border-[#E1AD01]/40">
      <ArrowLeft size={14}/> Volver a las órdenes finalizadas
    </button>
    <AircraftArchive />
  </div>;

  return <div className="mt-12 space-y-6 animate-in fade-in duration-1000 text-left">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h2 className="text-sm font-black text-white flex items-center gap-2 uppercase tracking-[0.2em] md:tracking-[0.4em]">
        <span className="w-1.5 h-6 bg-[#E1AD01] rounded-full shadow-[0_0_15px_#E1AD01]"/>
        Archivo Maestro de Mantenimiento (MRO LOG)
      </h2>
      <button type="button" onClick={() => setShowArchive(true)}
        className="flex items-center gap-2 rounded-xl border border-[#E1AD01]/30 bg-[#E1AD01]/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-[#E1AD01] hover:bg-[#E1AD01] hover:text-black transition-colors">
        <Archive size={15}/> Archivo histórico completo OMA
      </button>
    </div>
    <div className="rounded-2xl border border-white/10 bg-[#0a0a0a]/50 backdrop-blur-md overflow-hidden shadow-2xl">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse font-sans">
        <thead><tr className="bg-white/5 border-b border-white/10 text-[9px] uppercase font-black tracking-widest text-slate-500">
          <th className="px-6 py-5">Unidad / Sede</th><th className="px-6 py-5">Intervención Técnica</th>
          <th className="px-6 py-5">Materiales & Auditoría</th><th className="px-6 py-5">Técnico registrado</th>
          <th className="px-6 py-5 text-right">Estado en el histórico</th>
        </tr></thead>
        <tbody className="divide-y divide-white/5 text-xs text-slate-300 font-mono">
          {completedTasks.length === 0 ? <tr><td colSpan={5} className="px-6 py-24 text-center text-slate-500 font-black uppercase tracking-wider">No hay órdenes finalizadas en este listado. Consulta el archivo histórico de la OMA.</td></tr> :
            completedTasks.map(task => <tr key={task.id} className="hover:bg-white/[0.02] transition-all group">
              <td className="px-6 py-6"><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><Plane className="h-3 w-3 text-[#E1AD01]"/><span className="text-[#E1AD01] font-black text-sm tracking-tighter italic uppercase">{task.aircraftId}</span></div>
                <div className="flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-tighter"><MapPin className="h-2.5 w-2.5"/>BASE {task.location}</div></div></td>
              <td className="px-6 py-6 max-w-xs"><p className="text-slate-200 uppercase leading-relaxed text-[10px] font-bold group-hover:text-white">{task.taskDescription}</p>
                <div className="flex items-center gap-2 mt-2 text-[8px] text-slate-500 font-black italic uppercase"><Clock className="h-2.5 w-2.5 text-[#E1AD01]"/>Fin registrado: {task.endTime && !Number.isNaN(new Date(task.endTime).getTime()) ? new Date(task.endTime).toLocaleString('es-VE') : 'SIN FECHA'}</div></td>
              <td className="px-6 py-6"><div className="flex flex-col gap-1"><div className="flex items-center gap-1.5 text-[9px] text-[#E1AD01] font-black uppercase tracking-tighter"><Box className="h-3 w-3 opacity-50"/>Observaciones registradas</div>
                <p className="text-[9px] text-slate-500 italic truncate max-w-[200px] uppercase">{task.observations || 'Sin observaciones'}</p></div></td>
              <td className="px-6 py-6"><div className="flex items-center gap-2"><div className="p-1.5 bg-white/5 rounded-lg border border-white/5"><User className="h-3 w-3 text-slate-400"/></div>
                <span className="uppercase font-black tracking-tight text-[9px] text-slate-400">{task.mechanicName || 'No registrado'}</span></div></td>
              <td className="px-6 py-6 text-right"><div className="inline-flex flex-col items-end"><span className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/20 bg-white/5 text-slate-300 text-[8px] font-black uppercase tracking-widest"><ClipboardCheck className="h-3 w-3"/>Orden finalizada</span>
                <span className="text-[7px] text-zinc-600 mt-1 uppercase font-mono tracking-tighter">Registro: {String(task.id).slice(0,8)}</span></div></td>
            </tr>)}
        </tbody>
      </table></div>
    </div>
    <div className="flex flex-wrap justify-between items-center gap-3 px-4 py-3 bg-white/[0.02] rounded-xl border border-white/5">
      <p className="text-[8px] text-slate-600 font-black uppercase tracking-wider">Strategic Fleet Support — Valkyron Group 2026</p>
      <div className="flex items-center gap-4 text-[8px] font-black text-slate-500 uppercase tracking-widest"><span>Total visible: {completedTasks.length}</span><span className="flex items-center gap-1"><ShieldCheck size={12}/> Registro informativo, no certificación</span></div>
    </div>
  </div>;
};

// src/components/MaintenanceHistory.tsx
// Evolución Grado Militar - Valkyron OS
import React from 'react';
import { WorkOrder } from '../Types/Maintenance';
import { ClipboardCheck, MapPin, User, Clock, Box, ShieldCheck, Plane } from 'lucide-react';

interface MaintenanceHistoryProps {
  completedTasks: WorkOrder[];
}

export const MaintenanceHistory: React.FC<MaintenanceHistoryProps> = ({ completedTasks }) => {
  return (
    <div className="mt-12 space-y-6 animate-in fade-in duration-1000 text-left">
      <h2 className="text-sm font-black text-white mb-6 flex items-center gap-2 uppercase tracking-[0.4em]">
        <span className="w-1.5 h-6 bg-[#E1AD01] rounded-full shadow-[0_0_15px_#E1AD01]"></span>
        Archivo Maestro de Mantenimiento (MRO LOG)
      </h2>
      
      <div className="rounded-2xl border border-white/10 bg-[#0a0a0a]/50 backdrop-blur-md overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-sans">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-[9px] uppercase font-black tracking-widest text-slate-500">
                <th className="px-6 py-5">Unidad / Sede</th>
                <th className="px-6 py-5">Intervención Técnica</th>
                <th className="px-6 py-5">Materiales & Auditoría</th>
                <th className="px-6 py-5">Certificador</th>
                <th className="px-6 py-5 text-right">Estatus Final</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-300 font-mono">
              {completedTasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-24 text-center text-slate-700 font-black uppercase tracking-[0.4em]">
                    Esperando sincronización de registros finalizados...
                  </td>
                </tr>
              ) : (
                completedTasks.map((task) => (
                  <tr key={task.id} className="hover:bg-white/[0.02] transition-all group">
                    <td className="px-6 py-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <Plane className="h-3 w-3 text-[#E1AD01]" />
                            <span className="text-[#E1AD01] font-black text-sm tracking-tighter italic uppercase">{task.aircraftId}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-tighter">
                          <MapPin className="h-2.5 w-2.5 text-slate-600" />
                          BASE {task.location}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6 max-w-xs text-left">
                      <p className="text-slate-200 uppercase leading-relaxed text-[10px] font-bold group-hover:text-white">
                        {task.taskDescription}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[8px] text-slate-500 font-black italic uppercase">
                        <Clock className="h-2.5 w-2.5 text-[#E1AD01]" />
                        Liberación: {task.endTime ? new Date(task.endTime).toLocaleString() : 'PENDIENTE'}
                      </div>
                    </td>
                    <td className="px-6 py-6 text-left">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[9px] text-[#E1AD01] font-black uppercase tracking-tighter">
                          <Box className="h-3 w-3 opacity-50" />
                          Trazabilidad de Consumibles
                        </div>
                        <p className="text-[9px] text-slate-500 italic truncate max-w-[200px] uppercase">
                          {task.observations || 'Mantenimiento Preventivo Certificado'}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-6 text-left">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-white/5 rounded-lg border border-white/5">
                          <User className="h-3 w-3 text-slate-400" />
                        </div>
                        <span className="uppercase font-black tracking-tight text-[9px] text-slate-400">{task.mechanicName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-6 text-right">
                      <div className="inline-flex flex-col items-end">
                        <span className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-500/30 bg-green-500/5 text-green-500 text-[8px] font-black uppercase tracking-widest shadow-[0_0_10px_rgba(34,197,94,0.1)]">
                          <ClipboardCheck className="h-3 w-3" />
                          Release to Service
                        </span>
                        <span className="text-[7px] text-zinc-600 mt-1 uppercase font-mono tracking-tighter">Valkyron Auth-ID: {task.id.slice(0,8)}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="flex justify-between items-center px-4 py-2 bg-white/[0.02] rounded-xl border border-white/5">
        <p className="text-[7px] text-slate-600 font-black uppercase tracking-[0.4em]">
          Strategic Fleet Support — Valkyron Group 2026
        </p>
        <div className="flex items-center gap-4 text-[7px] font-black text-slate-500 uppercase tracking-widest">
            <span>Total Logs: {completedTasks.length}</span>
            <div className="h-3 w-[1px] bg-white/10"></div>
            <span className="text-[#E1AD01]/50 italic flex items-center gap-1">
                <ShieldCheck className="h-2 w-2" /> Compliance Verified
            </span>
        </div>
      </div>
    </div>
  );
};
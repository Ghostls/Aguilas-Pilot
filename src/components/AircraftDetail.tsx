// src/components/AircraftDetail.tsx
import React from 'react';
import { 
  ArrowLeft, Plane, FileText, Activity, 
  Clock, TrendingUp, BarChart3 
} from 'lucide-react';
import { Aircraft } from '@/Types/Maintenance';
import FatigueBar from './FatigueBar';

interface AircraftDetailProps {
  aircraft: Aircraft;
  onBack: () => void;
  flightHistory?: any[]; 
}

const AircraftDetail: React.FC<AircraftDetailProps> = ({ aircraft, onBack, flightHistory = [] }) => {
  const handleGenerateReport = () => window.print();

  const specificFlights = flightHistory.filter(
    f => f.matricula === aircraft.tailNumber || f.avion_id === aircraft.id
  );

  const unitProduction = specificFlights.reduce((acc, curr) => acc + (curr.totalProduccionNeta || 0), 0);
  const sessionHours = specificFlights.reduce((acc, curr) => acc + (curr.horasTac || 0), 0);

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left font-sans">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-[#E1AD01] transition-colors group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Regresar a Vigilancia
        </button>
        <button
          onClick={handleGenerateReport}
          className="flex items-center gap-2 rounded-lg bg-[#E1AD01] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white transition-all shadow-lg"
        >
          <FileText className="h-4 w-4" /> Certificar Reporte MRO
        </button>
      </div>

      <div className="glass-panel rounded-xl p-6 border border-white/10 bg-[#0a0a0a] backdrop-blur-xl text-left">
        <div className="flex flex-col md:flex-row items-center gap-6 mb-8 text-left">
          <div className="p-4 bg-[#E1AD01]/10 rounded-2xl border border-[#E1AD01]/20">
            <Plane className="h-8 w-8 text-[#E1AD01]" />
          </div>
          <div className="flex-1 text-left">
            <div className="flex items-center gap-3">
              <h2 className="font-mono font-black text-3xl text-white tracking-tighter uppercase">{aircraft.tailNumber}</h2>
              <span className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase tracking-widest ${aircraft.status === 'operational' ? 'border-green-500/30 bg-green-500/10 text-green-500' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>
                {aircraft.status === 'operational' ? 'Airworthy' : 'Grounded'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-[0.2em] mt-1">
              {aircraft.model} | <span className="text-white font-mono uppercase">TT: {aircraft.hours_vuelo_totales || 0}H</span>
            </p>
          </div>
          
          <div className="bg-black/40 border border-white/5 p-4 rounded-xl text-right min-w-[220px]">
            <p className="text-[8px] text-[#E1AD01] font-black uppercase tracking-[0.2em] mb-1">Producción Neta Unidad</p>
            <p className="text-2xl font-mono font-black text-white">${unitProduction.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-white/5 bg-black/20 text-left">
          <table className="w-full text-left border-collapse font-mono">
            <thead className="bg-white/5 text-[9px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="p-4">Componente</th>
                <th className="p-4 text-center">T.S.O.</th>
                <th className="p-4 text-right">Progreso 100h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {aircraft.components?.map((comp: any, idx: number) => (
                <tr key={comp.id || idx}>
                  <td className="p-4">
                    <p className="text-sm font-black text-white uppercase">{comp.name}</p>
                    <p className="text-[9px] text-zinc-600">{comp.serialNumber || 'S/N-PENDING'}</p>
                  </td>
                  <td className="p-4 text-center text-[#E1AD01] font-black">{(comp.timeSinceOverhaul || 0).toFixed(1)}h</td>
                  <td className="p-4 w-64 text-right">
                    <FatigueBar current={(comp.timeSinceOverhaul || 0) % 100} limit={100} label="" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AircraftDetail;
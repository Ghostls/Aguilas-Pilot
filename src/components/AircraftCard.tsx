// src/components/AircraftCard.tsx
// Evolución Grado Militar: Traductor Universal de Estados
// REGLA DE ORO: CERO OMISIONES.
import React from 'react';
import { Plane, MapPin, Wrench, CheckCircle, AlertTriangle, Shield } from 'lucide-react';
import { Aircraft } from '@/Types/Maintenance';
import FatigueBar from './FatigueBar';

interface AircraftCardProps {
  aircraft: Aircraft;
  onSelect: (aircraft: Aircraft) => void;
}

// Configuración visual estandarizada
const statusConfig: Record<string, { label: string; icon: any; className: string }> = {
  operational: { label: 'Operativa', icon: CheckCircle, className: 'bg-green-500/10 text-green-500 border-green-500/20' },
  maintenance: { label: 'Hangar / Mantenimiento', icon: Wrench, className: 'bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/20' },
  grounded: { label: 'AOG / Tierra', icon: AlertTriangle, className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  flight: { label: 'En Vuelo', icon: Plane, className: 'bg-blue-500/10 text-blue-500 border-blue-500/20' }, // Nuevo estado añadido
};

// Función de Inteligencia para mapear cualquier string sucio a las 4 llaves maestras
const mapStatusToKey = (rawStatus: string): string => {
  if (!rawStatus) return 'grounded';
  
  // Limpiamos el string: minúsculas, sin tildes, sin espacios extra
  const s = rawStatus.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight')) return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  if (s.includes('operativa') || s.includes('operational')) return 'operational';
  
  return 'grounded'; // Fallback de seguridad
};

const AircraftCard: React.FC<AircraftCardProps> = ({ aircraft, onSelect }) => {
  // Pasamos el estado de la base de datos por el traductor
  const statusKey = mapStatusToKey(aircraft.status);
  const status = statusConfig[statusKey] || statusConfig.grounded;
  const StatusIcon = status.icon;

  return (
    <div
      className="bg-[#0f0f0f] border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:border-[#E1AD01]/50 hover:shadow-[0_0_30px_rgba(225,173,1,0.1)] transition-all duration-300 group text-left"
      onClick={() => onSelect(aircraft)}
    >
      <div className="relative h-24 bg-gradient-to-br from-slate-900 to-black overflow-hidden flex items-center justify-center">
        <Plane className="h-12 w-12 text-white/5 absolute -right-2 -bottom-2 rotate-12" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0f0f0f] to-transparent" />
        <div className={`absolute top-3 right-3 flex items-center gap-1.5 rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest border backdrop-blur-md ${status.className}`}>
          <StatusIcon className="h-3 w-3" />
          <span>{status.label}</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 text-left">
            <div className="p-2 bg-[#E1AD01]/10 rounded-lg">
                <Plane className="h-5 w-5 text-[#E1AD01]" />
            </div>
            <div className="text-left">
              <h3 className="font-mono font-black text-xl text-white tracking-tighter uppercase leading-none">
                {aircraft.tailNumber}
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 text-left">{aircraft.model}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono bg-white/5 w-fit px-2 py-1 rounded border border-white/5">
          <MapPin className="h-3 w-3 text-[#E1AD01]" />
          <span className="uppercase tracking-tighter text-slate-300">Base {aircraft.location}</span>
        </div>

        <div className="space-y-3 pt-2 text-left">
          <div className="flex items-center gap-2 mb-1">
             <Shield className="h-3 w-3 text-[#E1AD01]/50" />
             <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Monitoreo de Fatiga</span>
          </div>
          {/* Evitamos que .map reviente si components es undefined */}
          {(aircraft.components || []).slice(0, 2).map((comp: any, idx: number) => (
            <FatigueBar
              key={comp.id || idx}
              current={comp.timeSinceOverhaul || 0}
              limit={100}
              label={comp.name || 'Componente'}
            />
          ))}
          {(!aircraft.components || aircraft.components.length === 0) && (
            <p className="text-[8px] text-slate-600 font-mono uppercase">Datos de telemetría no disponibles</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AircraftCard;
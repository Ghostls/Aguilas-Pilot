// src/components/AircraftDetail.tsx
// VALKYRON OS — Evolución: Modal de Edición de Aeronave (Matrícula, Modelo, Horas Totales)
// REGLA DE ORO: CERO OMISIONES.

import React, { useState } from 'react';
import {
  ArrowLeft, Plane, FileText, Activity,
  Clock, TrendingUp, BarChart3, Pencil, X,
  Loader2, ShieldCheck
} from 'lucide-react';
import { Aircraft } from '@/Types/Maintenance';
import FatigueBar from './FatigueBar';
import { supabase } from '../lib/supabaseClient';

interface AircraftDetailProps {
  aircraft: Aircraft;
  onBack: () => void;
  flightHistory?: any[];
  setFleet?: React.Dispatch<React.SetStateAction<any[]>>;
}

const AircraftDetail: React.FC<AircraftDetailProps> = ({ aircraft, onBack, flightHistory = [], setFleet = () => {} }) => {
  const handleGenerateReport = () => window.print();

  const [isEditing, setIsEditing] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [editForm,  setEditForm]  = useState({
    tailNumber: aircraft.tailNumber || '',
    model:      aircraft.model || '',
    horasTotales: aircraft.hours_vuelo_totales ?? 0,
  });

  const specificFlights = flightHistory.filter(
    f => f.matricula === aircraft.tailNumber || f.avion_id === aircraft.id
  );

  const unitProduction = specificFlights.reduce((acc, curr) => acc + (curr.totalProduccionNeta || 0), 0);
  const sessionHours = specificFlights.reduce((acc, curr) => acc + (curr.horasTac || 0), 0);

  const openEdit = () => {
    setEditForm({
      tailNumber: aircraft.tailNumber || '',
      model:      aircraft.model || '',
      horasTotales: aircraft.hours_vuelo_totales ?? 0,
    });
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const tailUpper = editForm.tailNumber.trim().toUpperCase();

    // ── VERIFICAR EN SUPABASE: nombres reales de columnas en `flota_aviones`
    // Asumido: matricula, modelo, hours_vuelo_totales
    const dbEntry = {
      matricula: tailUpper,
      modelo:    editForm.model.trim(),
      horas_vuelo_totales: Number(editForm.horasTotales),
    };

    const { error } = await supabase
      .from('flota_aviones')
      .update(dbEntry)
      .eq('id', aircraft.id);

    if (error) {
      alert(`FALLA TÁCTICA AL ACTUALIZAR AERONAVE: ${error.message}`);
    } else {
      // Reflejar en estado local inmediatamente
      setFleet((prev: any[]) =>
        prev.map(ac =>
          ac.id === aircraft.id
            ? { ...ac, tailNumber: tailUpper, model: editForm.model.trim(), horas_vuelo_totales: Number(editForm.horasTotales), hours_vuelo_totales: Number(editForm.horasTotales) }
            : ac
        )
      );
      setIsEditing(false);
      alert(`[VALKYRON OPS] Datos de aeronave actualizados con éxito.`);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-700 text-left font-sans">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-[#E1AD01] transition-colors group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Regresar a Vigilancia
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={openEdit}
            className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#E1AD01] hover:border-[#E1AD01]/60 hover:bg-[#E1AD01]/10 transition-all shadow-lg"
          >
            <Pencil className="h-4 w-4" /> Editar Aeronave
          </button>
          <button
            onClick={handleGenerateReport}
            className="flex items-center gap-2 rounded-lg bg-[#E1AD01] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white transition-all shadow-lg"
          >
            <FileText className="h-4 w-4" /> Certificar Reporte MRO
          </button>
        </div>
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

      {/* ── MODAL EDICIÓN DE AERONAVE ── */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs tracking-widest">
              <div className="flex items-center gap-2 italic">
                <Pencil className="h-4 w-4" /> Editar Aeronave
              </div>
              <button onClick={() => setIsEditing(false)} className="hover:rotate-90 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-8 space-y-5 text-left font-mono">
              <div>
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-2">
                  Matrícula
                </label>
                <input
                  required
                  value={editForm.tailNumber}
                  onChange={e => setEditForm({ ...editForm, tailNumber: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-sm uppercase outline-none focus:border-[#E1AD01] font-mono"
                />
              </div>

              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Modelo
                </label>
                <input
                  required
                  value={editForm.model}
                  onChange={e => setEditForm({ ...editForm, model: e.target.value })}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-sm uppercase outline-none focus:border-[#E1AD01] font-mono"
                />
              </div>

              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Horas Totales (TT)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  value={editForm.horasTotales}
                  onChange={e => setEditForm({ ...editForm, horasTotales: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-2xl font-black outline-none focus:border-[#E1AD01] font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black
                             uppercase hover:bg-white transition-all shadow-lg disabled:opacity-40
                             flex items-center justify-center gap-2"
                >
                  {loading
                    ? <Loader2 className="animate-spin h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4" />}
                  {loading ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AircraftDetail;
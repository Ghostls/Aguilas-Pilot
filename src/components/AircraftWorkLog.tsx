// src/components/AircraftWorkLog.tsx
// VALKYRON OS — Bitácora de Trabajos por Aeronave
// Requerimiento #2: Registro permanente de todos los trabajos realizados
// REGLA DE ORO: CERO OMISIONES.

import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench, Plus, X, Loader2, ShieldCheck,
  Clock, User, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface WorkEntry {
  id: string;
  fecha: string;
  tipo_trabajo: string;
  descripcion: string;
  tecnico: string;
  horas_avion_al_momento: number | null;
  componente_afectado: string | null;
  proxima_accion: string | null;
  autorizado_por: string | null;
}

interface AircraftWorkLogProps {
  aircraftId: string;
  tailNumber: string;
  currentHours: number;
}

const WORK_TYPES = ['Preventivo', 'Correctivo', 'Inspección', 'AOG', 'Cambio de Estado', 'Otro'];

const TIPO_COLORS: Record<string, string> = {
  'Preventivo':      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Correctivo':      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'Inspección':      'bg-green-500/10 text-green-400 border-green-500/20',
  'AOG':             'bg-red-500/10 text-red-400 border-red-500/20',
  'Cambio de Estado':'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Otro':            'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

/**
 * @component AircraftWorkLog
 * @description Historial completo de trabajos de mantenimiento por aeronave.
 * Permite registrar nuevos trabajos y consultar el historial desde el inicio del sistema.
 */
const AircraftWorkLog: React.FC<AircraftWorkLogProps> = ({ aircraftId, tailNumber, currentHours }) => {
  const [entries,     setEntries]     = useState<WorkEntry[]>([]);
  const [loadingLog,  setLoadingLog]  = useState(true);
  const [isAdding,    setIsAdding]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  const [form, setForm] = useState({
    tipo_trabajo:           'Preventivo',
    descripcion:            '',
    tecnico:                '',
    componente_afectado:    '',
    proxima_accion:         '',
  });

  // ── Carga inicial del historial ──
  const fetchLog = useCallback(async () => {
    setLoadingLog(true);
    const { data, error } = await supabase
      .from('historial_trabajos_aeronave')
      .select('*')
      .eq('avion_id', aircraftId)
      .order('fecha', { ascending: false });

    if (!error && data) setEntries(data as WorkEntry[]);
    setLoadingLog(false);
  }, [aircraftId]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  const resetForm = () => setForm({
    tipo_trabajo: 'Preventivo', descripcion: '',
    tecnico: '', componente_afectado: '', proxima_accion: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.descripcion.trim() || !form.tecnico.trim()) {
      alert('Descripción y técnico son obligatorios.');
      return;
    }

    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('historial_trabajos_aeronave')
      .insert({
        avion_id:               aircraftId,
        tipo_trabajo:           form.tipo_trabajo,
        descripcion:            form.descripcion.trim(),
        tecnico:                form.tecnico.trim(),
        horas_avion_al_momento: currentHours,
        componente_afectado:    form.componente_afectado.trim() || null,
        proxima_accion:         form.proxima_accion.trim() || null,
        created_by:             user?.id ?? null,
      });

    if (error) {
      alert(`Error al guardar: ${error.message}`);
    } else {
      resetForm();
      setIsAdding(false);
      fetchLog();
    }

    setSaving(false);
  };

  return (
    <div className="space-y-4">
      {/* ── Header de sección ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-[#E1AD01]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            Bitácora de Trabajos — {tailNumber}
          </h3>
          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[8px] font-black text-slate-500">
            {entries.length} registros
          </span>
        </div>
        <button
          onClick={() => { setIsAdding(true); resetForm(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E1AD01]/10 border border-[#E1AD01]/30 text-[#E1AD01] text-[9px] font-black uppercase tracking-widest hover:bg-[#E1AD01]/20 transition-all"
        >
          <Plus className="h-3 w-3" /> Nuevo Registro
        </button>
      </div>

      {/* ── Lista de entradas ── */}
      {loadingLog ? (
        <div className="flex items-center gap-2 text-slate-600 text-xs py-8 justify-center">
          <Loader2 className="animate-spin h-4 w-4" /> Cargando historial...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-white/5 rounded-xl">
          <Wrench className="h-8 w-8 text-slate-700 mx-auto mb-2" />
          <p className="text-[10px] text-slate-600 uppercase tracking-widest">Sin registros aún</p>
          <p className="text-[9px] text-slate-700 mt-1">El primer trabajo que se registre aparecerá aquí.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1 custom-scroll">
          {entries.map(entry => {
            const isExpanded = expandedId === entry.id;
            const tipoColor  = TIPO_COLORS[entry.tipo_trabajo] || TIPO_COLORS['Otro'];
            return (
              <div
                key={entry.id}
                className="bg-black/30 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-all"
              >
                {/* Row principal */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                >
                  <span className={`px-2 py-0.5 rounded border text-[8px] font-black uppercase whitespace-nowrap ${tipoColor}`}>
                    {entry.tipo_trabajo}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-mono truncate">{entry.descripcion}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-[9px] text-slate-500">
                        <User className="h-2.5 w-2.5" /> {entry.tecnico}
                      </span>
                      <span className="flex items-center gap-1 text-[9px] text-slate-500">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(entry.fecha).toLocaleDateString('es-VE', {
                          day: '2-digit', month: 'short', year: 'numeric'
                        })}
                      </span>
                      {entry.horas_avion_al_momento && (
                        <span className="text-[9px] text-[#E1AD01]/70 font-mono">
                          TT: {entry.horas_avion_al_momento}h
                        </span>
                      )}
                    </div>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="h-3 w-3 text-slate-600 flex-shrink-0" />
                    : <ChevronDown className="h-3 w-3 text-slate-600 flex-shrink-0" />
                  }
                </div>

                {/* Detalle expandido */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-white/5 pt-3 grid grid-cols-2 gap-3">
                    {entry.componente_afectado && (
                      <div>
                        <p className="text-[8px] text-slate-600 uppercase tracking-widest mb-0.5">Componente</p>
                        <p className="text-[10px] text-white font-mono">{entry.componente_afectado}</p>
                      </div>
                    )}
                    {entry.proxima_accion && (
                      <div>
                        <p className="text-[8px] text-slate-600 uppercase tracking-widest mb-0.5">Próxima Acción</p>
                        <p className="text-[10px] text-orange-400 font-mono">{entry.proxima_accion}</p>
                      </div>
                    )}
                    {entry.autorizado_por && (
                      <div>
                        <p className="text-[8px] text-slate-600 uppercase tracking-widest mb-0.5">Liberado por</p>
                        <p className="text-[10px] text-green-400 font-mono">{entry.autorizado_por}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal de nuevo trabajo ── */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs tracking-widest">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4" /> Registrar Trabajo — {tailNumber}
              </div>
              <button onClick={() => setIsAdding(false)} className="hover:rotate-90 transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 font-mono">
              {/* Tipo de trabajo */}
              <div>
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-1.5">
                  Tipo de Trabajo *
                </label>
                <div className="flex flex-wrap gap-2">
                  {WORK_TYPES.map(t => (
                    <button
                      key={t} type="button"
                      onClick={() => setForm({ ...form, tipo_trabajo: t })}
                      className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all ${
                        form.tipo_trabajo === t
                          ? 'bg-[#E1AD01] border-[#E1AD01] text-black'
                          : 'border-white/10 text-slate-500 hover:border-white/30'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descripción */}
              <div>
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-1.5">
                  Descripción del Trabajo *
                </label>
                <textarea
                  required rows={3}
                  value={form.descripcion}
                  onChange={e => setForm({ ...form, descripcion: e.target.value })}
                  placeholder="Describe el trabajo realizado con detalle técnico..."
                  className="w-full bg-black border border-white/10 rounded-xl p-3 text-white text-xs outline-none focus:border-[#E1AD01] resize-none placeholder-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Técnico */}
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1.5">
                    Técnico Responsable *
                  </label>
                  <input
                    required
                    value={form.tecnico}
                    onChange={e => setForm({ ...form, tecnico: e.target.value })}
                    placeholder="Nombre del técnico"
                    className="w-full bg-black border border-white/10 rounded-xl p-3 text-white text-xs outline-none focus:border-[#E1AD01] placeholder-slate-700"
                  />
                </div>
                {/* Componente */}
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1.5">
                    Componente Afectado
                  </label>
                  <input
                    value={form.componente_afectado}
                    onChange={e => setForm({ ...form, componente_afectado: e.target.value })}
                    placeholder="Motor, hélice, aviónica..."
                    className="w-full bg-black border border-white/10 rounded-xl p-3 text-white text-xs outline-none focus:border-[#E1AD01] placeholder-slate-700"
                  />
                </div>
              </div>

              {/* Próxima acción */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-1.5">
                  Próxima Acción Requerida
                </label>
                <input
                  value={form.proxima_accion}
                  onChange={e => setForm({ ...form, proxima_accion: e.target.value })}
                  placeholder="Inspección en 25h, cambio de aceite en próximo servicio..."
                  className="w-full bg-black border border-white/10 rounded-xl p-3 text-white text-xs outline-none focus:border-[#E1AD01] placeholder-slate-700"
                />
              </div>

              {/* TT registrado automáticamente */}
              <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                <p className="text-[8px] text-slate-600 uppercase tracking-widest">
                  Horas de Aeronave al Momento (automático)
                </p>
                <p className="text-lg font-black text-[#E1AD01] font-mono">{currentHours}h TT</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button" onClick={() => setIsAdding(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black uppercase hover:bg-white transition-all shadow-lg disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="animate-spin h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  {saving ? 'Guardando...' : 'Registrar Trabajo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AircraftWorkLog;
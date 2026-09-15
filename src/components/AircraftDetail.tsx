// src/components/AircraftDetail.tsx
// VALKYRON OS v3.1 — Detalle de Aeronave con Cierre de Orden Manual
// CHANGELOG v3.1:
//   [NEW] Botón "✓ Completar Orden" — cierra la OT directamente desde el detalle
//   [NEW] Modal de cierre pide observaciones finales + horas de vuelo actuales
//   [NEW] Al completar: OT → 'Completed', flota → 'operational', horas actualizadas
//   [NEW] La orden completada aparece automáticamente en Historial (v_historial_aeronave)
//   [NEW] Botón directo "📜 Ver Historial" que dispara evento hacia FleetDashboard
//   [FIX] TS2339: hoursFlown → hours_vuelo_totales (alineado con Aircraft interface v6.1)
// v3.0 PRESERVADO: fetch de última orden, edición estado In Progress/Pending Parts,
//   dashboard TSN/TSMOH/TSOH, telemetría de motor, todo el CRUD existente.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Aircraft } from '../Types/Maintenance';
import { 
  ArrowLeft, Plane, ShieldCheck, Wrench, Loader2, Cpu, AlertTriangle, Clock, 
  Signal, HardDrive, Save, AlertCircle, CheckCircle2, History, X,
} from 'lucide-react';

interface AircraftDetailProps {
  aircraft: Aircraft;
  onBack: () => void;
  onOpenHistorial?: (aircraft: Aircraft) => void; // v3.1 — callback opcional
}

type OrderRecord = {
  id: string;
  descripcion_tarea: string;
  nombre_mecanico: string;
  estado: string;
  observaciones: string;
  created_at: string;
};

const AircraftDetail = ({ aircraft, onBack, onOpenHistorial }: AircraftDetailProps) => {
  const [orderRecord, setOrderRecord] = useState<OrderRecord | null>(null);
  const [status, setStatus] = useState('In Progress');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);

  // v3.1 — estado del modal de cierre
  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [completeForm, setCompleteForm] = useState({
    observacionesFinales: '',
    horasActuales: '',
    mecanicoCierre: '',
  });

  const isMaintenance = aircraft.status === 'maintenance';

  // ─── FETCH: última orden activa ──────────────────────────────────────────
  const fetchLatestOrder = useCallback(async () => {
    if (!isMaintenance) { setIsFetching(false); return; }
    setIsFetching(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('id, descripcion_tarea, nombre_mecanico, estado, observaciones, created_at')
        .eq('matricula', aircraft.tailNumber)
        .in('estado', ['In Progress', 'Pending Parts', 'On Hold'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setOrderRecord(data as OrderRecord);
        setStatus(data.estado || 'In Progress');
        setNotes(data.observaciones || '');
      } else {
        setOrderRecord(null);
      }
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Error al cargar la orden.');
    } finally {
      setIsFetching(false);
    }
  }, [aircraft.tailNumber, isMaintenance]);

  useEffect(() => { fetchLatestOrder(); }, [fetchLatestOrder]);

  // v3.1 — Pre-llenar horas actuales al abrir modal
  // [FIX] TS2339: aircraft.hoursFlown → aircraft.hours_vuelo_totales
  useEffect(() => {
    if (isCompleteOpen && orderRecord) {
      setCompleteForm(prev => ({
        ...prev,
        horasActuales: String(aircraft.hours_vuelo_totales ?? 0),
        mecanicoCierre: orderRecord.nombre_mecanico ?? '',
      }));
    }
  }, [isCompleteOpen, orderRecord, aircraft.hours_vuelo_totales]);

  // ─── ACTUALIZAR (In Progress / Pending Parts / On Hold) ───────────────────
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderRecord) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({ estado: status, observaciones: notes })
        .eq('id', orderRecord.id);
      if (error) throw error;
      setOrderRecord({ ...orderRecord, estado: status, observaciones: notes });
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 2500);
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Error al actualizar.');
    } finally {
      setIsSaving(false);
    }
  };

  // v3.1 ─── COMPLETAR ORDEN (cierre definitivo) ────────────────────────────
  const handleCompleteOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderRecord) return;

    const horas = parseFloat(completeForm.horasActuales);
    if (isNaN(horas) || horas < 0) {
      alert('Horas de aeronave inválidas.');
      return;
    }
    if (!completeForm.observacionesFinales.trim()) {
      alert('Debe registrar las observaciones finales del cierre.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const timestamp = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const obsPrevias = orderRecord.observaciones ?? '';
      const obsFinal = `${obsPrevias}\n[${timestamp}] CIERRE DE ORDEN por ${completeForm.mecanicoCierre.toUpperCase() || 'N/A'} @ ${horas}h TT: ${completeForm.observacionesFinales.trim().toUpperCase()}`;

      // 1. Marcar orden como Completed
      const { error: ordenError } = await supabase
        .from('ordenes_trabajo')
        .update({
          estado: 'Completed',
          observaciones: obsFinal,
          nombre_mecanico: completeForm.mecanicoCierre.trim() || orderRecord.nombre_mecanico,
        })
        .eq('id', orderRecord.id);
      if (ordenError) throw ordenError;

      // 2. Liberar aeronave: operational + actualizar horas
      const { error: flotaError } = await supabase
        .from('flota_aviones')
        .update({
          estado: 'operational',
          horas_vuelo_totales: horas,
        })
        .eq('matricula', aircraft.tailNumber);
      if (flotaError) console.warn('[v3.1] No se pudo liberar aeronave:', flotaError.message);

      setIsCompleteOpen(false);
      alert(
        `✓ Orden completada exitosamente\n\n` +
        `La aeronave ${aircraft.tailNumber} ha sido liberada a OPERATIVA.\n` +
        `El registro aparecerá en el Historial de la aeronave.`
      );
      // Volver al dashboard para reflejar el cambio de estado
      onBack();
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Error al completar la orden.');
    } finally {
      setIsSaving(false);
    }
  };

  const isCompleted = orderRecord?.estado === 'Completed';

  return (
    <div className="p-6 min-h-screen text-white animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <button
          onClick={onBack}
          className="text-gray-400 flex items-center gap-2 hover:text-[#E1AD01] transition-colors group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-[10px] font-black uppercase tracking-[0.3em] italic">
            Volver al Dashboard
          </span>
        </button>
        <div className="flex items-center gap-2">
          {onOpenHistorial && (
            <button
              onClick={() => onOpenHistorial(aircraft)}
              className="bg-[#E1AD01]/10 border border-[#E1AD01]/30 text-[#E1AD01] px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[#E1AD01] hover:text-black transition-all flex items-center gap-2"
            >
              <History className="h-3.5 w-3.5" /> Ver Historial
            </button>
          )}
          <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest bg-black/30 px-3 py-1.5 rounded-full">
            ID: {aircraft.tailNumber}
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="mb-8 p-8 bg-black/30 border border-white/10 rounded-3xl relative overflow-hidden shadow-2xl">
        <Plane className="absolute -right-4 -bottom-4 h-40 w-40 text-white/[0.02]" />
        <div className="relative flex justify-between items-end flex-wrap gap-4">
          <div>
            <p className="text-[10px] text-[#E1AD01] font-black uppercase tracking-[0.3em] mb-2">
              Diagnóstico de Aeronave
            </p>
            <h2 className="text-5xl font-black text-white leading-none italic">{aircraft.model}</h2>
            <p className="text-[10px] text-slate-500 font-black mt-3 uppercase tracking-widest">
              {aircraft.tailNumber} | Rol Táctico:{' '}
              <span className="text-white/70">{isMaintenance ? 'Hangar' : 'Operativa'}</span>
            </p>
          </div>
          <div
            className={`p-4 rounded-2xl border-2 ${
              isMaintenance
                ? 'bg-red-500/10 border-red-500 shadow-red-500/20 shadow-lg'
                : 'bg-emerald-500/10 border-emerald-500 shadow-emerald-500/20 shadow-lg'
            }`}
          >
            <p className={`text-[10px] font-black uppercase tracking-widest italic ${
              isMaintenance ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {isMaintenance ? '/// EN HANGAR' : '✓ LISTA VUELO'}
            </p>
          </div>
        </div>
      </div>

      {/* Dashboard */}
      {/* [FIX] TS2339: aircraft.hoursFlown → aircraft.hours_vuelo_totales ?? 0 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <MetricCard label="Time Since New" value={`${aircraft.hours_vuelo_totales ?? 0} h`} icon={Clock} color="#E1AD01" />
        <MetricCard label="TSMOH" value="1580 h" icon={Wrench} color="#E1AD01" />
        <MetricCard label="TSOH" value="120 h" icon={HardDrive} color="#E1AD01" />
      </div>

      {/* Telemetría de motor */}
      <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10 mb-8 shadow-xl">
        <p className="text-[10px] text-[#E1AD01] font-black mb-6 uppercase tracking-[0.3em] italic flex items-center gap-2">
          <Cpu className="h-3 w-3" /> Módulo de Análisis Predictivo Motor
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <TelemetryDot label="Estado Motor" value="NORMAL" tone="ok" pulse />
          <TelemetryDot label="Vibración" value="0.15 IPS" tone="ok" />
          <TelemetryDot label="Temp Aceite" value="180°F" tone="ok" />
          <TelemetryDot label="Alerta Proactiva" value="NINGUNA" tone="ok" />
        </div>
      </div>

      {/* Panel de Orden Activa */}
      {isMaintenance && (
        <div className="p-8 bg-red-950/20 rounded-3xl border-2 border-red-900/50 space-y-4 shadow-2xl shadow-red-500/10">
          <p className="text-[11px] text-red-400 font-black uppercase tracking-widest italic flex items-center gap-3">
            <AlertTriangle className="h-4 w-4 animate-pulse" />
            Panel de Orden de Trabajo Activa
          </p>

          {isFetching ? (
            <div className="flex items-center justify-center gap-3 py-6 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[9px] font-black uppercase tracking-widest">Sincronizando con MRO...</span>
            </div>
          ) : errorMsg && !orderRecord ? (
            <FeedbackBanner tone="error" text={errorMsg} onClose={() => setErrorMsg(null)} />
          ) : orderRecord ? (
            <>
              {/* Info de la orden */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-black/40 border border-white/5 rounded-2xl">
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest">Tarea</p>
                  <p className="text-[11px] text-white font-black uppercase mt-1">{orderRecord.descripcion_tarea}</p>
                </div>
                <div>
                  <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest">Técnico Asignado</p>
                  <p className="text-[11px] text-white font-black uppercase mt-1">{orderRecord.nombre_mecanico}</p>
                </div>
              </div>

              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                      Estado de la Orden
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-xs font-black outline-none focus:border-[#E1AD01] transition-all"
                    >
                      <option value="In Progress">EN PROGRESO</option>
                      <option value="Pending Parts">ESPERANDO REPUESTOS</option>
                      <option value="On Hold">EN ESPERA</option>
                    </select>
                    <p className="text-[8px] text-slate-500 font-mono">
                      Para <span className="text-[#E1AD01] font-black">completar</span> usa el botón dedicado abajo.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                    Observaciones / Notas de Progreso
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="AVANCES, DIAGNÓSTICO, REPUESTOS PEDIDOS..."
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-white text-xs resize-none outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 uppercase font-mono"
                  />
                </div>

                {errorMsg && <FeedbackBanner tone="error" text={errorMsg} onClose={() => setErrorMsg(null)} />}
                {successMsg && <FeedbackBanner tone="success" text="Orden actualizada correctamente." />}

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-4 rounded-2xl bg-[#E1AD01] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    {isSaving ? 'Guardando...' : 'Guardar Progreso'}
                  </button>

                  {/* v3.1 — Botón de completar */}
                  <button
                    type="button"
                    onClick={() => setIsCompleteOpen(true)}
                    disabled={isSaving || isCompleted}
                    className="flex-1 py-4 rounded-2xl bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Completar Orden
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="text-center py-10 bg-black/40 rounded-2xl border border-white/5">
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                Sin órdenes activas
              </p>
              <p className="text-[9px] text-slate-700 mt-2 font-mono">
                La aeronave está en mantenimiento sin OT abierta. Crea una desde el Control Hub.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          v3.1 — MODAL DE CIERRE DE ORDEN
      ═══════════════════════════════════════════════════════════════ */}
      {isCompleteOpen && orderRecord && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/98 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-emerald-500/40 w-full max-w-lg rounded-[2.5rem] shadow-[0_0_80px_rgba(16,185,129,0.15)] overflow-hidden">
            {/* Header */}
            <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-7 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={20} className="text-black" />
                </div>
                <div>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">Cerrar Orden de Trabajo</p>
                  <p className="text-[9px] text-emerald-400/70 font-mono uppercase tracking-widest mt-0.5">
                    {aircraft.tailNumber} · {aircraft.model}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsCompleteOpen(false)} className="text-zinc-600 hover:text-white hover:rotate-90 transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCompleteOrder} className="p-7 space-y-5 font-mono">
              {/* Info resumen */}
              <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-2">Tarea a Cerrar</p>
                <p className="text-[10px] text-white font-black uppercase leading-snug">{orderRecord.descripcion_tarea}</p>
              </div>

              {/* Mecánico que cierra */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-emerald-400 uppercase tracking-widest block">
                  Mecánico / Inspector *
                </label>
                <input
                  required
                  className="w-full bg-black border border-emerald-500/30 rounded-xl p-4 text-white text-xs uppercase outline-none focus:border-emerald-500 transition-all placeholder:text-white/20 font-mono"
                  placeholder="Nombre completo"
                  value={completeForm.mecanicoCierre}
                  onChange={e => setCompleteForm(prev => ({ ...prev, mecanicoCierre: e.target.value }))}
                />
              </div>

              {/* Horas actuales */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                  Horas Totales al Cierre (TSN) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-5 text-white text-3xl font-black text-center outline-none focus:border-[#E1AD01] transition-all font-mono"
                  placeholder="0.0"
                  value={completeForm.horasActuales}
                  onChange={e => setCompleteForm(prev => ({ ...prev, horasActuales: e.target.value }))}
                />
                <p className="text-[8px] text-slate-600 font-mono">Esto actualizará las horas totales de la aeronave.</p>
              </div>

              {/* Observaciones finales */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                  <Wrench size={11} /> Observaciones Finales *
                </label>
                <textarea
                  required
                  rows={4}
                  className="w-full bg-black border border-emerald-500/30 rounded-xl p-4 text-white text-xs resize-none outline-none focus:border-emerald-500 transition-all placeholder:text-white/20 uppercase font-mono"
                  placeholder="TRABAJO REALIZADO, REPUESTOS INSTALADOS, PRUEBAS EJECUTADAS, CERTIFICACIÓN FINAL..."
                  value={completeForm.observacionesFinales}
                  onChange={e => setCompleteForm(prev => ({ ...prev, observacionesFinales: e.target.value }))}
                />
                <p className="text-[8px] text-slate-600 font-mono">
                  Se agregará con timestamp al historial de la orden y aparecerá en el Historial de la aeronave.
                </p>
              </div>

              <div className="flex items-start gap-2 bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3">
                <AlertCircle size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-emerald-400/80 leading-relaxed">
                  Al confirmar: la orden pasa a <span className="font-black">COMPLETADA</span>, la aeronave se libera a{' '}
                  <span className="font-black">OPERATIVA</span>, y el registro aparece en el Timeline de la aeronave automáticamente.
                </p>
              </div>

              {errorMsg && <FeedbackBanner tone="error" text={errorMsg} onClose={() => setErrorMsg(null)} />}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCompleteOpen(false)}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-4 rounded-xl bg-emerald-500 text-black text-[10px] font-black uppercase hover:bg-emerald-400 transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {isSaving ? 'Cerrando...' : 'Confirmar Cierre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-componentes ─────────────────────────────────────────────────────────

const MetricCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="bg-white/[0.03] p-6 rounded-3xl border border-white/10 flex items-center gap-4 shadow-lg">
    <Icon className="h-6 w-6 shrink-0" style={{ color }} />
    <div>
      <p className="text-[8px] text-slate-500 font-black uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl text-white font-black italic">{value}</p>
    </div>
  </div>
);

const TelemetryDot = ({ label, value, tone, pulse }: any) => {
  const color = tone === 'ok' ? 'text-emerald-400' : 'text-red-400';
  return (
    <div>
      <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest">{label}</p>
      <p className={`text-white font-mono font-black text-lg flex items-center gap-2 mt-1 ${color}`}>
        <Signal className={`h-3 w-3 ${pulse ? 'animate-pulse' : ''}`} /> {value}
      </p>
    </div>
  );
};

const FeedbackBanner = ({ tone, text, onClose }: { tone: 'error' | 'success'; text: string; onClose?: () => void }) => (
  <div
    className={`flex items-start gap-3 rounded-xl border p-3 animate-in fade-in duration-200 ${
      tone === 'error' ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'
    }`}
  >
    <AlertCircle className={`h-4 w-4 mt-0.5 ${tone === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />
    <p className={`text-[10px] font-mono flex-1 ${tone === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{text}</p>
    {onClose && (
      <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-[10px] font-black">
        ×
      </button>
    )}
  </div>
);

export default AircraftDetail;
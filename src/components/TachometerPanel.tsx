// src/components/TachometerPanel.tsx
// VALKYRON OS — Tacómetro v2.1: fix visual gauge + TSO real + alertas 50h/100h + reset
// REGLA DE ORO: CERO OMISIONES.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Clock, RotateCcw, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useFleetStatusControl } from '../hooks/useFleetStatusControl';

interface TachometerData {
  horas_vuelo_totales:      number;
  horas_en_reset:           number;
  intervalo_servicio_horas: number;
  horas_desde_servicio:     number;
  horas_restantes:          number;
  estado_servicio:          'OK' | 'PROXIMO' | 'CRITICO' | 'VENCIDO';
  ultimo_reset_en:          string | null;
  ultimo_reset_por:         string | null;
}

interface TachometerPanelProps {
  aircraftId: string;
  tailNumber: string;
  onReset?:   () => void;
}

// ── Gauge SVG semicircular v2.1 — fix arco rojo desbordado ─────────────────
const TachometerGauge: React.FC<{
  horasDesde: number;
  intervalo:  number;
  color:      string;
  label:      string;
}> = ({ horasDesde, intervalo, color, label }) => {
  const pct = Math.min(horasDesde / Math.max(intervalo, 1), 1);
  const cx = 110, cy = 105, r = 78;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (startDeg: number, endDeg: number, radius: number): string => {
    // Protección: arco degenerado si start === end
    if (Math.abs(endDeg - startDeg) < 0.01) return '';
    const x1    = cx + radius * Math.cos(toRad(startDeg));
    const y1    = cy + radius * Math.sin(toRad(startDeg));
    const x2    = cx + radius * Math.cos(toRad(endDeg));
    const y2    = cy + radius * Math.sin(toRad(endDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };

  const START_DEG      = -135;
  const END_DEG        =  135;
  const WARN_DEG       = START_DEG + 0.70 * 270;
  const CRIT_DEG       = START_DEG + 0.85 * 270;
  const progressEndDeg = START_DEG + pct * 270;

  const needleAngle = START_DEG + pct * 270;
  const needleX     = cx + r * Math.cos(toRad(needleAngle));
  const needleY     = cy + r * Math.sin(toRad(needleAngle));

  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <svg viewBox="0 0 220 190" className="w-full max-w-[240px] mx-auto">

      {/* Arco de fondo neutro */}
      <path
        d={arcPath(START_DEG, END_DEG, r)}
        fill="none" stroke="#1a1a1a" strokeWidth="14" strokeLinecap="round"
      />

      {/* Zonas de color de fondo — nunca cierran por abajo */}
      <path d={arcPath(START_DEG, WARN_DEG, r)} fill="none" stroke="#16a34a18" strokeWidth="14" />
      <path d={arcPath(WARN_DEG,  CRIT_DEG, r)} fill="none" stroke="#f9731618" strokeWidth="14" />
      <path d={arcPath(CRIT_DEG,  END_DEG,  r)} fill="none" stroke="#ef444418" strokeWidth="14" />

      {/* Arco de progreso — solo si pct > 0 para evitar path degenerado */}
      {pct > 0.001 && (
        <path
          d={arcPath(START_DEG, progressEndDeg, r)}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
        />
      )}

      {/* Ticks de escala */}
      {ticks.map((t, i) => {
        const deg    = START_DEG + t * 270;
        const rOuter = r - 5;
        const rInner = r - 13;
        return (
          <line
            key={i}
            x1={cx + rOuter * Math.cos(toRad(deg))}
            y1={cy + rOuter * Math.sin(toRad(deg))}
            x2={cx + rInner * Math.cos(toRad(deg))}
            y2={cy + rInner * Math.sin(toRad(deg))}
            stroke={i === 5 ? '#E1AD01' : '#2a2a2a'}
            strokeWidth={i % 5 === 0 ? 2 : 1}
          />
        );
      })}

      {/* Aguja */}
      <line
        x1={cx} y1={cy}
        x2={needleX} y2={needleY}
        stroke="white" strokeWidth="2.5" strokeLinecap="round"
        style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' }}
      />
      <circle
        cx={cx} cy={cy} r="6"
        fill={color}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />

      {/* Horas en el centro */}
      <text
        x={cx} y={cy + 30}
        textAnchor="middle" fill="white"
        fontSize="22" fontFamily="monospace" fontWeight="900"
      >
        {horasDesde.toFixed(1)}
      </text>
      <text
        x={cx} y={cy + 44}
        textAnchor="middle" fill="#555"
        fontSize="8" fontFamily="monospace" letterSpacing="2"
      >
        HORAS TSO
      </text>

      {/* Etiquetas extremos del arco */}
      <text x={cx - r - 10} y={cy + 10} textAnchor="middle" fill="#333" fontSize="8" fontFamily="monospace">
        0
      </text>
      <text x={cx + r + 10} y={cy + 10} textAnchor="middle" fill="#333" fontSize="8" fontFamily="monospace">
        {intervalo}
      </text>

      {/* Label superior */}
      <text
        x={cx} y={22}
        textAnchor="middle" fill="#E1AD01"
        fontSize="8" fontFamily="monospace" fontWeight="bold" letterSpacing="3"
      >
        {label}
      </text>

    </svg>
  );
};

// ── Componente principal ────────────────────────────────────────────────────
const TachometerPanel: React.FC<TachometerPanelProps> = ({ aircraftId, tailNumber, onReset }) => {
  const [data,       setData]       = useState<TachometerData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [resetModal, setResetModal] = useState(false);
  const [resetHours, setResetHours] = useState<50 | 100>(100);
  const [resetting,  setResetting]  = useState(false);

  const { isAuthorized: checkAuth } = useFleetStatusControl();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  // ── Fetch datos desde v_tachometer ──
  const fetchTachometer = useCallback(async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('v_tachometer')
      .select('*')
      .eq('id', aircraftId)
      .single();

    if (!error && rows) {
      setData({
        horas_vuelo_totales:      rows.horas_vuelo_totales      ?? 0,
        horas_en_reset:           rows.horas_en_reset           ?? 0,
        intervalo_servicio_horas: rows.intervalo_servicio_horas ?? 100,
        horas_desde_servicio:     rows.horas_desde_servicio     ?? 0,
        horas_restantes:          rows.horas_restantes          ?? 100,
        estado_servicio:          rows.estado_servicio          ?? 'OK',
        ultimo_reset_en:          rows.ultimo_reset_en          ?? null,
        ultimo_reset_por:         rows.ultimo_reset_por         ?? null,
      });
    }
    setLoading(false);
  }, [aircraftId]);

  useEffect(() => { fetchTachometer(); }, [fetchTachometer]);

  // ── Realtime: tacómetro se mueve cuando el piloto registra vuelo ──
  useEffect(() => {
    const channel = supabase
      .channel(`tachometer-${aircraftId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'flota_aviones',
          filter: `id=eq.${aircraftId}`,
        },
        () => { fetchTachometer(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [aircraftId, fetchTachometer]);

  // ── Verificar autorización ──
  useEffect(() => {
    checkAuth().then(({ ok }) => setIsAuthorized(ok));
  }, [checkAuth]);

  // ── Reset de tacómetro ──
  const handleReset = async () => {
    setResetting(true);
    const { data: { user } } = await supabase.auth.getUser();
    const email = user?.email ?? 'desconocido';

    const { error } = await supabase.rpc('reset_tachometer', {
      p_avion_id:  aircraftId,
      p_reset_por: email,
      p_intervalo: resetHours,
    });

    if (error) {
      alert(`Error al resetear tacómetro: ${error.message}`);
    } else {
      await supabase.from('historial_trabajos_aeronave').insert({
        avion_id:               aircraftId,
        tipo_trabajo:           'Preventivo',
        descripcion:            `Servicio de ${resetHours}h completado. Tacómetro reseteado a 0h TSO.`,
        tecnico:                email,
        horas_avion_al_momento: data?.horas_vuelo_totales ?? 0,
        autorizado_por:         email,
      });

      setResetModal(false);
      fetchTachometer();
      onReset?.();
      alert(`[VALKYRON OPS] Tacómetro reseteado. Intervalo próximo: ${resetHours}h.`);
    }
    setResetting(false);
  };

  // ── Config visual por estado ──
  const statusConfig = useMemo(() => {
    if (!data) return { color: '#22c55e', icon: CheckCircle, label: 'OK', pulse: false };
    switch (data.estado_servicio) {
      case 'VENCIDO': return { color: '#ef4444', icon: AlertTriangle, label: '⛔ SERVICIO VENCIDO', pulse: true  };
      case 'CRITICO': return { color: '#ef4444', icon: AlertTriangle, label: '🔴 SERVICIO URGENTE', pulse: true  };
      case 'PROXIMO': return { color: '#f97316', icon: Clock,         label: '⚡ SERVICIO PRÓXIMO', pulse: false };
      default:        return { color: '#22c55e', icon: CheckCircle,   label: '✓ OPERATIVO',         pulse: false };
    }
  }, [data]);

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-600">
      <Loader2 className="animate-spin h-5 w-5" />
      <span className="text-xs font-mono uppercase tracking-widest">Cargando tacómetro...</span>
    </div>
  );

  if (!data) return (
    <div className="text-center py-10 text-slate-700 text-xs font-mono uppercase">
      Sin datos de tacómetro para esta aeronave.
    </div>
  );

  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-5">

      {/* ── Badge de estado ── */}
      <div
        className={`flex items-center justify-center gap-2 py-3 rounded-xl border ${statusConfig.pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: `${statusConfig.color}10`, borderColor: `${statusConfig.color}30` }}
      >
        <StatusIcon className="h-4 w-4" style={{ color: statusConfig.color }} />
        <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: statusConfig.color }}>
          {statusConfig.label}
        </span>
      </div>

      {/* ── Gauge principal ── */}
      <div className="bg-black/40 border border-white/5 rounded-2xl p-5">
        <TachometerGauge
          horasDesde={data.horas_desde_servicio}
          intervalo={data.intervalo_servicio_horas}
          color={statusConfig.color}
          label={`SVC ${data.intervalo_servicio_horas}H — ${tailNumber}`}
        />
      </div>

      {/* ── Métricas ── */}
      <div className="grid grid-cols-2 gap-3">

        <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-1">
          <p className="text-[8px] text-slate-600 uppercase tracking-widest">Horas TSO</p>
          <p className="text-2xl font-black font-mono text-white">
            {data.horas_desde_servicio.toFixed(1)}<span className="text-sm text-slate-500">h</span>
          </p>
          <p className="text-[8px] text-slate-700 font-mono">Desde último servicio</p>
        </div>

        <div
          className="border rounded-xl p-4 space-y-1"
          style={{ backgroundColor: `${statusConfig.color}10`, borderColor: `${statusConfig.color}25` }}
        >
          <p className="text-[8px] uppercase tracking-widest" style={{ color: statusConfig.color }}>
            Horas Restantes
          </p>
          <p className="text-2xl font-black font-mono text-white">
            {data.horas_restantes.toFixed(1)}<span className="text-sm text-slate-500">h</span>
          </p>
          <p className="text-[8px] font-mono" style={{ color: statusConfig.color }}>
            Para SVC {data.intervalo_servicio_horas}h
          </p>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-1">
          <p className="text-[8px] text-slate-600 uppercase tracking-widest">Horas Totales (TT)</p>
          <p className="text-xl font-black font-mono text-white">
            {data.horas_vuelo_totales.toFixed(1)}<span className="text-sm text-slate-500">h</span>
          </p>
          <p className="text-[8px] text-slate-700 font-mono">Acumuladas de por vida</p>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-1">
          <p className="text-[8px] text-slate-600 uppercase tracking-widest">Próximo SVC en TT</p>
          <p className="text-xl font-black font-mono text-[#E1AD01]">
            {(data.horas_en_reset + data.intervalo_servicio_horas).toFixed(0)}
            <span className="text-sm text-slate-500">h</span>
          </p>
          <p className="text-[8px] text-slate-700 font-mono">Horas totales al vencimiento</p>
        </div>

      </div>

      {/* ── Barra de progreso con marca 50h ── */}
      <div className="bg-black/30 border border-white/5 rounded-xl p-4 space-y-3">
        <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
          Progreso del ciclo de servicio
        </p>

        <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min((data.horas_desde_servicio / data.intervalo_servicio_horas) * 100, 100)}%`,
              backgroundColor: statusConfig.color,
              boxShadow: `0 0 10px ${statusConfig.color}60`,
            }}
          />
          {/* Marcador de 50h visible solo si intervalo es 100h */}
          {data.intervalo_servicio_horas >= 100 && (
            <div className="absolute top-0 h-full w-0.5 bg-[#E1AD01]/60" style={{ left: '50%' }} />
          )}
        </div>

        <div className="flex justify-between text-[8px] font-mono text-slate-600">
          <span>0h</span>
          {data.intervalo_servicio_horas >= 100 && (
            <span className="text-[#E1AD01]/60">50h SVC</span>
          )}
          <span>{data.intervalo_servicio_horas}h SVC</span>
        </div>

        {/* Indicadores de alerta */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {[
            {
              label:   `Alerta 70% (${(data.intervalo_servicio_horas * 0.70).toFixed(0)}h)`,
              reached: data.horas_desde_servicio >= data.intervalo_servicio_horas * 0.70,
              color:   '#f97316',
            },
            {
              label:   `Crítico 85% (${(data.intervalo_servicio_horas * 0.85).toFixed(0)}h)`,
              reached: data.horas_desde_servicio >= data.intervalo_servicio_horas * 0.85,
              color:   '#ef4444',
            },
          ].map((alert, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border"
              style={{
                borderColor:     alert.reached ? `${alert.color}40` : '#ffffff08',
                backgroundColor: alert.reached ? `${alert.color}10` : 'transparent',
              }}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${alert.reached ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: alert.reached ? alert.color : '#333' }}
              />
              <span
                className="text-[8px] font-mono uppercase tracking-wide"
                style={{ color: alert.reached ? alert.color : '#555' }}
              >
                {alert.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Último reset ── */}
      {data.ultimo_reset_en && (
        <div className="bg-black/20 border border-white/5 rounded-xl p-3 flex items-center gap-3">
          <RotateCcw className="h-3.5 w-3.5 text-slate-600 flex-shrink-0" />
          <div>
            <p className="text-[8px] text-slate-600 uppercase tracking-widest">Último servicio completado</p>
            <p className="text-[10px] text-slate-400 font-mono">
              {new Date(data.ultimo_reset_en).toLocaleDateString('es-VE', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
              {data.ultimo_reset_por && (
                <span className="text-slate-600"> — {data.ultimo_reset_por}</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Botón reset — solo supervisores autorizados ── */}
      {isAuthorized && (
        <button
          onClick={() => setResetModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[#E1AD01]/30 bg-[#E1AD01]/5 text-[#E1AD01] text-[9px] font-black uppercase tracking-widest hover:bg-[#E1AD01]/15 transition-all"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Registrar Servicio Completado — Resetear Tacómetro
        </button>
      )}

      {/* ══════════════════════════════════════════
          MODAL: Reset de Tacómetro
      ══════════════════════════════════════════ */}
      {resetModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">

            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs tracking-widest">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4" /> Servicio Completado — {tailNumber}
              </div>
              <button onClick={() => setResetModal(false)} className="hover:rotate-90 transition-all">
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 font-mono">

              <div className="bg-black/30 rounded-xl p-4 border border-white/5">
                <p className="text-[8px] text-slate-600 uppercase tracking-widest mb-1">Estado actual</p>
                <p className="text-lg font-black text-white">
                  {data.horas_desde_servicio.toFixed(1)}h TSO
                  <span className="text-slate-600 text-sm font-normal"> → reseteará a </span>
                  <span className="text-[#E1AD01]">0.0h</span>
                </p>
                <p className="text-[9px] text-slate-500 mt-1">
                  Horas totales al momento del servicio: {data.horas_vuelo_totales.toFixed(1)}h TT
                </p>
              </div>

              <div>
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-3">
                  Intervalo del próximo servicio
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {([50, 100] as const).map(h => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setResetHours(h)}
                      className={`py-4 rounded-xl border text-center transition-all ${
                        resetHours === h
                          ? 'bg-[#E1AD01] border-[#E1AD01] text-black'
                          : 'border-white/10 text-slate-400 hover:border-white/30'
                      }`}
                    >
                      <p className="text-2xl font-black font-mono">{h}h</p>
                      <p className="text-[8px] uppercase tracking-widest mt-0.5">
                        {h === 50 ? 'Servicio Menor' : 'Servicio Mayor'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-red-900/20 border border-red-500/20 rounded-xl p-3">
                <p className="text-[8px] text-red-400 font-black uppercase tracking-widest mb-1">
                  ⚠ Acción Irreversible
                </p>
                <p className="text-[9px] text-slate-500">
                  Al confirmar, el tacómetro se resetea a 0h y se registra el servicio
                  completado en la bitácora. Esta acción queda firmada por tu usuario.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setResetModal(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="flex-1 py-3 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black uppercase hover:bg-white transition-all shadow-lg disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {resetting
                    ? <Loader2 className="animate-spin h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4" />
                  }
                  {resetting ? 'Procesando...' : `Confirmar SVC ${resetHours}h`}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TachometerPanel;
// src/components/PlannerHangar.tsx
// VALKYRON OS v2.1 — HANGAR DE CONSULTA PARA PLANIFICACIÓN (SIN controles de mantenimiento)
// FUSIÓN: original + v2.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.1 (sobre v2.0):
//   [NEW] Filtro por sede (TODAS / BARQUISIMETO / MATURIN), inicia en la sede del
//         planificador. Normalización idéntica a FlightPlanningBoard (LARA = BQTO).
//   [NEW] Búsqueda por matrícula o modelo.
//   [NEW] Actualización automática cada 2 min con la pestaña visible:
//         v_slots_disponibles es una vista y no emite eventos realtime.
//   [NEW] Número de órdenes de trabajo abiertas por aeronave en el motivo.
//   [CHG] Horas con un decimal.
//
// CHANGELOG v2.0 (sobre original):
//   [FIX] "Disponible" ya no se deduce de la ausencia de órdenes abiertas.
//         ASIGNABLE solo si se cumplen TODOS los criterios que el sistema
//         implementa y que fn_plan_asignar valida en el servidor:
//           1. v_slots_disponibles.disponible_mro = true   (fuente MRO del sistema)
//           2. flota_aviones.estado operativo              (no mantenimiento/AOG/tierra)
//           3. sin órdenes de trabajo abiertas              (In Progress / Pending Parts / On Hold)
//         Si alguna fuente no se puede consultar → SIN VERIFICAR (nunca "disponible").
//   [FIX] El estado 'Operativa' en español ya no se descartaba por no ser 'operational'.
//   [NEW] Toda la flota visible (consulta) agrupada con el motivo de cada bloqueo.
//   [NEW] Consultas cancelables con límite de 15 s; errores por fuente sin bloquear la vista.
//   [NEW] Actualización en tiempo real (flota y órdenes) con debounce.
//
// PRESERVADO (original): consulta de solo lectura sin controles MRO, consulta de
//   órdenes con los estados 'In Progress' / 'Pending Parts' / 'On Hold', aviso de
//   verificación documental, botón Actualizar, "Candidata para planificación",
//   mensaje sin aeronaves disponibles, fecha de última consulta, ante falla de
//   flota no se declaran aeronaves disponibles, export default.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import {
  AlertTriangle, CheckCircle2, HelpCircle, MapPin, Plane, RefreshCw, Search, ShieldAlert, Wrench,
} from 'lucide-react';

type HangarAircraft = {
  id: string;
  matricula: string;
  modelo: string | null;
  sede: string | null;
  estado: string | null;
  horas_vuelo_totales: number | null;
};

type MroRow = {
  id: string | null;
  matricula: string | null;
  disponible_mro: boolean | null;
};

type OrderRow = {
  matricula: string | null;
  estado: string | null;
};

type Verdict = 'ASIGNABLE' | 'NO_ASIGNABLE' | 'SIN_VERIFICAR';
type SedeFiltro = 'TODAS' | 'BARQUISIMETO' | 'MATURIN';

interface Evaluated {
  aircraft: HangarAircraft;
  verdict: Verdict;
  reasons: string[];
}

const LOAD_TIMEOUT_MS = 15000;
const AUTO_REFRESH_MS = 2 * 60 * 1000;
const CLEANUP_REASON = 'cleanup';
const OPEN_ORDER_STATES = ['In Progress', 'Pending Parts', 'On Hold'];
const openStates = OPEN_ORDER_STATES.map(s => s.toLowerCase());   // [KEEP original]
const SEDES: SedeFiltro[] = ['TODAS', 'BARQUISIMETO', 'MATURIN'];

const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Misma normalización de sede que FlightPlanningBoard. */
const normSede = (s: string | null | undefined): string | null => {
  if (!s || !s.trim()) return null;
  const v = s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['LARA', 'BARQUISIMETO', 'BQTO'].includes(v)) return 'BARQUISIMETO';
  if (['MATURIN', 'MONAGAS'].includes(v)) return 'MATURIN';
  return v;
};

/** Misma normalización de estado que Index.tsx (desconocido = en tierra). */
const estadoOperativo = (raw: string | null): boolean => {
  if (!raw) return false;
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return false;
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return false;
  if (s.includes('vuelo') || s.includes('flight')) return true;   // en vuelo: flota activa
  return s.includes('operational') || s.includes('operativa') || s.includes('operativo');
};

const fmtHoras = (h: number | null) =>
  h === null || h === undefined || !Number.isFinite(Number(h)) ? 'No registradas' : `${Number(h).toFixed(1)} h`;

const PlannerHangar: React.FC = () => {
  const { profile } = useAuth();

  const [fleet, setFleet] = useState<HangarAircraft[]>([]);
  const [mroRows, setMroRows] = useState<MroRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [mroOk, setMroOk] = useState(false);
  const [ordersOk, setOrdersOk] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [sede, setSede] = useState<SedeFiltro>(() => {
    const s = normSede(profile?.sede);
    return s === 'BARQUISIMETO' || s === 'MATURIN' ? s : 'TODAS';
  });
  const [query, setQuery] = useState('');

  const controllerRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort(CLEANUP_REASON);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort('timeout'), LOAD_TIMEOUT_MS);

    setBusy(true);
    setError(null);

    try {
      const [fleetRes, mroRes, ordersRes] = await Promise.allSettled([
        supabase.from('flota_aviones')
          .select('id,matricula,modelo,sede,estado,horas_vuelo_totales')
          .order('matricula', { ascending: true })
          .abortSignal(controller.signal),
        supabase.from('v_slots_disponibles')
          .select('id,matricula,disponible_mro')
          .abortSignal(controller.signal),
        supabase.from('ordenes_trabajo')
          .select('matricula,estado')
          .in('estado', OPEN_ORDER_STATES)
          .abortSignal(controller.signal),
      ]);

      if (controller.signal.aborted && controller.signal.reason === CLEANUP_REASON) return;

      const timedOut = controller.signal.aborted;
      const avisos: string[] = [];

      // Flota: fuente obligatoria. Sin ella no se muestra nada.
      if (fleetRes.status === 'rejected' || fleetRes.value.error) {
        const msg = timedOut
          ? 'Tiempo de espera agotado al consultar la flota.'
          : fleetRes.status === 'rejected'
            ? String(fleetRes.reason)
            : fleetRes.value.error?.message ?? 'Error';
        setFleet([]); // ante falla, no declarar aeronaves disponibles
        setError(msg);
        return;
      }
      setFleet((fleetRes.value.data ?? []) as HangarAircraft[]);

      // Estado MRO del sistema (misma fuente que valida fn_plan_asignar).
      if (mroRes.status === 'fulfilled' && !mroRes.value.error) {
        setMroRows((mroRes.value.data ?? []) as MroRow[]);
        setMroOk(true);
      } else {
        setMroRows([]);
        setMroOk(false);
        avisos.push('No se pudo verificar el estado MRO (v_slots_disponibles). Ninguna aeronave se marca como asignable.');
      }

      // Órdenes de trabajo abiertas.
      if (ordersRes.status === 'fulfilled' && !ordersRes.value.error) {
        setOrders((ordersRes.value.data ?? []) as OrderRow[]);
        setOrdersOk(true);
      } else {
        setOrders([]);
        setOrdersOk(false);
        avisos.push('No se pudieron consultar las órdenes de trabajo abiertas. Ninguna aeronave se marca como asignable.');
      }

      setWarnings(avisos);
      setUpdatedAt(new Date().toLocaleString('es-VE'));
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason === CLEANUP_REASON) return;
      setFleet([]); // ante falla, no declarar aeronaves disponibles
      setError(err instanceof Error ? err.message : 'No se pudo comprobar la disponibilidad.');
    } finally {
      clearTimeout(timer);
      if (controllerRef.current === controller) setBusy(false);
    }
  }, []);

  // Carga inicial + realtime (flota y órdenes)
  useEffect(() => {
    void load();

    const channel = supabase
      .channel(`planner-hangar-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flota_aviones' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { void load(); }, 600);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_trabajo' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { void load(); }, 600);
      })
      .subscribe();

    return () => {
      controllerRef.current?.abort(CLEANUP_REASON);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // [v2.1] Actualización periódica (la vista MRO no emite realtime)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const evaluated = useMemo<Evaluated[]>(() => {
    const mroById = new Map<string, MroRow>();
    const mroByMat = new Map<string, MroRow>();
    mroRows.forEach(r => {
      if (r.id) mroById.set(String(r.id), r);
      if (r.matricula) mroByMat.set(normalize(r.matricula), r);
    });

    const openCount = new Map<string, number>();
    orders
      .filter(o => openStates.includes(normalize(o.estado)))
      .forEach(o => {
        const k = normalize(o.matricula);
        openCount.set(k, (openCount.get(k) ?? 0) + 1);
      });

    return fleet.map((ac): Evaluated => {
      const reasons: string[] = [];

      if (!estadoOperativo(ac.estado)) {
        reasons.push(`Estado: ${ac.estado || 'sin registrar'}`);
      }

      const mro = mroById.get(String(ac.id)) ?? mroByMat.get(normalize(ac.matricula));
      if (mroOk && mro && mro.disponible_mro !== true) reasons.push('Bloqueada por MRO');

      const abiertas = openCount.get(normalize(ac.matricula)) ?? 0;
      if (ordersOk && abiertas > 0) {
        reasons.push(abiertas === 1 ? '1 orden de trabajo abierta' : `${abiertas} órdenes de trabajo abiertas`);
      }

      if (reasons.length > 0) return { aircraft: ac, verdict: 'NO_ASIGNABLE', reasons };

      const pendientes: string[] = [];
      if (!mroOk) pendientes.push('Estado MRO no verificable');
      else if (!mro) pendientes.push('No figura en la vista MRO');
      if (!ordersOk) pendientes.push('Órdenes de trabajo no verificables');

      if (pendientes.length > 0) return { aircraft: ac, verdict: 'SIN_VERIFICAR', reasons: pendientes };

      return { aircraft: ac, verdict: 'ASIGNABLE', reasons: [] };
    });
  }, [fleet, mroRows, orders, mroOk, ordersOk]);

  // [v2.1] Filtros de sede y búsqueda (solo presentación; no alteran el veredicto)
  const visibles = useMemo(() => {
    const q = normalize(query);
    return evaluated.filter(e => {
      const s = normSede(e.aircraft.sede);
      if (sede !== 'TODAS' && s !== null && s !== sede) return false;
      if (!q) return true;
      return normalize(e.aircraft.matricula).includes(q) || normalize(e.aircraft.modelo).includes(q);
    });
  }, [evaluated, sede, query]);

  const asignables = visibles.filter(e => e.verdict === 'ASIGNABLE');
  const noAsignables = visibles.filter(e => e.verdict === 'NO_ASIGNABLE');
  const sinVerificar = visibles.filter(e => e.verdict === 'SIN_VERIFICAR');

  const card = (e: Evaluated) => {
    const ac = e.aircraft;
    const tone = e.verdict === 'ASIGNABLE'
      ? 'border-emerald-600/25'
      : e.verdict === 'NO_ASIGNABLE'
        ? 'border-red-500/20 opacity-80'
        : 'border-amber-500/25';
    return (
      <article key={ac.id} className={`rounded-2xl border bg-white/[0.03] p-5 ${tone}`}>
        <p className={`mb-2 flex items-center gap-1.5 text-xs font-bold uppercase ${
          e.verdict === 'ASIGNABLE' ? 'text-emerald-400' : e.verdict === 'NO_ASIGNABLE' ? 'text-red-400' : 'text-amber-300'
        }`}>
          {e.verdict === 'ASIGNABLE' && <><CheckCircle2 size={13} /> Candidata para planificación</>}
          {e.verdict === 'NO_ASIGNABLE' && <><Wrench size={13} /> No asignable</>}
          {e.verdict === 'SIN_VERIFICAR' && <><HelpCircle size={13} /> Sin verificar</>}
        </p>
        <h4 className="text-2xl font-black tracking-tight">{ac.matricula}</h4>
        <p className="mt-1 text-sm text-slate-300">{ac.modelo || 'Modelo no registrado'}</p>
        <p className="mt-3 text-xs text-slate-400">Sede: {ac.sede || 'Sin sede'}</p>
        <p className="mt-1 text-xs text-slate-400">Horas: {fmtHoras(ac.horas_vuelo_totales)}</p>
        <p className="mt-1 text-xs text-slate-500">Estado registrado: {ac.estado || 'Sin registrar'}</p>
        {e.reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {e.reasons.map(r => (
              <li key={r} className="text-[11px] text-slate-400">• {r}</li>
            ))}
          </ul>
        )}
      </article>
    );
  };

  return (
    <section className="space-y-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-3">
          <Plane className="text-[#E1AD01]" />
          <div>
            <h3 className="font-black uppercase tracking-wider">Hangar · Consulta para planificación</h3>
            <p className="text-xs text-slate-400">
              Asignable = disponible en MRO del sistema, estado operativo y sin órdenes de trabajo abiertas.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-[#E1AD01] px-4 py-3 text-xs font-black uppercase text-black disabled:opacity-50">
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
        Este listado es orientativo. Una aeronave solo puede asignarse a un vuelo tras verificar
        documentación, mantenimiento, liberación autorizada y restricciones operacionales vigentes.
        La asignación final la valida el servidor al confirmar el vuelo.
      </div>

      {/* [v2.1] Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-xl border border-white/10 bg-black/60 p-1">
          {SEDES.map(s => (
            <button key={s} type="button" onClick={() => setSede(s)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                sede === s ? 'bg-[#E1AD01] text-black' : 'text-slate-500 hover:text-white'
              }`}>
              {s !== 'TODAS' && <MapPin size={11} />}
              {s === 'BARQUISIMETO' ? 'BQTO' : s}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar matrícula o modelo"
            className="w-full rounded-xl border border-white/10 bg-black/60 py-2.5 pl-9 pr-3 text-xs text-white outline-none focus:border-[#E1AD01]/60"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 p-4 text-sm text-red-300">
          <span className="flex items-center gap-2"><ShieldAlert size={18} />{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-bold uppercase hover:bg-red-500/10">
            Reintentar
          </button>
        </div>
      )}

      {warnings.map(w => (
        <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-500/25 p-4 text-xs text-amber-200">
          <AlertTriangle size={16} className="shrink-0" />{w}
        </div>
      ))}

      {busy && fleet.length === 0 && !error ? (
        <p className="text-slate-400">Verificando disponibilidad...</p>
      ) : !error && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-600/25 p-4">
              <p className="text-[10px] uppercase text-slate-400">Asignables</p>
              <p className="text-2xl font-black text-emerald-400">{asignables.length}</p>
            </div>
            <div className="rounded-xl border border-red-500/20 p-4">
              <p className="text-[10px] uppercase text-slate-400">No asignables</p>
              <p className="text-2xl font-black text-red-400">{noAsignables.length}</p>
            </div>
            <div className="rounded-xl border border-amber-500/25 p-4">
              <p className="text-[10px] uppercase text-slate-400">Sin verificar</p>
              <p className="text-2xl font-black text-amber-300">{sinVerificar.length}</p>
            </div>
          </div>

          {asignables.length === 0 && (
            <p className="rounded-xl border border-white/10 p-8 text-center text-slate-400">
              No hay aeronaves verificadas como disponibles en este momento.
            </p>
          )}

          {asignables.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{asignables.map(card)}</div>
          )}

          {sinVerificar.length > 0 && (
            <>
              <h4 className="text-xs font-black uppercase tracking-widest text-amber-300">Sin verificar</h4>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{sinVerificar.map(card)}</div>
            </>
          )}

          {noAsignables.length > 0 && (
            <>
              <h4 className="text-xs font-black uppercase tracking-widest text-red-400">No asignables</h4>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{noAsignables.map(card)}</div>
            </>
          )}

          {visibles.length === 0 && fleet.length > 0 && (
            <p className="text-center text-xs text-slate-500">Ninguna aeronave coincide con los filtros aplicados.</p>
          )}
        </>
      )}

      {updatedAt && (
        <p className="text-xs text-slate-500">
          Última consulta: {updatedAt} · actualización automática cada 2 min
        </p>
      )}
    </section>
  );
};

export default PlannerHangar;
// src/components/PlannerHangar.tsx
// VALKYRON OS v2.2 — HANGAR DE CONSULTA PARA PLANIFICACIÓN (SIN controles de mantenimiento)
// B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.2 — REBRAND B&M + CONEXIONES:
//   [FIX] Filtro de sede: el estado inicial se calculaba con el perfil del
//         primer render; AuthContext lo carga después, así que el planificador
//         quedaba siempre en TODAS. Ahora se aplica su sede cuando el perfil
//         llega, salvo que ya haya elegido una a mano.
//   [FIX] Al fallar la flota quedaban en pantalla los avisos MRO/órdenes de la
//         consulta anterior junto al error. Se limpian.
//   [FIX] "Última consulta" seguía visible con el error de flota y parecía
//         dato vigente. Ahora solo se muestra con datos válidos.
//   [UI]  B&M: cabecera blanca, filtros de sede en control segmentado, búsqueda
//         a 16 px (sin zoom en iOS), KPI con cifras protagonistas, tarjetas
//         blancas con veredicto en insignia y motivos en lista.
// PRESERVADO: veredicto ASIGNABLE / NO_ASIGNABLE / SIN_VERIFICAR con los tres
//   criterios (v_slots_disponibles.disponible_mro, estado operativo, órdenes
//   abiertas), "sin verificar" nunca es "disponible", consultas cancelables con
//   15 s, realtime flota/órdenes con debounce, actualización cada 2 min con la
//   pestaña visible, filtros de solo presentación, export default.
// ─────────────────────────────────────────────────────────────────────────────
// VALKYRON OS v2.1 — FUSIÓN: original + v2.0
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
import { BmBadge, BmNotice, bmBtn, type BmTone } from './brand/bm-ui';   // [v2.2]

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

// [NEW v2.2] Etiquetas y tonos B&M
const SEDE_LABEL: Record<SedeFiltro, string> = {
  TODAS: 'Todas',
  BARQUISIMETO: 'BQTO',
  MATURIN: 'Maturín',
};

const VEREDICTO_UI: Record<Verdict, { label: string; tone: BmTone; border: string; icon: React.ReactNode }> = {
  ASIGNABLE:     { label: 'Candidata para planificación', tone: 'ok',     border: 'border-bm-ok/30',  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  NO_ASIGNABLE:  { label: 'No asignable',                 tone: 'danger', border: 'border-bm-line',   icon: <Wrench className="h-3.5 w-3.5" /> },
  SIN_VERIFICAR: { label: 'Sin verificar',                tone: 'warn',   border: 'border-bm-warn/35', icon: <HelpCircle className="h-3.5 w-3.5" /> },
};

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
  const sedeTocadaRef = useRef(false);   // [v2.2] el planificador eligió sede a mano

  // [FIX v2.2] El perfil llega después del primer render (AuthContext asíncrono)
  useEffect(() => {
    if (sedeTocadaRef.current) return;
    const s = normSede(profile?.sede);
    if (s === 'BARQUISIMETO' || s === 'MATURIN') setSede(s);
  }, [profile?.sede]);

  const elegirSede = (s: SedeFiltro) => {
    sedeTocadaRef.current = true;
    setSede(s);
  };

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
        setWarnings([]); // [v2.2] sin avisos de la consulta anterior
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
      setWarnings([]); // [v2.2]
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
    const ui = VEREDICTO_UI[e.verdict];
    return (
      <article key={ac.id} className={`flex flex-col rounded-[20px] border bg-white p-4 sm:p-5 ${ui.border}`}>
        <div className="flex items-start justify-between gap-2">
          <BmBadge tone={ui.tone} icon={ui.icon}>{ui.label}</BmBadge>
        </div>
        <h4 className="mt-3 font-data text-2xl font-semibold tracking-tight">{ac.matricula}</h4>
        <p className="mt-0.5 text-sm text-bm-steel">{ac.modelo || 'Modelo no registrado'}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-bm-steel">Sede</dt>
          <dd className="truncate font-medium">{ac.sede || 'Sin sede'}</dd>
          <dt className="text-bm-steel">Horas</dt>
          <dd className="bm-num font-medium">{fmtHoras(ac.horas_vuelo_totales)}</dd>
          <dt className="text-bm-steel">Estado registrado</dt>
          <dd className="truncate font-medium">{ac.estado || 'Sin registrar'}</dd>
        </dl>
        {e.reasons.length > 0 && (
          <ul className={`mt-3 space-y-1 rounded-xl px-3 py-2.5 text-[13px] ${
            e.verdict === 'NO_ASIGNABLE' ? 'bg-bm-red-tint text-bm-red-deep' : 'bg-bm-warn-tint text-[#7C2D12]'}`}>
            {e.reasons.map(r => (
              <li key={r} className="flex gap-1.5"><span aria-hidden="true">•</span>{r}</li>
            ))}
          </ul>
        )}
      </article>
    );
  };

  const kpi = (label: string, value: number, cls: string) => (
    <div className="rounded-[20px] border border-bm-line bg-white p-3.5 sm:p-4">
      <p className="text-[13px] leading-tight text-bm-steel">{label}</p>
      <p className={`bm-figure mt-2 text-[28px] sm:text-[32px] ${cls}`}>{value}</p>
    </div>
  );

  return (
    <section className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">
      <div className="flex flex-col gap-4 rounded-[24px] border border-bm-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Plane className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h3 className="bm-heading text-lg leading-tight sm:text-xl">Hangar · consulta para planificación</h3>
            <p className="mt-0.5 text-[13px] leading-snug text-bm-steel">
              Asignable = disponible en MRO del sistema, estado operativo y sin órdenes de trabajo abiertas.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}
          className={`${bmBtn.secondary} ${bmBtn.sm} w-full shrink-0 sm:w-auto`}>
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      <BmNotice tone="warn" icon={<ShieldAlert className="h-4 w-4" />}>
        Este listado es orientativo. Una aeronave solo puede asignarse a un vuelo tras verificar
        documentación, mantenimiento, liberación autorizada y restricciones operacionales vigentes.
        La asignación final la valida el servidor al confirmar el vuelo.
      </BmNotice>

      {/* [v2.1] Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-2xl border border-bm-line bg-white p-1" role="group" aria-label="Sede">
          {SEDES.map(s => (
            <button key={s} type="button" onClick={() => elegirSede(s)} aria-pressed={sede === s}
              className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors sm:flex-none ${
                sede === s ? 'bg-bm-ink text-white' : 'text-bm-steel hover:text-bm-ink'
              }`}>
              {s !== 'TODAS' && <MapPin className="h-3.5 w-3.5" />}
              {SEDE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar matrícula o modelo"
            aria-label="Buscar matrícula o modelo"
            className="h-12 w-full rounded-xl border border-bm-field bg-white pl-10 pr-3 text-base text-bm-ink outline-none transition-[border-color,box-shadow] placeholder:text-bm-hint focus:border-bm-red focus:ring-4 focus:ring-bm-red/10"
          />
        </div>
      </div>

      {error && (
        <BmNotice tone="danger" role="alert" icon={<ShieldAlert className="h-4 w-4" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold">No se pudo consultar la flota</p>
              <p className="mt-0.5 break-words font-data text-xs">{error}</p>
            </div>
            <button type="button" onClick={() => void load()} className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}>
              Reintentar
            </button>
          </div>
        </BmNotice>
      )}

      {warnings.map(w => (
        <BmNotice key={w} tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>{w}</BmNotice>
      ))}

      {busy && fleet.length === 0 && !error ? (
        <div aria-busy="true" aria-label="Verificando disponibilidad" className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <div key={i} className="bm-skeleton h-[96px] rounded-[20px]" />)}
          </div>
          <p className="text-sm text-bm-steel">Verificando disponibilidad...</p>
        </div>
      ) : !error && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {kpi('Asignables', asignables.length, 'text-bm-ok')}
            {kpi('No asignables', noAsignables.length, 'text-bm-red')}
            {kpi('Sin verificar', sinVerificar.length, 'text-bm-warn')}
          </div>

          {asignables.length === 0 && (
            <div className="rounded-[20px] border border-dashed border-bm-field bg-white px-4 py-8 text-center">
              <Plane className="mx-auto h-6 w-6 text-bm-hint" />
              <p className="mt-2 text-sm font-medium">No hay aeronaves verificadas como disponibles en este momento.</p>
            </div>
          )}

          {asignables.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">{asignables.map(card)}</div>
          )}

          {sinVerificar.length > 0 && (
            <>
              <h4 className="flex items-center gap-2 pt-1 text-sm font-semibold text-bm-warn">
                <HelpCircle className="h-4 w-4" /> Sin verificar
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">{sinVerificar.map(card)}</div>
            </>
          )}

          {noAsignables.length > 0 && (
            <>
              <h4 className="flex items-center gap-2 pt-1 text-sm font-semibold text-bm-red">
                <Wrench className="h-4 w-4" /> No asignables
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">{noAsignables.map(card)}</div>
            </>
          )}

          {visibles.length === 0 && fleet.length > 0 && (
            <p className="text-center text-sm text-bm-steel">Ninguna aeronave coincide con los filtros aplicados.</p>
          )}
        </>
      )}

      {updatedAt && !error && (
        <p className="text-xs text-bm-steel">
          Última consulta: <span className="bm-num">{updatedAt}</span> · actualización automática cada 2 min
        </p>
      )}
    </section>
  );
};

export default PlannerHangar;

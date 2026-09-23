// src/components/FlightPlanningBoard.tsx
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║            OPERACIÓN ÁGUILAS — PLANIFICACIÓN DE VUELO v1.1                  ║
// ║            VALKYRON OS — FLIGHT OPERATIONS / DISPATCH                       ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║ FLUJO:                                                                      ║
// ║   Alumno solicita slot (SOLICITADA)                                         ║
// ║     └── Planificación: CONFIRMA · REPROGRAMA · RECHAZA                      ║
// ║           └── asigna aeronave (no MRO, misma sede, libre) + capitán libre   ║
// ║                 └── Capitán ve la misión CONFIRMADA en su calendario        ║
// ║                                                                             ║
// ║ CAPACIDAD DE UN SLOT = min(aeronaves operativas, capitanes activos) por sede ║
// ║                                                                             ║
// ║ TODA ESCRITURA pasa por RPC SECURITY DEFINER:                               ║
// ║   fn_plan_tablero · fn_plan_asignar · fn_plan_rechazar                      ║
// ║ La validación final (conflictos, MRO, sede, saldo) vive en PostgreSQL.      ║
// ║ Auditoría: reservas_slot_eventos                                            ║
// ║                                                                             ║
// ║ FECHAS: siempre en horario LOCAL (no toISOString) para YYYY-MM-DD           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3,
  Gauge, History, Inbox, Loader2, Lock, MapPin, Plane, RefreshCw, Repeat,
  ShieldCheck, User, Users, Wrench, X, XCircle,
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════════════════════════

type EstadoReserva = 'SOLICITADA' | 'CONFIRMADA' | 'COMPLETADA' | 'CANCELADA' | 'POSTERGADA' | 'RECHAZADA';
type ModalMode     = 'CONFIRMAR' | 'REPROGRAMAR' | 'RECHAZAR';
type SedeFiltro    = 'TODAS' | 'BARQUISIMETO' | 'MATURIN';

interface PlanReserva {
  id: string;
  student_id: string;
  alumno_nombre: string;
  alumno_serial: string | null;
  alumno_sede: string | null;
  aeronave_id: string | null;
  aeronave_matricula: string | null;
  instructor_id: string | null;
  instructor_nombre: string | null;
  fecha: string;
  slot_hora: string;
  horas_planificadas: number;
  horas_reales: number | null;
  tipo_vuelo: string | null;
  status: EstadoReserva;
  motivo_cierre: string | null;
  notas_capitan: string | null;
  fecha_solicitada: string | null;
  slot_solicitado: string | null;
  reprogramada: boolean;
  motivo_planificacion: string | null;
  created_at: string;
  saldo_horas: number;
  horas_comprometidas: number;
}

interface PlanAeronave {
  id: string;
  matricula: string;
  modelo: string | null;
  sede: string | null;
  disponible_mro: boolean;
}

interface PlanInstructor {
  id: string;
  nombre_completo: string;
  sede: string | null;
}

interface TableroData {
  hoy: string | null;
  reservas: PlanReserva[];
  aeronaves: PlanAeronave[];
  instructores: PlanInstructor[];
}

interface EventoReserva {
  id: string;
  accion: string;
  detalle: any;
  actor: string | null;
  created_at: string;
}

interface CeldaOcupacion {
  conf: PlanReserva[];
  sol: PlanReserva[];
}

interface FlightPlanningBoardProps {
  userRole?: string;
  userProfile?: {
    nombre_completo: string;
    sede: string;
    rol: string;
  } | null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════════════════════════

const SLOTS = [
  { hora: '08:00', label: '08:00', bloqueado: false },
  { hora: '10:00', label: '10:00', bloqueado: false },
  { hora: '12:00', label: '12:00 · Almuerzo', bloqueado: true },
  { hora: '14:00', label: '14:00', bloqueado: false },
  { hora: '16:00', label: '16:00 · Último', bloqueado: false },
] as const;

const SLOTS_OPERATIVOS = SLOTS.filter(s => !s.bloqueado).map(s => s.hora) as string[];

const DAYS_ES   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const SEDES: SedeFiltro[] = ['TODAS', 'BARQUISIMETO', 'MATURIN'];

const VENTANA_DIAS = 21;   // semana visible + 2 semanas para sugerencias de reprogramación

const MOTIVOS_REPROGRAMAR = [
  'SLOT SIN CAPACIDAD',
  'AERONAVE EN MRO',
  'CAPITÁN NO DISPONIBLE',
  'CONDICIONES METEOROLÓGICAS',
];

const MOTIVOS_RECHAZO = [
  'SALDO DE HORAS INSUFICIENTE',
  'SIN CAPACIDAD EN LAS PRÓXIMAS FECHAS',
  'DOCUMENTACIÓN / MÉDICO PENDIENTE',
  'SOLICITUD DUPLICADA',
];

const EMPTY_DATA: TableroData = { hoy: null, reservas: [], aeronaves: [], instructores: [] };

// ══════════════════════════════════════════════════════════════════════════════
// FECHAS — LOCAL, nunca toISOString() para YYYY-MM-DD
// ══════════════════════════════════════════════════════════════════════════════

const pad = (v: number) => String(v).padStart(2, '0');

const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const parseYMD = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(12, 0, 0, 0);
  return x;
};

const ahoraHM = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDateLong = (ymd: string | null | undefined) => {
  if (!ymd) return '—';
  const d = parseYMD(ymd);
  return `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS_ES[d.getMonth()].slice(0, 3)}`;
};

const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const haceCuanto = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
};

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ══════════════════════════════════════════════════════════════════════════════

const normSede = (s: string | null | undefined): string | null => {
  if (!s || !s.trim()) return null;
  const v = s.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['LARA', 'BARQUISIMETO', 'BQTO'].includes(v)) return 'BARQUISIMETO';
  if (['MATURIN', 'MONAGAS'].includes(v)) return 'MATURIN';
  return v;
};

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const hm = (v: unknown) => (v ? String(v).slice(0, 5) : '');

const slotKey = (fecha: string, slot: string) => `${fecha}|${slot}`;

const nombreCorto = (n: string | null | undefined) => {
  if (!n) return '—';
  const partes = n.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[1].charAt(0)}.` : partes[0];
};

const ESTADO_STYLE: Record<EstadoReserva, string> = {
  SOLICITADA: 'text-sky-400 bg-sky-500/10 border-sky-500/25',
  CONFIRMADA: 'text-[#E1AD01] bg-[#E1AD01]/10 border-[#E1AD01]/25',
  COMPLETADA: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  CANCELADA:  'text-red-400 bg-red-500/10 border-red-500/25',
  POSTERGADA: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  RECHAZADA:  'text-red-400 bg-red-500/10 border-red-500/25',
};

const ACCION_LABEL: Record<string, string> = {
  SOLICITUD:   'Solicitud del alumno',
  CONFIRMAR:   'Confirmado por Planificación',
  REPROGRAMAR: 'Reprogramado por Planificación',
  REASIGNAR:   'Recursos reasignados',
  RECHAZAR:    'Rechazado por Planificación',
  CANCELAR:    'Cancelado por Planificación',
};

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE
// ══════════════════════════════════════════════════════════════════════════════

export const FlightPlanningBoard: React.FC<FlightPlanningBoardProps> = ({ userRole = 'PLANIFICADOR', userProfile }) => {

  // ── Semana / filtros ────────────────────────────────────────────────────
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [sede, setSede] = useState<SedeFiltro>(() => {
    const s = normSede(userProfile?.sede);
    return s === 'BARQUISIMETO' || s === 'MATURIN' ? s : 'TODAS';
  });
  const [soloSemana, setSoloSemana] = useState(false);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rango = useMemo(() => ({
    desde: toYMD(weekStart),
    hasta: toYMD(addDays(weekStart, VENTANA_DIAS - 1)),
  }), [weekStart]);

  // ── Data ────────────────────────────────────────────────────────────────
  const [data, setData]       = useState<TableroData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [aviso, setAviso]     = useState<string | null>(null);

  // ── Modal ───────────────────────────────────────────────────────────────
  const [selected, setSelected]   = useState<PlanReserva | null>(null);
  const [mode, setMode]           = useState<ModalMode>('CONFIRMAR');
  const [form, setForm]           = useState({ fecha: '', slot: '', aeronave_id: '', instructor_id: '', motivo: '' });
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [eventos, setEventos]     = useState<EventoReserva[]>([]);
  const [loadingEventos, setLoadingEventos] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoyYMD = data.hoy ?? toYMD(new Date());

  // ════════════════════════════════════════════════════════════════════════
  // FETCH
  // ════════════════════════════════════════════════════════════════════════

  const fetchBoard = useCallback(async (silent = false) => {
    if (silent) setSyncing(true); else setLoading(true);
    setError(null);
    try {
      const { data: res, error: rpcError } = await supabase.rpc('fn_plan_tablero', {
        p_desde: rango.desde,
        p_hasta: rango.hasta,
        // Traer recursos de TODAS las sedes; filtrar las reservas localmente.
        // La RPC limita instructores por p_sede: evita ocultar capitanes de otras sedes.
        p_sede: null,
      });
      if (rpcError) throw new Error(rpcError.message);

      const raw = (res ?? {}) as any;
      setData({
        hoy: raw.hoy ?? null,
        reservas: (raw.reservas ?? []).map((r: any): PlanReserva => ({
          id:                   String(r.id),
          student_id:           String(r.student_id),
          alumno_nombre:        r.alumno_nombre ?? 'ALUMNO',
          alumno_serial:        r.alumno_serial ?? null,
          alumno_sede:          normSede(r.alumno_sede),
          aeronave_id:          r.aeronave_id ? String(r.aeronave_id) : null,
          aeronave_matricula:   r.aeronave_matricula ?? null,
          instructor_id:        r.instructor_id ? String(r.instructor_id) : null,
          instructor_nombre:    r.instructor_nombre ?? null,
          fecha:                String(r.fecha),
          slot_hora:            hm(r.slot_hora),
          horas_planificadas:   num(r.horas_planificadas, 2),
          horas_reales:         r.horas_reales != null ? num(r.horas_reales) : null,
          tipo_vuelo:           r.tipo_vuelo ?? null,
          status:               String(r.status ?? 'SOLICITADA').toUpperCase() as EstadoReserva,
          motivo_cierre:        r.motivo_cierre ?? null,
          notas_capitan:        r.notas_capitan ?? null,
          fecha_solicitada:     r.fecha_solicitada ?? null,
          slot_solicitado:      r.slot_solicitado ? hm(r.slot_solicitado) : null,
          reprogramada:         !!r.reprogramada,
          motivo_planificacion: r.motivo_planificacion ?? null,
          created_at:           r.created_at,
          saldo_horas:          num(r.saldo_horas),
          horas_comprometidas:  num(r.horas_comprometidas),
        })).filter((r: PlanReserva) =>
          sede === 'TODAS' || r.alumno_sede === null || r.alumno_sede === sede
        ),
        aeronaves: (raw.aeronaves ?? []).map((a: any): PlanAeronave => ({
          id:             String(a.id),
          matricula:      a.matricula ?? 'S/N',
          modelo:         a.modelo ?? null,
          sede:           normSede(a.sede),
          disponible_mro: a.disponible_mro === true,
        })).filter((a: PlanAeronave) =>
          a.disponible_mro && (sede === 'TODAS' || a.sede === sede)
        ),
        instructores: (raw.instructores ?? []).map((i: any): PlanInstructor => ({
          id:              String(i.id),
          nombre_completo: i.nombre_completo ?? 'CAPITÁN',
          sede:            normSede(i.sede),
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error cargando el tablero.';
      console.error('[PLANIFICACION]', msg);
      setError(msg);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [rango.desde, rango.hasta, sede]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Realtime: cualquier cambio de reservas (alumno solicita/cancela, capitán cierra, otro planificador)
  useEffect(() => {
    const ch = supabase
      .channel('planificacion-vuelo-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas_slot_vuelo' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchBoard(true), 600);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flota_aviones' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchBoard(true), 600);
      })
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [fetchBoard]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  // ════════════════════════════════════════════════════════════════════════
  // DERIVADOS
  // ════════════════════════════════════════════════════════════════════════

  const ocupacion = useMemo(() => {
    const map = new Map<string, CeldaOcupacion>();
    data.reservas.forEach(r => {
      if (r.status !== 'CONFIRMADA' && r.status !== 'SOLICITADA') return;
      const k = slotKey(r.fecha, r.slot_hora);
      const cell = map.get(k) ?? { conf: [], sol: [] };
      if (r.status === 'CONFIRMADA') cell.conf.push(r); else cell.sol.push(r);
      map.set(k, cell);
    });
    return map;
  }, [data.reservas]);

  /** Capacidad por sede = min(aeronaves operativas, capitanes activos) */
  const capacidadPorSede = useMemo(() => {
    const sedes = new Set<string>();
    data.aeronaves.forEach(a => sedes.add(a.sede ?? 'SIN SEDE'));
    data.instructores.forEach(i => sedes.add(i.sede ?? 'SIN SEDE'));
    const map = new Map<string, { capacidad: number; aeronaves: number; instructores: number }>();
    sedes.forEach(s => {
      const av  = data.aeronaves.filter(a => a.disponible_mro && (a.sede ?? 'SIN SEDE') === s).length;
      const ins = data.instructores.filter(i => (i.sede ?? 'SIN SEDE') === s).length;
      map.set(s, { capacidad: Math.min(av, ins), aeronaves: av, instructores: ins });
    });
    return map;
  }, [data.aeronaves, data.instructores]);

  const capacidadTotal = useMemo(
    () => Array.from(capacidadPorSede.values()).reduce((a, c) => a + c.capacidad, 0),
    [capacidadPorSede],
  );

  const capacidadAlumno = useCallback((sedeAlumno: string | null) => {
    if (sedeAlumno && capacidadPorSede.has(sedeAlumno)) return capacidadPorSede.get(sedeAlumno)!.capacidad;
    return capacidadTotal;
  }, [capacidadPorSede, capacidadTotal]);

  const confirmadosEnSede = useCallback((fecha: string, slot: string, sedeAlumno: string | null) => {
    const conf = ocupacion.get(slotKey(fecha, slot))?.conf ?? [];
    return sedeAlumno ? conf.filter(r => !r.alumno_sede || r.alumno_sede === sedeAlumno).length : conf.length;
  }, [ocupacion]);

  /** Estado de cada recurso en un slot concreto, excluyendo la reserva que se está planificando */
  const recursosEstado = useCallback((fecha: string, slot: string, excludeId: string | null, sedeAlumno: string | null) => {
    const conf = (ocupacion.get(slotKey(fecha, slot))?.conf ?? []).filter(r => r.id !== excludeId);
    const busyAv  = new Map<string, PlanReserva>();
    const busyIns = new Map<string, PlanReserva>();
    conf.forEach(r => {
      if (r.aeronave_id)   busyAv.set(r.aeronave_id, r);
      if (r.instructor_id) busyIns.set(r.instructor_id, r);
    });
    const aeronaves = data.aeronaves
      .filter(a => a.disponible_mro && (!sedeAlumno || a.sede === sedeAlumno))
      .map(a => ({ ...a, ocupadaPor: busyAv.get(a.id) ?? null, libre: !busyAv.has(a.id) }));
    // Listar todos los capitanes activos devueltos por la RPC; los de otra sede
    // se ven, pero no son asignables (la BD valida la sede finalmente).
    const instructores = data.instructores
      .map(i => ({
        ...i,
        ocupadoPor: busyIns.get(i.id) ?? null,
        sedeCompatible: !sedeAlumno || i.sede === sedeAlumno,
        libre: (!sedeAlumno || i.sede === sedeAlumno) && !busyIns.has(i.id),
      }))
      .sort((a, b) => Number(b.libre) - Number(a.libre) ||
        a.nombre_completo.localeCompare(b.nombre_completo, 'es'));
    return { aeronaves, instructores };
  }, [ocupacion, data.aeronaves, data.instructores]);

  const pickRecursos = useCallback((r: PlanReserva, fecha: string, slot: string, prevAv: string, prevIns: string) => {
    const est = recursosEstado(fecha, slot, r.id, r.alumno_sede);
    const av  = est.aeronaves.find(a => a.id === prevAv && a.libre) ?? est.aeronaves.find(a => a.libre);
    const ins = est.instructores.find(i => i.id === prevIns && i.libre) ?? est.instructores.find(i => i.libre);
    return { aeronave_id: av?.id ?? '', instructor_id: ins?.id ?? '' };
  }, [recursosEstado]);

  /** Próximos slots con aeronave + capitán libres para el alumno (dentro de la ventana cargada) */
  const sugerenciasPara = useCallback((r: PlanReserva) => {
    const out: { fecha: string; slot: string; libres: number }[] = [];
    const inicio = r.fecha < hoyYMD ? hoyYMD : r.fecha;
    let d = parseYMD(inicio);
    const fin = parseYMD(rango.hasta);
    while (d <= fin && out.length < 6) {
      const f = toYMD(d);
      for (const s of SLOTS_OPERATIVOS) {
        if (out.length >= 6) break;
        if (f === r.fecha && s === r.slot_hora) continue;
        if (f === hoyYMD && s <= ahoraHM()) continue;
        const cell = ocupacion.get(slotKey(f, s));
        const alumnoOcupado = [...(cell?.conf ?? []), ...(cell?.sol ?? [])]
          .some(x => x.student_id === r.student_id && x.id !== r.id);
        if (alumnoOcupado) continue;
        const est = recursosEstado(f, s, r.id, r.alumno_sede);
        const libres = Math.min(est.aeronaves.filter(a => a.libre).length, est.instructores.filter(i => i.libre).length);
        if (libres > 0) out.push({ fecha: f, slot: s, libres });
      }
      d = addDays(d, 1);
    }
    return out;
  }, [hoyYMD, rango.hasta, ocupacion, recursosEstado]);

  const semanaYMD = useMemo(() => new Set(weekDays.map(toYMD)), [weekDays]);

  const pendientes = useMemo(() => data.reservas
    .filter(r => r.status === 'SOLICITADA')
    .filter(r => !soloSemana || semanaYMD.has(r.fecha))
    .sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
      || a.slot_hora.localeCompare(b.slot_hora)
      || String(a.created_at).localeCompare(String(b.created_at))),
  [data.reservas, soloSemana, semanaYMD]);

  const stats = useMemo(() => {
    const semana = data.reservas.filter(r => semanaYMD.has(r.fecha));
    const confirmadas = semana.filter(r => r.status === 'CONFIRMADA').length;
    const hoyConf = data.reservas.filter(r => r.fecha === hoyYMD && r.status === 'CONFIRMADA').length;
    const diasOperativos = weekDays.filter(d => toYMD(d) >= hoyYMD).length;
    const capacidadSemana = capacidadTotal * SLOTS_OPERATIVOS.length * Math.max(diasOperativos, 0);
    const vencidas = data.reservas.filter(r => r.status === 'SOLICITADA' && r.fecha < hoyYMD).length;
    return {
      pendientes: data.reservas.filter(r => r.status === 'SOLICITADA').length,
      vencidas,
      confirmadas,
      hoyConf,
      ocupacionPct: capacidadSemana > 0
        ? Math.round((semana.filter(r => r.status === 'CONFIRMADA' && r.fecha >= hoyYMD).length / capacidadSemana) * 100)
        : 0,
      aeronavesOps: data.aeronaves.filter(a => a.disponible_mro).length,
      aeronavesMro: data.aeronaves.filter(a => !a.disponible_mro).length,
      instructores: data.instructores.length,
    };
  }, [data, semanaYMD, hoyYMD, weekDays, capacidadTotal]);

  const weekLabel = useMemo(() => {
    const a = weekDays[0], b = weekDays[6];
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} ${MONTHS_ES[a.getMonth()]} ${a.getFullYear()}`
      : `${a.getDate()} ${MONTHS_ES[a.getMonth()].slice(0, 3)} – ${b.getDate()} ${MONTHS_ES[b.getMonth()].slice(0, 3)} ${b.getFullYear()}`;
  }, [weekDays]);

  // ════════════════════════════════════════════════════════════════════════
  // MODAL
  // ════════════════════════════════════════════════════════════════════════

  const fetchEventos = useCallback(async (reservaId: string) => {
    setLoadingEventos(true);
    const { data: ev, error: evError } = await supabase
      .from('reservas_slot_eventos')
      .select('id, accion, detalle, actor, created_at')
      .eq('reserva_id', reservaId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (!evError) setEventos((ev ?? []) as EventoReserva[]);
    else setEventos([]);
    setLoadingEventos(false);
  }, []);

  const openModal = (r: PlanReserva, m: ModalMode) => {
    setSelected(r);
    setMode(m);
    setFormError(null);
    let fecha = r.fecha;
    let slot  = r.slot_hora;
    if (m === 'REPROGRAMAR') {
      const sug = sugerenciasPara(r)[0];
      if (sug) { fecha = sug.fecha; slot = sug.slot; }
    }
    setForm({
      fecha, slot, motivo: '',
      ...pickRecursos(r, fecha, slot, r.aeronave_id ?? '', r.instructor_id ?? ''),
    });
    fetchEventos(r.id);
  };

  const switchMode = (m: ModalMode) => {
    if (!selected) return;
    setMode(m);
    setFormError(null);
    if (m === 'CONFIRMAR') {
      setForm(p => ({
        ...p, fecha: selected.fecha, slot: selected.slot_hora,
        ...pickRecursos(selected, selected.fecha, selected.slot_hora, p.aeronave_id, p.instructor_id),
      }));
    }
    if (m === 'REPROGRAMAR' && form.fecha === selected.fecha && form.slot === selected.slot_hora) {
      const sug = sugerenciasPara(selected)[0];
      if (sug) setTarget(sug.fecha, sug.slot);
    }
  };

  const setTarget = (fecha: string, slot: string) => {
    if (!selected) return;
    setForm(p => ({ ...p, fecha, slot, ...pickRecursos(selected, fecha, slot, p.aeronave_id, p.instructor_id) }));
  };

  const closeModal = () => {
    if (saving) return;
    setSelected(null);
    setEventos([]);
    setFormError(null);
  };

  const submit = async () => {
    if (!selected) return;
    setFormError(null);

    if (mode === 'RECHAZAR') {
      if (!form.motivo.trim()) { setFormError('Indique el motivo.'); return; }
      setSaving(true);
      const { error: rpcError } = await supabase.rpc('fn_plan_rechazar', {
        p_reserva_id: selected.id,
        p_motivo:     form.motivo.trim().toUpperCase(),
      });
      setSaving(false);
      if (rpcError) { setFormError(rpcError.message); return; }
      setAviso(`${selected.status === 'SOLICITADA' ? 'Solicitud rechazada' : 'Vuelo cancelado'} · ${selected.alumno_nombre}`);
      setSelected(null);
      await fetchBoard(true);
      return;
    }

    if (!form.fecha || !form.slot) { setFormError('Seleccione fecha y horario.'); return; }
    if (!form.aeronave_id)         { setFormError('No hay aeronave libre en ese slot. Reprograme.'); return; }
    if (!form.instructor_id)       { setFormError('No hay capitán libre en ese slot. Reprograme.'); return; }

    const cambiaFecha = form.fecha !== selected.fecha || form.slot !== selected.slot_hora;
    const accion = mode === 'REPROGRAMAR' || cambiaFecha
      ? 'REPROGRAMAR'
      : selected.status === 'CONFIRMADA' ? 'REASIGNAR' : 'CONFIRMAR';

    if (accion === 'REPROGRAMAR' && !form.motivo.trim()) { setFormError('El motivo de reprogramación es obligatorio.'); return; }

    setSaving(true);
    const { error: rpcError } = await supabase.rpc('fn_plan_asignar', {
      p_reserva_id:    selected.id,
      p_fecha:         form.fecha,
      p_slot:          form.slot,
      p_aeronave_id:   form.aeronave_id,
      p_instructor_id: form.instructor_id,
      p_motivo:        form.motivo.trim() ? form.motivo.trim().toUpperCase() : null,
      p_accion:        accion,
    });
    setSaving(false);
    if (rpcError) { setFormError(rpcError.message); return; }

    const av  = data.aeronaves.find(a => a.id === form.aeronave_id)?.matricula ?? '';
    const ins = data.instructores.find(i => i.id === form.instructor_id)?.nombre_completo ?? '';
    setAviso(`${accion === 'REPROGRAMAR' ? 'Reprogramado' : accion === 'REASIGNAR' ? 'Reasignado' : 'Confirmado'} · ${selected.alumno_nombre} · ${fmtDateLong(form.fecha)} ${form.slot} · ${av} · ${nombreCorto(ins)}`);
    setSelected(null);
    await fetchBoard(true);
  };

  // ════════════════════════════════════════════════════════════════════════
  // SUB-RENDERS
  // ════════════════════════════════════════════════════════════════════════

  const OcupacionBadge: React.FC<{ usados: number; cap: number }> = ({ usados, cap }) => {
    const lleno = cap === 0 || usados >= cap;
    const alto  = !lleno && cap > 0 && usados / cap >= 0.75;
    return (
      <span className={`px-2 py-0.5 rounded-md border text-[8px] font-black font-mono ${
        lleno ? 'text-red-400 bg-red-500/10 border-red-500/25'
        : alto ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
        : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'}`}>
        {cap === 0 ? 'SIN CAPACIDAD' : `${usados}/${cap}${lleno ? ' LLENO' : ''}`}
      </span>
    );
  };

  const renderRecursos = () => {
    if (!selected) return null;
    const est = recursosEstado(form.fecha, form.slot, selected.id, selected.alumno_sede);
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Plane size={10} /> Aeronave
          </p>
          <div className="space-y-1.5">
            {est.aeronaves.length === 0 && <p className="text-[9px] text-zinc-600 font-mono">Sin aeronaves en esta sede.</p>}
            {est.aeronaves.map(a => {
              const sel = form.aeronave_id === a.id;
              return (
                <button key={a.id} type="button" disabled={!a.libre}
                  onClick={() => setForm(p => ({ ...p, aeronave_id: a.id }))}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all
                    ${!a.libre ? 'opacity-40 cursor-not-allowed bg-white/[0.01] border-white/5'
                    : sel ? 'bg-[#E1AD01]/10 border-[#E1AD01]/40'
                    : 'bg-white/[0.02] border-white/10 hover:border-white/25'}`}>
                  <span className="flex items-center gap-2">
                    <span className={`text-[10px] font-black uppercase ${sel ? 'text-[#E1AD01]' : 'text-white'}`}>{a.matricula}</span>
                    {a.modelo && <span className="text-[8px] text-zinc-600 font-mono">{a.modelo}</span>}
                  </span>
                  {!a.disponible_mro
                    ? <span className="text-[7px] font-black text-red-400 uppercase flex items-center gap-1"><Wrench size={8} /> MRO</span>
                    : a.ocupadaPor
                    ? <span className="text-[7px] font-black text-amber-400 uppercase truncate max-w-[110px]">Ocupada · {nombreCorto(a.ocupadaPor.alumno_nombre)}</span>
                    : sel ? <CheckCircle2 size={12} className="text-[#E1AD01]" />
                    : <span className="text-[7px] font-black text-emerald-400 uppercase">Libre</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <User size={10} /> Capitán
          </p>
          <div className="space-y-1.5 max-h-[230px] overflow-y-auto pr-1">
            {est.instructores.length === 0 && <p className="text-[9px] text-zinc-600 font-mono">La RPC no devolvió capitanes activos.</p>}
            {est.instructores.map(i => {
              const sel = form.instructor_id === i.id;
              return (
                <button key={i.id} type="button" disabled={!i.libre}
                  onClick={() => setForm(p => ({ ...p, instructor_id: i.id }))}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all
                    ${!i.libre ? 'opacity-40 cursor-not-allowed bg-white/[0.01] border-white/5'
                    : sel ? 'bg-[#E1AD01]/10 border-[#E1AD01]/40'
                    : 'bg-white/[0.02] border-white/10 hover:border-white/25'}`}>
                  <span className={`text-[10px] font-black uppercase truncate ${sel ? 'text-[#E1AD01]' : 'text-white'}`} title={i.nombre_completo}>
                    {i.nombre_completo}
                    {i.sede && <span className="ml-2 text-[8px] font-normal text-zinc-500">{i.sede}</span>}
                  </span>
                  {!i.sedeCompatible
                    ? <span className="text-[7px] font-black text-zinc-500 uppercase shrink-0">Otra sede</span>
                    : i.ocupadoPor
                    ? <span className="text-[7px] font-black text-amber-400 uppercase shrink-0">En vuelo · {i.ocupadoPor.aeronave_matricula ?? ''}</span>
                    : sel ? <CheckCircle2 size={12} className="text-[#E1AD01] shrink-0" />
                    : <span className="text-[7px] font-black text-emerald-400 uppercase shrink-0">Libre</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 text-white font-mono animate-in fade-in duration-500">

      {/* CABECERA */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#080808]">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(225,173,1,0.10),transparent_35%)]" />
        <div className="relative p-6 md:p-7 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#E1AD01]/10 border border-[#E1AD01]/20 flex items-center justify-center">
              <CalendarDays size={25} className="text-[#E1AD01]" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-black uppercase italic tracking-tight">
                Planificación de <span className="text-[#E1AD01]">Vuelo</span>
              </h1>
              <p className="text-[9px] md:text-[10px] text-zinc-500 uppercase tracking-[0.25em] font-black mt-1">
                Operación Águilas · Confirmación y reprogramación de slots
              </p>
              <p className="text-[9px] text-[#E1AD01]/70 uppercase mt-2">
                {userProfile?.nombre_completo ?? 'Planificador'} · {userRole}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
            <div className="flex bg-black/70 border border-white/10 rounded-xl p-1">
              {SEDES.map(s => (
                <button key={s} type="button" onClick={() => setSede(s)}
                  className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5
                    ${sede === s ? 'bg-[#E1AD01] text-black' : 'text-zinc-500 hover:text-white'}`}>
                  {s !== 'TODAS' && <MapPin size={10} />}{s === 'BARQUISIMETO' ? 'BQTO' : s}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between bg-black/70 border border-white/10 rounded-xl p-1">
              <button type="button" onClick={() => setWeekStart(p => addDays(p, -7))}
                className="p-2.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5"><ChevronLeft size={16} /></button>
              <div className="px-4 min-w-[190px] text-center">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-[0.25em]">Semana</p>
                <p className="text-[10px] font-black uppercase tracking-widest mt-0.5">{weekLabel}</p>
              </div>
              <button type="button" onClick={() => setWeekStart(p => addDays(p, 7))}
                className="p-2.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5"><ChevronRight size={16} /></button>
            </div>
            <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="px-4 py-3 rounded-xl border border-white/10 bg-white/[0.02] text-zinc-400 hover:text-white text-[9px] font-black uppercase tracking-widest">
              Hoy
            </button>
            <button type="button" onClick={() => fetchBoard(true)} title="Actualizar"
              className="px-3 py-3 rounded-xl border border-white/10 bg-white/[0.02] text-zinc-400 hover:text-[#E1AD01]">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* AVISOS */}
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">Error de enlace operacional</p>
            <p className="text-[9px] text-red-400/70 mt-1">{error}</p>
          </div>
        </div>
      )}
      {aviso && (
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          <p className="text-[10px] font-black text-emerald-400 uppercase tracking-wider">{aviso}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Por confirmar</span>
            <Inbox size={13} className="text-sky-400" />
          </div>
          <p className="text-2xl font-black italic text-sky-400 mt-2">{stats.pendientes}</p>
          <p className="text-[7px] text-zinc-600 uppercase font-black mt-1">
            {stats.vencidas > 0 ? <span className="text-red-400">{stats.vencidas} con fecha vencida</span> : 'solicitudes de alumnos'}
          </p>
        </div>
        <div className="rounded-2xl border border-[#E1AD01]/20 bg-[#E1AD01]/[0.04] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Confirmados</span>
            <ShieldCheck size={13} className="text-[#E1AD01]" />
          </div>
          <p className="text-2xl font-black italic text-[#E1AD01] mt-2">{stats.confirmadas}</p>
          <p className="text-[7px] text-zinc-600 uppercase font-black mt-1">esta semana · {stats.hoyConf} hoy</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Ocupación</span>
            <Gauge size={13} className="text-zinc-500" />
          </div>
          <p className={`text-2xl font-black italic mt-2 ${stats.ocupacionPct >= 90 ? 'text-red-400' : stats.ocupacionPct >= 70 ? 'text-amber-400' : 'text-white'}`}>
            {stats.ocupacionPct}<span className="text-xs text-zinc-600 ml-1">%</span>
          </p>
          <p className="text-[7px] text-zinc-600 uppercase font-black mt-1">capacidad restante de la semana</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Recursos</span>
            <Users size={13} className="text-zinc-500" />
          </div>
          <p className="text-2xl font-black italic text-white mt-2">{capacidadTotal}<span className="text-xs text-zinc-600 ml-1">/slot</span></p>
          <p className="text-[7px] text-zinc-600 uppercase font-black mt-1">
            {stats.aeronavesOps} aeronaves · {stats.instructores} capitanes
            {stats.aeronavesMro > 0 && <span className="text-red-400"> · {stats.aeronavesMro} MRO</span>}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-[#080808] py-28 flex flex-col items-center justify-center">
          <Loader2 size={28} className="animate-spin text-[#E1AD01]" />
          <p className="text-[9px] text-zinc-600 uppercase tracking-[0.3em] font-black mt-4">Sincronizando tablero de vuelo...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

          {/* BANDEJA DE SOLICITUDES */}
          <div className="xl:col-span-4 rounded-3xl border border-white/10 bg-[#080808] overflow-hidden flex flex-col">
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Inbox size={14} className="text-sky-400" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Bandeja de solicitudes</h3>
                <span className="text-[9px] font-black text-sky-400 border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 rounded-full">{pendientes.length}</span>
              </div>
              <button type="button" onClick={() => setSoloSemana(v => !v)}
                className={`text-[8px] font-black uppercase px-2.5 py-1.5 rounded-lg border transition-all
                  ${soloSemana ? 'text-[#E1AD01] border-[#E1AD01]/30 bg-[#E1AD01]/10' : 'text-zinc-500 border-white/10 hover:text-white'}`}>
                {soloSemana ? 'Solo esta semana' : 'Todas'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[720px] p-4 space-y-2">
              {pendientes.length === 0 && (
                <div className="text-center py-16">
                  <CheckCircle2 size={22} className="mx-auto text-emerald-500/40" />
                  <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest mt-3">Sin solicitudes pendientes</p>
                </div>
              )}
              {pendientes.map(r => {
                const cap        = capacidadAlumno(r.alumno_sede);
                const usados     = confirmadosEnSede(r.fecha, r.slot_hora, r.alumno_sede);
                const disponible = r.saldo_horas - r.horas_comprometidas;
                const sinSaldo   = disponible < r.horas_planificadas;
                const vencida    = r.fecha < hoyYMD || (r.fecha === hoyYMD && r.slot_hora <= ahoraHM());
                return (
                  <div key={r.id} className={`rounded-2xl border p-4 transition-all
                    ${vencida ? 'border-red-500/25 bg-red-500/[0.03]' : 'border-sky-500/15 bg-sky-500/[0.03] hover:border-sky-500/35'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase truncate">{r.alumno_nombre}</p>
                        <p className="text-[8px] text-zinc-500 mt-0.5 truncate">
                          {r.alumno_serial ?? 'S/SERIAL'} · {r.alumno_sede ?? 'SIN SEDE'} · {r.tipo_vuelo ?? 'VUELO'}
                        </p>
                      </div>
                      <OcupacionBadge usados={usados} cap={cap} />
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center gap-2">
                        <Clock3 size={11} className="text-[#E1AD01]" />
                        <span className="text-[11px] font-black text-[#E1AD01]">{fmtDateLong(r.fecha)} · {r.slot_hora}</span>
                      </div>
                      <span className="text-[7px] text-zinc-600">{haceCuanto(r.created_at)}</span>
                    </div>

                    <div className="flex items-center justify-between mt-2 text-[8px]">
                      <span className={sinSaldo ? 'text-red-400 font-black' : 'text-zinc-500'}>
                        Saldo libre {disponible.toFixed(1)}h · requiere {r.horas_planificadas.toFixed(1)}h
                      </span>
                      {vencida && <span className="text-red-400 font-black uppercase">Hora vencida</span>}
                    </div>

                    {r.motivo_planificacion && (
                      <p className="text-[8px] text-amber-400/80 mt-2 uppercase">{r.motivo_planificacion}</p>
                    )}

                    <div className="grid grid-cols-3 gap-1.5 mt-3">
                      <button type="button" onClick={() => openModal(r, 'CONFIRMAR')} disabled={vencida}
                        className="py-2 rounded-xl text-[8px] font-black uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-30 flex items-center justify-center gap-1">
                        <CheckCircle2 size={10} /> Confirmar
                      </button>
                      <button type="button" onClick={() => openModal(r, 'REPROGRAMAR')}
                        className="py-2 rounded-xl text-[8px] font-black uppercase bg-[#E1AD01]/10 text-[#E1AD01] border border-[#E1AD01]/25 hover:bg-[#E1AD01]/20 flex items-center justify-center gap-1">
                        <Repeat size={10} /> Reprog.
                      </button>
                      <button type="button" onClick={() => openModal(r, 'RECHAZAR')}
                        className="py-2 rounded-xl text-[8px] font-black uppercase bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 flex items-center justify-center gap-1">
                        <XCircle size={10} /> Rechazar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TABLERO SEMANAL */}
          <div className="xl:col-span-8 rounded-3xl border border-white/10 bg-[#080808] overflow-hidden">
            <div className="p-5 border-b border-white/5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={14} className="text-[#E1AD01]" />
                <h3 className="text-[10px] font-black uppercase tracking-widest">Ocupación por slot</h3>
              </div>
              <div className="flex items-center gap-3 text-[7px] font-black uppercase text-zinc-600">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/40" /> Libre</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/50" /> +75%</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-500/50" /> Lleno</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-sky-500/50" /> Solicitud</span>
              </div>
            </div>

            <div className="overflow-x-auto p-4">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[72px_repeat(7,1fr)] gap-1.5 mb-1.5">
                  <div />
                  {weekDays.map(d => {
                    const ymd = toYMD(d);
                    const esHoy = ymd === hoyYMD;
                    return (
                      <div key={ymd} className={`rounded-xl border p-2 text-center ${esHoy ? 'border-[#E1AD01]/30 bg-[#E1AD01]/[0.07]' : 'border-white/5 bg-white/[0.02]'}`}>
                        <p className={`text-[8px] font-black uppercase tracking-widest ${esHoy ? 'text-[#E1AD01]' : 'text-zinc-500'}`}>{DAYS_ES[d.getDay()]}</p>
                        <p className={`text-lg font-black italic leading-none mt-1 ${esHoy ? 'text-[#E1AD01]' : 'text-white'}`}>{d.getDate()}</p>
                      </div>
                    );
                  })}
                </div>

                {SLOTS.map(slot => (
                  <div key={slot.hora} className="grid grid-cols-[72px_repeat(7,1fr)] gap-1.5 mb-1.5">
                    <div className="flex flex-col justify-center">
                      <p className="text-[10px] font-black text-[#E1AD01]">{slot.hora}</p>
                      {slot.bloqueado && <p className="text-[6px] text-zinc-600 font-black uppercase">Almuerzo</p>}
                    </div>
                    {weekDays.map(d => {
                      const ymd = toYMD(d);
                      if (slot.bloqueado) {
                        return (
                          <div key={ymd} className="rounded-xl border border-white/[0.03] bg-white/[0.01] min-h-[70px] flex items-center justify-center">
                            <Lock size={10} className="text-zinc-800" />
                          </div>
                        );
                      }
                      const cell  = ocupacion.get(slotKey(ymd, slot.hora)) ?? { conf: [], sol: [] };
                      const cap   = sede === 'TODAS' ? capacidadTotal : capacidadAlumno(sede);
                      const pasado = ymd < hoyYMD || (ymd === hoyYMD && slot.hora <= ahoraHM());
                      const ratio = cap > 0 ? cell.conf.length / cap : 1;
                      const tone  = pasado ? 'border-white/[0.04] bg-white/[0.01] opacity-50'
                        : cap === 0 || ratio >= 1 ? 'border-red-500/25 bg-red-500/[0.05]'
                        : ratio >= 0.75 ? 'border-amber-500/25 bg-amber-500/[0.04]'
                        : 'border-emerald-500/15 bg-emerald-500/[0.02]';
                      return (
                        <div key={ymd} className={`rounded-xl border p-1.5 min-h-[70px] flex flex-col gap-1 ${tone}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-black text-zinc-400">{cell.conf.length}/{cap}</span>
                            {cell.sol.length > 0 && (
                              <span className="text-[7px] font-black text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1 rounded">+{cell.sol.length}</span>
                            )}
                          </div>
                          {cell.conf.map(r => (
                            <button key={r.id} type="button" onClick={() => openModal(r, 'CONFIRMAR')}
                              title={`${r.alumno_nombre} · ${r.aeronave_matricula ?? ''} · ${r.instructor_nombre ?? ''}`}
                              className="w-full text-left rounded-md bg-[#E1AD01]/10 border border-[#E1AD01]/20 px-1.5 py-1 hover:border-[#E1AD01]/50 transition-all">
                              <p className="text-[7px] font-black text-[#E1AD01] uppercase truncate">
                                {r.aeronave_matricula ?? 'S/N'}{r.reprogramada ? ' ↻' : ''}
                              </p>
                              <p className="text-[7px] text-zinc-400 uppercase truncate">{nombreCorto(r.alumno_nombre)}</p>
                              <p className="text-[6px] text-zinc-600 uppercase truncate">Cap. {nombreCorto(r.instructor_nombre)}</p>
                            </button>
                          ))}
                          {cell.sol.map(r => (
                            <button key={r.id} type="button" onClick={() => openModal(r, 'CONFIRMAR')}
                              className="w-full text-left rounded-md bg-sky-500/10 border border-dashed border-sky-500/30 px-1.5 py-1 hover:border-sky-400 transition-all">
                              <p className="text-[7px] font-black text-sky-400 uppercase truncate">Solicita</p>
                              <p className="text-[7px] text-zinc-400 uppercase truncate">{nombreCorto(r.alumno_nombre)}</p>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL DE PLANIFICACIÓN ══════════════════════════════════════════ */}
      {selected && (() => {
        const disponible  = selected.saldo_horas - selected.horas_comprometidas;
        const sinSaldo    = disponible < selected.horas_planificadas;
        const cap         = capacidadAlumno(selected.alumno_sede);
        const sugerencias = sugerenciasPara(selected);
        const esConfirmada = selected.status === 'CONFIRMADA';
        const tabs: { key: ModalMode; label: string }[] = [
          { key: 'CONFIRMAR',   label: esConfirmada ? 'Reasignar' : 'Confirmar' },
          { key: 'REPROGRAMAR', label: 'Reprogramar' },
          { key: 'RECHAZAR',    label: esConfirmada ? 'Cancelar vuelo' : 'Rechazar' },
        ];
        const motivos = mode === 'RECHAZAR' ? MOTIVOS_RECHAZO : MOTIVOS_REPROGRAMAR;

        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
            <div className="w-full max-w-3xl rounded-3xl border border-[#E1AD01]/20 bg-[#050505] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">

              <div className="bg-[#E1AD01] text-black p-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Plane size={16} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase italic truncate">{selected.alumno_nombre}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest opacity-70">
                      {selected.alumno_serial ?? 'S/SERIAL'} · {selected.alumno_sede ?? 'SIN SEDE'} · {selected.status}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={closeModal} className="hover:rotate-90 transition-all"><X size={18} /></button>
              </div>

              <div className="p-6 space-y-5 overflow-y-auto flex-1">

                {/* Resumen */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <p className="text-[7px] text-zinc-600 uppercase font-black">Pidió</p>
                    <p className="text-[10px] font-black mt-1">{fmtDateLong(selected.fecha_solicitada ?? selected.fecha)} · {selected.slot_solicitado ?? selected.slot_hora}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <p className="text-[7px] text-zinc-600 uppercase font-black">Actual</p>
                    <p className="text-[10px] font-black text-[#E1AD01] mt-1">{fmtDateLong(selected.fecha)} · {selected.slot_hora}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <p className="text-[7px] text-zinc-600 uppercase font-black">Tipo / horas</p>
                    <p className="text-[10px] font-black mt-1">{selected.tipo_vuelo ?? 'VUELO'} · {selected.horas_planificadas.toFixed(1)}h</p>
                  </div>
                  <div className={`rounded-xl border p-3 ${sinSaldo ? 'border-red-500/30 bg-red-500/[0.05]' : 'border-emerald-500/20 bg-emerald-500/[0.03]'}`}>
                    <p className="text-[7px] text-zinc-600 uppercase font-black">Saldo libre</p>
                    <p className={`text-[10px] font-black mt-1 ${sinSaldo ? 'text-red-400' : 'text-emerald-400'}`}>
                      {disponible.toFixed(1)}h <span className="text-zinc-600 font-normal">({selected.saldo_horas.toFixed(1)} − {selected.horas_comprometidas.toFixed(1)})</span>
                    </p>
                  </div>
                </div>
                {sinSaldo && mode !== 'RECHAZAR' && (
                  <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3">
                    <AlertTriangle size={12} className="text-red-400 shrink-0" />
                    <p className="text-[9px] text-red-400 font-black uppercase">El alumno no tiene saldo suficiente. El sistema bloqueará la confirmación.</p>
                  </div>
                )}

                {/* Tabs */}
                <div className="flex bg-black/60 rounded-2xl p-1 border border-white/10 gap-1">
                  {tabs.map(t => (
                    <button key={t.key} type="button" onClick={() => switchMode(t.key)}
                      className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase transition-all
                        ${mode === t.key
                          ? t.key === 'RECHAZAR' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : t.key === 'REPROGRAMAR' ? 'bg-[#E1AD01]/15 text-[#E1AD01] border border-[#E1AD01]/30'
                          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'text-zinc-600 hover:text-zinc-300'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* CONFIRMAR / REASIGNAR */}
                {mode === 'CONFIRMAR' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-3">
                      <span className="text-[9px] font-black uppercase text-zinc-400">
                        {fmtDateLong(form.fecha)} · {form.slot}
                      </span>
                      <OcupacionBadge usados={confirmadosEnSede(form.fecha, form.slot, selected.alumno_sede) - (esConfirmada ? 1 : 0)} cap={cap} />
                    </div>
                    {renderRecursos()}
                  </div>
                )}

                {/* REPROGRAMAR */}
                {mode === 'REPROGRAMAR' && (
                  <div className="space-y-4">
                    {sugerencias.length > 0 && (
                      <div>
                        <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2">Próximos slots con cupo</p>
                        <div className="flex flex-wrap gap-1.5">
                          {sugerencias.map(s => {
                            const sel = form.fecha === s.fecha && form.slot === s.slot;
                            return (
                              <button key={`${s.fecha}-${s.slot}`} type="button" onClick={() => setTarget(s.fecha, s.slot)}
                                className={`px-3 py-2 rounded-xl border text-[9px] font-black uppercase transition-all
                                  ${sel ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/40' : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white'}`}>
                                {fmtDateLong(s.fecha)} · {s.slot} <span className="text-emerald-400 ml-1">{s.libres} libre{s.libres > 1 ? 's' : ''}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
                      <input type="date" value={form.fecha} min={hoyYMD}
                        onChange={e => e.target.value && setTarget(e.target.value, form.slot)}
                        className="bg-black/50 border border-white/10 p-3 rounded-xl text-white text-xs outline-none focus:border-[#E1AD01]/60" />
                      <div className="grid grid-cols-4 gap-1.5">
                        {SLOTS_OPERATIVOS.map(s => {
                          const usados = confirmadosEnSede(form.fecha, s, selected.alumno_sede);
                          const pasado = form.fecha < hoyYMD || (form.fecha === hoyYMD && s <= ahoraHM());
                          const sel = form.slot === s;
                          return (
                            <button key={s} type="button" disabled={pasado} onClick={() => setTarget(form.fecha, s)}
                              className={`py-2 rounded-xl border text-center transition-all disabled:opacity-25
                                ${sel ? 'bg-[#E1AD01]/15 border-[#E1AD01]/40' : 'bg-white/[0.02] border-white/10 hover:border-white/25'}`}>
                              <p className={`text-[10px] font-black ${sel ? 'text-[#E1AD01]' : 'text-white'}`}>{s}</p>
                              <p className={`text-[7px] font-black ${usados >= cap ? 'text-red-400' : 'text-zinc-500'}`}>{usados}/{cap}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {renderRecursos()}
                  </div>
                )}

                {/* RECHAZAR / CANCELAR */}
                {mode === 'RECHAZAR' && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3">
                    <p className="text-[9px] text-red-400 font-black uppercase">
                      {esConfirmada
                        ? 'El vuelo confirmado se cancelará y el capitán y la aeronave quedarán libres.'
                        : 'La solicitud quedará rechazada. El alumno verá el motivo en su calendario.'}
                    </p>
                  </div>
                )}

                {/* Motivo */}
                <div>
                  <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2">
                    Motivo {mode === 'CONFIRMAR' ? '(opcional)' : '*'}
                  </p>
                  {mode !== 'CONFIRMAR' && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {motivos.map(m => (
                        <button key={m} type="button" onClick={() => setForm(p => ({ ...p, motivo: m }))}
                          className={`px-2.5 py-1.5 rounded-lg border text-[8px] font-black uppercase transition-all
                            ${form.motivo === m ? 'text-[#E1AD01] border-[#E1AD01]/40 bg-[#E1AD01]/10' : 'text-zinc-500 border-white/10 hover:text-white'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea rows={2} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))}
                    placeholder={mode === 'CONFIRMAR' ? 'Nota para el capitán / alumno' : 'Describa el motivo'}
                    className="w-full bg-black/50 border border-white/10 p-3 rounded-xl text-white text-xs outline-none focus:border-[#E1AD01]/60 resize-none uppercase placeholder:normal-case placeholder:text-zinc-700" />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] p-3">
                    <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[9px] text-red-400 font-black">{formError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button type="button" onClick={closeModal}
                    className="flex-1 py-4 rounded-2xl border border-white/10 text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">
                    Cerrar
                  </button>
                  <button type="button" onClick={submit} disabled={saving}
                    className={`flex-[2] py-4 rounded-2xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40
                      ${mode === 'RECHAZAR' ? 'bg-red-500 text-white hover:bg-red-400'
                      : mode === 'REPROGRAMAR' ? 'bg-[#E1AD01] text-black hover:bg-white'
                      : 'bg-emerald-500 text-black hover:bg-emerald-400'}`}>
                    {saving ? <Loader2 size={14} className="animate-spin" />
                      : mode === 'RECHAZAR' ? <XCircle size={14} />
                      : mode === 'REPROGRAMAR' ? <Repeat size={14} /> : <ShieldCheck size={14} />}
                    {mode === 'RECHAZAR' ? (esConfirmada ? 'Cancelar vuelo' : 'Rechazar solicitud')
                      : mode === 'REPROGRAMAR' ? 'Reprogramar y confirmar'
                      : esConfirmada ? 'Guardar reasignación' : 'Confirmar vuelo'}
                  </button>
                </div>

                {/* Trazabilidad */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <History size={10} /> Trazabilidad
                  </p>
                  {loadingEventos ? (
                    <Loader2 size={14} className="animate-spin text-zinc-600" />
                  ) : eventos.length === 0 ? (
                    <p className="text-[8px] text-zinc-700">Sin eventos registrados.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {eventos.map(ev => (
                        <div key={ev.id} className="flex items-start justify-between gap-3 text-[8px]">
                          <div className="min-w-0">
                            <p className="font-black uppercase text-zinc-300">{ACCION_LABEL[ev.accion] ?? ev.accion.replace(/_/g, ' ')}</p>
                            {ev.detalle?.a?.fecha && (
                              <p className="text-zinc-600 truncate">
                                {ev.detalle?.de?.fecha ? `${ev.detalle.de.fecha} ${hm(ev.detalle.de.slot)} → ` : ''}
                                {ev.detalle.a.fecha} {hm(ev.detalle.a.slot)} {ev.detalle.a.aeronave ? `· ${ev.detalle.a.aeronave}` : ''}
                              </p>
                            )}
                            {ev.detalle?.motivo && <p className="text-amber-400/70 truncate">{ev.detalle.motivo}</p>}
                          </div>
                          <span className="text-zinc-600 shrink-0">{fmtDateTime(ev.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default FlightPlanningBoard
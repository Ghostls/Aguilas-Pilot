// src/components/FlightPlanningboard.tsx
// VALKYRON OS v1.2 — PLANIFICACIÓN DE VUELO · B&M MANTENIMIENTO AERONÁUTICO
// (nombre de archivo con "b" minúscula: así lo importan App.tsx e Index.tsx; en
//  Linux/Vercel el import distingue mayúsculas)
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v1.2 — REBRAND B&M + CONEXIONES:
//   [FIX] Aeronaves en MRO invisibles: el tablero descartaba al leer las que
//         tienen disponible_mro = false, así que el KPI "· N MRO" nunca aparecía
//         y el selector no podía mostrarlas como "En MRO". Ahora se conservan:
//         cuentan aparte, se listan bloqueadas y nunca son asignables.
//   [FIX] Tablero fuera de orden: al cambiar rápido de semana o sede, una
//         respuesta vieja de fn_plan_tablero podía pintarse sobre la nueva. Solo
//         pinta la última lectura (contador de secuencia).
//   [FIX] Trazabilidad cruzada: al abrir otra reserva antes de que llegaran los
//         eventos de la anterior, se mostraban los eventos equivocados.
//   [FIX] Reserva modificada por otro usuario con el modal abierto: se guardaba
//         sobre datos viejos (p. ej. "Confirmar" sobre una ya confirmada). El
//         modal se actualiza con la fila nueva y avisa antes de guardar.
//   [FIX] Una excepción de red en fn_plan_asignar / fn_plan_rechazar dejaba el
//         botón en "guardando" para siempre (try/finally).
//   [FIX] Canal realtime con sufijo único (remontajes reutilizaban un canal ya
//         suscrito) y escucha de ordenes_trabajo (la disponibilidad MRO cambia
//         al abrir o cerrar órdenes).
//   [NEW] Aviso al reprogramar a una fecha posterior a la ventana cargada
//         (21 días): la ocupación local puede estar incompleta.
//   [UI]  B&M: cabecera blanca con selector de sede, KPI con cifras
//         protagonistas, bandeja en tarjetas, tablero con columna de horas fija
//         al desplazar, modal en BmModal (hoja inferior en móvil, Esc, bloqueo
//         mientras guarda) y opciones con role="radio".
// PRESERVADO: flujo SOLICITADA → CONFIRMAR / REPROGRAMAR / RECHAZAR, toda
//   escritura por fn_plan_asignar / fn_plan_rechazar, lectura fn_plan_tablero
//   con p_sede null, capacidad min(aeronaves, capitanes) por sede, sugerencias
//   de reprogramación, motivos predefinidos, auditoría reservas_slot_eventos,
//   fechas locales, export nombrado y por defecto.
// ─────────────────────────────────────────────────────────────────────────────
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
import { BmBadge, BmModal, BmNotice, bmBtn, bmInput, bmTextarea } from './brand/bm-ui';   // [v1.2]

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

// [v1.2] Paleta B&M
const ESTADO_STYLE: Record<EstadoReserva, string> = {
  SOLICITADA: 'text-[#2F5BB7] bg-[#E8EEF9]',
  CONFIRMADA: 'text-bm-red-deep bg-bm-red-tint',
  COMPLETADA: 'text-bm-ok bg-bm-ok-tint',
  CANCELADA:  'text-bm-steel bg-bm-canvas',
  POSTERGADA: 'text-bm-warn bg-bm-warn-tint',
  RECHAZADA:  'text-bm-red-deep bg-bm-canvas',
};

// [NEW v1.2] Etiquetas en tipo oración
const ESTADO_LABEL: Record<EstadoReserva, string> = {
  SOLICITADA: 'Solicitada',
  CONFIRMADA: 'Confirmada',
  COMPLETADA: 'Completada',
  CANCELADA:  'Cancelada',
  POSTERGADA: 'Postergada',
  RECHAZADA:  'Rechazada',
};

const SEDE_LABEL: Record<SedeFiltro, string> = {
  TODAS:        'Todas',
  BARQUISIMETO: 'BQTO',
  MATURIN:      'Maturín',
};

const rolLegible = (rol: string | null | undefined) => {
  const t = String(rol ?? '').replace(/_/g, ' ').trim().toLowerCase();
  if (t === 'ceo') return 'CEO';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Planificador';
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
  const boardSeq    = useRef(0);   // [v1.2] solo pinta la última lectura del tablero
  const eventosSeq  = useRef(0);   // [v1.2] trazabilidad de la reserva abierta
  const hoyYMD = data.hoy ?? toYMD(new Date());

  // ════════════════════════════════════════════════════════════════════════
  // FETCH
  // ════════════════════════════════════════════════════════════════════════

  const fetchBoard = useCallback(async (silent = false) => {
    const seq = ++boardSeq.current;   // [v1.2]
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
      if (seq !== boardSeq.current) return;   // [v1.2] llegó otra lectura más nueva
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
        // [FIX v1.2] se conservan las aeronaves en MRO (bloqueadas, nunca asignables):
        // la capacidad y la asignación ya filtran por disponible_mro.
        })).filter((a: PlanAeronave) =>
          sede === 'TODAS' || a.sede === sede
        ),
        instructores: (raw.instructores ?? []).map((i: any): PlanInstructor => ({
          id:              String(i.id),
          nombre_completo: i.nombre_completo ?? 'CAPITÁN',
          sede:            normSede(i.sede),
        })),
      });
    } catch (err) {
      if (seq !== boardSeq.current) return;   // [v1.2]
      const msg = err instanceof Error ? err.message : 'Error cargando el tablero.';
      console.error('[PLANIFICACION]', msg);
      setError(msg);
    } finally {
      if (seq === boardSeq.current) {   // [v1.2]
        setLoading(false);
        setSyncing(false);
      }
    }
  }, [rango.desde, rango.hasta, sede]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Realtime: cualquier cambio de reservas (alumno solicita/cancela, capitán cierra, otro planificador)
  useEffect(() => {
    const ch = supabase
      .channel(`planificacion-vuelo-board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`)   // [v1.2] nombre único
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas_slot_vuelo' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchBoard(true), 600);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'flota_aviones' }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => fetchBoard(true), 600);
      })
      // [NEW v1.2] abrir o cerrar una orden de trabajo cambia disponible_mro
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordenes_trabajo' }, () => {
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
    // [FIX v1.2] las aeronaves en MRO se listan bloqueadas (antes desaparecían)
    const aeronaves = data.aeronaves
      .filter(a => !sedeAlumno || a.sede === sedeAlumno)
      .map(a => ({ ...a, ocupadaPor: busyAv.get(a.id) ?? null, libre: a.disponible_mro && !busyAv.has(a.id) }))
      .sort((a, b) => Number(b.disponible_mro) - Number(a.disponible_mro) ||
        a.matricula.localeCompare(b.matricula, 'es'));
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
    const seq = ++eventosSeq.current;   // [v1.2]
    setLoadingEventos(true);
    const { data: ev, error: evError } = await supabase
      .from('reservas_slot_eventos')
      .select('id, accion, detalle, actor, created_at')
      .eq('reserva_id', reservaId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (seq !== eventosSeq.current) return;   // [v1.2] ya se abrió otra reserva
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
    eventosSeq.current++;   // [v1.2] descarta eventos en vuelo
    setSelected(null);
    setEventos([]);
    setFormError(null);
  };

  // [NEW v1.2] La reserva abierta cambió en el servidor (otro planificador, el
  // alumno o el capitán): se refresca el modal y se avisa antes de guardar.
  useEffect(() => {
    if (!selected || saving) return;
    const fresh = data.reservas.find(r => r.id === selected.id);
    if (!fresh) {
      setFormError('Esta reserva ya no figura en el tablero (cancelada o fuera del filtro). Cierre y verifique.');
      return;
    }
    const cambio = fresh.status !== selected.status
      || fresh.fecha !== selected.fecha
      || fresh.slot_hora !== selected.slot_hora
      || fresh.aeronave_id !== selected.aeronave_id
      || fresh.instructor_id !== selected.instructor_id;
    if (cambio) {
      setSelected(fresh);
      setFormError('Otro usuario modificó esta reserva mientras la editaba. Revise los datos antes de guardar.');
    }
  }, [data.reservas]);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!selected) return;
    setFormError(null);

    if (mode === 'RECHAZAR') {
      if (!form.motivo.trim()) { setFormError('Indique el motivo.'); return; }
      setSaving(true);
      let rpcError: { message: string } | null = null;
      try {
        ({ error: rpcError } = await supabase.rpc('fn_plan_rechazar', {
          p_reserva_id: selected.id,
          p_motivo:     form.motivo.trim().toUpperCase(),
        }));
      } catch (e) {
        rpcError = { message: e instanceof Error ? e.message : 'Error de red al rechazar.' };   // [v1.2]
      } finally {
        setSaving(false);
      }
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
    let rpcError: { message: string } | null = null;
    try {
      ({ error: rpcError } = await supabase.rpc('fn_plan_asignar', {
        p_reserva_id:    selected.id,
        p_fecha:         form.fecha,
        p_slot:          form.slot,
        p_aeronave_id:   form.aeronave_id,
        p_instructor_id: form.instructor_id,
        p_motivo:        form.motivo.trim() ? form.motivo.trim().toUpperCase() : null,
        p_accion:        accion,
      }));
    } catch (e) {
      rpcError = { message: e instanceof Error ? e.message : 'Error de red al guardar.' };   // [v1.2]
    } finally {
      setSaving(false);
    }
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
      <span className={`bm-num inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
        lleno ? 'bg-bm-red-tint text-bm-red-deep'
        : alto ? 'bg-bm-warn-tint text-bm-warn'
        : 'bg-bm-ok-tint text-bm-ok'}`}>
        {cap === 0 ? 'Sin capacidad' : `${usados}/${cap}${lleno ? ' lleno' : ''}`}
      </span>
    );
  };

  const renderRecursos = () => {
    if (!selected) return null;
    const est = recursosEstado(form.fecha, form.slot, selected.id, selected.alumno_sede);
    const opcion = (activo: boolean, sel: boolean) =>
      `flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        !activo ? 'cursor-not-allowed border-bm-line bg-bm-canvas opacity-60'
        : sel ? 'border-bm-red bg-bm-red-tint'
        : 'border-bm-line bg-white hover:border-bm-steel/40'}`;
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-bm-steel">
            <Plane className="h-3.5 w-3.5" /> Aeronave
          </p>
          <div className="space-y-1.5" role="radiogroup" aria-label="Aeronave">
            {est.aeronaves.length === 0 && <p className="text-[13px] text-bm-hint">Sin aeronaves en esta sede.</p>}
            {est.aeronaves.map(a => {
              const sel = form.aeronave_id === a.id;
              return (
                <button key={a.id} type="button" disabled={!a.libre} role="radio" aria-checked={sel}
                  onClick={() => setForm(p => ({ ...p, aeronave_id: a.id }))}
                  className={opcion(a.libre, sel)}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`font-data text-sm font-semibold ${sel ? 'text-bm-red' : 'text-bm-ink'}`}>{a.matricula}</span>
                    {a.modelo && <span className="truncate text-xs text-bm-steel">{a.modelo}</span>}
                  </span>
                  {!a.disponible_mro
                    ? <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-bm-red-deep"><Wrench className="h-3 w-3" /> En MRO</span>
                    : a.ocupadaPor
                    ? <span className="max-w-[130px] shrink-0 truncate text-xs font-medium text-bm-warn">Ocupada · {nombreCorto(a.ocupadaPor.alumno_nombre)}</span>
                    : sel ? <CheckCircle2 className="h-4 w-4 shrink-0 text-bm-red" />
                    : <span className="shrink-0 text-xs font-medium text-bm-ok">Libre</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-bm-steel">
            <User className="h-3.5 w-3.5" /> Capitán
          </p>
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1" role="radiogroup" aria-label="Capitán">
            {est.instructores.length === 0 && <p className="text-[13px] text-bm-hint">La RPC no devolvió capitanes activos.</p>}
            {est.instructores.map(i => {
              const sel = form.instructor_id === i.id;
              return (
                <button key={i.id} type="button" disabled={!i.libre} role="radio" aria-checked={sel}
                  onClick={() => setForm(p => ({ ...p, instructor_id: i.id }))}
                  className={opcion(i.libre, sel)}>
                  <span className="min-w-0 truncate text-sm" title={i.nombre_completo}>
                    <span className={`font-semibold ${sel ? 'text-bm-red' : 'text-bm-ink'}`}>{i.nombre_completo}</span>
                    {i.sede && <span className="ml-2 text-xs text-bm-steel">{i.sede}</span>}
                  </span>
                  {!i.sedeCompatible
                    ? <span className="shrink-0 text-xs font-medium text-bm-hint">Otra sede</span>
                    : i.ocupadoPor
                    ? <span className="shrink-0 text-xs font-medium text-bm-warn">En vuelo · <span className="font-data">{i.ocupadoPor.aeronave_matricula ?? ''}</span></span>
                    : sel ? <CheckCircle2 className="h-4 w-4 shrink-0 text-bm-red" />
                    : <span className="shrink-0 text-xs font-medium text-bm-ok">Libre</span>}
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

  const kpiCard = 'flex flex-col gap-2.5 rounded-[20px] border border-bm-line bg-white p-4';

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* CABECERA */}
      <div className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
              <CalendarDays className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="bm-heading text-lg leading-tight sm:text-xl">Planificación de vuelo</h2>
              <p className="mt-0.5 text-[13px] text-bm-steel">Confirmación y reprogramación de slots</p>
              <p className="mt-1 truncate text-[13px] font-medium">
                {userProfile?.nombre_completo ?? 'Planificador'} · <span className="text-bm-steel">{rolLegible(userRole)}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full rounded-2xl border border-bm-line bg-bm-canvas p-1 sm:w-auto" role="group" aria-label="Sede">
              {SEDES.map(s => (
                <button key={s} type="button" onClick={() => setSede(s)} aria-pressed={sede === s}
                  className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors sm:flex-none ${
                    sede === s ? 'bg-bm-ink text-white' : 'text-bm-steel hover:text-bm-ink'}`}>
                  {s !== 'TODAS' && <MapPin className="h-3.5 w-3.5" />}{SEDE_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-bm-line bg-bm-canvas p-1 sm:w-auto">
              <button type="button" onClick={() => setWeekStart(p => addDays(p, -7))} aria-label="Semana anterior"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-bm-steel hover:bg-white hover:text-bm-ink"><ChevronLeft className="h-5 w-5" /></button>
              <div className="min-w-0 px-3 text-center sm:min-w-[190px]">
                <p className="text-[11px] text-bm-steel">Semana</p>
                <p className="bm-num truncate text-sm font-semibold" aria-live="polite">{weekLabel}</p>
              </div>
              <button type="button" onClick={() => setWeekStart(p => addDays(p, 7))} aria-label="Semana siguiente"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-bm-steel hover:bg-white hover:text-bm-ink"><ChevronRight className="h-5 w-5" /></button>
            </div>
            <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1 sm:!h-12 sm:flex-none`}>
              Hoy
            </button>
            <button type="button" onClick={() => fetchBoard(true)} title="Actualizar" aria-label="Actualizar tablero"
              className={`${bmBtn.icon} sm:h-12 sm:w-12`}>
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* AVISOS */}
      {error && (
        <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold">No se pudo leer el tablero de vuelo</p>
              <p className="mt-0.5 break-words font-data text-xs">{error}</p>
            </div>
            <button type="button" onClick={() => fetchBoard(false)} className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}>
              <RefreshCw className="h-4 w-4" /> Reintentar
            </button>
          </div>
        </BmNotice>
      )}
      {aviso && (
        <BmNotice tone="ok" role="status" icon={<CheckCircle2 className="h-4 w-4" />}>
          <span className="font-medium">{aviso}</span>
        </BmNotice>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={kpiCard}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-bm-steel">Por confirmar</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8EEF9] text-[#2F5BB7]"><Inbox className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="bm-figure text-[28px] text-[#2F5BB7]">{stats.pendientes}</p>
          <p className="text-xs text-bm-steel">
            {stats.vencidas > 0 ? <span className="font-medium text-bm-red">{stats.vencidas} con fecha vencida</span> : 'solicitudes de alumnos'}
          </p>
        </div>
        <div className={kpiCard}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-bm-steel">Confirmados</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bm-red-tint text-bm-red"><ShieldCheck className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="bm-figure text-[28px] text-bm-red">{stats.confirmadas}</p>
          <p className="text-xs text-bm-steel">esta semana · {stats.hoyConf} hoy</p>
        </div>
        <div className={kpiCard}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-bm-steel">Ocupación</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bm-canvas text-bm-ink"><Gauge className="h-[18px] w-[18px]" /></span>
          </div>
          <p className={`bm-figure text-[28px] ${stats.ocupacionPct >= 90 ? 'text-bm-red' : stats.ocupacionPct >= 70 ? 'text-bm-warn' : 'text-bm-ink'}`}>
            {stats.ocupacionPct}<span className="ml-0.5 text-base not-italic text-bm-steel">%</span>
          </p>
          <p className="text-xs text-bm-steel">de la capacidad que queda esta semana</p>
        </div>
        <div className={kpiCard}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-bm-steel">Recursos</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bm-canvas text-bm-ink"><Users className="h-[18px] w-[18px]" /></span>
          </div>
          <p className="bm-figure text-[28px]">{capacidadTotal}<span className="ml-1 text-sm not-italic text-bm-steel">/slot</span></p>
          <p className="text-xs leading-snug text-bm-steel">
            {stats.aeronavesOps} aeronaves · {stats.instructores} capitanes
            {stats.aeronavesMro > 0 && <span className="font-medium text-bm-red-deep"> · {stats.aeronavesMro} en MRO</span>}
          </p>
        </div>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Sincronizando tablero" className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="bm-skeleton h-[420px] rounded-[24px] xl:col-span-4" />
          <div className="bm-skeleton h-[420px] rounded-[24px] xl:col-span-8" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-5">

          {/* BANDEJA DE SOLICITUDES */}
          <section className="flex flex-col overflow-hidden rounded-[24px] border border-bm-line bg-white xl:col-span-4" aria-labelledby="fpb-bandeja">
            <div className="flex items-center justify-between gap-3 border-b border-bm-line p-4 sm:px-5">
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-[#2F5BB7]" />
                <h3 id="fpb-bandeja" className="bm-heading text-base">Solicitudes</h3>
                <BmBadge tone="info">{pendientes.length}</BmBadge>
              </div>
              <button type="button" onClick={() => setSoloSemana(v => !v)} aria-pressed={soloSemana}
                className={`h-9 shrink-0 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  soloSemana ? 'border-bm-ink bg-bm-ink text-white' : 'border-bm-line text-bm-steel hover:text-bm-ink'}`}>
                {soloSemana ? 'Solo esta semana' : 'Todas'}
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto p-3 sm:p-4 xl:max-h-[760px]">
              {pendientes.length === 0 && (
                <div className="py-14 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-bm-ok" />
                  <p className="mt-2 text-sm font-medium">Sin solicitudes pendientes</p>
                  <p className="mt-0.5 text-[13px] text-bm-steel">Las nuevas solicitudes de alumnos aparecen aquí al instante.</p>
                </div>
              )}
              {pendientes.map(r => {
                const cap        = capacidadAlumno(r.alumno_sede);
                const usados     = confirmadosEnSede(r.fecha, r.slot_hora, r.alumno_sede);
                const disponible = r.saldo_horas - r.horas_comprometidas;
                const sinSaldo   = disponible < r.horas_planificadas;
                const vencida    = r.fecha < hoyYMD || (r.fecha === hoyYMD && r.slot_hora <= ahoraHM());
                return (
                  <article key={r.id} className={`rounded-2xl border p-3.5 ${
                    vencida ? 'border-bm-red/30 bg-bm-red-tint/40' : 'border-dashed border-[#2F5BB7]/40 bg-[#F6F8FD]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">{r.alumno_nombre}</p>
                        <p className="mt-0.5 truncate text-xs text-bm-steel">
                          <span className="font-data">{r.alumno_serial ?? 'S/serial'}</span> · {r.alumno_sede ?? 'Sin sede'} · {r.tipo_vuelo ?? 'Vuelo'}
                        </p>
                      </div>
                      <OcupacionBadge usados={usados} cap={cap} />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <Clock3 className="h-4 w-4 text-bm-red" />
                        <span className="bm-num text-sm font-semibold">{fmtDateLong(r.fecha)} · {r.slot_hora}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-bm-hint">{haceCuanto(r.created_at)}</span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                      <span className={sinSaldo ? 'font-semibold text-bm-red-deep' : 'text-bm-steel'}>
                        Saldo libre <span className="bm-num">{disponible.toFixed(1)} h</span> · requiere <span className="bm-num">{r.horas_planificadas.toFixed(1)} h</span>
                      </span>
                      {vencida && <span className="font-semibold text-bm-red">Hora vencida</span>}
                    </div>

                    {r.motivo_planificacion && (
                      <p className="mt-2 rounded-lg bg-bm-warn-tint px-2.5 py-1.5 text-xs text-[#7C2D12]">{r.motivo_planificacion}</p>
                    )}

                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      <button type="button" onClick={() => openModal(r, 'CONFIRMAR')} disabled={vencida}
                        title={vencida ? 'La hora ya pasó: reprograme' : undefined}
                        className={`${bmBtn.success} !h-10 !gap-1 !px-2 !text-[13px]`}>
                        <CheckCircle2 className="h-4 w-4" /> Confirmar
                      </button>
                      <button type="button" onClick={() => openModal(r, 'REPROGRAMAR')}
                        className={`${bmBtn.secondary} !h-10 !gap-1 !px-2 !text-[13px]`}>
                        <Repeat className="h-4 w-4" /> Reprog.
                      </button>
                      <button type="button" onClick={() => openModal(r, 'RECHAZAR')}
                        className="inline-flex h-10 items-center justify-center gap-1 rounded-xl border border-bm-red/25 bg-white px-2 text-[13px] font-semibold text-bm-red-deep transition-colors hover:bg-bm-red-tint">
                        <XCircle className="h-4 w-4" /> Rechazar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* TABLERO SEMANAL */}
          <section className="min-w-0 overflow-hidden rounded-[24px] border border-bm-line bg-white xl:col-span-8" aria-labelledby="fpb-tablero">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bm-line p-4 sm:px-5">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-bm-red" />
                <h3 id="fpb-tablero" className="bm-heading text-base">Ocupación por slot</h3>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bm-steel">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-bm-ok/30 bg-bm-ok-tint" /> Libre</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-bm-warn/30 bg-bm-warn-tint" /> +75 %</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-bm-red/30 bg-bm-red-tint" /> Lleno</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-[#2F5BB7]/60 bg-[#E8EEF9]" /> Solicitud</span>
              </div>
            </div>

            <div className="overflow-x-auto p-3 sm:p-4">
              <div className="min-w-[680px]">
                <div className="mb-1.5 grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1.5">
                  <div className="sticky left-0 z-10 bg-white" />
                  {weekDays.map(d => {
                    const ymd = toYMD(d);
                    const esHoy = ymd === hoyYMD;
                    return (
                      <div key={ymd} className={`rounded-xl p-2 text-center ${esHoy ? 'bg-bm-red text-white' : 'bg-bm-canvas'}`}>
                        <p className={`text-[11px] font-medium ${esHoy ? 'text-white/85' : 'text-bm-steel'}`}>{DAYS_ES[d.getDay()]}</p>
                        <p className="bm-figure mt-0.5 text-xl">{d.getDate()}</p>
                      </div>
                    );
                  })}
                </div>

                {SLOTS.map(slot => (
                  <div key={slot.hora} className="mb-1.5 grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1.5">
                    <div className="sticky left-0 z-10 flex flex-col justify-center bg-white pr-1">
                      <p className="bm-num text-sm font-semibold">{slot.hora}</p>
                      {slot.bloqueado && <p className="text-[10px] text-bm-hint">Almuerzo</p>}
                    </div>
                    {weekDays.map(d => {
                      const ymd = toYMD(d);
                      if (slot.bloqueado) {
                        return (
                          <div key={ymd} className="flex min-h-[64px] items-center justify-center rounded-xl bg-[repeating-linear-gradient(135deg,#F2F3F5_0_6px,#FFFFFF_6px_12px)]">
                            <Lock className="h-3.5 w-3.5 text-bm-field" aria-label="Bloqueado" />
                          </div>
                        );
                      }
                      const cell  = ocupacion.get(slotKey(ymd, slot.hora)) ?? { conf: [], sol: [] };
                      const cap   = sede === 'TODAS' ? capacidadTotal : capacidadAlumno(sede);
                      const pasado = ymd < hoyYMD || (ymd === hoyYMD && slot.hora <= ahoraHM());
                      const ratio = cap > 0 ? cell.conf.length / cap : 1;
                      const tone  = pasado ? 'border-bm-line bg-bm-canvas opacity-60'
                        : cap === 0 || ratio >= 1 ? 'border-bm-red/25 bg-bm-red-tint/60'
                        : ratio >= 0.75 ? 'border-bm-warn/25 bg-bm-warn-tint/70'
                        : 'border-bm-ok/20 bg-bm-ok-tint/50';
                      return (
                        <div key={ymd} className={`flex min-h-[64px] min-w-0 flex-col gap-1 rounded-xl border p-1.5 ${tone}`}>
                          <div className="flex items-center justify-between">
                            <span className="bm-num text-[11px] font-semibold text-bm-steel">{cell.conf.length}/{cap}</span>
                            {cell.sol.length > 0 && (
                              <span className="rounded bg-[#E8EEF9] px-1 text-[10px] font-semibold text-[#2F5BB7]">+{cell.sol.length}</span>
                            )}
                          </div>
                          {cell.conf.map(r => (
                            <button key={r.id} type="button" onClick={() => openModal(r, 'CONFIRMAR')}
                              title={`${r.alumno_nombre} · ${r.aeronave_matricula ?? ''} · ${r.instructor_nombre ?? ''}`}
                              className="w-full rounded-md border border-bm-line border-l-2 border-l-bm-red bg-white px-1.5 py-1 text-left transition-colors hover:border-bm-red">
                              <p className="truncate font-data text-[11px] font-semibold">
                                {r.aeronave_matricula ?? 'S/N'}{r.reprogramada ? ' ↻' : ''}
                              </p>
                              <p className="truncate text-[11px] text-bm-ink">{nombreCorto(r.alumno_nombre)}</p>
                              <p className="truncate text-[10px] text-bm-steel">Cap. {nombreCorto(r.instructor_nombre)}</p>
                            </button>
                          ))}
                          {cell.sol.map(r => (
                            <button key={r.id} type="button" onClick={() => openModal(r, 'CONFIRMAR')}
                              className="w-full rounded-md border border-dashed border-[#2F5BB7]/50 bg-white/80 px-1.5 py-1 text-left transition-colors hover:border-[#2F5BB7]">
                              <p className="text-[10px] font-semibold text-[#2F5BB7]">Solicita</p>
                              <p className="truncate text-[11px] text-bm-ink">{nombreCorto(r.alumno_nombre)}</p>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ══ MODAL DE PLANIFICACIÓN (BmModal: hoja inferior en móvil, Esc) ════ */}
      <BmModal
        open={!!selected}
        onClose={closeModal}
        busy={saving}
        size="lg"
        icon={<Plane className="h-5 w-5" />}
        tone="danger"
        title={selected?.alumno_nombre ?? ''}
        subtitle={selected ? `${selected.alumno_serial ?? 'S/serial'} · ${selected.alumno_sede ?? 'Sin sede'} · ${ESTADO_LABEL[selected.status] ?? selected.status}` : undefined}
      >
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
          const fueraDeVentana = mode === 'REPROGRAMAR' && !!form.fecha && form.fecha > rango.hasta;   // [v1.2]

          return (
            <div className="space-y-4">

              {/* Resumen */}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-xl bg-bm-canvas p-3">
                  <p className="text-[11px] text-bm-steel">Pidió</p>
                  <p className="bm-num mt-1 text-[13px] font-semibold">{fmtDateLong(selected.fecha_solicitada ?? selected.fecha)} · {selected.slot_solicitado ?? selected.slot_hora}</p>
                </div>
                <div className="rounded-xl bg-bm-canvas p-3">
                  <p className="text-[11px] text-bm-steel">Actual</p>
                  <p className="bm-num mt-1 text-[13px] font-semibold text-bm-red">{fmtDateLong(selected.fecha)} · {selected.slot_hora}</p>
                </div>
                <div className="rounded-xl bg-bm-canvas p-3">
                  <p className="text-[11px] text-bm-steel">Tipo / horas</p>
                  <p className="mt-1 text-[13px] font-semibold">{selected.tipo_vuelo ?? 'Vuelo'} · <span className="bm-num">{selected.horas_planificadas.toFixed(1)} h</span></p>
                </div>
                <div className={`rounded-xl p-3 ${sinSaldo ? 'bg-bm-red-tint' : 'bg-bm-ok-tint'}`}>
                  <p className="text-[11px] text-bm-steel">Saldo libre</p>
                  <p className={`bm-num mt-1 text-[13px] font-semibold ${sinSaldo ? 'text-bm-red-deep' : 'text-bm-ok'}`}>
                    {disponible.toFixed(1)} h <span className="font-normal text-bm-steel">({selected.saldo_horas.toFixed(1)} − {selected.horas_comprometidas.toFixed(1)})</span>
                  </p>
                </div>
              </div>
              {sinSaldo && mode !== 'RECHAZAR' && (
                <BmNotice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
                  El alumno no tiene saldo suficiente. El sistema bloqueará la confirmación.
                </BmNotice>
              )}

              {/* Tabs */}
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-bm-canvas p-1" role="group" aria-label="Acción">
                {tabs.map(t => (
                  <button key={t.key} type="button" onClick={() => switchMode(t.key)} aria-pressed={mode === t.key}
                    className={`h-11 rounded-xl px-2 text-sm font-semibold transition-colors ${
                      mode === t.key
                        ? t.key === 'RECHAZAR' ? 'bg-white text-bm-red-deep shadow-sm ring-1 ring-bm-red/25'
                        : t.key === 'REPROGRAMAR' ? 'bg-white text-bm-ink shadow-sm ring-1 ring-bm-ink/15'
                        : 'bg-white text-bm-ok shadow-sm ring-1 ring-bm-ok/25'
                        : 'text-bm-steel hover:text-bm-ink'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* CONFIRMAR / REASIGNAR */}
              {mode === 'CONFIRMAR' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-bm-line p-3">
                    <span className="bm-num text-sm font-medium">
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
                      <p className="mb-2 text-xs font-semibold text-bm-steel">Próximos slots con cupo</p>
                      <div className="flex flex-wrap gap-1.5">
                        {sugerencias.map(s => {
                          const sel = form.fecha === s.fecha && form.slot === s.slot;
                          return (
                            <button key={`${s.fecha}-${s.slot}`} type="button" onClick={() => setTarget(s.fecha, s.slot)} aria-pressed={sel}
                              className={`h-10 rounded-xl border px-3 text-[13px] font-medium transition-colors ${
                                sel ? 'border-bm-red bg-bm-red-tint text-bm-red' : 'border-bm-line bg-white text-bm-ink hover:border-bm-steel/40'}`}>
                              <span className="bm-num">{fmtDateLong(s.fecha)} · {s.slot}</span>
                              <span className="ml-1.5 text-bm-ok">{s.libres} libre{s.libres > 1 ? 's' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[190px_1fr]">
                    <input type="date" value={form.fecha} min={hoyYMD} aria-label="Fecha del vuelo"
                      onChange={e => e.target.value && setTarget(e.target.value, form.slot)}
                      className={bmInput} />
                    <div className="grid grid-cols-4 gap-1.5">
                      {SLOTS_OPERATIVOS.map(s => {
                        const usados = confirmadosEnSede(form.fecha, s, selected.alumno_sede);
                        const pasado = form.fecha < hoyYMD || (form.fecha === hoyYMD && s <= ahoraHM());
                        const sel = form.slot === s;
                        return (
                          <button key={s} type="button" disabled={pasado} onClick={() => setTarget(form.fecha, s)} aria-pressed={sel}
                            className={`rounded-xl border py-1.5 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              sel ? 'border-bm-red bg-bm-red-tint' : 'border-bm-line bg-white hover:border-bm-steel/40'}`}>
                            <p className={`bm-num text-sm font-semibold ${sel ? 'text-bm-red' : 'text-bm-ink'}`}>{s}</p>
                            <p className={`bm-num text-[11px] ${usados >= cap ? 'font-semibold text-bm-red-deep' : 'text-bm-steel'}`}>{usados}/{cap}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {fueraDeVentana && (
                    <BmNotice tone="info" icon={<CalendarDays className="h-4 w-4" />}>
                      Fecha posterior a la ventana cargada ({fmtDateLong(rango.hasta)}): la ocupación mostrada puede estar incompleta. El servidor valida los conflictos al confirmar.
                    </BmNotice>
                  )}
                  {renderRecursos()}
                </div>
              )}

              {/* RECHAZAR / CANCELAR */}
              {mode === 'RECHAZAR' && (
                <BmNotice tone="danger" icon={<XCircle className="h-4 w-4" />}>
                  {esConfirmada
                    ? 'El vuelo confirmado se cancelará y el capitán y la aeronave quedarán libres.'
                    : 'La solicitud quedará rechazada. El alumno verá el motivo en su calendario.'}
                </BmNotice>
              )}

              {/* Motivo */}
              <div>
                <p className="mb-2 text-sm font-medium">
                  Motivo {mode === 'CONFIRMAR' ? <span className="font-normal text-bm-steel">(opcional)</span> : <span className="text-bm-red">*</span>}
                </p>
                {mode !== 'CONFIRMAR' && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {motivos.map(m => (
                      <button key={m} type="button" onClick={() => setForm(p => ({ ...p, motivo: m }))} aria-pressed={form.motivo === m}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          form.motivo === m ? 'border-bm-red bg-bm-red-tint text-bm-red' : 'border-bm-line text-bm-steel hover:text-bm-ink'}`}>
                        {m.charAt(0) + m.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                )}
                <textarea rows={2} value={form.motivo} onChange={e => setForm(p => ({ ...p, motivo: e.target.value }))}
                  aria-label="Motivo"
                  placeholder={mode === 'CONFIRMAR' ? 'Nota para el capitán / alumno' : 'Describa el motivo'}
                  className={`${bmTextarea} uppercase placeholder:normal-case`} />
              </div>

              {formError && (
                <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>{formError}</BmNotice>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={closeModal} disabled={saving} className={`${bmBtn.secondary} sm:flex-1`}>
                  Cerrar
                </button>
                <button type="button" onClick={submit} disabled={saving}
                  className={`${mode === 'RECHAZAR' ? bmBtn.danger : mode === 'REPROGRAMAR' ? bmBtn.primary : bmBtn.success} sm:flex-[2]`}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" />
                    : mode === 'RECHAZAR' ? <XCircle className="h-4 w-4" />
                    : mode === 'REPROGRAMAR' ? <Repeat className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  {mode === 'RECHAZAR' ? (esConfirmada ? 'Cancelar vuelo' : 'Rechazar solicitud')
                    : mode === 'REPROGRAMAR' ? 'Reprogramar y confirmar'
                    : esConfirmada ? 'Guardar reasignación' : 'Confirmar vuelo'}
                </button>
              </div>

              {/* Trazabilidad */}
              <div className="border-t border-bm-line pt-4">
                <p className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-bm-steel">
                  <History className="h-3.5 w-3.5" /> Trazabilidad
                </p>
                {loadingEventos ? (
                  <Loader2 className="h-4 w-4 animate-spin text-bm-hint" />
                ) : eventos.length === 0 ? (
                  <p className="text-[13px] text-bm-hint">Sin eventos registrados.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {eventos.map(ev => (
                      <li key={ev.id} className="flex items-start justify-between gap-3 text-[13px]">
                        <div className="flex min-w-0 gap-2.5">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-bm-red" aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="font-medium">{ACCION_LABEL[ev.accion] ?? ev.accion.replace(/_/g, ' ')}</p>
                            {ev.detalle?.a?.fecha && (
                              <p className="bm-num truncate text-xs text-bm-steel">
                                {ev.detalle?.de?.fecha ? `${ev.detalle.de.fecha} ${hm(ev.detalle.de.slot)} → ` : ''}
                                {ev.detalle.a.fecha} {hm(ev.detalle.a.slot)} {ev.detalle.a.aeronave ? `· ${ev.detalle.a.aeronave}` : ''}
                              </p>
                            )}
                            {ev.detalle?.motivo && <p className="truncate text-xs text-bm-warn">{ev.detalle.motivo}</p>}
                          </div>
                        </div>
                        <span className="bm-num shrink-0 text-xs text-bm-hint">{fmtDateTime(ev.created_at)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          );
        })()}
      </BmModal>
    </div>
  );
};

export default FlightPlanningBoard

// src/components/CaptainDashboard.tsx
// NÚCLEO DE OPERACIONES: HUD PERSONAL DE CAPITANES Y PILOTOS v2.2
// B&M MANTENIMIENTO AERONÁUTICO
// Evolución: Conexión Real-Time a Supabase y Telemetría Financiera
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.2 — REBRAND B&M + CONEXIONES:
//   [FIX] Logbook truncado: select('*') sin paginar devuelve como máximo 1.000
//         filas (límite de PostgREST); con más vuelos, las horas y la liquidación
//         pendiente quedaban cortas sin aviso. Lectura por lotes de 500 con orden
//         estable (created_at, id) y deduplicación por id.
//   [FIX] Error ≠ vacío: una falla de lectura mostraba "No hay registros" y los
//         KPI en 0. Ahora hay aviso con Reintentar y los KPI muestran "—".
//   [FIX] Sin sesión o con getUser() fallido la pantalla quedaba con KPI en cero.
//         Ahora explica qué pasó.
//   [FIX] capitan_id: además del id de usuario se acepta instructores.id (según
//         cómo lo escriba fn_vuelo_registrar). Realtime escucha ambos.
//   [FIX] Fecha de respaldo: created_at.split('T') toma la fecha UTC y los vuelos
//         registrados después de las 20:00 (VET, UTC−4) aparecían con el día
//         siguiente. Ahora se usa la fecha local.
//   [FIX] estatus_pago: PAGADO / PAGADA / PAID cuentan como pagados (antes solo
//         'PAID': 'PAGADO' se pintaba "Pendiente" y 'PENDIENTE' no sumaba a la
//         liquidación). ANULADO no suma a la liquidación.
//   [FIX] Respuestas fuera de orden: dos recargas seguidas podían pintar la más
//         vieja. Se descarta toda respuesta que no sea la última (secuencia).
//   [FIX] El realtime filtrado no entrega DELETE ni el UPDATE que mueve una misión
//         a otro capitán (el filtro se evalúa sobre la fila nueva): la misión
//         seguía en pantalla. Recarga silenciosa al volver a la pestaña y cada
//         2 min con la pestaña visible.
//   [FIX] Canal realtime con sufijo único: al remontar (StrictMode, cambio de
//         pestaña) se reutilizaba un nombre de canal ya suscrito.
//   [NEW] "Exportar logbook (PDF)" no hacía nada: abre el logbook en formato de
//         impresión B&M (el diálogo del navegador permite guardarlo como PDF).
//   [NEW] Botón Actualizar y aviso cuando el usuario no tiene registro en
//         instructores (antes: "Planificación no le ha asignado vuelos").
//   [UI]  B&M: cabecera blanca, KPI con cifras protagonistas, misiones en
//         tarjetas, logbook en tabla desde md y en lista apilada en móvil.
// PRESERVADO: filtros capitan_id / nombre del capitán, respaldos de columnas
//   (horas_hobbs → horas_tac, monto_pago → pago_capitan, tipo_mision → ruta →
//   destino), misiones CONFIRMADAS de reservas_slot_vuelo con nombres de
//   perfiles_estudiantes, KPI horas / liquidación / alumnos / misiones, realtime
//   por capitán, export nombrado CaptainDashboard.
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.1 (FlightRegister v7.0 · migración v18):
//   [FIX] El logbook filtraba solo por capitan_id, que FlightRegister v6.2 nunca
//         escribía: los vuelos registrados no aparecían. Ahora: capitan_id (v18 lo
//         escribe en cada vuelo) O nombre del capitán en bitacora_vuelos.instructor.
//   [FIX] Columnas con respaldo: horas_hobbs → horas_tac · monto_pago → pago_capitan ·
//         tipo_mision → ruta/destino (FlightRegister escribe las segundas).
//   [NEW] Al cambiar una reserva (p. ej. COMPLETADA al cerrar la bitácora) se recargan
//         en silencio misiones y logbook.
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0:
//   [NEW] "Próximas misiones asignadas": vuelos CONFIRMADOS por Planificación
//         (reservas_slot_vuelo, instructor_id = instructores.id del capitán)
//   [NEW] KPI "Misiones próximas" + marca de reprogramado + nota de Planificación
//   [FIX] Realtime filtrado por capitan_id (antes recargaba con cambios de
//         CUALQUIER capitán → consultas innecesarias y parpadeo)
//   [FIX] Recarga silenciosa en eventos realtime (sin loader de pantalla completa)
//   [FIX] Limpieza segura del canal si el componente se desmonta antes de auth
//   PRESERVADO: logbook bitacora_vuelos, KPIs horas/liquidación/alumnos, tabla
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardContent } from './ui/card';
import {
  Plane, Clock, Users, DollarSign, Award,
  CheckCircle2, AlertCircle, FileText, Loader2,
  CalendarDays, Repeat,
  RefreshCw, UserX, Ban,                                     // [v2.2]
} from 'lucide-react';
import { BmBadge, BmNotice, bmBtn } from './brand/bm-ui';    // [v2.2]

// [NEW v2.0] Misión asignada por Planificación
interface MisionAsignada {
  id: string;
  fecha: string;
  slot_hora: string;
  aeronave_matricula: string | null;
  tipo_vuelo: string | null;
  horas_planificadas: number;
  alumno: string;
  reprogramada: boolean;
  motivo_planificacion: string | null;
}

// [NEW v2.2] Fila del logbook ya normalizada
type EstadoPago = 'PAID' | 'PENDING' | 'VOID';
interface LogbookEntry {
  id: string;
  date: string;
  student: string;
  aircraft: string;
  type: string;
  hobbs: number;
  status: EstadoPago;
  amount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // fecha LOCAL
const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const fmtFecha = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return `${DAYS_ES[dt.getDay()]} ${pad(d)}/${pad(m)}`;
};

// ── [NEW v2.2] Constantes y utilidades ───────────────────────────────────────
const LOTE_LOGBOOK = 500;
const MAX_LOTES_LOGBOOK = 40;                 // 20.000 vuelos por capitán: tope de seguridad
const AUTO_REFRESH_MS = 2 * 60 * 1000;
const EMPRESA_LEGAL = 'B&M Mantenimiento Aeronáutico';
const ESTATUS_PAGADO = new Set(['PAID', 'PAGADO', 'PAGADA', 'PAGO', 'LIQUIDADO', 'LIQUIDADA']);
const ESTATUS_ANULADO = new Set(['VOID', 'ANULADO', 'ANULADA', 'CANCELADO', 'CANCELADA']);

const normEstatusPago = (raw: unknown): EstadoPago => {
  const s = String(raw ?? '').trim().toUpperCase();
  if (ESTATUS_PAGADO.has(s)) return 'PAID';
  if (ESTATUS_ANULADO.has(s)) return 'VOID';
  return 'PENDING';
};

/** Fecha local YYYY-MM-DD de un timestamp ISO (no la fecha UTC). */
const ymdLocal = (iso: unknown): string | null => {
  if (!iso) return null;
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? null : toYMD(d);
};

/** dd/mm/aaaa para fechas YYYY-MM-DD; cualquier otro texto se devuelve igual. */
const fmtFechaLog = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
};

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Error desconocido';
};

const escapeHtml = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const PAGO_UI: Record<EstadoPago, { label: string; tone: 'ok' | 'warn' | 'neutral'; icon: React.ReactNode }> = {
  PAID:    { label: 'Pagado',    tone: 'ok',      icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  PENDING: { label: 'Pendiente', tone: 'warn',    icon: <AlertCircle className="h-3.5 w-3.5" /> },
  VOID:    { label: 'Anulado',   tone: 'neutral', icon: <Ban className="h-3.5 w-3.5" /> },
};

export const CaptainDashboard = ({ userProfile }: { userProfile: any }) => {
  const [logbook, setLogbook] = useState<LogbookEntry[]>([]);
  const [misiones, setMisiones] = useState<MisionAsignada[]>([]);   // [NEW v2.0]
  const [isLoading, setIsLoading] = useState(true);

  // [NEW v2.2] Estados de conexión
  const [logError, setLogError] = useState<string | null>(null);
  const [logCargado, setLogCargado] = useState(false);
  const [logTruncado, setLogTruncado] = useState(false);
  const [misError, setMisError] = useState<string | null>(null);
  const [sinInstructor, setSinInstructor] = useState(false);
  const [sesionError, setSesionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const logSeq = useRef(0);
  const misSeq = useRef(0);
  const ctxRef = useRef<{ userId: string; nombre: string | null; instructorId: string | null } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- MOTOR DE SINCRONIZACIÓN TÁCTICA ---
  const fetchCaptainLogbook = useCallback(async (
    capitanId: string,
    silent = false,
    nombreCapitan: string | null = null,
    instructorId: string | null = null,          // [v2.2]
  ) => {
    const seq = ++logSeq.current;                  // [v2.2]
    if (!silent) setIsLoading(true);
    try {
      // Extraemos exclusivamente los vuelos de este Capitán
      // [FIX v2.1] capitan_id O nombre del capitán (vuelos registrados antes de la migración v18)
      // [FIX v2.2] capitan_id también puede ser instructores.id
      const nombre = (nombreCapitan ?? '').trim();
      const partes = [`capitan_id.eq.${capitanId}`];
      if (instructorId && instructorId !== capitanId) partes.push(`capitan_id.eq.${instructorId}`);
      if (nombre) partes.push(`instructor.ilike."${nombre.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
      const filtro = partes.join(',');

      // [FIX v2.2] Lectura por lotes: PostgREST corta en 1.000 filas
      const data: any[] = [];
      const vistos = new Set<string>();
      let truncado = false;
      for (let lote = 0; lote < MAX_LOTES_LOGBOOK; lote++) {
        const desde = lote * LOTE_LOGBOOK;
        const { data: filas, error } = await supabase
          .from('bitacora_vuelos')
          .select('*')
          .or(filtro)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(desde, desde + LOTE_LOGBOOK - 1);

        if (error) throw error;
        if (seq !== logSeq.current) return;        // llegó una lectura más nueva

        const recibidas = (filas ?? []) as any[];
        recibidas.forEach(f => {
          const k = String(f.id);
          if (!vistos.has(k)) { vistos.add(k); data.push(f); }
        });
        if (recibidas.length < LOTE_LOGBOOK) break;
        if (lote === MAX_LOTES_LOGBOOK - 1) truncado = true;
      }

      if (seq !== logSeq.current) return;

      // Mapeo resiliente (Grado Militar) para evitar fallos si faltan datos antiguos
      const formattedData: LogbookEntry[] = data.map((flight: any) => ({
        id: String(flight.id),
        date: flight.fecha || ymdLocal(flight.created_at) || 'Desconocida',                 // [v2.2] fecha local
        student: flight.alumno || 'Por Asignar',
        aircraft: flight.aeronave_matricula || flight.matricula || 'N/A',
        type: flight.tipo_mision || flight.ruta || flight.destino || 'Instrucción',          // [v2.1] respaldo
        hobbs: Number(flight.horas_hobbs ?? flight.horas_tac ?? 0) || 0,                       // [v2.1] respaldo TAC
        status: normEstatusPago(flight.estatus_pago),                                          // [v2.2]
        amount: Number(flight.monto_pago ?? flight.pago_capitan ?? 0) || 0                     // [v2.1] respaldo
      }));
      setLogbook(formattedData);
      setLogTruncado(truncado);
      setLogCargado(true);
      setLogError(null);
    } catch (error) {
      if (seq !== logSeq.current) return;
      console.error("Falla en Radar de Capitán:", error);
      setLogError(errMsg(error));                  // [v2.2] error visible, no vacío falso
    } finally {
      if (seq === logSeq.current) setIsLoading(false);
    }
  }, []);

  // [NEW v2.1] Nombre del capitán (instructores.nombre_completo) para el filtro del logbook
  const fetchNombreCapitan = useCallback(async (userId: string): Promise<string | null> => {
    const { data } = await supabase
      .from('instructores')
      .select('nombre_completo')
      .eq('perfil_id', userId)
      .maybeSingle();
    return (data?.nombre_completo as string | undefined) ?? null;
  }, []);

  // [NEW v2.0] Misiones confirmadas por Planificación. Devuelve instructor.id para realtime.
  const fetchMisiones = useCallback(async (userId: string): Promise<string | null> => {
    const seq = ++misSeq.current;                  // [v2.2]
    const vigente = () => seq === misSeq.current;
    try {
      const { data: inst, error: instError } = await supabase
        .from('instructores')
        .select('id')
        .eq('perfil_id', userId)
        .maybeSingle();
      if (instError) throw instError;              // [v2.2] antes se ocultaba como "sin misiones"
      if (!inst?.id) {
        if (vigente()) { setMisiones([]); setSinInstructor(true); setMisError(null); }
        return null;
      }

      const { data: rsv, error: rsvError } = await supabase
        .from('reservas_slot_vuelo')
        .select('id, student_id, fecha, slot_hora, aeronave_matricula, tipo_vuelo, horas_planificadas, reprogramada, motivo_planificacion')
        .eq('instructor_id', inst.id)
        .eq('status', 'CONFIRMADA')
        .gte('fecha', toYMD(new Date()))
        .order('fecha', { ascending: true })
        .order('slot_hora', { ascending: true })
        .limit(10);
      if (rsvError) throw rsvError;

      const ids = Array.from(new Set((rsv ?? []).map((r: any) => r.student_id).filter(Boolean)));
      const nombres: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: est } = await supabase
          .from('perfiles_estudiantes')
          .select('id, nombre_completo')
          .in('id', ids);
        (est ?? []).forEach((e: any) => { nombres[e.id] = e.nombre_completo; });
      }

      if (vigente()) {
        setMisiones((rsv ?? []).map((r: any) => ({
          id: r.id,
          fecha: r.fecha,
          slot_hora: String(r.slot_hora ?? '').slice(0, 5),
          aeronave_matricula: r.aeronave_matricula ?? null,
          tipo_vuelo: r.tipo_vuelo ?? null,
          horas_planificadas: Number(r.horas_planificadas || 0),
          alumno: nombres[r.student_id] ?? `ALUMNO ${String(r.student_id).slice(0, 8)}`,
          reprogramada: !!r.reprogramada,
          motivo_planificacion: r.motivo_planificacion ?? null,
        })));
        setSinInstructor(false);
        setMisError(null);
      }
      return String(inst.id);
    } catch (error) {
      console.error("Falla cargando misiones asignadas:", error);
      if (vigente()) setMisError(errMsg(error));
      return null;
    }
  }, []);

  // [NEW v2.2] Recarga silenciosa con el contexto ya resuelto en init
  const recargarSilencioso = useCallback(async (soloLogbook = false) => {
    const c = ctxRef.current;
    if (!c) return;
    await Promise.all([
      soloLogbook ? Promise.resolve(null) : fetchMisiones(c.userId),
      fetchCaptainLogbook(c.userId, true, c.nombre, c.instructorId),
    ]);
  }, [fetchMisiones, fetchCaptainLogbook]);

  const programarRecarga = useCallback((soloLogbook: boolean) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void recargarSilencioso(soloLogbook); }, 400);
  }, [recargarSilencioso]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      // [v2.2] getUser puede fallar (red) o no devolver sesión: se informa
      let user: { id: string } | null = null;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        user = data?.user ?? null;
      } catch (e) {
        if (!cancelled) { setSesionError(`No se pudo verificar la sesión: ${errMsg(e)}`); setIsLoading(false); }
        return;
      }
      if (!user || cancelled) {
        if (!cancelled) { setSesionError('No hay una sesión activa. Inicie sesión de nuevo.'); setIsLoading(false); }
        return;
      }

      const nombreCapitan = await fetchNombreCapitan(user.id).catch(() => null);   // [v2.1]
      if (cancelled) return;
      const instructorId = await fetchMisiones(user.id);
      if (cancelled) return;
      ctxRef.current = { userId: user.id, nombre: nombreCapitan, instructorId };
      await fetchCaptainLogbook(user.id, false, nombreCapitan, instructorId);
      if (cancelled) return;

      // Sincronización en tiempo real si el admin le aprueba un pago
      // [FIX v2.0] filtrado por este capitán · [v2.2] nombre de canal único
      const sufijo = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      channel = supabase
        .channel(`captain-hud-${user.id}-${sufijo}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'bitacora_vuelos', filter: `capitan_id=eq.${user.id}` },
          () => programarRecarga(true));

      // [v2.2] capitan_id escrito como instructores.id
      if (instructorId && instructorId !== user.id) {
        channel = channel.on('postgres_changes',
          { event: '*', schema: 'public', table: 'bitacora_vuelos', filter: `capitan_id=eq.${instructorId}` },
          () => programarRecarga(true));
      }

      // [NEW v2.0] misiones confirmadas/reprogramadas por Planificación
      if (instructorId) {
        channel = channel.on('postgres_changes',
          { event: '*', schema: 'public', table: 'reservas_slot_vuelo', filter: `instructor_id=eq.${instructorId}` },
          () => programarRecarga(false));   // [v2.1] misiones + logbook
      }

      channel.subscribe();
    };

    init();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchCaptainLogbook, fetchMisiones, fetchNombreCapitan, programarRecarga]);

  // [NEW v2.2] Respaldo del realtime: al volver a la pestaña y cada 2 min
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void recargarSilencioso(false); };
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void recargarSilencioso(false);
    }, AUTO_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [recargarSilencioso]);

  const actualizar = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await recargarSilencioso(false); } finally { setRefreshing(false); }
  };

  // --- CÁLCULOS DE INTELIGENCIA DEL PILOTO ---
  const totalHours = logbook.reduce((acc, flight) => acc + flight.hobbs, 0);
  const pendingPay = logbook.filter(f => f.status === 'PENDING').reduce((acc, flight) => acc + flight.amount, 0);
  const uniqueStudents = new Set(logbook.map(f => f.student).filter(s => s !== 'Por Asignar')).size;
  const misionesHoy = misiones.filter(m => m.fecha === toYMD(new Date())).length;   // [NEW v2.0]
  const kpiListo = logCargado;                                                        // [v2.2]

  // ── [NEW v2.2] Exportar logbook (impresión B&M → PDF) ─────────────────────
  const exportarLogbook = () => {
    setExportError(null);
    const w = window.open('', '_blank', 'width=1100,height=860');
    if (!w) {
      setExportError('El navegador bloqueó la ventana de impresión. Permita ventanas emergentes para este sitio y vuelva a intentarlo.');
      return;
    }
    const nombre = userProfile?.nombre_completo || 'Operador';
    const sede = userProfile?.sede || 'Global';
    const generado = new Date().toLocaleString('es-VE');
    const filas = logbook.map(f => `
      <tr>
        <td>${escapeHtml(fmtFechaLog(f.date))}</td>
        <td>${escapeHtml(f.student)}</td>
        <td class="mono">${escapeHtml(f.aircraft)}</td>
        <td>${escapeHtml(f.type)}</td>
        <td class="num">${f.hobbs.toFixed(1)}</td>
        <td class="num">${escapeHtml(fmtUsd(f.amount))}</td>
        <td>${escapeHtml(PAGO_UI[f.status].label)}</td>
      </tr>`).join('');

    w.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8" />
<title>Logbook · ${escapeHtml(nombre)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font-family: Arial, Helvetica, sans-serif; color: #1B1D22; font-size: 11px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; border-bottom: 3px solid #D42125; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 20px; font-weight: 900; color: #D42125; letter-spacing: .5px; }
  .muted { color: #5F6670; }
  h1 { font-size: 15px; margin: 0; text-align: right; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi { border: 1px solid #E3E5E9; border-radius: 10px; padding: 10px 12px; }
  .kpi b { display: block; font-size: 16px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; color: #5F6670; border-bottom: 1px solid #D9DCE1; padding: 7px 6px; }
  td { border-bottom: 1px solid #EEF0F2; padding: 7px 6px; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: 'Courier New', monospace; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #E3E5E9; display: flex; justify-content: space-between; color: #5F6670; font-size: 10px; }
  @page { size: A4 landscape; margin: 12mm; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <div class="head">
    <div>
      <div class="brand">${escapeHtml(EMPRESA_LEGAL.toUpperCase())}</div>
      <div class="muted">Capitán ${escapeHtml(nombre)} · Sede ${escapeHtml(sede)}</div>
    </div>
    <div><h1>Logbook del capitán</h1><div class="muted" style="text-align:right">Generado ${escapeHtml(generado)}</div></div>
  </div>
  <div class="kpis">
    <div class="kpi"><span class="muted">Horas de instrucción</span><b>${totalHours.toFixed(1)} h</b></div>
    <div class="kpi"><span class="muted">Vuelos</span><b>${logbook.length}</b></div>
    <div class="kpi"><span class="muted">Alumnos entrenados</span><b>${uniqueStudents}</b></div>
    <div class="kpi"><span class="muted">Liquidación pendiente</span><b>${escapeHtml(fmtUsd(pendingPay))}</b></div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Alumno</th><th>Aeronave</th><th>Misión</th><th class="num">Hobbs / TAC</th><th class="num">Pago</th><th>Estatus</th></tr></thead>
    <tbody>${filas || '<tr><td colspan="7" class="muted">Sin vuelos registrados.</td></tr>'}</tbody>
  </table>
  <div class="foot"><span>${escapeHtml(EMPRESA_LEGAL)}</span><span>Documento generado por Valkyron OS</span></div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 200); });</script>
</body></html>`);
    w.document.close();
    w.focus();
  };

  if (isLoading) {
    return (
      <div className="bm-app space-y-4" aria-busy="true" aria-label="Cargando logbook">
        <div className="bm-skeleton h-[92px] rounded-[24px]" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="bm-skeleton h-[104px] rounded-[20px]" />)}
        </div>
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-bm-steel">
          <Loader2 className="h-5 w-5 animate-spin text-bm-red" /> Sincronizando logbook…
        </div>
      </div>
    );
  }

  // [v2.2] Sin sesión: no hay nada que mostrar
  if (sesionError) {
    return (
      <div className="bm-app">
        <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
          <p className="font-semibold">Logbook no disponible</p>
          <p className="mt-0.5">{sesionError}</p>
        </BmNotice>
      </div>
    );
  }

  const kpis: { label: string; value: string; sub?: string; icon: React.ReactNode; tone: string }[] = [
    { label: 'Horas de instrucción', value: kpiListo ? `${totalHours.toFixed(1)} h` : '—', icon: <Clock className="h-5 w-5" />, tone: 'bg-bm-red-tint text-bm-red' },
    { label: 'Liquidación pendiente', value: kpiListo ? fmtUsd(pendingPay) : '—', icon: <DollarSign className="h-5 w-5" />, tone: 'bg-bm-ok-tint text-bm-ok' },
    { label: 'Alumnos entrenados', value: kpiListo ? String(uniqueStudents) : '—', icon: <Users className="h-5 w-5" />, tone: 'bg-bm-canvas text-bm-ink' },
    { label: 'Misiones próximas', value: misError && misiones.length === 0 ? '—' : String(misiones.length), sub: misError ? 'sin conexión' : misionesHoy === 1 ? '1 hoy' : `${misionesHoy} hoy`, icon: <CalendarDays className="h-5 w-5" />, tone: 'bg-[#E8EEF9] text-[#2F5BB7]' },
  ];

  return (
    <div className="bm-app relative space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* CABECERA: IDENTIFICACIÓN DEL CAPITÁN */}
      <div className="flex flex-col gap-4 rounded-[24px] border border-bm-line bg-white p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Award className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="bm-heading truncate text-lg leading-tight sm:text-xl">
              Capitán {userProfile?.nombre_completo || 'Operador'}
            </h2>
            <p className="mt-0.5 text-[13px] text-bm-steel">
              Licencia activa · Sede {userProfile?.sede || 'Global'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:items-center">
          <button type="button" onClick={() => void actualizar()} disabled={refreshing}
            aria-label="Actualizar logbook" title="Actualizar" className={bmBtn.icon}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={exportarLogbook} disabled={!logCargado}
            className={`${bmBtn.dark} ${bmBtn.sm} sm:!h-11`}>
            <FileText className="h-4 w-4" /> Exportar logbook (PDF)
          </button>
        </div>
      </div>

      {exportError && (
        <BmNotice tone="warn" role="alert" icon={<AlertCircle className="h-4 w-4" />}>{exportError}</BmNotice>
      )}

      {logError && (
        <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <p className="font-semibold">
                {logCargado ? 'No se pudo actualizar el logbook' : 'No se pudo leer el logbook'}
              </p>
              <p className="mt-0.5">
                {logCargado ? 'Se muestran los últimos datos recibidos. ' : 'Los indicadores no se calculan sin datos. '}
                <span className="font-data text-xs">{logError}</span>
              </p>
            </div>
            <button type="button" onClick={() => void actualizar()} disabled={refreshing}
              className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Reintentar
            </button>
          </div>
        </BmNotice>
      )}

      {logTruncado && (
        <BmNotice tone="warn" icon={<AlertCircle className="h-4 w-4" />}>
          El logbook supera {(LOTE_LOGBOOK * MAX_LOTES_LOGBOOK).toLocaleString('es-VE')} vuelos: se muestran los más recientes y los totales no incluyen los anteriores.
        </BmNotice>
      )}

      {/* MÉTRICAS DE VUELO (KPIs) */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map(k => (
          <Card key={k.label} className="rounded-[20px] border-bm-line bg-white text-bm-ink shadow-none">
            <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] leading-snug text-bm-steel">{k.label}</p>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.tone}`}>{k.icon}</span>
              </div>
              <div>
                <p className={`bm-figure whitespace-nowrap ${k.value.length > 8 ? 'text-[20px] sm:text-[28px]' : 'text-[26px] sm:text-[32px]'}`}>{k.value}</p>
                {k.sub && <p className="mt-1 text-xs text-bm-steel">{k.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* [NEW v2.0] PRÓXIMAS MISIONES ASIGNADAS POR PLANIFICACIÓN */}
      <section className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-6" aria-labelledby="cap-misiones">
        <div className="mb-4 flex items-center gap-2.5">
          <CalendarDays className="h-5 w-5 text-[#2F5BB7]" />
          <h3 id="cap-misiones" className="bm-heading text-base sm:text-lg">Próximas misiones asignadas</h3>
          {misiones.length > 0 && <BmBadge tone="info">{misiones.length}</BmBadge>}
        </div>

        {misError ? (
          <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
            No se pudieron leer las misiones asignadas. <span className="font-data text-xs">{misError}</span>
          </BmNotice>
        ) : sinInstructor ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <UserX className="h-6 w-6 text-bm-hint" />
            <p className="mt-2 text-sm font-medium">Su usuario no está vinculado a un registro de instructor</p>
            <p className="mt-1 max-w-sm text-[13px] text-bm-steel">Planificación asigna misiones a instructores registrados. Pida a administración que vincule su perfil.</p>
          </div>
        ) : misiones.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <CalendarDays className="h-6 w-6 text-bm-hint" />
            <p className="mt-2 text-sm font-medium">Planificación no le ha asignado vuelos próximos</p>
            <p className="mt-1 text-[13px] text-bm-steel">Las misiones confirmadas aparecen aquí al instante.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {misiones.map(m => (
              <article key={m.id} className="rounded-2xl border border-bm-line border-l-[3px] border-l-bm-red bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="bm-num text-sm font-semibold">
                    {fmtFecha(m.fecha)} · <span className="text-bm-red">{m.slot_hora}</span>
                  </p>
                  {m.reprogramada && (
                    <BmBadge tone="warn" icon={<Repeat className="h-3 w-3" />}>Reprogramada</BmBadge>
                  )}
                </div>
                <p className="mt-2 truncate text-[15px] font-semibold" title={m.alumno}>{m.alumno}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-bm-steel">
                  <span className="font-data text-bm-ink">{m.aeronave_matricula ?? 'S/N'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{m.tipo_vuelo ?? 'Vuelo'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="bm-num">{m.horas_planificadas.toFixed(1)} h</span>
                </p>
                {m.motivo_planificacion && (
                  <p className="mt-2.5 rounded-lg bg-bm-warn-tint px-2.5 py-1.5 text-xs text-[#7C2D12]">{m.motivo_planificacion}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* BITÁCORA DIGITAL (LOGBOOK) */}
      <section className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-6" aria-labelledby="cap-logbook">
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <Plane className="h-5 w-5 text-bm-red" />
          <h3 id="cap-logbook" className="bm-heading text-base sm:text-lg">Registro de misiones (logbook)</h3>
          {logCargado && <BmBadge tone="neutral">{logbook.length === 1 ? '1 vuelo' : `${logbook.length} vuelos`}</BmBadge>}
        </div>

        {logbook.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <Plane className="h-6 w-6 text-bm-hint" />
            <p className="mt-2 text-sm font-medium">
              {logCargado ? 'No hay registros de misiones para este operador' : 'Logbook sin datos'}
            </p>
            {logCargado && <p className="mt-1 text-[13px] text-bm-steel">Los vuelos registrados en Mi Bitácora aparecen aquí.</p>}
          </div>
        ) : (
          <>
            {/* Móvil: lista apilada */}
            <ul className="divide-y divide-bm-line md:hidden">
              {logbook.map(flight => {
                const p = PAGO_UI[flight.status];
                return (
                  <li key={flight.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold">{flight.student}</p>
                        <p className="mt-0.5 text-[13px] text-bm-steel">
                          <span className="bm-num">{fmtFechaLog(flight.date)}</span> · <span className="font-data text-bm-ink">{flight.aircraft}</span>
                        </p>
                        <p className="mt-0.5 truncate text-[13px] text-bm-steel">{flight.type}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="bm-num text-base font-semibold">{flight.hobbs.toFixed(1)} h</span>
                        <BmBadge tone={p.tone} icon={p.icon}>{p.label}</BmBadge>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* md+: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-bm-line text-xs text-bm-steel">
                    <th className="pb-3 pr-3 font-medium">Fecha</th>
                    <th className="pb-3 pr-3 font-medium">Alumno</th>
                    <th className="pb-3 pr-3 font-medium">Aeronave</th>
                    <th className="pb-3 pr-3 font-medium">Misión</th>
                    <th className="pb-3 pr-3 text-right font-medium">Hobbs / TAC</th>
                    <th className="pb-3 text-right font-medium">Estatus pago</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {logbook.map((flight) => {
                    const p = PAGO_UI[flight.status];
                    return (
                      <tr key={flight.id} className="border-b border-bm-line/70 transition-colors last:border-0 hover:bg-bm-canvas/60">
                        <td className="bm-num whitespace-nowrap py-3 pr-3 text-bm-steel">{fmtFechaLog(flight.date)}</td>
                        <td className="py-3 pr-3 font-medium">{flight.student}</td>
                        <td className="whitespace-nowrap py-3 pr-3 font-data">{flight.aircraft}</td>
                        <td className="py-3 pr-3 text-bm-steel">{flight.type}</td>
                        <td className="bm-num py-3 pr-3 text-right font-semibold">{flight.hobbs.toFixed(1)}</td>
                        <td className="py-3 text-right">
                          <BmBadge tone={p.tone} icon={p.icon}>{p.label}</BmBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

    </div>
  );
};

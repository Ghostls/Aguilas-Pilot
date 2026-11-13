// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  VALKYRON FLIGHT SYSTEM — FLIGHT REGISTER v7.1 · B&M                       ║
// ║  v7.1 REBRAND B&M + CONEXIONES (sobre v7.0):                               ║
// ║    — [UI] Estética B&M mobile-first: superficies blancas, rojo B&M como    ║
// ║      acción principal, campos de 48 px (16 px, sin zoom en iOS). Sin       ║
// ║      pantalla completa negra: vive dentro del Centro de Mando.             ║
// ║    — [UI] Las confirmaciones (sin tarifa, saldo, crédito, combustible,     ║
// ║      TAC vs ruta, TAC solapado, posponer día) pasan de window.confirm a    ║
// ║      un modal B&M con el mismo orden y los mismos datos.                   ║
// ║    — [FIX] Límite de crédito (administración): el diálogo decía           ║
// ║      "Cancelar = registrar el vuelo con cobro pendiente", así que          ║
// ║      Cancelar NO cancelaba. Ahora hay dos botones con su acción escrita    ║
// ║      (Autorizar cobro / Registrar con cobro pendiente) y cerrar el diálogo ║
// ║      no registra nada.                                                     ║
// ║    — [FIX] Combustible de la aeronave: un solo SELECT (tope de 1.000 filas ║
// ║      de PostgREST) y sin contar los consumos BURN que descuenta AVGAS.     ║
// ║      Ahora lectura completa por lotes, misma regla que AVGAS y, para el    ║
// ║      aviso de seguridad, OUT también descuenta (estimación conservadora).  ║
// ║      Respuestas obsoletas descartadas al cambiar de aeronave.              ║
// ║    — [FIX] Posponer día ignoraba el error de posponer_dia_vuelo y          ║
// ║      anunciaba "✓ undefined misiones pospuestas".                          ║
// ║    — [FIX] Si supabase.auth.getUser() fallaba, "Inicializando sistema…"    ║
// ║      quedaba para siempre. El usuario sale de la sesión verificada por     ║
// ║      AuthContext; getUser queda como respaldo con error visible.           ║
// ║    — [FIX] Registro heredado: los fallos de horas del alumno, combustible, ║
// ║      deuda o asignación se ignoraban y se anunciaba "SINCRONIZADA". Ahora  ║
// ║      se listan en el aviso final.                                          ║
// ║    — PRESERVADO ÍNTEGRO: fn_vuelo_registrar / fn_vuelo_saldos, registro    ║
// ║      heredado completo, cascada A→B→C, reservas de Planificación, nombres  ║
// ║      desde perfiles_estudiantes, rutas y coherencia ±20 % / ±40 %, cálculo ║
// ║      de producción, tarifas, evidencia de tacómetros, AbortController,     ║
// ║      reintentos con backoff, props { onFlightLogUpdate }.                  ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║  v7.0 EVOLUCIÓN (sobre v6.2) — DESCUENTO DE HORAS ↔ BILLETERA (v18 SQL):   ║
// ║    — [NEW] Cierre de bitácora en UNA transacción: fn_vuelo_registrar      ║
// ║      (bitácora + horas alumno + combustible + asignación VOLADO +         ║
// ║       reserva COMPLETADA + cobro). Antes: 6 escrituras sueltas.           ║
// ║    — [NEW] Cobro automático: horas de paquete anterior → billetera USD    ║
// ║      a tarifa del Tarifario → déficit a cuentas por cobrar.               ║
// ║    — [NEW] Saldo del alumno = paquete + billetera en horas (fn_vuelo_     ║
// ║      saldos) y vista previa del cargo antes de cerrar.                    ║
// ║    — [NEW] Misiones confirmadas por Planificación (reservas_slot_vuelo)   ║
// ║      aparecen en "Misiones del Día" (antes solo asignaciones_vuelo_diario)║
// ║      con aeronave asignada preseleccionada.                               ║
// ║    — [NEW] Guardas: vuelo duplicado / TAC solapado / fecha futura.        ║
// ║    — [FIX] hoy()/manana() en hora LOCAL (toISOString daba la fecha UTC:   ║
// ║      después de las 20:00 en Venezuela registraba "mañana").              ║
// ║    — [FIX] Ya no se inserta un INGRESO PAID por vuelo en                  ║
// ║      transacciones_finanzas (duplicaba el ingreso del paquete/recarga).   ║
// ║    — [FIX] Saldo heredado: horas de paquetes PARCIAL también cuentan y    ║
// ║      las horas ya facturadas como deuda no se descuentan dos veces.       ║
// ║    — [NEW] Estudiantes sin nombre (estrategia C) se completan desde       ║
// ║      perfiles_estudiantes.                                                ║
// ║    — PRESERVADO: registro heredado completo como respaldo si la           ║
// ║      migración v18 aún no está instalada.                                 ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║  v6.2 EVOLUCIÓN (sobre v6.1):                                              ║
// ║    — select('id, nombre_completo, sede') en instructores — sin 'nombre'    ║
// ║    — Cascada A→B→C en asignaciones: vista con orden_capitan →              ║
// ║      vista sin orden_capitan → tabla base directa                          ║
// ║    — ASIG_SELECT corregido: sin carrera_id (no existe en tabla base)       ║
// ║  v6.1 preservado: AbortController, retry backoff, normalizarSedeDB,        ║
// ║    maybeSingle, initError UI, rutas_vuelo degradación silenciosa,          ║
// ║    toda la lógica de vuelo, componentes atómicos.                          ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';                       // [v7.1]
import {
  BmBadge, BmEmpty, BmNotice, BmSelect, bmBtn, bmInput, bmLabel, bmTextarea,
  useBmConfirm, type BmConfirmOptions,
} from '@/components/brand/bm-ui';                                       // [v7.1]
import {
  Loader2, Plane, ShieldCheck, Camera,
  FileCheck, Activity, AlertTriangle, Fuel, MapPin,
  CloudRain, Calendar, CheckCircle2, ChevronRight, Clock,
  DollarSign, Navigation, ChevronDown, WifiOff, RefreshCw,
  Wallet, Receipt,   // [NEW v7.0]
  Gauge, UserRound,  // [v7.1]
} from 'lucide-react';
// [NEW v7.0] Contratos de fn_vuelo_saldos / fn_vuelo_registrar (migracion_vuelos_v18_billetera.sql)
import type {
  SaldoVueloAlumno, RegistroVueloInput, RegistroVueloResultado, PreviewCargoVuelo, CargoVuelo,
} from '@/Types/flights';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

interface FlightRegisterProps {
  onFlightLogUpdate?: (aircraftId: string, tachHours: number) => void;
}

interface Aircraft {
  id:             string;
  matricula:      string;
  modelo:         string;
  fuel_burn_rate: number;
}

interface AsignacionDia {
  id:                string;
  fecha:             string;
  estado:            'PENDIENTE' | 'VOLADO' | 'POSPUESTO' | 'CANCELADO';
  sede:              string;
  instructor_id:     string;
  instructor_nombre: string;
  student_id:        string;
  student_nombre:    string;
  student_serial:    string;
  carrera_id:        string;
  saldo_horas:       number;
  orden_capitan?:    number;
  // ▼ [NEW v7.0] Planificación + billetera
  /** ASIGNACION = asignaciones_vuelo_diario · RESERVA = reservas_slot_vuelo confirmada por Planificación */
  origen?:              'ASIGNACION' | 'RESERVA';
  reserva_id?:          string | null;
  slot_hora?:           string | null;
  tipo_vuelo?:          string | null;
  aeronave_id?:         string | null;
  saldo_usd?:           number | null;
  saldo_horas_paquete?: number | null;
}

/** [NEW v7.0] Fila cruda de reservas_slot_vuelo usada para "Misiones del Día" */
interface ReservaHoy {
  id:                 string;
  student_id:         string | null;
  aeronave_id:        string | null;
  aeronave_matricula: string | null;
  instructor_id:      string | null;
  fecha:              string;
  slot_hora:          string | null;
  tipo_vuelo:         string | null;
  status:             string | null;
}

interface RutaVuelo {
  id:        string;
  destino:   string;
  horas_tac: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BURN_RATE  = 23.0;
const RATE_HORA_CAPITAN  = 15;
const RATE_HORA_ACADEMIA = 180;
const FETCH_RETRY_LIMIT  = 3;
const FETCH_RETRY_DELAY  = 1500;
// [v7.1] Lectura de combustible por lotes
const FUEL_BATCH         = 500;
const FUEL_MAX_BATCHES   = 200;   // tope: 100.000 movimientos por aeronave

const SEDES = ['BARQUISIMETO', 'MATURÍN'] as const;
type Sede = typeof SEDES[number];

/** Elimina diacríticos para queries DB — MATURÍN → MATURIN */
const normalizarSedeDB = (sede: string): string =>
  sede.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** Sleep cancelable por AbortSignal */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// [v7.1] SUPERFICIES B&M (sustituyen el "liquid glass" oscuro de v6/v7.0)
// ─────────────────────────────────────────────────────────────────────────────

const surface = {
  card:  'rounded-[24px] border border-bm-line bg-white',
  tile:  'rounded-2xl border border-bm-line bg-white',
  soft:  'rounded-2xl bg-bm-canvas',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// [FIX v7.0] Fecha LOCAL (America/Caracas). toISOString() devuelve la fecha UTC: después de las 20:00
// en Venezuela el vuelo y las asignaciones quedaban con la fecha de mañana. Misma regla que
// FlightPlanningBoard y CalendarioCapitan.
const pad2       = (n: number) => String(n).padStart(2, '0');
const toYMDLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hoy    = () => toYMDLocal(new Date());
const manana = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toYMDLocal(d);
};

// ─────────────────────────────────────────────────────────────────────────────
// [NEW v7.0] HELPERS DE COBRO / BILLETERA
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const round2  = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const usd     = (n: number) => `$${round2(n).toFixed(2)}`;
const numOr   = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

/** La RPC no existe en la base (migración v18 aún no ejecutada) → usar el registro heredado. */
const esRpcNoInstalada = (err: { code?: string; message?: string } | null | undefined): boolean =>
  !!err && (err.code === 'PGRST202' || err.code === '42883' ||
            /could not find the function|function .* does not exist/i.test(err.message ?? ''));

/** Mensajes del servidor (fn_vuelo_registrar / fn_wallet_*) en lenguaje operativo. */
const ERRORES_VUELO: [RegExp, string][] = [
  [/NO_AUTORIZADO/,                 'Su usuario no está habilitado para registrar vuelos (capitán activo o administración).'],
  [/ALUMNO_NO_EXISTE|ALUMNO_REQUERIDO/, 'El alumno seleccionado no existe en el sistema.'],
  [/AERONAVE_NO_EXISTE/,            'La aeronave seleccionada no existe en la flota.'],
  [/VUELO_DUPLICADO/,               'Este vuelo ya está registrado (misma aeronave y mismo TAC inicial/final).'],
  [/TAC_INVALIDO/,                  'TAC inválido: el TAC final debe ser mayor que el inicial.'],
  [/HORAS_FUERA_DE_RANGO/,          'Delta TAC fuera de rango (más de 12 h en un solo vuelo). Verifique los tacómetros.'],
  [/FECHA_FUTURA/,                  'La fecha del vuelo no puede ser posterior a hoy.'],
  [/FECHA_FUERA_DE_VENTANA/,        'Solo se pueden registrar vuelos de los últimos 7 días. Para fechas anteriores consulte a administración.'],
  [/VUELO_COBRADO/,                 'El vuelo ya fue cobrado: anule primero su consumo en Finanzas → Billeteras.'],
  [/TARIFA_VUELO_NO_CONFIGURADA/,   'No hay tarifa de vuelo activa: configure el Tarifario en Finanzas → Billeteras.'],
  [/CREDITO_EXCEDIDO/,              'La deuda del alumno supera el límite de crédito configurado.'],
];
const traducirErrorVuelo = (msg: string): string => {
  const hit = ERRORES_VUELO.find(([re]) => re.test(msg));
  return hit ? hit[1] : msg;
};

/** Normaliza una fila de fn_vuelo_saldos. */
const normSaldo = (raw: unknown): SaldoVueloAlumno | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.student_id) return null;
  const tarifa = r.tarifa_hora == null ? null : numOr(r.tarifa_hora, 0);
  return {
    student_id:             String(r.student_id),
    horas_paquete:          numOr(r.horas_paquete),
    saldo_usd:              numOr(r.saldo_usd),
    deuda_usd:              numOr(r.deuda_usd),
    tarifa_hora:            tarifa !== null && tarifa > 0 ? tarifa : null,
    servicio:               r.servicio == null ? null : String(r.servicio),
    horas_billetera:        numOr(r.horas_billetera),
    horas_disponibles:      numOr(r.horas_disponibles),
    credito_maximo_usd:     r.credito_maximo_usd == null ? null : numOr(r.credito_maximo_usd),
    credito_disponible_usd: r.credito_disponible_usd == null ? null : numOr(r.credito_disponible_usd),
  };
};

/**
 * Misma regla que fn_vuelo_registrar:
 *   h_paq = min(max(paquete,0), ΔT) · h_bill = ΔT − h_paq · monto = h_bill × tarifa
 *   billetera = min(saldo, monto) · CxC = monto − billetera
 */
const calcularPreviewCargo = (s: SaldoVueloAlumno | null, horasTac: number): PreviewCargoVuelo | null => {
  if (!s || horasTac <= 0) return null;
  const horasPaquete   = round2(Math.min(Math.max(s.horas_paquete, 0), horasTac));
  const horasBilletera = round2(horasTac - horasPaquete);
  const tarifa         = s.tarifa_hora;
  const monto          = tarifa ? round2(horasBilletera * tarifa) : 0;
  const desdeBilletera = round2(Math.min(Math.max(s.saldo_usd, 0), monto));
  return {
    horasPaquete, horasBilletera, tarifa, monto, desdeBilletera,
    aCxc: round2(monto - desdeBilletera),
    sinTarifa: horasBilletera > 0 && !tarifa,
  };
};

/** Texto del cobro aplicado por el servidor. */
const resumenCargo = (c: CargoVuelo): string => {
  if (c.modo === 'PAQUETE_LEGACY') return `Cubierto por paquete anterior (${numOr(c.horas_paquete).toFixed(2)}h)`;
  const partes = [
    numOr(c.horas_paquete) > 0 ? `${numOr(c.horas_paquete).toFixed(2)}h de paquete` : '',
    `${numOr(c.horas_billetera).toFixed(2)}h × ${usd(numOr(c.tarifa))} = ${usd(numOr(c.monto_total))}`,
    numOr(c.desde_billetera) > 0 ? `billetera ${usd(numOr(c.desde_billetera))}` : '',
    numOr(c.a_cxc) > 0 ? `cuentas por cobrar ${usd(numOr(c.a_cxc))}` : '',
  ].filter(Boolean);
  return `${partes.join(' · ')} · saldo ${usd(numOr(c.saldo))}`;
};

/** Horas ya facturadas como deuda en el régimen anterior ("DEUDA VUELO … — 0.70h × $…"). */
const horasDeudaLegacy = (concepto: string | null | undefined): number => {
  const c = String(concepto ?? '');
  if (!/^DEUDA VUELO/i.test(c)) return 0;
  const m = c.match(/—\s*([0-9]+(?:\.[0-9]+)?)\s*h\s*×/i);
  return m ? numOr(m[1]) : 0;
};

/**
 * [v7.1] Efecto de un movimiento de combustible sobre el saldo de una aeronave.
 * Regla de AVGAS (IN +, TRANSFER −/+, BURN −) y, para este aviso de seguridad,
 * OUT (salida del registro heredado) también descuenta: ante la duda se estima
 * menos combustible, nunca más.
 */
const efectoCombustible = (r: { operation_type?: unknown; liters?: unknown; aircraft_id?: unknown; destination_aircraft_id?: unknown }, matricula: string): number => {
  const lts = Number(r.liters) || 0;
  const t   = String(r.operation_type ?? '');
  let delta = 0;
  if (t === 'IN'       && r.aircraft_id === matricula) delta += lts;
  if (t === 'TRANSFER' && r.aircraft_id === matricula) delta -= lts;
  if (t === 'TRANSFER' && r.destination_aircraft_id === matricula) delta += lts;
  if ((t === 'BURN' || t === 'OUT') && r.aircraft_id === matricula) delta -= lts;
  return delta;
};

/**
 * Integra las reservas CONFIRMADAS/COMPLETADAS de hoy (Planificación) con las asignaciones del día.
 * Un alumno con asignación conserva su fila (se le adjunta la reserva); si no, la reserva crea su fila.
 */
const fusionarReservas = (asig: AsignacionDia[], reservas: ReservaHoy[], sedeDb: string, instructorNombre: string): AsignacionDia[] => {
  const out = asig.map(a => ({ ...a }));
  const porAlumno = new Map<string, AsignacionDia>();
  out.forEach(a => { if (a.student_id) porAlumno.set(String(a.student_id), a); });
  for (const r of reservas) {
    const sid = r.student_id ? String(r.student_id) : '';
    if (!sid) continue;
    const confirmada = String(r.status ?? '').toUpperCase() === 'CONFIRMADA';
    const existente  = porAlumno.get(sid);
    if (existente) {
      if (existente.origen !== 'RESERVA' && !existente.reserva_id && confirmada) {
        existente.reserva_id  = String(r.id);
        existente.slot_hora   = r.slot_hora ? String(r.slot_hora).slice(0, 5) : null;
        existente.tipo_vuelo  = r.tipo_vuelo ?? null;
        existente.aeronave_id = r.aeronave_id ? String(r.aeronave_id) : null;
      }
      if (existente.origen !== 'RESERVA') continue;
    }
    out.push({
      id:                `RSV-${r.id}`,
      fecha:             String(r.fecha),
      estado:            confirmada ? 'PENDIENTE' : 'VOLADO',
      sede:              sedeDb,
      instructor_id:     r.instructor_id ? String(r.instructor_id) : '',
      instructor_nombre: instructorNombre,
      student_id:        sid,
      student_nombre:    '',
      student_serial:    '',
      carrera_id:        '',
      saldo_horas:       0,
      origen:            'RESERVA',
      reserva_id:        String(r.id),
      slot_hora:         r.slot_hora ? String(r.slot_hora).slice(0, 5) : null,
      tipo_vuelo:        r.tipo_vuelo ?? null,
      aeronave_id:       r.aeronave_id ? String(r.aeronave_id) : null,
    });
    if (!existente) porAlumno.set(sid, out[out.length - 1]);
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTE: RutaSelector
// ─────────────────────────────────────────────────────────────────────────────

interface RutaSelectorProps {
  rutas:    RutaVuelo[];
  selected: RutaVuelo | null;
  onSelect: (r: RutaVuelo) => void;
  saldo:    number;
  deltaTac: number;
}

const RutaSelector: React.FC<RutaSelectorProps> = ({ rutas, selected, onSelect, saldo, deltaTac }) => {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null); // [v7.1] cierre al tocar fuera / Escape

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const coherencia = useMemo(() => {
    if (!selected || deltaTac <= 0) return null;
    const pct = Math.abs(deltaTac - selected.horas_tac) / selected.horas_tac;
    if (pct <= 0.20) return 'ok';
    if (pct <= 0.40) return 'warn';
    return 'error';
  }, [selected, deltaTac]);

  return (
    <div className="flex w-full flex-col space-y-2">
      <span className={`${bmLabel} flex items-center gap-1.5`} id="fr-ruta-label">
        <Navigation className="h-4 w-4 text-bm-steel" /> Ruta del vuelo <span className="text-bm-red" aria-hidden="true">*</span>
      </span>

      <div className="relative" ref={boxRef}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby="fr-ruta-label"
          onClick={() => setOpen(o => !o)}
          className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border bg-white px-4 py-2.5 text-left transition-[border-color,box-shadow] ${
            open ? 'border-bm-red ring-4 ring-bm-red/10' : 'border-bm-field hover:border-bm-steel/40'}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Navigation className="h-4 w-4 shrink-0 text-bm-red" />
            <div className="min-w-0">
              {selected ? (
                <>
                  <p className="truncate text-base font-semibold uppercase">{selected.destino}</p>
                  <p className="text-xs text-bm-steel">Referencia: <span className="bm-num">{selected.horas_tac}</span> h TAC esperadas</p>
                </>
              ) : (
                <p className="text-base text-bm-hint">Seleccione el destino</p>
              )}
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-bm-steel transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div role="listbox" aria-labelledby="fr-ruta-label"
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-bm-line bg-white shadow-bm-pop">
            {rutas.length === 0 ? (
              <div className="space-y-1 px-4 py-8 text-center">
                <p className="text-sm font-semibold">Sin rutas disponibles</p>
                <p className="text-xs text-bm-steel">Ejecute la migración SQL de rutas_vuelo para esta sede.</p>
              </div>
            ) : (
              rutas.map(ruta => {
                const suficiente = saldo >= ruta.horas_tac;
                const isSelected = selected?.id === ruta.id;
                return (
                  <button
                    key={ruta.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onSelect(ruta); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 border-b border-bm-line px-4 py-3 text-left transition-colors last:border-0 ${
                      isSelected ? 'bg-bm-red-tint' : 'hover:bg-bm-canvas'}`}
                  >
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold uppercase ${isSelected ? 'text-bm-red-deep' : ''}`}>
                        {ruta.destino}
                      </p>
                      {!suficiente && (
                        <p className="mt-0.5 text-xs text-bm-red">Saldo insuficiente para esta ruta</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!suficiente && <AlertTriangle className="h-3.5 w-3.5 text-bm-red" />}
                      <span className={`bm-num text-sm font-semibold ${
                        isSelected ? 'text-bm-red-deep' : suficiente ? 'text-bm-ink' : 'text-bm-red'
                      }`}>{ruta.horas_tac} h</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {selected && deltaTac > 0 && coherencia !== 'ok' && (
        <BmNotice tone={coherencia === 'warn' ? 'warn' : 'danger'} icon={<AlertTriangle className="h-4 w-4" />}>
          Delta TAC (<span className="bm-num">{deltaTac.toFixed(2)}</span> h) difiere{' '}
          <span className="bm-num">{(Math.abs(deltaTac - selected.horas_tac) / selected.horas_tac * 100).toFixed(0)}</span> %
          de la ruta {selected.destino} ({selected.horas_tac} h esperadas).
          {coherencia === 'error' ? ' Verifique los tacómetros.' : ' Verifique la ruta.'}
        </BmNotice>
      )}

      {selected && deltaTac > 0 && coherencia === 'ok' && (
        <BmNotice tone="ok" icon={<CheckCircle2 className="h-4 w-4" />}>
          Delta TAC coherente con la ruta {selected.destino}.
        </BmNotice>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTE: PanelAsignaciones
// ─────────────────────────────────────────────────────────────────────────────

interface PanelAsignacionesProps {
  asignaciones:     AsignacionDia[];
  seleccionado:     string | null;
  onSeleccionar:    (a: AsignacionDia) => void;
  onPosponer:       () => void;
  posponiendo:      boolean;
  instructorNombre: string;
}

const PanelAsignaciones: React.FC<PanelAsignacionesProps> = ({
  asignaciones, seleccionado, onSeleccionar, onPosponer, posponiendo, instructorNombre,
}) => {
  const pendientes = asignaciones.filter(a => a.estado === 'PENDIENTE');
  const volados    = asignaciones.filter(a => a.estado === 'VOLADO');
  const progreso   = asignaciones.length ? Math.round((volados.length / asignaciones.length) * 100) : 0;

  return (
    <section className={`${surface.card} overflow-hidden`} aria-labelledby="fr-misiones">
      <div className="flex flex-col gap-4 border-b border-bm-line p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bm-red-tint text-bm-red">
            <Calendar className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id="fr-misiones" className="bm-heading truncate text-base">
              Misiones del día · {instructorNombre || 'Sistema'}
            </h3>
            <p className="text-[13px] text-bm-steel first-letter:uppercase">
              {new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 sm:flex-none">
            <span className="bm-num text-[13px] text-bm-steel">{volados.length}/{asignaciones.length}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bm-canvas sm:w-24 sm:flex-none"
              role="progressbar" aria-valuenow={progreso} aria-valuemin={0} aria-valuemax={100} aria-label="Misiones completadas">
              <div className="h-full rounded-full bg-bm-red transition-[width] duration-700" style={{ width: `${progreso}%` }} />
            </div>
            <span className="bm-num text-[13px] font-semibold">{progreso} %</span>
          </div>

          <button
            type="button"
            onClick={onPosponer}
            disabled={posponiendo || pendientes.length === 0}
            className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}
          >
            {posponiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudRain className="h-4 w-4" />}
            Posponer día
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3 sm:p-4">
        {asignaciones.length === 0 ? (
          <BmEmpty
            icon={<Plane className="h-5 w-5" />}
            title="Sin asignaciones para hoy"
            text="Verifique la generación de asignaciones del día y los vuelos confirmados por Planificación."
          />
        ) : (
          asignaciones.map(a => {
            const esSeleccionado = seleccionado === a.student_id;
            const yaVolo         = a.estado === 'VOLADO';
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => !yaVolo && onSeleccionar(a)}
                disabled={yaVolo}
                aria-pressed={esSeleccionado}
                className={`group flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors sm:p-4 ${
                  esSeleccionado
                    ? 'border-bm-red bg-bm-red-tint ring-4 ring-bm-red/10'
                    : yaVolo
                    ? 'cursor-default border-bm-line bg-bm-canvas/60'
                    : 'border-bm-line bg-white hover:border-bm-field'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {a.orden_capitan != null && (
                    <span className={`bm-num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      yaVolo ? 'bg-bm-ok-tint text-bm-ok' : 'bg-bm-ink text-white'
                    }`}>
                      {a.orden_capitan}
                    </span>
                  )}
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    yaVolo          ? 'bg-bm-ok-tint text-bm-ok'
                    : esSeleccionado ? 'bg-bm-red text-white'
                    :                  'bg-bm-canvas text-bm-steel'
                  }`}>
                    {yaVolo ? <CheckCircle2 className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold uppercase ${yaVolo ? 'text-bm-steel' : ''}`}>
                      {a.student_nombre}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {a.student_serial && <span className="font-data text-[11px] text-bm-steel">{a.student_serial}</span>}
                      <BmBadge tone={a.saldo_horas > 0 ? 'ok' : 'danger'}>
                        <span className="bm-num">{Number(a.saldo_horas).toFixed(1)}</span> h disponibles
                      </BmBadge>
                      {/* [NEW v7.0] billetera y origen de la misión */}
                      {a.saldo_usd != null && a.saldo_usd > 0 && (
                        <BmBadge tone="neutral" icon={<Wallet className="h-3 w-3" />}>
                          <span className="bm-num">{usd(a.saldo_usd)}</span>
                        </BmBadge>
                      )}
                      {a.reserva_id && (
                        <BmBadge tone="info">
                          Planificación{a.slot_hora ? ` · ${a.slot_hora}` : ''}{a.tipo_vuelo ? ` · ${a.tipo_vuelo}` : ''}
                        </BmBadge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {yaVolo ? (
                    <BmBadge tone="ok">Completado</BmBadge>
                  ) : (
                    <ChevronRight className={`h-5 w-5 transition-transform ${
                      esSeleccionado ? 'translate-x-0.5 text-bm-red' : 'text-bm-hint group-hover:translate-x-0.5 group-hover:text-bm-steel'
                    }`} />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

const FlightRegister = ({ onFlightLogUpdate }: FlightRegisterProps) => {
  // [FIX v7.1] Usuario desde la sesión verificada por AuthContext; getUser() como respaldo.
  const { session } = useAuth();
  const sessionUserId = session?.user?.id ?? null;
  const [authUserId, setAuthUserId] = useState<string | null>(sessionUserId);

  const [isProcessing,     setIsProcessing]     = useState(false);
  const [loadingInicial,   setLoadingInicial]   = useState(true);
  const [posponiendo,      setPosponiendo]      = useState(false);
  const [initError,        setInitError]        = useState<string | null>(null);
  const [retryCount,       setRetryCount]       = useState(0);

  useEffect(() => {
    if (sessionUserId) { setAuthUserId(sessionUserId); return; }
    let vivo = true;
    supabase.auth.getUser()
      .then(({ data: { user } }) => {
        if (!vivo) return;
        if (user?.id) { setAuthUserId(user.id); return; }
        setInitError('auth:No hay una sesión activa. Vuelva a iniciar sesión.');
        setLoadingInicial(false);
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        setInitError(`network:${err instanceof Error ? err.message : 'No se pudo verificar la sesión.'}`);
        setLoadingInicial(false);
      });
    return () => { vivo = false; };
  }, [sessionUserId, retryCount]);

  // [v7.1] Confirmaciones B&M (sustituyen window.confirm)
  const [preguntar, confirmDialog] = useBmConfirm();
  const confirmar = useCallback(async (o: BmConfirmOptions) => (await preguntar(o)) === 'confirm', [preguntar]);

  const [fleet,            setFleet]            = useState<Aircraft[]>([]);
  const [asignaciones,     setAsignaciones]     = useState<AsignacionDia[]>([]);
  const [instructorId,     setInstructorId]     = useState<string | null>(null);
  const [instructorNombre, setInstructorNombre] = useState('');
  const [sedePrincipal,    setSedePrincipal]    = useState<Sede>('BARQUISIMETO');
  const [rutas,            setRutas]            = useState<RutaVuelo[]>([]);
  const [rutaSeleccionada, setRutaSeleccionada] = useState<RutaVuelo | null>(null);
  const [studentBalance,   setStudentBalance]   = useState<number | null>(null);
  const [aircraftFuelStock,setAircraftFuelStock]= useState<number | null>(null);
  const [evidence, setEvidence] = useState<{ inicial: File | null; final: File | null }>({
    inicial: null, final: null,
  });
  // ▼ [NEW v7.0] billetera / registro atómico
  /** null = sin verificar · true = migración v18 instalada · false = usar registro heredado */
  const [v18,            setV18]            = useState<boolean | null>(null);
  const [saldoVuelo,     setSaldoVuelo]     = useState<SaldoVueloAlumno | null>(null);
  const [ultimoRegistro, setUltimoRegistro] = useState<RegistroVueloResultado | null>(null);
  const [form, setForm] = useState({
    aircraft_id:        '',
    matricula:          '',
    fecha:              hoy(),
    sede_vuelo:         'BARQUISIMETO' as Sede,
    tacInicial:         0,
    tacFinal:           0,
    horasCobrada:       0,
    student_id:         '',
    student_nombre:     '',
    instructor:         '',
    precioHoraCostoTac: RATE_HORA_ACADEMIA,
    precioCobrado:      0,
    observacion:        '',
    // ▼ [NEW v7.0] vínculo con la misión seleccionada
    asignacion_id:      '',
    reserva_id:         '',
    instructor_sel_id:  '',
  });

  // ─────────────────────────────────────────────────────────────────────────
  // [NEW v7.0] SALDO COMBINADO DEL PANEL (fn_vuelo_saldos)
  // Horas disponibles = horas de paquete anterior + saldo de billetera ÷ tarifa de la sede.
  // Sin migración v18 → conserva el saldo_horas de la vista (régimen anterior).
  // ─────────────────────────────────────────────────────────────────────────

  const aplicarSaldosPanel = useCallback(async (lista: AsignacionDia[], sedeDb: string): Promise<AsignacionDia[]> => {
    const ids = Array.from(new Set(lista.map(a => String(a.student_id)).filter(id => UUID_RE.test(id))));
    if (ids.length === 0) return lista;
    try {
      const { data, error } = await supabase.rpc('fn_vuelo_saldos', { p_students: ids, p_matricula: null, p_sede: sedeDb });
      if (error) {
        if (esRpcNoInstalada(error)) setV18(false);
        else console.warn('[v7.0] fn_vuelo_saldos:', error.message);
        return lista;
      }
      setV18(true);
      const mapa = new Map<string, SaldoVueloAlumno>();
      (Array.isArray(data) ? (data as unknown[]) : []).forEach(r => { const s = normSaldo(r); if (s) mapa.set(s.student_id, s); });
      return lista.map(a => {
        const s = mapa.get(String(a.student_id));
        return s ? { ...a, saldo_horas: s.horas_disponibles, saldo_usd: s.saldo_usd, saldo_horas_paquete: s.horas_paquete } : a;
      });
    } catch (e) {
      console.warn('[v7.0] fn_vuelo_saldos:', e instanceof Error ? e.message : e);
      return lista;
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // [v6.2] INICIALIZAR
  // Fix crítico: select de instructores usa solo columnas verificadas.
  // Cascada A→B→C para asignaciones según estado del schema.
  // ─────────────────────────────────────────────────────────────────────────

  const inicializar = useCallback(async (signal: AbortSignal) => {
    if (!authUserId) return;
    let attempt = 0;

    while (attempt < FETCH_RETRY_LIMIT) {
      if (signal.aborted) return;
      try {
        setLoadingInicial(true);
        setInitError(null);

        // ── 1. INSTRUCTOR
        // [v6.2] FIX: 'nombre' no existe en instructores — solo 'nombre_completo'
        const { data: instData } = await supabase
          .from('instructores')
          .select('id, nombre_completo, sede')
          .eq('perfil_id', authUserId)
          .maybeSingle();

        if (signal.aborted) return;

        const esInstructor = !!instData;
        const nombre       = instData?.nombre_completo ?? '';

        if (esInstructor) {
          setInstructorId(instData!.id);
          setInstructorNombre(nombre);
          setForm(prev => ({ ...prev, instructor: nombre }));
        }

        const sedeNorm: Sede = instData?.sede?.toUpperCase().includes('MATUR') ? 'MATURÍN' : 'BARQUISIMETO';
        setSedePrincipal(sedeNorm);
        setForm(prev => ({ ...prev, sede_vuelo: sedeNorm }));
        const sedeDb = normalizarSedeDB(sedeNorm);

        // ── 2. RUTAS DE VUELO (silencioso si tabla no existe aún)
        if (signal.aborted) return;
        const { data: rutasData, error: rutasErr } = await supabase
          .from('rutas_vuelo')
          .select('id, destino, horas_tac')
          .eq('sede', sedeDb)
          .eq('activa', true)
          .order('horas_tac', { ascending: true });

        if (signal.aborted) return;
        if (rutasErr) {
          console.warn('[v6.2] rutas_vuelo no disponible:', rutasErr.message);
          setRutas([]);
        } else {
          setRutas((rutasData ?? []) as RutaVuelo[]);
        }

        // ── 3. RPC generar_asignaciones_del_dia (silencioso)
        if (signal.aborted) return;
        await supabase.rpc('generar_asignaciones_del_dia', { p_fecha: hoy(), p_sede: sedeDb })
          .then(({ error }) => { if (error) console.warn('[v6.2] RPC:', error.message); });

        // ── 4. ASIGNACIONES — cascada A → B → C
        if (signal.aborted) return;
        let asigData: AsignacionDia[] = [];

        // [A] Vista completa con orden_capitan (post-migración)
        const selectA = 'id, fecha, estado, sede, instructor_id, instructor_nombre, student_id, student_nombre, student_serial, carrera_id, saldo_horas, orden_capitan';
        const { data: dataA, error: errA } = await (
          esInstructor
            ? supabase.from('v_asignaciones_hoy').select(selectA).eq('instructor_id', instData!.id).order('orden_capitan', { ascending: true })
            : supabase.from('v_asignaciones_hoy').select(selectA).order('orden_capitan', { ascending: true })
        );

        if (signal.aborted) return;

        if (!errA) {
          asigData = (dataA ?? []) as AsignacionDia[];

        } else {
          console.warn('[v6.2] Estrategia A falló:', errA.message);

          // [B] Vista sin orden_capitan (pre-migración de columna)
          const selectB = 'id, fecha, estado, sede, instructor_id, instructor_nombre, student_id, student_nombre, student_serial, carrera_id, saldo_horas';
          const { data: dataB, error: errB } = await (
            esInstructor
              ? supabase.from('v_asignaciones_hoy').select(selectB).eq('instructor_id', instData!.id)
              : supabase.from('v_asignaciones_hoy').select(selectB)
          );

          if (signal.aborted) return;

          if (!errB) {
            console.info('[v6.2] Estrategia B — ejecutar migración SQL para orden_capitan');
            asigData = (dataB ?? []).map((r: any) => ({ ...r, orden_capitan: null })) as AsignacionDia[];

          } else {
            console.warn('[v6.2] Estrategia B falló:', errB.message);

            // [C] Tabla base directa — columnas reales verificadas del schema
            // asignaciones_vuelo_diario: id, fecha, instructor_id, student_id,
            //   sede, estado, fecha_postpuesta, created_at, duracion_horas
            // Sin: carrera_id, orden_capitan, student_nombre, student_serial, saldo_horas
            const selectC = 'id, fecha, estado, sede, instructor_id, student_id, duracion_horas';
            const { data: dataC, error: errC } = await (
              esInstructor
                ? supabase.from('asignaciones_vuelo_diario').select(selectC)
                    .eq('fecha', hoy()).eq('instructor_id', instData!.id).neq('estado', 'CANCELADO')
                : supabase.from('asignaciones_vuelo_diario').select(selectC)
                    .eq('fecha', hoy()).eq('sede', sedeDb).neq('estado', 'CANCELADO')
            );

            if (signal.aborted) return;

            if (!errC) {
              console.info('[v6.2] Estrategia C — datos mínimos sin JOIN, vista no disponible');
              asigData = (dataC ?? []).map((r: any) => ({
                ...r,
                instructor_nombre: nombre,
                student_nombre:    '',
                student_serial:    '',
                carrera_id:        '',
                saldo_horas:       0,
                orden_capitan:     null,
              })) as AsignacionDia[];
            } else {
              console.error('[v6.2] Todas las estrategias fallaron:', errC.message);
            }
          }
        }

        // ── 4b. [v7.0] MISIONES CONFIRMADAS POR PLANIFICACIÓN (reservas_slot_vuelo de hoy)
        //        Alumnos con vuelo confirmado que generar_asignaciones_del_dia no incluyó
        //        (p. ej. alumnos con saldo solo en billetera) también aparecen aquí.
        if (signal.aborted) return;
        asigData = asigData.map(a => ({ ...a, origen: 'ASIGNACION' as const }));
        try {
          const qRes = supabase
            .from('reservas_slot_vuelo')
            .select('id, student_id, aeronave_id, aeronave_matricula, instructor_id, fecha, slot_hora, tipo_vuelo, status')
            .eq('fecha', hoy())
            .in('status', ['CONFIRMADA', 'COMPLETADA']);
          const { data: resData, error: resErr } = await (
            esInstructor ? qRes.eq('instructor_id', instData!.id) : qRes
          ).order('slot_hora', { ascending: true });
          if (signal.aborted) return;
          if (resErr) console.warn('[v7.0] reservas_slot_vuelo no disponible:', resErr.message);
          else asigData = fusionarReservas(asigData, (resData ?? []) as ReservaHoy[], sedeDb, nombre);
        } catch (e) {
          console.warn('[v7.0] reservas_slot_vuelo:', e instanceof Error ? e.message : e);
        }

        // ── 4c. [v7.0] Nombres faltantes (estrategia C y reservas) desde perfiles_estudiantes
        const sinNombre = Array.from(new Set(asigData.filter(a => !a.student_nombre && a.student_id).map(a => String(a.student_id))));
        if (sinNombre.length > 0) {
          const { data: est } = await supabase
            .from('perfiles_estudiantes')
            .select('id, nombre_completo, student_serial')
            .in('id', sinNombre);
          if (signal.aborted) return;
          const porId = new Map<string, { nombre_completo: string | null; student_serial: string | null }>(
            (est ?? []).map((e: any) => [String(e.id), { nombre_completo: e.nombre_completo ?? null, student_serial: e.student_serial ?? null }]));
          asigData = asigData.map(a => {
            const e = porId.get(String(a.student_id));
            return a.student_nombre || !e ? a : {
              ...a,
              student_nombre: e.nombre_completo ?? `ALUMNO ${String(a.student_id).slice(0, 8)}`,
              student_serial: a.student_serial || e.student_serial || '',
            };
          });
        }

        // ── 4d. [v7.0] Saldo combinado (paquete + billetera en horas a la tarifa de la sede)
        asigData = await aplicarSaldosPanel(asigData, sedeDb);

        if (signal.aborted) return;
        setAsignaciones(asigData);

        // ── 5. FLOTA
        const { data: fleetData, error: fleetErr } = await supabase
          .from('flota_aviones')
          .select('id, matricula, modelo, fuel_burn_rate')
          .order('matricula');

        if (signal.aborted) return;
        if (!fleetErr && fleetData?.length) {
          setFleet(fleetData);
          setForm(prev => ({ ...prev, aircraft_id: fleetData[0].id, matricula: fleetData[0].matricula }));
        }

        setLoadingInicial(false);
        setInitError(null);
        return;

      } catch (err: any) {
        if (signal.aborted || err.name === 'AbortError') return;
        attempt++;
        if (attempt < FETCH_RETRY_LIMIT) {
          try { await sleep(FETCH_RETRY_DELAY * attempt, signal); } catch { return; }
        } else {
          if (!signal.aborted) { setInitError(`network:${err.message}`); setLoadingInicial(false); }
        }
      }
    }
  }, [authUserId, aplicarSaldosPanel]);

  useEffect(() => {
    const controller = new AbortController();
    inicializar(controller.signal);
    return () => controller.abort();
  }, [inicializar, retryCount]);

  // [v7.1] Reintento desde la pantalla de error (también reverifica la sesión)
  const reintentar = () => {
    setInitError(null);
    setLoadingInicial(true);
    setRetryCount(c => c + 1);
  };

  // ── SELECCIONAR ALUMNO ───────────────────────────────────────────────────

  const handleSeleccionarAlumno = useCallback((a: AsignacionDia) => {
    const sedeNorm: Sede = a.sede?.toUpperCase().includes('MATUR') ? 'MATURÍN' : 'BARQUISIMETO';
    // [NEW v7.0] aeronave asignada por Planificación (si existe en la flota) + vínculo con la misión
    const avionPlan = a.aeronave_id ? fleet.find(f => f.id === a.aeronave_id) : undefined;
    setForm(prev => ({
      ...prev, student_id: a.student_id, student_nombre: a.student_nombre, sede_vuelo: sedeNorm,
      asignacion_id:     a.origen === 'RESERVA' ? '' : a.id,
      reserva_id:        a.reserva_id ?? '',
      instructor_sel_id: a.instructor_id ?? '',
      ...(avionPlan ? { aircraft_id: avionPlan.id, matricula: avionPlan.matricula } : {}),
    }));
    setRutaSeleccionada(null);
    setUltimoRegistro(null);
  }, [fleet]);

  // ── SALDO COMBUSTIBLE ────────────────────────────────────────────────────
  // [FIX v7.1] Lectura completa por lotes (antes un SELECT truncado a 1.000 filas),
  // regla de AVGAS + OUT, valores entre comillas en el filtro .or() y descarte de
  // respuestas obsoletas si se cambia de aeronave mientras se lee.

  useEffect(() => {
    let cancelado = false;
    const fetchFuel = async () => {
      if (!form.matricula) { setAircraftFuelStock(null); return; }
      try {
        const matricula = form.matricula;
        const m = matricula.replace(/"/g, '');
        const porId = new Map<string, any>();
        for (let b = 0; b < FUEL_MAX_BATCHES; b++) {
          const from = b * FUEL_BATCH;
          const { data: logs, error } = await (supabase as any)
            .from('registros_combustible')
            .select('id, operation_type, liters, aircraft_id, destination_aircraft_id')
            .or(`aircraft_id.eq."${m}",destination_aircraft_id.eq."${m}"`)
            .order('id', { ascending: true })
            .range(from, from + FUEL_BATCH - 1);
          if (error) throw error;
          if (cancelado) return;
          const filas = (logs ?? []) as any[];
          filas.forEach((r, i) => porId.set(r.id != null ? String(r.id) : `sin-id-${from + i}`, r));
          if (filas.length < FUEL_BATCH) break;
        }
        if (cancelado) return;
        let stock = 0;
        porId.forEach(r => { stock += efectoCombustible(r, matricula); });
        setAircraftFuelStock(Math.max(stock, 0));
      } catch { if (!cancelado) setAircraftFuelStock(null); }
    };
    fetchFuel();
    return () => { cancelado = true; };
  }, [form.matricula]);

  // ── SALDO HORAS ALUMNO ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelado = false;   // [NEW v7.0] evita pisar el saldo si el capitán cambia de alumno/aeronave rápido
    const fetchBalance = async () => {
      if (!form.student_id) { setStudentBalance(null); setSaldoVuelo(null); return; }
      try {
        // ▼ [NEW v7.0] saldo combinado a la tarifa de ESTA aeronave (paquete + billetera)
        if (v18 !== false && UUID_RE.test(form.student_id)) {
          const { data, error } = await supabase.rpc('fn_vuelo_saldos', {
            p_students: [form.student_id], p_matricula: form.matricula || null, p_sede: normalizarSedeDB(form.sede_vuelo),
          });
          if (cancelado) return;
          if (!error) {
            const s = normSaldo(Array.isArray(data) ? (data as unknown[])[0] : null);
            if (s) {
              if (v18 !== true) setV18(true);
              setSaldoVuelo(s);
              setStudentBalance(s.horas_disponibles);
              return;
            }
          } else if (esRpcNoInstalada(error)) {
            setV18(false);
          } else {
            console.warn('[v7.0] fn_vuelo_saldos:', error.message);
          }
        }
        setSaldoVuelo(null);

        // ▼ Régimen anterior (sin migración v18)
        const asig = asignaciones.find(a => a.student_id === form.student_id);
        if (asig && asig.saldo_horas > 0) { setStudentBalance(asig.saldo_horas); return; }
        // [FIX v7.0] Sin filtro estatus='COBRADO': un paquete PARCIAL ya acredita horas_compradas proporcionales
        //            (igual que Finanzas y "Horas y Facturación"). Las horas ya facturadas como deuda
        //            ("DEUDA VUELO … h ×") no se descuentan dos veces.
        const [pagosRes, vuelosRes] = await Promise.all([
          supabase.from('cuentas_por_cobrar').select('horas_compradas, horas_prometidas, concepto').eq('student_id', form.student_id),
          supabase.from('bitacora_vuelos').select('horas_tac').eq('student_id', form.student_id),
        ]);
        if (cancelado) return;
        const compradas = (pagosRes.data || []).reduce((a, p) => a + Math.max(Number(p.horas_compradas) || 0, 0), 0);
        const deudaH    = (pagosRes.data || []).reduce((a, p) => a + ((Number(p.horas_prometidas) || 0) === 0 ? horasDeudaLegacy(p.concepto) : 0), 0);
        const voladas   = (vuelosRes.data || []).reduce((a, v) => a + (Number(v.horas_tac) || 0), 0);
        setStudentBalance(Math.max(0, compradas - Math.max(voladas - deudaH, 0)));
      } catch { if (!cancelado) setStudentBalance(null); }
    };
    fetchBalance();
    return () => { cancelado = true; };
  }, [form.student_id, form.matricula, form.sede_vuelo, asignaciones, v18]);

  // ── CÁLCULOS ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const horasTac         = Math.max(0, parseFloat((form.tacFinal - form.tacInicial).toFixed(2)));
    const pagoCapitan      = horasTac * RATE_HORA_CAPITAN;
    const pagoGasolina     = (horasTac * 23) * 3.3;
    const costoOperacional = form.horasCobrada * 20;
    const produccionNeta   = form.precioCobrado - (pagoCapitan + pagoGasolina + costoOperacional);
    const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
    const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;
    const litersToBurn     = parseFloat((horasTac * burnRate).toFixed(1));
    return { horasTac, pagoCapitan, pagoGasolina, costoOperacional, produccionNeta, litersToBurn, burnRate };
  }, [form.tacFinal, form.tacInicial, form.horasCobrada, form.precioCobrado, form.aircraft_id, fleet]);

  // [NEW v7.0] Tarifa real del Tarifario para esta aeronave/sede (respaldo: tarifa histórica $180/h)
  const tarifaHora = saldoVuelo?.tarifa_hora ?? RATE_HORA_ACADEMIA;

  // [NEW v7.0] Vista previa del cobro (misma regla que fn_vuelo_registrar)
  const preview = useMemo(() => calcularPreviewCargo(saldoVuelo, stats.horasTac), [saldoVuelo, stats.horasTac]);
  const excedeCredito = !!preview && !!saldoVuelo && saldoVuelo.credito_disponible_usd !== null
    && preview.aCxc > saldoVuelo.credito_disponible_usd;

  useEffect(() => {
    if (!instructorId) setForm(prev => ({ ...prev, precioCobrado: round2(form.horasCobrada * tarifaHora) }));   // [v7.0] tarifa vigente
  }, [form.horasCobrada, instructorId, tarifaHora]);

  // ── POSPONER DÍA ─────────────────────────────────────────────────────────

  const handlePosponer = useCallback(async () => {
    // [v7.0] Solo se posponen asignaciones del día; los vuelos de Planificación se reprograman en su tablero
    const pendientesCount = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.origen !== 'RESERVA').length;
    const reservasPend    = asignaciones.filter(a => a.estado === 'PENDIENTE' && a.origen === 'RESERVA').length;
    if (!(await confirmar({
      title: 'Posponer el día',
      subtitle: `Mover las misiones al ${manana()}`,
      icon: <CloudRain className="h-5 w-5" />,
      confirmLabel: `Posponer ${pendientesCount} ${pendientesCount === 1 ? 'misión' : 'misiones'}`,
      variant: 'dark',
      body: <>
        <p>¿Posponer <strong>{pendientesCount}</strong> {pendientesCount === 1 ? 'misión pendiente' : 'misiones pendientes'} al <span className="bm-num">{manana()}</span>?</p>
        {reservasPend > 0 && (
          <BmNotice tone="info">
            {reservasPend} vuelo(s) confirmados por Planificación no se mueven aquí: Planificación debe reprogramarlos.
          </BmNotice>
        )}
      </>,
    }))) return;
    setPosponiendo(true);
    try {
      const sede = asignaciones[0]?.sede ?? 'BARQUISIMETO';
      const { data: count, error } = await supabase.rpc('posponer_dia_vuelo', {
        p_fecha_origen: hoy(), p_fecha_destino: manana(), p_sede: sede,
      });
      if (error) throw error; // [FIX v7.1] antes se ignoraba y se anunciaba "✓ undefined misiones"
      alert(`✓ ${numOr(count)} misiones pospuestas al ${manana()}.`);
      const ctrl = new AbortController();
      await inicializar(ctrl.signal);
    } catch (e: any) {
      alert('Error al posponer: ' + (e?.message ?? String(e)));
    } finally {
      setPosponiendo(false);
    }
  }, [asignaciones, inicializar, confirmar]);

  // ── UPLOAD EVIDENCIA ─────────────────────────────────────────────────────

  const uploadToMIAStorage = async (file: File, prefix: string) => {
    const ext      = file.name.split('.').pop();
    const fileName = `${prefix}_${form.matricula}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tacometros').upload(fileName, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('tacometros').getPublicUrl(fileName);
    return publicUrl;
  };

  // ── [NEW v7.0] REGISTRO ATÓMICO (fn_vuelo_registrar) ────────────────────
  // Devuelve null si la migración v18 no está instalada (→ registro heredado).
  // TAC_SOLAPADO: pide confirmación consciente y reintenta con confirmar_solape.

  const registrarVueloV18 = async (payload: RegistroVueloInput): Promise<RegistroVueloResultado | null> => {
    let { data, error } = await supabase.rpc('fn_vuelo_registrar', { p: payload });
    if (error && /TAC_SOLAPADO/.test(error.message ?? '')) {
      if (!(await confirmar({
        title: 'TAC solapado',
        subtitle: `${form.matricula} · ${payload.tac_inicial} → ${payload.tac_final}`,
        icon: <AlertTriangle className="h-5 w-5" />,
        tone: 'danger',
        confirmLabel: 'Los tacómetros son correctos',
        cancelLabel: 'Revisar',
        variant: 'danger',
        body: <p>El intervalo TAC <span className="bm-num">{payload.tac_inicial} → {payload.tac_final}</span> de {form.matricula} se cruza con otro vuelo ya registrado. ¿Confirma que los tacómetros son correctos?</p>,
      }))) throw new Error('Registro cancelado: verifique los tacómetros.');
      ({ data, error } = await supabase.rpc('fn_vuelo_registrar', { p: { ...payload, confirmar_solape: true } }));
    }
    if (error) {
      if (esRpcNoInstalada(error)) { setV18(false); return null; }
      throw new Error(traducirErrorVuelo(error.message ?? 'Error del servidor'));
    }
    setV18(true);
    const r = (data ?? {}) as Record<string, unknown>;
    return {
      vuelo_id:        String(r.vuelo_id ?? ''),
      fecha:           String(r.fecha ?? form.fecha),
      horas:           numOr(r.horas, stats.horasTac),
      litros:          numOr(r.litros),
      matricula:       String(r.matricula ?? form.matricula),
      capitan_id:      r.capitan_id == null ? null : String(r.capitan_id),
      asignacion_id:   r.asignacion_id == null ? null : String(r.asignacion_id),
      reserva_id:      r.reserva_id == null ? null : String(r.reserva_id),
      cargo:           r.cargo && typeof r.cargo === 'object' ? (r.cargo as CargoVuelo) : null,
      cobro_pendiente: r.cobro_pendiente === true,
      cobro_error:     r.cobro_error == null ? null : String(r.cobro_error),
      avisos:          Array.isArray(r.avisos) ? (r.avisos as unknown[]).map(String) : [],
    };
  };

  // ── CERRAR BITÁCORA ──────────────────────────────────────────────────────

  const handleProcessFlight = async () => {
    if (isProcessing) return; // [v7.1] doble toque durante las confirmaciones
    if (!form.aircraft_id || stats.horasTac <= 0 || !form.student_id)
      return alert('SISTEMA: Verifique Aeronave, TAC y Cadete seleccionado.');
    if (!evidence.inicial || !evidence.final)
      return alert('CRITICAL: Se requiere evidencia visual de tacómetros para MRO.');
    if (!rutaSeleccionada)
      return alert('SISTEMA: Seleccione la ruta del vuelo antes de cerrar bitácora.');
    if (form.fecha > hoy())   // [NEW v7.0] el servidor también lo bloquea (FECHA_FUTURA)
      return alert('SISTEMA: La fecha del vuelo no puede ser posterior a hoy.');

    const deficit = studentBalance !== null ? Math.max(0, stats.horasTac - studentBalance) : null;
    let autorizarSobreLimite = false;   // [NEW v7.0] solo administración

    if (v18 !== false && preview && saldoVuelo) {
      // ▼ [NEW v7.0] Aviso en USD con la tarifa real (paquete → billetera → cuentas por cobrar)
      if (preview.sinTarifa) {
        if (!(await confirmar({
          title: 'Sin tarifa de vuelo',
          subtitle: form.matricula,
          icon: <AlertTriangle className="h-5 w-5" />,
          confirmLabel: 'Registrar con cobro pendiente',
          body: <p>No hay tarifa activa para {form.matricula}. El vuelo se registrará y el cobro de <span className="bm-num">{preview.horasBilletera.toFixed(2)}</span> h quedará pendiente en Finanzas → Billeteras → Vuelos por cargar.</p>,
        }))) return;
      } else if (preview.aCxc > 0) {
        if (!(await confirmar({
          title: 'Saldo insuficiente',
          subtitle: form.student_nombre,
          icon: <Wallet className="h-5 w-5" />,
          confirmLabel: 'Continuar',
          body: <dl className="space-y-1.5 rounded-2xl bg-bm-canvas p-4 text-sm">
            {preview.horasPaquete > 0 && <Fila k="Paquete anterior" v={`${preview.horasPaquete.toFixed(2)} h`} />}
            <Fila k="Billetera" v={usd(saldoVuelo.saldo_usd)} />
            <Fila k="Cargo" v={`${preview.horasBilletera.toFixed(2)} h × ${usd(preview.tarifa ?? 0)} = ${usd(preview.monto)}`} />
            <Fila k="A cuentas por cobrar" v={usd(preview.aCxc)} fuerte />
          </dl>,
        }))) return;
        if (excedeCredito) {
          if (instructorId !== null) {
            if (!(await confirmar({
              title: 'Límite de crédito',
              icon: <AlertTriangle className="h-5 w-5" />,
              confirmLabel: 'Registrar con cobro pendiente',
              body: <p>La deuda del alumno supera el límite autorizado. El vuelo se registrará y el cobro quedará pendiente de autorización de administración.</p>,
            }))) return;
          } else {
            // [FIX v7.1] Decisión explícita; cerrar el diálogo no registra nada.
            const decision = await preguntar({
              title: `Límite de crédito (${usd(saldoVuelo.credito_maximo_usd ?? 0)})`,
              icon: <AlertTriangle className="h-5 w-5" />,
              tone: 'danger',
              confirmLabel: 'Autorizar cobro',
              cancelLabel: 'Registrar con cobro pendiente',
              variant: 'danger',
              body: <p>La nueva deuda (<span className="bm-num">{usd(preview.aCxc)}</span>) supera el crédito disponible (<span className="bm-num">{usd(saldoVuelo.credito_disponible_usd ?? 0)}</span>).</p>,
            });
            if (decision === 'dismiss') return;
            autorizarSobreLimite = decision === 'confirm';
          }
        }
      }
    } else if (deficit !== null && deficit > 0) {
      if (!(await confirmar({
        title: 'Saldo insuficiente',
        subtitle: form.student_nombre,
        icon: <AlertTriangle className="h-5 w-5" />,
        confirmLabel: 'Registrar con deuda',
        body: <>
          <dl className="space-y-1.5 rounded-2xl bg-bm-canvas p-4 text-sm">
            <Fila k="Saldo" v={`${(studentBalance ?? 0).toFixed(1)} h`} />
            <Fila k="Vuelo" v={`${stats.horasTac.toFixed(2)} h`} />
            <Fila k="Déficit" v={`${deficit.toFixed(2)} h = $${(deficit * form.precioHoraCostoTac).toFixed(2)}`} fuerte />
          </dl>
          <p>Se registrará una deuda. ¿Continuar?</p>
        </>,
      }))) return;
    }

    if (aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn) {
      if (!(await confirmar({
        title: 'Combustible bajo',
        subtitle: form.matricula,
        icon: <Fuel className="h-5 w-5" />,
        confirmLabel: 'Continuar',
        body: <p>{form.matricula} tiene <span className="bm-num font-semibold">{aircraftFuelStock.toFixed(1)}</span> L. Este vuelo consumirá unos <span className="bm-num font-semibold">{stats.litersToBurn.toFixed(1)}</span> L.</p>,
      }))) return;
    }

    const pct = Math.abs(stats.horasTac - rutaSeleccionada.horas_tac) / rutaSeleccionada.horas_tac;
    if (pct > 0.40) {
      if (!(await confirmar({
        title: 'Incoherencia TAC vs ruta',
        subtitle: rutaSeleccionada.destino,
        icon: <AlertTriangle className="h-5 w-5" />,
        confirmLabel: 'Confirmar',
        body: <dl className="space-y-1.5 rounded-2xl bg-bm-canvas p-4 text-sm">
          <Fila k="Delta TAC" v={`${stats.horasTac.toFixed(2)} h`} />
          <Fila k={`Ruta (${rutaSeleccionada.destino})`} v={`${rutaSeleccionada.horas_tac} h`} />
          <Fila k="Diferencia" v={`${(pct * 100).toFixed(0)} %`} fuerte />
        </dl>,
      }))) return;
    }

    const horasCobradas    = instructorId ? stats.horasTac : form.horasCobrada;
    const montoCobrado     = instructorId ? parseFloat((stats.horasTac * tarifaHora).toFixed(2)) : form.precioCobrado;   // [v7.0] tarifa vigente
    const pagoCapFinal     = horasCobradas * RATE_HORA_CAPITAN;
    const pagoGasFinal     = (stats.horasTac * 23) * 3.3;
    const costoOpFinal     = horasCobradas * 20;
    const produccionFinal  = montoCobrado - (pagoCapFinal + pagoGasFinal + costoOpFinal);

    setIsProcessing(true);
    try {
      const urlInicial = await uploadToMIAStorage(evidence.inicial!, 'START');
      const urlFinal   = await uploadToMIAStorage(evidence.final!,   'END');

      // ═══ [NEW v7.0] UNA transacción en el servidor ═══════════════════════
      let resultado: RegistroVueloResultado | null = null;
      if (v18 !== false) {
        resultado = await registrarVueloV18({
          student_id:           form.student_id,
          aircraft_id:          form.aircraft_id,
          matricula:            form.matricula,
          fecha:                form.fecha,
          sede_vuelo:           form.sede_vuelo,
          tac_inicial:          form.tacInicial,
          tac_final:            form.tacFinal,
          ruta:                 rutaSeleccionada.destino.toUpperCase(),
          ruta_id:              rutaSeleccionada.id,
          destino:              rutaSeleccionada.destino,
          tipo_mision:          rutaSeleccionada.destino.toUpperCase(),
          alumno:               form.student_nombre,
          instructor:           form.instructor.toUpperCase(),
          instructor_id:        form.instructor_sel_id || null,
          horas_cobradas:       horasCobradas,
          produccion_neta:      round2(produccionFinal),
          pago_capitan:         round2(pagoCapFinal),
          pago_gasolina:        round2(pagoGasFinal),
          costo_operacional:    round2(costoOpFinal),
          url_foto_tac_inicial: urlInicial,
          url_foto_tac_final:   urlFinal,
          observacion:          form.observacion.toUpperCase(),
          asignacion_id:        form.asignacion_id && UUID_RE.test(form.asignacion_id) ? form.asignacion_id : null,
          reserva_id:           form.reserva_id || null,
          autorizar_sobre_limite: autorizarSobreLimite,
        });
      }

      if (resultado) {
        // ▼ Estado local: misión completada + saldos frescos del panel
        const selId = asignaciones.find(a => a.student_id === form.student_id && a.estado === 'PENDIENTE' &&
                        ((form.asignacion_id !== '' && a.id === form.asignacion_id) || (form.reserva_id !== '' && a.reserva_id === form.reserva_id)))?.id
                   ?? asignaciones.find(a => a.student_id === form.student_id && a.estado === 'PENDIENTE')?.id;
        const nuevas = asignaciones.map(a => a.id === selId ? { ...a, estado: 'VOLADO' as const } : a);
        setAsignaciones(nuevas);
        void aplicarSaldosPanel(nuevas, normalizarSedeDB(sedePrincipal)).then(conSaldo => {
          const porId = new Map(conSaldo.map(a => [a.id, a]));
          setAsignaciones(prev => prev.map(a => {
            const s = porId.get(a.id);
            return s ? { ...a, saldo_horas: s.saldo_horas, saldo_usd: s.saldo_usd, saldo_horas_paquete: s.saldo_horas_paquete } : a;
          }));
        });

        if (onFlightLogUpdate) onFlightLogUpdate(form.aircraft_id, stats.horasTac);

        setUltimoRegistro(resultado);
        const otrosAvisos = resultado.avisos.filter(a => !a.startsWith('COBRO_PENDIENTE'));
        const lineaCobro  = resultado.cargo
          ? `\n\nCOBRO: ${resumenCargo(resultado.cargo)}`
          : `\n\n⚠️ COBRO PENDIENTE: ${traducirErrorVuelo(resultado.cobro_error ?? '')}\nQueda en Finanzas → Billeteras → Vuelos por cargar.`;
        alert(
          `MIA: BITÁCORA SINCRONIZADA — ${rutaSeleccionada.destino} · ${resultado.horas.toFixed(2)}h TAC.${lineaCobro}` +
          (otrosAvisos.length ? `\n\nAvisos: ${otrosAvisos.join(' · ')}` : '')
        );
      } else {
        // ═══ REGISTRO HEREDADO v6.2 — respaldo mientras la migración v18 no esté instalada ═══
        const { error: dbError } = await supabase.from('bitacora_vuelos').insert([{
          fecha:                form.fecha,
          aircraft_id:          form.aircraft_id,
          aeronave_matricula:   form.matricula,
          ruta:                 rutaSeleccionada.destino.toUpperCase(),
          ruta_id:              rutaSeleccionada.id,
          destino:              rutaSeleccionada.destino,
          sede_vuelo:           form.sede_vuelo,
          tac_inicial:          form.tacInicial,
          tac_final:            form.tacFinal,
          horas_tac:            stats.horasTac,
          horas_cobradas:       horasCobradas,
          alumno:               form.student_nombre,
          student_id:           form.student_id,
          instructor:           form.instructor.toUpperCase(),
          produccion_neta:      produccionFinal,
          pago_capitan:         pagoCapFinal,
          pago_gasolina:        pagoGasFinal,
          costo_operacional:    costoOpFinal,
          url_foto_tac_inicial: urlInicial,
          url_foto_tac_final:   urlFinal,
          observacion:          form.observacion.toUpperCase(),
        }]);
        if (dbError) throw dbError;

        // [FIX v7.1] Las escrituras secundarias ya no fallan en silencio
        const fallos: string[] = [];

        const { error: horasErr } = await supabase.from('horas_vuelo_estudiante').insert([{
          student_id:      form.student_id,
          fecha:           form.fecha,
          horas:           stats.horasTac,
          matricula_avion: form.matricula,
          tipo_mision:     rutaSeleccionada.destino.toUpperCase(),
        }]);
        if (horasErr) fallos.push(`horas del alumno (${horasErr.message})`);

        // [FIX v7.0] Eliminado el INSERT de un INGRESO 'PAID' (categoría 'Vuelos') en transacciones_finanzas:
        //            sin método de pago ni asiento, contaba el ingreso dos veces (venta del paquete/recarga
        //            y vuelo) en el Estado de Resultados. El ingreso del vuelo lo reconoce Finanzas al
        //            cobrarlo (Billeteras → Vuelos por cargar) o el paquete al venderse.

        if (stats.litersToBurn > 0) {
          const { error: fuelErr } = await (supabase as any).from('registros_combustible').insert([{
            operation_type:          'OUT',
            aircraft_id:             form.matricula,
            destination_aircraft_id: null,
            liters:                  stats.litersToBurn,
            fuel_type:               'AVGAS 100LL',
            location:                form.sede_vuelo,
            ticket_number:           `BRN-${form.fecha}-${form.matricula}`,
            technician:              form.student_nombre.toUpperCase(),
            hobbs_at_charge:         form.tacFinal,
          }]);
          if (fuelErr) fallos.push(`consumo de combustible (${fuelErr.message})`);
        }

        if (deficit !== null && deficit > 0) {
          const montoDeuda = parseFloat((deficit * form.precioHoraCostoTac).toFixed(2));
          const { error: deudaErr } = await supabase.from('cuentas_por_cobrar').insert([{
            alumno_id:        form.student_id,
            student_id:       form.student_id,
            nombre_alumno:    form.student_nombre.toUpperCase(),
            monto_total:      montoDeuda,
            monto_pagado:     0,
            monto_pendiente:  montoDeuda,
            concepto:         `DEUDA VUELO ${form.matricula} — ${deficit.toFixed(2)}h × $${form.precioHoraCostoTac}/h — ${rutaSeleccionada.destino} — ${form.fecha}`,
            fecha_emision:    form.fecha,
            estatus:          'PENDIENTE',
            horas_compradas:  0,
            horas_prometidas: 0,
          }]);
          if (deudaErr) fallos.push(`deuda del alumno (${deudaErr.message})`);
        }

        const asig = asignaciones.find(a => a.student_id === form.student_id && a.estado === 'PENDIENTE')
                  ?? asignaciones.find(a => a.student_id === form.student_id);
        if (asig) {
          // [v7.0] las filas que vienen de Planificación (RSV-…) no existen en asignaciones_vuelo_diario
          if (asig.origen !== 'RESERVA') {
            const { error: asigErr } = await supabase.from('asignaciones_vuelo_diario').update({ estado: 'VOLADO' }).eq('id', asig.id);
            if (asigErr) fallos.push(`estado de la misión (${asigErr.message})`);
          }
          setAsignaciones(prev => prev.map(a => a.id === asig.id ? { ...a, estado: 'VOLADO' } : a));
        }

        if (onFlightLogUpdate) onFlightLogUpdate(form.aircraft_id, stats.horasTac);

        const debtMsg = deficit && deficit > 0 ? `\n\nDeuda: $${(deficit * form.precioHoraCostoTac).toFixed(2)}` : '';
        const fallosMsg = fallos.length
          ? `\n\n⚠️ La bitácora quedó guardada, pero NO se registró: ${fallos.join('; ')}. Avise a administración.`
          : '';
        alert(`MIA: BITÁCORA SINCRONIZADA — ${rutaSeleccionada.destino} · ${stats.horasTac.toFixed(2)}h TAC.${debtMsg}${fallosMsg}`);
      }

      setForm(prev => ({
        ...prev, tacInicial: prev.tacFinal, tacFinal: 0,
        horasCobrada: 0, precioCobrado: 0, student_id: '', student_nombre: '',
        asignacion_id: '', reserva_id: '', instructor_sel_id: '',   // [v7.0]
      }));
      setEvidence({ inicial: null, final: null });
      setStudentBalance(null);
      setSaldoVuelo(null);   // [v7.0]
      setRutaSeleccionada(null);

    } catch (e: any) {
      alert('SISTEMA MIA ERROR CRÍTICO: ' + (e?.message ?? String(e)));
    } finally {
      setIsProcessing(false);
    }
  };

  // ── DERIVED ──────────────────────────────────────────────────────────────

  const esCapitan        = instructorId !== null;
  const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
  const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;

  // [v7.1] Tono del saldo (antes clases de color sobre fondo negro)
  const balanceTone = studentBalance === null ? 'neutral'
    : studentBalance >= stats.horasTac ? 'ok'
    : studentBalance > 0               ? 'warn'
    :                                    'danger';

  const balanceLabel = studentBalance === null ? ''
    : `${studentBalance >= 0 ? 'Saldo' : 'Debe'} ${Math.abs(studentBalance).toFixed(1)} h`;

  const combustibleBajo = aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn;

  // ── PANTALLA ERROR DE RED ─────────────────────────────────────────────────

  if (!loadingInicial && initError) {
    const esAuth = initError.startsWith('auth:');
    return (
      <div className={`${surface.card} bm-app text-bm-ink`}>
        <BmEmpty
          icon={<WifiOff className="h-5 w-5" />}
          title={esAuth ? 'Sesión no disponible' : 'Sin conexión'}
          text={initError.replace(/^(network|auth):/, '')}
          action={
            <button type="button" onClick={reintentar} className={bmBtn.primary}>
              <RefreshCw className="h-4 w-4" /> Reintentar conexión
            </button>
          }
        />
      </div>
    );
  }

  // ── LOADING ───────────────────────────────────────────────────────────────

  if (loadingInicial) {
    return (
      <div className="bm-app space-y-4" role="status" aria-label="Inicializando registro de vuelo">
        <div className="bm-skeleton h-20 rounded-[24px]" />
        <div className="bm-skeleton h-64 rounded-[24px]" />
        <p className="flex items-center gap-2 text-sm text-bm-steel">
          <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Inicializando registro de vuelo…
        </p>
      </div>
    );
  }

  // ── RENDER PRINCIPAL ──────────────────────────────────────────────────────

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* CABECERA */}
      <header className={`${surface.card} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5`}>
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red text-white">
            <Plane className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="bm-heading text-lg leading-tight sm:text-xl">Registro de vuelo</h2>
            <p className="truncate text-[13px] text-bm-steel">
              Valkyron OS v7.1 · {instructorNombre || 'Sistema de vuelo'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-bm-canvas px-3 py-1.5 text-xs font-medium">
            <Clock className="h-3.5 w-3.5 text-bm-steel" /> <span className="bm-num">{hoy()}</span>
          </span>
          {esCapitan
            ? <BmBadge tone="dark" icon={<UserRound className="h-3 w-3" />}>Capitán</BmBadge>
            : <BmBadge tone="neutral" icon={<UserRound className="h-3 w-3" />}>Administración</BmBadge>}
          <BmBadge tone="ok" dot>Bitácora activa</BmBadge>
        </div>
      </header>

      {/* [NEW v7.0] Aviso de modo heredado */}
      {v18 === false && (
        <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
          <p className="font-semibold">Modo heredado: la billetera no está conectada</p>
          <p className="mt-0.5">
            Ejecute migracion_vuelos_v18_billetera.sql en Supabase para descontar horas de la billetera al cerrar la bitácora.
          </p>
        </BmNotice>
      )}

      <PanelAsignaciones
        asignaciones={asignaciones}
        seleccionado={form.student_id}
        onSeleccionar={handleSeleccionarAlumno}
        onPosponer={handlePosponer}
        posponiendo={posponiendo}
        instructorNombre={instructorNombre}
      />

      {/* [NEW v7.0] Resultado del último cierre de bitácora */}
      {ultimoRegistro && !form.student_id && (
        <BmNotice tone={ultimoRegistro.cobro_pendiente ? 'warn' : 'ok'} role="status"
          icon={ultimoRegistro.cobro_pendiente ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}>
          <p className="font-semibold">
            Último vuelo · <span className="font-data">{ultimoRegistro.matricula}</span> · <span className="bm-num">{numOr(ultimoRegistro.horas).toFixed(2)}</span> h TAC · <span className="bm-num">{numOr(ultimoRegistro.litros).toFixed(1)}</span> L
            {ultimoRegistro.reserva_id ? ' · reserva completada' : ''}
          </p>
          <p className="mt-0.5">
            {ultimoRegistro.cargo
              ? resumenCargo(ultimoRegistro.cargo)
              : `Cobro pendiente: ${traducirErrorVuelo(ultimoRegistro.cobro_error ?? '')} — Finanzas → Billeteras → Vuelos por cargar`}
          </p>
        </BmNotice>
      )}

      {form.student_id ? (
        <div className="space-y-4 sm:space-y-5">
          {/* HUD ALUMNO */}
          <div className="flex flex-col gap-3 rounded-[24px] bg-bm-ink p-4 text-white sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <Plane className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold uppercase">{form.student_nombre}</p>
                <p className="text-[13px] text-white/60">Cadete en misión activa</p>
                {/* [NEW v7.0] desglose del saldo */}
                {saldoVuelo && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/80">
                    <span>Paquete <span className="bm-num">{Math.max(saldoVuelo.horas_paquete, 0).toFixed(1)}</span> h</span>
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="h-3 w-3" /> <span className="bm-num">{usd(saldoVuelo.saldo_usd)}</span>
                      {saldoVuelo.tarifa_hora ? <> ≈ <span className="bm-num">{saldoVuelo.horas_billetera.toFixed(1)}</span> h a <span className="bm-num">{usd(saldoVuelo.tarifa_hora)}</span>/h</> : ' · sin tarifa'}
                    </span>
                    {saldoVuelo.deuda_usd > 0 && <span className="font-semibold text-[#FF8A8D]">Deuda <span className="bm-num">{usd(saldoVuelo.deuda_usd)}</span></span>}
                  </p>
                )}
              </div>
            </div>
            {studentBalance !== null && (
              <span className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-sm font-semibold sm:self-center ${
                balanceTone === 'ok' ? 'bg-bm-ok text-white' : balanceTone === 'warn' ? 'bg-bm-warn text-white' : balanceTone === 'danger' ? 'bg-bm-red text-white' : 'bg-white/10'
              }`}>
                <span className="bm-num">{balanceLabel}</span>
              </span>
            )}
          </div>

          {/* ALERTA SALDO — [v7.0] con billetera: cálculo en USD a la tarifa real */}
          {preview && (preview.aCxc > 0 || preview.sinTarifa) && (
            <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
              <p className="font-semibold">
                {preview.sinTarifa
                  ? 'Sin tarifa de vuelo activa: el cobro quedará pendiente en Finanzas'
                  : excedeCredito
                    ? 'Saldo insuficiente y límite de crédito excedido: cobro pendiente de autorización'
                    : 'Saldo insuficiente: el excedente pasará a cuentas por cobrar'}
              </p>
              <p className="mt-0.5">
                {preview.sinTarifa
                  ? `${preview.horasBilletera.toFixed(2)} h sin tarifa · configure el Tarifario`
                  : `Billetera ${usd(preview.desdeBilletera)} · A cuentas por cobrar ${usd(preview.aCxc)}`}
              </p>
            </BmNotice>
          )}
          {!preview && studentBalance !== null && studentBalance < stats.horasTac && stats.horasTac > 0 && (
            <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
              <p className="font-semibold">Saldo insuficiente: se generará deuda automática</p>
              <p className="mt-0.5">
                Déficit: {Math.max(0, stats.horasTac - studentBalance).toFixed(2)} h · ${(Math.max(0, stats.horasTac - studentBalance) * form.precioHoraCostoTac).toFixed(2)}
              </p>
            </BmNotice>
          )}

          {/* AERONAVE · FECHA · SEDE */}
          <section className={`${surface.card} space-y-5 p-4 sm:p-5`} aria-label="Datos del vuelo">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="mro_aeronave" className={bmLabel}>Unidad de flota</label>
                <BmSelect
                  id="mro_aeronave"
                  value={form.aircraft_id}
                  onChange={e => {
                    const sel = fleet.find(a => a.id === e.target.value);
                    setForm(prev => ({ ...prev, aircraft_id: e.target.value, matricula: sel?.matricula ?? '' }));
                  }}
                >
                  {fleet.map(u => (
                    <option key={u.id} value={u.id}>{u.matricula} — {u.modelo}</option>
                  ))}
                </BmSelect>
                {aircraftFuelStock !== null && (
                  <p className={`flex items-center gap-1.5 text-[13px] ${combustibleBajo ? 'font-semibold text-bm-warn' : 'text-bm-steel'}`}>
                    <Fuel className="h-3.5 w-3.5" />
                    <span className="bm-num">{aircraftFuelStock.toFixed(1)}</span> L disponibles
                    {combustibleBajo && stats.litersToBurn > 0 && <AlertTriangle className="h-3.5 w-3.5" />}
                  </p>
                )}
              </div>

              <InputGroup id="mro_fecha" label="Fecha de registro" type="date" value={form.fecha}
                onChange={(v: string) => setForm(prev => ({ ...prev, fecha: v }))} />

              <div className="space-y-2">
                <span className={`${bmLabel} flex items-center gap-1.5`} id="mro_sede_label">
                  <MapPin className="h-4 w-4 text-bm-steel" /> Sede del vuelo
                </span>
                <div role="group" aria-labelledby="mro_sede_label" className="flex h-12 gap-1 rounded-xl border border-bm-field bg-white p-1">
                  {SEDES.map(sede => (
                    <button key={sede} type="button"
                      aria-pressed={form.sede_vuelo === sede}
                      onClick={() => setForm(prev => ({ ...prev, sede_vuelo: sede }))}
                      className={`flex-1 rounded-lg px-2 text-sm capitalize transition-colors ${
                        form.sede_vuelo === sede
                          ? 'bg-bm-ink font-semibold text-white'
                          : 'font-medium text-bm-steel hover:text-bm-ink'
                      }`}>
                      {sede.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RUTA + INSTRUCTOR */}
            <div className="grid grid-cols-1 gap-4 border-t border-bm-line pt-5 md:grid-cols-2">
              <RutaSelector rutas={rutas} selected={rutaSeleccionada} onSelect={setRutaSeleccionada}
                saldo={studentBalance ?? 0} deltaTac={stats.horasTac} />
              <InputGroup id="mro_instructor" label="Instructor al mando" value={form.instructor}
                onChange={(v: string) => setForm(prev => ({ ...prev, instructor: v }))} />
            </div>
          </section>

          {/* TACÓMETRO */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {([
              { id: 'mro_tac_inicial', label: 'TAC inicial', key: 'tacInicial' as const, evKey: 'inicial' as const },
              { id: 'mro_tac_final',   label: 'TAC final',   key: 'tacFinal'   as const, evKey: 'final'   as const },
            ] as const).map(({ id, label, key, evKey }) => (
              <div key={id} className={`${surface.card} space-y-4 p-4 sm:p-5`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-bm-red" /> {label}</span>
                  <Activity className="h-4 w-4 text-bm-hint" aria-hidden="true" />
                </div>
                <InputGroup id={id} label={`Lectura ${label}`} type="number" value={form[key]} big
                  onChange={(v: number) => setForm(prev => ({ ...prev, [key]: Number(v) }))} />
                <EvidenceUpload id={`file_${evKey}`} label={`Foto del ${label}`}
                  file={evidence[evKey]} onSelect={f => setEvidence(prev => ({ ...prev, [evKey]: f }))} />
              </div>
            ))}
          </div>

          {/* RESUMEN DELTA TAC vs RUTA */}
          {stats.horasTac > 0 && rutaSeleccionada && (() => {
            const ok = Math.abs(stats.horasTac - rutaSeleccionada.horas_tac) / rutaSeleccionada.horas_tac <= 0.20;
            return (
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Tile label="Delta TAC real" value={stats.horasTac.toFixed(2)} unit="h" note="Fuente legal MRO" />
                <Tile label="Ruta ref." value={String(rutaSeleccionada.horas_tac)} unit="h" note={rutaSeleccionada.destino} />
                <Tile label="Diferencia" value={Math.abs(stats.horasTac - rutaSeleccionada.horas_tac).toFixed(2)} unit="h"
                  note={`${(Math.abs(stats.horasTac - rutaSeleccionada.horas_tac) / rutaSeleccionada.horas_tac * 100).toFixed(0)} % de variación`}
                  tone={ok ? 'ok' : 'warn'} />
              </div>
            );
          })()}

          {/* BURN PREVIEW */}
          {stats.horasTac > 0 && (
            <div className={`flex items-center gap-4 rounded-2xl border p-4 ${combustibleBajo ? 'border-bm-warn/30 bg-bm-warn-tint' : 'border-bm-line bg-white'}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${combustibleBajo ? 'bg-bm-warn text-white' : 'bg-bm-canvas text-bm-steel'}`}>
                <Fuel className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] text-bm-steel">Consumo estimado</p>
                <p className={`text-base font-semibold ${combustibleBajo ? 'text-bm-warn' : ''}`}>
                  <span className="bm-num">{stats.litersToBurn.toFixed(1)}</span> L
                  <span className="ml-2 text-xs font-normal text-bm-steel">(<span className="bm-num">{stats.horasTac.toFixed(2)}</span> h × <span className="bm-num">{burnRate}</span> L/h)</span>
                </p>
              </div>
            </div>
          )}

          {/* RESUMEN CAPITÁN */}
          {esCapitan && stats.horasTac > 0 && (
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 sm:gap-3">
              <Tile label="Horas TAC" value={stats.horasTac.toFixed(2)} unit="h" note="Registradas" big />
              {(() => {
                const saldoPost = Math.max(0, (studentBalance ?? 0) - stats.horasTac);
                const positivo  = saldoPost > 0;
                return (
                  <Tile label="Saldo post-vuelo" value={saldoPost.toFixed(1)} unit="h"
                    note={positivo ? 'Disponibles' : 'Sin saldo'} tone={positivo ? 'ok' : 'danger'} big />
                );
              })()}
              <Tile label="Tu pago" value={`$${(stats.horasTac * RATE_HORA_CAPITAN).toFixed(2)}`}
                note={`${stats.horasTac.toFixed(2)} h × $${RATE_HORA_CAPITAN}/h`} tone="ok" big icon={<DollarSign className="h-3.5 w-3.5" />} />
            </div>
          )}

          {/* FINANCIERA ADMIN */}
          {!esCapitan && (
            <section className={`${surface.card} space-y-4 p-4 sm:p-5`} aria-label="Producción de la bitácora">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <InputGroup id="mro_horas_facturadas" label={`Horas facturadas (tarifa ${usd(tarifaHora)}/h)`}
                  type="number" value={form.horasCobrada}
                  onChange={(v: number) => setForm(prev => ({ ...prev, horasCobrada: Number(v) }))} />
                <InputGroup id="mro_monto_cobrado" label="Monto total a cobrar ($)"
                  type="number" value={form.precioCobrado}
                  onChange={(v: number) => setForm(prev => ({ ...prev, precioCobrado: Number(v) }))} />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-5">
                <StatBox label="Horas TAC"   value={stats.horasTac.toFixed(2)} />
                <StatBox label="Instructor"  value={`-$${stats.pagoCapitan.toFixed(2)}`}  color="text-bm-red" />
                <StatBox label="Combustible" value={`-$${stats.pagoGasolina.toFixed(1)}`} color="text-bm-red" />
                <StatBox label="Cargo MRO"   value={`-$${stats.costoOperacional}`}         color="text-bm-red-deep" />
                <div className="col-span-2 flex flex-col justify-center rounded-2xl bg-bm-ink p-4 text-white md:col-span-1">
                  <span className="text-xs text-white/70">Producción neta</span>
                  <span className="bm-figure mt-1 text-2xl leading-none">${stats.produccionNeta.toFixed(2)}</span>
                </div>
              </div>
              {/* [NEW v7.0] Los campos de arriba alimentan la producción de la bitácora; el cobro al alumno sale del Tarifario */}
              {v18 !== false && (
                <p className="text-[13px] text-bm-steel">
                  Producción de la bitácora. El cobro al alumno se calcula con el Tarifario (horas TAC × tarifa), ver "Cargo al alumno".
                </p>
              )}
            </section>
          )}

          {/* [NEW v7.0] CARGO AL ALUMNO — vista previa (el servidor aplica la misma regla al cerrar) */}
          {preview && (
            <section className={`${surface.card} space-y-4 p-4 sm:p-5`} aria-labelledby="fr-cargo">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="fr-cargo" className="flex items-center gap-2 text-sm font-semibold">
                  <Receipt className="h-4 w-4 text-bm-red" /> Cargo al alumno
                </h3>
                <p className="text-xs text-bm-steel">
                  {saldoVuelo?.servicio ?? 'Sin tarifa'}{preview.tarifa ? ` · ${usd(preview.tarifa)}/h` : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
                <StatBox label="Paquete anterior" value={`${preview.horasPaquete.toFixed(2)} h`} color="text-[#2F5BB7]" />
                <StatBox label="A billetera (h)"  value={`${preview.horasBilletera.toFixed(2)} h`} />
                <StatBox label="Desde billetera"  value={preview.sinTarifa ? 'Pendiente' : usd(preview.desdeBilletera)} color="text-bm-ok" />
                <StatBox label="A cuentas por cobrar" value={preview.sinTarifa ? 'Pendiente' : usd(preview.aCxc)}
                  color={preview.aCxc > 0 || preview.sinTarifa ? 'text-bm-red' : 'text-bm-steel'} />
              </div>
              <p className="text-[13px] text-bm-steel">
                Saldo de billetera después del vuelo: <span className="bm-num">{usd(Math.max((saldoVuelo?.saldo_usd ?? 0) - preview.desdeBilletera, 0))}</span>
                {preview.horasPaquete > 0 ? ` · paquete restante ${Math.max((saldoVuelo?.horas_paquete ?? 0) - preview.horasPaquete, 0).toFixed(2)} h` : ''}
              </p>
            </section>
          )}

          {/* OBSERVACIÓN */}
          <div className="space-y-2">
            <label htmlFor="mro_observacion" className={bmLabel}>Observaciones</label>
            <textarea id="mro_observacion" rows={2}
              className={`${bmTextarea} uppercase placeholder:normal-case`}
              placeholder="Novedades del vuelo"
              value={form.observacion} onChange={e => setForm(prev => ({ ...prev, observacion: e.target.value }))} />
          </div>

          {/* CTA */}
          <div className="sticky bottom-0 z-20 -mx-4 border-t border-bm-line bg-bm-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <button type="button" onClick={handleProcessFlight} disabled={isProcessing}
              className={`${bmBtn.primary} h-14 w-full text-base`}>
              {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
              {isProcessing ? 'Sincronizando bitácora…' : 'Cerrar bitácora y sincronizar MRO'}
            </button>
          </div>
        </div>
      ) : (
        <div className={`${surface.card} border-dashed`}>
          <BmEmpty
            icon={<Plane className="h-5 w-5" />}
            title="Seleccione un cadete del panel de misiones"
            text="Solo puede operar con alumnos asignados al día de hoy."
          />
        </div>
      )}

      {confirmDialog}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTES ATÓMICOS
// ─────────────────────────────────────────────────────────────────────────────

const InputGroup = ({ id, label, value, onChange, type = 'text', big = false }: any) => (
  <div className="flex w-full flex-col space-y-2 text-left">
    <label htmlFor={id} className={bmLabel}>{label}</label>
    <input id={id} type={type} step="0.01" autoComplete="off"
      inputMode={type === 'number' ? 'decimal' : undefined}
      className={`${bmInput} ${type === 'number' ? 'bm-num' : ''} ${type === 'text' ? 'uppercase' : ''} ${big ? 'h-14 text-2xl font-semibold' : ''}`}
      value={value} onChange={e => onChange(e.target.value)} />
  </div>
);

const EvidenceUpload = ({ id, label, file, onSelect }: {
  id: string; label: string; file: File | null; onSelect: (f: File) => void;
}) => (
  <div className={`relative overflow-hidden rounded-xl border transition-colors ${
    file
      ? 'border-bm-ok/30 bg-bm-ok-tint'
      : 'border-dashed border-bm-field bg-white hover:border-bm-red/50 hover:bg-bm-red-tint/40'
  }`}>
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-center gap-3">
        {file ? <FileCheck className="h-5 w-5 shrink-0 text-bm-ok" /> : <Camera className="h-5 w-5 shrink-0 text-bm-steel" />}
        <span className={`truncate text-sm ${file ? 'font-semibold text-bm-ok' : 'text-bm-steel'}`}>
          {file ? `Evidencia capturada · ${file.name}` : label}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-bm-red">{file ? 'Cambiar' : 'Tomar foto'}</span>
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={e => e.target.files && onSelect(e.target.files[0])} />
    </label>
  </div>
);

const StatBox = ({ label, value, color = 'text-bm-ink' }: any) => (
  <div className="flex flex-col items-start justify-center rounded-2xl border border-bm-line bg-white p-3.5 text-left sm:p-4">
    <p className="mb-1 text-xs text-bm-steel">{label}</p>
    <p className={`bm-num text-sm font-semibold ${color}`}>{value}</p>
  </div>
);

// [v7.1] Indicador numérico B&M
const Tile = ({ label, value, unit, note, tone = 'neutral', big = false, icon }: {
  label: string; value: string; unit?: string; note?: string; tone?: 'neutral' | 'ok' | 'warn' | 'danger'; big?: boolean; icon?: React.ReactNode;
}) => {
  const cls = {
    neutral: 'border-bm-line bg-white text-bm-ink',
    ok:      'border-bm-ok/25 bg-bm-ok-tint text-bm-ok',
    warn:    'border-bm-warn/25 bg-bm-warn-tint text-bm-warn',
    danger:  'border-bm-red/25 bg-bm-red-tint text-bm-red',
  }[tone];
  return (
    <div className={`min-w-0 rounded-2xl border p-3 sm:p-4 ${cls}`}>
      <p className="flex items-center gap-1 truncate text-xs text-bm-steel">{icon}{label}</p>
      <p className={`bm-figure mt-1.5 leading-none ${big ? 'text-[28px] sm:text-[32px]' : 'text-xl sm:text-2xl'}`}>
        {value}{unit && <span className="ml-0.5 text-sm font-medium opacity-60">{unit}</span>}
      </p>
      {note && <p className="mt-1.5 truncate text-[11px] text-bm-steel">{note}</p>}
    </div>
  );
};

// [v7.1] Fila clave/valor para las confirmaciones
const Fila = ({ k, v, fuerte = false }: { k: string; v: string; fuerte?: boolean }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-bm-steel">{k}</dt>
    <dd className={`bm-num text-right ${fuerte ? 'font-semibold text-bm-red-deep' : ''}`}>{v}</dd>
  </div>
);

export default FlightRegister;

// src/Types/flights.ts
// Evolución de estructura quirúrgica - Valkyron Group (Grado Militar)
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v18 (registro de vuelo ↔ billetera del alumno):
//   [NEW] SaldoVueloAlumno       — respuesta de fn_vuelo_saldos (paquete + billetera en horas)
//   [NEW] CargoVuelo             — cobro automático aplicado al registrar el vuelo
//   [NEW] RegistroVueloInput     — payload de fn_vuelo_registrar (una sola transacción)
//   [NEW] RegistroVueloResultado — respuesta de fn_vuelo_registrar
//   [NEW] PreviewCargoVuelo      — estimación en pantalla antes de cerrar la bitácora
//   PRESERVADO: UserRole, FlightRecordYV188E, InstructorPaymentSummary (sin cambios de forma)
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = 'CEO' | 'ADMIN' | 'PILOTO';

export interface FlightRecordYV188E {
  id?: string; // Identificador único para persistencia en Supabase
  fecha: string;
  ruta: string;
  tacInicial: number;
  tacFinal: number;
  horasTac: number; // Delta: ΔT = TacFinal - TacInicial
  totalHorasCobrada: number;
  alumno: string;
  instructor: string;

  // Constantes de Operación (Valores base)
  precioHoraCostoTac: number; // Por defecto: 100
  precioCobrado: number;      // Por defecto: 160 (histórico). [v18] El cargo real al alumno sale del Tarifario (servicios_catalogo)

  // Algoritmo de Liquidación
  pagoCapitan: number;        // Cálculo: totalHorasCobrada * 15
  pagoGasolina: number;       // Cálculo: horasTac * 75.90
  costoOperacionalAvion: number; // % sobre producción o valor fijo

  // Resultado de Inteligencia Financiera
  totalProduccionNeta: number; // Σ Ingresos - Σ Gastos Operativos
  observacion?: string;

  // Metadata de Auditoría
  createdAt?: string;
  userId?: string; // Relación con el instructor/piloto
}

// Interfaz para el Modal de Liquidación (Instrucción)
export interface InstructorPaymentSummary {
  instructorName: string;
  totalHorasInstruccion: number;
  montoAcumuladoUSD: number; // totalHoras * 15
  vuelosRelacionados: FlightRecordYV188E[];
}

// ═════════════════════════════════════════════════════════════════════════════
// [NEW v18] REGISTRO DE VUELO ↔ BILLETERA (migracion_vuelos_v18_billetera.sql)
// Regla de cobro al cerrar la bitácora (servidor, una sola transacción):
//   ΔT = TAC final − TAC inicial
//   h_paquete  = min(max(horas de paquete anterior, 0), ΔT)      → consumo PAQUETE_LEGACY ($0)
//   h_billetera = ΔT − h_paquete
//   monto      = h_billetera × tarifa (Tarifario: aeronave → sede → general)
//   billetera  = min(saldo_usd, monto) ;  CxC = monto − billetera
// ═════════════════════════════════════════════════════════════════════════════

/** Modo con el que quedó cobrado el vuelo (wallet_consumos.modo). */
export type ModoCargoVuelo = 'BILLETERA' | 'PAQUETE_LEGACY' | 'CORTESIA';

/** Fila de fn_vuelo_saldos(p_students, p_matricula, p_sede). */
export interface SaldoVueloAlumno {
  student_id: string;
  /** Horas de paquete del régimen anterior aún disponibles (puede ser negativo si voló de más sin deuda) */
  horas_paquete: number;
  saldo_usd: number;
  deuda_usd: number;
  /** Tarifa por hora que se aplicará en la aeronave/sede consultada; null si no hay tarifa activa */
  tarifa_hora: number | null;
  servicio: string | null;
  /** saldo_usd ÷ tarifa_hora, redondeado hacia abajo a centésimas */
  horas_billetera: number;
  /** max(horas_paquete, 0) + horas_billetera */
  horas_disponibles: number;
  credito_maximo_usd: number | null;
  credito_disponible_usd: number | null;
}

/** Cobro aplicado por fn_vuelo_registrar (respuesta de fn_wallet_consumir_interno + desglose). */
export interface CargoVuelo {
  modo: ModoCargoVuelo;
  consumo_id: string;
  monto_total: number;
  desde_billetera: number;
  a_cxc: number;
  cxc_id: string | null;
  saldo: number;
  referencia: string;
  horas_paquete: number;
  horas_billetera: number;
  tarifa: number | null;
  servicio: string | null;
}

/** Payload de fn_vuelo_registrar. Las horas se recalculan en el servidor; el precio sale del Tarifario. */
export interface RegistroVueloInput {
  student_id: string;
  aircraft_id?: string | null;
  matricula?: string | null;
  fecha?: string;
  sede_vuelo?: string | null;
  tac_inicial: number;
  tac_final: number;
  ruta?: string | null;
  ruta_id?: string | null;
  destino?: string | null;
  tipo_mision?: string | null;
  alumno?: string | null;
  instructor?: string | null;
  /** instructores.id del capitán (administración registrando por un capitán) */
  instructor_id?: string | null;
  horas_cobradas?: number;
  produccion_neta?: number;
  pago_capitan?: number;
  pago_gasolina?: number;
  costo_operacional?: number;
  url_foto_tac_inicial?: string | null;
  url_foto_tac_final?: string | null;
  observacion?: string | null;
  asignacion_id?: string | null;
  reserva_id?: string | null;
  /** Reintento consciente cuando el servidor responde TAC_SOLAPADO */
  confirmar_solape?: boolean;
  /** Solo administración: cobra aunque supere credito_maximo_usd */
  autorizar_sobre_limite?: boolean;
}

/** Respuesta de fn_vuelo_registrar. */
export interface RegistroVueloResultado {
  vuelo_id: string;
  fecha: string;
  horas: number;
  litros: number;
  matricula: string;
  capitan_id: string | null;
  asignacion_id: string | null;
  reserva_id: string | null;
  cargo: CargoVuelo | null;
  /** true: el vuelo quedó registrado sin cobro (Finanzas → Billeteras → Vuelos por cargar) */
  cobro_pendiente: boolean;
  cobro_error: string | null;
  avisos: string[];
}

/** Estimación del cobro que se muestra antes de cerrar la bitácora (misma regla que el servidor). */
export interface PreviewCargoVuelo {
  horasPaquete: number;
  horasBilletera: number;
  tarifa: number | null;
  monto: number;
  desdeBilletera: number;
  aCxc: number;
  sinTarifa: boolean;
}
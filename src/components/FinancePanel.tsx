// VALKYRON FINANCIAL INTELLIGENCE CENTER v16.5
// CHANGELOG v16.5 vs v16.4:
//   [NEW] Trazabilidad absoluta de QUIÉN PAGA: todo ingreso (cobro CxC, horas pagadas, ingreso directo, ingreso
//         real en caja, préstamo recibido) exige pagador (tipo, nombre, cédula/RIF, contacto, alumno vinculado),
//         referencia del pago (Zelle / TxID USDT / ref. bancaria; opcional solo en efectivo), cuenta de origen y
//         quién lo recibió en administración. Se graba en la MISMA transacción del asiento (fn_registrar_asiento_v2).
//   [NEW] Anti-duplicado: la BD rechaza una referencia Zelle / TxID / ref. bancaria ya cobrada.
//   [NEW] "Pagó / Recibió" visible en Libro Mayor, Bóvedas y movimientos de caja; búsqueda por pagador,
//         cédula o referencia en el Libro Mayor; columnas de pagador en los CSV.
//   [NEW] Anulación vía fn_anular_asiento_v2: el pagador queda marcado como anulado (histórico inmutable).
//   [CHG] Ingresos sin pagador ya no tienen ruta legacy: sin la migración v16.5 se bloquean con aviso.
// REQUISITO ADICIONAL: migracion_finance_v16_5_pagadores.sql
// CHANGELOG v16.4 vs v16.3:
//   [NEW] Mapa de 7 cajas Águilas: EFECTIVO ADMIN (stand-by), EFECTIVO CEO (custodia), CAJA BS, ROBERTO,
//         BECQUER (custodia de terceros), MATURÍN y BARQUISIMETO (sedes). Todas conectadas a las 4 bóvedas
//         por el motor de asientos: cada evento escribe bóveda + caja UNA sola vez (sin montos repetidos).
//   [NEW] Efectivo dual: tipos EFECTIVO_ADM / EFECTIVO_CEO como cajas propias. "Entregar a CEO" = transferencia
//         de custodia ADM → CEO (la bóveda CASH no cambia). Modelo legacy de una caja con subcajas preservado.
//   [NEW] Cobros en efectivo entran por defecto a EFECTIVO ADMIN (stand-by hasta la entrega a los CEO).
//   [NEW] Cajas ordenadas por función: Efectivo ADM → Efectivo CEO → BS → Sedes → Custodias.
// CHANGELOG v16.3 vs v16.2:
//   [NEW] Diagnóstico RLS en vivo: si cajas_chicas devuelve 0 filas con sesión activa, el panel muestra
//         el usuario autenticado (uid/email) y el resultado de rpc('es_staff_finanzas') → identifica si
//         el bloqueo es por usuario, por rol o porque la función/política no existe.
// CHANGELOG v16.2 vs v16.1:
//   [FIX] Sesión expirada (Invalid Refresh Token → 400 en /auth/v1/token) dejaba al panel como anónimo:
//         RLS devolvía [] en cajas/movimientos sin ningún aviso. Ahora se detecta la sesión antes de
//         consultar, se muestra banner con acción "Reiniciar sesión" y se recarga al volver a autenticar.
//   [FIX] Errores de consulta (tabla/columna inexistente, permisos) ya no se tragan en silencio:
//         banner con la tabla y el mensaje de PostgREST.
//   [NEW] Estado vacío explícito en Cajas cuando no hay cajas visibles.
// CHANGELOG v16.1 vs v16.0:
//   [FIX] TS2367 (×2): LedgerTx omite `category` de FinanceTransaction y lo redefine como string
//         (la intersección estrechaba a la unión del módulo MRO; en BD es texto libre).
//   [FIX] downloadCSV libera el ObjectURL (revokeObjectURL) → sin fuga de memoria por export.
//   [FIX] setGlobalFinance por defecto es una constante estable (NOOP) → el efecto ya no corre en cada render.
//   [FIX] confirmarPagoReposicion valida el error al marcar la CxP como PAGADO antes de mover caja.
//   [OPT] Componentes UI reutilizables: ModalShell, ModalHeader, ModalActions, MonedaPicker, SubcajaToggle,
//         AmountInput, Badge, Lbl, EmptyState. Fila de Ledger unificada (Diario + Bóvedas).
//   [OPT] Helpers de caja (cajaById, cajaEsEfectivo, ajustarCaja, saldoCustodia) y refresh() único post-escritura.
//   PRESERVADO v16.0: motor de asientos (fn_registrar_asiento / fn_anular_asiento), cobros/pagos con abonos
//   parciales y horas proporcionales, préstamos Becquer/Roberto como financiamiento con FIFO, cajas de custodia
//   de terceros, clase OPERATIVO/UBICACIÓN, FX Desk v15 (RPC + fallback compensado), conciliación, cierre,
//   clave Director, Caja Efectivo ADM/CEO, transferencias, reposiciones sin egreso, exports, realtime debounce.
//
// REQUISITO: migracion_finance_v15.sql y luego migracion_finance_v16.sql en Supabase antes de desplegar.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, X, Loader2,
  Wallet, ShieldCheck, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Activity, Trash2, Download, Coins, Banknote,
  AlertTriangle, RefreshCw, ReceiptText, Plane, Pencil, KeyRound,
  ArrowLeftRight, Repeat, TrendingUp, UserCheck, HandCoins, Scale, Ban,
  Users, Link2,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type PaymentMethod   = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
/** FINANCING_IN / FINANCING_OUT: préstamos (mueven caja, no son ingreso/egreso operativo) */
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE' | 'FX_EXCHANGE' | 'FINANCING_IN' | 'FINANCING_OUT';
export type TabType         = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING';
export type SubcajaEfectivo = 'ADM' | 'CEO';
export type Prestamista     = 'BECQUER' | 'ROBERTO';
export type FxLeg           = 'IN' | 'OUT';
export type TipoCaja        = 'OPERATIVA' | 'BANCO' | 'EFECTIVO' | 'EFECTIVO_ADM' | 'EFECTIVO_CEO' | 'CUSTODIA_TERCERO';   // [CHG v16.4] + efectivo dual
/** Eventos contables que el motor sabe asentar */
export type EventoContable  =
  | 'INGRESO_DIRECTO' | 'GASTO_DIRECTO' | 'NOMINA'
  | 'COBRO_CXC' | 'HORAS_PAGADAS' | 'PAGO_CXP'
  | 'PRESTAMO_RECIBIDO' | 'PRESTAMO_DEVOLUCION';
type ClaseMovCaja = 'OPERATIVO' | 'UBICACION';
type FormTipo     = 'CXC' | 'HORAS_PAGADAS' | 'CXP';

/**
 * Transacción de Ledger extendida con vínculo FX [v15] y asiento [v16].
 * [FIX v16.1] `category` se OMITE de FinanceTransaction y se redefine como string libre:
 * `A & { category?: string }` estrechaba a la unión 'Fuel' | ... | 'Other' (TS2367).
 */
type LedgerTx = Omit<FinanceTransaction, 'category'> & {
  fx_id?: string | null;
  fx_leg?: FxLeg | null;
  asiento_id?: string | null;
  category?: string;
};

interface CajaChica {
  id: string; nombre: string;
  tipo_caja?: TipoCaja | null;
  monedas_permitidas?: string[] | null;
  responsable?: string | null;
  prestamista?: Prestamista | null;
}
interface MovimientoCaja {
  id: string; caja_id: string; tipo: 'ENTRADA' | 'SALIDA';
  moneda: PaymentMethod; monto: number;
  concepto: string; referencia: string; fecha: string; registrado_por: string;
  transfer_id?: string | null;
  transfer_role?: 'SALIDA' | 'ENTRADA' | null;
  transfer_peer_id?: string | null;
  subcaja?: SubcajaEfectivo | null;
  prestamista?: Prestamista | null;
  es_prestamo?: boolean;
  fx_id?: string | null;
  fx_role?: 'SALIDA' | 'ENTRADA' | null;
  asiento_id?: string | null;
}
interface FXRecord {
  id: string; fecha: string;
  moneda_origen: PaymentMethod; moneda_destino: PaymentMethod;
  monto_origen: number; monto_destino: number; tasa: number;
  concepto: string; registrado_por: string;
  caja_id?: string | null; caja_origen_id?: string | null; caja_destino_id?: string | null;
  subcaja_origen?: SubcajaEfectivo | null; subcaja_destino?: SubcajaEfectivo | null;
  referencia?: string | null;
}
interface FxPayload {
  fxId: string; referencia: string; fechaISO: string;
  monedaOrigen: PaymentMethod; monedaDestino: PaymentMethod;
  montoOrigen: number; montoDestino: number; tasa: number; concepto: string;
  cajaOrigenId: string | null; cajaDestinoId: string | null;
  cajaOrigenNombre: string; cajaDestinoNombre: string;
  subcajaOrigen: SubcajaEfectivo | null; subcajaDestino: SubcajaEfectivo | null;
}
interface CuentaGeneral {
  id: string; tipo: 'CXC' | 'CXP'; entidad_nombre: string; entidad_tipo: string;
  proveedor_id?: string; moneda: PaymentMethod;
  monto_total: number; monto_pendiente: number; concepto: string;
  fecha_emision: string; fecha_vencimiento?: string;
  estatus: 'PENDIENTE' | 'PAGADO' | 'PARCIAL'; notas?: string;
  transfer_id?: string | null;
  categoria_interna?: 'REPOSICION_CAJA' | null;
  prestamista?: Prestamista | null;
  asiento_origen_id?: string | null;
}
interface CuentaPorCobrar {
  id: string; student_id: string; alumno_id: string;
  nombre_alumno: string; student_serial: string;
  monto_total: number; monto_pagado: number; monto_pendiente: number;
  horas_prometidas: number; horas_compradas: number;
  concepto: string; fecha_emision: string; moneda: string;
  estatus: 'PENDIENTE' | 'COBRADO' | 'PARCIAL';
  asiento_origen_id?: string | null;
}
interface AlumnoCxC { student_id: string; nombre: string; serial: string; sede: string; }
type FinanceTotals = { CASH: number; ZELLE: number; USDT: number; BS: number };
interface FinancePanelProps {
  vendors: Vendor[]; inventory: any[]; userRole?: string;
  setGlobalFinance?: React.Dispatch<React.SetStateAction<FinanceTotals>>;
}
interface TransferChain {
  transferId: string;
  salida: MovimientoCaja | null; entrada: MovimientoCaja | null; reposicion: CuentaGeneral | null;
  cajaOrigenNombre: string; cajaDestinoNombre: string;
}
/** Fila del subledger de abonos (CxC/CxP) */
interface AbonoCuenta {
  id: string; asiento_id: string; cuenta_tipo: 'CXC' | 'CXP'; cuenta_id: string;
  monto: number; moneda_cuenta: string | null; monto_origen: number | null;
  moneda_origen: string | null; tasa: number | null; horas: number; created_at: string;
}
/** Abono que el motor aplicará a una cuenta (monto en moneda de la cuenta) */
interface AsientoAbonoInput {
  cuenta_tipo: 'CXC' | 'CXP'; cuenta_id: string;
  monto: number; moneda_cuenta: PaymentMethod;
  monto_origen: number; moneda_origen: PaymentMethod; tasa: number | null;
}
/** [NEW v16.5] Quién paga */
export type PagadorTipo = 'ALUMNO' | 'REPRESENTANTE' | 'TERCERO' | 'EMPRESA' | 'PRESTAMISTA';
/** [NEW v16.5] Datos del pagador capturados en el formulario */
interface PagoForm {
  pagador_tipo: PagadorTipo; pagador_nombre: string; pagador_documento: string; pagador_contacto: string;
  alumno_id: string; referencia_pago: string; cuenta_origen: string; recibido_por: string;
}
/** [NEW v16.5] Fila de pagos_trazabilidad (inmutable, 1 por asiento de ingreso) */
interface PagoTraza {
  id: string; asiento_id: string; direccion: 'IN' | 'OUT'; evento: string | null;
  pagador_tipo: PagadorTipo; pagador_nombre: string; pagador_documento: string | null; pagador_contacto: string | null;
  alumno_id: string | null; metodo: PaymentMethod; monto: number; referencia_pago: string | null;
  cuenta_origen: string | null; recibido_por: string; caja_id: string | null; fecha: string;
  registrado_por_email: string | null; anulado: boolean;
}

/** Payload JSON de fn_registrar_asiento (v2 añade `pago`) */
interface AsientoPayload {
  id: string; evento: EventoContable; fecha: string; referencia: string;
  concepto: string; registrado_por: string; meta: Record<string, unknown>;
  ledger: Record<string, unknown>[]; caja: Record<string, unknown>[];
  abonos: (AsientoAbonoInput & { id: string })[];
  nuevas_cxc: Record<string, unknown>[]; nuevas_cxp: Record<string, unknown>[];
  pago?: Record<string, unknown> | null;   // [NEW v16.5]
}
/** Flujo simple: 1 pata de bóveda + 0/1 pata de caja + abonos */
interface FlujoSpec {
  evento: EventoContable; dir: 'IN' | 'OUT'; ledgerType: TransactionType | null;
  moneda: PaymentMethod; monto: number; fechaISO: string; concepto: string;
  entityName: string; entityId?: string | null; category: string;
  cajaId: string | null; subcaja: SubcajaEfectivo | null; registradoPor: string;
  referenciaExterna?: string; esPrestamo?: boolean; prestamista?: Prestamista | null;
  abonos?: AsientoAbonoInput[]; nuevasCxc?: Record<string, unknown>[]; nuevasCxp?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
  pago?: PagoForm | null;   // [NEW v16.5] obligatorio en ingresos
}

// ─── CONFIG DE CAJAS ──────────────────────────────────────────────────────────
// BD (tipo_caja / monedas_permitidas / prestamista) tiene prioridad; el mapa por nombre es fallback legacy.

/**
 * esCajaEfectivo → modelo legacy: UNA caja con subcajas ADM/CEO dentro.
 * efectivoRol    → [NEW v16.4] modelo dual: la caja ES la custodia ADM (stand-by) o CEO.
 */
interface CajaConf { monedasPermitidas: PaymentMethod[]; esCajaEfectivo: boolean; tipo: TipoCaja; prestamista?: Prestamista; efectivoRol?: SubcajaEfectivo; }

const ALL_METHODS: PaymentMethod[] = ['USDT', 'ZELLE', 'CASH', 'BS'];
const PRESTAMISTAS: Prestamista[]  = ['BECQUER', 'ROBERTO'];

/** Fallback por nombre (la BD manda). [CHG v16.4] claves específicas primero: el orden de inserción decide. */
const CAJA_CONFIG: Record<string, CajaConf> = {
  'efectivo admin': { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_ADM', efectivoRol: 'ADM' },
  'efectivo adm':   { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_ADM', efectivoRol: 'ADM' },
  'efectivo ceo':   { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_CEO', efectivoRol: 'CEO' },
  'caja bs':        { monedasPermitidas: ['BS'],   esCajaEfectivo: false, tipo: 'BANCO' },
  bancamiga:        { monedasPermitidas: ['BS'],   esCajaEfectivo: false, tipo: 'BANCO' },
  efectivo:         { monedasPermitidas: ['CASH'], esCajaEfectivo: true,  tipo: 'EFECTIVO' },   // legacy: 1 caja con subcajas
  becquer:          { monedasPermitidas: ALL_METHODS, esCajaEfectivo: false, tipo: 'CUSTODIA_TERCERO', prestamista: 'BECQUER' },
  roberto:          { monedasPermitidas: ALL_METHODS, esCajaEfectivo: false, tipo: 'CUSTODIA_TERCERO', prestamista: 'ROBERTO' },
};

/** [NEW v16.4] Orden visual de las cajas por función */
const ORDEN_TIPO_CAJA: Record<TipoCaja, number> = {
  EFECTIVO_ADM: 0, EFECTIVO_CEO: 1, EFECTIVO: 2, BANCO: 3, OPERATIVA: 4, CUSTODIA_TERCERO: 5,
};
const CAJA_DEFAULT: CajaConf = { monedasPermitidas: ALL_METHODS, esCajaEfectivo: false, tipo: 'OPERATIVA' };

const normalizePaymentMethod = (value: unknown): PaymentMethod => {
  const v = String(value ?? '').toUpperCase().trim();
  return v === 'USD' ? 'USDT' : (ALL_METHODS as string[]).includes(v) ? v as PaymentMethod : 'USDT';
};
const parsePrestamista = (v: unknown): Prestamista | null => (v === 'BECQUER' || v === 'ROBERTO' ? v : null);

/** Config de una caja: acepta el objeto (usa columnas BD) o solo el nombre (fallback legacy). */
const getCajaConfig = (ref: string | CajaChica | null | undefined): CajaConf => {
  const key  = (typeof ref === 'string' ? ref : ref?.nombre ?? '').toLowerCase();
  const base = Object.entries(CAJA_CONFIG).find(([k]) => key.includes(k))?.[1] ?? CAJA_DEFAULT;
  if (!ref || typeof ref === 'string') return base;
  const dbMonedas = Array.from(new Set((ref.monedas_permitidas ?? [])
    .map(m => String(m).toUpperCase().trim())
    .filter(m => m === 'USD' || (ALL_METHODS as string[]).includes(m))
    .map(normalizePaymentMethod)));
  const tipo = ref.tipo_caja ?? base.tipo;
  return {
    monedasPermitidas: dbMonedas.length ? dbMonedas : base.monedasPermitidas,
    tipo,
    esCajaEfectivo:    ref.tipo_caja ? ref.tipo_caja === 'EFECTIVO' : base.esCajaEfectivo,
    prestamista:       ref.prestamista ?? base.prestamista,
    efectivoRol:       tipo === 'EFECTIVO_ADM' ? 'ADM' : tipo === 'EFECTIVO_CEO' ? 'CEO' : undefined,   // [NEW v16.4]
  };
};

// ─── ESTILOS / CONSTANTES ─────────────────────────────────────────────────────

const glass   = "bg-white/[0.02] backdrop-blur-[40px] border border-white/[0.07] shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inp     = "bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01]/60 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all w-full uppercase placeholder:text-white/20";
const noUpper = { textTransform: 'none' } as const;
const optOff  = 'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400';

const DEFAULT_TASA_BS       = 36.50;
const DIRECTOR_FINANCE_CODE = '4827';
const NOOP = () => {};

const MONEDA_COLOR: Record<PaymentMethod, string> = {
  USDT: 'text-emerald-400', ZELLE: 'text-blue-400', CASH: 'text-yellow-400', BS: 'text-orange-400',
};
const MONEDA_BG: Record<PaymentMethod, string> = {
  USDT: 'bg-emerald-500/10 border-emerald-500/20', ZELLE: 'bg-blue-500/10 border-blue-500/20',
  CASH: 'bg-yellow-500/10 border-yellow-500/20',   BS:    'bg-orange-500/10 border-orange-500/20',
};
const TONE = {
  fx:      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  fin:     'bg-violet-500/10 text-violet-400 border-violet-500/20',
  asiento: 'bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/20',
  red:     'bg-red-500/10 text-red-400 border-red-500/20',
  purple:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  yellow:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  orange:  'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

const PREFIJO_EVENTO: Record<EventoContable, string> = {
  INGRESO_DIRECTO: 'ING', GASTO_DIRECTO: 'GAS', NOMINA: 'NOM',
  COBRO_CXC: 'COB', HORAS_PAGADAS: 'HRS', PAGO_CXP: 'PAG',
  PRESTAMO_RECIBIDO: 'PRE', PRESTAMO_DEVOLUCION: 'DEV',
};
const EVENTO_LABEL: Record<EventoContable, string> = {
  INGRESO_DIRECTO: 'INGRESO', GASTO_DIRECTO: 'GASTO', NOMINA: 'NÓMINA',
  COBRO_CXC: 'COBRO CXC', HORAS_PAGADAS: 'HORAS PAGADAS', PAGO_CXP: 'PAGO CXP',
  PRESTAMO_RECIBIDO: 'PRÉSTAMO RECIBIDO', PRESTAMO_DEVOLUCION: 'DEVOLUCIÓN PRÉSTAMO',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const uuid4  = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
const genHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
  return Math.abs(h).toString(16).padStart(8, '0').toUpperCase();
};
const hoyISO  = () => new Date().toISOString().split('T')[0];
const isoDe   = (fecha: string) => new Date(fecha).toISOString();
const prefijo = (m: PaymentMethod) => (m === 'BS' ? 'Bs' : '$');
const fmtNum  = (n: number) => round2(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMonto = (amount: number, moneda: PaymentMethod) => `${moneda === 'BS' ? 'Bs ' : '$'}${fmtNum(amount)}`;
const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return new Date(dt.getTime() + dt.getTimezoneOffset() * 60000)
    .toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
/** yyyy-mm-dd de una fecha almacenada (string o Date), o hoy si es inválida. [FIX v16.1.1] acepta Date */
const fechaInput = (d: string | Date | null | undefined) => {
  const dt = d ? new Date(d) : new Date();
  return Number.isNaN(dt.getTime()) ? hoyISO() : dt.toISOString().split('T')[0];
};

/**
 * Regla de signo ÚNICA del Ledger (fuente de verdad de Bóvedas).
 *  INCOME / RECEIVABLE / FINANCING_IN → + ; resto → − ; FX_EXCHANGE: leg IN → + , OUT / legacy → −
 */
const signedLedgerAmount = (t: LedgerTx): number => {
  const ty = String(t.type);
  if (ty === 'FX_EXCHANGE') return t.fx_leg === 'IN' ? t.amount : -t.amount;
  return ty === 'INCOME' || ty === 'RECEIVABLE' || ty === 'FINANCING_IN' ? t.amount : -t.amount;
};
const isFxTx           = (t: LedgerTx) => String(t.type) === 'FX_EXCHANGE' || !!t.fx_id;
const isFinancingTx    = (t: LedgerTx) => String(t.type) === 'FINANCING_IN' || String(t.type) === 'FINANCING_OUT';
const isNonOperativeTx = (t: LedgerTx) => isFxTx(t) || isFinancingTx(t);
/** Reposición interna registrada como EXPENSE por versiones ≤ v15 (egreso ficticio) */
const esReposicionLegacy = (t: LedgerTx) => String(t.type) === 'EXPENSE' && t.category === 'Reposición Interna' && !t.asiento_id;

/** FX v15: USD-like→BS: M·τ ; BS→USD-like: M/τ ; USD↔USD: M·f */
const computeFxDestino = (origen: PaymentMethod, destino: PaymentMethod, montoOrigen: number, tasa: number): number | null => {
  if (origen === destino) return null;
  if (!Number.isFinite(montoOrigen) || !Number.isFinite(tasa) || montoOrigen <= 0 || tasa <= 0) return null;
  if (origen === 'BS') return round2(montoOrigen / tasa);
  return round2(montoOrigen * tasa);
};
/** Solo se necesita tasa si exactamente un lado es BS */
const requiereTasa = (a: PaymentMethod, b: PaymentMethod) => (a === 'BS') !== (b === 'BS');
/** Conversión de un pago a la moneda de la cuenta */
const convertirMonto = (monto: number, de: PaymentMethod, a: PaymentMethod, tasa: number): number | null => {
  if (!Number.isFinite(monto) || monto <= 0) return null;
  if (!requiereTasa(de, a)) return round2(monto);
  if (!Number.isFinite(tasa) || tasa <= 0) return null;
  return a === 'BS' ? round2(monto * tasa) : round2(monto / tasa);
};

const isMissingRpc = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message ?? ''));

class MotorNoInstaladoError extends Error {
  constructor() {
    super('Motor contable v16 no instalado: ejecute migracion_finance_v16.sql en Supabase.');
    this.name = 'MotorNoInstaladoError';
  }
}
const ERRORES_MOTOR: [RegExp, string][] = [
  [/SOBREPAGO_CXC/,                 'El cobro excede el saldo pendiente de la cuenta por cobrar.'],
  [/SOBREPAGO_CXP/,                 'El pago excede el saldo pendiente de la cuenta por pagar.'],
  [/CAJA_MONEDA_NO_PERMITIDA/,      'La caja seleccionada no opera esa moneda.'],
  [/CUENTA_CON_ABONOS_POSTERIORES/, 'La cuenta tiene cobros/pagos posteriores: anúlelos primero.'],
  [/ASIENTO_NO_EXISTE/,             'El asiento ya no existe (posiblemente anulado).'],
  // [NEW v16.5] trazabilidad de pagadores
  [/ux_pagos_referencia/,           'Esa referencia de pago ya fue registrada: posible pago duplicado. Verifique antes de continuar.'],
  [/pago_ref_obligatoria/,          'Falta la referencia del pago (Zelle / TxID / ref. bancaria).'],
  [/pago_doc_obligatorio/,          'Falta la cédula / RIF de quien pagó.'],
  [/pago_nombre_obligatorio/,       'Falta el nombre de quien pagó.'],
  [/pago_receptor_oblig/,           'Falta quién recibió el dinero en administración.'],
  [/pago_alumno_coherente/,         'Seleccione el alumno que pagó.'],
  [/NO_AUTORIZADO/,                 'Su usuario no está autorizado en finanzas (rol CEO / ADMIN / DIRECTOR).'],
  [/MOTOR_V16_NO_INSTALADO/,        'Motor contable v16 no instalado: ejecute migracion_finance_v16.sql.'],
];
const traducirErrorMotor = (msg: string) => ERRORES_MOTOR.find(([re]) => re.test(msg))?.[1] ?? msg;
const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const esCxpPrestamista = (c: CuentaGeneral, p: Prestamista) =>
  c.entidad_tipo === 'PRESTAMISTA' && ((c.prestamista ?? '') === p || c.entidad_nombre.toUpperCase().includes(p));

/** Construye el payload de un flujo simple del motor: todas las patas enlazadas por asiento_id y referencia. */
const buildFlujo = (s: FlujoSpec): AsientoPayload => {
  const id         = uuid4();
  const referencia = `${PREFIJO_EVENTO[s.evento]}-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const desc       = s.referenciaExterna ? `${s.concepto} · REF ${s.referenciaExterna}` : s.concepto;
  const monto      = round2(s.monto);
  return {
    id, evento: s.evento, fecha: s.fechaISO, referencia,
    concepto: s.concepto, registrado_por: s.registradoPor,
    meta: { ...(s.meta ?? {}), entidad: s.entityName, moneda: s.moneda, monto },
    ledger: s.ledgerType ? [{
      id: uuid4(), type: s.ledgerType, entity_id: s.entityId ?? null, entity_name: s.entityName,
      amount: monto, invoice_number: referencia, description: desc, status: 'PAID',
      category: s.category, payment_method: s.moneda, issue_date: s.fechaISO,
    }] : [],
    caja: s.cajaId ? [{
      id: uuid4(), caja_id: s.cajaId, tipo: s.dir === 'IN' ? 'ENTRADA' : 'SALIDA',
      moneda: s.moneda, monto, concepto: `${EVENTO_LABEL[s.evento]} · ${desc}`,
      referencia, fecha: s.fechaISO, registrado_por: s.registradoPor,
      subcaja: s.subcaja, es_prestamo: !!s.esPrestamo, prestamista: s.prestamista ?? null,
    }] : [],
    abonos: (s.abonos ?? []).map(a => ({ ...a, id: uuid4(), monto: round2(a.monto), monto_origen: round2(a.monto_origen) })),
    nuevas_cxc: s.nuevasCxc ?? [],
    nuevas_cxp: s.nuevasCxp ?? [],
    pago: s.pago ? {   // [NEW v16.5]
      direccion: s.dir, metodo: s.moneda, monto, caja_id: s.cajaId, fecha: s.fechaISO,
      pagador_tipo: s.pago.pagador_tipo, pagador_nombre: s.pago.pagador_nombre.trim().toUpperCase(),
      pagador_documento: s.pago.pagador_documento.trim().toUpperCase(), pagador_contacto: s.pago.pagador_contacto.trim(),
      alumno_id: s.pago.alumno_id || null, referencia_pago: s.pago.referencia_pago.trim().toUpperCase(),
      cuenta_origen: s.pago.cuenta_origen.trim(), recibido_por: s.pago.recibido_por.trim().toUpperCase(),
    } : null,
  };
};

// ─── [NEW v16.5] PAGADOR ──────────────────────────────────────────────────────

const PAGADOR_TIPOS: { k: PagadorTipo; l: string }[] = [
  { k: 'ALUMNO', l: 'Alumno' }, { k: 'REPRESENTANTE', l: 'Representante' },
  { k: 'TERCERO', l: 'Otra persona' }, { k: 'EMPRESA', l: 'Empresa' },
];
const REF_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Nº de recibo (opcional)', ZELLE: 'Código de confirmación Zelle *',
  USDT: 'TxID / hash de la transacción *', BS: 'Nº de referencia bancaria *',
};
const ORIGEN_LABEL: Record<PaymentMethod, string | null> = {
  CASH: null, ZELLE: 'Email o teléfono Zelle del pagador', USDT: 'Wallet / red de origen', BS: 'Banco emisor',
};
const pagoVacio = (recibidoPor = '', base?: Partial<PagoForm>): PagoForm => ({
  pagador_tipo: 'ALUMNO', pagador_nombre: '', pagador_documento: '', pagador_contacto: '',
  alumno_id: '', referencia_pago: '', cuenta_origen: '', recibido_por: recibidoPor, ...base,
});
/** Pagador sugerido a partir de un alumno (editable: puede pagar un representante) */
const pagoDeAlumno = (recibidoPor: string, alumnoId: string, nombre: string): PagoForm =>
  pagoVacio(recibidoPor, { pagador_tipo: 'ALUMNO', alumno_id: alumnoId, pagador_nombre: nombre });
/** Misma regla que las CHECK de pagos_trazabilidad (validación temprana en UI) */
const validarPago = (p: PagoForm, m: PaymentMethod): string | null => {
  if (p.pagador_tipo === 'ALUMNO' && !p.alumno_id)           return 'Seleccione el alumno que pagó.';
  if (p.pagador_nombre.trim().length < 3)                     return 'Indique el nombre completo de quien pagó.';
  if (p.pagador_tipo !== 'PRESTAMISTA' && p.pagador_documento.trim().length < 4) return 'Indique la cédula / RIF de quien pagó.';
  if (m !== 'CASH' && p.referencia_pago.trim().length < 3)    return `Indique ${REF_LABEL[m].replace(' *', '').toLowerCase()}.`;
  if (p.recibido_por.trim().length < 3)                       return 'Indique quién recibió el dinero en administración.';
  return null;
};
const lineaPago = (p: PagoTraza) =>
  `PAGÓ ${p.pagador_nombre}${p.pagador_documento ? ` · ${p.pagador_documento}` : ''} · ${p.metodo}` +
  `${p.referencia_pago ? ` REF ${p.referencia_pago}` : ''} · RECIBIÓ ${p.recibido_por}`;

const downloadCSV = (rows: string[][], filename: string) => {
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' }));
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);   // [FIX v16.1] libera el blob
};

// ─── COMPONENTES UI REUTILIZABLES ─────────────────────────────────────────────

const ErrorBanner: React.FC<{ msg: string | null; onClose: () => void }> = ({ msg, onClose }) => !msg ? null : (
  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 animate-in slide-in-from-top-2 duration-300">
    <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
    <p className="text-[10px] text-red-400 flex-1 font-mono">{msg}</p>
    <button type="button" onClick={onClose} className="text-red-700 hover:text-red-400 transition-colors"><X size={12} /></button>
  </div>
);

const Badge: React.FC<{ tone: string; title?: string; children: React.ReactNode }> = ({ tone, title, children }) => (
  <span title={title} className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${tone}`}>{children}</span>
);

const Lbl: React.FC<{ children: React.ReactNode; cls?: string }> = ({ children, cls = 'text-zinc-500' }) => (
  <label className={`text-[8px] ${cls} font-black uppercase tracking-widest block mb-2`}>{children}</label>
);

const EmptyState: React.FC<{ icon?: LucideIcon; text: string; py?: string }> = ({ icon: Icon, text, py = 'py-12' }) => (
  <div className={`text-center ${py} text-zinc-700`}>
    {Icon && <Icon className="h-8 w-8 mx-auto mb-3 opacity-20" />}
    <p className="text-[9px] font-black uppercase tracking-widest">{text}</p>
  </div>
);

const MonedaPicker: React.FC<{
  value: PaymentMethod; onChange: (m: PaymentMethod) => void;
  options?: PaymentMethod[]; isDisabled?: (m: PaymentMethod) => boolean;
}> = ({ value, onChange, options = ALL_METHODS, isDisabled }) => (
  <div className="grid grid-cols-4 gap-1.5">
    {options.map(m => (
      <button key={m} type="button" onClick={() => onChange(m)} disabled={isDisabled?.(m)}
        className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all disabled:opacity-20 ${value === m ? `${MONEDA_BG[m]} ${MONEDA_COLOR[m]}` : optOff}`}>
        {m}
      </button>
    ))}
  </div>
);

const SubcajaToggle: React.FC<{ value: SubcajaEfectivo; onChange: (s: SubcajaEfectivo) => void; className?: string }> = ({ value, onChange, className = '' }) => (
  <div className={`grid grid-cols-2 gap-1.5 ${className}`}>
    {(['ADM', 'CEO'] as SubcajaEfectivo[]).map(sc => (
      <button key={sc} type="button" onClick={() => onChange(sc)}
        className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${value === sc ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : optOff}`}>
        {sc === 'ADM' ? 'Administración' : 'Custodia CEO'}
      </button>
    ))}
  </div>
);

/** [NEW v16.5] Captura de quién pagó, cómo y quién recibió */
const PagadorFields: React.FC<{
  value: PagoForm; onChange: (p: PagoForm) => void; moneda: PaymentMethod;
  alumnos?: AlumnoCxC[]; bloqueado?: boolean; className?: string;
}> = ({ value: v, onChange, moneda, alumnos = [], bloqueado, className = '' }) => {
  const set = (k: keyof PagoForm, val: string) => onChange({ ...v, [k]: val });
  const origen = ORIGEN_LABEL[moneda];
  return (
    <div className={`rounded-2xl border border-[#E1AD01]/25 bg-[#E1AD01]/[0.03] p-4 space-y-3 ${className}`}>
      <p className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest flex items-center gap-2"><UserCheck size={12} /> Quién pagó · {moneda}</p>
      {!bloqueado && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {PAGADOR_TIPOS.map(t => (
            <button key={t.k} type="button"
              onClick={() => onChange({ ...v, pagador_tipo: t.k, alumno_id: t.k === 'ALUMNO' ? v.alumno_id : '', pagador_nombre: t.k === 'ALUMNO' || v.pagador_tipo === 'ALUMNO' ? '' : v.pagador_nombre })}
              className={`py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${v.pagador_tipo === t.k ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : optOff}`}>
              {t.l}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {v.pagador_tipo === 'ALUMNO' && !bloqueado ? (
          <select value={v.alumno_id} className={inp}
            onChange={e => { const a = alumnos.find(x => x.student_id === e.target.value); onChange({ ...v, alumno_id: e.target.value, pagador_nombre: a?.nombre ?? '' }); }}>
            <option value="">— ALUMNO QUE PAGÓ * —</option>
            {alumnos.map(a => <option key={a.student_id} value={a.student_id}>{a.nombre} · {a.sede}</option>)}
          </select>
        ) : (
          <input value={v.pagador_nombre} readOnly={bloqueado} onChange={e => set('pagador_nombre', e.target.value)}
            placeholder={v.pagador_tipo === 'EMPRESA' ? 'RAZÓN SOCIAL *' : 'NOMBRE COMPLETO DE QUIEN PAGÓ *'} className={inp} />
        )}
        <input value={v.pagador_documento} onChange={e => set('pagador_documento', e.target.value)}
          placeholder={bloqueado ? 'CÉDULA / RIF (opcional)' : v.pagador_tipo === 'EMPRESA' ? 'RIF *' : 'CÉDULA / RIF / PASAPORTE *'} className={inp} />
        <input value={v.referencia_pago} onChange={e => set('referencia_pago', e.target.value)} placeholder={REF_LABEL[moneda].toUpperCase()} className={inp} />
        {origen
          ? <input value={v.cuenta_origen} onChange={e => set('cuenta_origen', e.target.value)} placeholder={origen.toUpperCase()} className={inp} style={noUpper} />
          : <input value={v.pagador_contacto} onChange={e => set('pagador_contacto', e.target.value)} placeholder="TELÉFONO / EMAIL (opcional)" className={inp} style={noUpper} />}
        {origen && <input value={v.pagador_contacto} onChange={e => set('pagador_contacto', e.target.value)} placeholder="TELÉFONO / EMAIL (opcional)" className={inp} style={noUpper} />}
        <input value={v.recibido_por} onChange={e => set('recibido_por', e.target.value)} placeholder="RECIBIDO POR (ADMINISTRACIÓN) *" className={`${inp} ${origen ? '' : 'md:col-span-2'}`} />
      </div>
    </div>
  );
};

const AMOUNT_SIZE = {
  xl: { input: 'py-8 pl-14 pr-6 text-3xl bg-white/5', prefix: 'left-5 text-xl' },
  lg: { input: 'py-6 pl-14 pr-6 text-2xl bg-white/5', prefix: 'left-5 text-xl' },
  md: { input: 'py-4 pl-10 pr-4 text-xl bg-black/50', prefix: 'left-4' },
} as const;

/** Input de monto con prefijo de moneda y redondeo a 2 decimales al salir del campo */
const AmountInput: React.FC<{
  value: string; onChange: (v: string) => void; moneda: PaymentMethod;
  size?: keyof typeof AMOUNT_SIZE; prefixCls?: string; focusCls?: string; disabled?: boolean;
}> = ({ value, onChange, moneda, size = 'md', prefixCls, focusCls = 'focus:border-[#E1AD01]', disabled }) => (
  <div className="relative">
    <span className={`absolute top-1/2 -translate-y-1/2 font-black ${AMOUNT_SIZE[size].prefix} ${prefixCls ?? MONEDA_COLOR[moneda]}`}>{prefijo(moneda)}</span>
    <input type="number" step="0.01" min="0.01" required value={value} disabled={disabled} placeholder="0.00"
      onChange={e => onChange(e.target.value)}
      onBlur={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(round2(n).toString()); }}
      className={`w-full border border-white/10 rounded-2xl font-black italic outline-none text-white ${AMOUNT_SIZE[size].input} ${focusCls}`} />
  </div>
);

const ModalShell: React.FC<{ accent: string; maxW?: string; z?: string; children: React.ReactNode }> = ({ accent, maxW = 'max-w-md', z = 'z-[95]', children }) => (
  <div className={`fixed inset-0 ${z} bg-black/80 backdrop-blur-md flex items-center justify-center p-4`}>
    <div className={`${glass} w-full ${maxW} rounded-3xl p-7 border-t-2 ${accent} max-h-[92vh] overflow-y-auto`}>{children}</div>
  </div>
);

const ModalHeader: React.FC<{ icon: LucideIcon; tone: string; title: string; subtitle?: string; onClose?: () => void }> = ({ icon: Icon, tone, title, subtitle, onClose }) => (
  <div className="flex items-center justify-between mb-6">
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center ${tone}`}><Icon className="h-5 w-5" /></div>
      <div>
        <h3 className="text-[11px] font-black uppercase tracking-widest">{title}</h3>
        {subtitle && <p className="text-[8px] text-zinc-600 mt-1">{subtitle}</p>}
      </div>
    </div>
    {onClose && <button type="button" onClick={onClose} className="text-zinc-600 hover:text-white"><X size={18} /></button>}
  </div>
);

/** Botonera Cancelar / Acción. Sin onSubmit el botón principal es type="submit" del form contenedor. */
const ModalActions: React.FC<{
  onCancel: () => void; submitCls: string; busy: boolean; disabled?: boolean;
  label: React.ReactNode; onSubmit?: () => void;
}> = ({ onCancel, submitCls, busy, disabled, label, onSubmit }) => (
  <div className="flex gap-3">
    <button type="button" onClick={onCancel} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
    <button type={onSubmit ? 'button' : 'submit'} onClick={onSubmit} disabled={busy || disabled}
      className={`flex-[2] py-4 rounded-2xl text-[10px] font-black uppercase disabled:opacity-40 flex items-center justify-center gap-2 ${submitCls}`}>
      {busy ? <Loader2 className="animate-spin h-4 w-4" /> : label}
    </button>
  </div>
);

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export const FinancePanel: React.FC<FinancePanelProps> = ({ vendors, userRole = 'CEO', setGlobalFinance = NOOP }) => {
  const [activeTab, setActiveTab] = useState<TabType>('LEDGER');
  const [tasaBCV,   setTasaBCV]   = useState(DEFAULT_TASA_BS);

  const [transactions, setTransactions] = useState<LedgerTx[]>([]);
  const [requests,     setRequests]     = useState<any[]>([]);
  const [cajas,        setCajas]        = useState<CajaChica[]>([]);
  const [movCajas,     setMovCajas]     = useState<MovimientoCaja[]>([]);
  const [cuentas,      setCuentas]      = useState<CuentaGeneral[]>([]);
  const [capitanes,    setCapitanes]    = useState<any[]>([]);
  const [alumnos,      setAlumnos]      = useState<AlumnoCxC[]>([]);
  const [cuentasCxC,   setCuentasCxC]   = useState<CuentaPorCobrar[]>([]);
  const [fxRegistros,  setFxRegistros]  = useState<FXRecord[]>([]);
  const [abonos,       setAbonos]       = useState<AbonoCuenta[]>([]);

  const [loading,       setLoading]       = useState(true);
  const [selectedVault, setSelectedVault] = useState<PaymentMethod>('USDT');
  const [cajaActiva,    setCajaActiva]    = useState<string | null>(null);
  const fetchLockRef = useRef(false);
  const syncDoneRef  = useRef(false);   // sync histórico corre 1 vez por montaje
  const [sinSesion,   setSinSesion]   = useState(false);          // [NEW v16.2]
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);   // [NEW v16.2]
  /** [NEW v16.3] Diagnóstico cuando RLS oculta las cajas */
  const [diagRls, setDiagRls] = useState<{ uid: string; email: string; staff: boolean | null; error: string | null } | null>(null);

  // errores por módulo
  const [ledgerError,   setLedgerError]   = useState<string | null>(null);
  const [cajaError,     setCajaError]     = useState<string | null>(null);
  const [cuentaError,   setCuentaError]   = useState<string | null>(null);
  const [reqError,      setReqError]      = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [fxError,       setFxError]       = useState<string | null>(null);
  const [cobroError,    setCobroError]    = useState<string | null>(null);

  // estados de carga
  const [savingLedger,   setSavingLedger]   = useState(false);
  const [savingCaja,     setSavingCaja]     = useState(false);
  const [savingCuenta,   setSavingCuenta]   = useState(false);
  const [savingReq,      setSavingReq]      = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingFX,       setSavingFX]       = useState(false);
  const [savingCobro,    setSavingCobro]    = useState(false);
  const [savingAction,   setSavingAction]   = useState<string | null>(null);

  // seguridad director
  const [directorAuthOpen,    setDirectorAuthOpen]    = useState(false);
  const [directorCode,        setDirectorCode]        = useState('');
  const [directorAuthError,   setDirectorAuthError]   = useState<string | null>(null);
  const [pendingSecureAction, setPendingSecureAction] = useState<(() => Promise<void>) | null>(null);

  // edición ledger / caja
  const [editingTx,  setEditingTx]  = useState<LedgerTx | null>(null);
  const [editTxForm, setEditTxForm] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType, description: '', fecha: hoyISO(),
  });
  const [editingMov,  setEditingMov]  = useState<MovimientoCaja | null>(null);
  const [editMovForm, setEditMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: hoyISO(),
  });

  // transferencia entre cajas
  const TRANSFER_INIT = { caja_origen_id: '', caja_destino_id: '', moneda: 'USDT' as PaymentMethod, monto: '', concepto: '', fecha: hoyISO(), generar_reposicion: false };
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferForm,      setTransferForm]      = useState(TRANSFER_INIT);
  const [deleteTransferModal,     setDeleteTransferModal]     = useState<TransferChain | null>(null);
  const [deleteTransferSelection, setDeleteTransferSelection] = useState({ salida: true, entrada: true, reposicion: true });

  // reposición
  const [pagarReposicionModal,  setPagarReposicionModal]  = useState<CuentaGeneral | null>(null);
  const [pagarReposicionMoneda, setPagarReposicionMoneda] = useState<PaymentMethod>('USDT');
  const [pagarReposicionFuente, setPagarReposicionFuente] = useState<string>('');   // '' = saldo sin ubicar

  // entrega efectivo ADM → CEO
  const [entregaCEOModal, setEntregaCEOModal] = useState(false);
  const [entregaCEOForm,  setEntregaCEOForm]  = useState({ monto: '', concepto: '', fecha: hoyISO() });

  // FX Desk (v15)
  const [fxModalOpen, setFxModalOpen] = useState(false);
  const [fxForm, setFxForm] = useState({
    caja_origen_id: '', caja_destino_id: '',
    subcaja_origen: 'ADM' as SubcajaEfectivo, subcaja_destino: 'ADM' as SubcajaEfectivo,
    moneda_origen: 'USDT' as PaymentMethod, moneda_destino: 'BS' as PaymentMethod,
    monto_origen: '', tasa: String(DEFAULT_TASA_BS), concepto: '', fecha: hoyISO(),
  });

  // préstamo externo
  const [prestamoModal, setPrestamoModal] = useState(false);
  const [prestamoForm, setPrestamoForm] = useState({
    prestamista: 'BECQUER' as Prestamista, caja_id: '', moneda: 'USDT' as PaymentMethod,
    monto: '', concepto: '', fecha: hoyISO(), es_devolucion: false,
    subcaja: 'ADM' as SubcajaEfectivo, cuenta_id: '',   // cuenta_id '' = FIFO automático
  });

  // cobro CxC / pago CxP con abonos
  const [cobroModal, setCobroModal] = useState<{ tipo: 'CXC' | 'CXP'; cuentaId: string } | null>(null);
  const [cobroForm, setCobroForm] = useState({
    monto: '', moneda: 'USDT' as PaymentMethod, tasa: String(DEFAULT_TASA_BS),
    caja_id: '', subcaja: 'ADM' as SubcajaEfectivo, referencia: '', fecha: hoyISO(),
  });

  // formularios principales
  const [ledger, setLedger] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    reference: '', capitanId: '', fecha: hoyISO(), caja_id: '', subcaja: 'ADM' as SubcajaEfectivo,
  });
  const [movForm, setMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: hoyISO(),
    subcaja: 'ADM' as SubcajaEfectivo, clase: 'OPERATIVO' as ClaseMovCaja,
  });
  const [cuentaForm, setCuentaForm] = useState({
    tipo: 'HORAS_PAGADAS' as FormTipo, alumno_student_id: '', horas_prometidas: '', moneda_pago: 'USDT',
    entidad_nombre: '', entidad_tipo: 'LIBRE', proveedor_id: '', moneda: 'USDT' as PaymentMethod,
    monto_total: '', concepto: '', fecha_emision: hoyISO(), fecha_vencimiento: '', notas: '',
    caja_id: '', subcaja: 'ADM' as SubcajaEfectivo, tasa: String(DEFAULT_TASA_BS),
  });
  const [showCuentaForm, setShowCuentaForm] = useState(false);

  // [NEW v16.5] trazabilidad de pagadores
  const [pagos,        setPagos]        = useState<PagoTraza[]>([]);
  const [recibidoPor,  setRecibidoPor]  = useState<string>(() => { try { return localStorage.getItem('valkyron:recibido_por') ?? ''; } catch { return ''; } });
  const [ledgerPago,   setLedgerPago]   = useState<PagoForm>(() => pagoVacio());
  const [movPago,      setMovPago]      = useState<PagoForm>(() => pagoVacio());
  const [cobroPago,    setCobroPago]    = useState<PagoForm>(() => pagoVacio());
  const [cuentaPago,   setCuentaPago]   = useState<PagoForm>(() => pagoVacio());
  const [prestamoPago, setPrestamoPago] = useState<PagoForm>(() => pagoVacio('', { pagador_tipo: 'PRESTAMISTA' }));
  const [ledgerQuery,  setLedgerQuery]  = useState('');

  const [reqItems,    setReqItems]    = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount,   setReqAmount]   = useState('');
  const [physBalances, setPhysBalances] = useState<Record<PaymentMethod, string>>({ USDT: '', ZELLE: '', CASH: '', BS: '' });

  // ─── SYNC HISTÓRICO ───────────────────────────────────────────────────────
  // Omite cuentas gestionadas por el motor (asiento_origen_id o abonos) → evita doble ingreso.

  const syncPaidAccountsToLedger = useCallback(async (accounts: CuentaPorCobrar[], abonosList: AbonoCuenta[]) => {
    const conMotor = new Set(abonosList.filter(a => a.cuenta_tipo === 'CXC').map(a => a.cuenta_id));
    const paid = accounts.filter(c => c.estatus === 'COBRADO' && Number(c.monto_total) > 0 && !c.asiento_origen_id && !conMotor.has(String(c.id)));
    for (const c of paid) {
      const { data: exists } = await supabase.from('transacciones_finanzas').select('id').in('invoice_number', [`HORA-${c.id}`, `CXC-${c.id}`]).limit(1);
      if (exists?.length) continue;
      await supabase.from('transacciones_finanzas').insert([{
        id: uuid4(), type: 'INCOME', entity_id: c.student_id, entity_name: c.nombre_alumno || 'ALUMNO',
        amount: round2(Number(c.monto_total) || 0),
        invoice_number: `${c.horas_compradas > 0 ? 'HORA' : 'CXC'}-${c.id}`,
        description: `${c.concepto || 'COBRO'} · SINCRONIZACIÓN HISTÓRICA`,
        status: 'PAID', category: 'Academia', payment_method: normalizePaymentMethod(c.moneda),
        issue_date: c.fecha_emision ? isoDe(c.fecha_emision) : new Date().toISOString(),
      }]);
    }
  }, []);

  // ─── FETCH ────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (silent = false) => {
    if (fetchLockRef.current && !silent) return;
    fetchLockRef.current = true;
    if (!silent) setLoading(true);
    try {
      // [NEW v16.2] sin sesión válida RLS devuelve [] → avisar en lugar de mostrar el panel vacío
      const { data: sesData } = await supabase.auth.getSession();
      setSinSesion(!sesData.session);

      const [txRes, reqRes, cajasRes, movRes, cuentasRes, capRes, alumnosRes, cxcRes, fxRes, abRes, pagRes] = await Promise.all([
        supabase.from('transacciones_finanzas').select('*').order('issue_date', { ascending: false }),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cajas_chicas').select('*').order('nombre'),
        supabase.from('movimientos_caja_chica').select('*').order('fecha', { ascending: false }),
        supabase.from('cuentas_generales').select('*').eq('tipo', 'CXP').order('fecha_emision', { ascending: false }),
        supabase.from('capitanes').select('*').order('nombre'),
        supabase.from('perfiles_estudiantes').select('id, nombre_completo, student_serial, sede').eq('role', 'student').order('nombre_completo'),
        supabase.from('cuentas_por_cobrar').select('*').order('fecha_emision', { ascending: false }),
        supabase.from('fx_registros').select('*').order('fecha', { ascending: false }).limit(200),
        supabase.from('abonos_cuentas').select('*').order('created_at', { ascending: false }),
        supabase.from('pagos_trazabilidad').select('*').order('fecha', { ascending: false }),   // [NEW v16.5]
      ]);

      // [NEW v16.2] errores por tabla visibles (antes se ignoraban y la sección quedaba vacía)
      const consultas: [string, { error: { message: string; code?: string } | null }][] = [
        ['transacciones_finanzas', txRes], ['solicitudes_compra', reqRes], ['cajas_chicas', cajasRes],
        ['movimientos_caja_chica', movRes], ['cuentas_generales', cuentasRes], ['capitanes', capRes],
        ['perfiles_estudiantes', alumnosRes], ['cuentas_por_cobrar', cxcRes], ['fx_registros', fxRes], ['abonos_cuentas', abRes],
        ['pagos_trazabilidad', pagRes],
      ];
      const errs = consultas.filter(([, r]) => r.error).map(([t, r]) => `${t}: ${r.error?.message ?? 'error'}${r.error?.code ? ` (${r.error.code})` : ''}`);
      setFetchErrors(errs);
      if (errs.length) console.warn('[FinancePanel v16.5] consultas con error:', errs);

      // [NEW v16.3] 0 cajas con sesión activa → preguntar a la BD si este usuario es staff
      if (sesData.session && !cajasRes.error && (cajasRes.data?.length ?? 0) === 0) {
        const { data: esStaff, error: eStaff } = await supabase.rpc('es_staff_finanzas');
        setDiagRls({
          uid: sesData.session.user.id, email: sesData.session.user.email ?? '—',
          staff: eStaff ? null : !!esStaff,
          error: eStaff ? `${eStaff.message}${eStaff.code ? ` (${eStaff.code})` : ''}` : null,
        });
      } else setDiagRls(null);

      if (txRes.data) setTransactions(txRes.data.map((t: any) => ({
        id: t.id, type: t.type, entityId: t.entity_id, entityName: t.entity_name || 'MOVIMIENTO',
        amount: round2(Number(t.amount) || 0), invoiceNumber: t.invoice_number || 'S/N',
        description: t.description || '', status: t.status || 'PENDING',
        issueDate: t.issue_date, category: t.category || 'General',
        payment_method: normalizePaymentMethod(t.payment_method),
        fx_id: t.fx_id ?? null, fx_leg: t.fx_leg === 'IN' || t.fx_leg === 'OUT' ? t.fx_leg : null,
        asiento_id: t.asiento_id ?? null,
      } as LedgerTx)));

      if (reqRes.data)   setRequests(reqRes.data);
      if (cajasRes.data) setCajas(cajasRes.data.map((c: any): CajaChica => ({
        ...c, tipo_caja: c.tipo_caja ?? null,
        monedas_permitidas: Array.isArray(c.monedas_permitidas) ? c.monedas_permitidas : null,
        responsable: c.responsable ?? null, prestamista: parsePrestamista(c.prestamista),
      })).sort((a: CajaChica, b: CajaChica) =>   // [NEW v16.4] orden por función
        (ORDEN_TIPO_CAJA[getCajaConfig(a).tipo] ?? 9) - (ORDEN_TIPO_CAJA[getCajaConfig(b).tipo] ?? 9) || a.nombre.localeCompare(b.nombre)));
      if (movRes.data) setMovCajas(movRes.data.map((m: any) => ({
        ...m, moneda: normalizePaymentMethod(m.moneda), monto: round2(Number(m.monto) || 0),
        transfer_id: m.transfer_id ?? null, transfer_role: m.transfer_role ?? null, transfer_peer_id: m.transfer_peer_id ?? null,
        subcaja: m.subcaja ?? null, prestamista: m.prestamista ?? null, es_prestamo: m.es_prestamo ?? false,
        fx_id: m.fx_id ?? null, fx_role: m.fx_role ?? null, asiento_id: m.asiento_id ?? null,
      })));
      if (cuentasRes.data) setCuentas(cuentasRes.data.map((c: any) => ({
        ...c, moneda: normalizePaymentMethod(c.moneda),
        monto_total: round2(Number(c.monto_total) || 0), monto_pendiente: round2(Number(c.monto_pendiente) || 0),
        transfer_id: c.transfer_id ?? null, categoria_interna: c.categoria_interna ?? null,
        prestamista: parsePrestamista(c.prestamista), asiento_origen_id: c.asiento_origen_id ?? null,
      })));
      if (capRes.data)     setCapitanes(capRes.data);
      if (alumnosRes.data) setAlumnos(alumnosRes.data.map((a: any) => ({
        student_id: a.id, nombre: a.nombre_completo || 'SIN NOMBRE', serial: a.student_serial || '—', sede: a.sede || '—',
      })));

      // abonos antes del sync (el sync los usa para no duplicar)
      const abonosNorm: AbonoCuenta[] = (abRes.data ?? []).map((a: any) => ({
        id: a.id, asiento_id: a.asiento_id, cuenta_tipo: a.cuenta_tipo === 'CXP' ? 'CXP' : 'CXC',
        cuenta_id: String(a.cuenta_id), monto: round2(Number(a.monto) || 0),
        moneda_cuenta: a.moneda_cuenta ?? null,
        monto_origen: a.monto_origen != null ? round2(Number(a.monto_origen)) : null,
        moneda_origen: a.moneda_origen ?? null,
        tasa: a.tasa != null ? round4(Number(a.tasa)) : null,
        horas: Number(a.horas) || 0, created_at: a.created_at,
      }));
      setAbonos(abonosNorm);

      if (pagRes.data) setPagos(pagRes.data.map((x: any): PagoTraza => ({   // [NEW v16.5]
        ...x, metodo: normalizePaymentMethod(x.metodo), monto: round2(Number(x.monto) || 0), anulado: !!x.anulado,
      })));
      if (sesData.session?.user.email) setRecibidoPor(r => r || (sesData.session?.user.email ?? '').split('@')[0].toUpperCase());

      if (cxcRes.data) {
        const norm: CuentaPorCobrar[] = cxcRes.data.map((c: any) => ({
          ...c,
          monto_total: round2(Number(c.monto_total) || 0), monto_pagado: round2(Number(c.monto_pagado) || 0),
          monto_pendiente: round2(Number(c.monto_pendiente) || 0),
          horas_prometidas: Number(c.horas_prometidas) || 0, horas_compradas: Number(c.horas_compradas) || 0,
          moneda: normalizePaymentMethod(c.moneda), asiento_origen_id: c.asiento_origen_id ?? null,
        }));
        setCuentasCxC(norm);
        if (!syncDoneRef.current) { syncDoneRef.current = true; await syncPaidAccountsToLedger(norm, abonosNorm); }
      }

      if (fxRes.data) setFxRegistros(fxRes.data.map((f: any) => ({
        ...f,
        moneda_origen: normalizePaymentMethod(f.moneda_origen), moneda_destino: normalizePaymentMethod(f.moneda_destino),
        monto_origen: round2(Number(f.monto_origen) || 0), monto_destino: round2(Number(f.monto_destino) || 0),
        tasa: round4(Number(f.tasa) || 0),
        caja_origen_id: f.caja_origen_id ?? f.caja_id ?? null, caja_destino_id: f.caja_destino_id ?? null,
        subcaja_origen: f.subcaja_origen ?? null, subcaja_destino: f.subcaja_destino ?? null, referencia: f.referencia ?? null,
      })));
    } catch (e) {
      console.error('[FinancePanel v16.5] fetchAll error:', e);
    } finally {
      setLoading(false);
      fetchLockRef.current = false;
    }
  }, [syncPaidAccountsToLedger]);

  /** Recarga silenciosa post-escritura */
  const refresh = useCallback(async () => { fetchLockRef.current = false; await fetchAll(true); }, [fetchAll]);

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRealtimeChange = useCallback(() => {
    if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
    realtimeDebounce.current = setTimeout(() => fetchAll(true), 800);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
    const tablas = ['transacciones_finanzas', 'solicitudes_compra', 'cajas_chicas', 'movimientos_caja_chica',
      'cuentas_generales', 'cuentas_por_cobrar', 'fx_registros', 'abonos_cuentas', 'asientos_contables', 'pagos_trazabilidad'];
    const ch = tablas.reduce((c, table) => c.on('postgres_changes', { event: '*', schema: 'public', table }, handleRealtimeChange),
      supabase.channel('finance-v16')).subscribe();
    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      supabase.removeChannel(ch);
    };
  }, [fetchAll, handleRealtimeChange]);

  // [NEW v16.2] recarga al recuperar sesión; marca sin sesión al cerrarse
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { setSinSesion(true); return; }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') { setSinSesion(false); handleRealtimeChange(); }
    });
    return () => data.subscription.unsubscribe();
  }, [handleRealtimeChange]);

  // [NEW v16.5] "Recibido por" por defecto: se recuerda en este navegador y rellena los formularios vacíos
  useEffect(() => {
    if (!recibidoPor) return;
    try { localStorage.setItem('valkyron:recibido_por', recibidoPor); } catch { /* almacenamiento no disponible */ }
    const fill = (p: PagoForm) => (p.recibido_por ? p : { ...p, recibido_por: recibidoPor });
    setLedgerPago(fill); setMovPago(fill); setCuentaPago(fill); setPrestamoPago(fill);
  }, [recibidoPor]);

  /** [NEW v16.5] Recuerda quién recibió y devuelve un formulario limpio */
  const pagoRegistrado = (p: PagoForm, base?: Partial<PagoForm>) => {
    setRecibidoPor(p.recibido_por.trim().toUpperCase());
    return pagoVacio(p.recibido_por.trim().toUpperCase(), base);
  };

  /** [NEW v16.5] Pagador por asiento (solo vigentes) */
  const pagoPorAsiento = useMemo(() => new Map(pagos.filter(x => !x.anulado).map(x => [x.asiento_id, x])), [pagos]);

  /** [NEW v16.2] Limpia la sesión corrupta (refresh token inválido) y vuelve al login */
  const reiniciarSesion = async () => {
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (err) { console.error('[FinancePanel] signOut:', err); }
    window.location.reload();
  };

  // ─── MÉTRICAS ─────────────────────────────────────────────────────────────

  /** Saldo de bóveda con la regla de signo única (incluye patas FX y financiamiento) */
  const getVaultBalance = useCallback((method: PaymentMethod) =>
    transactions.filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((acc, t) => round2(acc + signedLedgerAmount(t)), 0),
  [transactions]);

  useEffect(() => {
    setGlobalFinance({ USDT: getVaultBalance('USDT'), ZELLE: getVaultBalance('ZELLE'), CASH: getVaultBalance('CASH'), BS: getVaultBalance('BS') });
  }, [getVaultBalance, setGlobalFinance]);

  const getCajaBalance = useCallback((cajaId: string, moneda: PaymentMethod) =>
    movCajas.filter(m => m.caja_id === cajaId && m.moneda === moneda)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  const getSubcajaBalance = useCallback((cajaId: string, subcaja: SubcajaEfectivo) =>
    movCajas.filter(m => m.caja_id === cajaId && m.moneda === 'CASH' && m.subcaja === subcaja)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  /** Saldo de custodia: subcaja de efectivo si aplica, si no saldo de caja por moneda */
  const saldoCustodia = useCallback((cajaId: string, moneda: PaymentMethod, subcaja: SubcajaEfectivo | null) =>
    subcaja ? getSubcajaBalance(cajaId, subcaja) : getCajaBalance(cajaId, moneda),
  [getCajaBalance, getSubcajaBalance]);

  /** Equivalente USD para totales mixtos */
  const aUSD = useCallback((monto: number, moneda: PaymentMethod) =>
    moneda === 'BS' ? (tasaBCV > 0 ? round2(monto / tasaBCV) : 0) : round2(monto),
  [tasaBCV]);

  const cxcPendientes   = useMemo(() => cuentasCxC.filter(c => c.estatus === 'PENDIENTE' || c.estatus === 'PARCIAL'), [cuentasCxC]);
  const horasPagadas    = useMemo(() => cuentasCxC.filter(c => c.estatus === 'COBRADO'), [cuentasCxC]);
  const totalCxC        = useMemo(() => cxcPendientes.reduce((a, c) => round2(a + aUSD(c.monto_pendiente, normalizePaymentMethod(c.moneda))), 0), [cxcPendientes, aUSD]);
  const totalHorasAcred = useMemo(() => round2(cuentasCxC.reduce((a, c) => a + (Number(c.horas_compradas) || 0), 0)), [cuentasCxC]);

  const cuentasProveedores  = useMemo(() => cuentas.filter(c => c.categoria_interna !== 'REPOSICION_CAJA'), [cuentas]);
  const cuentasReposiciones = useMemo(() => cuentas.filter(c => c.categoria_interna === 'REPOSICION_CAJA'), [cuentas]);
  const totalPendienteUSD   = useCallback((list: CuentaGeneral[]) =>
    list.filter(c => c.estatus !== 'PAGADO').reduce((a, c) => round2(a + aUSD(c.monto_pendiente, c.moneda)), 0), [aUSD]);
  const totalCxP          = useMemo(() => totalPendienteUSD(cuentasProveedores),  [cuentasProveedores, totalPendienteUSD]);
  const totalReposiciones = useMemo(() => totalPendienteUSD(cuentasReposiciones), [cuentasReposiciones, totalPendienteUSD]);

  // ─── HELPERS DE CAJA ──────────────────────────────────────────────────────

  const cajaById        = useCallback((id?: string | null) => (id ? cajas.find(c => c.id === id) ?? null : null), [cajas]);
  const cajaEsEfectivo  = (id?: string | null) => { const c = cajaById(id); return !!c && getCajaConfig(c).esCajaEfectivo; };
  const cajasQueAceptan = useCallback((m: PaymentMethod) => cajas.filter(c => getCajaConfig(c).monedasPermitidas.includes(m)), [cajas]);
  const cajaNombre      = (id?: string | null) => (id ? cajaById(id)?.nombre ?? 'CAJA ELIMINADA' : 'SOLO BÓVEDA');

  /** Caja por defecto de una moneda: CASH → EFECTIVO ADMIN (stand-by) [CHG v16.4]; resto → caja exclusiva (BS→CAJA BS) o '' */
  const defaultCajaFor = useCallback((m: PaymentMethod): string => {
    if (m === 'CASH') {
      const adm = cajas.find(c => getCajaConfig(c).efectivoRol === 'ADM');
      if (adm) return adm.id;
    }
    return cajas.find(c => {
      const cf = getCajaConfig(c);
      return cf.monedasPermitidas.length === 1 && cf.monedasPermitidas[0] === m;
    })?.id ?? '';
  }, [cajas]);

  /** Mantiene la caja si opera la moneda; si no, la caja por defecto de esa moneda */
  const ajustarCaja = (cajaId: string, m: PaymentMethod) => {
    const c = cajaById(cajaId);
    return c && getCajaConfig(c).monedasPermitidas.includes(m) ? cajaId : defaultCajaFor(m);
  };

  /** Conciliación: Bóveda (consolidado) vs Σ Cajas (custodia física) */
  const conciliacion = useMemo(() => ALL_METHODS.map(m => {
    const boveda  = getVaultBalance(m);
    const enCajas = round2(cajas.reduce((a, c) => a + getCajaBalance(c.id, m), 0));
    return { m, boveda, enCajas, sinAsignar: round2(boveda - enCajas) };
  }), [cajas, getVaultBalance, getCajaBalance]);
  const sinUbicar = (m: PaymentMethod) => conciliacion.find(x => x.m === m)?.sinAsignar ?? 0;

  const reposicionesLegacyLedger = useMemo(() => transactions.filter(esReposicionLegacy), [transactions]);

  /** Posición con terceros: custodia (dinero de Águilas en su poder) vs deuda (préstamos) */
  const posicionTerceros = useMemo(() => PRESTAMISTAS.map(p => {
    const cajasP = cajas.filter(c => getCajaConfig(c).prestamista === p);
    const filas = ALL_METHODS.map(m => {
      const custodia  = round2(cajasP.reduce((a, c) => a + getCajaBalance(c.id, m), 0));
      const deuda     = round2(cuentas.filter(c => esCxpPrestamista(c, p) && c.moneda === m && c.estatus !== 'PAGADO').reduce((a, c) => a + c.monto_pendiente, 0));
      const cajaMayor = cajasP.map(c => ({ id: c.id, s: getCajaBalance(c.id, m) })).sort((a, b) => b.s - a.s)[0]?.id ?? '';
      return { m, custodia, deuda, neto: round2(custodia - deuda), cajaMayor };
    }).filter(f => Math.abs(f.custodia) > 0.001 || Math.abs(f.deuda) > 0.001);
    return { p, cajasP, filas };
  }), [cajas, cuentas, getCajaBalance]);

  /** Valida que una caja (opcional) opere la moneda */
  const validarCajaMoneda = useCallback((cajaId: string | null, moneda: PaymentMethod): string | null => {
    if (!cajaId) return null;
    const c = cajas.find(x => x.id === cajaId);
    if (!c) return 'Caja no encontrada.';
    const conf = getCajaConfig(c);
    return conf.monedasPermitidas.includes(moneda) ? null : `${c.nombre} solo acepta: ${conf.monedasPermitidas.join(', ')}`;
  }, [cajas]);

  /** Advertencia de fondos (bóveda y caja) antes de una salida */
  const confirmarFondos = useCallback((moneda: PaymentMethod, monto: number, cajaId: string | null, subcaja: SubcajaEfectivo | null): boolean => {
    const avisos: string[] = [];
    const sb = getVaultBalance(moneda);
    if (sb < monto) avisos.push(`Bóveda ${moneda}: ${fmtMonto(sb, moneda)} disponible`);
    if (cajaId) {
      const s = saldoCustodia(cajaId, moneda, subcaja);
      if (s < monto) avisos.push(`${cajas.find(x => x.id === cajaId)?.nombre ?? 'Caja'}${subcaja ? ` (${subcaja})` : ''}: ${fmtMonto(s, moneda)} disponible`);
    }
    return !avisos.length || window.confirm(`⚠️ Fondos insuficientes para ${fmtMonto(monto, moneda)}\n\n${avisos.join('\n')}\n\n¿Registrar de todas formas?`);
  }, [cajas, getVaultBalance, saldoCustodia]);

  // ─── SEGURIDAD ────────────────────────────────────────────────────────────

  const rolUpper         = String(userRole).toUpperCase();   // [FIX v16.2.1] 'admin' de BD = 'ADMIN'
  const canManageFinance = ['CEO', 'ADMIN', 'DIRECTOR'].includes(rolUpper);

  const requireDirectorCode = useCallback((action: () => Promise<void>) => {
    if (!canManageFinance) { alert('Acceso denegado.'); return; }
    setDirectorCode(''); setDirectorAuthError(null);
    setPendingSecureAction(() => action);
    setDirectorAuthOpen(true);
  }, [canManageFinance]);

  const cancelDirectorAuth = () => {
    setDirectorAuthOpen(false); setDirectorCode(''); setDirectorAuthError(null); setPendingSecureAction(null);
  };

  const confirmDirectorCode = async () => {
    if (!/^\d{4}$/.test(directorCode)) { setDirectorAuthError('La clave debe tener 4 dígitos.'); return; }
    if (directorCode !== DIRECTOR_FINANCE_CODE) { setDirectorAuthError('Clave incorrecta.'); setDirectorCode(''); return; }
    const action = pendingSecureAction;
    cancelDirectorAuth();
    if (action) { try { await action(); } catch (err) { console.error('[FinancePanel] acción protegida:', err); } }
  };

  // ─── MOTOR CONTABLE ───────────────────────────────────────────────────────

  /** RPC del motor: lanza MotorNoInstaladoError si la migración v16 no existe */
  const callMotor = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(fn, args);
    if (!error) return;
    if (isMissingRpc(error)) throw new MotorNoInstaladoError();
    throw new Error(traducirErrorMotor(error.message));
  }, []);
  /**
   * [CHG v16.5] Con pagador → fn_registrar_asiento_v2 (asiento + pagador atómicos). Si falta la migración v16.5
   * se lanza Error simple (no MotorNoInstaladoError) para que NINGUNA ruta legacy registre un ingreso sin pagador.
   */
  const postAsiento = useCallback(async (a: AsientoPayload) => {
    const { pago, ...sinPago } = a;
    if (!pago) return callMotor('fn_registrar_asiento', { p: sinPago });   // v1 recibe exactamente el payload de v16
    const { error } = await supabase.rpc('fn_registrar_asiento_v2', { p: a });
    if (!error) return;
    if (isMissingRpc(error)) throw new Error('Trazabilidad de pagadores no instalada: ejecute migracion_finance_v16_5_pagadores.sql en Supabase.');
    throw new Error(traducirErrorMotor(`${error.message} ${error.details ?? ''}`));
  }, [callMotor]);
  /** [CHG v16.5] Anulación v2 (marca el pagador como anulado); fallback v1 si la migración v16.5 no existe */
  const rpcAnularAsiento = useCallback(async (asientoId: string) => {
    const { error } = await supabase.rpc('fn_anular_asiento_v2', { p_asiento_id: asientoId });
    if (!error) return;
    if (isMissingRpc(error)) return callMotor('fn_anular_asiento', { p_asiento_id: asientoId });
    throw new Error(traducirErrorMotor(error.message));
  }, [callMotor]);

  const anularAsiento = (asientoId: string) => requireDirectorCode(async () => {
    setSavingAction(asientoId);
    try { await rpcAnularAsiento(asientoId); await refresh(); }
    catch (err) { const msg = errMsg(err, 'Error al anular asiento.'); setLedgerError(msg); setCajaError(msg); setCuentaError(msg); }
    finally { setSavingAction(null); }
  });

  // ─── FX: PURGA / ANULACIÓN (v15) ──────────────────────────────────────────

  const purgeFx = useCallback(async (fxId: string, extraRef?: string) => {
    const refs = Array.from(new Set([
      ...movCajas.filter(m => m.fx_id === fxId).map(m => m.referencia),
      ...fxRegistros.filter(f => f.id === fxId).map(f => f.referencia ?? ''),
      extraRef ?? '',
    ].filter((r): r is string => !!r)));
    const del = async (label: string, q: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await q;
      if (error) throw new Error(`${label}: ${error.message}`);
    };
    await del('Ledger FX', supabase.from('transacciones_finanzas').delete().eq('fx_id', fxId));
    if (refs.length) await del('Ledger FX legacy', supabase.from('transacciones_finanzas').delete().in('invoice_number', refs.flatMap(r => [r, `${r}-OUT`, `${r}-IN`])));
    await del('Cajas FX', supabase.from('movimientos_caja_chica').delete().eq('fx_id', fxId));
    await del('Registro FX', supabase.from('fx_registros').delete().eq('id', fxId));
  }, [movCajas, fxRegistros]);

  const anularFX = (fxId: string) => requireDirectorCode(async () => {
    setSavingAction(fxId);
    try { await purgeFx(fxId); await refresh(); }
    catch (err) { const msg = errMsg(err, 'Error al anular FX.'); setLedgerError(msg); setCajaError(msg); }
    finally { setSavingAction(null); }
  });

  // ─── EDICIÓN ──────────────────────────────────────────────────────────────

  const openEditTx = (tx: LedgerTx) => {
    if (tx.fx_id)      { alert('Este asiento pertenece a una operación FX. Anule el FX completo y regístrelo de nuevo en FX Desk.'); return; }
    if (tx.asiento_id) { alert('Este registro pertenece a un asiento contable (bóveda + caja + cuentas). Anule el asiento y regístrelo de nuevo.'); return; }
    setEditingTx(tx);
    setEditTxForm({
      amount: String(round2(Number(tx.amount) || 0)), currency: normalizePaymentMethod(tx.payment_method),
      type: tx.type as TransactionType, description: tx.description || '', fecha: fechaInput(tx.issueDate),
    });
  };

  const saveEditedTx = async () => {
    if (!editingTx) return;
    const amount = round2(parseFloat(editTxForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) { setLedgerError('Monto inválido.'); return; }
    if (editTxForm.type === 'FX_EXCHANGE' && !editingTx.fx_id) {
      setLedgerError('Un cambio de moneda se registra en FX Desk (2 patas). Cambie el tipo a Ingreso/Egreso o elimine el asiento.'); return;
    }
    if (editTxForm.type === 'FINANCING_IN' || editTxForm.type === 'FINANCING_OUT') {
      setLedgerError('Los préstamos se registran desde "Préstamo Externo" (crea/rebaja la CxP del prestamista).'); return;
    }
    setSavingAction(editingTx.id);
    try {
      const { error } = await supabase.from('transacciones_finanzas').update({
        amount, payment_method: editTxForm.currency, type: editTxForm.type,
        description: editTxForm.description.trim() || 'MOVIMIENTO EDITADO', issue_date: isoDe(editTxForm.fecha),
      }).eq('id', editingTx.id);
      if (error) throw new Error(error.message);
      setEditingTx(null);
      await refresh();
    } catch (err) { setLedgerError(errMsg(err, 'Error al editar.')); }
    finally { setSavingAction(null); }
  };

  const openEditMov = (mov: MovimientoCaja) => {
    if (mov.transfer_id) { alert('Forma parte de una transferencia. Elimínela completa y créela de nuevo.'); return; }
    if (mov.fx_id)       { alert('Forma parte de una operación FX. Anule el FX completo y regístrelo de nuevo.'); return; }
    if (mov.asiento_id)  { alert('Forma parte de un asiento contable. Anule el asiento y regístrelo de nuevo.'); return; }
    setEditingMov(mov);
    setEditMovForm({
      tipo: mov.tipo, moneda: normalizePaymentMethod(mov.moneda), monto: String(round2(Number(mov.monto) || 0)),
      concepto: mov.concepto || '', referencia: mov.referencia || '', fecha: fechaInput(mov.fecha),
    });
  };

  const saveEditedMov = async () => {
    if (!editingMov) return;
    const monto = round2(parseFloat(editMovForm.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!editMovForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    const conf = getCajaConfig(cajaById(editingMov.caja_id) ?? '');
    if (!conf.monedasPermitidas.includes(editMovForm.moneda)) { setCajaError(`Esta caja solo acepta: ${conf.monedasPermitidas.join(', ')}`); return; }
    setSavingAction(editingMov.id);
    try {
      const { error } = await supabase.from('movimientos_caja_chica').update({
        tipo: editMovForm.tipo, moneda: editMovForm.moneda, monto,
        concepto: editMovForm.concepto.toUpperCase().trim(),
        referencia: editMovForm.referencia.toUpperCase().trim() || null,
        fecha: isoDe(editMovForm.fecha),
      }).eq('id', editingMov.id);
      if (error) throw new Error(error.message);
      setEditingMov(null);
      await refresh();
    } catch (err) { setCajaError(errMsg(err, 'Error al editar movimiento.')); }
    finally { setSavingAction(null); }
  };

  // ─── ELIMINACIÓN ──────────────────────────────────────────────────────────

  const deleteTxProtected = (id: string) => {
    const tx     = transactions.find(t => t.id === id);
    const fxLink = tx?.fx_id ?? (tx?.invoiceNumber ? movCajas.find(m => m.fx_id && m.referencia === tx.invoiceNumber)?.fx_id : null) ?? null;
    if (fxLink)         { anularFX(fxLink); return; }
    if (tx?.asiento_id) { anularAsiento(tx.asiento_id); return; }
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const { error } = await supabase.from('transacciones_finanzas').delete().eq('id', id);
        if (error) throw new Error(error.message);
        if (tx?.invoiceNumber?.startsWith('CXC-') || tx?.invoiceNumber?.startsWith('HORA-')) {
          await supabase.from('cuentas_por_cobrar').delete().eq('id', tx.invoiceNumber.replace(/^(CXC|HORA)-/, ''));
        }
        await refresh();
      } catch (err) { setLedgerError(errMsg(err, 'Error al eliminar.')); }
      finally { setSavingAction(null); }
    });
  };

  const deleteMovProtected = (id: string) => {
    const mov = movCajas.find(m => m.id === id);
    if (mov?.transfer_id) { openDeleteTransferModal(mov.transfer_id); return; }
    if (mov?.fx_id)       { anularFX(mov.fx_id); return; }
    if (mov?.asiento_id)  { anularAsiento(mov.asiento_id); return; }
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', id);
        if (error) throw new Error(error.message);
        await refresh();
      } catch (err) { setCajaError(errMsg(err, 'Error al eliminar movimiento.')); }
      finally { setSavingAction(null); }
    });
  };

  /** Eliminar cuenta: anula sus abonos (nuevo → viejo), luego el asiento de origen y borra la fila legacy. */
  const deleteCuentaProtected = (id: string, esCxC: boolean) => {
    if (!esCxC) {
      const cuenta = cuentas.find(c => c.id === id);
      if (cuenta?.transfer_id) { openDeleteTransferModal(cuenta.transfer_id); return; }
    }
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const tipo   = esCxC ? 'CXC' : 'CXP';
        const origen = (esCxC ? cuentasCxC.find(c => c.id === id) : cuentas.find(c => c.id === id))?.asiento_origen_id ?? null;
        const ligados = abonos
          .filter(a => a.cuenta_tipo === tipo && a.cuenta_id === String(id))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .map(a => a.asiento_id);
        for (const aId of Array.from(new Set([...ligados.filter(x => x !== origen), ...(origen ? [origen] : [])]))) await rpcAnularAsiento(aId);

        const { error } = await supabase.from(esCxC ? 'cuentas_por_cobrar' : 'cuentas_generales').delete().eq('id', id);
        if (error) throw new Error(error.message);
        if (esCxC) await supabase.from('transacciones_finanzas').delete().in('invoice_number', [`CXC-${id}`, `HORA-${id}`]);
        await refresh();
      } catch (err) { setCuentaError(errMsg(err, 'Error al eliminar cuenta.')); }
      finally { setSavingAction(null); }
    });
  };

  // ─── HANDLER: LEDGER ──────────────────────────────────────────────────────
  // Todo movimiento manual pasa por el motor (bóveda + caja opcional en 1 asiento).
  // Sin caja y sin motor instalado → ruta legacy v15 (solo bóveda).

  const handleLedger = async (e: React.FormEvent) => {
    e.preventDefault(); setLedgerError(null);
    if (ledger.type === 'FX_EXCHANGE') { openFxDesk(ledger.currency); return; }
    const num = round2(parseFloat(ledger.amount));
    if (isNaN(num) || num <= 0) { setLedgerError('Monto inválido.'); return; }
    if (ledger.type === 'INSTRUCTOR_PAY' && !ledger.capitanId) { setLedgerError('Selecciona un capitán.'); return; }
    const cajaId  = ledger.caja_id || null;
    const cajaErr = validarCajaMoneda(cajaId, ledger.currency);
    if (cajaErr) { setLedgerError(cajaErr); return; }
    const cajaObj   = cajaById(cajaId);
    const subcaja   = cajaEsEfectivo(cajaId) ? ledger.subcaja : null;
    const esIngreso = ledger.type === 'INCOME';
    const esNomina  = ledger.type === 'INSTRUCTOR_PAY';
    if (esIngreso) {   // [NEW v16.5] todo ingreso exige pagador
      const errPago = validarPago(ledgerPago, ledger.currency);
      if (errPago) { setLedgerError(errPago); return; }
    }
    if (!esIngreso && !confirmarFondos(ledger.currency, num, cajaId, subcaja)) return;

    setSavingLedger(true);
    const fechaISO   = isoDe(ledger.fecha);
    const entityName = esNomina ? `NÓMINA: ${capitanes.find(c => c.id === ledger.capitanId)?.nombre ?? 'CAPITÁN'}`
      : esIngreso ? `INGRESO · ${ledgerPago.pagador_nombre.trim().toUpperCase()}` : `${ledger.type} ${ledger.currency}`;
    const concepto   = ledger.reference.trim().toUpperCase() || 'REGISTRO MANUAL';
    const category   = esNomina ? 'Nomina' : 'General';
    try {
      try {
        await postAsiento(buildFlujo({
          evento: esNomina ? 'NOMINA' : esIngreso ? 'INGRESO_DIRECTO' : 'GASTO_DIRECTO',
          dir: esIngreso ? 'IN' : 'OUT', ledgerType: ledger.type, moneda: ledger.currency, monto: num,
          fechaISO, concepto, entityName, category, cajaId: cajaObj?.id ?? null, subcaja, registradoPor: userRole,
          entityId: esIngreso ? ledgerPago.alumno_id || null : null,
          referenciaExterna: esIngreso ? ledgerPago.referencia_pago.trim().toUpperCase() || undefined : undefined,
          pago: esIngreso ? ledgerPago : null,
        }));
      } catch (err) {
        // ingresos con pagador nunca caen a la ruta legacy (postAsiento no lanza MotorNoInstaladoError en v2)
        if (!(err instanceof MotorNoInstaladoError) || cajaObj) throw err;
        const txId = uuid4();   // [PRESERVADO v15] ruta legacy: solo bóveda
        const { error } = await supabase.from('transacciones_finanzas').insert([{
          id: txId, type: ledger.type, entity_name: entityName, amount: num,
          invoice_number: `TX-${genHash(txId)}`, description: ledger.reference.trim() || 'REGISTRO MANUAL',
          status: 'PAID', category, payment_method: ledger.currency, issue_date: fechaISO,
        }]);
        if (error) { setLedgerError(error.code === '23505' ? 'Duplicado detectado.' : `Error: ${error.message}`); return; }
      }
      setLedger(p => ({ ...p, amount: '', reference: '' }));
      if (esIngreso) setLedgerPago(pagoRegistrado(ledgerPago));
      await refresh();
    } catch (err) { setLedgerError(errMsg(err, 'Error de conexión.')); }
    finally { setSavingLedger(false); }
  };

  // ─── HANDLER: CAJA ────────────────────────────────────────────────────────
  // OPERATIVO → asiento (caja + bóveda). UBICACIÓN → solo custodia (ruta v15).

  const handleMovCaja = async (e: React.FormEvent) => {
    e.preventDefault(); setCajaError(null);
    if (!cajaActiva) { setCajaError('Selecciona una caja.'); return; }
    const num = round2(parseFloat(movForm.monto));
    if (isNaN(num) || num <= 0) { setCajaError('Monto inválido.'); return; }
    if (!movForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    const cajaObj  = cajaById(cajaActiva);
    const cajaConf = getCajaConfig(cajaObj ?? '');
    if (!cajaConf.monedasPermitidas.includes(movForm.moneda)) { setCajaError(`Esta caja solo acepta: ${cajaConf.monedasPermitidas.join(', ')}`); return; }
    const subcaja = cajaConf.esCajaEfectivo ? movForm.subcaja : null;
    const ingresoReal = movForm.clase === 'OPERATIVO' && movForm.tipo === 'ENTRADA';   // [NEW v16.5]
    if (ingresoReal) {
      const errPago = validarPago(movPago, movForm.moneda);
      if (errPago) { setCajaError(errPago); return; }
    }

    if (movForm.clase === 'UBICACION' && movForm.tipo === 'ENTRADA') {
      const sinU = sinUbicar(movForm.moneda);
      if (num > sinU + 0.01 && !window.confirm(`⚠️ Solo hay ${fmtMonto(sinU, movForm.moneda)} sin ubicar en la bóveda ${movForm.moneda}.\nUbicar ${fmtMonto(num, movForm.moneda)} dejará Σ Cajas > Bóveda.\n\nSi es dinero nuevo use clase OPERATIVO. ¿Continuar?`)) return;
    }
    if (movForm.tipo === 'SALIDA') {
      const saldo = saldoCustodia(cajaActiva, movForm.moneda, subcaja);
      if (saldo < num && !window.confirm(`⚠️ ${cajaObj?.nombre ?? 'Caja'} tiene ${fmtMonto(saldo, movForm.moneda)}. ¿Registrar salida de ${fmtMonto(num, movForm.moneda)}?`)) return;
    }

    setSavingCaja(true);
    try {
      const concepto   = movForm.concepto.toUpperCase().trim();
      const referencia = movForm.referencia.toUpperCase().trim();
      if (movForm.clase === 'OPERATIVO') {
        const esEntrada = movForm.tipo === 'ENTRADA';
        try {
          await postAsiento(buildFlujo({
            evento: esEntrada ? 'INGRESO_DIRECTO' : 'GASTO_DIRECTO', dir: esEntrada ? 'IN' : 'OUT',
            ledgerType: esEntrada ? 'INCOME' : 'EXPENSE', moneda: movForm.moneda, monto: num,
            fechaISO: isoDe(movForm.fecha), concepto,
            entityName: esEntrada ? `INGRESO · ${movPago.pagador_nombre.trim().toUpperCase()}` : `${(cajaObj?.nombre ?? 'CAJA').toUpperCase()} · GASTO`,
            entityId: esEntrada ? movPago.alumno_id || null : null,
            category: 'Caja', cajaId: cajaActiva, subcaja, registradoPor: userRole,
            referenciaExterna: (esEntrada ? movPago.referencia_pago.trim().toUpperCase() : referencia) || undefined,
            pago: esEntrada ? movPago : null,
          }));
        } catch (err) {
          if (err instanceof MotorNoInstaladoError) { setCajaError(`${err.message} Mientras tanto use clase UBICACIÓN.`); return; }
          throw err;
        }
      } else {
        const { error } = await supabase.from('movimientos_caja_chica').insert([{   // [PRESERVADO v15] solo custodia
          id: uuid4(), caja_id: cajaActiva, tipo: movForm.tipo, moneda: movForm.moneda, monto: num,
          concepto: `UBICACIÓN · ${concepto}`, referencia: referencia || null,
          fecha: isoDe(movForm.fecha), registrado_por: userRole, subcaja,
        }]);
        if (error) { setCajaError(`Error: ${error.message}`); return; }
      }
      setMovForm(p => ({ ...p, monto: '', concepto: '', referencia: '' }));
      if (ingresoReal) setMovPago(pagoRegistrado(movPago));
      await refresh();
    } catch (err) { setCajaError(errMsg(err, 'Error de conexión.')); }
    finally { setSavingCaja(false); }
  };

  const toggleCajaActiva = (caja: CajaChica) => {
    if (cajaActiva === caja.id) { setCajaActiva(null); return; }
    const conf = getCajaConfig(caja);
    setCajaActiva(caja.id);
    if (!conf.monedasPermitidas.includes(movForm.moneda)) setMovForm(p => ({ ...p, moneda: conf.monedasPermitidas[0] }));
  };

  // ─── HANDLER: ENTREGA ADM → CEO ──────────────────────────────────────────

  const cajaEfectivo    = useMemo(() => cajas.find(c => getCajaConfig(c).esCajaEfectivo), [cajas]);                // legacy
  const cajaEfectivoADM = useMemo(() => cajas.find(c => getCajaConfig(c).efectivoRol === 'ADM') ?? null, [cajas]);  // [NEW v16.4]
  const cajaEfectivoCEO = useMemo(() => cajas.find(c => getCajaConfig(c).efectivoRol === 'CEO') ?? null, [cajas]);  // [NEW v16.4]
  const efectivoDual    = !!cajaEfectivoADM && !!cajaEfectivoCEO;
  const saldoEfectivoADM = useMemo(() =>
    cajaEfectivoADM ? getCajaBalance(cajaEfectivoADM.id, 'CASH') : cajaEfectivo ? getSubcajaBalance(cajaEfectivo.id, 'ADM') : 0,
  [cajaEfectivoADM, cajaEfectivo, getCajaBalance, getSubcajaBalance]);
  const saldoEfectivoCEO = useMemo(() =>
    cajaEfectivoCEO ? getCajaBalance(cajaEfectivoCEO.id, 'CASH') : cajaEfectivo ? getSubcajaBalance(cajaEfectivo.id, 'CEO') : 0,
  [cajaEfectivoCEO, cajaEfectivo, getCajaBalance, getSubcajaBalance]);

  /**
   * Entrega de efectivo ADM → CEO. Solo mueve custodia: la bóveda CASH no cambia.
   * [CHG v16.4] Dual: transferencia enlazada (transfer_id) EFECTIVO ADMIN → EFECTIVO CEO.
   *             Legacy: SALIDA subcaja ADM + ENTRADA subcaja CEO en la misma caja.
   */
  const handleEntregaCEO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!efectivoDual && !cajaEfectivo) { alert('No se encontraron las cajas de efectivo ADMIN y CEO.'); return; }
    const monto = round2(parseFloat(entregaCEOForm.monto));
    if (isNaN(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!entregaCEOForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    if (monto > saldoEfectivoADM && !window.confirm(`⚠️ ADM solo tiene ${fmtMonto(saldoEfectivoADM, 'CASH')} disponible.\n¿Registrar de todas formas?`)) return;

    setSavingCaja(true);
    const concepto = entregaCEOForm.concepto.toUpperCase().trim();
    const fecha    = isoDe(entregaCEOForm.fecha);

    if (efectivoDual && cajaEfectivoADM && cajaEfectivoCEO) {   // [NEW v16.4]
      const transferId = uuid4(), salidaId = uuid4();
      const base = { moneda: 'CASH', monto, referencia: `ENTREGA-${genHash(transferId)}`, fecha, registrado_por: userRole, transfer_id: transferId };
      try {
        const { error: e1 } = await supabase.from('movimientos_caja_chica').insert([{
          ...base, id: salidaId, caja_id: cajaEfectivoADM.id, tipo: 'SALIDA', transfer_role: 'SALIDA', transfer_peer_id: cajaEfectivoCEO.id,
          concepto: `ENTREGA A CEO ← ${concepto}`,
        }]);
        if (e1) throw new Error(`ADM Salida: ${e1.message}`);
        const { error: e2 } = await supabase.from('movimientos_caja_chica').insert([{
          ...base, id: uuid4(), caja_id: cajaEfectivoCEO.id, tipo: 'ENTRADA', transfer_role: 'ENTRADA', transfer_peer_id: cajaEfectivoADM.id,
          concepto: `RECIBIDO DE ADM → ${concepto}`,
        }]);
        if (e2) {
          await supabase.from('movimientos_caja_chica').delete().eq('id', salidaId);
          throw new Error(`CEO Entrada: ${e2.message}`);
        }
        setEntregaCEOForm({ monto: '', concepto: '', fecha: hoyISO() });
        setEntregaCEOModal(false);
        await refresh();
      } catch (err) { setCajaError(errMsg(err, 'Error en entrega CEO.')); }
      finally { setSavingCaja(false); }
      return;
    }

    // [PRESERVADO v16.3] modelo legacy: una caja con subcajas
    if (!cajaEfectivo) { setSavingCaja(false); return; }
    const referencia = `ENTREGA-${genHash(entregaCEOForm.concepto + Date.now())}`;
    const base = { caja_id: cajaEfectivo.id, moneda: 'CASH', monto, referencia, fecha, registrado_por: userRole };
    try {
      const { error: e1 } = await supabase.from('movimientos_caja_chica').insert([{ ...base, id: uuid4(), tipo: 'SALIDA', subcaja: 'ADM', concepto: `ENTREGA A CEO ← ${concepto}` }]);
      if (e1) throw new Error(`ADM Salida: ${e1.message}`);
      const { error: e2 } = await supabase.from('movimientos_caja_chica').insert([{ ...base, id: uuid4(), tipo: 'ENTRADA', subcaja: 'CEO', concepto: `RECIBIDO DE ADM → ${concepto}` }]);
      if (e2) {
        await supabase.from('movimientos_caja_chica').delete().eq('referencia', referencia);
        throw new Error(`CEO Entrada: ${e2.message}`);
      }
      setEntregaCEOForm({ monto: '', concepto: '', fecha: hoyISO() });
      setEntregaCEOModal(false);
      await refresh();
    } catch (err) { setCajaError(errMsg(err, 'Error en entrega CEO.')); }
    finally { setSavingCaja(false); }
  };

  // ─── FX DESK (v15) ────────────────────────────────────────────────────────
  //   Bóveda origen −M_o · Caja origen −M_o · Bóveda destino +M_d · Caja destino +M_d. No es ingreso/egreso.

  function openFxDesk(origenPreferido?: PaymentMethod) {
    const origen: PaymentMethod = origenPreferido && origenPreferido !== 'BS' ? origenPreferido : 'USDT';
    setFxError(null);
    setFxForm({
      caja_origen_id: defaultCajaFor(origen), caja_destino_id: defaultCajaFor('BS'),
      subcaja_origen: 'ADM', subcaja_destino: 'ADM', moneda_origen: origen, moneda_destino: 'BS',
      monto_origen: '', tasa: String(tasaBCV), concepto: '', fecha: hoyISO(),
    });
    setFxModalOpen(true);
  }

  const setFxMoneda = (lado: 'ORIGEN' | 'DESTINO', m: PaymentMethod) => setFxForm(p => {
    const next = lado === 'ORIGEN'
      ? { ...p, moneda_origen: m,  caja_origen_id:  ajustarCaja(p.caja_origen_id, m) }
      : { ...p, moneda_destino: m, caja_destino_id: ajustarCaja(p.caja_destino_id, m) };
    const prevBS = p.moneda_origen === 'BS' || p.moneda_destino === 'BS';
    const nextBS = next.moneda_origen === 'BS' || next.moneda_destino === 'BS';
    if (nextBS && !prevBS) next.tasa = String(tasaBCV);
    if (!nextBS && prevBS) next.tasa = '1';
    return next;
  });

  const registrarFxFallback = async (p: FxPayload) => {
    try {
      const { error: eFx } = await supabase.from('fx_registros').insert([{
        id: p.fxId, fecha: p.fechaISO, moneda_origen: p.monedaOrigen, moneda_destino: p.monedaDestino,
        monto_origen: p.montoOrigen, monto_destino: p.montoDestino, tasa: p.tasa,
        concepto: p.concepto, registrado_por: userRole,
        caja_id: p.cajaOrigenId, caja_origen_id: p.cajaOrigenId, caja_destino_id: p.cajaDestinoId,
        subcaja_origen: p.subcajaOrigen, subcaja_destino: p.subcajaDestino, referencia: p.referencia,
      }]);
      if (eFx) throw new Error(`Registro FX: ${eFx.message}`);

      const base = { referencia: p.referencia, fecha: p.fechaISO, registrado_por: userRole, fx_id: p.fxId };
      const movs: Record<string, unknown>[] = [];
      if (p.cajaOrigenId) movs.push({
        ...base, id: uuid4(), caja_id: p.cajaOrigenId, tipo: 'SALIDA', moneda: p.monedaOrigen, monto: p.montoOrigen,
        concepto: `FX VENTA ${p.monedaOrigen}→${p.monedaDestino} · DESTINO ${p.cajaDestinoNombre} · ${p.concepto}`,
        subcaja: p.subcajaOrigen, fx_role: 'SALIDA',
      });
      if (p.cajaDestinoId) movs.push({
        ...base, id: uuid4(), caja_id: p.cajaDestinoId, tipo: 'ENTRADA', moneda: p.monedaDestino, monto: p.montoDestino,
        concepto: `FX COMPRA ${p.monedaDestino}←${p.monedaOrigen} · ORIGEN ${p.cajaOrigenNombre} · ${p.concepto}`,
        subcaja: p.subcajaDestino, fx_role: 'ENTRADA',
      });
      if (movs.length) {
        const { error: eMov } = await supabase.from('movimientos_caja_chica').insert(movs);
        if (eMov) throw new Error(`Cajas FX: ${eMov.message}`);
      }

      const description = `Cambio ${p.monedaOrigen} → ${p.monedaDestino} @ ${p.tasa} · ${p.cajaOrigenNombre} → ${p.cajaDestinoNombre} · ${p.concepto}`;
      const leg = { type: 'FX_EXCHANGE', description, status: 'PAID', category: 'FX', issue_date: p.fechaISO, fx_id: p.fxId };
      const { error: eTx } = await supabase.from('transacciones_finanzas').insert([
        { ...leg, id: uuid4(), entity_name: `FX SALIDA ${p.monedaOrigen}→${p.monedaDestino}`, amount: p.montoOrigen, invoice_number: `${p.referencia}-OUT`, payment_method: p.monedaOrigen, fx_leg: 'OUT' },
        { ...leg, id: uuid4(), entity_name: `FX ENTRADA ${p.monedaDestino}←${p.monedaOrigen}`, amount: p.montoDestino, invoice_number: `${p.referencia}-IN`, payment_method: p.monedaDestino, fx_leg: 'IN' },
      ]);
      if (eTx) throw new Error(`Bóvedas FX: ${eTx.message}`);
    } catch (err) {
      try { await purgeFx(p.fxId, p.referencia); } catch (rb) { console.error('[FX v15] rollback falló:', rb); }
      throw err;
    }
  };

  const handleFX = async (e: React.FormEvent) => {
    e.preventDefault(); setFxError(null);
    const f = fxForm;
    if (f.moneda_origen === f.moneda_destino) { setFxError('Las monedas deben ser distintas.'); return; }
    const montoOrigen = round2(parseFloat(f.monto_origen));
    const tasa        = round4(parseFloat(f.tasa));
    if (!Number.isFinite(montoOrigen) || montoOrigen <= 0) { setFxError('Monto inválido.'); return; }
    if (!Number.isFinite(tasa) || tasa <= 0)               { setFxError('Tasa inválida.'); return; }
    if (!f.concepto.trim())                                { setFxError('Concepto obligatorio.'); return; }
    const montoDestino = computeFxDestino(f.moneda_origen, f.moneda_destino, montoOrigen, tasa);
    if (montoDestino === null || montoDestino <= 0) { setFxError('No se pudo calcular el monto destino.'); return; }

    const cajaO = cajaById(f.caja_origen_id);
    const cajaD = cajaById(f.caja_destino_id);
    if (f.caja_origen_id  && !cajaO) { setFxError('Caja origen no encontrada.'); return; }
    if (f.caja_destino_id && !cajaD) { setFxError('Caja destino no encontrada.'); return; }
    const confO = cajaO ? getCajaConfig(cajaO) : null;
    const confD = cajaD ? getCajaConfig(cajaD) : null;
    if (cajaO && confO && !confO.monedasPermitidas.includes(f.moneda_origen))  { setFxError(`${cajaO.nombre} no opera ${f.moneda_origen}.`); return; }
    if (cajaD && confD && !confD.monedasPermitidas.includes(f.moneda_destino)) { setFxError(`${cajaD.nombre} no opera ${f.moneda_destino}.`); return; }
    const subcajaOrigen  = confO?.esCajaEfectivo ? f.subcaja_origen  : null;
    const subcajaDestino = confD?.esCajaEfectivo ? f.subcaja_destino : null;
    if (!confirmarFondos(f.moneda_origen, montoOrigen, cajaO?.id ?? null, subcajaOrigen)) return;

    const fxId = uuid4();
    const payload: FxPayload = {
      fxId, referencia: `FX-${genHash(fxId)}`, fechaISO: isoDe(f.fecha),
      monedaOrigen: f.moneda_origen, monedaDestino: f.moneda_destino, montoOrigen, montoDestino, tasa,
      concepto: f.concepto.toUpperCase().trim(),
      cajaOrigenId: cajaO?.id ?? null, cajaDestinoId: cajaD?.id ?? null,
      cajaOrigenNombre: cajaO ? cajaO.nombre.toUpperCase() : 'BÓVEDA',
      cajaDestinoNombre: cajaD ? cajaD.nombre.toUpperCase() : 'BÓVEDA',
      subcajaOrigen, subcajaDestino,
    };

    setSavingFX(true);
    try {
      const { error: rpcErr } = await supabase.rpc('fn_registrar_fx', {
        p_fx_id: payload.fxId, p_fecha: payload.fechaISO,
        p_moneda_origen: payload.monedaOrigen, p_moneda_destino: payload.monedaDestino,
        p_monto_origen: payload.montoOrigen, p_monto_destino: payload.montoDestino, p_tasa: payload.tasa,
        p_concepto: payload.concepto, p_referencia: payload.referencia, p_registrado_por: userRole,
        p_caja_origen_id: payload.cajaOrigenId, p_caja_destino_id: payload.cajaDestinoId,
        p_subcaja_origen: payload.subcajaOrigen, p_subcaja_destino: payload.subcajaDestino,
      });
      if (rpcErr) {
        if (!isMissingRpc(rpcErr)) throw new Error(`FX atómico: ${rpcErr.message}`);
        console.warn('[FX v15] RPC fn_registrar_fx no encontrado — usando fallback compensado. Ejecute migracion_finance_v15.sql.');
        await registrarFxFallback(payload);
      }
      setFxForm(p => ({ ...p, monto_origen: '', concepto: '' }));
      setFxModalOpen(false);
      await refresh();
    } catch (err) { setFxError(errMsg(err, 'Error en operación FX.')); }
    finally { setSavingFX(false); }
  };

  const fxMontoDestino = useMemo(() =>
    computeFxDestino(fxForm.moneda_origen, fxForm.moneda_destino, parseFloat(fxForm.monto_origen), parseFloat(fxForm.tasa)),
  [fxForm.monto_origen, fxForm.tasa, fxForm.moneda_origen, fxForm.moneda_destino]);

  // ─── COBRO CxC / PAGO CxP (ABONOS) ────────────────────────────────────────
  //  Cobro CxC: Bóveda +R · Caja +R · CxC −A · horas += h_prom · A / total
  //  Pago CxP : Bóveda −R · Caja −R · CxP −A (préstamo → FINANCING_OUT). A = R en moneda de la cuenta.

  const cuentaDeModal = (m: { tipo: 'CXC' | 'CXP'; cuentaId: string } | null) => ({
    cxc: m?.tipo === 'CXC' ? cuentasCxC.find(x => x.id === m.cuentaId) ?? null : null,
    cxp: m?.tipo === 'CXP' ? cuentas.find(x => x.id === m.cuentaId) ?? null : null,
  });

  const openCobroPago = (tipo: 'CXC' | 'CXP', cuentaId: string) => {
    const { cxc, cxp } = cuentaDeModal({ tipo, cuentaId });
    const c = cxc ?? cxp;
    if (!c) return;
    const moneda = normalizePaymentMethod(c.moneda);
    setCobroError(null);
    setCobroForm({ monto: String(round2(c.monto_pendiente)), moneda, tasa: String(tasaBCV), caja_id: defaultCajaFor(moneda), subcaja: 'ADM', referencia: '', fecha: hoyISO() });
    // [NEW v16.5] pagador sugerido = el alumno de la cuenta (editable si paga un representante)
    setCobroPago(cxc ? pagoDeAlumno(recibidoPor, cxc.student_id, cxc.nombre_alumno) : pagoVacio(recibidoPor));
    setCobroModal({ tipo, cuentaId });
  };

  const setCobroMoneda = (m: PaymentMethod) => {
    const { cxc, cxp } = cuentaDeModal(cobroModal);
    const c = cxc ?? cxp;
    setCobroForm(p => {
      const sugerido = c ? convertirMonto(c.monto_pendiente, normalizePaymentMethod(c.moneda), m, parseFloat(p.tasa)) : null;
      return { ...p, moneda: m, monto: sugerido !== null ? String(sugerido) : p.monto, caja_id: ajustarCaja(p.caja_id, m) };
    });
  };

  const handleCobroPago = async (e: React.FormEvent) => {
    e.preventDefault(); setCobroError(null);
    const { cxc, cxp } = cuentaDeModal(cobroModal);
    const cuenta = cxc ?? cxp;
    if (!cuenta) { setCobroError('Cuenta no encontrada.'); return; }

    const monedaCuenta = normalizePaymentMethod(cuenta.moneda);
    const monto = round2(parseFloat(cobroForm.monto));
    const tasa  = round4(parseFloat(cobroForm.tasa));
    if (!Number.isFinite(monto) || monto <= 0) { setCobroError('Monto inválido.'); return; }
    const aplicado = convertirMonto(monto, cobroForm.moneda, monedaCuenta, tasa);
    if (aplicado === null) { setCobroError('Tasa inválida para convertir entre monedas.'); return; }
    if (aplicado > cuenta.monto_pendiente + 0.01) {
      setCobroError(`Excede el pendiente: aplica ${fmtMonto(aplicado, monedaCuenta)} y resta ${fmtMonto(cuenta.monto_pendiente, monedaCuenta)}.`); return;
    }
    const cajaId  = cobroForm.caja_id || null;
    const cajaErr = validarCajaMoneda(cajaId, cobroForm.moneda);
    if (cajaErr) { setCobroError(cajaErr); return; }
    const cajaObj = cajaById(cajaId);
    const subcaja = cajaEsEfectivo(cajaId) ? cobroForm.subcaja : null;
    if (!cajaObj && !window.confirm('Sin caja: el dinero quedará en bóveda "sin ubicar" (no se sabe quién lo custodia). ¿Continuar?')) return;
    if (cxc) {   // [NEW v16.5] todo cobro exige pagador
      const errPago = validarPago(cobroPago, cobroForm.moneda);
      if (errPago) { setCobroError(errPago); return; }
    }
    if (cxp && !confirmarFondos(cobroForm.moneda, monto, cajaId, subcaja)) return;

    const comun = {
      moneda: cobroForm.moneda, monto, fechaISO: isoDe(cobroForm.fecha), cajaId, subcaja, registradoPor: userRole,
      referenciaExterna: (cxc ? cobroPago.referencia_pago : cobroForm.referencia).toUpperCase().trim() || undefined,
    };
    const abono: AsientoAbonoInput = {
      cuenta_tipo: cxc ? 'CXC' : 'CXP', cuenta_id: String(cuenta.id), monto: aplicado, moneda_cuenta: monedaCuenta,
      monto_origen: monto, moneda_origen: cobroForm.moneda, tasa: requiereTasa(cobroForm.moneda, monedaCuenta) ? tasa : null,
    };

    setSavingCobro(true);
    try {
      if (cxc) {
        await postAsiento(buildFlujo({
          ...comun, evento: 'COBRO_CXC', dir: 'IN', ledgerType: 'INCOME',
          concepto: `${cxc.concepto || 'COBRO'} · ${cxc.nombre_alumno}`.toUpperCase(),
          entityName: cxc.nombre_alumno, entityId: cxc.student_id, category: 'Academia',
          abonos: [abono], meta: { student_serial: cxc.student_serial }, pago: cobroPago,
        }));
        setRecibidoPor(cobroPago.recibido_por.trim().toUpperCase());
      } else if (cxp) {
        const esPrest = cxp.entidad_tipo === 'PRESTAMISTA';
        await postAsiento(buildFlujo({
          ...comun, evento: esPrest ? 'PRESTAMO_DEVOLUCION' : 'PAGO_CXP', dir: 'OUT',
          ledgerType: esPrest ? 'FINANCING_OUT' : 'EXPENSE',
          concepto: `${cxp.concepto || 'PAGO'} · ${cxp.entidad_nombre}`.toUpperCase(),
          entityName: cxp.entidad_nombre, entityId: cxp.proveedor_id ?? null,
          category: esPrest ? 'Financiamiento' : 'Proveedores',
          esPrestamo: esPrest, prestamista: PRESTAMISTAS.find(p => esCxpPrestamista(cxp, p)) ?? null,
          abonos: [abono],
        }));
      }
      setCobroModal(null);
      await refresh();
    } catch (err) { setCobroError(errMsg(err, 'Error al registrar.')); }
    finally { setSavingCobro(false); }
  };

  // ─── PRÉSTAMO EXTERNO ─────────────────────────────────────────────────────
  // Recibido = FINANCING_IN + caja ENTRADA + CxP nueva. Devolución = FINANCING_OUT + caja SALIDA + abonos FIFO.

  const prestamosPendientes = useCallback((p: Prestamista, m: PaymentMethod) =>
    cuentas.filter(c => esCxpPrestamista(c, p) && c.moneda === m && c.estatus !== 'PAGADO' && c.monto_pendiente > 0)
      .sort((a, b) => String(a.fecha_emision).localeCompare(String(b.fecha_emision))),
  [cuentas]);

  /** Abre préstamo en modo devolución desde la caja de custodia (compensación) */
  const openCompensacion = (p: Prestamista, m: PaymentMethod, monto: number, cajaId: string) => {
    setCajaError(null);
    setPrestamoForm({ prestamista: p, caja_id: cajaId, moneda: m, monto: String(round2(monto)), concepto: 'COMPENSACIÓN CUSTODIA → PRÉSTAMO', fecha: hoyISO(), es_devolucion: true, subcaja: 'ADM', cuenta_id: '' });
    setPrestamoModal(true);
  };

  const handlePrestamo = async (e: React.FormEvent) => {
    e.preventDefault(); setCajaError(null);
    const f = prestamoForm;
    if (!f.caja_id) { setCajaError('Selecciona la caja receptora.'); return; }
    const monto = round2(parseFloat(f.monto));
    if (isNaN(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!f.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    const cajaErr = validarCajaMoneda(f.caja_id, f.moneda);
    if (cajaErr) { setCajaError(cajaErr); return; }
    const cajaObj  = cajaById(f.caja_id);
    const subcaja  = cajaEsEfectivo(f.caja_id) ? f.subcaja : null;
    const fechaISO = isoDe(f.fecha);
    const concepto = f.concepto.toUpperCase().trim();
    // [NEW v16.5] préstamo recibido: el pagador es el prestamista
    const pagoPrest: PagoForm = { ...prestamoPago, pagador_tipo: 'PRESTAMISTA', pagador_nombre: f.prestamista, alumno_id: '' };
    if (!f.es_devolucion) {
      const errPago = validarPago(pagoPrest, f.moneda);
      if (errPago) { setCajaError(errPago); return; }
    }

    const abonosDev: AsientoAbonoInput[] = [];
    if (f.es_devolucion) {
      const objetivo = f.cuenta_id ? cuentas.filter(c => c.id === f.cuenta_id) : prestamosPendientes(f.prestamista, f.moneda);
      let resto = monto;
      for (const c of objetivo) {
        const a = round2(Math.min(resto, c.monto_pendiente));
        if (a > 0) abonosDev.push({ cuenta_tipo: 'CXP', cuenta_id: String(c.id), monto: a, moneda_cuenta: c.moneda, monto_origen: a, moneda_origen: f.moneda, tasa: null });
        resto = round2(resto - a);
        if (resto <= 0) break;
      }
      if (resto > 0.01) { setCajaError(`La devolución excede la deuda registrada con ${f.prestamista} en ${f.moneda} por ${fmtMonto(resto, f.moneda)}.`); return; }
      if (!confirmarFondos(f.moneda, monto, f.caja_id, subcaja)) return;
    }

    setSavingCaja(true);
    try {
      const comun = {
        dir: (f.es_devolucion ? 'OUT' : 'IN') as 'IN' | 'OUT', moneda: f.moneda, monto, fechaISO, category: 'Financiamiento',
        cajaId: f.caja_id, subcaja, registradoPor: userRole, esPrestamo: true, prestamista: f.prestamista,
      };
      try {
        await postAsiento(buildFlujo(f.es_devolucion
          ? { ...comun, evento: 'PRESTAMO_DEVOLUCION', ledgerType: 'FINANCING_OUT', concepto: `DEVOLUCIÓN A ${f.prestamista} · ${concepto}`, entityName: `DEVOLUCIÓN ${f.prestamista}`, abonos: abonosDev }
          : {
              ...comun, evento: 'PRESTAMO_RECIBIDO', ledgerType: 'FINANCING_IN', concepto: `PRÉSTAMO DE ${f.prestamista} · ${concepto}`, entityName: `PRÉSTAMO ${f.prestamista}`,
              nuevasCxp: [{
                id: uuid4(), entidad_nombre: `DEVOLUCIÓN A ${f.prestamista}`, entidad_tipo: 'PRESTAMISTA', proveedor_id: null,
                moneda: f.moneda, monto_total: monto, concepto: `Préstamo recibido de ${f.prestamista} · ${concepto}`,
                fecha_emision: fechaISO, fecha_vencimiento: null, notas: `Caja: ${cajaObj?.nombre ?? '—'}`, prestamista: f.prestamista,
              }],
              referenciaExterna: pagoPrest.referencia_pago.trim().toUpperCase() || undefined,
              pago: pagoPrest,
            }));
      } catch (err) {
        if (!(err instanceof MotorNoInstaladoError)) throw err;
        // [PRESERVADO v15] ruta legacy (solo caja + CxP)
        const refPrestamo = `PREST-${genHash(f.prestamista + Date.now())}`;
        const { error: eM } = await supabase.from('movimientos_caja_chica').insert([{
          id: uuid4(), caja_id: f.caja_id, tipo: f.es_devolucion ? 'SALIDA' : 'ENTRADA', moneda: f.moneda, monto,
          concepto: f.es_devolucion ? `DEVOLUCIÓN A ${f.prestamista} · ${concepto}` : `PRÉSTAMO DE ${f.prestamista} · ${concepto}`,
          referencia: refPrestamo, fecha: fechaISO, registrado_por: userRole, es_prestamo: true, prestamista: f.prestamista,
        }]);
        if (eM) throw new Error(eM.message);
        if (!f.es_devolucion) {
          const { error: eCxP } = await supabase.from('cuentas_generales').insert([{
            tipo: 'CXP', entidad_nombre: `DEVOLUCIÓN A ${f.prestamista}`, entidad_tipo: 'PRESTAMISTA', moneda: f.moneda,
            monto_total: monto, monto_pendiente: monto, concepto: `Préstamo recibido de ${f.prestamista} · ${concepto}`,
            fecha_emision: fechaISO, estatus: 'PENDIENTE', notas: `Ref: ${refPrestamo}`,
          }]);
          if (eCxP) console.warn('[v16] CxP de préstamo falló (no bloquea):', eCxP.message);
        }
      }
      setPrestamoForm(p => ({ ...p, monto: '', concepto: '', cuenta_id: '' }));
      if (!f.es_devolucion) setPrestamoPago(pagoRegistrado(pagoPrest, { pagador_tipo: 'PRESTAMISTA' }));
      setPrestamoModal(false);
      await refresh();
    } catch (err) { setCajaError(errMsg(err, 'Error en préstamo externo.')); }
    finally { setSavingCaja(false); }
  };

  // ─── TRANSFERENCIA ENTRE CAJAS ────────────────────────────────────────────
  // Movimiento interno de custodia: la bóveda no cambia. Reposición CxP opcional (fondo fijo).

  const handleTransferencia = async (e: React.FormEvent) => {
    e.preventDefault(); setTransferError(null);
    const f = transferForm;
    if (!f.caja_origen_id)  { setTransferError('Selecciona la caja de origen.'); return; }
    if (!f.caja_destino_id) { setTransferError('Selecciona la caja de destino.'); return; }
    if (f.caja_origen_id === f.caja_destino_id) { setTransferError('Origen y destino iguales.'); return; }
    const monto = round2(parseFloat(f.monto));
    if (isNaN(monto) || monto <= 0) { setTransferError('Monto inválido.'); return; }
    if (!f.concepto.trim()) { setTransferError('Concepto obligatorio.'); return; }
    const cajaOrigen  = cajaById(f.caja_origen_id);
    const cajaDestino = cajaById(f.caja_destino_id);
    if (!cajaOrigen || !cajaDestino) { setTransferError('Caja no encontrada.'); return; }
    const errMon = validarCajaMoneda(cajaOrigen.id, f.moneda) ?? validarCajaMoneda(cajaDestino.id, f.moneda);
    if (errMon) { setTransferError(`${errMon} · Para cambiar de moneda use FX Desk.`); return; }
    const saldoOrigen = getCajaBalance(f.caja_origen_id, f.moneda);
    if (saldoOrigen < monto && !window.confirm(`⚠️ Saldo insuficiente en ${cajaOrigen.nombre}\n\nDisponible: ${fmtMonto(saldoOrigen, f.moneda)}\nTransferir: ${fmtMonto(monto, f.moneda)}\n\n¿Continuar?`)) return;

    setSavingTransfer(true);
    const transferId = uuid4(), salidaId = uuid4(), entradaId = uuid4();
    const referencia = `TRF-${genHash(transferId)}`;
    const concepto   = f.concepto.toUpperCase().trim();
    const base = { moneda: f.moneda, monto, referencia, fecha: isoDe(f.fecha), registrado_por: userRole, transfer_id: transferId };
    try {
      const { error: e1 } = await supabase.from('movimientos_caja_chica').insert([{
        ...base, id: salidaId, caja_id: f.caja_origen_id, tipo: 'SALIDA', transfer_role: 'SALIDA', transfer_peer_id: f.caja_destino_id,
        concepto: `TRANSFERENCIA → ${cajaDestino.nombre.toUpperCase()} · ${concepto}`,
      }]);
      if (e1) throw new Error(`Salida: ${e1.message}`);
      const { error: e2 } = await supabase.from('movimientos_caja_chica').insert([{
        ...base, id: entradaId, caja_id: f.caja_destino_id, tipo: 'ENTRADA', transfer_role: 'ENTRADA', transfer_peer_id: f.caja_origen_id,
        concepto: `TRANSFERENCIA ← ${cajaOrigen.nombre.toUpperCase()} · ${concepto}`,
      }]);
      if (e2) {
        await supabase.from('movimientos_caja_chica').delete().eq('id', salidaId);
        throw new Error(`Entrada: ${e2.message}`);
      }
      if (f.generar_reposicion) {
        const { error: e3 } = await supabase.from('cuentas_generales').insert([{
          tipo: 'CXP', entidad_nombre: `REPOSICIÓN CAJA ${cajaOrigen.nombre.toUpperCase()}`, entidad_tipo: 'INTERNO',
          moneda: f.moneda, monto_total: monto, monto_pendiente: monto,
          concepto: `Reposición por transferencia a ${cajaDestino.nombre.toUpperCase()} · ${concepto}`,
          fecha_emision: base.fecha, estatus: 'PENDIENTE', notas: `Ref: ${referencia}`,
          transfer_id: transferId, categoria_interna: 'REPOSICION_CAJA',
        }]);
        if (e3) {
          await supabase.from('movimientos_caja_chica').delete().in('id', [salidaId, entradaId]);
          throw new Error(`Reposición: ${e3.message}`);
        }
      }
      setTransferForm({ ...TRANSFER_INIT, fecha: hoyISO() });
      setTransferModalOpen(false);
      await refresh();
    } catch (err) { setTransferError(errMsg(err, 'Error en transferencia.')); }
    finally { setSavingTransfer(false); }
  };

  // ─── REPOSICIÓN ───────────────────────────────────────────────────────────
  // Reponer = mover custodia (saldo sin ubicar o caja fuente → caja original). NO es egreso.

  const openPagarReposicion = (cuenta: CuentaGeneral) => {
    setPagarReposicionMoneda(cuenta.moneda);
    setPagarReposicionFuente('');
    setPagarReposicionModal(cuenta);
  };

  const confirmarPagoReposicion = async () => {
    if (!pagarReposicionModal) return;
    const cuenta = pagarReposicionModal;
    const moneda = pagarReposicionMoneda;
    if (!cuenta.transfer_id) { alert('Sin transferencia asociada. Use flujo normal de CxP.'); return; }
    setSavingAction(cuenta.id);
    const revertir = () => supabase.from('cuentas_generales').update({ estatus: 'PENDIENTE', monto_pendiente: cuenta.monto_total }).eq('id', cuenta.id);
    try {
      const salida = movCajas.find(m => m.transfer_id === cuenta.transfer_id && m.transfer_role === 'SALIDA');
      if (!salida) throw new Error('Movimiento original no encontrado.');
      const cajaOrig = cajaById(salida.caja_id);
      if (!cajaOrig) throw new Error('Caja origen no encontrada.');
      const errMon = validarCajaMoneda(cajaOrig.id, moneda);
      if (errMon) throw new Error(errMon);
      const fuente = cajaById(pagarReposicionFuente);
      if (fuente) {
        if (fuente.id === cajaOrig.id) throw new Error('La caja fuente no puede ser la misma caja a reponer.');
        const errF = validarCajaMoneda(fuente.id, moneda);
        if (errF) throw new Error(errF);
      } else {
        const sinU = sinUbicar(moneda);
        if (sinU < cuenta.monto_total && !window.confirm(`⚠️ Solo hay ${fmtMonto(sinU, moneda)} sin ubicar en bóveda ${moneda}. ¿Reponer de todas formas?`)) return;
      }
      const referencia = `REP-${genHash(cuenta.id)}`;
      const base = { moneda, monto: cuenta.monto_total, referencia, fecha: new Date().toISOString(), registrado_por: userRole };

      const { error: eU } = await supabase.from('cuentas_generales').update({ estatus: 'PAGADO', monto_pendiente: 0 }).eq('id', cuenta.id);
      if (eU) throw new Error(`CxP reposición: ${eU.message}`);   // [FIX v16.1]
      const { error: eE } = await supabase.from('movimientos_caja_chica').insert([{
        ...base, id: uuid4(), caja_id: cajaOrig.id, tipo: 'ENTRADA', transfer_id: cuenta.transfer_id,
        concepto: `REPOSICIÓN ${fuente ? `DESDE ${fuente.nombre.toUpperCase()}` : 'DESDE BÓVEDA'} · ${cuenta.concepto}`,
      }]);
      if (eE) { await revertir(); throw new Error(`Entrada a caja: ${eE.message}`); }
      if (fuente) {
        const { error: eS } = await supabase.from('movimientos_caja_chica').insert([{
          ...base, id: uuid4(), caja_id: fuente.id, tipo: 'SALIDA',
          concepto: `REPOSICIÓN → ${cajaOrig.nombre.toUpperCase()} · ${cuenta.concepto}`,
        }]);
        if (eS) {
          await supabase.from('movimientos_caja_chica').delete().eq('referencia', referencia);
          await revertir();
          throw new Error(`Salida caja fuente: ${eS.message}`);
        }
      }
      setPagarReposicionModal(null);
      await refresh();
    } catch (err) { alert('Error: ' + errMsg(err, String(err))); }
    finally { setSavingAction(null); }
  };

  // ─── ELIMINAR TRANSFERENCIA ───────────────────────────────────────────────

  function openDeleteTransferModal(transferId: string) {
    const salida     = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'SALIDA') ?? null;
    const entrada    = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'ENTRADA') ?? null;
    const reposicion = cuentas.find(c => c.transfer_id === transferId && c.categoria_interna === 'REPOSICION_CAJA') ?? null;
    setDeleteTransferModal({
      transferId, salida, entrada, reposicion,
      cajaOrigenNombre:  cajaById(salida?.caja_id)?.nombre  ?? '—',
      cajaDestinoNombre: cajaById(entrada?.caja_id)?.nombre ?? '—',
    });
    setDeleteTransferSelection({ salida: !!salida, entrada: !!entrada, reposicion: !!reposicion });
  }

  const confirmDeleteTransferSelection = () => {
    if (!deleteTransferModal) return;
    const { salida, entrada, reposicion } = deleteTransferModal;
    const sel = deleteTransferSelection;
    requireDirectorCode(async () => {
      setSavingAction('transfer-delete');
      try {
        const borrar = async (tabla: string, id: string) => {
          const { error } = await supabase.from(tabla).delete().eq('id', id);
          if (error) throw new Error(error.message);
        };
        if (sel.salida     && salida)     await borrar('movimientos_caja_chica', salida.id);
        if (sel.entrada    && entrada)    await borrar('movimientos_caja_chica', entrada.id);
        if (sel.reposicion && reposicion) await borrar('cuentas_generales', reposicion.id);
        setDeleteTransferModal(null);
        await refresh();
      } catch (err) { alert('Error al eliminar: ' + errMsg(err, String(err))); }
      finally { setSavingAction(null); }
    });
  };

  // ─── HANDLER: CUENTAS ─────────────────────────────────────────────────────

  const resetCuentaForm = (extra: Partial<typeof cuentaForm>) => {
    setCuentaForm(p => ({ ...p, ...extra }));
    setShowCuentaForm(false);
  };

  const handleCuenta = async (e: React.FormEvent) => {
    e.preventDefault(); setCuentaError(null);
    const f = cuentaForm;

    if (f.tipo === 'HORAS_PAGADAS' || f.tipo === 'CXC') {
      const horas = parseFloat(f.horas_prometidas);
      const monto = round2(parseFloat(f.monto_total));
      if (!f.alumno_student_id)       { setCuentaError('Selecciona un alumno.'); return; }
      if (isNaN(horas) || horas <= 0) { setCuentaError('Horas inválidas.'); return; }
      if (isNaN(monto) || monto <= 0) { setCuentaError('Monto inválido.'); return; }
      if (!f.concepto.trim())         { setCuentaError('Concepto requerido.'); return; }
      const alumno = alumnos.find(a => a.student_id === f.alumno_student_id);
      if (!alumno) { setCuentaError('Alumno no encontrado.'); return; }
      const esPagado = f.tipo === 'HORAS_PAGADAS';

      // cuentas de horas denominadas en USD; si el método es BS se convierte a tasa
      const mp = normalizePaymentMethod(f.moneda_pago);
      const monedaCuenta: PaymentMethod = mp === 'BS' ? 'USDT' : mp;
      const monedaCuentaDB = mp === 'BS' ? 'USD' : f.moneda_pago;
      const tasa     = round4(parseFloat(f.tasa));
      const recibido = convertirMonto(monto, monedaCuenta, mp, tasa);
      if (esPagado && recibido === null) { setCuentaError('Tasa inválida para cobro en BS.'); return; }
      const cajaId  = esPagado ? (f.caja_id || null) : null;
      const cajaErr = validarCajaMoneda(cajaId, mp);
      if (cajaErr) { setCuentaError(cajaErr); return; }
      const cajaObj  = cajaById(cajaId);
      const subcaja  = cajaEsEfectivo(cajaId) ? f.subcaja : null;
      const concepto = f.concepto.toUpperCase().trim();
      const limpiar  = { alumno_student_id: '', horas_prometidas: '', monto_total: '', concepto: '' };
      if (esPagado) {   // [NEW v16.5] horas pagadas = ingreso → exige pagador
        const errPago = validarPago(cuentaPago, mp);
        if (errPago) { setCuentaError(errPago); return; }
      }

      setSavingCuenta(true);
      try {
        // HORAS_PAGADAS vía motor: CxC nueva + abono total + bóveda + caja en 1 asiento
        if (esPagado && recibido !== null) {
          const cxcId = uuid4();
          try {
            await postAsiento(buildFlujo({
              evento: 'HORAS_PAGADAS', dir: 'IN', ledgerType: 'INCOME', moneda: mp, monto: recibido,
              fechaISO: isoDe(f.fecha_emision), concepto: `HORAS PAGADAS · ${concepto}`,
              entityName: alumno.nombre, entityId: alumno.student_id, category: 'Academia',
              cajaId, subcaja, registradoPor: userRole,
              nuevasCxc: [{
                id: cxcId, student_id: alumno.student_id, alumno_id: alumno.student_id,
                nombre_alumno: alumno.nombre, student_serial: alumno.serial,
                monto_total: monto, horas_prometidas: horas, concepto, fecha_emision: f.fecha_emision, moneda: monedaCuentaDB,
              }],
              abonos: [{ cuenta_tipo: 'CXC', cuenta_id: cxcId, monto, moneda_cuenta: monedaCuenta, monto_origen: recibido, moneda_origen: mp, tasa: requiereTasa(mp, monedaCuenta) ? tasa : null }],
              meta: { horas, student_serial: alumno.serial },
              referenciaExterna: cuentaPago.referencia_pago.trim().toUpperCase() || undefined,
              pago: cuentaPago,
            }));
            setCuentaPago(pagoRegistrado(cuentaPago));
            resetCuentaForm(limpiar);
            await refresh();
            return;
          } catch (err) {
            // con pagador el motor v2 nunca lanza MotorNoInstaladoError → un pago nunca queda sin pagador
            if (!(err instanceof MotorNoInstaladoError) || cajaObj) throw err;
          }
        }

        // [PRESERVADO v15] ruta legacy (CXC pendiente siempre; HORAS_PAGADAS sin motor)
        const { data, error } = await supabase.from('cuentas_por_cobrar').insert([{
          student_id: alumno.student_id, alumno_id: alumno.student_id, nombre_alumno: alumno.nombre, student_serial: alumno.serial,
          monto_total: monto, monto_pagado: esPagado ? monto : 0, monto_pendiente: esPagado ? 0 : monto,
          horas_prometidas: horas, horas_compradas: esPagado ? horas : 0,
          concepto, fecha_emision: f.fecha_emision, moneda: monedaCuentaDB, estatus: esPagado ? 'COBRADO' : 'PENDIENTE',
        }]).select('id').single();
        if (error) { setCuentaError(`Error: ${error.message}`); return; }
        if (esPagado) {
          if (!data?.id) throw new Error('No se obtuvo ID de la cuenta creada.');
          const { error: txError } = await supabase.from('transacciones_finanzas').insert([{
            id: uuid4(), type: 'INCOME', entity_id: alumno.student_id, entity_name: alumno.nombre,
            amount: recibido ?? monto, invoice_number: `HORA-${String(data.id)}`,
            description: `HORAS PAGADAS · ${concepto}`, status: 'PAID', category: 'Academia',
            payment_method: mp, issue_date: isoDe(f.fecha_emision),
          }]);
          if (txError) {
            await supabase.from('cuentas_por_cobrar').delete().eq('id', data.id);
            throw new Error(`Ingreso Ledger: ${txError.message}`);
          }
        }
        resetCuentaForm(limpiar);
        await refresh();
      } catch (err) { setCuentaError(errMsg(err, 'Error de conexión.')); }
      finally { setSavingCuenta(false); }
      return;
    }

    // ── CXP ──
    const num = round2(parseFloat(f.monto_total));
    if (isNaN(num) || num <= 0)   { setCuentaError('Monto inválido.'); return; }
    if (!f.entidad_nombre.trim()) { setCuentaError('Nombre de entidad requerido.'); return; }
    if (!f.concepto.trim())       { setCuentaError('Concepto requerido.'); return; }
    setSavingCuenta(true);
    try {
      const { error } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP', entidad_nombre: f.entidad_nombre.toUpperCase().trim(), entidad_tipo: f.entidad_tipo,
        proveedor_id: f.proveedor_id || null, moneda: f.moneda, monto_total: num, monto_pendiente: num,
        concepto: f.concepto.toUpperCase().trim(), fecha_emision: isoDe(f.fecha_emision),
        fecha_vencimiento: f.fecha_vencimiento ? isoDe(f.fecha_vencimiento) : null,
        estatus: 'PENDIENTE', notas: f.notas || null,
      }]);
      if (error) { setCuentaError(`Error: ${error.message}`); return; }
      resetCuentaForm({ entidad_nombre: '', concepto: '', monto_total: '', notas: '', proveedor_id: '', fecha_vencimiento: '' });
      await refresh();
    } catch (err) { setCuentaError(errMsg(err, 'Error de conexión.')); }
    finally { setSavingCuenta(false); }
  };

  /** "Cobrar"/"Pagar" abre el modal que asienta bóveda + caja + abono. Reposiciones siguen su flujo. */
  const handlePagarCuenta = (id: string, esCxC: boolean) => {
    if (savingAction) return;
    const cuenta = esCxC ? null : cuentas.find(c => c.id === id);
    if (cuenta?.categoria_interna === 'REPOSICION_CAJA') { openPagarReposicion(cuenta); return; }
    openCobroPago(esCxC ? 'CXC' : 'CXP', id);
  };

  // ─── REQUISICIONES ────────────────────────────────────────────────────────

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setReqError(null);
    const num = round2(parseFloat(reqAmount));
    if (!reqItems.trim() || isNaN(num) || num <= 0) { setReqError('Completa el detalle y el costo.'); return; }
    setSavingReq(true);
    try {
      const { error } = await supabase.from('solicitudes_compra').insert([{
        prioridad: reqPriority, items: JSON.stringify({ description: reqItems.toUpperCase(), estimated_cost: num }),
        estatus: 'PENDIENTE_REVISION', hash_auditoria: genHash(reqItems + reqAmount + Date.now()),
      }]);
      if (error) { setReqError(`Error: ${error.message}`); return; }
      setReqItems(''); setReqAmount('');
      await refresh();
    } catch (err) { setReqError(errMsg(err, 'Error de conexión.')); }
    finally { setSavingReq(false); }
  };

  /** Aprobar crea una CxP real; el dinero sale al pagarla */
  const handleApproveReq = async (reqId: string, amount: number, desc: string) => {
    if (savingAction) return;
    setSavingAction(reqId); setReqError(null);
    try {
      const { error: eCxp } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP', entidad_nombre: 'PROVEEDOR (REQUISICIÓN)', entidad_tipo: 'LIBRE', moneda: 'USDT',
        monto_total: round2(amount), monto_pendiente: round2(amount), concepto: `[OK] ${desc}`,
        fecha_emision: new Date().toISOString(), estatus: 'PENDIENTE', notas: `OC-${genHash('APPROVE' + reqId)} · Req ${reqId}`,
      }]);
      if (eCxp) throw new Error(`CxP: ${eCxp.message}`);
      const { error: eReq } = await supabase.from('solicitudes_compra').update({ estatus: 'APROBADO', aprobado_por: userRole }).eq('id', reqId);
      if (eReq) throw new Error(`Requisición: ${eReq.message}`);
      await refresh();
    } catch (err) { setReqError(errMsg(err, 'Error al aprobar.')); }
    finally { setSavingAction(null); }
  };

  const handleRejectReq = async (reqId: string) => {
    if (savingAction) return;
    setSavingAction(reqId);
    try {
      const { error } = await supabase.from('solicitudes_compra').update({ estatus: 'RECHAZADO', aprobado_por: userRole }).eq('id', reqId);
      if (error) throw new Error(error.message);
      await refresh();
    } catch (err) { setReqError(errMsg(err, 'Error al rechazar.')); }
    finally { setSavingAction(null); }
  };

  // ─── EXPORTS ──────────────────────────────────────────────────────────────

  const filaMovCaja = (m: MovimientoCaja) => [fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2), `"${m.concepto || ''}"`, `"${m.referencia || ''}"`];

  /** [NEW v16.5] columnas de pagador para los CSV */
  const PAGO_COLS = ['Pagador', 'Tipo pagador', 'Cédula/RIF', 'Ref. pago', 'Cuenta origen', 'Recibido por', 'Registrado por'];
  const filaPago = (asientoId?: string | null) => {
    const pg = asientoId ? pagoPorAsiento.get(asientoId) : undefined;
    return pg ? [`"${pg.pagador_nombre}"`, pg.pagador_tipo, pg.pagador_documento ?? '—', pg.referencia_pago ?? '—',
      `"${pg.cuenta_origen ?? '—'}"`, `"${pg.recibido_por}"`, pg.registrado_por_email ?? '—'] : PAGO_COLS.map(() => '—');
  };

  const handleExportCSV = () => downloadCSV([
    ['Fecha', 'Ref', 'Entidad', 'Metodo', 'Monto', 'Tipo', 'Estatus', 'Pata FX', 'Asiento', 'Monto con signo', ...PAGO_COLS],
    ...transactions.map(t => [
      fmtDate(t.issueDate), t.invoiceNumber, `"${t.entityName}"`, String(t.payment_method || 'N/A'),
      String(t.amount), String(t.type), String(t.status), t.fx_leg || '—', t.asiento_id || '—', String(signedLedgerAmount(t)),
      ...filaPago(t.asiento_id),
    ]),
  ], `FinanzasAguilas_${hoyISO()}.csv`);

  const handleExportCajaIndividual = (cajaId: string) => {
    const caja = cajaById(cajaId); if (!caja) return;
    downloadCSV([
      [`CAJA: ${caja.nombre.toUpperCase()}`], [`Exportado: ${new Date().toLocaleDateString('es-VE')}`], [],
      ['Fecha', 'Tipo', 'Moneda', 'Monto', 'Concepto', 'Referencia', 'Por', 'Subcaja', 'Préstamo', 'Prestamista', 'FX', 'Asiento', ...PAGO_COLS],
      ...movCajas.filter(m => m.caja_id === cajaId).map(m => [...filaMovCaja(m), m.registrado_por || 'Sistema',
        m.subcaja || '—', m.es_prestamo ? 'SÍ' : 'NO', m.prestamista || '—', m.fx_id ? 'SÍ' : 'NO', m.asiento_id || '—', ...filaPago(m.asiento_id)]),
    ], `Caja_${caja.nombre.replace(/\s+/g, '_')}_${hoyISO()}.csv`);
  };

  const handleExportCajasExcel = () => {
    const all: string[][] = [[`CAJAS CHICAS · ${new Date().toLocaleDateString('es-VE')}`], []];
    cajas.forEach(caja => {
      all.push([`CAJA: ${caja.nombre.toUpperCase()}`], ['Fecha', 'Tipo', 'Moneda', 'Monto', 'Concepto', 'Referencia', 'Subcaja', 'Prestamista', 'FX', 'Asiento', ...PAGO_COLS]);
      movCajas.filter(m => m.caja_id === caja.id).forEach(m => all.push([...filaMovCaja(m), m.subcaja || '—', m.prestamista || '—', m.fx_id ? 'SÍ' : 'NO', m.asiento_id || '—', ...filaPago(m.asiento_id)]));
      all.push([]);
    });
    downloadCSV(all, `Cajas_${hoyISO()}.csv`);
  };

  // ─── LOADING ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-20 text-center bg-[#020202] h-screen flex flex-col justify-center items-center">
      <Loader2 className="h-12 w-12 text-[#E1AD01] animate-spin mb-6" />
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core v16.5...</p>
    </div>
  );

  // ─── RENDER HELPERS ───────────────────────────────────────────────────────

  const ledgerCajaEfe = cajaEsEfectivo(ledger.caja_id);
  /** [NEW v16.5] filtro del Libro Mayor: entidad, factura, descripción, pagador, cédula, referencia, receptor */
  const qLedger = ledgerQuery.trim().toUpperCase();
  const txFiltradas = !qLedger ? transactions : transactions.filter(t => {
    const pg = t.asiento_id ? pagoPorAsiento.get(t.asiento_id) : undefined;
    return [t.entityName, t.invoiceNumber, t.description, pg?.pagador_nombre, pg?.pagador_documento, pg?.referencia_pago, pg?.recibido_por, pg?.cuenta_origen]
      .some(v => String(v ?? '').toUpperCase().includes(qLedger));
  });
  const btnIcon = 'opacity-0 group-hover:opacity-100 text-zinc-600 transition-all p-1.5 rounded-lg disabled:opacity-30';

  /** Fila del Libro Mayor (Diario y auditoría de Bóvedas) */
  const renderTx = (t: LedgerTx, mode: 'DIARIO' | 'BOVEDA') => {
    const s = signedLedgerAmount(t), fx = isFxTx(t), fin = isFinancingTx(t), legacy = esReposicionLegacy(t);
    const movLig = t.asiento_id ? movCajas.find(m => m.asiento_id === t.asiento_id) : null;
    const busy   = savingAction === t.id || (!!t.fx_id && savingAction === t.fx_id) || (!!t.asiento_id && savingAction === t.asiento_id);
    const color  = fx ? (s >= 0 ? 'text-teal-300' : 'text-teal-600') : fin ? (s >= 0 ? 'text-violet-300' : 'text-violet-500') : (s >= 0 ? 'text-emerald-400' : 'text-red-400');
    const border = legacy ? 'border-red-500/30' : fx ? 'border-teal-500/15' : fin ? 'border-violet-500/15' : 'border-white/[0.05]';
    const pm     = t.payment_method as PaymentMethod;
    const pagoTx = t.asiento_id ? pagoPorAsiento.get(t.asiento_id) : undefined;   // [NEW v16.5]
    return (
      <div key={t.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group hover:bg-white/[0.04] transition-all ${border}`}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase flex items-center gap-2">
            {fx && <Badge tone={TONE.fx}>FX {t.fx_leg ?? 'LEGACY'}</Badge>}
            {fin && <Badge tone={TONE.fin}>FINANC.</Badge>}
            {legacy && <Badge tone={TONE.red}>REPOSICIÓN LEGACY</Badge>}
            {t.asiento_id && <Badge tone={TONE.asiento} title="Asiento enlazado (bóveda + caja + cuentas)"><Link2 size={8} /> ASIENTO</Badge>}
            <span className="truncate">{t.entityName}</span>
          </p>
          <p className="text-[8px] text-zinc-600 font-mono mt-0.5 truncate">
            {mode === 'BOVEDA' ? <>{fmtDate(t.issueDate)} · {t.description}</> : <>
              {fmtDate(t.issueDate)} · {t.invoiceNumber} · <span className={MONEDA_COLOR[pm] || 'text-zinc-500'}>{String(t.payment_method)}</span>
              {t.asiento_id && <> · <span className="text-zinc-500">{movLig ? `CAJA ${cajaNombre(movLig.caja_id)}${movLig.subcaja ? ` (${movLig.subcaja})` : ''}` : 'SIN CAJA'}</span></>}
            </>}
          </p>
          {pagoTx && <p className="text-[8px] text-[#E1AD01]/80 font-mono mt-0.5 truncate" title={lineaPago(pagoTx)}>{lineaPago(pagoTx)}</p>}
        </div>
        <div className="flex items-center gap-3 ml-4">
          <span className={`font-black text-lg italic ${color}`}>{s >= 0 ? '+' : '-'}{fmtMonto(t.amount, pm)}</span>
          {mode === 'DIARIO' && <CheckCircle2 className={`h-4 w-4 shrink-0 ${t.status === 'PAID' ? 'text-emerald-500/40' : 'text-zinc-700'}`} />}
          {mode === 'DIARIO' && !t.fx_id && !t.asiento_id && (
            <button onClick={() => openEditTx(t)} className={`${btnIcon} hover:text-[#E1AD01] hover:bg-[#E1AD01]/10`}><Pencil size={13} /></button>
          )}
          <button onClick={() => deleteTxProtected(t.id)} disabled={busy} title={t.asiento_id ? 'Anular asiento completo' : 'Eliminar'}
            className={`${btnIcon} hover:text-red-500 hover:bg-red-500/10`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : t.asiento_id ? <Ban size={13} /> : <Trash2 size={13} />}
          </button>
        </div>
      </div>
    );
  };

  /** Chips de saldo ADM / CEO de la caja efectivo */
  const chipsEfectivo = (
    <>
      {([['ADM', saldoEfectivoADM, TONE.blue, 'bg-blue-400'], ['CEO', saldoEfectivoCEO, TONE.yellow, 'bg-yellow-400']] as const).map(([sc, saldo, tone, dot]) => (
        <div key={sc} className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 ${tone}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          <span className="text-[8px] font-black uppercase">{sc}</span>
          <span className={`text-[10px] font-black italic ${saldo >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{fmtMonto(saldo, 'CASH')}</span>
        </div>
      ))}
    </>
  );

  const TABS: { key: TabType; label: string; icon: LucideIcon }[] = [
    { key: 'LEDGER', label: 'Diario', icon: Landmark }, { key: 'BÓVEDAS', label: 'Bóvedas', icon: Coins },
    { key: 'CAJAS', label: 'Cajas', icon: Banknote }, { key: 'CUENTAS', label: 'CxC/CxP', icon: ReceiptText },
    { key: 'REQUISITIONS', label: 'Reqs', icon: FileSignature }, { key: 'CLOSING', label: 'Cierre', icon: Lock },
  ];

  const KPI_CUENTAS = [
    { label: 'Por Cobrar (Alumnos)', value: `$${fmtNum(totalCxC)}`, sub: `${cxcPendientes.length} pendientes · USD eq.`, icon: ArrowUpCircle, card: 'bg-yellow-500/5 border-yellow-500/10', txt: 'text-yellow-400', ico: 'text-yellow-400/20' },
    { label: 'Horas Acreditadas', value: `${totalHorasAcred.toFixed(1)}h`, sub: `${horasPagadas.length} pagados · incluye parciales`, icon: Plane, card: 'bg-emerald-500/5 border-emerald-500/10', txt: 'text-emerald-400', ico: 'text-emerald-400/20' },
    { label: 'Por Pagar (Proveedores + Préstamos)', value: `$${fmtNum(totalCxP)}`, sub: `${cuentasProveedores.filter(c => c.estatus !== 'PAGADO').length} pendientes · USD eq.`, icon: ArrowDownCircle, card: 'bg-orange-500/5 border-orange-500/10', txt: 'text-orange-400', ico: 'text-orange-400/20' },
    { label: 'Reposiciones Internas', value: `$${fmtNum(totalReposiciones)}`, sub: `${cuentasReposiciones.filter(c => c.estatus !== 'PAGADO').length} entre cajas`, icon: ArrowLeftRight, card: 'bg-purple-500/5 border-purple-500/10', txt: 'text-purple-400', ico: 'text-purple-400/20' },
  ];

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">Valkyron Financial Core v16.5</p>
            <p className="text-[7px] text-[#E1AD01]/60 font-black uppercase tracking-[0.25em] mt-1">Motor de asientos · Bóveda ↔ Caja ↔ CxC/CxP en una sola operación</p>
          </div>
          <button onClick={() => refresh()} title="Recargar" className="text-zinc-700 hover:text-[#E1AD01] transition-colors"><RefreshCw size={12} /></button>
        </div>
        <div className="flex flex-wrap gap-1 p-1.5 bg-black/60 rounded-2xl border border-white/5">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${activeTab === key ? 'bg-[#E1AD01] text-black shadow-lg' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* [NEW v16.2] AVISOS DE SESIÓN / CONSULTAS */}
      {sinSesion && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[10px] text-red-400 font-black uppercase">Sesión expirada</p>
            <p className="text-[9px] text-red-300/80 font-mono mt-1">Sin sesión válida la base de datos oculta cajas, movimientos y cuentas. Inicia sesión de nuevo para ver los datos.</p>
          </div>
          <button onClick={reiniciarSesion} className="px-4 py-2 rounded-xl bg-red-500 text-white text-[9px] font-black uppercase hover:bg-red-400 transition-all">Reiniciar sesión</button>
        </div>
      )}
      {fetchErrors.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30">
          <AlertTriangle size={14} className="text-orange-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-orange-400 font-black uppercase">{fetchErrors.length} consulta{fetchErrors.length === 1 ? '' : 's'} con error</p>
            {fetchErrors.map(e => <p key={e} className="text-[9px] text-orange-300/80 font-mono mt-1 break-words">{e}</p>)}
          </div>
          <button onClick={() => refresh()} title="Reintentar" className="text-orange-400 hover:text-white transition-colors"><RefreshCw size={12} /></button>
        </div>
      )}

      {/* KPI BÓVEDAS — operativos vs no operativos (FX + financiamiento) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ALL_METHODS.map(m => {
          const paid  = transactions.filter(t => t.payment_method === m && t.status === 'PAID' && !isNonOperativeTx(t));
          const ing   = paid.filter(t => signedLedgerAmount(t) > 0).reduce((a, t) => round2(a + t.amount), 0);
          const egr   = paid.filter(t => signedLedgerAmount(t) < 0).reduce((a, t) => round2(a + t.amount), 0);
          const saldo = getVaultBalance(m);
          const fxNet = round2(saldo - ing + egr);
          const fmt   = (n: number) => `${prefijo(m)} ${fmtNum(n)}`;
          return (
            <div key={m} className={`${glass} ${MONEDA_BG[m]} rounded-2xl p-5 border space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{m}</span>
                <span className={`text-[7px] font-black px-2 py-1 rounded-full border ${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`}>{saldo >= 0 ? 'POSITIVO' : 'NEGATIVO'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([['Ingresado', fmt(ing), 'text-emerald-400'], ['Egresado', fmt(egr), 'text-red-400'],
                   ['FX / Financ.', `${fxNet >= 0 ? '+' : '−'}${fmt(Math.abs(fxNet))}`, fxNet >= 0 ? 'text-teal-400' : 'text-teal-600']] as const).map(([l, v, c]) => (
                  <div key={l}><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">{l}</p><p className={`font-black text-[11px] italic ${c}`}>{v}</p></div>
                ))}
              </div>
              <div className="border-t border-white/5 pt-2 text-center">
                <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Saldo Neto</p>
                <p className={`font-black text-base italic ${saldo >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>{fmt(saldo)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* CAJA EFECTIVO — PANEL ADM/CEO */}
      {(efectivoDual || cajaEfectivo) && (
        <div className={`${glass} bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center"><Banknote className="text-yellow-400 h-4 w-4" /></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400">Caja Efectivo — Trazabilidad</p>
                <p className="text-[8px] text-zinc-600 font-mono">{efectivoDual ? `${cajaEfectivoADM?.nombre} → ${cajaEfectivoCEO?.nombre}` : 'Administración → Custodia CEO'}</p>
              </div>
            </div>
            <button onClick={() => setEntregaCEOModal(true)}
              className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-yellow-500/20 transition-all flex items-center gap-2">
              <ArrowLeftRight size={12} /> Entregar a CEO
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {([['Stand-By · Administración', saldoEfectivoADM, 'bg-blue-400', 'Pendiente de entrega a CEO', 'border-yellow-500/10'],
               ['Custodia · CEO', saldoEfectivoCEO, 'bg-yellow-400', 'En caja de los directores', 'border-yellow-500/20']] as const).map(([l, s, dot, sub, bd]) => (
              <div key={l} className={`bg-black/30 rounded-xl p-4 border ${bd}`}>
                <div className="flex items-center gap-2 mb-2"><div className={`w-2 h-2 rounded-full ${dot}`} /><p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">{l}</p></div>
                <p className={`text-xl font-black italic ${s >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{fmtMonto(s, 'CASH')}</p>
                <p className="text-[8px] text-zinc-600 font-mono mt-1">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI CUENTAS — USD equivalente */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPI_CUENTAS.map(({ label, value, sub, icon: Icon, card, txt, ico }) => (
          <div key={label} className={`${glass} ${card} border rounded-2xl p-4 flex items-center justify-between`}>
            <div>
              <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">{label}</p>
              <p className={`${txt} font-black text-lg italic`}>{value}</p>
              <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{sub}</p>
            </div>
            <Icon className={`${ico} h-9 w-9`} />
          </div>
        ))}
      </div>

      {/* ══ TAB: DIARIO ══════════════════════════════════════════════════════ */}
      {activeTab === 'LEDGER' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center gap-3 mb-7">
              <Calculator className="text-[#E1AD01] h-4 w-4" />
              <h2 className="text-[10px] font-black uppercase tracking-widest">Registrar Movimiento</h2>
            </div>
            <form onSubmit={handleLedger} className="space-y-4">
              <input type="date" required value={ledger.fecha} onChange={e => setLedger(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
              <div className="grid grid-cols-2 gap-3">
                <select value={ledger.type} className={inp} onChange={e => {
                  const v = e.target.value as TransactionType;
                  if (v === 'FX_EXCHANGE') { openFxDesk(ledger.currency); return; }
                  setLedger(p => ({ ...p, type: v }));
                }}>
                  <option value="INCOME">INGRESO (+)</option>
                  <option value="EXPENSE">EGRESO (-)</option>
                  <option value="INSTRUCTOR_PAY">NÓMINA</option>
                  <option value="FX_EXCHANGE">FX CAMBIO → FX DESK</option>
                </select>
                <select value={ledger.currency} className={inp}
                  onChange={e => { const m = e.target.value as PaymentMethod; setLedger(p => ({ ...p, currency: m, caja_id: ajustarCaja(p.caja_id, m) })); }}>
                  {ALL_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              {ledger.type === 'INSTRUCTOR_PAY' && (
                <select value={ledger.capitanId} onChange={e => setLedger(p => ({ ...p, capitanId: e.target.value }))} className={inp}>
                  <option value="">— CAPITÁN —</option>
                  {capitanes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <div>
                <Lbl cls="text-zinc-600">{ledger.type === 'INCOME' ? 'Caja donde entra el dinero' : 'Caja de donde sale el dinero'}</Lbl>
                <select value={ledger.caja_id} onChange={e => setLedger(p => ({ ...p, caja_id: e.target.value }))} className={inp} disabled={savingLedger}>
                  <option value="">SOLO BÓVEDA · queda sin ubicar</option>
                  {cajasQueAceptan(ledger.currency).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              {ledgerCajaEfe && <SubcajaToggle value={ledger.subcaja} onChange={sc => setLedger(p => ({ ...p, subcaja: sc }))} />}
              {ledger.type === 'INCOME' && <PagadorFields value={ledgerPago} onChange={setLedgerPago} moneda={ledger.currency} alumnos={alumnos} />}
              <AmountInput size="xl" value={ledger.amount} moneda={ledger.currency} prefixCls="text-[#E1AD01]" disabled={savingLedger}
                onChange={v => setLedger(p => ({ ...p, amount: v }))} />
              <input value={ledger.reference} onChange={e => setLedger(p => ({ ...p, reference: e.target.value }))} placeholder="REFERENCIA / TRAZABILIDAD" className={inp} disabled={savingLedger} />
              <p className="text-[8px] text-zinc-600 font-mono">Cobros de alumnos y pagos a proveedores se registran desde CxC/CxP para que rebajen la cuenta.</p>
              <ErrorBanner msg={ledgerError} onClose={() => setLedgerError(null)} />
              <button type="submit" disabled={savingLedger}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                {savingLedger ? <><Loader2 className="animate-spin h-4 w-4" />Sellando...</> : 'Sellar Registro'}
              </button>
            </form>
          </div>

          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Libro Mayor</h3>
              <div className="flex gap-2 items-center">
                <input value={ledgerQuery} onChange={e => setLedgerQuery(e.target.value)} placeholder="BUSCAR PAGADOR · CÉDULA · REF"
                  className="bg-black/50 border border-white/10 px-3 py-2 rounded-xl text-[9px] font-mono text-white outline-none focus:border-[#E1AD01]/60 w-44 uppercase placeholder:text-white/20" />
                <button onClick={() => openFxDesk()} className="bg-teal-500/10 text-teal-400 px-4 py-2 rounded-xl border border-teal-500/20 text-[9px] font-black uppercase hover:bg-teal-500/20 flex items-center gap-2 transition-all">
                  <TrendingUp size={11} /> FX Desk
                </button>
                <button onClick={handleExportCSV} className="bg-[#E1AD01]/10 text-[#E1AD01] px-4 py-2 rounded-xl border border-[#E1AD01]/20 text-[9px] font-black uppercase hover:bg-[#E1AD01] hover:text-black flex items-center gap-2 transition-all">
                  <Download size={11} /> CSV
                </button>
              </div>
            </div>

            {fxRegistros.length > 0 && (
              <div className="px-4 pt-4">
                <p className="text-[8px] text-teal-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1"><TrendingUp size={10} /> Operaciones FX recientes</p>
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {fxRegistros.slice(0, 8).map(fx => (
                    <div key={fx.id} className="bg-teal-500/5 border border-teal-500/10 p-3 rounded-xl flex justify-between items-center group">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase text-teal-400 flex items-center gap-2">
                          {fx.moneda_origen} → {fx.moneda_destino}
                          {!transactions.some(t => t.fx_id === fx.id && !!t.fx_leg) && <Badge tone={TONE.red}>LEGACY · anular y re-registrar</Badge>}
                        </p>
                        <p className="text-[8px] text-zinc-500 font-mono truncate">
                          {cajaNombre(fx.caja_origen_id)}{fx.subcaja_origen ? ` (${fx.subcaja_origen})` : ''} → {cajaNombre(fx.caja_destino_id)}{fx.subcaja_destino ? ` (${fx.subcaja_destino})` : ''}
                        </p>
                        <p className="text-[8px] text-zinc-600 font-mono truncate">{fmtDate(fx.fecha)} · {fx.referencia ?? '—'} · {fx.concepto}</p>
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <div className="text-right">
                          <p className="text-[10px] font-black italic text-white whitespace-nowrap">{fmtMonto(fx.monto_origen, fx.moneda_origen)} → {fmtMonto(fx.monto_destino, fx.moneda_destino)}</p>
                          <p className="text-[8px] text-zinc-600 font-mono">@ {fx.tasa}</p>
                        </div>
                        <button onClick={() => anularFX(fx.id)} disabled={savingAction === fx.id} title="Anular FX completo" className={`${btnIcon} hover:text-red-500 hover:bg-red-500/10`}>
                          {savingAction === fx.id ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2 mt-2">
              {txFiltradas.map(t => renderTx(t, 'DIARIO'))}
              {txFiltradas.length === 0 && <EmptyState icon={Activity} text={ledgerQuery ? 'Sin coincidencias' : 'Sin movimientos registrados'} py="py-16" />}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: BÓVEDAS ════════════════════════════════════════════════════ */}
      {activeTab === 'BÓVEDAS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-6">
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 italic"><Wallet className="text-[#E1AD01] h-4 w-4" /> Bóvedas Principales</h3>
              <div className="space-y-3">
                {ALL_METHODS.map(curr => {
                  const active = selectedVault === curr;
                  return (
                    <button key={curr} onClick={() => setSelectedVault(curr)}
                      className={`w-full p-5 rounded-2xl flex justify-between items-center border transition-all ${active ? `${MONEDA_BG[curr]} ${MONEDA_COLOR[curr]}` : 'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white hover:bg-white/[0.04]'}`}>
                      <div className="flex items-center gap-3">
                        <Coins className={`h-4 w-4 ${active ? '' : 'text-zinc-700'}`} />
                        <span className="font-black uppercase tracking-widest text-[10px]">{curr}</span>
                      </div>
                      <span className={`font-mono font-black text-lg italic ${active ? '' : 'text-zinc-400'}`}>{fmtMonto(getVaultBalance(curr), curr)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2 italic"><Scale className="text-teal-400 h-4 w-4" /> Conciliación Bóveda ↔ Cajas</h3>
              <p className="text-[8px] text-zinc-600 font-mono mb-5">Bóveda = posición total por moneda. Cajas = dónde está físicamente. La diferencia es saldo aún no ubicado en una caja; se ubica con un movimiento de clase UBICACIÓN.</p>
              <div className="space-y-2">
                {conciliacion.map(({ m, boveda, enCajas, sinAsignar }) => {
                  const cuadra = Math.abs(sinAsignar) <= 0.01;
                  return (
                    <div key={m} className={`rounded-xl border p-3 ${MONEDA_BG[m]}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className={`text-[9px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                        <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${cuadra ? 'bg-emerald-500/10 text-emerald-400' : sinAsignar < 0 ? 'bg-red-500/10 text-red-400' : 'bg-white/5 text-zinc-400'}`}>
                          {cuadra ? 'Cuadrado' : sinAsignar < 0 ? 'Cajas > Bóveda' : 'Sin ubicar'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {([['Bóveda', boveda, ''], ['En cajas', enCajas, ''], ['Diferencia', sinAsignar, sinAsignar < -0.01 ? 'text-red-400' : '']] as const).map(([l, v, c]) => (
                          <div key={l}><p className="text-[7px] text-zinc-600 font-black uppercase">{l}</p><p className={`text-[10px] font-black italic ${c}`}>{fmtMonto(v, m)}</p></div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {reposicionesLegacyLedger.length > 0 && (
                <div className="mt-4 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                  <p className="text-[9px] text-red-400 font-black uppercase flex items-center gap-2"><AlertTriangle size={11} /> {reposicionesLegacyLedger.length} reposiciones legacy como egreso</p>
                  <p className="text-[8px] text-zinc-500 font-mono mt-1">
                    Versiones anteriores registraron reposiciones internas como EXPENSE ({ALL_METHODS.map(m => {
                      const tot = reposicionesLegacyLedger.filter(t => t.payment_method === m).reduce((a, t) => round2(a + t.amount), 0);
                      return tot > 0 ? fmtMonto(tot, m) : null;
                    }).filter(Boolean).join(' · ')}). Elimínelas en esta vista (categoría "Reposición Interna") para corregir la bóveda.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Auditoría Bóveda: <span className={MONEDA_COLOR[selectedVault]}>{selectedVault}</span></h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[720px] p-4 space-y-2">
              {transactions.filter(t => t.payment_method === selectedVault).map(t => renderTx(t, 'BOVEDA'))}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CAJAS ══════════════════════════════════════════════════════ */}
      {activeTab === 'CAJAS' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">{cajas.length} cajas operativas</p>
            <div className="flex gap-2 flex-wrap">
              {([
                { l: 'FX Desk',          icon: TrendingUp,     cls: 'bg-teal-500/10 text-teal-400 border-teal-500/20 hover:bg-teal-500/20',          on: () => openFxDesk() },
                { l: 'Préstamo Externo', icon: HandCoins,      cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20',  on: () => { setCajaError(null); setPrestamoModal(true); } },
                { l: 'Transferir',       icon: ArrowLeftRight, cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20',  on: () => setTransferModalOpen(true) },
                { l: 'Exportar',         icon: Download,       cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20', on: handleExportCajasExcel },
              ] as { l: string; icon: LucideIcon; cls: string; on: () => void }[]).map(({ l, icon: Icon, cls, on }) => (
                <button key={l} onClick={on} className={`${cls} border px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2`}>
                  <Icon size={13} /> {l}
                </button>
              ))}
            </div>
          </div>

          {/* [NEW v16.4] MATRIZ CAJAS ↔ BÓVEDAS: Σ cajas + sin ubicar = bóveda, por moneda */}
          {cajas.length > 0 && (
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2"><Scale className="text-teal-400 h-4 w-4" /> Cajas ↔ Bóvedas</h3>
                <p className="text-[8px] text-zinc-600 font-mono">Cada monto existe una sola vez: en una caja o sin ubicar dentro de su bóveda</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-zinc-600 text-[8px] uppercase tracking-widest">
                      <th className="text-left font-black p-3">Caja</th>
                      {ALL_METHODS.map(m => <th key={m} className={`text-right font-black p-3 ${MONEDA_COLOR[m]}`}>{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cajas.map(c => {
                      const conf = getCajaConfig(c);
                      return (
                        <tr key={c.id} className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer" onClick={() => toggleCajaActiva(c)}>
                          <td className="p-3 font-black uppercase truncate max-w-[180px]">{c.nombre}</td>
                          {ALL_METHODS.map(m => {
                            if (!conf.monedasPermitidas.includes(m)) return <td key={m} className="p-3 text-right text-zinc-800">—</td>;
                            const sv = getCajaBalance(c.id, m);
                            return <td key={m} className={`p-3 text-right font-black italic ${Math.abs(sv) < 0.005 ? 'text-zinc-700' : sv > 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>{fmtMonto(sv, m)}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-white/10 text-[9px]">
                    {([['Σ Cajas', 'enCajas', 'text-white'], ['Sin ubicar', 'sinAsignar', 'text-zinc-400'], ['Bóveda', 'boveda', 'text-[#E1AD01]']] as const).map(([l, k, cls]) => (
                      <tr key={k} className="border-t border-white/[0.04]">
                        <td className="p-3 font-black uppercase text-zinc-500">{l}</td>
                        {conciliacion.map(x => (
                          <td key={x.m} className={`p-3 text-right font-black italic ${k === 'sinAsignar' && x.sinAsignar < -0.01 ? 'text-red-400' : cls}`}>{fmtMonto(x[k], x.m)}</td>
                        ))}
                      </tr>
                    ))}
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {cajas.length === 0 && (
            <EmptyState icon={Banknote} py="py-16"
              text={sinSesion ? 'Sesión expirada · inicia sesión para ver las cajas' : 'Sin cajas visibles · verifique la tabla cajas_chicas y sus permisos (RLS)'} />
          )}
          {/* [NEW v16.3] diagnóstico RLS */}
          {cajas.length === 0 && diagRls && (
            <div className="bg-black/40 border border-orange-500/20 rounded-2xl p-5 font-mono text-[9px] space-y-1.5">
              <p className="text-orange-400 font-black uppercase tracking-widest text-[10px] mb-2">Diagnóstico de permisos</p>
              <p className="text-zinc-400">Usuario autenticado: <span className="text-white">{diagRls.email}</span></p>
              <p className="text-zinc-400 break-all">auth.uid(): <span className="text-white">{diagRls.uid}</span></p>
              <p className="text-zinc-400">es_staff_finanzas(): <span className={diagRls.staff ? 'text-emerald-400' : 'text-red-400'}>{diagRls.error ? 'ERROR' : String(diagRls.staff)}</span></p>
              {diagRls.error && <p className="text-red-400 break-words">{diagRls.error}</p>}
              <p className="text-zinc-500 pt-2 border-t border-white/5">
                {diagRls.error
                  ? 'La función es_staff_finanzas() no existe en este proyecto: ejecute la migración de cajas + RLS.'
                  : diagRls.staff
                    ? 'El usuario sí es staff: la tabla cajas_chicas está vacía en este proyecto o su política no usa es_staff_finanzas(). Revise los registros y pg_policies.'
                    : 'Este usuario no es staff: su fila en perfiles_estudiantes no existe o su role no está en la lista de la función.'}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cajas.map(caja => {
              const active     = cajaActiva === caja.id;
              const conf       = getCajaConfig(caja);
              const monedas    = conf.monedasPermitidas.map(m => ({ m, s: getCajaBalance(caja.id, m) })).filter(x => x.s !== 0);
              const esCustodia = conf.tipo === 'CUSTODIA_TERCERO';
              const Icon       = conf.esCajaEfectivo || conf.efectivoRol ? Banknote : esCustodia ? UserCheck : Coins;
              return (
                <button key={caja.id} onClick={() => toggleCajaActiva(caja)}
                  className={`${glass} rounded-2xl p-5 text-left border transition-all ${active ? 'border-[#E1AD01]/50 bg-[#E1AD01]/5' : esCustodia ? 'border-violet-500/20 hover:border-violet-500/40' : 'border-white/[0.07] hover:border-white/20'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${active ? 'bg-[#E1AD01] text-black' : esCustodia ? 'bg-violet-500/10 text-violet-400' : 'bg-white/5 text-zinc-600'}`}><Icon size={15} /></div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {conf.monedasPermitidas.length === 1 && <Badge tone={`${MONEDA_BG[conf.monedasPermitidas[0]]} ${MONEDA_COLOR[conf.monedasPermitidas[0]]}`}>{conf.monedasPermitidas[0]} ONLY</Badge>}
                      {esCustodia && <Badge tone={TONE.fin}>CUSTODIA {conf.prestamista ?? 'TERCERO'}</Badge>}
                      {conf.efectivoRol && <Badge tone={conf.efectivoRol === 'CEO' ? TONE.yellow : TONE.blue}>{conf.efectivoRol === 'CEO' ? 'CUSTODIA CEO' : 'STAND-BY ADM'}</Badge>}
                      {active && <span className="text-[7px] text-[#E1AD01] font-black uppercase tracking-widest">Activa</span>}
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest mb-3">{caja.nombre}</p>
                  {conf.esCajaEfectivo ? (
                    <div className="space-y-1.5">
                      {([['ADM', saldoEfectivoADM, 'text-blue-400', 'bg-blue-400'], ['CEO', saldoEfectivoCEO, 'text-yellow-400', 'bg-yellow-400']] as const).map(([sc, s, tc, dot]) => (
                        <div key={sc} className="flex justify-between items-center">
                          <span className={`text-[8px] ${tc} font-black uppercase flex items-center gap-1`}><div className={`w-1.5 h-1.5 rounded-full ${dot}`} /> {sc}</span>
                          <span className={`text-[9px] font-black italic ${s >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{fmtMonto(s, 'CASH')}</span>
                        </div>
                      ))}
                    </div>
                  ) : monedas.length > 0 ? (
                    <div className="space-y-1.5">
                      {monedas.map(({ m, s }) => (
                        <div key={m} className="flex justify-between items-center">
                          <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                          <span className={`text-[10px] font-black italic ${s >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>{fmtMonto(s, m)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[9px] text-zinc-700 font-mono italic">Sin movimientos</p>}
                </button>
              );
            })}
          </div>

          {cajaActiva && (() => {
            const caja = cajaById(cajaActiva);
            if (!caja) return null;
            const conf = getCajaConfig(caja);
            const movs = movCajas.filter(m => m.caja_id === cajaActiva);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic">Caja: <span className="text-[#E1AD01]">{caja.nombre}</span></h3>
                  <form onSubmit={handleMovCaja} className="space-y-4">
                    <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                      {(['ENTRADA', 'SALIDA'] as const).map(tipo => (
                        <button key={tipo} type="button" onClick={() => setMovForm(p => ({ ...p, tipo }))}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${movForm.tipo === tipo ? (tipo === 'ENTRADA' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30') : 'text-zinc-600 hover:text-zinc-400'}`}>
                          {tipo === 'ENTRADA' ? '+ Entrada' : '- Salida'}
                        </button>
                      ))}
                    </div>
                    <div>
                      <Lbl cls="text-zinc-600">Qué es este movimiento</Lbl>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { k: 'OPERATIVO', t: movForm.tipo === 'ENTRADA' ? 'Ingreso real' : 'Gasto real', h: 'Afecta bóveda y caja' },
                          { k: 'UBICACION', t: 'Ubicar saldo', h: 'Solo custodia, bóveda igual' },
                        ] as { k: ClaseMovCaja; t: string; h: string }[]).map(o => (
                          <button key={o.k} type="button" onClick={() => setMovForm(p => ({ ...p, clase: o.k }))}
                            className={`py-2.5 px-3 rounded-xl text-left border transition-all ${movForm.clase === o.k ? 'bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/30' : optOff}`}>
                            <p className="text-[9px] font-black uppercase">{o.t}</p>
                            <p className="text-[7px] opacity-70 normal-case mt-0.5">{o.h}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    {conf.esCajaEfectivo && (
                      <div><Lbl cls="text-zinc-600">Registrar en</Lbl><SubcajaToggle value={movForm.subcaja} onChange={sc => setMovForm(p => ({ ...p, subcaja: sc }))} /></div>
                    )}
                    <div><Lbl cls="text-zinc-600">Moneda</Lbl><MonedaPicker value={movForm.moneda} options={conf.monedasPermitidas} onChange={m => setMovForm(p => ({ ...p, moneda: m }))} /></div>
                    <input type="date" required value={movForm.fecha} onChange={e => setMovForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} disabled={savingCaja} />
                    <AmountInput size="xl" value={movForm.monto} moneda={movForm.moneda} prefixCls="text-[#E1AD01]" disabled={savingCaja} onChange={v => setMovForm(p => ({ ...p, monto: v }))} />
                    <input value={movForm.concepto} onChange={e => setMovForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO *" className={inp} disabled={savingCaja} />
                    {movForm.clase === 'OPERATIVO' && movForm.tipo === 'ENTRADA'
                      ? <PagadorFields value={movPago} onChange={setMovPago} moneda={movForm.moneda} alumnos={alumnos} />
                      : <input value={movForm.referencia} onChange={e => setMovForm(p => ({ ...p, referencia: e.target.value }))} placeholder="REFERENCIA (opcional)" className={inp} disabled={savingCaja} />}
                    <ErrorBanner msg={cajaError} onClose={() => setCajaError(null)} />
                    <button type="submit" disabled={savingCaja}
                      className={`w-full py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${movForm.tipo === 'ENTRADA' ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-red-500 text-white hover:bg-red-400'}`}>
                      {savingCaja ? <Loader2 className="animate-spin h-4 w-4" /> : movForm.tipo === 'ENTRADA' ? '+ Registrar Entrada' : '- Registrar Salida'}
                    </button>
                  </form>
                </div>

                <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
                  <div className="p-6 border-b border-white/5">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[10px] font-black uppercase tracking-widest italic">Historial · {caja.nombre}</h3>
                      <button onClick={() => handleExportCajaIndividual(caja.id)} className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-[8px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-1.5">
                        <Download size={10} /> Exportar
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {conf.esCajaEfectivo ? chipsEfectivo : conf.monedasPermitidas.filter(m => movs.some(mv => mv.moneda === m)).map(m => {
                        const s = getCajaBalance(caja.id, m);
                        return (
                          <div key={m} className={`px-3 py-1.5 rounded-xl border ${MONEDA_BG[m]} flex items-center gap-2`}>
                            <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                            <span className={`text-[10px] font-black italic ${s >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>{fmtMonto(s, m)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2">
                    {movs.map(m => {
                      const fxRec  = m.fx_id ? fxRegistros.find(f => f.id === m.fx_id) : null;
                      const fxPeer = fxRec ? (m.fx_role === 'SALIDA' || m.tipo === 'SALIDA'
                        ? `→ ${cajaNombre(fxRec.caja_destino_id)} · ${fmtMonto(fxRec.monto_destino, fxRec.moneda_destino)} @ ${fxRec.tasa}`
                        : `← ${cajaNombre(fxRec.caja_origen_id)} · ${fmtMonto(fxRec.monto_origen, fxRec.moneda_origen)} @ ${fxRec.tasa}`) : null;
                      const accionPar = m.fx_id ?? m.asiento_id ?? null;
                      const busy      = savingAction === m.id || (!!accionPar && savingAction === accionPar);
                      const border    = m.transfer_id ? 'border-purple-500/20' : m.es_prestamo ? 'border-violet-500/20' : m.fx_id ? 'border-teal-500/20' : m.asiento_id ? 'border-[#E1AD01]/15' : 'border-white/[0.05]';
                      return (
                        <div key={m.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group ${border}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <Badge tone={`${MONEDA_BG[m.moneda]} ${MONEDA_COLOR[m.moneda]}`}>{m.moneda}</Badge>
                              {m.subcaja && <Badge tone={m.subcaja === 'CEO' ? TONE.yellow : TONE.blue}>{m.subcaja}</Badge>}
                              {m.transfer_id && <Badge tone={TONE.purple}><ArrowLeftRight size={8} /> Transferencia</Badge>}
                              {m.es_prestamo && <Badge tone={TONE.fin}><HandCoins size={8} /> {m.prestamista}</Badge>}
                              {m.fx_id && <Badge tone={TONE.fx}><TrendingUp size={8} /> FX</Badge>}
                              {m.asiento_id && <Badge tone={TONE.asiento}><Link2 size={8} /> Asiento</Badge>}
                              <p className="text-[10px] font-black uppercase truncate">{m.concepto || '—'}</p>
                            </div>
                            <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(m.fecha)}{m.referencia ? ` · ${m.referencia}` : ''}</p>
                            {fxPeer && <p className="text-[8px] text-teal-400/70 font-mono mt-0.5">{fxPeer}</p>}
                            {m.asiento_id && pagoPorAsiento.get(m.asiento_id) && (
                              <p className="text-[8px] text-[#E1AD01]/80 font-mono mt-0.5 truncate">{lineaPago(pagoPorAsiento.get(m.asiento_id) as PagoTraza)}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 ml-3">
                            <span className={`font-black text-base italic ${m.tipo === 'ENTRADA' ? 'text-emerald-400' : 'text-red-400'}`}>{m.tipo === 'ENTRADA' ? '+' : '-'}{fmtMonto(m.monto, m.moneda)}</span>
                            {!m.transfer_id && !accionPar && (
                              <button onClick={() => openEditMov(m)} className={`${btnIcon} hover:text-[#E1AD01] hover:bg-[#E1AD01]/10`}><Pencil size={13} /></button>
                            )}
                            <button onClick={() => deleteMovProtected(m.id)} disabled={busy}
                              title={m.fx_id ? 'Anular FX completo' : m.asiento_id ? 'Anular asiento completo' : 'Eliminar'}
                              className={`${btnIcon} hover:text-red-500 hover:bg-red-500/10`}>
                              {busy ? <Loader2 size={13} className="animate-spin" /> : accionPar ? <Ban size={13} /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {movs.length === 0 && <EmptyState icon={Banknote} text="Sin movimientos en esta caja" py="py-16" />}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ TAB: CUENTAS ════════════════════════════════════════════════════ */}
      {activeTab === 'CUENTAS' && (() => {
        const mpForm      = normalizePaymentMethod(cuentaForm.moneda_pago);
        const cajaHoras   = cajaById(cuentaForm.caja_id);
        const cajaHorasEf = cajaEsEfectivo(cuentaForm.caja_id);
        const recibidoHrs = convertirMonto(parseFloat(cuentaForm.monto_total), mpForm === 'BS' ? 'USDT' : mpForm, mpForm, parseFloat(cuentaForm.tasa));
        const esAlumno    = cuentaForm.tipo === 'HORAS_PAGADAS' || cuentaForm.tipo === 'CXC';
        return (
          <div className="space-y-6">
            <div className="flex justify-end">
              <button onClick={() => setShowCuentaForm(!showCuentaForm)} className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
                <PlusCircle size={14} /> Nuevo Registro
              </button>
            </div>

            {showCuentaForm && (
              <div className={`${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01] animate-in slide-in-from-top-4 duration-300`}>
                <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2"><ReceiptText className="text-[#E1AD01] h-4 w-4" /> Registrar</h3>
                <form onSubmit={handleCuenta} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3 flex bg-black/50 rounded-2xl p-1 border border-white/10 gap-1">
                    {([
                      { key: 'HORAS_PAGADAS', label: '✓ Horas Pagadas',     hint: 'Alumno pagó ahora — entra a caja y acredita horas', on: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
                      { key: 'CXC',           label: '⏳ Cuenta por Cobrar', hint: 'Alumno debe — se cobra luego (abonos parciales)',   on: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' },
                      { key: 'CXP',           label: '↙ Cuenta por Pagar',  hint: 'Proveedor / gasto externo',                         on: 'bg-red-500/20 text-red-400 border border-red-500/30' },
                    ] as { key: FormTipo; label: string; hint: string; on: string }[]).map(({ key, label, hint, on }) => (
                      <button key={key} type="button" onClick={() => setCuentaForm(p => ({ ...p, tipo: key }))}
                        className={`flex-1 py-3 px-4 rounded-xl transition-all text-left ${cuentaForm.tipo === key ? on : 'text-zinc-600 hover:text-zinc-400'}`}>
                        <p className="text-[10px] font-black uppercase">{label}</p>
                        <p className="text-[8px] opacity-60 mt-0.5 normal-case font-normal">{hint}</p>
                      </button>
                    ))}
                  </div>

                  {esAlumno && (<>
                    <select required value={cuentaForm.alumno_student_id} className={inp} onChange={e => {
                      const id = e.target.value;
                      const al = alumnos.find(a => a.student_id === id);
                      setCuentaForm(p => ({ ...p, alumno_student_id: id }));
                      // [NEW v16.5] por defecto paga el propio alumno (se puede cambiar a representante / tercero)
                      setCuentaPago(p => (p.pagador_tipo === 'ALUMNO' ? { ...p, alumno_id: id, pagador_nombre: al?.nombre ?? '' } : p));
                    }}>
                      <option value="">— ALUMNO —</option>
                      {alumnos.map(a => <option key={a.student_id} value={a.student_id}>{a.nombre} · {a.sede}</option>)}
                    </select>
                    <input type="number" step="0.5" min="0.5" required value={cuentaForm.horas_prometidas} onChange={e => setCuentaForm(p => ({ ...p, horas_prometidas: e.target.value }))} placeholder="HORAS" className={inp} />
                    <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total} placeholder="PRECIO DEL PAQUETE (USD)" className={inp}
                      onChange={e => setCuentaForm(p => ({ ...p, monto_total: e.target.value }))}
                      onBlur={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setCuentaForm(p => ({ ...p, monto_total: round2(n).toString() })); }} />
                    <input required value={cuentaForm.concepto} onChange={e => setCuentaForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO (ej: PAQUETE 10 HORAS)" className={`${inp} md:col-span-2`} />
                    <input type="date" required value={cuentaForm.fecha_emision} onChange={e => setCuentaForm(p => ({ ...p, fecha_emision: e.target.value }))} className={inp} style={noUpper} />
                    <div className="md:col-span-3">
                      <Lbl>{cuentaForm.tipo === 'HORAS_PAGADAS' ? 'Método con que pagó' : 'Método esperado de pago'}</Lbl>
                      <div className="flex gap-2 flex-wrap">
                        {['USD', 'USDT', 'ZELLE', 'CASH', 'BS'].map(mp => (
                          <button key={mp} type="button" onClick={() => setCuentaForm(p => ({ ...p, moneda_pago: mp, caja_id: ajustarCaja(p.caja_id, normalizePaymentMethod(mp)) }))}
                            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${cuentaForm.moneda_pago === mp ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : 'bg-white/[0.02] border-white/10 text-zinc-600 hover:text-zinc-400'}`}>{mp}</button>
                        ))}
                      </div>
                    </div>
                    {cuentaForm.tipo === 'HORAS_PAGADAS' && (<>
                      <div className="md:col-span-2">
                        <Lbl>Caja que recibió el pago</Lbl>
                        <select value={cuentaForm.caja_id} onChange={e => setCuentaForm(p => ({ ...p, caja_id: e.target.value }))} className={inp}>
                          <option value="">SOLO BÓVEDA · queda sin ubicar</option>
                          {cajasQueAceptan(mpForm).map(c => <option key={c.id} value={c.id}>{c.nombre}{getCajaConfig(c).tipo === 'CUSTODIA_TERCERO' ? ' · custodia' : ''}</option>)}
                        </select>
                      </div>
                      {mpForm === 'BS' ? (
                        <div><Lbl>Tasa (Bs por 1 USD)</Lbl><input type="number" step="0.0001" min="0.0001" value={cuentaForm.tasa} onChange={e => setCuentaForm(p => ({ ...p, tasa: e.target.value }))} className={inp} /></div>
                      ) : <div />}
                      {cajaHorasEf && <SubcajaToggle className="md:col-span-3" value={cuentaForm.subcaja} onChange={sc => setCuentaForm(p => ({ ...p, subcaja: sc }))} />}
                      <PagadorFields className="md:col-span-3" value={cuentaPago} onChange={setCuentaPago} moneda={mpForm} alumnos={alumnos} />
                      {recibidoHrs !== null && (
                        <div className="md:col-span-3 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-3 gap-2 text-[9px] font-mono">
                          <p className="text-emerald-400">+ {fmtMonto(recibidoHrs, mpForm)} · Bóveda {mpForm}</p>
                          <p className={cajaHoras ? 'text-emerald-400' : 'text-zinc-600'}>{cajaHoras ? `+ ${fmtMonto(recibidoHrs, mpForm)} · Caja ${cajaHoras.nombre}${cajaHorasEf ? ` (${cuentaForm.subcaja})` : ''}` : 'Sin caja: saldo sin ubicar'}</p>
                          <p className="text-[#E1AD01]">+ {parseFloat(cuentaForm.horas_prometidas) || 0}h al perfil del alumno</p>
                        </div>
                      )}
                    </>)}
                  </>)}

                  {cuentaForm.tipo === 'CXP' && (<>
                    <select value={cuentaForm.moneda} onChange={e => setCuentaForm(p => ({ ...p, moneda: e.target.value as PaymentMethod }))} className={inp}>
                      {ALL_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select value={cuentaForm.entidad_tipo} className={inp}
                      onChange={e => setCuentaForm(p => ({ ...p, entidad_tipo: e.target.value, entidad_nombre: e.target.value === 'PROVEEDOR' ? '' : p.entidad_nombre, proveedor_id: '' }))}>
                      <option value="LIBRE">Entidad Libre</option>
                      <option value="PROVEEDOR">Proveedor Registrado</option>
                    </select>
                    {cuentaForm.entidad_tipo === 'PROVEEDOR' ? (
                      <select required value={cuentaForm.proveedor_id} className={inp}
                        onChange={e => { const v = vendors.find(x => x.id === e.target.value); setCuentaForm(p => ({ ...p, proveedor_id: e.target.value, entidad_nombre: v?.name || '' })); }}>
                        <option value="">— PROVEEDOR —</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <input required value={cuentaForm.entidad_nombre} onChange={e => setCuentaForm(p => ({ ...p, entidad_nombre: e.target.value }))} placeholder="NOMBRE ENTIDAD" className={inp} />
                    )}
                    <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total} onChange={e => setCuentaForm(p => ({ ...p, monto_total: e.target.value }))} placeholder="MONTO" className={inp} />
                    <input required value={cuentaForm.concepto} onChange={e => setCuentaForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO / DESCRIPCIÓN" className={inp} />
                    <input type="date" required value={cuentaForm.fecha_emision} onChange={e => setCuentaForm(p => ({ ...p, fecha_emision: e.target.value }))} className={inp} style={noUpper} />
                    <input type="date" value={cuentaForm.fecha_vencimiento} onChange={e => setCuentaForm(p => ({ ...p, fecha_vencimiento: e.target.value }))} className={inp} style={noUpper} />
                    <input value={cuentaForm.notas} onChange={e => setCuentaForm(p => ({ ...p, notas: e.target.value }))} placeholder="NOTAS (opcional)" className={inp} />
                    <p className="md:col-span-3 text-[8px] text-zinc-600 font-mono">Los préstamos de Becquer/Roberto se registran en Cajas → Préstamo Externo (crean su CxP y la entrada de dinero en un solo asiento).</p>
                  </>)}

                  <div className="md:col-span-3"><ErrorBanner msg={cuentaError} onClose={() => setCuentaError(null)} /></div>
                  <div className="md:col-span-3 flex gap-3">
                    <button type="submit" disabled={savingCuenta} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                      {savingCuenta ? <Loader2 className="animate-spin h-4 w-4" /> : <><ShieldCheck size={14} /> Sellar</>}
                    </button>
                    <button type="button" onClick={() => { setShowCuentaForm(false); setCuentaError(null); }} className="px-6 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">Cancelar</button>
                  </div>
                </form>
              </div>
            )}

            {!showCuentaForm && <ErrorBanner msg={cuentaError} onClose={() => setCuentaError(null)} />}

            {/* POSICIÓN CON TERCEROS */}
            {posicionTerceros.some(pt => pt.filas.length > 0 || pt.cajasP.length > 0) && (
              <div className={`${glass} rounded-3xl p-6 border border-violet-500/15`}>
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2 mb-1"><Users className="text-violet-400 h-4 w-4" /> Posición con terceros</h3>
                <p className="text-[8px] text-zinc-600 font-mono mb-4">Custodia = dinero de Águilas que el tercero tiene (su caja). Deuda = préstamos pendientes con él. Neto positivo: el tercero debe entregar; negativo: Águilas le debe.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {posicionTerceros.map(({ p, cajasP, filas }) => (
                    <div key={p} className="bg-black/30 rounded-2xl border border-violet-500/10 p-4">
                      <div className="flex justify-between items-center mb-3">
                        <p className="text-[10px] font-black uppercase text-violet-400">{p}</p>
                        <p className="text-[8px] text-zinc-600 font-mono">{cajasP.length ? cajasP.map(c => c.nombre).join(' · ') : 'Sin caja de custodia'}</p>
                      </div>
                      {filas.length === 0 && <p className="text-[9px] text-zinc-700 font-mono italic">Sin custodia ni deuda</p>}
                      <div className="space-y-2">
                        {filas.map(f => (
                          <div key={f.m} className={`rounded-xl border p-3 ${MONEDA_BG[f.m]}`}>
                            <div className="grid grid-cols-4 gap-2 items-center text-center">
                              <span className={`text-[9px] font-black uppercase text-left ${MONEDA_COLOR[f.m]}`}>{f.m}</span>
                              {([['Custodia', f.custodia, ''], ['Deuda', f.deuda, 'text-orange-400'], ['Neto', f.neto, f.neto >= 0 ? 'text-emerald-400' : 'text-red-400']] as const).map(([l, v, c]) => (
                                <div key={l}><p className="text-[7px] text-zinc-600 font-black uppercase">{l}</p><p className={`text-[10px] font-black italic ${c}`}>{fmtMonto(v, f.m)}</p></div>
                              ))}
                            </div>
                            {f.custodia > 0.01 && f.deuda > 0.01 && f.cajaMayor && (
                              <button type="button" onClick={() => openCompensacion(p, f.m, Math.min(f.custodia, f.deuda), f.cajaMayor)}
                                className="mt-2 w-full py-2 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[8px] font-black uppercase hover:bg-violet-500/20 transition-all flex items-center justify-center gap-1">
                                <Repeat size={10} /> Aplicar custodia a la deuda ({fmtMonto(Math.min(f.custodia, f.deuda), f.m)})
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
              {/* CxC Pendientes / Parciales */}
              <div className={`${glass} rounded-3xl overflow-hidden`}>
                <div className="p-5 border-b border-white/5 bg-yellow-500/5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                    <ArrowUpCircle className="text-yellow-400 h-4 w-4" /> Por Cobrar
                    <span className="ml-auto font-mono text-yellow-400 text-[9px]">${fmtNum(totalCxC)}</span>
                  </h3>
                </div>
                <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                  {cxcPendientes.map(c => {
                    const mon = normalizePaymentMethod(c.moneda);
                    const nAb = abonos.filter(a => a.cuenta_tipo === 'CXC' && a.cuenta_id === String(c.id)).length;
                    return (
                      <div key={c.id} className="bg-white/[0.02] border border-yellow-500/10 rounded-2xl p-4 group hover:bg-white/[0.04] transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase truncate">{c.nombre_alumno}</p>
                            <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                            <p className="text-[8px] text-yellow-400/70 font-mono mt-0.5">{c.horas_compradas > 0 ? `${c.horas_compradas}/${c.horas_prometidas}h acreditadas` : `${c.horas_prometidas}h`} · {c.moneda || 'USD'}</p>
                            {c.estatus === 'PARCIAL' && <p className="text-[8px] text-emerald-400/80 font-mono mt-0.5">Pagado {fmtMonto(c.monto_pagado, mon)} · {nAb} abono{nAb === 1 ? '' : 's'}</p>}
                          </div>
                          <div className="text-right ml-2">
                            <p className="font-black italic text-sm text-yellow-400">{fmtMonto(c.monto_pendiente, mon)}</p>
                            {c.estatus === 'PARCIAL' && <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Parcial</span>}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button onClick={() => handlePagarCuenta(c.id, true)} disabled={savingAction === c.id}
                            className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                            {savingAction === c.id ? <Loader2 size={11} className="animate-spin" /> : <><CheckCircle2 size={11} /> Cobrar</>}
                          </button>
                          <button onClick={() => deleteCuentaProtected(c.id, true)} disabled={savingAction === c.id} className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {cxcPendientes.length === 0 && <EmptyState text="Sin deudas pendientes" />}
                </div>
              </div>

              {/* Horas Pagadas */}
              <div className={`${glass} rounded-3xl overflow-hidden`}>
                <div className="p-5 border-b border-white/5 bg-emerald-500/5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                    <Plane className="text-emerald-400 h-4 w-4" /> Horas Pagadas
                    <span className="ml-auto font-mono text-emerald-400 text-[9px]">{totalHorasAcred.toFixed(1)}h</span>
                  </h3>
                </div>
                <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                  {horasPagadas.map(c => (
                    <div key={c.id} className="bg-white/[0.02] border border-emerald-500/10 rounded-2xl p-4 group transition-all hover:bg-white/[0.04]">
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase truncate">{c.nombre_alumno}</p>
                          <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                          <p className="text-[8px] text-emerald-400 font-mono mt-0.5 flex items-center gap-1">
                            <CheckCircle2 size={9} /> {c.horas_compradas}h
                            {c.asiento_origen_id || abonos.some(a => a.cuenta_tipo === 'CXC' && a.cuenta_id === String(c.id))
                              ? <span className="text-[#E1AD01] ml-1 flex items-center gap-0.5"><Link2 size={8} /> asiento</span>
                              : <span className="text-zinc-600 ml-1">legacy</span>}
                          </p>
                        </div>
                        <p className="font-black italic text-sm text-emerald-400 ml-2">{fmtMonto(c.monto_total, normalizePaymentMethod(c.moneda))}</p>
                      </div>
                      {/* [NEW v16.5] quién pagó cada abono de estas horas */}
                      {abonos.filter(a => a.cuenta_tipo === 'CXC' && a.cuenta_id === String(c.id)).map(a => pagoPorAsiento.get(a.asiento_id)).filter((x): x is PagoTraza => !!x).map(pg => (
                        <p key={pg.id} className="text-[8px] text-[#E1AD01]/80 font-mono mt-1 truncate" title={lineaPago(pg)}>{lineaPago(pg)}</p>
                      ))}
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => deleteCuentaProtected(c.id, true)} disabled={savingAction === c.id}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30 text-[8px] font-black uppercase flex items-center gap-1">
                          <Trash2 size={11} /> Anular / Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                  {horasPagadas.length === 0 && <EmptyState text="Sin horas pagadas" />}
                </div>
              </div>

              {/* CxP Proveedores + Préstamos */}
              <div className={`${glass} rounded-3xl overflow-hidden`}>
                <div className="p-5 border-b border-white/5 bg-orange-500/5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                    <ArrowDownCircle className="text-orange-400 h-4 w-4" /> Por Pagar
                    <span className="ml-auto font-mono text-orange-400 text-[9px]">${fmtNum(totalCxP)}</span>
                  </h3>
                </div>
                <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                  {cuentasProveedores.map(c => {
                    const esPrest = c.entidad_tipo === 'PRESTAMISTA';
                    const pagado  = c.estatus === 'PAGADO';
                    return (
                      <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all ${pagado ? 'border-emerald-500/10 opacity-50' : esPrest ? 'border-violet-500/15 hover:bg-white/[0.04]' : 'border-orange-500/10 hover:bg-white/[0.04]'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase truncate flex items-center gap-1.5">{esPrest && <HandCoins size={10} className="text-violet-400 shrink-0" />}{c.entidad_nombre}</p>
                            <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                            {c.estatus === 'PARCIAL' && <p className="text-[8px] text-emerald-400/80 font-mono mt-0.5">Abonado {fmtMonto(round2(c.monto_total - c.monto_pendiente), c.moneda)} de {fmtMonto(c.monto_total, c.moneda)}</p>}
                            {c.fecha_vencimiento && <p className="text-[8px] text-orange-400/70 font-mono mt-0.5">Vence: {fmtDate(c.fecha_vencimiento)}</p>}
                          </div>
                          <div className="text-right ml-2">
                            <p className={`font-black italic text-sm ${pagado ? 'text-emerald-400' : esPrest ? 'text-violet-400' : 'text-orange-400'}`}>{fmtMonto(c.monto_pendiente, c.moneda)}</p>
                            <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${pagado ? 'bg-emerald-500/10 text-emerald-500' : c.estatus === 'PARCIAL' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-orange-500/10 text-orange-500'}`}>{c.estatus}</span>
                          </div>
                        </div>
                        {!pagado && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => handlePagarCuenta(c.id, false)} disabled={savingAction === c.id}
                              className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                              {savingAction === c.id ? <Loader2 size={11} className="animate-spin" /> : <><CheckCircle2 size={11} /> {esPrest ? 'Devolver' : 'Pagar'}</>}
                            </button>
                            <button onClick={() => deleteCuentaProtected(c.id, false)} disabled={savingAction === c.id} className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cuentasProveedores.length === 0 && <EmptyState text="Sin cuentas por pagar" />}
                </div>
              </div>

              {/* Reposiciones Internas */}
              <div className={`${glass} rounded-3xl overflow-hidden border-purple-500/10`}>
                <div className="p-5 border-b border-white/5 bg-purple-500/5">
                  <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                    <ArrowLeftRight className="text-purple-400 h-4 w-4" /> Reposiciones
                    <span className="ml-auto font-mono text-purple-400 text-[9px]">${fmtNum(totalReposiciones)}</span>
                  </h3>
                </div>
                <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                  {cuentasReposiciones.map(c => {
                    const salida  = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'SALIDA');
                    const entrada = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'ENTRADA');
                    const pagado  = c.estatus === 'PAGADO';
                    return (
                      <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all ${pagado ? 'border-emerald-500/10 opacity-60' : 'border-purple-500/10 hover:bg-white/[0.04]'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase truncate">{c.entidad_nombre}</p>
                            {salida && entrada && (
                              <p className="text-[8px] text-purple-400/80 font-mono flex items-center gap-1 mt-0.5">{cajaById(salida.caja_id)?.nombre} <ArrowLeftRight size={8} /> {cajaById(entrada.caja_id)?.nombre}</p>
                            )}
                            <p className="text-[8px] text-zinc-600 font-mono truncate mt-0.5">{c.concepto}</p>
                          </div>
                          <div className="text-right ml-2">
                            <p className={`font-black italic text-sm ${pagado ? 'text-emerald-400' : 'text-purple-400'}`}>{fmtMonto(c.monto_pendiente, c.moneda)}</p>
                            <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${pagado ? 'bg-emerald-500/10 text-emerald-500' : 'bg-purple-500/10 text-purple-400'}`}>{pagado ? 'Repuesta' : 'Pendiente'}</span>
                          </div>
                        </div>
                        {!pagado && (
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => openPagarReposicion(c)} disabled={savingAction === c.id}
                              className="flex-1 py-2 bg-purple-500/20 text-purple-400 rounded-xl text-[9px] font-black uppercase border border-purple-500/20 hover:bg-purple-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                              {savingAction === c.id ? <Loader2 size={11} className="animate-spin" /> : <><Repeat size={11} /> Reponer</>}
                            </button>
                            <button onClick={() => deleteCuentaProtected(c.id, false)} disabled={savingAction === c.id} className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {cuentasReposiciones.length === 0 && <EmptyState icon={ArrowLeftRight} text="Sin reposiciones" />}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══ TAB: REQUISICIONES ══════════════════════════════════════════════ */}
      {activeTab === 'REQUISITIONS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2"><FileSignature className="text-[#E1AD01] h-4 w-4" /> Nueva Requisición</h3>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <textarea required value={reqItems} onChange={e => setReqItems(e.target.value)} rows={3} disabled={savingReq} placeholder="DETALLE OPERATIVO..."
                className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-xs font-mono outline-none focus:border-[#E1AD01] text-white uppercase placeholder:text-white/20 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" min="0.01" required value={reqAmount} onChange={e => setReqAmount(e.target.value)} placeholder="COSTO ESTIMADO ($)" className={inp} disabled={savingReq} />
                <select value={reqPriority} onChange={e => setReqPriority(e.target.value)} className={inp} disabled={savingReq}>
                  <option value="BAJA">BAJA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="CRITICA">AOG — CRÍTICA</option>
                </select>
              </div>
              <ErrorBanner msg={reqError} onClose={() => setReqError(null)} />
              <button type="submit" disabled={savingReq} className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {savingReq ? <Loader2 className="animate-spin h-4 w-4" /> : 'Sellar Requisición'}
              </button>
            </form>
          </div>
          <div className={`${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Aprobación</h3>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">Aprobar crea una cuenta por pagar; el dinero sale al pagarla en CxC/CxP.</p>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[480px] p-4 space-y-3">
              {requests.map(req => {
                let item: any = {};
                try { item = JSON.parse(req.items || '{}'); } catch { item = {}; }
                const puedeAprobar = req.estatus === 'PENDIENTE_REVISION' && ['CEO', 'ADMIN'].includes(rolUpper);   // [FIX v16.2.1] case-insensitive
                return (
                  <div key={req.id} className="bg-white/[0.02] border border-white/[0.05] p-5 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-[8px] font-black text-[#E1AD01] bg-[#E1AD01]/10 px-2 py-1 rounded-full tracking-widest">{req.nro_solicitud || 'REQ'}</span>
                        <p className="text-[10px] font-mono uppercase mt-2">{item.description}</p>
                        <p className="text-[#E1AD01] text-xl font-black italic mt-1">${fmtNum(Number(item.estimated_cost) || 0)}</p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${req.prioridad === 'CRITICA' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-400'}`}>{req.prioridad}</span>
                    </div>
                    {puedeAprobar ? (
                      <div className="flex gap-2 border-t border-white/5 pt-3">
                        <button onClick={() => handleApproveReq(req.id, Number(item.estimated_cost), item.description)} disabled={savingAction === req.id}
                          className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-[9px] font-black uppercase hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                          {savingAction === req.id ? <Loader2 size={12} className="animate-spin" /> : 'Aprobar'}
                        </button>
                        <button onClick={() => handleRejectReq(req.id)} disabled={savingAction === req.id}
                          className="flex-1 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase hover:bg-red-500/20 transition-all disabled:opacity-40">Rechazar</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-zinc-600 italic pt-2 border-t border-white/5"><CheckCircle2 className="h-3.5 w-3.5 text-zinc-700" /> {req.estatus}</div>
                    )}
                  </div>
                );
              })}
              {requests.length === 0 && <EmptyState text="Sin requisiciones" py="py-16" />}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CIERRE ═════════════════════════════════════════════════════ */}
      {activeTab === 'CLOSING' && (() => {
        const METODOS: { m: PaymentMethod; label: string }[] = [
          { m: 'USDT', label: 'USDT (Crypto)' }, { m: 'ZELLE', label: 'Zelle (USD)' },
          { m: 'CASH', label: 'Efectivo (USD)' }, { m: 'BS', label: 'Bolívares' },
        ];
        const handleCierre = () => {
          const disc = METODOS.map(({ m, label }) => {
            const diff = round2(Math.abs(getVaultBalance(m) - round2(parseFloat(physBalances[m]) || 0)));
            return diff > 0.01 ? `${label}: ${prefijo(m)} ${diff.toFixed(2)} de diferencia` : null;
          }).filter(Boolean);
          if (disc.length) alert('⚠️ DISCREPANCIAS:\n\n' + disc.join('\n'));
          else { alert('✓ CIERRE CERTIFICADO — Todos los métodos cuadran.'); setPhysBalances({ USDT: '', ZELLE: '', CASH: '', BS: '' }); }
        };
        return (
          <div className="space-y-6">
            <div className={`${glass} rounded-2xl p-5 flex items-center justify-between`}>
              <div>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tasa BCV (Bs/USD)</p>
                <p className="text-[8px] text-zinc-700">Tasa sugerida en FX Desk y cobros en Bs; convierte totales CxC/CxP a USD. BD guarda en moneda nativa.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#E1AD01] font-black font-mono">Bs</span>
                <input type="number" step="0.0001" min="1" value={tasaBCV}
                  onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n) && n > 0) setTasaBCV(n); }}
                  className="w-28 bg-black/40 border border-[#E1AD01]/30 rounded-xl px-3 py-2 text-[#E1AD01] font-black font-mono text-sm text-center outline-none" />
              </div>
            </div>
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="font-black text-[12px] uppercase tracking-widest mb-7 italic flex items-center gap-3"><Lock className="text-[#E1AD01] h-5 w-5" /> Cierre Multi-Moneda</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METODOS.map(({ m, label }) => {
                  const teorico   = getVaultBalance(m);
                  const diff      = physBalances[m] !== '' ? round2(teorico - round2(parseFloat(physBalances[m]) || 0)) : null;
                  const cuadra    = diff !== null && Math.abs(diff) <= 0.01;
                  const descuadra = diff !== null && Math.abs(diff) > 0.01;
                  const conc      = conciliacion.find(x => x.m === m);
                  return (
                    <div key={m} className={`rounded-2xl border p-5 space-y-4 transition-all ${cuadra ? 'bg-emerald-500/5 border-emerald-500/20' : descuadra ? 'bg-red-500/5 border-red-500/20' : MONEDA_BG[m]}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{label}</span>
                        {cuadra    && <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase flex items-center gap-1"><CheckCircle2 size={10} /> Cuadrado</span>}
                        {descuadra && <span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-full uppercase">⚠ Dif. {prefijo(m)} {Math.abs(diff ?? 0).toFixed(2)}</span>}
                      </div>
                      <div className="bg-black/30 rounded-xl p-4 text-center">
                        <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Saldo Teórico</p>
                        <p className={`text-xl font-black italic font-mono ${MONEDA_COLOR[m]}`}>{prefijo(m)} {fmtNum(teorico)}</p>
                        {m === 'BS' && tasaBCV > 0 && <p className="text-[8px] text-zinc-600 mt-1 font-mono">≈ ${fmtNum(teorico / tasaBCV)} USD @ {tasaBCV}</p>}
                        {conc && Math.abs(conc.sinAsignar) > 0.01 && <p className="text-[8px] text-zinc-500 mt-1 font-mono">En cajas {fmtMonto(conc.enCajas, m)} · sin ubicar {fmtMonto(conc.sinAsignar, m)}</p>}
                      </div>
                      <div>
                        <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2 text-center">Conteo Físico</label>
                        <div className="relative">
                          <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${MONEDA_COLOR[m]}`}>{prefijo(m)}</span>
                          <input type="number" step="0.01" value={physBalances[m]} placeholder="0.00"
                            onChange={e => setPhysBalances(p => ({ ...p, [m]: e.target.value }))}
                            className={`w-full bg-black/50 border py-4 pl-10 pr-4 rounded-xl text-xl font-black italic outline-none text-center text-white transition-all ${cuadra ? 'border-emerald-500/50' : descuadra ? 'border-red-500/50' : 'border-white/10 focus:border-[#E1AD01]'}`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={handleCierre} className="w-full py-5 bg-red-600 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-500 transition-all mt-5">
                <Lock className="h-4 w-4" /> Certificar Cierre Multi-Moneda
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══ MODALES ══════════════════════════════════════════════════════════ */}

      {/* COBRO CxC / PAGO CxP */}
      {cobroModal && (() => {
        const { cxc, cxp } = cuentaDeModal(cobroModal);
        const cuenta = cxc ?? cxp;
        if (!cuenta) return null;
        const esCxC        = !!cxc;
        const nombre       = cxc ? cxc.nombre_alumno : cxp?.entidad_nombre ?? '';
        const monedaCuenta = normalizePaymentMethod(cuenta.moneda);
        const pendiente    = cuenta.monto_pendiente;
        const esPrest      = !!cxp && cxp.entidad_tipo === 'PRESTAMISTA';
        const recibido     = parseFloat(cobroForm.monto);
        const aplicado     = convertirMonto(recibido, cobroForm.moneda, monedaCuenta, parseFloat(cobroForm.tasa));
        const cajaSel      = cajaById(cobroForm.caja_id);
        const esEfe        = cajaEsEfectivo(cobroForm.caja_id);
        const exceso       = aplicado !== null && aplicado > pendiente + 0.01;
        const nuevoPend    = aplicado !== null ? round2(Math.max(0, pendiente - aplicado)) : pendiente;
        const horasDelta   = cxc && cxc.monto_total > 0 && aplicado !== null
          ? round2(cxc.horas_prometidas * Math.min(1, (cxc.monto_pagado + aplicado) / cxc.monto_total) - cxc.horas_compradas) : 0;
        const conTasa = requiereTasa(cobroForm.moneda, monedaCuenta);
        const signo   = esCxC ? '+' : '−';
        const tonoMov = esCxC ? 'text-emerald-400' : 'text-red-400';
        const cerrar  = () => { setCobroModal(null); setCobroError(null); };
        return (
          <ModalShell accent={esCxC ? 'border-t-emerald-500' : esPrest ? 'border-t-violet-500' : 'border-t-orange-500'} maxW="max-w-xl">
            <ModalHeader icon={esCxC ? ArrowUpCircle : ArrowDownCircle} tone={esCxC ? TONE.emerald : TONE.orange}
              title={esCxC ? 'Registrar cobro' : esPrest ? 'Devolver préstamo' : 'Registrar pago'} subtitle={`${nombre} · ${cuenta.concepto}`} onClose={cerrar} />
            <div className="bg-black/30 rounded-xl p-4 mb-4 grid grid-cols-2 gap-3 text-center">
              <div><p className="text-[8px] text-zinc-600 font-black uppercase">Pendiente</p><p className="text-lg font-black italic text-white">{fmtMonto(pendiente, monedaCuenta)}</p></div>
              <div><p className="text-[8px] text-zinc-600 font-black uppercase">Queda después</p><p className={`text-lg font-black italic ${exceso ? 'text-red-400' : 'text-[#E1AD01]'}`}>{fmtMonto(nuevoPend, monedaCuenta)}</p></div>
            </div>
            <form onSubmit={handleCobroPago} className="space-y-4">
              <div><Lbl>{esCxC ? 'Moneda recibida' : 'Moneda con que se paga'}</Lbl><MonedaPicker value={cobroForm.moneda} onChange={setCobroMoneda} /></div>
              <div>
                <Lbl>{esCxC ? 'Caja que recibe' : 'Caja de donde sale'}</Lbl>
                <select value={cobroForm.caja_id} onChange={e => setCobroForm(p => ({ ...p, caja_id: e.target.value }))} className={inp}>
                  <option value="">SOLO BÓVEDA · sin caja</option>
                  {cajasQueAceptan(cobroForm.moneda).map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}{getCajaConfig(c).tipo === 'CUSTODIA_TERCERO' ? ' · custodia' : ''} · {fmtMonto(getCajaBalance(c.id, cobroForm.moneda), cobroForm.moneda)}</option>
                  ))}
                </select>
              </div>
              {esEfe && <SubcajaToggle value={cobroForm.subcaja} onChange={sc => setCobroForm(p => ({ ...p, subcaja: sc }))} />}
              <div className={`grid ${conTasa ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <AmountInput value={cobroForm.monto} moneda={cobroForm.moneda} onChange={v => setCobroForm(p => ({ ...p, monto: v }))} />
                {conTasa && (
                  <input type="number" step="0.0001" min="0.0001" required value={cobroForm.tasa} onChange={e => setCobroForm(p => ({ ...p, tasa: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 py-4 px-4 rounded-2xl text-xl font-black italic outline-none focus:border-[#E1AD01] text-white" placeholder="Tasa Bs/USD" />
                )}
              </div>
              {esCxC && <PagadorFields value={cobroPago} onChange={setCobroPago} moneda={cobroForm.moneda} alumnos={alumnos} />}
              <div className={`grid ${esCxC ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
                {!esCxC && <input value={cobroForm.referencia} onChange={e => setCobroForm(p => ({ ...p, referencia: e.target.value }))} placeholder="REF. BANCARIA / ZELLE" className={inp} />}
                <input type="date" required value={cobroForm.fecha} onChange={e => setCobroForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
              </div>
              {aplicado !== null && Number.isFinite(recibido) && (
                <div className="bg-black/30 border border-white/10 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] font-mono">
                  <p className={tonoMov}>{signo} {fmtMonto(recibido, cobroForm.moneda)} · Bóveda {cobroForm.moneda}{esPrest ? ' (financiamiento)' : ''}</p>
                  <p className={cajaSel ? tonoMov : 'text-zinc-600'}>{cajaSel ? `${signo} ${fmtMonto(recibido, cobroForm.moneda)} · Caja ${cajaSel.nombre}${esEfe ? ` (${cobroForm.subcaja})` : ''}` : 'Sin caja: quedará sin ubicar'}</p>
                  <p className="text-[#E1AD01]">− {fmtMonto(aplicado, monedaCuenta)} · {esCxC ? 'CxC' : 'CxP'} {nombre}</p>
                  {esCxC && <p className="text-[#E1AD01]">+ {horasDelta}h acreditadas al alumno</p>}
                </div>
              )}
              <ErrorBanner msg={cobroError} onClose={() => setCobroError(null)} />
              <ModalActions onCancel={cerrar} busy={savingCobro} disabled={aplicado === null || exceso}
                submitCls={esCxC ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-orange-500 text-black hover:bg-orange-400'}
                label={<><CheckCircle2 size={14} /> {esCxC ? 'Registrar cobro' : esPrest ? 'Registrar devolución' : 'Registrar pago'}</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* ENTREGA ADM → CEO */}
      {entregaCEOModal && (
        <ModalShell accent="border-t-yellow-500">
          <ModalHeader icon={ArrowLeftRight} tone={TONE.yellow} title="Entrega Efectivo a CEO" subtitle="Sale de ADM → Entra a CEO" onClose={() => setEntregaCEOModal(false)} />
          <div className="grid grid-cols-2 gap-4 bg-black/30 rounded-xl p-4 mb-4">
            <div className="text-center">
              <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Stand-By ADM</p>
              <p className={`font-black italic ${saldoEfectivoADM >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>{fmtMonto(saldoEfectivoADM, 'CASH')}</p>
            </div>
            <div className="text-center">
              <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Custodia CEO</p>
              <p className="text-yellow-400 font-black italic">{fmtMonto(saldoEfectivoCEO, 'CASH')}</p>
            </div>
          </div>
          <form onSubmit={handleEntregaCEO} className="space-y-4">
            <input type="date" required value={entregaCEOForm.fecha} onChange={e => setEntregaCEOForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
            <AmountInput size="lg" value={entregaCEOForm.monto} moneda="CASH" prefixCls="text-yellow-400" focusCls="focus:border-yellow-500" disabled={savingCaja}
              onChange={v => setEntregaCEOForm(p => ({ ...p, monto: v }))} />
            <input required value={entregaCEOForm.concepto} onChange={e => setEntregaCEOForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO (ej: COBRO PAQUETE 10H - CARLOS PÉREZ)" className={inp} disabled={savingCaja} />
            <ErrorBanner msg={cajaError} onClose={() => setCajaError(null)} />
            <ModalActions onCancel={() => setEntregaCEOModal(false)} busy={savingCaja} submitCls="bg-yellow-500 text-black hover:bg-yellow-400" label={<><ArrowLeftRight size={14} /> Confirmar Entrega</>} />
          </form>
        </ModalShell>
      )}

      {/* FX DESK (v15) */}
      {fxModalOpen && (() => {
        const cajaO  = cajaById(fxForm.caja_origen_id);
        const cajaD  = cajaById(fxForm.caja_destino_id);
        const esEfeO = cajaEsEfectivo(fxForm.caja_origen_id);
        const esEfeD = cajaEsEfectivo(fxForm.caja_destino_id);
        const saldoBovedaO = getVaultBalance(fxForm.moneda_origen);
        const saldoCajaO   = cajaO ? saldoCustodia(cajaO.id, fxForm.moneda_origen, esEfeO ? fxForm.subcaja_origen : null) : null;
        const mo           = parseFloat(fxForm.monto_origen);
        const moSafe       = Number.isFinite(mo) ? mo : 0;
        const involvesBS   = fxForm.moneda_origen === 'BS' || fxForm.moneda_destino === 'BS';
        const cerrar = () => { setFxModalOpen(false); setFxError(null); };
        const lados = [
          { lado: 'ORIGEN' as const, titulo: 'Sale · moneda que vendes', box: 'border-red-500/15 bg-red-500/[0.03]', tt: 'text-red-400',
            moneda: fxForm.moneda_origen, otra: fxForm.moneda_destino, cajaId: fxForm.caja_origen_id, esEfe: esEfeO, subcaja: fxForm.subcaja_origen,
            labelCaja: 'Caja de donde sale', vacia: 'SOLO BÓVEDA · no estaba en una caja',
            setCaja: (v: string) => setFxForm(p => ({ ...p, caja_origen_id: v })), setSub: (s: SubcajaEfectivo) => setFxForm(p => ({ ...p, subcaja_origen: s })) },
          { lado: 'DESTINO' as const, titulo: 'Entra · moneda que recibes', box: 'border-emerald-500/15 bg-emerald-500/[0.03]', tt: 'text-emerald-400',
            moneda: fxForm.moneda_destino, otra: fxForm.moneda_origen, cajaId: fxForm.caja_destino_id, esEfe: esEfeD, subcaja: fxForm.subcaja_destino,
            labelCaja: 'Caja donde entra', vacia: 'SOLO BÓVEDA · sin caja física',
            setCaja: (v: string) => setFxForm(p => ({ ...p, caja_destino_id: v })), setSub: (s: SubcajaEfectivo) => setFxForm(p => ({ ...p, subcaja_destino: s })) },
        ];
        return (
          <ModalShell accent="border-t-teal-500" maxW="max-w-3xl">
            <ModalHeader icon={TrendingUp} tone={TONE.fx} title="FX Desk — Cambio de moneda" subtitle="Sale de la bóveda/caja origen y entra a la bóveda/caja destino en una sola operación" onClose={cerrar} />
            <form onSubmit={handleFX} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {lados.map(L => (
                  <div key={L.lado} className={`rounded-2xl border p-4 space-y-3 ${L.box}`}>
                    <p className={`text-[9px] font-black uppercase tracking-widest ${L.tt}`}>{L.titulo}</p>
                    <MonedaPicker value={L.moneda} onChange={m => setFxMoneda(L.lado, m)} isDisabled={m => m === L.otra} />
                    <div>
                      <Lbl>{L.labelCaja}</Lbl>
                      <select value={L.cajaId} onChange={e => L.setCaja(e.target.value)} className={inp}>
                        <option value="">{L.vacia}</option>
                        {cajasQueAceptan(L.moneda).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                    {L.esEfe && <SubcajaToggle value={L.subcaja} onChange={L.setSub} />}
                    {L.lado === 'ORIGEN' ? (
                      <div className="text-[8px] font-mono space-y-0.5">
                        <p className={moSafe > saldoBovedaO ? 'text-red-400' : 'text-zinc-500'}>Bóveda {fxForm.moneda_origen}: {fmtMonto(saldoBovedaO, fxForm.moneda_origen)}</p>
                        {saldoCajaO !== null && cajaO && (
                          <p className={moSafe > saldoCajaO ? 'text-red-400' : 'text-zinc-500'}>{cajaO.nombre}{esEfeO ? ` (${fxForm.subcaja_origen})` : ''}: {fmtMonto(saldoCajaO, fxForm.moneda_origen)}</p>
                        )}
                      </div>
                    ) : <p className="text-[8px] font-mono text-zinc-500">Bóveda {fxForm.moneda_destino}: {fmtMonto(getVaultBalance(fxForm.moneda_destino), fxForm.moneda_destino)}</p>}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Lbl cls="text-teal-400">Monto {fxForm.moneda_origen} que sale</Lbl>
                  <AmountInput value={fxForm.monto_origen} moneda={fxForm.moneda_origen} focusCls="focus:border-teal-500" onChange={v => setFxForm(p => ({ ...p, monto_origen: v }))} />
                </div>
                <div>
                  <Lbl cls="text-teal-400">{involvesBS ? 'Tasa (Bs por 1 USD)' : 'Factor neto (1 = sin comisión)'}</Lbl>
                  <input type="number" step="0.0001" min="0.0001" required value={fxForm.tasa} onChange={e => setFxForm(p => ({ ...p, tasa: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 py-4 px-4 rounded-2xl text-xl font-black italic outline-none focus:border-teal-500 text-white" placeholder={involvesBS ? String(tasaBCV) : '1'} />
                  {involvesBS && (
                    <button type="button" onClick={() => setFxForm(p => ({ ...p, tasa: String(tasaBCV) }))} className="text-[8px] text-zinc-500 hover:text-teal-400 font-mono mt-1">Usar tasa BCV del sistema ({tasaBCV})</button>
                  )}
                </div>
              </div>

              {fxMontoDestino !== null && (
                <div className="bg-teal-500/5 border border-teal-500/20 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] text-teal-400 font-black uppercase tracking-widest">Recibes</p>
                    <p className={`text-xl font-black italic ${MONEDA_COLOR[fxForm.moneda_destino]}`}>{fmtMonto(fxMontoDestino, fxForm.moneda_destino)}</p>
                  </div>
                  <div className="border-t border-teal-500/10 pt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] font-mono">
                    <p className="text-red-400">− {fmtMonto(moSafe, fxForm.moneda_origen)} · Bóveda {fxForm.moneda_origen}</p>
                    <p className="text-emerald-400">+ {fmtMonto(fxMontoDestino, fxForm.moneda_destino)} · Bóveda {fxForm.moneda_destino}</p>
                    <p className={cajaO ? 'text-red-400' : 'text-zinc-600'}>{cajaO ? `− ${fmtMonto(moSafe, fxForm.moneda_origen)} · Caja ${cajaO.nombre}${esEfeO ? ` (${fxForm.subcaja_origen})` : ''}` : 'Sin movimiento de caja origen'}</p>
                    <p className={cajaD ? 'text-emerald-400' : 'text-zinc-600'}>{cajaD ? `+ ${fmtMonto(fxMontoDestino, fxForm.moneda_destino)} · Caja ${cajaD.nombre}${esEfeD ? ` (${fxForm.subcaja_destino})` : ''}` : 'Sin movimiento de caja destino'}</p>
                  </div>
                  <p className="text-[8px] text-zinc-600 font-mono">No cuenta como ingreso ni egreso: solo cambia el valor de moneda.</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input required value={fxForm.concepto} onChange={e => setFxForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO (ej: BS PARA NÓMINA INSTRUCTORES)" className={inp} />
                <input type="date" required value={fxForm.fecha} onChange={e => setFxForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
              </div>
              <ErrorBanner msg={fxError} onClose={() => setFxError(null)} />
              <ModalActions onCancel={cerrar} busy={savingFX} disabled={fxMontoDestino === null} submitCls="bg-teal-500 text-black hover:bg-teal-400" label={<><TrendingUp size={14} /> Registrar cambio</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* PRÉSTAMO EXTERNO */}
      {prestamoModal && (() => {
        const esEfeP = cajaEsEfectivo(prestamoForm.caja_id);
        const pend   = prestamosPendientes(prestamoForm.prestamista, prestamoForm.moneda);
        const deuda  = round2(pend.reduce((a, c) => a + c.monto_pendiente, 0));
        const dev    = prestamoForm.es_devolucion;
        return (
          <ModalShell accent="border-t-violet-500">
            <ModalHeader icon={HandCoins} tone={TONE.fin} title="Préstamo Externo" subtitle="Becquer / Roberto ↔ Águilas · financiamiento, no ingreso" onClose={() => setPrestamoModal(false)} />
            <form onSubmit={handlePrestamo} className="space-y-4">
              <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                {([[false, '+ Préstamo a Águilas', 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'], [true, '- Devolución', 'bg-red-500/20 text-red-400 border border-red-500/30']] as const).map(([v, l, on]) => (
                  <button key={l} type="button" onClick={() => setPrestamoForm(p => ({ ...p, es_devolucion: v, cuenta_id: v ? p.cuenta_id : '' }))}
                    className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${dev === v ? on : 'text-zinc-600 hover:text-zinc-400'}`}>{l}</button>
                ))}
              </div>
              <div>
                <Lbl cls="text-violet-400">Prestamista</Lbl>
                <div className="grid grid-cols-2 gap-2">
                  {PRESTAMISTAS.map(p => (
                    <button key={p} type="button" onClick={() => setPrestamoForm(prev => ({ ...prev, prestamista: p, cuenta_id: '' }))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${prestamoForm.prestamista === p ? 'bg-violet-500/20 text-violet-400 border-violet-500/30' : optOff}`}>{p}</button>
                  ))}
                </div>
              </div>
              <MonedaPicker value={prestamoForm.moneda} onChange={m => setPrestamoForm(p => ({ ...p, moneda: m, caja_id: ajustarCaja(p.caja_id, m), cuenta_id: '' }))} />
              <select required value={prestamoForm.caja_id} onChange={e => setPrestamoForm(p => ({ ...p, caja_id: e.target.value }))} className={inp}>
                <option value="">{dev ? '— CAJA DE DONDE SALE —' : '— CAJA RECEPTORA —'}</option>
                {cajasQueAceptan(prestamoForm.moneda).map(c => <option key={c.id} value={c.id}>{c.nombre} · {fmtMonto(getCajaBalance(c.id, prestamoForm.moneda), prestamoForm.moneda)}</option>)}
              </select>
              {esEfeP && <SubcajaToggle value={prestamoForm.subcaja} onChange={sc => setPrestamoForm(p => ({ ...p, subcaja: sc }))} />}
              {dev && (
                <div>
                  <Lbl cls="text-violet-400">Aplicar a · deuda {prestamoForm.moneda}: {fmtMonto(deuda, prestamoForm.moneda)}</Lbl>
                  <select value={prestamoForm.cuenta_id} onChange={e => setPrestamoForm(p => ({ ...p, cuenta_id: e.target.value }))} className={inp}>
                    <option value="">AUTOMÁTICO · préstamo más antiguo primero</option>
                    {pend.map(c => <option key={c.id} value={c.id}>{fmtDate(c.fecha_emision)} · {fmtMonto(c.monto_pendiente, c.moneda)} · {c.concepto}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <AmountInput value={prestamoForm.monto} moneda={prestamoForm.moneda} prefixCls="text-violet-400" focusCls="focus:border-violet-500" onChange={v => setPrestamoForm(p => ({ ...p, monto: v }))} />
                <input type="date" required value={prestamoForm.fecha} onChange={e => setPrestamoForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
              </div>
              <input required value={prestamoForm.concepto} onChange={e => setPrestamoForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO DEL PRÉSTAMO" className={inp} />
              {!dev && (
                <PagadorFields bloqueado moneda={prestamoForm.moneda}
                  value={{ ...prestamoPago, pagador_tipo: 'PRESTAMISTA', pagador_nombre: prestamoForm.prestamista }}
                  onChange={v => setPrestamoPago({ ...v, pagador_tipo: 'PRESTAMISTA' })} />
              )}
              <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                <p className="text-[9px] text-violet-400 font-mono">
                  {dev ? `ℹ Sale de bóveda y caja, y rebaja la deuda con ${prestamoForm.prestamista}. No cuenta como gasto.`
                       : `ℹ Entra a bóveda y caja y crea la CxP de devolución a ${prestamoForm.prestamista}. No cuenta como ingreso.`}
                </p>
              </div>
              <ErrorBanner msg={cajaError} onClose={() => setCajaError(null)} />
              <ModalActions onCancel={() => setPrestamoModal(false)} busy={savingCaja} submitCls="bg-violet-500 text-white hover:bg-violet-400"
                label={<><HandCoins size={14} /> {dev ? 'Registrar Devolución' : 'Registrar Préstamo'}</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* TRANSFERENCIA ENTRE CAJAS */}
      {transferModalOpen && (() => {
        const cerrar = () => { setTransferModalOpen(false); setTransferError(null); };
        const opciones = cajasQueAceptan(transferForm.moneda);
        return (
          <ModalShell accent="border-t-purple-500" maxW="max-w-2xl">
            <ModalHeader icon={ArrowLeftRight} tone={TONE.purple} title="Transferir entre Cajas" subtitle="Mueve custodia, la bóveda no cambia · misma moneda (para cambiar moneda use FX Desk)" onClose={cerrar} />
            <form onSubmit={handleTransferencia} className="space-y-4">
              <div><Lbl cls="text-purple-400">Moneda</Lbl><MonedaPicker value={transferForm.moneda} onChange={m => setTransferForm(p => ({ ...p, moneda: m, caja_origen_id: '', caja_destino_id: '' }))} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Lbl cls="text-purple-400">Caja Origen</Lbl>
                  <select required value={transferForm.caja_origen_id} onChange={e => setTransferForm(p => ({ ...p, caja_origen_id: e.target.value }))} className={inp} disabled={savingTransfer}>
                    <option value="">— DE —</option>
                    {opciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  {transferForm.caja_origen_id && <p className="text-[8px] text-zinc-600 font-mono mt-1">Saldo {transferForm.moneda}: {fmtMonto(getCajaBalance(transferForm.caja_origen_id, transferForm.moneda), transferForm.moneda)}</p>}
                </div>
                <div>
                  <Lbl cls="text-purple-400">Caja Destino</Lbl>
                  <select required value={transferForm.caja_destino_id} onChange={e => setTransferForm(p => ({ ...p, caja_destino_id: e.target.value }))} className={inp} disabled={savingTransfer}>
                    <option value="">— A —</option>
                    {opciones.filter(c => c.id !== transferForm.caja_origen_id).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AmountInput size="lg" value={transferForm.monto} moneda={transferForm.moneda} prefixCls="text-purple-400" focusCls="focus:border-purple-500" disabled={savingTransfer}
                  onChange={v => setTransferForm(p => ({ ...p, monto: v }))} />
                <input type="date" required value={transferForm.fecha} onChange={e => setTransferForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} disabled={savingTransfer} />
              </div>
              <input required value={transferForm.concepto} onChange={e => setTransferForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO" className={inp} disabled={savingTransfer} />
              <label className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.02] cursor-pointer">
                <input type="checkbox" checked={transferForm.generar_reposicion} onChange={e => setTransferForm(p => ({ ...p, generar_reposicion: e.target.checked }))} className="w-4 h-4 accent-purple-500" />
                <span className="text-[9px] text-zinc-400 font-mono">La caja origen es fondo fijo: crear reposición pendiente para devolverle este monto</span>
              </label>
              <ErrorBanner msg={transferError} onClose={() => setTransferError(null)} />
              <ModalActions onCancel={cerrar} busy={savingTransfer} submitCls="bg-purple-500 text-white hover:bg-purple-400" label={<><ArrowLeftRight size={14} /> Ejecutar</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* REPONER A CAJA — sin egreso, con caja fuente */}
      {pagarReposicionModal && (() => {
        const salidaRep  = movCajas.find(m => m.transfer_id === pagarReposicionModal.transfer_id && m.transfer_role === 'SALIDA');
        const cajaRep    = cajaById(salidaRep?.caja_id);
        const monedasRep = cajaRep ? getCajaConfig(cajaRep).monedasPermitidas : ALL_METHODS;
        return (
          <ModalShell accent="border-t-purple-500">
            <ModalHeader icon={Repeat} tone={TONE.purple} title="Reponer a Caja" subtitle={`Movimiento interno: entra a ${cajaRep?.nombre ?? 'la caja original'}, la bóveda no cambia`} />
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-4 mb-4">
              <p className="text-[9px] text-purple-400/80 font-mono">{pagarReposicionModal.entidad_nombre}</p>
              <p className="text-2xl font-black italic text-purple-400 mt-1">{fmtMonto(pagarReposicionModal.monto_total, pagarReposicionModal.moneda)}</p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">{pagarReposicionModal.concepto}</p>
            </div>
            <Lbl cls="text-purple-400">Moneda</Lbl>
            <div className="mb-4">
              <MonedaPicker value={pagarReposicionMoneda} isDisabled={m => !monedasRep.includes(m)} onChange={m => { setPagarReposicionMoneda(m); setPagarReposicionFuente(''); }} />
            </div>
            <Lbl cls="text-purple-400">¿De dónde sale?</Lbl>
            <select value={pagarReposicionFuente} onChange={e => setPagarReposicionFuente(e.target.value)} className={`${inp} mb-2`}>
              <option value="">SALDO SIN UBICAR DE BÓVEDA · {fmtMonto(sinUbicar(pagarReposicionMoneda), pagarReposicionMoneda)}</option>
              {cajasQueAceptan(pagarReposicionMoneda).filter(c => c.id !== cajaRep?.id).map(c => (
                <option key={c.id} value={c.id}>{c.nombre} · {fmtMonto(getCajaBalance(c.id, pagarReposicionMoneda), pagarReposicionMoneda)}</option>
              ))}
            </select>
            <p className="text-[8px] text-zinc-600 font-mono mb-6">No genera egreso: el dinero ya estaba en la bóveda, solo cambia quién lo custodia.</p>
            <ModalActions onCancel={() => setPagarReposicionModal(null)} onSubmit={confirmarPagoReposicion} busy={savingAction === pagarReposicionModal.id}
              submitCls="bg-purple-500 text-white hover:bg-purple-400" label={<><CheckCircle2 size={14} /> Confirmar</>} />
          </ModalShell>
        );
      })()}

      {/* ELIMINAR TRANSFERENCIA */}
      {deleteTransferModal && (() => {
        const { salida, entrada, reposicion, cajaOrigenNombre, cajaDestinoNombre } = deleteTransferModal;
        const items = ([
          salida     && { k: 'salida' as const,     titulo: `Salida de ${cajaOrigenNombre}`,         tc: 'text-red-400',     det: `-${fmtMonto(salida.monto, salida.moneda)}` },
          entrada    && { k: 'entrada' as const,    titulo: `Entrada a ${cajaDestinoNombre}`,        tc: 'text-emerald-400', det: `+${fmtMonto(entrada.monto, entrada.moneda)}` },
          reposicion && { k: 'reposicion' as const, titulo: `CxP Reposición (${reposicion.estatus})`, tc: 'text-purple-400',  det: fmtMonto(reposicion.monto_total, reposicion.moneda) },
        ]).filter((x): x is { k: 'salida' | 'entrada' | 'reposicion'; titulo: string; tc: string; det: string } => !!x);
        const sel = deleteTransferSelection;
        return (
          <ModalShell accent="border-t-red-500" maxW="max-w-lg">
            <ModalHeader icon={Trash2} tone={TONE.red} title="Eliminar Transferencia" subtitle="Selecciona qué registros eliminar" />
            <div className="space-y-2 mb-6">
              {items.map(it => (
                <label key={it.k} className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${sel[it.k] ? 'bg-red-500/10 border-red-500/30' : 'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={sel[it.k]} onChange={e => setDeleteTransferSelection(p => ({ ...p, [it.k]: e.target.checked }))} className="w-4 h-4 accent-red-500" />
                  <div>
                    <p className={`text-[10px] font-black uppercase ${it.tc}`}>{it.titulo}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">{it.det}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-4">
              <p className="text-[9px] text-yellow-400 font-mono">⚠ Marcar todos los elementos mantiene integridad contable.</p>
            </div>
            <ModalActions onCancel={() => setDeleteTransferModal(null)} onSubmit={confirmDeleteTransferSelection} busy={false}
              disabled={!sel.salida && !sel.entrada && !sel.reposicion} submitCls="bg-red-500 text-white hover:bg-red-400" label={<><Trash2 size={14} /> Eliminar Seleccionados</>} />
          </ModalShell>
        );
      })()}

      {/* CLAVE DEL DIRECTOR */}
      {directorAuthOpen && (
        <ModalShell accent="border-t-[#E1AD01]" maxW="max-w-sm" z="z-[100]">
          <ModalHeader icon={KeyRound} tone={TONE.asiento} title="Autorización Director" subtitle="Clave de 4 dígitos requerida." />
          <input autoFocus type="password" inputMode="numeric" maxLength={4} value={directorCode} placeholder="••••"
            onChange={e => setDirectorCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={e => { if (e.key === 'Enter') confirmDirectorCode(); }}
            className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-white text-2xl text-center font-black tracking-[0.6em] outline-none focus:border-[#E1AD01]" />
          {directorAuthError && <p className="text-[9px] text-red-400 mt-3 text-center font-mono">{directorAuthError}</p>}
          <div className="mt-5">
            <ModalActions onCancel={cancelDirectorAuth} onSubmit={confirmDirectorCode} busy={false} submitCls="bg-[#E1AD01] text-black hover:bg-white" label="Autorizar" />
          </div>
        </ModalShell>
      )}

      {/* EDITAR LEDGER (legacy) */}
      {editingTx && (
        <ModalShell accent="border-t-[#E1AD01]" maxW="max-w-2xl" z="z-[90]">
          <ModalHeader icon={Pencil} tone={TONE.asiento} title="Editar Movimiento (legacy)" onClose={() => setEditingTx(null)} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={editTxForm.type} onChange={e => setEditTxForm(p => ({ ...p, type: e.target.value as TransactionType }))} className={inp}>
              <option value="INCOME">INGRESO (+)</option><option value="EXPENSE">EGRESO (-)</option>
              <option value="INSTRUCTOR_PAY">NÓMINA</option><option value="PAYABLE">POR PAGAR</option>
              <option value="RECEIVABLE">POR COBRAR</option><option value="FX_EXCHANGE">FX CAMBIO (solo vía FX Desk)</option>
              <option value="FINANCING_IN">PRÉSTAMO RECIBIDO (solo vía Préstamo Externo)</option>
              <option value="FINANCING_OUT">DEVOLUCIÓN PRÉSTAMO (solo vía Préstamo Externo)</option>
            </select>
            <select value={editTxForm.currency} onChange={e => setEditTxForm(p => ({ ...p, currency: normalizePaymentMethod(e.target.value) }))} className={inp}>
              {ALL_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="number" min="0.01" step="0.01" value={editTxForm.amount} onChange={e => setEditTxForm(p => ({ ...p, amount: e.target.value }))} className={inp} placeholder="MONTO" />
            <input type="date" value={editTxForm.fecha} onChange={e => setEditTxForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
            <textarea value={editTxForm.description} onChange={e => setEditTxForm(p => ({ ...p, description: e.target.value }))} rows={3} placeholder="DESCRIPCIÓN"
              className="md:col-span-2 w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01] resize-none" />
          </div>
          <div className="my-4"><ErrorBanner msg={ledgerError} onClose={() => setLedgerError(null)} /></div>
          <ModalActions onCancel={() => setEditingTx(null)} onSubmit={saveEditedTx} busy={savingAction === editingTx.id} submitCls="bg-[#E1AD01] text-black hover:bg-white" label={<><ShieldCheck size={13} /> Guardar</>} />
        </ModalShell>
      )}

      {/* EDITAR CAJA (legacy / ubicación) */}
      {editingMov && (
        <ModalShell accent="border-t-[#E1AD01]" maxW="max-w-2xl" z="z-[90]">
          <ModalHeader icon={Pencil} tone={TONE.asiento} title="Editar Movimiento Caja (legacy / ubicación)" onClose={() => setEditingMov(null)} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <select value={editMovForm.tipo} onChange={e => setEditMovForm(p => ({ ...p, tipo: e.target.value as 'ENTRADA' | 'SALIDA' }))} className={inp}>
              <option value="ENTRADA">+ ENTRADA</option><option value="SALIDA">- SALIDA</option>
            </select>
            <select value={editMovForm.moneda} onChange={e => setEditMovForm(p => ({ ...p, moneda: normalizePaymentMethod(e.target.value) }))} className={inp}>
              {getCajaConfig(cajaById(editingMov.caja_id) ?? '').monedasPermitidas.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <input type="number" min="0.01" step="0.01" value={editMovForm.monto} onChange={e => setEditMovForm(p => ({ ...p, monto: e.target.value }))} className={inp} placeholder="MONTO" />
            <input type="date" value={editMovForm.fecha} onChange={e => setEditMovForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
            <input value={editMovForm.concepto} onChange={e => setEditMovForm(p => ({ ...p, concepto: e.target.value }))} className={inp} placeholder="CONCEPTO" />
            <input value={editMovForm.referencia} onChange={e => setEditMovForm(p => ({ ...p, referencia: e.target.value }))} className={inp} placeholder="REFERENCIA" />
          </div>
          <div className="my-4"><ErrorBanner msg={cajaError} onClose={() => setCajaError(null)} /></div>
          <ModalActions onCancel={() => setEditingMov(null)} onSubmit={saveEditedMov} busy={savingAction === editingMov.id} submitCls="bg-[#E1AD01] text-black hover:bg-white" label={<><ShieldCheck size={13} /> Guardar</>} />
        </ModalShell>
      )}

    </div>
  );
};
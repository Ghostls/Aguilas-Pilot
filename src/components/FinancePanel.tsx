// VALKYRON FINANCIAL INTELLIGENCE CENTER v17.0
// CHANGELOG v17.0 vs v16.8 (lógica QuickBooks solicitada por dirección Águilas):
//   [NEW] BILLETERA DEL ALUMNO (USD): el alumno paga en USDT/ZELLE/CASH/BS → RECARGA (bóveda + caja + pagador
//         + billetera en UNA transacción, RPC fn_wallet_recargar). La recarga es ANTICIPO (pasivo), no ingreso.
//   [NEW] CONSUMOS: horas de vuelo, simulador, cursos, exámenes se descuentan de la billetera; el DÉFICIT pasa
//         automáticamente a CxC (cuentas_por_cobrar, USD, 0 horas). Cola "Vuelos por cargar" desde bitacora_vuelos
//         (un vuelo solo se cobra una vez; modo PAQUETE_LEGACY para vuelos cubiertos por horas compradas antes).
//   [NEW] Aplicar saldo a deudas (FIFO), ajustes / saldo inicial, reembolsos, reversos con contra-asiento.
//   [NEW] Anticipos sin matrícula VINCULADOS → "Aplicar a billetera" (sin volver a recibir dinero).
//   [NEW] CLASES contables (servicio · aeronave · sede · piloto · proyecto) en Diario, Cajas y CxP; reclasificación.
//   [NEW] REPORTES: Estado de Resultados (base devengado / efectivo), P&L por clase (rentabilidad por aeronave,
//         sede, servicio, piloto, proyecto), Balance General, Flujo de Efectivo, Antigüedad CxC/CxP, Sin clasificar.
//   [NEW] Impresión: estado de cuenta por alumno, movimientos de caja global / por caja / por período, reportes.
//   [SEC] Recarga/reembolso de billetera no se anulan desde el Diario: se revierten desde Billeteras (guarda en BD).
//   [PRESERVADO] Motor v16, pagadores v16.5, roles v16.6, cajas v16.7, anticipos v16.8, FX Desk, préstamos, cierre.
// REQUISITO v17: migracion_finance_v17_billetera_clases.sql (sin ella el panel opera como v16.8 y avisa).
// VALKYRON FINANCIAL INTELLIGENCE CENTER v16.8
// CHANGELOG v16.8: anticipos sin matrícula registrados por RPC ATÓMICA,
// vínculo documental sin doble ingreso ni acreditación de horas, paginación financiera,
// deshabilitado sync histórico automático y alertas de integridad.
// REQUISITO: migracion_finance_v16_8_pagos_provisionales.sql en Supabase.
// ADVERTENCIA: los cierres aún NO constituyen cierres contables firmados.
// VALKYRON FINANCIAL INTELLIGENCE CENTER v16.7
// CHANGELOG v16.7 vs v16.6:
//   [FIX CRÍTICO] Selectores de caja ya no desaparecen cuando la moneda no coincide con monedas_permitidas.
//         Todas las cajas visibles se muestran; las incompatibles quedan identificadas/deshabilitadas.
//   [FIX] OPERATIVA y CUSTODIA_TERCERO se tratan como cajas multimoneda (USDT/ZELLE/CASH/BS), coherente
//         con MATURÍN, BARQUISIMETO, ROBERTO. Cajas dedicadas (EFECTIVO/BS) siguen estrictas.
//   [DIAG] Si RLS devuelve 0 cajas, los formularios muestran “SIN CAJAS VISIBLES · REVISE RLS” en vez
//         de aparentar que “SOLO BÓVEDA” es la única opción disponible.
//   [PRESERVADO] Roles CEO/ADMIN/DIRECTOR v16.6, motor contable v16, trazabilidad v16.5 y anti-duplicado.
// CHANGELOG v16.6 vs v16.5:
//   [FIX CRÍTICO] Resolución real de rol financiero: CEO / ADMIN / DIRECTOR se normalizan y se validan
//         contra el perfil autenticado en Supabase. Evita “SIN RANGO” cuando el prop llega vacío/desactualizado.
//   [FIX CRÍTICO] ADMIN conserva permisos completos para mover finanzas; aliases ADMINISTRADOR/ADMINISTRACION
//         se normalizan a ADMIN. CEO en minúsculas, con espacios o desde BD se reconoce correctamente.
//   [SEC] Frontend no sustituye RLS: la BD sigue siendo autoridad final mediante es_staff_finanzas().
//   [DIAG] Si la lectura del rol del perfil falla, se conserva el rol recibido por prop y se registra warning.
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
//          (custodia de terceros), MATURÍN y BARQUISIMETO (sedes). Todas conectadas a las 4 bóvedas
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
  // ▼ v17
  Printer, BarChart3, Tag, Undo2, PlaneTakeoff, Settings, MinusCircle, Search, Layers, Receipt, Info,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type PaymentMethod   = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
/** FINANCING_IN / FINANCING_OUT: préstamos (mueven caja, no son ingreso/egreso operativo) */
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE' | 'FX_EXCHANGE' | 'FINANCING_IN' | 'FINANCING_OUT';
export type TabType         = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING' | 'PROVISIONALES' | 'BILLETERAS' | 'REPORTES';   // [CHG v17]
export type SubcajaEfectivo = 'ADM' | 'CEO';
export type Prestamista     = 'Barquisimeto' | 'ROBERTO';
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
/** v16.8 — Subledger de pagos con beneficiario sin cuenta estudiantil.
 * Un VÍNCULO no equivale a APLICACIÓN contable ni a horas acreditadas.
 */
interface PagoProvisional {
  id: string; asiento_id: string; beneficiario_nombre: string; beneficiario_documento: string;
  beneficiario_contacto: string | null; sede: string | null; concepto: string;
  moneda: PaymentMethod; monto: number; referencia_pago: string; caja_id: string;
  fecha_pago: string; creado_en: string; creado_por: string;
  estado: 'PENDIENTE' | 'VINCULADO' | 'ANULADO'; student_id: string | null;
  vinculado_por: string | null; vinculado_en: string | null;
}

// ─── [NEW v17] BILLETERA · CONSUMOS · TARIFARIO · CLASES ─────────────────────
type WalletMovTipo = 'RECARGA' | 'CONSUMO' | 'APLICACION_CXC' | 'AJUSTE_CREDITO' | 'AJUSTE_DEBITO'
  | 'SALDO_INICIAL' | 'ANTICIPO_APLICADO' | 'REEMBOLSO' | 'REVERSO';
type TipoConsumo  = 'VUELO' | 'SIMULADOR' | 'CURSO' | 'EXAMEN' | 'MATERIAL' | 'OTRO';
type ModoConsumo  = 'BILLETERA' | 'PAQUETE_LEGACY' | 'CORTESIA';
type AjusteTipo   = 'SALDO_INICIAL' | 'AJUSTE_CREDITO' | 'AJUSTE_DEBITO';
type TablaClase   = 'transacciones_finanzas' | 'cuentas_generales';
type WalletModal  = 'RECARGA' | 'CONSUMO' | 'AJUSTE' | 'REEMBOLSO';
type WalletSubTab = 'ALUMNOS' | 'VUELOS' | 'TARIFARIO';

interface WalletCuenta { student_id: string; saldo_usd: number; actualizado_en: string; }
/** Subledger inmutable de la billetera (saldo = Σ signo · monto) */
interface WalletMovimiento {
  id: string; student_id: string; tipo: WalletMovTipo; signo: 1 | -1; monto_usd: number; saldo_resultante: number;
  moneda_origen: string | null; monto_origen: number | null; tasa: number | null;
  asiento_id: string | null; consumo_id: string | null; cxc_id: string | null; provisional_id: string | null;
  reverso_de: string | null; revertido: boolean; concepto: string; referencia: string; fecha: string;
  creado_en: string; creado_por_email: string | null;
}
/** Documento de ingreso devengado (vuelo, simulador, curso...) */
interface WalletConsumo {
  id: string; student_id: string; servicio_id: string | null; tipo: TipoConsumo; descripcion: string;
  cantidad: number; unidad: string; precio_unitario_usd: number; monto_total_usd: number;
  monto_billetera_usd: number; monto_cxc_usd: number; cxc_id: string | null; modo: ModoConsumo;
  vuelo_id: string | null; clase_servicio: string; clase_aeronave: string | null; clase_sede: string | null;
  clase_piloto: string | null; clase_proyecto: string | null; fecha: string; estado: 'VIGENTE' | 'ANULADO';
  motivo_anulacion: string | null; creado_en: string; creado_por_email: string | null;
}
interface ServicioCatalogo {
  id: string; codigo: string; nombre: string; tipo: TipoConsumo; unidad: string; precio_usd: number;
  aeronave_matricula: string | null; sede: string | null; clase_servicio: string; activo: boolean; notas: string | null;
}
interface ClasificacionRow {
  tabla: TablaClase; registro_id: string; asiento_id: string | null;
  servicio: string | null; aeronave: string | null; sede: string | null; piloto: string | null; proyecto: string | null;
  tasa_ref: number | null;
}
/** Clase contable editable (QuickBooks "clases / ubicaciones") */
interface ClaseForm { servicio: string; aeronave: string; sede: string; piloto: string; proyecto: string; }
interface VueloBitacora {
  id: string; student_id: string | null; fecha: string; horas: number; matricula: string | null;
  tipo_mision: string | null; sede: string | null; destino: string | null;
}
interface ServicioEditForm {
  id: string | null; codigo: string; nombre: string; tipo: TipoConsumo; unidad: string; precio: string;
  aeronave_matricula: string; sede: string; clase_servicio: string; activo: boolean; notas: string;
}
interface MotivoAccion { tipo: 'REVERTIR' | 'ANULAR_CONSUMO'; id: string; titulo: string; detalle: string; }
interface ReclasAccion { items: { tabla: TablaClase; id: string }[]; titulo: string; inicial: ClaseForm; }

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
const PRESTAMISTAS: Prestamista[]  = ['Barquisimeto', 'ROBERTO'];

/** Fallback por nombre (la BD manda). [CHG v16.4] claves específicas primero: el orden de inserción decide. */
const CAJA_CONFIG: Record<string, CajaConf> = {
  'efectivo admin': { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_ADM', efectivoRol: 'ADM' },
  'efectivo adm':   { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_ADM', efectivoRol: 'ADM' },
  'efectivo ceo':   { monedasPermitidas: ['CASH'], esCajaEfectivo: false, tipo: 'EFECTIVO_CEO', efectivoRol: 'CEO' },
  'caja bs':        { monedasPermitidas: ['BS'],   esCajaEfectivo: false, tipo: 'BANCO' },
  bancamiga:        { monedasPermitidas: ['BS'],   esCajaEfectivo: false, tipo: 'BANCO' },
  efectivo:         { monedasPermitidas: ['CASH'], esCajaEfectivo: true,  tipo: 'EFECTIVO' },   // legacy: 1 caja con subcajas
  Barquisimeto:          { monedasPermitidas: ALL_METHODS, esCajaEfectivo: false, tipo: 'CUSTODIA_TERCERO', prestamista: 'Barquisimeto' },
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
const parsePrestamista = (v: unknown): Prestamista | null => (v === 'Barquisimeto' || v === 'ROBERTO' ? v : null);

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

// ▼ v16.6 — rol financiero canónico. El frontend acepta aliases, pero la BD/RLS sigue siendo autoridad final.
const FINANCE_ROLES = ['CEO', 'ADMIN', 'DIRECTOR'] as const;
type FinanceRole = typeof FINANCE_ROLES[number];

const normalizeFinanceRole = (value: unknown): string => {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (raw === 'ADMINISTRADOR' || raw === 'ADMINISTRACION') return 'ADMIN';
  if (raw === 'DIRECCION' || raw === 'DIRECTOR_FINANZAS' || raw === 'DIRECTOR_FINANCIERO') return 'DIRECTOR';
  return raw;
};

const isFinanceRole = (value: unknown): value is FinanceRole =>
  (FINANCE_ROLES as readonly string[]).includes(normalizeFinanceRole(value));

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

// ─── [NEW v17] CATÁLOGOS CONTABLES ────────────────────────────────────────────

/** Categorías de Ledger reservadas para la billetera (identifican anticipos / reembolsos, no ingresos/gastos). */
const CATEGORIA_BILLETERA = 'Billetera Alumno';
const CATEGORIA_REEMBOLSO = 'Reembolso Billetera';

type NaturalezaPL = 'INGRESO' | 'GASTO' | 'NEUTRO';
/** Plan de cuentas de resultados = "servicio" (clase principal). */
const SERVICIOS_PL: { k: string; l: string; n: NaturalezaPL; cod: string }[] = [
  { k: 'INSTRUCCION_VUELO',  l: 'Instrucción de vuelo',                 n: 'INGRESO', cod: '4.1' },
  { k: 'SIMULADOR',          l: 'Simulador',                            n: 'INGRESO', cod: '4.2' },
  { k: 'CURSOS',             l: 'Cursos y teoría',                      n: 'INGRESO', cod: '4.3' },
  { k: 'EXAMENES',           l: 'Exámenes y certificaciones',           n: 'INGRESO', cod: '4.4' },
  { k: 'PAQUETES_HORAS',     l: 'Paquetes de horas (régimen anterior)', n: 'INGRESO', cod: '4.5' },
  { k: 'MATRICULA',          l: 'Matrícula y aranceles',                n: 'INGRESO', cod: '4.6' },
  { k: 'CARGOS_AJUSTE',      l: 'Cargos por ajuste de billetera',       n: 'INGRESO', cod: '4.7' },
  { k: 'BONIFICACIONES',     l: 'Bonificaciones y descuentos (−)',      n: 'INGRESO', cod: '4.8' },
  { k: 'OTROS_INGRESOS',     l: 'Otros ingresos',                       n: 'INGRESO', cod: '4.9' },
  { k: 'COMBUSTIBLE',        l: 'Combustible',                          n: 'GASTO',   cod: '5.1' },
  { k: 'MANTENIMIENTO',      l: 'Mantenimiento y repuestos',            n: 'GASTO',   cod: '5.2' },
  { k: 'NOMINA_INSTRUCCION', l: 'Nómina instructores / capitanes',      n: 'GASTO',   cod: '5.3' },
  { k: 'NOMINA_ADMIN',       l: 'Nómina administrativa',                n: 'GASTO',   cod: '5.4' },
  { k: 'SEGUROS',            l: 'Seguros',                              n: 'GASTO',   cod: '5.5' },
  { k: 'AEROPUERTO',         l: 'Tasas aeroportuarias y hangar',        n: 'GASTO',   cod: '5.6' },
  { k: 'ADMINISTRATIVO',     l: 'Gastos administrativos',               n: 'GASTO',   cod: '5.7' },
  { k: 'MARKETING',          l: 'Mercadeo',                             n: 'GASTO',   cod: '5.8' },
  { k: 'IMPUESTOS',          l: 'Impuestos y tasas',                    n: 'GASTO',   cod: '5.9' },
  { k: 'OTROS_GASTOS',       l: 'Otros gastos',                         n: 'GASTO',   cod: '5.10' },
  { k: 'ANTICIPO_ALUMNO',    l: 'Anticipos de alumnos (billetera)',     n: 'NEUTRO',  cod: '2.3' },
  { k: 'REEMBOLSO_ALUMNO',   l: 'Reembolsos de billetera',              n: 'NEUTRO',  cod: '2.3' },
];
const SERVICIO_LABEL = new Map(SERVICIOS_PL.map(s => [s.k, s.l]));
const SERVICIO_ORDEN = new Map(SERVICIOS_PL.map((s, i) => [s.k, i]));
const labelServicio = (k: string) => SERVICIO_LABEL.get(k) ?? (k ? k.replace(/_/g, ' ') : 'SIN CLASE');

const SEDES_FIN: { k: string; l: string }[] = [
  { k: 'BARQUISIMETO', l: 'Barquisimeto' }, { k: 'MATURIN', l: 'Maturín' }, { k: 'ADMINISTRACION', l: 'Administración central' },
];
const TIPOS_CONSUMO: { k: TipoConsumo; l: string; unidad: string }[] = [
  { k: 'VUELO', l: 'Hora de vuelo', unidad: 'HORA' }, { k: 'SIMULADOR', l: 'Simulador', unidad: 'HORA' },
  { k: 'CURSO', l: 'Curso', unidad: 'UNIDAD' },        { k: 'EXAMEN', l: 'Examen / chequeo', unidad: 'UNIDAD' },
  { k: 'MATERIAL', l: 'Material', unidad: 'UNIDAD' },   { k: 'OTRO', l: 'Otro', unidad: 'UNIDAD' },
];
const SERVICIO_POR_TIPO: Record<TipoConsumo, string> = {
  VUELO: 'INSTRUCCION_VUELO', SIMULADOR: 'SIMULADOR', CURSO: 'CURSOS', EXAMEN: 'EXAMENES', MATERIAL: 'OTROS_INGRESOS', OTRO: 'OTROS_INGRESOS',
};
const WALLET_MOV_LABEL: Record<WalletMovTipo, string> = {
  RECARGA: 'Recarga', CONSUMO: 'Consumo', APLICACION_CXC: 'Aplicado a deuda', AJUSTE_CREDITO: 'Ajuste (+)',
  AJUSTE_DEBITO: 'Ajuste (−)', SALDO_INICIAL: 'Saldo inicial', ANTICIPO_APLICADO: 'Anticipo aplicado',
  REEMBOLSO: 'Reembolso', REVERSO: 'Reverso',
};
const MODO_CONSUMO_LABEL: Record<ModoConsumo, string> = {
  BILLETERA: 'Cobrar a billetera', PAQUETE_LEGACY: 'Cubierto por paquete anterior', CORTESIA: 'Cortesía (sin cargo)',
};
const CLASE_VACIA: ClaseForm = { servicio: '', aeronave: '', sede: '', piloto: '', proyecto: '' };

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
  // [NEW v17] billetera / consumos / clases
  [/ASIENTO_DE_BILLETERA/,          'Este asiento es una recarga/reembolso de billetera: reviértalo desde Billeteras (mantiene el saldo del alumno coherente).'],
  [/WALLET_SALDO_INSUFICIENTE/,     'Saldo de billetera insuficiente: el alumno ya consumió esos fondos. Anule consumos/aplicaciones o registre un ajuste.'],
  [/WALLET_SIN_SALDO/,              'El alumno no tiene saldo disponible en su billetera.'],
  [/WALLET_INMUTABLE/,              'Los movimientos de billetera son inmutables: use reverso o anulación.'],
  [/CXC_NO_APLICABLE/,              'No hay deudas aplicables (solo CxC en USD sin horas prometidas; las de paquetes de horas se cobran desde CxC).'],
  [/VUELO_YA_CARGADO/,              'Ese vuelo ya fue cargado a la billetera.'],
  [/TARIFA_VUELO_NO_CONFIGURADA/,   'No hay tarifa de vuelo activa para esa aeronave: configure el Tarifario.'],
  [/VUELO_SIN_ALUMNO/,              'El vuelo de bitácora no tiene alumno asociado.'],
  [/VUELO_SIN_HORAS/,               'El vuelo de bitácora no tiene horas registradas.'],
  [/CREDITO_EXCEDIDO/,              'El déficit supera el límite de crédito configurado. Marque "Autorizar sobre límite" si dirección lo aprueba.'],
  [/CONSUMO_CON_COBROS/,            'La deuda de este consumo ya tiene cobros en caja: anúlelos primero en CxC.'],
  [/CONSUMO_YA_ANULADO/,            'El consumo ya estaba anulado.'],
  [/MOVIMIENTO_YA_REVERTIDO/,       'El movimiento ya fue revertido.'],
  [/USE_ANULAR_CONSUMO/,            'Los consumos se anulan desde la lista de consumos.'],
  [/REVERSO_NO_REVERSIBLE/,         'Un reverso no se puede revertir.'],
  [/MOTIVO_REQUERIDO/,              'Indique un motivo (mínimo 5 caracteres).'],
  [/RECARGA_SIN_CAJA/,              'Seleccione la caja que custodia el dinero.'],
  [/RECARGA_TASA_REQUERIDA/,        'Indique la tasa Bs/USD.'],
  [/RECARGA_CONVERSION_INCOHERENTE/,'La conversión a USD no coincide con el monto y la tasa.'],
  [/RECARGA_(ASIENTO|PAGADOR)_INCOHERENTE/, 'El asiento no coincide con la recarga (monto o moneda).'],
  [/ux_wallet_mov_provisional/,     'Ese anticipo ya fue aplicado a una billetera.'],
  [/PROVISIONAL_NO_VINCULADO/,      'Vincule primero el anticipo a un estudiante matriculado.'],
  [/ALUMNO_NO_EXISTE/,              'El alumno no existe.'],
  [/CONSUMO_PRECIO_INVALIDO/,       'Precio inválido.'],
  [/CONSUMO_DESCRIPCION_REQUERIDA/, 'Indique la descripción del consumo.'],
  [/SERVICIO_DATOS_REQUERIDOS/,     'Código y nombre del servicio son obligatorios.'],
  [/servicios_catalogo_codigo_key/, 'Ya existe un servicio con ese código.'],
];
/** [NEW v17] Tabla / relación inexistente (migración v17 no aplicada) */
const isMissingRelation = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === '42P01' || err.code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(err.message ?? ''));
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

// ─── [NEW v17] CLASES ─────────────────────────────────────────────────────────

const normTxt = (v: unknown) => String(v ?? '').trim().toUpperCase();
const claseTieneDatos = (c: ClaseForm | null | undefined) => !!c && Object.values(c).some(v => String(v).trim() !== '');
/** Payload para fn_registrar_asiento_clasificado / fn_clasificar_registros */
const claseAPayload = (c: ClaseForm, tasaRef?: number | null): Record<string, unknown> => ({
  servicio: normTxt(c.servicio), aeronave: normTxt(c.aeronave), sede: normTxt(c.sede),
  piloto: normTxt(c.piloto), proyecto: normTxt(c.proyecto), tasa_ref: tasaRef && tasaRef > 0 ? tasaRef : null,
});
const claseDeRow = (r: ClasificacionRow | undefined | null): ClaseForm => ({
  servicio: r?.servicio ?? '', aeronave: r?.aeronave ?? '', sede: r?.sede ?? '', piloto: r?.piloto ?? '', proyecto: r?.proyecto ?? '',
});
/** Matrícula normalizada (YV-1234 ≡ YV1234) */
const normMatricula = (m: string | null | undefined) => String(m ?? '').toUpperCase().replace(/[\s-]/g, '');
/** Reemplaza el prefijo de referencia del asiento (WAL-, WRE-) en todas sus patas */
const conPrefijo = (a: AsientoPayload, pref: string): AsientoPayload => {
  const ref = `${pref}-${a.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  return {
    ...a, referencia: ref,
    ledger: a.ledger.map(l => ({ ...l, invoice_number: ref })),
    caja: a.caja.map(c => ({ ...c, referencia: ref })),
  };
};

// ─── [NEW v17] IMPRESIÓN ──────────────────────────────────────────────────────

interface PrintSeccion {
  titulo?: string; columnas: string[]; filas: (string | number)[][];
  alinear?: ('l' | 'r' | 'c')[]; totales?: (string | number)[]; nota?: string;
}
interface PrintDoc {
  titulo: string; subtitulo?: string; meta?: [string, string][]; resumen?: [string, string][];
  secciones: PrintSeccion[]; pie?: string; horizontal?: boolean;
}
const escHtml = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
const usd = (n: number) => `${n < 0 ? '−' : ''}$${fmtNum(Math.abs(n))}`;

/** Documento imprimible (el usuario puede "Guardar como PDF" desde el diálogo de impresión). */
const imprimirDocumento = (d: PrintDoc) => {
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { alert('El navegador bloqueó la ventana de impresión. Permita ventanas emergentes para este sitio.'); return; }
  const tabla = (s: PrintSeccion) => {
    const al = (i: number) => (s.alinear?.[i] === 'r' ? 'right' : s.alinear?.[i] === 'c' ? 'center' : 'left');
    return `
      ${s.titulo ? `<h2>${escHtml(s.titulo)}</h2>` : ''}
      <table>
        <thead><tr>${s.columnas.map((c, i) => `<th style="text-align:${al(i)}">${escHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${s.filas.length ? s.filas.map(f => `<tr>${f.map((v, i) => `<td style="text-align:${al(i)}">${escHtml(v)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${s.columnas.length}" class="vacio">Sin registros</td></tr>`}</tbody>
        ${s.totales ? `<tfoot><tr>${s.totales.map((v, i) => `<td style="text-align:${al(i)}">${escHtml(v)}</td>`).join('')}</tr></tfoot>` : ''}
      </table>
      ${s.nota ? `<p class="nota">${escHtml(s.nota)}</p>` : ''}`;
  };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escHtml(d.titulo)}</title>
    <style>
      @page { size: A4 ${d.horizontal ? 'landscape' : 'portrait'}; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; font-size: 10.5px; margin: 0; }
      header { border-bottom: 3px solid #E1AD01; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
      header .marca { font-size: 9px; letter-spacing: .25em; color: #8a6d00; font-weight: 700; }
      header h1 { font-size: 18px; margin: 2px 0 0; letter-spacing: .02em; }
      header .sub { color: #555; font-size: 10px; margin-top: 2px; }
      .meta { text-align: right; font-size: 9px; color: #555; line-height: 1.5; }
      .resumen { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 14px; }
      .resumen div { border: 1px solid #ddd; border-left: 3px solid #E1AD01; padding: 6px 10px; min-width: 140px; }
      .resumen b { display: block; font-size: 13px; margin-top: 2px; }
      .resumen span { font-size: 8.5px; color: #666; text-transform: uppercase; letter-spacing: .08em; }
      h2 { font-size: 11.5px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .08em; color: #333; border-left: 3px solid #E1AD01; padding-left: 6px; }
      table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      th { background: #111; color: #E1AD01; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; padding: 5px 6px; }
      td { border-bottom: 1px solid #e5e5e5; padding: 4px 6px; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #fafafa; }
      tfoot td { font-weight: 700; border-top: 2px solid #111; background: #f3f3f3; }
      .vacio { text-align: center; color: #999; padding: 10px; }
      .nota { font-size: 9px; color: #666; margin: 4px 0 0; }
      footer { margin-top: 18px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 8.5px; color: #777; display: flex; justify-content: space-between; }
      .firmas { display: flex; gap: 60px; margin-top: 40px; }
      .firmas div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 9px; }
    </style></head><body>
    <header>
      <div><div class="marca">ÁGUILAS PILOT ACADEMY · VALKYRON FINANCIAL CORE</div>
        <h1>${escHtml(d.titulo)}</h1>${d.subtitulo ? `<div class="sub">${escHtml(d.subtitulo)}</div>` : ''}</div>
      <div class="meta">${(d.meta ?? []).map(([k, v]) => `${escHtml(k)}: <b>${escHtml(v)}</b>`).join('<br>')}
        <br>Emitido: <b>${escHtml(new Date().toLocaleString('es-VE'))}</b></div>
    </header>
    ${d.resumen?.length ? `<div class="resumen">${d.resumen.map(([k, v]) => `<div><span>${escHtml(k)}</span><b>${escHtml(v)}</b></div>`).join('')}</div>` : ''}
    ${d.secciones.map(tabla).join('')}
    <div class="firmas"><div>Elaborado por</div><div>Revisado por</div><div>Dirección</div></div>
    <footer><span>${escHtml(d.pie ?? 'Documento generado por Valkyron Financial Core. Montos en USD salvo indicación.')}</span><span>Águilas Pilot Academy</span></footer>
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* el usuario puede imprimir manualmente */ } }, 350);
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
  alumnos?: AlumnoCxC[]; bloqueado?: boolean; className?: string; sinPerfil?: boolean;
}> = ({ value: v, onChange, moneda, alumnos = [], bloqueado, className = '', sinPerfil = false }) => {
  const set = (k: keyof PagoForm, val: string) => onChange({ ...v, [k]: val });
  const origen = ORIGEN_LABEL[moneda];
  return (
    <div className={`rounded-2xl border border-[#E1AD01]/25 bg-[#E1AD01]/[0.03] p-4 space-y-3 ${className}`}>
      <p className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest flex items-center gap-2"><UserCheck size={12} /> Quién pagó · {moneda}</p>
      {!bloqueado && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          {PAGADOR_TIPOS.filter(t => !sinPerfil || t.k !== 'ALUMNO').map(t => (
            <button key={t.k} type="button"
              onClick={() => onChange({ ...v, pagador_tipo: t.k, alumno_id: t.k === 'ALUMNO' ? v.alumno_id : '', pagador_nombre: t.k === 'ALUMNO' || v.pagador_tipo === 'ALUMNO' ? '' : v.pagador_nombre })}
              className={`py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${v.pagador_tipo === t.k ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : optOff}`}>
              {sinPerfil && t.k === 'TERCERO' ? 'Aspirante (sin matrícula)' : t.l}
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

/** [NEW v17] Clase contable (servicio · aeronave · sede · piloto · proyecto) para P&L por clase */
const ClaseFields: React.FC<{
  value: ClaseForm; onChange: (c: ClaseForm) => void; flota: string[]; pilotos: string[];
  naturaleza?: 'INGRESO' | 'GASTO' | 'TODOS'; className?: string; titulo?: string;
}> = ({ value: v, onChange, flota, pilotos, naturaleza = 'TODOS', className = '', titulo = 'Clase contable (P&L por clase)' }) => {
  const set = (k: keyof ClaseForm, val: string) => onChange({ ...v, [k]: val });
  const servicios = SERVICIOS_PL.filter(s => s.n !== 'NEUTRO' && (naturaleza === 'TODOS' || s.n === naturaleza));
  const sel = 'bg-black/50 border border-white/10 px-3 py-2.5 rounded-xl text-white text-[10px] font-mono outline-none focus:border-[#E1AD01]/60 w-full uppercase';
  return (
    <div className={`rounded-2xl border border-teal-500/20 bg-teal-500/[0.03] p-3 space-y-2 ${className}`}>
      <p className="text-[8px] text-teal-400 font-black uppercase tracking-widest flex items-center gap-2"><Tag size={11} /> {titulo}</p>
      <div className="grid grid-cols-2 gap-2">
        <select value={v.servicio} onChange={e => set('servicio', e.target.value)} className={sel}>
          <option value="">— SERVICIO / CUENTA —</option>
          {servicios.map(s => <option key={s.k} value={s.k}>{s.cod} · {s.l}</option>)}
        </select>
        <select value={v.aeronave} onChange={e => set('aeronave', e.target.value)} className={sel}>
          <option value="">— AERONAVE —</option>
          {flota.map(m => <option key={m} value={m}>{m}</option>)}
          {v.aeronave && !flota.includes(v.aeronave) && <option value={v.aeronave}>{v.aeronave}</option>}
        </select>
        <select value={v.sede} onChange={e => set('sede', e.target.value)} className={sel}>
          <option value="">— SEDE / BASE —</option>
          {SEDES_FIN.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
        </select>
        <select value={v.piloto} onChange={e => set('piloto', e.target.value)} className={sel}>
          <option value="">— PILOTO / INSTRUCTOR —</option>
          {pilotos.map(p => <option key={p} value={p}>{p}</option>)}
          {v.piloto && !pilotos.includes(v.piloto) && <option value={v.piloto}>{v.piloto}</option>}
        </select>
        <input value={v.proyecto} onChange={e => set('proyecto', e.target.value)} placeholder="PROYECTO / COHORTE (opcional)" className={`${sel} col-span-2`} />
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

// ─── [NEW v17] REPORTES FINANCIEROS ───────────────────────────────────────────
//  Base DEVENGADO: ingresos = consumos de billetera + ventas a crédito (CxC al emitir) + ingresos directos;
//                  gastos = gastos directos + CxP al emitir. Excluye anticipos, reembolsos, cobros de CxC y pagos
//                  de CxP (ya reconocidos), FX, financiamiento y reposiciones internas.
//  Base EFECTIVO : todo movimiento operativo de bóveda (incluye anticipos recibidos y reembolsos como líneas propias).

type BasePL      = 'DEVENGADO' | 'EFECTIVO';
type DimensionPL = 'aeronave' | 'sede' | 'piloto' | 'proyecto';
type ReporteKey  = 'PL' | 'PL_CLASE' | 'BALANCE' | 'FLUJO' | 'AGING' | 'SIN_CLASE' | 'IMPRESION';

interface LineaPL {
  fecha: string; nat: 'INGRESO' | 'GASTO'; servicio: string; aeronave: string; sede: string; piloto: string; proyecto: string;
  usd: number; origen: string; ref: string; detalle: string; inferida: boolean; tabla: TablaClase | null; registroId: string | null;
}

const DIMENSIONES: { k: DimensionPL; l: string }[] = [
  { k: 'aeronave', l: 'Aeronave (matrícula)' }, { k: 'sede', l: 'Sede / base de operación' },
  { k: 'piloto', l: 'Piloto / instructor' },    { k: 'proyecto', l: 'Proyecto / cohorte' },
];
const REPORTES: { k: ReporteKey; l: string }[] = [
  { k: 'PL', l: 'Estado de resultados' }, { k: 'PL_CLASE', l: 'P&L por clase' }, { k: 'BALANCE', l: 'Balance general' },
  { k: 'FLUJO', l: 'Flujo de efectivo' }, { k: 'AGING', l: 'Antigüedad CxC / CxP' }, { k: 'SIN_CLASE', l: 'Sin clasificar' },
  { k: 'IMPRESION', l: 'Imprimir movimientos' },
];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prefijoRef = (ref: string | null | undefined) => String(ref ?? '').split('-')[0].toUpperCase();
/** Servicio inferido de un gasto por su texto (solo cuando no hay clase explícita) */
const inferirGasto = (txt: string, esNomina: boolean): string => {
  const x = txt.toLowerCase();
  if (esNomina || /n[oó]mina|payroll|sueldo|salario/.test(x)) return 'NOMINA_INSTRUCCION';
  if (/fuel|combust|avgas|jet ?a|gasolina/.test(x)) return 'COMBUSTIBLE';
  if (/mainten|manten|repuest|parts|taller|inspecci|overhaul|aceite|mro/.test(x)) return 'MANTENIMIENTO';
  if (/segur|insur|p[oó]liza/.test(x)) return 'SEGUROS';
  if (/hangar|aeropuert|aterriz|parking|tasa aero|estacionamiento/.test(x)) return 'AEROPUERTO';
  if (/impuest|seniat|tribut|iva\b/.test(x)) return 'IMPUESTOS';
  if (/publicidad|marketing|mercadeo|redes sociales/.test(x)) return 'MARKETING';
  return 'OTROS_GASTOS';
};
/** Inventario MRO valorizado si los ítems traen cantidad y costo (estimado, memo). */
const valorInventario = (inv: unknown[]): { total: number; n: number } => {
  let total = 0, n = 0;
  for (const raw of inv ?? []) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const q = Number(it.quantity ?? it.cantidad ?? it.stock ?? it.qty);
    const c = Number(it.unitCost ?? it.unit_cost ?? it.costo_unitario ?? it.costo ?? it.cost);
    if (Number.isFinite(q) && Number.isFinite(c) && q > 0 && c > 0) { total += q * c; n++; }
  }
  return { total: round2(total), n };
};

interface ReportesProps {
  transactions: LedgerTx[]; clasifMap: Map<string, ClasificacionRow>; consumos: WalletConsumo[];
  walletMovs: WalletMovimiento[]; walletCuentas: WalletCuenta[]; cuentasCxC: CuentaPorCobrar[]; cuentas: CuentaGeneral[];
  abonos: AbonoCuenta[]; provisionales: PagoProvisional[]; provisionalAplicado: Set<string>; flota: string[];
  alumnos: AlumnoCxC[]; cajas: CajaChica[]; movCajas: MovimientoCaja[]; tasaBCV: number; inventory: unknown[];
  v17: boolean; canEdit: boolean;
  onReclasificar: (a: ReclasAccion) => void;
  onImprimirCaja: (cajaId: string | null, desde: string, hasta: string) => void;
  onImprimirAlumno: (studentId: string) => void;
}

const ReportesFinancieros: React.FC<ReportesProps> = ({
  transactions, clasifMap, consumos, walletMovs, walletCuentas, cuentasCxC, cuentas, abonos, provisionales,
  provisionalAplicado, flota, alumnos, cajas, movCajas, tasaBCV, inventory, v17, canEdit,
  onReclasificar, onImprimirCaja, onImprimirAlumno,
}) => {
  const hoy = ymd(new Date());
  const [rep,   setRep]   = useState<ReporteKey>('PL');
  const [base,  setBase]  = useState<BasePL>('DEVENGADO');
  const [dim,   setDim]   = useState<DimensionPL>('aeronave');
  const [desde, setDesde] = useState(() => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [hasta, setHasta] = useState(hoy);
  const [selSinClase, setSelSinClase] = useState<Set<string>>(new Set());
  const [cajaImp,   setCajaImp]   = useState('');
  const [alumnoImp, setAlumnoImp] = useState('');

  const aUsd = useCallback((monto: number, moneda: string | null | undefined) =>
    normalizePaymentMethod(moneda) === 'BS' ? (tasaBCV > 0 ? round2(monto / tasaBCV) : 0) : round2(monto), [tasaBCV]);
  const nombreAlumno = useMemo(() => new Map(alumnos.map(a => [a.student_id, a.nombre])), [alumnos]);

  const presets: { l: string; d: string; h: string }[] = useMemo(() => {
    const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
    return [
      { l: 'Mes actual',    d: ymd(new Date(y, m, 1)),                 h: ymd(n) },
      { l: 'Mes anterior',  d: ymd(new Date(y, m - 1, 1)),             h: ymd(new Date(y, m, 0)) },
      { l: 'Trimestre',     d: ymd(new Date(y, Math.floor(m / 3) * 3, 1)), h: ymd(n) },
      { l: 'Año en curso',  d: ymd(new Date(y, 0, 1)),                 h: ymd(n) },
      { l: 'Histórico',     d: '2000-01-01',                           h: ymd(n) },
    ];
  }, []);

  // ── Índices ─────────────────────────────────────────────────────────────
  const idx = useMemo(() => {
    const abonosPorAsiento = new Map<string, AbonoCuenta[]>();
    for (const a of abonos) abonosPorAsiento.set(a.asiento_id, [...(abonosPorAsiento.get(a.asiento_id) ?? []), a]);
    const cxcById       = new Map(cuentasCxC.map(c => [String(c.id), c]));
    const consumoPorCxc = new Map(consumos.filter(c => c.cxc_id && c.estado === 'VIGENTE').map(c => [String(c.cxc_id), c]));
    const prefPorAsiento = new Map<string, string>();
    for (const t of transactions) if (t.asiento_id) prefPorAsiento.set(t.asiento_id, prefijoRef(t.invoiceNumber));
    const facturasHora = new Set(transactions.map(t => String(t.invoiceNumber ?? '')).filter(r => r.startsWith('HORA-')).map(r => r.slice(5)));
    const cxcHorasPagadas = new Set<string>();
    for (const c of cuentasCxC) if (c.asiento_origen_id || facturasHora.has(String(c.id))) cxcHorasPagadas.add(String(c.id));
    for (const a of abonos) if (a.cuenta_tipo === 'CXC' && prefPorAsiento.get(a.asiento_id) === 'HRS') cxcHorasPagadas.add(a.cuenta_id);
    const flotaNorm = flota.map(m => ({ m, n: normMatricula(m) })).filter(x => x.n.length >= 3);
    const sedeCajaPorAsiento = new Map<string, string>();
    for (const mv of movCajas) {
      if (!mv.asiento_id) continue;
      const nom = (cajas.find(x => x.id === mv.caja_id)?.nombre ?? '').toUpperCase();
      const sede = /MATUR/.test(nom) ? 'MATURIN' : /BARQUI|LARA/.test(nom) ? 'BARQUISIMETO' : '';
      if (sede) sedeCajaPorAsiento.set(mv.asiento_id, sede);
    }
    const sedeAlumno = new Map(alumnos.map(a => [a.student_id, normTxt(a.sede).replace('Í', 'I')]));
    return { abonosPorAsiento, cxcById, consumoPorCxc, cxcHorasPagadas, flotaNorm, sedeCajaPorAsiento, sedeAlumno };
  }, [abonos, cuentasCxC, consumos, transactions, flota, movCajas, cajas, alumnos]);

  const aeronaveEnTexto = useCallback((txt: string) => {
    const blob = normMatricula(txt);
    return idx.flotaNorm.find(f => blob.includes(f.n))?.m ?? '';
  }, [idx]);

  const usdTx = useCallback((t: LedgerTx) => {
    if (normalizePaymentMethod(t.payment_method) !== 'BS') return round2(t.amount);
    const tr = clasifMap.get(`transacciones_finanzas:${t.id}`)?.tasa_ref;
    const tasa = tr && tr > 0 ? tr : tasaBCV;
    return tasa > 0 ? round2(t.amount / tasa) : 0;
  }, [clasifMap, tasaBCV]);

  const esReembolsoTx = (t: LedgerTx) => t.category === CATEGORIA_REEMBOLSO || prefijoRef(t.invoiceNumber) === 'WRE';
  const esAnticipoTx  = (t: LedgerTx, c?: ClasificacionRow) =>
    t.category === CATEGORIA_BILLETERA || t.category === 'Anticipos sin matrícula' || c?.servicio === 'ANTICIPO_ALUMNO' || prefijoRef(t.invoiceNumber) === 'WAL';

  /** Clase de una pata del Diario: explícita (clasificacion_contable) o inferida (abonos, consumo, texto, caja, alumno) */
  const claseTx = useCallback((t: LedgerTx, nat: 'INGRESO' | 'GASTO') => {
    const c    = clasifMap.get(`transacciones_finanzas:${t.id}`);
    const pref = prefijoRef(t.invoiceNumber);
    const txt  = `${t.category ?? ''} ${t.description ?? ''} ${t.entityName ?? ''}`;
    const abs  = t.asiento_id ? idx.abonosPorAsiento.get(t.asiento_id) ?? [] : [];
    const abCxc = abs.find(a => a.cuenta_tipo === 'CXC');
    const abCxp = abs.find(a => a.cuenta_tipo === 'CXP');
    const consumo = abCxc ? idx.consumoPorCxc.get(abCxc.cuenta_id) : undefined;
    const cxpCl   = abCxp ? clasifMap.get(`cuentas_generales:${abCxp.cuenta_id}`) : undefined;
    const entityId = (t as { entityId?: string | null }).entityId ?? null;
    let servicio = c?.servicio ?? '';
    if (!servicio) {
      if (nat === 'INGRESO') {
        if (pref === 'HRS' || pref === 'HORA' || /horas pagadas/i.test(txt)) servicio = 'PAQUETES_HORAS';
        else if (consumo) servicio = consumo.clase_servicio;
        else if (abCxc) { const cx = idx.cxcById.get(abCxc.cuenta_id); servicio = cx && cx.horas_prometidas > 0 ? 'PAQUETES_HORAS' : 'MATRICULA'; }
        else if (/academia|matr[ií]cula|inscripci/i.test(txt)) servicio = 'MATRICULA';
        else servicio = 'OTROS_INGRESOS';
      } else {
        servicio = cxpCl?.servicio || inferirGasto(txt, String(t.type) === 'INSTRUCTOR_PAY');
      }
    }
    return {
      servicio,
      aeronave: c?.aeronave || consumo?.clase_aeronave || cxpCl?.aeronave || aeronaveEnTexto(`${t.description ?? ''} ${t.entityName ?? ''}`),
      sede:     c?.sede || consumo?.clase_sede || cxpCl?.sede || (t.asiento_id ? idx.sedeCajaPorAsiento.get(t.asiento_id) ?? '' : '')
                || (entityId ? idx.sedeAlumno.get(String(entityId)) ?? '' : ''),
      piloto:   c?.piloto || consumo?.clase_piloto || cxpCl?.piloto
                || (String(t.type) === 'INSTRUCTOR_PAY' ? normTxt(String(t.entityName ?? '').replace(/^N[ÓO]MINA:\s*/i, '')) : ''),
      proyecto: c?.proyecto || consumo?.clase_proyecto || cxpCl?.proyecto || '',
      inferida: !c?.servicio,
    };
  }, [clasifMap, idx, aeronaveEnTexto]);

  // ── Líneas del Estado de Resultados ─────────────────────────────────────
  const lineas = useMemo<LineaPL[]>(() => {
    const out: LineaPL[] = [];
    const enP = (d: string | Date | null | undefined) => { const f = fechaInput(d); return f >= desde && f <= hasta; };   // issueDate: string | Date
    for (const t of transactions) {
      if (t.status !== 'PAID' || isFxTx(t) || isFinancingTx(t) || esReposicionLegacy(t) || t.category === 'Reposición Interna') continue;
      if (!enP(t.issueDate)) continue;
      const s = signedLedgerAmount(t);
      if (Math.abs(s) < 0.005) continue;
      const nat: 'INGRESO' | 'GASTO' = s > 0 ? 'INGRESO' : 'GASTO';
      const c     = clasifMap.get(`transacciones_finanzas:${t.id}`);
      const reemb = esReembolsoTx(t);
      const antic = !reemb && esAnticipoTx(t, c);
      const abs   = t.asiento_id ? idx.abonosPorAsiento.get(t.asiento_id) ?? [] : [];
      const pref  = prefijoRef(t.invoiceNumber);
      if (base === 'DEVENGADO') {
        if (antic || reemb) continue;                                                                    // pasivo, no resultado
        if (nat === 'INGRESO' && (pref === 'CXC' || (pref !== 'HRS' && abs.some(a => a.cuenta_tipo === 'CXC')))) continue;   // cobro de CxC
        if (nat === 'GASTO' && abs.some(a => a.cuenta_tipo === 'CXP')) continue;                          // pago de CxP
      }
      const cl = claseTx(t, nat);
      out.push({
        fecha: fechaInput(t.issueDate), nat,
        servicio: reemb ? 'REEMBOLSO_ALUMNO' : antic ? 'ANTICIPO_ALUMNO' : cl.servicio,
        aeronave: cl.aeronave, sede: cl.sede, piloto: cl.piloto, proyecto: cl.proyecto,
        usd: usdTx(t), origen: 'Diario', ref: t.invoiceNumber, detalle: `${t.entityName} · ${t.description}`,
        inferida: cl.inferida && !antic && !reemb, tabla: 'transacciones_finanzas', registroId: t.id,
      });
    }
    if (base === 'DEVENGADO') {
      for (const c of consumos) {
        if (c.estado !== 'VIGENTE' || c.modo !== 'BILLETERA' || c.monto_total_usd <= 0 || !enP(c.fecha)) continue;
        out.push({
          fecha: fechaInput(c.fecha), nat: 'INGRESO', servicio: c.clase_servicio || SERVICIO_POR_TIPO[c.tipo],
          aeronave: c.clase_aeronave ?? '', sede: c.clase_sede ?? '', piloto: c.clase_piloto ?? '', proyecto: c.clase_proyecto ?? '',
          usd: c.monto_total_usd, origen: 'Consumo', ref: c.id.slice(0, 8).toUpperCase(),
          detalle: `${nombreAlumno.get(c.student_id) ?? 'ALUMNO'} · ${c.descripcion}`, inferida: false, tabla: null, registroId: null,
        });
      }
      for (const m of walletMovs) {
        if (m.revertido || !enP(m.fecha) || (m.tipo !== 'AJUSTE_CREDITO' && m.tipo !== 'AJUSTE_DEBITO')) continue;
        out.push({
          fecha: fechaInput(m.fecha), nat: 'INGRESO', servicio: m.tipo === 'AJUSTE_CREDITO' ? 'BONIFICACIONES' : 'CARGOS_AJUSTE',
          aeronave: '', sede: idx.sedeAlumno.get(m.student_id) ?? '', piloto: '', proyecto: '',
          usd: m.tipo === 'AJUSTE_CREDITO' ? -m.monto_usd : m.monto_usd, origen: 'Ajuste billetera', ref: m.referencia,
          detalle: `${nombreAlumno.get(m.student_id) ?? 'ALUMNO'} · ${m.concepto}`, inferida: false, tabla: null, registroId: null,
        });
      }
      for (const c of cuentasCxC) {
        const id = String(c.id);
        if (idx.consumoPorCxc.has(id) || idx.cxcHorasPagadas.has(id) || c.monto_total <= 0 || !enP(c.fecha_emision)) continue;
        out.push({
          fecha: fechaInput(c.fecha_emision), nat: 'INGRESO', servicio: c.horas_prometidas > 0 ? 'PAQUETES_HORAS' : 'MATRICULA',
          aeronave: '', sede: idx.sedeAlumno.get(c.student_id) ?? '', piloto: '', proyecto: '',
          usd: aUsd(c.monto_total, c.moneda), origen: 'Venta a crédito (CxC)', ref: id.slice(0, 8).toUpperCase(),
          detalle: `${c.nombre_alumno} · ${c.concepto}`, inferida: false, tabla: null, registroId: null,
        });
      }
      for (const c of cuentas) {
        if (c.categoria_interna === 'REPOSICION_CAJA' || c.entidad_tipo === 'PRESTAMISTA' || !enP(c.fecha_emision)) continue;
        const cl = clasifMap.get(`cuentas_generales:${c.id}`);
        const txt = `${c.entidad_nombre} ${c.concepto} ${c.notas ?? ''}`;
        out.push({
          fecha: fechaInput(c.fecha_emision), nat: 'GASTO', servicio: cl?.servicio || inferirGasto(txt, false),
          aeronave: cl?.aeronave || aeronaveEnTexto(txt), sede: cl?.sede ?? '', piloto: cl?.piloto ?? '', proyecto: cl?.proyecto ?? '',
          usd: aUsd(c.monto_total, c.moneda), origen: 'Factura proveedor (CxP)', ref: String(c.id).slice(0, 8).toUpperCase(),
          detalle: `${c.entidad_nombre} · ${c.concepto}`, inferida: !cl?.servicio, tabla: 'cuentas_generales', registroId: c.id,
        });
      }
    }
    return out;
  }, [transactions, clasifMap, idx, base, desde, hasta, claseTx, usdTx, consumos, walletMovs, cuentasCxC, cuentas, aUsd, nombreAlumno, aeronaveEnTexto]);

  // ── Estado de resultados ────────────────────────────────────────────────
  const resumen = useMemo(() => {
    const acc = new Map<string, { nat: 'INGRESO' | 'GASTO'; servicio: string; usd: number; n: number; inferidas: number }>();
    for (const l of lineas) {
      const k = `${l.nat}|${l.servicio}`;
      const cur = acc.get(k) ?? { nat: l.nat, servicio: l.servicio, usd: 0, n: 0, inferidas: 0 };
      cur.usd = round2(cur.usd + l.usd); cur.n += 1; if (l.inferida) cur.inferidas += 1;
      acc.set(k, cur);
    }
    const orden = (a: { servicio: string }, b: { servicio: string }) =>
      (SERVICIO_ORDEN.get(a.servicio) ?? 99) - (SERVICIO_ORDEN.get(b.servicio) ?? 99) || a.servicio.localeCompare(b.servicio);
    const ingresos = Array.from(acc.values()).filter(x => x.nat === 'INGRESO').sort(orden);
    const gastos   = Array.from(acc.values()).filter(x => x.nat === 'GASTO').sort(orden);
    const totIng = round2(ingresos.reduce((a, x) => a + x.usd, 0));
    const totGas = round2(gastos.reduce((a, x) => a + x.usd, 0));
    const utilidad = round2(totIng - totGas);
    return { ingresos, gastos, totIng, totGas, utilidad, margen: totIng > 0 ? utilidad / totIng : 0 };
  }, [lineas]);

  // ── P&L por clase ───────────────────────────────────────────────────────
  const porClase = useMemo(() => {
    const val = (l: LineaPL) => l[dim] || 'SIN CLASE';
    const act = new Map<string, number>();
    for (const l of lineas) act.set(val(l), (act.get(val(l)) ?? 0) + Math.abs(l.usd));
    const cols = Array.from(act.keys()).sort((a, b) =>
      a === 'SIN CLASE' ? 1 : b === 'SIN CLASE' ? -1 : (act.get(b) ?? 0) - (act.get(a) ?? 0));
    const celdas = new Map<string, Map<string, number>>();
    for (const l of lineas) {
      const k = `${l.nat}|${l.servicio}`;
      const fila = celdas.get(k) ?? new Map<string, number>();
      fila.set(val(l), round2((fila.get(val(l)) ?? 0) + l.usd));
      celdas.set(k, fila);
    }
    const filas = (nat: 'INGRESO' | 'GASTO') => Array.from(celdas.entries())
      .filter(([k]) => k.startsWith(`${nat}|`))
      .map(([k, m]) => ({ servicio: k.split('|')[1], m, total: round2(Array.from(m.values()).reduce((a, x) => a + x, 0)) }))
      .sort((a, b) => (SERVICIO_ORDEN.get(a.servicio) ?? 99) - (SERVICIO_ORDEN.get(b.servicio) ?? 99));
    const ing = filas('INGRESO'), gas = filas('GASTO');
    const totCol = (fs: { m: Map<string, number> }[], c: string) => round2(fs.reduce((a, f) => a + (f.m.get(c) ?? 0), 0));
    const totIng = new Map(cols.map(c => [c, totCol(ing, c)]));
    const totGas = new Map(cols.map(c => [c, totCol(gas, c)]));
    const util   = new Map(cols.map(c => [c, round2((totIng.get(c) ?? 0) - (totGas.get(c) ?? 0))]));
    return { cols, ing, gas, totIng, totGas, util };
  }, [lineas, dim]);

  // ── Balance general (al día) ────────────────────────────────────────────
  const balance = useMemo(() => {
    const bovedas = ALL_METHODS.map(m => {
      const nativo = round2(transactions.filter(t => t.status === 'PAID' && t.payment_method === m).reduce((a, t) => a + signedLedgerAmount(t), 0));
      return { m, nativo, usd: m === 'BS' ? (tasaBCV > 0 ? round2(nativo / tasaBCV) : 0) : nativo };
    });
    const efectivo   = round2(bovedas.reduce((a, b) => a + b.usd, 0));
    const pendCxc    = cuentasCxC.filter(c => c.estatus === 'PENDIENTE' || c.estatus === 'PARCIAL');
    const cxcBill    = round2(pendCxc.filter(c => idx.consumoPorCxc.has(String(c.id))).reduce((a, c) => a + aUsd(c.monto_pendiente, c.moneda), 0));
    const cxcOtras   = round2(pendCxc.filter(c => !idx.consumoPorCxc.has(String(c.id))).reduce((a, c) => a + aUsd(c.monto_pendiente, c.moneda), 0));
    const activos    = round2(efectivo + cxcBill + cxcOtras);
    const pend       = cuentas.filter(c => c.estatus !== 'PAGADO');
    const cxpProv    = round2(pend.filter(c => c.categoria_interna !== 'REPOSICION_CAJA' && c.entidad_tipo !== 'PRESTAMISTA').reduce((a, c) => a + aUsd(c.monto_pendiente, c.moneda), 0));
    const prestamos  = round2(pend.filter(c => c.entidad_tipo === 'PRESTAMISTA').reduce((a, c) => a + aUsd(c.monto_pendiente, c.moneda), 0));
    const billeteras = round2(walletCuentas.reduce((a, w) => a + w.saldo_usd, 0));
    const provPend   = round2(provisionales.filter(p => (p.estado === 'PENDIENTE' || p.estado === 'VINCULADO') && !provisionalAplicado.has(p.id))
      .reduce((a, p) => a + aUsd(p.monto, p.moneda), 0));
    const pasivos    = round2(cxpProv + prestamos + billeteras + provPend);
    const reposiciones = round2(pend.filter(c => c.categoria_interna === 'REPOSICION_CAJA').reduce((a, c) => a + aUsd(c.monto_pendiente, c.moneda), 0));
    return { bovedas, efectivo, cxcBill, cxcOtras, activos, cxpProv, prestamos, billeteras, provPend, pasivos,
      patrimonio: round2(activos - pasivos), reposiciones, inventario: valorInventario(inventory) };
  }, [transactions, tasaBCV, cuentasCxC, idx, aUsd, cuentas, walletCuentas, provisionales, provisionalAplicado, inventory]);

  // ── Flujo de efectivo ───────────────────────────────────────────────────
  const flujo = useMemo(() => {
    const G: [string, string][] = [
      ['OP_ANTICIPOS', 'Cobros a alumnos · recargas de billetera'], ['OP_ALUMNOS', 'Cobros a alumnos · paquetes y CxC'],
      ['OP_SINMAT', 'Anticipos sin matrícula'], ['OP_OTROS_ING', 'Otros ingresos operativos'], ['OP_REEMB', 'Reembolsos a alumnos'],
      ['OP_PROV', 'Pagos a proveedores (CxP)'], ['OP_NOMINA', 'Nómina'], ['OP_GASTOS', 'Gastos directos y caja chica'],
      ['FIN_IN', 'Préstamos recibidos'], ['FIN_OUT', 'Devoluciones de préstamos'], ['FX', 'Cambio de moneda (diferencial FX)'],
    ];
    const g = new Map<string, number>(G.map(([k]) => [k, 0]));
    let inicial = 0;
    for (const t of transactions) {
      if (t.status !== 'PAID') continue;
      const s = signedLedgerAmount(t);
      if (Math.abs(s) < 0.005) continue;
      const v = round2(Math.sign(s) * usdTx(t));
      const f = fechaInput(t.issueDate);
      if (f < desde) { inicial = round2(inicial + v); continue; }
      if (f > hasta) continue;
      const pref = prefijoRef(t.invoiceNumber);
      const abs  = t.asiento_id ? idx.abonosPorAsiento.get(t.asiento_id) ?? [] : [];
      const ty   = String(t.type);
      const k = isFxTx(t) ? 'FX'
        : ty === 'FINANCING_IN' ? 'FIN_IN' : ty === 'FINANCING_OUT' ? 'FIN_OUT'
        : esReembolsoTx(t) ? 'OP_REEMB'
        : (t.category === CATEGORIA_BILLETERA || pref === 'WAL') ? 'OP_ANTICIPOS'
        : t.category === 'Anticipos sin matrícula' ? 'OP_SINMAT'
        : v > 0 ? (['HRS', 'HORA', 'COB', 'CXC'].includes(pref) || t.category === 'Academia' ? 'OP_ALUMNOS' : 'OP_OTROS_ING')
        : (abs.some(a => a.cuenta_tipo === 'CXP') || pref === 'PAG') ? 'OP_PROV'
        : (ty === 'INSTRUCTOR_PAY' || pref === 'NOM') ? 'OP_NOMINA' : 'OP_GASTOS';
      g.set(k, round2((g.get(k) ?? 0) + v));
    }
    const filas = G.map(([k, l]) => ({ k, l, v: g.get(k) ?? 0 }));
    const op  = round2(filas.filter(f => f.k.startsWith('OP_')).reduce((a, f) => a + f.v, 0));
    const fin = round2(filas.filter(f => f.k.startsWith('FIN_')).reduce((a, f) => a + f.v, 0));
    const fx  = g.get('FX') ?? 0;
    const neto = round2(op + fin + fx);
    return { filas, inicial, op, fin, fx, neto, final: round2(inicial + neto) };
  }, [transactions, usdTx, desde, hasta, idx]);

  // ── Antigüedad ──────────────────────────────────────────────────────────
  const aging = useMemo(() => {
    const ref = Date.parse(hoy);
    const bucket = (d: string | null | undefined) => {
      const dias = Math.max(0, Math.floor((ref - Date.parse(fechaInput(d))) / 86_400_000));
      return dias <= 30 ? 0 : dias <= 60 ? 1 : dias <= 90 ? 2 : 3;
    };
    const agrupar = <T,>(items: T[], key: (x: T) => string, fecha: (x: T) => string, monto: (x: T) => number) => {
      const m = new Map<string, number[]>();
      for (const it of items) {
        const fila = m.get(key(it)) ?? [0, 0, 0, 0, 0];
        const b = bucket(fecha(it)); const v = monto(it);
        fila[b] = round2(fila[b] + v); fila[4] = round2(fila[4] + v);
        m.set(key(it), fila);
      }
      return Array.from(m.entries()).sort((a, b) => b[1][4] - a[1][4]);
    };
    const cxc = agrupar(cuentasCxC.filter(c => (c.estatus === 'PENDIENTE' || c.estatus === 'PARCIAL') && c.monto_pendiente > 0),
      c => c.nombre_alumno || 'ALUMNO', c => c.fecha_emision, c => aUsd(c.monto_pendiente, c.moneda));
    const cxp = agrupar(cuentas.filter(c => c.estatus !== 'PAGADO' && c.categoria_interna !== 'REPOSICION_CAJA' && c.monto_pendiente > 0),
      c => c.entidad_nombre, c => c.fecha_emision, c => aUsd(c.monto_pendiente, c.moneda));
    const tot = (rows: [string, number[]][]) => [0, 1, 2, 3, 4].map(i => round2(rows.reduce((a, r) => a + r[1][i], 0)));
    return { cxc, cxp, totCxc: tot(cxc), totCxp: tot(cxp) };
  }, [cuentasCxC, cuentas, aUsd, hoy]);

  const sinClase = useMemo(() => lineas.filter(l => l.tabla && l.registroId && l.inferida), [lineas]);

  // ── Impresión / CSV ─────────────────────────────────────────────────────
  const periodoTxt = `${fmtDate(desde)} – ${fmtDate(hasta)}`;
  const metaBase: [string, string][] = [['Período', periodoTxt], ['Base', base === 'DEVENGADO' ? 'Devengado' : 'Efectivo'], ['Tasa Bs/USD', String(tasaBCV)]];
  const pct = (v: number, t: number) => (t > 0 ? `${((v / t) * 100).toFixed(1)}%` : '—');

  const imprimirReporte = () => {
    if (rep === 'PL') {
      imprimirDocumento({
        titulo: 'Estado de Resultados', subtitulo: base === 'DEVENGADO' ? 'Base devengado (consumos y facturación del período)' : 'Base efectivo (movimientos de bóveda)',
        meta: metaBase,
        resumen: [['Ingresos', usd(resumen.totIng)], ['Gastos', usd(resumen.totGas)], ['Resultado neto', usd(resumen.utilidad)], ['Margen', pct(resumen.utilidad, resumen.totIng)]],
        secciones: [
          { titulo: 'Ingresos', columnas: ['Cuenta', 'Movs.', 'USD', '% ingresos'], alinear: ['l', 'r', 'r', 'r'],
            filas: resumen.ingresos.map(x => [labelServicio(x.servicio), x.n, usd(x.usd), pct(x.usd, resumen.totIng)]),
            totales: ['Total ingresos', '', usd(resumen.totIng), '100%'] },
          { titulo: 'Gastos', columnas: ['Cuenta', 'Movs.', 'USD', '% ingresos'], alinear: ['l', 'r', 'r', 'r'],
            filas: resumen.gastos.map(x => [labelServicio(x.servicio), x.n, usd(x.usd), pct(x.usd, resumen.totIng)]),
            totales: ['Total gastos', '', usd(resumen.totGas), pct(resumen.totGas, resumen.totIng)] },
          { titulo: 'Resultado', columnas: ['Concepto', 'USD'], alinear: ['l', 'r'],
            filas: [['Ingresos', usd(resumen.totIng)], ['(−) Gastos', usd(resumen.totGas)]], totales: ['Resultado neto', usd(resumen.utilidad)],
            nota: 'Bolívares convertidos a la tasa registrada en el movimiento o, en su defecto, a la tasa vigente del panel. No incluye depreciación de aeronaves.' },
        ],
      });
    } else if (rep === 'PL_CLASE') {
      const cols = porClase.cols;
      const fila = (f: { servicio: string; m: Map<string, number>; total: number }) => [labelServicio(f.servicio), ...cols.map(c => usd(f.m.get(c) ?? 0)), usd(f.total)];
      const tot = (m: Map<string, number>) => usd(round2(cols.reduce((a, c) => a + (m.get(c) ?? 0), 0)));
      const al: ('l' | 'r')[] = ['l', ...cols.map(() => 'r' as const), 'r'];
      imprimirDocumento({
        titulo: `Estado de Resultados por ${DIMENSIONES.find(d => d.k === dim)?.l ?? dim}`, horizontal: true, meta: metaBase,
        secciones: [
          { titulo: 'Ingresos', columnas: ['Cuenta', ...cols, 'Total'], alinear: al, filas: porClase.ing.map(fila),
            totales: ['Total ingresos', ...cols.map(c => usd(porClase.totIng.get(c) ?? 0)), tot(porClase.totIng)] },
          { titulo: 'Gastos', columnas: ['Cuenta', ...cols, 'Total'], alinear: al, filas: porClase.gas.map(fila),
            totales: ['Total gastos', ...cols.map(c => usd(porClase.totGas.get(c) ?? 0)), tot(porClase.totGas)] },
          { titulo: 'Rentabilidad', columnas: ['Concepto', ...cols, 'Total'], alinear: al,
            filas: [['Margen %', ...cols.map(c => pct(porClase.util.get(c) ?? 0, porClase.totIng.get(c) ?? 0)), pct(resumen.utilidad, resumen.totIng)]],
            totales: ['Resultado', ...cols.map(c => usd(porClase.util.get(c) ?? 0)), usd(resumen.utilidad)],
            nota: '"SIN CLASE" agrupa movimientos sin esa dimensión. Clasifíquelos en Reportes → Sin clasificar para afinar la rentabilidad por aeronave.' },
        ],
      });
    } else if (rep === 'BALANCE') {
      const b = balance;
      imprimirDocumento({
        titulo: 'Balance General', subtitulo: `Al ${fmtDate(hoy)}`, meta: [['Tasa Bs/USD', String(tasaBCV)]],
        resumen: [['Activos', usd(b.activos)], ['Pasivos', usd(b.pasivos)], ['Patrimonio', usd(b.patrimonio)]],
        secciones: [
          { titulo: 'Activos', columnas: ['Cuenta', 'Moneda nativa', 'USD'], alinear: ['l', 'r', 'r'],
            filas: [
              ...b.bovedas.map(x => [`Bóveda ${x.m}`, fmtMonto(x.nativo, x.m), usd(x.usd)]),
              ['Cuentas por cobrar · consumos de billetera', '', usd(b.cxcBill)],
              ['Cuentas por cobrar · alumnos (otras)', '', usd(b.cxcOtras)],
            ], totales: ['Total activos', '', usd(b.activos)] },
          { titulo: 'Pasivos', columnas: ['Cuenta', '', 'USD'], alinear: ['l', 'r', 'r'],
            filas: [
              ['Cuentas por pagar · proveedores', '', usd(b.cxpProv)], ['Préstamos por pagar', '', usd(b.prestamos)],
              ['Anticipos de alumnos · billeteras', '', usd(b.billeteras)], ['Anticipos sin matrícula por aplicar', '', usd(b.provPend)],
            ], totales: ['Total pasivos', '', usd(b.pasivos)] },
          { titulo: 'Patrimonio', columnas: ['Cuenta', '', 'USD'], alinear: ['l', 'r', 'r'],
            filas: [['Patrimonio neto (activos − pasivos)', '', usd(b.patrimonio)]], totales: ['Total pasivo + patrimonio', '', usd(b.activos)],
            nota: `Memo: reposiciones internas entre cajas ${usd(b.reposiciones)} (no son deuda con terceros).${b.inventario.n ? ` Inventario MRO estimado ${usd(b.inventario.total)} (${b.inventario.n} ítems, no incluido).` : ''} No incluye aeronaves ni activos fijos.` },
        ],
      });
    } else if (rep === 'FLUJO') {
      imprimirDocumento({
        titulo: 'Estado de Flujo de Efectivo', meta: metaBase.filter(([k]) => k !== 'Base'),
        resumen: [['Saldo inicial', usd(flujo.inicial)], ['Variación neta', usd(flujo.neto)], ['Saldo final', usd(flujo.final)]],
        secciones: [
          { titulo: 'Actividades de operación', columnas: ['Concepto', 'USD'], alinear: ['l', 'r'],
            filas: flujo.filas.filter(f => f.k.startsWith('OP_')).map(f => [f.l, usd(f.v)]), totales: ['Flujo operativo', usd(flujo.op)] },
          { titulo: 'Actividades de financiamiento', columnas: ['Concepto', 'USD'], alinear: ['l', 'r'],
            filas: flujo.filas.filter(f => f.k.startsWith('FIN_')).map(f => [f.l, usd(f.v)]), totales: ['Flujo de financiamiento', usd(flujo.fin)] },
          { titulo: 'Conciliación', columnas: ['Concepto', 'USD'], alinear: ['l', 'r'],
            filas: [['Saldo inicial de efectivo', usd(flujo.inicial)], ['Flujo operativo', usd(flujo.op)], ['Flujo de financiamiento', usd(flujo.fin)], ['Cambio de moneda (FX)', usd(flujo.fx)]],
            totales: ['Saldo final de efectivo', usd(flujo.final)] },
        ],
      });
    } else if (rep === 'AGING') {
      const cols = ['Entidad', '0–30 d', '31–60 d', '61–90 d', '+90 d', 'Total'];
      const al: ('l' | 'r')[] = ['l', 'r', 'r', 'r', 'r', 'r'];
      imprimirDocumento({
        titulo: 'Antigüedad de Saldos', subtitulo: 'Días desde la emisión', meta: [['Corte', fmtDate(hoy)]],
        secciones: [
          { titulo: 'Cuentas por cobrar (alumnos)', columnas: cols, alinear: al, filas: aging.cxc.map(([k, v]) => [k, ...v.map(usd)]), totales: ['Total', ...aging.totCxc.map(usd)] },
          { titulo: 'Cuentas por pagar (proveedores y préstamos)', columnas: cols, alinear: al, filas: aging.cxp.map(([k, v]) => [k, ...v.map(usd)]), totales: ['Total', ...aging.totCxp.map(usd)] },
        ],
      });
    } else if (rep === 'SIN_CLASE') {
      imprimirDocumento({
        titulo: 'Movimientos sin clase explícita', meta: metaBase,
        secciones: [{ columnas: ['Fecha', 'Origen', 'Ref.', 'Detalle', 'Servicio inferido', 'Aeronave', 'USD'], alinear: ['l', 'l', 'l', 'l', 'l', 'l', 'r'],
          filas: sinClase.map(l => [fmtDate(l.fecha), l.origen, l.ref, l.detalle, labelServicio(l.servicio), l.aeronave || '—', usd(l.usd)]) }],
      });
    }
  };

  const exportarCSV = () => {
    if (rep === 'PL_CLASE') {
      const cols = porClase.cols;
      downloadCSV([
        ['Naturaleza', 'Cuenta', ...cols, 'Total'],
        ...porClase.ing.map(f => ['INGRESO', `"${labelServicio(f.servicio)}"`, ...cols.map(c => (f.m.get(c) ?? 0).toFixed(2)), f.total.toFixed(2)]),
        ...porClase.gas.map(f => ['GASTO', `"${labelServicio(f.servicio)}"`, ...cols.map(c => (f.m.get(c) ?? 0).toFixed(2)), f.total.toFixed(2)]),
        ['RESULTADO', '', ...cols.map(c => (porClase.util.get(c) ?? 0).toFixed(2)), resumen.utilidad.toFixed(2)],
      ], `PL_por_${dim}_${desde}_${hasta}.csv`);
      return;
    }
    downloadCSV([
      ['Fecha', 'Naturaleza', 'Cuenta', 'Aeronave', 'Sede', 'Piloto', 'Proyecto', 'USD', 'Origen', 'Ref', 'Detalle', 'Clase'],
      ...lineas.map(l => [l.fecha, l.nat, `"${labelServicio(l.servicio)}"`, l.aeronave, l.sede, `"${l.piloto}"`, `"${l.proyecto}"`,
        l.usd.toFixed(2), `"${l.origen}"`, l.ref, `"${l.detalle.replace(/"/g, "'")}"`, l.inferida ? 'INFERIDA' : 'EXPLÍCITA']),
    ], `Resultados_${base}_${desde}_${hasta}.csv`);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const chip = (on: boolean) => `px-3 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${on ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : optOff}`;
  const fila = (l: string, v: number, extra = '', bold = false) => (
    <div className={`flex justify-between items-center py-2 border-b border-white/[0.04] ${bold ? 'font-black' : ''}`}>
      <span className={`text-[10px] uppercase ${bold ? 'text-white' : 'text-zinc-400'}`}>{l}</span>
      <span className={`text-[11px] font-black italic ${extra || (v < 0 ? 'text-red-400' : 'text-white')}`}>{usd(v)}</span>
    </div>
  );
  const usaPeriodo = rep !== 'BALANCE' && rep !== 'AGING';
  const usaBase    = rep === 'PL' || rep === 'PL_CLASE' || rep === 'SIN_CLASE';

  return (
    <div className="space-y-5">
      {!v17 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30">
          <Info size={14} className="text-orange-400 shrink-0 mt-0.5" />
          <p className="text-[9px] text-orange-200 font-mono">Migración v17 no instalada: los reportes usan solo el Diario y CxC/CxP con clases inferidas. Billeteras, consumos y clases explícitas no están disponibles.</p>
        </div>
      )}
      <div className={`${glass} rounded-3xl p-5 space-y-4`}>
        <div className="flex flex-wrap gap-1.5">
          {REPORTES.map(r => <button key={r.k} type="button" onClick={() => setRep(r.k)} className={chip(rep === r.k)}>{r.l}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {usaPeriodo && (<>
            <div><Lbl>Desde</Lbl><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={`${inp} py-2.5`} style={noUpper} /></div>
            <div><Lbl>Hasta</Lbl><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={`${inp} py-2.5`} style={noUpper} /></div>
            <div className="flex flex-wrap gap-1">
              {presets.map(p => <button key={p.l} type="button" onClick={() => { setDesde(p.d); setHasta(p.h); }} className={chip(desde === p.d && hasta === p.h)}>{p.l}</button>)}
            </div>
          </>)}
          {usaBase && (
            <div className="flex gap-1">
              {(['DEVENGADO', 'EFECTIVO'] as BasePL[]).map(b => <button key={b} type="button" onClick={() => setBase(b)} className={chip(base === b)}>{b === 'DEVENGADO' ? 'Base devengado' : 'Base efectivo'}</button>)}
            </div>
          )}
          {rep === 'PL_CLASE' && (
            <div className="min-w-[220px]"><Lbl>Clase</Lbl>
              <select value={dim} onChange={e => setDim(e.target.value as DimensionPL)} className={`${inp} py-2.5`}>
                {DIMENSIONES.map(d => <option key={d.k} value={d.k}>{d.l}</option>)}
              </select>
            </div>
          )}
          {rep !== 'IMPRESION' && (
            <div className="flex gap-2 ml-auto">
              {(rep === 'PL' || rep === 'PL_CLASE') && (
                <button type="button" onClick={exportarCSV} className="bg-emerald-500/10 text-emerald-400 px-4 py-2.5 rounded-xl border border-emerald-500/20 text-[9px] font-black uppercase flex items-center gap-2 hover:bg-emerald-500/20"><Download size={12} /> CSV</button>
              )}
              <button type="button" onClick={imprimirReporte} className="bg-[#E1AD01] text-black px-4 py-2.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-2 hover:bg-white"><Printer size={12} /> Imprimir / PDF</button>
            </div>
          )}
        </div>
        {usaBase && (
          <p className="text-[8px] text-zinc-600 font-mono">
            {base === 'DEVENGADO'
              ? 'Devengado: ingreso cuando el alumno consume (vuelo, simulador, curso) o se le factura a crédito; gasto cuando se recibe la factura (CxP). Recargas de billetera y anticipos son pasivo, no ingreso.'
              : 'Efectivo: ingreso/gasto cuando el dinero entra o sale de bóveda. Recargas de billetera y reembolsos se muestran en líneas propias.'}
          </p>
        )}
      </div>

      {rep === 'PL' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-1 gap-3">
            {([['Ingresos', resumen.totIng, 'text-emerald-400'], ['Gastos', resumen.totGas, 'text-red-400'],
               ['Resultado neto', resumen.utilidad, resumen.utilidad >= 0 ? 'text-[#E1AD01]' : 'text-red-400']] as const).map(([l, v, c]) => (
              <div key={l} className={`${glass} rounded-2xl p-5`}>
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest">{l}</p>
                <p className={`text-2xl font-black italic mt-1 ${c}`}>{usd(v)}</p>
              </div>
            ))}
            <div className={`${glass} rounded-2xl p-5`}>
              <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest">Margen neto</p>
              <p className="text-2xl font-black italic mt-1 text-white">{pct(resumen.utilidad, resumen.totIng)}</p>
            </div>
          </div>
          <div className={`lg:col-span-8 ${glass} rounded-3xl p-6`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2">Ingresos</p>
            {resumen.ingresos.length === 0 && <EmptyState text="Sin ingresos en el período" py="py-6" />}
            {resumen.ingresos.map(x => <React.Fragment key={x.servicio}>{fila(`${labelServicio(x.servicio)}${x.inferidas ? ` · ${x.inferidas} inferida${x.inferidas === 1 ? '' : 's'}` : ''}`, x.usd)}</React.Fragment>)}
            {fila('Total ingresos', resumen.totIng, 'text-emerald-400', true)}
            <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mt-6 mb-2">Gastos</p>
            {resumen.gastos.length === 0 && <EmptyState text="Sin gastos en el período" py="py-6" />}
            {resumen.gastos.map(x => <React.Fragment key={x.servicio}>{fila(`${labelServicio(x.servicio)}${x.inferidas ? ` · ${x.inferidas} inferida${x.inferidas === 1 ? '' : 's'}` : ''}`, x.usd)}</React.Fragment>)}
            {fila('Total gastos', resumen.totGas, 'text-red-400', true)}
            <div className="mt-4">{fila('Resultado neto del período', resumen.utilidad, resumen.utilidad >= 0 ? 'text-[#E1AD01]' : 'text-red-400', true)}</div>
          </div>
        </div>
      )}

      {rep === 'PL_CLASE' && (
        <div className={`${glass} rounded-3xl overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-zinc-500 text-[8px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left p-3 font-black sticky left-0 bg-[#0b0b0b]">Cuenta</th>
                  {porClase.cols.map(c => <th key={c} className={`text-right p-3 font-black whitespace-nowrap ${c === 'SIN CLASE' ? 'text-zinc-700' : 'text-[#E1AD01]'}`}>{c}</th>)}
                  <th className="text-right p-3 font-black text-white">Total</th>
                </tr>
              </thead>
              <tbody>
                {(['INGRESO', 'GASTO'] as const).map(nat => {
                  const fs = nat === 'INGRESO' ? porClase.ing : porClase.gas;
                  const tot = nat === 'INGRESO' ? porClase.totIng : porClase.totGas;
                  return (
                    <React.Fragment key={nat}>
                      <tr><td colSpan={porClase.cols.length + 2} className={`p-3 text-[9px] font-black uppercase tracking-widest ${nat === 'INGRESO' ? 'text-emerald-400' : 'text-red-400'}`}>{nat === 'INGRESO' ? 'Ingresos' : 'Gastos'}</td></tr>
                      {fs.map(f => (
                        <tr key={`${nat}${f.servicio}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                          <td className="p-3 uppercase text-zinc-300 sticky left-0 bg-[#0b0b0b] whitespace-nowrap">{labelServicio(f.servicio)}</td>
                          {porClase.cols.map(c => { const v = f.m.get(c) ?? 0; return <td key={c} className={`p-3 text-right ${Math.abs(v) < 0.005 ? 'text-zinc-800' : 'text-white'}`}>{usd(v)}</td>; })}
                          <td className="p-3 text-right font-black">{usd(f.total)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-white/10">
                        <td className="p-3 font-black uppercase sticky left-0 bg-[#0b0b0b]">Total {nat === 'INGRESO' ? 'ingresos' : 'gastos'}</td>
                        {porClase.cols.map(c => <td key={c} className={`p-3 text-right font-black ${nat === 'INGRESO' ? 'text-emerald-400' : 'text-red-400'}`}>{usd(tot.get(c) ?? 0)}</td>)}
                        <td className="p-3 text-right font-black">{usd(nat === 'INGRESO' ? resumen.totIng : resumen.totGas)}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#E1AD01]/40">
                  <td className="p-3 font-black uppercase text-[#E1AD01] sticky left-0 bg-[#0b0b0b]">Resultado</td>
                  {porClase.cols.map(c => { const v = porClase.util.get(c) ?? 0; return <td key={c} className={`p-3 text-right font-black italic ${v >= 0 ? 'text-[#E1AD01]' : 'text-red-400'}`}>{usd(v)}</td>; })}
                  <td className={`p-3 text-right font-black italic ${resumen.utilidad >= 0 ? 'text-[#E1AD01]' : 'text-red-400'}`}>{usd(resumen.utilidad)}</td>
                </tr>
                <tr>
                  <td className="p-3 text-[8px] uppercase text-zinc-600 sticky left-0 bg-[#0b0b0b]">Margen</td>
                  {porClase.cols.map(c => <td key={c} className="p-3 text-right text-[9px] text-zinc-500">{pct(porClase.util.get(c) ?? 0, porClase.totIng.get(c) ?? 0)}</td>)}
                  <td className="p-3 text-right text-[9px] text-zinc-400">{pct(resumen.utilidad, resumen.totIng)}</td>
                </tr>
              </tfoot>
            </table>
            {porClase.cols.length === 0 && <EmptyState icon={BarChart3} text="Sin movimientos en el período" />}
          </div>
        </div>
      )}

      {rep === 'BALANCE' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className={`${glass} rounded-3xl p-6`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-3">Activos</p>
            {balance.bovedas.map(b => <React.Fragment key={b.m}>{fila(`Bóveda ${b.m}${b.m === 'BS' ? ` (${fmtMonto(b.nativo, 'BS')})` : ''}`, b.usd)}</React.Fragment>)}
            {fila('CxC · consumos de billetera', balance.cxcBill)}
            {fila('CxC · alumnos (otras)', balance.cxcOtras)}
            {fila('Total activos', balance.activos, 'text-emerald-400', true)}
          </div>
          <div className={`${glass} rounded-3xl p-6`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-orange-400 mb-3">Pasivos</p>
            {fila('CxP · proveedores', balance.cxpProv)}
            {fila('Préstamos por pagar', balance.prestamos)}
            {fila('Anticipos · billeteras de alumnos', balance.billeteras)}
            {fila('Anticipos sin matrícula por aplicar', balance.provPend)}
            {fila('Total pasivos', balance.pasivos, 'text-orange-400', true)}
          </div>
          <div className={`${glass} rounded-3xl p-6`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#E1AD01] mb-3">Patrimonio</p>
            {fila('Patrimonio neto', balance.patrimonio, balance.patrimonio >= 0 ? 'text-[#E1AD01]' : 'text-red-400', true)}
            <div className="mt-4 space-y-1 text-[8px] text-zinc-600 font-mono">
              <p>Memo · reposiciones internas: {usd(balance.reposiciones)} (no es deuda con terceros).</p>
              {balance.inventario.n > 0 && <p>Memo · inventario MRO estimado: {usd(balance.inventario.total)} ({balance.inventario.n} ítems, no incluido en totales).</p>}
              <p>No incluye aeronaves ni activos fijos. BS a tasa {tasaBCV}.</p>
            </div>
          </div>
        </div>
      )}

      {rep === 'FLUJO' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 grid grid-cols-3 lg:grid-cols-1 gap-3">
            {([['Saldo inicial', flujo.inicial], ['Variación neta', flujo.neto], ['Saldo final', flujo.final]] as const).map(([l, v]) => (
              <div key={l} className={`${glass} rounded-2xl p-5`}>
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest">{l}</p>
                <p className={`text-xl font-black italic mt-1 ${v >= 0 ? 'text-white' : 'text-red-400'}`}>{usd(v)}</p>
              </div>
            ))}
          </div>
          <div className={`lg:col-span-8 ${glass} rounded-3xl p-6`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2">Operación</p>
            {flujo.filas.filter(f => f.k.startsWith('OP_')).map(f => <React.Fragment key={f.k}>{fila(f.l, f.v)}</React.Fragment>)}
            {fila('Flujo operativo', flujo.op, flujo.op >= 0 ? 'text-emerald-400' : 'text-red-400', true)}
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-400 mt-5 mb-2">Financiamiento</p>
            {flujo.filas.filter(f => f.k.startsWith('FIN_')).map(f => <React.Fragment key={f.k}>{fila(f.l, f.v)}</React.Fragment>)}
            {fila('Flujo de financiamiento', flujo.fin, 'text-violet-400', true)}
            <div className="mt-5">{fila('Cambio de moneda (FX)', flujo.fx, 'text-teal-400')}</div>
            <div className="mt-2">{fila('Saldo final de efectivo (USD eq.)', flujo.final, 'text-[#E1AD01]', true)}</div>
          </div>
        </div>
      )}

      {rep === 'AGING' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {([['Por cobrar · alumnos', aging.cxc, aging.totCxc, 'text-yellow-400'], ['Por pagar · proveedores y préstamos', aging.cxp, aging.totCxp, 'text-orange-400']] as const).map(([t, rows, tot, c]) => (
            <div key={t} className={`${glass} rounded-3xl overflow-hidden`}>
              <p className={`p-5 border-b border-white/5 text-[10px] font-black uppercase tracking-widest ${c}`}>{t}</p>
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead><tr className="text-zinc-600 text-[8px] uppercase">{['Entidad', '0–30', '31–60', '61–90', '+90', 'Total'].map((h, i) => <th key={h} className={`p-3 font-black ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(([k, v]) => (
                      <tr key={k} className="border-t border-white/[0.04]">
                        <td className="p-3 uppercase truncate max-w-[200px]">{k}</td>
                        {v.map((x, i) => <td key={i} className={`p-3 text-right ${i === 3 && x > 0 ? 'text-red-400 font-black' : i === 4 ? 'font-black' : ''}`}>{usd(x)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-white/10">{['Total', ...tot.map(usd)].map((x, i) => <td key={i} className={`p-3 font-black ${i ? 'text-right' : ''}`}>{x}</td>)}</tr></tfoot>
                </table>
                {rows.length === 0 && <EmptyState text="Sin saldos pendientes" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {rep === 'SIN_CLASE' && (
        <div className={`${glass} rounded-3xl overflow-hidden`}>
          <div className="p-5 border-b border-white/5 flex flex-wrap gap-3 items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest">{sinClase.length} movimientos con clase inferida · {selSinClase.size} seleccionados</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelSinClase(new Set(sinClase.map(l => `${l.tabla}:${l.registroId}`)))} className={chip(false)}>Seleccionar todo</button>
              <button type="button" disabled={!selSinClase.size || !canEdit || !v17}
                onClick={() => {
                  const items = Array.from(selSinClase).map(k => { const [tabla, id] = k.split(/:(.+)/); return { tabla: tabla as TablaClase, id }; });
                  const primero = sinClase.find(l => `${l.tabla}:${l.registroId}` === Array.from(selSinClase)[0]);
                  onReclasificar({ items, titulo: `${items.length} movimiento(s)`, inicial: primero ? { servicio: primero.servicio, aeronave: primero.aeronave, sede: primero.sede, piloto: primero.piloto, proyecto: primero.proyecto } : CLASE_VACIA });
                  setSelSinClase(new Set());
                }}
                className="bg-teal-500/15 text-teal-400 border border-teal-500/30 px-4 py-2 rounded-xl text-[9px] font-black uppercase disabled:opacity-30 flex items-center gap-2"><Tag size={12} /> Clasificar seleccionados</button>
            </div>
          </div>
          <div className="max-h-[560px] overflow-y-auto p-4 space-y-1.5">
            {sinClase.map(l => {
              const k = `${l.tabla}:${l.registroId}`;
              const on = selSinClase.has(k);
              return (
                <label key={k} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${on ? 'border-teal-500/40 bg-teal-500/5' : 'border-white/[0.05] hover:bg-white/[0.02]'}`}>
                  <input type="checkbox" checked={on} onChange={() => setSelSinClase(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase truncate">{l.detalle}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(l.fecha)} · {l.origen} · {l.ref} · inferido: <span className="text-teal-400">{labelServicio(l.servicio)}</span>{l.aeronave ? ` · ${l.aeronave}` : ''}</p>
                  </div>
                  <span className={`text-[11px] font-black italic ${l.nat === 'INGRESO' ? 'text-emerald-400' : 'text-red-400'}`}>{l.nat === 'INGRESO' ? '+' : '−'}{usd(l.usd)}</span>
                </label>
              );
            })}
            {sinClase.length === 0 && <EmptyState icon={CheckCircle2} text="Todo el período tiene clase explícita" />}
          </div>
        </div>
      )}

      {rep === 'IMPRESION' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${glass} rounded-3xl p-6 space-y-4`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Banknote size={14} className="text-[#E1AD01]" /> Movimientos de caja</h3>
            <select value={cajaImp} onChange={e => setCajaImp(e.target.value)} className={inp}>
              <option value="">TODAS LAS CAJAS (GLOBAL)</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <div><Lbl>Desde</Lbl><input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={inp} style={noUpper} /></div>
              <div><Lbl>Hasta</Lbl><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={inp} style={noUpper} /></div>
            </div>
            <button type="button" onClick={() => onImprimirCaja(cajaImp || null, desde, hasta)} className="w-full py-4 bg-[#E1AD01] text-black rounded-2xl font-black text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-white"><Printer size={14} /> Imprimir movimientos</button>
          </div>
          <div className={`${glass} rounded-3xl p-6 space-y-4`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Receipt size={14} className="text-[#E1AD01]" /> Estado de cuenta por alumno</h3>
            <select value={alumnoImp} onChange={e => setAlumnoImp(e.target.value)} className={inp}>
              <option value="">— SELECCIONE ALUMNO —</option>
              {alumnos.map(a => <option key={a.student_id} value={a.student_id}>{a.nombre} · {a.serial} · {a.sede}</option>)}
            </select>
            <p className="text-[8px] text-zinc-600 font-mono">Incluye billetera, consumos, cuentas por cobrar y pagos con trazabilidad del alumno.</p>
            <button type="button" disabled={!alumnoImp} onClick={() => onImprimirAlumno(alumnoImp)} className="w-full py-4 bg-[#E1AD01] text-black rounded-2xl font-black text-[10px] uppercase flex items-center justify-center gap-2 hover:bg-white disabled:opacity-30"><Printer size={14} /> Imprimir estado de cuenta</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export const FinancePanel: React.FC<FinancePanelProps> = ({ vendors, inventory = [], userRole = 'SIN_RANGO', setGlobalFinance = NOOP }) => {
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
  // v16.8: ningún efecto de lectura puede crear transacciones históricas.
  const [sinSesion,   setSinSesion]   = useState(false);          // [NEW v16.2]
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);   // [NEW v16.2]
  /** [NEW v16.3] Diagnóstico cuando RLS oculta las cajas */
  const [diagRls, setDiagRls] = useState<{ uid: string; email: string; staff: boolean | null; error: string | null } | null>(null);

  // ▼ v16.6 — rol efectivo: prioriza un rol financiero válido de BD; fallback al prop del contenedor.
  const [resolvedRole, setResolvedRole] = useState<string>(() => normalizeFinanceRole(userRole));
  const [roleSource, setRoleSource] = useState<'PROFILE' | 'PROP'>('PROP');

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
    prestamista: 'Barquisimeto' as Prestamista, caja_id: '', moneda: 'USDT' as PaymentMethod,
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
  const [provisionales, setProvisionales] = useState<PagoProvisional[]>([]);
  const [provisionalError, setProvisionalError] = useState<string | null>(null);
  const [savingProvisional, setSavingProvisional] = useState(false);
  const [provisionalLinkId, setProvisionalLinkId] = useState<string | null>(null);
  const [provisionalStudentId, setProvisionalStudentId] = useState('');
  const [savingProvisionalLink, setSavingProvisionalLink] = useState(false);
  const [historicosRevisar, setHistoricosRevisar] = useState(0);
  const [provisionalForm, setProvisionalForm] = useState({
    beneficiario_nombre: '', beneficiario_documento: '', beneficiario_contacto: '', sede: '',
    concepto: 'ANTICIPO DE FORMACIÓN', monto: '', moneda: 'ZELLE' as PaymentMethod,
    caja_id: '', subcaja: 'ADM' as SubcajaEfectivo, fecha: hoyISO(),
  });
  // La v16.5 requiere alumno_id para tipo ALUMNO: aspirantes sin perfil usan TERCERO en
  // la traza de dinero y este subledger registra explícitamente al BENEFICIARIO.
  const [provisionalPago, setProvisionalPago] = useState<PagoForm>(() =>
    pagoVacio('', { pagador_tipo: 'TERCERO' }));
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

  // ▼ v17 — billeteras, consumos, tarifario, clases contables
  const [walletCuentas,  setWalletCuentas]  = useState<WalletCuenta[]>([]);
  const [walletMovs,     setWalletMovs]     = useState<WalletMovimiento[]>([]);
  const [consumos,       setConsumos]       = useState<WalletConsumo[]>([]);
  const [servicios,      setServicios]      = useState<ServicioCatalogo[]>([]);
  const [clasif,         setClasif]         = useState<ClasificacionRow[]>([]);
  const [flota,          setFlota]          = useState<string[]>([]);
  const [vuelosBitacora, setVuelosBitacora] = useState<VueloBitacora[]>([]);
  const [walletCorte,    setWalletCorte]    = useState<string>(hoyISO());
  const [creditoMax,     setCreditoMax]     = useState<number | null>(null);
  const [v17Instalado,   setV17Instalado]   = useState(true);
  const [v17Avisos,      setV17Avisos]      = useState<string[]>([]);
  const [walletError,    setWalletError]    = useState<string | null>(null);
  const [walletInfo,     setWalletInfo]     = useState<string | null>(null);
  const [savingWallet,   setSavingWallet]   = useState(false);
  const [walletSubTab,   setWalletSubTab]   = useState<WalletSubTab>('ALUMNOS');
  const [walletSel,      setWalletSel]      = useState<string | null>(null);
  const [walletQuery,    setWalletQuery]    = useState('');
  const [walletModal,    setWalletModal]    = useState<WalletModal | null>(null);
  const RECARGA_INIT = {
    moneda: 'ZELLE' as PaymentMethod, monto: '', tasa: String(DEFAULT_TASA_BS), caja_id: '', subcaja: 'ADM' as SubcajaEfectivo,
    fecha: hoyISO(), concepto: '', aplicar_deudas: true,
  };
  const [recargaForm, setRecargaForm] = useState(RECARGA_INIT);
  const [recargaPago, setRecargaPago] = useState<PagoForm>(() => pagoVacio());
  const CONSUMO_INIT = {
    servicio_id: '', tipo: 'VUELO' as TipoConsumo, cantidad: '1', precio: '', descripcion: '', fecha: hoyISO(),
    modo: 'BILLETERA' as ModoConsumo, autorizar: false,
  };
  const [consumoForm,   setConsumoForm]   = useState(CONSUMO_INIT);
  const [consumoClase,  setConsumoClase]  = useState<ClaseForm>(CLASE_VACIA);
  const [ajusteForm,    setAjusteForm]    = useState({ tipo: 'AJUSTE_CREDITO' as AjusteTipo, monto: '', motivo: '' });
  const [reembolsoForm, setReembolsoForm] = useState({
    monto_usd: '', moneda: 'ZELLE' as PaymentMethod, tasa: String(DEFAULT_TASA_BS), caja_id: '', subcaja: 'ADM' as SubcajaEfectivo,
    fecha: hoyISO(), concepto: '', referencia: '',
  });
  const [motivoAccion,  setMotivoAccion]  = useState<MotivoAccion | null>(null);
  const [motivoTexto,   setMotivoTexto]   = useState('');
  const [servicioEdit,  setServicioEdit]  = useState<ServicioEditForm | null>(null);
  const [ledgerClase,   setLedgerClase]   = useState<ClaseForm>(CLASE_VACIA);
  const [movClase,      setMovClase]      = useState<ClaseForm>(CLASE_VACIA);
  const [cuentaClase,   setCuentaClase]   = useState<ClaseForm>(CLASE_VACIA);
  const [reclasAccion,  setReclasAccion]  = useState<ReclasAccion | null>(null);
  const [reclasForm,    setReclasForm]    = useState<ClaseForm>(CLASE_VACIA);
  const [configForm,    setConfigForm]    = useState({ corte: hoyISO(), credito: '' });
  const [vueloCargando, setVueloCargando] = useState<string | null>(null);

  // ▼ v16.6 — Resolver el rango desde la sesión real.
  // Corrige casos donde el layout entrega "SIN RANGO"/vacío aunque el perfil autenticado sea CEO o ADMIN.
  useEffect(() => {
    let cancelled = false;

    const resolveAuthenticatedRole = async () => {
      const propRole = normalizeFinanceRole(userRole);

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const uid = sessionData.session?.user?.id;
        if (!uid) {
          if (!cancelled) { setResolvedRole(propRole); setRoleSource('PROP'); }
          return;
        }

        const { data: perfil, error: profileError } = await supabase
          .from('perfiles_estudiantes')
          .select('role')
          .eq('id', uid)
          .maybeSingle();

        if (profileError) throw profileError;

        const dbRole = normalizeFinanceRole((perfil as { role?: unknown } | null)?.role);
        const effectiveRole = isFinanceRole(dbRole)
          ? dbRole
          : isFinanceRole(propRole)
            ? propRole
            : (dbRole || propRole);

        if (!cancelled) {
          setResolvedRole(effectiveRole);
          setRoleSource(isFinanceRole(dbRole) ? 'PROFILE' : 'PROP');
        }
      } catch (err) {
        console.warn('[FinancePanel v16.6] No se pudo resolver role desde perfil; usando prop:', err);
        if (!cancelled) { setResolvedRole(propRole); setRoleSource('PROP'); }
      }
    };

    void resolveAuthenticatedRole();
    return () => { cancelled = true; };
  }, [userRole]);

  // ─── CONTROL HISTÓRICO v16.8 ─────────────────────────────────────────────
  // Eliminada la escritura automática de transacciones desde fetchAll.
  // Las anomalías históricas se REPORTAN y se regularizan de forma revisada,
  // nunca con inserciones implícitas al entrar a la pantalla.

  // ─── FETCH ────────────────────────────────────────────────────────────────

  /** Supabase/PostgREST limita la cantidad de filas por solicitud (habitualmente 1000).
   * Pagina las fuentes que determinan saldos para NO calcular totales incompletos.
   * Ordena por PK, estable incluso si varios movimientos comparten fecha.
   */
  const leerTablaCompleta = async (tabla: string, orden: string[] = ['id']): Promise<{   // [CHG v17] orden configurable (tablas sin columna id)
    data: any[] | null; error: { message: string; code?: string } | null;
  }> => {
    const PAGE = 500;
    const maxRows = 100_000; // fallo visible: nunca representar parciales como totales.
    const filas: any[] = [];
    for (let inicio = 0; inicio < maxRows; inicio += PAGE) {
      const q = orden.reduce((acc, col) => acc.order(col, { ascending: true }), supabase.from(tabla).select('*'));
      const { data, error } = await q.range(inicio, inicio + PAGE - 1);
      if (error) return { data: null, error };
      filas.push(...(data ?? []));
      if ((data ?? []).length < PAGE) return { data: filas, error: null };
    }
    return { data: null, error: { message: `Límite de auditoría (${maxRows}) alcanzado en ${tabla}. No se calculan saldos parciales.` } };
  };

  const fetchAll = useCallback(async (silent = false) => {
    if (fetchLockRef.current && !silent) return;
    fetchLockRef.current = true;
    if (!silent) setLoading(true);
    try {
      // [NEW v16.2] sin sesión válida RLS devuelve [] → avisar en lugar de mostrar el panel vacío
      const { data: sesData } = await supabase.auth.getSession();
      setSinSesion(!sesData.session);

      const [txRes, reqRes, cajasRes, movRes, cuentasRes, capRes, alumnosRes, cxcRes, fxRes, abRes, pagRes, provRes] = await Promise.all([
        leerTablaCompleta('transacciones_finanzas'),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cajas_chicas').select('*').order('nombre'),
        leerTablaCompleta('movimientos_caja_chica'),
        leerTablaCompleta('cuentas_generales'),
        supabase.from('capitanes').select('*').order('nombre'),
        supabase.from('perfiles_estudiantes').select('id, nombre_completo, student_serial, sede').eq('role', 'student').order('nombre_completo'),
        leerTablaCompleta('cuentas_por_cobrar'),
        supabase.from('fx_registros').select('*').order('fecha', { ascending: false }).limit(200),
        leerTablaCompleta('abonos_cuentas'),
        leerTablaCompleta('pagos_trazabilidad'), // [v16.8] historial completo
        leerTablaCompleta('pagos_provisionales'),
      ]);

      // ▼ v17 — billeteras / consumos / tarifario / clases. Errores aquí NO bloquean el panel v16.8.
      const [wcRes, wmRes, wsRes, scRes, clRes, cfgRes, flotaRes] = await Promise.all([
        leerTablaCompleta('wallet_cuentas', ['student_id']),
        leerTablaCompleta('wallet_movimientos'),
        leerTablaCompleta('wallet_consumos'),
        supabase.from('servicios_catalogo').select('*').order('tipo').order('nombre'),
        leerTablaCompleta('clasificacion_contable', ['tabla', 'registro_id']),
        supabase.from('finanzas_config').select('*'),
        supabase.from('flota_aviones').select('*'),
      ]);
      const cxcBilletera = new Set<string>((wsRes.data ?? []).filter((c: any) => c.cxc_id && c.estado === 'VIGENTE').map((c: any) => String(c.cxc_id)));

      // [NEW v16.2] errores por tabla visibles (antes se ignoraban y la sección quedaba vacía)
      const consultas: [string, { error: { message: string; code?: string } | null }][] = [
        ['transacciones_finanzas', txRes], ['solicitudes_compra', reqRes], ['cajas_chicas', cajasRes],
        ['movimientos_caja_chica', movRes], ['cuentas_generales', cuentasRes], ['capitanes', capRes],
        ['perfiles_estudiantes', alumnosRes], ['cuentas_por_cobrar', cxcRes], ['fx_registros', fxRes], ['abonos_cuentas', abRes],
        ['pagos_trazabilidad', pagRes], ['pagos_provisionales', provRes],
      ];
      const errs = consultas.filter(([, r]) => r.error).map(([t, r]) => `${t}: ${r.error?.message ?? 'error'}${r.error?.code ? ` (${r.error.code})` : ''}`);
      const errMonedas = (txRes.data ?? []).filter(t => {
        const m = String(t.payment_method ?? '').toUpperCase().trim();
        return m !== 'USD' && !(ALL_METHODS as string[]).includes(m);
      }).length;
      if (errMonedas) errs.push(`${errMonedas} asientos con método de pago no reconocido; revisar antes de conciliar.`);
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
      if (cuentasRes.data) setCuentas(cuentasRes.data.filter((c: any) => c.tipo === 'CXP').map((c: any) => ({
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

      if (provRes.data) setProvisionales(provRes.data.map((p: any): PagoProvisional => ({
        ...p, monto: round2(Number(p.monto) || 0), moneda: normalizePaymentMethod(p.moneda),
      })).sort((a: PagoProvisional, b: PagoProvisional) => b.creado_en.localeCompare(a.creado_en)));

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
        const cuentasConAbonos = new Set(abonosNorm.filter(a => a.cuenta_tipo === 'CXC').map(a => a.cuenta_id));
        setHistoricosRevisar(norm.filter(c => c.estatus === 'COBRADO' && c.monto_total > 0 &&
          !c.asiento_origen_id && !cuentasConAbonos.has(String(c.id)) && !cxcBilletera.has(String(c.id))).length);   // [CHG v17] deudas saldadas con billetera no son históricas
      }

      if (fxRes.data) setFxRegistros(fxRes.data.map((f: any) => ({
        ...f,
        moneda_origen: normalizePaymentMethod(f.moneda_origen), moneda_destino: normalizePaymentMethod(f.moneda_destino),
        monto_origen: round2(Number(f.monto_origen) || 0), monto_destino: round2(Number(f.monto_destino) || 0),
        tasa: round4(Number(f.tasa) || 0),
        caja_origen_id: f.caja_origen_id ?? f.caja_id ?? null, caja_destino_id: f.caja_destino_id ?? null,
        subcaja_origen: f.subcaja_origen ?? null, subcaja_destino: f.subcaja_destino ?? null, referencia: f.referencia ?? null,
      })));

      // ▼ v17 — procesamiento no bloqueante
      const v17Consultas: [string, { error: { message: string; code?: string } | null }][] = [
        ['wallet_cuentas', wcRes], ['wallet_movimientos', wmRes], ['wallet_consumos', wsRes],
        ['servicios_catalogo', scRes], ['clasificacion_contable', clRes], ['finanzas_config', cfgRes],
      ];
      const faltaV17 = v17Consultas.some(([, r]) => isMissingRelation(r.error));
      setV17Instalado(!faltaV17);
      const avisos = faltaV17 ? [] : v17Consultas.filter(([, r]) => r.error).map(([t, r]) => `${t}: ${r.error?.message ?? 'error'}`);
      if (flotaRes.error && !isMissingRelation(flotaRes.error)) avisos.push(`flota_aviones: ${flotaRes.error.message}`);
      if (!faltaV17) {
        setWalletCuentas((wcRes.data ?? []).map((w: any): WalletCuenta => ({
          student_id: String(w.student_id), saldo_usd: round2(Number(w.saldo_usd) || 0), actualizado_en: w.actualizado_en,
        })));
        setWalletMovs((wmRes.data ?? []).map((m: any): WalletMovimiento => ({
          ...m, student_id: String(m.student_id), signo: Number(m.signo) < 0 ? -1 : 1,
          monto_usd: round2(Number(m.monto_usd) || 0), saldo_resultante: round2(Number(m.saldo_resultante) || 0),
          monto_origen: m.monto_origen != null ? round2(Number(m.monto_origen)) : null, tasa: m.tasa != null ? Number(m.tasa) : null,
          revertido: !!m.revertido,
        })).sort((a: WalletMovimiento, b: WalletMovimiento) => String(b.creado_en).localeCompare(String(a.creado_en))));
        setConsumos((wsRes.data ?? []).map((c: any): WalletConsumo => ({
          ...c, student_id: String(c.student_id), cantidad: Number(c.cantidad) || 0,
          precio_unitario_usd: round2(Number(c.precio_unitario_usd) || 0), monto_total_usd: round2(Number(c.monto_total_usd) || 0),
          monto_billetera_usd: round2(Number(c.monto_billetera_usd) || 0), monto_cxc_usd: round2(Number(c.monto_cxc_usd) || 0),
          cxc_id: c.cxc_id != null ? String(c.cxc_id) : null, vuelo_id: c.vuelo_id != null ? String(c.vuelo_id) : null,
        })).sort((a: WalletConsumo, b: WalletConsumo) => String(b.creado_en).localeCompare(String(a.creado_en))));
        setServicios((scRes.data ?? []).map((s: any): ServicioCatalogo => ({ ...s, precio_usd: round2(Number(s.precio_usd) || 0), activo: !!s.activo })));
        setClasif((clRes.data ?? []).map((c: any): ClasificacionRow => ({
          ...c, registro_id: String(c.registro_id), tasa_ref: c.tasa_ref != null ? Number(c.tasa_ref) : null,
        })));
        const cfg = new Map<string, unknown>((cfgRes.data ?? []).map((c: any): [string, unknown] => [String(c.clave), c.valor]));
        const corte = typeof cfg.get('wallet_fecha_corte') === 'string' ? String(cfg.get('wallet_fecha_corte')).slice(0, 10) : hoyISO();
        const credito = cfg.get('credito_maximo_usd');
        setWalletCorte(corte);
        setCreditoMax(credito === null || credito === undefined || credito === '' ? null : Number(credito));
        setConfigForm({ corte, credito: credito === null || credito === undefined ? '' : String(credito) });
        // Vuelos desde la fecha de corte (fuente legal: bitacora_vuelos · horas_tac)
        const { data: vuelosData, error: vuelosErr } = await supabase.from('bitacora_vuelos').select('*')
          .gte('fecha', corte).order('fecha', { ascending: false }).limit(2000);
        if (vuelosErr) avisos.push(`bitacora_vuelos: ${vuelosErr.message}`);
        setVuelosBitacora((vuelosData ?? []).map((v: any): VueloBitacora => ({
          id: String(v.id), student_id: v.student_id != null ? String(v.student_id) : null,
          fecha: String(v.fecha ?? v.created_at ?? '').slice(0, 10), horas: round2(Number(v.horas_tac ?? v.horas) || 0),
          matricula: v.aeronave_matricula ?? v.matricula ?? v.matricula_avion ?? null, tipo_mision: v.tipo_mision ?? null,
          sede: v.sede_vuelo ?? v.sede ?? null, destino: v.destino ?? null,
        })));
      }
      setFlota(Array.from(new Set((flotaRes.data ?? [])
        .map((a: any) => String(a.matricula ?? a.tail_number ?? a.tailNumber ?? '').trim().toUpperCase())
        .filter((m: string) => m.length >= 3))).sort());
      setV17Avisos(avisos);
    } catch (e) {
      console.error('[FinancePanel v16.5] fetchAll error:', e);
    } finally {
      setLoading(false);
      fetchLockRef.current = false;
    }
  }, []);

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
      'cuentas_generales', 'cuentas_por_cobrar', 'fx_registros', 'abonos_cuentas', 'asientos_contables', 'pagos_trazabilidad', 'pagos_provisionales',
      // ▼ v17
      'wallet_cuentas', 'wallet_movimientos', 'wallet_consumos', 'servicios_catalogo', 'clasificacion_contable', 'finanzas_config', 'bitacora_vuelos'];
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
    setLedgerPago(fill); setMovPago(fill); setCuentaPago(fill); setPrestamoPago(fill); setProvisionalPago(fill);
    setRecargaPago(fill);   // [NEW v17]
  }, [recibidoPor]);

  /** [NEW v16.5] Recuerda quién recibió y devuelve un formulario limpio */
  const pagoRegistrado = (p: PagoForm, base?: Partial<PagoForm>) => {
    setRecibidoPor(p.recibido_por.trim().toUpperCase());
    return pagoVacio(p.recibido_por.trim().toUpperCase(), base);
  };

  /** [NEW v16.5] Pagador por asiento (solo vigentes) */
  const pagoPorAsiento = useMemo(() => new Map(pagos.filter(x => !x.anulado).map(x => [x.asiento_id, x])), [pagos]);

  // ▼ v17 — índices de billetera / clases (solo dependen del estado)
  /** Recargas / reembolsos vigentes por asiento: el Diario NO debe anularlos directamente */
  const walletMovPorAsiento = useMemo(() => new Map(walletMovs
    .filter(m => m.asiento_id && (m.tipo === 'RECARGA' || m.tipo === 'REEMBOLSO') && !m.revertido)
    .map(m => [m.asiento_id as string, m])), [walletMovs]);
  /** CxC generadas por un consumo (déficit de billetera) */
  const consumoPorCxc = useMemo(() => new Map(consumos
    .filter(c => c.cxc_id && c.estado === 'VIGENTE').map(c => [c.cxc_id as string, c])), [consumos]);
  const clasifMap = useMemo(() => new Map(clasif.map(c => [`${c.tabla}:${c.registro_id}`, c])), [clasif]);
  const provisionalAplicado = useMemo(() => new Set(walletMovs
    .filter(m => m.provisional_id && !m.revertido).map(m => m.provisional_id as string)), [walletMovs]);
  const saldoWallet = useMemo(() => new Map(walletCuentas.map(w => [w.student_id, w.saldo_usd])), [walletCuentas]);
  const pilotosLista = useMemo(() => Array.from(new Set(capitanes
    .map((c: { nombre?: string | null }) => String(c?.nombre ?? '').trim().toUpperCase()).filter(Boolean))).sort(), [capitanes]);

  /** [v16.8] alertas informativas: no se ajustan saldos automáticamente. */
  const alertasIntegridad = useMemo(() => {
    const alertas: string[] = [];
    // ▼ v17 — billetera: saldo cacheado = subledger; recargas con su asiento de caja vigente
    for (const w of walletCuentas) {
      const sub = round2(walletMovs.filter(m => m.student_id === w.student_id).reduce((a, m) => a + m.signo * m.monto_usd, 0));
      if (Math.abs(sub - w.saldo_usd) > 0.009) alertas.push(`Billetera ${alumnos.find(a => a.student_id === w.student_id)?.nombre ?? w.student_id.slice(0, 8)}: saldo ${fmtNum(w.saldo_usd)} ≠ subledger ${fmtNum(sub)}.`);
    }
    for (const m of walletMovs) {
      if (m.revertido || !m.asiento_id || (m.tipo !== 'RECARGA' && m.tipo !== 'REEMBOLSO')) continue;
      if (!transactions.some(t => t.asiento_id === m.asiento_id && t.status === 'PAID')) {
        alertas.push(`${WALLET_MOV_LABEL[m.tipo]} ${m.referencia}: su asiento de caja ya no existe en el Diario (billetera sin respaldo).`);
      }
    }
    const porAsiento = new Map(pagos.filter(p => !p.anulado).map(p => [p.asiento_id, p]));
    for (const t of transactions) {
      if (t.status !== 'PAID' || !t.asiento_id || isFxTx(t) || signedLedgerAmount(t) <= 0) continue;
      const p = porAsiento.get(t.asiento_id);
      if (!p) { alertas.push(`Ingreso ${t.invoiceNumber}: sin traza activa de pagador (puede ser histórico).`); continue; }
      if (Math.abs(t.amount - p.monto) > 0.01 || t.payment_method !== p.metodo) {
        alertas.push(`Asiento ${t.invoiceNumber}: monto o método distinto entre Ledger y trazabilidad.`);
      }
    }
    for (const p of provisionales) {
      if (p.estado === 'ANULADO') continue;
      const ledger = transactions.filter(t => t.asiento_id === p.asiento_id && t.status === 'PAID');
      if (ledger.length !== 1 || Math.abs((ledger[0]?.amount ?? 0) - p.monto) > 0.01 || ledger[0]?.payment_method !== p.moneda) {
        alertas.push(`Anticipo ${p.referencia_pago}: inconsistencia con su asiento financiero.`);
      }
      if (!porAsiento.has(p.asiento_id)) alertas.push(`Anticipo ${p.referencia_pago}: no se encuentra el pagador vigente.`);
    }
    const grupos = new Map<string, MovimientoCaja[]>();
    for (const m of movCajas) if (m.transfer_id) grupos.set(m.transfer_id, [...(grupos.get(m.transfer_id) ?? []), m]);
    for (const [id, legs] of grupos) {
      const sal = legs.filter(m => m.transfer_role === 'SALIDA');
      const ent = legs.filter(m => m.transfer_role === 'ENTRADA');
      if (sal.length !== 1 || ent.length !== 1 || sal[0]?.moneda !== ent[0]?.moneda ||
          Math.abs((sal[0]?.monto ?? 0) - (ent[0]?.monto ?? 0)) > 0.01) {
        alertas.push(`Transferencia ${id.slice(0, 8)}: faltan patas, difieren los importes o la moneda.`);
      }
    }
    return alertas;
  }, [transactions, pagos, provisionales, movCajas, walletCuentas, walletMovs, alumnos]);   // [CHG v17]

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

  // ▼ v17 — métricas de billetera
  /** Deuda pendiente (USD eq.) por alumno: índice O(n) en lugar de filtrar por alumno en cada render */
  const deudaPorAlumno = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cxcPendientes) m.set(c.student_id, round2((m.get(c.student_id) ?? 0) + aUSD(c.monto_pendiente, normalizePaymentMethod(c.moneda))));
    return m;
  }, [cxcPendientes, aUSD]);
  const deudaAlumnoUSD = useCallback((studentId: string) => deudaPorAlumno.get(studentId) ?? 0, [deudaPorAlumno]);
  const totalBilleteras    = useMemo(() => round2(walletCuentas.reduce((a, w) => a + w.saldo_usd, 0)), [walletCuentas]);
  const totalDeudaConsumos = useMemo(() => round2(cxcPendientes.filter(c => consumoPorCxc.has(String(c.id)))
    .reduce((a, c) => a + aUSD(c.monto_pendiente, normalizePaymentMethod(c.moneda)), 0)), [cxcPendientes, consumoPorCxc, aUSD]);
  const consumosMes = useMemo(() => {
    const mes = hoyISO().slice(0, 7);
    return round2(consumos.filter(c => c.estado === 'VIGENTE' && c.modo === 'BILLETERA' && String(c.fecha).slice(0, 7) === mes)
      .reduce((a, c) => a + c.monto_total_usd, 0));
  }, [consumos]);
  /** Vuelos de bitácora (desde la fecha de corte) aún no cargados ni marcados como cubiertos */
  const vuelosPorCargar = useMemo(() => {
    const cargados = new Set(consumos.filter(c => c.estado === 'VIGENTE' && c.vuelo_id).map(c => c.vuelo_id as string));
    return vuelosBitacora.filter(v => v.student_id && v.horas > 0 && !cargados.has(v.id) && v.fecha >= walletCorte);
  }, [consumos, vuelosBitacora, walletCorte]);
  /** Tarifa vigente de vuelo: específica de la aeronave o general */
  const tarifaVuelo = useCallback((matricula: string | null) => {
    const n = normMatricula(matricula);
    const activos = servicios.filter(s => s.activo && s.tipo === 'VUELO');
    return activos.find(s => s.aeronave_matricula && normMatricula(s.aeronave_matricula) === n) ?? activos.find(s => !s.aeronave_matricula) ?? null;
  }, [servicios]);

  // ─── HELPERS DE CAJA ──────────────────────────────────────────────────────

  const cajaById        = useCallback((id?: string | null) => (id ? cajas.find(c => c.id === id) ?? null : null), [cajas]);
  const cajaEsEfectivo  = (id?: string | null) => { const c = cajaById(id); return !!c && getCajaConfig(c).esCajaEfectivo; };

  // ▼ v16.7 — Regla única de compatibilidad de moneda.
  // Las sedes/cajas OPERATIVAS y custodias de terceros son multimoneda por diseño.
  // Las cajas dedicadas (EFECTIVO ADMIN/CEO, EFECTIVO legacy y BANCO/CAJA BS) respetan su moneda.
  const cajaAceptaMoneda = useCallback((c: CajaChica, m: PaymentMethod): boolean => {
    const conf = getCajaConfig(c);
    if (conf.tipo === 'OPERATIVA' || conf.tipo === 'CUSTODIA_TERCERO') return true;
    return conf.monedasPermitidas.includes(m);
  }, []);

  const cajasQueAceptan = useCallback((m: PaymentMethod) => cajas.filter(c => cajaAceptaMoneda(c, m)), [cajas, cajaAceptaMoneda]);
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
    return c && cajaAceptaMoneda(c, m) ? cajaId : defaultCajaFor(m);
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
    return cajaAceptaMoneda(c, moneda) ? null : `${c.nombre} no admite ${moneda}. Monedas configuradas: ${conf.monedasPermitidas.join(', ')}`;
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
    if (avisos.length) {
      alert(`Fondos insuficientes: operación bloqueada.\n${avisos.join('\n')}`);
      return false;
    }
    return true;
  }, [cajas, getVaultBalance, saldoCustodia]);

  // ─── SEGURIDAD ────────────────────────────────────────────────────────────

  // ▼ v16.6 — permisos financieros por rol efectivo resuelto.
  const rolUpper         = normalizeFinanceRole(resolvedRole || userRole);
  const canManageFinance = isFinanceRole(rolUpper);
  const auditRole        = rolUpper || normalizeFinanceRole(userRole) || 'SIN_RANGO';

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
  const postAsiento = useCallback(async (a: AsientoPayload, clase?: ClaseForm | null, tasaRef?: number | null) => {
    // [NEW v17] con clase → motor + clasificación en UNA transacción (fn_registrar_asiento_clasificado).
    // Sin la migración v17 se registra igual que en v16.8 (sin clase) para no bloquear la operación.
    if (clase && claseTieneDatos(clase)) {
      const { error: eCl } = await supabase.rpc('fn_registrar_asiento_clasificado', { p: a, p_clase: claseAPayload(clase, tasaRef) });
      if (!eCl) return;
      if (!isMissingRpc(eCl)) throw new Error(traducirErrorMotor(`${eCl.message} ${eCl.details ?? ''}`));
      console.warn('[FinancePanel v17] fn_registrar_asiento_clasificado no instalada: se registra sin clase.');
    }
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

  const anularAsientoMotor = (asientoId: string) => requireDirectorCode(async () => {
    setSavingAction(asientoId);
    try { await rpcAnularAsiento(asientoId); await refresh(); }
    catch (err) { const msg = errMsg(err, 'Error al anular asiento.'); setLedgerError(msg); setCajaError(msg); setCuentaError(msg); }
    finally { setSavingAction(null); }
  });

  /** [CHG v17] Recargas/reembolsos de billetera se revierten desde su flujo (mantiene coherente el saldo del alumno). */
  const anularAsiento = (asientoId: string) => {
    const wm = walletMovPorAsiento.get(asientoId);
    if (wm) {
      const alumno = alumnos.find(a => a.student_id === wm.student_id)?.nombre ?? 'ALUMNO';
      if (!window.confirm(`Este asiento es una ${WALLET_MOV_LABEL[wm.tipo].toUpperCase()} de billetera de ${alumno} (${usd(wm.monto_usd)}).\n\nSe revertirá en la billetera y se anulará su asiento de caja en una sola operación. ¿Continuar?`)) return;
      setMotivoTexto('');
      setMotivoAccion({ tipo: 'REVERTIR', id: wm.id, titulo: `Revertir ${WALLET_MOV_LABEL[wm.tipo]}`, detalle: `${alumno} · ${wm.referencia} · ${usd(wm.monto_usd)}` });
      return;
    }
    anularAsientoMotor(asientoId);
  };

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
    const cajaEditar = cajaById(editingMov.caja_id);
    if (!cajaEditar || !cajaAceptaMoneda(cajaEditar, editMovForm.moneda)) { setCajaError('La caja no acepta esa moneda.'); return; }
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
    // [NEW v17] la CxC de un consumo se elimina anulando el consumo (revierte billetera y aplicaciones)
    const consumoLig = esCxC ? consumoPorCxc.get(String(id)) : undefined;
    if (consumoLig) {
      setMotivoTexto('');
      setMotivoAccion({ tipo: 'ANULAR_CONSUMO', id: consumoLig.id, titulo: 'Anular consumo de billetera',
        detalle: `Esta CxC la generó el consumo "${consumoLig.descripcion}" (${usd(consumoLig.monto_total_usd)}). Se anulará el consumo completo.` });
      return;
    }
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
    // [NEW v17] clase contable: nómina → servicio NÓMINA y piloto = capitán (si no se indicó)
    const capitanNom  = esNomina ? normTxt(capitanes.find(c => c.id === ledger.capitanId)?.nombre) : '';
    const claseLedger: ClaseForm = {
      ...ledgerClase,
      servicio: ledgerClase.servicio || (esNomina ? 'NOMINA_INSTRUCCION' : ''),
      piloto:   ledgerClase.piloto || capitanNom,
    };
    try {
      try {
        await postAsiento(buildFlujo({
          evento: esNomina ? 'NOMINA' : esIngreso ? 'INGRESO_DIRECTO' : 'GASTO_DIRECTO',
          dir: esIngreso ? 'IN' : 'OUT', ledgerType: ledger.type, moneda: ledger.currency, monto: num,
          fechaISO, concepto, entityName, category, cajaId: cajaObj?.id ?? null, subcaja, registradoPor: auditRole,
          entityId: esIngreso ? ledgerPago.alumno_id || null : null,
          referenciaExterna: esIngreso ? ledgerPago.referencia_pago.trim().toUpperCase() || undefined : undefined,
          pago: esIngreso ? ledgerPago : null,
        }), claseLedger, ledger.currency === 'BS' ? tasaBCV : null);   // [CHG v17] + clase
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
      setLedgerClase(CLASE_VACIA);   // [NEW v17] evita clasificar el siguiente registro por arrastre
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
    if (!cajaObj || !cajaAceptaMoneda(cajaObj, movForm.moneda)) { setCajaError('Caja inexistente o incompatible con la moneda.'); return; }
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
      if (saldo < num) { setCajaError(`Saldo insuficiente en caja. Disponible: ${fmtMonto(saldo, movForm.moneda)}. Operación bloqueada.`); return; }
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
            category: 'Caja', cajaId: cajaActiva, subcaja, registradoPor: auditRole,
            referenciaExterna: (esEntrada ? movPago.referencia_pago.trim().toUpperCase() : referencia) || undefined,
            pago: esEntrada ? movPago : null,
          }), movClase, movForm.moneda === 'BS' ? tasaBCV : null);   // [CHG v17] + clase
        } catch (err) {
          if (err instanceof MotorNoInstaladoError) { setCajaError(`${err.message} Mientras tanto use clase UBICACIÓN.`); return; }
          throw err;
        }
      } else {
        const { error } = await supabase.from('movimientos_caja_chica').insert([{   // [PRESERVADO v15] solo custodia
          id: uuid4(), caja_id: cajaActiva, tipo: movForm.tipo, moneda: movForm.moneda, monto: num,
          concepto: `UBICACIÓN · ${concepto}`, referencia: referencia || null,
          fecha: isoDe(movForm.fecha), registrado_por: auditRole, subcaja,
        }]);
        if (error) { setCajaError(`Error: ${error.message}`); return; }
      }
      setMovForm(p => ({ ...p, monto: '', concepto: '', referencia: '' }));
      setMovClase(CLASE_VACIA);   // [NEW v17]
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
    if (monto > saldoEfectivoADM) { setCajaError('Saldo de Efectivo Administración insuficiente. Entrega bloqueada.'); return; }

    setSavingCaja(true);
    const concepto = entregaCEOForm.concepto.toUpperCase().trim();
    const fecha    = isoDe(entregaCEOForm.fecha);

    if (efectivoDual && cajaEfectivoADM && cajaEfectivoCEO) {   // [NEW v16.4]
      const transferId = uuid4(), salidaId = uuid4();
      const base = { moneda: 'CASH', monto, referencia: `ENTREGA-${genHash(transferId)}`, fecha, registrado_por: auditRole, transfer_id: transferId };
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
    const base = { caja_id: cajaEfectivo.id, moneda: 'CASH', monto, referencia, fecha, registrado_por: auditRole };
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
        concepto: p.concepto, registrado_por: auditRole,
        caja_id: p.cajaOrigenId, caja_origen_id: p.cajaOrigenId, caja_destino_id: p.cajaDestinoId,
        subcaja_origen: p.subcajaOrigen, subcaja_destino: p.subcajaDestino, referencia: p.referencia,
      }]);
      if (eFx) throw new Error(`Registro FX: ${eFx.message}`);

      const base = { referencia: p.referencia, fecha: p.fechaISO, registrado_por: auditRole, fx_id: p.fxId };
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
        p_concepto: payload.concepto, p_referencia: payload.referencia, p_registrado_por: auditRole,
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

  /** [NEW v17] Clase heredada por el cobro de una CxC generada por consumo (servicio, aeronave, sede...) */
  const claseDeCxc = (cxcId: string): ClaseForm | null => {
    const c = consumoPorCxc.get(cxcId);
    return c ? { servicio: c.clase_servicio, aeronave: c.clase_aeronave ?? '', sede: c.clase_sede ?? '', piloto: c.clase_piloto ?? '', proyecto: c.clase_proyecto ?? '' } : null;
  };

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
      moneda: cobroForm.moneda, monto, fechaISO: isoDe(cobroForm.fecha), cajaId, subcaja, registradoPor: auditRole,
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
        }), claseDeCxc(String(cxc.id)), cobroForm.moneda === 'BS' ? tasa : null);   // [CHG v17] hereda la clase del consumo
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
        }), esPrest ? null : claseDeRow(clasifMap.get(`cuentas_generales:${cxp.id}`)), cobroForm.moneda === 'BS' ? tasa : null);   // [CHG v17] hereda la clase de la factura
      }
      setCobroModal(null);
      await refresh();
    } catch (err) { setCobroError(errMsg(err, 'Error al registrar.')); }
    finally { setSavingCobro(false); }
  };

  // ─── PAGOS SIN MATRÍCULA v16.8 ───────────────────────────────────────────
  // La RPC invoca el motor v16.5 y escribe el subledger en UNA transacción de BD.
  const handlePagoProvisional = async (e: React.FormEvent) => {
    e.preventDefault(); setProvisionalError(null);
    if (sinSesion || !canManageFinance) { setProvisionalError('Sesión o rol financiero no autorizado.'); return; }
    if (fetchErrors.length) { setProvisionalError('Hay consultas financieras con error. Corrija esas alertas antes de registrar cobros.'); return; }
    const f = provisionalForm;
    const monto = round2(Number(f.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setProvisionalError('Importe mayor que cero requerido.'); return; }
    if (f.beneficiario_nombre.trim().length < 3 || f.beneficiario_documento.trim().length < 4) {
      setProvisionalError('Identifique al aspirante con nombre completo y documento.'); return;
    }
    if (f.concepto.trim().length < 3) { setProvisionalError('Especifique el concepto del anticipo.'); return; }
    if (!f.caja_id) { setProvisionalError('Identifique la caja de custodia. No se permiten anticipos sin ubicar.'); return; }
    const cajaErr = validarCajaMoneda(f.caja_id, f.moneda);
    if (cajaErr) { setProvisionalError(cajaErr); return; }
    const pagoError = validarPago(provisionalPago, f.moneda);
    if (pagoError) { setProvisionalError(pagoError); return; }
    if (provisionalPago.pagador_tipo === 'ALUMNO' || provisionalPago.alumno_id) {
      setProvisionalError('Este procedimiento es para personas sin matrícula. Use tipo aspirante o representante.'); return;
    }
    if (provisionalPago.referencia_pago.trim().length < 3) {
      setProvisionalError('La referencia de pago o el número de recibo es obligatorio, incluso para efectivo.'); return;
    }
    const datosPagador = { ...provisionalPago, pagador_tipo: provisionalPago.pagador_tipo,
      alumno_id: '', referencia_pago: provisionalPago.referencia_pago.toUpperCase().trim() };
    const concepto = `ANTICIPO SIN MATRÍCULA · ${f.concepto.trim().toUpperCase()}`;
    const asiento = buildFlujo({
      evento: 'INGRESO_DIRECTO', dir: 'IN', ledgerType: 'INCOME',
      moneda: f.moneda, monto, fechaISO: isoDe(f.fecha), concepto,
      entityName: f.beneficiario_nombre.trim().toUpperCase(),
      category: 'Anticipos sin matrícula', cajaId: f.caja_id,
      subcaja: cajaEsEfectivo(f.caja_id) ? f.subcaja : null,
      registradoPor: auditRole, pago: datosPagador,
      referenciaExterna: datosPagador.referencia_pago,
      meta: { origen: 'ANTICIPO_SIN_MATRICULA',
        documento_beneficiario: f.beneficiario_documento.trim().toUpperCase(),
        concepto_original: f.concepto.trim().toUpperCase() },
    });
    setSavingProvisional(true);
    try {
      const { error } = await supabase.rpc('fn_registrar_pago_provisional', {
        p_asiento: asiento,
        p_beneficiario: {
          nombre: f.beneficiario_nombre.trim().toUpperCase(),
          documento: f.beneficiario_documento.trim().toUpperCase(),
          contacto: f.beneficiario_contacto.trim(), sede: f.sede.trim(),
          concepto: f.concepto.trim().toUpperCase(),
        },
      });
      if (error) throw new Error(traducirErrorMotor(error.message));
      setProvisionalForm(p => ({ ...p, beneficiario_nombre: '', beneficiario_documento: '',
        beneficiario_contacto: '', concepto: 'ANTICIPO DE FORMACIÓN', monto: '' }));
      setProvisionalPago(pagoRegistrado(datosPagador, { pagador_tipo: 'TERCERO' }));
      await refresh();
    } catch (err) { setProvisionalError(errMsg(err, 'No se pudo registrar el anticipo.')); }
    finally { setSavingProvisional(false); }
  };

  const vincularProvisional = async () => {
    const p = provisionales.find(x => x.id === provisionalLinkId);
    const a = alumnos.find(x => x.student_id === provisionalStudentId);
    if (!p || !a || p.estado !== 'PENDIENTE') { setProvisionalError('Seleccione un pago pendiente y un estudiante válido.'); return; }
    if (!window.confirm(`Vincular el anticipo de ${p.beneficiario_nombre} (${p.beneficiario_documento}) a ${a.nombre} (${a.serial})?\n\nSolo documenta la identidad. NO acredita horas, NO aplica la CxC y NO vuelve a recibir dinero.`)) return;
    setSavingProvisionalLink(true); setProvisionalError(null);
    try {
      const { error } = await supabase.rpc('fn_vincular_pago_provisional', {
        p_pago_id: p.id, p_student_id: a.student_id,
      });
      if (error) throw new Error(error.message);
      setProvisionalLinkId(null); setProvisionalStudentId('');
      await refresh();
    } catch (err) { setProvisionalError(errMsg(err, 'No se pudo vincular el pago.')); }
    finally { setSavingProvisionalLink(false); }
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
        cajaId: f.caja_id, subcaja, registradoPor: auditRole, esPrestamo: true, prestamista: f.prestamista,
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
          referencia: refPrestamo, fecha: fechaISO, registrado_por: auditRole, es_prestamo: true, prestamista: f.prestamista,
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
    if (saldoOrigen < monto) { setTransferError(`Saldo insuficiente en ${cajaOrigen.nombre}: ${fmtMonto(saldoOrigen, f.moneda)}. Transferencia bloqueada.`); return; }

    setSavingTransfer(true);
    const transferId = uuid4(), salidaId = uuid4(), entradaId = uuid4();
    const referencia = `TRF-${genHash(transferId)}`;
    const concepto   = f.concepto.toUpperCase().trim();
    const base = { moneda: f.moneda, monto, referencia, fecha: isoDe(f.fecha), registrado_por: auditRole, transfer_id: transferId };
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
      const base = { moneda, monto: cuenta.monto_total, referencia, fecha: new Date().toISOString(), registrado_por: auditRole };

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
              cajaId, subcaja, registradoPor: auditRole,
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
      const { data: cxpCreada, error } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP', entidad_nombre: f.entidad_nombre.toUpperCase().trim(), entidad_tipo: f.entidad_tipo,
        proveedor_id: f.proveedor_id || null, moneda: f.moneda, monto_total: num, monto_pendiente: num,
        concepto: f.concepto.toUpperCase().trim(), fecha_emision: isoDe(f.fecha_emision),
        fecha_vencimiento: f.fecha_vencimiento ? isoDe(f.fecha_vencimiento) : null,
        estatus: 'PENDIENTE', notas: f.notas || null,
      }]).select('id').single();   // [CHG v17] id para clasificar la factura
      if (error) { setCuentaError(`Error: ${error.message}`); return; }
      // [NEW v17] clase contable de la factura (gasto devengado por aeronave / sede / servicio)
      const cxpId = (cxpCreada as { id?: string | number } | null)?.id;
      if (cxpId != null && claseTieneDatos(cuentaClase)) {
        const { error: eCl } = await supabase.rpc('fn_clasificar_registros', {
          p_tabla: 'cuentas_generales', p_ids: [String(cxpId)], p_clase: claseAPayload(cuentaClase, f.moneda === 'BS' ? tasaBCV : null),
        });
        if (eCl) setCuentaError(`CxP registrada, pero no se pudo clasificar: ${isMissingRpc(eCl) ? 'migración v17 no instalada' : eCl.message}`);
      }
      setCuentaClase(CLASE_VACIA);
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
      const { error: eReq } = await supabase.from('solicitudes_compra').update({ estatus: 'APROBADO', aprobado_por: auditRole }).eq('id', reqId);
      if (eReq) throw new Error(`Requisición: ${eReq.message}`);
      await refresh();
    } catch (err) { setReqError(errMsg(err, 'Error al aprobar.')); }
    finally { setSavingAction(null); }
  };

  const handleRejectReq = async (reqId: string) => {
    if (savingAction) return;
    setSavingAction(reqId);
    try {
      const { error } = await supabase.from('solicitudes_compra').update({ estatus: 'RECHAZADO', aprobado_por: auditRole }).eq('id', reqId);
      if (error) throw new Error(error.message);
      await refresh();
    } catch (err) { setReqError(errMsg(err, 'Error al rechazar.')); }
    finally { setSavingAction(null); }
  };

  // ─── [NEW v17] BILLETERAS ─────────────────────────────────────────────────
  //  Recarga  : Bóveda +M · Caja +M · Pagador · Billetera +USD (anticipo, pasivo) [· aplicación FIFO a deudas]
  //  Consumo  : Billetera −min(saldo, total) · déficit → CxC (USD, 0 h) · ingreso devengado por clase
  //  Reembolso: Bóveda −M · Caja −M · Billetera −USD (cancela pasivo, no es gasto)

  /** RPC v17 con traducción de errores del motor */
  const rpcV17 = useCallback(async (fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      if (isMissingRpc(error)) throw new Error('Migración v17 no instalada: ejecute migracion_finance_v17_billetera_clases.sql en Supabase.');
      throw new Error(traducirErrorMotor(`${error.message} ${error.details ?? ''}`));
    }
    return (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  }, []);

  const alumnoPorId = useCallback((id: string | null | undefined) => (id ? alumnos.find(a => a.student_id === id) ?? null : null), [alumnos]);
  const alumnoSel   = alumnoPorId(walletSel);

  const guardV17 = (): string | null => {
    if (!v17Instalado)     return 'Migración v17 no instalada: ejecute migracion_finance_v17_billetera_clases.sql en Supabase.';
    if (sinSesion)         return 'Sesión expirada: inicie sesión de nuevo.';
    if (fetchErrors.length) return 'Hay consultas financieras con error. Corrija esas alertas antes de operar.';
    return null;
  };

  const abrirWalletModal = (tipo: WalletModal, studentId: string) => {
    const al = alumnoPorId(studentId);
    if (!al) return;
    setWalletSel(studentId); setWalletError(null); setWalletInfo(null);
    if (tipo === 'RECARGA') {
      const moneda: PaymentMethod = 'ZELLE';
      setRecargaForm({ ...RECARGA_INIT, moneda, tasa: String(tasaBCV), caja_id: defaultCajaFor(moneda), aplicar_deudas: deudaAlumnoUSD(studentId) > 0 });
      setRecargaPago(pagoDeAlumno(recibidoPor, al.student_id, al.nombre));
    } else if (tipo === 'CONSUMO') {
      setConsumoForm({ ...CONSUMO_INIT });
      setConsumoClase({ ...CLASE_VACIA, sede: normTxt(al.sede).replace('Í', 'I') });
    } else if (tipo === 'AJUSTE') {
      setAjusteForm({ tipo: 'AJUSTE_CREDITO', monto: '', motivo: '' });
    } else {
      const moneda: PaymentMethod = 'ZELLE';
      setReembolsoForm({ monto_usd: '', moneda, tasa: String(tasaBCV), caja_id: defaultCajaFor(moneda), subcaja: 'ADM', fecha: hoyISO(), concepto: '', referencia: '' });
    }
    setWalletModal(tipo);
  };
  const cerrarWalletModal = () => { setWalletModal(null); setWalletError(null); };

  /** Al elegir servicio del tarifario: tipo, precio, descripción y clase sugeridos */
  const elegirServicioConsumo = (id: string) => {
    const s = servicios.find(x => x.id === id);
    setConsumoForm(p => ({
      ...p, servicio_id: id, tipo: s?.tipo ?? p.tipo, precio: s ? String(s.precio_usd) : p.precio,
      descripcion: s ? s.nombre.toUpperCase() : p.descripcion,
    }));
    if (s) setConsumoClase(c => ({ ...c, servicio: s.clase_servicio || SERVICIO_POR_TIPO[s.tipo], aeronave: s.aeronave_matricula ? normTxt(s.aeronave_matricula) : c.aeronave, sede: s.sede ? normTxt(s.sede) : c.sede }));
  };

  const handleRecarga = async (e: React.FormEvent) => {
    e.preventDefault(); setWalletError(null);
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    if (!canManageFinance) { setWalletError('Su rol no puede recibir dinero (CEO / ADMIN / DIRECTOR).'); return; }
    const al = alumnoSel;
    if (!al) { setWalletError('Seleccione el alumno.'); return; }
    const f = recargaForm;
    const monto = round2(parseFloat(f.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setWalletError('Monto inválido.'); return; }
    const tasa = round4(parseFloat(f.tasa));
    const montoUsd = f.moneda === 'BS' ? (tasa > 0 ? round2(monto / tasa) : NaN) : monto;
    if (!Number.isFinite(montoUsd) || montoUsd <= 0) { setWalletError('Tasa Bs/USD inválida.'); return; }
    if (!f.caja_id) { setWalletError('Seleccione la caja que recibe el dinero (obligatorio en recargas).'); return; }
    const cajaErr = validarCajaMoneda(f.caja_id, f.moneda);
    if (cajaErr) { setWalletError(cajaErr); return; }
    const errPago = validarPago(recargaPago, f.moneda);
    if (errPago) { setWalletError(errPago); return; }
    const extra = f.concepto.trim().toUpperCase();
    const asiento = conPrefijo(buildFlujo({
      evento: 'INGRESO_DIRECTO', dir: 'IN', ledgerType: 'INCOME', moneda: f.moneda, monto, fechaISO: isoDe(f.fecha),
      concepto: `RECARGA BILLETERA · ${al.nombre}${extra ? ` · ${extra}` : ''}`, entityName: al.nombre, entityId: al.student_id,
      category: CATEGORIA_BILLETERA, cajaId: f.caja_id, subcaja: cajaEsEfectivo(f.caja_id) ? f.subcaja : null, registradoPor: auditRole,
      referenciaExterna: recargaPago.referencia_pago.trim().toUpperCase() || undefined, pago: recargaPago,
      meta: { origen: 'WALLET_RECARGA', student_serial: al.serial, monto_usd: montoUsd, tasa: f.moneda === 'BS' ? tasa : null },
    }), 'WAL');
    setSavingWallet(true);
    try {
      const r = await rpcV17('fn_wallet_recargar', {
        p_asiento: asiento,
        p_recarga: {
          student_id: al.student_id, monto_usd: montoUsd, moneda_origen: f.moneda, monto_origen: monto,
          tasa: f.moneda === 'BS' ? tasa : null, aplicar_deudas: f.aplicar_deudas, concepto: extra || 'RECARGA DE BILLETERA',
        },
      });
      setRecargaPago(pagoRegistrado(recargaPago));
      const aplicado = Number(r.aplicado_cxc ?? 0);
      setWalletInfo(`Recarga ${asiento.referencia}: +${usd(montoUsd)} a ${al.nombre}${aplicado > 0 ? ` · ${usd(aplicado)} aplicados a deudas` : ''} · saldo ${usd(Number(r.saldo ?? 0))}.`);
      setWalletModal(null);
      await refresh();
    } catch (err) { setWalletError(errMsg(err, 'No se pudo registrar la recarga.')); }
    finally { setSavingWallet(false); }
  };

  const handleConsumo = async (e: React.FormEvent) => {
    e.preventDefault(); setWalletError(null);
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    const al = alumnoSel;
    if (!al) { setWalletError('Seleccione el alumno.'); return; }
    const f = consumoForm;
    const cantidad = round2(parseFloat(f.cantidad));
    if (!Number.isFinite(cantidad) || cantidad <= 0) { setWalletError('Cantidad inválida.'); return; }
    const serv = servicios.find(s => s.id === f.servicio_id) ?? null;
    const precio = f.modo === 'BILLETERA' ? round2(parseFloat(f.precio)) : 0;
    if (f.modo === 'BILLETERA' && (!Number.isFinite(precio) || precio < 0)) { setWalletError('Precio unitario inválido.'); return; }
    const descripcion = (f.descripcion.trim() || serv?.nombre || '').toUpperCase();
    if (descripcion.length < 3) { setWalletError('Describa el consumo.'); return; }
    setSavingWallet(true);
    try {
      const r = await rpcV17('fn_wallet_consumir', {
        p: {
          student_id: al.student_id, servicio_id: serv?.id ?? null, tipo: f.tipo,
          unidad: serv?.unidad ?? TIPOS_CONSUMO.find(t => t.k === f.tipo)?.unidad ?? 'UNIDAD',
          descripcion, cantidad, precio_unitario_usd: precio, fecha: f.fecha, modo: f.modo,
          clase_servicio: consumoClase.servicio || null, clase_aeronave: consumoClase.aeronave || null,
          clase_sede: consumoClase.sede || null, clase_piloto: consumoClase.piloto || null,
          clase_proyecto: consumoClase.proyecto || null, autorizar_sobre_limite: f.autorizar,
        },
      });
      const aCxc = Number(r.a_cxc ?? 0);
      setWalletInfo(`Consumo de ${al.nombre}: ${usd(Number(r.monto_total ?? 0))} · billetera ${usd(Number(r.desde_billetera ?? 0))}${aCxc > 0 ? ` · ${usd(aCxc)} pasan a cuentas por cobrar` : ''}.`);
      setWalletModal(null);
      await refresh();
    } catch (err) { setWalletError(errMsg(err, 'No se pudo registrar el consumo.')); }
    finally { setSavingWallet(false); }
  };

  const handleAjuste = (e: React.FormEvent) => {
    e.preventDefault(); setWalletError(null);
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    const al = alumnoSel;
    if (!al) { setWalletError('Seleccione el alumno.'); return; }
    const monto = round2(parseFloat(ajusteForm.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setWalletError('Monto inválido.'); return; }
    if (ajusteForm.motivo.trim().length < 5) { setWalletError('Indique el motivo (mínimo 5 caracteres).'); return; }
    if (ajusteForm.tipo === 'AJUSTE_DEBITO' && monto > (saldoWallet.get(al.student_id) ?? 0)) { setWalletError('El débito excede el saldo de la billetera.'); return; }
    const f = { ...ajusteForm };
    requireDirectorCode(async () => {
      setSavingWallet(true);
      try {
        const r = await rpcV17('fn_wallet_ajuste', { p_student: al.student_id, p_tipo: f.tipo, p_monto: monto, p_motivo: f.motivo.trim().toUpperCase(), p_fecha: hoyISO() });
        setWalletInfo(`${WALLET_MOV_LABEL[f.tipo]} de ${usd(monto)} a ${al.nombre} · saldo ${usd(Number(r.saldo ?? 0))}.`);
        setWalletModal(null);
        await refresh();
      } catch (err) { setWalletError(errMsg(err, 'No se pudo registrar el ajuste.')); }
      finally { setSavingWallet(false); }
    });
  };

  const handleReembolso = (e: React.FormEvent) => {
    e.preventDefault(); setWalletError(null);
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    if (!canManageFinance) { setWalletError('Su rol no puede sacar dinero (CEO / ADMIN / DIRECTOR).'); return; }
    const al = alumnoSel;
    if (!al) { setWalletError('Seleccione el alumno.'); return; }
    const f = { ...reembolsoForm };
    const montoUsd = round2(parseFloat(f.monto_usd));
    if (!Number.isFinite(montoUsd) || montoUsd <= 0) { setWalletError('Monto inválido.'); return; }
    if (montoUsd > (saldoWallet.get(al.student_id) ?? 0) + 0.001) { setWalletError('El reembolso excede el saldo de la billetera.'); return; }
    const tasa = round4(parseFloat(f.tasa));
    if (f.moneda === 'BS' && !(tasa > 0)) { setWalletError('Tasa Bs/USD inválida.'); return; }
    const montoOrigen = f.moneda === 'BS' ? round2(montoUsd * tasa) : montoUsd;
    if (!f.caja_id) { setWalletError('Seleccione la caja de donde sale el dinero.'); return; }
    const cajaErr = validarCajaMoneda(f.caja_id, f.moneda);
    if (cajaErr) { setWalletError(cajaErr); return; }
    const subcaja = cajaEsEfectivo(f.caja_id) ? f.subcaja : null;
    if (!confirmarFondos(f.moneda, montoOrigen, f.caja_id, subcaja)) return;
    const asiento = conPrefijo(buildFlujo({
      evento: 'GASTO_DIRECTO', dir: 'OUT', ledgerType: 'EXPENSE', moneda: f.moneda, monto: montoOrigen, fechaISO: isoDe(f.fecha),
      concepto: `REEMBOLSO BILLETERA · ${al.nombre}${f.concepto.trim() ? ` · ${f.concepto.trim().toUpperCase()}` : ''}`,
      entityName: al.nombre, entityId: al.student_id, category: CATEGORIA_REEMBOLSO, cajaId: f.caja_id, subcaja,
      registradoPor: auditRole, referenciaExterna: f.referencia.trim().toUpperCase() || undefined,
      meta: { origen: 'WALLET_REEMBOLSO', student_serial: al.serial, monto_usd: montoUsd, tasa: f.moneda === 'BS' ? tasa : null },
    }), 'WRE');
    requireDirectorCode(async () => {
      setSavingWallet(true);
      try {
        const r = await rpcV17('fn_wallet_reembolsar', {
          p_asiento: asiento,
          p_reembolso: { student_id: al.student_id, monto_usd: montoUsd, moneda_origen: f.moneda, monto_origen: montoOrigen,
            tasa: f.moneda === 'BS' ? tasa : null, concepto: f.concepto.trim().toUpperCase() || 'REEMBOLSO DE BILLETERA' },
        });
        setWalletInfo(`Reembolso ${asiento.referencia} a ${al.nombre}: ${fmtMonto(montoOrigen, f.moneda)} · saldo ${usd(Number(r.saldo ?? 0))}.`);
        setWalletModal(null);
        await refresh();
      } catch (err) { setWalletError(errMsg(err, 'No se pudo registrar el reembolso.')); }
      finally { setSavingWallet(false); }
    });
  };

  /** Aplica saldo de billetera a deudas del alumno (FIFO) o a una CxC puntual. No mueve caja. */
  const aplicarBilleteraADeuda = async (studentId: string, cxcId?: string) => {
    const g = guardV17();
    if (g) { setWalletError(g); setCuentaError(g); return; }
    const saldo = saldoWallet.get(studentId) ?? 0;
    if (saldo <= 0) { alert('El alumno no tiene saldo en su billetera.'); return; }
    const nombre = alumnoPorId(studentId)?.nombre ?? 'ALUMNO';
    if (!window.confirm(`Aplicar hasta ${usd(saldo)} de la billetera de ${nombre} a ${cxcId ? 'esta cuenta por cobrar' : 'sus deudas (más antiguas primero)'}?\n\nNo mueve caja: el dinero ya fue recibido como anticipo.`)) return;
    setSavingAction(cxcId ?? studentId);
    try {
      const r = await rpcV17('fn_wallet_aplicar_cxc', { p_student: studentId, p_cxc_id: cxcId ?? null, p_monto: null });
      setWalletInfo(`Aplicados ${usd(Number(r.aplicado ?? 0))} de la billetera de ${nombre} · saldo ${usd(Number(r.saldo ?? 0))}.`);
      await refresh();
    } catch (err) { const msg = errMsg(err, 'No se pudo aplicar el saldo.'); setWalletError(msg); setCuentaError(msg); }
    finally { setSavingAction(null); }
  };

  /** Carga un vuelo de bitácora a la billetera (o lo marca cubierto por paquete anterior) */
  const cargarVuelo = async (v: VueloBitacora, modo: ModoConsumo) => {
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    if (modo === 'BILLETERA' && !tarifaVuelo(v.matricula)) { setWalletError(`Sin tarifa de vuelo activa para ${v.matricula ?? 'la aeronave'}: configure el Tarifario.`); return; }
    setVueloCargando(v.id); setWalletError(null);
    try {
      const r = await rpcV17('fn_wallet_cargar_vuelo', {
        p_vuelo_id: v.id, p_servicio_id: null, p_modo: modo, p_precio: null, p_piloto: null, p_autorizar_sobre_limite: false,
      });
      const nombre = alumnoPorId(v.student_id)?.nombre ?? 'ALUMNO';
      const aCxc = Number(r.a_cxc ?? 0);
      setWalletInfo(modo === 'BILLETERA'
        ? `Vuelo ${v.matricula ?? ''} de ${nombre}: ${usd(Number(r.monto_total ?? 0))}${aCxc > 0 ? ` · ${usd(aCxc)} a cuentas por cobrar` : ''}.`
        : `Vuelo ${v.matricula ?? ''} de ${nombre} marcado como ${MODO_CONSUMO_LABEL[modo].toLowerCase()}.`);
      await refresh();
    } catch (err) { setWalletError(errMsg(err, 'No se pudo cargar el vuelo.')); }
    finally { setVueloCargando(null); }
  };

  const cargarTodosVuelos = async () => {
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    const lista = vuelosPorCargar.filter(v => tarifaVuelo(v.matricula));
    if (!lista.length) { setWalletError('No hay vuelos con tarifa configurada para cargar.'); return; }
    if (!window.confirm(`Cargar ${lista.length} vuelo(s) a las billeteras con la tarifa vigente de cada aeronave?\nLo que no cubra el saldo pasará a cuentas por cobrar.`)) return;
    setVueloCargando('ALL'); setWalletError(null);
    const errores: string[] = [];
    let ok = 0;
    for (const v of lista) {   // secuencial: cada carga es una transacción con bloqueo por alumno
      try {
        await rpcV17('fn_wallet_cargar_vuelo', { p_vuelo_id: v.id, p_servicio_id: null, p_modo: 'BILLETERA', p_precio: null, p_piloto: null, p_autorizar_sobre_limite: false });
        ok++;
      } catch (err) { errores.push(`${alumnoPorId(v.student_id)?.nombre ?? 'ALUMNO'} ${fmtDate(v.fecha)}: ${errMsg(err, 'error')}`); }
    }
    setVueloCargando(null);
    setWalletInfo(`${ok} de ${lista.length} vuelo(s) cargados.`);
    if (errores.length) setWalletError(`${errores.length} vuelo(s) no se cargaron: ${errores.slice(0, 4).join(' · ')}${errores.length > 4 ? ' …' : ''}`);
    await refresh();
  };

  /** Reverso de movimiento / anulación de consumo (motivo + clave director) */
  const pedirRevertir = (m: WalletMovimiento) => {
    if (m.tipo === 'CONSUMO' && m.consumo_id) {
      const c = consumos.find(x => x.id === m.consumo_id);
      setMotivoTexto('');
      setMotivoAccion({ tipo: 'ANULAR_CONSUMO', id: m.consumo_id, titulo: 'Anular consumo', detalle: `${c?.descripcion ?? m.concepto} · ${usd(c?.monto_total_usd ?? m.monto_usd)}` });
      return;
    }
    setMotivoTexto('');
    setMotivoAccion({ tipo: 'REVERTIR', id: m.id, titulo: `Revertir ${WALLET_MOV_LABEL[m.tipo]}`, detalle: `${m.concepto} · ${m.referencia} · ${usd(m.monto_usd)}` });
  };
  const pedirAnularConsumo = (c: WalletConsumo) => {
    setMotivoTexto('');
    setMotivoAccion({ tipo: 'ANULAR_CONSUMO', id: c.id, titulo: 'Anular consumo', detalle: `${c.descripcion} · ${usd(c.monto_total_usd)}${c.monto_cxc_usd > 0 ? ` (incluye ${usd(c.monto_cxc_usd)} en CxC)` : ''}` });
  };
  const confirmarMotivo = () => {
    const acc = motivoAccion;
    if (!acc) return;
    if (motivoTexto.trim().length < 5) { setWalletError('Indique el motivo (mínimo 5 caracteres).'); return; }
    const motivo = motivoTexto.trim().toUpperCase();
    setMotivoAccion(null);
    requireDirectorCode(async () => {
      setSavingAction(acc.id);
      try {
        if (acc.tipo === 'REVERTIR') await rpcV17('fn_wallet_revertir_movimiento', { p_mov_id: acc.id, p_motivo: motivo });
        else await rpcV17('fn_wallet_anular_consumo', { p_consumo_id: acc.id, p_motivo: motivo });
        setWalletInfo(`${acc.titulo}: completado. ${acc.detalle}`);
        await refresh();
      } catch (err) {
        const msg = errMsg(err, 'No se pudo completar la operación.');
        setWalletError(msg); setLedgerError(msg); setCajaError(msg); setCuentaError(msg);
      } finally { setSavingAction(null); }
    });
  };

  /** Anticipo sin matrícula VINCULADO → saldo de billetera (no vuelve a recibir dinero) */
  const aplicarProvisionalBilletera = async (p: PagoProvisional) => {
    const g = guardV17();
    if (g) { setProvisionalError(g); return; }
    let tasa: number | null = null;
    if (p.moneda === 'BS') {
      const t = window.prompt(`Tasa Bs/USD para convertir ${fmtMonto(p.monto, 'BS')} a USD:`, String(tasaBCV));
      if (t === null) return;
      tasa = round4(parseFloat(t));
      if (!Number.isFinite(tasa) || tasa <= 0) { setProvisionalError('Tasa inválida.'); return; }
    }
    const montoUsd = p.moneda === 'BS' && tasa ? round2(p.monto / tasa) : p.monto;
    const al = alumnoPorId(p.student_id);
    if (!window.confirm(`Aplicar el anticipo ${p.referencia_pago} (${fmtMonto(p.monto, p.moneda)} ≈ ${usd(montoUsd)}) a la billetera de ${al?.nombre ?? 'el alumno'}?\n\nNo vuelve a recibir dinero: convierte el anticipo en saldo disponible.`)) return;
    setSavingProvisionalLink(true); setProvisionalError(null);
    try {
      await rpcV17('fn_wallet_aplicar_provisional', { p_pago_id: p.id, p_tasa: tasa });
      await refresh();
    } catch (err) { setProvisionalError(errMsg(err, 'No se pudo aplicar el anticipo.')); }
    finally { setSavingProvisionalLink(false); }
  };

  /** Tarifario */
  const abrirServicio = (s?: ServicioCatalogo) => setServicioEdit(s
    ? { id: s.id, codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, unidad: s.unidad, precio: String(s.precio_usd),
        aeronave_matricula: s.aeronave_matricula ?? '', sede: s.sede ?? '', clase_servicio: s.clase_servicio, activo: s.activo, notas: s.notas ?? '' }
    : { id: null, codigo: '', nombre: '', tipo: 'VUELO', unidad: 'HORA', precio: '', aeronave_matricula: '', sede: '',
        clase_servicio: 'INSTRUCCION_VUELO', activo: true, notas: '' });
  const guardarServicio = async () => {
    const s = servicioEdit;
    if (!s) return;
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    const precio = round2(parseFloat(s.precio));
    if (!Number.isFinite(precio) || precio < 0) { setWalletError('Precio inválido.'); return; }
    if (!s.codigo.trim() || !s.nombre.trim()) { setWalletError('Código y nombre son obligatorios.'); return; }
    setSavingWallet(true); setWalletError(null);
    try {
      await rpcV17('fn_servicio_guardar', { p: {
        id: s.id, codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, unidad: s.unidad, precio_usd: precio,
        aeronave_matricula: s.aeronave_matricula || null, sede: s.sede || null, clase_servicio: s.clase_servicio,
        activo: s.activo, notas: s.notas,
      } });
      setServicioEdit(null);
      await refresh();
    } catch (err) { setWalletError(errMsg(err, 'No se pudo guardar el servicio.')); }
    finally { setSavingWallet(false); }
  };

  const guardarConfig = async () => {
    const g = guardV17();
    if (g) { setWalletError(g); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(configForm.corte)) { setWalletError('Fecha de corte inválida.'); return; }
    const cred = configForm.credito.trim() === '' ? null : round2(parseFloat(configForm.credito));
    if (cred !== null && (!Number.isFinite(cred) || cred < 0)) { setWalletError('Límite de crédito inválido.'); return; }
    setSavingWallet(true); setWalletError(null);
    try {
      await rpcV17('fn_finanzas_config_set', { p_clave: 'wallet_fecha_corte', p_valor: configForm.corte });
      await rpcV17('fn_finanzas_config_set', { p_clave: 'credito_maximo_usd', p_valor: cred });
      setWalletInfo('Configuración guardada.');
      await refresh();
    } catch (err) { setWalletError(errMsg(err, 'No se pudo guardar la configuración.')); }
    finally { setSavingWallet(false); }
  };

  /** Reclasificación (solo metadatos de clase: nunca toca montos) */
  const abrirReclas = (a: ReclasAccion) => { setReclasForm(a.inicial); setReclasAccion(a); };
  const handleReclasificar = async () => {
    const a = reclasAccion;
    if (!a) return;
    const g = guardV17();
    if (g) { alert(g); return; }
    setSavingWallet(true);
    try {
      const grupos = new Map<TablaClase, string[]>();
      for (const it of a.items) grupos.set(it.tabla, [...(grupos.get(it.tabla) ?? []), it.id]);
      for (const [tabla, ids] of grupos) {
        await rpcV17('fn_clasificar_registros', { p_tabla: tabla, p_ids: ids, p_clase: claseAPayload(reclasForm) });
      }
      setReclasAccion(null);
      await refresh();
    } catch (err) { alert(errMsg(err, 'No se pudo clasificar.')); }
    finally { setSavingWallet(false); }
  };

  // ─── [NEW v17] IMPRESIÓN ──────────────────────────────────────────────────

  /** Estado de cuenta del alumno: billetera, consumos, CxC y pagos con trazabilidad */
  const imprimirEstadoCuenta = (studentId: string) => {
    const al = alumnoPorId(studentId);
    if (!al) return;
    const movs  = walletMovs.filter(m => m.student_id === studentId).slice().sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
    const cons  = consumos.filter(c => c.student_id === studentId).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const cxc   = cuentasCxC.filter(c => c.student_id === studentId).slice().sort((a, b) => String(a.fecha_emision).localeCompare(String(b.fecha_emision)));
    const pagAl = pagos.filter(p => p.alumno_id === studentId && !p.anulado).slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    const saldo = saldoWallet.get(studentId) ?? 0;
    const deuda = deudaAlumnoUSD(studentId);
    const recargado = round2(movs.filter(m => !m.revertido && ['RECARGA', 'ANTICIPO_APLICADO', 'SALDO_INICIAL'].includes(m.tipo)).reduce((a, m) => a + m.monto_usd, 0));
    const consumido = round2(cons.filter(c => c.estado === 'VIGENTE' && c.modo === 'BILLETERA').reduce((a, c) => a + c.monto_total_usd, 0));
    imprimirDocumento({
      titulo: 'Estado de Cuenta del Alumno', subtitulo: `${al.nombre} · ${al.serial} · Sede ${al.sede}`,
      meta: [['Alumno', al.nombre], ['Serial', al.serial]],
      resumen: [['Saldo billetera', usd(saldo)], ['Deuda pendiente', usd(deuda)], ['Posición neta', usd(round2(saldo - deuda))],
        ['Total acreditado', usd(recargado)], ['Total consumido', usd(consumido)]],
      secciones: [
        { titulo: 'Movimientos de billetera', columnas: ['Fecha', 'Tipo', 'Concepto', 'Referencia', 'Crédito', 'Débito', 'Saldo'],
          alinear: ['l', 'l', 'l', 'l', 'r', 'r', 'r'],
          filas: movs.map(m => [fmtDate(m.fecha), `${WALLET_MOV_LABEL[m.tipo]}${m.revertido ? ' (revertido)' : ''}`, m.concepto, m.referencia,
            m.signo > 0 ? usd(m.monto_usd) : '', m.signo < 0 ? usd(m.monto_usd) : '', usd(m.saldo_resultante)]) },
        { titulo: 'Servicios consumidos', columnas: ['Fecha', 'Descripción', 'Cant.', 'P. unit.', 'Total', 'Billetera', 'A crédito', 'Estado'],
          alinear: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'l'],
          filas: cons.map(c => [fmtDate(c.fecha), c.descripcion, `${c.cantidad} ${c.unidad}`, usd(c.precio_unitario_usd), usd(c.monto_total_usd),
            usd(c.monto_billetera_usd), usd(c.monto_cxc_usd), c.estado === 'ANULADO' ? 'ANULADO' : c.modo === 'BILLETERA' ? 'VIGENTE' : MODO_CONSUMO_LABEL[c.modo]]),
          totales: ['', 'Total consumido', '', '', usd(consumido), '', '', ''] },
        { titulo: 'Cuentas por cobrar', columnas: ['Emisión', 'Concepto', 'Total', 'Pagado', 'Pendiente', 'Estatus'], alinear: ['l', 'l', 'r', 'r', 'r', 'l'],
          filas: cxc.map(c => [fmtDate(c.fecha_emision), c.concepto, fmtMonto(c.monto_total, normalizePaymentMethod(c.moneda)),
            fmtMonto(c.monto_pagado, normalizePaymentMethod(c.moneda)), fmtMonto(c.monto_pendiente, normalizePaymentMethod(c.moneda)), c.estatus]),
          totales: ['', 'Pendiente total (USD eq.)', '', '', usd(deuda), ''] },
        { titulo: 'Pagos recibidos (trazabilidad)', columnas: ['Fecha', 'Método', 'Monto', 'Referencia', 'Pagó', 'Recibió'], alinear: ['l', 'l', 'r', 'l', 'l', 'l'],
          filas: pagAl.map(p => [fmtDate(p.fecha), p.metodo, fmtMonto(p.monto, p.metodo), p.referencia_pago ?? '—', `${p.pagador_nombre}${p.pagador_documento ? ` · ${p.pagador_documento}` : ''}`, p.recibido_por]) },
      ],
      pie: 'Saldo de billetera en USD. Los pagos en Bs se acreditan a la tasa del día del pago. Documento sin validez fiscal.',
    });
  };

  /** Movimientos de caja global o por caja en un período */
  const imprimirMovimientosCaja = (cajaId: string | null, desde: string, hasta: string) => {
    const lista = cajaId ? cajas.filter(c => c.id === cajaId) : cajas;
    const secciones: PrintSeccion[] = lista.map((c): PrintSeccion => {
      const movs = movCajas.filter(m => m.caja_id === c.id && fechaInput(m.fecha) >= desde && fechaInput(m.fecha) <= hasta)
        .slice().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
      const tot = ALL_METHODS.map(mo => {
        const ms = movs.filter(m => m.moneda === mo);
        return { mo, ent: round2(ms.filter(m => m.tipo === 'ENTRADA').reduce((a, m) => a + m.monto, 0)), sal: round2(ms.filter(m => m.tipo === 'SALIDA').reduce((a, m) => a + m.monto, 0)) };
      }).filter(x => x.ent || x.sal);
      return {
        titulo: c.nombre, columnas: ['Fecha', 'Tipo', 'Moneda', 'Monto', 'Concepto', 'Referencia', 'Pagó → Recibió / Registró'],
        alinear: ['l', 'l', 'l', 'r', 'l', 'l', 'l'],
        filas: movs.map(m => {
          const pg = m.asiento_id ? pagoPorAsiento.get(m.asiento_id) : undefined;
          return [fmtDate(m.fecha), m.tipo, m.moneda, `${m.tipo === 'ENTRADA' ? '+' : '−'}${fmtMonto(m.monto, m.moneda)}`, m.concepto, m.referencia ?? '',
            pg ? `${pg.pagador_nombre} → ${pg.recibido_por}` : (m.registrado_por ?? '')];
        }),
        nota: tot.length ? tot.map(x => `${x.mo}: entradas ${fmtMonto(x.ent, x.mo)} · salidas ${fmtMonto(x.sal, x.mo)} · neto ${fmtMonto(round2(x.ent - x.sal), x.mo)}`).join('   |   ') : undefined,
      };
    }).filter(s => cajaId || s.filas.length > 0);
    imprimirDocumento({
      titulo: cajaId ? `Movimientos de caja · ${lista[0]?.nombre ?? ''}` : 'Movimientos de caja · Global',
      subtitulo: `${fmtDate(desde)} – ${fmtDate(hasta)}`, horizontal: true,
      meta: [['Cajas', String(lista.length)]],
      resumen: ALL_METHODS.map(m => [`Saldo actual ${m}`, fmtMonto(round2(lista.reduce((a, c) => a + getCajaBalance(c.id, m), 0)), m)] as [string, string]),
      secciones: secciones.length ? secciones : [{ columnas: ['Sin movimientos en el período'], filas: [] }],
    });
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

  /** [v16.8] CSV independiente de anticipos. Escapa valores y fórmulas peligrosas. */
  const exportProvisionalesCSV = () => {
    const csvSafe = (v: unknown) => {
      let x = String(v ?? '');
      if (/^[=+@-]/.test(x.trimStart())) x = `\'${x}`;
      return `"${x.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['Código', 'Asiento', 'Beneficiario', 'Documento beneficiario', 'Contacto', 'Sede',
       'Concepto', 'Monto', 'Método', 'Referencia externa', 'Caja', 'Fecha pago',
       'Estado', 'Perfil vinculado', 'Pagador real', 'Documento pagador', 'Recibido por',
       'Registrado por', 'Fecha de captura', 'Fecha de vinculación'],
      ...provisionales.map(p => {
        const pg = pagoPorAsiento.get(p.asiento_id);
        return [p.id, p.asiento_id, p.beneficiario_nombre, p.beneficiario_documento,
          p.beneficiario_contacto, p.sede, p.concepto, p.monto.toFixed(2), p.moneda,
          p.referencia_pago, cajaNombre(p.caja_id), p.fecha_pago, p.estado,
          p.student_id, pg?.pagador_nombre, pg?.pagador_documento, pg?.recibido_por,
          pg?.registrado_por_email, p.creado_en, p.vinculado_en];
      }),
    ];
    downloadCSV(rows.map(r => r.map(csvSafe)), `AnticiposSinMatricula_${hoyISO()}.csv`);
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
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core v17.0...</p>
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
    const clTx   = clasifMap.get(`transacciones_finanzas:${t.id}`);                // [NEW v17]
    return (
      <div key={t.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group hover:bg-white/[0.04] transition-all ${border}`}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase flex items-center gap-2">
            {fx && <Badge tone={TONE.fx}>FX {t.fx_leg ?? 'LEGACY'}</Badge>}
            {fin && <Badge tone={TONE.fin}>FINANC.</Badge>}
            {legacy && <Badge tone={TONE.red}>REPOSICIÓN LEGACY</Badge>}
            {t.asiento_id && <Badge tone={TONE.asiento} title="Asiento enlazado (bóveda + caja + cuentas)"><Link2 size={8} /> ASIENTO</Badge>}
            {t.asiento_id && walletMovPorAsiento.has(t.asiento_id) && <Badge tone={TONE.emerald} title="Recarga / reembolso de billetera: se revierte desde Billeteras"><Wallet size={8} /> BILLETERA</Badge>}
            {clTx?.servicio && <Badge tone={TONE.fx} title="Clase contable explícita"><Tag size={8} /> {labelServicio(clTx.servicio)}{clTx.aeronave ? ` · ${clTx.aeronave}` : ''}</Badge>}
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
          {mode === 'DIARIO' && v17Instalado && canManageFinance && !fx && !fin && (   // [NEW v17] clase contable
            <button onClick={() => abrirReclas({ items: [{ tabla: 'transacciones_finanzas', id: t.id }], titulo: `${t.entityName} · ${t.invoiceNumber}`, inicial: claseDeRow(clTx) })}
              title="Clase contable (servicio · aeronave · sede · piloto · proyecto)" className={`${btnIcon} hover:text-teal-400 hover:bg-teal-500/10`}><Tag size={13} /></button>
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
    { key: 'PROVISIONALES', label: 'Sin matrícula', icon: Users },
    { key: 'BILLETERAS', label: 'Billeteras', icon: Wallet }, { key: 'REPORTES', label: 'Reportes', icon: BarChart3 },   // [NEW v17]
    { key: 'REQUISITIONS', label: 'Reqs', icon: FileSignature }, { key: 'CLOSING', label: 'Cierre', icon: Lock },
  ];

  const KPI_CUENTAS = [
    { label: 'Por Cobrar (Alumnos)', value: `$${fmtNum(totalCxC)}`, sub: `${cxcPendientes.length} pendientes · USD eq.`, icon: ArrowUpCircle, card: 'bg-yellow-500/5 border-yellow-500/10', txt: 'text-yellow-400', ico: 'text-yellow-400/20' },
    { label: 'Horas Acreditadas', value: `${totalHorasAcred.toFixed(1)}h`, sub: `${horasPagadas.length} pagados · incluye parciales`, icon: Plane, card: 'bg-emerald-500/5 border-emerald-500/10', txt: 'text-emerald-400', ico: 'text-emerald-400/20' },
    { label: 'Por Pagar (Proveedores + Préstamos)', value: `$${fmtNum(totalCxP)}`, sub: `${cuentasProveedores.filter(c => c.estatus !== 'PAGADO').length} pendientes · USD eq.`, icon: ArrowDownCircle, card: 'bg-orange-500/5 border-orange-500/10', txt: 'text-orange-400', ico: 'text-orange-400/20' },
    { label: 'Reposiciones Internas', value: `$${fmtNum(totalReposiciones)}`, sub: `${cuentasReposiciones.filter(c => c.estatus !== 'PAGADO').length} entre cajas`, icon: ArrowLeftRight, card: 'bg-purple-500/5 border-purple-500/10', txt: 'text-purple-400', ico: 'text-purple-400/20' },
    // [NEW v17] billeteras = anticipos de alumnos (pasivo)
    { label: 'Billeteras (Anticipos)', value: `$${fmtNum(totalBilleteras)}`, sub: `${walletCuentas.filter(w => w.saldo_usd > 0).length} con saldo · ${vuelosPorCargar.length} vuelos por cargar`, icon: Wallet, card: 'bg-teal-500/5 border-teal-500/10', txt: 'text-teal-400', ico: 'text-teal-400/20' },
  ];

  const provisionPendientes = provisionales.filter(p => p.estado === 'PENDIENTE' || p.estado === 'VINCULADO');
  const resumenProvisional = ALL_METHODS.map(m => ({
    moneda: m, saldo: round2(provisionPendientes.filter(p => p.moneda === m).reduce((a,p) => a+p.monto, 0)),
  }));

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">Valkyron Financial Core v17.0</p>
            <p className="text-[7px] text-[#E1AD01]/60 font-black uppercase tracking-[0.25em] mt-1">Motor de asientos · Bóveda ↔ Caja ↔ CxC/CxP ↔ Billetera en una sola operación · P&amp;L por clase</p>
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

      {fetchErrors.length > 0 && (
        <div className="p-4 border border-red-500/40 rounded-xl bg-red-500/10 text-red-300 text-[10px] font-black">
          DATOS FINANCIEROS NO VERIFICADOS: existe al menos una consulta fallida. No certifique saldos ni realice cierres.
        </div>
      )}
      {/* [v16.8] Integridad visible, nunca conciliación silenciosa */}
      {(alertasIntegridad.length > 0 || historicosRevisar > 0) && (
        <div className="p-5 rounded-2xl bg-orange-500/5 border border-orange-500/25 space-y-2">
          <p className="text-[10px] text-orange-400 font-black uppercase flex items-center gap-2"><AlertTriangle size={15} /> Revisión de integridad pendiente</p>
          {historicosRevisar > 0 && <p className="text-[9px] text-orange-200">{historicosRevisar} CxC históricas cobradas sin vínculo al motor de asientos/abonos. No se ha creado ningún movimiento automático.</p>}
          <p className="text-[9px] text-orange-200">{alertasIntegridad.length} posibles anomalías en trazabilidad, asientos o transferencias. No implica fraude ni confirma descuadre.</p>
          {alertasIntegridad.slice(0, 8).map((a, i) => <p key={i} className="text-[8px] text-orange-300/80 font-mono">• {a}</p>)}
          {alertasIntegridad.length > 8 && <p className="text-[8px] text-orange-300">+ {alertasIntegridad.length - 8} hallazgos adicionales. Revisión manual requerida.</p>}
        </div>
      )}

      {/* [NEW v17] estado de la migración v17 (no bloquea el panel v16.8) */}
      {!v17Instalado && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-teal-500/5 border border-teal-500/25">
          <Info size={14} className="text-teal-400 shrink-0 mt-0.5" />
          <p className="text-[9px] text-teal-200 font-mono flex-1">Billeteras, consumos y clases contables requieren <b>migracion_finance_v17_billetera_clases.sql</b>. El resto del panel opera como v16.8.</p>
        </div>
      )}
      {v17Instalado && v17Avisos.length > 0 && (
        <div className="p-4 rounded-xl bg-teal-500/5 border border-teal-500/25 space-y-1">
          <p className="text-[9px] text-teal-400 font-black uppercase">Avisos de billeteras / clases</p>
          {v17Avisos.map(a => <p key={a} className="text-[8px] text-teal-200/80 font-mono break-words">• {a}</p>)}
        </div>
      )}

      {/* KPI BÓVEDAS — operativos vs no operativos (FX + financiamiento) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ALL_METHODS.map(m => {
          const paid  = transactions.filter(t => t.payment_method === m && t.status === 'PAID' && !isNonOperativeTx(t) && t.category !== 'Anticipos sin matrícula');
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
                   ['FX / Financ. / Anticipos', `${fxNet >= 0 ? '+' : '−'}${fmt(Math.abs(fxNet))}`, fxNet >= 0 ? 'text-teal-400' : 'text-teal-600']] as const).map(([l, v, c]) => (
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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

      {/* ══ TAB: ANTICIPOS SIN MATRÍCULA v16.8 ════════════════════════════════ */}
      {activeTab === 'PROVISIONALES' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {resumenProvisional.map(({ moneda, saldo }) => (
              <div key={moneda} className={`${glass} rounded-2xl p-4`}>
                <p className={`text-[9px] font-black ${MONEDA_COLOR[moneda]}`}>{moneda} · POR APLICAR</p>
                <p className="text-xl font-black mt-2">{fmtMonto(saldo, moneda)}</p>
              </div>
            ))}
          </div>
          <div className="border border-orange-500/20 bg-orange-500/5 rounded-xl p-4 text-[9px] text-orange-200">
            Anticipos cobrados, NO ingresos académicos devengados. Vincular un estudiante NO acredita horas ni aplica cuentas por cobrar. No registre nuevamente este dinero al matricularlo.
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <form onSubmit={handlePagoProvisional} className={`${glass} xl:col-span-5 rounded-3xl p-6 space-y-4`}>
              <h2 className="text-[11px] font-black text-[#E1AD01] flex items-center gap-2"><UserCheck size={16} /> Recibir anticipo · Sin matrícula</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><Lbl>Nombre completo del aspirante *</Lbl><input required value={provisionalForm.beneficiario_nombre} onChange={e => setProvisionalForm(p=>({...p, beneficiario_nombre:e.target.value}))} className={inp} placeholder="BENEFICIARIO" /></div>
                <div><Lbl>Cédula / documento del aspirante *</Lbl><input required value={provisionalForm.beneficiario_documento} onChange={e => setProvisionalForm(p=>({...p, beneficiario_documento:e.target.value}))} className={inp} placeholder="CÉDULA / PASAPORTE" /></div>
                <div><Lbl>Contacto del aspirante</Lbl><input value={provisionalForm.beneficiario_contacto} onChange={e => setProvisionalForm(p=>({...p, beneficiario_contacto:e.target.value}))} className={inp} placeholder="TELÉFONO O CORREO" style={noUpper} /></div>
                <div><Lbl>Sede</Lbl><input value={provisionalForm.sede} onChange={e => setProvisionalForm(p=>({...p, sede:e.target.value}))} className={inp} placeholder="BARQUISIMETO / MATURÍN" /></div>
              </div>
              <div><Lbl>Concepto del anticipo *</Lbl><input required value={provisionalForm.concepto} onChange={e => setProvisionalForm(p=>({...p, concepto:e.target.value}))} className={inp} /></div>
              <div><Lbl>Moneda / medio de pago</Lbl><MonedaPicker value={provisionalForm.moneda} onChange={m=>setProvisionalForm(p=>({...p, moneda:m, caja_id:ajustarCaja(p.caja_id,m)}))} /></div>
              <div><Lbl>Monto recibido *</Lbl><AmountInput value={provisionalForm.monto} onChange={v=>setProvisionalForm(p=>({...p,monto:v}))} moneda={provisionalForm.moneda} size="lg" disabled={savingProvisional} /></div>
              <div><Lbl>Caja donde se custodia *</Lbl>
                <select required value={provisionalForm.caja_id} onChange={e=>setProvisionalForm(p=>({...p,caja_id:e.target.value}))} className={inp}>
                  <option value="">— SELECCIONE CAJA —</option>
                  {cajas.map(c=><option key={c.id} value={c.id} disabled={!cajaAceptaMoneda(c,provisionalForm.moneda)}>{c.nombre}{cajaAceptaMoneda(c,provisionalForm.moneda)?'':` · NO ADMITE ${provisionalForm.moneda}`}</option>)}
                </select>
              </div>
              {cajaEsEfectivo(provisionalForm.caja_id) && <SubcajaToggle value={provisionalForm.subcaja} onChange={sc=>setProvisionalForm(p=>({...p,subcaja:sc}))} />}
              <div><Lbl>Fecha del pago</Lbl><input type="date" required value={provisionalForm.fecha} onChange={e=>setProvisionalForm(p=>({...p,fecha:e.target.value}))} className={inp} style={noUpper} /></div>
              <PagadorFields value={provisionalPago} onChange={setProvisionalPago} moneda={provisionalForm.moneda} sinPerfil />
              <p className="text-[8px] text-yellow-400">Referencia / número de recibo obligatorio también para efectivo. Una referencia no puede registrarse dos veces.</p>
              <ErrorBanner msg={provisionalError} onClose={()=>setProvisionalError(null)} />
              <button type="submit" disabled={savingProvisional || sinSesion || !canManageFinance || fetchErrors.length>0}
                className="w-full py-4 bg-[#E1AD01] text-black rounded-xl font-black text-[10px] uppercase disabled:opacity-40">
                {savingProvisional?'Registrando anticipo...':'Registrar pago y generar trazabilidad'}
              </button>
            </form>
            <div className={`${glass} xl:col-span-7 rounded-3xl p-6 space-y-4`}>
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <h2 className="text-[11px] font-black uppercase">Registro de anticipos · {provisionales.length} operaciones</h2>
                <button type="button" onClick={exportProvisionalesCSV} disabled={provisionales.length===0} className="px-3 py-2 rounded-xl text-[9px] border border-white/20 text-[#E1AD01] disabled:opacity-30 flex gap-2 items-center"><Download size={12}/> Exportar CSV</button>
              </div>
              <div className="max-h-[680px] overflow-y-auto space-y-2">
                {provisionales.length===0 && <EmptyState text="Sin anticipos registrados" />}
                {provisionales.map(p=>{
                  const pagador = pagoPorAsiento.get(p.asiento_id);
                  const alumno = p.student_id ? alumnos.find(a=>a.student_id===p.student_id) : null;
                  return <div key={p.id} className="border border-white/10 bg-black/30 rounded-2xl p-4 space-y-2">
                    <div className="flex flex-wrap gap-2 items-center justify-between">
                      <p className="text-[10px] font-black">{p.beneficiario_nombre}</p>
                      <Badge tone={p.estado==='ANULADO'?TONE.red:p.estado==='VINCULADO'?TONE.blue:TONE.yellow}>{p.estado==='VINCULADO'?'Vinculado · NO aplicado':p.estado}</Badge>
                    </div>
                    <p className="text-[9px] text-zinc-400">{p.beneficiario_documento} · {p.sede||'Sede no definida'} · {fmtDate(p.fecha_pago)}</p>
                    <p className="text-[12px] font-black text-emerald-400">{fmtMonto(p.monto,p.moneda)} · REF {p.referencia_pago}</p>
                    <p className="text-[8px] text-zinc-500">{p.concepto}</p>
                    <p className="text-[8px] text-yellow-300">Pagó: {pagador?.pagador_nombre??'REVISAR TRAZABILIDAD'} · Recibió: {pagador?.recibido_por??'REVISAR'} · Caja: {cajaNombre(p.caja_id)}</p>
                    <p className="text-[8px] text-zinc-600 break-all">Asiento: {p.asiento_id} · Registro: {p.creado_en}</p>
                    {alumno && <p className="text-[9px] text-blue-400">Perfil vinculado: {alumno.nombre} · {alumno.serial}. Sin aplicación de CxC/horas.</p>}
                    {/* [NEW v17] anticipo vinculado → saldo de billetera */}
                    {provisionalAplicado.has(p.id) && <Badge tone={TONE.emerald}><Wallet size={8} /> Aplicado a billetera</Badge>}
                    {p.estado === 'VINCULADO' && p.student_id && !provisionalAplicado.has(p.id) && v17Instalado && canManageFinance && (
                      <button type="button" onClick={() => aplicarProvisionalBilletera(p)} disabled={savingProvisionalLink}
                        className="border border-teal-500/30 text-teal-300 rounded-xl px-3 py-2 text-[9px] font-black flex items-center gap-2 disabled:opacity-30">
                        <Wallet size={11} /> Aplicar a billetera del alumno
                      </button>
                    )}
                    {p.estado==='PENDIENTE' && (
                      <button type="button" onClick={()=>{setProvisionalLinkId(p.id);setProvisionalStudentId('');setProvisionalError(null);}}
                        className="border border-blue-500/30 text-blue-300 rounded-xl px-3 py-2 text-[9px] font-black">Vincular a estudiante matriculado</button>
                    )}
                  </div>;
                })}
              </div>
            </div>
          </div>
          {provisionalLinkId && (
            <ModalShell accent="border-t-blue-500">
              <ModalHeader icon={Link2} tone={TONE.blue} title="Vincular identidad" subtitle="No mueve dinero ni acredita horas" onClose={()=>setProvisionalLinkId(null)} />
              <p className="text-[9px] text-zinc-400 mb-4">Verifique el documento del aspirante y su perfil. Esta acción se audita y no permite reutilizar el cobro como uno nuevo.</p>
              <select value={provisionalStudentId} onChange={e=>setProvisionalStudentId(e.target.value)} className={inp}>
                <option value="">— SELECCIONE PERFIL MATRICULADO —</option>
                {alumnos.map(a=><option key={a.student_id} value={a.student_id}>{a.nombre} · {a.serial} · {a.sede}</option>)}
              </select>
              <div className="mt-4"><ErrorBanner msg={provisionalError} onClose={()=>setProvisionalError(null)} /></div>
              <div className="mt-5"><ModalActions onCancel={()=>setProvisionalLinkId(null)} submitCls="bg-blue-500 text-black" busy={savingProvisionalLink}
                disabled={!provisionalStudentId} onSubmit={vincularProvisional} label="Confirmar vínculo documental" /></div>
            </ModalShell>
          )}
        </div>
      )}

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
                  {cajas.length === 0 && <option value="" disabled>SIN CAJAS VISIBLES · REVISE RLS</option>}
                  {cajas.map(c => {
                    const compatible = cajaAceptaMoneda(c, ledger.currency);
                    return <option key={c.id} value={c.id} disabled={!compatible}>{c.nombre}{compatible ? '' : ` · NO ACEPTA ${ledger.currency}`}</option>;
                  })}
                </select>
              </div>
              {ledgerCajaEfe && <SubcajaToggle value={ledger.subcaja} onChange={sc => setLedger(p => ({ ...p, subcaja: sc }))} />}
              {ledger.type === 'INCOME' && <PagadorFields value={ledgerPago} onChange={setLedgerPago} moneda={ledger.currency} alumnos={alumnos} />}
              <AmountInput size="xl" value={ledger.amount} moneda={ledger.currency} prefixCls="text-[#E1AD01]" disabled={savingLedger}
                onChange={v => setLedger(p => ({ ...p, amount: v }))} />
              <input value={ledger.reference} onChange={e => setLedger(p => ({ ...p, reference: e.target.value }))} placeholder="REFERENCIA / TRAZABILIDAD" className={inp} disabled={savingLedger} />
              {/* [NEW v17] clase contable del movimiento */}
              {v17Instalado && (
                <ClaseFields value={ledgerClase} onChange={setLedgerClase} flota={flota} pilotos={pilotosLista}
                  naturaleza={ledger.type === 'INCOME' ? 'INGRESO' : 'GASTO'} />
              )}
              <p className="text-[8px] text-zinc-600 font-mono">Cobros de alumnos y pagos a proveedores se registran desde CxC/CxP para que rebajen la cuenta. Pagos que el alumno deja como saldo: Billeteras → Recargar.</p>
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
                // [NEW v17] impresión global del mes en curso (otros períodos: Reportes → Imprimir movimientos)
                { l: 'Imprimir mes',     icon: Printer,        cls: 'bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/20 hover:bg-[#E1AD01]/20', on: () => imprimirMovimientosCaja(null, `${hoyISO().slice(0, 7)}-01`, hoyISO()) },
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
              <p className="text-zinc-400">Rol efectivo UI: <span className={canManageFinance ? 'text-emerald-400' : 'text-red-400'}>{rolUpper || 'SIN_RANGO'}</span> · fuente: <span className="text-white">{roleSource}</span></p>
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
                    {/* [NEW v17] clase contable del ingreso/gasto real */}
                    {v17Instalado && movForm.clase === 'OPERATIVO' && (
                      <ClaseFields value={movClase} onChange={setMovClase} flota={flota} pilotos={pilotosLista}
                        naturaleza={movForm.tipo === 'ENTRADA' ? 'INGRESO' : 'GASTO'} />
                    )}
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
                      <div className="flex gap-2">
                        <button onClick={() => handleExportCajaIndividual(caja.id)} className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-[8px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-1.5">
                          <Download size={10} /> Exportar
                        </button>
                        {/* [NEW v17] */}
                        <button onClick={() => imprimirMovimientosCaja(caja.id, '2000-01-01', hoyISO())} className="bg-[#E1AD01]/10 text-[#E1AD01] px-3 py-1.5 rounded-lg border border-[#E1AD01]/20 text-[8px] font-black uppercase hover:bg-[#E1AD01]/20 transition-all flex items-center gap-1.5">
                          <Printer size={10} /> Imprimir
                        </button>
                      </div>
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
                          {cajas.length === 0 && <option value="" disabled>SIN CAJAS VISIBLES · REVISE RLS</option>}
                          {cajas.map(c => {
                            const compatible = cajaAceptaMoneda(c, mpForm);
                            const custodia = getCajaConfig(c).tipo === 'CUSTODIA_TERCERO' ? ' · custodia' : '';
                            return <option key={c.id} value={c.id} disabled={!compatible}>{c.nombre}{custodia}{compatible ? '' : ` · NO ACEPTA ${mpForm}`}</option>;
                          })}
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
                    <p className="md:col-span-3 text-[8px] text-zinc-600 font-mono">Los préstamos de Barquisimeto/Roberto se registran en Cajas → Préstamo Externo (crean su CxP y la entrada de dinero en un solo asiento).</p>
                    {/* [NEW v17] clase de la factura: el pago la hereda y el P&L devengado la usa */}
                    {v17Instalado && (
                      <ClaseFields className="md:col-span-3" value={cuentaClase} onChange={setCuentaClase} flota={flota} pilotos={pilotosLista}
                        naturaleza="GASTO" titulo="Clase de la factura (ej. combustible / mantenimiento de una aeronave)" />
                    )}
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
                            {/* [NEW v17] deuda generada por consumo sin fondos */}
                            {consumoPorCxc.has(String(c.id)) && <p className="text-[8px] text-teal-400 font-mono mt-0.5 flex items-center gap-1"><Wallet size={9} /> Consumo sin fondos · billetera</p>}
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
                          {/* [NEW v17] aplicar saldo de billetera (sin mover caja) */}
                          {(saldoWallet.get(c.student_id) ?? 0) > 0 && c.horas_prometidas === 0 && mon !== 'BS' && (
                            <button onClick={() => aplicarBilleteraADeuda(c.student_id, String(c.id))} disabled={savingAction === c.id}
                              title={`Saldo billetera: ${usd(saldoWallet.get(c.student_id) ?? 0)}`}
                              className="px-3 py-2 bg-teal-500/10 text-teal-400 rounded-xl border border-teal-500/20 hover:bg-teal-500/20 transition-all disabled:opacity-30 text-[8px] font-black uppercase flex items-center gap-1">
                              <Wallet size={11} /> Billetera
                            </button>
                          )}
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
                const puedeAprobar = req.estatus === 'PENDIENTE_REVISION' && ['CEO', 'ADMIN'].includes(rolUpper);   // ▼ v16.6 rol canónico
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
          if (METODOS.some(({ m }) => physBalances[m].trim() === '' || !Number.isFinite(Number(physBalances[m])) || Number(physBalances[m]) < 0)) {
            alert('Ingrese los cuatro conteos físicos válidos antes de comprobar el cuadre.'); return;
          }
          if (fetchErrors.length || alertasIntegridad.length) {
            alert('No se puede certificar: hay datos no disponibles o alertas de integridad.'); return;
          }
          const disc = METODOS.map(({ m, label }) => {
            const diff = round2(Math.abs(getVaultBalance(m) - round2(parseFloat(physBalances[m]) || 0)));
            return diff > 0.01 ? `${label}: ${prefijo(m)} ${diff.toFixed(2)} de diferencia` : null;
          }).filter(Boolean);
          if (disc.length) alert('⚠️ DISCREPANCIAS:\n\n' + disc.join('\n'));
          else { alert('✓ COMPROBACIÓN DE CUADRE COMPLETADA. Esto NO es un cierre contable firmado ni persistido.'); }
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
                <Lock className="h-4 w-4" /> Comprobar Cuadre Multi-Moneda
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══ TAB: BILLETERAS v17 ══════════════════════════════════════════════ */}
      {activeTab === 'BILLETERAS' && (() => {
        const q = walletQuery.trim().toUpperCase();
        const lista = alumnos
          .filter(a => !q || `${a.nombre} ${a.serial} ${a.sede}`.toUpperCase().includes(q))
          .map(a => ({ a, saldo: saldoWallet.get(a.student_id) ?? 0, deuda: deudaAlumnoUSD(a.student_id) }))
          .sort((x, y) => Number(y.saldo + y.deuda > 0) - Number(x.saldo + x.deuda > 0) || x.a.nombre.localeCompare(y.a.nombre));
        const sel      = alumnoSel;
        const movsSel  = sel ? walletMovs.filter(m => m.student_id === sel.student_id) : [];
        const consSel  = sel ? consumos.filter(c => c.student_id === sel.student_id) : [];
        const cxcSel   = sel ? cxcPendientes.filter(c => c.student_id === sel.student_id) : [];
        const saldoSel = sel ? saldoWallet.get(sel.student_id) ?? 0 : 0;
        const deudaSel = sel ? deudaAlumnoUSD(sel.student_id) : 0;
        const conDeuda = alumnos.filter(a => deudaAlumnoUSD(a.student_id) > 0).length;
        const subTabs: { k: WalletSubTab; l: string; n?: number; icon: LucideIcon }[] = [
          { k: 'ALUMNOS', l: 'Alumnos', icon: Users }, { k: 'VUELOS', l: 'Vuelos por cargar', n: vuelosPorCargar.length, icon: PlaneTakeoff },
          { k: 'TARIFARIO', l: 'Tarifario y ajustes', icon: Settings },
        ];
        const accion = 'px-4 py-3 rounded-xl text-[9px] font-black uppercase border transition-all flex items-center gap-2 disabled:opacity-30';
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {([
                ['Billeteras · anticipos', usd(totalBilleteras), `${walletCuentas.filter(w => w.saldo_usd > 0).length} alumnos con saldo`, 'text-teal-400', Wallet],
                ['Deuda por consumos', usd(totalDeudaConsumos), `${conDeuda} alumnos con deuda (todas las CxC)`, 'text-yellow-400', ArrowUpCircle],
                ['Consumos del mes', usd(consumosMes), 'Ingreso devengado (vuelo, simulador, cursos)', 'text-emerald-400', Receipt],
                ['Vuelos por cargar', String(vuelosPorCargar.length), `Desde ${fmtDate(walletCorte)} · bitácora MRO`, vuelosPorCargar.length ? 'text-orange-400' : 'text-zinc-500', PlaneTakeoff],
              ] as [string, string, string, string, LucideIcon][]).map(([l, v, s, c, Icon]) => (
                <div key={l} className={`${glass} rounded-2xl p-4 flex items-center justify-between`}>
                  <div>
                    <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">{l}</p>
                    <p className={`${c} font-black text-lg italic`}>{v}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{s}</p>
                  </div>
                  <Icon className={`${c} opacity-20 h-9 w-9`} />
                </div>
              ))}
            </div>

            {!v17Instalado && <EmptyState icon={Wallet} text="Ejecute migracion_finance_v17_billetera_clases.sql para habilitar las billeteras" />}
            <ErrorBanner msg={walletModal ? null : walletError} onClose={() => setWalletError(null)} />
            {walletInfo && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-emerald-300 flex-1 font-mono">{walletInfo}</p>
                <button type="button" onClick={() => setWalletInfo(null)} className="text-emerald-700 hover:text-emerald-400"><X size={12} /></button>
              </div>
            )}

            <div className="flex flex-wrap gap-1 p-1.5 bg-black/60 rounded-2xl border border-white/5 w-fit">
              {subTabs.map(({ k, l, n, icon: Icon }) => (
                <button key={k} type="button" onClick={() => setWalletSubTab(k)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${walletSubTab === k ? 'bg-teal-500 text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>
                  <Icon size={12} /> {l}{n ? <span className={`px-1.5 rounded ${walletSubTab === k ? 'bg-black/20' : 'bg-orange-500/20 text-orange-400'}`}>{n}</span> : null}
                </button>
              ))}
            </div>

            {walletSubTab === 'ALUMNOS' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
                  <div className="p-4 border-b border-white/5 relative">
                    <Search size={12} className="absolute left-7 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input value={walletQuery} onChange={e => setWalletQuery(e.target.value)} placeholder="BUSCAR ALUMNO · SERIAL · SEDE" className={`${inp} pl-9 py-3`} />
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[680px] p-3 space-y-1.5">
                    {lista.map(({ a, saldo, deuda }) => (
                      <button key={a.student_id} type="button" onClick={() => { setWalletSel(a.student_id); setWalletError(null); }}
                        className={`w-full text-left p-3 rounded-xl border transition-all ${walletSel === a.student_id ? 'border-teal-500/50 bg-teal-500/10' : 'border-white/[0.05] hover:bg-white/[0.03]'}`}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase truncate">{a.nombre}</p>
                            <p className="text-[8px] text-zinc-600 font-mono">{a.serial} · {a.sede}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-[11px] font-black italic ${saldo > 0 ? 'text-teal-400' : 'text-zinc-700'}`}>{usd(saldo)}</p>
                            {deuda > 0 && <p className="text-[8px] font-black text-yellow-400">debe {usd(deuda)}</p>}
                          </div>
                        </div>
                      </button>
                    ))}
                    {lista.length === 0 && <EmptyState icon={Users} text="Sin alumnos" />}
                  </div>
                </div>

                <div className="lg:col-span-8 space-y-5">
                  {!sel ? (
                    <div className={`${glass} rounded-3xl`}><EmptyState icon={Wallet} text="Seleccione un alumno para ver su billetera" py="py-24" /></div>
                  ) : (<>
                    <div className={`${glass} rounded-3xl p-6 border-t-2 border-t-teal-500`}>
                      <div className="flex flex-wrap justify-between items-start gap-4 mb-5">
                        <div>
                          <p className="text-[8px] text-zinc-600 font-black uppercase tracking-[0.3em]">Billetera del alumno · USD</p>
                          <h3 className="text-xl font-black uppercase italic">{sel.nombre}</h3>
                          <p className="text-[9px] text-zinc-500 font-mono">{sel.serial} · Sede {sel.sede}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          {([['Saldo', saldoSel, 'text-teal-400'], ['Deuda', deudaSel, deudaSel > 0 ? 'text-yellow-400' : 'text-zinc-600'],
                             ['Posición', round2(saldoSel - deudaSel), saldoSel - deudaSel >= 0 ? 'text-emerald-400' : 'text-red-400']] as const).map(([l, v, c]) => (
                            <div key={l} className="bg-black/30 rounded-xl px-4 py-3 border border-white/5">
                              <p className="text-[7px] text-zinc-600 font-black uppercase">{l}</p>
                              <p className={`text-base font-black italic ${c}`}>{usd(v)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!v17Instalado || !canManageFinance} onClick={() => abrirWalletModal('RECARGA', sel.student_id)}
                          className={`${accion} bg-emerald-500 text-black border-emerald-500 hover:bg-emerald-400`}><Wallet size={12} /> Recargar (pago)</button>
                        <button type="button" disabled={!v17Instalado} onClick={() => abrirWalletModal('CONSUMO', sel.student_id)}
                          className={`${accion} bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/30 hover:bg-[#E1AD01]/20`}><Receipt size={12} /> Registrar consumo</button>
                        <button type="button" disabled={!v17Instalado || saldoSel <= 0 || deudaSel <= 0 || savingAction === sel.student_id} onClick={() => aplicarBilleteraADeuda(sel.student_id)}
                          className={`${accion} bg-teal-500/10 text-teal-400 border-teal-500/30 hover:bg-teal-500/20`}>{savingAction === sel.student_id ? <Loader2 size={12} className="animate-spin" /> : <Repeat size={12} />} Aplicar saldo a deuda</button>
                        <button type="button" disabled={!v17Instalado || !canManageFinance} onClick={() => abrirWalletModal('AJUSTE', sel.student_id)}
                          className={`${accion} bg-violet-500/10 text-violet-400 border-violet-500/30 hover:bg-violet-500/20`}><Scale size={12} /> Ajuste</button>
                        <button type="button" disabled={!v17Instalado || !canManageFinance || saldoSel <= 0} onClick={() => abrirWalletModal('REEMBOLSO', sel.student_id)}
                          className={`${accion} bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20`}><MinusCircle size={12} /> Reembolso</button>
                        <button type="button" onClick={() => imprimirEstadoCuenta(sel.student_id)}
                          className={`${accion} bg-white/5 text-white border-white/10 hover:bg-white/10 ml-auto`}><Printer size={12} /> Estado de cuenta</button>
                      </div>
                    </div>

                    <div className={`${glass} rounded-3xl overflow-hidden`}>
                      <p className="p-5 border-b border-white/5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Receipt size={13} className="text-[#E1AD01]" /> Consumos · {consSel.length}</p>
                      <div className="max-h-[320px] overflow-y-auto p-4 space-y-2">
                        {consSel.map(c => (
                          <div key={c.id} className={`p-4 rounded-2xl border group flex justify-between items-center gap-3 ${c.estado === 'ANULADO' ? 'border-red-500/10 opacity-40' : 'border-white/[0.05] bg-white/[0.02]'}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-black uppercase truncate flex items-center gap-2">
                                {c.vuelo_id && <PlaneTakeoff size={10} className="text-[#E1AD01] shrink-0" />}{c.descripcion}
                                {c.modo !== 'BILLETERA' && <Badge tone={TONE.blue}>{MODO_CONSUMO_LABEL[c.modo]}</Badge>}
                                {c.estado === 'ANULADO' && <Badge tone={TONE.red}>Anulado</Badge>}
                              </p>
                              <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(c.fecha)} · {c.cantidad} {c.unidad} × {usd(c.precio_unitario_usd)} · {labelServicio(c.clase_servicio)}{c.clase_aeronave ? ` · ${c.clase_aeronave}` : ''}{c.clase_piloto ? ` · ${c.clase_piloto}` : ''}</p>
                              {c.monto_cxc_usd > 0 && <p className="text-[8px] text-yellow-400 font-mono">Billetera {usd(c.monto_billetera_usd)} · a crédito {usd(c.monto_cxc_usd)}</p>}
                              {c.motivo_anulacion && <p className="text-[8px] text-red-400/70 font-mono">Motivo: {c.motivo_anulacion}</p>}
                            </div>
                            <span className="text-sm font-black italic text-[#E1AD01]">{usd(c.monto_total_usd)}</span>
                            {c.estado === 'VIGENTE' && canManageFinance && (
                              <button type="button" onClick={() => pedirAnularConsumo(c)} disabled={savingAction === c.id} title="Anular consumo" className={`${btnIcon} hover:text-red-500 hover:bg-red-500/10`}>
                                {savingAction === c.id ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                              </button>
                            )}
                          </div>
                        ))}
                        {consSel.length === 0 && <EmptyState text="Sin consumos" py="py-8" />}
                      </div>
                    </div>

                    <div className={`${glass} rounded-3xl overflow-hidden`}>
                      <p className="p-5 border-b border-white/5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Layers size={13} className="text-teal-400" /> Movimientos de billetera · {movsSel.length}</p>
                      <div className="max-h-[360px] overflow-y-auto p-4 space-y-2">
                        {movsSel.map(m => (
                          <div key={m.id} className={`p-3.5 rounded-2xl border group flex justify-between items-center gap-3 ${m.revertido ? 'border-white/[0.03] opacity-40' : m.tipo === 'REVERSO' ? 'border-red-500/15' : 'border-white/[0.05] bg-white/[0.02]'}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-black uppercase truncate flex items-center gap-2">
                                <Badge tone={m.signo > 0 ? TONE.emerald : TONE.orange}>{WALLET_MOV_LABEL[m.tipo]}</Badge>
                                {m.revertido && <Badge tone={TONE.red}>Revertido</Badge>}
                                <span className="truncate">{m.concepto}</span>
                              </p>
                              <p className="text-[8px] text-zinc-600 font-mono mt-0.5">
                                {fmtDate(m.fecha)} · {m.referencia}
                                {m.moneda_origen && m.monto_origen ? ` · ${fmtMonto(m.monto_origen, normalizePaymentMethod(m.moneda_origen))}${m.tasa ? ` @ ${m.tasa}` : ''}` : ''}
                                {m.creado_por_email ? ` · ${m.creado_por_email}` : ''}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-black italic ${m.signo > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m.signo > 0 ? '+' : '−'}{usd(m.monto_usd)}</p>
                              <p className="text-[8px] text-zinc-600 font-mono">saldo {usd(m.saldo_resultante)}</p>
                            </div>
                            {!m.revertido && m.tipo !== 'REVERSO' && canManageFinance && (
                              <button type="button" onClick={() => pedirRevertir(m)} disabled={savingAction === m.id} title={m.tipo === 'CONSUMO' ? 'Anular consumo' : 'Revertir (contra-asiento)'} className={`${btnIcon} hover:text-red-500 hover:bg-red-500/10`}>
                                {savingAction === m.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                              </button>
                            )}
                          </div>
                        ))}
                        {movsSel.length === 0 && <EmptyState text="Billetera sin movimientos" py="py-8" />}
                      </div>
                    </div>

                    {cxcSel.length > 0 && (
                      <div className={`${glass} rounded-3xl overflow-hidden`}>
                        <p className="p-5 border-b border-white/5 text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><ArrowUpCircle size={13} className="text-yellow-400" /> Cuentas por cobrar pendientes · {usd(deudaSel)}</p>
                        <div className="p-4 space-y-2">
                          {cxcSel.map(c => {
                            const mon = normalizePaymentMethod(c.moneda);
                            const aplicable = c.horas_prometidas === 0 && mon !== 'BS';
                            return (
                              <div key={c.id} className="p-3.5 rounded-2xl border border-yellow-500/10 flex justify-between items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-black uppercase truncate">{c.concepto}</p>
                                  <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(c.fecha_emision)} · {c.estatus}{consumoPorCxc.has(String(c.id)) ? ' · consumo sin fondos' : c.horas_prometidas > 0 ? ` · paquete ${c.horas_prometidas}h (cobrar en CxC)` : ''}</p>
                                </div>
                                <span className="text-sm font-black italic text-yellow-400">{fmtMonto(c.monto_pendiente, mon)}</span>
                                {aplicable && saldoSel > 0 && (
                                  <button type="button" onClick={() => aplicarBilleteraADeuda(sel.student_id, String(c.id))} disabled={savingAction === String(c.id)}
                                    className="px-3 py-2 bg-teal-500/10 text-teal-400 rounded-xl border border-teal-500/20 text-[8px] font-black uppercase flex items-center gap-1 disabled:opacity-30">
                                    <Wallet size={10} /> Aplicar
                                  </button>
                                )}
                                <button type="button" onClick={() => { setActiveTab('CUENTAS'); }} className="px-3 py-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 text-[8px] font-black uppercase">Cobrar en CxC</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>)}
                </div>
              </div>
            )}

            {walletSubTab === 'VUELOS' && (
              <div className={`${glass} rounded-3xl overflow-hidden`}>
                <div className="p-5 border-b border-white/5 flex flex-wrap gap-3 justify-between items-center">
                  <div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><PlaneTakeoff size={14} className="text-[#E1AD01]" /> Vuelos por cargar · desde {fmtDate(walletCorte)}</h3>
                    <p className="text-[8px] text-zinc-600 font-mono mt-1">Fuente: bitácora MRO (horas TAC). Cada vuelo se cobra una sola vez; lo que el saldo no cubra pasa a cuentas por cobrar.</p>
                  </div>
                  <button type="button" onClick={cargarTodosVuelos} disabled={!vuelosPorCargar.length || vueloCargando !== null}
                    className="bg-[#E1AD01] text-black px-5 py-3 rounded-xl text-[9px] font-black uppercase flex items-center gap-2 disabled:opacity-30">
                    {vueloCargando === 'ALL' ? <Loader2 size={12} className="animate-spin" /> : <PlaneTakeoff size={12} />} Cargar todos con tarifa
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="text-zinc-600 text-[8px] uppercase tracking-widest">
                        {['Fecha', 'Alumno', 'Aeronave', 'Misión', 'Horas', 'Tarifa', 'Monto', 'Saldo alumno', ''].map((h, i) => <th key={i} className={`p-3 font-black ${i >= 4 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {vuelosPorCargar.map(v => {
                        const t = tarifaVuelo(v.matricula);
                        const monto = t ? round2(v.horas * t.precio_usd) : null;
                        const saldo = saldoWallet.get(v.student_id ?? '') ?? 0;
                        const busy = vueloCargando === v.id || vueloCargando === 'ALL';
                        return (
                          <tr key={v.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                            <td className="p-3">{fmtDate(v.fecha)}</td>
                            <td className="p-3 uppercase truncate max-w-[180px]">{alumnoPorId(v.student_id)?.nombre ?? '—'}</td>
                            <td className="p-3 text-[#E1AD01] font-black">{v.matricula ?? '—'}</td>
                            <td className="p-3 uppercase text-zinc-500">{[v.tipo_mision, v.destino].filter(Boolean).join(' · ') || '—'}</td>
                            <td className="p-3 text-right font-black">{v.horas.toFixed(1)}</td>
                            <td className="p-3 text-right">{t ? usd(t.precio_usd) : <span className="text-red-400">SIN TARIFA</span>}</td>
                            <td className="p-3 text-right font-black text-white">{monto !== null ? usd(monto) : '—'}</td>
                            <td className={`p-3 text-right ${monto !== null && saldo < monto ? 'text-yellow-400' : 'text-teal-400'}`}>{usd(saldo)}</td>
                            <td className="p-3">
                              <div className="flex gap-1 justify-end">
                                <button type="button" disabled={busy || !t} onClick={() => cargarVuelo(v, 'BILLETERA')} className="px-3 py-1.5 rounded-lg bg-[#E1AD01]/15 text-[#E1AD01] border border-[#E1AD01]/30 text-[8px] font-black uppercase disabled:opacity-30">
                                  {vueloCargando === v.id ? <Loader2 size={10} className="animate-spin" /> : 'Cargar'}
                                </button>
                                <button type="button" disabled={busy} onClick={() => cargarVuelo(v, 'PAQUETE_LEGACY')} title="El alumno ya había pagado estas horas en el régimen anterior" className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[8px] font-black uppercase disabled:opacity-30">Paquete</button>
                                <button type="button" disabled={busy} onClick={() => cargarVuelo(v, 'CORTESIA')} title="Sin cargo (vuelo de cortesía / reposición)" className="px-3 py-1.5 rounded-lg bg-white/5 text-zinc-400 border border-white/10 text-[8px] font-black uppercase disabled:opacity-30">Cortesía</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {vuelosPorCargar.length === 0 && <EmptyState icon={CheckCircle2} text="Todos los vuelos desde la fecha de corte están cargados" py="py-16" />}
                </div>
              </div>
            )}

            {walletSubTab === 'TARIFARIO' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-6 space-y-4 h-fit`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Settings size={14} className="text-teal-400" /> Política de billetera</h3>
                  <div>
                    <Lbl>Fecha de inicio del régimen billetera</Lbl>
                    <input type="date" value={configForm.corte} onChange={e => setConfigForm(p => ({ ...p, corte: e.target.value }))} className={inp} style={noUpper} />
                    <p className="text-[8px] text-zinc-600 font-mono mt-1">Vuelos anteriores no aparecen en "Vuelos por cargar" (se rigen por los paquetes de horas).</p>
                  </div>
                  <div>
                    <Lbl>Límite de crédito por alumno (USD)</Lbl>
                    <input type="number" min="0" step="1" value={configForm.credito} onChange={e => setConfigForm(p => ({ ...p, credito: e.target.value }))} placeholder="VACÍO = SIN LÍMITE" className={inp} />
                    <p className="text-[8px] text-zinc-600 font-mono mt-1">Si la deuda supera el límite, el consumo exige autorización explícita. Actual: {creditoMax === null ? 'sin límite' : usd(creditoMax)}.</p>
                  </div>
                  <button type="button" onClick={guardarConfig} disabled={savingWallet || !canManageFinance || !v17Instalado} className="w-full py-3.5 bg-teal-500 text-black rounded-xl text-[10px] font-black uppercase disabled:opacity-30 flex items-center justify-center gap-2">
                    {savingWallet ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Guardar política
                  </button>
                </div>
                <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden`}>
                  <div className="p-5 border-b border-white/5 flex justify-between items-center">
                    <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2"><Receipt size={14} className="text-[#E1AD01]" /> Tarifario · {servicios.length} servicios</h3>
                    <button type="button" onClick={() => abrirServicio()} disabled={!canManageFinance || !v17Instalado} className="bg-[#E1AD01] text-black px-4 py-2.5 rounded-xl text-[9px] font-black uppercase flex items-center gap-2 disabled:opacity-30"><PlusCircle size={12} /> Nuevo servicio</button>
                  </div>
                  <div className="p-4 space-y-2 max-h-[620px] overflow-y-auto">
                    {servicios.map(s => (
                      <div key={s.id} className={`p-4 rounded-2xl border flex justify-between items-center gap-3 ${s.activo ? 'border-white/[0.06] bg-white/[0.02]' : 'border-white/[0.03] opacity-50'}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-black uppercase truncate flex items-center gap-2">
                            {s.nombre}{!s.activo && <Badge tone={TONE.red}>Inactivo</Badge>}{s.precio_usd === 0 && <Badge tone={TONE.orange}>Sin precio</Badge>}
                          </p>
                          <p className="text-[8px] text-zinc-600 font-mono">{s.codigo} · {s.tipo} · {labelServicio(s.clase_servicio)}{s.aeronave_matricula ? ` · ${s.aeronave_matricula}` : ' · todas las aeronaves'}{s.sede ? ` · ${s.sede}` : ''}</p>
                        </div>
                        <span className="text-base font-black italic text-[#E1AD01]">{usd(s.precio_usd)}<span className="text-[8px] text-zinc-600 not-italic"> /{s.unidad.toLowerCase()}</span></span>
                        <button type="button" onClick={() => abrirServicio(s)} disabled={!canManageFinance} className="text-zinc-600 hover:text-[#E1AD01] p-2 disabled:opacity-30"><Pencil size={13} /></button>
                      </div>
                    ))}
                    {servicios.length === 0 && <EmptyState icon={Receipt} text="Tarifario vacío" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ══ TAB: REPORTES v17 ════════════════════════════════════════════════ */}
      {activeTab === 'REPORTES' && (
        <ReportesFinancieros
          transactions={transactions} clasifMap={clasifMap} consumos={consumos} walletMovs={walletMovs}
          walletCuentas={walletCuentas} cuentasCxC={cuentasCxC} cuentas={cuentas} abonos={abonos} provisionales={provisionales}
          provisionalAplicado={provisionalAplicado} flota={flota} alumnos={alumnos} cajas={cajas} movCajas={movCajas}
          tasaBCV={tasaBCV} inventory={inventory} v17={v17Instalado} canEdit={canManageFinance}
          onReclasificar={abrirReclas} onImprimirCaja={imprimirMovimientosCaja} onImprimirAlumno={imprimirEstadoCuenta} />
      )}

      {/* ══ MODALES ══════════════════════════════════════════════════════════ */}

      {/* [NEW v17] RECARGA DE BILLETERA */}
      {walletModal === 'RECARGA' && alumnoSel && (() => {
        const f = recargaForm;
        const monto = parseFloat(f.monto);
        const tasa  = parseFloat(f.tasa);
        const montoUsd = Number.isFinite(monto) && monto > 0 ? (f.moneda === 'BS' ? (tasa > 0 ? round2(monto / tasa) : NaN) : round2(monto)) : NaN;
        const saldo = saldoWallet.get(alumnoSel.student_id) ?? 0;
        const deudaAplicable = round2(cxcPendientes.filter(c => c.student_id === alumnoSel.student_id && c.horas_prometidas === 0 && normalizePaymentMethod(c.moneda) !== 'BS')
          .reduce((a, c) => a + c.monto_pendiente, 0));
        const aplicaria = f.aplicar_deudas && Number.isFinite(montoUsd) ? round2(Math.min(saldo + montoUsd, deudaAplicable)) : 0;
        const cajaSel = cajaById(f.caja_id);
        return (
          <ModalShell accent="border-t-emerald-500" maxW="max-w-2xl">
            <ModalHeader icon={Wallet} tone={TONE.emerald} title="Recargar billetera"
              subtitle={`${alumnoSel.nombre} · saldo ${usd(saldo)}${deudaAplicable > 0 ? ` · deuda aplicable ${usd(deudaAplicable)}` : ''}`} onClose={cerrarWalletModal} />
            <form onSubmit={handleRecarga} className="space-y-4">
              <div><Lbl>Moneda / medio de pago</Lbl>
                <MonedaPicker value={f.moneda} onChange={m => setRecargaForm(p => ({ ...p, moneda: m, caja_id: ajustarCaja(p.caja_id, m) }))} />
              </div>
              <div className={`grid ${f.moneda === 'BS' ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                <AmountInput size="lg" value={f.monto} moneda={f.moneda} disabled={savingWallet} onChange={v => setRecargaForm(p => ({ ...p, monto: v }))} />
                {f.moneda === 'BS' && (
                  <input type="number" step="0.0001" min="0.0001" required value={f.tasa} onChange={e => setRecargaForm(p => ({ ...p, tasa: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 py-6 px-4 rounded-2xl text-xl font-black italic outline-none focus:border-[#E1AD01] text-white" placeholder="Tasa Bs/USD" />
                )}
              </div>
              <div>
                <Lbl>Caja que recibe el dinero *</Lbl>
                <select value={f.caja_id} onChange={e => setRecargaForm(p => ({ ...p, caja_id: e.target.value }))} className={inp}>
                  <option value="">— SELECCIONE CAJA —</option>
                  {cajas.map(c => { const ok = cajaAceptaMoneda(c, f.moneda); return <option key={c.id} value={c.id} disabled={!ok}>{c.nombre}{ok ? '' : ` · NO ACEPTA ${f.moneda}`}</option>; })}
                </select>
              </div>
              {cajaEsEfectivo(f.caja_id) && <SubcajaToggle value={f.subcaja} onChange={sc => setRecargaForm(p => ({ ...p, subcaja: sc }))} />}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input type="date" required value={f.fecha} onChange={e => setRecargaForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
                <input value={f.concepto} onChange={e => setRecargaForm(p => ({ ...p, concepto: e.target.value }))} placeholder="CONCEPTO (ej. PAGO PAQUETE PPL)" className={inp} />
              </div>
              <PagadorFields value={recargaPago} onChange={setRecargaPago} moneda={f.moneda} alumnos={alumnos} />
              {deudaAplicable > 0 && (
                <label className="flex items-center gap-3 p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 cursor-pointer">
                  <input type="checkbox" checked={f.aplicar_deudas} onChange={e => setRecargaForm(p => ({ ...p, aplicar_deudas: e.target.checked }))} />
                  <span className="text-[9px] text-yellow-300 font-black uppercase">Saldar primero sus deudas ({usd(deudaAplicable)} en CxC sin horas, las más antiguas primero)</span>
                </label>
              )}
              {Number.isFinite(montoUsd) && (
                <div className="bg-black/30 border border-white/10 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] font-mono">
                  <p className="text-emerald-400">+ {fmtMonto(monto, f.moneda)} · Bóveda {f.moneda}</p>
                  <p className={cajaSel ? 'text-emerald-400' : 'text-red-400'}>{cajaSel ? `+ ${fmtMonto(monto, f.moneda)} · Caja ${cajaSel.nombre}` : 'Falta la caja'}</p>
                  <p className="text-teal-400">+ {usd(montoUsd)} · Billetera {alumnoSel.nombre}{f.moneda === 'BS' ? ` (@ ${f.tasa})` : ''}</p>
                  {aplicaria > 0 && <p className="text-yellow-400">− {usd(aplicaria)} · aplicado a deudas</p>}
                  <p className="text-zinc-500 md:col-span-2">Anticipo (pasivo): se vuelve ingreso cuando el alumno consume vuelo, simulador o cursos.</p>
                </div>
              )}
              <ErrorBanner msg={walletError} onClose={() => setWalletError(null)} />
              <ModalActions onCancel={cerrarWalletModal} busy={savingWallet} submitCls="bg-emerald-500 text-black hover:bg-emerald-400" label={<><Wallet size={14} /> Registrar recarga</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* [NEW v17] CONSUMO */}
      {walletModal === 'CONSUMO' && alumnoSel && (() => {
        const f = consumoForm;
        const cant   = parseFloat(f.cantidad);
        const precio = f.modo === 'BILLETERA' ? parseFloat(f.precio) : 0;
        const total  = Number.isFinite(cant) && Number.isFinite(precio) ? round2(cant * precio) : NaN;
        const saldo  = saldoWallet.get(alumnoSel.student_id) ?? 0;
        const desdeW = Number.isFinite(total) ? round2(Math.min(Math.max(saldo, 0), total)) : 0;
        const aCxc   = Number.isFinite(total) ? round2(total - desdeW) : 0;
        const deuda  = deudaAlumnoUSD(alumnoSel.student_id);
        const excede = creditoMax !== null && aCxc > 0 && deuda + aCxc > creditoMax;
        const unidad = servicios.find(s => s.id === f.servicio_id)?.unidad ?? TIPOS_CONSUMO.find(t => t.k === f.tipo)?.unidad ?? 'UNIDAD';
        return (
          <ModalShell accent="border-t-[#E1AD01]" maxW="max-w-2xl">
            <ModalHeader icon={Receipt} tone={TONE.asiento} title="Registrar consumo" subtitle={`${alumnoSel.nombre} · saldo ${usd(saldo)}${deuda > 0 ? ` · deuda ${usd(deuda)}` : ''}`} onClose={cerrarWalletModal} />
            <form onSubmit={handleConsumo} className="space-y-4">
              <div><Lbl>Servicio del tarifario</Lbl>
                <select value={f.servicio_id} onChange={e => elegirServicioConsumo(e.target.value)} className={inp}>
                  <option value="">— CARGO LIBRE (sin tarifario) —</option>
                  {servicios.filter(s => s.activo).map(s => <option key={s.id} value={s.id}>{s.nombre} · {usd(s.precio_usd)}/{s.unidad.toLowerCase()}{s.aeronave_matricula ? ` · ${s.aeronave_matricula}` : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
                {TIPOS_CONSUMO.map(t => (
                  <button key={t.k} type="button" onClick={() => { setConsumoForm(p => ({ ...p, tipo: t.k })); setConsumoClase(c => ({ ...c, servicio: c.servicio || SERVICIO_POR_TIPO[t.k] })); }}
                    className={`py-2.5 rounded-xl text-[8px] font-black uppercase border transition-all ${f.tipo === t.k ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : optOff}`}>{t.l}</button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Lbl>Cantidad ({unidad.toLowerCase()})</Lbl><input type="number" step="0.1" min="0.1" required value={f.cantidad} onChange={e => setConsumoForm(p => ({ ...p, cantidad: e.target.value }))} className={inp} /></div>
                <div><Lbl>Precio unitario USD</Lbl><input type="number" step="0.01" min="0" required={f.modo === 'BILLETERA'} disabled={f.modo !== 'BILLETERA'} value={f.modo === 'BILLETERA' ? f.precio : '0'} onChange={e => setConsumoForm(p => ({ ...p, precio: e.target.value }))} className={inp} /></div>
                <div><Lbl>Fecha</Lbl><input type="date" required value={f.fecha} onChange={e => setConsumoForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} /></div>
              </div>
              <input value={f.descripcion} onChange={e => setConsumoForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="DESCRIPCIÓN (ej. SIMULADOR FNPT II · 2 SESIONES)" className={inp} />
              <div>
                <Lbl>Modalidad</Lbl>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['BILLETERA', 'PAQUETE_LEGACY', 'CORTESIA'] as ModoConsumo[]).map(m => (
                    <button key={m} type="button" onClick={() => setConsumoForm(p => ({ ...p, modo: m }))}
                      className={`py-2.5 rounded-xl text-[8px] font-black uppercase border transition-all ${f.modo === m ? 'bg-teal-500/15 text-teal-400 border-teal-500/30' : optOff}`}>{MODO_CONSUMO_LABEL[m]}</button>
                  ))}
                </div>
              </div>
              <ClaseFields value={consumoClase} onChange={setConsumoClase} flota={flota} pilotos={pilotosLista} naturaleza="INGRESO" titulo="Clase del ingreso (aeronave · instructor · sede)" />
              {Number.isFinite(total) && (
                <div className="bg-black/30 border border-white/10 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
                  {([['Total', total, 'text-white'], ['De la billetera', desdeW, 'text-teal-400'], ['A cuentas por cobrar', aCxc, aCxc > 0 ? 'text-yellow-400' : 'text-zinc-600']] as const).map(([l, v, c]) => (
                    <div key={l}><p className="text-[7px] text-zinc-600 font-black uppercase">{l}</p><p className={`text-base font-black italic ${c}`}>{usd(v)}</p></div>
                  ))}
                </div>
              )}
              {aCxc > 0 && <p className="text-[9px] text-yellow-300 font-mono">El saldo no alcanza: {usd(aCxc)} se registran como deuda del alumno (CxC) y se cobran luego o con su próxima recarga.</p>}
              {excede && (
                <label className="flex items-center gap-3 p-3 rounded-xl border border-red-500/30 bg-red-500/5 cursor-pointer">
                  <input type="checkbox" checked={f.autorizar} onChange={e => setConsumoForm(p => ({ ...p, autorizar: e.target.checked }))} />
                  <span className="text-[9px] text-red-300 font-black uppercase">Supera el límite de crédito ({usd(creditoMax ?? 0)}): autorizo el consumo</span>
                </label>
              )}
              <ErrorBanner msg={walletError} onClose={() => setWalletError(null)} />
              <ModalActions onCancel={cerrarWalletModal} busy={savingWallet} disabled={excede && !f.autorizar}
                submitCls="bg-[#E1AD01] text-black hover:bg-white" label={<><Receipt size={14} /> Registrar consumo</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* [NEW v17] AJUSTE */}
      {walletModal === 'AJUSTE' && alumnoSel && (
        <ModalShell accent="border-t-violet-500">
          <ModalHeader icon={Scale} tone={TONE.fin} title="Ajuste de billetera" subtitle={`${alumnoSel.nombre} · saldo ${usd(saldoWallet.get(alumnoSel.student_id) ?? 0)}`} onClose={cerrarWalletModal} />
          <form onSubmit={handleAjuste} className="space-y-4">
            <div className="grid grid-cols-3 gap-1.5">
              {(['SALDO_INICIAL', 'AJUSTE_CREDITO', 'AJUSTE_DEBITO'] as AjusteTipo[]).map(t => (
                <button key={t} type="button" onClick={() => setAjusteForm(p => ({ ...p, tipo: t }))}
                  className={`py-2.5 rounded-xl text-[8px] font-black uppercase border transition-all ${ajusteForm.tipo === t ? 'bg-violet-500/15 text-violet-400 border-violet-500/30' : optOff}`}>{WALLET_MOV_LABEL[t]}</button>
              ))}
            </div>
            <p className="text-[8px] text-zinc-500 font-mono">
              {ajusteForm.tipo === 'SALDO_INICIAL' ? 'Migración de saldos previos (no afecta el P&L).'
                : ajusteForm.tipo === 'AJUSTE_CREDITO' ? 'Bonificación / descuento: aumenta el saldo y resta ingresos en el P&L.'
                : 'Cargo adicional sin servicio del tarifario: disminuye el saldo y suma ingresos.'} No mueve caja. Requiere clave de director.
            </p>
            <AmountInput size="lg" value={ajusteForm.monto} moneda="USDT" prefixCls="text-violet-400" onChange={v => setAjusteForm(p => ({ ...p, monto: v }))} />
            <textarea value={ajusteForm.motivo} onChange={e => setAjusteForm(p => ({ ...p, motivo: e.target.value }))} rows={2} placeholder="MOTIVO (obligatorio, queda en auditoría)"
              className="w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-violet-500/60 resize-none uppercase" />
            <ErrorBanner msg={walletError} onClose={() => setWalletError(null)} />
            <ModalActions onCancel={cerrarWalletModal} busy={savingWallet} submitCls="bg-violet-500 text-white hover:bg-violet-400" label={<><KeyRound size={13} /> Registrar ajuste</>} />
          </form>
        </ModalShell>
      )}

      {/* [NEW v17] REEMBOLSO */}
      {walletModal === 'REEMBOLSO' && alumnoSel && (() => {
        const f = reembolsoForm;
        const montoUsd = parseFloat(f.monto_usd);
        const tasa = parseFloat(f.tasa);
        const origen = Number.isFinite(montoUsd) && montoUsd > 0 ? (f.moneda === 'BS' ? round2(montoUsd * tasa) : round2(montoUsd)) : NaN;
        const cajaSel = cajaById(f.caja_id);
        return (
          <ModalShell accent="border-t-red-500" maxW="max-w-xl">
            <ModalHeader icon={MinusCircle} tone={TONE.red} title="Reembolso al alumno" subtitle={`${alumnoSel.nombre} · saldo ${usd(saldoWallet.get(alumnoSel.student_id) ?? 0)}`} onClose={cerrarWalletModal} />
            <form onSubmit={handleReembolso} className="space-y-4">
              <div><Lbl>Monto a devolver (USD de billetera)</Lbl><AmountInput size="lg" value={f.monto_usd} moneda="USDT" prefixCls="text-red-400" onChange={v => setReembolsoForm(p => ({ ...p, monto_usd: v }))} /></div>
              <div><Lbl>Se paga en</Lbl><MonedaPicker value={f.moneda} onChange={m => setReembolsoForm(p => ({ ...p, moneda: m, caja_id: ajustarCaja(p.caja_id, m) }))} /></div>
              {f.moneda === 'BS' && <div><Lbl>Tasa Bs/USD</Lbl><input type="number" step="0.0001" min="0.0001" value={f.tasa} onChange={e => setReembolsoForm(p => ({ ...p, tasa: e.target.value }))} className={inp} /></div>}
              <select value={f.caja_id} onChange={e => setReembolsoForm(p => ({ ...p, caja_id: e.target.value }))} className={inp}>
                <option value="">— CAJA DE DONDE SALE —</option>
                {cajas.map(c => { const ok = cajaAceptaMoneda(c, f.moneda); return <option key={c.id} value={c.id} disabled={!ok}>{c.nombre}{ok ? ` · ${fmtMonto(getCajaBalance(c.id, f.moneda), f.moneda)}` : ` · NO ACEPTA ${f.moneda}`}</option>; })}
              </select>
              {cajaEsEfectivo(f.caja_id) && <SubcajaToggle value={f.subcaja} onChange={sc => setReembolsoForm(p => ({ ...p, subcaja: sc }))} />}
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={f.fecha} onChange={e => setReembolsoForm(p => ({ ...p, fecha: e.target.value }))} className={inp} style={noUpper} />
                <input value={f.referencia} onChange={e => setReembolsoForm(p => ({ ...p, referencia: e.target.value }))} placeholder="REF. TRANSFERENCIA / RECIBO" className={inp} />
              </div>
              <input value={f.concepto} onChange={e => setReembolsoForm(p => ({ ...p, concepto: e.target.value }))} placeholder="MOTIVO DEL REEMBOLSO" className={inp} />
              {Number.isFinite(origen) && (
                <div className="bg-black/30 border border-white/10 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] font-mono">
                  <p className="text-red-400">− {fmtMonto(origen, f.moneda)} · Bóveda {f.moneda}</p>
                  <p className={cajaSel ? 'text-red-400' : 'text-zinc-600'}>{cajaSel ? `− ${fmtMonto(origen, f.moneda)} · Caja ${cajaSel.nombre}` : 'Falta la caja'}</p>
                  <p className="text-teal-400">− {usd(montoUsd)} · Billetera (cancela anticipo, no es gasto)</p>
                </div>
              )}
              <ErrorBanner msg={walletError} onClose={() => setWalletError(null)} />
              <ModalActions onCancel={cerrarWalletModal} busy={savingWallet} submitCls="bg-red-500 text-white hover:bg-red-400" label={<><KeyRound size={13} /> Registrar reembolso</>} />
            </form>
          </ModalShell>
        );
      })()}

      {/* [NEW v17] MOTIVO: revertir movimiento / anular consumo */}
      {motivoAccion && (
        <ModalShell accent="border-t-red-500" z="z-[96]">
          <ModalHeader icon={Undo2} tone={TONE.red} title={motivoAccion.titulo} subtitle="Contra-asiento auditado · requiere clave de director" onClose={() => setMotivoAccion(null)} />
          <p className="text-[10px] text-zinc-300 font-mono mb-4">{motivoAccion.detalle}</p>
          <textarea value={motivoTexto} onChange={e => setMotivoTexto(e.target.value)} rows={3} placeholder="MOTIVO (obligatorio, mínimo 5 caracteres)"
            className="w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-red-500/60 resize-none uppercase mb-4" />
          <ModalActions onCancel={() => setMotivoAccion(null)} onSubmit={confirmarMotivo} busy={false} disabled={motivoTexto.trim().length < 5}
            submitCls="bg-red-500 text-white hover:bg-red-400" label={<><Undo2 size={13} /> Continuar</>} />
        </ModalShell>
      )}

      {/* [NEW v17] SERVICIO DEL TARIFARIO */}
      {servicioEdit && (
        <ModalShell accent="border-t-[#E1AD01]" maxW="max-w-xl">
          <ModalHeader icon={Receipt} tone={TONE.asiento} title={servicioEdit.id ? 'Editar servicio' : 'Nuevo servicio'} subtitle="Tarifa en USD por unidad" onClose={() => setServicioEdit(null)} />
          <div className="grid grid-cols-2 gap-3">
            <input value={servicioEdit.codigo} onChange={e => setServicioEdit(p => p && ({ ...p, codigo: e.target.value }))} placeholder="CÓDIGO (ej. VUELO-YV1234)" className={inp} />
            <input value={servicioEdit.nombre} onChange={e => setServicioEdit(p => p && ({ ...p, nombre: e.target.value }))} placeholder="NOMBRE" className={inp} />
            <select value={servicioEdit.tipo} onChange={e => { const t = e.target.value as TipoConsumo; setServicioEdit(p => p && ({ ...p, tipo: t, unidad: TIPOS_CONSUMO.find(x => x.k === t)?.unidad ?? p.unidad, clase_servicio: SERVICIO_POR_TIPO[t] })); }} className={inp}>
              {TIPOS_CONSUMO.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
            </select>
            <select value={servicioEdit.unidad} onChange={e => setServicioEdit(p => p && ({ ...p, unidad: e.target.value }))} className={inp}>
              {['HORA', 'UNIDAD', 'SESION'].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <div className="col-span-2"><AmountInput value={servicioEdit.precio} moneda="USDT" onChange={v => setServicioEdit(p => p && ({ ...p, precio: v }))} /></div>
            <select value={servicioEdit.aeronave_matricula} onChange={e => setServicioEdit(p => p && ({ ...p, aeronave_matricula: e.target.value }))} className={inp}>
              <option value="">TODAS LAS AERONAVES</option>
              {flota.map(m => <option key={m} value={m}>{m}</option>)}
              {servicioEdit.aeronave_matricula && !flota.includes(servicioEdit.aeronave_matricula) && <option value={servicioEdit.aeronave_matricula}>{servicioEdit.aeronave_matricula}</option>}
            </select>
            <select value={servicioEdit.sede} onChange={e => setServicioEdit(p => p && ({ ...p, sede: e.target.value }))} className={inp}>
              <option value="">TODAS LAS SEDES</option>
              {SEDES_FIN.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
            </select>
            <select value={servicioEdit.clase_servicio} onChange={e => setServicioEdit(p => p && ({ ...p, clase_servicio: e.target.value }))} className={`${inp} col-span-2`}>
              {SERVICIOS_PL.filter(s => s.n === 'INGRESO').map(s => <option key={s.k} value={s.k}>{s.cod} · {s.l}</option>)}
            </select>
            <input value={servicioEdit.notas} onChange={e => setServicioEdit(p => p && ({ ...p, notas: e.target.value }))} placeholder="NOTAS" className={`${inp} col-span-2`} style={noUpper} />
            <label className="col-span-2 flex items-center gap-3 text-[9px] font-black uppercase text-zinc-400">
              <input type="checkbox" checked={servicioEdit.activo} onChange={e => setServicioEdit(p => p && ({ ...p, activo: e.target.checked }))} /> Activo (disponible para cobrar)
            </label>
          </div>
          <div className="my-4"><ErrorBanner msg={walletError} onClose={() => setWalletError(null)} /></div>
          <ModalActions onCancel={() => setServicioEdit(null)} onSubmit={guardarServicio} busy={savingWallet} submitCls="bg-[#E1AD01] text-black hover:bg-white" label={<><ShieldCheck size={13} /> Guardar</>} />
        </ModalShell>
      )}

      {/* [NEW v17] CLASE CONTABLE (reclasificación) */}
      {reclasAccion && (
        <ModalShell accent="border-t-teal-500" maxW="max-w-lg">
          <ModalHeader icon={Tag} tone={TONE.fx} title="Clase contable" subtitle={reclasAccion.titulo} onClose={() => setReclasAccion(null)} />
          <ClaseFields value={reclasForm} onChange={setReclasForm} flota={flota} pilotos={pilotosLista} />
          <p className="text-[8px] text-zinc-600 font-mono my-3">Solo cambia la clasificación para el P&amp;L por clase. No modifica montos, cajas ni asientos.</p>
          <ModalActions onCancel={() => setReclasAccion(null)} onSubmit={handleReclasificar} busy={savingWallet} submitCls="bg-teal-500 text-black hover:bg-teal-400" label={<><Tag size={13} /> Guardar clase</>} />
        </ModalShell>
      )}

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
                  {cajas.length === 0 && <option value="" disabled>SIN CAJAS VISIBLES · REVISE RLS</option>}
                  {cajas.map(c => {
                    const compatible = cajaAceptaMoneda(c, cobroForm.moneda);
                    const custodia = getCajaConfig(c).tipo === 'CUSTODIA_TERCERO' ? ' · custodia' : '';
                    return (
                      <option key={c.id} value={c.id} disabled={!compatible}>
                        {c.nombre}{custodia}{compatible ? ` · ${fmtMonto(getCajaBalance(c.id, cobroForm.moneda), cobroForm.moneda)}` : ` · NO ACEPTA ${cobroForm.moneda}`}
                      </option>
                    );
                  })}
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
            <ModalHeader icon={HandCoins} tone={TONE.fin} title="Préstamo Externo" subtitle="Barquisimeto / Roberto ↔ Águilas · financiamiento, no ingreso" onClose={() => setPrestamoModal(false)} />
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
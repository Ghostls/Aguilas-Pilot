// VALKYRON FINANCIAL INTELLIGENCE CENTER v15.0
// CHANGELOG v15.0 vs v14.0:
//   [NEW] FX interconectado Caja ↔ Bóveda (partida doble real):
//         → Caja ORIGEN (acepta moneda origen) + Caja DESTINO (acepta moneda destino)
//         → Ej: USDT (Bóveda USDT / caja X) → BS (Bóveda BS + Caja Bancamiga)
//         → 2 patas Ledger tipo FX_EXCHANGE con fx_leg OUT/IN (no infla ingresos/egresos)
//         → RPC atómico fn_registrar_fx (1 transacción Postgres) + fallback compensado
//   [NEW] signedLedgerAmount(): regla de signo ÚNICA para Bóvedas, KPIs, Libro Mayor y Cierre
//   [NEW] Anular FX (clave Director): borra fx_registros → cascada a cajas y bóvedas
//   [NEW] Conciliación Bóveda ↔ Σ Cajas por moneda (tab Bóvedas)
//   [NEW] Subcaja ADM/CEO en FX cuando la caja origen/destino es Efectivo
//   [FIX] v14 registraba el FX en UNA sola caja y en el Ledger como INCOME/EXPENSE
//         de la moneda origen → la Bóveda BS nunca recibía los bolívares y el USDT
//         se sumaba (INCOME) en vez de restarse. Corregido.
//   [FIX] Borrar/editar una pata FX aislada rompía la partida → ahora se anula el FX completo
//   [FIX] Tasa con 4 decimales (v14 truncaba a 2) · USD↔USD usa factor (1 = sin comisión)
//   [FIX] Al activar una caja mono-moneda (Bancamiga=BS, Efectivo=CASH) el form fija su moneda
//   [FIX] Edición de movimiento de caja valida la moneda permitida por la caja
//   PRESERVADO: fetchLockRef, fetchAll(silent), realtime debounce, transferencia entre cajas,
//   reposiciones, CxC/CxP, Libro Diario, Bóvedas, Cierre, Requisiciones, clave Director,
//   Caja Efectivo ADM/CEO, préstamos externos Becquer/Roberto.
//
// REQUISITO: ejecutar migracion_finance_v15.sql en Supabase antes de desplegar.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, X, Loader2,
  Wallet, ShieldCheck, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Activity, Trash2, Download, Coins, Banknote,
  AlertTriangle, RefreshCw, ReceiptText, Plane, Pencil, KeyRound,
  ArrowLeftRight, Repeat, TrendingUp, UserCheck, HandCoins, Scale, Ban,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type PaymentMethod   = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE' | 'FX_EXCHANGE';
export type TabType         = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING';
export type SubcajaEfectivo = 'ADM' | 'CEO';    // solo aplica a caja efectivo
export type Prestamista     = 'BECQUER' | 'ROBERTO';
export type FxLeg           = 'IN' | 'OUT';      // [NEW v15] pata FX en Ledger
type FormTipo               = 'CXC' | 'HORAS_PAGADAS' | 'CXP';

/** [NEW v15] Transacción de Ledger extendida con vínculo FX */
type LedgerTx = FinanceTransaction & {
  fx_id?: string | null;
  fx_leg?: FxLeg | null;
};

interface CajaChica      { id: string; nombre: string; }
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
  fx_role?: 'SALIDA' | 'ENTRADA' | null;    // [NEW v15]
}

/** Registro de operación FX (v15: origen/destino explícitos) */
interface FXRecord {
  id: string;
  fecha: string;
  moneda_origen: PaymentMethod;
  moneda_destino: PaymentMethod;
  monto_origen: number;
  monto_destino: number;
  tasa: number;
  concepto: string;
  registrado_por: string;
  caja_id?: string | null;                    // legacy v14
  caja_origen_id?: string | null;             // [NEW v15]
  caja_destino_id?: string | null;            // [NEW v15]
  subcaja_origen?: SubcajaEfectivo | null;    // [NEW v15]
  subcaja_destino?: SubcajaEfectivo | null;   // [NEW v15]
  referencia?: string | null;                 // [NEW v15]
}

/** [NEW v15] Payload normalizado de una operación FX */
interface FxPayload {
  fxId: string;
  referencia: string;
  fechaISO: string;
  monedaOrigen: PaymentMethod;
  monedaDestino: PaymentMethod;
  montoOrigen: number;
  montoDestino: number;
  tasa: number;
  concepto: string;
  cajaOrigenId: string | null;
  cajaDestinoId: string | null;
  cajaOrigenNombre: string;
  cajaDestinoNombre: string;
  subcajaOrigen: SubcajaEfectivo | null;
  subcajaDestino: SubcajaEfectivo | null;
}

interface CuentaGeneral {
  id: string; tipo: 'CXC' | 'CXP'; entidad_nombre: string; entidad_tipo: string;
  proveedor_id?: string; moneda: PaymentMethod;
  monto_total: number; monto_pendiente: number; concepto: string;
  fecha_emision: string; fecha_vencimiento?: string;
  estatus: 'PENDIENTE' | 'PAGADO' | 'PARCIAL'; notas?: string;
  transfer_id?: string | null;
  categoria_interna?: 'REPOSICION_CAJA' | null;
}
interface CuentaPorCobrar {
  id: string; student_id: string; alumno_id: string;
  nombre_alumno: string; student_serial: string;
  monto_total: number; monto_pagado: number; monto_pendiente: number;
  horas_prometidas: number; horas_compradas: number;
  concepto: string; fecha_emision: string; moneda: string;
  estatus: 'PENDIENTE' | 'COBRADO' | 'PARCIAL';
}
interface AlumnoCxC {
  student_id: string; nombre: string; serial: string; sede: string;
}
interface FinancePanelProps {
  vendors: Vendor[]; inventory: any[]; userRole?: string;
  setGlobalFinance?: React.Dispatch<React.SetStateAction<{CASH:number;ZELLE:number;USDT:number;BS:number}>>;
}
interface TransferChain {
  transferId: string;
  salida: MovimientoCaja | null;
  entrada: MovimientoCaja | null;
  reposicion: CuentaGeneral | null;
  cajaOrigenNombre: string;
  cajaDestinoNombre: string;
}

// ─── CONFIG ESTÁTICA DE CAJAS ─────────────────────────────────────────────────
// Restricciones de moneda por caja — aplicadas en UI y validación.
// "Bancamiga" solo opera en BS; "Efectivo" solo opera en CASH.

const CAJA_CONFIG: Record<string, {
  monedasPermitidas: PaymentMethod[];
  esCajaEfectivo: boolean;
  owner?: string;
  color: string;
}> = {
  'bancamiga': { monedasPermitidas: ['BS'],   esCajaEfectivo: false, owner: 'Bancamiga', color: 'orange' },
  'efectivo':  { monedasPermitidas: ['CASH'], esCajaEfectivo: true,  owner: 'CEO Office', color: 'yellow' },
};

/** Devuelve config por nombre de caja (lowercase match) */
const getCajaConfig = (nombre: string) => {
  const key = nombre.toLowerCase();
  for (const k of Object.keys(CAJA_CONFIG)) {
    if (key.includes(k)) return CAJA_CONFIG[k];
  }
  return { monedasPermitidas: ['USDT','ZELLE','CASH','BS'] as PaymentMethod[], esCajaEfectivo: false, color: 'zinc' };
};

// ─── ESTILOS ──────────────────────────────────────────────────────────────────

const glass = "bg-white/[0.02] backdrop-blur-[40px] border border-white/[0.07] shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inp   = "bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01]/60 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all w-full uppercase placeholder:text-white/20";

const DEFAULT_TASA_BS       = 36.50;
const DIRECTOR_FINANCE_CODE = '4827';
const ALL_METHODS: PaymentMethod[] = ['USDT','ZELLE','CASH','BS'];   // [NEW v15]

const normalizePaymentMethod = (value: unknown): PaymentMethod => {
  const v = String(value ?? '').toUpperCase().trim();
  return v === 'USD' ? 'USDT' : (['USDT','ZELLE','CASH','BS'].includes(v) ? v as PaymentMethod : 'USDT');
};

const MONEDA_COLOR: Record<PaymentMethod, string> = {
  USDT: 'text-emerald-400', ZELLE: 'text-blue-400',
  CASH: 'text-yellow-400',  BS:    'text-orange-400',
};
const MONEDA_BG: Record<PaymentMethod, string> = {
  USDT:  'bg-emerald-500/10 border-emerald-500/20',
  ZELLE: 'bg-blue-500/10 border-blue-500/20',
  CASH:  'bg-yellow-500/10 border-yellow-500/20',
  BS:    'bg-orange-500/10 border-orange-500/20',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const round2  = (n: number) => Math.round(n * 100) / 100;
const round4  = (n: number) => Math.round(n * 10000) / 10000;   // [NEW v15] tasas FX
const uuid4   = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
const genHash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
  return Math.abs(h).toString(16).padStart(8, '0').toUpperCase();
};
const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d instanceof Date ? d.toISOString() : d);
  return new Date(dt.getTime() + dt.getTimezoneOffset() * 60000)
    .toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtMonto = (amount: number, moneda: PaymentMethod) => {
  const s = round2(amount).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'BS' ? `Bs ${s}` : `$${s}`;
};
const hoyISO = () => new Date().toISOString().split('T')[0];   // [NEW v15]

/**
 * [NEW v15] Regla de signo ÚNICA del Ledger (fuente de verdad de Bóvedas).
 *  INCOME / RECEIVABLE            → +
 *  EXPENSE / PAYABLE / NÓMINA     → −
 *  FX_EXCHANGE con fx_leg IN      → +   (moneda destino entra)
 *  FX_EXCHANGE con fx_leg OUT     → −   (moneda origen sale)
 *  FX_EXCHANGE legacy sin pata    → −   (preserva el comportamiento histórico v14)
 */
const signedLedgerAmount = (t: LedgerTx): number => {
  const ty = String(t.type);
  if (ty === 'FX_EXCHANGE') {
    if (t.fx_leg === 'IN')  return t.amount;
    if (t.fx_leg === 'OUT') return -t.amount;
    return -t.amount;
  }
  if (ty === 'INCOME' || ty === 'RECEIVABLE') return t.amount;
  return -t.amount;
};

/** [NEW v15] ¿La transacción pertenece a una operación FX? (no cuenta como ingreso/egreso real) */
const isFxTx = (t: LedgerTx) => String(t.type) === 'FX_EXCHANGE' || !!t.fx_id;

/**
 * [NEW v15] Conversión FX.
 *  USD-like → BS : M_d = M_o · τ        (τ = Bs por 1 USD)
 *  BS → USD-like : M_d = M_o / τ
 *  USD ↔ USD     : M_d = M_o · f        (f = factor neto, 1 = sin comisión)
 */
const computeFxDestino = (origen: PaymentMethod, destino: PaymentMethod, montoOrigen: number, tasa: number): number | null => {
  if (origen === destino) return null;
  if (!Number.isFinite(montoOrigen) || !Number.isFinite(tasa) || montoOrigen <= 0 || tasa <= 0) return null;
  if (destino === 'BS' && origen !== 'BS') return round2(montoOrigen * tasa);
  if (origen === 'BS' && destino !== 'BS') return round2(montoOrigen / tasa);
  return round2(montoOrigen * tasa);
};

/** [NEW v15] Detecta que el RPC aún no existe (migración no ejecutada) */
const isMissingRpc = (err: { code?: string; message?: string } | null) =>
  !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message ?? ''));

// ─── ERROR BANNER ─────────────────────────────────────────────────────────────

const ErrorBanner: React.FC<{ msg: string | null; onClose: () => void }> = ({ msg, onClose }) => {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 animate-in slide-in-from-top-2 duration-300">
      <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
      <p className="text-[10px] text-red-400 flex-1 font-mono">{msg}</p>
      <button onClick={onClose} className="text-red-700 hover:text-red-400 transition-colors"><X size={12} /></button>
    </div>
  );
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export const FinancePanel: React.FC<FinancePanelProps> = ({
  vendors, inventory, userRole = 'CEO', setGlobalFinance = () => {},
}) => {
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

  const [loading,       setLoading]       = useState(true);
  const [selectedVault, setSelectedVault] = useState<PaymentMethod>('USDT');
  const [cajaActiva,    setCajaActiva]    = useState<string | null>(null);
  const fetchLockRef = useRef(false);

  // errores por módulo
  const [ledgerError,   setLedgerError]   = useState<string | null>(null);
  const [cajaError,     setCajaError]     = useState<string | null>(null);
  const [cuentaError,   setCuentaError]   = useState<string | null>(null);
  const [reqError,      setReqError]      = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [fxError,       setFxError]       = useState<string | null>(null);

  // estados de carga
  const [savingLedger,   setSavingLedger]   = useState(false);
  const [savingCaja,     setSavingCaja]     = useState(false);
  const [savingCuenta,   setSavingCuenta]   = useState(false);
  const [savingReq,      setSavingReq]      = useState(false);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingFX,       setSavingFX]       = useState(false);
  const [savingAction,   setSavingAction]   = useState<string | null>(null);

  // seguridad director
  const [directorAuthOpen,    setDirectorAuthOpen]    = useState(false);
  const [directorCode,        setDirectorCode]        = useState('');
  const [directorAuthError,   setDirectorAuthError]   = useState<string | null>(null);
  const [pendingSecureAction, setPendingSecureAction] = useState<(() => Promise<void>) | null>(null);

  // edición ledger
  const [editingTx,  setEditingTx]  = useState<LedgerTx | null>(null);
  const [editTxForm, setEditTxForm] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    description: '', fecha: new Date().toISOString().split('T')[0],
  });

  // edición caja
  const [editingMov,  setEditingMov]  = useState<MovimientoCaja | null>(null);
  const [editMovForm, setEditMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
  });

  // transferencia entre cajas
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    caja_origen_id: '', caja_destino_id: '',
    moneda: 'USDT' as PaymentMethod,
    monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0],
  });
  const [deleteTransferModal,     setDeleteTransferModal]     = useState<TransferChain | null>(null);
  const [deleteTransferSelection, setDeleteTransferSelection] = useState<{salida:boolean;entrada:boolean;reposicion:boolean}>({salida:true,entrada:true,reposicion:true});

  // reposición
  const [pagarReposicionModal,  setPagarReposicionModal]  = useState<CuentaGeneral | null>(null);
  const [pagarReposicionMoneda, setPagarReposicionMoneda] = useState<PaymentMethod>('USDT');

  // entrega efectivo ADM → CEO
  const [entregaCEOModal,  setEntregaCEOModal]  = useState(false);
  const [entregaCEOForm, setEntregaCEOForm] = useState({
    monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0],
  });

  // [CHG v15] FX Desk: caja origen + caja destino (antes una sola caja_id)
  const [fxModalOpen, setFxModalOpen] = useState(false);
  const [fxForm, setFxForm] = useState({
    caja_origen_id:  '',
    caja_destino_id: '',
    subcaja_origen:  'ADM' as SubcajaEfectivo,
    subcaja_destino: 'ADM' as SubcajaEfectivo,
    moneda_origen:   'USDT' as PaymentMethod,
    moneda_destino:  'BS'   as PaymentMethod,
    monto_origen:    '',
    tasa:            String(DEFAULT_TASA_BS),
    concepto:        '',
    fecha:           new Date().toISOString().split('T')[0],
  });

  // préstamo externo modal
  const [prestamoModal, setPrestamoModal] = useState(false);
  const [prestamoForm, setPrestamoForm] = useState({
    prestamista:  'BECQUER' as Prestamista,
    caja_id:      '',
    moneda:       'USDT' as PaymentMethod,
    monto:        '',
    concepto:     '',
    fecha:        new Date().toISOString().split('T')[0],
    es_devolucion: false,
  });

  // ledger form
  const [ledger, setLedger] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    reference: '', capitanId: '', fecha: new Date().toISOString().split('T')[0],
  });

  // caja form
  const [movForm, setMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
    subcaja: 'ADM' as SubcajaEfectivo,
  });

  // cuentas form
  const [cuentaForm, setCuentaForm] = useState({
    tipo:              'HORAS_PAGADAS' as FormTipo,
    alumno_student_id: '',
    horas_prometidas:  '',
    moneda_pago:       'USDT' as string,
    entidad_nombre:    '', entidad_tipo: 'LIBRE',
    proveedor_id:      '',
    moneda:            'USDT' as PaymentMethod,
    monto_total:       '', concepto: '',
    fecha_emision:     new Date().toISOString().split('T')[0],
    fecha_vencimiento: '', notas: '',
  });
  const [showCuentaForm, setShowCuentaForm] = useState(false);

  // requisiciones form
  const [reqItems,    setReqItems]    = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount,   setReqAmount]   = useState('');

  // cierre físico
  const [physBalances, setPhysBalances] = useState<Record<PaymentMethod, string>>({ USDT:'', ZELLE:'', CASH:'', BS:'' });

  // ─── SYNC HISTÓRICO ───────────────────────────────────────────────────────

  const syncPaidAccountsToLedger = useCallback(async (accounts: CuentaPorCobrar[]) => {
    const paid = accounts.filter(c => c.estatus === 'COBRADO' && Number(c.monto_total) > 0);
    for (const c of paid) {
      const inv = `${c.horas_compradas > 0 ? 'HORA' : 'CXC'}-${c.id}`;
      const { data: exists } = await supabase.from('transacciones_finanzas').select('id').eq('invoice_number', inv).limit(1);
      if (exists?.length) continue;
      await supabase.from('transacciones_finanzas').insert([{
        id: uuid4(), type: 'INCOME', entity_id: c.student_id,
        entity_name: c.nombre_alumno || 'ALUMNO',
        amount: round2(Number(c.monto_total) || 0), invoice_number: inv,
        description: `${c.concepto || 'COBRO'} · SINCRONIZACIÓN HISTÓRICA`,
        status: 'PAID', category: 'Academia',
        payment_method: normalizePaymentMethod(c.moneda),
        issue_date: c.fecha_emision ? new Date(c.fecha_emision).toISOString() : new Date().toISOString(),
      }]);
    }
  }, []);

  // ─── FETCH ────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (silent = false) => {
    if (fetchLockRef.current && !silent) return;
    if (fetchLockRef.current && silent) fetchLockRef.current = false;
    fetchLockRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [txRes, reqRes, cajasRes, movRes, cuentasRes, capRes, alumnosRes, cxcRes, fxRes] = await Promise.all([
        supabase.from('transacciones_finanzas').select('*').order('issue_date', { ascending: false }),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cajas_chicas').select('*').order('nombre'),
        supabase.from('movimientos_caja_chica').select('*').order('fecha', { ascending: false }),
        supabase.from('cuentas_generales').select('*').eq('tipo', 'CXP').order('fecha_emision', { ascending: false }),
        supabase.from('capitanes').select('*').order('nombre'),
        supabase.from('perfiles_estudiantes').select('id, nombre_completo, student_serial, sede').eq('role', 'student').order('nombre_completo'),
        supabase.from('cuentas_por_cobrar').select('*').order('fecha_emision', { ascending: false }),
        supabase.from('fx_registros').select('*').order('fecha', { ascending: false }).limit(200),
      ]);

      if (txRes.data) setTransactions(txRes.data.map((t: any) => ({
        id: t.id, type: t.type, entityId: t.entity_id,
        entityName: t.entity_name || 'MOVIMIENTO',
        amount: round2(Number(t.amount) || 0),
        invoiceNumber: t.invoice_number || 'S/N',
        description: t.description || '', status: t.status || 'PENDING',
        issueDate: t.issue_date, category: t.category || 'General',
        payment_method: normalizePaymentMethod(t.payment_method),
        fx_id:  t.fx_id  ?? null,                                  // [NEW v15]
        fx_leg: (t.fx_leg === 'IN' || t.fx_leg === 'OUT') ? t.fx_leg : null,   // [NEW v15]
      } as LedgerTx)));

      if (reqRes.data)   setRequests(reqRes.data);
      if (cajasRes.data) setCajas(cajasRes.data);

      if (movRes.data) setMovCajas(movRes.data.map((m: any) => ({
        ...m,
        moneda:           normalizePaymentMethod(m.moneda),
        monto:            round2(Number(m.monto) || 0),
        transfer_id:      m.transfer_id      ?? null,
        transfer_role:    m.transfer_role    ?? null,
        transfer_peer_id: m.transfer_peer_id ?? null,
        subcaja:          m.subcaja          ?? null,
        prestamista:      m.prestamista      ?? null,
        es_prestamo:      m.es_prestamo      ?? false,
        fx_id:            m.fx_id            ?? null,
        fx_role:          m.fx_role          ?? null,              // [NEW v15]
      })));

      if (cuentasRes.data) setCuentas(cuentasRes.data.map((c: any) => ({
        ...c,
        monto_total:       round2(Number(c.monto_total) || 0),
        monto_pendiente:   round2(Number(c.monto_pendiente) || 0),
        transfer_id:       c.transfer_id       ?? null,
        categoria_interna: c.categoria_interna ?? null,
      })));

      if (capRes.data)     setCapitanes(capRes.data);
      if (alumnosRes.data) setAlumnos(alumnosRes.data.map((a: any) => ({
        student_id: a.id,
        nombre:     a.nombre_completo || 'SIN NOMBRE',
        serial:     a.student_serial  || '—',
        sede:       a.sede            || '—',
      })));

      if (cxcRes.data) {
        const norm = cxcRes.data.map((c: any) => ({
          ...c,
          monto_total:      round2(Number(c.monto_total) || 0),
          monto_pagado:     round2(Number(c.monto_pagado) || 0),
          monto_pendiente:  round2(Number(c.monto_pendiente) || 0),
          horas_prometidas: Number(c.horas_prometidas) || 0,
          horas_compradas:  Number(c.horas_compradas)  || 0,
          moneda: normalizePaymentMethod(c.moneda),
        }));
        setCuentasCxC(norm);
        await syncPaidAccountsToLedger(norm);
      }

      if (fxRes.data) setFxRegistros(fxRes.data.map((f: any) => ({
        ...f,
        moneda_origen:   normalizePaymentMethod(f.moneda_origen),
        moneda_destino:  normalizePaymentMethod(f.moneda_destino),
        monto_origen:    round2(Number(f.monto_origen) || 0),
        monto_destino:   round2(Number(f.monto_destino) || 0),
        tasa:            round4(Number(f.tasa) || 0),                          // [CHG v15] 4 decimales
        caja_origen_id:  f.caja_origen_id  ?? f.caja_id ?? null,               // [NEW v15] fallback legacy
        caja_destino_id: f.caja_destino_id ?? null,
        subcaja_origen:  f.subcaja_origen  ?? null,
        subcaja_destino: f.subcaja_destino ?? null,
        referencia:      f.referencia      ?? null,
      })));

    } catch (e) {
      console.error('[FinancePanel v15.0] fetchAll error:', e);
    } finally {
      setLoading(false);
      fetchLockRef.current = false;
    }
  }, [syncPaidAccountsToLedger]);

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRealtimeChange = useCallback(() => {
    if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
    realtimeDebounce.current = setTimeout(() => fetchAll(true), 800);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
    const ch = supabase.channel('finance-v15')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_finanzas' },  handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_compra' },       handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas_chicas' },             handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_caja_chica' },   handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_generales' },        handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_por_cobrar' },       handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fx_registros' },             handleRealtimeChange)
      .subscribe();
    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      supabase.removeChannel(ch);
    };
  }, [fetchAll, handleRealtimeChange]);

  // ─── MÉTRICAS ─────────────────────────────────────────────────────────────

  /** [CHG v15] Saldo de bóveda usando la regla de signo única (incluye patas FX) */
  const getVaultBalance = useCallback((method: PaymentMethod) =>
    transactions
      .filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((acc, t) => round2(acc + signedLedgerAmount(t)), 0),
  [transactions]);

  useEffect(() => {
    const totals = ALL_METHODS.reduce((acc, m) => {
      acc[m] = getVaultBalance(m); return acc;
    }, { USDT: 0, ZELLE: 0, CASH: 0, BS: 0 } as Record<PaymentMethod, number>);
    setGlobalFinance(totals);
  }, [transactions, getVaultBalance, setGlobalFinance]);

  /** Saldo total de una caja en una moneda */
  const getCajaBalance = useCallback((cajaId: string, moneda: PaymentMethod) =>
    movCajas
      .filter(m => m.caja_id === cajaId && m.moneda === moneda)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  /** Saldo de una subcaja de efectivo específica (ADM o CEO) */
  const getSubcajaBalance = useCallback((cajaId: string, subcaja: SubcajaEfectivo) =>
    movCajas
      .filter(m => m.caja_id === cajaId && m.moneda === 'CASH' && m.subcaja === subcaja)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  const cxcPendientes   = useMemo(() => cuentasCxC.filter(c => c.estatus === 'PENDIENTE'), [cuentasCxC]);
  const horasPagadas    = useMemo(() => cuentasCxC.filter(c => c.estatus === 'COBRADO'),   [cuentasCxC]);
  const totalCxC        = useMemo(() => cxcPendientes.reduce((a, c) => round2(a + c.monto_pendiente), 0), [cxcPendientes]);
  const totalHorasAcred = useMemo(() => horasPagadas.reduce((a, c) => a + c.horas_compradas, 0), [horasPagadas]);

  const cuentasProveedores  = useMemo(() => cuentas.filter(c => c.categoria_interna !== 'REPOSICION_CAJA'), [cuentas]);
  const cuentasReposiciones = useMemo(() => cuentas.filter(c => c.categoria_interna === 'REPOSICION_CAJA'), [cuentas]);
  const totalCxP = useMemo(() =>
    cuentasProveedores.filter(c => c.estatus !== 'PAGADO').reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentasProveedores]);
  const totalReposiciones = useMemo(() =>
    cuentasReposiciones.filter(c => c.estatus !== 'PAGADO').reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentasReposiciones]);

  // ─── [NEW v15] FX: soporte de cajas por moneda ────────────────────────────

  /** Cajas que aceptan una moneda dada */
  const cajasQueAceptan = useCallback((m: PaymentMethod) =>
    cajas.filter(c => getCajaConfig(c.nombre).monedasPermitidas.includes(m)),
  [cajas]);

  /** Caja por defecto de una moneda: la caja exclusiva de esa moneda (BS→Bancamiga, CASH→Efectivo) */
  const defaultCajaFor = useCallback((m: PaymentMethod): string => {
    const exclusiva = cajas.find(c => {
      const cf = getCajaConfig(c.nombre);
      return cf.monedasPermitidas.length === 1 && cf.monedasPermitidas[0] === m;
    });
    return exclusiva?.id ?? '';
  }, [cajas]);

  const cajaNombre = useCallback((id?: string | null) =>
    id ? (cajas.find(c => c.id === id)?.nombre ?? 'CAJA ELIMINADA') : 'SOLO BÓVEDA',
  [cajas]);

  /** Conciliación: Bóveda (consolidado) vs Σ Cajas (custodia física) */
  const conciliacion = useMemo(() => ALL_METHODS.map(m => {
    const boveda     = getVaultBalance(m);
    const enCajas    = round2(cajas.reduce((a, c) => a + getCajaBalance(c.id, m), 0));
    const sinAsignar = round2(boveda - enCajas);
    return { m, boveda, enCajas, sinAsignar };
  }), [cajas, getVaultBalance, getCajaBalance]);

  // ─── SEGURIDAD ────────────────────────────────────────────────────────────

  const canManageFinance = ['CEO', 'ADMIN', 'DIRECTOR'].includes(String(userRole).toUpperCase());

  const requireDirectorCode = useCallback((action: () => Promise<void>) => {
    if (!canManageFinance) { alert('Acceso denegado.'); return; }
    setDirectorCode('');
    setDirectorAuthError(null);
    setPendingSecureAction(() => action);
    setDirectorAuthOpen(true);
  }, [canManageFinance]);

  const confirmDirectorCode = async () => {
    if (!/^\d{4}$/.test(directorCode)) { setDirectorAuthError('La clave debe tener 4 dígitos.'); return; }
    if (directorCode !== DIRECTOR_FINANCE_CODE) { setDirectorAuthError('Clave incorrecta.'); setDirectorCode(''); return; }
    const action = pendingSecureAction;
    setDirectorAuthOpen(false); setDirectorCode(''); setDirectorAuthError(null); setPendingSecureAction(null);
    if (action) { try { await action(); } catch (err) { console.error('[FinancePanel] acción protegida:', err); } }
  };

  const cancelDirectorAuth = () => {
    setDirectorAuthOpen(false); setDirectorCode(''); setDirectorAuthError(null); setPendingSecureAction(null);
  };

  // ─── [NEW v15] FX: PURGA / ANULACIÓN ──────────────────────────────────────
  // Elimina TODAS las patas de un FX: Ledger (fx_id + referencias legacy),
  // movimientos de caja y el registro FX. Con la migración v15 el borrado
  // de fx_registros cascadea; los deletes explícitos cubren datos legacy.

  const purgeFx = useCallback(async (fxId: string, extraRef?: string) => {
    const refs = Array.from(new Set([
      ...movCajas.filter(m => m.fx_id === fxId).map(m => m.referencia),
      ...fxRegistros.filter(f => f.id === fxId).map(f => f.referencia ?? ''),
      extraRef ?? '',
    ].filter((r): r is string => !!r)));

    const { error: eTx } = await supabase.from('transacciones_finanzas').delete().eq('fx_id', fxId);
    if (eTx) throw new Error(`Ledger FX: ${eTx.message}`);

    if (refs.length) {
      const invoices = refs.flatMap(r => [r, `${r}-OUT`, `${r}-IN`]);
      const { error: eLeg } = await supabase.from('transacciones_finanzas').delete().in('invoice_number', invoices);
      if (eLeg) throw new Error(`Ledger FX legacy: ${eLeg.message}`);
    }

    const { error: eMov } = await supabase.from('movimientos_caja_chica').delete().eq('fx_id', fxId);
    if (eMov) throw new Error(`Cajas FX: ${eMov.message}`);

    const { error: eFx } = await supabase.from('fx_registros').delete().eq('id', fxId);
    if (eFx) throw new Error(`Registro FX: ${eFx.message}`);
  }, [movCajas, fxRegistros]);

  const anularFX = (fxId: string) => requireDirectorCode(async () => {
    setSavingAction(fxId);
    try {
      await purgeFx(fxId);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al anular FX.';
      setLedgerError(msg); setCajaError(msg);
    } finally { setSavingAction(null); }
  });

  // ─── EDICIÓN ──────────────────────────────────────────────────────────────

  const openEditTx = (tx: LedgerTx) => {
    // [NEW v15] las patas FX no se editan por separado — rompería la partida doble
    if (tx.fx_id) { alert('Este asiento pertenece a una operación FX. Anule el FX completo y regístrelo de nuevo en FX Desk.'); return; }
    const d = tx.issueDate ? new Date(tx.issueDate) : new Date();
    setEditingTx(tx);
    setEditTxForm({
      amount:      String(round2(Number(tx.amount) || 0)),
      currency:    normalizePaymentMethod(tx.payment_method),
      type:        tx.type as TransactionType,
      description: tx.description || '',
      fecha:       Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0],
    });
  };

  const saveEditedTx = async () => {
    if (!editingTx) return;
    const amount = round2(parseFloat(editTxForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) { setLedgerError('Monto inválido.'); return; }
    // [NEW v15] un FX manual de una sola pata descuadra bóvedas
    if (editTxForm.type === 'FX_EXCHANGE' && !editingTx.fx_id) {
      setLedgerError('Un cambio de moneda se registra en FX Desk (2 patas). Cambie el tipo a Ingreso/Egreso o elimine el asiento.');
      return;
    }
    setSavingAction(editingTx.id);
    try {
      const { error } = await supabase.from('transacciones_finanzas').update({
        amount, payment_method: editTxForm.currency, type: editTxForm.type,
        description: editTxForm.description.trim() || 'MOVIMIENTO EDITADO',
        issue_date: new Date(editTxForm.fecha).toISOString(),
      }).eq('id', editingTx.id);
      if (error) throw new Error(error.message);
      setEditingTx(null);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Error al editar.');
    } finally { setSavingAction(null); }
  };

  const openEditMov = (mov: MovimientoCaja) => {
    if (mov.transfer_id) { alert('Forma parte de una transferencia. Elimínela completa y créela de nuevo.'); return; }
    if (mov.fx_id) { alert('Forma parte de una operación FX. Anule el FX completo y regístrelo de nuevo.'); return; }   // [NEW v15]
    setEditingMov(mov);
    const d = new Date(mov.fecha);
    setEditMovForm({
      tipo:       mov.tipo,
      moneda:     normalizePaymentMethod(mov.moneda),
      monto:      String(round2(Number(mov.monto) || 0)),
      concepto:   mov.concepto   || '',
      referencia: mov.referencia || '',
      fecha:      Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0],
    });
  };

  const saveEditedMov = async () => {
    if (!editingMov) return;
    const monto = round2(parseFloat(editMovForm.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!editMovForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    // [FIX v15] respetar monedas permitidas por la caja
    const cajaObj = cajas.find(c => c.id === editingMov.caja_id);
    const conf    = getCajaConfig(cajaObj?.nombre ?? '');
    if (!conf.monedasPermitidas.includes(editMovForm.moneda)) {
      setCajaError(`Esta caja solo acepta: ${conf.monedasPermitidas.join(', ')}`); return;
    }
    setSavingAction(editingMov.id);
    try {
      const { error } = await supabase.from('movimientos_caja_chica').update({
        tipo: editMovForm.tipo, moneda: editMovForm.moneda, monto,
        concepto:   editMovForm.concepto.toUpperCase().trim(),
        referencia: editMovForm.referencia.toUpperCase().trim() || null,
        fecha:      new Date(editMovForm.fecha).toISOString(),
      }).eq('id', editingMov.id);
      if (error) throw new Error(error.message);
      setEditingMov(null);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error al editar movimiento.');
    } finally { setSavingAction(null); }
  };

  // ─── ELIMINACIÓN ──────────────────────────────────────────────────────────

  const deleteTxProtected = (id: string) => {
    // [NEW v15] si es pata FX (nueva o legacy) → anular el FX completo
    const txSel  = transactions.find(t => t.id === id);
    const fxLink = txSel?.fx_id
      ?? (txSel?.invoiceNumber ? movCajas.find(m => m.fx_id && m.referencia === txSel.invoiceNumber)?.fx_id : null)
      ?? null;
    if (fxLink) { anularFX(fxLink); return; }

    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const tx = transactions.find(t => t.id === id);
        const { error } = await supabase.from('transacciones_finanzas').delete().eq('id', id);
        if (error) throw new Error(error.message);
        if (tx?.invoiceNumber?.startsWith('CXC-') || tx?.invoiceNumber?.startsWith('HORA-')) {
          const cxcId = tx.invoiceNumber.replace(/^CXC-/, '').replace(/^HORA-/, '');
          await supabase.from('cuentas_por_cobrar').delete().eq('id', cxcId);
        }
        fetchLockRef.current = false; await fetchAll(true);
      } catch (err) {
        setLedgerError(err instanceof Error ? err.message : 'Error al eliminar.');
      } finally { setSavingAction(null); }
    });
  };

  const deleteMovProtected = (id: string) => {
    const mov = movCajas.find(m => m.id === id);
    if (mov?.transfer_id) { openDeleteTransferModal(mov.transfer_id); return; }
    if (mov?.fx_id)       { anularFX(mov.fx_id); return; }   // [NEW v15]
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', id);
        if (error) throw new Error(error.message);
        fetchLockRef.current = false; await fetchAll(true);
      } catch (err) {
        setCajaError(err instanceof Error ? err.message : 'Error al eliminar movimiento.');
      } finally { setSavingAction(null); }
    });
  };

  const deleteCuentaProtected = (id: string, esCxC: boolean) => {
    if (!esCxC) {
      const cuenta = cuentas.find(c => c.id === id);
      if (cuenta?.transfer_id) { openDeleteTransferModal(cuenta.transfer_id); return; }
    }
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        if (esCxC) {
          const { error } = await supabase.from('cuentas_por_cobrar').delete().eq('id', id);
          if (error) throw new Error(error.message);
          await supabase.from('transacciones_finanzas').delete().in('invoice_number', [`CXC-${id}`, `HORA-${id}`]);
        } else {
          const { error } = await supabase.from('cuentas_generales').delete().eq('id', id);
          if (error) throw new Error(error.message);
        }
        fetchLockRef.current = false; await fetchAll(true);
      } catch (err) {
        setCuentaError(err instanceof Error ? err.message : 'Error al eliminar cuenta.');
      } finally { setSavingAction(null); }
    });
  };

  // ─── HANDLER: LEDGER ──────────────────────────────────────────────────────

  const handleLedger = async (e: React.FormEvent) => {
    e.preventDefault(); setLedgerError(null);
    // [NEW v15] FX nunca se registra manualmente en una sola pata
    if (ledger.type === 'FX_EXCHANGE') { openFxDesk(ledger.currency); return; }
    const num = round2(parseFloat(ledger.amount));
    if (isNaN(num) || num <= 0) { setLedgerError('Monto inválido.'); return; }
    if (ledger.type === 'INSTRUCTOR_PAY' && !ledger.capitanId) { setLedgerError('Selecciona un capitán.'); return; }
    setSavingLedger(true);
    const txId = uuid4();
    const cap  = capitanes.find(c => c.id === ledger.capitanId);
    try {
      const { error } = await supabase.from('transacciones_finanzas').insert([{
        id: txId, type: ledger.type,
        entity_name: ledger.type === 'INSTRUCTOR_PAY' ? `NÓMINA: ${cap?.nombre ?? 'CAPITÁN'}` : `${ledger.type} ${ledger.currency}`,
        amount: num, invoice_number: `TX-${genHash(txId)}`,
        description: ledger.reference.trim() || 'REGISTRO MANUAL',
        status: 'PAID', category: ledger.type === 'INSTRUCTOR_PAY' ? 'Nomina' : 'General',
        payment_method: ledger.currency,
        issue_date: new Date(ledger.fecha).toISOString(),
      }]);
      if (error) { setLedgerError(error.code === '23505' ? 'Duplicado detectado.' : `Error: ${error.message}`); return; }
      setLedger(p => ({ ...p, amount: '', reference: '' }));
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally { setSavingLedger(false); }
  };

  // ─── HANDLER: CAJA ────────────────────────────────────────────────────────

  const handleMovCaja = async (e: React.FormEvent) => {
    e.preventDefault(); setCajaError(null);
    if (!cajaActiva) { setCajaError('Selecciona una caja.'); return; }
    const num = round2(parseFloat(movForm.monto));
    if (isNaN(num) || num <= 0) { setCajaError('Monto inválido.'); return; }
    if (!movForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }

    const cajaObj   = cajas.find(c => c.id === cajaActiva);
    const cajaConf  = getCajaConfig(cajaObj?.nombre ?? '');
    if (!cajaConf.monedasPermitidas.includes(movForm.moneda)) {
      setCajaError(`Esta caja solo acepta: ${cajaConf.monedasPermitidas.join(', ')}`);
      return;
    }

    setSavingCaja(true);
    try {
      const esCajaEfectivo = cajaConf.esCajaEfectivo;
      const { error } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(), caja_id: cajaActiva, tipo: movForm.tipo, moneda: movForm.moneda,
        monto: num,
        concepto:   movForm.concepto.toUpperCase().trim(),
        referencia: movForm.referencia.toUpperCase().trim() || null,
        fecha:      new Date(movForm.fecha).toISOString(),
        registrado_por: userRole,
        subcaja: esCajaEfectivo ? movForm.subcaja : null,
      }]);
      if (error) { setCajaError(`Error: ${error.message}`); return; }
      setMovForm(p => ({ ...p, monto: '', concepto: '', referencia: '' }));
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally { setSavingCaja(false); }
  };

  /** [FIX v15] Activar caja fija la moneda a una permitida */
  const toggleCajaActiva = (caja: CajaChica) => {
    if (cajaActiva === caja.id) { setCajaActiva(null); return; }
    const conf = getCajaConfig(caja.nombre);
    setCajaActiva(caja.id);
    if (!conf.monedasPermitidas.includes(movForm.moneda)) {
      setMovForm(p => ({ ...p, moneda: conf.monedasPermitidas[0] }));
    }
  };

  // ─── HANDLER: ENTREGA ADM → CEO ──────────────────────────────────────────

  const handleEntregaCEO = async (e: React.FormEvent) => {
    e.preventDefault();
    const cajaEfectivoObj = cajas.find(c => getCajaConfig(c.nombre).esCajaEfectivo);
    if (!cajaEfectivoObj) { alert('No se encontró la caja de efectivo.'); return; }

    const monto = round2(parseFloat(entregaCEOForm.monto));
    if (isNaN(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!entregaCEOForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }

    const saldoADM = getSubcajaBalance(cajaEfectivoObj.id, 'ADM');
    if (monto > saldoADM) {
      const ok = window.confirm(`⚠️ ADM solo tiene ${fmtMonto(saldoADM, 'CASH')} disponible.\n¿Registrar de todas formas?`);
      if (!ok) return;
    }

    setSavingCaja(true);
    const refEntrega = `ENTREGA-${genHash(entregaCEOForm.concepto + Date.now())}`;
    const fechaISO   = new Date(entregaCEOForm.fecha).toISOString();

    try {
      const { error: e1 } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(), caja_id: cajaEfectivoObj.id,
        tipo: 'SALIDA', moneda: 'CASH', monto,
        concepto:   `ENTREGA A CEO ← ${entregaCEOForm.concepto.toUpperCase().trim()}`,
        referencia: refEntrega, fecha: fechaISO,
        registrado_por: userRole, subcaja: 'ADM',
      }]);
      if (e1) throw new Error(`ADM Salida: ${e1.message}`);

      const { error: e2 } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(), caja_id: cajaEfectivoObj.id,
        tipo: 'ENTRADA', moneda: 'CASH', monto,
        concepto:   `RECIBIDO DE ADM → ${entregaCEOForm.concepto.toUpperCase().trim()}`,
        referencia: refEntrega, fecha: fechaISO,
        registrado_por: userRole, subcaja: 'CEO',
      }]);
      if (e2) {
        await supabase.from('movimientos_caja_chica').delete().eq('referencia', refEntrega);
        throw new Error(`CEO Entrada: ${e2.message}`);
      }

      setEntregaCEOForm({ monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0] });
      setEntregaCEOModal(false);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error en entrega CEO.');
    } finally { setSavingCaja(false); }
  };

  // ─── [CHG v15] FX DESK INTERCONECTADO ─────────────────────────────────────
  // Partida doble por operación (sin duplicar valor):
  //   Bóveda origen  −M_o   (Ledger FX_EXCHANGE, fx_leg=OUT)
  //   Caja origen    −M_o   (SALIDA, opcional si el dinero no estaba en una caja)
  //   Bóveda destino +M_d   (Ledger FX_EXCHANGE, fx_leg=IN)
  //   Caja destino   +M_d   (ENTRADA, ej. Bancamiga para BS)
  // Las patas FX NO cuentan como ingreso/egreso operativo: solo mueven valor entre monedas.

  /** Abre FX Desk con defaults: origen USDT/ZELLE/CASH → destino BS en su caja exclusiva */
  const openFxDesk = (origenPreferido?: PaymentMethod) => {
    const origen: PaymentMethod  = origenPreferido && origenPreferido !== 'BS' ? origenPreferido : 'USDT';
    const destino: PaymentMethod = 'BS';
    setFxError(null);
    setFxForm({
      caja_origen_id:  defaultCajaFor(origen),
      caja_destino_id: defaultCajaFor(destino),
      subcaja_origen:  'ADM',
      subcaja_destino: 'ADM',
      moneda_origen:   origen,
      moneda_destino:  destino,
      monto_origen:    '',
      tasa:            String(tasaBCV),
      concepto:        '',
      fecha:           hoyISO(),
    });
    setFxModalOpen(true);
  };

  /** Cambia moneda de un lado; corrige caja incompatible y ajusta la tasa según el par */
  const setFxMoneda = (lado: 'ORIGEN' | 'DESTINO', m: PaymentMethod) => {
    setFxForm(p => {
      const next = { ...p };
      if (lado === 'ORIGEN') {
        next.moneda_origen = m;
        const caja = cajas.find(c => c.id === p.caja_origen_id);
        if (!caja || !getCajaConfig(caja.nombre).monedasPermitidas.includes(m)) next.caja_origen_id = defaultCajaFor(m);
      } else {
        next.moneda_destino = m;
        const caja = cajas.find(c => c.id === p.caja_destino_id);
        if (!caja || !getCajaConfig(caja.nombre).monedasPermitidas.includes(m)) next.caja_destino_id = defaultCajaFor(m);
      }
      const prevBS = p.moneda_origen === 'BS' || p.moneda_destino === 'BS';
      const nextBS = next.moneda_origen === 'BS' || next.moneda_destino === 'BS';
      if (nextBS && !prevBS) next.tasa = String(tasaBCV);
      if (!nextBS && prevBS) next.tasa = '1';
      return next;
    });
  };

  /** Fallback no-atómico con compensación (solo si el RPC no existe todavía) */
  const registrarFxFallback = async (p: FxPayload) => {
    try {
      const { error: eFx } = await supabase.from('fx_registros').insert([{
        id: p.fxId, fecha: p.fechaISO,
        moneda_origen: p.monedaOrigen, moneda_destino: p.monedaDestino,
        monto_origen: p.montoOrigen, monto_destino: p.montoDestino, tasa: p.tasa,
        concepto: p.concepto, registrado_por: userRole,
        caja_id: p.cajaOrigenId, caja_origen_id: p.cajaOrigenId, caja_destino_id: p.cajaDestinoId,
        subcaja_origen: p.subcajaOrigen, subcaja_destino: p.subcajaDestino, referencia: p.referencia,
      }]);
      if (eFx) throw new Error(`Registro FX: ${eFx.message}`);

      const movs: any[] = [];
      if (p.cajaOrigenId) movs.push({
        id: uuid4(), caja_id: p.cajaOrigenId, tipo: 'SALIDA', moneda: p.monedaOrigen, monto: p.montoOrigen,
        concepto: `FX VENTA ${p.monedaOrigen}→${p.monedaDestino} · DESTINO ${p.cajaDestinoNombre} · ${p.concepto}`,
        referencia: p.referencia, fecha: p.fechaISO, registrado_por: userRole,
        subcaja: p.subcajaOrigen, fx_id: p.fxId, fx_role: 'SALIDA',
      });
      if (p.cajaDestinoId) movs.push({
        id: uuid4(), caja_id: p.cajaDestinoId, tipo: 'ENTRADA', moneda: p.monedaDestino, monto: p.montoDestino,
        concepto: `FX COMPRA ${p.monedaDestino}←${p.monedaOrigen} · ORIGEN ${p.cajaOrigenNombre} · ${p.concepto}`,
        referencia: p.referencia, fecha: p.fechaISO, registrado_por: userRole,
        subcaja: p.subcajaDestino, fx_id: p.fxId, fx_role: 'ENTRADA',
      });
      if (movs.length) {
        const { error: eMov } = await supabase.from('movimientos_caja_chica').insert(movs);
        if (eMov) throw new Error(`Cajas FX: ${eMov.message}`);
      }

      const desc = `Cambio ${p.monedaOrigen} → ${p.monedaDestino} @ ${p.tasa} · ${p.cajaOrigenNombre} → ${p.cajaDestinoNombre} · ${p.concepto}`;
      const { error: eTx } = await supabase.from('transacciones_finanzas').insert([
        {
          id: uuid4(), type: 'FX_EXCHANGE',
          entity_name: `FX SALIDA ${p.monedaOrigen}→${p.monedaDestino}`,
          amount: p.montoOrigen, invoice_number: `${p.referencia}-OUT`, description: desc,
          status: 'PAID', category: 'FX', payment_method: p.monedaOrigen, issue_date: p.fechaISO,
          fx_id: p.fxId, fx_leg: 'OUT',
        },
        {
          id: uuid4(), type: 'FX_EXCHANGE',
          entity_name: `FX ENTRADA ${p.monedaDestino}←${p.monedaOrigen}`,
          amount: p.montoDestino, invoice_number: `${p.referencia}-IN`, description: desc,
          status: 'PAID', category: 'FX', payment_method: p.monedaDestino, issue_date: p.fechaISO,
          fx_id: p.fxId, fx_leg: 'IN',
        },
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

    // Validación de cajas contra restricciones de moneda
    const cajaO = f.caja_origen_id  ? cajas.find(c => c.id === f.caja_origen_id)  ?? null : null;
    const cajaD = f.caja_destino_id ? cajas.find(c => c.id === f.caja_destino_id) ?? null : null;
    if (f.caja_origen_id  && !cajaO) { setFxError('Caja origen no encontrada.'); return; }
    if (f.caja_destino_id && !cajaD) { setFxError('Caja destino no encontrada.'); return; }
    const confO = cajaO ? getCajaConfig(cajaO.nombre) : null;
    const confD = cajaD ? getCajaConfig(cajaD.nombre) : null;
    if (cajaO && confO && !confO.monedasPermitidas.includes(f.moneda_origen)) {
      setFxError(`${cajaO.nombre} no opera ${f.moneda_origen}.`); return;
    }
    if (cajaD && confD && !confD.monedasPermitidas.includes(f.moneda_destino)) {
      setFxError(`${cajaD.nombre} no opera ${f.moneda_destino}.`); return;
    }
    const subcajaOrigen  = confO?.esCajaEfectivo ? f.subcaja_origen  : null;
    const subcajaDestino = confD?.esCajaEfectivo ? f.subcaja_destino : null;

    // Verificación de fondos (advertencia, no bloqueo — igual que transferencias)
    const avisos: string[] = [];
    const saldoBoveda = getVaultBalance(f.moneda_origen);
    if (saldoBoveda < montoOrigen) avisos.push(`Bóveda ${f.moneda_origen}: ${fmtMonto(saldoBoveda, f.moneda_origen)} disponible`);
    if (cajaO) {
      const saldoCaja = subcajaOrigen ? getSubcajaBalance(cajaO.id, subcajaOrigen) : getCajaBalance(cajaO.id, f.moneda_origen);
      if (saldoCaja < montoOrigen) avisos.push(`${cajaO.nombre}${subcajaOrigen ? ` (${subcajaOrigen})` : ''}: ${fmtMonto(saldoCaja, f.moneda_origen)} disponible`);
    }
    if (avisos.length) {
      const ok = window.confirm(`⚠️ Fondos insuficientes para vender ${fmtMonto(montoOrigen, f.moneda_origen)}\n\n${avisos.join('\n')}\n\n¿Registrar de todas formas?`);
      if (!ok) return;
    }

    const fxId = uuid4();
    const payload: FxPayload = {
      fxId,
      referencia:        `FX-${genHash(fxId)}`,
      fechaISO:          new Date(f.fecha).toISOString(),
      monedaOrigen:      f.moneda_origen,
      monedaDestino:     f.moneda_destino,
      montoOrigen,
      montoDestino,
      tasa,
      concepto:          f.concepto.toUpperCase().trim(),
      cajaOrigenId:      cajaO?.id ?? null,
      cajaDestinoId:     cajaD?.id ?? null,
      cajaOrigenNombre:  cajaO ? cajaO.nombre.toUpperCase() : 'BÓVEDA',
      cajaDestinoNombre: cajaD ? cajaD.nombre.toUpperCase() : 'BÓVEDA',
      subcajaOrigen,
      subcajaDestino,
    };

    setSavingFX(true);
    try {
      const { error: rpcErr } = await supabase.rpc('fn_registrar_fx', {
        p_fx_id:           payload.fxId,
        p_fecha:           payload.fechaISO,
        p_moneda_origen:   payload.monedaOrigen,
        p_moneda_destino:  payload.monedaDestino,
        p_monto_origen:    payload.montoOrigen,
        p_monto_destino:   payload.montoDestino,
        p_tasa:            payload.tasa,
        p_concepto:        payload.concepto,
        p_referencia:      payload.referencia,
        p_registrado_por:  userRole,
        p_caja_origen_id:  payload.cajaOrigenId,
        p_caja_destino_id: payload.cajaDestinoId,
        p_subcaja_origen:  payload.subcajaOrigen,
        p_subcaja_destino: payload.subcajaDestino,
      });
      if (rpcErr) {
        if (!isMissingRpc(rpcErr)) throw new Error(`FX atómico: ${rpcErr.message}`);
        console.warn('[FX v15] RPC fn_registrar_fx no encontrado — usando fallback compensado. Ejecute migracion_finance_v15.sql.');
        await registrarFxFallback(payload);
      }

      setFxForm(p => ({ ...p, monto_origen: '', concepto: '' }));
      setFxModalOpen(false);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setFxError(err instanceof Error ? err.message : 'Error en operación FX.');
    } finally { setSavingFX(false); }
  };

  // monto destino calculado en tiempo real para preview
  const fxMontoDestino = useMemo(() =>
    computeFxDestino(fxForm.moneda_origen, fxForm.moneda_destino, parseFloat(fxForm.monto_origen), parseFloat(fxForm.tasa)),
  [fxForm.monto_origen, fxForm.tasa, fxForm.moneda_origen, fxForm.moneda_destino]);

  // ─── HANDLER: PRÉSTAMO EXTERNO ────────────────────────────────────────────

  const handlePrestamo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prestamoForm.caja_id)  { setCajaError('Selecciona la caja receptora.'); return; }
    const monto = round2(parseFloat(prestamoForm.monto));
    if (isNaN(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!prestamoForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }

    setSavingCaja(true);
    const refPrestamo = `PREST-${genHash(prestamoForm.prestamista + Date.now())}`;
    const fechaISO    = new Date(prestamoForm.fecha).toISOString();
    const concepto    = prestamoForm.concepto.toUpperCase().trim();

    try {
      if (!prestamoForm.es_devolucion) {
        const { error: eM } = await supabase.from('movimientos_caja_chica').insert([{
          id: uuid4(), caja_id: prestamoForm.caja_id,
          tipo: 'ENTRADA', moneda: prestamoForm.moneda, monto,
          concepto:   `PRÉSTAMO DE ${prestamoForm.prestamista} · ${concepto}`,
          referencia: refPrestamo, fecha: fechaISO,
          registrado_por: userRole,
          es_prestamo: true, prestamista: prestamoForm.prestamista,
        }]);
        if (eM) throw new Error(eM.message);

        const { error: eCxP } = await supabase.from('cuentas_generales').insert([{
          tipo: 'CXP',
          entidad_nombre: `DEVOLUCIÓN A ${prestamoForm.prestamista}`,
          entidad_tipo: 'PRESTAMISTA',
          moneda: prestamoForm.moneda,
          monto_total: monto, monto_pendiente: monto,
          concepto:   `Préstamo recibido de ${prestamoForm.prestamista} · ${concepto}`,
          fecha_emision: fechaISO, estatus: 'PENDIENTE',
          notas: `Ref: ${refPrestamo}`,
        }]);
        if (eCxP) console.warn('[v15] CxP de préstamo falló (no bloquea):', eCxP.message);

      } else {
        const { error: eM } = await supabase.from('movimientos_caja_chica').insert([{
          id: uuid4(), caja_id: prestamoForm.caja_id,
          tipo: 'SALIDA', moneda: prestamoForm.moneda, monto,
          concepto:   `DEVOLUCIÓN A ${prestamoForm.prestamista} · ${concepto}`,
          referencia: refPrestamo, fecha: fechaISO,
          registrado_por: userRole,
          es_prestamo: true, prestamista: prestamoForm.prestamista,
        }]);
        if (eM) throw new Error(eM.message);
      }

      setPrestamoForm(p => ({ ...p, monto: '', concepto: '' }));
      setPrestamoModal(false);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error en préstamo externo.');
    } finally { setSavingCaja(false); }
  };

  // ─── TRANSFERENCIA ENTRE CAJAS ────────────────────────────────────────────

  const handleTransferencia = async (e: React.FormEvent) => {
    e.preventDefault(); setTransferError(null);
    if (!transferForm.caja_origen_id)  { setTransferError('Selecciona la caja de origen.'); return; }
    if (!transferForm.caja_destino_id) { setTransferError('Selecciona la caja de destino.'); return; }
    if (transferForm.caja_origen_id === transferForm.caja_destino_id) { setTransferError('Origen y destino iguales.'); return; }

    const monto = round2(parseFloat(transferForm.monto));
    if (isNaN(monto) || monto <= 0) { setTransferError('Monto inválido.'); return; }
    if (!transferForm.concepto.trim()) { setTransferError('Concepto obligatorio.'); return; }

    const cajaOrigen  = cajas.find(c => c.id === transferForm.caja_origen_id);
    const cajaDestino = cajas.find(c => c.id === transferForm.caja_destino_id);
    if (!cajaOrigen || !cajaDestino) { setTransferError('Caja no encontrada.'); return; }

    const saldoOrigen = getCajaBalance(transferForm.caja_origen_id, transferForm.moneda);
    if (saldoOrigen < monto) {
      const ok = window.confirm(
        `⚠️ Saldo insuficiente en ${cajaOrigen.nombre}\n\n` +
        `Disponible: ${fmtMonto(saldoOrigen, transferForm.moneda)}\n` +
        `Transferir: ${fmtMonto(monto, transferForm.moneda)}\n\n¿Continuar?`
      );
      if (!ok) return;
    }

    setSavingTransfer(true);
    const transferId    = uuid4();
    const salidaId      = uuid4();
    const entradaId     = uuid4();
    const fechaISO      = new Date(transferForm.fecha).toISOString();
    const conceptoUpper = transferForm.concepto.toUpperCase().trim();

    try {
      const { error: e1 } = await supabase.from('movimientos_caja_chica').insert([{
        id: salidaId, caja_id: transferForm.caja_origen_id,
        tipo: 'SALIDA', moneda: transferForm.moneda, monto,
        concepto:   `TRANSFERENCIA → ${cajaDestino.nombre.toUpperCase()} · ${conceptoUpper}`,
        referencia: `TRF-${genHash(transferId)}`, fecha: fechaISO,
        registrado_por: userRole,
        transfer_id: transferId, transfer_role: 'SALIDA', transfer_peer_id: transferForm.caja_destino_id,
      }]);
      if (e1) throw new Error(`Salida: ${e1.message}`);

      const { error: e2 } = await supabase.from('movimientos_caja_chica').insert([{
        id: entradaId, caja_id: transferForm.caja_destino_id,
        tipo: 'ENTRADA', moneda: transferForm.moneda, monto,
        concepto:   `TRANSFERENCIA ← ${cajaOrigen.nombre.toUpperCase()} · ${conceptoUpper}`,
        referencia: `TRF-${genHash(transferId)}`, fecha: fechaISO,
        registrado_por: userRole,
        transfer_id: transferId, transfer_role: 'ENTRADA', transfer_peer_id: transferForm.caja_origen_id,
      }]);
      if (e2) {
        await supabase.from('movimientos_caja_chica').delete().eq('id', salidaId);
        throw new Error(`Entrada: ${e2.message}`);
      }

      const { error: e3 } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP',
        entidad_nombre: `REPOSICIÓN CAJA ${cajaOrigen.nombre.toUpperCase()}`,
        entidad_tipo: 'INTERNO', moneda: transferForm.moneda,
        monto_total: monto, monto_pendiente: monto,
        concepto:   `Reposición por transferencia a ${cajaDestino.nombre.toUpperCase()} · ${conceptoUpper}`,
        fecha_emision: fechaISO, estatus: 'PENDIENTE',
        notas: `Ref: TRF-${genHash(transferId)}`,
        transfer_id: transferId, categoria_interna: 'REPOSICION_CAJA',
      }]);
      if (e3) {
        await supabase.from('movimientos_caja_chica').delete().in('id', [salidaId, entradaId]);
        throw new Error(`Reposición: ${e3.message}`);
      }

      setTransferForm({ caja_origen_id:'', caja_destino_id:'', moneda:'USDT', monto:'', concepto:'', fecha: new Date().toISOString().split('T')[0] });
      setTransferModalOpen(false);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Error en transferencia.');
    } finally { setSavingTransfer(false); }
  };

  // ─── PAGO REPOSICIÓN ──────────────────────────────────────────────────────

  const openPagarReposicion = (cuenta: CuentaGeneral) => {
    setPagarReposicionMoneda(cuenta.moneda);
    setPagarReposicionModal(cuenta);
  };

  const confirmarPagoReposicion = async () => {
    if (!pagarReposicionModal) return;
    const cuenta = pagarReposicionModal;
    if (!cuenta.transfer_id) { alert('Sin transferencia asociada. Use flujo normal de CxP.'); return; }
    setSavingAction(cuenta.id);
    try {
      const salida    = movCajas.find(m => m.transfer_id === cuenta.transfer_id && m.transfer_role === 'SALIDA');
      if (!salida)    throw new Error('Movimiento original no encontrado.');
      const cajaOrig  = cajas.find(c => c.id === salida.caja_id);
      if (!cajaOrig)  throw new Error('Caja origen no encontrada.');

      await supabase.from('cuentas_generales').update({ estatus: 'PAGADO', monto_pendiente: 0 }).eq('id', cuenta.id);
      const { error: eE } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(), caja_id: cajaOrig.id,
        tipo: 'ENTRADA', moneda: pagarReposicionMoneda, monto: cuenta.monto_total,
        concepto:   `REPOSICIÓN DESDE BÓVEDA · ${cuenta.concepto}`,
        referencia: `REP-${genHash(cuenta.id)}`,
        fecha: new Date().toISOString(),
        registrado_por: userRole,
        transfer_id: cuenta.transfer_id,
      }]);
      if (eE) {
        await supabase.from('cuentas_generales').update({ estatus: 'PENDIENTE', monto_pendiente: cuenta.monto_total }).eq('id', cuenta.id);
        throw new Error(`Entrada a caja: ${eE.message}`);
      }
      await supabase.from('transacciones_finanzas').insert([{
        id: uuid4(), type: 'EXPENSE',
        entity_name: `REPOSICIÓN CAJA ${cajaOrig.nombre.toUpperCase()}`,
        amount: cuenta.monto_total, invoice_number: `REP-${genHash(cuenta.id)}`,
        description: `Reposición interna · ${cuenta.concepto}`,
        status: 'PAID', category: 'Reposición Interna',
        payment_method: pagarReposicionMoneda,
        issue_date: new Date().toISOString(),
      }]);

      setPagarReposicionModal(null);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally { setSavingAction(null); }
  };

  // ─── ELIMINAR TRANSFERENCIA ───────────────────────────────────────────────

  const openDeleteTransferModal = (transferId: string) => {
    const salida     = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'SALIDA') || null;
    const entrada    = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'ENTRADA') || null;
    const reposicion = cuentas.find(c => c.transfer_id === transferId && c.categoria_interna === 'REPOSICION_CAJA') || null;
    setDeleteTransferModal({
      transferId, salida, entrada, reposicion,
      cajaOrigenNombre:  cajas.find(c => c.id === salida?.caja_id)?.nombre  ?? '—',
      cajaDestinoNombre: cajas.find(c => c.id === entrada?.caja_id)?.nombre ?? '—',
    });
    setDeleteTransferSelection({ salida: !!salida, entrada: !!entrada, reposicion: !!reposicion });
  };

  const confirmDeleteTransferSelection = () => {
    if (!deleteTransferModal) return;
    const { salida, entrada, reposicion } = deleteTransferModal;
    const sel = deleteTransferSelection;
    requireDirectorCode(async () => {
      setSavingAction('transfer-delete');
      try {
        if (sel.salida    && salida)     { const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', salida.id);     if (error) throw new Error(error.message); }
        if (sel.entrada   && entrada)    { const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', entrada.id);    if (error) throw new Error(error.message); }
        if (sel.reposicion && reposicion){ const { error } = await supabase.from('cuentas_generales').delete().eq('id', reposicion.id);     if (error) throw new Error(error.message); }
        setDeleteTransferModal(null);
        fetchLockRef.current = false; await fetchAll(true);
      } catch (err) {
        alert('Error al eliminar: ' + (err instanceof Error ? err.message : String(err)));
      } finally { setSavingAction(null); }
    });
  };

  // ─── HANDLER: CUENTAS ─────────────────────────────────────────────────────

  const handleCuenta = async (e: React.FormEvent) => {
    e.preventDefault(); setCuentaError(null);

    if (cuentaForm.tipo === 'HORAS_PAGADAS' || cuentaForm.tipo === 'CXC') {
      const horas = parseFloat(cuentaForm.horas_prometidas);
      const monto = round2(parseFloat(cuentaForm.monto_total));
      if (!cuentaForm.alumno_student_id) { setCuentaError('Selecciona un alumno.'); return; }
      if (isNaN(horas) || horas <= 0)    { setCuentaError('Horas inválidas.'); return; }
      if (isNaN(monto) || monto <= 0)    { setCuentaError('Monto inválido.'); return; }
      if (!cuentaForm.concepto.trim())   { setCuentaError('Concepto requerido.'); return; }

      const alumno    = alumnos.find(a => a.student_id === cuentaForm.alumno_student_id);
      if (!alumno)    { setCuentaError('Alumno no encontrado.'); return; }
      const esPagado  = cuentaForm.tipo === 'HORAS_PAGADAS';

      setSavingCuenta(true);
      try {
        const { data, error } = await supabase.from('cuentas_por_cobrar').insert([{
          student_id: alumno.student_id, alumno_id: alumno.student_id,
          nombre_alumno: alumno.nombre, student_serial: alumno.serial,
          monto_total: monto, monto_pagado: esPagado ? monto : 0,
          monto_pendiente: esPagado ? 0 : monto,
          horas_prometidas: horas, horas_compradas: esPagado ? horas : 0,
          concepto:      cuentaForm.concepto.toUpperCase().trim(),
          fecha_emision: cuentaForm.fecha_emision,
          moneda: cuentaForm.moneda_pago,
          estatus: esPagado ? 'COBRADO' : 'PENDIENTE',
        }]).select('id').single();
        if (error) { setCuentaError(`Error: ${error.message}`); return; }

        if (esPagado) {
          if (!data?.id) throw new Error('No se obtuvo ID de la cuenta creada.');
          const { error: txError } = await supabase.from('transacciones_finanzas').insert([{
            id: uuid4(), type: 'INCOME', entity_id: alumno.student_id, entity_name: alumno.nombre,
            amount: monto, invoice_number: `HORA-${String(data.id)}`,
            description: `HORAS PAGADAS · ${cuentaForm.concepto.toUpperCase().trim()}`,
            status: 'PAID', category: 'Academia',
            payment_method: normalizePaymentMethod(cuentaForm.moneda_pago),
            issue_date: new Date(cuentaForm.fecha_emision).toISOString(),
          }]);
          if (txError) {
            await supabase.from('cuentas_por_cobrar').delete().eq('id', data.id);
            throw new Error(`Ingreso Ledger: ${txError.message}`);
          }
        }

        setCuentaForm(p => ({ ...p, alumno_student_id:'', horas_prometidas:'', monto_total:'', concepto:'' }));
        setShowCuentaForm(false);
        fetchLockRef.current = false; await fetchAll(true);
      } catch (err) {
        setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
      } finally { setSavingCuenta(false); }
      return;
    }

    // ── CXP ───────────────────────────────────────────────────────────────
    const num = round2(parseFloat(cuentaForm.monto_total));
    if (isNaN(num) || num <= 0)            { setCuentaError('Monto inválido.'); return; }
    if (!cuentaForm.entidad_nombre.trim()) { setCuentaError('Nombre de entidad requerido.'); return; }
    if (!cuentaForm.concepto.trim())       { setCuentaError('Concepto requerido.'); return; }
    setSavingCuenta(true);
    try {
      const { error } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP', entidad_nombre: cuentaForm.entidad_nombre.toUpperCase().trim(),
        entidad_tipo: cuentaForm.entidad_tipo,
        proveedor_id: cuentaForm.proveedor_id || null,
        moneda: cuentaForm.moneda, monto_total: num, monto_pendiente: num,
        concepto: cuentaForm.concepto.toUpperCase().trim(),
        fecha_emision: new Date(cuentaForm.fecha_emision).toISOString(),
        fecha_vencimiento: cuentaForm.fecha_vencimiento ? new Date(cuentaForm.fecha_vencimiento).toISOString() : null,
        estatus: 'PENDIENTE', notas: cuentaForm.notas || null,
      }]);
      if (error) { setCuentaError(`Error: ${error.message}`); return; }
      setCuentaForm(p => ({ ...p, entidad_nombre:'', concepto:'', monto_total:'', notas:'', proveedor_id:'', fecha_vencimiento:'' }));
      setShowCuentaForm(false);
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally { setSavingCuenta(false); }
  };

  const handlePagarCuenta = async (id: string, esCxC: boolean) => {
    if (savingAction) return;
    if (!esCxC) {
      const cuenta = cuentas.find(c => c.id === id);
      if (cuenta?.categoria_interna === 'REPOSICION_CAJA') { openPagarReposicion(cuenta); return; }
    }
    setSavingAction(id);
    try {
      if (esCxC) {
        const reg = cuentasCxC.find(c => c.id === id);
        if (!reg) return;
        const prev = { ...reg };
        const { error } = await supabase.from('cuentas_por_cobrar').update({
          estatus: 'COBRADO', monto_pagado: reg.monto_total, monto_pendiente: 0,
          horas_compradas: reg.horas_prometidas,
        }).eq('id', id);
        if (error) throw new Error(error.message);
        const inv = `CXC-${id}`;
        const { data: exists } = await supabase.from('transacciones_finanzas').select('id').eq('invoice_number', inv).limit(1);
        if (!exists?.length) {
          const { error: txErr } = await supabase.from('transacciones_finanzas').insert([{
            id: uuid4(), type: 'INCOME', entity_id: reg.student_id, entity_name: reg.nombre_alumno,
            amount: round2(Number(reg.monto_total) || 0), invoice_number: inv,
            description: `COBRO CXC · ${reg.concepto || 'CUENTA POR COBRAR'}`,
            status: 'PAID', category: 'Academia',
            payment_method: normalizePaymentMethod(reg.moneda),
            issue_date: new Date().toISOString(),
          }]);
          if (txErr) {
            await supabase.from('cuentas_por_cobrar').update({ estatus: prev.estatus, monto_pagado: prev.monto_pagado, monto_pendiente: prev.monto_pendiente, horas_compradas: prev.horas_compradas }).eq('id', id);
            throw new Error(`Ingreso Ledger: ${txErr.message}`);
          }
        }
      } else {
        await supabase.from('cuentas_generales').update({ estatus: 'PAGADO', monto_pendiente: 0 }).eq('id', id);
      }
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setCuentaError(err instanceof Error ? err.message : 'Error al registrar pago.');
    } finally { setSavingAction(null); }
  };

  // ─── REQUISICIONES ────────────────────────────────────────────────────────

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setReqError(null);
    const num = round2(parseFloat(reqAmount));
    if (!reqItems.trim() || isNaN(num) || num <= 0) { setReqError('Completa el detalle y el costo.'); return; }
    setSavingReq(true);
    try {
      const { error } = await supabase.from('solicitudes_compra').insert([{
        prioridad: reqPriority,
        items: JSON.stringify({ description: reqItems.toUpperCase(), estimated_cost: num }),
        estatus: 'PENDIENTE_REVISION',
        hash_auditoria: genHash(reqItems + reqAmount + Date.now()),
      }]);
      if (error) { setReqError(`Error: ${error.message}`); return; }
      setReqItems(''); setReqAmount('');
      fetchLockRef.current = false; await fetchAll(true);
    } catch (err) {
      setReqError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally { setSavingReq(false); }
  };

  const handleApproveReq = async (reqId: string, amount: number, desc: string) => {
    if (savingAction) return;
    setSavingAction(reqId);
    const hash = genHash('APPROVE' + reqId);
    try {
      await supabase.from('transacciones_finanzas').insert([{
        type: 'PAYABLE', entity_name: 'PROVEEDOR', amount: round2(amount),
        invoice_number: `OC-${hash}`, description: `[OK] ${desc}`,
        status: 'PENDING', category: 'Parts', payment_method: 'USDT',
        issue_date: new Date().toISOString(),
      }]);
      await supabase.from('solicitudes_compra').update({ estatus: 'APROBADO', aprobado_por: userRole }).eq('id', reqId);
      fetchLockRef.current = false; await fetchAll(true);
    } finally { setSavingAction(null); }
  };

  // ─── EXPORTS ──────────────────────────────────────────────────────────────

  const downloadCSV = (rows: string[][], filename: string) => {
    const csv = rows.map(r => r.join(',')).join('\n');
    const a   = document.createElement('a');
    a.href    = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = filename; a.click();
  };

  const handleExportCSV = () => downloadCSV([
    ['Fecha','Ref','Entidad','Metodo','Monto','Tipo','Estatus','Pata FX','Monto con signo'],   // [CHG v15]
    ...transactions.map(t => [
      fmtDate(t.issueDate), t.invoiceNumber, `"${t.entityName}"`, t.payment_method||'N/A',
      String(t.amount), String(t.type), t.status, t.fx_leg || '—', String(signedLedgerAmount(t)),
    ]),
  ], `FinanzasAguilas_${new Date().toISOString().split('T')[0]}.csv`);

  const handleExportCajaIndividual = (cajaId: string) => {
    const caja = cajas.find(c => c.id === cajaId); if (!caja) return;
    const movs = movCajas.filter(m => m.caja_id === cajaId);
    downloadCSV([
      [`CAJA: ${caja.nombre.toUpperCase()}`], [`Exportado: ${new Date().toLocaleDateString('es-VE')}`], [],
      ['Fecha','Tipo','Moneda','Monto','Concepto','Referencia','Por','Subcaja','Préstamo','Prestamista','FX'],
      ...movs.map(m => [fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2),
        `"${m.concepto||''}"`, `"${m.referencia||''}"`, m.registrado_por||'Sistema',
        m.subcaja||'—', m.es_prestamo?'SÍ':'NO', m.prestamista||'—', m.fx_id?'SÍ':'NO']),
    ], `Caja_${caja.nombre.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleExportCajasExcel = () => {
    const all: string[][] = [[`CAJAS CHICAS · ${new Date().toLocaleDateString('es-VE')}`], []];
    cajas.forEach(caja => {
      const movs = movCajas.filter(m => m.caja_id === caja.id);
      all.push([`CAJA: ${caja.nombre.toUpperCase()}`], ['Fecha','Tipo','Moneda','Monto','Concepto','Referencia','Subcaja','Prestamista','FX']);
      movs.forEach(m => all.push([fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2),
        `"${m.concepto||''}"`, `"${m.referencia||''}"`, m.subcaja||'—', m.prestamista||'—', m.fx_id?'SÍ':'NO']));
      all.push([]);
    });
    downloadCSV(all, `Cajas_${new Date().toISOString().split('T')[0]}.csv`);
  };

  // ─── CAJA EFECTIVO — datos para UI ────────────────────────────────────────

  const cajaEfectivo     = useMemo(() => cajas.find(c => getCajaConfig(c.nombre).esCajaEfectivo), [cajas]);
  const saldoEfectivoADM = useMemo(() => cajaEfectivo ? getSubcajaBalance(cajaEfectivo.id, 'ADM') : 0, [cajaEfectivo, getSubcajaBalance]);
  const saldoEfectivoCEO = useMemo(() => cajaEfectivo ? getSubcajaBalance(cajaEfectivo.id, 'CEO') : 0, [cajaEfectivo, getSubcajaBalance]);

  // ─── LOADING ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-20 text-center bg-[#020202] h-screen flex flex-col justify-center items-center">
      <Loader2 className="h-12 w-12 text-[#E1AD01] animate-spin mb-6" />
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core v15.0...</p>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">Valkyron Financial Core v15.0</p>
            <p className="text-[7px] text-[#E1AD01]/60 font-black uppercase tracking-[0.25em] mt-1">
              FX interconectado Caja ↔ Bóveda · Partida doble · Conciliación
            </p>
          </div>
          <button onClick={() => { fetchLockRef.current = false; fetchAll(true); }} title="Recargar" className="text-zinc-700 hover:text-[#E1AD01] transition-colors">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="flex flex-wrap gap-1 p-1.5 bg-black/60 rounded-2xl border border-white/5">
          {([
            { key: 'LEDGER',       label: 'Diario',  icon: Landmark      },
            { key: 'BÓVEDAS',      label: 'Bóvedas', icon: Coins         },
            { key: 'CAJAS',        label: 'Cajas',   icon: Banknote      },
            { key: 'CUENTAS',      label: 'CxC/CxP', icon: ReceiptText   },
            { key: 'REQUISITIONS', label: 'Reqs',    icon: FileSignature },
            { key: 'CLOSING',      label: 'Cierre',  icon: Lock          },
          ] as { key: TabType; label: string; icon: any }[]).map(t => {
            const Icon = t.icon; const active = activeTab === t.key;
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all
                            ${active ? 'bg-[#E1AD01] text-black shadow-lg' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI BÓVEDAS — [CHG v15] Ingresado/Egresado operativos + FX neto por separado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ALL_METHODS.map(m => {
          const paid  = transactions.filter(t => t.payment_method === m && t.status === 'PAID');
          const ing   = paid.filter(t => !isFxTx(t) && signedLedgerAmount(t) > 0).reduce((a, t) => round2(a + t.amount), 0);
          const egr   = paid.filter(t => !isFxTx(t) && signedLedgerAmount(t) < 0).reduce((a, t) => round2(a + t.amount), 0);
          const saldo = getVaultBalance(m);
          const fxNet = round2(saldo - ing + egr);
          const prefix = m === 'BS' ? 'Bs' : '$';
          const fmt = (n: number) => `${prefix} ${round2(n).toLocaleString('es-VE',{minimumFractionDigits:2})}`;
          return (
            <div key={m} className={`${glass} ${MONEDA_BG[m]} rounded-2xl p-5 border space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{m}</span>
                <span className={`text-[7px] font-black px-2 py-1 rounded-full border ${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`}>{saldo >= 0 ? 'POSITIVO' : 'NEGATIVO'}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Ingresado</p><p className="text-emerald-400 font-black text-[11px] italic">{fmt(ing)}</p></div>
                <div><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Egresado</p><p className="text-red-400 font-black text-[11px] italic">{fmt(egr)}</p></div>
                <div><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">FX neto</p><p className={`font-black text-[11px] italic ${fxNet >= 0 ? 'text-teal-400' : 'text-teal-600'}`}>{fxNet >= 0 ? '+' : '−'}{fmt(Math.abs(fxNet))}</p></div>
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
      {cajaEfectivo && (
        <div className={`${glass} bg-yellow-500/5 border border-yellow-500/20 rounded-2xl p-5`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                <Banknote className="text-yellow-400 h-4 w-4"/>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-yellow-400">Caja Efectivo — Trazabilidad</p>
                <p className="text-[8px] text-zinc-600 font-mono">Administración → Custodia CEO</p>
              </div>
            </div>
            <button onClick={() => setEntregaCEOModal(true)}
              className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-yellow-500/20 transition-all flex items-center gap-2">
              <ArrowLeftRight size={12}/> Entregar a CEO
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-black/30 rounded-xl p-4 border border-yellow-500/10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Stand-By · Administración</p>
              </div>
              <p className={`text-xl font-black italic ${saldoEfectivoADM >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fmtMonto(saldoEfectivoADM, 'CASH')}
              </p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">Pendiente de entrega a CEO</p>
            </div>
            <div className="bg-black/30 rounded-xl p-4 border border-yellow-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Custodia · CEO</p>
              </div>
              <p className={`text-xl font-black italic ${saldoEfectivoCEO >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fmtMonto(saldoEfectivoCEO, 'CASH')}
              </p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">En caja de los directores</p>
            </div>
          </div>
        </div>
      )}

      {/* KPI CUENTAS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={`${glass} bg-yellow-500/5 border border-yellow-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Por Cobrar (Alumnos)</p>
            <p className="text-yellow-400 font-black text-lg italic">${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
            <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{cxcPendientes.length} pendientes</p>
          </div>
          <ArrowUpCircle className="text-yellow-400/20 h-9 w-9" />
        </div>
        <div className={`${glass} bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Horas Acreditadas</p>
            <p className="text-emerald-400 font-black text-lg italic">{totalHorasAcred.toFixed(1)}h</p>
            <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{horasPagadas.length} pagados</p>
          </div>
          <Plane className="text-emerald-400/20 h-9 w-9" />
        </div>
        <div className={`${glass} bg-orange-500/5 border border-orange-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Por Pagar (Proveedores)</p>
            <p className="text-orange-400 font-black text-lg italic">${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
            <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{cuentasProveedores.filter(c=>c.estatus!=='PAGADO').length} pendientes</p>
          </div>
          <ArrowDownCircle className="text-orange-400/20 h-9 w-9" />
        </div>
        <div className={`${glass} bg-purple-500/5 border border-purple-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Reposiciones Internas</p>
            <p className="text-purple-400 font-black text-lg italic">${totalReposiciones.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
            <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{cuentasReposiciones.filter(c=>c.estatus!=='PAGADO').length} entre cajas</p>
          </div>
          <ArrowLeftRight className="text-purple-400/20 h-9 w-9" />
        </div>
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
              <input type="date" required value={ledger.fecha} onChange={e=>setLedger(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}} />
              <div className="grid grid-cols-2 gap-3">
                <select value={ledger.type}
                  onChange={e=>{
                    const v = e.target.value as TransactionType;
                    if (v === 'FX_EXCHANGE') { openFxDesk(ledger.currency); return; }   // [NEW v15]
                    setLedger(p=>({...p,type:v}));
                  }} className={inp}>
                  <option value="INCOME">INGRESO (+)</option>
                  <option value="EXPENSE">EGRESO (-)</option>
                  <option value="INSTRUCTOR_PAY">NÓMINA</option>
                  <option value="FX_EXCHANGE">FX CAMBIO → FX DESK</option>
                </select>
                <select value={ledger.currency} onChange={e=>setLedger(p=>({...p,currency:e.target.value as any}))} className={inp}>
                  <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option>
                  <option value="CASH">CASH</option><option value="BS">BS</option>
                </select>
              </div>
              {ledger.type === 'INSTRUCTOR_PAY' && (
                <select value={ledger.capitanId} onChange={e=>setLedger(p=>({...p,capitanId:e.target.value}))} className={inp}>
                  <option value="">— CAPITÁN —</option>
                  {capitanes.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#E1AD01] font-black text-xl">{ledger.currency==='BS'?'Bs':'$'}</span>
                <input type="number" step="0.01" min="0.01" required value={ledger.amount}
                  onChange={e=>setLedger(p=>({...p,amount:e.target.value}))}
                  onBlur={e=>{const n=parseFloat(e.target.value);if(!isNaN(n))setLedger(p=>({...p,amount:round2(n).toString()}));}}
                  className="w-full bg-white/5 border border-white/10 py-8 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                  placeholder="0.00" disabled={savingLedger} />
              </div>
              <input value={ledger.reference} onChange={e=>setLedger(p=>({...p,reference:e.target.value}))} placeholder="REFERENCIA / TRAZABILIDAD" className={inp} disabled={savingLedger} />
              <ErrorBanner msg={ledgerError} onClose={()=>setLedgerError(null)} />
              <button type="submit" disabled={savingLedger}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                {savingLedger ? <><Loader2 className="animate-spin h-4 w-4"/>Sellando...</> : 'Sellar Registro'}
              </button>
            </form>
          </div>
          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Libro Mayor</h3>
              <div className="flex gap-2">
                <button onClick={() => openFxDesk()}
                  className="bg-teal-500/10 text-teal-400 px-4 py-2 rounded-xl border border-teal-500/20 text-[9px] font-black uppercase hover:bg-teal-500/20 flex items-center gap-2 transition-all">
                  <TrendingUp size={11}/> FX Desk
                </button>
                <button onClick={handleExportCSV} className="bg-[#E1AD01]/10 text-[#E1AD01] px-4 py-2 rounded-xl border border-[#E1AD01]/20 text-[9px] font-black uppercase hover:bg-[#E1AD01] hover:text-black flex items-center gap-2 transition-all">
                  <Download size={11}/> CSV
                </button>
              </div>
            </div>

            {/* [CHG v15] FX recientes con ruta caja→caja y anulación */}
            {fxRegistros.length > 0 && (
              <div className="px-4 pt-4">
                <p className="text-[8px] text-teal-400 font-black uppercase tracking-widest mb-2 flex items-center gap-1">
                  <TrendingUp size={10}/> Operaciones FX recientes
                </p>
                <div className="space-y-1 max-h-[160px] overflow-y-auto">
                  {fxRegistros.slice(0,8).map(fx => {
                    const tienePatas = transactions.some(t => t.fx_id === fx.id && !!t.fx_leg);
                    return (
                      <div key={fx.id} className="bg-teal-500/5 border border-teal-500/10 p-3 rounded-xl flex justify-between items-center group">
                        <div className="min-w-0">
                          <p className="text-[9px] font-black uppercase text-teal-400 flex items-center gap-2">
                            {fx.moneda_origen} → {fx.moneda_destino}
                            {!tienePatas && <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">LEGACY · anular y re-registrar</span>}
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
                          <button onClick={() => anularFX(fx.id)} disabled={savingAction===fx.id} title="Anular FX completo"
                            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                            {savingAction===fx.id?<Loader2 size={13} className="animate-spin"/>:<Ban size={13}/>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2 mt-2">
              {transactions.map(t => {
                const s  = signedLedgerAmount(t);
                const fx = isFxTx(t);
                return (
                  <div key={t.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group hover:bg-white/[0.04] transition-all ${fx ? 'border-teal-500/15' : 'border-white/[0.05]'}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black uppercase truncate flex items-center gap-2">
                        {fx && <span className="text-[7px] font-black px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 shrink-0">FX {t.fx_leg ?? 'LEGACY'}</span>}
                        <span className="truncate">{t.entityName}</span>
                      </p>
                      <p className="text-[8px] text-zinc-600 font-mono mt-0.5">
                        {fmtDate(t.issueDate)} · {t.invoiceNumber} · <span className={MONEDA_COLOR[t.payment_method as PaymentMethod]||'text-zinc-500'}>{t.payment_method}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span className={`font-black text-lg italic ${fx ? (s >= 0 ? 'text-teal-300' : 'text-teal-600') : (s >= 0 ? 'text-emerald-400' : 'text-red-400')}`}>
                        {s >= 0 ? '+' : '-'}{fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                      </span>
                      <CheckCircle2 className={`h-4 w-4 shrink-0 ${t.status==='PAID'?'text-emerald-500/40':'text-zinc-700'}`}/>
                      {!t.fx_id && (
                        <button onClick={()=>openEditTx(t)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-[#E1AD01] transition-all p-1.5 rounded-lg hover:bg-[#E1AD01]/10">
                          <Pencil size={13}/>
                        </button>
                      )}
                      <button onClick={()=>deleteTxProtected(t.id)} disabled={savingAction===t.id || (!!t.fx_id && savingAction===t.fx_id)}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                        {savingAction===t.id?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                      </button>
                    </div>
                  </div>
                );
              })}
              {transactions.length === 0 && (
                <div className="text-center py-16 text-zinc-700">
                  <Activity className="h-8 w-8 mx-auto mb-3 opacity-20"/>
                  <p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos registrados</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: BÓVEDAS ════════════════════════════════════════════════════ */}
      {activeTab === 'BÓVEDAS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-6">
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 italic">
                <Wallet className="text-[#E1AD01] h-4 w-4"/> Bóvedas Principales
              </h3>
              <div className="space-y-3">
                {ALL_METHODS.map(curr => {
                  const bal = getVaultBalance(curr); const active = selectedVault===curr;
                  return (
                    <button key={curr} onClick={()=>setSelectedVault(curr)}
                      className={`w-full p-5 rounded-2xl flex justify-between items-center border transition-all ${active?`${MONEDA_BG[curr]} ${MONEDA_COLOR[curr]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white hover:bg-white/[0.04]'}`}>
                      <div className="flex items-center gap-3">
                        <Coins className={`h-4 w-4 ${active?'':'text-zinc-700'}`}/>
                        <span className="font-black uppercase tracking-widest text-[10px]">{curr}</span>
                      </div>
                      <span className={`font-mono font-black text-lg italic ${active?'':'text-zinc-400'}`}>{fmtMonto(bal, curr)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* [NEW v15] Conciliación Bóveda ↔ Cajas */}
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-2 flex items-center gap-2 italic">
                <Scale className="text-teal-400 h-4 w-4"/> Conciliación Bóveda ↔ Cajas
              </h3>
              <p className="text-[8px] text-zinc-600 font-mono mb-5">Bóveda = posición total por moneda. Cajas = dónde está físicamente. La diferencia es saldo aún no ubicado en una caja.</p>
              <div className="space-y-2">
                {conciliacion.map(({ m, boveda, enCajas, sinAsignar }) => (
                  <div key={m} className={`rounded-xl border p-3 ${MONEDA_BG[m]}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`text-[9px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                      <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${Math.abs(sinAsignar) <= 0.01 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-zinc-400'}`}>
                        {Math.abs(sinAsignar) <= 0.01 ? 'Cuadrado' : 'Sin ubicar'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[7px] text-zinc-600 font-black uppercase">Bóveda</p><p className="text-[10px] font-black italic">{fmtMonto(boveda, m)}</p></div>
                      <div><p className="text-[7px] text-zinc-600 font-black uppercase">En cajas</p><p className="text-[10px] font-black italic">{fmtMonto(enCajas, m)}</p></div>
                      <div><p className="text-[7px] text-zinc-600 font-black uppercase">Diferencia</p><p className={`text-[10px] font-black italic ${sinAsignar < -0.01 ? 'text-red-400' : ''}`}>{fmtMonto(sinAsignar, m)}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Auditoría Bóveda: <span className={MONEDA_COLOR[selectedVault]}>{selectedVault}</span></h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[720px] p-4 space-y-2">
              {transactions.filter(t=>t.payment_method===selectedVault).map(t=>{
                const s  = signedLedgerAmount(t);
                const fx = isFxTx(t);
                return (
                  <div key={t.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group ${fx ? 'border-teal-500/15' : 'border-white/[0.05]'}`}>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase flex items-center gap-2">
                        {fx && <span className="text-[7px] font-black px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 shrink-0">FX {t.fx_leg ?? 'LEGACY'}</span>}
                        <span className="truncate">{t.entityName}</span>
                      </p>
                      <p className="text-[8px] text-zinc-600 font-mono mt-0.5 truncate">{fmtDate(t.issueDate)} · {t.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-black text-lg italic ${fx ? (s >= 0 ? 'text-teal-300' : 'text-teal-600') : (s >= 0 ? 'text-emerald-400' : 'text-red-400')}`}>
                        {s >= 0 ? '+' : '-'}{fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                      </span>
                      <button onClick={()=>deleteTxProtected(t.id)} disabled={savingAction===t.id}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                        {savingAction===t.id?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CAJAS ══════════════════════════════════════════════════════ */}
      {activeTab === 'CAJAS' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
              {cajas.length} cajas operativas
            </p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>openFxDesk()}
                className="bg-teal-500/10 text-teal-400 border border-teal-500/20 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-500/20 transition-all flex items-center gap-2">
                <TrendingUp size={13}/> FX Desk
              </button>
              <button onClick={()=>setPrestamoModal(true)}
                className="bg-violet-500/10 text-violet-400 border border-violet-500/20 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-500/20 transition-all flex items-center gap-2">
                <HandCoins size={13}/> Préstamo Externo
              </button>
              <button onClick={()=>setTransferModalOpen(true)}
                className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-500/20 transition-all flex items-center gap-2">
                <ArrowLeftRight size={13}/> Transferir
              </button>
              <button onClick={handleExportCajasExcel} className="bg-emerald-500/10 text-emerald-400 px-5 py-3 rounded-xl border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all flex items-center gap-2">
                <Download size={12}/> Exportar
              </button>
            </div>
          </div>

          {/* Grid de cajas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cajas.map(caja => {
              const active     = cajaActiva === caja.id;
              const cajaConf   = getCajaConfig(caja.nombre);
              const monedas    = cajaConf.monedasPermitidas
                .map(m => ({ m, s: getCajaBalance(caja.id, m) }))
                .filter(x => x.s !== 0);
              const esCajaEfe  = cajaConf.esCajaEfectivo;

              return (
                <button key={caja.id} onClick={()=>toggleCajaActiva(caja)}
                  className={`${glass} rounded-2xl p-5 text-left border transition-all ${active?'border-[#E1AD01]/50 bg-[#E1AD01]/5':'border-white/[0.07] hover:border-white/20'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${active?'bg-[#E1AD01] text-black':'bg-white/5 text-zinc-600'}`}>
                      {esCajaEfe ? <Banknote size={15}/> : <Coins size={15}/>}
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {cajaConf.monedasPermitidas.length === 1 && (
                        <span className={`text-[7px] font-black px-2 py-0.5 rounded-full border ${MONEDA_BG[cajaConf.monedasPermitidas[0]]} ${MONEDA_COLOR[cajaConf.monedasPermitidas[0]]}`}>
                          {cajaConf.monedasPermitidas[0]} ONLY
                        </span>
                      )}
                      {active && <span className="text-[7px] text-[#E1AD01] font-black uppercase tracking-widest">Activa</span>}
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest mb-3">{caja.nombre}</p>

                  {esCajaEfe ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] text-blue-400 font-black uppercase flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-blue-400"/> ADM</span>
                        <span className={`text-[9px] font-black italic ${saldoEfectivoADM>=0?'text-yellow-400':'text-red-400'}`}>{fmtMonto(saldoEfectivoADM,'CASH')}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[8px] text-yellow-400 font-black uppercase flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-yellow-400"/> CEO</span>
                        <span className={`text-[9px] font-black italic ${saldoEfectivoCEO>=0?'text-yellow-400':'text-red-400'}`}>{fmtMonto(saldoEfectivoCEO,'CASH')}</span>
                      </div>
                    </div>
                  ) : monedas.length > 0 ? (
                    <div className="space-y-1.5">
                      {monedas.map(({m,s}) => (
                        <div key={m} className="flex justify-between items-center">
                          <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                          <span className={`text-[10px] font-black italic ${s>=0?MONEDA_COLOR[m]:'text-red-400'}`}>{fmtMonto(s,m)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-zinc-700 font-mono italic">Sin movimientos</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Panel de movimientos de caja activa */}
          {cajaActiva && (() => {
            const caja      = cajas.find(c => c.id === cajaActiva);
            if (!caja) return null;
            const cajaConf  = getCajaConfig(caja.nombre);
            const movs      = movCajas.filter(m => m.caja_id === cajaActiva);
            const esCajaEfe = cajaConf.esCajaEfectivo;
            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic">
                    Caja: <span className="text-[#E1AD01]">{caja.nombre}</span>
                  </h3>
                  <form onSubmit={handleMovCaja} className="space-y-4">
                    <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                      {(['ENTRADA','SALIDA'] as const).map(tipo => (
                        <button key={tipo} type="button" onClick={()=>setMovForm(p=>({...p,tipo}))}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${movForm.tipo===tipo?(tipo==='ENTRADA'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-red-500/20 text-red-400 border border-red-500/30'):'text-zinc-600 hover:text-zinc-400'}`}>
                          {tipo==='ENTRADA'?'+ Entrada':'- Salida'}
                        </button>
                      ))}
                    </div>

                    {esCajaEfe && (
                      <div>
                        <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Registrar en</label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(['ADM','CEO'] as SubcajaEfectivo[]).map(sc => (
                            <button key={sc} type="button" onClick={()=>setMovForm(p=>({...p,subcaja:sc}))}
                              className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${movForm.subcaja===sc?'bg-yellow-500/20 text-yellow-400 border-yellow-500/30':'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                              {sc==='ADM'?'📋 Administración':'🔐 CEO'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Moneda</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {cajaConf.monedasPermitidas.map(m => (
                          <button key={m} type="button" onClick={()=>setMovForm(p=>({...p,moneda:m}))}
                            className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${movForm.moneda===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <input type="date" required value={movForm.fecha} onChange={e=>setMovForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}} disabled={savingCaja}/>
                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl" style={{color:'#E1AD01'}}>{movForm.moneda==='BS'?'Bs':'$'}</span>
                      <input type="number" step="0.01" min="0.01" required value={movForm.monto}
                        onChange={e=>setMovForm(p=>({...p,monto:e.target.value}))}
                        onBlur={e=>{const n=parseFloat(e.target.value);if(!isNaN(n))setMovForm(p=>({...p,monto:round2(n).toString()}));}}
                        className="w-full bg-white/5 border border-white/10 py-7 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                        placeholder="0.00" disabled={savingCaja}/>
                    </div>
                    <input value={movForm.concepto} onChange={e=>setMovForm(p=>({...p,concepto:e.target.value}))} placeholder="CONCEPTO *" className={inp} disabled={savingCaja}/>
                    <input value={movForm.referencia} onChange={e=>setMovForm(p=>({...p,referencia:e.target.value}))} placeholder="REFERENCIA (opcional)" className={inp} disabled={savingCaja}/>
                    <ErrorBanner msg={cajaError} onClose={()=>setCajaError(null)}/>
                    <button type="submit" disabled={savingCaja}
                      className={`w-full py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${movForm.tipo==='ENTRADA'?'bg-emerald-500 text-black hover:bg-emerald-400':'bg-red-500 text-white hover:bg-red-400'}`}>
                      {savingCaja?<Loader2 className="animate-spin h-4 w-4"/>:movForm.tipo==='ENTRADA'?'+ Registrar Entrada':'- Registrar Salida'}
                    </button>
                  </form>
                </div>

                <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
                  <div className="p-6 border-b border-white/5">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[10px] font-black uppercase tracking-widest italic">Historial · {caja.nombre}</h3>
                      <button onClick={()=>handleExportCajaIndividual(caja.id)} className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-[8px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-1.5">
                        <Download size={10}/> Exportar
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {esCajaEfe ? (
                        <>
                          <div className={`px-3 py-1.5 rounded-xl border bg-blue-500/10 border-blue-500/20 flex items-center gap-2`}>
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400"/>
                            <span className="text-[8px] font-black uppercase text-blue-400">ADM</span>
                            <span className={`text-[10px] font-black italic ${saldoEfectivoADM>=0?'text-yellow-400':'text-red-400'}`}>{fmtMonto(saldoEfectivoADM,'CASH')}</span>
                          </div>
                          <div className={`px-3 py-1.5 rounded-xl border bg-yellow-500/10 border-yellow-500/20 flex items-center gap-2`}>
                            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400"/>
                            <span className="text-[8px] font-black uppercase text-yellow-400">CEO</span>
                            <span className={`text-[10px] font-black italic ${saldoEfectivoCEO>=0?'text-yellow-400':'text-red-400'}`}>{fmtMonto(saldoEfectivoCEO,'CASH')}</span>
                          </div>
                        </>
                      ) : (
                        cajaConf.monedasPermitidas.map(m => {
                          const s = getCajaBalance(caja.id, m);
                          const hasMov = movs.some(mv => mv.moneda === m);
                          if (!hasMov) return null;
                          return (
                            <div key={m} className={`px-3 py-1.5 rounded-xl border ${MONEDA_BG[m]} flex items-center gap-2`}>
                              <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                              <span className={`text-[10px] font-black italic ${s>=0?MONEDA_COLOR[m]:'text-red-400'}`}>{fmtMonto(s,m)}</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2">
                    {movs.map(m => {
                      const fxRec = m.fx_id ? fxRegistros.find(f => f.id === m.fx_id) : null;
                      const fxPeer = fxRec
                        ? (m.fx_role === 'SALIDA' || m.tipo === 'SALIDA'
                            ? `→ ${cajaNombre(fxRec.caja_destino_id)} · ${fmtMonto(fxRec.monto_destino, fxRec.moneda_destino)} @ ${fxRec.tasa}`
                            : `← ${cajaNombre(fxRec.caja_origen_id)} · ${fmtMonto(fxRec.monto_origen, fxRec.moneda_origen)} @ ${fxRec.tasa}`)
                        : null;
                      return (
                        <div key={m.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group ${m.transfer_id?'border-purple-500/20':m.es_prestamo?'border-violet-500/20':m.fx_id?'border-teal-500/20':'border-white/[0.05]'}`}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${MONEDA_BG[m.moneda]} ${MONEDA_COLOR[m.moneda]}`}>{m.moneda}</span>
                              {m.subcaja && (
                                <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full border ${m.subcaja==='CEO'?'bg-yellow-500/10 text-yellow-400 border-yellow-500/20':'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                  {m.subcaja}
                                </span>
                              )}
                              {m.transfer_id && <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1"><ArrowLeftRight size={8}/> Transferencia</span>}
                              {m.es_prestamo && <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 flex items-center gap-1"><HandCoins size={8}/> {m.prestamista}</span>}
                              {m.fx_id && <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center gap-1"><TrendingUp size={8}/> FX</span>}
                              <p className="text-[10px] font-black uppercase truncate">{m.concepto||'—'}</p>
                            </div>
                            <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(m.fecha)}{m.referencia?` · ${m.referencia}`:''}</p>
                            {fxPeer && <p className="text-[8px] text-teal-400/70 font-mono mt-0.5">{fxPeer}</p>}
                          </div>
                          <div className="flex items-center gap-3 ml-3">
                            <span className={`font-black text-base italic ${m.tipo==='ENTRADA'?'text-emerald-400':'text-red-400'}`}>{m.tipo==='ENTRADA'?'+':'-'}{fmtMonto(m.monto,m.moneda)}</span>
                            {!m.transfer_id && !m.fx_id && (
                              <button onClick={()=>openEditMov(m)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-[#E1AD01] transition-all p-1.5 rounded-lg hover:bg-[#E1AD01]/10">
                                <Pencil size={13}/>
                              </button>
                            )}
                            <button onClick={()=>deleteMovProtected(m.id)} disabled={savingAction===m.id || (!!m.fx_id && savingAction===m.fx_id)}
                              title={m.fx_id ? 'Anular FX completo' : 'Eliminar'}
                              className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                              {savingAction===m.id?<Loader2 size={13} className="animate-spin"/>:m.fx_id?<Ban size={13}/>:<Trash2 size={13}/>}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {movs.length===0 && (
                      <div className="text-center py-16 text-zinc-700">
                        <Banknote className="h-8 w-8 mx-auto mb-3 opacity-20"/>
                        <p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos en esta caja</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ TAB: CUENTAS ════════════════════════════════════════════════════ */}
      {activeTab === 'CUENTAS' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button onClick={()=>setShowCuentaForm(!showCuentaForm)}
              className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
              <PlusCircle size={14}/> Nuevo Registro
            </button>
          </div>

          {showCuentaForm && (
            <div className={`${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01] animate-in slide-in-from-top-4 duration-300`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
                <ReceiptText className="text-[#E1AD01] h-4 w-4"/> Registrar
              </h3>
              <form onSubmit={handleCuenta} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3 flex bg-black/50 rounded-2xl p-1 border border-white/10 gap-1">
                  {([
                    { key: 'HORAS_PAGADAS', label: '✓ Horas Pagadas',     hint: 'Alumno pagó ahora — acredita de inmediato' },
                    { key: 'CXC',           label: '⏳ Cuenta por Cobrar', hint: 'Alumno debe — queda pendiente' },
                    { key: 'CXP',           label: '↙ Cuenta por Pagar',  hint: 'Proveedor / gasto externo' },
                  ] as { key: FormTipo; label: string; hint: string }[]).map(({ key, label, hint }) => (
                    <button key={key} type="button" onClick={()=>setCuentaForm(p=>({...p,tipo:key}))}
                      className={`flex-1 py-3 px-4 rounded-xl transition-all text-left ${
                        cuentaForm.tipo===key
                          ? key==='HORAS_PAGADAS' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : key==='CXC'           ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                          :                         'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'text-zinc-600 hover:text-zinc-400'
                      }`}>
                      <p className="text-[10px] font-black uppercase">{label}</p>
                      <p className="text-[8px] opacity-60 mt-0.5 normal-case font-normal">{hint}</p>
                    </button>
                  ))}
                </div>

                {(cuentaForm.tipo === 'HORAS_PAGADAS' || cuentaForm.tipo === 'CXC') && (<>
                  <select required value={cuentaForm.alumno_student_id} onChange={e=>setCuentaForm(p=>({...p,alumno_student_id:e.target.value}))} className={inp}>
                    <option value="">— ALUMNO —</option>
                    {alumnos.map(a=><option key={a.student_id} value={a.student_id}>{a.nombre} · {a.sede}</option>)}
                  </select>
                  <input type="number" step="0.5" min="0.5" required value={cuentaForm.horas_prometidas}
                    onChange={e=>setCuentaForm(p=>({...p,horas_prometidas:e.target.value}))} placeholder="HORAS" className={inp}/>
                  <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total}
                    onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))}
                    onBlur={e=>{const n=parseFloat(e.target.value);if(!isNaN(n))setCuentaForm(p=>({...p,monto_total:round2(n).toString()}));}}
                    placeholder="MONTO ($)" className={inp}/>
                  <input required value={cuentaForm.concepto} onChange={e=>setCuentaForm(p=>({...p,concepto:e.target.value}))}
                    placeholder="CONCEPTO (ej: PAQUETE 10 HORAS)" className={`${inp} md:col-span-2`}/>
                  <input type="date" required value={cuentaForm.fecha_emision} onChange={e=>setCuentaForm(p=>({...p,fecha_emision:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
                  <div className="md:col-span-3">
                    <label className="text-[8px] text-zinc-500 font-black uppercase tracking-widest block mb-2">Método de Pago</label>
                    <div className="flex gap-2 flex-wrap">
                      {(['USD','USDT','ZELLE','CASH','BS'] as string[]).map(mp=>(
                        <button key={mp} type="button" onClick={()=>setCuentaForm(p=>({...p,moneda_pago:mp}))}
                          className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${
                            cuentaForm.moneda_pago===mp ? 'bg-[#E1AD01]/15 text-[#E1AD01] border-[#E1AD01]/30' : 'bg-white/[0.02] border-white/10 text-zinc-600 hover:text-zinc-400'
                          }`}>{mp}</button>
                      ))}
                    </div>
                  </div>
                </>)}

                {cuentaForm.tipo === 'CXP' && (<>
                  <select value={cuentaForm.moneda} onChange={e=>setCuentaForm(p=>({...p,moneda:e.target.value as any}))} className={inp}>
                    <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option>
                    <option value="CASH">CASH</option><option value="BS">BS</option>
                  </select>
                  <select value={cuentaForm.entidad_tipo} onChange={e=>setCuentaForm(p=>({...p,entidad_tipo:e.target.value,entidad_nombre:e.target.value==='PROVEEDOR'?'':p.entidad_nombre,proveedor_id:''}))} className={inp}>
                    <option value="LIBRE">Entidad Libre</option>
                    <option value="PROVEEDOR">Proveedor Registrado</option>
                  </select>
                  {cuentaForm.entidad_tipo==='PROVEEDOR'?(
                    <select required value={cuentaForm.proveedor_id} onChange={e=>{const v=vendors.find(v=>v.id===e.target.value);setCuentaForm(p=>({...p,proveedor_id:e.target.value,entidad_nombre:v?.name||''}));}} className={inp}>
                      <option value="">— PROVEEDOR —</option>
                      {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  ):(
                    <input required value={cuentaForm.entidad_nombre} onChange={e=>setCuentaForm(p=>({...p,entidad_nombre:e.target.value}))} placeholder="NOMBRE ENTIDAD" className={inp}/>
                  )}
                  <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total}
                    onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))} placeholder="MONTO" className={inp}/>
                  <input required value={cuentaForm.concepto} onChange={e=>setCuentaForm(p=>({...p,concepto:e.target.value}))} placeholder="CONCEPTO / DESCRIPCIÓN" className={inp}/>
                  <input type="date" required value={cuentaForm.fecha_emision} onChange={e=>setCuentaForm(p=>({...p,fecha_emision:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
                  <input type="date" value={cuentaForm.fecha_vencimiento} onChange={e=>setCuentaForm(p=>({...p,fecha_vencimiento:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
                  <input value={cuentaForm.notas||''} onChange={e=>setCuentaForm(p=>({...p,notas:e.target.value}))} placeholder="NOTAS (opcional)" className={inp}/>
                </>)}

                <ErrorBanner msg={cuentaError} onClose={()=>setCuentaError(null)}/>
                <div className="md:col-span-3 flex gap-3">
                  <button type="submit" disabled={savingCuenta}
                    className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                    {savingCuenta?<Loader2 className="animate-spin h-4 w-4"/>:<><ShieldCheck size={14}/> Sellar</>}
                  </button>
                  <button type="button" onClick={()=>{setShowCuentaForm(false);setCuentaError(null);}}
                    className="px-6 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* CxC Pendientes */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-yellow-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowUpCircle className="text-yellow-400 h-4 w-4"/> Por Cobrar
                  <span className="ml-auto font-mono text-yellow-400 text-[9px]">${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cxcPendientes.map(c=>(
                  <div key={c.id} className="bg-white/[0.02] border border-yellow-500/10 rounded-2xl p-4 group hover:bg-white/[0.04] transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase truncate">{c.nombre_alumno}</p>
                        <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                        <p className="text-[8px] text-yellow-400/70 font-mono mt-0.5">{c.horas_prometidas}h · {c.moneda||'USD'}</p>
                      </div>
                      <p className="font-black italic text-sm text-yellow-400 ml-2">${c.monto_pendiente.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={()=>handlePagarCuenta(c.id,true)} disabled={savingAction===c.id}
                        className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                        {savingAction===c.id?<Loader2 size={11} className="animate-spin"/>:<><CheckCircle2 size={11}/> Cobrado</>}
                      </button>
                      <button onClick={()=>deleteCuentaProtected(c.id,true)} disabled={savingAction===c.id}
                        className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  </div>
                ))}
                {cxcPendientes.length===0&&<div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin deudas pendientes</p></div>}
              </div>
            </div>

            {/* Horas Pagadas */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-emerald-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <Plane className="text-emerald-400 h-4 w-4"/> Horas Pagadas
                  <span className="ml-auto font-mono text-emerald-400 text-[9px]">{totalHorasAcred.toFixed(1)}h</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {horasPagadas.map(c=>(
                  <div key={c.id} className="bg-white/[0.02] border border-emerald-500/10 rounded-2xl p-4 group transition-all hover:bg-white/[0.04]">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase truncate">{c.nombre_alumno}</p>
                        <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                        <p className="text-[8px] text-emerald-400 font-mono mt-0.5 flex items-center gap-1">
                          <CheckCircle2 size={9}/> {c.horas_compradas}h
                        </p>
                      </div>
                      <p className="font-black italic text-sm text-emerald-400 ml-2">${c.monto_total.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                    </div>
                    <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={()=>deleteCuentaProtected(c.id,true)} disabled={savingAction===c.id}
                        className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30 text-[8px] font-black uppercase flex items-center gap-1">
                        <Trash2 size={11}/> Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {horasPagadas.length===0&&<div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin horas pagadas</p></div>}
              </div>
            </div>

            {/* CxP Proveedores */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-orange-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowDownCircle className="text-orange-400 h-4 w-4"/> Por Pagar
                  <span className="ml-auto font-mono text-orange-400 text-[9px]">${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentasProveedores.map(c=>(
                  <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all ${c.estatus==='PAGADO'?'border-emerald-500/10 opacity-50':'border-orange-500/10 hover:bg-white/[0.04]'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase truncate">{c.entidad_nombre}</p>
                        <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                        {c.fecha_vencimiento&&<p className="text-[8px] text-orange-400/70 font-mono mt-0.5">Vence: {fmtDate(c.fecha_vencimiento)}</p>}
                      </div>
                      <div className="text-right ml-2">
                        <p className={`font-black italic text-sm ${c.estatus==='PAGADO'?'text-emerald-400':'text-orange-400'}`}>{fmtMonto(c.monto_pendiente,c.moneda)}</p>
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${c.estatus==='PAGADO'?'bg-emerald-500/10 text-emerald-500':'bg-orange-500/10 text-orange-500'}`}>{c.estatus}</span>
                      </div>
                    </div>
                    {c.estatus!=='PAGADO'&&(
                      <div className="flex gap-2 mt-3">
                        <button onClick={()=>handlePagarCuenta(c.id,false)} disabled={savingAction===c.id}
                          className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                          {savingAction===c.id?<Loader2 size={11} className="animate-spin"/>:<><CheckCircle2 size={11}/> Pagado</>}
                        </button>
                        <button onClick={()=>deleteCuentaProtected(c.id,false)} disabled={savingAction===c.id}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {cuentasProveedores.length===0&&<div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por pagar</p></div>}
              </div>
            </div>

            {/* Reposiciones Internas */}
            <div className={`${glass} rounded-3xl overflow-hidden border-purple-500/10`}>
              <div className="p-5 border-b border-white/5 bg-purple-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowLeftRight className="text-purple-400 h-4 w-4"/> Reposiciones
                  <span className="ml-auto font-mono text-purple-400 text-[9px]">${totalReposiciones.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentasReposiciones.map(c=>{
                  const salida  = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'SALIDA');
                  const entrada = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'ENTRADA');
                  return (
                    <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all ${c.estatus==='PAGADO'?'border-emerald-500/10 opacity-60':'border-purple-500/10 hover:bg-white/[0.04]'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase truncate">{c.entidad_nombre}</p>
                          {salida && entrada && (
                            <p className="text-[8px] text-purple-400/80 font-mono flex items-center gap-1 mt-0.5">
                              {cajas.find(x=>x.id===salida.caja_id)?.nombre} <ArrowLeftRight size={8}/> {cajas.find(x=>x.id===entrada.caja_id)?.nombre}
                            </p>
                          )}
                          <p className="text-[8px] text-zinc-600 font-mono truncate mt-0.5">{c.concepto}</p>
                        </div>
                        <div className="text-right ml-2">
                          <p className={`font-black italic text-sm ${c.estatus==='PAGADO'?'text-emerald-400':'text-purple-400'}`}>{fmtMonto(c.monto_pendiente,c.moneda)}</p>
                          <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${c.estatus==='PAGADO'?'bg-emerald-500/10 text-emerald-500':'bg-purple-500/10 text-purple-400'}`}>
                            {c.estatus==='PAGADO'?'Repuesta':'Pendiente'}
                          </span>
                        </div>
                      </div>
                      {c.estatus!=='PAGADO'&&(
                        <div className="flex gap-2 mt-3">
                          <button onClick={()=>openPagarReposicion(c)} disabled={savingAction===c.id}
                            className="flex-1 py-2 bg-purple-500/20 text-purple-400 rounded-xl text-[9px] font-black uppercase border border-purple-500/20 hover:bg-purple-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                            {savingAction===c.id?<Loader2 size={11} className="animate-spin"/>:<><Repeat size={11}/> Reponer</>}
                          </button>
                          <button onClick={()=>deleteCuentaProtected(c.id,false)} disabled={savingAction===c.id}
                            className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                            <Trash2 size={12}/>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {cuentasReposiciones.length===0&&(
                  <div className="text-center py-12 text-zinc-700">
                    <ArrowLeftRight className="h-8 w-8 mx-auto mb-3 opacity-20"/>
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin reposiciones</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: REQUISICIONES ══════════════════════════════════════════════ */}
      {activeTab === 'REQUISITIONS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
              <FileSignature className="text-[#E1AD01] h-4 w-4"/> Nueva Requisición
            </h3>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <textarea required value={reqItems} onChange={e=>setReqItems(e.target.value)} rows={3}
                className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-xs font-mono outline-none focus:border-[#E1AD01] text-white uppercase placeholder:text-white/20 resize-none"
                placeholder="DETALLE OPERATIVO..." disabled={savingReq}/>
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" min="0.01" required value={reqAmount} onChange={e=>setReqAmount(e.target.value)} placeholder="COSTO ESTIMADO ($)" className={inp} disabled={savingReq}/>
                <select value={reqPriority} onChange={e=>setReqPriority(e.target.value)} className={inp} disabled={savingReq}>
                  <option value="BAJA">BAJA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="CRITICA">AOG — CRÍTICA</option>
                </select>
              </div>
              <ErrorBanner msg={reqError} onClose={()=>setReqError(null)}/>
              <button type="submit" disabled={savingReq}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {savingReq?<Loader2 className="animate-spin h-4 w-4"/>:'Sellar Requisición'}
              </button>
            </form>
          </div>
          <div className={`${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5"><h3 className="text-[10px] font-black uppercase tracking-widest italic">Aprobación</h3></div>
            <div className="flex-1 overflow-y-auto max-h-[480px] p-4 space-y-3">
              {requests.map(req=>{
                let item: any={};
                try{item=JSON.parse(req.items||'{}');}catch{}
                return(
                  <div key={req.id} className="bg-white/[0.02] border border-white/[0.05] p-5 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-[8px] font-black text-[#E1AD01] bg-[#E1AD01]/10 px-2 py-1 rounded-full tracking-widest">{req.nro_solicitud||'REQ'}</span>
                        <p className="text-[10px] font-mono uppercase mt-2">{item.description}</p>
                        <p className="text-[#E1AD01] text-xl font-black italic mt-1">${round2(Number(item.estimated_cost)||0).toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${req.prioridad==='CRITICA'?'bg-red-500/20 text-red-500':'bg-blue-500/20 text-blue-400'}`}>{req.prioridad}</span>
                    </div>
                    {req.estatus==='PENDIENTE_REVISION'&&(userRole==='CEO'||userRole==='ADMIN')?(
                      <div className="flex gap-2 border-t border-white/5 pt-3">
                        <button onClick={()=>handleApproveReq(req.id,Number(item.estimated_cost),item.description)} disabled={savingAction===req.id}
                          className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-[9px] font-black uppercase hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                          {savingAction===req.id?<Loader2 size={12} className="animate-spin"/>:'Aprobar'}
                        </button>
                        <button className="flex-1 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase hover:bg-red-500/20 transition-all">Rechazar</button>
                      </div>
                    ):(
                      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-zinc-600 italic pt-2 border-t border-white/5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-zinc-700"/> {req.estatus}
                      </div>
                    )}
                  </div>
                );
              })}
              {requests.length===0&&<div className="text-center py-16 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin requisiciones</p></div>}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CIERRE ═════════════════════════════════════════════════════ */}
      {activeTab === 'CLOSING' && (() => {
        const METODOS: { m: PaymentMethod; label: string; prefix: string }[] = [
          { m:'USDT',  label:'USDT (Crypto)',  prefix:'$'  },
          { m:'ZELLE', label:'Zelle (USD)',     prefix:'$'  },
          { m:'CASH',  label:'Efectivo (USD)',  prefix:'$'  },
          { m:'BS',    label:'Bolívares',       prefix:'Bs' },
        ];
        const handleCierre = () => {
          const disc: string[] = [];
          METODOS.forEach(({m,label,prefix}) => {
            const teorico = getVaultBalance(m);
            const fisico  = round2(parseFloat(physBalances[m])||0);
            const diff    = round2(Math.abs(teorico - fisico));
            if (diff > 0.01) disc.push(`${label}: ${prefix} ${diff.toFixed(2)} de diferencia`);
          });
          if (disc.length > 0) alert('⚠️ DISCREPANCIAS:\n\n' + disc.join('\n'));
          else { alert('✓ CIERRE CERTIFICADO — Todos los métodos cuadran.'); setPhysBalances({USDT:'',ZELLE:'',CASH:'',BS:''}); }
        };
        return (
          <div className="space-y-6">
            <div className={`${glass} rounded-2xl p-5 flex items-center justify-between`}>
              <div>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tasa BCV (Bs/USD)</p>
                <p className="text-[8px] text-zinc-700">Afecta display y es la tasa sugerida en FX Desk. BD guarda en moneda nativa.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#E1AD01] font-black font-mono">Bs</span>
                <input type="number" step="0.0001" min="1" value={tasaBCV}
                  onChange={e=>{const n=parseFloat(e.target.value);if(!isNaN(n)&&n>0)setTasaBCV(n);}}
                  className="w-28 bg-black/40 border border-[#E1AD01]/30 rounded-xl px-3 py-2 text-[#E1AD01] font-black font-mono text-sm text-center outline-none"/>
              </div>
            </div>
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="font-black text-[12px] uppercase tracking-widest mb-7 italic flex items-center gap-3">
                <Lock className="text-[#E1AD01] h-5 w-5"/> Cierre Multi-Moneda
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METODOS.map(({m,label,prefix}) => {
                  const teorico  = getVaultBalance(m);
                  const fisico   = round2(parseFloat(physBalances[m])||0);
                  const diff     = physBalances[m] !== '' ? round2(teorico - fisico) : null;
                  const cuadra   = diff !== null && Math.abs(diff) <= 0.01;
                  const descuadra= diff !== null && Math.abs(diff) > 0.01;
                  return (
                    <div key={m} className={`rounded-2xl border p-5 space-y-4 transition-all ${cuadra?'bg-emerald-500/5 border-emerald-500/20':descuadra?'bg-red-500/5 border-red-500/20':MONEDA_BG[m]}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{label}</span>
                        {cuadra    && <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase flex items-center gap-1"><CheckCircle2 size={10}/> Cuadrado</span>}
                        {descuadra && <span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-full uppercase">⚠ Dif. {prefix} {Math.abs(diff!).toFixed(2)}</span>}
                      </div>
                      <div className="bg-black/30 rounded-xl p-4 text-center">
                        <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Saldo Teórico</p>
                        <p className={`text-xl font-black italic font-mono ${MONEDA_COLOR[m]}`}>{prefix} {teorico.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                        {m==='BS'&&tasaBCV>0&&<p className="text-[8px] text-zinc-600 mt-1 font-mono">≈ ${round2(teorico/tasaBCV).toLocaleString('es-VE',{minimumFractionDigits:2})} USD @ {tasaBCV}</p>}
                      </div>
                      <div>
                        <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2 text-center">Conteo Físico</label>
                        <div className="relative">
                          <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${MONEDA_COLOR[m]}`}>{prefix}</span>
                          <input type="number" step="0.01" value={physBalances[m]}
                            onChange={e=>setPhysBalances(p=>({...p,[m]:e.target.value}))}
                            className={`w-full bg-black/50 border py-4 pl-10 pr-4 rounded-xl text-xl font-black italic outline-none text-center text-white transition-all ${cuadra?'border-emerald-500/50':descuadra?'border-red-500/50':'border-white/10 focus:border-[#E1AD01]'}`}
                            placeholder="0.00"/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={handleCierre} className="w-full py-5 bg-red-600 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-500 transition-all mt-5">
                <Lock className="h-4 w-4"/> Certificar Cierre Multi-Moneda
              </button>
            </div>
          </div>
        );
      })()}

      {/* ══ MODALES ══════════════════════════════════════════════════════════ */}

      {/* ── MODAL: ENTREGA ADM → CEO ─────────────────────────────────────── */}
      {entregaCEOModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-md rounded-3xl p-7 border-t-2 border-t-yellow-500`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                  <ArrowLeftRight className="text-yellow-400 h-5 w-5"/>
                </div>
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest">Entrega Efectivo a CEO</h3>
                  <p className="text-[8px] text-zinc-600 mt-1">Sale de ADM → Entra a CEO</p>
                </div>
              </div>
              <button onClick={()=>setEntregaCEOModal(false)} className="text-zinc-600 hover:text-white"><X size={18}/></button>
            </div>
            <div className="grid grid-cols-2 gap-4 bg-black/30 rounded-xl p-4 mb-4">
              <div className="text-center">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Stand-By ADM</p>
                <p className={`font-black italic ${saldoEfectivoADM>=0?'text-yellow-400':'text-red-400'}`}>{fmtMonto(saldoEfectivoADM,'CASH')}</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Custodia CEO</p>
                <p className="text-yellow-400 font-black italic">{fmtMonto(saldoEfectivoCEO,'CASH')}</p>
              </div>
            </div>
            <form onSubmit={handleEntregaCEO} className="space-y-4">
              <input type="date" required value={entregaCEOForm.fecha} onChange={e=>setEntregaCEOForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-yellow-400 font-black text-xl">$</span>
                <input type="number" step="0.01" min="0.01" required value={entregaCEOForm.monto}
                  onChange={e=>setEntregaCEOForm(p=>({...p,monto:e.target.value}))}
                  className="w-full bg-white/5 border border-white/10 py-6 pl-14 pr-6 rounded-2xl text-2xl font-black italic outline-none focus:border-yellow-500 text-white"
                  placeholder="0.00" disabled={savingCaja}/>
              </div>
              <input required value={entregaCEOForm.concepto} onChange={e=>setEntregaCEOForm(p=>({...p,concepto:e.target.value}))}
                placeholder="CONCEPTO (ej: COBRO PAQUETE 10H - CARLOS PÉREZ)" className={inp} disabled={savingCaja}/>
              <ErrorBanner msg={cajaError} onClose={()=>setCajaError(null)}/>
              <div className="flex gap-3">
                <button type="button" onClick={()=>setEntregaCEOModal(false)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={savingCaja} className="flex-[2] py-4 bg-yellow-500 text-black rounded-2xl text-[10px] font-black uppercase hover:bg-yellow-400 disabled:opacity-40 flex items-center justify-center gap-2">
                  {savingCaja?<Loader2 className="animate-spin h-4 w-4"/>:<><ArrowLeftRight size={14}/> Confirmar Entrega</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── [CHG v15] MODAL: FX DESK INTERCONECTADO ──────────────────────── */}
      {fxModalOpen && (() => {
        const cajasO = cajasQueAceptan(fxForm.moneda_origen);
        const cajasD = cajasQueAceptan(fxForm.moneda_destino);
        const cajaO  = cajas.find(c => c.id === fxForm.caja_origen_id)  ?? null;
        const cajaD  = cajas.find(c => c.id === fxForm.caja_destino_id) ?? null;
        const esEfeO = !!cajaO && getCajaConfig(cajaO.nombre).esCajaEfectivo;
        const esEfeD = !!cajaD && getCajaConfig(cajaD.nombre).esCajaEfectivo;
        const saldoBovedaO = getVaultBalance(fxForm.moneda_origen);
        const saldoCajaO   = cajaO ? (esEfeO ? getSubcajaBalance(cajaO.id, fxForm.subcaja_origen) : getCajaBalance(cajaO.id, fxForm.moneda_origen)) : null;
        const mo           = parseFloat(fxForm.monto_origen);
        const insufBoveda  = Number.isFinite(mo) && mo > saldoBovedaO;
        const insufCaja    = Number.isFinite(mo) && saldoCajaO !== null && mo > saldoCajaO;
        const involvesBS   = fxForm.moneda_origen === 'BS' || fxForm.moneda_destino === 'BS';
        const tasaLabel    = involvesBS ? 'Tasa (Bs por 1 USD)' : 'Factor neto (1 = sin comisión)';
        const cerrar = () => { setFxModalOpen(false); setFxError(null); };

        return (
          <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className={`${glass} w-full max-w-3xl rounded-3xl p-7 border-t-2 border-t-teal-500 max-h-[92vh] overflow-y-auto`}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                    <TrendingUp className="text-teal-400 h-5 w-5"/>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-widest">FX Desk — Cambio de moneda</h3>
                    <p className="text-[8px] text-zinc-600 mt-1">Sale de la bóveda/caja origen y entra a la bóveda/caja destino en una sola operación</p>
                  </div>
                </div>
                <button onClick={cerrar} className="text-zinc-600 hover:text-white"><X size={18}/></button>
              </div>

              <form onSubmit={handleFX} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* ORIGEN */}
                  <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.03] p-4 space-y-3">
                    <p className="text-[9px] text-red-400 font-black uppercase tracking-widest">Sale · moneda que vendes</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {ALL_METHODS.map(m=>(
                        <button key={m} type="button" onClick={()=>setFxMoneda('ORIGEN', m)}
                          disabled={m === fxForm.moneda_destino}
                          className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all disabled:opacity-20 ${fxForm.moneda_origen===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="text-[8px] text-zinc-500 font-black uppercase tracking-widest block mb-1.5">Caja de donde sale</label>
                      <select value={fxForm.caja_origen_id} onChange={e=>setFxForm(p=>({...p,caja_origen_id:e.target.value}))} className={inp}>
                        <option value="">SOLO BÓVEDA · no estaba en una caja</option>
                        {cajasO.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                    {esEfeO && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['ADM','CEO'] as SubcajaEfectivo[]).map(sc=>(
                          <button key={sc} type="button" onClick={()=>setFxForm(p=>({...p,subcaja_origen:sc}))}
                            className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${fxForm.subcaja_origen===sc?'bg-yellow-500/20 text-yellow-400 border-yellow-500/30':'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                            {sc==='ADM'?'Administración':'Custodia CEO'}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="text-[8px] font-mono space-y-0.5">
                      <p className={insufBoveda ? 'text-red-400' : 'text-zinc-500'}>Bóveda {fxForm.moneda_origen}: {fmtMonto(saldoBovedaO, fxForm.moneda_origen)}</p>
                      {saldoCajaO !== null && cajaO && (
                        <p className={insufCaja ? 'text-red-400' : 'text-zinc-500'}>{cajaO.nombre}{esEfeO ? ` (${fxForm.subcaja_origen})` : ''}: {fmtMonto(saldoCajaO, fxForm.moneda_origen)}</p>
                      )}
                    </div>
                  </div>

                  {/* DESTINO */}
                  <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4 space-y-3">
                    <p className="text-[9px] text-emerald-400 font-black uppercase tracking-widest">Entra · moneda que recibes</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {ALL_METHODS.map(m=>(
                        <button key={m} type="button" onClick={()=>setFxMoneda('DESTINO', m)}
                          disabled={m === fxForm.moneda_origen}
                          className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all disabled:opacity-20 ${fxForm.moneda_destino===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="text-[8px] text-zinc-500 font-black uppercase tracking-widest block mb-1.5">Caja donde entra</label>
                      <select value={fxForm.caja_destino_id} onChange={e=>setFxForm(p=>({...p,caja_destino_id:e.target.value}))} className={inp}>
                        <option value="">SOLO BÓVEDA · sin caja física</option>
                        {cajasD.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                    {esEfeD && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['ADM','CEO'] as SubcajaEfectivo[]).map(sc=>(
                          <button key={sc} type="button" onClick={()=>setFxForm(p=>({...p,subcaja_destino:sc}))}
                            className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${fxForm.subcaja_destino===sc?'bg-yellow-500/20 text-yellow-400 border-yellow-500/30':'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                            {sc==='ADM'?'Administración':'Custodia CEO'}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[8px] font-mono text-zinc-500">Bóveda {fxForm.moneda_destino}: {fmtMonto(getVaultBalance(fxForm.moneda_destino), fxForm.moneda_destino)}</p>
                  </div>
                </div>

                {/* Montos y tasa */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] text-teal-400 font-black uppercase tracking-widest block mb-2">Monto {fxForm.moneda_origen} que sale</label>
                    <div className="relative">
                      <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black ${MONEDA_COLOR[fxForm.moneda_origen]}`}>{fxForm.moneda_origen==='BS'?'Bs':'$'}</span>
                      <input type="number" step="0.01" min="0.01" required value={fxForm.monto_origen}
                        onChange={e=>setFxForm(p=>({...p,monto_origen:e.target.value}))}
                        onBlur={e=>{const n=parseFloat(e.target.value);if(!isNaN(n))setFxForm(p=>({...p,monto_origen:round2(n).toString()}));}}
                        className="w-full bg-black/50 border border-white/10 py-4 pl-10 pr-4 rounded-2xl text-xl font-black italic outline-none focus:border-teal-500 text-white"
                        placeholder="0.00"/>
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] text-teal-400 font-black uppercase tracking-widest block mb-2">{tasaLabel}</label>
                    <input type="number" step="0.0001" min="0.0001" required value={fxForm.tasa}
                      onChange={e=>setFxForm(p=>({...p,tasa:e.target.value}))}
                      className="w-full bg-black/50 border border-white/10 py-4 px-4 rounded-2xl text-xl font-black italic outline-none focus:border-teal-500 text-white"
                      placeholder={involvesBS ? String(tasaBCV) : '1'}/>
                    {involvesBS && (
                      <button type="button" onClick={()=>setFxForm(p=>({...p,tasa:String(tasaBCV)}))}
                        className="text-[8px] text-zinc-500 hover:text-teal-400 font-mono mt-1">Usar tasa BCV del sistema ({tasaBCV})</button>
                    )}
                  </div>
                </div>

                {/* Asientos que se generarán */}
                {fxMontoDestino !== null && (
                  <div className="bg-teal-500/5 border border-teal-500/20 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] text-teal-400 font-black uppercase tracking-widest">Recibes</p>
                      <p className={`text-xl font-black italic ${MONEDA_COLOR[fxForm.moneda_destino]}`}>{fmtMonto(fxMontoDestino, fxForm.moneda_destino)}</p>
                    </div>
                    <div className="border-t border-teal-500/10 pt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[9px] font-mono">
                      <p className="text-red-400">− {fmtMonto(Number.isFinite(mo) ? mo : 0, fxForm.moneda_origen)} · Bóveda {fxForm.moneda_origen}</p>
                      <p className="text-emerald-400">+ {fmtMonto(fxMontoDestino, fxForm.moneda_destino)} · Bóveda {fxForm.moneda_destino}</p>
                      <p className={cajaO ? 'text-red-400' : 'text-zinc-600'}>
                        {cajaO ? `− ${fmtMonto(Number.isFinite(mo) ? mo : 0, fxForm.moneda_origen)} · Caja ${cajaO.nombre}${esEfeO ? ` (${fxForm.subcaja_origen})` : ''}` : 'Sin movimiento de caja origen'}
                      </p>
                      <p className={cajaD ? 'text-emerald-400' : 'text-zinc-600'}>
                        {cajaD ? `+ ${fmtMonto(fxMontoDestino, fxForm.moneda_destino)} · Caja ${cajaD.nombre}${esEfeD ? ` (${fxForm.subcaja_destino})` : ''}` : 'Sin movimiento de caja destino'}
                      </p>
                    </div>
                    <p className="text-[8px] text-zinc-600 font-mono">No cuenta como ingreso ni egreso: solo cambia el valor de moneda.</p>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input required value={fxForm.concepto} onChange={e=>setFxForm(p=>({...p,concepto:e.target.value}))}
                    placeholder="CONCEPTO (ej: BS PARA NÓMINA INSTRUCTORES)" className={inp}/>
                  <input type="date" required value={fxForm.fecha} onChange={e=>setFxForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
                </div>

                <ErrorBanner msg={fxError} onClose={()=>setFxError(null)}/>
                <div className="flex gap-3">
                  <button type="button" onClick={cerrar} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
                  <button type="submit" disabled={savingFX || fxMontoDestino === null} className="flex-[2] py-4 bg-teal-500 text-black rounded-2xl text-[10px] font-black uppercase hover:bg-teal-400 disabled:opacity-40 flex items-center justify-center gap-2">
                    {savingFX?<Loader2 className="animate-spin h-4 w-4"/>:<><TrendingUp size={14}/> Registrar cambio</>}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL: PRÉSTAMO EXTERNO ──────────────────────────────────────── */}
      {prestamoModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-md rounded-3xl p-7 border-t-2 border-t-violet-500`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <HandCoins className="text-violet-400 h-5 w-5"/>
                </div>
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest">Préstamo Externo</h3>
                  <p className="text-[8px] text-zinc-600 mt-1">Becquer / Roberto ↔ Águilas</p>
                </div>
              </div>
              <button onClick={()=>setPrestamoModal(false)} className="text-zinc-600 hover:text-white"><X size={18}/></button>
            </div>
            <form onSubmit={handlePrestamo} className="space-y-4">
              <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                <button type="button" onClick={()=>setPrestamoForm(p=>({...p,es_devolucion:false}))}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${!prestamoForm.es_devolucion?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'text-zinc-600 hover:text-zinc-400'}`}>
                  + Préstamo a Águilas
                </button>
                <button type="button" onClick={()=>setPrestamoForm(p=>({...p,es_devolucion:true}))}
                  className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${prestamoForm.es_devolucion?'bg-red-500/20 text-red-400 border border-red-500/30':'text-zinc-600 hover:text-zinc-400'}`}>
                  - Devolución
                </button>
              </div>

              <div>
                <label className="text-[9px] text-violet-400 font-black uppercase tracking-widest block mb-2">Prestamista</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['BECQUER','ROBERTO'] as Prestamista[]).map(p=>(
                    <button key={p} type="button" onClick={()=>setPrestamoForm(prev=>({...prev,prestamista:p}))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${prestamoForm.prestamista===p?'bg-violet-500/20 text-violet-400 border-violet-500/30':'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <select required value={prestamoForm.caja_id} onChange={e=>setPrestamoForm(p=>({...p,caja_id:e.target.value}))} className={inp}>
                <option value="">— CAJA RECEPTORA —</option>
                {cajas.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>

              <div className="grid grid-cols-4 gap-2">
                {ALL_METHODS.map(m=>(
                  <button key={m} type="button" onClick={()=>setPrestamoForm(p=>({...p,moneda:m}))}
                    className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all ${prestamoForm.moneda===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                    {m}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-violet-400 font-black text-xl">{prestamoForm.moneda==='BS'?'Bs':'$'}</span>
                  <input type="number" step="0.01" min="0.01" required value={prestamoForm.monto}
                    onChange={e=>setPrestamoForm(p=>({...p,monto:e.target.value}))}
                    className="w-full bg-white/5 border border-white/10 py-5 pl-12 pr-4 rounded-2xl text-xl font-black italic outline-none focus:border-violet-500 text-white"
                    placeholder="0.00"/>
                </div>
                <input type="date" required value={prestamoForm.fecha} onChange={e=>setPrestamoForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              </div>

              <input required value={prestamoForm.concepto} onChange={e=>setPrestamoForm(p=>({...p,concepto:e.target.value}))}
                placeholder="CONCEPTO DEL PRÉSTAMO" className={inp}/>

              {!prestamoForm.es_devolucion && (
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                  <p className="text-[9px] text-violet-400 font-mono">
                    ℹ Se generará automáticamente una CxP de devolución para {prestamoForm.prestamista}.
                  </p>
                </div>
              )}

              <ErrorBanner msg={cajaError} onClose={()=>setCajaError(null)}/>
              <div className="flex gap-3">
                <button type="button" onClick={()=>setPrestamoModal(false)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={savingCaja} className="flex-[2] py-4 bg-violet-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-violet-400 disabled:opacity-40 flex items-center justify-center gap-2">
                  {savingCaja?<Loader2 className="animate-spin h-4 w-4"/>:<><HandCoins size={14}/> {prestamoForm.es_devolucion?'Registrar Devolución':'Registrar Préstamo'}</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: TRANSFERENCIA ENTRE CAJAS ─────────────────────────────── */}
      {transferModalOpen && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-2xl rounded-3xl p-7 border-t-2 border-t-purple-500`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <ArrowLeftRight className="text-purple-400 h-5 w-5"/>
                </div>
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-widest">Transferir entre Cajas</h3>
                  <p className="text-[8px] text-zinc-600 mt-1">Genera CxP de reposición automáticamente · misma moneda (para cambiar moneda use FX Desk)</p>
                </div>
              </div>
              <button onClick={()=>{setTransferModalOpen(false);setTransferError(null);}} className="text-zinc-600 hover:text-white"><X size={18}/></button>
            </div>
            <form onSubmit={handleTransferencia} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">Caja Origen</label>
                  <select required value={transferForm.caja_origen_id} onChange={e=>setTransferForm(p=>({...p,caja_origen_id:e.target.value}))} className={inp} disabled={savingTransfer}>
                    <option value="">— DE —</option>
                    {cajas.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  {transferForm.caja_origen_id && (
                    <p className="text-[8px] text-zinc-600 font-mono mt-1">
                      Saldo {transferForm.moneda}: {fmtMonto(getCajaBalance(transferForm.caja_origen_id, transferForm.moneda), transferForm.moneda)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">Caja Destino</label>
                  <select required value={transferForm.caja_destino_id} onChange={e=>setTransferForm(p=>({...p,caja_destino_id:e.target.value}))} className={inp} disabled={savingTransfer}>
                    <option value="">— A —</option>
                    {cajas.filter(c=>c.id!==transferForm.caja_origen_id).map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">Moneda</label>
                <div className="grid grid-cols-4 gap-2">
                  {ALL_METHODS.map(m=>(
                    <button key={m} type="button" onClick={()=>setTransferForm(p=>({...p,moneda:m}))}
                      className={`py-3 rounded-xl text-[10px] font-black uppercase border transition-all ${transferForm.moneda===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-purple-400 font-black text-xl">{transferForm.moneda==='BS'?'Bs':'$'}</span>
                  <input type="number" step="0.01" min="0.01" required value={transferForm.monto}
                    onChange={e=>setTransferForm(p=>({...p,monto:e.target.value}))}
                    className="w-full bg-white/5 border border-white/10 py-6 pl-14 pr-6 rounded-2xl text-2xl font-black italic outline-none focus:border-purple-500 text-white"
                    placeholder="0.00" disabled={savingTransfer}/>
                </div>
                <input type="date" required value={transferForm.fecha} onChange={e=>setTransferForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}} disabled={savingTransfer}/>
              </div>
              <input required value={transferForm.concepto} onChange={e=>setTransferForm(p=>({...p,concepto:e.target.value}))}
                placeholder="CONCEPTO" className={inp} disabled={savingTransfer}/>
              <ErrorBanner msg={transferError} onClose={()=>setTransferError(null)}/>
              <div className="flex gap-3">
                <button type="button" onClick={()=>{setTransferModalOpen(false);setTransferError(null);}} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={savingTransfer} className="flex-[2] py-4 bg-purple-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-purple-400 disabled:opacity-40 flex items-center justify-center gap-2">
                  {savingTransfer?<Loader2 className="animate-spin h-4 w-4"/>:<><ArrowLeftRight size={14}/> Ejecutar</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: PAGAR REPOSICIÓN ───────────────────────────────────────── */}
      {pagarReposicionModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-md rounded-3xl p-7 border-t-2 border-t-purple-500`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Repeat className="text-purple-400 h-5 w-5"/>
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Reponer a Caja</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Sale de Bóveda, entra a caja original</p>
              </div>
            </div>
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-4 mb-4">
              <p className="text-[9px] text-purple-400/80 font-mono">{pagarReposicionModal.entidad_nombre}</p>
              <p className="text-2xl font-black italic text-purple-400 mt-1">{fmtMonto(pagarReposicionModal.monto_total, pagarReposicionModal.moneda)}</p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">{pagarReposicionModal.concepto}</p>
            </div>
            <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">¿Desde qué Bóveda?</label>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {ALL_METHODS.map(m=>{
                const saldo = getVaultBalance(m);
                return (
                  <button key={m} type="button" onClick={()=>setPagarReposicionMoneda(m)}
                    className={`p-3 rounded-xl border text-left transition-all ${pagarReposicionMoneda===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white'}`}>
                    <p className="text-[9px] font-black uppercase">{m}</p>
                    <p className={`text-[10px] font-mono italic mt-1 ${saldo>=pagarReposicionModal.monto_total?'':'text-red-400'}`}>{fmtMonto(saldo,m)}</p>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setPagarReposicionModal(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={confirmarPagoReposicion} disabled={savingAction===pagarReposicionModal.id}
                className="flex-[2] py-4 bg-purple-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-purple-400 disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===pagarReposicionModal.id?<Loader2 className="animate-spin h-4 w-4"/>:<><CheckCircle2 size={14}/> Confirmar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: ELIMINAR TRANSFERENCIA ────────────────────────────────── */}
      {deleteTransferModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-lg rounded-3xl p-7 border-t-2 border-t-red-500`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 className="text-red-400 h-5 w-5"/>
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Eliminar Transferencia</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Selecciona qué registros eliminar</p>
              </div>
            </div>
            <div className="space-y-2 mb-6">
              {deleteTransferModal.salida && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.salida?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.salida} onChange={e=>setDeleteTransferSelection(p=>({...p,salida:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div>
                    <p className="text-[10px] font-black uppercase text-red-400">Salida de {deleteTransferModal.cajaOrigenNombre}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">-{fmtMonto(deleteTransferModal.salida.monto, deleteTransferModal.salida.moneda)}</p>
                  </div>
                </label>
              )}
              {deleteTransferModal.entrada && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.entrada?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.entrada} onChange={e=>setDeleteTransferSelection(p=>({...p,entrada:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div>
                    <p className="text-[10px] font-black uppercase text-emerald-400">Entrada a {deleteTransferModal.cajaDestinoNombre}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">+{fmtMonto(deleteTransferModal.entrada.monto, deleteTransferModal.entrada.moneda)}</p>
                  </div>
                </label>
              )}
              {deleteTransferModal.reposicion && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.reposicion?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.reposicion} onChange={e=>setDeleteTransferSelection(p=>({...p,reposicion:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div>
                    <p className="text-[10px] font-black uppercase text-purple-400">CxP Reposición ({deleteTransferModal.reposicion.estatus})</p>
                    <p className="text-[8px] text-zinc-600 font-mono">{fmtMonto(deleteTransferModal.reposicion.monto_total, deleteTransferModal.reposicion.moneda)}</p>
                  </div>
                </label>
              )}
            </div>
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-4">
              <p className="text-[9px] text-yellow-400 font-mono">⚠ Marcar los 3 elementos mantiene integridad contable.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={()=>setDeleteTransferModal(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={confirmDeleteTransferSelection}
                disabled={!deleteTransferSelection.salida && !deleteTransferSelection.entrada && !deleteTransferSelection.reposicion}
                className="flex-[2] py-4 bg-red-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-red-400 disabled:opacity-30 flex items-center justify-center gap-2">
                <Trash2 size={14}/> Eliminar Seleccionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CLAVE DEL DIRECTOR ─────────────────────────────────────── */}
      {directorAuthOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-sm rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-[#E1AD01]/10 border border-[#E1AD01]/20 flex items-center justify-center">
                <KeyRound className="text-[#E1AD01] h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Autorización Director</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Clave de 4 dígitos requerida.</p>
              </div>
            </div>
            <input autoFocus type="password" inputMode="numeric" maxLength={4}
              value={directorCode}
              onChange={e=>setDirectorCode(e.target.value.replace(/\D/g,'').slice(0,4))}
              onKeyDown={e=>{ if(e.key==='Enter') confirmDirectorCode(); }}
              placeholder="••••"
              className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-white text-2xl text-center font-black tracking-[0.6em] outline-none focus:border-[#E1AD01]"/>
            {directorAuthError && <p className="text-[9px] text-red-400 mt-3 text-center font-mono">{directorAuthError}</p>}
            <div className="flex gap-3 mt-5">
              <button onClick={cancelDirectorAuth} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={confirmDirectorCode} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl text-[9px] font-black uppercase hover:bg-white">Autorizar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDITAR LEDGER ─────────────────────────────────────────── */}
      {editingTx && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-2xl rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3"><Pencil className="text-[#E1AD01] h-4 w-4"/><h3 className="text-[10px] font-black uppercase tracking-widest">Editar Movimiento</h3></div>
              <button onClick={()=>setEditingTx(null)} className="text-zinc-600 hover:text-white"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select value={editTxForm.type} onChange={e=>setEditTxForm(p=>({...p,type:e.target.value as TransactionType}))} className={inp}>
                <option value="INCOME">INGRESO (+)</option><option value="EXPENSE">EGRESO (-)</option>
                <option value="INSTRUCTOR_PAY">NÓMINA</option><option value="PAYABLE">POR PAGAR</option>
                <option value="RECEIVABLE">POR COBRAR</option><option value="FX_EXCHANGE">FX CAMBIO (solo vía FX Desk)</option>
              </select>
              <select value={editTxForm.currency} onChange={e=>setEditTxForm(p=>({...p,currency:normalizePaymentMethod(e.target.value)}))} className={inp}>
                <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option>
                <option value="CASH">CASH</option><option value="BS">BS</option>
              </select>
              <input type="number" min="0.01" step="0.01" value={editTxForm.amount} onChange={e=>setEditTxForm(p=>({...p,amount:e.target.value}))} className={inp} placeholder="MONTO"/>
              <input type="date" value={editTxForm.fecha} onChange={e=>setEditTxForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              <textarea value={editTxForm.description} onChange={e=>setEditTxForm(p=>({...p,description:e.target.value}))} className="md:col-span-2 w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01] resize-none" rows={3} placeholder="DESCRIPCIÓN"/>
            </div>
            <div className="mt-4"><ErrorBanner msg={ledgerError} onClose={()=>setLedgerError(null)}/></div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditingTx(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={saveEditedTx} disabled={savingAction===editingTx.id} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl text-[9px] font-black uppercase hover:bg-white disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===editingTx.id?<Loader2 size={13} className="animate-spin"/>:<ShieldCheck size={13}/>} Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDITAR CAJA ───────────────────────────────────────────── */}
      {editingMov && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-2xl rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3"><Pencil className="text-[#E1AD01] h-4 w-4"/><h3 className="text-[10px] font-black uppercase tracking-widest">Editar Movimiento Caja</h3></div>
              <button onClick={()=>setEditingMov(null)} className="text-zinc-600 hover:text-white"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select value={editMovForm.tipo} onChange={e=>setEditMovForm(p=>({...p,tipo:e.target.value as any}))} className={inp}><option value="ENTRADA">+ ENTRADA</option><option value="SALIDA">- SALIDA</option></select>
              <select value={editMovForm.moneda} onChange={e=>setEditMovForm(p=>({...p,moneda:normalizePaymentMethod(e.target.value)}))} className={inp}>
                {getCajaConfig(cajas.find(c=>c.id===editingMov.caja_id)?.nombre ?? '').monedasPermitidas.map(m=>(
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <input type="number" min="0.01" step="0.01" value={editMovForm.monto} onChange={e=>setEditMovForm(p=>({...p,monto:e.target.value}))} className={inp} placeholder="MONTO"/>
              <input type="date" value={editMovForm.fecha} onChange={e=>setEditMovForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              <input value={editMovForm.concepto} onChange={e=>setEditMovForm(p=>({...p,concepto:e.target.value}))} className={inp} placeholder="CONCEPTO"/>
              <input value={editMovForm.referencia} onChange={e=>setEditMovForm(p=>({...p,referencia:e.target.value}))} className={inp} placeholder="REFERENCIA"/>
            </div>
            <div className="mt-4"><ErrorBanner msg={cajaError} onClose={()=>setCajaError(null)}/></div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditingMov(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={saveEditedMov} disabled={savingAction===editingMov.id} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl text-[9px] font-black uppercase hover:bg-white disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===editingMov.id?<Loader2 size={13} className="animate-spin"/>:<ShieldCheck size={13}/>} Guardar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
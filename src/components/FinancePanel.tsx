// VALKYRON FINANCIAL INTELLIGENCE CENTER v13.0 — INTERCONEXIÓN DE CAJAS
// NUEVO v13.0:
//   — Transferencia entre cajas: Roberto → Ederson genera 3 asientos vinculados
//     con transfer_id común: (1) salida caja origen, (2) entrada caja destino,
//     (3) CxP de reposición categorizada como REPOSICION_CAJA
//   — Card "Reposiciones Internas" separado en tab CUENTAS, distinto de CxP proveedores
//   — Al marcar reposición como PAGADA: se genera automáticamente entrada a la caja
//     original desde Bóveda + asiento EXPENSE en Ledger (afecta bóvedas globales)
//   — Modal de eliminación de transferencia muestra los 3 registros vinculados
//     y permite elegir cuáles borrar (protegido por clave del Director)
//   — Nuevo botón "⇄ Transferir entre cajas" en el toolbar de CAJAS
// PRESERVADO v12.0: HORAS_PAGADAS vs CxC, edición protegida, Ledger, Bóvedas,
//   Cajas, Requisiciones, Cierre Multi-Moneda, todos los fixes 1-7 previos.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  ArrowUpCircle, ArrowDownCircle, PlusCircle, X, Loader2,
  Wallet, UserCheck, ShieldCheck, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Activity, Trash2, Download, Coins, Banknote,
  AlertTriangle, RefreshCw, ReceiptText, Plane, Pencil, KeyRound,
  ArrowLeftRight, Repeat,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type PaymentMethod   = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE';
export type TabType         = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING';
type FormTipo               = 'CXC' | 'HORAS_PAGADAS' | 'CXP';

interface CajaChica      { id: string; nombre: string; }
interface MovimientoCaja {
  id: string; caja_id: string; tipo: 'ENTRADA' | 'SALIDA';
  moneda: PaymentMethod; monto: number;
  concepto: string; referencia: string; fecha: string; registrado_por: string;
  // v13.0 — trazabilidad de transferencia
  transfer_id?: string | null;
  transfer_role?: 'SALIDA' | 'ENTRADA' | null;
  transfer_peer_id?: string | null;
}
interface CuentaGeneral {
  id: string; tipo: 'CXC' | 'CXP'; entidad_nombre: string; entidad_tipo: string;
  proveedor_id?: string; moneda: PaymentMethod;
  monto_total: number; monto_pendiente: number; concepto: string;
  fecha_emision: string; fecha_vencimiento?: string;
  estatus: 'PENDIENTE' | 'PAGADO' | 'PARCIAL'; notas?: string;
  // v13.0 — vínculo con transferencia
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

// v13.0 — Estructura para el modal de eliminación de transferencia
interface TransferChain {
  transferId: string;
  salida: MovimientoCaja | null;
  entrada: MovimientoCaja | null;
  reposicion: CuentaGeneral | null;
  cajaOrigenNombre: string;
  cajaDestinoNombre: string;
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────

const glass = "bg-white/[0.02] backdrop-blur-[40px] border border-white/[0.07] shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inp   = "bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01]/60 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all w-full uppercase placeholder:text-white/20";

const DEFAULT_TASA_BS = 36.50;
const DIRECTOR_FINANCE_CODE = '4827';

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

const round2   = (n: number) => Math.round(n * 100) / 100;
const uuid4    = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
const genHash  = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
  return Math.abs(h).toString(16).padStart(8, '0').toUpperCase();
};
const fmtDate  = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d instanceof Date ? d.toISOString() : d);
  return new Date(dt.getTime() + dt.getTimezoneOffset() * 60000)
    .toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtMonto = (amount: number, moneda: PaymentMethod) => {
  const n = round2(amount);
  const s = n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'BS' ? `Bs ${s}` : `$${s}`;
};

// ─── ERROR BANNER ─────────────────────────────────────────────────────────────

const ErrorBanner: React.FC<{ msg: string | null; onClose: () => void }> = ({ msg, onClose }) => {
  if (!msg) return null;
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 animate-in slide-in-from-top-2 duration-300">
      <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
      <p className="text-[10px] text-red-400 flex-1 font-mono">{msg}</p>
      <button onClick={onClose} className="text-red-700 hover:text-red-400 transition-colors">
        <X size={12} />
      </button>
    </div>
  );
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export const FinancePanel: React.FC<FinancePanelProps> = ({
  vendors, inventory, userRole = 'CEO', setGlobalFinance = () => {},
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('LEDGER');
  const [tasaBCV,   setTasaBCV]   = useState(DEFAULT_TASA_BS);

  // Data
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [requests,     setRequests]     = useState<any[]>([]);
  const [cajas,        setCajas]        = useState<CajaChica[]>([]);
  const [movCajas,     setMovCajas]     = useState<MovimientoCaja[]>([]);
  const [cuentas,      setCuentas]      = useState<CuentaGeneral[]>([]);
  const [capitanes,    setCapitanes]    = useState<any[]>([]);
  const [alumnos,      setAlumnos]      = useState<AlumnoCxC[]>([]);
  const [cuentasCxC,   setCuentasCxC]   = useState<CuentaPorCobrar[]>([]);

  // UI
  const [loading,       setLoading]       = useState(true);
  const [selectedVault, setSelectedVault] = useState<PaymentMethod>('USDT');
  const [cajaActiva,    setCajaActiva]    = useState<string | null>(null);
  const fetchLockRef = useRef(false);

  // Errores
  const [ledgerError,  setLedgerError]  = useState<string | null>(null);
  const [cajaError,    setCajaError]    = useState<string | null>(null);
  const [cuentaError,  setCuentaError]  = useState<string | null>(null);
  const [reqError,     setReqError]     = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Saving locks
  const [savingLedger,   setSavingLedger]  = useState(false);
  const [savingCaja,     setSavingCaja]    = useState(false);
  const [savingCuenta,   setSavingCuenta]  = useState(false);
  const [savingReq,      setSavingReq]     = useState(false);
  const [savingTransfer, setSavingTransfer]= useState(false);
  const [savingAction,   setSavingAction]  = useState<string | null>(null);

  // Seguridad
  const [directorAuthOpen, setDirectorAuthOpen] = useState(false);
  const [directorCode, setDirectorCode] = useState('');
  const [directorAuthError, setDirectorAuthError] = useState<string | null>(null);
  const [pendingSecureAction, setPendingSecureAction] = useState<(() => Promise<void>) | null>(null);

  // Edición Ledger
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [editTxForm, setEditTxForm] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    description: '', fecha: new Date().toISOString().split('T')[0],
  });

  // Edición Caja
  const [editingMov, setEditingMov] = useState<MovimientoCaja | null>(null);
  const [editMovForm, setEditMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
  });

  // v13.0 — Transferencia entre cajas
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    caja_origen_id:  '',
    caja_destino_id: '',
    moneda:          'USDT' as PaymentMethod,
    monto:           '',
    concepto:        '',
    fecha:           new Date().toISOString().split('T')[0],
  });

  // v13.0 — Modal de eliminación de transferencia (selectivo)
  const [deleteTransferModal, setDeleteTransferModal] = useState<TransferChain | null>(null);
  const [deleteTransferSelection, setDeleteTransferSelection] = useState<{ salida: boolean; entrada: boolean; reposicion: boolean }>({
    salida: true, entrada: true, reposicion: true,
  });

  // v13.0 — Modal para elegir bóveda al pagar reposición
  const [pagarReposicionModal, setPagarReposicionModal] = useState<CuentaGeneral | null>(null);
  const [pagarReposicionMoneda, setPagarReposicionMoneda] = useState<PaymentMethod>('USDT');

  // Forms
  const [ledger, setLedger] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    reference: '', capitanId: '', fecha: new Date().toISOString().split('T')[0],
  });
  const [movForm, setMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
  });
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
  const [reqItems,    setReqItems]    = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount,   setReqAmount]   = useState('');
  const [physBalances, setPhysBalances] = useState<Record<PaymentMethod, string>>({ USDT:'', ZELLE:'', CASH:'', BS:'' });

  // ─── FETCH ────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (silent = false) => {
    if (fetchLockRef.current) return;
    fetchLockRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [txRes, reqRes, cajasRes, movRes, cuentasRes, capRes, alumnosRes, cxcRes] = await Promise.all([
        supabase.from('transacciones_finanzas').select('*').order('issue_date', { ascending: false }),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cajas_chicas').select('*').order('nombre'),
        supabase.from('movimientos_caja_chica').select('*').order('fecha', { ascending: false }),
        supabase.from('cuentas_generales').select('*').eq('tipo', 'CXP').order('fecha_emision', { ascending: false }),
        supabase.from('capitanes').select('*').order('nombre'),
        supabase.from('perfiles_estudiantes').select('id, nombre_completo, student_serial, sede').eq('role', 'student').order('nombre_completo'),
        supabase.from('cuentas_por_cobrar').select('*').order('fecha_emision', { ascending: false }),
      ]);
      if (txRes.data) setTransactions(txRes.data.map((t: any) => ({
        id: t.id, type: t.type, entityId: t.entity_id,
        entityName: t.entity_name || 'MOVIMIENTO',
        amount: round2(Number(t.amount) || 0),
        invoiceNumber: t.invoice_number || 'S/N',
        description: t.description || '', status: t.status || 'PENDING',
        issueDate: t.issue_date, category: t.category || 'General',
        payment_method: normalizePaymentMethod(t.payment_method),
      })));
      if (reqRes.data)     setRequests(reqRes.data);
      if (cajasRes.data)   setCajas(cajasRes.data);
      if (movRes.data)     setMovCajas(movRes.data.map((m: any) => ({
        ...m,
        monto: round2(Number(m.monto) || 0),
        transfer_id:      m.transfer_id       ?? null,
        transfer_role:    m.transfer_role     ?? null,
        transfer_peer_id: m.transfer_peer_id  ?? null,
      })));
      if (cuentasRes.data) setCuentas(cuentasRes.data.map((c: any) => ({
        ...c,
        monto_total:      round2(Number(c.monto_total) || 0),
        monto_pendiente:  round2(Number(c.monto_pendiente) || 0),
        transfer_id:      c.transfer_id       ?? null,
        categoria_interna:c.categoria_interna ?? null,
      })));
      if (capRes.data)     setCapitanes(capRes.data);
      if (alumnosRes.data) setAlumnos(alumnosRes.data.map((a: any) => ({
        student_id: a.id,
        nombre: a.nombre_completo || 'SIN NOMBRE',
        serial: a.student_serial || '—',
        sede: a.sede || '—',
      })));
      if (cxcRes.data) {
        const normalizedCxC = cxcRes.data.map((c: any) => ({
          ...c,
          monto_total:      round2(Number(c.monto_total) || 0),
          monto_pagado:     round2(Number(c.monto_pagado) || 0),
          monto_pendiente:  round2(Number(c.monto_pendiente) || 0),
          horas_prometidas: Number(c.horas_prometidas) || 0,
          horas_compradas:  Number(c.horas_compradas) || 0,
          moneda: normalizePaymentMethod(c.moneda),
        }));
        setCuentasCxC(normalizedCxC);
        await syncPaidAccountsToLedger(normalizedCxC);
      }
    } catch (e) {
      console.error('[FinancePanel v13.0] fetchAll error:', e);
    } finally {
      setLoading(false);
      fetchLockRef.current = false;
    }
  }, []);

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRealtimeChange = useCallback(() => {
    if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
    realtimeDebounce.current = setTimeout(() => fetchAll(true), 800);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
    const ch = supabase.channel('finance-v13-interconnect')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_finanzas' },  handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_compra' },       handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas_chicas' },             handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_caja_chica' },   handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_generales' },        handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_por_cobrar' },       handleRealtimeChange)
      .subscribe();
    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      supabase.removeChannel(ch);
    };
  }, [fetchAll, handleRealtimeChange]);

  // ─── MÉTRICAS ─────────────────────────────────────────────────────────────

  const getVaultBalance = useCallback((method: PaymentMethod) =>
    transactions
      .filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((acc, t) => {
        const plus = t.type === 'INCOME' || t.type === 'RECEIVABLE';
        return round2(plus ? acc + t.amount : acc - t.amount);
      }, 0),
  [transactions]);

  useEffect(() => {
    const totals = (['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).reduce((acc, method) => {
      acc[method] = getVaultBalance(method);
      return acc;
    }, { USDT: 0, ZELLE: 0, CASH: 0, BS: 0 } as {USDT:number;ZELLE:number;CASH:number;BS:number});
    setGlobalFinance(totals);
  }, [transactions, getVaultBalance, setGlobalFinance]);

  const getCajaBalance = useCallback((cajaId: string, moneda: PaymentMethod) =>
    movCajas
      .filter(m => m.caja_id === cajaId && m.moneda === moneda)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  const cxcPendientes   = useMemo(() => cuentasCxC.filter(c => c.estatus === 'PENDIENTE'),  [cuentasCxC]);
  const horasPagadas    = useMemo(() => cuentasCxC.filter(c => c.estatus === 'COBRADO'),    [cuentasCxC]);
  const totalCxC        = useMemo(() => cxcPendientes.reduce((a, c) => round2(a + c.monto_pendiente), 0), [cxcPendientes]);
  const totalHorasAcred = useMemo(() => horasPagadas.reduce((a, c) => a + c.horas_compradas, 0), [horasPagadas]);

  // v13.0 — separación de CxP: reposiciones internas vs proveedores externos
  const cuentasProveedores  = useMemo(() => cuentas.filter(c => c.categoria_interna !== 'REPOSICION_CAJA'), [cuentas]);
  const cuentasReposiciones = useMemo(() => cuentas.filter(c => c.categoria_interna === 'REPOSICION_CAJA'), [cuentas]);
  const totalCxP        = useMemo(() =>
    cuentasProveedores.filter(c => c.estatus !== 'PAGADO').reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentasProveedores]);
  const totalReposiciones = useMemo(() =>
    cuentasReposiciones.filter(c => c.estatus !== 'PAGADO').reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentasReposiciones]);

  // ─── SEGURIDAD ─────────────────────────────────────────────────────────────

  const canManageFinance = ['CEO', 'ADMIN', 'DIRECTOR'].includes(String(userRole).toUpperCase());

  const requireDirectorCode = useCallback((action: () => Promise<void>) => {
    if (!canManageFinance) {
      alert('Acceso denegado. Solo personal autorizado puede modificar este módulo.');
      return;
    }
    setDirectorCode('');
    setDirectorAuthError(null);
    setPendingSecureAction(() => action);
    setDirectorAuthOpen(true);
  }, [canManageFinance]);

  const confirmDirectorCode = async () => {
    if (!/^\d{4}$/.test(directorCode)) {
      setDirectorAuthError('La clave debe contener exactamente 4 dígitos.');
      return;
    }
    if (directorCode !== DIRECTOR_FINANCE_CODE) {
      setDirectorAuthError('Clave del Director incorrecta.');
      setDirectorCode('');
      return;
    }
    const action = pendingSecureAction;
    setDirectorAuthOpen(false);
    setDirectorCode('');
    setDirectorAuthError(null);
    setPendingSecureAction(null);
    if (action) {
      try { await action(); }
      catch (err) { console.error('[FinancePanel] acción protegida:', err); }
    }
  };

  const cancelDirectorAuth = () => {
    setDirectorAuthOpen(false);
    setDirectorCode('');
    setDirectorAuthError(null);
    setPendingSecureAction(null);
  };

  // ─── EDICIÓN LEDGER / CAJA ────────────────────────────────────────────────

  const openEditTx = (tx: FinanceTransaction) => {
    const d = tx.issueDate ? new Date(tx.issueDate) : new Date();
    setEditingTx(tx);
    setEditTxForm({
      amount: String(round2(Number(tx.amount) || 0)),
      currency: normalizePaymentMethod(tx.payment_method),
      type: tx.type as TransactionType,
      description: tx.description || '',
      fecha: Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0],
    });
  };

  const saveEditedTx = async () => {
    if (!editingTx) return;
    const amount = round2(parseFloat(editTxForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) { setLedgerError('Monto inválido.'); return; }
    setSavingAction(editingTx.id);
    try {
      const { error } = await supabase.from('transacciones_finanzas').update({
        amount,
        payment_method: editTxForm.currency,
        type: editTxForm.type,
        description: editTxForm.description.trim() || 'MOVIMIENTO EDITADO',
        issue_date: new Date(editTxForm.fecha).toISOString(),
      }).eq('id', editingTx.id);
      if (error) throw new Error(error.message);
      setEditingTx(null);
      await fetchAll(true);
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'No se pudo editar la transacción.');
    } finally {
      setSavingAction(null);
    }
  };

  const deleteTxProtected = (id: string) => requireDirectorCode(async () => {
    setSavingAction(id);
    try {
      const tx = transactions.find(t => t.id === id);
      const { error } = await supabase.from('transacciones_finanzas').delete().eq('id', id);
      if (error) throw new Error(error.message);
      if (tx?.invoiceNumber?.startsWith('CXC-') || tx?.invoiceNumber?.startsWith('HORA-')) {
        const cxcId = tx.invoiceNumber.replace(/^CXC-/, '').replace(/^HORA-/, '');
        await supabase.from('cuentas_por_cobrar').delete().eq('id', cxcId);
      }
      await fetchAll(true);
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'No se pudo eliminar la transacción.');
    } finally {
      setSavingAction(null);
    }
  });

  const openEditMov = (mov: MovimientoCaja) => {
    // v13.0 — no permitir editar movimientos que forman parte de una transferencia
    if (mov.transfer_id) {
      alert('Este movimiento forma parte de una transferencia entre cajas. Para modificarlo, elimine la transferencia completa y créela de nuevo.');
      return;
    }
    setEditingMov(mov);
    const d = new Date(mov.fecha);
    setEditMovForm({
      tipo: mov.tipo,
      moneda: normalizePaymentMethod(mov.moneda),
      monto: String(round2(Number(mov.monto) || 0)),
      concepto: mov.concepto || '',
      referencia: mov.referencia || '',
      fecha: Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0],
    });
  };

  const saveEditedMov = async () => {
    if (!editingMov) return;
    const monto = round2(parseFloat(editMovForm.monto));
    if (!Number.isFinite(monto) || monto <= 0) { setCajaError('Monto inválido.'); return; }
    if (!editMovForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    setSavingAction(editingMov.id);
    try {
      const { error } = await supabase.from('movimientos_caja_chica').update({
        tipo: editMovForm.tipo,
        moneda: editMovForm.moneda,
        monto,
        concepto: editMovForm.concepto.toUpperCase().trim(),
        referencia: editMovForm.referencia.toUpperCase().trim() || null,
        fecha: new Date(editMovForm.fecha).toISOString(),
      }).eq('id', editingMov.id);
      if (error) throw new Error(error.message);
      setEditingMov(null);
      await fetchAll(true);
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'No se pudo editar el movimiento de caja.');
    } finally {
      setSavingAction(null);
    }
  };

  // v13.0 — Al eliminar un movimiento vinculado a una transferencia, abrimos el modal selectivo
  const deleteMovProtected = (id: string) => {
    const mov = movCajas.find(m => m.id === id);
    if (mov?.transfer_id) {
      openDeleteTransferModal(mov.transfer_id);
      return;
    }
    requireDirectorCode(async () => {
      setSavingAction(id);
      try {
        const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', id);
        if (error) throw new Error(error.message);
        await fetchAll(true);
      } catch (err) {
        setCajaError(err instanceof Error ? err.message : 'No se pudo eliminar el movimiento de caja.');
      } finally {
        setSavingAction(null);
      }
    });
  };

  const deleteCuentaProtected = (id: string, esCxC: boolean) => {
    // v13.0 — si es reposición vinculada a transferencia, abrir modal selectivo
    if (!esCxC) {
      const cuenta = cuentas.find(c => c.id === id);
      if (cuenta?.transfer_id) {
        openDeleteTransferModal(cuenta.transfer_id);
        return;
      }
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
        await fetchAll(true);
      } catch (err) {
        setCuentaError(err instanceof Error ? err.message : 'No se pudo eliminar la cuenta.');
      } finally {
        setSavingAction(null);
      }
    });
  };

  // Sincroniza pagos históricos COBRADOS que no tengan asiento en el Ledger
  const syncPaidAccountsToLedger = useCallback(async (accounts: CuentaPorCobrar[]) => {
    const paid = accounts.filter(c => c.estatus === 'COBRADO' && Number(c.monto_total) > 0);
    if (!paid.length) return;
    for (const c of paid) {
      const invoiceNumber = `${c.horas_compradas > 0 ? 'HORA' : 'CXC'}-${c.id}`;
      const { data: exists, error: checkError } = await supabase
        .from('transacciones_finanzas').select('id').eq('invoice_number', invoiceNumber).limit(1);
      if (checkError || (exists && exists.length)) continue;
      await supabase.from('transacciones_finanzas').insert([{
        id: uuid4(), type: 'INCOME', entity_id: c.student_id,
        entity_name: c.nombre_alumno || 'ALUMNO',
        amount: round2(Number(c.monto_total) || 0), invoice_number: invoiceNumber,
        description: `${c.concepto || 'COBRO'} · SINCRONIZACIÓN HISTÓRICA`,
        status: 'PAID', category: 'Academia',
        payment_method: normalizePaymentMethod(c.moneda),
        issue_date: c.fecha_emision ? new Date(c.fecha_emision).toISOString() : new Date().toISOString(),
      }]);
    }
  }, []);

  // ─── HANDLER: LEDGER ──────────────────────────────────────────────────────

  const handleLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    setLedgerError(null);
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
        status: 'PAID',
        category: ledger.type === 'INSTRUCTOR_PAY' ? 'Nomina' : 'General',
        payment_method: ledger.currency,
        issue_date: new Date(ledger.fecha).toISOString(),
      }]);
      if (error) {
        setLedgerError(error.code === '23505' ? 'Duplicado detectado.' : `Error: ${error.message}`);
        return;
      }
      setLedger(p => ({ ...p, amount: '', reference: '' }));
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingLedger(false);
    }
  };

  // ─── HANDLER: CAJA ────────────────────────────────────────────────────────

  const handleMovCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setCajaError(null);
    if (!cajaActiva) { setCajaError('Selecciona una caja.'); return; }
    const num = round2(parseFloat(movForm.monto));
    if (isNaN(num) || num <= 0) { setCajaError('Monto inválido.'); return; }
    if (!movForm.concepto.trim()) { setCajaError('Concepto obligatorio.'); return; }
    setSavingCaja(true);
    try {
      const { error } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(), caja_id: cajaActiva, tipo: movForm.tipo, moneda: movForm.moneda,
        monto: num, concepto: movForm.concepto.toUpperCase().trim(),
        referencia: movForm.referencia.toUpperCase().trim() || null,
        fecha: new Date(movForm.fecha).toISOString(), registrado_por: userRole,
      }]);
      if (error) { setCajaError(`Error: ${error.message}`); return; }
      setMovForm(p => ({ ...p, monto: '', concepto: '', referencia: '' }));
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingCaja(false);
    }
  };

  // ─── HANDLER v13.0: TRANSFERENCIA ENTRE CAJAS ─────────────────────────────
  // Genera 3 asientos vinculados por transfer_id:
  //   1. movimientos_caja_chica: SALIDA de caja origen (transfer_role='SALIDA')
  //   2. movimientos_caja_chica: ENTRADA a caja destino (transfer_role='ENTRADA')
  //   3. cuentas_generales: CxP categoría REPOSICION_CAJA de Águilas → caja origen
  // Si cualquier paso falla, se hace rollback de los anteriores para mantener integridad.

  const handleTransferencia = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);

    if (!transferForm.caja_origen_id)  { setTransferError('Selecciona la caja de origen.'); return; }
    if (!transferForm.caja_destino_id) { setTransferError('Selecciona la caja de destino.'); return; }
    if (transferForm.caja_origen_id === transferForm.caja_destino_id) {
      setTransferError('La caja origen y destino no pueden ser la misma.');
      return;
    }
    const monto = round2(parseFloat(transferForm.monto));
    if (isNaN(monto) || monto <= 0) { setTransferError('Monto inválido.'); return; }
    if (!transferForm.concepto.trim()) { setTransferError('Concepto obligatorio.'); return; }

    const cajaOrigen  = cajas.find(c => c.id === transferForm.caja_origen_id);
    const cajaDestino = cajas.find(c => c.id === transferForm.caja_destino_id);
    if (!cajaOrigen || !cajaDestino) { setTransferError('Caja no encontrada.'); return; }

    // Verificar saldo disponible en caja origen
    const saldoOrigen = getCajaBalance(transferForm.caja_origen_id, transferForm.moneda);
    if (saldoOrigen < monto) {
      const confirmar = window.confirm(
        `⚠️ Saldo insuficiente en caja ${cajaOrigen.nombre}\n\n` +
        `Saldo disponible: ${fmtMonto(saldoOrigen, transferForm.moneda)}\n` +
        `Monto a transferir: ${fmtMonto(monto, transferForm.moneda)}\n\n` +
        `La caja quedará en negativo. ¿Continuar?`
      );
      if (!confirmar) return;
    }

    setSavingTransfer(true);
    const transferId = uuid4();
    const salidaId   = uuid4();
    const entradaId  = uuid4();
    const fechaISO   = new Date(transferForm.fecha).toISOString();
    const conceptoUpper = transferForm.concepto.toUpperCase().trim();

    try {
      // 1. SALIDA de caja origen
      const { error: errSalida } = await supabase.from('movimientos_caja_chica').insert([{
        id: salidaId,
        caja_id: transferForm.caja_origen_id,
        tipo: 'SALIDA',
        moneda: transferForm.moneda,
        monto,
        concepto: `TRANSFERENCIA → ${cajaDestino.nombre.toUpperCase()} · ${conceptoUpper}`,
        referencia: `TRF-${genHash(transferId)}`,
        fecha: fechaISO,
        registrado_por: userRole,
        transfer_id: transferId,
        transfer_role: 'SALIDA',
        transfer_peer_id: transferForm.caja_destino_id,
      }]);
      if (errSalida) throw new Error(`Salida: ${errSalida.message}`);

      // 2. ENTRADA a caja destino
      const { error: errEntrada } = await supabase.from('movimientos_caja_chica').insert([{
        id: entradaId,
        caja_id: transferForm.caja_destino_id,
        tipo: 'ENTRADA',
        moneda: transferForm.moneda,
        monto,
        concepto: `TRANSFERENCIA ← ${cajaOrigen.nombre.toUpperCase()} · ${conceptoUpper}`,
        referencia: `TRF-${genHash(transferId)}`,
        fecha: fechaISO,
        registrado_por: userRole,
        transfer_id: transferId,
        transfer_role: 'ENTRADA',
        transfer_peer_id: transferForm.caja_origen_id,
      }]);
      if (errEntrada) {
        // Rollback: eliminar salida
        await supabase.from('movimientos_caja_chica').delete().eq('id', salidaId);
        throw new Error(`Entrada: ${errEntrada.message}`);
      }

      // 3. CxP de reposición: Águilas debe a la caja origen
      const { error: errCxP } = await supabase.from('cuentas_generales').insert([{
        tipo: 'CXP',
        entidad_nombre: `REPOSICIÓN CAJA ${cajaOrigen.nombre.toUpperCase()}`,
        entidad_tipo: 'INTERNO',
        proveedor_id: null,
        moneda: transferForm.moneda,
        monto_total: monto,
        monto_pendiente: monto,
        concepto: `Reposición por transferencia a ${cajaDestino.nombre.toUpperCase()} · ${conceptoUpper}`,
        fecha_emision: fechaISO,
        fecha_vencimiento: null,
        estatus: 'PENDIENTE',
        notas: `Transferencia interna entre cajas · Ref: TRF-${genHash(transferId)}`,
        transfer_id: transferId,
        categoria_interna: 'REPOSICION_CAJA',
      }]);
      if (errCxP) {
        // Rollback: eliminar ambos movimientos
        await supabase.from('movimientos_caja_chica').delete().in('id', [salidaId, entradaId]);
        throw new Error(`Reposición: ${errCxP.message}`);
      }

      // Reset form + cerrar modal
      setTransferForm({
        caja_origen_id: '', caja_destino_id: '', moneda: 'USDT',
        monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0],
      });
      setTransferModalOpen(false);
      await fetchAll(true);

    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Error al procesar transferencia.');
    } finally {
      setSavingTransfer(false);
    }
  };

  // ─── v13.0: PAGO DE REPOSICIÓN ────────────────────────────────────────────
  // Al marcar una reposición como PAGADA:
  //   1. Marca la CxP como PAGADA
  //   2. Genera ENTRADA en la caja origen (el dinero regresa a la caja)
  //   3. Genera EXPENSE en Ledger (afecta bóveda global — sale de Bóveda principal)

  const openPagarReposicion = (cuenta: CuentaGeneral) => {
    setPagarReposicionMoneda(cuenta.moneda);
    setPagarReposicionModal(cuenta);
  };

  const confirmarPagoReposicion = async () => {
    if (!pagarReposicionModal) return;
    const cuenta = pagarReposicionModal;
    if (!cuenta.transfer_id) {
      alert('Esta reposición no tiene transferencia asociada. Use el flujo normal de CxP.');
      return;
    }
    setSavingAction(cuenta.id);
    try {
      // Buscar el movimiento SALIDA original para saber a qué caja debe regresar el dinero
      const salidaOriginal = movCajas.find(m => m.transfer_id === cuenta.transfer_id && m.transfer_role === 'SALIDA');
      if (!salidaOriginal) throw new Error('No se encontró el movimiento original de la transferencia.');

      const cajaOrigen = cajas.find(c => c.id === salidaOriginal.caja_id);
      if (!cajaOrigen) throw new Error('Caja origen no encontrada.');

      // 1. Marcar CxP como pagada
      const { error: errCxP } = await supabase.from('cuentas_generales').update({
        estatus: 'PAGADO', monto_pendiente: 0,
      }).eq('id', cuenta.id);
      if (errCxP) throw new Error(errCxP.message);

      // 2. Generar ENTRADA en la caja origen (reposición del dinero)
      const { error: errEntrada } = await supabase.from('movimientos_caja_chica').insert([{
        id: uuid4(),
        caja_id: cajaOrigen.id,
        tipo: 'ENTRADA',
        moneda: pagarReposicionMoneda,
        monto: cuenta.monto_total,
        concepto: `REPOSICIÓN DESDE BÓVEDA · ${cuenta.concepto}`,
        referencia: `REP-${genHash(cuenta.id)}`,
        fecha: new Date().toISOString(),
        registrado_por: userRole,
        transfer_id: cuenta.transfer_id,
        transfer_role: null,
        transfer_peer_id: null,
      }]);
      if (errEntrada) {
        // Rollback CxP
        await supabase.from('cuentas_generales').update({
          estatus: 'PENDIENTE', monto_pendiente: cuenta.monto_total,
        }).eq('id', cuenta.id);
        throw new Error(`Entrada a caja: ${errEntrada.message}`);
      }

      // 3. EXPENSE en Ledger — la Bóveda global pierde ese monto
      const { error: errTx } = await supabase.from('transacciones_finanzas').insert([{
        id: uuid4(),
        type: 'EXPENSE',
        entity_name: `REPOSICIÓN CAJA ${cajaOrigen.nombre.toUpperCase()}`,
        amount: cuenta.monto_total,
        invoice_number: `REP-${genHash(cuenta.id)}`,
        description: `Reposición interna · ${cuenta.concepto}`,
        status: 'PAID',
        category: 'Reposición Interna',
        payment_method: pagarReposicionMoneda,
        issue_date: new Date().toISOString(),
        transfer_id: cuenta.transfer_id,
      }]);
      if (errTx) {
        console.error('[v13.0] Fallo el asiento Ledger de reposición:', errTx.message);
        // No hacemos rollback aquí — la CxP y la entrada ya se hicieron; solo advertimos
        alert('⚠️ Reposición aplicada a caja, pero el asiento en Ledger falló. Verifique manualmente.');
      }

      setPagarReposicionModal(null);
      await fetchAll(true);

    } catch (err) {
      alert('Error al procesar pago de reposición: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingAction(null);
    }
  };

  // ─── v13.0: MODAL DE ELIMINACIÓN SELECTIVA DE TRANSFERENCIA ───────────────

  const openDeleteTransferModal = (transferId: string) => {
    const salida = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'SALIDA') || null;
    const entrada = movCajas.find(m => m.transfer_id === transferId && m.transfer_role === 'ENTRADA') || null;
    const reposicion = cuentas.find(c => c.transfer_id === transferId && c.categoria_interna === 'REPOSICION_CAJA') || null;

    const cajaOrigenNombre  = cajas.find(c => c.id === salida?.caja_id)?.nombre ?? '—';
    const cajaDestinoNombre = cajas.find(c => c.id === entrada?.caja_id)?.nombre ?? '—';

    setDeleteTransferModal({ transferId, salida, entrada, reposicion, cajaOrigenNombre, cajaDestinoNombre });
    setDeleteTransferSelection({ salida: !!salida, entrada: !!entrada, reposicion: !!reposicion });
  };

  const confirmDeleteTransferSelection = () => {
    if (!deleteTransferModal) return;
    const { salida, entrada, reposicion } = deleteTransferModal;
    const sel = deleteTransferSelection;

    requireDirectorCode(async () => {
      setSavingAction('transfer-delete');
      try {
        if (sel.salida && salida) {
          const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', salida.id);
          if (error) throw new Error(`Salida: ${error.message}`);
        }
        if (sel.entrada && entrada) {
          const { error } = await supabase.from('movimientos_caja_chica').delete().eq('id', entrada.id);
          if (error) throw new Error(`Entrada: ${error.message}`);
        }
        if (sel.reposicion && reposicion) {
          const { error } = await supabase.from('cuentas_generales').delete().eq('id', reposicion.id);
          if (error) throw new Error(`Reposición: ${error.message}`);
        }
        setDeleteTransferModal(null);
        await fetchAll(true);
      } catch (err) {
        alert('Error al eliminar: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setSavingAction(null);
      }
    });
  };

  // ─── HANDLER: CUENTA (3 tipos) ────────────────────────────────────────────

  const handleCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    setCuentaError(null);

    if (cuentaForm.tipo === 'HORAS_PAGADAS' || cuentaForm.tipo === 'CXC') {
      const horas = parseFloat(cuentaForm.horas_prometidas);
      const monto = round2(parseFloat(cuentaForm.monto_total));
      if (!cuentaForm.alumno_student_id) { setCuentaError('Selecciona un alumno.'); return; }
      if (isNaN(horas) || horas <= 0)    { setCuentaError('Horas inválidas.'); return; }
      if (isNaN(monto) || monto <= 0)    { setCuentaError('Monto inválido.'); return; }
      if (!cuentaForm.concepto.trim())   { setCuentaError('Concepto requerido.'); return; }

      const alumno = alumnos.find(a => a.student_id === cuentaForm.alumno_student_id);
      if (!alumno) { setCuentaError('Alumno no encontrado.'); return; }

      const esPagado = cuentaForm.tipo === 'HORAS_PAGADAS';

      setSavingCuenta(true);
      try {
        const { data, error } = await supabase.from('cuentas_por_cobrar').insert([{
          student_id: alumno.student_id, alumno_id: alumno.student_id,
          nombre_alumno: alumno.nombre, student_serial: alumno.serial,
          monto_total: monto, monto_pagado: esPagado ? monto : 0,
          monto_pendiente: esPagado ? 0 : monto,
          horas_prometidas: horas, horas_compradas: esPagado ? horas : 0,
          concepto: cuentaForm.concepto.toUpperCase().trim(),
          fecha_emision: cuentaForm.fecha_emision, moneda: cuentaForm.moneda_pago,
          estatus: esPagado ? 'COBRADO' : 'PENDIENTE',
        }]).select('id').single();
        if (error) { setCuentaError(`Error: ${error.message}`); return; }

        if (esPagado) {
          if (!data?.id) throw new Error('No se pudo obtener el ID de la cuenta creada.');
          const invoiceNumber = `HORA-${String(data.id)}`;
          const { error: txError } = await supabase.from('transacciones_finanzas').insert([{
            id: uuid4(), type: 'INCOME', entity_id: alumno.student_id, entity_name: alumno.nombre,
            amount: monto, invoice_number: invoiceNumber,
            description: `HORAS PAGADAS · ${cuentaForm.concepto.toUpperCase().trim()}`,
            status: 'PAID', category: 'Academia',
            payment_method: normalizePaymentMethod(cuentaForm.moneda_pago),
            issue_date: new Date(cuentaForm.fecha_emision).toISOString(),
          }]);
          if (txError) {
            await supabase.from('cuentas_por_cobrar').delete().eq('id', data?.id || '');
            throw new Error(`No se pudo registrar el ingreso: ${txError.message}`);
          }
        }

        setCuentaForm(p => ({ ...p, alumno_student_id: '', horas_prometidas: '', monto_total: '', concepto: '' }));
        setShowCuentaForm(false);
      } catch (err) {
        setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
      } finally {
        setSavingCuenta(false);
      }
      return;
    }

    // CXP
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
      setCuentaForm(p => ({ ...p, entidad_nombre: '', concepto: '', monto_total: '', notas: '', proveedor_id: '', fecha_vencimiento: '' }));
      setShowCuentaForm(false);
    } catch (err) {
      setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingCuenta(false);
    }
  };

  const handlePagarCuenta = async (id: string, esCxC: boolean) => {
    if (savingAction) return;

    // v13.0 — si es reposición interna, usar flujo especial con modal de bóveda
    if (!esCxC) {
      const cuenta = cuentas.find(c => c.id === id);
      if (cuenta?.categoria_interna === 'REPOSICION_CAJA') {
        openPagarReposicion(cuenta);
        return;
      }
    }

    setSavingAction(id);
    try {
      if (esCxC) {
        const reg = cuentasCxC.find(c => c.id === id);
        if (!reg) return;
        const previous = { ...reg };
        const { error } = await supabase.from('cuentas_por_cobrar').update({
          estatus: 'COBRADO', monto_pagado: reg.monto_total, monto_pendiente: 0,
          horas_compradas: reg.horas_prometidas,
        }).eq('id', id);
        if (error) throw new Error(error.message);
        const invoiceNumber = `CXC-${id}`;
        const { data: existingTx } = await supabase.from('transacciones_finanzas').select('id').eq('invoice_number', invoiceNumber).limit(1);
        if (!existingTx?.length) {
          const { error: txError } = await supabase.from('transacciones_finanzas').insert([{
            id: uuid4(), type: 'INCOME', entity_id: reg.student_id, entity_name: reg.nombre_alumno,
            amount: round2(Number(reg.monto_total) || 0), invoice_number: invoiceNumber,
            description: `COBRO CXC · ${reg.concepto || 'CUENTA POR COBRAR'}`,
            status: 'PAID', category: 'Academia',
            payment_method: normalizePaymentMethod(reg.moneda),
            issue_date: new Date().toISOString(),
          }]);
          if (txError) {
            await supabase.from('cuentas_por_cobrar').update({
              estatus: previous.estatus, monto_pagado: previous.monto_pagado,
              monto_pendiente: previous.monto_pendiente, horas_compradas: previous.horas_compradas,
            }).eq('id', id);
            throw new Error(`No se pudo registrar el ingreso: ${txError.message}`);
          }
        }
      } else {
        await supabase.from('cuentas_generales').update({ estatus: 'PAGADO', monto_pendiente: 0 }).eq('id', id);
      }
    } finally { setSavingAction(null); }
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError(null);
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
    } finally { setSavingAction(null); }
  };

  // ─── EXPORTS ──────────────────────────────────────────────────────────────

  const handleExportCSV = () => {
    const rows = transactions.map(t => [fmtDate(t.issueDate), t.invoiceNumber, `"${t.entityName}"`, t.payment_method || 'N/A', t.amount, t.type, t.status]);
    const csv  = [['Fecha','Ref','Entidad','Metodo','Monto','Tipo','Estatus'].join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `FinanzasAguilas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportCajaIndividual = (cajaId: string) => {
    const caja = cajas.find(c => c.id === cajaId);
    if (!caja) return;
    const movs = movCajas.filter(m => m.caja_id === cajaId);
    const rows = [`CAJA: ${caja.nombre.toUpperCase()}`, `Exportado: ${new Date().toLocaleDateString('es-VE')}`, '',
      'Fecha,Tipo,Moneda,Monto,Concepto,Referencia,Por',
      ...movs.map(m => [fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2),
        `"${m.concepto||''}"`, `"${m.referencia||''}"`, m.registrado_por||'Sistema'].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Caja_${caja.nombre.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportCajasExcel = () => {
    const all: string[] = [`CAJAS CHICAS · ${new Date().toLocaleDateString('es-VE')}`, ''];
    cajas.forEach(caja => {
      const movs = movCajas.filter(m => m.caja_id === caja.id);
      all.push(`CAJA: ${caja.nombre.toUpperCase()}`, 'Fecha,Tipo,Moneda,Monto,Concepto,Referencia');
      movs.forEach(m => all.push([fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2),
        `"${m.concepto||''}"`, `"${m.referencia||''}"`].join(',')));
      all.push('');
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + all.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Cajas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // ─── LOADING ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="p-20 text-center bg-[#020202] h-screen flex flex-col justify-center items-center">
      <Loader2 className="h-12 w-12 text-[#E1AD01] animate-spin mb-6" />
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core v13.0...</p>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">Valkyron Financial Core v13.0</p>
            <p className="text-[7px] text-[#E1AD01]/60 font-black uppercase tracking-[0.25em] mt-1">Interconexión de Cajas · Edición/Eliminación: clave del Director</p>
          </div>
          <button onClick={() => fetchAll(true)} title="Recargar" className="text-zinc-700 hover:text-[#E1AD01] transition-colors">
            <RefreshCw size={12} className={fetchLockRef.current ? 'animate-spin' : ''} />
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

      {/* KPI STRIP BÓVEDAS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
          const ing   = transactions.filter(t=>t.payment_method===m&&t.status==='PAID'&&(t.type==='INCOME'||t.type==='RECEIVABLE')).reduce((a,t)=>round2(a+t.amount),0);
          const egr   = transactions.filter(t=>t.payment_method===m&&t.status==='PAID'&&(t.type==='EXPENSE'||t.type==='PAYABLE'||t.type==='INSTRUCTOR_PAY')).reduce((a,t)=>round2(a+t.amount),0);
          const saldo = round2(ing - egr);
          const prefix = m === 'BS' ? 'Bs' : '$';
          const fmt = (n: number) => `${prefix} ${round2(n).toLocaleString('es-VE',{minimumFractionDigits:2})}`;
          return (
            <div key={m} className={`${glass} ${MONEDA_BG[m]} rounded-2xl p-5 border space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{m}</span>
                <span className={`text-[7px] font-black px-2 py-1 rounded-full border ${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`}>{saldo >= 0 ? 'POSITIVO' : 'NEGATIVO'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Ingresado</p><p className="text-emerald-400 font-black text-xs italic">{fmt(ing)}</p></div>
                <div><p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Egresado</p><p className="text-red-400 font-black text-xs italic">{fmt(egr)}</p></div>
              </div>
              <div className="border-t border-white/5 pt-2 text-center">
                <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Saldo Neto</p>
                <p className={`font-black text-base italic ${saldo >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>{fmt(saldo)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* KPI CUENTAS — v13.0: 4 métricas incluyendo Reposiciones */}
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
                <select value={ledger.type} onChange={e=>setLedger(p=>({...p,type:e.target.value as any}))} className={inp}>
                  <option value="INCOME">INGRESO (+)</option>
                  <option value="EXPENSE">EGRESO (-)</option>
                  <option value="INSTRUCTOR_PAY">NÓMINA</option>
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
              <button onClick={handleExportCSV} className="bg-[#E1AD01]/10 text-[#E1AD01] px-4 py-2 rounded-xl border border-[#E1AD01]/20 text-[9px] font-black uppercase hover:bg-[#E1AD01] hover:text-black flex items-center gap-2 transition-all">
                <Download size={11}/> CSV
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[520px] p-4 space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group hover:bg-white/[0.04] transition-all">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase truncate">{t.entityName}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">
                      {fmtDate(t.issueDate)} · {t.invoiceNumber} · <span className={MONEDA_COLOR[t.payment_method as PaymentMethod]||'text-zinc-500'}>{t.payment_method}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE')?'text-emerald-400':'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE')?'+':'-'}{fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                    </span>
                    {t.status==='PAID'?<CheckCircle2 className="h-4 w-4 text-emerald-500/40 shrink-0"/>:<Loader2 className="h-4 w-4 text-[#E1AD01] animate-spin shrink-0"/>}
                    <button onClick={()=>openEditTx(t)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-[#E1AD01] transition-all p-1.5 rounded-lg hover:bg-[#E1AD01]/10">
                      <Pencil size={13}/>
                    </button>
                    <button onClick={()=>deleteTxProtected(t.id)} disabled={savingAction===t.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                      {savingAction===t.id?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                    </button>
                  </div>
                </div>
              ))}
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
          <div className={`lg:col-span-4 ${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 italic">
              <Wallet className="text-[#E1AD01] h-4 w-4"/> Bóvedas Principales
            </h3>
            <div className="space-y-3">
              {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(curr => {
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
          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Auditoría Bóveda: <span className={MONEDA_COLOR[selectedVault]}>{selectedVault}</span></h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[520px] p-4 space-y-2">
              {transactions.filter(t=>t.payment_method===selectedVault).map(t=>(
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group">
                  <div>
                    <p className="text-[10px] font-black uppercase">{t.entityName}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{fmtDate(t.issueDate)} · {t.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE')?'text-emerald-400':'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE')?'+':'-'}{fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                    </span>
                    <button onClick={()=>deleteTxProtected(t.id)} disabled={savingAction===t.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                      {savingAction===t.id?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                    </button>
                  </div>
                </div>
              ))}
              {transactions.filter(t=>t.payment_method===selectedVault).length===0&&(
                <div className="text-center py-16 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos en {selectedVault}</p></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CAJAS — v13.0 con Transferencia ════════════════════════════ */}
      {activeTab === 'CAJAS' && (
        <div className="space-y-6">

          {/* Toolbar con botón de transferencia */}
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
              {cajas.length} cajas operativas · Selecciona una para registrar movimientos
            </p>
            <div className="flex gap-2">
              <button onClick={()=>setTransferModalOpen(true)}
                className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-purple-500/20 transition-all flex items-center gap-2">
                <ArrowLeftRight size={13}/> Transferir entre cajas
              </button>
              <button onClick={handleExportCajasExcel} className="bg-emerald-500/10 text-emerald-400 px-5 py-3 rounded-xl border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all flex items-center gap-2">
                <Download size={12}/> Exportar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cajas.map(caja => {
              const active  = cajaActiva===caja.id;
              const monedas = (['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m=>({m,s:getCajaBalance(caja.id,m)})).filter(x=>x.s!==0);
              return (
                <button key={caja.id} onClick={()=>setCajaActiva(active?null:caja.id)}
                  className={`${glass} rounded-2xl p-5 text-left border transition-all ${active?'border-[#E1AD01]/50 bg-[#E1AD01]/5':'border-white/[0.07] hover:border-white/20'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${active?'bg-[#E1AD01] text-black':'bg-white/5 text-zinc-600'}`}><Banknote size={15}/></div>
                    {active&&<span className="text-[7px] text-[#E1AD01] font-black uppercase tracking-widest">Activa</span>}
                  </div>
                  <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest mb-3">{caja.nombre}</p>
                  {monedas.length>0?(
                    <div className="space-y-1.5">
                      {monedas.map(({m,s})=>(
                        <div key={m} className="flex justify-between items-center">
                          <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                          <span className={`text-[10px] font-black italic ${s>=0?MONEDA_COLOR[m]:'text-red-400'}`}>{fmtMonto(s,m)}</span>
                        </div>
                      ))}
                    </div>
                  ):<p className="text-[9px] text-zinc-700 font-mono italic">Sin movimientos</p>}
                </button>
              );
            })}
          </div>

          {cajaActiva&&(()=>{
            const caja = cajas.find(c=>c.id===cajaActiva)!;
            const movs = movCajas.filter(m=>m.caja_id===cajaActiva);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic">Caja: <span className="text-[#E1AD01]">{caja.nombre}</span></h3>
                  <form onSubmit={handleMovCaja} className="space-y-4">
                    <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                      {(['ENTRADA','SALIDA'] as const).map(tipo=>(
                        <button key={tipo} type="button" onClick={()=>setMovForm(p=>({...p,tipo}))}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${movForm.tipo===tipo?(tipo==='ENTRADA'?'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30':'bg-red-500/20 text-red-400 border border-red-500/30'):'text-zinc-600 hover:text-zinc-400'}`}>
                          {tipo==='ENTRADA'?'+ Entrada':'- Salida'}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Moneda</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m=>(
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
                      <button onClick={()=>handleExportCajaIndividual(cajaActiva!)} className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-[8px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-1.5">
                        <Download size={10}/> Exportar
                      </button>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m=>{
                        const s=getCajaBalance(cajaActiva!,m); const hasMov=movs.some(mv=>mv.moneda===m); if(!hasMov)return null;
                        return(
                          <div key={m} className={`px-3 py-1.5 rounded-xl border ${MONEDA_BG[m]} flex items-center gap-2`}>
                            <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                            <span className={`text-[10px] font-black italic ${s>=0?MONEDA_COLOR[m]:'text-red-400'}`}>{fmtMonto(s,m)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2">
                    {movs.map(m=>(
                      <div key={m.id} className={`bg-white/[0.02] border p-4 rounded-2xl flex justify-between items-center group ${
                        m.transfer_id ? 'border-purple-500/20' : 'border-white/[0.05]'
                      }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${MONEDA_BG[m.moneda]} ${MONEDA_COLOR[m.moneda]}`}>{m.moneda}</span>
                            {m.transfer_id && (
                              <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                                <ArrowLeftRight size={8}/> Transferencia
                              </span>
                            )}
                            <p className="text-[10px] font-black uppercase truncate">{m.concepto||'—'}</p>
                          </div>
                          <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(m.fecha)}{m.referencia?` · ${m.referencia}`:''}</p>
                        </div>
                        <div className="flex items-center gap-3 ml-3">
                          <span className={`font-black text-base italic ${m.tipo==='ENTRADA'?'text-emerald-400':'text-red-400'}`}>{m.tipo==='ENTRADA'?'+':'-'}{fmtMonto(m.monto,m.moneda)}</span>
                          {!m.transfer_id && (
                            <button onClick={()=>openEditMov(m)} className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-[#E1AD01] transition-all p-1.5 rounded-lg hover:bg-[#E1AD01]/10">
                              <Pencil size={13}/>
                            </button>
                          )}
                          <button onClick={()=>deleteMovProtected(m.id)} disabled={savingAction===m.id}
                            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                            {savingAction===m.id?<Loader2 size={13} className="animate-spin"/>:<Trash2 size={13}/>}
                          </button>
                        </div>
                      </div>
                    ))}
                    {movs.length===0&&(
                      <div className="text-center py-16 text-zinc-700"><Banknote className="h-8 w-8 mx-auto mb-3 opacity-20"/><p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos en esta caja</p></div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ TAB: CUENTAS v13.0 — 4 CARDS ═══════════════════════════════════ */}
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
                    { key: 'HORAS_PAGADAS', label: '✓ Horas Pagadas', hint: 'Alumno pagó ahora — acredita de inmediato' },
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
                    onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))}
                    placeholder="MONTO" className={inp}/>
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

          {/* v13.0 — 4 CARDS: CxC, Horas, CxP proveedores, Reposiciones internas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">

            {/* Card 1: Por Cobrar */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-yellow-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowUpCircle className="text-yellow-400 h-4 w-4"/> Por Cobrar
                  <span className="ml-auto font-mono text-yellow-400 text-[9px]">${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
                <p className="text-[8px] text-zinc-600 font-mono mt-1">Alumnos que deben</p>
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
                      <div className="text-right ml-2">
                        <p className="font-black italic text-sm text-yellow-400">${c.monto_pendiente.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                      </div>
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
                {cxcPendientes.length===0&&(
                  <div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin deudas pendientes</p></div>
                )}
              </div>
            </div>

            {/* Card 2: Horas Pagadas */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-emerald-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <Plane className="text-emerald-400 h-4 w-4"/> Horas Pagadas
                  <span className="ml-auto font-mono text-emerald-400 text-[9px]">{totalHorasAcred.toFixed(1)}h</span>
                </h3>
                <p className="text-[8px] text-zinc-600 font-mono mt-1">Horas acreditadas al alumno</p>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {horasPagadas.map(c=>(
                  <div key={c.id} className="bg-white/[0.02] border border-emerald-500/10 rounded-2xl p-4 group transition-all hover:bg-white/[0.04]">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase truncate">{c.nombre_alumno}</p>
                        <p className="text-[8px] text-zinc-600 font-mono truncate">{c.concepto}</p>
                        <p className="text-[8px] text-emerald-400 font-mono mt-0.5 flex items-center gap-1">
                          <CheckCircle2 size={9}/> {c.horas_compradas}h · {c.moneda||'USD'}
                        </p>
                      </div>
                      <div className="text-right ml-2">
                        <p className="font-black italic text-sm text-emerald-400">${c.monto_total.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={()=>deleteCuentaProtected(c.id,true)} disabled={savingAction===c.id}
                        className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30 text-[8px] font-black uppercase flex items-center gap-1">
                        <Trash2 size={11}/> Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {horasPagadas.length===0&&(
                  <div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin horas pagadas</p></div>
                )}
              </div>
            </div>

            {/* Card 3: Por Pagar (Proveedores externos) */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-orange-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowDownCircle className="text-orange-400 h-4 w-4"/> Por Pagar
                  <span className="ml-auto font-mono text-orange-400 text-[9px]">${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
                <p className="text-[8px] text-zinc-600 font-mono mt-1">Proveedores y gastos externos</p>
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
                {cuentasProveedores.length===0&&(
                  <div className="text-center py-12 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por pagar</p></div>
                )}
              </div>
            </div>

            {/* Card 4: v13.0 — Reposiciones Internas */}
            <div className={`${glass} rounded-3xl overflow-hidden border-purple-500/10`}>
              <div className="p-5 border-b border-white/5 bg-purple-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowLeftRight className="text-purple-400 h-4 w-4"/> Reposiciones
                  <span className="ml-auto font-mono text-purple-400 text-[9px]">${totalReposiciones.toLocaleString('es-VE',{minimumFractionDigits:2})}</span>
                </h3>
                <p className="text-[8px] text-zinc-600 font-mono mt-1">Transferencias entre cajas pendientes de reponer</p>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentasReposiciones.map(c=>{
                  const salida  = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'SALIDA');
                  const entrada = movCajas.find(m => m.transfer_id === c.transfer_id && m.transfer_role === 'ENTRADA');
                  const cajaOrig = cajas.find(x => x.id === salida?.caja_id);
                  const cajaDest = cajas.find(x => x.id === entrada?.caja_id);
                  return (
                    <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all ${c.estatus==='PAGADO'?'border-emerald-500/10 opacity-60':'border-purple-500/10 hover:bg-white/[0.04]'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-black uppercase truncate">{c.entidad_nombre}</p>
                          {cajaOrig && cajaDest && (
                            <p className="text-[8px] text-purple-400/80 font-mono flex items-center gap-1 mt-0.5">
                              {cajaOrig.nombre} <ArrowLeftRight size={8}/> {cajaDest.nombre}
                            </p>
                          )}
                          <p className="text-[8px] text-zinc-600 font-mono truncate mt-0.5">{c.concepto}</p>
                          <p className="text-[8px] text-zinc-600 font-mono">{fmtDate(c.fecha_emision)}</p>
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
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin transferencias entre cajas</p>
                    <p className="text-[8px] text-zinc-800 font-mono mt-1">Usa "Transferir entre cajas" en el tab Cajas</p>
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
                placeholder="DETALLE OPERATIVO DE LA REQUISICIÓN..." disabled={savingReq}/>
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
              {requests.length===0&&(<div className="text-center py-16 text-zinc-700"><p className="text-[9px] font-black uppercase tracking-widest">Sin requisiciones</p></div>)}
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB: CIERRE ═════════════════════════════════════════════════════ */}
      {activeTab === 'CLOSING' && (()=>{
        const METODOS: { m: PaymentMethod; label: string; prefix: string }[] = [
          { m:'USDT',  label:'USDT (Crypto)',  prefix:'$'  },
          { m:'ZELLE', label:'Zelle (USD)',     prefix:'$'  },
          { m:'CASH',  label:'Efectivo (USD)',  prefix:'$'  },
          { m:'BS',    label:'Bolívares',       prefix:'Bs' },
        ];
        const handleCierre = () => {
          const disc: string[]=[];
          METODOS.forEach(({m,label,prefix})=>{
            const teorico=getVaultBalance(m);
            const fisico=round2(parseFloat(physBalances[m])||0);
            const diff=round2(Math.abs(teorico-fisico));
            if(diff>0.01) disc.push(`${label}: ${prefix} ${diff.toFixed(2)} de diferencia`);
          });
          if(disc.length>0) alert('⚠️ DISCREPANCIAS DETECTADAS:\n\n'+disc.join('\n'));
          else{alert('✓ CIERRE CERTIFICADO\nTodos los métodos cuadran.');setPhysBalances({USDT:'',ZELLE:'',CASH:'',BS:''});}
        };
        return(
          <div className="space-y-6">
            <div className={`${glass} rounded-2xl p-5 flex items-center justify-between`}>
              <div>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">Tasa BCV (Bs/USD)</p>
                <p className="text-[8px] text-zinc-700">Solo afecta display. BD guarda en moneda nativa.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#E1AD01] font-black font-mono">Bs</span>
                <input type="number" step="0.01" min="1" value={tasaBCV}
                  onChange={e=>{const n=parseFloat(e.target.value);if(!isNaN(n)&&n>0)setTasaBCV(n);}}
                  className="w-28 bg-black/40 border border-[#E1AD01]/30 rounded-xl px-3 py-2 text-[#E1AD01] font-black font-mono text-sm text-center outline-none"/>
              </div>
            </div>
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="font-black text-[12px] uppercase tracking-widest mb-7 italic flex items-center gap-3">
                <Lock className="text-[#E1AD01] h-5 w-5"/> Cierre Multi-Moneda
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METODOS.map(({m,label,prefix})=>{
                  const teorico=getVaultBalance(m);
                  const fisico=round2(parseFloat(physBalances[m])||0);
                  const diff=physBalances[m]!==''?round2(teorico-fisico):null;
                  const cuadra=diff!==null&&Math.abs(diff)<=0.01;
                  const descuadra=diff!==null&&Math.abs(diff)>0.01;
                  return(
                    <div key={m} className={`rounded-2xl border p-5 space-y-4 transition-all ${cuadra?'bg-emerald-500/5 border-emerald-500/20':descuadra?'bg-red-500/5 border-red-500/20':MONEDA_BG[m]}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{label}</span>
                        {cuadra&&<span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1"><CheckCircle2 size={10}/> Cuadrado</span>}
                        {descuadra&&<span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">⚠ Dif. {prefix} {Math.abs(diff!).toFixed(2)}</span>}
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

      {/* ══ MODAL v13.0: TRANSFERENCIA ENTRE CAJAS ═════════════════════════════ */}
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
                  <p className="text-[8px] text-zinc-600 mt-1">Se generará una CxP de reposición automáticamente</p>
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
                    {cajas.filter(c => c.id !== transferForm.caja_origen_id).map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">Moneda</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m=>(
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
                placeholder="CONCEPTO (ej: COMBUSTIBLE, PAGO NÓMINA URGENTE)" className={inp} disabled={savingTransfer}/>

              <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-4">
                <p className="text-[9px] text-purple-400 font-black uppercase tracking-widest mb-2 flex items-center gap-2">
                  <AlertTriangle size={12}/> Al confirmar se generarán 3 asientos vinculados:
                </p>
                <ol className="text-[9px] text-purple-300/70 font-mono space-y-1 pl-4">
                  <li>1. Salida de caja origen ({cajas.find(c=>c.id===transferForm.caja_origen_id)?.nombre || '...'})</li>
                  <li>2. Entrada a caja destino ({cajas.find(c=>c.id===transferForm.caja_destino_id)?.nombre || '...'})</li>
                  <li>3. CxP de reposición (Águilas debe reponer a caja origen)</li>
                </ol>
              </div>

              <ErrorBanner msg={transferError} onClose={()=>setTransferError(null)}/>

              <div className="flex gap-3">
                <button type="button" onClick={()=>{setTransferModalOpen(false);setTransferError(null);}} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">
                  Cancelar
                </button>
                <button type="submit" disabled={savingTransfer} className="flex-[2] py-4 bg-purple-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-purple-400 disabled:opacity-40 flex items-center justify-center gap-2">
                  {savingTransfer?<Loader2 className="animate-spin h-4 w-4"/>:<><ArrowLeftRight size={14}/> Ejecutar Transferencia</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL v13.0: PAGAR REPOSICIÓN ═════════════════════════════════════ */}
      {pagarReposicionModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-md rounded-3xl p-7 border-t-2 border-t-purple-500`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Repeat className="text-purple-400 h-5 w-5"/>
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Reponer a Caja</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Sale de Bóveda, entra a la caja original</p>
              </div>
            </div>

            <div className="bg-purple-500/5 border border-purple-500/20 rounded-2xl p-4 mb-4">
              <p className="text-[9px] text-purple-400/80 font-mono">{pagarReposicionModal.entidad_nombre}</p>
              <p className="text-2xl font-black italic text-purple-400 mt-1">{fmtMonto(pagarReposicionModal.monto_total, pagarReposicionModal.moneda)}</p>
              <p className="text-[8px] text-zinc-600 font-mono mt-1">{pagarReposicionModal.concepto}</p>
            </div>

            <label className="text-[9px] text-purple-400 font-black uppercase tracking-widest block mb-2">¿Desde qué Bóveda pagar?</label>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m=>{
                const saldo = getVaultBalance(m);
                const suficiente = saldo >= pagarReposicionModal.monto_total;
                return (
                  <button key={m} type="button" onClick={()=>setPagarReposicionMoneda(m)}
                    className={`p-3 rounded-xl border text-left transition-all ${pagarReposicionMoneda===m?`${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`:'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white'}`}>
                    <p className="text-[9px] font-black uppercase">{m}</p>
                    <p className={`text-[10px] font-mono italic mt-1 ${suficiente?'':'text-red-400'}`}>{fmtMonto(saldo, m)}</p>
                    {!suficiente && <p className="text-[7px] text-red-400 font-black uppercase mt-0.5">Insuficiente</p>}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={()=>setPagarReposicionModal(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">
                Cancelar
              </button>
              <button onClick={confirmarPagoReposicion} disabled={savingAction===pagarReposicionModal.id}
                className="flex-[2] py-4 bg-purple-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-purple-400 disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===pagarReposicionModal.id?<Loader2 className="animate-spin h-4 w-4"/>:<><CheckCircle2 size={14}/> Confirmar Reposición</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL v13.0: ELIMINAR TRANSFERENCIA SELECTIVA ══════════════════════ */}
      {deleteTransferModal && (
        <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-lg rounded-3xl p-7 border-t-2 border-t-red-500`}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Trash2 className="text-red-400 h-5 w-5"/>
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Eliminar Transferencia</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Selecciona qué registros vinculados eliminar</p>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {deleteTransferModal.salida && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.salida?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.salida} onChange={e=>setDeleteTransferSelection(p=>({...p,salida:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase text-red-400">Salida de {deleteTransferModal.cajaOrigenNombre}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">-{fmtMonto(deleteTransferModal.salida.monto, deleteTransferModal.salida.moneda)} · {fmtDate(deleteTransferModal.salida.fecha)}</p>
                  </div>
                </label>
              )}
              {deleteTransferModal.entrada && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.entrada?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.entrada} onChange={e=>setDeleteTransferSelection(p=>({...p,entrada:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase text-emerald-400">Entrada a {deleteTransferModal.cajaDestinoNombre}</p>
                    <p className="text-[8px] text-zinc-600 font-mono">+{fmtMonto(deleteTransferModal.entrada.monto, deleteTransferModal.entrada.moneda)} · {fmtDate(deleteTransferModal.entrada.fecha)}</p>
                  </div>
                </label>
              )}
              {deleteTransferModal.reposicion && (
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${deleteTransferSelection.reposicion?'bg-red-500/10 border-red-500/30':'bg-white/[0.02] border-white/[0.05]'}`}>
                  <input type="checkbox" checked={deleteTransferSelection.reposicion} onChange={e=>setDeleteTransferSelection(p=>({...p,reposicion:e.target.checked}))} className="w-4 h-4 accent-red-500"/>
                  <div className="flex-1">
                    <p className="text-[10px] font-black uppercase text-purple-400">CxP Reposición ({deleteTransferModal.reposicion.estatus})</p>
                    <p className="text-[8px] text-zinc-600 font-mono">{fmtMonto(deleteTransferModal.reposicion.monto_total, deleteTransferModal.reposicion.moneda)} · {deleteTransferModal.reposicion.entidad_nombre}</p>
                  </div>
                </label>
              )}
            </div>

            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 mb-4">
              <p className="text-[9px] text-yellow-400 font-mono leading-relaxed">
                ⚠ Eliminar solo una parte de la transferencia romperá la integridad contable. Marca los 3 elementos si quieres deshacer completamente la operación.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={()=>setDeleteTransferModal(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5">
                Cancelar
              </button>
              <button onClick={confirmDeleteTransferSelection}
                disabled={!deleteTransferSelection.salida && !deleteTransferSelection.entrada && !deleteTransferSelection.reposicion}
                className="flex-[2] py-4 bg-red-500 text-white rounded-2xl text-[10px] font-black uppercase hover:bg-red-400 disabled:opacity-30 flex items-center justify-center gap-2">
                <Trash2 size={14}/> Eliminar Seleccionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: CLAVE DEL DIRECTOR (preservado) ════════════════════════════ */}
      {directorAuthOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-sm rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-2xl bg-[#E1AD01]/10 border border-[#E1AD01]/20 flex items-center justify-center">
                <KeyRound className="text-[#E1AD01] h-5 w-5" />
              </div>
              <div>
                <h3 className="text-[11px] font-black uppercase tracking-widest">Autorización del Director</h3>
                <p className="text-[8px] text-zinc-600 mt-1">Edición y eliminación financiera requieren clave.</p>
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

      {/* ══ MODAL: EDITAR LEDGER (preservado) ══════════════════════════════════ */}
      {editingTx && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-2xl rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3"><Pencil className="text-[#E1AD01] h-4 w-4"/><h3 className="text-[10px] font-black uppercase tracking-widest">Editar Movimiento Financiero</h3></div>
              <button onClick={()=>setEditingTx(null)} className="text-zinc-600 hover:text-white"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select value={editTxForm.type} onChange={e=>setEditTxForm(p=>({...p,type:e.target.value as TransactionType}))} className={inp}>
                <option value="INCOME">INGRESO (+)</option><option value="EXPENSE">EGRESO (-)</option><option value="INSTRUCTOR_PAY">NÓMINA</option><option value="PAYABLE">POR PAGAR</option><option value="RECEIVABLE">POR COBRAR</option>
              </select>
              <select value={editTxForm.currency} onChange={e=>setEditTxForm(p=>({...p,currency:normalizePaymentMethod(e.target.value)}))} className={inp}>
                <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option><option value="CASH">CASH</option><option value="BS">BS</option>
              </select>
              <input type="number" min="0.01" step="0.01" value={editTxForm.amount} onChange={e=>setEditTxForm(p=>({...p,amount:e.target.value}))} className={inp} placeholder="MONTO"/>
              <input type="date" value={editTxForm.fecha} onChange={e=>setEditTxForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              <textarea value={editTxForm.description} onChange={e=>setEditTxForm(p=>({...p,description:e.target.value}))} className="md:col-span-2 w-full bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01] resize-none" rows={3} placeholder="DESCRIPCIÓN"/>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditingTx(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={saveEditedTx} disabled={savingAction===editingTx.id} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl text-[9px] font-black uppercase hover:bg-white disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===editingTx.id?<Loader2 size={13} className="animate-spin"/>:<ShieldCheck size={13}/>} Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: EDITAR CAJA (preservado) ═══════════════════════════════════ */}
      {editingMov && (
        <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className={`${glass} w-full max-w-2xl rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3"><Pencil className="text-[#E1AD01] h-4 w-4"/><h3 className="text-[10px] font-black uppercase tracking-widest">Editar Movimiento de Caja</h3></div>
              <button onClick={()=>setEditingMov(null)} className="text-zinc-600 hover:text-white"><X size={16}/></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select value={editMovForm.tipo} onChange={e=>setEditMovForm(p=>({...p,tipo:e.target.value as 'ENTRADA'|'SALIDA'}))} className={inp}><option value="ENTRADA">+ ENTRADA</option><option value="SALIDA">- SALIDA</option></select>
              <select value={editMovForm.moneda} onChange={e=>setEditMovForm(p=>({...p,moneda:normalizePaymentMethod(e.target.value)}))} className={inp}><option value="USDT">USDT</option><option value="ZELLE">ZELLE</option><option value="CASH">CASH</option><option value="BS">BS</option></select>
              <input type="number" min="0.01" step="0.01" value={editMovForm.monto} onChange={e=>setEditMovForm(p=>({...p,monto:e.target.value}))} className={inp} placeholder="MONTO"/>
              <input type="date" value={editMovForm.fecha} onChange={e=>setEditMovForm(p=>({...p,fecha:e.target.value}))} className={inp} style={{textTransform:'none'}}/>
              <input value={editMovForm.concepto} onChange={e=>setEditMovForm(p=>({...p,concepto:e.target.value}))} className={inp} placeholder="CONCEPTO"/>
              <input value={editMovForm.referencia} onChange={e=>setEditMovForm(p=>({...p,referencia:e.target.value}))} className={inp} placeholder="REFERENCIA"/>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={()=>setEditingMov(null)} className="flex-1 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[9px] font-black uppercase hover:bg-white/5">Cancelar</button>
              <button onClick={saveEditedMov} disabled={savingAction===editingMov.id} className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl text-[9px] font-black uppercase hover:bg-white disabled:opacity-40 flex items-center justify-center gap-2">
                {savingAction===editingMov.id?<Loader2 size={13} className="animate-spin"/>:<ShieldCheck size={13}/>} Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
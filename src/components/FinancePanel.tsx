// VALKYRON FINANCIAL INTELLIGENCE CENTER v11.0 — CxC ALUMNOS + HORAS DE VUELO
// FIXES CRÍTICOS v10.0 (preservados):
//   FIX 1 — Race condition eliminada: realtime ES la única fuente de actualización.
//   FIX 2 — Montos BS guardados en BS nativo, sin conversión a USD.
//   FIX 3 — Tasa BCV dinámica: configurable en runtime, no hardcodeada.
//   FIX 4 — Optimistic updates.
//   FIX 5 — Lock por formulario.
//   FIX 6 — Idempotency key (client_tx_id).
//   FIX 7 — Errores mostrados inline (no alert()).
// NUEVO v11.0:
//   — CxC ahora vive en tabla `cuentas_por_cobrar` (alumno + horas), separada de CxP (`cuentas_generales`).
//   — Selector de alumno (lista de perfiles_estudiantes, role=student).
//   — Al marcar "Cobrado" se acreditan horas_compradas = horas_prometidas → las lee FlightRegister y useStudentData.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  DollarSign, ArrowUpCircle, ArrowDownCircle, FileText,
  PlusCircle, X, Loader2, TrendingUp, Wallet, UserCheck,
  ShieldCheck, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Cpu, Activity, UserPlus, Truck,
  Trash2, Download, Coins, Users, Banknote, ArrowRight,
  ChevronDown, ChevronUp, AlertCircle, ReceiptText, HandCoins,
  AlertTriangle, RefreshCw,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type PaymentMethod  = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE';
export type TabType         = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING';

interface CajaChica     { id: string; nombre: string; }
interface MovimientoCaja {
  id: string; caja_id: string; tipo: 'ENTRADA' | 'SALIDA';
  moneda: PaymentMethod; monto: number;
  concepto: string; referencia: string; fecha: string; registrado_por: string;
}
interface CuentaGeneral {
  id: string; tipo: 'CXC' | 'CXP'; entidad_nombre: string; entidad_tipo: string;
  proveedor_id?: string; moneda: PaymentMethod;
  monto_total: number; monto_pendiente: number; concepto: string;
  fecha_emision: string; fecha_vencimiento?: string;
  estatus: 'PENDIENTE' | 'PAGADO' | 'PARCIAL'; notas?: string;
}
// NUEVO v11.0 — CxC de alumnos (tabla cuentas_por_cobrar)
interface CuentaPorCobrar {
  id: string;
  student_id: string;
  alumno_id: string;
  nombre_alumno: string;
  student_serial: string;
  monto_total: number;
  monto_pagado: number;
  monto_pendiente: number;
  horas_prometidas: number;
  horas_compradas: number;
  concepto: string;
  fecha_emision: string;
  estatus: 'PENDIENTE' | 'COBRADO' | 'PARCIAL';
}
interface AlumnoCxC {
  student_id: string;
  nombre: string;
  serial: string;
  sede: string;
}
interface FinancePanelProps {
  vendors: Vendor[]; inventory: any[]; userRole?: string;
  setGlobalFinance?: React.Dispatch<React.SetStateAction<{CASH:number;ZELLE:number;USDT:number;BS:number}>>;
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────

const glass = "bg-white/[0.02] backdrop-blur-[40px] border border-white/[0.07] shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inp   = "bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01]/60 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all w-full uppercase placeholder:text-white/20";

// FIX 3 — tasa dinámica: se puede cambiar en runtime desde el UI de cierre
const DEFAULT_TASA_BS = 36.50;

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

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// FIX 2 — roundear a 2 decimales para evitar floating point acumulado
const round2 = (n: number) => Math.round(n * 100) / 100;

// FIX 6 — UUID v4 ligero para idempotency keys
const uuid4 = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
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

// FIX 2 — mostrar monto en su moneda nativa (sin conversión)
const fmtMonto = (amount: number, moneda: PaymentMethod) => {
  const n = round2(amount);
  const s = n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'BS' ? `Bs ${s}` : `$${s}`;
};

// Conversión BS → USD solo para totales consolidados (display únicamente)
const toUSD = (amount: number, moneda: PaymentMethod, tasa: number) =>
  moneda === 'BS' ? round2(amount / tasa) : amount;

// ─── INLINE ERROR BANNER ──────────────────────────────────────────────────────

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
  const [tasaBCV, setTasaBCV]     = useState(DEFAULT_TASA_BS);

  // Data
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [requests,     setRequests]     = useState<any[]>([]);
  const [cajas,        setCajas]        = useState<CajaChica[]>([]);
  const [movCajas,     setMovCajas]     = useState<MovimientoCaja[]>([]);
  const [cuentas,      setCuentas]      = useState<CuentaGeneral[]>([]);   // CXP (cuentas_generales)
  const [capitanes,    setCapitanes]    = useState<any[]>([]);
  const [alumnos,      setAlumnos]      = useState<AlumnoCxC[]>([]);        // NUEVO v11.0
  const [cuentasCxC,   setCuentasCxC]   = useState<CuentaPorCobrar[]>([]);  // NUEVO v11.0 (cuentas_por_cobrar)

  // UI state
  const [loading,       setLoading]       = useState(true);
  const [selectedVault, setSelectedVault] = useState<PaymentMethod>('USDT');
  const [cajaActiva,    setCajaActiva]    = useState<string | null>(null);

  // FIX 1 — lock de fetch para evitar concurrencia
  const fetchLockRef = useRef(false);

  // Errores inline por formulario
  const [ledgerError, setLedgerError]   = useState<string | null>(null);
  const [cajaError,   setCajaError]     = useState<string | null>(null);
  const [cuentaError, setCuentaError]   = useState<string | null>(null);
  const [reqError,    setReqError]      = useState<string | null>(null);

  // Locks de envío por formulario (FIX 5)
  const [savingLedger,  setSavingLedger]  = useState(false);
  const [savingCaja,    setSavingCaja]    = useState(false);
  const [savingCuenta,  setSavingCuenta]  = useState(false);
  const [savingReq,     setSavingReq]     = useState(false);
  const [savingAction,  setSavingAction]  = useState<string | null>(null); // id de acción en curso

  // Formularios
  const [ledger, setLedger] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    reference: '', capitanId: '', fecha: new Date().toISOString().split('T')[0],
  });
  const [movForm, setMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA', moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
  });
  // NUEVO v11.0 — cuentaForm ahora soporta CXC (alumno + horas) y CXP (proveedor/libre)
  const [cuentaForm, setCuentaForm] = useState({
    tipo: 'CXC' as 'CXC' | 'CXP',
    // CxC — alumno
    alumno_student_id: '',
    horas_prometidas: '',
    ya_pagado: false, // NUEVO — si el pago fue directo, no queda como pendiente
    // CxP — proveedor/libre
    entidad_nombre: '', entidad_tipo: 'LIBRE',
    proveedor_id: '',
    moneda: 'USDT' as PaymentMethod,
    monto_total: '', concepto: '',
    fecha_emision: new Date().toISOString().split('T')[0],
    fecha_vencimiento: '', notas: '',
  });
  const [showCuentaForm, setShowCuentaForm] = useState(false);
  const [reqItems,    setReqItems]    = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount,   setReqAmount]   = useState('');
  const [physBalances, setPhysBalances] = useState<Record<PaymentMethod, string>>({ USDT:'', ZELLE:'', CASH:'', BS:'' });

  // ─── FIX 1: fetchAll con lock ──────────────────────────────────────────────
  const fetchAll = useCallback(async (silent = false) => {
    if (fetchLockRef.current) return; // ya hay un fetch en curso
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

      if (txRes.data) {
        setTransactions(txRes.data.map((t: any) => ({
          id: t.id, type: t.type, entityId: t.entity_id,
          entityName: t.entity_name || 'MOVIMIENTO',
          // FIX 2 — amount se lee tal cual, sin conversión
          amount: round2(Number(t.amount) || 0),
          invoiceNumber: t.invoice_number || 'S/N',
          description: t.description || '', status: t.status || 'PENDING',
          issueDate: t.issue_date, category: t.category || 'General',
          payment_method: t.payment_method as PaymentMethod,
        })));
      }
      if (reqRes.data)     setRequests(reqRes.data);
      if (cajasRes.data)   setCajas(cajasRes.data);
      if (movRes.data)     setMovCajas(movRes.data.map((m: any) => ({
        ...m, monto: round2(Number(m.monto) || 0),
      })));
      if (cuentasRes.data) setCuentas(cuentasRes.data.map((c: any) => ({
        ...c,
        monto_total:     round2(Number(c.monto_total) || 0),
        monto_pendiente: round2(Number(c.monto_pendiente) || 0),
      })));
      if (capRes.data)     setCapitanes(capRes.data);
      if (alumnosRes.data) setAlumnos(alumnosRes.data.map((a: any) => ({
        student_id: a.id,
        nombre: a.nombre_completo || 'SIN NOMBRE',
        serial: a.student_serial || '—',
        sede: a.sede || '—',
      })));
      if (cxcRes.data) setCuentasCxC(cxcRes.data.map((c: any) => ({
        ...c,
        monto_total:      round2(Number(c.monto_total) || 0),
        monto_pagado:     round2(Number(c.monto_pagado) || 0),
        monto_pendiente:  round2(Number(c.monto_pendiente) || 0),
        horas_prometidas: Number(c.horas_prometidas) || 0,
        horas_compradas:  Number(c.horas_compradas) || 0,
      })));
    } catch (e) {
      console.error('[FinancePanel] fetchAll error:', e);
    } finally {
      setLoading(false);
      fetchLockRef.current = false;
    }
  }, []);

  // FIX 1 — realtime: solo dispara fetchAll en modo silencioso
  // Debounce de 800ms para no responder a bursts de realtime
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRealtimeChange = useCallback(() => {
    if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
    realtimeDebounce.current = setTimeout(() => fetchAll(true), 800);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();

    const ch = supabase.channel('finance-v11')
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
  // FIX 2 — saldo por método en moneda nativa (sin conversión)
  const getVaultBalance = useCallback((method: PaymentMethod) =>
    transactions
      .filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((acc, t) => {
        const plus = t.type === 'INCOME' || t.type === 'RECEIVABLE';
        return round2(plus ? acc + t.amount : acc - t.amount);
      }, 0),
  [transactions]);

  const getCajaBalance = useCallback((cajaId: string, moneda: PaymentMethod) =>
    movCajas
      .filter(m => m.caja_id === cajaId && m.moneda === moneda)
      .reduce((acc, m) => round2(m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto), 0),
  [movCajas]);

  // NUEVO v11.0 — totalCxC ahora viene de cuentas_por_cobrar
  const totalCxC = useMemo(() =>
    cuentasCxC.filter(c => c.estatus !== 'COBRADO')
      .reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentasCxC]);
  const totalCxP = useMemo(() =>
    cuentas.filter(c => c.tipo === 'CXP' && c.estatus !== 'PAGADO')
      .reduce((a, c) => round2(a + c.monto_pendiente), 0),
  [cuentas]);

  // ─── HANDLER: LEDGER ──────────────────────────────────────────────────────
  const handleLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    setLedgerError(null);

    const num = round2(parseFloat(ledger.amount));
    if (isNaN(num) || num <= 0) {
      setLedgerError('Monto inválido. Ingresa un número positivo.');
      return;
    }
    if (ledger.type === 'INSTRUCTOR_PAY' && !ledger.capitanId) {
      setLedgerError('Selecciona un capitán para registrar nómina.');
      return;
    }

    setSavingLedger(true);

    // FIX 4 — snapshot optimista
    const txId = uuid4();
    const cap  = capitanes.find(c => c.id === ledger.capitanId);

    // FIX 2 — guardar en moneda nativa, SIN convertir BS
    const payload = {
      id:             txId,       // FIX 6 — idempotency key
      type:           ledger.type,
      entity_name:    ledger.type === 'INSTRUCTOR_PAY'
                        ? `NÓMINA: ${cap?.nombre ?? 'CAPITÁN'}`
                        : `${ledger.type} ${ledger.currency}`,
      amount:         num,        // FIX 2 — amount nativo, no convertido
      invoice_number: `TX-${genHash(txId)}`,
      description:    ledger.reference.trim() || 'REGISTRO MANUAL',
      status:         'PAID',
      category:       ledger.type === 'INSTRUCTOR_PAY' ? 'Nomina' : 'General',
      payment_method: ledger.currency,
      issue_date:     new Date(ledger.fecha).toISOString(),
    };

    try {
      const { error } = await supabase.from('transacciones_finanzas').insert([payload]);
      if (error) {
        // Detectar duplicado por idempotency key
        if (error.code === '23505') {
          setLedgerError('Este registro ya fue procesado (duplicado detectado).');
        } else {
          setLedgerError(`Error al registrar: ${error.message}`);
        }
        return;
      }
      // Éxito — resetear formulario
      // FIX 1 — NO llamar fetchAll() aquí; el realtime lo actualizará
      setLedger(p => ({ ...p, amount: '', reference: '' }));
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingLedger(false);
    }
  };

  // ─── HANDLER: MOVIMIENTO DE CAJA ──────────────────────────────────────────
  const handleMovCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setCajaError(null);
    if (!cajaActiva) { setCajaError('Selecciona una caja primero.'); return; }

    const num = round2(parseFloat(movForm.monto));
    if (isNaN(num) || num <= 0) { setCajaError('Monto inválido.'); return; }
    if (!movForm.concepto.trim()) { setCajaError('El concepto es obligatorio.'); return; }

    setSavingCaja(true);

    const movId = uuid4();
    try {
      const { error } = await supabase.from('movimientos_caja_chica').insert([{
        id:             movId,
        caja_id:        cajaActiva,
        tipo:           movForm.tipo,
        moneda:         movForm.moneda,
        monto:          num,   // FIX 2 — nativo
        concepto:       movForm.concepto.toUpperCase().trim(),
        referencia:     movForm.referencia.toUpperCase().trim() || null,
        fecha:          new Date(movForm.fecha).toISOString(),
        registrado_por: userRole,
      }]);

      if (error) {
        setCajaError(error.code === '23505'
          ? 'Movimiento duplicado detectado.'
          : `Error: ${error.message}`);
        return;
      }
      // FIX 1 — NO fetchAll manual
      setMovForm(p => ({ ...p, monto: '', concepto: '', referencia: '' }));
    } catch (err) {
      setCajaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingCaja(false);
    }
  };

  // ─── HANDLER: CUENTA (CxC alumno / CxP proveedor) ─────────────────────────
  // NUEVO v11.0 — ramifica según tipo: CXC va a cuentas_por_cobrar, CXP a cuentas_generales
  const handleCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    setCuentaError(null);

    // ── CXC: alumno + horas → tabla cuentas_por_cobrar ──────────────────
    if (cuentaForm.tipo === 'CXC') {
      const horas = parseFloat(cuentaForm.horas_prometidas);
      const monto = round2(parseFloat(cuentaForm.monto_total));
      if (!cuentaForm.alumno_student_id) { setCuentaError('Selecciona un alumno.'); return; }
      if (isNaN(horas) || horas <= 0)    { setCuentaError('Horas inválidas.'); return; }
      if (isNaN(monto) || monto <= 0)    { setCuentaError('Monto inválido.'); return; }
      if (!cuentaForm.concepto.trim())   { setCuentaError('Concepto requerido.'); return; }

      const alumno = alumnos.find(a => a.student_id === cuentaForm.alumno_student_id);
      if (!alumno) { setCuentaError('Alumno no encontrado.'); return; }

      setSavingCuenta(true);
      try {
        const pagado = cuentaForm.ya_pagado;
        const { error } = await supabase.from('cuentas_por_cobrar').insert([{
          student_id:       alumno.student_id,
          alumno_id:        alumno.student_id,
          nombre_alumno:    alumno.nombre,
          student_serial:   alumno.serial,
          monto_total:      monto,
          monto_pagado:     pagado ? monto : 0,
          monto_pendiente:  pagado ? 0 : monto,
          horas_prometidas: horas,
          horas_compradas:  pagado ? horas : 0, // si ya pagó, acredita horas de inmediato
          concepto:         cuentaForm.concepto.toUpperCase().trim(),
          fecha_emision:    cuentaForm.fecha_emision,
          estatus:          pagado ? 'COBRADO' : 'PENDIENTE',
        }]);
        if (error) { setCuentaError(`Error: ${error.message}`); return; }
        setCuentaForm(p => ({ ...p, alumno_student_id: '', horas_prometidas: '', monto_total: '', concepto: '', notas: '', ya_pagado: false }));
        setShowCuentaForm(false);
      } catch (err) {
        setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
      } finally {
        setSavingCuenta(false);
      }
      return;
    }

    // ── CXP: proveedor/libre → tabla cuentas_generales (flujo original) ─
    const num = round2(parseFloat(cuentaForm.monto_total));
    if (isNaN(num) || num <= 0)              { setCuentaError('Monto inválido.'); return; }
    if (!cuentaForm.entidad_nombre.trim())   { setCuentaError('Nombre de entidad requerido.'); return; }
    if (!cuentaForm.concepto.trim())         { setCuentaError('Concepto requerido.'); return; }

    setSavingCuenta(true);
    try {
      const { error } = await supabase.from('cuentas_generales').insert([{
        tipo:              'CXP',
        entidad_nombre:    cuentaForm.entidad_nombre.toUpperCase().trim(),
        entidad_tipo:      cuentaForm.entidad_tipo,
        proveedor_id:      cuentaForm.proveedor_id || null,
        moneda:            cuentaForm.moneda,
        monto_total:       num,
        monto_pendiente:   num,
        concepto:          cuentaForm.concepto.toUpperCase().trim(),
        fecha_emision:     new Date(cuentaForm.fecha_emision).toISOString(),
        fecha_vencimiento: cuentaForm.fecha_vencimiento
                             ? new Date(cuentaForm.fecha_vencimiento).toISOString()
                             : null,
        estatus:           'PENDIENTE',
        notas:             cuentaForm.notas || null,
      }]);

      if (error) { setCuentaError(`Error: ${error.message}`); return; }

      setCuentaForm(p => ({
        ...p, entidad_nombre: '', concepto: '', monto_total: '',
        notas: '', proveedor_id: '', fecha_vencimiento: '',
      }));
      setShowCuentaForm(false);
    } catch (err) {
      setCuentaError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingCuenta(false);
    }
  };

  // ─── HANDLER: PAGAR / COBRAR CUENTA ───────────────────────────────────────
  // NUEVO v11.0 — segundo parámetro indica si es CxC (alumno) o CxP (proveedor)
  // Al cobrar CxC: acredita horas_compradas = horas_prometidas
  const handlePagarCuenta = async (id: string, esCxC: boolean) => {
    if (savingAction) return;
    setSavingAction(id);
    try {
      if (esCxC) {
        const registro = cuentasCxC.find(c => c.id === id);
        if (!registro) return;
        const { error } = await supabase
          .from('cuentas_por_cobrar')
          .update({
            estatus:          'COBRADO',
            monto_pagado:     registro.monto_total,
            monto_pendiente:  0,
            horas_compradas:  registro.horas_prometidas, // acredita horas al cobrar
          })
          .eq('id', id);
        if (error) console.error('[FinancePanel] pagar CxC:', error.message);
      } else {
        const { error } = await supabase
          .from('cuentas_generales')
          .update({ estatus: 'PAGADO', monto_pendiente: 0 })
          .eq('id', id);
        if (error) console.error('[FinancePanel] pagar CxP:', error.message);
      }
    } finally {
      setSavingAction(null);
    }
  };

  // NUEVO v11.0 — segundo parámetro indica si es CxC o CxP
  const handleDeleteCuenta = async (id: string, esCxC: boolean) => {
    if (!window.confirm('¿Eliminar esta cuenta?')) return;
    if (savingAction) return;
    setSavingAction(id);
    try {
      if (esCxC) await supabase.from('cuentas_por_cobrar').delete().eq('id', id);
      else       await supabase.from('cuentas_generales').delete().eq('id', id);
    } finally {
      setSavingAction(null);
    }
  };

  const handleDeleteTx = async (id: string) => {
    if (!window.confirm('¿Eliminar esta transacción? Esta acción es irreversible.')) return;
    if (savingAction) return;
    setSavingAction(id);
    try {
      await supabase.from('transacciones_finanzas').delete().eq('id', id);
    } finally {
      setSavingAction(null);
    }
  };

  const handleDeleteMovCaja = async (id: string) => {
    if (!window.confirm('¿Revertir este movimiento?')) return;
    if (savingAction) return;
    setSavingAction(id);
    try {
      await supabase.from('movimientos_caja_chica').delete().eq('id', id);
    } finally {
      setSavingAction(null);
    }
  };

  // ─── HANDLER: REQUISICIÓN ─────────────────────────────────────────────────
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError(null);
    const num = round2(parseFloat(reqAmount));
    if (!reqItems.trim() || isNaN(num) || num <= 0) {
      setReqError('Completa el detalle y el costo estimado.');
      return;
    }
    setSavingReq(true);
    try {
      const { error } = await supabase.from('solicitudes_compra').insert([{
        prioridad:        reqPriority,
        items:            JSON.stringify({ description: reqItems.toUpperCase(), estimated_cost: num }),
        estatus:          'PENDIENTE_REVISION',
        hash_auditoria:   genHash(reqItems + reqAmount + Date.now()),
      }]);
      if (error) { setReqError(`Error: ${error.message}`); return; }
      setReqItems(''); setReqAmount('');
    } catch (err) {
      setReqError(err instanceof Error ? err.message : 'Error de conexión.');
    } finally {
      setSavingReq(false);
    }
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
      await supabase.from('solicitudes_compra')
        .update({ estatus: 'APROBADO', aprobado_por: userRole })
        .eq('id', reqId);
    } finally {
      setSavingAction(null);
    }
  };

  // ─── EXPORTAR CSV ─────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const rows = transactions.map(t => [
      fmtDate(t.issueDate), t.invoiceNumber, `"${t.entityName}"`,
      t.payment_method || 'N/A', t.amount, t.type, t.status,
    ]);
    const csv = [
      ['Fecha', 'Ref', 'Entidad', 'Metodo', 'Monto_Nativo', 'Tipo', 'Estatus'].join(','),
      ...rows.map(r => r.join(',')),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `FinanzasAguilas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportCajaIndividual = (cajaId: string) => {
    const caja = cajas.find(c => c.id === cajaId);
    if (!caja) return;
    const movs = movCajas.filter(m => m.caja_id === cajaId);
    const rows = [
      `CAJA: ${caja.nombre.toUpperCase()}`,
      `Exportado: ${new Date().toLocaleDateString('es-VE')}`,
      '',
      'Fecha,Tipo,Moneda,Monto,Concepto,Referencia,Registrado_por',
      ...movs.map(m => [
        fmtDate(m.fecha), m.tipo === 'ENTRADA' ? 'INGRESO' : 'EGRESO',
        m.moneda, m.monto.toFixed(2),
        `"${m.concepto || ''}"`, `"${m.referencia || ''}"`,
        m.registrado_por || 'Sistema',
      ].join(',')),
    ];
    (['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).forEach(mon => {
      const ing = movs.filter(m=>m.moneda===mon&&m.tipo==='ENTRADA').reduce((a,m)=>a+m.monto,0);
      const egr = movs.filter(m=>m.moneda===mon&&m.tipo==='SALIDA').reduce((a,m)=>a+m.monto,0);
      if (ing>0||egr>0) rows.push(`${mon},${ing.toFixed(2)},${egr.toFixed(2)},${(ing-egr).toFixed(2)}`);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `Caja_${caja.nombre.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportCajasExcel = () => {
    const all: string[] = [`REPORTE CAJAS CHICAS · ${new Date().toLocaleDateString('es-VE')}`, ''];
    cajas.forEach(caja => {
      const movs = movCajas.filter(m => m.caja_id === caja.id);
      all.push(`CAJA: ${caja.nombre.toUpperCase()}`);
      all.push('Fecha,Tipo,Moneda,Monto,Concepto,Referencia');
      movs.forEach(m => all.push([
        fmtDate(m.fecha), m.tipo, m.moneda, m.monto.toFixed(2),
        `"${m.concepto||''}"`, `"${m.referencia||''}"`,
      ].join(',')));
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
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">
        Valkyron Financial Core v11.0...
      </p>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">
            Valkyron Financial Core v11.0
          </p>
          <button onClick={() => fetchAll(true)} title="Recargar datos"
            className="text-zinc-700 hover:text-[#E1AD01] transition-colors">
            <RefreshCw size={12} className={fetchLockRef.current ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* TABS */}
        <div className="flex flex-wrap gap-1 p-1.5 bg-black/60 rounded-2xl border border-white/5">
          {([
            { key: 'LEDGER',       label: 'Diario',  icon: Landmark      },
            { key: 'BÓVEDAS',      label: 'Bóvedas', icon: Coins         },
            { key: 'CAJAS',        label: 'Cajas',   icon: Banknote      },
            { key: 'CUENTAS',      label: 'CxC/CxP', icon: ReceiptText   },
            { key: 'REQUISITIONS', label: 'Reqs',    icon: FileSignature },
            { key: 'CLOSING',      label: 'Cierre',  icon: Lock          },
          ] as { key: TabType; label: string; icon: any }[]).map(t => {
            const Icon = t.icon;
            const active = activeTab === t.key;
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

      {/* KPI STRIP — FIX 2: muestra en moneda nativa */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
          const ing = transactions.filter(t=>t.payment_method===m&&t.status==='PAID'&&(t.type==='INCOME'||t.type==='RECEIVABLE')).reduce((a,t)=>round2(a+t.amount),0);
          const egr = transactions.filter(t=>t.payment_method===m&&t.status==='PAID'&&(t.type==='EXPENSE'||t.type==='PAYABLE'||t.type==='INSTRUCTOR_PAY')).reduce((a,t)=>round2(a+t.amount),0);
          const saldo = round2(ing - egr);
          const prefix = m === 'BS' ? 'Bs' : '$';
          const fmt = (n: number) => `${prefix} ${round2(n).toLocaleString('es-VE',{minimumFractionDigits:2})}`;
          return (
            <div key={m} className={`${glass} ${MONEDA_BG[m]} rounded-2xl p-5 border space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{m}</span>
                <span className={`text-[7px] font-black px-2 py-1 rounded-full border ${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`}>
                  {saldo >= 0 ? 'POSITIVO' : 'NEGATIVO'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div>
                  <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Ingresado</p>
                  <p className="text-emerald-400 font-black text-xs italic">{fmt(ing)}</p>
                </div>
                <div>
                  <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Egresado</p>
                  <p className="text-red-400 font-black text-xs italic">{fmt(egr)}</p>
                </div>
              </div>
              <div className="border-t border-white/5 pt-2 text-center">
                <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Saldo Neto</p>
                <p className={`font-black text-base italic ${saldo >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>
                  {fmt(saldo)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* CxC / CxP */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`${glass} bg-yellow-500/5 border border-yellow-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Total Por Cobrar</p>
            <p className="text-yellow-400 font-black text-lg italic">${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
          </div>
          <ArrowUpCircle className="text-yellow-400/20 h-10 w-10" />
        </div>
        <div className={`${glass} bg-orange-500/5 border border-orange-500/10 rounded-2xl p-4 flex items-center justify-between`}>
          <div>
            <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Total Por Pagar</p>
            <p className="text-orange-400 font-black text-lg italic">${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
          </div>
          <ArrowDownCircle className="text-orange-400/20 h-10 w-10" />
        </div>
      </div>

      {/* ══════════════════════ TAB: DIARIO GENERAL ══════════════════════════ */}
      {activeTab === 'LEDGER' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* FORM */}
          <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
            <div className="flex items-center gap-3 mb-7">
              <Calculator className="text-[#E1AD01] h-4 w-4" />
              <h2 className="text-[10px] font-black uppercase tracking-widest">Registrar Movimiento</h2>
            </div>
            <form onSubmit={handleLedger} className="space-y-4">
              <input type="date" required value={ledger.fecha}
                onChange={e => setLedger(p=>({...p, fecha: e.target.value}))}
                className={inp} style={{textTransform:'none'}} />
              <div className="grid grid-cols-2 gap-3">
                <select value={ledger.type} onChange={e => setLedger(p=>({...p, type: e.target.value as any}))} className={inp}>
                  <option value="INCOME">INGRESO (+)</option>
                  <option value="EXPENSE">EGRESO (-)</option>
                  <option value="INSTRUCTOR_PAY">NÓMINA</option>
                </select>
                <select value={ledger.currency} onChange={e => setLedger(p=>({...p, currency: e.target.value as any}))} className={inp}>
                  <option value="USDT">USDT</option>
                  <option value="ZELLE">ZELLE</option>
                  <option value="CASH">CASH</option>
                  <option value="BS">BS</option>
                </select>
              </div>
              {ledger.type === 'INSTRUCTOR_PAY' && (
                <select value={ledger.capitanId} onChange={e => setLedger(p=>({...p, capitanId:e.target.value}))} className={inp}>
                  <option value="">— CAPITÁN —</option>
                  {capitanes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#E1AD01] font-black text-xl">
                  {ledger.currency === 'BS' ? 'Bs' : '$'}
                </span>
                <input type="number" step="0.01" min="0.01" required value={ledger.amount}
                  onChange={e => setLedger(p=>({...p, amount: e.target.value}))}
                  onBlur={e => {
                    // FIX 2 — confirmar valor redondeado al salir del campo
                    const n = parseFloat(e.target.value);
                    if (!isNaN(n)) setLedger(p=>({...p, amount: round2(n).toString()}));
                  }}
                  className="w-full bg-white/5 border border-white/10 py-8 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                  placeholder="0.00" disabled={savingLedger} />
              </div>
              <input value={ledger.reference} onChange={e => setLedger(p=>({...p, reference: e.target.value}))}
                placeholder="REFERENCIA / TRAZABILIDAD" className={inp} disabled={savingLedger} />

              <ErrorBanner msg={ledgerError} onClose={() => setLedgerError(null)} />

              <button type="submit" disabled={savingLedger}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                {savingLedger ? <><Loader2 className="animate-spin h-4 w-4" /> Sellando...</> : 'Sellar Registro'}
              </button>
            </form>
          </div>

          {/* TABLA */}
          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Libro Mayor</h3>
              <button onClick={handleExportCSV}
                className="bg-[#E1AD01]/10 text-[#E1AD01] px-4 py-2 rounded-xl border border-[#E1AD01]/20 text-[9px] font-black uppercase hover:bg-[#E1AD01] hover:text-black flex items-center gap-2 transition-all">
                <Download size={11}/> CSV
              </button>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[520px] p-4 space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group hover:bg-white/[0.04] transition-all">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase truncate">{t.entityName}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">
                      {fmtDate(t.issueDate)} · {t.invoiceNumber} ·{' '}
                      <span className={MONEDA_COLOR[t.payment_method as PaymentMethod] || 'text-zinc-500'}>
                        {t.payment_method}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    {/* FIX 2 — mostrar monto nativo sin conversión */}
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE') ? '+' : '-'}
                      {fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                    </span>
                    {t.status==='PAID'
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500/40 shrink-0" />
                      : <Loader2 className="h-4 w-4 text-[#E1AD01] animate-spin shrink-0" />
                    }
                    <button onClick={() => handleDeleteTx(t.id)} disabled={savingAction === t.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                      {savingAction === t.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13}/>}
                    </button>
                  </div>
                </div>
              ))}
              {transactions.length === 0 && (
                <div className="text-center py-16 text-zinc-700">
                  <Activity className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  <p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos registrados</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ TAB: BÓVEDAS ═════════════════════════════════ */}
      {activeTab === 'BÓVEDAS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`lg:col-span-4 ${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 italic">
              <Wallet className="text-[#E1AD01] h-4 w-4" /> Bóvedas Principales
            </h3>
            <div className="space-y-3">
              {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(curr => {
                const bal    = getVaultBalance(curr);
                const active = selectedVault === curr;
                return (
                  <button key={curr} onClick={() => setSelectedVault(curr)}
                    className={`w-full p-5 rounded-2xl flex justify-between items-center border transition-all
                                ${active ? `${MONEDA_BG[curr]} ${MONEDA_COLOR[curr]}` : 'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white hover:bg-white/[0.04]'}`}>
                    <div className="flex items-center gap-3">
                      <Coins className={`h-4 w-4 ${active ? '' : 'text-zinc-700'}`} />
                      <span className="font-black uppercase tracking-widest text-[10px]">{curr}</span>
                    </div>
                    {/* FIX 2 — saldo nativo */}
                    <span className={`font-mono font-black text-lg italic ${active ? '' : 'text-zinc-400'}`}>
                      {fmtMonto(bal, curr)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">
                Auditoría Bóveda: <span className={MONEDA_COLOR[selectedVault]}>{selectedVault}</span>
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[520px] p-4 space-y-2">
              {transactions.filter(t => t.payment_method === selectedVault).map(t => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group">
                  <div>
                    <p className="text-[10px] font-black uppercase">{t.entityName}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{fmtDate(t.issueDate)} · {t.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE') ? '+' : '-'}
                      {fmtMonto(t.amount, t.payment_method as PaymentMethod)}
                    </span>
                    <button onClick={() => handleDeleteTx(t.id)} disabled={savingAction === t.id}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                      {savingAction === t.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13}/>}
                    </button>
                  </div>
                </div>
              ))}
              {transactions.filter(t=>t.payment_method===selectedVault).length === 0 && (
                <div className="text-center py-16 text-zinc-700">
                  <p className="text-[9px] font-black uppercase tracking-widest">Sin movimientos en {selectedVault}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ TAB: CAJAS CHICAS ════════════════════════════ */}
      {activeTab === 'CAJAS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cajas.map(caja => {
              const active = cajaActiva === caja.id;
              const monedas = (['USDT','ZELLE','CASH','BS'] as PaymentMethod[])
                .map(m => ({ m, s: getCajaBalance(caja.id, m) }))
                .filter(x => x.s !== 0);
              return (
                <button key={caja.id} onClick={() => setCajaActiva(active ? null : caja.id)}
                  className={`${glass} rounded-2xl p-5 text-left border transition-all
                              ${active ? 'border-[#E1AD01]/50 bg-[#E1AD01]/5' : 'border-white/[0.07] hover:border-white/20'}`}>
                  <div className="flex justify-between items-center mb-4">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${active ? 'bg-[#E1AD01] text-black' : 'bg-white/5 text-zinc-600'}`}>
                      <Banknote size={15}/>
                    </div>
                    {active && <span className="text-[7px] text-[#E1AD01] font-black uppercase tracking-widest">Activa</span>}
                  </div>
                  <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest mb-3">{caja.nombre}</p>
                  {monedas.length > 0 ? (
                    <div className="space-y-1.5">
                      {monedas.map(({ m, s }) => (
                        <div key={m} className="flex justify-between items-center">
                          <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                          <span className={`text-[10px] font-black italic ${s >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>
                            {fmtMonto(s, m)}
                          </span>
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

          <div className="flex justify-end">
            <button onClick={handleExportCajasExcel}
              className="bg-emerald-500/10 text-emerald-400 px-5 py-3 rounded-xl border border-emerald-500/20 text-[9px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-2">
              <Download size={12}/> Exportar Cajas
            </button>
          </div>

          {cajaActiva && (() => {
            const caja = cajas.find(c => c.id === cajaActiva)!;
            const movs = movCajas.filter(m => m.caja_id === cajaActiva);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic">
                    Caja: <span className="text-[#E1AD01]">{caja.nombre}</span>
                  </h3>
                  <form onSubmit={handleMovCaja} className="space-y-4">
                    <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                      {(['ENTRADA','SALIDA'] as const).map(tipo => (
                        <button key={tipo} type="button"
                          onClick={() => setMovForm(p=>({...p, tipo}))}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all
                                      ${movForm.tipo===tipo
                                        ? tipo==='ENTRADA' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                        : 'text-zinc-600 hover:text-zinc-400'}`}>
                          {tipo==='ENTRADA' ? '+ Entrada' : '- Salida'}
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Moneda</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => (
                          <button key={m} type="button"
                            onClick={() => setMovForm(p=>({...p, moneda:m}))}
                            className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all
                                        ${movForm.moneda===m ? `${MONEDA_BG[m]} ${MONEDA_COLOR[m]}` : 'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input type="date" required value={movForm.fecha}
                      onChange={e => setMovForm(p=>({...p,fecha:e.target.value}))}
                      className={inp} style={{textTransform:'none'}} disabled={savingCaja} />
                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl" style={{color:'#E1AD01'}}>
                        {movForm.moneda==='BS' ? 'Bs' : '$'}
                      </span>
                      <input type="number" step="0.01" min="0.01" required value={movForm.monto}
                        onChange={e => setMovForm(p=>({...p,monto:e.target.value}))}
                        onBlur={e => {
                          const n = parseFloat(e.target.value);
                          if (!isNaN(n)) setMovForm(p=>({...p,monto:round2(n).toString()}));
                        }}
                        className="w-full bg-white/5 border border-white/10 py-7 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                        placeholder="0.00" disabled={savingCaja} />
                    </div>
                    <input value={movForm.concepto} onChange={e=>setMovForm(p=>({...p,concepto:e.target.value}))}
                      placeholder="CONCEPTO *" className={inp} disabled={savingCaja} />
                    <input value={movForm.referencia} onChange={e=>setMovForm(p=>({...p,referencia:e.target.value}))}
                      placeholder="REFERENCIA (opcional)" className={inp} disabled={savingCaja} />

                    <ErrorBanner msg={cajaError} onClose={() => setCajaError(null)} />

                    <button type="submit" disabled={savingCaja}
                      className={`w-full py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40
                                  ${movForm.tipo==='ENTRADA' ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-red-500 text-white hover:bg-red-400'}`}>
                      {savingCaja ? <Loader2 className="animate-spin h-4 w-4" /> : movForm.tipo==='ENTRADA' ? '+ Registrar Entrada' : '- Registrar Salida'}
                    </button>
                  </form>
                </div>

                <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
                  <div className="p-6 border-b border-white/5">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[10px] font-black uppercase tracking-widest italic">
                        Historial · {caja.nombre}
                      </h3>
                      <button onClick={() => handleExportCajaIndividual(cajaActiva!)}
                        className="bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20 text-[8px] font-black uppercase hover:bg-emerald-500/20 transition-all flex items-center gap-1.5">
                        <Download size={10}/> Exportar
                      </button>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
                        const s = getCajaBalance(cajaActiva!, m);
                        const hasMov = movs.some(mv=>mv.moneda===m);
                        if (!hasMov) return null;
                        return (
                          <div key={m} className={`px-3 py-1.5 rounded-xl border ${MONEDA_BG[m]} flex items-center gap-2`}>
                            <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                            <span className={`text-[10px] font-black italic ${s>=0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>
                              {fmtMonto(s, m)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[400px] p-4 space-y-2">
                    {movs.map(m => (
                      <div key={m.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${MONEDA_BG[m.moneda]} ${MONEDA_COLOR[m.moneda]}`}>{m.moneda}</span>
                            <p className="text-[10px] font-black uppercase">{m.concepto || '—'}</p>
                          </div>
                          <p className="text-[8px] text-zinc-600 font-mono">
                            {fmtDate(m.fecha)}{m.referencia ? ` · ${m.referencia}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-black text-base italic ${m.tipo==='ENTRADA' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {m.tipo==='ENTRADA' ? '+' : '-'}{fmtMonto(m.monto, m.moneda)}
                          </span>
                          <button onClick={() => handleDeleteMovCaja(m.id)} disabled={savingAction === m.id}
                            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-30">
                            {savingAction === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13}/>}
                          </button>
                        </div>
                      </div>
                    ))}
                    {movs.length === 0 && (
                      <div className="text-center py-16 text-zinc-700">
                        <Banknote className="h-8 w-8 mx-auto mb-3 opacity-20" />
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

      {/* ══════════════════════ TAB: CxC/CxP ════════════════════════════════ */}
      {activeTab === 'CUENTAS' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-5 py-3">
                <p className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Total CxC</p>
                <p className="text-lg font-black italic text-yellow-400">${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-3">
                <p className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Total CxP</p>
                <p className="text-lg font-black italic text-red-400">${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}</p>
              </div>
            </div>
            <button onClick={() => setShowCuentaForm(!showCuentaForm)}
              className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
              <PlusCircle size={14}/> Nueva Cuenta
            </button>
          </div>

          {showCuentaForm && (
            <div className={`${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01] animate-in slide-in-from-top-4 duration-300`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
                <ReceiptText className="text-[#E1AD01] h-4 w-4" /> Registrar Cuenta
              </h3>
              {/* NUEVO v11.0 — formulario ramificado CXC (alumno+horas) / CXP (proveedor/libre) */}
              <form onSubmit={handleCuenta} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10 md:col-span-1">
                  {(['CXC','CXP'] as const).map(tipo => (
                    <button key={tipo} type="button" onClick={() => setCuentaForm(p=>({...p,tipo}))}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all
                                  ${cuentaForm.tipo===tipo
                                    ? tipo==='CXC' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    : 'text-zinc-600 hover:text-zinc-400'}`}>
                      {tipo==='CXC' ? 'Por Cobrar' : 'Por Pagar'}
                    </button>
                  ))}
                </div>

                {cuentaForm.tipo === 'CXC' ? (
                  <>
                    <select required value={cuentaForm.alumno_student_id}
                      onChange={e => setCuentaForm(p=>({...p, alumno_student_id: e.target.value}))}
                      className={inp}>
                      <option value="">— ALUMNO —</option>
                      {alumnos.map(a => (
                        <option key={a.student_id} value={a.student_id}>
                          {a.nombre} · {a.sede}
                        </option>
                      ))}
                    </select>
                    <input type="number" step="0.5" min="0.5" required value={cuentaForm.horas_prometidas}
                      onChange={e => setCuentaForm(p=>({...p, horas_prometidas: e.target.value}))}
                      placeholder="HORAS COMPRADAS" className={inp} />
                    <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total}
                      onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))}
                      onBlur={e=>{ const n=parseFloat(e.target.value); if(!isNaN(n)) setCuentaForm(p=>({...p,monto_total:round2(n).toString()})); }}
                      placeholder="MONTO ($)" className={inp} />
                    <input required value={cuentaForm.concepto} onChange={e=>setCuentaForm(p=>({...p,concepto:e.target.value}))}
                      placeholder="CONCEPTO (ej: PAQUETE 10 HORAS)" className={`${inp} md:col-span-2`} />
                    <input type="date" required value={cuentaForm.fecha_emision}
                      onChange={e=>setCuentaForm(p=>({...p,fecha_emision:e.target.value}))} className={inp} style={{textTransform:'none'}} />
                    <label className="flex items-center gap-3 bg-black/40 border border-white/10 rounded-2xl p-4 cursor-pointer md:col-span-3">
                      <input type="checkbox" checked={cuentaForm.ya_pagado}
                        onChange={e => setCuentaForm(p => ({ ...p, ya_pagado: e.target.checked }))}
                        className="w-4 h-4 accent-[#E1AD01]" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-300">
                        Pago recibido de una vez — acredita horas inmediatamente (no queda como pendiente)
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <select value={cuentaForm.moneda} onChange={e=>setCuentaForm(p=>({...p,moneda:e.target.value as any}))} className={inp}>
                      <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option>
                      <option value="CASH">CASH</option><option value="BS">BS</option>
                    </select>
                    <select value={cuentaForm.entidad_tipo} onChange={e=>setCuentaForm(p=>({...p,entidad_tipo:e.target.value,entidad_nombre:e.target.value==='PROVEEDOR'?'':p.entidad_nombre,proveedor_id:''}))} className={inp}>
                      <option value="LIBRE">Entidad Libre</option>
                      <option value="PROVEEDOR">Proveedor Registrado</option>
                    </select>
                    {cuentaForm.entidad_tipo === 'PROVEEDOR' ? (
                      <select required value={cuentaForm.proveedor_id}
                        onChange={e => { const v=vendors.find(v=>v.id===e.target.value); setCuentaForm(p=>({...p,proveedor_id:e.target.value,entidad_nombre:v?.name||''})); }}
                        className={inp}>
                        <option value="">— PROVEEDOR —</option>
                        {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    ) : (
                      <input required value={cuentaForm.entidad_nombre}
                        onChange={e=>setCuentaForm(p=>({...p,entidad_nombre:e.target.value}))}
                        placeholder="NOMBRE ENTIDAD / DEUDOR" className={inp} />
                    )}
                    <input type="number" step="0.01" min="0.01" required value={cuentaForm.monto_total}
                      onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))}
                      onBlur={e=>{ const n=parseFloat(e.target.value); if(!isNaN(n)) setCuentaForm(p=>({...p,monto_total:round2(n).toString()})); }}
                      placeholder="MONTO" className={inp} />
                    <input required value={cuentaForm.concepto} onChange={e=>setCuentaForm(p=>({...p,concepto:e.target.value}))}
                      placeholder="CONCEPTO / DESCRIPCIÓN" className={inp} />
                    <input type="date" required value={cuentaForm.fecha_emision}
                      onChange={e=>setCuentaForm(p=>({...p,fecha_emision:e.target.value}))} className={inp} style={{textTransform:'none'}} />
                    <input type="date" value={cuentaForm.fecha_vencimiento}
                      onChange={e=>setCuentaForm(p=>({...p,fecha_vencimiento:e.target.value}))} className={inp} style={{textTransform:'none'}} />
                    <input value={cuentaForm.notas||''} onChange={e=>setCuentaForm(p=>({...p,notas:e.target.value}))}
                      placeholder="NOTAS (opcional)" className={inp} />
                  </>
                )}

                <ErrorBanner msg={cuentaError} onClose={() => setCuentaError(null)} />
                <div className="md:col-span-3 flex gap-3">
                  <button type="submit" disabled={savingCuenta}
                    className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                    {savingCuenta ? <Loader2 className="animate-spin h-4 w-4" /> : <><ShieldCheck size={14}/> Sellar Cuenta</>}
                  </button>
                  <button type="button" onClick={() => { setShowCuentaForm(false); setCuentaError(null); }}
                    className="px-6 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* NUEVO v11.0 — CxC (cuentas_por_cobrar, alumnos) y CxP (cuentas_generales, proveedores) separados */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* CxC — alumnos */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-yellow-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowUpCircle className="text-yellow-400 h-4 w-4" /> Cuentas por Cobrar (Alumnos)
                  <span className="ml-auto font-mono text-yellow-400">
                    ${totalCxC.toLocaleString('es-VE',{minimumFractionDigits:2})}
                  </span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentasCxC.map(c => (
                  <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all
                                              ${c.estatus==='COBRADO' ? 'border-emerald-500/10 opacity-50' : 'border-yellow-500/10 hover:bg-white/[0.04]'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-[10px] font-black uppercase">{c.nombre_alumno}</p>
                        <p className="text-[8px] text-zinc-600 font-mono">{c.concepto} · {fmtDate(c.fecha_emision)}</p>
                        <p className="text-[8px] text-[#E1AD01] font-mono mt-0.5">
                          {c.horas_prometidas}h prometidas
                          {c.estatus === 'COBRADO' && ` · ${c.horas_compradas}h acreditadas`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`font-black italic text-base ${c.estatus==='COBRADO' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                          ${c.monto_pendiente.toLocaleString('es-VE',{minimumFractionDigits:2})}
                        </p>
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full
                          ${c.estatus==='COBRADO' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                          {c.estatus}
                        </span>
                      </div>
                    </div>
                    {c.estatus !== 'COBRADO' && (
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => handlePagarCuenta(c.id, true)} disabled={savingAction === c.id}
                          className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                          {savingAction === c.id ? <Loader2 size={11} className="animate-spin" /> : <><CheckCircle2 size={11}/> Cobrado (acredita horas)</>}
                        </button>
                        <button onClick={() => handleDeleteCuenta(c.id, true)} disabled={savingAction === c.id}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {cuentasCxC.length === 0 && (
                  <div className="text-center py-12 text-zinc-700">
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por cobrar</p>
                  </div>
                )}
              </div>
            </div>

            {/* CxP — proveedores */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-red-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowDownCircle className="text-red-400 h-4 w-4" /> Cuentas por Pagar
                  <span className="ml-auto font-mono text-red-400">
                    ${totalCxP.toLocaleString('es-VE',{minimumFractionDigits:2})}
                  </span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentas.map(c => (
                  <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all
                                              ${c.estatus==='PAGADO' ? 'border-emerald-500/10 opacity-50' : 'border-red-500/10 hover:bg-white/[0.04]'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-[10px] font-black uppercase">{c.entidad_nombre}</p>
                        <p className="text-[8px] text-zinc-600 font-mono">{c.concepto} · {fmtDate(c.fecha_emision)}</p>
                        {c.fecha_vencimiento && (
                          <p className="text-[8px] text-orange-400/70 font-mono mt-0.5">Vence: {fmtDate(c.fecha_vencimiento)}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`font-black italic text-base ${c.estatus==='PAGADO' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtMonto(c.monto_pendiente, c.moneda)}
                        </p>
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full
                          ${c.estatus==='PAGADO' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                          {c.estatus}
                        </span>
                      </div>
                    </div>
                    {c.estatus !== 'PAGADO' && (
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => handlePagarCuenta(c.id, false)} disabled={savingAction === c.id}
                          className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1 disabled:opacity-30">
                          {savingAction === c.id ? <Loader2 size={11} className="animate-spin" /> : <><CheckCircle2 size={11}/> Pagado</>}
                        </button>
                        <button onClick={() => handleDeleteCuenta(c.id, false)} disabled={savingAction === c.id}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-30">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {cuentas.length === 0 && (
                  <div className="text-center py-12 text-zinc-700">
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por pagar</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ TAB: REQUISICIONES ═══════════════════════════ */}
      {activeTab === 'REQUISITIONS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
              <FileSignature className="text-[#E1AD01] h-4 w-4" /> Nueva Requisición
            </h3>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <textarea required value={reqItems} onChange={e=>setReqItems(e.target.value)} rows={3}
                className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-xs font-mono outline-none focus:border-[#E1AD01] text-white uppercase placeholder:text-white/20 resize-none"
                placeholder="DETALLE OPERATIVO DE LA REQUISICIÓN..." disabled={savingReq} />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" step="0.01" min="0.01" required value={reqAmount} onChange={e=>setReqAmount(e.target.value)}
                  placeholder="COSTO ESTIMADO ($)" className={inp} disabled={savingReq} />
                <select value={reqPriority} onChange={e=>setReqPriority(e.target.value)} className={inp} disabled={savingReq}>
                  <option value="BAJA">BAJA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="CRITICA">AOG — CRÍTICA</option>
                </select>
              </div>
              <ErrorBanner msg={reqError} onClose={() => setReqError(null)} />
              <button type="submit" disabled={savingReq}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {savingReq ? <Loader2 className="animate-spin h-4 w-4" /> : 'Sellar Requisición'}
              </button>
            </form>
          </div>

          <div className={`${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Aprobación</h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[480px] p-4 space-y-3">
              {requests.map(req => {
                let item: any = {};
                try { item = JSON.parse(req.items || '{}'); } catch {}
                return (
                  <div key={req.id} className="bg-white/[0.02] border border-white/[0.05] p-5 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-[8px] font-black text-[#E1AD01] bg-[#E1AD01]/10 px-2 py-1 rounded-full tracking-widest">
                          {req.nro_solicitud || 'REQ'}
                        </span>
                        <p className="text-[10px] font-mono uppercase mt-2">{item.description}</p>
                        <p className="text-[#E1AD01] text-xl font-black italic mt-1">
                          ${round2(Number(item.estimated_cost)||0).toLocaleString('es-VE',{minimumFractionDigits:2})}
                        </p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase
                                        ${req.prioridad==='CRITICA' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-400'}`}>
                        {req.prioridad}
                      </span>
                    </div>
                    {req.estatus==='PENDIENTE_REVISION' && (userRole==='CEO'||userRole==='ADMIN') ? (
                      <div className="flex gap-2 border-t border-white/5 pt-3">
                        <button onClick={() => handleApproveReq(req.id, Number(item.estimated_cost), item.description)}
                          disabled={savingAction === req.id}
                          className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-[9px] font-black uppercase hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                          {savingAction === req.id ? <Loader2 size={12} className="animate-spin" /> : 'Aprobar'}
                        </button>
                        <button className="flex-1 py-2.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-[9px] font-black uppercase hover:bg-red-500/20 transition-all">
                          Rechazar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-[9px] font-black uppercase text-zinc-600 italic pt-2 border-t border-white/5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-zinc-700" /> {req.estatus}
                      </div>
                    )}
                  </div>
                );
              })}
              {requests.length === 0 && (
                <div className="text-center py-16 text-zinc-700">
                  <p className="text-[9px] font-black uppercase tracking-widest">Sin requisiciones</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ TAB: CIERRE ══════════════════════════════════ */}
      {activeTab === 'CLOSING' && (() => {
        const METODOS: { m: PaymentMethod; label: string; prefix: string }[] = [
          { m: 'USDT',  label: 'USDT (Crypto)',  prefix: '$'  },
          { m: 'ZELLE', label: 'Zelle (USD)',     prefix: '$'  },
          { m: 'CASH',  label: 'Efectivo (USD)',  prefix: '$'  },
          { m: 'BS',    label: 'Bolívares',       prefix: 'Bs' },
        ];

        const handleCierre = () => {
          const disc: string[] = [];
          METODOS.forEach(({ m, label, prefix }) => {
            const teorico = getVaultBalance(m);
            const fisico  = round2(parseFloat(physBalances[m]) || 0);
            const diff    = round2(Math.abs(teorico - fisico));
            if (diff > 0.01) disc.push(`${label}: ${prefix} ${diff.toFixed(2)} de diferencia`);
          });
          if (disc.length > 0) alert('⚠️ DISCREPANCIAS DETECTADAS:\n\n' + disc.join('\n'));
          else {
            alert('✓ CIERRE CERTIFICADO\nTodos los métodos cuadran. Sin discrepancias.');
            setPhysBalances({ USDT:'', ZELLE:'', CASH:'', BS:'' });
          }
        };

        return (
          <div className="space-y-6">
            {/* FIX 3 — tasa BCV configurable */}
            <div className={`${glass} rounded-2xl p-5 flex items-center justify-between`}>
              <div>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">
                  Tasa BCV (Bs/USD) — para totales consolidados
                </p>
                <p className="text-[8px] text-zinc-700">Solo afecta el display de equivalencias. Los montos en BD se guardan en moneda nativa.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[#E1AD01] font-black font-mono">Bs</span>
                <input type="number" step="0.01" min="1" value={tasaBCV}
                  onChange={e => { const n=parseFloat(e.target.value); if(!isNaN(n)&&n>0) setTasaBCV(n); }}
                  className="w-28 bg-black/40 border border-[#E1AD01]/30 rounded-xl px-3 py-2 text-[#E1AD01] font-black font-mono text-sm text-center outline-none" />
              </div>
            </div>

            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="font-black text-[12px] uppercase tracking-widest mb-7 italic flex items-center gap-3">
                <Lock className="text-[#E1AD01] h-5 w-5" /> Cierre Multi-Moneda
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METODOS.map(({ m, label, prefix }) => {
                  const teorico  = getVaultBalance(m);  // FIX 2 — ya es nativo
                  const fisico   = round2(parseFloat(physBalances[m]) || 0);
                  const diff     = physBalances[m] !== '' ? round2(teorico - fisico) : null;
                  const cuadra   = diff !== null && Math.abs(diff) <= 0.01;
                  const descuadra = diff !== null && Math.abs(diff) > 0.01;
                  return (
                    <div key={m} className={`rounded-2xl border p-5 space-y-4 transition-all
                                            ${cuadra ? 'bg-emerald-500/5 border-emerald-500/20'
                                              : descuadra ? 'bg-red-500/5 border-red-500/20'
                                              : MONEDA_BG[m]}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>{label}</span>
                        {cuadra && (
                          <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                            <CheckCircle2 size={10}/> Cuadrado
                          </span>
                        )}
                        {descuadra && (
                          <span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                            ⚠ Dif. {prefix} {Math.abs(diff!).toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="bg-black/30 rounded-xl p-4 text-center">
                        <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Saldo Teórico</p>
                        <p className={`text-xl font-black italic font-mono ${MONEDA_COLOR[m]}`}>
                          {prefix} {teorico.toLocaleString('es-VE',{minimumFractionDigits:2})}
                        </p>
                        {m === 'BS' && tasaBCV > 0 && (
                          <p className="text-[8px] text-zinc-600 mt-1 font-mono">
                            ≈ ${round2(teorico/tasaBCV).toLocaleString('es-VE',{minimumFractionDigits:2})} USD @ {tasaBCV}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2 text-center">Conteo Físico</label>
                        <div className="relative">
                          <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${MONEDA_COLOR[m]}`}>{prefix}</span>
                          <input type="number" step="0.01" value={physBalances[m]}
                            onChange={e => setPhysBalances(p=>({...p,[m]:e.target.value}))}
                            className={`w-full bg-black/50 border py-4 pl-10 pr-4 rounded-xl text-xl font-black italic outline-none text-center text-white transition-all
                                        ${cuadra ? 'border-emerald-500/50 focus:border-emerald-400'
                                          : descuadra ? 'border-red-500/50 focus:border-red-400'
                                          : 'border-white/10 focus:border-[#E1AD01]'}`}
                            placeholder="0.00" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {METODOS.some(({ m }) => {
                const f = parseFloat(physBalances[m]);
                return !isNaN(f) && f !== 0 && Math.abs(round2(getVaultBalance(m) - f)) > 0.01;
              }) && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5 space-y-2 mt-5">
                  <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-2">⚠ Discrepancias Detectadas</p>
                  {METODOS.map(({ m, label, prefix }) => {
                    const t = getVaultBalance(m);
                    const f = round2(parseFloat(physBalances[m]) || 0);
                    const d = round2(t - f);
                    if (Math.abs(d) <= 0.01 || physBalances[m] === '') return null;
                    return (
                      <div key={m} className="flex justify-between items-center text-[10px]">
                        <span className={`font-black uppercase ${MONEDA_COLOR[m]}`}>{label}</span>
                        <span className={`font-mono italic font-black ${d > 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                          {d > 0 ? 'Faltante' : 'Sobrante'}: {prefix} {Math.abs(d).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <button onClick={handleCierre}
                className="w-full py-5 bg-red-600 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-500 transition-all mt-5">
                <Lock className="h-4 w-4" /> Certificar Cierre Multi-Moneda
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
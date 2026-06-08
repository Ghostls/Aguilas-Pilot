// src/components/FinancePanel.tsx
// VALKYRON FINANCIAL INTELLIGENCE CENTER v9.0
// EVOLUCIÓN: Cajas Chicas por responsable + CxC/CxP General (entidades libres)
// REGLA DE ORO: CERO OMISIONES. IDIOMA ESPAÑOL. GRADO MILITAR.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  DollarSign, ArrowUpCircle, ArrowDownCircle, FileText,
  PlusCircle, X, Loader2, TrendingUp, Wallet, UserCheck,
  ShieldCheck, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Cpu, Activity, UserPlus, Truck,
  Trash2, Download, Coins, Users, Banknote, ArrowRight,
  ChevronDown, ChevronUp, AlertCircle, ReceiptText, HandCoins
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────
export type PaymentMethod = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE';
export type TabType = 'LEDGER' | 'BÓVEDAS' | 'CAJAS' | 'CUENTAS' | 'REQUISITIONS' | 'CLOSING';

interface CajaChica {
  id: string;
  nombre: string;
}

interface MovimientoCaja {
  id: string;
  caja_id: string;
  tipo: 'ENTRADA' | 'SALIDA';
  moneda: PaymentMethod;
  monto: number;
  concepto: string;
  referencia: string;
  fecha: string;
  registrado_por: string;
}

interface CuentaGeneral {
  id: string;
  tipo: 'CXC' | 'CXP';
  entidad_nombre: string;
  entidad_tipo: string;
  proveedor_id?: string;
  moneda: PaymentMethod;
  monto_total: number;
  monto_pendiente: number;
  concepto: string;
  fecha_emision: string;
  fecha_vencimiento?: string;
  estatus: 'PENDIENTE' | 'PAGADO' | 'PARCIAL';
  notas?: string;
}

interface FinancePanelProps {
  vendors: Vendor[];
  inventory: any[];
  userRole?: string;
  setGlobalFinance?: React.Dispatch<React.SetStateAction<{
    CASH: number; ZELLE: number; USDT: number; BS: number;
  }>>;
}

// ─── ESTILOS ──────────────────────────────────────────────────────────────────
const glass = "bg-white/[0.02] backdrop-blur-[40px] border border-white/[0.07] shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inp   = "bg-black/50 border border-white/10 p-4 rounded-2xl text-white text-xs font-mono outline-none focus:border-[#E1AD01]/60 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all w-full uppercase placeholder:text-white/20";

const TASA_BS_USD    = 36.50;
const COSTO_HORA_VUELO = 80;

const fmtCurrency = (amount: number, moneda: PaymentMethod) => {
  const prefix = moneda === 'BS' ? 'Bs ' : '$';
  return `${prefix}${amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const MONEDA_COLOR: Record<PaymentMethod, string> = {
  USDT:  'text-emerald-400',
  ZELLE: 'text-blue-400',
  CASH:  'text-yellow-400',
  BS:    'text-orange-400',
};
const MONEDA_BG: Record<PaymentMethod, string> = {
  USDT:  'bg-emerald-500/10 border-emerald-500/20',
  ZELLE: 'bg-blue-500/10 border-blue-500/20',
  CASH:  'bg-yellow-500/10 border-yellow-500/20',
  BS:    'bg-orange-500/10 border-orange-500/20',
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export const FinancePanel: React.FC<FinancePanelProps> = ({
  vendors, inventory, userRole = 'CEO', setGlobalFinance = () => {}
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('LEDGER');

  // Data
  const [transactions,  setTransactions]  = useState<FinanceTransaction[]>([]);
  const [requests,      setRequests]      = useState<any[]>([]);
  const [cajas,         setCajas]         = useState<CajaChica[]>([]);
  const [movCajas,      setMovCajas]      = useState<MovimientoCaja[]>([]);
  const [cuentas,       setCuentas]       = useState<CuentaGeneral[]>([]);
  const [capitanes,     setCapitanes]     = useState<any[]>([]);
  const [students,      setStudents]      = useState<any[]>([]);

  // UI state
  const [loading,       setLoading]       = useState(true);
  const [submitting,    setSubmitting]    = useState(false);
  const [syncing,       setSyncing]       = useState(false);
  const [selectedVault, setSelectedVault] = useState<PaymentMethod>('USDT');
  const [cajaActiva,    setCajaActiva]    = useState<string | null>(null);

  // Ledger form
  const [ledger, setLedger] = useState({
    amount: '', currency: 'USDT' as PaymentMethod, type: 'INCOME' as TransactionType,
    reference: '', capitanId: '', fecha: new Date().toISOString().split('T')[0],
  });

  // Caja Chica form
  const [movForm, setMovForm] = useState({
    tipo: 'ENTRADA' as 'ENTRADA' | 'SALIDA',
    moneda: 'CASH' as PaymentMethod,
    monto: '', concepto: '', referencia: '', fecha: new Date().toISOString().split('T')[0],
  });

  // Cuenta General form
  const [cuentaForm, setCuentaForm] = useState({
    tipo: 'CXC' as 'CXC' | 'CXP',
    entidad_nombre: '', entidad_tipo: 'LIBRE',
    proveedor_id: '', moneda: 'USDT' as PaymentMethod,
    monto_total: '', concepto: '',
    fecha_emision: new Date().toISOString().split('T')[0],
    fecha_vencimiento: '', notas: '',
  });
  const [showCuentaForm, setShowCuentaForm] = useState(false);

  // Requisition form
  const [reqItems,    setReqItems]    = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount,   setReqAmount]   = useState('');

  // Cierre
  const [physBalances, setPhysBalances] = useState<Record<PaymentMethod, string>>({ USDT:'', ZELLE:'', CASH:'', BS:'' });

  // ── FETCH ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [txRes, reqRes, cajasRes, movRes, cuentasRes, capRes, stuRes] = await Promise.all([
        supabase.from('transacciones_finanzas').select('*').order('issue_date', { ascending: false }),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cajas_chicas').select('*').order('nombre'),
        supabase.from('movimientos_caja_chica').select('*').order('fecha', { ascending: false }),
        supabase.from('cuentas_generales').select('*').order('fecha_emision', { ascending: false }),
        supabase.from('capitanes').select('*').order('nombre'),
        supabase.from('perfiles_estudiantes').select('id,nombre_completo,student_serial').eq('academic_status','ACTIVO').order('nombre_completo'),
      ]);

      if (txRes.data) {
        setTransactions(txRes.data.map((t: any) => ({
          id: t.id, type: t.type, entityId: t.entity_id, entityName: t.entity_name || 'MOVIMIENTO',
          amount: Number(t.amount) || 0, invoiceNumber: t.invoice_number || 'S/N',
          description: t.description || '', status: t.status || 'PENDING',
          issueDate: t.issue_date, category: t.category || 'General',
          payment_method: t.payment_method,
        })));
      }
      if (reqRes.data)     setRequests(reqRes.data);
      if (cajasRes.data)   setCajas(cajasRes.data);
      if (movRes.data)     setMovCajas(movRes.data);
      if (cuentasRes.data) setCuentas(cuentasRes.data);
      if (capRes.data)     setCapitanes(capRes.data);
      if (stuRes.data)     setStudents(stuRes.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const ch = supabase.channel('finance-v9')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_finanzas' },  fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_compra' },       fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cajas_chicas' },             fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_caja_chica' },   fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_generales' },        fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchAll]);

  // ── MÉTRICAS ───────────────────────────────────────────────────────────────
  const getVaultBalance = (method: PaymentMethod) =>
    transactions
      .filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((acc, t) => {
        const plus = t.type === 'INCOME' || t.type === 'RECEIVABLE';
        return plus ? acc + t.amount : acc - t.amount;
      }, 0);

  const getCajaBalance = (cajaId: string, moneda: PaymentMethod) =>
    movCajas
      .filter(m => m.caja_id === cajaId && m.moneda === moneda)
      .reduce((acc, m) => m.tipo === 'ENTRADA' ? acc + m.monto : acc - m.monto, 0);

  const getCajaSaldosPorMoneda = (cajaId: string): Partial<Record<PaymentMethod, number>> => {
    const saldos: Partial<Record<PaymentMethod, number>> = {};
    (['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).forEach(m => {
      const s = getCajaBalance(cajaId, m);
      if (s !== 0) saldos[m] = s;
    });
    return saldos;
  };

  const totalIncome  = useMemo(() => transactions.filter(t => (t.type==='INCOME'||t.type==='RECEIVABLE') && t.status==='PAID').reduce((a,t)=>a+t.amount,0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter(t => (t.type==='EXPENSE'||t.type==='PAYABLE'||t.type==='INSTRUCTOR_PAY') && t.status==='PAID').reduce((a,t)=>a+t.amount,0), [transactions]);
  const totalCxC     = useMemo(() => cuentas.filter(c=>c.tipo==='CXC'&&c.estatus!=='PAGADO').reduce((a,c)=>a+c.monto_pendiente,0), [cuentas]);
  const totalCxP     = useMemo(() => cuentas.filter(c=>c.tipo==='CXP'&&c.estatus!=='PAGADO').reduce((a,c)=>a+c.monto_pendiente,0), [cuentas]);

  const theoreticalUSD = useMemo(() =>
    transactions.filter(t=>['USDT','ZELLE','CASH'].includes(t.payment_method)&&t.status==='PAID')
      .reduce((a,t) => (t.type==='INCOME'||t.type==='RECEIVABLE') ? a+t.amount : a-t.amount, 0)
  , [transactions]);

  const theoreticalBS = useMemo(() =>
    transactions.filter(t=>t.payment_method==='BS'&&t.status==='PAID')
      .reduce((a,t) => {
        const bs = t.amount * TASA_BS_USD;
        return (t.type==='INCOME'||t.type==='RECEIVABLE') ? a+bs : a-bs;
      }, 0)
  , [transactions]);

  // Teórico por método individual
  const getTheoreticalByMethod = (method: PaymentMethod) => {
    return transactions
      .filter(t => t.payment_method === method && t.status === 'PAID')
      .reduce((a, t) => {
        const plus = t.type === 'INCOME' || t.type === 'RECEIVABLE';
        const amount = method === 'BS' ? t.amount * TASA_BS_USD : t.amount;
        return plus ? a + amount : a - amount;
      }, 0);
  };

  // ── HANDLERS ───────────────────────────────────────────────────────────────
  const genHash = (s: string) => {
    let h = 0;
    for (let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h=h&h;}
    return Math.abs(h).toString(16).padStart(8,'0').toUpperCase();
  };

  const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return '—';
    const dt = new Date(d instanceof Date ? d.toISOString() : d);
    return new Date(dt.getTime()+dt.getTimezoneOffset()*60000)
      .toLocaleDateString('es-VE',{day:'2-digit',month:'2-digit',year:'numeric'});
  };

  // Ledger
  const handleLedger = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(ledger.amount);
    if (isNaN(num)||num<=0) return;
    setSyncing(true);
    const usd = ledger.currency==='BS' ? Math.round((num/TASA_BS_USD)*100)/100 : num;
    const cap = capitanes.find(c=>c.id===ledger.capitanId);
    const { error } = await supabase.from('transacciones_finanzas').insert([{
      type: ledger.type,
      entity_name: ledger.type==='INSTRUCTOR_PAY' ? `PAGO: ${cap?.nombre}` : `FLUJO ${ledger.currency}`,
      amount: usd, invoice_number: `TX-${genHash(ledger.type+usd+Date.now())}`,
      description: ledger.reference || 'REGISTRO MANUAL', status: 'PAID',
      category: ledger.type==='INSTRUCTOR_PAY' ? 'Nomina' : 'General',
      payment_method: ledger.currency,
      issue_date: new Date(ledger.fecha).toISOString(),
    }]);
    if (error) alert('Error: '+error.message);
    else { setLedger(p=>({...p, amount:'', reference:''})); fetchAll(); }
    setSyncing(false);
  };

  // Movimiento de caja chica
  const handleMovCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cajaActiva) return;
    const num = parseFloat(movForm.monto);
    if (isNaN(num)||num<=0) return;
    setSyncing(true);

    const { error: movErr } = await supabase.from('movimientos_caja_chica').insert([{
      caja_id:        cajaActiva,
      tipo:           movForm.tipo,
      moneda:         movForm.moneda,
      monto:          num,
      concepto:       movForm.concepto.toUpperCase(),
      referencia:     movForm.referencia.toUpperCase(),
      fecha:          new Date(movForm.fecha).toISOString(),
      registrado_por: userRole,
    }]);

    if (!movErr) {
      setMovForm(p=>({...p, monto:'', concepto:'', referencia:''}));
      fetchAll();
    } else { alert('Error: '+movErr.message); }
    setSyncing(false);
  };

  // Cuenta General
  const handleCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(cuentaForm.monto_total);
    if (isNaN(num)||num<=0||!cuentaForm.entidad_nombre.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('cuentas_generales').insert([{
      tipo:             cuentaForm.tipo,
      entidad_nombre:   cuentaForm.entidad_nombre.toUpperCase(),
      entidad_tipo:     cuentaForm.entidad_tipo,
      proveedor_id:     cuentaForm.proveedor_id || null,
      moneda:           cuentaForm.moneda,
      monto_total:      num,
      monto_pendiente:  num,
      concepto:         cuentaForm.concepto.toUpperCase(),
      fecha_emision:    new Date(cuentaForm.fecha_emision).toISOString(),
      fecha_vencimiento: cuentaForm.fecha_vencimiento ? new Date(cuentaForm.fecha_vencimiento).toISOString() : null,
      estatus:          'PENDIENTE',
      notas:            cuentaForm.notas,
    }]);
    if (error) alert('Error: '+error.message);
    else {
      setCuentaForm(p=>({...p, entidad_nombre:'', concepto:'', monto_total:'', notas:'', proveedor_id:'', fecha_vencimiento:''}));
      setShowCuentaForm(false);
      fetchAll();
    }
    setSubmitting(false);
  };

  // Marcar cuenta como pagada
  const handlePagarCuenta = async (id: string) => {
    setSyncing(true);
    await supabase.from('cuentas_generales').update({ estatus: 'PAGADO', monto_pendiente: 0 }).eq('id', id);
    fetchAll();
    setSyncing(false);
  };

  const handleDeleteCuenta = async (id: string) => {
    if (!window.confirm('¿Eliminar esta cuenta?')) return;
    setSyncing(true);
    await supabase.from('cuentas_generales').delete().eq('id', id);
    fetchAll();
    setSyncing(false);
  };

  const handleDeleteTx = async (id: string) => {
    if (!window.confirm('¿Eliminar transacción?')) return;
    setSyncing(true);
    await supabase.from('transacciones_finanzas').delete().eq('id', id);
    fetchAll();
    setSyncing(false);
  };

  const handleDeleteMovCaja = async (id: string, monto: number, tipo: 'ENTRADA'|'SALIDA', cajaId: string) => {
    if (!window.confirm('¿Revertir movimiento?')) return;
    setSyncing(true);
    await supabase.from('movimientos_caja_chica').delete().eq('id', id);
    fetchAll();
    setSyncing(false);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(reqAmount);
    if (!reqItems.trim()||isNaN(num)||num<=0) return alert('Datos inválidos.');
    setSubmitting(true);
    await supabase.from('solicitudes_compra').insert([{
      prioridad: reqPriority,
      items: JSON.stringify({ description: reqItems.toUpperCase(), estimated_cost: num }),
      estatus: 'PENDIENTE_REVISION',
      hash_auditoria: genHash(reqItems+reqAmount),
    }]);
    setReqItems(''); setReqAmount('');
    fetchAll(); setSubmitting(false);
  };

  const handleApproveReq = async (reqId: string, amount: number, desc: string) => {
    setSyncing(true);
    const hash = genHash('APPROVE'+reqId);
    await supabase.from('transacciones_finanzas').insert([{
      type:'PAYABLE', entity_name:'PROVEEDOR', amount,
      invoice_number:`OC-${hash}`, description:`[OK] ${desc}`,
      status:'PENDING', category:'Parts', payment_method:'USDT',
      issue_date: new Date().toISOString(),
    }]);
    await supabase.from('solicitudes_compra').update({ estatus:'APROBADO', aprobado_por: userRole }).eq('id', reqId);
    fetchAll(); setSyncing(false);
  };

  const handleExportCSV = () => {
    const rows = transactions.map(t => [
      fmtDate(t.issueDate), t.invoiceNumber, `"${t.entityName}"`,
      t.payment_method||'N/A', t.amount, t.type, t.status,
    ]);
    const csv = [['Fecha','Ref','Entidad','Metodo','Monto','Tipo','Estatus'].join(','), ...rows.map(r=>r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    a.download = `FinanzasAguilas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // ── LOADING ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-20 text-center bg-[#020202] h-screen flex flex-col justify-center items-center">
      <Loader2 className="h-12 w-12 text-[#E1AD01] animate-spin mb-6" />
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core v9.0...</p>
    </div>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in fade-in duration-700 font-mono text-white">

      {/* HEADER — solo tabs, el título lo maneja Index.tsx */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <p className="text-zinc-600 text-[9px] font-black uppercase tracking-[0.4em]">
          Valkyron Financial Core v9.0 // Águilas Pilot
        </p>

        {/* TABS */}
        <div className="flex flex-wrap gap-1 p-1.5 bg-black/60 rounded-2xl border border-white/5">
          {([
            { key: 'LEDGER',       label: 'Diario',   icon: Landmark       },
            { key: 'BÓVEDAS',      label: 'Bóvedas',  icon: Coins          },
            { key: 'CAJAS',        label: 'Cajas',    icon: Banknote       },
            { key: 'CUENTAS',      label: 'CxC/CxP',  icon: ReceiptText    },
            { key: 'REQUISITIONS', label: 'Reqs',     icon: FileSignature  },
            { key: 'CLOSING',      label: 'Cierre',   icon: Lock           },
          ] as {key: TabType; label: string; icon: any}[]).map(t => {
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

      {/* KPI STRIP — desglose por método de pago */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
          const ingresos = transactions
            .filter(t => t.payment_method===m && t.status==='PAID' && (t.type==='INCOME'||t.type==='RECEIVABLE'))
            .reduce((a,t)=>a+t.amount, 0);
          const egresos = transactions
            .filter(t => t.payment_method===m && t.status==='PAID' && (t.type==='EXPENSE'||t.type==='PAYABLE'||t.type==='INSTRUCTOR_PAY'))
            .reduce((a,t)=>a+t.amount, 0);
          const saldo = ingresos - egresos;
          const isBS  = m === 'BS';
          const fmt   = (n: number) => isBS
            ? `Bs ${(n*TASA_BS_USD).toLocaleString('es-VE',{minimumFractionDigits:2})}`
            : `$${n.toLocaleString('es-VE',{minimumFractionDigits:2})}`;
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
                  <p className="text-emerald-400 font-black text-xs italic">{fmt(ingresos)}</p>
                </div>
                <div>
                  <p className="text-[7px] text-zinc-600 uppercase font-black tracking-widest mb-1">Egresado</p>
                  <p className="text-red-400 font-black text-xs italic">{fmt(egresos)}</p>
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

      {/* CxC/CxP totales — fila secundaria */}
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

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: DIARIO GENERAL
      ══════════════════════════════════════════════════════════════════════ */}
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
                className={inp} style={{textTransform:'none'}}
              />
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
                <select required value={ledger.capitanId} onChange={e => setLedger(p=>({...p, capitanId:e.target.value}))} className={inp}>
                  <option value="">— CAPITÁN —</option>
                  {capitanes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#E1AD01] font-black text-xl">
                  {ledger.currency === 'BS' ? 'Bs' : '$'}
                </span>
                <input type="number" step="any" required value={ledger.amount}
                  onChange={e => setLedger(p=>({...p, amount: e.target.value}))}
                  className="w-full bg-white/5 border border-white/10 py-8 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                  placeholder="0.00"
                />
              </div>
              <input value={ledger.reference} onChange={e => setLedger(p=>({...p, reference: e.target.value}))}
                placeholder="REFERENCIA / TRAZABILIDAD" className={inp} />
              <button type="submit" disabled={syncing}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                {syncing ? <Loader2 className="animate-spin h-4 w-4" /> : 'Sellar Registro'}
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
                      {fmtDate(t.issueDate)} · {t.invoiceNumber} · <span className={MONEDA_COLOR[t.payment_method as PaymentMethod] || 'text-zinc-500'}>{t.payment_method}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE') ? '+' : '-'}
                      {t.payment_method==='BS' ? `Bs ${(t.amount*TASA_BS_USD).toLocaleString()}` : `$${t.amount.toLocaleString()}`}
                    </span>
                    {t.status==='PAID'
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500/40 shrink-0" />
                      : <Loader2 className="h-4 w-4 text-[#E1AD01] animate-spin shrink-0" />
                    }
                    <button onClick={() => handleDeleteTx(t.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10">
                      <Trash2 size={13}/>
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

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: BÓVEDAS (USDT / ZELLE / CASH / BS)
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'BÓVEDAS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className={`lg:col-span-4 ${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 italic">
              <Wallet className="text-[#E1AD01] h-4 w-4" /> Bóvedas Principales
            </h3>
            <div className="space-y-3">
              {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(curr => {
                const bal = getVaultBalance(curr);
                const active = selectedVault === curr;
                return (
                  <button key={curr} onClick={() => setSelectedVault(curr)}
                    className={`w-full p-5 rounded-2xl flex justify-between items-center border transition-all
                                ${active ? `${MONEDA_BG[curr]} ${MONEDA_COLOR[curr]}` : 'bg-white/[0.02] border-white/[0.05] text-zinc-500 hover:text-white hover:bg-white/[0.04]'}`}>
                    <div className="flex items-center gap-3">
                      <Coins className={`h-4 w-4 ${active ? '' : 'text-zinc-700'}`} />
                      <span className="font-black uppercase tracking-widest text-[10px]">{curr}</span>
                    </div>
                    <span className={`font-mono font-black text-lg italic ${active ? '' : 'text-zinc-400'}`}>
                      {curr==='BS'
                        ? `Bs ${(bal*TASA_BS_USD).toLocaleString('es-VE',{minimumFractionDigits:2})}`
                        : `$${bal.toLocaleString('es-VE',{minimumFractionDigits:2})}`
                      }
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
              {transactions.filter(t=>t.payment_method===selectedVault).map(t => (
                <div key={t.id} className="bg-white/[0.02] border border-white/[0.05] p-4 rounded-2xl flex justify-between items-center group">
                  <div>
                    <p className="text-[10px] font-black uppercase">{t.entityName}</p>
                    <p className="text-[8px] text-zinc-600 font-mono mt-0.5">{fmtDate(t.issueDate)} · {t.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-black text-lg italic ${(t.type==='INCOME'||t.type==='RECEIVABLE') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(t.type==='INCOME'||t.type==='RECEIVABLE') ? '+' : '-'}
                      {selectedVault==='BS'
                        ? `Bs ${(t.amount*TASA_BS_USD).toLocaleString()}`
                        : `$${t.amount.toLocaleString()}`
                      }
                    </span>
                    <button onClick={() => handleDeleteTx(t.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10">
                      <Trash2 size={13}/>
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

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: CAJAS CHICAS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'CAJAS' && (
        <div className="space-y-6">

          {/* Grid de cajas — 4 cards, una por responsable */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cajas.map(caja => {
              const saldos = getCajaSaldosPorMoneda(caja.id);
              const active = cajaActiva === caja.id;
              const hasMov = Object.keys(saldos).length > 0;
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
                  {/* Saldos por moneda */}
                  {hasMov ? (
                    <div className="space-y-1.5">
                      {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
                        const s = getCajaBalance(caja.id, m);
                        if (s === 0) return null;
                        return (
                          <div key={m} className="flex justify-between items-center">
                            <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                            <span className={`text-[10px] font-black italic ${s >= 0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>
                              {m==='BS' ? `Bs ${s.toLocaleString('es-VE',{minimumFractionDigits:2})}` : `$${s.toLocaleString('es-VE',{minimumFractionDigits:2})}`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[9px] text-zinc-700 font-mono italic">Sin movimientos</p>
                  )}
                </button>
              );
            })}
          </div>

          {/* Panel de caja activa */}
          {cajaActiva && (() => {
            const caja = cajas.find(c=>c.id===cajaActiva)!;
            const movs = movCajas.filter(m=>m.caja_id===cajaActiva);
            return (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Formulario de movimiento */}
                <div className={`lg:col-span-4 ${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01]`}>
                  <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic">
                    Caja: <span className="text-[#E1AD01]">{caja.nombre}</span>
                  </h3>
                  <form onSubmit={handleMovCaja} className="space-y-4">

                    {/* Tipo ENTRADA/SALIDA */}
                    <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10">
                      {(['ENTRADA','SALIDA'] as const).map(tipo => (
                        <button key={tipo} type="button"
                          onClick={() => setMovForm(p=>({...p, tipo}))}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all
                                      ${movForm.tipo===tipo
                                        ? tipo==='ENTRADA'
                                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                        : 'text-zinc-600 hover:text-zinc-400'}`}>
                          {tipo==='ENTRADA' ? '+ Entrada' : '- Salida'}
                        </button>
                      ))}
                    </div>

                    {/* Moneda del movimiento */}
                    <div>
                      <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2">Moneda</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => (
                          <button key={m} type="button"
                            onClick={() => setMovForm(p=>({...p, moneda: m}))}
                            className={`py-2.5 rounded-xl text-[9px] font-black uppercase border transition-all
                                        ${movForm.moneda===m
                                          ? `${MONEDA_BG[m]} ${MONEDA_COLOR[m]}`
                                          : 'bg-white/[0.02] border-white/[0.05] text-zinc-600 hover:text-zinc-400'}`}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <input type="date" required value={movForm.fecha}
                      onChange={e=>setMovForm(p=>({...p,fecha:e.target.value}))}
                      className={inp} style={{textTransform:'none'}}
                    />

                    <div className="relative">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 font-black text-xl" style={{color:'#E1AD01'}}>
                        {movForm.moneda==='BS' ? 'Bs' : '$'}
                      </span>
                      <input type="number" step="any" required value={movForm.monto}
                        onChange={e=>setMovForm(p=>({...p,monto:e.target.value}))}
                        className="w-full bg-white/5 border border-white/10 py-7 pl-14 pr-6 rounded-2xl text-3xl font-black italic outline-none focus:border-[#E1AD01] text-white"
                        placeholder="0.00"
                      />
                    </div>

                    <input value={movForm.concepto} onChange={e=>setMovForm(p=>({...p,concepto:e.target.value}))}
                      placeholder="CONCEPTO" className={inp} />
                    <input value={movForm.referencia} onChange={e=>setMovForm(p=>({...p,referencia:e.target.value}))}
                      placeholder="REFERENCIA (opcional)" className={inp} />

                    <button type="submit" disabled={syncing}
                      className={`w-full py-5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-40
                                  ${movForm.tipo==='ENTRADA'
                                    ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                                    : 'bg-red-500 text-white hover:bg-red-400'}`}>
                      {syncing ? <Loader2 className="animate-spin h-4 w-4" />
                        : movForm.tipo==='ENTRADA' ? '+ Registrar Entrada' : '- Registrar Salida'
                      }
                    </button>
                  </form>
                </div>

                {/* Historial */}
                <div className={`lg:col-span-8 ${glass} rounded-3xl overflow-hidden flex flex-col`}>
                  <div className="p-6 border-b border-white/5">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-[10px] font-black uppercase tracking-widest italic">
                        Historial · Caja {caja.nombre}
                      </h3>
                    </div>
                    {/* Saldos resumen por moneda */}
                    <div className="flex gap-3 flex-wrap">
                      {(['USDT','ZELLE','CASH','BS'] as PaymentMethod[]).map(m => {
                        const s = getCajaBalance(cajaActiva, m);
                        const movs_m = movCajas.filter(mv=>mv.caja_id===cajaActiva&&mv.moneda===m);
                        if (movs_m.length === 0) return null;
                        return (
                          <div key={m} className={`px-3 py-1.5 rounded-xl border ${MONEDA_BG[m]} flex items-center gap-2`}>
                            <span className={`text-[8px] font-black uppercase ${MONEDA_COLOR[m]}`}>{m}</span>
                            <span className={`text-[10px] font-black italic ${s>=0 ? MONEDA_COLOR[m] : 'text-red-400'}`}>
                              {m==='BS' ? `Bs ${s.toLocaleString('es-VE',{minimumFractionDigits:2})}` : `$${s.toLocaleString('es-VE',{minimumFractionDigits:2})}`}
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
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${MONEDA_BG[m.moneda]} ${MONEDA_COLOR[m.moneda]}`}>
                              {m.moneda}
                            </span>
                            <p className="text-[10px] font-black uppercase">{m.concepto || '—'}</p>
                          </div>
                          <p className="text-[8px] text-zinc-600 font-mono">
                            {fmtDate(m.fecha)}{m.referencia ? ` · ${m.referencia}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`font-black text-base italic ${m.tipo==='ENTRADA' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {m.tipo==='ENTRADA' ? '+' : '-'}
                            {m.moneda==='BS'
                              ? `Bs ${m.monto.toLocaleString('es-VE',{minimumFractionDigits:2})}`
                              : `$${m.monto.toLocaleString('es-VE',{minimumFractionDigits:2})}`}
                          </span>
                          <button onClick={() => handleDeleteMovCaja(m.id, m.monto, m.tipo, caja.id)}
                            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-500 transition-all p-1.5 rounded-lg hover:bg-red-500/10">
                            <Trash2 size={13}/>
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

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: CxC / CxP GENERAL
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'CUENTAS' && (
        <div className="space-y-6">

          {/* Botón nueva cuenta */}
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-5 py-3">
                <p className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Total CxC</p>
                <p className="text-lg font-black italic text-yellow-400">{fmtCurrency(totalCxC,'USDT')}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-3">
                <p className="text-[8px] text-zinc-500 uppercase font-black tracking-widest">Total CxP</p>
                <p className="text-lg font-black italic text-red-400">{fmtCurrency(totalCxP,'USDT')}</p>
              </div>
            </div>
            <button onClick={() => setShowCuentaForm(!showCuentaForm)}
              className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2">
              <PlusCircle size={14}/> Nueva Cuenta
            </button>
          </div>

          {/* Formulario nueva cuenta */}
          {showCuentaForm && (
            <div className={`${glass} rounded-3xl p-7 border-t-2 border-t-[#E1AD01] animate-in slide-in-from-top-4 duration-300`}>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
                <ReceiptText className="text-[#E1AD01] h-4 w-4" /> Registrar Cuenta
              </h3>
              <form onSubmit={handleCuenta} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Tipo CxC/CxP */}
                <div className="flex bg-black/50 rounded-2xl p-1 border border-white/10 md:col-span-1">
                  {(['CXC','CXP'] as const).map(tipo => (
                    <button key={tipo} type="button"
                      onClick={() => setCuentaForm(p=>({...p, tipo}))}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all
                                  ${cuentaForm.tipo===tipo
                                    ? tipo==='CXC'
                                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                    : 'text-zinc-600 hover:text-zinc-400'}`}>
                      {tipo==='CXC' ? 'Por Cobrar' : 'Por Pagar'}
                    </button>
                  ))}
                </div>

                {/* Moneda */}
                <select value={cuentaForm.moneda} onChange={e=>setCuentaForm(p=>({...p,moneda:e.target.value as any}))} className={inp}>
                  <option value="USDT">USDT</option>
                  <option value="ZELLE">ZELLE</option>
                  <option value="CASH">CASH</option>
                  <option value="BS">BS</option>
                </select>

                {/* Entidad tipo */}
                <select value={cuentaForm.entidad_tipo} onChange={e=>setCuentaForm(p=>({...p, entidad_tipo:e.target.value, entidad_nombre: e.target.value==='PROVEEDOR' ? '' : p.entidad_nombre, proveedor_id:''}))} className={inp}>
                  <option value="LIBRE">Entidad Libre</option>
                  <option value="PROVEEDOR">Proveedor Registrado</option>
                  <option value="CLIENTE">Cliente</option>
                </select>

                {/* Nombre entidad */}
                {cuentaForm.entidad_tipo === 'PROVEEDOR' ? (
                  <select required value={cuentaForm.proveedor_id}
                    onChange={e => {
                      const v = vendors.find(v=>v.id===e.target.value);
                      setCuentaForm(p=>({...p, proveedor_id: e.target.value, entidad_nombre: v?.name || ''}));
                    }} className={inp}>
                    <option value="">— PROVEEDOR —</option>
                    {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                ) : (
                  <input required value={cuentaForm.entidad_nombre}
                    onChange={e=>setCuentaForm(p=>({...p,entidad_nombre:e.target.value}))}
                    placeholder="NOMBRE ENTIDAD / DEUDOR" className={inp} />
                )}

                {/* Monto */}
                <input type="number" step="any" required value={cuentaForm.monto_total}
                  onChange={e=>setCuentaForm(p=>({...p,monto_total:e.target.value}))}
                  placeholder="MONTO" className={inp} />

                {/* Concepto */}
                <input required value={cuentaForm.concepto}
                  onChange={e=>setCuentaForm(p=>({...p,concepto:e.target.value}))}
                  placeholder="CONCEPTO / DESCRIPCIÓN" className={inp} />

                {/* Fechas */}
                <input type="date" required value={cuentaForm.fecha_emision}
                  onChange={e=>setCuentaForm(p=>({...p,fecha_emision:e.target.value}))}
                  className={inp} style={{textTransform:'none'}} />

                <input type="date" value={cuentaForm.fecha_vencimiento}
                  onChange={e=>setCuentaForm(p=>({...p,fecha_vencimiento:e.target.value}))}
                  className={inp} style={{textTransform:'none'}} />

                {/* Notas */}
                <input value={cuentaForm.notas||''}
                  onChange={e=>setCuentaForm(p=>({...p,notas:e.target.value}))}
                  placeholder="NOTAS (opcional)" className={inp} />

                <div className="md:col-span-3 flex gap-3">
                  <button type="submit" disabled={submitting}
                    className="flex-1 py-4 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all flex items-center justify-center gap-2 disabled:opacity-40">
                    {submitting ? <Loader2 className="animate-spin h-4 w-4" /> : <><ShieldCheck size={14}/> Sellar Cuenta</>}
                  </button>
                  <button type="button" onClick={() => setShowCuentaForm(false)}
                    className="px-6 py-4 border border-white/10 rounded-2xl text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Lista CxC */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CxC */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-yellow-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowUpCircle className="text-yellow-400 h-4 w-4" /> Cuentas por Cobrar
                  <span className="ml-auto text-yellow-400 font-mono">{fmtCurrency(totalCxC,'USDT')}</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentas.filter(c=>c.tipo==='CXC').map(c => (
                  <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all
                                              ${c.estatus==='PAGADO' ? 'border-emerald-500/10 opacity-50' : 'border-yellow-500/10 hover:bg-white/[0.04]'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-[10px] font-black uppercase">{c.entidad_nombre}</p>
                        <p className="text-[8px] text-zinc-600 font-mono">{c.concepto} · {fmtDate(c.fecha_emision)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-black italic text-base ${c.estatus==='PAGADO' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                          {fmtCurrency(c.monto_pendiente, c.moneda)}
                        </p>
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full
                                          ${c.estatus==='PAGADO' ? 'bg-emerald-500/10 text-emerald-500'
                                            : c.estatus==='PARCIAL' ? 'bg-blue-500/10 text-blue-400'
                                            : 'bg-yellow-500/10 text-yellow-500'}`}>
                          {c.estatus}
                        </span>
                      </div>
                    </div>
                    {c.estatus !== 'PAGADO' && (
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => handlePagarCuenta(c.id)}
                          className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1">
                          <CheckCircle2 size={11}/> Cobrado
                        </button>
                        <button onClick={() => handleDeleteCuenta(c.id)}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {cuentas.filter(c=>c.tipo==='CXC').length === 0 && (
                  <div className="text-center py-12 text-zinc-700">
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por cobrar</p>
                  </div>
                )}
              </div>
            </div>

            {/* CxP */}
            <div className={`${glass} rounded-3xl overflow-hidden`}>
              <div className="p-5 border-b border-white/5 bg-red-500/5">
                <h3 className="text-[10px] font-black uppercase tracking-widest italic flex items-center gap-2">
                  <ArrowDownCircle className="text-red-400 h-4 w-4" /> Cuentas por Pagar
                  <span className="ml-auto text-red-400 font-mono">{fmtCurrency(totalCxP,'USDT')}</span>
                </h3>
              </div>
              <div className="overflow-y-auto max-h-[420px] p-4 space-y-2">
                {cuentas.filter(c=>c.tipo==='CXP').map(c => (
                  <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 group transition-all
                                              ${c.estatus==='PAGADO' ? 'border-emerald-500/10 opacity-50' : 'border-red-500/10 hover:bg-white/[0.04]'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-[10px] font-black uppercase">{c.entidad_nombre}</p>
                        <p className="text-[8px] text-zinc-600 font-mono">{c.concepto} · {fmtDate(c.fecha_emision)}</p>
                        {c.fecha_vencimiento && (
                          <p className="text-[8px] text-orange-400/70 font-mono mt-0.5">
                            Vence: {fmtDate(c.fecha_vencimiento)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`font-black italic text-base ${c.estatus==='PAGADO' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtCurrency(c.monto_pendiente, c.moneda)}
                        </p>
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full
                                          ${c.estatus==='PAGADO' ? 'bg-emerald-500/10 text-emerald-500'
                                            : 'bg-red-500/10 text-red-500'}`}>
                          {c.estatus}
                        </span>
                      </div>
                    </div>
                    {c.estatus !== 'PAGADO' && (
                      <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => handlePagarCuenta(c.id)}
                          className="flex-1 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[9px] font-black uppercase border border-emerald-500/20 hover:bg-emerald-500/30 transition-all flex items-center justify-center gap-1">
                          <CheckCircle2 size={11}/> Pagado
                        </button>
                        <button onClick={() => handleDeleteCuenta(c.id)}
                          className="px-3 py-2 bg-red-500/10 text-red-400 rounded-xl border border-red-500/10 hover:bg-red-500/20 transition-all">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {cuentas.filter(c=>c.tipo==='CXP').length === 0 && (
                  <div className="text-center py-12 text-zinc-700">
                    <p className="text-[9px] font-black uppercase tracking-widest">Sin cuentas por pagar</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: REQUISICIONES
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'REQUISITIONS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className={`${glass} rounded-3xl p-7`}>
            <h3 className="text-[10px] font-black uppercase tracking-widest mb-6 italic flex items-center gap-2">
              <FileSignature className="text-[#E1AD01] h-4 w-4" /> Nueva Requisición
            </h3>
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <textarea required value={reqItems} onChange={e=>setReqItems(e.target.value)} rows={3}
                className="w-full bg-black/50 border border-white/10 p-5 rounded-2xl text-xs font-mono outline-none focus:border-[#E1AD01] text-white uppercase placeholder:text-white/20 resize-none"
                placeholder="DETALLE OPERATIVO DE LA REQUISICIÓN..." />
              <div className="grid grid-cols-2 gap-3">
                <input type="number" required value={reqAmount} onChange={e=>setReqAmount(e.target.value)}
                  placeholder="COSTO ESTIMADO ($)" className={inp} />
                <select value={reqPriority} onChange={e=>setReqPriority(e.target.value)} className={inp}>
                  <option value="BAJA">BAJA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="CRITICA">AOG — CRÍTICA</option>
                </select>
              </div>
              <button type="submit" disabled={submitting}
                className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-white transition-all disabled:opacity-40">
                {submitting ? <Loader2 className="animate-spin h-4 w-4 mx-auto" /> : 'Sellar Requisición'}
              </button>
            </form>
          </div>

          <div className={`${glass} rounded-3xl overflow-hidden flex flex-col`}>
            <div className="p-6 border-b border-white/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest italic">Aprobación</h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[480px] p-4 space-y-3">
              {requests.map(req => {
                const item = JSON.parse(req.items||'{}');
                return (
                  <div key={req.id} className="bg-white/[0.02] border border-white/[0.05] p-5 rounded-2xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-[8px] font-black text-[#E1AD01] bg-[#E1AD01]/10 px-2 py-1 rounded-full tracking-widest">
                          {req.nro_solicitud || 'REQ'}
                        </span>
                        <p className="text-[10px] font-mono uppercase mt-2">{item.description}</p>
                        <p className="text-[#E1AD01] text-xl font-black italic mt-1">${Number(item.estimated_cost).toLocaleString()}</p>
                      </div>
                      <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase
                                        ${req.prioridad==='CRITICA' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-400'}`}>
                        {req.prioridad}
                      </span>
                    </div>
                    {req.estatus==='PENDIENTE_REVISION' && (userRole==='CEO'||userRole==='ADMIN') ? (
                      <div className="flex gap-2 border-t border-white/5 pt-3">
                        <button onClick={() => handleApproveReq(req.id, item.estimated_cost, item.description)}
                          className="flex-1 py-2.5 bg-emerald-500 text-black rounded-xl text-[9px] font-black uppercase hover:bg-white transition-all">
                          Aprobar
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

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: CIERRE BI-MONEDA
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'CLOSING' && (() => {
        const METODOS: { m: PaymentMethod; label: string; prefix: string }[] = [
          { m: 'USDT',  label: 'USDT (Crypto)',   prefix: '$'  },
          { m: 'ZELLE', label: 'Zelle (USD)',      prefix: '$'  },
          { m: 'CASH',  label: 'Efectivo (USD)',   prefix: '$'  },
          { m: 'BS',    label: 'Bolívares (BS)',   prefix: 'Bs' },
        ];

        const handleCierre = () => {
          const discrepancias: string[] = [];
          METODOS.forEach(({ m, label, prefix }) => {
            const teorico = getTheoreticalByMethod(m);
            const fisico  = parseFloat(physBalances[m]) || 0;
            const diff    = Math.abs(teorico - fisico);
            if (diff > 0.01) {
              discrepancias.push(`${label}: ${prefix}${diff.toFixed(2)} de diferencia`);
            }
          });
          if (discrepancias.length > 0) {
            alert('⚠️ DISCREPANCIAS DETECTADAS:\n\n' + discrepancias.join('\n'));
          } else {
            alert('✓ CIERRE CERTIFICADO\nTodos los métodos cuadran. Sin discrepancias.');
            setPhysBalances({ USDT:'', ZELLE:'', CASH:'', BS:'' });
          }
        };

        return (
          <div className="space-y-6">
            <div className={`${glass} rounded-3xl p-7`}>
              <h3 className="font-black text-[12px] uppercase tracking-widest mb-7 italic flex items-center gap-3">
                <Lock className="text-[#E1AD01] h-5 w-5" /> Cierre Multi-Moneda
              </h3>

              {/* Grid 4 métodos */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METODOS.map(({ m, label, prefix }) => {
                  const teorico = getTheoreticalByMethod(m);
                  const fisico  = parseFloat(physBalances[m]) || 0;
                  const diff    = fisico !== 0 ? teorico - fisico : null;
                  const cuadra  = diff !== null && Math.abs(diff) <= 0.01;
                  const descuadra = diff !== null && Math.abs(diff) > 0.01;
                  return (
                    <div key={m} className={`rounded-2xl border p-5 space-y-4 transition-all
                                            ${cuadra    ? 'bg-emerald-500/5 border-emerald-500/20'
                                              : descuadra ? 'bg-red-500/5 border-red-500/20'
                                              : `${MONEDA_BG[m]}`}`}>
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase tracking-widest ${MONEDA_COLOR[m]}`}>
                          {label}
                        </span>
                        {cuadra && (
                          <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                            <CheckCircle2 size={10}/> Cuadrado
                          </span>
                        )}
                        {descuadra && (
                          <span className="text-[8px] font-black text-red-400 bg-red-500/10 px-2 py-1 rounded-full uppercase tracking-widest flex items-center gap-1">
                            ⚠ Dif. {prefix}{Math.abs(diff!).toFixed(2)}
                          </span>
                        )}
                      </div>

                      {/* Teórico */}
                      <div className="bg-black/30 rounded-xl p-4 text-center">
                        <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">Saldo Teórico</p>
                        <p className={`text-xl font-black italic font-mono ${MONEDA_COLOR[m]}`}>
                          {prefix} {teorico.toLocaleString('es-VE',{minimumFractionDigits:2})}
                        </p>
                      </div>

                      {/* Físico auditado */}
                      <div>
                        <label className="text-[8px] text-zinc-600 font-black uppercase tracking-widest block mb-2 text-center">
                          Conteo Físico
                        </label>
                        <div className="relative">
                          <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg ${MONEDA_COLOR[m]}`}>
                            {prefix}
                          </span>
                          <input
                            type="number" step="any"
                            value={physBalances[m]}
                            onChange={e => setPhysBalances(p=>({...p, [m]: e.target.value}))}
                            className={`w-full bg-black/50 border py-4 pl-10 pr-4 rounded-xl text-xl font-black italic outline-none text-center text-white transition-all
                                        ${cuadra    ? 'border-emerald-500/50 focus:border-emerald-400'
                                          : descuadra ? 'border-red-500/50 focus:border-red-400'
                                          : 'border-white/10 focus:border-[#E1AD01]'}`}
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Resumen de discrepancias en tiempo real */}
              {METODOS.some(({ m }) => {
                const f = parseFloat(physBalances[m]);
                return !isNaN(f) && f !== 0 && Math.abs(getTheoreticalByMethod(m) - f) > 0.01;
              }) && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5 space-y-2">
                  <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-2">⚠ Discrepancias Detectadas</p>
                  {METODOS.map(({ m, label, prefix }) => {
                    const teorico = getTheoreticalByMethod(m);
                    const fisico  = parseFloat(physBalances[m]) || 0;
                    const diff    = teorico - fisico;
                    if (Math.abs(diff) <= 0.01 || physBalances[m] === '') return null;
                    return (
                      <div key={m} className="flex justify-between items-center text-[10px]">
                        <span className={`font-black uppercase ${MONEDA_COLOR[m]}`}>{label}</span>
                        <span className={`font-mono italic font-black ${diff > 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                          {diff > 0 ? 'Faltante' : 'Sobrante'}: {prefix} {Math.abs(diff).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Botón certificar */}
              <button onClick={handleCierre}
                className="w-full py-5 bg-red-600 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-red-500 transition-all mt-2">
                <Lock className="h-4 w-4" /> Certificar Cierre Multi-Moneda
              </button>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
// VALKYRON FINANCIAL INTELLIGENCE CENTER v8.4 - OPERACIÓN INTEGRAL
// Evolución: Exportación a Excel, Control de Fechas y Eliminación de Errores
// REGLA DE ORO: CERO OMISIONES. IDIOMA ESPAÑOL. GRADO MILITAR.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FinanceTransaction, Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient'; 
import { 
  DollarSign, ArrowUpCircle, ArrowDownCircle, FileText, 
  PlusCircle, X, Loader2, TrendingUp, Wallet, UserCheck, 
  ShieldCheck, Zap, Calculator, Landmark, CheckCircle2,
  FileSignature, Lock, Cpu, Activity, UserPlus, Truck, Trash2, Download
} from 'lucide-react';

// --- DEFINICIÓN DE TIPOS NÚCLEO ---
export type PaymentMethod = 'USDT' | 'ZELLE' | 'CASH' | 'BS';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY' | 'PAYABLE' | 'RECEIVABLE';
export type TabType = 'LEDGER' | 'REQUISITIONS' | 'CLOSING' | 'DEBTS';

interface FinancePanelProps {
  vendors: Vendor[];
  inventory: any[];
  userRole?: string;
  setGlobalFinance?: React.Dispatch<React.SetStateAction<{
    CASH: number; ZELLE: number; USDT: number; BS: number;
  }>>;
}

const glassStyle = "bg-white/[0.01] backdrop-blur-[40px] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]";
const inputStyle = "bg-black/40 border border-white/5 p-5 rounded-2xl text-white outline-none focus:border-[#E1AD01]/50 focus:ring-1 focus:ring-[#E1AD01]/20 transition-all";

export const FinancePanel: React.FC<FinancePanelProps> = ({ 
  vendors, inventory, userRole = 'CEO', setGlobalFinance = () => {} 
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('LEDGER');
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [requests, setRequests] = useState<any[]>([]); 
  const [receivables, setReceivables] = useState<any[]>([]); 
  const [capitanes, setCapitanes] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isAddingCxP, setIsAddingCxP] = useState(false);

  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<PaymentMethod>('USDT');
  const [type, setType] = useState<TransactionType>('INCOME');
  const [reference, setReference] = useState<string>('');
  const [selectedCapitanId, setSelectedCapitanId] = useState<string>('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [reqItems, setReqItems] = useState('');
  const [reqPriority, setReqPriority] = useState('MEDIA');
  const [reqAmount, setReqAmount] = useState<string>(''); 
  const [newCxC, setNewCxC] = useState({ alumno: '', monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0] });
  const [newCxP, setNewCxP] = useState({ proveedor: '', monto: 0, descripcion: '', categoria: 'Partes', fecha: new Date().toISOString().split('T')[0] });
  const [physicalBalance, setPhysicalBalance] = useState<string>('');
  
  const TASA_BS_USD = 36.50; 

  const generateAuditHash = (data: string) => {
    const str = data + Date.now().toString() + Math.random().toString();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').toUpperCase();
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "---";
    const d = new Date(date);
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const fetchMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const [capRes, finRes, reqRes, cxcRes] = await Promise.all([
        supabase.from('capitanes').select('*').order('nombre', { ascending: true }),
        supabase.from('transacciones_finanzas').select('*').order('issue_date', { ascending: false }),
        supabase.from('solicitudes_compra').select('*').order('created_at', { ascending: false }),
        supabase.from('cuentas_por_cobrar').select('*').order('fecha_emision', { ascending: false })
      ]);
      if (capRes.data) setCapitanes(capRes.data);
      if (finRes.data) {
        setTransactions(finRes.data.map((t: any) => ({
          id: t.id, type: t.type, entityId: t.entity_id, entityName: t.entity_name || 'MOVIMIENTO',
          amount: Number(t.amount) || 0, invoiceNumber: t.invoice_number || 'S/N',
          description: t.description || '', status: t.status || 'PENDING',
          issueDate: t.issue_date, category: t.category || 'General',
          payment_method: t.payment_method 
        })));
      }
      if (reqRes.data) setRequests(reqRes.data);
      if (cxcRes.data) setReceivables(cxcRes.data);
    } catch (err) { console.error("Sync Error:", err); } 
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchMasterData();
    const channel = supabase.channel('valkyron-erp-v8-4')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_finanzas' }, fetchMasterData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitudes_compra' }, fetchMasterData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuentas_por_cobrar' }, fetchMasterData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchMasterData]);

  const totalIncomes = useMemo(() => transactions.filter(t => (t.type === 'INCOME' || t.type === 'RECEIVABLE') && t.status === 'PAID').reduce((acc, t) => acc + t.amount, 0), [transactions]);
  const totalCashOut = useMemo(() => transactions.filter(t => (t.type === 'EXPENSE' || t.type === 'PAYABLE' || t.type === 'INSTRUCTOR_PAY') && t.status === 'PAID').reduce((acc, t) => acc + t.amount, 0), [transactions]);
  const instructorDebt = useMemo(() => transactions.filter(t => t.category === 'Nomina' && t.status === 'PENDING').reduce((acc, t) => acc + t.amount, 0), [transactions]);
  const inventoryValue = inventory.reduce((acc, item) => acc + (item.quantity * (item.unitPrice || 0)), 0);
  const theoreticalBalance = totalIncomes - totalCashOut;
  const totalReceivables = useMemo(() => receivables.reduce((acc, r) => acc + (Number(r.monto_pendiente) || 0), 0), [receivables]);

  const handleExportCSV = () => {
    const headers = ['Fecha', 'Referencia', 'Entidad / Concepto', 'Metodo Pago', 'Monto ($)', 'Tipo', 'Estatus'];
    const rows = transactions.map(t => [
      formatDate(t.issueDate),
      t.invoiceNumber,
      `"${t.entityName}"`,
      t.payment_method || 'N/A',
      t.amount,
      t.type,
      t.status
    ]);
    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Financiero_Valkyron_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm("ATENCIÓN: ¿Autoriza la eliminación de este registro contable? Esta acción es irreversible.")) return;
    setIsSyncing(true);
    const { error } = await supabase.from('transacciones_finanzas').delete().eq('id', id);
    if (error) alert("Error al eliminar: " + error.message);
    else fetchMasterData();
    setIsSyncing(false);
  };

  const handleDeleteCxC = async (id: string) => {
    if (!window.confirm("¿Desea eliminar esta Cuenta por Cobrar?")) return;
    setIsSyncing(true);
    const { error } = await supabase.from('cuentas_por_cobrar').delete().eq('id', id);
    if (error) alert("Error al eliminar: " + error.message);
    else fetchMasterData();
    setIsSyncing(false);
  };

  const handleMulticurrencyRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) return;
    setIsSyncing(true);
    const equivalentUSD = currency === 'BS' ? numericAmount / TASA_BS_USD : numericAmount;
    const capitanObj = capitanes.find(c => c.id === selectedCapitanId);
    const hash = generateAuditHash(`${type}-${equivalentUSD}`);
    
    const { error } = await supabase.from('transacciones_finanzas').insert([{
      type: type, 
      entity_name: type === 'INSTRUCTOR_PAY' ? `PAGO: ${capitanObj?.nombre}` : `FLUJO ${currency}`,
      amount: equivalentUSD, invoice_number: `TX-${hash.substring(0,8)}`,
      description: reference || 'REGISTRO MANUAL', status: 'PAID',
      category: type === 'INSTRUCTOR_PAY' ? 'Nomina' : 'General',
      payment_method: currency,
      issue_date: new Date(transactionDate).toISOString()
    }]);

    if (!error) {
      setGlobalFinance(prev => ({ ...prev, [currency]: Number(((prev[currency] || 0) + (type === 'INCOME' ? numericAmount : -numericAmount)).toFixed(2)) }));
      setAmount(''); setReference(''); fetchMasterData();
    }
    setIsSyncing(false);
  };

  const handleRegisterCxC = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.from('cuentas_por_cobrar').insert([{
        nombre_alumno: newCxC.alumno.toUpperCase(),
        monto_total: parseFloat(newCxC.monto),
        concepto: newCxC.concepto.toUpperCase() || 'VUELO PENDIENTE',
        estatus: 'PENDIENTE',
        fecha_emision: new Date(newCxC.fecha).toISOString()
      }]);
      if (error) throw error;
      setNewCxC({ alumno: '', monto: '', concepto: '', fecha: new Date().toISOString().split('T')[0] });
      fetchMasterData();
      alert("Deuda de alumno registrada.");
    } catch (err: any) { alert(err.message); }
    finally { setSubmitting(false); }
  };

  const handleRegisterInvoiceCxP = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const vendorName = vendors.find(v => v.id === newCxP.proveedor)?.name || newCxP.proveedor;
    const hash = generateAuditHash(`INV-${vendorName}-${newCxP.monto}`);
    const { error } = await supabase.from('transacciones_finanzas').insert([{
      type: 'PAYABLE', entity_name: vendorName.toUpperCase(), amount: newCxP.monto,
      invoice_number: `INV-${hash.substring(0,8)}`, description: `[CXP-MANUAL] ${newCxP.descripcion.toUpperCase()}`,
      issue_date: new Date(newCxP.fecha).toISOString(),
      status: 'PENDING', category: newCxP.categoria,
      payment_method: 'CASH'
    }]);
    if (!error) { fetchMasterData(); setIsAddingCxP(false); }
    setSubmitting(false);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(reqAmount);
    if (!reqItems.trim() || isNaN(amountNum) || amountNum <= 0) return alert("Error: Datos inválidos.");
    setSubmitting(true);
    const auditHash = generateAuditHash(reqItems + reqAmount);
    try {
      const { error } = await supabase.from('solicitudes_compra').insert([{
        prioridad: reqPriority,
        items: JSON.stringify({ description: reqItems.toUpperCase(), estimated_cost: amountNum }),
        estatus: 'PENDIENTE_REVISION', hash_auditoria: auditHash
      }]);
      if (error) throw error;
      alert(`Requisición certificada por $${amountNum}.`); setReqItems(''); setReqAmount(''); fetchMasterData();
    } catch (err: any) { alert(`Error: ${err.message}`); } 
    finally { setSubmitting(false); }
  };

  const handleApproveRequest = async (reqId: string, actualAmount: number, description: string) => {
    setIsSyncing(true);
    const hash = generateAuditHash(`APPROVE-${reqId}`);
    try {
      const { error: txError } = await supabase.from('transacciones_finanzas').insert([{
        type: 'PAYABLE', entity_name: 'PROVEEDOR PENDIENTE', amount: actualAmount,
        invoice_number: `OC-${hash.substring(0,8)}`, description: `[APROBADO] ${description}`,
        status: 'PENDING', category: 'Parts', payment_method: 'USDT', issue_date: new Date().toISOString()
      }]);
      if (txError) throw txError;
      await supabase.from('solicitudes_compra').update({ estatus: 'APROBADO', aprobado_por: userRole }).eq('id', reqId);
      alert("Orden de Compra Certificada."); await fetchMasterData();
    } catch (err: any) { alert(err.message); } 
    finally { setIsSyncing(false); }
  };

  const handleCloseMonth = () => {
    const phys = parseFloat(physicalBalance);
    if (isNaN(phys)) return alert("Monto inválido.");
    if (Math.abs(theoreticalBalance - phys) > 0.01) return alert("Discrepancia detectada.");
    alert("Cierre Mensual Certificado.");
    setPhysicalBalance('');
  };

  if (loading) return (
    <div className="p-20 text-center bg-[#020202] h-screen flex flex-col justify-center items-center text-white">
      <Loader2 className="h-12 w-12 text-[#E1AD01] animate-spin mb-6" />
      <p className="text-[10px] font-black uppercase tracking-[0.8em] text-[#E1AD01]">Valkyron Financial Core...</p>
    </div>
  );

  return (
    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-1000 p-2 md:p-8 bg-transparent min-h-screen text-left">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter uppercase italic flex items-center gap-4">
            <div className="p-3 bg-[#E1AD01] rounded-2xl shadow-[0_0_30px_rgba(225,173,1,0.3)]">
              <Cpu className="text-black h-8 w-8 animate-pulse" />
            </div>
            Centro Financiero <span className="text-[#E1AD01] text-lg font-mono tracking-[0.5em] ml-2">v8.4</span>
          </h1>
          <p className="text-zinc-500 text-[9px] font-black uppercase tracking-[0.4em] mt-3 ml-16">Valkyron Intelligence // Gestión de Activos Estratégicos</p>
        </div>

        <div className="flex p-1.5 bg-black/60 backdrop-blur-3xl rounded-[2rem] border border-white/5 shadow-inner overflow-x-auto max-w-full">
          <TabButton active={activeTab === 'LEDGER'} onClick={() => setActiveTab('LEDGER')} icon={<Landmark />} label="Libro Diario" />
          <TabButton active={activeTab === 'DEBTS'} onClick={() => setActiveTab('DEBTS')} icon={<UserPlus />} label="Deudas (CxC/CxP)" />
          <TabButton active={activeTab === 'REQUISITIONS'} onClick={() => setActiveTab('REQUISITIONS')} icon={<FileSignature />} label="Requisiciones" />
          <TabButton active={activeTab === 'CLOSING'} onClick={() => setActiveTab('CLOSING')} icon={<Lock />} label="Arqueo & Cierre" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-white">
        <StatCard label="Ingresos Totales" value={totalIncomes} color="from-emerald-500/20" icon={<ArrowUpCircle className="text-emerald-500" />} />
        <StatCard label="CxC Alumnos" value={totalReceivables} color="from-yellow-500/20" icon={<TrendingUp className="text-yellow-500" />} />
        <StatCard label="Deuda Capitanes" value={instructorDebt} color="from-blue-500/20" icon={<UserCheck className="text-blue-500" />} />
        <StatCard label="Egresos Totales" value={totalCashOut} color="from-red-500/20" icon={<ArrowDownCircle className="text-red-500" />} />
      </div>

      {activeTab === 'LEDGER' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in slide-in-from-right-10 duration-700">
          <div className={`lg:col-span-4 ${glassStyle} rounded-[3rem] p-8 border-t-4 border-t-[#E1AD01]`}>
            <div className="flex items-center gap-3 mb-10 text-white">
              <Calculator className="text-[#E1AD01] h-5 w-5" />
              <h2 className="text-[10px] font-black uppercase tracking-widest">Ejecutar Transacción</h2>
            </div>
            <form onSubmit={handleMulticurrencyRegister} className="space-y-6">
              <div className="space-y-2">
                 <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Fecha del Movimiento</label>
                 <input type="date" required value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} className={inputStyle + " w-full text-[12px] font-mono"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select value={type} onChange={(e) => setType(e.target.value as any)} className={inputStyle + " text-[10px] font-black uppercase"}>
                  <option value="INCOME">INGRESO (+)</option>
                  <option value="EXPENSE">EGRESO (-)</option>
                  <option value="INSTRUCTOR_PAY">NÓMINA</option>
                </select>
                <select value={currency} disabled={type === 'INSTRUCTOR_PAY'} onChange={(e) => setCurrency(e.target.value as any)} className={inputStyle + " text-[10px] font-black"}>
                  <option value="USDT">USDT</option><option value="ZELLE">ZELLE</option><option value="CASH">CASH</option><option value="BS">BS</option>
                </select>
              </div>
              <div className="relative group">
                <span className="absolute left-6 top-1/2 -translate-y-1/2 text-[#E1AD01] font-black text-2xl">$</span>
                <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} 
                  className="w-full bg-white/5 border border-white/10 py-10 pl-14 pr-8 rounded-3xl text-5xl font-black italic outline-none focus:border-[#E1AD01] transition-all text-white" 
                  placeholder="0.00" required />
              </div>
              {type === 'INSTRUCTOR_PAY' && (
                <select required value={selectedCapitanId} onChange={(e) => setSelectedCapitanId(e.target.value)} className={inputStyle + " w-full text-[10px] font-black uppercase"}>
                  <option value="">-- SELECCIONAR CAPITÁN --</option>
                  {capitanes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} 
                placeholder="REFERENCIA / TRAZABILIDAD" className={inputStyle + " w-full uppercase text-[9px] font-bold tracking-widest"} />
              <button type="submit" disabled={isSyncing} className="w-full py-6 bg-white text-black rounded-[2rem] font-black uppercase tracking-[0.3em] text-[10px] hover:bg-[#E1AD01] transition-all shadow-xl">
                {isSyncing ? <Loader2 className="animate-spin h-5 w-5 mx-auto" /> : "Sellar Registro"}
              </button>
            </form>
          </div>

          <div className={`lg:col-span-8 ${glassStyle} rounded-[3.5rem] overflow-hidden flex flex-col text-white`}>
            <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <h3 className="text-[11px] font-black uppercase tracking-[0.4em] flex items-center gap-4 italic"><Landmark className="h-5 w-5 text-[#E1AD01]" /> Libro Mayor</h3>
              <div className="flex gap-3">
                <button onClick={handleExportCSV} className="bg-[#E1AD01]/10 text-[#E1AD01] px-4 py-2 rounded-xl border border-[#E1AD01]/20 text-[9px] font-black uppercase tracking-widest hover:bg-[#E1AD01] hover:text-black transition-all flex items-center gap-2">
                  <Download size={12}/> Exportar Excel
                </button>
                <button onClick={() => setIsAddingCxP(true)} className="bg-white/5 px-4 py-2 rounded-xl border border-white/10 text-[9px] font-black uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-2"><Truck size={12}/> CxP Manual</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[600px] scrollbar-hide px-6">
              <table className="w-full text-left border-separate border-spacing-y-3">
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id} className="group transition-all">
                      <td className="bg-white/[0.02] group-hover:bg-white/[0.05] p-5 rounded-l-3xl border-y border-l border-white/5">
                        <span className="text-[10px] font-black block">{formatDate(t.issueDate)}</span>
                        <span className="text-[7px] text-zinc-500 uppercase font-mono">{t.invoiceNumber}</span>
                      </td>
                      <td className="bg-white/[0.02] group-hover:bg-white/[0.05] p-5 border-y border-white/5">
                        <span className="text-[10px] font-black uppercase truncate block max-w-[150px]">{t.entityName}</span>
                        <span className="text-[7px] text-zinc-500 font-bold uppercase">{t.payment_method || '---'}</span>
                      </td>
                      <td className={`bg-white/[0.02] group-hover:bg-white/[0.05] p-5 border-y border-white/5 text-right font-black text-xl italic ${t.type === 'INCOME' || t.type === 'RECEIVABLE' ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${t.amount.toLocaleString()}
                      </td>
                      <td className="bg-white/[0.02] group-hover:bg-white/[0.05] p-5 rounded-r-3xl border-y border-r border-white/5 text-center flex items-center justify-center gap-4">
                        {t.status === 'PAID' ? <CheckCircle2 className="h-5 w-5 text-emerald-500/50" /> : <Loader2 className="h-5 w-5 text-[#E1AD01] animate-spin" />}
                        <button onClick={() => handleDeleteTransaction(t.id)} className="text-zinc-600 hover:text-red-500 transition-all p-2 rounded-full hover:bg-red-500/10">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'DEBTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-700 text-white">
          <div className={`${glassStyle} rounded-[3rem] p-8`}>
             <h3 className="text-[12px] font-black uppercase tracking-[0.4em] mb-8 flex items-center gap-3 italic"><UserPlus className="text-[#E1AD01]"/> Cuentas por Cobrar (Alumnos)</h3>
             <form onSubmit={handleRegisterCxC} className="space-y-5">
                <input required className={inputStyle + " w-full"} placeholder="NOMBRE DEL ALUMNO" value={newCxC.alumno} onChange={e => setNewCxC({...newCxC, alumno: e.target.value})} />
                <input type="date" required value={newCxC.fecha} onChange={(e) => setNewCxC({...newCxC, fecha: e.target.value})} className={inputStyle + " w-full text-[12px] font-mono"} />
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" required className={inputStyle + " w-full font-black text-lg"} placeholder="MONTO $" value={newCxC.monto} onChange={e => setNewCxC({...newCxC, monto: e.target.value})} />
                  <input className={inputStyle + " w-full"} placeholder="CONCEPTO" value={newCxC.concepto} onChange={e => setNewCxC({...newCxC, concepto: e.target.value})} />
                </div>
                <button type="submit" className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase text-[10px] hover:bg-[#E1AD01] transition-all">Sellar Deuda Alumno</button>
             </form>
             <div className="mt-8 space-y-3 max-h-[300px] overflow-y-auto scrollbar-hide">
               {receivables.map(r => (
                 <div key={r.id} className="bg-white/[0.03] p-4 rounded-2xl border border-white/5 flex justify-between items-center group">
                   <div>
                     <p className="text-[10px] font-black uppercase">{r.nombre_alumno}</p>
                     <p className="text-[7px] text-zinc-500 uppercase">{r.concepto} • {formatDate(r.fecha_emision)}</p>
                   </div>
                   <div className="flex items-center gap-3">
                     <p className="text-red-400 font-mono font-black text-lg">${r.monto_pendiente}</p>
                     <button onClick={() => handleDeleteCxC(r.id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                   </div>
                 </div>
               ))}
             </div>
          </div>

          <div className={`${glassStyle} rounded-[3rem] p-8`}>
             <h3 className="text-[12px] font-black uppercase tracking-[0.4em] mb-8 flex items-center gap-3 italic"><Truck className="text-red-500"/> Cuentas por Pagar (Proveedores)</h3>
             <div className="space-y-4 max-h-[500px] overflow-y-auto scrollbar-hide">
               {transactions.filter(t => t.type === 'PAYABLE' && t.status === 'PENDING').map(t => (
                 <div key={t.id} className="bg-white/[0.03] p-6 rounded-3xl border border-white/5 flex justify-between items-center group">
                   <div>
                     <p className="text-[10px] font-black uppercase">{t.entityName}</p>
                     <p className="text-[7px] text-zinc-500 uppercase">{t.description} • {formatDate(t.issueDate)}</p>
                   </div>
                   <div className="text-right flex items-center gap-3">
                     <div>
                        <p className="text-red-500 font-mono font-black text-xl italic">${t.amount.toLocaleString()}</p>
                        <span className="text-[7px] bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full font-black uppercase">Pendiente</span>
                     </div>
                     <button onClick={() => handleDeleteTransaction(t.id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-500 transition-all"><Trash2 size={16}/></button>
                   </div>
                 </div>
               ))}
               {transactions.filter(t => t.type === 'PAYABLE' && t.status === 'PENDING').length === 0 && <p className="text-center py-10 text-zinc-500 text-[10px] font-black uppercase tracking-widest">Sin deudas a proveedores</p>}
             </div>
          </div>
        </div>
      )}

      {activeTab === 'REQUISITIONS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-700 text-white">
          <div className={`${glassStyle} rounded-[3rem] p-10`}>
            <h3 className="text-[12px] font-black uppercase tracking-[0.4em] mb-8 italic flex items-center gap-3"><FileSignature className="text-[#E1AD01] h-6 w-6"/> Generar Requisición</h3>
            <form onSubmit={handleCreateRequest} className="space-y-6">
              <textarea required value={reqItems} onChange={(e)=>setReqItems(e.target.value)} rows={3} className="w-full bg-white/5 border border-white/10 p-6 rounded-3xl text-[11px] font-mono outline-none focus:border-[#E1AD01]" placeholder="DETALLE ÍTEMS OPERATIVOS..."/>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                  <label className="text-[8px] font-black text-zinc-500 uppercase block mb-1">Costo Estimado ($)</label>
                  <input type="number" required value={reqAmount} onChange={(e)=>setReqAmount(e.target.value)} className="bg-transparent font-black text-lg outline-none w-full" placeholder="0.00" />
                </div>
                <select value={reqPriority} onChange={(e)=>setReqPriority(e.target.value)} className="w-full bg-black/50 text-[10px] font-black outline-none border border-white/10 p-4 rounded-2xl">
                  <option value="BAJA">PROTOCOLAR (BAJA)</option><option value="MEDIA">MANTENIMIENTO (MEDIA)</option><option value="CRITICA">AOG (CRÍTICA)</option>
                </select>
              </div>
              <button type="submit" disabled={submitting} className="w-full py-5 bg-white text-black rounded-[2rem] font-black uppercase text-[10px] hover:bg-[#E1AD01] transition-all tracking-[0.2em]">Sellar Requisición</button>
            </form>
          </div>

          <div className={`${glassStyle} rounded-[3rem] p-10 flex flex-col`}>
            <h3 className="text-zinc-500 font-black text-[10px] uppercase tracking-[0.4em] mb-8 italic">Bandeja de Aprobación</h3>
            <div className="space-y-4 flex-1 overflow-y-auto pr-2 scrollbar-hide">
              {requests.map((req) => {
                const itemData = JSON.parse(req.items || '{}');
                return (
                  <div key={req.id} className="bg-white/[0.02] border border-white/5 p-6 rounded-[2rem] flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[8px] font-black text-[#E1AD01] bg-[#E1AD01]/10 px-3 py-1.5 rounded-full tracking-widest">{req.nro_solicitud}</span>
                        <p className="text-[11px] font-mono uppercase mt-4">{itemData.description}</p>
                        <p className="text-[#E1AD01] text-2xl font-black mt-1 italic">${Number(itemData.estimated_cost).toLocaleString()}</p>
                      </div>
                      <span className={`text-[8px] font-black px-3 py-1.5 rounded-full uppercase ${req.prioridad === 'CRITICA' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'}`}>{req.prioridad}</span>
                    </div>
                    {req.estatus === 'PENDIENTE_REVISION' && (userRole === 'CEO' || userRole === 'ADMIN') ? (
                      <div className="flex gap-3 mt-2 border-t border-white/5 pt-5">
                        <button onClick={() => handleApproveRequest(req.id, itemData.estimated_cost, itemData.description)} className="flex-1 py-3 bg-emerald-500 text-black rounded-xl text-[9px] font-black uppercase hover:bg-white transition-all">Aprobar Gasto</button>
                        <button onClick={() => alert("Rechazado")} className="flex-1 py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl text-[9px] font-black uppercase">Rechazar</button>
                      </div>
                    ) : (
                      <div className="text-[9px] font-black uppercase text-zinc-500 flex items-center gap-2 italic"><CheckCircle2 className="h-4 w-4 text-zinc-700"/> Estatus: {req.estatus}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'CLOSING' && (
        <div className="animate-in slide-in-from-bottom-4 flex justify-center mt-10 text-white">
          <div className={`${glassStyle} rounded-[3rem] p-12 w-full max-w-[600px] shadow-2xl relative overflow-hidden`}>
            <h3 className="font-black text-[14px] uppercase tracking-[0.4em] mb-10 italic">Arqueo & Cierre Mensual</h3>
            <div className="space-y-6">
              <div className="bg-black/50 border border-white/5 p-6 rounded-3xl flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saldo Teórico en Sistema</span>
                <span className="text-2xl font-black font-mono">${theoreticalBalance.toFixed(2)}</span>
              </div>
              <p className="text-[9px] text-zinc-500 font-bold uppercase px-2">Ingrese balance físico auditado:</p>
              <input type="number" step="any" value={physicalBalance} onChange={(e) => setPhysicalBalance(e.target.value)} className="w-full bg-white/5 border border-[#E1AD01]/30 p-8 rounded-3xl text-5xl font-black outline-none text-center" placeholder="0.00" />
              <button onClick={handleCloseMonth} className="w-full py-6 bg-red-600 rounded-[2rem] font-black uppercase text-[11px] flex items-center justify-center gap-3 hover:bg-red-700 transition-all shadow-xl tracking-[0.2em]"><Lock className="h-4 w-4"/> Certificar Cierre Mensual</button>
            </div>
          </div>
        </div>
      )}

      {isAddingCxP && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[200] flex items-center justify-center p-6 animate-in fade-in text-white">
          <div className="bg-[#050505] border border-white/10 w-full max-w-[550px] rounded-[3.5rem] overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-8 flex justify-between items-center">
              <h3 className="text-[12px] font-black uppercase text-black italic tracking-widest">Registro CxP Manual</h3>
              <button onClick={() => setIsAddingCxP(false)} className="text-black bg-black/10 p-2 rounded-full hover:rotate-90 transition-all"><X size={20} /></button>
            </div>
            <form onSubmit={handleRegisterInvoiceCxP} className="p-10 space-y-6">
               <input required className={inputStyle + " w-full uppercase text-[10px] font-black"} placeholder="PROVEEDOR / ENTIDAD" value={newCxP.proveedor} onChange={e => setNewCxP({...newCxP, proveedor: e.target.value})} />
               <input type="date" required value={newCxP.fecha} onChange={(e) => setNewCxP({...newCxP, fecha: e.target.value})} className={inputStyle + " w-full text-[12px] font-mono"} />
               <input type="number" step="0.01" required className={inputStyle + " w-full text-4xl font-black italic focus:border-red-500"} placeholder="0.00" value={newCxP.monto} onChange={e => setNewCxP({...newCxP, monto: parseFloat(e.target.value)})} />
               <input required className={inputStyle + " w-full uppercase text-[10px] font-black"} placeholder="DETALLE OPERACIÓN" value={newCxP.descripcion} onChange={e => setNewCxP({...newCxP, descripcion: e.target.value})} />
               <button type="submit" className="w-full bg-white text-black font-black py-6 rounded-[2rem] uppercase text-[11px] tracking-[0.3em] hover:bg-[#E1AD01] transition-all">Sellar CxP</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }: any) => (
  <button onClick={onClick} className={`flex items-center gap-3 px-8 py-4 rounded-[1.5rem] font-black text-[9px] uppercase tracking-[0.2em] transition-all duration-500 ${active ? 'bg-[#E1AD01] text-black shadow-[0_10px_20px_rgba(225,173,1,0.2)] scale-105' : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}>
    {React.cloneElement(icon, { size: 14 })} {label}
  </button>
);

const StatCard = ({ label, value, color, icon }: any) => (
  <div className={`${glassStyle} bg-gradient-to-br ${color} to-transparent p-8 rounded-[3rem] relative overflow-hidden group hover:scale-[1.02] transition-all duration-500 text-white`}>
    <div className="relative z-10">
      <p className="text-[9px] text-zinc-500 font-black uppercase tracking-[0.4em] mb-4">{label}</p>
      <div className="flex items-center gap-4">
        <h3 className="text-4xl font-black font-mono italic tracking-tighter">${value.toLocaleString()}</h3>
      </div>
    </div>
    <div className="absolute -right-8 -bottom-8 opacity-[0.03] group-hover:opacity-10 group-hover:rotate-12 transition-all duration-1000 scale-150">
      {React.cloneElement(icon, { size: 160 })}
    </div>
  </div>
);
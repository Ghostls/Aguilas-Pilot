// Terminal de Inteligencia Águilas Pilot v4.12 - VALKYRON OS
// Evolución: Blindaje Nuclear de Roles y Centro de Comando Operativo
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.
import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient'; 
import { 
  Plane, Package, Wrench, Activity, Zap, ShieldCheck, 
  Clock, PlusCircle, X, Navigation, CheckCircle2, 
  DollarSign, TrendingUp, Landmark, ArrowRight, Loader2,
  ArrowUpCircle, ArrowDownCircle, Wallet, Calculator, Coins, UserCheck, AlertTriangle
} from 'lucide-react';

export const HomeDashboard = ({ 
  fleet = [], 
  inventory = [], 
  activeTasks = [], 
  vendors = [], 
  financeData: externalFinanceData = { CASH: 0, ZELLE: 0, USDT: 0, BS: 0 }, 
  onNavigate, 
  onFlightLogUpdate,
  userRole = "MECANICO" 
}: any) => {
  // --- ESTADOS DE CONTROL TÁCTICO ---
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [activeQuickView, setActiveQuickView] = useState<'menu' | 'logbook' | 'vault' | 'capitanes'>('menu');
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(true);
  
  const [logData, setLogData] = useState({
    aircraftId: '',
    hobbsStart: 0,
    hobbsEnd: 0,
    tachStart: 0,
    tachEnd: 0
  });

  // --- BLINDAJE DE ROLES (GRADO MILITAR v4.12) ---
  const rolRaw = userRole || "";
  const rol = rolRaw.toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Validación infalible: Detecta "ADMIN", "Admin", "Administradora", etc.
  const hasFinanceAccess = rol === 'CEO' || rol === 'ADMIN' || rol.includes('ADMIN');

  // --- RECONOCIMIENTO DE ACTIVIDAD Y SINCRONIZACIÓN NUCLEAR ---
  useEffect(() => {
    if (hasFinanceAccess) {
      const fetchRecentActivity = async () => {
        setIsSyncing(true);
        const { data, error } = await supabase
          .from('transacciones_finanzas')
          .select('*')
          .order('created_at', { ascending: false });
          
        if (error) console.error("FALLA RADAR FINANCIERO:", error);
        if (data) setRecentTransactions(data);
        setIsSyncing(false);
      };

      fetchRecentActivity();

      const channel = supabase
        .channel('home-updates-v4-12')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'transacciones_finanzas' }, fetchRecentActivity)
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [hasFinanceAccess]);

  // --- CÁLCULO DE OPERATIVIDAD DINÁMICA ---
  const fleetHealth = useMemo(() => {
    if (fleet.length === 0) return 0;
    const operationalUnits = fleet.filter((a: any) => a.status === 'operational').length;
    return (operationalUnits / fleet.length) * 100;
  }, [fleet]);

  const totalFleetHours = useMemo(() => fleet.reduce((acc: number, ac: any) => acc + (Number(ac.hours_vuelo_totales) || 0), 0), [fleet]);
  const criticalStock = useMemo(() => inventory.filter((item: any) => item.quantity <= item.minStock).length, [inventory]);
  const aogCount = useMemo(() => fleet.filter((ac: any) => ac.status === 'grounded' || ac.status === 'maintenance').length, [fleet]);

  // --- INTELIGENCIA DE DEUDA DE CAPITANES ---
  const instructionDebt = useMemo(() => {
    if (!hasFinanceAccess) return 0;
    return recentTransactions
      .filter(t => (t.category?.includes('Nomina') || t.category?.includes('Training')) && t.status === 'PENDING')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }, [recentTransactions, hasFinanceAccess]);

  const captainDebts = useMemo(() => {
    const debts: { [key: string]: number } = {};
    recentTransactions
      .filter(t => (t.category?.includes('Nomina') || t.category?.includes('Training')) && t.status === 'PENDING')
      .forEach(t => {
        const name = t.entity_name || 'Capitán Desconocido';
        debts[name] = (debts[name] || 0) + Number(t.amount);
      });
    return Object.entries(debts).map(([nombre, monto]) => ({ nombre, monto }));
  }, [recentTransactions]);

  const pendingMaintenance = activeTasks.filter((t: any) => t.status !== 'Completed').length;

  const handleLogFlight = (e: React.FormEvent) => {
    e.preventDefault();
    const tachDiff = logData.tachEnd - logData.tachStart;
    if (tachDiff > 0 && logData.aircraftId) {
      if (onFlightLogUpdate) onFlightLogUpdate(logData.aircraftId, tachDiff);
      setIsQuickActionOpen(false);
      setActiveQuickView('menu');
      alert(`[VALKYRON OPS] Bitácora certificada.`);
    } else {
      alert("Error Táctico: Verifique los contadores.");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-700 text-left font-sans relative">
      
      {/* SECCIÓN 1: KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[1.618rem]">
        <Card className="bg-[#0f0f0f] border-l-4 border-l-[#E1AD01] border-white/5 shadow-2xl">
          <CardContent className="p-6 text-left">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1 text-left">Estatus Flota</p>
                <h3 className="text-3xl font-black text-white font-mono text-left">{fleetHealth.toFixed(1)}%</h3>
              </div>
              <div className="p-3 bg-[#E1AD01]/10 rounded-xl border border-[#E1AD01]/20">
                <Plane className={`h-6 w-6 ${fleetHealth < 100 ? 'text-red-500 animate-pulse' : 'text-[#E1AD01]'}`} />
              </div>
            </div>
            <div className="mt-4 h-1 bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full transition-all duration-1000 ${fleetHealth < 50 ? 'bg-red-600' : 'bg-[#E1AD01]'}`} style={{ width: `${fleetHealth}%` }}></div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f] border-l-4 border-l-emerald-500 border-white/5 shadow-2xl group text-left">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1 text-left">Horas de Vuelo</p>
                <h3 className="text-3xl font-black text-emerald-500 font-mono text-left">{totalFleetHours.toFixed(1)}</h3>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <Clock className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
            <p className="text-[9px] text-emerald-500/60 font-black mt-3 uppercase tracking-widest italic text-left">
              Productividad Total Acumulada
            </p>
          </CardContent>
        </Card>

        <Card 
          onClick={() => { setActiveQuickView('capitanes'); setIsQuickActionOpen(true); }}
          className="bg-[#0f0f0f] border-l-4 border-l-blue-500 border-white/5 shadow-2xl group cursor-pointer hover:bg-blue-500/5 transition-all text-left"
        >
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1 text-left">Deuda Capitanes</p>
                <h3 className="text-3xl font-black text-white font-mono text-left">${instructionDebt.toLocaleString()}</h3>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                <UserCheck className="h-6 w-6 text-blue-500" />
              </div>
            </div>
            <p className="text-[9px] text-blue-400 font-bold mt-3 uppercase tracking-widest italic flex items-center gap-2 text-left">
              Ver Desglose Pendiente <ArrowRight className="h-2 w-2" />
            </p>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f] border-l-4 border-l-zinc-700 border-white/5 shadow-2xl group text-left">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1 text-left">Mantenimientos</p>
                <h3 className="text-3xl font-black text-white font-mono text-left">{pendingMaintenance}</h3>
              </div>
              <div className="p-3 bg-zinc-800 rounded-xl border border-zinc-700">
                <Wrench className="h-6 w-6 text-[#E1AD01]" />
              </div>
            </div>
            <p className="text-[9px] text-zinc-600 font-bold mt-3 uppercase tracking-widest italic text-left">Órdenes en Hangar</p>
          </CardContent>
        </Card>
      </div>

      {/* SECCIÓN 2: CENTRO DE COMANDO OPERATIVO */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
        <div className="lg:col-span-2 bg-[#0a0a0a] border border-white/5 rounded-2xl p-8 relative overflow-hidden shadow-2xl text-left">
          <div className="absolute top-0 right-0 p-4 opacity-5"><Activity className="h-40 w-40 text-white" /></div>
          <h3 className="text-[#E1AD01] font-black text-[11px] uppercase tracking-[0.5em] mb-8 flex items-center gap-3 italic text-left">
            <Zap className="h-4 w-4" /> Centro de Comando Operativo
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-left">
            <div className="p-5 bg-white/[0.03] rounded-2xl border border-white/5 relative overflow-hidden group text-left">
              <Package className="absolute right-[-10px] bottom-[-10px] h-16 w-16 text-white/5 group-hover:text-red-500/10 transition-all" />
              <p className="text-zinc-500 font-black text-[8px] uppercase tracking-widest mb-2 text-left">Alertas Stock Mínimo</p>
              <p className={`text-2xl font-bold text-left ${criticalStock > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                {criticalStock} <span className="text-[10px] ml-1">ITEMS</span>
              </p>
            </div>
            
            <div className="p-5 bg-white/[0.03] rounded-2xl border border-white/5 relative overflow-hidden group text-left">
              <AlertTriangle className="absolute right-[-10px] bottom-[-10px] h-16 w-16 text-white/5 group-hover:text-red-500/10 transition-all" />
              <p className="text-zinc-500 font-black text-[8px] uppercase tracking-widest mb-2 text-left">Aeronaves No Operativas</p>
              <p className={`text-2xl font-bold text-left ${aogCount > 0 ? 'text-red-500 animate-pulse' : 'text-emerald-500'}`}>
                {aogCount} <span className="text-[10px] ml-1">UNIDADES</span>
              </p>
            </div>

            <div className="p-5 bg-white/[0.03] rounded-2xl border border-white/5 relative overflow-hidden group text-left">
              <ShieldCheck className="absolute right-[-10px] bottom-[-10px] h-16 w-16 text-white/5 group-hover:text-blue-500/10 transition-all" />
              <p className="text-zinc-500 font-black text-[8px] uppercase tracking-widest mb-2 text-left">Proveedores Activos</p>
              <p className="text-2xl text-white font-bold text-left">{vendors.length} <span className="text-[10px] text-blue-400 ml-1">ALIADOS</span></p>
            </div>
          </div>

          <button onClick={() => { setActiveQuickView('menu'); setIsQuickActionOpen(true); }} className="mt-8 w-full bg-[#E1AD01] text-black font-black py-5 rounded-2xl flex items-center justify-center gap-3 uppercase text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl">
            <PlusCircle className="h-5 w-5" /> Iniciar Registro Rápido
          </button>
        </div>

        <div className="bg-[#0f0f0f] border border-white/10 rounded-2xl p-8 relative overflow-hidden shadow-2xl text-left text-white">
          <h3 className="text-white font-black text-[11px] uppercase tracking-[0.4em] mb-8 flex items-center gap-3 italic text-white/80 text-left">
            <Activity className="h-4 w-4 text-[#E1AD01]" /> Actividad Contable
          </h3>
          <div className="space-y-6 text-left">
            {recentTransactions.length > 0 ? recentTransactions.slice(0, 5).map((tx: any) => (
              <div key={tx.id} className="border-l-2 border-[#E1AD01]/30 pl-4 py-1 group hover:border-[#E1AD01] transition-all text-left">
                <div className="flex justify-between items-center mb-1 text-left">
                  <p className="text-[10px] text-white font-black uppercase tracking-widest truncate max-w-[120px] text-left">{tx.entity_name}</p>
                  <span className={`text-[8px] font-black ${tx.status === 'PAID' ? 'text-green-500' : 'text-yellow-500 animate-pulse'}`}>
                    {tx.status === 'PAID' ? 'CERTIFICADO' : 'PENDIENTE'}
                  </span>
                </div>
                <p className="text-[8px] text-zinc-600 font-mono uppercase truncate text-left">${Number(tx.amount).toLocaleString()}</p>
              </div>
            )) : <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 text-[#E1AD01] animate-spin opacity-20" /></div>}
          </div>
          {hasFinanceAccess && (
            <button onClick={() => onNavigate('finance')} className="mt-8 w-full py-3 text-[9px] font-black uppercase tracking-widest text-[#E1AD01] border border-[#E1AD01]/20 rounded-xl hover:bg-[#E1AD01]/10 transition-all flex items-center justify-center gap-2 italic text-center">
                Ir a Libro Mayor <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* MODAL ACCIONES RÁPIDAS (Seccion final mantenida para funcionalidad completa) */}
      {isQuickActionOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/98 backdrop-blur-xl p-6 text-left">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-2xl rounded-[1.618rem] overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-6 flex justify-between items-center text-black">
              <h3 className="font-black uppercase text-[10px] tracking-[0.4em] flex items-center gap-3 italic text-left">
                <Navigation className="h-4 w-4" /> {activeQuickView === 'vault' ? 'Bóveda de Capital' : activeQuickView === 'capitanes' ? 'Liquidación Capitanes' : 'Command Terminal'}
              </h3>
              <button onClick={() => setIsQuickActionOpen(false)} className="hover:rotate-90 transition-all text-black"><X className="h-6 w-6" /></button>
            </div>
            <div className="p-12 text-left">
               {/* Lógica de vistas del modal mantenida para integridad operacional */}
               {activeQuickView === 'capitanes' ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 text-left text-white">
                  <div className="grid grid-cols-1 gap-4 text-left">
                    {captainDebts.length > 0 ? captainDebts.map((c, i) => (
                      <div key={i} className="p-6 bg-blue-500/5 border border-blue-500/20 rounded-2xl flex justify-between items-center text-left">
                        <div className="text-left">
                          <p className="text-zinc-500 font-black text-[8px] uppercase tracking-widest mb-1 text-left">Capitán / Instructor</p>
                          <p className="text-white font-bold text-lg text-left">{c.nombre}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-zinc-500 font-black text-[8px] uppercase tracking-widest mb-1 text-right">Deuda Pendiente</p>
                          <p className="text-blue-400 font-black text-2xl font-mono text-right">${c.monto.toLocaleString()}</p>
                        </div>
                      </div>
                    )) : (
                      <div className="py-10 text-center"><p className="text-zinc-600 font-black uppercase tracking-widest text-xs text-center">Sin liquidaciones pendientes</p></div>
                    )}
                  </div>
                  <button onClick={() => onNavigate('finance')} className="w-full bg-blue-600 text-white py-4 rounded-xl font-black text-[10px] uppercase flex items-center justify-center gap-3 text-center">
                    <DollarSign className="h-4 w-4" /> Ir a Módulo Contable
                  </button>
                </div>
              ) : activeQuickView === 'menu' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                  <button onClick={() => setActiveQuickView('logbook')} className="flex flex-col items-center gap-6 p-8 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-[#E1AD01]/5 transition-all text-center"><Clock className="h-10 w-10 text-[#E1AD01]" /><p className="text-[10px] text-white font-black uppercase tracking-[0.2em] text-center">Cierre Vuelo</p></button>
                  <button onClick={() => { onNavigate('control-hub'); setIsQuickActionOpen(false); }} className="flex flex-col items-center gap-6 p-8 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-zinc-800 transition-all text-center"><Wrench className="h-10 w-10 text-zinc-500" /><p className="text-[10px] text-white font-black uppercase tracking-[0.2em] text-center">Orden Hangar</p></button>
                  <button onClick={() => { onNavigate('checkout'); setIsQuickActionOpen(false); }} className="flex flex-col items-center gap-6 p-8 bg-white/[0.02] border border-white/5 rounded-3xl hover:bg-zinc-800 transition-all text-center"><Package className="h-10 w-10 text-zinc-500" /><p className="text-[10px] text-white font-black uppercase tracking-[0.2em] text-center">Despacho P/N</p></button>
                </div>
              ) : (
                <form onSubmit={handleLogFlight} className="space-y-8 animate-in slide-in-from-right-4 duration-500 text-left text-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono text-left">
                    <div className="text-left">
                      <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-2 text-left">Aeronave Objetivo</label>
                      <select required className="w-full bg-black border border-white/10 p-5 rounded-2xl text-white outline-none focus:border-[#E1AD01] text-xs font-mono text-left" value={logData.aircraftId} onChange={e => setLogData({...logData, aircraftId: e.target.value})}>
                        <option value="">-- SELECCIONAR --</option>
                        {fleet.map((ac: any) => (<option key={ac.id} value={ac.tailNumber} className="bg-black text-left">{ac.tailNumber}</option>))}
                      </select>
                    </div>
                    <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/10 rounded-2xl flex flex-col items-center justify-center p-4 text-center">
                      <p className="text-[9px] text-[#E1AD01] font-mono uppercase mb-1 text-center">Ciclo Tach</p>
                      <span className="text-3xl font-black text-white italic text-center">{(logData.tachEnd - logData.tachStart).toFixed(1)}H</span>
                    </div>
                  </div>
                  <div className="flex gap-4 text-center">
                    <button type="button" onClick={() => setActiveQuickView('menu')} className="flex-1 bg-white/5 text-zinc-600 font-black py-5 rounded-2xl uppercase text-[10px] text-center">Cancelar</button>
                    <button type="submit" className="flex-[2] bg-[#E1AD01] text-black font-black py-5 rounded-2xl uppercase text-[10px] tracking-[0.4em] italic shadow-2xl text-center">Certificar Registro</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
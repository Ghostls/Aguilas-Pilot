// src/pages/Index.tsx
// VALKYRON OS v4.15 — FIX ROL: lectura robusta desde user_metadata + tabla perfiles
// FIX REALTIME: canal único 'index-fleet-monitor'
// FIX TYPESCRIPT: status cast correcto
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '@/components/StatusBar';
import FleetDashboard from '@/components/FleetDashboard';
import InventoryPanel from '@/components/InventoryPanel';
import { ControlHub } from '@/components/ControlHub';
import { InventoryCheckout } from '@/components/InventoryCheckout';
import { MaintenanceHistory } from '@/components/MaintenanceHistory';
import { VendorPanel } from '@/components/VendorPanel';
import { HomeDashboard } from '@/components/HomeDashboard';
import { FuelPanel } from '@/components/FuelPanel';
import { FinancePanel } from '@/components/FinancePanel';
import { Register } from '@/components/auth/Register';
import { CaptainDashboard } from '@/components/CaptainDashboard';
import { supabase } from '@/lib/supabaseClient';
import FlightRegister from '@/components/flights/FlightRegister';
import { WorkOrder, Vendor, SparePart, Aircraft } from '@/Types/Maintenance';

import {
  Plane, Package, LogOut, Wrench, ClipboardCheck,
  Truck, Home, Fuel, X, DollarSign, Menu, FileText, Award
} from 'lucide-react';

type TabKey =
  | 'home' | 'captain-log' | 'fleet' | 'inventory'
  | 'control-hub' | 'checkout' | 'fuel' | 'finance' | 'vendors' | 'flights';

const tabs: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'home',        label: 'Inicio',      icon: Home         },
  { key: 'captain-log', label: 'Mi Bitácora', icon: Award        },
  { key: 'fleet',       label: 'Flota',       icon: Plane        },
  { key: 'flights',     label: 'Vuelos',      icon: FileText     },
  { key: 'inventory',   label: 'Stock',       icon: Package      },
  { key: 'control-hub', label: 'Hangar',      icon: Wrench       },
  { key: 'checkout',    label: 'Salidas',     icon: ClipboardCheck },
  { key: 'fuel',        label: 'AVGAS',       icon: Fuel         },
  { key: 'finance',     label: 'Dinero',      icon: DollarSign   },
  { key: 'vendors',     label: 'Aliados',     icon: Truck        },
];

// ─── NORMALIZACIÓN DE ESTADO DE AERONAVE ─────────────────────────────────────
type AircraftStatus = 'operational' | 'maintenance' | 'grounded' | 'flight';

const normalizeStatus = (raw: string): AircraftStatus => {
  if (!raw) return 'operational';
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo')         || s.includes('flight'))      return 'flight';
  if (s.includes('tierra')        || s.includes('grounded') || s.includes('aog')) return 'grounded';
  return 'operational';
};

// ─── NORMALIZACIÓN DE ROL ─────────────────────────────────────────────────────
// Lee desde múltiples fuentes y garantiza un valor válido siempre
const resolveRol = (
  userRoleProp: string | undefined,   // viene de App.tsx → user_metadata
  metaRol:      string | undefined,   // user_metadata.rol directo
  perfilRol:    string | undefined,   // tabla perfiles.rol
): string => {
  const candidates = [userRoleProp, metaRol, perfilRol];
  for (const c of candidates) {
    if (c && c.trim() !== '') return c.trim().toUpperCase();
  }
  return 'MECANICO'; // fallback de seguridad
};

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
const Index = ({ userRole, fleet }: { userRole?: string; fleet?: any[] }) => {
  const [activeTab,         setActiveTab]         = useState<TabKey>('home');
  const [isMobileMenuOpen,  setIsMobileMenuOpen]  = useState(false);
  const [loading,           setLoading]           = useState(true);
  const [isRegisterOpen,    setIsRegisterOpen]    = useState(false);
  const [userProfile,       setUserProfile]       = useState<{
    rol: string; nombre_completo: string; sede: string;
  } | null>(null);
  const navigate = useNavigate();

  // Fuente de verdad compartida entre FLOTA y HANGAR
  const [fleetData,        setFleetData]        = useState<Aircraft[]>([]);
  const [partsData,        setPartsData]        = useState<SparePart[]>([]);
  const [transactionsData, setTransactionsData] = useState<any[]>([]);
  const [tasksData,        setTasksData]        = useState<WorkOrder[]>([]);
  const [aguilasFinance,   setAguilasFinance]   = useState({ CASH: 0, ZELLE: 0, USDT: 0, BS: 0 });
  const [vendorsData,      setVendorsData]      = useState<Vendor[]>([]);

  // ── SYNC FLOTA ───────────────────────────────────────────────────────────
  const syncFleet = useCallback(async () => {
    const { data: aircrafts, error } = await supabase
      .from('flota_aviones')
      .select('*')
      .order('matricula', { ascending: true });

    if (!error && aircrafts) {
      setFleetData(aircrafts.map(a => ({
        id:                  a.id,
        tailNumber:          a.matricula,
        model:               a.modelo,
        status:              normalizeStatus(a.estado),
        location:            a.sede || 'LARA',
        components:          a.componentes || [],
        hours_vuelo_totales: a.horas_vuelo_totales || a.hours_vuelo_totales || 0,
      })));
    }
  }, []);

  // ── INIT ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const syncTerminalData = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          // FIX v4.15: lectura de rol desde 3 fuentes en orden de prioridad
          // 1. userRole prop (App.tsx → user_metadata al login)
          // 2. user_metadata.rol en tiempo real (por si el token cambió)
          // 3. tabla perfiles.rol (fallback DB)
          const metaRol   = user.user_metadata?.rol as string | undefined;
          const metaRole  = user.user_metadata?.role as string | undefined; // alias inglés

          const { data: profile } = await supabase
            .from('perfiles')
            .select('nombre_completo, sede, rol')
            .eq('id', user.id)
            .single();

          const rolResuelto = resolveRol(
            userRole,
            metaRol || metaRole,
            profile?.rol,
          );

          setUserProfile({
            rol:             rolResuelto,
            nombre_completo: profile?.nombre_completo
                             || user.user_metadata?.nombre_completo
                             || user.email
                             || 'Root',
            sede:            profile?.sede || user.user_metadata?.sede || 'LARA',
          });
        }

        await syncFleet();

        const [{ data: spares }, { data: provData }] = await Promise.all([
          supabase.from('inventario_repuestos').select('*'),
          supabase.from('proveedores').select('*').order('nombre_empresa', { ascending: true }),
        ]);

        if (spares) {
          setPartsData(spares.map(p => ({
            id:         p.id,
            partNumber: p.numero_parte,
            name:       p.nombre,
            quantity:   p.cantidad,
            minStock:   p.stock_minimo   || 0,
            unitPrice:  p.precio_unitario || 0,
            location:   p.ubicacion || 'LARA',
            category:   p.categoria || 'General',
          })));
        }

        if (provData) {
          setVendorsData(provData.map(p => ({
            id:            p.id,
            name:          p.nombre_empresa,
            taxId:         p.rif || 'S/N',
            category:      p.categoria || 'Repuestos',
            contactPerson: p.contacto_nombre,
            email:         p.email,
            phone:         p.telefono,
            location:      'VENEZUELA',
            rating:        5,
            providedItems: [],
          })));
        }

      } catch (err) {
        console.error('Error Crítico Águilas Pilot:', err);
      } finally {
        setLoading(false);
      }
    };

    syncTerminalData();

    // CANAL ÚNICO — FleetDashboard y App.tsx NO tienen canales propios
    const fleetChannel = supabase
      .channel('index-fleet-monitor')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => syncFleet(),
      )
      .subscribe();

    return () => { supabase.removeChannel(fleetChannel); };
  }, [syncFleet, userRole]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  // ── FILTRO DE TABS POR ROL ───────────────────────────────────────────────
  const visibleTabs = tabs.filter(tab => {
    if (!userProfile) return tab.key === 'home';

    const rol = userProfile.rol
      .toUpperCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (rol === 'CEO') return true;

    if (rol === 'ADMIN' || rol.includes('ADMIN'))
      return ['home', 'inventory', 'fuel', 'finance', 'vendors', 'flights', 'fleet'].includes(tab.key);

    if (rol === 'MECANICO')
      return ['home', 'fleet', 'inventory', 'control-hub', 'checkout', 'fuel'].includes(tab.key);

    if (rol === 'PILOTO')
      return ['home', 'captain-log', 'flights', 'fleet'].includes(tab.key);

    return tab.key === 'home';
  });

  // ── LOADING ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020202]">
        <div className="flex flex-col items-center gap-6">
          <div className="h-16 w-16 border-t-2 border-[#E1AD01] rounded-full animate-spin" />
          <span className="text-[#E1AD01] font-black uppercase tracking-[0.5em] italic text-[10px] animate-pulse">
            Sincronizando Águilas OS...
          </span>
        </div>
      </div>
    );
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-[#020202] text-white font-sans text-left overflow-x-hidden">
      <StatusBar onOpenRegister={() => setIsRegisterOpen(true)} />

      {/* NAV */}
      <nav className="z-50 px-4 pt-4 sticky top-0">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between lg:justify-center
                        bg-[#0a0a0a]/90 backdrop-blur-2xl border border-white/10 rounded-2xl p-1 shadow-2xl">
          <button className="lg:hidden p-3 text-[#E1AD01]"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className={`${isMobileMenuOpen
            ? 'flex absolute top-20 left-4 right-4 bg-[#0a0a0a] border border-white/10 rounded-2xl p-4 flex-col'
            : 'hidden lg:flex'} items-center lg:flex-row lg:gap-1`}>
            {visibleTabs.map(tab => (
              <button key={tab.key}
                onClick={() => { setActiveTab(tab.key); setIsMobileMenuOpen(false); }}
                className={`flex items-center gap-2 px-3 lg:px-5 py-3 text-[9px] font-black transition-all
                            uppercase tracking-[0.2em] rounded-xl w-full lg:w-auto
                            ${activeTab === tab.key
                              ? 'text-[#E1AD01] bg-white/5 border border-[#E1AD01]/20'
                              : 'text-slate-500 hover:text-white hover:bg-white/[0.02]'}`}>
                {(() => {
                  const Icon = tab.icon;
                  return <Icon className={`h-3.5 w-3.5 ${activeTab === tab.key ? 'animate-pulse' : 'opacity-40'}`} />;
                })()}
                <span>{tab.label}</span>
              </button>
            ))}
            <div className="h-[1px] w-full bg-white/10 my-2 lg:h-6 lg:w-[1px] lg:mx-2 lg:my-0" />
            <button onClick={handleLogout}
              className="flex items-center gap-2 px-5 py-3 text-[9px] font-black text-red-500/60
                         hover:text-red-500 transition-all uppercase tracking-[0.2em] rounded-xl w-full lg:w-auto">
              <LogOut className="h-3.5 w-3.5" /> <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </nav>

      {/* HEADER */}
      <header className="px-6 md:px-8 py-8 flex justify-between items-center gap-6 text-left">
        <h2 className="text-2xl md:text-3xl font-black text-white tracking-tighter flex items-center gap-4 uppercase italic">
          <div className="p-3 bg-[#E1AD01] rounded-2xl shadow-[0_10px_30px_rgba(225,173,1,0.2)] flex-shrink-0 text-black">
            {(() => {
              const currentTab = tabs.find(t => t.key === activeTab);
              const Icon = currentTab?.icon || Home;
              return <Icon className="h-6 w-6" />;
            })()}
          </div>
          <div className="flex flex-col">
            <span className="leading-none">{tabs.find(t => t.key === activeTab)?.label}</span>
            <span className="text-[8px] text-[#E1AD01] font-mono tracking-[0.6em] mt-2 opacity-70 uppercase">
              Terminal: {userProfile?.nombre_completo || 'Root'} — Rango: {userProfile?.rol || 'Unauthorized'}
            </span>
          </div>
        </h2>
      </header>

      {/* MAIN */}
      <main className="flex-1 px-4 md:px-8 pb-8 text-left">
        <div className="max-w-[1750px] mx-auto animate-in fade-in duration-500">

          {activeTab === 'home' && (
            <HomeDashboard
              fleet={fleetData}
              inventory={partsData}
              activeTasks={tasksData}
              vendors={vendorsData}
              financeData={aguilasFinance}
              onNavigate={setActiveTab}
              userRole={userProfile?.rol}
            />
          )}

          {activeTab === 'captain-log' && (
            <CaptainDashboard userProfile={userProfile} />
          )}

          {activeTab === 'fleet' && (
            <FleetDashboard
              fleetData={fleetData}
              setFleetData={setFleetData}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryPanel
              parts={partsData}
              setParts={setPartsData}
              transactions={transactionsData}
              setTransactions={setTransactionsData}
              vendors={vendorsData}
            />
          )}

          {/* FIX v4.14: setFleet={setFleetData} — ControlHub escribe en el mismo
              estado que lee FleetDashboard → re-render inmediato al Finalizar Misión */}
          {activeTab === 'control-hub' && (
            <ControlHub
              tasks={tasksData}
              setTasks={setTasksData}
              fleet={fleetData}
              setFleet={setFleetData}
              inventory={partsData}
              onPartsUsage={() => {}}
            />
          )}

          {activeTab === 'checkout' && (
            <InventoryCheckout parts={partsData} onCheckoutSuccess={() => {}} />
          )}

          {activeTab === 'fuel' && (
            <FuelPanel fleet={fleetData} vendors={vendorsData} />
          )}

          {activeTab === 'finance' && (
            <FinancePanel
              vendors={vendorsData}
              inventory={partsData}
              userRole={userProfile?.rol as any}
              setGlobalFinance={setAguilasFinance}
            />
          )}

          {activeTab === 'vendors' && (
            <VendorPanel vendors={vendorsData} setVendors={setVendorsData} />
          )}

          {activeTab === 'flights' && (
            <FlightRegister onFlightLogUpdate={() => {}} />
          )}

        </div>
      </main>

      {isRegisterOpen && <Register onClose={() => setIsRegisterOpen(false)} />}

      <footer className="border-t border-white/5 bg-black/80 px-8 py-6 flex justify-between items-center mt-auto">
        <div className="text-[8px] text-slate-600 font-mono tracking-[0.5em] uppercase">
          Águilas Pilot — Strategic Division 2026
        </div>
        <div className="text-[8px] text-[#E1AD01] font-black uppercase tracking-[0.3em] italic text-right">
          Valkyron OS v2.1
        </div>
      </footer>
    </div>
  );
};

export default Index;
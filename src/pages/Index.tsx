// src/pages/Index.tsx
// VALKYRON OS v6.1 — FUSIÓN v4.21 + v6.0 / PLANIFICADOR CON HANGAR DE CONSULTA
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v4.21:
//   [NEW] Tab 'planificacion' → FlightPlanningBoard dentro del mismo nav/header
//         Visible para: CEO, ADMIN, DIRECTOR, PLANIFICADOR o usuarios con
//         fn_es_planificador() = true (planificadores_vuelo) vía useAuth().canPlan
//   [NEW] Rol PLANIFICADOR: Inicio · Flota · Calendario · Planificación
//   [FIX] Rol CAPITAN / INSTRUCTOR caía al filtro por defecto y solo veía "Inicio"
//         → ahora ve Mi Bitácora, Vuelos, Flota y Calendario (igual que PILOTO)
//   [FIX] DIRECTOR tratado como ADMIN + Planificación
//   [FIX] Si el tab activo deja de ser visible para el rol, vuelve a 'home'
// v4.20 PRESERVADO: syncFleet como callback para ControlHub/FleetDashboard, canal
//   realtime con timestamp, filtro de tabs por rol, OPERACIONES = MECANICO,
//   toda la estructura intacta.
// Preserva módulos originales, navegación responsive, realtime y syncFleet.
// Acceso planificador: Hangar de consulta y Planificación; autorización final por RLS.
// REGLA DE ORO: CERO OMISIONES. SIEMPRE EVOLUCIÓN.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBar from '@/components/StatusBar';
import FleetDashboard from '@/components/FleetDashboard';
import InventoryPanel from '@/components/InventoryPanel';
import { ControlHub } from '@/components/ControlHub';
import { InventoryCheckout } from '@/components/InventoryCheckout';
import { VendorPanel } from '@/components/VendorPanel';
import { HomeDashboard } from '@/components/HomeDashboard';
import { FuelPanel } from '@/components/FuelPanel';
import { FinancePanel } from '@/components/FinancePanel';
import { Register } from '@/components/auth/Register';
import { CaptainDashboard } from '@/components/CaptainDashboard';
import { supabase } from '@/lib/supabaseClient';
import FlightRegister from '@/components/flights/FlightRegister';
import { FlightCalendar } from '@/components/FlightCalendar';
import FlightPlanningBoard from '@/components/FlightPlanningboard';
import PlannerHangar from '@/components/PlannerHangar';
import { useAuth } from '@/context/AuthContext';
import type { WorkOrder, Vendor, SparePart, Aircraft } from '@/Types/Maintenance';
import type { LucideIcon } from 'lucide-react';

import {
  Plane, Package, LogOut, Wrench, ClipboardCheck,
  Truck, Home, Fuel, X, DollarSign, Menu, FileText, Award, CalendarDays,
  CalendarCheck,
} from 'lucide-react';

type TabKey =
  | 'home' | 'captain-log' | 'fleet' | 'inventory'
  | 'control-hub' | 'checkout' | 'fuel' | 'finance' | 'vendors' | 'flights' | 'calendario'
  | 'planificacion' | 'hangar-consulta';

const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'home',          label: 'Inicio',        icon: Home           },
  { key: 'captain-log',   label: 'Mi Bitácora',   icon: Award          },
  { key: 'fleet',         label: 'Flota',         icon: Plane          },
  { key: 'flights',       label: 'Vuelos',        icon: FileText       },
  { key: 'planificacion', label: 'Planificación', icon: CalendarCheck  },
  { key: 'hangar-consulta', label: 'Hangar · Consulta', icon: Plane },
  { key: 'inventory',     label: 'Stock',         icon: Package        },
  { key: 'control-hub',   label: 'Hangar MRO',    icon: Wrench         },
  { key: 'checkout',      label: 'Salidas',       icon: ClipboardCheck },
  { key: 'fuel',          label: 'AVGAS',         icon: Fuel           },
  { key: 'finance',       label: 'Dinero',        icon: DollarSign     },
  { key: 'vendors',       label: 'Aliados',       icon: Truck          },
  { key: 'calendario',    label: 'Calendario',    icon: CalendarDays   },
];

// ─── NORMALIZACIÓN DE ESTADO ──────────────────────────────────────────────────
type AircraftStatus = 'operational' | 'maintenance' | 'grounded' | 'flight';

const normalizeStatus = (raw: string): AircraftStatus => {
  if (!raw) return 'grounded';
  const s = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo')         || s.includes('flight'))      return 'flight';
  if (s.includes('tierra')        || s.includes('grounded') || s.includes('aog')) return 'grounded';
  if (s.includes('operational') || s.includes('operativa')) return 'operational';
  return 'grounded';
};

// Los roles se resuelven únicamente desde AuthContext (no desde metadata editable).

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
// Props heredadas: se aceptan por compatibilidad, pero NO asignan permisos.
const Index = (_props: { userRole?: string; fleet?: any[] }) => {
  const [activeTab,        setActiveTab]        = useState<TabKey>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loading,          setLoading]          = useState(true);
  const [isRegisterOpen,   setIsRegisterOpen]   = useState(false);
  const navigate = useNavigate();
  const { canPlan, role, profile, enriched, status } = useAuth();
  const isPlanner = role === 'PLANIFICADOR';
  const userProfile = enriched && role ? {
    rol: role,
    nombre_completo: profile?.nombre_completo ?? 'OPERADOR',
    sede: profile?.sede ?? '',
  } : null;
  // Solo estos cargos pueden acceder a Alta de Personal desde esta vista.
  const canRegisterStaff = role === 'CEO' || role === 'ADMIN' || role === 'DIRECTOR';

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
    if (!enriched || status !== 'authenticated' || !role) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const syncTerminalData = async () => {
      setLoading(true);
      try {
        // Los permisos y datos de identidad vienen de AuthContext.
        // No se otorgan permisos en Index por userRole ni user_metadata.
        if (!enriched || status !== 'authenticated') return;
        await syncFleet();

          if (role === 'PLANIFICADOR') return; // No consultar inventario/proveedores para este perfil.
        const [{ data: spares }, { data: provData }] = await Promise.all([
          supabase.from('inventario_repuestos').select('*'),
          supabase.from('proveedores').select('*').order('nombre_empresa', { ascending: true }),
        ]);

        if (cancelled) return;
        if (spares) {
          setPartsData(spares.map(p => ({
            id:         p.id,
            partNumber: p.numero_parte,
            name:       p.nombre,
            quantity:   p.cantidad,
            minStock:   p.stock_minimo    || 0,
            unitPrice:  p.precio_unitario || 0,
            location:   p.ubicacion       || 'LARA',
            category:   p.categoria       || 'General',
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
        console.error('[ÁGUILAS OS] Error Crítico:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    syncTerminalData();

    // Canal con nombre único por sesión → evita conflicto con canales huérfanos
    const channelName = `index-fleet-monitor-${Date.now()}`;
    const fleetChannel = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => syncFleet(),
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(fleetChannel); };
  }, [syncFleet, enriched, status, role, profile?.nombre_completo, profile?.sede]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  // ── FILTRO DE TABS POR ROL ───────────────────────────────────────────────
  const visibleTabs = tabs.filter(tab => {
     // Acceso exclusivo: consulta de hangar y planificación.
     if (!enriched || status !== 'authenticated' || !role) return false;
     if (isPlanner) return tab.key === 'hangar-consulta' || (tab.key === 'planificacion' && canPlan);
     if (tab.key === 'hangar-consulta') return false;
     if (tab.key === 'planificacion') return canPlan;
     if (role === 'CEO') return true;
     if (role === 'ADMIN' || role === 'DIRECTOR')
       return ['home','inventory','fuel','finance','vendors','flights','fleet','calendario'].includes(tab.key);
     if (role === 'MECANICO' || role === 'OPERACIONES')
       return ['home','fleet','inventory','control-hub','checkout','fuel'].includes(tab.key);
     if (role === 'PILOTO' || role === 'CAPITAN')
       return ['home','captain-log','flights','fleet','calendario'].includes(tab.key);
     return tab.key === 'home';
   });
   const safeTab: TabKey = visibleTabs.some(tab => tab.key === activeTab)
     ? activeTab
     : (visibleTabs[0]?.key ?? 'home');

  useEffect(() => {
    if (enriched && visibleTabs.length && !visibleTabs.some(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [enriched, role, canPlan, activeTab]); // visibleTabs is derived above from these dependencies

  // ── LOADING ──────────────────────────────────────────────────────────────
  if (loading || status === 'loading' || (status === 'authenticated' && !enriched)) {
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

  if (status !== 'authenticated' || !role) {
    return <div className="flex min-h-screen items-center justify-center bg-[#020202] p-8 text-center text-white">
      <div><h2 className="text-xl font-black">ACCESO PENDIENTE</h2>
        <p className="mt-3 text-sm text-slate-400">Tu rol debe ser asignado por administración.</p>
        <button onClick={handleLogout} className="mt-6 rounded-lg bg-[#E1AD01] px-5 py-3 text-black">Cerrar sesión</button>
      </div>
    </div>;
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-[#020202] text-white font-sans text-left overflow-x-hidden">
      {!isPlanner && (
        <StatusBar onOpenRegister={() => {
          if (canRegisterStaff) setIsRegisterOpen(true);
        }} />
      )}

      
      
      {/* NAV v4.23 — COMPACTO Y RESPONSIVE */}
      <nav className="sticky top-0 z-50 w-full px-2 pt-3">
        <div className="mx-auto flex w-full max-w-[1920px] min-w-0 items-center rounded-2xl border border-white/10 bg-[#0a0a0a]/95 px-1 py-1 shadow-2xl backdrop-blur-2xl">

          {/* BOTÓN MÓVIL */}
          <button
            type="button"
            aria-label="Abrir menú"
            aria-expanded={isMobileMenuOpen}
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="flex items-center gap-2 rounded-xl p-3 text-[#E1AD01] lg:hidden"
          >
            {isMobileMenuOpen
              ? <X className="h-5 w-5" />
              : <Menu className="h-5 w-5" />}
            <span className="text-xs font-bold">MENÚ</span>
          </button>

          {/* NAVEGACIÓN ESCRITORIO */}
          <div className="hidden w-full min-w-0 items-center lg:flex">

            <div className="flex min-w-0 flex-1 items-center justify-between gap-0.5">
              {visibleTabs.map(tab => {
                const Icon = tab.icon;

                return (
                  <button
                    type="button"
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    title={tab.label}
                    className={`
                      flex h-10 min-w-0 shrink items-center justify-center
                      gap-1 whitespace-nowrap rounded-lg border
                      px-1.5 text-[8px] font-black uppercase
                      tracking-normal transition-all
                      xl:px-2 xl:text-[9px]
                      2xl:gap-1.5 2xl:px-2.5
                      ${
                        safeTab === tab.key
                          ? 'border-[#E1AD01]/25 bg-white/5 text-[#E1AD01]'
                          : 'border-transparent text-slate-500 hover:bg-white/[0.04] hover:text-white'
                      }
                    `}
                  >
                    <Icon
                      className={`h-3 w-3 shrink-0 2xl:h-3.5 2xl:w-3.5 ${
                        safeTab === tab.key ? '' : 'opacity-50'
                      }`}
                    />

                    <span className="whitespace-nowrap">
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* CERRAR SESIÓN */}
            <div className="mx-1.5 h-5 w-px shrink-0 bg-white/10" />

            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar sesión"
              className="flex h-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 text-[8px] font-black uppercase tracking-normal text-red-500/70 transition-all hover:bg-red-500/5 hover:text-red-400 xl:px-2 xl:text-[9px]"
            >
              <LogOut className="h-3 w-3 shrink-0" />
              <span>Cerrar sesión</span>
            </button>
          </div>

          {/* NAVEGACIÓN MÓVIL */}
          {isMobileMenuOpen && (
            <div className="absolute left-2 right-2 top-full mt-2 max-h-[80vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a0a] p-3 shadow-2xl lg:hidden">

              <div className="grid grid-cols-2 gap-2">
                {visibleTabs.map(tab => {
                  const Icon = tab.icon;

                  return (
                    <button
                      type="button"
                      key={tab.key}
                      onClick={() => {
                        setActiveTab(tab.key);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[10px] font-bold uppercase ${
                        safeTab === tab.key
                          ? 'border-[#E1AD01]/25 bg-white/5 text-[#E1AD01]'
                          : 'border-transparent text-slate-500'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="my-3 h-px bg-white/10" />

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-3 text-xs font-bold uppercase text-red-400"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* HEADER */}
      <header className="px-6 md:px-8 py-8 flex justify-between items-center gap-6 text-left">
        <h2 className="text-2xl md:text-3xl font-black text-white tracking-tighter flex items-center gap-4 uppercase italic">
          <div className="p-3 bg-[#E1AD01] rounded-2xl shadow-[0_10px_30px_rgba(225,173,1,0.2)] flex-shrink-0 text-black">
            {(() => {
              const currentTab = tabs.find(t => t.key === safeTab);
              const Icon = currentTab?.icon || Home;
              return <Icon className="h-6 w-6" />;
            })()}
          </div>
          <div className="flex flex-col">
            <span className="leading-none">{tabs.find(t => t.key === safeTab)?.label}</span>
            <span className="text-[8px] text-[#E1AD01] font-mono tracking-[0.6em] mt-2 opacity-70 uppercase">
              Terminal: {userProfile?.nombre_completo || 'Root'} — Rango: {userProfile?.rol || 'Unauthorized'}
            </span>
          </div>
        </h2>
      </header>

      {/* MAIN */}
      <main className="flex-1 px-4 md:px-8 pb-8 text-left">
        <div className="max-w-[1750px] mx-auto animate-in fade-in duration-500">

          {safeTab === 'home' && visibleTabs.some(t => t.key === 'home') && (
            <HomeDashboard
              fleet={fleetData}
              inventory={partsData}
              activeTasks={tasksData}
              vendors={vendorsData}
              financeData={aguilasFinance}
              onNavigate={(key: string) => {
                if (visibleTabs.some(t => t.key === key)) setActiveTab(key as TabKey);
              }}
              userRole={userProfile?.rol}
            />
          )}

          {safeTab === 'hangar-consulta' && isPlanner && <PlannerHangar />}

          {safeTab === 'captain-log' && visibleTabs.some(t => t.key === 'captain-log') && (
            <CaptainDashboard userProfile={userProfile} />
          )}

          {safeTab === 'fleet' && visibleTabs.some(t => t.key === 'fleet') && (
            <FleetDashboard
              fleetData={fleetData}
              setFleetData={setFleetData}
              onFleetChange={syncFleet}
            />
          )}

          {safeTab === 'inventory' && visibleTabs.some(t => t.key === 'inventory') && (
            <InventoryPanel
              parts={partsData}
              setParts={setPartsData}
              transactions={transactionsData}
              setTransactions={setTransactionsData}
              vendors={vendorsData}
              userRole={userProfile?.rol}
            />
          )}

          {safeTab === 'control-hub' && visibleTabs.some(t => t.key === 'control-hub') && (
            <ControlHub
              tasks={tasksData}
              setTasks={setTasksData}
              fleet={fleetData}
              setFleet={setFleetData}
              inventory={partsData}
              onPartsUsage={() => {}}
              onFleetChange={syncFleet}
            />
          )}

          {safeTab === 'checkout' && visibleTabs.some(t => t.key === 'checkout') && (
            <InventoryCheckout
              onCheckoutSuccess={(pn, qty, _aircraftId) => {
                setPartsData(prev =>
                  prev.map(p =>
                    p.partNumber.toUpperCase() === pn
                      ? { ...p, quantity: p.quantity - qty }
                      : p
                  )
                );
              }}
            />
          )}

          {safeTab === 'fuel' && visibleTabs.some(t => t.key === 'fuel') && (
            <FuelPanel fleet={fleetData} vendors={vendorsData} />
          )}

          {safeTab === 'finance' && visibleTabs.some(t => t.key === 'finance') && (
            <FinancePanel
              vendors={vendorsData}
              inventory={partsData}
              userRole={userProfile?.rol as any}
              setGlobalFinance={setAguilasFinance}
            />
          )}

          {safeTab === 'vendors' && visibleTabs.some(t => t.key === 'vendors') && (
            <VendorPanel vendors={vendorsData} setVendors={setVendorsData} />
          )}

          {safeTab === 'calendario' && visibleTabs.some(t => t.key === 'calendario') && (
            <FlightCalendar
              userRole={userProfile?.rol}
              userProfile={userProfile}
            />
          )}

          {/* [NEW v4.21] */}
          {safeTab === 'planificacion' && visibleTabs.some(t => t.key === 'planificacion') && (
            <FlightPlanningBoard
              userRole={userProfile?.rol}
              userProfile={userProfile}
            />
          )}

          {safeTab === 'flights' && visibleTabs.some(t => t.key === 'flights') && (
            <FlightRegister onFlightLogUpdate={() => {}} />
          )}

        </div>
      </main>

      {isRegisterOpen && canRegisterStaff && (
        <Register onClose={() => setIsRegisterOpen(false)} />
      )}

      <footer className="border-t border-white/5 bg-black/80 px-8 py-6 flex justify-between items-center mt-auto">
        <div className="text-[8px] text-slate-600 font-mono tracking-[0.5em] uppercase">
          Águilas Pilot — Strategic Division 2026
        </div>
        <div className="text-[8px] text-[#E1AD01] font-black uppercase tracking-[0.3em] italic text-right">
          Valkyron OS v6.1
        </div>
      </footer>
    </div>
  );
};

export default Index;


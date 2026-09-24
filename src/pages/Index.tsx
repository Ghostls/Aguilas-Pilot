// src/pages/Index.tsx
// VALKYRON OS v7.1 — CARGA NO BLOQUEANTE + RECUPERACIÓN DE SESIÓN
// FUSIÓN v6.1 + v7.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.1 (sobre v7.0):
//   [FIX] Cambio de usuario con el mismo rol: la carga no se repetía (mismas
//         dependencias) y se mostraban flota/stock/proveedores del usuario
//         anterior. Ahora los datos se limpian y recargan por usuario.
//   [FIX] Si una re-verificación retira el rol, los datos cargados se descartan.
//   [NEW] Pestaña activa recordada por usuario (sessionStorage), validada contra
//         los permisos actuales; ya no vuelve siempre a "Inicio" al recargar.
//   [NEW] Menú móvil se cierra con Escape.
//
// CHANGELOG v7.0:
//   [FIX CRÍTICO] La interfaz completa quedaba bloqueada en "Sincronizando Águilas
//         OS..." hasta que Flota, Inventario y Proveedores respondieran, sin límite
//         de tiempo. Ahora la interfaz se muestra al verificar la sesión y cada
//         recurso tiene su propio estado (cargando / listo / error) con Reintentar.
//   [FIX] Consultas cancelables (AbortController + .abortSignal) con límite de 15 s;
//         se cancelan al desmontar o al cambiar de usuario/rol.
//   [FIX] Cada rol solo consulta lo que necesita: el PLANIFICADOR no consulta
//         flota global, inventario ni proveedores; PILOTO/CAPITÁN solo flota.
//   [FIX] Un módulo cuyo dato falló muestra el error en lugar de aparentar
//         "sin registros" (nunca un éxito falso).
//   [FIX] Canal realtime de flota solo para roles que la cargan, con debounce.
//   [FIX] Cerrar sesión usa AuthContext.signOut (respaldo local sin red).
//   [NEW] Incidencias de permisos → AuthRecoveryPanel; ACCESO PENDIENTE con
//         Reintentar y Cerrar sesión.
// PRESERVADO (v4.20 → v6.1): tabs y matriz por rol, planificador con Hangar de
//   consulta + Planificación, Alta de Personal solo CEO/ADMIN/DIRECTOR, nav
//   responsive compacto, header, footer, syncFleet como onFleetChange para
//   ControlHub y FleetDashboard, todos los módulos y sus props.
//
// HISTORIAL PRESERVADO
// CHANGELOG v6.1: Hangar de consulta para PLANIFICADOR; roles solo desde
//   AuthContext; props heredadas userRole/fleet aceptadas sin conceder permisos.
// CHANGELOG v4.21:
//   [NEW] Tab 'planificacion' → FlightPlanningBoard dentro del mismo nav/header,
//         visible para CEO, ADMIN, DIRECTOR, PLANIFICADOR o fn_es_planificador().
//   [FIX] CAPITAN / INSTRUCTOR ven Mi Bitácora, Vuelos, Flota y Calendario.
//   [FIX] DIRECTOR tratado como ADMIN + Planificación.
//   [FIX] Si el tab activo deja de ser visible para el rol, vuelve al primero visible.
// v4.20: syncFleet como callback para ControlHub/FleetDashboard, canal realtime
//   con timestamp, filtro de tabs por rol, OPERACIONES = MECANICO.
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
import { AuthLoader, AuthRecoveryPanel } from '@/components/AuthRecoveryPanel';
import { useAuth, type UserRole } from '@/context/AuthContext';
import type { WorkOrder, Vendor, SparePart, Aircraft } from '@/Types/Maintenance';
import type { LucideIcon } from 'lucide-react';

import {
  Plane, Package, LogOut, Wrench, ClipboardCheck,
  Truck, Home, Fuel, X, DollarSign, Menu, FileText, Award, CalendarDays,
  CalendarCheck, AlertTriangle, Loader2, RefreshCw,
} from 'lucide-react';

type TabKey =
  | 'home' | 'captain-log' | 'fleet' | 'inventory'
  | 'control-hub' | 'checkout' | 'fuel' | 'finance' | 'vendors' | 'flights' | 'calendario'
  | 'planificacion' | 'hangar-consulta';

const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: 'home',            label: 'Inicio',            icon: Home           },
  { key: 'captain-log',     label: 'Mi Bitácora',       icon: Award          },
  { key: 'fleet',           label: 'Flota',             icon: Plane          },
  { key: 'flights',         label: 'Vuelos',            icon: FileText       },
  { key: 'planificacion',   label: 'Planificación',     icon: CalendarCheck  },
  { key: 'hangar-consulta', label: 'Hangar · Consulta', icon: Plane          },
  { key: 'inventory',       label: 'Stock',             icon: Package        },
  { key: 'control-hub',     label: 'Hangar MRO',        icon: Wrench         },
  { key: 'checkout',        label: 'Salidas',           icon: ClipboardCheck },
  { key: 'fuel',            label: 'AVGAS',             icon: Fuel           },
  { key: 'finance',         label: 'Dinero',            icon: DollarSign     },
  { key: 'vendors',         label: 'Aliados',           icon: Truck          },
  { key: 'calendario',      label: 'Calendario',        icon: CalendarDays   },
];

// ─── DATOS POR ROL ────────────────────────────────────────────────────────────
// Solo se consulta lo que el rol puede ver. La autorización real la aplica RLS.

const FLEET_DATA_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'MECANICO', 'OPERACIONES', 'PILOTO', 'CAPITAN'];
const STOCK_DATA_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'MECANICO', 'OPERACIONES'];

const DATA_TIMEOUT_MS = 15000;
const CLEANUP_REASON = 'cleanup';
const TAB_STORAGE_PREFIX = 'valkyron:tab:';

const readStoredTab = (userId: string | null): TabKey | null => {
  if (!userId) return null;
  try {
    const v = sessionStorage.getItem(`${TAB_STORAGE_PREFIX}${userId}`);
    return v && tabs.some(t => t.key === v) ? (v as TabKey) : null;
  } catch {
    return null;
  }
};

const writeStoredTab = (userId: string | null, tab: TabKey) => {
  if (!userId) return;
  try { sessionStorage.setItem(`${TAB_STORAGE_PREFIX}${userId}`, tab); } catch { /* bloqueado */ }
};

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
interface LoadState { status: LoadStatus; error: string | null; }
const IDLE: LoadState = { status: 'idle', error: null };

const abortedByCleanup = (signal?: AbortSignal) =>
  !!signal?.aborted && signal.reason === CLEANUP_REASON;

const loadErrorMessage = (signal: AbortSignal | undefined, fallback: string, recurso: string) =>
  signal?.aborted ? `Tiempo de espera agotado al consultar ${recurso}.` : fallback;

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

// ─── COMPONENTES AUXILIARES ───────────────────────────────────────────────────

const ModuleLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-white/10 bg-[#080808] py-24">
    <Loader2 className="h-7 w-7 animate-spin text-[#E1AD01]" />
    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">{label}</p>
  </div>
);

const ModuleError: React.FC<{ recurso: string; error: string | null; onRetry: () => void }> = ({ recurso, error, onRetry }) => (
  <div role="alert" className="rounded-3xl border border-red-500/25 bg-red-500/[0.05] p-8 text-center">
    <AlertTriangle className="mx-auto h-7 w-7 text-red-400" />
    <p className="mt-4 text-[11px] font-black uppercase tracking-widest text-red-400">No se pudo cargar {recurso}</p>
    <p className="mt-2 text-[10px] font-mono text-red-300/70">{error ?? 'Error desconocido'}</p>
    <p className="mt-2 text-[10px] text-slate-500">Los datos mostrados no están verificados; no se presentan como vacíos.</p>
    <button
      type="button"
      onClick={onRetry}
      className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[#E1AD01] px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white"
    >
      <RefreshCw className="h-4 w-4" /> Reintentar
    </button>
  </div>
);

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
// Props heredadas: se aceptan por compatibilidad, pero NO asignan permisos.
const Index = (_props: { userRole?: string; fleet?: any[] }) => {
  const [activeTab,        setActiveTab]        = useState<TabKey>('home');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRegisterOpen,   setIsRegisterOpen]   = useState(false);
  const [reloadKey,        setReloadKey]        = useState(0);
  const navigate = useNavigate();
  const {
    canPlan, role, profile, enriched, status, issue, retry, signOut, session,
  } = useAuth();
  const userId = session?.user?.id ?? null;

  const authReady = status === 'authenticated' && enriched && !!role;
  const isPlanner = role === 'PLANIFICADOR';
  const loadsFleet = authReady && !!role && FLEET_DATA_ROLES.includes(role);
  const loadsStock = authReady && !!role && STOCK_DATA_ROLES.includes(role);

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

  const [fleetState,   setFleetState]   = useState<LoadState>(IDLE);
  const [partsState,   setPartsState]   = useState<LoadState>(IDLE);
  const [vendorsState, setVendorsState] = useState<LoadState>(IDLE);

  // ── SYNC FLOTA ───────────────────────────────────────────────────────────
  const syncFleet = useCallback(async (signal?: AbortSignal) => {
    if (!loadsFleet) return;
    setFleetState(prev => (prev.status === 'ready' ? prev : { status: 'loading', error: null }));
    try {
      let query = supabase
        .from('flota_aviones')
        .select('*')
        .order('matricula', { ascending: true });
      if (signal) query = query.abortSignal(signal);
      const { data: aircrafts, error } = await query;

      if (abortedByCleanup(signal)) return;
      if (error || signal?.aborted) {
        setFleetState({ status: 'error', error: loadErrorMessage(signal, error?.message ?? 'Error', 'la flota') });
        return;
      }

      setFleetData((aircrafts ?? []).map((a: any) => ({
        id:                  a.id,
        tailNumber:          a.matricula,
        model:               a.modelo,
        status:              normalizeStatus(a.estado),
        location:            a.sede || 'LARA',
        components:          a.componentes || [],
        hours_vuelo_totales: a.horas_vuelo_totales || a.hours_vuelo_totales || 0,
      })));
      setFleetState({ status: 'ready', error: null });
    } catch (err) {
      if (abortedByCleanup(signal)) return;
      setFleetState({ status: 'error', error: err instanceof Error ? err.message : 'Error de conexión' });
    }
  }, [loadsFleet]);

  // Callback estable para módulos hijos (ControlHub, FleetDashboard)
  const refreshFleet = useCallback(() => syncFleet(), [syncFleet]);

  // ── INVENTARIO ────────────────────────────────────────────────────────────
  const loadParts = useCallback(async (signal: AbortSignal) => {
    setPartsState({ status: 'loading', error: null });
    try {
      const { data: spares, error } = await supabase
        .from('inventario_repuestos')
        .select('*')
        .abortSignal(signal);
      if (abortedByCleanup(signal)) return;
      if (error || signal.aborted) {
        setPartsState({ status: 'error', error: loadErrorMessage(signal, error?.message ?? 'Error', 'el inventario') });
        return;
      }
      setPartsData((spares ?? []).map((p: any) => ({
        id:         p.id,
        partNumber: p.numero_parte,
        name:       p.nombre,
        quantity:   p.cantidad,
        minStock:   p.stock_minimo    || 0,
        unitPrice:  p.precio_unitario || 0,
        location:   p.ubicacion       || 'LARA',
        category:   p.categoria       || 'General',
      })));
      setPartsState({ status: 'ready', error: null });
    } catch (err) {
      if (abortedByCleanup(signal)) return;
      setPartsState({ status: 'error', error: err instanceof Error ? err.message : 'Error de conexión' });
    }
  }, []);

  // ── PROVEEDORES ───────────────────────────────────────────────────────────
  const loadVendors = useCallback(async (signal: AbortSignal) => {
    setVendorsState({ status: 'loading', error: null });
    try {
      const { data: provData, error } = await supabase
        .from('proveedores')
        .select('*')
        .order('nombre_empresa', { ascending: true })
        .abortSignal(signal);
      if (abortedByCleanup(signal)) return;
      if (error || signal.aborted) {
        setVendorsState({ status: 'error', error: loadErrorMessage(signal, error?.message ?? 'Error', 'los proveedores') });
        return;
      }
      setVendorsData((provData ?? []).map((p: any) => ({
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
      setVendorsState({ status: 'ready', error: null });
    } catch (err) {
      if (abortedByCleanup(signal)) return;
      setVendorsState({ status: 'error', error: err instanceof Error ? err.message : 'Error de conexión' });
    }
  }, []);

  // ── [v7.1] AISLAMIENTO POR USUARIO: limpiar al cambiar de usuario o perder rol ─
  useEffect(() => {
    setFleetData([]);        setFleetState(IDLE);
    setPartsData([]);        setPartsState(IDLE);
    setVendorsData([]);      setVendorsState(IDLE);
    setTasksData([]);
    setTransactionsData([]);
    setAguilasFinance({ CASH: 0, ZELLE: 0, USDT: 0, BS: 0 });
    setIsRegisterOpen(false);
    const stored = readStoredTab(userId);
    setActiveTab(stored ?? 'home');
  }, [userId, authReady]);

  // ── CARGA INICIAL (no bloqueante, cancelable, con límite de tiempo) ───────
  useEffect(() => {
    if (!authReady) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), DATA_TIMEOUT_MS);

    if (loadsFleet) void syncFleet(controller.signal);
    else { setFleetData([]); setFleetState(IDLE); }

    if (loadsStock) {
      void loadParts(controller.signal);
      void loadVendors(controller.signal);
    } else {
      setPartsData([]); setPartsState(IDLE);
      setVendorsData([]); setVendorsState(IDLE);
    }

    return () => {
      clearTimeout(timer);
      controller.abort(CLEANUP_REASON);
    };
  }, [authReady, userId, loadsFleet, loadsStock, syncFleet, loadParts, loadVendors, reloadKey]);

  // ── REALTIME FLOTA (solo roles que la cargan) ────────────────────────────
  useEffect(() => {
    if (!loadsFleet) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    // Canal con nombre único por montaje → evita conflicto con canales huérfanos
    const channelName = `index-fleet-monitor-${Date.now()}`;
    const fleetChannel = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => { void syncFleet(); }, 500);
        },
      )
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(fleetChannel);
    };
  }, [loadsFleet, syncFleet]);

  const retryData = () => setReloadKey(k => k + 1);

  // [v7.1] Recordar la pestaña activa por usuario
  useEffect(() => {
    if (authReady) writeStoredTab(userId, activeTab);
  }, [authReady, userId, activeTab]);

  // [v7.1] Cerrar menú móvil con Escape
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileMenuOpen]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  // ── FILTRO DE TABS POR ROL ───────────────────────────────────────────────
  const visibleTabs = tabs.filter(tab => {
    // Acceso exclusivo del planificador: consulta de hangar y planificación.
    if (!enriched || status !== 'authenticated' || !role) return false;
    if (isPlanner) return tab.key === 'hangar-consulta' || (tab.key === 'planificacion' && canPlan);
    if (tab.key === 'hangar-consulta') return false;
    if (tab.key === 'planificacion') return canPlan;
    if (role === 'CEO') return true;
    if (role === 'ADMIN' || role === 'DIRECTOR')
      return ['home', 'inventory', 'fuel', 'finance', 'vendors', 'flights', 'fleet', 'calendario'].includes(tab.key);
    if (role === 'MECANICO' || role === 'OPERACIONES')
      return ['home', 'fleet', 'inventory', 'control-hub', 'checkout', 'fuel'].includes(tab.key);
    if (role === 'PILOTO' || role === 'CAPITAN')
      return ['home', 'captain-log', 'flights', 'fleet', 'calendario'].includes(tab.key);
    return tab.key === 'home';
  });
  const safeTab: TabKey = visibleTabs.some(tab => tab.key === activeTab)
    ? activeTab
    : (visibleTabs[0]?.key ?? 'home');
  const isVisible = (key: TabKey) => visibleTabs.some(t => t.key === key);

  useEffect(() => {
    if (enriched && visibleTabs.length && !visibleTabs.some(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [enriched, role, canPlan, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GUARDIA DE MÓDULO: nunca mostrar "vacío" si la carga falló ───────────
  const guard = (
    deps: { state: LoadState; recurso: string }[],
    hasData: boolean,
    node: React.ReactNode,
  ): React.ReactNode => {
    const failed = deps.find(d => d.state.status === 'error');
    const pending = deps.some(d => d.state.status === 'loading' || d.state.status === 'idle');
    if (!hasData && failed) return <ModuleError recurso={failed.recurso} error={failed.state.error} onRetry={retryData} />;
    if (!hasData && pending) return <ModuleLoading label={`Cargando ${deps.map(d => d.recurso).join(' y ')}...`} />;
    return node;
  };

  // ── ESTADOS DE SESIÓN ────────────────────────────────────────────────────
  if (status === 'loading' || (status === 'authenticated' && !enriched)) {
    return <AuthLoader label="Sincronizando Águilas OS..." />;
  }

  if (status === 'error') {
    return <AuthRecoveryPanel fullScreen />;
  }

  if (status !== 'authenticated' || !role) {
    if (issue && issue !== 'PERMISSIONS_PENDING') return <AuthRecoveryPanel fullScreen />;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020202] p-8 text-center text-white">
        <div className="max-w-md">
          <h2 className="text-xl font-black">ACCESO PENDIENTE</h2>
          <p className="mt-3 text-sm text-slate-400">Tu rol debe ser asignado por administración.</p>
          <p className="mt-2 text-xs text-slate-600">Si ya fue asignado, pulsa Reintentar para volver a verificar.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button onClick={retry} className="rounded-lg bg-[#E1AD01] px-5 py-3 text-black font-bold">Reintentar</button>
            <button onClick={() => void handleLogout()} className="rounded-lg border border-white/15 px-5 py-3 text-slate-300">Cerrar sesión</button>
          </div>
        </div>
      </div>
    );
  }

  const failedLoads = [
    { state: fleetState, recurso: 'flota' },
    { state: partsState, recurso: 'inventario' },
    { state: vendorsState, recurso: 'proveedores' },
  ].filter(d => d.state.status === 'error');
  const loadingLoads = [fleetState, partsState, vendorsState].some(s => s.status === 'loading');

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
        <div className="relative mx-auto flex w-full max-w-[1920px] min-w-0 items-center rounded-2xl border border-white/10 bg-[#0a0a0a]/95 px-1 py-1 shadow-2xl backdrop-blur-2xl">

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
              onClick={() => void handleLogout()}
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
                onClick={() => void handleLogout()}
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

      {/* ESTADO DE DATOS */}
      {(failedLoads.length > 0 || loadingLoads) && (
        <div className="px-4 md:px-8 pb-4">
          <div className={`mx-auto max-w-[1750px] flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
            failedLoads.length > 0 ? 'border-red-500/25 bg-red-500/[0.05]' : 'border-white/10 bg-white/[0.02]'
          }`}>
            <div className="flex items-center gap-3">
              {failedLoads.length > 0
                ? <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                : <Loader2 className="h-4 w-4 animate-spin text-[#E1AD01] shrink-0" />}
              <p className={`text-[10px] font-black uppercase tracking-widest ${failedLoads.length > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                {failedLoads.length > 0
                  ? `Sin sincronizar: ${failedLoads.map(f => f.recurso).join(', ')}. Los valores de esos módulos no están verificados.`
                  : 'Sincronizando datos operativos...'}
              </p>
            </div>
            {failedLoads.length > 0 && (
              <button
                type="button"
                onClick={retryData}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E1AD01] px-4 py-2 text-[9px] font-black uppercase tracking-widest text-black hover:bg-white"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reintentar
              </button>
            )}
          </div>
        </div>
      )}

      {/* MAIN */}
      <main className="flex-1 px-4 md:px-8 pb-8 text-left">
        <div className="max-w-[1750px] mx-auto animate-in fade-in duration-500">

          {safeTab === 'home' && isVisible('home') && (
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

          {safeTab === 'captain-log' && isVisible('captain-log') && (
            <CaptainDashboard userProfile={userProfile} />
          )}

          {safeTab === 'fleet' && isVisible('fleet') && guard(
            [{ state: fleetState, recurso: 'la flota' }],
            fleetData.length > 0,
            <FleetDashboard
              fleetData={fleetData}
              setFleetData={setFleetData}
              onFleetChange={refreshFleet}
            />,
          )}

          {safeTab === 'inventory' && isVisible('inventory') && guard(
            [{ state: partsState, recurso: 'el inventario' }],
            partsData.length > 0,
            <InventoryPanel
              parts={partsData}
              setParts={setPartsData}
              transactions={transactionsData}
              setTransactions={setTransactionsData}
              vendors={vendorsData}
              userRole={userProfile?.rol}
            />,
          )}

          {safeTab === 'control-hub' && isVisible('control-hub') && guard(
            [{ state: fleetState, recurso: 'la flota' }, { state: partsState, recurso: 'el inventario' }],
            fleetData.length > 0 && partsData.length > 0,
            <ControlHub
              tasks={tasksData}
              setTasks={setTasksData}
              fleet={fleetData}
              setFleet={setFleetData}
              inventory={partsData}
              onPartsUsage={() => {}}
              onFleetChange={refreshFleet}
            />,
          )}

          {safeTab === 'checkout' && isVisible('checkout') && (
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

          {safeTab === 'fuel' && isVisible('fuel') && guard(
            [{ state: fleetState, recurso: 'la flota' }],
            fleetData.length > 0,
            <FuelPanel fleet={fleetData} vendors={vendorsData} />,
          )}

          {safeTab === 'finance' && isVisible('finance') && (
            <FinancePanel
              vendors={vendorsData}
              inventory={partsData}
              userRole={userProfile?.rol as any}
              setGlobalFinance={setAguilasFinance}
            />
          )}

          {safeTab === 'vendors' && isVisible('vendors') && guard(
            [{ state: vendorsState, recurso: 'los proveedores' }],
            vendorsData.length > 0,
            <VendorPanel vendors={vendorsData} setVendors={setVendorsData} />,
          )}

          {safeTab === 'calendario' && isVisible('calendario') && (
            <FlightCalendar
              userRole={userProfile?.rol}
              userProfile={userProfile}
            />
          )}

          {safeTab === 'planificacion' && isVisible('planificacion') && (
            <FlightPlanningBoard
              userRole={userProfile?.rol}
              userProfile={userProfile}
            />
          )}

          {safeTab === 'flights' && isVisible('flights') && (
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
          Valkyron OS v7.1
        </div>
      </footer>
    </div>
  );
};

export default Index;
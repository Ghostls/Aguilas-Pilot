// src/pages/Index.tsx
// VALKYRON OS v7.3.5 — Archivo OMA + Stock completo + Impresión · B&M MANTENIMIENTO AERONÁUTICO
// FUSIÓN v6.1 + v7.0 + v7.1 + rebrand B&M
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.3.5:
//   [UI]  Hangar de consulta (PlannerHangar v2.2), Mi Bitácora (CaptainDashboard
//         v2.2), Calendario (FlightCalendar v2.1) y Planificación de vuelo
//         (FlightPlanningboard v1.2) ya son B&M: se retira LegacyModuleFrame.
//         Ningún módulo de Index lo usa ya; el marco se conserva sin usos por si
//         hay que volver a envolver un módulo durante una migración.
//
// CHANGELOG v7.3.4:
//   [UI]  Finanzas (FinancePanel v17.1) ya es B&M: se retira LegacyModuleFrame.
//
// CHANGELOG v7.3.3:
//   [UI]  Registro de vuelo (FlightRegister v7.1) y Alta de personal
//         (Register v3.2) ya son B&M: se retiran LegacyModuleFrame y el
//         envoltorio oscuro del modal de alta.
//
// CHANGELOG v7.3.2:
//   [UI]  Flota (FleetDashboard v5.7), Combustible (FuelPanel v4.4) y Proveedores
//         (VendorPanel v2.0) ya son B&M: se retiran de LegacyModuleFrame.
//   [FIX] onCheckoutSuccess: un repuesto con P/N nulo rompía la actualización
//         del stock tras una salida (p.partNumber.toUpperCase()).
//
// CHANGELOG v7.3.1:
//   [FIX] StatusBar recibe onOpenRegister solo si el rol puede dar de alta
//         (CEO, ADMIN, DIRECTOR). Antes la barra mostraba el botón únicamente al
//         CEO y ADMIN/DIRECTOR no podían abrir el alta. Misma regla de seguridad.
//   [UI]  Hangar MRO (ControlHub v5.7), Stock (InventoryPanel v2.5) y Salidas
//         (InventoryCheckout v2.2) ya son B&M: se retiran de LegacyModuleFrame.
//
// CHANGELOG v7.3 — REBRAND B&M (solo presentación):
//   [UI]  Shell B&M: lienzo #F2F3F5, superficies blancas, rojo B&M como acento.
//         Escritorio (lg+): barra lateral fija con logo, módulos y tarjeta de
//         usuario + Cerrar sesión. Móvil: barra superior con logo y botón Menú,
//         que abre un panel lateral con los mismos módulos.
//   [UI]  Encabezado de sección con ícono rojo, nombre y operador. En Inicio se
//         omite (HomeDashboard trae su propio encabezado). Los botones Archivo
//         Histórico OMA / Imprimir inventario / Archivo de inventario pasan al
//         encabezado, con las mismas condiciones de rol y estado.
//   [UI]  ModuleLoading, ModuleError, banner de sincronización y pantalla de
//         Acceso pendiente con estética B&M. Footer con marca B&M.
//   [UI]  LegacyModuleFrame: los módulos que aún tienen estética Águilas (fondo
//         negro fijo y texto blanco heredado) se muestran dentro de un marco
//         oscuro .dark para que sigan legibles en el shell claro. Se retira
//         módulo a módulo a medida que se migran. HomeDashboard ya va sin marco.
//   [UI]  Impresión de inventario con encabezado B&M (rojo en lugar de dorado).
//   [UX]  Panel móvil: cierra tocando fuera, con la X, con Escape (v7.1) o al
//         elegir un módulo; bloquea el scroll de fondo mientras está abierto.
// PRESERVADO ÍNTEGRO (v7.1): matriz de tabs por rol, carga por rol con timeout y
//   AbortController, aislamiento por usuario, pestaña recordada, navegación
//   desde archivos, realtime de flota con debounce, guard de módulos, impresión,
//   handleLogout, todos los módulos con sus props.
//
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
import { useNavigate, useLocation } from 'react-router-dom';
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
import { BmLogo } from '@/components/brand/BmLogo'; // [v7.3] identidad B&M
import { useAuth, type UserRole } from '@/context/AuthContext';
import type { WorkOrder, Vendor, SparePart, Aircraft } from '@/Types/Maintenance';
import type { LucideIcon } from 'lucide-react';

import {
  Plane, Package, LogOut, Wrench, ClipboardCheck,
  Truck, Home, Fuel, X, DollarSign, Menu, FileText, Award, CalendarDays,
  CalendarCheck, AlertTriangle, Loader2, RefreshCw, Archive, Printer,
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

// [v7.3] Nombre legible del rol (solo presentación; los permisos no cambian)
const ROLE_LABELS: Record<string, string> = {
  CEO: 'CEO',
  ADMIN: 'Administración',
  DIRECTOR: 'Dirección',
  MECANICO: 'Mecánico',
  OPERACIONES: 'Operaciones',
  PILOTO: 'Piloto',
  CAPITAN: 'Capitán',
  PLANIFICADOR: 'Planificador de vuelo',
};

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

// [v7.3] Clases compartidas de botones del shell
const btnPrimary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-bm-red px-5 text-sm font-semibold text-white ' +
  'transition hover:bg-bm-red-deep active:scale-[0.99]';
const btnSecondary =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-bm-line bg-white px-4 text-sm font-semibold ' +
  'text-bm-ink transition-colors hover:border-bm-red hover:text-bm-red ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-bm-line disabled:hover:text-bm-ink';

const ModuleLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-bm-line bg-white py-20" role="status">
    <Loader2 className="h-7 w-7 animate-spin text-bm-red" />
    <p className="text-sm font-medium text-bm-steel">{label}</p>
  </div>
);

const ModuleError: React.FC<{ recurso: string; error: string | null; onRetry: () => void }> = ({ recurso, error, onRetry }) => (
  <div role="alert" className="rounded-[24px] border border-bm-red/25 bg-white px-5 py-10 sm:p-10 text-center">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bm-red-tint text-bm-red">
      <AlertTriangle className="h-5 w-5" />
    </div>
    <p className="mt-4 text-base font-semibold text-bm-ink">No se pudo cargar {recurso}</p>
    <p className="mx-auto mt-3 max-w-md rounded-xl bg-bm-canvas px-3 py-2 font-data text-xs text-bm-steel break-words">{error ?? 'Error desconocido'}</p>
    <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-bm-steel">Los datos mostrados no están verificados; no se presentan como vacíos.</p>
    <button
      type="button"
      onClick={onRetry}
      className={`${btnPrimary} mt-6`}
    >
      <RefreshCw className="h-4 w-4" /> Reintentar
    </button>
  </div>
);

/**
 * [v7.3] Marco temporal para módulos que aún conservan la estética Águilas
 * (fondo negro fijo y texto blanco heredado del shell anterior). La clase .dark
 * aplica la variante nocturna B&M a los componentes shadcn internos.
 * Se elimina de cada módulo cuando ese módulo se migra a B&M.
 */
// [v7.3.5] Sin usos en Index tras migrar Planificación, Calendario, Mi Bitácora y Hangar.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LegacyModuleFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="dark rounded-[24px] bg-[#050505] p-3 text-white sm:p-5">
    {children}
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
  const location = useLocation();
  const requestedTab = (location.state as { openTab?: unknown } | null)?.openTab;
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

  // PostgREST impone límites por respuesta: lectura completa en lotes estables.
  const readAllParts = useCallback(async (signal: AbortSignal) => {
    const all: any[] = [];
    const BATCH = 500;
    const MAX = 100000;
    for (let start = 0; start < MAX; start += BATCH) {
      if (signal.aborted) throw new Error('Consulta cancelada');
      const { data, error } = await supabase.from('inventario_repuestos')
        .select('*').order('id', { ascending: true })
        .range(start, start + BATCH - 1).abortSignal(signal);
      if (error) throw error;
      all.push(...(data ?? []));
      if ((data ?? []).length < BATCH) return all;
    }
    throw new Error(`Inventario superior a ${MAX} filas; se requiere paginación en servidor.`);
  }, []);

  // ── INVENTARIO ────────────────────────────────────────────────────────────
  const loadParts = useCallback(async (signal: AbortSignal) => {
    setPartsState({ status: 'loading', error: null });
    try {
      const spares = await readAllParts(signal);
      if (abortedByCleanup(signal)) return;
      if (signal.aborted) {
        setPartsState({ status: 'error', error: 'Tiempo de espera agotado al consultar el inventario.' });
        return;
      }
      setPartsData((spares ?? []).map((p: any) => ({
        id:         p.id,
        partNumber: p.numero_parte,
        name:       p.nombre,
        quantity:   p.cantidad,
        minStock:   p.stock_minimo    || 0,
        unitPrice:  p.precio_unitario || 0,
        location:   p.ubicacion_hangar || p.ubicacion || 'LARA',
        category:   p.categoria       || 'General',
      })));
      setPartsState({ status: 'ready', error: null });
    } catch (err) {
      if (abortedByCleanup(signal)) return;
      setPartsState({ status: 'error', error: err instanceof Error ? err.message : 'Error de conexión' });
    }
  }, [readAllParts]);

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
    setActiveTab(requestedTab === 'fleet' || requestedTab === 'inventory' ? requestedTab : stored ?? 'home');
  }, [userId, authReady]);

  // Navegación desde los archivos históricos: abre la pestaña solicitada.
  useEffect(() => {
    if (!authReady) return;
    if (requestedTab !== 'fleet' && requestedTab !== 'inventory') return;
    const permitted = requestedTab === 'fleet' ? loadsFleet : loadsStock;
    if (permitted) setActiveTab(requestedTab);
    // Consumir state para que una recarga posterior no reproduzca la navegación.
    navigate('/', { replace: true, state: null });
  }, [authReady, requestedTab, loadsFleet, loadsStock, navigate]);

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

  const printInventory = () => {
    // Sólo el módulo de stock validado puede imprimir los datos cargados.
    if (!role || !STOCK_DATA_ROLES.includes(role) || partsState.status !== 'ready') return;
    const escape = (v: unknown) => String(v ?? '—')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const w = window.open('', '_blank', 'width=1200,height=900');
    if (!w) { window.alert('Habilita las ventanas emergentes para imprimir.'); return; }
    const rows = partsData.map(p => `<tr><td>${escape(p.partNumber)}</td><td>${escape(p.name)}</td><td>${escape(p.quantity)}</td><td>${escape(p.minStock)}</td><td>${escape(p.location)}</td><td>${escape(p.category)}</td><td>${escape(p.unitPrice)}</td></tr>`).join('');
    // [v7.3] Encabezado de impresión con marca B&M (rojo #D42125 en lugar de dorado)
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>B&amp;M Mantenimiento Aeronáutico — Inventario</title><style>
      @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;padding:18px;color:#1b1d22}
      h1{font-size:20px;border-bottom:3px solid #d42125;padding-bottom:12px}p{font-size:10px;color:#5f6670}
      table{width:100%;border-collapse:collapse;font-size:9px}td,th{border:1px solid #c9ccd2;padding:6px;text-align:left;overflow-wrap:anywhere}
      th{background:#f2f3f5}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body>
      <h1>B&amp;M MANTENIMIENTO AERONÁUTICO — INVENTARIO GENERAL</h1><p>Fecha: ${escape(new Date().toLocaleString('es-VE'))} · Referencias: ${partsData.length}</p>
      <p>Existencias registradas en Supabase. Requieren conciliación física para certificar inventario.</p>
      <table><thead><tr><th>P/N</th><th>Descripción</th><th>Cantidad</th><th>Mínimo</th><th>Ubicación</th><th>Categoría</th><th>Precio unitario</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close(); w.focus(); w.print();
  };

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

  // [v7.3] Bloquear el scroll del fondo mientras el panel móvil está abierto
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
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
    return <AuthLoader label="Sincronizando B&M…" />;
  }

  if (status === 'error') {
    return <AuthRecoveryPanel fullScreen />;
  }

  if (status !== 'authenticated' || !role) {
    if (issue && issue !== 'PERMISSIONS_PENDING') return <AuthRecoveryPanel fullScreen />;
    return (
      <div className="bm-app flex min-h-[100dvh] items-center justify-center bg-bm-canvas px-5 py-10 text-bm-ink">
        <div className="w-full max-w-md rounded-[24px] border border-bm-line bg-white p-6 text-left shadow-bm-pop sm:p-8">
          <BmLogo variant="compact" className="h-9 w-auto text-bm-red" />
          <h2 className="bm-heading mt-8 text-2xl leading-tight">Acceso pendiente</h2>
          <p className="mt-3 text-sm leading-relaxed text-bm-steel">Su rol debe ser asignado por administración.</p>
          <p className="mt-2 text-[13px] leading-relaxed text-bm-steel">Si ya fue asignado, pulse Reintentar para volver a verificar.</p>
          <div className="mt-7 grid gap-2.5 sm:grid-cols-2">
            <button onClick={retry} className={`${btnPrimary} h-12 w-full`}>Reintentar</button>
            <button onClick={() => void handleLogout()} className={`${btnSecondary} h-12 w-full`}>
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
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

  // ── [v7.3] DATOS DE PRESENTACIÓN DEL SHELL ───────────────────────────────
  const currentTab = tabs.find(t => t.key === safeTab);
  const CurrentIcon = currentTab?.icon || Home;
  const operatorName = userProfile?.nombre_completo || 'Root';
  const roleLabel = userProfile?.rol ? (ROLE_LABELS[userProfile.rol] ?? userProfile.rol) : 'Sin rol';
  const sedeLabel = userProfile?.sede ? `sede ${userProfile.sede}` : '';
  const initials = operatorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join('') || 'B';
  const showDataBanner = failedLoads.length > 0 || loadingLoads;
  const topPad = safeTab === 'home' ? 'pt-3 sm:pt-6' : '';

  /** [v7.3] Navegación compartida: barra lateral (escritorio) y panel móvil. */
  const renderNav = (onAfterSelect?: () => void, inDrawer = false) => (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 px-5 lg:h-20">
        <BmLogo variant="compact" className="h-8 w-auto text-bm-red lg:h-9" />
        {inDrawer && (
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setIsMobileMenuOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-bm-canvas text-bm-ink hover:bg-bm-red-tint hover:text-bm-red"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav aria-label="Módulos" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5">
          {visibleTabs.map(tab => {
            const Icon = tab.icon;
            const active = safeTab === tab.key;

            return (
              <li key={tab.key}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key);
                    onAfterSelect?.();
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] transition-colors ${
                    active
                      ? 'bg-bm-red-tint font-semibold text-bm-red'
                      : 'font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink'
                  }`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-bm-line p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bm-ink text-sm font-semibold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-bm-ink">{operatorName}</p>
            <p className="truncate text-xs text-bm-steel">{roleLabel}{sedeLabel ? `, ${sedeLabel}` : ''}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-1 flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-bm-red-deep transition-colors hover:bg-bm-red-tint"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          Cerrar sesión
        </button>
      </div>
    </>
  );

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="bm-app flex min-h-[100dvh] bg-bm-canvas text-left text-bm-ink">

      {/* BARRA LATERAL — ESCRITORIO */}
      <aside className="sticky top-0 hidden h-[100dvh] w-[248px] shrink-0 flex-col border-r border-bm-line bg-white lg:flex xl:w-[264px]">
        {renderNav()}
      </aside>

      {/* COLUMNA DE CONTENIDO */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        {!isPlanner && (
          <StatusBar onOpenRegister={canRegisterStaff ? () => setIsRegisterOpen(true) : undefined} />
        )}

        {/* BARRA SUPERIOR — MÓVIL Y TABLET */}
        <div className="sticky top-0 z-50 border-b border-bm-line bg-white/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
            <BmLogo variant="compact" className="h-7 w-auto text-bm-red" />
            <button
              type="button"
              aria-label="Abrir menú"
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-bm-line bg-white px-3.5 text-sm font-semibold text-bm-ink"
            >
              {isMobileMenuOpen
                ? <X className="h-5 w-5" />
                : <Menu className="h-5 w-5" />}
              <span>Menú</span>
            </button>
          </div>
        </div>

        {/* HEADER (Inicio usa el encabezado propio de HomeDashboard) */}
        {safeTab !== 'home' && (
          <header className="px-4 pb-4 pt-5 sm:px-6 sm:pt-7 lg:px-8">
            <div className="mx-auto flex max-w-[1750px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red text-white sm:h-12 sm:w-12">
                  <CurrentIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                </span>
                <div className="min-w-0">
                  <h1 className="bm-heading truncate text-[22px] leading-tight sm:text-[28px]">{currentTab?.label}</h1>
                  <p className="truncate text-[13px] text-bm-steel">
                    {operatorName}, {roleLabel}{sedeLabel ? `, ${sedeLabel}` : ''}
                  </p>
                </div>
              </div>

              {/* Acciones de sección (mismas condiciones que v7.1) */}
              {safeTab === 'fleet' && isVisible('fleet') && role && ['CEO','ADMIN','DIRECTOR','MECANICO','OPERACIONES'].includes(role) && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => navigate('/aircraft-archive')}
                    className={`${btnSecondary} w-full sm:w-auto`}>
                    <Archive className="h-4 w-4" /> Archivo histórico OMA
                  </button>
                </div>
              )}

              {safeTab === 'inventory' && isVisible('inventory') && (
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <button type="button" disabled={partsState.status !== 'ready'} onClick={printInventory}
                    className={btnSecondary}>
                    <Printer className="h-4 w-4" /> Imprimir inventario completo
                  </button>
                  {role && ['CEO','MECANICO','OPERACIONES'].includes(role) && (
                    <button type="button" onClick={() => navigate('/inventory-archive')}
                      className={btnSecondary}>
                      <Archive className="h-4 w-4" /> Archivo de inventario
                    </button>
                  )}
                </div>
              )}
            </div>
          </header>
        )}

        {/* ESTADO DE DATOS */}
        {showDataBanner && (
          <div className={`px-3 pb-3 sm:px-6 sm:pb-4 lg:px-8 ${topPad}`}>
            <div
              className={`mx-auto flex max-w-[1750px] flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                failedLoads.length > 0 ? 'border-bm-red/25 bg-bm-red-tint' : 'border-bm-line bg-white'
              }`}
              role={failedLoads.length > 0 ? 'alert' : 'status'}
            >
              <div className="flex min-w-0 items-center gap-3">
                {failedLoads.length > 0
                  ? <AlertTriangle className="h-4 w-4 shrink-0 text-bm-red" />
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-bm-red" />}
                <p className={`text-sm ${failedLoads.length > 0 ? 'font-medium text-bm-red-deep' : 'text-bm-steel'}`}>
                  {failedLoads.length > 0
                    ? `Sin sincronizar: ${failedLoads.map(f => f.recurso).join(', ')}. Los valores de esos módulos no están verificados.`
                    : 'Sincronizando datos operativos…'}
                </p>
              </div>
              {failedLoads.length > 0 && (
                <button
                  type="button"
                  onClick={retryData}
                  className={`${btnPrimary} h-10 px-4`}
                >
                  <RefreshCw className="h-4 w-4" /> Reintentar
                </button>
              )}
            </div>
          </div>
        )}

        {/* MAIN */}
        <main className={`flex-1 px-3 pb-8 sm:px-6 lg:px-8 ${showDataBanner ? '' : topPad}`}>
          <div className="mx-auto max-w-[1750px] animate-in fade-in duration-500">

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

            {safeTab === 'hangar-consulta' && isPlanner && (
              <PlannerHangar />   // [v7.3.5] B&M: sin LegacyModuleFrame
            )}

            {safeTab === 'captain-log' && isVisible('captain-log') && (
              <CaptainDashboard userProfile={userProfile} />   // [v7.3.5] B&M
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
                      String(p.partNumber ?? '').toUpperCase() === pn // [v7.3.2] P/N nulo no rompe
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
              // [v7.3.5] B&M: sin LegacyModuleFrame
              <FlightCalendar
                userRole={userProfile?.rol}
                userProfile={userProfile}
              />
            )}

            {safeTab === 'planificacion' && isVisible('planificacion') && (
              // [v7.3.5] B&M: sin LegacyModuleFrame
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
          // [v7.3.3] Register v3.2 es un BmModal B&M: sin envoltorio oscuro
          <Register onClose={() => setIsRegisterOpen(false)} />
        )}

        <footer className="mt-auto flex flex-col gap-1 border-t border-bm-line px-4 py-5 text-xs text-bm-steel sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>B&amp;M Mantenimiento Aeronáutico</span>
          <span>Valkyron OS v7.3.5</span>
        </footer>
      </div>

      {/* PANEL DE NAVEGACIÓN — MÓVIL Y TABLET */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[150] lg:hidden">
          <div
            className="bm-backdrop absolute inset-0 bg-bm-ink/50"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menú de módulos"
            className="bm-drawer absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col bg-white shadow-bm-sheet"
          >
            {renderNav(() => setIsMobileMenuOpen(false), true)}
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;

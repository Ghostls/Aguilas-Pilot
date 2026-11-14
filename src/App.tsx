// NÚCLEO DE INTELIGENCIA OPERATIVA - VALKYRON OS v7.3.2
// B&M MANTENIMIENTO AERONÁUTICO (ex Águilas Pilot) — Inventario & MRO
// ─────────────────────────────────────────────────────────────────────────────
// FUSIÓN v5.0 + v7.0 + v7.1 + rebrand B&M
//
// CHANGELOG v7.3.2:
//   [UI]  /inventory-archive sin marco: InventoryArchive v2.0 es una página B&M
//         completa con cabecera propia y "Volver a Stock" (igual que
//         /aircraft-archive). Ninguna ruta usa ya frame="legacy"; la variante se
//         conserva en RouteFrame por compatibilidad.
//
// CHANGELOG v7.3.1:
//   [UI]  /planificacion pasa a frame="bm": FlightPlanningboard v1.2 ya es B&M
//         (antes frame="legacy", fondo oscuro).
//
// CHANGELOG v7.3 — RUTAS DIRECTAS CON MARCO:
//   [FIX] Las rutas directas (/control-hub, /inventory-checkout,
//         /flight-register, /planificacion, /inventory-archive) pintaban el
//         módulo suelto sobre el lienzo claro de B&M: los módulos aún con
//         estética Águilas (texto blanco, sin fondo propio) quedaban ilegibles
//         y los ya migrados quedaban pegados a los bordes, sin forma de volver.
//         ProtectedRoute acepta `frame`:
//           'bm'     → cabecera B&M (logo, nombre del módulo, Centro de mando)
//                      y contenedor con márgenes. Módulos ya migrados.
//           'legacy' → fondo oscuro de la estética anterior hasta migrarlos.
//           'none'   → sin marco (páginas con cabecera propia, como el
//                      Archivo histórico OMA v2.0). Valor por defecto.
//         El marco envuelve DESPUÉS de cloneElement: el módulo sigue
//         recibiendo userRole / userProfile / fleet igual que antes.
//
// CHANGELOG v7.2 — REBRAND B&M (solo presentación):
//   [UI]  AccessDenied y ModuleErrorBoundary con identidad B&M: lienzo claro,
//         tarjeta blanca, logo <BmLogo>, rojo B&M en la acción principal.
//         Usan los colores semánticos del tema (bg-card, text-primary,
//         bg-muted…), así que también funcionan dentro de .dark.
//   [UI]  Mobile-first: tarjeta a ancho completo en móvil (máx. 448 px),
//         botones de 48 px, min-h-[100dvh] en lugar de h-screen (barra de
//         direcciones de iOS/Android).
//   [UI]  Textos sin marca Águilas: "Sincronizando B&M", "nueva versión del
//         sistema", "Volver al inicio".
//   [UI]  Toasts de Sonner fijados en tema claro (theme="light").
// PRESERVADO ÍNTEGRO (v7.1): lazyWithRetry y su control por sessionStorage,
//   ModuleErrorBoundary (detección de chunk, Reintentar / Recargar con limpieza
//   de claves), ROUTE_ROLES, FLEET_ROLES, useGlobalFleet (abort, debounce 400 ms,
//   canal único, limpieza por usuario), ProtectedRoute, rutas, AuthProvider
//   único, QueryClient, re-exports.
//
// CHANGELOG v7.1 (sobre v7.0):
//   [NEW] lazyWithRetry: si un módulo lazy falla al descargarse (típico tras un
//         despliegue en Vercel con index.html antiguo en caché), reintenta y luego
//         recarga la página UNA sola vez (control por sessionStorage). Nunca en bucle.
//   [NEW] ModuleErrorBoundary por ruta: un error de carga o de render muestra un
//         panel con Reintentar / Recargar en lugar de pantalla en blanco o
//         "Cargando módulo" infinito. Se reinicia al cambiar de ruta.
//   [FIX] Flota global ligada al usuario: al cambiar de usuario (mismo rol) se
//         limpia y se vuelve a cargar; antes se mostraba la flota del anterior.
//   [NEW] AccessDenied ofrece también "Cerrar sesión" (equipos compartidos).
//   [KEEP] NodeLoader de v5.0 preservado como alias de AuthLoader (con recuperación).
//
// CHANGELOG v7.0:
//   [FIX CRÍTICO] v5.0 declaraba su PROPIO AuthProvider/AuthContext mientras
//         Index.tsx consume useAuth() de src/context/AuthContext.tsx → dos
//         contextos → Index sin proveedor → "Sincronizando Águilas OS..." eterno.
//         Ahora existe UN solo AuthProvider (src/context/AuthContext.tsx).
//   [FIX] Rutas directas protegidas por rol, coherentes con los tabs de Index.
//         El PLANIFICADOR ya no abre /control-hub, /inventory-checkout ni
//         /flight-register escribiendo la URL.
//   [FIX] Flota global solo con sesión verificada y rol autorizado.
//   [FIX] Consulta de flota cancelable (AbortController) y canal realtime único.
//   [NEW] Estados 'error' e incidencias de permisos → AuthRecoveryPanel.
//   [NEW] Redirección a /login conserva la ruta de origen.
//
// RETIRADO DE v5.0 DELIBERADAMENTE (seguridad):
//   - normalizeRole con 'PILOTO' por defecto (rol desconocido obtenía permisos).
//   - extractRole con fallback a user_metadata (editable por el usuario).
//   - Consulta de flota antes de autenticar.
//   Ahora rol y permisos los resuelve AuthContext (roles_operativos > app_metadata).
//
// PRESERVADO (v4.8 → v7.0): AuthProvider único, ProtectedRoute con allowedRoles /
//   requirePlanner, AccessDenied, userRole/userProfile/fleet inyectados con
//   cloneElement, React.lazy + Suspense, QueryClient (retry 1, sin refetch al
//   enfocar), queryClient.clear() al cerrar sesión, mapeo estado → status /
//   matricula → tailNumber, debounce realtime 400 ms, rutas /, /control-hub,
//   /inventory-checkout, /flight-register, /planificacion, /login, *.
//   Re-export de useAuth y tipos para imports existentes desde '@/App'.
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.
// ─────────────────────────────────────────────────────────────────────────────

import React, { Suspense, cloneElement, lazy, useEffect, useRef, useState } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { AuthProvider, useAuth, PLANNER_ROLES, type UserRole } from "@/context/AuthContext";
import { AuthLoader, AuthRecoveryPanel } from "@/components/AuthRecoveryPanel";
import { BmLogo } from "@/components/brand/BmLogo"; // [v7.2] identidad B&M
import { Lock, LogOut, RefreshCw, AlertTriangle, RotateCcw, ArrowLeft } from "lucide-react"; // [v7.2] · [v7.3] ArrowLeft

import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// Re-exports de compatibilidad (v5.0 exportaba estos tipos desde App)
export { useAuth } from "@/context/AuthContext";
export type { UserRole, UserProfile, AuthStatus, AuthIssue } from "@/context/AuthContext";

// ─── CARGA DIFERIDA RESILIENTE ───────────────────────────────────────────────

const CHUNK_RELOAD_KEY = 'valkyron:chunk-reload';

/**
 * [NEW v7.1] React.lazy con recuperación ante fallo de descarga del módulo.
 * 1er fallo → reintento a los 800 ms. 2º fallo → recarga única de la página
 * (marcada en sessionStorage). Si vuelve a fallar tras recargar → el error
 * llega al ModuleErrorBoundary, que ofrece acciones al usuario.
 */
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  name: string,
) {
  const key = `${CHUNK_RELOAD_KEY}:${name}`;
  return lazy(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(key); } catch { /* almacenamiento bloqueado */ }
      return mod;
    } catch (firstError) {
      console.warn(`[MIA v7.1] Módulo ${name} no disponible, reintentando.`, firstError);
      await new Promise(resolve => setTimeout(resolve, 800));
      try {
        const mod = await factory();
        try { sessionStorage.removeItem(key); } catch { /* almacenamiento bloqueado */ }
        return mod;
      } catch (secondError) {
        let alreadyReloaded = false;
        try { alreadyReloaded = sessionStorage.getItem(key) === '1'; } catch { alreadyReloaded = true; }
        if (!alreadyReloaded) {
          try { sessionStorage.setItem(key, '1'); } catch { /* almacenamiento bloqueado */ }
          console.warn(`[MIA v7.1] Recargando para obtener la versión actual de ${name}.`);
          window.location.reload();
          return new Promise<never>(() => { /* la página se recarga */ });
        }
        throw secondError;
      }
    }
  });
}

// Módulos pesados bajo demanda (rutas con mayúsculas EXACTAS del disco)
const ControlHub = lazyWithRetry(() =>
  import("./components/ControlHub").then(m => ({ default: m.ControlHub })), 'ControlHub');
const AircraftArchive = lazyWithRetry(() => import('./components/AircraftArchive'), 'AircraftArchive');
const InventoryArchive = lazyWithRetry(() => import('./components/InventoryArchive'), 'InventoryArchive');
const InventoryCheckout = lazyWithRetry(() =>
  import("./components/InventoryCheckout").then(m => ({ default: m.InventoryCheckout })), 'InventoryCheckout');
const FlightRegister = lazyWithRetry(() => import("./components/flights/FlightRegister"), 'FlightRegister');
const FlightPlanningBoard = lazyWithRetry(() => import("./components/FlightPlanningboard"), 'FlightPlanningBoard');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// ─── MATRIZ DE ACCESO POR RUTA (coherente con los tabs de Index) ─────────────

const ROUTE_ROLES: Record<'controlHub' | 'inventoryCheckout' | 'inventoryArchive' | 'aircraftArchive' | 'flightRegister', UserRole[]> = {
  controlHub:        ['CEO', 'MECANICO', 'OPERACIONES'],
  inventoryCheckout: ['CEO', 'MECANICO', 'OPERACIONES'],
  inventoryArchive: ['CEO', 'MECANICO', 'OPERACIONES'],
  aircraftArchive: ['CEO', 'ADMIN', 'DIRECTOR', 'MECANICO', 'OPERACIONES'],
  flightRegister:    ['CEO', 'ADMIN', 'DIRECTOR', 'PILOTO', 'CAPITAN'],
};

/** Roles que usan la flota global inyectada a las rutas. El planificador consulta su propio hangar. */
const FLEET_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'MECANICO', 'OPERACIONES', 'PILOTO', 'CAPITAN'];

// ─── UI AUXILIAR ─────────────────────────────────────────────────────────────

/** [v7.2] Estilos compartidos de las pantallas de estado (acceso, error). */
const statusScreenClass =
  'bm-app min-h-[100dvh] w-full bg-muted text-foreground flex items-center justify-center px-5 py-10';
const statusCardClass =
  'w-full max-w-md rounded-[24px] border border-border bg-card p-6 sm:p-8 shadow-bm-pop';
const primaryButtonClass =
  'h-12 w-full rounded-xl bg-primary text-primary-foreground text-[15px] font-semibold ' +
  'inline-flex items-center justify-center gap-2 hover:brightness-[0.85] active:scale-[0.99] transition';
const secondaryButtonClass =
  'h-12 w-full rounded-xl border border-border bg-card text-foreground text-[15px] font-semibold ' +
  'inline-flex items-center justify-center gap-2 hover:bg-muted transition-colors ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

/** [KEEP v5.0] NodeLoader → ahora con recuperación automática si tarda (AuthLoader). */
const NodeLoader: React.FC<{ label?: string }> = ({ label = 'Sincronizando B&M' }) => (
  <AuthLoader label={label} />
);

const AccessDenied: React.FC<{ role: UserRole | null; modulo: string }> = ({ role, modulo }) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [closing, setClosing] = useState(false);

  return (
    <main className={statusScreenClass}>
      <div className={statusCardClass}>
        <BmLogo variant="compact" className="h-9 w-auto text-primary" />

        <div className="mt-8 h-12 w-12 rounded-full bg-primary-tint text-primary flex items-center justify-center">
          <Lock className="h-5 w-5" />
        </div>

        <h1 className="bm-heading mt-4 text-2xl leading-tight">Acceso restringido</h1>
        <p className="mt-1 text-[15px] font-semibold">{modulo}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Su cargo actual (<span className="font-data text-[13px] text-foreground">{role ?? 'sin rol asignado'}</span>) no
          tiene autorización para este módulo. Solicite el acceso a dirección.
        </p>

        <div className="mt-7 grid gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className={primaryButtonClass}
          >
            Volver al inicio
          </button>
          {/* [NEW v7.1] Cambio de cuenta en equipos compartidos */}
          <button
            type="button"
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              try { await signOut(); } finally { setClosing(false); }
            }}
            className={secondaryButtonClass}
          >
            <LogOut className="h-4 w-4" />
            {closing ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      </div>
    </main>
  );
};

// ─── ERROR BOUNDARY POR MÓDULO ───────────────────────────────────────────────

interface ModuleErrorBoundaryProps {
  modulo: string;
  children: React.ReactNode;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
}

/**
 * [NEW v7.1] Captura fallos de carga (chunk) o de render de un módulo.
 * Sin esto, un import() fallido deja la ruta en blanco o en Suspense eterno.
 */
class ModuleErrorBoundary extends React.Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  state: ModuleErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[MIA v7.1] Error en módulo ${this.props.modulo}:`, error.message, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunkError = /dynamically imported module|Loading chunk|Failed to fetch|importing a module script/i
      .test(error.message);

    return (
      <main className={statusScreenClass}>
        <div role="alert" className={statusCardClass}>
          <BmLogo variant="compact" className="h-9 w-auto text-primary" />

          <div
            className={`mt-8 h-12 w-12 rounded-full flex items-center justify-center ${
              isChunkError ? 'bg-warning-tint text-warning' : 'bg-primary-tint text-primary'
            }`}
          >
            {isChunkError ? <RefreshCw className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </div>

          <h1 className="bm-heading mt-4 text-2xl leading-tight">
            {isChunkError ? 'Actualización disponible' : 'Error del módulo'}
          </h1>
          <p className="mt-1 text-[15px] font-semibold">{this.props.modulo}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {isChunkError
              ? 'Se publicó una nueva versión del sistema o la conexión se interrumpió al descargar el módulo. Recargue para continuar.'
              : 'El módulo no pudo mostrarse. Puede reintentar o recargar la página. Su sesión se mantiene.'}
          </p>
          <p className="mt-4 rounded-xl bg-muted px-3 py-2.5 font-data text-xs leading-relaxed text-muted-foreground break-words">
            {error.message}
          </p>

          <div className="mt-7 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className={secondaryButtonClass}
            >
              <RotateCcw className="h-4 w-4" />
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  Object.keys(sessionStorage)
                    .filter(k => k.startsWith(CHUNK_RELOAD_KEY))
                    .forEach(k => sessionStorage.removeItem(k));
                } catch { /* almacenamiento bloqueado */ }
                window.location.reload();
              }}
              className={primaryButtonClass}
            >
              <RefreshCw className="h-4 w-4" />
              Recargar
            </button>
          </div>
        </div>
      </main>
    );
  }
}

// ─── FLOTA GLOBAL (solo con sesión y rol autorizado) ─────────────────────────

/**
 * v5.0 fetchFleetStatus + v7.0 cancelación + [v7.1] ligada al usuario.
 * Mapeo preservado: estado → status, matricula → tailNumber, modelo → model.
 */
const useGlobalFleet = (enabled: boolean, userId: string | null): any[] => {
  const [fleet, setFleet] = useState<any[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // [FIX v7.1] Nunca mostrar la flota cargada para otro usuario.
    setFleet([]);

    if (!enabled || !userId) return;

    let controller: AbortController | null = null;

    const fetchFleetStatus = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const { data, error } = await supabase
          .from('flota_aviones')
          .select('*')
          .order('matricula', { ascending: true })
          .abortSignal(current.signal);
        if (current.signal.aborted) return;
        if (error) {
          console.error('[MIA v7.1] fetchFleetStatus error:', error.message);
          return;
        }
        if (data) {
          setFleet(data.map((ac: any) => ({
            ...ac,
            tailNumber: ac.matricula,
            status: ac.estado,
            model: ac.modelo ?? ac.model ?? 'SIN MODELO',
          })));
        }
      } catch (err) {
        if (!current.signal.aborted) console.error('[MIA v7.1] fetchFleetStatus excepción:', err);
      }
    };

    void fetchFleetStatus();

    // Nombre único por montaje → sin choque con canales huérfanos
    const channel = supabase
      .channel(`global-fleet-sync-${Date.now()}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => {
          // debounce: una OT que cambia varias aeronaves = 1 recarga
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => { void fetchFleetStatus(); }, 400);
        })
      .subscribe();

    return () => {
      controller?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId]);

  return fleet;
};

// ─── PROTECTED ROUTE ─────────────────────────────────────────────────────────
// Consume el AuthProvider único (sin suscripción propia).
// allowedRoles vacío = cualquier usuario autenticado (Index resuelve "pendiente").
// requirePlanner: acceso si el rango está en allowedRoles O fn_es_planificador() = true.
// La autorización real vive en PostgreSQL (RLS + RPC); esto solo evita mostrar
// módulos que el servidor rechazaría.

// ─── [v7.3] MARCO DE RUTA DIRECTA ────────────────────────────────────────────

type RouteFrameVariant = 'bm' | 'legacy' | 'none';

const RouteFrame: React.FC<{ variant: RouteFrameVariant; modulo: string; children: React.ReactNode }> = ({ variant, modulo, children }) => {
  const navigate = useNavigate();
  if (variant === 'none') return <>{children}</>;
  if (variant === 'legacy') {
    // Módulo aún con estética Águilas: fondo oscuro propio hasta migrarlo.
    return (
      <div className="dark min-h-[100dvh] bg-[#050505] text-white">
        <div className="mx-auto max-w-7xl p-3 sm:p-6">{children}</div>
      </div>
    );
  }
  return (
    <div className="bm-app min-h-[100dvh] bg-bm-canvas text-bm-ink">
      <header className="sticky top-0 z-30 border-b border-bm-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BmLogo variant="compact" className="h-7 w-auto shrink-0 text-bm-red sm:h-8" />
            <span className="hidden h-6 w-px bg-bm-line min-[420px]:block" aria-hidden="true" />
            <span className="hidden truncate text-sm font-semibold min-[420px]:block">{modulo}</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-bm-steel transition-colors hover:bg-bm-canvas hover:text-bm-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Centro de mando
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
};

const ProtectedRoute = ({
  children,
  globalFleet,
  allowedRoles,
  requirePlanner = false,
  modulo = 'Módulo',
  frame = 'none', // [v7.3]
}: {
  children: React.ReactElement;
  globalFleet: any[];
  allowedRoles?: UserRole[];
  requirePlanner?: boolean;
  modulo?: string;
  frame?: RouteFrameVariant;
}) => {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <NodeLoader />;
  if (auth.status === 'error') return <AuthRecoveryPanel fullScreen />;
  if (auth.status === 'anonymous' || !auth.session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!auth.enriched) return <NodeLoader label="Verificando autorización" />;

  // Sesión válida pero permisos no verificables → no se concede nada.
  if (!auth.role && auth.issue && auth.issue !== 'PERMISSIONS_PENDING') {
    return <AuthRecoveryPanel fullScreen />;
  }

  const restricted = (allowedRoles && allowedRoles.length > 0) || requirePlanner;
  if (restricted) {
    const byRole = !!auth.role && !!allowedRoles?.includes(auth.role);
    const byPlanner = requirePlanner && !!auth.role && auth.canPlan;
    if (!byRole && !byPlanner) return <AccessDenied role={auth.role} modulo={modulo} />;
  }

  return (
    <ModuleErrorBoundary key={location.pathname} modulo={modulo}>
      <Suspense fallback={<NodeLoader label="Cargando módulo" />}>
        <RouteFrame variant={frame} modulo={modulo}>
          {cloneElement(children, {
            userRole:    auth.role,
            userProfile: auth.profile,
            fleet:       globalFleet,
          })}
        </RouteFrame>
      </Suspense>
    </ModuleErrorBoundary>
  );
};

// ─── RUTAS ───────────────────────────────────────────────────────────────────

const AppRoutes = () => {
  const { status, role, enriched, session } = useAuth();
  const userId = session?.user?.id ?? null;
  const fleetEnabled = status === 'authenticated' && enriched && !!role && FLEET_ROLES.includes(role);
  const globalFleet = useGlobalFleet(fleetEnabled, userId);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute globalFleet={globalFleet} modulo="Centro de Mando">
              <Index />
            </ProtectedRoute>
          }
        />
        <Route
          path="/control-hub"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.controlHub} modulo="Hangar MRO" frame="bm">
              <ControlHub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-checkout"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.inventoryCheckout} modulo="Salidas de inventario" frame="bm">
              <InventoryCheckout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/aircraft-archive"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.aircraftArchive} modulo="Archivo Histórico OMA">
              <AircraftArchive />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-archive"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.inventoryArchive} modulo="Archivo de Inventario">
              <InventoryArchive />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flight-register"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.flightRegister} modulo="Registro de vuelo" frame="bm">
              <FlightRegister />
            </ProtectedRoute>
          }
        />
        {/* Planificación de Vuelo — acceso directo por URL (también existe como tab en Index) */}
        <Route
          path="/planificacion"
          element={
            <ProtectedRoute
              globalFleet={globalFleet}
              allowedRoles={PLANNER_ROLES}
              requirePlanner
              modulo="Planificación de Vuelo"
              frame="bm"
            >
              <FlightPlanningBoard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

// ─── APP ─────────────────────────────────────────────────────────────────────

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="light" />
      <AuthProvider onSignedOut={() => queryClient.clear()}>
        <AppRoutes />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

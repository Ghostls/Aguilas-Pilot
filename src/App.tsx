// NÚCLEO DE INTELIGENCIA OPERATIVA - VALKYRON OS v7.1
// ─────────────────────────────────────────────────────────────────────────────
// FUSIÓN v5.0 + v7.0
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

const ROUTE_ROLES: Record<'controlHub' | 'inventoryCheckout' | 'flightRegister', UserRole[]> = {
  controlHub:        ['CEO', 'MECANICO', 'OPERACIONES'],
  inventoryCheckout: ['CEO', 'MECANICO', 'OPERACIONES'],
  flightRegister:    ['CEO', 'ADMIN', 'DIRECTOR', 'PILOTO', 'CAPITAN'],
};

/** Roles que usan la flota global inyectada a las rutas. El planificador consulta su propio hangar. */
const FLEET_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'MECANICO', 'OPERACIONES', 'PILOTO', 'CAPITAN'];

// ─── UI AUXILIAR ─────────────────────────────────────────────────────────────

/** [KEEP v5.0] NodeLoader → ahora con recuperación automática si tarda (AuthLoader). */
const NodeLoader: React.FC<{ label?: string }> = ({ label = 'Sincronizando Nodo Águila' }) => (
  <AuthLoader label={label} />
);

const AccessDenied: React.FC<{ role: UserRole | null; modulo: string }> = ({ role, modulo }) => {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [closing, setClosing] = useState(false);

  return (
    <div className="h-screen w-full bg-[#020202] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl border border-red-500/20 bg-red-500/[0.04] p-8 text-center">
        <p className="text-red-400 font-black text-[11px] uppercase tracking-[0.3em]">Acceso restringido</p>
        <p className="text-white font-black text-lg uppercase italic mt-3">{modulo}</p>
        <p className="text-zinc-500 text-[11px] font-mono mt-3">
          Tu rango actual ({role ?? 'SIN ROL'}) no tiene autorización para este módulo.
          Solicita el alta a Dirección.
        </p>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-6 w-full py-4 rounded-2xl bg-[#E1AD01] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all"
        >
          Volver al centro de mando
        </button>
        {/* [NEW v7.1] Cambio de cuenta en equipos compartidos */}
        <button
          type="button"
          disabled={closing}
          onClick={async () => {
            setClosing(true);
            try { await signOut(); } finally { setClosing(false); }
          }}
          className="mt-3 w-full py-3 rounded-2xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all disabled:opacity-50"
        >
          {closing ? 'Cerrando sesión...' : 'Cerrar sesión'}
        </button>
      </div>
    </div>
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
      <div className="h-screen w-full bg-[#020202] flex items-center justify-center p-6">
        <div role="alert" className="max-w-md w-full rounded-3xl border border-amber-500/25 bg-[#0a0a0a] p-8 text-center">
          <p className="text-amber-400 font-black text-[11px] uppercase tracking-[0.3em]">
            {isChunkError ? 'Actualización disponible' : 'Error del módulo'}
          </p>
          <p className="text-white font-black text-lg uppercase italic mt-3">{this.props.modulo}</p>
          <p className="text-zinc-500 text-[11px] font-mono mt-3">
            {isChunkError
              ? 'Se publicó una nueva versión de Águilas OS o la conexión se interrumpió al descargar el módulo. Recargue para continuar.'
              : 'El módulo no pudo mostrarse. Puede reintentar o recargar la página. Su sesión se mantiene.'}
          </p>
          <p className="text-zinc-700 text-[9px] font-mono mt-2 break-words">{error.message}</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="py-4 rounded-2xl border border-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-all"
            >
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
              className="py-4 rounded-2xl bg-[#E1AD01] text-black text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all"
            >
              Recargar
            </button>
          </div>
        </div>
      </div>
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

const ProtectedRoute = ({
  children,
  globalFleet,
  allowedRoles,
  requirePlanner = false,
  modulo = 'Módulo',
}: {
  children: React.ReactElement;
  globalFleet: any[];
  allowedRoles?: UserRole[];
  requirePlanner?: boolean;
  modulo?: string;
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
        {cloneElement(children, {
          userRole:    auth.role,
          userProfile: auth.profile,
          fleet:       globalFleet,
        })}
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
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.controlHub} modulo="Control Hub MRO">
              <ControlHub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory-checkout"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.inventoryCheckout} modulo="Inventario">
              <InventoryCheckout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flight-register"
          element={
            <ProtectedRoute globalFleet={globalFleet} allowedRoles={ROUTE_ROLES.flightRegister} modulo="Registro de Vuelo">
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
      <Sonner />
      <AuthProvider onSignedOut={() => queryClient.clear()}>
        <AppRoutes />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
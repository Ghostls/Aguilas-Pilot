// NÚCLEO DE INTELIGENCIA OPERATIVA - VALKYRON OS v5.0
// CHANGELOG v5.0:
//   [NEW] Ruta /planificacion → FlightPlanningBoard (Planificación de Vuelo)
//         protegida por rol: CEO/ADMIN/DIRECTOR/PLANIFICADOR o registro activo
//         en planificadores_vuelo (RPC fn_es_planificador — misma regla que la BD)
//   [NEW] AuthProvider único: UNA suscripción de auth para toda la app.
//         Antes cada ProtectedRoute abría la suya → spinner en cada cambio de ruta
//         y N listeners simultáneos de onAuthStateChange.
//   [NEW] ProtectedRoute con allowedRoles / requirePlanner + pantalla de acceso denegado
//   [NEW] userProfile (nombre_completo, sede, rol) inyectado a los módulos junto a userRole
//   [NEW] Code-splitting con React.lazy + Suspense por módulo (carga inicial más liviana)
//   [FIX] Rol: prioridad app_metadata (solo editable por servidor) sobre user_metadata
//         (editable por el propio usuario con auth.updateUser → escalada de rol en UI)
//   [FIX] TOKEN_REFRESHED ya no se ignoraba en silencio: actualiza la sesión sin
//         re-renderizar el árbol ni volver a mostrar el loader
//   [FIX] Cambio de usuario (SIGNED_IN con otro id) re-resuelve rol y perfil
//   [FIX] Normalización CAPITÁN → CAPITAN
//   [FIX] Realtime de flota con debounce (ráfagas de cambios MRO = 1 sola recarga)
//   [FIX] QueryClient: retry 1, sin refetch al enfocar ventana
// v4.8 PRESERVADO: timeout de seguridad 8s, doble mecanismo getSession +
//   onAuthStateChange(INITIAL_SESSION), finally garantizado, fetchFleetStatus con
//   try/catch, mapeo estado → status / matricula → tailNumber, globalFleet sync,
//   rutas /, /control-hub, /inventory-checkout, /flight-register, /login, *.
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.

import React, {
  Suspense, cloneElement, createContext, lazy, useCallback,
  useContext, useEffect, useRef, useState,
} from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

// [NEW v5.0] Módulos pesados bajo demanda
const ControlHub = lazy(() =>
  import("./components/ControlHub").then(m => ({ default: m.ControlHub })));
const InventoryCheckout = lazy(() =>
  import("./components/InventoryCheckout").then(m => ({ default: m.InventoryCheckout })));
const FlightRegister = lazy(() => import("./components/flights/FlightRegister"));
const FlightPlanningBoard = lazy(() => import("./components/FlightPlanningboard"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type UserRole =
  | 'CEO' | 'ADMIN' | 'DIRECTOR' | 'PILOTO' | 'MECANICO' | 'CAPITAN' | 'PLANIFICADOR';

export interface UserProfile {
  nombre_completo: string;
  sede: string;
  rol: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status:   AuthStatus;
  session:  any | null;
  role:     UserRole | null;
  profile:  UserProfile | null;
  canPlan:  boolean;
  enriched: boolean;   // perfil + permisos de planificación ya resueltos
}

const INITIAL_AUTH: AuthState = {
  status: 'loading', session: null, role: null, profile: null, canPlan: false, enriched: false,
};

/** Roles que la BD reconoce como planificadores (espejo de fn_es_planificador) */
const PLANNER_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'PLANIFICADOR'];

const AUTH_TIMEOUT_MS = 8000;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const normalizeRole = (raw: unknown): UserRole => {
  const v = String(raw ?? '')
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (v === 'PLANIFICACION' || v === 'DESPACHO' || v === 'DISPATCHER') return 'PLANIFICADOR';
  if (v === 'INSTRUCTOR') return 'CAPITAN';
  const known: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'PILOTO', 'MECANICO', 'CAPITAN', 'PLANIFICADOR'];
  return (known.includes(v as UserRole) ? v : 'PILOTO') as UserRole;
};

/** [FIX v5.0] app_metadata primero: user_metadata lo puede editar el propio usuario */
const extractRole = (sess: any): { role: UserRole; fromMetadata: boolean } => {
  const u = sess?.user;
  const raw = u?.app_metadata?.rol
    ?? u?.app_metadata?.role
    ?? u?.user_metadata?.rol
    ?? u?.user_metadata?.role;
  return { role: normalizeRole(raw), fromMetadata: raw != null };
};

// ─── AUTH CONTEXT ────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>(INITIAL_AUTH);
export const useAuth = () => useContext(AuthContext);

/**
 * [NEW v5.0] Proveedor único de sesión.
 * Conserva la lógica de resolución de v4.8 (getSession + INITIAL_SESSION + timeout 8s)
 * y agrega el enriquecimiento de perfil y permiso de planificación.
 */
const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH);
  const userIdRef   = useRef<string | null>(null);
  const resolvedRef = useRef(false);

  /** Carga perfil y permiso de planificación sin bloquear el acceso general */
  const enrich = useCallback(async (sess: any, baseRole: UserRole, fromMetadata: boolean) => {
    const user = sess.user;
    let profile: UserProfile = {
      nombre_completo: user?.user_metadata?.nombre_completo
        ?? user?.user_metadata?.full_name
        ?? user?.email
        ?? 'OPERADOR',
      sede: user?.user_metadata?.sede ?? '',
      rol:  baseRole,
    };
    let role = baseRole;
    let canPlan = PLANNER_ROLES.includes(baseRole);

    try {
      const { data: perfil } = await supabase
        .from('perfiles_estudiantes')
        .select('nombre_completo, sede, role')
        .eq('id', user.id)
        .maybeSingle();
      if (perfil) {
        profile = {
          nombre_completo: perfil.nombre_completo || profile.nombre_completo,
          sede:            perfil.sede || profile.sede,
          rol:             profile.rol,
        };
        // Sin rol en metadata → se usa el rol registrado en BD
        if (!fromMetadata && perfil.role) {
          role = normalizeRole(perfil.role);
          profile.rol = role;
        }
      }
    } catch (err) {
      console.warn('[MIA v5.0] Perfil no disponible:', err);
    }

    try {
      const { data: esPlan, error } = await supabase.rpc('fn_es_planificador');
      if (!error) canPlan = !!esPlan;
    } catch (err) {
      console.warn('[MIA v5.0] fn_es_planificador no disponible:', err);
    }

    if (userIdRef.current !== user.id) return;   // la sesión cambió mientras cargaba
    setAuth(prev => ({ ...prev, role, profile, canPlan, enriched: true }));
  }, []);

  const resolveSession = useCallback((sess: any) => {
    const newUserId = sess?.user?.id ?? null;

    // [FIX v5.0] Mismo usuario ya resuelto (p. ej. TOKEN_REFRESHED): solo refresca la sesión
    if (resolvedRef.current && newUserId && newUserId === userIdRef.current) {
      setAuth(prev => ({ ...prev, session: sess }));
      return;
    }

    resolvedRef.current = true;
    userIdRef.current = newUserId;

    if (sess) {
      const { role, fromMetadata } = extractRole(sess);
      console.log('[MIA v5.0] Acceso concedido — rango:', role);
      setAuth({
        status: 'authenticated', session: sess, role,
        profile: null, canPlan: PLANNER_ROLES.includes(role), enriched: false,
      });
      enrich(sess, role, fromMetadata);
    } else {
      setAuth({ ...INITIAL_AUTH, status: 'anonymous', enriched: true });
    }
  }, [enrich]);

  useEffect(() => {
    // Timeout de seguridad: 8s máximo — si Supabase no responde, fuerza resolución
    const safetyTimer = setTimeout(() => {
      if (!resolvedRef.current) {
        console.warn('[MIA v5.0] Timeout de auth — forzando resolución sin sesión');
        resolveSession(null);
      }
    }, AUTH_TIMEOUT_MS);

    // Mecanismo 1: getSession() directo
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        resolveSession(session);
      })
      .catch((err) => {
        console.error('[MIA v5.0] getSession error:', err);
        resolveSession(null);
      })
      .finally(() => {
        clearTimeout(safetyTimer);
      });

    // Mecanismo 2: onAuthStateChange — INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      console.log('[MIA v5.0] Auth event:', event);

      if (event === 'SIGNED_OUT') {
        resolvedRef.current = false;
        userIdRef.current = null;
        setAuth({ ...INITIAL_AUTH, status: 'anonymous', enriched: true });
        queryClient.clear();
        return;
      }

      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        resolveSession(sess);
        clearTimeout(safetyTimer);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
    };
  }, [resolveSession]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

// ─── UI AUXILIAR ─────────────────────────────────────────────────────────────

const NodeLoader: React.FC<{ label?: string }> = ({ label = 'Sincronizando Nodo Águila' }) => (
  <div className="h-screen w-full bg-[#020202] flex flex-col items-center justify-center gap-6 text-left">
    <div className="h-16 w-16 border-t-2 border-[#E1AD01] rounded-full animate-spin" />
    <span className="text-[#E1AD01] font-black text-[10px] tracking-[0.5em] uppercase italic animate-pulse">
      {label}
    </span>
  </div>
);

const AccessDenied: React.FC<{ role: UserRole | null; modulo: string }> = ({ role, modulo }) => {
  const navigate = useNavigate();
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
      </div>
    </div>
  );
};

// ─── PROTECTED ROUTE v5.0 ────────────────────────────────────────────────────
// Consume el AuthProvider (sin suscripción propia).
// allowedRoles:   restringe por rango (vacío = cualquier usuario autenticado, igual que v4.8)
// requirePlanner: acceso si el rango está en allowedRoles O fn_es_planificador() = true
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

  if (auth.status === 'loading') return <NodeLoader />;
  if (auth.status === 'anonymous' || !auth.session) return <Navigate to="/login" replace />;

  const restricted = (allowedRoles && allowedRoles.length > 0) || requirePlanner;
  if (restricted) {
    const byRole = !!auth.role && !!allowedRoles?.includes(auth.role);
    if (!byRole) {
      if (requirePlanner && !auth.enriched) return <NodeLoader label="Verificando autorización" />;
      if (!(requirePlanner && auth.canPlan)) return <AccessDenied role={auth.role} modulo={modulo} />;
    }
  }

  return (
    <Suspense fallback={<NodeLoader label="Cargando módulo" />}>
      {cloneElement(children, {
        userRole:    auth.role,
        userProfile: auth.profile,
        fleet:       globalFleet,
      })}
    </Suspense>
  );
};

// ─── APP ─────────────────────────────────────────────────────────────────────

const App = () => {
  const [globalFleet, setGlobalFleet] = useState<any[]>([]);
  const fleetDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFleetStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('flota_aviones')
        .select('*')
        .order('matricula', { ascending: true });

      if (error) {
        console.error('[MIA v5.0] fetchFleetStatus error:', error.message);
        return;
      }
      if (data) {
        const mappedFleet = data.map(ac => ({
          ...ac,
          tailNumber: ac.matricula,
          status: ac.estado,
          model: ac.modelo ?? ac.model ?? 'SIN MODELO',
        }));
        setGlobalFleet(mappedFleet);
      }
    } catch (err) {
      console.error('[MIA v5.0] fetchFleetStatus excepción:', err);
    }
  }, []);

  useEffect(() => {
    fetchFleetStatus();

    const fleetChannel = supabase
      .channel('global-fleet-sync')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => {
          // [FIX v5.0] debounce: una OT que cambia varias aeronaves = 1 recarga
          if (fleetDebounce.current) clearTimeout(fleetDebounce.current);
          fleetDebounce.current = setTimeout(() => fetchFleetStatus(), 400);
        }
      )
      .subscribe();

    return () => {
      if (fleetDebounce.current) clearTimeout(fleetDebounce.current);
      supabase.removeChannel(fleetChannel);
    };
  }, [fetchFleetStatus]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
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
                  <ProtectedRoute globalFleet={globalFleet} modulo="Control Hub MRO">
                    <ControlHub />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/inventory-checkout"
                element={
                  <ProtectedRoute globalFleet={globalFleet} modulo="Inventario">
                    <InventoryCheckout />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/flight-register"
                element={
                  <ProtectedRoute globalFleet={globalFleet} modulo="Registro de Vuelo">
                    <FlightRegister />
                  </ProtectedRoute>
                }
              />
              {/* [NEW v5.0] Planificación de Vuelo */}
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
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
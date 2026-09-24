// src/context/AuthContext.tsx
// VALKYRON OS v7.1 — AUTENTICACIÓN RESILIENTE Y ROLES OPERATIVOS
// FUSIÓN v6.1 + v7.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.1 (sobre v7.0):
//   [NEW] Re-verificación de permisos al volver a la pestaña (visibilitychange):
//         cada ≥5 min con rol, cada ≥30 s en ACCESO PENDIENTE. Un rol revocado o
//         desactivado por administración deja de tener efecto sin recargar; un
//         rol recién asignado habilita el acceso sin recargar.
//   [NEW] Incidencia ACCOUNT_DISABLED: fila de roles_operativos con activo=false
//         (antes se confundía con "acceso pendiente").
//   [FIX] userSignOutRef se restablece en SIGNED_IN: si un cierre terminó por la
//         vía de respaldo (sin evento SIGNED_OUT), una expiración posterior ya
//         vuelve a mostrar "Su sesión expiró".
//   [KEEP v6.1] extractServerRole() restaurada como única lectura de app_metadata.
//   [KEEP v6.1] Precedencia de presentación: roles_operativos > perfiles_estudiantes
//         > user_metadata > email. perfiles_estudiantes nunca modifica el rol.
//   [KEEP v6.1] Exportaciones públicas: UserRole, UserProfile, AuthStatus,
//         AuthState, INITIAL_AUTH, PLANNER_ROLES, normalizeRole, useAuth,
//         AuthProvider (props children + onSignedOut).
//   [CHG v6.1] AUTH_TIMEOUT_MS (8 s → anónimo) sustituido por INIT_TIMEOUT_MS
//         (12 s → estado 'error' recuperable, sin expulsar sesiones válidas).
//
// CHANGELOG v7.0 (sobre v6.1):
//   [FIX CRÍTICO] enrich() hacía 3 consultas en SERIE y SIN límite de tiempo.
//         Si cualquiera quedaba esperando (bloqueo de sesión, refresh colgado,
//         red lenta) → enriched=false para siempre → "Sincronizando Águilas OS...".
//         Ahora: consultas en PARALELO, cancelación real con AbortController
//         (.abortSignal) y límite de 9 s. Siempre termina con un estado explícito.
//   [FIX] Las consultas ya no se lanzan dentro del callback de onAuthStateChange
//         (retiene el bloqueo del cliente). Todo evento se difiere con setTimeout(0).
//   [FIX] El timeout de arranque ya NO convierte la situación en "anónimo" (que
//         enviaba al login con una sesión válida guardada). Ahora produce un estado
//         'error' diagnosticado y recuperable; si la sesión llega después, se aplica.
//   [FIX] Sesión guardada + fallo de red ≠ sesión ausente: se muestra NETWORK /
//         OFFLINE con Reintentar, sin cerrar la sesión.
//   [NEW] status 'error' + issue: INIT_TIMEOUT · OFFLINE · NETWORK · SESSION_EXPIRED
//         · SESSION_INVALID · STORAGE_CORRUPT · PERMISSIONS_PENDING · PERMISSIONS_UNAVAILABLE
//   [NEW] Acciones: retry() · signOut() (global con respaldo local) ·
//         repairDevice() (borra SOLO la sesión de este proyecto) · getDiagnostics()
//   [NEW] Reintento automático al recuperar conexión (evento 'online').
//   [NEW] roleSource: roles_operativos | app_metadata | planificadores_vuelo
//   [NEW] useAuth() fuera del AuthProvider devuelve un error visible en vez de
//         'loading' eterno (causa confirmada del bloqueo con App.tsx v5.0).
//
// POLÍTICA DE ROLES (fail-closed)
//   1. roles_operativos (fila del usuario) — fuente prioritaria. Si existe fila,
//      manda aunque el rol sea desconocido (→ pendiente) o esté inactivo.
//   2. app_metadata.rol — solo si NO hay fila o la tabla no existe/no es legible.
//   3. planificadores_vuelo (vía fn_es_planificador) — solo si 1 y 2 no dan rol.
//   user_metadata: SOLO presentación (nombre, sede). Nunca concede privilegios.
//   Si roles_operativos no responde (red/tiempo) → NO se usa app_metadata como
//   sustituto (podría elevar a alguien degradado): PERMISSIONS_UNAVAILABLE.
//
// La autorización definitiva la aplican RLS y funciones SECURITY DEFINER.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  supabase,
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_STORAGE_PREFIX,
} from '@/lib/supabaseClient';
import {
  authLog,
  classifyPostgrestError,
  clearProjectAuthStorage,
  getAuthDiagnostics,
  isOffline,
  listAuthStorageKeys,
  promiseWithTimeout,
  shortId,
} from '@/lib/authRecovery';

// ─────────────────────────────────────────────────────────────
// 1. TIPOS
// ─────────────────────────────────────────────────────────────

export type UserRole =
  | 'CEO'
  | 'ADMIN'
  | 'DIRECTOR'
  | 'PILOTO'
  | 'MECANICO'
  | 'CAPITAN'
  | 'PLANIFICADOR'
  | 'OPERACIONES';

export interface UserProfile {
  nombre_completo: string;
  sede: string;
  rol: string;
}

export type AuthStatus =
  | 'loading'
  | 'authenticated'
  | 'anonymous'
  | 'error';

export type AuthIssue =
  | 'INIT_TIMEOUT'
  | 'OFFLINE'
  | 'NETWORK'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'STORAGE_CORRUPT'
  | 'PERMISSIONS_PENDING'
  | 'PERMISSIONS_UNAVAILABLE'
  | 'ACCOUNT_DISABLED';

export type RoleSource =
  | 'roles_operativos'
  | 'app_metadata'
  | 'planificadores_vuelo'
  | null;

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  role: UserRole | null;
  profile: UserProfile | null;
  canPlan: boolean;
  enriched: boolean;
  issue: AuthIssue | null;
  roleSource: RoleSource;
  lastError: string | null;
}

export interface AuthContextValue extends AuthState {
  /** Reintenta resolver la sesión o los permisos sin cerrar la sesión. */
  retry: () => void;
  /** Cierre de sesión controlado: global, con respaldo local si no hay red. */
  signOut: () => Promise<void>;
  /** Reparación destructiva: borra la sesión de ESTE proyecto en este navegador. */
  repairDevice: () => Promise<void>;
  /** Texto de diagnóstico sin datos sensibles. */
  getDiagnostics: () => string;
}

export const INITIAL_AUTH: AuthState = {
  status: 'loading',
  session: null,
  role: null,
  profile: null,
  canPlan: false,
  enriched: false,
  issue: null,
  roleSource: null,
  lastError: null,
};

// Roles con acceso previsto a planificación (espejo de fn_es_planificador).
export const PLANNER_ROLES: UserRole[] = [
  'CEO',
  'ADMIN',
  'DIRECTOR',
  'PLANIFICADOR',
];

export const ISSUE_MESSAGES: Record<AuthIssue, { title: string; detail: string }> = {
  INIT_TIMEOUT: {
    title: 'No se pudo recuperar la sesión guardada',
    detail: 'El navegador no respondió a tiempo al leer la sesión de este equipo. Suele ocurrir si otra pestaña de Águilas OS quedó bloqueada o la conexión es inestable. Reintente; si persiste, repare la sesión del dispositivo.',
  },
  OFFLINE: {
    title: 'Sin conexión a internet',
    detail: 'Su sesión sigue guardada en este equipo. Al recuperar la conexión el sistema reintentará automáticamente.',
  },
  NETWORK: {
    title: 'No se pudo contactar con el servidor',
    detail: 'Hay una sesión guardada en este equipo pero el servidor no respondió. No se cerró su sesión. Reintente en unos segundos.',
  },
  SESSION_EXPIRED: {
    title: 'Su sesión expiró',
    detail: 'Por seguridad debe iniciar sesión nuevamente.',
  },
  SESSION_INVALID: {
    title: 'La sesión de este equipo no es válida',
    detail: 'El servidor rechazó las credenciales guardadas. Cierre sesión e ingrese de nuevo, o repare la sesión del dispositivo.',
  },
  STORAGE_CORRUPT: {
    title: 'Sesión guardada dañada',
    detail: 'La información de sesión almacenada en este navegador no se pudo leer. Repare la sesión del dispositivo e inicie sesión otra vez.',
  },
  PERMISSIONS_PENDING: {
    title: 'Acceso pendiente',
    detail: 'Su cuenta es válida pero aún no tiene un rol operativo asignado. Administración debe asignarlo.',
  },
  PERMISSIONS_UNAVAILABLE: {
    title: 'No se pudieron verificar sus permisos',
    detail: 'La sesión es válida, pero el servidor de permisos no respondió. Por seguridad no se concede acceso hasta verificarlo. Reintente.',
  },
  ACCOUNT_DISABLED: {
    title: 'Cuenta operativa desactivada',
    detail: 'Administración desactivó el acceso operativo de esta cuenta. Si considera que es un error, contacte a Dirección.',
  },
};

// ─────────────────────────────────────────────────────────────
// 2. PARÁMETROS
// ─────────────────────────────────────────────────────────────

const INIT_TIMEOUT_MS = 12000;     // resolución de la sesión guardada
const ENRICH_TIMEOUT_MS = 9000;    // perfil + roles + planificación
const SIGNOUT_TIMEOUT_MS = 6000;
const REVERIFY_WITH_ROLE_MS = 5 * 60 * 1000;   // re-verificación silenciosa con rol
const REVERIFY_PENDING_MS = 30 * 1000;         // re-verificación en acceso pendiente

// ─────────────────────────────────────────────────────────────
// 3. NORMALIZACIÓN DE ROLES
// ─────────────────────────────────────────────────────────────

export const normalizeRole = (raw: unknown): UserRole | null => {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (
    [
      'PLANIFICADOR',
      'PLANIFICADOR_VUELO',
      'PLANIFICADOR_DE_VUELO',
      'PLANIFICACION',
      'DESPACHO',
      'DISPATCHER',
    ].includes(value)
  ) {
    return 'PLANIFICADOR';
  }

  if (value === 'INSTRUCTOR') return 'CAPITAN';

  const known: UserRole[] = [
    'CEO',
    'ADMIN',
    'DIRECTOR',
    'PILOTO',
    'MECANICO',
    'CAPITAN',
    'PLANIFICADOR',
    'OPERACIONES',
  ];

  return known.includes(value as UserRole) ? (value as UserRole) : null;
};

// [KEEP v6.1] app_metadata es administrado desde el servidor.
// user_metadata no se utiliza para asignar permisos.
const extractServerRole = (session: Session): UserRole | null => {
  const user = session.user;
  return normalizeRole(user.app_metadata?.rol ?? user.app_metadata?.role);
};

const displayName = (session: Session): string => {
  const meta = session.user.user_metadata ?? {};
  return String(meta.nombre_completo ?? meta.full_name ?? session.user.email ?? 'OPERADOR');
};

const hasStoredSession = (): boolean => {
  try {
    return window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
};

const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err ?? 'Error desconocido');

// ─────────────────────────────────────────────────────────────
// 4. CONTEXTO
// ─────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

const MISSING_PROVIDER: AuthContextValue = {
  ...INITIAL_AUTH,
  status: 'error',
  enriched: true,
  issue: 'INIT_TIMEOUT',
  lastError: 'AuthProvider no encontrado: el componente no está dentro de <AuthProvider> de src/context/AuthContext.tsx.',
  retry: () => window.location.reload(),
  signOut: async () => { await supabase.auth.signOut({ scope: 'local' }); },
  repairDevice: async () => {
    clearProjectAuthStorage(SUPABASE_STORAGE_PREFIX);
    window.location.replace('/login?reparado=1');
  },
  getDiagnostics: () => getAuthDiagnostics(SUPABASE_STORAGE_PREFIX, { provider: 'AUSENTE' }),
};

let missingProviderWarned = false;

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    if (!missingProviderWarned) {
      missingProviderWarned = true;
      authLog('contexto:provider-ausente', {}, 'error');
    }
    return MISSING_PROVIDER;
  }
  return ctx;
};

// ─────────────────────────────────────────────────────────────
// 5. PROVIDER
// ─────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode;
  onSignedOut?: () => void;
}

interface ApplyOptions {
  reason: string;
  force?: boolean;
  expired?: boolean;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onSignedOut }) => {
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH);

  const authRef = useRef<AuthState>(auth);
  authRef.current = auth;

  const aliveRef = useRef(true);
  const generationRef = useRef(0);             // invalida trabajo de sesiones anteriores
  const userIdRef = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const resolvedRef = useRef(false);           // sesión inicial resuelta
  const userSignOutRef = useRef(false);        // cierre iniciado por el usuario
  const controllersRef = useRef(new Set<AbortController>());
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVerifiedRef = useRef(0);            // [v7.1] última verificación de permisos

  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;

  // ── utilidades de ciclo de vida ────────────────────────────────────────────

  const abortPending = useCallback(() => {
    controllersRef.current.forEach(c => c.abort());
    controllersRef.current.clear();
  }, []);

  const schedule = useCallback((fn: () => void, ms = 0) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (aliveRef.current) fn();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const clearInitTimer = useCallback(() => {
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
  }, []);

  // ───────────────────────────────────────────────────────────
  // 5.1 RESOLVER ROL, PERFIL Y PERMISO DE PLANIFICACIÓN
  // ───────────────────────────────────────────────────────────

  const enrich = useCallback(async (
    session: Session,
    generation: number,
    silent: boolean,
  ): Promise<void> => {
    const user = session.user;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const timer = setTimeout(() => controller.abort(), ENRICH_TIMEOUT_MS);
    const started = Date.now();

    const isStale = () =>
      !aliveRef.current ||
      generation !== generationRef.current ||
      userIdRef.current !== user.id;

    authLog('permisos:inicio', { usuario: shortId(user.id), generacion: generation, silencioso: silent });

    try {
      const [rolesRes, perfilRes, planRes] = await Promise.allSettled([
        supabase
          .from('roles_operativos')
          .select('*')
          .eq('user_id', user.id)
          .abortSignal(controller.signal)
          .maybeSingle(),
        supabase
          .from('perfiles_estudiantes')
          .select('nombre_completo, sede')
          .eq('id', user.id)
          .abortSignal(controller.signal)
          .maybeSingle(),
        supabase
          .rpc('fn_es_planificador')
          .abortSignal(controller.signal),
      ]);

      if (isStale()) {
        authLog('permisos:descartado-obsoleto', { generacion: generation });
        return;
      }

      // ── Presentación (nunca privilegios) ────────────────────────────────
      let nombre = displayName(session);
      let sede = String(user.user_metadata?.sede ?? '');

      if (perfilRes.status === 'fulfilled' && !perfilRes.value.error && perfilRes.value.data) {
        const p = perfilRes.value.data as { nombre_completo?: string | null; sede?: string | null };
        nombre = p.nombre_completo || nombre;
        sede = p.sede || sede;
      }

      // ── Fuente 1: roles_operativos ──────────────────────────────────────
      type RolesKind = 'ROW' | 'NONE' | 'FALLBACK' | 'SESSION' | 'UNREACHABLE';
      let rolesKind: RolesKind;
      let lastError: string | null = null;
      let row: Record<string, unknown> | null = null;

      if (rolesRes.status === 'rejected') {
        rolesKind = 'UNREACHABLE';
        lastError = errorText(rolesRes.reason);
      } else {
        const { data, error, status } = rolesRes.value;
        const cls = classifyPostgrestError(error, status);
        if (cls === 'NONE') {
          rolesKind = data ? 'ROW' : 'NONE';
          row = (data as Record<string, unknown> | null) ?? null;
        } else if (cls === 'ABSENT' || cls === 'DENIED') {
          rolesKind = 'FALLBACK';
        } else if (cls === 'SESSION') {
          rolesKind = 'SESSION';
        } else {
          rolesKind = 'UNREACHABLE';
        }
        if (error) {
          lastError = controller.signal.aborted
            ? 'Tiempo de espera agotado al verificar permisos.'
            : error.message;
          authLog('permisos:roles_operativos', { clase: cls, codigo: error.code ?? '', http: status }, 'warn');
        }
      }

      // ── Fuente 3: planificadores_vuelo vía RPC (no concede si falla) ────
      let rpcCanPlan = false;
      if (planRes.status === 'fulfilled') {
        if (planRes.value.error) {
          authLog('permisos:fn_es_planificador', {
            clase: classifyPostgrestError(planRes.value.error, planRes.value.status),
            codigo: planRes.value.error.code ?? '',
          }, 'warn');
        } else {
          rpcCanPlan = planRes.value.data === true;
        }
      }

      // ── Decisión de rol (fail-closed) ───────────────────────────────────
      const metaRole = extractServerRole(session);
      let role: UserRole | null = null;
      let roleSource: RoleSource = null;
      let issue: AuthIssue | null = null;

      if (rolesKind === 'ROW' && row) {
        roleSource = 'roles_operativos';
        if (row.activo === false) {
          role = null;
          issue = 'ACCOUNT_DISABLED';
        } else {
          role = normalizeRole(row.rol);
        }
        if (typeof row.nombre_completo === 'string' && row.nombre_completo) nombre = row.nombre_completo;
        if (typeof row.sede === 'string' && row.sede) sede = row.sede;
      } else if (rolesKind === 'NONE' || rolesKind === 'FALLBACK') {
        if (metaRole) {
          role = metaRole;
          roleSource = 'app_metadata';
        } else if (rpcCanPlan) {
          role = 'PLANIFICADOR';
          roleSource = 'planificadores_vuelo';
        }
      } else if (rolesKind === 'SESSION') {
        issue = 'SESSION_INVALID';
      } else {
        issue = isOffline() ? 'OFFLINE' : 'PERMISSIONS_UNAVAILABLE';
      }

      if (!issue && !role) issue = 'PERMISSIONS_PENDING';

      const canPlan = role !== null && (PLANNER_ROLES.includes(role) || rpcCanPlan);

      // Re-verificación silenciosa del mismo usuario: una caída temporal de red
      // no retira los permisos ya verificados en esta sesión.
      if (
        silent &&
        (issue === 'PERMISSIONS_UNAVAILABLE' || issue === 'OFFLINE') &&
        authRef.current.role
      ) {
        authLog('permisos:reverificacion-fallida-se-conserva', { motivo: issue }, 'warn');
        setAuth(prev => ({ ...prev, lastError }));
        return;
      }

      lastVerifiedRef.current = Date.now();

      authLog('permisos:resuelto', {
        rol: role ?? 'NINGUNO',
        fuente: roleSource ?? 'NINGUNA',
        planificacion: canPlan,
        incidencia: issue ?? 'NINGUNA',
        ms: Date.now() - started,
      }, issue && issue !== 'PERMISSIONS_PENDING' ? 'warn' : 'info');

      setAuth(prev => ({
        ...prev,
        status: 'authenticated',
        session: sessionRef.current ?? session,
        role,
        profile: { nombre_completo: nombre, sede, rol: role ?? 'SIN ASIGNAR' },
        canPlan,
        enriched: true,
        issue,
        roleSource,
        lastError,
      }));
    } catch (err) {
      if (isStale()) return;
      const lastError = errorText(err);
      authLog('permisos:error', { error: lastError }, 'error');
      if (silent && authRef.current.role) {
        setAuth(prev => ({ ...prev, lastError }));
        return;
      }
      setAuth(prev => ({
        ...prev,
        role: null,
        canPlan: false,
        enriched: true,
        issue: isOffline() ? 'OFFLINE' : 'PERMISSIONS_UNAVAILABLE',
        roleSource: null,
        lastError,
      }));
    } finally {
      clearTimeout(timer);
      controllersRef.current.delete(controller);
    }
  }, []);

  // ───────────────────────────────────────────────────────────
  // 5.2 APLICAR SESIÓN (idempotente)
  // ───────────────────────────────────────────────────────────

  const applySession = useCallback((session: Session | null, opts: ApplyOptions) => {
    const newUserId = session?.user?.id ?? null;
    sessionRef.current = session;

    // Mismo usuario ya resuelto (TOKEN_REFRESHED, SIGNED_IN al volver a la
    // pestaña, INITIAL_SESSION duplicado): solo se actualiza el objeto sesión.
    if (!opts.force && resolvedRef.current && newUserId && newUserId === userIdRef.current) {
      setAuth(prev => (prev.session === session ? prev : { ...prev, session }));
      return;
    }

    const sameUser = resolvedRef.current && newUserId !== null && newUserId === userIdRef.current;

    generationRef.current += 1;
    const generation = generationRef.current;
    abortPending();
    clearInitTimer();

    resolvedRef.current = true;
    userIdRef.current = newUserId;

    authLog('sesion:aplicada', {
      motivo: opts.reason,
      usuario: shortId(newUserId),
      generacion: generation,
    });

    if (!session || !newUserId) {
      setAuth({
        ...INITIAL_AUTH,
        status: 'anonymous',
        enriched: true,
        issue: opts.expired ? 'SESSION_EXPIRED' : null,
      });
      return;
    }

    if (sameUser && opts.force) {
      // USER_UPDATED: se re-verifican permisos sin ocultar la interfaz.
      setAuth(prev => ({ ...prev, session }));
      schedule(() => { void enrich(session, generation, true); });
      return;
    }

    // Nuevo usuario o primera resolución: sin permisos hasta verificar.
    setAuth({
      ...INITIAL_AUTH,
      status: 'authenticated',
      session,
      enriched: false,
    });
    schedule(() => { void enrich(session, generation, false); });
  }, [abortPending, clearInitTimer, enrich, schedule]);

  /** Sesión nula: distingue "no hay sesión" de "hay sesión guardada pero falló la red". */
  const resolveNullSession = useCallback((reason: string) => {
    if (hasStoredSession()) {
      const offline = isOffline();
      authLog('sesion:guardada-no-validada', { motivo: reason, sinConexion: offline }, 'warn');
      setAuth({
        ...INITIAL_AUTH,
        status: 'error',
        enriched: true,
        issue: offline ? 'OFFLINE' : 'NETWORK',
        lastError: 'Existe una sesión guardada que no se pudo validar con el servidor.',
      });
      return; // resolvedRef sigue en false: un evento posterior podrá resolver.
    }
    applySession(null, { reason });
  }, [applySession]);

  // ───────────────────────────────────────────────────────────
  // 5.3 ARRANQUE (getSession + límite de tiempo)
  // ───────────────────────────────────────────────────────────

  const startBootstrap = useCallback(() => {
    clearInitTimer();
    const started = Date.now();

    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null;
      if (!aliveRef.current || resolvedRef.current) return;
      const offline = isOffline();
      authLog('arranque:tiempo-agotado', {
        sinConexion: offline,
        clavesSesion: listAuthStorageKeys(SUPABASE_STORAGE_PREFIX).length,
      }, 'warn');
      setAuth({
        ...INITIAL_AUTH,
        status: 'error',
        enriched: true,
        issue: offline ? 'OFFLINE' : 'INIT_TIMEOUT',
        lastError: 'La sesión guardada no se resolvió en el tiempo esperado.',
      });
    }, INIT_TIMEOUT_MS);

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!aliveRef.current) return;
        authLog('arranque:getSession', {
          ms: Date.now() - started,
          conSesion: !!data.session,
          error: error ? error.name : null,
        }, error ? 'warn' : 'info');
        if (resolvedRef.current) return;

        if (error) {
          const retryable = error.name === 'AuthRetryableFetchError' || error.status === 0;
          if (retryable) {
            clearInitTimer();
            setAuth({
              ...INITIAL_AUTH,
              status: 'error',
              enriched: true,
              issue: isOffline() ? 'OFFLINE' : 'NETWORK',
              lastError: error.message,
            });
            return;
          }
          if (!hasStoredSession()) {
            applySession(null, { reason: 'getSession:error-sin-sesion', expired: true });
            return;
          }
          clearInitTimer();
          setAuth({
            ...INITIAL_AUTH,
            status: 'error',
            enriched: true,
            issue: 'STORAGE_CORRUPT',
            lastError: error.message,
          });
          return;
        }

        if (data.session) applySession(data.session, { reason: 'getSession' });
        else resolveNullSession('getSession');
      })
      .catch(err => {
        if (!aliveRef.current || resolvedRef.current) return;
        clearInitTimer();
        authLog('arranque:excepcion', { error: errorText(err) }, 'error');
        setAuth({
          ...INITIAL_AUTH,
          status: 'error',
          enriched: true,
          issue: hasStoredSession() ? 'STORAGE_CORRUPT' : 'INIT_TIMEOUT',
          lastError: errorText(err),
        });
      });
  }, [applySession, clearInitTimer, resolveNullSession]);

  // ───────────────────────────────────────────────────────────
  // 5.4 ACCIONES DE RECUPERACIÓN
  // ───────────────────────────────────────────────────────────

  const retry = useCallback(() => {
    authLog('accion:reintentar', { estado: authRef.current.status, incidencia: authRef.current.issue });
    const session = sessionRef.current;

    if (resolvedRef.current && session) {
      generationRef.current += 1;
      const generation = generationRef.current;
      abortPending();
      setAuth(prev => ({ ...prev, enriched: false, issue: null, lastError: null }));
      schedule(() => { void enrich(session, generation, false); });
      return;
    }

    resolvedRef.current = false;
    userIdRef.current = null;
    setAuth({ ...INITIAL_AUTH });
    startBootstrap();
  }, [abortPending, enrich, schedule, startBootstrap]);

  const signOut = useCallback(async () => {
    userSignOutRef.current = true;
    authLog('accion:cerrar-sesion', {});
    abortPending();
    try {
      const { error } = await promiseWithTimeout(supabase.auth.signOut(), SIGNOUT_TIMEOUT_MS, 'Cierre de sesión');
      if (error) throw error;
    } catch (err) {
      // Sin red el cierre global no puede revocar el token en el servidor.
      // Se cierra localmente para no dejar la sesión activa en el equipo.
      authLog('cerrar-sesion:global-fallido', { error: errorText(err) }, 'warn');
      try {
        await promiseWithTimeout(supabase.auth.signOut({ scope: 'local' }), 3000, 'Cierre local');
      } catch {
        clearProjectAuthStorage(SUPABASE_STORAGE_PREFIX);
      }
    }
    generationRef.current += 1;
    clearInitTimer();
    resolvedRef.current = true;
    userIdRef.current = null;
    sessionRef.current = null;
    setAuth({ ...INITIAL_AUTH, status: 'anonymous', enriched: true });
    signedOutRef.current?.();
  }, [abortPending, clearInitTimer]);

  const repairDevice = useCallback(async () => {
    authLog('accion:reparar-dispositivo', {
      clavesSesion: listAuthStorageKeys(SUPABASE_STORAGE_PREFIX).length,
    }, 'warn');
    userSignOutRef.current = true;
    abortPending();
    clearInitTimer();
    try {
      await promiseWithTimeout(supabase.auth.signOut({ scope: 'local' }), 3000, 'Reparación');
    } catch {
      /* se limpia el almacenamiento igualmente */
    }
    const removed = clearProjectAuthStorage(SUPABASE_STORAGE_PREFIX);
    authLog('reparacion:completada', { clavesEliminadas: removed });
    signedOutRef.current?.();
    window.location.replace('/login?reparado=1');
  }, [abortPending, clearInitTimer]);

  const getDiagnostics = useCallback(() => {
    const a = authRef.current;
    return getAuthDiagnostics(SUPABASE_STORAGE_PREFIX, {
      estado: a.status,
      incidencia: a.issue ?? 'ninguna',
      rol: a.role ?? 'ninguno',
      fuenteRol: a.roleSource ?? 'ninguna',
      permisosVerificados: a.enriched,
      planificacion: a.canPlan,
      usuario: shortId(a.session?.user?.id),
      ultimoError: a.lastError ?? 'ninguno',
    });
  }, []);

  // ───────────────────────────────────────────────────────────
  // 5.5 CICLO DE VIDA
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;

    const handleAuthEvent = (event: AuthChangeEvent, session: Session | null) => {
      switch (event) {
        case 'INITIAL_SESSION': {
          if (!resolvedRef.current) {
            if (session) applySession(session, { reason: 'INITIAL_SESSION' });
            else resolveNullSession('INITIAL_SESSION');
          } else if (session && session.user.id === userIdRef.current) {
            applySession(session, { reason: 'INITIAL_SESSION' });
          }
          break;
        }
        case 'SIGNED_IN': {
          // [v7.1] Un inicio de sesión cierra cualquier cierre pendiente de confirmar.
          userSignOutRef.current = false;
          if (session) applySession(session, { reason: 'SIGNED_IN' });
          break;
        }
        case 'TOKEN_REFRESHED': {
          if (session) applySession(session, { reason: 'TOKEN_REFRESHED' });
          break;
        }
        case 'USER_UPDATED': {
          if (session) applySession(session, { reason: 'USER_UPDATED', force: true });
          break;
        }
        case 'SIGNED_OUT': {
          // Si no lo pidió el usuario, la sesión expiró o fue revocada.
          const expired = !userSignOutRef.current && (userIdRef.current !== null || !resolvedRef.current);
          userSignOutRef.current = false;
          applySession(null, { reason: 'SIGNED_OUT', expired });
          signedOutRef.current?.();
          break;
        }
        default:
          break;
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      authLog('evento', { evento: event, conSesion: !!session });
      // No llamar a Supabase dentro de este callback: el cliente mantiene su
      // bloqueo interno mientras se ejecuta. Se procesa en la siguiente tarea.
      schedule(() => handleAuthEvent(event, session));
    });

    startBootstrap();

    const onOnline = () => {
      const current = authRef.current;
      authLog('red:recuperada', { incidencia: current.issue });
      if (
        current.issue === 'OFFLINE' ||
        current.issue === 'NETWORK' ||
        current.issue === 'INIT_TIMEOUT' ||
        current.issue === 'PERMISSIONS_UNAVAILABLE'
      ) {
        retry();
      }
    };
    window.addEventListener('online', onOnline);

    // [v7.1] Re-verificación silenciosa al volver a la pestaña.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const current = authRef.current;
      const session = sessionRef.current;
      if (!resolvedRef.current || !session || current.status !== 'authenticated' || !current.enriched) return;
      const threshold = current.role ? REVERIFY_WITH_ROLE_MS : REVERIFY_PENDING_MS;
      if (Date.now() - lastVerifiedRef.current < threshold) return;
      lastVerifiedRef.current = Date.now();   // throttle aunque falle
      generationRef.current += 1;
      const generation = generationRef.current;
      authLog('permisos:reverificacion', { conRol: !!current.role });
      schedule(() => { void enrich(session, generation, true); });
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      aliveRef.current = false;
      generationRef.current += 1;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      subscription.unsubscribe();
      abortPending();
      clearInitTimer();
      timers.forEach(id => clearTimeout(id));
      timers.clear();
    };
  }, [abortPending, applySession, clearInitTimer, enrich, resolveNullSession, retry, schedule, startBootstrap]);

  const value = useMemo<AuthContextValue>(() => ({
    ...auth,
    retry,
    signOut,
    repairDevice,
    getDiagnostics,
  }), [auth, retry, signOut, repairDevice, getDiagnostics]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
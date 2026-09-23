// src/context/AuthContext.tsx
// VALKYRON OS v5.1 — CONTEXTO DE AUTENTICACIÓN (MRO / INVENTARIO)
// ─────────────────────────────────────────────────────────────────────────────
// [NEW v5.1] Extraído de App.tsx v5.0 → evita dependencia circular
//            (App importa Index; Index necesita useAuth).
// Lógica de resolución preservada de v4.8/v5.0:
//   - getSession() + onAuthStateChange(INITIAL_SESSION) → doble mecanismo
//   - timeout de seguridad 8s
//   - rol: app_metadata (servidor) > user_metadata > perfiles_estudiantes.role
//   - TOKEN_REFRESHED actualiza sesión sin re-render global ni loader
//   - canPlan vía RPC fn_es_planificador (misma regla que la BD)
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

// ─── TIPOS ───────────────────────────────────────────────────────────────────

export type UserRole =
  | 'CEO' | 'ADMIN' | 'DIRECTOR' | 'PILOTO' | 'MECANICO' | 'CAPITAN' | 'PLANIFICADOR';

export interface UserProfile {
  nombre_completo: string;
  sede: string;
  rol: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  status:   AuthStatus;
  session:  any | null;
  role:     UserRole | null;
  profile:  UserProfile | null;
  canPlan:  boolean;
  enriched: boolean;   // perfil + permiso de planificación ya resueltos
}

export const INITIAL_AUTH: AuthState = {
  status: 'loading', session: null, role: null, profile: null, canPlan: false, enriched: false,
};

/** Roles que la BD reconoce como planificadores (espejo de fn_es_planificador) */
export const PLANNER_ROLES: UserRole[] = ['CEO', 'ADMIN', 'DIRECTOR', 'PLANIFICADOR'];

const AUTH_TIMEOUT_MS = 8000;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

export const normalizeRole = (raw: unknown): UserRole => {
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

/** app_metadata primero: user_metadata lo puede editar el propio usuario */
const extractRole = (sess: any): { role: UserRole; fromMetadata: boolean } => {
  const u = sess?.user;
  const raw = u?.app_metadata?.rol
    ?? u?.app_metadata?.role
    ?? u?.user_metadata?.rol
    ?? u?.user_metadata?.role;
  return { role: normalizeRole(raw), fromMetadata: raw != null };
};

// ─── CONTEXTO ────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>(INITIAL_AUTH);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  onSignedOut?: () => void;
}> = ({ children, onSignedOut }) => {
  const [auth, setAuth] = useState<AuthState>(INITIAL_AUTH);
  const userIdRef   = useRef<string | null>(null);
  const resolvedRef = useRef(false);
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;

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
        if (!fromMetadata && perfil.role) {
          role = normalizeRole(perfil.role);
          profile.rol = role;
        }
      }
    } catch (err) {
      console.warn('[MIA v5.1] Perfil no disponible:', err);
    }

    try {
      const { data: esPlan, error } = await supabase.rpc('fn_es_planificador');
      if (!error) canPlan = !!esPlan || PLANNER_ROLES.includes(role);
    } catch (err) {
      console.warn('[MIA v5.1] fn_es_planificador no disponible:', err);
    }

    if (userIdRef.current !== user.id) return;   // la sesión cambió mientras cargaba
    setAuth(prev => ({ ...prev, role, profile, canPlan, enriched: true }));
  }, []);

  const resolveSession = useCallback((sess: any) => {
    const newUserId = sess?.user?.id ?? null;

    // Mismo usuario ya resuelto (p. ej. TOKEN_REFRESHED): solo refresca la sesión
    if (resolvedRef.current && newUserId && newUserId === userIdRef.current) {
      setAuth(prev => ({ ...prev, session: sess }));
      return;
    }

    resolvedRef.current = true;
    userIdRef.current = newUserId;

    if (sess) {
      const { role, fromMetadata } = extractRole(sess);
      console.log('[MIA v5.1] Acceso concedido — rango:', role);
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
        console.warn('[MIA v5.1] Timeout de auth — forzando resolución sin sesión');
        resolveSession(null);
      }
    }, AUTH_TIMEOUT_MS);

    // Mecanismo 1: getSession() directo
    supabase.auth.getSession()
      .then(({ data: { session } }) => resolveSession(session))
      .catch((err) => {
        console.error('[MIA v5.1] getSession error:', err);
        resolveSession(null);
      })
      .finally(() => clearTimeout(safetyTimer));

    // Mecanismo 2: onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      console.log('[MIA v5.1] Auth event:', event);

      if (event === 'SIGNED_OUT') {
        resolvedRef.current = false;
        userIdRef.current = null;
        setAuth({ ...INITIAL_AUTH, status: 'anonymous', enriched: true });
        signedOutRef.current?.();
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
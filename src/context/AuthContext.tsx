
// src/context/AuthContext.tsx
// VALKYRON OS v6.1 — AUTENTICACIÓN Y ROLES OPERATIVOS
//
// FUSIÓN v5.1 + v6.0
//
// - roles_operativos > app_metadata.
// - user_metadata solo proporciona datos de presentación.
// - Compatibilidad con perfiles_estudiantes.
// - getSession() + onAuthStateChange().
// - Timeout de seguridad de 8 segundos.
// - TOKEN_REFRESHED actualiza la sesión sin recargar toda la aplicación.
// - USER_UPDATED vuelve a resolver los permisos.
// - fn_es_planificador verifica permisos adicionales.
// - Protección frente a respuestas asíncronas de sesiones anteriores.
// - Ningún rol desconocido obtiene permisos por defecto.
//
// IMPORTANTE:
// Los permisos definitivos se aplican mediante políticas RLS
// y funciones autorizadas de Supabase. Este contexto únicamente
// controla la sesión y la presentación de la aplicación.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabaseClient';

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
  | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  role: UserRole | null;
  profile: UserProfile | null;
  canPlan: boolean;
  enriched: boolean;
}

export const INITIAL_AUTH: AuthState = {
  status: 'loading',
  session: null,
  role: null,
  profile: null,
  canPlan: false,
  enriched: false,
};

// Los roles con acceso previsto a planificación.
// La autorización real debe coincidir con las políticas
// y funciones de la base de datos.

export const PLANNER_ROLES: UserRole[] = [
  'CEO',
  'ADMIN',
  'DIRECTOR',
  'PLANIFICADOR',
];

const AUTH_TIMEOUT_MS = 8000;

// ─────────────────────────────────────────────────────────────
// 2. NORMALIZACIÓN DE ROLES
// ─────────────────────────────────────────────────────────────

export const normalizeRole = (
  raw: unknown
): UserRole | null => {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (
    [
      'PLANIFICADOR_VUELO',
      'PLANIFICADOR_DE_VUELO',
      'PLANIFICACION',
      'DESPACHO',
      'DISPATCHER',
    ].includes(value)
  ) {
    return 'PLANIFICADOR';
  }

  if (value === 'INSTRUCTOR') {
    return 'CAPITAN';
  }

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

  return known.includes(value as UserRole)
    ? (value as UserRole)
    : null;
};

// app_metadata es administrado desde el servidor.
// user_metadata no se utiliza para asignar permisos.

const extractServerRole = (
  session: Session
): UserRole | null => {
  const user = session.user;

  return normalizeRole(
    user.app_metadata?.rol ??
    user.app_metadata?.role
  );
};

// ─────────────────────────────────────────────────────────────
// 3. CONTEXTO
// ─────────────────────────────────────────────────────────────

const AuthContext =
  createContext<AuthState>(INITIAL_AUTH);

export const useAuth = (): AuthState =>
  useContext(AuthContext);

// ─────────────────────────────────────────────────────────────
// 4. PROVIDER
// ─────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode;
  onSignedOut?: () => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  onSignedOut,
}) => {
  const [auth, setAuth] =
    useState<AuthState>(INITIAL_AUTH);

  // Identifica la sesión actualmente procesada.
  const userIdRef = useRef<string | null>(null);

  // Impide que getSession e INITIAL_SESSION produzcan
  // resoluciones duplicadas para una misma sesión.
  const resolvedRef = useRef(false);

  // Invalida peticiones antiguas cuando cambia la sesión.
  const generationRef = useRef(0);

  // Mantiene actualizada la función de cierre.
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;

  // ───────────────────────────────────────────────────────────
  // 5. RESOLVER PERFIL Y PERMISOS
  // ───────────────────────────────────────────────────────────

  const enrich = useCallback(
    async (
      session: Session,
      generation: number
    ): Promise<void> => {
      const user = session.user;

      // Rol provisional procedente exclusivamente
      // de metadatos administrados por el servidor.
      let role: UserRole | null =
        extractServerRole(session);

      // Los metadatos editables solo se utilizan
      // para información de presentación.
      let profile: UserProfile = {
        nombre_completo: String(
          user.user_metadata?.nombre_completo ??
          user.user_metadata?.full_name ??
          user.email ??
          'OPERADOR'
        ),
        sede: String(
          user.user_metadata?.sede ?? ''
        ),
        rol: role ?? 'SIN ASIGNAR',
      };

      // ─────────────────────────────────────────────────────
      // 5.1 ROL OPERATIVO AUTORIZADO
      // ─────────────────────────────────────────────────────

      try {
        const {
          data: assigned,
          error: roleError,
        } = await supabase
          .from('roles_operativos')
          .select('rol, nombre_completo, sede')
          .eq('user_id', user.id)
          .maybeSingle();

        if (roleError) {
          console.warn(
            '[AUTH] roles_operativos:',
            roleError.message
          );
        } else if (assigned) {
          // Una fila de roles_operativos tiene prioridad
          // sobre app_metadata, incluso si contiene
          // un rol no reconocido.
          role = normalizeRole(assigned.rol);

          profile = {
            nombre_completo:
              assigned.nombre_completo ||
              profile.nombre_completo,

            sede:
              assigned.sede ||
              profile.sede,

            rol: role ?? 'SIN ASIGNAR',
          };
        }
      } catch (error) {
        console.warn(
          '[AUTH] No se pudo consultar el rol operativo:',
          error
        );
      }

      // ─────────────────────────────────────────────────────
      // 5.2 DATOS DEL PERFIL EXISTENTE
      // ─────────────────────────────────────────────────────

      try {
        const {
          data: existingProfile,
          error: profileError,
        } = await supabase
          .from('perfiles_estudiantes')
          .select('nombre_completo, sede')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) {
          console.warn(
            '[AUTH] perfiles_estudiantes:',
            profileError.message
          );
        } else if (existingProfile) {
          // Compatibilidad con la versión anterior.
          // Esta tabla no modifica el rol operativo.
          profile = {
            ...profile,

            nombre_completo:
              profile.nombre_completo ===
              String(
                user.user_metadata?.nombre_completo ??
                user.user_metadata?.full_name ??
                user.email ??
                'OPERADOR'
              )
                ? (
                    existingProfile.nombre_completo ||
                    profile.nombre_completo
                  )
                : profile.nombre_completo,

            sede:
              profile.sede ===
              String(user.user_metadata?.sede ?? '')
                ? (
                    existingProfile.sede ||
                    profile.sede
                  )
                : profile.sede,
          };
        }
      } catch (error) {
        console.warn(
          '[AUTH] Perfil no disponible:',
          error
        );
      }

      // ─────────────────────────────────────────────────────
      // 5.3 PERMISO ADICIONAL DE PLANIFICACIÓN
      // ─────────────────────────────────────────────────────

      let rpcCanPlan = false;

      try {
        const {
          data: permission,
          error: rpcError,
        } = await supabase.rpc(
          'fn_es_planificador'
        );

        if (rpcError) {
          console.warn(
            '[AUTH] fn_es_planificador:',
            rpcError.message
          );
        } else {
          rpcCanPlan = permission === true;
        }
      } catch (error) {
        console.warn(
          '[AUTH] No se pudo verificar planificación:',
          error
        );
      }

      // ─────────────────────────────────────────────────────
      // 5.4 EVITAR RESPUESTAS OBSOLETAS
      // ─────────────────────────────────────────────────────

      if (
        generation !== generationRef.current ||
        userIdRef.current !== user.id
      ) {
        return;
      }

      // El rol reconocido determina qué interfaz
      // puede mostrarse.
      //
      // fn_es_planificador añade el permiso de
      // planificación que concede la base de datos.

      const canPlan =
        rpcCanPlan ||
        (
          role !== null &&
          PLANNER_ROLES.includes(role)
        );

      setAuth(prev => ({
        ...prev,

        status: 'authenticated',

        role,

        profile: {
          ...profile,
          rol: role ?? 'SIN ASIGNAR',
        },

        canPlan,

        enriched: true,
      }));
    },
    []
  );

  // ───────────────────────────────────────────────────────────
  // 6. RESOLUCIÓN DE SESIONES
  // ───────────────────────────────────────────────────────────

  const resolveSession = useCallback(
    (
      session: Session | null,
      force = false
    ): void => {
      const newUserId =
        session?.user?.id ?? null;

      // Si ya resolvimos la sesión del mismo usuario,
      // actualizar únicamente el token.
      //
      // USER_UPDATED utiliza force=true para cargar
      // de nuevo el perfil y los permisos.

      if (
        !force &&
        resolvedRef.current &&
        newUserId !== null &&
        newUserId === userIdRef.current
      ) {
        setAuth(prev => ({
          ...prev,
          session,
        }));

        return;
      }

      // Invalidar operaciones pendientes.
      generationRef.current += 1;

      const generation =
        generationRef.current;

      resolvedRef.current = true;
      userIdRef.current = newUserId;

      // ─────────────────────────────────────────────────────
      // 6.1 SESIÓN AUSENTE
      // ─────────────────────────────────────────────────────

      if (!session || !newUserId) {
        setAuth({
          ...INITIAL_AUTH,
          status: 'anonymous',
          enriched: true,
        });

        return;
      }

      // ─────────────────────────────────────────────────────
      // 6.2 SESIÓN AUTENTICADA
      // ─────────────────────────────────────────────────────

      // No se conceden permisos hasta completar
      // la resolución desde el servidor.

      setAuth({
        status: 'authenticated',
        session,
        role: null,
        profile: null,
        canPlan: false,
        enriched: false,
      });

      // Ejecutar fuera del callback de eventos de Auth
      // para evitar bloquear la gestión de sesiones.

      void enrich(
        session,
        generation
      ).catch(error => {
        console.error(
          '[AUTH] Error al resolver permisos:',
          error
        );

        if (
          generation !== generationRef.current ||
          userIdRef.current !== newUserId
        ) {
          return;
        }

        // Ante un error inesperado, no conceder
        // un rol ni permisos adicionales.

        setAuth(prev => ({
          ...prev,
          role: null,
          profile: null,
          canPlan: false,
          enriched: true,
        }));
      });
    },
    [enrich]
  );

  // ───────────────────────────────────────────────────────────
  // 7. CICLO DE VIDA DE AUTENTICACIÓN
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;

    // Timeout de seguridad para la carga inicial.
    const safetyTimer = setTimeout(() => {
      if (
        alive &&
        !resolvedRef.current
      ) {
        console.warn(
          '[AUTH] Timeout de sesión.'
        );

        resolveSession(null);
      }
    }, AUTH_TIMEOUT_MS);

    // ─────────────────────────────────────────────────────
    // 7.1 OBTENER SESIÓN ACTUAL
    // ─────────────────────────────────────────────────────

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;

        if (error) {
          console.error(
            '[AUTH] getSession:',
            error.message
          );

          if (!resolvedRef.current) {
            resolveSession(null);
          }

          return;
        }

        if (!resolvedRef.current) {
          resolveSession(
            data.session
          );
        }
      })
      .catch(error => {
        if (!alive) return;

        console.error(
          '[AUTH] Error al obtener sesión:',
          error
        );

        if (!resolvedRef.current) {
          resolveSession(null);
        }
      });

    // ─────────────────────────────────────────────────────
    // 7.2 ESCUCHAR CAMBIOS DE AUTENTICACIÓN
    // ─────────────────────────────────────────────────────

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!alive) return;

        switch (event) {
          case 'SIGNED_OUT': {
            resolveSession(
              null,
              true
            );

            signedOutRef.current?.();

            break;
          }

          case 'INITIAL_SESSION': {
            if (!resolvedRef.current) {
              resolveSession(session);
            }

            break;
          }

          case 'SIGNED_IN': {
            resolveSession(session);

            break;
          }

          case 'TOKEN_REFRESHED': {
            // Mantener la interfaz y actualizar
            // únicamente la sesión.
            if (session) {
              resolveSession(session);
            }

            break;
          }

          case 'USER_UPDATED': {
            // Una actualización de usuario obliga
            // a resolver nuevamente los permisos.
            resolveSession(
              session,
              true
            );

            break;
          }

          default:
            break;
        }
      }
    );

    // ─────────────────────────────────────────────────────
    // 7.3 LIMPIEZA
    // ─────────────────────────────────────────────────────

    return () => {
      alive = false;

      clearTimeout(
        safetyTimer
      );

      generationRef.current += 1;

      subscription.unsubscribe();
    };
  }, [resolveSession]);

  // ───────────────────────────────────────────────────────────
  // 8. PROVIDER
  // ───────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
};
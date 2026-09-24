// src/lib/supabaseClient.ts
// VALKYRON OS v7.2 — CLIENTE SUPABASE RESILIENTE · ÁGUILAS PILOT
// FUSIÓN: cliente original (credenciales verificadas) + v7.0 (resiliencia)
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.2.1:
//   [FIX] KeyCheck como tipo único (no unión discriminada): con strict/strictNullChecks
//         desactivado en tsconfig, `if (check.ok)` no estrecha la unión y TypeScript
//         marcaba TS2339 en 'fatal' y 'motivo'. Compila con y sin modo estricto.
//
// CHANGELOG v7.2 (sobre v7.1):
//   [FIX CRÍTICO] Una clave de entorno MALFORMADA (JWT corrupto, p. ej. alterado
//         por un buscar/reemplazar) se aceptaba en silencio → 401 "Invalid API
//         key" en login y refresh. Ahora se valida ANTES de usarla:
//           · JWT no decodificable, sin rol anon o de otro proyecto → se descarta,
//             se usa la clave embebida verificada (si la URL es la de Águilas)
//             y se registra config:clave-entorno-rechazada.
//           · service_role / sb_secret_ → la app se detiene (nunca en navegador).
//   [NEW] SUPABASE_CONFIG_SOURCE incluye 'env-rechazada' para diagnóstico.
//
// CHANGELOG v7.1 (sobre v7.0):
//   [FIX CRÍTICO] v7.0 lanzaba un error si no existían VITE_SUPABASE_URL /
//         VITE_SUPABASE_ANON_KEY. El proyecto original usa credenciales en código
//         → sin variables en Vercel la app quedaba en blanco. Ahora:
//         variables de entorno (si existen) > credenciales verificadas de Águilas.
//   [SEC] Bloqueo de service_role: si la clave configurada es de servicio (salta
//         RLS), la app se detiene con un error explícito en vez de exponerla.
//   [SEC] Aviso si la clave pertenece a otro proyecto distinto de la URL.
//   [KEEP ORIGINAL] URL y anon key verificadas de Águilas Pilot; export `supabase`.
//   [KEEP v7.0] resilientLock, resilientFetch, storageKey por defecto (sesiones
//         conservadas), instancia única en HMR, createIsolatedAuthClient, export default.
//
// PROBLEMA QUE RESUELVE (v7.0)
//   supabase-js v2 protege la sesión con un bloqueo entre pestañas (Web Locks,
//   navigator.locks). auth.getSession() lo espera SIN LÍMITE. Si otra pestaña del
//   mismo navegador quedó colgada con el bloqueo (refresh de token interrumpido,
//   pestaña congelada en segundo plano, equipo compartido con varias ventanas),
//   TODAS las consultas de la app esperan para siempre → "Sincronizando...".
//   En incógnito el almacenamiento y los bloqueos son otros → por eso "funciona".
//
// MEDIDAS
//   1. resilientLock: navigator.locks con espera máxima de 5 s; si no obtiene el
//      bloqueo continúa sin él (registrándolo) en lugar de congelar la app. Para
//      intentos "si está disponible" (acquireTimeout = 0) respeta el contrato de
//      supabase-js lanzando un error isAcquireTimeout.
//   2. resilientFetch: toda petición HTTP tiene tiempo máximo (auth 15 s, datos
//      20 s). Respeta la señal del llamador (.abortSignal()). Storage excluido.
//   3. storageKey explícita = clave por defecto de supabase-js → las sesiones
//      existentes se conservan (nadie es expulsado por este cambio).
//   4. Instancia única también en desarrollo (HMR) → sin listeners duplicados.
//   5. createIsolatedAuthClient(): cliente sin persistencia para altas (signUp)
//      que NO reemplaza la sesión del administrador actual.
//
// REQUISITO: @supabase/supabase-js >= 2.39 (opción auth.lock).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authLog } from '@/lib/authRecovery';

// ─── 0. CREDENCIALES ─────────────────────────────────────────────────────────

// CREDENCIALES AGUILAS PILOT - VERIFICADAS (respaldo si no hay variables de entorno).
// La anon key es pública por diseño: la seguridad la aplican las políticas RLS.
const AGUILAS_SUPABASE_URL = 'https://wftuieywphbifovuakml.supabase.co';
const AGUILAS_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmdHVpZXl3cGhiaWZvdnVha21sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzk0MjEsImV4cCI6MjA4ODgxNTQyMX0.9JTcdIK8DgdPlHbT5oAbrr3fhpOJ4bA6HsYwH1LfzlY';

const envUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const envKey = String(
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
).trim();

const SUPABASE_URL = envUrl || AGUILAS_SUPABASE_URL;

/** Referencia del proyecto (misma fórmula que usa supabase-js para su storageKey). */
export const SUPABASE_PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
/** Prefijo de TODAS las claves de sesión de este proyecto en el navegador. */
export const SUPABASE_STORAGE_PREFIX = `sb-${SUPABASE_PROJECT_REF}-`;
/** Clave por defecto de supabase-js → conserva las sesiones ya guardadas. */
export const SUPABASE_AUTH_STORAGE_KEY = `${SUPABASE_STORAGE_PREFIX}auth-token`;

const AGUILAS_PROJECT_REF = new URL(AGUILAS_SUPABASE_URL).hostname.split('.')[0];

// ─── 0.1 VALIDACIÓN DE LA CLAVE (sin exponerla) ──────────────────────────────

/** Lee el payload de una clave JWT legada. Devuelve null si no es decodificable. */
const readJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    if (b64.length % 4 === 1) return null;   // longitud imposible en base64 → clave dañada
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Resultado de validación. Tipo único: compatible con strictNullChecks activado o no. */
interface KeyCheck {
  ok: boolean;
  fatal: boolean;
  motivo: string;
}

const KEY_OK: KeyCheck = { ok: true, fatal: false, motivo: '' };
const keyFail = (motivo: string, fatal = false): KeyCheck => ({ ok: false, fatal, motivo });

/**
 * Valida una clave pública para el proyecto indicado.
 * fatal = true → clave privilegiada: nunca debe llegar al navegador.
 */
const checkPublicKey = (key: string, projectRef: string): KeyCheck => {
  if (key.startsWith('sb_secret_')) {
    return keyFail('clave secreta (sb_secret_) en el frontend', true);
  }
  if (key.startsWith('sb_publishable_')) {
    return key.length > 20 ? KEY_OK : keyFail('clave publishable incompleta');
  }
  const payload = readJwtPayload(key);
  if (!payload) {
    return keyFail('JWT malformado (no decodificable)');
  }
  if (payload.role === 'service_role') {
    return keyFail('clave service_role (salta RLS)', true);
  }
  if (payload.role !== 'anon') {
    return keyFail(`rol de clave inesperado: ${String(payload.role)}`);
  }
  if (typeof payload.ref === 'string' && payload.ref !== projectRef) {
    return keyFail(`clave del proyecto ${payload.ref}, URL del proyecto ${projectRef}`);
  }
  return KEY_OK;
};

const resolveAnonKey = (): { key: string; source: 'env' | 'embebida' | 'mixta' | 'env-rechazada' } => {
  if (!envKey) {
    return { key: AGUILAS_SUPABASE_ANON_KEY, source: envUrl ? 'mixta' : 'embebida' };
  }
  const check = checkPublicKey(envKey, SUPABASE_PROJECT_REF);
  if (check.ok) {
    return { key: envKey, source: envUrl ? 'env' : 'mixta' };
  }
  if (check.fatal) {
    throw new Error(
      `[VALKYRON] Configuración insegura: ${check.motivo}. ` +
      'Nunca use claves privilegiadas en el navegador: reemplácela por la anon/publishable key.',
    );
  }
  if (SUPABASE_PROJECT_REF === AGUILAS_PROJECT_REF) {
    authLog('config:clave-entorno-rechazada', {
      motivo: check.motivo,
      accion: 'se usa la clave embebida verificada; corrija VITE_SUPABASE_ANON_KEY',
    }, 'error');
    return { key: AGUILAS_SUPABASE_ANON_KEY, source: 'env-rechazada' };
  }
  throw new Error(
    `[VALKYRON] VITE_SUPABASE_ANON_KEY no es válida para ${SUPABASE_PROJECT_REF}: ${check.motivo}. ` +
    'Copie la clave correcta desde Supabase › Project Settings › API Keys.',
  );
};

const resolvedKey = resolveAnonKey();
const SUPABASE_ANON_KEY = resolvedKey.key;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[VALKYRON] Configuración incompleta: defina VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY ' +
    '(o VITE_SUPABASE_PUBLISHABLE_KEY) en .env y en las variables de entorno de Vercel.',
  );
}

/** Origen de la configuración activa (diagnóstico, sin exponer valores). */
export const SUPABASE_CONFIG_SOURCE: 'env' | 'embebida' | 'mixta' | 'env-rechazada' = resolvedKey.source;

// La clave finalmente elegida también debe superar la validación.
(() => {
  const finalCheck = checkPublicKey(SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF);
  if (!finalCheck.ok) {
    if (finalCheck.fatal) throw new Error(`[VALKYRON] Configuración insegura: ${finalCheck.motivo}.`);
    authLog('config:clave-activa-invalida', { motivo: finalCheck.motivo, origen: SUPABASE_CONFIG_SOURCE }, 'error');
  }
})();

// ─── 1. BLOQUEO ENTRE PESTAÑAS CON ESPERA MÁXIMA ─────────────────────────────

const LOCK_MAX_WAIT_MS = 5000;

type AcquireTimeoutError = Error & { isAcquireTimeout: true };

const makeAcquireTimeoutError = (name: string): AcquireTimeoutError => {
  const err = new Error(`Bloqueo de sesión no disponible: ${name}`) as AcquireTimeoutError;
  err.name = 'LockAcquireTimeoutError';
  err.isAcquireTimeout = true;
  return err;
};

async function resilientLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    return fn();
  }

  // acquireTimeout === 0 → supabase-js solo quiere el bloqueo si está libre
  // (tic de auto-refresh). Si está ocupado se espera un error isAcquireTimeout.
  if (acquireTimeout === 0) {
    return locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw makeAcquireTimeoutError(name);
      return fn();
    }) as Promise<R>;
  }

  // acquireTimeout < 0 significa "esperar indefinidamente" en supabase-js.
  // Se limita a LOCK_MAX_WAIT_MS para que nunca congele la aplicación.
  const waitMs = acquireTimeout > 0 ? Math.min(acquireTimeout, LOCK_MAX_WAIT_MS) : LOCK_MAX_WAIT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);

  try {
    return (await locks.request(
      name,
      { mode: 'exclusive', signal: controller.signal },
      async () => {
        clearTimeout(timer);
        return fn();
      },
    )) as R;
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted && err instanceof DOMException && err.name === 'AbortError') {
      authLog('lock:espera-agotada', { lock: name, esperaMs: waitMs }, 'warn');
      // Otra pestaña retiene el bloqueo. Continuar sin él es preferible a congelar
      // la interfaz; el servidor tolera refrescos concurrentes (reuse interval).
      return fn();
    }
    throw err;
  }
}

// ─── 2. FETCH CON TIEMPO MÁXIMO ──────────────────────────────────────────────

const AUTH_FETCH_TIMEOUT_MS = 15000;
const DATA_FETCH_TIMEOUT_MS = 20000;

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

export const resilientFetch: typeof fetch = (input, init) => {
  const url = requestUrl(input);

  // Subidas/descargas de archivos pueden durar más: sin límite artificial.
  if (url.includes('/storage/v1/')) {
    return fetch(input, init);
  }

  const timeoutMs = url.includes('/auth/v1/') ? AUTH_FETCH_TIMEOUT_MS : DATA_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);

  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener('abort', () => controller.abort(upstream.reason), { once: true });
  }

  const timer = setTimeout(() => {
    authLog('fetch:tiempo-agotado', {
      ruta: url.replace(SUPABASE_URL, '').split('?')[0],
      limiteMs: timeoutMs,
    }, 'warn');
    controller.abort(new DOMException(`Tiempo de espera agotado (${timeoutMs / 1000} s)`, 'TimeoutError'));
  }, timeoutMs);

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

// ─── 3. CLIENTE PRINCIPAL (instancia única) ──────────────────────────────────

type GlobalWithClient = typeof globalThis & { __valkyronSupabase__?: SupabaseClient };
const globalRef = globalThis as GlobalWithClient;

export const supabase: SupabaseClient =
  globalRef.__valkyronSupabase__ ??
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      lock: resilientLock,
    },
    global: {
      fetch: resilientFetch,
    },
  });

if (import.meta.env.DEV) {
  globalRef.__valkyronSupabase__ = supabase;
  authLog('config:cliente', { proyecto: SUPABASE_PROJECT_REF, origen: SUPABASE_CONFIG_SOURCE });
}

// ─── 4. CLIENTE AISLADO PARA ALTAS (signUp sin tocar la sesión actual) ───────

const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
};

/**
 * Cliente efímero: su sesión vive solo en memoria y se descarta.
 * Se usa para crear cuentas (alta de personal / solicitud de alta) sin que
 * supabase.auth.signUp reemplace la sesión del usuario que está operando.
 */
export const createIsolatedAuthClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `valkyron-alta-aislada-${SUPABASE_PROJECT_REF}`,
      storage: memoryStorage(),
    },
    global: {
      fetch: resilientFetch,
    },
  });

export default supabase;
// src/lib/authRecovery.ts
// VALKYRON OS v7.0 — DIAGNÓSTICO Y RECUPERACIÓN DE AUTENTICACIÓN
// ─────────────────────────────────────────────────────────────────────────────
// - authLog(): registro de diagnóstico en consola + buffer en memoria (80 eventos).
//   Nunca registra contraseñas, tokens, claves ni correos: los campos sensibles se
//   omiten y los identificadores se truncan.
// - classifyPostgrestError(): distingue tabla/función ausente, permiso denegado,
//   sesión inválida, red caída y otros errores → decisiones de seguridad explícitas.
// - clearProjectAuthStorage(): borra SOLO las claves de sesión de este proyecto
//   Supabase (prefijo sb-<ref>-). No toca datos de otras aplicaciones.
// - promiseWithTimeout(): límite de espera para operaciones NO cancelables
//   (signOut, getSession). Las consultas usan AbortController real.
// Este archivo no importa el cliente Supabase (evita dependencias circulares).
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthDiagEntry {
  t: string;
  stage: string;
  details?: Record<string, unknown>;
}

const MAX_ENTRIES = 80;
const diagBuffer: AuthDiagEntry[] = [];

const SENSITIVE_KEY = /(token|password|pass|secret|apikey|api_key|key|jwt|authorization|refresh|access|email|correo)/i;

const sanitize = (details?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[omitido]';
      continue;
    }
    if (typeof v === 'string') {
      out[k] = v.length > 180 ? `${v.slice(0, 180)}…` : v;
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = `[lista:${v.length}]`;
    } else {
      out[k] = '[objeto]';
    }
  }
  return out;
};

export const shortId = (id?: string | null): string | null =>
  id ? `${id.slice(0, 8)}…` : null;

export const authLog = (
  stage: string,
  details?: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info',
): void => {
  const entry: AuthDiagEntry = { t: new Date().toISOString(), stage, details: sanitize(details) };
  diagBuffer.push(entry);
  if (diagBuffer.length > MAX_ENTRIES) diagBuffer.shift();
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  out(`[VALKYRON AUTH] ${stage}`, entry.details ?? '');
};

export const getAuthLog = (): AuthDiagEntry[] => [...diagBuffer];

// ─── TIEMPOS LÍMITE ──────────────────────────────────────────────────────────

export class AuthTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: tiempo de espera agotado (${Math.round(ms / 1000)} s)`);
    this.name = 'AuthTimeoutError';
  }
}

/**
 * Límite de espera para operaciones que el cliente Supabase no permite cancelar
 * (p. ej. auth.signOut, auth.getSession). No se usa sobre consultas de datos:
 * éstas se cancelan de verdad con AbortController + .abortSignal().
 */
export function promiseWithTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthTimeoutError(label, ms)), ms);
    Promise.resolve(p).then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

// ─── CLASIFICACIÓN DE ERRORES POSTGREST ──────────────────────────────────────

export type DataErrorClass =
  | 'NONE'         // sin error
  | 'ABSENT'       // tabla/función inexistente en el esquema
  | 'DENIED'       // permiso denegado (grant/RLS)
  | 'SESSION'      // JWT inválido/expirado
  | 'UNREACHABLE'  // red caída, tiempo agotado, 5xx
  | 'OTHER';

export const classifyPostgrestError = (
  error: { code?: string | null; message?: string | null } | null | undefined,
  status?: number,
): DataErrorClass => {
  if (!error) return 'NONE';
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  if (['PGRST205', '42P01', 'PGRST202', '42883'].includes(code)
      || /does not exist|schema cache|could not find/i.test(msg)) return 'ABSENT';
  if (['PGRST301', 'PGRST302', 'PGRST303'].includes(code) || /jwt/i.test(msg) || status === 401) return 'SESSION';
  if (code === '42501' || status === 403) return 'DENIED';
  if (status === 0
      || /abort|timeout|tiempo de espera|failed to fetch|networkerror|network request failed|load failed/i.test(msg)
      || (status ?? 0) >= 500) return 'UNREACHABLE';
  return 'OTHER';
};

export const isOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

// ─── ALMACENAMIENTO DE SESIÓN (SOLO ESTE PROYECTO) ───────────────────────────

const LEGACY_KEYS = ['supabase.auth.token'];

const safeKeys = (storage: Storage | undefined): string[] => {
  if (!storage) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
};

const getStorage = (kind: 'local' | 'session'): Storage | undefined => {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
};

/** Nombres (nunca valores) de las claves de sesión de este proyecto. */
export const listAuthStorageKeys = (prefix: string): string[] => {
  const all = [...safeKeys(getStorage('local')), ...safeKeys(getStorage('session'))];
  return all.filter(k => k.startsWith(prefix) || LEGACY_KEYS.includes(k));
};

/**
 * Elimina únicamente las claves de sesión de ESTE proyecto Supabase.
 * No borra preferencias, cachés ni datos de otras aplicaciones del navegador.
 */
export const clearProjectAuthStorage = (prefix: string): number => {
  let removed = 0;
  (['local', 'session'] as const).forEach(kind => {
    const storage = getStorage(kind);
    safeKeys(storage).forEach(k => {
      if (k.startsWith(prefix) || LEGACY_KEYS.includes(k)) {
        try {
          storage?.removeItem(k);
          removed += 1;
        } catch {
          /* almacenamiento bloqueado por política del navegador */
        }
      }
    });
  });
  return removed;
};

/** Texto de diagnóstico para soporte. Sin tokens, contraseñas ni correos. */
export const getAuthDiagnostics = (prefix: string, extra?: Record<string, unknown>): string => {
  const lines: string[] = [];
  lines.push('VALKYRON OS — DIAGNÓSTICO DE AUTENTICACIÓN');
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push(`Navegador: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/D'}`);
  lines.push(`En línea: ${typeof navigator !== 'undefined' ? String(navigator.onLine) : 'N/D'}`);
  lines.push(`Web Locks: ${typeof navigator !== 'undefined' && 'locks' in navigator ? 'sí' : 'no'}`);
  lines.push(`Claves de sesión del proyecto: ${listAuthStorageKeys(prefix).join(', ') || 'ninguna'}`);
  const safeExtra = sanitize(extra);
  if (safeExtra) {
    Object.entries(safeExtra).forEach(([k, v]) => lines.push(`${k}: ${String(v)}`));
  }
  lines.push('— Eventos recientes —');
  diagBuffer.slice(-40).forEach(e => {
    lines.push(`${e.t} ${e.stage} ${e.details ? JSON.stringify(e.details) : ''}`);
  });
  return lines.join('\n');
};
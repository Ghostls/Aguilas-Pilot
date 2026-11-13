// src/components/AuthRecoveryPanel.tsx
// VALKYRON OS v7.1 — RECUPERACIÓN CONTROLADA DE SESIÓN · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.1 — REBRAND B&M (solo presentación):
//   [UI]   Panel en tarjeta blanca B&M con colores semánticos del tema
//          (bg-card, text-primary, bg-warning-tint…): se ve correcto en el Login
//          claro y dentro de módulos envueltos en .dark.
//   [UI]   Jerarquía de acciones: Reintentar (rojo, principal) · Cerrar sesión
//          (secundaria) · Reparar sesión (destructiva, contorno rojo profundo).
//          Botones de 48 px, textos en minúscula de oración.
//   [UI]   AuthLoader: cóndor B&M + barra de progreso indeterminada en lugar del
//          spinner dorado. Etiqueta por defecto "Sincronizando B&M…".
//   [UI]   Pantalla completa sobre lienzo claro con logo; min-h-[100dvh].
//   [A11Y] AuthLoader con role="status"; textarea de diagnóstico con etiqueta.
// PRESERVADO ÍNTEGRO (v7.0): props, estados (confirmRepair, busy, copied,
//   diagText), onRetry / onSignOut / onRepair / onCopy, condiciones de
//   visibilidad (showSignOut && hasSession, compact, lastError), escapeAfterMs.
// ─────────────────────────────────────────────────────────────────────────────
// AuthRecoveryPanel: explica la incidencia detectada por AuthContext y ofrece
//   · Reintentar                      (no destructivo)
//   · Cerrar sesión                   (global; respaldo local si no hay red)
//   · Reparar sesión del dispositivo  (destructivo, requiere confirmación explícita:
//                                      borra SOLO la sesión del sistema en este
//                                      navegador y obliga a iniciar sesión otra vez)
//   · Copiar diagnóstico              (sin tokens, contraseñas ni correos)
// AuthLoader: indicador de carga que, pasado un tiempo, muestra las mismas
//   acciones → ninguna pantalla queda cargando sin salida.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCopy, Loader2,
  LogOut, RefreshCw, ShieldAlert, WifiOff, Wrench,
} from 'lucide-react';
import { ISSUE_MESSAGES, useAuth } from '@/context/AuthContext';
import { BmLogo } from '@/components/brand/BmLogo'; // [v7.1] identidad B&M

interface AuthRecoveryPanelProps {
  fullScreen?: boolean;
  title?: string;
  detail?: string;
  compact?: boolean;
  showSignOut?: boolean;
}

// [v7.1] Clases de botón compartidas (tokens semánticos del tema B&M)
const btnBase =
  'h-12 w-full rounded-xl px-4 text-[15px] font-semibold inline-flex items-center justify-center gap-2 ' +
  'transition disabled:opacity-60 disabled:cursor-not-allowed';
const btnPrimary = `${btnBase} bg-primary text-primary-foreground hover:brightness-[0.85] active:scale-[0.99]`;
const btnSecondary = `${btnBase} border border-border bg-card text-foreground hover:bg-muted`;
const btnDanger = `${btnBase} border border-destructive/30 bg-card text-destructive hover:bg-destructive/5`;

export const AuthRecoveryPanel: React.FC<AuthRecoveryPanelProps> = ({
  fullScreen = false,
  title,
  detail,
  compact = false,
  showSignOut = true,
}) => {
  const auth = useAuth();
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [busy, setBusy] = useState<null | 'retry' | 'repair' | 'signout'>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [diagText, setDiagText] = useState<string | null>(null);

  const info = auth.issue ? ISSUE_MESSAGES[auth.issue] : null;
  const heading = title ?? info?.title ?? 'Incidencia de sesión';
  const body = detail ?? info?.detail ?? 'No se pudo completar la sincronización de la sesión.';
  const offline = auth.issue === 'OFFLINE';
  const hasSession = !!auth.session || auth.status === 'error';

  const onRetry = () => {
    setBusy('retry');
    auth.retry();
    setTimeout(() => setBusy(null), 1500);
  };

  const onSignOut = async () => {
    setBusy('signout');
    try {
      await auth.signOut();
    } finally {
      setBusy(null);
    }
  };

  const onRepair = async () => {
    setBusy('repair');
    await auth.repairDevice();
  };

  const onCopy = async () => {
    const text = auth.getDiagnostics();
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
      setDiagText(text);
    }
    setTimeout(() => setCopied(null), 3000);
  };

  const panel = (
    <div
      role="alert"
      className={`bm-app w-full ${compact ? 'max-w-md' : 'max-w-lg'} rounded-[24px] border border-border bg-card p-5 sm:p-7 text-left text-foreground shadow-bm-pop`}
    >
      <div className="flex items-start gap-3.5">
        <div className="h-11 w-11 shrink-0 rounded-full bg-warning-tint text-warning flex items-center justify-center">
          {offline
            ? <WifiOff className="h-5 w-5" />
            : <ShieldAlert className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted-foreground">Recuperación de sesión</p>
          <h2 className="bm-heading mt-0.5 text-lg sm:text-xl leading-snug">{heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          {auth.lastError && !compact && (
            <p className="mt-3 rounded-lg bg-muted px-3 py-2 font-data text-xs leading-relaxed text-muted-foreground break-words">
              Detalle técnico: {auth.lastError}
            </p>
          )}
        </div>
      </div>

      {!confirmRepair ? (
        <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy !== null}
            className={btnPrimary}
          >
            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reintentar
          </button>

          {showSignOut && hasSession && (
            <button
              type="button"
              onClick={() => void onSignOut()}
              disabled={busy !== null}
              className={btnSecondary}
            >
              {busy === 'signout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Cerrar sesión
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmRepair(true)}
            disabled={busy !== null}
            className={`${btnDanger} sm:col-span-2`}
          >
            <Wrench className="h-4 w-4" />
            Reparar sesión del dispositivo
          </button>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-destructive/25 bg-primary-tint p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
            <p className="text-sm leading-relaxed text-foreground">
              Se eliminará la sesión de <strong>B&amp;M</strong> guardada en este navegador.
              Tendrá que <strong>iniciar sesión otra vez</strong>. No se borran datos del sistema,
              ni de otras páginas o aplicaciones del equipo.
            </p>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setConfirmRepair(false)}
              disabled={busy === 'repair'}
              className={btnSecondary}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void onRepair()}
              disabled={busy === 'repair'}
              className={`${btnBase} bg-destructive text-destructive-foreground hover:brightness-[0.9]`}
            >
              {busy === 'repair' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              Confirmar reparación
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => void onCopy()}
        className="mt-4 flex w-full items-center justify-center gap-2 py-2 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors"
      >
        {copied === 'ok'
          ? <><CheckCircle2 className="h-4 w-4 text-success" /> Diagnóstico copiado</>
          : <><ClipboardCopy className="h-4 w-4" /> Copiar diagnóstico para soporte</>}
      </button>

      {diagText && (
        <textarea
          readOnly
          value={diagText}
          rows={6}
          aria-label="Diagnóstico para soporte"
          className="mt-2 w-full rounded-xl border border-border bg-muted p-3 font-data text-xs text-muted-foreground outline-none"
        />
      )}
    </div>
  );

  if (!fullScreen) return panel;

  return (
    <div className="bm-app flex min-h-[100dvh] w-full flex-col items-center justify-center gap-8 bg-muted px-5 py-10">
      <BmLogo variant="compact" className="h-10 w-auto text-primary" />
      {panel}
    </div>
  );
};

interface AuthLoaderProps {
  label?: string;
  /** Tras este tiempo se muestran las acciones de recuperación. */
  escapeAfterMs?: number;
  fullScreen?: boolean;
}

export const AuthLoader: React.FC<AuthLoaderProps> = ({
  label = 'Sincronizando B&M…',
  escapeAfterMs = 10000,
  fullScreen = true,
}) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), escapeAfterMs);
    return () => clearTimeout(t);
  }, [escapeAfterMs]);

  const content = (
    <div className="bm-app flex w-full flex-col items-center gap-6 text-center">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-5">
        <BmLogo variant="mark" aria-hidden="true" className="h-14 w-auto text-primary" />
        <div className="bm-indeterminate h-1 w-40 rounded-full bg-muted" aria-hidden="true" />
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      {slow && (
        <AuthRecoveryPanel
          compact
          title="La sincronización está tardando más de lo normal"
          detail="Puede reintentar ahora. Si el problema se repite en este equipo, repare la sesión del dispositivo."
        />
      )}
    </div>
  );

  if (!fullScreen) return <div className="flex w-full justify-center py-16">{content}</div>;

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-5 py-10">
      {content}
    </div>
  );
};

export default AuthRecoveryPanel;

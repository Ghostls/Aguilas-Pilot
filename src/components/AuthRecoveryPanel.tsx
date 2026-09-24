// src/components/AuthRecoveryPanel.tsx
// VALKYRON OS v7.0 — RECUPERACIÓN CONTROLADA DE SESIÓN
// ─────────────────────────────────────────────────────────────────────────────
// AuthRecoveryPanel: explica la incidencia detectada por AuthContext y ofrece
//   · Reintentar                      (no destructivo)
//   · Cerrar sesión                   (global; respaldo local si no hay red)
//   · Reparar sesión del dispositivo  (destructivo, requiere confirmación explícita:
//                                      borra SOLO la sesión de Águilas OS en este
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

interface AuthRecoveryPanelProps {
  fullScreen?: boolean;
  title?: string;
  detail?: string;
  compact?: boolean;
  showSignOut?: boolean;
}

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
      className={`w-full ${compact ? 'max-w-md' : 'max-w-lg'} rounded-3xl border border-amber-500/25 bg-[#0a0a0a] p-6 md:p-8 text-left shadow-2xl`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 shrink-0">
          {offline
            ? <WifiOff className="h-5 w-5 text-amber-400" />
            : <ShieldAlert className="h-5 w-5 text-amber-400" />}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-400">Recuperación de sesión</p>
          <h2 className="mt-1 text-base md:text-lg font-black uppercase italic text-white leading-tight">{heading}</h2>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{body}</p>
          {auth.lastError && !compact && (
            <p className="mt-2 text-[10px] font-mono text-zinc-600 break-words">Detalle técnico: {auth.lastError}</p>
          )}
        </div>
      </div>

      {!confirmRepair ? (
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-2xl bg-[#E1AD01] px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-white disabled:opacity-50"
          >
            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reintentar
          </button>

          {showSignOut && hasSession && (
            <button
              type="button"
              onClick={() => void onSignOut()}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:bg-white/5 disabled:opacity-50"
            >
              {busy === 'signout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Cerrar sesión
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmRepair(true)}
            disabled={busy !== null}
            className="flex items-center justify-center gap-2 rounded-2xl border border-red-500/25 px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-red-400 transition-all hover:bg-red-500/10 disabled:opacity-50 sm:col-span-2"
          >
            <Wrench className="h-4 w-4" />
            Reparar sesión del dispositivo
          </button>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/[0.05] p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <p className="text-xs text-red-200 leading-relaxed">
              Se eliminará la sesión de <strong>Águilas OS</strong> guardada en este navegador.
              Tendrá que <strong>iniciar sesión otra vez</strong>. No se borran datos del sistema,
              ni de otras páginas o aplicaciones del equipo.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmRepair(false)}
              disabled={busy === 'repair'}
              className="rounded-xl border border-white/10 px-3 py-3 text-[10px] font-black uppercase text-zinc-400 hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void onRepair()}
              disabled={busy === 'repair'}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-3 text-[10px] font-black uppercase text-white hover:bg-red-400 disabled:opacity-50"
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
        className="mt-4 flex w-full items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-600 hover:text-[#E1AD01]"
      >
        {copied === 'ok'
          ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Diagnóstico copiado</>
          : <><ClipboardCopy className="h-3.5 w-3.5" /> Copiar diagnóstico para soporte</>}
      </button>

      {diagText && (
        <textarea
          readOnly
          value={diagText}
          rows={6}
          className="mt-3 w-full rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-[9px] text-zinc-400"
        />
      )}
    </div>
  );

  if (!fullScreen) return panel;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#020202] p-6">
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
  label = 'Sincronizando Águilas OS...',
  escapeAfterMs = 10000,
  fullScreen = true,
}) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), escapeAfterMs);
    return () => clearTimeout(t);
  }, [escapeAfterMs]);

  const content = (
    <div className="flex flex-col items-center gap-6 text-left">
      <div className="h-16 w-16 animate-spin rounded-full border-t-2 border-[#E1AD01]" />
      <span className="animate-pulse text-[10px] font-black uppercase italic tracking-[0.5em] text-[#E1AD01]">
        {label}
      </span>
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
    <div className="flex min-h-screen w-full items-center justify-center bg-[#020202] p-6">
      {content}
    </div>
  );
};

export default AuthRecoveryPanel;
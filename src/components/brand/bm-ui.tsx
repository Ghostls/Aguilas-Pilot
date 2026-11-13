// src/components/brand/bm-ui.tsx
// VALKYRON OS — Kit de UI B&M Mantenimiento Aeronáutico v1.2
// v1.2: useBmConfirm — confirmación con promesa (sustituye window.confirm sin
//       romper flujos secuenciales: `if (!(await confirmar({...}))) return;`).
//       Tres salidas: 'confirm' | 'cancel' | 'dismiss' (Esc, fondo o X).
// v1.1: BmModal size 'xl' (historiales y vistas amplias).
// ─────────────────────────────────────────────────────────────────────────────
// Piezas compartidas por los módulos migrados a B&M (Hangar MRO, Stock, Salidas…).
// Mismo lenguaje visual que HomeDashboard / Login: superficies blancas, rojo B&M
// como acción principal, campos de 48 px con texto de 16 px (sin zoom en iOS).
//
//   BmModal   → hoja inferior en móvil, diálogo centrado desde md. Esc, toque
//               fuera, bloqueo de scroll y foco inicial en el botón de cierre.
//   BmField   → etiqueta + control + ayuda.
//   BmSelect  → <select> nativo con chevron propio.
//   BmBadge   → estado (ok, warn, danger, red, neutral, info).
//   BmEmpty   → estado vacío con dirección.
//   bmInput, bmTextarea, bmSelectCls, bmBtn → clases de controles y botones.
//
// Requiere los tokens bm-* de tailwind.config.ts y bm-theme.css (vía index.css).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

// ─── CLASES DE CONTROLES ─────────────────────────────────────────────────────

export const bmInput =
  'w-full h-12 rounded-xl border border-bm-field bg-white px-4 text-base text-bm-ink ' +
  'placeholder:text-bm-hint outline-none transition-[border-color,box-shadow] ' +
  'focus:border-bm-red focus:ring-4 focus:ring-bm-red/10 ' +
  'disabled:cursor-not-allowed disabled:bg-bm-canvas disabled:text-bm-steel';

export const bmTextarea =
  'w-full rounded-xl border border-bm-field bg-white px-4 py-3 text-base leading-relaxed text-bm-ink ' +
  'placeholder:text-bm-hint outline-none resize-none transition-[border-color,box-shadow] ' +
  'focus:border-bm-red focus:ring-4 focus:ring-bm-red/10';

export const bmSelectCls = `${bmInput} appearance-none pr-10 cursor-pointer`;

export const bmLabel = 'text-sm font-medium text-bm-ink';

const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-semibold ' +
  'transition disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99] disabled:active:scale-100';

/** Botones B&M. Altura 48 px (lg) o 40 px (sm). */
export const bmBtn = {
  primary:   `${btnBase} h-12 px-5 bg-bm-red text-white hover:bg-bm-red-deep disabled:hover:bg-bm-red`,
  dark:      `${btnBase} h-12 px-5 bg-bm-ink text-white hover:bg-[#2A2D34] disabled:hover:bg-bm-ink`,
  secondary: `${btnBase} h-12 px-4 border border-bm-line bg-white text-bm-ink hover:border-bm-red hover:text-bm-red disabled:hover:border-bm-line disabled:hover:text-bm-ink`,
  ghost:     `${btnBase} h-12 px-4 text-bm-steel hover:bg-bm-canvas hover:text-bm-ink`,
  danger:    `${btnBase} h-12 px-5 bg-bm-red-deep text-white hover:brightness-90`,
  success:   `${btnBase} h-12 px-5 bg-bm-ok text-white hover:brightness-95`,
  /** Variante compacta (40 px, 14 px) para barras de herramientas y tarjetas. */
  sm: '!h-10 !px-3.5 !text-sm',
  /** Botón cuadrado solo-ícono (40 px). */
  icon:
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-bm-line bg-white ' +
    'text-bm-steel transition-colors hover:border-bm-red hover:text-bm-red disabled:opacity-50',
};

// ─── CAMPO ───────────────────────────────────────────────────────────────────

export const BmField: React.FC<{
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, required, className = '', children }) => (
  <div className={`space-y-1.5 ${className}`}>
    <label htmlFor={htmlFor} className={`${bmLabel} flex items-center gap-1`}>
      {label}
      {required && <span className="text-bm-red" aria-hidden="true">*</span>}
    </label>
    {children}
    {hint && <p className="text-[13px] leading-snug text-bm-steel">{hint}</p>}
  </div>
);

// ─── SELECT ──────────────────────────────────────────────────────────────────

export const BmSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className = '', children, ...props
}) => (
  <div className="relative">
    <select {...props} className={`${bmSelectCls} ${className}`}>
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-steel"
      aria-hidden="true"
    />
  </div>
);

// ─── BADGE ───────────────────────────────────────────────────────────────────

export type BmTone = 'ok' | 'warn' | 'danger' | 'red' | 'neutral' | 'info' | 'dark';

const TONES: Record<BmTone, string> = {
  ok:      'bg-bm-ok-tint text-bm-ok',
  warn:    'bg-bm-warn-tint text-bm-warn',
  danger:  'bg-bm-red-tint text-bm-red-deep',
  red:     'bg-bm-red text-white',
  neutral: 'bg-bm-canvas text-bm-steel',
  info:    'bg-[#E8EEF9] text-[#2F5BB7]',
  dark:    'bg-bm-ink text-white',
};

export const BmBadge: React.FC<{
  tone?: BmTone;
  icon?: React.ReactNode;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = 'neutral', icon, dot, className = '', children }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]} ${className}`}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
    {icon}
    {children}
  </span>
);

/** Fondo del círculo de ícono según tono (cabeceras de modal, estados vacíos). */
export const bmIconTone: Record<BmTone, string> = {
  ok:      'bg-bm-ok-tint text-bm-ok',
  warn:    'bg-bm-warn-tint text-bm-warn',
  danger:  'bg-bm-red-tint text-bm-red',
  red:     'bg-bm-red text-white',
  neutral: 'bg-bm-canvas text-bm-ink',
  info:    'bg-[#E8EEF9] text-[#2F5BB7]',
  dark:    'bg-bm-ink text-white',
};

// ─── ESTADO VACÍO ────────────────────────────────────────────────────────────

export const BmEmpty: React.FC<{
  icon: React.ReactNode;
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, text, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center px-4 py-12 text-center ${className}`}>
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bm-canvas text-bm-steel">{icon}</div>
    <p className="mt-3 text-base font-semibold text-bm-ink">{title}</p>
    {text && <p className="mt-1 max-w-sm text-sm leading-relaxed text-bm-steel">{text}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

// ─── MODAL ───────────────────────────────────────────────────────────────────

const MODAL_SIZES = {
  sm: 'md:max-w-md',
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
  xl: 'md:max-w-5xl',
} as const;

export interface BmModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: BmTone;
  size?: keyof typeof MODAL_SIZES;
  /** z-index de la capa (los modales apilados usan uno mayor). */
  z?: number;
  /** Bloquea cierre (Esc, fondo, X) mientras se procesa una operación. */
  busy?: boolean;
  children: React.ReactNode;
}

/**
 * Modal B&M: hoja inferior en móvil, diálogo centrado desde md.
 * Cierra con Esc, tocando el fondo o con la X (salvo `busy`).
 */
export const BmModal: React.FC<BmModalProps> = ({
  open, onClose, title, subtitle, icon, tone = 'neutral', size = 'md', z = 120, busy = false, children,
}) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) onCloseRef.current();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="bm-app fixed inset-0 flex items-end justify-center md:items-center md:p-6" style={{ zIndex: z }}>
      <div
        className="bm-backdrop absolute inset-0 bg-bm-ink/50 backdrop-blur-[2px]"
        onClick={() => { if (!busy) onClose(); }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`bm-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-white text-bm-ink shadow-bm-sheet md:rounded-[28px] ${MODAL_SIZES[size]}`}
      >
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-bm-line" />
        </div>

        <div className="flex items-center gap-3 border-b border-bm-line px-5 pb-4 pt-3 sm:px-7 md:pt-6">
          {icon && (
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bmIconTone[tone]}`}>
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="bm-heading truncate text-lg leading-tight sm:text-xl">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-[13px] text-bm-steel">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bm-canvas text-bm-ink transition-colors hover:bg-bm-red-tint hover:text-bm-red disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-7 sm:pt-6">
          {children}
        </div>
      </div>
    </div>
  );
};

/** Aviso en línea dentro de formularios y paneles. */
export const BmNotice: React.FC<{
  tone?: 'warn' | 'danger' | 'info' | 'ok';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}> = ({ tone = 'warn', icon, children, className = '', role }) => {
  const cls = {
    warn:   'border-bm-warn/20 bg-bm-warn-tint text-[#7C2D12]',
    danger: 'border-bm-red/25 bg-bm-red-tint text-bm-red-deep',
    info:   'border-[#2F5BB7]/20 bg-[#E8EEF9] text-[#1E3A75]',
    ok:     'border-bm-ok/20 bg-bm-ok-tint text-[#14532D]',
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug ${cls} ${className}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
};

// ─── CONFIRMACIÓN CON PROMESA [v1.2] ─────────────────────────────────────────

export type BmConfirmResult = 'confirm' | 'cancel' | 'dismiss';

export interface BmConfirmOptions {
  title: string;
  subtitle?: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Estilo del botón principal. */
  variant?: 'primary' | 'dark' | 'danger';
  tone?: BmTone;
  icon?: React.ReactNode;
}

/**
 * Diálogo de confirmación B&M con promesa.
 *
 * @example
 *   const [preguntar, confirmDialog] = useBmConfirm();
 *   if ((await preguntar({ title: '¿Continuar?' })) !== 'confirm') return;
 *   ...
 *   return <>{...}{confirmDialog}</>;
 *
 * - 'confirm': botón principal · 'cancel': botón secundario · 'dismiss': Esc, fondo o X.
 * - Al desmontar con una pregunta abierta se resuelve 'dismiss' (sin promesas colgadas).
 */
export function useBmConfirm(): [(o: BmConfirmOptions) => Promise<BmConfirmResult>, React.ReactNode] {
  const [pending, setPending] = useState<(BmConfirmOptions & { resolve: (r: BmConfirmResult) => void }) | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const ask = useCallback((o: BmConfirmOptions) => new Promise<BmConfirmResult>(resolve => {
    pendingRef.current?.resolve('dismiss'); // una sola pregunta abierta a la vez
    setPending({ ...o, resolve });
  }), []);

  useEffect(() => () => { pendingRef.current?.resolve('dismiss'); }, []);

  const finish = (r: BmConfirmResult) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(r);
  };

  const mainCls = pending?.variant === 'danger' ? bmBtn.danger : pending?.variant === 'dark' ? bmBtn.dark : bmBtn.primary;
  // Etiquetas largas: botones apilados para que ninguno parta en dos líneas.
  const apilar = ((pending?.confirmLabel ?? 'Continuar').length + (pending?.cancelLabel ?? 'Cancelar').length) > 30;

  const dialog = (
    <BmModal
      open={!!pending}
      onClose={() => finish('dismiss')}
      title={pending?.title ?? ''}
      subtitle={pending?.subtitle}
      icon={pending?.icon}
      tone={pending?.tone ?? 'warn'}
      size="sm"
      z={300}
    >
      {pending && (
        <div className="space-y-5">
          {pending.body && <div className="space-y-3 text-[15px] leading-relaxed text-bm-ink">{pending.body}</div>}
          <div className={`flex flex-col-reverse gap-3 ${apilar ? '' : 'sm:flex-row'}`}>
            <button type="button" onClick={() => finish('cancel')} className={`${bmBtn.secondary} sm:flex-1`}>
              {pending.cancelLabel ?? 'Cancelar'}
            </button>
            <button type="button" onClick={() => finish('confirm')} className={`${mainCls} sm:flex-1`}>
              {pending.confirmLabel ?? 'Continuar'}
            </button>
          </div>
        </div>
      )}
    </BmModal>
  );

  return [ask, dialog];
}

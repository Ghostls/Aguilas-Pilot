// src/components/FatigueBar.tsx
// VALKYRON OS v2.0 — Monitoreo de fatiga de componentes · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0 — REBRAND B&M + PRECISIÓN:
//   [FIX] limit ≤ 0 o no numérico: `current % 0` = NaN → la etiqueta mostraba
//         "NaNH REM" y la barra quedaba sin ancho. Ahora el estado es "sin datos".
//   [FIX] current negativo, NaN o Infinity → "sin datos" (antes NaN o porcentaje
//         negativo en el estilo inline).
//   [FIX] Porcentaje acotado a 0–100 % (el ancho inline ya no puede salirse de la pista).
//   [NEW] `lastInspectionAt` (opcional): con las horas de la última inspección el
//         cálculo es exacto y detecta la inspección VENCIDA (T_rest < 0). Sin ese
//         dato se conserva el modelo cíclico original (T_act mod T_lim).
//   [NEW] `warnAt` / `criticalAt` (opcionales, por defecto 10 h y 5 h: los umbrales
//         de la v1).
//   [A11Y] role="progressbar" con aria-valuenow/min/max y texto legible.
//   [UI]  B&M: pista gris claro, estado normal en acero, aviso en ocre, crítico y
//         vencido en rojo B&M. Sin resplandores; el pulso de alerta solo se anima
//         si el sistema no pide movimiento reducido.
// PRESERVADO: props current / limit / label, umbrales por defecto 10 h y 5 h,
//   textos de alerta, export default.
// ─────────────────────────────────────────────────────────────────────────────
//
// Modelo:
//   Cíclico (v1):     T_usado = T_act mod T_lim        T_rest = T_lim − T_usado
//   Con inspección:   T_usado = T_act − T_ult           T_rest = T_lim − T_usado
//   Consumo de vida:  p = clamp(T_usado / T_lim, 0, 1) · 100 %
//   Estado:           T_rest < 0 → vencida · T_rest ≤ criticalAt → crítico
//                     T_rest ≤ warnAt → aviso · resto → normal

import React from 'react';

interface FatigueBarProps {
  current: number;
  limit: number;
  label: string;
  /** [NEW v2.0] Horas de la aeronave/componente en la última inspección. */
  lastInspectionAt?: number | null;
  /** [NEW v2.0] Horas restantes desde las que se avisa (por defecto 10). */
  warnAt?: number;
  /** [NEW v2.0] Horas restantes desde las que es crítico (por defecto 5). */
  criticalAt?: number;
}

type FatigueStatus = 'ok' | 'warning' | 'critical' | 'overdue' | 'no-data';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Componente de Monitoreo de Fatiga Aeronáutica
 * Implementa la fórmula física: T_restante = T_limite - T_actual
 */
const FatigueBar = ({
  current,
  limit,
  label,
  lastInspectionAt = null,
  warnAt = 10,
  criticalAt = 5,
}: FatigueBarProps) => {
  // [v2.0] Entradas válidas: horas finitas no negativas y límite positivo
  const datosValidos = isNum(current) && current >= 0 && isNum(limit) && limit > 0;
  const conInspeccion = datosValidos && isNum(lastInspectionAt) && lastInspectionAt >= 0 && lastInspectionAt <= current;

  // Cálculo de horas restantes basado en el límite de mantenimiento (50h/100h)
  const usado = !datosValidos
    ? 0
    : conInspeccion
      ? current - (lastInspectionAt as number)
      : current % limit;
  const remaining = datosValidos ? limit - usado : 0;
  // El porcentaje refleja el consumo de vida útil del componente
  const percentage = datosValidos ? Math.min(100, Math.max(0, (usado / limit) * 100)) : 0;

  const getStatus = (): FatigueStatus => {
    if (!datosValidos) return 'no-data';
    if (remaining < 0) return 'overdue';
    if (remaining <= criticalAt) return 'critical';
    if (remaining <= warnAt) return 'warning';
    return 'ok';
  };

  const status = getStatus();

  // [v2.0] Paleta B&M por estado
  const colorStyles: Record<FatigueStatus, { text: string; bar: string }> = {
    overdue:   { text: 'text-bm-red-deep', bar: 'bg-bm-red-deep' },
    critical:  { text: 'text-bm-red',      bar: 'bg-bm-red' },
    warning:   { text: 'text-bm-warn',     bar: 'bg-bm-warn' },
    ok:        { text: 'text-bm-steel',    bar: 'bg-bm-steel/70' },
    'no-data': { text: 'text-bm-hint',     bar: 'bg-transparent' },
  };

  const currentStyle = colorStyles[status];

  const valorTexto =
    status === 'no-data' ? 'Sin datos'
    : status === 'overdue' ? `Vencida por ${Math.abs(remaining).toFixed(1)} h`
    : `${remaining.toFixed(1)} h restantes`;

  const alerta =
    status === 'overdue' ? 'Inspección vencida'
    : status === 'critical' ? 'Requiere inspección inmediata'
    : status === 'warning' ? 'Mantenimiento próximo'
    : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-bm-ink" title={label}>{label}</span>
        <span className={`bm-num flex shrink-0 items-center gap-1.5 font-data font-semibold ${currentStyle.text}`}>
          {(status === 'critical' || status === 'overdue') && (
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-bm-red opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bm-red" />
            </span>
          )}
          {valorTexto}
        </span>
      </div>

      {/* Pista de consumo de vida útil */}
      <div
        role="progressbar"
        aria-label={`Vida consumida de ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentage)}
        aria-valuetext={status === 'no-data' ? 'Sin datos' : `${Math.round(percentage)} % consumido, ${valorTexto}`}
        className="h-2 w-full overflow-hidden rounded-full bg-bm-canvas"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${currentStyle.bar}`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Indicador de umbral crítico */}
      {alerta && (
        <p className={`text-right text-[11px] font-medium ${currentStyle.text}`}>{alerta}</p>
      )}
    </div>
  );
};

export default FatigueBar;

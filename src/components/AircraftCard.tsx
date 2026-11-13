// src/components/AircraftCard.tsx
// VALKYRON OS v1.3 — B&M MANTENIMIENTO AERONÁUTICO
//
// CHANGELOG v1.3 — REBRAND B&M:
//   [UI]  Tarjeta blanca B&M: matrícula en tipografía de datos, estado como
//         insignia semántica (verde operativa, ámbar hangar, rojo AOG, azul en
//         vuelo), sede y monitoreo de fatiga legibles en móvil.
//   [NEW] Prop opcional `actions`: botones del contenedor (Historial, Editar
//         orden) en el pie de la tarjeta, FUERA del área clicable. Antes Flota
//         los pintaba aparte y solo con hover (inaccesibles en táctil).
//   [A11Y] El área clicable ya no contiene otros botones (botón dentro de
//         botón); foco visible.
//   [CHG] statusConfig: `className` (paleta oscura) → `tone` (BmTone).
// PRESERVADO ÍNTEGRO (v1.2): normalización de estados con y sin tildes,
//   estado vacío o desconocido → AOG / Tierra (conservador), etiqueta
//   "Operativa en sistema", monitoreo de fatiga con FatigueBar (máx. 2
//   componentes, límite 100), selección por clic / Enter / Espacio,
//   onOpenHistorial opcional, props existentes.
//
// IMPORTANTE:
//   Este componente es visual. El estado real debe
//   sincronizarse desde PostgreSQL y FleetDashboard.
// ─────────────────────────────────────────────────────────────

import React from 'react';

import {
  Plane,
  MapPin,
  Wrench,
  CheckCircle,
  AlertTriangle,
  Shield,
  History,
} from 'lucide-react';

import type { Aircraft } from '@/Types/Maintenance';

import FatigueBar from './FatigueBar';
import { BmBadge, bmBtn, type BmTone } from './brand/bm-ui';

// ─────────────────────────────────────────────────────────────
// PROPIEDADES
// ─────────────────────────────────────────────────────────────

interface AircraftCardProps {
  aircraft: Aircraft;
  onSelect: (aircraft: Aircraft) => void;
  onOpenHistorial?: (aircraft: Aircraft) => void;
  /** [v1.3] Acciones del contenedor, en el pie y fuera del área clicable. */
  actions?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE ESTADOS
// ─────────────────────────────────────────────────────────────

const statusConfig = {
  operational: {
    label: 'Operativa en sistema',
    icon: CheckCircle,
    tone: 'ok' as BmTone,
  },

  maintenance: {
    label: 'Hangar / mantenimiento',
    icon: Wrench,
    tone: 'warn' as BmTone,
  },

  grounded: {
    label: 'AOG / en tierra',
    icon: AlertTriangle,
    tone: 'danger' as BmTone,
  },

  flight: {
    label: 'En vuelo',
    icon: Plane,
    tone: 'info' as BmTone,
  },
};

type StatusKey = keyof typeof statusConfig;

// ─────────────────────────────────────────────────────────────
// TRADUCTOR UNIVERSAL DE ESTADOS
// ─────────────────────────────────────────────────────────────

const mapStatusToKey = (
  rawStatus: string | null | undefined
): StatusKey => {
  // Ante un valor vacío, no asumir disponibilidad.
  if (!rawStatus) {
    return 'grounded';
  }

  // Normalización:
  // - Minúsculas
  // - Eliminación de espacios adicionales
  // - Eliminación de tildes
  const status = rawStatus
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Mantenimiento
  if (
    status.includes('mantenimiento') ||
    status.includes('maintenance')
  ) {
    return 'maintenance';
  }

  // En vuelo
  if (
    status.includes('vuelo') ||
    status.includes('flight')
  ) {
    return 'flight';
  }

  // AOG / En tierra
  if (
    status.includes('tierra') ||
    status.includes('grounded') ||
    status.includes('aog')
  ) {
    return 'grounded';
  }

  // Operativa
  if (
    status.includes('operativa') ||
    status.includes('operativo') ||
    status.includes('operational')
  ) {
    return 'operational';
  }

  // Fallback conservador para estados desconocidos.
  return 'grounded';
};

// ─────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────

const AircraftCard: React.FC<AircraftCardProps> = ({
  aircraft,
  onSelect,
  onOpenHistorial,
  actions,
}) => {
  // Estado normalizado de la aeronave.
  const statusKey = mapStatusToKey(
    aircraft.status
  );

  // Configuración visual.
  const status = statusConfig[statusKey];

  // Icono correspondiente al estado.
  const StatusIcon = status.icon;

  // Componentes para monitoreo de fatiga.
  const components = aircraft.components ?? [];

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[20px] border border-bm-line bg-white text-left text-bm-ink transition-colors hover:border-bm-field">
      {/* ─────────────────────────────────────────────── */}
      {/* ÁREA CLICABLE: ENCABEZADO, SEDE Y FATIGA        */}
      {/* ─────────────────────────────────────────────── */}

      <div
        className="flex-1 cursor-pointer space-y-4 p-4 outline-none transition-colors hover:bg-bm-canvas/40 focus-visible:bg-bm-canvas/60 focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-bm-red/15 sm:p-5"
        onClick={() => onSelect(aircraft)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(aircraft); } }}
        role="button" tabIndex={0} aria-label={`Ver aeronave ${aircraft.tailNumber}`}
      >
        {/* Matrícula, modelo y estado */}

        {/* flex-wrap: con estados largos la insignia baja de línea en vez de cortar la matrícula */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">

          <div className="flex min-w-0 items-center gap-3">

            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
              <Plane className="h-5 w-5" />
            </span>

            <div className="min-w-0">

              <h3 className="truncate font-data text-xl font-semibold uppercase leading-none">
                {aircraft.tailNumber}
              </h3>

              <p className="mt-1.5 truncate text-[13px] uppercase text-bm-steel">
                {aircraft.model}
              </p>

            </div>
          </div>

          {/* Indicador del estado */}

          <BmBadge tone={status.tone} icon={<StatusIcon className="h-3 w-3" />} className="shrink-0">
            {status.label}
          </BmBadge>
        </div>

        {/* ─────────────────────────────────────────── */}
        {/* SEDE                                      */}
        {/* ─────────────────────────────────────────── */}

        <span className="inline-flex items-center gap-1.5 rounded-lg bg-bm-canvas px-2.5 py-1.5 text-xs font-medium text-bm-ink">
          <MapPin className="h-3.5 w-3.5 text-bm-red" />
          Base {aircraft.location || 'sin asignar'}
        </span>

        {/* ─────────────────────────────────────────── */}
        {/* MONITOREO DE FATIGA                       */}
        {/* ─────────────────────────────────────────── */}

        <div className="space-y-3 border-t border-bm-line pt-3.5">

          {/* Título */}

          <div className="flex items-center gap-2">

            <Shield className="h-3.5 w-3.5 text-bm-steel" />

            <span className="text-xs font-medium text-bm-steel">
              Monitoreo de fatiga
            </span>
          </div>

          {/* Indicadores de componentes */}

          {components.slice(0, 2).map(
            (comp, idx) => (
              <FatigueBar
                key={comp.id || idx}
                current={
                  comp.timeSinceOverhaul || 0
                }
                limit={100}
                label={
                  comp.name || 'Componente'
                }
              />
            )
          )}

          {/* Sin telemetría */}

          {components.length === 0 && (
            <p className="text-xs text-bm-hint">
              Datos de telemetría no disponibles
            </p>
          )}

        </div>
      </div>

      {/* Expediente OMA (opcional) — fuera del área clicable [v1.3] */}

      {onOpenHistorial && (
        <div className="px-4 pb-4 sm:px-5">
          <button type="button" onClick={event => { event.stopPropagation(); onOpenHistorial(aircraft); }}
            className={`${bmBtn.secondary} ${bmBtn.sm} w-full`}>
            <History className="h-4 w-4" /> Expediente histórico OMA
          </button>
        </div>
      )}

      {/* Acciones del contenedor [v1.3] */}

      {actions && (
        <div className="flex gap-2 border-t border-bm-line p-3">
          {actions}
        </div>
      )}
    </article>
  );
};

export default AircraftCard;

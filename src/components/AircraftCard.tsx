
// src/components/AircraftCard.tsx
// VALKYRON OS v1.2 — FUSIÓN COMPLETA
//
// PRESERVADO:
//   - Diseño original de las tarjetas
//   - Identidad visual Valkyron (#E1AD01)
//   - Monitoreo de fatiga
//   - Visualización de sede y modelo
//   - Selección de aeronave
//   - Cuatro estados visuales
//
// MEJORAS:
//   - Tipado estricto de los estados
//   - Compatibilidad con valores nulos
//   - Normalización de estados con y sin tildes
//   - Estado desconocido -> AOG / Tierra
//   - Etiqueta "Operativa en sistema"
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
} from 'lucide-react';

import type { Aircraft } from '@/Types/Maintenance';

import FatigueBar from './FatigueBar';

// ─────────────────────────────────────────────────────────────
// PROPIEDADES
// ─────────────────────────────────────────────────────────────

interface AircraftCardProps {
  aircraft: Aircraft;
  onSelect: (aircraft: Aircraft) => void;
}

// ─────────────────────────────────────────────────────────────
// CONFIGURACIÓN DE ESTADOS
// ─────────────────────────────────────────────────────────────

const statusConfig = {
  operational: {
    label: 'Operativa en sistema',
    icon: CheckCircle,
    className:
      'bg-green-500/10 text-green-500 border-green-500/20',
  },

  maintenance: {
    label: 'Hangar / Mantenimiento',
    icon: Wrench,
    className:
      'bg-[#E1AD01]/10 text-[#E1AD01] border-[#E1AD01]/20',
  },

  grounded: {
    label: 'AOG / Tierra',
    icon: AlertTriangle,
    className:
      'bg-red-500/10 text-red-500 border-red-500/20',
  },

  flight: {
    label: 'En Vuelo',
    icon: Plane,
    className:
      'bg-blue-500/10 text-blue-500 border-blue-500/20',
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
    <div
      className="
        bg-[#0f0f0f]
        border
        border-white/10
        rounded-2xl
        overflow-hidden
        cursor-pointer
        hover:border-[#E1AD01]/50
        hover:shadow-[0_0_30px_rgba(225,173,1,0.1)]
        transition-all
        duration-300
        group
        text-left
      "
      onClick={() => onSelect(aircraft)}
    >
      {/* ─────────────────────────────────────────────── */}
      {/* ENCABEZADO Y ESTADO                         */}
      {/* ─────────────────────────────────────────────── */}

      <div
        className="
          relative
          h-24
          bg-gradient-to-br
          from-slate-900
          to-black
          overflow-hidden
          flex
          items-center
          justify-center
        "
      >
        {/* Marca de agua */}

        <Plane
          className="
            h-12
            w-12
            text-white/5
            absolute
            -right-2
            -bottom-2
            rotate-12
          "
        />

        {/* Gradiente inferior */}

        <div
          className="
            absolute
            inset-0
            bg-gradient-to-t
            from-[#0f0f0f]
            to-transparent
          "
        />

        {/* Indicador del estado */}

        <div
          className={`
            absolute
            top-3
            right-3
            flex
            items-center
            gap-1.5
            rounded-lg
            px-3
            py-1
            text-[10px]
            font-black
            uppercase
            tracking-widest
            border
            backdrop-blur-md
            ${status.className}
          `}
        >
          <StatusIcon className="h-3 w-3" />

          <span>{status.label}</span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────── */}
      {/* INFORMACIÓN DE AERONAVE                    */}
      {/* ─────────────────────────────────────────────── */}

      <div className="p-5 space-y-4">

        {/* Matrícula y modelo */}

        <div className="flex items-start justify-between">

          <div className="flex items-center gap-3 text-left">

            <div
              className="
                p-2
                bg-[#E1AD01]/10
                rounded-lg
              "
            >
              <Plane
                className="
                  h-5
                  w-5
                  text-[#E1AD01]
                "
              />
            </div>

            <div className="text-left">

              <h3
                className="
                  font-mono
                  font-black
                  text-xl
                  text-white
                  tracking-tighter
                  uppercase
                  leading-none
                "
              >
                {aircraft.tailNumber}
              </h3>

              <p
                className="
                  text-[10px]
                  text-slate-500
                  font-bold
                  uppercase
                  tracking-widest
                  mt-1
                  text-left
                "
              >
                {aircraft.model}
              </p>

            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────── */}
        {/* SEDE                                      */}
        {/* ─────────────────────────────────────────── */}

        <div
          className="
            flex
            items-center
            gap-2
            text-[10px]
            text-slate-400
            font-mono
            bg-white/5
            w-fit
            px-2
            py-1
            rounded
            border
            border-white/5
          "
        >
          <MapPin
            className="
              h-3
              w-3
              text-[#E1AD01]
            "
          />

          <span
            className="
              uppercase
              tracking-tighter
              text-slate-300
            "
          >
            Base {aircraft.location || 'Sin asignar'}
          </span>
        </div>

        {/* ─────────────────────────────────────────── */}
        {/* MONITOREO DE FATIGA                       */}
        {/* ─────────────────────────────────────────── */}

        <div className="space-y-3 pt-2 text-left">

          {/* Título */}

          <div className="flex items-center gap-2 mb-1">

            <Shield
              className="
                h-3
                w-3
                text-[#E1AD01]/50
              "
            />

            <span
              className="
                text-[9px]
                font-black
                text-slate-500
                uppercase
                tracking-[0.2em]
              "
            >
              Monitoreo de Fatiga
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
            <p
              className="
                text-[8px]
                text-slate-600
                font-mono
                uppercase
              "
            >
              Datos de telemetría no disponibles
            </p>
          )}

        </div>

      </div>
    </div>
  );
};

export default AircraftCard;
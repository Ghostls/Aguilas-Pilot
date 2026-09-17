// src/components/AircraftDetail.tsx
// VALKYRON OS v3.2 — Detalle de Aeronave + Historial Técnico Imprimible
//
// CHANGELOG v3.2:
//   [NEW] Botón "Imprimir Historial"
//   [NEW] Consulta TODAS las órdenes de trabajo de la aeronave
//   [NEW] El documento incluye el detalle completo almacenado en cada tarjeta de servicio
//   [NEW] Incluye campos dinámicos adicionales de ordenes_trabajo
//   [NEW] Formato A4 optimizado para impresión
//   [FIX] escapeHtml movido a scope global del archivo
//
// v3.1 PRESERVADO:
//   [NEW] Botón "✓ Completar Orden"
//   [NEW] Modal de cierre pide observaciones finales + horas de vuelo actuales
//   [NEW] Al completar: OT → 'Completed', flota → 'operational', horas actualizadas
//   [NEW] Botón directo "📜 Ver Historial"
//   [FIX] hoursFlown → hours_vuelo_totales
//
// v3.0 PRESERVADO:
//   fetch de última orden
//   edición estado In Progress/Pending Parts
//   dashboard TSN/TSMOH/TSOH
//   telemetría de motor
//   CRUD existente
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Aircraft } from '../Types/Maintenance';

import {
  ArrowLeft,
  Plane,
  Wrench,
  Loader2,
  Cpu,
  AlertTriangle,
  Clock,
  Signal,
  HardDrive,
  Save,
  AlertCircle,
  CheckCircle2,
  History,
  X,
  Printer,
} from 'lucide-react';

interface AircraftDetailProps {
  aircraft: Aircraft;
  onBack: () => void;
  onOpenHistorial?: (aircraft: Aircraft) => void;
}

type OrderRecord = {
  id: string;
  descripcion_tarea: string;
  nombre_mecanico: string;
  estado: string;
  observaciones: string;
  created_at: string;
};

// ─────────────────────────────────────────────────────────────
// HELPER GLOBAL
// Escapa valores antes de insertarlos en HTML de impresión.
// Debe estar fuera de handlePrintHistory para poder utilizarse
// tanto en try como en catch.
// ─────────────────────────────────────────────────────────────

const escapeHtml = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '—';
  }

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// ─────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────

const AircraftDetail = ({
  aircraft,
  onBack,
  onOpenHistorial,
}: AircraftDetailProps) => {
  const [orderRecord, setOrderRecord] =
    useState<OrderRecord | null>(null);

  const [status, setStatus] =
    useState('In Progress');

  const [notes, setNotes] =
    useState('');

  const [isSaving, setIsSaving] =
    useState(false);

  const [isFetching, setIsFetching] =
    useState(true);

  const [errorMsg, setErrorMsg] =
    useState<string | null>(null);

  const [successMsg, setSuccessMsg] =
    useState(false);

  // ─────────────────────────────────────────────────────────────
  // MODAL DE CIERRE
  // ─────────────────────────────────────────────────────────────

  const [isCompleteOpen, setIsCompleteOpen] =
    useState(false);

  const [completeForm, setCompleteForm] = useState({
    observacionesFinales: '',
    horasActuales: '',
    mecanicoCierre: '',
  });

  const isMaintenance =
    aircraft.status === 'maintenance';

  // ─────────────────────────────────────────────────────────────
  // FETCH: ÚLTIMA ORDEN ACTIVA
  // ─────────────────────────────────────────────────────────────

  const fetchLatestOrder = useCallback(async () => {
    if (!isMaintenance) {
      setIsFetching(false);
      return;
    }

    setIsFetching(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select(
          'id, descripcion_tarea, nombre_mecanico, estado, observaciones, created_at'
        )
        .eq('matricula', aircraft.tailNumber)
        .in('estado', [
          'In Progress',
          'Pending Parts',
          'On Hold',
        ])
        .order('created_at', {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        setOrderRecord(data as OrderRecord);

        setStatus(
          data.estado || 'In Progress'
        );

        setNotes(
          data.observaciones || ''
        );
      } else {
        setOrderRecord(null);
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message ??
          'Error al cargar la orden.'
      );
    } finally {
      setIsFetching(false);
    }
  }, [
    aircraft.tailNumber,
    isMaintenance,
  ]);

  useEffect(() => {
    fetchLatestOrder();
  }, [fetchLatestOrder]);

  // ─────────────────────────────────────────────────────────────
  // PRE-LLENAR HORAS AL ABRIR MODAL
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (
      isCompleteOpen &&
      orderRecord
    ) {
      setCompleteForm((prev) => ({
        ...prev,
        horasActuales: String(
          aircraft.hours_vuelo_totales ?? 0
        ),
        mecanicoCierre:
          orderRecord.nombre_mecanico ?? '',
      }));
    }
  }, [
    isCompleteOpen,
    orderRecord,
    aircraft.hours_vuelo_totales,
  ]);

  // ─────────────────────────────────────────────────────────────
  // ACTUALIZAR ORDEN
  // ─────────────────────────────────────────────────────────────

  const handleUpdate = async (
    e: React.FormEvent
  ) => {
    e.preventDefault();

    if (!orderRecord) {
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({
          estado: status,
          observaciones: notes,
        })
        .eq('id', orderRecord.id);

      if (error) {
        throw error;
      }

      setOrderRecord({
        ...orderRecord,
        estado: status,
        observaciones: notes,
      });

      setSuccessMsg(true);

      setTimeout(() => {
        setSuccessMsg(false);
      }, 2500);
    } catch (err: any) {
      setErrorMsg(
        err?.message ??
          'Error al actualizar.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // COMPLETAR ORDEN
  // ─────────────────────────────────────────────────────────────

  const handleCompleteOrder = async (
    e: React.FormEvent
  ) => {
    e.preventDefault();

    if (!orderRecord) {
      return;
    }

    const horas = parseFloat(
      completeForm.horasActuales
    );

    if (
      Number.isNaN(horas) ||
      horas < 0
    ) {
      alert(
        'Horas de aeronave inválidas.'
      );
      return;
    }

    if (
      !completeForm.observacionesFinales.trim()
    ) {
      alert(
        'Debe registrar las observaciones finales del cierre.'
      );
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      const timestamp =
        new Date().toLocaleString(
          'es-VE',
          {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }
        );

      const obsPrevias =
        orderRecord.observaciones ?? '';

      const obsFinal =
        `${obsPrevias}\n` +
        `[${timestamp}] CIERRE DE ORDEN por ` +
        `${
          completeForm.mecanicoCierre
            .toUpperCase() || 'N/A'
        } ` +
        `@ ${horas}h TT: ` +
        `${completeForm.observacionesFinales
          .trim()
          .toUpperCase()}`;

      // 1. COMPLETAR ORDEN
      const {
        error: ordenError,
      } = await supabase
        .from('ordenes_trabajo')
        .update({
          estado: 'Completed',
          observaciones: obsFinal,
          nombre_mecanico:
            completeForm.mecanicoCierre.trim() ||
            orderRecord.nombre_mecanico,
        })
        .eq(
          'id',
          orderRecord.id
        );

      if (ordenError) {
        throw ordenError;
      }

      // 2. LIBERAR AERONAVE
      const {
        error: flotaError,
      } = await supabase
        .from('flota_aviones')
        .update({
          estado: 'operational',
          horas_vuelo_totales: horas,
        })
        .eq(
          'matricula',
          aircraft.tailNumber
        );

      if (flotaError) {
        console.warn(
          '[v3.2] No se pudo liberar aeronave:',
          flotaError.message
        );
      }

      setIsCompleteOpen(false);

      alert(
        `✓ Orden completada exitosamente\n\n` +
        `La aeronave ${aircraft.tailNumber} ha sido liberada a OPERATIVA.\n` +
        `El registro aparecerá en el Historial de la aeronave.`
      );

      onBack();
    } catch (err: any) {
      setErrorMsg(
        err?.message ??
          'Error al completar la orden.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // IMPRIMIR HISTORIAL COMPLETO
  // ─────────────────────────────────────────────────────────────

  const handlePrintHistory = async () => {
    const printWindow =
      window.open(
        '',
        '_blank',
        'width=1200,height=900'
      );

    if (!printWindow) {
      alert(
        'El navegador bloqueó la ventana de impresión. ' +
        'Permite ventanas emergentes para ValkyrON OS.'
      );
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />

        <title>
          Historial Técnico - ${escapeHtml(
            aircraft.tailNumber
          )}
        </title>

        <style>

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #111827;
            font-family:
              Arial,
              Helvetica,
              sans-serif;
          }

          body {
            padding: 35px;
            font-size: 12px;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 30px;

            border-bottom: 3px solid #111827;

            padding-bottom: 18px;
            margin-bottom: 25px;
          }

          .brand {
            font-size: 27px;
            font-weight: 900;
            letter-spacing: 3px;
          }

          .subtitle {
            color: #6b7280;
            font-size: 10px;
            margin-top: 5px;
            letter-spacing: 1px;
          }

          .document-title {
            font-size: 12px;
            font-weight: 900;
            text-align: right;
            letter-spacing: 1px;
          }

          .aircraft-data {
            display: grid;
            grid-template-columns:
              repeat(4, minmax(0, 1fr));

            gap: 12px;
            margin-bottom: 28px;
          }

          .data-box {
            border: 1px solid #d1d5db;
            border-radius: 7px;
            padding: 12px;
            min-height: 65px;
          }

          .label {
            color: #6b7280;
            font-size: 8px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 7px;
          }

          .value {
            font-size: 14px;
            font-weight: 900;
            overflow-wrap: anywhere;
          }

          .section-title {
            font-size: 17px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 1px;

            border-bottom: 2px solid #111827;

            padding-bottom: 8px;
            margin-top: 28px;
            margin-bottom: 18px;
          }

          .service-card {
            border: 1px solid #9ca3af;
            border-radius: 8px;

            padding: 18px;

            margin-bottom: 18px;

            page-break-inside: avoid;
            break-inside: avoid;
          }

          .service-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;

            gap: 20px;

            border-bottom: 1px solid #d1d5db;

            padding-bottom: 12px;
            margin-bottom: 14px;
          }

          .service-number {
            color: #6b7280;

            font-size: 8px;
            font-weight: 900;

            text-transform: uppercase;
            letter-spacing: 1px;

            margin-bottom: 5px;
          }

          .service-title {
            font-size: 15px;
            font-weight: 900;

            line-height: 1.35;

            overflow-wrap: anywhere;
          }

          .service-status {
            border: 1px solid #9ca3af;

            border-radius: 5px;

            padding: 6px 9px;

            font-size: 9px;
            font-weight: 900;

            text-transform: uppercase;

            white-space: nowrap;
          }

          .fields {
            display: grid;

            grid-template-columns:
              repeat(2, minmax(0, 1fr));

            gap: 12px;
          }

          .field {
            border-bottom: 1px solid #e5e7eb;

            padding-bottom: 9px;

            min-width: 0;
          }

          .field.full {
            grid-column: 1 / -1;
          }

          .field-value {
            white-space: pre-wrap;

            line-height: 1.55;

            overflow-wrap: anywhere;

            word-break: break-word;
          }

          .empty-history {
            border: 1px solid #d1d5db;

            border-radius: 8px;

            padding: 30px;

            text-align: center;

            color: #6b7280;

            font-weight: bold;
          }

          .footer {
            margin-top: 30px;

            padding-top: 12px;

            border-top: 1px solid #d1d5db;

            display: flex;
            justify-content: space-between;

            gap: 20px;

            color: #6b7280;

            font-size: 9px;
          }

          @media print {

            body {
              padding: 10px;
            }

            .service-card {
              page-break-inside: avoid;
              break-inside: avoid;
            }

            @page {
              size: A4;
              margin: 12mm;
            }

          }

        </style>
      </head>

      <body>

        <div id="content">

          <div
            style="
              text-align:center;
              padding:60px;
              font-family:Arial;
            "
          >
            CARGANDO HISTORIAL TÉCNICO...
          </div>

        </div>

      </body>
      </html>
    `);

    printWindow.document.close();

    try {
      // ─────────────────────────────────────────────────────────
      // OBTENER TODAS LAS ÓRDENES
      // ─────────────────────────────────────────────────────────

      const {
        data,
        error,
      } = await supabase
        .from('ordenes_trabajo')
        .select('*')
        .eq(
          'matricula',
          aircraft.tailNumber
        )
        .order('created_at', {
          ascending: false,
        });

      if (error) {
        throw error;
      }

      const orders =
        (data ?? []) as Record<
          string,
          unknown
        >[];

      // ─────────────────────────────────────────────────────────
      // FORMATEAR VALORES
      // ─────────────────────────────────────────────────────────

      const formatValue = (
        value: unknown
      ): string => {
        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {
          return '—';
        }

        if (
          typeof value === 'object'
        ) {
          try {
            return JSON.stringify(
              value,
              null,
              2
            );
          } catch {
            return String(value);
          }
        }

        return String(value);
      };

      // ─────────────────────────────────────────────────────────
      // FORMATEAR FECHAS
      // ─────────────────────────────────────────────────────────

      const formatDate = (
        value: unknown
      ): string => {
        if (!value) {
          return '—';
        }

        const date =
          new Date(String(value));

        if (
          Number.isNaN(
            date.getTime()
          )
        ) {
          return String(value);
        }

        return date.toLocaleString(
          'es-VE',
          {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }
        );
      };

      // ─────────────────────────────────────────────────────────
      // CAMPOS EXCLUIDOS
      // ─────────────────────────────────────────────────────────

      const excludedFields =
        new Set([
          'id',
          'matricula',
          'created_at',
          'updated_at',
        ]);

      // ─────────────────────────────────────────────────────────
      // ORDEN DE CAMPOS CONOCIDOS
      // ─────────────────────────────────────────────────────────

      const preferredOrder = [
        'descripcion_tarea',
        'tipo_mantenimiento',
        'estado',

        'nombre_mecanico',
        'tecnico',
        'mecanico',
        'inspector',

        'fecha_inicio',
        'fecha_fin',
        'fecha_cierre',

        'horas_aeronave',
        'horas_vuelo',
        'horas_vuelo_totales',

        'observaciones',
        'observaciones_finales',

        'trabajo_realizado',
        'repuestos',
        'repuestos_instalados',

        'pruebas_ejecutadas',
        'pruebas',

        'certificacion',
        'certificacion_final',
      ];

      // ─────────────────────────────────────────────────────────
      // ETIQUETAS HUMANAS
      // ─────────────────────────────────────────────────────────

      const getFieldLabel = (
        field: string
      ): string => {
        const labels: Record<
          string,
          string
        > = {
          descripcion_tarea:
            'Descripción de la tarea',

          tipo_mantenimiento:
            'Tipo de mantenimiento',

          estado:
            'Estado',

          nombre_mecanico:
            'Mecánico asignado',

          tecnico:
            'Técnico',

          mecanico:
            'Mecánico',

          inspector:
            'Inspector',

          fecha_inicio:
            'Fecha de inicio',

          fecha_fin:
            'Fecha de finalización',

          fecha_cierre:
            'Fecha de cierre',

          horas_aeronave:
            'Horas de aeronave',

          horas_vuelo:
            'Horas de vuelo',

          horas_vuelo_totales:
            'Horas totales de vuelo',

          observaciones:
            'Observaciones',

          observaciones_finales:
            'Observaciones finales',

          trabajo_realizado:
            'Trabajo realizado',

          repuestos:
            'Repuestos',

          repuestos_instalados:
            'Repuestos instalados',

          pruebas_ejecutadas:
            'Pruebas ejecutadas',

          pruebas:
            'Pruebas',

          certificacion:
            'Certificación',

          certificacion_final:
            'Certificación final',
        };

        if (labels[field]) {
          return labels[field];
        }

        return field
          .replace(/_/g, ' ')
          .replace(
            /\b\w/g,
            (char) =>
              char.toUpperCase()
          );
      };

      // ─────────────────────────────────────────────────────────
      // FULL WIDTH
      // ─────────────────────────────────────────────────────────

      const isFullWidthField = (
        field: string
      ): boolean => {
        const normalized =
          field.toLowerCase();

        return (
          normalized.includes(
            'observ'
          ) ||
          normalized.includes(
            'repuesto'
          ) ||
          normalized.includes(
            'trabajo'
          ) ||
          normalized.includes(
            'prueba'
          ) ||
          normalized.includes(
            'certific'
          ) ||
          normalized.includes(
            'detalle'
          ) ||
          normalized.includes(
            'descripcion'
          ) ||
          normalized.includes(
            'comentario'
          ) ||
          normalized.includes(
            'nota'
          )
        );
      };

      // ─────────────────────────────────────────────────────────
      // RENDER CAMPO
      // ─────────────────────────────────────────────────────────

      const renderField = (
        field: string,
        value: unknown
      ): string => {
        let renderedValue =
          formatValue(value);

        const normalized =
          field.toLowerCase();

        if (
          normalized.includes(
            'fecha'
          )
        ) {
          renderedValue =
            formatDate(value);
        }

        const fullWidth =
          isFullWidthField(field);

        return `
          <div class="field ${
            fullWidth ? 'full' : ''
          }">

            <div class="label">
              ${escapeHtml(
                getFieldLabel(field)
              )}
            </div>

            <div class="field-value">
              ${escapeHtml(
                renderedValue
              )}
            </div>

          </div>
        `;
      };

      // ─────────────────────────────────────────────────────────
      // RENDER ORDEN COMPLETA
      // ─────────────────────────────────────────────────────────

      const renderOrder = (
        order: Record<
          string,
          unknown
        >,
        index: number
      ): string => {
        const allFields =
          Object.keys(order).filter(
            (field) =>
              !excludedFields.has(
                field
              )
          );

        const orderedFields = [
          ...preferredOrder.filter(
            (field) =>
              allFields.includes(
                field
              )
          ),

          ...allFields.filter(
            (field) =>
              !preferredOrder.includes(
                field
              )
          ),
        ];

        const title =
          order.descripcion_tarea ||
          order.tipo_mantenimiento ||
          `Orden de Servicio #${
            index + 1
          }`;

        const status =
          order.estado ||
          'Sin estado';

        const fieldsHtml =
          orderedFields
            .map((field) =>
              renderField(
                field,
                order[field]
              )
            )
            .join('');

        return `
          <div class="service-card">

            <div class="service-header">

              <div>

                <div class="service-number">
                  TARJETA DE SERVICIO /
                  ORDEN DE TRABAJO #${
                    index + 1
                  }
                </div>

                <div class="service-title">
                  ${escapeHtml(title)}
                </div>

              </div>

              <div class="service-status">
                ${escapeHtml(status)}
              </div>

            </div>

            <div class="fields">
              ${fieldsHtml}
            </div>

          </div>
        `;
      };

      // ─────────────────────────────────────────────────────────
      // ESTADO AERONAVE
      // ─────────────────────────────────────────────────────────

      const aircraftStatus =
        aircraft.status ===
        'maintenance'
          ? 'EN MANTENIMIENTO'
          : 'OPERATIVA';

      // ─────────────────────────────────────────────────────────
      // DOCUMENTO FINAL
      // ─────────────────────────────────────────────────────────

      const content = `

        <div class="header">

          <div>

            <div class="brand">
              VALKYRON OS
            </div>

            <div class="subtitle">
              SISTEMA DE GESTIÓN Y MANTENIMIENTO
              DE AERONAVES
            </div>

            <div class="subtitle">
              HISTORIAL TÉCNICO COMPLETO
            </div>

          </div>

          <div>

            <div class="document-title">
              DOCUMENTO TÉCNICO
            </div>

            <div
              class="subtitle"
              style="text-align:right;"
            >
              GENERADO:
              ${escapeHtml(
                formatDate(
                  new Date().toISOString()
                )
              )}
            </div>

          </div>

        </div>

        <div class="aircraft-data">

          <div class="data-box">

            <div class="label">
              Matrícula
            </div>

            <div class="value">
              ${escapeHtml(
                aircraft.tailNumber
              )}
            </div>

          </div>

          <div class="data-box">

            <div class="label">
              Modelo
            </div>

            <div class="value">
              ${escapeHtml(
                aircraft.model
              )}
            </div>

          </div>

          <div class="data-box">

            <div class="label">
              Estado actual
            </div>

            <div class="value">
              ${escapeHtml(
                aircraftStatus
              )}
            </div>

          </div>

          <div class="data-box">

            <div class="label">
              Horas totales
            </div>

            <div class="value">
              ${escapeHtml(
                aircraft.hours_vuelo_totales ??
                  0
              )} h
            </div>

          </div>

        </div>

        <div class="section-title">
          Historial completo de mantenimiento
        </div>

        ${
          orders.length === 0
            ? `
              <div class="empty-history">
                NO EXISTEN ÓRDENES DE TRABAJO
                REGISTRADAS PARA ESTA AERONAVE.
              </div>
            `
            : orders
                .map(
                  (
                    order,
                    index
                  ) =>
                    renderOrder(
                      order,
                      index
                    )
                )
                .join('')
        }

        <div class="footer">

          <span>
            VALKYRON OS — Registro técnico
            de aeronave
          </span>

          <span>
            MATRÍCULA:
            ${escapeHtml(
              aircraft.tailNumber
            )}
            |
            REGISTROS:
            ${orders.length}
          </span>

        </div>
      `;

      const contentElement =
        printWindow.document.getElementById(
          'content'
        );

      if (contentElement) {
        contentElement.innerHTML =
          content;
      }

      // ─────────────────────────────────────────────────────────
      // ABRIR DIÁLOGO DE IMPRESIÓN
      // ─────────────────────────────────────────────────────────

      setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (printError) {
          console.error(
            '[v3.2] Error al abrir impresión:',
            printError
          );
        }
      }, 500);

    } catch (err: any) {
      const message =
        err?.message ??
        'Error desconocido al cargar el historial.';

      const contentElement =
        printWindow.document.getElementById(
          'content'
        );

      if (contentElement) {
        contentElement.innerHTML = `
          <div
            style="
              font-family:Arial;
              color:#b91c1c;
              padding:40px;
            "
          >

            <h2>
              ERROR AL CARGAR EL HISTORIAL
            </h2>

            <p>
              ${escapeHtml(message)}
            </p>

          </div>
        `;
      }

      console.error(
        '[v3.2] Error al imprimir historial:',
        err
      );
    }
  };

  // ─────────────────────────────────────────────────────────────
  // ESTADO
  // ─────────────────────────────────────────────────────────────

  const isCompleted =
    orderRecord?.estado ===
    'Completed';

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 min-h-screen text-white animate-in fade-in duration-500">

      {/* HEADER */}

      <div className="flex justify-between items-center mb-8">

        <button
          onClick={onBack}
          className="
            text-gray-400
            flex
            items-center
            gap-2
            hover:text-[#E1AD01]
            transition-colors
            group
          "
        >
          <ArrowLeft
            className="
              h-4 w-4
              group-hover:-translate-x-1
              transition-transform
            "
          />

          <span
            className="
              text-[10px]
              font-black
              uppercase
              tracking-[0.3em]
              italic
            "
          >
            Volver al Dashboard
          </span>
        </button>

        {/* ACCIONES */}

        <div className="flex items-center gap-2 flex-wrap justify-end">

          {/* VER HISTORIAL */}

          {onOpenHistorial && (
            <button
              onClick={() =>
                onOpenHistorial(
                  aircraft
                )
              }
              className="
                bg-[#E1AD01]/10
                border
                border-[#E1AD01]/30
                text-[#E1AD01]
                px-4
                py-2
                rounded-xl
                text-[9px]
                font-black
                uppercase
                tracking-widest
                hover:bg-[#E1AD01]
                hover:text-black
                transition-all
                flex
                items-center
                gap-2
              "
            >
              <History className="h-3.5 w-3.5" />
              Ver Historial
            </button>
          )}

          {/* IMPRIMIR HISTORIAL */}

          <button
            onClick={
              handlePrintHistory
            }
            className="
              bg-white/[0.04]
              border
              border-white/15
              text-white
              px-4
              py-2
              rounded-xl
              text-[9px]
              font-black
              uppercase
              tracking-widest
              hover:bg-white
              hover:text-black
              transition-all
              flex
              items-center
              gap-2
            "
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir Historial
          </button>

          <div
            className="
              text-[8px]
              font-black
              text-slate-500
              uppercase
              tracking-widest
              bg-black/30
              px-3
              py-1.5
              rounded-full
            "
          >
            ID: {aircraft.tailNumber}
          </div>

        </div>
      </div>

      {/* HERO */}

      <div
        className="
          mb-8
          p-8
          bg-black/30
          border
          border-white/10
          rounded-3xl
          relative
          overflow-hidden
          shadow-2xl
        "
      >

        <Plane
          className="
            absolute
            -right-4
            -bottom-4
            h-40
            w-40
            text-white/[0.02]
          "
        />

        <div
          className="
            relative
            flex
            justify-between
            items-end
            flex-wrap
            gap-4
          "
        >

          <div>

            <p
              className="
                text-[10px]
                text-[#E1AD01]
                font-black
                uppercase
                tracking-[0.3em]
                mb-2
              "
            >
              Diagnóstico de Aeronave
            </p>

            <h2
              className="
                text-5xl
                font-black
                text-white
                leading-none
                italic
              "
            >
              {aircraft.model}
            </h2>

            <p
              className="
                text-[10px]
                text-slate-500
                font-black
                mt-3
                uppercase
                tracking-widest
              "
            >
              {aircraft.tailNumber}
              {' | '}
              Rol Táctico:{' '}

              <span className="text-white/70">
                {isMaintenance
                  ? 'Hangar'
                  : 'Operativa'}
              </span>
            </p>

          </div>

          <div
            className={`
              p-4
              rounded-2xl
              border-2
              ${
                isMaintenance
                  ? `
                    bg-red-500/10
                    border-red-500
                    shadow-red-500/20
                    shadow-lg
                  `
                  : `
                    bg-emerald-500/10
                    border-emerald-500
                    shadow-emerald-500/20
                    shadow-lg
                  `
              }
            `}
          >

            <p
              className={`
                text-[10px]
                font-black
                uppercase
                tracking-widest
                italic
                ${
                  isMaintenance
                    ? 'text-red-400'
                    : 'text-emerald-400'
                }
              `}
            >
              {isMaintenance
                ? '/// EN HANGAR'
                : '✓ LISTA VUELO'}
            </p>

          </div>

        </div>
      </div>

      {/* DASHBOARD */}

      <div
        className="
          grid
          grid-cols-1
          md:grid-cols-3
          gap-6
          mb-8
        "
      >

        <MetricCard
          label="Time Since New"
          value={`${aircraft.hours_vuelo_totales ?? 0} h`}
          icon={Clock}
          color="#E1AD01"
        />

        <MetricCard
          label="TSMOH"
          value="1580 h"
          icon={Wrench}
          color="#E1AD01"
        />

        <MetricCard
          label="TSOH"
          value="120 h"
          icon={HardDrive}
          color="#E1AD01"
        />

      </div>

      {/* TELEMETRÍA MOTOR */}

      <div
        className="
          bg-white/[0.03]
          p-6
          rounded-3xl
          border
          border-white/10
          mb-8
          shadow-xl
        "
      >

        <p
          className="
            text-[10px]
            text-[#E1AD01]
            font-black
            mb-6
            uppercase
            tracking-[0.3em]
            italic
            flex
            items-center
            gap-2
          "
        >
          <Cpu className="h-3 w-3" />
          Módulo de Análisis Predictivo Motor
        </p>

        <div
          className="
            grid
            grid-cols-2
            md:grid-cols-4
            gap-6
          "
        >

          <TelemetryDot
            label="Estado Motor"
            value="NORMAL"
            tone="ok"
            pulse
          />

          <TelemetryDot
            label="Vibración"
            value="0.15 IPS"
            tone="ok"
          />

          <TelemetryDot
            label="Temp Aceite"
            value="180°F"
            tone="ok"
          />

          <TelemetryDot
            label="Alerta Proactiva"
            value="NINGUNA"
            tone="ok"
          />

        </div>
      </div>

      {/* PANEL ORDEN ACTIVA */}

      {isMaintenance && (
        <div
          className="
            p-8
            bg-red-950/20
            rounded-3xl
            border-2
            border-red-900/50
            space-y-4
            shadow-2xl
            shadow-red-500/10
          "
        >

          <p
            className="
              text-[11px]
              text-red-400
              font-black
              uppercase
              tracking-widest
              italic
              flex
              items-center
              gap-3
            "
          >
            <AlertTriangle
              className="
                h-4 w-4
                animate-pulse
              "
            />

            Panel de Orden de Trabajo Activa
          </p>

          {isFetching ? (

            <div
              className="
                flex
                items-center
                justify-center
                gap-3
                py-6
                text-slate-500
              "
            >

              <Loader2
                className="
                  h-4 w-4
                  animate-spin
                "
              />

              <span
                className="
                  text-[9px]
                  font-black
                  uppercase
                  tracking-widest
                "
              >
                Sincronizando con MRO...
              </span>

            </div>

          ) : errorMsg &&
            !orderRecord ? (

            <FeedbackBanner
              tone="error"
              text={errorMsg}
              onClose={() =>
                setErrorMsg(null)
              }
            />

          ) : orderRecord ? (

            <>

              <div
                className="
                  grid
                  grid-cols-1
                  md:grid-cols-2
                  gap-4
                  p-4
                  bg-black/40
                  border
                  border-white/5
                  rounded-2xl
                "
              >

                <div>

                  <p
                    className="
                      text-[8px]
                      text-slate-500
                      font-black
                      uppercase
                      tracking-widest
                    "
                  >
                    Tarea
                  </p>

                  <p
                    className="
                      text-[11px]
                      text-white
                      font-black
                      uppercase
                      mt-1
                    "
                  >
                    {orderRecord.descripcion_tarea}
                  </p>

                </div>

                <div>

                  <p
                    className="
                      text-[8px]
                      text-slate-500
                      font-black
                      uppercase
                      tracking-widest
                    "
                  >
                    Técnico Asignado
                  </p>

                  <p
                    className="
                      text-[11px]
                      text-white
                      font-black
                      uppercase
                      mt-1
                    "
                  >
                    {orderRecord.nombre_mecanico}
                  </p>

                </div>

              </div>

              <form
                onSubmit={handleUpdate}
                className="space-y-4"
              >

                <div
                  className="
                    grid
                    grid-cols-1
                    md:grid-cols-2
                    gap-4
                  "
                >

                  <div className="space-y-2">

                    <label
                      className="
                        text-[9px]
                        font-black
                        text-[#E1AD01]
                        uppercase
                        tracking-widest
                        block
                      "
                    >
                      Estado de la Orden
                    </label>

                    <select
                      value={status}
                      onChange={(e) =>
                        setStatus(
                          e.target.value
                        )
                      }
                      className="
                        w-full
                        bg-black
                        border
                        border-white/10
                        p-4
                        rounded-xl
                        text-white
                        text-xs
                        font-black
                        outline-none
                        focus:border-[#E1AD01]
                        transition-all
                      "
                    >

                      <option value="In Progress">
                        EN PROGRESO
                      </option>

                      <option value="Pending Parts">
                        ESPERANDO REPUESTOS
                      </option>

                      <option value="On Hold">
                        EN ESPERA
                      </option>

                    </select>

                    <p
                      className="
                        text-[8px]
                        text-slate-500
                        font-mono
                      "
                    >
                      Para{' '}
                      <span
                        className="
                          text-[#E1AD01]
                          font-black
                        "
                      >
                        completar
                      </span>{' '}
                      usa el botón dedicado abajo.
                    </p>

                  </div>

                </div>

                <div className="space-y-2">

                  <label
                    className="
                      text-[9px]
                      font-black
                      text-[#E1AD01]
                      uppercase
                      tracking-widest
                      block
                    "
                  >
                    Observaciones / Notas de Progreso
                  </label>

                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) =>
                      setNotes(
                        e.target.value
                      )
                    }
                    placeholder="AVANCES, DIAGNÓSTICO, REPUESTOS PEDIDOS..."
                    className="
                      w-full
                      bg-black
                      border
                      border-white/10
                      p-4
                      rounded-xl
                      text-white
                      text-xs
                      resize-none
                      outline-none
                      focus:border-[#E1AD01]
                      transition-all
                      placeholder:text-white/20
                      uppercase
                      font-mono
                    "
                  />

                </div>

                {errorMsg && (
                  <FeedbackBanner
                    tone="error"
                    text={errorMsg}
                    onClose={() =>
                      setErrorMsg(null)
                    }
                  />
                )}

                {successMsg && (
                  <FeedbackBanner
                    tone="success"
                    text="Orden actualizada correctamente."
                  />
                )}

                <div
                  className="
                    flex
                    gap-3
                    pt-2
                  "
                >

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="
                      flex-1
                      py-4
                      rounded-2xl
                      bg-[#E1AD01]
                      text-black
                      text-[10px]
                      font-black
                      uppercase
                      tracking-widest
                      hover:bg-white
                      transition-all
                      disabled:opacity-40
                      flex
                      items-center
                      justify-center
                      gap-2
                    "
                  >

                    {isSaving ? (
                      <Loader2
                        className="
                          h-4 w-4
                          animate-spin
                        "
                      />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}

                    {isSaving
                      ? 'Guardando...'
                      : 'Guardar Progreso'}

                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setIsCompleteOpen(true)
                    }
                    disabled={
                      isSaving ||
                      isCompleted
                    }
                    className="
                      flex-1
                      py-4
                      rounded-2xl
                      bg-emerald-500
                      text-black
                      text-[10px]
                      font-black
                      uppercase
                      tracking-widest
                      hover:bg-emerald-400
                      transition-all
                      disabled:opacity-40
                      flex
                      items-center
                      justify-center
                      gap-2
                      shadow-lg
                      shadow-emerald-500/20
                    "
                  >

                    <CheckCircle2
                      className="h-4 w-4"
                    />

                    Completar Orden

                  </button>

                </div>

              </form>

            </>

          ) : (

            <div
              className="
                text-center
                py-10
                bg-black/40
                rounded-2xl
                border
                border-white/5
              "
            >

              <p
                className="
                  text-[10px]
                  text-slate-500
                  font-black
                  uppercase
                  tracking-widest
                "
              >
                Sin órdenes activas
              </p>

              <p
                className="
                  text-[9px]
                  text-slate-700
                  mt-2
                  font-mono
                "
              >
                La aeronave está en mantenimiento
                sin OT abierta. Crea una desde
                el Control Hub.
              </p>

            </div>

          )}

        </div>
      )}

      {/* MODAL CIERRE */}

      {isCompleteOpen &&
        orderRecord && (

          <div
            className="
              fixed
              inset-0
              z-[70]
              flex
              items-center
              justify-center
              bg-black/98
              backdrop-blur-xl
              p-4
              animate-in
              fade-in
              duration-200
            "
          >

            <div
              className="
                bg-[#0a0a0a]
                border
                border-emerald-500/40
                w-full
                max-w-lg
                rounded-[2.5rem]
                shadow-[0_0_80px_rgba(16,185,129,0.15)]
                overflow-hidden
              "
            >

              <div
                className="
                  bg-emerald-500/10
                  border-b
                  border-emerald-500/20
                  px-7
                  py-5
                  flex
                  items-center
                  justify-between
                "
              >

                <div
                  className="
                    flex
                    items-center
                    gap-4
                  "
                >

                  <div
                    className="
                      w-11
                      h-11
                      rounded-xl
                      bg-emerald-500
                      flex
                      items-center
                      justify-center
                      shrink-0
                    "
                  >

                    <CheckCircle2
                      size={20}
                      className="text-black"
                    />

                  </div>

                  <div>

                    <p
                      className="
                        text-[12px]
                        font-black
                        text-white
                        uppercase
                        tracking-wider
                      "
                    >
                      Cerrar Orden de Trabajo
                    </p>

                    <p
                      className="
                        text-[9px]
                        text-emerald-400/70
                        font-mono
                        uppercase
                        tracking-widest
                        mt-0.5
                      "
                    >
                      {aircraft.tailNumber}
                      {' · '}
                      {aircraft.model}
                    </p>

                  </div>

                </div>

                <button
                  type="button"
                  onClick={() =>
                    setIsCompleteOpen(false)
                  }
                  className="
                    text-zinc-600
                    hover:text-white
                    hover:rotate-90
                    transition-all
                  "
                >
                  <X size={20} />
                </button>

              </div>

              <form
                onSubmit={
                  handleCompleteOrder
                }
                className="
                  p-7
                  space-y-5
                  font-mono
                "
              >

                <div
                  className="
                    bg-white/[0.02]
                    border
                    border-white/[0.07]
                    rounded-2xl
                    p-4
                  "
                >

                  <p
                    className="
                      text-[8px]
                      text-zinc-600
                      font-black
                      uppercase
                      tracking-widest
                      mb-2
                    "
                  >
                    Tarea a Cerrar
                  </p>

                  <p
                    className="
                      text-[10px]
                      text-white
                      font-black
                      uppercase
                      leading-snug
                    "
                  >
                    {orderRecord.descripcion_tarea}
                  </p>

                </div>

                <div className="space-y-1.5">

                  <label
                    className="
                      text-[9px]
                      font-black
                      text-emerald-400
                      uppercase
                      tracking-widest
                      block
                    "
                  >
                    Mecánico / Inspector *
                  </label>

                  <input
                    required
                    className="
                      w-full
                      bg-black
                      border
                      border-emerald-500/30
                      rounded-xl
                      p-4
                      text-white
                      text-xs
                      uppercase
                      outline-none
                      focus:border-emerald-500
                      transition-all
                      placeholder:text-white/20
                      font-mono
                    "
                    placeholder="Nombre completo"
                    value={
                      completeForm.mecanicoCierre
                    }
                    onChange={(e) =>
                      setCompleteForm(
                        (prev) => ({
                          ...prev,
                          mecanicoCierre:
                            e.target.value,
                        })
                      )
                    }
                  />

                </div>

                <div className="space-y-1.5">

                  <label
                    className="
                      text-[9px]
                      font-black
                      text-[#E1AD01]
                      uppercase
                      tracking-widest
                      block
                    "
                  >
                    Horas Totales al Cierre
                    (TSN) *
                  </label>

                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    required
                    className="
                      w-full
                      bg-black
                      border
                      border-[#E1AD01]/30
                      rounded-xl
                      p-5
                      text-white
                      text-3xl
                      font-black
                      text-center
                      outline-none
                      focus:border-[#E1AD01]
                      transition-all
                      font-mono
                    "
                    placeholder="0.0"
                    value={
                      completeForm.horasActuales
                    }
                    onChange={(e) =>
                      setCompleteForm(
                        (prev) => ({
                          ...prev,
                          horasActuales:
                            e.target.value,
                        })
                      )
                    }
                  />

                  <p
                    className="
                      text-[8px]
                      text-slate-600
                      font-mono
                    "
                  >
                    Esto actualizará las horas
                    totales de la aeronave.
                  </p>

                </div>

                <div className="space-y-1.5">

                  <label
                    className="
                      text-[9px]
                      font-black
                      text-emerald-400
                      uppercase
                      tracking-widest
                      flex
                      items-center
                      gap-2
                    "
                  >
                    <Wrench size={11} />

                    Observaciones Finales *
                  </label>

                  <textarea
                    required
                    rows={4}
                    className="
                      w-full
                      bg-black
                      border
                      border-emerald-500/30
                      rounded-xl
                      p-4
                      text-white
                      text-xs
                      resize-none
                      outline-none
                      focus:border-emerald-500
                      transition-all
                      placeholder:text-white/20
                      uppercase
                      font-mono
                    "
                    placeholder="TRABAJO REALIZADO, REPUESTOS INSTALADOS, PRUEBAS EJECUTADAS, CERTIFICACIÓN FINAL..."
                    value={
                      completeForm.observacionesFinales
                    }
                    onChange={(e) =>
                      setCompleteForm(
                        (prev) => ({
                          ...prev,
                          observacionesFinales:
                            e.target.value,
                        })
                      )
                    }
                  />

                  <p
                    className="
                      text-[8px]
                      text-slate-600
                      font-mono
                    "
                  >
                    Se agregará con timestamp al
                    historial de la orden y aparecerá
                    en el Historial de la aeronave.
                  </p>

                </div>

                <div
                  className="
                    flex
                    items-start
                    gap-2
                    bg-emerald-500/5
                    border
                    border-emerald-500/15
                    rounded-xl
                    p-3
                  "
                >

                  <AlertCircle
                    size={13}
                    className="
                      text-emerald-400
                      shrink-0
                      mt-0.5
                    "
                  />

                  <p
                    className="
                      text-[9px]
                      text-emerald-400/80
                      leading-relaxed
                    "
                  >
                    Al confirmar: la orden pasa a{' '}
                    <span className="font-black">
                      COMPLETADA
                    </span>
                    , la aeronave se libera a{' '}
                    <span className="font-black">
                      OPERATIVA
                    </span>
                    , y el registro aparece en el
                    Timeline de la aeronave.
                  </p>

                </div>

                {errorMsg && (
                  <FeedbackBanner
                    tone="error"
                    text={errorMsg}
                    onClose={() =>
                      setErrorMsg(null)
                    }
                  />
                )}

                <div
                  className="
                    flex
                    gap-3
                    pt-1
                  "
                >

                  <button
                    type="button"
                    onClick={() =>
                      setIsCompleteOpen(false)
                    }
                    className="
                      flex-1
                      py-4
                      rounded-xl
                      border
                      border-white/10
                      text-zinc-400
                      text-[10px]
                      font-black
                      uppercase
                      hover:bg-white/5
                      transition-all
                    "
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="
                      flex-1
                      py-4
                      rounded-xl
                      bg-emerald-500
                      text-black
                      text-[10px]
                      font-black
                      uppercase
                      hover:bg-emerald-400
                      transition-all
                      disabled:opacity-40
                      flex
                      items-center
                      justify-center
                      gap-2
                      shadow-lg
                      shadow-emerald-500/20
                    "
                  >

                    {isSaving ? (
                      <Loader2
                        size={14}
                        className="animate-spin"
                      />
                    ) : (
                      <CheckCircle2
                        size={14}
                      />
                    )}

                    {isSaving
                      ? 'Cerrando...'
                      : 'Confirmar Cierre'}

                  </button>

                </div>

              </form>

            </div>

          </div>
        )}

    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MÉTRICA
// ─────────────────────────────────────────────────────────────

const MetricCard = ({
  label,
  value,
  icon: Icon,
  color,
}: any) => (
  <div
    className="
      bg-white/[0.03]
      p-6
      rounded-3xl
      border
      border-white/10
      flex
      items-center
      gap-4
      shadow-lg
    "
  >

    <Icon
      className="h-6 w-6 shrink-0"
      style={{ color }}
    />

    <div>

      <p
        className="
          text-[8px]
          text-slate-500
          font-black
          uppercase
          tracking-widest
          mb-1
        "
      >
        {label}
      </p>

      <p
        className="
          text-2xl
          text-white
          font-black
          italic
        "
      >
        {value}
      </p>

    </div>

  </div>
);

// ─────────────────────────────────────────────────────────────
// TELEMETRÍA
// ─────────────────────────────────────────────────────────────

const TelemetryDot = ({
  label,
  value,
  tone,
  pulse,
}: any) => {
  const color =
    tone === 'ok'
      ? 'text-emerald-400'
      : 'text-red-400';

  return (
    <div>

      <p
        className="
          text-[8px]
          text-slate-500
          uppercase
          font-black
          tracking-widest
        "
      >
        {label}
      </p>

      <p
        className={`
          text-white
          font-mono
          font-black
          text-lg
          flex
          items-center
          gap-2
          mt-1
          ${color}
        `}
      >

        <Signal
          className={`
            h-3 w-3
            ${pulse ? 'animate-pulse' : ''}
          `}
        />

        {value}

      </p>

    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// FEEDBACK
// ─────────────────────────────────────────────────────────────

const FeedbackBanner = ({
  tone,
  text,
  onClose,
}: {
  tone: 'error' | 'success';
  text: string;
  onClose?: () => void;
}) => (
  <div
    className={`
      flex
      items-start
      gap-3
      rounded-xl
      border
      p-3
      animate-in
      fade-in
      duration-200
      ${
        tone === 'error'
          ? `
            bg-red-500/10
            border-red-500/30
          `
          : `
            bg-emerald-500/10
            border-emerald-500/30
          `
      }
    `}
  >

    <AlertCircle
      className={`
        h-4
        w-4
        mt-0.5
        ${
          tone === 'error'
            ? 'text-red-400'
            : 'text-emerald-400'
        }
      `}
    />

    <p
      className={`
        text-[10px]
        font-mono
        flex-1
        ${
          tone === 'error'
            ? 'text-red-400'
            : 'text-emerald-400'
        }
      `}
    >
      {text}
    </p>

    {onClose && (
      <button
        type="button"
        onClick={onClose}
        className="
          text-slate-500
          hover:text-white
          transition-colors
          text-[10px]
          font-black
        "
      >
        ×
      </button>
    )}

  </div>
);

export default AircraftDetail;
// src/components/AircraftDetail.tsx
// VALKYRON OS v3.4.1 — FUSIÓN v3.2 + v3.3; FIX TS2322 LucideIcon
// v3.2: Historial técnico completo imprimible A4 con todas las órdenes,
// campos adicionales dinámicos y etiquetas humanas; UI histórico preservado.
// v3.3: Lectura en vivo del estado MRO, cierre transaccional mediante RPC,
// registro de liberación autorizada, actualización de flota y estados seguros.
// El cierre de una OT NUNCA libera por sí mismo la aeronave al servicio.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Aircraft } from '../Types/Maintenance';
import {
  ArrowLeft, Plane, Wrench, Loader2, AlertTriangle, Clock, Cpu, HardDrive, Signal,
  Save, AlertCircle, CheckCircle2, History, X, Printer, ShieldCheck, RefreshCw, type LucideIcon,
} from 'lucide-react';

interface AircraftDetailProps {
  aircraft: Aircraft;
  onBack: () => void;
  onOpenHistorial?: (aircraft: Aircraft) => void;
  onFleetChange?: () => Promise<void>;
}
type OrderRecord = {
  id: string;
  descripcion_tarea: string;
  nombre_mecanico: string;
  estado: string;
  observaciones: string;
  created_at: string;
};
type FleetRecord = {
  id: string;
  matricula: string;
  estado: string;
  horas_vuelo_totales: number | null;
};
const OPEN_STATES = ['In Progress', 'Pending Parts', 'On Hold'];
const escapeHtml = (v: unknown): string =>
  String(v === null || v === undefined || v === '' ? '—' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const formatDate = (v: unknown): string => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v ?? '—')
    : d.toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const AircraftDetail: React.FC<AircraftDetailProps> = ({ aircraft, onBack, onOpenHistorial, onFleetChange }) => {
  const [orderRecord, setOrderRecord] = useState<OrderRecord | null>(null);
  const [flotaActual, setFlotaActual] = useState<FleetRecord | null>(null);
  const [status, setStatus] = useState('In Progress');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [isReleaseOpen, setIsReleaseOpen] = useState(false);
  const [releaseForm, setReleaseForm] = useState({ referencia: '', observaciones: '' });
  const [completeForm, setCompleteForm] = useState({
    observacionesFinales: '', horasActuales: '', mecanicoCierre: '',
  });

  const matricula = aircraft.tailNumber;
  // Nunca dependemos exclusivamente del prop del dashboard, que podría estar desactualizado.
  const isMaintenance = flotaActual?.estado === 'maintenance' ||
    flotaActual?.estado === 'mantenimiento' || orderRecord !== null ||
    (!flotaActual && aircraft.status === 'maintenance');
  const isGrounded = flotaActual?.estado === 'grounded' ||
    flotaActual?.estado === 'aog';

  const fetchLatestOrder = useCallback(async () => {
    setIsFetching(true);
    setErrorMsg(null);
    try {
      const [fleetRes, orderRes] = await Promise.all([
        supabase.from('flota_aviones')
          .select('id, matricula, estado, horas_vuelo_totales')
          .eq('id', aircraft.id).single(),
        supabase.from('ordenes_trabajo')
          .select('id, descripcion_tarea, nombre_mecanico, estado, observaciones, created_at')
          .eq('matricula', matricula)
          .in('estado', OPEN_STATES)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle(),
      ]);
      if (fleetRes.error) throw fleetRes.error;
      if (orderRes.error) throw orderRes.error;
      const o = (orderRes.data ?? null) as OrderRecord | null;
      setFlotaActual(fleetRes.data as FleetRecord);
      setOrderRecord(o);
      setStatus(o?.estado || 'In Progress');
      setNotes(o?.observaciones || '');
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'No se pudieron consultar flota y órdenes.');
    } finally {
      setIsFetching(false);
    }
  }, [aircraft.id, matricula]);

  useEffect(() => { void fetchLatestOrder(); }, [fetchLatestOrder]);
  useEffect(() => {
    if (!isCompleteOpen || !orderRecord) return;
    setCompleteForm(prev => ({
      ...prev,
      horasActuales: String(flotaActual?.horas_vuelo_totales ?? aircraft.hours_vuelo_totales ?? 0),
      mecanicoCierre: orderRecord.nombre_mecanico === 'POR ASIGNAR' ? '' : (orderRecord.nombre_mecanico || ''),
    }));
  }, [isCompleteOpen, orderRecord?.id, flotaActual?.horas_vuelo_totales, aircraft.hours_vuelo_totales]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderRecord || isSaving) return;
    setIsSaving(true); setErrorMsg(null);
    try {
      const { data, error } = await supabase.from('ordenes_trabajo')
        .update({ estado: status, observaciones: notes })
        .eq('id', orderRecord.id).in('estado', OPEN_STATES)
        .select('id').single();
      if (error) throw error;
      if (!data) throw new Error('No fue posible verificar la actualización.');
      setSuccessMsg(true);
      await fetchLatestOrder();
      await onFleetChange?.();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Error al guardar el progreso.');
    } finally { setIsSaving(false); }
  };

  const handleCompleteOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderRecord || isSaving) return;
    const horas = Number(completeForm.horasActuales);
    if (!completeForm.horasActuales.trim() || !Number.isFinite(horas) || horas < 0) {
      setErrorMsg('Horas de aeronave inválidas.'); return;
    }
    if (!completeForm.observacionesFinales.trim() || !completeForm.mecanicoCierre.trim()) {
      setErrorMsg('Mecánico y observaciones finales son obligatorios.'); return;
    }
    setIsSaving(true); setErrorMsg(null);
    try {
      // RPC: la OT, historial y las horas se actualizan en UNA transacción.
      const { error } = await supabase.rpc('fn_mro_cerrar_orden', {
        p_orden_id: orderRecord.id,
        p_observaciones: completeForm.observacionesFinales.trim(),
        p_mecanico: completeForm.mecanicoCierre.trim(),
        p_horas: horas,
      });
      if (error) throw error;
      setIsCompleteOpen(false);
      await fetchLatestOrder();
      await onFleetChange?.();
      alert(`✓ Orden cerrada: ${matricula}.\n` +
        'La aeronave NO está liberada. Requiere autorización de retorno al servicio.');
      onBack();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Error al cerrar la orden.');
    } finally { setIsSaving(false); }
  };

  // El botón sólo inicia una solicitud; el RPC comprueba en servidor
  // la identidad habilitada, la ausencia de OT y registra la liberación.
  const handleRelease = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || !flotaActual || orderRecord) return;
    if (!releaseForm.referencia.trim() || !releaseForm.observaciones.trim()) {
      setErrorMsg('Referencia documental y observaciones obligatorias.');
      return;
    }
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.rpc('fn_mro_liberar_aeronave', {
        p_matricula: matricula,
        p_referencia: releaseForm.referencia.trim(),
        p_observaciones: releaseForm.observaciones.trim(),
      });
      if (error) throw error;
      setIsReleaseOpen(false);
      setReleaseForm({ referencia: '', observaciones: '' });
      await fetchLatestOrder();
      await onFleetChange?.();
      alert(`Liberación registrada en sistema para ${matricula}. Comprueba la documentación técnica.`);
      onBack();
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'No fue posible registrar la liberación.');
    } finally {
      setIsSaving(false);
    }
  };

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

      const estadoBD = flotaActual?.estado ?? aircraft.status;
      const aircraftStatus = orderRecord !== null ||
          ['maintenance', 'mantenimiento'].includes(estadoBD?.toLowerCase().trim() ?? '')
        ? 'EN MANTENIMIENTO'
        : ['operational', 'operativa'].includes(estadoBD?.toLowerCase().trim() ?? '')
        ? 'OPERATIVA EN SISTEMA'
        : ['grounded', 'aog', 'tierra'].includes(estadoBD?.toLowerCase().trim() ?? '')
        ? 'EN TIERRA / AOG'
        : ['flight', 'en vuelo'].includes(estadoBD?.toLowerCase().trim() ?? '')
        ? 'EN VUELO (REGISTRO EN SISTEMA)'
        : 'ESTADO NO VERIFICADO';

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
                flotaActual?.horas_vuelo_totales ??
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
            VALKYRON OS — Registro técnico de aeronave.
            Este documento no constituye certificación de aeronavegabilidad.
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


  const inputCls = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs uppercase
    outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 font-mono`;
  const btnCls = 'flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-40';
  const statusLabel = isFetching ? 'Sincronizando MRO' : isMaintenance ? 'EN HANGAR / MANTENIMIENTO'
    : isGrounded ? 'AOG / TIERRA' : flotaActual?.estado === 'operational' ? 'OPERATIVA EN SISTEMA'
    : (flotaActual?.estado ?? aircraft.status).toUpperCase();

  return (
    <div className="p-6 min-h-screen text-white animate-in fade-in duration-500 space-y-8">
      {/* Barra de navegación y accesos al historial completo */}
      <header className="flex justify-between items-center gap-4 flex-wrap">
        <button type="button" onClick={onBack} className="text-gray-400 flex gap-2 items-center hover:text-[#E1AD01] text-[10px] font-black uppercase tracking-widest">
          <ArrowLeft size={16}/> Volver al Dashboard
        </button>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => void fetchLatestOrder()} disabled={isFetching || isSaving}
            className={`${btnCls} border border-white/15 hover:bg-white/10`}><RefreshCw size={14}/> Actualizar</button>
          {onOpenHistorial && <button type="button" onClick={() => onOpenHistorial(aircraft)}
            className={`${btnCls} bg-[#E1AD01]/10 border border-[#E1AD01]/30 text-[#E1AD01] hover:bg-[#E1AD01] hover:text-black`}>
            <History size={14}/> Ver Historial</button>}
          <button type="button" onClick={() => void handlePrintHistory()}
            className={`${btnCls} bg-white/[0.04] border border-white/15 hover:bg-white hover:text-black`}>
            <Printer size={14}/> Imprimir Historial</button>
          <span className="text-[9px] font-mono text-slate-500 bg-black/30 p-2 rounded">ID: {matricula}</span>
        </div>
      </header>

      {/* Estado de aeronave consultado directamente de PostgreSQL */}
      <section className="p-8 bg-black/30 border border-white/10 rounded-3xl relative overflow-hidden shadow-2xl">
        <Plane size={160} className="absolute -right-5 -bottom-5 text-white/[0.025]"/>
        <div className="relative flex justify-between items-end flex-wrap gap-6">
          <div>
            <p className="text-[10px] text-[#E1AD01] font-black uppercase tracking-[0.3em] mb-2">Diagnóstico de Aeronave</p>
            <h2 className="text-5xl font-black italic">{aircraft.model}</h2>
            <p className="text-[10px] text-slate-500 font-black mt-3 uppercase tracking-widest">{matricula} · Base {aircraft.location}</p>
          </div>
          <div className={`p-4 rounded-2xl border-2 font-black text-xs flex gap-3 items-center ${isMaintenance ?
            'bg-amber-500/10 border-amber-500 text-amber-400' : isGrounded ?
            'bg-red-500/10 border-red-500 text-red-400' : 'bg-emerald-500/10 border-emerald-500 text-emerald-400'}`}>
            {isFetching ? <Loader2 className="animate-spin" size={20}/> : isMaintenance ? <Wrench size={20}/> : <Plane size={20}/>}
            {statusLabel}
          </div>
        </div>
      </section>

      {/* Métricas: solo las respaldadas por la base de datos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard label="Time Since New (TSN)" value={`${flotaActual?.horas_vuelo_totales ?? aircraft.hours_vuelo_totales ?? 0} h`} icon={Clock}/>
        <MetricCard label="Órdenes activas" value={isFetching ? 'Consultando' : orderRecord ? 'Hay OT activa' : 'Ninguna detectada'} icon={Wrench}/>
        <MetricCard label="Estado en BD" value={flotaActual?.estado ?? 'Consultando'} icon={HardDrive}/>
      </div>

      {/* Conserva el panel visual sin inventar telemetría del motor */}
      <section className="bg-white/[0.03] p-6 rounded-3xl border border-white/10 shadow-xl">
        <h3 className="text-[10px] text-[#E1AD01] font-black mb-6 uppercase tracking-[0.3em] flex gap-2 items-center">
          <Cpu size={14}/> Módulo de Análisis Predictivo Motor
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <TelemetryDot label="Estado Motor" value="SIN TELEMETRÍA"/>
          <TelemetryDot label="Vibración" value="NO DISPONIBLE"/>
          <TelemetryDot label="Temperatura de aceite" value="NO DISPONIBLE"/>
          <TelemetryDot label="Alerta predictiva" value="SIN DATOS"/>
        </div>
        <p className="text-[9px] text-slate-600 mt-5 font-mono">Estos campos requieren sensores o una fuente verificada; no representan diagnóstico técnico.</p>
      </section>

      {errorMsg && <FeedbackBanner tone="error" text={errorMsg} onClose={() => setErrorMsg(null)}/>}
      {successMsg && <FeedbackBanner tone="success" text="Orden actualizada correctamente."/>}

      {/* Panel de la última OT activa: busca aunque el dashboard tenga un estado obsoleto */}
      {isMaintenance && <section className="p-8 bg-amber-950/10 border-2 border-amber-500/30 rounded-3xl space-y-5 shadow-2xl">
        <h3 className="text-[11px] text-amber-400 font-black uppercase tracking-widest flex items-center gap-3">
          <AlertTriangle size={18}/> Panel de Orden de Trabajo Activa
        </h3>
        {isFetching ? <div className="flex items-center gap-3 py-8 text-slate-500"><Loader2 className="animate-spin"/> Sincronizando con MRO...</div>
          : orderRecord ? <>
            <div className="grid md:grid-cols-2 gap-5 p-5 bg-black/40 border border-white/5 rounded-2xl">
              <div><p className="text-[9px] text-slate-500 uppercase font-black">Tarea</p>
                <p className="text-xs text-white font-bold mt-2 whitespace-pre-line">{orderRecord.descripcion_tarea}</p></div>
              <div><p className="text-[9px] text-slate-500 uppercase font-black">Técnico asignado</p>
                <p className="text-xs text-white font-bold mt-2">{orderRecord.nombre_mecanico}</p></div>
            </div>
            <form onSubmit={handleUpdate} className="space-y-5">
              <div><label className="block mb-2 text-[10px] text-[#E1AD01] font-black uppercase">Estado de la orden</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                  <option value="In Progress">EN PROGRESO</option>
                  <option value="Pending Parts">ESPERANDO REPUESTOS</option>
                  <option value="On Hold">EN ESPERA</option>
                </select>
                <p className="text-[9px] text-slate-500 mt-2">Completar la orden requiere registrar el cierre técnico.</p>
              </div>
              <div><label className="block mb-2 text-[10px] text-[#E1AD01] font-black uppercase">Observaciones / progreso</label>
                <textarea rows={5} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="AVANCES, DIAGNÓSTICO, REPUESTOS PEDIDOS..." className={`${inputCls} resize-none`}/></div>
              <div className="flex gap-3 flex-wrap">
                <button type="submit" disabled={isSaving} className={`${btnCls} flex-1 bg-[#E1AD01] text-black hover:bg-white`}>
                  {isSaving ? <Loader2 className="animate-spin" size={14}/> : <Save size={14}/>} Guardar progreso
                </button>
                <button type="button" onClick={() => setIsCompleteOpen(true)} disabled={isSaving}
                  className={`${btnCls} flex-1 bg-emerald-500 text-black hover:bg-emerald-400`}>
                  <CheckCircle2 size={14}/> Completar Orden
                </button>
              </div>
            </form>
          </> : <div className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4">
            <p className="text-xs text-amber-400">La aeronave permanece en mantenimiento sin órdenes abiertas. No está liberada para vuelo.</p>
            <p className="text-xs text-slate-500">Si existe documentación de retorno al servicio, una persona expresamente autorizada puede registrar su liberación.</p>
            <button type="button" onClick={() => setIsReleaseOpen(true)} disabled={isSaving}
              className={`${btnCls} bg-emerald-500 text-black hover:bg-emerald-400`}><ShieldCheck size={14}/> Registrar liberación autorizada</button>
          </div>}
      </section>}

      {/* Modal de cierre: no libera automáticamente la aeronave */}
      {isCompleteOpen && orderRecord && <div className="fixed inset-0 z-[90] bg-black/95 flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-lg bg-[#0a0a0a] border border-emerald-500/40 rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-6 flex justify-between items-center">
            <div><h3 className="text-sm font-black uppercase">Cerrar orden de trabajo</h3><p className="text-[10px] text-emerald-400 mt-2">{matricula} · {aircraft.model}</p></div>
            <button type="button" onClick={() => setIsCompleteOpen(false)}><X size={20}/></button>
          </div>
          <form onSubmit={handleCompleteOrder} className="p-7 space-y-5">
            <p className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-xs text-amber-400">
              El cierre de esta orden NO autoriza el regreso al servicio de la aeronave.
            </p>
            <div className="bg-white/[0.03] border border-white/10 p-4 rounded-xl"><p className="text-[9px] text-slate-500 uppercase">Tarea</p>
              <p className="text-xs font-bold whitespace-pre-line mt-2">{orderRecord.descripcion_tarea}</p></div>
            <div><label className="block mb-2 text-[10px] text-emerald-400 font-black uppercase">Mecánico / inspector *</label>
              <input required className={inputCls} value={completeForm.mecanicoCierre}
                onChange={e => setCompleteForm(p => ({...p, mecanicoCierre:e.target.value}))}/></div>
            <div><label className="block mb-2 text-[10px] text-[#E1AD01] font-black uppercase">Horas totales al cierre (TSN) *</label>
              <input required type="number" min="0" step="0.1" className={`${inputCls} text-2xl text-center font-black`}
                value={completeForm.horasActuales} onChange={e => setCompleteForm(p => ({...p, horasActuales:e.target.value}))}/></div>
            <div><label className="block mb-2 text-[10px] text-emerald-400 font-black uppercase">Observaciones finales *</label>
              <textarea required rows={5} className={inputCls} value={completeForm.observacionesFinales}
                onChange={e => setCompleteForm(p => ({...p, observacionesFinales:e.target.value}))}/></div>
            {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
            <div className="flex gap-3"><button type="button" onClick={() => setIsCompleteOpen(false)} className={`${btnCls} flex-1 border border-white/10`}>Cancelar</button>
              <button type="submit" disabled={isSaving} className={`${btnCls} flex-1 bg-emerald-500 text-black`}>
                {isSaving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Confirmar cierre</button></div>
          </form>
        </div>
      </div>}

      {/* Modal de autorización: validación completa dentro del RPC */}
      {isReleaseOpen && !orderRecord && <div className="fixed inset-0 z-[95] bg-black/95 flex justify-center items-center p-4 overflow-y-auto">
        <div className="bg-[#0a0a0a] border border-emerald-500/40 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
          <div className="bg-emerald-500/10 p-6 flex justify-between items-center border-b border-emerald-500/20">
            <div><h3 className="uppercase font-black">Retorno al servicio · {matricula}</h3><p className="text-[10px] text-slate-400 mt-2">Solo personal previamente habilitado en Supabase</p></div>
            <button type="button" onClick={() => setIsReleaseOpen(false)}><X size={20}/></button>
          </div>
          <form onSubmit={handleRelease} className="p-7 space-y-5">
            <p className="text-xs bg-amber-500/10 border border-amber-500/20 p-4 rounded-lg text-amber-300">
              Confirma que dispones de autorización real de mantenimiento, documentación de liberación firmada y verificación de todas las restricciones. Este formulario NO emite una certificación técnica.
            </p>
            <div><label className="block mb-2 text-[10px] font-black uppercase">Referencia de liberación firmada *</label>
              <input required className={inputCls} value={releaseForm.referencia} placeholder="NÚMERO DE REGISTRO / REFERENCIA"
                onChange={e => setReleaseForm(p=>({...p,referencia:e.target.value}))}/></div>
            <div><label className="block mb-2 text-[10px] font-black uppercase">Observaciones y revisión de restricciones *</label>
              <textarea required rows={5} className={inputCls} value={releaseForm.observaciones}
                onChange={e => setReleaseForm(p=>({...p,observaciones:e.target.value}))}/></div>
            {errorMsg && <p className="text-red-400 text-xs">{errorMsg}</p>}
            <div className="flex gap-3"><button type="button" className={`${btnCls} flex-1 border border-white/20`} onClick={() => setIsReleaseOpen(false)}>Cancelar</button>
              <button disabled={isSaving} type="submit" className={`${btnCls} flex-1 bg-emerald-500 text-black`}>
                {isSaving ? <Loader2 size={14} className="animate-spin"/> : <ShieldCheck size={14}/>} Registrar</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
};

// Componentes visuales auxiliares; no sustituyen fuentes de datos técnicas.
const MetricCard = ({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) => (
  <div className="bg-white/[0.03] border border-white/10 rounded-3xl p-6 flex gap-4 items-center shadow-xl">
    <Icon size={26} className="text-[#E1AD01]"/>
    <div><p className="text-[9px] text-slate-500 uppercase font-black tracking-widest mb-2">{label}</p><p className="text-xl font-black break-words">{value}</p></div>
  </div>
);
const TelemetryDot = ({ label, value }: { label: string; value: string }) => (
  <div><p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{label}</p>
    <p className="text-sm text-zinc-500 font-mono mt-2 flex gap-2 items-center"><Signal size={13}/>{value}</p>
  </div>
);
const FeedbackBanner = ({ tone, text, onClose }: { tone: 'error' | 'success'; text: string; onClose?: () => void }) => (
  <div className={`p-4 border rounded-xl flex gap-3 items-center ${tone === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
    <AlertCircle size={16}/><p className="text-xs flex-1">{text}</p>
    {onClose && <button type="button" onClick={onClose}><X size={14}/></button>}
  </div>
);
export default AircraftDetail;
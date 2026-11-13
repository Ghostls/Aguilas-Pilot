// src/components/AircraftDetail.tsx
// VALKYRON OS v3.5 — B&M MANTENIMIENTO AERONÁUTICO
// CHANGELOG v3.5 — REBRAND B&M + CONEXIONES:
//   [UI]  Interfaz B&M mobile-first: cabecera oscura de diagnóstico, métricas
//         blancas, OT activa y checklist legibles; cierre y liberación en
//         BmModal (hoja inferior en móvil, Escape, foco, bloqueo durante el
//         guardado). El expediente OMA se abre sobre el lienzo claro.
//   [FIX] "Orden actualizada correctamente" no desaparecía nunca: se retira
//         a los 4 s o con su botón de cierre.
//   [FIX] Etiqueta de estado: .toUpperCase() sobre un estado nulo rompía la
//         pantalla; ahora se muestra "Estado no verificado".
//   [FIX] Un error de validación del cierre aparecía a la vez en el modal y,
//         tapado, en la página; ahora solo se muestra donde se está operando.
//   [UI]  "Completar orden" explica por qué está deshabilitado (repuestos
//         pendientes o checklist sin verificar).
//   [UI]  Botón de historial: "Historial técnico" cuando Flota lo gestiona;
//         "Expediente histórico OMA" cuando abre el archivo.
//   [UI]  Las observaciones se muestran tal como se guardan (antes se forzaban
//         a mayúsculas en pantalla aunque se guardaban como se escribían).
//   [UI]  Impresión con identidad B&M.
//   [FIX] Checklist: orderRecord.id.slice() rompía el módulo si el id de la OT llega numérico
//         (bigint); ahora String(id).slice(0, 8).
// PRESERVADO ÍNTEGRO: lectura en vivo de flota + OT, checklist por OT con
//   control de concurrencia, cierre por fn_mro_cerrar_orden, liberación por
//   fn_mro_liberar_aeronave, historial técnico imprimible completo (campos
//   dinámicos, etiquetas humanas, escapado), props y flujo onBack/onFleetChange.
// VALKYRON OS v3.4.1 — FUSIÓN v3.2 + v3.3; FIX TS2322 LucideIcon
// v3.2: Historial técnico completo imprimible A4 con todas las órdenes,
// campos adicionales dinámicos y etiquetas humanas; UI histórico preservado.
// v3.3: Lectura en vivo del estado MRO, cierre transaccional mediante RPC,
// registro de liberación autorizada, actualización de flota y estados seguros.
// El cierre de una OT NUNCA libera por sí mismo la aeronave al servicio.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Aircraft } from '../Types/Maintenance';
import AircraftArchive from './AircraftArchive';
import { BmModal, BmField, BmSelect, BmNotice, bmInput, bmTextarea, bmBtn } from './brand/bm-ui'; // [v3.5]
import {
  ArrowLeft, Plane, Wrench, Loader2, AlertTriangle, Clock, Cpu, HardDrive, Signal,
  Save, AlertCircle, CheckCircle2, History, X, Printer, ShieldCheck, RefreshCw, PackagePlus, PackageCheck, Square, type LucideIcon,
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
type PartRequirement = {
  id: string;
  orden_id: string;
  numero_parte: string;
  descripcion: string;
  cantidad: number;
  recibido: boolean;
  recibido_at: string | null;
  recibido_por: string | null;
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
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [requiredParts, setRequiredParts] = useState<PartRequirement[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);
  const [partsSaving, setPartsSaving] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);
  const [partDraft, setPartDraft] = useState({ numero_parte: '', descripcion: '', cantidad: '1' });
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

  // [v3.5] El aviso de guardado se retira solo
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(false), 4000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // El checklist pertenece a la orden de trabajo, NO a la matrícula.
  // Recibido no equivale a instalado, inspeccionado ni liberado al servicio.
  const loadRequiredParts = useCallback(async (orderId: string) => {
    setPartsLoading(true);
    setPartsError(null);
    try {
      const { data, error } = await supabase
        .from('oma_repuestos_requeridos')
        .select('id, orden_id, numero_parte, descripcion, cantidad, recibido, recibido_at, recibido_por, created_at')
        .eq('orden_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setRequiredParts((data ?? []) as PartRequirement[]);
    } catch (err: unknown) {
      setRequiredParts([]);
      setPartsError(err instanceof Error ? err.message : 'No se pudo cargar la lista de repuestos.');
    } finally {
      setPartsLoading(false);
    }
  }, []);

  useEffect(() => {
    setRequiredParts([]);
    setPartsError(null);
    if (orderRecord?.id) void loadRequiredParts(orderRecord.id);
  }, [orderRecord?.id, loadRequiredParts]);

  const addRequiredPart = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orderRecord || partsSaving) return;
    const partNumber = partDraft.numero_parte.trim().toUpperCase();
    const description = partDraft.descripcion.trim();
    const quantity = Number(partDraft.cantidad);
    if (!partNumber || !description || !Number.isSafeInteger(quantity) || quantity <= 0) {
      setPartsError('Indica número de parte, descripción y una cantidad entera mayor que cero.');
      return;
    }
    setPartsSaving(true);
    setPartsError(null);
    try {
      const { error } = await supabase.from('oma_repuestos_requeridos').insert({
        orden_id: orderRecord.id,
        numero_parte: partNumber,
        descripcion: description,
        cantidad: quantity,
      });
      if (error) throw error;
      setPartDraft({ numero_parte: '', descripcion: '', cantidad: '1' });
      await loadRequiredParts(orderRecord.id);
    } catch (err: unknown) {
      setPartsError(err instanceof Error ? err.message : 'No se pudo agregar el repuesto.');
    } finally {
      setPartsSaving(false);
    }
  };

  const togglePartReceived = async (part: PartRequirement) => {
    if (!orderRecord || partsSaving || partsLoading) return;
    setPartsSaving(true);
    setPartsError(null);
    try {
      // La identidad real del usuario y la auditoría se registran en PostgreSQL.
      const { data, error } = await supabase
        .from('oma_repuestos_requeridos')
        .update({ recibido: !part.recibido })
        .eq('id', part.id)
        .eq('orden_id', orderRecord.id)
        .eq('recibido', part.recibido)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('El repuesto fue actualizado por otra sesión. Recarga la lista.');
      await loadRequiredParts(orderRecord.id);
    } catch (err: unknown) {
      setPartsError(err instanceof Error ? err.message : 'No se pudo actualizar el checklist.');
      await loadRequiredParts(orderRecord.id);
    } finally {
      setPartsSaving(false);
    }
  };

  const pendingParts = requiredParts.filter(part => !part.recibido);

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
    // Barrera visual de consistencia; la restricción definitiva debe vivir en el RPC.
    if (partsLoading || partsError || pendingParts.length) {
      setErrorMsg('No es posible cerrar desde esta pantalla mientras exista una lista de repuestos pendiente o sin verificar.');
      return;
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

            border-bottom: 3px solid #D42125;

            padding-bottom: 18px;
            margin-bottom: 25px;
          }

          .brand {
            font-size: 24px;
            font-weight: 900;
            letter-spacing: 1px;
            color: #D42125;
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
              B&amp;M MANTENIMIENTO AERONÁUTICO
            </div>

            <div class="subtitle">
              VALKYRON OS · SISTEMA DE GESTIÓN Y MANTENIMIENTO
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
            B&amp;M Mantenimiento Aeronáutico · Valkyron OS — Registro técnico de aeronave.
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

  // [v3.5] Controles B&M (antes: negro con borde dorado, texto de 12 px)
  const inputCls = bmInput;
  const statusLabel = isFetching ? 'Sincronizando MRO' : isMaintenance ? 'En hangar / mantenimiento'
    : isGrounded ? 'AOG / en tierra' : flotaActual?.estado === 'operational' ? 'Operativa en sistema'
    : String(flotaActual?.estado ?? aircraft.status ?? 'Estado no verificado'); // [FIX v3.5] sin .toUpperCase() sobre nulo
  const statusPill = isFetching ? 'bg-white/10 text-white'
    : isMaintenance ? 'bg-bm-warn text-white'
    : isGrounded ? 'bg-bm-red text-white'
    : 'bg-bm-ok text-white';
  const partesRecibidas = requiredParts.length - pendingParts.length;
  const cierreBloqueado = partsLoading || !!partsError || pendingParts.length > 0;

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">
      {/* Barra de navegación y accesos al historial completo */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={`${bmBtn.ghost} ${bmBtn.sm} -ml-2`}>
          <ArrowLeft className="h-4 w-4" /> Volver a Flota
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void fetchLatestOrder()} disabled={isFetching || isSaving}
            className={`${bmBtn.secondary} ${bmBtn.sm}`} aria-label="Actualizar estado">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
          <button type="button" onClick={() => onOpenHistorial ? onOpenHistorial(aircraft) : setIsArchiveOpen(true)}
            className={`${bmBtn.secondary} ${bmBtn.sm}`}>
            <History className="h-4 w-4" /> {onOpenHistorial ? 'Historial técnico' : 'Expediente histórico OMA'}
          </button>
          <button type="button" onClick={() => void handlePrintHistory()}
            className={`${bmBtn.dark} ${bmBtn.sm}`}>
            <Printer className="h-4 w-4" /> Imprimir historial
          </button>
        </div>
      </header>

      {/* Estado de aeronave consultado directamente de PostgreSQL */}
      <section className="relative overflow-hidden rounded-[24px] bg-bm-ink p-5 text-white sm:p-7">
        <Plane className="pointer-events-none absolute -bottom-6 -right-4 h-40 w-40 rotate-12 text-white/[0.05]" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm text-white/60">Diagnóstico de aeronave</p>
            <h2 className="bm-figure mt-1 break-words text-[40px] leading-none sm:text-[56px]">{aircraft.model}</h2>
            <p className="mt-3 text-sm text-white/70">
              <span className="font-data font-semibold text-white">{matricula}</span> · Base {aircraft.location || 'sin asignar'}
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${statusPill}`} role="status">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : isMaintenance ? <Wrench className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
            {statusLabel}
          </div>
        </div>
      </section>

      {/* Métricas: solo las respaldadas por la base de datos */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <MetricCard label="Time Since New (TSN)" value={`${flotaActual?.horas_vuelo_totales ?? aircraft.hours_vuelo_totales ?? 0} h`} icon={Clock} numeric />
        <MetricCard label="Órdenes activas" value={isFetching ? 'Consultando…' : orderRecord ? 'Hay OT activa' : 'Ninguna detectada'} icon={Wrench} />
        <MetricCard label="Estado en BD" value={flotaActual?.estado ?? 'Consultando…'} icon={HardDrive} mono />
      </div>

      {/* Conserva el panel visual sin inventar telemetría del motor */}
      <section className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-6">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Cpu className="h-4 w-4 text-bm-red" /> Módulo de análisis predictivo del motor
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <TelemetryDot label="Estado motor" value="Sin telemetría"/>
          <TelemetryDot label="Vibración" value="No disponible"/>
          <TelemetryDot label="Temperatura de aceite" value="No disponible"/>
          <TelemetryDot label="Alerta predictiva" value="Sin datos"/>
        </div>
        <p className="mt-4 text-xs text-bm-hint">Estos campos requieren sensores o una fuente verificada; no representan diagnóstico técnico.</p>
      </section>

      {errorMsg && !isCompleteOpen && !isReleaseOpen && <FeedbackBanner tone="error" text={errorMsg} onClose={() => setErrorMsg(null)}/>}
      {successMsg && <FeedbackBanner tone="success" text="Orden actualizada correctamente." onClose={() => setSuccessMsg(false)}/>}

      {/* Panel de la última OT activa: busca aunque el dashboard tenga un estado obsoleto */}
      {isMaintenance && <section className="space-y-5 rounded-[24px] border border-bm-warn/30 bg-white p-4 sm:p-6">
        <h3 className="flex items-center gap-2.5 text-base font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-bm-warn-tint text-bm-warn"><AlertTriangle className="h-4 w-4"/></span>
          Orden de trabajo activa
        </h3>
        {isFetching ? <div className="flex items-center gap-3 py-8 text-sm text-bm-steel" role="status"><Loader2 className="h-5 w-5 animate-spin text-bm-red"/> Sincronizando con MRO…</div>
          : orderRecord ? <>
            <div className="grid gap-4 rounded-2xl bg-bm-canvas p-4 md:grid-cols-2">
              <div><p className="text-xs text-bm-steel">Tarea</p>
                <p className="mt-1 whitespace-pre-line text-sm font-semibold uppercase leading-snug">{orderRecord.descripcion_tarea}</p></div>
              <div><p className="text-xs text-bm-steel">Técnico asignado</p>
                <p className="mt-1 text-sm font-semibold uppercase">{orderRecord.nombre_mecanico}</p></div>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <BmField label="Estado de la orden" htmlFor="ad-estado" hint="Completar la orden requiere registrar el cierre técnico.">
                <BmSelect id="ad-estado" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="In Progress">En progreso</option>
                  <option value="Pending Parts">Esperando repuestos</option>
                  <option value="On Hold">En espera</option>
                </BmSelect>
              </BmField>
              <BmField label="Observaciones y progreso" htmlFor="ad-notas">
                <textarea id="ad-notas" rows={5} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Avances, diagnóstico, repuestos pedidos" className={bmTextarea}/>
              </BmField>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="submit" disabled={isSaving} className={`${bmBtn.primary} sm:flex-1`}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>} Guardar progreso
                </button>
                <button type="button" onClick={() => setIsCompleteOpen(true)} disabled={isSaving || cierreBloqueado}
                  className={`${bmBtn.success} sm:flex-1`}>
                  <CheckCircle2 className="h-4 w-4"/> Completar orden
                </button>
              </div>
              {/* [v3.5] Motivo visible cuando el cierre está bloqueado */}
              {!partsLoading && cierreBloqueado && (
                <p className="text-[13px] text-bm-steel">
                  {partsError
                    ? 'No se pudo verificar el checklist de repuestos: actualícelo antes de cerrar.'
                    : `Para cerrar, marque como recibidos los ${pendingParts.length} repuesto(s) pendiente(s) del checklist.`}
                </p>
              )}
            </form>
          </> : <div className="space-y-4 rounded-2xl bg-bm-canvas p-4">
            <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4"/>}>
              La aeronave permanece en mantenimiento sin órdenes abiertas. <strong>No está liberada para vuelo.</strong>
            </BmNotice>
            <p className="text-sm text-bm-steel">Si existe documentación de retorno al servicio, una persona expresamente autorizada puede registrar su liberación.</p>
            <button type="button" onClick={() => setIsReleaseOpen(true)} disabled={isSaving}
              className={bmBtn.success}><ShieldCheck className="h-4 w-4"/> Registrar liberación autorizada</button>
          </div>}
      </section>}

      {isArchiveOpen && <div className="fixed inset-0 z-[80] overflow-y-auto bg-bm-canvas" role="dialog" aria-modal="true" aria-label="Expediente histórico OMA">
        <AircraftArchive initialMatricula={matricula} onBack={() => setIsArchiveOpen(false)}/>
        <button type="button" onClick={() => setIsArchiveOpen(false)}
          className={`${bmBtn.dark} fixed bottom-4 right-4 z-[81] shadow-bm-pop`}>
          <X className="h-4 w-4"/> Cerrar expediente
        </button>
      </div>}

      {/* Checklist persistente de materiales requeridos en la OT activa */}
      {orderRecord && (
        <section className="space-y-5 rounded-[24px] border border-bm-line bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <PackageCheck className="h-5 w-5 text-bm-red" /> Checklist de repuestos requeridos
              </h3>
              <p className="mt-1 text-[13px] text-bm-steel">Orden <span className="font-data">{String(orderRecord.id).slice(0, 8)}</span> · {matricula}</p>
              <p className="mt-1 text-xs text-bm-hint">
                Marcar recibido confirma disponibilidad documental; no registra instalación ni descuenta stock.
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${pendingParts.length ? 'bg-bm-warn-tint text-bm-warn' : 'bg-bm-ok-tint text-bm-ok'}`}>
              <span className="bm-num">{partesRecibidas}/{requiredParts.length}</span> recibidos
            </span>
          </div>
          {partsError && <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4"/>}>{partsError}</BmNotice>}
          {partsLoading ? (
            <p className="flex items-center gap-2 text-sm text-bm-steel" role="status"><Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Cargando materiales…</p>
          ) : requiredParts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-bm-line p-4 text-sm text-bm-steel">Sin repuestos requeridos registrados para esta orden.</p>
          ) : (
            <div className="space-y-2">
              {requiredParts.map(part => (
                <label key={part.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  part.recibido ? 'border-bm-ok/25 bg-bm-ok-tint/50' : 'border-bm-line bg-white hover:bg-bm-canvas/60'}`}>
                  <input type="checkbox" checked={part.recibido} disabled={partsSaving || partsLoading}
                    onChange={() => void togglePartReceived(part)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[#D42125]" />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${part.recibido ? 'text-bm-ok' : ''}`}>
                      <span className="font-data">{part.numero_parte}</span> · {part.descripcion}
                    </p>
                    <p className="mt-1 text-xs text-bm-steel">Cantidad requerida: <span className="bm-num">{part.cantidad}</span> · {part.recibido ? 'Recibido' : 'Pendiente'}</p>
                    {part.recibido_at && <p className="mt-1 text-xs text-bm-hint">Actualizado: {formatDate(part.recibido_at)}</p>}
                  </div>
                  {part.recibido ? <CheckCircle2 className="h-5 w-5 shrink-0 text-bm-ok" /> : <Square className="h-5 w-5 shrink-0 text-bm-warn" />}
                </label>
              ))}
            </div>
          )}
          <form onSubmit={addRequiredPart} className="grid grid-cols-1 gap-3 border-t border-bm-line pt-4 md:grid-cols-[1fr_2fr_110px_auto] md:items-end">
            <BmField label="Número de parte" htmlFor="ad-pn" required>
              <input id="ad-pn" required maxLength={100} className={`${inputCls} font-data uppercase`} placeholder="P/N" value={partDraft.numero_parte}
                onChange={event => setPartDraft(prev => ({ ...prev, numero_parte: event.target.value }))} />
            </BmField>
            <BmField label="Descripción" htmlFor="ad-desc" required>
              <input id="ad-desc" required maxLength={300} className={inputCls} placeholder="Repuesto requerido" value={partDraft.descripcion}
                onChange={event => setPartDraft(prev => ({ ...prev, descripcion: event.target.value }))} />
            </BmField>
            <BmField label="Cantidad" htmlFor="ad-cant" required>
              <input id="ad-cant" required min="1" step="1" type="number" inputMode="numeric" className={`${inputCls} bm-num`} value={partDraft.cantidad}
                onChange={event => setPartDraft(prev => ({ ...prev, cantidad: event.target.value }))} />
            </BmField>
            <button type="submit" disabled={partsSaving || partsLoading} className={bmBtn.primary}>
              {partsSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <PackagePlus className="h-4 w-4"/>} Agregar
            </button>
          </form>
          <button type="button" onClick={() => void loadRequiredParts(orderRecord.id)} disabled={partsSaving || partsLoading}
            className={`${bmBtn.ghost} ${bmBtn.sm} -ml-2`}>
            <RefreshCw className="h-4 w-4"/> Actualizar checklist
          </button>
        </section>
      )}

      {/* Modal de cierre: no libera automáticamente la aeronave */}
      <BmModal
        open={isCompleteOpen && !!orderRecord}
        onClose={() => setIsCompleteOpen(false)}
        busy={isSaving}
        title="Cerrar orden de trabajo"
        subtitle={`${matricula} · ${aircraft.model}`}
        icon={<CheckCircle2 className="h-5 w-5"/>}
        tone="ok"
        z={90}
      >
        {orderRecord && (
          <form onSubmit={handleCompleteOrder} className="space-y-4">
            <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4"/>}>
              El cierre de esta orden <strong>no autoriza</strong> el regreso al servicio de la aeronave.
            </BmNotice>
            <div className="rounded-2xl bg-bm-canvas p-4"><p className="text-xs text-bm-steel">Tarea</p>
              <p className="mt-1 whitespace-pre-line text-sm font-semibold uppercase">{orderRecord.descripcion_tarea}</p></div>
            <BmField label="Mecánico / inspector" htmlFor="ad-mec" required>
              <input id="ad-mec" required className={`${inputCls} uppercase`} value={completeForm.mecanicoCierre}
                onChange={e => setCompleteForm(p => ({...p, mecanicoCierre:e.target.value}))}/>
            </BmField>
            <BmField label="Horas totales al cierre (TSN)" htmlFor="ad-horas" required>
              <input id="ad-horas" required type="number" min="0" step="0.1" inputMode="decimal"
                className={`${inputCls} bm-num h-14 text-center text-2xl font-semibold`}
                value={completeForm.horasActuales} onChange={e => setCompleteForm(p => ({...p, horasActuales:e.target.value}))}/>
            </BmField>
            <BmField label="Observaciones finales" htmlFor="ad-obs" required>
              <textarea id="ad-obs" required rows={5} className={bmTextarea} value={completeForm.observacionesFinales}
                onChange={e => setCompleteForm(p => ({...p, observacionesFinales:e.target.value}))}/>
            </BmField>
            {errorMsg && <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4"/>}>{errorMsg}</BmNotice>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={() => setIsCompleteOpen(false)} disabled={isSaving} className={`${bmBtn.secondary} sm:flex-1`}>Cancelar</button>
              <button type="submit" disabled={isSaving} className={`${bmBtn.success} sm:flex-1`}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <CheckCircle2 className="h-4 w-4"/>} Confirmar cierre
              </button>
            </div>
          </form>
        )}
      </BmModal>

      {/* Modal de autorización: validación completa dentro del RPC */}
      <BmModal
        open={isReleaseOpen && !orderRecord}
        onClose={() => setIsReleaseOpen(false)}
        busy={isSaving}
        title={`Retorno al servicio · ${matricula}`}
        subtitle="Solo personal previamente habilitado en Supabase"
        icon={<ShieldCheck className="h-5 w-5"/>}
        tone="ok"
        z={95}
      >
        <form onSubmit={handleRelease} className="space-y-4">
          <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4"/>}>
            Confirme que dispone de autorización real de mantenimiento, documentación de liberación firmada y verificación de todas las restricciones. Este formulario <strong>no emite</strong> una certificación técnica.
          </BmNotice>
          <BmField label="Referencia de liberación firmada" htmlFor="ad-ref" required>
            <input id="ad-ref" required className={`${inputCls} font-data uppercase`} value={releaseForm.referencia} placeholder="Número de registro o referencia"
              onChange={e => setReleaseForm(p=>({...p,referencia:e.target.value}))}/>
          </BmField>
          <BmField label="Observaciones y revisión de restricciones" htmlFor="ad-rev" required>
            <textarea id="ad-rev" required rows={5} className={bmTextarea} value={releaseForm.observaciones}
              onChange={e => setReleaseForm(p=>({...p,observaciones:e.target.value}))}/>
          </BmField>
          {errorMsg && <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4"/>}>{errorMsg}</BmNotice>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" className={`${bmBtn.secondary} sm:flex-1`} disabled={isSaving} onClick={() => setIsReleaseOpen(false)}>Cancelar</button>
            <button disabled={isSaving} type="submit" className={`${bmBtn.success} sm:flex-1`}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : <ShieldCheck className="h-4 w-4"/>} Registrar
            </button>
          </div>
        </form>
      </BmModal>
    </div>
  );
};

// Componentes visuales auxiliares; no sustituyen fuentes de datos técnicas.
const MetricCard = ({ label, value, icon: Icon, numeric = false, mono = false }: { label: string; value: string; icon: LucideIcon; numeric?: boolean; mono?: boolean }) => (
  <div className="flex items-center gap-4 rounded-[20px] border border-bm-line bg-white p-4 sm:p-5">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red"><Icon className="h-5 w-5"/></span>
    <div className="min-w-0">
      <p className="text-[13px] text-bm-steel">{label}</p>
      <p className={`mt-0.5 break-words font-semibold ${numeric ? 'bm-num text-2xl' : mono ? 'font-data text-base' : 'text-lg'}`}>{value}</p>
    </div>
  </div>
);
const TelemetryDot = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-bm-canvas p-3.5">
    <p className="text-xs text-bm-steel">{label}</p>
    <p className="mt-1.5 flex items-center gap-2 text-sm font-medium text-bm-hint"><Signal className="h-3.5 w-3.5"/>{value}</p>
  </div>
);
const FeedbackBanner = ({ tone, text, onClose }: { tone: 'error' | 'success'; text: string; onClose?: () => void }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-center gap-3 rounded-2xl border p-4 text-sm ${
    tone === 'error' ? 'border-bm-red/25 bg-bm-red-tint text-bm-red-deep' : 'border-bm-ok/25 bg-bm-ok-tint text-bm-ok'}`}>
    {tone === 'error' ? <AlertCircle className="h-4 w-4 shrink-0"/> : <CheckCircle2 className="h-4 w-4 shrink-0"/>}
    <p className="flex-1">{text}</p>
    {onClose && <button type="button" onClick={onClose} aria-label="Cerrar aviso" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/60"><X className="h-4 w-4"/></button>}
  </div>
);
export default AircraftDetail;

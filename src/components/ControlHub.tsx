// src/components/ControlHub.tsx
// VALKYRON OS v5.7 — Hangar MRO · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v5.7 — REBRAND B&M + CONEXIONES:
//   [FIX] Cierre de OT con modal propio en lugar de window.prompt(). Varios
//         navegadores embebidos y modos app (PWA) bloquean prompt() y devuelven
//         null en silencio: la orden no podía cerrarse. Misma validación (mecánico
//         asignado + observaciones obligatorias) y misma RPC fn_mro_cerrar_orden.
//   [FIX] Ruta directa /control-hub (App.tsx) no entrega tasks/setTasks: las
//         órdenes se cargaban en un setter vacío y la vista quedaba siempre sin
//         órdenes. Ahora, sin setTasks, el componente usa su propio estado.
//   [FIX] Edición: "sin cambios" compara mecánico con null normalizado ('' vs
//         null contaba como cambio).
//   [UI]  Estética B&M (bm-ui): tarjetas blancas por orden con estado legible,
//         resumen por estado, modales como hoja inferior en móvil, campos de
//         48 px / 16 px, etiquetas en español para los estados.
// PRESERVADO ÍNTEGRO (v5.6): fetchOrders (neq Completed), creación con trigger
//   transaccional y verificación de flota en 'maintenance', mensajes de error,
//   edición con hallazgos + timestamp, flujo de 2 pasos Formulario → Confirmación,
//   razones predefinidas, extractRazon / contarHallazgos, onFleetChange, setFleet,
//   valores de estado en BD ('In Progress' | 'Pending Parts' | 'On Hold').
// ─────────────────────────────────────────────────────────────────────────────
// v5.6: conserva todos los formularios, tarjetas y funciones originales.
// La orden se crea con trigger transaccional y se verifica estado MRO.
// El cierre se realiza mediante fn_mro_cerrar_orden y NO libera aeronaves.
// v5.4 PRESERVADO:
//   [FIX] handleFinalCertification: query de OT adicionales excluye task.id actual
//         con .neq('id', task.id) — elimina falso positivo por lag de replicación
//   [FIX] fecha_cierre removido del update (no existe en tipo WorkOrder) — el
//         timestamp de cierre queda en observaciones via AircraftDetail
//   [FIX] activeTasks = externalTasks directo — fetchOrders ya filtra Completed en DB,
//         doble filter() eliminado
//   [FIX] doc en handleConfirmAndSend aclara que YV-118 legacy requiere SQL manual
// CHANGELOG v5.3 PRESERVADO:
//   [NEW] prop onFleetChange?: () => Promise<void> — llamado tras handleConfirmAndSend
//         y handleFinalCertification para forzar syncFleet() en Index.tsx
//   [FIX] Garantiza que FleetDashboard refleje cambios MRO sin recargar página
// CHANGELOG v5.2 PRESERVADO:
//   [FIX] handleFinalCertification: elimina flota_id (siempre null, no hay FK UUID)
//         → siempre actualiza flota_aviones por matricula TEXT
//   [FIX] Verifica OT adicionales antes de liberar aeronave (puede haber >1 OT activa)
//   [FIX] setFleet matchea por tailNumber O matricula (cubre ambos módulos)
//   [FIX] handleConfirmAndSend: actualiza flota_aviones.estado='maintenance' por matricula
// v5.1 PRESERVADO: Modal edición con hallazgos+timestamp, botón Editar en tarjetas,
//   modal confirmación 2 pasos, razón de entrada obligatoria, fallback sin JOIN
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import React, { useState, useEffect } from 'react';
import type { SparePart } from '../Types/Maintenance';
import { Card, CardHeader, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  BmModal, BmField, BmSelect, BmBadge, BmEmpty, BmNotice,
  bmInput, bmTextarea, bmBtn, type BmTone,
} from './brand/bm-ui';
import {
  PlusCircle, X, Wrench, AlertCircle,
  PackageCheck, Loader2, ShieldAlert, ShieldCheck,
  Plane, MapPin, ClipboardList, Pencil,
  PlusCircle as PlusCircleIcon, CheckCircle2,
  UserRound, // [v5.7]
} from 'lucide-react';

// ─── INTERFACES ───────────────────────────────────────────────────────────────

interface ControlHubProps {
  tasks?:         any[];
  setTasks?:      React.Dispatch<React.SetStateAction<any[]>>;
  fleet?:         any[];
  setFleet?:      React.Dispatch<React.SetStateAction<any[]>>;
  inventory?:     SparePart[];
  onPartsUsage?:  (partsUsed: { pn: string; qty: number }[], aircraftId: string) => void;
  // [v5.3] Callback para forzar re-fetch de flota desde Index.tsx tras ops MRO
  onFleetChange?: () => Promise<void>;
}

interface EditForm {
  nuevosHallazgos: string;
  mecanico:        string;
  estado:          string;
}

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const RAZONES_PREDEFINIDAS = [
  'Mantenimiento Preventivo 100H',
  'Mantenimiento Preventivo 200H',
  'Inspección Anual (IA)',
  'Falla de Motor',
  'Falla de Aviónica',
  'Falla Hidráulica',
  'Daño en Tren de Aterrizaje',
  'AOG — Falla Crítica',
  'Cambio de Aceite / Filtros',
  'Inspección Post-Vuelo',
  'Otra (especificar)',
];

// [v5.7] Clases B&M (antes: campos negros con borde dorado)
const SELECT_CLS = ''; // BmSelect aplica sus propias clases
const INPUT_CLS = `${bmInput} uppercase placeholder:normal-case`;

// [v5.7] Etiqueta y tono por estado de OT (los valores en BD no cambian)
const ESTADO_OT: Record<string, { label: string; tone: BmTone }> = {
  'In Progress':   { label: 'En progreso',         tone: 'info'    },
  'Pending Parts': { label: 'Esperando repuestos', tone: 'warn'    },
  'On Hold':       { label: 'En espera',           tone: 'neutral' },
  'Completed':     { label: 'Completada',          tone: 'ok'      },
};
const estadoOT = (estado: string) => ESTADO_OT[estado] ?? { label: estado || 'Sin estado', tone: 'neutral' as BmTone };

// Setter estable para que el efecto inicial no se repita indefinidamente
// si ControlHub se utiliza sin las propiedades opcionales tasks/setTasks.
// [v5.7] Ya no se usa para tasks (ver estado interno); se conserva por compatibilidad.
const noopSetTasks: React.Dispatch<React.SetStateAction<any[]>> = () => {};
const noopSetFleet: React.Dispatch<React.SetStateAction<any[]>> = () => {};
void noopSetTasks;

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export const ControlHub: React.FC<ControlHubProps> = ({
  tasks: tasksProp,
  setTasks: setTasksProp,
  fleet = [],
  setFleet = noopSetFleet,
  inventory = [],
  onFleetChange,
}) => {
  // [FIX v5.7] Sin setTasks (ruta directa /control-hub) se usa estado propio;
  // dentro de Index se siguen usando tasks/setTasks del padre.
  const [internalTasks, setInternalTasks] = useState<any[]>([]);
  const externalTasks: any[] = setTasksProp ? (tasksProp ?? []) : internalTasks;
  const setExternalTasks: React.Dispatch<React.SetStateAction<any[]>> = setTasksProp ?? setInternalTasks;
  void inventory;

  const [isFormOpen,    setIsFormOpen]    = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isEditOpen,    setIsEditOpen]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [loadingEdit,   setLoadingEdit]   = useState(false);
  const [pendingTask,   setPendingTask]   = useState<typeof newTask | null>(null);
  const [editingTask,   setEditingTask]   = useState<any | null>(null);

  // [v5.7] Cierre de OT con modal (reemplaza window.prompt)
  const [closingTask,   setClosingTask]   = useState<any | null>(null);
  const [closeObs,      setCloseObs]      = useState('');

  const [editForm, setEditForm] = useState<EditForm>({
    nuevosHallazgos: '',
    mecanico:        '',
    estado:          'In Progress',
  });

  const [newTask, setNewTask] = useState({
    matricula:   '',
    descripcion: '',
    sede:        'Lara' as 'Lara' | 'Maturín',
    mecanico:    '',
    razon:       '',
    razonCustom: '',
  });

  const razonFinal = newTask.razon === 'Otra (especificar)'
    ? newTask.razonCustom.trim()
    : newTask.razon;

  const targetAircraft = fleet.find(
    ac => String(ac.tailNumber ?? ac.matricula ?? '').trim().toUpperCase() === newTask.matricula.trim().toUpperCase()
  );

  // ─── CARGAR ÓRDENES ───────────────────────────────────────────────────────
  // DB ya filtra Completed — externalTasks contiene solo activas

  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*')
        .neq('estado', 'Completed')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setExternalTasks(data);
      } else if (error) {
        console.error('[ControlHub] fetchOrders error:', error.message);
      }
    };
    fetchOrders();
  }, [setExternalTasks]);

  // [FIX v5.4] activeTasks directo — fetchOrders ya filtra Completed en DB.
  // Eliminado el .filter(t => t.estado !== 'Completed') redundante.
  const activeTasks = externalTasks;

  // [v5.7] Resumen por estado (solo presentación)
  const resumenEstados = ['In Progress', 'Pending Parts', 'On Hold']
    .map(estado => ({ estado, total: activeTasks.filter(t => t.estado === estado).length }))
    .filter(r => r.total > 0);

  // ─── ABRIR MODAL DE EDICIÓN ───────────────────────────────────────────────

  const handleAbrirEdicion = (task: any) => {
    setEditingTask(task);
    setEditForm({
      nuevosHallazgos: '',
      mecanico:        task.nombre_mecanico ?? '',
      estado:          task.estado ?? 'In Progress',
    });
    setIsEditOpen(true);
  };

  // ─── GUARDAR EDICIÓN ──────────────────────────────────────────────────────

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;

    // [FIX v5.7] null y '' cuentan como el mismo mecánico
    const sinCambios =
      !editForm.nuevosHallazgos.trim() &&
      editForm.mecanico.trim() === String(editingTask.nombre_mecanico ?? '').trim() &&
      editForm.estado   === editingTask.estado;

    if (sinCambios) {
      alert('No hay cambios para guardar.');
      return;
    }

    setLoadingEdit(true);
    try {
      const timestamp = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const obsActual = editingTask.observaciones ?? '';
      const obsNueva  = editForm.nuevosHallazgos.trim()
        ? `${obsActual}\n[${timestamp}] NUEVO HALLAZGO: ${editForm.nuevosHallazgos.trim().toUpperCase()}`
        : obsActual;

      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({
          nombre_mecanico: editForm.mecanico.trim() || editingTask.nombre_mecanico,
          estado:          editForm.estado,
          observaciones:   obsNueva,
        })
        .eq('id', editingTask.id);

      if (error) throw error;

      // Actualizar tarjeta en estado local sin re-fetch
      setExternalTasks(prev =>
        prev.map(t => t.id === editingTask.id
          ? {
              ...t,
              nombre_mecanico: editForm.mecanico.trim() || t.nombre_mecanico,
              estado:          editForm.estado,
              observaciones:   obsNueva,
            }
          : t
        )
      );

      await onFleetChange?.();
      setIsEditOpen(false);
      setEditingTask(null);
      alert(
        `✓ Orden actualizada.\n` +
        (editForm.nuevosHallazgos.trim()
          ? `Hallazgo registrado: ${editForm.nuevosHallazgos.trim().toUpperCase()}`
          : 'Datos actualizados.')
      );
    } catch (err: any) {
      alert('Error al actualizar: ' + err.message);
    } finally {
      setLoadingEdit(false);
    }
  };

  // ─── PASO 1: Validar form ─────────────────────────────────────────────────

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!razonFinal) {
      alert('PROTOCOLO: Debes especificar la razón de entrada a hangar.');
      return;
    }
    setPendingTask({ ...newTask });
    setIsFormOpen(false);
    setIsConfirmOpen(true);
  };

  // ─── PASO 2: Confirmar → escribir en DB ───────────────────────────────────
  // NOTA: aeronaves con OT legacy (ej. YV-118) creadas antes de v5.2 pueden
  // tener flota_aviones.estado='operational' incorrecto. Fix manual en Supabase:
  //   UPDATE flota_aviones SET estado='maintenance' WHERE matricula='YV-118';

  const handleConfirmAndSend = async () => {
    if (!pendingTask || loading) return;
    setLoading(true);
    const matriculaUpper = pendingTask.matricula.trim().toUpperCase();
    const razon = pendingTask.razon === 'Otra (especificar)'
      ? pendingTask.razonCustom.trim()
      : pendingTask.razon;
    try {
      if (!matriculaUpper || !razon || !pendingTask.descripcion.trim()) {
        throw new Error('Matrícula, razón y descripción son obligatorias.');
      }
      const target = fleet.find(ac =>
        String(ac.tailNumber ?? ac.matricula ?? '').trim().toUpperCase() === matriculaUpper
      );
      if (!target) throw new Error('Aeronave no encontrada en la flota.');

      // El trigger DB cambia flota a maintenance en la MISMA transacción
      // que inserta esta OT. No crear una actualización independiente.
      const { data: nuevaOrden, error: ordenError } = await supabase
        .from('ordenes_trabajo')
        .insert({
          matricula: matriculaUpper,
          modelo: target.model ?? target.modelo ?? 'MODELO NO DETECTADO',
          descripcion_tarea: pendingTask.descripcion.trim(),
          sede: pendingTask.sede,
          nombre_mecanico: pendingTask.mecanico.trim() || 'POR ASIGNAR',
          estado: 'In Progress',
          observaciones: `RAZÓN DE ENTRADA: ${razon.toUpperCase()} | VALKYRON TERMINAL`,
        })
        .select('*')
        .single();
      if (ordenError) throw ordenError;

      const { data: avion, error: flotaError } = await supabase
        .from('flota_aviones')
        .select('id, matricula, estado')
        .eq('id', target.id)
        .single();
      if (flotaError) throw flotaError;
      if (avion.estado !== 'maintenance') {
        // La orden ya se creó: conservar formulario, NO reenviar a ciegas.
        throw new Error(`OT ${nuevaOrden.id} creada, pero flota sigue ${avion.estado}. ` +
          'Verifica el trigger SQL antes de volver a registrar la orden.');
      }
      setFleet(prev => prev.map(ac => ac.id === avion.id
        ? { ...ac, status: 'maintenance', estado: 'maintenance' } : ac));
      setExternalTasks(prev => [nuevaOrden, ...prev.filter(t => t.id !== nuevaOrden.id)]);
      await onFleetChange?.();
      setIsConfirmOpen(false);
      setPendingTask(null);
      setNewTask({ matricula: '', descripcion: '', sede: 'Lara',
        mecanico: '', razon: '', razonCustom: '' });
      alert(`✓ Orden ${nuevaOrden.id} registrada.\n${matriculaUpper}: EN MANTENIMIENTO.`);
    } catch (err: any) {
      alert('No se pudo confirmar el ingreso: ' + (err?.message ?? 'Error desconocido'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelConfirm = () => {
    setIsConfirmOpen(false);
    setIsFormOpen(true);
  };

  // ─── CIERRE DE ORDEN (NO ES LIBERACIÓN) ──────────────────────────────────
  // Requiere la función SQL fn_mro_cerrar_orden instalada en Supabase.

  // Cerrar una orden NO autoriza el retorno al servicio.
  // Las aeronaves permanecen en maintenance hasta liberación autorizada.
  // [v5.7] Paso 1: validar mecánico y abrir el modal de observaciones.
  const handleFinalCertification = (task: any) => {
    if (loading) return;
    const mecanico = String(task.nombre_mecanico ?? '').trim();
    if (!mecanico || mecanico === 'POR ASIGNAR') {
      alert('Asigna un mecánico a la orden antes de cerrarla.');
      return;
    }
    setCloseObs('');
    setClosingTask(task);
  };

  // [v5.7] Paso 2: observaciones obligatorias → RPC fn_mro_cerrar_orden
  const handleConfirmClose = async (e: React.FormEvent) => {
    e.preventDefault();
    const task = closingTask;
    if (!task || loading) return;
    const mecanico = String(task.nombre_mecanico ?? '').trim();
    const observaciones = closeObs;
    if (!observaciones.trim()) {
      alert('Las observaciones de cierre son obligatorias.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.rpc('fn_mro_cerrar_orden', {
        p_orden_id: task.id,
        p_observaciones: observaciones.trim(),
        p_mecanico: mecanico,
        p_horas: null,
      });
      if (error) throw error;
      setExternalTasks(prev => prev.filter(t => t.id !== task.id));
      await onFleetChange?.();
      setClosingTask(null);
      setCloseObs('');
      alert(`Orden cerrada: ${task.matricula}.\nLa aeronave sigue fuera de servicio hasta su liberación autorizada.`);
    } catch (err: any) {
      alert('Error al cerrar la orden: ' + (err?.message ?? 'Desconocido'));
    } finally {
      setLoading(false);
    }
  };

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  const extractRazon = (obs: string): string => {
    if (!obs) return '—';
    const match = obs.match(/RAZÓN DE ENTRADA:\s*(.+?)\s*\|/i);
    return match ? match[1] : obs.split('|')[0].trim();
  };

  const contarHallazgos = (obs: string): number => {
    if (!obs) return 0;
    return (obs.match(/\[.*?\] NUEVO HALLAZGO:/g) ?? []).length;
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="bm-app space-y-4 text-left sm:space-y-5">

      {/* Barra de herramientas */}
      <div className="flex flex-col gap-4 rounded-[24px] border border-bm-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Wrench className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="bm-heading text-lg leading-tight sm:text-xl">Órdenes de trabajo</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] text-bm-steel">
                {activeTasks.length === 1 ? '1 orden abierta' : `${activeTasks.length} órdenes abiertas`}
              </span>
              {resumenEstados.map(r => (
                <BmBadge key={r.estado} tone={estadoOT(r.estado).tone}>
                  {estadoOT(r.estado).label}: {r.total}
                </BmBadge>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setIsFormOpen(true)} className={`${bmBtn.primary} w-full sm:w-auto`}>
          <PlusCircle className="h-5 w-5" /> Abrir orden
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════
          MODAL — EDITAR ORDEN DE TRABAJO
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isEditOpen && !!editingTask}
        onClose={() => { setIsEditOpen(false); setEditingTask(null); }}
        busy={loadingEdit}
        title="Actualizar orden de trabajo"
        subtitle={editingTask ? `${editingTask.matricula} · ${editingTask.modelo ?? ''}` : undefined}
        icon={<ClipboardList className="h-5 w-5" />}
        tone="neutral"
        z={120}
      >
        {editingTask && (
          <form onSubmit={handleGuardarEdicion} className="space-y-5">

            <div className="space-y-3 rounded-2xl bg-bm-canvas p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-bm-steel">Tarea principal</p>
                  <p className="mt-0.5 text-sm font-semibold leading-snug">{editingTask.descripcion_tarea}</p>
                </div>
                <div>
                  <p className="text-xs text-bm-steel">Razón de entrada</p>
                  <p className="mt-0.5 text-sm font-semibold text-bm-red-deep">{extractRazon(editingTask.observaciones)}</p>
                </div>
              </div>
              {contarHallazgos(editingTask.observaciones) > 0 && (
                <div className="border-t border-bm-line pt-3">
                  <p className="mb-1 text-xs text-bm-steel">Hallazgos adicionales registrados</p>
                  <p className="max-h-28 overflow-y-auto whitespace-pre-line font-data text-xs leading-relaxed text-bm-ink">
                    {editingTask.observaciones
                      .split('\n')
                      .filter((l: string) => l.includes('NUEVO HALLAZGO:'))
                      .join('\n')}
                  </p>
                </div>
              )}
            </div>

            <BmField
              label={<><PlusCircleIcon className="h-4 w-4 text-bm-red" /> Daños adicionales</>}
              htmlFor="ot-hallazgos"
              hint="Se registra con fecha y hora en el historial de la orden."
            >
              <textarea
                id="ot-hallazgos"
                rows={3}
                className={`${bmTextarea} uppercase placeholder:normal-case`}
                placeholder="Describa daños o hallazgos adicionales"
                value={editForm.nuevosHallazgos}
                onChange={e => setEditForm(prev => ({ ...prev, nuevosHallazgos: e.target.value }))}
              />
            </BmField>

            <div className="grid gap-4 sm:grid-cols-2">
              <BmField label="Técnico asignado" htmlFor="ot-mecanico">
                <input
                  id="ot-mecanico"
                  className={INPUT_CLS}
                  placeholder="Nombre del técnico"
                  value={editForm.mecanico}
                  onChange={e => setEditForm(prev => ({ ...prev, mecanico: e.target.value }))}
                />
              </BmField>

              <BmField label="Estado de la orden" htmlFor="ot-estado">
                <BmSelect
                  id="ot-estado"
                  className={SELECT_CLS}
                  value={editForm.estado}
                  onChange={e => setEditForm(prev => ({ ...prev, estado: e.target.value }))}
                >
                  <option value="In Progress">En progreso</option>
                  <option value="Pending Parts">Esperando repuestos</option>
                  <option value="On Hold">En espera</option>
                </BmSelect>
              </BmField>
            </div>

            <BmNotice tone="info" icon={<AlertCircle className="h-4 w-4" />}>
              Los nuevos hallazgos se <strong>agregan al historial</strong> con fecha y hora; no se crea
              una orden nueva. Para cerrar la orden use <strong>Cerrar orden</strong> en la tarjeta.
            </BmNotice>

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => { setIsEditOpen(false); setEditingTask(null); }}
                disabled={loadingEdit}
                className={`${bmBtn.secondary} sm:flex-1`}
              >
                Cancelar
              </button>
              <button type="submit" disabled={loadingEdit} className={`${bmBtn.primary} sm:flex-[2]`}>
                {loadingEdit
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />
                }
                {loadingEdit ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 1 — FORMULARIO DE REGISTRO
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title="Abrir orden de trabajo"
        subtitle="Paso 1 de 2: datos de la intervención"
        icon={<Wrench className="h-5 w-5" />}
        tone="red"
        z={100}
      >
        <form onSubmit={handleFormSubmit} className="space-y-5">

          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Aeronave" htmlFor="ot-unidad" required>
              <BmSelect
                id="ot-unidad"
                required
                value={newTask.matricula}
                onChange={e => setNewTask({ ...newTask, matricula: e.target.value })}
              >
                <option value="">Seleccione la matrícula</option>
                {fleet.map(ac => (
                  <option key={ac.id} value={ac.tailNumber ?? ac.matricula}>
                    {ac.tailNumber ?? ac.matricula}
                  </option>
                ))}
              </BmSelect>
            </BmField>
            <BmField label="Sede" htmlFor="ot-sede">
              <BmSelect
                id="ot-sede"
                value={newTask.sede}
                onChange={e => setNewTask({ ...newTask, sede: e.target.value as any })}
              >
                <option value="Lara">Lara</option>
                <option value="Maturín">Maturín</option>
              </BmSelect>
            </BmField>
          </div>

          <BmField label="Razón de entrada a hangar" htmlFor="ot-razon" required>
            <BmSelect
              id="ot-razon"
              required
              value={newTask.razon}
              onChange={e => setNewTask({ ...newTask, razon: e.target.value, razonCustom: '' })}
            >
              <option value="">Seleccione el motivo</option>
              {RAZONES_PREDEFINIDAS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </BmSelect>
          </BmField>

          {newTask.razon === 'Otra (especificar)' && (
            <BmField label="Especifique la razón" htmlFor="ot-razon-custom" required>
              <input
                id="ot-razon-custom"
                required
                className={INPUT_CLS}
                placeholder="Describa la razón"
                value={newTask.razonCustom}
                onChange={e => setNewTask({ ...newTask, razonCustom: e.target.value })}
              />
            </BmField>
          )}

          <BmField label="Descripción técnica detallada" htmlFor="ot-descripcion" required>
            <textarea
              id="ot-descripcion"
              required
              rows={3}
              className={`${bmTextarea} uppercase placeholder:normal-case`}
              placeholder="Detalle técnico de la intervención"
              value={newTask.descripcion}
              onChange={e => setNewTask({ ...newTask, descripcion: e.target.value })}
            />
          </BmField>

          <BmField label="Técnico asignado" htmlFor="ot-tecnico" hint="Opcional. Si queda vacío, la orden se crea como POR ASIGNAR.">
            <input
              id="ot-tecnico"
              className={INPUT_CLS}
              placeholder="Nombre del técnico"
              value={newTask.mecanico}
              onChange={e => setNewTask({ ...newTask, mecanico: e.target.value })}
            />
          </BmField>

          <button type="submit" className={`${bmBtn.primary} w-full`}>
            <ShieldAlert className="h-4 w-4" /> Revisar y confirmar
          </button>
        </form>
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 2 — CONFIRMACIÓN
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isConfirmOpen && !!pendingTask}
        onClose={handleCancelConfirm}
        busy={loading}
        title="Confirmar entrada a hangar"
        subtitle="Paso 2 de 2: esta acción cambia el estado de la aeronave"
        icon={<ShieldAlert className="h-5 w-5" />}
        tone="warn"
        size="sm"
        z={110}
      >
        {pendingTask && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-bm-line p-4">
              <p className="flex items-center gap-2 text-xs text-bm-steel">
                <Plane className="h-4 w-4 text-bm-red" /> Aeronave afectada
              </p>
              <p className="bm-heading mt-1 text-3xl tracking-tight">
                {pendingTask.matricula.toUpperCase()}
              </p>
              {targetAircraft && (
                <p className="mt-0.5 text-sm text-bm-steel">
                  {targetAircraft.model ?? targetAircraft.modelo}
                </p>
              )}
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-bm-steel">
                <MapPin className="h-3.5 w-3.5" /> Base {pendingTask.sede}
              </p>
            </div>

            <div className="rounded-2xl bg-bm-canvas p-4">
              <p className="text-xs text-bm-steel">Razón de entrada</p>
              <p className="mt-0.5 text-[15px] font-semibold">
                {pendingTask.razon === 'Otra (especificar)'
                  ? pendingTask.razonCustom
                  : pendingTask.razon}
              </p>
              <p className="mt-3 text-xs text-bm-steel">Descripción técnica</p>
              <p className="mt-0.5 line-clamp-3 text-sm uppercase leading-relaxed">
                {pendingTask.descripcion}
              </p>
            </div>

            <BmNotice tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
              La aeronave pasará a <strong>mantenimiento</strong> de inmediato y dejará de estar
              disponible para vuelos.
            </BmNotice>

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={handleCancelConfirm} disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
                Corregir
              </button>
              <button type="button" onClick={handleConfirmAndSend} disabled={loading} className={`${bmBtn.primary} sm:flex-[1.4]`}>
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ShieldCheck className="h-4 w-4" />}
                {loading ? 'Procesando…' : 'Confirmar ingreso'}
              </button>
            </div>
          </div>
        )}
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          [v5.7] MODAL — CERRAR ORDEN (reemplaza window.prompt)
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={!!closingTask}
        onClose={() => { setClosingTask(null); setCloseObs(''); }}
        busy={loading}
        title={closingTask ? `Cerrar orden: ${closingTask.matricula}` : 'Cerrar orden'}
        subtitle={closingTask ? `Mecánico: ${closingTask.nombre_mecanico}` : undefined}
        icon={<PackageCheck className="h-5 w-5" />}
        tone="dark"
        z={130}
      >
        {closingTask && (
          <form onSubmit={handleConfirmClose} className="space-y-5">
            <BmField
              label="Observaciones de cierre"
              htmlFor="ot-cierre"
              required
              hint="Trabajo efectuado, repuestos instalados y comprobaciones realizadas."
            >
              <textarea
                id="ot-cierre"
                rows={5}
                required
                autoFocus
                className={bmTextarea}
                placeholder="Describa el trabajo efectuado"
                value={closeObs}
                onChange={e => setCloseObs(e.target.value)}
              />
            </BmField>

            <BmNotice tone="warn" icon={<AlertCircle className="h-4 w-4" />}>
              Cerrar esta orden <strong>no libera la aeronave</strong>. Sigue fuera de servicio hasta su
              liberación autorizada.
            </BmNotice>

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => { setClosingTask(null); setCloseObs(''); }}
                disabled={loading}
                className={`${bmBtn.secondary} sm:flex-1`}
              >
                Cancelar
              </button>
              <button type="submit" disabled={loading || !closeObs.trim()} className={`${bmBtn.dark} sm:flex-[1.4]`}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                {loading ? 'Cerrando…' : 'Cerrar orden'}
              </button>
            </div>
          </form>
        )}
      </BmModal>

      {/* ── TARJETAS ACTIVAS ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activeTasks.map(task => {
          const hallazgos = contarHallazgos(task.observaciones);
          const est = estadoOT(task.estado);
          const asignado = task.nombre_mecanico && task.nombre_mecanico !== 'POR ASIGNAR';
          return (
            <Card key={task.id}
              className="flex flex-col overflow-hidden rounded-[20px] border border-bm-line bg-white text-bm-ink shadow-none">

              <CardHeader className="space-y-0 p-4 pb-3 sm:p-5 sm:pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="bm-heading block truncate text-2xl leading-tight tracking-tight">
                      {task.matricula}
                    </span>
                    <span className="block truncate text-[13px] text-bm-steel">
                      {task.modelo}
                    </span>
                  </div>
                  <BmBadge tone={est.tone} dot>{est.label}</BmBadge>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0 sm:p-5 sm:pt-0">

                <div className="rounded-xl bg-bm-red-tint/60 px-3 py-2.5">
                  <p className="text-xs text-bm-red-deep/80">Razón de entrada</p>
                  <p className="text-sm font-semibold text-bm-red-deep">
                    {extractRazon(task.observaciones)}
                  </p>
                </div>

                <div className="flex items-start gap-2">
                  <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-bm-hint" />
                  <p className="line-clamp-3 text-sm uppercase leading-relaxed text-bm-steel">
                    {task.descripcion_tarea}
                  </p>
                </div>

                {hallazgos > 0 && (
                  <BmBadge tone="warn" icon={<AlertCircle className="h-3.5 w-3.5" />} className="self-start">
                    {hallazgos} hallazgo{hallazgos !== 1 ? 's' : ''} adicional{hallazgos !== 1 ? 'es' : ''}
                  </BmBadge>
                )}

                <div className="mt-auto space-y-3 border-t border-bm-line pt-3">
                  <div className="flex items-center justify-between gap-3 text-[13px] text-bm-steel">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> {task.sede}
                    </span>
                    <span className={`flex min-w-0 items-center gap-1.5 ${asignado ? '' : 'text-bm-warn'}`}>
                      <UserRound className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{asignado ? task.nombre_mecanico : 'Sin mecánico'}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-2">
                    <button
                      type="button"
                      onClick={() => handleAbrirEdicion(task)}
                      title="Agregar hallazgos o actualizar orden"
                      className={`${bmBtn.secondary} ${bmBtn.sm}`}
                    >
                      <Pencil className="h-4 w-4" /> Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFinalCertification(task)}
                      className={`${bmBtn.dark} ${bmBtn.sm}`}
                    >
                      <PackageCheck className="h-4 w-4" /> Cerrar orden
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {activeTasks.length === 0 && (
          <div className="col-span-full rounded-[24px] border border-dashed border-bm-line bg-white">
            <BmEmpty
              icon={<Wrench className="h-5 w-5" />}
              title="Sin intervenciones activas"
              text="Cuando una aeronave entre a hangar, su orden de trabajo aparecerá aquí."
              action={
                <button type="button" onClick={() => setIsFormOpen(true)} className={bmBtn.primary}>
                  <PlusCircle className="h-5 w-5" /> Abrir orden
                </button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
};

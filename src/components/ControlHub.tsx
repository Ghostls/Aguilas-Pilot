// src/components/ControlHub.tsx
// VALKYRON OS v5.1 — EDICIÓN DE ÓRDENES ACTIVAS + NUEVOS HALLAZGOS
// v5.1 NUEVO:
//   — Botón "Editar" en cada tarjeta activa de mantenimiento
//   — Modal de edición: nuevos hallazgos se concatenan a observaciones con timestamp
//   — Permite actualizar técnico asignado y estado de la orden sin crear una nueva
//   — Mismo patrón de auditoría que FleetDashboard v5.2
// v5.0 PRESERVADO: Modal confirmación 2 pasos, razón de entrada obligatoria,
//   flota_id UUID fix, liberación de aeronave, fallback sin JOIN
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import React, { useState, useEffect } from 'react';
import { SparePart } from '../Types/Maintenance';
import { Card, CardHeader, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  PlusCircle, X, Wrench, AlertCircle,
  PackageCheck, Loader2, ShieldAlert, ShieldCheck,
  Plane, MapPin, ClipboardList, Pencil,
  PlusCircle as PlusCircleIcon, CheckCircle2,
} from 'lucide-react';

// ─── INTERFACES ───────────────────────────────────────────────────────────────

interface ControlHubProps {
  tasks?:         any[];
  setTasks?:      React.Dispatch<React.SetStateAction<any[]>>;
  fleet?:         any[];
  setFleet?:      React.Dispatch<React.SetStateAction<any[]>>;
  inventory?:     SparePart[];
  onPartsUsage?:  (partsUsed: { pn: string; qty: number }[], aircraftId: string) => void;
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

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-xs
  outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all
  placeholder:text-white/20 font-mono`;

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

export const ControlHub: React.FC<ControlHubProps> = ({
  tasks: externalTasks = [],
  setTasks: setExternalTasks = () => {},
  fleet = [],
  setFleet = () => {},
  inventory = [],
}) => {
  const [isFormOpen,    setIsFormOpen]    = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isEditOpen,    setIsEditOpen]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [loadingEdit,   setLoadingEdit]   = useState(false);
  const [pendingTask,   setPendingTask]   = useState<typeof newTask | null>(null);
  const [editingTask,   setEditingTask]   = useState<any | null>(null);

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
    ac => ac.tailNumber === newTask.matricula.toUpperCase()
  );

  // ─── CARGAR ÓRDENES ───────────────────────────────────────────────────────

  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*, flota_aviones(id)')
        .neq('estado', 'Completed')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped = data.map((t: any) => ({
          ...t,
          flota_id: Array.isArray(t.flota_aviones)
            ? t.flota_aviones[0]?.id ?? null
            : t.flota_aviones?.id ?? null,
        }));
        setExternalTasks(mapped);
      } else if (error) {
        console.warn('[ControlHub] JOIN flota_aviones falló, fallback:', error.message);
        const { data: fallback } = await supabase
          .from('ordenes_trabajo')
          .select('*')
          .neq('estado', 'Completed')
          .order('created_at', { ascending: false });
        if (fallback) setExternalTasks(fallback);
      }
    };
    fetchOrders();
  }, [setExternalTasks]);

  const activeTasks = externalTasks.filter(t => t.estado !== 'Completed');

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

    const sinCambios =
      !editForm.nuevosHallazgos.trim() &&
      editForm.mecanico === editingTask.nombre_mecanico &&
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

      const { data: updated, error } = await supabase
        .from('ordenes_trabajo')
        .update({
          nombre_mecanico: editForm.mecanico.trim() || editingTask.nombre_mecanico,
          estado:          editForm.estado,
          observaciones:   obsNueva,
        })
        .eq('id', editingTask.id)
        .select()
        .single();

      if (error) throw error;

      // Actualizar la tarjeta en estado local sin re-fetch
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

  const handleConfirmAndSend = async () => {
    if (!pendingTask) return;
    setLoading(true);

    const matriculaUpper = pendingTask.matricula.toUpperCase();
    const razon = pendingTask.razon === 'Otra (especificar)'
      ? pendingTask.razonCustom.trim()
      : pendingTask.razon;
    const modeloDetectado =
      fleet.find(ac => ac.tailNumber === matriculaUpper)?.model || 'MODELO NO DETECTADO';

    const dbEntry = {
      matricula:         matriculaUpper,
      modelo:            modeloDetectado,
      descripcion_tarea: pendingTask.descripcion,
      sede:              pendingTask.sede,
      nombre_mecanico:   pendingTask.mecanico || 'POR ASIGNAR',
      estado:            'In Progress',
      observaciones:     `RAZÓN DE ENTRADA: ${razon.toUpperCase()} | VALKYRON TERMINAL`,
    };

    const { data, error } = await supabase
      .from('ordenes_trabajo').insert([dbEntry]).select();

    if (!error && data) {
      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'maintenance' })
        .eq('matricula', matriculaUpper);

      if (fleetError) {
        console.error('FALLA CAMBIO ESTATUS FLOTA:', fleetError);
      } else {
        setFleet(prev =>
          prev.map(ac =>
            ac.tailNumber === matriculaUpper ? { ...ac, status: 'maintenance' } : ac
          )
        );
      }

      setExternalTasks([data[0], ...externalTasks]);
      setIsConfirmOpen(false);
      setPendingTask(null);
      setNewTask({ matricula: '', descripcion: '', sede: 'Lara', mecanico: '', razon: '', razonCustom: '' });
    } else {
      alert(`FALLA TÁCTICA: ${error?.message}`);
      setIsConfirmOpen(false);
      setIsFormOpen(true);
    }
    setLoading(false);
  };

  const handleCancelConfirm = () => {
    setIsConfirmOpen(false);
    setIsFormOpen(true);
  };

  // ─── LIBERACIÓN DE AERONAVE ───────────────────────────────────────────────

  const handleFinalCertification = async (task: any) => {
    try {
      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({ estado: 'Completed', fecha_cierre: new Date().toISOString() })
        .eq('id', task.id);
      if (error) throw error;

      const fleetFilter = task.flota_id
        ? { field: 'id',       value: task.flota_id  }
        : { field: 'matricula', value: task.matricula };

      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'operational' })
        .eq(fleetFilter.field, fleetFilter.value);

      if (fleetError) {
        console.error('FALLA LIBERACIÓN FLOTA:', fleetError);
      } else {
        setFleet((prev: any[]) =>
          prev.map(ac =>
            (task.flota_id && ac.id === task.flota_id) || ac.tailNumber === task.matricula
              ? { ...ac, status: 'operational', estado: 'operational' }
              : ac
          )
        );
      }

      setExternalTasks((prev: any[]) => prev.filter(t => t.id !== task.id));
      alert(`[CERTIFICADO] ${task.matricula} LIBERADA Y OPERATIVA.`);
    } catch (err: any) {
      alert(`ERROR: ${err.message}`);
    }
  };

  // ─── HELPER ───────────────────────────────────────────────────────────────

  const extractRazon = (obs: string): string => {
    if (!obs) return '—';
    const match = obs.match(/RAZÓN DE ENTRADA:\s*(.+?)\s*\|/i);
    return match ? match[1] : obs.split('|')[0].trim();
  };

  // Contar hallazgos adicionales en observaciones (líneas con timestamp)
  const contarHallazgos = (obs: string): number => {
    if (!obs) return 0;
    return (obs.match(/\[.*?\] NUEVO HALLAZGO:/g) ?? []).length;
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">

      {/* Toolbar */}
      <div className="flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/10
                      backdrop-blur-md text-left">
        <div className="flex items-center gap-3">
          <Wrench className="h-5 w-5 text-[#E1AD01]" />
          <div className="text-left">
            <h2 className="text-white font-black text-xs uppercase tracking-[0.3em]">
              Hangar Operations Hub
            </h2>
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-tighter italic">
              MIA v5.1 // Confirmación Táctica + Edición de Órdenes
            </p>
          </div>
        </div>
        <button onClick={() => setIsFormOpen(true)}
          className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px]
                     hover:bg-white transition-all uppercase tracking-widest shadow-xl
                     flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Abrir Tarjeta
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════
          MODAL — EDITAR ORDEN DE TRABAJO
      ════════════════════════════════════════════════════════════ */}
      {isEditOpen && editingTask && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[120] flex items-center
                        justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/40 w-full max-w-lg
                          rounded-[2.5rem] shadow-[0_0_80px_rgba(225,173,1,0.12)] overflow-hidden">

            {/* Header */}
            <div className="bg-[#E1AD01]/10 border-b border-[#E1AD01]/20 px-7 py-5
                            flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <ClipboardList size={18} className="text-black" />
                </div>
                <div>
                  <p className="text-[11px] font-black text-white uppercase tracking-wider">
                    Actualizar Orden de Trabajo
                  </p>
                  <p className="text-[9px] text-[#E1AD01]/70 font-mono uppercase tracking-widest mt-0.5">
                    {editingTask.matricula} · {editingTask.modelo}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setIsEditOpen(false); setEditingTask(null); }}
                className="text-zinc-600 hover:text-white hover:rotate-90 transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} className="p-7 space-y-5 font-mono">

              {/* Resumen de la orden actual — solo lectura */}
              <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-3">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest">
                  Estado actual de la orden
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Tarea principal</p>
                    <p className="text-[10px] text-white font-black uppercase mt-0.5 leading-snug">
                      {editingTask.descripcion_tarea}
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Razón de entrada</p>
                    <p className="text-[10px] text-[#E1AD01] font-black uppercase mt-0.5">
                      {extractRazon(editingTask.observaciones)}
                    </p>
                  </div>
                </div>
                {contarHallazgos(editingTask.observaciones) > 0 && (
                  <div className="border-t border-white/5 pt-3">
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">
                      Hallazgos adicionales registrados
                    </p>
                    <p className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-line
                                  max-h-24 overflow-y-auto">
                      {editingTask.observaciones
                        .split('\n')
                        .filter((l: string) => l.includes('NUEVO HALLAZGO:'))
                        .join('\n')}
                    </p>
                  </div>
                )}
              </div>

              {/* Nuevos hallazgos */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest
                                  flex items-center gap-2 ">
                  <PlusCircleIcon size={12} /> Daños Adicionales
                </label>
                <textarea
                  rows={3}
                  className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white
                             text-xs resize-none outline-none focus:border-[#E1AD01] transition-all
                             placeholder:text-white/20 uppercase font-mono"
                  placeholder="Describir daños o hallazgos adicionales encontrados durante la revisión..."
                  value={editForm.nuevosHallazgos}
                  onChange={e => setEditForm(prev => ({ ...prev, nuevosHallazgos: e.target.value }))}
                />
                <p className="text-[8px] text-zinc-700 font-mono">
                  Se registrará con timestamp automático en el historial de la orden.
                </p>
              </div>

              {/* Técnico asignado */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">
                  Técnico Asignado
                </label>
                <input
                  className={INPUT_CLS}
                  placeholder="Nombre del técnico"
                  value={editForm.mecanico}
                  onChange={e => setEditForm(prev => ({ ...prev, mecanico: e.target.value }))}
                />
              </div>

              {/* Estado de la orden */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">
                  Estado de la Orden
                </label>
                <select
                  className={SELECT_CLS}
                  value={editForm.estado}
                  onChange={e => setEditForm(prev => ({ ...prev, estado: e.target.value }))}
                >
                  <option value="In Progress">EN PROGRESO</option>
                  <option value="Pending Parts">ESPERANDO REPUESTOS</option>
                  <option value="On Hold">EN ESPERA</option>
                </select>
                <p className="text-[8px] text-zinc-700 font-mono">
                  Para cerrar la orden usa "Finalizar Misión" desde la tarjeta.
                </p>
              </div>

              {/* Info */}
              <div className="flex items-start gap-2 bg-[#E1AD01]/5 border border-[#E1AD01]/15
                              rounded-xl p-3">
                <AlertCircle size={13} className="text-[#E1AD01] shrink-0 mt-0.5" />
                <p className="text-[9px] text-[#E1AD01]/70 leading-relaxed">
                  Los nuevos hallazgos se <span className="font-black text-[#E1AD01]">agregan al historial</span> de
                  la orden con fecha y hora. No se crea una orden nueva.
                </p>
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setIsEditOpen(false); setEditingTask(null); }}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loadingEdit}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black
                             uppercase hover:bg-white transition-all disabled:opacity-40
                             flex items-center justify-center gap-2"
                >
                  {loadingEdit
                    ? <Loader2 size={14} className="animate-spin" />
                    : <CheckCircle2 size={14} />
                  }
                  {loadingEdit ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 1 — FORMULARIO DE REGISTRO
      ════════════════════════════════════════════════════════════ */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center
                        justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl
                          overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black
                            uppercase text-xs tracking-widest">
              <div className="flex items-center gap-2 italic">
                <Wrench className="h-4 w-4" /> Registrar Intervención
              </div>
              <button onClick={() => setIsFormOpen(false)} className="hover:rotate-90 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-8 space-y-5 text-left font-mono">

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                    Unidad *
                  </label>
                  <select required className={SELECT_CLS}
                    value={newTask.matricula}
                    onChange={e => setNewTask({ ...newTask, matricula: e.target.value })}>
                    <option value="">— SELECCIONAR —</option>
                    {fleet.map(ac => (
                      <option key={ac.id} value={ac.tailNumber}>{ac.tailNumber}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                    Sede
                  </label>
                  <select className={SELECT_CLS}
                    value={newTask.sede}
                    onChange={e => setNewTask({ ...newTask, sede: e.target.value as any })}>
                    <option value="Lara">Lara</option>
                    <option value="Maturín">Maturín</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-2">
                  Razón de Entrada a Hangar *
                </label>
                <select required className={SELECT_CLS}
                  value={newTask.razon}
                  onChange={e => setNewTask({ ...newTask, razon: e.target.value, razonCustom: '' })}>
                  <option value="">— SELECCIONAR MOTIVO —</option>
                  {RAZONES_PREDEFINIDAS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {newTask.razon === 'Otra (especificar)' && (
                <div>
                  <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-2">
                    Especificar Razón *
                  </label>
                  <input required
                    className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white
                               text-xs uppercase outline-none focus:border-[#E1AD01] placeholder:text-white/20"
                    placeholder="DESCRIBIR LA RAZÓN..."
                    value={newTask.razonCustom}
                    onChange={e => setNewTask({ ...newTask, razonCustom: e.target.value })}
                  />
                </div>
              )}

              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Descripción Técnica Detallada *
                </label>
                <textarea required rows={3}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs resize-none outline-none focus:border-[#E1AD01]
                             placeholder:text-white/20 uppercase transition-all font-mono"
                  placeholder="Detalle técnico de la intervención..."
                  value={newTask.descripcion}
                  onChange={e => setNewTask({ ...newTask, descripcion: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Técnico Asignado
                </label>
                <input
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs uppercase outline-none focus:border-[#E1AD01]
                             placeholder:text-white/20 transition-all font-mono"
                  placeholder="Nombre del técnico (opcional)"
                  value={newTask.mecanico}
                  onChange={e => setNewTask({ ...newTask, mecanico: e.target.value })}
                />
              </div>

              <button type="submit"
                className="w-full bg-[#E1AD01] text-black font-black py-5 rounded-2xl uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl
                           flex items-center justify-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Revisar y Confirmar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 2 — CONFIRMACIÓN TÁCTICA
      ════════════════════════════════════════════════════════════ */}
      {isConfirmOpen && pendingTask && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[110] flex items-center
                        justify-center p-4">
          <div className="bg-[#0a0a0a] border border-amber-500/40 w-full max-w-sm rounded-3xl
                          overflow-hidden shadow-[0_0_60px_rgba(225,173,1,0.15)]">

            <div className="bg-amber-500/10 border-b border-amber-500/20 p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <ShieldAlert className="h-5 w-5 text-black" />
                </div>
                <div>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">
                    Confirmar Entrada a Hangar
                  </p>
                  <p className="text-[9px] text-amber-400/70 font-mono uppercase tracking-widest">
                    Esta acción cambia el estatus de la aeronave
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Plane className="h-4 w-4 text-[#E1AD01]" />
                  <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
                    Aeronave Afectada
                  </p>
                </div>
                <p className="text-2xl font-black text-white font-mono uppercase tracking-tighter">
                  {pendingTask.matricula.toUpperCase()}
                </p>
                {targetAircraft && (
                  <p className="text-[10px] text-[#E1AD01] font-mono mt-1 italic">
                    {targetAircraft.model}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  <MapPin className="h-3 w-3 text-zinc-600" />
                  <p className="text-[9px] text-zinc-500 uppercase font-mono">Base {pendingTask.sede}</p>
                </div>
              </div>

              <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/25 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="h-3.5 w-3.5 text-[#E1AD01]" />
                  <p className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest">
                    Razón de Entrada
                  </p>
                </div>
                <p className="text-[12px] font-black text-white uppercase">
                  {pendingTask.razon === 'Otra (especificar)'
                    ? pendingTask.razonCustom
                    : pendingTask.razon}
                </p>
              </div>

              <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05]">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">
                  Descripción Técnica
                </p>
                <p className="text-[10px] text-zinc-400 font-mono uppercase leading-relaxed line-clamp-3">
                  {pendingTask.descripcion}
                </p>
              </div>

              <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-red-400/80 leading-relaxed">
                  La aeronave cambiará a estado{' '}
                  <span className="font-black text-red-400">MANTENIMIENTO</span> inmediatamente
                  y dejará de aparecer como operativa.
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={handleCancelConfirm}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                  Corregir
                </button>
                <button onClick={handleConfirmAndSend} disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black
                             uppercase hover:bg-white transition-all shadow-lg disabled:opacity-40
                             flex items-center justify-center gap-2">
                  {loading
                    ? <Loader2 className="animate-spin h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4" />}
                  {loading ? 'Procesando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TARJETAS ACTIVAS ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeTasks.map(task => {
          const hallazgos = contarHallazgos(task.observaciones);
          return (
            <Card key={task.id}
              className="bg-[#0f0f0f] border border-white/10 shadow-2xl transition-all relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#E1AD01]
                              shadow-[0_0_15px_#E1AD01]" />

              <CardHeader className="border-b border-white/5 pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="font-black text-white text-2xl font-mono uppercase">
                      {task.matricula}
                    </span>
                    <span className="text-[9px] text-[#E1AD01] font-black uppercase italic tracking-widest">
                      {task.modelo}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] px-2 py-0.5 rounded border border-[#E1AD01]/20
                                     text-[#E1AD01] font-black uppercase">
                      {task.estado}
                    </span>
                    {/* Botón Editar */}
                    <button
                      onClick={() => handleAbrirEdicion(task)}
                      title="Agregar hallazgos o actualizar orden"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-white/10
                                 text-zinc-500 text-[8px] font-black uppercase tracking-wider
                                 hover:border-[#E1AD01]/40 hover:text-[#E1AD01] hover:bg-[#E1AD01]/5
                                 transition-all"
                    >
                      <Pencil size={10} /> Editar
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-5 space-y-4 text-left font-mono">

                {/* Razón de entrada */}
                <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/15 rounded-xl px-3 py-2.5">
                  <p className="text-[8px] text-[#E1AD01]/60 font-black uppercase tracking-widest mb-0.5">
                    Razón de Entrada
                  </p>
                  <p className="text-[10px] text-[#E1AD01] font-black uppercase">
                    {extractRazon(task.observaciones)}
                  </p>
                </div>

                {/* Descripción técnica */}
                <div className="flex items-start gap-2">
                  <ClipboardList className="h-3 w-3 text-slate-600 mt-0.5 shrink-0" />
                  <p className="text-[10px] text-slate-300 uppercase leading-relaxed line-clamp-3">
                    {task.descripcion_tarea}
                  </p>
                </div>

                {/* Badge de hallazgos adicionales */}
                {hallazgos > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/5
                                  border border-orange-500/20 rounded-xl">
                    <AlertCircle size={11} className="text-orange-400 shrink-0" />
                    <p className="text-[8px] text-orange-400 font-black uppercase tracking-widest">
                      {hallazgos} hallazgo{hallazgos !== 1 ? 's' : ''} adicional{hallazgos !== 1 ? 'es' : ''} registrado{hallazgos !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}

                <div className="border-t border-white/5 pt-4 space-y-3">
                  <div className="flex items-center justify-between text-[9px] text-slate-500
                                  uppercase font-black tracking-widest">
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-[#E1AD01]/50" /> {task.sede}
                    </span>
                    {task.nombre_mecanico && task.nombre_mecanico !== 'POR ASIGNAR' && (
                      <span className="text-zinc-600 italic">{task.nombre_mecanico}</span>
                    )}
                  </div>
                  <button onClick={() => handleFinalCertification(task)}
                    className="w-full bg-[#E1AD01] text-black font-black py-4 rounded-xl hover:bg-white
                               transition-all text-[10px] tracking-[0.2em]
                               flex items-center justify-center gap-2">
                    <PackageCheck className="h-4 w-4" /> Finalizar Misión
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {activeTasks.length === 0 && (
          <div className="col-span-3 text-center py-20 text-zinc-700">
            <Wrench className="h-10 w-10 mx-auto mb-4 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest">
              Sin intervenciones activas
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
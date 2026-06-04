// src/components/ControlHub.tsx
// VALKYRON OS v5.0 — Evolución: Modal de Confirmación + Razón de Entrada Obligatoria
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import React, { useState, useEffect } from 'react';
import { SparePart } from '../Types/Maintenance';
import { Card, CardHeader, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  PlusCircle, X, Wrench, AlertCircle,
  PackageCheck, Loader2, ShieldAlert, ShieldCheck,
  Plane, MapPin, ClipboardList
} from 'lucide-react';

interface ControlHubProps {
  tasks?: any[];
  setTasks?: React.Dispatch<React.SetStateAction<any[]>>;
  fleet?: any[];
  setFleet?: React.Dispatch<React.SetStateAction<any[]>>;
  inventory?: SparePart[];
  onPartsUsage?: (partsUsed: { pn: string; qty: number }[], aircraftId: string) => void;
}

// Catálogo de razones predefinidas — el operador puede seleccionar o escribir custom
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

// Estilo select global
const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-xs
  outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

export const ControlHub: React.FC<ControlHubProps> = ({
  tasks: externalTasks = [],
  setTasks: setExternalTasks = () => {},
  fleet = [],
  setFleet = () => {},
  inventory = [],
}) => {
  const [isFormOpen, setIsFormOpen]         = useState(false);
  const [isConfirmOpen, setIsConfirmOpen]   = useState(false);
  const [loading, setLoading]               = useState(false);
  const [pendingTask, setPendingTask]       = useState<typeof newTask | null>(null);

  const [newTask, setNewTask] = useState({
    matricula:   '',
    descripcion: '',
    sede:        'Lara' as 'Lara' | 'Maturín',
    mecanico:    '',
    razon:       '',        // Razón predefinida seleccionada
    razonCustom: '',        // Si elige "Otra"
  });

  // Razón final — custom si eligió "Otra", sino la predefinida
  const razonFinal = newTask.razon === 'Otra (especificar)'
    ? newTask.razonCustom.trim()
    : newTask.razon;

  const targetAircraft = fleet.find(
    ac => ac.tailNumber === newTask.matricula.toUpperCase()
  );

  useEffect(() => {
    const fetchOrders = async () => {
      // FIX v5.1: JOIN para traer flota_id — evita mismatch matrícula (YV116 vs YV-116E)
      // Usamos id UUID de flota_aviones para el update de liberación — infalible
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
        // Fallback sin JOIN si no existe FK entre tablas aún
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

  // PASO 1: Validar form → abrir modal de confirmación
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

  // PASO 2: Usuario confirma → escribir en DB
  const handleConfirmAndSend = async () => {
    if (!pendingTask) return;
    setLoading(true);

    const matriculaUpper = pendingTask.matricula.toUpperCase();
    const razon = pendingTask.razon === 'Otra (especificar)'
      ? pendingTask.razonCustom.trim()
      : pendingTask.razon;
    const modeloDetectado = fleet.find(ac => ac.tailNumber === matriculaUpper)?.model || 'MODELO NO DETECTADO';

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
      // Cambiar estado del avión a maintenance en DB
      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'maintenance' })
        .eq('matricula', matriculaUpper);

      if (fleetError) {
        console.error('FALLA CAMBIO ESTATUS FLOTA:', fleetError);
      } else {
        // Reflejar inmediatamente en estado local
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
      // Reabrir form si falla
      setIsConfirmOpen(false);
      setIsFormOpen(true);
    }
    setLoading(false);
  };

  const handleCancelConfirm = () => {
    setIsConfirmOpen(false);
    setIsFormOpen(true); // Volver al form sin perder datos
  };

  // Liberación de aeronave
  // FIX v5.1: usa task.flota_id (UUID) en lugar de task.matricula para el update
  // task.matricula puede tener mismatch de guiones — el UUID es infalible
  const handleFinalCertification = async (task: any) => {
    try {
      // 1. Cerrar orden de trabajo
      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({ estado: 'Completed', fecha_cierre: new Date().toISOString() })
        .eq('id', task.id);
      if (error) throw error;

      // 2. Liberar aeronave — priorizar flota_id (UUID), fallback a matricula
      const fleetFilter = task.flota_id
        ? { field: 'id', value: task.flota_id }
        : { field: 'matricula', value: task.matricula };

      const { error: fleetError } = await supabase
        .from('flota_aviones')
        .update({ estado: 'operational' })
        .eq(fleetFilter.field, fleetFilter.value);

      if (fleetError) {
        console.error('FALLA LIBERACIÓN FLOTA:', fleetError);
      } else {
        // 3. Reflejar en estado local inmediatamente
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

  // Extraer razón de entrada desde observaciones guardadas
  const extractRazon = (obs: string): string => {
    if (!obs) return '—';
    const match = obs.match(/RAZÓN DE ENTRADA:\s*(.+?)\s*\|/i);
    return match ? match[1] : obs.split('|')[0].trim();
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">

      {/* Toolbar */}
      <div className="flex justify-between items-center bg-white/5 p-5 rounded-2xl border border-white/10
                      backdrop-blur-md text-left">
        <div className="flex items-center gap-3">
          <Wrench className="h-5 w-5 text-[#E1AD01]" />
          <div className="text-left">
            <h2 className="text-white font-black text-xs uppercase tracking-[0.3em]">Hangar Operations Hub</h2>
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-tighter italic">
              MIA v5.0 // Confirmación Táctica Activada
            </p>
          </div>
        </div>
        <button onClick={() => setIsFormOpen(true)}
          className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px]
                     hover:bg-white transition-all uppercase tracking-widest shadow-xl flex items-center gap-2">
          <PlusCircle className="h-4 w-4" /> Abrir Tarjeta
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          MODAL PASO 1 — FORMULARIO DE REGISTRO
      ══════════════════════════════════════════════════════════════ */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl
                          overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs tracking-widest">
              <div className="flex items-center gap-2 italic">
                <Wrench className="h-4 w-4" /> Registrar Intervención
              </div>
              <button onClick={() => setIsFormOpen(false)} className="hover:rotate-90 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-8 space-y-5 text-left font-mono">

              {/* Aeronave + Sede */}
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

              {/* RAZÓN DE ENTRADA — campo nuevo crítico */}
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

              {/* Campo custom si elige "Otra" */}
              {newTask.razon === 'Otra (especificar)' && (
                <div>
                  <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block mb-2">
                    Especificar Razón *
                  </label>
                  <input
                    required
                    className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white
                               text-xs uppercase outline-none focus:border-[#E1AD01] placeholder:text-white/20"
                    placeholder="DESCRIBIR LA RAZÓN..."
                    value={newTask.razonCustom}
                    onChange={e => setNewTask({ ...newTask, razonCustom: e.target.value })}
                  />
                </div>
              )}

              {/* Descripción técnica */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Descripción Técnica Detallada *
                </label>
                <textarea required rows={3}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs resize-none outline-none focus:border-[#E1AD01] placeholder:text-white/20
                             uppercase transition-all font-mono"
                  placeholder="Detalle técnico de la intervención..."
                  value={newTask.descripcion}
                  onChange={e => setNewTask({ ...newTask, descripcion: e.target.value })}
                />
              </div>

              {/* Mecánico */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block mb-2">
                  Técnico Asignado
                </label>
                <input
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs uppercase outline-none focus:border-[#E1AD01] placeholder:text-white/20
                             transition-all font-mono"
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

      {/* ══════════════════════════════════════════════════════════════
          MODAL PASO 2 — CONFIRMACIÓN TÁCTICA
      ══════════════════════════════════════════════════════════════ */}
      {isConfirmOpen && pendingTask && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[110] flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-amber-500/40 w-full max-w-sm rounded-3xl
                          overflow-hidden shadow-[0_0_60px_rgba(225,173,1,0.15)]">

            {/* Header de advertencia */}
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

            {/* Resumen de la operación */}
            <div className="p-6 space-y-4">

              {/* Aeronave */}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Plane className="h-4 w-4 text-[#E1AD01]" />
                  <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Aeronave Afectada</p>
                </div>
                <p className="text-2xl font-black text-white font-mono uppercase tracking-tighter">
                  {pendingTask.matricula.toUpperCase()}
                </p>
                {targetAircraft && (
                  <p className="text-[10px] text-[#E1AD01] font-mono mt-1 italic">{targetAircraft.model}</p>
                )}
                <div className="flex items-center gap-1.5 mt-2">
                  <MapPin className="h-3 w-3 text-zinc-600" />
                  <p className="text-[9px] text-zinc-500 uppercase font-mono">Base {pendingTask.sede}</p>
                </div>
              </div>

              {/* Razón — lo más importante */}
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

              {/* Descripción técnica resumida */}
              <div className="bg-white/[0.02] rounded-xl p-3 border border-white/[0.05]">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">
                  Descripción Técnica
                </p>
                <p className="text-[10px] text-zinc-400 font-mono uppercase leading-relaxed line-clamp-3">
                  {pendingTask.descripcion}
                </p>
              </div>

              {/* Advertencia de cambio de estado */}
              <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-red-400/80 leading-relaxed">
                  La aeronave cambiará a estado <span className="font-black text-red-400">MANTENIMIENTO</span> inmediatamente
                  y dejará de aparecer como operativa.
                </p>
              </div>

              {/* Botones */}
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

      {/* ── TARJETAS ACTIVAS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeTasks.map(task => (
          <Card key={task.id}
            className="bg-[#0f0f0f] border border-white/10 shadow-2xl transition-all relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#E1AD01] shadow-[0_0_15px_#E1AD01]" />
            <CardHeader className="border-b border-white/5 pb-4">
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="font-black text-white text-2xl font-mono uppercase">{task.matricula}</span>
                  <span className="text-[9px] text-[#E1AD01] font-black uppercase italic tracking-widest">
                    {task.modelo}
                  </span>
                </div>
                <span className="text-[8px] px-2 py-0.5 rounded border border-[#E1AD01]/20
                                 text-[#E1AD01] font-black uppercase">
                  {task.estado}
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-4 text-left font-mono">

              {/* Razón de entrada — destacada en la tarjeta */}
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

              <div className="border-t border-white/5 pt-4 space-y-3">
                <div className="flex items-center justify-between text-[9px] text-slate-500 uppercase font-black tracking-widest">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3 text-[#E1AD01]/50" /> {task.sede}
                  </span>
                  {task.nombre_mecanico && task.nombre_mecanico !== 'POR ASIGNAR' && (
                    <span className="text-zinc-600 italic">{task.nombre_mecanico}</span>
                  )}
                </div>
                <button onClick={() => handleFinalCertification(task)}
                  className="w-full bg-[#E1AD01] text-black font-black py-4 rounded-xl hover:bg-white
                             transition-all text-[10px] tracking-[0.2em] flex items-center justify-center gap-2">
                  <PackageCheck className="h-4 w-4" /> Finalizar Misión
                </button>
              </div>
            </CardContent>
          </Card>
        ))}

        {activeTasks.length === 0 && (
          <div className="col-span-3 text-center py-20 text-zinc-700">
            <Wrench className="h-10 w-10 mx-auto mb-4 opacity-20" />
            <p className="text-[10px] font-black uppercase tracking-widest">Sin intervenciones activas</p>
          </div>
        )}
      </div>
    </div>
  );
};
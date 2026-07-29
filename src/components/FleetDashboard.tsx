// src/components/FleetDashboard.tsx
// VALKYRON OS v5.2 — EDICIÓN DE ÓRDENES DE TRABAJO EN MANTENIMIENTO
// v5.2 NUEVO:
//   — Botón "Editar" en tarjetas de aeronaves con estado maintenance
//   — Modal de edición que hace UPDATE a ordenes_trabajo por matrícula
//   — Permite agregar daños adicionales sin crear una nueva orden
//   — Campo "nuevos hallazgos" se concatena al campo observaciones existente
//     con timestamp para trazabilidad de auditoría
// v5.1 PRESERVADO: Canal Realtime eliminado (lo maneja Index.tsx)
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import React, { useState } from 'react';
import { Aircraft } from '@/Types/Maintenance';
import AircraftCard from './AircraftCard';
import AircraftDetail from './AircraftDetail';
import { supabase } from '../lib/supabaseClient';
import {
  Plane, Plus, X, Gauge, ShieldCheck, Loader2,
  Wrench, ShieldAlert, AlertCircle, Pencil, PlusCircle,
  ClipboardList, CheckCircle2,
} from 'lucide-react';

// ─── NORMALIZACIÓN ────────────────────────────────────────────────────────────

const normalizeAircraftStatus = (
  rawStatus: string
): 'operational' | 'maintenance' | 'grounded' | 'flight' => {
  if (!rawStatus) return 'operational';
  const s = rawStatus.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight'))               return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  return 'operational';
};

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  font-black outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 font-mono`;

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

// ─── TIPOS INTERNOS ───────────────────────────────────────────────────────────

interface OrdenExistente {
  id:                string;
  matricula:         string;
  modelo:            string;
  descripcion_tarea: string;
  nombre_mecanico:   string;
  observaciones:     string;
  estado:            string;
  sede:              string;
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

const FleetDashboard = ({
  fleetData,
  setFleetData,
}: {
  fleetData: Aircraft[];
  setFleetData: React.Dispatch<React.SetStateAction<Aircraft[]>>;
}) => {
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [isModalOpen,      setIsModalOpen]       = useState(false);
  const [isRazonOpen,      setIsRazonOpen]       = useState(false);
  const [isEditOpen,       setIsEditOpen]        = useState(false);
  const [loading,          setLoading]           = useState(false);
  const [pendingAircraft,  setPendingAircraft]   = useState<any>(null);

  // Orden de trabajo existente que se está editando
  const [ordenEditing, setOrdenEditing] = useState<OrdenExistente | null>(null);
  const [editForm, setEditForm] = useState({
    nuevosHallazgos: '',   // daños adicionales encontrados durante la revisión
    mecanico:        '',   // puede cambiar/confirmar el técnico asignado
    estado:          'In Progress' as string,
  });

  const [newAircraft, setNewAircraft] = useState({
    tailNumber:  '',
    model:       '',
    totalHours:  0,
    status:      'operational' as 'operational' | 'maintenance' | 'grounded' | 'flight',
    sede:        'LARA' as 'LARA' | 'MATURIN',
  });

  const [razonForm, setRazonForm] = useState({
    razon:       '',
    razonCustom: '',
    mecanico:    '',
    descripcion: '',
  });

  const razonFinal = razonForm.razon === 'Otra (especificar)'
    ? razonForm.razonCustom.trim()
    : razonForm.razon;

  // ── ABRIR MODAL DE EDICIÓN ────────────────────────────────────────────────

  const handleEditarMantenimiento = async (ac: Aircraft) => {
    setLoading(true);
    try {
      // Buscar la orden de trabajo activa por matrícula
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*')
        .eq('matricula', ac.tailNumber ?? (ac as any).matricula)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        alert('No se encontró una orden de trabajo activa para esta aeronave.');
        return;
      }

      setOrdenEditing(data as OrdenExistente);
      setEditForm({
        nuevosHallazgos: '',
        mecanico:        data.nombre_mecanico ?? '',
        estado:          data.estado ?? 'In Progress',
      });
      setIsEditOpen(true);
    } catch (err: any) {
      alert('Error al cargar la orden: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── GUARDAR EDICIÓN ───────────────────────────────────────────────────────

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ordenEditing) return;
    if (!editForm.nuevosHallazgos.trim() && editForm.mecanico === ordenEditing.nombre_mecanico && editForm.estado === ordenEditing.estado) {
      alert('No hay cambios para guardar.');
      return;
    }

    setLoading(true);
    try {
      // Construir observaciones actualizadas con timestamp de auditoría
      const timestamp  = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const obsActual = ordenEditing.observaciones ?? '';
      const obsNueva  = editForm.nuevosHallazgos.trim()
        ? `${obsActual}\n[${timestamp}] NUEVO HALLAZGO: ${editForm.nuevosHallazgos.trim().toUpperCase()}`
        : obsActual;

      const { error } = await supabase
        .from('ordenes_trabajo')
        .update({
          nombre_mecanico: editForm.mecanico.trim() || ordenEditing.nombre_mecanico,
          estado:          editForm.estado,
          observaciones:   obsNueva,
        })
        .eq('id', ordenEditing.id);

      if (error) throw error;

      setIsEditOpen(false);
      setOrdenEditing(null);
      setEditForm({ nuevosHallazgos: '', mecanico: '', estado: 'In Progress' });
      alert(`✓ Orden de trabajo actualizada.\n${editForm.nuevosHallazgos ? 'Hallazgo registrado con timestamp.' : 'Datos actualizados.'}`);
    } catch (err: any) {
      alert('Error al actualizar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── PASO 1: Submit del form principal ─────────────────────────────────────

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newAircraft.status === 'maintenance') {
      setPendingAircraft({ ...newAircraft });
      setIsModalOpen(false);
      setRazonForm({ razon: '', razonCustom: '', mecanico: '', descripcion: '' });
      setIsRazonOpen(true);
    } else {
      insertAircraft({ ...newAircraft }, null);
    }
  };

  // ── PASO 2: Confirmar razón → insertar aeronave + orden de trabajo ─────────

  const handleRazonConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!razonFinal) {
      alert('PROTOCOLO: Especifica la razón de entrada a hangar.');
      return;
    }
    if (!pendingAircraft) return;
    await insertAircraft(pendingAircraft, {
      razon:       razonFinal,
      mecanico:    razonForm.mecanico,
      descripcion: razonForm.descripcion,
    });
    setIsRazonOpen(false);
    setPendingAircraft(null);
  };

  // ── INSERT CENTRAL ────────────────────────────────────────────────────────

  const insertAircraft = async (
    ac: typeof newAircraft,
    hangarData: { razon: string; mecanico: string; descripcion: string } | null
  ) => {
    setLoading(true);

    const dbEntry = {
      matricula:           ac.tailNumber.toUpperCase(),
      modelo:              ac.model.toUpperCase(),
      estado:              ac.status,
      horas_vuelo_totales: ac.totalHours,
      sede:                ac.sede,
    };

    const { data, error } = await supabase
      .from('flota_aviones').insert([dbEntry]).select();

    if (error) {
      alert('ERROR TÁCTICO: ' + error.message);
      setLoading(false);
      return;
    }

    if (ac.status === 'maintenance' && hangarData && data?.length) {
      const { error: ordenError } = await supabase
        .from('ordenes_trabajo').insert([{
          matricula:         ac.tailNumber.toUpperCase(),
          modelo:            ac.model.toUpperCase(),
          descripcion_tarea: hangarData.descripcion || hangarData.razon,
          sede:              ac.sede === 'LARA' ? 'Lara' : 'Maturín',
          nombre_mecanico:   hangarData.mecanico || 'POR ASIGNAR',
          estado:            'In Progress',
          observaciones:     `RAZÓN DE ENTRADA: ${hangarData.razon.toUpperCase()} | REGISTRO INICIAL DE FLOTA`,
        }]);

      if (ordenError) {
        console.error('FALLA AL CREAR ORDEN DE TRABAJO:', ordenError.message);
      }
    }

    setIsModalOpen(false);
    setNewAircraft({ tailNumber: '', model: '', totalHours: 0, status: 'operational', sede: 'LARA' });
    setLoading(false);
  };

  const handleCancelRazon = () => {
    setIsRazonOpen(false);
    setIsModalOpen(true);
  };

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (selectedAircraft) {
    return <AircraftDetail aircraft={selectedAircraft} onBack={() => setSelectedAircraft(null)} />;
  }

  const normalizedFleet = fleetData.map(ac => ({
    ...ac,
    status: normalizeAircraftStatus(ac.status as string),
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* Toolbar */}
      <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10
                      shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Gauge className="text-[#E1AD01] h-5 w-5" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 font-mono">
            Telemetría de Flota en Vivo
          </span>
        </div>
        <button onClick={() => setIsModalOpen(true)}
          className="bg-[#E1AD01] text-black px-6 py-2.5 rounded-lg font-black text-xs
                     hover:bg-white transition-all flex items-center gap-2 uppercase tracking-widest shadow-lg">
          <Plus className="h-4 w-4" /> Registrar Aeronave
        </button>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {normalizedFleet.map(ac => (
          <div key={ac.id} className="relative group">
            <AircraftCard aircraft={ac} onSelect={setSelectedAircraft} />

            {/* Botón Editar — solo visible en aeronaves en mantenimiento */}
            {ac.status === 'maintenance' && (
              <button
                onClick={e => { e.stopPropagation(); handleEditarMantenimiento(ac); }}
                disabled={loading}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5
                           bg-[#E1AD01] text-black text-[8px] font-black uppercase tracking-widest
                           rounded-lg shadow-lg hover:bg-white transition-all
                           opacity-0 group-hover:opacity-100 disabled:opacity-30 z-10"
              >
                {loading
                  ? <Loader2 size={10} className="animate-spin" />
                  : <Pencil size={10} />
                }
                Editar Orden
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════
          MODAL — EDITAR ORDEN DE TRABAJO EN MANTENIMIENTO
      ════════════════════════════════════════════════════════════ */}
      {isEditOpen && ordenEditing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/98
                        backdrop-blur-xl p-4 animate-in fade-in duration-200">
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
                    {ordenEditing.matricula} · {ordenEditing.modelo}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setIsEditOpen(false); setOrdenEditing(null); }}
                className="text-zinc-600 hover:text-white hover:rotate-90 transition-all">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion} className="p-7 space-y-5 font-mono">

              {/* Resumen de la orden actual */}
              <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-2">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-3">
                  Estado actual de la orden
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Tarea</p>
                    <p className="text-[10px] text-white font-black uppercase mt-0.5 leading-snug">
                      {ordenEditing.descripcion_tarea}
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Técnico</p>
                    <p className="text-[10px] text-white font-black uppercase mt-0.5">
                      {ordenEditing.nombre_mecanico}
                    </p>
                  </div>
                </div>
                {ordenEditing.observaciones && (
                  <div className="border-t border-white/5 pt-3 mt-2">
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">
                      Observaciones registradas
                    </p>
                    <p className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-line
                                  max-h-20 overflow-y-auto">
                      {ordenEditing.observaciones}
                    </p>
                  </div>
                )}
              </div>

              {/* Nuevos hallazgos — campo principal */}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest
                                  flex items-center gap-2">
                  <PlusCircle size={12} /> Daños Adicionales
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
                  <option value="Completed">COMPLETADA</option>
                  <option value="On Hold">EN ESPERA</option>
                </select>
              </div>

              {/* Alerta informativa */}
              <div className="flex items-start gap-2 bg-[#E1AD01]/5 border border-[#E1AD01]/15 rounded-xl p-3">
                <AlertCircle size={13} className="text-[#E1AD01] shrink-0 mt-0.5" />
                <p className="text-[9px] text-[#E1AD01]/70 leading-relaxed">
                  Los nuevos hallazgos se <span className="font-black text-[#E1AD01]">agregan al historial</span> de
                  la orden existente con fecha y hora. No se crea una orden nueva.
                </p>
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setIsEditOpen(false); setOrdenEditing(null); }}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black
                             uppercase hover:bg-white transition-all disabled:opacity-40
                             flex items-center justify-center gap-2"
                >
                  {loading
                    ? <Loader2 size={14} className="animate-spin" />
                    : <CheckCircle2 size={14} />
                  }
                  {loading ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 1 — REGISTRO DE AERONAVE
      ════════════════════════════════════════════════════════════ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95
                        backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-lg
                          rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="p-6 bg-[#E1AD01] flex justify-between items-center text-black font-black">
              <h3 className="uppercase text-[10px] tracking-[0.4em] italic flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Registro Multi-Sede
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:rotate-90 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="p-10 space-y-6 font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                    Matrícula *
                  </label>
                  <input required
                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                               focus:border-[#E1AD01] outline-none uppercase text-xs transition-all"
                    placeholder="YV-XXXX"
                    value={newAircraft.tailNumber}
                    onChange={e => setNewAircraft({ ...newAircraft, tailNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                    Sede Operativa
                  </label>
                  <select className={SELECT_CLS} value={newAircraft.sede}
                    onChange={e => setNewAircraft({ ...newAircraft, sede: e.target.value as any })}>
                    <option value="LARA">BASE LARA</option>
                    <option value="MATURIN">BASE MATURÍN</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                  Modelo / Aeronave *
                </label>
                <input required
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             focus:border-[#E1AD01] outline-none text-xs uppercase transition-all"
                  placeholder="CESSNA 152"
                  value={newAircraft.model}
                  onChange={e => setNewAircraft({ ...newAircraft, model: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                  Estatus Inicial
                </label>
                <select className={SELECT_CLS} value={newAircraft.status}
                  onChange={e => setNewAircraft({ ...newAircraft, status: e.target.value as any })}>
                  <option value="operational">OPERATIVA</option>
                  <option value="maintenance">EN MANTENIMIENTO</option>
                  <option value="grounded">EN TIERRA (AOG)</option>
                </select>

                {newAircraft.status === 'maintenance' && (
                  <div className="flex items-start gap-2 bg-[#E1AD01]/5 border border-[#E1AD01]/20
                                  rounded-xl px-3 py-2.5 mt-2">
                    <Wrench className="h-3.5 w-3.5 text-[#E1AD01] shrink-0 mt-0.5" />
                    <p className="text-[9px] text-[#E1AD01]/80 leading-relaxed">
                      Se solicitará la razón de entrada al hangar y se creará una orden de trabajo
                      automáticamente en el <span className="font-black">Control Hub</span>.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                  Horas Totales (TT)
                </label>
                <input type="number" step="0.1" required
                  className="w-full bg-black border border-white/10 rounded-xl p-5 text-white
                             focus:border-[#E1AD01] outline-none text-4xl font-black text-center transition-all"
                  placeholder="0.0"
                  value={newAircraft.totalHours || ''}
                  onChange={e => setNewAircraft({ ...newAircraft, totalHours: parseFloat(e.target.value) })}
                />
              </div>

              <button type="submit" disabled={loading}
                className="w-full bg-[#E1AD01] text-black py-6 rounded-2xl font-black uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl
                           flex items-center justify-center gap-2 disabled:opacity-40">
                {loading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : newAircraft.status === 'maintenance'
                    ? <><ShieldAlert className="h-4 w-4" /> Continuar — Razón de Hangar</>
                    : 'Desplegar Unidad'
                }
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 2 — RAZÓN DE ENTRADA A HANGAR
      ════════════════════════════════════════════════════════════ */}
      {isRazonOpen && pendingAircraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/98
                        backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-amber-500/40 w-full max-w-sm rounded-3xl
                          overflow-hidden shadow-[0_0_60px_rgba(225,173,1,0.15)]">

            <div className="bg-amber-500/10 border-b border-amber-500/20 p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <Wrench className="h-5 w-5 text-black" />
                </div>
                <div>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">
                    Razón de Entrada a Hangar
                  </p>
                  <p className="text-[9px] text-amber-400/70 font-mono uppercase tracking-widest">
                    {pendingAircraft.tailNumber.toUpperCase()} · {pendingAircraft.model.toUpperCase()}
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleRazonConfirm} className="p-6 space-y-4 font-mono">

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                  Motivo *
                </label>
                <select required className={SELECT_CLS} value={razonForm.razon}
                  onChange={e => setRazonForm({ ...razonForm, razon: e.target.value, razonCustom: '' })}>
                  <option value="">— SELECCIONAR —</option>
                  {RAZONES_PREDEFINIDAS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {razonForm.razon === 'Otra (especificar)' && (
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">
                    Especificar *
                  </label>
                  <input required
                    className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white
                               text-xs uppercase outline-none focus:border-[#E1AD01] placeholder:text-white/20"
                    placeholder="DESCRIBIR..."
                    value={razonForm.razonCustom}
                    onChange={e => setRazonForm({ ...razonForm, razonCustom: e.target.value })}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
                  Descripción Técnica
                </label>
                <textarea rows={2}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs resize-none outline-none focus:border-[#E1AD01] transition-all
                             placeholder:text-white/20 uppercase font-mono"
                  placeholder="Detalle adicional..."
                  value={razonForm.descripcion}
                  onChange={e => setRazonForm({ ...razonForm, descripcion: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
                  Técnico Asignado
                </label>
                <input
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                             text-xs uppercase outline-none focus:border-[#E1AD01] transition-all
                             placeholder:text-white/20 font-mono"
                  placeholder="Nombre del técnico (opcional)"
                  value={razonForm.mecanico}
                  onChange={e => setRazonForm({ ...razonForm, mecanico: e.target.value })}
                />
              </div>

              <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-red-400/80 leading-relaxed">
                  Se registrará la aeronave como <span className="font-black text-red-400">MANTENIMIENTO</span> y
                  aparecerá automáticamente en el <span className="font-black">Control Hub</span>.
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={handleCancelRazon}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400
                             text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                  Volver
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black
                             uppercase hover:bg-white transition-all disabled:opacity-40
                             flex items-center justify-center gap-2">
                  {loading
                    ? <Loader2 className="animate-spin h-4 w-4" />
                    : <ShieldCheck className="h-4 w-4" />}
                  {loading ? 'Desplegando...' : 'Desplegar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FleetDashboard;
// src/components/FleetDashboard.tsx
// VALKYRON OS v5.0 — Evolución: Si registro = maintenance → crear orden_trabajo automática
// FIX: select options visibles — bg/color forzados
// NEW: Modal de razón cuando estado inicial = maintenance
// REGLA DE ORO: CERO OMISIONES.

import React, { useState, useEffect } from 'react';
import { Aircraft, HangarLocation } from '@/Types/Maintenance';
import AircraftCard from './AircraftCard';
import AircraftDetail from './AircraftDetail';
import { supabase } from '../lib/supabaseClient';
import {
  Plane, Plus, X, Gauge, ShieldCheck, Loader2,
  Wrench, ShieldAlert, AlertCircle
} from 'lucide-react';

// ─── NORMALIZACIÓN ────────────────────────────────────────────────────────────
const normalizeAircraftStatus = (rawStatus: string): 'operational' | 'maintenance' | 'grounded' | 'flight' => {
  if (!rawStatus) return 'operational';
  const s = rawStatus.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight')) return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  return 'operational';
};

// FIX: select con opciones siempre visibles
const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  font-black outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

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

// ─── COMPONENTE ───────────────────────────────────────────────────────────────
const FleetDashboard = ({
  fleetData,
  setFleetData,
}: {
  fleetData: Aircraft[];
  setFleetData: any;
}) => {
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [isModalOpen, setIsModalOpen]           = useState(false);
  const [isRazonOpen, setIsRazonOpen]           = useState(false);  // Modal razón de hangar
  const [loading, setLoading]                   = useState(false);
  const [pendingAircraft, setPendingAircraft]   = useState<any>(null); // Datos pendientes pre-confirmación

  const [newAircraft, setNewAircraft] = useState({
    tailNumber:  '',
    model:       '',
    totalHours:  0,
    status:      'operational' as 'operational' | 'maintenance' | 'grounded' | 'flight',
    sede:        'LARA' as 'LARA' | 'MATURIN',
  });

  // Estado del form de razón de hangar
  const [razonForm, setRazonForm] = useState({
    razon:       '',
    razonCustom: '',
    mecanico:    '',
    descripcion: '',
  });

  const razonFinal = razonForm.razon === 'Otra (especificar)'
    ? razonForm.razonCustom.trim()
    : razonForm.razon;

  // ── REALTIME ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'flota_aviones' },
        (payload: any) => {
          const updatedRow = payload.new;
          setFleetData((currentFleet: Aircraft[]) => {
            if (payload.eventType === 'INSERT') {
              const mappedNew: Aircraft = {
                id:                   updatedRow.id,
                tailNumber:           updatedRow.matricula,
                model:                updatedRow.modelo,
                status:               normalizeAircraftStatus(updatedRow.estado),
                location:             updatedRow.sede || 'LARA',
                hours_vuelo_totales:  updatedRow.horas_vuelo_totales,
                components:           updatedRow.componentes || [],
              };
              const exists = currentFleet.some(ac => ac.id === mappedNew.id);
              return exists ? currentFleet : [...currentFleet, mappedNew];
            }
            if (payload.eventType === 'UPDATE') {
              return currentFleet.map(ac =>
                ac.id === updatedRow.id
                  ? {
                      ...ac,
                      status:               normalizeAircraftStatus(updatedRow.estado),
                      hours_vuelo_totales:  updatedRow.horas_vuelo_totales,
                      location:             updatedRow.sede || ac.location,
                    }
                  : ac
              );
            }
            if (payload.eventType === 'DELETE') {
              return currentFleet.filter(ac => ac.id !== payload.old.id);
            }
            return currentFleet;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [setFleetData]);

  // ── PASO 1: Submit del form principal ─────────────────────────────────────
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Si el estado es maintenance → abrir modal de razón antes de insertar
    if (newAircraft.status === 'maintenance') {
      setPendingAircraft({ ...newAircraft });
      setIsModalOpen(false);
      setRazonForm({ razon: '', razonCustom: '', mecanico: '', descripcion: '' });
      setIsRazonOpen(true);
    } else {
      // Operativa o grounded → insertar directamente
      insertAircraft({ ...newAircraft }, null);
    }
  };

  // ── PASO 2: Confirmar razón → insertar aeronave + orden de trabajo ────────
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
      matricula:          ac.tailNumber.toUpperCase(),
      modelo:             ac.model.toUpperCase(),
      estado:             ac.status,
      horas_vuelo_totales: ac.totalHours,
      sede:               ac.sede,
    };

    const { data, error } = await supabase
      .from('flota_aviones').insert([dbEntry]).select();

    if (error) {
      alert('ERROR TÁCTICO: ' + error.message);
      setLoading(false);
      return;
    }

    // Si el estado es maintenance → crear orden de trabajo automáticamente
    // para que aparezca de inmediato en ControlHub
    if (ac.status === 'maintenance' && hangarData && data?.length) {
      const { error: ordenError } = await supabase
        .from('ordenes_trabajo').insert([{
          matricula:        ac.tailNumber.toUpperCase(),
          modelo:           ac.model.toUpperCase(),
          descripcion_tarea: hangarData.descripcion || hangarData.razon,
          sede:             ac.sede === 'LARA' ? 'Lara' : 'Maturín',
          nombre_mecanico:  hangarData.mecanico || 'POR ASIGNAR',
          estado:           'In Progress',
          observaciones:    `RAZÓN DE ENTRADA: ${hangarData.razon.toUpperCase()} | REGISTRO INICIAL DE FLOTA`,
        }]);

      if (ordenError) {
        console.error('FALLA AL CREAR ORDEN DE TRABAJO:', ordenError.message);
      }
    }

    // Reset form
    setIsModalOpen(false);
    setNewAircraft({ tailNumber: '', model: '', totalHours: 0, status: 'operational', sede: 'LARA' });
    setLoading(false);
  };

  const handleCancelRazon = () => {
    setIsRazonOpen(false);
    setIsModalOpen(true); // Volver al form sin perder datos
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  if (selectedAircraft) {
    return <AircraftDetail aircraft={selectedAircraft} onBack={() => setSelectedAircraft(null)} />;
  }

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
        {fleetData.map(ac => (
          <AircraftCard key={ac.id} aircraft={ac} onSelect={setSelectedAircraft} />
        ))}
      </div>

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

              {/* Estatus — con indicador visual si elige maintenance */}
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

                {/* Aviso si elige maintenance */}
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
          Solo aparece cuando status = maintenance
      ════════════════════════════════════════════════════════════ */}
      {isRazonOpen && pendingAircraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/98
                        backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-amber-500/40 w-full max-w-sm rounded-3xl
                          overflow-hidden shadow-[0_0_60px_rgba(225,173,1,0.15)]">

            {/* Header */}
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

              {/* Razón predefinida */}
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

              {/* Custom si elige Otra */}
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

              {/* Descripción técnica */}
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

              {/* Mecánico */}
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

              {/* Advertencia */}
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
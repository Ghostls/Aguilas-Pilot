// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  VALKYRON FLIGHT SYSTEM — FLIGHT REGISTER v5.2                             ║
// ║  v5.2 NUEVO:                                                               ║
// ║    — Liquid Glass Morphism: backdrop-blur-3xl, gradientes iridiscentes,   ║
// ║      sombras con color, bordes con opacidad dinámica, scanline overlay.   ║
// ║    — Tarjeta pago capitán: muestra horasTac × $15/h (su comisión).        ║
// ║      Grid de 3 columnas: Horas TAC · Saldo Post-Vuelo · Tu Pago.          ║
// ║  v5.1 preservado: capitán no ve finanzas de la academia, auto-cálculo     ║
// ║    horas/monto al cerrar bitácora, operation_type OUT fix.                ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  Loader2, Plane, ShieldCheck, Camera,
  FileCheck, Activity, AlertTriangle, Fuel, MapPin,
  CloudRain, Calendar, CheckCircle2, ChevronRight, Clock,
  DollarSign,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

interface FlightRegisterProps {
  onFlightLogUpdate?: (aircraftId: string, tachHours: number) => void;
}

interface Aircraft {
  id:             string;
  matricula:      string;
  modelo:         string;
  fuel_burn_rate: number;
}

interface AsignacionDia {
  id:                string;
  fecha:             string;
  estado:            'PENDIENTE' | 'VOLADO' | 'POSPUESTO' | 'CANCELADO';
  sede:              string;
  instructor_id:     string;
  instructor_nombre: string;
  student_id:        string;
  student_nombre:    string;
  student_serial:    string;
  carrera_id:        string;
  saldo_horas:       number;
}

const DEFAULT_BURN_RATE   = 23.0;
const RATE_HORA_CAPITAN   = 15;   // $15 por hora de instrucción
const RATE_HORA_ACADEMIA  = 180;  // $180 por hora cobrada al alumno
const SEDES = ['BARQUISIMETO', 'MATURÍN'] as const;
type Sede = typeof SEDES[number];

// ─────────────────────────────────────────────────────────────────────────────
// LIQUID GLASS — clases reutilizables
// ─────────────────────────────────────────────────────────────────────────────

const glass = {
  base:    'backdrop-blur-3xl bg-white/[0.04] border border-white/[0.09] shadow-[0_8px_32px_rgba(0,0,0,0.4)]',
  gold:    'backdrop-blur-3xl bg-[#E1AD01]/[0.06] border border-[#E1AD01]/[0.18] shadow-[0_8px_32px_rgba(225,173,1,0.08)]',
  emerald: 'backdrop-blur-3xl bg-emerald-500/[0.06] border border-emerald-500/[0.18] shadow-[0_8px_32px_rgba(16,185,129,0.08)]',
  red:     'backdrop-blur-3xl bg-red-500/[0.06] border border-red-500/[0.18] shadow-[0_8px_32px_rgba(239,68,68,0.08)]',
  orange:  'backdrop-blur-3xl bg-orange-500/[0.06] border border-orange-500/[0.18] shadow-[0_8px_32px_rgba(249,115,22,0.08)]',
  dark:    'backdrop-blur-3xl bg-black/[0.45] border border-white/[0.06] shadow-[0_8px_32px_rgba(0,0,0,0.6)]',
};

const inp = `bg-white/[0.04] backdrop-blur-xl border border-white/[0.09] p-4 rounded-2xl
  text-white text-sm font-bold outline-none
  focus:border-[#E1AD01]/60 focus:bg-[#E1AD01]/[0.04]
  transition-all uppercase w-full
  shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const hoy = () => new Date().toISOString().split('T')[0];

const manana = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTE: Panel de asignaciones del día
// ─────────────────────────────────────────────────────────────────────────────

interface PanelAsignacionesProps {
  asignaciones:     AsignacionDia[];
  seleccionado:     string | null;
  onSeleccionar:    (a: AsignacionDia) => void;
  onPosponer:       () => void;
  posponiendo:      boolean;
  instructorNombre: string;
}

const PanelAsignaciones: React.FC<PanelAsignacionesProps> = ({
  asignaciones, seleccionado, onSeleccionar, onPosponer, posponiendo, instructorNombre,
}) => {
  const pendientes = asignaciones.filter(a => a.estado === 'PENDIENTE');
  const volados    = asignaciones.filter(a => a.estado === 'VOLADO');
  const progreso   = asignaciones.length
    ? Math.round((volados.length / asignaciones.length) * 100)
    : 0;

  return (
    <div className={`${glass.base} rounded-[2rem] overflow-hidden`}>

      {/* Header */}
      <div className={`${glass.gold} px-6 py-4 flex items-center justify-between
                       border-b border-[#E1AD01]/[0.12]`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#E1AD01]/20 flex items-center justify-center">
            <Calendar size={15} className="text-[#E1AD01]" />
          </div>
          <div>
            <p className="text-[#E1AD01] font-black text-xs uppercase tracking-widest">
              Misiones del Día — {instructorNombre}
            </p>
            <p className="text-zinc-500 text-[8px] font-black uppercase tracking-widest mt-0.5">
              {new Date().toLocaleDateString('es-VE', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-black uppercase text-zinc-500">
              {volados.length}/{asignaciones.length}
            </span>
            <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#E1AD01] to-[#f5c842] rounded-full transition-all duration-700"
                style={{ width: `${progreso}%` }}
              />
            </div>
            <span className="text-[8px] font-black text-[#E1AD01]">{progreso}%</span>
          </div>

          <button
            onClick={onPosponer}
            disabled={posponiendo || pendientes.length === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[9px] font-black
                        uppercase tracking-widest transition-all disabled:opacity-30
                        disabled:cursor-not-allowed ${glass.orange}`}
          >
            {posponiendo
              ? <Loader2 size={12} className="animate-spin text-orange-400" />
              : <CloudRain size={12} className="text-orange-400" />
            }
            <span className="text-orange-400">Posponer día</span>
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="p-4 space-y-2">
        {asignaciones.length === 0 ? (
          <div className="py-10 text-center">
            <Plane size={32} className="mx-auto mb-3 text-zinc-800 opacity-40" />
            <p className="text-zinc-700 text-[10px] font-black uppercase tracking-widest">
              Sin asignaciones para hoy
            </p>
          </div>
        ) : (
          asignaciones.map(a => {
            const esSeleccionado = seleccionado === a.student_id;
            const yaVolo         = a.estado === 'VOLADO';

            return (
              <button
                key={a.id}
                onClick={() => !yaVolo && onSeleccionar(a)}
                disabled={yaVolo}
                className={`w-full flex items-center justify-between p-4 rounded-2xl
                            text-left transition-all group
                            ${esSeleccionado
                              ? `${glass.gold} shadow-[0_0_20px_rgba(225,173,1,0.12)]`
                              : yaVolo
                              ? `${glass.emerald} opacity-60 cursor-default`
                              : `${glass.base} hover:border-white/20`
                            }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0
                                   transition-all ${
                    yaVolo        ? 'bg-emerald-500/15 border border-emerald-500/20' :
                    esSeleccionado ? 'bg-[#E1AD01]/15 border border-[#E1AD01]/25' :
                                    'bg-white/[0.04] border border-white/10'
                  }`}>
                    {yaVolo
                      ? <CheckCircle2 size={16} className="text-emerald-400" />
                      : <Plane size={16} className={esSeleccionado ? 'text-[#E1AD01]' : 'text-zinc-500'} />
                    }
                  </div>
                  <div>
                    <p className={`font-black uppercase text-sm transition-colors ${
                      yaVolo ? 'text-zinc-500' : 'text-white'
                    }`}>
                      {a.student_nombre}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[8px] text-zinc-600 font-black uppercase font-mono">
                        {a.student_serial}
                      </span>
                      <span className={`text-[8px] font-black uppercase ${
                        a.saldo_horas > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {a.saldo_horas.toFixed(1)}h disponibles
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {yaVolo ? (
                    <span className="text-[8px] text-emerald-400 font-black uppercase tracking-widest
                                     px-2 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      Completado
                    </span>
                  ) : (
                    <ChevronRight
                      size={16}
                      className={`transition-transform ${
                        esSeleccionado
                          ? 'text-[#E1AD01] translate-x-1'
                          : 'text-zinc-700 group-hover:translate-x-0.5 group-hover:text-zinc-400'
                      }`}
                    />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

const FlightRegister = ({ onFlightLogUpdate }: FlightRegisterProps) => {
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setAuthUserId(user?.id ?? null);
    });
  }, []);

  const [isProcessing,      setIsProcessing]      = useState(false);
  const [loadingInicial,    setLoadingInicial]     = useState(true);
  const [posponiendo,       setPosponiendo]        = useState(false);

  const [fleet,            setFleet]            = useState<Aircraft[]>([]);
  const [asignaciones,     setAsignaciones]     = useState<AsignacionDia[]>([]);
  const [instructorId,     setInstructorId]     = useState<string | null>(null);
  const [instructorNombre, setInstructorNombre] = useState('');

  const [studentBalance,    setStudentBalance]    = useState<number | null>(null);
  const [aircraftFuelStock, setAircraftFuelStock] = useState<number | null>(null);

  const [evidence, setEvidence] = useState<{ inicial: File | null; final: File | null }>({
    inicial: null, final: null,
  });

  const [form, setForm] = useState({
    aircraft_id:        '',
    matricula:          '',
    fecha:              hoy(),
    ruta:               'SVBM - LOCAL',
    sede_vuelo:         'BARQUISIMETO' as Sede,
    tacInicial:         0,
    tacFinal:           0,
    horasCobrada:       0,
    student_id:         '',
    student_nombre:     '',
    instructor:         '',
    precioHoraCostoTac: RATE_HORA_ACADEMIA,
    precioCobrado:      0,
    observacion:        '',
  });

  // ── CARGA INICIAL ────────────────────────────────────────────────────────

  const inicializar = useCallback(async () => {
    if (!authUserId) return;
    setLoadingInicial(true);
    try {
      const { data: instData } = await supabase
        .from('instructores')
        .select('id, nombre_completo, sede')
        .eq('perfil_id', authUserId)
        .single();

      const esInstructor = !!instData;
      if (esInstructor) {
        setInstructorId(instData.id);
        setInstructorNombre(instData.nombre_completo);
        setForm(prev => ({ ...prev, instructor: instData.nombre_completo }));
      }

      const sede = instData?.sede?.toUpperCase().includes('MATUR') ? 'MATURÍN' : 'BARQUISIMETO';
      await supabase.rpc('generar_asignaciones_del_dia', {
        p_fecha: hoy(), p_sede: sede, p_min: 3, p_max: 5,
      });

      let query = supabase.from('v_asignaciones_hoy').select('*').order('student_nombre');
      if (esInstructor) query = query.eq('instructor_id', instData.id);
      const { data: asigData } = await query;
      setAsignaciones((asigData ?? []) as AsignacionDia[]);

      const { data: fleetData } = await supabase
        .from('flota_aviones')
        .select('id, matricula, modelo, fuel_burn_rate')
        .order('matricula');

      if (fleetData?.length) {
        setFleet(fleetData);
        setForm(prev => ({
          ...prev,
          aircraft_id: fleetData[0].id,
          matricula:   fleetData[0].matricula,
        }));
      }
    } catch (err: any) {
      console.error('[FlightRegister v5.2] inicializar:', err.message);
    } finally {
      setLoadingInicial(false);
    }
  }, [authUserId]);

  useEffect(() => { inicializar(); }, [inicializar]);

  // ── SELECCIONAR ALUMNO ───────────────────────────────────────────────────

  const handleSeleccionarAlumno = useCallback((a: AsignacionDia) => {
    const sedeNorm: Sede = a.sede?.toUpperCase().includes('MATUR') ? 'MATURÍN' : 'BARQUISIMETO';
    setForm(prev => ({
      ...prev,
      student_id: a.student_id, student_nombre: a.student_nombre, sede_vuelo: sedeNorm,
    }));
  }, []);

  // ── SALDO COMBUSTIBLE ────────────────────────────────────────────────────

  useEffect(() => {
    const fetchFuel = async () => {
      if (!form.matricula) { setAircraftFuelStock(null); return; }
      try {
        const { data: logs } = await (supabase as any)
          .from('registros_combustible')
          .select('operation_type, liters, aircraft_id, destination_aircraft_id')
          .or(`aircraft_id.eq.${form.matricula},destination_aircraft_id.eq.${form.matricula}`);

        let stock = 0;
        (logs || []).forEach((r: any) => {
          const lts = Number(r.liters);
          if (r.operation_type === 'IN'       && r.aircraft_id === form.matricula) stock += lts;
          if (r.operation_type === 'TRANSFER' && r.aircraft_id === form.matricula) stock -= lts;
          if (r.operation_type === 'TRANSFER' && r.destination_aircraft_id === form.matricula) stock += lts;
          if (r.operation_type === 'OUT'      && r.aircraft_id === form.matricula) stock -= lts;
        });
        setAircraftFuelStock(Math.max(stock, 0));
      } catch { setAircraftFuelStock(null); }
    };
    fetchFuel();
  }, [form.matricula]);

  // ── SALDO HORAS ALUMNO ───────────────────────────────────────────────────

  useEffect(() => {
    const fetchBalance = async () => {
      if (!form.student_id) { setStudentBalance(null); return; }
      try {
        const asig = asignaciones.find(a => a.student_id === form.student_id);
        if (asig) { setStudentBalance(asig.saldo_horas); return; }
        const [pagosRes, vuelosRes] = await Promise.all([
          supabase.from('cuentas_por_cobrar').select('horas_compradas')
            .eq('student_id', form.student_id).eq('estatus', 'COBRADO'),
          supabase.from('bitacora_vuelos').select('horas_tac').eq('student_id', form.student_id),
        ]);
        const compradas = (pagosRes.data || []).reduce((a, p) => a + (Number(p.horas_compradas) || 0), 0);
        const voladas   = (vuelosRes.data || []).reduce((a, v) => a + (Number(v.horas_tac) || 0), 0);
        setStudentBalance(Math.max(0, compradas - voladas));
      } catch { setStudentBalance(null); }
    };
    fetchBalance();
  }, [form.student_id, asignaciones]);

  // ── CÁLCULOS ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const horasTac         = Math.max(0, parseFloat((form.tacFinal - form.tacInicial).toFixed(2)));
    const pagoCapitan      = horasTac * RATE_HORA_CAPITAN;
    const pagoGasolina     = (horasTac * 23) * 3.3;
    const costoOperacional = form.horasCobrada * 20;
    const produccionNeta   = form.precioCobrado - (pagoCapitan + pagoGasolina + costoOperacional);
    const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
    const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;
    const litersToBurn     = parseFloat((horasTac * burnRate).toFixed(1));
    return { horasTac, pagoCapitan, pagoGasolina, costoOperacional, produccionNeta, litersToBurn, burnRate };
  }, [form.tacFinal, form.tacInicial, form.horasCobrada, form.precioCobrado, form.aircraft_id, fleet]);

  useEffect(() => {
    if (!instructorId) {
      setForm(prev => ({ ...prev, precioCobrado: form.horasCobrada * RATE_HORA_ACADEMIA }));
    }
  }, [form.horasCobrada, instructorId]);

  // ── POSPONER DÍA ─────────────────────────────────────────────────────────

  const handlePosponer = useCallback(async () => {
    const confirmar = window.confirm(
      `¿Posponer todas las misiones pendientes de hoy al ${manana()}?\n\n` +
      `Esto moverá ${asignaciones.filter(a => a.estado === 'PENDIENTE').length} alumnos pendientes.`
    );
    if (!confirmar) return;
    setPosponiendo(true);
    try {
      const sede = asignaciones[0]?.sede ?? 'BARQUISIMETO';
      const { data: count } = await supabase.rpc('posponer_dia_vuelo', {
        p_fecha_origen: hoy(), p_fecha_destino: manana(), p_sede: sede,
      });
      alert(`✓ ${count} misiones pospuestas al ${manana()}.`);
      await inicializar();
    } catch (e: any) {
      alert('Error al posponer: ' + e.message);
    } finally {
      setPosponiendo(false);
    }
  }, [asignaciones, inicializar]);

  // ── UPLOAD EVIDENCIA ─────────────────────────────────────────────────────

  const uploadToMIAStorage = async (file: File, prefix: string) => {
    const ext      = file.name.split('.').pop();
    const fileName = `${prefix}_${form.matricula}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tacometros').upload(fileName, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('tacometros').getPublicUrl(fileName);
    return publicUrl;
  };

  // ── CERRAR BITÁCORA ───────────────────────────────────────────────────────

  const handleProcessFlight = async () => {
    if (!form.aircraft_id || stats.horasTac <= 0 || !form.student_id)
      return alert('SISTEMA: Verifique Aeronave, TAC y Cadete seleccionado.');
    if (!evidence.inicial || !evidence.final)
      return alert('CRITICAL: Se requiere evidencia visual de tacómetros para MRO.');

    const deficit = studentBalance !== null
      ? Math.max(0, stats.horasTac - studentBalance)
      : null;

    if (deficit !== null && deficit > 0) {
      const proceed = window.confirm(
        `⚠️ SALDO INSUFICIENTE\n\nSaldo: ${(studentBalance ?? 0).toFixed(1)}h · Vuelo: ${stats.horasTac.toFixed(2)}h\n` +
        `Déficit: ${deficit.toFixed(2)}h = $${(deficit * form.precioHoraCostoTac).toFixed(2)}\n\nSe registrará una deuda. ¿Continuar?`
      );
      if (!proceed) return;
    }

    if (aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn) {
      const proceed = window.confirm(
        `⚠️ COMBUSTIBLE BAJO\n\n${form.matricula} tiene ${aircraftFuelStock.toFixed(1)} LTS.\n` +
        `Este vuelo consumirá ~${stats.litersToBurn.toFixed(1)} LTS.\n\n¿Continuar?`
      );
      if (!proceed) return;
    }

    // v5.1: capitán → calcular auto desde TAC
    const horasCobradas = instructorId ? stats.horasTac         : form.horasCobrada;
    const montoCobrado  = instructorId
      ? parseFloat((stats.horasTac * RATE_HORA_ACADEMIA).toFixed(2))
      : form.precioCobrado;

    const pagoCapitanFinal      = horasCobradas * RATE_HORA_CAPITAN;
    const pagoGasolinaFinal     = (stats.horasTac * 23) * 3.3;
    const costoOperacionalFinal = horasCobradas * 20;
    const produccionNetaFinal   = montoCobrado - (pagoCapitanFinal + pagoGasolinaFinal + costoOperacionalFinal);

    setIsProcessing(true);
    try {
      const urlInicial = await uploadToMIAStorage(evidence.inicial!, 'START');
      const urlFinal   = await uploadToMIAStorage(evidence.final!,   'END');

      // 1. Bitácora
      const { error: dbError } = await supabase.from('bitacora_vuelos').insert([{
        fecha:                form.fecha,
        aircraft_id:          form.aircraft_id,
        aeronave_matricula:   form.matricula,
        ruta:                 form.ruta.toUpperCase(),
        sede_vuelo:           form.sede_vuelo,
        tac_inicial:          form.tacInicial,
        tac_final:            form.tacFinal,
        horas_tac:            stats.horasTac,
        horas_cobradas:       horasCobradas,
        alumno:               form.student_nombre,
        student_id:           form.student_id,
        instructor:           form.instructor.toUpperCase(),
        produccion_neta:      produccionNetaFinal,
        pago_capitan:         pagoCapitanFinal,
        pago_gasolina:        pagoGasolinaFinal,
        costo_operacional:    costoOperacionalFinal,
        url_foto_tac_inicial: urlInicial,
        url_foto_tac_final:   urlFinal,
        observacion:          form.observacion.toUpperCase(),
      }]);
      if (dbError) throw dbError;

      // 2. Horas estudiante
      await supabase.from('horas_vuelo_estudiante').insert([{
        student_id: form.student_id, fecha: form.fecha, horas: stats.horasTac,
        matricula_avion: form.matricula, tipo_mision: form.ruta.toUpperCase(),
      }]);

      // 3. Transacción financiera
      await supabase.from('transacciones_finanzas').insert([{
        type: 'INCOME', entity_name: `VUELO ${form.matricula} - ${form.student_nombre}`,
        amount: montoCobrado,
        description: `BITÁCORA | TAC: ${stats.horasTac} | SEDE: ${form.sede_vuelo}`,
        status: 'PAID', category: 'Vuelos', issue_date: form.fecha, student_id: form.student_id,
      }]);

      // 4. Burn combustible — FIX: 'OUT' (constraint: IN/OUT/TRANSFER)
      if (stats.litersToBurn > 0) {
        await (supabase as any).from('registros_combustible').insert([{
          operation_type: 'OUT', aircraft_id: form.matricula, destination_aircraft_id: null,
          liters: stats.litersToBurn, fuel_type: 'AVGAS 100LL', location: form.sede_vuelo,
          ticket_number: `BRN-${form.fecha}-${form.matricula}`,
          technician: form.student_nombre.toUpperCase(), hobbs_at_charge: form.tacFinal,
        }]);
      }

      // 5. Deuda si déficit
      if (deficit !== null && deficit > 0) {
        const montoDeuda = parseFloat((deficit * form.precioHoraCostoTac).toFixed(2));
        await supabase.from('cuentas_por_cobrar').insert([{
          alumno_id: form.student_id, student_id: form.student_id,
          nombre_alumno: form.student_nombre.toUpperCase(),
          monto_total: montoDeuda, monto_pagado: 0, monto_pendiente: montoDeuda,
          concepto: `DEUDA VUELO ${form.matricula} — ${deficit.toFixed(2)}h × $${form.precioHoraCostoTac}/h — ${form.sede_vuelo} — ${form.fecha}`,
          fecha_emision: form.fecha, estatus: 'PENDIENTE',
          horas_compradas: 0, horas_prometidas: 0,
        }]);
      }

      // 6. Marcar VOLADO
      const asig = asignaciones.find(a => a.student_id === form.student_id);
      if (asig) {
        await supabase.from('asignaciones_vuelo_diario').update({ estado: 'VOLADO' }).eq('id', asig.id);
        setAsignaciones(prev => prev.map(a => a.id === asig.id ? { ...a, estado: 'VOLADO' } : a));
      }

      if (onFlightLogUpdate) onFlightLogUpdate(form.aircraft_id, stats.horasTac);

      const debtMsg = deficit && deficit > 0
        ? `\n\nDeuda generada: $${(deficit * form.precioHoraCostoTac).toFixed(2)}`
        : '';
      alert(`MIA: BITÁCORA SINCRONIZADA.${debtMsg}`);

      setForm(prev => ({
        ...prev,
        tacInicial: prev.tacFinal, tacFinal: 0,
        horasCobrada: 0, precioCobrado: 0,
        student_id: '', student_nombre: '',
      }));
      setEvidence({ inicial: null, final: null });
      setStudentBalance(null);
    } catch (e: any) {
      alert('SISTEMA MIA ERROR CRÍTICO: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── DERIVED ──────────────────────────────────────────────────────────────

  const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
  const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;
  const esCapitan        = instructorId !== null;

  const balanceBadgeClass = studentBalance === null ? 'text-zinc-600'
    : studentBalance >= stats.horasTac ? 'text-emerald-400'
    : studentBalance > 0               ? 'text-orange-400 animate-pulse'
    :                                    'text-red-400 animate-pulse';

  const balanceLabel = studentBalance === null ? ''
    : studentBalance >= 0
      ? `[ SALDO: ${studentBalance.toFixed(1)}h ]`
      : `[ DEBE: ${Math.abs(studentBalance).toFixed(1)}h ]`;

  // ── LOADING ───────────────────────────────────────────────────────────────

  if (loadingInicial) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center font-mono">
        {/* Scanline overlay */}
        <div className="pointer-events-none fixed inset-0 opacity-[0.015]
                        bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,
                        rgba(255,255,255,0.07)_2px,rgba(255,255,255,0.07)_4px)]" />
        <div className="text-center space-y-5 relative z-10">
          <div className="relative mx-auto w-16 h-16">
            <div className="absolute inset-0 rounded-full bg-[#E1AD01]/20 animate-ping" />
            <div className={`w-16 h-16 rounded-full ${glass.gold} flex items-center justify-center`}>
              <Loader2 className="animate-spin text-[#E1AD01] w-7 h-7" />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.5em] text-[#E1AD01]">
              M.I.A. Flight Core
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mt-1">
              Generando asignaciones del día...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-8 font-mono text-zinc-200 text-left relative">

      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.015]
                      bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,
                      rgba(255,255,255,0.07)_2px,rgba(255,255,255,0.07)_4px)]" />

      {/* Ambient glow top */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px]
                      bg-[#E1AD01]/[0.04] blur-[120px] rounded-full z-0" />

      <div className="max-w-5xl mx-auto relative z-10">

        {/* ── CABECERA LIQUID GLASS ──────────────────────────────────────── */}
        <header className={`${glass.gold} px-8 py-5 flex justify-between items-center
                            rounded-t-[2.5rem] shadow-[0_0_40px_rgba(225,173,1,0.1)]`}>
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-[#E1AD01] flex items-center justify-center
                            shadow-[0_4px_20px_rgba(225,173,1,0.4)]">
              <Plane size={22} className="text-black" />
            </div>
            <div>
              <h1 className="font-black text-sm tracking-[0.3em] uppercase text-white">
                MRO Flight Operations
              </h1>
              <p className="text-[#E1AD01]/60 text-[9px] font-bold uppercase tracking-widest">
                Valkyron OS v5.2 · {instructorNombre || 'Sistema de Vuelo'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 ${glass.dark} px-3 py-1.5 rounded-full`}>
              <Clock size={11} className="text-zinc-500" />
              <span className="text-[9px] font-black text-zinc-300">{hoy()}</span>
            </div>
            <div className={`flex items-center gap-2 ${glass.emerald} px-3 py-1.5 rounded-full`}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-black text-emerald-400">SYS OK</span>
            </div>
          </div>
        </header>

        {/* ── BODY ─────────────────────────────────────────────────────────── */}
        <div className={`${glass.dark} border-t-0 rounded-b-[2.5rem] overflow-hidden
                         shadow-[0_40px_80px_rgba(0,0,0,0.6)] p-8 space-y-8`}>

          {/* PANEL ASIGNACIONES */}
          <PanelAsignaciones
            asignaciones={asignaciones}
            seleccionado={form.student_id}
            onSeleccionar={handleSeleccionarAlumno}
            onPosponer={handlePosponer}
            posponiendo={posponiendo}
            instructorNombre={instructorNombre}
          />

          {/* FORMULARIO */}
          {form.student_id ? (
            <>
              {/* ── HUD ALUMNO SELECCIONADO ──────────────────────────────── */}
              <div className={`${glass.gold} flex items-center justify-between
                               px-6 py-4 rounded-2xl shadow-[0_0_30px_rgba(225,173,1,0.06)]`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#E1AD01]/15 border border-[#E1AD01]/25
                                  flex items-center justify-center">
                    <Plane size={18} className="text-[#E1AD01]" />
                  </div>
                  <div>
                    <p className="text-white font-black uppercase text-sm">{form.student_nombre}</p>
                    <p className="text-zinc-500 text-[9px] font-black uppercase tracking-widest mt-0.5">
                      Cadete en misión activa
                    </p>
                  </div>
                </div>
                {studentBalance !== null && (
                  <span className={`text-[10px] font-black uppercase tracking-widest ${balanceBadgeClass}`}>
                    {balanceLabel}
                  </span>
                )}
              </div>

              {/* ── ALERTA SALDO INSUFICIENTE ──────────────────────────── */}
              {studentBalance !== null && studentBalance < stats.horasTac && stats.horasTac > 0 && (
                <div className={`${glass.orange} flex items-start gap-3 px-5 py-4 rounded-2xl`}>
                  <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[9px] text-orange-400 font-black uppercase tracking-widest">
                      Saldo insuficiente — se generará deuda automática
                    </p>
                    <p className="text-[8px] text-orange-300/60 font-mono mt-0.5">
                      Déficit: {Math.max(0, stats.horasTac - studentBalance).toFixed(2)}h ·{' '}
                      ${(Math.max(0, stats.horasTac - studentBalance) * form.precioHoraCostoTac).toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              {/* ── VECTORES DE IDENTIDAD ──────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Aeronave */}
                <div className="flex flex-col space-y-2">
                  <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
                    Unidad de Flota
                  </label>
                  <select
                    className={`appearance-none ${inp} cursor-pointer`}
                    value={form.aircraft_id}
                    onChange={e => {
                      const sel = fleet.find(a => a.id === e.target.value);
                      setForm(prev => ({
                        ...prev, aircraft_id: e.target.value, matricula: sel?.matricula ?? '',
                      }));
                    }}>
                    {fleet.map(u => (
                      <option key={u.id} value={u.id} className="bg-[#0d0d0d]">
                        {u.matricula} — {u.modelo}
                      </option>
                    ))}
                  </select>
                  {aircraftFuelStock !== null && (
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px]
                                    font-black uppercase ${
                      aircraftFuelStock >= stats.litersToBurn ? glass.gold : glass.orange
                    }`}>
                      <Fuel className={`h-3 w-3 ${
                        aircraftFuelStock >= stats.litersToBurn ? 'text-[#E1AD01]' : 'text-orange-400'
                      }`} />
                      <span className={aircraftFuelStock >= stats.litersToBurn
                        ? 'text-[#E1AD01]' : 'text-orange-400'}>
                        {aircraftFuelStock.toFixed(1)} LTS
                      </span>
                      {aircraftFuelStock < stats.litersToBurn && stats.litersToBurn > 0 && (
                        <AlertTriangle className="h-3 w-3 ml-auto text-orange-400" />
                      )}
                    </div>
                  )}
                </div>

                {/* Fecha */}
                <InputGroup
                  id="mro_fecha" label="Fecha Registro" type="date"
                  value={form.fecha}
                  onChange={(v: string) => setForm(prev => ({ ...prev, fecha: v }))}
                />

                {/* Sede */}
                <div className="flex flex-col space-y-2">
                  <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest
                                    ml-1 flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" /> Sede del Vuelo
                  </label>
                  <div className={`flex ${glass.dark} rounded-2xl p-1 gap-1`}>
                    {SEDES.map(sede => (
                      <button key={sede} type="button"
                        onClick={() => setForm(prev => ({ ...prev, sede_vuelo: sede }))}
                        className={`flex-1 py-3 px-2 rounded-xl text-[9px] font-black uppercase
                                    tracking-widest transition-all ${
                          form.sede_vuelo === sede
                            ? 'bg-[#E1AD01] text-black shadow-[0_4px_12px_rgba(225,173,1,0.3)]'
                            : 'text-zinc-500 hover:text-white'
                        }`}>
                        {sede}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── RUTA + INSTRUCTOR ──────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/[0.05] pt-6">
                <InputGroup id="mro_ruta" label="Misión / Ruta" value={form.ruta}
                  onChange={(v: string) => setForm(prev => ({ ...prev, ruta: v }))} />
                <InputGroup id="mro_instructor" label="Instructor al Mando" value={form.instructor}
                  onChange={(v: string) => setForm(prev => ({ ...prev, instructor: v }))} />
              </div>

              {/* ── TACÓMETRO ─────────────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { id: 'mro_tac_inicial', label: 'TAC Inicial', key: 'tacInicial' as const, evKey: 'inicial' as const },
                  { id: 'mro_tac_final',   label: 'TAC Final',   key: 'tacFinal'   as const, evKey: 'final'   as const },
                ].map(({ id, label, key, evKey }) => (
                  <div key={id} className={`${glass.base} p-6 rounded-3xl relative overflow-hidden`}>
                    {/* Iridescent corner accent */}
                    <div className="absolute top-0 right-0 w-20 h-20 opacity-20
                                    bg-gradient-to-bl from-[#E1AD01] to-transparent rounded-bl-3xl" />
                    <div className="absolute top-0 right-0 p-3">
                      <Activity size={12} className="text-[#E1AD01]" />
                    </div>
                    <InputGroup
                      id={id} label={label} type="number"
                      value={form[key]} color="text-[#E1AD01]"
                      onChange={(v: number) => setForm(prev => ({ ...prev, [key]: Number(v) }))}
                    />
                    <div className="mt-4">
                      <EvidenceUpload
                        id={`file_${evKey}`}
                        label={`Captura ${label}`}
                        file={evidence[evKey]}
                        onSelect={f => setEvidence(prev => ({ ...prev, [evKey]: f }))}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* ── BURN PREVIEW ──────────────────────────────────────── */}
              {stats.horasTac > 0 && (
                <div className={`flex items-center gap-4 px-6 py-4 rounded-2xl ${
                  aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                    ? glass.orange : glass.gold
                }`}>
                  <Fuel className={`h-5 w-5 shrink-0 ${
                    aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                      ? 'text-orange-400' : 'text-[#E1AD01]'
                  }`} />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      Consumo estimado
                    </p>
                    <p className={`text-base font-black font-mono ${
                      aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                        ? 'text-orange-400' : 'text-[#E1AD01]'
                    }`}>
                      {stats.litersToBurn.toFixed(1)} LTS
                      <span className="text-[9px] text-zinc-600 ml-2 font-normal">
                        ({stats.horasTac.toFixed(2)}h × {burnRate} LTS/h)
                      </span>
                    </p>
                  </div>
                </div>
              )}

              {/* ── RESUMEN CAPITÁN (3 tarjetas liquid glass) ─────────────
                  v5.2: Horas TAC · Saldo Post-Vuelo · Tu Pago ($15/h)
                  El capitán ve su comisión pero NUNCA el profit de la academia.
              ────────────────────────────────────────────────────────────── */}
              {esCapitan && stats.horasTac > 0 && (
                <div className="grid grid-cols-3 gap-4">

                  {/* Horas TAC */}
                  <div className={`${glass.gold} rounded-2xl p-5 text-center
                                   shadow-[0_0_30px_rgba(225,173,1,0.06)] relative overflow-hidden`}>
                    <div className="absolute inset-0 bg-gradient-to-br from-[#E1AD01]/[0.04]
                                    to-transparent pointer-events-none" />
                    <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2">
                      Horas TAC
                    </p>
                    <p className="text-4xl font-black text-[#E1AD01] italic font-mono">
                      {stats.horasTac.toFixed(2)}
                      <span className="text-lg text-[#E1AD01]/60">h</span>
                    </p>
                    <p className="text-[8px] text-zinc-600 uppercase font-mono mt-1">Registradas</p>
                  </div>

                  {/* Saldo post-vuelo */}
                  {(() => {
                    const saldoPost = Math.max(0, (studentBalance ?? 0) - stats.horasTac);
                    const positivo  = saldoPost > 0;
                    return (
                      <div className={`${positivo ? glass.emerald : glass.red} rounded-2xl p-5
                                       text-center relative overflow-hidden`}>
                        <div className={`absolute inset-0 bg-gradient-to-br
                          ${positivo ? 'from-emerald-500/[0.04]' : 'from-red-500/[0.04]'}
                          to-transparent pointer-events-none`} />
                        <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest mb-2">
                          Saldo Post-Vuelo
                        </p>
                        <p className={`text-4xl font-black italic font-mono
                                       ${positivo ? 'text-emerald-400' : 'text-red-400'}`}>
                          {saldoPost.toFixed(1)}
                          <span className={`text-lg ${positivo ? 'text-emerald-400/60' : 'text-red-400/60'}`}>h</span>
                        </p>
                        <p className="text-[8px] text-zinc-600 uppercase font-mono mt-1">
                          {positivo ? 'Disponibles' : 'Sin saldo'}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Tu Pago — comisión del capitán */}
                  <div className={`${glass.emerald} rounded-2xl p-5 text-center relative overflow-hidden
                                   shadow-[0_0_30px_rgba(16,185,129,0.06)]`}>
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.05]
                                    to-transparent pointer-events-none" />
                    <div className="flex items-center justify-center gap-1.5 mb-2">
                      <DollarSign size={11} className="text-emerald-400" />
                      <p className="text-[8px] text-zinc-500 font-black uppercase tracking-widest">
                        Tu Pago — Esta Misión
                      </p>
                    </div>
                    <p className="text-4xl font-black text-emerald-400 italic font-mono">
                      ${(stats.horasTac * RATE_HORA_CAPITAN).toFixed(2)}
                    </p>
                    <p className="text-[8px] text-zinc-600 uppercase font-mono mt-1">
                      {stats.horasTac.toFixed(2)}h × ${RATE_HORA_CAPITAN}/h
                    </p>
                  </div>
                </div>
              )}

              {/* ── FINANCIERA — solo admin/CEO ───────────────────────────
                  v5.1/v5.2: oculto para capitanes.
              ────────────────────────────────────────────────────────────── */}
              {!esCapitan && (
                <>
                  <div className={`${glass.dark} grid grid-cols-1 md:grid-cols-2 gap-6 p-8
                                   rounded-[2rem]`}>
                    <InputGroup
                      id="mro_horas_facturadas" label="Horas Facturadas (Rate $180/h)"
                      type="number" value={form.horasCobrada}
                      onChange={(v: number) => setForm(prev => ({ ...prev, horasCobrada: Number(v) }))}
                    />
                    <InputGroup
                      id="mro_monto_cobrado" label="Monto Total a Cobrar ($)"
                      type="number" value={form.precioCobrado} color="text-emerald-400"
                      onChange={(v: number) => setForm(prev => ({ ...prev, precioCobrado: Number(v) }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <StatBox label="Horas TAC"   value={stats.horasTac.toFixed(2)} />
                    <StatBox label="Instructor"  value={`-$${stats.pagoCapitan.toFixed(2)}`}
                             color="text-red-400/80" />
                    <StatBox label="Combustible" value={`-$${stats.pagoGasolina.toFixed(1)}`}
                             color="text-red-400/80" />
                    <StatBox label="MRO Op Fee"  value={`-$${stats.costoOperacional}`}
                             color="text-[#E1AD01]" />
                    <div className="bg-[#E1AD01] p-5 rounded-2xl flex flex-col justify-center
                                    items-center shadow-[0_10px_30px_rgba(225,173,1,0.25)] text-center">
                      <span className="text-[9px] text-black font-black uppercase tracking-tighter">
                        Net Profit
                      </span>
                      <span className="text-2xl font-mono text-black font-black leading-none mt-1">
                        ${stats.produccionNeta.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              )}

              {/* ── OBSERVACIÓN ──────────────────────────────────────────── */}
              <div className="flex flex-col space-y-2">
                <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
                  Observaciones
                </label>
                <textarea rows={2}
                  className={`${glass.base} p-4 rounded-2xl text-white text-sm font-bold
                              outline-none focus:border-[#E1AD01]/60 transition-all uppercase resize-none`}
                  value={form.observacion}
                  onChange={e => setForm(prev => ({ ...prev, observacion: e.target.value }))}
                />
              </div>

              {/* ── CTA ──────────────────────────────────────────────────── */}
              <button type="button" onClick={handleProcessFlight} disabled={isProcessing}
                className="w-full relative overflow-hidden font-black py-7 rounded-[2rem] uppercase
                           text-[11px] tracking-[0.5em] flex items-center justify-center gap-4
                           transition-all shadow-[0_20px_60px_rgba(225,173,1,0.2)] active:scale-95
                           disabled:opacity-30 group
                           bg-white text-black hover:bg-[#E1AD01]
                           hover:shadow-[0_20px_60px_rgba(225,173,1,0.35)]">
                {/* Shimmer on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity
                                bg-gradient-to-r from-transparent via-white/20 to-transparent
                                -translate-x-full group-hover:translate-x-full duration-700" />
                {isProcessing
                  ? <Loader2 className="animate-spin h-5 w-5" />
                  : <ShieldCheck className="h-6 w-6 group-hover:scale-110 transition-transform" />
                }
                {isProcessing ? 'ESTABLECIENDO DATA-LINK…' : 'CERRAR BITÁCORA Y SINCRONIZAR MRO'}
              </button>
            </>
          ) : (
            /* Estado vacío */
            <div className={`${glass.base} py-16 text-center rounded-[2rem]`}>
              <div className="w-16 h-16 rounded-[1.5rem] bg-white/[0.03] border border-white/[0.06]
                              flex items-center justify-center mx-auto mb-4">
                <Plane className="text-zinc-700" size={32} />
              </div>
              <p className="text-[11px] font-black uppercase text-zinc-600 tracking-[0.3em]">
                Seleccione un cadete del panel de misiones
              </p>
              <p className="text-[9px] font-black uppercase text-zinc-800 tracking-widest mt-2">
                Solo puede operar con alumnos asignados al día de hoy
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTES ATÓMICOS — liquid glass
// ─────────────────────────────────────────────────────────────────────────────

const InputGroup = ({ id, label, value, onChange, type = 'text', color = 'text-white' }: any) => (
  <div className="flex flex-col space-y-2 group w-full text-left">
    <label htmlFor={id}
      className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
      {label}
    </label>
    <input id={id} type={type} step="0.01" autoComplete="off"
      className={`bg-white/[0.04] backdrop-blur-xl border border-white/[0.09] p-4 rounded-2xl
                 ${color} text-sm font-bold outline-none
                 focus:border-[#E1AD01]/60 focus:bg-[#E1AD01]/[0.03]
                 transition-all uppercase w-full
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}
      value={value}
      onChange={e => onChange(e.target.value)} />
  </div>
);

const EvidenceUpload = ({ id, label, file, onSelect }: {
  id: string; label: string; file: File | null; onSelect: (f: File) => void;
}) => (
  <div className={`relative overflow-hidden rounded-2xl transition-all cursor-pointer
                   ${file
                     ? 'bg-emerald-500/[0.06] border border-emerald-500/[0.20] backdrop-blur-xl'
                     : 'bg-white/[0.02] border border-dashed border-white/[0.12] backdrop-blur-xl hover:border-[#E1AD01]/40 hover:bg-[#E1AD01]/[0.02]'
                   }`}>
    <label htmlFor={id} className="flex items-center justify-between p-4 cursor-pointer">
      <div className="flex items-center gap-3">
        {file
          ? <FileCheck className="text-emerald-400 h-5 w-5" />
          : <Camera className="text-white/30 h-5 w-5" />
        }
        <span className={`text-[10px] font-black uppercase tracking-wider ${
          file ? 'text-emerald-400' : 'text-zinc-500'
        }`}>
          {file ? 'Evidencia Capturada' : label}
        </span>
      </div>
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={e => e.target.files && onSelect(e.target.files[0])} />
    </label>
  </div>
);

const StatBox = ({ label, value, color = 'text-white' }: any) => (
  <div className="bg-white/[0.02] backdrop-blur-xl p-4 rounded-2xl border border-white/[0.06]
                  flex flex-col justify-center items-start text-left
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
    <p className="text-[8px] text-zinc-600 uppercase font-black mb-1 tracking-widest">{label}</p>
    <p className={`text-sm font-mono font-bold ${color} tracking-tighter`}>{value}</p>
  </div>
);

export default FlightRegister;
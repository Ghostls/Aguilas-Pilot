// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  VALKYRON FLIGHT SYSTEM - FLIGHT REGISTER v4.9                               ║
// ║  v4.9: Campo sede_vuelo — sede física donde se realizó el vuelo              ║
// ║        Independiente de la sede del alumno (Maturín puede volar en Lara)     ║
// ║  v4.8 preservado: vuelo siempre se registra, deuda automática en déficit     ║
// ║  v4.7 preservado: BURN automático de combustible                             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  Loader2, Plane, ShieldCheck, Camera,
  FileCheck, Users, Activity, AlertTriangle, Fuel, MapPin,
} from 'lucide-react';

interface FlightRegisterProps {
  onFlightLogUpdate?: (aircraftId: string, tachHours: number) => void;
}

interface Aircraft {
  id:             string;
  matricula:      string;
  modelo:         string;
  fuel_burn_rate: number;
}

interface Student {
  id:              string;
  nombre_completo: string;
  student_serial:  string;
  carrera_id:      string;
  sede:            string; // v4.9: sede del alumno para pre-seleccionar
}

const DEFAULT_BURN_RATE = 23.0;

const SEDES = ['BARQUISIMETO', 'MATURÍN'] as const;
type Sede = typeof SEDES[number];

// ─────────────────────────────────────────────────────────────────────────────

const FlightRegister = ({ onFlightLogUpdate }: FlightRegisterProps) => {
  const [isProcessing,      setIsProcessing]      = useState(false);
  const [fleet,             setFleet]             = useState<Aircraft[]>([]);
  const [students,          setStudents]          = useState<Student[]>([]);
  const [studentBalance,    setStudentBalance]    = useState<number | null>(null);
  const [aircraftFuelStock, setAircraftFuelStock] = useState<number | null>(null);

  const [evidence, setEvidence] = useState<{ inicial: File | null; final: File | null }>({
    inicial: null, final: null,
  });

  const [form, setForm] = useState({
    aircraft_id:        '',
    matricula:          '',
    fecha:              new Date().toISOString().split('T')[0],
    ruta:               'SVBM - LOCAL',
    sede_vuelo:         'BARQUISIMETO' as Sede,   // v4.9: sede física del vuelo
    tacInicial:         0,
    tacFinal:           0,
    horasCobrada:       0,
    student_id:         '',
    instructor:         'RENZO GOBBO',
    precioHoraCostoTac: 180,
    precioCobrado:      0,
    observacion:        '',
  });

  // ── Carga datos maestros ───────────────────────────────────────────────────

  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        const { data: fleetData } = await supabase
          .from('flota_aviones')
          .select('id, matricula, modelo, fuel_burn_rate')
          .order('matricula');

        if (fleetData?.length) {
          setFleet(fleetData);
          if (!form.aircraft_id) {
            setForm(prev => ({
              ...prev,
              aircraft_id: fleetData[0].id,
              matricula:   fleetData[0].matricula,
            }));
          }
        }

        // v4.9: incluye sede del alumno para auto-sugerir sede_vuelo
        const { data: studentData, error: studentError } = await supabase
          .from('perfiles_estudiantes')
          .select('id, nombre_completo, student_serial, carrera_id, sede')
          .eq('academic_status', 'ACTIVO')
          .eq('role', 'student')
          .order('nombre_completo', { ascending: true });

        if (studentError) throw studentError;
        setStudents(studentData || []);
      } catch (err: any) {
        console.error('[FlightRegister] fetchMasterData:', err.message);
      }
    };
    fetchMasterData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saldo combustible aeronave ─────────────────────────────────────────────

  useEffect(() => {
    const fetchAircraftFuel = async () => {
      if (!form.matricula) { setAircraftFuelStock(null); return; }
      try {
        const { data: logs, error } = await (supabase as any)
          .from('registros_combustible')
          .select('operation_type, liters, aircraft_id, destination_aircraft_id')
          .or(`aircraft_id.eq.${form.matricula},destination_aircraft_id.eq.${form.matricula}`);

        if (error) throw error;

        let stock = 0;
        (logs || []).forEach((r: any) => {
          const lts = Number(r.liters);
          if (r.operation_type === 'IN'       && r.aircraft_id === form.matricula) stock += lts;
          if (r.operation_type === 'TRANSFER' && r.aircraft_id === form.matricula) stock -= lts;
          if (r.operation_type === 'TRANSFER' && r.destination_aircraft_id === form.matricula) stock += lts;
          if (r.operation_type === 'BURN'     && r.aircraft_id === form.matricula) stock -= lts;
        });
        setAircraftFuelStock(Math.max(stock, 0));
      } catch (err) {
        console.error('[FlightRegister] fetchAircraftFuel:', err);
        setAircraftFuelStock(null);
      }
    };
    fetchAircraftFuel();
  }, [form.matricula]);

  // ── Saldo horas cadete ─────────────────────────────────────────────────────

  useEffect(() => {
    const fetchStudentBalance = async () => {
      if (!form.student_id) { setStudentBalance(null); return; }
      try {
        const [pagosRes, vuelosRes] = await Promise.all([
          supabase.from('cuentas_por_cobrar')
            .select('horas_compradas, estatus')
            .eq('student_id', form.student_id),
          supabase.from('bitacora_vuelos')
            .select('horas_tac')
            .eq('student_id', form.student_id),
        ]);

        const totalCompradas = (pagosRes.data || [])
          .filter(p => (Number(p.horas_compradas) || 0) > 0)
          .reduce((acc, p) => acc + (Number(p.horas_compradas) || 0), 0);

        const totalVoladas = (vuelosRes.data || [])
          .reduce((acc, v) => acc + (Number(v.horas_tac) || 0), 0);

        setStudentBalance(totalCompradas - totalVoladas);
      } catch (error) {
        console.error('[FlightRegister] fetchStudentBalance:', error);
      }
    };
    fetchStudentBalance();
  }, [form.student_id]);

  // v4.9: cuando se selecciona un cadete, pre-seleccionar su sede como sede_vuelo
  // El operador puede cambiarla si el alumno de Maturín está volando en Lara
  const handleStudentChange = (studentId: string) => {
    const student = students.find(s => s.id === studentId);
    const sedeAlumno = student?.sede?.toUpperCase() ?? 'BARQUISIMETO';
    const sedeNormalizada: Sede = sedeAlumno.includes('MATUR') ? 'MATURÍN' : 'BARQUISIMETO';
    setForm(prev => ({
      ...prev,
      student_id: studentId,
      sede_vuelo: sedeNormalizada,
    }));
  };

  // ── Cálculos ───────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const horasTac         = Math.max(0, parseFloat((form.tacFinal - form.tacInicial).toFixed(2)));
    const pagoCapitan      = form.horasCobrada * 15;
    const pagoGasolina     = (horasTac * 23) * 3.3;
    const costoOperacional = form.horasCobrada * 20;
    const produccionNeta   = form.precioCobrado - (pagoCapitan + pagoGasolina + costoOperacional);
    const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
    const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;
    const litersToBurn     = parseFloat((horasTac * burnRate).toFixed(1));
    return { horasTac, pagoCapitan, pagoGasolina, costoOperacional, produccionNeta, litersToBurn, burnRate };
  }, [form.tacFinal, form.tacInicial, form.horasCobrada, form.precioCobrado, form.aircraft_id, fleet]);

  useEffect(() => {
    setForm(prev => ({ ...prev, precioCobrado: form.horasCobrada * 180 }));
  }, [form.horasCobrada]);

  // ── Upload evidencia ───────────────────────────────────────────────────────

  const uploadToMIAStorage = async (file: File, prefix: string) => {
    const fileExt  = file.name.split('.').pop();
    const fileName = `${prefix}_${form.matricula}_${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('tacometros').upload(fileName, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('tacometros').getPublicUrl(fileName);
    return publicUrl;
  };

  // ── CERRAR BITÁCORA ────────────────────────────────────────────────────────

  const handleProcessFlight = async () => {
    if (!form.aircraft_id || stats.horasTac <= 0 || !form.student_id) {
      return alert('SISTEMA: Error de parámetros. Verifique Aeronave, TAC y Cadete.');
    }
    if (!evidence.inicial || !evidence.final) {
      return alert('CRITICAL: Se requiere evidencia visual de tacómetros para MRO.');
    }

    const deficit = studentBalance !== null
      ? Math.max(0, stats.horasTac - studentBalance)
      : null;

    if (deficit !== null && deficit > 0) {
      const montoDeuda = parseFloat((deficit * form.precioHoraCostoTac).toFixed(2));
      const proceed = window.confirm(
        `⚠️ SALDO INSUFICIENTE\n\n` +
        `El cadete tiene ${(studentBalance ?? 0).toFixed(1)}h disponibles.\n` +
        `Este vuelo requiere ${stats.horasTac.toFixed(2)}h.\n` +
        `Déficit: ${deficit.toFixed(2)}h = $${montoDeuda}\n\n` +
        `Se registrará una deuda pendiente en su cuenta.\n` +
        `¿Continuar y registrar la deuda?`
      );
      if (!proceed) return;
    }

    if (aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn) {
      const proceed = window.confirm(
        `⚠️ COMBUSTIBLE BAJO\n\n` +
        `${form.matricula} tiene ${aircraftFuelStock.toFixed(1)} LTS registrados.\n` +
        `Este vuelo consumirá ~${stats.litersToBurn.toFixed(1)} LTS.\n\n` +
        `¿Continuar de todas formas?`
      );
      if (!proceed) return;
    }

    setIsProcessing(true);

    try {
      const urlInicial = await uploadToMIAStorage(evidence.inicial!, 'START');
      const urlFinal   = await uploadToMIAStorage(evidence.final!,   'END');
      const alumnoRef  = students.find(s => s.id === form.student_id);

      // 1. Bitácora de vuelo — v4.9: incluye sede_vuelo
      const { error: dbError } = await supabase.from('bitacora_vuelos').insert([{
        fecha:                form.fecha,
        aircraft_id:          form.aircraft_id,
        aeronave_matricula:   form.matricula,
        ruta:                 form.ruta.toUpperCase(),
        sede_vuelo:           form.sede_vuelo,           // ← v4.9
        tac_inicial:          form.tacInicial,
        tac_final:            form.tacFinal,
        horas_tac:            stats.horasTac,
        horas_cobradas:       form.horasCobrada,
        alumno:               alumnoRef?.nombre_completo,
        student_id:           form.student_id,
        instructor:           form.instructor.toUpperCase(),
        produccion_neta:      stats.produccionNeta,
        pago_capitan:         stats.pagoCapitan,
        pago_gasolina:        stats.pagoGasolina,
        costo_operacional:    stats.costoOperacional,
        url_foto_tac_inicial: urlInicial,
        url_foto_tac_final:   urlFinal,
        observacion:          form.observacion.toUpperCase(),
      }]);
      if (dbError) throw dbError;

      // 2. Horas del estudiante
      await supabase.from('horas_vuelo_estudiante').insert([{
        student_id:      form.student_id,
        fecha:           form.fecha,
        horas:           stats.horasTac,
        matricula_avion: form.matricula,
        tipo_mision:     form.ruta.toUpperCase(),
      }]);

      // 3. Transacción financiera
      await supabase.from('transacciones_finanzas').insert([{
        type:        'INCOME',
        entity_name: `VUELO ${form.matricula} - ${alumnoRef?.nombre_completo}`,
        amount:      form.precioCobrado,
        description: `BITÁCORA CERRADA | TAC: ${stats.horasTac} | ALUMNO: ${alumnoRef?.student_serial} | SEDE: ${form.sede_vuelo}`,
        status:      'PAID',
        category:    'Vuelos',
        issue_date:  form.fecha,
        student_id:  form.student_id,
      }]);

      // 4. BURN combustible
      if (stats.litersToBurn > 0) {
        const { error: burnError } = await (supabase as any)
          .from('registros_combustible')
          .insert([{
            operation_type:          'BURN',
            aircraft_id:             form.matricula,
            destination_aircraft_id: null,
            liters:                  stats.litersToBurn,
            fuel_type:               'AVGAS 100LL',
            location:                form.sede_vuelo,    // sede real del vuelo
            vendor_id:               null,
            ticket_number:           `BRN-${form.fecha}-${form.matricula}`,
            technician:              alumnoRef?.nombre_completo?.toUpperCase() ?? 'CADETE',
            hobbs_at_charge:         form.tacFinal,
            presentation:            null,
            unit_count:              null,
          }]);
        if (burnError) console.warn('[FlightRegister] BURN warning:', burnError.message);
      }

      // 5. Deuda automática si hay déficit
      if (deficit !== null && deficit > 0) {
        const montoDeuda = parseFloat((deficit * form.precioHoraCostoTac).toFixed(2));
        const { error: debtError } = await supabase
          .from('cuentas_por_cobrar')
          .insert([{
            alumno_id:       form.student_id,
            student_id:      form.student_id,
            nombre_alumno:   alumnoRef?.nombre_completo?.toUpperCase() ?? 'SIN NOMBRE',
            student_serial:  alumnoRef?.student_serial ?? '',
            monto_total:     montoDeuda,
            monto_pagado:    0,
            monto_pendiente: montoDeuda,
            concepto:        `DEUDA VUELO ${form.matricula} — ${deficit.toFixed(2)}h × $${form.precioHoraCostoTac}/h — ${form.sede_vuelo} — ${form.fecha}`,
            fecha_emision:   form.fecha,
            estatus:         'PENDIENTE',
            horas_compradas: 0,
          }]);
        if (debtError) {
          console.error('[FlightRegister] Deuda insert error:', debtError.message);
          alert(`ADVERTENCIA: El vuelo se registró pero hubo un error al crear la deuda:\n${debtError.message}`);
        }
      }

      if (onFlightLogUpdate) onFlightLogUpdate(form.aircraft_id, stats.horasTac);

      const debtMsg = deficit && deficit > 0
        ? `\n\nDeuda generada: $${(deficit * form.precioHoraCostoTac).toFixed(2)} por ${deficit.toFixed(2)}h pendientes.`
        : '';
      alert(`MIA: OPERACIÓN MRO SINCRONIZADA.${debtMsg}`);

      setForm(prev => ({
        ...prev,
        tacInicial:    prev.tacFinal,
        tacFinal:      0,
        horasCobrada:  0,
        precioCobrado: 0,
        student_id:    '',
        // sede_vuelo se mantiene para el siguiente vuelo de la misma sesión
      }));
      setEvidence({ inicial: null, final: null });
      setStudentBalance(null);

    } catch (e: any) {
      alert('SISTEMA MIA ERROR CRÍTICO: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedAircraft = fleet.find(a => a.id === form.aircraft_id);
  const burnRate         = selectedAircraft?.fuel_burn_rate ?? DEFAULT_BURN_RATE;

  const balanceBadgeClass = studentBalance === null ? 'text-zinc-600'
    : studentBalance >= stats.horasTac ? 'text-emerald-500'
    : studentBalance > 0               ? 'text-orange-400 animate-pulse'
    :                                    'text-red-500 animate-pulse';

  const balanceLabel = studentBalance === null ? ''
    : studentBalance >= 0 ? `[ SALDO: ${studentBalance.toFixed(1)}h ]`
    :                       `[ DEBE: ${Math.abs(studentBalance).toFixed(1)}h ]`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-8 font-mono text-zinc-200 text-left">
      <div className="max-w-5xl mx-auto bg-white/[0.03] backdrop-blur-[20px] border border-white/10
                      rounded-[2.5rem] overflow-hidden shadow-2xl">

        {/* CABECERA */}
        <header className="bg-[#E1AD01] px-8 py-5 flex justify-between items-center shadow-lg">
          <div className="flex items-center gap-4 text-black">
            <Plane size={26} />
            <div>
              <h1 className="font-black text-sm tracking-[0.3em] uppercase">MRO Flight Operations</h1>
              <p className="text-black/60 text-[10px] font-bold uppercase tracking-widest">
                Valkyron OS // Aircraft Integrity Verified
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-black/10 px-3 py-1 rounded-full border border-black/5">
            <div className="w-2 h-2 rounded-full bg-black animate-pulse" />
            <span className="text-[9px] font-black text-black">SYS OK</span>
          </div>
        </header>

        <div className="p-8 space-y-8 text-left">

          {/* VECTORES DE IDENTIDAD */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

            {/* Aeronave */}
            <div className="flex flex-col space-y-2">
              <label htmlFor="mro_aircraft_id"
                className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
                Unidad de Flota
              </label>
              <select id="mro_aircraft_id"
                className="appearance-none bg-white/5 border border-white/10 p-4 rounded-2xl
                           text-white text-sm font-bold outline-none focus:border-[#E1AD01]
                           transition-all uppercase"
                value={form.aircraft_id}
                onChange={e => {
                  const selected = fleet.find(a => a.id === e.target.value);
                  setForm(prev => ({ ...prev, aircraft_id: e.target.value, matricula: selected?.matricula ?? '' }));
                }}>
                {fleet.map(unit => (
                  <option key={unit.id} value={unit.id} className="bg-[#111]">
                    {unit.matricula} — {unit.modelo}
                  </option>
                ))}
              </select>

              {aircraftFuelStock !== null && (
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase
                  ${aircraftFuelStock >= stats.litersToBurn
                    ? 'border-[#E1AD01]/20 bg-[#E1AD01]/5 text-[#E1AD01]'
                    : 'border-orange-500/30 bg-orange-500/5 text-orange-400'}`}>
                  <Fuel className="h-3 w-3" />
                  {aircraftFuelStock.toFixed(1)} LTS
                  {aircraftFuelStock < stats.litersToBurn && stats.litersToBurn > 0 && (
                    <AlertTriangle className="h-3 w-3 ml-auto" />
                  )}
                </div>
              )}
            </div>

            {/* Cadete */}
            <div className="flex flex-col space-y-2 md:col-span-2">
              <div className="flex justify-between items-center ml-1">
                <label htmlFor="mro_student_id"
                  className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest">
                  Cadete en Misión
                </label>
                {studentBalance !== null && (
                  <span className={`text-[9px] font-black uppercase tracking-widest ${balanceBadgeClass}`}>
                    {balanceLabel}
                  </span>
                )}
              </div>
              <div className="relative">
                <select id="mro_student_id"
                  className="appearance-none w-full bg-white/5 border border-white/10 p-4 rounded-2xl
                             text-white text-sm font-bold outline-none focus:border-[#E1AD01]
                             transition-all uppercase"
                  value={form.student_id}
                  onChange={e => handleStudentChange(e.target.value)}>
                  <option value="" className="bg-[#111]">-- SELECCIONAR CADETE --</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id} className="bg-[#111]">
                      {s.nombre_completo} ({s.student_serial})
                      {s.sede ? ` · ${s.sede.toUpperCase()}` : ''}
                    </option>
                  ))}
                </select>
                <Users className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#E1AD01]" />
              </div>

              {studentBalance !== null && studentBalance < stats.horasTac && stats.horasTac > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl
                                bg-orange-500/5 border border-orange-500/20">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[8px] text-orange-400 font-black uppercase tracking-widest">
                      Saldo insuficiente — se generará deuda
                    </p>
                    <p className="text-[8px] text-orange-300/60 font-mono mt-0.5">
                      Déficit: {Math.max(0, stats.horasTac - studentBalance).toFixed(2)}h ·{' '}
                      ${(Math.max(0, stats.horasTac - studentBalance) * form.precioHoraCostoTac).toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <InputGroup id="mro_fecha_op" label="Fecha Registro" type="date"
              value={form.fecha} onChange={(v: string) => setForm(prev => ({ ...prev, fecha: v }))} />
          </div>

          {/* RUTA + INSTRUCTOR + SEDE VUELO */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-white/5 pt-8">
            <InputGroup id="mro_ruta" label="Misión / Ruta" value={form.ruta}
              onChange={(v: string) => setForm(prev => ({ ...prev, ruta: v }))} />

            <InputGroup id="mro_instructor" label="Instructor al Mando" value={form.instructor}
              onChange={(v: string) => setForm(prev => ({ ...prev, instructor: v }))} />

            {/* v4.9: Sede del vuelo — toggle visual */}
            <div className="flex flex-col space-y-2">
              <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1 flex items-center gap-1.5">
                <MapPin className="h-3 w-3" /> Sede del Vuelo
              </label>
              <div className="flex bg-black/60 border border-white/10 rounded-2xl p-1 gap-1">
                {SEDES.map(sede => (
                  <button
                    key={sede}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, sede_vuelo: sede }))}
                    className={`flex-1 py-3 px-2 rounded-xl text-[9px] font-black uppercase
                                tracking-widest transition-all
                                ${form.sede_vuelo === sede
                                  ? 'bg-[#E1AD01] text-black shadow-md'
                                  : 'text-slate-500 hover:text-white'}`}>
                    {sede}
                  </button>
                ))}
              </div>
              {/* Indicador si el alumno es de otra sede */}
              {form.student_id && (() => {
                const alumno = students.find(s => s.id === form.student_id);
                const sedeAlumno = alumno?.sede?.toUpperCase() ?? '';
                const esMaturin  = sedeAlumno.includes('MATUR');
                const sedeAlumnoNorm: Sede = esMaturin ? 'MATURÍN' : 'BARQUISIMETO';
                if (sedeAlumnoNorm !== form.sede_vuelo) {
                  return (
                    <p className="text-[8px] text-blue-400/70 font-mono ml-1 flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5" />
                      Alumno de {sedeAlumnoNorm} — volando en {form.sede_vuelo}
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          </div>

          {/* TELEMETRÍA TACÓMETRO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 bg-[#E1AD01]/10 rounded-bl-xl">
                <Activity size={12} className="text-[#E1AD01]" />
              </div>
              <InputGroup id="mro_tac_inicial" label="TAC Inicial" type="number"
                value={form.tacInicial} color="text-[#E1AD01]"
                onChange={(v: number) => setForm(prev => ({ ...prev, tacInicial: Number(v) }))} />
              <div className="mt-4">
                <EvidenceUpload id="mro_file_start" label="Captura TAC Inicial"
                  file={evidence.inicial} onSelect={f => setEvidence(prev => ({ ...prev, inicial: f }))} />
              </div>
            </div>
            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 bg-[#E1AD01]/10 rounded-bl-xl">
                <Activity size={12} className="text-[#E1AD01]" />
              </div>
              <InputGroup id="mro_tac_final" label="TAC Final" type="number"
                value={form.tacFinal} color="text-[#E1AD01]"
                onChange={(v: number) => setForm(prev => ({ ...prev, tacFinal: Number(v) }))} />
              <div className="mt-4">
                <EvidenceUpload id="mro_file_end" label="Captura TAC Final"
                  file={evidence.final} onSelect={f => setEvidence(prev => ({ ...prev, final: f }))} />
              </div>
            </div>
          </div>

          {/* BURN PREVIEW */}
          {stats.horasTac > 0 && (
            <div className={`flex items-center justify-between px-6 py-4 rounded-2xl border
              ${aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                ? 'bg-orange-500/5 border-orange-500/20'
                : 'bg-[#E1AD01]/5 border-[#E1AD01]/20'}`}>
              <div className="flex items-center gap-3">
                <Fuel className={`h-4 w-4 shrink-0 ${
                  aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                    ? 'text-orange-400' : 'text-[#E1AD01]'}`} />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/50">
                    Consumo estimado — se descontará al cerrar
                  </p>
                  <p className={`text-sm font-black font-mono ${
                    aircraftFuelStock !== null && aircraftFuelStock < stats.litersToBurn
                      ? 'text-orange-400' : 'text-[#E1AD01]'}`}>
                    {stats.litersToBurn.toFixed(1)} LTS
                    <span className="text-[9px] text-white/30 ml-2 font-normal">
                      ({stats.horasTac.toFixed(2)}h × {burnRate} LTS/h)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TELEMETRÍA FINANCIERA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/40 p-8 rounded-[2rem]
                          border border-white/5 shadow-inner">
            <InputGroup id="mro_horas_facturadas" label="Horas Facturadas (Rate $180/h)"
              type="number" value={form.horasCobrada}
              onChange={(v: number) => setForm(prev => ({ ...prev, horasCobrada: Number(v) }))} />
            <InputGroup id="mro_monto_cobrado" label="Monto Total a Cobrar ($)"
              type="number" value={form.precioCobrado} color="text-emerald-400"
              onChange={(v: number) => setForm(prev => ({ ...prev, precioCobrado: Number(v) }))} />
          </div>

          {/* DASHBOARD MRO ENGINE */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatBox label="Horas TAC Reales"  value={stats.horasTac.toFixed(2)} />
            <StatBox label="Instructor ($15h)" value={`-$${stats.pagoCapitan}`}              color="text-red-400/80" />
            <StatBox label="Combustible"        value={`-$${stats.pagoGasolina.toFixed(1)}`} color="text-red-400/80" />
            <StatBox label="MRO Op Fee ($20h)" value={`-$${stats.costoOperacional}`}         color="text-[#E1AD01]" />
            <div className="bg-[#E1AD01] p-5 rounded-2xl flex flex-col justify-center items-center
                            shadow-[0_10px_30px_rgba(225,173,1,0.2)] text-center">
              <span className="text-[9px] text-black font-black uppercase tracking-tighter">Net Profit</span>
              <span className="text-2xl font-mono text-black font-black leading-none mt-1">
                ${stats.produccionNeta.toFixed(2)}
              </span>
            </div>
          </div>

          {/* OBSERVACIÓN */}
          <div className="flex flex-col space-y-2">
            <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
              Observaciones
            </label>
            <textarea rows={2}
              className="bg-white/5 border border-white/10 p-4 rounded-2xl text-white text-sm
                         font-bold outline-none focus:border-[#E1AD01] transition-all uppercase resize-none"
              value={form.observacion}
              onChange={e => setForm(prev => ({ ...prev, observacion: e.target.value }))} />
          </div>

          {/* CTA */}
          <button type="button" onClick={handleProcessFlight} disabled={isProcessing}
            className="w-full bg-white text-black font-black py-7 rounded-[2rem] uppercase
                       text-[11px] tracking-[0.5em] flex items-center justify-center gap-4
                       hover:bg-[#E1AD01] transition-all shadow-2xl active:scale-95
                       disabled:opacity-30 group">
            {isProcessing
              ? <Loader2 className="animate-spin h-5 w-5" />
              : <ShieldCheck className="h-6 w-6 group-hover:scale-110 transition-transform" />
            }
            {isProcessing ? 'ESTABLECIENDO DATA-LINK…' : 'CERRAR BITÁCORA Y SINCRONIZAR MRO'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── COMPONENTES ATÓMICOS ──────────────────────────────────────────────────────

const InputGroup = ({ id, label, value, onChange, type = 'text', color = 'text-white' }: any) => (
  <div className="flex flex-col space-y-2 group w-full text-left">
    <label htmlFor={id} className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1">
      {label}
    </label>
    <input id={id} type={type} step="0.01" autoComplete="off"
      className={`bg-white/5 border border-white/10 p-4 rounded-2xl ${color} text-sm font-bold
                 outline-none focus:border-[#E1AD01] transition-all uppercase w-full`}
      value={value}
      onChange={e => onChange(e.target.value)} />
  </div>
);

const EvidenceUpload = ({ id, label, file, onSelect }: {
  id: string; label: string; file: File | null; onSelect: (f: File) => void;
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-dashed border-white/20
                  hover:border-[#E1AD01]/50 transition-colors bg-black/20">
    <label htmlFor={id} className="flex items-center justify-between p-4 cursor-pointer">
      <div className="flex items-center gap-3">
        {file ? <FileCheck className="text-emerald-400 h-5 w-5" /> : <Camera className="text-white/40 h-5 w-5" />}
        <span className={`text-[10px] font-black uppercase tracking-wider ${file ? 'text-emerald-400' : 'text-white/60'}`}>
          {file ? 'Evidencia Capturada' : label}
        </span>
      </div>
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={e => e.target.files && onSelect(e.target.files[0])} />
    </label>
  </div>
);

const StatBox = ({ label, value, color = 'text-white' }: any) => (
  <div className="bg-white/[0.02] p-4 rounded-2xl border border-white/5 flex flex-col
                  justify-center items-start text-left">
    <p className="text-[8px] text-white/30 uppercase font-black mb-1 tracking-widest">{label}</p>
    <p className={`text-sm font-mono font-bold ${color} tracking-tighter`}>{value}</p>
  </div>
);

export default FlightRegister;
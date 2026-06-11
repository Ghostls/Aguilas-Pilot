// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  VALKYRON FLIGHT SYSTEM - FLIGHT REGISTER v4.6                               ║
// ║  FIX v4.6: Filtro role='student' en dropdown de cadetes                     ║
// ║  PATCH v4.5 preservado: Protocolo Validación Financiera de Vuelo            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient'; 
import { 
  Loader2, Plane, ShieldCheck, Camera, 
  FileCheck, Users, Activity, AlertTriangle
} from 'lucide-react';

interface FlightRegisterProps {
  onFlightLogUpdate?: (aircraftId: string, tachHours: number) => void;
}

interface Aircraft {
  id: string;
  matricula: string;
  modelo: string;
}

interface Student {
  id: string;
  nombre_completo: string;
  student_serial: string;
  carrera_id: string;
}

const FlightRegister = ({ onFlightLogUpdate }: FlightRegisterProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fleet, setFleet] = useState<Aircraft[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentBalance, setStudentBalance] = useState<number | null>(null);
  
  const [evidence, setEvidence] = useState<{inicial: File | null, final: File | null}>({
    inicial: null,
    final: null
  });

  const [form, setForm] = useState({
    aircraft_id: '',
    matricula: '',  
    fecha: new Date().toISOString().split('T')[0],
    ruta: 'SVBM - LOCAL',
    tacInicial: 0,
    tacFinal: 0,
    horasCobrada: 0,
    student_id: '', 
    instructor: 'RENZO GOBBO',
    precioHoraCostoTac: 80, 
    precioCobrado: 0,
    observacion: ''
  });

  // CARGA DE DATOS MAESTROS
  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        const { data: fleetData } = await supabase
          .from('flota_aviones')
          .select('id, matricula, modelo')
          .order('matricula');

        if (fleetData && fleetData.length > 0) {
          setFleet(fleetData);
          if (!form.aircraft_id) {
            setForm(prev => ({ 
              ...prev, 
              aircraft_id: fleetData[0].id,
              matricula: fleetData[0].matricula 
            }));
          }
        }

        // FIX v4.6: .eq('role', 'student') filtra solo estudiantes — excluye admins
        const { data: studentData, error: studentError } = await supabase
          .from('perfiles_estudiantes')
          .select('id, nombre_completo, student_serial, carrera_id')
          .eq('academic_status', 'ACTIVO')
          .eq('role', 'student')
          .order('nombre_completo', { ascending: true });

        if (studentError) throw studentError;
        setStudents(studentData || []);
      } catch (err: any) {
        console.error("MIA MRO ERROR:", err.message);
      }
    };
    fetchMasterData();
  }, []);

  // CÁLCULOS FÍSICOS Y FINANCIEROS
  const stats = useMemo(() => {
    const horasTac = Math.max(0, parseFloat((form.tacFinal - form.tacInicial).toFixed(2)));
    const pagoCapitan = form.horasCobrada * 15; 
    const pagoGasolina = (horasTac * 23) * 3.3; 
    const costoOperacional = form.horasCobrada * 20; 
    const produccionNeta = form.precioCobrado - (pagoCapitan + pagoGasolina + costoOperacional);
    return { horasTac, pagoCapitan, pagoGasolina, costoOperacional, produccionNeta };
  }, [form.tacFinal, form.tacInicial, form.horasCobrada, form.precioCobrado]);

  // AUTO-SUGERENCIA FINANCIERA
  useEffect(() => {
    setForm(prev => ({ ...prev, precioCobrado: form.horasCobrada * 80 }));
  }, [form.horasCobrada]);

  // RADAR DE SALDO EN TIEMPO REAL
  useEffect(() => {
    const fetchStudentBalance = async () => {
      if (!form.student_id) { setStudentBalance(null); return; }
      try {
        const [pagosRes, vuelosRes] = await Promise.all([
          supabase.from('cuentas_por_cobrar').select('horas_compradas').eq('student_id', form.student_id),
          supabase.from('bitacora_vuelos').select('horas_tac').eq('student_id', form.student_id)
        ]);
        const totalCompradas = (pagosRes.data || []).reduce((acc, p) => acc + (Number(p.horas_compradas) || 0), 0);
        const totalVoladas   = (vuelosRes.data || []).reduce((acc, v) => acc + (Number(v.horas_tac) || 0), 0);
        setStudentBalance(totalCompradas - totalVoladas);
      } catch (error) {
        console.error("Error leyendo saldo de cadete:", error);
      }
    };
    fetchStudentBalance();
  }, [form.student_id]);

  const uploadToMIAStorage = async (file: File, prefix: string) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${prefix}_${form.matricula}_${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('tacometros').upload(fileName, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('tacometros').getPublicUrl(fileName);
    return publicUrl;
  };

  const handleProcessFlight = async () => {
    if (!form.aircraft_id || stats.horasTac <= 0 || !form.student_id) {
      return alert("SISTEMA: Error de parámetros. Verifique Aeronave (ID), TAC y Cadete.");
    }
    if (!evidence.inicial || !evidence.final) {
      return alert("CRITICAL: Se requiere evidencia visual de tacómetros para MRO.");
    }
    if (studentBalance !== null && studentBalance < stats.horasTac) {
      return alert(`PROTOCOLO BLOQUEADO: El cadete solo dispone de ${studentBalance.toFixed(1)}h. La misión requiere ${stats.horasTac.toFixed(1)}h. FACTURACIÓN REQUERIDA.`);
    }

    setIsProcessing(true);

    try {
      const urlInicial = await uploadToMIAStorage(evidence.inicial, 'START');
      const urlFinal   = await uploadToMIAStorage(evidence.final,   'END');
      const alumnoRef  = students.find(s => s.id === form.student_id);

      const { error: dbError } = await supabase.from('bitacora_vuelos').insert([{
        fecha:                form.fecha,
        aircraft_id:          form.aircraft_id,
        aeronave_matricula:   form.matricula,
        ruta:                 form.ruta.toUpperCase(),
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
        observacion:          form.observacion.toUpperCase()
      }]);

      if (dbError) {
        if (dbError.message.includes('PROTOCOLO BLOQUEADO')) throw new Error(dbError.message);
        throw dbError;
      }

      await supabase.from('horas_vuelo_estudiante').insert([{
        student_id:    form.student_id,
        fecha:         form.fecha,
        horas:         stats.horasTac,
        matricula_avion: form.matricula,
        tipo_mision:   form.ruta.toUpperCase()
      }]);

      await supabase.from('transacciones_finanzas').insert([{
        type:         'INCOME',
        entity_name:  `VUELO ${form.matricula} - ${alumnoRef?.nombre_completo}`,
        amount:       form.precioCobrado,
        description:  `BITÁCORA CERRADA | TAC: ${stats.horasTac} | ALUMNO: ${alumnoRef?.student_serial}`,
        status:       'PAID',
        category:     'Vuelos',
        issue_date:   form.fecha,
        student_id:   form.student_id
      }]);

      if (onFlightLogUpdate) onFlightLogUpdate(form.aircraft_id, stats.horasTac);

      alert("MIA: OPERACIÓN MRO SINCRONIZADA. REGISTRO EXITOSO.");
      
      setForm(prev => ({ 
        ...prev, 
        tacInicial:   prev.tacFinal, 
        tacFinal:     0, 
        horasCobrada: 0, 
        precioCobrado: 0, 
        student_id:   '' 
      }));
      setEvidence({ inicial: null, final: null });
      setStudentBalance(null);

    } catch (e: any) {
      alert("SISTEMA MIA ERROR CRÍTICO: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-8 font-mono text-zinc-200 text-left">
      <div className="max-w-5xl mx-auto bg-white/[0.03] backdrop-blur-[20px] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl">
        
        {/* CABECERA */}
        <header className="bg-[#E1AD01] px-8 py-5 flex justify-between items-center shadow-lg text-left">
          <div className="flex items-center gap-4 text-black text-left">
            <Plane size={26} />
            <div className="text-left">
              <h1 className="font-black text-sm tracking-[0.3em] uppercase">MRO Flight Operations</h1>
              <p className="text-black/60 text-[10px] font-bold uppercase tracking-widest">Valkyron OS // Aircraft Integrity Verified</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-black/10 px-3 py-1 rounded-full border border-black/5">
            <div className="w-2 h-2 rounded-full bg-black animate-pulse" />
            <span className="text-[9px] font-black text-black">SYS OK</span>
          </div>
        </header>

        <div className="p-8 space-y-8 text-left">

          {/* VECTORES DE IDENTIDAD */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-left">
            <div className="flex flex-col space-y-2 text-left">
              <label htmlFor="mro_aircraft_id" className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1 text-left">
                Unidad de Flota
              </label>
              <select 
                id="mro_aircraft_id"
                className="appearance-none bg-white/5 border border-white/10 p-4 rounded-2xl text-white text-sm font-bold outline-none focus:border-[#E1AD01] transition-all uppercase"
                value={form.aircraft_id}
                onChange={(e) => {
                  const selected = fleet.find(a => a.id === e.target.value);
                  setForm({...form, aircraft_id: e.target.value, matricula: selected?.matricula || ''});
                }}
              >
                {fleet.map(unit => (
                  <option key={unit.id} value={unit.id} className="bg-[#111]">
                    {unit.matricula} - {unit.modelo}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col space-y-2 md:col-span-2 text-left">
              <div className="flex justify-between items-center ml-1">
                <label htmlFor="mro_student_id" className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest text-left">
                  Cadete en Misión
                </label>
                {studentBalance !== null && (
                  <span className={`text-[9px] font-black uppercase tracking-widest ${
                    studentBalance >= stats.horasTac ? 'text-emerald-500' : 'text-red-500 animate-pulse'
                  }`}>
                    [ FONDO: {studentBalance.toFixed(1)}h ]
                  </span>
                )}
              </div>
              <div className="relative">
                <select 
                  id="mro_student_id"
                  className="appearance-none w-full bg-white/5 border border-white/10 p-4 rounded-2xl text-white text-sm font-bold outline-none focus:border-[#E1AD01] transition-all uppercase"
                  value={form.student_id}
                  onChange={(e) => setForm({...form, student_id: e.target.value})}
                >
                  <option value="" className="bg-[#111]">-- SELECCIONAR CADETE --</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id} className="bg-[#111]">
                      {s.nombre_completo} ({s.student_serial})
                    </option>
                  ))}
                </select>
                <Users className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#E1AD01]" />
              </div>
            </div>

            <InputGroup 
              id="mro_fecha_op"
              label="Fecha Registro" 
              type="date" 
              value={form.fecha} 
              onChange={(v: string) => setForm({...form, fecha: v})} 
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left border-t border-white/5 pt-8">
            <InputGroup id="mro_ruta" label="Misión / Ruta" value={form.ruta} onChange={(v: string) => setForm({...form, ruta: v})} />
            <InputGroup id="mro_instructor" label="Instructor al Mando" value={form.instructor} onChange={(v: string) => setForm({...form, instructor: v})} />
          </div>

          {/* TELEMETRÍA TACÓMETRO */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 bg-[#E1AD01]/10 rounded-bl-xl">
                <Activity size={12} className="text-[#E1AD01]" />
              </div>
              <InputGroup 
                id="mro_tac_inicial"
                label="TAC Inicial" 
                type="number" 
                value={form.tacInicial} 
                color="text-[#E1AD01]" 
                onChange={(v: number) => setForm({...form, tacInicial: Number(v)})} 
              />
              <div className="mt-4">
                <EvidenceUpload 
                  id="mro_file_start"
                  label="Captura TAC Inicial" 
                  file={evidence.inicial} 
                  onSelect={(f) => setEvidence({...evidence, inicial: f})} 
                />
              </div>
            </div>
            <div className="bg-white/5 p-6 rounded-3xl border border-white/5 text-left relative overflow-hidden">
              <div className="absolute top-0 right-0 p-2 bg-[#E1AD01]/10 rounded-bl-xl">
                <Activity size={12} className="text-[#E1AD01]" />
              </div>
              <InputGroup 
                id="mro_tac_final"
                label="TAC Final" 
                type="number" 
                value={form.tacFinal} 
                color="text-[#E1AD01]" 
                onChange={(v: number) => setForm({...form, tacFinal: Number(v)})} 
              />
              <div className="mt-4">
                <EvidenceUpload 
                  id="mro_file_end"
                  label="Captura TAC Final" 
                  file={evidence.final} 
                  onSelect={(f) => setEvidence({...evidence, final: f})} 
                />
              </div>
            </div>
          </div>

          {/* TELEMETRÍA FINANCIERA */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/40 p-8 rounded-[2rem] border border-white/5 text-left shadow-inner">
            <InputGroup 
              id="mro_horas_facturadas" 
              label="Horas Facturadas (Rate 1.1h=$22)" 
              type="number" 
              value={form.horasCobrada} 
              onChange={(v: number) => setForm({...form, horasCobrada: Number(v)})} 
            />
            <InputGroup 
              id="mro_monto_cobrado" 
              label="Monto Total a Cobrar ($)" 
              type="number" 
              value={form.precioCobrado} 
              color="text-emerald-400" 
              onChange={(v: number) => setForm({...form, precioCobrado: Number(v)})} 
            />
          </div>

          {/* DASHBOARD MRO ENGINE */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-left">
            <StatBox label="Horas TAC Reales"   value={stats.horasTac.toFixed(2)} />
            <StatBox label="Instructor ($15h)"  value={`-$${stats.pagoCapitan}`}           color="text-red-400/80" />
            <StatBox label="Combustible"         value={`-$${stats.pagoGasolina.toFixed(1)}`} color="text-red-400/80" />
            <StatBox label="MRO Op Fee ($20h)"  value={`-$${stats.costoOperacional}`}      color="text-[#E1AD01]" />
            <div className="bg-[#E1AD01] p-5 rounded-2xl flex flex-col justify-center items-center shadow-[0_10px_30px_rgba(225,173,1,0.2)] text-center">
              <span className="text-[9px] text-black font-black uppercase tracking-tighter">Net Profit</span>
              <span className="text-2xl font-mono text-black font-black leading-none mt-1">${stats.produccionNeta.toFixed(2)}</span>
            </div>
          </div>

          <button 
            type="button"
            onClick={handleProcessFlight}
            disabled={isProcessing}
            className="w-full bg-white text-black font-black py-7 rounded-[2rem] uppercase text-[11px] tracking-[0.5em] flex items-center justify-center gap-4 hover:bg-[#E1AD01] transition-all shadow-2xl active:scale-95 disabled:opacity-30 group"
          >
            {isProcessing 
              ? <Loader2 className="animate-spin h-5 w-5" /> 
              : <ShieldCheck className="h-6 w-6 group-hover:scale-110 transition-transform" />
            }
            {isProcessing ? "ESTABLECIENDO DATA-LINK..." : "CERRAR BITÁCORA Y SINCRONIZAR MRO"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── COMPONENTES ATÓMICOS ──────────────────────────────────────────────────────

const InputGroup = ({ id, label, value, onChange, type = "text", color = "text-white" }: any) => (
  <div className="flex flex-col space-y-2 group w-full text-left">
    <label htmlFor={id} className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1 text-left">
      {label}
    </label>
    <input 
      id={id}
      type={type} 
      step="0.01"
      className={`bg-white/5 border border-white/10 p-4 rounded-2xl ${color} text-sm font-bold outline-none focus:border-[#E1AD01] transition-all uppercase w-full text-left`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  </div>
);

const EvidenceUpload = ({ id, label, file, onSelect }: { id: string; label: string; file: File | null; onSelect: (f: File) => void }) => (
  <div className="relative overflow-hidden rounded-2xl border border-dashed border-white/20 hover:border-[#E1AD01]/50 transition-colors bg-black/20 text-left">
    <label htmlFor={id} className="flex items-center justify-between p-4 cursor-pointer text-left">
      <div className="flex items-center gap-3 text-left">
        {file ? <FileCheck className="text-emerald-400 h-5 w-5" /> : <Camera className="text-white/40 h-5 w-5" />}
        <span className={`text-[10px] font-black uppercase tracking-wider ${file ? 'text-emerald-400' : 'text-white/60'} text-left`}>
          {file ? "Evidencia Capturada" : label}
        </span>
      </div>
      <input 
        id={id}
        type="file" 
        accept="image/*" 
        capture="environment"
        className="sr-only"
        onChange={(e) => e.target.files && onSelect(e.target.files[0])}
      />
    </label>
  </div>
);

const StatBox = ({ label, value, color = "text-white" }: any) => (
  <div className="bg-white/[0.02] p-4 rounded-2xl border border-white/5 flex flex-col justify-center items-start text-left">
    <p className="text-[8px] text-white/30 uppercase font-black mb-1 tracking-widest text-left">{label}</p>
    <p className={`text-sm font-mono font-bold ${color} text-left tracking-tighter`}>{value}</p>
  </div>
);

export default FlightRegister;
import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient'; 
import { 
  Loader2, Plane, TrendingUp, ShieldCheck, Camera, 
  FileCheck, ChevronDown, HardDrive
} from 'lucide-react';

interface FlightRegisterProps {
  onFlightLogUpdate?: (aircraftId: string, tachHours: number) => void;
}

interface Aircraft {
  id: string;
  matricula: string;
  modelo: string;
}

const FlightRegister = ({ onFlightLogUpdate }: FlightRegisterProps) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [fleet, setFleet] = useState<Aircraft[]>([]);
  
  const [evidence, setEvidence] = useState<{inicial: File | null, final: File | null}>({
    inicial: null,
    final: null
  });

  const [form, setForm] = useState({
    matricula: '', 
    fecha: new Date().toISOString().split('T')[0],
    ruta: 'SVBM - Local',
    tacInicial: 0,
    tacFinal: 0,
    horasCobrada: 0,
    alumno: '',
    instructor: 'Renzo Gobbo',
    precioHoraCostoTac: 100,
    precioCobrado: 0,
    observacion: ''
  });

  // CARGA DE FLOTA DESDE 'flota_aviones' (Mapeo de Realidad)
  useEffect(() => {
    const fetchFleet = async () => {
      try {
        const { data, error } = await supabase
          .from('flota_aviones')
          .select('id, matricula, modelo')
          .order('matricula', { ascending: true });
        
        if (error) throw error;

        if (data && data.length > 0) {
          setFleet(data);
          // Auto-selección del primer vector disponible
          setForm(prev => ({ ...prev, matricula: data[0].matricula }));
        }
      } catch (err: any) {
        console.error("MIA CRITICAL ERROR (Fleet):", err.message);
      }
    };
    fetchFleet();
  }, []);

  // CÁLCULOS FÍSICOS Y FINANCIEROS DE PRECISIÓN (MIA ENGINE)
  const stats = useMemo(() => {
    // Delta de Tiempo (Horas Decimales)
    const horasTac = Math.max(0, parseFloat((form.tacFinal - form.tacInicial).toFixed(2)));
    
    // Vectores de Gasto
    const pagoCapitan = form.horasCobrada * 15; 
    const pagoGasolina = (horasTac * 23) * 3.3; 
    const costoOperacional = form.horasCobrada * 20;
    
    // Ecuación de Producción Neta
    const produccionNeta = form.precioCobrado - (pagoCapitan + pagoGasolina + costoOperacional);

    return { horasTac, pagoCapitan, pagoGasolina, costoOperacional, produccionNeta };
  }, [form.tacFinal, form.tacInicial, form.horasCobrada, form.precioCobrado]);

  // PROTOCOLO DE CARGA DE EVIDENCIA (STORAGE)
  const uploadToMIAStorage = async (file: File, prefix: string) => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${prefix}_${form.matricula}_${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('tacometros')
      .upload(fileName, file);

    if (error) throw error;
    
    const { data: { publicUrl } } = supabase.storage
      .from('tacometros')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const handleProcessFlight = async () => {
    // Validaciones de Integridad Operativa
    if (!form.matricula) return alert("SISTEMA: No hay aeronave seleccionada en el vector.");
    if (stats.horasTac <= 0) return alert("ERROR: Delta de TAC no puede ser ≤ 0.");
    if (!evidence.inicial || !evidence.final) return alert("CRITICAL: Falta evidencia visual de TAC.");
    if (form.precioCobrado <= 0) return alert("AVISO: Monto cobrado no definido.");

    setIsProcessing(true);

    try {
      // 1. Carga de Evidencia Visual
      const urlInicial = await uploadToMIAStorage(evidence.inicial, 'START');
      const urlFinal = await uploadToMIAStorage(evidence.final, 'END');

      // 2. Persistencia en Bitácora (Sincronizado con Schema Real)
      const { error: dbError } = await supabase.from('bitacora_vuelos').insert([{
        fecha: form.fecha,
        aeronave_matricula: form.matricula,
        ruta: form.ruta.toUpperCase(),
        tac_inicial: form.tacInicial,
        tac_final: form.tacFinal,
        horas_tac: stats.horasTac,
        horas_cobradas: form.horasCobrada,
        alumno: form.alumno.toUpperCase(),
        instructor: form.instructor.toUpperCase(),
        produccion_neta: stats.produccionNeta,
        pago_capitan: stats.pagoCapitan,
        pago_gasolina: stats.pagoGasolina,
        costo_operacional: stats.costoOperacional,
        url_foto_tac_inicial: urlInicial,
        url_foto_tac_final: urlFinal,
        observacion: form.observacion.toUpperCase()
      }]);

      if (dbError) throw dbError;

      // 3. Sincronización Financiera (Módulo de Ingresos)
      await supabase.from('transacciones_finanzas').insert([{
        type: 'INCOME',
        entity_name: `VUELO ${form.matricula} - ${form.alumno.toUpperCase()}`,
        amount: form.precioCobrado,
        description: `VUELO REGISTRADO | NETO CALC: ${stats.produccionNeta}`,
        status: 'PAID',
        category: 'Vuelos',
        issue_date: form.fecha
      }]);

      if (onFlightLogUpdate) onFlightLogUpdate(form.matricula, stats.horasTac);

      alert("MIA: OPERACIÓN SINCRONIZADA CON ÉXITO");
      
      // Reset con preservación de estado para flujo continuo
      setForm(prev => ({ 
        ...prev, 
        tacInicial: prev.tacFinal, 
        tacFinal: 0, 
        horasCobrada: 0, 
        precioCobrado: 0, 
        alumno: '' 
      }));
      setEvidence({ inicial: null, final: null });

    } catch (e: any) {
      alert("SISTEMA MIA ERROR: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-8 font-sans text-zinc-200">
      <div className="max-w-5xl mx-auto bg-white/[0.03] backdrop-blur-[20px] border border-white/10 rounded-[2.5rem] overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]">
        
        {/* HEADER TÁCTICO */}
        <div className="bg-[#E1AD01] px-8 py-4 flex justify-between items-center shadow-lg">
          <div className="flex items-center gap-4">
            <div className="bg-black/20 p-2 rounded-lg backdrop-blur-md">
              <Plane className="h-6 w-6 text-black" />
            </div>
            <div>
              <h3 className="font-black text-black text-sm tracking-[0.3em] leading-none uppercase">Aguilas Pilot Tactical System</h3>
              <p className="text-black/60 text-[10px] font-bold mt-1 uppercase tracking-tighter">MIA Flight Intelligence // Fleet Hub</p>
            </div>
          </div>
          <ShieldCheck className="h-6 w-6 text-black opacity-40" />
        </div>

        <div className="p-8 space-y-8">
          {/* SECCIÓN 1: LOGÍSTICA Y FLOTA */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="flex flex-col space-y-2 group">
              <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1 transition-transform group-focus-within:translate-x-1">Selector de Aeronave</label>
              <div className="relative">
                <select 
                  className="appearance-none bg-white/5 border border-white/10 p-4 rounded-2xl text-white text-sm font-bold outline-none focus:border-[#E1AD01]/50 focus:bg-white/10 transition-all uppercase w-full backdrop-blur-md cursor-pointer"
                  value={form.matricula}
                  onChange={(e) => setForm({...form, matricula: e.target.value})}
                >
                  {fleet.map(unit => (
                    <option key={unit.id} value={unit.matricula} className="bg-[#111] text-white">
                      {unit.matricula} - {unit.modelo}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#E1AD01] pointer-events-none" />
              </div>
            </div>
            <InputGroup label="Fecha Operación" type="date" value={form.fecha} onChange={(v: string) => setForm({...form, fecha: v})} />
            <InputGroup label="Misión / Ruta" value={form.ruta} onChange={(v: string) => setForm({...form, ruta: v})} />
            <InputGroup label="Personal Alumno" value={form.alumno} onChange={(v: string) => setForm({...form, alumno: v})} />
          </div>

          {/* SECCIÓN 2: TELEMETRÍA (LIQUID GLASS PANELS) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-gradient-to-br from-white/[0.05] to-transparent p-6 rounded-3xl border border-white/5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <HardDrive size={60} />
              </div>
              <InputGroup label="TAC. Inicial (Start)" type="number" value={form.tacInicial} color="text-[#E1AD01]" onChange={(v: number) => setForm({...form, tacInicial: Number(v)})} />
              <div className="mt-4">
                <EvidenceUpload 
                  label="Capturar TAC Inicial" 
                  file={evidence.inicial} 
                  onSelect={(f) => setEvidence({...evidence, inicial: f})} 
                />
              </div>
            </div>

            <div className="bg-gradient-to-br from-white/[0.05] to-transparent p-6 rounded-3xl border border-white/5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <TrendingUp size={60} />
              </div>
              <InputGroup label="TAC. Final (End)" type="number" value={form.tacFinal} color="text-[#E1AD01]" onChange={(v: number) => setForm({...form, tacFinal: Number(v)})} />
              <div className="mt-4">
                <EvidenceUpload 
                  label="Capturar TAC Final" 
                  file={evidence.final} 
                  onSelect={(f) => setEvidence({...evidence, final: f})} 
                />
              </div>
            </div>
          </div>

          {/* SECCIÓN 3: FINANZAS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/40 p-6 rounded-3xl border border-white/5">
            <InputGroup label="Horas a Facturar" type="number" value={form.horasCobrada} onChange={(v: number) => setForm({...form, horasCobrada: Number(v)})} />
            <InputGroup label="Monto Cobrado ($)" type="number" value={form.precioCobrado} color="text-emerald-400" onChange={(v: number) => setForm({...form, precioCobrado: Number(v)})} />
          </div>

          {/* DASHBOARD DE RESULTADOS */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatBox label="Horas TAC" value={stats.horasTac.toFixed(2)} />
            <StatBox label="Costo Capitán" value={`-$${stats.pagoCapitan}`} color="text-red-400/80" />
            <StatBox label="Combustible" value={`-$${stats.pagoGasolina.toFixed(1)}`} color="text-red-400/80" />
            <StatBox label="Costo Op." value={`-$${stats.costoOperacional}`} color="text-[#E1AD01]" />
            <div className="bg-[#E1AD01] p-5 rounded-2xl flex flex-col justify-center items-center shadow-[0_10px_30px_rgba(225,173,1,0.3)] transition-transform hover:scale-105">
              <span className="text-[9px] text-black font-black uppercase tracking-tighter">Net Profit</span>
              <span className="text-2xl font-mono text-black font-black">${stats.produccionNeta.toFixed(2)}</span>
            </div>
          </div>

          {/* ACCIÓN DE SINCRONIZACIÓN */}
          <button 
            onClick={handleProcessFlight}
            disabled={isProcessing}
            className="w-full bg-white text-black font-black py-6 rounded-3xl uppercase text-[11px] tracking-[0.6em] flex items-center justify-center gap-4 hover:bg-[#E1AD01] transition-all duration-500 shadow-2xl active:scale-[0.97] disabled:opacity-30 group"
          >
            {isProcessing ? (
              <Loader2 className="animate-spin h-5 w-5" />
            ) : (
              <ShieldCheck className="h-5 w-5 group-hover:scale-125 transition-transform" />
            )}
            {isProcessing ? "Validando Operación..." : "Sincronizar Vuelo"}
          </button>
        </div>
      </div>
    </div>
  );
};

// COMPONENTES ATÓMICOS
const InputGroup = ({ label, value, onChange, type = "text", color = "text-white" }: any) => (
  <div className="flex flex-col space-y-2 group w-full">
    <label className="text-[10px] text-[#E1AD01] font-black uppercase tracking-widest ml-1 transition-transform group-focus-within:translate-x-1">{label}</label>
    <input 
      type={type} 
      step="0.01"
      className={`bg-white/5 border border-white/10 p-4 rounded-2xl ${color} text-sm font-bold outline-none focus:border-[#E1AD01]/50 focus:bg-white/10 transition-all uppercase w-full backdrop-blur-md`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

const EvidenceUpload = ({ label, file, onSelect }: { label: string, file: File | null, onSelect: (f: File) => void }) => (
  <div className="relative overflow-hidden rounded-2xl border border-dashed border-white/20 hover:border-[#E1AD01]/50 transition-colors bg-black/20 group">
    <input 
      type="file" 
      accept="image/*" 
      capture="environment"
      className="absolute inset-0 opacity-0 cursor-pointer z-10"
      onChange={(e) => e.target.files && onSelect(e.target.files[0])}
    />
    <div className="p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {file ? <FileCheck className="text-emerald-400 h-5 w-5" /> : <Camera className="text-white/40 h-5 w-5" />}
        <span className={`text-[10px] font-black uppercase tracking-wider ${file ? 'text-emerald-400' : 'text-white/60'}`}>
          {file ? "EVIDENCIA LISTA" : label}
        </span>
      </div>
      {file && <span className="text-[8px] bg-emerald-400 text-black px-2 py-1 rounded font-black">READY</span>}
    </div>
  </div>
);

const StatBox = ({ label, value, color = "text-white" }: any) => (
  <div className="bg-white/[0.02] p-4 rounded-2xl border border-white/5 flex flex-col justify-center items-start backdrop-blur-sm">
    <p className="text-[8px] text-white/30 uppercase font-black mb-1 tracking-widest">{label}</p>
    <p className={`text-sm font-mono font-bold ${color}`}>{value}</p>
  </div>
);

export default FlightRegister;
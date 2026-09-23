// src/components/CaptainDashboard.tsx
// NÚCLEO DE OPERACIONES: HUD PERSONAL DE CAPITANES Y PILOTOS v2.0
// Evolución: Conexión Real-Time a Supabase y Telemetría Financiera
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0:
//   [NEW] "Próximas misiones asignadas": vuelos CONFIRMADOS por Planificación
//         (reservas_slot_vuelo, instructor_id = instructores.id del capitán)
//   [NEW] KPI "Misiones próximas" + marca de reprogramado + nota de Planificación
//   [FIX] Realtime filtrado por capitan_id (antes recargaba con cambios de
//         CUALQUIER capitán → consultas innecesarias y parpadeo)
//   [FIX] Recarga silenciosa en eventos realtime (sin loader de pantalla completa)
//   [FIX] Limpieza segura del canal si el componente se desmonta antes de auth
//   PRESERVADO: logbook bitacora_vuelos, KPIs horas/liquidación/alumnos, tabla
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardContent } from './ui/card';
import {
  Plane, Clock, Users, DollarSign, Award,
  CheckCircle2, AlertCircle, FileText, Loader2,
  CalendarDays, Repeat
} from 'lucide-react';

// [NEW v2.0] Misión asignada por Planificación
interface MisionAsignada {
  id: string;
  fecha: string;
  slot_hora: string;
  aeronave_matricula: string | null;
  tipo_vuelo: string | null;
  horas_planificadas: number;
  alumno: string;
  reprogramada: boolean;
  motivo_planificacion: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // fecha LOCAL
const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const fmtFecha = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return `${DAYS_ES[dt.getDay()]} ${pad(d)}/${pad(m)}`;
};

export const CaptainDashboard = ({ userProfile }: { userProfile: any }) => {
  const [logbook, setLogbook] = useState<any[]>([]);
  const [misiones, setMisiones] = useState<MisionAsignada[]>([]);   // [NEW v2.0]
  const [isLoading, setIsLoading] = useState(true);

  // --- MOTOR DE SINCRONIZACIÓN TÁCTICA ---
  const fetchCaptainLogbook = useCallback(async (capitanId: string, silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      // Extraemos exclusivamente los vuelos de este Capitán
      const { data, error } = await supabase
        .from('bitacora_vuelos')
        .select('*')
        .eq('capitan_id', capitanId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Mapeo resiliente (Grado Militar) para evitar fallos si faltan datos antiguos
        const formattedData = data.map((flight: any) => ({
          id: flight.id,
          date: flight.fecha || flight.created_at?.split('T')[0] || 'Desconocida',
          student: flight.alumno || 'Por Asignar',
          aircraft: flight.aeronave_matricula || 'N/A',
          type: flight.tipo_mision || 'Instrucción',
          hobbs: Number(flight.horas_hobbs || 0),
          status: flight.estatus_pago || 'PENDING',
          amount: Number(flight.monto_pago || 0)
        }));
        setLogbook(formattedData);
      }
    } catch (error) {
      console.error("Falla en Radar de Capitán:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // [NEW v2.0] Misiones confirmadas por Planificación. Devuelve instructor.id para realtime.
  const fetchMisiones = useCallback(async (userId: string): Promise<string | null> => {
    try {
      const { data: inst, error: instError } = await supabase
        .from('instructores')
        .select('id')
        .eq('perfil_id', userId)
        .maybeSingle();
      if (instError || !inst?.id) { setMisiones([]); return null; }

      const { data: rsv, error: rsvError } = await supabase
        .from('reservas_slot_vuelo')
        .select('id, student_id, fecha, slot_hora, aeronave_matricula, tipo_vuelo, horas_planificadas, reprogramada, motivo_planificacion')
        .eq('instructor_id', inst.id)
        .eq('status', 'CONFIRMADA')
        .gte('fecha', toYMD(new Date()))
        .order('fecha', { ascending: true })
        .order('slot_hora', { ascending: true })
        .limit(10);
      if (rsvError) throw rsvError;

      const ids = Array.from(new Set((rsv ?? []).map((r: any) => r.student_id).filter(Boolean)));
      const nombres: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: est } = await supabase
          .from('perfiles_estudiantes')
          .select('id, nombre_completo')
          .in('id', ids);
        (est ?? []).forEach((e: any) => { nombres[e.id] = e.nombre_completo; });
      }

      setMisiones((rsv ?? []).map((r: any) => ({
        id: r.id,
        fecha: r.fecha,
        slot_hora: String(r.slot_hora ?? '').slice(0, 5),
        aeronave_matricula: r.aeronave_matricula ?? null,
        tipo_vuelo: r.tipo_vuelo ?? null,
        horas_planificadas: Number(r.horas_planificadas || 0),
        alumno: nombres[r.student_id] ?? `ALUMNO ${String(r.student_id).slice(0, 8)}`,
        reprogramada: !!r.reprogramada,
        motivo_planificacion: r.motivo_planificacion ?? null,
      })));
      return String(inst.id);
    } catch (error) {
      console.error("Falla cargando misiones asignadas:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) { setIsLoading(false); return; }

      await fetchCaptainLogbook(user.id);
      const instructorId = await fetchMisiones(user.id);
      if (cancelled) return;

      // Sincronización en tiempo real si el admin le aprueba un pago
      // [FIX v2.0] filtrado por este capitán
      channel = supabase
        .channel(`captain-hud-${user.id}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'bitacora_vuelos', filter: `capitan_id=eq.${user.id}` },
          () => fetchCaptainLogbook(user.id, true));

      // [NEW v2.0] misiones confirmadas/reprogramadas por Planificación
      if (instructorId) {
        channel = channel.on('postgres_changes',
          { event: '*', schema: 'public', table: 'reservas_slot_vuelo', filter: `instructor_id=eq.${instructorId}` },
          () => fetchMisiones(user.id));
      }

      channel.subscribe();
    };

    init();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [fetchCaptainLogbook, fetchMisiones]);

  // --- CÁLCULOS DE INTELIGENCIA DEL PILOTO ---
  const totalHours = logbook.reduce((acc, flight) => acc + flight.hobbs, 0);
  const pendingPay = logbook.filter(f => f.status === 'PENDING').reduce((acc, flight) => acc + flight.amount, 0);
  const uniqueStudents = new Set(logbook.map(f => f.student).filter(s => s !== 'Por Asignar')).size;
  const misionesHoy = misiones.filter(m => m.fecha === toYMD(new Date())).length;   // [NEW v2.0]

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-700 text-left font-sans relative">

      {/* HUD HEADER: IDENTIFICACIÓN DEL CAPITÁN */}
      <div className="bg-[#0a0a0a] border border-blue-500/20 p-8 rounded-[2rem] shadow-2xl relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none"></div>

        <div className="flex items-center gap-6 relative z-10">
          <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20">
            <Award className="h-10 w-10 text-blue-500" />
          </div>
          <div>
            <h2 className="text-white font-black text-2xl tracking-tighter uppercase italic">
              Capitán {userProfile?.nombre_completo || 'Operador'}
            </h2>
            <p className="text-blue-400 text-[10px] font-mono tracking-[0.4em] mt-1 uppercase">
              Licencia Activa — Sede: {userProfile?.sede || 'Global'}
            </p>
          </div>
        </div>

        <button className="relative z-10 bg-white/5 border border-white/10 hover:bg-blue-500 hover:text-black text-white px-6 py-3 rounded-xl transition-all font-black text-[9px] uppercase tracking-widest flex items-center gap-2">
          <FileText className="h-4 w-4" /> Exportar Logbook (PDF)
        </button>
      </div>

      {/* MÉTRICAS DE VUELO (KPIs) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[1.618rem]">
        <Card className="bg-[#0f0f0f] border-l-4 border-l-blue-500 border-white/5 shadow-2xl">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Horas de Instrucción</p>
                <h3 className="text-3xl font-black text-white font-mono">{totalHours.toFixed(1)}H</h3>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                <Clock className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f] border-l-4 border-l-emerald-500 border-white/5 shadow-2xl">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Liquidación Pendiente</p>
                <h3 className="text-3xl font-black text-emerald-500 font-mono">${pendingPay.toFixed(2)}</h3>
              </div>
              <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <DollarSign className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0f0f0f] border-l-4 border-l-[#E1AD01] border-white/5 shadow-2xl">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Alumnos Entrenados</p>
                <h3 className="text-3xl font-black text-white font-mono">{uniqueStudents}</h3>
              </div>
              <div className="p-3 bg-[#E1AD01]/10 rounded-xl border border-[#E1AD01]/20">
                <Users className="h-6 w-6 text-[#E1AD01]" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* [NEW v2.0] */}
        <Card className="bg-[#0f0f0f] border-l-4 border-l-purple-500 border-white/5 shadow-2xl">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-1">Misiones Próximas</p>
                <h3 className="text-3xl font-black text-white font-mono">{misiones.length}</h3>
                <p className="text-[9px] text-purple-400 font-black uppercase mt-1">{misionesHoy} hoy</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/20">
                <CalendarDays className="h-6 w-6 text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* [NEW v2.0] PRÓXIMAS MISIONES ASIGNADAS POR PLANIFICACIÓN */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-8 relative overflow-hidden shadow-2xl">
        <h3 className="text-white font-black text-[11px] uppercase tracking-[0.4em] mb-6 flex items-center gap-3 italic">
          <CalendarDays className="h-4 w-4 text-purple-400" /> Próximas Misiones Asignadas
        </h3>
        {misiones.length === 0 ? (
          <p className="py-6 text-center text-zinc-500 font-black uppercase tracking-widest text-[10px]">
            Planificación no le ha asignado vuelos próximos
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {misiones.map(m => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-purple-500/30 transition-colors">
                <div className="flex items-center justify-between">
                  <p className="text-white font-black text-xs font-mono uppercase">
                    {fmtFecha(m.fecha)} · <span className="text-[#E1AD01]">{m.slot_hora}</span>
                  </p>
                  {m.reprogramada && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[8px] font-black uppercase text-amber-400 bg-amber-500/10 border border-amber-500/20">
                      <Repeat className="h-3 w-3" /> Reprog.
                    </span>
                  )}
                </div>
                <p className="text-white font-bold uppercase text-[11px] mt-2">{m.alumno}</p>
                <p className="text-zinc-500 text-[10px] font-mono mt-1">
                  {m.aeronave_matricula ?? 'S/N'} · {m.tipo_vuelo ?? 'VUELO'} · {m.horas_planificadas.toFixed(1)}h
                </p>
                {m.motivo_planificacion && (
                  <p className="text-amber-400/80 text-[9px] uppercase mt-2">{m.motivo_planificacion}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BITÁCORA DIGITAL (LOGBOOK) */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-8 relative overflow-hidden shadow-2xl">
        <h3 className="text-white font-black text-[11px] uppercase tracking-[0.4em] mb-8 flex items-center gap-3 italic">
          <Plane className="h-4 w-4 text-blue-500" /> Registro de Misiones (Logbook)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[9px] text-zinc-500 font-black uppercase tracking-widest">
                <th className="pb-4 font-black">Fecha</th>
                <th className="pb-4 font-black">Alumno</th>
                <th className="pb-4 font-black">Aeronave</th>
                <th className="pb-4 font-black">Misión</th>
                <th className="pb-4 font-black text-center">Hobbs</th>
                <th className="pb-4 font-black text-right">Estatus Pago</th>
              </tr>
            </thead>
            <tbody className="text-xs font-mono">
              {logbook.length > 0 ? logbook.map((flight) => (
                <tr key={flight.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                  <td className="py-4 text-white/70">{flight.date}</td>
                  <td className="py-4 text-white font-bold font-sans uppercase">{flight.student}</td>
                  <td className="py-4 text-[#E1AD01]">{flight.aircraft}</td>
                  <td className="py-4 text-zinc-400 font-sans">{flight.type}</td>
                  <td className="py-4 text-center text-white">{flight.hobbs.toFixed(1)}</td>
                  <td className="py-4 text-right">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest ${
                      flight.status === 'PAID' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                    }`}>
                      {flight.status === 'PAID' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {flight.status === 'PAID' ? 'Pagado' : 'Pendiente'}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-zinc-500 font-black uppercase tracking-widest text-[10px]">
                    No hay registros de misiones para este operador
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
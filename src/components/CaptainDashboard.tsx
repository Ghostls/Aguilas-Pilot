// src/components/CaptainDashboard.tsx
// NÚCLEO DE OPERACIONES: HUD PERSONAL DE CAPITANES Y PILOTOS
// Evolución: Conexión Real-Time a Supabase y Telemetría Financiera
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Card, CardContent } from './ui/card';
import { 
  Plane, Clock, Users, DollarSign, Award, 
  CheckCircle2, AlertCircle, FileText, Loader2 
} from 'lucide-react';

export const CaptainDashboard = ({ userProfile }: { userProfile: any }) => {
  const [logbook, setLogbook] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- MOTOR DE SINCRONIZACIÓN TÁCTICA ---
  useEffect(() => {
    const fetchCaptainLogbook = async () => {
      setIsLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Extraemos exclusivamente los vuelos de este Capitán
          const { data, error } = await supabase
            .from('bitacora_vuelos')
            .select('*')
            .eq('capitan_id', user.id)
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
        }
      } catch (error) {
        console.error("Falla en Radar de Capitán:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCaptainLogbook();

    // Sincronización en tiempo real si el admin le aprueba un pago
    const channel = supabase
      .channel('captain-log-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bitacora_vuelos' }, fetchCaptainLogbook)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // --- CÁLCULOS DE INTELIGENCIA DEL PILOTO ---
  const totalHours = logbook.reduce((acc, flight) => acc + flight.hobbs, 0);
  const pendingPay = logbook.filter(f => f.status === 'PENDING').reduce((acc, flight) => acc + flight.amount, 0);
  const uniqueStudents = new Set(logbook.map(f => f.student).filter(s => s !== 'Por Asignar')).size;

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[1.618rem]">
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
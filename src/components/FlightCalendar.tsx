// src/components/FlightCalendar.tsx
// VALKYRON OS v1.0 — Sistema de Calendario de Vuelo
// ESTUDIANTE: vista semanal, reserva bloques disponibles
// ADMIN/CEO/INSTRUCTOR: crea bloques, ve todas las reservas
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  ChevronLeft, ChevronRight, Plus, X, Plane, User,
  Clock, CheckCircle2, XCircle, Loader2, CalendarDays,
  ShieldCheck, AlertTriangle, Trash2, BookOpen
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface BloqueVuelo {
  id:                 string;
  fecha:              string;       // YYYY-MM-DD
  hora_inicio:        string;       // HH:MM
  hora_fin:           string;
  aeronave_id:        string | null;
  matricula:          string;
  instructor_nombre:  string;
  tipo_vuelo:         'SOLO' | 'DUAL' | 'AMBOS';
  sede:               string;
  notas:              string | null;
  created_at:         string;
  // join
  reserva?:           ReservaVuelo | null;
  total_reservas?:    number;
}

interface ReservaVuelo {
  id:                 string;
  bloque_id:          string;
  estudiante_id:      string;
  estudiante_nombre:  string;
  tipo_vuelo:         'SOLO' | 'DUAL';
  status:             'CONFIRMADA' | 'CANCELADA' | 'COMPLETADA';
  notas_estudiante:   string | null;
  created_at:         string;
}

interface AeronaveOption {
  id:       string;
  matricula: string;
  modelo:   string;
}

interface FlightCalendarProps {
  userRole?:    string;
  userProfile?: { nombre_completo: string; sede: string; rol: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date: Date, n: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const toYMD = (date: Date): string =>
  date.toISOString().split('T')[0];

const formatHour = (t: string) => t.slice(0, 5);

const tipoColor = (tipo: string) => ({
  SOLO:  'text-blue-400  border-blue-400/30  bg-blue-400/10',
  DUAL:  'text-purple-400 border-purple-400/30 bg-purple-400/10',
  AMBOS: 'text-[#E1AD01] border-[#E1AD01]/30  bg-[#E1AD01]/10',
}[tipo] ?? 'text-slate-400 border-white/10 bg-white/5');

const statusColor = (status: string) => ({
  CONFIRMADA:  'text-green-400  bg-green-400/10  border-green-400/20',
  CANCELADA:   'text-red-400    bg-red-400/10    border-red-400/20',
  COMPLETADA:  'text-slate-400  bg-white/5       border-white/10',
}[status] ?? '');

// ══════════════════════════════════════════════════════════════════════════════
export const FlightCalendar: React.FC<FlightCalendarProps> = ({
  userRole = 'MECANICO',
  userProfile,
}) => {
  const rol          = userRole.toUpperCase().trim();
  const isAdmin      = ['CEO', 'ADMIN', 'INSTRUCTOR', 'CAPITAN'].includes(rol);
  const isEstudiante = !isAdmin;

  // ── Semana actual ──────────────────────────────────────────────────────────
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // ── Data ───────────────────────────────────────────────────────────────────
  const [bloques,    setBloques]    = useState<BloqueVuelo[]>([]);
  const [misReservas, setMisReservas] = useState<ReservaVuelo[]>([]);
  const [flota,      setFlota]      = useState<AeronaveOption[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [userId,     setUserId]     = useState<string | null>(null);

  // ── Modales ────────────────────────────────────────────────────────────────
  const [selectedBloque,  setSelectedBloque]  = useState<BloqueVuelo | null>(null);
  const [isReservaOpen,   setIsReservaOpen]   = useState(false);
  const [isCrearOpen,     setIsCrearOpen]     = useState(false);
  const [isReservasOpen,  setIsReservasOpen]  = useState(false); // admin: ver reservas de un bloque
  const [adminBloqueId,   setAdminBloqueId]   = useState<string | null>(null);
  const [adminReservas,   setAdminReservas]   = useState<ReservaVuelo[]>([]);

  // ── Form crear bloque ──────────────────────────────────────────────────────
  const [crearForm, setCrearForm] = useState({
    fecha:             toYMD(new Date()),
    hora_inicio:       '07:00',
    hora_fin:          '09:00',
    aeronave_id:       '',
    instructor_nombre: userProfile?.nombre_completo || '',
    tipo_vuelo:        'AMBOS' as 'SOLO' | 'DUAL' | 'AMBOS',
    sede:              userProfile?.sede || 'Lara',
    notas:             '',
  });

  // ── Form reserva estudiante ────────────────────────────────────────────────
  const [reservaForm, setReservaForm] = useState({
    tipo_vuelo:       'DUAL' as 'SOLO' | 'DUAL',
    notas_estudiante: '',
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [error,         setError]         = useState('');

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
    };
    init();

    supabase.from('flota_aviones')
      .select('id,matricula,modelo')
      .order('matricula')
      .then(({ data }) => setFlota(data ?? []));
  }, []);

  // ── Fetch bloques de la semana ─────────────────────────────────────────────
  const fetchBloques = useCallback(async () => {
    setLoading(true);
    const desde = toYMD(weekDays[0]);
    const hasta = toYMD(weekDays[6]);

    const { data: bloquesData } = await supabase
      .from('bloques_vuelo')
      .select('*')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('hora_inicio');

    if (!bloquesData) { setLoading(false); return; }

    // Cargar mis reservas (estudiante) o todas (admin)
    if (isEstudiante && userId) {
      const { data: reservasData } = await supabase
        .from('reservas_vuelo')
        .select('*')
        .eq('estudiante_id', userId)
        .in('bloque_id', bloquesData.map(b => b.id));

      const reservasMap = new Map(
        (reservasData ?? []).map(r => [r.bloque_id, r])
      );

      setBloques(bloquesData.map(b => ({
        ...b,
        reserva: reservasMap.get(b.id) ?? null,
      })));
      setMisReservas(reservasData ?? []);
    } else {
      // Admin: cargar conteo de reservas por bloque
      const { data: reservasData } = await supabase
        .from('reservas_vuelo')
        .select('bloque_id')
        .in('bloque_id', bloquesData.map(b => b.id))
        .eq('status', 'CONFIRMADA');

      const conteo = new Map<string, number>();
      (reservasData ?? []).forEach(r => {
        conteo.set(r.bloque_id, (conteo.get(r.bloque_id) ?? 0) + 1);
      });

      setBloques(bloquesData.map(b => ({
        ...b,
        total_reservas: conteo.get(b.id) ?? 0,
      })));
    }
    setLoading(false);
  }, [weekDays, userId, isEstudiante]);

  useEffect(() => {
    if (userId !== null) fetchBloques();
  }, [fetchBloques, userId]);

  // ── Agrupar bloques por día ────────────────────────────────────────────────
  const bloquesPorDia = useMemo(() => {
    const map = new Map<string, BloqueVuelo[]>();
    weekDays.forEach(d => map.set(toYMD(d), []));
    bloques.forEach(b => {
      const list = map.get(b.fecha) ?? [];
      list.push(b);
      map.set(b.fecha, list);
    });
    return map;
  }, [bloques, weekDays]);

  // ── Reservar bloque (estudiante) ───────────────────────────────────────────
  const handleReservar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBloque || !userId) return;
    setActionLoading(true);
    setError('');

    // Verificar que el tipo de vuelo es compatible
    const bloque = selectedBloque;
    if (bloque.tipo_vuelo !== 'AMBOS' && bloque.tipo_vuelo !== reservaForm.tipo_vuelo) {
      setError(`Este bloque solo permite vuelo ${bloque.tipo_vuelo}.`);
      setActionLoading(false);
      return;
    }

    const { error: insertErr } = await supabase
      .from('reservas_vuelo')
      .insert([{
        bloque_id:         bloque.id,
        estudiante_id:     userId,
        estudiante_nombre: userProfile?.nombre_completo?.toUpperCase() || 'ESTUDIANTE',
        tipo_vuelo:        reservaForm.tipo_vuelo,
        notas_estudiante:  reservaForm.notas_estudiante || null,
        status:            'CONFIRMADA',
      }]);

    if (insertErr) {
      setError(insertErr.message);
    } else {
      setIsReservaOpen(false);
      setSelectedBloque(null);
      await fetchBloques();
    }
    setActionLoading(false);
  };

  // ── Cancelar reserva (estudiante) ──────────────────────────────────────────
  const handleCancelar = async (reservaId: string) => {
    setActionLoading(true);
    await supabase
      .from('reservas_vuelo')
      .update({ status: 'CANCELADA' })
      .eq('id', reservaId);
    await fetchBloques();
    setIsReservaOpen(false);
    setActionLoading(false);
  };

  // ── Crear bloque (admin) ───────────────────────────────────────────────────
  const handleCrearBloque = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setError('');

    const aeronave = flota.find(a => a.id === crearForm.aeronave_id);
    const { error: insertErr } = await supabase
      .from('bloques_vuelo')
      .insert([{
        fecha:             crearForm.fecha,
        hora_inicio:       crearForm.hora_inicio,
        hora_fin:          crearForm.hora_fin,
        aeronave_id:       crearForm.aeronave_id || null,
        matricula:         aeronave?.matricula || 'S/N',
        instructor_nombre: crearForm.instructor_nombre.toUpperCase(),
        tipo_vuelo:        crearForm.tipo_vuelo,
        sede:              crearForm.sede,
        notas:             crearForm.notas || null,
      }]);

    if (insertErr) {
      setError(insertErr.message);
    } else {
      setIsCrearOpen(false);
      setCrearForm(prev => ({ ...prev, notas: '' }));
      await fetchBloques();
    }
    setActionLoading(false);
  };

  // ── Eliminar bloque (admin) ────────────────────────────────────────────────
  const handleEliminarBloque = async (bloqueId: string) => {
    if (!confirm('¿Eliminar este bloque y todas sus reservas?')) return;
    setActionLoading(true);
    await supabase.from('bloques_vuelo').delete().eq('id', bloqueId);
    await fetchBloques();
    setActionLoading(false);
  };

  // ── Ver reservas de un bloque (admin) ─────────────────────────────────────
  const handleVerReservas = async (bloqueId: string) => {
    setAdminBloqueId(bloqueId);
    const { data } = await supabase
      .from('reservas_vuelo')
      .select('*')
      .eq('bloque_id', bloqueId)
      .order('created_at');
    setAdminReservas(data ?? []);
    setIsReservasOpen(true);
  };

  // ── Card de bloque ─────────────────────────────────────────────────────────
  const BloqueCard = ({ bloque }: { bloque: BloqueVuelo }) => {
    const miReserva    = bloque.reserva;
    const yaReservado  = miReserva?.status === 'CONFIRMADA';
    const cancelada    = miReserva?.status === 'CANCELADA';
    const hoy          = toYMD(new Date());
    const esPasado     = bloque.fecha < hoy;

    return (
      <div
        onClick={() => {
          if (isEstudiante && !esPasado) {
            setSelectedBloque(bloque);
            setReservaForm({ tipo_vuelo: 'DUAL', notas_estudiante: '' });
            setError('');
            setIsReservaOpen(true);
          }
        }}
        className={`
          rounded-2xl border p-3 transition-all text-left w-full
          ${esPasado ? 'opacity-40 cursor-not-allowed' : ''}
          ${isEstudiante && !esPasado ? 'cursor-pointer hover:scale-[1.02]' : ''}
          ${yaReservado
            ? 'bg-green-500/10 border-green-500/30'
            : cancelada
            ? 'bg-white/[0.02] border-white/5 opacity-50'
            : 'bg-[#0a0a0a] border-white/10 hover:border-[#E1AD01]/30'}
        `}
      >
        {/* Hora */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[#E1AD01] font-black font-mono text-[10px]">
            {formatHour(bloque.hora_inicio)} – {formatHour(bloque.hora_fin)}
          </span>
          {yaReservado && <CheckCircle2 size={12} className="text-green-400" />}
          {cancelada    && <XCircle     size={12} className="text-slate-600"  />}
        </div>

        {/* Aeronave */}
        <div className="flex items-center gap-1.5 mb-1">
          <Plane size={9} className="text-slate-500 shrink-0" />
          <span className="text-white font-black text-[9px] uppercase">{bloque.matricula}</span>
        </div>

        {/* Instructor */}
        <div className="flex items-center gap-1.5 mb-2">
          <User size={9} className="text-slate-500 shrink-0" />
          <span className="text-slate-400 text-[8px] uppercase truncate">{bloque.instructor_nombre}</span>
        </div>

        {/* Tipo vuelo */}
        <span className={`inline-block px-2 py-0.5 rounded-lg border text-[7px] font-black uppercase ${tipoColor(bloque.tipo_vuelo)}`}>
          {bloque.tipo_vuelo}
        </span>

        {/* Admin: conteo + acciones */}
        {isAdmin && (
          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between">
            <span className="text-[8px] text-slate-600 font-mono">
              {bloque.total_reservas ?? 0} reserva{(bloque.total_reservas ?? 0) !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={e => { e.stopPropagation(); handleVerReservas(bloque.id); }}
                className="p-1 rounded-lg text-slate-600 hover:text-[#E1AD01] hover:bg-[#E1AD01]/10 transition-all"
                title="Ver reservas"
              >
                <BookOpen size={10} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); handleEliminarBloque(bloque.id); }}
                className="p-1 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Eliminar bloque"
              >
                <Trash2 size={10} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4
                      bg-[#0f0f0f] p-5 rounded-2xl border border-white/10">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-5 w-5 text-[#E1AD01]" />
          <div>
            <p className="text-white font-black text-xs uppercase tracking-widest">
              Calendario de Vuelo
            </p>
            <p className="text-[9px] text-slate-500 font-mono mt-0.5">
              {isEstudiante ? 'Selecciona un bloque para reservar' : 'Gestión de bloques disponibles'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Navegación semanal */}
          <div className="flex items-center gap-2 bg-black/60 rounded-xl border border-white/10 p-1">
            <button
              onClick={() => setWeekStart(prev => addDays(prev, -7))}
              className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[9px] font-black text-white uppercase tracking-widest px-2 min-w-[140px] text-center">
              {DAYS_ES[weekDays[0].getDay()]} {weekDays[0].getDate()} –{' '}
              {DAYS_ES[weekDays[6].getDay()]} {weekDays[6].getDate()}{' '}
              {MONTHS_ES[weekDays[0].getMonth()]}
            </span>
            <button
              onClick={() => setWeekStart(prev => addDays(prev, 7))}
              className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-4 py-2 rounded-xl border border-white/10 text-slate-500
                       hover:text-white hover:border-white/20 text-[9px] font-black uppercase transition-all"
          >
            Hoy
          </button>

          {isAdmin && (
            <button
              onClick={() => { setError(''); setIsCrearOpen(true); }}
              className="bg-[#E1AD01] text-black px-5 py-2.5 rounded-xl font-black text-[9px]
                         uppercase tracking-widest hover:bg-white transition-all flex items-center gap-2"
            >
              <Plus size={14} /> Nuevo Bloque
            </button>
          )}
        </div>
      </div>

      {/* ── Leyenda (estudiante) ── */}
      {isEstudiante && (
        <div className="flex flex-wrap items-center gap-4 px-1">
          {[
            { color: 'bg-[#0a0a0a] border-white/10',       label: 'Disponible' },
            { color: 'bg-green-500/10 border-green-500/30', label: 'Reservado por ti' },
            { color: 'bg-blue-400/10  border-blue-400/30',  label: 'Solo' },
            { color: 'bg-purple-400/10 border-purple-400/30',label: 'Dual' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded border ${color}`} />
              <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Grid semanal ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#E1AD01]" />
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const ymd    = toYMD(day);
            const bloques = bloquesPorDia.get(ymd) ?? [];
            const isHoy   = ymd === toYMD(new Date());

            return (
              <div key={ymd} className="flex flex-col gap-2 min-w-0">
                {/* Header día */}
                <div className={`rounded-xl p-2 text-center border transition-all ${
                  isHoy
                    ? 'bg-[#E1AD01]/10 border-[#E1AD01]/30'
                    : 'bg-white/[0.02] border-white/5'
                }`}>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${isHoy ? 'text-[#E1AD01]' : 'text-slate-500'}`}>
                    {DAYS_ES[day.getDay()]}
                  </p>
                  <p className={`text-lg font-black font-mono leading-none mt-0.5 ${isHoy ? 'text-[#E1AD01]' : 'text-white'}`}>
                    {day.getDate()}
                  </p>
                </div>

                {/* Bloques del día */}
                <div className="flex flex-col gap-1.5">
                  {bloques.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/[0.06] p-3 text-center">
                      <span className="text-[7px] text-slate-700 font-black uppercase">Sin bloques</span>
                    </div>
                  ) : (
                    bloques.map(b => <BloqueCard key={b.id} bloque={b} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Mis reservas (estudiante) — lista compacta ── */}
      {isEstudiante && misReservas.filter(r => r.status === 'CONFIRMADA').length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/5 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">
              Mis Reservas Activas
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {misReservas
              .filter(r => r.status === 'CONFIRMADA')
              .map(r => {
                const bloque = bloques.find(b => b.id === r.bloque_id);
                return bloque ? (
                  <div key={r.id} className="p-4 flex items-center justify-between font-mono">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
                        <Plane size={14} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-white font-black text-[10px] uppercase">
                          {bloque.fecha} · {formatHour(bloque.hora_inicio)}–{formatHour(bloque.hora_fin)}
                        </p>
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          {bloque.matricula} · {bloque.instructor_nombre} · {r.tipo_vuelo}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelar(r.id)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded-xl border border-red-500/20 text-red-400
                                 text-[8px] font-black uppercase hover:bg-red-500/10 transition-all
                                 disabled:opacity-40 flex items-center gap-1"
                    >
                      <XCircle size={10} /> Cancelar
                    </button>
                  </div>
                ) : null;
              })
            }
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          MODAL — RESERVAR BLOQUE (ESTUDIANTE)
      ══════════════════════════════════════════════════════ */}
      {isReservaOpen && selectedBloque && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">

            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic">
                <Plane size={14} />
                {selectedBloque.reserva?.status === 'CONFIRMADA' ? 'Tu Reserva' : 'Reservar Bloque'}
              </div>
              <button onClick={() => setIsReservaOpen(false)} className="hover:rotate-90 transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="p-8 space-y-5 font-mono">
              {/* Info del bloque */}
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[#E1AD01] font-black font-mono text-sm">
                    {formatHour(selectedBloque.hora_inicio)} – {formatHour(selectedBloque.hora_fin)}
                  </span>
                  <span className={`px-2 py-0.5 rounded-lg border text-[8px] font-black uppercase ${tipoColor(selectedBloque.tipo_vuelo)}`}>
                    {selectedBloque.tipo_vuelo}
                  </span>
                </div>
                <p className="text-[9px] text-slate-500 uppercase">
                  {selectedBloque.fecha}
                </p>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
                  <div>
                    <p className="text-[7px] text-slate-600 uppercase font-black mb-1">Aeronave</p>
                    <p className="text-white font-black text-[10px]">{selectedBloque.matricula}</p>
                  </div>
                  <div>
                    <p className="text-[7px] text-slate-600 uppercase font-black mb-1">Instructor</p>
                    <p className="text-white font-black text-[10px] truncate">{selectedBloque.instructor_nombre}</p>
                  </div>
                </div>
                {selectedBloque.notas && (
                  <p className="text-[9px] text-slate-400 italic border-t border-white/5 pt-2">
                    {selectedBloque.notas}
                  </p>
                )}
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <AlertTriangle size={12} className="text-red-400 shrink-0" />
                  <p className="text-[9px] text-red-400 font-black uppercase">{error}</p>
                </div>
              )}

              {/* Si ya está reservado */}
              {selectedBloque.reserva?.status === 'CONFIRMADA' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                    <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                    <p className="text-[9px] text-green-400 font-black uppercase">Ya tienes este bloque reservado</p>
                  </div>
                  <button
                    onClick={() => handleCancelar(selectedBloque.reserva!.id)}
                    disabled={actionLoading}
                    className="w-full py-4 rounded-2xl border border-red-500/30 text-red-400
                               text-[10px] font-black uppercase hover:bg-red-500/10 transition-all
                               disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                    Cancelar Reserva
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReservar} className="space-y-4">
                  {/* Tipo de vuelo */}
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Tipo de Vuelo *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['DUAL', 'SOLO'] as const).map(tipo => {
                        const bloquePermite =
                          selectedBloque.tipo_vuelo === 'AMBOS' ||
                          selectedBloque.tipo_vuelo === tipo;
                        return (
                          <button key={tipo} type="button"
                            disabled={!bloquePermite}
                            onClick={() => setReservaForm(prev => ({ ...prev, tipo_vuelo: tipo }))}
                            className={`py-3 rounded-xl border text-[10px] font-black uppercase transition-all
                              disabled:opacity-30 disabled:cursor-not-allowed
                              ${reservaForm.tipo_vuelo === tipo
                                ? tipoColor(tipo) + ' shadow-lg'
                                : 'bg-white/[0.03] border-white/10 text-slate-500 hover:border-white/20'
                              }`}
                          >
                            {tipo}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Notas */}
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Notas (opcional)
                    </label>
                    <textarea rows={2}
                      className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                                 text-xs outline-none focus:border-[#E1AD01] transition-all resize-none
                                 placeholder:text-white/20"
                      placeholder="EJ: PRÁCTICA DE ATERRIZAJE..."
                      value={reservaForm.notas_estudiante}
                      onChange={e => setReservaForm(prev => ({ ...prev, notas_estudiante: e.target.value }))}
                    />
                  </div>

                  <button type="submit" disabled={actionLoading}
                    className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase
                               text-[10px] tracking-[0.4em] hover:bg-white transition-all
                               disabled:opacity-40 flex items-center justify-center gap-2">
                    {actionLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : <ShieldCheck size={14} />
                    }
                    Confirmar Reserva
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          MODAL — CREAR BLOQUE (ADMIN)
      ══════════════════════════════════════════════════════ */}
      {isCrearOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-[#E1AD01] p-5 flex justify-between items-center text-black font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic"><Plus size={14} /> Nuevo Bloque de Vuelo</div>
              <button onClick={() => setIsCrearOpen(false)} className="hover:rotate-90 transition-all"><X size={18} /></button>
            </div>

            <form onSubmit={handleCrearBloque} className="p-8 space-y-5 font-mono">
              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <AlertTriangle size={12} className="text-red-400 shrink-0" />
                  <p className="text-[9px] text-red-400 font-black uppercase">{error}</p>
                </div>
              )}

              {/* Fecha */}
              <div className="space-y-1.5">
                <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block">
                  Fecha *
                </label>
                <input type="date" required
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                             outline-none focus:border-[#E1AD01] transition-all"
                  value={crearForm.fecha}
                  onChange={e => setCrearForm(prev => ({ ...prev, fecha: e.target.value }))}
                />
              </div>

              {/* Horario */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Hora Inicio *
                  </label>
                  <input type="time" required
                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                               outline-none focus:border-[#E1AD01] transition-all"
                    value={crearForm.hora_inicio}
                    onChange={e => setCrearForm(prev => ({ ...prev, hora_inicio: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Hora Fin *
                  </label>
                  <input type="time" required
                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                               outline-none focus:border-[#E1AD01] transition-all"
                    value={crearForm.hora_fin}
                    onChange={e => setCrearForm(prev => ({ ...prev, hora_fin: e.target.value }))}
                  />
                </div>
              </div>

              {/* Aeronave + Instructor */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Aeronave *
                  </label>
                  <select required
                    className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white
                               text-[10px] outline-none focus:border-[#E1AD01] transition-all
                               [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                    value={crearForm.aeronave_id}
                    onChange={e => setCrearForm(prev => ({ ...prev, aeronave_id: e.target.value }))}
                  >
                    <option value="">— SELECCIONAR —</option>
                    {flota.map(a => (
                      <option key={a.id} value={a.id}>{a.matricula} · {a.modelo}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Instructor *
                  </label>
                  <input required
                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white
                               text-xs outline-none focus:border-[#E1AD01] uppercase transition-all"
                    placeholder="NOMBRE INSTRUCTOR"
                    value={crearForm.instructor_nombre}
                    onChange={e => setCrearForm(prev => ({ ...prev, instructor_nombre: e.target.value }))}
                  />
                </div>
              </div>

              {/* Tipo vuelo + Sede */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Tipo de Vuelo
                  </label>
                  <div className="flex gap-1 bg-black/60 rounded-xl p-1 border border-white/10">
                    {(['SOLO', 'DUAL', 'AMBOS'] as const).map(t => (
                      <button key={t} type="button"
                        onClick={() => setCrearForm(prev => ({ ...prev, tipo_vuelo: t }))}
                        className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all
                          ${crearForm.tipo_vuelo === t
                            ? 'bg-[#E1AD01] text-black'
                            : 'text-slate-600 hover:text-slate-400'}`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                    Sede
                  </label>
                  <div className="flex gap-1 bg-black/60 rounded-xl p-1 border border-white/10 h-[52px]">
                    {['Lara', 'Maturín'].map(s => (
                      <button key={s} type="button"
                        onClick={() => setCrearForm(prev => ({ ...prev, sede: s }))}
                        className={`flex-1 rounded-lg text-[9px] font-black uppercase transition-all
                          ${crearForm.sede === s
                            ? 'bg-[#E1AD01]/15 text-[#E1AD01] border border-[#E1AD01]/30'
                            : 'text-slate-600 hover:text-slate-400'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                  Notas (opcional)
                </label>
                <textarea rows={2}
                  className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
                             outline-none focus:border-[#E1AD01] transition-all resize-none
                             placeholder:text-white/20"
                  placeholder="EJ: ZONA DE PRÁCTICA NORTE..."
                  value={crearForm.notas}
                  onChange={e => setCrearForm(prev => ({ ...prev, notas: e.target.value }))}
                />
              </div>

              <button type="submit" disabled={actionLoading}
                className="w-full bg-[#E1AD01] text-black py-5 rounded-2xl font-black uppercase
                           text-[10px] tracking-[0.4em] hover:bg-white transition-all
                           disabled:opacity-40 flex items-center justify-center gap-2">
                {actionLoading
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ShieldCheck size={14} />
                }
                Publicar Bloque
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          MODAL — VER RESERVAS DEL BLOQUE (ADMIN)
      ══════════════════════════════════════════════════════ */}
      {isReservasOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
          <div className="bg-[#050505] border border-white/10 w-full max-w-md rounded-3xl overflow-hidden shadow-2xl">
            <div className="bg-white/10 border-b border-white/10 p-5 flex justify-between items-center font-black uppercase text-xs">
              <div className="flex items-center gap-2 italic text-[#E1AD01]">
                <BookOpen size={14} /> Reservas del Bloque
              </div>
              <button onClick={() => setIsReservasOpen(false)} className="text-white hover:rotate-90 transition-all">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3 font-mono max-h-[60vh] overflow-y-auto">
              {adminReservas.length === 0 ? (
                <p className="text-center text-slate-700 text-[10px] font-black uppercase tracking-widest py-8">
                  Sin reservas
                </p>
              ) : adminReservas.map(r => (
                <div key={r.id}
                  className="bg-[#0a0a0a] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-black text-[10px] uppercase">{r.estudiante_nombre}</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">
                      {r.tipo_vuelo} · {new Date(r.created_at).toLocaleDateString('es-VE')}
                    </p>
                    {r.notas_estudiante && (
                      <p className="text-[8px] text-slate-600 italic mt-1">{r.notas_estudiante}</p>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded-lg border text-[8px] font-black uppercase ${statusColor(r.status)}`}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlightCalendar;
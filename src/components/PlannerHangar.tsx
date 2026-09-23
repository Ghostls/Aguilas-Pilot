// src/components/PlannerHangar.tsx — consulta del hangar, SIN controles de mantenimiento.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Plane, RefreshCw, ShieldAlert } from 'lucide-react';

type HangarAircraft = {
  id: string;
  matricula: string;
  modelo: string | null;
  sede: string | null;
  estado: string | null;
  horas_vuelo_totales: number | null;
};
const normalize = (s: unknown) => String(s ?? '').trim().toLowerCase();
const openStates = ['in progress', 'pending parts', 'on hold'];

const PlannerHangar: React.FC = () => {
  const [fleet, setFleet] = useState<HangarAircraft[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [fleetRes, ordersRes] = await Promise.all([
        supabase.from('flota_aviones')
          .select('id,matricula,modelo,sede,estado,horas_vuelo_totales')
          .order('matricula', { ascending: true }),
        supabase.from('ordenes_trabajo').select('matricula,estado')
          .in('estado', ['In Progress', 'Pending Parts', 'On Hold']),
      ]);
      if (fleetRes.error) throw fleetRes.error;
      if (ordersRes.error) throw ordersRes.error;
      const blocked = new Set((ordersRes.data ?? [])
        .filter(o => openStates.includes(normalize(o.estado)))
        .map(o => normalize(o.matricula)));
      setFleet(((fleetRes.data ?? []) as HangarAircraft[]).filter(a =>
        normalize(a.estado) === 'operational' && !blocked.has(normalize(a.matricula))
      ));
      setUpdatedAt(new Date().toLocaleString('es-VE'));
    } catch (err) {
      setFleet([]); // ante falla, no declarar aeronaves disponibles
      setError(err instanceof Error ? err.message : 'No se pudo comprobar la disponibilidad.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-3">
          <Plane className="text-[#E1AD01]" />
          <div><h3 className="font-black uppercase tracking-wider">Hangar · Consulta para planificación</h3>
            <p className="text-xs text-slate-400">Solo aeronaves con estado operativo y sin órdenes MRO abiertas.</p></div>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-[#E1AD01] px-4 py-3 text-xs font-black uppercase text-black disabled:opacity-50">
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
        Este listado es orientativo. Una aeronave solo puede asignarse a un vuelo tras verificar
        documentación, mantenimiento, liberación autorizada y restricciones operacionales vigentes.
      </div>
      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 p-4 text-sm text-red-300"><ShieldAlert size={18}/>{error}</div>}
      {busy ? <p className="text-slate-400">Verificando disponibilidad...</p> : !error && fleet.length === 0 ?
        <p className="rounded-xl border border-white/10 p-8 text-center text-slate-400">No hay aeronaves verificadas como disponibles en este momento.</p> :
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fleet.map(ac => <article key={ac.id} className="rounded-2xl border border-emerald-600/25 bg-white/[0.03] p-5">
            <p className="mb-2 text-xs font-bold uppercase text-emerald-400">Candidata para planificación</p>
            <h4 className="text-2xl font-black tracking-tight">{ac.matricula}</h4>
            <p className="mt-1 text-sm text-slate-300">{ac.modelo || 'Modelo no registrado'}</p>
            <p className="mt-3 text-xs text-slate-400">Sede: {ac.sede || 'Sin sede'}</p>
            <p className="mt-1 text-xs text-slate-400">Horas: {ac.horas_vuelo_totales ?? 'No registradas'}</p>
          </article>)}
        </div>
      }
      {updatedAt && <p className="text-xs text-slate-500">Última consulta: {updatedAt}</p>}
    </section>
  );
};
export default PlannerHangar;

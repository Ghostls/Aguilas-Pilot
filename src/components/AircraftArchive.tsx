// src/components/AircraftArchive.tsx
// Águilas Pilot / Valkyron OS — Archivo histórico OMA
// Lectura de todas las aeronaves y sus OT; no altera estados ni certificaciones.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import {
  Archive, ArrowLeft, ChevronLeft, ChevronRight, Clock3, FileText,
  Loader2, Plane, Printer, RefreshCw, Search, ShieldAlert, Wrench,
} from 'lucide-react';

type Row = Record<string, unknown>;
type AircraftItem = {
  key: string;
  matricula: string;
  modelo: string;
  estado: string;
  sede: string;
  ordenes: Row[];
  ultimaActividad: number;
  enFlota: boolean;
};

interface AircraftArchiveProps {
  initialMatricula?: string;
  onBack?: () => void;
}

const PAGE_SIZE = 500;
const MAX_ROWS_PER_SOURCE = 100000; // Límite explícito, nunca mostrar archivo parcial.
const DISPLAY_SIZE = 12;
const txt = (value: unknown, fallback = 'No registrado'): string =>
  value === null || value === undefined || String(value).trim() === '' ? fallback : String(value);
const keyOf = (value: unknown): string => txt(value, '').trim().toUpperCase();
const when = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const time = Date.parse(txt(value, '')); 
  return Number.isFinite(time) ? time : 0;
};
const dateText = (value: unknown): string => {
  const time = when(value);
  return time ? new Date(time).toLocaleString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'No registrada';
};
const safe = (value: unknown): string => txt(value, '—')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function readAll(table: 'flota_aviones' | 'ordenes_trabajo'): Promise<Row[]> {
  const result: Row[] = [];
  for (let from = 0; from < MAX_ROWS_PER_SOURCE; from += PAGE_SIZE) {
    // Orden estable para no perder registros al paginar.
    const query = table === 'flota_aviones'
      ? supabase.from(table).select('*').order('id', { ascending: true })
      : supabase.from(table).select('*').order('created_at', { ascending: true }).order('id', { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as Row[];
    result.push(...batch);
    if (batch.length < PAGE_SIZE) return result;
  }
  throw new Error(`El archivo de ${table} supera ${MAX_ROWS_PER_SOURCE} filas. Se requiere consulta paginada en servidor; no se muestran resultados incompletos.`);
}

function makeItems(fleet: Row[], orders: Row[]): AircraftItem[] {
  const index = new Map<string, AircraftItem>();
  const ensure = (matricula: unknown): AircraftItem | null => {
    const key = keyOf(matricula);
    if (!key) return null;
    let item = index.get(key);
    if (!item) {
      item = { key, matricula: key, modelo: 'No registrado', estado: 'Histórica / sin ficha activa',
        sede: 'No registrada', ordenes: [], ultimaActividad: 0, enFlota: false };
      index.set(key, item);
    }
    return item;
  };
  for (const row of fleet) {
    const item = ensure(row.matricula);
    if (!item) continue;
    item.enFlota = true;
    item.modelo = txt(row.modelo ?? row.model ?? row.tipo_aeronave ?? row.fabricante_modelo);
    item.estado = txt(row.estado);
    item.sede = txt(row.sede ?? row.ubicacion ?? row.location);
  }
  for (const row of orders) {
    const item = ensure(row.matricula);
    if (!item) continue;
    item.ordenes.push(row);
    item.ultimaActividad = Math.max(item.ultimaActividad,
      when(row.fecha_fin), when(row.fecha_cierre), when(row.created_at));
  }
  return [...index.values()].map(item => ({
    ...item,
    ordenes: item.ordenes.sort((a, b) => when(b.created_at) - when(a.created_at)),
  })).sort((a, b) => b.ultimaActividad - a.ultimaActividad || a.matricula.localeCompare(b.matricula));
}

const AircraftArchive: React.FC<AircraftArchiveProps> = ({ initialMatricula, onBack }) => {
  const navigate = useNavigate();
  const returnToFleet = () => {
    if (onBack) { onBack(); return; }
    navigate('/', { state: { openTab: 'fleet' } });
  };
  const [items, setItems] = useState<AircraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(initialMatricula ? keyOf(initialMatricula) : null);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fleet, orders] = await Promise.all([readAll('flota_aviones'), readAll('ordenes_trabajo')]);
      setItems(makeItems(fleet, orders));
    } catch (err) {
      setItems([]); // Fail closed: no presentar como completo un histórico parcial.
      setError(err instanceof Error ? err.message : 'No fue posible consultar el archivo histórico.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setSelectedKey(initialMatricula ? keyOf(initialMatricula) : null); }, [initialMatricula]);

  const selected = useMemo(() => items.find(item => item.key === selectedKey), [items, selectedKey]);
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q) return items;
    return items.filter(item => [item.matricula, item.modelo, item.estado, item.sede]
      .some(value => value.toLocaleLowerCase().includes(q)) || item.ordenes.some(order =>
        [order.descripcion_tarea, order.nombre_mecanico].some(value => txt(value, '').toLocaleLowerCase().includes(q))));
  }, [items, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / DISPLAY_SIZE));
  const visible = filtered.slice((Math.min(page, pages) - 1) * DISPLAY_SIZE, Math.min(page, pages) * DISPLAY_SIZE);
  const totalOrders = useMemo(() => items.reduce((sum, item) => sum + item.ordenes.length, 0), [items]);
  const printSelected = () => {
    if (!selected) return;
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { setError('El navegador bloqueó la ventana de impresión.'); return; }
    const ordersHtml = selected.ordenes.map((order, index) => {
      const fields: Array<[string, unknown]> = [
        ['Estado registrado', order.estado], ['Descripción', order.descripcion_tarea],
        ['Mecánico registrado', order.nombre_mecanico], ['Fecha de registro', dateText(order.created_at)],
        ['Fecha de cierre', dateText(order.fecha_cierre ?? order.fecha_fin)],
        ['Observaciones', order.observaciones], ['Observaciones finales', order.observaciones_finales],
        ['Trabajo realizado', order.trabajo_realizado], ['Repuestos', order.repuestos ?? order.repuestos_instalados],
        ['Pruebas', order.pruebas ?? order.pruebas_ejecutadas],
      ];
      return `<section><h3>Registro ${index + 1} · ${safe(order.id)}</h3>${fields.map(([label, value]) =>
        `<p><strong>${safe(label)}:</strong> ${safe(value)}</p>`).join('')}</section>`;
    }).join('');
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="UTF-8"/><title>Expediente OMA ${safe(selected.matricula)}</title><style>
      body{font:12px Arial,sans-serif;color:#111;padding:24px}header{border-bottom:3px solid #222;padding-bottom:15px}
      h1{font-size:22px}section{padding:14px 0;border-bottom:1px solid #bbb;break-inside:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}
      footer{margin-top:24px;font-size:10px;color:#555}@page{size:A4;margin:14mm}
    </style></head><body><header><strong>ÁGUILAS PILOT · VALKYRON OS</strong><h1>Expediente histórico OMA · ${safe(selected.matricula)}</h1>
    <p>Modelo: ${safe(selected.modelo)} | Registros: ${selected.ordenes.length} | Emitido: ${safe(new Date().toLocaleString('es-VE'))}</p></header>
    ${ordersHtml || '<p>No existen órdenes registradas para esta matrícula.</p>'}
    <footer>Compilación de datos registrados en el sistema. No constituye liberación al servicio ni certificación de aeronavegabilidad.</footer>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
  const btn = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider hover:border-[#E1AD01]/50 disabled:opacity-40';
  return <div className="text-white text-left space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={selected ? () => setSelectedKey(null) : returnToFleet} className={btn} aria-label={selected ? 'Volver al listado de aeronaves' : 'Volver al módulo Flota'}><ArrowLeft size={16}/>{selected ? 'Volver al listado' : 'Volver a Flota'}</button>
        <div><p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E1AD01]">Águilas Pilot · Archivo OMA</p>
          <h2 className="text-xl md:text-2xl font-black uppercase">{selected ? `Expediente ${selected.matricula}` : 'Histórico de aeronaves'}</h2></div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {selected && <button className={btn} type="button" onClick={() => setSelectedKey(null)}><Archive size={14}/> Ver todo el archivo</button>}
        {selected && <button className={btn} type="button" onClick={printSelected}><Printer size={14}/> Imprimir expediente</button>}
        <button className={btn} type="button" disabled={loading} onClick={() => void reload()}><RefreshCw size={14}/> Actualizar</button>
      </div>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
    {loading ? <div className="flex items-center gap-3 p-8 text-slate-400"><Loader2 className="animate-spin"/> Consultando histórico completo...</div> : <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Aeronaves documentadas" value={items.length}/>
        <Stat label="Órdenes registradas" value={totalOrders}/>
        <Stat label="Solo en histórico" value={items.filter(item => !item.enFlota).length}/>
      </div>
      {selected ? <>
        <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Info label="Modelo" value={selected.modelo}/><Info label="Estado en el sistema" value={selected.estado}/>
          <Info label="Última actividad documentada" value={selected.ultimaActividad ? dateText(selected.ultimaActividad) : 'No registrada'}/>
        </div>
        <div className="flex gap-2 items-start rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <ShieldAlert size={16} className="shrink-0"/> Historial documentado en esta OMA. Los estados aquí mostrados no constituyen una autorización de retorno al servicio.
        </div>
        {selected.ordenes.length === 0 ? <Empty text="Esta aeronave no tiene órdenes de trabajo registradas."/> :
          <div className="space-y-3">{selected.ordenes.map((order, idx) => {
            const id = txt(order.id, `ot-${idx}`);
            const open = expandedId === id;
            return <article key={`${id}-${idx}`} className="rounded-2xl border border-white/10 bg-[#101010] overflow-hidden">
              <button type="button" aria-expanded={open} onClick={() => setExpandedId(open ? null : id)} className="w-full text-left p-5 flex gap-4 items-start justify-between hover:bg-white/[0.03]">
                <div className="space-y-2 min-w-0"><p className="text-[10px] text-[#E1AD01] font-mono">OT · {id}</p>
                  <h3 className="text-sm font-bold break-words">{txt(order.descripcion_tarea)}</h3>
                  <p className="text-xs text-slate-400 flex flex-wrap gap-3"><span className="flex gap-1 items-center"><Clock3 size={12}/>{dateText(order.created_at)}</span><span>{txt(order.estado)}</span></p>
                </div><FileText className="shrink-0 text-[#E1AD01]" size={18}/>
              </button>
              {open && <div className="border-t border-white/10 p-5 grid md:grid-cols-2 gap-4 text-xs">
                <Info label="Mecánico registrado" value={txt(order.nombre_mecanico)}/>
                <Info label="Fecha de cierre registrada" value={dateText(order.fecha_cierre ?? order.fecha_fin)}/>
                <Info label="Observaciones" value={txt(order.observaciones)}/>
                <Info label="Observaciones finales" value={txt(order.observaciones_finales)}/>
                <Info label="Trabajo realizado" value={txt(order.trabajo_realizado)}/>
                <Info label="Repuestos / consumibles documentados" value={txt(order.repuestos ?? order.repuestos_instalados)}/>
              </div>}
            </article>;
          })}</div>}
      </> : <>
        <label className="relative block"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}
            placeholder="Buscar matrícula, modelo, técnico u orden..." className="w-full rounded-xl border border-white/10 bg-black py-4 pl-12 pr-4 text-xs outline-none focus:border-[#E1AD01]"/>
        </label>
        {filtered.length === 0 ? <Empty text="No se encontraron aeronaves para esta búsqueda."/> : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map(item => <button key={item.key} type="button" onClick={() => { setSelectedKey(item.key); setExpandedId(null); }}
            className="text-left rounded-2xl border border-white/10 bg-[#0f0f0f] p-5 hover:border-[#E1AD01]/50 transition-colors space-y-3">
            <div className="flex gap-3 items-center"><Plane className="text-[#E1AD01]" size={20}/><strong className="text-xl font-black font-mono">{item.matricula}</strong></div>
            <p className="text-xs text-slate-300">{item.modelo}</p>
            <p className="text-[10px] uppercase text-slate-500">{item.enFlota ? 'Con ficha en flota' : 'Solo histórico de órdenes'}</p>
            <div className="flex justify-between text-xs text-slate-400 border-t border-white/10 pt-3"><span className="flex gap-2 items-center"><Wrench size={13}/>{item.ordenes.length} órdenes</span><span>{item.ultimaActividad ? dateText(item.ultimaActividad).split(',')[0] : 'Sin fecha'}</span></div>
          </button>)}
        </div>}
        {pages > 1 && <div className="flex justify-center items-center gap-4"><button type="button" className={btn} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={14}/> Anterior</button>
          <span className="text-xs text-slate-400">Página {Math.min(page, pages)} de {pages}</span>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>Siguiente <ChevronRight size={14}/></button></div>}
      </>}
    </>}
    <p className="text-[10px] text-slate-500">Archivo construido a partir de flota_aviones y ordenes_trabajo. No incluye registros que hayan sido borrados previamente ni documentación almacenada en otras tablas.</p>
  </div>;
};

const Stat = ({ label, value }: { label: string; value: number }) => <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</p><p className="text-2xl font-black mt-2">{value.toLocaleString('es-VE')}</p></div>;
const Info = ({ label, value }: { label: string; value: string }) => <div className="min-w-0"><p className="text-[9px] font-black tracking-widest uppercase text-slate-500 mb-2">{label}</p><p className="text-xs text-slate-200 whitespace-pre-wrap break-words">{value}</p></div>;
const Empty = ({ text }: { text: string }) => <div className="rounded-xl border border-white/10 p-10 text-center text-slate-500 text-xs">{text}</div>;
export default AircraftArchive;

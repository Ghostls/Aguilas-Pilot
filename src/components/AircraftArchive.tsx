// src/components/AircraftArchive.tsx
// B&M Mantenimiento Aeronáutico / Valkyron OS — Archivo histórico OMA v2.0
// Lectura de todas las aeronaves y sus OT; no altera estados ni certificaciones.
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0 — REBRAND B&M + CONEXIONES:
//   [FIX] Página ilegible: el archivo se abre en la ruta directa
//         /aircraft-archive (sin el marco del Centro de Mando) y pintaba texto
//         blanco sin fondo propio. Con el lienzo claro de B&M el contenido
//         quedaba invisible. Ahora es una página B&M completa (cabecera con
//         logo, lienzo, contenedor), legible en móvil y escritorio.
//   [FIX] Fallo de carga: además del aviso se mostraban contadores en 0 y
//         "No se encontraron aeronaves para esta búsqueda" (un vacío falso).
//         Ahora un fallo de lectura muestra solo el error con "Reintentar".
//   [UI]  Estados de OT y de aeronave en español (En progreso, Completada…);
//         el valor registrado se conserva en el título y en la impresión.
//   [UI]  Impresión con identidad B&M (antes ÁGUILAS PILOT · VALKYRON OS).
//   [A11Y] Búsqueda con etiqueta, acordeón con aria-expanded, foco visible.
// PRESERVADO ÍNTEGRO: lectura completa por lotes de 500 con orden estable,
//   límite explícito de 100.000 filas (fail closed), unión flota + órdenes por
//   matrícula normalizada, aeronaves solo históricas, búsqueda por matrícula /
//   modelo / estado / sede / tarea / mecánico, paginación de 12, expediente
//   con acordeón, impresión escapada (safe), vuelta a Flota (openTab: 'fleet').
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { BmLogo } from './brand/BmLogo';
import { BmBadge, BmEmpty, BmNotice, bmInput, bmBtn, type BmTone } from './brand/bm-ui';
import {
  Archive, ArrowLeft, ChevronLeft, ChevronRight, Clock3, FileText,
  Loader2, Plane, Printer, RefreshCw, Search, ShieldAlert, Wrench,
  ChevronDown, AlertCircle, X,
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

// [v2.0] Etiquetas en español; el valor registrado no se altera.
const ESTADO_OT: Record<string, { label: string; tone: BmTone }> = {
  'In Progress':   { label: 'En progreso',         tone: 'warn' },
  'Pending Parts': { label: 'Esperando repuestos', tone: 'info' },
  'On Hold':       { label: 'En espera',           tone: 'neutral' },
  'Completed':     { label: 'Completada',          tone: 'ok' },
  'Open':          { label: 'Abierta',             tone: 'warn' },
};
const ESTADO_AERONAVE: Record<string, { label: string; tone: BmTone }> = {
  operational: { label: 'Operativa',        tone: 'ok' },
  maintenance: { label: 'En mantenimiento', tone: 'warn' },
  grounded:    { label: 'En tierra (AOG)',  tone: 'danger' },
  flight:      { label: 'En vuelo',         tone: 'info' },
};
const estadoOt = (v: unknown) => ESTADO_OT[txt(v, '')] ?? { label: txt(v), tone: 'neutral' as BmTone };
const estadoAeronave = (v: string) => ESTADO_AERONAVE[v.toLowerCase()] ?? { label: v, tone: 'neutral' as BmTone };
/** Texto impreso: etiqueta y, si difiere, el valor tal como está registrado. */
const conRegistro = (label: string, raw: unknown) => (txt(raw, '') && label !== txt(raw, '') ? `${label} (${txt(raw)})` : label);

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
  // [FIX v2.0] Un fallo de lectura deja items vacíos: no se presenta como archivo vacío.
  const loadFailed = !!error && items.length === 0;

  const printSelected = () => {
    if (!selected) return;
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { setError('El navegador bloqueó la ventana de impresión.'); return; }
    const ordersHtml = selected.ordenes.map((order, index) => {
      const fields: Array<[string, unknown]> = [
        ['Estado registrado', conRegistro(estadoOt(order.estado).label, order.estado)], ['Descripción', order.descripcion_tarea],
        ['Mecánico registrado', order.nombre_mecanico], ['Fecha de registro', dateText(order.created_at)],
        ['Fecha de cierre', dateText(order.fecha_cierre ?? order.fecha_fin)],
        ['Observaciones', order.observaciones], ['Observaciones finales', order.observaciones_finales],
        ['Trabajo realizado', order.trabajo_realizado], ['Repuestos', order.repuestos ?? order.repuestos_instalados],
        ['Pruebas', order.pruebas ?? order.pruebas_ejecutadas],
      ];
      return `<section><h3>Registro ${index + 1} · ${safe(order.id)}</h3>${fields.map(([label, value]) =>
        `<p><strong>${safe(label)}:</strong> ${safe(value)}</p>`).join('')}</section>`;
    }).join('');
    // [v2.0] Identidad B&M en el expediente impreso
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="UTF-8"/><title>Expediente OMA ${safe(selected.matricula)}</title><style>
      body{font:12px Arial,sans-serif;color:#1B1D22;padding:24px}header{border-bottom:3px solid #D42125;padding-bottom:15px}
      .marca{color:#D42125;letter-spacing:.04em}h1{font-size:22px;margin:6px 0}h3{font-size:13px;margin:0 0 6px}
      section{padding:14px 0;border-bottom:1px solid #E3E5E9;break-inside:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:3px 0}
      footer{margin-top:24px;font-size:10px;color:#5F6670}@page{size:A4;margin:14mm}
    </style></head><body><header><strong class="marca">B&amp;M MANTENIMIENTO AERONÁUTICO · VALKYRON OS</strong><h1>Expediente histórico OMA · ${safe(selected.matricula)}</h1>
    <p>Modelo: ${safe(selected.modelo)} | Estado: ${safe(conRegistro(estadoAeronave(selected.estado).label, selected.estado))} | Registros: ${selected.ordenes.length} | Emitido: ${safe(new Date().toLocaleString('es-VE'))}</p></header>
    ${ordersHtml || '<p>No existen órdenes registradas para esta matrícula.</p>'}
    <footer>Compilación de datos registrados en el sistema. No constituye liberación al servicio ni certificación de aeronavegabilidad.</footer>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const backLabel = selected ? 'Volver al listado' : 'Volver a Flota';

  return (
    <div className="bm-app min-h-[100dvh] bg-bm-canvas text-left text-bm-ink">
      {/* CABECERA B&M [v2.0] */}
      <header className="sticky top-0 z-30 border-b border-bm-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <button type="button" onClick={selected ? () => setSelectedKey(null) : returnToFleet}
            className={`${bmBtn.ghost} ${bmBtn.sm} -ml-2`}
            aria-label={selected ? 'Volver al listado de aeronaves' : 'Volver al módulo Flota'}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden min-[400px]:inline">{backLabel}</span>
          </button>
          <BmLogo variant="compact" className="h-7 w-auto text-bm-red sm:h-8" />
          <button type="button" disabled={loading} onClick={() => void reload()}
            className={`${bmBtn.secondary} ${bmBtn.sm}`} aria-label="Actualizar archivo">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {/* TÍTULO */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bm-red text-white">
              {selected ? <Plane className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h1 className="bm-heading text-2xl leading-tight sm:text-[28px]">
                {selected ? <>Expediente <span className="font-data">{selected.matricula}</span></> : 'Archivo histórico OMA'}
              </h1>
              <p className="mt-0.5 text-sm text-bm-steel">
                {selected ? `${selected.modelo} · ${selected.ordenes.length === 1 ? '1 orden registrada' : `${selected.ordenes.length} órdenes registradas`}`
                  : 'Todas las aeronaves y sus órdenes de trabajo, en modo de solo lectura'}
              </p>
            </div>
          </div>
          {selected && (
            <div className="flex flex-wrap gap-2">
              <button className={`${bmBtn.secondary} ${bmBtn.sm}`} type="button" onClick={() => setSelectedKey(null)}>
                <Archive className="h-4 w-4" /> Ver todo el archivo
              </button>
              <button className={`${bmBtn.dark} ${bmBtn.sm}`} type="button" onClick={printSelected}>
                <Printer className="h-4 w-4" /> Imprimir expediente
              </button>
            </div>
          )}
        </div>

        {error && !loadFailed && (
          <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>{error}</BmNotice>
        )}

        {loading ? (
          <div className="space-y-3" role="status" aria-label="Consultando histórico completo">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[0, 1, 2].map(i => <div key={i} className={`bm-skeleton h-[92px] rounded-2xl ${i === 2 ? 'col-span-2 md:col-span-1' : ''}`} />)}
            </div>
            <p className="flex items-center gap-2 text-sm text-bm-steel">
              <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Consultando histórico completo…
            </p>
          </div>
        ) : loadFailed ? (
          <div className="rounded-[24px] border border-bm-line bg-white">
            <BmEmpty
              icon={<AlertCircle className="h-5 w-5" />}
              title="No se pudo consultar el archivo"
              text={<>{error}<br />No se muestran resultados parciales.</>}
              action={
                <button type="button" onClick={() => void reload()} className={bmBtn.primary}>
                  <RefreshCw className="h-4 w-4" /> Reintentar
                </button>
              }
            />
          </div>
        ) : <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Aeronaves documentadas" value={items.length} />
            <Stat label="Órdenes registradas" value={totalOrders} />
            <Stat label="Solo en histórico" value={items.filter(item => !item.enFlota).length} className="col-span-2 md:col-span-1" />
          </div>

          {selected ? <>
            <div className="grid grid-cols-1 gap-4 rounded-[20px] border border-bm-line bg-white p-4 sm:p-5 md:grid-cols-3">
              <Info label="Modelo" value={selected.modelo} />
              <div className="min-w-0">
                <p className="mb-1.5 text-xs text-bm-steel">Estado en el sistema</p>
                <BmBadge tone={estadoAeronave(selected.estado).tone} dot>
                  <span title={selected.estado}>{estadoAeronave(selected.estado).label}</span>
                </BmBadge>
              </div>
              <Info label="Última actividad documentada" value={selected.ultimaActividad ? dateText(selected.ultimaActividad) : 'No registrada'} />
            </div>
            <BmNotice tone="warn" icon={<ShieldAlert className="h-4 w-4" />}>
              Historial documentado en esta OMA. Los estados aquí mostrados no constituyen una autorización de retorno al servicio.
            </BmNotice>
            {selected.ordenes.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-bm-line bg-white">
                <BmEmpty icon={<FileText className="h-5 w-5" />} title="Sin órdenes de trabajo"
                  text="Esta aeronave no tiene órdenes de trabajo registradas." />
              </div>
            ) : (
              <div className="space-y-3">{selected.ordenes.map((order, idx) => {
                const id = txt(order.id, `ot-${idx}`);
                const open = expandedId === id;
                const est = estadoOt(order.estado);
                return (
                  <article key={`${id}-${idx}`} className="overflow-hidden rounded-[20px] border border-bm-line bg-white">
                    <button type="button" aria-expanded={open} onClick={() => setExpandedId(open ? null : id)}
                      className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-bm-canvas/60 sm:p-5">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-data text-xs text-bm-steel">OT {id}</span>
                          <BmBadge tone={est.tone} dot><span title={txt(order.estado)}>{est.label}</span></BmBadge>
                        </div>
                        <h3 className="break-words text-sm font-semibold uppercase leading-snug">{txt(order.descripcion_tarea)}</h3>
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bm-steel">
                          <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{dateText(order.created_at)}</span>
                          <span className="inline-flex items-center gap-1 uppercase"><Wrench className="h-3.5 w-3.5" />{txt(order.nombre_mecanico)}</span>
                        </p>
                      </div>
                      <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-bm-steel transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="bm-view grid gap-4 border-t border-bm-line p-4 text-sm sm:p-5 md:grid-cols-2">
                        <Info label="Mecánico registrado" value={txt(order.nombre_mecanico)} />
                        <Info label="Fecha de cierre registrada" value={dateText(order.fecha_cierre ?? order.fecha_fin)} />
                        <Info label="Observaciones" value={txt(order.observaciones)} mono />
                        <Info label="Observaciones finales" value={txt(order.observaciones_finales)} mono />
                        <Info label="Trabajo realizado" value={txt(order.trabajo_realizado)} />
                        <Info label="Repuestos / consumibles documentados" value={txt(order.repuestos ?? order.repuestos_instalados)} />
                      </div>
                    )}
                  </article>
                );
              })}</div>
            )}
          </> : <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
              <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}
                type="search" aria-label="Buscar en el archivo"
                placeholder="Buscar matrícula, modelo, técnico u orden"
                className={`${bmInput} pl-11 pr-11`} />
              {search && (
                <button type="button" onClick={() => { setSearch(''); setPage(1); }} aria-label="Limpiar búsqueda"
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {filtered.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-bm-line bg-white">
                {items.length === 0
                  ? <BmEmpty icon={<Archive className="h-5 w-5" />} title="Archivo vacío"
                      text="No hay aeronaves ni órdenes de trabajo registradas todavía." />
                  : <BmEmpty icon={<Search className="h-5 w-5" />} title="Sin resultados"
                      text="No se encontraron aeronaves para esta búsqueda."
                      action={<button type="button" onClick={() => { setSearch(''); setPage(1); }} className={bmBtn.secondary}>Ver todo el archivo</button>} />}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visible.map(item => {
                  const est = item.enFlota ? estadoAeronave(item.estado) : { label: 'Solo histórico', tone: 'neutral' as BmTone };
                  return (
                    <button key={item.key} type="button" onClick={() => { setSelectedKey(item.key); setExpandedId(null); }}
                      className="space-y-3 rounded-[20px] border border-bm-line bg-white p-4 text-left transition-colors hover:border-bm-red/40 sm:p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Plane className="h-5 w-5 shrink-0 text-bm-red" />
                          <strong className="truncate font-data text-lg font-semibold">{item.matricula}</strong>
                        </span>
                        <BmBadge tone={est.tone}>{est.label}</BmBadge>
                      </div>
                      <p className="truncate text-sm uppercase text-bm-steel">{item.modelo}</p>
                      <div className="flex justify-between gap-3 border-t border-bm-line pt-3 text-xs text-bm-steel">
                        <span className="inline-flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" />
                          {item.ordenes.length === 1 ? '1 orden' : `${item.ordenes.length} órdenes`}</span>
                        <span>{item.ultimaActividad ? dateText(item.ultimaActividad).split(',')[0] : 'Sin fecha'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {pages > 1 && (
              <nav className="flex items-center justify-center gap-3" aria-label="Paginación del archivo">
                <button type="button" className={`${bmBtn.secondary} ${bmBtn.sm}`} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </button>
                <span className="text-sm text-bm-steel">Página {Math.min(page, pages)} de {pages}</span>
                <button type="button" className={`${bmBtn.secondary} ${bmBtn.sm}`} disabled={page >= pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>
                  Siguiente <ChevronRight className="h-4 w-4" />
                </button>
              </nav>
            )}
          </>}
        </>}
        <p className="text-xs text-bm-hint">
          Archivo construido a partir de flota_aviones y ordenes_trabajo. No incluye registros que hayan sido borrados previamente ni documentación almacenada en otras tablas.
        </p>
      </main>
    </div>
  );
};

const Stat = ({ label, value, className = '' }: { label: string; value: number; className?: string }) => (
  <div className={`rounded-[20px] border border-bm-line bg-white p-4 ${className}`}>
    <p className="text-[13px] text-bm-steel">{label}</p>
    <p className="bm-figure mt-1.5 text-[32px] leading-none">{value.toLocaleString('es-VE')}</p>
  </div>
);
const Info = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div className="min-w-0">
    <p className="mb-1.5 text-xs text-bm-steel">{label}</p>
    <p className={`whitespace-pre-wrap break-words text-sm ${mono ? 'font-data text-xs leading-relaxed' : ''}`}>{value}</p>
  </div>
);
export default AircraftArchive;

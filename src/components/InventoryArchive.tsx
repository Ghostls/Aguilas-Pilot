// src/components/InventoryArchive.tsx
// B&M Mantenimiento Aeronáutico / Valkyron OS — Archivo de inventario v2.0
// Inventario histórico (consulta independiente, sin modificar checkout).
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0 — REBRAND B&M + CONEXIONES:
//   [PREV] Impresión doble: el código llama a print() en el evento 'load' y
//         también si readyState ya es 'complete'. En Chrome solo ocurre una de
//         las dos (verificado), pero un navegador que dispare 'load' después
//         de document.close() abriría dos diálogos. Un guardia garantiza una
//         sola llamada a print().
//   [FIX] Vacío falso: con error de lectura se mostraban el aviso y debajo
//         "No hay registros para mostrar" con contadores en 0. Ahora un fallo
//         muestra solo el error con Reintentar.
//   [FIX] Recargas superpuestas: dos "Actualizar" seguidos podían terminar en
//         desorden y pintar la lectura vieja. Solo pinta la última (secuencia).
//   [FIX] El comentario de cabecera pedía VITE_INVENTORY_TABLE, pero la tabla
//         es fija (inventario_repuestos). Se corrige el comentario.
//   [UI]  Página B&M completa (cabecera con logo, lienzo claro, contenedor):
//         antes era una página oscura suelta. Columnas con nombre legible y en
//         orden útil (número de parte, descripción, cantidad…), cantidades bajo
//         el mínimo marcadas, fechas en hora local, precios con 2 decimales.
//         En móvil, tarjetas por repuesto en lugar de una tabla de 800 px.
//   [UI]  Resumen: registros, repuestos bajo mínimo y valor del inventario
//         (cantidad × precio unitario), calculados sobre lo filtrado.
//   [UI]  Impresión con identidad B&M (antes ÁGUILAS PILOT) e indicación del
//         filtro aplicado.
// PRESERVADO ÍNTEGRO: tabla inventario_repuestos, lectura completa por lotes de
//   500 con orden estable por id, límite explícito de 100.000 filas (fail
//   closed), columnas dinámicas (todas las que existan), búsqueda en todos los
//   campos, paginación de 25, impresión de TODOS los registros filtrados (no
//   solo la página visible) con escape HTML (safe), vuelta a Stock
//   (openTab: 'inventory'), export default.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import {
  Archive, ArrowLeft, ChevronLeft, ChevronRight, Loader2, Printer, RefreshCw, Search,
  AlertCircle, AlertTriangle, ChevronDown, PackageSearch, X,          // [v2.0]
} from 'lucide-react';
import { BmLogo } from './brand/BmLogo';                              // [v2.0]
import { BmBadge, BmNotice, bmBtn } from './brand/bm-ui';             // [v2.0]

type StockRow = Record<string, unknown>;
const TABLE = 'inventario_repuestos';
const PAGE = 500;
const DISPLAY = 25;
const LIMIT = 100000;
const label = (v: unknown): string => v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const safe = (v: unknown): string => label(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── [NEW v2.0] Presentación de columnas ─────────────────────────────────────
const EMPRESA_LEGAL = 'B&M Mantenimiento Aeronáutico';

/** Nombres legibles de las columnas conocidas de inventario_repuestos. */
const COLUMN_LABEL: Record<string, string> = {
  numero_parte: 'Número de parte',
  nombre: 'Descripción',
  cantidad: 'Cantidad',
  stock_minimo: 'Stock mínimo',
  ubicacion_hangar: 'Ubicación',
  precio_unitario: 'Precio unitario',
  certificado_numero: 'Certificado',
  factura_numero: 'Factura',
  vendor_id: 'Proveedor (id)',
  created_at: 'Registrado',
  updated_at: 'Actualizado',
  id: 'ID',
};

/** Orden preferido; las columnas desconocidas van después, en el orden recibido. */
const COLUMN_ORDER = [
  'numero_parte', 'nombre', 'cantidad', 'stock_minimo', 'ubicacion_hangar',
  'precio_unitario', 'certificado_numero', 'factura_numero', 'vendor_id',
  'created_at', 'updated_at', 'id',
];

const MONO_COLUMNS = new Set(['numero_parte', 'certificado_numero', 'factura_numero', 'vendor_id', 'id']);
const NUMERIC_COLUMNS = new Set(['cantidad', 'stock_minimo', 'precio_unitario']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const columnLabel = (key: string): string => {
  if (COLUMN_LABEL[key]) return COLUMN_LABEL[key];
  const t = key.replace(/_/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : key;
};

const toNumber = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Valor visible de una celda (fechas locales, precio con 2 decimales). */
const cellText = (key: string, v: unknown): string => {
  if (typeof v === 'string' && ISO_DATE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (key === 'precio_unitario') {
    const n = toNumber(v);
    if (n !== null) return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return label(v);
};

const bajoMinimo = (row: StockRow): boolean => {
  const qty = toNumber(row.cantidad);
  const min = toNumber(row.stock_minimo);
  return qty !== null && min !== null && qty <= min;
};

async function loadInventory(): Promise<StockRow[]> {
  const records: StockRow[] = [];
  for (let start = 0; start < LIMIT; start += PAGE) {
    const { data, error } = await supabase.from(TABLE).select('*').order('id', { ascending: true }).range(start, start + PAGE - 1);
    if (error) throw new Error(`Error consultando inventario: ${error.message}`);
    const batch = (data ?? []) as StockRow[];
    records.push(...batch);
    if (batch.length < PAGE) return records;
  }
  throw new Error(`La consulta excedió ${LIMIT} registros. Se requiere paginación en servidor para generar reportes completos.`);
}

const InventoryArchive: React.FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);   // [v2.0]
  const seqRef = useRef(0);                                        // [v2.0] solo pinta la última lectura

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true); setError(null);
    try {
      const data = await loadInventory();
      if (seq !== seqRef.current) return;
      setRows(data); setPage(1); setLoadedAt(new Date());
    }
    catch (e) {
      if (seq !== seqRef.current) return;
      setRows([]); setError(e instanceof Error ? e.message : 'No se pudo consultar inventario.');
    }
    finally { if (seq === seqRef.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { seqRef.current += 1; };
  }, [refresh]);

  // [v2.0] columnas dinámicas en orden útil (todas las que existan)
  const columns = useMemo(() => {
    const all = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    const known = COLUMN_ORDER.filter(k => all.includes(k));
    return [...known, ...all.filter(k => !COLUMN_ORDER.includes(k))];
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase('es');
    return needle
      ? rows.filter(row => Object.entries(row).some(([k, v]) =>
          label(v).toLocaleLowerCase('es').includes(needle) || cellText(k, v).toLocaleLowerCase('es').includes(needle)))
      : rows;
  }, [rows, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / DISPLAY));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * DISPLAY, currentPage * DISPLAY);

  // [NEW v2.0] Resumen sobre lo filtrado
  const resumen = useMemo(() => {
    let bajo = 0;
    let valor = 0;
    let conPrecio = 0;
    filtered.forEach(r => {
      if (bajoMinimo(r)) bajo++;
      const q = toNumber(r.cantidad);
      const p = toNumber(r.precio_unitario);
      if (q !== null && p !== null) { valor += q * p; conPrecio++; }
    });
    return { bajo, valor, conPrecio };
  }, [filtered]);
  const tieneCantidades = columns.includes('cantidad') && columns.includes('stock_minimo');
  const tienePrecios = columns.includes('cantidad') && columns.includes('precio_unitario');

  // Campos principales de la tarjeta móvil
  const tituloKey = columns.includes('nombre') ? 'nombre' : columns[0];
  const codigoKey = columns.includes('numero_parte') ? 'numero_parte' : null;
  const detalleKeys = columns.filter(k => k !== tituloKey && k !== codigoKey && k !== 'cantidad');

  const printReport = () => {
    if (loading || error || !filtered.length) return;
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { setError('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes.'); return; }
    const head = columns.map(key => `<th>${safe(columnLabel(key))}</th>`).join('');
    const body = filtered.map(row => `<tr${bajoMinimo(row) ? ' class="low"' : ''}>${columns.map(key => `<td>${safe(cellText(key, row[key]))}</td>`).join('')}</tr>`).join('');
    const filtroTxt = filter.trim() ? ` · Filtro: «${safe(filter.trim())}»` : '';
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${safe(EMPRESA_LEGAL)} — Inventario</title><style>
      @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1B1D22;padding:16px}
      .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:3px solid #D42125;padding-bottom:10px;margin-bottom:12px}
      .brand{font-size:18px;font-weight:900;color:#D42125;letter-spacing:.4px}h1{font-size:15px;margin:0;text-align:right}
      p{font-size:10px;color:#5F6670;margin:4px 0}table{border-collapse:collapse;width:100%;font-size:9px;margin-top:10px}
      td,th{border:1px solid #E3E5E9;padding:5px;overflow-wrap:anywhere;vertical-align:top;text-align:left}
      th{background:#F2F3F5;color:#5F6670}thead{display:table-header-group}tr{break-inside:avoid}tr.low td{background:#FFF7ED}
      .foot{margin-top:14px;padding-top:8px;border-top:1px solid #E3E5E9;display:flex;justify-content:space-between;font-size:9px;color:#5F6670}
      </style></head><body>
      <div class="head"><div class="brand">${safe(EMPRESA_LEGAL.toUpperCase())}</div><h1>Archivo de inventario</h1></div>
      <p>Generado: ${safe(new Date().toLocaleString('es-VE'))} · Registros incluidos: ${filtered.length}${filtroTxt} · Tabla: ${safe(TABLE)}</p>
      <p>Reporte de datos registrados en el sistema. No reemplaza una conciliación física de existencias. Filas resaltadas: cantidad en o bajo el stock mínimo.</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <div class="foot"><span>${safe(EMPRESA_LEGAL)}</span><span>Documento generado por Valkyron OS</span></div></body></html>`);
    win.document.close();
    win.focus();
    // No imprimir automáticamente antes de que el navegador complete el documento.
    // [FIX v2.0] Una sola impresión aunque ocurran 'load' y readyState 'complete'.
    let impreso = false;
    const imprimir = () => { if (impreso) return; impreso = true; win.print(); };
    win.addEventListener('load', imprimir, { once: true });
    if (win.document.readyState === 'complete') imprimir();
  };

  const volverAStock = () => navigate('/', { state: { openTab: 'inventory' } });

  const renderCell = (key: string, row: StockRow) => {
    const v = row[key];
    if (key === 'cantidad' && tieneCantidades && bajoMinimo(row)) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="bm-num font-semibold text-bm-warn">{cellText(key, v)}</span>
          <BmBadge tone="warn">Bajo mínimo</BmBadge>
        </span>
      );
    }
    const cls = MONO_COLUMNS.has(key) ? 'font-data' : NUMERIC_COLUMNS.has(key) ? 'bm-num' : '';
    return <span className={cls}>{cellText(key, v)}</span>;
  };

  return (
    <div className="bm-app min-h-[100dvh] bg-bm-canvas text-left text-bm-ink">
      {/* CABECERA B&M [v2.0] */}
      <header className="sticky top-0 z-30 border-b border-bm-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <button type="button" onClick={volverAStock} className={`${bmBtn.ghost} ${bmBtn.sm} -ml-2`} aria-label="Volver al módulo Stock">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden min-[400px]:inline">Volver a Stock</span>
          </button>
          <BmLogo variant="compact" className="h-7 w-auto text-bm-red sm:h-8" />
          <button type="button" onClick={() => void refresh()} disabled={loading}
            className={`${bmBtn.secondary} ${bmBtn.sm}`} aria-label="Actualizar inventario">
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
              <Archive className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="bm-heading text-2xl leading-tight sm:text-[28px]">Archivo de inventario</h1>
              <p className="mt-0.5 text-sm text-bm-steel">
                Consulta paginada e impresión de todos los registros filtrados, no solo la página visible.
              </p>
            </div>
          </div>
          <button type="button" onClick={printReport} disabled={loading || !!error || !filtered.length}
            className={`${bmBtn.dark} ${bmBtn.sm} w-full shrink-0 sm:w-auto`}>
            <Printer className="h-4 w-4" /> Imprimir inventario
          </button>
        </div>

        {error && (
          <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold">No se pudo leer el inventario</p>
                <p className="mt-0.5 break-words font-data text-xs">{error}</p>
              </div>
              <button type="button" onClick={() => void refresh()} disabled={loading} className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}>
                <RefreshCw className="h-4 w-4" /> Reintentar
              </button>
            </div>
          </BmNotice>
        )}

        {loading && rows.length === 0 ? (
          <div aria-busy="true" aria-label="Sincronizando inventario" className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map(i => <div key={i} className="bm-skeleton h-[92px] rounded-[20px]" />)}
            </div>
            <div className="bm-skeleton h-[360px] rounded-[24px]" />
            <p className="flex items-center justify-center gap-2 py-2 text-sm text-bm-steel">
              <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Sincronizando inventario…
            </p>
          </div>
        ) : !error && (
          <>
            {/* RESUMEN [v2.0] */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] border border-bm-line bg-white p-3.5 sm:p-4">
                <p className="text-[13px] leading-tight text-bm-steel">Registros</p>
                <p className="bm-figure mt-2 text-[24px] sm:text-[30px]">{filtered.length.toLocaleString('es-VE')}</p>
                {filter.trim() && <p className="mt-0.5 text-xs text-bm-steel">de {rows.length.toLocaleString('es-VE')}</p>}
              </div>
              <div className="rounded-[20px] border border-bm-line bg-white p-3.5 sm:p-4">
                <p className="text-[13px] leading-tight text-bm-steel">Bajo mínimo</p>
                <p className={`bm-figure mt-2 text-[24px] sm:text-[30px] ${resumen.bajo > 0 ? 'text-bm-warn' : 'text-bm-ink'}`}>
                  {tieneCantidades ? resumen.bajo : '—'}
                </p>
              </div>
              <div className="col-span-2 rounded-[20px] border border-bm-line bg-white p-3.5 sm:col-span-1 sm:p-4">
                <p className="text-[13px] leading-tight text-bm-steel">Valor en inventario</p>
                <p className="bm-figure mt-2 whitespace-nowrap text-[24px] sm:text-[30px]">
                  {tienePrecios && resumen.conPrecio > 0
                    ? `$${resumen.valor.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '—'}
                </p>
              </div>
            </div>

            {/* BÚSQUEDA */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <label className="relative w-full sm:w-96">
                <span className="sr-only">Buscar en todo el inventario</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
                <input value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
                  placeholder="Buscar en todo el inventario" type="search"
                  className="h-12 w-full rounded-xl border border-bm-field bg-white pl-10 pr-10 text-base text-bm-ink outline-none transition-[border-color,box-shadow] placeholder:text-bm-hint focus:border-bm-red focus:ring-4 focus:ring-bm-red/10" />
                {filter && (
                  <button type="button" onClick={() => { setFilter(''); setPage(1); }} aria-label="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>
              <span className="text-[13px] text-bm-steel">
                <span className="bm-num font-semibold text-bm-ink">{filtered.length}</span> de <span className="bm-num">{rows.length}</span> registros
                {loadedAt && <> · leído a las <span className="bm-num">{loadedAt.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span></>}
              </span>
            </div>

            {!visible.length ? (
              <div className="rounded-[24px] border border-dashed border-bm-field bg-white px-4 py-14 text-center">
                <PackageSearch className="mx-auto h-7 w-7 text-bm-hint" />
                <p className="mt-2 text-sm font-medium">
                  {rows.length ? 'Ningún registro coincide con la búsqueda.' : 'No hay registros para mostrar.'}
                </p>
                {rows.length > 0 && <p className="mt-0.5 text-[13px] text-bm-steel">Pruebe con el número de parte, la descripción o la ubicación.</p>}
              </div>
            ) : (
              <>
                {/* MÓVIL: tarjetas */}
                <ul className="space-y-2.5 md:hidden">
                  {visible.map((row, i) => (
                    <li key={String(row.id ?? `${currentPage}-${i}`)} className={`rounded-[20px] border bg-white p-4 ${tieneCantidades && bajoMinimo(row) ? 'border-bm-warn/40' : 'border-bm-line'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {codigoKey && <p className="font-data text-xs text-bm-steel">{cellText(codigoKey, row[codigoKey])}</p>}
                          <p className="mt-0.5 break-words text-[15px] font-semibold">{cellText(tituloKey, row[tituloKey])}</p>
                        </div>
                        {columns.includes('cantidad') && (
                          <div className="shrink-0 text-right">
                            <p className={`bm-figure text-[24px] ${tieneCantidades && bajoMinimo(row) ? 'text-bm-warn' : ''}`}>{cellText('cantidad', row.cantidad)}</p>
                            <p className="text-[11px] text-bm-steel">{tieneCantidades && bajoMinimo(row) ? 'bajo mínimo' : 'en stock'}</p>
                          </div>
                        )}
                      </div>
                      <details className="group mt-3 border-t border-bm-line pt-2.5">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium text-bm-steel [&::-webkit-details-marker]:hidden">
                          Todos los campos
                          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                        </summary>
                        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                          {detalleKeys.map(k => (
                            <React.Fragment key={k}>
                              <dt className="text-bm-steel">{columnLabel(k)}</dt>
                              <dd className={`min-w-0 break-words ${MONO_COLUMNS.has(k) ? 'font-data' : ''}`}>{cellText(k, row[k])}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      </details>
                    </li>
                  ))}
                </ul>

                {/* md+: tabla */}
                <div className="hidden overflow-x-auto rounded-[24px] border border-bm-line bg-white md:block">
                  <table className="w-full min-w-[800px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-bm-line bg-bm-canvas/60">
                        {columns.map(key => (
                          <th key={key} scope="col" className="whitespace-nowrap px-4 py-3 text-xs font-medium text-bm-steel">{columnLabel(key)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row, i) => (
                        <tr key={String(row.id ?? `${currentPage}-${i}`)} className={`border-b border-bm-line/70 last:border-0 hover:bg-bm-canvas/60 ${tieneCantidades && bajoMinimo(row) ? 'bg-bm-warn-tint/40' : ''}`}>
                          {columns.map(key => (
                            <td key={key} className={`max-w-xs break-words px-4 py-3 ${key === 'nombre' ? 'font-medium' : 'text-bm-ink'}`}>{renderCell(key, row)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* PAGINACIÓN */}
            <footer className="flex items-center justify-between gap-3 text-[13px] text-bm-steel">
              <span>Página <span className="bm-num font-semibold text-bm-ink">{currentPage}</span> de <span className="bm-num">{pages}</span></span>
              <div className="flex gap-2">
                <button type="button" disabled={currentPage <= 1 || loading} onClick={() => setPage(p => Math.max(1, Math.min(p, pages) - 1))}
                  className={bmBtn.icon} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" disabled={currentPage >= pages || loading} onClick={() => setPage(p => Math.min(pages, p + 1))}
                  className={bmBtn.icon} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </footer>

            {tieneCantidades && resumen.bajo > 0 && (
              <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
                {resumen.bajo === 1 ? '1 repuesto está' : `${resumen.bajo} repuestos están`} en o bajo el stock mínimo. Este archivo es de consulta: la reposición se gestiona desde Stock.
              </BmNotice>
            )}
          </>
        )}
      </main>
    </div>
  );
};
export default InventoryArchive;

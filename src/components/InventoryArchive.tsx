// Águilas Pilot — Inventario histórico (consulta independiente, sin modificar checkout)
// REQUIERE VITE_INVENTORY_TABLE con el nombre exacto de la tabla pública existente.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Loader2, Printer, RefreshCw, Search } from 'lucide-react';

type StockRow = Record<string, unknown>;
const TABLE = 'inventario_repuestos';
const PAGE = 500;
const DISPLAY = 25;
const LIMIT = 100000;
const label = (v: unknown): string => v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const safe = (v: unknown): string => label(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows(await loadInventory()); setPage(1); }
    catch (e) { setRows([]); setError(e instanceof Error ? e.message : 'No se pudo consultar inventario.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const columns = useMemo(() => Array.from(new Set(rows.flatMap(row => Object.keys(row)))), [rows]);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase('es');
    return needle ? rows.filter(row => Object.values(row).some(v => label(v).toLocaleLowerCase('es').includes(needle))) : rows;
  }, [rows, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / DISPLAY));
  const visible = filtered.slice((Math.min(page, pages) - 1) * DISPLAY, Math.min(page, pages) * DISPLAY);
  const printReport = () => {
    if (loading || error || !filtered.length) return;
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { setError('El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes.'); return; }
    const head = columns.map(key => `<th>${safe(key.replace(/_/g, ' '))}</th>`).join('');
    const body = filtered.map(row => `<tr>${columns.map(key => `<td>${safe(row[key])}</td>`).join('')}</tr>`).join('');
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Águilas Pilot — Inventario</title><style>
      @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#111;padding:16px}
      h1{font-size:18px}p{font-size:10px;color:#555}table{border-collapse:collapse;width:100%;font-size:9px}
      td,th{border:1px solid #ccc;padding:5px;overflow-wrap:anywhere;vertical-align:top;text-align:left}
      th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}
      </style></head><body><h1>ÁGUILAS PILOT — INVENTARIO</h1>
      <p>Generado: ${safe(new Date().toLocaleString('es-VE'))} · Registros incluidos: ${filtered.length} · Tabla: ${safe(TABLE)}</p>
      <p>Reporte de datos registrados en el sistema. No reemplaza una conciliación física de existencias.</p>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
    win.document.close();
    win.focus();
    // No imprimir automáticamente antes de que el navegador complete el documento.
    win.addEventListener('load', () => win.print(), { once: true });
    if (win.document.readyState === 'complete') win.print();
  };
  return (
    <main className="min-h-screen bg-[#050505] text-white p-5 md:p-9 space-y-6">
      <header className="flex flex-wrap gap-4 justify-between items-center">
        <button type="button" onClick={() => navigate('/', { state: { openTab: 'inventory' } })} className="inline-flex items-center gap-2 rounded-xl border border-[#E1AD01]/30 bg-[#E1AD01]/10 px-4 py-3 text-xs font-black uppercase text-[#E1AD01] hover:bg-[#E1AD01] hover:text-black transition-all"><ArrowLeft size={16}/> Volver a Stock</button>
        <div><p className="text-[10px] font-black tracking-[.25em] text-[#E1AD01] uppercase">Águilas Pilot · Stock</p>
          <h1 className="flex items-center gap-3 text-2xl font-black uppercase mt-2"><Archive className="text-[#E1AD01]"/> Archivo de Inventario</h1>
          <p className="text-xs text-zinc-500 mt-2">Consulta paginada e impresión de todos los registros filtrados, no solo la página visible.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-xl border border-white/15 px-4 py-3 text-xs font-bold flex gap-2 items-center disabled:opacity-50"><RefreshCw size={15}/> Actualizar</button>
          <button type="button" onClick={printReport} disabled={loading || !!error || !filtered.length} className="rounded-xl bg-[#E1AD01] text-black px-4 py-3 text-xs font-black flex gap-2 items-center disabled:opacity-50"><Printer size={15}/> Imprimir inventario</button>
        </div>
      </header>
      {error && <div role="alert" className="p-4 border border-red-500/30 bg-red-500/10 rounded-xl text-sm text-red-300">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex gap-2 items-center border border-white/15 bg-white/5 rounded-xl px-4 py-3 w-full md:w-96"><Search size={16} className="text-[#E1AD01]"/>
          <input value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} placeholder="Buscar en todo el inventario" className="bg-transparent outline-none w-full text-xs"/></label>
        <span className="text-xs text-zinc-400">{filtered.length} de {rows.length} registros</span>
      </div>
      <div className="border border-white/10 rounded-2xl overflow-x-auto bg-[#0b0b0b]">
        {loading ? <div className="flex gap-3 items-center justify-center p-20 text-zinc-400"><Loader2 className="animate-spin"/> Sincronizando inventario...</div>
          : <table className="w-full min-w-[800px] text-left text-xs"><thead><tr className="border-b border-white/10 bg-white/5">
            {columns.map(key => <th key={key} className="p-4 uppercase text-[10px] text-[#E1AD01] tracking-wider">{key.replace(/_/g, ' ')}</th>)}
            </tr></thead><tbody>{visible.map((row, i) => <tr key={String(row.id ?? `${page}-${i}`)} className="border-b border-white/5 hover:bg-white/[.03]">
              {columns.map(key => <td key={key} className="p-4 text-zinc-300 max-w-xs break-words">{label(row[key])}</td>)}
              </tr>)}</tbody></table>}
        {!loading && !visible.length && <div className="p-14 text-center text-zinc-500 text-sm">No hay registros para mostrar.</div>}
      </div>
      <footer className="flex items-center justify-between gap-3 text-xs text-zinc-400">
        <span>Página {Math.min(page, pages)} de {pages}</span>
        <div className="flex gap-2"><button disabled={page <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))} className="p-3 border border-white/15 rounded-lg disabled:opacity-30" aria-label="Página anterior"><ChevronLeft size={16}/></button>
          <button disabled={page >= pages || loading} onClick={() => setPage(p => Math.min(pages, p + 1))} className="p-3 border border-white/15 rounded-lg disabled:opacity-30" aria-label="Página siguiente"><ChevronRight size={16}/></button></div>
      </footer>
    </main>
  );
};
export default InventoryArchive;

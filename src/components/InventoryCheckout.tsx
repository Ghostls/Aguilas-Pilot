// src/components/InventoryCheckout.tsx
// VALKYRON OS v2.2 — Salidas de repuestos · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.2 — REBRAND B&M + CONEXIONES:
//   [FIX] Histórico colgado: fetchHistory corría dentro de init() después de
//         auth.getUser() sin manejo de errores; si getUser fallaba (red), el
//         histórico quedaba "Cargando…" para siempre. Ahora carga en paralelo.
//   [FIX] Nombre del técnico desde AuthContext; respaldo a `perfiles` con
//         .maybeSingle() (antes .single() → 406 si el perfil no tenía fila).
//   [FIX] Errores de carga separados del error del formulario. Antes, cerrar el
//         modal borraba el error de carga y habilitaba "Imprimir" con datos
//         vacíos (un reporte falso). Ahora cada carga muestra su aviso con
//         Reintentar y la impresión se bloquea hasta cargar bien.
//   [FIX] Despacho con control de concurrencia: el descuento solo se aplica si
//         el stock en BD sigue siendo el leído (.eq('cantidad', …)); si otro
//         despacho lo cambió, no se pisa y se recarga el inventario. Si falla el
//         registro del movimiento, se revierte el descuento (antes quedaba stock
//         descontado sin traza).
//   [FIX] Estado de aeronave legible: la BD usa operational/maintenance y el
//         color esperaba OPERATIVA/MANTENIMIENTO (nunca coincidía).
//   [FIX] Firma con Pointer Events (mouse, dedo y lápiz). Antes preventDefault en
//         eventos táctiles pasivos de React generaba advertencias en consola.
//   [FIX] Sugerencias limitadas a 50 resultados y operables con teclado.
//   [UI]  Estética B&M (bm-ui), modal como hoja inferior en móvil, reportes
//         impresos con encabezado B&M.
// PRESERVADO ÍNTEGRO (v2.1): lecturas por lotes (500, máx. 100 000), histórico
//   OUTBOUND agrupado por aeronave con paginación de 12 grupos, criticidad
//   (1.618 · ln(1 + min/q) · e^-0.05), autocompletado, firma obligatoria,
//   inserción en transacciones_inventario con el mismo formato de notas,
//   onCheckoutSuccess, impresión de existencias e histórico.
// ─────────────────────────────────────────────────────────────────────────────
// VALKYRON OS v2.1 — Histórico completo, impresión y paginación segura
// NUEVO: Flota desde Supabase (todas) · Firma digital del técnico · Historial agrupado por aeronave

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { InventoryLog, HangarLocation } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import {
  BmModal, BmField, BmSelect, BmBadge, BmEmpty, BmNotice,
  bmInput, bmBtn, type BmTone,
} from './brand/bm-ui';
import {
  PlusCircle, X, ArrowRightLeft, AlertTriangle,
  Database, Search, Loader2, RefreshCw, Plane,
  ChevronDown, ChevronUp, Pen, CheckCircle2, Eraser, Printer, ChevronLeft, ChevronRight
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface InventarioRow {
  id: string;
  numero_parte: string;
  nombre: string;
  cantidad: number;
  stock_minimo: number;
  ubicacion_hangar: HangarLocation;
}

interface AeronaveRow {
  id: string;
  matricula: string;
  modelo: string;
  estado: string;
}

interface InventoryCheckoutProps {
  onCheckoutSuccess?: (partNumber: string, quantity: number, aircraftId: string) => void;
  selectedAircraft?: string;
}

// Supabase/PostgREST normalmente limita las respuestas a 1000 registros.
// Consultamos por lotes con orden estable, y fallamos si se supera el límite
// de seguridad, en lugar de presentar un histórico parcialmente cargado.
const BATCH_SIZE = 500;
const MAX_ROWS = 100000;
const HISTORY_GROUPS_PER_PAGE = 12;
const MAX_SUGGESTIONS = 50; // [v2.2]

const printable = (v: unknown): string => String(v ?? '—')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function readAllInventory(): Promise<InventarioRow[]> {
  const result: InventarioRow[] = [];
  for (let start = 0; start < MAX_ROWS; start += BATCH_SIZE) {
    const { data, error } = await supabase.from('inventario_repuestos')
      .select('id,numero_parte,nombre,cantidad,stock_minimo,ubicacion_hangar')
      .order('nombre', { ascending: true }).order('id', { ascending: true })
      .range(start, start + BATCH_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as InventarioRow[];
    result.push(...batch);
    if (batch.length < BATCH_SIZE) return result;
  }
  throw new Error(`Inventario mayor de ${MAX_ROWS} registros: requiere paginación en servidor.`);
}

async function readAllOutbound(): Promise<InventoryLog[]> {
  const result: InventoryLog[] = [];
  for (let start = 0; start < MAX_ROWS; start += BATCH_SIZE) {
    const { data, error } = await supabase.from('transacciones_inventario')
      .select('*').eq('tipo_movimiento', 'OUTBOUND')
      .order('fecha', { ascending: false }).order('id', { ascending: false })
      .range(start, start + BATCH_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    result.push(...batch.map((t: any) => ({
      id: t.id, partNumber: t.item_id, description: t.item_name,
      quantity: t.cantidad, dispatchedBy: t.tecnico,
      assignedAircraft: typeof t.notas === 'string'
        ? (t.notas.match(/Despacho para Aeronave:\s*(.*?)\.\s*Firma:/i)?.[1]?.trim() || 'S/N')
        : 'S/N',
      timestamp: new Date(t.fecha), location: t.ubicacion as HangarLocation,
      serialNumberOut: t.item_id?.slice(0, 8) || 'N/A',
    })));
    if (batch.length < BATCH_SIZE) return result;
  }
  throw new Error(`Histórico mayor de ${MAX_ROWS} movimientos: requiere paginación en servidor.`);
}

function printDocument(title: string, headers: string[], rows: Array<Array<unknown>>) {
  const win = window.open('', '_blank', 'width=1200,height=900');
  if (!win) throw new Error('El navegador bloqueó la ventana de impresión.');
  const head = headers.map(h => `<th>${printable(h)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(v => `<td>${printable(v)}</td>`).join('')}</tr>`).join('');
  // [v2.2] Encabezado B&M (rojo #D42125 en lugar de dorado)
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>${printable(title)}</title><style>
    @page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;color:#1b1d22;padding:12px}
    h1{font-size:18px;border-bottom:3px solid #d42125;padding-bottom:12px}p{font-size:10px;color:#5f6670}
    table{width:100%;border-collapse:collapse;font-size:9px}td,th{padding:6px;text-align:left;border:1px solid #c9ccd2;overflow-wrap:anywhere}
    th{background:#f2f3f5}thead{display:table-header-group}tr{break-inside:avoid}
    </style></head><body><h1>${printable(title)}</h1><p>Generado: ${printable(new Date().toLocaleString('es-VE'))} · Registros: ${rows.length}</p>
    <p>Reporte administrativo. No sustituye la verificación física ni documentación técnica firmada.</p>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

// ── Helpers CSS ───────────────────────────────────────────────────────────────

const INPUT_CLS = `${bmInput} uppercase placeholder:normal-case`;

// [FIX v2.2] La BD guarda operational / maintenance / grounded / flight.
const estadoAeronave = (estado: string): { label: string; tone: BmTone } => {
  const s = String(estado ?? '').toLowerCase();
  if (s.includes('operational') || s.includes('operativ'))     return { label: 'Operativa',         tone: 'ok' };
  if (s.includes('maintenance') || s.includes('mantenimiento')) return { label: 'En mantenimiento',  tone: 'warn' };
  if (s.includes('flight') || s.includes('vuelo'))             return { label: 'En vuelo',          tone: 'info' };
  if (s.includes('grounded') || s.includes('tierra') || s.includes('aog') || s.includes('inactiv'))
    return { label: 'Fuera de servicio', tone: 'danger' };
  return { label: estado || 'Sin estado', tone: 'neutral' };
};

// Conservado por compatibilidad; ahora deriva del estado normalizado.
const estadoColor = (estado: string) => ({
  ok: 'text-bm-ok', warn: 'text-bm-warn', danger: 'text-bm-red', info: 'text-[#2F5BB7]',
  red: 'text-bm-red', neutral: 'text-bm-steel', dark: 'text-bm-ink',
}[estadoAeronave(estado).tone]);
void estadoColor;

// ── Componente firma digital ──────────────────────────────────────────────────

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear: () => void;
  hasSig: boolean;
}

/** [FIX v2.2] Pointer Events: mouse, dedo y lápiz con un solo flujo. */
const SignaturePad: React.FC<SignaturePadProps> = ({ onSave, onClear, hasSig }) => {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const hasStrokes = useRef(false);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    drawing.current = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* navegador sin captura */ }
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1B1D22';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    hasStrokes.current = true;
  };

  const stopDraw = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (e && canvas) { try { canvas.releasePointerCapture(e.pointerId); } catch { /* sin captura */ } }
    if (hasStrokes.current && canvas) {
      onSave(canvas.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    onClear();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-bm-ink">
          <Pen className="h-4 w-4 text-bm-red" /> Firma del técnico <span className="text-bm-red" aria-hidden="true">*</span>
        </span>
        <button type="button" onClick={clear}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-bm-steel transition-colors hover:bg-bm-canvas hover:text-bm-ink">
          <Eraser className="h-3.5 w-3.5" /> Limpiar
        </button>
      </div>
      <div className={`relative overflow-hidden rounded-xl border transition-colors ${hasSig ? 'border-bm-ok' : 'border-bm-field'}`}>
        {!hasSig && (
          <span className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-dashed border-bm-line" aria-hidden="true" />
        )}
        <canvas
          ref={canvasRef}
          width={460} height={120}
          aria-label="Área de firma del técnico"
          className="block h-[120px] w-full cursor-crosshair touch-none bg-white"
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={stopDraw}
          onPointerCancel={stopDraw}
          onPointerLeave={stopDraw}
        />
      </div>
      {hasSig ? (
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-bm-ok">
          <CheckCircle2 className="h-3.5 w-3.5" /> Firma capturada
        </p>
      ) : (
        <p className="text-[13px] text-bm-steel">
          Firme con el dedo, el lápiz o el mouse sobre la línea.
        </p>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
export const InventoryCheckout: React.FC<InventoryCheckoutProps> = ({
  onCheckoutSuccess,
  selectedAircraft,
}) => {
  const { profile } = useAuth(); // [v2.2]

  // ── State ──────────────────────────────────────────────────────────────────
  const [isAdding, setIsAdding]                 = useState(false);
  const [history, setHistory]                   = useState<InventoryLog[]>([]);
  const [error, setError]                       = useState<string | null>(null);
  const [searchTerm, setSearchTerm]             = useState('');
  const [loading, setLoading]                   = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [currentUser, setCurrentUser]           = useState(profile?.nombre_completo || 'Operador Sistema');
  const [inventory, setInventory]               = useState<InventarioRow[]>([]);
  const [flota, setFlota]                       = useState<AeronaveRow[]>([]);
  const [flotaLoading, setFlotaLoading]         = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  // [FIX v2.2] Errores de carga independientes del error del formulario
  const [inventoryError, setInventoryError]     = useState<string | null>(null);
  const [historyError, setHistoryError]         = useState<string | null>(null);

  // Historial — grupos expandibles
  const [expandedAircraft, setExpandedAircraft] = useState<Set<string>>(new Set());
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [formData, setFormData] = useState({
    partNumber:       '',
    description:      '',
    quantity:         1,
    assignedAircraft: selectedAircraft || '',
    location:         'Lara',
  });

  // ── Fetch inventario ───────────────────────────────────────────────────────
  const fetchInventory = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError(null);
    try { setInventory(await readAllInventory()); }
    catch (err: unknown) {
      setInventory([]);
      setInventoryError(`No se pudo cargar el inventario: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setInventoryLoading(false); }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await readAllOutbound());
      setHistoryPage(1);
    } catch (err: unknown) {
      setHistory([]);
      setHistoryError(`No se pudo cargar el histórico: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setHistoryLoading(false); }
  }, []);

  // ── Fetch flota desde Supabase ─────────────────────────────────────────────
  const fetchFlota = useCallback(async () => {
    setFlotaLoading(true);
    try {
      const { data, error: e } = await supabase
        .from('flota_aviones')
        .select('id,matricula,modelo,estado')
        .order('matricula', { ascending: true });
      if (e) throw e;
      setFlota(data ?? []);
    } catch (err: any) {
      console.error('[CHECKOUT] Error cargando flota:', err.message);
    } finally {
      setFlotaLoading(false);
    }
  }, []);

  // [v2.2] Nombre del técnico desde AuthContext cuando esté disponible
  useEffect(() => {
    if (profile?.nombre_completo) setCurrentUser(profile.nombre_completo);
  }, [profile?.nombre_completo]);

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Respaldo: nombre desde `perfiles` si AuthContext aún no lo trae.
    // [FIX v2.2] .maybeSingle() y errores capturados: nunca bloquea las cargas.
    const init = async () => {
      try {
        if (profile?.nombre_completo) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: prof } = await supabase
            .from('perfiles')
            .select('nombre_completo')
            .eq('id', user.id)
            .maybeSingle();
          if (prof?.nombre_completo) setCurrentUser(prof.nombre_completo);
        }
      } catch (err) {
        console.warn('[CHECKOUT] Perfil no disponible:', err instanceof Error ? err.message : err);
      }
    };
    void init();
    // [FIX v2.2] El histórico ya no depende de que getUser responda.
    void fetchHistory();
    void fetchInventory();
    void fetchFlota();
  }, [fetchInventory, fetchFlota, fetchHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autocomplete ───────────────────────────────────────────────────────────
  const sugerencias = useMemo(() => {
    if (!searchTerm || formData.partNumber) return [];
    const term = searchTerm.toLowerCase();
    return inventory.filter(
      item =>
        item.nombre.toLowerCase().includes(term) ||
        item.numero_parte.toLowerCase().includes(term)
    ).slice(0, MAX_SUGGESTIONS);
  }, [searchTerm, inventory, formData.partNumber]);

  const handleSelectItem = (item: InventarioRow) => {
    setFormData({ ...formData, partNumber: item.numero_parte.toUpperCase(), description: item.nombre, location: item.ubicacion_hangar });
    setSearchTerm(item.nombre);
  };

  const selectedItem = useMemo(
    () => inventory.find(i => i.numero_parte.toUpperCase() === formData.partNumber.toUpperCase()),
    [inventory, formData.partNumber],
  );

  // ── Checkout ───────────────────────────────────────────────────────────────
  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!signatureDataUrl) {
      setError('Se requiere la firma digital del técnico para autorizar el despacho.');
      return;
    }

    setLoading(true);
    const normalizedPN = formData.partNumber.toUpperCase();
    const targetItem   = inventory.find(i => i.numero_parte.toUpperCase() === normalizedPN);

    if (!targetItem) {
      setError(`P/N [${normalizedPN}] no localizado en inventario.`);
      setLoading(false);
      return;
    }
    if (formData.quantity > targetItem.cantidad) {
      setError(`Stock insuficiente. Disponible: ${targetItem.cantidad} unidades.`);
      setLoading(false);
      return;
    }

    try {
      // Valor leído antes de escribir: base del control de concurrencia y de la reversión.
      const cantidadLeida = targetItem.cantidad;
      const nuevaCantidad = cantidadLeida - formData.quantity;

      // [FIX v2.2] Concurrencia optimista: solo descuenta si el stock en BD
      // sigue siendo el que se leyó. count = filas afectadas (0 = conflicto).
      const { error: updateError, count } = await supabase
        .from('inventario_repuestos')
        .update({ cantidad: nuevaCantidad }, { count: 'exact' })
        .eq('id', targetItem.id)
        .eq('cantidad', cantidadLeida);
      if (updateError) throw updateError;
      if (count === 0) {
        void fetchInventory();
        throw new Error(
          'El stock de este P/N cambió mientras se preparaba la salida (otro despacho o un ajuste). ' +
          'Se recargó el inventario: revise la cantidad disponible y vuelva a autorizar.'
        );
      }

      const { data: txData, error: txError } = await supabase
        .from('transacciones_inventario')
        .insert([{
          tipo_movimiento: 'OUTBOUND',
          item_id:         normalizedPN,
          item_name:       formData.description,
          cantidad:        formData.quantity,
          tecnico:         currentUser,
          ubicacion:       targetItem.ubicacion_hangar,
          notas:           `Despacho para Aeronave: ${formData.assignedAircraft}. Firma: CAPTURADA`,
        }])
        .select()
        .single();
      if (txError) {
        // [FIX v2.2] Compensación: sin movimiento registrado no debe quedar stock descontado.
        const { error: revertError } = await supabase
          .from('inventario_repuestos')
          .update({ cantidad: cantidadLeida })
          .eq('id', targetItem.id)
          .eq('cantidad', nuevaCantidad);
        throw new Error(revertError
          ? `No se registró el movimiento (${txError.message}) y no se pudo revertir el stock ` +
            `(${revertError.message}). Avise a administración: ${normalizedPN} quedó descontado sin registro.`
          : `No se registró el movimiento (${txError.message}). El stock se restauró; no hubo despacho.`);
      }

      onCheckoutSuccess?.(normalizedPN, formData.quantity, formData.assignedAircraft);

      setInventory(prev =>
        prev.map(i => i.id === targetItem.id ? { ...i, cantidad: i.cantidad - formData.quantity } : i)
      );

      const newEntry: InventoryLog = {
        id:               txData.id,
        partNumber:       normalizedPN,
        description:      formData.description,
        quantity:         formData.quantity,
        assignedAircraft: formData.assignedAircraft,
        dispatchedBy:     currentUser,
        timestamp:        new Date(txData.fecha),
        location:         targetItem.ubicacion_hangar as HangarLocation,
        serialNumberOut:  normalizedPN.slice(0, 8),
      };
      setHistory(prev => [newEntry, ...prev]);

      // Auto-expandir la aeronave recién despachada
      setExpandedAircraft(prev => new Set([...prev, formData.assignedAircraft]));

      setIsAdding(false);
      setSearchTerm('');
      setSignatureDataUrl(null);
      setFormData(prev => ({ ...prev, partNumber: '', description: '', quantity: 1 }));

    } catch (err: any) {
      setError(`No se pudo autorizar el despacho: ${err?.message ?? 'error desconocido'}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Criticidad ─────────────────────────────────────────────────────────────
  const calcularCriticidad = (cantidad: number, minimo: number) => {
    const q = cantidad <= 0 ? Number.EPSILON : cantidad;
    return 1.618 * Math.log(1 + (minimo / q)) * Math.exp(-0.05);
  };

  const criticalItems = useMemo(
    () => [...inventory]
      .sort((a, b) =>
        calcularCriticidad(b.cantidad, b.stock_minimo || 1) -
        calcularCriticidad(a.cantidad, a.stock_minimo || 1)
      )
      .slice(0, 3),
    [inventory]
  );

  // ── Historial agrupado por aeronave ────────────────────────────────────────
  const historialPorAeronave = useMemo(() => {
    const map = new Map<string, InventoryLog[]>();
    history.forEach(entry => {
      const key = entry.assignedAircraft || 'S/N';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    });
    // Ordenar grupos por el timestamp del movimiento más reciente
    return [...map.entries()].sort(
      (a, b) => new Date(b[1][0].timestamp).getTime() - new Date(a[1][0].timestamp).getTime()
    );
  }, [history]);

  const historyPages = Math.max(1, Math.ceil(historialPorAeronave.length / HISTORY_GROUPS_PER_PAGE));
  const paginatedHistory = historialPorAeronave.slice(
    (Math.min(historyPage, historyPages) - 1) * HISTORY_GROUPS_PER_PAGE,
    Math.min(historyPage, historyPages) * HISTORY_GROUPS_PER_PAGE,
  );

  const printStock = () => {
    if (inventoryLoading || inventoryError) return;
    try {
      printDocument('B&M MANTENIMIENTO AERONÁUTICO — EXISTENCIAS DE INVENTARIO',
        ['P/N', 'Descripción', 'Existencias', 'Stock mínimo', 'Ubicación'],
        inventory.map(i => [i.numero_parte, i.nombre, i.cantidad, i.stock_minimo, i.ubicacion_hangar]));
    } catch (e) { setInventoryError(e instanceof Error ? e.message : String(e)); }
  };
  const printHistory = () => {
    if (historyLoading || historyError) return;
    try {
      printDocument('B&M MANTENIMIENTO AERONÁUTICO — HISTÓRICO DE DESPACHOS',
        ['Fecha', 'Aeronave', 'P/N', 'Descripción', 'Cantidad', 'Técnico', 'Sede'],
        history.map(h => [new Date(h.timestamp).toLocaleString('es-VE'), h.assignedAircraft,
          h.partNumber, h.description, h.quantity, h.dispatchedBy, h.location]));
    } catch (e) { setHistoryError(e instanceof Error ? e.message : String(e)); }
  };

  const toggleAircraft = (matricula: string) => {
    setExpandedAircraft(prev => {
      const next = new Set(prev);
      next.has(matricula) ? next.delete(matricula) : next.add(matricula);
      return next;
    });
  };

  // ── Aeronave info helper ───────────────────────────────────────────────────
  const getAeronaveInfo = (matricula: string) =>
    flota.find(a => a.matricula === matricula);

  const closeModal = () => { setIsAdding(false); setError(null); setSignatureDataUrl(null); };
  const allExpanded = historialPorAeronave.length > 0 && historialPorAeronave.every(([k]) => expandedAircraft.has(k));

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* ── Barra de herramientas ── */}
      <div className="flex flex-col gap-4 rounded-[24px] border border-bm-line bg-white p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Database className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="bm-heading text-lg leading-tight sm:text-xl">Despacho de repuestos</h2>
            <p className="mt-0.5 text-[13px] text-bm-steel">
              Salidas firmadas hacia aeronaves, operador: {currentUser}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-2 sm:flex sm:flex-wrap sm:items-center">
          <button type="button" onClick={() => { void fetchInventory(); void fetchFlota(); void fetchHistory(); }}
            className={bmBtn.icon} title="Recargar" aria-label="Recargar inventario, flota e histórico">
            <RefreshCw className={`h-4 w-4 ${inventoryLoading || flotaLoading || historyLoading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={printStock} disabled={inventoryLoading || !!inventoryError}
            className={`${bmBtn.secondary} ${bmBtn.sm}`}>
            <Printer className="h-4 w-4" /> Imprimir existencias
          </button>
          <button type="button" onClick={() => setIsAdding(true)}
            className={`${bmBtn.primary} col-span-2 sm:col-span-1`}>
            <PlusCircle className="h-5 w-5" /> Generar salida
          </button>
        </div>
      </div>

      {inventoryError && (
        <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{inventoryError}. No se puede imprimir ni despachar hasta cargarlo.</span>
            <button type="button" onClick={() => void fetchInventory()} className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <RefreshCw className="h-4 w-4" /> Reintentar
            </button>
          </div>
        </BmNotice>
      )}

      {/* ── Prioridad de reposición (criticidad) ── */}
      <section aria-labelledby="chk-criticos">
        <h3 id="chk-criticos" className="mb-2 px-1 text-sm font-semibold text-bm-steel">Prioridad de reposición</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {inventoryLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bm-skeleton h-[118px] rounded-[20px]" />
              ))
            : criticalItems.map(item => {
                const bajo = item.cantidad <= item.stock_minimo;
                return (
                  <div key={item.id}
                    className={`rounded-[20px] border bg-white p-4 sm:p-5 ${bajo ? 'border-bm-red/30' : 'border-bm-line'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate font-data text-xs text-bm-steel">{item.numero_parte}</span>
                      {bajo && (
                        <BmBadge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Bajo mínimo</BmBadge>
                      )}
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <p className={`bm-figure text-[34px] ${bajo ? 'text-bm-red' : 'text-bm-ink'}`}>{item.cantidad}</p>
                      <p className="text-xs text-bm-steel">unidades, mínimo {item.stock_minimo}</p>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium uppercase">{item.nombre}</p>
                  </div>
                );
              })
          }
          {!inventoryLoading && criticalItems.length === 0 && !inventoryError && (
            <p className="col-span-full rounded-[20px] border border-dashed border-bm-line bg-white px-4 py-6 text-center text-sm text-bm-steel">
              Sin repuestos en inventario.
            </p>
          )}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          MODAL DE EGRESO
      ══════════════════════════════════════════════════════ */}
      <BmModal
        open={isAdding}
        onClose={closeModal}
        busy={loading}
        title="Salida de repuesto"
        subtitle="Despacho firmado hacia una aeronave"
        icon={<Search className="h-5 w-5" />}
        tone="red"
        z={100}
      >
        <form onSubmit={handleCheckout} className="space-y-5">

          {error && (
            <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
              {error}
            </BmNotice>
          )}

          {/* ── Búsqueda de repuesto ── */}
          <div className="relative">
            <BmField label="Componente o P/N" htmlFor="chk-buscar" required>
              <div className="relative">
                <input id="chk-buscar" type="text" required className={`${INPUT_CLS} pl-11`}
                  value={searchTerm}
                  autoComplete="off"
                  disabled={inventoryLoading || !!inventoryError}
                  onChange={e => {
                    setSearchTerm(e.target.value);
                    if (formData.partNumber) setFormData({ ...formData, partNumber: '', description: '' });
                  }}
                  placeholder={inventoryLoading ? 'Cargando inventario…' : 'Buscar por nombre o P/N'}
                />
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
              </div>
            </BmField>
            {sugerencias.length > 0 && (
              <ul role="listbox" aria-label="Repuestos encontrados"
                className="absolute z-[110] mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-bm-line bg-white shadow-bm-pop">
                {sugerencias.map(item => (
                  <li key={item.id}>
                    <button type="button" onClick={() => handleSelectItem(item)}
                      className="w-full border-b border-bm-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-bm-red-tint focus:bg-bm-red-tint focus:outline-none">
                      <p className="text-sm font-semibold uppercase">{item.nombre}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-bm-steel">
                        <span className="font-data">{item.numero_parte}</span>
                        <span>Stock {item.cantidad}</span>
                        <span>{item.ubicacion_hangar}</span>
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* P/N confirmado */}
          {formData.partNumber && (
            <div className="flex items-center gap-3 rounded-xl border border-bm-ok/25 bg-bm-ok-tint px-3.5 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-bm-ok" />
              <div className="min-w-0 text-sm">
                <p className="truncate font-semibold uppercase">{formData.description}</p>
                <p className="text-xs text-bm-steel">
                  <span className="font-data">{formData.partNumber}</span>
                  {selectedItem && <> · disponible {selectedItem.cantidad}</>}
                </p>
              </div>
            </div>
          )}

          {/* ── Cantidad + Aeronave destino ── */}
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <BmField label="Cantidad" htmlFor="chk-cantidad" required>
              <input id="chk-cantidad" type="number" min="1" required inputMode="numeric"
                className={`${bmInput} bm-num text-lg font-semibold`}
                value={formData.quantity}
                onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
              />
            </BmField>
            <BmField label="Aeronave destino" htmlFor="chk-aeronave" required>
              {flotaLoading ? (
                <div className="flex h-12 items-center justify-center rounded-xl border border-bm-field bg-bm-canvas">
                  <Loader2 className="h-4 w-4 animate-spin text-bm-red" />
                </div>
              ) : (
                <BmSelect id="chk-aeronave" required
                  value={formData.assignedAircraft}
                  onChange={e => setFormData({ ...formData, assignedAircraft: e.target.value })}
                >
                  <option value="">Seleccione la aeronave</option>
                  {flota.map(a => (
                    <option key={a.id} value={a.matricula}>
                      {a.matricula} · {a.modelo} ({estadoAeronave(a.estado).label})
                    </option>
                  ))}
                </BmSelect>
              )}
            </BmField>
          </div>

          {/* ── Aeronave preview chip ── */}
          {formData.assignedAircraft && (() => {
            const info = getAeronaveInfo(formData.assignedAircraft);
            if (!info) return null;
            const est = estadoAeronave(info.estado);
            return (
              <div className="flex items-center gap-3 rounded-xl bg-bm-canvas px-3.5 py-3">
                <Plane className="h-4 w-4 shrink-0 text-bm-red" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{info.matricula} · {info.modelo}</p>
                <BmBadge tone={est.tone} dot>{est.label}</BmBadge>
              </div>
            );
          })()}

          {/* ── Firma digital ── */}
          <SignaturePad
            onSave={url => setSignatureDataUrl(url)}
            onClear={() => setSignatureDataUrl(null)}
            hasSig={!!signatureDataUrl}
          />

          <button type="submit"
            disabled={!formData.partNumber || !formData.assignedAircraft || loading}
            className={`${bmBtn.primary} w-full`}>
            {loading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Procesando…</>
              : <><CheckCircle2 className="h-4 w-4" /> Autorizar despacho</>
            }
          </button>
        </form>
      </BmModal>

      {/* ══════════════════════════════════════════════════════
          HISTORIAL AGRUPADO POR AERONAVE
      ══════════════════════════════════════════════════════ */}
      <section aria-labelledby="chk-historial" className="space-y-3">
        <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 id="chk-historial" className="bm-heading flex items-center gap-2 text-lg">
            <ArrowRightLeft className="h-5 w-5 text-bm-red" />
            Despachos por aeronave
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {historialPorAeronave.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const allKeys = historialPorAeronave.map(([k]) => k);
                  setExpandedAircraft(allExpanded ? new Set() : new Set(allKeys));
                }}
                className={`${bmBtn.ghost} ${bmBtn.sm}`}>
                {allExpanded ? 'Contraer todo' : 'Expandir todo'}
              </button>
            )}
            <button type="button" onClick={printHistory} disabled={historyLoading || !!historyError}
              className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <Printer className="h-4 w-4" /> Imprimir histórico ({history.length})
            </button>
          </div>
        </div>

        {historyError && (
          <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{historyError}</span>
              <button type="button" onClick={() => void fetchHistory()} className={`${bmBtn.secondary} ${bmBtn.sm}`}>
                <RefreshCw className="h-4 w-4" /> Reintentar
              </button>
            </div>
          </BmNotice>
        )}

        {historyLoading ? (
          <div className="flex items-center justify-center gap-3 rounded-[24px] border border-bm-line bg-white p-12 text-sm text-bm-steel" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Cargando histórico completo…
          </div>
        ) : historialPorAeronave.length === 0 ? (
          !historyError && (
            <div className="rounded-[24px] border border-dashed border-bm-line bg-white">
              <BmEmpty
                icon={<ArrowRightLeft className="h-5 w-5" />}
                title="Sin despachos registrados"
                text="Las salidas autorizadas aparecerán aquí agrupadas por aeronave."
              />
            </div>
          )
        ) : (
          <div className="space-y-2.5">
            {paginatedHistory.map(([matricula, entries]) => {
              const info      = getAeronaveInfo(matricula);
              const expanded  = expandedAircraft.has(matricula);
              const totalPiezas = entries.reduce((s, e) => s + e.quantity, 0);
              const est = info ? estadoAeronave(info.estado) : null;

              return (
                <div key={matricula}
                  className="overflow-hidden rounded-[20px] border border-bm-line bg-white">

                  {/* ── Header del grupo ── */}
                  <button type="button"
                    onClick={() => toggleAircraft(matricula)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-bm-canvas/60 sm:p-5">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-bm-red-tint text-bm-red">
                        <Plane className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <span className="bm-heading text-base">{matricula}</span>
                          {info && <span className="text-[13px] text-bm-steel">{info.modelo}</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bm-steel">
                          {est && <BmBadge tone={est.tone} dot className="!py-0.5">{est.label}</BmBadge>}
                          <span>{entries.length} mov., {totalPiezas} piezas</span>
                          <span>Último {new Date(entries[0].timestamp).toLocaleDateString('es-VE')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="bm-num hidden rounded-full bg-bm-canvas px-2.5 py-1 text-xs font-semibold sm:inline">
                        ×{totalPiezas}
                      </span>
                      {expanded
                        ? <ChevronUp className="h-5 w-5 text-bm-steel" />
                        : <ChevronDown className="h-5 w-5 text-bm-steel" />
                      }
                    </div>
                  </button>

                  {/* ── Movimientos del grupo ── */}
                  {expanded && (
                    <ul className="divide-y divide-bm-line border-t border-bm-line">
                      {entries.map(entry => (
                        <li key={entry.id}
                          className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-data text-[13px] font-medium">{entry.partNumber}</span>
                              <span className="bm-num text-sm font-semibold text-bm-red">×{entry.quantity}</span>
                            </p>
                            <p className="mt-0.5 truncate text-sm text-bm-steel">{entry.description}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bm-steel sm:flex-col sm:items-end">
                            <span className="font-medium text-bm-ink">{entry.dispatchedBy}</span>
                            <span>{new Date(entry.timestamp).toLocaleString('es-VE')}</span>
                            <BmBadge tone="ok" className="!py-0.5">Registrado</BmBadge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {historialPorAeronave.length > HISTORY_GROUPS_PER_PAGE && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-bm-line bg-white px-4 py-2.5 text-[13px] text-bm-steel">
            <span>{historialPorAeronave.length} aeronaves, página {historyPage} de {historyPages}</span>
            <div className="flex gap-2">
              <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => Math.max(1,p-1))}
                className={bmBtn.icon} aria-label="Página anterior"><ChevronLeft className="h-4 w-4"/></button>
              <button type="button" disabled={historyPage >= historyPages} onClick={() => setHistoryPage(p => Math.min(historyPages,p+1))}
                className={bmBtn.icon} aria-label="Página siguiente"><ChevronRight className="h-4 w-4"/></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

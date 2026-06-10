// src/components/InventoryCheckout.tsx
// VALKYRON OS v2.0 — Grado Militar
// NUEVO: Flota desde Supabase (todas) · Firma digital del técnico · Historial agrupado por aeronave

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { InventoryLog, HangarLocation } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  PlusCircle, X, ArrowRightLeft, AlertTriangle,
  Database, Search, Loader2, RefreshCw, Plane,
  ChevronDown, ChevronUp, Pen, CheckCircle2, Eraser
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

// ── Helpers CSS ───────────────────────────────────────────────────────────────

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20`;

const estadoColor = (estado: string) => {
  switch (estado?.toUpperCase()) {
    case 'OPERATIVA':    return 'text-green-400';
    case 'MANTENIMIENTO': return 'text-yellow-400';
    case 'INACTIVA':     return 'text-red-400';
    default:             return 'text-slate-500';
  }
};

// ── Componente firma digital ──────────────────────────────────────────────────

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear: () => void;
  hasSig: boolean;
}

const SignaturePad: React.FC<SignaturePadProps> = ({ onSave, onClear, hasSig }) => {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const drawing    = useRef(false);
  const hasStrokes = useRef(false);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top)  * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    drawing.current = true;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#E1AD01';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    hasStrokes.current = true;
    e.preventDefault();
  };

  const stopDraw = () => {
    drawing.current = false;
    if (hasStrokes.current && canvasRef.current) {
      onSave(canvasRef.current.toDataURL('image/png'));
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest flex items-center gap-1">
          <Pen size={10} /> Firma Digital del Técnico *
        </label>
        <button type="button" onClick={clear}
          className="flex items-center gap-1 text-[8px] text-slate-600 hover:text-white transition-all">
          <Eraser size={10} /> Limpiar
        </button>
      </div>
      <div className={`rounded-xl border transition-all overflow-hidden ${hasSig ? 'border-[#E1AD01]/40' : 'border-white/10'}`}>
        <canvas
          ref={canvasRef}
          width={460} height={120}
          className="w-full h-[90px] bg-black/60 cursor-crosshair touch-none block"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
      </div>
      {hasSig && (
        <p className="text-[8px] text-[#E1AD01]/60 font-black uppercase tracking-widest flex items-center gap-1">
          <CheckCircle2 size={9} /> Firma capturada
        </p>
      )}
      {!hasSig && (
        <p className="text-[8px] text-slate-700 font-black uppercase tracking-widest">
          Firma con el mouse o dedo en el área superior
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
  // ── State ──────────────────────────────────────────────────────────────────
  const [isAdding, setIsAdding]                 = useState(false);
  const [history, setHistory]                   = useState<InventoryLog[]>([]);
  const [error, setError]                       = useState<string | null>(null);
  const [searchTerm, setSearchTerm]             = useState('');
  const [loading, setLoading]                   = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [currentUser, setCurrentUser]           = useState('Operador Sistema');
  const [inventory, setInventory]               = useState<InventarioRow[]>([]);
  const [flota, setFlota]                       = useState<AeronaveRow[]>([]);
  const [flotaLoading, setFlotaLoading]         = useState(true);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  // Historial — grupos expandibles
  const [expandedAircraft, setExpandedAircraft] = useState<Set<string>>(new Set());

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
    try {
      const { data, error: e } = await supabase
        .from('inventario_repuestos')
        .select('id,numero_parte,nombre,cantidad,stock_minimo,ubicacion_hangar')
        .order('nombre', { ascending: true });
      if (e) throw e;
      setInventory(data ?? []);
    } catch (err: any) {
      setError(`ERROR CARGANDO INVENTARIO: ${err.message}`);
    } finally {
      setInventoryLoading(false);
    }
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

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase
          .from('perfiles')
          .select('nombre_completo')
          .eq('id', user.id)
          .single();
        if (prof) setCurrentUser(prof.nombre_completo);
      }
      const { data, error: histError } = await supabase
        .from('transacciones_inventario')
        .select('*')
        .eq('tipo_movimiento', 'OUTBOUND')
        .order('fecha', { ascending: false })
        .limit(50);
      if (!histError && data) {
        setHistory(
          data.map((t: any) => ({
            id:               t.id,
            partNumber:       t.item_id,
            description:      t.item_name,
            quantity:         t.cantidad,
            assignedAircraft: t.notas?.includes(': ') ? t.notas.split(': ')[1].split('.')[0] : 'S/N',
            dispatchedBy:     t.tecnico,
            timestamp:        new Date(t.fecha),
            location:         t.ubicacion as HangarLocation,
            serialNumberOut:  t.item_id?.slice(0, 8) || 'N/A',
          }))
        );
      }
    };
    init();
    fetchInventory();
    fetchFlota();
  }, [fetchInventory, fetchFlota]);

  // ── Autocomplete ───────────────────────────────────────────────────────────
  const sugerencias = useMemo(() => {
    if (!searchTerm || formData.partNumber) return [];
    const term = searchTerm.toLowerCase();
    return inventory.filter(
      item =>
        item.nombre.toLowerCase().includes(term) ||
        item.numero_parte.toLowerCase().includes(term)
    );
  }, [searchTerm, inventory, formData.partNumber]);

  const handleSelectItem = (item: InventarioRow) => {
    setFormData({ ...formData, partNumber: item.numero_parte.toUpperCase(), description: item.nombre, location: item.ubicacion_hangar });
    setSearchTerm(item.nombre);
  };

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
      const { error: updateError } = await supabase
        .from('inventario_repuestos')
        .update({ cantidad: targetItem.cantidad - formData.quantity })
        .eq('id', targetItem.id);
      if (updateError) throw updateError;

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
      if (txError) throw txError;

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
      setError(`FALLA DE CONEXIÓN: ${err.message}`);
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

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left">

      {/* ── Status Cards criticidad ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {inventoryLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-5 rounded-2xl border border-white/5 bg-[#0f0f0f] animate-pulse h-24" />
            ))
          : criticalItems.map(item => (
              <div key={item.id}
                className={`p-5 rounded-2xl border backdrop-blur-xl transition-all ${
                  item.cantidad <= item.stock_minimo
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-[#0f0f0f] border-white/5 shadow-xl'
                }`}>
                <div className="flex justify-between items-start">
                  <span className="text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.2em]">
                    {item.numero_parte}
                  </span>
                  {item.cantidad <= item.stock_minimo && (
                    <AlertTriangle className="h-3 w-3 text-red-500 animate-pulse" />
                  )}
                </div>
                <div className="flex items-end gap-2 mt-2">
                  <p className="text-3xl font-black text-white font-mono leading-none">{item.cantidad}</p>
                  <p className="text-[8px] text-slate-500 font-black mb-1 uppercase">Units</p>
                </div>
                <p className="text-[9px] text-slate-500 uppercase mt-3 truncate font-mono">{item.nombre}</p>
              </div>
            ))
        }
      </div>

      {/* ── Header + Acciones ── */}
      <div className="flex justify-between items-center">
        <h2 className="text-[10px] font-black text-white flex items-center gap-3 uppercase tracking-[0.4em] italic">
          <Database className="h-4 w-4 text-[#E1AD01]" /> Logística de Despacho Técnico
        </h2>
        <div className="flex items-center gap-3">
          <button onClick={() => { fetchInventory(); fetchFlota(); }}
            className="border border-white/10 text-slate-400 px-4 py-3 rounded-xl
                       hover:border-[#E1AD01]/40 hover:text-[#E1AD01] transition-all"
            title="Recargar">
            <RefreshCw className={`h-4 w-4 ${inventoryLoading || flotaLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setIsAdding(true)}
            className="bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-[10px]
                       hover:bg-white transition-all shadow-xl active:scale-95 uppercase
                       tracking-widest flex items-center gap-2">
            <PlusCircle className="h-4 w-4" /> Generar Salida
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          MODAL DE EGRESO
      ══════════════════════════════════════════════════════ */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <Card className="bg-[#050505] border border-white/10 w-full max-w-lg rounded-[2rem]
                           overflow-hidden shadow-2xl max-h-[95vh] overflow-y-auto">
            <CardHeader className="bg-white/[0.02] border-b border-white/5 p-6 flex flex-row
                                   items-center justify-between sticky top-0 z-10 bg-[#050505]">
              <CardTitle className="text-[#E1AD01] text-[10px] font-black tracking-[0.4em]
                                    uppercase flex items-center gap-3">
                <Search className="h-4 w-4" /> Formulario de Egreso Aeronáutico
              </CardTitle>
              <button onClick={() => { setIsAdding(false); setError(null); setSignatureDataUrl(null); }}
                className="text-slate-500 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </CardHeader>

            <CardContent className="p-8">
              <form onSubmit={handleCheckout} className="space-y-6">

                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                    <p className="text-[9px] text-red-500 font-black uppercase">{error}</p>
                  </div>
                )}

                {/* ── Búsqueda de repuesto ── */}
                <div className="relative">
                  <label className="text-[8px] text-slate-600 font-black uppercase ml-1 block mb-1">
                    Componente / P/N *
                  </label>
                  <input type="text" required className={INPUT_CLS}
                    value={searchTerm}
                    onChange={e => {
                      setSearchTerm(e.target.value);
                      if (formData.partNumber) setFormData({ ...formData, partNumber: '', description: '' });
                    }}
                    placeholder="BUSCAR COMPONENTE O P/N..."
                  />
                  {sugerencias.length > 0 && (
                    <div className="absolute w-full mt-2 bg-[#0a0a0a] border border-white/10 rounded-xl
                                    shadow-2xl z-[110] max-h-48 overflow-y-auto">
                      {sugerencias.map(item => (
                        <div key={item.id} onClick={() => handleSelectItem(item)}
                          className="p-4 hover:bg-[#E1AD01] hover:text-black cursor-pointer text-left
                                     border-b border-white/5 last:border-0 transition-colors">
                          <p className="text-[10px] font-black uppercase">{item.nombre}</p>
                          <p className="text-[8px] opacity-60 font-mono">
                            P/N: {item.numero_parte} | STOCK: {item.cantidad} | {item.ubicacion_hangar}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* P/N confirmado */}
                {formData.partNumber && (
                  <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/20 p-3 rounded-xl flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-[#E1AD01] animate-pulse shrink-0" />
                    <p className="text-[9px] text-[#E1AD01] font-black uppercase font-mono">
                      P/N: {formData.partNumber} — {formData.description}
                    </p>
                  </div>
                )}

                {/* ── Cantidad + Aeronave destino ── */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[8px] text-slate-600 font-black uppercase ml-1 block">
                      Cantidad *
                    </label>
                    <input type="number" min="1" required
                      className={`${INPUT_CLS} text-2xl font-black`}
                      value={formData.quantity}
                      onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[8px] text-slate-600 font-black uppercase ml-1 block">
                      Aeronave Destino *
                    </label>
                    {flotaLoading ? (
                      <div className="flex items-center justify-center h-14 bg-black/40 rounded-xl border border-white/10">
                        <Loader2 className="h-4 w-4 animate-spin text-[#E1AD01]" />
                      </div>
                    ) : (
                      <select required
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4
                                   text-white text-[10px] font-black uppercase outline-none
                                   focus:border-[#E1AD01] transition-all
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        value={formData.assignedAircraft}
                        onChange={e => setFormData({ ...formData, assignedAircraft: e.target.value })}
                      >
                        <option value="">— SELECCIONAR —</option>
                        {flota.map(a => (
                          <option key={a.id} value={a.matricula}>
                            {a.matricula} · {a.modelo} [{a.estado}]
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* ── Aeronave preview chip ── */}
                {formData.assignedAircraft && (() => {
                  const info = getAeronaveInfo(formData.assignedAircraft);
                  return info ? (
                    <div className="flex items-center gap-3 bg-white/[0.03] border border-white/10
                                    rounded-xl p-3">
                      <Plane className="h-4 w-4 text-[#E1AD01] shrink-0" />
                      <div>
                        <p className="text-[10px] font-black text-white uppercase">{info.matricula} · {info.modelo}</p>
                        <p className={`text-[8px] font-black uppercase ${estadoColor(info.estado)}`}>
                          ● {info.estado}
                        </p>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* ── Firma digital ── */}
                <SignaturePad
                  onSave={url => setSignatureDataUrl(url)}
                  onClear={() => setSignatureDataUrl(null)}
                  hasSig={!!signatureDataUrl}
                />

                <button type="submit"
                  disabled={!formData.partNumber || !formData.assignedAircraft || loading}
                  className="w-full font-black py-5 rounded-2xl bg-[#E1AD01] text-black hover:bg-white
                             transition-all uppercase text-[10px] tracking-[0.4em]
                             disabled:opacity-40 disabled:cursor-not-allowed
                             flex items-center justify-center gap-3">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> PROCESANDO...</>
                    : 'AUTORIZAR DESPACHO'
                  }
                </button>

              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          HISTORIAL AGRUPADO POR AERONAVE
      ══════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-black text-slate-500 flex items-center gap-3
                         uppercase tracking-[0.5em] italic">
            <ArrowRightLeft className="h-4 w-4 text-[#E1AD01]" />
            Auditoría por Aeronave
          </h2>
          {historialPorAeronave.length > 0 && (
            <button
              onClick={() => {
                const allKeys = historialPorAeronave.map(([k]) => k);
                const allExpanded = allKeys.every(k => expandedAircraft.has(k));
                setExpandedAircraft(allExpanded ? new Set() : new Set(allKeys));
              }}
              className="text-[8px] text-slate-600 hover:text-[#E1AD01] font-black uppercase
                         tracking-widest transition-all">
              {historialPorAeronave.every(([k]) => expandedAircraft.has(k)) ? 'Colapsar todo' : 'Expandir todo'}
            </button>
          )}
        </div>

        {historialPorAeronave.length === 0 ? (
          <div className="p-20 text-center border-2 border-dashed border-white/5 rounded-[2rem]">
            <p className="text-slate-700 font-mono text-[10px] font-black uppercase tracking-[0.5em]">
              Esperando Transacciones...
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {historialPorAeronave.map(([matricula, entries]) => {
              const info      = getAeronaveInfo(matricula);
              const expanded  = expandedAircraft.has(matricula);
              const totalPiezas = entries.reduce((s, e) => s + e.quantity, 0);

              return (
                <div key={matricula}
                  className="bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden">

                  {/* ── Header del grupo ── */}
                  <button type="button"
                    onClick={() => toggleAircraft(matricula)}
                    className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-all text-left">
                    <div className="flex items-center gap-4">
                      <div className="p-2.5 rounded-xl bg-[#E1AD01]/10 border border-[#E1AD01]/20">
                        <Plane className="h-4 w-4 text-[#E1AD01]" />
                      </div>
                      <div>
                        <p className="text-white font-black uppercase text-[11px] tracking-widest">
                          {matricula}
                          {info && (
                            <span className="text-slate-500 font-normal text-[9px] ml-2 normal-case tracking-normal">
                              · {info.modelo}
                            </span>
                          )}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {info && (
                            <span className={`text-[8px] font-black uppercase ${estadoColor(info.estado)}`}>
                              ● {info.estado}
                            </span>
                          )}
                          <span className="text-[8px] text-slate-600 font-mono">
                            {entries.length} mov · {totalPiezas} piezas
                          </span>
                          <span className="text-[8px] text-slate-700 italic">
                            Último: {new Date(entries[0].timestamp).toLocaleDateString('es-VE')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[8px] font-black text-[#E1AD01] border border-[#E1AD01]/20
                                       bg-[#E1AD01]/5 px-3 py-1 rounded-full font-mono">
                        ×{totalPiezas}
                      </span>
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-slate-500" />
                        : <ChevronDown className="h-4 w-4 text-slate-500" />
                      }
                    </div>
                  </button>

                  {/* ── Movimientos del grupo ── */}
                  {expanded && (
                    <div className="border-t border-white/5 divide-y divide-white/[0.04]">
                      {entries.map(entry => (
                        <div key={entry.id}
                          className="px-5 py-4 flex justify-between items-center
                                     hover:bg-white/[0.015] transition-all">
                          <div className="flex items-center gap-4 font-mono">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#E1AD01]/40 shrink-0" />
                            <div>
                              <p className="text-white text-[10px] font-black uppercase">
                                {entry.partNumber}
                                <span className="text-[#E1AD01] mx-2 font-normal">×{entry.quantity}</span>
                              </p>
                              <p className="text-[8px] text-slate-500 mt-0.5 normal-case">
                                {entry.description}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[8px] text-slate-600 font-black uppercase">
                              {entry.dispatchedBy}
                            </p>
                            <p className="text-[7px] text-slate-700 mt-0.5">
                              {new Date(entry.timestamp).toLocaleString('es-VE')}
                            </p>
                            <span className="text-[7px] border border-green-500/20 bg-green-500/5
                                             px-2 py-0.5 rounded-full text-green-500 font-black
                                             uppercase tracking-widest">
                              VERIFICADO
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
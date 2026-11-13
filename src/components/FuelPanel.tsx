// src/components/FuelPanel.tsx
// Valkyron OS v4.4.1 — B&M Mantenimiento Aeronáutico
//
// v4.4.1 — CONEXIÓN CON REGISTRO DE VUELO (fase 6):
//   [FIX] El registro de vuelo en modo heredado (sin migración v18) escribe
//         movimientos 'OUT'. v4.4 los buscaba en TIPO_MOV y la bitácora se
//         caía con un tipo no previsto. Ahora OUT tiene su presentación y
//         cualquier otro tipo desconocido se muestra sin romper.
//   [FIX] Editar quedaba disponible para OUT y abría un formulario vacío que
//         reescribía el movimiento. Solo IN y TRANSFER son editables.
//   [KEEP] Regla de saldo sin cambios (IN, TRANSFER, BURN). OUT sigue sin
//         sumar al saldo, como en v4.3; se indica en la bitácora.
//
// v4.4 — REBRAND B&M + CONEXIONES:
//   [FIX] Saldos: se leían con un único SELECT y PostgREST corta en 1.000 filas,
//         así que con más movimientos los saldos por aeronave salían falsos.
//         Ahora se lee TODO por lotes de 500 con orden estable (created_at, id),
//         se deduplica por id y se ignoran respuestas obsoletas.
//   [FIX] Error de carga visible con "Reintentar" (antes solo console.error y la
//         bitácora decía "Sin movimientos registrados": un vacío falso).
//   [FIX] Editar una transferencia validaba contra nada; ahora el disponible de
//         la aeronave origen descuenta el efecto del propio registro editado.
//   [FIX] Hobbs vacío ya no viaja como NaN: se envía null.
//   [FIX] Volumen no válido (vacío / ≤ 0) se rechaza antes de escribir.
//   [UI]  Estética B&M (bm-ui). Confirmación de borrado en modal propio con el
//         saldo resultante (antes window.confirm). Bitácora en tarjetas (móvil) y
//         tabla (escritorio); Editar / Borrar siempre visibles (antes solo hover).
//         Auditor precargado con el nombre del perfil. [ÁGUILAS OPS] → [B&M OPS].
// PRESERVADO ÍNTEGRO (v4.3): arquitectura aeronave-almacén, tipos IN / TRANSFER /
//   BURN, presentaciones y cálculo de litros por unidad, filtro de proveedores
//   'Combustible', getAircraftId (matricula | tailNumber), umbral de saldo bajo,
//   payload de inserción / actualización, BURN no editable, últimos 30.
//
// v4.3: acepta tanto `matricula` como `tailNumber` en los objetos de flota
//       (compatibilidad con padre que pasa Supabase raw o mapeado)
// v4.2: tipo BURN — descuento automático por vuelo
// v4.1: filtro de proveedores a categoría 'Combustible'
// v4.0: arquitectura Aeronave como Almacén

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import {
  BmModal, BmField, BmSelect, BmBadge, BmEmpty, BmNotice,
  bmInput, bmBtn, bmIconTone, type BmTone,
} from './brand/bm-ui';
import {
  History, Loader2, ArrowDownToLine, ArrowRightLeft,
  Plane, ShieldCheck, Pencil, Trash2, Container, Fuel,
  AlertTriangle, Flame, AlertCircle, RotateCw, Ticket, MapPin, User,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FuelPanelProps {
  fleet?:   any[];
  vendors?: Vendor[];
}

interface FuelRecord {
  id:                      string;
  operation_type:          'IN' | 'TRANSFER' | 'BURN' | 'OUT'; // [v4.4.1] OUT: vuelo en modo heredado
  aircraft_id:             string;
  destination_aircraft_id: string | null;
  liters:                  number;
  fuel_type:               string;
  location:                string;
  vendor_id:               string | null;
  ticket_number:           string;
  technician:              string;
  hobbs_at_charge:         number | null;
  presentation:            string | null;
  unit_count:              number | null;
  created_at:              string;
}

type PresentationType = 'PIPA' | 'BIDON_200' | 'TAMBOR_55GAL' | 'GRANEL';
type OperationMode    = 'IN' | 'TRANSFER';

interface RecordForm {
  aircraftId:            string;
  destinationAircraftId: string;
  liters:                number;
  fuelType:              string;
  location:              string;
  vendorId:              string;
  ticketNumber:          string;
  technician:            string;
  hobbsAtCharge:         number;
  presentation:          PresentationType;
  unitCount:             number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PRESENTATION_OPTIONS: {
  value: PresentationType; label: string; litersPerUnit: number | null;
}[] = [
  { value: 'PIPA',         label: 'Pipa / Cisterna',             litersPerUnit: null  },
  { value: 'BIDON_200',    label: 'Bidón 200 LTS',               litersPerUnit: 200   },
  { value: 'TAMBOR_55GAL', label: 'Tambor 55 GAL (≈208.2 LTS)', litersPerUnit: 208.2 },
  { value: 'GRANEL',       label: 'Granel / Otro (LTS directo)', litersPerUnit: null  },
];

const EMPTY_FORM: RecordForm = {
  aircraftId:            '',
  destinationAircraftId: '',
  liters:                0,
  fuelType:              'AVGAS 100LL',
  location:              'Barquisimeto',
  vendorId:              '',
  ticketNumber:          '',
  technician:            '',
  hobbsAtCharge:         0,
  presentation:          'PIPA',
  unitCount:             1,
};

const FUEL_LOW_THRESHOLD = 100;

// [v4.4] Lectura por lotes
const FUEL_BATCH       = 500;
const FUEL_MAX_BATCHES = 400;   // tope de seguridad: 200.000 movimientos
const BITACORA_SIZE    = 30;

// [v4.4] Presentación por tipo de movimiento
const TIPO_MOV: Record<FuelRecord['operation_type'], {
  label: string; short: string; sign: string; tone: BmTone; text: string; Icon: React.ElementType;
}> = {
  IN:       { label: 'Entrada',          short: 'Entrada',  sign: '+', tone: 'ok',   text: 'text-bm-ok',     Icon: ArrowDownToLine },
  TRANSFER: { label: 'Transferencia',    short: 'Transfer', sign: '⇄', tone: 'info', text: 'text-[#2F5BB7]', Icon: ArrowRightLeft },
  BURN:     { label: 'Consumo de vuelo', short: 'Vuelo',    sign: '−', tone: 'warn', text: 'text-bm-warn',   Icon: Flame },
  OUT:      { label: 'Salida heredada',  short: 'Salida',   sign: '−', tone: 'neutral', text: 'text-bm-steel', Icon: Flame }, // [v4.4.1]
};

/** [v4.4.1] Presentación segura: un tipo no previsto nunca rompe la bitácora. */
const tipoMov = (t: string) =>
  TIPO_MOV[t as FuelRecord['operation_type']] ??
  { label: `Movimiento ${t || 'sin tipo'}`, short: t || '—', sign: '·', tone: 'neutral' as BmTone, text: 'text-bm-steel', Icon: Fuel };

/** [v4.4.1] Solo las entradas y transferencias se editan desde este panel. */
const esEditable = (t: string) => t === 'IN' || t === 'TRANSFER';

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtLts = (n: number) => Math.max(n, 0).toFixed(1);

const getPresentationLabel = (value: string | null) =>
  PRESENTATION_OPTIONS.find(p => p.value === value)?.label ?? value ?? '—';

// ── v4.3: normaliza el identificador de aeronave sin importar qué campo use el padre ──
const getAircraftId = (a: any): string => a.matricula ?? a.tailNumber ?? '';
const getAircraftLabel = (a: any): string => {
  const id    = getAircraftId(a);
  const model = a.modelo ?? a.model ?? '';
  return model ? `${id} — ${model}` : id;
};

/**
 * [v4.4] Efecto con signo de un movimiento sobre el saldo de una aeronave.
 * Es la misma regla con la que fetchGlobalFuelData construye el mapa de saldos.
 */
const efectoEnAeronave = (r: Pick<FuelRecord, 'operation_type' | 'aircraft_id' | 'destination_aircraft_id' | 'liters'>, id: string): number => {
  const lts = Number(r.liters) || 0;
  let delta = 0;
  if (r.operation_type === 'IN'       && r.aircraft_id === id) delta += lts;
  if (r.operation_type === 'TRANSFER' && r.aircraft_id === id) delta -= lts;
  if (r.operation_type === 'TRANSFER' && r.destination_aircraft_id === id) delta += lts;
  if (r.operation_type === 'BURN'     && r.aircraft_id === id) delta -= lts;
  return delta;
};

const fmtFecha = (d: string) =>
  new Date(d).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' });

// ── Component ──────────────────────────────────────────────────────────────────

export const FuelPanel: React.FC<FuelPanelProps> = ({ fleet = [], vendors = [] }) => {
  const { profile } = useAuth(); // [v4.4]
  const [operationMode, setOperationMode] = useState<OperationMode>('IN');
  const [isAdding,      setIsAdding]      = useState(false);
  const [records,       setRecords]       = useState<FuelRecord[]>([]);
  const [aircraftStock, setAircraftStock] = useState<Record<string, number>>({});
  const [loading,       setLoading]       = useState(false);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<FuelRecord | null>(null);
  const [form,          setForm]          = useState<RecordForm>(EMPTY_FORM);

  // [v4.4] Estado de carga y confirmación de borrado
  const [loadingData,   setLoadingData]   = useState(true);
  const [loadError,     setLoadError]     = useState<string | null>(null);
  const [stockReady,    setStockReady]    = useState(false);
  const [totalMovs,     setTotalMovs]     = useState(0);
  const [pendingDelete, setPendingDelete] = useState<FuelRecord | null>(null);
  const requestSeq = useRef(0);

  const fuelVendors = vendors.filter(v => v.category === 'Combustible');

  // ── Fetch & calcular saldo ─────────────────────────────────────────────────

  const fetchGlobalFuelData = useCallback(async () => {
    const seq = ++requestSeq.current; // [v4.4] descarta respuestas obsoletas
    setLoadingData(true);
    try {
      // [FIX v4.4] Lectura completa por lotes (antes: un SELECT truncado a 1.000 filas)
      const byId = new Map<string, FuelRecord>();
      for (let batch = 0; batch < FUEL_MAX_BATCHES; batch++) {
        const from = batch * FUEL_BATCH;
        const { data, error } = await (supabase as any)
          .from('registros_combustible')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + FUEL_BATCH - 1);
        if (error) throw error;
        const rows = (data ?? []) as FuelRecord[];
        rows.forEach(r => byId.set(String(r.id), r)); // dedupe si entra un registro entre lotes
        if (rows.length < FUEL_BATCH) break;
      }
      if (seq !== requestSeq.current) return;

      const allLogs = Array.from(byId.values()).sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : String(b.id).localeCompare(String(a.id)));

      const stockMap: Record<string, number> = {};

      allLogs.forEach((r: FuelRecord) => {
        const origin = r.aircraft_id;
        const dest   = r.destination_aircraft_id;
        const lts    = Number(r.liters);

        if (!stockMap[origin]) stockMap[origin] = 0;

        if (r.operation_type === 'IN') {
          stockMap[origin] += lts;
        } else if (r.operation_type === 'TRANSFER') {
          stockMap[origin] -= lts;
          if (dest) {
            if (!stockMap[dest]) stockMap[dest] = 0;
            stockMap[dest] += lts;
          }
        } else if (r.operation_type === 'BURN') {
          stockMap[origin] -= lts;
        }
      });

      setAircraftStock(stockMap);
      setRecords(allLogs.slice(0, BITACORA_SIZE));
      setTotalMovs(allLogs.length);
      setStockReady(true);
      setLoadError(null);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      console.error('[FuelPanel] Error telemetría:', err);
      setLoadError(err?.message ?? 'Error de conexión');
    } finally {
      if (seq === requestSeq.current) setLoadingData(false);
    }
  }, []);

  useEffect(() => { fetchGlobalFuelData(); }, [fetchGlobalFuelData]);

  // ── Modal controls ─────────────────────────────────────────────────────────

  const openNew = (mode: OperationMode) => {
    setEditingRecord(null);
    setOperationMode(mode);
    // [v4.4] Auditor precargado con el nombre del perfil (editable)
    setForm({ ...EMPTY_FORM, technician: profile?.nombre_completo ?? '' });
    setIsAdding(true);
  };

  const openEdit = (r: FuelRecord) => {
    if (!esEditable(r.operation_type)) return; // [FIX v4.4.1] antes solo excluía BURN
    setEditingRecord(r);
    setOperationMode(r.operation_type as OperationMode);
    setForm({
      aircraftId:            r.aircraft_id,
      destinationAircraftId: r.destination_aircraft_id ?? '',
      liters:                Number(r.liters),
      fuelType:              r.fuel_type,
      location:              r.location,
      vendorId:              r.vendor_id ?? '',
      ticketNumber:          r.ticket_number,
      technician:            r.technician,
      hobbsAtCharge:         r.hobbs_at_charge ?? 0,
      presentation:          (r.presentation as PresentationType) ?? 'PIPA',
      unitCount:             r.unit_count ?? 1,
    });
    setIsAdding(true);
  };

  const closeModal = () => {
    setIsAdding(false);
    setEditingRecord(null);
    setForm(EMPTY_FORM);
  };

  // ── [v4.4] Disponible real de una aeronave en el formulario ──────────────
  // Al editar, el saldo actual ya incluye el registro editado: se descuenta.
  const disponible = (id: string): number =>
    (aircraftStock[id] ?? 0) - (editingRecord ? efectoEnAeronave(editingRecord, id) : 0);

  // ── Delete ─────────────────────────────────────────────────────────────────

  // [v4.4] Confirmación en modal B&M (antes window.confirm)
  const handleDelete = (record: FuelRecord) => {
    setPendingDelete(record);
  };

  const confirmDelete = async () => {
    const record = pendingDelete;
    if (!record) return;

    setDeletingId(record.id);
    const { error } = await (supabase as any)
      .from('registros_combustible')
      .delete()
      .eq('id', record.id);

    if (error) { alert(`FALLA TÁCTICA: ${error.message}`); }
    else        { setPendingDelete(null); await fetchGlobalFuelData(); }

    setDeletingId(null);
  };

  // ── Presentation ───────────────────────────────────────────────────────────

  const handlePresentationChange = (presentation: PresentationType) => {
    const option = PRESENTATION_OPTIONS.find(p => p.value === presentation);
    if (option?.litersPerUnit != null) {
      setForm(prev => ({ ...prev, presentation, liters: option.litersPerUnit! * (prev.unitCount || 1) }));
    } else {
      setForm(prev => ({ ...prev, presentation }));
    }
  };

  const handleUnitCountChange = (unitCount: number) => {
    const option = PRESENTATION_OPTIONS.find(p => p.value === form.presentation);
    if (option?.litersPerUnit != null) {
      setForm(prev => ({ ...prev, unitCount, liters: option.litersPerUnit! * (unitCount || 0) }));
    } else {
      setForm(prev => ({ ...prev, unitCount }));
    }
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const isEditing  = editingRecord !== null;
    const isTransfer = operationMode === 'TRANSFER';

    // [FIX v4.4] Volumen válido antes de cualquier validación de saldo
    if (!Number.isFinite(Number(form.liters)) || Number(form.liters) <= 0) {
      alert('Indique un volumen mayor que cero.');
      setLoading(false);
      return;
    }

    if (isTransfer && form.aircraftId === form.destinationAircraftId) {
      alert('La aeronave origen y destino no pueden ser la misma.');
      setLoading(false);
      return;
    }

    // [FIX v4.4] También al editar: disponible = saldo − efecto del registro editado
    if (isTransfer) {
      const saldoOrigen = disponible(form.aircraftId);
      if (form.liters > saldoOrigen) {
        alert(
          `SALDO INSUFICIENTE\n\n` +
          `${form.aircraftId} tiene ${fmtLts(saldoOrigen)} LTS disponibles.\n` +
          `Solicitado: ${fmtLts(form.liters)} LTS`
        );
        setLoading(false);
        return;
      }
    }

    // [FIX v4.4] Hobbs vacío → null (antes NaN)
    const hobbs = Number(form.hobbsAtCharge);

    const dbEntry: Record<string, any> = {
      operation_type:          operationMode,
      aircraft_id:             form.aircraftId.toUpperCase(),
      destination_aircraft_id: isTransfer ? form.destinationAircraftId.toUpperCase() : null,
      liters:                  Number(form.liters),
      fuel_type:               String(form.fuelType),
      location:                String(form.location),
      vendor_id:               form.vendorId || null,
      ticket_number:           String(form.ticketNumber).toUpperCase(),
      technician:              String(form.technician).toUpperCase(),
      hobbs_at_charge:         isTransfer ? (Number.isFinite(hobbs) ? hobbs : null) : null,
      presentation:            operationMode === 'IN' ? form.presentation : null,
      unit_count:              operationMode === 'IN' ? Number(form.unitCount) : null,
    };

    let error: any = null;
    if (isEditing) {
      const { error: e } = await (supabase as any).from('registros_combustible').update(dbEntry).eq('id', editingRecord!.id);
      error = e;
    } else {
      const { error: e } = await (supabase as any).from('registros_combustible').insert([dbEntry]);
      error = e;
    }

    if (error) { alert(`FALLA TÁCTICA: ${error.message}`); }
    else {
      await fetchGlobalFuelData();
      closeModal();
      alert(isEditing
        ? '[B&M OPS] Registro actualizado.'
        : `[B&M OPS] ${operationMode === 'IN' ? 'Entrada' : 'Transferencia'} certificada.`
      );
    }
    setLoading(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedPresentation = PRESENTATION_OPTIONS.find(p => p.value === form.presentation);
  const isUnitBased          = selectedPresentation?.litersPerUnit != null;
  const totalFuelFleet       = Object.values(aircraftStock).reduce((acc, v) => acc + (v > 0 ? v : 0), 0);

  // [v4.4] Resumen de alertas
  const saldosFlota = fleet.map(a => aircraftStock[getAircraftId(a)] ?? 0);
  const nBajo   = saldosFlota.filter(s => s > 0 && s < FUEL_LOW_THRESHOLD).length;
  const nVacias = saldosFlota.filter(s => s <= 0).length;

  const modalTitle = editingRecord ? 'Editar registro'
    : operationMode === 'IN' ? 'Entrada de combustible' : 'Transferencia de combustible';
  const modalSubtitle = editingRecord
    ? `Registro #${editingRecord.id.slice(0, 8).toUpperCase()}`
    : operationMode === 'IN' ? 'Del proveedor a la aeronave almacén' : 'De una aeronave almacén a otra aeronave';

  // [v4.4] Saldo resultante tras borrar (aviso en la confirmación)
  const impactoBorrado = pendingDelete
    ? Array.from(new Set([pendingDelete.aircraft_id, pendingDelete.destination_aircraft_id].filter(Boolean) as string[]))
        .map(id => {
          const antes = aircraftStock[id] ?? 0;
          return { id, antes, despues: antes - efectoEnAeronave(pendingDelete, id) };
        })
    : [];

  // [v4.4] Fragmentos de render (funciones, no componentes: sin remontajes)
  const detalleMov = (r: FuelRecord) => (
    r.operation_type === 'IN' ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Container className="h-3.5 w-3.5 shrink-0 text-bm-steel" />
        {getPresentationLabel(r.presentation)}
        {r.unit_count && r.unit_count > 1 && <span className="text-bm-steel">× {r.unit_count}</span>}
      </span>
    ) : r.operation_type === 'BURN' ? (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Flame className="h-3.5 w-3.5 shrink-0 text-bm-warn" />
          Consumo de vuelo
        </span>
        {r.hobbs_at_charge ? <span className="bm-num whitespace-nowrap text-bm-steel">TAC {r.hobbs_at_charge}</span> : null}
      </span>
    ) : r.operation_type === 'OUT' ? (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Flame className="h-3.5 w-3.5 shrink-0 text-bm-steel" />
          Vuelo, registro heredado
        </span>
        <span className="whitespace-nowrap normal-case text-bm-hint">no descuenta saldo</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5">
        <Fuel className="h-3.5 w-3.5 shrink-0 text-bm-steel" /> {r.fuel_type}
      </span>
    )
  );

  const aeronavesDe = (r: FuelRecord) => (
    r.operation_type === 'TRANSFER' ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-data font-semibold uppercase">
        <span className="text-bm-steel">{r.aircraft_id}</span>
        <ArrowRightLeft className="h-3.5 w-3.5 text-bm-hint" aria-label="hacia" />
        <span>{r.destination_aircraft_id ?? '—'}</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 font-data font-semibold uppercase">
        <Plane className="h-3.5 w-3.5 text-bm-steel" />
        {r.aircraft_id}
      </span>
    )
  );

  const acciones = (r: FuelRecord, full = false) => (
    <div className={`flex items-center gap-2 ${full ? '' : 'justify-end'}`}>
      {esEditable(r.operation_type) && (
        <button type="button" onClick={() => openEdit(r)}
          className={`${bmBtn.secondary} ${bmBtn.sm} ${full ? 'flex-1' : ''}`}>
          <Pencil className="h-4 w-4" /> Editar
        </button>
      )}
      <button type="button" onClick={() => handleDelete(r)} disabled={deletingId === r.id}
        aria-label={`Borrar movimiento ${tipoMov(r.operation_type).label} de ${r.aircraft_id}`}
        className={`${bmBtn.secondary} ${bmBtn.sm} hover:!border-bm-red-deep hover:!text-bm-red-deep ${full ? 'flex-1' : ''}`}>
        {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        Borrar
      </button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {loadError && (
        <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              No se pudieron cargar los movimientos de combustible ({loadError}).
              {stockReady ? ' Los saldos mostrados pueden no estar actualizados.' : ''}
            </span>
            <button type="button" onClick={() => fetchGlobalFuelData()} disabled={loadingData}
              className={`${bmBtn.secondary} ${bmBtn.sm}`}>
              <RotateCw className={`h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} /> Reintentar
            </button>
          </div>
        </BmNotice>
      )}

      {/* KPI FLOTA */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="flex flex-col justify-between rounded-[24px] bg-bm-ink p-5 text-white sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-white/70">Combustible en la flota</p>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
              <Fuel className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-6 flex items-end gap-2">
            {stockReady ? (
              <span className="bm-figure text-[44px] leading-none sm:text-[52px]">{fmtLts(totalFuelFleet)}</span>
            ) : (
              <span className="bm-skeleton h-12 w-40 rounded-lg !bg-white/10" aria-label="Cargando" />
            )}
            <span className="mb-1 text-sm text-white/60">litros</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium">
              {fleet.length === 1 ? '1 aeronave' : `${fleet.length} aeronaves`}
            </span>
            {stockReady && nBajo > 0 && (
              <span className="rounded-full bg-bm-warn px-2.5 py-1 text-xs font-semibold">{nBajo} con saldo bajo</span>
            )}
            {stockReady && nVacias > 0 && (
              <span className="rounded-full bg-bm-red px-2.5 py-1 text-xs font-semibold">{nVacias} sin saldo</span>
            )}
          </div>
        </div>

        <div className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="bm-heading text-base">Saldo por aeronave</h3>
            <span className="text-xs text-bm-steel">Bajo: menos de {FUEL_LOW_THRESHOLD} L</span>
          </div>
          {fleet.length === 0 ? (
            <BmEmpty
              className="!py-8"
              icon={<Plane className="h-5 w-5" />}
              title="Sin aeronaves registradas"
              text="Las aeronaves de la flota aparecen aquí con su saldo de combustible."
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {fleet.map(a => {
                // v4.3: usa getAircraftId para soportar matricula o tailNumber
                const id      = getAircraftId(a);
                const saldo   = aircraftStock[id] ?? 0;
                const isLow   = saldo > 0 && saldo < FUEL_LOW_THRESHOLD;
                const isEmpty = saldo <= 0;
                return (
                  <div key={a.id}
                    className={`rounded-2xl border p-3 ${
                      !stockReady ? 'border-bm-line'
                      : isEmpty ? 'border-bm-line bg-bm-canvas'
                      : isLow   ? 'border-bm-warn/30 bg-bm-warn-tint/60'
                      :           'border-bm-line'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-data text-[13px] font-semibold uppercase">{id}</span>
                      <Plane className={`h-4 w-4 shrink-0 ${isEmpty ? 'text-bm-hint' : isLow ? 'text-bm-warn' : 'text-bm-ok'}`} />
                    </div>
                    <p className={`bm-num mt-2 text-xl font-semibold ${!stockReady ? 'text-bm-hint' : isEmpty ? 'text-bm-steel' : isLow ? 'text-bm-warn' : ''}`}>
                      {stockReady ? fmtLts(saldo) : '—'} <span className="text-xs font-normal text-bm-steel">L</span>
                    </p>
                    {stockReady && isLow && (
                      <BmBadge tone="warn" className="mt-1.5" icon={<AlertTriangle className="h-3 w-3" />}>Bajo</BmBadge>
                    )}
                    {stockReady && isEmpty && saldo < 0 && (
                      <BmBadge tone="danger" className="mt-1.5" icon={<AlertTriangle className="h-3 w-3" />}>Recargar</BmBadge>
                    )}
                    {stockReady && isEmpty && saldo >= 0 && (
                      <p className="mt-1.5 text-xs text-bm-steel">Sin saldo</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ACTION BUTTONS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <button type="button" onClick={() => openNew('IN')}
          className="group flex items-center gap-4 rounded-[20px] border border-bm-line bg-white p-4 text-left transition-colors hover:border-bm-ok/40 sm:p-5">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${bmIconTone.ok}`}>
            <ArrowDownToLine className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Registrar entrada</span>
            <span className="block text-[13px] text-bm-steel">Del proveedor a la aeronave almacén</span>
          </span>
        </button>
        <button type="button" onClick={() => openNew('TRANSFER')}
          className="group flex items-center gap-4 rounded-[20px] bg-bm-red p-4 text-left text-white transition-colors hover:bg-bm-red-deep sm:p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <ArrowRightLeft className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">Transferir combustible</span>
            <span className="block text-[13px] text-white/75">De una aeronave almacén a otra aeronave</span>
          </span>
        </button>
      </div>

      {/* BITÁCORA */}
      <section className="overflow-hidden rounded-[24px] border border-bm-line bg-white" aria-labelledby="fuel-bitacora">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bm-line p-4 sm:px-5">
          <h3 id="fuel-bitacora" className="bm-heading flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-bm-red" /> Bitácora de suministro
          </h3>
          <span className="text-xs text-bm-steel">
            {loadingData && !stockReady ? 'Cargando…'
              : `Últimos ${Math.min(BITACORA_SIZE, records.length)} de ${totalMovs} movimientos`}
          </span>
        </div>

        {loadingData && !stockReady ? (
          <div className="space-y-2 p-4" role="status" aria-label="Cargando movimientos">
            {[0, 1, 2].map(i => <div key={i} className="bm-skeleton h-16 rounded-xl" />)}
          </div>
        ) : records.length === 0 ? (
          loadError ? (
            <BmEmpty
              icon={<AlertCircle className="h-5 w-5" />}
              title="Bitácora no disponible"
              text="No se pudo leer la bitácora. Use Reintentar en el aviso superior."
            />
          ) : (
            <BmEmpty
              icon={<History className="h-5 w-5" />}
              title="Sin movimientos registrados"
              text="Registre la primera entrada de combustible para abrir la bitácora."
            />
          )
        ) : (
          <>
            {/* Móvil: tarjetas */}
            <ul className="divide-y divide-bm-line md:hidden">
              {records.map(r => {
                const t = tipoMov(r.operation_type);
                return (
                  <li key={r.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bmIconTone[t.tone]}`}>
                          <t.Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{t.label}</p>
                          <p className="text-xs text-bm-steel">{fmtFecha(r.created_at)}</p>
                        </div>
                      </div>
                      <p className={`bm-num shrink-0 text-lg font-semibold ${t.text}`}>
                        {t.sign}{fmtLts(Number(r.liters ?? 0))}<span className="ml-1 text-xs font-normal text-bm-steel">L</span>
                      </p>
                    </div>
                    <div className="text-sm">{aeronavesDe(r)}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bm-steel">
                      <span className="inline-flex items-center gap-1"><Ticket className="h-3.5 w-3.5" /> <span className="font-data uppercase">{r.ticket_number}</span></span>
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {r.location}</span>
                      <span className="inline-flex items-center gap-1 uppercase"><User className="h-3.5 w-3.5" /> {r.technician}</span>
                    </div>
                    <div className="text-xs uppercase text-bm-steel">{detalleMov(r)}</div>
                    {acciones(r, true)}
                  </li>
                );
              })}
            </ul>

            {/* Escritorio: tabla */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b border-bm-line bg-bm-canvas/60 text-xs text-bm-steel">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Tipo</th>
                    <th scope="col" className="px-5 py-3 font-medium">Aeronave(s)</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Cantidad</th>
                    <th scope="col" className="px-5 py-3 font-medium">Detalle</th>
                    <th scope="col" className="px-5 py-3 font-medium">Sede</th>
                    <th scope="col" className="px-5 py-3 font-medium">Auditor</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bm-line">
                  {records.map(r => {
                    const t = tipoMov(r.operation_type);
                    return (
                      <tr key={r.id} className="align-middle transition-colors hover:bg-bm-canvas/50">
                        <td className="px-5 py-3.5">
                          <BmBadge tone={t.tone} icon={<t.Icon className="h-3 w-3" />}>{t.short}</BmBadge>
                          <span className="mt-1 block text-xs text-bm-steel">{fmtFecha(r.created_at)}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          {aeronavesDe(r)}
                          <span className="mt-0.5 block text-xs text-bm-steel">
                            Ticket <span className="font-data uppercase">{r.ticket_number}</span>
                          </span>
                        </td>
                        <td className={`bm-num whitespace-nowrap px-5 py-3.5 text-right text-base font-semibold ${t.text}`}>
                          {t.sign}{fmtLts(Number(r.liters ?? 0))}
                          <span className="ml-1 text-xs font-normal text-bm-steel">L</span>
                        </td>
                        <td className="px-5 py-3.5 text-xs uppercase text-bm-steel">{detalleMov(r)}</td>
                        <td className="px-5 py-3.5 text-bm-steel">{r.location}</td>
                        <td className="max-w-[180px] truncate px-5 py-3.5 text-xs font-medium uppercase text-bm-steel">{r.technician}</td>
                        <td className="px-5 py-3.5">{acciones(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* MODAL — REGISTRO */}
      <BmModal
        open={isAdding}
        onClose={closeModal}
        busy={loading}
        title={modalTitle}
        subtitle={modalSubtitle}
        icon={editingRecord ? <Pencil className="h-5 w-5" />
          : operationMode === 'IN' ? <ArrowDownToLine className="h-5 w-5" /> : <ArrowRightLeft className="h-5 w-5" />}
        tone={editingRecord ? 'neutral' : operationMode === 'IN' ? 'ok' : 'red'}
        size="lg"
        z={100}
      >
        <form onSubmit={handleAction} className="space-y-5">

          {/* ENTRADA */}
          {operationMode === 'IN' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <BmField label="Aeronave receptora" htmlFor="fu-rec" required>
                <BmSelect id="fu-rec" required value={form.aircraftId}
                  onChange={e => setForm({ ...form, aircraftId: e.target.value })}>
                  <option value="">Seleccione la aeronave</option>
                  {fleet.map(a => (
                    <option key={a.id} value={getAircraftId(a)}>{getAircraftLabel(a)}</option>
                  ))}
                </BmSelect>
              </BmField>
              <BmField label="Proveedor" htmlFor="fu-prov"
                hint={fuelVendors.length === 0 ? 'No hay proveedores de combustible registrados.' : undefined}>
                <BmSelect id="fu-prov" value={form.vendorId}
                  onChange={e => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">Sin proveedor</option>
                  {fuelVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </BmSelect>
              </BmField>
            </div>
          )}

          {/* TRANSFERENCIA */}
          {operationMode === 'TRANSFER' && (
            <div className="grid gap-4 rounded-2xl bg-bm-canvas p-4 sm:grid-cols-2">
              <BmField label="Aeronave origen" htmlFor="fu-ori" required
                hint={form.aircraftId
                  ? <>Disponible: <span className="bm-num font-semibold text-bm-ink">{fmtLts(disponible(form.aircraftId))} L</span></>
                  : undefined}>
                <BmSelect id="fu-ori" required value={form.aircraftId}
                  onChange={e => setForm({ ...form, aircraftId: e.target.value })}>
                  <option value="">Seleccione el origen</option>
                  {fleet.map(a => {
                    const id    = getAircraftId(a);
                    const saldo = disponible(id);
                    return (
                      <option key={a.id} value={id} disabled={saldo <= 0}>
                        {id} — {fmtLts(saldo)} L{saldo <= 0 ? ' (sin stock)' : ''}
                      </option>
                    );
                  })}
                </BmSelect>
              </BmField>
              <BmField label="Aeronave destino" htmlFor="fu-des" required>
                <BmSelect id="fu-des" required value={form.destinationAircraftId}
                  onChange={e => setForm({ ...form, destinationAircraftId: e.target.value })}>
                  <option value="">Seleccione el destino</option>
                  {fleet
                    .filter(a => getAircraftId(a) !== form.aircraftId)
                    .map(a => (
                      <option key={a.id} value={getAircraftId(a)}>{getAircraftLabel(a)}</option>
                    ))}
                </BmSelect>
              </BmField>
            </div>
          )}

          {/* PRESENTACIÓN */}
          {operationMode === 'IN' && (
            <div className="grid gap-4 rounded-2xl bg-bm-canvas p-4 sm:grid-cols-2">
              <BmField label={<><Container className="h-4 w-4 text-bm-steel" /> Presentación</>} htmlFor="fu-pres">
                <BmSelect id="fu-pres" value={form.presentation}
                  onChange={e => handlePresentationChange(e.target.value as PresentationType)}>
                  {PRESENTATION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </BmSelect>
              </BmField>
              {isUnitBased ? (
                <BmField label="Cantidad de unidades" htmlFor="fu-uds" required
                  hint={<>{form.unitCount || 0} × {selectedPresentation?.litersPerUnit} L = <span className="bm-num font-semibold text-bm-ink">{fmtLts(form.liters)} L</span></>}>
                  <input id="fu-uds" type="number" step="1" min="1" required inputMode="numeric"
                    className={`${bmInput} bm-num`} value={form.unitCount || ''}
                    onChange={e => handleUnitCountChange(parseInt(e.target.value) || 0)} />
                </BmField>
              ) : (
                <BmField label="Tipo de combustible" htmlFor="fu-tipo">
                  <BmSelect id="fu-tipo" value={form.fuelType}
                    onChange={e => setForm({ ...form, fuelType: e.target.value })}>
                    <option value="AVGAS 100LL">AVGAS 100LL</option>
                  </BmSelect>
                </BmField>
              )}
            </div>
          )}

          {/* VOLUMEN + TICKET */}
          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Volumen en litros" htmlFor="fu-lts" required
              hint={operationMode === 'IN' && isUnitBased ? 'Calculado a partir de las unidades.' : undefined}>
              <input id="fu-lts" type="number" step="0.1" min="0.1" required inputMode="decimal"
                value={form.liters || ''}
                readOnly={operationMode === 'IN' && isUnitBased}
                className={`${bmInput} bm-num h-14 text-2xl font-semibold ${operationMode === 'IN' && isUnitBased ? 'cursor-not-allowed bg-bm-canvas text-bm-steel' : ''}`}
                onChange={e => setForm({ ...form, liters: parseFloat(e.target.value) })} />
            </BmField>
            <BmField label="N.º de ticket" htmlFor="fu-ticket" required>
              <input id="fu-ticket" required value={form.ticketNumber}
                className={`${bmInput} font-data uppercase sm:h-14`}
                onChange={e => setForm({ ...form, ticketNumber: e.target.value })} />
            </BmField>
          </div>

          {/* SEDE + AUDITOR */}
          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Sede" htmlFor="fu-sede">
              <BmSelect id="fu-sede" value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}>
                <option value="Barquisimeto">Barquisimeto</option>
                <option value="Maturín">Maturín</option>
              </BmSelect>
            </BmField>
            <BmField label="Auditor" htmlFor="fu-aud" required>
              <input id="fu-aud" required value={form.technician}
                className={`${bmInput} uppercase`}
                onChange={e => setForm({ ...form, technician: e.target.value })} />
            </BmField>
          </div>

          {/* HOBBS (solo TRANSFERENCIA) */}
          {operationMode === 'TRANSFER' && (
            <BmField label="Hobbs de la aeronave destino" htmlFor="fu-hobbs" hint="Opcional.">
              <input id="fu-hobbs" type="number" step="0.1" inputMode="decimal"
                value={form.hobbsAtCharge || ''}
                className={`${bmInput} bm-num`}
                onChange={e => setForm({ ...form, hobbsAtCharge: parseFloat(e.target.value) })} />
            </BmField>
          )}

          {/* SUBMIT */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={closeModal} disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className={`${editingRecord ? bmBtn.dark : operationMode === 'IN' ? bmBtn.success : bmBtn.primary} sm:flex-[2]`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" />
              : editingRecord ? <Pencil className="h-5 w-5" />
              : operationMode === 'IN' ? <ArrowDownToLine className="h-5 w-5" />
              : <ShieldCheck className="h-5 w-5" />}
              {loading ? 'Guardando…'
              : editingRecord ? 'Guardar cambios'
              : operationMode === 'IN' ? 'Certificar entrada'
              : 'Certificar transferencia'}
            </button>
          </div>
        </form>
      </BmModal>

      {/* MODAL — CONFIRMAR BORRADO [v4.4] */}
      <BmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        busy={!!deletingId}
        title="¿Eliminar movimiento?"
        subtitle={pendingDelete ? `${tipoMov(pendingDelete.operation_type).label} · ${fmtLts(Number(pendingDelete.liters))} L` : undefined}
        icon={<Trash2 className="h-5 w-5" />}
        tone="danger"
        size="sm"
        z={110}
      >
        {pendingDelete && (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-2xl bg-bm-canvas p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-bm-steel">Aeronave</dt>
                <dd className="text-right">{aeronavesDe(pendingDelete)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-bm-steel">Ticket</dt>
                <dd className="font-data uppercase">{pendingDelete.ticket_number}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-bm-steel">Fecha</dt>
                <dd>{fmtFecha(pendingDelete.created_at)}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-2 text-sm font-medium">El saldo quedará así</p>
              <ul className="space-y-1.5">
                {impactoBorrado.map(x => (
                  <li key={x.id} className="flex items-center justify-between gap-3 rounded-xl border border-bm-line px-3 py-2 text-sm">
                    <span className="font-data font-semibold uppercase">{x.id}</span>
                    <span className="bm-num">
                      <span className="text-bm-steel">{x.antes.toFixed(1)}</span>
                      <span className="mx-1.5 text-bm-hint" aria-hidden="true">→</span>
                      <span className={`font-semibold ${x.despues < 0 ? 'text-bm-red' : ''}`}>{x.despues.toFixed(1)} L</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {impactoBorrado.some(x => x.despues < 0) && (
              <BmNotice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
                Algún saldo quedaría en negativo: ese combustible ya se transfirió o se consumió.
              </BmNotice>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={() => setPendingDelete(null)} disabled={!!deletingId}
                className={`${bmBtn.secondary} sm:flex-1`}>
                Cancelar
              </button>
              <button type="button" onClick={confirmDelete} disabled={!!deletingId}
                className={`${bmBtn.danger} sm:flex-1`}>
                {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingId ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        )}
      </BmModal>
    </div>
  );
};

export default FuelPanel;

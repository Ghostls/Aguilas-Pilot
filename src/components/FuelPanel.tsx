// src/components/FuelPanel.tsx
// Valkyron OS v4.3 — Águilas Pilot Edition
//
// v4.3: acepta tanto `matricula` como `tailNumber` en los objetos de flota
//       (compatibilidad con padre que pasa Supabase raw o mapeado)
// v4.2: tipo BURN — descuento automático por vuelo
// v4.1: filtro de proveedores a categoría 'Combustible'
// v4.0: arquitectura Aeronave como Almacén

import React, { useState, useEffect, useCallback } from 'react';
import { Vendor } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  X, History, Loader2, ArrowDownToLine, ArrowRightLeft,
  Plane, ShieldCheck, Pencil, Trash2, Container, Fuel,
  AlertTriangle, Flame,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FuelPanelProps {
  fleet?:   any[];
  vendors?: Vendor[];
}

interface FuelRecord {
  id:                      string;
  operation_type:          'IN' | 'TRANSFER' | 'BURN';
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

// ── Component ──────────────────────────────────────────────────────────────────

export const FuelPanel: React.FC<FuelPanelProps> = ({ fleet = [], vendors = [] }) => {
  const [operationMode, setOperationMode] = useState<OperationMode>('IN');
  const [isAdding,      setIsAdding]      = useState(false);
  const [records,       setRecords]       = useState<FuelRecord[]>([]);
  const [aircraftStock, setAircraftStock] = useState<Record<string, number>>({});
  const [loading,       setLoading]       = useState(false);
  const [deletingId,    setDeletingId]    = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<FuelRecord | null>(null);
  const [form,          setForm]          = useState<RecordForm>(EMPTY_FORM);

  const fuelVendors = vendors.filter(v => v.category === 'Combustible');

  // ── Fetch & calcular saldo ─────────────────────────────────────────────────

  const fetchGlobalFuelData = useCallback(async () => {
    try {
      const { data: allLogs, error } = await (supabase as any)
        .from('registros_combustible')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (allLogs) {
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
        setRecords(allLogs.slice(0, 30));
      }
    } catch (err) {
      console.error('[FuelPanel] Error telemetría:', err);
    }
  }, []);

  useEffect(() => { fetchGlobalFuelData(); }, [fetchGlobalFuelData]);

  // ── Modal controls ─────────────────────────────────────────────────────────

  const openNew = (mode: OperationMode) => {
    setEditingRecord(null);
    setOperationMode(mode);
    setForm(EMPTY_FORM);
    setIsAdding(true);
  };

  const openEdit = (r: FuelRecord) => {
    if (r.operation_type === 'BURN') return;
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

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (record: FuelRecord) => {
    const tipoLabels: Record<string, string> = {
      IN: 'ENTRADA', TRANSFER: 'TRANSFERENCIA', BURN: 'CONSUMO DE VUELO',
    };
    const confirmed = window.confirm(
      `¿Eliminar este movimiento?\n\n` +
      `${tipoLabels[record.operation_type]} · ${fmtLts(Number(record.liters))} LTS\n` +
      `Aeronave: ${record.aircraft_id}` +
      `${record.destination_aircraft_id ? ` → ${record.destination_aircraft_id}` : ''}\n` +
      `Ticket: ${record.ticket_number}\n\n` +
      `Esta acción revertirá el saldo de combustible.`
    );
    if (!confirmed) return;

    setDeletingId(record.id);
    const { error } = await (supabase as any)
      .from('registros_combustible')
      .delete()
      .eq('id', record.id);

    if (error) { alert(`FALLA TÁCTICA: ${error.message}`); }
    else        { await fetchGlobalFuelData(); }

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

    if (isTransfer && form.aircraftId === form.destinationAircraftId) {
      alert('La aeronave origen y destino no pueden ser la misma.');
      setLoading(false);
      return;
    }

    if (isTransfer && !isEditing) {
      const saldoOrigen = aircraftStock[form.aircraftId] ?? 0;
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
      hobbs_at_charge:         isTransfer ? Number(form.hobbsAtCharge) : null,
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
        ? '[ÁGUILAS OPS] Registro actualizado.'
        : `[ÁGUILAS OPS] ${operationMode === 'IN' ? 'Entrada' : 'Transferencia'} certificada.`
      );
    }
    setLoading(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedPresentation = PRESENTATION_OPTIONS.find(p => p.value === form.presentation);
  const isUnitBased          = selectedPresentation?.litersPerUnit != null;
  const totalFuelFleet       = Object.values(aircraftStock).reduce((acc, v) => acc + (v > 0 ? v : 0), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">

      {/* KPI FLOTA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 p-6 rounded-3xl flex flex-col justify-between">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-2">
            Total Combustible — Flota
          </p>
          <div className="flex items-end gap-2">
            <h3 className="text-4xl font-black text-[#E1AD01] font-mono">{fmtLts(totalFuelFleet)}</h3>
            <span className="text-[10px] text-[#E1AD01]/40 font-black mb-1">LTS</span>
          </div>
          <p className="text-[8px] text-white/20 font-black uppercase tracking-widest mt-3">
            {fleet.length} aeronave{fleet.length !== 1 ? 's' : ''} en registro
          </p>
        </div>

        <div className="md:col-span-2 bg-[#0a0a0a] border border-[#E1AD01]/20 p-5 rounded-3xl overflow-x-auto">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-4">
            Saldo por Aeronave
          </p>
          {fleet.length === 0 ? (
            <p className="text-[9px] text-slate-700 font-black uppercase tracking-widest">
              Sin aeronaves registradas
            </p>
          ) : (
            <div className="flex gap-4 min-w-max">
              {fleet.map(a => {
                // v4.3: usa getAircraftId para soportar matricula o tailNumber
                const id      = getAircraftId(a);
                const saldo   = aircraftStock[id] ?? 0;
                const isLow   = saldo > 0 && saldo < FUEL_LOW_THRESHOLD;
                const isEmpty = saldo <= 0;
                return (
                  <div key={a.id}
                    className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-2xl border transition-all
                      ${isEmpty
                        ? 'border-white/5 bg-black/20'
                        : isLow
                          ? 'border-orange-500/30 bg-orange-500/5'
                          : 'border-[#E1AD01]/20 bg-[#E1AD01]/5'}`}>
                    <Plane className={`h-4 w-4 ${isEmpty ? 'text-white/20' : isLow ? 'text-orange-400' : 'text-[#E1AD01]'}`} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-white/60">{id}</span>
                    <span className={`text-lg font-black font-mono ${isEmpty ? 'text-white/20' : isLow ? 'text-orange-400' : 'text-[#E1AD01]'}`}>
                      {fmtLts(saldo)}
                    </span>
                    <span className="text-[7px] text-white/30 font-black uppercase">LTS</span>
                    {isLow && (
                      <div className="flex items-center gap-0.5">
                        <AlertTriangle className="h-2.5 w-2.5 text-orange-500" />
                        <span className="text-[7px] text-orange-500 font-black uppercase">Bajo</span>
                      </div>
                    )}
                    {isEmpty && saldo < 0 && (
                      <div className="flex items-center gap-0.5">
                        <AlertTriangle className="h-2.5 w-2.5 text-red-500" />
                        <span className="text-[7px] text-red-500 font-black uppercase">Recargar</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ACTION BUTTONS */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => openNew('IN')}
          className="bg-white/5 hover:bg-[#E1AD01]/10 text-white p-5 rounded-2xl
                     border border-white/10 flex items-center gap-4 transition-all">
          <ArrowDownToLine className="h-5 w-5 text-[#E1AD01] shrink-0" />
          <div className="text-left">
            <span className="text-[9px] font-black uppercase tracking-widest block">Entrada de Combustible</span>
            <span className="text-[8px] text-white/30 font-normal normal-case">Proveedor → Aeronave almacén</span>
          </div>
        </button>
        <button onClick={() => openNew('TRANSFER')}
          className="bg-[#E1AD01] hover:bg-white text-black p-5 rounded-2xl flex items-center gap-4 transition-all">
          <ArrowRightLeft className="h-5 w-5 shrink-0" />
          <div className="text-left">
            <span className="text-[9px] font-black uppercase tracking-widest block">Transferencia</span>
            <span className="text-[8px] text-black/50 font-normal normal-case">Aeronave almacén → Aeronave</span>
          </div>
        </button>
      </div>

      {/* BITÁCORA */}
      <div className="bg-[#050505] border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/5 bg-white/[0.01] flex justify-between items-center">
          <h3 className="text-white font-black text-[10px] uppercase tracking-[0.4em] italic flex items-center gap-2">
            <History className="h-4 w-4 text-[#E1AD01]" /> Bitácora de Suministro — Flota
          </h3>
          <span className="text-[8px] text-slate-700 font-black uppercase tracking-widest">Últimos 30 movimientos</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full font-mono text-left text-[10px] min-w-[720px]">
            <thead className="text-slate-600 uppercase tracking-widest bg-white/[0.02] border-b border-white/5">
              <tr>
                <th className="p-5">Tipo</th>
                <th className="p-5">Aeronave(s)</th>
                <th className="p-5">Cant.</th>
                <th className="p-5">Detalle</th>
                <th className="p-5">Sede</th>
                <th className="p-5">Auditor / Cadete</th>
                <th className="p-5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-700 text-[10px] font-black uppercase tracking-widest">
                    Sin movimientos registrados
                  </td>
                </tr>
              ) : records.map(r => (
                <tr key={r.id} className="hover:bg-white/[0.01] transition-colors group">
                  <td className="p-5">
                    {r.operation_type === 'IN' && (
                      <span className="inline-flex items-center gap-1.5 text-green-500">
                        <ArrowDownToLine className="h-3 w-3" />
                        <span className="font-black uppercase text-[8px] tracking-widest">Entrada</span>
                      </span>
                    )}
                    {r.operation_type === 'TRANSFER' && (
                      <span className="inline-flex items-center gap-1.5 text-[#E1AD01]">
                        <ArrowRightLeft className="h-3 w-3" />
                        <span className="font-black uppercase text-[8px] tracking-widest">Transfer</span>
                      </span>
                    )}
                    {r.operation_type === 'BURN' && (
                      <span className="inline-flex items-center gap-1.5 text-orange-400">
                        <Flame className="h-3 w-3" />
                        <span className="font-black uppercase text-[8px] tracking-widest">Vuelo</span>
                      </span>
                    )}
                    <span className="block text-[7px] text-slate-600 font-normal mt-0.5">
                      {new Date(r.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </span>
                  </td>

                  <td className="p-5 font-black uppercase text-white">
                    {r.operation_type === 'TRANSFER' ? (
                      <span className="flex items-center gap-1.5">
                        <span className="text-slate-500">{r.aircraft_id}</span>
                        <ArrowRightLeft className="h-2.5 w-2.5 text-[#E1AD01]/50" />
                        <span>{r.destination_aircraft_id ?? '—'}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Plane className={`h-3 w-3 ${r.operation_type === 'IN' ? 'text-green-500/60' : 'text-orange-400/60'}`} />
                        {r.aircraft_id}
                      </span>
                    )}
                    <span className="block text-[7px] text-slate-500 font-normal mt-0.5">
                      Ticket: {r.ticket_number}
                    </span>
                  </td>

                  <td className={`p-5 font-black text-lg ${
                    r.operation_type === 'IN' ? 'text-green-500'
                    : r.operation_type === 'BURN' ? 'text-orange-400'
                    : 'text-[#E1AD01]'
                  }`}>
                    {r.operation_type === 'IN' ? '+' : r.operation_type === 'BURN' ? '−' : '⇄'}
                    {fmtLts(Number(r.liters ?? 0))}
                    <span className="text-[8px] ml-1 opacity-50">LTS</span>
                  </td>

                  <td className="p-5 text-slate-400 font-bold uppercase">
                    {r.operation_type === 'IN' ? (
                      <span className="flex items-center gap-1.5">
                        <Container className="h-3 w-3 text-[#E1AD01]/60" />
                        {getPresentationLabel(r.presentation)}
                        {r.unit_count && r.unit_count > 1 && <span className="text-slate-600">× {r.unit_count}</span>}
                      </span>
                    ) : r.operation_type === 'BURN' ? (
                      <span className="flex items-center gap-1.5 text-orange-400/70">
                        <Flame className="h-3 w-3" />
                        Consumo vuelo
                        {r.hobbs_at_charge ? <span className="text-slate-600 ml-1">TAC {r.hobbs_at_charge}</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-700 flex items-center gap-1.5">
                        <Fuel className="h-3 w-3" /> {r.fuel_type}
                      </span>
                    )}
                  </td>

                  <td className="p-5 text-slate-400 font-bold uppercase">{r.location}</td>
                  <td className="p-5 text-slate-600 italic uppercase font-black">{r.technician}</td>

                  <td className="p-5 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                      {r.operation_type !== 'BURN' && (
                        <button onClick={() => openEdit(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl
                                     border border-white/10 text-slate-500
                                     hover:border-[#E1AD01]/60 hover:text-[#E1AD01]
                                     transition-all text-[8px] font-black uppercase tracking-widest">
                          <Pencil className="h-3 w-3" /> Editar
                        </button>
                      )}
                      <button onClick={() => handleDelete(r)} disabled={deletingId === r.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl
                                   border border-red-500/20 text-red-500/50
                                   hover:border-red-500/60 hover:text-red-400 hover:bg-red-500/5
                                   transition-all text-[8px] font-black uppercase tracking-widest disabled:opacity-40">
                        {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        {deletingId === r.id ? '…' : 'Borrar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <Card className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-xl shadow-2xl
                           rounded-[2.5rem] overflow-hidden max-h-[90vh] overflow-y-auto">
            <CardHeader className={`p-6 flex justify-between items-center ${
              editingRecord ? 'bg-white/10 border-b border-[#E1AD01]/20'
              : operationMode === 'IN' ? 'bg-green-500/10 border-b border-green-500/20'
              : 'bg-[#E1AD01]'
            }`}>
              <CardTitle className={`text-[11px] font-black uppercase tracking-[0.4em] italic flex items-center gap-2 ${
                editingRecord ? 'text-[#E1AD01]' : operationMode === 'IN' ? 'text-green-400' : 'text-black'
              }`}>
                {editingRecord ? <><Pencil className="h-4 w-4" /> EDITAR REGISTRO</>
                : operationMode === 'IN' ? <><ArrowDownToLine className="h-4 w-4" /> ORDEN DE RECEPCIÓN</>
                : <><ArrowRightLeft className="h-4 w-4" /> ORDEN DE TRANSFERENCIA</>}
              </CardTitle>
              {editingRecord && (
                <span className="text-[8px] text-slate-500 font-mono mr-auto ml-3">
                  #{editingRecord.id.slice(0, 8).toUpperCase()}
                </span>
              )}
              <button onClick={closeModal}
                className={`hover:rotate-90 transition-all ${editingRecord || operationMode === 'IN' ? 'text-white' : 'text-black'}`}>
                <X className="h-6 w-6" />
              </button>
            </CardHeader>

            <CardContent className="p-10 text-white">
              <form onSubmit={handleAction} className="space-y-6 font-mono">

                {/* ENTRADA */}
                {operationMode === 'IN' && (
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[9px] text-green-400 font-black uppercase tracking-widest block">
                        Aeronave Receptora
                      </label>
                      <select required value={form.aircraftId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-green-500 uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, aircraftId: e.target.value })}>
                        <option value="">-- SELECCIONAR --</option>
                        {fleet.map(a => (
                          <option key={a.id} value={getAircraftId(a)}>{getAircraftLabel(a)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                        Proveedor
                        {fuelVendors.length === 0 && (
                          <span className="ml-2 text-orange-500 normal-case font-normal">(ninguno registrado)</span>
                        )}
                      </label>
                      <select value={form.vendorId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01]
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, vendorId: e.target.value })}>
                        <option value="">-- PROVEEDOR --</option>
                        {fuelVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* TRANSFERENCIA */}
                {operationMode === 'TRANSFER' && (
                  <div className="grid grid-cols-2 gap-6 bg-[#E1AD01]/5 border border-[#E1AD01]/20 p-4 rounded-2xl">
                    <div className="space-y-2">
                      <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block">
                        Aeronave Origen
                      </label>
                      <select required value={form.aircraftId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, aircraftId: e.target.value })}>
                        <option value="">-- SELECCIONAR --</option>
                        {fleet.map(a => {
                          const id    = getAircraftId(a);
                          const saldo = aircraftStock[id] ?? 0;
                          return (
                            <option key={a.id} value={id} disabled={saldo <= 0}>
                              {id} — {fmtLts(saldo)} LTS{saldo <= 0 ? ' (sin stock)' : ''}
                            </option>
                          );
                        })}
                      </select>
                      {form.aircraftId && (
                        <p className="text-[8px] text-[#E1AD01]/70 font-black">
                          Disponible: <span className="text-[#E1AD01]">{fmtLts(aircraftStock[form.aircraftId] ?? 0)} LTS</span>
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest block">
                        Aeronave Destino
                      </label>
                      <select required value={form.destinationAircraftId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, destinationAircraftId: e.target.value })}>
                        <option value="">-- SELECCIONAR --</option>
                        {fleet
                          .filter(a => getAircraftId(a) !== form.aircraftId)
                          .map(a => (
                            <option key={a.id} value={getAircraftId(a)}>{getAircraftLabel(a)}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* PRESENTACIÓN */}
                {operationMode === 'IN' && (
                  <div className="grid grid-cols-2 gap-6 bg-white/[0.02] border border-white/10 p-4 rounded-2xl">
                    <div className="space-y-2">
                      <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <Container className="h-3 w-3" /> Presentación
                      </label>
                      <select value={form.presentation}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => handlePresentationChange(e.target.value as PresentationType)}>
                        {PRESENTATION_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    {isUnitBased ? (
                      <div className="space-y-2">
                        <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest block">
                          Cantidad de Unidades
                        </label>
                        <input type="number" step="1" min="1" required value={form.unitCount || ''}
                          className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                     text-[10px] outline-none focus:border-[#E1AD01]"
                          onChange={e => handleUnitCountChange(parseInt(e.target.value) || 0)} />
                        <p className="text-[8px] text-slate-500 normal-case">
                          {form.unitCount || 0} × {selectedPresentation?.litersPerUnit} LTS ={' '}
                          <span className="text-[#E1AD01] font-black">{fmtLts(form.liters)} LTS</span>
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest block">
                          Tipo de Combustible
                        </label>
                        <select value={form.fuelType}
                          className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                     text-white text-[10px] outline-none
                                     [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                          onChange={e => setForm({ ...form, fuelType: e.target.value })}>
                          <option value="AVGAS 100LL">AVGAS 100LL</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* VOLUMEN + TICKET */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] text-white font-black uppercase tracking-widest block">
                      Volumen (LTS)
                      {operationMode === 'IN' && isUnitBased && (
                        <span className="text-[8px] text-slate-500 normal-case ml-2">(auto)</span>
                      )}
                    </label>
                    <input type="number" step="0.1" min="0.1" required value={form.liters || ''}
                      readOnly={operationMode === 'IN' && isUnitBased}
                      className={`w-full bg-black border border-white/10 p-4 text-3xl font-black
                                 text-white outline-none focus:border-[#E1AD01] rounded-xl
                                 ${operationMode === 'IN' && isUnitBased ? 'opacity-60 cursor-not-allowed' : ''}`}
                      onChange={e => setForm({ ...form, liters: parseFloat(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Ticket #</label>
                    <input required value={form.ticketNumber}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none uppercase focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, ticketNumber: e.target.value })} />
                  </div>
                </div>

                {/* SEDE + AUDITOR */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Sede</label>
                    <select value={form.location}
                      className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                 text-white text-[10px] outline-none
                                 [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                      onChange={e => setForm({ ...form, location: e.target.value })}>
                      <option value="Barquisimeto">Barquisimeto</option>
                      <option value="Maturín">Maturín</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">Auditor</label>
                    <input required value={form.technician}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none uppercase focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, technician: e.target.value })} />
                  </div>
                </div>

                {/* HOBBS (solo TRANSFERENCIA) */}
                {operationMode === 'TRANSFER' && (
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Hobbs Aeronave Destino
                    </label>
                    <input type="number" step="0.1" value={form.hobbsAtCharge || ''}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, hobbsAtCharge: parseFloat(e.target.value) })} />
                  </div>
                )}

                {/* SUBMIT */}
                <button type="submit" disabled={loading}
                  className={`w-full font-black py-6 rounded-3xl mt-4 uppercase text-[11px]
                    tracking-[0.5em] shadow-2xl flex items-center justify-center gap-3
                    transition-all disabled:opacity-40
                    ${editingRecord
                      ? 'bg-white/10 border border-[#E1AD01]/40 text-[#E1AD01] hover:bg-[#E1AD01]/20'
                      : operationMode === 'IN'
                        ? 'bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30'
                        : 'bg-[#E1AD01] text-black hover:bg-white'}`}>
                  {loading ? <Loader2 className="animate-spin h-5 w-5" />
                  : editingRecord ? <Pencil className="h-5 w-5" />
                  : operationMode === 'IN' ? <ArrowDownToLine className="h-5 w-5" />
                  : <ShieldCheck className="h-5 w-5" />}
                  {loading ? 'SINCRO…'
                  : editingRecord ? 'GUARDAR CAMBIOS'
                  : operationMode === 'IN' ? 'CERTIFICAR ENTRADA'
                  : 'CERTIFICAR TRANSFERENCIA'}
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
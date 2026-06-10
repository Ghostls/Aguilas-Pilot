// src/components/FuelPanel.tsx
// Evolución Grado Militar - Valkyron OS v3.0
// NUEVA FUNCIÓN: Edición de registros existentes (todos los campos, cualquier usuario)
// FIX v2.0 preservado: Unidad GAL → LTS en toda la interfaz y lógica

import React, { useState, useEffect, useCallback } from 'react';
import { Vendor, HangarLocation } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  PlusCircle, X, History, Loader2, Warehouse,
  Plane, ShieldCheck, Pencil
} from 'lucide-react';

interface FuelPanelProps {
  fleet?: any[];
  vendors?: Vendor[];
}

// ── Tipo para el registro tal como viene de Supabase ──────────────────────────
interface FuelRecord {
  id: string;
  operation_type: 'IN' | 'OUT';
  aircraft_id: string;
  liters: number;
  fuel_type: string;
  location: string;
  vendor_id: string | null;
  ticket_number: string;
  technician: string;
  hobbs_at_charge: number | null;
  created_at: string;
}

// ── Estado del formulario (nuevo + edición) ───────────────────────────────────
interface RecordForm {
  aircraftId:    string;
  liters:        number;
  fuelType:      string;
  location:      HangarLocation;
  vendorId:      string;
  ticketNumber:  string;
  technician:    string;
  hobbsAtCharge: number;
}

const EMPTY_FORM: RecordForm = {
  aircraftId:    '',
  liters:        0,
  fuelType:      'AVGAS 100LL',
  location:      'Lara',
  vendorId:      '',
  ticketNumber:  '',
  technician:    '',
  hobbsAtCharge: 0,
};

export const FuelPanel: React.FC<FuelPanelProps> = ({ fleet = [], vendors = [] }) => {
  const [activeMode, setActiveMode] = useState<'AIRCRAFT' | 'HANGAR'>('AIRCRAFT');
  const [isAdding, setIsAdding]     = useState(false);
  const [records, setRecords]       = useState<FuelRecord[]>([]);
  const [stockStatus, setStockStatus] = useState({ lara: 0, maturin: 0 });
  const [loading, setLoading]       = useState(false);

  // ── Estado de edición ──────────────────────────────────────────────────────
  const [editingRecord, setEditingRecord] = useState<FuelRecord | null>(null);

  const [form, setForm] = useState<RecordForm>(EMPTY_FORM);

  const fuelVendors = vendors.filter(v =>
    v.category.includes('Consumibles') || v.category.includes('Servicios Técnicos')
  );

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchGlobalFuelData = useCallback(async () => {
    try {
      const { data: allLogs, error } = await supabase
        .from('registros_combustible')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      if (allLogs) {
        const calculateStock = (loc: string) =>
          allLogs
            .filter(r => r.location?.toLowerCase() === loc.toLowerCase())
            .reduce((acc, curr) =>
              curr.operation_type === 'IN'
                ? acc + Number(curr.liters)
                : acc - Number(curr.liters),
              0
            );

        setStockStatus({
          lara:    calculateStock('lara'),
          maturin: calculateStock('maturín'),
        });
        setRecords(allLogs.slice(0, 15));
      }
    } catch (err) { console.error("ERROR TELEMETRÍA:", err); }
  }, []);

  useEffect(() => { fetchGlobalFuelData(); }, [fetchGlobalFuelData]);

  // ── Abrir modal para NUEVO registro ───────────────────────────────────────
  const openNew = (mode: 'AIRCRAFT' | 'HANGAR') => {
    setEditingRecord(null);
    setActiveMode(mode);
    setForm(EMPTY_FORM);
    setIsAdding(true);
  };

  // ── Abrir modal para EDITAR registro existente ────────────────────────────
  const openEdit = (r: FuelRecord) => {
    setEditingRecord(r);
    setActiveMode(r.operation_type === 'IN' ? 'HANGAR' : 'AIRCRAFT');
    setForm({
      aircraftId:    r.aircraft_id === 'STOCK_HANGAR' ? '' : r.aircraft_id,
      liters:        Number(r.liters),
      fuelType:      r.fuel_type,
      location:      r.location as HangarLocation,
      vendorId:      r.vendor_id ?? '',
      ticketNumber:  r.ticket_number,
      technician:    r.technician,
      hobbsAtCharge: r.hobbs_at_charge ?? 0,
    });
    setIsAdding(true);
  };

  const closeModal = () => {
    setIsAdding(false);
    setEditingRecord(null);
    setForm(EMPTY_FORM);
  };

  // ── Submit: INSERT o UPDATE ────────────────────────────────────────────────
  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const isEditing = editingRecord !== null;

    const dbEntry = {
      operation_type: activeMode === 'HANGAR' ? 'IN' : 'OUT',
      aircraft_id:    activeMode === 'AIRCRAFT' ? form.aircraftId.toUpperCase() : 'STOCK_HANGAR',
      liters:         Number(form.liters),
      fuel_type:      String(form.fuelType),
      location:       String(form.location),
      vendor_id:      form.vendorId || null,
      ticket_number:  String(form.ticketNumber).toUpperCase(),
      technician:     String(form.technician).toUpperCase(),
      hobbs_at_charge: activeMode === 'AIRCRAFT' ? Number(form.hobbsAtCharge) : null,
    };

    let error = null;

    if (isEditing) {
      // UPDATE
      const { error: updateErr } = await supabase
        .from('registros_combustible')
        .update(dbEntry)
        .eq('id', editingRecord.id);
      error = updateErr;
    } else {
      // INSERT
      const { error: insertErr } = await supabase
        .from('registros_combustible')
        .insert([dbEntry]);
      error = insertErr;
    }

    if (error) {
      alert(`FALLA TÁCTICA: ${error.message}`);
      console.error(error);
    } else {
      await fetchGlobalFuelData();
      closeModal();
      alert(
        isEditing
          ? `[VALKYRON OPS] Registro actualizado con éxito.`
          : `[VALKYRON OPS] Movimiento ${activeMode} certificado.`
      );
    }
    setLoading(false);
  };

  const TANK_CAPACITY_LTS = 10000;

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans text-white">

      {/* ── KPI TANQUES ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Tanque Lara */}
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 p-6 rounded-3xl">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-2">
            Tanque Lara
          </p>
          <div className="flex items-end gap-2">
            <h3 className="text-4xl font-black text-[#E1AD01] font-mono">
              {stockStatus.lara.toFixed(1)}
            </h3>
            <span className="text-[10px] text-[#E1AD01]/40 font-black mb-1">LTS</span>
          </div>
          <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E1AD01] transition-all duration-700"
              style={{ width: `${Math.min((stockStatus.lara / TANK_CAPACITY_LTS) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Tanque Maturín */}
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 p-6 rounded-3xl">
          <p className="text-[10px] text-white/50 font-black uppercase tracking-[0.2em] mb-2">
            Tanque Maturín
          </p>
          <div className="flex items-end gap-2">
            <h3 className="text-4xl font-black text-[#E1AD01] font-mono">
              {stockStatus.maturin.toFixed(1)}
            </h3>
            <span className="text-[10px] text-[#E1AD01]/40 font-black mb-1">LTS</span>
          </div>
          <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E1AD01] transition-all duration-700"
              style={{ width: `${Math.min((stockStatus.maturin / TANK_CAPACITY_LTS) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Botones acción */}
        <div className="grid grid-cols-1 gap-2">
          <button
            onClick={() => openNew('HANGAR')}
            className="bg-white/5 hover:bg-[#E1AD01]/10 text-white p-4 rounded-2xl border border-white/10
                       flex items-center gap-4 transition-all"
          >
            <Warehouse className="h-5 w-5 text-[#E1AD01]" />
            <span className="text-[9px] font-black uppercase tracking-widest">Entrada Stock</span>
          </button>
          <button
            onClick={() => openNew('AIRCRAFT')}
            className="bg-[#E1AD01] hover:bg-white text-black p-4 rounded-2xl flex items-center gap-4 transition-all"
          >
            <Plane className="h-5 w-5" />
            <span className="text-[9px] font-black tracking-widest italic uppercase">Despacho Avión</span>
          </button>
        </div>
      </div>

      {/* ── BITÁCORA ── */}
      <div className="bg-[#050505] border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/5 bg-white/[0.01] flex justify-between items-center">
          <h3 className="text-white font-black text-[10px] uppercase tracking-[0.4em] italic flex items-center gap-2">
            <History className="h-4 w-4 text-[#E1AD01]" /> Bitácora de Suministro Unificada
          </h3>
        </div>
        <table className="w-full font-mono text-left text-[10px]">
          <thead className="text-slate-600 uppercase tracking-widest bg-white/[0.02] border-b border-white/5">
            <tr>
              <th className="p-5">Unidad</th>
              <th className="p-5">Cant.</th>
              <th className="p-5">Sede</th>
              <th className="p-5">Firma</th>
              {/* ── NUEVA COLUMNA EDITAR ── */}
              <th className="p-5 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {records.map(r => (
              <tr key={r.id} className="hover:bg-white/[0.01] transition-colors group">
                <td className="p-5 font-black uppercase text-white">
                  <span className={r.operation_type === 'IN' ? 'text-green-500 mr-2' : 'text-[#E1AD01] mr-2'}>
                    {r.operation_type === 'IN' ? '▲' : '▼'}
                  </span>
                  {r.aircraft_id}
                  <span className="block text-[7px] text-slate-500 font-normal">
                    Ticket: {r.ticket_number}
                  </span>
                </td>
                <td className={`p-5 font-black ${r.operation_type === 'IN' ? 'text-green-500' : 'text-[#E1AD01]'}`}>
                  {r.operation_type === 'IN' ? '+' : '-'}
                  {Number(r.liters ?? 0).toFixed(1)} LTS
                </td>
                <td className="p-5 text-slate-400 font-bold uppercase">{r.location}</td>
                <td className="p-5 text-slate-600 italic uppercase font-black">{r.technician}</td>

                {/* ── BOTÓN EDITAR ── */}
                <td className="p-5 text-right">
                  <button
                    onClick={() => openEdit(r)}
                    title="Editar registro"
                    className="
                      inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                      border border-white/10 text-slate-500
                      hover:border-[#E1AD01]/60 hover:text-[#E1AD01]
                      opacity-0 group-hover:opacity-100
                      transition-all duration-200
                      text-[8px] font-black uppercase tracking-widest
                    "
                  >
                    <Pencil className="h-3 w-3" />
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MODAL REGISTRO / EDICIÓN ── */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <Card className="bg-[#050505] border border-[#E1AD01]/30 w-full max-w-xl shadow-2xl rounded-[2.5rem] overflow-hidden">

            {/* Header — color distinto si es edición */}
            <CardHeader
              className={`p-6 flex justify-between items-center ${
                editingRecord
                  ? 'bg-white/10 border-b border-[#E1AD01]/20'
                  : 'bg-[#E1AD01]'
              }`}
            >
              <CardTitle
                className={`text-[11px] font-black uppercase tracking-[0.4em] italic flex items-center gap-2 ${
                  editingRecord ? 'text-[#E1AD01]' : 'text-black'
                }`}
              >
                {editingRecord ? (
                  <>
                    <Pencil className="h-4 w-4" />
                    EDITAR REGISTRO
                  </>
                ) : activeMode === 'HANGAR' ? (
                  <><Warehouse className="h-4 w-4" /> ORDEN DE RECEPCIÓN</>
                ) : (
                  <><Plane className="h-4 w-4" /> ORDEN DE DESPACHO</>
                )}
              </CardTitle>

              {/* Badge ID del registro que se edita */}
              {editingRecord && (
                <span className="text-[8px] text-slate-500 font-mono mr-auto ml-3">
                  #{editingRecord.id.slice(0, 8).toUpperCase()}
                </span>
              )}

              <button
                onClick={closeModal}
                className={`hover:rotate-90 transition-all ${editingRecord ? 'text-white' : 'text-black'}`}
              >
                <X className="h-6 w-6" />
              </button>
            </CardHeader>

            <CardContent className="p-10 text-white">
              <form onSubmit={handleAction} className="space-y-6 font-mono">

                {/* Objetivo / Avión */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-widest block">
                      Objetivo
                    </label>
                    {activeMode === 'AIRCRAFT' ? (
                      <select
                        required
                        value={form.aircraftId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, aircraftId: e.target.value })}
                      >
                        <option value="">-- SELECCIONAR --</option>
                        {fleet.map(a => (
                          <option key={a.id} value={a.tailNumber}>{a.tailNumber}</option>
                        ))}
                        {/* Si el registro editado tiene un ID que no está en fleet, mostrarlo igual */}
                        {editingRecord &&
                          editingRecord.aircraft_id !== 'STOCK_HANGAR' &&
                          !fleet.find(a => a.tailNumber === editingRecord.aircraft_id) && (
                            <option value={editingRecord.aircraft_id}>
                              {editingRecord.aircraft_id}
                            </option>
                          )
                        }
                      </select>
                    ) : (
                      <select
                        required
                        value={form.vendorId}
                        className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                   text-white text-[10px] outline-none focus:border-[#E1AD01] uppercase
                                   [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                        onChange={e => setForm({ ...form, vendorId: e.target.value })}
                      >
                        <option value="">-- PROVEEDOR --</option>
                        {fuelVendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Tipo
                    </label>
                    <select
                      value={form.fuelType}
                      className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                 text-white text-[10px] outline-none [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                      onChange={e => setForm({ ...form, fuelType: e.target.value })}
                    >
                      <option value="AVGAS 100LL">AVGAS 100LL</option>
                      <option value="JET-A1">JET-A1</option>
                    </select>
                  </div>
                </div>

                {/* Volumen + Ticket */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] text-white font-black uppercase tracking-widest block">
                      Volumen (LTS)
                    </label>
                    <input
                      type="number" step="1" min="0" required
                      value={form.liters || ''}
                      className="w-full bg-black border border-white/10 p-4 text-3xl font-black
                                 text-white outline-none focus:border-[#E1AD01] rounded-xl"
                      onChange={e => setForm({ ...form, liters: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Ticket #
                    </label>
                    <input
                      required
                      value={form.ticketNumber}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none uppercase focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, ticketNumber: e.target.value })}
                    />
                  </div>
                </div>

                {/* Sede + Auditor */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Sede
                    </label>
                    <select
                      value={form.location}
                      className="w-full bg-[#0d0d0d] border border-white/10 p-4 rounded-xl
                                 text-white text-[10px] outline-none [&>option]:bg-[#0d0d0d] [&>option]:text-white"
                      onChange={e => setForm({ ...form, location: e.target.value as HangarLocation })}
                    >
                      <option value="Lara">Lara</option>
                      <option value="Maturín">Maturín</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Auditor
                    </label>
                    <input
                      required
                      value={form.technician}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none uppercase focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, technician: e.target.value })}
                    />
                  </div>
                </div>

                {/* Hobbs — solo AIRCRAFT */}
                {activeMode === 'AIRCRAFT' && (
                  <div className="space-y-2">
                    <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                      Hobbs
                    </label>
                    <input
                      type="number" step="0.1"
                      value={form.hobbsAtCharge || ''}
                      className="w-full bg-black border border-white/10 p-4 rounded-xl text-white
                                 text-[10px] outline-none focus:border-[#E1AD01]"
                      onChange={e => setForm({ ...form, hobbsAtCharge: parseFloat(e.target.value) })}
                    />
                  </div>
                )}

                {/* CTA */}
                <button
                  type="submit" disabled={loading}
                  className={`
                    w-full font-black py-6 rounded-3xl mt-4 uppercase
                    text-[11px] tracking-[0.5em] shadow-2xl
                    flex items-center justify-center gap-3
                    transition-all disabled:opacity-40
                    ${editingRecord
                      ? 'bg-white/10 border border-[#E1AD01]/40 text-[#E1AD01] hover:bg-[#E1AD01]/20'
                      : 'bg-[#E1AD01] text-black hover:bg-white'
                    }
                  `}
                >
                  {loading
                    ? <Loader2 className="animate-spin h-5 w-5" />
                    : editingRecord
                      ? <Pencil className="h-5 w-5" />
                      : <ShieldCheck className="h-5 w-5" />
                  }
                  {loading
                    ? 'SINCRO...'
                    : editingRecord
                      ? 'GUARDAR CAMBIOS'
                      : 'CERTIFICAR MOVIMIENTO'
                  }
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
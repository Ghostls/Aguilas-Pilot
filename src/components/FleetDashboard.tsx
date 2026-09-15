// src/components/FleetDashboard.tsx
// VALKYRON OS v5.5 — HISTORIAL DE AERONAVE (MRO TRAZABILIDAD)
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v5.5 (sobre v5.4):
//   [FIX] onOpenHistorial cableado al AircraftDetail: cierra el detalle y
//         abre el modal de historial en el dashboard con transición limpia
// v5.4 PRESERVADO:
//   Botón "📜 Historial" en cada AircraftCard → modal con 3 tabs
//   Tab Timeline unificado (órdenes + componentes + inspecciones) con filtros
//   Tab Componentes con auto-cálculo de intervalos y alertas de vida útil
//   Tab Inspecciones con auto-cálculo de próximas fechas/horas
//   Auto-populado: al completar orden aparece automáticamente en el timeline
// v5.3 PRESERVADO: onFleetChange, botón Editar Orden, modal 2 pasos registro
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import React, { useState, useCallback, useEffect } from 'react';
import { Aircraft } from '@/Types/Maintenance';
import AircraftCard from './AircraftCard';
import AircraftDetail from './AircraftDetail';
import { supabase } from '../lib/supabaseClient';
import {
  Plane, Plus, X, Gauge, ShieldCheck, Loader2,
  Wrench, ShieldAlert, AlertCircle, Pencil, PlusCircle,
  ClipboardList, CheckCircle2, History, Package, FileCheck,
  Clock, Calendar, AlertTriangle, Cog, Filter, Droplet, Zap,
  ChevronDown, ChevronRight, FileText,
} from 'lucide-react';

// ─── NORMALIZACIÓN ────────────────────────────────────────────────────────────

const normalizeAircraftStatus = (
  rawStatus: string
): 'operational' | 'maintenance' | 'grounded' | 'flight' => {
  if (!rawStatus) return 'operational';
  const s = rawStatus.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight'))               return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  return 'operational';
};

const SELECT_CLS = `w-full bg-[#0d0d0d] border border-white/10 rounded-xl p-4 text-white text-[10px]
  font-black outline-none focus:border-[#E1AD01] transition-all
  [&>option]:bg-[#0d0d0d] [&>option]:text-white`;

const INPUT_CLS = `w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs
  uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 font-mono`;

const RAZONES_PREDEFINIDAS = [
  'Mantenimiento Preventivo 100H',
  'Mantenimiento Preventivo 200H',
  'Inspección Anual (IA)',
  'Falla de Motor',
  'Falla de Aviónica',
  'Falla Hidráulica',
  'Daño en Tren de Aterrizaje',
  'AOG — Falla Crítica',
  'Cambio de Aceite / Filtros',
  'Inspección Post-Vuelo',
  'Otra (especificar)',
];

// v5.4 — Tipos de componentes con intervalos típicos de aviación GA
type TipoComponente = {
  key: string;
  label: string;
  intervalo_horas: number | null;
  intervalo_meses: number | null;
};

const TIPOS_COMPONENTE: TipoComponente[] = [
  { key: 'ACEITE',        label: 'Aceite Motor',      intervalo_horas: 50,  intervalo_meses: null },
  { key: 'FILTRO_ACEITE', label: 'Filtro de Aceite',  intervalo_horas: 50,  intervalo_meses: null },
  { key: 'FILTRO_AIRE',   label: 'Filtro de Aire',    intervalo_horas: 100, intervalo_meses: null },
  { key: 'BUJIAS',        label: 'Bujías',            intervalo_horas: 100, intervalo_meses: null },
  { key: 'MAGNETOS',      label: 'Magnetos',          intervalo_horas: 500, intervalo_meses: null },
  { key: 'NEUMATICOS',    label: 'Neumáticos',        intervalo_horas: 300, intervalo_meses: null },
  { key: 'BATERIA',       label: 'Batería',           intervalo_horas: null, intervalo_meses: 24 },
  { key: 'OTRO',          label: 'Otro Componente',   intervalo_horas: null, intervalo_meses: null },
];

type TipoInspeccion = {
  key: string;
  label: string;
  intervalo_horas: number | null;
  intervalo_meses: number | null;
};

const TIPOS_INSPECCION: TipoInspeccion[] = [
  { key: '100H',      label: 'Inspección 100 Horas',    intervalo_horas: 100, intervalo_meses: null },
  { key: '50H',       label: 'Servicio 50 Horas',        intervalo_horas: 50,  intervalo_meses: null },
  { key: 'IA',        label: 'Inspección Anual (IA)',   intervalo_horas: null, intervalo_meses: 12 },
  { key: 'ANUAL',     label: 'Inspección Anual',         intervalo_horas: null, intervalo_meses: 12 },
  { key: 'AVIONICA',  label: 'Inspección de Aviónica',  intervalo_horas: null, intervalo_meses: 24 },
  { key: 'MOTOR',     label: 'Inspección de Motor',     intervalo_horas: 500, intervalo_meses: null },
  { key: 'AD_NOTE',   label: 'Cumplimiento AD Note',    intervalo_horas: null, intervalo_meses: null },
  { key: 'OTRO',      label: 'Otra Inspección',          intervalo_horas: null, intervalo_meses: null },
];

const iconoComponente = (tipo: string) => {
  switch (tipo) {
    case 'ACEITE':        return Droplet;
    case 'FILTRO_ACEITE':
    case 'FILTRO_AIRE':   return Filter;
    case 'BUJIAS':
    case 'MAGNETOS':
    case 'BATERIA':       return Zap;
    case 'NEUMATICOS':    return Cog;
    default:              return Package;
  }
};

// ─── TIPOS INTERNOS ───────────────────────────────────────────────────────────

interface OrdenExistente {
  id:                string;
  matricula:         string;
  modelo:            string;
  descripcion_tarea: string;
  nombre_mecanico:   string;
  observaciones:     string;
  estado:            string;
  sede:              string;
}

interface RegistroHistorial {
  registro_id:      string;
  matricula:        string;
  tipo_registro:    'ORDEN' | 'COMPONENTE' | 'INSPECCION';
  fecha_registro:   string;
  titulo:           string;
  mecanico:         string | null;
  detalle:          string;
  horas_aeronave:   number | null;
  proxima_horas:    number | null;
  proxima_fecha:    string | null;
  estado:           string;
  tipo_especifico:  string | null;
}

interface ComponenteVigente {
  id:                     string;
  matricula:              string;
  tipo_componente:        string;
  descripcion:            string;
  parte_numero:           string | null;
  fecha_instalacion:      string;
  horas_al_instalar:      number;
  intervalo_horas:        number | null;
  intervalo_meses:        number | null;
  proxima_horas:          number | null;
  proxima_fecha:          string | null;
  horas_actuales_aeronave:number;
  horas_restantes:        number | null;
  mecanico:               string | null;
}

interface InspeccionProxima {
  matricula:        string;
  tipo_inspeccion:  string;
  descripcion:      string;
  ultima_realizada: string;
  horas_ultima:     number;
  proxima_horas:    number | null;
  proxima_fecha:    string | null;
  horas_actuales:   number;
  horas_restantes:  number | null;
  dias_restantes:   number | null;
}

// ─── COMPONENTE ───────────────────────────────────────────────────────────────

const FleetDashboard = ({
  fleetData,
  setFleetData,
  onFleetChange,
}: {
  fleetData:      Aircraft[];
  setFleetData:   React.Dispatch<React.SetStateAction<Aircraft[]>>;
  onFleetChange?: () => Promise<void>;
}) => {
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [isModalOpen,      setIsModalOpen]     = useState(false);
  const [isRazonOpen,      setIsRazonOpen]     = useState(false);
  const [isEditOpen,       setIsEditOpen]      = useState(false);
  const [loading,          setLoading]         = useState(false);
  const [pendingAircraft,  setPendingAircraft] = useState<any>(null);

  const [ordenEditing, setOrdenEditing] = useState<OrdenExistente | null>(null);
  const [editForm, setEditForm] = useState({
    nuevosHallazgos: '',
    mecanico:        '',
    estado:          'In Progress' as string,
  });

  const [newAircraft, setNewAircraft] = useState({
    tailNumber:  '',
    model:       '',
    totalHours:  0,
    status:      'operational' as 'operational' | 'maintenance' | 'grounded' | 'flight',
    sede:        'LARA' as 'LARA' | 'MATURIN',
  });

  const [razonForm, setRazonForm] = useState({
    razon:       '',
    razonCustom: '',
    mecanico:    '',
    descripcion: '',
  });

  // v5.4 — ESTADOS DE HISTORIAL
  const [historialModal, setHistorialModal] = useState<Aircraft | null>(null);
  const [historialTab,   setHistorialTab]   = useState<'timeline' | 'componentes' | 'inspecciones'>('timeline');
  const [historial,      setHistorial]      = useState<RegistroHistorial[]>([]);
  const [componentes,    setComponentes]    = useState<ComponenteVigente[]>([]);
  const [inspecciones,   setInspecciones]   = useState<InspeccionProxima[]>([]);
  const [loadingHist,    setLoadingHist]    = useState(false);
  const [filtroTipo,     setFiltroTipo]     = useState<'TODO' | 'ORDEN' | 'COMPONENTE' | 'INSPECCION'>('TODO');
  const [expandedItem,   setExpandedItem]   = useState<string | null>(null);

  const [showComponenteForm, setShowComponenteForm] = useState(false);
  const [componenteForm, setComponenteForm] = useState({
    tipo_componente:   'ACEITE',
    descripcion:       'Aceite Motor',
    parte_numero:      '',
    horas_aeronave:    '',
    intervalo_horas:   '50',
    intervalo_meses:   '',
    mecanico:          '',
    observaciones:     '',
    fecha_instalacion: new Date().toISOString().split('T')[0],
  });

  const [showInspeccionForm, setShowInspeccionForm] = useState(false);
  const [inspeccionForm, setInspeccionForm] = useState({
    tipo_inspeccion:    '100H',
    descripcion:        'Inspección 100 Horas',
    horas_aeronave:     '',
    proxima_horas:      '',
    proxima_fecha:      '',
    mecanico:           '',
    certificado_numero: '',
    hallazgos:          '',
    observaciones:      '',
    fecha_realizada:    new Date().toISOString().split('T')[0],
  });

  const razonFinal = razonForm.razon === 'Otra (especificar)'
    ? razonForm.razonCustom.trim()
    : razonForm.razon;

  // ── v5.4: FETCH HISTORIAL ─────────────────────────────────────────────────

  const fetchHistorial = useCallback(async (matricula: string) => {
    setLoadingHist(true);
    try {
      const [histRes, compRes, inspRes] = await Promise.all([
        supabase.from('v_historial_aeronave').select('*').eq('matricula', matricula),
        supabase.from('v_componentes_vigentes').select('*').eq('matricula', matricula).order('horas_restantes', { ascending: true }),
        supabase.from('v_proximas_inspecciones').select('*').eq('matricula', matricula),
      ]);
      if (histRes.error) console.warn('[v5.5] historial:', histRes.error.message);
      if (compRes.error) console.warn('[v5.5] componentes:', compRes.error.message);
      if (inspRes.error) console.warn('[v5.5] inspecciones:', inspRes.error.message);

      setHistorial((histRes.data ?? []) as RegistroHistorial[]);
      setComponentes((compRes.data ?? []) as ComponenteVigente[]);
      setInspecciones((inspRes.data ?? []) as InspeccionProxima[]);
    } finally {
      setLoadingHist(false);
    }
  }, []);

  const abrirHistorial = useCallback((ac: Aircraft) => {
    setHistorialModal(ac);
    setHistorialTab('timeline');
    setFiltroTipo('TODO');
    setExpandedItem(null);
    setShowComponenteForm(false);
    setShowInspeccionForm(false);
    const matricula = ac.tailNumber ?? (ac as any).matricula;
    fetchHistorial(matricula);
  }, [fetchHistorial]);

  const cerrarHistorial = () => {
    setHistorialModal(null);
    setHistorial([]);
    setComponentes([]);
    setInspecciones([]);
    setShowComponenteForm(false);
    setShowInspeccionForm(false);
  };

  // ── v5.4: PRE-LLENAR HORAS ACTUALES DE LA AERONAVE ────────────────────────

  useEffect(() => {
    if (historialModal && showComponenteForm) {
      const horasActuales = (historialModal as any).hoursFlown ?? (historialModal as any).horas_vuelo_totales ?? 0;
      if (!componenteForm.horas_aeronave) {
        setComponenteForm(prev => ({ ...prev, horas_aeronave: String(horasActuales) }));
      }
    }
  }, [historialModal, showComponenteForm, componenteForm.horas_aeronave]);

  useEffect(() => {
    if (historialModal && showInspeccionForm) {
      const horasActuales = (historialModal as any).hoursFlown ?? (historialModal as any).horas_vuelo_totales ?? 0;
      if (!inspeccionForm.horas_aeronave) {
        setInspeccionForm(prev => ({ ...prev, horas_aeronave: String(horasActuales) }));
      }
    }
  }, [historialModal, showInspeccionForm, inspeccionForm.horas_aeronave]);

  // ── v5.4: AUTO-CALCULAR INTERVALOS AL SELECCIONAR TIPO ────────────────────

  const handleTipoComponenteChange = (tipo: string) => {
    const meta = TIPOS_COMPONENTE.find(t => t.key === tipo);
    if (!meta) return;
    setComponenteForm(prev => ({
      ...prev,
      tipo_componente: tipo,
      descripcion:     meta.label,
      intervalo_horas: meta.intervalo_horas != null ? String(meta.intervalo_horas) : '',
      intervalo_meses: meta.intervalo_meses != null ? String(meta.intervalo_meses) : '',
    }));
  };

  const handleTipoInspeccionChange = (tipo: string) => {
    const meta = TIPOS_INSPECCION.find(t => t.key === tipo);
    if (!meta) return;
    const horasActuales = parseFloat(inspeccionForm.horas_aeronave) || 0;
    let proximaHoras = '';
    let proximaFecha = '';
    if (meta.intervalo_horas) {
      proximaHoras = String(horasActuales + meta.intervalo_horas);
    }
    if (meta.intervalo_meses) {
      const d = new Date();
      d.setMonth(d.getMonth() + meta.intervalo_meses);
      proximaFecha = d.toISOString().split('T')[0];
    }
    setInspeccionForm(prev => ({
      ...prev,
      tipo_inspeccion: tipo,
      descripcion:     meta.label,
      proxima_horas:   proximaHoras,
      proxima_fecha:   proximaFecha,
    }));
  };

  // ── v5.4: GUARDAR COMPONENTE (marca los anteriores del tipo como retirados) ─

  const handleGuardarComponente = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historialModal) return;

    const matricula = historialModal.tailNumber ?? (historialModal as any).matricula;
    const horas = parseFloat(componenteForm.horas_aeronave);
    if (isNaN(horas) || horas < 0) { alert('Horas de aeronave inválidas.'); return; }
    if (!componenteForm.descripcion.trim()) { alert('Descripción obligatoria.'); return; }

    setLoadingHist(true);
    try {
      // 1. Retirar componentes anteriores del mismo tipo
      await supabase.from('componentes_aeronave').update({
        activo:       false,
        fecha_retiro: new Date().toISOString().split('T')[0],
        horas_retiro: horas,
      }).eq('matricula', matricula).eq('tipo_componente', componenteForm.tipo_componente).eq('activo', true);

      // 2. Insertar nuevo componente activo
      const { error } = await supabase.from('componentes_aeronave').insert([{
        matricula,
        tipo_componente:   componenteForm.tipo_componente,
        descripcion:       componenteForm.descripcion.toUpperCase().trim(),
        parte_numero:      componenteForm.parte_numero.trim() || null,
        fecha_instalacion: componenteForm.fecha_instalacion,
        horas_aeronave:    horas,
        intervalo_horas:   componenteForm.intervalo_horas ? parseFloat(componenteForm.intervalo_horas) : null,
        intervalo_meses:   componenteForm.intervalo_meses ? parseInt(componenteForm.intervalo_meses)   : null,
        mecanico:          componenteForm.mecanico.trim() || null,
        observaciones:     componenteForm.observaciones.trim() || null,
        activo:            true,
      }]);
      if (error) throw error;

      setShowComponenteForm(false);
      setComponenteForm({
        tipo_componente: 'ACEITE', descripcion: 'Aceite Motor', parte_numero: '',
        horas_aeronave: String(horas), intervalo_horas: '50', intervalo_meses: '',
        mecanico: '', observaciones: '', fecha_instalacion: new Date().toISOString().split('T')[0],
      });
      await fetchHistorial(matricula);
      alert('✓ Componente registrado en el historial.');
    } catch (err: any) {
      alert('Error al registrar componente: ' + err.message);
    } finally {
      setLoadingHist(false);
    }
  };

  // ── v5.4: GUARDAR INSPECCIÓN ──────────────────────────────────────────────

  const handleGuardarInspeccion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historialModal) return;

    const matricula = historialModal.tailNumber ?? (historialModal as any).matricula;
    const horas = parseFloat(inspeccionForm.horas_aeronave);
    if (isNaN(horas) || horas < 0) { alert('Horas de aeronave inválidas.'); return; }
    if (!inspeccionForm.descripcion.trim()) { alert('Descripción obligatoria.'); return; }

    setLoadingHist(true);
    try {
      const { error } = await supabase.from('inspecciones_aeronave').insert([{
        matricula,
        tipo_inspeccion:    inspeccionForm.tipo_inspeccion,
        descripcion:        inspeccionForm.descripcion.toUpperCase().trim(),
        fecha_realizada:    inspeccionForm.fecha_realizada,
        horas_aeronave:     horas,
        proxima_horas:      inspeccionForm.proxima_horas ? parseFloat(inspeccionForm.proxima_horas) : null,
        proxima_fecha:      inspeccionForm.proxima_fecha || null,
        mecanico:           inspeccionForm.mecanico.trim() || null,
        certificado_numero: inspeccionForm.certificado_numero.trim() || null,
        hallazgos:          inspeccionForm.hallazgos.trim() || null,
        observaciones:      inspeccionForm.observaciones.trim() || null,
        aprobada:           true,
      }]);
      if (error) throw error;

      setShowInspeccionForm(false);
      setInspeccionForm({
        tipo_inspeccion: '100H', descripcion: 'Inspección 100 Horas', horas_aeronave: String(horas),
        proxima_horas: '', proxima_fecha: '', mecanico: '', certificado_numero: '',
        hallazgos: '', observaciones: '', fecha_realizada: new Date().toISOString().split('T')[0],
      });
      await fetchHistorial(matricula);
      alert('✓ Inspección registrada en el historial.');
    } catch (err: any) {
      alert('Error al registrar inspección: ' + err.message);
    } finally {
      setLoadingHist(false);
    }
  };

  // ── ABRIR MODAL DE EDICIÓN ────────────────────────────────────────────────

  const handleEditarMantenimiento = async (ac: Aircraft) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ordenes_trabajo').select('*')
        .eq('matricula', ac.tailNumber ?? (ac as any).matricula)
        .order('created_at', { ascending: false }).limit(1).single();

      if (error || !data) {
        alert('No se encontró una orden de trabajo activa para esta aeronave.');
        return;
      }
      setOrdenEditing(data as OrdenExistente);
      setEditForm({
        nuevosHallazgos: '',
        mecanico:        data.nombre_mecanico ?? '',
        estado:          data.estado ?? 'In Progress',
      });
      setIsEditOpen(true);
    } catch (err: any) {
      alert('Error al cargar la orden: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── GUARDAR EDICIÓN ───────────────────────────────────────────────────────

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ordenEditing) return;
    if (
      !editForm.nuevosHallazgos.trim() &&
      editForm.mecanico === ordenEditing.nombre_mecanico &&
      editForm.estado   === ordenEditing.estado
    ) {
      alert('No hay cambios para guardar.');
      return;
    }
    setLoading(true);
    try {
      const timestamp = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const obsActual = ordenEditing.observaciones ?? '';
      const obsNueva  = editForm.nuevosHallazgos.trim()
        ? `${obsActual}\n[${timestamp}] NUEVO HALLAZGO: ${editForm.nuevosHallazgos.trim().toUpperCase()}`
        : obsActual;

      const { error } = await supabase
        .from('ordenes_trabajo').update({
          nombre_mecanico: editForm.mecanico.trim() || ordenEditing.nombre_mecanico,
          estado:          editForm.estado,
          observaciones:   obsNueva,
        }).eq('id', ordenEditing.id);
      if (error) throw error;

      setIsEditOpen(false);
      setOrdenEditing(null);
      setEditForm({ nuevosHallazgos: '', mecanico: '', estado: 'In Progress' });
      alert(
        `✓ Orden de trabajo actualizada.\n` +
        (editForm.nuevosHallazgos ? 'Hallazgo registrado con timestamp.' : 'Datos actualizados.')
      );
      await onFleetChange?.();
    } catch (err: any) {
      alert('Error al actualizar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── FLUJO DE REGISTRO DE AERONAVE ─────────────────────────────────────────

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newAircraft.status === 'maintenance') {
      setPendingAircraft({ ...newAircraft });
      setIsModalOpen(false);
      setRazonForm({ razon: '', razonCustom: '', mecanico: '', descripcion: '' });
      setIsRazonOpen(true);
    } else {
      insertAircraft({ ...newAircraft }, null);
    }
  };

  const handleRazonConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!razonFinal) {
      alert('PROTOCOLO: Especifica la razón de entrada a hangar.');
      return;
    }
    if (!pendingAircraft) return;
    await insertAircraft(pendingAircraft, {
      razon:       razonFinal,
      mecanico:    razonForm.mecanico,
      descripcion: razonForm.descripcion,
    });
    setIsRazonOpen(false);
    setPendingAircraft(null);
  };

  const insertAircraft = async (
    ac: typeof newAircraft,
    hangarData: { razon: string; mecanico: string; descripcion: string } | null
  ) => {
    setLoading(true);
    const dbEntry = {
      matricula:           ac.tailNumber.toUpperCase(),
      modelo:              ac.model.toUpperCase(),
      estado:              ac.status,
      horas_vuelo_totales: ac.totalHours,
      sede:                ac.sede,
    };
    const { data, error } = await supabase.from('flota_aviones').insert([dbEntry]).select();
    if (error) {
      alert('ERROR TÁCTICO: ' + error.message);
      setLoading(false);
      return;
    }
    if (ac.status === 'maintenance' && hangarData && data?.length) {
      const { error: ordenError } = await supabase.from('ordenes_trabajo').insert([{
        matricula:         ac.tailNumber.toUpperCase(),
        modelo:            ac.model.toUpperCase(),
        descripcion_tarea: hangarData.descripcion || hangarData.razon,
        sede:              ac.sede === 'LARA' ? 'Lara' : 'Maturín',
        nombre_mecanico:   hangarData.mecanico || 'POR ASIGNAR',
        estado:            'In Progress',
        observaciones:     `RAZÓN DE ENTRADA: ${hangarData.razon.toUpperCase()} | REGISTRO INICIAL DE FLOTA`,
      }]);
      if (ordenError) console.error('FALLA AL CREAR ORDEN DE TRABAJO:', ordenError.message);
    }
    setIsModalOpen(false);
    setNewAircraft({ tailNumber: '', model: '', totalHours: 0, status: 'operational', sede: 'LARA' });
    await onFleetChange?.();
    setLoading(false);
  };

  const handleCancelRazon = () => {
    setIsRazonOpen(false);
    setIsModalOpen(true);
  };

  // ── v5.5: HANDLER "VER HISTORIAL" DESDE AIRCRAFTDETAIL ────────────────────
  // Cierra el detalle, espera un tick y abre el modal de historial

  const handleOpenHistorialFromDetail = useCallback((ac: Aircraft) => {
    setSelectedAircraft(null);
    setTimeout(() => abrirHistorial(ac), 120);
  }, [abrirHistorial]);

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (selectedAircraft) {
    return (
      <AircraftDetail
        aircraft={selectedAircraft}
        onBack={() => setSelectedAircraft(null)}
        onOpenHistorial={handleOpenHistorialFromDetail}
      />
    );
  }

  const normalizedFleet = fleetData.map(ac => ({
    ...ac,
    status: normalizeAircraftStatus(ac.status as string),
  }));

  const historialFiltrado = filtroTipo === 'TODO'
    ? historial
    : historial.filter(h => h.tipo_registro === filtroTipo);

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtDateTime = (d: string) => new Date(d).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6 animate-in fade-in duration-500 text-left font-sans text-white">

      {/* Toolbar */}
      <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Gauge className="text-[#E1AD01] h-5 w-5" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 font-mono">
            Telemetría de Flota en Vivo
          </span>
        </div>
        <button onClick={() => setIsModalOpen(true)}
          className="bg-[#E1AD01] text-black px-6 py-2.5 rounded-lg font-black text-xs
                     hover:bg-white transition-all flex items-center gap-2 uppercase tracking-widest shadow-lg">
          <Plus className="h-4 w-4" /> Registrar Aeronave
        </button>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {normalizedFleet.map(ac => (
          <div key={ac.id} className="relative group">
            <AircraftCard aircraft={ac} onSelect={setSelectedAircraft} />

            {/* Botón Historial */}
            <button
              onClick={e => { e.stopPropagation(); abrirHistorial(ac); }}
              className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5
                         bg-black/80 backdrop-blur-md text-[#E1AD01] text-[8px] font-black uppercase tracking-widest
                         rounded-lg shadow-lg border border-[#E1AD01]/30 hover:bg-[#E1AD01] hover:text-black transition-all
                         opacity-0 group-hover:opacity-100 z-10"
            >
              <History size={10} /> Historial
            </button>

            {/* Botón Editar (solo en mantenimiento) */}
            {ac.status === 'maintenance' && (
              <button
                onClick={e => { e.stopPropagation(); handleEditarMantenimiento(ac); }}
                disabled={loading}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5
                           bg-[#E1AD01] text-black text-[8px] font-black uppercase tracking-widest
                           rounded-lg shadow-lg hover:bg-white transition-all
                           opacity-0 group-hover:opacity-100 disabled:opacity-30 z-10"
              >
                {loading ? <Loader2 size={10} className="animate-spin" /> : <Pencil size={10} />}
                Editar Orden
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MODAL — HISTORIAL DE AERONAVE
      ════════════════════════════════════════════════════════════════════ */}
      {historialModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/98 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/40 w-full max-w-5xl max-h-[90vh]
                          rounded-[2.5rem] shadow-[0_0_80px_rgba(225,173,1,0.15)] overflow-hidden flex flex-col">

            {/* Header */}
            <div className="bg-[#E1AD01]/10 border-b border-[#E1AD01]/20 px-7 py-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <History size={20} className="text-black" />
                </div>
                <div>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">
                    Historial de Aeronave
                  </p>
                  <p className="text-[9px] text-[#E1AD01]/70 font-mono uppercase tracking-widest mt-0.5">
                    {historialModal.tailNumber ?? (historialModal as any).matricula} · {(historialModal as any).model ?? (historialModal as any).modelo}
                  </p>
                </div>
              </div>
              <button onClick={cerrarHistorial} className="text-zinc-600 hover:text-white hover:rotate-90 transition-all">
                <X size={22} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/5 bg-black/40 shrink-0">
              {([
                { key: 'timeline',     label: 'Timeline Completo', icon: History,      count: historial.length },
                { key: 'componentes',  label: 'Componentes',        icon: Package,      count: componentes.length },
                { key: 'inspecciones', label: 'Inspecciones',       icon: FileCheck,    count: inspecciones.length },
              ] as const).map(t => {
                const Icon = t.icon;
                const active = historialTab === t.key;
                return (
                  <button key={t.key} onClick={() => { setHistorialTab(t.key); setShowComponenteForm(false); setShowInspeccionForm(false); }}
                    className={`flex items-center gap-2 px-6 py-4 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${
                      active
                        ? 'text-[#E1AD01] border-[#E1AD01] bg-[#E1AD01]/5'
                        : 'text-zinc-500 border-transparent hover:text-white hover:bg-white/5'
                    }`}>
                    <Icon size={12} /> {t.label}
                    <span className={`px-2 py-0.5 rounded-full text-[8px] ${active ? 'bg-[#E1AD01]/20 text-[#E1AD01]' : 'bg-white/5 text-zinc-600'}`}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 font-mono">
              {loadingHist ? (
                <div className="py-20 text-center">
                  <Loader2 className="h-8 w-8 text-[#E1AD01] animate-spin mx-auto mb-3" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Cargando historial...</p>
                </div>
              ) : (
                <>
                  {/* ══ TAB: TIMELINE ══════════════════════════════════════════ */}
                  {historialTab === 'timeline' && (
                    <div className="space-y-5">
                      {/* Filtros */}
                      <div className="flex flex-wrap gap-2">
                        {([
                          { key: 'TODO',       label: 'Todo',          color: '' },
                          { key: 'ORDEN',      label: 'Órdenes',       color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
                          { key: 'COMPONENTE', label: 'Componentes',   color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
                          { key: 'INSPECCION', label: 'Inspecciones',  color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
                        ] as const).map(f => (
                          <button key={f.key} onClick={() => setFiltroTipo(f.key)}
                            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${
                              filtroTipo === f.key
                                ? (f.color || 'bg-[#E1AD01] text-black border-[#E1AD01]')
                                : 'text-zinc-500 border-white/5 hover:text-white'
                            }`}>
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* Timeline */}
                      {historialFiltrado.length === 0 ? (
                        <div className="py-16 text-center bg-white/[0.02] rounded-2xl border border-white/5">
                          <History className="h-10 w-10 text-zinc-800 mx-auto mb-3 opacity-40" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Sin registros</p>
                          <p className="text-[8px] text-zinc-800 mt-2 font-mono">Los eventos aparecerán aquí conforme se registren</p>
                        </div>
                      ) : (
                        <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-white/10">
                          {historialFiltrado.map(reg => {
                            const isOrden      = reg.tipo_registro === 'ORDEN';
                            const isComponente = reg.tipo_registro === 'COMPONENTE';
                            const expanded = expandedItem === reg.registro_id;

                            const color = isOrden ? 'amber' : isComponente ? 'blue' : 'emerald';
                            const dotBg = isOrden      ? 'bg-amber-500/20 border-amber-500'
                                       : isComponente ? 'bg-blue-500/20 border-blue-500'
                                       :                'bg-emerald-500/20 border-emerald-500';
                            const cardBorder = isOrden      ? 'border-amber-500/20'
                                            : isComponente ? 'border-blue-500/20'
                                            :                'border-emerald-500/20';
                            const badgeBg = isOrden      ? 'bg-amber-500/10 text-amber-400'
                                          : isComponente ? 'bg-blue-500/10 text-blue-400'
                                          :                'bg-emerald-500/10 text-emerald-400';
                            const iconColor = isOrden      ? 'text-amber-400'
                                           : isComponente ? 'text-blue-400'
                                           :                'text-emerald-400';
                            const Icon = isOrden      ? ClipboardList
                                       : isComponente ? Package
                                       :                FileCheck;

                            return (
                              <div key={reg.registro_id} className="relative">
                                <div className={`absolute -left-6 top-4 w-4 h-4 rounded-full border-2 z-10 ${dotBg}`} />
                                <button onClick={() => setExpandedItem(expanded ? null : reg.registro_id)}
                                  className={`w-full text-left bg-white/[0.02] border rounded-xl p-4 hover:bg-white/[0.04] transition-all ${cardBorder}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                      <Icon size={14} className={`${iconColor} shrink-0 mt-0.5`} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                          <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full tracking-widest ${badgeBg}`}>
                                            {reg.tipo_registro}
                                          </span>
                                          {reg.tipo_especifico && (
                                            <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-white/5 text-zinc-500 tracking-widest">
                                              {reg.tipo_especifico}
                                            </span>
                                          )}
                                          <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full tracking-widest ${
                                            reg.estado === 'Completed' || reg.estado === 'APROBADA' || reg.estado === 'ACTIVO'
                                              ? 'bg-emerald-500/10 text-emerald-400'
                                              : 'bg-zinc-500/10 text-zinc-500'
                                          }`}>
                                            {reg.estado}
                                          </span>
                                        </div>
                                        <p className="text-[11px] font-black text-white uppercase truncate">{reg.titulo}</p>
                                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                                          <span className="text-[8px] text-zinc-600 font-mono flex items-center gap-1">
                                            <Calendar size={9} /> {fmtDateTime(reg.fecha_registro)}
                                          </span>
                                          {reg.mecanico && (
                                            <span className="text-[8px] text-zinc-600 font-mono flex items-center gap-1">
                                              <Wrench size={9} /> {reg.mecanico}
                                            </span>
                                          )}
                                          {reg.horas_aeronave != null && (
                                            <span className="text-[8px] text-[#E1AD01] font-mono flex items-center gap-1">
                                              <Clock size={9} /> {reg.horas_aeronave}h
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    {expanded ? <ChevronDown size={14} className="text-zinc-600 shrink-0" /> : <ChevronRight size={14} className="text-zinc-600 shrink-0" />}
                                  </div>
                                  {expanded && (
                                    <div className="mt-4 pt-4 border-t border-white/5 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                      {reg.detalle && (
                                        <div>
                                          <p className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1 flex items-center gap-1">
                                            <FileText size={9} /> Detalle
                                          </p>
                                          <p className="text-[10px] text-zinc-300 font-mono whitespace-pre-line leading-relaxed">
                                            {reg.detalle || '—'}
                                          </p>
                                        </div>
                                      )}
                                      {(reg.proxima_horas != null || reg.proxima_fecha) && (
                                        <div className="grid grid-cols-2 gap-3 pt-2">
                                          {reg.proxima_horas != null && (
                                            <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/10 rounded-lg p-2">
                                              <p className="text-[7px] text-[#E1AD01]/60 uppercase tracking-widest">Próx. Servicio</p>
                                              <p className="text-[11px] text-[#E1AD01] font-black">{reg.proxima_horas}h</p>
                                            </div>
                                          )}
                                          {reg.proxima_fecha && (
                                            <div className="bg-[#E1AD01]/5 border border-[#E1AD01]/10 rounded-lg p-2">
                                              <p className="text-[7px] text-[#E1AD01]/60 uppercase tracking-widest">Vence</p>
                                              <p className="text-[11px] text-[#E1AD01] font-black">{fmtDate(reg.proxima_fecha)}</p>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ TAB: COMPONENTES ═══════════════════════════════════════ */}
                  {historialTab === 'componentes' && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
                          Componentes activos con vida útil restante
                        </p>
                        <button onClick={() => setShowComponenteForm(!showComponenteForm)}
                          className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-500/20 transition-all flex items-center gap-2">
                          <PlusCircle size={12} /> {showComponenteForm ? 'Cancelar' : 'Registrar Componente'}
                        </button>
                      </div>

                      {showComponenteForm && (
                        <form onSubmit={handleGuardarComponente} className="bg-white/[0.02] border border-blue-500/20 rounded-2xl p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-blue-400 uppercase tracking-widest block">Tipo de Componente *</label>
                              <select className={SELECT_CLS} value={componenteForm.tipo_componente}
                                onChange={e => handleTipoComponenteChange(e.target.value)}>
                                {TIPOS_COMPONENTE.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-blue-400 uppercase tracking-widest block">Descripción *</label>
                              <input required className={INPUT_CLS} placeholder="Ej: Aeroshell W100"
                                value={componenteForm.descripcion}
                                onChange={e => setComponenteForm(p => ({ ...p, descripcion: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">P/N Fabricante</label>
                              <input className={INPUT_CLS} placeholder="Opcional"
                                value={componenteForm.parte_numero}
                                onChange={e => setComponenteForm(p => ({ ...p, parte_numero: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Fecha Instalación *</label>
                              <input type="date" required className={INPUT_CLS} style={{ textTransform: 'none' }}
                                value={componenteForm.fecha_instalacion}
                                onChange={e => setComponenteForm(p => ({ ...p, fecha_instalacion: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-[#E1AD01] uppercase tracking-widest block">Horas Aeronave al Instalar *</label>
                              <input type="number" step="0.1" min="0" required className={INPUT_CLS} placeholder="0.0"
                                value={componenteForm.horas_aeronave}
                                onChange={e => setComponenteForm(p => ({ ...p, horas_aeronave: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Mecánico</label>
                              <input className={INPUT_CLS} placeholder="Nombre"
                                value={componenteForm.mecanico}
                                onChange={e => setComponenteForm(p => ({ ...p, mecanico: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Intervalo Horas</label>
                              <input type="number" step="0.1" className={INPUT_CLS} placeholder="ej: 50"
                                value={componenteForm.intervalo_horas}
                                onChange={e => setComponenteForm(p => ({ ...p, intervalo_horas: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Intervalo Meses</label>
                              <input type="number" min="0" className={INPUT_CLS} placeholder="ej: 24"
                                value={componenteForm.intervalo_meses}
                                onChange={e => setComponenteForm(p => ({ ...p, intervalo_meses: e.target.value }))} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Observaciones</label>
                            <textarea rows={2} className={`${INPUT_CLS} resize-none`} placeholder="Notas técnicas..."
                              value={componenteForm.observaciones}
                              onChange={e => setComponenteForm(p => ({ ...p, observaciones: e.target.value }))} />
                          </div>
                          <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/15 rounded-xl p-3">
                            <AlertCircle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                            <p className="text-[9px] text-amber-400/80 leading-relaxed">
                              Los componentes anteriores del mismo tipo se marcarán como <span className="font-black">RETIRADOS</span> automáticamente.
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button type="button" onClick={() => setShowComponenteForm(false)}
                              className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                              Cancelar
                            </button>
                            <button type="submit" disabled={loadingHist}
                              className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase hover:bg-blue-400 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                              {loadingHist ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                              Registrar Componente
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Lista de componentes activos */}
                      {componentes.length === 0 ? (
                        <div className="py-16 text-center bg-white/[0.02] rounded-2xl border border-white/5">
                          <Package className="h-10 w-10 text-zinc-800 mx-auto mb-3 opacity-40" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Sin componentes registrados</p>
                          <p className="text-[8px] text-zinc-800 mt-2 font-mono">Registra el aceite, filtros, bujías, etc.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {componentes.map(c => {
                            const Icon = iconoComponente(c.tipo_componente);
                            const horasRest = c.horas_restantes;
                            const alerta = horasRest != null
                              ? horasRest < 10 ? 'critico'
                              : horasRest < 30 ? 'advertencia'
                              :                  'normal'
                              : 'normal';
                            const cardBorder = alerta === 'critico'     ? 'border-red-500/20'
                                            : alerta === 'advertencia' ? 'border-amber-500/20'
                                            :                            'border-emerald-500/20';
                            const iconBg = alerta === 'critico'     ? 'bg-red-500/10 border-red-500/20'
                                        : alerta === 'advertencia' ? 'bg-amber-500/10 border-amber-500/20'
                                        :                            'bg-emerald-500/10 border-emerald-500/20';
                            const iconColor = alerta === 'critico'     ? 'text-red-400'
                                           : alerta === 'advertencia' ? 'text-amber-400'
                                           :                            'text-emerald-400';
                            const restColor = alerta === 'critico'     ? 'text-red-400'
                                           : alerta === 'advertencia' ? 'text-amber-400'
                                           :                            'text-emerald-400';
                            const cellBorder = alerta === 'critico'     ? 'border-red-500/10'
                                            : alerta === 'advertencia' ? 'border-amber-500/10'
                                            :                            'border-emerald-500/10';
                            return (
                              <div key={c.id} className={`bg-white/[0.02] border rounded-2xl p-4 ${cardBorder}`}>
                                <div className="flex items-start gap-3 mb-3">
                                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${iconBg}`}>
                                    <Icon size={14} className={iconColor} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-black text-white uppercase truncate">{c.descripcion}</p>
                                    <p className="text-[8px] text-zinc-600 font-mono">{c.tipo_componente}</p>
                                    {c.parte_numero && <p className="text-[8px] text-zinc-500 font-mono mt-0.5">P/N: {c.parte_numero}</p>}
                                  </div>
                                  {alerta === 'critico' && <AlertTriangle size={14} className="text-red-400 animate-pulse" />}
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-3">
                                  <div className={`bg-black/40 rounded-lg p-2 border ${cellBorder}`}>
                                    <p className="text-[7px] text-zinc-600 uppercase tracking-widest">Instalado a</p>
                                    <p className="text-[10px] text-white font-black font-mono">{c.horas_al_instalar}h</p>
                                  </div>
                                  <div className={`bg-black/40 rounded-lg p-2 border ${cellBorder}`}>
                                    <p className="text-[7px] text-zinc-600 uppercase tracking-widest">Restantes</p>
                                    <p className={`text-[10px] font-black font-mono ${restColor}`}>
                                      {horasRest != null ? `${horasRest.toFixed(1)}h` : '—'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between mt-2 text-[8px] font-mono text-zinc-600">
                                  <span>Instalado: {fmtDate(c.fecha_instalacion)}</span>
                                  {c.mecanico && <span>Por: {c.mecanico}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ══ TAB: INSPECCIONES ══════════════════════════════════════ */}
                  {historialTab === 'inspecciones' && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">
                          Última inspección de cada tipo con vigencia
                        </p>
                        <button onClick={() => setShowInspeccionForm(!showInspeccionForm)}
                          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all flex items-center gap-2">
                          <PlusCircle size={12} /> {showInspeccionForm ? 'Cancelar' : 'Registrar Inspección'}
                        </button>
                      </div>

                      {showInspeccionForm && (
                        <form onSubmit={handleGuardarInspeccion} className="bg-white/[0.02] border border-emerald-500/20 rounded-2xl p-5 space-y-4 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-emerald-400 uppercase tracking-widest block">Tipo *</label>
                              <select className={SELECT_CLS} value={inspeccionForm.tipo_inspeccion}
                                onChange={e => handleTipoInspeccionChange(e.target.value)}>
                                {TIPOS_INSPECCION.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-emerald-400 uppercase tracking-widest block">Descripción *</label>
                              <input required className={INPUT_CLS}
                                value={inspeccionForm.descripcion}
                                onChange={e => setInspeccionForm(p => ({ ...p, descripcion: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Fecha Realizada *</label>
                              <input type="date" required className={INPUT_CLS} style={{ textTransform: 'none' }}
                                value={inspeccionForm.fecha_realizada}
                                onChange={e => setInspeccionForm(p => ({ ...p, fecha_realizada: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-[#E1AD01] uppercase tracking-widest block">Horas Aeronave *</label>
                              <input type="number" step="0.1" min="0" required className={INPUT_CLS}
                                value={inspeccionForm.horas_aeronave}
                                onChange={e => setInspeccionForm(p => ({ ...p, horas_aeronave: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Próxima a las Horas</label>
                              <input type="number" step="0.1" className={INPUT_CLS} placeholder="Auto-calculado"
                                value={inspeccionForm.proxima_horas}
                                onChange={e => setInspeccionForm(p => ({ ...p, proxima_horas: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Vence en Fecha</label>
                              <input type="date" className={INPUT_CLS} style={{ textTransform: 'none' }}
                                value={inspeccionForm.proxima_fecha}
                                onChange={e => setInspeccionForm(p => ({ ...p, proxima_fecha: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Mecánico / Inspector</label>
                              <input className={INPUT_CLS} placeholder="Nombre"
                                value={inspeccionForm.mecanico}
                                onChange={e => setInspeccionForm(p => ({ ...p, mecanico: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">N° Certificado</label>
                              <input className={INPUT_CLS} placeholder="Opcional"
                                value={inspeccionForm.certificado_numero}
                                onChange={e => setInspeccionForm(p => ({ ...p, certificado_numero: e.target.value }))} />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Hallazgos</label>
                            <textarea rows={2} className={`${INPUT_CLS} resize-none`} placeholder="Desviaciones detectadas..."
                              value={inspeccionForm.hallazgos}
                              onChange={e => setInspeccionForm(p => ({ ...p, hallazgos: e.target.value }))} />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block">Observaciones</label>
                            <textarea rows={2} className={`${INPUT_CLS} resize-none`} placeholder="Notas técnicas..."
                              value={inspeccionForm.observaciones}
                              onChange={e => setInspeccionForm(p => ({ ...p, observaciones: e.target.value }))} />
                          </div>
                          <div className="flex gap-3">
                            <button type="button" onClick={() => setShowInspeccionForm(false)}
                              className="flex-1 py-3 rounded-xl border border-white/10 text-zinc-500 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                              Cancelar
                            </button>
                            <button type="submit" disabled={loadingHist}
                              className="flex-1 py-3 rounded-xl bg-emerald-500 text-black text-[10px] font-black uppercase hover:bg-emerald-400 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                              {loadingHist ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                              Registrar Inspección
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Lista de inspecciones vigentes */}
                      {inspecciones.length === 0 ? (
                        <div className="py-16 text-center bg-white/[0.02] rounded-2xl border border-white/5">
                          <FileCheck className="h-10 w-10 text-zinc-800 mx-auto mb-3 opacity-40" />
                          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Sin inspecciones registradas</p>
                          <p className="text-[8px] text-zinc-800 mt-2 font-mono">Registra 100H, IA, Anual, etc.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {inspecciones.map((i, idx) => {
                            const horasRest = i.horas_restantes;
                            const diasRest  = i.dias_restantes;
                            const alerta = (horasRest != null && horasRest < 10) || (diasRest != null && diasRest < 15)
                              ? 'critico'
                              : (horasRest != null && horasRest < 30) || (diasRest != null && diasRest < 30)
                              ? 'advertencia'
                              : 'normal';
                            const cardBorder = alerta === 'critico'     ? 'border-red-500/20'
                                            : alerta === 'advertencia' ? 'border-amber-500/20'
                                            :                            'border-emerald-500/20';
                            const iconBg = alerta === 'critico'     ? 'bg-red-500/10 border-red-500/20'
                                        : alerta === 'advertencia' ? 'bg-amber-500/10 border-amber-500/20'
                                        :                            'bg-emerald-500/10 border-emerald-500/20';
                            const iconColor = alerta === 'critico'     ? 'text-red-400'
                                           : alerta === 'advertencia' ? 'text-amber-400'
                                           :                            'text-emerald-400';
                            const restColor = alerta === 'critico'     ? 'text-red-400'
                                           : alerta === 'advertencia' ? 'text-amber-400'
                                           :                            'text-emerald-400';
                            const cellBorder = alerta === 'critico'     ? 'border-red-500/10'
                                            : alerta === 'advertencia' ? 'border-amber-500/10'
                                            :                            'border-emerald-500/10';
                            return (
                              <div key={idx} className={`bg-white/[0.02] border rounded-2xl p-4 ${cardBorder}`}>
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${iconBg}`}>
                                      <FileCheck size={14} className={iconColor} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[10px] font-black text-white uppercase truncate">{i.descripcion}</p>
                                      <p className="text-[8px] text-zinc-600 font-mono">{i.tipo_inspeccion}</p>
                                    </div>
                                  </div>
                                  {alerta === 'critico' && <AlertTriangle size={14} className="text-red-400 animate-pulse shrink-0" />}
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-3">
                                  {horasRest != null && (
                                    <div className={`bg-black/40 rounded-lg p-2 border ${cellBorder}`}>
                                      <p className="text-[7px] text-zinc-600 uppercase tracking-widest">Horas Rest.</p>
                                      <p className={`text-[10px] font-black font-mono ${restColor}`}>{horasRest.toFixed(1)}h</p>
                                    </div>
                                  )}
                                  {diasRest != null && (
                                    <div className={`bg-black/40 rounded-lg p-2 border ${cellBorder}`}>
                                      <p className="text-[7px] text-zinc-600 uppercase tracking-widest">Días Rest.</p>
                                      <p className={`text-[10px] font-black font-mono ${restColor}`}>{diasRest}d</p>
                                    </div>
                                  )}
                                </div>
                                <div className="mt-2 text-[8px] font-mono text-zinc-600">
                                  Última: {fmtDate(i.ultima_realizada)} @ {i.horas_ultima}h
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL — EDITAR ORDEN DE TRABAJO
      ════════════════════════════════════════════════════════════ */}
      {isEditOpen && ordenEditing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/98 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/40 w-full max-w-lg rounded-[2.5rem] shadow-[0_0_80px_rgba(225,173,1,0.12)] overflow-hidden">
            <div className="bg-[#E1AD01]/10 border-b border-[#E1AD01]/20 px-7 py-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <ClipboardList size={18} className="text-black" />
                </div>
                <div>
                  <p className="text-[11px] font-black text-white uppercase tracking-wider">Actualizar Orden de Trabajo</p>
                  <p className="text-[9px] text-[#E1AD01]/70 font-mono uppercase tracking-widest mt-0.5">
                    {ordenEditing.matricula} · {ordenEditing.modelo}
                  </p>
                </div>
              </div>
              <button onClick={() => { setIsEditOpen(false); setOrdenEditing(null); }} className="text-zinc-600 hover:text-white hover:rotate-90 transition-all">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleGuardarEdicion} className="p-7 space-y-5 font-mono">
              <div className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-4 space-y-2">
                <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-3">Estado actual de la orden</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Tarea</p>
                    <p className="text-[10px] text-white font-black uppercase mt-0.5 leading-snug">{ordenEditing.descripcion_tarea}</p>
                  </div>
                  <div>
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest">Técnico</p>
                    <p className="text-[10px] text-white font-black uppercase mt-0.5">{ordenEditing.nombre_mecanico}</p>
                  </div>
                </div>
                {ordenEditing.observaciones && (
                  <div className="border-t border-white/5 pt-3 mt-2">
                    <p className="text-[8px] text-zinc-600 uppercase tracking-widest mb-1">Observaciones registradas</p>
                    <p className="text-[9px] text-zinc-400 font-mono leading-relaxed whitespace-pre-line max-h-20 overflow-y-auto">
                      {ordenEditing.observaciones}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest flex items-center gap-2">
                  <PlusCircle size={12} /> Daños Adicionales
                </label>
                <textarea rows={3}
                  className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white text-xs resize-none outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 uppercase font-mono"
                  placeholder="Describir daños o hallazgos adicionales encontrados durante la revisión..."
                  value={editForm.nuevosHallazgos}
                  onChange={e => setEditForm(prev => ({ ...prev, nuevosHallazgos: e.target.value }))} />
                <p className="text-[8px] text-zinc-700 font-mono">Se registrará con timestamp automático en el historial de la orden.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">Técnico Asignado</label>
                <input className={INPUT_CLS} placeholder="Nombre del técnico"
                  value={editForm.mecanico}
                  onChange={e => setEditForm(prev => ({ ...prev, mecanico: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-zinc-400 uppercase tracking-widest block">Estado de la Orden</label>
                <select className={SELECT_CLS} value={editForm.estado}
                  onChange={e => setEditForm(prev => ({ ...prev, estado: e.target.value }))}>
                  <option value="In Progress">EN PROGRESO</option>
                  <option value="Pending Parts">ESPERANDO REPUESTOS</option>
                  <option value="Completed">COMPLETADA</option>
                  <option value="On Hold">EN ESPERA</option>
                </select>
              </div>
              <div className="flex items-start gap-2 bg-[#E1AD01]/5 border border-[#E1AD01]/15 rounded-xl p-3">
                <AlertCircle size={13} className="text-[#E1AD01] shrink-0 mt-0.5" />
                <p className="text-[9px] text-[#E1AD01]/70 leading-relaxed">
                  Los nuevos hallazgos se{' '}
                  <span className="font-black text-[#E1AD01]">agregan al historial</span>{' '}
                  de la orden existente. Al marcar <span className="font-black">COMPLETADA</span>, aparecerá en el timeline de la aeronave.
                </p>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setIsEditOpen(false); setOrdenEditing(null); }}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black uppercase hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {loading ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 1 — REGISTRO
      ════════════════════════════════════════════════════════════ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="p-6 bg-[#E1AD01] flex justify-between items-center text-black font-black">
              <h3 className="uppercase text-[10px] tracking-[0.4em] italic flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Registro Multi-Sede
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="hover:rotate-90 transition-all">
                <X className="h-6 w-6" />
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-10 space-y-6 font-mono">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Matrícula *</label>
                  <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:border-[#E1AD01] outline-none uppercase text-xs transition-all"
                    placeholder="YV-XXXX"
                    value={newAircraft.tailNumber}
                    onChange={e => setNewAircraft({ ...newAircraft, tailNumber: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Sede Operativa</label>
                  <select className={SELECT_CLS} value={newAircraft.sede}
                    onChange={e => setNewAircraft({ ...newAircraft, sede: e.target.value as any })}>
                    <option value="LARA">BASE LARA</option>
                    <option value="MATURIN">BASE MATURÍN</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Modelo / Aeronave *</label>
                <input required className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:border-[#E1AD01] outline-none text-xs uppercase transition-all"
                  placeholder="CESSNA 152"
                  value={newAircraft.model}
                  onChange={e => setNewAircraft({ ...newAircraft, model: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Estatus Inicial</label>
                <select className={SELECT_CLS} value={newAircraft.status}
                  onChange={e => setNewAircraft({ ...newAircraft, status: e.target.value as any })}>
                  <option value="operational">OPERATIVA</option>
                  <option value="maintenance">EN MANTENIMIENTO</option>
                  <option value="grounded">EN TIERRA (AOG)</option>
                </select>
                {newAircraft.status === 'maintenance' && (
                  <div className="flex items-start gap-2 bg-[#E1AD01]/5 border border-[#E1AD01]/20 rounded-xl px-3 py-2.5 mt-2">
                    <Wrench className="h-3.5 w-3.5 text-[#E1AD01] shrink-0 mt-0.5" />
                    <p className="text-[9px] text-[#E1AD01]/80 leading-relaxed">
                      Se solicitará la razón de entrada al hangar y se creará una orden de trabajo automáticamente.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Horas Totales (TT)</label>
                <input type="number" step="0.1" required
                  className="w-full bg-black border border-white/10 rounded-xl p-5 text-white focus:border-[#E1AD01] outline-none text-4xl font-black text-center transition-all"
                  placeholder="0.0"
                  value={newAircraft.totalHours || ''}
                  onChange={e => setNewAircraft({ ...newAircraft, totalHours: parseFloat(e.target.value) })} />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-[#E1AD01] text-black py-6 rounded-2xl font-black uppercase text-[10px] tracking-[0.4em] hover:bg-white transition-all shadow-xl flex items-center justify-center gap-2 disabled:opacity-40">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" />
                  : newAircraft.status === 'maintenance'
                    ? <><ShieldAlert className="h-4 w-4" /> Continuar — Razón de Hangar</>
                    : 'Desplegar Unidad'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 2 — RAZÓN DE HANGAR
      ════════════════════════════════════════════════════════════ */}
      {isRazonOpen && pendingAircraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/98 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="bg-[#0a0a0a] border border-amber-500/40 w-full max-w-sm rounded-3xl overflow-hidden shadow-[0_0_60px_rgba(225,173,1,0.15)]">
            <div className="bg-amber-500/10 border-b border-amber-500/20 p-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#E1AD01] flex items-center justify-center shrink-0">
                  <Wrench className="h-5 w-5 text-black" />
                </div>
                <div>
                  <p className="text-[12px] font-black text-white uppercase tracking-wider">Razón de Entrada a Hangar</p>
                  <p className="text-[9px] text-amber-400/70 font-mono uppercase tracking-widest">
                    {pendingAircraft.tailNumber.toUpperCase()} · {pendingAircraft.model.toUpperCase()}
                  </p>
                </div>
              </div>
            </div>
            <form onSubmit={handleRazonConfirm} className="p-6 space-y-4 font-mono">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Motivo *</label>
                <select required className={SELECT_CLS} value={razonForm.razon}
                  onChange={e => setRazonForm({ ...razonForm, razon: e.target.value, razonCustom: '' })}>
                  <option value="">— SELECCIONAR —</option>
                  {RAZONES_PREDEFINIDAS.map(r => (<option key={r} value={r}>{r}</option>))}
                </select>
              </div>
              {razonForm.razon === 'Otra (especificar)' && (
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-[#E1AD01] uppercase tracking-widest block">Especificar *</label>
                  <input required className="w-full bg-black border border-[#E1AD01]/30 rounded-xl p-4 text-white text-xs uppercase outline-none focus:border-[#E1AD01] placeholder:text-white/20"
                    placeholder="DESCRIBIR..."
                    value={razonForm.razonCustom}
                    onChange={e => setRazonForm({ ...razonForm, razonCustom: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Descripción Técnica</label>
                <textarea rows={2} className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs resize-none outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 uppercase font-mono"
                  placeholder="Detalle adicional..."
                  value={razonForm.descripcion}
                  onChange={e => setRazonForm({ ...razonForm, descripcion: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Técnico Asignado</label>
                <input className="w-full bg-black border border-white/10 rounded-xl p-4 text-white text-xs uppercase outline-none focus:border-[#E1AD01] transition-all placeholder:text-white/20 font-mono"
                  placeholder="Nombre del técnico (opcional)"
                  value={razonForm.mecanico}
                  onChange={e => setRazonForm({ ...razonForm, mecanico: e.target.value })} />
              </div>
              <div className="flex items-start gap-2 bg-red-500/5 border border-red-500/15 rounded-xl p-3">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[9px] text-red-400/80 leading-relaxed">
                  Se registrará la aeronave como <span className="font-black text-red-400">MANTENIMIENTO</span> y aparecerá en el <span className="font-black">Control Hub</span>.
                </p>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={handleCancelRazon}
                  className="flex-1 py-4 rounded-xl border border-white/10 text-zinc-400 text-[10px] font-black uppercase hover:bg-white/5 transition-all">
                  Volver
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 py-4 rounded-xl bg-[#E1AD01] text-black text-[10px] font-black uppercase hover:bg-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  {loading ? 'Desplegando...' : 'Desplegar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FleetDashboard;
// src/components/FleetDashboard.tsx
// VALKYRON OS v5.8.1 — Flota · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v5.8.1:
//   [FIX] Al abrir una aeronave desde abajo de la lista (móvil) el detalle
//         quedaba a media altura: ahora sube al inicio y, al volver, restaura
//         la posición de la lista (abrirAeronave + listScrollRef).
// CHANGELOG v5.8:
//   [UI]  AircraftCard v1.3 y AircraftDetail v3.5 ya son B&M: se retiran las
//         islas oscuras. Historial y Editar orden pasan al pie de la propia
//         tarjeta (prop `actions`), fuera de su área clicable.
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v5.7 — REBRAND B&M + CONEXIONES:
//   [FIX] Horas precargadas en componentes e inspecciones: Index entrega
//         `hours_vuelo_totales` y el formulario solo leía hoursFlown /
//         horas_vuelo_totales, así que siempre proponía 0 h. Ahora lee los tres.
//   [FIX] Marcar una orden como COMPLETADA desde Flota hacía un UPDATE directo y
//         se saltaba fn_mro_cerrar_orden (la vía oficial de cierre de Hangar MRO).
//         Ahora usa la misma RPC con las mismas reglas: mecánico asignado y
//         observaciones de cierre obligatorias. Cerrar NO libera la aeronave.
//   [FIX] Historial: si alguna vista falla (v_historial_aeronave,
//         v_componentes_vigentes, v_proximas_inspecciones) se avisa en pantalla;
//         antes se mostraba "Sin registros" (un vacío falso).
//   [FIX] Componente nuevo: si falla el retiro de los anteriores del mismo tipo
//         ya no se inserta (antes podían quedar dos activos).
//   [FIX] Registro con hangar: si la orden de trabajo no se crea, se avisa (antes
//         solo console.error) y el paso 2 no se cierra si la aeronave falló.
//   [FIX] Edición: "sin cambios" compara mecánico con null normalizado.
//   [UI]  Estética B&M (bm-ui). Historial y Editar orden visibles siempre (antes
//         solo con hover: inaccesibles en táctil). Resumen de flota por estado.
//         AircraftCard y AircraftDetail se muestran en isla oscura hasta migrarlos.
// PRESERVADO ÍNTEGRO (v5.6): normalización de estado, razones predefinidas,
//   tipos e intervalos de componentes / inspecciones, auto-cálculo de próximas,
//   historial con 3 pestañas y filtros, registro en 2 pasos con OT automática,
//   onFleetChange, handleOpenHistorialFromDetail, payloads de inserción.
// ─────────────────────────────────────────────────────────────────────────────
// VALKYRON OS v5.6 — HISTORIAL + SINCRONIZACIÓN MRO
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
  BmModal, BmField, BmSelect, BmBadge, BmEmpty, BmNotice,
  bmInput, bmTextarea, bmBtn, type BmTone,
} from './brand/bm-ui';
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
  if (!rawStatus) return 'grounded';
  const s = rawStatus.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.includes('mantenimiento') || s.includes('maintenance')) return 'maintenance';
  if (s.includes('vuelo') || s.includes('flight'))               return 'flight';
  if (s.includes('tierra') || s.includes('grounded') || s.includes('aog')) return 'grounded';
  if (s.includes('operational') || s.includes('operativa')) return 'operational';
  return 'grounded';
};

// [v5.7] Controles B&M (antes: campos negros con borde dorado)
const SELECT_CLS = '';
const INPUT_CLS = `${bmInput} uppercase placeholder:normal-case`;
const DATE_CLS = bmInput;

// [v5.7] Presentación de estados
const ESTADO_AERONAVE: Record<string, { label: string; tone: BmTone }> = {
  operational: { label: 'Operativas',        tone: 'ok' },
  maintenance: { label: 'En mantenimiento',  tone: 'warn' },
  grounded:    { label: 'En tierra (AOG)',   tone: 'danger' },
  flight:      { label: 'En vuelo',          tone: 'info' },
};

const ESTADO_REGISTRO: Record<string, string> = {
  'In Progress': 'En progreso', 'Pending Parts': 'Esperando repuestos', 'On Hold': 'En espera',
  'Completed': 'Completada', 'APROBADA': 'Aprobada', 'ACTIVO': 'Activo', 'RETIRADO': 'Retirado',
};

const TIPO_REGISTRO: Record<string, { label: string; tone: BmTone }> = {
  ORDEN:      { label: 'Orden',      tone: 'warn' },
  COMPONENTE: { label: 'Componente', tone: 'info' },
  INSPECCION: { label: 'Inspección', tone: 'ok' },
};

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

// [v5.7] Nivel de alerta → tono visual
const ALERTA_TONE: Record<'critico' | 'advertencia' | 'normal', { tone: BmTone; border: string; text: string }> = {
  critico:     { tone: 'danger', border: 'border-bm-red/30',  text: 'text-bm-red' },
  advertencia: { tone: 'warn',   border: 'border-bm-warn/30', text: 'text-bm-warn' },
  normal:      { tone: 'ok',     border: 'border-bm-line',    text: 'text-bm-ok' },
};

// [v5.7] Horas actuales de la aeronave (Index entrega hours_vuelo_totales)
const horasDeAeronave = (ac: any): number =>
  Number(ac?.hoursFlown ?? ac?.horas_vuelo_totales ?? ac?.hours_vuelo_totales ?? 0) || 0;

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
  void setFleetData;
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
  const [histError,      setHistError]      = useState<string | null>(null); // [v5.7]
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
    setHistError(null);
    try {
      const [histRes, compRes, inspRes] = await Promise.all([
        supabase.from('v_historial_aeronave').select('*').eq('matricula', matricula),
        supabase.from('v_componentes_vigentes').select('*').eq('matricula', matricula).order('horas_restantes', { ascending: true }),
        supabase.from('v_proximas_inspecciones').select('*').eq('matricula', matricula),
      ]);
      if (histRes.error) console.warn('[v5.5] historial:', histRes.error.message);
      if (compRes.error) console.warn('[v5.5] componentes:', compRes.error.message);
      if (inspRes.error) console.warn('[v5.5] inspecciones:', inspRes.error.message);

      // [FIX v5.7] Un fallo de vista se informa; no se presenta como "sin registros".
      const fallos = [
        histRes.error && `historial (${histRes.error.message})`,
        compRes.error && `componentes (${compRes.error.message})`,
        inspRes.error && `inspecciones (${inspRes.error.message})`,
      ].filter(Boolean);
      setHistError(fallos.length ? `No se pudo cargar: ${fallos.join(', ')}.` : null);

      setHistorial((histRes.data ?? []) as RegistroHistorial[]);
      setComponentes((compRes.data ?? []) as ComponenteVigente[]);
      setInspecciones((inspRes.data ?? []) as InspeccionProxima[]);
    } catch (err: any) {
      setHistError(`No se pudo cargar el historial: ${err?.message ?? 'error de conexión'}.`);
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
    setHistError(null);
    setShowComponenteForm(false);
    setShowInspeccionForm(false);
  };

  // ── v5.4: PRE-LLENAR HORAS ACTUALES DE LA AERONAVE ────────────────────────
  // [FIX v5.7] horasDeAeronave() también lee hours_vuelo_totales (forma de Index)

  useEffect(() => {
    if (historialModal && showComponenteForm) {
      const horasActuales = horasDeAeronave(historialModal);
      if (!componenteForm.horas_aeronave) {
        setComponenteForm(prev => ({ ...prev, horas_aeronave: String(horasActuales) }));
      }
    }
  }, [historialModal, showComponenteForm, componenteForm.horas_aeronave]);

  useEffect(() => {
    if (historialModal && showInspeccionForm) {
      const horasActuales = horasDeAeronave(historialModal);
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
      const { error: retiroError } = await supabase.from('componentes_aeronave').update({
        activo:       false,
        fecha_retiro: new Date().toISOString().split('T')[0],
        horas_retiro: horas,
      }).eq('matricula', matricula).eq('tipo_componente', componenteForm.tipo_componente).eq('activo', true);
      // [FIX v5.7] Sin retiro confirmado no se inserta (evita dos activos del mismo tipo)
      if (retiroError) throw new Error(`no se pudo retirar el componente anterior: ${retiroError.message}`);

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
        .in('estado', ['In Progress', 'Pending Parts', 'On Hold'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle();

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

  const cerrandoOrden = editForm.estado === 'Completed'; // [v5.7]

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ordenEditing) return;

    // [FIX v5.7] COMPLETADA = cierre oficial por fn_mro_cerrar_orden (igual que Hangar MRO)
    if (editForm.estado === 'Completed') {
      const mecanico = String(editForm.mecanico.trim() || ordenEditing.nombre_mecanico || '').trim();
      if (!mecanico || mecanico === 'POR ASIGNAR') {
        alert('Asigna un mecánico a la orden antes de cerrarla.');
        return;
      }
      if (!editForm.nuevosHallazgos.trim()) {
        alert('Las observaciones de cierre son obligatorias.');
        return;
      }
      setLoading(true);
      try {
        if (mecanico !== String(ordenEditing.nombre_mecanico ?? '').trim()) {
          const { error: mecError } = await supabase
            .from('ordenes_trabajo').update({ nombre_mecanico: mecanico }).eq('id', ordenEditing.id);
          if (mecError) throw mecError;
        }
        const { error } = await supabase.rpc('fn_mro_cerrar_orden', {
          p_orden_id: ordenEditing.id,
          p_observaciones: editForm.nuevosHallazgos.trim(),
          p_mecanico: mecanico,
          p_horas: null,
        });
        if (error) throw error;
        const matricula = ordenEditing.matricula;
        setIsEditOpen(false);
        setOrdenEditing(null);
        setEditForm({ nuevosHallazgos: '', mecanico: '', estado: 'In Progress' });
        alert(`Orden cerrada: ${matricula}.\nLa aeronave sigue fuera de servicio hasta su liberación autorizada.`);
        await onFleetChange?.();
      } catch (err: any) {
        alert('Error al cerrar la orden: ' + (err?.message ?? 'Desconocido'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (
      !editForm.nuevosHallazgos.trim() &&
      editForm.mecanico.trim() === String(ordenEditing.nombre_mecanico ?? '').trim() &&
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
      void insertAircraft({ ...newAircraft }, null);
    }
  };

  const handleRazonConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!razonFinal) {
      alert('PROTOCOLO: Especifica la razón de entrada a hangar.');
      return;
    }
    if (!pendingAircraft) return;
    const ok = await insertAircraft(pendingAircraft, {
      razon:       razonFinal,
      mecanico:    razonForm.mecanico,
      descripcion: razonForm.descripcion,
    });
    // [FIX v5.7] Si la aeronave no se registró, el paso 2 queda abierto con sus datos.
    if (ok) {
      setIsRazonOpen(false);
      setPendingAircraft(null);
    }
  };

  const insertAircraft = async (
    ac: typeof newAircraft,
    hangarData: { razon: string; mecanico: string; descripcion: string } | null
  ): Promise<boolean> => {
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
      return false;
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
      if (ordenError) {
        console.error('FALLA AL CREAR ORDEN DE TRABAJO:', ordenError.message);
        // [FIX v5.7] Aviso visible: la aeronave existe pero sin OT
        alert(`Aeronave registrada, pero NO se pudo crear su orden de trabajo: ${ordenError.message}.\nCréela desde Hangar MRO.`);
      }
    }
    setIsModalOpen(false);
    setNewAircraft({ tailNumber: '', model: '', totalHours: 0, status: 'operational', sede: 'LARA' });
    await onFleetChange?.();
    setLoading(false);
    return true;
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

  // ── [v5.8.1] SCROLL ENTRE LISTA Y DETALLE ────────────────────────────────
  // El contenedor de scroll es window. Sin esto, al abrir una aeronave que
  // está abajo en la lista (móvil), el detalle se pintaba a media altura y se
  // perdían el encabezado y "Volver a Flota". Guarda la posición de la lista,
  // sube al abrir el detalle y la restaura al volver.
  const listScrollRef = React.useRef(0);

  const abrirAeronave = useCallback((ac: Aircraft) => {
    listScrollRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
    setSelectedAircraft(ac);
  }, []);

  const selectedId = selectedAircraft?.id ?? null;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (selectedId !== null) {
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    if (listScrollRef.current > 0) {
      const y = listScrollRef.current;
      listScrollRef.current = 0;
      // un frame para que la grilla de tarjetas ya esté montada
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0 }));
    }
  }, [selectedId]);

  // ── RENDER ────────────────────────────────────────────────────────────────

  if (selectedAircraft) {
    return (
      // [v5.8] AircraftDetail v3.5 es B&M: sin isla oscura
      <AircraftDetail
        aircraft={selectedAircraft}
        onBack={() => { setSelectedAircraft(null); void onFleetChange?.(); }}
        onOpenHistorial={handleOpenHistorialFromDetail}
        onFleetChange={onFleetChange}
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

  // [v5.7] Resumen de flota por estado
  const resumen = (['operational', 'maintenance', 'grounded', 'flight'] as const)
    .map(k => ({ key: k, total: normalizedFleet.filter(a => a.status === k).length }))
    .filter(r => r.total > 0);

  const histMatricula = historialModal ? (historialModal.tailNumber ?? (historialModal as any).matricula) : '';
  const histModelo = historialModal ? ((historialModal as any).model ?? (historialModal as any).modelo ?? '') : '';

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* Barra de herramientas */}
      <div className="flex flex-col gap-4 rounded-[24px] border border-bm-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Gauge className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="bm-heading text-lg leading-tight sm:text-xl">Aeronaves registradas</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] text-bm-steel">
                {normalizedFleet.length === 1 ? '1 aeronave' : `${normalizedFleet.length} aeronaves`}
              </span>
              {resumen.map(r => (
                <BmBadge key={r.key} tone={ESTADO_AERONAVE[r.key].tone}>
                  {ESTADO_AERONAVE[r.key].label}: {r.total}
                </BmBadge>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)} className={`${bmBtn.primary} w-full sm:w-auto`}>
          <Plus className="h-5 w-5" /> Registrar aeronave
        </button>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {normalizedFleet.map(ac => (
          // [v5.8] Tarjeta B&M con las acciones en su pie (siempre visibles)
          <AircraftCard
            key={ac.id}
            aircraft={ac}
            onSelect={abrirAeronave}
            actions={<>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); abrirHistorial(ac); }}
                className={`${bmBtn.secondary} ${bmBtn.sm} flex-1`}
              >
                <History className="h-4 w-4" /> Historial
              </button>

              {/* Editar orden (solo en mantenimiento) */}
              {ac.status === 'maintenance' && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleEditarMantenimiento(ac); }}
                  disabled={loading}
                  className={`${bmBtn.dark} ${bmBtn.sm} flex-1`}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                  Editar orden
                </button>
              )}
            </>}
          />
        ))}

        {normalizedFleet.length === 0 && (
          <div className="col-span-full rounded-[24px] border border-dashed border-bm-line bg-white">
            <BmEmpty
              icon={<Plane className="h-5 w-5" />}
              title="Sin aeronaves registradas"
              text="Registre la primera aeronave para empezar a llevar su historial y mantenimiento."
              action={
                <button type="button" onClick={() => setIsModalOpen(true)} className={bmBtn.primary}>
                  <Plus className="h-5 w-5" /> Registrar aeronave
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MODAL — HISTORIAL DE AERONAVE
      ════════════════════════════════════════════════════════════════════ */}
      <BmModal
        open={!!historialModal}
        onClose={cerrarHistorial}
        title={`Historial de ${histMatricula}`}
        subtitle={histModelo || undefined}
        icon={<History className="h-5 w-5" />}
        tone="red"
        size="xl"
        z={120}
      >
        <div className="space-y-4">
          {/* Pestañas */}
          <div role="tablist" aria-label="Secciones del historial"
            className="flex gap-1 overflow-x-auto rounded-2xl border border-bm-line bg-white p-1">
            {([
              { key: 'timeline',     label: 'Línea de tiempo', icon: History,   count: historial.length },
              { key: 'componentes',  label: 'Componentes',     icon: Package,   count: componentes.length },
              { key: 'inspecciones', label: 'Inspecciones',    icon: FileCheck, count: inspecciones.length },
            ] as const).map(t => {
              const Icon = t.icon;
              const active = historialTab === t.key;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={active}
                  onClick={() => { setHistorialTab(t.key); setShowComponenteForm(false); setShowInspeccionForm(false); }}
                  className={`flex h-11 min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm transition-colors ${
                    active ? 'bg-bm-ink font-semibold text-white' : 'font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink'
                  }`}>
                  <Icon className="h-4 w-4" /> {t.label}
                  <span className={`bm-num rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-white/15' : 'bg-bm-canvas'}`}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          {histError && (
            <BmNotice tone="danger" role="alert" icon={<AlertCircle className="h-4 w-4" />}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{histError} Lo que aparece abajo puede estar incompleto.</span>
                <button type="button" onClick={() => fetchHistorial(histMatricula)} className={`${bmBtn.secondary} ${bmBtn.sm}`}>
                  Reintentar
                </button>
              </div>
            </BmNotice>
          )}

          {loadingHist ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
              <Loader2 className="h-7 w-7 animate-spin text-bm-red" />
              <p className="text-sm text-bm-steel">Cargando historial…</p>
            </div>
          ) : (
            <>
              {/* ══ TAB: TIMELINE ══════════════════════════════════════════ */}
              {historialTab === 'timeline' && (
                <div className="space-y-4">
                  {/* Filtros */}
                  <div className="flex flex-wrap gap-2">
                    {([
                      { key: 'TODO',       label: 'Todo'         },
                      { key: 'ORDEN',      label: 'Órdenes'      },
                      { key: 'COMPONENTE', label: 'Componentes'  },
                      { key: 'INSPECCION', label: 'Inspecciones' },
                    ] as const).map(f => (
                      <button key={f.key} type="button" onClick={() => setFiltroTipo(f.key)}
                        aria-pressed={filtroTipo === f.key}
                        className={`h-9 rounded-lg border px-3 text-[13px] transition-colors ${
                          filtroTipo === f.key
                            ? 'border-bm-red/30 bg-bm-red-tint font-semibold text-bm-red-deep'
                            : 'border-bm-line font-medium text-bm-steel hover:bg-bm-canvas hover:text-bm-ink'
                        }`}>
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Timeline */}
                  {historialFiltrado.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-bm-line">
                      <BmEmpty
                        icon={<History className="h-5 w-5" />}
                        title="Sin registros"
                        text="Las órdenes, componentes e inspecciones aparecerán aquí a medida que se registren."
                      />
                    </div>
                  ) : (
                    <ol className="relative space-y-3 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-bm-line">
                      {historialFiltrado.map(reg => {
                        const tipo = TIPO_REGISTRO[reg.tipo_registro] ?? { label: reg.tipo_registro, tone: 'neutral' as BmTone };
                        const expanded = expandedItem === reg.registro_id;
                        const dot = tipo.tone === 'warn' ? 'bg-bm-warn' : tipo.tone === 'info' ? 'bg-[#2F5BB7]' : 'bg-bm-ok';
                        const Icon = reg.tipo_registro === 'ORDEN' ? ClipboardList
                                   : reg.tipo_registro === 'COMPONENTE' ? Package
                                   : FileCheck;
                        const completado = reg.estado === 'Completed' || reg.estado === 'APROBADA' || reg.estado === 'ACTIVO';

                        return (
                          <li key={reg.registro_id} className="relative">
                            <span className={`absolute -left-6 top-5 h-3.5 w-3.5 rounded-full ring-4 ring-white ${dot}`} aria-hidden="true" />
                            <button type="button" onClick={() => setExpandedItem(expanded ? null : reg.registro_id)}
                              aria-expanded={expanded}
                              className="w-full rounded-2xl border border-bm-line bg-white p-4 text-left transition-colors hover:bg-bm-canvas/60">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-bm-steel" />
                                  <div className="min-w-0 flex-1">
                                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                      <BmBadge tone={tipo.tone}>{tipo.label}</BmBadge>
                                      {reg.tipo_especifico && <BmBadge tone="neutral">{reg.tipo_especifico}</BmBadge>}
                                      <BmBadge tone={completado ? 'ok' : 'neutral'} dot>
                                        {ESTADO_REGISTRO[reg.estado] ?? reg.estado}
                                      </BmBadge>
                                    </div>
                                    <p className="truncate text-sm font-semibold uppercase">{reg.titulo}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bm-steel">
                                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {fmtDateTime(reg.fecha_registro)}</span>
                                      {reg.mecanico && <span className="flex items-center gap-1"><Wrench className="h-3.5 w-3.5" /> {reg.mecanico}</span>}
                                      {reg.horas_aeronave != null && (
                                        <span className="bm-num flex items-center gap-1 font-medium text-bm-ink"><Clock className="h-3.5 w-3.5" /> {reg.horas_aeronave} h</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-bm-steel" /> : <ChevronRight className="h-4 w-4 shrink-0 text-bm-steel" />}
                              </div>
                              {expanded && (
                                <div className="bm-view mt-4 space-y-3 border-t border-bm-line pt-4">
                                  {reg.detalle && (
                                    <div>
                                      <p className="mb-1 flex items-center gap-1 text-xs text-bm-steel"><FileText className="h-3.5 w-3.5" /> Detalle</p>
                                      <p className="whitespace-pre-line font-data text-xs leading-relaxed text-bm-ink">{reg.detalle || '—'}</p>
                                    </div>
                                  )}
                                  {(reg.proxima_horas != null || reg.proxima_fecha) && (
                                    <div className="grid grid-cols-2 gap-2">
                                      {reg.proxima_horas != null && (
                                        <div className="rounded-xl bg-bm-canvas p-3">
                                          <p className="text-xs text-bm-steel">Próximo servicio</p>
                                          <p className="bm-num text-sm font-semibold">{reg.proxima_horas} h</p>
                                        </div>
                                      )}
                                      {reg.proxima_fecha && (
                                        <div className="rounded-xl bg-bm-canvas p-3">
                                          <p className="text-xs text-bm-steel">Vence</p>
                                          <p className="text-sm font-semibold">{fmtDate(reg.proxima_fecha)}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              )}

              {/* ══ TAB: COMPONENTES ═══════════════════════════════════════ */}
              {historialTab === 'componentes' && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-bm-steel">Componentes activos con vida útil restante</p>
                    <button type="button" onClick={() => setShowComponenteForm(!showComponenteForm)}
                      className={`${showComponenteForm ? bmBtn.secondary : bmBtn.primary} ${bmBtn.sm}`}>
                      {showComponenteForm ? <X className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                      {showComponenteForm ? 'Cancelar' : 'Registrar componente'}
                    </button>
                  </div>

                  {showComponenteForm && (
                    <form onSubmit={handleGuardarComponente} className="bm-view space-y-4 rounded-2xl border border-bm-line bg-bm-canvas/50 p-4 sm:p-5">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <BmField label="Tipo de componente" htmlFor="comp-tipo" required>
                          <BmSelect id="comp-tipo" className={SELECT_CLS} value={componenteForm.tipo_componente}
                            onChange={e => handleTipoComponenteChange(e.target.value)}>
                            {TIPOS_COMPONENTE.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </BmSelect>
                        </BmField>
                        <BmField label="Descripción" htmlFor="comp-desc" required>
                          <input id="comp-desc" required className={INPUT_CLS} placeholder="Ej.: Aeroshell W100"
                            value={componenteForm.descripcion}
                            onChange={e => setComponenteForm(p => ({ ...p, descripcion: e.target.value }))} />
                        </BmField>
                        <BmField label="P/N del fabricante" htmlFor="comp-pn">
                          <input id="comp-pn" className={`${INPUT_CLS} font-data`} placeholder="Opcional"
                            value={componenteForm.parte_numero}
                            onChange={e => setComponenteForm(p => ({ ...p, parte_numero: e.target.value }))} />
                        </BmField>
                        <BmField label="Fecha de instalación" htmlFor="comp-fecha" required>
                          <input id="comp-fecha" type="date" required className={DATE_CLS}
                            value={componenteForm.fecha_instalacion}
                            onChange={e => setComponenteForm(p => ({ ...p, fecha_instalacion: e.target.value }))} />
                        </BmField>
                        <BmField label="Horas de la aeronave al instalar" htmlFor="comp-horas" required>
                          <input id="comp-horas" type="number" step="0.1" min="0" required inputMode="decimal" className={`${bmInput} bm-num`} placeholder="0.0"
                            value={componenteForm.horas_aeronave}
                            onChange={e => setComponenteForm(p => ({ ...p, horas_aeronave: e.target.value }))} />
                        </BmField>
                        <BmField label="Mecánico" htmlFor="comp-mec">
                          <input id="comp-mec" className={INPUT_CLS} placeholder="Nombre"
                            value={componenteForm.mecanico}
                            onChange={e => setComponenteForm(p => ({ ...p, mecanico: e.target.value }))} />
                        </BmField>
                        <BmField label="Intervalo en horas" htmlFor="comp-ih">
                          <input id="comp-ih" type="number" step="0.1" inputMode="decimal" className={`${bmInput} bm-num`} placeholder="Ej.: 50"
                            value={componenteForm.intervalo_horas}
                            onChange={e => setComponenteForm(p => ({ ...p, intervalo_horas: e.target.value }))} />
                        </BmField>
                        <BmField label="Intervalo en meses" htmlFor="comp-im">
                          <input id="comp-im" type="number" min="0" inputMode="numeric" className={`${bmInput} bm-num`} placeholder="Ej.: 24"
                            value={componenteForm.intervalo_meses}
                            onChange={e => setComponenteForm(p => ({ ...p, intervalo_meses: e.target.value }))} />
                        </BmField>
                      </div>
                      <BmField label="Observaciones" htmlFor="comp-obs">
                        <textarea id="comp-obs" rows={2} className={bmTextarea} placeholder="Notas técnicas"
                          value={componenteForm.observaciones}
                          onChange={e => setComponenteForm(p => ({ ...p, observaciones: e.target.value }))} />
                      </BmField>
                      <BmNotice tone="warn" icon={<AlertCircle className="h-4 w-4" />}>
                        Los componentes anteriores del mismo tipo se marcarán como <strong>retirados</strong> automáticamente.
                      </BmNotice>
                      <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button type="button" onClick={() => setShowComponenteForm(false)} className={`${bmBtn.secondary} sm:flex-1`}>
                          Cancelar
                        </button>
                        <button type="submit" disabled={loadingHist} className={`${bmBtn.primary} sm:flex-1`}>
                          {loadingHist ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Registrar componente
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Lista de componentes activos */}
                  {componentes.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-bm-line">
                      <BmEmpty
                        icon={<Package className="h-5 w-5" />}
                        title="Sin componentes registrados"
                        text="Registre aceite, filtros, bujías y demás para seguir su vida útil."
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {componentes.map(c => {
                        const Icon = iconoComponente(c.tipo_componente);
                        const horasRest = c.horas_restantes;
                        const alerta = horasRest != null
                          ? horasRest < 10 ? 'critico'
                          : horasRest < 30 ? 'advertencia'
                          :                  'normal'
                          : 'normal';
                        const a = ALERTA_TONE[alerta];
                        return (
                          <div key={c.id} className={`rounded-2xl border bg-white p-4 ${a.border}`}>
                            <div className="mb-3 flex items-start gap-3">
                              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                a.tone === 'danger' ? 'bg-bm-red-tint text-bm-red' : a.tone === 'warn' ? 'bg-bm-warn-tint text-bm-warn' : 'bg-bm-ok-tint text-bm-ok'
                              }`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold uppercase">{c.descripcion}</p>
                                <p className="text-xs text-bm-steel">{c.tipo_componente}</p>
                                {c.parte_numero && <p className="mt-0.5 font-data text-xs text-bm-steel">P/N {c.parte_numero}</p>}
                              </div>
                              {alerta === 'critico' && <BmBadge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Crítico</BmBadge>}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-xl bg-bm-canvas p-3">
                                <p className="text-xs text-bm-steel">Instalado a</p>
                                <p className="bm-num text-sm font-semibold">{c.horas_al_instalar} h</p>
                              </div>
                              <div className="rounded-xl bg-bm-canvas p-3">
                                <p className="text-xs text-bm-steel">Restantes</p>
                                <p className={`bm-num text-sm font-semibold ${a.text}`}>
                                  {horasRest != null ? `${horasRest.toFixed(1)} h` : '—'}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-bm-steel">
                              <span>Instalado {fmtDate(c.fecha_instalacion)}</span>
                              {c.mecanico && <span className="truncate">Por {c.mecanico}</span>}
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
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-bm-steel">Última inspección de cada tipo con su vigencia</p>
                    <button type="button" onClick={() => setShowInspeccionForm(!showInspeccionForm)}
                      className={`${showInspeccionForm ? bmBtn.secondary : bmBtn.primary} ${bmBtn.sm}`}>
                      {showInspeccionForm ? <X className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                      {showInspeccionForm ? 'Cancelar' : 'Registrar inspección'}
                    </button>
                  </div>

                  {showInspeccionForm && (
                    <form onSubmit={handleGuardarInspeccion} className="bm-view space-y-4 rounded-2xl border border-bm-line bg-bm-canvas/50 p-4 sm:p-5">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <BmField label="Tipo" htmlFor="insp-tipo" required>
                          <BmSelect id="insp-tipo" className={SELECT_CLS} value={inspeccionForm.tipo_inspeccion}
                            onChange={e => handleTipoInspeccionChange(e.target.value)}>
                            {TIPOS_INSPECCION.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                          </BmSelect>
                        </BmField>
                        <BmField label="Descripción" htmlFor="insp-desc" required>
                          <input id="insp-desc" required className={INPUT_CLS}
                            value={inspeccionForm.descripcion}
                            onChange={e => setInspeccionForm(p => ({ ...p, descripcion: e.target.value }))} />
                        </BmField>
                        <BmField label="Fecha realizada" htmlFor="insp-fecha" required>
                          <input id="insp-fecha" type="date" required className={DATE_CLS}
                            value={inspeccionForm.fecha_realizada}
                            onChange={e => setInspeccionForm(p => ({ ...p, fecha_realizada: e.target.value }))} />
                        </BmField>
                        <BmField label="Horas de la aeronave" htmlFor="insp-horas" required>
                          <input id="insp-horas" type="number" step="0.1" min="0" required inputMode="decimal" className={`${bmInput} bm-num`}
                            value={inspeccionForm.horas_aeronave}
                            onChange={e => setInspeccionForm(p => ({ ...p, horas_aeronave: e.target.value }))} />
                        </BmField>
                        <BmField label="Próxima a las horas" htmlFor="insp-prox-h" hint="Se calcula al elegir el tipo.">
                          <input id="insp-prox-h" type="number" step="0.1" inputMode="decimal" className={`${bmInput} bm-num`} placeholder="Automático"
                            value={inspeccionForm.proxima_horas}
                            onChange={e => setInspeccionForm(p => ({ ...p, proxima_horas: e.target.value }))} />
                        </BmField>
                        <BmField label="Vence en fecha" htmlFor="insp-prox-f">
                          <input id="insp-prox-f" type="date" className={DATE_CLS}
                            value={inspeccionForm.proxima_fecha}
                            onChange={e => setInspeccionForm(p => ({ ...p, proxima_fecha: e.target.value }))} />
                        </BmField>
                        <BmField label="Mecánico o inspector" htmlFor="insp-mec">
                          <input id="insp-mec" className={INPUT_CLS} placeholder="Nombre"
                            value={inspeccionForm.mecanico}
                            onChange={e => setInspeccionForm(p => ({ ...p, mecanico: e.target.value }))} />
                        </BmField>
                        <BmField label="N.º de certificado" htmlFor="insp-cert">
                          <input id="insp-cert" className={INPUT_CLS} placeholder="Opcional"
                            value={inspeccionForm.certificado_numero}
                            onChange={e => setInspeccionForm(p => ({ ...p, certificado_numero: e.target.value }))} />
                        </BmField>
                      </div>
                      <BmField label="Hallazgos" htmlFor="insp-hall">
                        <textarea id="insp-hall" rows={2} className={bmTextarea} placeholder="Desviaciones detectadas"
                          value={inspeccionForm.hallazgos}
                          onChange={e => setInspeccionForm(p => ({ ...p, hallazgos: e.target.value }))} />
                      </BmField>
                      <BmField label="Observaciones" htmlFor="insp-obs">
                        <textarea id="insp-obs" rows={2} className={bmTextarea} placeholder="Notas técnicas"
                          value={inspeccionForm.observaciones}
                          onChange={e => setInspeccionForm(p => ({ ...p, observaciones: e.target.value }))} />
                      </BmField>
                      <div className="flex flex-col-reverse gap-3 sm:flex-row">
                        <button type="button" onClick={() => setShowInspeccionForm(false)} className={`${bmBtn.secondary} sm:flex-1`}>
                          Cancelar
                        </button>
                        <button type="submit" disabled={loadingHist} className={`${bmBtn.primary} sm:flex-1`}>
                          {loadingHist ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Registrar inspección
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Lista de inspecciones vigentes */}
                  {inspecciones.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-bm-line">
                      <BmEmpty
                        icon={<FileCheck className="h-5 w-5" />}
                        title="Sin inspecciones registradas"
                        text="Registre 100 h, anual (IA), aviónica y demás para controlar su vencimiento."
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {inspecciones.map((i, idx) => {
                        const horasRest = i.horas_restantes;
                        const diasRest  = i.dias_restantes;
                        const alerta = (horasRest != null && horasRest < 10) || (diasRest != null && diasRest < 15)
                          ? 'critico'
                          : (horasRest != null && horasRest < 30) || (diasRest != null && diasRest < 30)
                          ? 'advertencia'
                          : 'normal';
                        const a = ALERTA_TONE[alerta];
                        return (
                          <div key={idx} className={`rounded-2xl border bg-white p-4 ${a.border}`}>
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="flex min-w-0 flex-1 items-start gap-3">
                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                  a.tone === 'danger' ? 'bg-bm-red-tint text-bm-red' : a.tone === 'warn' ? 'bg-bm-warn-tint text-bm-warn' : 'bg-bm-ok-tint text-bm-ok'
                                }`}>
                                  <FileCheck className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold uppercase">{i.descripcion}</p>
                                  <p className="text-xs text-bm-steel">{i.tipo_inspeccion}</p>
                                </div>
                              </div>
                              {alerta === 'critico' && <BmBadge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Crítico</BmBadge>}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {horasRest != null && (
                                <div className="rounded-xl bg-bm-canvas p-3">
                                  <p className="text-xs text-bm-steel">Horas restantes</p>
                                  <p className={`bm-num text-sm font-semibold ${a.text}`}>{horasRest.toFixed(1)} h</p>
                                </div>
                              )}
                              {diasRest != null && (
                                <div className="rounded-xl bg-bm-canvas p-3">
                                  <p className="text-xs text-bm-steel">Días restantes</p>
                                  <p className={`bm-num text-sm font-semibold ${a.text}`}>{diasRest} d</p>
                                </div>
                              )}
                            </div>
                            <p className="mt-2 text-xs text-bm-steel">
                              Última {fmtDate(i.ultima_realizada)}, a las <span className="bm-num">{i.horas_ultima}</span> h
                            </p>
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
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          MODAL — EDITAR ORDEN DE TRABAJO
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isEditOpen && !!ordenEditing}
        onClose={() => { setIsEditOpen(false); setOrdenEditing(null); }}
        busy={loading}
        title="Actualizar orden de trabajo"
        subtitle={ordenEditing ? `${ordenEditing.matricula} · ${ordenEditing.modelo ?? ''}` : undefined}
        icon={<ClipboardList className="h-5 w-5" />}
        tone="neutral"
        z={110}
      >
        {ordenEditing && (
          <form onSubmit={handleGuardarEdicion} className="space-y-5">
            <div className="space-y-3 rounded-2xl bg-bm-canvas p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-bm-steel">Tarea</p>
                  <p className="mt-0.5 text-sm font-semibold uppercase leading-snug">{ordenEditing.descripcion_tarea}</p>
                </div>
                <div>
                  <p className="text-xs text-bm-steel">Técnico</p>
                  <p className="mt-0.5 text-sm font-semibold uppercase">{ordenEditing.nombre_mecanico}</p>
                </div>
              </div>
              {ordenEditing.observaciones && (
                <div className="border-t border-bm-line pt-3">
                  <p className="mb-1 text-xs text-bm-steel">Observaciones registradas</p>
                  <p className="max-h-24 overflow-y-auto whitespace-pre-line font-data text-xs leading-relaxed">
                    {ordenEditing.observaciones}
                  </p>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <BmField label="Técnico asignado" htmlFor="fl-mec">
                <input id="fl-mec" className={INPUT_CLS} placeholder="Nombre del técnico"
                  value={editForm.mecanico}
                  onChange={e => setEditForm(prev => ({ ...prev, mecanico: e.target.value }))} />
              </BmField>
              <BmField label="Estado de la orden" htmlFor="fl-estado">
                <BmSelect id="fl-estado" className={SELECT_CLS} value={editForm.estado}
                  onChange={e => setEditForm(prev => ({ ...prev, estado: e.target.value }))}>
                  <option value="In Progress">En progreso</option>
                  <option value="Pending Parts">Esperando repuestos</option>
                  <option value="Completed">Completada (cierre)</option>
                  <option value="On Hold">En espera</option>
                </BmSelect>
              </BmField>
            </div>

            <BmField
              label={cerrandoOrden
                ? 'Observaciones de cierre'
                : <><PlusCircle className="h-4 w-4 text-bm-red" /> Daños adicionales</>}
              htmlFor="fl-hallazgos"
              required={cerrandoOrden}
              hint={cerrandoOrden
                ? 'Trabajo efectuado, repuestos instalados y comprobaciones realizadas.'
                : 'Se registra con fecha y hora en el historial de la orden.'}
            >
              <textarea id="fl-hallazgos" rows={3}
                required={cerrandoOrden}
                className={`${bmTextarea} ${cerrandoOrden ? '' : 'uppercase placeholder:normal-case'}`}
                placeholder={cerrandoOrden ? 'Describa el trabajo efectuado' : 'Describa daños o hallazgos adicionales'}
                value={editForm.nuevosHallazgos}
                onChange={e => setEditForm(prev => ({ ...prev, nuevosHallazgos: e.target.value }))} />
            </BmField>

            {cerrandoOrden ? (
              <BmNotice tone="warn" icon={<AlertCircle className="h-4 w-4" />}>
                La orden se cierra con el mismo procedimiento de Hangar MRO. Cerrarla <strong>no libera la
                aeronave</strong>: sigue fuera de servicio hasta su liberación autorizada.
              </BmNotice>
            ) : (
              <BmNotice tone="info" icon={<AlertCircle className="h-4 w-4" />}>
                Los nuevos hallazgos se <strong>agregan al historial</strong> de la orden existente.
              </BmNotice>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button type="button" onClick={() => { setIsEditOpen(false); setOrdenEditing(null); }}
                disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
                Cancelar
              </button>
              <button type="submit" disabled={loading} className={`${cerrandoOrden ? bmBtn.dark : bmBtn.primary} sm:flex-[2]`}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {loading ? 'Guardando…' : cerrandoOrden ? 'Cerrar orden' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 1 — REGISTRO
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        busy={loading}
        title="Registrar aeronave"
        subtitle={newAircraft.status === 'maintenance' ? 'Paso 1 de 2: datos de la aeronave' : 'Alta en la flota de una sede'}
        icon={<ShieldCheck className="h-5 w-5" />}
        tone="red"
        z={100}
      >
        <form onSubmit={handleFormSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Matrícula" htmlFor="ac-mat" required>
              <input id="ac-mat" required className={`${INPUT_CLS} font-data`}
                placeholder="YV-XXXX"
                value={newAircraft.tailNumber}
                onChange={e => setNewAircraft({ ...newAircraft, tailNumber: e.target.value })} />
            </BmField>
            <BmField label="Sede operativa" htmlFor="ac-sede">
              <BmSelect id="ac-sede" className={SELECT_CLS} value={newAircraft.sede}
                onChange={e => setNewAircraft({ ...newAircraft, sede: e.target.value as any })}>
                <option value="LARA">Base Lara</option>
                <option value="MATURIN">Base Maturín</option>
              </BmSelect>
            </BmField>
          </div>
          <BmField label="Modelo" htmlFor="ac-modelo" required>
            <input id="ac-modelo" required className={INPUT_CLS}
              placeholder="Ej.: Cessna 152"
              value={newAircraft.model}
              onChange={e => setNewAircraft({ ...newAircraft, model: e.target.value })} />
          </BmField>
          <BmField label="Estatus inicial" htmlFor="ac-estado">
            <BmSelect id="ac-estado" className={SELECT_CLS} value={newAircraft.status}
              onChange={e => setNewAircraft({ ...newAircraft, status: e.target.value as any })}>
              <option value="operational">Operativa</option>
              <option value="maintenance">En mantenimiento</option>
              <option value="grounded">En tierra (AOG)</option>
            </BmSelect>
          </BmField>
          {newAircraft.status === 'maintenance' && (
            <BmNotice tone="info" icon={<Wrench className="h-4 w-4" />}>
              Se pedirá la razón de entrada a hangar y se creará la orden de trabajo automáticamente.
            </BmNotice>
          )}
          <BmField label="Horas totales (TT)" htmlFor="ac-horas" required>
            <input id="ac-horas" type="number" step="0.1" required inputMode="decimal"
              className={`${bmInput} bm-num h-14 text-center text-2xl font-semibold`}
              placeholder="0.0"
              value={newAircraft.totalHours || ''}
              onChange={e => setNewAircraft({ ...newAircraft, totalHours: parseFloat(e.target.value) })} />
          </BmField>
          <button type="submit" disabled={loading} className={`${bmBtn.primary} w-full`}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" />
              : newAircraft.status === 'maintenance'
                ? <><ShieldAlert className="h-4 w-4" /> Continuar con la razón de hangar</>
                : <><Plane className="h-4 w-4" /> Registrar aeronave</>}
          </button>
        </form>
      </BmModal>

      {/* ════════════════════════════════════════════════════════════
          MODAL PASO 2 — RAZÓN DE HANGAR
      ════════════════════════════════════════════════════════════ */}
      <BmModal
        open={isRazonOpen && !!pendingAircraft}
        onClose={handleCancelRazon}
        busy={loading}
        title="Razón de entrada a hangar"
        subtitle={pendingAircraft ? `Paso 2 de 2: ${pendingAircraft.tailNumber.toUpperCase()} · ${pendingAircraft.model.toUpperCase()}` : undefined}
        icon={<Wrench className="h-5 w-5" />}
        tone="warn"
        size="sm"
        z={105}
      >
        <form onSubmit={handleRazonConfirm} className="space-y-4">
          <BmField label="Motivo" htmlFor="rz-motivo" required>
            <BmSelect id="rz-motivo" required className={SELECT_CLS} value={razonForm.razon}
              onChange={e => setRazonForm({ ...razonForm, razon: e.target.value, razonCustom: '' })}>
              <option value="">Seleccione el motivo</option>
              {RAZONES_PREDEFINIDAS.map(r => (<option key={r} value={r}>{r}</option>))}
            </BmSelect>
          </BmField>
          {razonForm.razon === 'Otra (especificar)' && (
            <BmField label="Especifique" htmlFor="rz-custom" required>
              <input id="rz-custom" required className={INPUT_CLS}
                placeholder="Describa la razón"
                value={razonForm.razonCustom}
                onChange={e => setRazonForm({ ...razonForm, razonCustom: e.target.value })} />
            </BmField>
          )}
          <BmField label="Descripción técnica" htmlFor="rz-desc">
            <textarea id="rz-desc" rows={2} className={`${bmTextarea} uppercase placeholder:normal-case`}
              placeholder="Detalle adicional"
              value={razonForm.descripcion}
              onChange={e => setRazonForm({ ...razonForm, descripcion: e.target.value })} />
          </BmField>
          <BmField label="Técnico asignado" htmlFor="rz-mec" hint="Opcional.">
            <input id="rz-mec" className={INPUT_CLS}
              placeholder="Nombre del técnico"
              value={razonForm.mecanico}
              onChange={e => setRazonForm({ ...razonForm, mecanico: e.target.value })} />
          </BmField>
          <BmNotice tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
            La aeronave se registra <strong>en mantenimiento</strong> y su orden aparecerá en Hangar MRO.
          </BmNotice>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" onClick={handleCancelRazon} disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
              Volver
            </button>
            <button type="submit" disabled={loading} className={`${bmBtn.primary} sm:flex-[1.4]`}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {loading ? 'Registrando…' : 'Registrar aeronave'}
            </button>
          </div>
        </form>
      </BmModal>
    </div>
  );
};

export default FleetDashboard;

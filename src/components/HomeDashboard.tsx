// HomeDashboard.tsx
// Terminal de Inteligencia B&M v5.0.1 - VALKYRON OS
// B&M Mantenimiento Aeronáutico (ex Águilas Pilot) — Inventario & MRO
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v5.0.1:
//   [FIX]  Se retira import '../theme/bm-theme.css': el tema entra una sola vez
//          por index.css (alias @/). Evita el error de Vite si el archivo no
//          está junto al componente y la carga duplicada de fuentes.
// CHANGELOG v5.0 — REBRAND B&M:
//   [UI]   Identidad B&M: lienzo #F2F3F5, superficies blancas, rojo B&M #D42125
//          como acento. Retirados #050505 / #E1AD01 (Águilas Pilot).
//   [UI]   Mobile-first: KPIs en bento 2 → 4 columnas con jerarquía (flota en
//          bloque rojo, deuda en bloque grafito). Panel operativo en filas en
//          móvil y columnas desde md.
//   [UI]   Acciones rápidas: hoja inferior en móvil, diálogo centrado en md+.
//          Cierra con Esc, tocando fuera o con la X. Bloquea el scroll de fondo.
//   [UI]   Tipografía Archivo Variable (bm-theme.css). Cifras en ancho
//          expandido itálico, eco del wordmark B&M.
//   [UI]   Estados explícitos en Actividad contable: skeleton de carga, sin
//          movimientos, rol sin acceso a finanzas.
//   [FIX]  Cierre de vuelo: el formulario no tenía campos Tach inicial/final,
//          por lo que tachDiff era siempre 0 y la certificación nunca podía
//          completarse. Se agregan los dos campos sobre el estado logData
//          existente. handleLogFlight no cambia.
//   [A11Y] role="dialog" + aria-modal, tarjeta de deuda operable por teclado,
//          foco visible, respeta prefers-reduced-motion.
// PRESERVADO ÍNTEGRO (v4.13): fetch con AbortController + retry con backoff,
//   canal realtime, blindaje de roles, cálculos (fleetHealth, horas, stock,
//   AOG, deuda de capitanes), handleLogFlight, rutas de onNavigate.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  Plane, Package, Wrench, Activity, Zap, ShieldCheck,
  Clock, PlusCircle, X, Navigation, CheckCircle2,
  DollarSign, TrendingUp, Landmark, ArrowRight, Loader2,
  ArrowUpCircle, ArrowDownCircle, Wallet, Calculator, Coins, UserCheck, AlertTriangle,
  WifiOff, RefreshCw,  // [v4.13] íconos de estado de red
  ChevronRight, ChevronLeft, ChevronDown, Lock  // [v5.0] navegación de filas y hoja
} from 'lucide-react';
// [v5.0.1] El tema B&M (bm-theme.css) se carga una sola vez desde index.css.

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DE CONFIGURACIÓN DE RED (v4.13)
// ─────────────────────────────────────────────────────────────────────────────
const FETCH_RETRY_LIMIT = 3;
const FETCH_RETRY_DELAY_MS = 1500;

/** Espera N ms respetando el AbortSignal — se cancela limpiamente si el componente desmonta */
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
  });

// ─────────────────────────────────────────────────────────────────────────────
// [v5.0] PIEZAS DE UI B&M — a nivel de módulo (no se re-montan en cada render)
// ─────────────────────────────────────────────────────────────────────────────

/** Estado de pago de una transacción. PAID → Pagado; cualquier otro → Pendiente. */
const StatusPill = ({ paid }: { paid: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
      paid ? 'bg-[#E7F5EE] text-[#18794E]' : 'bg-[#FEF3E2] text-[#B45309]'
    }`}
  >
    <span className={`h-1.5 w-1.5 rounded-full ${paid ? 'bg-[#18794E]' : 'bg-[#B45309]'}`} />
    {paid ? 'Pagado' : 'Pendiente'}
  </span>
);

/** Filas fantasma mientras llega la primera sincronización. */
const ActivitySkeleton = () => (
  <ul className="divide-y divide-[#E3E5E9]" aria-hidden="true">
    {[0, 1, 2, 3].map(i => (
      <li key={i} className="flex items-center justify-between gap-4 py-3.5">
        <div className="flex-1 space-y-2">
          <div className="bm-skeleton h-3 w-2/3 rounded-full" />
          <div className="bm-skeleton h-2.5 w-1/3 rounded-full" />
        </div>
        <div className="bm-skeleton h-3 w-16 rounded-full" />
      </li>
    ))}
  </ul>
);

/** Estado vacío con dirección: dice qué pasa y, si aplica, qué hacer. */
const EmptyState = ({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) => (
  <div className="flex flex-col items-center justify-center text-center py-8 px-4">
    <div className="h-11 w-11 rounded-full bg-[#F2F3F5] text-[#5F6670] flex items-center justify-center">{icon}</div>
    <p className="mt-3 text-sm font-semibold text-[#1B1D22]">{title}</p>
    <p className="mt-1 text-[13px] leading-snug text-[#5F6670] max-w-[240px]">{text}</p>
  </div>
);

/** Campo numérico de contador (Tach). 16 px para que iOS no haga zoom al enfocar. */
const CounterField = ({
  id, label, value, onChange,
}: { id: string; label: string; value: number; onChange: (v: number) => void }) => (
  <div>
    <label htmlFor={id} className="text-sm font-medium text-[#1B1D22]">{label}</label>
    <input
      id={id}
      type="number"
      inputMode="decimal"
      step="0.1"
      min="0"
      required
      placeholder="0.0"
      value={value || ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="bm-num mt-1.5 w-full h-12 rounded-xl border border-[#D9DCE1] bg-white px-4 text-base text-[#1B1D22] placeholder:text-[#9AA0A8] outline-none transition-[border-color,box-shadow] focus:border-[#D42125] focus:ring-4 focus:ring-[#D42125]/10"
    />
  </div>
);

export const HomeDashboard = ({
  fleet = [],
  inventory = [],
  activeTasks = [],
  vendors = [],
  financeData: externalFinanceData = { CASH: 0, ZELLE: 0, USDT: 0, BS: 0 },
  onNavigate,
  onFlightLogUpdate,
  userRole = "MECANICO"
}: any) => {
  // --- ESTADOS DE CONTROL TÁCTICO ---
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false);
  const [activeQuickView, setActiveQuickView] = useState<'menu' | 'logbook' | 'vault' | 'capitanes'>('menu');
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(true);

  // [v4.13] Estado de error de red para mostrar UI de reintento
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const [logData, setLogData] = useState({
    aircraftId: '',
    hobbsStart: 0,
    hobbsEnd: 0,
    tachStart: 0,
    tachEnd: 0
  });

  // [v5.0] Referencia al botón de cierre de la hoja: recibe el foco al abrir
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // --- BLINDAJE DE ROLES (GRADO MILITAR v4.12 — conservado intacto) ---
  const rolRaw = userRole || "";
  const rol = rolRaw.toUpperCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hasFinanceAccess = rol === 'CEO' || rol === 'ADMIN' || rol.includes('ADMIN');

  // ─────────────────────────────────────────────────────────────────────────
  // [v4.13] FETCH CON ABORT + RETRY EXPONENCIAL
  // Resuelve: ERR_NETWORK_CHANGED, TypeError: Failed to fetch, 400 en finanzas
  // Patrón: AbortController con cleanup en return() del useEffect garantiza que
  // ningún setState se ejecuta sobre un componente ya desmontado.
  // ─────────────────────────────────────────────────────────────────────────
  const fetchRecentActivity = useCallback(async (signal: AbortSignal) => {
    let attempt = 0;

    while (attempt < FETCH_RETRY_LIMIT) {
      if (signal.aborted) return; // Guardia de cancelación

      try {
        setIsSyncing(true);
        setNetworkError(null);

        const { data, error } = await supabase
          .from('transacciones_finanzas')
          .select('id, entity_name, amount, status, category, created_at')  // [v4.13] select explícito — evita 400 por columnas fantasma
          .order('created_at', { ascending: false })
          .limit(50); // [v4.13] tope defensivo — sin limit, un payload enorme causa timeout

        if (signal.aborted) return; // Guardia post-await

        if (error) {
          // Error de Supabase (no de red): 400/403/404 — no tiene sentido reintentar
          console.error(`[VALKYRON OS v4.13] FALLA RADAR FINANCIERO (intento ${attempt + 1}):`, error);

          if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
            // 404 equivalente: tabla/vista no existe — falla silenciosa con estado informativo
            setNetworkError(`tabla_no_encontrada:${error.message}`);
            setIsSyncing(false);
            return; // Sin reintento — el schema no va a aparecer por arte de magia
          }

          // Para errores 400 (schema mismatch, RLS): reintento con backoff
          attempt++;
          if (attempt < FETCH_RETRY_LIMIT) {
            await sleep(FETCH_RETRY_DELAY_MS * attempt, signal);
          } else {
            setNetworkError(`supabase_error:${error.message}`);
            setIsSyncing(false);
          }
          continue;
        }

        // ✅ Éxito
        if (data) setRecentTransactions(data);
        setIsSyncing(false);
        setNetworkError(null);
        return;

      } catch (err: any) {
        if (signal.aborted || err.name === 'AbortError') return; // Cancelación limpia — no es un error

        console.warn(`[VALKYRON OS v4.13] ERR_NETWORK (intento ${attempt + 1}):`, err.message);
        attempt++;

        if (attempt < FETCH_RETRY_LIMIT) {
          // Backoff exponencial: 1.5s, 3s, 4.5s
          await sleep(FETCH_RETRY_DELAY_MS * attempt, signal);
        } else {
          if (!signal.aborted) {
            setNetworkError(`network:${err.message}`);
            setIsSyncing(false);
          }
        }
      }
    }
  }, []); // Sin deps — supabase es estable

  // ─────────────────────────────────────────────────────────────────────────
  // [v4.13] RECONOCIMIENTO DE ACTIVIDAD Y SINCRONIZACIÓN CON CLEANUP NUCLEAR
  // El AbortController.abort() en el return() garantiza:
  //  1. Ningún setState post-desmontaje
  //  2. El retry loop se cancela instantáneamente
  //  3. El canal realtime se destruye limpiamente
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasFinanceAccess) {
      setIsSyncing(false); // [v4.13] Fix: isSyncing no queda en true para roles sin acceso
      return;
    }

    const controller = new AbortController();

    fetchRecentActivity(controller.signal);

    const channel = supabase
      .channel('home-updates-v4-13') // [v4.13] canal actualizado — evita conflicto con v4.12
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transacciones_finanzas' },
        () => {
          if (!controller.signal.aborted) fetchRecentActivity(controller.signal);
        }
      )
      .subscribe();

    return () => {
      controller.abort();              // Cancela fetch en vuelo y loops de retry
      supabase.removeChannel(channel); // Destruye subscripción realtime
    };
  }, [hasFinanceAccess, fetchRecentActivity, retryCount]); // retryCount permite trigger manual

  // ─────────────────────────────────────────────────────────────────────────
  // [v5.0] HOJA DE ACCIONES RÁPIDAS: Esc cierra, scroll de fondo bloqueado,
  // foco inicial en el botón de cierre. Solo comportamiento de presentación.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isQuickActionOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsQuickActionOpen(false);
    };
    const prevOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [isQuickActionOpen]);

  // --- CÁLCULO DE OPERATIVIDAD DINÁMICA (v4.12 — conservado intacto) ---
  const fleetHealth = useMemo(() => {
    if (fleet.length === 0) return 0;
    const operationalUnits = fleet.filter((a: any) => a.status === 'operational').length;
    return (operationalUnits / fleet.length) * 100;
  }, [fleet]);

  // [v5.0] Conteo absoluto para el subtítulo del bloque de flota (mismo criterio que fleetHealth)
  const operationalCount = useMemo(() => fleet.filter((a: any) => a.status === 'operational').length, [fleet]);

  const totalFleetHours = useMemo(() => fleet.reduce((acc: number, ac: any) => acc + (Number(ac.hours_vuelo_totales) || 0), 0), [fleet]);
  const criticalStock = useMemo(() => inventory.filter((item: any) => item.quantity <= item.minStock).length, [inventory]);
  const aogCount = useMemo(() => fleet.filter((ac: any) => ac.status === 'grounded' || ac.status === 'maintenance').length, [fleet]);

  // [v5.0] Matrículas no operativas (mismo criterio que aogCount) para la nota del panel en md+
  const aogTails = useMemo(
    () => fleet
      .filter((ac: any) => ac.status === 'grounded' || ac.status === 'maintenance')
      .map((ac: any) => ac.tailNumber)
      .filter(Boolean)
      .join(', '),
    [fleet]
  );

  // --- INTELIGENCIA DE DEUDA DE CAPITANES (v4.12 — conservado intacto) ---
  const instructionDebt = useMemo(() => {
    if (!hasFinanceAccess) return 0;
    return recentTransactions
      .filter(t => (t.category?.includes('Nomina') || t.category?.includes('Training')) && t.status === 'PENDING')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }, [recentTransactions, hasFinanceAccess]);

  const captainDebts = useMemo(() => {
    const debts: { [key: string]: number } = {};
    recentTransactions
      .filter(t => (t.category?.includes('Nomina') || t.category?.includes('Training')) && t.status === 'PENDING')
      .forEach(t => {
        const name = t.entity_name || 'Capitán Desconocido';
        debts[name] = (debts[name] || 0) + Number(t.amount);
      });
    return Object.entries(debts).map(([nombre, monto]) => ({ nombre, monto }));
  }, [recentTransactions]);

  const pendingMaintenance = activeTasks.filter((t: any) => t.status !== 'Completed').length;

  // [v5.0] Fecha de cabecera (es-VE), calculada una vez por montaje
  const fechaHoy = useMemo(
    () => new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }),
    []
  );

  const tachCycle = logData.tachEnd - logData.tachStart; // [v5.0] solo lectura para la vista

  const handleLogFlight = (e: React.FormEvent) => {
    e.preventDefault();
    const tachDiff = logData.tachEnd - logData.tachStart;
    if (tachDiff > 0 && logData.aircraftId) {
      if (onFlightLogUpdate) onFlightLogUpdate(logData.aircraftId, tachDiff);
      setIsQuickActionOpen(false);
      setActiveQuickView('menu');
      alert(`[VALKYRON OPS] Bitácora certificada.`);
    } else {
      alert("Error Táctico: Verifique los contadores.");
    }
  };

  // [v5.0] Abre la liquidación de capitanes (click o teclado sobre el bloque grafito)
  const openCaptains = () => { setActiveQuickView('capitanes'); setIsQuickActionOpen(true); };

  // [v5.0] Encabezado de la hoja según la vista activa
  const quickTitle =
    activeQuickView === 'vault' ? 'Bóveda de capital'
    : activeQuickView === 'capitanes' ? 'Liquidación de capitanes'
    : activeQuickView === 'logbook' ? 'Cierre de vuelo'
    : 'Registro rápido';
  const quickSubtitle =
    activeQuickView === 'capitanes' ? 'Nómina e instrucción pendientes de pago'
    : activeQuickView === 'logbook' ? 'Contadores Tach de la aeronave'
    : '¿Qué desea registrar?';

  // ─────────────────────────────────────────────────────────────────────────
  // [v4.13] COMPONENTE DE ESTADO DE RED — inline, sin dependencias externas
  // Se inyecta en el panel de Actividad Contable cuando networkError !== null
  // [v5.0] Reestilizado B&M; misma lógica de clasificación y reintento.
  // ─────────────────────────────────────────────────────────────────────────
  const NetworkErrorBanner = () => {
    const isSchemaError = networkError?.startsWith('tabla_no_encontrada');
    const isNetworkError = networkError?.startsWith('network:');

    return (
      <div className="flex flex-col items-center justify-center text-center py-8 px-4 gap-3">
        <div className={`h-11 w-11 rounded-full flex items-center justify-center ${isNetworkError ? 'bg-[#FEF3E2] text-[#B45309]' : 'bg-[#FCEBEC] text-[#D42125]'}`}>
          {isNetworkError
            ? <WifiOff className="h-5 w-5" />
            : <AlertTriangle className="h-5 w-5" />
          }
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1B1D22]">
            {isSchemaError ? 'Tabla no encontrada' : isNetworkError ? 'Sin conexión' : 'Error del servidor'}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-[#5F6670] max-w-[240px]">
            {isSchemaError
              ? 'transacciones_finanzas no existe en el esquema público.'
              : isNetworkError
              ? 'No se pudo contactar al servidor. Verifique la conexión a internet.'
              : 'Supabase rechazó la consulta. Intente de nuevo en unos segundos.'
            }
          </p>
        </div>
        {!isSchemaError && (
          // No ofrecer retry si el schema no existe — es inútil
          <button
            type="button"
            onClick={() => setRetryCount(c => c + 1)}
            className="mt-1 inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-[#E3E5E9] bg-white text-sm font-semibold text-[#1B1D22] hover:border-[#D42125] hover:text-[#D42125] transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Reintentar
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bm-app bg-[#F2F3F5] rounded-[28px] p-3 sm:p-5 lg:p-6 space-y-3 sm:space-y-4 text-left relative">

      {/* [v5.0] CABECERA */}
      <header className="px-1 pt-1 pb-1 sm:pb-2">
        <h2 className="bm-heading text-[22px] sm:text-[28px] leading-tight text-[#1B1D22]">Resumen operativo</h2>
        <p className="mt-0.5 text-[13px] sm:text-sm text-[#5F6670] first-letter:uppercase">{fechaHoy}</p>
      </header>

      {/* SECCIÓN 1: KPI — bento B&M (v5.0). Datos y cálculos de v4.12 intactos. */}
      <section aria-label="Indicadores clave" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">

        {/* Estatus de flota — bloque rojo protagonista */}
        <Card className="col-span-2 lg:row-span-2 relative overflow-hidden bg-[#D42125] text-white border-0 rounded-[24px] shadow-none">
          <CardContent className="p-5 sm:p-6 h-full flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">Estatus de flota</p>
                <p className="mt-0.5 text-[13px] text-white/80">
                  {fleet.length === 0
                    ? 'Sin aeronaves registradas'
                    : `${operationalCount} de ${fleet.length} aeronaves operativas`}
                </p>
              </div>
              <span className="relative h-11 w-11 shrink-0 rounded-full bg-white/15 flex items-center justify-center">
                <Plane className="h-5 w-5 text-white" />
                {fleetHealth < 100 && (
                  <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-white ring-[3px] ring-[#D42125] motion-safe:animate-pulse" aria-hidden="true" />
                )}
              </span>
            </div>

            <div className="mt-auto pt-10 lg:pt-16">
              <p className="bm-figure text-[64px] sm:text-[84px] lg:text-[96px] xl:text-[112px] text-white">
                {fleetHealth.toFixed(1)}<span className="text-[0.42em] align-top ml-1">%</span>
              </p>
              <div
                className="mt-5 h-2 rounded-full bg-white/20 overflow-hidden"
                role="progressbar"
                aria-label="Disponibilidad de flota"
                aria-valuenow={Math.round(fleetHealth)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-white transition-[width] duration-1000 ease-out" style={{ width: `${fleetHealth}%` }}></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-white/90">
                <span>
                  {aogCount > 0
                    ? `${aogCount} ${aogCount === 1 ? 'aeronave' : 'aeronaves'} en tierra o en mantenimiento`
                    : fleet.length > 0 ? 'Ninguna aeronave en tierra' : 'Registre la flota para ver su estado'}
                </span>
                {fleet.length > 0 && fleetHealth < 50 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#A9161B]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Disponibilidad crítica
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Horas de vuelo */}
        <Card className="bg-white text-[#1B1D22] border border-[#E3E5E9] rounded-[20px] shadow-none">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[#5F6670]">
              <Clock className="h-4 w-4" />
              <p className="text-[13px] font-medium">Horas de vuelo</p>
            </div>
            <p className="bm-figure mt-4 text-[26px] min-[400px]:text-[30px] sm:text-[44px] text-[#1B1D22]">{totalFleetHours.toFixed(1)}</p>
            <p className="mt-1.5 text-xs text-[#5F6670]">Acumuladas por la flota</p>
          </CardContent>
        </Card>

        {/* Mantenimientos */}
        <Card className="bg-white text-[#1B1D22] border border-[#E3E5E9] rounded-[20px] shadow-none">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 text-[#5F6670]">
              <Wrench className="h-4 w-4" />
              <p className="text-[13px] font-medium">Mantenimientos</p>
            </div>
            <p className="bm-figure mt-4 text-[26px] min-[400px]:text-[30px] sm:text-[44px] text-[#1B1D22]">{pendingMaintenance}</p>
            <p className="mt-1.5 text-xs text-[#5F6670]">Órdenes abiertas en hangar</p>
          </CardContent>
        </Card>

        {/* Deuda capitanes — bloque grafito, abre la liquidación */}
        <Card
          onClick={openCaptains}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCaptains(); } }}
          role="button"
          tabIndex={0}
          aria-label="Ver desglose de deuda con capitanes"
          className="col-span-2 group cursor-pointer bg-[#1B1D22] text-white border-0 rounded-[20px] shadow-none hover:bg-[#25282F] transition-colors"
        >
          <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white/70">
                <UserCheck className="h-4 w-4" />
                <p className="text-[13px] font-medium">Deuda con capitanes</p>
              </div>
              <p className="bm-figure mt-3 text-[34px] sm:text-[40px] text-white truncate">${instructionDebt.toLocaleString()}</p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white/10 pl-3 pr-2 h-9 text-[13px] font-semibold text-white group-hover:bg-[#D42125] transition-colors">
              Ver desglose <ChevronRight className="h-4 w-4" />
            </span>
          </CardContent>
        </Card>
      </section>

      {/* SECCIÓN 2: ESTADO OPERATIVO + ACTIVIDAD CONTABLE (v5.0) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">

        {/* Estado operativo (antes: Centro de Comando Operativo) */}
        <section aria-labelledby="bm-ops-title" className="lg:col-span-2 bg-white border border-[#E3E5E9] rounded-[24px] p-5 sm:p-6 flex flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="bm-ops-title" className="bm-heading text-lg sm:text-xl text-[#1B1D22]">Estado operativo</h3>
              <p className="mt-0.5 text-[13px] text-[#5F6670]">Inventario, flota y proveedores</p>
            </div>
            <span className="h-10 w-10 shrink-0 rounded-xl bg-[#FCEBEC] text-[#D42125] flex items-center justify-center">
              <Zap className="h-5 w-5" />
            </span>
          </div>

          {/* Móvil: filas etiqueta / cifra. md+: tres columnas; en lg crecen hasta la altura del panel contable. */}
          <dl className="mt-5 lg:flex-1 rounded-2xl border border-[#E3E5E9] divide-y divide-[#E3E5E9] md:divide-y-0 md:divide-x md:grid md:grid-cols-3">
            {/* Stock mínimo */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 md:flex-col md:items-start md:justify-between md:px-5 md:py-5">
              <dt className="flex items-center gap-2.5 text-sm text-[#5F6670]">
                <Package className="h-4 w-4 shrink-0" /> Alertas de stock mínimo
              </dt>
              <dd className="md:mt-6">
                <span className="flex items-baseline gap-1.5">
                  <span className={`bm-figure text-[28px] md:text-[36px] lg:text-[48px] ${criticalStock > 0 ? 'text-[#D42125]' : 'text-[#18794E]'}`}>{criticalStock}</span>
                  <span className="text-xs text-[#5F6670]">ítems</span>
                </span>
                <span className="hidden md:block mt-2 text-[13px] text-[#5F6670]">
                  {criticalStock > 0 ? 'En o por debajo del mínimo' : 'Inventario en niveles'}
                </span>
              </dd>
            </div>

            {/* Aeronaves no operativas */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 md:flex-col md:items-start md:justify-between md:px-5 md:py-5">
              <dt className="flex items-center gap-2.5 text-sm text-[#5F6670]">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Aeronaves no operativas
              </dt>
              <dd className="md:mt-6 min-w-0">
                <span className="flex items-baseline gap-1.5">
                  {aogCount > 0 && <span className="h-2 w-2 rounded-full bg-[#D42125] self-center motion-safe:animate-pulse" aria-hidden="true" />}
                  <span className={`bm-figure text-[28px] md:text-[36px] lg:text-[48px] ${aogCount > 0 ? 'text-[#D42125]' : 'text-[#18794E]'}`}>{aogCount}</span>
                  <span className="text-xs text-[#5F6670]">unidades</span>
                </span>
                <span className="hidden md:block mt-2 text-[13px] text-[#5F6670] truncate" title={aogTails}>
                  {aogCount > 0 ? (aogTails || 'Sin matrícula registrada') : 'Toda la flota disponible'}
                </span>
              </dd>
            </div>

            {/* Proveedores activos */}
            <div className="flex items-center justify-between gap-4 px-4 py-3.5 md:flex-col md:items-start md:justify-between md:px-5 md:py-5">
              <dt className="flex items-center gap-2.5 text-sm text-[#5F6670]">
                <ShieldCheck className="h-4 w-4 shrink-0" /> Proveedores activos
              </dt>
              <dd className="md:mt-6">
                <span className="flex items-baseline gap-1.5">
                  <span className="bm-figure text-[28px] md:text-[36px] lg:text-[48px] text-[#1B1D22]">{vendors.length}</span>
                  <span className="text-xs text-[#5F6670]">aliados</span>
                </span>
                <span className="hidden md:block mt-2 text-[13px] text-[#5F6670]">Registrados en el sistema</span>
              </dd>
            </div>
          </dl>

          <div className="mt-5 lg:mt-auto lg:pt-5">
            <button
              type="button"
              onClick={() => { setActiveQuickView('menu'); setIsQuickActionOpen(true); }}
              className="w-full h-12 sm:h-14 rounded-xl sm:rounded-2xl bg-[#D42125] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2.5 hover:bg-[#A9161B] active:scale-[0.99] transition"
            >
              <PlusCircle className="h-5 w-5" /> Registro rápido
            </button>
          </div>
        </section>

        {/* [v4.13] PANEL ACTIVIDAD CONTABLE: maneja los 3 estados (syncing / error / data) — [v5.0] + vacío y sin acceso */}
        <section aria-labelledby="bm-ledger-title" className="bg-white border border-[#E3E5E9] rounded-[24px] p-5 sm:p-6 flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id="bm-ledger-title" className="bm-heading text-lg sm:text-xl text-[#1B1D22]">Actividad contable</h3>
              <p className="mt-0.5 text-[13px] text-[#5F6670]">Últimos movimientos</p>
            </div>
            {/* [v4.13] Badge de estado de sincronización */}
            {isSyncing && (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#F2F3F5] px-2.5 h-7 text-xs font-medium text-[#5F6670]" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sincronizando
              </span>
            )}
          </div>

          <div className="mt-3 flex-1">
            {/* Estado: sincronizando por primera vez */}
            {isSyncing && recentTransactions.length === 0 && (
              <ActivitySkeleton />
            )}

            {/* [v4.13] Estado: error de red con UI de reintento */}
            {!isSyncing && networkError && recentTransactions.length === 0 && (
              <NetworkErrorBanner />
            )}

            {/* [v5.0] Estado: rol sin acceso a finanzas */}
            {!hasFinanceAccess && (
              <EmptyState
                icon={<Lock className="h-5 w-5" />}
                title="Acceso restringido"
                text="La actividad contable solo es visible para administración y dirección."
              />
            )}

            {/* [v5.0] Estado: sincronizado sin movimientos */}
            {hasFinanceAccess && !isSyncing && !networkError && recentTransactions.length === 0 && (
              <EmptyState
                icon={<Activity className="h-5 w-5" />}
                title="Sin movimientos recientes"
                text="Los pagos y cargos registrados en el libro mayor aparecerán aquí."
              />
            )}

            {/* Estado: datos disponibles (con o sin error posterior) */}
            {recentTransactions.length > 0 && (
              <ul className="divide-y divide-[#E3E5E9]">
                {recentTransactions.slice(0, 5).map((tx: any) => (
                  <li key={tx.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1B1D22] truncate">{tx.entity_name}</p>
                      <p className="mt-0.5 text-xs text-[#5F6670] truncate">{tx.category || 'Sin categoría'}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <p className="bm-num text-sm font-semibold text-[#1B1D22]">${Number(tx.amount).toLocaleString()}</p>
                      <StatusPill paid={tx.status === 'PAID'} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {hasFinanceAccess && (
            <button
              type="button"
              onClick={() => onNavigate('finance')}
              className="mt-4 w-full h-11 rounded-xl border border-[#E3E5E9] text-sm font-semibold text-[#1B1D22] hover:border-[#D42125] hover:text-[#D42125] transition-colors"
            >
              Abrir libro mayor
            </button>
          )}
        </section>
      </div>

      {/* HOJA DE ACCIONES RÁPIDAS (v5.0: bottom sheet móvil / diálogo md+). Vistas y acciones de v4.12 intactas. */}
      {isQuickActionOpen && (
        <div className="bm-app fixed inset-0 z-[200] flex items-end md:items-center justify-center md:p-6">
          <div
            className="bm-backdrop absolute inset-0 bg-[#1B1D22]/50 backdrop-blur-[2px]"
            onClick={() => setIsQuickActionOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bm-quick-title"
            className="bm-sheet relative w-full md:max-w-2xl max-h-[92dvh] flex flex-col bg-white rounded-t-[28px] md:rounded-[28px] shadow-[0_-8px_40px_rgba(27,29,34,0.18)] md:shadow-[0_24px_64px_-12px_rgba(27,29,34,0.35)]"
          >
            {/* Asa de arrastre (indicador visual en móvil) */}
            <div className="md:hidden flex justify-center pt-2.5" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-full bg-[#E3E5E9]" />
            </div>

            <div className="flex items-center gap-3 px-5 sm:px-7 pt-3 md:pt-6 pb-4 border-b border-[#E3E5E9]">
              {activeQuickView === 'logbook' && (
                <button
                  type="button"
                  onClick={() => setActiveQuickView('menu')}
                  aria-label="Volver a registro rápido"
                  className="h-10 w-10 shrink-0 rounded-full bg-[#F2F3F5] text-[#1B1D22] flex items-center justify-center hover:bg-[#E3E5E9] transition-colors"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <h3 id="bm-quick-title" className="bm-heading text-lg sm:text-xl text-[#1B1D22] truncate">{quickTitle}</h3>
                <p className="text-[13px] text-[#5F6670] truncate">{quickSubtitle}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsQuickActionOpen(false)}
                aria-label="Cerrar"
                className="h-10 w-10 shrink-0 rounded-full bg-[#F2F3F5] text-[#1B1D22] flex items-center justify-center hover:bg-[#FCEBEC] hover:text-[#D42125] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain px-5 sm:px-7 pt-5 sm:pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
               {activeQuickView === 'capitanes' ? (
                <div key="capitanes" className="bm-view space-y-4">
                  <div className="rounded-2xl bg-[#1B1D22] text-white p-5 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[13px] text-white/70">Total pendiente</p>
                      <p className="bm-figure mt-2 text-[36px] sm:text-[44px] truncate">${instructionDebt.toLocaleString()}</p>
                    </div>
                    <UserCheck className="h-6 w-6 text-white/60 shrink-0" />
                  </div>

                  {captainDebts.length > 0 ? (
                    <ul className="rounded-2xl border border-[#E3E5E9] divide-y divide-[#E3E5E9]">
                      {captainDebts.map((c, i) => (
                        <li key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
                          <div className="min-w-0">
                            <p className="text-xs text-[#5F6670]">Capitán o instructor</p>
                            <p className="text-[15px] font-semibold text-[#1B1D22] truncate">{c.nombre}</p>
                          </div>
                          <p className="bm-num shrink-0 text-base font-bold text-[#D42125]">${c.monto.toLocaleString()}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      icon={<CheckCircle2 className="h-5 w-5 text-[#18794E]" />}
                      title="Sin liquidaciones pendientes"
                      text="No hay pagos de nómina ni de instrucción por liquidar."
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => onNavigate('finance')}
                    className="w-full h-12 rounded-xl bg-[#D42125] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#A9161B] active:scale-[0.99] transition"
                  >
                    <DollarSign className="h-4 w-4" /> Abrir módulo contable
                  </button>
                </div>
              ) : activeQuickView === 'menu' ? (
                <div key="menu" className="bm-view grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setActiveQuickView('logbook')}
                    className="group flex md:flex-col items-center md:items-start gap-4 p-4 md:p-5 rounded-2xl border border-[#E3E5E9] bg-white text-left hover:border-[#D42125] transition-colors"
                  >
                    <span className="h-12 w-12 shrink-0 rounded-xl bg-[#D42125] text-white flex items-center justify-center"><Clock className="h-6 w-6" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[#1B1D22]">Cierre de vuelo</span>
                      <span className="block mt-0.5 text-[13px] leading-snug text-[#5F6670]">Registrar horas Tach de una aeronave</span>
                    </span>
                    <ChevronRight className="md:hidden h-5 w-5 text-[#9AA0A8] group-hover:text-[#D42125]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { onNavigate('control-hub'); setIsQuickActionOpen(false); }}
                    className="group flex md:flex-col items-center md:items-start gap-4 p-4 md:p-5 rounded-2xl border border-[#E3E5E9] bg-white text-left hover:border-[#D42125] transition-colors"
                  >
                    <span className="h-12 w-12 shrink-0 rounded-xl bg-[#F2F3F5] text-[#1B1D22] flex items-center justify-center"><Wrench className="h-6 w-6" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[#1B1D22]">Orden de hangar</span>
                      <span className="block mt-0.5 text-[13px] leading-snug text-[#5F6670]">Abrir una orden de trabajo</span>
                    </span>
                    <ChevronRight className="md:hidden h-5 w-5 text-[#9AA0A8] group-hover:text-[#D42125]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { onNavigate('checkout'); setIsQuickActionOpen(false); }}
                    className="group flex md:flex-col items-center md:items-start gap-4 p-4 md:p-5 rounded-2xl border border-[#E3E5E9] bg-white text-left hover:border-[#D42125] transition-colors"
                  >
                    <span className="h-12 w-12 shrink-0 rounded-xl bg-[#F2F3F5] text-[#1B1D22] flex items-center justify-center"><Package className="h-6 w-6" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[#1B1D22]">Despacho P/N</span>
                      <span className="block mt-0.5 text-[13px] leading-snug text-[#5F6670]">Entregar partes del almacén</span>
                    </span>
                    <ChevronRight className="md:hidden h-5 w-5 text-[#9AA0A8] group-hover:text-[#D42125]" />
                  </button>
                </div>
              ) : (
                <form key="logbook" onSubmit={handleLogFlight} className="bm-view space-y-5">
                  <div>
                    <label htmlFor="bm-aircraft" className="text-sm font-medium text-[#1B1D22]">Aeronave</label>
                    <div className="relative mt-1.5">
                      <select
                        id="bm-aircraft"
                        required
                        className="w-full h-12 appearance-none rounded-xl border border-[#D9DCE1] bg-white pl-4 pr-11 text-base text-[#1B1D22] outline-none transition-[border-color,box-shadow] focus:border-[#D42125] focus:ring-4 focus:ring-[#D42125]/10"
                        value={logData.aircraftId}
                        onChange={e => setLogData({...logData, aircraftId: e.target.value})}
                      >
                        <option value="">Seleccione una aeronave</option>
                        {fleet.map((ac: any) => (<option key={ac.id} value={ac.tailNumber}>{ac.tailNumber}</option>))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5F6670]" />
                    </div>
                  </div>

                  {/* [v5.0 FIX] Contadores Tach — antes ausentes, tachDiff quedaba en 0 */}
                  <div className="grid grid-cols-2 gap-3">
                    <CounterField
                      id="bm-tach-start"
                      label="Tach inicial"
                      value={logData.tachStart}
                      onChange={v => setLogData({...logData, tachStart: v})}
                    />
                    <CounterField
                      id="bm-tach-end"
                      label="Tach final"
                      value={logData.tachEnd}
                      onChange={v => setLogData({...logData, tachEnd: v})}
                    />
                  </div>

                  <div className="rounded-2xl bg-[#F2F3F5] p-4 sm:p-5 flex items-center justify-between gap-4" aria-live="polite">
                    <div>
                      <p className="text-sm font-semibold text-[#1B1D22]">Ciclo Tach</p>
                      <p className="mt-0.5 text-xs text-[#5F6670]">
                        {tachCycle < 0 ? 'El Tach final debe ser mayor que el inicial' : 'Tach final menos Tach inicial'}
                      </p>
                    </div>
                    <p className={`bm-figure text-[36px] sm:text-[44px] ${tachCycle < 0 ? 'text-[#D42125]' : 'text-[#1B1D22]'}`}>
                      {tachCycle.toFixed(1)}<span className="ml-1 text-[0.45em]">h</span>
                    </p>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                    <button type="button" onClick={() => setActiveQuickView('menu')} className="h-12 sm:flex-1 rounded-xl border border-[#E3E5E9] bg-white text-[15px] font-semibold text-[#1B1D22] hover:bg-[#F2F3F5] transition-colors">Cancelar</button>
                    <button type="submit" className="h-12 sm:flex-[2] rounded-xl bg-[#D42125] text-white text-[15px] font-semibold hover:bg-[#A9161B] active:scale-[0.99] transition">Certificar registro</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

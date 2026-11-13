// src/components/StatusBar.tsx
// NÚCLEO DE IDENTIDAD VISUAL — B&M MANTENIMIENTO AERONÁUTICO v3.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v3.0 — REBRAND B&M + CONEXIONES:
//   [FIX] Identidad y rol desde AuthContext (mismo origen que Index y App:
//         roles_operativos > app_metadata). Antes se leían de `perfiles` y de
//         user_metadata (editable por el usuario), así que la barra podía mostrar
//         un rol distinto al que realmente autoriza los módulos.
//   [FIX] "Alta de personal" visible solo si Index entrega onOpenRegister
//         (CEO, ADMIN, DIRECTOR). Antes se mostraba únicamente al CEO, por lo
//         que ADMIN y DIRECTOR no tenían forma de abrir el alta que Index sí les
//         permite.
//   [FIX] Cerrar sesión usa AuthContext.signOut (con respaldo local sin red),
//         igual que el menú lateral. Antes llamaba supabase.auth.signOut directo.
//   [UI]  Barra B&M clara de 40 px: conexión, sede, alta de personal, hora,
//         ficha de usuario (solo tablet; en escritorio está en la barra lateral
//         y en móvil en el menú) y cerrar sesión. Se retiran el logo duplicado y
//         los textos decorativos (OS v4.17, Sist_Live, AES-256 Protocol).
// PRESERVADO: detección online/offline con listeners, reloj de 1 s con formato
//   es-VE, limpieza de listeners e intervalo, prop onOpenRegister, export default.
// HISTORIAL: v2.1 .maybeSingle() en perfiles (reemplazado por AuthContext en v3.0).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  Wifi, WifiOff, Shield, Clock,
  MapPin, User, LogOut, UserPlus,
} from 'lucide-react';

const StatusBar = ({ onOpenRegister }: { onOpenRegister?: () => void }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentTime, setCurrentTime] = useState(new Date());
  const navigate = useNavigate();
  const { role, profile, signOut } = useAuth();

  // [v3.0] Identidad desde AuthContext (sin consulta propia a `perfiles`)
  const nombre = profile?.nombre_completo || 'Operador';
  const sede = profile?.sede || '';
  const isCEO = role === 'CEO';

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
    };
  }, []);

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <header className="bm-app relative z-[60] flex h-10 shrink-0 items-center justify-between gap-3 border-b border-bm-line bg-white px-4 text-[13px] text-bm-ink sm:px-6 lg:px-8">

      {/* IZQUIERDA: conexión y sede */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          role="status"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            isOnline ? 'bg-bm-ok-tint text-bm-ok' : 'bg-bm-red-tint text-bm-red-deep'
          }`}
        >
          {isOnline
            ? <Wifi className="h-3.5 w-3.5" />
            : <WifiOff className="h-3.5 w-3.5 motion-safe:animate-pulse" />}
          {isOnline ? 'En línea' : 'Sin conexión'}
        </span>
        {sede && (
          <span className="hidden min-w-0 items-center gap-1 truncate text-bm-steel sm:inline-flex">
            <MapPin className="h-3.5 w-3.5 shrink-0" /> Sede {sede}
          </span>
        )}
      </div>

      {/* DERECHA: alta, hora, usuario, cierre */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">

        {/* Alta de personal: Index la entrega solo a CEO, ADMIN y DIRECTOR */}
        {onOpenRegister && (
          <button
            type="button"
            onClick={onOpenRegister}
            title="Alta de personal"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-bm-line px-2.5 text-[13px] font-semibold text-bm-ink transition-colors hover:border-bm-red hover:text-bm-red"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Alta de personal</span>
          </button>
        )}

        <span className="bm-num hidden items-center gap-1.5 text-bm-steel md:inline-flex">
          <Clock className="h-3.5 w-3.5" />
          {currentTime.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Ficha de usuario: solo tablet (escritorio la muestra en la barra lateral) */}
        <span className="hidden items-center gap-2 border-l border-bm-line pl-3 md:flex lg:hidden">
          <span className="max-w-[160px] truncate font-medium">{nombre}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            isCEO ? 'bg-bm-red text-white' : 'bg-bm-canvas text-bm-steel'
          }`}>
            {isCEO ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
            {role ?? 'Sin rol'}
          </span>
        </span>

        <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-bm-steel transition-colors hover:bg-bm-red-tint hover:text-bm-red"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};

export default StatusBar;

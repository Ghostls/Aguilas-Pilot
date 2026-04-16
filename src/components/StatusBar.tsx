// src/components/StatusBar.tsx
// NÚCLEO DE IDENTIDAD VISUAL - ÁGUILAS PILOT
// Evolución: Integración de Isologotipo y Control de Alta de Personal (Solo CEO)
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useNavigate } from 'react-router-dom';
import { 
  Wifi, WifiOff, Shield, Clock, 
  MapPin, User, LogOut, Activity, UserPlus 
} from 'lucide-react';

// Añadimos la prop onOpenRegister para disparar el modal desde Index.tsx
const StatusBar = ({ onOpenRegister }: { onOpenRegister?: () => void }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [profile, setProfile] = useState<{nombre_completo: string, rol: string, sede: string} | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserIdentity = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('perfiles')
          .select('nombre_completo, rol, sede')
          .eq('id', user.id)
          .single();
        if (data) setProfile(data);
      }
    };

    fetchUserIdentity();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timer);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header className="status-bar flex items-center justify-between px-6 py-2 bg-black/40 backdrop-blur-md border-b border-white/5 text-sm font-medium z-[100] font-mono">
      
      {/* SECCIÓN IZQUIERDA: IDENTIDAD CORPORATIVA ÁGUILAS PILOT */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <img 
            src="/logoblanco.png" 
            alt="Águilas Pilot" 
            className="h-7 w-auto object-contain drop-shadow-[0_0_8px_rgba(255,255,255,0.15)]"
          />
          <span className="hidden sm:block text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.4em] border-l border-white/10 pl-3">
            OS v4.12
          </span>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[9px] text-slate-500 font-bold uppercase tracking-widest border-l border-white/10 pl-4">
          <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> Sist_Live</span>
          <span className="text-white/20">|</span>
          <span className="text-[#E1AD01]">AES-256 Protocol</span>
        </div>
      </div>

      {/* SECCIÓN CENTRAL: FICHA DE USUARIO */}
      <div className="flex items-center gap-4">
        {profile ? (
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 pl-4 pr-1 py-1 rounded-full group hover:border-[#E1AD01]/50 transition-all">
            <div className="text-right hidden sm:block">
              <p className="text-[9px] font-black text-white leading-none uppercase tracking-tighter">
                {profile.nombre_completo}
              </p>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <MapPin className="h-2 w-2 text-[#E1AD01]" />
                <span className="text-[7px] font-bold text-[#E1AD01] uppercase tracking-widest">{profile.sede}</span>
              </div>
            </div>
            
            <div className={`px-3 py-1.5 rounded-full flex items-center gap-2 ${
              profile.rol === 'CEO' ? 'bg-[#E1AD01] text-black shadow-[0_0_15px_rgba(225,173,1,0.3)]' : 'bg-white/10 text-white'
            }`}>
              {profile.rol === 'CEO' ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
              <span className="text-[8px] font-black uppercase tracking-[0.2em]">{profile.rol}</span>
            </div>
          </div>
        ) : (
          <div className="h-8 w-32 bg-white/5 animate-pulse rounded-full border border-white/5"></div>
        )}
      </div>

      {/* SECCIÓN DERECHA: STATUS, REGISTRO Y CIERRE */}
      <div className="flex items-center gap-5">
        
        {/* PRIVILEGIO NIVEL CEO: ALTA DE PERSONAL */}
        {profile?.rol === 'CEO' && (
          <button 
            onClick={onOpenRegister}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#E1AD01]/10 text-[#E1AD01] border border-[#E1AD01]/20 hover:bg-[#E1AD01] hover:text-black rounded-lg transition-all text-[9px] font-black uppercase tracking-widest"
            title="Alta de Operadores"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Alta de Personal</span>
          </button>
        )}

        <div className="hidden md:flex items-center gap-2 text-xs">
          <Clock className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-white/70">
            {currentTime.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>

        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest transition-all ${
          isOnline 
            ? 'bg-green-500/10 text-green-500 border border-green-500/20' 
            : 'bg-red-500/10 text-red-500 border border-red-500/20'
        }`}>
          {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3 animate-pulse" />}
          <span className="hidden xs:inline">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </div>

        <button 
          onClick={handleLogout}
          className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-all"
          title="Cerrar Terminal"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};

export default StatusBar;
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Mail, Lock, User, Loader2, AlertCircle, ChevronLeft } from 'lucide-react';

const Login = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('MECANICO');
  const [sede, setSede] = useState('Lara'); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              nombre_completo: nombre.toUpperCase(),
              rol: rol,
              sede: sede 
            }
          }
        });

        if (authError) throw authError;

        if (data?.user) {
          alert("REGISTRO EXITOSO. Operador asignado a la sede: " + sede.toUpperCase());
          setIsRegistering(false);
        }
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) throw authError;

        // EVOLUCIÓN: Verificación de Rol en Metadata para asegurar redirección correcta
        const userRole = data.user?.user_metadata?.rol;
        console.log(`SISTEMA: Acceso verificado para Rango: ${userRole || 'NO DEFINIDO'}`);
        
        navigate('/');
      }
    } catch (err: any) {
      console.error("DEBUG ÁGUILAS PILOT:", err);
      if (err.message.includes("User already registered")) {
        setError("EL USUARIO YA EXISTE EN EL SISTEMA");
      } else if (err.message.includes("credentials")) {
        setError("ACCESO DENEGADO: CREDENCIALES INVÁLIDAS");
      } else {
        setError(err.message.toUpperCase());
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#020202] overflow-hidden font-sans relative">
      {/* Iluminación Estructural Valkyron */}
      <div className="absolute w-[600px] h-[600px] bg-[#E1AD01]/10 rounded-full blur-[120px] -top-40 -left-40" />
      <div className="absolute w-[600px] h-[600px] bg-[#E1AD01]/5 rounded-full blur-[120px] -bottom-40 -right-40" />

      <div className="relative z-10 bg-white/5 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/10 w-full max-w-md shadow-2xl transition-all duration-500">
        
        {/* EVOLUCIÓN: Identidad Visual Águilas Pilot */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-6 drop-shadow-[0_0_15px_rgba(225,173,1,0.3)]">
            <img 
              src="/logo.png" 
              alt="Águilas Pilot Logo" 
              className="w-48 h-auto object-contain"
            />
          </div>
          <h1 className="text-white text-3xl font-black tracking-tighter uppercase italic text-center leading-none">
            {isRegistering ? 'Alta de Personal' : 'Inicio de Sesión'}
          </h1>
          <p className="text-slate-500 text-[9px] mt-3 font-mono uppercase tracking-[0.4em] text-center">
            {isRegistering ? 'Sincronizando Nodo Operativo' : 'Sistema de Inventario & MRO'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top duration-300">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-[10px] text-red-500 font-black uppercase leading-tight tracking-widest">{error}</p>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {isRegistering && (
            <div className="space-y-4 animate-in fade-in duration-500">
              <div className="space-y-1">
                <label className="text-[8px] text-slate-500 font-black uppercase ml-2 tracking-widest">Nombre del Operador</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                  <input 
                    type="text" placeholder="NOMBRE COMPLETO" required
                    className="w-full p-4 pl-12 rounded-2xl bg-black/50 text-white border border-white/5 focus:border-[#E1AD01] outline-none text-xs uppercase transition-all"
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] text-slate-500 font-black uppercase ml-2 tracking-widest">Rango</label>
                  <select 
                    className="w-full p-4 rounded-2xl bg-black/50 text-[#E1AD01] border border-white/5 outline-none text-[10px] font-black uppercase cursor-pointer"
                    onChange={(e) => setRol(e.target.value)}
                    value={rol}
                  >
                    <option value="MECANICO">MECÁNICO</option>
                    <option value="CAPITAN">CAPITÁN</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="CEO">CEO</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] text-slate-500 font-black uppercase ml-2 tracking-widest">Sede</label>
                  <select 
                    className="w-full p-4 rounded-2xl bg-black/50 text-[#E1AD01] border border-white/5 outline-none text-[10px] font-black uppercase cursor-pointer"
                    onChange={(e) => setSede(e.target.value)}
                    value={sede}
                  >
                    <option value="Lara">LARA</option>
                    <option value="Maturin">MATURÍN</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[8px] text-slate-500 font-black uppercase ml-2 tracking-widest">ID Corporativo</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input 
                type="email" placeholder="EMAIL" required
                className="w-full p-4 pl-12 rounded-2xl bg-black/50 text-white border border-white/5 focus:border-[#E1AD01] outline-none text-xs transition-all"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] text-slate-500 font-black uppercase ml-2 tracking-widest">Encriptación</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input 
                type="password" placeholder="••••••••" required
                className="w-full p-4 pl-12 rounded-2xl bg-black/50 text-[#E1AD01] border border-white/5 focus:border-[#E1AD01] outline-none text-xs transition-all"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full py-5 bg-[#E1AD01] text-black rounded-2xl font-black uppercase text-[10px] tracking-[0.4em] shadow-xl shadow-[#E1AD01]/10 transition-all active:scale-95 hover:bg-white flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (isRegistering ? 'Confirmar Alta' : 'Inicializar Sistema')}
          </button>
        </form>

        <button 
          onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
          className="w-full mt-8 text-[9px] text-slate-600 font-black uppercase tracking-[0.3em] hover:text-[#E1AD01] transition-colors flex items-center justify-center gap-2 group"
        >
          {isRegistering ? <><ChevronLeft className="h-3 w-3 transition-transform group-hover:-translate-x-1" /> Volver al Login</> : '¿Registrar Nuevo Operador?'}
        </button>
      </div>

      <p className="absolute bottom-10 text-[8px] text-slate-700 font-mono uppercase tracking-[0.5em]">
        Valkyron Group Deployment — Barquisimeto Hub
      </p>
    </div>
  );
};

export default Login;
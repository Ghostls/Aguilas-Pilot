// src/components/auth/Register.tsx
// VALKYRON OS v2.1 — Alta de Personal Águilas Pilot
// FIX CRÍTICO: Inserción directa en tabla `perfiles` post-signUp
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  ShieldCheck, UserPlus, Loader2, X,
  Wrench, Shield, Plane, Landmark, CheckCircle2, AlertTriangle
} from 'lucide-react';

type Rol  = 'CEO' | 'ADMIN' | 'MECANICO' | 'PILOTO';
type Sede = 'Lara' | 'Maturín';

const ROLES: { id: Rol; label: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'MECANICO', label: 'Técnico MRO',    desc: 'Hangar & Stock',      icon: Wrench   },
  { id: 'PILOTO',   label: 'Piloto',          desc: 'Vuelos & AVGAS',     icon: Plane    },
  { id: 'ADMIN',    label: 'Administrador',   desc: 'Finanzas & Almacén', icon: Landmark },
  { id: 'CEO',      label: 'CEO',             desc: 'Control Total',      icon: Shield   },
];

const INPUT_CLS = `w-full bg-black/60 border border-white/10 p-4 rounded-2xl text-white text-xs
  outline-none focus:border-[#E1AD01] focus:bg-black transition-all placeholder:text-white/20
  font-mono uppercase tracking-wide`;

export const Register = ({ onClose }: { onClose: () => void }) => {
  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error, setError]       = useState('');
  const [formData, setFormData] = useState({
    email:    '',
    password: '',
    nombre:   '',
    rol:      'MECANICO' as Rol,
    sede:     'Lara' as Sede,
  });

  const set = (key: keyof typeof formData, val: string) =>
    setFormData(prev => ({ ...prev, [key]: val }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // ── PASO 1: Crear usuario en Supabase Auth con metadata ─────────────────
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email:    formData.email,
      password: formData.password,
      options: {
        data: {
          nombre_completo: formData.nombre.toUpperCase(),
          rol:             formData.rol,        // ← guardado en user_metadata
          sede:            formData.sede,
        },
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // ── PASO 2: Insertar en tabla `perfiles` con el rol correcto ────────────
    // CRÍTICO: user_metadata puede no estar disponible en el primer login
    // La tabla `perfiles` es la fuente de verdad para el rol
    const userId = authData.user?.id;
    if (userId) {
      const { error: profileError } = await supabase
        .from('perfiles')
        .upsert({
          id:              userId,
          nombre_completo: formData.nombre.toUpperCase(),
          rol:             formData.rol,   // ← fuente de verdad
          sede:            formData.sede,
          email:           formData.email.toLowerCase(),
        }, { onConflict: 'id' });

      if (profileError) {
        // No bloqueamos el flujo — el usuario se creó, solo logueamos el error
        console.error('[REGISTER] Error insertando perfil:', profileError.message);
        // Avisamos pero no falla el registro completo
        setError(`Usuario creado pero hubo un error guardando el perfil: ${profileError.message}`);
        setLoading(false);
        return;
      }
    }

    setSuccess(true);
    setTimeout(() => onClose(), 2200);
    setLoading(false);
  };

  // ── PANTALLA DE ÉXITO ─────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex items-center justify-center p-4">
        <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-sm rounded-[2rem]
                        overflow-hidden shadow-[0_0_80px_rgba(225,173,1,0.2)]
                        animate-in zoom-in-95 duration-300 text-center p-12 space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#E1AD01] flex items-center justify-center mx-auto
                          shadow-[0_0_40px_rgba(225,173,1,0.4)]">
            <CheckCircle2 className="h-8 w-8 text-black" />
          </div>
          <div>
            <p className="text-white font-black text-sm uppercase tracking-widest">Despliegue Exitoso</p>
            <p className="text-[#E1AD01] font-mono text-[10px] mt-2 uppercase tracking-[0.3em]">
              {formData.nombre} · {formData.rol}
            </p>
          </div>
          <p className="text-zinc-600 text-[9px] font-mono uppercase tracking-widest">
            Redirigiendo...
          </p>
        </div>
      </div>
    );
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 w-full max-w-xl rounded-[2.5rem]
                      overflow-hidden shadow-[0_0_100px_rgba(225,173,1,0.12)]
                      animate-in zoom-in-95 duration-300">

        {/* HEADER */}
        <div className="p-6 bg-[#E1AD01] flex justify-between items-center text-black">
          <div className="flex items-center gap-3">
            <UserPlus className="h-5 w-5" />
            <div>
              <h3 className="font-black uppercase text-[10px] tracking-[0.3em] italic leading-none">
                Alta de Personal
              </h3>
              <p className="text-[8px] font-bold opacity-60 uppercase tracking-widest mt-0.5">
                Águilas Pilot · Valkyron OS
              </p>
            </div>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-transform duration-300
                                               w-8 h-8 flex items-center justify-center">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleRegister} className="p-8 space-y-7 font-mono">

          {/* ERROR */}
          {error && (
            <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-400 uppercase leading-relaxed">{error}</p>
            </div>
          )}

          {/* SELECTOR DE RANGO */}
          <div className="space-y-3">
            <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.25em] block">
              Rango de Autoridad
            </label>
            <div className="grid grid-cols-4 gap-2">
              {ROLES.map(rol => {
                const Icon   = rol.icon;
                const active = formData.rol === rol.id;
                return (
                  <button key={rol.id} type="button"
                    onClick={() => set('rol', rol.id)}
                    className={`relative p-4 rounded-2xl border transition-all flex flex-col items-center
                                gap-2.5 group overflow-hidden
                                ${active
                                  ? 'bg-[#E1AD01] border-[#E1AD01] text-black shadow-[0_0_30px_rgba(225,173,1,0.25)]'
                                  : 'bg-white/[0.03] border-white/[0.06] text-slate-500 hover:border-white/10 hover:bg-white/[0.06]'
                                }`}>
                    {active && (
                      <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
                    )}
                    <Icon className={`h-5 w-5 relative z-10 ${active ? 'text-black' : 'group-hover:text-[#E1AD01] transition-colors'}`} />
                    <div className="text-center relative z-10">
                      <p className={`text-[9px] font-black uppercase leading-none ${active ? 'text-black' : ''}`}>
                        {rol.label}
                      </p>
                      <p className={`text-[7px] mt-1 font-bold leading-tight ${active ? 'text-black/60' : 'text-slate-600'}`}>
                        {rol.desc}
                      </p>
                    </div>
                    {active && (
                      <CheckCircle2 className="absolute top-2 right-2 h-3 w-3 text-black/40" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* IDENTIDAD + SEDE */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                Nombre Completo *
              </label>
              <input required className={INPUT_CLS}
                placeholder="NOMBRE DEL OPERADOR"
                value={formData.nombre}
                onChange={e => set('nombre', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                Sede Asignada
              </label>
              <div className="flex bg-black/60 rounded-2xl p-1 border border-white/10 h-[52px]">
                {(['Lara', 'Maturín'] as Sede[]).map(loc => (
                  <button key={loc} type="button"
                    onClick={() => set('sede', loc)}
                    className={`flex-1 rounded-xl text-[10px] font-black uppercase transition-all
                                ${formData.sede === loc
                                  ? 'bg-[#E1AD01]/15 text-[#E1AD01] border border-[#E1AD01]/30'
                                  : 'text-slate-600 hover:text-slate-400'}`}>
                    {loc}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CREDENCIALES */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                Email Corporativo *
              </label>
              <input type="email" required className={INPUT_CLS}
                placeholder="ID@AGUILAS.COM"
                style={{ textTransform: 'none' }}
                value={formData.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                Clave de Acceso *
              </label>
              <input type="password" required minLength={6} className={INPUT_CLS}
                placeholder="••••••••"
                style={{ textTransform: 'none' }}
                value={formData.password}
                onChange={e => set('password', e.target.value)}
              />
            </div>
          </div>

          {/* RESUMEN TÁCTICO */}
          <div className="bg-white/[0.02] border border-white/[0.05] rounded-2xl p-4
                          flex items-center justify-between">
            <div>
              <p className="text-[8px] text-zinc-600 font-black uppercase tracking-widest mb-1">
                Perfil a crear
              </p>
              <p className="text-white font-black text-xs uppercase">
                {formData.nombre || '—'} · <span className="text-[#E1AD01]">{formData.rol}</span>
              </p>
              <p className="text-zinc-600 text-[9px] font-mono mt-0.5">
                BASE {formData.sede.toUpperCase()} · {formData.email || 'sin email'}
              </p>
            </div>
            <ShieldCheck className="h-8 w-8 text-[#E1AD01]/20" />
          </div>

          {/* SUBMIT */}
          <button type="submit" disabled={loading}
            className="w-full bg-[#E1AD01] text-black font-black py-5 rounded-2xl uppercase
                       text-[10px] tracking-[0.4em] shadow-xl hover:bg-white transition-all
                       flex items-center justify-center gap-3 disabled:opacity-40
                       hover:shadow-[0_0_40px_rgba(225,173,1,0.3)]">
            {loading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <><UserPlus className="h-4 w-4" /> Ejecutar Alta de Personal</>
            }
          </button>
        </form>

        <div className="border-t border-white/5 p-4 text-center">
          <p className="text-[7px] text-slate-700 font-black uppercase tracking-[0.4em]">
            Valkyron OS — Strategic Human Resources Module
          </p>
        </div>
      </div>
    </div>
  );
};
// src/components/auth/Register.tsx
// VALKYRON OS v3.1 — Alta de Personal Águilas Pilot
// FUSIÓN v2.3 + v3.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v3.1 (sobre v3.0):
//   [FIX] Usuario huérfano: si la cuenta se creaba pero la asignación de rol
//         fallaba, reintentar volvía a crear la cuenta ("ya registrado") y el
//         usuario quedaba sin rol. Ahora se recuerda el usuario creado y el botón
//         pasa a "Reintentar asignación de rol" (no se duplica la cuenta).
//   [FIX] El cierre automático tras el éxito se cancela al desmontar el modal.
//   [SEC] Bloqueo en cliente de ADMIN/CEO si quien opera no es CEO (el servidor
//         también lo rechaza en fn_asignar_rol_operativo).
//   [NEW] "Generar clave": clave temporal segura de 12 caracteres (crypto),
//         mostrar/ocultar y copiar. Mínimo 8 caracteres para cuentas nuevas.
//   [NEW] Cierre con Escape (bloqueado mientras el alta está en curso).
//
// CHANGELOG v3.0 (sobre v2.3):
//   [FIX CRÍTICO] signUp con el cliente principal podía REEMPLAZAR la sesión del
//         administrador por la del usuario creado → alta con cliente aislado.
//   [SEC] El rol se asigna en el servidor con fn_asignar_rol_operativo (SECURITY
//         DEFINER); user_metadata y `perfiles` ya no conceden permisos.
//   [NEW] Rol PLANIFICADOR; detección de correo ya registrado; límites de espera.
//   [CHG] Selector de rangos responsive (2/3 columnas) en lugar del grid inline
//         de 5 columnas de v2.3 (6 rangos, legible en móvil).
//
// PRESERVADO (v2.3): diseño, header, pantalla "Despliegue Exitoso", sedes
//   Lara / Maturín, resumen táctico, upsert en `perfiles` (compatibilidad de
//   presentación), pie "Strategic Human Resources Module", props { onClose }.
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { supabase, createIsolatedAuthClient } from '@/lib/supabaseClient';
import { authLog, classifyPostgrestError, promiseWithTimeout, shortId } from '@/lib/authRecovery';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck, UserPlus, Loader2, X,
  Wrench, Shield, Plane, Landmark, CheckCircle2, AlertTriangle,
  ClipboardList, CalendarCheck, Eye, EyeOff, KeyRound, Copy, RefreshCw,
} from 'lucide-react';

type Rol  = 'CEO' | 'ADMIN' | 'MECANICO' | 'OPERACIONES' | 'PILOTO' | 'PLANIFICADOR';
type Sede = 'Lara' | 'Maturín';

const ROLES: { id: Rol; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; soloCeo?: boolean }[] = [
  { id: 'MECANICO',     label: 'Técnico MRO',   desc: 'Hangar & Stock',         icon: Wrench        },
  { id: 'OPERACIONES',  label: 'Operaciones',   desc: 'Rutas & MRO',            icon: ClipboardList },
  { id: 'PILOTO',       label: 'Piloto',        desc: 'Vuelos & AVGAS',         icon: Plane         },
  { id: 'PLANIFICADOR', label: 'Planificador',  desc: 'Hangar consulta & Plan', icon: CalendarCheck },
  { id: 'ADMIN',        label: 'Administrador', desc: 'Finanzas & Almacén',     icon: Landmark, soloCeo: true },
  { id: 'CEO',          label: 'CEO',           desc: 'Control Total',          icon: Shield,   soloCeo: true },
];

const INPUT_CLS = `w-full bg-black/60 border border-white/10 p-4 rounded-2xl text-white text-xs
  outline-none focus:border-[#E1AD01] focus:bg-black transition-all placeholder:text-white/20
  font-mono uppercase tracking-wide`;

const SIGNUP_TIMEOUT_MS = 25000;
const RPC_TIMEOUT_MS = 15000;
const PASSWORD_MIN = 8;
const SUCCESS_CLOSE_MS = 2200;

/** Clave temporal: 12 caracteres sin ambiguos (0/O, 1/l/I), con mayúscula, minúscula, dígito y símbolo. */
const generateTempPassword = (): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%*?!';
  const all = upper + lower + digits + symbols;
  const rand = (n: number) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  };
  const pick = (set: string) => set[rand(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

export const Register = ({ onClose }: { onClose: () => void }) => {
  const { role: actorRole } = useAuth();
  const esCeo = actorRole === 'CEO';
  const rolesDisponibles = ROLES.filter(r => !r.soloCeo || esCeo);

  const [loading, setLoading]   = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error, setError]       = useState('');
  const [warning, setWarning]   = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied]     = useState(false);
  // [v3.1] Usuario ya creado cuya asignación de rol está pendiente.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    email:    '',
    password: '',
    nombre:   '',
    rol:      'MECANICO' as Rol,
    sede:     'Lara' as Sede,
  });

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (key: keyof typeof formData, val: string) => {
    // Cambiar el correo invalida el usuario pendiente (sería otra cuenta).
    if (key === 'email') setPendingUserId(null);
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  // [v3.1] Limpieza del cierre automático
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // [v3.1] Escape cierra (no durante el alta)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const handleGenerate = () => {
    set('password', generateTempPassword());
    setShowPassword(true);
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formData.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowPassword(true);
    }
  };

  /** Asigna el rol en el servidor. Devuelve avisos no fatales o lanza si es fatal. */
  const assignRole = async (userId: string, nombre: string): Promise<string[]> => {
    const avisos: string[] = [];
    const { error: rolError, status: rolStatus } = await promiseWithTimeout(
      supabase.rpc('fn_asignar_rol_operativo', {
        p_user_id: userId,
        p_rol:     formData.rol,
        p_nombre:  nombre,
        p_sede:    formData.sede,
      }),
      RPC_TIMEOUT_MS,
      'Asignación de rol',
    );

    if (rolError) {
      const cls = classifyPostgrestError(rolError, rolStatus);
      if (cls === 'ABSENT') {
        avisos.push('Usuario creado, pero falta la migración de roles (fn_asignar_rol_operativo). Quedará con ACCESO PENDIENTE hasta asignar su rol.');
      } else {
        throw new Error(`Usuario creado, pero no se pudo asignar el rol: ${rolError.message}`);
      }
    }
    return avisos;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setWarning('');

    const nombre = formData.nombre.trim().toUpperCase();
    const email = formData.email.trim().toLowerCase();

    try {
      // [v3.1] Defensa en cliente: el servidor también lo valida.
      if (ROLES.find(r => r.id === formData.rol)?.soloCeo && !esCeo) {
        setError('Solo el CEO puede asignar los rangos ADMIN y CEO.');
        return;
      }

      let userId = pendingUserId;

      // ── PASO 1: Crear usuario con cliente AISLADO (no toca la sesión actual) ──
      if (!userId) {
        if (formData.password.length < PASSWORD_MIN) {
          setError(`La clave debe tener al menos ${PASSWORD_MIN} caracteres.`);
          return;
        }

        const isolated = createIsolatedAuthClient();
        const { data: authData, error: authError } = await promiseWithTimeout(
          isolated.auth.signUp({
            email,
            password: formData.password,
            options: {
              data: {
                // Solo presentación: los permisos se asignan en el servidor.
                nombre_completo: nombre,
                sede:            formData.sede,
                rol_asignado:    formData.rol,
              },
            },
          }),
          SIGNUP_TIMEOUT_MS,
          'Alta de usuario',
        );

        if (authError) {
          setError(/already registered/i.test(authError.message) ? 'Este correo ya está registrado.' : authError.message);
          return;
        }

        const newUser = authData.user;
        const newId = newUser?.id;
        if (!newUser || !newId) {
          setError('No se obtuvo el identificador del nuevo usuario.');
          return;
        }
        if (Array.isArray(newUser.identities) && newUser.identities.length === 0) {
          setError('Este correo ya está registrado.');
          return;
        }

        userId = newId;
        setPendingUserId(newId);
        authLog('alta:usuario-creado', { usuario: shortId(newId), rol: formData.rol });
      }

      // ── PASO 2: Asignar rol en el servidor (autoridad: roles_operativos) ────
      const avisos = await assignRole(userId, nombre);

      // ── PASO 3: Perfil de presentación (compatibilidad v2.3, no concede permisos) ─
      const { error: profileError } = await supabase
        .from('perfiles')
        .upsert({
          id:              userId,
          nombre_completo: nombre,
          rol:             formData.rol,
          sede:            formData.sede,
          email,
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('[REGISTER] Perfil de presentación no guardado:', profileError.code ?? profileError.message);
        avisos.push(`El perfil de presentación no se guardó (${profileError.message}). El acceso depende del rol operativo.`);
      }

      setPendingUserId(null);
      if (avisos.length > 0) setWarning(avisos.join(' '));
      setSuccess(true);
      authLog('alta:completada', { usuario: shortId(userId), rol: formData.rol, avisos: avisos.length });

      if (avisos.length === 0) {
        closeTimerRef.current = setTimeout(() => onClose(), SUCCESS_CLOSE_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión durante el alta.');
    } finally {
      setLoading(false);
    }
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
          {warning ? (
            <>
              <p className="text-amber-300 text-[10px] font-mono leading-relaxed">{warning}</p>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl bg-[#E1AD01] py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white"
              >
                Entendido
              </button>
            </>
          ) : (
            <p className="text-zinc-600 text-[9px] font-mono uppercase tracking-widest">
              Redirigiendo...
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-[#E1AD01]/20 w-full max-w-xl rounded-[2.5rem]
                      overflow-hidden shadow-[0_0_100px_rgba(225,173,1,0.12)]
                      animate-in zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto">

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
          <button type="button" onClick={onClose} disabled={loading}
            aria-label="Cerrar"
            className="hover:rotate-90 transition-transform duration-300
                       w-8 h-8 flex items-center justify-center disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleRegister} className="p-8 space-y-7 font-mono">

          {/* ERROR */}
          {error && (
            <div role="alert" className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-red-400 uppercase leading-relaxed">{error}</p>
            </div>
          )}

          {/* USUARIO CREADO SIN ROL */}
          {pendingUserId && (
            <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/25 rounded-2xl p-4">
              <RefreshCw className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-300 uppercase leading-relaxed">
                La cuenta ya fue creada. Solo falta asignar el rol: pulse "Reintentar asignación".
              </p>
            </div>
          )}

          {/* SELECTOR DE RANGO */}
          <div className="space-y-3">
            <label className="text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.25em] block">
              Rango de Autoridad
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {rolesDisponibles.map(rol => {
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
            {!esCeo && (
              <p className="text-[8px] text-zinc-600 uppercase tracking-wider">
                Los cargos ADMIN y CEO solo pueden ser asignados por el CEO.
              </p>
            )}
          </div>

          {/* IDENTIDAD + SEDE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <div className="flex items-center justify-between">
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest block">
                  Clave de Acceso *
                </label>
                <button type="button" onClick={handleGenerate} disabled={!!pendingUserId}
                  className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-[#E1AD01]/70 hover:text-[#E1AD01] disabled:opacity-30">
                  <KeyRound className="h-3 w-3" /> Generar clave
                </button>
              </div>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} required minLength={PASSWORD_MIN}
                  className={`${INPUT_CLS} pr-20`}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  style={{ textTransform: 'none' }}
                  value={formData.password}
                  disabled={!!pendingUserId}
                  onChange={e => set('password', e.target.value)}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {formData.password && (
                    <button type="button" onClick={() => void handleCopy()}
                      aria-label="Copiar clave"
                      className="text-slate-600 hover:text-[#E1AD01] transition-colors">
                      {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                  <button type="button" onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                    className="text-slate-600 hover:text-[#E1AD01] transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="text-[8px] text-zinc-600 uppercase tracking-wider">
                Mínimo {PASSWORD_MIN} caracteres. Entréguela al operador por un canal seguro.
              </p>
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
              : pendingUserId
                ? <><RefreshCw className="h-4 w-4" /> Reintentar asignación de rol</>
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
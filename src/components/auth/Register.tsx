// src/components/auth/Register.tsx
// VALKYRON OS v3.2 — Alta de personal · B&M MANTENIMIENTO AERONÁUTICO
// FUSIÓN v2.3 + v3.0 + v3.1 + rebrand B&M
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v3.2 — REBRAND B&M + CONEXIONES:
//   [UI]  Modal B&M (BmModal): hoja inferior en móvil, diálogo centrado desde
//         md. Rangos como tarjetas seleccionables (aria-pressed), sede
//         segmentada, campos de 48 px con texto de 16 px (sin zoom en iOS).
//         La pantalla de éxito vive dentro del mismo modal.
//   [CHG] Escape lo gestiona BmModal con el mismo bloqueo durante el alta
//         (busy). El listener propio de v3.1 se retira: con los dos activos,
//         Escape llamaba a onClose dos veces.
//   [FIX] El temporizador de "Copiada" se cancela al desmontar (antes podía
//         intentar actualizar estado de un modal ya cerrado).
//   [UI]  Sin marca Águilas: placeholder de correo neutro, cabecera B&M.
//         Se muestran etiquetas de rango (Técnico MRO…) junto al código.
// PRESERVADO ÍNTEGRO (v3.1): cliente aislado para signUp, asignación de rol en
//   servidor (fn_asignar_rol_operativo), reintento sin duplicar cuenta
//   (pendingUserId), bloqueo ADMIN/CEO para no-CEO, generador de clave crypto,
//   mínimo 8 caracteres, upsert de `perfiles` de presentación, avisos no
//   fatales, cierre automático tras el éxito, props { onClose }.
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
// PRESERVADO (v2.3): sedes Lara / Maturín, resumen del perfil a crear, upsert en
//   `perfiles` (compatibilidad de presentación), pie del módulo, props { onClose }.
// REGLA DE ORO: CERO OMISIONES. GRADO MILITAR. SIEMPRE EVOLUCIÓN.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { supabase, createIsolatedAuthClient } from '@/lib/supabaseClient';
import { authLog, classifyPostgrestError, promiseWithTimeout, shortId } from '@/lib/authRecovery';
import { useAuth } from '@/context/AuthContext';
import { BmModal, BmField, BmNotice, bmInput, bmBtn, bmLabel } from '@/components/brand/bm-ui';
import {
  ShieldCheck, UserPlus, Loader2,
  Wrench, Shield, Plane, Landmark, CheckCircle2, AlertTriangle,
  ClipboardList, CalendarCheck, Eye, EyeOff, KeyRound, Copy, RefreshCw, MapPin,
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

// [v3.2] Campos B&M (antes: negro con borde dorado)
const INPUT_CLS = `${bmInput} uppercase placeholder:normal-case`;

const SIGNUP_TIMEOUT_MS = 25000;
const RPC_TIMEOUT_MS = 15000;
const PASSWORD_MIN = 8;
const SUCCESS_CLOSE_MS = 2200;
const COPIED_MS = 2500; // [v3.2]

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
  const copyTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null); // [v3.2]

  const set = (key: keyof typeof formData, val: string) => {
    // Cambiar el correo invalida el usuario pendiente (sería otra cuenta).
    if (key === 'email') setPendingUserId(null);
    setFormData(prev => ({ ...prev, [key]: val }));
  };

  // [v3.1] Limpieza del cierre automático · [v3.2] y del aviso de copiado
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  // [v3.2] Escape: lo atiende BmModal (bloqueado con busy={loading}).

  const handleGenerate = () => {
    set('password', generateTempPassword());
    setShowPassword(true);
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formData.password);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_MS);
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

  const rolActual = ROLES.find(r => r.id === formData.rol);

  // ── PANTALLA DE ÉXITO ─────────────────────────────────────────────────────
  if (success) {
    return (
      <BmModal
        open
        onClose={onClose}
        title="Alta completada"
        subtitle="B&M Mantenimiento Aeronáutico"
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="ok"
        size="sm"
        z={200}
      >
        <div className="space-y-5 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-bm-ok-tint text-bm-ok">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <div>
            <p className="bm-heading text-lg uppercase">{formData.nombre}</p>
            <p className="mt-1 text-sm text-bm-steel">
              {rolActual?.label ?? formData.rol} · Base {formData.sede}
            </p>
          </div>
          {warning ? (
            <>
              <BmNotice tone="warn" className="text-left" icon={<AlertTriangle className="h-4 w-4" />}>
                {warning}
              </BmNotice>
              <button type="button" onClick={onClose} className={`${bmBtn.primary} w-full`}>
                Entendido
              </button>
            </>
          ) : (
            <p className="text-sm text-bm-steel" role="status">Cerrando…</p>
          )}
        </div>
      </BmModal>
    );
  }

  // ── FORMULARIO ────────────────────────────────────────────────────────────
  return (
    <BmModal
      open
      onClose={onClose}
      busy={loading}
      title="Alta de personal"
      subtitle="B&M Mantenimiento Aeronáutico · Valkyron OS"
      icon={<UserPlus className="h-5 w-5" />}
      tone="red"
      size="lg"
      z={200}
    >
      <form onSubmit={handleRegister} className="space-y-6">

        {/* ERROR */}
        {error && (
          <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
            {error}
          </BmNotice>
        )}

        {/* USUARIO CREADO SIN ROL */}
        {pendingUserId && (
          <BmNotice tone="warn" icon={<RefreshCw className="h-4 w-4" />}>
            La cuenta ya fue creada. Solo falta asignar el rol: pulse <strong>Reintentar asignación de rol</strong>.
          </BmNotice>
        )}

        {/* SELECTOR DE RANGO */}
        <fieldset className="space-y-2.5">
          <legend className={`${bmLabel} mb-2.5`}>Rango de autoridad</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rolesDisponibles.map(rol => {
              const Icon   = rol.icon;
              const active = formData.rol === rol.id;
              return (
                <button key={rol.id} type="button"
                  aria-pressed={active}
                  onClick={() => set('rol', rol.id)}
                  className={`relative flex min-h-[88px] flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-bm-red bg-bm-red-tint text-bm-ink ring-4 ring-bm-red/10'
                      : 'border-bm-line bg-white text-bm-ink hover:border-bm-field'
                  }`}>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? 'bg-bm-red text-white' : 'bg-bm-canvas text-bm-steel'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-tight">{rol.label}</span>
                    <span className="mt-0.5 block text-xs leading-tight text-bm-steel">{rol.desc}</span>
                  </span>
                  {active && <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-bm-red" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {!esCeo && (
            <p className="text-[13px] text-bm-steel">
              Los cargos ADMIN y CEO solo pueden ser asignados por el CEO.
            </p>
          )}
        </fieldset>

        {/* IDENTIDAD + SEDE */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BmField label="Nombre completo" htmlFor="rg-nombre" required>
            <input id="rg-nombre" required className={INPUT_CLS}
              placeholder="Nombre y apellido"
              autoComplete="off"
              value={formData.nombre}
              onChange={e => set('nombre', e.target.value)}
            />
          </BmField>
          <div className="space-y-2">
            <span className={`${bmLabel} flex items-center gap-1`} id="rg-sede-label">
              <MapPin className="h-4 w-4 text-bm-steel" /> Sede asignada
            </span>
            <div role="group" aria-labelledby="rg-sede-label" className="flex h-12 rounded-xl border border-bm-field bg-white p-1">
              {(['Lara', 'Maturín'] as Sede[]).map(loc => (
                <button key={loc} type="button"
                  aria-pressed={formData.sede === loc}
                  onClick={() => set('sede', loc)}
                  className={`flex-1 rounded-lg text-[15px] transition-colors ${
                    formData.sede === loc
                      ? 'bg-bm-ink font-semibold text-white'
                      : 'font-medium text-bm-steel hover:text-bm-ink'}`}>
                  {loc}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* CREDENCIALES */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BmField label="Correo corporativo" htmlFor="rg-email" required>
            <input id="rg-email" type="email" required className={bmInput}
              placeholder="nombre.apellido@empresa.com"
              autoComplete="off"
              inputMode="email"
              value={formData.email}
              onChange={e => set('email', e.target.value)}
            />
          </BmField>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="rg-clave" className={`${bmLabel} flex items-center gap-1`}>
                Clave de acceso <span className="text-bm-red" aria-hidden="true">*</span>
              </label>
              <button type="button" onClick={handleGenerate} disabled={!!pendingUserId}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-bm-red hover:bg-bm-red-tint disabled:opacity-40">
                <KeyRound className="h-3.5 w-3.5" /> Generar clave
              </button>
            </div>
            <div className="relative">
              <input id="rg-clave" type={showPassword ? 'text' : 'password'} required minLength={PASSWORD_MIN}
                className={`${bmInput} font-data pr-24`}
                placeholder="••••••••"
                autoComplete="new-password"
                value={formData.password}
                disabled={!!pendingUserId}
                onChange={e => set('password', e.target.value)}
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
                {formData.password && (
                  <button type="button" onClick={() => void handleCopy()}
                    aria-label={copied ? 'Clave copiada' : 'Copiar clave'}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
                    {copied ? <CheckCircle2 className="h-4 w-4 text-bm-ok" /> : <Copy className="h-4 w-4" />}
                  </button>
                )}
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-[13px] text-bm-steel">
              Mínimo {PASSWORD_MIN} caracteres. Entréguela al operador por un canal seguro.
            </p>
          </div>
        </div>

        {/* RESUMEN DEL PERFIL A CREAR */}
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-bm-canvas p-4">
          <div className="min-w-0">
            <p className="text-xs text-bm-steel">Perfil a crear</p>
            <p className="mt-0.5 truncate text-sm font-semibold uppercase">
              {formData.nombre || '—'} · <span className="text-bm-red">{rolActual?.label ?? formData.rol}</span>
            </p>
            <p className="mt-0.5 truncate text-[13px] text-bm-steel">
              Base {formData.sede} · {formData.email || 'sin correo'}
            </p>
          </div>
          <ShieldCheck className="h-8 w-8 shrink-0 text-bm-red/30" aria-hidden="true" />
        </div>

        {/* SUBMIT */}
        <button type="submit" disabled={loading} className={`${bmBtn.primary} w-full`}>
          {loading
            ? <><Loader2 className="h-5 w-5 animate-spin" /> Procesando alta…</>
            : pendingUserId
              ? <><RefreshCw className="h-4 w-4" /> Reintentar asignación de rol</>
              : <><UserPlus className="h-4 w-4" /> Dar de alta</>
          }
        </button>

        <p className="text-center text-xs text-bm-hint">
          Valkyron OS · Módulo de alta de personal
        </p>
      </form>
    </BmModal>
  );
};

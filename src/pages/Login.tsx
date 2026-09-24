// src/pages/Login.tsx
// VALKYRON OS v7.1 — LOGIN / SOLICITUD DE ALTA · ÁGUILAS PILOT
// FUSIÓN: Login original (PLANIFICADOR_VUELO) + v7.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v7.1:
//   [NEW] Aviso de Bloq Mayús activado en la contraseña.
//   [NEW] Mostrar / ocultar contraseña (se oculta al cambiar de modo).
//   [NEW] Solicitud de alta: confirmación de contraseña y mínimo 8 caracteres
//         (el inicio de sesión sigue aceptando 6 para cuentas existentes).
//   [NEW] Mensajes claros para: límite de intentos (429), registro público
//         deshabilitado en Supabase y contraseña fuera de política.
//   [FIX] ?reparado=1 se retira de la URL tras mostrarse (no reaparece al recargar).
//   [KEEP ORIGINAL] Registro de inicio de sesión, ahora vía authLog con id truncado
//         (antes console.info con el id completo del usuario).
//
// CHANGELOG v7.0:
//   [FIX] Tras iniciar sesión ya no se navega a ciegas: se espera a que
//         AuthContext confirme la sesión (evita rebote login ↔ inicio).
//   [FIX] Límite de espera en el inicio de sesión (25 s) → nunca queda girando.
//   [SEC] El registro público es una SOLICITUD de alta: ya no ofrece ADMIN ni CEO
//         y envía `rol_solicitado` (no `rol`) en user_metadata. Los privilegios
//         solo los asigna administración (roles_operativos / app_metadata).
//   [SEC] La solicitud usa un cliente aislado: signUp no deja una sesión activa
//         en este navegador.
//   [NEW] Avisos: sesión expirada, dispositivo reparado, incidencias de sesión
//         con acceso a Reintentar / Reparar sesión del dispositivo.
//   [NEW] Si ya hay sesión válida, redirige a la ruta de origen.
// PRESERVADO: diseño, identidad visual, campos, sedes, perfil de planificación,
//   mensajes de error, alternancia login/registro.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, createIsolatedAuthClient } from '@/lib/supabaseClient';
import { authLog, promiseWithTimeout, shortId } from '@/lib/authRecovery';
import { useAuth } from '@/context/AuthContext';
import { AuthRecoveryPanel } from '@/components/AuthRecoveryPanel';
import {
  Mail,
  Lock,
  User,
  Loader2,
  AlertCircle,
  ChevronLeft,
  CheckCircle2,
  Wrench,
  Eye,
  EyeOff,
} from 'lucide-react';

// VALKYRON OS — ÁGUILAS PILOT
// LOGIN / SOLICITUD DE ALTA DE PERSONAL
//
// IMPORTANTE:
// El rol elegido aquí es solo una SOLICITUD. Los metadatos editables del usuario
// no constituyen una fuente segura de permisos; administración asigna el rol
// real desde el módulo de Alta de Personal (fn_asignar_rol_operativo).

const ROLES = [
  { value: 'MECANICO', label: 'MECÁNICO' },
  { value: 'CAPITAN', label: 'CAPITÁN' },
  {
    value: 'PLANIFICADOR_VUELO',
    label: 'PLANIFICADOR DE VUELO',
  },
  { value: 'OPERACIONES', label: 'OPERACIONES' },
] as const;

type Rol = (typeof ROLES)[number]['value'];

const SIGNIN_TIMEOUT_MS = 25000;
const SESSION_SYNC_TIMEOUT_MS = 12000;
const NEW_PASSWORD_MIN = 8;
const LOGIN_PASSWORD_MIN = 6;

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [nombre, setNombre] = useState('');

  const [rol, setRol] = useState<Rol>('MECANICO');
  const [sede, setSede] = useState('Lara');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaitingSession, setAwaitingSession] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);

  const params = new URLSearchParams(location.search);
  // [v7.1] Se captura una vez: la URL se limpia y el aviso no reaparece al recargar.
  const [reparado] = useState(() => params.get('reparado') === '1');
  const fromState = (location.state as { from?: string } | null)?.from;
  const destino = fromState && fromState !== '/login' ? fromState : '/';

  useEffect(() => {
    if (new URLSearchParams(location.search).has('reparado')) {
      navigate(location.pathname, { replace: true, state: location.state });
    }
  }, [location.pathname, location.search, location.state, navigate]);

  // Sesión confirmada por AuthContext → entrar.
  useEffect(() => {
    if (auth.status === 'authenticated') {
      navigate(destino, { replace: true });
    }
  }, [auth.status, destino, navigate]);

  // Si la sesión se creó pero el contexto no la confirma, ofrecer recuperación.
  useEffect(() => {
    if (!awaitingSession) return;
    const t = setTimeout(() => {
      setAwaitingSession(false);
      setLoading(false);
      setShowRecovery(true);
      setError('LA SESIÓN SE INICIÓ PERO NO SE PUDO SINCRONIZAR EN ESTE EQUIPO');
    }, SESSION_SYNC_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [awaitingSession]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (isRegistering) {
        if (!nombre.trim()) {
          throw new Error('EL NOMBRE DEL OPERADOR ES OBLIGATORIO');
        }

        if (password.length < NEW_PASSWORD_MIN) {
          throw new Error(`LA CONTRASEÑA DEBE TENER AL MENOS ${NEW_PASSWORD_MIN} CARACTERES`);
        }

        if (password !== confirmPassword) {
          throw new Error('LAS CONTRASEÑAS NO COINCIDEN');
        }

        // Cliente aislado: la solicitud no deja sesión activa en este navegador.
        const isolated = createIsolatedAuthClient();
        const { data, error: authError } = await promiseWithTimeout(
          isolated.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: {
              data: {
                nombre_completo: nombre.trim().toUpperCase(),
                rol_solicitado: rol,
                sede,
              },
            },
          }),
          SIGNIN_TIMEOUT_MS,
          'Solicitud de alta',
        );

        if (authError) throw authError;

        if (!data.user) {
          throw new Error(
            'NO SE PUDO COMPLETAR EL REGISTRO DEL OPERADOR'
          );
        }

        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('User already registered');
        }

        setNotice(
          `SOLICITUD REGISTRADA · ${nombre.trim().toUpperCase()} · ` +
          `${ROLES.find(r => r.value === rol)?.label} · ${sede.toUpperCase()}. ` +
          'El acceso se habilitará cuando administración valide y asigne el rol.'
        );

        setPassword('');
        setConfirmPassword('');
        setShowPassword(false);
        setIsRegistering(false);
        setLoading(false);
      } else {
        const { data, error: authError } = await promiseWithTimeout(
          supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          }),
          SIGNIN_TIMEOUT_MS,
          'Inicio de sesión',
        );

        if (authError) throw authError;

        if (!data.user) {
          throw new Error('NO SE PUDO VALIDAR LA SESIÓN');
        }

        // AuthContext obtiene el rol autorizado desde la base de datos y,
        // al confirmar la sesión, el efecto de arriba navega al destino.
        authLog('login:credenciales-validas', { usuario: shortId(data.user.id) });
        setPassword('');
        setAwaitingSession(true);
      }
    } catch (err: unknown) {
      const mensaje =
        err instanceof Error
          ? err.message
          : 'ERROR DESCONOCIDO';

      console.error('[ÁGUILAS PILOT AUTH]', err instanceof Error ? err.name : 'Error');

      if (/already registered/i.test(mensaje)) {
        setError('EL USUARIO YA EXISTE EN EL SISTEMA');
      } else if (/credentials/i.test(mensaje)) {
        setError(
          'ACCESO DENEGADO: CREDENCIALES INVÁLIDAS'
        );
      } else if (/rate limit|too many|429/i.test(mensaje)) {
        setError('DEMASIADOS INTENTOS. ESPERE UNOS MINUTOS ANTES DE REINTENTAR');
      } else if (/signups? (not allowed|is disabled|are disabled)/i.test(mensaje)) {
        setError('EL REGISTRO PÚBLICO ESTÁ DESHABILITADO. SOLICITE EL ALTA A ADMINISTRACIÓN');
      } else if (/password should|weak password|password is too/i.test(mensaje)) {
        setError('LA CONTRASEÑA NO CUMPLE LA POLÍTICA DE SEGURIDAD');
      } else if (/email not confirmed/i.test(mensaje)) {
        setError('DEBE CONFIRMAR SU CORREO ANTES DE INGRESAR');
      } else if (/tiempo de espera|timeout|failed to fetch|network/i.test(mensaje)) {
        setError('SIN RESPUESTA DEL SERVIDOR. VERIFIQUE LA CONEXIÓN E INTENTE DE NUEVO');
        setShowRecovery(true);
      } else {
        setError(mensaje.toUpperCase());
      }
      setLoading(false);
      setAwaitingSession(false);
    }
  };

  const cambiarModo = () => {
    setIsRegistering(prev => !prev);
    setError(null);
    setNotice(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setCapsLock(false);
  };

  const detectCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState('CapsLock'));
  };

  const inputClass =
    'w-full p-4 pl-12 rounded-2xl bg-black/50 ' +
    'text-white border border-white/5 ' +
    'focus:border-[#E1AD01] outline-none text-xs ' +
    'transition-all';

  const selectClass =
    'w-full p-4 rounded-2xl bg-black/50 ' +
    'text-[#E1AD01] border border-white/5 ' +
    'outline-none text-[10px] font-black ' +
    'uppercase cursor-pointer';

  const sessionProblem =
    auth.status === 'error' ||
    auth.issue === 'SESSION_INVALID' ||
    auth.issue === 'STORAGE_CORRUPT';

  return (
    <div
      className="
        flex min-h-screen items-center justify-center
        bg-[#020202] overflow-hidden font-sans
        relative px-4 py-8
      "
    >
      {/* Iluminación estructural */}

      <div
        className="
          pointer-events-none absolute
          w-[600px] h-[600px] bg-[#E1AD01]/10
          rounded-full blur-[120px] -top-40 -left-40
        "
      />

      <div
        className="
          pointer-events-none absolute
          w-[600px] h-[600px] bg-[#E1AD01]/5
          rounded-full blur-[120px] -bottom-40 -right-40
        "
      />

      <div
        className="
          relative z-10 bg-white/5 backdrop-blur-2xl
          p-7 md:p-10 rounded-[2.5rem]
          border border-white/10 w-full max-w-md
          shadow-2xl transition-all duration-500
          max-h-[95vh] overflow-y-auto
        "
      >
        {/* Identidad visual */}

        <div className="flex flex-col items-center mb-8">
          <div
            className="
              mb-6 drop-shadow-[0_0_15px_rgba(225,173,1,0.3)]
            "
          >
            <img
              src="/logo.png"
              alt="Águilas Pilot"
              className="w-48 h-auto object-contain"
            />
          </div>

          <h1
            className="
              text-white text-3xl font-black
              tracking-tighter uppercase italic
              text-center leading-none
            "
          >
            {isRegistering
              ? 'Solicitud de Alta'
              : 'Inicio de Sesión'}
          </h1>

          <p
            className="
              text-slate-500 text-[9px] mt-3
              font-mono uppercase tracking-[0.4em]
              text-center
            "
          >
            {isRegistering
              ? 'Registro de Operadores'
              : 'Sistema de Inventario & MRO'}
          </p>
        </div>

        {/* Avisos de sesión */}

        {reparado && !error && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-[10px] text-emerald-300 font-black uppercase leading-tight tracking-widest">
              Sesión del dispositivo reparada. Inicie sesión nuevamente.
            </p>
          </div>
        )}

        {auth.issue === 'SESSION_EXPIRED' && !error && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-[10px] text-amber-300 font-black uppercase leading-tight tracking-widest">
              Su sesión expiró. Inicie sesión nuevamente.
            </p>
          </div>
        )}

        {notice && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-emerald-300 font-black uppercase leading-relaxed tracking-wider">
              {notice}
            </p>
          </div>
        )}

        {/* Errores */}

        {error && (
          <div
            role="alert"
            className="
              mb-6 p-4 bg-red-500/10
              border border-red-500/20 rounded-xl
              flex items-center gap-3
            "
          >
            <AlertCircle
              className="h-4 w-4 text-red-500 shrink-0"
            />

            <p
              className="
                text-[10px] text-red-500 font-black
                uppercase leading-tight tracking-widest
              "
            >
              {error}
            </p>
          </div>
        )}

        {(sessionProblem || showRecovery) && (
          <div className="mb-6">
            <AuthRecoveryPanel compact showSignOut={auth.status !== 'anonymous'} />
          </div>
        )}

        <form
          onSubmit={handleAuth}
          className="space-y-4"
        >
          {isRegistering && (
            <div className="space-y-4">
              {/* Nombre */}

              <div className="space-y-1">
                <label
                  htmlFor="operator-name"
                  className="
                    text-[8px] text-slate-500
                    font-black uppercase ml-2
                    tracking-widest
                  "
                >
                  Nombre del Operador
                </label>

                <div className="relative">
                  <User
                    className="
                      absolute left-4 top-1/2
                      -translate-y-1/2 h-4 w-4
                      text-slate-600
                    "
                  />

                  <input
                    id="operator-name"
                    type="text"
                    placeholder="NOMBRE COMPLETO"
                    required
                    autoComplete="name"
                    value={nombre}
                    className={`${inputClass} uppercase`}
                    onChange={e =>
                      setNombre(e.target.value)
                    }
                  />
                </div>
              </div>

              {/* Rol y sede */}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label
                    htmlFor="operator-role"
                    className="
                      text-[8px] text-slate-500
                      font-black uppercase ml-2
                      tracking-widest
                    "
                  >
                    Rango solicitado
                  </label>

                  <select
                    id="operator-role"
                    className={selectClass}
                    value={rol}
                    onChange={e =>
                      setRol(e.target.value as Rol)
                    }
                  >
                    {ROLES.map(item => (
                      <option
                        key={item.value}
                        value={item.value}
                      >
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="operator-site"
                    className="
                      text-[8px] text-slate-500
                      font-black uppercase ml-2
                      tracking-widest
                    "
                  >
                    Sede
                  </label>

                  <select
                    id="operator-site"
                    className={selectClass}
                    value={sede}
                    onChange={e =>
                      setSede(e.target.value)
                    }
                  >
                    <option value="Lara">LARA</option>

                    <option value="Maturin">
                      MATURÍN
                    </option>
                  </select>
                </div>
              </div>

              {rol === 'PLANIFICADOR_VUELO' && (
                <div
                  className="
                    bg-[#E1AD01]/5
                    border border-[#E1AD01]/20
                    rounded-xl p-4
                  "
                >
                  <p
                    className="
                      text-[10px] text-[#E1AD01]
                      font-black uppercase mb-2
                    "
                  >
                    Perfil de Planificación
                  </p>

                  <p
                    className="
                      text-[10px] text-slate-400
                      leading-relaxed
                    "
                  >
                    Acceso previsto al hangar en
                    modalidad de consulta y al módulo
                    de planificación de vuelos.
                    Sin permisos de certificación
                    de mantenimiento.
                  </p>
                </div>
              )}

              <p className="text-[9px] text-slate-500 leading-relaxed px-1">
                Los cargos administrativos (ADMIN, CEO, DIRECTOR) solo se asignan
                desde el módulo interno de Alta de Personal.
              </p>
            </div>
          )}

          {/* Correo */}

          <div className="space-y-1">
            <label
              htmlFor="operator-email"
              className="
                text-[8px] text-slate-500
                font-black uppercase ml-2
                tracking-widest
              "
            >
              ID Corporativo
            </label>

            <div className="relative">
              <Mail
                className="
                  absolute left-4 top-1/2
                  -translate-y-1/2 h-4 w-4
                  text-slate-600
                "
              />

              <input
                id="operator-email"
                type="email"
                placeholder="EMAIL"
                required
                autoComplete="email"
                value={email}
                className={inputClass}
                onChange={e =>
                  setEmail(e.target.value)
                }
              />
            </div>
          </div>

          {/* Contraseña */}

          <div className="space-y-1">
            <label
              htmlFor="operator-password"
              className="
                text-[8px] text-slate-500
                font-black uppercase ml-2
                tracking-widest
              "
            >
              Contraseña
            </label>

            <div className="relative">
              <Lock
                className="
                  absolute left-4 top-1/2
                  -translate-y-1/2 h-4 w-4
                  text-slate-600
                "
              />

              <input
                id="operator-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                required
                minLength={
                  isRegistering
                    ? NEW_PASSWORD_MIN
                    : LOGIN_PASSWORD_MIN
                }
                autoComplete={
                  isRegistering
                    ? 'new-password'
                    : 'current-password'
                }
                value={password}
                className={`${inputClass} pr-12`}
                onKeyDown={detectCaps}
                onKeyUp={detectCaps}
                onBlur={() => setCapsLock(false)}
                onChange={e =>
                  setPassword(e.target.value)
                }
              />

              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="
                  absolute right-4 top-1/2 -translate-y-1/2
                  text-slate-600 hover:text-[#E1AD01]
                  transition-colors
                "
              >
                {showPassword
                  ? <EyeOff className="h-4 w-4" />
                  : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {capsLock && (
              <p className="ml-2 text-[9px] font-black uppercase tracking-widest text-amber-400">
                Bloq Mayús activado
              </p>
            )}
          </div>

          {/* Confirmación de contraseña (solo solicitud de alta) */}

          {isRegistering && (
            <div className="space-y-1">
              <label
                htmlFor="operator-password-confirm"
                className="
                  text-[8px] text-slate-500
                  font-black uppercase ml-2
                  tracking-widest
                "
              >
                Confirmar Contraseña
              </label>

              <div className="relative">
                <Lock
                  className="
                    absolute left-4 top-1/2
                    -translate-y-1/2 h-4 w-4
                    text-slate-600
                  "
                />

                <input
                  id="operator-password-confirm"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  required
                  minLength={NEW_PASSWORD_MIN}
                  autoComplete="new-password"
                  value={confirmPassword}
                  className={inputClass}
                  onKeyDown={detectCaps}
                  onKeyUp={detectCaps}
                  onChange={e =>
                    setConfirmPassword(e.target.value)
                  }
                />
              </div>

              {confirmPassword.length > 0 && confirmPassword !== password && (
                <p className="ml-2 text-[9px] font-black uppercase tracking-widest text-red-400">
                  Las contraseñas no coinciden
                </p>
              )}
            </div>
          )}

          {/* Acción principal */}

          <button
            type="submit"
            disabled={loading}
            className="
              w-full py-5 bg-[#E1AD01]
              text-black rounded-2xl font-black
              uppercase text-[10px]
              tracking-[0.3em] shadow-xl
              shadow-[#E1AD01]/10
              transition-all active:scale-95
              hover:bg-white
              flex items-center justify-center gap-2
              disabled:opacity-50
            "
          >
            {loading ? (
              <>
                <Loader2
                  className="h-5 w-5 animate-spin"
                />
                {awaitingSession && <span>Sincronizando</span>}
              </>
            ) : isRegistering ? (
              'Enviar Solicitud'
            ) : (
              'Inicializar Sistema'
            )}
          </button>
        </form>

        {/* Cambiar entre registro y login */}

        <button
          type="button"
          onClick={cambiarModo}
          className="
            w-full mt-8 text-[9px]
            text-slate-600 font-black uppercase
            tracking-[0.3em]
            hover:text-[#E1AD01]
            transition-colors
            flex items-center justify-center
            gap-2 group
          "
        >
          {isRegistering ? (
            <>
              <ChevronLeft
                className="
                  h-3 w-3 transition-transform
                  group-hover:-translate-x-1
                "
              />

              Volver al Login
            </>
          ) : (
            '¿Registrar Nuevo Operador?'
          )}
        </button>

        {!isRegistering && !sessionProblem && !showRecovery && (
          <button
            type="button"
            onClick={() => setShowRecovery(true)}
            className="
              w-full mt-4 text-[8px]
              text-slate-700 font-black uppercase
              tracking-[0.25em]
              hover:text-amber-400
              transition-colors
              flex items-center justify-center gap-2
            "
          >
            <Wrench className="h-3 w-3" />
            ¿Problemas para entrar en este equipo?
          </button>
        )}
      </div>

      <p
        className="
          absolute bottom-2 text-center
          text-[8px] text-slate-700
          font-mono uppercase tracking-[0.3em]
        "
      >
        Valkyron Group Deployment — Barquisimeto Hub
      </p>
    </div>
  );
};

export default Login;
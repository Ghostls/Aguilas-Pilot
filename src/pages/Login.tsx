// src/pages/Login.tsx
// VALKYRON OS v8.0.1 — LOGIN / SOLICITUD DE ALTA · B&M MANTENIMIENTO AERONÁUTICO
// FUSIÓN: Login original (PLANIFICADOR_VUELO) + v7.0 + v7.1 + rebrand B&M
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v8.0.1:
//   [FIX]  Se retira import '@/theme/bm-theme.css': el tema entra una sola vez
//          por index.css. Evita el error de Vite si el archivo falta aquí.
// CHANGELOG v8.0 — REBRAND B&M:
//   [UI]   Identidad B&M (ex Águilas Pilot): fondo blanco, rojo B&M #D42125 en
//          acciones y foco, logo vectorial <BmLogo> (sin /logo.png).
//   [UI]   Mobile-first: una columna alineada a la izquierda en móvil; desde lg,
//          panel de marca con el cóndor a gran escala + formulario.
//   [UI]   Campos de 48 px con texto de 16 px (iOS no hace zoom al enfocar),
//          ícono que se tiñe de rojo con el foco, selects con chevron propio.
//   [UI]   Mensajes en minúscula de oración y voz de la interfaz. El error
//          desconocido se muestra tal cual (antes .toUpperCase()).
//   [UI]   El botón principal indica qué está pasando: Verificando / Enviando /
//          Sincronizando sesión.
//   [A11Y] aria-live en avisos, aria-invalid en confirmación, foco visible.
// PRESERVADO ÍNTEGRO (v7.1): signIn con timeout, espera de AuthContext antes de
//   navegar, alta con cliente aislado y rol_solicitado, detección de usuario
//   existente, clasificación de errores (mismas expresiones), recuperación de
//   sesión, limpieza de ?reparado=1, Bloq Mayús, mostrar/ocultar contraseña,
//   mínimos 8 (alta) / 6 (login), sedes y perfil de planificación.
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
// PRESERVADO: campos, sedes, perfil de planificación, alternancia login/registro.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, createIsolatedAuthClient } from '@/lib/supabaseClient';
import { authLog, promiseWithTimeout, shortId } from '@/lib/authRecovery';
import { useAuth } from '@/context/AuthContext';
import { AuthRecoveryPanel } from '@/components/AuthRecoveryPanel';
import { BmLogo } from '@/components/brand/BmLogo'; // [v8.0] logo vectorial B&M
// [v8.0.1] El tema B&M (bm-theme.css) se carga una sola vez desde index.css.
import {
  Mail,
  Lock,
  User,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronDown, // [v8.0] chevron de selects
  CheckCircle2,
  Wrench,
  Eye,
  EyeOff,
} from 'lucide-react';

// VALKYRON OS — B&M MANTENIMIENTO AERONÁUTICO
// LOGIN / SOLICITUD DE ALTA DE PERSONAL
//
// IMPORTANTE:
// El rol elegido aquí es solo una SOLICITUD. Los metadatos editables del usuario
// no constituyen una fuente segura de permisos; administración asigna el rol
// real desde el módulo de Alta de Personal (fn_asignar_rol_operativo).

const ROLES = [
  { value: 'MECANICO', label: 'Mecánico' },
  { value: 'CAPITAN', label: 'Capitán' },
  {
    value: 'PLANIFICADOR_VUELO',
    label: 'Planificador de vuelo',
  },
  { value: 'OPERACIONES', label: 'Operaciones' },
] as const;

type Rol = (typeof ROLES)[number]['value'];

// [v8.0] Sedes: los valores enviados a user_metadata no cambian ('Lara' | 'Maturin').
const SEDES = [
  { value: 'Lara', label: 'Lara' },
  { value: 'Maturin', label: 'Maturín' },
] as const;

const SIGNIN_TIMEOUT_MS = 25000;
const SESSION_SYNC_TIMEOUT_MS = 12000;
const NEW_PASSWORD_MIN = 8;
const LOGIN_PASSWORD_MIN = 6;

// ─────────────────────────────────────────────────────────────────────────────
// [v8.0] PIEZAS DE UI B&M — a nivel de módulo
// ─────────────────────────────────────────────────────────────────────────────

type AvisoTone = 'ok' | 'warn' | 'error';

const AVISO_TONES: Record<AvisoTone, { box: string; icon: string }> = {
  ok: { box: 'bg-[#E7F5EE] border-[#18794E]/20 text-[#14532D]', icon: 'text-[#18794E]' },
  warn: { box: 'bg-[#FEF3E2] border-[#B45309]/20 text-[#7C2D12]', icon: 'text-[#B45309]' },
  error: { box: 'bg-[#FCEBEC] border-[#D42125]/25 text-[#7F1D1D]', icon: 'text-[#D42125]' },
};

/** Aviso en línea: éxito, advertencia o error. */
const Aviso = ({
  tone,
  children,
  alert = false,
}: {
  tone: AvisoTone;
  children: React.ReactNode;
  alert?: boolean;
}) => {
  const t = AVISO_TONES[tone];
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={alert ? 'alert' : 'status'}
      className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${t.box}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.icon}`} />
      <p className="text-sm leading-snug">{children}</p>
    </div>
  );
};

const labelClass = 'text-sm font-medium text-[#1B1D22]';

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
      setError('La sesión se inició, pero este equipo no pudo sincronizarla. Use las opciones de recuperación.');
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
          throw new Error('Ingrese el nombre completo del operador.');
        }

        if (password.length < NEW_PASSWORD_MIN) {
          throw new Error(`La contraseña debe tener al menos ${NEW_PASSWORD_MIN} caracteres.`);
        }

        if (password !== confirmPassword) {
          throw new Error('Las contraseñas no coinciden.');
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
            'No se pudo completar el registro del operador.'
          );
        }

        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('User already registered');
        }

        setNotice(
          `Solicitud registrada para ${nombre.trim().toUpperCase()}: ` +
          `${ROLES.find(r => r.value === rol)?.label}, sede ${SEDES.find(s => s.value === sede)?.label ?? sede}. ` +
          'El acceso se habilitará cuando administración valide la cuenta y asigne el rol.'
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
          throw new Error('No se pudo validar la sesión.');
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
          : 'Error desconocido.';

      console.error('[B&M AUTH]', err instanceof Error ? err.name : 'Error');

      if (/already registered/i.test(mensaje)) {
        setError('Este correo ya está registrado en el sistema.');
      } else if (/credentials/i.test(mensaje)) {
        setError(
          'Correo o contraseña incorrectos.'
        );
      } else if (/rate limit|too many|429/i.test(mensaje)) {
        setError('Demasiados intentos. Espere unos minutos antes de volver a intentar.');
      } else if (/signups? (not allowed|is disabled|are disabled)/i.test(mensaje)) {
        setError('El registro público está deshabilitado. Solicite el alta a administración.');
      } else if (/password should|weak password|password is too/i.test(mensaje)) {
        setError('La contraseña no cumple la política de seguridad.');
      } else if (/email not confirmed/i.test(mensaje)) {
        setError('Debe confirmar su correo antes de ingresar. Revise su bandeja de entrada.');
      } else if (/tiempo de espera|timeout|failed to fetch|network/i.test(mensaje)) {
        setError('El servidor no respondió. Verifique la conexión e intente de nuevo.');
        setShowRecovery(true);
      } else {
        setError(mensaje);
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

  // [v8.0] Campos B&M: 48 px de alto, 16 px de texto, foco rojo.
  const inputClass =
    'peer w-full h-12 rounded-xl border border-[#D9DCE1] bg-white ' +
    'pl-11 pr-4 text-base text-[#1B1D22] placeholder:text-[#9AA0A8] ' +
    'outline-none transition-[border-color,box-shadow] ' +
    'focus:border-[#D42125] focus:ring-4 focus:ring-[#D42125]/10';

  const selectClass =
    'w-full h-12 appearance-none rounded-xl border border-[#D9DCE1] bg-white ' +
    'pl-4 pr-10 text-base text-[#1B1D22] cursor-pointer outline-none ' +
    'transition-[border-color,box-shadow] ' +
    'focus:border-[#D42125] focus:ring-4 focus:ring-[#D42125]/10';

  // Ícono de campo: va DESPUÉS del input en el DOM para reaccionar al foco (peer).
  const fieldIconClass =
    'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 ' +
    'text-[#9AA0A8] transition-colors peer-focus:text-[#D42125]';

  const sessionProblem =
    auth.status === 'error' ||
    auth.issue === 'SESSION_INVALID' ||
    auth.issue === 'STORAGE_CORRUPT';

  const passwordMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <div className="bm-app min-h-[100dvh] bg-white lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* Panel de marca — solo escritorio */}

      <aside
        className="
          relative hidden lg:flex flex-col
          overflow-hidden bg-[#F2F3F5]
          p-12 xl:p-16
        "
      >
        <BmLogo
          variant="compact"
          className="relative h-12 xl:h-14 w-auto self-start text-[#D42125]"
        />

        <div className="relative mt-14 xl:mt-16 max-w-[25rem]">
          <p className="bm-heading text-[32px] xl:text-[38px] leading-[1.06] text-[#1B1D22]">
            Mantenimiento aeronáutico con trazabilidad de cada parte y cada hora.
          </p>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-[#5F6670]">
            Inventario, órdenes de trabajo y estado de la flota de las sedes
            Lara y Maturín.
          </p>
        </div>

        {/* Cóndor a gran escala: ocupa el espacio bajo el texto (nunca lo pisa)
            y sale por el borde inferior. Escala con la altura de la ventana. */}
        <div
          className="relative flex-1 min-h-[180px] mt-10 -mx-12 -mb-12 xl:-mx-16 xl:-mb-16"
          aria-hidden="true"
        >
          <BmLogo
            variant="mark"
            aria-hidden="true"
            preserveAspectRatio="xMaxYMin meet"
            className="
              pointer-events-none absolute
              right-[4%] top-0 h-[118%] w-[92%]
              text-[#D42125]
            "
          />
        </div>
      </aside>

      {/* Formulario */}

      <main className="flex min-h-[100dvh] flex-col px-5 sm:px-10">
        <div className="flex flex-1 items-center justify-center py-10 sm:py-14">
          <div className="w-full max-w-[400px]">
            {/* Identidad visual (móvil y tablet) */}

            <BmLogo
              variant="lockup"
              className="lg:hidden mb-10 h-auto w-40 sm:w-48 text-[#D42125]"
            />

            <h1 className="bm-heading text-[28px] sm:text-[32px] leading-tight text-[#1B1D22]">
              {isRegistering
                ? 'Solicitud de alta'
                : 'Inicie sesión'}
            </h1>

            <p className="mt-2 mb-8 text-[15px] leading-relaxed text-[#5F6670]">
              {isRegistering
                ? 'Registre sus datos. Administración validará la cuenta y asignará su rol.'
                : 'Sistema de inventario y MRO de B&M Mantenimiento Aeronáutico.'}
            </p>

            {/* Avisos de sesión */}

            {reparado && !error && (
              <Aviso tone="ok">
                La sesión del dispositivo se reparó. Inicie sesión nuevamente.
              </Aviso>
            )}

            {auth.issue === 'SESSION_EXPIRED' && !error && (
              <Aviso tone="warn">
                Su sesión expiró. Inicie sesión nuevamente.
              </Aviso>
            )}

            {notice && <Aviso tone="ok">{notice}</Aviso>}

            {/* Errores */}

            {error && (
              <Aviso tone="error" alert>
                {error}
              </Aviso>
            )}

            {(sessionProblem || showRecovery) && (
              <div className="mb-5">
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

                  <div className="space-y-1.5">
                    <label htmlFor="operator-name" className={labelClass}>
                      Nombre completo
                    </label>

                    <div className="relative">
                      <input
                        id="operator-name"
                        type="text"
                        placeholder="Como aparece en su cédula"
                        required
                        autoComplete="name"
                        value={nombre}
                        className={`${inputClass} uppercase placeholder:normal-case`}
                        onChange={e =>
                          setNombre(e.target.value)
                        }
                      />
                      <User className={fieldIconClass} />
                    </div>
                  </div>

                  {/* Rol y sede */}

                  <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-4 min-[400px]:gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="operator-role" className={labelClass}>
                        Cargo solicitado
                      </label>

                      <div className="relative">
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
                        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5F6670]" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="operator-site" className={labelClass}>
                        Sede
                      </label>

                      <div className="relative">
                        <select
                          id="operator-site"
                          className={selectClass}
                          value={sede}
                          onChange={e =>
                            setSede(e.target.value)
                          }
                        >
                          {SEDES.map(item => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5F6670]" />
                      </div>
                    </div>
                  </div>

                  {rol === 'PLANIFICADOR_VUELO' && (
                    <div className="rounded-xl bg-[#F2F3F5] px-4 py-3.5">
                      <p className="text-sm font-semibold text-[#1B1D22]">
                        Perfil de planificación
                      </p>

                      <p className="mt-1 text-[13px] leading-relaxed text-[#5F6670]">
                        Acceso previsto al hangar en
                        modalidad de consulta y al módulo
                        de planificación de vuelos.
                        Sin permisos de certificación
                        de mantenimiento.
                      </p>
                    </div>
                  )}

                  <p className="text-[13px] leading-relaxed text-[#5F6670]">
                    Los cargos administrativos (administración, dirección y CEO)
                    solo se asignan desde el módulo interno de Alta de Personal.
                  </p>
                </div>
              )}

              {/* Correo */}

              <div className="space-y-1.5">
                <label htmlFor="operator-email" className={labelClass}>
                  Correo corporativo
                </label>

                <div className="relative">
                  <input
                    id="operator-email"
                    type="email"
                    inputMode="email"
                    placeholder="nombre@empresa.com"
                    required
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    className={inputClass}
                    onChange={e =>
                      setEmail(e.target.value)
                    }
                  />
                  <Mail className={fieldIconClass} />
                </div>
              </div>

              {/* Contraseña */}

              <div className="space-y-1.5">
                <label htmlFor="operator-password" className={labelClass}>
                  Contraseña
                </label>

                <div className="relative">
                  <input
                    id="operator-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={
                      isRegistering
                        ? `Mínimo ${NEW_PASSWORD_MIN} caracteres`
                        : 'Su contraseña'
                    }
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
                  <Lock className={fieldIconClass} />

                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={showPassword}
                    className="
                      absolute right-1.5 top-1/2 -translate-y-1/2
                      h-9 w-9 rounded-lg flex items-center justify-center
                      text-[#5F6670] hover:text-[#D42125] hover:bg-[#F2F3F5]
                      transition-colors
                    "
                  >
                    {showPassword
                      ? <EyeOff className="h-4 w-4" />
                      : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {capsLock && (
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#B45309]" role="status">
                    <AlertCircle className="h-3.5 w-3.5" /> Bloq Mayús está activado
                  </p>
                )}
              </div>

              {/* Confirmación de contraseña (solo solicitud de alta) */}

              {isRegistering && (
                <div className="space-y-1.5">
                  <label htmlFor="operator-password-confirm" className={labelClass}>
                    Confirmar contraseña
                  </label>

                  <div className="relative">
                    <input
                      id="operator-password-confirm"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Repita la contraseña"
                      required
                      minLength={NEW_PASSWORD_MIN}
                      autoComplete="new-password"
                      value={confirmPassword}
                      aria-invalid={passwordMismatch}
                      aria-describedby={passwordMismatch ? 'password-mismatch' : undefined}
                      className={`${inputClass} ${passwordMismatch ? 'border-[#D42125]' : ''}`}
                      onKeyDown={detectCaps}
                      onKeyUp={detectCaps}
                      onChange={e =>
                        setConfirmPassword(e.target.value)
                      }
                    />
                    <Lock className={fieldIconClass} />
                  </div>

                  {passwordMismatch && (
                    <p id="password-mismatch" className="text-[13px] font-medium text-[#D42125]">
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
                  !mt-6 w-full h-12 rounded-xl
                  bg-[#D42125] text-white
                  text-[15px] font-semibold
                  inline-flex items-center justify-center gap-2
                  hover:bg-[#A9161B] active:scale-[0.99]
                  transition
                  disabled:cursor-not-allowed disabled:opacity-60
                  disabled:hover:bg-[#D42125] disabled:active:scale-100
                "
              >
                {loading ? (
                  <>
                    <Loader2
                      className="h-5 w-5 animate-spin"
                    />
                    <span>
                      {awaitingSession
                        ? 'Sincronizando sesión'
                        : isRegistering
                          ? 'Enviando solicitud'
                          : 'Verificando'}
                    </span>
                  </>
                ) : isRegistering ? (
                  'Enviar solicitud'
                ) : (
                  'Iniciar sesión'
                )}
              </button>
            </form>

            {/* Cambiar entre registro y login */}

            <div className="mt-8 border-t border-[#E3E5E9] pt-6">
              {isRegistering ? (
                <button
                  type="button"
                  onClick={cambiarModo}
                  className="
                    group inline-flex items-center gap-1.5
                    text-sm font-semibold text-[#1B1D22]
                    hover:text-[#D42125] transition-colors
                  "
                >
                  <ChevronLeft
                    className="
                      h-4 w-4 transition-transform
                      group-hover:-translate-x-0.5
                    "
                  />
                  Volver al inicio de sesión
                </button>
              ) : (
                <p className="text-sm text-[#5F6670]">
                  ¿Personal nuevo?{' '}
                  <button
                    type="button"
                    onClick={cambiarModo}
                    className="font-semibold text-[#D42125] hover:text-[#A9161B] underline-offset-4 hover:underline"
                  >
                    Solicitar alta
                  </button>
                </p>
              )}

              {!isRegistering && !sessionProblem && !showRecovery && (
                <button
                  type="button"
                  onClick={() => setShowRecovery(true)}
                  className="
                    mt-4 inline-flex items-center gap-2
                    text-[13px] text-[#5F6670]
                    hover:text-[#1B1D22] transition-colors
                  "
                >
                  <Wrench className="h-3.5 w-3.5" />
                  ¿Problemas para entrar en este equipo?
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-[#9AA0A8]">
          Valkyron Group, Barquisimeto
        </p>
      </main>
    </div>
  );
};

export default Login;

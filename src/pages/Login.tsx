
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import {
  Mail,
  Lock,
  User,
  Loader2,
  AlertCircle,
  ChevronLeft,
} from 'lucide-react';

// VALKYRON OS — ÁGUILAS PILOT
// LOGIN / ALTA DE PERSONAL
// Nuevo rol: PLANIFICADOR_VUELO
//
// IMPORTANTE:
// El registro debe estar protegido por autorización
// administrativa en Supabase. Los metadatos del usuario
// no constituyen una fuente segura de permisos.

const ROLES = [
  { value: 'MECANICO', label: 'MECÁNICO' },
  { value: 'CAPITAN', label: 'CAPITÁN' },
  {
    value: 'PLANIFICADOR_VUELO',
    label: 'PLANIFICADOR DE VUELO',
  },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'CEO', label: 'CEO' },
] as const;

type Rol = (typeof ROLES)[number]['value'];

const Login: React.FC = () => {
  const navigate = useNavigate();

  const [isRegistering, setIsRegistering] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');

  const [rol, setRol] = useState<Rol>('MECANICO');
  const [sede, setSede] = useState('Lara');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        if (!nombre.trim()) {
          throw new Error('EL NOMBRE DEL OPERADOR ES OBLIGATORIO');
        }

        const { data, error: authError } =
          await supabase.auth.signUp({
            email: email.trim().toLowerCase(),
            password,
            options: {
              data: {
                nombre_completo: nombre.trim().toUpperCase(),
                rol,
                sede,
              },
            },
          });

        if (authError) throw authError;

        if (!data.user) {
          throw new Error(
            'NO SE PUDO COMPLETAR EL REGISTRO DEL OPERADOR'
          );
        }

        // Esta es la solicitud de rol.
        // La autorización efectiva debe validarse
        // mediante una fuente protegida en Supabase.

        alert(
          'REGISTRO PROCESADO.\n' +
            `OPERADOR: ${nombre.trim().toUpperCase()}\n` +
            `ROL SOLICITADO: ${ROLES.find(r => r.value === rol)?.label}\n` +
            `SEDE: ${sede.toUpperCase()}\n\n` +
            'El acceso dependerá de la validación de permisos.'
        );

        setPassword('');
        setIsRegistering(false);
      } else {
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });

        if (authError) throw authError;

        if (!data.user) {
          throw new Error('NO SE PUDO VALIDAR LA SESIÓN');
        }

        // El AuthContext debe obtener el rol autorizado
        // desde la base de datos, no confiar únicamente
        // en user_metadata.

        console.info(
          '[VALKYRON AUTH] Sesión iniciada:',
          data.user.id
        );

        navigate('/', { replace: true });
      }
    } catch (err: unknown) {
      const mensaje =
        err instanceof Error
          ? err.message
          : 'ERROR DESCONOCIDO';

      console.error('[ÁGUILAS PILOT AUTH]', err);

      if (/already registered/i.test(mensaje)) {
        setError('EL USUARIO YA EXISTE EN EL SISTEMA');
      } else if (/credentials/i.test(mensaje)) {
        setError(
          'ACCESO DENEGADO: CREDENCIALES INVÁLIDAS'
        );
      } else {
        setError(mensaje.toUpperCase());
      }
    } finally {
      setLoading(false);
    }
  };

  const cambiarModo = () => {
    setIsRegistering(prev => !prev);
    setError(null);
    setPassword('');
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
              ? 'Alta de Personal'
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
                    Rango
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
                type="password"
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete={
                  isRegistering
                    ? 'new-password'
                    : 'current-password'
                }
                value={password}
                className={inputClass}
                onChange={e =>
                  setPassword(e.target.value)
                }
              />
            </div>
          </div>

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
              <Loader2
                className="h-5 w-5 animate-spin"
              />
            ) : isRegistering ? (
              'Confirmar Alta'
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
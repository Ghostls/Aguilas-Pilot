// src/components/FlightCalendar.tsx
// VALKYRON OS v2.1 — CALENDARIO DEL CAPITÁN · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.1 — REBRAND B&M + CONEXIONES:
//   [FIX] Semanas fuera de orden: al pasar de semana rápido, la respuesta de la
//         semana anterior podía llegar después y pintarse sobre la actual. Se
//         descarta toda lectura que no sea la última (contador de secuencia).
//   [FIX] El realtime filtrado por instructor_id no entrega DELETE ni el UPDATE
//         que reasigna la misión a otro capitán (el filtro se evalúa sobre la
//         fila nueva): la misión quedaba en el calendario del capitán anterior.
//         Recarga silenciosa al volver a la pestaña y cada 2 min si está visible.
//   [FIX] Canal realtime con sufijo único (remontajes reutilizaban un canal ya
//         suscrito).
//   [FIX] Una recarga silenciosa fallida vaciaba la semana; ahora se conservan
//         los vuelos ya cargados y se muestra el error.
//   [FIX] KPI "Hoy · vuelos programados" contaba solicitudes, cancelados y
//         rechazados; "Planificadas" sumaba horas de vuelos cancelados o
//         rechazados. Ahora solo cuentan vuelos activos.
//   [FIX] "Hoy" se calculaba una sola vez al montar: con la pantalla abierta
//         pasada la medianoche seguía marcando el día anterior. Se revisa cada
//         minuto.
//   [FIX] Sin registro de instructor se pintaban siete días "Sin vuelos" debajo
//         del error (vacío falso). Ahora solo se muestra el aviso con Reintentar.
//   [NEW] Estado POSTERGADA con estilo propio (antes caía en el genérico).
//   [NEW] Botón Actualizar.
//   [UI]  B&M: cabecera blanca, KPI con cifras protagonistas, semana en 7
//         columnas desde xl y agenda vertical por día en móvil y tableta (antes
//         una grilla de 1.120 px con desplazamiento lateral). Detalle en BmModal
//         (hoja inferior en móvil, Esc, bloqueo de scroll).
// PRESERVADO: fuente reservas_slot_vuelo filtrada por instructor_id, relación
//   auth → instructores.perfil_id, fechas en horario local, nombres desde
//   perfiles con respaldo en perfiles_estudiantes, estados SOLICITADA /
//   CONFIRMADA / RECHAZADA, reprogramación y nota de Planificación, realtime con
//   debounce, export nombrado y por defecto.
// ─────────────────────────────────────────────────────────────────────────────
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                 OPERACIÓN ÁGUILAS — CALENDARIO CAPITÁN v2.0                 ║
// ║                 VALKYRON OS — FLIGHT OPERATIONS                            ║
// ╠══════════════════════════════════════════════════════════════════════════════╣
// ║ FUENTE REAL: RESERVAS_SLOT_VUELO                                           ║
// ║                                                                            ║
// ║ AUTH                                                                     ║
// ║   └── PERFILES                                                            ║
// ║        └── INSTRUCTORES                                                   ║
// ║             └── RESERVAS_SLOT_VUELO                                      ║
// ║                                                                            ║
// ║ REGLA: El capitán ve los slots donde instructor_id = su instructor.id    ║
// ║                                                                            ║
// ║ NO UTILIZA:                                                               ║
// ║   - bloques_vuelo                                                         ║
// ║   - reservas_vuelo                                                        ║
// ║                                                                            ║
// ║ CORRECCIÓN CRÍTICA:                                                       ║
// ║   Las fechas se procesan en horario LOCAL y no mediante toISOString()    ║
// ║                                                                            ║
// ║ CHANGELOG v2.0:                                                           ║
// ║   [NEW] Integración con Planificación de Vuelo:                          ║
// ║         SOLICITADA = pendiente de planificación (no es misión aún)        ║
// ║         CONFIRMADA = misión asignada por Planificación                    ║
// ║         RECHAZADA  = estilo cancelado                                     ║
// ║   [NEW] Badge "Reprogramado" + motivo/nota de Planificación en detalle   ║
// ║   [NEW] Realtime filtrado por instructor_id (sin recargar pantalla)       ║
// ║   [NEW] KPI "Pend. planificación"                                         ║
// ║   [FIX] Nombres de alumnos: fallback a PERFILES_ESTUDIANTES               ║
// ║         (los cadetes viven ahí, no en PERFILES)                           ║
// ║   [FIX] Recarga silenciosa (sin parpadeo del loader) en eventos realtime  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { supabase } from "@/lib/supabaseClient";

import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Hourglass,
  Loader2,
  Plane,
  Repeat,
  ShieldCheck,
  User,
  X,
  RefreshCw,      // [v2.1]
} from "lucide-react";

import { BmBadge, BmModal, BmNotice, bmBtn } from "./brand/bm-ui";   // [v2.1]

// ══════════════════════════════════════════════════════════════════════════════
// TIPOS
// ══════════════════════════════════════════════════════════════════════════════

interface Instructor {
  id: string;
  perfil_id: string | null;
  nombre_completo: string;
  email_registro: string | null;
  sede: string | null;
  status: string | null;
  created_at: string;
  created_by: string | null;
}

interface Perfil {
  id: string;
  nombre_completo: string | null;
  email_registro: string | null;
  sede: string | null;
}

interface SlotVuelo {
  id: string;

  student_id: string | null;

  aeronave_id: string | null;
  aeronave_matricula: string | null;

  instructor_id: string;

  fecha: string;
  slot_hora: string;

  horas_planificadas: number | null;
  horas_reales: number | null;

  tipo_vuelo: string | null;
  status: string | null;

  motivo_cierre: string | null;
  notas_capitan: string | null;

  // [NEW v2.0] Planificación
  reprogramada: boolean | null;
  motivo_planificacion: string | null;
  fecha_solicitada: string | null;

  created_at: string;
}

interface StudentNameMap {
  [key: string]: string;
}

interface FlightCalendarProps {
  userRole?: string;

  userProfile?: {
    nombre_completo: string;
    sede: string;
    rol: string;
  } | null;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════════════════════════════════════

const DAYS_ES = [
  "Dom",
  "Lun",
  "Mar",
  "Mié",
  "Jue",
  "Vie",
  "Sáb",
];

const MONTHS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// [NEW v2.1] Estados que no son vuelos activos (no cuentan en KPI de agenda)
const ESTADOS_INACTIVOS = new Set([
  "CANCELADA",
  "CANCELADO",
  "RECHAZADA",
  "RECHAZADO",
  "POSTERGADA",
  "POSTERGADO",
]);

// [NEW v2.1] Respaldo del realtime filtrado
const AUTO_REFRESH_MS = 2 * 60 * 1000;

// ══════════════════════════════════════════════════════════════════════════════
// FECHAS — IMPORTANTE: NO usar toISOString() para obtener YYYY-MM-DD
// ══════════════════════════════════════════════════════════════════════════════

const pad = (value: number): string =>
  String(value).padStart(2, "0");

const toYMD = (date: Date): string => {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
};

const parseYMD = (ymd: string): Date => {
  const [year, month, day] = ymd.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0,
    0
  );
};

const startOfWeek = (date: Date): Date => {
  const d = new Date(date);

  const day = d.getDay();

  d.setDate(d.getDate() - day);

  d.setHours(12, 0, 0, 0);

  return d;
};

const addDays = (
  date: Date,
  amount: number
): Date => {
  const d = new Date(date);

  d.setDate(d.getDate() + amount);

  return d;
};

const formatHour = (value: string | null | undefined): string => {
  if (!value) return "--:--";

  return value.slice(0, 5);
};

const formatDateLong = (ymd: string): string => {
  const date = parseYMD(ymd);

  return `${DAYS_ES[date.getDay()]} ${date.getDate()} de ${
    MONTHS_ES[date.getMonth()]
  }`;
};

const formatDateShort = (ymd: string): string => {
  const date = parseYMD(ymd);

  return `${date.getDate()}/${pad(date.getMonth() + 1)}`;
};

// ══════════════════════════════════════════════════════════════════════════════
// ESTADOS
// ══════════════════════════════════════════════════════════════════════════════

// [v2.1] Paleta B&M: confirmada en rojo de marca, completada en verde,
// solicitud en azul con borde punteado, postergada en ocre, cancelada atenuada.
const getStatusStyle = (status: string | null) => {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  switch (normalized) {
    case "CONFIRMADA":
    case "CONFIRMADO":
    case "PROGRAMADA":
    case "PROGRAMADO":
      return {
        wrapper:
          "border-bm-line border-l-[3px] border-l-bm-red bg-white",
        badge:
          "bg-bm-red-tint text-bm-red-deep",
        dot: "bg-bm-red",
      };

    case "COMPLETADA":
    case "COMPLETADO":
      return {
        wrapper:
          "border-bm-line border-l-[3px] border-l-bm-ok bg-white",
        badge:
          "bg-bm-ok-tint text-bm-ok",
        dot: "bg-bm-ok",
      };

    case "CANCELADA":
    case "CANCELADO":
    case "RECHAZADA":            // [NEW v2.0]
      return {
        wrapper:
          "border-bm-line bg-bm-canvas opacity-80",
        badge:
          "bg-white text-bm-red-deep ring-1 ring-inset ring-bm-red/20",
        dot: "bg-bm-hint",
      };

    case "POSTERGADA":           // [NEW v2.1]
    case "POSTERGADO":
      return {
        wrapper:
          "border-bm-line border-l-[3px] border-l-bm-warn bg-white",
        badge:
          "bg-bm-warn-tint text-bm-warn",
        dot: "bg-bm-warn",
      };

    case "PENDIENTE":
    case "SOLICITADA":           // [NEW v2.0] aún no confirmada por Planificación
      return {
        wrapper:
          "border-dashed border-[#2F5BB7]/45 bg-[#F6F8FD]",
        badge:
          "bg-[#E8EEF9] text-[#2F5BB7]",
        dot: "bg-[#2F5BB7]",
      };

    default:
      return {
        wrapper:
          "border-bm-line bg-white",
        badge:
          "bg-bm-canvas text-bm-steel",
        dot: "bg-bm-hint",
      };
  }
};

const getStatusLabel = (
  status: string | null
): string => {
  if (!status) return "SIN ESTADO";

  // [NEW v2.0]
  if (status.toUpperCase() === "SOLICITADA") return "Pend. planificación";

  // [v2.1] tipo oración (B&M): "COMPLETADA" → "Completada"
  const texto = status
    .replace(/_/g, " ")
    .toLowerCase();

  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const getTipoStyle = (tipo: string | null) => {
  const value = String(tipo ?? "")
    .trim()
    .toUpperCase();

  if (value === "SOLO") {
    return "bg-[#E8EEF9] text-[#2F5BB7]";
  }

  if (value === "DUAL") {
    return "bg-[#F1ECFB] text-[#6D28D9]";
  }

  return "bg-bm-canvas text-bm-steel";
};

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE
// ══════════════════════════════════════════════════════════════════════════════

export const FlightCalendar: React.FC<
  FlightCalendarProps
> = ({
  userRole = "CAPITAN",
  userProfile,
}) => {
  const rol = userRole
    .toUpperCase()
    .trim();

  const isCaptain = [
    "CAPITAN",
    "CAPITÁN",
    "INSTRUCTOR",
  ].includes(rol);

  // ────────────────────────────────────────────────────────────────────────────
  // SEMANA
  // ────────────────────────────────────────────────────────────────────────────

  const [weekStart, setWeekStart] = useState<Date>(
    () => startOfWeek(new Date())
  );

  const weekDays = useMemo(() => {
    return Array.from(
      { length: 7 },
      (_, index) =>
        addDays(weekStart, index)
    );
  }, [weekStart]);

  // [FIX v2.1] "Hoy" se revisa cada minuto (antes se fijaba al montar)
  const [todayYMD, setTodayYMD] = useState<string>(
    () => toYMD(new Date())
  );

  useEffect(() => {
    const id = setInterval(() => {
      const t = toYMD(new Date());
      setTodayYMD((prev) => (prev === t ? prev : t));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // DATA
  // ────────────────────────────────────────────────────────────────────────────

  const [userId, setUserId] =
    useState<string | null>(null);

  const [instructor, setInstructor] =
    useState<Instructor | null>(null);

  const [slots, setSlots] =
    useState<SlotVuelo[]>([]);

  const [studentNames, setStudentNames] =
    useState<StudentNameMap>({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] =
    useState<SlotVuelo | null>(null);

  // [NEW v2.0] debounce realtime
  const realtimeDebounce =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // [NEW v2.1] contador de lecturas: solo la última pinta
  const slotsSeq = useRef(0);

  // ────────────────────────────────────────────────────────────────────────────
  // AUTENTICACIÓN + INSTRUCTOR
  // ────────────────────────────────────────────────────────────────────────────

  const initializeCaptain = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      try {
        const {
          data: authData,
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          throw new Error(
            `AUTH: ${authError.message}`
          );
        }

        const user = authData.user;

        if (!user) {
          throw new Error(
            "No existe una sesión autenticada."
          );
        }

        setUserId(user.id);

        // ══════════════════════════════════════════════════════════════════════
        // AUTH → INSTRUCTORES
        //
        // La relación definida para Operación Águilas es:
        //
        // instructores.perfil_id → perfiles.id
        //
        // y el perfil corresponde al usuario autenticado.
        // ══════════════════════════════════════════════════════════════════════

        const {
          data: instructorData,
          error: instructorError,
        } = await supabase
          .from("instructores")
          .select(`
            id,
            perfil_id,
            nombre_completo,
            email_registro,
            sede,
            status,
            created_at,
            created_by
          `)
          .eq("perfil_id", user.id)
          .maybeSingle();

        if (instructorError) {
          throw new Error(
            `INSTRUCTOR: ${instructorError.message}`
          );
        }

        if (!instructorData) {
          throw new Error(
            "El usuario autenticado no tiene un registro en INSTRUCTORES."
          );
        }

        setInstructor(
          instructorData as Instructor
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Error inicializando calendario.";

        console.error(
          "[B&M CALENDAR]",
          message
        );

        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    initializeCaptain();
  }, [initializeCaptain]);

  // ══════════════════════════════════════════════════════════════════════════════
  // CARGAR SLOTS DEL CAPITÁN
  //
  // TABLA:
  //     reservas_slot_vuelo
  //
  // FILTRO:
  //     instructor_id = instructor.id
  //
  // ESTO ES LO QUE HACE QUE APAREZCAN LOS VUELOS DEL CAPITÁN.
  // [CHG v2.0] silent=true → recarga sin loader (eventos realtime)
  // ══════════════════════════════════════════════════════════════════════════════

  const fetchSlots = useCallback(
    async (silent = false) => {
      if (!instructor?.id) {
        return;
      }

      const seq = ++slotsSeq.current;   // [v2.1]

      if (!silent) setLoading(true);
      setError(null);

      const desde = toYMD(
        weekDays[0]
      );

      const hasta = toYMD(
        weekDays[6]
      );

      try {
        const {
          data,
          error: slotsError,
        } = await supabase
          .from("reservas_slot_vuelo")
          .select(`
            id,
            student_id,
            aeronave_id,
            aeronave_matricula,
            instructor_id,
            fecha,
            slot_hora,
            horas_planificadas,
            horas_reales,
            tipo_vuelo,
            status,
            motivo_cierre,
            notas_capitan,
            reprogramada,
            motivo_planificacion,
            fecha_solicitada,
            created_at
          `)
          .eq(
            "instructor_id",
            instructor.id
          )
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", {
            ascending: true,
          })
          .order("slot_hora", {
            ascending: true,
          });

        if (slotsError) {
          throw new Error(
            `RESERVAS_SLOT_VUELO: ${slotsError.message}`
          );
        }

        if (seq !== slotsSeq.current) return;   // [v2.1] semana ya cambió

        const normalizedSlots =
          (data ?? []).map((row: any) => ({
            ...row,
            horas_planificadas:
              row.horas_planificadas !== null
                ? Number(row.horas_planificadas)
                : null,
            horas_reales:
              row.horas_reales !== null
                ? Number(row.horas_reales)
                : null,
            reprogramada: !!row.reprogramada,
          })) as SlotVuelo[];

        setSlots(normalizedSlots);

        // ══════════════════════════════════════════════════════════════════════
        // CARGAR NOMBRES DE ALUMNOS
        //
        // Se intenta resolver student_id contra PERFILES.
        // [FIX v2.0] Los faltantes se buscan en PERFILES_ESTUDIANTES.
        // Si no existe el registro, se muestra el UUID.
        // ══════════════════════════════════════════════════════════════════════

        const studentIds = Array.from(
          new Set(
            normalizedSlots
              .map(
                (slot) =>
                  slot.student_id
              )
              .filter(
                (
                  id
                ): id is string =>
                  Boolean(id)
              )
          )
        );

        if (studentIds.length > 0) {
          const map: StudentNameMap =
            {};

          const {
            data: perfilesData,
            error: perfilesError,
          } = await supabase
            .from("perfiles")
            .select(
              "id,nombre_completo,email_registro,sede"
            )
            .in(
              "id",
              studentIds
            );

          if (!perfilesError) {
            (
              perfilesData as Perfil[] | null
            )?.forEach(
              (perfil) => {
                map[perfil.id] =
                  perfil.nombre_completo ||
                  perfil.email_registro ||
                  perfil.id;
              }
            );
          }

          // [FIX v2.0] fallback cadetes
          const faltantes = studentIds.filter(
            (id) => !map[id]
          );

          if (faltantes.length > 0) {
            const {
              data: estData,
              error: estError,
            } = await supabase
              .from("perfiles_estudiantes")
              .select("id,nombre_completo,email_registro")
              .in("id", faltantes);

            if (!estError) {
              (estData ?? []).forEach(
                (e: any) => {
                  map[e.id] =
                    e.nombre_completo ||
                    e.email_registro ||
                    e.id;
                }
              );
            }
          }

          if (seq !== slotsSeq.current) return;   // [v2.1]

          setStudentNames(map);
        } else {
          setStudentNames({});
        }
      } catch (err: unknown) {
        if (seq !== slotsSeq.current) return;   // [v2.1]

        const message =
          err instanceof Error
            ? err.message
            : "Error cargando vuelos.";

        console.error(
          "[B&M CALENDAR SLOT ERROR]",
          message
        );

        setError(message);
        // [FIX v2.1] una recarga silenciosa fallida conserva lo ya cargado
        if (!silent) setSlots([]);
      } finally {
        if (seq === slotsSeq.current) setLoading(false);
      }
    },
    [
      instructor?.id,
      weekDays,
    ]
  );

  useEffect(() => {
    if (instructor?.id) {
      fetchSlots();
    }
  }, [
    instructor?.id,
    fetchSlots,
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // [NEW v2.0] REALTIME — Planificación confirma/reprograma → aparece al instante
  // ══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!instructor?.id) return;

    const channel = supabase
      .channel(`captain-calendar-${instructor.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`)   // [v2.1] nombre único
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservas_slot_vuelo",
          filter: `instructor_id=eq.${instructor.id}`,
        },
        () => {
          if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
          realtimeDebounce.current = setTimeout(() => fetchSlots(true), 500);
        }
      )
      .subscribe();

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      supabase.removeChannel(channel);
    };
  }, [instructor?.id, fetchSlots]);

  // ══════════════════════════════════════════════════════════════════════════════
  // [NEW v2.1] RESPALDO DEL REALTIME — reasignaciones a otro capitán y borrados
  // no llegan por el canal filtrado: se recarga al volver a la pestaña y cada 2 min
  // ══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!instructor?.id) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") fetchSlots(true);
    };

    document.addEventListener("visibilitychange", onVisible);

    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchSlots(true);
    }, AUTO_REFRESH_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [instructor?.id, fetchSlots]);

  // ══════════════════════════════════════════════════════════════════════════════
  // AGRUPACIÓN POR DÍA
  // ══════════════════════════════════════════════════════════════════════════════

  const slotsPorDia = useMemo(() => {
    const map =
      new Map<
        string,
        SlotVuelo[]
      >();

    weekDays.forEach(
      (day) => {
        map.set(
          toYMD(day),
          []
        );
      }
    );

    slots.forEach((slot) => {
      const current =
        map.get(slot.fecha) ?? [];

      current.push(slot);

      current.sort(
        (a, b) =>
          String(
            a.slot_hora
          ).localeCompare(
            String(
              b.slot_hora
            )
          )
      );

      map.set(
        slot.fecha,
        current
      );
    });

    return map;
  }, [
    slots,
    weekDays,
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // ESTADÍSTICAS
  // ══════════════════════════════════════════════════════════════════════════════

  const stats = useMemo(() => {
    const total =
      slots.length;

    // [FIX v2.1] solo vuelos activos (sin solicitudes, cancelados ni rechazados)
    const hoy =
      slots.filter(
        (slot) => {
          const s = String(slot.status ?? "").toUpperCase();
          return (
            slot.fecha === todayYMD &&
            !ESTADOS_INACTIVOS.has(s) &&
            s !== "SOLICITADA"
          );
        }
      ).length;

    const programadas =
      slots.filter((slot) => {
        const s =
          String(
            slot.status ?? ""
          ).toUpperCase();

        return (
          s === "CONFIRMADA" ||
          s === "CONFIRMADO" ||
          s === "PROGRAMADA" ||
          s === "PROGRAMADO" ||
          s === "PENDIENTE"
        );
      }).length;

    const completadas =
      slots.filter((slot) => {
        const s =
          String(
            slot.status ?? ""
          ).toUpperCase();

        return (
          s === "COMPLETADA" ||
          s === "COMPLETADO"
        );
      }).length;

    // [NEW v2.0]
    const pendientesPlan =
      slots.filter(
        (slot) =>
          String(slot.status ?? "").toUpperCase() === "SOLICITADA"
      ).length;

    // [FIX v2.1] sin horas de vuelos cancelados, rechazados o postergados
    const horasPlanificadas =
      slots
        .filter(
          (slot) =>
            !ESTADOS_INACTIVOS.has(String(slot.status ?? "").toUpperCase())
        )
        .reduce(
          (sum, slot) =>
            sum +
            (Number(
              slot.horas_planificadas
            ) || 0),
          0
        );

    const horasReales =
      slots.reduce(
        (sum, slot) =>
          sum +
          (Number(
            slot.horas_reales
          ) || 0),
        0
      );

    return {
      total,
      hoy,
      programadas,
      completadas,
      pendientesPlan,
      horasPlanificadas,
      horasReales,
    };
  }, [
    slots,
    todayYMD,
  ]);

  // ══════════════════════════════════════════════════════════════════════════════
  // NAVEGACIÓN
  // ══════════════════════════════════════════════════════════════════════════════

  const previousWeek = () => {
    setWeekStart(
      (prev) =>
        addDays(
          prev,
          -7
        )
    );
  };

  const nextWeek = () => {
    setWeekStart(
      (prev) =>
        addDays(
          prev,
          7
        )
    );
  };

  const goToday = () => {
    setWeekStart(
      startOfWeek(
        new Date()
      )
    );
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // HEADER DE SEMANA
  // ══════════════════════════════════════════════════════════════════════════════

  const weekLabel = useMemo(() => {
    const first =
      weekDays[0];

    const last =
      weekDays[6];

    if (
      first.getMonth() ===
      last.getMonth()
    ) {
      return `${first.getDate()} – ${last.getDate()} ${
        MONTHS_ES[
          first.getMonth()
        ]
      } ${first.getFullYear()}`;
    }

    return `${first.getDate()} ${
      MONTHS_ES[
        first.getMonth()
      ]
    } – ${last.getDate()} ${
      MONTHS_ES[
        last.getMonth()
      ]
    } ${last.getFullYear()}`;
  }, [weekDays]);

  // ══════════════════════════════════════════════════════════════════════════════
  // NOMBRE DEL ALUMNO
  // ══════════════════════════════════════════════════════════════════════════════

  const getStudentName = (
    studentId: string | null
  ) => {
    if (!studentId) {
      return "ALUMNO NO ASIGNADO";
    }

    return (
      studentNames[
        studentId
      ] ??
      `ALUMNO · ${studentId.slice(
        0,
        8
      )}`
    );
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // [NEW v2.1] ACTUALIZACIÓN MANUAL Y TARJETA DE SLOT B&M
  // ══════════════════════════════════════════════════════════════════════════════

  const [refreshing, setRefreshing] =
    useState(false);

  const refrescar = async () => {
    if (!instructor?.id) {
      await initializeCaptain();
      return;
    }
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchSlots(true);
    } finally {
      setRefreshing(false);
    }
  };

  const esSolicitada = (slot: SlotVuelo) =>
    String(slot.status ?? "").toUpperCase() === "SOLICITADA";

  const esInactiva = (slot: SlotVuelo) =>
    ESTADOS_INACTIVOS.has(String(slot.status ?? "").toUpperCase());

  const renderSlot = (slot: SlotVuelo) => {
    const style = getStatusStyle(slot.status);
    const tipoStyle = getTipoStyle(slot.tipo_vuelo);
    const inactiva = esInactiva(slot);

    return (
      <button
        key={slot.id}
        type="button"
        onClick={() => setSelectedSlot(slot)}
        aria-label={`Vuelo de las ${formatHour(slot.slot_hora)}, ${slot.aeronave_matricula || "aeronave sin asignar"}, ${getStudentName(slot.student_id)}, ${getStatusLabel(slot.status)}`}
        className={`w-full rounded-2xl border p-3 text-left transition-[border-color,box-shadow] hover:border-bm-red/50 hover:shadow-[0_6px_18px_rgba(27,29,34,0.08)] ${style.wrapper}`}
      >
        {/* Hora + estado */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <span className="flex items-center gap-1.5">
            {esSolicitada(slot) ? (
              <Hourglass className="h-3.5 w-3.5 text-[#2F5BB7]" />
            ) : (
              <Clock3 className="h-3.5 w-3.5 text-bm-red" />
            )}
            <span className={`bm-num text-sm font-semibold ${inactiva ? "text-bm-steel line-through" : "text-bm-ink"}`}>
              {formatHour(slot.slot_hora)}
            </span>
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight ${style.badge}`}>
            {getStatusLabel(slot.status)}
          </span>
        </div>

        {/* Aeronave */}
        <p className="mt-2 flex items-center gap-1.5 text-[13px]">
          <Plane className="h-3.5 w-3.5 shrink-0 text-bm-hint" />
          <span className="truncate font-data font-medium text-bm-ink">
            {slot.aeronave_matricula || "Aeronave S/N"}
          </span>
        </p>

        {/* Alumno */}
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-bm-steel">
          <User className="h-3.5 w-3.5 shrink-0 text-bm-hint" />
          <span className="truncate">{getStudentName(slot.student_id)}</span>
        </p>

        {/* Tipo + horas */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5">
          <span className="flex flex-wrap items-center gap-1">
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tipoStyle}`}>
              {slot.tipo_vuelo || "Vuelo"}
            </span>
            {/* [NEW v2.0] */}
            {slot.reprogramada && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-bm-warn-tint px-1.5 py-0.5 text-[11px] font-medium text-bm-warn">
                <Repeat className="h-3 w-3" /> Reprog.
              </span>
            )}
          </span>
          <span className="bm-num text-xs text-bm-steel">
            {Number(slot.horas_planificadas || 0).toFixed(1)} h
          </span>
        </div>
      </button>
    );
  };

  const kpis: {
    label: string;
    value: string;
    sub: React.ReactNode;
    icon: React.ReactNode;
    tone: string;
    valueCls?: string;
  }[] = [
    {
      label: "Hoy",
      value: String(stats.hoy),
      sub: "vuelos programados",
      icon: <CalendarDays className="h-[18px] w-[18px]" />,
      tone: "bg-bm-red-tint text-bm-red",
      valueCls: "text-bm-red",
    },
    {
      label: "Semana",
      value: String(stats.total),
      sub: (
        <>
          slots registrados
          {stats.pendientesPlan > 0 && (
            <span className="text-[#2F5BB7]"> · {stats.pendientesPlan} pend. planificación</span>
          )}
        </>
      ),
      icon: <Plane className="h-[18px] w-[18px]" />,
      tone: "bg-bm-canvas text-bm-ink",
    },
    {
      label: "Planificadas",
      value: `${stats.horasPlanificadas.toFixed(1)} h`,
      sub: "horas de vuelo",
      icon: <Clock3 className="h-[18px] w-[18px]" />,
      tone: "bg-bm-canvas text-bm-ink",
    },
    {
      label: "Completadas",
      value: String(stats.completadas),
      sub: "vuelos finalizados",
      icon: <ShieldCheck className="h-[18px] w-[18px]" />,
      tone: "bg-bm-ok-tint text-bm-ok",
      valueCls: "text-bm-ok",
    },
  ];

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* ═══════════════════════════════════════════════════════════════════════
          CABECERA
      ═══════════════════════════════════════════════════════════════════════ */}

      <div className="rounded-[24px] border border-bm-line bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">

          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
              <CalendarDays className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="bm-heading text-lg leading-tight sm:text-xl">Calendario de vuelo</h2>
                <ShieldCheck className="h-4 w-4 text-bm-hint" aria-hidden="true" />
              </div>
              <p className="mt-0.5 text-[13px] text-bm-steel">
                Agenda del capitán · misiones de Planificación de vuelo
              </p>
              {instructor && (
                <p className="mt-1 truncate text-[13px] font-medium text-bm-ink">
                  {instructor.nombre_completo}
                  {" · "}
                  {instructor.sede ?? "Sede no definida"}
                </p>
              )}
            </div>
          </div>

          {/* Navegación */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full min-w-0 items-center justify-between rounded-2xl border border-bm-line bg-bm-canvas p-1 sm:w-auto">
              <button
                type="button"
                onClick={previousWeek}
                aria-label="Semana anterior"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-bm-steel transition-colors hover:bg-white hover:text-bm-ink"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 px-3 text-center sm:min-w-[210px]">
                <p className="text-[11px] text-bm-steel">Semana operacional</p>
                <p className="bm-num truncate text-sm font-semibold" aria-live="polite">{weekLabel}</p>
              </div>
              <button
                type="button"
                onClick={nextWeek}
                aria-label="Semana siguiente"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-bm-steel transition-colors hover:bg-white hover:text-bm-ink"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <button type="button" onClick={goToday} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1 sm:!h-12 sm:flex-none`}>
              Hoy
            </button>

            <button
              type="button"
              onClick={() => void refrescar()}
              disabled={refreshing}
              aria-label="Actualizar calendario"
              title="Actualizar"
              className={`${bmBtn.icon} sm:h-12 sm:w-12`}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ERROR
      ═══════════════════════════════════════════════════════════════════════ */}

      {error && (
        <BmNotice tone="danger" role="alert" icon={<AlertTriangle className="h-4 w-4" />}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="font-semibold">
                {instructor ? "No se pudieron cargar los vuelos de la semana" : "Calendario no disponible"}
              </p>
              <p className="mt-0.5 break-words font-data text-xs">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => void (instructor ? fetchSlots() : initializeCaptain())}
              className={`${bmBtn.secondary} ${bmBtn.sm} shrink-0`}
            >
              <RefreshCw className="h-4 w-4" /> Reintentar
            </button>
          </div>
        </BmNotice>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PANEL DE ESTADÍSTICAS
      ═══════════════════════════════════════════════════════════════════════ */}

      {instructor && !loading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col gap-2.5 rounded-[20px] border border-bm-line bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-bm-steel">{k.label}</span>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${k.tone}`}>{k.icon}</span>
              </div>
              <p className={`bm-figure text-[28px] ${k.valueCls ?? "text-bm-ink"}`}>{k.value}</p>
              <p className="text-xs leading-snug text-bm-steel">{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          LOADING
      ═══════════════════════════════════════════════════════════════════════ */}

      {loading ? (
        <div aria-busy="true" aria-label="Sincronizando calendario" className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="bm-skeleton h-[118px] rounded-[20px]" />)}
          </div>
          <div className="bm-skeleton h-[320px] rounded-[24px]" />
          <p className="flex items-center justify-center gap-2 py-2 text-sm text-bm-steel">
            <Loader2 className="h-4 w-4 animate-spin text-bm-red" /> Sincronizando agenda…
          </p>
        </div>
      ) : instructor ? (
        <>
          {/* ════════════════════════════════════════════════════════════════
             CALENDARIO SEMANAL (xl+): 7 columnas sin desplazamiento lateral
          ════════════════════════════════════════════════════════════════ */}

          <div className="hidden grid-cols-7 gap-2 xl:grid">
            {weekDays.map((day) => {
              const ymd = toYMD(day);
              const daySlots = slotsPorDia.get(ymd) ?? [];
              const isToday = ymd === todayYMD;

              return (
                <div key={ymd} className="flex min-w-0 flex-col gap-2">
                  {/* Cabecera del día */}
                  <div className={`rounded-2xl border p-3 ${isToday ? "border-bm-red/40 bg-bm-red-tint" : "border-bm-line bg-white"}`}>
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-medium ${isToday ? "text-bm-red" : "text-bm-steel"}`}>
                        {DAYS_ES[day.getDay()]}
                      </p>
                      {isToday && (
                        <span className="rounded-full bg-bm-red px-1.5 py-0.5 text-[10px] font-semibold text-white">Hoy</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-end justify-between">
                      <p className={`bm-figure text-[30px] ${isToday ? "text-bm-red" : "text-bm-ink"}`}>{day.getDate()}</p>
                      <p className="text-[11px] text-bm-hint">{MONTHS_ES[day.getMonth()].slice(0, 3)}</p>
                    </div>
                  </div>

                  {/* Slots */}
                  {daySlots.length === 0 ? (
                    <div className="flex h-[92px] flex-col items-center justify-center rounded-2xl border border-dashed border-bm-line p-4 text-center">
                      <CalendarDays className="h-4 w-4 text-bm-field" />
                      <p className="mt-1.5 text-[11px] text-bm-hint">Sin vuelos</p>
                    </div>
                  ) : (
                    daySlots.map((slot) => renderSlot(slot))
                  )}
                </div>
              );
            })}
          </div>

          {/* ════════════════════════════════════════════════════════════════
             AGENDA (móvil y tableta): un bloque por día, sin scroll lateral
          ════════════════════════════════════════════════════════════════ */}

          <ol className="space-y-2.5 xl:hidden" aria-label={`Agenda de la semana ${weekLabel}`}>
            {weekDays.map((day) => {
              const ymd = toYMD(day);
              const daySlots = slotsPorDia.get(ymd) ?? [];
              const isToday = ymd === todayYMD;

              return (
                <li key={ymd} className={`rounded-[20px] border bg-white p-3 sm:p-4 ${isToday ? "border-bm-red/40" : "border-bm-line"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl ${isToday ? "bg-bm-red text-white" : "bg-bm-canvas text-bm-ink"}`}>
                      <span className="text-[10px] font-medium leading-none">{DAYS_ES[day.getDay()]}</span>
                      <span className="bm-figure mt-0.5 text-xl">{day.getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {formatDateLong(ymd)}
                        {isToday && <span className="font-medium text-bm-red"> · hoy</span>}
                      </p>
                      <p className="text-[13px] text-bm-steel">
                        {daySlots.length === 0 ? "Sin vuelos" : daySlots.length === 1 ? "1 vuelo" : `${daySlots.length} vuelos`}
                      </p>
                    </div>
                  </div>
                  {daySlots.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {daySlots.map((slot) => renderSlot(slot))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {/* ═══════════════════════════════════════════════════════════════════════
          RESUMEN OPERACIONAL
      ═══════════════════════════════════════════════════════════════════════ */}

      {!loading && slots.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[20px] border border-bm-line bg-white p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold">Control operacional</p>
            <p className="mt-0.5 text-[13px] text-bm-steel">
              Agenda vinculada al instructor <span className="font-data">#{instructor?.id.slice(0, 8)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <BmBadge tone="neutral">Programados <span className="bm-num ml-1 font-semibold text-bm-ink">{stats.programadas}</span></BmBadge>
            {/* [NEW v2.0] */}
            <BmBadge tone="info">Pend. planificación <span className="bm-num ml-1 font-semibold">{stats.pendientesPlan}</span></BmBadge>
            <BmBadge tone="ok">Reales <span className="bm-num ml-1 font-semibold">{stats.horasReales.toFixed(1)} h</span></BmBadge>
            <BmBadge tone="danger">Slots <span className="bm-num ml-1 font-semibold">{stats.total}</span></BmBadge>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL DETALLE DEL VUELO (BmModal: Esc, fondo y bloqueo de scroll)
      ═══════════════════════════════════════════════════════════════════════ */}

      <BmModal
        open={!!selectedSlot}
        onClose={() => setSelectedSlot(null)}
        title="Detalle de vuelo"
        subtitle={selectedSlot ? `${formatDateLong(selectedSlot.fecha)} · ${formatHour(selectedSlot.slot_hora)}` : undefined}
        icon={<Plane className="h-5 w-5" />}
        tone="danger"
        size="md"
      >
        {selectedSlot && (
          <div className="space-y-4">

            {/* [NEW v2.0] Aviso pendiente de planificación */}
            {esSolicitada(selectedSlot) && (
              <BmNotice tone="info" icon={<Hourglass className="h-4 w-4" />}>
                Solicitud aún no confirmada por Planificación de vuelo. Puede cambiar de capitán, aeronave u horario.
              </BmNotice>
            )}

            {/* Fecha / hora */}
            <div className="flex items-start justify-between gap-4 rounded-2xl bg-bm-canvas p-4">
              <div className="min-w-0">
                <p className="text-xs text-bm-steel">Fecha</p>
                <p className="mt-1 text-[15px] font-semibold">{formatDateLong(selectedSlot.fecha)}</p>
                {/* [NEW v2.0] */}
                {selectedSlot.reprogramada && selectedSlot.fecha_solicitada && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-bm-warn">
                    <Repeat className="h-3 w-3" /> Solicitado originalmente el {formatDateShort(selectedSlot.fecha_solicitada)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-bm-steel">Slot</p>
                <p className="bm-figure mt-1 text-[28px] text-bm-red">{formatHour(selectedSlot.slot_hora)}</p>
              </div>
            </div>

            {/* Información */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-bm-line p-3.5">
                <p className="text-xs text-bm-steel">Aeronave</p>
                <p className="mt-1.5 flex items-center gap-2 text-sm">
                  <Plane className="h-4 w-4 text-bm-red" />
                  <span className="font-data font-semibold">{selectedSlot.aeronave_matricula || "S/N"}</span>
                </p>
              </div>
              <div className="rounded-2xl border border-bm-line p-3.5">
                <p className="text-xs text-bm-steel">Tipo</p>
                <p className="mt-1.5 text-sm font-semibold">{selectedSlot.tipo_vuelo || "No definido"}</p>
              </div>
              <div className="col-span-2 rounded-2xl border border-bm-line p-3.5">
                <p className="text-xs text-bm-steel">Alumno</p>
                <p className="mt-1.5 flex items-center gap-2 text-sm">
                  <User className="h-4 w-4 text-bm-hint" />
                  <span className="font-semibold">{getStudentName(selectedSlot.student_id)}</span>
                </p>
              </div>
            </div>

            {/* Horas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-bm-line p-3.5">
                <p className="text-xs text-bm-steel">Horas planificadas</p>
                <p className="bm-figure mt-1.5 text-[26px]">
                  {Number(selectedSlot.horas_planificadas || 0).toFixed(1)}
                  <span className="ml-1 text-sm not-italic text-bm-steel">h</span>
                </p>
              </div>
              <div className="rounded-2xl border border-bm-line p-3.5">
                <p className="text-xs text-bm-steel">Horas reales</p>
                <p className="bm-figure mt-1.5 text-[26px] text-bm-ok">
                  {Number(selectedSlot.horas_reales || 0).toFixed(1)}
                  <span className="ml-1 text-sm not-italic text-bm-steel">h</span>
                </p>
              </div>
            </div>

            {/* Estado */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-bm-line p-3.5">
              <span className="flex items-center gap-2.5 text-sm text-bm-steel">
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${getStatusStyle(selectedSlot.status).dot}`} />
                Estado operacional
              </span>
              <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getStatusStyle(selectedSlot.status).badge}`}>
                {getStatusLabel(selectedSlot.status)}
              </span>
            </div>

            {/* [NEW v2.0] Nota de Planificación */}
            {selectedSlot.motivo_planificacion && (
              <div className="rounded-2xl bg-bm-warn-tint p-3.5">
                <p className="text-xs font-semibold text-bm-warn">Nota de Planificación</p>
                <p className="mt-1 text-sm text-[#7C2D12]">{selectedSlot.motivo_planificacion}</p>
              </div>
            )}

            {/* Notas del capitán */}
            {selectedSlot.notas_capitan && (
              <div className="rounded-2xl border border-bm-line p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-bm-steel">
                  <FileText className="h-3.5 w-3.5 text-bm-red" /> Notas del capitán
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">{selectedSlot.notas_capitan}</p>
              </div>
            )}

            {/* Motivo cierre */}
            {selectedSlot.motivo_cierre && (
              <div className="rounded-2xl bg-bm-red-tint p-3.5">
                <p className="text-xs font-semibold text-bm-red-deep">Motivo de cierre</p>
                <p className="mt-1 text-sm text-bm-red-deep">{selectedSlot.motivo_cierre}</p>
              </div>
            )}

            <button type="button" onClick={() => setSelectedSlot(null)} className={`${bmBtn.secondary} w-full`}>
              Cerrar detalle
            </button>
          </div>
        )}
      </BmModal>

    </div>
  );
};

export default FlightCalendar;

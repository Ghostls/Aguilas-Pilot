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
} from "lucide-react";

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
          "border-[#E1AD01]/30 bg-[#E1AD01]/[0.06]",
        badge:
          "text-[#E1AD01] bg-[#E1AD01]/10 border-[#E1AD01]/20",
        dot: "bg-[#E1AD01]",
      };

    case "COMPLETADA":
    case "COMPLETADO":
      return {
        wrapper:
          "border-emerald-500/25 bg-emerald-500/[0.05]",
        badge:
          "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
        dot: "bg-emerald-400",
      };

    case "CANCELADA":
    case "CANCELADO":
    case "RECHAZADA":            // [NEW v2.0]
      return {
        wrapper:
          "border-red-500/20 bg-red-500/[0.04] opacity-70",
        badge:
          "text-red-400 bg-red-400/10 border-red-400/20",
        dot: "bg-red-400",
      };

    case "PENDIENTE":
    case "SOLICITADA":           // [NEW v2.0] aún no confirmada por Planificación
      return {
        wrapper:
          "border-blue-500/20 bg-blue-500/[0.04] border-dashed opacity-80",
        badge:
          "text-blue-400 bg-blue-400/10 border-blue-400/20",
        dot: "bg-blue-400",
      };

    default:
      return {
        wrapper:
          "border-white/10 bg-white/[0.02]",
        badge:
          "text-slate-400 bg-white/5 border-white/10",
        dot: "bg-slate-500",
      };
  }
};

const getStatusLabel = (
  status: string | null
): string => {
  if (!status) return "SIN ESTADO";

  // [NEW v2.0]
  if (status.toUpperCase() === "SOLICITADA") return "PEND. PLANIFICACIÓN";

  return status
    .replace(/_/g, " ")
    .toUpperCase();
};

const getTipoStyle = (tipo: string | null) => {
  const value = String(tipo ?? "")
    .trim()
    .toUpperCase();

  if (value === "SOLO") {
    return "text-blue-400 bg-blue-400/10 border-blue-400/20";
  }

  if (value === "DUAL") {
    return "text-purple-400 bg-purple-400/10 border-purple-400/20";
  }

  return "text-slate-400 bg-white/5 border-white/10";
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

  const todayYMD = useMemo(
    () => toYMD(new Date()),
    []
  );

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
          "[AGUILAS CALENDAR]",
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

          setStudentNames(map);
        } else {
          setStudentNames({});
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Error cargando vuelos.";

        console.error(
          "[AGUILAS SLOT ERROR]",
          message
        );

        setError(message);
        setSlots([]);
      } finally {
        setLoading(false);
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
      .channel(`captain-calendar-${instructor.id}`)
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

    const hoy =
      slots.filter(
        (slot) =>
          slot.fecha ===
          todayYMD
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

    const horasPlanificadas =
      slots.reduce(
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
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 text-white font-sans animate-in fade-in duration-500">

      {/* ═══════════════════════════════════════════════════════════════════════
          CABECERA
      ═══════════════════════════════════════════════════════════════════════ */}

      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#080808]">

        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(225,173,1,0.10),transparent_35%)]" />

        <div className="relative p-6 md:p-7">

          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">

            <div className="flex items-center gap-4">

              <div className="w-14 h-14 rounded-2xl bg-[#E1AD01]/10 border border-[#E1AD01]/20 flex items-center justify-center shadow-[0_0_30px_rgba(225,173,1,0.08)]">
                <CalendarDays
                  size={25}
                  className="text-[#E1AD01]"
                />
              </div>

              <div>

                <div className="flex items-center gap-2">

                  <h1 className="text-xl md:text-2xl font-black uppercase italic tracking-tight">
                    Calendario de{" "}
                    <span className="text-[#E1AD01]">
                      Vuelo
                    </span>
                  </h1>

                  <ShieldCheck
                    size={15}
                    className="text-[#E1AD01]/60"
                  />

                </div>

                <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-[0.25em] font-black mt-1">
                  Operación Águilas · Agenda del Capitán
                </p>

                {instructor && (
                  <p className="text-[9px] text-[#E1AD01]/70 font-mono uppercase mt-2">
                    {instructor.nombre_completo}
                    {" · "}
                    {instructor.sede ?? "SEDE NO DEFINIDA"}
                  </p>
                )}

              </div>
            </div>

            {/* Navegación */}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">

              <div className="flex items-center justify-between bg-black/70 border border-white/10 rounded-xl p-1">

                <button
                  type="button"
                  onClick={previousWeek}
                  className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="px-5 min-w-[220px] text-center">

                  <p className="text-[8px] text-slate-600 font-black uppercase tracking-[0.25em]">
                    Semana operacional
                  </p>

                  <p className="text-[10px] text-white font-black uppercase tracking-widest mt-0.5">
                    {weekLabel}
                  </p>

                </div>

                <button
                  type="button"
                  onClick={nextWeek}
                  className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-all"
                >
                  <ChevronRight size={16} />
                </button>

              </div>

              <button
                type="button"
                onClick={goToday}
                className="px-5 py-3 rounded-xl border border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:border-[#E1AD01]/30 text-[9px] font-black uppercase tracking-widest transition-all"
              >
                Hoy
              </button>

            </div>

          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ERROR
      ═══════════════════════════════════════════════════════════════════════ */}

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4 flex items-start gap-3">

          <AlertTriangle
            size={16}
            className="text-red-400 shrink-0 mt-0.5"
          />

          <div>

            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">
              Error de enlace operacional
            </p>

            <p className="text-[9px] text-red-400/70 font-mono mt-1">
              {error}
            </p>

          </div>

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PANEL DE ESTADÍSTICAS
      ═══════════════════════════════════════════════════════════════════════ */}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        <div className="rounded-2xl border border-[#E1AD01]/20 bg-[#E1AD01]/[0.04] p-4">

          <div className="flex items-center justify-between">

            <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
              Hoy
            </span>

            <CalendarDays
              size={13}
              className="text-[#E1AD01]"
            />

          </div>

          <p className="text-2xl font-black italic text-[#E1AD01] mt-2">
            {stats.hoy}
          </p>

          <p className="text-[7px] text-slate-600 uppercase font-black mt-1">
            vuelos programados
          </p>

        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">

          <div className="flex items-center justify-between">

            <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
              Semana
            </span>

            <Plane
              size={13}
              className="text-slate-500"
            />

          </div>

          <p className="text-2xl font-black italic text-white mt-2">
            {stats.total}
          </p>

          <p className="text-[7px] text-slate-600 uppercase font-black mt-1">
            slots registrados
            {stats.pendientesPlan > 0 && (
              <span className="text-blue-400"> · {stats.pendientesPlan} pend. planificación</span>
            )}
          </p>

        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">

          <div className="flex items-center justify-between">

            <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
              Planificadas
            </span>

            <Clock3
              size={13}
              className="text-slate-500"
            />

          </div>

          <p className="text-2xl font-black italic text-white mt-2">
            {stats.horasPlanificadas.toFixed(1)}
            <span className="text-xs text-slate-600 ml-1">
              h
            </span>
          </p>

          <p className="text-[7px] text-slate-600 uppercase font-black mt-1">
            horas de vuelo
          </p>

        </div>

        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4">

          <div className="flex items-center justify-between">

            <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
              Completadas
            </span>

            <ShieldCheck
              size={13}
              className="text-emerald-400"
            />

          </div>

          <p className="text-2xl font-black italic text-emerald-400 mt-2">
            {stats.completadas}
          </p>

          <p className="text-[7px] text-slate-600 uppercase font-black mt-1">
            vuelos finalizados
          </p>

        </div>

      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          LOADING
      ═══════════════════════════════════════════════════════════════════════ */}

      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-[#080808] py-28 flex flex-col items-center justify-center">

          <Loader2
            size={28}
            className="animate-spin text-[#E1AD01]"
          />

          <p className="text-[9px] text-slate-600 uppercase tracking-[0.3em] font-black mt-4">
            Sincronizando RESERVAS_SLOT_VUELO...
          </p>

        </div>
      ) : (

        /* ══════════════════════════════════════════════════════════════════════
           CALENDARIO
        ══════════════════════════════════════════════════════════════════════ */

        <div className="overflow-x-auto pb-3">

          <div className="grid grid-cols-7 gap-2 min-w-[1120px]">

            {weekDays.map((day) => {

              const ymd =
                toYMD(day);

              const daySlots =
                slotsPorDia.get(
                  ymd
                ) ?? [];

              const isToday =
                ymd ===
                todayYMD;

              return (
                <div
                  key={ymd}
                  className="flex flex-col min-h-[420px]"
                >

                  {/* ═══════════════════════════════════════════════════════════
                     CABECERA DEL DÍA
                  ═══════════════════════════════════════════════════════════ */}

                  <div
                    className={`
                      rounded-2xl border p-4 mb-2 transition-all
                      ${
                        isToday
                          ? "bg-[#E1AD01]/[0.08] border-[#E1AD01]/30 shadow-[0_0_25px_rgba(225,173,1,0.06)]"
                          : "bg-[#080808] border-white/10"
                      }
                    `}
                  >

                    <div className="flex items-center justify-between">

                      <p
                        className={`
                          text-[9px] font-black uppercase tracking-[0.2em]
                          ${
                            isToday
                              ? "text-[#E1AD01]"
                              : "text-slate-500"
                          }
                        `}
                      >
                        {DAYS_ES[
                          day.getDay()
                        ]}
                      </p>

                      {isToday && (
                        <span className="flex items-center gap-1">

                          <span className="w-1.5 h-1.5 rounded-full bg-[#E1AD01] animate-pulse" />

                          <span className="text-[6px] text-[#E1AD01] font-black uppercase">
                            HOY
                          </span>

                        </span>
                      )}

                    </div>

                    <div className="flex items-end justify-between mt-2">

                      <p
                        className={`
                          text-3xl font-black italic leading-none
                          ${
                            isToday
                              ? "text-[#E1AD01]"
                              : "text-white"
                          }
                        `}
                      >
                        {day.getDate()}
                      </p>

                      <p className="text-[7px] text-slate-600 uppercase font-black">
                        {MONTHS_ES[
                          day.getMonth()
                        ].slice(0, 3)}
                      </p>

                    </div>

                    <p className="text-[7px] text-slate-700 font-mono mt-2">
                      {ymd}
                    </p>

                  </div>

                  {/* ═══════════════════════════════════════════════════════════
                     SLOTS
                  ═══════════════════════════════════════════════════════════ */}

                  <div className="space-y-2">

                    {daySlots.length === 0 ? (

                      <div
                        className={`
                          rounded-2xl border border-dashed
                          p-7 text-center
                          ${
                            isToday
                              ? "border-[#E1AD01]/10 bg-[#E1AD01]/[0.01]"
                              : "border-white/[0.06]"
                          }
                        `}
                      >

                        <CalendarDays
                          size={17}
                          className="mx-auto text-slate-800"
                        />

                        <p className="text-[7px] text-slate-700 font-black uppercase tracking-widest mt-2">
                          Sin vuelos
                        </p>

                      </div>

                    ) : (

                      daySlots.map(
                        (slot) => {

                          const style =
                            getStatusStyle(
                              slot.status
                            );

                          const tipoStyle =
                            getTipoStyle(
                              slot.tipo_vuelo
                            );

                          return (

                            <button
                              key={slot.id}
                              type="button"
                              onClick={() =>
                                setSelectedSlot(
                                  slot
                                )
                              }
                              className={`
                                w-full text-left rounded-2xl border p-3
                                transition-all duration-200
                                hover:-translate-y-0.5
                                hover:border-[#E1AD01]/40
                                hover:shadow-[0_10px_30px_rgba(0,0,0,0.25)]
                                ${style.wrapper}
                              `}
                            >

                              {/* Hora + estado */}

                              <div className="flex items-center justify-between gap-2">

                                <div className="flex items-center gap-1.5">

                                  {String(slot.status ?? "").toUpperCase() === "SOLICITADA" ? (
                                    <Hourglass
                                      size={10}
                                      className="text-blue-400"
                                    />
                                  ) : (
                                    <Clock3
                                      size={10}
                                      className="text-[#E1AD01]"
                                    />
                                  )}

                                  <span className="text-[10px] text-[#E1AD01] font-black font-mono">
                                    {formatHour(
                                      slot.slot_hora
                                    )}
                                  </span>

                                </div>

                                <span
                                  className={`
                                    px-1.5 py-0.5 rounded-md border
                                    text-[6px] font-black uppercase
                                    ${style.badge}
                                  `}
                                >
                                  {getStatusLabel(
                                    slot.status
                                  )}
                                </span>

                              </div>

                              {/* Aeronave */}

                              <div className="flex items-center gap-1.5 mt-3">

                                <Plane
                                  size={10}
                                  className="text-slate-500 shrink-0"
                                />

                                <span className="text-[9px] text-white font-black uppercase truncate">
                                  {slot.aeronave_matricula ||
                                    "AERONAVE S/N"}
                                </span>

                              </div>

                              {/* Alumno */}

                              <div className="flex items-center gap-1.5 mt-2">

                                <User
                                  size={10}
                                  className="text-slate-500 shrink-0"
                                />

                                <span className="text-[8px] text-slate-400 font-bold uppercase truncate">
                                  {getStudentName(
                                    slot.student_id
                                  )}
                                </span>

                              </div>

                              {/* Tipo */}

                              <div className="mt-3 flex items-center justify-between gap-2">

                                <div className="flex items-center gap-1">

                                  <span
                                    className={`
                                      inline-flex px-1.5 py-0.5 rounded-md border
                                      text-[6px] font-black uppercase
                                      ${tipoStyle}
                                    `}
                                  >
                                    {slot.tipo_vuelo ||
                                      "VUELO"}
                                  </span>

                                  {/* [NEW v2.0] */}
                                  {slot.reprogramada && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[6px] font-black uppercase text-amber-400 bg-amber-400/10 border-amber-400/20">
                                      <Repeat size={6} /> REPROG.
                                    </span>
                                  )}

                                </div>

                                <span className="text-[7px] text-slate-600 font-mono">
                                  {Number(
                                    slot.horas_planificadas
                                  || 0
                                  ).toFixed(1)}
                                  h
                                </span>

                              </div>

                            </button>

                          );
                        }
                      )

                    )}

                  </div>

                </div>
              );
            })}

          </div>

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          RESUMEN OPERACIONAL
      ═══════════════════════════════════════════════════════════════════════ */}

      {!loading && slots.length > 0 && (

        <div className="rounded-2xl border border-white/10 bg-[#080808] p-5">

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

            <div>

              <p className="text-[9px] text-[#E1AD01] font-black uppercase tracking-[0.25em]">
                Control operacional
              </p>

              <p className="text-[10px] text-slate-500 uppercase mt-1">
                Agenda vinculada al instructor #{instructor?.id.slice(0, 8)}
              </p>

            </div>

            <div className="flex flex-wrap gap-2">

              <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[7px] text-slate-600 uppercase font-black">
                  Programados
                </span>

                <span className="ml-2 text-[10px] text-white font-black">
                  {stats.programadas}
                </span>
              </div>

              {/* [NEW v2.0] */}
              <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[7px] text-slate-600 uppercase font-black">
                  Pend. planificación
                </span>

                <span className="ml-2 text-[10px] text-blue-400 font-black">
                  {stats.pendientesPlan}
                </span>
              </div>

              <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[7px] text-slate-600 uppercase font-black">
                  Reales
                </span>

                <span className="ml-2 text-[10px] text-emerald-400 font-black">
                  {stats.horasReales.toFixed(1)}h
                </span>
              </div>

              <div className="px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                <span className="text-[7px] text-slate-600 uppercase font-black">
                  Slots
                </span>

                <span className="ml-2 text-[10px] text-[#E1AD01] font-black">
                  {stats.total}
                </span>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL DETALLE DEL VUELO
      ═══════════════════════════════════════════════════════════════════════ */}

      {selectedSlot && (

        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">

          <div className="w-full max-w-lg rounded-3xl overflow-hidden border border-[#E1AD01]/20 bg-[#050505] shadow-2xl max-h-[92vh] flex flex-col">

            {/* Header */}

            <div className="bg-[#E1AD01] text-black p-5 flex items-center justify-between shrink-0">

              <div className="flex items-center gap-2">

                <Plane size={16} />

                <div>

                  <p className="text-[11px] font-black uppercase italic">
                    Detalle de Vuelo
                  </p>

                  <p className="text-[7px] font-black uppercase tracking-widest opacity-60">
                    Operación Águilas
                  </p>

                </div>

              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedSlot(
                    null
                  )
                }
                className="hover:rotate-90 transition-all"
              >
                <X size={18} />
              </button>

            </div>

            <div className="p-6 space-y-5 overflow-y-auto">

              {/* [NEW v2.0] Aviso pendiente de planificación */}
              {String(selectedSlot.status ?? "").toUpperCase() === "SOLICITADA" && (
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.05] p-4 flex items-start gap-2">
                  <Hourglass size={12} className="text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-[9px] text-blue-300 font-black uppercase leading-relaxed">
                    Solicitud aún no confirmada por Planificación de Vuelo. Puede cambiar de capitán, aeronave u horario.
                  </p>
                </div>
              )}

              {/* Fecha / hora */}

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">

                <div className="flex items-center justify-between">

                  <div>

                    <p className="text-[8px] text-slate-600 uppercase font-black tracking-widest">
                      Fecha
                    </p>

                    <p className="text-white text-sm font-black uppercase mt-1">
                      {formatDateLong(
                        selectedSlot.fecha
                      )}
                    </p>

                    {/* [NEW v2.0] */}
                    {selectedSlot.reprogramada && selectedSlot.fecha_solicitada && (
                      <p className="text-[8px] text-amber-400 font-black uppercase mt-1 flex items-center gap-1">
                        <Repeat size={8} /> Solicitado originalmente {formatDateShort(selectedSlot.fecha_solicitada)}
                      </p>
                    )}

                  </div>

                  <div className="text-right">

                    <p className="text-[8px] text-slate-600 uppercase font-black tracking-widest">
                      Slot
                    </p>

                    <p className="text-[#E1AD01] text-xl font-black italic font-mono mt-1">
                      {formatHour(
                        selectedSlot.slot_hora
                      )}
                    </p>

                  </div>

                </div>

              </div>

              {/* Información */}

              <div className="grid grid-cols-2 gap-3">

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">

                  <p className="text-[7px] text-slate-600 uppercase font-black">
                    Aeronave
                  </p>

                  <div className="flex items-center gap-2 mt-2">

                    <Plane
                      size={13}
                      className="text-[#E1AD01]"
                    />

                    <p className="text-white text-[10px] font-black uppercase">
                      {selectedSlot.aeronave_matricula ||
                        "S/N"}
                    </p>

                  </div>

                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">

                  <p className="text-[7px] text-slate-600 uppercase font-black">
                    Tipo
                  </p>

                  <p className="text-white text-[10px] font-black uppercase mt-2">
                    {selectedSlot.tipo_vuelo ||
                      "NO DEFINIDO"}
                  </p>

                </div>

                <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">

                  <p className="text-[7px] text-slate-600 uppercase font-black">
                    Alumno
                  </p>

                  <div className="flex items-center gap-2 mt-2">

                    <User
                      size={13}
                      className="text-slate-500"
                    />

                    <p className="text-white text-[10px] font-black uppercase">
                      {getStudentName(
                        selectedSlot.student_id
                      )}
                    </p>

                  </div>

                </div>

              </div>

              {/* Horas */}

              <div className="grid grid-cols-2 gap-3">

                <div className="rounded-2xl border border-[#E1AD01]/15 bg-[#E1AD01]/[0.04] p-4">

                  <p className="text-[7px] text-slate-600 uppercase font-black">
                    Horas planificadas
                  </p>

                  <p className="text-2xl text-[#E1AD01] font-black italic mt-1">
                    {Number(
                      selectedSlot.horas_planificadas ||
                      0
                    ).toFixed(1)}
                    <span className="text-xs ml-1">
                      h
                    </span>
                  </p>

                </div>

                <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.03] p-4">

                  <p className="text-[7px] text-slate-600 uppercase font-black">
                    Horas reales
                  </p>

                  <p className="text-2xl text-emerald-400 font-black italic mt-1">
                    {Number(
                      selectedSlot.horas_reales ||
                      0
                    ).toFixed(1)}
                    <span className="text-xs ml-1">
                      h
                    </span>
                  </p>

                </div>

              </div>

              {/* Estado */}

              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.02] p-4">

                <div className="flex items-center gap-3">

                  <span className="relative flex h-2.5 w-2.5">

                    <span
                      className={`
                        absolute inline-flex h-full w-full
                        rounded-full opacity-50
                        ${getStatusStyle(
                          selectedSlot.status
                        ).dot}
                      `}
                    />

                    <span
                      className={`
                        relative inline-flex rounded-full h-2.5 w-2.5
                        ${getStatusStyle(
                          selectedSlot.status
                        ).dot}
                      `}
                    />

                  </span>

                  <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest">
                    Estado operacional
                  </span>

                </div>

                <span
                  className={`
                    px-3 py-1.5 rounded-xl border
                    text-[8px] font-black uppercase
                    ${
                      getStatusStyle(
                        selectedSlot.status
                      ).badge
                    }
                  `}
                >
                  {getStatusLabel(
                    selectedSlot.status
                  )}
                </span>

              </div>

              {/* [NEW v2.0] Nota de Planificación */}
              {selectedSlot.motivo_planificacion && (

                <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.03] p-4">

                  <p className="text-[8px] text-amber-400 uppercase font-black tracking-widest">
                    Nota de Planificación
                  </p>

                  <p className="text-[10px] text-slate-300 mt-2 uppercase">
                    {selectedSlot.motivo_planificacion}
                  </p>

                </div>

              )}

              {/* Notas del capitán */}

              {selectedSlot.notas_capitan && (

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">

                  <div className="flex items-center gap-2">

                    <FileText
                      size={12}
                      className="text-[#E1AD01]"
                    />

                    <p className="text-[8px] text-slate-500 uppercase font-black tracking-widest">
                      Notas del Capitán
                    </p>

                  </div>

                  <p className="text-[10px] text-slate-300 mt-3 leading-relaxed">
                    {selectedSlot.notas_capitan}
                  </p>

                </div>

              )}

              {/* Motivo cierre */}

              {selectedSlot.motivo_cierre && (

                <div className="rounded-2xl border border-red-500/15 bg-red-500/[0.03] p-4">

                  <p className="text-[8px] text-red-400 uppercase font-black tracking-widest">
                    Motivo de cierre
                  </p>

                  <p className="text-[10px] text-slate-400 mt-2">
                    {selectedSlot.motivo_cierre}
                  </p>

                </div>

              )}

              <button
                type="button"
                onClick={() =>
                  setSelectedSlot(
                    null
                  )
                }
                className="w-full py-4 rounded-2xl border border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/20 text-[9px] font-black uppercase tracking-[0.3em] transition-all"
              >
                Cerrar detalle
              </button>

            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default FlightCalendar;
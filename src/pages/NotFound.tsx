// src/pages/NotFound.tsx
// B&M Mantenimiento Aeronáutico / Valkyron OS — Página no encontrada v2.0
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0 — REBRAND B&M:
//   [UI]  Página B&M (logo, lienzo claro, tarjeta) en español; antes era la
//         plantilla genérica en inglés ("Oops! Page not found") con colores
//         del tema por defecto.
//   [NEW] Muestra la ruta solicitada y ofrece volver a la pantalla anterior
//         (si el historial lo permite) o al Centro de mando.
//   [FIX] El enlace <a href="/"> recargaba toda la aplicación (y con ella la
//         sesión y los permisos). Ahora navega dentro del router.
// PRESERVADO: registro en consola de la ruta inexistente, export default.
// ─────────────────────────────────────────────────────────────────────────────
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, Compass, LayoutGrid } from "lucide-react";
import { BmLogo } from "@/components/brand/BmLogo";
import { bmBtn } from "@/components/brand/bm-ui";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  // react-router guarda en history.state.idx la posición dentro de la app
  const puedeVolver = typeof window !== "undefined" && Number((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  return (
    <div className="bm-app flex min-h-[100dvh] flex-col bg-bm-canvas text-left text-bm-ink">
      <header className="border-b border-bm-line bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:h-16 sm:px-6">
          <BmLogo variant="compact" className="h-7 w-auto text-bm-red sm:h-8" />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-[24px] border border-bm-line bg-white p-6 sm:p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bm-red-tint text-bm-red">
            <Compass className="h-6 w-6" />
          </span>
          <p className="bm-figure mt-5 text-[56px] leading-none text-bm-red">404</p>
          <h1 className="bm-heading mt-3 text-2xl">Esta página no existe</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-bm-steel">
            La dirección no corresponde a ningún módulo del sistema. Revise el enlace o vuelva al Centro de mando.
          </p>
          <p className="mt-4 break-all rounded-xl bg-bm-canvas px-3 py-2 font-data text-[13px] text-bm-ink">
            {location.pathname}
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {puedeVolver && (
              <button type="button" onClick={() => navigate(-1)} className={`${bmBtn.secondary} sm:flex-1`}>
                <ArrowLeft className="h-4 w-4" /> Volver
              </button>
            )}
            <button type="button" onClick={() => navigate("/", { replace: true })} className={`${bmBtn.primary} sm:flex-1`}>
              <LayoutGrid className="h-4 w-4" /> Ir al Centro de mando
            </button>
          </div>
        </div>
      </main>

      <footer className="pb-6 text-center text-xs text-bm-hint">B&amp;M Mantenimiento Aeronáutico · Valkyron OS</footer>
    </div>
  );
};

export default NotFound;

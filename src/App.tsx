// NÚCLEO DE INTELIGENCIA OPERATIVA - VALKYRON OS v4.8
// CHANGELOG v4.8:
//   [FIX CRÍTICO] ProtectedRoute: loading colgado — getInitialSession ahora siempre
//     llama setLoading(false) en finally, incluso si getSession() lanza excepción
//   [FIX] onAuthStateChange: INITIAL_SESSION event garantiza setLoading(false)
//     independientemente de getInitialSession — elimina race condition doble-init
//   [FIX] Timeout de seguridad: si en 8s no resuelve la sesión, fuerza redirect a login
//   [FIX] fetchFleetStatus: try/catch explícito — error silencioso ya no cuelga la app
// v4.7 PRESERVADO: estado → status en mappedFleet, globalFleet sync, todas las rutas.
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.

import React, { useEffect, useState, cloneElement, useCallback, useRef } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

import Index from "./pages/Index";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { ControlHub } from "./components/ControlHub";
import { InventoryCheckout } from "./components/InventoryCheckout";
import FlightRegister from "./components/flights/FlightRegister";

const queryClient = new QueryClient();

export type UserRole = 'CEO' | 'ADMIN' | 'PILOTO' | 'MECANICO' | 'CAPITAN';

// ─── PROTECTED ROUTE v4.8 ────────────────────────────────────────────────────
// [FIX] Antes: getInitialSession podía no llegar al setLoading(false) si Supabase
//   tardaba o lanzaba un error silencioso, dejando el spinner infinito.
// [FIX] Ahora: finally garantiza setLoading(false) siempre. onAuthStateChange
//   escucha INITIAL_SESSION como segundo mecanismo de resolución. Timeout de 8s
//   como última línea de defensa — si nada resuelve, redirige a login.

const ProtectedRoute = ({
  children,
  globalFleet,
}: {
  children: React.ReactElement;
  globalFleet: any[];
}) => {
  const [session,  setSession]  = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const [role,     setRole]     = useState<UserRole | null>(null);
  const resolvedRef = useRef(false);

  const resolveSession = useCallback((sess: any) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    if (sess) {
      setSession(sess);
      const rawRol = sess.user?.user_metadata?.rol
        || sess.user?.user_metadata?.role
        || 'PILOTO';
      const userRole = rawRol.toString().toUpperCase().trim();
      console.log('[MIA v4.8] Acceso concedido — rango:', userRole);
      setRole(userRole as UserRole);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Timeout de seguridad: 8s máximo — si Supabase no responde, fuerza resolución
    const safetyTimer = setTimeout(() => {
      if (!resolvedRef.current) {
        console.warn('[MIA v4.8] Timeout de auth — forzando resolución sin sesión');
        resolveSession(null);
      }
    }, 8000);

    // Mecanismo 1: getSession() directo
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        resolveSession(session);
      })
      .catch((err) => {
        console.error('[MIA v4.8] getSession error:', err);
        resolveSession(null);
      })
      .finally(() => {
        clearTimeout(safetyTimer);
      });

    // Mecanismo 2: onAuthStateChange — cubre INITIAL_SESSION, TOKEN_REFRESHED, SIGNED_OUT
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      console.log('[MIA v4.8] Auth event:', event);

      if (event === 'SIGNED_OUT') {
        resolvedRef.current = false;
        setSession(null);
        setRole(null);
        setLoading(false);
        return;
      }

      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED'
      ) {
        resolveSession(sess);
        clearTimeout(safetyTimer);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
    };
  }, [resolveSession]);

  if (loading) {
    return (
      <div className="h-screen w-full bg-[#020202] flex flex-col items-center justify-center gap-6 text-left">
        <div className="h-16 w-16 border-t-2 border-[#E1AD01] rounded-full animate-spin" />
        <span className="text-[#E1AD01] font-black text-[10px] tracking-[0.5em] uppercase italic animate-pulse">
          Sincronizando Nodo Águila
        </span>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return cloneElement(children, { userRole: role, fleet: globalFleet });
};

// ─── APP ─────────────────────────────────────────────────────────────────────

const App = () => {
  const [globalFleet, setGlobalFleet] = useState<any[]>([]);

  const fetchFleetStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('flota_aviones')
        .select('*')
        .order('matricula', { ascending: true });

      if (error) {
        console.error('[MIA v4.8] fetchFleetStatus error:', error.message);
        return;
      }
      if (data) {
        const mappedFleet = data.map(ac => ({
          ...ac,
          tailNumber: ac.matricula,
          status: ac.estado,
          model: ac.modelo ?? ac.model ?? 'SIN MODELO',
        }));
        setGlobalFleet(mappedFleet);
      }
    } catch (err) {
      console.error('[MIA v4.8] fetchFleetStatus excepción:', err);
    }
  }, []);

  useEffect(() => {
    fetchFleetStatus();

    const fleetChannel = supabase
      .channel('global-fleet-sync')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'flota_aviones' },
        () => fetchFleetStatus()
      )
      .subscribe();

    return () => { supabase.removeChannel(fleetChannel); };
  }, [fetchFleetStatus]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute globalFleet={globalFleet}>
                  <Index />
                </ProtectedRoute>
              }
            />
            <Route
              path="/control-hub"
              element={
                <ProtectedRoute globalFleet={globalFleet}>
                  <ControlHub />
                </ProtectedRoute>
              }
            />
            <Route
              path="/inventory-checkout"
              element={
                <ProtectedRoute globalFleet={globalFleet}>
                  <InventoryCheckout />
                </ProtectedRoute>
              }
            />
            <Route
              path="/flight-register"
              element={
                <ProtectedRoute globalFleet={globalFleet}>
                  <FlightRegister />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
// NÚCLEO DE INTELIGENCIA OPERATIVA - VALKYRON OS v4.7
// FIX CRÍTICO: estado → status en mappedFleet (AircraftCard usa aircraft.status, DB guarda 'estado')
// Regla de Oro: Cero Omisiones. Grado Militar. Siempre evolución.
import React, { useEffect, useState, cloneElement, useCallback } from 'react';
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

const ProtectedRoute = ({ children, globalFleet }: { children: React.ReactElement, globalFleet: any[] }) => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setSession(session);
        const rawRol = session.user.user_metadata?.rol || session.user.user_metadata?.role || 'PILOTO';
        const userRole = rawRol.toString().toUpperCase().trim();
        console.log("MIA SYSTEM: Acceso concedido a rango:", userRole);
        setRole(userRole as UserRole);
      }
      setLoading(false);
    };

    getInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        const rawRol = session.user.user_metadata?.rol || session.user.user_metadata?.role || 'PILOTO';
        const userRole = rawRol.toString().toUpperCase().trim();
        setRole(userRole as UserRole);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-full bg-[#020202] flex flex-col items-center justify-center gap-6 text-left">
        <div className="h-16 w-16 border-t-2 border-[#E1AD01] rounded-full animate-spin"></div>
        <span className="text-[#E1AD01] font-black text-[10px] tracking-[0.5em] uppercase italic animate-pulse">
          Sincronizando Nodo Águila
        </span>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return cloneElement(children, { userRole: role, fleet: globalFleet });
};

const App = () => {
  const [globalFleet, setGlobalFleet] = useState<any[]>([]);

  const fetchFleetStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('flota_aviones')
      .select('*')
      .order('matricula', { ascending: true });

    if (!error && data) {
      const mappedFleet = data.map(ac => ({
        ...ac,
        tailNumber: ac.matricula,
        // FIX v4.7: AircraftCard.tsx usa aircraft.status
        // DB guarda el campo como 'estado' — sin este mapeo, status = undefined
        // y mapStatusToKey() cae siempre en fallback 'grounded'
        status: ac.estado,
      }));
      setGlobalFleet(mappedFleet);
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
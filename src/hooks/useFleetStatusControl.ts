// src/hooks/useFleetStatusControl.ts
// VALKYRON OS — Hook de Control de Estado de Flota con Autorización Role-Based
// Evolución: autorización por email whitelist + roles CEO/admin/supervisor
// REGLA DE ORO: CERO OMISIONES.

import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

/**
 * @constant AUTHORIZED_SUPERVISORS
 * @description Emails autorizados para liberar/inhabilitar aeronaves.
 * Águilas Pilots: Auricar, Diego Ramírez + CEO Valkyron Group.
 */
export const AUTHORIZED_SUPERVISORS: string[] = [
  'auricar@aguilaspilots.com',
  'diegoramirez@aguilaspilots.com',
  'auricar@valkyrongroup.com',
  'diego.ramirez@aguilaspilots.com',
  'robertoventurini@gmail.com',
];

/**
 * @constant AUTHORIZED_ROLES
 * @description Roles en user_metadata/app_metadata que también otorgan acceso.
 */
export const AUTHORIZED_ROLES: string[] = [
  'ceo',
  'admin',
  'supervisor',
];

export type AircraftStatus = 'operational' | 'maintenance' | 'grounded' | 'flight';

export interface StatusChangePayload {
  aircraftId:      string;
  newStatus:       AircraftStatus;
  supervisorEmail: string;
  motivo?:         string;
}

/**
 * @hook useFleetStatusControl
 * @description Centraliza el cambio de estado de aeronaves con verificación de autorización.
 * Verifica primero por email whitelist, luego por rol en metadata de Supabase Auth.
 * Todos los cambios de estado DEBEN pasar por este hook para garantizar auditoría completa.
 */
export const useFleetStatusControl = () => {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  /**
   * @method isAuthorized
   * @description Verifica autorización por email whitelist O por rol en metadata.
   * Check 1: email en AUTHORIZED_SUPERVISORS.
   * Check 2: user_metadata.role o app_metadata.role en AUTHORIZED_ROLES.
   */
  const isAuthorized = useCallback(async (): Promise<{ ok: boolean; email: string }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return { ok: false, email: '' };

    const email = user.email.toLowerCase().trim();

    // ── Check 1: email en whitelist ──
    const byEmail = AUTHORIZED_SUPERVISORS.some(a => a.toLowerCase() === email);
    if (byEmail) return { ok: true, email };

    // ── Check 2: rol en metadata de Supabase Auth ──
    const role = (
      user.user_metadata?.role ||
      user.app_metadata?.role  ||
      ''
    ).toLowerCase().trim();

    const byRole = AUTHORIZED_ROLES.includes(role);
    return { ok: byRole, email };
  }, []);

  /**
   * @method changeAircraftStatus
   * @description Cambia el estado de una aeronave con verificación de autorización.
   * Escribe estado_modificado_por y estado_modificado_en para auditoría completa.
   * Si hay motivo, genera entrada automática en historial_trabajos_aeronave.
   */
  const changeAircraftStatus = useCallback(async (
    payload: StatusChangePayload,
    onSuccess?: (newStatus: AircraftStatus) => void
  ): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const { ok, email } = await isAuthorized();

      if (!ok) {
        const msg = `⛔ ACCESO DENEGADO: Solo los supervisores autorizados (Auricar / Diego Ramírez / CEO) pueden modificar el estado operacional de las aeronaves. Usuario actual: ${email || 'desconocido'}`;
        setError(msg);
        alert(msg);
        return false;
      }

      const { error: dbError } = await supabase
        .from('flota_aviones')
        .update({
          estado:                payload.newStatus,
          estado_modificado_por: email,
          estado_modificado_en:  new Date().toISOString(),
        })
        .eq('id', payload.aircraftId);

      if (dbError) {
        const msg = `FALLA AL CAMBIAR ESTADO: ${dbError.message}`;
        setError(msg);
        alert(msg);
        return false;
      }

      // ── Registro de auditoría en historial si hay motivo ──
      if (payload.motivo) {
        await supabase.from('historial_trabajos_aeronave').insert({
          avion_id:      payload.aircraftId,
          tipo_trabajo:  'Cambio de Estado',
          descripcion:   `Estado cambiado a: ${payload.newStatus.toUpperCase()}. Motivo: ${payload.motivo}`,
          tecnico:       email,
          autorizado_por: email,
        });
      }

      onSuccess?.(payload.newStatus);
      return true;

    } catch (err: any) {
      const msg = `ERROR CRÍTICO: ${err.message}`;
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  return { changeAircraftStatus, isAuthorized, loading, error };
};
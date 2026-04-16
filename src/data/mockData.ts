// src/data/mockData.ts
import { Aircraft, SparePart, FinanceTransaction } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient'; // Importamos la conexión real

// Exportamos los tipos para consistencia global
export type { Aircraft, SparePart, FinanceTransaction as Transaction };

/**
 * EVOLUCIÓN: De datos estáticos a consultas reales en Supabase.
 * Para no romper el sistema, mantenemos los nombres pero los convertimos en funciones async.
 */

// 1. Obtener Flota de Aviones Real
export const getAircrafts = async (): Promise<Aircraft[]> => {
  const { data, error } = await supabase
    .from('flota_aviones')
    .select('*');

  if (error) {
    console.error('Error en Supabase (Aircrafts):', error.message);
    return []; // Fallback para evitar que la UI colapse
  }

  // Mapeo de DB a Interfaz de React (ajustando nombres de columnas si es necesario)
  return data.map((item: any) => ({
    id: item.id,
    tailNumber: item.matricula,
    model: item.modelo,
    status: item.estado,
    location: item.ubicacion || 'Base Central',
    image: item.image || "/placeholder.svg",
    components: item.components || [] // Asumiendo que guardamos componentes como JSONB en Postgres
  }));
};

// 2. Obtener Repuestos Real (Inventario)
export const getSpareParts = async (): Promise<SparePart[]> => {
  const { data, error } = await supabase
    .from('inventario_repuestos')
    .select('*');

  if (error) {
    console.error('Error en Supabase (SpareParts):', error.message);
    return [];
  }

  return data.map((item: any) => ({
    id: item.id,
    partNumber: item.numero_parte,
    name: item.nombre,
    quantity: item.cantidad,
    minStock: item.stock_minimo,
    location: item.ubicacion_hangar,
    unitPrice: item.precio_unitario,
    category: item.categoria
  }));
};

// 3. Obtener Transacciones (Registros de Operación)
export const getTransactions = async (): Promise<any[]> => {
  const { data, error } = await supabase
    .from('registros_operacion')
    .select('*')
    .order('fecha_vuelo', { ascending: false });

  if (error) {
    console.error('Error en Supabase (Transactions):', error.message);
    return [];
  }

  return data;
};

// 4. Funciones de Evolución: Escritura Real
export const addTransaction = async (transaction: any) => {
    const { data, error } = await supabase
      .from('registros_operacion')
      .insert([transaction]);
    if (error) throw error;
    return data;
};
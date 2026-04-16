// src/Types/flights.ts
// Evolución de estructura quirúrgica - Valkyron Group (Grado Militar)

export type UserRole = 'CEO' | 'ADMIN' | 'PILOTO';

export interface FlightRecordYV188E {
  id?: string; // Identificador único para persistencia en Supabase
  fecha: string;
  ruta: string;
  tacInicial: number;
  tacFinal: number;
  horasTac: number; // Delta: ΔT = TacFinal - TacInicial
  totalHorasCobrada: number;
  alumno: string;
  instructor: string;
  
  // Constantes de Operación (Valores base)
  precioHoraCostoTac: number; // Por defecto: 100
  precioCobrado: number;      // Por defecto: 160
  
  // Algoritmo de Liquidación
  pagoCapitan: number;        // Cálculo: totalHorasCobrada * 15
  pagoGasolina: number;       // Cálculo: horasTac * 75.90
  costoOperacionalAvion: number; // % sobre producción o valor fijo
  
  // Resultado de Inteligencia Financiera
  totalProduccionNeta: number; // Σ Ingresos - Σ Gastos Operativos
  observacion?: string;
  
  // Metadata de Auditoría
  createdAt?: string;
  userId?: string; // Relación con el instructor/piloto
}

// Interfaz para el Modal de Liquidación (Instrucción)
export interface InstructorPaymentSummary {
  instructorName: string;
  totalHorasInstruccion: number;
  montoAcumuladoUSD: number; // totalHoras * 15
  vuelosRelacionados: FlightRecordYV188E[];
}
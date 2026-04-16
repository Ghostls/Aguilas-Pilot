// ESTRUCTURA MAESTRA DE DATOS - VALKYRON OS v6.1 (ERP GRADE)
// Evolución: Núcleo Financiero, Flujo de Caja Real, Requisiciones y Estatus de Vuelo
// REGLA DE ORO: CERO OMISIONES. EVOLUCIÓN TOTAL. GRADO MILITAR.

export type HangarLocation = 'Lara' | 'Maturín' | 'Base Central';
export type TaskStatus = 'Open' | 'In Progress' | 'Completed' | 'AOG';

// --- NUEVOS TIPOS ERP (REQUISICIONES) ---
export type RequestStatus = 'PENDIENTE_REVISION' | 'APROBADO' | 'RECHAZADO' | 'COTIZANDO' | 'ORDEN_COMPRA' | 'RECIBIDO';
export type PriorityLevel = 'BAJA' | 'MEDIA' | 'CRITICA';

/**
 * Capitan: Definición del personal de mando e instrucción.
 * Evolución: Alineado con la nueva tabla 'capitanes' de Supabase.
 */
export interface Capitan {
  id: string;
  nombre: string;
  rango: string;
  tasa_instruccion: number; // Base estándar $15/h
  created_at?: Date | string;
}

/**
 * Aircraft: Definición maestra de la unidad de vuelo.
 * EVOLUCIÓN v6.1: Integración de estado 'flight' y flexibilización de locación y componentes.
 */
export interface Aircraft {
  id: string;
  tailNumber: string; 
  model: string;
  image?: string;
  // EVOLUCIÓN: Añadimos 'flight' a los estados permitidos
  status: 'operational' | 'maintenance' | 'grounded' | 'flight'; 
  location: string;
  components?: any[]; 
  hours_vuelo_totales?: number; 
}

/**
 * WorkOrder: Orden de Trabajo para MRO.
 */
export interface WorkOrder {
  id: string;
  aircraftId: string;
  location: HangarLocation;
  mechanicName: string;
  taskDescription: string;
  status: TaskStatus;
  createdAt: Date | string; 
  endTime?: Date | string; 
  observations: string;
  aircraftHoursAtService?: number;
}

/**
 * InventoryLog: Registro de despacho de repuestos.
 */
export interface InventoryLog {
  id: string;
  partNumber: string;
  description: string;
  quantity: number;
  assignedAircraft: string;
  dispatchedBy: string;
  timestamp: Date | string;
  location: HangarLocation;
  serialNumberOut?: string;
  workOrderId?: string;
  vendorId?: string;
  invoiceNumber?: string;
  arrivalDate?: Date | string;
}

/**
 * AircraftComponent: Componentes críticos con seguimiento de fatiga.
 */
export interface AircraftComponent {
  id: string;
  name: string;
  type: 'engine' | 'propeller' | 'avionics' | 'airframe' | 'other';
  serialNumber: string;
  totalTime: number;
  timeSinceOverhaul: number;
  inspectionLimit50h: number;
  inspectionLimit100h: number;
  lastServiceDate?: Date | string;
}

/**
 * Vendor: Proveedores autorizados.
 */
export interface Vendor {
  id: string;
  name: string;
  taxId: string;
  category: 'Repuestos' | 'Consumibles' | 'Servicios Técnicos' | 'Combustible';
  contactPerson: string;
  email: string;
  phone: string;
  location: string;
  rating: number;
  providedItems: string[];
}

/**
 * FuelRecord: Control estricto de carga de combustible.
 */
export interface FuelRecord {
  id: string;
  aircraftId: string;
  date: Date | string;
  gallons: number;
  location: HangarLocation;
  vendorId: string;
  ticketNumber: string;
  fuelType: 'AVGAS 100LL';
  technician: string;
  hobbsTimeAtCharge?: number;
}

/**
 * SparePart: Repuesto en inventario con valorización WAC.
 */
export interface SparePart {
  id: string;
  partNumber: string; 
  name: string;
  quantity: number;
  minStock: number;
  location: HangarLocation;
  unitPrice: number;
  category: string;
  condition?: 'New' | 'Overhauled' | 'Serviceable';
  itemId?: string; 
  certificateNumber?: string;
  lastPurchaseDate?: Date | string;
}

/**
 * FinanceTransaction: Registro contable para administración.
 * EVOLUCIÓN V6.0: dueDate opcional para compatibilidad con Libro Diario.
 */
export interface FinanceTransaction {
  id: string;
  type: 'PAYABLE' | 'RECEIVABLE' | 'INCOME' | 'EXPENSE' | 'INSTRUCTOR_PAY';
  entityName: string;
  entityId: string;
  description: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'VOID';
  issueDate: Date | string;
  dueDate?: Date | string; // <-- EVOLUCIÓN: Opcional para evitar error TS 2345
  invoiceNumber: string;
  category: 'Fuel' | 'Parts' | 'Training' | 'Maintenance' | 'Nomina' | 'Ingresos Vuelos' | 'Gastos Op' | 'Other';
  capitan_id?: string; 
  payment_method?: 'CASH' | 'ZELLE' | 'USDT' | 'BS'; 
}

/**
 * PurchaseRequest: Requisición de compra para ERP (Nuevo v6.0)
 * Trazabilidad de necesidades operativas antes de convertirse en CxP.
 */
export interface PurchaseRequest {
  id: string;
  nro_solicitud: string;
  solicitante_id?: string;
  prioridad: PriorityLevel;
  items: string; // JSON Stringified
  estatus: RequestStatus;
  hash_auditoria?: string;
  motivo_rechazo?: string;
  aprobado_por?: string;
  created_at?: string | Date;
}
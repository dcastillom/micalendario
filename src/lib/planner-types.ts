export type PlanState = "" | "si" | "no";

export interface DayEntry {
  id: string;
  asignado: string;
  plano: PlanState;
  referencia: string;
  localidad: string;
  observaciones: string;
  entregado: boolean;
}

export interface DayRecord {
  dateKey: string;
  notes: string;
  entries: DayEntry[];
  updatedAt: string;
}

export interface PlannerSettings {
  asignadoOptions: string[];
}

export type PlanState = "" | "si" | "no";
export type PlannerRole = "admin" | "editor" | "viewer";

export interface DayEntry {
  id: string;
  asignado: string;
  laborante: string;
  fechaCampo: string;
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
  localidad: string;
}

export interface PlannerVacation {
  id: string;
  person: string;
  startDate: string;
  endDate: string;
  notes: string;
  updatedAt: string;
}

export interface PlannerSettings {
  asignadoOptions: string[];
  companyName: string;
  companySubtitle: string;
  companyLogoDataUrl: string;
}

export interface PlannerUserProfile {
  id: string;
  email: string;
  role: PlannerRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

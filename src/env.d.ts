/// <reference types="astro/client" />

import type { DayRecord, PlannerSettings } from "./lib/planner-types";

declare global {
  interface Window {
    desktopPlanner?: {
      getDay: (dateKey: string) => Promise<DayRecord | null>;
      saveDay: (record: DayRecord) => Promise<DayRecord>;
      getSettings: () => Promise<PlannerSettings | null>;
      saveSettings: (settings: PlannerSettings) => Promise<PlannerSettings>;
    };
  }
}

export {};

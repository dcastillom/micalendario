/// <reference types="astro/client" />

import type { DayRecord, PlannerSettings } from "./lib/planner-types";
import type { StorageModeStatus } from "./lib/supabase-client";

interface PlannerBackupSnapshot {
  createdAt: string;
  storageMode: StorageModeStatus;
  days: Record<string, DayRecord>;
  settings: PlannerSettings;
}

declare global {
  interface Window {
    desktopPlanner?: {
      getDay: (dateKey: string) => Promise<DayRecord | null>;
      getAllDays: () => Promise<Record<string, DayRecord>>;
      getDaysForMonth: (monthKey: string) => Promise<Record<string, DayRecord>>;
      saveDay: (record: DayRecord) => Promise<DayRecord>;
      getSettings: () => Promise<PlannerSettings | null>;
      saveSettings: (settings: PlannerSettings) => Promise<PlannerSettings>;
      saveBackup: (snapshot: PlannerBackupSnapshot) => Promise<{ filePath: string; createdAt: string }>;
      openBackupFolder: () => Promise<string>;
      selectBackup: () => Promise<PlannerBackupSnapshot | null>;
      replaceData: (snapshot: PlannerBackupSnapshot) => Promise<{ dayCount: number }>;
    };
  }
}

export {};

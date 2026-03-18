import type { PlannerSettings } from "./planner-types";

export const PLANNER_SETTINGS_UPDATED_EVENT = "planner:settings-updated";
export const PLANNER_TOGGLE_BRAND_EDITOR_EVENT = "planner:toggle-brand-editor";
export const PLANNER_BRAND_EDITOR_STATE_EVENT = "planner:brand-editor-state";
export const PLANNER_AGENDA_HEADER_STATE_EVENT = "planner:agenda-header-state";
export const PLANNER_AGENDA_REFERENCE_FILTER_EVENT =
  "planner:agenda-reference-filter";

export type PlannerAgendaViewMode = "day" | "month";

export interface PlannerAgendaHeaderState {
  viewMode: PlannerAgendaViewMode;
  referenceFilter: string;
}

export function dispatchPlannerSettingsUpdated(settings: PlannerSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlannerSettings>(PLANNER_SETTINGS_UPDATED_EVENT, {
      detail: settings,
    }),
  );
}

export function dispatchPlannerToggleBrandEditor() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PLANNER_TOGGLE_BRAND_EDITOR_EVENT));
}

export function dispatchPlannerBrandEditorState(isOpen: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<boolean>(PLANNER_BRAND_EDITOR_STATE_EVENT, {
      detail: isOpen,
    }),
  );
}

export function dispatchPlannerAgendaHeaderState(
  state: PlannerAgendaHeaderState,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<PlannerAgendaHeaderState>(PLANNER_AGENDA_HEADER_STATE_EVENT, {
      detail: state,
    }),
  );
}

export function dispatchPlannerAgendaReferenceFilter(value: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<string>(PLANNER_AGENDA_REFERENCE_FILTER_EVENT, {
      detail: value,
    }),
  );
}

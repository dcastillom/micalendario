import type { PlannerSettings } from "./planner-types";

export const PLANNER_SETTINGS_UPDATED_EVENT = "planner:settings-updated";
export const PLANNER_TOGGLE_BRAND_EDITOR_EVENT = "planner:toggle-brand-editor";
export const PLANNER_BRAND_EDITOR_STATE_EVENT = "planner:brand-editor-state";

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

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ASIGNADO_OPTIONS = ["Bea", "Cris", "Gloria", "Alfredo", "Yo"];

function sortAsignadoOptions(options) {
  return [...options].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" })
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PlannerStore {
  constructor(app) {
    this.filePath = path.join(app.getPath("userData"), "planner-store.json");
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return this.normalize(JSON.parse(raw));
    } catch {
      return this.normalize({
        version: 1,
        days: {}
      });
    }
  }

  normalize(data) {
    const asignadoOptions = Array.isArray(data?.settings?.asignadoOptions)
      ? data.settings.asignadoOptions
      : Array.isArray(data?.settings?.pedidoOptions)
        ? data.settings.pedidoOptions
        : [...DEFAULT_ASIGNADO_OPTIONS];

    return {
      version: 2,
      days: Object.fromEntries(
        Object.entries(data?.days ?? {}).map(([dateKey, day]) => [
          dateKey,
          {
            ...day,
            entries: Array.isArray(day?.entries)
              ? day.entries.map((entry) => ({
                  ...entry,
                  asignado: entry.asignado ?? entry.pedido ?? ""
                }))
              : []
          }
        ])
      ),
      settings: {
        asignadoOptions: sortAsignadoOptions(
          [...new Set(asignadoOptions.map((option) => String(option).trim()).filter(Boolean))].length > 0
            ? [...new Set(asignadoOptions.map((option) => String(option).trim()).filter(Boolean))]
            : [...DEFAULT_ASIGNADO_OPTIONS]
        )
      }
    };
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  getDay(dateKey) {
    return this.data.days[dateKey] ? clone(this.data.days[dateKey]) : null;
  }

  getDaysForMonth(monthKey) {
    return clone(
      Object.fromEntries(
        Object.entries(this.data.days).filter(([dateKey]) => dateKey.startsWith(`${monthKey}-`))
      )
    );
  }

  saveDay(record) {
    this.data.days[record.dateKey] = clone(record);
    this.persist();
    return this.getDay(record.dateKey);
  }

  getSettings() {
    return clone(this.data.settings);
  }

  saveSettings(settings) {
    this.data.settings = this.normalize({ settings }).settings;
    this.persist();
    return this.getSettings();
  }
}

module.exports = {
  PlannerStore
};

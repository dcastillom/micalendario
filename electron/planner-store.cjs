const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ASIGNADO_OPTIONS = ["Bea", "Cris", "Gloria", "Alfredo", "Yo"];
const BACKUP_FILE_PREFIX = "planner-backup-";
const MAX_BACKUP_FILES = 30;

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
    this.backupDir = path.join(app.getPath("userData"), "backups");
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

  saveBackup(snapshot) {
    fs.mkdirSync(this.backupDir, { recursive: true });

    const safeTimestamp = new Date(snapshot.createdAt ?? Date.now()).toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(this.backupDir, `${BACKUP_FILE_PREFIX}${safeTimestamp}.json`);
    const payload = {
      version: 1,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
      storageMode: snapshot.storageMode ?? "unknown",
      days: clone(snapshot.days ?? {}),
      settings: clone(snapshot.settings ?? {})
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    this.pruneBackups();

    return {
      filePath,
      createdAt: payload.createdAt
    };
  }

  pruneBackups() {
    const backupFiles = fs
      .readdirSync(this.backupDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(BACKUP_FILE_PREFIX) && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const fileName of backupFiles.slice(MAX_BACKUP_FILES)) {
      fs.unlinkSync(path.join(this.backupDir, fileName));
    }
  }

  getBackupDir() {
    fs.mkdirSync(this.backupDir, { recursive: true });
    return this.backupDir;
  }

  readBackup(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      createdAt: typeof parsed?.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      storageMode: typeof parsed?.storageMode === "string" ? parsed.storageMode : "local",
      days: clone(parsed?.days ?? {}),
      settings: clone(parsed?.settings ?? {})
    };
  }

  replaceData(snapshot) {
    this.data = this.normalize({
      version: 2,
      days: snapshot?.days ?? {},
      settings: snapshot?.settings ?? {}
    });
    this.persist();

    return {
      dayCount: Object.keys(this.data.days).length
    };
  }

  getDay(dateKey) {
    return this.data.days[dateKey] ? clone(this.data.days[dateKey]) : null;
  }

  getAllDays() {
    return clone(this.data.days);
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

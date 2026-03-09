const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPlanner", {
  getDay: (dateKey) => ipcRenderer.invoke("planner:get-day", dateKey),
  getAllDays: () => ipcRenderer.invoke("planner:get-all-days"),
  getDaysForMonth: (monthKey) => ipcRenderer.invoke("planner:get-days-for-month", monthKey),
  saveDay: (record) => ipcRenderer.invoke("planner:save-day", record),
  getSettings: () => ipcRenderer.invoke("planner:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("planner:save-settings", settings),
  saveBackup: (snapshot) => ipcRenderer.invoke("planner:save-backup", snapshot),
  openBackupFolder: () => ipcRenderer.invoke("planner:open-backup-folder"),
  selectBackup: () => ipcRenderer.invoke("planner:select-backup"),
  replaceData: (snapshot) => ipcRenderer.invoke("planner:replace-data", snapshot)
});

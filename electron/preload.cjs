const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPlanner", {
  getDay: (dateKey) => ipcRenderer.invoke("planner:get-day", dateKey),
  getDaysForMonth: (monthKey) => ipcRenderer.invoke("planner:get-days-for-month", monthKey),
  saveDay: (record) => ipcRenderer.invoke("planner:save-day", record),
  getSettings: () => ipcRenderer.invoke("planner:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("planner:save-settings", settings)
});

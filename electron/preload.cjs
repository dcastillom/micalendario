const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPlanner", {
  getDay: (dateKey) => ipcRenderer.invoke("planner:get-day", dateKey),
  saveDay: (record) => ipcRenderer.invoke("planner:save-day", record),
  getSettings: () => ipcRenderer.invoke("planner:get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("planner:save-settings", settings)
});

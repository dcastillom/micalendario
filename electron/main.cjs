const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { PlannerStore } = require("./planner-store.cjs");

let plannerStore;

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#efe1cd",
    title: "Mi Calendario",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.DEV_SERVER_URL;

  if (devServerUrl) {
    window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  plannerStore = new PlannerStore(app);

  ipcMain.handle("planner:get-day", (_event, dateKey) => plannerStore.getDay(dateKey));
  ipcMain.handle("planner:get-days-for-month", (_event, monthKey) => plannerStore.getDaysForMonth(monthKey));
  ipcMain.handle("planner:save-day", (_event, record) => plannerStore.saveDay(record));
  ipcMain.handle("planner:get-settings", () => plannerStore.getSettings());
  ipcMain.handle("planner:save-settings", (_event, settings) => plannerStore.saveSettings(settings));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

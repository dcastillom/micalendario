const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { PlannerStore } = require("./planner-store.cjs");

let plannerStore;
let staticServer;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function getContentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function resolveStaticFile(distRoot, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidatePath = path.resolve(distRoot, requestedPath);

  if (!candidatePath.startsWith(distRoot)) {
    return path.join(distRoot, "index.html");
  }

  const possiblePaths = [candidatePath];

  if (!path.extname(candidatePath)) {
    possiblePaths.push(`${candidatePath}.html`);
    possiblePaths.push(path.join(candidatePath, "index.html"));
  }

  for (const possiblePath of possiblePaths) {
    if (!fs.existsSync(possiblePath)) {
      continue;
    }

    const stats = fs.statSync(possiblePath);

    if (stats.isFile()) {
      return possiblePath;
    }

    if (stats.isDirectory()) {
      const nestedIndexPath = path.join(possiblePath, "index.html");

      if (fs.existsSync(nestedIndexPath) && fs.statSync(nestedIndexPath).isFile()) {
        return nestedIndexPath;
      }
    }
  }

  return path.join(distRoot, "index.html");
}

async function startStaticServer() {
  if (staticServer) {
    const address = staticServer.address();
    return `http://127.0.0.1:${address.port}`;
  }

  const distRoot = path.join(__dirname, "..", "dist");

  staticServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const filePath = resolveStaticFile(distRoot, pathname);

    fs.readFile(filePath, (error, fileBuffer) => {
      if (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("No se pudo cargar la aplicacion.");
        return;
      }

      response.writeHead(200, { "Content-Type": getContentType(filePath) });
      response.end(fileBuffer);
    });
  });

  await new Promise((resolve, reject) => {
    staticServer.once("error", reject);
    staticServer.listen(0, "127.0.0.1", () => {
      staticServer.off("error", reject);
      resolve();
    });
  });

  const address = staticServer.address();
  return `http://127.0.0.1:${address.port}`;
}

async function createWindow() {
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

  if (process.platform !== "darwin") {
    window.setMenuBarVisibility(false);
    window.autoHideMenuBar = true;
  }

  const devServerUrl = process.env.DEV_SERVER_URL;

  if (devServerUrl) {
    window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  const appUrl = await startStaticServer();
  window.loadURL(appUrl);
}

app.whenReady().then(async () => {
  plannerStore = new PlannerStore(app);

  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
  }

  ipcMain.handle("planner:get-day", (_event, dateKey) => plannerStore.getDay(dateKey));
  ipcMain.handle("planner:get-all-days", () => plannerStore.getAllDays());
  ipcMain.handle("planner:get-days-for-month", (_event, monthKey) => plannerStore.getDaysForMonth(monthKey));
  ipcMain.handle("planner:save-day", (_event, record) => plannerStore.saveDay(record));
  ipcMain.handle("planner:get-settings", () => plannerStore.getSettings());
  ipcMain.handle("planner:save-settings", (_event, settings) => plannerStore.saveSettings(settings));
  ipcMain.handle("planner:save-backup", (_event, snapshot) => plannerStore.saveBackup(snapshot));
  ipcMain.handle("planner:open-backup-folder", async () => {
    const backupDir = plannerStore.getBackupDir();
    const errorMessage = await shell.openPath(backupDir);

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return backupDir;
  });
  ipcMain.handle("planner:select-backup", async () => {
    const backupDir = plannerStore.getBackupDir();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Selecciona una copia de seguridad",
      defaultPath: backupDir,
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (canceled || filePaths.length === 0) {
      return null;
    }

    return plannerStore.readBackup(filePaths[0]);
  });
  ipcMain.handle("planner:replace-data", (_event, snapshot) => plannerStore.replaceData(snapshot));

  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("will-quit", () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

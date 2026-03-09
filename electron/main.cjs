const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
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

async function startStaticServer() {
  if (staticServer) {
    const address = staticServer.address();
    return `http://127.0.0.1:${address.port}`;
  }

  const distRoot = path.join(__dirname, "..", "dist");

  staticServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidatePath = path.resolve(distRoot, requestedPath);
    const safePath = candidatePath.startsWith(distRoot) ? candidatePath : path.join(distRoot, "index.html");
    const filePath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(distRoot, "index.html");

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

  ipcMain.handle("planner:get-day", (_event, dateKey) => plannerStore.getDay(dateKey));
  ipcMain.handle("planner:get-all-days", () => plannerStore.getAllDays());
  ipcMain.handle("planner:get-days-for-month", (_event, monthKey) => plannerStore.getDaysForMonth(monthKey));
  ipcMain.handle("planner:save-day", (_event, record) => plannerStore.saveDay(record));
  ipcMain.handle("planner:get-settings", () => plannerStore.getSettings());
  ipcMain.handle("planner:save-settings", (_event, settings) => plannerStore.saveSettings(settings));

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

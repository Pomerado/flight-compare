import { join } from "node:path";
import { app, BrowserWindow, ipcMain, net, safeStorage, shell } from "electron";
import { createPomeradoMain, type PomeradoMain } from "pomerado-app-kit/main";
import { COPY } from "../shared/copy";

const APP_NAME = COPY.appName;

// A separate profile folder, for tests and for running two copies side by side.
if (process.env.FLIGHT_COMPARE_USER_DATA) app.setPath("userData", process.env.FLIGHT_COMPARE_USER_DATA);
app.setName(APP_NAME);

let pomerado: PomeradoMain | null = null;
let quitting = false;

const isHttps = (url: string) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  // Links open in the system browser. The window itself never leaves the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServer) void window.loadURL(devServer);
  else void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

void app.whenReady().then(() => {
  pomerado = createPomeradoMain({
    appName: APP_NAME,
    userDataPath: app.getPath("userData"),
    ipcMain,
    safeStorage,
    // Looked up on each call, so it always uses Electron's current shell.
    openExternal: (url) => shell.openExternal(url),
    fetch: (url, init) => net.fetch(url, init),
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Searches still running are cancelled before the app goes, so they don't use runs for nothing.
app.on("before-quit", (event) => {
  if (quitting || !pomerado) return;
  event.preventDefault();
  quitting = true;
  void pomerado.cancelAll().finally(() => app.quit());
});

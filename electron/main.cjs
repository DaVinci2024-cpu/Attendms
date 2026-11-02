// Electron main process. Written as plain CommonJS on purpose (.cjs
// extension) so it works regardless of the rest of the project's module
// settings. Structurally ported from retailrp/electron/main.cjs — same
// spawn/health-check/single-instance/auto-update shape — adapted for a
// Next.js "standalone" server instead of a bundled Express one.
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

// Must stay in agreement with RESTART_EXIT_CODE wherever a future server
// route (Phase 2's Firebase-config save, Phase 4's LAN pairing-code change)
// needs to restart the app cleanly — see retailrp's
// firebaseConfigController.ts/lanSyncController.ts for that pattern, not yet
// ported here since Phase 0 has no such routes.
const RESTART_EXIT_CODE = 42;

// How often to re-check for updates while the app stays open (a kiosk can
// stay running for days/weeks between reboots). This only checks a static
// file on the update server — cheap and safe to do fairly often.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

let serverProcess = null;
let mainWindow = null;
let updateCheckTimer = null;

// In dev, the app's files live in the project root (one level up from
// electron/). Packaged by electron-builder, everything ships under
// process.resourcesPath/app instead — see the "files"/"extraResources"
// config in package.json's "build" section.
function getAppRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');
}

function startServer() {
  const appRoot = getAppRoot();
  // next build (output: "standalone") traces its own dependencies into this
  // one folder — see next.config.ts and scripts/copy-standalone-assets.mjs —
  // so this spawn needs nothing from the project's own node_modules at
  // runtime, same shape as retailrp's dist/server.cjs.
  const serverEntry = path.join(appRoot, '.next', 'standalone', 'server.js');

  // Run the bundled server with Electron's own binary acting as plain
  // Node.js (ELECTRON_RUN_AS_NODE) — this is what lets a client run this
  // without installing Node.js separately at all.
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: 'localhost',
    },
    stdio: 'pipe',
  });

  // A packaged GUI app has no visible console — console.log/error here goes
  // nowhere. electron-log's file transport is what makes any of this
  // recoverable after the fact (Help menu or %USERPROFILE%\AppData\Roaming\
  // Attendms\logs\main.log on Windows).
  serverProcess.stdout.on('data', (data) => log.info(`[server] ${data}`.trimEnd()));
  serverProcess.stderr.on('data', (data) => log.error(`[server] ${data}`.trimEnd()));
  serverProcess.on('exit', (code) => {
    if (code === RESTART_EXIT_CODE) {
      log.info('Local server requested a restart — relaunching.');
      app.relaunch();
      app.exit(0);
      return;
    }
    log.error(`Local server exited unexpectedly with code ${code}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Attendms server stopped',
        'The local server stopped unexpectedly. Please restart the app.'
      );
    }
  });
}

function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get(`${SERVER_URL}/api/ping`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('The local server did not start in time.'));
        } else {
          setTimeout(poll, 300);
        }
      });
    })();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Attendms',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await waitForServer();
    await mainWindow.loadURL(SERVER_URL);
  } catch (err) {
    dialog.showErrorBox(
      'Could not start Attendms',
      `The local server failed to start: ${err.message}`
    );
  }
}

// --- Auto-update -----------------------------------------------------------
//
// Non-negotiable: the kiosk must stay fully usable offline, and updating
// must never interrupt someone mid-punch. So the policy here is:
//   - Check for updates on startup, then every few hours while running.
//   - If a newer version is found, download it silently in the background.
//   - Never prompt, never force a restart. The new version is only installed
//     the next time the app quits/restarts on its own (autoInstallOnAppQuit),
//     e.g. after a scheduled kiosk reboot.
//   - Any failure (offline, DNS failure, update server unreachable, no
//     publish URL configured) is caught and logged only — it must never
//     surface an error dialog or block anyone trying to punch in/out.
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  log.info('[updater] checking for update');
});

autoUpdater.on('update-available', (info) => {
  log.info(`[updater] update available: ${info.version} — downloading in background`);
});

autoUpdater.on('update-not-available', () => {
  log.info('[updater] already on the latest version');
});

autoUpdater.on('update-downloaded', (info) => {
  log.info(`[updater] update ${info.version} downloaded — will install next time the app restarts`);
});

autoUpdater.on('error', (err) => {
  // Deliberately silent to the user: this fires constantly for perfectly
  // normal reasons (no internet right now, no update server configured yet
  // for this client, etc.) and must never interrupt kiosk use.
  log.warn(`[updater] update check failed (ignored): ${err == null ? err : err.message}`);
});

function checkForUpdatesSafely() {
  if (!app.isPackaged) return; // no update feed / signed build in dev
  try {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn(`[updater] checkForUpdates rejected (ignored): ${err.message}`);
    });
  } catch (err) {
    log.warn(`[updater] checkForUpdates threw (ignored): ${err.message}`);
  }
}

function startUpdateChecks() {
  // First check shortly after launch (give the app a moment to settle),
  // then repeat periodically for as long as the app stays open.
  setTimeout(checkForUpdatesSafely, 10_000);
  updateCheckTimer = setInterval(checkForUpdatesSafely, UPDATE_CHECK_INTERVAL_MS);
}

// Prevent a second copy from launching a second server on the same port —
// matters even more on a kiosk than on a shop PC, since nobody's watching to
// notice two icons running.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startServer();
    createWindow();
    startUpdateChecks();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

app.on('before-quit', stopServer);
app.on('will-quit', stopServer);

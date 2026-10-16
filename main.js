const { app, BrowserWindow, globalShortcut, ipcMain, screen, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { collect } = require('./usage');

const DEFAULT_HOTKEY = 'CommandOrControl+Shift+U';
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const WIDTH = 280;
const USAGE_REFRESH_MS = 3000;
let win;
let hotkey;
let position;
let positionSaveTimer;

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

function saveConfig(patch) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), ...patch }));
}

function loadHotkey() {
  return readConfig().hotkey || DEFAULT_HOTKEY;
}

function loadPosition() {
  const p = readConfig().position;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

// Swap the global shortcut; keep the old one if the new one is taken by another app.
function setHotkey(next) {
  globalShortcut.unregisterAll();
  let ok = false;
  try { ok = globalShortcut.register(next, toggle); } catch { /* invalid accelerator */ }
  if (!ok) {
    if (hotkey) globalShortcut.register(hotkey, toggle);
    return false;
  }
  hotkey = next;
  saveConfig({ hotkey });
  return true;
}

function clampPosition(p) {
  const [w, h] = win.getSize();
  const d = screen.getDisplayNearestPoint({ x: p.x + w / 2, y: p.y + h / 2 });
  const a = d.workArea;
  return {
    x: Math.max(a.x, Math.min(p.x, a.x + a.width - w)),
    y: Math.max(a.y, Math.min(p.y, a.y + a.height - h)),
  };
}

// Restore the user's position, or dock to the current screen the first time.
function dock() {
  if (position) {
    position = clampPosition(position);
  } else {
    const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [w, h] = win.getSize();
    position = { x: a.x + a.width - w - 12, y: a.y + Math.round((a.height - h) / 2) };
  }
  win.setPosition(position.x, position.y);
}

function toggle() {
  if (win.isVisible()) return win.hide();
  dock();
  win.webContents.send('refresh');
  win.showInactive(); // don't steal focus from the editor
}

if (!app.requestSingleInstanceLock()) app.quit();
// Starting the app again while it runs shows the overlay instead of silently exiting.
app.on('second-instance', () => { if (win && !win.isVisible()) toggle(); });

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  position = loadPosition();
  // The overlay never needs camera, mic, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  win = new BrowserWindow({
    width: WIDTH,
    height: 480,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('move', () => {
    position = { x: win.getPosition()[0], y: win.getPosition()[1] };
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(() => saveConfig({ position }), 200);
  });
  win.loadFile('index.html');

  // AGENT_USAGE_HUD_HOME points at another home folder (used for demo screenshots).
  ipcMain.handle('usage', () => ({ ...collect({ home: process.env.AGENT_USAGE_HUD_HOME || undefined }), hotkey }));
  ipcMain.handle('begin-key-capture', () => {
    if (hotkey) globalShortcut.unregister(hotkey);
    return true;
  });
  ipcMain.handle('cancel-key-capture', () => hotkey && globalShortcut.register(hotkey, toggle));
  ipcMain.handle('set-hotkey', (_e, acc) => typeof acc === 'string' && acc.length < 64 && setHotkey(acc));
  // Fit the window to the panel so no invisible area blocks clicks underneath.
  ipcMain.on('resize', (_e, h) => { win.setSize(WIDTH, Math.min(Math.max(Math.round(h) || 0, 100), 1000)); dock(); });
  ipcMain.on('hide', () => win.hide());
  ipcMain.on('quit', () => app.quit());

  // Local agent logs update during and after turns. Refresh only while visible.
  setInterval(() => {
    if (win && !win.isDestroyed() && win.isVisible() && !win.webContents.isLoading()) win.webContents.send('refresh');
  }, USAGE_REFRESH_MS);

  if (setHotkey(loadHotkey()) || setHotkey(DEFAULT_HOTKEY)) {
    console.log(`agent-usage-hud running. Press ${hotkey} to toggle.`);
  } else {
    console.error('Could not register a hotkey (another app owns it). Pick one with the "key" button.');
  }
  // Show once at start so people see it works and where the key setting is.
  win.once('ready-to-show', toggle);
});

app.on('will-quit', () => globalShortcut.unregisterAll());

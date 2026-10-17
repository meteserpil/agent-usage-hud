const { app, BrowserWindow, globalShortcut, ipcMain, screen, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collect } = require('./usage');

const DEFAULT_HOTKEY = 'CommandOrControl+Shift+U';
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const CLAUDE_STATUSLINE_HELPER = 'agent-usage-hud-statusline.js';
const WIDTH = 280;
const USAGE_REFRESH_MS = 60_000;
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

function claudeConfigDir() {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  return configDir
    ? path.resolve(configDir.replace(/^~(?=$|[\\/])/, os.homedir()))
    : path.join(os.homedir(), '.claude');
}

function claudeSettingsFile() { return path.join(claudeConfigDir(), 'settings.json'); }

function readClaudeSettings() {
  const file = claudeSettingsFile();
  if (!fs.existsSync(file)) return { file, settings: {} };
  const settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Claude settings.json must contain a JSON object.');
  return { file, settings };
}

function isHudStatusLine(value) {
  const command = value && typeof value.command === 'string' ? value.command : '';
  return /(?:agent-usage-hud-statusline|claude-statusline)\.js/i.test(command);
}

function claudeStatusLineState() {
  try {
    const { settings } = readClaudeSettings();
    if (!settings.statusLine) return 'missing';
    return isHudStatusLine(settings.statusLine) ? 'configured' : 'conflict';
  } catch {
    return 'invalid';
  }
}

function installClaudeStatusLine({ combineExisting = false } = {}) {
  let file, settings;
  try { ({ file, settings } = readClaudeSettings()); }
  catch (error) {
    const invalidSettings = error instanceof SyntaxError || error.message === 'Claude settings.json must contain a JSON object.';
    return {
      ok: false,
      exitCode: invalidSettings ? 2 : 1,
      message: `Could not read Claude settings: ${error.message}`
    };
  }

  const current = settings.statusLine;
  const hasExistingStatusLine = current && !isHudStatusLine(current);
  if (hasExistingStatusLine && !combineExisting) {
    return { ok: false, exitCode: 3, message: 'Claude already has a different status line. It was left unchanged.' };
  }
  if (hasExistingStatusLine && (current.type !== 'command' || typeof current.command !== 'string' || !current.command.trim())) {
    return { ok: false, exitCode: 5, message: 'Only command-based Claude status lines can be combined. The existing setting was left unchanged.' };
  }

  const helperDir = claudeConfigDir();
  const helperFile = path.join(helperDir, CLAUDE_STATUSLINE_HELPER);
  const wrapperConfigFile = path.join(helperDir, 'agent-usage-hud-statusline.json');
  const sourceFile = app.isPackaged
    ? path.join(process.resourcesPath, 'claude-statusline.js')
    : path.join(__dirname, 'claude-statusline.js');
  const wrapperWasCreated = !!hasExistingStatusLine;
  let previousWrapperConfig = null;
  try {
    fs.mkdirSync(helperDir, { recursive: true });
    if (fs.existsSync(helperFile) && !fs.readFileSync(helperFile, 'utf8').includes('Installed and updated by agent-usage-hud')) {
      return { ok: false, exitCode: 4, message: 'The HUD status line helper already exists and was left unchanged.' };
    }
    if (wrapperWasCreated && fs.existsSync(wrapperConfigFile)) {
      previousWrapperConfig = fs.readFileSync(wrapperConfigFile, 'utf8');
      if (!previousWrapperConfig.includes('agent-usage-hud')) {
        return { ok: false, exitCode: 4, message: 'A Claude status line wrapper config already exists and was left unchanged.' };
      }
    }
    fs.copyFileSync(sourceFile, helperFile);
  } catch (error) {
    return { ok: false, exitCode: 1, message: `Could not install the Claude status line helper: ${error.message}` };
  }

  const commandPath = process.platform === 'win32' ? helperFile.replace(/\\/g, '/') : helperFile;
  const helperCommand = process.platform === 'win32'
    ? `node "${commandPath.replace(/"/g, '\\"')}"`
    : `node '${commandPath.replace(/'/g, "'\\''")}'`;
  const next = { ...settings };
  next.statusLine = { ...(current || {}), type: 'command', command: helperCommand };
  const wrapperTemp = `${wrapperConfigFile}.${process.pid}.tmp`;
  if (wrapperWasCreated) {
    try {
      fs.writeFileSync(wrapperTemp, JSON.stringify({ installedBy: 'agent-usage-hud', existingCommand: current.command }), 'utf8');
      try {
        fs.renameSync(wrapperTemp, wrapperConfigFile);
      } catch (error) {
        if (process.platform !== 'win32' || previousWrapperConfig === null) throw error;
        fs.writeFileSync(wrapperConfigFile, fs.readFileSync(wrapperTemp, 'utf8'), 'utf8');
        fs.unlinkSync(wrapperTemp);
      }
    } catch (error) {
      try { fs.unlinkSync(wrapperTemp); } catch { /* no temporary file remains */ }
      return { ok: false, exitCode: 1, message: `Could not prepare the Claude status line wrapper: ${error.message}` };
    }
  }

  if (current && JSON.stringify(current) === JSON.stringify(next.statusLine)) {
    return { ok: true, message: 'Claude limit tracking is already set up. Start or resume Claude Code to load the latest limits.' };
  }

  const existed = fs.existsSync(file);
  const temp = `${file}.${process.pid}.tmp`;
  let backup = '';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const mode = existed ? fs.statSync(file).mode : 0o600;
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode });
    if (existed) {
      backup = `${file}.agent-usage-hud-${Date.now()}.bak`;
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    }
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      if (process.platform !== 'win32' || !existed) throw error;
      fs.writeFileSync(file, fs.readFileSync(temp, 'utf8'), 'utf8');
      fs.unlinkSync(temp);
    }
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* no temporary file remains */ }
    if (wrapperWasCreated) {
      try {
        if (previousWrapperConfig === null) fs.unlinkSync(wrapperConfigFile);
        else fs.writeFileSync(wrapperConfigFile, previousWrapperConfig, 'utf8');
      } catch { /* keep the original Claude settings intact */ }
    }
    if (backup && process.platform === 'win32') {
      try { fs.copyFileSync(backup, file); } catch { /* retain the backup for manual recovery */ }
    }
    return { ok: false, exitCode: 1, message: `Could not update Claude settings: ${error.message}` };
  }
  const backupNote = backup ? ` Backup saved as ${path.basename(backup)}.` : '';
  return { ok: true, message: `Claude limit tracking is set up. Start or resume Claude Code to load the latest limits.${backupNote}` };
}

function loadHotkey() {
  return readConfig().hotkey || DEFAULT_HOTKEY;
}

function loadPosition() {
  const p = readConfig().position;
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

function loginItemOptions() {
  if (process.platform !== 'win32') return {};
  return {
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  };
}

function getStartAtLogin() {
  if (!['win32', 'darwin'].includes(process.platform)) return false;
  try { return app.getLoginItemSettings(loginItemOptions()).openAtLogin; } catch { return false; }
}

function setStartAtLogin(enabled) {
  if (!['win32', 'darwin'].includes(process.platform)) {
    return { ok: false, supported: false, enabled: false, message: 'Start at login is supported on Windows and macOS.' };
  }
  try {
    app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: enabled });
    const actual = getStartAtLogin();
    const ok = actual === enabled;
    const macNote = process.platform === 'darwin'
      ? ' macOS may require a signed and notarized app for this setting to work reliably.'
      : '';
    return {
      ok,
      supported: true,
      enabled: actual,
      message: ok ? '' : `The system did not confirm the login setting.${macNote}`
    };
  } catch (error) {
    return { ok: false, supported: true, enabled: getStartAtLogin(), message: `Could not change start-at-login setting: ${error.message}` };
  }
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

const setupClaudeOnly = process.argv.includes('--setup-claude');
if (!setupClaudeOnly && !app.requestSingleInstanceLock()) app.quit();
// Starting the app again while it runs shows the overlay instead of silently exiting.
if (!setupClaudeOnly) app.on('second-instance', () => { if (win && !win.isVisible()) toggle(); });

app.whenReady().then(() => {
  if (setupClaudeOnly) {
    const result = installClaudeStatusLine();
    if (!result.ok) console.warn(`Claude limit setup: ${result.message}`);
    app.exit(result.ok ? 0 : (result.exitCode || 1));
    return;
  }
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
  ipcMain.handle('usage', () => ({
    ...collect({ home: process.env.AGENT_USAGE_HUD_HOME || undefined }),
    hotkey,
    claudeStatusLine: claudeStatusLineState(),
    startAtLogin: getStartAtLogin(),
    canStartAtLogin: ['win32', 'darwin'].includes(process.platform),
  }));
  ipcMain.handle('setup-claude-limits', (_e, combineExisting) => installClaudeStatusLine({ combineExisting: combineExisting === true }));
  ipcMain.handle('set-start-at-login', (_e, enabled) => setStartAtLogin(enabled === true));
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

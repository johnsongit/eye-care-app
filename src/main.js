const { app, BrowserWindow, ipcMain, Tray, Menu, screen, powerMonitor, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const native = require('./native');

const MINUTE_MS = Number(process.env.EYECARE_MINUTE_MS) || 60000;
const REST_SECONDS = 5 * 60;
const IDLE_RESET_SECONDS = 5 * 60;
const OVERLAY_ALPHA = [0.06, 0.11, 0.16, 0.21, 0.26];
const BEAN_GREEN = '204 232 207';

const DEFAULTS = {
  eyeExitFullscreen: false,
  blueLight: true,
  intensity: 3,
  blueMode: 'always',
  blueStart: '',
  blueEnd: '',
  beanGreen: false,
  originalWindowColor: null,
  alarmDnd: false,
  rest: true,
  restInterval: 60,
  shutdown: false,
  shutdownMode: 'remind',
  shutdownTime: '19:00',
  hiddenTipShown: false,
};

let settings = { ...DEFAULTS };
let settingsFile;
let mainWin = null;
let reminderWin = null;
let tray = null;
let overlays = [];
let fullscreen = false;
let stopWatcher = null;
let quitting = false;

const rest = { activeMs: 0, lastTick: Date.now(), reminding: false };
const shutdownState = { lastFired: '', snoozeUntil: 0, pending: false };

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('save settings failed', e);
  }
}

function minutesOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function nowHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function inBlueSchedule() {
  if (settings.blueMode === 'always') return true;
  const s = minutesOfDay(settings.blueStart);
  const e = minutesOfDay(settings.blueEnd);
  if (s === null || e === null || s === e) return false;
  const d = new Date();
  const n = d.getHours() * 60 + d.getMinutes();
  return s < e ? n >= s && n < e : n >= s || n < e;
}

function overlayShouldShow() {
  return settings.blueLight && inBlueSchedule() && !(settings.eyeExitFullscreen && fullscreen);
}

function getState() {
  const intervalMs = settings.restInterval * MINUTE_MS;
  return {
    settings,
    status: {
      fullscreen,
      overlayActive: overlayShouldShow(),
      usedMinutes: Math.floor(rest.activeMs / MINUTE_MS),
      nextRestMinutes: Math.max(0, Math.ceil((intervalMs - rest.activeMs) / MINUTE_MS)),
    },
  };
}

function broadcast() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state', getState());
  refreshTrayMenu();
}

/* ---------------- blue light overlay ---------------- */

function overlayHtml(alpha) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<html><body style="margin:0;background:rgba(255,140,0,${alpha});"></body></html>`
  )}`;
}

function destroyOverlays() {
  overlays.forEach((w) => !w.isDestroyed() && w.destroy());
  overlays = [];
}

function createOverlays() {
  destroyOverlays();
  const alpha = OVERLAY_ALPHA[Math.min(5, Math.max(1, settings.intensity)) - 1];
  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.bounds;
    const w = new BrowserWindow({
      x, y, width, height,
      transparent: true,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    w.setIgnoreMouseEvents(true);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true);
    w.loadURL(overlayHtml(alpha));
    w.once('ready-to-show', () => {
      w.setBounds({ x, y, width, height });
      w.showInactive();
    });
    overlays.push(w);
  }
}

let overlayKey = '';
function applyOverlay() {
  const show = overlayShouldShow();
  const key = show ? `on:${settings.intensity}` : 'off';
  if (key === overlayKey) return;
  overlayKey = key;
  if (show) createOverlays();
  else destroyOverlays();
}

/* ---------------- bean green ---------------- */

let beanApplied = null;
async function applyBeanGreen() {
  if (beanApplied === settings.beanGreen) return;
  beanApplied = settings.beanGreen;
  try {
    if (settings.beanGreen) {
      if (!settings.originalWindowColor) {
        const current = await native.readWindowColor();
        settings.originalWindowColor = current === BEAN_GREEN ? '255 255 255' : current;
        saveSettings();
      }
      await native.setWindowColor(BEAN_GREEN);
    } else if (settings.originalWindowColor) {
      await native.setWindowColor(settings.originalWindowColor);
      settings.originalWindowColor = null;
      saveSettings();
    }
  } catch (e) {
    console.error('bean green failed', e);
  }
}

/* ---------------- fullscreen watcher ---------------- */

function applyWatcher() {
  const needed = settings.eyeExitFullscreen || settings.alarmDnd;
  if (needed && !stopWatcher) {
    stopWatcher = native.startFullscreenWatcher((fs) => {
      fullscreen = fs;
      applyOverlay();
      if (!fs) flushPendingReminders();
      broadcast();
    });
  } else if (!needed && stopWatcher) {
    stopWatcher();
    stopWatcher = null;
    fullscreen = false;
  }
}

function dndActive() {
  return settings.alarmDnd && fullscreen;
}

/* ---------------- reminder window ---------------- */

function showReminder(data) {
  const open = () => {
    reminderWin.webContents.send('reminder', data);
    reminderWin.show();
    reminderWin.focus();
  };
  if (reminderWin && !reminderWin.isDestroyed()) return open();
  const { workArea } = screen.getPrimaryDisplay();
  const width = 440;
  const height = 300;
  reminderWin = new BrowserWindow({
    width, height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: false,
    show: false,
    title: '健康小助手',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  reminderWin.setAlwaysOnTop(true, 'floating');
  reminderWin.loadFile(path.join(__dirname, 'renderer', 'reminder.html'));
  reminderWin.once('ready-to-show', open);
  reminderWin.on('closed', () => { reminderWin = null; });
}

function hideReminder() {
  if (reminderWin && !reminderWin.isDestroyed()) reminderWin.hide();
}

function flushPendingReminders() {
  if (shutdownState.pending && !dndActive()) {
    shutdownState.pending = false;
    triggerShutdownRemind();
  }
}

ipcMain.on('reminder-action', (_e, action) => {
  switch (action) {
    case 'rest-done':
    case 'rest-skip':
      rest.activeMs = 0;
      rest.reminding = false;
      hideReminder();
      break;
    case 'rest-start':
      break;
    case 'rest-snooze':
      rest.activeMs = Math.max(0, settings.restInterval * MINUTE_MS - 5 * MINUTE_MS);
      rest.reminding = false;
      hideReminder();
      break;
    case 'shutdown-now':
      hideReminder();
      native.shutdownNow(5, '健康小助手：即将关机');
      break;
    case 'shutdown-snooze':
      shutdownState.snoozeUntil = Date.now() + 10 * MINUTE_MS;
      hideReminder();
      break;
    case 'shutdown-cancel':
      shutdownState.snoozeUntil = 0;
      hideReminder();
      break;
    case 'shutdown-abort':
      native.abortShutdown();
      hideReminder();
      break;
  }
  broadcast();
});

/* ---------------- rest timer & shutdown scheduler ---------------- */

function triggerRest() {
  rest.reminding = true;
  showReminder({ type: 'rest', minutes: settings.restInterval, restSeconds: REST_SECONDS, minuteMs: MINUTE_MS });
}

function triggerShutdownRemind() {
  showReminder({ type: 'shutdown-remind', time: settings.shutdownTime });
}
function triggerShutdownAuto() {
  native.shutdownNow(60, '健康小助手：已到定时关机时间，将在 60 秒后关机');
  showReminder({ type: 'shutdown-auto', time: settings.shutdownTime, seconds: 60 });
}

function tick() {
  const now = Date.now();
  const delta = now - rest.lastTick;
  rest.lastTick = now;

  if (settings.rest && !rest.reminding) {
    if (powerMonitor.getSystemIdleTime() >= IDLE_RESET_SECONDS) {
      rest.activeMs = 0;
    } else {
      rest.activeMs += Math.min(delta, 60000);
    }
    if (rest.activeMs >= settings.restInterval * MINUTE_MS && !dndActive()) triggerRest();
  }

  if (settings.shutdown) {
    const d = new Date();
    const key = `${d.toDateString()} ${settings.shutdownTime}`;
    if (nowHHMM(d) === settings.shutdownTime && shutdownState.lastFired !== key) {
      shutdownState.lastFired = key;
      if (settings.shutdownMode === 'auto') triggerShutdownAuto();
      else if (dndActive()) shutdownState.pending = true;
      else triggerShutdownRemind();
    }
    if (shutdownState.snoozeUntil && now >= shutdownState.snoozeUntil) {
      shutdownState.snoozeUntil = 0;
      if (dndActive()) shutdownState.pending = true;
      else triggerShutdownRemind();
    }
  }

  applyOverlay();
  broadcast();
}

function resetRest() {
  rest.activeMs = 0;
  rest.lastTick = Date.now();
}

/* ---------------- main window & tray ---------------- */

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 860,
    height: 630,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    show: false,
    title: '健康小助手',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) mainWin.show();
  });
  mainWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWin.hide();
    if (!settings.hiddenTipShown && Notification.isSupported()) {
      new Notification({ title: '健康小助手', body: '已最小化到系统托盘，护眼功能仍在后台运行。' }).show();
      settings.hiddenTipShown = true;
      saveSettings();
    }
  });
}

function showMain() {
  if (!mainWin) return;
  mainWin.show();
  mainWin.focus();
}

function refreshTrayMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开健康小助手', click: showMain },
      { type: 'separator' },
      { label: '防蓝光模式', type: 'checkbox', checked: settings.blueLight, click: (i) => updateSettings({ blueLight: i.checked }) },
      { label: '豆沙绿护眼', type: 'checkbox', checked: settings.beanGreen, click: (i) => updateSettings({ beanGreen: i.checked }) },
      { label: '定时休息', type: 'checkbox', checked: settings.rest, click: (i) => updateSettings({ rest: i.checked }) },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }),
      },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ])
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.setToolTip('健康小助手');
  tray.on('click', showMain);
  refreshTrayMenu();
}

const ALLOWED_KEYS = Object.keys(DEFAULTS).filter((k) => !['originalWindowColor', 'hiddenTipShown'].includes(k));

function updateSettings(patch) {
  const clean = {};
  for (const k of ALLOWED_KEYS) if (k in patch) clean[k] = patch[k];
  if ('intensity' in clean) clean.intensity = Math.min(5, Math.max(1, Number(clean.intensity) || 3));
  const restChanged = ('restInterval' in clean && clean.restInterval !== settings.restInterval) || (clean.rest === true && !settings.rest);
  const shutdownChanged = 'shutdownTime' in clean || clean.shutdown === true;
  settings = { ...settings, ...clean };
  if (restChanged) resetRest();
  if (shutdownChanged) {
    shutdownState.lastFired = '';
    shutdownState.snoozeUntil = 0;
  }
  if (!settings.rest && rest.reminding) {
    rest.reminding = false;
    hideReminder();
  }
  saveSettings();
  applyWatcher();
  applyOverlay();
  applyBeanGreen();
  broadcast();
  return getState();
}

ipcMain.handle('get-state', () => getState());
ipcMain.handle('update-settings', (_e, patch) => updateSettings(patch || {}));
ipcMain.on('win', (_e, action) => {
  if (action === 'minimize') mainWin.minimize();
  if (action === 'close') mainWin.close();
});

app.on('second-instance', showMain);

app.whenReady().then(() => {
  app.setAppUserModelId('com.johnson.eyecare');
  loadSettings();
  createMainWindow();
  createTray();
  applyWatcher();
  applyOverlay();
  if (settings.beanGreen) applyBeanGreen();

  const refreshOverlay = () => { overlayKey = ''; applyOverlay(); };
  screen.on('display-added', refreshOverlay);
  screen.on('display-removed', refreshOverlay);
  screen.on('display-metrics-changed', refreshOverlay);
  powerMonitor.on('lock-screen', resetRest);
  powerMonitor.on('unlock-screen', resetRest);
  powerMonitor.on('suspend', resetRest);
  powerMonitor.on('resume', resetRest);

  setInterval(tick, Math.min(10000, MINUTE_MS / 4));
});

app.on('before-quit', () => {
  quitting = true;
  if (stopWatcher) stopWatcher();
  destroyOverlays();
});

app.on('window-all-closed', (e) => e.preventDefault());

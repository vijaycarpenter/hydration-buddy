import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  screen,
  session,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { Store, ValidationError } from './store';
import { ReminderScheduler } from './scheduler';
import { setAutostart } from './autostart';
import { applySettingsPatch } from '../shared/settings';
import { edgeMs, REMINDER_WINDOW, walkSpeed } from '../shared/companion';
import { addLocalDays, localDateKey, startOfLocalDay } from '../shared/time';
import type {
  ActiveReminder,
  EntryPatch,
  IntakeEntry,
  NewEntryInput,
  PauseOption,
  ReminderAction,
  Result,
  Settings,
  Snapshot,
} from '../shared/types';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RESOURCES = path.join(__dirname, '..', 'resources');
const REMINDER_SIZE = REMINDER_WINDOW;

// HB_MINUTE_MS shortens every reminder "minute" for manual testing (e.g. 1000 = minutes become seconds).
const minuteMs = (() => {
  const v = Number(process.env.HB_MINUTE_MS);
  return Number.isInteger(v) && v >= 100 && v <= 60_000 ? v : 60_000;
})();

let store: Store;
let settings: Settings;
let scheduler: ReminderScheduler;
let dashboard: BrowserWindow | null = null;
let reminderWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let notification: Notification | null = null;
let quitting = false;
let shortcutError: string | null = null;
let autostartError: string | null = null;
const trustedContents = new Set<number>();
/** requestId → result, so a double-submitted "add entry" is applied once. */
const recentRequests = new Map<string, Result<IntakeEntry>>();

// Transparent windows on X11 need an ARGB visual.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
// Windows only shows toast notifications for apps with an AppUserModelID (matches appId in electron-builder.yml).
if (process.platform === 'win32') app.setAppUserModelId('in.emorphis.hydrationbuddy');

// HB_USER_DATA points the app at a separate data folder (testing without touching real data).
if (process.env.HB_USER_DATA) app.setPath('userData', path.resolve(process.env.HB_USER_DATA));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showDashboard());
  app.whenReady().then(init).catch((err) => {
    dialog.showErrorBox('Hydration Buddy could not start', String(err?.stack ?? err));
    app.exit(1);
  });
}

async function init() {
  hardenSessions();
  const wasm = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
  store = await Store.open(path.join(app.getPath('userData'), 'hydration.sqlite'), wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  settings = store.getSettings();
  nativeTheme.themeSource = settings.theme;

  scheduler = new ReminderScheduler({
    store,
    getSettings: () => settings,
    minuteMs,
    onFire: showReminder,
    onResolved: (_id, _action, entry) => {
      notification?.close();
      notification = null;
      // Drinks logged from the dashboard/tray announce themselves in addEntry().
      if (entry?.source === 'reminder') broadcast('drink-recorded', entry.amountMl);
      scheduleReminderHide();
    },
    onChange: scheduleStateBroadcast,
    onDayChange: scheduleStateBroadcast,
  });

  registerIpc();
  createTray();
  registerShortcut();
  autostartError = setAutostart(settings.startAtLogin);

  powerMonitor.on('resume', () => scheduler.tick());
  powerMonitor.on('unlock-screen', () => scheduler.tick());

  scheduler.start();
  if (!process.argv.includes('--hidden') || !tray) showDashboard();
}

// ---------------------------------------------------------------- security

function hardenSessions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (e, url) => {
      if (!isAppUrl(url)) e.preventDefault();
    });
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

function isAppUrl(url: string) {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
}

const webPreferences = (extra: Electron.WebPreferences = {}): Electron.WebPreferences => ({
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: false,
  ...extra,
});

function loadPage(win: BrowserWindow, page: 'index' | 'reminder') {
  if (DEV_URL) win.loadURL(`${DEV_URL}/${page}.html`);
  else win.loadFile(path.join(__dirname, '..', 'dist', `${page}.html`));
}

function trust(win: BrowserWindow) {
  const id = win.webContents.id;
  trustedContents.add(id);
  win.on('closed', () => trustedContents.delete(id));
}

const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#0b1220' : '#f0f9ff');

// ---------------------------------------------------------------- windows

function showDashboard() {
  if (!dashboard) {
    dashboard = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 660,
      show: false,
      title: 'Hydration Buddy',
      icon: path.join(RESOURCES, 'icons', '256x256.png'),
      backgroundColor: backgroundColor(),
      autoHideMenuBar: true,
      webPreferences: webPreferences(),
    });
    dashboard.setMenuBarVisibility(false);
    trust(dashboard);
    loadPage(dashboard, 'index');
    dashboard.once('ready-to-show', () => dashboard?.show());
    dashboard.on('close', (e) => {
      if (!quitting && settings.minimizeToTray && tray) {
        e.preventDefault();
        dashboard?.hide();
      }
    });
    dashboard.on('minimize', () => {
      if (settings.minimizeToTray && tray) dashboard?.hide();
    });
    dashboard.on('closed', () => {
      dashboard = null;
      // Without the tray there is no way back to a hidden app, so closing the dashboard quits.
      if (!quitting && (!settings.minimizeToTray || !tray)) quit();
    });
    return;
  }
  if (dashboard.isMinimized()) dashboard.restore();
  dashboard.show();
  dashboard.focus();
}

/** The companion stands on the bottom edge of the work area: walks in from the left, rests near the right. */
function reminderBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    y: workArea.y + workArea.height - REMINDER_SIZE.height,
    restX: workArea.x + workArea.width - REMINDER_SIZE.width - 40,
    startX: workArea.x,
    exitX: workArea.x + workArea.width - REMINDER_SIZE.width,
  };
}

function ensureReminderWindow(): BrowserWindow {
  if (reminderWin && !reminderWin.isDestroyed()) return reminderWin;
  const b = reminderBounds();
  const win = new BrowserWindow({
    ...REMINDER_SIZE,
    x: b.restX,
    y: b.y,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: 'Hydration Buddy reminder',
    icon: path.join(RESOURCES, 'icons', '256x256.png'),
    backgroundColor: '#00000000',
    webPreferences: webPreferences({ autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }),
  });
  trust(win);
  loadPage(win, 'reminder');
  // Closing the window (Alt+F4, WM close) counts as dismissing the reminder; the window itself is reused.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    const active = scheduler.status().active;
    if (active) scheduler.resolve(active.id, 'dismissed', { detail: 'closed' });
    win.hide();
  });
  win.on('closed', () => {
    reminderWin = null;
  });
  reminderWin = win;
  return win;
}

/** Interval while walking, or timeout during an edge step; cleared with clearInterval (works for both). */
let walkTimer: ReturnType<typeof setInterval> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Moves the window horizontally at walking speed, then calls done. One walk at a time. */
function walkWindow(win: BrowserWindow, fromX: number, toX: number, y: number, done: () => void) {
  if (walkTimer) clearInterval(walkTimer);
  // Constant speed matched to the walk cycle, so his feet don't slide.
  const duration = Math.min((Math.abs(toX - fromX) / walkSpeed(settings.characterSize)) * 1000, 15000);
  const t0 = Date.now();
  win.setPosition(Math.round(fromX), y);
  walkTimer = setInterval(() => {
    if (win.isDestroyed()) {
      if (walkTimer) clearInterval(walkTimer);
      walkTimer = null;
      return;
    }
    const p = Math.min((Date.now() - t0) / duration, 1);
    win.setPosition(Math.round(fromX + (toX - fromX) * p), y);
    if (p >= 1) {
      if (walkTimer) clearInterval(walkTimer);
      walkTimer = null;
      done();
    }
  }, 16);
}

function showReminder(reminder: ActiveReminder, notify = true) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;

  if (settings.popupEnabled) {
    const win = ensureReminderWindow();
    win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    const arrive = () => !win.isDestroyed() && win.webContents.send('reminder-arrived');
    const present = () => {
      const b = reminderBounds();
      // Already standing on screen: just re-present the reminder where he is.
      const walkIn = !(win.isVisible() && !walkTimer) && settings.characterAnimations;
      win.webContents.send('reminder-shown', reminder, walkIn);
      if (win.isVisible() && !walkTimer) return arrive();
      if (!settings.characterAnimations) {
        win.setPosition(b.restX, b.y);
        win.showInactive(); // never steal keyboard focus
        return arrive();
      }
      // Walk in along the bottom of the screen from the left edge: the page animates him
      // stepping in across the edge, then the window carries him to his resting spot.
      if (walkTimer) clearInterval(walkTimer);
      win.setPosition(b.startX, b.y);
      win.showInactive();
      walkTimer = setTimeout(() => walkWindow(win, b.startX, b.restX, b.y, arrive), edgeMs(settings.characterSize)) as never;
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', present);
    else present();
  }

  if (notify && settings.notificationsEnabled && Notification.isSupported()) {
    notification?.close();
    const t = todayTotals();
    notification = new Notification({
      title: reminder.attempt > 1 ? 'Still thirsty? 💧' : 'Time to drink some water 💧',
      body: `${t.totalMl} of ${settings.dailyGoalMl} ml so far today. Tap to add ${settings.servingMl} ml.`,
      icon: path.join(RESOURCES, 'icons', '128x128.png'),
      silent: true, // the reminder window plays its own (optional) sound
      urgency: 'normal',
    });
    notification.on('click', () => {
      const active = scheduler.status().active;
      if (active && settings.popupEnabled) showReminder(active, false);
      else showDashboard();
    });
    notification.show();
  }
  scheduleStateBroadcast();
}

/** Fallback: walks the companion off if its reminder was answered but the page never asked to leave. */
function scheduleReminderHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!scheduler.status().active) walkReminderOff();
  }, 6000);
}

/** The companion walks off the right edge of the screen, then the window hides. */
function walkReminderOff() {
  const win = reminderWin;
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  if (!settings.characterAnimations) return hideReminderWindow();
  const [x] = win.getPosition();
  const b = reminderBounds();
  walkWindow(win, x, b.exitX, b.y, () => {
    // At the edge the page walks him out of the window, then the window hides.
    win.webContents.send('reminder-exit');
    walkTimer = setTimeout(() => {
      walkTimer = null;
      // A new reminder may have fired while he was leaving; it restarts its own walk.
      if (!scheduler.status().active && !win.isDestroyed()) win.hide();
    }, edgeMs(settings.characterSize) + 50) as never;
  });
}

function hideReminderWindow() {
  if (walkTimer) clearInterval(walkTimer);
  walkTimer = null;
  if (reminderWin && !reminderWin.isDestroyed() && reminderWin.isVisible()) reminderWin.hide();
}

// ---------------------------------------------------------------- tray & shortcut

function createTray() {
  try {
    // The Windows tray wants a 16/32 px square icon; the Linux panel uses the 22 px drop.
    const file = process.platform === 'win32' ? path.join(RESOURCES, 'icons', '32x32.png') : path.join(RESOURCES, 'tray.png');
    const icon = nativeImage.createFromPath(file);
    tray = new Tray(icon);
    tray.setToolTip('Hydration Buddy');
    tray.on('click', () => showDashboard());
    updateTray();
  } catch {
    tray = null; // no tray support in this session; the dashboard stays the entry point
  }
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function updateTray() {
  if (!tray) return;
  const t = todayTotals();
  const st = scheduler.status();
  let status: string;
  if (st.sessionStopped) status = 'Reminders stopped until restart';
  else if (st.pausedIndefinitely) status = 'Reminders paused';
  else if (st.pausedUntil) status = `Paused until ${hhmm(st.pausedUntil)}`;
  else if (st.active) status = 'Reminder waiting for you';
  else status = st.nextAt ? `Next reminder at ${hhmm(st.nextAt)}` : 'No reminder scheduled';
  const paused = st.sessionStopped || st.pausedIndefinitely || st.pausedUntil !== null;
  const pct = Math.round((t.totalMl / settings.dailyGoalMl) * 100);

  const template: MenuItemConstructorOptions[] = [
    { label: `Today: ${t.totalMl} / ${settings.dailyGoalMl} ml (${pct}%)`, enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: () => showDashboard() },
    { label: `I drank ${settings.servingMl} ml`, click: () => addEntry({ amountMl: settings.servingMl, source: 'quick' }) },
    { label: 'Show a reminder now', click: () => scheduler.triggerNow() },
    { type: 'separator' },
    paused
      ? { label: 'Resume reminders', click: () => scheduler.resume() }
      : {
          label: 'Pause reminders',
          submenu: [
            { label: 'For 30 minutes', click: () => scheduler.pause(30) },
            { label: 'For 1 hour', click: () => scheduler.pause(60) },
            { label: 'For 2 hours', click: () => scheduler.pause(120) },
            { label: 'Until tomorrow', click: () => scheduler.pause('tomorrow') },
            { label: 'Until I resume', click: () => scheduler.pause('indefinite') },
          ],
        },
    ...(!paused ? [{ label: 'Stop reminders for this session', click: () => scheduler.stopForSession() }] : []),
    { type: 'separator' },
    { label: 'Quit Hydration Buddy', click: () => quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`Hydration Buddy — ${t.totalMl}/${settings.dailyGoalMl} ml · ${status}`);
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  shortcutError = null;
  if (!settings.shortcut) return;
  try {
    if (!globalShortcut.register(settings.shortcut, () => showDashboard())) {
      shortcutError = `${settings.shortcut} is already used by another application.`;
    }
  } catch (err) {
    shortcutError = `Could not register ${settings.shortcut}: ${(err as Error).message}`;
  }
}

function quit() {
  quitting = true;
  scheduler?.stop();
  globalShortcut.unregisterAll();
  notification?.close();
  tray?.destroy(); // otherwise Windows leaves a ghost icon in the tray until hovered
  tray = null;
  try {
    store?.close();
  } catch {
    /* already closed */
  }
  app.quit();
}

app.on('before-quit', () => {
  if (!quitting) quit();
});
// Keep running in the background when every window is closed.
app.on('window-all-closed', () => {});

// ---------------------------------------------------------------- state

function todayTotals() {
  const day = store.dailyTotals(1)[0];
  return { totalMl: day.totalMl, entries: day.entries };
}

function snapshot(): Snapshot {
  const now = Date.now();
  const from = startOfLocalDay(now);
  const reminders = store.remindersBetween(from, addLocalDays(from, 1));
  const week = store.dailyTotals(7, now);
  const today = week[week.length - 1];
  return {
    now,
    settings,
    today: {
      dateKey: localDateKey(now),
      totalMl: today.totalMl,
      goalMl: settings.dailyGoalMl,
      remainingMl: Math.max(settings.dailyGoalMl - today.totalMl, 0),
      percent: Math.round((today.totalMl / settings.dailyGoalMl) * 1000) / 10,
      glasses: today.count,
      entries: today.entries,
      reminders,
      counts: Store.countReminders(reminders),
    },
    week: week.map(({ dateKey, totalMl, count }) => ({ dateKey, totalMl, count })),
    scheduler: scheduler.status(),
    shortcutError,
    storageError: store.storageError ?? autostartError,
  };
}

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesces bursts of changes into one renderer refresh + tray rebuild. */
function scheduleStateBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast('state-changed');
    updateTray();
  }, 50);
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

function addEntry(input: Omit<NewEntryInput, 'requestId'> & { requestId?: string }): Result<IntakeEntry> {
  if (input.requestId) {
    const seen = recentRequests.get(input.requestId);
    if (seen) return seen;
  }
  let result: Result<IntakeEntry>;
  try {
    const entry = store.addEntry(input);
    // Only drinks logged "now" count as answering the schedule; back-dated corrections don't.
    if (Math.abs(Date.parse(entry.timestamp) - Date.now()) < 5 * 60_000) scheduler.drinkLogged(entry);
    broadcast('drink-recorded', entry.amountMl);
    scheduleStateBroadcast();
    result = { ok: true, value: entry };
  } catch (err) {
    result = fail(err);
  }
  if (input.requestId) {
    recentRequests.set(input.requestId, result);
    if (recentRequests.size > 200) recentRequests.delete(recentRequests.keys().next().value!);
  }
  return result;
}

function fail(err: unknown): Result<never> {
  if (err instanceof ValidationError) return { ok: false, error: err.message };
  console.error(err);
  return { ok: false, error: `Something went wrong: ${(err as Error)?.message ?? err}` };
}

// ---------------------------------------------------------------- IPC

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!trustedContents.has(event.sender.id)) throw new Error('Untrusted sender');
    return fn(...args);
  });
}

const isStr = (v: unknown, max = 100): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function registerIpc() {
  handle('snapshot', () => snapshot());

  handle('entry:add', (input: NewEntryInput) => {
    if (!input || typeof input !== 'object' || !isStr(input.requestId)) return { ok: false, error: 'Bad request.' };
    return addEntry({
      amountMl: input.amountMl,
      timestamp: input.timestamp,
      source: input.source,
      note: input.note,
      requestId: input.requestId,
    });
  });

  handle('entry:update', (id: unknown, patch: EntryPatch) => {
    if (!isStr(id) || !patch || typeof patch !== 'object') return { ok: false, error: 'Bad request.' };
    try {
      const value = store.updateEntry(id, { amountMl: patch.amountMl, timestamp: patch.timestamp, note: patch.note });
      scheduleStateBroadcast();
      return { ok: true, value };
    } catch (err) {
      return fail(err);
    }
  });

  handle('entry:delete', (id: unknown) => {
    if (!isStr(id)) return { ok: false, error: 'Bad request.' };
    const ok = store.deleteEntry(id);
    scheduleStateBroadcast();
    return ok ? { ok } : { ok, error: 'Entry not found.' };
  });

  handle('day:reset', () => {
    try {
      store.resetDay();
      scheduleStateBroadcast();
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  });

  handle('history', (days: unknown) => {
    const n = typeof days === 'number' && Number.isInteger(days) ? Math.min(Math.max(days, 1), 366) : 30;
    const days_ = store.dailyTotals(n).reverse();
    const from = startOfLocalDay(addLocalDays(Date.now(), -(n - 1)));
    return { days: days_, reminders: store.remindersBetween(from, addLocalDays(startOfLocalDay(Date.now()), 1)).reverse() };
  });

  handle('settings:update', (patch: unknown) => {
    const prev = settings;
    const { settings: next, fieldErrors } = applySettingsPatch(settings, patch);
    if (Object.keys(fieldErrors).length) return { ok: false, error: 'Please fix the highlighted fields.', fieldErrors };
    settings = next;
    store.saveSettings(settings);
    nativeTheme.themeSource = settings.theme;
    if (prev.shortcut !== next.shortcut) registerShortcut();
    if (prev.startAtLogin !== next.startAtLogin) autostartError = setAutostart(next.startAtLogin);
    if (prev.alwaysOnTop !== next.alwaysOnTop && reminderWin && !reminderWin.isDestroyed()) {
      reminderWin.setAlwaysOnTop(next.alwaysOnTop, 'floating');
    }
    if (!next.popupEnabled) hideReminderWindow();
    scheduler.settingsChanged(prev, next);
    scheduleStateBroadcast();
    return { ok: true, value: settings, fieldErrors: shortcutError ? { shortcut: shortcutError } : undefined };
  });

  handle('reminder:action', (id: unknown, action: unknown, amountMl: unknown) => {
    const actions: ReminderAction[] = ['drank', 'later', 'skipped', 'dismissed'];
    if (!isStr(id) || !actions.includes(action as ReminderAction)) return { ok: false, error: 'Bad request.' };
    if (amountMl !== undefined && typeof amountMl !== 'number') return { ok: false, error: 'Bad amount.' };
    const r = scheduler.resolve(id, action as ReminderAction, { amountMl: amountMl as number | undefined });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });

  handle('reminders:pause', (option: unknown) => {
    const valid: PauseOption[] = [30, 60, 120, 'tomorrow', 'indefinite'];
    if (!valid.includes(option as PauseOption)) return { ok: false, error: 'Bad request.' };
    scheduler.pause(option as PauseOption);
    return { ok: true };
  });
  handle('reminders:resume', () => (scheduler.resume(), { ok: true }));
  handle('reminders:stop-session', () => (scheduler.stopForSession(), { ok: true }));
  handle('reminders:trigger', () => (scheduler.triggerNow(), { ok: true }));

  handle('data:export', async (format: unknown) => {
    if (format !== 'json' && format !== 'csv') return { ok: false, error: 'Bad request.' };
    const { canceled, filePath } = await dialog.showSaveDialog(dashboard ?? undefined!, {
      title: 'Export hydration data',
      defaultPath: path.join(app.getPath('documents'), `hydration-${localDateKey(Date.now())}.${format}`),
      filters: [format === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      const body = format === 'json' ? JSON.stringify(store.exportAll(), null, 2) : store.exportEntriesCsv();
      fs.writeFileSync(filePath, body, 'utf8');
      return { ok: true, value: filePath };
    } catch (err) {
      return fail(err);
    }
  });

  handle('data:backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(dashboard ?? undefined!, {
      title: 'Back up the database',
      defaultPath: path.join(app.getPath('documents'), `hydration-backup-${localDateKey(Date.now())}.sqlite`),
      filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
    });
    if (canceled || !filePath) return { ok: false };
    try {
      fs.writeFileSync(filePath, store.exportBytes());
      return { ok: true, value: filePath };
    } catch (err) {
      return fail(err);
    }
  });

  handle('window:dashboard', () => showDashboard());
  handle('window:close-reminder', () => walkReminderOff());
}

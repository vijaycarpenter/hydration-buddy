// The only bridge between renderers and the main process. Exposes a narrow,
// typed API; renderers never get access to ipcRenderer or Node.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ActiveReminder, HydrationApi } from '../shared/types';

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: HydrationApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  addEntry: (input) => ipcRenderer.invoke('entry:add', input),
  updateEntry: (id, patch) => ipcRenderer.invoke('entry:update', id, patch),
  deleteEntry: (id) => ipcRenderer.invoke('entry:delete', id),
  resetToday: () => ipcRenderer.invoke('day:reset'),
  getHistory: (days) => ipcRenderer.invoke('history', days),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  reminderAction: (id, action, amountMl) => ipcRenderer.invoke('reminder:action', id, action, amountMl),
  pause: (option) => ipcRenderer.invoke('reminders:pause', option),
  resume: () => ipcRenderer.invoke('reminders:resume'),
  stopForSession: () => ipcRenderer.invoke('reminders:stop-session'),
  triggerReminderNow: () => ipcRenderer.invoke('reminders:trigger'),
  exportData: (format) => ipcRenderer.invoke('data:export', format),
  backupDatabase: () => ipcRenderer.invoke('data:backup'),
  showDashboard: () => ipcRenderer.invoke('window:dashboard'),
  closeReminderWindow: () => ipcRenderer.invoke('window:close-reminder'),
  onStateChanged: (cb) => subscribe('state-changed', cb),
  onDrinkRecorded: (cb) => subscribe<[number]>('drink-recorded', cb),
  onReminderShown: (cb) => subscribe<[ActiveReminder, boolean]>('reminder-shown', cb),
  onReminderArrived: (cb) => subscribe('reminder-arrived', cb),
  onReminderExit: (cb) => subscribe('reminder-exit', cb),
};

contextBridge.exposeInMainWorld('hydration', api);

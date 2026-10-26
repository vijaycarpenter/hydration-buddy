// Types shared by the main process, the preload bridge and the renderer.

export type Theme = 'system' | 'light' | 'dark';
export type CharacterSize = 'small' | 'medium' | 'large';

export interface Settings {
  dailyGoalMl: number;
  servingMl: number;
  intervalMin: number;
  retryMin: number;
  /** "HH:MM", local time. start === end means "all day". */
  activeStart: string;
  activeEnd: string;
  popupEnabled: boolean;
  notificationsEnabled: boolean;
  alwaysOnTop: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  characterVisible: boolean;
  characterSize: CharacterSize;
  characterAnimations: boolean;
  theme: Theme;
  startAtLogin: boolean;
  minimizeToTray: boolean;
  shortcut: string;
}

export type EntrySource = 'reminder' | 'manual' | 'quick';

export interface IntakeEntry {
  id: string;
  amountMl: number;
  /** ISO-8601 UTC */
  timestamp: string;
  source: EntrySource;
  note: string | null;
}

export type ReminderAction = 'drank' | 'later' | 'skipped' | 'dismissed';

export interface ReminderRecord {
  id: string;
  /** when the reminder fired, ISO UTC */
  reminderAt: string;
  action: ReminderAction;
  actionAt: string;
  /** closed | timeout | paused — only for dismissed */
  detail: string | null;
  nextReminderAt: string | null;
  waterEntryId: string | null;
}

export interface ActiveReminder {
  id: string;
  firedAt: number;
  /** 1 for a normal reminder, 2+ for consecutive retries after later/skip */
  attempt: number;
}

export interface SchedulerStatus {
  mode: 'normal' | 'retry';
  nextAt: number | null;
  pausedUntil: number | null;
  pausedIndefinitely: boolean;
  sessionStopped: boolean;
  active: ActiveReminder | null;
  withinActiveHours: boolean;
  /** Length of one "minute" in ms. 60000 unless HB_MINUTE_MS is set for testing. */
  minuteMs: number;
}

export interface DayTotal {
  dateKey: string;
  totalMl: number;
  count: number;
}

export interface ReminderCounts {
  drank: number;
  later: number;
  skipped: number;
  dismissed: number;
}

export interface Snapshot {
  now: number;
  settings: Settings;
  today: {
    dateKey: string;
    totalMl: number;
    goalMl: number;
    remainingMl: number;
    percent: number;
    glasses: number;
    entries: IntakeEntry[];
    reminders: ReminderRecord[];
    counts: ReminderCounts;
  };
  week: DayTotal[];
  scheduler: SchedulerStatus;
  shortcutError: string | null;
  storageError: string | null;
}

export interface NewEntryInput {
  amountMl: number;
  /** ISO timestamp; defaults to now */
  timestamp?: string;
  source: EntrySource;
  note?: string | null;
  /** Client-generated id used to drop accidental double submits. */
  requestId: string;
}

export interface EntryPatch {
  amountMl?: number;
  timestamp?: string;
  note?: string | null;
}

export interface HistoryResult {
  days: (DayTotal & { entries: IntakeEntry[] })[];
  reminders: ReminderRecord[];
}

export type PauseOption = 30 | 60 | 120 | 'tomorrow' | 'indefinite';

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  value?: T;
}

/** API exposed to renderers by the preload script as window.hydration. */
export interface HydrationApi {
  getSnapshot(): Promise<Snapshot>;
  addEntry(input: NewEntryInput): Promise<Result<IntakeEntry>>;
  updateEntry(id: string, patch: EntryPatch): Promise<Result<IntakeEntry>>;
  deleteEntry(id: string): Promise<Result>;
  resetToday(): Promise<Result>;
  getHistory(days: number): Promise<HistoryResult>;
  updateSettings(patch: Partial<Settings>): Promise<Result<Settings> & { fieldErrors?: Record<string, string> }>;
  reminderAction(id: string, action: ReminderAction, amountMl?: number): Promise<Result>;
  pause(option: PauseOption): Promise<Result>;
  resume(): Promise<Result>;
  stopForSession(): Promise<Result>;
  triggerReminderNow(): Promise<Result>;
  exportData(format: 'json' | 'csv'): Promise<Result<string>>;
  backupDatabase(): Promise<Result<string>>;
  showDashboard(): Promise<void>;
  closeReminderWindow(): Promise<void>;
  onStateChanged(cb: () => void): () => void;
  onDrinkRecorded(cb: (amountMl: number) => void): () => void;
  /** walkIn: he is about to walk in from the screen edge (false when re-shown in place). */
  onReminderShown(cb: (reminder: ActiveReminder, walkIn: boolean) => void): () => void;
  /** The companion has finished walking in and should start talking. */
  onReminderArrived(cb: () => void): () => void;
  /** The window reached the screen edge; the companion should step out of view. */
  onReminderExit(cb: () => void): () => void;
}

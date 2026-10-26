import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  dailyGoalMl: 2000,
  servingMl: 250,
  intervalMin: 60,
  retryMin: 10,
  activeStart: '09:00',
  activeEnd: '21:00',
  popupEnabled: true,
  notificationsEnabled: true,
  alwaysOnTop: true,
  soundEnabled: true,
  soundVolume: 0.5,
  characterVisible: true,
  characterSize: 'medium',
  characterAnimations: true,
  theme: 'system',
  startAtLogin: false,
  minimizeToTray: true,
  shortcut: 'CommandOrControl+Alt+H',
};

export const SERVING_PRESETS = [150, 200, 250, 330, 500];
export const INTERVAL_PRESETS = [30, 45, 60, 90, 120];

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Electron accelerator: modifiers joined by '+', ending in one key. No shell-relevant characters possible.
const ACCELERATOR =
  /^((CommandOrControl|CmdOrCtrl|Control|Ctrl|Alt|Shift|Super|Meta)\+){1,4}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right)$/;

type Check = (v: unknown) => string | null;

const intRange =
  (min: number, max: number, label: string): Check =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
      ? null
      : `${label} must be a whole number between ${min} and ${max}.`;

const bool: Check = (v) => (typeof v === 'boolean' ? null : 'Must be on or off.');
const oneOf =
  (values: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v) ? null : `Must be one of: ${values.join(', ')}.`;

const CHECKS: Record<keyof Settings, Check> = {
  dailyGoalMl: intRange(250, 10000, 'Daily goal (ml)'),
  servingMl: intRange(25, 2000, 'Serving size (ml)'),
  intervalMin: intRange(5, 480, 'Reminder interval (minutes)'),
  retryMin: intRange(1, 120, 'Retry delay (minutes)'),
  activeStart: (v) => (typeof v === 'string' && HM.test(v) ? null : 'Use 24-hour HH:MM.'),
  activeEnd: (v) => (typeof v === 'string' && HM.test(v) ? null : 'Use 24-hour HH:MM.'),
  popupEnabled: bool,
  notificationsEnabled: bool,
  alwaysOnTop: bool,
  soundEnabled: bool,
  soundVolume: (v) =>
    typeof v === 'number' && v >= 0 && v <= 1 ? null : 'Volume must be between 0 and 1.',
  characterVisible: bool,
  characterSize: oneOf(['small', 'medium', 'large']),
  characterAnimations: bool,
  theme: oneOf(['system', 'light', 'dark']),
  startAtLogin: bool,
  minimizeToTray: bool,
  shortcut: (v) =>
    typeof v === 'string' && (v === '' || ACCELERATOR.test(v))
      ? null
      : 'Use a shortcut like CommandOrControl+Alt+H (or leave empty to disable).',
};

export interface ValidationResult {
  settings: Settings;
  fieldErrors: Record<string, string>;
}

/** Validates a partial update against the current settings. Invalid or unknown fields are reported, not applied. */
export function applySettingsPatch(current: Settings, patch: unknown): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const next: Settings = { ...current };
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { settings: current, fieldErrors: { _: 'Settings update must be an object.' } };
  }
  for (const [key, value] of Object.entries(patch)) {
    const check = CHECKS[key as keyof Settings];
    if (!check) {
      fieldErrors[key] = 'Unknown setting.';
      continue;
    }
    const err = check(value);
    if (err) fieldErrors[key] = err;
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (!fieldErrors.retryMin && !fieldErrors.intervalMin && next.retryMin > next.intervalMin) {
    fieldErrors.retryMin = 'Retry delay should not be longer than the normal interval.';
  }
  if (!next.popupEnabled && !next.notificationsEnabled) {
    fieldErrors.popupEnabled = 'Keep the reminder window or desktop notifications on, otherwise reminders are invisible.';
  }
  return { settings: Object.keys(fieldErrors).length ? current : next, fieldErrors };
}

/** Loads stored settings, falling back to defaults field by field when stored data is missing or invalid. */
export function sanitizeStoredSettings(stored: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== 'object' || stored === null) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = (stored as Record<string, unknown>)[key];
    if (value !== undefined && CHECKS[key](value) === null) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  if (out.retryMin > out.intervalMin) out.retryMin = Math.min(DEFAULT_SETTINGS.retryMin, out.intervalMin);
  return out;
}

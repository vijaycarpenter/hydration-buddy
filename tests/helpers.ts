import { vi } from 'vitest';
import { Store } from '../src/main/store';
import { ReminderScheduler } from '../src/main/scheduler';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { ActiveReminder, Settings } from '../src/shared/types';

/** Local-time timestamp helper: at(10, 30) = today 10:30 on the fixed test date (2026-10-12). */
export function at(h: number, m = 0, dayOffset = 0): number {
  return new Date(2026, 9, 12 + dayOffset, h, m, 0, 0).getTime();
}

export interface Harness {
  store: Store;
  settings: Settings;
  scheduler: ReminderScheduler;
  fired: ActiveReminder[];
  dayChanges: number;
  /** Advance the fake clock, running due timers (like an awake computer). */
  advance(ms: number): void;
  /** Jump the clock without running timers (like a suspended computer), then deliver the resume event. */
  sleepFor(ms: number): void;
}

export async function makeHarness(opts: { settings?: Partial<Settings>; store?: Store; start?: number } = {}): Promise<Harness> {
  vi.useFakeTimers();
  vi.setSystemTime(opts.start ?? at(10));
  const store = opts.store ?? (await Store.open(null));
  const h = {
    store,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    fired: [] as ActiveReminder[],
    dayChanges: 0,
  } as Harness;
  h.scheduler = new ReminderScheduler({
    store,
    getSettings: () => h.settings,
    onFire: (r) => h.fired.push(r),
    onResolved: () => {},
    onChange: () => {},
    onDayChange: () => {
      h.dayChanges += 1;
    },
  });
  h.advance = (ms) => vi.advanceTimersByTime(ms);
  h.sleepFor = (ms) => {
    vi.setSystemTime(Date.now() + ms);
    h.scheduler.tick();
  };
  h.scheduler.start();
  return h;
}

export const MIN = 60_000;

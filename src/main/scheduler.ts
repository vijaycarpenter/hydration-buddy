// Reminder scheduler. Lives in the main process so it keeps running while every
// window is closed. It owns exactly one timer and at most one active reminder,
// and persists its state so pending reminders survive a restart.
//
// Rather than sleeping until the next reminder in one long setTimeout, it wakes
// at most every MAX_WAIT_MS and compares against the wall clock. That makes it
// robust to system suspend (monotonic timers stall while asleep) and to clock or
// timezone changes, at the cost of a negligible wake-up twice a minute.
import { randomUUID } from 'node:crypto';
import type { ActiveReminder, IntakeEntry, PauseOption, ReminderAction, Result, SchedulerStatus, Settings } from '../shared/types';
import { addLocalDays, isWithinActiveHours, localDateKey, nextActiveMoment, startOfLocalDay } from '../shared/time';
import type { Store } from './store';

export const MAX_WAIT_MS = 30_000;
const STATE_KEY = 'scheduler';
const INDEFINITE = Number.MAX_SAFE_INTEGER;

interface PersistedState {
  mode: 'normal' | 'retry';
  nextAt: number | null;
  /** INDEFINITE = paused until resumed */
  pausedUntil: number | null;
  active: ActiveReminder | null;
  /** attempt number the next reminder will carry */
  nextAttempt: number;
}

export interface SchedulerDeps {
  store: Store;
  getSettings: () => Settings;
  now?: () => number;
  /** Length of a "minute"; lowered in tests to run scenarios in seconds. */
  minuteMs?: number;
  onFire: (reminder: ActiveReminder) => void;
  onResolved: (reminderId: string, action: ReminderAction, entry: IntakeEntry | null) => void;
  onChange: () => void;
  onDayChange: () => void;
}

const DEFAULT_STATE: PersistedState = { mode: 'normal', nextAt: null, pausedUntil: null, active: null, nextAttempt: 1 };

export class ReminderScheduler {
  private state: PersistedState;
  private sessionStopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastDayKey: string;
  private running = false;
  private readonly now: () => number;
  readonly minuteMs: number;

  constructor(private deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.minuteMs = deps.minuteMs ?? 60_000;
    this.state = sanitizeState(deps.store.getMeta<PersistedState>(STATE_KEY));
    this.lastDayKey = localDateKey(this.now());
  }

  start() {
    this.running = true;
    // A reminder that was on screen when the app last exited is shown again (same id), unless it has expired.
    const a = this.state.active;
    if (a && this.now() - a.firedAt < this.retryMs()) this.deps.onFire(a);
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  status(): SchedulerStatus {
    const s = this.deps.getSettings();
    const paused = this.isPaused(this.now());
    return {
      mode: this.state.mode,
      nextAt: this.state.nextAt,
      pausedUntil: paused && this.state.pausedUntil !== INDEFINITE ? this.state.pausedUntil : null,
      pausedIndefinitely: paused && this.state.pausedUntil === INDEFINITE,
      sessionStopped: this.sessionStopped,
      active: this.state.active,
      withinActiveHours: isWithinActiveHours(this.now(), s.activeStart, s.activeEnd),
      minuteMs: this.minuteMs,
    };
  }

  /** Evaluates the schedule against the clock and re-arms the single timer. Safe to call at any time. */
  tick() {
    const now = this.now();
    const s = this.deps.getSettings();

    const dayKey = localDateKey(now);
    if (dayKey !== this.lastDayKey) {
      this.lastDayKey = dayKey;
      this.deps.onDayChange();
    }

    if (!this.sessionStopped) {
      if (this.state.pausedUntil !== null && now >= this.state.pausedUntil) this.endPause(now);

      if (!this.isPaused(now)) {
        const a = this.state.active;
        if (a && now - a.firedAt >= this.retryMs()) {
          // Left unanswered for a full retry period: count it as dismissed and remind again now.
          this.finish(a, 'dismissed', now, now, { detail: 'timeout' });
        }
        if (!this.state.active) {
          if (this.state.nextAt === null) this.setNext(this.normalAfter(now), 'normal');
          if (this.state.nextAt !== null && now >= this.state.nextAt) {
            if (isWithinActiveHours(now, s.activeStart, s.activeEnd)) this.fire(now);
            else this.setNext(nextActiveMoment(now, s.activeStart, s.activeEnd), this.state.mode);
          }
        }
      }
    }
    this.arm();
  }

  /** Applies the user's answer to the active reminder. Answers for any other id are ignored. */
  resolve(id: string, action: ReminderAction, opts: { amountMl?: number; detail?: string } = {}): Result<IntakeEntry | null> {
    const a = this.state.active;
    if (!a || a.id !== id) return { ok: false, error: 'This reminder has already been answered.' };
    const now = this.now();
    const next = action === 'drank' ? this.normalAfter(now) : this.retryAfter(now);
    try {
      const entry = this.finish(a, action, now, next, {
        amountMl: opts.amountMl ?? this.deps.getSettings().servingMl,
        detail: action === 'dismissed' ? opts.detail ?? 'closed' : null,
      });
      this.arm();
      return { ok: true, value: entry };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** A drink logged outside the popup also restores the normal schedule (and answers an open reminder). */
  drinkLogged(entry: IntakeEntry) {
    const now = this.now();
    const a = this.state.active;
    if (a) this.finish(a, 'drank', now, this.normalAfter(now), { existingEntryId: entry.id });
    else this.setNext(this.normalAfter(now), 'normal', 1);
    this.arm();
  }

  pause(option: PauseOption) {
    const now = this.now();
    const s = this.deps.getSettings();
    let until: number;
    if (option === 'indefinite') until = INDEFINITE;
    else if (option === 'tomorrow')
      until = nextActiveMoment(addLocalDays(startOfLocalDay(now), 1), s.activeStart, s.activeEnd);
    else until = now + option * this.minuteMs;
    if (this.state.active) this.finish(this.state.active, 'dismissed', now, null, { detail: 'paused' });
    this.state.pausedUntil = until;
    this.save();
    this.arm();
  }

  resume() {
    this.sessionStopped = false;
    this.endPause(this.now());
    this.tick();
  }

  /** Stops all reminders until the app restarts (or the user resumes). Not persisted on purpose. */
  stopForSession() {
    const now = this.now();
    if (this.state.active) this.finish(this.state.active, 'dismissed', now, null, { detail: 'paused' });
    this.sessionStopped = true;
    this.deps.onChange();
    this.arm();
  }

  /** Shows a reminder immediately (Settings → "Show a reminder now", tray). Re-shows the open one if any. */
  triggerNow() {
    if (this.state.active) this.deps.onFire(this.state.active);
    else this.fire(this.now());
    this.arm();
  }

  settingsChanged(prev: Settings, next: Settings) {
    if (prev.intervalMin === next.intervalMin && prev.retryMin === next.retryMin &&
        prev.activeStart === next.activeStart && prev.activeEnd === next.activeEnd) return;
    if (this.state.nextAt !== null) {
      const now = this.now();
      // Only ever bring the next reminder forward; never postpone one the user is expecting.
      const candidate = this.state.mode === 'retry' ? this.retryAfter(now) : this.normalAfter(now);
      if (candidate < this.state.nextAt) this.setNext(candidate, this.state.mode);
    }
    this.tick();
  }

  // ---------- internals ----------

  private retryMs() {
    return this.deps.getSettings().retryMin * this.minuteMs;
  }

  private normalAfter(t: number) {
    const s = this.deps.getSettings();
    return nextActiveMoment(t + s.intervalMin * this.minuteMs, s.activeStart, s.activeEnd);
  }

  private retryAfter(t: number) {
    const s = this.deps.getSettings();
    return nextActiveMoment(t + s.retryMin * this.minuteMs, s.activeStart, s.activeEnd);
  }

  private isPaused(now: number) {
    return this.sessionStopped || (this.state.pausedUntil !== null && now < this.state.pausedUntil);
  }

  private endPause(now: number) {
    if (this.state.pausedUntil === null) return;
    this.state.pausedUntil = null;
    // Give the user a moment after a pause instead of reminding the instant it ends.
    const earliest = this.retryAfter(now);
    if (this.state.nextAt === null || this.state.nextAt < earliest) this.state.nextAt = earliest;
    this.save();
  }

  private fire(now: number) {
    const reminder: ActiveReminder = { id: randomUUID(), firedAt: now, attempt: this.state.nextAttempt };
    this.state.active = reminder;
    this.state.nextAt = null;
    this.save();
    this.deps.onFire(reminder);
  }

  private finish(
    a: ActiveReminder,
    action: ReminderAction,
    now: number,
    nextAt: number | null,
    extra: { amountMl?: number; detail?: string | null; existingEntryId?: string },
  ): IntakeEntry | null {
    const { entry } = this.deps.store.recordReminderOutcome({
      reminderId: a.id,
      firedAt: a.firedAt,
      action,
      actionAt: now,
      detail: extra.detail ?? null,
      nextAt,
      amountMl: extra.amountMl,
      existingEntryId: extra.existingEntryId,
    });
    this.state.active = null;
    this.state.mode = action === 'drank' ? 'normal' : 'retry';
    this.state.nextAt = nextAt;
    this.state.nextAttempt = action === 'drank' ? 1 : a.attempt + 1;
    this.save();
    this.deps.onResolved(a.id, action, entry);
    return entry;
  }

  private setNext(nextAt: number, mode: PersistedState['mode'], nextAttempt = this.state.nextAttempt) {
    this.state.nextAt = nextAt;
    this.state.mode = mode;
    this.state.nextAttempt = nextAttempt;
    this.save();
  }

  private save() {
    this.deps.store.setMeta(STATE_KEY, this.state);
    this.deps.onChange();
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    const now = this.now();
    const targets = [addLocalDays(startOfLocalDay(now), 1)];
    if (!this.isPaused(now) && this.state.nextAt !== null && !this.state.active) targets.push(this.state.nextAt);
    if (this.state.pausedUntil !== null && this.state.pausedUntil !== INDEFINITE) targets.push(this.state.pausedUntil);
    if (this.state.active) targets.push(this.state.active.firedAt + this.retryMs());
    const delay = Math.min(Math.max(Math.min(...targets) - now, 200), MAX_WAIT_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }
}

function sanitizeState(raw: PersistedState | null): PersistedState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const a = raw.active;
  return {
    mode: raw.mode === 'retry' ? 'retry' : 'normal',
    nextAt: num(raw.nextAt),
    pausedUntil: num(raw.pausedUntil),
    active:
      a && typeof a.id === 'string' && num(a.firedAt) !== null
        ? { id: a.id, firedAt: a.firedAt, attempt: num(a.attempt) ?? 1 }
        : null,
    nextAttempt: num(raw.nextAttempt) ?? 1,
  };
}

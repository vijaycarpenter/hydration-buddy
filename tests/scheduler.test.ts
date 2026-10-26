import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/store';
import { at, makeHarness, MIN, type Harness } from './helpers';
import { addLocalDays, startOfLocalDay } from '../src/shared/time';

let h: Harness;
afterEach(() => {
  h?.scheduler.stop();
  vi.useRealTimers();
});

const todayTotal = (hh: Harness) => hh.store.dailyTotals(1, Date.now())[0].totalMl;
const history = (hh: Harness) => hh.store.remindersBetween(0, Date.now() + 1).map((r) => r.action);

describe('reminder scheduler', () => {
  it('1. fires at the configured interval, and only once', async () => {
    h = await makeHarness();
    h.advance(59 * MIN);
    expect(h.fired).toHaveLength(0);
    h.advance(1 * MIN);
    expect(h.fired).toHaveLength(1);
    // Nothing else fires while the reminder is open (until the retry timeout).
    h.advance(9 * MIN);
    expect(h.fired).toHaveLength(1);
  });

  it('2. "I drank water" adds the serving exactly once, even if clicked repeatedly', async () => {
    h = await makeHarness({ settings: { servingMl: 300 } });
    h.advance(60 * MIN);
    const id = h.fired[0].id;
    const first = h.scheduler.resolve(id, 'drank');
    const second = h.scheduler.resolve(id, 'drank');
    const third = h.scheduler.resolve(id, 'drank');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(third.ok).toBe(false);
    expect(todayTotal(h)).toBe(300);
    const rec = h.store.remindersBetween(0, Date.now() + 1);
    expect(rec).toHaveLength(1);
    expect(rec[0].waterEntryId).toBe(first.value!.id);
  });

  it('honours a custom amount picked in the popup', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'drank', { amountMl: 500 });
    expect(todayTotal(h)).toBe(500);
  });

  it('4. "Remind me later" reminds again after the retry delay', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'later');
    expect(h.scheduler.status().mode).toBe('retry');
    expect(h.scheduler.status().nextAt).toBe(Date.now() + 10 * MIN);
    h.advance(10 * MIN - 1000);
    expect(h.fired).toHaveLength(1);
    h.advance(1000);
    expect(h.fired).toHaveLength(2);
    expect(h.fired[1].attempt).toBe(2);
    expect(todayTotal(h)).toBe(0);
  });

  it('5. "Skip" records a skip and reminds again after the retry delay', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'skipped');
    h.advance(10 * MIN);
    expect(h.fired).toHaveLength(2);
    expect(history(h)).toEqual(['skipped']);
    expect(todayTotal(h)).toBe(0);
  });

  it('later and skip are distinguished in history', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'later');
    h.advance(10 * MIN);
    h.scheduler.resolve(h.fired[1].id, 'skipped');
    expect(history(h)).toEqual(['later', 'skipped']);
  });

  it('6. repeated skips never stack timers or overlapping reminders', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    for (let i = 0; i < 6; i++) {
      const r = h.fired[h.fired.length - 1];
      // Several clicks per reminder, as an impatient user might do.
      h.scheduler.resolve(r.id, 'skipped');
      h.scheduler.resolve(r.id, 'skipped');
      h.scheduler.tick();
      h.scheduler.tick();
      expect(vi.getTimerCount()).toBe(1);
      h.advance(10 * MIN);
      expect(h.fired).toHaveLength(i + 2);
    }
    expect(history(h)).toHaveLength(6);
    expect(new Set(h.fired.map((f) => f.id)).size).toBe(h.fired.length);
  });

  it('an ignored reminder re-reminds every retry period without opening a second one', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.advance(10 * MIN);
    expect(h.fired).toHaveLength(2);
    expect(h.store.remindersBetween(0, Date.now() + 1)[0]).toMatchObject({ action: 'dismissed', detail: 'timeout' });
    expect(h.scheduler.status().active?.id).toBe(h.fired[1].id);
  });

  it('7. drinking exits the retry loop and restores the normal interval', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'skipped');
    h.advance(10 * MIN);
    h.scheduler.resolve(h.fired[1].id, 'drank');
    expect(h.scheduler.status().mode).toBe('normal');
    h.advance(59 * MIN);
    expect(h.fired).toHaveLength(2);
    h.advance(1 * MIN);
    expect(h.fired).toHaveLength(3);
    expect(h.fired[2].attempt).toBe(1);
  });

  it('a drink logged from the dashboard answers the open reminder and resets the schedule', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    const entry = h.store.addEntry({ amountMl: 200, source: 'quick' });
    h.scheduler.drinkLogged(entry);
    expect(h.scheduler.status().active).toBeNull();
    expect(h.store.remindersBetween(0, Date.now() + 1)[0]).toMatchObject({ action: 'drank', waterEntryId: entry.id });
    expect(todayTotal(h)).toBe(200);
    expect(h.scheduler.status().nextAt).toBe(Date.now() + 60 * MIN);
  });

  it('8. pausing prevents reminders; resuming brings them back', async () => {
    h = await makeHarness();
    h.scheduler.pause('indefinite');
    h.advance(5 * 60 * MIN);
    expect(h.fired).toHaveLength(0);
    h.scheduler.resume();
    h.advance(10 * MIN);
    expect(h.fired).toHaveLength(1);
  });

  it('a timed pause ends on its own', async () => {
    h = await makeHarness();
    h.advance(60 * MIN);
    h.scheduler.pause(30);
    expect(h.scheduler.status().active).toBeNull();
    h.advance(39 * MIN);
    expect(h.fired).toHaveLength(1);
    h.advance(2 * MIN);
    expect(h.fired).toHaveLength(2);
  });

  it('stop-for-session silences reminders until resumed', async () => {
    h = await makeHarness();
    h.scheduler.stopForSession();
    h.advance(3 * 60 * MIN);
    expect(h.fired).toHaveLength(0);
    expect(h.scheduler.status().sessionStopped).toBe(true);
  });

  it('respects active hours and resumes at the next window start', async () => {
    h = await makeHarness({ start: at(20, 30) });
    h.advance(60 * MIN); // 21:30, outside 09:00–21:00
    expect(h.fired).toHaveLength(0);
    expect(h.scheduler.status().nextAt).toBe(at(9, 0, 1));
    h.advance(at(9, 0, 1) - Date.now());
    expect(h.fired).toHaveLength(1);
  });

  it('9. settings, history and a pending reminder survive a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
    const file = path.join(dir, 'data.sqlite');
    let store = await Store.open(file);
    h = await makeHarness({ store });
    store.saveSettings({ ...h.settings, dailyGoalMl: 2500, servingMl: 330 });
    h.advance(60 * MIN);
    h.scheduler.resolve(h.fired[0].id, 'drank', { amountMl: 330 });
    h.scheduler.resolve('nope', 'drank');
    h.advance(60 * MIN); // a reminder is open when the app quits
    const openId = h.fired[1].id;
    h.scheduler.stop();
    store.close();

    store = await Store.open(file);
    expect(store.getSettings()).toMatchObject({ dailyGoalMl: 2500, servingMl: 330 });
    expect(store.dailyTotals(1, Date.now())[0].totalMl).toBe(330);
    const h2 = await makeHarness({ store, start: Date.now() + 2 * MIN });
    expect(h2.fired.map((f) => f.id)).toEqual([openId]); // re-shown, not duplicated
    h2.scheduler.stop();
    fs.rmSync(dir, { recursive: true });
  });

  it('10. daily totals reset on the next local calendar day', async () => {
    h = await makeHarness({ start: at(20, 55) });
    h.store.addEntry({ amountMl: 500, source: 'manual' });
    expect(todayTotal(h)).toBe(500);
    h.advance(10 * MIN); // crosses midnight? no – 21:05
    h.advance(3 * 60 * MIN); // 00:05 next day
    expect(h.dayChanges).toBe(1);
    expect(todayTotal(h)).toBe(0);
    const week = h.store.dailyTotals(7, Date.now());
    expect(week[5].totalMl).toBe(500);
    expect(week[6].totalMl).toBe(0);
    expect(startOfLocalDay(Date.now())).toBe(addLocalDays(startOfLocalDay(at(12)), 1));
  });

  it('11. after a long sleep it reminds once on wake, not once per missed interval', async () => {
    h = await makeHarness();
    h.sleepFor(5 * 60 * MIN); // 15:00
    expect(h.fired).toHaveLength(1);
    h.advance(1000);
    expect(h.fired).toHaveLength(1);
  });

  it('sleeping through the night waits for active hours instead of firing at wake', async () => {
    h = await makeHarness({ start: at(20, 50) });
    h.sleepFor(4 * 60 * MIN); // wakes 00:50
    expect(h.fired).toHaveLength(0);
    expect(h.scheduler.status().nextAt).toBe(at(9, 0, 1));
  });

  it('only brings the next reminder forward when the interval shrinks', async () => {
    h = await makeHarness();
    const before = h.scheduler.status().nextAt!;
    const prev = h.settings;
    h.settings = { ...prev, intervalMin: 30 };
    h.scheduler.settingsChanged(prev, h.settings);
    expect(h.scheduler.status().nextAt).toBe(Date.now() + 30 * MIN);
    const prev2 = h.settings;
    h.settings = { ...prev2, intervalMin: 120 };
    h.scheduler.settingsChanged(prev2, h.settings);
    expect(h.scheduler.status().nextAt).toBe(Date.now() + 30 * MIN);
    expect(before).toBe(Date.now() + 60 * MIN);
  });
});

import { describe, expect, it } from 'vitest';
import { applySettingsPatch, DEFAULT_SETTINGS, sanitizeStoredSettings } from '../src/shared/settings';
import { isWithinActiveHours, nextActiveMoment } from '../src/shared/time';
import { Store, ValidationError } from '../src/main/store';
import { at } from './helpers';

describe('active hours', () => {
  it('handles a daytime window', () => {
    expect(isWithinActiveHours(at(8, 59), '09:00', '21:00')).toBe(false);
    expect(isWithinActiveHours(at(9), '09:00', '21:00')).toBe(true);
    expect(isWithinActiveHours(at(21), '09:00', '21:00')).toBe(false);
  });
  it('handles a window that crosses midnight', () => {
    expect(isWithinActiveHours(at(23), '22:00', '06:00')).toBe(true);
    expect(isWithinActiveHours(at(3), '22:00', '06:00')).toBe(true);
    expect(isWithinActiveHours(at(12), '22:00', '06:00')).toBe(false);
    expect(nextActiveMoment(at(12), '22:00', '06:00')).toBe(at(22));
  });
  it('treats equal start and end as all day', () => {
    expect(isWithinActiveHours(at(3), '00:00', '00:00')).toBe(true);
  });
  it('rolls to tomorrow after the window closes', () => {
    expect(nextActiveMoment(at(22), '09:00', '21:00')).toBe(at(9, 0, 1));
    expect(nextActiveMoment(at(7), '09:00', '21:00')).toBe(at(9));
  });
});

describe('settings validation', () => {
  it('accepts valid patches', () => {
    const r = applySettingsPatch(DEFAULT_SETTINGS, { dailyGoalMl: 3000, theme: 'dark' });
    expect(r.fieldErrors).toEqual({});
    expect(r.settings.dailyGoalMl).toBe(3000);
  });
  it('rejects invalid values without applying any part of the patch', () => {
    const r = applySettingsPatch(DEFAULT_SETTINGS, { dailyGoalMl: -5, servingMl: 300, activeStart: '25:00', bogus: 1 });
    expect(Object.keys(r.fieldErrors).sort()).toEqual(['activeStart', 'bogus', 'dailyGoalMl']);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
  });
  it('rejects shortcut strings that are not accelerators', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { shortcut: 'Ctrl+Alt+H; rm -rf /' }).fieldErrors.shortcut).toBeTruthy();
    expect(applySettingsPatch(DEFAULT_SETTINGS, { shortcut: 'Ctrl+Shift+W' }).fieldErrors).toEqual({});
  });
  it('falls back to defaults for corrupt stored values', () => {
    expect(sanitizeStoredSettings({ dailyGoalMl: 'lots', servingMl: 200 })).toMatchObject({ dailyGoalMl: 2000, servingMl: 200 });
  });
});

describe('store', () => {
  it('validates entries', async () => {
    const s = await Store.open(null);
    expect(() => s.addEntry({ amountMl: 0, source: 'manual' })).toThrow(ValidationError);
    expect(() => s.addEntry({ amountMl: 2.5, source: 'manual' })).toThrow(ValidationError);
    expect(() => s.addEntry({ amountMl: 200, source: 'hacker' })).toThrow(ValidationError);
    expect(() => s.addEntry({ amountMl: 200, source: 'manual', timestamp: '2999-01-01T00:00:00Z' })).toThrow(ValidationError);
  });
  it('edits and deletes entries, unlinking reminder history', async () => {
    const s = await Store.open(null);
    const { entry } = s.recordReminderOutcome({
      reminderId: 'r1', firedAt: Date.now(), action: 'drank', actionAt: Date.now(), nextAt: null, amountMl: 250,
    });
    s.updateEntry(entry!.id, { amountMl: 400, note: 'big glass' });
    expect(s.getEntry(entry!.id)).toMatchObject({ amountMl: 400, note: 'big glass' });
    expect(s.deleteEntry(entry!.id)).toBe(true);
    expect(s.remindersBetween(0, Date.now() + 1)[0].waterEntryId).toBeNull();
  });
  it('resets only the current day', async () => {
    const s = await Store.open(null);
    const now = Date.now();
    s.addEntry({ amountMl: 300, source: 'manual', timestamp: new Date(now - 86_400_000 * 2).toISOString() }, now);
    s.addEntry({ amountMl: 200, source: 'manual' }, now);
    expect(s.resetDay(now)).toBe(1);
    expect(s.dailyTotals(3, now).map((d) => d.totalMl)).toEqual([300, 0, 0]);
  });
  it('escapes CSV and formula injection', async () => {
    const s = await Store.open(null);
    s.addEntry({ amountMl: 200, source: 'manual', note: '=HYPERLINK("x")' });
    expect(s.exportEntriesCsv()).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

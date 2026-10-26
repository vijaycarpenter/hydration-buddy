import { useEffect, useState } from 'react';
import type { Settings, Snapshot } from '../../shared/types';
import { INTERVAL_PRESETS, SERVING_PRESETS } from '../../shared/settings';
import { api } from '../lib/api';
import { playReminderChime } from '../lib/sound';
import { Drip } from '../components/Drip';
import { DASHBOARD_SPRITE_HEIGHT } from '../../shared/companion';

export function SettingsView({ snapshot, onSaved }: { snapshot: Snapshot; onSaved: () => void }) {
  const [draft, setDraft] = useState<Settings>(snapshot.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the form in sync if settings change elsewhere, unless the user has unsaved edits.
  const dirtyKeys = (Object.keys(draft) as (keyof Settings)[]).filter((k) => draft[k] !== snapshot.settings[k]);
  useEffect(() => {
    if (!dirtyKeys.length) setDraft(snapshot.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.settings]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setStatus(null);
  };

  const save = async () => {
    setBusy(true);
    const patch = Object.fromEntries(dirtyKeys.map((k) => [k, draft[k]]));
    const res = await api.updateSettings(patch);
    setBusy(false);
    setErrors(res.fieldErrors ?? {});
    if (res.ok) {
      setStatus(res.fieldErrors ? 'Saved, with a warning below.' : 'Settings saved ✓');
      onSaved();
    } else setStatus(res.error ?? 'Could not save.');
  };

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus((s) => (s === msg ? null : s)), 4000);
  };

  const exportData = async (format: 'json' | 'csv') => {
    const res = await api.exportData(format);
    if (res.ok) flash(`Exported to ${res.value}`);
    else if (res.error) flash(res.error);
  };
  const backup = async () => {
    const res = await api.backupDatabase();
    if (res.ok) flash(`Backup saved to ${res.value}`);
    else if (res.error) flash(res.error);
  };
  const reset = async () => {
    await api.resetToday();
    setConfirmReset(false);
    flash("Today's entries were removed.");
  };

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, (e.target.value === '' ? NaN : Number(e.target.value)) as never);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <Section title="Daily goal" hint="2,000 ml is a common starting point, not a medical recommendation. Needs vary with body, activity, climate and health. Follow your clinician's advice if you have one.">
        <Field label="Daily goal (ml)" error={errors.dailyGoalMl}>
          <input className="input w-32" type="number" min={250} max={10000} step={50} value={numVal(draft.dailyGoalMl)} onChange={num('dailyGoalMl')} />
        </Field>
        <Field label="Default serving (ml)" error={errors.servingMl}>
          <div className="flex flex-wrap items-center gap-1.5">
            {SERVING_PRESETS.map((p) => (
              <button key={p} type="button" className={`chip ${draft.servingMl === p ? 'chip-active' : ''}`} onClick={() => set('servingMl', p)}>
                {p} ml
              </button>
            ))}
            <input className="input w-24 py-1" type="number" min={25} max={2000} value={numVal(draft.servingMl)} onChange={num('servingMl')} aria-label="Custom serving size" />
          </div>
        </Field>
      </Section>

      <Section title="Reminder schedule" hint="Reminders only appear during active hours. After “Remind me later” or “Skip”, the retry delay is used until you record a drink.">
        <Field label="Remind me every" error={errors.intervalMin}>
          <div className="flex flex-wrap items-center gap-1.5">
            {INTERVAL_PRESETS.map((p) => (
              <button key={p} type="button" className={`chip ${draft.intervalMin === p ? 'chip-active' : ''}`} onClick={() => set('intervalMin', p)}>
                {p} min
              </button>
            ))}
            <input className="input w-24 py-1" type="number" min={5} max={480} value={numVal(draft.intervalMin)} onChange={num('intervalMin')} aria-label="Custom interval in minutes" />
            <span className="text-xs text-slate-400">minutes</span>
          </div>
        </Field>
        <Field label="Retry after Later / Skip" error={errors.retryMin}>
          <div className="flex items-center gap-2">
            <input className="input w-24" type="number" min={1} max={120} value={numVal(draft.retryMin)} onChange={num('retryMin')} />
            <span className="text-xs text-slate-400">minutes</span>
          </div>
        </Field>
        <Field label="Active hours" error={errors.activeStart || errors.activeEnd}>
          <div className="flex items-center gap-2">
            <input className="input w-32" type="time" value={draft.activeStart} onChange={(e) => set('activeStart', e.target.value)} aria-label="Start" />
            <span>to</span>
            <input className="input w-32" type="time" value={draft.activeEnd} onChange={(e) => set('activeEnd', e.target.value)} aria-label="End" />
          </div>
        </Field>
        {snapshot.scheduler.minuteMs !== 60_000 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            Test mode: one “minute” is {snapshot.scheduler.minuteMs / 1000} s (HB_MINUTE_MS).
          </p>
        )}
      </Section>

      <Section title="Reminder window & notifications">
        <Toggle label="Show the floating reminder window" checked={draft.popupEnabled} onChange={(v) => set('popupEnabled', v)} error={errors.popupEnabled} />
        <Toggle label="Also show a desktop notification" checked={draft.notificationsEnabled} onChange={(v) => set('notificationsEnabled', v)} />
        <Toggle label="Keep the reminder window above other windows" hint="It never takes keyboard focus." checked={draft.alwaysOnTop} onChange={(v) => set('alwaysOnTop', v)} />
        <Toggle label="Play sounds" checked={draft.soundEnabled} onChange={(v) => set('soundEnabled', v)} />
        <Field label="Volume" error={errors.soundVolume}>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={1} step={0.05} value={draft.soundVolume} onChange={(e) => set('soundVolume', Number(e.target.value))} disabled={!draft.soundEnabled} className="w-48 accent-sky-500" />
            <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => playReminderChime(draft.soundVolume)} disabled={!draft.soundEnabled}>
              ▶ Test
            </button>
          </div>
        </Field>
        <button type="button" className="btn-secondary" onClick={() => api.triggerReminderNow()}>
          Show a reminder now
        </button>
      </Section>

      <Section title="Companion">
        <div className="flex gap-6">
          <div className="flex-1 space-y-3">
            <Toggle label="Show Drip on the dashboard and in reminders" checked={draft.characterVisible} onChange={(v) => set('characterVisible', v)} />
            <Toggle label="Animations" hint="Also respects your system's reduced-motion setting." checked={draft.characterAnimations} onChange={(v) => set('characterAnimations', v)} />
            <Field label="Size">
              <Segmented value={draft.characterSize} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} onChange={(v) => set('characterSize', v)} />
            </Field>
          </div>
          {draft.characterVisible && <Drip mood="walk" height={DASHBOARD_SPRITE_HEIGHT[draft.characterSize]} animated={draft.characterAnimations} />}
        </div>
      </Section>

      <Section title="Appearance">
        <Field label="Theme">
          <Segmented value={draft.theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set('theme', v)} />
        </Field>
      </Section>

      <Section title="Desktop">
        <Toggle label="Start Hydration Buddy when I log in" hint="Starts quietly in the tray." checked={draft.startAtLogin} onChange={(v) => set('startAtLogin', v)} />
        <Toggle
          label="Closing or minimizing the dashboard keeps reminders running in the tray"
          hint="When off, closing the dashboard quits the app and reminders stop."
          checked={draft.minimizeToTray}
          onChange={(v) => set('minimizeToTray', v)}
        />
        <Field label="Shortcut to open the dashboard" error={errors.shortcut}>
          <input className="input w-64" value={draft.shortcut} onChange={(e) => set('shortcut', e.target.value)} placeholder="CommandOrControl+Alt+H" />
        </Field>
      </Section>

      <Section title="Your data" hint="Everything stays on this computer. Nothing is sent anywhere.">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => exportData('json')}>
            Export all (JSON)
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportData('csv')}>
            Export entries (CSV)
          </button>
          <button type="button" className="btn-secondary" onClick={backup}>
            Back up database
          </button>
        </div>
        <div className="flex items-center gap-2 pt-2">
          {confirmReset ? (
            <>
              <span className="text-sm">Remove all of today's water entries? This cannot be undone.</span>
              <button type="button" className="btn-danger" onClick={reset}>
                Yes, reset today
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn-danger" onClick={() => setConfirmReset(true)}>
              Reset today's progress…
            </button>
          )}
        </div>
      </Section>

      {/* sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-sky-100 bg-white/90 px-8 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <span className="text-sm text-slate-500" role="status">
            {status ?? (dirtyKeys.length ? `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? 's' : ''}` : 'All changes saved')}
          </span>
          <button className="btn-ghost ml-auto" onClick={() => (setDraft(snapshot.settings), setErrors({}))} disabled={!dirtyKeys.length}>
            Discard
          </button>
          <button className="btn-primary" onClick={save} disabled={busy || !dirtyKeys.length}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

const numVal = (n: number) => (Number.isNaN(n) ? '' : n);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[220px_1fr]">
      <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <div>
        {children}
        {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange, error }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        <span className="text-sm">
          {label}
          {hint && <span className="block text-xs text-slate-400">{hint}</span>}
        </span>
      </label>
      {error && <p className="ml-14 mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="radiogroup">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${value === v ? 'bg-white shadow-sm dark:bg-slate-600' : 'text-slate-500'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

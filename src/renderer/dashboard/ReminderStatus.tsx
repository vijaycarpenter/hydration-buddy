import { useState } from 'react';
import type { PauseOption, Snapshot } from '../../shared/types';
import { api } from '../lib/api';
import { countdown, time } from '../lib/format';
import { useNow } from '../lib/useSnapshot';

export function reminderStatusText(s: Snapshot, now: number): { label: string; detail: string; tone: 'ok' | 'paused' | 'waiting' | 'retry' } {
  const st = s.scheduler;
  if (st.sessionStopped) return { label: 'Reminders stopped', detail: 'until you resume or restart the app', tone: 'paused' };
  if (st.pausedIndefinitely) return { label: 'Reminders paused', detail: 'until you resume', tone: 'paused' };
  if (st.pausedUntil) return { label: 'Paused', detail: `until ${time(st.pausedUntil)}`, tone: 'paused' };
  if (st.active) return { label: 'Reminder waiting', detail: 'answer it to continue', tone: 'waiting' };
  if (!st.nextAt) return { label: 'Scheduling…', detail: '', tone: 'ok' };
  return {
    label: `Next reminder ${countdown(st.nextAt - now)}`,
    detail: `${time(st.nextAt)}${st.mode === 'retry' ? ' · retry' : ''}${st.withinActiveHours ? '' : ' · outside active hours'}`,
    tone: st.mode === 'retry' ? 'retry' : 'ok',
  };
}

const TONES = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  retry: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  waiting: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  paused: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
const DOT = { ok: 'bg-emerald-500', retry: 'bg-amber-500', waiting: 'bg-sky-500 animate-pulse', paused: 'bg-slate-400' };

export function StatusPill({ snapshot }: { snapshot: Snapshot }) {
  const now = useNow(1000);
  const s = reminderStatusText(snapshot, now);
  return (
    <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ${TONES[s.tone]}`} title={s.detail}>
      <span className={`h-2 w-2 rounded-full ${DOT[s.tone]}`} aria-hidden />
      {s.label}
    </div>
  );
}

/** Next-reminder countdown card with pause / resume controls. */
export function ReminderCard({ snapshot }: { snapshot: Snapshot }) {
  const now = useNow(1000);
  const [menu, setMenu] = useState(false);
  const st = snapshot.scheduler;
  const s = reminderStatusText(snapshot, now);
  const paused = st.sessionStopped || st.pausedIndefinitely || st.pausedUntil !== null;
  const progress =
    st.nextAt && !paused && !st.active
      ? 1 - Math.min(Math.max((st.nextAt - now) / ((st.mode === 'retry' ? snapshot.settings.retryMin : snapshot.settings.intervalMin) * st.minuteMs), 0), 1)
      : 0;

  const pause = (o: PauseOption) => {
    setMenu(false);
    api.pause(o);
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-title">Reminders</h2>
        <span className="text-xs text-slate-400">
          every {snapshot.settings.intervalMin} min · {snapshot.settings.activeStart}–{snapshot.settings.activeEnd}
        </span>
      </div>
      <div className="text-xl font-bold">{s.label}</div>
      <div className="mb-3 text-sm text-slate-500 dark:text-slate-400">{s.detail || ' '}</div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-sky-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-sky-500 transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="relative flex flex-wrap gap-2">
        {paused ? (
          <button className="btn-primary" onClick={() => api.resume()}>
            ▶ Resume reminders
          </button>
        ) : (
          <>
            <button className="btn-secondary" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
              ⏸ Pause…
            </button>
            <button className="btn-ghost" onClick={() => api.stopForSession()} title="No more reminders until you resume or restart the app">
              Stop for this session
            </button>
          </>
        )}
        <button className="btn-ghost" onClick={() => api.triggerReminderNow()}>
          Remind me now
        </button>
        {menu && (
          <div className="absolute left-0 top-12 z-20 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {([
              [30, '30 minutes'],
              [60, '1 hour'],
              [120, '2 hours'],
              ['tomorrow', 'Until tomorrow'],
              ['indefinite', 'Until I resume'],
            ] as [PauseOption, string][]).map(([o, l]) => (
              <button key={String(o)} className="block w-full px-4 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-700" onClick={() => pause(o)}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

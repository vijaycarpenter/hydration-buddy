import { useEffect, useState } from 'react';
import type { HistoryResult, Snapshot } from '../../shared/types';
import { api } from '../lib/api';
import { dayLabel, ml, time } from '../lib/format';
import { Timeline } from './EntryList';

const RANGES = [7, 30, 90];
const ACTION_LABEL = { drank: 'Drank', later: 'Later', skipped: 'Skipped', dismissed: 'Dismissed' } as const;

export function HistoryView({ snapshot }: { snapshot: Snapshot }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<HistoryResult | null>(null);
  const [open, setOpen] = useState<string | null>(snapshot.today.dateKey);
  const goal = snapshot.settings.dailyGoalMl;

  // Reload whenever the range or any underlying data changes.
  useEffect(() => {
    api.getHistory(days).then(setData);
  }, [days, snapshot]);

  if (!data) return null;
  const withData = data.days.filter((d) => d.count > 0);
  const avg = withData.length ? Math.round(withData.reduce((s, d) => s + d.totalMl, 0) / withData.length) : 0;
  const goalDays = data.days.filter((d) => d.totalMl >= goal).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-2xl bg-sky-100/70 p-1 dark:bg-slate-800/70" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={`rounded-xl px-3 py-1 text-sm font-semibold ${days === r ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500'}`}>
              {r} days
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-6 text-sm">
          <span>
            Average on active days: <b>{ml(avg)}</b>
          </span>
          <span>
            Goal met: <b>{goalDays}</b> / {data.days.length} days
          </span>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title mb-3">Daily intake</h2>
        <ul className="divide-y divide-sky-100 dark:divide-slate-800">
          {data.days.map((d) => {
            const pct = Math.min((d.totalMl / goal) * 100, 100);
            const isOpen = open === d.dateKey;
            return (
              <li key={d.dateKey}>
                <button className="flex w-full items-center gap-4 py-2.5 text-left" onClick={() => setOpen(isOpen ? null : d.dateKey)} aria-expanded={isOpen}>
                  <span className="w-40 text-sm font-semibold">{dayLabel(d.dateKey, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sky-100 dark:bg-slate-800">
                    <span className="block h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums">{ml(d.totalMl)}</span>
                  <span className="w-12 text-right text-xs text-slate-400">{d.totalMl >= goal ? '🎯' : `${Math.round((d.totalMl / goal) * 100)}%`}</span>
                  <span className="w-4 text-slate-400" aria-hidden>
                    {isOpen ? '▾' : '▸'}
                  </span>
                </button>
                {isOpen && (
                  <div className="pb-3 pl-2">
                    <Timeline entries={d.entries} reminders={[]} showReminders={false} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title mb-3">Reminder history</h2>
        {data.reminders.length === 0 ? (
          <p className="text-sm text-slate-400">No reminders yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-400 dark:bg-slate-900">
                <tr>
                  <th className="py-2">Reminded</th>
                  <th>Your answer</th>
                  <th>Answered</th>
                  <th>Next reminder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-50 dark:divide-slate-800">
                {data.reminders.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5">
                      {dayLabel(localKey(r.reminderAt), { month: 'short', day: 'numeric' })} {time(r.reminderAt)}
                    </td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r.action]}`}>{ACTION_LABEL[r.action]}</span>
                      {r.detail && <span className="ml-1 text-xs text-slate-400">({r.detail})</span>}
                    </td>
                    <td className="tabular-nums">{time(r.actionAt)}</td>
                    <td className="tabular-nums text-slate-500">{r.nextReminderAt ? time(r.nextReminderAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const BADGE = {
  drank: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  later: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  skipped: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  dismissed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function localKey(isoTs: string) {
  const d = new Date(isoTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

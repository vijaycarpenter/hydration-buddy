import { useState } from 'react';
import type { IntakeEntry, ReminderRecord } from '../../shared/types';
import { api } from '../lib/api';
import { ml, newRequestId, time, toLocalInput } from '../lib/format';

const SOURCE_LABEL = { reminder: 'Reminder', manual: 'Manual', quick: 'Quick add' } as const;
const ACTION_META = {
  drank: { icon: '✅', label: 'Drank at reminder' },
  later: { icon: '⏰', label: 'Reminder postponed' },
  skipped: { icon: '⏭️', label: 'Reminder skipped' },
  dismissed: { icon: '✖️', label: 'Reminder dismissed' },
} as const;
const DETAIL = { timeout: 'no answer', closed: 'closed', paused: 'reminders paused' } as Record<string, string>;

type Item = { kind: 'entry'; at: number; entry: IntakeEntry } | { kind: 'reminder'; at: number; rec: ReminderRecord };

/** Today's timeline: water entries (editable) interleaved with reminder outcomes. */
export function Timeline({ entries, reminders, showReminders = true }: { entries: IntakeEntry[]; reminders: ReminderRecord[]; showReminders?: boolean }) {
  const items: Item[] = [
    ...entries.map((e) => ({ kind: 'entry' as const, at: Date.parse(e.timestamp), entry: e })),
    // 'drank' outcomes are already represented by their water entry
    ...(showReminders ? reminders.filter((r) => r.action !== 'drank').map((r) => ({ kind: 'reminder' as const, at: Date.parse(r.actionAt), rec: r })) : []),
  ].sort((a, b) => b.at - a.at);

  if (!items.length) return <p className="py-6 text-center text-sm text-slate-400">Nothing logged yet.</p>;

  return (
    <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-sky-100 dark:before:bg-slate-700">
      {items.map((it) =>
        it.kind === 'entry' ? (
          <EntryRow key={it.entry.id} entry={it.entry} />
        ) : (
          <li key={it.rec.id} className="relative flex items-center gap-3 py-1.5 pl-1 text-sm text-slate-500 dark:text-slate-400">
            <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs dark:bg-slate-800" aria-hidden>
              {ACTION_META[it.rec.action].icon}
            </span>
            <span className="w-14 tabular-nums">{time(it.at)}</span>
            <span>
              {ACTION_META[it.rec.action].label}
              {it.rec.detail && DETAIL[it.rec.detail] ? ` (${DETAIL[it.rec.detail]})` : ''}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}

function EntryRow({ entry }: { entry: IntakeEntry }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view');
  const [amount, setAmount] = useState(String(entry.amountMl));
  const [when, setWhen] = useState(toLocalInput(entry.timestamp));
  const [note, setNote] = useState(entry.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await api.updateEntry(entry.id, { amountMl: Number(amount), timestamp: new Date(when).toISOString(), note });
    setBusy(false);
    if (res.ok) {
      setMode('view');
      setError(null);
    } else setError(res.error ?? 'Could not save.');
  };
  const remove = async () => {
    setBusy(true);
    const res = await api.deleteEntry(entry.id);
    setBusy(false);
    if (!res.ok) setError(res.error ?? 'Could not delete.');
  };

  return (
    <li className="group relative rounded-2xl py-1.5 pl-1 pr-2 hover:bg-sky-50/70 dark:hover:bg-slate-800/50">
      <div className="flex items-center gap-3 text-sm">
        <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 text-xs text-white" aria-hidden>
          💧
        </span>
        <span className="w-14 tabular-nums text-slate-500 dark:text-slate-400">{time(entry.timestamp)}</span>
        <span className="font-semibold">{ml(entry.amountMl)}</span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-slate-800 dark:text-sky-300">{SOURCE_LABEL[entry.source]}</span>
        {entry.note && <span className="truncate text-xs text-slate-400">“{entry.note}”</span>}
        {mode === 'view' && (
          <span className="ml-auto flex gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
            <button className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-white dark:hover:bg-slate-700" onClick={() => setMode('edit')}>
              Edit
            </button>
            <button className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-white dark:hover:bg-slate-700" onClick={() => setMode('confirm-delete')}>
              Delete
            </button>
          </span>
        )}
        {mode === 'confirm-delete' && (
          <span className="ml-auto flex items-center gap-1 text-xs">
            Delete this entry?
            <button className="btn-danger px-2 py-1 text-xs" onClick={remove} disabled={busy}>
              Delete
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setMode('view')}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {mode === 'edit' && (
        <div className="ml-12 mt-2 grid grid-cols-[90px_1fr] gap-2 sm:grid-cols-[110px_190px_1fr_auto]">
          <input className="input" type="number" min={1} max={5000} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in ml" />
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Time" />
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          <div className="flex gap-1">
            <button className="btn-primary px-3 py-2" onClick={save} disabled={busy}>
              Save
            </button>
            <button className="btn-ghost px-3 py-2" onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="ml-12 mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  );
}

/** Form for back-dated or custom entries. */
export function AddEntryForm({ defaultAmount, onDone }: { defaultAmount: number; onDone?: () => void }) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const [when, setWhen] = useState(toLocalInput(Date.now()));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = await api.addEntry({
      amountMl: Number(amount),
      timestamp: new Date(when).toISOString(),
      source: 'manual',
      note,
      requestId: newRequestId(),
    });
    setBusy(false);
    if (res.ok) {
      setError(null);
      setNote('');
      onDone?.();
    } else setError(res.error ?? 'Could not add entry.');
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl bg-sky-50/80 p-3 dark:bg-slate-800/60">
      <div className="grid grid-cols-[100px_1fr] gap-2">
        <label className="text-xs text-slate-500">
          Amount (ml)
          <input className="input mt-1" type="number" min={1} max={5000} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="text-xs text-slate-500">
          When
          <input className="input mt-1" type="datetime-local" required value={when} max={toLocalInput(Date.now() + 60_000)} onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>
      <input className="input" placeholder="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn-primary" type="submit" disabled={busy}>
          Add entry
        </button>
        {onDone && (
          <button className="btn-ghost" type="button" onClick={onDone}>
            Cancel
          </button>
        )}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </form>
  );
}

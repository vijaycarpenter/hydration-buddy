import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReminderAction, Snapshot } from '../../shared/types';
import { SERVING_PRESETS } from '../../shared/settings';
import { api } from '../lib/api';
import { ml, newRequestId } from '../lib/format';
import { drankMessage, idleMessage } from '../lib/messages';
import { playSuccess } from '../lib/sound';
import { ProgressRing } from '../components/ProgressRing';
import { WeeklyChart } from '../components/WeeklyChart';
import { Drip, type DripMood } from '../components/Drip';
import { DASHBOARD_SPRITE_HEIGHT } from '../../shared/companion';
import { SpeechBubble } from '../components/SpeechBubble';
import { ReminderCard } from './ReminderStatus';
import { AddEntryForm, Timeline } from './EntryList';
import { useDarkMode } from '../lib/useDarkMode';

// three.js is the heaviest dependency; load it after the rest of the dashboard.
const Body3D = lazy(() => import('../components/Body3D').then((m) => ({ default: m.Body3D })));

export function TodayView({ snapshot }: { snapshot: Snapshot }) {
  const { today, settings, scheduler } = snapshot;
  const dark = useDarkMode();
  const [drinkKey, setDrinkKey] = useState(0);
  const [mood, setMood] = useState<DripMood>('stand');
  const [bubble, setBubble] = useState(idleMessage(today.percent));
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [showForm, setShowForm] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const percentRef = useRef(today.percent);
  percentRef.current = today.percent;

  // React to drinks recorded anywhere (popup, tray, this page).
  useEffect(() => {
    const off = api.onDrinkRecorded((amount) => {
      setDrinkKey((k) => k + 1);
      timers.current.forEach(clearTimeout);
      setMood('happy');
      setBubble(`+${amount} ml. Gulp! 💧`);
      timers.current = [
        setTimeout(() => {
          // the snapshot refresh lands within ~100 ms, so the percent is current by now
          setBubble(drankMessage(percentRef.current));
        }, 1200),
        setTimeout(() => {
          setMood('stand');
          setBubble(idleMessage(percentRef.current));
        }, 4200),
      ];
    });
    return () => {
      off();
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (scheduler.active) {
      setMood('walk');
      setBubble("Psst! It's time for some water!");
    } else if (mood === 'walk') {
      setMood('stand');
      setBubble(idleMessage(today.percent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduler.active?.id]);

  const drink = async (amountMl: number) => {
    if (busy) return;
    setBusy(true);
    const res = await api.addEntry({ amountMl, source: 'quick', requestId: newRequestId() });
    setBusy(false);
    if (res.ok && settings.soundEnabled) playSuccess(settings.soundVolume);
    if (!res.ok) setBubble(res.error ?? 'Hmm, that did not work.');
  };

  const answer = (action: ReminderAction) => scheduler.active && api.reminderAction(scheduler.active.id, action);

  const presets = Array.from(new Set([...SERVING_PRESETS, settings.servingMl])).sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <AnimatePresence>
        {scheduler.active && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap items-center gap-3 rounded-3xl bg-gradient-to-r from-sky-500 to-blue-600 px-6 py-4 text-white shadow-lg shadow-sky-500/30" role="alert">
              <span className="text-2xl" aria-hidden>
                🔔
              </span>
              <div className="mr-auto">
                <div className="font-bold">Time to drink some water!</div>
                <div className="text-sm text-sky-100">Reminder {scheduler.active.attempt > 1 ? `#${scheduler.active.attempt}` : ''} waiting for your answer.</div>
              </div>
              <button className="btn bg-white text-sky-700 hover:bg-sky-50" onClick={() => answer('drank')}>
                I Drank Water · Add {settings.servingMl} ml
              </button>
              <button className="btn bg-white/15 text-white hover:bg-white/25" onClick={() => answer('later')}>
                Remind Me Later
              </button>
              <button className="btn bg-white/15 text-white hover:bg-white/25" onClick={() => answer('skipped')}>
                Skip
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* 3D body */}
        <section className="card relative flex flex-col overflow-hidden lg:col-span-7" aria-label="Hydration body">
          <div className="absolute left-6 top-5 z-10">
            <h2 className="card-title">Hydration level</h2>
            <div className="mt-1 text-5xl font-extrabold tracking-tight text-sky-600 dark:text-sky-300">
              {Math.round(today.percent)}
              <span className="text-2xl">%</span>
            </div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {ml(today.totalMl)} of {ml(today.goalMl)}
            </div>
          </div>
          <div className="absolute right-6 top-5 z-10 text-right text-xs text-slate-400">Drag to rotate · scroll to zoom</div>
          <div className="min-h-[520px] flex-1">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">Loading 3D view…</div>}>
              <Body3D percent={today.percent} drinkKey={drinkKey} dark={dark} animated={settings.characterAnimations} />
            </Suspense>
          </div>
          <p className="text-center text-[11px] text-slate-400">
            The water level shows progress toward your daily goal. It is a visual guide, not a measurement of your body's hydration.
          </p>
        </section>

        <div className="space-y-6 lg:col-span-5">
          {/* progress + quick add */}
          <section className="card" aria-label="Today's progress">
            <div className="flex items-center gap-6">
              <ProgressRing percent={today.percent} size={170}>
                <div className="text-3xl font-extrabold">{ml(today.totalMl)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">of {ml(today.goalMl)}</div>
              </ProgressRing>
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Stat label="Remaining" value={today.remainingMl > 0 ? ml(today.remainingMl) : 'Done! 🎉'} />
                <Stat label="Glasses" value={String(today.glasses)} />
                <Stat label="Drank at reminder" value={String(today.counts.drank)} />
                <Stat label="Postponed" value={String(today.counts.later)} />
                <Stat label="Skipped" value={String(today.counts.skipped)} />
                <Stat label="Dismissed" value={String(today.counts.dismissed)} />
              </dl>
            </div>
            <div className="mt-5">
              <button className="btn-primary w-full py-3 text-base" onClick={() => drink(settings.servingMl)} disabled={busy}>
                <span aria-hidden>🥤</span> Drink Water · {settings.servingMl} ml
              </button>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {presets.map((p) => (
                  <button key={p} className="chip" onClick={() => drink(p)} disabled={busy}>
                    +{p} ml
                  </button>
                ))}
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = Number(custom);
                    if (n > 0) drink(n).then(() => setCustom(''));
                  }}
                >
                  <input className="input w-20 py-1 text-xs" type="number" min={1} max={5000} placeholder="ml" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom amount in ml" />
                  <button className="chip" type="submit" disabled={busy || !custom}>
                    Add
                  </button>
                </form>
              </div>
            </div>
          </section>

          <ReminderCard snapshot={snapshot} />

          {settings.characterVisible && (
            <section className="card flex items-end gap-2 overflow-hidden" aria-label="Your companion">
              <Drip mood={mood} height={DASHBOARD_SPRITE_HEIGHT[settings.characterSize]} animated={settings.characterAnimations} />
              <SpeechBubble text={bubble} className="mb-16 flex-1" />
            </section>
          )}
        </div>

        <section className="card lg:col-span-7" aria-label="Weekly history">
          <h2 className="card-title mb-3">This week</h2>
          <WeeklyChart days={snapshot.week} goalMl={settings.dailyGoalMl} />
        </section>

        <section className="card lg:col-span-5" aria-label="Today's activity">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="card-title">Today's activity</h2>
            <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Close' : '+ Add entry'}
            </button>
          </div>
          {showForm && (
            <div className="mb-3">
              <AddEntryForm defaultAmount={settings.servingMl} onDone={() => setShowForm(false)} />
            </div>
          )}
          <div className="max-h-80 overflow-y-auto pr-1">
            <Timeline entries={today.entries} reminders={today.reminders} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-lg font-bold">{value}</dd>
    </div>
  );
}

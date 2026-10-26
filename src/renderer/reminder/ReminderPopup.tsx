// The reminder companion: a transparent window the main process walks along the bottom
// of the screen. Only the boy, his speech bubble and two buttons are shown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ActiveReminder, ReminderAction } from '../../shared/types';
import { api } from '../lib/api';
import { useSnapshot } from '../lib/useSnapshot';
import { Drip, type DripMood } from '../components/Drip';
import { edgeDistance, edgeMs, POPUP_SPRITE_HEIGHT } from '../../shared/companion';
import { drankMessage, laterMessage, reminderMessage } from '../lib/messages';
import { playReminderChime, playSuccess } from '../lib/sound';

type Phase = 'walking' | 'ask' | 'busy' | 'leaving';

export function ReminderPopup() {
  const { snapshot } = useSnapshot();
  const [reminder, setReminder] = useState<ActiveReminder | null>(null);
  const [phase, setPhase] = useState<Phase>('walking');
  const [mood, setMood] = useState<DripMood>('walk');
  const [message, setMessage] = useState('');
  const [enterKey, setEnterKey] = useState(0);
  const [offstage, setOffstage] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;

  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const present = useCallback((r: ActiveReminder, walkIn = true) => {
    const s = snapRef.current;
    clearTimers();
    setReminder(r);
    setPhase('walking');
    setOffstage(false);
    if (walkIn) {
      setEnterKey((k) => k + 1); // replays the step in across the screen edge
      setMood('walk');
    }
    setMessage(reminderMessage({ attempt: r.attempt, percent: s?.today.percent ?? 0, hour: new Date().getHours() }));
    if (s?.settings.soundEnabled) playReminderChime(s.settings.soundVolume);
  }, []);

  // Main walks the window in, then tells us he has arrived.
  const arrived = useCallback(() => {
    clearTimers();
    setPhase((p) => (p === 'walking' ? 'ask' : p));
    setMood('stand');
  }, []);

  useEffect(() => api.onReminderShown(present), [present]);
  useEffect(() => api.onReminderArrived(arrived), [arrived]);
  useEffect(() => api.onReminderExit(() => setOffstage(true)), []);

  const leave = useCallback(() => {
    clearTimers();
    setPhase('leaving');
    setMood('walk');
    api.closeReminderWindow();
  }, []);

  // Sync with main: first load, or the reminder was answered elsewhere (dashboard, tray, pause).
  useEffect(() => {
    if (!snapshot) return;
    const active = snapshot.scheduler.active;
    if (active && !reminder) {
      present(active);
      return;
    }
    // A snapshot taken before this reminder fired is stale (the shown event can beat the state refresh).
    const fresh = reminder && snapshot.now >= reminder.firedAt;
    if (reminder && fresh && (phase === 'walking' || phase === 'ask') && active?.id !== reminder.id) {
      if (active) present(active);
      else leave();
    }
  }, [snapshot, reminder, phase, present, leave]);

  const act = async (action: ReminderAction) => {
    if (!reminder || !snapshot || phase !== 'ask') return;
    setPhase('busy');
    clearTimers();
    const s = snapshot.settings;
    const res = await api.reminderAction(reminder.id, action);
    if (!res.ok) {
      setPhase('ask');
      setMessage(res.error ?? 'Something went wrong.');
      return;
    }
    if (action === 'drank') {
      const after = ((snapshot.today.totalMl + s.servingMl) / snapshot.today.goalMl) * 100;
      setMessage('Gulp, gulp… 💧');
      later(() => {
        setMood('happy');
        setMessage(drankMessage(after));
        if (s.soundEnabled) playSuccess(s.soundVolume);
      }, 1300);
      later(leave, 3400);
    } else if (action === 'later') {
      setMessage(laterMessage(s.retryMin));
      later(leave, 1800);
    } else {
      leave();
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && act('dismissed');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!snapshot || !reminder) return null;
  const s = snapshot.settings;
  const showBubble = phase === 'ask' || phase === 'busy';
  const height = POPUP_SPRITE_HEIGHT[s.characterSize];
  // Crossing the screen edge happens inside the window, at the same pace the window walks.
  const edge = edgeDistance(s.characterSize);

  return (
    <div className="flex h-full select-none flex-col items-center justify-end">
      <AnimatePresence>
        {showBubble && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="relative mb-1 w-[326px] rounded-3xl border border-sky-100 bg-white px-4 pb-3.5 pt-3 shadow-[0_10px_30px_-10px_rgba(2,132,199,0.45)] dark:border-slate-600 dark:bg-slate-800"
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={message}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mb-2.5 text-center text-[15px] font-semibold leading-snug text-slate-700 dark:text-slate-100"
                aria-live="polite"
              >
                {message}
              </motion.p>
            </AnimatePresence>
            {phase === 'ask' && (
              <div className="flex gap-2">
                <button className="btn-primary flex-1 whitespace-nowrap px-2 py-2.5" onClick={() => act('drank')}>
                  💧 I Drank Water
                </button>
                <button className="btn-secondary flex-1 whitespace-nowrap px-2 py-2.5" onClick={() => act('later')}>
                  ⏰ Remind Me Later
                </button>
              </div>
            )}
            <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-sky-100 bg-white dark:border-slate-600 dark:bg-slate-800" />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        key={enterKey}
        initial={s.characterAnimations ? { x: -edge } : false}
        animate={{ x: offstage ? edge : 0 }}
        transition={{ duration: s.characterAnimations ? edgeMs(s.characterSize) / 1000 : 0, ease: 'linear' }}
      >
        {s.characterVisible ? (
          <Drip mood={mood} height={height} animated={s.characterAnimations} />
        ) : (
          <div className="h-4" />
        )}
      </motion.div>
    </div>
  );
}

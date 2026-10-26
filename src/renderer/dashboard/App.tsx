import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSnapshot } from '../lib/useSnapshot';
import { TodayView } from './TodayView';
import { HistoryView } from './HistoryView';
import { SettingsView } from './SettingsView';
import { StatusPill } from './ReminderStatus';

type Tab = 'today' | 'history' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const { snapshot, refresh } = useSnapshot();
  const [tab, setTab] = useState<Tab>('today');

  if (!snapshot) {
    return <div className="flex h-full items-center justify-center text-sky-600">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:from-[#0b1220] dark:via-[#0d1830] dark:to-[#0b1220]">
      <header className="flex items-center gap-6 border-b border-sky-100/80 px-8 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-xl shadow-md shadow-sky-500/30" aria-hidden>
            💧
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Hydration Buddy</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {new Date(snapshot.now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
        <nav className="flex gap-1 rounded-2xl bg-sky-100/70 p-1 dark:bg-slate-800/70" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
                tab === t.id ? 'text-sky-800 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {tab === t.id && (
                <motion.span layoutId="tab-bg" className="absolute inset-0 rounded-xl bg-white shadow-sm dark:bg-slate-700" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto">
          <StatusPill snapshot={snapshot} />
        </div>
      </header>

      {(snapshot.storageError || snapshot.shortcutError) && (
        <div className="mx-8 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200" role="alert">
          ⚠️ {snapshot.storageError ?? `Keyboard shortcut: ${snapshot.shortcutError}`}
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {tab === 'today' && <TodayView snapshot={snapshot} />}
            {tab === 'history' && <HistoryView snapshot={snapshot} />}
            {tab === 'settings' && <SettingsView snapshot={snapshot} onSaved={refresh} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

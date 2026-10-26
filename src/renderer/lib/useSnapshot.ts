import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '../../shared/types';
import { api } from './api';

/** Live view of the main-process state; refreshes whenever main broadcasts a change. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refresh = useCallback(() => {
    api.getSnapshot().then(setSnapshot).catch(console.error);
  }, []);
  useEffect(() => {
    refresh();
    const off = api.onStateChanged(refresh);
    // Also refresh when the window becomes visible again (e.g. restored from the tray after midnight).
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);
  return { snapshot, refresh };
}

/** Current time, ticking every `ms` while the page is visible. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

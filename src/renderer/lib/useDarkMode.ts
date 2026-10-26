import { useEffect, useState } from 'react';

/** Follows the OS / app theme (main sets nativeTheme.themeSource, which drives prefers-color-scheme). */
export function useDarkMode() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

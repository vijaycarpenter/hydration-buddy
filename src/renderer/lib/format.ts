export const ml = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 2).replace(/0$/, '')} L` : `${n} ml`);

export const time = (t: number | string) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const dayLabel = (dateKey: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short' }) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], opts);
};

/** "in 12 min", "in 1 h 05 min", "in 42 s" */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s} s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(t: number | string): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const newRequestId = () => crypto.randomUUID();

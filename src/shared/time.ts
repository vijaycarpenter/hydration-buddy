// Local-time helpers. All arithmetic on calendar days goes through Date's local
// setters so DST transitions are handled by the platform.

export function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addLocalDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** YYYY-MM-DD in local time. */
export function localDateKey(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function atLocalMinutes(dayStart: number, minutes: number): number {
  const d = new Date(dayStart);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/** Active window check. Supports windows that cross midnight (e.g. 22:00–06:00); start === end means always active. */
export function isWithinActiveHours(t: number, start: string, end: string): boolean {
  const s = parseHM(start);
  const e = parseHM(end);
  if (s === e) return true;
  const m = minutesOfDay(t);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The earliest moment >= t that falls inside the active window. */
export function nextActiveMoment(t: number, start: string, end: string): number {
  if (isWithinActiveHours(t, start, end)) return t;
  let candidate = atLocalMinutes(startOfLocalDay(t), parseHM(start));
  if (candidate <= t) candidate = atLocalMinutes(addLocalDays(startOfLocalDay(t), 1), parseHM(start));
  return candidate;
}

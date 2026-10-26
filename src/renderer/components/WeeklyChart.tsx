import { useState } from 'react';
import type { DayTotal } from '../../shared/types';
import { dayLabel, ml } from '../lib/format';

const W = 560;
const H = 220;
const PAD = { top: 18, right: 12, bottom: 28, left: 44 };

/** Last 7 days of intake as bars with a dashed goal line. One series, one hue. */
export function WeeklyChart({ days, goalMl }: { days: DayTotal[]; goalMl: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(goalMl * 1.15, ...days.map((d) => d.totalMl)) || 1;
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / days.length;
  const barW = Math.min(36, slot * 0.56);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Water intake over the last 7 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-slate-700/70" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
              {t >= 1000 ? `${t / 1000}L` : t}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.left + slot * i + (slot - barW) / 2;
          const h = Math.max(PAD.top + innerH - y(d.totalMl), 0);
          const isToday = i === days.length - 1;
          return (
            <g key={d.dateKey} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target larger than the mark */}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {h > 0 && (
                <path
                  d={roundedTop(x, PAD.top + innerH - h, barW, h, Math.min(4, h))}
                  className={hover === null || hover === i ? 'fill-sky-500 dark:fill-sky-400' : 'fill-sky-500/40 dark:fill-sky-400/40'}
                />
              )}
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className={`text-[11px] ${isToday ? 'fill-slate-700 font-bold dark:fill-slate-200' : 'fill-slate-400'}`}>
                {isToday ? 'Today' : dayLabel(d.dateKey)}
              </text>
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(goalMl)} y2={y(goalMl)} className="stroke-slate-500 dark:stroke-slate-400" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - PAD.right} y={y(goalMl) - 6} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold dark:fill-slate-400">
          Goal {ml(goalMl)}
        </text>
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
          style={{ left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`, top: 0 }}
        >
          <div className="font-semibold">{dayLabel(days[hover].dateKey, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <div>
            {ml(days[hover].totalMl)} · {Math.round((days[hover].totalMl / goalMl) * 100)}% of goal · {days[hover].count} drinks
          </div>
        </div>
      )}
      <table className="sr-only">
        <caption>Daily intake, last 7 days</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.dateKey}>
              <th>{d.dateKey}</th>
              <td>{d.totalMl} ml</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// Geometry of the walking companion, shared by the main process (which moves the window)
// and the reminder page (which animates him across the screen edges), so his feet stay in step.
import type { CharacterSize } from './types';

export const REMINDER_WINDOW = { width: 350, height: 480 };

/** Measured from the walk-cycle sprite (scripts/sprite/gait.py). */
export const SPRITE = {
  width: 236,
  height: 442,
  /** height of the figure itself inside the frame */
  figureHeight: 423,
  /** ground distance covered per step, at sprite scale */
  stepPx: 125,
  /** seconds per step */
  stepS: 0.65,
};

/** Rendered sprite height in the reminder window, per character size. */
export const POPUP_SPRITE_HEIGHT: Record<CharacterSize, number> = { small: 260, medium: 320, large: 360 };

/** Rendered sprite height on the dashboard. */
export const DASHBOARD_SPRITE_HEIGHT: Record<CharacterSize, number> = { small: 170, medium: 210, large: 250 };

/** Pixels per second the window must move so the feet don't slide. */
export function walkSpeed(size: CharacterSize): number {
  const h = POPUP_SPRITE_HEIGHT[size];
  return (SPRITE.stepPx * (h / SPRITE.figureHeight)) / SPRITE.stepS;
}

/** How far he walks inside the window to cross the screen edge (window managers keep windows on-screen). */
export function edgeDistance(size: CharacterSize): number {
  const w = (SPRITE.width * POPUP_SPRITE_HEIGHT[size]) / SPRITE.height;
  return (REMINDER_WINDOW.width + w) / 2;
}

export function edgeMs(size: CharacterSize): number {
  return (edgeDistance(size) / walkSpeed(size)) * 1000;
}

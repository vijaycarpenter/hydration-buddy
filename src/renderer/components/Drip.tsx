// "Drip", the hydration companion, from a walk-cycle sprite (animated WebP with transparency)
// plus a smiling still for standing poses. Non-walking moods are light CSS motion on the still.
import walkUrl from '../assets/drip-walk.webp';
import standUrl from '../assets/drip-stand.webp';
import { SPRITE } from '../../shared/companion';
import './drip.css';

export type DripMood = 'walk' | 'stand' | 'happy';

interface Props {
  mood: DripMood;
  height: number;
  animated?: boolean;
  /** Mirror horizontally (the sprite walks toward the right). */
  facingLeft?: boolean;
  className?: string;
}

export function Drip({ mood, height, animated = true, facingLeft = false, className = '' }: Props) {
  const width = (SPRITE.width * height) / SPRITE.height;
  // Without animations he never walks; the still stands in for every mood.
  const src = mood === 'walk' && animated ? walkUrl : standUrl;
  return (
    <div
      className={`drip drip-${mood} ${animated ? '' : 'drip-still'} ${className}`}
      style={{ width, height }}
      role="img"
      aria-label={mood === 'walk' ? 'Drip walking with a water bottle' : 'Drip holding a water bottle'}
    >
      <div className="drip-shadow" />
      <img
        src={src}
        width={width}
        height={height}
        alt=""
        draggable={false}
        style={{ transform: facingLeft ? 'scaleX(-1)' : undefined }}
      />
      <div className="drip-sparkles" aria-hidden>
        <span>✦</span>
        <span>✦</span>
        <span>✧</span>
        <span>✦</span>
      </div>
    </div>
  );
}

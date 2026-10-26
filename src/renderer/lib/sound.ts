// Small synthesized sounds (no audio files): a water "bloop" chime and a success arpeggio.
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, volume: number, type: OscillatorType = 'sine', slideTo?: number) {
  if (!ctx) ctx = new AudioContext();
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playReminderChime(volume: number) {
  try {
    const v = volume * 0.35;
    tone(520, 0, 0.18, v, 'sine', 900);
    tone(780, 0.16, 0.22, v, 'sine', 1200);
    tone(1040, 0.34, 0.35, v * 0.8, 'triangle');
  } catch {
    /* audio unavailable */
  }
}

export function playSuccess(volume: number) {
  try {
    const v = volume * 0.3;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, v, 'triangle'));
  } catch {
    /* audio unavailable */
  }
}

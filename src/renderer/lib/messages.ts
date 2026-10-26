// Friendly, context-aware lines for the companion.
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function reminderMessage(opts: { attempt: number; percent: number; hour: number }): string {
  const { attempt, percent, hour } = opts;
  if (attempt >= 3) return pick([
    "Hey, it's me again! Just a few sips?",
    "I'll keep checking in until you grab a glass. 💧",
    'Your water misses you! Quick sip?',
  ]);
  if (attempt === 2) return pick([
    "Don't forget to drink water. I'll remind you again soon!",
    'Ready for that glass of water now?',
  ]);
  if (percent >= 100) return pick([
    "You've already hit your goal! An extra sip never hurts.",
    'Goal done for today. Want to keep the streak flowing?',
  ]);
  if (hour < 11) return pick([
    "Good morning! Let's start the day with a glass of water.",
    "Hey! It's time to drink some water!",
  ]);
  if (percent < 30 && hour >= 15) return pick([
    "We're a little behind today. Let's catch up with a glass!",
    "Let's complete your water goal today!",
  ]);
  return pick([
    "Hey! It's time to drink some water!",
    'Your body will thank you for staying hydrated.',
    "Let's complete your water goal today!",
    'Water break! Stretch, sip, smile. 😊',
  ]);
}

export function drankMessage(percentAfter: number): string {
  if (percentAfter >= 100) return 'Goal reached! 🎉 Amazing work today!';
  return pick(['Awesome! Keep it up!', "Great job! You've taken another step toward your goal.", 'Refreshing! 💦 Nice one.']);
}

export const laterMessage = (min: number) => `No problem! I'll be back in ${min} minute${min === 1 ? '' : 's'}.`;
export const skipMessage = (min: number) => `Okay, skipping this one. I'll check again in ${min} minute${min === 1 ? '' : 's'}.`;

export function idleMessage(percent: number): string {
  if (percent >= 100) return "You did it! Today's goal is complete. 🎉";
  if (percent >= 75) return 'Almost there! Just a little more.';
  if (percent >= 40) return "You're doing great. Keep sipping!";
  if (percent > 0) return 'Nice start! Every glass counts.';
  return "Hi! I'm Drip. Let's stay hydrated together!";
}

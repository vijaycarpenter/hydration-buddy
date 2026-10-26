import { AnimatePresence, motion } from 'framer-motion';

/** Speech bubble whose tail points down toward the character. Re-animates when the text changes. */
export function SpeechBubble({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`relative ${className}`} aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 8, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className="relative rounded-3xl border border-sky-100 bg-white px-5 py-3.5 text-[15px] font-medium leading-snug text-slate-700 shadow-soft dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {text}
          <span className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-sky-100 bg-white dark:border-slate-700 dark:bg-slate-800" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

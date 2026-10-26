// Bundles the Electron main process and preload script with esbuild.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['electron', 'sql.js'],
  logLevel: 'info',
};
const configs = [
  { ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.js', format: 'cjs' },
  // Sandboxed preloads must be a single CommonJS file that only requires 'electron'.
  { ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist-electron/preload.js', format: 'cjs' },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}

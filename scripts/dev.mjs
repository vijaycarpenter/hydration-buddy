// Dev runner: Vite dev server + esbuild watch for main/preload + Electron (restarted on main changes).
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;

const esb = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });

// VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
function electronEnv() {
  const env = { ...process.env, VITE_DEV_SERVER_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

let child = null;
let restartTimer = null;
function startElectron() {
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: electronEnv(),
  });
  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') shutdown(code ?? 0);
  });
}
function restart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (child) {
      child.removeAllListeners('exit');
      child.on('exit', startElectron);
      child.kill('SIGTERM');
    } else startElectron();
  }, 400);
}
function shutdown(code) {
  esb.kill();
  server.close();
  process.exit(code);
}

// Wait for the first esbuild output, then launch and watch for rebuilds.
setTimeout(() => {
  startElectron();
  watch('dist-electron', (_e, f) => f && f.endsWith('.js') && restart());
}, 1500);
process.on('SIGINT', () => shutdown(0));

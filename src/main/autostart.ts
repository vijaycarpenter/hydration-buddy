// Start-at-login.
// - Linux: a freedesktop autostart entry in ~/.config/autostart (Electron's
//   app.setLoginItemSettings is a no-op on Linux).
// - Windows / macOS: Electron's login items (the HKCU Run key on Windows).
// Either way the app is launched with --hidden so it starts quietly in the tray.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'hydration-buddy.desktop');

/** Quotes one argument for a .desktop Exec line (freedesktop Desktop Entry spec, "Exec key"). */
function quoteArg(arg: string): string {
  if (!/[\s"'`$\\<>~|&;*?#()]/.test(arg)) return arg;
  return `"${arg.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** Executable + leading arguments that relaunch this copy of the app. */
function launchCommand(): string[] {
  // AppImage: the mounted path changes every run, APPIMAGE points at the real file.
  if (process.env.APPIMAGE) return [process.env.APPIMAGE];
  // Windows portable build: it unpacks to a temp folder; this points at the real .exe.
  if (process.env.PORTABLE_EXECUTABLE_FILE) return [process.env.PORTABLE_EXECUTABLE_FILE];
  if (app.isPackaged) return [process.execPath];
  return [process.execPath, app.getAppPath()];
}

export function setAutostart(enabled: boolean): string | null {
  try {
    if (process.platform === 'linux') setLinuxAutostart(enabled);
    else {
      const [exe, ...args] = launchCommand();
      app.setLoginItemSettings({ openAtLogin: enabled, path: exe, args: [...args, '--hidden'] });
    }
    return null;
  } catch (err) {
    return `Could not update start-at-login: ${(err as Error).message}`;
  }
}

function setLinuxAutostart(enabled: boolean) {
  if (!enabled) {
    fs.rmSync(FILE, { force: true });
    return;
  }
  const exec = [...launchCommand(), '--hidden'].map(quoteArg).join(' ');
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Hydration Buddy',
    'Comment=Friendly reminders to drink water',
    `Exec=${exec}`,
    'Icon=hydration-buddy',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'X-GNOME-Autostart-Delay=10',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, entry, { mode: 0o644 });
}

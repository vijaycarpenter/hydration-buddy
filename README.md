# Hydration Buddy

A friendly desktop companion for Ubuntu and Windows that reminds you to drink water. When a reminder is due, **Drip**, a boy carrying a water bottle, walks along the bottom of your screen and asks whether you've had a drink, with just two buttons: **I Drank Water** and **Remind Me Later**. Your progress toward a daily goal fills a translucent 3D anatomical body with water.

Everything runs and is stored locally. No account is needed, no network access is used, and your data never leaves your computer.

> The water level in the 3D body shows progress toward the goal you set. It is a visual metaphor, not a measurement of your body's hydration. The 2,000 ml default is only a starting point, so set a goal that suits you or follow your clinician's advice.

## Install on Ubuntu

Installers are in `release/` after a build (see below).

**.deb (recommended):**

```bash
sudo apt install ./release/hydration-buddy_1.0.0_amd64.deb
```

Launch **Hydration Buddy** from the app grid, or run `hydration-buddy` in a terminal.

**AppImage (no install needed):**

```bash
sudo apt install libfuse2          # Ubuntu 22.04+ needs this for AppImages
chmod +x release/Hydration-Buddy-1.0.0-x86_64.AppImage
./release/Hydration-Buddy-1.0.0-x86_64.AppImage
```

Tested on Ubuntu 22.04 (GNOME, X11 session) on x86-64.

## Install on Windows (10 / 11, 64-bit)

Build the Windows package on a Windows PC (recommended) or on Linux (see *Build the installers*), then use one of:

| File | How to use |
|---|---|
| `Hydration-Buddy-Setup-1.0.0.exe` | Installer: double-click, choose a folder, and it adds Start-menu and desktop shortcuts. Uninstall from *Settings → Apps*. |
| `Hydration-Buddy-1.0.0-portable.exe` | Single file, no install: double-click to run. |
| `Hydration-Buddy-1.0.0-win-x64.zip` | Unzip anywhere and run `Hydration Buddy.exe`. This is what a Linux build without Wine produces. |

The app isn't code-signed, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. Signing needs a code-signing certificate; see electron-builder's `win.certificateFile` / Azure Trusted Signing docs.

On Windows the tray icon sits in the notification area (bottom-right; it may be hidden behind the **^** arrow, so drag it out to keep it visible). Data lives in `%APPDATA%\Hydration Buddy\hydration.sqlite`. Start at login uses the standard per-user *Run* entry, which you can also see under *Task Manager → Startup apps*.

## Using it

1. Open **Settings**, set your daily goal, serving size, reminder interval (30/45/60/90/120 min or custom) and active hours, then click **Save settings**.
2. Close the window. The app keeps running in the system tray (the 💧 icon in the top bar) and reminds you in the background.
3. When a reminder is due, Drip walks in along the bottom of the screen:
   - **I Drank Water** records one serving, celebrates, and puts reminders back on the normal interval.
   - **Remind Me Later** brings him back after the retry delay (10 min by default) and keeps doing so until you record a drink or pause reminders.
   - **Esc** dismisses the reminder (counted as dismissed; it will come back after the retry delay).
   - A reminder left unanswered for the retry delay counts as dismissed, and Drip asks again. Only one reminder is ever on screen.
4. The dashboard (**Ctrl+Alt+H**, or the tray menu) shows the 3D body, progress ring, quick-add buttons, a next-reminder countdown, the weekly chart, and today's timeline. From there you can also edit or delete entries, add back-dated ones, view history, and pause, resume or stop reminders. The dashboard's reminder banner also offers **Skip**, which is recorded separately from "Later".

### Tray menu

Today's total · next reminder time · Open dashboard · I drank *N* ml · Show a reminder now · Pause (30 min / 1 h / 2 h / until tomorrow / until I resume) or Resume · Stop reminders for this session · Quit.

### Start at login

Turn on **Settings → Desktop → Start Hydration Buddy when I log in**. This writes `~/.config/autostart/hydration-buddy.desktop`, which starts the app quietly in the tray (`--hidden`). Turning it off removes that file. If you move the AppImage, toggle the setting off and on again so the entry points at the new location.

## The companion sprite

Drip is a walk-cycle sprite: `src/renderer/assets/drip-walk.webp` (100 frames, 10 fps, transparent) and `drip-stand.webp` (one frame, facing you). They were cut out of a GIF supplied for this project whose "transparent" checkerboard was baked into the pixels. `scripts/sprite/` reproduces the cut-out (Python 3 with numpy and Pillow):

```bash
convert source.gif -coalesce frames/f_%03d.png      # ImageMagick
python3 scripts/sprite/plate_probe.py frames stack.npy   # loads frames, reports the checker's repeat period
python3 scripts/sprite/cutout.py stack.npy cut           # difference matte against a rebuilt checker plate
python3 scripts/sprite/pack.py assets                    # crop + export animated WebP and the still
python3 scripts/sprite/gait.py                           # step timing → SPRITE in src/shared/companion.ts
```

The window moves at the speed his feet travel (`walkSpeed()` in `src/shared/companion.ts`), so he doesn't slide. If you replace the sprite, re-measure the gait and update `SPRITE`.

> **Licensing:** the source GIF looks like stock or AI-generated art and carries faint watermark strokes. Fine for your own machine, but confirm you have the rights before distributing the app, or swap in a sprite you own.

## Development

Requirements: Node.js 20+ (tested with 22) and npm.

```bash
npm install
npm run dev          # Vite dev server + Electron with live reload
npm test             # scheduler, storage and settings tests (Vitest)
npm run typecheck
npm start            # production build, then run it
```

> **Running from the VS Code terminal:** VS Code exports `ELECTRON_RUN_AS_NODE=1`, which makes `npx electron .` start as plain Node (`Cannot read properties of undefined (reading 'setPath')`). `npm run dev` clears it for you; for anything else, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.

### Fast reminders for testing

Two environment variables make reminder scenarios testable in seconds:

| Variable | Effect |
|---|---|
| `HB_MINUTE_MS=1000` | One reminder "minute" lasts 1 second, so a 60-minute interval fires after 60 s and a 10-minute retry after 10 s. Active hours still use the real clock. |
| `HB_USER_DATA=/tmp/hb-test` | Use a separate data folder so testing doesn't touch your real history. |

```bash
HB_MINUTE_MS=1000 HB_USER_DATA=/tmp/hb-test npm run dev        # Linux / macOS
```

```powershell
$env:HB_MINUTE_MS=1000; $env:HB_USER_DATA="$env:TEMP\hb-test"; npm run dev   # Windows PowerShell
```

Settings → **Show a reminder now** (or the tray item) triggers a reminder immediately.

### Build the installers

**Linux** (on Linux):

```bash
npm run dist          # AppImage + .deb into release/  (same as dist:linux)
npm run dist:deb      # just the .deb
npm run dist:appimage # just the AppImage
```

**Windows**: on a Windows PC, in PowerShell or cmd, from a copy of this folder (leave out `node_modules`):

```bat
npm install
npm run dist:win      &REM installer (.exe) + portable .exe into release\
```

**Windows, from Linux:** the installer and portable `.exe` need [Wine](https://electron.build/multi-platform-build#linux) on Linux (`sudo apt install wine64`, then `npm run dist:win`). Without Wine you can still produce a runnable zip:

```bash
npm run dist:win:zip  # release/Hydration-Buddy-1.0.0-win-x64.zip (exe keeps the default Electron icon)
```

`npm run icons` regenerates the PNG icons and `resources/icon.ico` from `resources/*.svg` (needs ImageMagick).

The first build downloads Electron and packaging tools from GitHub. After installation the app works fully offline.

## Project layout

```
src/
  shared/      types, settings defaults + validation, local-time helpers
  main/        Electron main process
    main.ts        windows, walking reminder window, tray, notifications, shortcut, IPC
    scheduler.ts   reminder state machine (single timer, persisted state)
    store.ts       SQLite (sql.js/WASM) storage, transactions, export
    autostart.ts   ~/.config/autostart entry
  preload/     the only renderer↔main bridge (contextIsolation, sandboxed)
  renderer/
    dashboard/   Today, History, Settings views
    reminder/    the walking companion popup
    components/  Drip (sprite companion), Body3D + anatomy (three.js), charts, rings
    assets/      drip-walk.webp, drip-stand.webp
    lib/         API hook, sounds (Web Audio, no files), messages, formatting
tests/         Vitest suites (fake timers, real in-memory SQLite)
resources/     icons (SVG sources + generated PNGs)
```

### Data

Stored in `~/.config/Hydration Buddy/hydration.sqlite` on Linux (mode 0600) or `%APPDATA%\Hydration Buddy\hydration.sqlite` on Windows, written atomically after every change:

- **settings**: goal, serving, interval, retry delay, active hours, notification, sound, character and theme preferences.
- **intake_entries**: id, amount (ml), UTC timestamp, source (`reminder` / `manual` / `quick`), optional note.
- **reminder_history**: id, when it fired, action (`drank` / `later` / `skipped` / `dismissed`, with detail `closed` / `timeout` / `paused`), when answered, next scheduled reminder, linked water entry.
- **meta**: the scheduler's pending state, so an open reminder survives a restart.

Timestamps are stored in UTC and shown in local time. Daily totals follow your local calendar day. **Settings → Your data** exports JSON or CSV and saves a copy of the database. If the database file is ever unreadable, it is set aside as `hydration.sqlite.corrupt-<time>` and a fresh one is created, and the app tells you so.

## How reminders are scheduled

- The scheduler runs in the main process, not in a React component, so it keeps working with every window closed. It owns exactly one timer and at most one active reminder. Answers for any other reminder id are ignored, so double clicks and repeated "Later" or "Skip" can't stack timers or windows (covered by tests).
- Normal mode reminds every *interval* minutes within active hours. After "Later" or "Skip" (or no answer), retry mode reminds every *retry* minutes. Recording a drink from anywhere (popup, dashboard, tray) returns to normal mode.
- Outside active hours, the next reminder waits for the window to open. Windows that cross midnight (e.g. 22:00–06:00) are supported.
- The scheduler checks the wall clock at least every 30 s, and immediately on resume from suspend and on screen unlock.

## Limitations

- **Sleep / shutdown:** no reminders fire while the computer is asleep or the app isn't running. After waking, overdue reminders produce one reminder, not a backlog (if within active hours). Quitting the app stops reminders until it is started again; use start-at-login to keep it running.
- **Do Not Disturb:** GNOME hides desktop notifications while Do Not Disturb is on. The walking companion window still appears.
- **Tray:** Ubuntu's default "AppIndicator" extension shows the tray icon. On desktops without tray support, closing the dashboard quits the app instead of hiding it, since there would be no way back.
- **Wayland sessions:** Electron 33 runs through XWayland. Global shortcuts may not fire in native Wayland apps, and "always on top" depends on the compositor. The default Ubuntu X11 session supports everything.
- **Windows:** built and packaged, but not yet run on a real Windows machine; please report anything odd. Focus Assist / Do Not Disturb hides toast notifications (the walking companion still appears). The default Ctrl+Alt+H shortcut can clash with AltGr layouts; change it in Settings if needed.
- **Screen edges:** window managers keep windows on screen, so the companion steps across the screen edge inside his own transparent window. This needs a compositing desktop (GNOME always composites); on a non-compositing window manager the window would show a solid backdrop.
- **Multiple monitors:** the companion walks along the primary display only.
- **Companion poses:** the sprite only contains walking. Asking, "drinking" and celebrating use the standing frame with a hop and sparkles; there is no drinking animation.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot read properties of undefined (reading 'setPath')` | `ELECTRON_RUN_AS_NODE` is set (VS Code terminal). Run `env -u ELECTRON_RUN_AS_NODE …` or use `npm run dev`. |
| AppImage won't start (`dlopen(): error loading libfuse.so.2`) | `sudo apt install libfuse2` |
| No tray icon | Enable the "Ubuntu AppIndicators" extension (Extensions app), then restart Hydration Buddy. |
| No desktop notifications | Check Settings → Notifications in Ubuntu, and turn off Do Not Disturb. The walking companion still appears. |
| Shortcut warning in the dashboard | Another app owns that key combo. Pick a different one in Settings → Desktop. |
| The app seems "gone" after closing the window | It's in the tray. Use the tray icon or Ctrl+Alt+H, or launch it again (a second launch just reopens the dashboard). |
| Start-at-login doesn't work | Check `~/.config/autostart/hydration-buddy.desktop` exists, and toggle the setting off and on to refresh its path. |
| Reset everything | Quit the app and delete `~/.config/Hydration Buddy/` (Windows: `%APPDATA%\Hydration Buddy`). |
| Windows: "Windows protected your PC" | The app isn't code-signed. Click **More info → Run anyway**. |
| Windows: no tray icon visible | Click the **^** arrow in the taskbar's notification area and drag the 💧 icon onto the taskbar. |
| Windows: no notifications | Turn off Focus Assist / Do Not Disturb, and allow notifications for Hydration Buddy in *Settings → System → Notifications*. |

## Tech

Electron 33 · React 18 + TypeScript · Tailwind CSS 3 · Framer Motion · three.js + React Three Fiber · sql.js (SQLite in WASM, no native modules) · Vite · esbuild · electron-builder · Vitest.

Security: `contextIsolation`, sandboxed renderers, no Node in renderers, a strict CSP, a deny-all permission handler, blocked navigation and new windows, IPC accepted only from the app's own windows and validated in the main process, and no shell commands.

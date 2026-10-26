// Regenerates PNG icons from the SVG sources (needs ImageMagick's `convert`; only run when the SVGs change).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('resources/icons', { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  execFileSync('convert', ['-background', 'none', '-density', '384', 'resources/icon.svg', '-resize', `${size}x${size}`, `resources/icons/${size}x${size}.png`]);
}
execFileSync('convert', ['-background', 'none', '-density', '384', 'resources/tray.svg', '-resize', '22x22', 'resources/tray.png']);
execFileSync('convert', ['-background', 'none', '-density', '384', 'resources/tray.svg', '-resize', '44x44', 'resources/tray@2x.png']);
// Windows: multi-resolution .ico for the .exe, installer and shortcuts
execFileSync('convert', [16, 24, 32, 48, 64, 128, 256].map((n) => `resources/icons/${n}x${n}.png`).concat('resources/icon.ico'));
console.log('icons written');

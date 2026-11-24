// Electron (electron/main.cjs) calls the game page's window.__* functions by name inside executeJavaScript strings, so
// a rename in web/src breaks them silently (shortcuts in browsers, closing the window, the panic key).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter(f => f.isFile() && /\.tsx?$/.test(f.name) && !/\.test\.tsx?$/.test(f.name))
  .map(f => readFileSync(path.join(f.parentPath, f.name), 'utf8'));

describe('window globals Electron calls in the game page', () => {
  it('every window.__name main.cjs runs in the main window is defined in web/src', () => {
    const main = readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
    const calls = [...main.matchAll(/(?:mainWindow|v)\.webContents\.executeJavaScript\(([^\n]*)/g)]
      .flatMap(m => [...m[1].matchAll(/window\.(__\w+)/g)].map(n => n[1]));
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const web = sources(path.join(root, 'web/src')).join('\n');
    expect(new Set(calls.filter(n => !web.includes(`(window as any).${n} =`)))).toEqual(new Set());
  });
});

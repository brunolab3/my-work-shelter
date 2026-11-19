import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const fingerprints = createRequire(import.meta.url)('../scripts/fingerprints.cjs') as { fingerprint(g: string, root?: string): string; clientUpToDate(root?: string): boolean };

function shelter() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'huellas-'));
  for (const d of ['web/src', 'shared', 'server', 'electron/icon', 'dist/web']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'web/src/a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'shared/b.ts'), 'export const b = 2;\n');
  writeFileSync(path.join(root, 'electron/main.cjs'), '// app\n');
  writeFileSync(path.join(root, 'dist/web/index.html'), '<!doctype html>\n');
  return root;
}

describe('huellas del código', () => {
  it('dependen del contenido, no de las fechas', () => {
    const root = shelter();
    const h = fingerprints.fingerprint('cliente', root);
    utimesSync(path.join(root, 'web/src/a.ts'), new Date(2000, 0, 1), new Date(2000, 0, 1));
    expect(fingerprints.fingerprint('cliente', root)).toBe(h);
    writeFileSync(path.join(root, 'web/src/a.ts'), 'export const a = 3;\n');
    expect(fingerprints.fingerprint('cliente', root)).not.toBe(h);
  });
  it('el cliente está al día solo si su huella coincide con la de la última compilación', () => {
    const root = shelter();
    expect(fingerprints.clientUpToDate(root)).toBe(false);
    writeFileSync(path.join(root, 'dist/.huella-cliente'), fingerprints.fingerprint('cliente', root) + '\n');
    expect(fingerprints.clientUpToDate(root)).toBe(true);
    // un cambio en shared/ también es del cliente (y del servidor)
    const server = fingerprints.fingerprint('servidor', root);
    writeFileSync(path.join(root, 'shared/b.ts'), 'export const b = 4;\n');
    expect(fingerprints.clientUpToDate(root)).toBe(false);
    expect(fingerprints.fingerprint('servidor', root)).not.toBe(server);
  });
  it('la de la app cambia con electron/ pero no con su icono', () => {
    const root = shelter();
    const h = fingerprints.fingerprint('app', root);
    writeFileSync(path.join(root, 'electron/icon/icon.png'), 'png');
    expect(fingerprints.fingerprint('app', root)).toBe(h);
    writeFileSync(path.join(root, 'electron/musicControl.js'), '// mando\n');
    expect(fingerprints.fingerprint('app', root)).not.toBe(h);
  });
  // servers and apps started before the rename still run or require scripts/huellas.cjs
  it('the legacy huellas.cjs shim behaves like fingerprints.cjs', () => {
    const require = createRequire(import.meta.url);
    expect(require('../scripts/huellas.cjs')).toBe(require('../scripts/fingerprints.cjs'));
    const run = (script: string) => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', script), 'app'], { encoding: 'utf8' });
    expect(run('huellas.cjs')).toMatch(/^[0-9a-f]{40}\n$/);
    expect(run('huellas.cjs')).toBe(run('fingerprints.cjs'));
  });
});

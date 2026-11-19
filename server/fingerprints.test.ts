import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const huellas = createRequire(import.meta.url)('../scripts/fingerprints.cjs') as { huella(g: string, raiz?: string): string; clienteAlDia(raiz?: string): boolean };

function refugio() {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'huellas-'));
  for (const d of ['web/src', 'shared', 'server', 'electron/icon', 'dist/web']) mkdirSync(path.join(raiz, d), { recursive: true });
  writeFileSync(path.join(raiz, 'web/src/a.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(raiz, 'shared/b.ts'), 'export const b = 2;\n');
  writeFileSync(path.join(raiz, 'electron/main.cjs'), '// app\n');
  writeFileSync(path.join(raiz, 'dist/web/index.html'), '<!doctype html>\n');
  return raiz;
}

describe('huellas del código', () => {
  it('dependen del contenido, no de las fechas', () => {
    const raiz = refugio();
    const h = huellas.huella('cliente', raiz);
    utimesSync(path.join(raiz, 'web/src/a.ts'), new Date(2000, 0, 1), new Date(2000, 0, 1));
    expect(huellas.huella('cliente', raiz)).toBe(h);
    writeFileSync(path.join(raiz, 'web/src/a.ts'), 'export const a = 3;\n');
    expect(huellas.huella('cliente', raiz)).not.toBe(h);
  });
  it('el cliente está al día solo si su huella coincide con la de la última compilación', () => {
    const raiz = refugio();
    expect(huellas.clienteAlDia(raiz)).toBe(false);
    writeFileSync(path.join(raiz, 'dist/.huella-cliente'), huellas.huella('cliente', raiz) + '\n');
    expect(huellas.clienteAlDia(raiz)).toBe(true);
    // un cambio en shared/ también es del cliente (y del servidor)
    const servidor = huellas.huella('servidor', raiz);
    writeFileSync(path.join(raiz, 'shared/b.ts'), 'export const b = 4;\n');
    expect(huellas.clienteAlDia(raiz)).toBe(false);
    expect(huellas.huella('servidor', raiz)).not.toBe(servidor);
  });
  it('la de la app cambia con electron/ pero no con su icono', () => {
    const raiz = refugio();
    const h = huellas.huella('app', raiz);
    writeFileSync(path.join(raiz, 'electron/icon/icon.png'), 'png');
    expect(huellas.huella('app', raiz)).toBe(h);
    writeFileSync(path.join(raiz, 'electron/musicControl.js'), '// mando\n');
    expect(huellas.huella('app', raiz)).not.toBe(h);
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

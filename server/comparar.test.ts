// La página de comparación para revisar cambios con notas (comparar.ts): con un repo de verdad
import { describe, expect, it } from 'vitest';
import { buildCompare, parseDiff, COMPARES_FOLDER } from './comparar.ts';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';


function repo() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'comparar-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com' } });
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = 2;\n'); g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'tarea');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = "<script>3</script>";\n'); writeFileSync(path.join(d, 'nuevo.md'), '# hola\n'); g('add', '.'); g('commit', '-qm', 'cambio');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = "<script>3</script>";\nconst c = 4;\n');   // sin commit
  writeFileSync(path.join(d, 'suelto.ts'), 'export const x = 1;\n');   // nuevo, aún sin seguir
  return d;
}

describe('comparación de cambios', () => {
  it('la rama sin subir frente a la principal, con lo que no está en un commit: archivos, cuentas y nada sin escapar', async () => {
    const r = await buildCompare(repo());
    expect([r.base, r.rama, r.archivos, r.mas, r.menos]).toEqual(['main', 'tarea', 3, 4, 1]);
    expect(readFileSync(r.archivo, 'utf8')).toContain('data-seccion="suelto.ts"');
    expect(path.dirname(r.archivo)).toBe(COMPARES_FOLDER);
    const html = readFileSync(r.archivo, 'utf8');
    expect(html).toContain('data-seccion="a.ts"');
    expect(html).toContain('data-seccion="a.ts:3"');          // cada línea dice de qué archivo y línea es
    expect(html).toContain('&lt;script&gt;3&lt;/script&gt;');
    expect(html).not.toContain('<script>3');
    expect(html).toContain('nuevo.md');
  });
  it('sin lo que no está en un commit, solo lo de la rama; y una base que no existe se dice', async () => {
    const d = repo();
    expect((await buildCompare(d, { sinCommit: false })).mas).toBe(2);
    await expect(buildCompare(d, { base: 'no-existe' })).rejects.toThrow(/no-existe/);
  });
  it('los números de línea de cada lado', () => {
    const [f] = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,2 +10,3 @@ f\n uno\n-dos\n+DOS\n+tres\n');
    expect(f.lineas.map(l => [l.tipo, l.viejo, l.nuevo])).toEqual([['@', undefined, undefined], [' ', 10, 10], ['-', 11, undefined], ['+', undefined, 11], ['+', undefined, 12]]);
  });
});

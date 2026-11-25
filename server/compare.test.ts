// La página de comparación para revisar cambios con notas (compare.ts): con un repo de verdad
import { describe, expect, it } from 'vitest';
import { buildCompare, cleanCompares, parseDiff, COMPARES_FOLDER, sameRepoWorktree, sidecarOf } from './compare.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';


function repo() {
  const d = mkdtempSync(path.join(os.tmpdir(), 'comparar-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.com' } });
  g('init', '-q', '-b', 'main');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = 2;\n'); g('add', '.'); g('commit', '-qm', 'base');
  g('checkout', '-qb', 'tarea');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = "<script>3</script>";\n'); writeFileSync(path.join(d, 'nuevo.md'), '# hola\n'); g('add', '.'); g('commit', '-qm', 'change');
  writeFileSync(path.join(d, 'a.ts'), 'const a = 1;\nconst b = "<script>3</script>";\nconst c = 4;\n');   // sin commit
  writeFileSync(path.join(d, 'suelto.ts'), 'export const x = 1;\n');   // nuevo, aún sin seguir
  return d;
}

describe('comparación de cambios', () => {
  it('la rama sin subir frente a la principal, con lo que no está en un commit: archivos, cuentas y nada sin escapar', async () => {
    const r = await buildCompare(repo());
    expect([r.base, r.branch, r.files, r.more, r.deletions]).toEqual(['main', 'tarea', 3, 4, 1]);
    expect(readFileSync(r.file, 'utf8')).toContain('data-section="suelto.ts"');
    expect(path.dirname(r.file)).toBe(COMPARES_FOLDER);
    const html = readFileSync(r.file, 'utf8');
    expect(html).toContain('data-section="a.ts"');
    expect(html).toContain('data-section="a.ts:3"');          // cada línea dice de qué archivo y línea es
    expect(html).toContain('&lt;script&gt;3&lt;/script&gt;');
    expect(html).not.toContain('<script>3');
    expect(html).toContain('nuevo.md');
  });
  it('sin lo que no está en un commit, solo lo de la rama; y una base que no existe se dice', async () => {
    const d = repo();
    expect((await buildCompare(d, { uncommitted: false })).more).toBe(2);
    await expect(buildCompare(d, { base: 'no-existe' })).rejects.toThrow(/no-existe/);
  });
  it('otra copia del mismo repo se puede comparar desde la conversación; una carpeta que no es su worktree, no', async () => {
    const d = repo();
    const copy = path.join(mkdtempSync(path.join(os.tmpdir(), 'copia-')), 'other');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'other', copy, 'main'], { cwd: d });
    expect(await sameRepoWorktree(d, copy)).toBe(realpathSync(copy));
    await expect(sameRepoWorktree(d, os.tmpdir())).rejects.toThrow();
    await expect(sameRepoWorktree(copy, d)).resolves.toBe(realpathSync(d));
    expect((await buildCompare(await sameRepoWorktree(d, copy))).branch).toBe('other');
  });
  it('another branch or commit of the same repo as head, from a copy on another branch: only its commits, named by itself in the sidecar', async () => {
    const d = repo();
    const copy = path.join(mkdtempSync(path.join(os.tmpdir(), 'copia-')), 'other');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'other', copy, 'main'], { cwd: d });
    const sha = execFileSync('git', ['rev-parse', 'tarea'], { cwd: d }).toString().trim();
    const byBranch = await buildCompare(copy, { head: 'tarea' });
    expect([byBranch.base, byBranch.branch, byBranch.head, byBranch.files, byBranch.more]).toEqual(['main', 'tarea', sha, 2, 2]);
    expect(JSON.parse(readFileSync(sidecarOf(byBranch.file), 'utf8')).parts).toEqual([{ worktree: realpathSync(copy), branch: 'tarea', head: sha, base: 'main' }]);
    const byCommit = await buildCompare(copy, { head: sha });
    expect([byCommit.branch, byCommit.head, byCommit.more]).toEqual([sha.slice(0, 12), sha, 2]);
    expect(JSON.parse(readFileSync(sidecarOf(byCommit.file), 'utf8')).parts[0]).toMatchObject({ branch: sha.slice(0, 12), head: sha });
  });
  it('an unknown head, or uncommitted changes with a head other than HEAD, is said', async () => {
    const d = repo();
    await expect(buildCompare(d, { head: 'no-existe' })).rejects.toThrow(/no-existe/);
    await expect(buildCompare(d, { head: 'main', uncommitted: true })).rejects.toThrow(/main/);
    expect((await buildCompare(d, { head: 'HEAD', uncommitted: false })).more).toBe(2);
  });

  it('los números de línea de cada lado', () => {
    const [f] = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,2 +10,3 @@ f\n uno\n-dos\n+DOS\n+tres\n');
    expect(f.lines.map(l => [l.type, l.old, l.newer])).toEqual([['@', undefined, undefined], [' ', 10, 10], ['-', 11, undefined], ['+', undefined, 11], ['+', undefined, 12]]);
  });
});

describe('cleaning compares', () => {
  it('a compare goes once every worktree it covers is removed; one still in use stays', async () => {
    const d = repo(), folder = mkdtempSync(path.join(os.tmpdir(), 'compares-'));
    const copy = path.join(mkdtempSync(path.join(os.tmpdir(), 'copia-')), 'other');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'other', copy, 'main'], { cwd: d });
    const alive = await buildCompare(d, {}, folder), removed = await buildCompare(copy, {}, folder);
    execFileSync('git', ['worktree', 'remove', copy], { cwd: d });
    await cleanCompares(14, [folder]);
    expect(readdirSync(folder).sort()).toEqual([path.basename(alive.file), path.basename(alive.file).replace(/\.html$/, '.json')].sort());
    expect(existsSync(removed.file)).toBe(false);
  });
});

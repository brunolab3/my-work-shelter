// Nombre del worktree de un trabajo nuevo (sesiones.ts): la tarea se lee en la rama y en el holograma de la sala
import { describe, expect, it } from 'vitest';
import { nombreWorktree, worktreeRoot } from './sesiones.ts';

describe('nombreWorktree', () => {
  it('resume la tarea sin tildes ni signos y añade un sufijo', () => {
    expect(nombreWorktree('Arregla la validación del Login, ¡ya!', 36 ** 4 + 35)).toBe('shelter-arregla-la-validacion-del-login-000z');
  });
  it('corta por palabras enteras', () => {
    const n = nombreWorktree('ABCD-48210 avisar y bloquear al guardar notas con fechas pasadas', 0);
    expect(n).toBe('shelter-abcd-48210-avisar-y-bloquear-al-0000');
  });
  it('sin texto aprovechable, solo el sufijo', () => {
    expect(nombreWorktree('¿?', 1)).toBe('shelter-0001');
  });
});

describe('worktreeRoot', () => {
  it('la raíz del worktree, también desde una subcarpeta; fuera de uno, nada', () => {
    expect(worktreeRoot('/r/app/.claude/worktrees/ABC-1/plans/ABC')).toBe('/r/app/.claude/worktrees/ABC-1');
    expect(worktreeRoot('/r/app/.claude/worktrees/ABC-1')).toBe('/r/app/.claude/worktrees/ABC-1');
    expect(worktreeRoot('/r/app')).toBeUndefined();
  });
});

describe('crearWorktree', () => {
  it('lo crea en .claude/worktrees con la rama worktree-<nombre>, desde la principal del remoto y sin seguirla', async () => {
    const { mkdtempSync, writeFileSync, realpathSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os'); const path = await import('node:path');
    const { crearWorktree } = await import('./sesiones.ts');
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wt-')));
    const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.test', ...a], { cwd, encoding: 'utf8' }).trim();
    const origen = path.join(base, 'origen'), repo = path.join(base, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'master', origen]); writeFileSync(path.join(origen, 'a.txt'), '1'); g(origen, 'add', '.'); g(origen, 'commit', '-qm', 'uno');
    execFileSync('git', ['clone', '-q', origen, repo]);
    g(origen, 'commit', '-qm', 'dos', '--allow-empty');   // la principal avanza en el remoto: el worktree sale de la traída
    g(repo, 'checkout', '-qb', 'otra'); g(repo, 'commit', '-qm', 'local', '--allow-empty');
    const ruta = await crearWorktree(path.join(repo), 'shelter-abc-1-0000');
    expect(ruta).toBe(path.join(repo, '.claude', 'worktrees', 'shelter-abc-1-0000'));
    expect(g(ruta, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('worktree-shelter-abc-1-0000');
    expect(g(ruta, 'log', '-1', '--format=%s')).toBe('dos');
    expect(() => g(ruta, 'rev-parse', '--abbrev-ref', '@{upstream}')).toThrow();
  }, 30_000);
});

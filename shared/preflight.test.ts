import { describe, expect, it } from 'vitest';
import { blockersBetween } from './deploy';
import { checklistCell, checklistFromClaudeMd, compareCell, conflictsCell, gateMissing, mergeOf, mergeReady, preflightTask, pushOf, taskHasPRs, reviewCell, syncCell, type CompareRecord, type LocalBranch, type RoomRepo } from './preflight';
import type { PRBoard } from './board';

// repos, salas y personas inventados
const pr = (repo: string, number: number, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title: 'PR ' + number, url: `https://github.com/${repo}/pull/${number}`, repo, branch: 'rama-' + number, base: 'main', state: 'abierto', updated: 0, review: 'REVIEW_REQUIRED', checks: 'SUCCESS', head: 'c' + number, ...extra });
// una comparación validada de un worktree en un commit
const validated = (worktree: string, branch: string, head: string, ts = 1): CompareRecord => ({ file: `/c/${branch}.html`, ts, parts: [{ worktree, branch, head }], answer: { state: 'validada', ts: ts + 1 } });
const ROOMS: RoomRepo[] = [{ id: 'api', name: 'api', repo: 'acme/api' }, { id: 'web', name: 'web', repo: 'acme/web' }, { id: 'docs', name: 'docs', repo: 'acme/docs' }];

describe('preflightTarea', () => {
  it('una tarea en dos repos con un bloqueo: una parte por PR, cada una con su sala, y el orden de fusión', () => {
    const api = pr('acme/api', 10, { branch: 'feature/ABC-1-contrato' });
    const web = pr('acme/web', 20, { branch: 'ABC-1-pantalla', dependencies: ['acme/api#10'] });
    const other = pr('acme/web', 21, { branch: 'ABC-2-otra' });
    const prs = [api, web, other];
    const local: LocalBranch[] = [
      { roomId: 'api', branch: api.branch, head: 'c10', worktree: '/r/api-abc-1', changes: 0 },
      { roomId: 'web', branch: web.branch, head: 'c20', worktree: '/r/web-abc-1', changes: 0 },
    ];
    const r = preflightTask('abc-1', { prs, blockers: blockersBetween(prs), local, rooms: ROOMS });
    expect(r.key).toBe('ABC-1');
    expect(r.parts.map(p => [p.room, p.pr?.number, p.worktree])).toEqual([['api', 10, '/r/api-abc-1'], ['web', 20, '/r/web-abc-1']]);
    const w = r.parts.find(p => p.pr === web)!;
    expect(w.waitsOn.map(l => l.ref)).toEqual(['acme/api#10']);
    expect(w.blockers.mark).toBe('aviso');
    expect(r.parts.find(p => p.pr === api)!.blocks.map(l => l.ref)).toEqual(['acme/web#20']);
    expect(r.waves).toEqual([['acme/api#10'], ['acme/web#20']]);   // la otra tarea no sale
    expect(w.sync).toEqual({ mark: 'ok', text: expect.any(String) });
  });

  it('a task fully merged keeps its rows and its waves complete; another task\'s merged blocker stays out', () => {
    const api = pr('acme/api', 10, { branch: 'ABC-1-api', state: 'fusionado' });
    const web = pr('acme/web', 20, { branch: 'ABC-1-web', state: 'fusionado', dependencies: ['acme/api#10', 'acme/docs#5'] });
    const foreign = pr('acme/docs', 5, { branch: 'ABC-9-otra', state: 'fusionado' });
    const prs = [api, web, foreign];
    const r = preflightTask('ABC-1', { prs, blockers: blockersBetween(prs), local: [], rooms: ROOMS });
    expect(r.parts.map(p => [p.pr?.number, mergeReady(p).state])).toEqual([[10, 'fusionado'], [20, 'fusionado']]);
    expect(r.waves).toEqual([['acme/api#10'], ['acme/web#20']]);
  });

  it('la CI roja del PR al que se espera es problema suyo: la parte que espera no sale en rojo', () => {
    const api = pr('acme/api', 10, { branch: 'ABC-1-api', checks: 'FAILURE' });
    const web = pr('acme/web', 20, { branch: 'ABC-1-web', checks: 'SUCCESS', review: 'APPROVED', dependencies: ['acme/api#10'] });
    const r = preflightTask('ABC-1', { prs: [api, web], blockers: blockersBetween([api, web]), local: [{ roomId: 'web', branch: web.branch, head: 'c20', worktree: '/r/web', changes: 0 }], rooms: ROOMS, compares: [validated('/r/web', web.branch, 'c20')] });
    const pw = r.parts.find(p => p.pr === web)!, pa = r.parts.find(p => p.pr === api)!;
    expect(pw.ci.mark).toBe('ok');
    expect(pw.blockers.mark).toBe('aviso');
    expect(pw.blockers.text).toMatch(/api#10.*CI/);
    expect(mergeReady(pw).state).toBe('aviso');
    expect(pa.ci.mark).toBe('mal');
    expect(mergeReady(pa).state).toBe('falta');
  });

  it('PR apilados en un mismo repo: dos partes, la de arriba espera a la de abajo, una sola sacada en el worktree', () => {
    const below = pr('acme/api', 30, { branch: 'ABC-3-base' });
    const above = pr('acme/api', 31, { branch: 'ABC-3-encima', base: 'ABC-3-base' });
    const local: LocalBranch[] = [
      { roomId: 'api', branch: 'ABC-3-encima', head: 'c31', worktree: '/r/api-abc-3', changes: 2 },
      { roomId: 'api', branch: 'ABC-3-base', head: 'c30' },
    ];
    const r = preflightTask('ABC-3', { prs: [below, above], blockers: blockersBetween([below, above]), local, rooms: ROOMS });
    expect(r.parts).toHaveLength(2);
    const pBelow = r.parts.find(p => p.pr === below)!, pAbove = r.parts.find(p => p.pr === above)!;
    expect(pAbove.waitsOn[0].reason).toBe('pila');
    expect(pAbove.sync.mark).toBe('aviso');           // 2 sin commitear
    expect(pBelow.sync.mark).toBe('ok');               // la rama suelta, al día y sin worktree: sus cambios no cuentan
    expect(pBelow.worktree).toBeUndefined();
    expect(r.waves).toEqual([['acme/api#30'], ['acme/api#31']]);
  });

  it('un PR sin worktree ni rama local, y una parte del plan sin empezar', () => {
    const api = pr('acme/api', 40, { branch: 'ABC-4-api' });
    const r = preflightTask('ABC-4', {
      prs: [api], blockers: [], local: [], rooms: ROOMS,
      plan: [{ roomId: 'api', room: 'api', title: 'El contrato' }, { roomId: 'docs', room: 'docs', title: 'La guía', waitA: ['api'] }, { roomId: 'web', room: 'web', title: 'La pantalla', waitA: ['api'] }],
    });
    const pa = r.parts.find(p => p.pr === api)!;
    expect(pa.sync).toMatchObject({ mark: 'nada' });
    expect(pa.plan).toBe('El contrato');
    const notStarted = r.parts.filter(p => p.notStarted).map(p => p.room);
    expect(notStarted).toEqual(['docs', 'web']);
    expect(mergeReady(r.parts.find(p => p.room === 'web')!).state).toBe('falta');
  });

  it('el plan dice que una parte espera a una sala aún sin PR: la espera sale igual', () => {
    const web = pr('acme/web', 50, { branch: 'ABC-5-web' });
    const r = preflightTask('ABC-5', { prs: [web], blockers: [], local: [], rooms: ROOMS, plan: [{ roomId: 'web', room: 'web', title: 'Pantalla', waitA: ['api'] }, { roomId: 'api', room: 'api', title: 'Contrato' }] });
    const pw = r.parts.find(p => p.pr === web)!;
    expect(pw.waitsOn).toEqual([expect.objectContaining({ room: 'api', reason: 'plan' })]);
    expect(pw.blockers.mark).toBe('aviso');
  });

  it('un worktree de la tarea sin PR aún es una parte; los PR cerrados sin fusionar no cuentan', () => {
    const closed = pr('acme/api', 60, { branch: 'ABC-6-viejo', state: 'cerrado' });
    const r = preflightTask('ABC-6', { prs: [closed], blockers: [], local: [{ roomId: 'web', branch: 'ABC-6-nuevo', head: 'aa', worktree: '/r/web-abc-6', changes: 0 }], rooms: ROOMS, compares: [validated('/r/web-abc-6', 'ABC-6-nuevo', 'aa')] });
    expect(r.parts.map(p => [p.room, p.pr?.number, p.branch])).toEqual([['web', undefined, 'ABC-6-nuevo']]);
    expect(r.parts[0].compare.mark).toBe('ok');                    // the push gate still sees it
    expect(mergeReady(r.parts[0]).state).toBe('falta');            // nothing to merge without a PR
  });
});

describe('mergeReady', () => {
  const ready = { review: 'APPROVED' as const, checks: 'SUCCESS' as const, conflicts: false };
  const part = (prs: PRBoard[], url: string) => preflightTask('ABC-9', { prs, blockers: blockersBetween(prs), local: [], rooms: ROOMS }).parts.find(p => p.pr?.url === url)!;
  it('open, green, approved and mergeable → ready, whatever its compare or checklist say', () => {
    const a = pr('acme/api', 1, { branch: 'ABC-9-api', ...ready });
    const p = part([a], a.url);
    expect(p.compare.mark).toBe('nada');
    expect(mergeReady(p)).toEqual({ state: 'listo', missing: [] });
  });
  it('approved and green but with conflicts → ✗, and the hover says why', () => {
    const a = pr('acme/api', 1, { branch: 'ABC-9-api', ...ready, conflicts: true });
    const r = mergeReady(part([a], a.url));
    expect(r.state).toBe('falta');
    expect(r.missing.join(' ')).toMatch(/conflict/);
    expect(conflictsCell({ ...a, conflicts: undefined }).mark).toBe('nada');   // GitHub still computing it
  });
  it('waits for an open PR → ⚠ until that one is merged', () => {
    const api = pr('acme/api', 1, { branch: 'ABC-9-api', ...ready });
    const web = pr('acme/web', 2, { branch: 'ABC-9-web', ...ready, dependencies: ['acme/api#1'] });
    expect(mergeReady(part([api, web], web.url)).state).toBe('aviso');
    const merged = { ...api, state: 'fusionado' as const };
    expect(mergeReady(part([merged, web], web.url)).state).toBe('listo');
    expect(mergeReady(part([merged, web], merged.url)).state).toBe('fusionado');
  });
  it('a draft is not ready yet, even if everything else is', () => {
    const a = pr('acme/api', 1, { branch: 'ABC-9-api', ...ready, state: 'borrador' });
    expect(mergeReady(part([a], a.url))).toMatchObject({ state: 'aviso' });
  });
});

describe('syncCell', () => {
  const p = pr('acme/api', 1, { head: 'remota' });
  it('detrás de la cabeza del PR (un bot empujó) → ⚠', () => {
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'local', worktree: '/r', changes: 0, behind: 2, ahead: 0 }).mark).toBe('aviso');
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'local', worktree: '/r', changes: 0, headless: true }).mark).toBe('aviso');
  });
  it('commits sin empujar → ⚠; separada a los dos lados → ✗; igual pero con cambios sin commitear → ⚠', () => {
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'local', ahead: 1, behind: 0 }).mark).toBe('aviso');
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'local', ahead: 1, behind: 1 }).mark).toBe('mal');
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'remota', worktree: '/r', changes: 3 }).mark).toBe('aviso');
    expect(syncCell(p, { roomId: 'api', branch: p.branch, head: 'remota', worktree: '/r', changes: 0 }).mark).toBe('ok');
  });
});

describe('compareCell', () => {
  const part = { worktree: '/r/api', branch: 'ABC-1-api', headLocal: 'h2' };
  it('validada en el commit actual → ✓; un commit nuevo la deja vieja → ⚠; sin ninguna → ✗', () => {
    expect(compareCell(part, [validated('/r/api', 'ABC-1-api', 'h2')]).cell.mark).toBe('ok');
    const old = compareCell(part, [validated('/r/api', 'ABC-1-api', 'h1')]);
    expect([old.cell.mark, old.file]).toEqual(['aviso', '/c/ABC-1-api.html']);
    expect(compareCell(part, []).cell.mark).toBe('mal');
  });
  it('rehecha después de validarla (mismo archivo, otra vez) → sin revisar; con notas → ⚠ hasta una nueva', () => {
    expect(compareCell(part, [{ file: '/c/a.html', ts: 10, parts: [{ worktree: '/r/api', branch: 'ABC-1-api', head: 'h2' }], answer: { state: 'validada', ts: 5 } }]).cell.mark).toBe('aviso');
    expect(compareCell(part, [{ file: '/c/a.html', ts: 10, parts: [{ worktree: '/r/api', branch: 'ABC-1-api', head: 'h2' }], answer: { state: 'notas', ts: 11 } }]).cell.text).toMatch(/notas/);
  });
  it('a validated compare of another head (compare_changes head) only counts for the branch and commit it compared', () => {
    expect(compareCell(part, [validated('/r/api', 'other-branch', 'h2')]).cell.mark).toBe('mal');
    expect(compareCell(part, [validated('/r/api', 'h2h2h2h2h2h2', 'h2')]).cell.mark).toBe('mal');   // a commit, named by itself
    expect(compareCell(part, [validated('/r/api', 'ABC-1-api', 'h1')]).cell.mark).toBe('aviso');
  });
  it('una comparación de varios repos, validada, vale para cada parte en su commit', () => {
    const task: CompareRecord = { file: '/c/tarea-ABC-1.html', ts: 3, parts: [{ worktree: '/r/api', branch: 'ABC-1-api', head: 'h2' }, { worktree: '/r/web', branch: 'ABC-1-web', head: 'w1' }], answer: { state: 'validada', ts: 4 } };
    expect(compareCell(part, [validated('/r/api', 'ABC-1-api', 'h1', 8), task]).cell.mark).toBe('ok');
    const api = pr('acme/api', 1, { branch: 'ABC-1-api' });
    const r = preflightTask('ABC-1', { prs: [api], blockers: [], local: [{ roomId: 'api', branch: 'ABC-1-api', head: 'h2', worktree: '/r/api', changes: 0 }], rooms: ROOMS, compares: [task] });
    expect(r.parts[0].compare.mark).toBe('ok');
  });
});

describe('hilos de revisión', () => {
  it('un aprobado con hilos sin resolver no está listo; los hilos de su PR van en la parte', () => {
    const p = pr('acme/api', 7, { branch: 'ABC-7-api', review: 'APPROVED', ledger: { unresolved: 2, outdated: 0, unansweredSummaries: 1 } });
    expect(reviewCell(p)).toEqual({ mark: 'aviso', text: expect.stringMatching(/2.*1/) });
    expect(reviewCell({ ...p, ledger: { unresolved: 0, outdated: 0, unansweredSummaries: 0 } }).mark).toBe('ok');
    const thread = { file: 'src/a.ts', line: 3, author: 'revisora', text: '¿Y si es nulo?', url: p.url + '#discussion_r1', outdated: false };
    const r = preflightTask('ABC-7', { prs: [p], blockers: [], local: [], rooms: ROOMS, threads: { [p.url]: [thread] } });
    expect(r.parts[0].threads).toEqual([thread]);
  });
});

describe('la puerta de git push', () => {
  it('reconoce git push (con -C, -c, variables delante, en cualquier trozo), no --dry-run ni otras órdenes', () => {
    expect(pushOf('git push')).toEqual({ cwd: undefined });
    expect(pushOf('git push -u origin ABC-1-api')).toEqual({ cwd: undefined });
    expect(pushOf('git -C ../api push origin HEAD')).toEqual({ cwd: '../api' });
    expect(pushOf('git -c core.hooksPath=/dev/null push')).toBeTruthy();
    expect(pushOf('npm test && git push --force-with-lease')).toBeTruthy();
    expect(pushOf('GIT_TRACE=1 git push')).toBeTruthy();
    expect(pushOf('/usr/bin/git push')).toBeTruthy();
    expect(pushOf('git push --dry-run')).toBeNull();
    expect(pushOf('git push -n')).toBeNull();
    expect(pushOf('git status; git log --oneline')).toBeNull();
    expect(pushOf('echo "git push"')).toBeNull();
    expect(pushOf('gh pr ready 12')).toBeNull();          // decisión del Supervisor: solo git push
  });
  it('merging is what asks (git merge, gh pr merge), not pushing', () => {
    expect(mergeOf('git merge ABC-1-api')).toEqual({ cwd: undefined });
    expect(mergeOf('cd ../api && git merge --no-ff ABC-1')).toEqual({ cwd: '../api' });
    expect(mergeOf('gh pr merge 12 --squash')).toEqual({ cwd: undefined });
    expect(mergeOf('git merge --abort')).toBeNull();
    expect(mergeOf('git push origin HEAD:main')).toBeNull();
    expect(pushOf('git merge ABC-1')).toBeNull();
  });
  it('follows `cd` and `sh -c`, so the gate checks the folder that actually pushes', () => {
    expect(pushOf('cd .claude/worktrees/ABC-12-x && git push')).toEqual({ cwd: '.claude/worktrees/ABC-12-x' });
    expect(pushOf('cd ../api; git -C sub push')).toEqual({ cwd: '../api/sub' });
    expect(pushOf('cd /repos/api && git -C /repos/web push')).toEqual({ cwd: '/repos/web' });
    expect(pushOf('(cd ~/repos/api && git push origin HEAD)')).toEqual({ cwd: '~/repos/api' });
    expect(pushOf('bash -c "git push"')).toEqual({ cwd: undefined });
    expect(pushOf(`sh -lc 'cd ../api && git push'`)).toEqual({ cwd: '../api' });
    expect(pushOf('env GIT_TRACE=1 git push')).toBeTruthy();
    expect(pushOf('git commit -m "a; git push" && echo ok')).toBeNull();   // `;` inside quotes doesn't split
    expect(pushOf('bash -c "git status"')).toBeNull();
  });
  it('falta el compare validado en su commit y, salvo en borrador, la lista contestada', () => {
    const items = ['Compare revisado', 'Pruebas con datos reales'];
    const p = pr('acme/api', 1, { branch: 'ABC-1-api' });
    const r = (extra: Partial<PRBoard>, answers = {}, compares: CompareRecord[] = []) => preflightTask('ABC-1', {
      prs: [{ ...p, ...extra }], blockers: [], rooms: ROOMS, compares,
      local: [{ roomId: 'api', branch: 'ABC-1-api', head: 'h1', worktree: '/r/api', changes: 0 }],
      checklist: { items, answers: { '/r/api|h1': answers } },
    }).parts[0];
    expect(gateMissing(r({}))).toHaveLength(2);
    const one = { 'Compare revisado': { state: 'ok' as const, ts: 1 } };
    expect(r({}, one).checklist.text).toMatch(/1\/2/);
    const all = { ...one, 'Pruebas con datos reales': { state: 'n/a' as const, note: 'sin datos', ts: 1 } };
    expect(gateMissing(r({}, all, [validated('/r/api', 'ABC-1-api', 'h1')]))).toEqual([]);
    // n/a sin nota no cuenta
    expect(r({}, { ...one, 'Pruebas con datos reales': { state: 'n/a', ts: 1 } }).checklist.mark).toBe('aviso');
    // en borrador basta el compare
    expect(gateMissing(r({ state: 'borrador' }, {}, [validated('/r/api', 'ABC-1-api', 'h1')]))).toEqual([]);
    expect(gateMissing(r({ state: 'borrador' }))).toHaveLength(1);
    // sin lista, solo el compare
    expect(checklistCell({ worktree: '/r/api', headLocal: 'h1' }, [], {}).mark).toBe('nada');
  });
});

describe('checklistFromClaudeMd', () => {
  it('los puntos de «Before pushing», por su título en negrita o su primera frase; nada más', () => {
    const md = ['# Sobre mí', '', '- Me gusta el café.', '', '# Before pushing or marking a PR ready', '', 'Run these checks:', '',
      '1. **Reused component, new path.** When calling an existing checker…', '2. **Assert the outcome.** Check the values.', '3. Plain item without bold. More text.', '', '# Otra cosa', '1. **No** cuenta'].join('\n');
    expect(checklistFromClaudeMd(md)).toEqual(['Reused component, new path', 'Assert the outcome', 'Plain item without bold']);
    expect(checklistFromClaudeMd('# Nada\n1. x')).toEqual([]);
    expect(checklistFromClaudeMd('## Antes de subir\n- **Compare**: revisado')).toEqual(['Compare']);
  });
});

describe('taskHasPRs', () => {
  it('only with an open, draft or merged PR of the task, by exact key, Jira or slug', () => {
    const prs = [pr('acme/api', 1, { branch: 'feature/ABC-1-x' }), pr('acme/web', 2, { branch: 'ABC-2-y', state: 'cerrado' }), pr('acme/web', 3, { branch: 'z', title: 'ABC-3 merged', state: 'fusionado' }), pr('acme/web', 4, { branch: 'shelter-mi-tarea--ab12', state: 'borrador' })];
    expect(taskHasPRs('abc-1', prs)).toBe(true);
    expect(taskHasPRs('ABC-3', prs)).toBe(true);
    expect(taskHasPRs('ABC-2', prs)).toBe(false);   // closed without merging
    expect(taskHasPRs('mi-tarea', prs)).toBe(true);
    expect(taskHasPRs('ABC-12', prs)).toBe(false);
    expect(taskHasPRs('ABC-1', [])).toBe(false);
    expect(taskHasPRs('rm -rf', prs)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { bloqueosEntre } from './despliegue';
import { checklistCell, checklistFromClaudeMd, compareCell, estadoParte, gateMissing, preflightTarea, pushOf, reviewCell, syncCell, type CompareRecord, type LocalBranch, type RoomRepo } from './preflight';
import type { PRBoard } from './tablero';

// repos, salas y personas inventados
const pr = (repo: string, numero: number, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ numero, titulo: 'PR ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama: 'rama-' + numero, base: 'main', estado: 'abierto', actualizado: 0, revision: 'REVIEW_REQUIRED', checks: 'SUCCESS', cabeza: 'c' + numero, ...extra });
// una comparación validada de un worktree en un commit
const validada = (worktree: string, rama: string, head: string, ts = 1): CompareRecord => ({ archivo: `/c/${rama}.html`, ts, partes: [{ worktree, rama, head }], respuesta: { estado: 'validada', ts: ts + 1 } });
const SALAS: RoomRepo[] = [{ id: 'api', nombre: 'api', repo: 'acme/api' }, { id: 'web', nombre: 'web', repo: 'acme/web' }, { id: 'docs', nombre: 'docs', repo: 'acme/docs' }];

describe('preflightTarea', () => {
  it('una tarea en dos repos con un bloqueo: una parte por PR, cada una con su sala, y el orden de fusión', () => {
    const api = pr('acme/api', 10, { rama: 'feature/ABC-1-contrato' });
    const web = pr('acme/web', 20, { rama: 'ABC-1-pantalla', dependencias: ['acme/api#10'] });
    const otra = pr('acme/web', 21, { rama: 'ABC-2-otra' });
    const prs = [api, web, otra];
    const locales: LocalBranch[] = [
      { salaId: 'api', rama: api.rama, head: 'c10', worktree: '/r/api-abc-1', cambios: 0 },
      { salaId: 'web', rama: web.rama, head: 'c20', worktree: '/r/web-abc-1', cambios: 0 },
    ];
    const r = preflightTarea('abc-1', { prs, bloqueos: bloqueosEntre(prs), locales, salas: SALAS });
    expect(r.clave).toBe('ABC-1');
    expect(r.partes.map(p => [p.sala, p.pr?.numero, p.worktree])).toEqual([['api', 10, '/r/api-abc-1'], ['web', 20, '/r/web-abc-1']]);
    const w = r.partes.find(p => p.pr === web)!;
    expect(w.esperaA.map(l => l.ref)).toEqual(['acme/api#10']);
    expect(w.bloqueos.marca).toBe('aviso');
    expect(r.partes.find(p => p.pr === api)!.bloquea.map(l => l.ref)).toEqual(['acme/web#20']);
    expect(r.olas).toEqual([['acme/api#10'], ['acme/web#20']]);   // la otra tarea no sale
    expect(w.sync).toEqual({ marca: 'ok', texto: expect.any(String) });
  });

  it('la CI roja del PR al que se espera es problema suyo: la parte que espera no sale en rojo', () => {
    const api = pr('acme/api', 10, { rama: 'ABC-1-api', checks: 'FAILURE' });
    const web = pr('acme/web', 20, { rama: 'ABC-1-web', checks: 'SUCCESS', revision: 'APPROVED', dependencias: ['acme/api#10'] });
    const r = preflightTarea('ABC-1', { prs: [api, web], bloqueos: bloqueosEntre([api, web]), locales: [{ salaId: 'web', rama: web.rama, head: 'c20', worktree: '/r/web', cambios: 0 }], salas: SALAS, compares: [validada('/r/web', web.rama, 'c20')] });
    const pw = r.partes.find(p => p.pr === web)!, pa = r.partes.find(p => p.pr === api)!;
    expect(pw.ci.marca).toBe('ok');
    expect(pw.bloqueos.marca).toBe('aviso');
    expect(pw.bloqueos.texto).toMatch(/api#10.*CI/);
    expect(estadoParte(pw).estado).toBe('aviso');
    expect(pa.ci.marca).toBe('mal');
    expect(estadoParte(pa).estado).toBe('falta');
  });

  it('PR apilados en un mismo repo: dos partes, la de arriba espera a la de abajo, una sola sacada en el worktree', () => {
    const abajo = pr('acme/api', 30, { rama: 'ABC-3-base' });
    const arriba = pr('acme/api', 31, { rama: 'ABC-3-encima', base: 'ABC-3-base' });
    const locales: LocalBranch[] = [
      { salaId: 'api', rama: 'ABC-3-encima', head: 'c31', worktree: '/r/api-abc-3', cambios: 2 },
      { salaId: 'api', rama: 'ABC-3-base', head: 'c30' },
    ];
    const r = preflightTarea('ABC-3', { prs: [abajo, arriba], bloqueos: bloqueosEntre([abajo, arriba]), locales, salas: SALAS });
    expect(r.partes).toHaveLength(2);
    const pAbajo = r.partes.find(p => p.pr === abajo)!, pArriba = r.partes.find(p => p.pr === arriba)!;
    expect(pArriba.esperaA[0].motivo).toBe('pila');
    expect(pArriba.sync.marca).toBe('aviso');           // 2 sin commitear
    expect(pAbajo.sync.marca).toBe('ok');               // la rama suelta, al día y sin worktree: sus cambios no cuentan
    expect(pAbajo.worktree).toBeUndefined();
    expect(r.olas).toEqual([['acme/api#30'], ['acme/api#31']]);
  });

  it('un PR sin worktree ni rama local, y una parte del plan sin empezar', () => {
    const api = pr('acme/api', 40, { rama: 'ABC-4-api' });
    const r = preflightTarea('ABC-4', {
      prs: [api], bloqueos: [], locales: [], salas: SALAS,
      plan: [{ salaId: 'api', sala: 'api', titulo: 'El contrato' }, { salaId: 'docs', sala: 'docs', titulo: 'La guía', waitA: ['api'] }, { salaId: 'web', sala: 'web', titulo: 'La pantalla', waitA: ['api'] }],
    });
    const pa = r.partes.find(p => p.pr === api)!;
    expect(pa.sync).toMatchObject({ marca: 'nada' });
    expect(pa.plan).toBe('El contrato');
    const sinEmpezar = r.partes.filter(p => p.sinEmpezar).map(p => p.sala);
    expect(sinEmpezar).toEqual(['docs', 'web']);
    expect(estadoParte(r.partes.find(p => p.sala === 'web')!).estado).toBe('falta');
  });

  it('el plan dice que una parte espera a una sala aún sin PR: la espera sale igual', () => {
    const web = pr('acme/web', 50, { rama: 'ABC-5-web' });
    const r = preflightTarea('ABC-5', { prs: [web], bloqueos: [], locales: [], salas: SALAS, plan: [{ salaId: 'web', sala: 'web', titulo: 'Pantalla', waitA: ['api'] }, { salaId: 'api', sala: 'api', titulo: 'Contrato' }] });
    const pw = r.partes.find(p => p.pr === web)!;
    expect(pw.esperaA).toEqual([expect.objectContaining({ sala: 'api', motivo: 'plan' })]);
    expect(pw.bloqueos.marca).toBe('aviso');
  });

  it('un worktree de la tarea sin PR aún es una parte; los PR cerrados sin fusionar no cuentan', () => {
    const cerrado = pr('acme/api', 60, { rama: 'ABC-6-viejo', estado: 'cerrado' });
    const r = preflightTarea('ABC-6', { prs: [cerrado], bloqueos: [], locales: [{ salaId: 'web', rama: 'ABC-6-nuevo', head: 'aa', worktree: '/r/web-abc-6', cambios: 0 }], salas: SALAS, compares: [validada('/r/web-abc-6', 'ABC-6-nuevo', 'aa')] });
    expect(r.partes.map(p => [p.sala, p.pr?.numero, p.rama])).toEqual([['web', undefined, 'ABC-6-nuevo']]);
    expect(estadoParte(r.partes[0]).estado).toBe('listo');
  });
});

describe('syncCell', () => {
  const p = pr('acme/api', 1, { cabeza: 'remota' });
  it('detrás de la cabeza del PR (un bot empujó) → ⚠', () => {
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'local', worktree: '/r', cambios: 0, detras: 2, adelante: 0 }).marca).toBe('aviso');
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'local', worktree: '/r', cambios: 0, sinCabeza: true }).marca).toBe('aviso');
  });
  it('commits sin empujar → ⚠; separada a los dos lados → ✗; igual pero con cambios sin commitear → ⚠', () => {
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'local', adelante: 1, detras: 0 }).marca).toBe('aviso');
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'local', adelante: 1, detras: 1 }).marca).toBe('mal');
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'remota', worktree: '/r', cambios: 3 }).marca).toBe('aviso');
    expect(syncCell(p, { salaId: 'api', rama: p.rama, head: 'remota', worktree: '/r', cambios: 0 }).marca).toBe('ok');
  });
});

describe('compareCell', () => {
  const parte = { worktree: '/r/api', rama: 'ABC-1-api', headLocal: 'h2' };
  it('validada en el commit actual → ✓; un commit nuevo la deja vieja → ⚠; sin ninguna → ✗', () => {
    expect(compareCell(parte, [validada('/r/api', 'ABC-1-api', 'h2')]).celda.marca).toBe('ok');
    const vieja = compareCell(parte, [validada('/r/api', 'ABC-1-api', 'h1')]);
    expect([vieja.celda.marca, vieja.archivo]).toEqual(['aviso', '/c/ABC-1-api.html']);
    expect(compareCell(parte, []).celda.marca).toBe('mal');
  });
  it('rehecha después de validarla (mismo archivo, otra vez) → sin revisar; con notas → ⚠ hasta una nueva', () => {
    expect(compareCell(parte, [{ archivo: '/c/a.html', ts: 10, partes: [{ worktree: '/r/api', rama: 'ABC-1-api', head: 'h2' }], respuesta: { estado: 'validada', ts: 5 } }]).celda.marca).toBe('aviso');
    expect(compareCell(parte, [{ archivo: '/c/a.html', ts: 10, partes: [{ worktree: '/r/api', rama: 'ABC-1-api', head: 'h2' }], respuesta: { estado: 'notas', ts: 11 } }]).celda.texto).toMatch(/notas/);
  });
  it('la comparación de la tarea entera, validada, vale para cada parte en su commit', () => {
    const tarea: CompareRecord = { archivo: '/c/tarea-ABC-1.html', ts: 3, tarea: 'ABC-1', partes: [{ worktree: '/r/api', rama: 'ABC-1-api', head: 'h2' }, { worktree: '/r/web', rama: 'ABC-1-web', head: 'w1' }], respuesta: { estado: 'validada', ts: 4 } };
    expect(compareCell(parte, [validada('/r/api', 'ABC-1-api', 'h1', 8), tarea]).celda.marca).toBe('ok');
    const api = pr('acme/api', 1, { rama: 'ABC-1-api' });
    const r = preflightTarea('ABC-1', { prs: [api], bloqueos: [], locales: [{ salaId: 'api', rama: 'ABC-1-api', head: 'h2', worktree: '/r/api', cambios: 0 }], salas: SALAS, compares: [tarea] });
    expect(r.compareTarea?.archivo).toBe('/c/tarea-ABC-1.html');
    expect(r.partes[0].compare.marca).toBe('ok');
  });
});

describe('hilos de revisión', () => {
  it('un aprobado con hilos sin resolver no está listo; los hilos de su PR van en la parte', () => {
    const p = pr('acme/api', 7, { rama: 'ABC-7-api', revision: 'APPROVED', ledger: { unresolved: 2, outdated: 0, unansweredSummaries: 1 } });
    expect(reviewCell(p)).toEqual({ marca: 'aviso', texto: expect.stringMatching(/2.*1/) });
    expect(reviewCell({ ...p, ledger: { unresolved: 0, outdated: 0, unansweredSummaries: 0 } }).marca).toBe('ok');
    const hilo = { archivo: 'src/a.ts', linea: 3, autor: 'revisora', texto: '¿Y si es nulo?', url: p.url + '#discussion_r1', outdated: false };
    const r = preflightTarea('ABC-7', { prs: [p], bloqueos: [], locales: [], salas: SALAS, hilos: { [p.url]: [hilo] } });
    expect(r.partes[0].hilos).toEqual([hilo]);
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
  it('falta el compare validado en su commit y, salvo en borrador, la lista contestada', () => {
    const items = ['Compare revisado', 'Pruebas con datos reales'];
    const p = pr('acme/api', 1, { rama: 'ABC-1-api' });
    const r = (extra: Partial<PRBoard>, respuestas = {}, compares: CompareRecord[] = []) => preflightTarea('ABC-1', {
      prs: [{ ...p, ...extra }], bloqueos: [], salas: SALAS, compares,
      locales: [{ salaId: 'api', rama: 'ABC-1-api', head: 'h1', worktree: '/r/api', cambios: 0 }],
      checklist: { items, respuestas: { '/r/api|h1': respuestas } },
    }).partes[0];
    expect(gateMissing(r({}))).toHaveLength(2);
    const una = { 'Compare revisado': { estado: 'ok' as const, ts: 1 } };
    expect(r({}, una).checklist.texto).toMatch(/1\/2/);
    const todas = { ...una, 'Pruebas con datos reales': { estado: 'n/a' as const, nota: 'sin datos', ts: 1 } };
    expect(gateMissing(r({}, todas, [validada('/r/api', 'ABC-1-api', 'h1')]))).toEqual([]);
    // n/a sin nota no cuenta
    expect(r({}, { ...una, 'Pruebas con datos reales': { estado: 'n/a', ts: 1 } }).checklist.marca).toBe('aviso');
    // en borrador basta el compare
    expect(gateMissing(r({ estado: 'borrador' }, {}, [validada('/r/api', 'ABC-1-api', 'h1')]))).toEqual([]);
    expect(gateMissing(r({ estado: 'borrador' }))).toHaveLength(1);
    // sin lista, solo el compare
    expect(checklistCell({ worktree: '/r/api', headLocal: 'h1' }, [], {}).marca).toBe('nada');
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

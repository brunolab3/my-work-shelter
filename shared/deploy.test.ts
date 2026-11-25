import { describe, expect, it } from 'vitest';
import { blockersBetween, outsized, sizeText, SIZE_LIMIT, deploymentColumn, dependenciesInText, taskLinks, deployWaves, promptDeployment } from './deploy';
import type { PRBoard } from './board';

const pr = (number: number, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title: 'PR ' + number, url: 'https://github.com/o/r/pull/' + number, repo: 'o/r', branch: 'rama-' + number, base: 'main', state: 'open', updated: 0, ...extra });

describe('dependenciasEnTexto', () => {
  it('lee «depends on», «bloqueado por» y enlaces, con o sin repo, y no toma un # suelto', () => {
    const t = 'Arregla #3.\nDepends on #12 and o/otro#7\nBloqueado por https://github.com/o/r/pull/40\nmerge after: #12';
    expect(dependenciesInText(t, 'o/r')).toEqual(['o/r#12', 'o/otro#7', 'o/r#40']);
  });
});

describe('dependenciasEnTexto por frases', () => {
  it('las referencias y las ramas de una frase sobre lo que va antes; no lo que puede ir en cualquier orden', () => {
    const t = [
      'Stacked on #17: review and merge that one first. It was split out to keep #18 small.',
      '* ⚠️ Merge with or after the api change that skips old rows (branch `feature/ABC-16-saltar-filas`).',
      '⚠️ Merge order: api PR 1 (`feature/ABC-15-contratos`) must be in production first.',
      '* Can merge before or after the backend (`feature/ABC-15-otra`).',
      'After switching to it, restart the containers.',
      'Blockers:',
      '- refugio/web#30',
      '- `ABC-20-migracion`',
      '',
      '⚠️ **Do not merge until both api PRs are in production:**',
      '- [refugio/api#40](https://github.com/refugio/api/pull/40) [1/4]: exposes the permission.',
      '- [refugio/api#41](https://github.com/refugio/api/pull/41) [2/4]: adds the endpoint.',
      '',
      'Can only be merged after refugio/api#42 is live.',
      'Fixes #99.',
    ].join('\n');
    expect(dependenciesInText(t, 'refugio/web').sort()).toEqual(['refugio/web#17', 'branch:feature/ABC-16-saltar-filas', 'branch:feature/ABC-15-contratos', 'refugio/web#30', 'branch:ABC-20-migracion', 'refugio/api#40', 'refugio/api#41', 'refugio/api#42'].sort());
  });

  it('una rama nombrada en la descripción bloquea con el PR de esa rama, aunque sea de otro repo', () => {
    const api = pr(1, { repo: 'refugio/api', url: 'https://github.com/refugio/api/pull/1', branch: 'feature/ABC-15-contratos' });
    const web = pr(2, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/2', branch: 'ABC-15-pantalla', dependencies: dependenciesInText('Merge order: `feature/ABC-15-contratos` must be merged first.', 'refugio/web') });
    expect(blockersBetween([api, web])).toEqual([{ from: web.url, by: api.url, reason: 'text' }]);
  });
});

describe('bloqueosEntre', () => {
  it('apilado (base = rama de otro PR), por la descripción y a mano; lo que apunta fuera del tablero no cuenta', () => {
    const a = pr(1), b = pr(2, { base: 'rama-1' }), c = pr(3, { dependencies: ['o/r#2', 'o/r#99'] }), d = pr(4, { repo: 'o/web', url: 'https://github.com/o/web/pull/4' });
    const bs = blockersBetween([a, b, c, d], [{ from: d.url, by: a.url }, { from: d.url, by: 'https://github.com/o/r/pull/99' }]);
    expect(bs.map(x => [x.from.split('/').pop(), x.by.split('/').pop(), x.reason])).toEqual([['2', '1', 'stack'], ['3', '2', 'text'], ['4', '1', 'manual']]);
  });
});

describe('olasDespliegue', () => {
  it('cada ola espera a las anteriores; lo fusionado ya no bloquea y un ciclo queda aparte', () => {
    const f = pr(1, { state: 'merged' }), a = pr(2), b = pr(3, { dependencies: ['o/r#1', 'o/r#2'] }), c = pr(4, { dependencies: ['o/r#3'] });
    const x = pr(5, { dependencies: ['o/r#6'] }), y = pr(6, { dependencies: ['o/r#5'] });
    const prs = [f, a, b, c, x, y];
    const r = deployWaves(prs, blockersBetween(prs));
    expect(r.waves.map(o => o.map(p => p.number))).toEqual([[2], [3], [4]]);
    expect(r.cycle.map(p => p.number)).toEqual([5, 6]);
    expect(promptDeployment(prs, blockersBetween(prs))).toContain('Ola 2:\n- o/r#3 «PR 3» · review · espera a o/r#1 (fusionado), o/r#2');
  });
});

describe('columnaDespliegue', () => {
  it('por estado y revisión; los cerrados sin fusionar, fuera', () => {
    expect([pr(1, { state: 'draft' }), pr(2), pr(3, { review: 'CHANGES_REQUESTED' }), pr(4, { review: 'APPROVED' }), pr(5, { state: 'merged' }), pr(6, { state: 'closed' })].map(deploymentColumn))
      .toEqual(['draft', 'review', 'changes', 'approved', 'merged', null]);
  });
});

describe('misma tarea en repos distintos', () => {
  const api = pr(1, { repo: 'Refugio/API', url: 'https://github.com/refugio/api/pull/1', branch: 'feature/ABC-12-endpoint' });
  const web = pr(7, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/7', branch: 'abc-12-formulario' });
  const other = pr(8, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/8', branch: 'ABC-99-otra' });
  const withoutKey = [pr(3, { repo: 'refugio/api', url: 'https://github.com/refugio/api/pull/3', branch: 'arreglo' }), pr(3, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/3', branch: 'arreglo' })];

  it('el orden del plan de la tarea bloquea el PR del repo que espera (sin distinguir mayúsculas del repo) y va en otra ola', () => {
    const prs = [api, web, other];
    const bs = blockersBetween(prs, [], [{ key: 'ABC-12', repo: 'refugio/web', waitA: ['refugio/api'] }]);
    expect(bs).toEqual([{ from: web.url, by: api.url, reason: 'plan' }]);
    expect(deployWaves(prs, bs).waves.map(o => o.map(p => p.number))).toEqual([[1, 8], [7]]);
    expect(taskLinks(prs, bs)).toEqual([]);
  });

  it('sin orden conocido van enlazados sin bloquearse (y el plan pide cuál va primero); PR-N de reserva no junta repos', () => {
    const prs = [api, web, other, ...withoutKey];
    const bs = blockersBetween(prs);
    expect(bs).toEqual([]);
    expect(taskLinks(prs, bs)).toEqual([{ a: api.url, b: web.url, key: 'ABC-12' }]);
    expect(promptDeployment(prs, bs)).toContain('· misma tarea (ABC-12) que refugio/web#7, sin orden conocido');
  });

  it('el plan lleva lo que queda por contestar en las revisiones de cada PR abierto; con cero, nada', () => {
    const withReviews = pr(1, { ledger: { unresolved: 3, outdated: 0, unansweredSummaries: 1 } }), clean = pr(2, { ledger: { unresolved: 0, outdated: 0, unansweredSummaries: 0 } });
    const text = promptDeployment([withReviews, clean], []);
    expect(text).toContain('o/r#1 «PR 1» · review · revisiones por contestar: 3 hilos sin resolver, 1 resúmenes sin respuesta');
    expect(text.split('\n').find(l => l.includes('o/r#2'))).not.toContain('revisiones por contestar');
  });
});

describe('size of a PR', () => {
  const sized = (number: number, branch: string, additions: number, deletions: number) => pr(number, { branch, additions, deletions, changedFiles: 3 });
  it('flags one far above its task\'s other PRs, or above the fixed limit; small ones and unknown sizes never', () => {
    const a = sized(1, 'ABC-1-a', 120, 30), b = sized(2, 'ABC-1-b', 80, 20), wrong = sized(3, 'ABC-1-c', 1400, 200), other = sized(4, 'ABC-2-x', 2000, 900);
    const prs = [a, b, wrong, other];
    expect(prs.map(p => outsized(p, prs))).toEqual([false, false, true, false]);   // 1600 > 5 × median(150, 100); ABC-2 alone, under the limit
    expect(outsized(sized(5, 'ABC-3-x', SIZE_LIMIT, 1), [])).toBe(true);
    const tiny = [sized(6, 'ABC-4-a', 2, 0), sized(7, 'ABC-4-b', 400, 50)];
    expect(outsized(tiny[1], tiny)).toBe(false);   // 450: under the floor, however small the others
    expect(outsized(pr(8, { branch: 'ABC-1-d' }), prs)).toBe(false);
  });
  it('reads +additions −deletions, thousands shortened, files on request; nothing when GitHub didn\'t say', () => {
    expect(sizeText({ additions: 120, deletions: 30, changedFiles: 4 })).toBe('+120 −30');
    expect(sizeText({ additions: 4210, deletions: 18730, changedFiles: 96 }, true)).toMatch(/^\+4\.2k −19k · 96 /);
    expect(sizeText({})).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { bloqueosEntre, columnaDespliegue, dependenciasEnTexto, taskLinks, olasDespliegue, promptDeployment } from './despliegue';
import type { PRBoard } from './tablero';

const pr = (numero: number, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ numero, titulo: 'PR ' + numero, url: 'https://github.com/o/r/pull/' + numero, repo: 'o/r', rama: 'rama-' + numero, base: 'main', estado: 'abierto', actualizado: 0, ...extra });

describe('dependenciasEnTexto', () => {
  it('lee «depends on», «bloqueado por» y enlaces, con o sin repo, y no toma un # suelto', () => {
    const t = 'Arregla #3.\nDepends on #12 and o/otro#7\nBloqueado por https://github.com/o/r/pull/40\nmerge after: #12';
    expect(dependenciasEnTexto(t, 'o/r')).toEqual(['o/r#12', 'o/otro#7', 'o/r#40']);
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
    expect(dependenciasEnTexto(t, 'refugio/web').sort()).toEqual(['refugio/web#17', 'rama:feature/ABC-16-saltar-filas', 'rama:feature/ABC-15-contratos', 'refugio/web#30', 'rama:ABC-20-migracion', 'refugio/api#40', 'refugio/api#41', 'refugio/api#42'].sort());
  });

  it('una rama nombrada en la descripción bloquea con el PR de esa rama, aunque sea de otro repo', () => {
    const api = pr(1, { repo: 'refugio/api', url: 'https://github.com/refugio/api/pull/1', rama: 'feature/ABC-15-contratos' });
    const web = pr(2, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/2', rama: 'ABC-15-pantalla', dependencias: dependenciasEnTexto('Merge order: `feature/ABC-15-contratos` must be merged first.', 'refugio/web') });
    expect(bloqueosEntre([api, web])).toEqual([{ de: web.url, por: api.url, motivo: 'texto' }]);
  });
});

describe('bloqueosEntre', () => {
  it('apilado (base = rama de otro PR), por la descripción y a mano; lo que apunta fuera del tablero no cuenta', () => {
    const a = pr(1), b = pr(2, { base: 'rama-1' }), c = pr(3, { dependencias: ['o/r#2', 'o/r#99'] }), d = pr(4, { repo: 'o/web', url: 'https://github.com/o/web/pull/4' });
    const bs = bloqueosEntre([a, b, c, d], [{ de: d.url, por: a.url }, { de: d.url, por: 'https://github.com/o/r/pull/99' }]);
    expect(bs.map(x => [x.de.split('/').pop(), x.por.split('/').pop(), x.motivo])).toEqual([['2', '1', 'pila'], ['3', '2', 'texto'], ['4', '1', 'manual']]);
  });
});

describe('olasDespliegue', () => {
  it('cada ola espera a las anteriores; lo fusionado ya no bloquea y un ciclo queda aparte', () => {
    const f = pr(1, { estado: 'fusionado' }), a = pr(2), b = pr(3, { dependencias: ['o/r#1', 'o/r#2'] }), c = pr(4, { dependencias: ['o/r#3'] });
    const x = pr(5, { dependencias: ['o/r#6'] }), y = pr(6, { dependencias: ['o/r#5'] });
    const prs = [f, a, b, c, x, y];
    const r = olasDespliegue(prs, bloqueosEntre(prs));
    expect(r.waves.map(o => o.map(p => p.numero))).toEqual([[2], [3], [4]]);
    expect(r.ciclo.map(p => p.numero)).toEqual([5, 6]);
    expect(promptDeployment(prs, bloqueosEntre(prs))).toContain('Ola 2:\n- o/r#3 «PR 3» · revision · espera a o/r#1 (fusionado), o/r#2');
  });
});

describe('columnaDespliegue', () => {
  it('por estado y revisión; los cerrados sin fusionar, fuera', () => {
    expect([pr(1, { estado: 'borrador' }), pr(2), pr(3, { revision: 'CHANGES_REQUESTED' }), pr(4, { revision: 'APPROVED' }), pr(5, { estado: 'fusionado' }), pr(6, { estado: 'cerrado' })].map(columnaDespliegue))
      .toEqual(['borrador', 'revision', 'cambios', 'aprobado', 'fusionado', null]);
  });
});

describe('misma tarea en repos distintos', () => {
  const api = pr(1, { repo: 'Refugio/API', url: 'https://github.com/refugio/api/pull/1', rama: 'feature/ABC-12-endpoint' });
  const web = pr(7, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/7', rama: 'abc-12-formulario' });
  const otra = pr(8, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/8', rama: 'ABC-99-otra' });
  const withoutKey = [pr(3, { repo: 'refugio/api', url: 'https://github.com/refugio/api/pull/3', rama: 'arreglo' }), pr(3, { repo: 'refugio/web', url: 'https://github.com/refugio/web/pull/3', rama: 'arreglo' })];

  it('el orden del plan de la tarea bloquea el PR del repo que espera (sin distinguir mayúsculas del repo) y va en otra ola', () => {
    const prs = [api, web, otra];
    const bs = bloqueosEntre(prs, [], [{ clave: 'ABC-12', repo: 'refugio/web', waitA: ['refugio/api'] }]);
    expect(bs).toEqual([{ de: web.url, por: api.url, motivo: 'plan' }]);
    expect(olasDespliegue(prs, bs).waves.map(o => o.map(p => p.numero))).toEqual([[1, 8], [7]]);
    expect(taskLinks(prs, bs)).toEqual([]);
  });

  it('sin orden conocido van enlazados sin bloquearse (y el plan pide cuál va primero); PR-N de reserva no junta repos', () => {
    const prs = [api, web, otra, ...withoutKey];
    const bs = bloqueosEntre(prs);
    expect(bs).toEqual([]);
    expect(taskLinks(prs, bs)).toEqual([{ a: api.url, b: web.url, clave: 'ABC-12' }]);
    expect(promptDeployment(prs, bs)).toContain('· misma tarea (ABC-12) que refugio/web#7, sin orden conocido');
  });
});

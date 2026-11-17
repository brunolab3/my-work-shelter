// Lo que se carga en cada sesión cuesta contexto en todas (AGENTS.md, «Lean knowledge»): estos topes lo mantienen
// corto. Si una prueba falla, no subas el tope: arréglalo en código, muévelo a docs/mapa.md (se lee cuando hace falta) o
// recórtalo. Lo que sale bajo demanda (la guía de decorados, el resultado de una herramienta) no cuenta.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TEXTS } from '../shared/textos.ts';
import { ANNEX, bridgeAnnex, annexGit, HIDDEN_SKILLS, withoutWorkConnectors } from '../server/anexo.ts';

const raiz = path.resolve(__dirname, '..');
const largo = (k: string) => Math.max(TEXTS[k].es.length, TEXTS[k].en?.length ?? 0);

describe('contexto de cada sesión', () => {
  it('AGENTS.md (every session in this repo) fits in 1.6 KB: features go in docs/mapa.md', () => {
    expect(Buffer.byteLength(readFileSync(path.join(raiz, 'AGENTS.md'), 'utf8'))).toBeLessThanOrEqual(1600);
    expect(readFileSync(path.join(raiz, 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md');
  });
  it('el anexo de los habitantes (cada conversación del juego) es corto', () => {
    expect(ANNEX.length).toBeLessThanOrEqual(1450);
    expect(bridgeAnnex().length).toBeLessThanOrEqual(320);
    expect(annexGit([]).length).toBeLessThanOrEqual(300);
  });
  it('cada descripción de una herramienta del juego (va en el contexto de cada conversación que la tiene) cabe en 800 caracteres, y la de un parámetro en 250', () => {
    expect(Object.keys(TEXTS).filter(k => k.startsWith('tool.') && /description$/i.test(k) && largo(k) > 800)).toEqual([]);
    expect(Object.keys(TEXTS).filter(k => /^tool\.([a-z]+\.)?param/i.test(k) && largo(k) > 250)).toEqual([]);
  });
  it('las herramientas que lleva toda conversación (salas, comparar, pre-flight), con un refugio de 30 salas, caben en 2,8 KB', () => {
    const salas = Array.from({ length: 30 }, (_, i) => `sala-${i} (Sala del repo ${i})`).join(', ');
    const enviar = Math.max(...(['es', 'en'] as const).map(i => (TEXTS['tool.rooms.description'][i] ?? '').replace('{salas}', salas).length));
    const resto = ['tool.param.room', 'tool.rooms.paramMessage', 'tool.rooms.paramKey', 'tool.rooms.paramThread', 'tool.compare.description', 'tool.compare.paramBase', 'tool.compare.paramUncommitted',
      'tool.compare.paramFolder', 'tool.preflight.estadoDescription', 'tool.preflight.responderDescription'].reduce((n, k) => n + largo(k), 0);
    expect(enviar + resto).toBeLessThanOrEqual(2800);
  });
  it('the claude.ai skills hidden from dwellers use their plugin-qualified name (the plain name is silently ignored)', () => {
    expect(HIDDEN_SKILLS.length).toBeGreaterThan(0);
    for (const n of HIDDEN_SKILLS) expect(n).toMatch(/^anthropic-skills:[a-z-]+$/);
  });
  it('the Command Bridge and the leisure rooms go without the claude.ai work connectors; work rooms keep them', () => {
    expect(['puente', 'discoteca', 'hidroponia', 'galeria', 'chapa'].every(withoutWorkConnectors)).toBe(true);
    expect(['logistica', 'tareas', 'comunicaciones', 'planificacion', 'git', 'camara', 'puerta', 'tienda', 'api-pagos'].some(withoutWorkConnectors)).toBe(false);
  });
});

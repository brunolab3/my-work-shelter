import { describe, it, expect } from 'vitest';
import { generateRecruit, LOOKS, tonesForRepeated, distinctLooks } from './recruits.ts';
import { lookOf } from './appearance.ts';
import { INITIAL_DWELLERS } from './initialShelter.ts';

describe('reclutas', () => {
  it('la misma semilla da el mismo recluta', () => {
    expect(generateRecruit(1234)).toEqual(generateRecruit(1234));
  });
  it('elige el aspecto menos visto del refugio', () => {
    const seen = ['Engineer', 'Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', '4GTN'];
    for (let s = 1; s < 30; s++) expect(generateRecruit(s, [], false, seen).type).toBe('SpaceRanger');
  });
  it('nunca da el modelo del Supervisor (Protagonist_B) a un recluta', () => {
    expect(LOOKS).not.toContain('Protagonist_B');
    for (let s = 1; s < 200; s++) expect(generateRecruit(s, [], false, []).type).not.toBe('Protagonist_B');
  });
  it('usa 4GTN y los modelos que aún no están en el refugio', () => {
    expect(LOOKS).toContain('4GTN');
    const seen = INITIAL_DWELLERS.map(h => h.type);
    expect(LOOKS.some(t => !seen.includes(t))).toBe(true);
    for (let s = 1; s < 30; s++) expect(seen).not.toContain(generateRecruit(s, [], false, seen).type);
  });
  it('con el refugio inicial, hasta llenar los huecos de dos por modelo ningún recluta repite un modelo tres veces', () => {
    const initial = INITIAL_DWELLERS.map(h => h.type);
    const gaps = LOOKS.reduce((n, t) => n + Math.max(0, 2 - initial.filter(x => x === t).length), 0);
    expect(gaps).toBeGreaterThanOrEqual(3);
    for (let base = 1; base < 40; base++) {
      const types = [...initial];
      for (let k = 0; k < gaps; k++) types.push(generateRecruit(base * 97 + k, [], false, types).type);
      const counts = new Map<string, number>(); for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const t of LOOKS) expect(counts.get(t) ?? 0).toBeLessThanOrEqual(2);
    }
  });
  it('no repite un nombre ya usado si puede evitarlo', () => {
    const r = generateRecruit(99, ['adela', 'benito', 'casilda']);
    expect(['adela', 'benito', 'casilda']).not.toContain(r.name.toLowerCase());
  });
});

describe('reclutas que repiten modelo', () => {
  it('llevan otro tono de ropa, distinto también entre sí', () => {
    const types = ['Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', 'SpaceRanger', '4GTN'];
    const a = generateRecruit(11, [], false, types);
    expect(a.tone).toBeGreaterThan(0);
    const b = generateRecruit(12, [], false, [...types, a.type, ...types.filter(t => t !== a.type)]);
    if (b.type === a.type) expect(b.tone).not.toBe(a.tone);
    const newer = generateRecruit(13, [], false, []);
    expect(newer.tone).toBeUndefined();
  });
});

describe('reclutas seguidos', () => {
  it('dos reclutas seguidos no comparten modelo', () => {
    let types = INITIAL_DWELLERS.map(h => h.type);
    for (let i = 0; i < 6; i++) { const r = generateRecruit(100 + i, [], false, types); expect(r.type).not.toBe(types[types.length - 1]); types = [...types, r.type]; }
  });
  it('el Arquitecto lleva el aspecto original aunque llegue el último, y nadie repite tono', () => {
    const hs = tonesForRepeated([{ id: 'marga', type: 'Survivalist' }, { id: 'dora', type: 'Survivalist', tone: 162 }, { id: 'nestor', type: 'Survivalist' }] as { id: string; type: string; tone?: number }[]);
    expect(hs.find(h => h.id === 'nestor')?.tone).toBeUndefined();
    expect(hs.find(h => h.id === 'marga')?.tone).toBeGreaterThan(0);
    expect(hs.find(h => h.id === 'marga')?.tone).not.toBe(162);
  });
  it('nadie lleva la pinta del Supervisor ni la de otro habitante, y el aspecto nuevo es estable', () => {
    const hs = () => [{ id: 'nestor', type: 'Survivalist' }, { id: 'marga', type: 'Hoarder' }, { id: 'ondina', type: 'Hoarder' }, { id: 'dora', type: 'Survivalist' }, { id: 'remi', type: 'Engineer' }, { id: 'mona', type: 'Octocat' }, { id: 'mona2', type: 'Octocat' }] as { id: string; type: string; look?: any }[];
    const a = hs();
    expect(distinctLooks(a, { character: 'Hoarder' })).toBe(true);
    const by = (id: string) => a.find(h => h.id === id)!;
    // la del modelo del Supervisor y las repetidas reciben aspecto propio; las primeras de su modelo y la Octocat, no
    expect(by('marga').look).toBeDefined(); expect(by('ondina').look).toBeDefined(); expect(by('dora').look).toBeDefined();
    expect(by('nestor').look).toBeUndefined(); expect(by('remi').look).toBeUndefined(); expect(by('mona2').look).toBeUndefined();
    const keys = a.filter(h => h.type !== 'Octocat').map(h => JSON.stringify(lookOf(h)));
    expect(new Set([...keys, JSON.stringify(lookOf({ type: 'Hoarder' }))]).size).toBe(keys.length + 1);
    const b = hs(); distinctLooks(b, { character: 'Hoarder' });
    expect(b).toEqual(a);
    expect(distinctLooks(a, { character: 'Hoarder' })).toBe(false);
  });
  it('si el Supervisor lleva el modelo del Arquitecto, el Arquitecto también cambia', () => {
    const a = [{ id: 'nestor', type: 'Survivalist' }] as { id: string; type: string; look?: any }[];
    distinctLooks(a, { character: 'Survivalist' });
    expect(a[0].look).toBeDefined();
  });
});

import { describe, it, expect } from 'vitest';
import { generateRecruit, LOOKS, tonesForRepeated, distinctLooks } from './reclutas.ts';
import { lookOf } from './aspecto.ts';
import { INITIAL_DWELLERS } from './refugioInicial.ts';

describe('reclutas', () => {
  it('la misma semilla da el mismo recluta', () => {
    expect(generateRecruit(1234)).toEqual(generateRecruit(1234));
  });
  it('elige el aspecto menos visto del refugio', () => {
    const seen = ['Engineer', 'Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', '4GTN'];
    for (let s = 1; s < 30; s++) expect(generateRecruit(s, [], false, seen).tipo).toBe('SpaceRanger');
  });
  it('nunca da el modelo del Supervisor (Protagonist_B) a un recluta', () => {
    expect(LOOKS).not.toContain('Protagonist_B');
    for (let s = 1; s < 200; s++) expect(generateRecruit(s, [], false, []).tipo).not.toBe('Protagonist_B');
  });
  it('usa 4GTN y los modelos que aún no están en el refugio', () => {
    expect(LOOKS).toContain('4GTN');
    const seen = INITIAL_DWELLERS.map(h => h.tipo);
    expect(LOOKS.some(t => !seen.includes(t))).toBe(true);
    for (let s = 1; s < 30; s++) expect(seen).not.toContain(generateRecruit(s, [], false, seen).tipo);
  });
  it('con el refugio inicial, hasta llenar los huecos de dos por modelo ningún recluta repite un modelo tres veces', () => {
    const initial = INITIAL_DWELLERS.map(h => h.tipo);
    const huecos = LOOKS.reduce((n, t) => n + Math.max(0, 2 - initial.filter(x => x === t).length), 0);
    expect(huecos).toBeGreaterThanOrEqual(3);
    for (let base = 1; base < 40; base++) {
      const tipos = [...initial];
      for (let k = 0; k < huecos; k++) tipos.push(generateRecruit(base * 97 + k, [], false, tipos).tipo);
      const cuentas = new Map<string, number>(); for (const t of tipos) cuentas.set(t, (cuentas.get(t) ?? 0) + 1);
      for (const t of LOOKS) expect(cuentas.get(t) ?? 0).toBeLessThanOrEqual(2);
    }
  });
  it('no repite un nombre ya usado si puede evitarlo', () => {
    const r = generateRecruit(99, ['adela', 'benito', 'casilda']);
    expect(['adela', 'benito', 'casilda']).not.toContain(r.nombre.toLowerCase());
  });
});

describe('reclutas que repiten modelo', () => {
  it('llevan otro tono de ropa, distinto también entre sí', () => {
    const tipos = ['Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', 'SpaceRanger', '4GTN'];
    const a = generateRecruit(11, [], false, tipos);
    expect(a.tone).toBeGreaterThan(0);
    const b = generateRecruit(12, [], false, [...tipos, a.tipo, ...tipos.filter(t => t !== a.tipo)]);
    if (b.tipo === a.tipo) expect(b.tone).not.toBe(a.tone);
    const nuevo = generateRecruit(13, [], false, []);
    expect(nuevo.tone).toBeUndefined();
  });
});

describe('reclutas seguidos', () => {
  it('dos reclutas seguidos no comparten modelo', () => {
    let tipos = INITIAL_DWELLERS.map(h => h.tipo);
    for (let i = 0; i < 6; i++) { const r = generateRecruit(100 + i, [], false, tipos); expect(r.tipo).not.toBe(tipos[tipos.length - 1]); tipos = [...tipos, r.tipo]; }
  });
  it('el Arquitecto lleva el aspecto original aunque llegue el último, y nadie repite tono', () => {
    const hs = tonesForRepeated([{ id: 'marga', tipo: 'Survivalist' }, { id: 'dora', tipo: 'Survivalist', tone: 162 }, { id: 'nestor', tipo: 'Survivalist' }] as { id: string; tipo: string; tone?: number }[]);
    expect(hs.find(h => h.id === 'nestor')?.tone).toBeUndefined();
    expect(hs.find(h => h.id === 'marga')?.tone).toBeGreaterThan(0);
    expect(hs.find(h => h.id === 'marga')?.tone).not.toBe(162);
  });
  it('nadie lleva la pinta del Supervisor ni la de otro habitante, y el aspecto nuevo es estable', () => {
    const hs = () => [{ id: 'nestor', tipo: 'Survivalist' }, { id: 'marga', tipo: 'Hoarder' }, { id: 'ondina', tipo: 'Hoarder' }, { id: 'dora', tipo: 'Survivalist' }, { id: 'remi', tipo: 'Engineer' }, { id: 'mona', tipo: 'Octocat' }, { id: 'mona2', tipo: 'Octocat' }] as { id: string; tipo: string; aspecto?: any }[];
    const a = hs();
    expect(distinctLooks(a, { personaje: 'Hoarder' })).toBe(true);
    const by = (id: string) => a.find(h => h.id === id)!;
    // la del modelo del Supervisor y las repetidas reciben aspecto propio; las primeras de su modelo y la Octocat, no
    expect(by('marga').aspecto).toBeDefined(); expect(by('ondina').aspecto).toBeDefined(); expect(by('dora').aspecto).toBeDefined();
    expect(by('nestor').aspecto).toBeUndefined(); expect(by('remi').aspecto).toBeUndefined(); expect(by('mona2').aspecto).toBeUndefined();
    const claves = a.filter(h => h.tipo !== 'Octocat').map(h => JSON.stringify(lookOf(h)));
    expect(new Set([...claves, JSON.stringify(lookOf({ tipo: 'Hoarder' }))]).size).toBe(claves.length + 1);
    const b = hs(); distinctLooks(b, { personaje: 'Hoarder' });
    expect(b).toEqual(a);
    expect(distinctLooks(a, { personaje: 'Hoarder' })).toBe(false);
  });
  it('si el Supervisor lleva el modelo del Arquitecto, el Arquitecto también cambia', () => {
    const a = [{ id: 'nestor', tipo: 'Survivalist' }] as { id: string; tipo: string; aspecto?: any }[];
    distinctLooks(a, { personaje: 'Survivalist' });
    expect(a[0].aspecto).toBeDefined();
  });
});

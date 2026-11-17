import { describe, it, expect } from 'vitest';
import {
  PIECES, PIECE, STOCK, SOURCES, HUMAN_SLOTS, SLOTS_ROBOT, REQUIRED, sanitizeLook, lookOf, lookOnRandom, setPiece,
  piecesOf, fits, lookSignature, lookSummary, type Look,
} from './aspecto.ts';
import { INITIAL_DWELLERS, LOOK_GUARDIAN } from './refugioInicial.ts';

const azar = (s: number) => () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };

describe('catálogo de piezas', () => {
  it('ids únicos, de personajes que existen, y mucha variedad', () => {
    expect(new Set(PIECES.map(p => p.id)).size).toBe(PIECES.length);
    for (const p of PIECES) expect(SOURCES[p.fuente], p.id).toBeTruthy();
    const n = (r: string, e: 'humano' | 'robot' = 'humano') => piecesOf(r as any, e).length;
    expect(n('cara')).toBeGreaterThanOrEqual(25);
    expect(n('pelo')).toBeGreaterThanOrEqual(20);
    expect(n('cejas')).toBeGreaterThanOrEqual(15);
    expect(n('barba')).toBeGreaterThanOrEqual(10);
    expect(n('sombrero')).toBeGreaterThanOrEqual(20);
    expect(n('torso')).toBeGreaterThanOrEqual(30);
    expect(n('piernas')).toBeGreaterThanOrEqual(30);
    expect(n('cabeza', 'robot')).toBeGreaterThanOrEqual(10);
    expect(n('torso', 'robot')).toBeGreaterThanOrEqual(40);   // los de robot y la ropa de los humanos
  });
  it('los aspectos de serie son válidos y no cambian al sanearlos', () => {
    for (const [t, a] of Object.entries(STOCK)) expect(lookSignature(sanitizeLook(a)!), t).toBe(lookSignature(a));
  });
});

describe('validación de aspectos', () => {
  it('quita lo que no existe, lo de otra especie o ranura y los colores que no son #rrggbb', () => {
    const a = sanitizeLook({ especie: 'humano', piezas: { cara: 'cara.NoExiste', pelo: 'torso.Knight', torso: 'torso.Knight', cabeza: 'cabeza.Robot_One' }, colores: { piel: 'rojo', pelo: '#A0B0C0', luz: 'url(x)' } })!;
    expect(a.piezas.cara).toBeTruthy(); expect(a.piezas.cara).not.toBe('cara.NoExiste');   // obligatoria: la primera
    expect(a.piezas.pelo).toBeUndefined(); expect(a.piezas.cabeza).toBeUndefined();
    expect(a.piezas.torso).toBe('torso.Knight');
    expect(a.colores).toEqual({ pelo: '#a0b0c0' });
  });
  it('lo que no es un objeto no vale', () => { expect(sanitizeLook(null)).toBeNull(); expect(sanitizeLook('humano')).toBeNull(); });
  it('el esqueleto grande manda: con un torso de Clanker, brazos y piernas de su tamaño', () => {
    const r = setPiece(structuredClone(STOCK.Robot_Two), 'torso', 'torso.Clanker');
    expect(r.piezas.brazos).toBe('brazos.Clanker'); expect(r.piezas.piernas).toBe('piernas.Clanker');
    for (const slot of SLOTS_ROBOT) { const p = r.piezas[slot] ? PIECE.get(r.piezas[slot]!) : null; if (p) expect(fits(p, r.piezas), slot).toBe(true); }
    // y al volver a uno normal, otra vez los suyos
    const n = setPiece(r, 'torso', 'torso.Robot_One');
    expect(n.piezas.brazos).toBe('brazos.Robot_One');
  });
  it('quitar una pieza opcional la quita; una obligatoria no se puede quedar vacía al sanear', () => {
    const a = setPiece(structuredClone(STOCK.Hiker), 'sombrero', null);
    expect(a.piezas.sombrero).toBeUndefined();
    const b = sanitizeLook({ ...a, piezas: { ...a.piezas, torso: '' } })!;
    expect(b.piezas.torso).toBeTruthy();
  });
});

describe('aspectos de los habitantes', () => {
  it('sin aspecto propio, el de serie de su modelo; con tono, otra ropa', () => {
    expect(lookOf({ tipo: 'Engineer' }).piezas.torso).toBe('torso.Engineer');
    const t = lookOf({ tipo: 'Engineer', tone: 137 });
    expect(t.colores.torso1).toMatch(/^#[0-9a-f]{6}$/);
    expect(lookOf({ tipo: 'Robot_One', tone: 90 }).colores.cabeza1).toMatch(/^#/);
  });
  it('al azar: siempre válido, de su especie y variado', () => {
    const seen = new Set<string>();
    for (let s = 1; s < 60; s++) for (const e of ['humano', 'robot'] as const) {
      const a = lookOnRandom(azar(s * 31 + 7), e);
      expect(lookSignature(sanitizeLook(a)!)).toBe(lookSignature(a));
      for (const r of REQUIRED) if ((e === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS).includes(r)) expect(a.piezas[r], r).toBeTruthy();
      seen.add(lookSignature(a));
    }
    expect(seen.size).toBeGreaterThan(110);
    expect(lookSummary(lookOnRandom(azar(5), 'robot'))).toMatch(/^robot: /);
  });
  it('el guardián de la puerta es un androide por piezas', () => {
    const g = INITIAL_DWELLERS.find(h => h.id === 'guardian')!;
    expect(g.aspecto?.especie).toBe('robot');
    expect(sanitizeLook(LOOK_GUARDIAN)).toBeTruthy();
  });
  it('la Octocat no tiene aspecto por piezas', () => {
    const m = INITIAL_DWELLERS.find(h => h.id === 'mona')!;
    expect(m.tipo).toBe('Octocat'); expect(m.aspecto).toBeUndefined();
  });
});

// (un aspecto de ejemplo con todo puesto también sale bien por el resumen)
const completo: Look = { especie: 'humano', piezas: { cara: 'cara.Hiker', pelo: 'pelo.Mage', barba: 'barba.Ranger', torso: 'torso.Knight', brazos: 'brazos.Knight', piernas: 'piernas.Knight', sombrero: 'sombrero.Witch.Hat', gafas: 'gafas.Driver.Sunglasses' }, colores: {} };
it('resumen de un aspecto', () => { expect(lookSummary(completo)).toBe('humano: melena lisa, perilla, armadura, sombrero de bruja, gafas de sol'); });

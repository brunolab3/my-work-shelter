import { describe, it, expect } from 'vitest';
import {
  PIECES, PIECE, STOCK, SOURCES, HUMAN_SLOTS, SLOTS_ROBOT, REQUIRED, sanitizeLook, lookOf, lookOnRandom, setPiece,
  piecesOf, fits, lookSignature, lookSummary, type Look,
} from './appearance.ts';
import { INITIAL_DWELLERS, LOOK_GUARDIAN } from './initialShelter.ts';

const random = (s: number) => () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };

describe('catálogo de piezas', () => {
  it('ids únicos, de personajes que existen, y mucha variedad', () => {
    expect(new Set(PIECES.map(p => p.id)).size).toBe(PIECES.length);
    for (const p of PIECES) expect(SOURCES[p.source], p.id).toBeTruthy();
    const n = (r: string, e: 'human' | 'robot' = 'human') => piecesOf(r as any, e).length;
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
    const a = sanitizeLook({ especie: 'human', pieces: { cara: 'cara.NoExiste', pelo: 'torso.Knight', torso: 'torso.Knight', cabeza: 'cabeza.Robot_One' }, colors: { piel: 'red', pelo: '#A0B0C0', light: 'url(x)' } })!;
    expect(a.pieces.cara).toBeTruthy(); expect(a.pieces.cara).not.toBe('cara.NoExiste');   // obligatoria: la primera
    expect(a.pieces.pelo).toBeUndefined(); expect(a.pieces.cabeza).toBeUndefined();
    expect(a.pieces.torso).toBe('torso.Knight');
    expect(a.colors).toEqual({ pelo: '#a0b0c0' });
  });
  it('lo que no es un objeto no vale', () => { expect(sanitizeLook(null)).toBeNull(); expect(sanitizeLook('human')).toBeNull(); });
  it('el esqueleto grande manda: con un torso de Clanker, brazos y piernas de su tamaño', () => {
    const r = setPiece(structuredClone(STOCK.Robot_Two), 'torso', 'torso.Clanker');
    expect(r.pieces.brazos).toBe('brazos.Clanker'); expect(r.pieces.piernas).toBe('piernas.Clanker');
    for (const slot of SLOTS_ROBOT) { const p = r.pieces[slot] ? PIECE.get(r.pieces[slot]!) : null; if (p) expect(fits(p, r.pieces), slot).toBe(true); }
    // y al volver a uno normal, otra vez los suyos
    const n = setPiece(r, 'torso', 'torso.Robot_One');
    expect(n.pieces.brazos).toBe('brazos.Robot_One');
  });
  it('quitar una pieza opcional la quita; una obligatoria no se puede quedar vacía al sanear', () => {
    const a = setPiece(structuredClone(STOCK.Hiker), 'sombrero', null);
    expect(a.pieces.sombrero).toBeUndefined();
    const b = sanitizeLook({ ...a, pieces: { ...a.pieces, torso: '' } })!;
    expect(b.pieces.torso).toBeTruthy();
  });
});

describe('aspectos de los habitantes', () => {
  it('sin aspecto propio, el de serie de su modelo; con tono, otra ropa', () => {
    expect(lookOf({ type: 'Engineer' }).pieces.torso).toBe('torso.Engineer');
    const t = lookOf({ type: 'Engineer', tone: 137 });
    expect(t.colors.torso1).toMatch(/^#[0-9a-f]{6}$/);
    expect(lookOf({ type: 'Robot_One', tone: 90 }).colors.cabeza1).toMatch(/^#/);
  });
  it('al azar: siempre válido, de su especie y variado', () => {
    const seen = new Set<string>();
    for (let s = 1; s < 60; s++) for (const e of ['human', 'robot'] as const) {
      const a = lookOnRandom(random(s * 31 + 7), e);
      expect(lookSignature(sanitizeLook(a)!)).toBe(lookSignature(a));
      for (const r of REQUIRED) if ((e === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS).includes(r)) expect(a.pieces[r], r).toBeTruthy();
      seen.add(lookSignature(a));
    }
    expect(seen.size).toBeGreaterThan(110);
    expect(lookSummary(lookOnRandom(random(5), 'robot'))).toMatch(/^robot: /);
  });
  it('el guardián de la puerta es un androide por piezas', () => {
    const g = INITIAL_DWELLERS.find(h => h.id === 'guardian')!;
    expect(g.look?.especie).toBe('robot');
    expect(sanitizeLook(LOOK_GUARDIAN)).toBeTruthy();
  });
  it('la Octocat no tiene aspecto por piezas', () => {
    const m = INITIAL_DWELLERS.find(h => h.id === 'mona')!;
    expect(m.type).toBe('Octocat'); expect(m.look).toBeUndefined();
  });
});

// (un aspecto de ejemplo con todo puesto también sale bien por el resumen)
const full: Look = { especie: 'human', pieces: { cara: 'cara.Hiker', pelo: 'pelo.Mage', barba: 'barba.Ranger', torso: 'torso.Knight', brazos: 'brazos.Knight', piernas: 'piernas.Knight', sombrero: 'sombrero.Witch.Hat', gafas: 'gafas.Driver.Sunglasses' }, colors: {} };
it('resumen de un aspecto', () => { expect(lookSummary(full)).toBe('humano: melena lisa, perilla, armadura, sombrero de bruja, gafas de sol'); });

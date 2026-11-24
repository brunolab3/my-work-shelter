import { describe, it, expect } from 'vitest';
import { sanitizeDecor, reviewDecor, baseStock, propsPath, isModelProps, decorSignature, templateOf, boardSpot, panelSpot } from './decor';

describe('decorado de una sala', () => {
  it('sin base válida no hay decorado', () => {
    expect(sanitizeDecor(null).decor).toBeNull();
    expect(sanitizeDecor({ base: 'castillo' }).decor).toBeNull();
    expect(sanitizeDecor({ base: 'empty' }).decor).toEqual({ version: 1, base: 'empty' });
  });
  it('recorta lo que se sale de la sala y lo avisa', () => {
    const { decor, notices } = sanitizeDecor({ base: 'empty', light: 9, pieces: [{ model: 'mueble/desk', x: 40, z: -9, rotation: -90 }] });
    expect(decor!.light).toBe(1.4);
    expect(decor!.pieces![0]).toMatchObject({ x: 5.8, z: -2.25, rotation: 270 });
    expect(notices.length).toBeGreaterThanOrEqual(3);
  });
  it('solo modelos del catálogo, sin rutas ni packs inventados', () => {
    for (const m of ['../../etc/passwd', 'mueble/../x', 'http://x/y', 'otro/desk', 'mueble/', '']) expect(isModelProps(m)).toBe(false);
    expect(isModelProps('cy/Computer_Large')).toBe(true);
    expect(propsPath('mueble/desk')).toBe('kaykit-extra/furniture-bits-1.0/Assets/gltf/desk.gltf');
    expect(propsPath('sf/Props_ComputerSmall')).toBe('quaternius/modular_sci_fi/Props_ComputerSmall.glb');
    expect(propsPath('mueble/../../x')).toBeNull();
    const { decor, notices } = sanitizeDecor({ base: 'empty', pieces: [{ model: '../../x', x: 0, z: 0 }, { model: 'mueble/desk', x: 0, z: 0 }] });
    expect(decor!.pieces).toHaveLength(1);
    expect(notices.join(' ')).toMatch(/pieces\[0\]/);
  });
  it('«sobre» apunta a una pieza anterior y sigue bien aunque se descarte una de en medio', () => {
    const { decor } = sanitizeDecor({ base: 'empty', pieces: [{ model: 'none', x: 0, z: 0 }, { model: 'mueble/desk', x: 0, z: 0 }, { model: 'mueble/lamp_desk', x: 0, z: 0, restsOn: 1 }, { model: 'mueble/mug_A', x: 0, z: 0, restsOn: 5 }] });
    expect(decor!.pieces!.map(p => p.restsOn)).toEqual([undefined, 0, undefined]);
  });
  it('los textos van en una línea, sin caracteres invisibles ni de control, y recortados', () => {
    const { decor } = sanitizeDecor({ base: 'taller', subtitle: 'la fragua‮ de\u0007 datos con un nombre larguísimo', signs: [{ x: 0, y: 2, width: 0.6, title: 'T', lines: ['UNO\nDOS', 'X'.repeat(40)] }] });
    expect(decor!.subtitle).toBe('LA FRAGUA DE DATOS CON U');
    expect(decor!.signs![0].lines).toEqual(['UNO DOS', 'XXXXXXXXXXXX']);
    expect(sanitizeDecor({ base: 'empty', signs: [{ x: 0, y: 2, width: 0.6, title: 'T', lines: ['PR BIENVENIDOS'] }] }).notices.join(' ')).toMatch(/signs\[0\]\.lineas\[0\].*caben 12/);
  });
  it('carteles, enteros dentro de la pared; las pantallas decorativas ya no van (la de la sala es su tablero de tareas)', () => {
    const { decor, notices } = sanitizeDecor({ base: 'empty', signs: [{ x: 6, y: 9, width: 1, title: 'x', lines: ['a'] }], screens: [{ x: 0, y: 2, width: 3, title: 'x', lines: ['a'] }] });
    const c = decor!.signs![0];
    expect(c.x + c.width / 2).toBeLessThanOrEqual(5.8);
    expect(c.y + c.width * 720 / 512 / 2).toBeLessThanOrEqual(3.6 + 1e-3);
    expect((decor as any).screens).toBeUndefined();
    expect(notices.filter(a => /pantallas decorativas|decorative screens/i.test(a)).length).toBe(1);
  });
  it('the task board and the desk: fixed in the middle of every room; a dressing that places them is told so', () => {
    for (const base of ['studio', 'brand', 'empty'] as const) expect(boardSpot(base, 'x')).toMatchObject({ x: 0, width: 3.2 });
    const b = boardSpot();
    expect(b.y - b.height / 2).toBeGreaterThan(1.8); expect(b.y + b.height / 2).toBeLessThanOrEqual(3.4);
    const { decor, notices } = sanitizeDecor({ base: 'empty', repoScreen: { x: 5.5, y: 3.05, width: 1.3 }, workstation: { x: 4, z: -1, screen: 'dual' } });
    expect(decor).not.toHaveProperty('pantallaRepo');
    expect(decor!.workstation).toEqual({ screen: 'dual' });
    expect(notices.some(a => /sitio fijo|fixed spot/.test(a))).toBe(true);
  });
  it('la revisión avisa de lo que tapa el tablero: piezas junto a la pared y carteles; lo que queda delante, no', () => {
    const size = () => [1, 2.6, 0.6] as [number, number, number];
    const board = boardSpot('empty', 'x');
    const { decor } = sanitizeDecor({ base: 'empty', pieces: [{ model: 'cy/Computer_Large', x: 0.5, z: -2 }, { model: 'cy/Computer_Large', x: 0.5, z: 0.4 }, { model: 'cy/Computer_Large', x: 4.6, z: -2 }],
      signs: [{ x: 0, y: 2.6, width: 0.6, title: 'T', lines: ['A'] }, { x: -4.5, y: 2.6, width: 0.6, title: 'T', lines: ['A'] }] });
    const notices = reviewDecor(decor!, size, board).filter(a => /tapa el tablero|covers the room/i.test(a));
    expect(notices.length).toBe(2);
    expect(notices.join(' ')).toMatch(/pieces\[0\]/);
    expect(notices.join(' ')).toMatch(/signs\[0\]/);
  });
  it('the work zone and the room panel: floor pieces there get a warning; on the sides, high up or on another piece, not', () => {
    expect(panelSpot('left').x).toBeGreaterThan(4.5); expect(panelSpot('right').x).toBe(-panelSpot('left').x);
    const p = panelSpot('right');
    const { decor } = sanitizeDecor({ base: 'empty', pieces: [{ model: 'mueble/shelf', x: 0.8, z: -1.5 }, { model: 'mueble/shelf', x: p.x, z: p.z }, { model: 'mueble/shelf', x: -3.5, z: -1.5 }, { model: 'mueble/lamp', x: 0, z: 0, y: 3.6 }, { model: 'mueble/mug', x: -3.5, z: -1.5, restsOn: 2 }] });
    const notices = reviewDecor(decor!, () => [0.8, 0.5, 0.4], undefined, 'right').filter(a => /zona de trabajo|work zone|panel de la sala|room panel/i.test(a));
    expect(notices.length).toBe(2);
    expect(notices.join(' ')).toMatch(/pieces\[0\].*pieces\[1\]/);
  });
  it('la revisión ve lo que se atraviesa, invade el pasillo o no está en el catálogo', () => {
    const size = (p: { model: string }) => (p.model === 'mueble/desk' ? [2, 0.8, 1] as [number, number, number] : p.model === 'cy/Computer_Large' ? [1.3, 2.4, 0.7] as [number, number, number] : null);
    const { decor } = sanitizeDecor({ base: 'empty', pieces: [{ model: 'mueble/desk', x: 0, z: -1 }, { model: 'mueble/desk', x: 0.5, z: -1 }, { model: 'cy/Computer_Large', x: 3, z: 1.5 }, { model: 'casa/Nada', x: -3, z: -1 }] });
    const notices = reviewDecor(decor!, size).join('\n');
    expect(notices).toMatch(/pieces\[0\].*pieces\[1\].*se atraviesan/);
    expect(notices).toMatch(/pieces\[2\].*pasillo/);
    expect(notices).toMatch(/pieces\[3\].*catálogo/);
  });
  it('la escena de serie: la de su estilo o la de su tipo de repo', () => {
    expect(baseStock({ type: 'repo', style: 'foundry' })).toBe('foundry');
    expect(baseStock({ type: 'repo', style: 'video' })).toBe('projection');
    expect(baseStock({ type: 'repo', style: 'web' }, { type: 'web Next.js' })).toBe('studio');
    expect(baseStock({ type: 'repo', style: 'generic' }, { type: 'python' })).toBe('lab');
    expect(baseStock({ type: 'coordination' })).toBe('archive');
    expect(templateOf('folder', true)).toBe('archive');
    expect(templateOf('vídeo', true)).toBe('taller');
  });
  it('la firma cambia con el decorado', () => {
    const a = sanitizeDecor({ base: 'empty', light: 1 }).decor, b = sanitizeDecor({ base: 'empty', light: 0.9 }).decor;
    expect(decorSignature(a)).not.toBe(decorSignature(b));
    expect(decorSignature(undefined)).toBe('');
  });
});

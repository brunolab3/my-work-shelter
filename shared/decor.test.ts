import { describe, it, expect } from 'vitest';
import { sanitizeDecor, reviewDecor, baseStock, propsPath, isModelProps, decorSignature, templateOf, boardSpot, panelSpot } from './decor';

describe('decorado de una sala', () => {
  it('sin base válida no hay decorado', () => {
    expect(sanitizeDecor(null).decorado).toBeNull();
    expect(sanitizeDecor({ base: 'castillo' }).decorado).toBeNull();
    expect(sanitizeDecor({ base: 'vacia' }).decorado).toEqual({ version: 1, base: 'vacia' });
  });
  it('recorta lo que se sale de la sala y lo avisa', () => {
    const { decorado, avisos } = sanitizeDecor({ base: 'vacia', luz: 9, piezas: [{ modelo: 'mueble/desk', x: 40, z: -9, giro: -90 }] });
    expect(decorado!.luz).toBe(1.4);
    expect(decorado!.piezas![0]).toMatchObject({ x: 5.8, z: -2.25, giro: 270 });
    expect(avisos.length).toBeGreaterThanOrEqual(3);
  });
  it('solo modelos del catálogo, sin rutas ni packs inventados', () => {
    for (const m of ['../../etc/passwd', 'mueble/../x', 'http://x/y', 'otro/desk', 'mueble/', '']) expect(isModelProps(m)).toBe(false);
    expect(isModelProps('cy/Computer_Large')).toBe(true);
    expect(propsPath('mueble/desk')).toBe('kaykit-extra/furniture-bits-1.0/Assets/gltf/desk.gltf');
    expect(propsPath('sf/Props_ComputerSmall')).toBe('quaternius/modular_sci_fi/Props_ComputerSmall.glb');
    expect(propsPath('mueble/../../x')).toBeNull();
    const { decorado, avisos } = sanitizeDecor({ base: 'vacia', piezas: [{ modelo: '../../x', x: 0, z: 0 }, { modelo: 'mueble/desk', x: 0, z: 0 }] });
    expect(decorado!.piezas).toHaveLength(1);
    expect(avisos.join(' ')).toMatch(/piezas\[0\]/);
  });
  it('«sobre» apunta a una pieza anterior y sigue bien aunque se descarte una de en medio', () => {
    const { decorado } = sanitizeDecor({ base: 'vacia', piezas: [{ modelo: 'nada', x: 0, z: 0 }, { modelo: 'mueble/desk', x: 0, z: 0 }, { modelo: 'mueble/lamp_desk', x: 0, z: 0, sobre: 1 }, { modelo: 'mueble/mug_A', x: 0, z: 0, sobre: 5 }] });
    expect(decorado!.piezas!.map(p => p.sobre)).toEqual([undefined, 0, undefined]);
  });
  it('los textos van en una línea, sin caracteres invisibles ni de control, y recortados', () => {
    const { decorado } = sanitizeDecor({ base: 'taller', subtitulo: 'la fragua‮ de\u0007 datos con un nombre larguísimo', carteles: [{ x: 0, y: 2, ancho: 0.6, titulo: 'T', lineas: ['UNO\nDOS', 'X'.repeat(40)] }] });
    expect(decorado!.subtitulo).toBe('LA FRAGUA DE DATOS CON U');
    expect(decorado!.carteles![0].lineas).toEqual(['UNO DOS', 'XXXXXXXXXXXX']);
    expect(sanitizeDecor({ base: 'vacia', carteles: [{ x: 0, y: 2, ancho: 0.6, titulo: 'T', lineas: ['PR BIENVENIDOS'] }] }).avisos.join(' ')).toMatch(/carteles\[0\]\.lineas\[0\].*caben 12/);
  });
  it('carteles, enteros dentro de la pared; las pantallas decorativas ya no van (la de la sala es su tablero de tareas)', () => {
    const { decorado, avisos } = sanitizeDecor({ base: 'vacia', carteles: [{ x: 6, y: 9, ancho: 1, titulo: 'x', lineas: ['a'] }], pantallas: [{ x: 0, y: 2, ancho: 3, titulo: 'x', lineas: ['a'] }] });
    const c = decorado!.carteles![0];
    expect(c.x + c.ancho / 2).toBeLessThanOrEqual(5.8);
    expect(c.y + c.ancho * 720 / 512 / 2).toBeLessThanOrEqual(3.6 + 1e-3);
    expect((decorado as any).pantallas).toBeUndefined();
    expect(avisos.filter(a => /pantallas decorativas|decorative screens/i.test(a)).length).toBe(1);
  });
  it('the task board and the desk: fixed in the middle of every room; a dressing that places them is told so', () => {
    for (const base of ['estudio', 'marca', 'vacia'] as const) expect(boardSpot(base, 'x')).toMatchObject({ x: 0, ancho: 3.2 });
    const b = boardSpot();
    expect(b.y - b.alto / 2).toBeGreaterThan(1.8); expect(b.y + b.alto / 2).toBeLessThanOrEqual(3.4);
    const { decorado, avisos } = sanitizeDecor({ base: 'vacia', pantallaRepo: { x: 5.5, y: 3.05, ancho: 1.3 }, puesto: { x: 4, z: -1, pantalla: 'doble' } });
    expect(decorado).not.toHaveProperty('pantallaRepo');
    expect(decorado!.puesto).toEqual({ pantalla: 'doble' });
    expect(avisos.some(a => /sitio fijo|fixed spot/.test(a))).toBe(true);
  });
  it('la revisión avisa de lo que tapa el tablero: piezas junto a la pared y carteles; lo que queda delante, no', () => {
    const tam = () => [1, 2.6, 0.6] as [number, number, number];
    const tablero = boardSpot('vacia', 'x');
    const { decorado } = sanitizeDecor({ base: 'vacia', piezas: [{ modelo: 'cy/Computer_Large', x: 0.5, z: -2 }, { modelo: 'cy/Computer_Large', x: 0.5, z: 0.4 }, { modelo: 'cy/Computer_Large', x: 4.6, z: -2 }],
      carteles: [{ x: 0, y: 2.6, ancho: 0.6, titulo: 'T', lineas: ['A'] }, { x: -4.5, y: 2.6, ancho: 0.6, titulo: 'T', lineas: ['A'] }] });
    const avisos = reviewDecor(decorado!, tam, tablero).filter(a => /tapa el tablero|covers the room/i.test(a));
    expect(avisos.length).toBe(2);
    expect(avisos.join(' ')).toMatch(/piezas\[0\]/);
    expect(avisos.join(' ')).toMatch(/carteles\[0\]/);
  });
  it('the work zone and the room panel: floor pieces there get a warning; on the sides, high up or on another piece, not', () => {
    expect(panelSpot('izq').x).toBeGreaterThan(4.5); expect(panelSpot('der').x).toBe(-panelSpot('izq').x);
    const p = panelSpot('der');
    const { decorado } = sanitizeDecor({ base: 'vacia', piezas: [{ modelo: 'mueble/shelf', x: 0.8, z: -1.5 }, { modelo: 'mueble/shelf', x: p.x, z: p.z }, { modelo: 'mueble/shelf', x: -3.5, z: -1.5 }, { modelo: 'mueble/lamp', x: 0, z: 0, y: 3.6 }, { modelo: 'mueble/mug', x: -3.5, z: -1.5, sobre: 2 }] });
    const avisos = reviewDecor(decorado!, () => [0.8, 0.5, 0.4], undefined, 'der').filter(a => /zona de trabajo|work zone|panel de la sala|room panel/i.test(a));
    expect(avisos.length).toBe(2);
    expect(avisos.join(' ')).toMatch(/piezas\[0\].*piezas\[1\]/);
  });
  it('la revisión ve lo que se atraviesa, invade el pasillo o no está en el catálogo', () => {
    const tam = (p: { modelo: string }) => (p.modelo === 'mueble/desk' ? [2, 0.8, 1] as [number, number, number] : p.modelo === 'cy/Computer_Large' ? [1.3, 2.4, 0.7] as [number, number, number] : null);
    const { decorado } = sanitizeDecor({ base: 'vacia', piezas: [{ modelo: 'mueble/desk', x: 0, z: -1 }, { modelo: 'mueble/desk', x: 0.5, z: -1 }, { modelo: 'cy/Computer_Large', x: 3, z: 1.5 }, { modelo: 'casa/Nada', x: -3, z: -1 }] });
    const avisos = reviewDecor(decorado!, tam).join('\n');
    expect(avisos).toMatch(/piezas\[0\].*piezas\[1\].*se atraviesan/);
    expect(avisos).toMatch(/piezas\[2\].*pasillo/);
    expect(avisos).toMatch(/piezas\[3\].*catálogo/);
  });
  it('la escena de serie: la de su estilo o la de su tipo de repo', () => {
    expect(baseStock({ tipo: 'repo', estilo: 'fundicion' })).toBe('fundicion');
    expect(baseStock({ tipo: 'repo', estilo: 'video' })).toBe('proyeccion');
    expect(baseStock({ tipo: 'repo', estilo: 'web' }, { tipo: 'web Next.js' })).toBe('estudio');
    expect(baseStock({ tipo: 'repo', estilo: 'generico' }, { tipo: 'python' })).toBe('laboratorio');
    expect(baseStock({ tipo: 'coordinacion' })).toBe('archivo');
    expect(templateOf('carpeta', true)).toBe('archivo');
    expect(templateOf('vídeo', true)).toBe('taller');
  });
  it('la firma cambia con el decorado', () => {
    const a = sanitizeDecor({ base: 'vacia', luz: 1 }).decorado, b = sanitizeDecor({ base: 'vacia', luz: 0.9 }).decorado;
    expect(decorSignature(a)).not.toBe(decorSignature(b));
    expect(decorSignature(undefined)).toBe('');
  });
});

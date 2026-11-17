import { describe, it, expect } from 'vitest';
import { distribute, floorCaption, alphabeticalOrder, REPOS_BY_FLOOR, placeRoom, moveFloor, disposicionDeSerie } from './disposicion.ts';
import { INITIAL_ROOMS } from './refugioInicial.ts';

const sitio = (s: { planta: number; lado: string; orden: number }) => `${s.planta}${s.lado}${s.orden}`;
const repo = (nombre: string) => ({ id: nombre, tipo: 'repo', nombre });
// el refugio de serie ya no trae salas de repo: aquí, con cuatro, como uno que ya ha tomado su raíz de repos
const SERIE = distribute([...INITIAL_ROOMS, ...['express', 'requests', 'ripgrep', 'awesome'].map(repo)] as any[]) as any[];

describe('disposición del refugio', () => {
  it('sin salas de repo de serie, el ocio sube a la planta de debajo de la planificación', () => {
    expect(INITIAL_ROOMS.some(s => s.tipo === 'repo')).toBe(false);
    expect(INITIAL_ROOMS.find(s => s.id === 'galeria')!.planta).toBe(3);
  });
  it('la inicial: PB puerta; -1 cámara acorazada | Puente de Mando; -2 comunicaciones, planificación | logística, control de versiones; -3 repos; -4 cultivos, discoteca | galería de tiro', () => {
    const en = (id: string) => sitio(SERIE.find(s => s.id === id)!);
    expect(SERIE.filter(s => s.planta === 0).map(s => s.id)).toEqual(['puerta']);
    expect(en('puerta')).toBe('0izq0');
    expect([en('camara'), en('puente')]).toEqual(['1izq0', '1der0']);
    expect([en('comunicaciones'), en('planificacion'), en('logistica'), en('git'), en('tareas')]).toEqual(['2izq1', '2izq0', '2der0', '2der1', '2der2']);
    // repos de izquierda a derecha por orden alfabético
    expect([en('awesome'), en('express'), en('requests'), en('ripgrep')]).toEqual(['3izq1', '3izq0', '3der0', '3der1']);
    expect([en('hidroponia'), en('discoteca'), en('galeria'), en('chapa')]).toEqual(['4izq1', '4izq0', '4der0', '4der1']);
  });
  it('un recluta nuevo entra por orden alfabético y nadie comparte hueco', () => {
    const s = distribute([...SERIE, repo('Banco')]);
    const fila = s.filter(x => x.planta === 3).sort((a, b) => (a.lado === b.lado ? (a.lado === 'izq' ? b.orden - a.orden : a.orden - b.orden) : a.lado === 'izq' ? -1 : 1)).map(x => x.nombre);
    expect(fila).toEqual(['awesome', 'Banco', 'express', 'requests', 'ripgrep']);
    expect(new Set(s.map(sitio)).size).toBe(s.length);
    expect(s.find(x => x.id === 'galeria')!.planta).toBe(4);
  });
  it('con más repos de los que caben, siguen en la planta de debajo y el ocio baja con ellos', () => {
    const s = distribute([...SERIE, ...Array.from({ length: REPOS_BY_FLOOR }, (_, i) => repo('z' + i))]);
    expect(s.filter(x => x.planta === 3)).toHaveLength(REPOS_BY_FLOOR);
    expect(s.find(x => x.id === 'galeria')!.planta).toBe(5);
    expect(new Set(s.map(sitio)).size).toBe(s.length);
  });
  it('rótulos de planta', () => {
    expect([0, 1, 4].map(floorCaption)).toEqual(['PB', '-1', '-4']);
  });
  it('el número de las placas sigue el orden alfabético, sin mayúsculas ni tildes de por medio', () => {
    expect(['zeta', 'Banco', 'árbol', 'app10', 'app9'].map(repo).sort(alphabeticalOrder).map(r => r.nombre)).toEqual(['app9', 'app10', 'árbol', 'Banco', 'zeta']);
  });
});

describe('disposición a mano (obras desde el plano)', () => {
  const base = distribute(SERIE);
  const en = (salas: any[], id: string) => sitio(salas.find(s => s.id === id)!);
  const unique = (salas: any[]) => expect(new Set(salas.map(sitio)).size).toBe(salas.length);

  it('una sala soltada en un hueco ocupado entra ahí y las demás se apartan hacia fuera', () => {
    const a = placeRoom(base, 'logistica', { planta: 2, lado: 'izq', orden: 0 })!;   // cruza el ascensor
    expect([en(a, 'logistica'), en(a, 'planificacion'), en(a, 'comunicaciones'), en(a, 'git')]).toEqual(['2izq0', '2izq1', '2izq2', '2der0']);
    expect(a.every((s: any) => s.manual)).toBe(true);
    unique(a);
  });
  it('en un hueco libre al final de otra planta, queda pegada a la última sala de ese lado', () => {
    const a = placeRoom(base, 'git', { planta: 3, lado: 'der', orden: 5 })!;
    expect(en(a, 'git')).toBe('3der2');
    expect(a.filter(s => s.planta === 2)).toHaveLength(4);
    unique(a);
  });
  it('en una franja entre plantas abre una planta nueva y las de debajo bajan una', () => {
    const a = placeRoom(base, 'galeria', { planta: 2, lado: 'der', orden: 0, nueva: true })!;
    expect(en(a, 'galeria')).toBe('2der0');
    expect([en(a, 'logistica'), en(a, 'requests'), en(a, 'chapa')]).toEqual(['3der0', '4der0', '5der0']);
    unique(a);
  });
  it('la planta que se queda vacía desaparece', () => {
    let s = placeRoom(base, 'camara', { planta: 2, lado: 'izq', orden: 0 })!;
    s = placeRoom(s, 'puente', { planta: 2, lado: 'der', orden: 0 })!;
    expect(s.find(x => x.id === 'logistica')!.planta).toBe(1);
    expect(Math.max(...s.map(x => x.planta))).toBe(3);
    unique(s);
  });
  it('la puerta no se mueve y nadie más entra en la PB', () => {
    expect(placeRoom(base, 'puerta', { planta: 1, lado: 'izq', orden: 0 })).toBeNull();
    expect(placeRoom(base, 'camara', { planta: 0, lado: 'der', orden: 0 })).toBeNull();
  });
  it('una planta arrastrada a otra altura: las de en medio se corren una', () => {
    const a = moveFloor(base, 1, 3)!;
    expect([en(a, 'camara'), en(a, 'logistica'), en(a, 'requests'), en(a, 'puerta')]).toEqual(['3izq0', '1der0', '2der0', '0izq0']);
    expect(moveFloor(base, 1, 0)).toBeNull();
  });
  it('a mano, el sitio se conserva al recalcular y un recluta nuevo entra en la última planta con repos', () => {
    const a = moveFloor(base, 1, 2)!;
    const b = distribute([...a, { ...repo('Banco'), planta: 0, lado: 'izq' as const, orden: 0 }]);
    expect(en(b, 'camara')).toBe('2izq0');
    expect(b.find(s => s.id === 'Banco')!.planta).toBe(3);
    unique(b);
  });
  it('la disposición de serie lo devuelve todo a su sitio', () => {
    const a = disposicionDeSerie(moveFloor(base, 1, 2)!);
    expect(a.map(sitio)).toEqual(base.map(sitio));
    expect(a.some((s: any) => s.manual)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { distribute, floorCaption, alphabeticalOrder, REPOS_BY_FLOOR, placeRoom, moveFloor, defaultLayout } from './layout.ts';
import { INITIAL_ROOMS } from './initialShelter.ts';

const spot = (s: { floor: number; side: string; orden: number }) => `${s.floor}${s.side}${s.orden}`;
const repo = (name: string) => ({ id: name, type: 'repo', name });
// el refugio de serie ya no trae salas de repo: aquí, con cuatro, como uno que ya ha tomado su raíz de repos
const SERIES = distribute([...INITIAL_ROOMS, ...['express', 'requests', 'ripgrep', 'awesome'].map(repo)] as any[]) as any[];

describe('disposición del refugio', () => {
  it('sin salas de repo de serie, el ocio sube a la planta de debajo de la planificación', () => {
    expect(INITIAL_ROOMS.some(s => s.type === 'repo')).toBe(false);
    expect(INITIAL_ROOMS.find(s => s.id === 'gallery')!.floor).toBe(3);
  });
  it('la inicial: PB puerta; -1 cámara acorazada | Puente de Mando; -2 comunicaciones, planificación | logística, control de versiones; -3 repos; -4 cultivos, discoteca | galería de tiro', () => {
    const en = (id: string) => spot(SERIES.find(s => s.id === id)!);
    expect(SERIES.filter(s => s.floor === 0).map(s => s.id)).toEqual(['gate']);
    expect(en('gate')).toBe('0left0');
    expect([en('vault'), en('bridge')]).toEqual(['1left0', '1right0']);
    expect([en('comms'), en('calendar'), en('logistics'), en('git'), en('tareas')]).toEqual(['2left1', '2left0', '2right0', '2right1', '2right2']);
    // repos de izquierda a derecha por orden alfabético
    expect([en('awesome'), en('express'), en('requests'), en('ripgrep')]).toEqual(['3left1', '3left0', '3right0', '3right1']);
    expect([en('hydroponics'), en('disco'), en('gallery'), en('bodyshop')]).toEqual(['4left1', '4left0', '4right0', '4right1']);
  });
  it('un recluta nuevo entra por orden alfabético y nadie comparte hueco', () => {
    const s = distribute([...SERIES, repo('Banco')]);
    const row = s.filter(x => x.floor === 3).sort((a, b) => (a.side === b.side ? (a.side === 'left' ? b.orden - a.orden : a.orden - b.orden) : a.side === 'left' ? -1 : 1)).map(x => x.name);
    expect(row).toEqual(['awesome', 'Banco', 'express', 'requests', 'ripgrep']);
    expect(new Set(s.map(spot)).size).toBe(s.length);
    expect(s.find(x => x.id === 'gallery')!.floor).toBe(4);
  });
  it('con más repos de los que caben, siguen en la planta de debajo y el ocio baja con ellos', () => {
    const s = distribute([...SERIES, ...Array.from({ length: REPOS_BY_FLOOR }, (_, i) => repo('z' + i))]);
    expect(s.filter(x => x.floor === 3)).toHaveLength(REPOS_BY_FLOOR);
    expect(s.find(x => x.id === 'gallery')!.floor).toBe(5);
    expect(new Set(s.map(spot)).size).toBe(s.length);
  });
  it('rótulos de planta', () => {
    expect([0, 1, 4].map(floorCaption)).toEqual(['PB', '-1', '-4']);
  });
  it('el número de las placas sigue el orden alfabético, sin mayúsculas ni tildes de por medio', () => {
    expect(['zeta', 'Banco', 'árbol', 'app10', 'app9'].map(repo).sort(alphabeticalOrder).map(r => r.name)).toEqual(['app9', 'app10', 'árbol', 'Banco', 'zeta']);
  });
});

describe('disposición a mano (obras desde el plano)', () => {
  const base = distribute(SERIES);
  const en = (rooms: any[], id: string) => spot(rooms.find(s => s.id === id)!);
  const unique = (rooms: any[]) => expect(new Set(rooms.map(spot)).size).toBe(rooms.length);

  it('una sala soltada en un hueco ocupado entra ahí y las demás se apartan hacia fuera', () => {
    const a = placeRoom(base, 'logistics', { floor: 2, side: 'left', orden: 0 })!;   // cruza el ascensor
    expect([en(a, 'logistics'), en(a, 'calendar'), en(a, 'comms'), en(a, 'git')]).toEqual(['2left0', '2left1', '2left2', '2right0']);
    expect(a.every((s: any) => s.manual)).toBe(true);
    unique(a);
  });
  it('en un hueco libre al final de otra planta, queda pegada a la última sala de ese lado', () => {
    const a = placeRoom(base, 'git', { floor: 3, side: 'right', orden: 5 })!;
    expect(en(a, 'git')).toBe('3right2');
    expect(a.filter(s => s.floor === 2)).toHaveLength(5);
    unique(a);
  });
  it('en una franja entre plantas abre una planta nueva y las de debajo bajan una', () => {
    const a = placeRoom(base, 'gallery', { floor: 2, side: 'right', orden: 0, newFloor: true })!;
    expect(en(a, 'gallery')).toBe('2right0');
    expect([en(a, 'logistics'), en(a, 'requests'), en(a, 'bodyshop')]).toEqual(['3right0', '4right0', '5right0']);
    unique(a);
  });
  it('la planta que se queda vacía desaparece', () => {
    let s = placeRoom(base, 'vault', { floor: 2, side: 'left', orden: 0 })!;
    s = placeRoom(s, 'bridge', { floor: 2, side: 'right', orden: 0 })!;
    expect(s.find(x => x.id === 'logistics')!.floor).toBe(1);
    expect(Math.max(...s.map(x => x.floor))).toBe(3);
    unique(s);
  });
  it('la puerta no se mueve y nadie más entra en la PB', () => {
    expect(placeRoom(base, 'gate', { floor: 1, side: 'left', orden: 0 })).toBeNull();
    expect(placeRoom(base, 'vault', { floor: 0, side: 'right', orden: 0 })).toBeNull();
  });
  it('una planta arrastrada a otra altura: las de en medio se corren una', () => {
    const a = moveFloor(base, 1, 3)!;
    expect([en(a, 'vault'), en(a, 'logistics'), en(a, 'requests'), en(a, 'gate')]).toEqual(['3left0', '1right0', '2right0', '0left0']);
    expect(moveFloor(base, 1, 0)).toBeNull();
  });
  it('a mano, el sitio se conserva al recalcular y un recluta nuevo entra en la última planta con repos', () => {
    const a = moveFloor(base, 1, 2)!;
    const b = distribute([...a, { ...repo('Banco'), floor: 0, side: 'left' as const, orden: 0 }]);
    expect(en(b, 'vault')).toBe('2left0');
    expect(b.find(s => s.id === 'Banco')!.floor).toBe(3);
    unique(b);
  });
  it('la disposición de serie lo devuelve todo a su sitio', () => {
    const a = defaultLayout(moveFloor(base, 1, 2)!);
    expect(a.map(spot)).toEqual(base.map(spot));
    expect(a.some((s: any) => s.manual)).toBe(false);
  });
});

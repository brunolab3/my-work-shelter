import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { moveFloor } from '../shared/layout.ts';
import { sanitize, initialState, folderOf, ROOMS_FOLDERS, addRoomsOfService, ensureFolders, hideRoom, showRoom, relinkedIds, renameRoomIds } from './state.ts';

describe('estado guardado', () => {
  it('una sala de servicio que falte en un refugio guardado entra en su sitio, sin tocar sus repos', () => {
    const old: any = initialState();
    old.rooms = old.rooms.filter((s: any) => s.id !== 'git').concat([{ id: 'mio', type: 'repo', name: 'mio', path: '/tmp/mio', floor: 3, side: 'izq', orden: 0, variant: 'taller' }]);
    const s = sanitize(old);
    expect(addRoomsOfService(s)).toBe(true);
    expect(s.rooms.find(x => x.id === 'git')).toMatchObject({ type: 'git', name: 'Control de Versiones', floor: 2, side: 'der', orden: 1 });
    expect(s.rooms.find(x => x.id === 'mio')?.path).toBe('/tmp/mio');
    expect(addRoomsOfService(s)).toBe(false);
  });
  it('la sala de logística (planificar y repartir) es de serie: su carpeta es la raíz de repos y, con la disposición a mano, entra junto a control de versiones', () => {
    const old: any = initialState();
    old.reposRoot = '/tmp/mis-repos';
    old.rooms = moveFloor(old.rooms.filter((s: any) => s.id !== 'tareas'), 1, 2);   // movida a mano
    old.dwellers = old.dwellers.filter((h: any) => h.roomId !== 'tareas');
    const s = sanitize(old);
    expect(addRoomsOfService(s)).toBe(true);
    ensureFolders(s);
    const git = s.rooms.find(x => x.id === 'git')!, tareas = s.rooms.find(x => x.id === 'tareas')!;
    expect(tareas).toMatchObject({ type: 'coordinacion', name: 'Logística', path: '/tmp/mis-repos', floor: git.floor, side: git.side, orden: git.orden + 1 });
    s.reposRoot = '/tmp/otros'; ensureFolders(s);
    expect(s.rooms.find(x => x.id === 'tareas')!.path).toBe('/tmp/otros');
  });
  it('una disposición movida a mano en el plano se conserva al cargar', () => {
    const e: any = initialState();
    e.rooms = moveFloor(e.rooms, 1, 2);
    const s = sanitize(JSON.parse(JSON.stringify(e)));
    expect(s.rooms.find(x => x.id === 'camara')).toMatchObject({ floor: 2, side: 'izq', orden: 0, manual: true });
    expect(s.rooms.find(x => x.id === 'logistica')).toMatchObject({ floor: 1, side: 'der', orden: 0 });
  });
  it('sin salas no se acepta (el almacén aparta la copia y arranca de cero)', () => {
    expect(() => sanitize({ rooms: null })).toThrow();
    expect(() => sanitize(null)).toThrow();
  });
  it('descarta habitantes nulos o sin sala y repara el jugador', () => {
    const e: any = initialState();
    e.dwellers = [null, { id: 'x', roomId: 'no-existe' }, ...e.dwellers];
    e.jugador = { scrap: 'mucha', cultivos: null, inventario: { 'pieza:tornillo': 2, broken: 'x' } };
    const s = sanitize(e);
    expect(s.dwellers.every(h => h && s.rooms.some(sl => sl.id === h.roomId))).toBe(true);
    expect(s.jugador.scrap).toBe(initialState().jugador.scrap);
    expect(s.jugador.cultivos.length).toBeGreaterThan(0);
    expect(s.jugador.inventario).toEqual({ 'pieza:tornillo': 2 });
  });
  it('limita los ajustes a valores válidos', () => {
    const s = sanitize({ ...initialState(), sessionLimit: 9999, rooms: initialState().rooms.concat([{ id: 'mala', type: 'repo', floor: -1, side: 'arriba', orden: 0 } as any]) });
    expect(s.sessionLimit).toBe(20);
    expect(s.rooms.some(x => x.id === 'mala')).toBe(false);
  });
  it('si falta la discoteca, entra en la planta de ocio, a la izquierda del ascensor (entre los cultivos y él)', () => {
    const old: any = initialState();
    old.rooms = old.rooms.filter((x: any) => x.id !== 'discoteca');
    old.dwellers = old.dwellers.filter((h: any) => h.roomId !== 'discoteca');
    const s = sanitize(JSON.parse(JSON.stringify(old)));
    expect(addRoomsOfService(s)).toBe(true);
    // sin salas de repo de serie, la planta de ocio queda justo debajo de la de planificación
    const leisure = initialState().rooms.find(x => x.id === 'galeria')!.floor;
    expect(leisure).toBe(3);
    expect(s.rooms.find(x => x.id === 'discoteca')).toMatchObject({ type: 'discoteca', floor: leisure, side: 'izq', orden: 0 });
    expect(s.rooms.find(x => x.id === 'hidroponia')).toMatchObject({ floor: leisure, side: 'izq', orden: 1 });
    expect(s.rooms.find(x => x.id === 'galeria')).toMatchObject({ floor: leisure, side: 'der', orden: 0 });
    expect(sanitize(s).rooms.filter(x => x.type === 'discoteca')).toHaveLength(1);
  });
  it('respeta el nombre que el jugador haya puesto a una sala', () => {
    const e: any = initialState();
    e.rooms = e.rooms.map((x: any) => x.id === 'logistica' ? { ...x, name: 'Linear' } : x);
    expect(sanitize(e).rooms.find(x => x.id === 'logistica')?.name).toBe('Linear');
  });
  it('la agenda que se llamaba «Planificación» pasa a «Agenda» (la planificación de tareas es otra sala); otro nombre se respeta', () => {
    const withName = (name: string) => { const e: any = initialState(); e.rooms = e.rooms.map((x: any) => x.type === 'planificacion' ? { ...x, name } : x); return sanitize(e).rooms.find(x => x.type === 'planificacion')?.name; };
    expect(withName('Planificación')).toBe('Agenda');
    expect(withName('Calendario')).toBe('Calendario');
  });
  it('el tablero de tareas que se llamaba «Logística» pasa a «Planificación» y la sala que reparte (y sus alas), al revés; otro nombre se respeta', () => {
    const e: any = initialState();
    e.rooms = e.rooms.map((x: any) => x.id === 'logistica' ? { ...x, name: 'Logística' } : x.id === 'tareas' ? { ...x, name: 'Planificación' } : x);
    e.rooms.push({ ...e.rooms.find((x: any) => x.id === 'tareas'), id: 'ala', name: 'Planificación clientes', manual: true, floor: 9 });
    const s = sanitize(e);
    const name = (id: string) => s.rooms.find(x => x.id === id)?.name;
    expect([name('logistica'), name('tareas'), name('ala')]).toEqual(['Planificación', 'Logística', 'Logística clientes']);
    expect(sanitize(s).rooms.find(x => x.id === 'logistica')?.name).toBe('Planificación');
  });
  it('toda sala tiene carpeta de trabajo: la suya o, en las especiales, una propia fuera del repo del juego', () => {
    const e = initialState();
    // sin salas de repo de serie: la que tiene carpeta propia es el Puente de Mando (el repo del juego)
    expect(e.rooms.some(s => s.type === 'repo')).toBe(false);
    const repo = e.rooms.find(s => s.type === 'puente')!, logistica = e.rooms.find(s => s.type === 'logistica')!;
    expect(repo.path).toBeTruthy();
    expect(folderOf(repo)).toBe(repo.path);
    expect(folderOf(logistica)).toBe(path.join(ROOMS_FOLDERS, 'logistica'));
    expect(e.rooms.every(s => !!folderOf(s))).toBe(true);
    expect(folderOf(logistica).startsWith(path.resolve(import.meta.dirname, '..') + path.sep)).toBe(false);
  });
});

describe('salas ocultas', () => {
  // un refugio con 9 repos: 8 en la primera planta de repos (-3) y uno, «zeta», solo en la -4; ocio debajo
  const withRepos = () => {
    const e = initialState();
    const names = ['alfa', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'kappa', 'zeta'];
    e.rooms = sanitize({ ...e, rooms: [...e.rooms, ...names.map(n => ({ id: n, type: 'repo', name: n, path: '/tmp/r/' + n, floor: 3, side: 'izq', orden: 0, variant: 'taller' }))] }).rooms;
    e.dwellers.push({ id: 'h-zeta', name: 'Zoe', nickname: '', type: 'Hiker', bio: '', roomId: 'zeta', voice: 120, look: { type: 'humano' } as any });
    return e;
  };
  const floors = (e: ReturnType<typeof initialState>) => [...new Set(e.rooms.map(s => s.floor))].sort((a, b) => a - b);
  it('ocultar la única sala de una planta quita la planta: el ocio sube una', () => {
    const e = withRepos();
    const leisure = e.rooms.find(s => s.type === 'discoteca')!.floor;
    expect(e.rooms.find(s => s.id === 'zeta')!.floor).toBe(4);
    expect(hideRoom(e, 'zeta')).toBe(true);
    expect(e.rooms.some(s => s.id === 'zeta')).toBe(false);
    expect(e.dwellers.some(h => h.roomId === 'zeta')).toBe(false);
    expect(e.rooms.find(s => s.type === 'discoteca')!.floor).toBe(leisure - 1);
    expect(floors(e)).toEqual([0, 1, 2, 3, 4]);
  });
  it('con la disposición a mano, ocultar todas las salas de una planta también la quita', () => {
    const e = withRepos();
    e.rooms = moveFloor(e.rooms, 1, 2)!;   // a mano
    const onFloor3 = e.rooms.filter(s => s.floor === 3).map(s => s.id);
    for (const id of onFloor3) expect(hideRoom(e, id)).toBe(true);
    expect(floors(e)).toEqual([0, 1, 2, 3, 4]);
    expect(e.rooms.some(s => onFloor3.includes(s.id))).toBe(false);
  });
  it('volver a mostrarla trae la sala a su sitio con su habitante, su aspecto y su escena', () => {
    const e = withRepos();
    e.rooms.find(s => s.id === 'zeta')!.decor = { summary: 'x' } as any;
    const before = e.rooms.find(s => s.id === 'zeta')!;
    hideRoom(e, 'zeta');
    const saved = sanitize(JSON.parse(JSON.stringify(e)));   // sobrevive a guardar y cargar
    expect(saved.hidden?.map(o => o.room.id)).toEqual(['zeta']);
    expect(showRoom(saved, 'zeta')).toBe(true);
    expect(saved.hidden).toEqual([]);
    expect(saved.rooms.find(s => s.id === 'zeta')).toMatchObject({ floor: before.floor, side: before.side, orden: before.orden, path: '/tmp/r/zeta', decor: { summary: 'x' } });
    expect(saved.dwellers.find(h => h.id === 'h-zeta')).toMatchObject({ roomId: 'zeta', name: 'Zoe' });
  });
  it('las salas de servicio y la de logística no se ocultan', () => {
    const e = withRepos();
    expect(hideRoom(e, 'camara')).toBe(false);
    expect(hideRoom(e, 'tareas')).toBe(false);
    expect(hideRoom(e, 'no-existe')).toBe(false);
    expect(showRoom(e, 'alfa')).toBe(false);
  });
});

describe('ids de las salas vinculadas a otra carpeta', () => {
  it('cada sala de repo toma el id de su carpeta, sin quitárselo a otra ni tocar los repetidos ni las de servicio', () => {
    expect(relinkedIds([
      { id: 'alfa', type: 'repo', path: '/r/tienda' },
      { id: 'beta', type: 'repo', path: '/r/Panel Web' },
      { id: 'pagos', type: 'repo', path: '/r/pagos' },
      { id: 'pagos-mx1', type: 'repo', path: '/otra/pagos' },
      { id: 'gamma', type: 'repo', path: '/r/pagos' },
      { id: 'api-gateway', type: 'repo', path: '/r/api' },
      { id: 'tareas', type: 'coordinacion', path: '/r' },
      { id: 'git', type: 'git' },
    ])).toEqual({ alfa: 'tienda', beta: 'panel-web', 'api-gateway': 'api' });
  });
  it('el refugio, los planes y la limpieza de tareas cambian juntos el id viejo por el nuevo', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ids-salas-'));
    const e: any = initialState();
    e.rooms.push({ id: 'alfa', type: 'repo', name: 'tienda', path: '/r/tienda', floor: 3, side: 'izq', orden: 0, variant: 'taller' });
    e.dwellers.push({ id: 'ana', name: 'Ana', nickname: '', type: 'Hiker', bio: '', roomId: 'alfa', voice: 120 });
    writeFileSync(path.join(dir, 'refugio.json'), JSON.stringify(e));
    writeFileSync(path.join(dir, 'planes.json'), JSON.stringify([{ id: 'ABC-1', coordination: 'tareas', parts: [{ roomId: 'alfa', room: 'tienda', title: 'x', waitA: ['alfa', 'git'] }] }]));
    writeFileSync(path.join(dir, 'limpieza-tareas.json'), JSON.stringify({ notified: ['alfa|ABC-1|/r/tienda/wt|cambios1'], approved: ['git|ABC-2|/x'] }));
    renameRoomIds(dir);
    const read = (n: string) => JSON.parse(readFileSync(path.join(dir, n), 'utf8'));
    const s = sanitize(read('refugio.json'));
    expect(s.rooms.find(x => x.path === '/r/tienda')?.id).toBe('tienda');
    expect(s.dwellers.find(h => h.id === 'ana')?.roomId).toBe('tienda');
    expect(read('planes.json')[0].parts[0]).toMatchObject({ roomId: 'tienda', waitA: ['tienda', 'git'] });
    expect(read('limpieza-tareas.json')).toEqual({ notified: ['tienda|ABC-1|/r/tienda/wt|cambios1'], approved: ['git|ABC-2|/x'] });
  });
});

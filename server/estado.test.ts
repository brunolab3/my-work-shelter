import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { moveFloor } from '../shared/disposicion.ts';
import { sanear, initialState, folderOf, ROOMS_FOLDERS, addRoomsOfService, ensureFolders, hideRoom, showRoom } from './estado.ts';

describe('estado guardado', () => {
  it('una sala de servicio que falte en un refugio guardado entra en su sitio, sin tocar sus repos', () => {
    const viejo: any = initialState();
    viejo.salas = viejo.salas.filter((s: any) => s.id !== 'git').concat([{ id: 'mio', tipo: 'repo', nombre: 'mio', ruta: '/tmp/mio', planta: 3, lado: 'izq', orden: 0, variant: 'taller' }]);
    const s = sanear(viejo);
    expect(addRoomsOfService(s)).toBe(true);
    expect(s.salas.find(x => x.id === 'git')).toMatchObject({ tipo: 'git', nombre: 'Control de Versiones', planta: 2, lado: 'der', orden: 1 });
    expect(s.salas.find(x => x.id === 'mio')?.ruta).toBe('/tmp/mio');
    expect(addRoomsOfService(s)).toBe(false);
  });
  it('la sala de logística (planificar y repartir) es de serie: su carpeta es la raíz de repos y, con la disposición a mano, entra junto a control de versiones', () => {
    const viejo: any = initialState();
    viejo.raizRepos = '/tmp/mis-repos';
    viejo.salas = moveFloor(viejo.salas.filter((s: any) => s.id !== 'tareas'), 1, 2);   // movida a mano
    viejo.habitantes = viejo.habitantes.filter((h: any) => h.salaId !== 'tareas');
    const s = sanear(viejo);
    expect(addRoomsOfService(s)).toBe(true);
    ensureFolders(s);
    const git = s.salas.find(x => x.id === 'git')!, tareas = s.salas.find(x => x.id === 'tareas')!;
    expect(tareas).toMatchObject({ tipo: 'coordinacion', nombre: 'Logística', ruta: '/tmp/mis-repos', planta: git.planta, lado: git.lado, orden: git.orden + 1 });
    s.raizRepos = '/tmp/otros'; ensureFolders(s);
    expect(s.salas.find(x => x.id === 'tareas')!.ruta).toBe('/tmp/otros');
  });
  it('una disposición movida a mano en el plano se conserva al cargar', () => {
    const e: any = initialState();
    e.salas = moveFloor(e.salas, 1, 2);
    const s = sanear(JSON.parse(JSON.stringify(e)));
    expect(s.salas.find(x => x.id === 'camara')).toMatchObject({ planta: 2, lado: 'izq', orden: 0, manual: true });
    expect(s.salas.find(x => x.id === 'logistica')).toMatchObject({ planta: 1, lado: 'der', orden: 0 });
  });
  it('sin salas no se acepta (el almacén aparta la copia y arranca de cero)', () => {
    expect(() => sanear({ salas: null })).toThrow();
    expect(() => sanear(null)).toThrow();
  });
  it('descarta habitantes nulos o sin sala y repara el jugador', () => {
    const e: any = initialState();
    e.habitantes = [null, { id: 'x', salaId: 'no-existe' }, ...e.habitantes];
    e.jugador = { scrap: 'mucha', cultivos: null, inventario: { 'pieza:tornillo': 2, roto: 'x' } };
    const s = sanear(e);
    expect(s.habitantes.every(h => h && s.salas.some(sl => sl.id === h.salaId))).toBe(true);
    expect(s.jugador.scrap).toBe(initialState().jugador.scrap);
    expect(s.jugador.cultivos.length).toBeGreaterThan(0);
    expect(s.jugador.inventario).toEqual({ 'pieza:tornillo': 2 });
  });
  it('limita los ajustes a valores válidos', () => {
    const s = sanear({ ...initialState(), limiteSesiones: 9999, salas: initialState().salas.concat([{ id: 'mala', tipo: 'repo', planta: -1, lado: 'arriba', orden: 0 } as any]) });
    expect(s.limiteSesiones).toBe(20);
    expect(s.salas.some(x => x.id === 'mala')).toBe(false);
  });
  it('si falta la discoteca, entra en la planta de ocio, a la izquierda del ascensor (entre los cultivos y él)', () => {
    const viejo: any = initialState();
    viejo.salas = viejo.salas.filter((x: any) => x.id !== 'discoteca');
    viejo.habitantes = viejo.habitantes.filter((h: any) => h.salaId !== 'discoteca');
    const s = sanear(JSON.parse(JSON.stringify(viejo)));
    expect(addRoomsOfService(s)).toBe(true);
    // sin salas de repo de serie, la planta de ocio queda justo debajo de la de planificación
    const ocio = initialState().salas.find(x => x.id === 'galeria')!.planta;
    expect(ocio).toBe(3);
    expect(s.salas.find(x => x.id === 'discoteca')).toMatchObject({ tipo: 'discoteca', planta: ocio, lado: 'izq', orden: 0 });
    expect(s.salas.find(x => x.id === 'hidroponia')).toMatchObject({ planta: ocio, lado: 'izq', orden: 1 });
    expect(s.salas.find(x => x.id === 'galeria')).toMatchObject({ planta: ocio, lado: 'der', orden: 0 });
    expect(sanear(s).salas.filter(x => x.tipo === 'discoteca')).toHaveLength(1);
  });
  it('respeta el nombre que el jugador haya puesto a una sala', () => {
    const e: any = initialState();
    e.salas = e.salas.map((x: any) => x.id === 'logistica' ? { ...x, nombre: 'Linear' } : x);
    expect(sanear(e).salas.find(x => x.id === 'logistica')?.nombre).toBe('Linear');
  });
  it('la agenda que se llamaba «Planificación» pasa a «Agenda» (la planificación de tareas es otra sala); otro nombre se respeta', () => {
    const withName = (nombre: string) => { const e: any = initialState(); e.salas = e.salas.map((x: any) => x.tipo === 'planificacion' ? { ...x, nombre } : x); return sanear(e).salas.find(x => x.tipo === 'planificacion')?.nombre; };
    expect(withName('Planificación')).toBe('Agenda');
    expect(withName('Calendario')).toBe('Calendario');
  });
  it('el tablero de tareas que se llamaba «Logística» pasa a «Planificación» y la sala que reparte (y sus alas), al revés; otro nombre se respeta', () => {
    const e: any = initialState();
    e.salas = e.salas.map((x: any) => x.id === 'logistica' ? { ...x, nombre: 'Logística' } : x.id === 'tareas' ? { ...x, nombre: 'Planificación' } : x);
    e.salas.push({ ...e.salas.find((x: any) => x.id === 'tareas'), id: 'ala', nombre: 'Planificación clientes', manual: true, planta: 9 });
    const s = sanear(e);
    const name = (id: string) => s.salas.find(x => x.id === id)?.nombre;
    expect([name('logistica'), name('tareas'), name('ala')]).toEqual(['Planificación', 'Logística', 'Logística clientes']);
    expect(sanear(s).salas.find(x => x.id === 'logistica')?.nombre).toBe('Planificación');
  });
  it('toda sala tiene carpeta de trabajo: la suya o, en las especiales, una propia fuera del repo del juego', () => {
    const e = initialState();
    // sin salas de repo de serie: la que tiene carpeta propia es el Puente de Mando (el repo del juego)
    expect(e.salas.some(s => s.tipo === 'repo')).toBe(false);
    const repo = e.salas.find(s => s.tipo === 'puente')!, logistica = e.salas.find(s => s.tipo === 'logistica')!;
    expect(repo.ruta).toBeTruthy();
    expect(folderOf(repo)).toBe(repo.ruta);
    expect(folderOf(logistica)).toBe(path.join(ROOMS_FOLDERS, 'logistica'));
    expect(e.salas.every(s => !!folderOf(s))).toBe(true);
    expect(folderOf(logistica).startsWith(path.resolve(import.meta.dirname, '..') + path.sep)).toBe(false);
  });
});

describe('salas ocultas', () => {
  // un refugio con 9 repos: 8 en la primera planta de repos (-3) y uno, «zeta», solo en la -4; ocio debajo
  const conRepos = () => {
    const e = initialState();
    const nombres = ['alfa', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'kappa', 'zeta'];
    e.salas = sanear({ ...e, salas: [...e.salas, ...nombres.map(n => ({ id: n, tipo: 'repo', nombre: n, ruta: '/tmp/r/' + n, planta: 3, lado: 'izq', orden: 0, variant: 'taller' }))] }).salas;
    e.habitantes.push({ id: 'h-zeta', nombre: 'Zoe', mote: '', tipo: 'Hiker', bio: '', salaId: 'zeta', voz: 120, aspecto: { tipo: 'humano' } as any });
    return e;
  };
  const plantas = (e: ReturnType<typeof initialState>) => [...new Set(e.salas.map(s => s.planta))].sort((a, b) => a - b);
  it('ocultar la única sala de una planta quita la planta: el ocio sube una', () => {
    const e = conRepos();
    const ocio = e.salas.find(s => s.tipo === 'discoteca')!.planta;
    expect(e.salas.find(s => s.id === 'zeta')!.planta).toBe(4);
    expect(hideRoom(e, 'zeta')).toBe(true);
    expect(e.salas.some(s => s.id === 'zeta')).toBe(false);
    expect(e.habitantes.some(h => h.salaId === 'zeta')).toBe(false);
    expect(e.salas.find(s => s.tipo === 'discoteca')!.planta).toBe(ocio - 1);
    expect(plantas(e)).toEqual([0, 1, 2, 3, 4]);
  });
  it('con la disposición a mano, ocultar todas las salas de una planta también la quita', () => {
    const e = conRepos();
    e.salas = moveFloor(e.salas, 1, 2)!;   // a mano
    const deLaTres = e.salas.filter(s => s.planta === 3).map(s => s.id);
    for (const id of deLaTres) expect(hideRoom(e, id)).toBe(true);
    expect(plantas(e)).toEqual([0, 1, 2, 3, 4]);
    expect(e.salas.some(s => deLaTres.includes(s.id))).toBe(false);
  });
  it('volver a mostrarla trae la sala a su sitio con su habitante, su aspecto y su escena', () => {
    const e = conRepos();
    e.salas.find(s => s.id === 'zeta')!.decorado = { resumen: 'x' } as any;
    const antes = e.salas.find(s => s.id === 'zeta')!;
    hideRoom(e, 'zeta');
    const guardado = sanear(JSON.parse(JSON.stringify(e)));   // sobrevive a guardar y cargar
    expect(guardado.ocultas?.map(o => o.sala.id)).toEqual(['zeta']);
    expect(showRoom(guardado, 'zeta')).toBe(true);
    expect(guardado.ocultas).toEqual([]);
    expect(guardado.salas.find(s => s.id === 'zeta')).toMatchObject({ planta: antes.planta, lado: antes.lado, orden: antes.orden, ruta: '/tmp/r/zeta', decorado: { resumen: 'x' } });
    expect(guardado.habitantes.find(h => h.id === 'h-zeta')).toMatchObject({ salaId: 'zeta', nombre: 'Zoe' });
  });
  it('las salas de servicio y la de logística no se ocultan', () => {
    const e = conRepos();
    expect(hideRoom(e, 'camara')).toBe(false);
    expect(hideRoom(e, 'tareas')).toBe(false);
    expect(hideRoom(e, 'no-existe')).toBe(false);
    expect(showRoom(e, 'alfa')).toBe(false);
  });
});

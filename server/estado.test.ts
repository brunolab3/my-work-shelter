import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { moveFloor } from '../shared/disposicion.ts';
import { sanear, initialState, folderOf, ROOMS_FOLDERS, addRoomsOfService, ensureFolders } from './estado.ts';

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

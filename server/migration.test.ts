// Saved data from before the third pass to English identifiers (step 2) still loads: shared/migrateKeys.ts and
// migrateDataFolder in server/state.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { migrateDataFolder, sanitize } from './state.ts';
import { LEGACY_KEYS_3 } from '../shared/legacyKeys.ts';
import { migrateKeys, MIGRATION_STEP } from '../shared/migrateKeys.ts';
import { INITIAL_ROOMS, INITIAL_DWELLERS } from '../shared/initialShelter.ts';
import { SOURCES } from '../shared/sources.ts';

// the shape of a real refugio.json at step 2 (names and paths made up)
const jugador = { scrap: 42, inventario: { 'pieza:engranaje': 2 }, outfit: [], tienda: ['gorra'], records: { tiro: 310, generador: 3 }, achievements: [], finishedTasks: 7, toolsCalls: 90, cultivos: [{ especie: 'Lettuce', phase: 2, progreso: 3 }], armas: ['ballesta'], arma: 'ballesta', species: ['Lettuce'], signals: [] };
const shelter = {
  version: 1, creado: 1, nombre: 'Refugio QA', doneWelcome: true, raizRepos: '/r', limiteSesiones: 4,
  supervisor: { personaje: 'humano', nombre: 'Ana', accesorios: [], aspecto: { especie: 'humano', piezas: { cabeza: 'cabeza1', torso: 'torso2', piernas: 'piernas1' }, colores: { piel: '#c08060', luz: '#ffcc00', torso1: '#123456' } } },
  salas: [
    { id: 'tienda', tipo: 'repo', nombre: 'tienda', ruta: '/r/tienda', planta: 2, lado: 'izq', orden: 0, manual: true, variant: 'taller', carpeta: 'tienda',
      decorado: { version: 1, base: 'vacia', resumen: 'una tienda', subtitulo: 'TIENDA', acento: '#ff0000', paleta: 'oxido', paredes: ['a', 'b', 'c'], luz: 0.8,
        puesto: { pantalla: 'doble', mesa: 'mesa_1' }, lamparas: [{ x: 1, z: 0, color: '#fff', intensidad: 60 }],
        piezas: [{ modelo: 'caja', x: 3, z: -1, giro: 90, ancho: 1.2, sobre: 0, pared: true, tumbada: true, luz: '#00ff00' }],
        carteles: [{ x: 4, y: 2, ancho: 1, titulo: 'ABIERTO', lineas: ['24H'], fondo: '#000', tinta: '#fff', simbolo: 'rayo', giro: 3 }] } },
  ],
  habitantes: [{ id: 'ana', nombre: 'Ana', mote: 'A', tipo: 'humano', salaId: 'tienda', bio: '', voz: 1, aspecto: { especie: 'humano', piezas: { cabeza: 'cabeza1', gafas: 'gafas2' }, colores: { pelo: '#111111', cabeza1: '#222222' } } }],
  jugador,
  integraciones: { jira: { modo: 'real', secrets: ['token'], campos: { sitio: 'acme.atlassian.net', correo: 'ana@acme.example' } }, calendario: { modo: 'real', opciones: { calendarios: 'Trabajo' } } },
  viewsNotifications: [], idioma: 'en', ocultas: [],
  ajustes: { trustedFolders: ['/r'], verificacionTableros: { ABC: { prueba: 'Prod check', hecho: 'Done' } } },
};

function step2Folder() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shelter-step2-'));
  const w = (n: string, x: unknown) => { mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); writeFileSync(path.join(dir, n), JSON.stringify(x)); };
  w('refugio.json', shelter);
  w('planes.json', [{ id: 'ABC-1', clave: 'ABC-1', titulo: 'x', texto: 'plan', creado: 1, actualizado: 2, coordinacion: 'tienda', partes: [{ salaId: 'tienda', sala: 'tienda', titulo: 'y', sesionId: 's1' }], historial: [{ version: 1, fecha: 1, cambios: 'z' }] }]);
  w('abiertas.json', [{ claudeId: 'c1', cwd: '/r/tienda', titulo: 't', habitante: 'Ana', estado: 'ociosa', permisos: 'default' }]);
  w('limpieza-tareas.json', { avisados: ['tienda|ABC-1|/r/tienda/wt|cambios1'], aprobados: [] });
  w('compares/abc.json', { ts: 1, partes: [{ worktree: '/r/tienda/wt', rama: 'feature/abc', head: 'h', base: 'b' }] });
  w('control-remoto/tienda.json', { pid: 1, cwd: '/r/tienda', nombre: 'tienda', desde: 5 });
  writeFileSync(path.join(dir, '.claves-en'), 'sí'); writeFileSync(path.join(dir, '.claves-en-paso'), '2');
  return dir;
}

describe('saved data from step 2 (before the third pass to English identifiers)', () => {
  it('loads with the new names; ids, look slots, field ids and the economy keep theirs; a second start changes nothing', () => {
    const dir = step2Folder();
    migrateDataFolder(dir);
    const read = (n: string) => JSON.parse(readFileSync(path.join(dir, n), 'utf8'));
    expect(readFileSync(path.join(dir, '.claves-en-paso'), 'utf8')).toBe(String(MIGRATION_STEP));
    expect(existsSync(path.join(dir, 'compares/abc.json.antes-de-ingles-3'))).toBe(true);

    const raw = read('refugio.json');
    expect(raw.jugador).toEqual(jugador);
    expect(raw.integrations.jira).toEqual({ mode: 'real', secrets: ['token'], fields: { sitio: 'acme.atlassian.net', correo: 'ana@acme.example' } });
    expect(raw.integrations.calendario.options).toEqual({ calendarios: 'Trabajo' });
    expect(raw.settings.verificationBoards).toEqual({ ABC: { test: 'Prod check', done: 'Done' } });
    expect(raw.supervisor.look).toEqual({ especie: 'human', pieces: { cabeza: 'cabeza1', torso: 'torso2', piernas: 'piernas1' }, colors: { piel: '#c08060', luz: '#ffcc00', torso1: '#123456' } });

    const s = sanitize(raw);
    expect(s.name).toBe('Refugio QA');
    expect(s.reposRoot).toBe('/r');
    expect(s.rooms.find(r => r.id === 'tienda')).toMatchObject({ type: 'repo', name: 'tienda', path: '/r/tienda', side: 'left', variant: 'taller' });
    const decor = s.rooms.find(r => r.id === 'tienda')!.decor!;
    expect(decor).toMatchObject({ summary: 'una tienda', subtitle: 'TIENDA', accent: '#ff0000', workstation: { screen: 'dual' } });
    const saved = raw.rooms[0].decor;   // as saved (sanitize drops a model that is not in the catalogue)
    expect(saved.pieces[0]).toEqual({ model: 'caja', x: 3, z: -1, rotation: 90, width: 1.2, restsOn: 0, wall: true, lying: true, light: '#00ff00' });
    expect(saved.signs[0]).toEqual({ x: 4, y: 2, width: 1, title: 'ABIERTO', lines: ['24H'], background: '#000', ink: '#fff', symbol: 'bolt', rotation: 3 });
    expect(saved.lamps[0]).toEqual({ x: 1, z: 0, color: '#fff', intensity: 60 });
    expect(saved.workstation).toEqual({ screen: 'dual', desk: 'mesa_1' });
    expect(s.dwellers.find(h => h.id === 'ana')).toMatchObject({ name: 'Ana', nickname: 'A', roomId: 'tienda', voice: 1 });
    expect(raw.dwellers[0].look).toEqual({ especie: 'human', pieces: { cabeza: 'cabeza1', gafas: 'gafas2' }, colors: { pelo: '#111111', cabeza1: '#222222' } });

    expect(read('planes.json')[0]).toMatchObject({ key: 'ABC-1', title: 'x', text: 'plan', coordination: 'tienda', parts: [{ roomId: 'tienda', room: 'tienda', title: 'y', sessionId: 's1' }], history: [{ version: 1, date: 1, changes: 'z' }] });
    expect(read('abiertas.json')[0]).toEqual({ claudeId: 'c1', cwd: '/r/tienda', title: 't', dweller: 'Ana', state: 'idle', permissions: 'default' });
    expect(read('limpieza-tareas.json')).toEqual({ notified: ['tienda|ABC-1|/r/tienda/wt|cambios1'], approved: [] });
    expect(read('compares/abc.json')).toEqual({ ts: 1, parts: [{ worktree: '/r/tienda/wt', branch: 'feature/abc', head: 'h', base: 'b' }] });
    expect(read('control-remoto/tienda.json')).toEqual({ pid: 1, cwd: '/r/tienda', name: 'tienda', since: 5 });

    const after = readFileSync(path.join(dir, 'refugio.json'), 'utf8');
    migrateDataFolder(dir);
    expect(readFileSync(path.join(dir, 'refugio.json'), 'utf8')).toBe(after);
  });

  it('the browser storage takes the same step', () => {
    expect(migrateKeys({ salaId: 'tienda', texto: 'hola', aspecto: { piezas: { cabeza: 'x' } } }, 2)).toEqual({ roomId: 'tienda', text: 'hola', look: { pieces: { cabeza: 'x' } } });
  });

  it('never renames a key that is data: room, dweller and source ids', () => {
    const ids = [...INITIAL_ROOMS.map(r => r.id), ...INITIAL_DWELLERS.map(h => h.id), ...SOURCES];
    expect(ids.filter(id => Object.hasOwn(LEGACY_KEYS_3, id))).toEqual([]);
  });
});

describe('saved data from step 3 (before the English string values)', () => {
  it('built-in room ids and types, states, sides and decor names migrate; repo rooms, ids and the economy keep theirs', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shelter-step3-'));
    const w = (n: string, x: unknown) => writeFileSync(path.join(dir, n), JSON.stringify(x));
    const decor = { version: 1, base: 'vacia', palette: 'acorazada', workstation: { screen: 'doble' }, signs: [{ x: 0, y: 2, width: 1, title: 'NADA', symbol: 'ojo' }] };
    w('refugio.json', { ...shelter, rooms: [
      { id: 'puente', type: 'puente', name: 'Puente de Mando', floor: 1, side: 'der', orden: 0, variant: 'puente', style: 'generico', decor },
      { id: 'tareas', type: 'coordinacion', name: 'Planning', floor: 2, side: 'izq', orden: 0, variant: 'logistica' },
      { id: 'nada', type: 'repo', name: 'nada', path: '/r/nada', floor: 3, side: 'izq', orden: 0, variant: 'taller', area: 'critico' },
    ], dwellers: [{ id: 'nestor', name: 'Néstor', nickname: 'N', type: 'humano', roomId: 'puente', bio: '', voice: 1, look: { especie: 'humano', pieces: { pelo: 'pelo.Engineer' }, colors: { piel: '#c08060' } } },
      { id: 'remi', name: 'Remi', nickname: 'R', type: 'humano', roomId: 'nada', bio: '', voice: 1 }] });
    w('abiertas.json', [{ claudeId: 'c1', cwd: '/r/nada', state: 'trabajando' }, { claudeId: 'c2', cwd: '/r', state: 'esperando' }]);
    w('bitacora.json', { conversations: { c1: { roomId: 'camara' } }, prs: { u: { state: 'fusionado' } } });
    w('escalera.json', { digestRoom: 'logistica', steps: [] });
    w('planes.json', [{ id: 'ABC-1', coordination: 'tareas', parts: [{ roomId: 'comunicaciones', room: 'comunicaciones' }] }]);
    w('mensajes-programados.json', { items: [{ target: { type: 'conversacion', roomId: 'puerta' }, origin: { roomId: 'nada' } }] });
    w('preflight.json', { checklist: { a: { b: { c: { state: 'pendiente' } } } } });
    writeFileSync(path.join(dir, '.claves-en-paso'), '3');
    migrateDataFolder(dir);
    const read = (n: string) => JSON.parse(readFileSync(path.join(dir, n), 'utf8'));

    const raw = read('refugio.json');
    expect(raw.rooms.map((r: any) => [r.id, r.type, r.side, r.variant])).toEqual([['bridge', 'bridge', 'right', 'bridge'], ['tareas', 'coordination', 'left', 'logistics'], ['nada', 'repo', 'left', 'taller']]);
    expect(raw.rooms[0].style).toBe('generic');
    expect(raw.rooms[0].decor).toEqual({ version: 1, base: 'empty', palette: 'vault', workstation: { screen: 'dual' }, signs: [{ x: 0, y: 2, width: 1, title: 'NADA', symbol: 'eye' }] });
    expect(raw.rooms[2].area).toBe('critical');
    expect(raw.dwellers.map((h: any) => h.roomId)).toEqual(['bridge', 'nada']);
    expect(raw.dwellers[0].look).toEqual({ especie: 'human', pieces: { pelo: 'pelo.Engineer' }, colors: { piel: '#c08060' } });
    expect(raw.jugador).toEqual(jugador);
    expect(read('abiertas.json').map((x: any) => x.state)).toEqual(['working', 'waiting']);
    expect(read('bitacora.json')).toEqual({ conversations: { c1: { roomId: 'vault' } }, prs: { u: { state: 'merged' } } });
    expect(read('escalera.json').digestRoom).toBe('logistics');
    expect(read('planes.json')[0]).toMatchObject({ coordination: 'tareas', parts: [{ roomId: 'comms', room: 'comms' }] });
    expect(read('mensajes-programados.json').items[0]).toEqual({ target: { type: 'conversation', roomId: 'gate' }, origin: { roomId: 'nada' } });
    expect(read('preflight.json').checklist.a.b.c.state).toBe('pending');
    expect(existsSync(path.join(dir, 'refugio.json.antes-de-ingles-4'))).toBe(true);

    const after = readFileSync(path.join(dir, 'refugio.json'), 'utf8');
    migrateDataFolder(dir);
    expect(readFileSync(path.join(dir, 'refugio.json'), 'utf8')).toBe(after);
  });
});

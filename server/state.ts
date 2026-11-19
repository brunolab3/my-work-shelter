// Estado persistente del refugio (en local, en .data/refugio.json): salas, habitantes, disposición, ajustes,
// progreso del jugador, récords, notificaciones vistas. Las credenciales NO van aquí (llavero de macOS).
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { migrateKeys, MIGRATION_STEP } from '../shared/migrateKeys.ts';
import { LEGACY_KEYS } from '../shared/legacyKeys.ts';
import path from 'node:path';
import os from 'node:os';
import { INITIAL_ROOMS, INITIAL_DWELLERS } from '../shared/initialShelter.ts';
import { GAME_NAME } from '../shared/protocol.ts';
import { tonesForRepeated, distinctLooks } from '../shared/recruits.ts';
import { distribute, placeRoom, isRoomOfRepo, PLANNING_ROOM } from '../shared/layout.ts';
import { sanitizeLook, type Look } from '../shared/appearance.ts';
import { SOURCES } from './integrations/adapters.ts';
import { sanitizeDecor, type Decor } from '../shared/decor.ts';
import { projectType } from './repos.ts';
import { areaByType, isArea, type RepoArea } from '../shared/sectors.ts';
import { isLanguage, type Language } from '../shared/language.ts';

export const DATA = path.resolve(process.env.SHELTER_DATOS || path.join(import.meta.dirname, '..', '.data'));
/** The .json files of the data folder, subfolders included (compares/, control-remoto/), relative to it; not bin/ */
export function jsonFiles(dir: string, sub = ''): string[] {
  return readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap(e => e.isDirectory() ? (sub === '' && e.name === 'bin' ? [] : jsonFiles(dir, path.join(sub, e.name))) : e.name.endsWith('.json') ? [path.join(sub, e.name)] : []);
}
// los archivos de .data guardados con las claves en español (antes de pasar el código a inglés) se ponen al día una vez,
// antes de que nadie los lea; la marca evita repetirlo y queda una copia de cada uno (shared/migrateKeys.ts).
// La comprobación de «Reiniciar el juego» (SHELTER_COMPROBAR) carga este módulo con el servidor viejo aún en marcha: si
// migrara aquí, el viejo guardaría después su estado con las claves de antes encima
try { if (!process.env.SHELTER_COMPROBAR) migrateDataFolder(DATA); } catch (e) { console.error('Migración de claves:', e); }
/** Brings the data folder's saved files up to the last key-migration step (`.claves-en-paso` holds the last one done;
 *  `.claves-en` without a number is the first), leaving a `.antes-de-ingles-N` copy of each file */
export function migrateDataFolder(dir: string) {
  if (!existsSync(dir)) return;
  const mark = path.join(dir, '.claves-en'), mark2 = path.join(dir, '.claves-en-paso');
  const done = existsSync(mark2) ? Number(readFileSync(mark2, 'utf8')) || 1 : existsSync(mark) ? 1 : 0;
  if (done === 1) repairMixedState(dir);
  if (done >= MIGRATION_STEP) return;
  for (const n of jsonFiles(dir)) {
    const f = path.join(dir, n);
    try { const old = readFileSync(f, 'utf8'); writeFileSync(`${f}.antes-de-ingles-${done + 1}`, old, { mode: 0o600 }); writeFileSync(f, JSON.stringify(migrateKeys(JSON.parse(old), done), null, 2), { mode: 0o600 }); } catch (e) { console.error('No se pudo migrar ' + n + ':', e); }
  }
  writeFileSync(mark2, String(MIGRATION_STEP));
}
// una sala de repo vinculada a otra carpeta conservaba el id de la de antes, y los
// habitantes ven ese id al mandarse mensajes: al arrancar toma el de su carpeta (no en la comprobación del reinicio, por lo
// mismo que la migración de claves)
try { if (existsSync(DATA) && !process.env.SHELTER_COMPROBAR) renameRoomIds(DATA); } catch (e) { console.error('Ids de salas:', e); }

/** El id de la sala de una carpeta: su nombre en minúsculas, sin tildes ni símbolos (addRoom en main.ts) */
export function roomIdOf(filePath: string) { return path.basename(filePath).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]/g, '-') || 'sala'; }
/** { viejo: nuevo } para las salas de repo cuyo id no sale de su carpeta (sin quitarle el suyo a otra sala) */
export function relinkedIds(rooms: { id: string; type: string; path?: string }[]): Record<string, string> {
  const used = new Set(rooms.map(s => s.id)), out: Record<string, string> = {};
  for (const s of rooms) {
    if (s.type !== 'repo' || !s.path) continue;
    const base = roomIdOf(s.path);
    // `<base>-<suffix>` is a repeated folder (addRoom adds Date.now() in base 36) only if the suffix has a digit: an
    // `api-gateway` room relinked to `api` is renamed
    if (s.id === base || (s.id.startsWith(base + '-') && /^[a-z0-9]*\d[a-z0-9]*$/.test(s.id.slice(base.length + 1))) || used.has(base)) continue;
    used.add(base); out[s.id] = base;
  }
  return out;
}
// el refugio, los planes repartidos y la limpieza de tareas guardan ids de sala: los tres se ponen al día juntos
export function renameRoomIds(dir: string) {
  const f = path.join(dir, 'refugio.json');
  if (!existsSync(f)) return;
  const e = JSON.parse(readFileSync(f, 'utf8'));
  const hidden: any[] = Array.isArray(e.hidden) ? e.hidden : [];
  const map = relinkedIds([...(Array.isArray(e.rooms) ? e.rooms : []), ...hidden.map(o => o?.room).filter(Boolean)]);
  if (!Object.keys(map).length) return;
  const n = (id: unknown) => (typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : id);
  const write = (file: string, x: unknown) => writeFileSync(file, JSON.stringify(x, null, 1), { mode: 0o600 });
  for (const s of e.rooms ?? []) s.id = n(s.id);
  for (const h of e.dwellers ?? []) h.roomId = n(h.roomId);
  for (const o of hidden) { if (o?.room) o.room.id = n(o.room.id); for (const h of o?.dwellers ?? []) h.roomId = n(h.roomId); }
  const fp = path.join(dir, 'planes.json'), fl = path.join(dir, 'limpieza-tareas.json');
  if (existsSync(fp)) {
    const plans = JSON.parse(readFileSync(fp, 'utf8'));
    for (const p of Array.isArray(plans) ? plans : []) { p.coordination = n(p.coordination); for (const x of p.parts ?? []) { x.roomId = n(x.roomId); if (Array.isArray(x.waitA)) x.waitA = x.waitA.map(n); } }
    write(fp, plans);
  }
  if (existsSync(fl)) {
    const l = JSON.parse(readFileSync(fl, 'utf8'));
    const key = (k: unknown) => (typeof k === 'string' ? [n(k.split('|')[0]), ...k.split('|').slice(1)].join('|') : k);
    for (const c of ['notified', 'approved']) if (Array.isArray(l[c])) l[c] = l[c].map(key);
    write(fl, l);
  }
  write(f, e);
  console.log('Salas con el id de su carpeta: ' + Object.entries(map).map(([a, b]) => `${a} → ${b}`).join(', '));
}

// El primer paso de la migración corrió en la comprobación del reinicio y el servidor viejo guardó luego su estado con las
// claves de antes: refugio.json quedó mezclado (claves viejas junto a las nuevas, y lo que la validación nueva no encontró,
// a sus valores por defecto). Se rehace una vez: cada par viejo/nuevo se junta (listas unidas, contadores al máximo,
// objetos combinados; si no, el nuevo) y lo que falta, la paleta y el decorado de cada sala salen de la copia de antes
function repairMixedState(dir: string) {
  const f = path.join(dir, 'refugio.json'), copy = f + '.antes-de-ingles';
  if (!existsSync(f) || !existsSync(copy)) return;
  const cur = JSON.parse(readFileSync(f, 'utf8'));
  const hasLegacy = (x: any): boolean => Array.isArray(x) ? x.some(hasLegacy) : !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) => Object.hasOwn(LEGACY_KEYS, k) || hasLegacy(v));
  if (!hasLegacy(cur)) return;
  const merge = (x: any): any => {
    if (Array.isArray(x)) return x.map(merge);
    if (!x || typeof x !== 'object') return x;
    const out: any = {};
    for (const [k, v] of Object.entries(x)) if (!Object.hasOwn(LEGACY_KEYS, k)) out[k] = merge(v);
    for (const [k, v] of Object.entries(x)) {
      if (!Object.hasOwn(LEGACY_KEYS, k)) continue;
      const n = LEGACY_KEYS[k], old = merge(v), newer = out[n];
      out[n] = newer === undefined ? old : Array.isArray(old) && Array.isArray(newer) ? [...new Set([...old, ...newer].map(y => JSON.stringify(y)))].map(y => JSON.parse(y))
        : typeof old === 'number' && typeof newer === 'number' ? Math.max(old, newer) : old && newer && typeof old === 'object' && typeof newer === 'object' ? { ...old, ...newer } : newer;
    }
    return out;
  };
  const rename = (x: any): any => Array.isArray(x) ? x.map(rename) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [Object.hasOwn(LEGACY_KEYS, k) ? LEGACY_KEYS[k] : k, rename(v)])) : x;
  const base = rename(JSON.parse(readFileSync(copy, 'utf8')));
  // lo que falta, de la copia (las listas de objetos con id, emparejadas por id)
  const fill = (x: any, b: any): any => {
    if (Array.isArray(x) && Array.isArray(b)) return x.map(y => (y && typeof y === 'object' && 'id' in y ? fill(y, b.find(z => z?.id === y.id)) : y));
    if (!x || typeof x !== 'object' || !b || typeof b !== 'object') return x;
    const out: any = { ...x };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? fill(out[k], v) : v;
    return out;
  };
  const repaired = fill(merge(cur), base);
  for (const room of repaired.salas ?? []) { const b = (base.salas ?? []).find((y: any) => y.id === room.id); if (b?.variant) room.variant = b.variant; if (b?.decorado) room.decorado = b.decorado; }   // step-1 data: the keys of then
  writeFileSync(f + '.antes-de-reparar', readFileSync(f, 'utf8'), { mode: 0o600 });
  writeFileSync(f, JSON.stringify(repaired, null, 2), { mode: 0o600 });
  console.log('refugio.json reparado (estaba mezclado tras el primer paso de la migración).');
}

export interface SavedRoom {
  id: string;
  type: 'repo' | 'coordinacion' | 'comunicaciones' | 'planificacion' | 'logistica' | 'git' | 'puente' | 'camara' | 'puerta' | 'hidroponia' | 'galeria' | 'discoteca' | 'chapa';
  name: string;
  path?: string;                // carpeta (salas de repo, coordinación, Puente de Mando)
  folder?: string;             // carpeta de trabajo: la ruta o, en las especiales, una propia (no se guarda a mano: carpetaDe)
  floor: number;               // 0 = planta baja (a pie de calle); 1 = -1…  Lo calcula `distribuir`
  side: 'izq' | 'der';          // a qué lado del ascensor
  orden: number;                // posición en su lado (0 = junto al ascensor)
  manual?: boolean;             // su sitio lo ha puesto el Supervisor desde el plano (disposición a mano)
  variant: string;             // paleta
  style?: string;
  area?: RepoArea;               // repos: frontend, backend o servicio crítico (su sector y su color)
  decor?: Decor;          // la escena que le ha diseñado su habitante («Adaptar la sala al repo»); sin él, su plantilla
}
export interface SavedDweller { id: string; name: string; nickname: string; type: string; bio: string; roomId: string; tint?: string; tone?: number; voice: number; lastSession?: string; accessories?: string[]; look?: Look }
/** Una sala de repo oculta por el Supervisor: fuera del juego (sin sitio en el refugio, la raíz de repos no la vuelve a
 *  traer), pero guarda su habitante, su aspecto y su escena para cuando vuelva */
export interface HiddenRoom { room: SavedRoom; dwellers: SavedDweller[] }
export interface Player {
  scrap: number; inventario: Record<string, number>; outfit: string[]; tienda: string[];
  records: Record<string, number>; achievements: string[]; finishedTasks: number; toolsCalls: number;
  cultivos: { especie: string; phase: number; progreso: number }[];
}
export interface ShelterState {
  version: 1;
  created: number;
  name: string;
  doneWelcome: boolean;
  supervisor: { character: string; name: string; accessories: string[]; look?: Look };
  reposRoot: string;
  sessionLimit: number;
  language?: Language;              // el de los textos del juego (shared/language.ts); sin él, español
  rooms: SavedRoom[];
  dwellers: SavedDweller[];
  hidden?: HiddenRoom[];       // salas de repo que el Supervisor ha quitado del juego (Cámara acorazada → Salas)
  jugador: Player;
  // campos: datos NO secretos de cada fuente (URL, IDs…); secretos: solo los NOMBRES de lo guardado en el llavero
  integrations: Record<string, { mode: 'off' | 'demo' | 'real'; options?: Record<string, unknown>; fields?: Record<string, string>; secrets?: string[] }>;
  viewsNotifications: string[];
  settings: Record<string, unknown>;
}


// Dónde suele tener uno sus repos (para las sugerencias de la Puerta): la primera de estas carpetas que exista
export function rootReposDefault() {
  for (const d of ['Sites', 'Developer', 'Projects', 'projects', 'code', 'Code', 'src', 'dev', 'repos', 'git', 'GitHub'])
    if (existsSync(path.join(os.homedir(), d))) return '~/' + d;
  return '~';
}

export function initialState(): ShelterState {
  const gameRoot = path.resolve(import.meta.dirname, '..');
  // sin salas de repo: las trae la raíz de repos al elegirla en la bienvenida
  const rooms: SavedRoom[] = INITIAL_ROOMS.map(x => ({ ...x, path: x.type === 'puente' ? gameRoot : undefined }));
  const dwellers: SavedDweller[] = INITIAL_DWELLERS.map(h => ({ ...h }));
  const defaultRoot = rootReposDefault();
  for (const s of rooms) if (s.id === PLANNING_ROOM) s.path = reposRoot({ reposRoot: defaultRoot });
  return {
    version: 1, created: Date.now(), name: GAME_NAME, doneWelcome: false,
    supervisor: { character: 'Protagonist_B', name: 'Supervisor', accessories: [] },
    reposRoot: defaultRoot, sessionLimit: 6, rooms, dwellers,
    jugador: { scrap: 40, inventario: {}, outfit: [], tienda: [], records: {}, achievements: [], finishedTasks: 0, toolsCalls: 0, cultivos: [{ especie: 'Lettuce', phase: 3, progreso: 0 }, { especie: 'Carrot', phase: 4, progreso: 0 }, { especie: 'Corn', phase: 2, progreso: 0 }] },
    // sin datos de mentira: cada fuente, apagada hasta que se conecta en la cámara acorazada (o se elige DEMO). Ni las que
    // no piden nada (Mail y Calendario del Mac, GitHub con gh) leen nada sin que lo digas
    integrations: Object.fromEntries(SOURCES.map(f => [f, { mode: 'off' as const }])),
    viewsNotifications: [], settings: {},
  };
}

// Toda sala tiene carpeta de trabajo, donde sus habitantes lanzan Claude Code y se abre su terminal: la suya (repo,
// ala, el propio juego) o, en las salas especiales (logística, comunicaciones, hidroponía…), una propia fuera de
// cualquier repo, para que Claude Code no herede el git ni el CLAUDE.md del juego. Con SHELTER_DATOS (pruebas), dentro
// de esos datos.
export const ROOMS_FOLDERS = process.env.SHELTER_DATOS ? path.join(DATA, 'salas') : path.join(os.homedir(), 'Library', 'Application Support', 'work-shelter-public', 'salas');
export function folderOf(s: SavedRoom) { return s.path ?? path.join(ROOMS_FOLDERS, s.id); }
/** Salas de servicio de serie que le faltan a un refugio guardado: entran en su sitio (el resto se recoloca). */
export function addRoomsOfService(e: ShelterState) {
  const missing = INITIAL_ROOMS.filter(s => s.id === PLANNING_ROOM ? !e.rooms.some(x => x.id === s.id) : !isRoomOfRepo(s.type) && !e.rooms.some(x => x.type === s.type || x.id === s.id));
  if (missing.length) e.rooms = distribute([...e.rooms, ...missing.map(x => ({ ...x }) as SavedRoom)]);
  // con la disposición a mano, las nuevas irían al final de los repos: cada una, junto a la que tiene al lado de serie
  if (missing.length && e.rooms.some(s => s.manual)) for (const f of missing) {
    const stock = (orden?: number) => INITIAL_ROOMS.find(i => i.id !== f.id && i.floor === f.floor && i.side === f.side && (orden === undefined || i.orden === orden));
    const neighboring = e.rooms.find(s => s.id === (stock(f.orden - 1) ?? stock())?.id);
    if (!neighboring) continue;
    const orden = e.rooms.filter(s => s.id !== f.id && s.floor === neighboring.floor && s.side === neighboring.side).length;
    e.rooms = (placeRoom(e.rooms, f.id, { floor: neighboring.floor, side: neighboring.side, orden }) ?? e.rooms) as SavedRoom[];
  }
  return missing.length > 0;
}
/** La carpeta de la sala de planificación: la raíz de repos del refugio (se define una vez, en la cámara acorazada) */
export const reposRoot = (e: { reposRoot: string }) => path.resolve(e.reposRoot.replace(/^~(?=$|\/)/, os.homedir()));
export function ensureFolders(e: ShelterState) {
  for (const s of e.rooms) if (s.id === PLANNING_ROOM) s.path = reposRoot(e);
  for (const s of e.rooms) { s.folder = folderOf(s); if (!s.path) try { mkdirSync(s.folder, { recursive: true }); } catch (err) { console.error(`No pude crear la carpeta de ${s.name}:`, (err as Error).message); } }
}

export class Store {
  state: ShelterState;
  private file = path.join(DATA, 'refugio.json');
  private pending: NodeJS.Timeout | null = null;
  constructor() {
    // los datos del refugio (estado, token, adjuntos, transcripciones…), solo para tu usuario; también si ya existían
    mkdirSync(DATA, { recursive: true, mode: 0o700 }); try { chmodSync(DATA, 0o700); } catch {}
    let e: ShelterState | null = null;
    if (existsSync(this.file)) { try { e = JSON.parse(readFileSync(this.file, 'utf8')); } catch (err) { console.error('El estado guardado está dañado; se guarda una copia y se empieza de cero.', err); try { renameSync(this.file, this.file + '.danado-' + Date.now()); } catch {} } }
    if (e) {
      try { e = sanitize(e); }
      catch (err) { console.error('El estado guardado no tiene la forma esperada; se guarda una copia y se empieza de cero.', err); try { renameSync(this.file, this.file + '.danado-' + Date.now()); } catch {} e = null; }
    }
    this.state = e ?? initialState();
    if (!e) this.saveAlready();
    else this.save();   // un refugio de antes queda guardado ya con la disposición nueva
    // salas de servicio de serie que falten en un refugio guardado: entran en su sitio y el resto se recoloca. No se
    // retiran, así que si falta una es que no la tenía
    if (e && addRoomsOfService(this.state)) this.save();
    // habitantes de serie que falten en un refugio guardado, solo si su sala está vacía: una sala, un habitante
    if (e) for (const h of INITIAL_DWELLERS) if (!this.state.dwellers.some(x => x.id === h.id || x.roomId === h.roomId) && this.state.rooms.some(sl => sl.id === h.roomId)) this.state.dwellers.push({ ...h });
    distinctLooks(this.state.dwellers, this.state.supervisor);   // nadie con la pinta del Supervisor ni de otro
    ensureFolders(this.state);
  }
  // tras cualquier cambio (un recluta, el Supervisor cambia de aspecto…), nadie se queda con la pinta de otro
  change(f: (e: ShelterState) => void) { f(this.state); distinctLooks(this.state.dwellers, this.state.supervisor); ensureFolders(this.state); this.save(); }
  save() { if (this.pending) return; this.pending = setTimeout(() => { this.pending = null; this.saveAlready(); }, 400); }
  saveAlready() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, this.file); }
  restart() { this.state = initialState(); distinctLooks(this.state.dwellers, this.state.supervisor); ensureFolders(this.state); this.saveAlready(); }
}

// El estado guardado se valida campo a campo: lo que no cuadra se descarta o vuelve a su valor inicial.
// Si falta lo imprescindible (salas), se lanza y el almacén aparta la copia y arranca de cero.
// nombres de antes: la agenda se llamaba «Planificación»; y el tablero de tareas (tipo 'logistica') y la sala que
// planifica y reparte (tipo 'coordinacion', y sus alas) llevaban el nombre la una de la otra
function savedName(type: string, name: string): string {
  if (type === 'planificacion' && name === 'Planificación') return 'Agenda';
  if (type === 'logistica' && name === 'Logística') return 'Planificación';
  if (type === 'coordinacion' && (name === 'Planificación' || name.startsWith('Planificación '))) return 'Logística' + name.slice('Planificación'.length);
  return name;
}

export function sanitize(e: any): ShelterState {
  const start = initialState();
  if (!e || typeof e !== 'object') throw new Error('no es un objeto');
  const arr = (v: unknown) => (Array.isArray(v) ? v : null);
  const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
  // el sitio de cada sala se recalcula (así un refugio de antes se recoloca al cargar), salvo si se movió a mano en el plano
  const read = (arr(e.rooms) ?? []).filter((x: any) => x && typeof x.id === 'string' && typeof x.type === 'string' && Number.isInteger(x.floor) && x.floor >= 0 && (x.side === 'izq' || x.side === 'der') && Number.isInteger(x.orden) && x.orden >= 0)
    .map((x: any) => ({ id: x.id, type: x.type, name: savedName(x.type, str(x.name, x.id)), path: typeof x.path === 'string' ? x.path : undefined, floor: x.floor, side: x.side, orden: x.orden, ...(x.manual === true ? { manual: true } : {}), variant: str(x.variant, 'neutro'), style: typeof x.style === 'string' ? x.style : undefined,
      // el área de un repo de antes sale de su tipo de proyecto (luego se cambia en el panel de la sala)
      ...(isRoomOfRepo(x.type) && x.id !== PLANNING_ROOM ? { area: isArea(x.area) ? x.area : areaByType(typeof x.path === 'string' ? projectType(x.path) : '') } : {}),
      ...(isRoomOfRepo(x.type) && x.decor ? { decor: sanitizeDecor(x.decor).decor ?? undefined } : {}) }) as SavedRoom);
  if (!read.length) throw new Error('sin salas');
  const rooms = distribute(read);
  const ids = new Set(rooms.map((x: any) => x.id));
  const dwellers = tonesForRepeated((arr(e.dwellers) ?? []).filter((h: any) => h && typeof h.id === 'string' && typeof h.roomId === 'string' && ids.has(h.roomId))
    .map((h: any) => ({ ...h, name: str(h.name, h.id), nickname: str(h.nickname, ''), type: str(h.type, 'Hiker'), bio: str(h.bio, ''), voice: Number.isFinite(h.voice) ? h.voice : 120, tone: Number.isFinite(h.tone) && h.tone > 0 ? Math.min(359, Math.max(1, Math.round(h.tone) % 360 || 1)) : undefined, accessories: arr(h.accessories)?.filter((a: unknown) => typeof a === 'string'), look: sanitizeLook(h.look) ?? undefined })));   // un refugio guardado tampoco tiene gemelos
  // las ocultas: solo salas de repo bien formadas, sin repetir una que ya está a la vista
  const hidden = (arr(e.hidden) ?? []).filter((o: any) => o?.room && typeof o.room.id === 'string' && typeof o.room.path === 'string' && isRoomOfRepo(o.room.type) && o.room.id !== PLANNING_ROOM && !ids.has(o.room.id) && !rooms.some(x => x.path === o.room.path))
    .map((o: any) => ({ room: o.room as SavedRoom, dwellers: (arr(o.dwellers) ?? []).filter((h: any) => h && typeof h.id === 'string' && h.roomId === o.room.id) as SavedDweller[] }));
  const pv = e.jugador && typeof e.jugador === 'object' ? e.jugador : {};
  const num = (v: unknown, def: number) => (Number.isFinite(v) ? (v as number) : def);
  const objNum = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v as object : {}).filter(([, n]) => Number.isFinite(n)));
  const jugador = {
    ...start.jugador, ...pv,
    scrap: Math.max(0, num(pv.scrap, start.jugador.scrap)), inventario: objNum(pv.inventario), records: objNum(pv.records),
    outfit: arr(pv.outfit)?.filter((x: unknown) => typeof x === 'string') ?? [], tienda: arr(pv.tienda)?.filter((x: unknown) => typeof x === 'string') ?? [],
    achievements: arr(pv.achievements) ?? [], finishedTasks: num(pv.finishedTasks, 0), toolsCalls: num(pv.toolsCalls, 0),
    cultivos: (arr(pv.cultivos) ?? start.jugador.cultivos).filter((c: any) => c && typeof c.especie === 'string').map((c: any) => ({ especie: c.especie, phase: Math.max(1, Math.min(4, num(c.phase, 1))), progreso: Math.max(0, num(c.progreso, 0)) })),
  };
  if (!jugador.cultivos.length) jugador.cultivos = start.jugador.cultivos;
  const integrations = e.integrations && typeof e.integrations === 'object' ? e.integrations : start.integrations;
  for (const k of Object.keys(start.integrations)) if (!integrations[k] || typeof integrations[k] !== 'object') integrations[k] = { mode: 'off' };
  for (const k of Object.keys(integrations)) if (!(SOURCES as readonly string[]).includes(k)) delete integrations[k];   // fuentes que no son del catálogo
  const sup = e.supervisor && typeof e.supervisor === 'object' ? e.supervisor : {};
  return {
    ...start, ...e,
    version: 1, created: num(e.created, Date.now()), name: !e.name || e.name === 'Refugio' ? start.name : str(e.name, start.name), doneWelcome: e.doneWelcome === true,
    supervisor: { character: str(sup.character, start.supervisor.character), name: str(sup.name, 'Supervisor'), accessories: arr(sup.accessories)?.filter((a: unknown) => typeof a === 'string') ?? [], look: sanitizeLook(sup.look) ?? undefined },
    reposRoot: str(e.reposRoot, start.reposRoot), sessionLimit: Math.max(1, Math.min(20, num(e.sessionLimit, start.sessionLimit))), ...(isLanguage(e.language) ? { language: e.language } : {}),
    rooms, dwellers, hidden, jugador, integrations,
    viewsNotifications: (arr(e.viewsNotifications) ?? []).filter((x: unknown) => typeof x === 'string').slice(-3000),
    settings: e.settings && typeof e.settings === 'object' ? e.settings : {},
  };
}

// ---------------------------------------------------------------- salas ocultas
// Ocultar una sala de repo la saca del juego: deja de tener sitio (la planta que se queda sin salas desaparece) y sus
// habitantes se van con ella. Volver a mostrarla la mete donde le toque (la de serie la coloca por orden alfabético; a
// mano, al final de la última planta de repos). Devuelven false si no se puede (no existe, o no es una sala de repo).
export const isHideable = (s: { id: string; type: string }) => isRoomOfRepo(s.type) && s.id !== PLANNING_ROOM;
export function hideRoom(e: ShelterState, id: string): boolean {
  const room = e.rooms.find(s => s.id === id);
  if (!room || !isHideable(room) || !room.path) return false;
  const { floor: _p, side: _l, orden: _o, manual: _m, folder: _c, ...saved } = room;
  e.hidden = [...(e.hidden ?? []).filter(o => o.room.id !== id), { room: saved as SavedRoom, dwellers: e.dwellers.filter(h => h.roomId === id) }];
  e.dwellers = e.dwellers.filter(h => h.roomId !== id);
  e.rooms = distribute(e.rooms.filter(s => s.id !== id));
  return true;
}
export function showRoom(e: ShelterState, id: string): boolean {
  const o = e.hidden?.find(x => x.room.id === id);
  if (!o) return false;
  e.hidden = e.hidden!.filter(x => x !== o);
  // su carpeta ya volvió a ser sala por otro camino (la Puerta): se queda esa
  if (e.rooms.some(s => s.id === id || s.path === o.room.path)) return true;
  e.rooms = distribute([...e.rooms, { ...o.room, floor: 0, side: 'izq', orden: 0 }]);
  for (const h of o.dwellers) if (!e.dwellers.some(x => x.id === h.id)) e.dwellers.push(h);
  return true;
}

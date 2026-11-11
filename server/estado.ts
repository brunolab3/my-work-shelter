// Estado persistente del refugio (en local, en .data/refugio.json): salas, habitantes, disposición, ajustes,
// progreso del jugador, récords, notificaciones vistas. Las credenciales NO van aquí (llavero de macOS).
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { migrateKeys, MIGRATION_STEP } from '../shared/migrateKeys.ts';
import { LEGACY_KEYS } from '../shared/legacyKeys.ts';
import path from 'node:path';
import os from 'node:os';
import { INITIAL_ROOMS, INITIAL_DWELLERS } from '../shared/refugioInicial.ts';
import { GAME_NAME } from '../shared/protocolo.ts';
import { tonesForRepeated, distinctLooks } from '../shared/reclutas.ts';
import { distribute, placeRoom, isRoomOfRepo, PLANNING_ROOM } from '../shared/disposicion.ts';
import { sanitizeLook, type Look } from '../shared/aspecto.ts';
import { SOURCES } from './integraciones/adaptadores.ts';
import { sanitizeDecor, type Decorado } from '../shared/decorado.ts';
import { projectType } from './repos.ts';
import { areaByType, isArea, type AreaRepo } from '../shared/sectores.ts';
import { isLanguage, type Idioma } from '../shared/idioma.ts';

export const DATOS = path.resolve(process.env.SHELTER_DATOS || path.join(import.meta.dirname, '..', '.data'));
// los archivos de .data guardados con las claves en español (antes de pasar el código a inglés) se ponen al día una vez,
// antes de que nadie los lea; la marca evita repetirlo y queda una copia de cada uno (shared/migrateKeys.ts)
try {
  // marca: el último paso aplicado («.claves-en» sin número es el primero)
  const marca = path.join(DATOS, '.claves-en'), marca2 = path.join(DATOS, '.claves-en-paso');
  const hecho = existsSync(marca2) ? Number(readFileSync(marca2, 'utf8')) || 1 : existsSync(marca) ? 1 : 0;
  // la comprobación de «Reiniciar el juego» (SHELTER_COMPROBAR) carga este módulo con el servidor viejo aún en marcha: si
  // migrara aquí, el viejo guardaría después su estado con las claves de antes encima
  if (hecho === 1 && !process.env.SHELTER_COMPROBAR) repairMixedState(DATOS);
  if (existsSync(DATOS) && hecho < MIGRATION_STEP && !process.env.SHELTER_COMPROBAR) {
    for (const n of readdirSync(DATOS)) {
      if (!n.endsWith('.json')) continue;
      const f = path.join(DATOS, n);
      try { const viejo = readFileSync(f, 'utf8'); writeFileSync(`${f}.antes-de-ingles-${hecho + 1}`, viejo, { mode: 0o600 }); writeFileSync(f, JSON.stringify(migrateKeys(JSON.parse(viejo), hecho), null, 2), { mode: 0o600 }); } catch (e) { console.error('No se pudo migrar ' + n + ':', e); }
    }
    writeFileSync(marca2, String(MIGRATION_STEP));
  }
} catch (e) { console.error('Migración de claves:', e); }

// El primer paso de la migración corrió en la comprobación del reinicio y el servidor viejo guardó luego su estado con las
// claves de antes: refugio.json quedó mezclado (claves viejas junto a las nuevas, y lo que la validación nueva no encontró,
// a sus valores por defecto). Se rehace una vez: cada par viejo/nuevo se junta (listas unidas, contadores al máximo,
// objetos combinados; si no, el nuevo) y lo que falta, la paleta y el decorado de cada sala salen de la copia de antes
function repairMixedState(dir: string) {
  const f = path.join(dir, 'refugio.json'), copia = f + '.antes-de-ingles';
  if (!existsSync(f) || !existsSync(copia)) return;
  const cur = JSON.parse(readFileSync(f, 'utf8'));
  const mezcla = (x: any): boolean => Array.isArray(x) ? x.some(mezcla) : !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) => Object.hasOwn(LEGACY_KEYS, k) || mezcla(v));
  if (!mezcla(cur)) return;
  const juntar = (x: any): any => {
    if (Array.isArray(x)) return x.map(juntar);
    if (!x || typeof x !== 'object') return x;
    const out: any = {};
    for (const [k, v] of Object.entries(x)) if (!Object.hasOwn(LEGACY_KEYS, k)) out[k] = juntar(v);
    for (const [k, v] of Object.entries(x)) {
      if (!Object.hasOwn(LEGACY_KEYS, k)) continue;
      const n = LEGACY_KEYS[k], viejo = juntar(v), nuevo = out[n];
      out[n] = nuevo === undefined ? viejo : Array.isArray(viejo) && Array.isArray(nuevo) ? [...new Set([...viejo, ...nuevo].map(y => JSON.stringify(y)))].map(y => JSON.parse(y))
        : typeof viejo === 'number' && typeof nuevo === 'number' ? Math.max(viejo, nuevo) : viejo && nuevo && typeof viejo === 'object' && typeof nuevo === 'object' ? { ...viejo, ...nuevo } : nuevo;
    }
    return out;
  };
  const renombrar = (x: any): any => Array.isArray(x) ? x.map(renombrar) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [Object.hasOwn(LEGACY_KEYS, k) ? LEGACY_KEYS[k] : k, renombrar(v)])) : x;
  const base = renombrar(JSON.parse(readFileSync(copia, 'utf8')));
  // lo que falta, de la copia (las listas de objetos con id, emparejadas por id)
  const rellenar = (x: any, b: any): any => {
    if (Array.isArray(x) && Array.isArray(b)) return x.map(y => (y && typeof y === 'object' && 'id' in y ? rellenar(y, b.find(z => z?.id === y.id)) : y));
    if (!x || typeof x !== 'object' || !b || typeof b !== 'object') return x;
    const out: any = { ...x };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? rellenar(out[k], v) : v;
    return out;
  };
  const arreglado = rellenar(juntar(cur), base);
  for (const sala of arreglado.salas ?? []) { const b = (base.salas ?? []).find((y: any) => y.id === sala.id); if (b?.variant) sala.variant = b.variant; if (b?.decorado) sala.decorado = b.decorado; }
  writeFileSync(f + '.antes-de-reparar', readFileSync(f, 'utf8'), { mode: 0o600 });
  writeFileSync(f, JSON.stringify(arreglado, null, 2), { mode: 0o600 });
  console.log('refugio.json reparado (estaba mezclado tras el primer paso de la migración).');
}

export interface SavedRoom {
  id: string;
  tipo: 'repo' | 'coordinacion' | 'comunicaciones' | 'planificacion' | 'logistica' | 'git' | 'puente' | 'camara' | 'puerta' | 'hidroponia' | 'galeria' | 'discoteca' | 'chapa';
  nombre: string;
  ruta?: string;                // carpeta (salas de repo, coordinación, Puente de Mando)
  carpeta?: string;             // carpeta de trabajo: la ruta o, en las especiales, una propia (no se guarda a mano: carpetaDe)
  planta: number;               // 0 = planta baja (a pie de calle); 1 = -1…  Lo calcula `distribuir`
  lado: 'izq' | 'der';          // a qué lado del ascensor
  orden: number;                // posición en su lado (0 = junto al ascensor)
  manual?: boolean;             // su sitio lo ha puesto el Supervisor desde el plano (disposición a mano)
  variant: string;             // paleta
  estilo?: string;
  area?: AreaRepo;               // repos: frontend, backend o servicio crítico (su sector y su color)
  decorado?: Decorado;          // la escena que le ha diseñado su habitante («Adaptar la sala al repo»); sin él, su plantilla
}
export interface SavedDweller { id: string; nombre: string; mote: string; tipo: string; bio: string; salaId: string; tinte?: string; tone?: number; voz: number; lastSession?: string; accesorios?: string[]; aspecto?: Look }
export interface Player {
  scrap: number; inventario: Record<string, number>; outfit: string[]; tienda: string[];
  records: Record<string, number>; achievements: string[]; finishedTasks: number; toolsCalls: number;
  cultivos: { especie: string; phase: number; progreso: number }[];
}
export interface ShelterState {
  version: 1;
  creado: number;
  nombre: string;
  doneWelcome: boolean;
  supervisor: { personaje: string; nombre: string; accesorios: string[]; aspecto?: Look };
  raizRepos: string;
  limiteSesiones: number;
  idioma?: Idioma;              // el de los textos del juego (shared/idioma.ts); sin él, español
  salas: SavedRoom[];
  habitantes: SavedDweller[];
  jugador: Player;
  // campos: datos NO secretos de cada fuente (URL, IDs…); secretos: solo los NOMBRES de lo guardado en el llavero
  integraciones: Record<string, { modo: 'off' | 'demo' | 'real'; opciones?: Record<string, unknown>; campos?: Record<string, string>; secrets?: string[] }>;
  viewsNotifications: string[];
  ajustes: Record<string, unknown>;
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
  const salas: SavedRoom[] = INITIAL_ROOMS.map(x => ({ ...x, ruta: x.tipo === 'puente' ? gameRoot : undefined }));
  const habitantes: SavedDweller[] = INITIAL_DWELLERS.map(h => ({ ...h }));
  const raizRepos = rootReposDefault();
  for (const s of salas) if (s.id === PLANNING_ROOM) s.ruta = reposRoot({ raizRepos });
  return {
    version: 1, creado: Date.now(), nombre: GAME_NAME, doneWelcome: false,
    supervisor: { personaje: 'Protagonist_B', nombre: 'Supervisor', accesorios: [] },
    raizRepos, limiteSesiones: 6, salas, habitantes,
    jugador: { scrap: 40, inventario: {}, outfit: [], tienda: [], records: {}, achievements: [], finishedTasks: 0, toolsCalls: 0, cultivos: [{ especie: 'Lettuce', phase: 3, progreso: 0 }, { especie: 'Carrot', phase: 4, progreso: 0 }, { especie: 'Corn', phase: 2, progreso: 0 }] },
    // sin datos de mentira: cada fuente, apagada hasta que se conecta en la cámara acorazada (o se elige DEMO). Ni las que
    // no piden nada (Mail y Calendario del Mac, GitHub con gh) leen nada sin que lo digas
    integraciones: Object.fromEntries(SOURCES.map(f => [f, { modo: 'off' as const }])),
    viewsNotifications: [], ajustes: {},
  };
}

// Toda sala tiene carpeta de trabajo, donde sus habitantes lanzan Claude Code y se abre su terminal: la suya (repo,
// ala, el propio juego) o, en las salas especiales (logística, comunicaciones, hidroponía…), una propia fuera de
// cualquier repo, para que Claude Code no herede el git ni el CLAUDE.md del juego. Con SHELTER_DATOS (pruebas), dentro
// de esos datos.
export const ROOMS_FOLDERS = process.env.SHELTER_DATOS ? path.join(DATOS, 'salas') : path.join(os.homedir(), 'Library', 'Application Support', 'work-shelter-public', 'salas');
export function folderOf(s: SavedRoom) { return s.ruta ?? path.join(ROOMS_FOLDERS, s.id); }
/** Salas de servicio de serie que le faltan a un refugio guardado: entran en su sitio (el resto se recoloca). */
export function addRoomsOfService(e: ShelterState) {
  const faltan = INITIAL_ROOMS.filter(s => s.id === PLANNING_ROOM ? !e.salas.some(x => x.id === s.id) : !isRoomOfRepo(s.tipo) && !e.salas.some(x => x.tipo === s.tipo || x.id === s.id));
  if (faltan.length) e.salas = distribute([...e.salas, ...faltan.map(x => ({ ...x }) as SavedRoom)]);
  // con la disposición a mano, las nuevas irían al final de los repos: cada una, junto a la que tiene al lado de serie
  if (faltan.length && e.salas.some(s => s.manual)) for (const f of faltan) {
    const stock = (orden?: number) => INITIAL_ROOMS.find(i => i.id !== f.id && i.planta === f.planta && i.lado === f.lado && (orden === undefined || i.orden === orden));
    const neighboring = e.salas.find(s => s.id === (stock(f.orden - 1) ?? stock())?.id);
    if (!neighboring) continue;
    const orden = e.salas.filter(s => s.id !== f.id && s.planta === neighboring.planta && s.lado === neighboring.lado).length;
    e.salas = (placeRoom(e.salas, f.id, { planta: neighboring.planta, lado: neighboring.lado, orden }) ?? e.salas) as SavedRoom[];
  }
  return faltan.length > 0;
}
/** La carpeta de la sala de planificación: la raíz de repos del refugio (se define una vez, en la cámara acorazada) */
export const reposRoot = (e: { raizRepos: string }) => path.resolve(e.raizRepos.replace(/^~(?=$|\/)/, os.homedir()));
export function ensureFolders(e: ShelterState) {
  for (const s of e.salas) if (s.id === PLANNING_ROOM) s.ruta = reposRoot(e);
  for (const s of e.salas) { s.carpeta = folderOf(s); if (!s.ruta) try { mkdirSync(s.carpeta, { recursive: true }); } catch (err) { console.error(`No pude crear la carpeta de ${s.nombre}:`, (err as Error).message); } }
}

export class Store {
  estado: ShelterState;
  private archivo = path.join(DATOS, 'refugio.json');
  private pending: NodeJS.Timeout | null = null;
  constructor() {
    // los datos del refugio (estado, token, adjuntos, transcripciones…), solo para tu usuario; también si ya existían
    mkdirSync(DATOS, { recursive: true, mode: 0o700 }); try { chmodSync(DATOS, 0o700); } catch {}
    let e: ShelterState | null = null;
    if (existsSync(this.archivo)) { try { e = JSON.parse(readFileSync(this.archivo, 'utf8')); } catch (err) { console.error('El estado guardado está dañado; se guarda una copia y se empieza de cero.', err); try { renameSync(this.archivo, this.archivo + '.danado-' + Date.now()); } catch {} } }
    if (e) {
      try { e = sanear(e); }
      catch (err) { console.error('El estado guardado no tiene la forma esperada; se guarda una copia y se empieza de cero.', err); try { renameSync(this.archivo, this.archivo + '.danado-' + Date.now()); } catch {} e = null; }
    }
    this.estado = e ?? initialState();
    if (!e) this.saveAlready();
    else this.guardar();   // un refugio de antes queda guardado ya con la disposición nueva
    // salas de servicio de serie que falten en un refugio guardado: entran en su sitio y el resto se recoloca. No se
    // retiran, así que si falta una es que no la tenía
    if (e && addRoomsOfService(this.estado)) this.guardar();
    // habitantes de serie que falten en un refugio guardado, solo si su sala está vacía: una sala, un habitante
    if (e) for (const h of INITIAL_DWELLERS) if (!this.estado.habitantes.some(x => x.id === h.id || x.salaId === h.salaId) && this.estado.salas.some(sl => sl.id === h.salaId)) this.estado.habitantes.push({ ...h });
    distinctLooks(this.estado.habitantes, this.estado.supervisor);   // nadie con la pinta del Supervisor ni de otro
    ensureFolders(this.estado);
  }
  // tras cualquier cambio (un recluta, el Supervisor cambia de aspecto…), nadie se queda con la pinta de otro
  cambiar(f: (e: ShelterState) => void) { f(this.estado); distinctLooks(this.estado.habitantes, this.estado.supervisor); ensureFolders(this.estado); this.guardar(); }
  guardar() { if (this.pending) return; this.pending = setTimeout(() => { this.pending = null; this.saveAlready(); }, 400); }
  saveAlready() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify(this.estado, null, 1), { mode: 0o600 }); chmodSync(tmp, 0o600); renameSync(tmp, this.archivo); }
  reiniciar() { this.estado = initialState(); distinctLooks(this.estado.habitantes, this.estado.supervisor); ensureFolders(this.estado); this.saveAlready(); }
}

// El estado guardado se valida campo a campo: lo que no cuadra se descarta o vuelve a su valor inicial.
// Si falta lo imprescindible (salas), se lanza y el almacén aparta la copia y arranca de cero.
// nombres de antes: la agenda se llamaba «Planificación»; y el tablero de tareas (tipo 'logistica') y la sala que
// planifica y reparte (tipo 'coordinacion', y sus alas) llevaban el nombre la una de la otra
function savedName(tipo: string, nombre: string): string {
  if (tipo === 'planificacion' && nombre === 'Planificación') return 'Agenda';
  if (tipo === 'logistica' && nombre === 'Logística') return 'Planificación';
  if (tipo === 'coordinacion' && (nombre === 'Planificación' || nombre.startsWith('Planificación '))) return 'Logística' + nombre.slice('Planificación'.length);
  return nombre;
}

export function sanear(e: any): ShelterState {
  const ini = initialState();
  if (!e || typeof e !== 'object') throw new Error('no es un objeto');
  const arr = (v: unknown) => (Array.isArray(v) ? v : null);
  const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
  // el sitio de cada sala se recalcula (así un refugio de antes se recoloca al cargar), salvo si se movió a mano en el plano
  const leidas = (arr(e.salas) ?? []).filter((x: any) => x && typeof x.id === 'string' && typeof x.tipo === 'string' && Number.isInteger(x.planta) && x.planta >= 0 && (x.lado === 'izq' || x.lado === 'der') && Number.isInteger(x.orden) && x.orden >= 0)
    .map((x: any) => ({ id: x.id, tipo: x.tipo, nombre: savedName(x.tipo, str(x.nombre, x.id)), ruta: typeof x.ruta === 'string' ? x.ruta : undefined, planta: x.planta, lado: x.lado, orden: x.orden, ...(x.manual === true ? { manual: true } : {}), variant: str(x.variant, 'neutro'), estilo: typeof x.estilo === 'string' ? x.estilo : undefined,
      // el área de un repo de antes sale de su tipo de proyecto (luego se cambia en el panel de la sala)
      ...(isRoomOfRepo(x.tipo) && x.id !== PLANNING_ROOM ? { area: isArea(x.area) ? x.area : areaByType(typeof x.ruta === 'string' ? projectType(x.ruta) : '') } : {}),
      ...(isRoomOfRepo(x.tipo) && x.decorado ? { decorado: sanitizeDecor(x.decorado).decorado ?? undefined } : {}) }) as SavedRoom);
  if (!leidas.length) throw new Error('sin salas');
  const salas = distribute(leidas);
  const ids = new Set(salas.map((x: any) => x.id));
  const habitantes = tonesForRepeated((arr(e.habitantes) ?? []).filter((h: any) => h && typeof h.id === 'string' && typeof h.salaId === 'string' && ids.has(h.salaId))
    .map((h: any) => ({ ...h, nombre: str(h.nombre, h.id), mote: str(h.mote, ''), tipo: str(h.tipo, 'Hiker'), bio: str(h.bio, ''), voz: Number.isFinite(h.voz) ? h.voz : 120, tone: Number.isFinite(h.tone) && h.tone > 0 ? Math.min(359, Math.max(1, Math.round(h.tone) % 360 || 1)) : undefined, accesorios: arr(h.accesorios)?.filter((a: unknown) => typeof a === 'string'), aspecto: sanitizeLook(h.aspecto) ?? undefined })));   // un refugio guardado tampoco tiene gemelos
  const jv = e.jugador && typeof e.jugador === 'object' ? e.jugador : {};
  const num = (v: unknown, def: number) => (Number.isFinite(v) ? (v as number) : def);
  const objNum = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v as object : {}).filter(([, n]) => Number.isFinite(n)));
  const jugador = {
    ...ini.jugador, ...jv,
    scrap: Math.max(0, num(jv.scrap, ini.jugador.scrap)), inventario: objNum(jv.inventario), records: objNum(jv.records),
    outfit: arr(jv.outfit)?.filter((x: unknown) => typeof x === 'string') ?? [], tienda: arr(jv.tienda)?.filter((x: unknown) => typeof x === 'string') ?? [],
    achievements: arr(jv.achievements) ?? [], finishedTasks: num(jv.finishedTasks, 0), toolsCalls: num(jv.toolsCalls, 0),
    cultivos: (arr(jv.cultivos) ?? ini.jugador.cultivos).filter((c: any) => c && typeof c.especie === 'string').map((c: any) => ({ especie: c.especie, phase: Math.max(1, Math.min(4, num(c.phase, 1))), progreso: Math.max(0, num(c.progreso, 0)) })),
  };
  if (!jugador.cultivos.length) jugador.cultivos = ini.jugador.cultivos;
  const integraciones = e.integraciones && typeof e.integraciones === 'object' ? e.integraciones : ini.integraciones;
  for (const k of Object.keys(ini.integraciones)) if (!integraciones[k] || typeof integraciones[k] !== 'object') integraciones[k] = { modo: 'off' };
  for (const k of Object.keys(integraciones)) if (!(SOURCES as readonly string[]).includes(k)) delete integraciones[k];   // fuentes que no son del catálogo
  const sup = e.supervisor && typeof e.supervisor === 'object' ? e.supervisor : {};
  return {
    ...ini, ...e,
    version: 1, creado: num(e.creado, Date.now()), nombre: !e.nombre || e.nombre === 'Refugio' ? ini.nombre : str(e.nombre, ini.nombre), doneWelcome: e.doneWelcome === true,
    supervisor: { personaje: str(sup.personaje, ini.supervisor.personaje), nombre: str(sup.nombre, 'Supervisor'), accesorios: arr(sup.accesorios)?.filter((a: unknown) => typeof a === 'string') ?? [], aspecto: sanitizeLook(sup.aspecto) ?? undefined },
    raizRepos: str(e.raizRepos, ini.raizRepos), limiteSesiones: Math.max(1, Math.min(20, num(e.limiteSesiones, ini.limiteSesiones))), ...(isLanguage(e.idioma) ? { idioma: e.idioma } : {}),
    salas, habitantes, jugador, integraciones,
    viewsNotifications: (arr(e.viewsNotifications) ?? []).filter((x: unknown) => typeof x === 'string').slice(-3000),
    ajustes: e.ajustes && typeof e.ajustes === 'object' ? e.ajustes : {},
  };
}

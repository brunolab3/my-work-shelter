// Sectores del refugio: la señalética por colores. Cada planta tiene una función (ver layout.ts) y cada función
// tiene un color de familia, como en las tuberías y los pasillos de una instalación industrial. La franja del cartel
// de cada sala, la pintura de sus paredes, el indicador del rellano del ascensor y el plano llevan el color de su
// sector; dentro de un sector, cada sala tiene un tono propio de la misma familia para distinguirla de su vecina.
//   ACCESO     PB       violeta, con franjas de peligro: por aquí entra lo de fuera
//   MANDO      -1       negro: lo que gobierna el refugio y lo que no se toca (credenciales, el código del juego)
//   ENLACE     -2       azul: planificación y lo que conecta con el exterior (agenda, correo, tableros, GitHub)
//   FRONTEND,  -3…      los repos, uno por sala, por su área: verde frontend, amarillo backend y rojo los servicios
//   BACKEND,            críticos. El área sale del tipo de proyecto al reclutar (areaPorTipo) y se cambia en el
//   CRÍTICOS            panel de la sala
//   OCIO       última   naranja: los cultivos, la discoteca, la galería de tiro y Chapa y Pintura
import { isRoomOfRepo, FLOOR_REPOS, PLANNING_ROOM } from './layout.ts';

export type IdSector = 'access' | 'command' | 'link' | RepoArea | 'leisure';
// letra: el color con el que se escribe el sector sobre chapa oscura (el negro de mando no se leería)
export interface Sector { id: IdSector; name: string; code: string; color: string; dark: string; ink: string; letter: string; motto: string }

/** Área de una sala de repo: decide su sector y su color */
export type RepoArea = 'frontend' | 'backend' | 'critical';
export const AREAS: RepoArea[] = ['frontend', 'backend', 'critical'];
export const isArea = (x: unknown): x is RepoArea => AREAS.includes(x as RepoArea);
/** Área de serie según el tipo de proyecto (tipoProyecto en server/repos.ts): lo de JavaScript, frontend; lo demás, backend */
export const areaByType = (type: string): RepoArea => (/^(web|node|vídeo|diseño|escritorio)/.test(type) ? 'frontend' : 'backend');

export const SECTORS: Record<IdSector, Sector> = {
  access: { id: 'access', name: 'ACCESO', code: 'A', color: '#8f62c8', dark: '#462c63', ink: '#120d18', letter: '#a97ee0', motto: 'Entrada y reclutamiento' },
  command: { id: 'command', name: 'MANDO', code: 'M', color: '#2c2e33', dark: '#121315', ink: '#e9e4d8', letter: '#d9d4c8', motto: 'Credenciales y Puente de Mando' },
  link: { id: 'link', name: 'ENLACE', code: 'E', color: '#3f74ad', dark: '#1f3a5a', ink: '#0f141a', letter: '#3f74ad', motto: 'Planificación, agenda, correo, tableros y GitHub' },
  frontend: { id: 'frontend', name: 'FRONTEND', code: 'F', color: '#4f9a4a', dark: '#244a22', ink: '#0e160d', letter: '#5fae59', motto: 'Repos de frontend' },
  backend: { id: 'backend', name: 'BACKEND', code: 'B', color: '#d6b02b', dark: '#6b5714', ink: '#16140f', letter: '#d6b02b', motto: 'Repos de backend' },
  critical: { id: 'critical', name: 'CRÍTICOS', code: 'C', color: '#c0392b', dark: '#5e1a14', ink: '#16140f', letter: '#d9483a', motto: 'Servicios críticos' },
  leisure: { id: 'leisure', name: 'OCIO', code: 'O', color: '#e0862c', dark: '#6f4115', ink: '#16140f', letter: '#e0862c', motto: 'Cultivos, discoteca, tiro al blanco y Chapa y Pintura' },
};
export const SECTORS_ORDER: IdSector[] = ['access', 'command', 'link', 'frontend', 'backend', 'critical', 'leisure'];

const SECTOR_TYPE: Record<string, IdSector> = {
  gate: 'access', disco: 'leisure', vault: 'command', bridge: 'command', comms: 'link', calendar: 'link', logistics: 'link', git: 'link', review: 'link',
  hydroponics: 'leisure', gallery: 'leisure', bodyshop: 'leisure',
};
/** A stock leisure room (disco, crops, shooting gallery, body shop), by its id */
export const isLeisureRoom = (id: string) => SECTOR_TYPE[id] === 'leisure';
// la sala de planificación de serie es de coordinación (tipo de repo) pero está en enlace, con los tableros (por su id);
// un repo sin área todavía (antes de sanear el estado), backend
export const sectorOf = (type: string, id?: string, area?: string): Sector =>
  SECTORS[id === PLANNING_ROOM ? 'link' : isRoomOfRepo(type) ? (isArea(area) ? area : 'backend') : SECTOR_TYPE[type] ?? 'leisure'];

/** Sector de una planta según el orden de layout.ts: PB acceso, -1 mando, -2 enlace, repos (backend) y la última, ocio.
 *  Con las salas (que se pueden mover a mano), el de la mayoría de las suyas; si empatan, el de la más cercana al ascensor */
export function floorSector(floor: number, floors: number, rooms?: { floor: number; type: string; orden: number; id?: string; area?: string }[]): Sector {
  const their = rooms?.filter(s => s.floor === floor).sort((a, b) => a.orden - b.orden) ?? [];
  if (their.length) {
    const count = new Map<Sector, number>();
    for (const s of their) { const sec = sectorOf(s.type, s.id, s.area); count.set(sec, (count.get(sec) ?? 0) + 1); }
    return [...count].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (floor === 0) return SECTORS.access;
  if (floor === 1) return SECTORS.command;
  if (floor === 2) return SECTORS.link;
  return SECTORS[floor >= FLOOR_REPOS && floor < floors - 1 ? 'backend' : 'leisure'];
}

// tono de cada sala dentro de su familia: [acento, acentoOscuro]. Las especiales, por tipo; los repos, el de su área
// (que se vea de un vistazo qué es front, back o crítico)
const TONES: Record<string, [string, string]> = {
  gate: ['#8f62c8', '#462c63'],
  vault: ['#26282c', '#111214'], bridge: ['#34363b', '#17181a'],
  comms: ['#4a86b8', '#244463'], calendar: ['#3a64a3', '#1d3459'], logistics: ['#33789a', '#173d50'], git: ['#4f6fc0', '#263764'], review: ['#5a7fb0', '#2b3f5c'],
  hydroponics: ['#d9802e', '#6b3f16'], disco: ['#ec8f2a', '#74450f'], gallery: ['#c8752f', '#633a17'], bodyshop: ['#e39a45', '#704b1f'],
  [PLANNING_ROOM]: ['#3d6c8f', '#1d3549'],
};
export function roomTone(s: { type: string; id?: string; area?: string }): [string, string] {
  const sec = sectorOf(s.type, s.id, s.area);
  return TONES[s.id === PLANNING_ROOM ? s.id : isRoomOfRepo(s.type) ? '' : s.type] ?? [sec.color, sec.dark];
}

/** Paleta base (paredes y pantallas) de un repo según su estilo: el acento lo pone el sector */
export const STYLE_PALETTE: Record<string, string> = { web: 'web', landing: 'landing', brand: 'brand', video: 'video', studio: 'web', lab: 'comms', foundry: 'logistics', archive: 'taller', generic: 'taller' };

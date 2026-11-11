// Sectores del refugio: la señalética por colores. Cada planta tiene una función (ver disposicion.ts) y cada función
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
import { isRoomOfRepo, FLOOR_REPOS, PLANNING_ROOM } from './disposicion.ts';

export type IdSector = 'acceso' | 'mando' | 'enlace' | AreaRepo | 'ocio';
// letra: el color con el que se escribe el sector sobre chapa oscura (el negro de mando no se leería)
export interface Sector { id: IdSector; nombre: string; codigo: string; color: string; oscuro: string; tinta: string; letra: string; motto: string }

/** Área de una sala de repo: decide su sector y su color */
export type AreaRepo = 'frontend' | 'backend' | 'critico';
export const AREAS: AreaRepo[] = ['frontend', 'backend', 'critico'];
export const isArea = (x: unknown): x is AreaRepo => AREAS.includes(x as AreaRepo);
/** Área de serie según el tipo de proyecto (tipoProyecto en server/repos.ts): lo de JavaScript, frontend; lo demás, backend */
export const areaByType = (tipo: string): AreaRepo => (/^(web|node|vídeo|diseño|escritorio)/.test(tipo) ? 'frontend' : 'backend');

export const SECTORS: Record<IdSector, Sector> = {
  acceso: { id: 'acceso', nombre: 'ACCESO', codigo: 'A', color: '#8f62c8', oscuro: '#462c63', tinta: '#120d18', letra: '#a97ee0', motto: 'Entrada y reclutamiento' },
  mando: { id: 'mando', nombre: 'MANDO', codigo: 'M', color: '#2c2e33', oscuro: '#121315', tinta: '#e9e4d8', letra: '#d9d4c8', motto: 'Credenciales y Puente de Mando' },
  enlace: { id: 'enlace', nombre: 'ENLACE', codigo: 'E', color: '#3f74ad', oscuro: '#1f3a5a', tinta: '#0f141a', letra: '#3f74ad', motto: 'Planificación, agenda, correo, tableros y GitHub' },
  frontend: { id: 'frontend', nombre: 'FRONTEND', codigo: 'F', color: '#4f9a4a', oscuro: '#244a22', tinta: '#0e160d', letra: '#5fae59', motto: 'Repos de frontend' },
  backend: { id: 'backend', nombre: 'BACKEND', codigo: 'B', color: '#d6b02b', oscuro: '#6b5714', tinta: '#16140f', letra: '#d6b02b', motto: 'Repos de backend' },
  critico: { id: 'critico', nombre: 'CRÍTICOS', codigo: 'C', color: '#c0392b', oscuro: '#5e1a14', tinta: '#16140f', letra: '#d9483a', motto: 'Servicios críticos' },
  ocio: { id: 'ocio', nombre: 'OCIO', codigo: 'O', color: '#e0862c', oscuro: '#6f4115', tinta: '#16140f', letra: '#e0862c', motto: 'Cultivos, discoteca, tiro al blanco y Chapa y Pintura' },
};
export const SECTORS_ORDER: IdSector[] = ['acceso', 'mando', 'enlace', 'frontend', 'backend', 'critico', 'ocio'];

const SECTOR_TYPE: Record<string, IdSector> = {
  puerta: 'acceso', discoteca: 'ocio', camara: 'mando', puente: 'mando', comunicaciones: 'enlace', planificacion: 'enlace', logistica: 'enlace', git: 'enlace',
  hidroponia: 'ocio', galeria: 'ocio', chapa: 'ocio',
};
// la sala de planificación de serie es de coordinación (tipo de repo) pero está en enlace, con los tableros (por su id);
// un repo sin área todavía (antes de sanear el estado), backend
export const sectorOf = (tipo: string, id?: string, area?: string): Sector =>
  SECTORS[id === PLANNING_ROOM ? 'enlace' : isRoomOfRepo(tipo) ? (isArea(area) ? area : 'backend') : SECTOR_TYPE[tipo] ?? 'ocio'];

/** Sector de una planta según el orden de disposicion.ts: PB acceso, -1 mando, -2 enlace, repos (backend) y la última, ocio.
 *  Con las salas (que se pueden mover a mano), el de la mayoría de las suyas; si empatan, el de la más cercana al ascensor */
export function floorSector(planta: number, plantas: number, salas?: { planta: number; tipo: string; orden: number; id?: string; area?: string }[]): Sector {
  const their = salas?.filter(s => s.planta === planta).sort((a, b) => a.orden - b.orden) ?? [];
  if (their.length) {
    const cuenta = new Map<Sector, number>();
    for (const s of their) { const sec = sectorOf(s.tipo, s.id, s.area); cuenta.set(sec, (cuenta.get(sec) ?? 0) + 1); }
    return [...cuenta].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (planta === 0) return SECTORS.acceso;
  if (planta === 1) return SECTORS.mando;
  if (planta === 2) return SECTORS.enlace;
  return SECTORS[planta >= FLOOR_REPOS && planta < plantas - 1 ? 'backend' : 'ocio'];
}

// tono de cada sala dentro de su familia: [acento, acentoOscuro]. Las especiales, por tipo; los repos, el de su área
// (que se vea de un vistazo qué es front, back o crítico)
const TONES: Record<string, [string, string]> = {
  puerta: ['#8f62c8', '#462c63'],
  camara: ['#26282c', '#111214'], puente: ['#34363b', '#17181a'],
  comunicaciones: ['#4a86b8', '#244463'], planificacion: ['#3a64a3', '#1d3459'], logistica: ['#33789a', '#173d50'], git: ['#4f6fc0', '#263764'],
  hidroponia: ['#d9802e', '#6b3f16'], discoteca: ['#ec8f2a', '#74450f'], galeria: ['#c8752f', '#633a17'], chapa: ['#e39a45', '#704b1f'],
  [PLANNING_ROOM]: ['#3d6c8f', '#1d3549'],
};
export function roomTone(s: { tipo: string; id?: string; area?: string }): [string, string] {
  const sec = sectorOf(s.tipo, s.id, s.area);
  return TONES[s.id === PLANNING_ROOM ? s.id : isRoomOfRepo(s.tipo) ? '' : s.tipo] ?? [sec.color, sec.oscuro];
}

/** Paleta base (paredes y pantallas) de un repo según su estilo: el acento lo pone el sector */
export const STYLE_PALETTE: Record<string, string> = { web: 'web', landing: 'landing', marca: 'marca', video: 'video', estudio: 'web', laboratorio: 'comms', fundicion: 'logistica', archivo: 'taller', generico: 'taller' };

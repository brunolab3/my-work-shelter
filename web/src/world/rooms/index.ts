// Fábrica de salas: elige el mobiliario según el tipo de cada sala guardada y, en las de repo, su decorado o su estilo.
import { furnishGeneric } from './generic';
import * as THREE from 'three';
import { TEMPLATE_SUBTITLE, TEMPLATE_PANELS, furnishFoundry, furnishLaboratory, furnishStudio, furnishFile } from './templates';
import { furnishDecor } from './decor';
import { baseStock, boardSpot, roomSeed, type BaseDecor, type BoardSpot, type Decor } from '@shared/decor';
import { mountTaskBoard } from './taskBoard';
import { withRoomPanel, panelSpot } from './roomPanel';
import { live } from '../../net/client';
import type { Interactive } from './common';
import { VARIANTS } from '../../engine/palette';
import { ROOM_DESCRIPTION } from '@shared/initialShelter';
import { roomTone, STYLE_PALETTE } from '@shared/sectors';
import { createRoom, type Furnish, type Room, type RoomType } from './common';
import { furnishWebWorkshop } from './webWorkshop';
import { furnishShowcase } from './landing';
import { furnishFileMark } from './brand';
import { furnishProjection } from './video';
import { furnishCommunications, furnishPlanning, furnishLogistics } from './operations';
import { furnishDeployment } from './deploy';
import { furnishReview } from './review';
import { furnishGate } from './service';
import { furnishCamera } from './vault';
import { furnishBridge } from './bridge';
import { furnishHydroponics, furnishGallery } from './leisure';
import { furnishGit } from './git';
import { furnishDisco } from './disco';
import { furnishBodyshop } from './bodyShop';
import { t, tIs } from '@shared/language';
import { PLANNING_ROOM } from '@shared/layout';

export interface SavedRoom { id: string; type: RoomType; name: string; path?: string; floor: number; side: 'left' | 'right'; orden: number; variant: string; style?: string; area?: string; decor?: Decor }

// salas especiales: llevan su descripción en el cartel (la misma del plano)
const SUBTITLES: Record<string, string> = Object.fromEntries(Object.entries(ROOM_DESCRIPTION).map(([k, d]) => [k, tIs(d).toUpperCase()]));

// las escenas de las salas de repo: las plantillas de los reclutas (según el tipo del repo), las hechas a mano y la vacía
// (sobre la que el habitante monta su decorado); cada una con sus paneles de pared, su subtítulo y su luz
const BASES: Record<BaseDecor, { f: Furnish | null; panels?: string[]; sub: string; light?: number }> = {
  studio: { f: furnishStudio, panels: TEMPLATE_PANELS.studio, sub: TEMPLATE_SUBTITLE.studio },
  lab: { f: furnishLaboratory, panels: TEMPLATE_PANELS.lab, sub: TEMPLATE_SUBTITLE.lab },
  foundry: { f: furnishFoundry, panels: TEMPLATE_PANELS.foundry, sub: TEMPLATE_SUBTITLE.foundry },
  archive: { f: furnishFile, panels: TEMPLATE_PANELS.archive, sub: TEMPLATE_SUBTITLE.archive },
  taller: { f: furnishGeneric, panels: TEMPLATE_PANELS.bench, sub: TEMPLATE_SUBTITLE.bench },
  tallerWeb: { f: furnishWebWorkshop, sub: 'TALLER WEB' },
  showcase: { f: furnishShowcase, panels: ['Wall_1', 'Wall_3', 'Wall_1'], sub: 'ESCAPARATE', light: 0.15 },
  brand: { f: furnishFileMark, panels: ['Wall_3', 'Wall_1', 'Wall_2'], sub: 'ARCHIVO DE MARCA', light: 0.55 },
  projection: { f: furnishProjection, panels: ['Wall_5', 'Wall_1', 'Wall_3'], sub: 'SALA DE PROYECCIÓN', light: 0.75 },
  empty: { f: null, panels: ['Wall_4', 'Wall_1', 'Wall_3'], sub: 'TALLER' },
};

// la escena de serie puede salir del tipo del repo (Rust, Python, web…), que el servidor manda justo después de la sala
// nueva: se espera un momento a que llegue para no montar la sala con la plantilla equivocada
function infoRepo(id: string, wait = 2500): Promise<{ type?: string; isGit?: boolean } | undefined> {
  const already = live.get().repos[id]; if (already) return Promise.resolve(already);
  return new Promise(ok => {
    const end = (r?: { type?: string; isGit?: boolean }) => { clearTimeout(timer); remove(); ok(r); };
    const remove = live.subscribe(() => { const r = live.get().repos[id]; if (r) end(r); });
    const timer = setTimeout(() => end(undefined), wait);
  });
}
const withStyleOwn = (sec: SavedRoom) => sec.type === 'coordination' || baseStock(sec, { type: '?' }) !== 'taller';
/** La escena de una sala de repo: la base de su decorado o la de serie */
export async function roomBase(sec: SavedRoom): Promise<BaseDecor> {
  return sec.decor?.base ?? baseStock(sec, withStyleOwn(sec) ? undefined : await infoRepo(sec.id));
}

// every repo room has its task board, hung before the scene so the scene (and its dressing) keeps clear of it
const withBoard = (spot: BoardSpot) => (f: Furnish): Furnish => async ctx => { ctx.board = spot; mountTaskBoard(ctx, spot); await f(ctx); };

async function furnished(sec: SavedRoom): Promise<{ f: Furnish; panels?: string[]; sub?: string; light?: number }> {
  // la sala de planificación sin decorado: su sala de mando del despliegue (la pantalla con tus PR y sus bloqueos)
  if (sec.type === 'coordination' && !sec.decor) return { f: furnishDeployment, panels: ['Wall_5', 'Wall_3', 'Wall_5'], sub: 'PLAN DE DESPLIEGUE', light: 0.9 };
  if (sec.type === 'repo' || sec.type === 'coordination') {
    const base = await roomBase(sec); const b = BASES[base]; const d = sec.decor;
    const board = withBoard(boardSpot(base, sec.id, d));
    if (!d) return { f: board(b.f ?? furnishGeneric), panels: b.panels, sub: b.sub, light: b.light };
    return { f: board(ctx => furnishDecor(ctx, d, b.f)), panels: d.walls ?? b.panels, sub: d.subtitle ?? b.sub, light: d.light ?? b.light };
  }
  switch (sec.type) {
    case 'comms': return { f: furnishCommunications, panels: ['Wall_2', 'Wall_3', 'Wall_4'] };
    case 'calendar': return { f: furnishPlanning, panels: ['Wall_1', 'Wall_3', 'Wall_2'] };
    case 'logistics': return { f: furnishLogistics, panels: ['Wall_5', 'Wall_3', 'Wall_5'] };
    case 'git': return { f: furnishGit, panels: ['Wall_3', 'Wall_1', 'Wall_3'] };
    case 'bridge': return { f: furnishBridge, panels: ['Wall_5', 'Wall_1', 'Wall_5'] };
    case 'vault': return { f: furnishCamera, panels: ['Wall_3', 'Wall_1', 'Wall_3'] };
    case 'gate': return { f: furnishGate, panels: ['Wall_Empty', 'Wall_3', 'Wall_5'] };
    case 'hydroponics': return { f: furnishHydroponics, panels: ['Wall_2', 'Wall_4', 'Wall_2'] };
    case 'gallery': return { f: furnishGallery, panels: ['Wall_5', 'Wall_5', 'Wall_5'] };
    case 'disco': return { f: furnishDisco, panels: ['Wall_5', 'Wall_1', 'Wall_5'] };
    case 'bodyshop': return { f: furnishBodyshop, panels: ['Wall_1', 'Wall_3', 'Wall_1'] };
    case 'review': return { f: furnishReview, panels: ['Wall_5', 'Wall_3', 'Wall_5'], light: 0.9 };
    default: return { f: furnishWebWorkshop };
  }
}

export async function buildRoom(sec: SavedRoom, number: number, steps: { left: boolean; right: boolean }, branch?: string, missing = false): Promise<Room> {
  const { f, panels, sub: subScene, light } = await furnished(sec);
  const sub = missing ? t('world.folderNotFound') : subScene ? tIs(subScene) : SUBTITLES[sec.type] ?? '';
  const code = number ? String(number).padStart(2, '0') : (CODE[sec.type] ?? '··');
  // the room's devices; the room panel, always the same monitor at the same spot (roomPanel.ts)
  const devices = (sec.type === 'coordination' && !sec.decor ? DEPLOYMENT : INTERACTIVE[sec.type] ?? [{ id: 'panel', x: 0, z: 0, text: 'Panel de la sala', panel: 'room' }])
    .map(i => (i.id === 'panel' ? { ...i, ...panelSpot(sec.side) } : i));
  const room = await createRoom({
    id: sec.id, type: sec.type, name: sec.type === 'repo' || sec.type === 'coordination' && sec.id !== PLANNING_ROOM ? sec.name : tIs(sec.name), subtitle: sub, branch: missing ? undefined : branch, number: code,
    // «espejo» en el decorado: la escena de base, al revés de como sale de serie (se espeja con la paridad de la semilla)
    variant: variantOf(sec), seed: roomSeed(sec.id, sec.decor?.mirror), panels, steps,
    floor: sec.floor, side: sec.side, orden: sec.orden, path: sec.path, area: sec.area,
  }, devices.some(i => i.id === 'panel') ? withRoomPanel(code)(f) : f);
  // misma luz que el taller web en todas: interiores en penumbra cálida con pozas bajo las lámparas
  const fl = light ?? LIGHT[sec.type] ?? 1; if (fl !== 1) for (const a of room.anchors) a.intensity *= fl;
  // cada sala, su copia (con las cajas de lo que se ve de cada aparato, medidas al amueblarla)
  const zones: Record<string, THREE.Box3[]> = room.userData.deviceZones ?? {};
  room.interactive = devices.map(i => ({ ...i, text: tIs(i.text), zones: zones[i.id] }));
  return room;
}

// la pintura de la sala es la de su sector (shared/sectors.ts); paredes y pantallas, de su paleta. En los repos la
// paleta sale del estilo, no de la guardada: antes se repartía por turno al reclutar
// (el decorado puede cambiar la paleta y el acento)
function variantOf(sec: SavedRoom) {
  const d = sec.type === 'repo' || sec.type === 'coordination' ? sec.decor : undefined;
  const base = VARIANTS[d?.palette ?? (sec.type === 'repo' ? STYLE_PALETTE[sec.style ?? 'generic'] ?? sec.variant : sec.variant)] ?? VARIANTS.neutral;
  const [roomAccent, roomDark] = roomTone(sec);
  const accent = d?.accent ?? roomAccent;
  const darkAccent = d?.accent ? '#' + new THREE.Color(d.accent).multiplyScalar(0.5).getHexString() : roomDark;
  return { ...base, id: `${base.id}~${accent}`, accent, darkAccent };
}

const LIGHT: Record<string, number> = { gallery: 0.26, hydroponics: 0.6, disco: 0.8, bodyshop: 0.85, calendar: 0.45, bridge: 0.75, git: 0.8, vault: 0.85, comms: 0.9, gate: 0.9, logistics: 1 };

// aparatos que se usan con E en cada tipo de sala (posición local en el pasillo delantero)
const INTERACTIVE: Record<string, Interactive[]> = {
  gate: [{ id: 'gate', x: -3.4, z: 1.0, text: 'Reclutar: excavar una sala', panel: 'gate' }],
  vault: [{ id: 'scanner', x: 2.6, z: 1.0, text: 'Integraciones y ajustes', panel: 'vault' }],
  comms: [{ id: 'noticeboard', x: 0.2, z: 1.1, text: 'Leer los avisos', panel: 'comms' }, { id: 'radio', x: -4.4, z: 1.0, text: 'Sintonizar la radio', panel: 'radio' }],
  calendar: [{ id: 'calendario', x: 0, z: 1.0, text: 'Ver el calendario', panel: 'calendar' }],
  logistics: [{ id: 'board', x: -3.55, z: 1.15, text: 'Tablero de tareas', panel: 'logistics' }, { id: 'trophies', x: 3.6, z: 1.15, text: 'Trofeos y carrera', panel: 'logistics', view: 'trophies' }],   // desde la consola de la izquierda: el aviso no tapa el tablero
  git: [{ id: 'client', x: -4.3, z: 1.1, text: 'Cliente de git', panel: 'git' }, { id: 'matrix', x: 0.3, z: 1.2, text: 'Tus contribuciones en GitHub', panel: 'git' }],
  gallery: [{ id: 'tiro', x: -1.2, z: 0.5, text: 'Coger un arma y tirar', panel: 'gallery' }],
  hydroponics: [{ id: 'cultivos', x: -1.7, z: 1.3, text: 'Cuidar los cultivos', panel: 'hydroponics' }],
  disco: [{ id: 'cabin', x: 0, z: 1.0, text: 'Cabina del DJ: poner música en Spotify', panel: 'spotify' }],
  bodyshop: [{ id: 'sillon', x: -1.2, z: 1.0, text: 'Sentarse en el sillón: cambiar de aspecto', panel: 'bodyshop' }],
  // the room panel and the board, from the screen (or from the corner by the reading table)
  review: [{ id: 'panel', x: 0, z: 0, text: 'Panel de la sala', panel: 'room' }, { id: 'reviews', x: 2.6, z: 1.15, text: 'PR que esperan tu revisión', panel: 'review' }],
  bridge: [{ id: 'generator', x: -3.9, z: 1.1, text: 'Reparar el núcleo de energía', panel: 'generator' }, { id: 'panel', x: 0, z: 0, text: 'Panel de la sala', panel: 'room' }],
};

// the stock planning room: the room panel and the deployment screen (from the right-hand console)
const DEPLOYMENT: Interactive[] = [{ id: 'panel', x: 0, z: 0, text: 'Panel de la sala', panel: 'room' }, { id: 'deployment', x: 2.75, z: 1.15, text: 'Plan de despliegue', panel: 'room', view: 'deployment' }];

const CODE: Record<string, string> = { comms: 'CO', calendar: 'PL', logistics: 'LG', git: 'CV', bridge: 'PM', vault: 'CA', gate: 'PP', hydroponics: 'HI', gallery: 'GT', disco: 'DJ', bodyshop: 'CP', review: 'RV' };


// Fábrica de salas: elige el mobiliario según el tipo de cada sala guardada y, en las de repo, su decorado o su estilo.
import { furnishGeneric } from './generica';
import * as THREE from 'three';
import { TEMPLATE_SUBTITLE, TEMPLATE_PANELS, furnishFoundry, furnishLaboratory, furnishStudio, furnishFile } from './plantillas';
import { furnishDecor } from './decorado';
import { baseStock, type BaseDecor, type Decorado } from '@shared/decorado';
import { vivo } from '../../red/cliente';
import type { Interactive } from './comun';
import { VARIANTS } from '../../motor/paleta';
import { ROOM_DESCRIPTION } from '@shared/refugioInicial';
import { roomTone, STYLE_PALETTE } from '@shared/sectores';
import { createRoom, type Furnish, type Sala, type RoomType } from './comun';
import { furnishTallerWeb } from './tallerWeb';
import { furnishShowcase } from './landing';
import { furnishFileMark } from './marca';
import { furnishProjection } from './video';
import { furnishCommunications, furnishPlanning, furnishLogistics } from './operativas';
import { furnishDeployment } from './despliegue';
import { furnishGate } from './servicio';
import { furnishCamera } from './camara';
import { furnishBridge } from './puente';
import { furnishHydroponics, furnishGallery } from './ocio';
import { furnishGit } from './git';
import { furnishDisco } from './discoteca';
import { furnishBodyshop } from './chapa';
import { t, tIs } from '@shared/idioma';
import { PLANNING_ROOM } from '@shared/disposicion';

export interface SavedRoom { id: string; tipo: RoomType; nombre: string; ruta?: string; planta: number; lado: 'izq' | 'der'; orden: number; variant: string; estilo?: string; area?: string; decorado?: Decorado }

// salas especiales: llevan su descripción en el cartel (la misma del plano)
const SUBTITLES: Record<string, string> = Object.fromEntries(Object.entries(ROOM_DESCRIPTION).map(([k, d]) => [k, tIs(d).toUpperCase()]));

// las escenas de las salas de repo: las plantillas de los reclutas (según el tipo del repo), las hechas a mano y la vacía
// (sobre la que el habitante monta su decorado); cada una con sus paneles de pared, su subtítulo y su luz
const BASES: Record<BaseDecor, { f: Furnish | null; paneles?: string[]; sub: string; luz?: number }> = {
  estudio: { f: furnishStudio, paneles: TEMPLATE_PANELS.estudio, sub: TEMPLATE_SUBTITLE.estudio },
  laboratorio: { f: furnishLaboratory, paneles: TEMPLATE_PANELS.laboratorio, sub: TEMPLATE_SUBTITLE.laboratorio },
  fundicion: { f: furnishFoundry, paneles: TEMPLATE_PANELS.fundicion, sub: TEMPLATE_SUBTITLE.fundicion },
  archivo: { f: furnishFile, paneles: TEMPLATE_PANELS.archivo, sub: TEMPLATE_SUBTITLE.archivo },
  taller: { f: furnishGeneric, paneles: TEMPLATE_PANELS.banco, sub: TEMPLATE_SUBTITLE.banco },
  tallerWeb: { f: furnishTallerWeb, sub: 'TALLER WEB' },
  escaparate: { f: furnishShowcase, paneles: ['Wall_1', 'Wall_3', 'Wall_1'], sub: 'ESCAPARATE', luz: 0.15 },
  marca: { f: furnishFileMark, paneles: ['Wall_3', 'Wall_1', 'Wall_2'], sub: 'ARCHIVO DE MARCA', luz: 0.55 },
  proyeccion: { f: furnishProjection, paneles: ['Wall_5', 'Wall_1', 'Wall_3'], sub: 'SALA DE PROYECCIÓN', luz: 0.75 },
  vacia: { f: null, paneles: ['Wall_4', 'Wall_1', 'Wall_3'], sub: 'TALLER' },
};

// la escena de serie puede salir del tipo del repo (Rust, Python, web…), que el servidor manda justo después de la sala
// nueva: se espera un momento a que llegue para no montar la sala con la plantilla equivocada
function infoRepo(id: string, espera = 2500): Promise<{ tipo?: string; isGit?: boolean } | undefined> {
  const ya = vivo.get().repos[id]; if (ya) return Promise.resolve(ya);
  return new Promise(ok => {
    const fin = (r?: { tipo?: string; isGit?: boolean }) => { clearTimeout(reloj); quitar(); ok(r); };
    const quitar = vivo.subscribe(() => { const r = vivo.get().repos[id]; if (r) fin(r); });
    const reloj = setTimeout(() => fin(undefined), espera);
  });
}
const withStyleOwn = (sg: SavedRoom) => sg.tipo === 'coordinacion' || baseStock(sg, { tipo: '¿?' }) !== 'taller';
/** La escena de una sala de repo: la base de su decorado o la de serie */
export async function roomBase(sg: SavedRoom): Promise<BaseDecor> {
  return sg.decorado?.base ?? baseStock(sg, withStyleOwn(sg) ? undefined : await infoRepo(sg.id));
}

async function furnished(sg: SavedRoom): Promise<{ f: Furnish; paneles?: string[]; sub?: string; luz?: number }> {
  // la sala de planificación sin decorado: su sala de mando del despliegue (la pantalla con tus PR y sus bloqueos)
  if (sg.tipo === 'coordinacion' && !sg.decorado) return { f: furnishDeployment, paneles: ['Wall_5', 'Wall_3', 'Wall_5'], sub: 'PLAN DE DESPLIEGUE', luz: 0.9 };
  if (sg.tipo === 'repo' || sg.tipo === 'coordinacion') {
    const base = await roomBase(sg); const b = BASES[base]; const d = sg.decorado;
    if (!d) return { f: b.f ?? furnishGeneric, paneles: b.paneles, sub: b.sub, luz: b.luz };
    return { f: ctx => furnishDecor(ctx, d, b.f), paneles: d.paredes ?? b.paneles, sub: d.subtitulo ?? b.sub, luz: d.luz ?? b.luz };
  }
  switch (sg.tipo) {
    case 'comunicaciones': return { f: furnishCommunications, paneles: ['Wall_2', 'Wall_3', 'Wall_4'] };
    case 'planificacion': return { f: furnishPlanning, paneles: ['Wall_1', 'Wall_3', 'Wall_2'] };
    case 'logistica': return { f: furnishLogistics, paneles: ['Wall_5', 'Wall_3', 'Wall_5'] };
    case 'git': return { f: furnishGit, paneles: ['Wall_3', 'Wall_1', 'Wall_3'] };
    case 'puente': return { f: furnishBridge, paneles: ['Wall_5', 'Wall_1', 'Wall_5'] };
    case 'camara': return { f: furnishCamera, paneles: ['Wall_3', 'Wall_1', 'Wall_3'] };
    case 'puerta': return { f: furnishGate, paneles: ['Wall_Empty', 'Wall_3', 'Wall_5'] };
    case 'hidroponia': return { f: furnishHydroponics, paneles: ['Wall_2', 'Wall_4', 'Wall_2'] };
    case 'galeria': return { f: furnishGallery, paneles: ['Wall_5', 'Wall_5', 'Wall_5'] };
    case 'discoteca': return { f: furnishDisco, paneles: ['Wall_5', 'Wall_1', 'Wall_5'] };
    case 'chapa': return { f: furnishBodyshop, paneles: ['Wall_1', 'Wall_3', 'Wall_1'] };
    default: return { f: furnishTallerWeb };
  }
}

export async function buildRoom(sg: SavedRoom, numero: number, pasos: { izq: boolean; der: boolean }, rama?: string, falta = false): Promise<Sala> {
  const { f, paneles, sub: subScene, luz } = await furnished(sg);
  const sub = falta ? t('world.folderNotFound') : subScene ? tIs(subScene) : SUBTITLES[sg.tipo] ?? '';
  const sala = await createRoom({
    id: sg.id, tipo: sg.tipo, nombre: sg.tipo === 'repo' || sg.tipo === 'coordinacion' && sg.id !== PLANNING_ROOM ? sg.nombre : tIs(sg.nombre), subtitulo: sub, rama: falta ? undefined : rama, numero: numero ? String(numero).padStart(2, '0') : (CODIGO[sg.tipo] ?? '··'),
    // «espejo» en el decorado: la escena de base, al revés de como sale de serie (se espeja con la paridad de la semilla)
    variant: variantOf(sg), semilla: hash(sg.id) + (sg.decorado?.espejo ? 1 : 0), paneles, pasos,
    planta: sg.planta, lado: sg.lado, orden: sg.orden, ruta: sg.ruta, area: sg.area,
  }, f);
  // misma luz que el taller web en todas: interiores en penumbra cálida con pozas bajo las lámparas
  const fl = luz ?? LIGHT[sg.tipo] ?? 1; if (fl !== 1) for (const a of sala.anclas) a.intensidad *= fl;
  // cada sala, su copia (con las cajas de lo que se ve de cada aparato, medidas al amueblarla)
  const zones: Record<string, THREE.Box3[]> = sala.userData.deviceZones ?? {};
  const stock = sg.tipo === 'coordinacion' && !sg.decorado ? DESPLIEGUE : undefined;
  sala.interactive = (stock ?? INTERACTIVE[sg.tipo] ?? [{ id: 'panel', x: -4.6, z: 1.0, texto: 'Panel de la sala', panel: 'sala' }]).map(i => ({ ...i, texto: tIs(i.texto), zones: zones[i.id] }));
  return sala;
}

// la pintura de la sala es la de su sector (shared/sectores.ts); paredes y pantallas, de su paleta. En los repos la
// paleta sale del estilo, no de la guardada: antes se repartía por turno al reclutar
// (el decorado puede cambiar la paleta y el acento)
function variantOf(sg: SavedRoom) {
  const d = sg.tipo === 'repo' || sg.tipo === 'coordinacion' ? sg.decorado : undefined;
  const base = VARIANTS[d?.paleta ?? (sg.tipo === 'repo' ? STYLE_PALETTE[sg.estilo ?? 'generico'] ?? sg.variant : sg.variant)] ?? VARIANTS.neutro;
  const [roomAccent, roomDark] = roomTone(sg);
  const acento = d?.acento ?? roomAccent;
  const darkAccent = d?.acento ? '#' + new THREE.Color(d.acento).multiplyScalar(0.5).getHexString() : roomDark;
  return { ...base, id: `${base.id}~${acento}`, acento, darkAccent };
}

const LIGHT: Record<string, number> = { galeria: 0.26, hidroponia: 0.6, discoteca: 0.8, chapa: 0.85, planificacion: 0.45, puente: 0.75, git: 0.8, camara: 0.85, comunicaciones: 0.9, puerta: 0.9, logistica: 1 };

// aparatos que se usan con E en cada tipo de sala (posición local en el pasillo delantero)
const INTERACTIVE: Record<string, Interactive[]> = {
  puerta: [{ id: 'puerta', x: -3.4, z: 1.0, texto: 'Reclutar: excavar una sala', panel: 'puerta' }],
  camara: [{ id: 'escaner', x: 2.6, z: 1.0, texto: 'Integraciones y ajustes', panel: 'camara' }],
  comunicaciones: [{ id: 'tablon', x: 0.2, z: 1.1, texto: 'Leer los avisos', panel: 'comunicaciones' }, { id: 'radio', x: -4.4, z: 1.0, texto: 'Sintonizar la radio', panel: 'radio' }],
  planificacion: [{ id: 'calendario', x: 0, z: 1.0, texto: 'Ver el calendario', panel: 'planificacion' }],
  logistica: [{ id: 'tablero', x: -3.55, z: 1.15, texto: 'Tablero de Linear', panel: 'logistica' }],   // desde la consola de la izquierda: el aviso no tapa el tablero
  git: [{ id: 'cliente', x: -4.3, z: 1.1, texto: 'Cliente de git', panel: 'git' }, { id: 'matriz', x: 0.3, z: 1.2, texto: 'Tus contribuciones en GitHub', panel: 'git' }],
  galeria: [{ id: 'tiro', x: -1.2, z: 0.5, texto: 'Coger un arma y tirar', panel: 'galeria' }],
  hidroponia: [{ id: 'cultivos', x: -1.7, z: 1.3, texto: 'Cuidar los cultivos', panel: 'hidroponia' }],
  discoteca: [{ id: 'cabina', x: 0, z: 1.0, texto: 'Cabina del DJ: poner música en Spotify', panel: 'spotify' }],
  chapa: [{ id: 'sillon', x: -1.2, z: 1.0, texto: 'Sentarse en el sillón: cambiar de aspecto', panel: 'chapa' }],
  puente: [{ id: 'generador', x: -3.9, z: 1.1, texto: 'Reparar el núcleo de energía', panel: 'generador' }, { id: 'panel', x: 4.35, z: 1.0, texto: 'Panel de la sala', panel: 'sala' }],
};

// la sala de planificación de serie: el panel de la sala y la pantalla del despliegue (desde la consola de la derecha)
const DESPLIEGUE: Interactive[] = [{ id: 'panel', x: -4.6, z: 1.0, texto: 'Panel de la sala', panel: 'sala' }, { id: 'despliegue', x: 2.75, z: 1.15, texto: 'Plan de despliegue', panel: 'sala', vista: 'despliegue' }];

const CODIGO: Record<string, string> = { comunicaciones: 'CO', planificacion: 'PL', logistica: 'LG', git: 'CV', puente: 'PM', camara: 'CA', puerta: 'PP', hidroponia: 'HI', galeria: 'GT', discoteca: 'DJ', chapa: 'CP' };

function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000 + 1; }

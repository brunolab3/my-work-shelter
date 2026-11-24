// Reclutas: nombre, mote, aspecto y ficha de quien llega a la Puerta Principal. Sin inferencia: listas y azar con semilla.
import { lookOf, lookOnRandom, type Look } from './appearance.ts';
export interface RecruitCard { id: string; name: string; nickname: string; type: string; bio: string; voice: number; tone?: number; look?: Look }

const NAMES = ['Adela', 'Benito', 'Casilda', 'Damián', 'Elvira', 'Fausto', 'Gertru', 'Hilario', 'Inés', 'Jacinto', 'Leonor', 'Matías', 'Nieves', 'Olegario', 'Paca', 'Quique', 'Rosario', 'Saturnino', 'Trini', 'Ulises', 'Valentina', 'Wenceslao', 'Ximena', 'Yago', 'Zoila', 'Amparo', 'Baltasar', 'Celia', 'Dimas', 'Encarna', 'Filomena', 'Gaspar', 'Herminia', 'Isidro', 'Jimena', 'Lázaro', 'Macarena', 'Nicanor', 'Orencio', 'Pilar'];
export const NICKNAMES = ['Destornillador', 'La Brújula', 'Cortocircuito', 'Tuerca Loca', 'Commit Fino', 'Rebobinado', 'Cable Pelado', 'Linterna', 'Soldadura Fría', 'El Grep', 'Pila Gastada', 'Mapa Viejo', 'Diff Limpio', 'Manómetro', 'Remache', 'La Escoba', 'Rama Suelta', 'Contrapeso', 'Fusible', 'La Lupa', 'Engranaje', 'Merge Tranquilo', 'Cantimplora', 'Chispa'];
// Modelos del reparto que puede llevar un recluta (los que acepta el servidor). Protagonist_B no está: es el del
// Supervisor por defecto y un recluta con su cara se confundiría con el jugador. 4GTN es un androide de aspecto humano.
export const LOOKS = ['Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', 'SpaceRanger', '4GTN'];
export const ROBOTS = ['Robot_One', 'Robot_Two', 'Clanker', '4GTN'];
export const ORIGIN = ['Llegó del yermo con una mochila llena de cables', 'Vivía en un refugio vecino que se quedó sin agua', 'Apareció en la escotilla con un portátil sin batería', 'Dice que trabajó en una fábrica de terminales antes del gran apagón', 'Cruzó tres tormentas de polvo siguiendo la señal de la radio'];
export const ROBOT_ORIGIN = 'Unidad de servicio reprogramada';
export const MANIA = ['No soporta un test en rojo', 'Lee el README entero antes de tocar nada', 'Nombra las ramas como canciones', 'Guarda cada log como si fuera un tesoro', 'Prefiere borrar código a escribirlo', 'Tararea mientras compila', 'Desconfía de las dependencias nuevas', 'Deja la consola más limpia de lo que la encontró'];

function random(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

export function generateRecruit(seed: number, used: string[] = [], robot = false, usedTypes: string[] = []): RecruitCard {
  const r = random(seed);
  const pick = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  let name = pick(NAMES);
  for (let k = 0; k < 20 && used.includes(name.toLowerCase()); k++) name = pick(NAMES);
  // el aspecto menos visto del refugio: con el reparto inicial, ningún modelo base sale tres veces hasta que el
  // refugio tenga más habitantes que huecos de dos por modelo
  const list = robot ? ROBOTS : LOOKS;
  const count = (t: string) => usedTypes.filter(x => x === t).length;
  const min = Math.min(...list.map(count));
  // entre los menos vistos, el que hace más que no entra nadie con él: dos reclutas seguidos nunca son el mismo modelo
  const candidates = list.filter(t => count(t) === min);
  const last = (t: string) => usedTypes.lastIndexOf(t);
  const moreOld = Math.min(...candidates.map(last));
  const type = pick(candidates.filter(t => last(t) === moreOld));
  const bio = robot ? `${ROBOT_ORIGIN}. ${pick(MANIA)}.` : `${pick(ORIGIN)}. ${pick(MANIA)}.`;
  const id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '-' + (seed % 10000).toString(36);
  // si el modelo ya lo lleva alguien, otra ropa y otro pelo (giro de tono por ángulo áureo: el segundo y el tercero
  // con el mismo modelo tampoco se parecen entre sí)
  const n = count(type);
  const tone = n > 0 ? (n * 137 + 20 + Math.floor(r() * 30)) % 360 : undefined;
  // el aspecto, por piezas y al azar (cara, pelo, ropa y colores; o cabeza, chasis y luces): nadie llega repetido
  const look = lookOnRandom(r, robot ? 'robot' : 'human');
  return { id, name, nickname: pick(NICKNAMES), type, bio, voice: 80 + Math.floor(r() * 120), ...(tone ? { tone } : {}), look };
}

/** Quien lleva siempre el aspecto original de su modelo, llegue cuando llegue (el Arquitecto no se disfraza). */
export const LOOK_ORIGINAL = new Set(['nestor']);

/** Quien repite modelo con alguien anterior (y no tiene tono propio) recibe otro tono de ropa y pelo, repartidos
 *  por ángulo áureo y sin repetir uno ya dado: así ni el reparto inicial ni un refugio guardado tienen gemelos.
 *  Los de ASPECTO_ORIGINAL cuentan como los primeros de su modelo. Devuelve una copia. */
export function tonesForRepeated<T extends { id?: string; type: string; tone?: number }>(dwellers: T[]): T[] {
  const isOriginal = (h: T) => !!h.id && LOOK_ORIGINAL.has(h.id);
  const seen = new Map<string, number>(), dice = new Map<string, Set<number>>();
  const used = (t: string) => dice.get(t) ?? dice.set(t, new Set()).get(t)!;
  for (const h of dwellers) { if (isOriginal(h)) seen.set(h.type, 1); if (h.tone) used(h.type).add(h.tone); }
  return dwellers.map(h => {
    if (isOriginal(h)) return h.tone ? { ...h, tone: undefined } : h;
    const n = seen.get(h.type) ?? 0; seen.set(h.type, n + 1);
    if (n === 0 || h.tone) return h;
    let k = n, tone = (k * 137 + 25) % 360;
    while (used(h.type).has(tone) && k < n + 12) tone = (++k * 137 + 25) % 360;
    used(h.type).add(tone);
    return { ...h, tone };
  });
}

/** Nadie se confunde con el Supervisor ni con otro habitante: quien va con el mismo modelo de serie que el Supervisor (si
 *  él va de serie), o con el mismo que otro habitante sin aspecto propio, o con el mismo aspecto por piezas que otro,
 *  recibe uno por piezas al azar, con semilla en su id (el mismo cada vez). Los de LOOK_ORIGINAL se quedan con el suyo
 *  antes que nadie (salvo si es el del Supervisor). La Octocat es como es. Cambia la lista; devuelve si cambió alguien. */
export function distinctLooks(dwellers: { id: string; type: string; look?: Look }[], supervisor: { character: string; look?: Look }): boolean {
  const key = (type: string, a?: Look) => (a ? JSON.stringify(a) : 'default:' + type);
  const seen = new Set([key(supervisor.character, supervisor.look)]);
  const orden = [...dwellers.filter(h => LOOK_ORIGINAL.has(h.id)), ...dwellers.filter(h => !LOOK_ORIGINAL.has(h.id))];
  let changed = false;
  for (const h of orden) {
    if (h.type === 'Octocat') continue;
    if (!seen.has(key(h.type, h.look))) { seen.add(key(h.type, h.look)); continue; }
    const especie = lookOf({ type: h.type }).especie;
    let seed = [...h.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 17), a: Look;
    do a = lookOnRandom(random(seed++), especie); while (seen.has(key(h.type, a)));
    h.look = a; seen.add(key(h.type, a)); changed = true;
  }
  return changed;
}

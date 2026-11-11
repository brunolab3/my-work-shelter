// Reclutas: nombre, mote, aspecto y ficha de quien llega a la Puerta Principal. Sin inferencia: listas y azar con semilla.
import { lookOf, lookOnRandom, type Look } from './aspecto.ts';
export interface RecruitCard { id: string; nombre: string; mote: string; tipo: string; bio: string; voz: number; tone?: number; aspecto?: Look }

const NAMES = ['Adela', 'Benito', 'Casilda', 'Damián', 'Elvira', 'Fausto', 'Gertru', 'Hilario', 'Inés', 'Jacinto', 'Leonor', 'Matías', 'Nieves', 'Olegario', 'Paca', 'Quique', 'Rosario', 'Saturnino', 'Trini', 'Ulises', 'Valentina', 'Wenceslao', 'Ximena', 'Yago', 'Zoila', 'Amparo', 'Baltasar', 'Celia', 'Dimas', 'Encarna', 'Filomena', 'Gaspar', 'Herminia', 'Isidro', 'Jimena', 'Lázaro', 'Macarena', 'Nicanor', 'Orencio', 'Pilar'];
const NICKNAMES = ['Destornillador', 'La Brújula', 'Cortocircuito', 'Tuerca Loca', 'Commit Fino', 'Rebobinado', 'Cable Pelado', 'Linterna', 'Soldadura Fría', 'El Grep', 'Pila Gastada', 'Mapa Viejo', 'Diff Limpio', 'Manómetro', 'Remache', 'La Escoba', 'Rama Suelta', 'Contrapeso', 'Fusible', 'La Lupa', 'Engranaje', 'Merge Tranquilo', 'Cantimplora', 'Chispa'];
// Modelos del reparto que puede llevar un recluta (los que acepta el servidor). Protagonist_B no está: es el del
// Supervisor por defecto y un recluta con su cara se confundiría con el jugador. 4GTN es un androide de aspecto humano.
export const LOOKS = ['Engineer', 'Survivalist', 'Hoarder', 'Hiker', 'Protagonist_A', 'Driver', 'SpaceRanger', '4GTN'];
export const ROBOTS = ['Robot_One', 'Robot_Two', 'Clanker', '4GTN'];
const ORIGIN = ['Llegó del yermo con una mochila llena de cables', 'Vivía en un refugio vecino que se quedó sin agua', 'Apareció en la escotilla con un portátil sin batería', 'Dice que trabajó en una fábrica de terminales antes del gran apagón', 'Cruzó tres tormentas de polvo siguiendo la señal de la radio'];
const MANIA = ['No soporta un test en rojo', 'Lee el README entero antes de tocar nada', 'Nombra las ramas como canciones', 'Guarda cada log como si fuera un tesoro', 'Prefiere borrar código a escribirlo', 'Tararea mientras compila', 'Desconfía de las dependencias nuevas', 'Deja la consola más limpia de lo que la encontró'];

function azar(semilla: number) { let s = semilla >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

export function generateRecruit(semilla: number, usados: string[] = [], robot = false, usedTypes: string[] = []): RecruitCard {
  const r = azar(semilla);
  const elegir = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  let nombre = elegir(NAMES);
  for (let k = 0; k < 20 && usados.includes(nombre.toLowerCase()); k++) nombre = elegir(NAMES);
  // el aspecto menos visto del refugio: con el reparto inicial, ningún modelo base sale tres veces hasta que el
  // refugio tenga más habitantes que huecos de dos por modelo
  const lista = robot ? ROBOTS : LOOKS;
  const cuenta = (t: string) => usedTypes.filter(x => x === t).length;
  const minimo = Math.min(...lista.map(cuenta));
  // entre los menos vistos, el que hace más que no entra nadie con él: dos reclutas seguidos nunca son el mismo modelo
  const candidates = lista.filter(t => cuenta(t) === minimo);
  const ultimo = (t: string) => usedTypes.lastIndexOf(t);
  const moreOld = Math.min(...candidates.map(ultimo));
  const tipo = elegir(candidates.filter(t => ultimo(t) === moreOld));
  const bio = robot ? `Unidad de servicio reprogramada. ${elegir(MANIA)}.` : `${elegir(ORIGIN)}. ${elegir(MANIA)}.`;
  const id = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '-' + (semilla % 10000).toString(36);
  // si el modelo ya lo lleva alguien, otra ropa y otro pelo (giro de tono por ángulo áureo: el segundo y el tercero
  // con el mismo modelo tampoco se parecen entre sí)
  const n = cuenta(tipo);
  const tone = n > 0 ? (n * 137 + 20 + Math.floor(r() * 30)) % 360 : undefined;
  // el aspecto, por piezas y al azar (cara, pelo, ropa y colores; o cabeza, chasis y luces): nadie llega repetido
  const aspecto = lookOnRandom(r, robot ? 'robot' : 'humano');
  return { id, nombre, mote: elegir(NICKNAMES), tipo, bio, voz: 80 + Math.floor(r() * 120), ...(tone ? { tone } : {}), aspecto };
}

/** Quien lleva siempre el aspecto original de su modelo, llegue cuando llegue (el Arquitecto no se disfraza). */
export const LOOK_ORIGINAL = new Set(['nestor']);

/** Quien repite modelo con alguien anterior (y no tiene tono propio) recibe otro tono de ropa y pelo, repartidos
 *  por ángulo áureo y sin repetir uno ya dado: así ni el reparto inicial ni un refugio guardado tienen gemelos.
 *  Los de ASPECTO_ORIGINAL cuentan como los primeros de su modelo. Devuelve una copia. */
export function tonesForRepeated<T extends { id?: string; tipo: string; tone?: number }>(habitantes: T[]): T[] {
  const originales = (h: T) => !!h.id && LOOK_ORIGINAL.has(h.id);
  const seen = new Map<string, number>(), dice = new Map<string, Set<number>>();
  const usados = (t: string) => dice.get(t) ?? dice.set(t, new Set()).get(t)!;
  for (const h of habitantes) { if (originales(h)) seen.set(h.tipo, 1); if (h.tone) usados(h.tipo).add(h.tone); }
  return habitantes.map(h => {
    if (originales(h)) return h.tone ? { ...h, tone: undefined } : h;
    const n = seen.get(h.tipo) ?? 0; seen.set(h.tipo, n + 1);
    if (n === 0 || h.tone) return h;
    let k = n, tone = (k * 137 + 25) % 360;
    while (usados(h.tipo).has(tone) && k < n + 12) tone = (++k * 137 + 25) % 360;
    usados(h.tipo).add(tone);
    return { ...h, tone };
  });
}

/** Nadie se confunde con el Supervisor ni con otro habitante: quien va con el mismo modelo de serie que el Supervisor (si
 *  él va de serie), o con el mismo que otro habitante sin aspecto propio, o con el mismo aspecto por piezas que otro,
 *  recibe uno por piezas al azar, con semilla en su id (el mismo cada vez). Los de LOOK_ORIGINAL se quedan con el suyo
 *  antes que nadie (salvo si es el del Supervisor). La Octocat es como es. Cambia la lista; devuelve si cambió alguien. */
export function distinctLooks(habitantes: { id: string; tipo: string; aspecto?: Look }[], supervisor: { personaje: string; aspecto?: Look }): boolean {
  const clave = (tipo: string, a?: Look) => (a ? JSON.stringify(a) : 'serie:' + tipo);
  const vistos = new Set([clave(supervisor.personaje, supervisor.aspecto)]);
  const orden = [...habitantes.filter(h => LOOK_ORIGINAL.has(h.id)), ...habitantes.filter(h => !LOOK_ORIGINAL.has(h.id))];
  let cambiado = false;
  for (const h of orden) {
    if (h.tipo === 'Octocat') continue;
    if (!vistos.has(clave(h.tipo, h.aspecto))) { vistos.add(clave(h.tipo, h.aspecto)); continue; }
    const especie = lookOf({ tipo: h.tipo }).especie;
    let semilla = [...h.id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 17), a: Look;
    do a = lookOnRandom(azar(semilla++), especie); while (vistos.has(clave(h.tipo, a)));
    h.aspecto = a; vistos.add(clave(h.tipo, a)); cambiado = true;
  }
  return cambiado;
}

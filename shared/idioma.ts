// Idioma de los textos del juego y de los prompts a los habitantes: español o inglés. Cada texto tiene una clave en
// inglés (`menu.backToTheShelter`, `prompt.adaptRoom`) y sus dos versiones juntas en el catálogo de su zona
// (shared/textos/*.ts, reunidos en shared/textos.ts): t('menu.backToTheShelter'). Si falta la versión del idioma elegido
// sale la española y, si la clave no existe, la propia clave. Variables con llaves: t('menu.leaveAndStopTheN', { n }).
// En el cliente se guarda en este navegador (cambiarlo recarga la vista: los carteles 3D se pintan al montar las
// salas); el servidor lo guarda en el estado del refugio (acción `idioma`).
import { TEXTS } from './textos.ts';

export type Idioma = 'es' | 'en';
export type Texto = { es: string; en?: string };
export const LANGUAGES: { valor: Idioma; texto: string }[] = [{ valor: 'es', texto: 'Español' }, { valor: 'en', texto: 'English' }];
export const LANGUAGE_KEY = 'refugio.idioma';
export const isLanguage = (x: unknown): x is Idioma => x === 'es' || x === 'en';

// el navegador lo recuerda; el servidor lo toma del estado del refugio (estado.idioma) al cargarlo y con la acción `idioma`
const almacen = () => (typeof window !== 'undefined' ? window.localStorage : undefined);
let actual: Idioma = (() => { try { const v = almacen()?.getItem(LANGUAGE_KEY); return isLanguage(v) ? v : 'es'; } catch { return 'es'; } })();
export const idioma = () => actual;
export function setLanguage(i: Idioma) { actual = i; try { almacen()?.setItem(LANGUAGE_KEY, i); } catch {} }

export function t(clave: string, vars?: Record<string, string | number>): string {
  const x = TEXTS[clave];
  const s = x ? (actual === 'en' ? x.en ?? x.es : x.es) : clave;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// Textos que llegan como datos en español (el nombre guardado de una sala de serie, los catálogos de objetos y piezas):
// se buscan por su versión española. Lo que no está en el catálogo (el nombre de un repo) sale tal cual
let spanishBy: Map<string, string> | undefined;
export function tIs(es: string, vars?: Record<string, string | number>): string {
  spanishBy ??= new Map(Object.entries(TEXTS).map(([k, v]) => [v.es, k]));
  const k = spanishBy.get(es);
  return k ? t(k, vars) : vars ? t(es, vars) : es;
}

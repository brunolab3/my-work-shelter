// Idioma de los textos del juego y de los prompts a los habitantes: español o inglés. Cada texto tiene una clave en
// inglés (`menu.backToTheShelter`, `prompt.adaptRoom`) y sus dos versiones juntas en el catálogo de su zona
// (shared/texts/*.ts, reunidos en shared/texts.ts): t('menu.backToTheShelter'). Si falta la versión del idioma elegido
// sale la española y, si la clave no existe, la propia clave. Variables con llaves: t('menu.leaveAndStopTheN', { n }).
// En el cliente se guarda en este navegador (cambiarlo recarga la vista: los carteles 3D se pintan al montar las
// salas); el servidor lo guarda en el estado del refugio (acción `idioma`).
import { TEXTS } from './texts.ts';

export type Language = 'es' | 'en';
export type LocalizedText = { es: string; en?: string };
export const LANGUAGES: { value: Language; text: string }[] = [{ value: 'es', text: 'Español' }, { value: 'en', text: 'English' }];
export const LANGUAGE_KEY = 'shelter.language';
export const isLanguage = (x: unknown): x is Language => x === 'es' || x === 'en';

// el navegador lo recuerda; el servidor lo toma del estado del refugio (estado.idioma) al cargarlo y con la acción `idioma`
const store = () => (typeof window !== 'undefined' ? window.localStorage : undefined);
const DEFAULT_LANGUAGE: Language = 'en';
let current: Language = (() => { try { const v = store()?.getItem(LANGUAGE_KEY); return isLanguage(v) ? v : DEFAULT_LANGUAGE; } catch { return DEFAULT_LANGUAGE; } })();
export const language = () => current;
export function setLanguage(i: Language) { current = i; try { store()?.setItem(LANGUAGE_KEY, i); } catch {} }

export function t(key: string, vars?: Record<string, string | number>): string {
  const x = TEXTS[key];
  const s = x ? (current === 'en' ? x.en ?? x.es : x.es) : key;
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

// A dweller's backstory: the initial cast's as a whole; a recruit's is two sentences (where they come from and a
// quirk, shared/recruits.ts), each looked up on its own
export function trBio(bio: string): string {
  const k = tIs(bio);
  if (k !== bio || current === 'es') return k;
  return bio.split(/(?<=\.) /).map(s => tIs(s.replace(/\.$/, '')) + (s.endsWith('.') ? '.' : '')).join(' ');
}

// Locale for dates and numbers in the chosen language
export const locale = () => (current === 'en' ? 'en-GB' : 'es-ES');

// A room's name as shown: a repo room's is its folder's; the service rooms and the Logistics wings ('Logistics',
// 'Logistics <folder>') keep theirs as they are
export function roomNameIs(s: { type: string; name: string }): string {
  if (s.type === 'repo') return s.name;
  const m = /^Logistics( .+)?$/.exec(s.name);
  return m ? 'Logistics' + (m[1] ?? '') : tIs(s.name);
}

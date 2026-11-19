// Datos guardados antes de pasar el código a inglés (estado del refugio, archivos de .data, lo que guarda el navegador):
// sus claves se renombran con los mapas de legacyKeys.ts, por pasos. Cada almacén lleva una marca con el último paso
// aplicado (MIGRATION_STEP): aplicar un paso ya hecho podría renombrar una clave nueva que coincide con una vieja.
import { LEGACY_KEYS, LEGACY_KEYS_2, LEGACY_KEYS_3 } from './legacyKeys.ts';

/** A step: its renames and, from step 3 on, where keys are data rather than field names. Paths use the keys the data
 *  has before the step, `*` is any one key and a leading `**.` any prefix; arrays add no segment. `skip` leaves a whole
 *  subtree as it is (the economy); `keepKeys` keeps that object's own keys (ids, field ids, look slots) and goes on inside. */
interface Step { map: Record<string, string>; skip?: string[]; keepKeys?: string[] }
const STEPS: Step[] = [
  { map: LEGACY_KEYS }, { map: LEGACY_KEYS_2 },
  { map: LEGACY_KEYS_3, skip: ['jugador'],
    keepKeys: ['integraciones', 'integraciones.*.campos', 'integraciones.*.opciones', '**.aspecto.piezas', '**.aspecto.colores'] },
];
export const MIGRATION_STEP = STEPS.length;

const matches = (pattern: string, path: string[]): boolean => {
  const p = pattern.split('.');
  if (p[0] === '**') { const tail = p.slice(1); return path.length >= tail.length && matches(tail.join('.'), path.slice(-tail.length)); }
  return p.length === path.length && p.every((x, i) => x === '*' || x === path[i]);
};
const rename = (x: unknown, step: Step, path: string[] = []): unknown => {
  if (Array.isArray(x)) return x.map(v => rename(v, step, path));
  if (!x || typeof x !== 'object') return x;
  const keep = step.keepKeys?.some(p => matches(p, path));
  return Object.fromEntries(Object.entries(x).map(([k, v]) => {
    const inner = [...path, k];
    const out = step.skip?.some(p => matches(p, inner)) ? v : rename(v, step, inner);
    return [!keep && Object.hasOwn(step.map, k) ? step.map[k] : k, out];
  }));
};
/** Aplica los pasos que faltan: `done` es el último ya aplicado a esos datos (0: ninguno) */
export function migrateKeys<T>(x: T, done = 0): T {
  let out: unknown = x;
  for (const step of STEPS.slice(done)) out = rename(out, step);
  return out as T;
}

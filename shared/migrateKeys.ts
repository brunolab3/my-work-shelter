// Datos guardados antes de pasar el código a inglés (estado del refugio, archivos de .data, lo que guarda el navegador):
// sus claves se renombran con los mapas de legacyKeys.ts, por pasos. Cada almacén lleva una marca con el último paso
// aplicado (MIGRATION_STEP): aplicar un paso ya hecho podría renombrar una clave nueva que coincide con una vieja.
import { LEGACY_KEYS, LEGACY_KEYS_2 } from './legacyKeys.ts';

const STEPS = [LEGACY_KEYS, LEGACY_KEYS_2];
export const MIGRATION_STEP = STEPS.length;

const rename = (x: unknown, map: Record<string, string>): unknown => {
  if (Array.isArray(x)) return x.map(v => rename(v, map));
  if (!x || typeof x !== 'object') return x;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [Object.hasOwn(map, k) ? map[k] : k, rename(v, map)]));
};
/** Aplica los pasos que faltan: `done` es el último ya aplicado a esos datos (0: ninguno) */
export function migrateKeys<T>(x: T, done = 0): T {
  let out: unknown = x;
  for (const map of STEPS.slice(done)) out = rename(out, map);
  return out as T;
}

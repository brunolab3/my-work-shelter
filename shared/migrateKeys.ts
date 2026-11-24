// Datos guardados antes de pasar el código a inglés (estado del refugio, archivos de .data, lo que guarda el navegador):
// sus claves se renombran con los mapas de legacyKeys.ts, por pasos. Cada almacén lleva una marca con el último paso
// aplicado (MIGRATION_STEP): aplicar un paso ya hecho podría renombrar una clave nueva que coincide con una vieja.
import { LEGACY_KEYS, LEGACY_KEYS_2, LEGACY_KEYS_3, LEGACY_ROOM_IDS, LEGACY_VALUES_4 } from './legacyKeys.ts';

/** A step: its renames and, from step 3 on, where keys are data rather than field names. Paths use the keys the data
 *  has before the step, `*` is any one key and a leading `**.` any prefix; arrays add no segment. `skip` leaves a whole
 *  subtree as it is (the economy); `keepKeys` keeps that object's own keys (ids, field ids, look slots) and goes on inside.
 *  `values` renames string values (never keys) at the paths given, each with its own map. */
interface Step { map: Record<string, string>; skip?: string[]; keepKeys?: string[]; values?: [string[], Record<string, string>][] }
const STEPS: Step[] = [
  { map: LEGACY_KEYS }, { map: LEGACY_KEYS_2 },
  { map: LEGACY_KEYS_3, skip: ['jugador'],
    keepKeys: ['integraciones', 'integraciones.*.campos', 'integraciones.*.opciones', '**.aspecto.piezas', '**.aspecto.colores'] },
  // room ids only where a room id is saved: a repo room's id is its folder's name and may be any word
  { map: {}, skip: ['jugador'], values: [
    [['**.roomId', '**.room', '**.digestRoom', '**.coordination', 'rooms.id', 'hidden.room.id'], LEGACY_ROOM_IDS],
    [['rooms.type', 'hidden.room.type'], { ...LEGACY_ROOM_IDS, coordinacion: 'coordination' }],
    [['**.state', '**.side', '**.style', '**.variant', '**.area', '**.decor.base', '**.decor.palette', '**.workstation.screen',
      '**.signs.symbol', '**.look.especie', '**.target.type', '**.view.type'], { ...LEGACY_VALUES_4, ...LEGACY_ROOM_IDS }],
  ] },
];
export const MIGRATION_STEP = STEPS.length;

const matches = (pattern: string, path: string[]): boolean => {
  const p = pattern.split('.');
  if (p[0] === '**') { const tail = p.slice(1); return path.length >= tail.length && matches(tail.join('.'), path.slice(-tail.length)); }
  return p.length === path.length && p.every((x, i) => x === '*' || x === path[i]);
};
const rename = (x: unknown, step: Step, path: string[] = []): unknown => {
  if (Array.isArray(x)) return x.map(v => rename(v, step, path));
  if (typeof x === 'string') { const m = step.values?.find(([ps]) => ps.some(p => matches(p, path)))?.[1]; return m && Object.hasOwn(m, x) ? m[x] : x; }
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

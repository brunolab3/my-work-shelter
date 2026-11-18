// Where a holographic copy's projector goes along a room's front edge (`Holograms.sitio`): pure, so it can be tested
// without the scene. What counts is the overlap on screen (in X), and rooms are full: each slot is scored and the least
// in the way wins. Never on top of another copy; very costly to hide the centrepiece or any spot where a dweller stands
// (their desk, the piece, their hobby, the devices, the patrol: the copy, in front, would hide them), a device, or
// furniture reaching the edge (it would stand inside it); a little, the walk zones, furniture sticking out to the front
// and the helper robots' spots; all else equal, better on the far side. The visitor's spot and the room panel's
// corner, never

export interface HoloRoom {
  ancho: number;
  lado: 'izq' | 'der';
  puestos: { x: number; peso: number }[];   // where dwellers stand, and how bad hiding them is
  devices: number[];
  walkZones: [number, number][];
  obstacles: { min: { x: number; y: number }; max: { x: number; y: number } }[];
}

const STEP = 0.3;
/** X (relative to the room's centre) where a visitor stands: by the lift's doorway, just inside the room panel's
 *  terminal (roomPanel.ts), which keeps the corner */
export const visitorX = (sala: { ancho: number; lado: 'izq' | 'der' }) => (sala.lado === 'izq' ? 1 : -1) * (sala.ancho / 2 - Math.min(2.5, sala.ancho * 0.275));
const ON_TOP = 0.5;   // closer than this to another copy, they overlap

/** X of the slot (relative to the room's centre) for a new copy, given the X of the room's other copies. */
export function holoSlot(sala: HoloRoom, otros: number[], zSpot: number, base: number): number {
  const lejos = sala.lado === 'izq' ? -1 : 1, medio = sala.ancho / 2 - 0.9;
  // copies well apart, each in its own slot so you can tell who you talk to; in a full room, as far as fits from the
  // nearest one (not a sum over all: two copies a gap's half away must not outweigh one right on top); on top of one
  // (closer than ON_TOP), only with no other slot left: still below the visitor's spot
  const cerca = (x: number) => { const d = Math.min(...otros.map(o => Math.abs(o - x))); return d < ON_TOP ? 5e4 + 1e4 * (2.3 - d) : d < 1.3 ? 1e4 * (2.3 - d) : d < 2.2 ? 30 : 0; };
  const coste = (x: number) =>
    cerca(x) + (Math.abs(x) < 1.8 ? 100 : 0)
    + sala.puestos.reduce((c, pt) => c + (Math.abs(pt.x - x) < 1.3 ? pt.peso : Math.abs(pt.x - x) < 1.8 ? pt.peso / 6 : 0), 0)
    + (sala.devices.some(ax => Math.abs(ax - x) < 1.0) ? 40 : 0)
    + (sala.walkZones.some(([a, b]) => x > a - 0.6 && x < b + 0.6) ? 10 : 0)
    + (sala.obstacles.some(b => b.max.y > zSpot - base / 2 && b.min.x - base / 2 < x && b.max.x + base / 2 > x) ? 300 : 0)
    + (sala.obstacles.some(b => b.max.y > 0.3 && b.min.x - 0.5 < x && b.max.x + 0.5 > x) ? 5 : 0)
    + ([-3.2, 3.0, -1.4, 1.6, -4.6, 4.4].some(r => Math.abs(r - x) < 0.8) ? 4 : 0)
    // the visitor's spot (by the lift's doorway, `Visitors.crear`) and, past it, the room panel's corner stay always
    // free, with or without visitors
    + (-lejos * x > Math.abs(visitorX(sala)) - 1.4 ? 1e5 : 0)
    + Math.abs(lejos * medio - x);
  let mejor = lejos * medio, cmin = Infinity;
  for (let x = -medio; x <= medio + 1e-6; x += STEP) { const c = coste(x); if (c < cmin) { cmin = c; mejor = x; } }
  return mejor;
}

// A copy's helper robots stand around its projector, in a tight cluster: the nearest spots first, alternating sides
const HELPER_SPOTS: [number, number][] = [0.58, 0.84, 1.1, 1.36].flatMap(dx => [-0.05, -0.32].flatMap(dz => [[dx, dz], [-dx, dz]] as [number, number][]));
const HELPER_CLEAR = 0.5;   // from another copy's centre: its projector's half and a small robot
const ROBOT_CLEAR = 0.4;    // from another cluster's or the room's own helper robots

/** Spots (dx, dz from the copy's slot) for its helper robots, best first: none on another copy, on other helpers
 *  (`robots`, X of those outside this cluster) or past the walls. */
export function helperSpots(x: number, otros: number[], ancho: number, robots: number[] = []): [number, number][] {
  const libres = HELPER_SPOTS.filter(([dx]) => Math.abs(x + dx) < ancho / 2 - 0.35 && otros.every(o => Math.abs(o - (x + dx)) >= HELPER_CLEAR) && robots.every(o => Math.abs(o - (x + dx)) >= ROBOT_CLEAR));
  return libres.length ? libres : HELPER_SPOTS.slice(0, 2);
}

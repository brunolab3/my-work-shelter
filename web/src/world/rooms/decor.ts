// Monta el decorado que el habitante ha diseñado para su sala (shared/decor.ts, «Adaptar la sala al repo») con el
// atrezo del juego: sobre una de las escenas de serie o sobre la sala vacía, a la que pone lo imprescindible (el puesto
// del habitante y su pieza; el tablero de tareas ya está colgado, taskBoard.ts) donde diga el decorado o en su sitio
// por defecto. Lo que no se puede montar (un modelo que no está) se salta: una pieza rota nunca deja la sala a medias;
// lo que taparía el tablero de tareas, también.
import * as THREE from 'three';
import { place, type Placement } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom } from '../../engine/textures';
import { signInWall, highBand, centralDesk, screenReal, lean, aWall, center, stain, lying, SCALE_KAYKIT, type Furnish, type Context, type RoomPoint } from './common';
import { propsPath, PACKS, coversBoard, inTheWay, BOARD_CLEAR, type Decor, type DecorPiece, type DecorPoint } from '@shared/decor';

const G = Math.PI / 180;
// nombres de material de los packs que son luz: «Screen», «Light», «Fire», «Glass», «Neon»…
const SHINES = /screen|^light$|light_|_light|glow|emis|neon|lamp|bulb|^led|fire|flame|lava|crystal|glass|window/i;
const scalePack = (id: string) => (PACKS[id.split('/')[0]]?.folder.startsWith('kaykit') ? SCALE_KAYKIT : 1);

export async function furnishDecor(ctx: Context, d: Decor, base: Furnish | null) {
  if (base) await base(ctx); else await mountEmpty(ctx, d);
  if (d.piece && base) piecePoint(ctx, d.piece, 'piece-decor');
  if (d.hobby) hobbyPoint(ctx, d.hobby);
  await Promise.all([mountPieces(ctx, d.pieces ?? []), ...(d.signs ?? []).map((c, i) => mountSign(ctx, c, i))]);
  if (d.lamps?.length) ctx.lamps = d.lamps.map(l => ({ x: l.x, z: l.z, o: { intensity: l.intensity ?? 80, ...(l.color ? { color: l.color } : {}), goal: [l.x, l.z - 0.6] as [number, number] } }));
}

// ---------------------------------------------------------------- la sala vacía: lo imprescindible
async function mountEmpty(ctx: Context, d: Decor) {
  const { g, v, zB } = ctx;
  // the copper pipes along the wall, around the task board (never across it), and the clock on the widest side
  const b = ctx.board ?? { x: 0, y: 2.6, width: 3.2, height: 1.28 };
  const sides = ([[-5.6, b.x - b.width / 2 - 0.25], [b.x + b.width / 2 + 0.25, 5.6]] as const).filter(([a, z]) => z - a > 1);
  await highBand(ctx, { timer: b.x > 0 ? -4.9 : 4.9, valves: sides.map(([a, z]) => (a + z) / 2), segments: sides.map(([a, z]) => [(a + z) / 2, z - a] as [number, number]) });
  // the dweller's desk, in the middle under the board (the dressing only chooses how it looks)
  const pu = d.workstation ?? {};
  const pStation = new PhosphorScreen(384, 256, v.screen); pStation.speed = 30;
  screenReal(ctx, pStation, 'activity'); ctx.room.screens.push(pStation);
  const desk = pu.desk ? propsPath(pu.desk) : null;
  await centralDesk(ctx, { tex: pStation.tex, screen: pu.screen ?? 'monitor', ...(desk ? { desk } : {}) }).catch(async () => {
    await centralDesk(ctx, { tex: pStation.tex });   // la mesa pedida no carga: la de siempre
  });
  // the centrepiece: the dweller goes to it (by default on the left; the task board brightens when it's used)
  const screen = ctx.room.userData.taskBoard?.mesh as THREE.Mesh | undefined;
  const mat = screen?.material as THREE.MeshStandardMaterial | undefined;
  piecePoint(ctx, d.piece ?? { x: -3.6, z: zB + 1.3, rotation: 180 }, 'piece', () => { if (mat) mat.emissiveIntensity = 1.45; });
  if (mat) ctx.onUpdate(dt => { mat.emissiveIntensity = Math.max(0.95, mat.emissiveIntensity - dt * 0.4); });
  const panel = new PanelRoom(); panel.title = d.subtitle ?? 'TALLER'; panel.color = v.screen; ctx.panel = panel;
  stain(g, -2.0, 1.1, 1.1, ctx.seed);
  ctx.room.walkZones = [[-3.6, -2.4], [2.4, 3.6]];
  const xv = 5.2;   // the steam, off the board
  ctx.vapor = { pos: new THREE.Vector3(xv, 3.15, zB + 0.85), dir: new THREE.Vector3(-0.3 * Math.sign(xv), 0.9, 0.3) };
  ctx.lamps = [{ x: -3.6, z: 0.5, o: { intensity: 80 } }, { x: b.x, z: 0.9, o: { intensity: 90, shadow: true, corta: true } }, { x: 3.8, z: 0.5, o: { intensity: 70 } }];
}

function piecePoint(ctx: Context, p: DecorPoint, id: string, onMake?: () => void) {
  const gestures = p.gestures?.length ? p.gestures : ['Interact', 'Holding_A', 'Use_Item'];
  ctx.room.points.push({ id, type: 'piece', pos: new THREE.Vector3(p.x, 0, p.z), rotation: (p.rotation ?? 180) * G,
    actions: gestures.map(clip => ({ clip, ...(clip === 'Holding_A' ? { utensil: 'journal', dur: 4 } : {}), ...(onMake && (clip === 'Interact' || clip === 'Use_Item') ? { onMake } : {}) })) } as RoomPoint);
}
function hobbyPoint(ctx: Context, p: DecorPoint) {
  const [clip = 'Idle_A', other] = p.gestures ?? [];
  ctx.room.points.push({ id: 'hobby-decor', type: 'hobby', pos: new THREE.Vector3(p.x, 0, p.z), rotation: (p.rotation ?? 180) * G, clip, ...(other ? { gesture: { clip: other, every: 5 } } : {}) });
}

// ---------------------------------------------------------------- el atrezo
async function mountPieces(ctx: Context, pieces: DecorPiece[]) {
  const { g, zB } = ctx;
  let lights = 0;
  // cada pieza espera solo a aquella sobre la que se apoya (las del suelo se cargan todas a la vez)
  const done: Promise<THREE.Object3D | null>[] = [];
  pieces.forEach((p, i) => {
    done[i] = (p.restsOn !== undefined && p.restsOn < i ? done[p.restsOn] : Promise.resolve(null)).then(async support => {
      const path = propsPath(p.model); if (!path) return null;
      const rotation = (p.rotation ?? 0) * G;
      // (con su índice en el nombre: así la revisión de apoyos, ?revisar, dice qué pieza del decorado está mal)
      const c: Placement = { name: `pieces[${i}] ${p.model}`, pos: [p.x, p.y ?? 0, p.z], variant: ctx.v, own: !!(p.color || p.light), ...(p.lying ? lying(rotation) : { rot: rotation }), ...(p.height ? { height: p.height } : p.width ? { width: p.width } : { scale: scalePack(p.model) }) };
      let o: THREE.Object3D;
      try { o = await place(g, path, c); } catch (e) { console.warn('decorado: no se pudo montar', p.model, e); return null; }
      if (p.lying) center(o, p.x, p.z);
      if (support) lean(o, support);
      if (p.wall) aWall(g, o);
      if (p.color || p.light) {
        const mats: THREE.MeshStandardMaterial[] = [];
        o.traverse((n: any) => { if (n.isMesh) mats.push(...([].concat(n.material) as THREE.MeshStandardMaterial[])); });
        if (p.color) for (const m of mats) m.color?.multiply(new THREE.Color(p.color));
        // brilla lo que en el modelo es luz (pantallas, pilotos, fuego, cristales); si no tiene nada así, todo, apenas
        const ofLight = mats.filter(m => SHINES.test(m.name) && !/grey|gray|metal/i.test(m.name));
        if (p.light) for (const m of ofLight.length ? ofLight : mats) if (m.emissive) { m.emissive = new THREE.Color(p.light); m.emissiveIntensity = ofLight.length ? 1.6 : 0.22; }
      }
      const box3 = new THREE.Box3().setFromObject(o);
      // in the work zone or on the room panel: left out (the review told the dweller, reviewDecor)
      if (!support && inTheWay(box3.min.x, box3.max.x, box3.min.z, box3.max.z, box3.min.y, ctx.room.side)) { o.removeFromParent(); return null; }
      // near the back wall and in front of the task board: left out
      const tb = ctx.board;
      if (tb && box3.min.z < zB + BOARD_CLEAR && coversBoard(tb, (box3.min.x + box3.max.x) / 2, (box3.min.y + box3.max.y) / 2, box3.max.x - box3.min.x - 0.08, box3.max.y - box3.min.y - 0.08)) { o.removeFromParent(); return null; }
      // lo que brilla da un poco de luz de verdad alrededor (pocas: las reparte el juego con las demás)
      if (p.light && lights < 6) { lights++; ctx.room.anchors.push({ type: 'point', pos: box3.getCenter(new THREE.Vector3()), intensity: 2.4, color: new THREE.Color(p.light), distance: 3.5, priority: 1 }); }
      // lo que está en el suelo y abulta es un obstáculo para quien anda por la sala
      if (!support && !p.y && box3.max.y - box3.min.y > 0.3) ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(box3.min.x, box3.min.z), new THREE.Vector2(box3.max.x, box3.max.z)));
      return o;
    }).catch(() => null);
  });
  await Promise.all(done);
}

async function mountSign(ctx: Context, c: NonNullable<Decor['signs']>[number], i: number) {
  const height = c.width * 720 / 512;
  if (ctx.board && coversBoard(ctx.board, c.x, c.y, c.width, height)) return;
  const m = signInWall(ctx.g, sign(c.lines.length ? c.lines : [' '], c.title, c.background ?? '#e3d9c0', c.ink ?? '#3a2a1e', c.symbol ?? 'gear', ctx.seed + i * 7), c.x, c.y, c.width, height, ctx.zB + 0.33, (c.rotation ?? 0) * G);
  aWall(ctx.g, m, 0.012);
}

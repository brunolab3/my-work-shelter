// The room panel: the same floor terminal in every room that has one (repo and planning rooms, the Command Bridge), in
// the front corner of the entrance side (the one facing the lift), so the Overseer always knows where to look. They walk
// up to it, turn to it and tap it while the panel opens, and its screen flashes. Its skin follows the room (stripe and
// frame in its accent, header in its sector's tone, text in its screen colour); its shape and spot never change.
import * as THREE from 'three';
import { t } from '@shared/language';
import { roomTone } from '@shared/sectors';
import { panelSpot as footprint } from '@shared/decor';
import { canvas, textureOf, SOURCES, sharpCaption } from '../../engine/textures';
import { box, materialSteel, mat, truncate, COLOR_STATE, STATE_TEXT, type Context, type Furnish } from './common';

const side = (roomSide: 'izq' | 'der') => Math.sign(footprint(roomSide).x);
const turn = (roomSide: 'izq' | 'der') => -side(roomSide) * 0.4;   // facing the player, turned a little to the middle

/** Where the Overseer stands to use the panel (room-local) and where they face: beside it, on the room's side, so they
 *  never hide its screen from the camera */
export function panelSpot(roomSide: 'izq' | 'der') {
  const f = footprint(roomSide), x = f.x - side(roomSide) * 1.15, z = f.z + 0.3;
  return { x, z, rotation: Math.atan2(f.x - x, f.z - z), gesture: 'Interact' };
}

/** Mounts the room panel after the scene (its `code` is the room's number on the nameplate) */
export const withRoomPanel = (code: string) => (f: Furnish): Furnish => async ctx => { await f(ctx); mountRoomPanel(ctx, code); };

function mountRoomPanel(ctx: Context, code: string) {
  const { g, v, room } = ctx;
  const f = footprint(room.side);
  // a dark accent (the Command Bridge's) is lifted so the stripe still glows
  const accent = new THREE.Color(v.accent), hsl = accent.getHSL({ h: 0, s: 0, l: 0 }); if (hsl.l < 0.45) accent.setHSL(hsl.h, hsl.s, 0.45);
  const lit = mat('panel-lit' + accent.getHexString(), () => new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.4 }));
  const dark = materialSteel('#1a1b1c'), steel = materialSteel('#3b3936');
  const k = new THREE.Group(); k.name = 'room-panel'; k.position.set(f.x, 0, f.z); k.rotation.y = turn(room.side);
  // base plate, pedestal with its lit stripe, and the head with the screen, tilted back like a ticket kiosk
  k.add(box(0.7, 0.08, 0.55, dark, 0, 0.04, 0, true));
  k.add(box(0.34, 0.95, 0.26, steel, 0, 0.55, -0.02, true));
  k.add(box(0.08, 0.8, 0.02, lit, 0, 0.55, 0.115));
  const head = new THREE.Group(); head.position.set(0, 1.22, 0.02); head.rotation.x = -0.45; k.add(head);
  head.add(box(0.7, 0.52, 0.14, dark, 0, 0, 0, true));
  for (const [w, h, px, py] of [[0.74, 0.04, 0, 0.27], [0.74, 0.04, 0, -0.27], [0.04, 0.58, 0.36, 0], [0.04, 0.58, -0.36, 0]]) head.add(box(w, h, 0.15, lit, px, py, 0.005));
  head.add(box(0.14, 0.05, 0.05, lit, 0, 0.31, 0));   // pilot lamp on top
  // the screen: a header in the sector's tone saying what it is, the room's code and name, and its state
  const tone = roomTone(room)[0];
  const { c, g: x2 } = canvas(512, 384); const tex = textureOf(c);
  let state = room.state;
  const draw = () => {
    x2.fillStyle = '#05100a'; x2.fillRect(0, 0, 512, 384);
    x2.fillStyle = tone; x2.fillRect(0, 0, 512, 84);
    x2.fillStyle = '#0d0b08'; x2.textBaseline = 'middle'; x2.textAlign = 'center';
    let ft = 56; x2.font = `900 ${ft}px ${SOURCES.title}`; const title = t('world.roomPanel.title');
    while (x2.measureText(title).width > 480 && ft > 28) { ft -= 4; x2.font = `900 ${ft}px ${SOURCES.title}`; }
    x2.fillText(title, 256, 44);
    x2.shadowColor = v.screen; x2.shadowBlur = 10; x2.fillStyle = v.screen;
    x2.font = `900 128px ${SOURCES.title}`; x2.fillText(code, 256, 170);
    const name = truncate(room.name, 20); let fn = 44; x2.font = `600 ${fn}px ${SOURCES.mono}`;
    while (x2.measureText(name).width > 480 && fn > 22) { fn -= 2; x2.font = `600 ${fn}px ${SOURCES.mono}`; }
    x2.fillText(name, 256, 272);
    x2.fillStyle = state === 'trabajando' || state === 'ociosa' ? v.screen : COLOR_STATE[state];
    x2.font = `500 30px ${SOURCES.mono}`; x2.fillText(STATE_TEXT[state], 256, 342);
    x2.shadowBlur = 0; x2.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 84; y < 384; y += 4) x2.fillRect(0, y, 512, 1);
    tex.needsUpdate = true;
  };
  draw();
  ctx.onState(e => { if (e !== state) { state = e; draw(); } });
  const screenMat = sharpCaption(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.1, color: '#000' }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.46), screenMat); screen.position.z = 0.075; screen.userData.isStatic = false; head.add(screen);
  // tapped: the screen flashes and settles back
  let flash = 0;
  (room.userData.onUse ??= {}).panel = () => { flash = 1; };
  ctx.onUpdate(dt => { if (flash <= 0) return; flash = Math.max(0, flash - dt * 1.5); screenMat.emissiveIntensity = 1.1 + flash * 1.6; });
  g.add(k); ctx.device('panel', k);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(f.x - f.width / 2, f.z - f.background / 2), new THREE.Vector2(f.x + f.width / 2, f.z + f.background / 2)));
  // a spot in front of it, always taken, so no dweller, visitor or copy stands there and hides it (shelter.ts, occupants)
  ctx.room.points.push({ id: 'panel', type: 'mirar', pos: new THREE.Vector3(f.x, 0, f.z + 0.8), rotation: 0, busy: 'panel' });
}

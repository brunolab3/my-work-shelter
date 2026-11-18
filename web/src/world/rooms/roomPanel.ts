// The room panel: the same wall monitor in every room that has one (repo and planning rooms, the Command Bridge), on
// the front pillar of the entrance side (the one facing the lift), so the Overseer always knows where to look. Its skin
// follows the room (frame in its accent, header in its sector's tone, text in its screen colour); its shape and spot never
// change. It sits in front of the whole scene, so no furniture or dressing can cover it.
import * as THREE from 'three';
import { t } from '@shared/language';
import { roomTone } from '@shared/sectors';
import { ROOM_PANEL, panelSpot as wallBehind } from '@shared/decor';
import { lienzo, textureOf, SOURCES, sharpCaption } from '../../engine/textures';
import { caja, materialSteel, mat, recortar, BACKGROUND, COLOR_STATE, STATE_TEXT, type Contexto, type Furnish } from './common';

const { ancho: W, alto: H, y: Y } = ROOM_PANEL;   // above the Overseer's head
const Z = BACKGROUND / 2 + 0.3;                    // just in front of the pillar's face

/** Where the Overseer stands to use the panel (room-local), below the monitor */
export const panelSpot = (lado: 'izq' | 'der') => ({ x: wallBehind(lado).x * 0.95, z: 1.0 });

/** Mounts the room panel after the scene (its `code` is the room's number on the nameplate) */
export const withRoomPanel = (code: string) => (f: Furnish): Furnish => async ctx => { await f(ctx); mountRoomPanel(ctx, code); };

function mountRoomPanel(ctx: Contexto, code: string) {
  const { g, v, sala } = ctx;
  // a dark accent (the Command Bridge's) is lifted so the frame still glows
  const accent = new THREE.Color(v.acento), hsl = accent.getHSL({ h: 0, s: 0, l: 0 }); if (hsl.l < 0.45) accent.setHSL(hsl.h, hsl.s, 0.45);
  const tone = roomTone(sala)[0];
  // inside the room, so it never falls at the edge of the frame
  const x = wallBehind(sala.lado).x, s = Math.sign(x);
  const m = new THREE.Group(); m.name = 'room-panel'; m.position.set(x, Y, Z);
  // casing and its accent frame, lit so it reads from across the shelter
  m.add(caja(W + 0.1, H + 0.1, 0.12, materialSteel('#141516'), 0, 0, 0));
  const lit = mat('panel-frame' + accent.getHexString(), () => new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.4 }));
  for (const [w, h, px, py] of [[W + 0.16, 0.06, 0, (H + 0.1) / 2], [W + 0.16, 0.06, 0, -(H + 0.1) / 2], [0.06, H + 0.16, (W + 0.1) / 2, 0], [0.06, H + 0.16, -(W + 0.1) / 2, 0]])
    m.add(caja(w, h, 0.14, lit, px, py, 0.01));
  // the arms that hold it to the pillar, and a pilot lamp on top
  for (const dy of [-0.22, 0.22]) m.add(caja(0.5, 0.08, 0.08, materialSteel('#2b2a27'), s * (W / 2 + 0.3), dy, -0.02));
  m.add(caja(0.16, 0.06, 0.06, lit, 0, (H + 0.1) / 2 + 0.07, 0.02));
  // the screen: a header in the sector's tone saying what it is, the room's code and name, and its state
  const { c, g: x2 } = lienzo(768, 576); const tex = textureOf(c);
  let state = sala.estado;
  const draw = () => {
    x2.fillStyle = '#05100a'; x2.fillRect(0, 0, 768, 576);
    x2.fillStyle = tone; x2.fillRect(0, 0, 768, 118);
    x2.fillStyle = '#0d0b08'; x2.textBaseline = 'middle'; x2.textAlign = 'center';
    let ft = 76; x2.font = `900 ${ft}px ${SOURCES.titulo}`; const title = t('world.roomPanel.title');
    while (x2.measureText(title).width > 720 && ft > 40) { ft -= 4; x2.font = `900 ${ft}px ${SOURCES.titulo}`; }
    x2.fillText(title, 384, 62);
    x2.shadowColor = v.pantalla; x2.shadowBlur = 12; x2.fillStyle = v.pantalla;
    x2.font = `900 180px ${SOURCES.titulo}`; x2.fillText(code, 384, 250);
    const name = recortar(sala.nombre, 22); let fn = 64; x2.font = `600 ${fn}px ${SOURCES.mono}`;
    while (x2.measureText(name).width > 720 && fn > 30) { fn -= 4; x2.font = `600 ${fn}px ${SOURCES.mono}`; }
    x2.fillText(name, 384, 404);
    x2.fillStyle = state === 'trabajando' || state === 'ociosa' ? v.pantalla : COLOR_STATE[state];
    x2.font = `500 42px ${SOURCES.mono}`; x2.fillText(STATE_TEXT[state], 384, 510);
    x2.shadowBlur = 0; x2.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 118; y < 576; y += 4) x2.fillRect(0, y, 768, 1);
    tex.needsUpdate = true;
  };
  draw();
  ctx.onState(e => { if (e !== state) { state = e; draw(); } });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), sharpCaption(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.1, color: '#000' })));
  screen.position.z = 0.065; m.add(screen);
  g.add(m); ctx.aparato('panel', m);
}

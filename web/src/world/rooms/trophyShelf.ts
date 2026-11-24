// The trophy shelf on a room's back wall (shared/trophies.ts): one cup per trophy of the ladder, gold once earned, a
// faint outline filling in with its progress until then, and a brass plaque with the count. It is the room's device
// `trofeos` (rooms/index.ts): a click opens the Trophies and career panel. Read again every five minutes; rebuilt only
// when what it shows changes. QA reads `room.userData.trophyShelf.shown()`.
import * as THREE from 'three';
import { t as tr } from '@shared/language';
import { canvas, textureOf, SOURCES } from '../../engine/textures';
import { materialSteel, box, type Context } from './common';
import { client } from '../../net/client';
import { fileText, type CareerState, type LadderProgress } from '@shared/trophies';

const PER_ROW = 5, ROWS_SHELF = 2, CUP_STEP = 0.21;
/** `x0`: the shelf's centre; `y0`: its lower plank; `scale`: its size, grown from that point (1: 1.17 m wide) */
export function trophyShelf(ctx: Context, x0: number, y0: number, scale = 1) {
  const zWall = ctx.zB + 0.31;
  const group = new THREE.Group(); group.userData.isStatic = false;
  const plank = materialSteel('#3a3530');
  const W = PER_ROW * CUP_STEP + 0.12, levels = [y0, y0 + 0.46];
  for (const y of levels) group.add(box(W, 0.035, 0.2, plank, x0, y, zWall + 0.1));
  for (const dx of [-W / 2 + 0.03, W / 2 - 0.03]) group.add(box(0.03, levels[1] - levels[0] + 0.1, 0.2, plank, x0 + dx, (levels[0] + levels[1]) / 2, zWall + 0.1));
  // a lit wooden backboard, so the shelf reads against the wall's bands
  group.add(box(W + 0.08, levels[1] - levels[0] + 0.5, 0.03, new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.7, emissive: new THREE.Color('#2a1a0c'), emissiveIntensity: 0.6 }), x0, (levels[0] + levels[1]) / 2 + 0.1, zWall + 0.015));
  // the cup: a lathe profile on a small plinth
  const profile = [[0, 0], [0.045, 0], [0.045, 0.02], [0.014, 0.03], [0.012, 0.07], [0.03, 0.085], [0.05, 0.13], [0.055, 0.15], [0.05, 0.15], [0.044, 0.135], [0.026, 0.093], [0, 0.088]].map(([a, b]) => new THREE.Vector2(a, b));
  const cupGeo = new THREE.LatheGeometry(profile, 18); cupGeo.scale(1.35, 1.35, 1.35);
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.85, roughness: 0.28, emissive: new THREE.Color('#5a3a00'), emissiveIntensity: 0.35 });
  const ghost = new THREE.MeshStandardMaterial({ color: '#8a9aa0', metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.22, depthWrite: false });
  const cups: THREE.Mesh[] = [];
  for (let k = 0; k < PER_ROW * ROWS_SHELF; k++) {
    const m = new THREE.Mesh(cupGeo, ghost);
    m.position.set(x0 + (k % PER_ROW - (PER_ROW - 1) / 2) * CUP_STEP, levels[Math.floor(k / PER_ROW)] + 0.018, zWall + 0.11);
    m.visible = false; group.add(m); cups.push(m);
  }
  // medals toward a trophy (kind awards): small gold discs leaning in front of its cup, one per accepted medal
  const discGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.008, 16); discGeo.rotateX(Math.PI / 2 - 0.35);
  const medals = cups.map(cup => Array.from({ length: 5 }, (_, j) => {
    const d = new THREE.Mesh(discGeo, gold); d.position.set(cup.position.x - 0.084 + j * 0.042, cup.position.y + 0.03, cup.position.z + 0.075); d.visible = false; group.add(d); return d;
  }));
  const { c, g: gg } = canvas(512, 64), tex = textureOf(c);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.0875), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.6 }));
  plaque.position.set(x0, levels[0] - 0.09, zWall + 0.035); group.add(plaque);
  let plaqueText = '';
  const paint = (n: number, total: number, level?: string) => {
    gg.fillStyle = '#b8913a'; gg.fillRect(0, 0, 512, 64); gg.strokeStyle = '#5e4a1c'; gg.lineWidth = 6; gg.strokeRect(3, 3, 506, 58);
    gg.fillStyle = '#231a0c'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
    const label = `${(level ?? tr('trophies.shelf')).toUpperCase()} · ${n}/${total}`;   // the level of the last verification, once there is one
    let px = 34; do { gg.font = `800 ${px}px ${SOURCES.mono}`; } while (gg.measureText(label).width > 480 && --px > 12);   // shrink to fit
    gg.fillText(label, 256, 34); tex.needsUpdate = true; plaqueText = label;
  };
  paint(0, 0);
  // the whole shelf is the click target and the device's measured zone (shelter.ts: a piece with userData.interactive
  // opens that device with its view)
  const hit = new THREE.Mesh(new THREE.BoxGeometry(W, levels[1] - levels[0] + 0.5, 0.24), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(x0, (levels[0] + levels[1]) / 2 + 0.05, zWall + 0.12); hit.userData.interactive = 'trofeos'; hit.userData.view = 'trofeos'; group.add(hit);
  group.scale.setScalar(scale); group.position.set(x0, y0, zWall).multiplyScalar(1 - scale);   // grown around (x0, y0, the wall)
  ctx.g.add(group); ctx.device('trofeos', hit);
  let signature = '', earned: THREE.Mesh[] = [];
  // a cup not yet earned fills in with its progress (medals collected, PRs merged…): fainter the further it is
  const ghosts = cups.map(() => ghost.clone());
  const show = (career: CareerState | undefined, progress?: LadderProgress) => {
    const step = career?.steps.find(s => s.step.id === progress?.level)?.step, level = step ? fileText(step.name) : undefined;
    const list = (career?.trophies ?? []).slice(0, cups.length).map(x => ({ won: !!x.earnedAt, p: Math.round(x.progress * 10) / 10, medals: x.rule.kind === 'awards' && !x.earnedAt ? Math.min(x.count, 5) : 0 }));
    const f = JSON.stringify([list, level]); if (f === signature) return; signature = f;
    cups.forEach((m, k) => { m.visible = k < list.length; m.material = list[k]?.won ? gold : ghosts[k]; ghosts[k].opacity = 0.18 + 0.5 * (list[k]?.p ?? 0); });
    medals.forEach((row, k) => row.forEach((d, j) => { d.visible = j < (list[k]?.medals ?? 0); }));
    earned = cups.filter((m, k) => list[k]?.won);
    paint(list.filter(x => x.won).length, career?.trophies.length ?? 0, level);
  };
  const read = () => { client.action<{ career: CareerState; progress?: LadderProgress }>('bitacora.leer', {}).then(d => show(d?.career, d?.progress)).catch(() => {}); };
  // read from the frame loop, not a timer: a room rebuilt leaves nothing running behind
  let lastRead = -Infinity;
  ctx.onUpdate((_dt, t) => {
    if (t - lastRead > 300) { lastRead = t; read(); }
    for (const [k, m] of earned.entries()) m.rotation.y = Math.sin(t * 0.4 + k) * 0.25;
  });
  ctx.room.userData.trophyShelf = { shown: () => ({ cups: cups.filter(m => m.visible).length, earned: earned.length, medals: medals.flat().filter(d => d.visible).length, plaque: plaqueText }) };
}

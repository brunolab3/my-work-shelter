// The trophy shelf on a room's back wall (shared/trophies.ts): one cup per vertical of the career ladder on the top
// plank, in the colour of the level it reached (bronze, silver, gold), a faint outline filling in with its progress
// until then; under it hangs a red cloth with one disc per accepted medal laid under its trophy's cup, and a brass
// plaque with the count. It is the room's device `trofeos` (rooms/index.ts): a click opens the Trophies and career
// panel. Read again every five minutes; rebuilt only when what it shows changes. QA reads `room.userData.trophyShelf.shown()`.
import * as THREE from 'three';
import { t as tr } from '@shared/language';
import { canvas, textureOf, SOURCES } from '../../engine/textures';
import { materialSteel, box, type Context } from './common';
import { client } from '../../net/client';
import { fileText, type CareerState, type LadderProgress, type Level } from '@shared/trophies';

const CUPS = 7, CUP_STEP = 0.17, MEDALS_PER_CUP = 8, CLOTH = 0.44;
/** `x0`: the shelf's centre; `y0`: the cloth's lower edge; `scale`: its size, grown from that point (1: 1.31 m wide) */
export function trophyShelf(ctx: Context, x0: number, y0: number, scale = 1) {
  const zWall = ctx.zB + 0.31;
  const group = new THREE.Group(); group.userData.isStatic = false;
  const plank = materialSteel('#3a3530');
  const W = CUPS * CUP_STEP + 0.12, yTop = y0 + 0.46;
  group.add(box(W, 0.035, 0.2, plank, x0, yTop, zWall + 0.1));
  // a lit wooden backboard, so the shelf reads against the wall's bands
  group.add(box(W + 0.08, yTop - y0 + 0.5, 0.03, new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.7, emissive: new THREE.Color('#2a1a0c'), emissiveIntensity: 0.6 }), x0, (y0 + yTop) / 2 + 0.1, zWall + 0.015));
  // the red cloth hanging from the plank, weighed down by a brass rod, with the medals laid on it
  const yCloth = yTop - 0.02 - CLOTH / 2;
  group.add(box(W - 0.06, CLOTH, 0.008, new THREE.MeshStandardMaterial({ color: '#8c1d1d', roughness: 0.95, emissive: new THREE.Color('#300606'), emissiveIntensity: 0.5 }), x0, yCloth, zWall + 0.04));
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, W - 0.02, 8), materialSteel('#b8913a')); rod.rotation.z = Math.PI / 2; rod.position.set(x0, yTop - 0.02 - CLOTH, zWall + 0.046); group.add(rod);
  // the cup: a lathe profile on a small plinth
  const profile = [[0, 0], [0.045, 0], [0.045, 0.02], [0.014, 0.03], [0.012, 0.07], [0.03, 0.085], [0.05, 0.13], [0.055, 0.15], [0.05, 0.15], [0.044, 0.135], [0.026, 0.093], [0, 0.088]].map(([a, b]) => new THREE.Vector2(a, b));
  const cupGeo = new THREE.LatheGeometry(profile, 18); cupGeo.scale(1.35, 1.35, 1.35);
  const metal = (color: string, emissive: string) => new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.28, emissive: new THREE.Color(emissive), emissiveIntensity: 0.35 });
  const gold = metal('#e8b84a', '#5a3a00');
  const LEVEL: Record<Level, THREE.Material> = { bronze: metal('#b8743a', '#3a1a05'), silver: metal('#cfd6dc', '#2a3036'), gold };
  const ghost = new THREE.MeshStandardMaterial({ color: '#8a9aa0', metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.22, depthWrite: false });
  const cups: THREE.Mesh[] = [];
  for (let k = 0; k < CUPS; k++) {
    const m = new THREE.Mesh(cupGeo, ghost);
    m.position.set(x0 + (k - (CUPS - 1) / 2) * CUP_STEP, yTop + 0.018, zWall + 0.11);
    m.visible = false; group.add(m); cups.push(m);
  }
  // the medals of a trophy: gold discs lying on the cloth under its cup, two by two
  const discGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 16); discGeo.rotateX(Math.PI / 2);
  const medals = cups.map(cup => Array.from({ length: MEDALS_PER_CUP }, (_, j) => {
    const d = new THREE.Mesh(discGeo, gold); d.position.set(cup.position.x + (j % 2 - 0.5) * 0.065, yTop - 0.075 - Math.floor(j / 2) * 0.09, zWall + 0.048); d.visible = false; group.add(d); return d;
  }));
  const { c, g: gg } = canvas(512, 64), tex = textureOf(c);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.0875), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.6 }));
  plaque.position.set(x0, y0 - 0.09, zWall + 0.035); group.add(plaque);
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
  const hit = new THREE.Mesh(new THREE.BoxGeometry(W, yTop - y0 + 0.5, 0.24), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(x0, (y0 + yTop) / 2 + 0.05, zWall + 0.12); hit.userData.interactive = 'trofeos'; hit.userData.view = 'trofeos'; group.add(hit);
  group.scale.setScalar(scale); group.position.set(x0, y0, zWall).multiplyScalar(1 - scale);   // grown around (x0, y0, the wall)
  ctx.g.add(group); ctx.device('trofeos', hit);
  let signature = '', earned: THREE.Mesh[] = [];
  // a cup not yet won fills in with its progress (awards collected): fainter the further it is
  const ghosts = cups.map(() => ghost.clone());
  let levels: (Level | undefined)[] = [];
  const show = (career: CareerState | undefined, progress?: LadderProgress) => {
    const step = career?.steps.find(s => s.step.id === progress?.level)?.step, level = step ? fileText(step.name) : undefined;
    const list = (career?.verticals ?? []).slice(0, cups.length).map(x => ({ level: x.level, p: Math.round(x.progress * 10) / 10, medals: Math.min(x.medals.length, MEDALS_PER_CUP) }));
    const f = JSON.stringify([list, level]); if (f === signature) return; signature = f;
    cups.forEach((m, k) => { m.visible = k < list.length; const lv = list[k]?.level; m.material = lv ? LEVEL[lv] : ghosts[k]; ghosts[k].opacity = 0.18 + 0.5 * (list[k]?.p ?? 0); });
    medals.forEach((row, k) => row.forEach((d, j) => { d.visible = j < (list[k]?.medals ?? 0); }));
    earned = cups.filter((m, k) => list[k]?.level);
    levels = list.map(x => x.level);
    paint(earned.length, list.length, level);
  };
  const read = () => { client.action<{ career: CareerState; progress?: LadderProgress }>('workLog.read', {}).then(d => show(d?.career, d?.progress)).catch(() => {}); };
  // read from the frame loop, not a timer: a room rebuilt leaves nothing running behind
  let lastRead = -Infinity;
  ctx.onUpdate((_dt, t) => {
    if (t - lastRead > 300) { lastRead = t; read(); }
    for (const [k, m] of earned.entries()) m.rotation.y = Math.sin(t * 0.4 + k) * 0.25;
  });
  ctx.room.userData.trophyShelf = { shown: () => ({ cups: cups.filter(m => m.visible).length, earned: earned.length, medals: medals.flat().filter(d => d.visible).length, levels, plaque: plaqueText }) };
}

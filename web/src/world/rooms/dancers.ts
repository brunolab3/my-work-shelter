// Los robots chiquitines que bailan en la pista de la discoteca. KayKit no trae un clip de baile: cada robot encadena
// clips del esqueleto (los brazos arriba de Cheering, el bote de Jump_Idle, los pasos en el sitio de las carreras y los
// desplazamientos laterales, la guardia del boxeador…) cambiando cada dos compases, con la velocidad ajustada para que
// cada vuelta del clip dure golpes enteros, y encima un movimiento por código a ritmo: bote en cada golpe, cadera y
// hombros que se balancean, cabeceo, giros de 90º en los cambios de compás y algún paso lateral. Cada uno con su estilo
// y su desfase. Sin música descansan: de pie mirando el móvil, charlando o sentados en el suelo al borde de la pista.
// No son obstáculos: si el Supervisor se mete en la pista, se apartan un poco.
import * as THREE from 'three';
import { Character } from '../character';
import type { Look } from '@shared/appearance';

export interface Rhythm { playing: boolean; bpm: number; pulse: number; energy: number }   // pulso: golpes desde el inicio (con decimales)

interface Style {
  clips: string[];                 // lo que baila, por turnos de dos compases
  accents: string[];               // gestos sueltos en algún cambio de compás
  rotations: number[];                 // hacia dónde mira en cada compás (0: a la cámara)
  step: number;                    // amplitud del paso lateral (m)
  bounce: number;                    // altura del bote (m, a escala de robot)
  hip: number; shoulders: number; head: number;
  pause: string;                // sin música
}

const STYLES: Style[] = [
  { clips: ['Cheering', 'Jump_Idle', 'Running_Strafe_Left', 'Running_Strafe_Right'], accents: ['Ranged_Magic_Summon'], rotations: [0, Math.PI / 2, 0, -Math.PI / 2], step: 0.16, bounce: 0.07, hip: 0.12, shoulders: 0.1, head: 0.12, pause: 'Idle_B' },
  { clips: ['Melee_Unarmed_Idle', 'Walking_C', 'Waving', 'Jump_Idle'], accents: ['Interact'], rotations: [0.35, -0.35, 0.35, -0.35], step: 0.1, bounce: 0.05, hip: 0.16, shoulders: 0.06, head: 0.18, pause: 'Idle_A' },
  { clips: ['Ranged_Magic_Spellcasting', 'Running_A', 'Cheering', 'Melee_2H_Idle'], accents: ['Ranged_Magic_Summon'], rotations: [0, 0, Math.PI / 2, 0, 0, -Math.PI / 2], step: 0, bounce: 0.06, hip: 0.1, shoulders: 0.14, head: 0.1, pause: 'Sit_Floor_Idle' },
  { clips: ['Jump_Idle', 'Running_Strafe_Right', 'Ranged_Magic_Raise', 'Walking_B'], accents: ['Ranged_Magic_Shoot'], rotations: [-0.4, 0, 0.4, 0], step: 0.2, bounce: 0.08, hip: 0.08, shoulders: 0.12, head: 0.14, pause: 'Idle_B' },
  { clips: ['Waving', 'Melee_Unarmed_Idle', 'Running_Strafe_Left', 'Cheering'], accents: ['Interact'], rotations: [0, -Math.PI / 2, 0, Math.PI / 2], step: 0.14, bounce: 0.06, hip: 0.14, shoulders: 0.1, head: 0.16, pause: 'Sit_Floor_Idle' },
];

// los clips que ya repiten solos (los gestos se cortan y se encadenan, ver `bailar`)
const TIME_ONE = new Set(['Interact', 'Ranged_Magic_Summon', 'Ranged_Magic_Shoot']);   // (los saltos y regates del pack acaban en el suelo: fuera)

interface Dancer {
  p: Character; e: Style; home: THREE.Vector3; offset: number;
  away: THREE.Vector3;          // lo que se aparta del Supervisor
  turn: number; beat: number; clip: string; ready: boolean; dancing: boolean; restTurn: number;
  bones: { hip?: THREE.Object3D; chest?: THREE.Object3D; head?: THREE.Object3D };
  // la pose de esos huesos tal como la deja el clip, antes del retoque: se repone antes de cada fotograma (no todos los
  // clips traen pista para todos los huesos, y sin reponerla el retoque se iba sumando hasta tumbar al robot)
  pose: Map<THREE.Object3D, THREE.Quaternion>;
}

const tint = (torso: string, legs: string): Look['colors'] => ({ torso1: torso, cabeza1: torso, piernas1: legs });

/** Monta los bailarines en `g` (coordenadas locales de la sala). `casas`: dónde baila cada uno; `ritmo()`: el pulso. */
export function mountDancers(g: THREE.Group, houses: [number, number][], rhythm: () => Rhythm, supervisor: () => THREE.Object3D | null) {
  const colors = [tint('#c94f7c', '#3a3346'), tint('#3fa7c9', '#2d3440'), tint('#d9a03a', '#3b3329'), tint('#7a5bd1', '#2e2a3d'), tint('#5fbf86', '#2b3a33')];
  const dancers: Dancer[] = [];
  houses.forEach(([x, z], i) => {
    const type = i % 2 ? 'Robot_Two' : 'Robot_One';
    const p = new Character(type, { especie: 'robot', pieces: { cabeza: `cabeza.${type}`, torso: `torso.${type}`, brazos: `brazos.${type}`, piernas: `piernas.${type}` }, colors: colors[i % colors.length] });
    const b: Dancer = { p, e: STYLES[i % STYLES.length], home: new THREE.Vector3(x, 0, z), offset: (i * 0.37) % 1, away: new THREE.Vector3(), turn: i, beat: -1, clip: '', ready: false, dancing: false, restTurn: [0.5, -0.4, 0.9, -0.8, 0.2][i % 5], bones: {}, pose: new Map() };
    dancers.push(b);
    p.load().then(() => {
      p.root.scale.multiplyScalar(0.62);
      p.root.position.copy(b.home); p.root.rotation.y = p.goalTurn = b.restTurn;
      b.bones = { hip: p.model.getObjectByName('hips') ?? undefined, chest: p.model.getObjectByName('chest') ?? undefined, head: p.model.getObjectByName('head') ?? undefined };
      p.animateAfter = () => retouch(b);
      rest(b, true);
      g.add(p.root); b.ready = true;
    });
  });

  // sin música: cada uno a su descanso (los del suelo se sientan con su clip)
  function rest(b: Dancer, already = false) {
    b.dancing = false; b.clip = ''; b.beat = -1;
    b.p.goalTurn = b.restTurn;
    const d = b.e.pause;
    if (d === 'Sit_Floor_Idle' && !already) b.p.gesture('Sit_Floor_Down', () => b.p.play('Sit_Floor_Idle', 0.2), 0.3);
    else b.p.play(d, already ? 0 : 0.5);
    b.p.inRest = d;
  }
  function start(b: Dancer) {
    b.dancing = true; b.beat = -1;
    if (b.e.pause === 'Sit_Floor_Idle') { b.clip = 'Sit_Floor_StandUp'; b.p.gesture('Sit_Floor_StandUp', () => { b.clip = ''; }, 0.2); }
  }

  // la velocidad del clip para que una vuelta dure golpes enteros (1, 2, 4 u 8)
  function speed(p: Character, name: string, bpm: number) {
    const T = 60 / bpm, D = p.action(name).getClip().duration;
    let best = 1, err = Infinity;
    for (const n of [1, 2, 4, 8]) { const v = D / (n * T); const e = Math.abs(Math.log(v)); if (v > 0.55 && v < 1.9 && e < err) { err = e; best = v; } }
    return best;
  }

  function dance(b: Dancer, r: Rhythm) {
    const hits = r.pulse;                            // todos al mismo golpe; cada uno cambia de paso a su turno
    const beat = Math.floor(hits / 4);
    if (beat === b.beat || b.clip === 'Sit_Floor_StandUp') return;
    const changed = beat % 2 === 0 || b.beat < 0;  // cada dos compases, otro paso
    b.beat = beat;
    b.p.goalTurn = b.e.rotations[(beat + b.turn) % b.e.rotations.length];
    if (!changed) return;
    b.turn++;
    const next = b.e.clips[(b.turn) % b.e.clips.length];
    // en algún cambio, un acento suelto (un salto, un regate) antes del paso nuevo
    if (b.e.accents.length && (beat + b.turn * 3) % 5 === 0) {
      const a = b.e.accents[(beat + b.turn) % b.e.accents.length];
      b.clip = a; b.p.gesture(a, () => { b.clip = next; b.p.play(next, 0.15, { vel: speed(b.p, next, r.bpm) }); }, 0.12);
      return;
    }
    b.clip = next;
    const a = b.p.play(next, 0.18, { vel: speed(b.p, next, r.bpm) });
    // que la vuelta del clip empiece en el golpe
    if (a && !TIME_ONE.has(next)) a.time = ((hits % 1) * 60 / r.bpm) * a.timeScale;
  }

  // movimiento por código encima del clip, a ritmo (después de que el mezclador ponga la pose)
  const tmpV = new THREE.Vector3();
  function retouch(b: Dancer) {
    const r = currentRhythm; const f = r.pulse % 1, k = b.dancing ? gait : 0;
    for (const h of [b.bones.hip, b.bones.chest, b.bones.head]) if (h) { const q = b.pose.get(h); if (q) q.copy(h.quaternion); else b.pose.set(h, h.quaternion.clone()); }
    if (k < 0.01) return;
    const side = Math.sin(Math.PI * (r.pulse + b.offset));   // de un lado al otro cada golpe
    const strength = (0.65 + 0.35 * r.energy) * k;
    const { hip, chest, head } = b.bones;
    if (hip) { hip.rotation.z += side * b.e.hip * strength; hip.rotation.y += side * b.e.hip * 0.6 * strength; }
    if (chest) { chest.rotation.z -= side * b.e.shoulders * strength; chest.rotation.x += Math.exp(-f * 6) * 0.08 * strength; }
    if (head) head.rotation.x += (Math.exp(-f * 7) * 1.2 - 0.3) * b.e.head * strength;
  }

  let gait = 0;
  let currentRhythm: Rhythm = { playing: false, bpm: 118, pulse: 0, energy: 0 };
  const sup = new THREE.Vector3();
  function update(dt: number) {
    const r = rhythm(); currentRhythm = r;
    gait = THREE.MathUtils.damp(gait, r.playing ? 1 : 0, 3, dt);
    const s = supervisor(); let hasSup = false;
    if (s) { sup.copy(s.position); g.worldToLocal(sup); hasSup = Math.abs(sup.y) < 1.5 && Math.abs(sup.x) < 6.2 && Math.abs(sup.z) < 3; }
    for (const b of dancers) {
      if (!b.ready) continue;
      if (r.playing && !b.dancing) start(b);
      else if (!r.playing && b.dancing) rest(b);
      if (b.dancing) dance(b, r);
      // se aparta del Supervisor (sin dejar de bailar)
      tmpV.set(0, 0, 0);
      if (hasSup) {
        const dx = b.home.x - sup.x, dz = b.home.z - sup.z, d = Math.hypot(dx, dz);
        // encima del todo: hacia su lado de la pista; si no, en la dirección contraria al Supervisor
        if (d < 1.1) { if (d < 0.08) tmpV.set(Math.sign(b.home.x) || 1, 0, 0.3).normalize().multiplyScalar(1.1); else tmpV.set(dx, 0, dz).multiplyScalar((1.1 - d) / d); }
      }
      b.away.x = THREE.MathUtils.damp(b.away.x, tmpV.x, 4, dt); b.away.z = THREE.MathUtils.damp(b.away.z, tmpV.z, 4, dt);
      // paso lateral (va y viene cada dos compases) y bote en cada golpe
      const k = b.dancing ? gait : 0, f = r.pulse % 1;
      const step = b.e.step * Math.sin(Math.PI * 2 * (r.pulse / 8 + b.offset)) * k;
      const bounce = b.e.bounce * Math.sin(Math.PI * f) * (0.7 + 0.3 * r.energy) * k;
      const p = b.p.root;
      p.position.set(b.home.x + step + b.away.x, bounce, b.home.z + b.away.z);
      p.rotation.z = Math.sin(Math.PI * (r.pulse + b.offset)) * 0.05 * k;   // todo el cuerpo se mece un poco
      for (const [h, q] of b.pose) h.quaternion.copy(q);   // sin el retoque del fotograma anterior
      b.p.update(dt);
      if (b.dancing && b.clip && !TIME_ONE.has(b.clip) && b.p.current && b.p.currentName === b.clip) b.p.current.timeScale = speed(b.p, b.clip, r.bpm);
    }
  }
  return { dancers, update };
}

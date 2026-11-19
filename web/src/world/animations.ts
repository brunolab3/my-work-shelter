// Biblioteca de clips de Rig_Medium (KayKit): todos los personajes comparten esqueleto.
import * as THREE from 'three';
import { gltf } from '../engine/assets';

const BASE = 'kaykit/character-animations-1.1/Animations/gltf/Rig_Medium/Rig_Medium_';
export const PACKAGES = ['General', 'MovementBasic', 'MovementAdvanced', 'Simulation', 'Tools', 'CombatRanged', 'CombatMelee'] as const;

const clips = new Map<string, THREE.AnimationClip>();
let loading: Promise<void> | null = null;

export function loadClips(packages: readonly string[] = PACKAGES) {
  if (!loading) loading = (async () => {
    const gs = await Promise.all(packages.map(p => gltf(BASE + p + '.glb')));
    for (const g of gs) for (const c of g.animations) {
      if (clips.has(c.name)) continue;
      // Los clips son «en el sitio»: quitamos la traslación horizontal de root/hips por si alguno trae deriva
      for (const t of c.tracks) {
        if (/^(root|hips)\.position$/.test(t.name)) {
          const v = t.values; const x0 = v[0], z0 = v[2];
          for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        }
      }
      clips.set(c.name, c);
    }
  })();
  return loading;
}

export function clip(name: string): THREE.AnimationClip {
  const c = clips.get(name);
  if (!c) throw new Error('Clip desconocido: ' + name);
  return c;
}
export function namesClips() { return [...clips.keys()]; }

// Velocidad natural de un clip de locomoción (m/s a la escala del modelo dado): velocidad del pie apoyado.
// El modelo mira a +z; el pie apoyado se desplaza hacia -z a la velocidad a la que debe avanzar el cuerpo.
const speeds = new Map<string, number>();
export function speedNatural(name: string, model: THREE.Object3D): number {
  const key = name + '|' + model.scale.x.toFixed(4);
  if (speeds.has(key)) return speeds.get(key)!;
  const m = model.clone(true);
  m.position.set(0, 0, 0); m.rotation.set(0, 0, 0);
  const mixer = new THREE.AnimationMixer(m);
  mixer.clipAction(clip(name)).play();
  const feet = ['footl', 'footr'].map(n => m.getObjectByName(n)!);
  const dt = 1 / 60, N = Math.ceil(clip(name).duration * 2 / dt);
  const samples: THREE.Vector3[][] = [];
  for (let i = 0; i < N; i++) { mixer.update(dt); m.updateMatrixWorld(true); samples.push(feet.map(p => p.getWorldPosition(new THREE.Vector3()))); }
  const ymin = Math.min(...samples.flat().map(p => p.y));
  const threshold = ymin + 0.025 * m.scale.y / 0.8;
  let sum = 0, n = 0;
  for (let i = 1; i < N; i++) for (const k of [0, 1]) if (samples[i][k].y < threshold && samples[i - 1][k].y < threshold) { sum += -(samples[i][k].z - samples[i - 1][k].z) / dt; n++; }
  const vel = n ? sum / n : 1;
  speeds.set(key, vel);
  return vel;
}

// Clips compuestos: el tren inferior de uno (p. ej. sentado en la silla) y el superior de otro (los brazos de un clip de
// trabajo). KayKit no trae «teclear sentado» ni «leer sentado»: se montan con sus propios clips, sin animar a mano.
// `abajoFijo`: el tren inferior se queda en su primera pose (la silla no se mueve al ritmo de los brazos).
const INFERIOR = /^(root|hips|upperleg[lr]|lowerleg[lr]|foot[lr]|toes[lr])\./;
export function composeClip(name: string, below: string, above: string, o: { fixedBelow?: boolean; upSpeed?: number } = {}) {
  if (clips.has(name)) return clips.get(name)!;
  const a = clip(below), b = clip(above), k = 1 / (o.upSpeed ?? 1);
  const dur = b.duration * k;
  const tracks: THREE.KeyframeTrack[] = [];
  for (const t of a.tracks) {
    if (!INFERIOR.test(t.name)) continue;
    const n = t.getValueSize();
    if (o.fixedBelow) { const c = t.clone(); c.times = new Float32Array([0]); c.values = c.values.slice(0, n) as any; tracks.push(c); }
    else { const c = t.clone(); c.times = c.times.map(x => x * dur / a.duration) as any; tracks.push(c); }
  }
  for (const t of b.tracks) { if (INFERIOR.test(t.name)) continue; const c = t.clone(); c.times = c.times.map(x => x * k) as any; tracks.push(c); }
  const c = new THREE.AnimationClip(name, dur, tracks);
  clips.set(name, c);
  return c;
}

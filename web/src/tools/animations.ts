// Herramienta: rejilla de personajes reproduciendo clips, para elegir animaciones mirándolas.
import * as THREE from 'three';
import { model } from '../engine/assets';
import { loadClips, clip, namesClips, speedNatural } from '../world/animations';

const q = new URLSearchParams(location.search);
const filter = new RegExp(q.get('f') || '.', 'i');
const who = q.get('p') || 'kaykit/adventurers-2.0/Characters/gltf/Engineer.glb';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color('#3a3d44');
s.add(new THREE.HemisphereLight('#fff', '#667', 2)); const d = new THREE.DirectionalLight('#fff', 2); d.position.set(2, 5, 6); s.add(d);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const mixers: THREE.AnimationMixer[] = [];
const labels: { o: THREE.Object3D; el: HTMLDivElement }[] = [];
(window as any).__ready = async () => {
  await loadClips();
  const names = namesClips().filter(n => filter.test(n) && n !== 'T-Pose');
  const cols = Math.ceil(Math.sqrt(names.length * innerWidth / innerHeight));
  const rows = Math.ceil(names.length / cols);
  const sep = 2.6;
  const width = cols * sep, height = rows * sep * 1.15;
  const asp = innerWidth / innerHeight;
  const half = Math.max(width / asp, height) / 2;
  cam.left = -half * asp; cam.right = half * asp; cam.top = half; cam.bottom = -half; cam.position.set(0, 0, 20); cam.updateProjectionMatrix();
  for (let i = 0; i < names.length; i++) {
    const m = await model(who);
    const x = (i % cols - (cols - 1) / 2) * sep, y = -(Math.floor(i / cols) - (rows - 1) / 2) * sep * 1.15 - 1;
    m.position.set(x, y, 0); m.rotation.y = 0.5; s.add(m);
    const mx = new THREE.AnimationMixer(m); mx.clipAction(clip(names[i])).play(); mixers.push(mx);
    const el = document.createElement('div');
    let txt = names[i] + ' ' + clip(names[i]).duration.toFixed(2) + 's';
    if (/Walk|Run|Crawl|Sneak|Crouch/.test(names[i])) txt += ' v=' + speedNatural(names[i], m).toFixed(2);
    el.textContent = txt; document.getElementById('e')!.append(el); labels.push({ o: m, el });
  }
  for (const { o, el } of labels) { const p = o.position.clone(); p.y -= 0.25; p.project(cam); el.style.left = (p.x + 1) / 2 * innerWidth + 'px'; el.style.top = (1 - p.y) / 2 * innerHeight + 'px'; }
};
(window as any).__step = (dt: number) => { for (const m of mixers) m.update(dt); r.render(s, cam); };
if (!(window as any).__noLoop) { const c = new THREE.Clock(); r.setAnimationLoop(() => (window as any).__step(c.getDelta())); }

// Herramienta de desarrollo: hoja de contacto de modelos con medidas y materiales (para componer salas).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
const group = q.get('g') || 'modular_sci_fi';
const since = +(q.get('desde') || 0), count = +(q.get('n') || 96);
const S = 200;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#ffffff', '#555566', 1.6));
const d = new THREE.DirectionalLight('#ffffff', 2); d.position.set(3, 5, 4); scene.add(d);
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
const loader = new GLTFLoader();
const info: Record<string, unknown> = {};

(window as any).__ready = async () => {
  const index = await (await fetch('/assets/indice.json')).json();
  const list: string[] = (index[group] || []).slice(since, since + count);
  const g = document.getElementById('g')!;
  for (const path of list) {
    try {
      const gl = await loader.loadAsync('/assets/' + path.split('/').map(encodeURIComponent).join('/'));
      const o = gl.scene; scene.add(o);
      const box = new THREE.Box3().setFromObject(o); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
      const r = size.length() * 0.5 || 1;
      cam.position.set(c.x + r * 1.6, c.y + r * 1.0, c.z + r * 2.4); cam.lookAt(c); cam.near = r / 100; cam.far = r * 20; cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const mats = new Set<string>(); o.traverse((n: any) => { if (n.isMesh) [].concat(n.material).forEach((m: any) => mats.add(m.name)); });
      const div = document.createElement('div'); div.className = 'c';
      const cv = document.createElement('canvas'); cv.width = S; cv.height = S; cv.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
      const name = path.split('/').pop()!.replace(/\.(glb|gltf)$/, '');
      div.innerHTML = `<b>${name}</b><i>${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)}</i>`; div.prepend(cv); g.append(div);
      info[name] = { path, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], materials: [...mats], clips: gl.animations.map(a => a.name) };
      scene.remove(o);
    } catch (e) { console.log('FALLO ' + path + ' ' + e); }
  }
  (window as any).__info = info;
};
(window as any).__step = () => {};

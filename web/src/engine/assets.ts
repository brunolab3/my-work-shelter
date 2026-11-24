// Carga y preparación del material artístico (KayKit + Quaternius, CC0).
// - Un GLTF se carga una vez y se clona (la geometría se comparte).
// - Los materiales se preparan y se comparten por (archivo, nombre de material, variante de paleta).
// - Las medidas siempre con Box3 sobre el objeto ya instanciado (los accessors de Quaternius mienten).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { prepareMaterial, type Variant } from './palette';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

// una ruta puede llevar una versión (`?v=2`): cambia la URL cuando cambia el archivo y el navegador (o Electron) no sirve
// la copia vieja de su caché (el servidor manda max-age de un día, sin validación)
export function urlAsset(path: string) {
  const [file, version] = path.split('?');
  return '/assets/' + file.split('/').map(encodeURIComponent).join('/') + (version ? '?' + version : '');
}

export function gltf(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(urlAsset(path));
    p.catch(e => console.error('FALLO al cargar ' + path, e));
    cache.set(path, p);
  }
  return p;
}

// Atajos de rutas por pack
export const R = {
  sf: (n: string) => `quaternius/modular_sci_fi/${n}.glb`,
  home: (n: string) => `quaternius/house_interior_pack/${n}.glb`,
  sv: (n: string) => `quaternius/survival_pack/${n}.glb`,
  cy: (n: string) => `quaternius/cyberpunk_pack/${n}.glb`,
  crop: (n: string) => `quaternius/crops_pack/${n}.glb`,
  rock: (n: string) => `quaternius/nature_pack/${n}.glb`,
  furniture: (n: string) => `kaykit-extra/furniture-bits-1.0/Assets/gltf/${n}.gltf`,
  tools: (n: string) => `kaykit-extra/rpg-tools-bits-1.0/Assets/gltf/${n}.gltf`,
  resource: (n: string) => `kaykit-extra/resource-bits-1.0/Assets/gltf/${n}.gltf`,
  kitchen: (n: string) => `kaykit-extra/restaurant-bits-1.0/Assets/gltf/${n}.gltf`,
  base: (n: string) => `kaykit-extra/space-base-bits-1.0/Assets/gltf/${n}.gltf`,
  acc: (n: string) => `kaykit/adventurers-2.0/Assets/gltf/${n}.gltf`,
};

const matCache = new Map<string, THREE.Material>();

export interface ModelOptions {
  variant?: Variant;          // paleta de la sala (recoloreo por nombre de material)
  shadow?: boolean;             // proyecta sombra
  receives?: boolean;             // recibe sombra
  own?: boolean;            // materiales propios (no compartidos) para animarlos aparte
}

export async function model(path: string, o: ModelOptions = {}): Promise<THREE.Object3D> {
  const g = await gltf(path);
  const obj = SkeletonUtils.clone(g.scene);
  const pack = path.split('/')[0] === 'quaternius' ? path.split('/')[1] : path.split('/')[0];
  obj.traverse((n: any) => {
    if (!n.isMesh) return;
    n.castShadow = o.shadow ?? true;
    n.receiveShadow = o.receives ?? true;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    const fresh = mats.map((m: THREE.Material) => {
      // misma pieza de material (nombre, color y atlas) en modelos distintos del mismo pack → un solo material:
      // así la fusión estática junta cientos de mallas en pocas llamadas de dibujo
      const mm = m as THREE.MeshStandardMaterial;
      const tex = mm.map ? (mm.map.name || String((mm.map.image as any)?.src ?? '').split('/').pop() || mm.map.uuid) : '-';
      // en los packs que se repintan con la paleta, el color original no cuenta (todos acaban igual)
      const repainted = (pack === 'modular_sci_fi' || pack === 'cyberpunk_pack') && /^(Main|Main2|DarkGrey|Grey|Accent|Orange|DarkAccent|Accent_Dark|Light|LightGrey|MetalLight|Black|Dark|Pipes)$/.test(m.name);
      const key = `${pack}|${m.name}|${repainted ? '' : mm.color?.getHexString?.() ?? ''}|${tex}|${mm.vertexColors ? 'vc' : ''}|${o.variant?.id ?? '-'}`;
      if (o.own) return prepareMaterial(m.clone(), pack, o.variant);
      let pm = matCache.get(key);
      if (!pm) { pm = prepareMaterial(m.clone(), pack, o.variant); matCache.set(key, pm); }
      return pm;
    });
    n.material = Array.isArray(n.material) ? fresh : fresh[0];
  });
  return obj;
}

export function measure(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  return { box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
}

export interface Placement extends ModelOptions {
  pos?: [number, number, number];
  rot?: number;                  // giro en Y (radianes)
  rotX?: number; rotZ?: number;
  scale?: number;               // escala uniforme directa
  height?: number; width?: number; background?: number; // o ajustar por una dimensión real (tras girar 0)
  anchor?: 'base' | 'origin' | 'center' | 'ceiling' | 'back';
  name?: string;
  isStatic?: boolean;            // se puede fusionar con el resto de la sala
}

// Instancia un modelo, lo escala por la dimensión que fija su tamaño y lo apoya en su base (centrado en x/z).
export async function place(parent: THREE.Object3D, path: string, c: Placement = {}) {
  const obj = await model(path, c);
  const wrapper = new THREE.Group();
  wrapper.name = c.name || path.split('/').pop()!.replace(/\.(glb|gltf)$/, '');
  wrapper.add(obj);
  const { size, box } = measure(obj);
  let s = c.scale ?? 1;
  if (c.height) s = c.height / size.y; else if (c.width) s = c.width / size.x; else if (c.background) s = c.background / size.z;
  obj.scale.multiplyScalar(s);
  const anchor = c.anchor ?? 'base';
  if (anchor !== 'origin') {
    const cx = (box.min.x + box.max.x) / 2 * s, cz = (box.min.z + box.max.z) / 2 * s;
    let y = -box.min.y * s;
    if (anchor === 'center') y = -(box.min.y + box.max.y) / 2 * s;
    if (anchor === 'ceiling') y = -box.max.y * s;
    obj.position.set(obj.position.x * s - cx, obj.position.y * s + y, obj.position.z * s - (anchor === 'back' ? box.min.z * s : cz));
    if (anchor === 'back') obj.position.x = obj.position.x; // apoyado contra la pared (z mínima en 0)
  }
  if (c.pos) wrapper.position.set(...c.pos);
  wrapper.rotation.set(c.rotX ?? 0, c.rot ?? 0, c.rotZ ?? 0);
  wrapper.userData.isStatic = c.isStatic ?? true;
  wrapper.userData.size = new THREE.Vector3(size.x * s, size.y * s, size.z * s);
  parent.add(wrapper);
  return wrapper;
}

// Genera assets/indice.json: lista de modelos por grupo, para el catálogo y el cargador del juego.
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../assets/', import.meta.url).pathname;
if (!existsSync(root)) { console.error('No existe ./assets: ejecuta node scripts/download-assets.mjs (o ./shelter)'); process.exit(1); }
const all = [];
(function traverses(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) traverses(p);
    else if (/\.(glb|gltf)$/i.test(n)) all.push(relative(root, p));
  }
})(root);
const groups = {};
for (const r of all.sort()) {
  let g;
  if (r.startsWith('quaternius/')) g = r.split('/')[1];
  else if (r.startsWith('kaykit-extra/')) g = r.split('/')[1].replace(/-\d.*$/, '');
  else if (r.startsWith('terceros/')) g = 'terceros';   // modelos de la comunidad (CC-BY), versionados en el repo
  else if (r.includes('Rig_Medium')) g = 'animaciones';
  else if (r.includes('adventurers-2.0/Assets')) g = 'accessories';
  else if (/\/(characters?|Characters)\//.test(r)) g = 'characters';
  else g = 'props_kaykit';
  (groups[g] ||= []).push(r);
}
writeFileSync(join(root, 'indice.json'), JSON.stringify(groups, null, 1));
console.log(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])));

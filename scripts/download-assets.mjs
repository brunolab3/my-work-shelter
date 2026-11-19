// Descarga el material artístico fijado (todo CC0) desde scripts/assets_manifest.json (procedencia y licencias: docs/assets.md).
// Desde los commits fijados de los repos de origen. Idempotente.
import { readFileSync, mkdirSync, existsSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const target = process.argv[2] || 'assets';
const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'scripts/assets_manifest.json'), 'utf8'));
const queue = [];
const k = manifest.kaykit;
for (const files of Object.values(k.files)) for (const p of files) queue.push([k.repo, k.commit, p, join(target, 'kaykit', p.replace('assets/kaykit/', ''))]);
const q = manifest.quaternius;
for (const [pack, files] of Object.entries(q.files)) for (const p of files) queue.push([q.repo, q.commit, p, join(target, 'quaternius', pack, basename(p))]);
let ok = 0, already = 0; const failures = [];
async function download([repo, commit, path, local]) {
  if (existsSync(local) && statSync(local).size > 0) { already++; return; }
  mkdirSync(dirname(local), { recursive: true });
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); writeFileSync(local + '.part', Buffer.from(await r.arrayBuffer())); renameSync(local + '.part', local); ok++; return; }
    catch (e) { if (i === 2) failures.push(`${path}: ${e.message}`); else await new Promise(s => setTimeout(s, 1500 * (i + 1))); }
  }
}
for (let i = 0; i < queue.length; i += 16) { await Promise.all(queue.slice(i, i + 16).map(download)); process.stdout.write(`\r  material del kit: ${Math.min(i + 16, queue.length)}/${queue.length}`); }
console.log(`\n  ${ok} nuevos, ${already} ya estaban, ${failures.length} fallos`);
if (failures.length) { console.log(failures.slice(0, 10).join('\n')); process.exit(1); }

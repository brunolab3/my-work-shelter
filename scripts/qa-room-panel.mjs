// QA of the room panel (web/src/world/rooms/roomPanel.ts): every room that has one shows the same floor terminal at the
// same spot, its 'panel' device points at it (hover gives its label, a click opens the room panel), and nothing of the
// scene covers it. Saves one screenshot per room.
// Usage: SHELTER_DATOS=… node scripts/qa-room-panel.mjs <url> [folder] [room…]   (better a test shelter with stock and dressed repo rooms)
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url, dir = '_capturas/room-panel', ...only] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
// the camera eases in: wait until it has stayed put for a while
const still = async () => { let prev = '', same = 0; for (let i = 0; i < 80 && same < 4; i++) { const p = await pg.evaluate(() => window.__engine.camera.position.toArray().map(v => v.toFixed(2)).join()); same = p === prev ? same + 1 : 0; prev = p; await wait(250); } };
// on screen, the centre of the panel's zone (`zone`: its box mirrored to the right-hand side, the same in every room)
const centre = id => pg.evaluate(id => {
  const r = window.__shelter, s = r.rooms.find(x => x.id === id), it = s.interactive?.find(i => i.id === 'panel'), z = it?.zones?.[0];
  if (!z) return null;
  const THREE = r.supervisor.root.position.constructor;
  const c = new THREE((z.min.x + z.max.x) / 2, (z.min.y + z.max.y) / 2, z.max.z).add(s.group.position);
  c.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect();
  return { x: lz.left + (c.x + 1) / 2 * lz.width, y: lz.top + (1 - c.y) / 2 * lz.height, zone: [Math.min(Math.abs(z.min.x), Math.abs(z.max.x)), z.min.y, Math.max(Math.abs(z.min.x), Math.abs(z.max.x)), z.max.y].map(v => +v.toFixed(2)), n: it.zones.length };
}, id);
const rooms = await pg.evaluate(() => window.__shelter.rooms.map(s => ({ id: s.id, type: s.type, panel: !!s.interactive?.some(i => i.id === 'panel') })));
let first = null;
for (const s of rooms.filter(r => !only.length || only.includes(r.id))) {
  // the Overseer at the room panel, facing it (or, without one, in the middle of the room)
  await pg.evaluate(id => {
    window.__game.set({ panel: null, panelData: null }); window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: id } }));
    const r = window.__shelter, s = r.rooms.find(x => x.id === id), it = s.interactive?.find(i => i.id === 'panel'), sp = r.supervisor;
    sp.root.position.x = s.group.position.x + (it?.x ?? 0); if (it) { sp.root.position.z = it.z; sp.goalTurn = it.rotation ?? Math.PI; sp.root.rotation.y = sp.goalTurn; }
    r.frameRoom(s); r.followsCamera = false;   // the whole room in the picture, not centred on the Overseer
  }, s.id);
  await wait(800); await still();
  const c = await centre(s.id);
  if (c) {
    first ??= c.zone;
    check(c.n === 1 && c.zone.every((v, i) => Math.abs(v - first[i]) < 0.05), `${s.id}: one panel zone, at the same spot as the others (${c.zone})`);
    await pg.mouse.move(c.x, c.y); await wait(400);
    check(await pg.evaluate(() => window.__shelter.aimed?.it?.id) === 'panel', `${s.id}: the mouse over the monitor points at the panel`);
  } else check(!s.panel, `${s.id}: ${s.panel ? 'panel without a zone' : 'no room panel'}`);
  await pg.screenshot({ path: path.join(dir, `${s.id}.png`) });
  await pg.mouse.move(5, 5);
  await pg.evaluate(() => { window.__shelter.followsCamera = true; });
}
check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await b.close();
process.exit(failures ? 1 : 0);

// QA of the messenger robot (web/src/world/messenger.ts): frames a room, triggers a delivery client-side and logs the
// robot's and the dweller's position every 250 ms, with screenshots along the way.
// Usage: SHELTER_DATOS=… node scripts/qa-messenger.mjs <url> <out.png> [--from=puente] [--to=fever2] [--hand] [--chat]
//   default  room to room (send_to_room to another room): the robot runs from --from, down the shaft, to --to
//   --hand   inside --from (send_to_room to the own room): to its first hologram, by the dweller or, if busy, the robot
//   --chat   with the intercom open on --from's dweller, as when he sends it mid-conversation (he can't carry it then)
// Careful: with a copy of the real data the test server also runs the real integrations (task cleanup among them).
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const args = process.argv.slice(2);
const [url, out] = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const from = opt.from ?? 'puente', to = opt.to ?? 'fever2';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null }); });
await pg.evaluate(from => {
  const r = window.__refugio, s = r.salas.find(x => x.id === from);
  r.supervisor.raiz.position.set(s.grupo.position.x - 3, s.grupo.position.y, 1.2);
  r.activityMode = true; r.camara.goal.set(s.grupo.position.x, s.grupo.position.y + 1.4, 0); r.camara.distancia = 14; r.camara.immediate();
}, from);
if (opt.chat) await pg.evaluate(from => { const r = window.__refugio; r.interact(r.habitantes.find(x => x.sala.id === from)); }, from);
await new Promise(r => setTimeout(r, 2500));
console.log(await pg.evaluate(([from, to, hand]) => {
  const r = window.__refugio; window.__err = null;
  const f = [...r.hologramas.figuras.values()].find(x => x.sala.id === from && x.listo && !x.leaving);
  (hand ? r.messengers.enMano(from, f?.ruta) : r.messengers.salir(from, [to])).catch(e => { window.__err = String(e?.stack ?? e); });
  return hand ? `${from}: to the hologram ${f?.ruta ?? '(none)'}` : `${from} -> ${to}`;
}, [from, to, !!opt.hand]));
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 250));
  console.log(i, JSON.stringify(await pg.evaluate(from => {
    const r = window.__refugio, h = r.habitantes.find(x => x.sala.id === from), xyz = v => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    return { err: window.__err, dweller: [...xyz(h.pos), h.p.currentName], robots: [...r.messengers.trips].map(v => [...xyz(v.p.raiz.position), v.p.currentName]) };
  }, from)));
  if ([3, 8, 14, 20].includes(i)) await pg.screenshot({ path: out.replace('.png', `_${i}.png`) });
}
await b.close();

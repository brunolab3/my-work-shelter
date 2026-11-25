// QA del ratón sobre lo que se puede usar: al pasar por encima de un aparato (lo que se ve de él: el tablero de
// Logística, la pantalla, el sillón…), de un habitante o del ascensor sale su letrero con «Clic», y un clic lo usa al
// momento (abre su panel) mientras el Supervisor llega andando. Recorre todos los aparatos de las salas especiales.
// Uso: node scripts/qa-aim.mjs [url] [carpeta-capturas]   (SHELTER_DATOS para el token; mejor un refugio de pruebas)
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const gpu = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
// sin el Chromium de Playwright descargado, el Google Chrome del Mac
const b = await chromium.launch(gpu).catch(() => chromium.launch({ ...gpu, channel: 'chrome' }));
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0 + (url0.includes('?') ? '&' : '?') + 'res=0.5'), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(150); } return false; };
const signs = () => pg.evaluate(() => [...document.querySelectorAll('#etiquetas .label')].map(e => e.textContent));
// el centro en pantalla de la primera zona de un aparato (o de su columna, si la sala no la mide)
const center = (roomId, id) => pg.evaluate(([roomId, id]) => {
  const r = window.__shelter, s = r.rooms.find(x => x.id === roomId), it = s.interactive.find(i => i.id === id);
  const z = it.zones?.[0]; const THREE = r.supervisor.root.position.constructor;
  const c = z ? new THREE((z.min.x + z.max.x) / 2, z.max.y - Math.min(0.25, (z.max.y - z.min.y) / 4), z.max.z).add(s.group.position) : new THREE(s.group.position.x + it.x, s.group.position.y + 1.2, it.z - 0.6);
  c.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect();
  return { x: lz.left + (c.x + 1) / 2 * lz.width, y: lz.top + (1 - c.y) / 2 * lz.height, measured: !!z, text: it.text, panel: it.panel };
}, [roomId, id]);

// la cámara llega con suavidad: se espera a que se quede quieta (con swiftshader va a pocos fotogramas)
const still = async () => { let ant = ''; for (let i = 0; i < 60; i++) { const p = await pg.evaluate(() => window.__engine.camera.position.toArray().map(v => v.toFixed(2)).join()); if (p === ant) return; ant = p; await wait(250); } };
// sin panel ni conversación abiertos (un clic que cae en quien está delante del aparato abre la charla)
// y las ventanas que abre un aparato (el cliente de git, Spotify), minimizadas con ⌘M hasta que se vea el lienzo
const close = async () => {
  await pg.evaluate(() => { if (window.__game.get().talkingWith) window.dispatchEvent(new CustomEvent('shelter:dialog-end')); window.__game.set({ panel: null, panelData: null, talkingWith: null }); });
  for (let i = 0; i < 4; i++) {
    const x = pg.locator('button.console-x[title^="Cerrar"]'); if (!(await x.count())) break;
    await x.first().click(); await wait(400);
  }
};
// qué aparato se ha usado (algunos no dejan panel: abren su ventana y lo quitan)
await pg.evaluate(() => { const r = window.__shelter, use = r.useDevice.bind(r); r.useDevice = (s, it) => { window.__used = it.id; use(s, it); }; const aim = r.log.bind(r); r.log = n => { const x = aim(n); window.__last = x && (x.type + ':' + (x.it?.id ?? x.h?.id?.name ?? x.floor ?? '')); return x; }; const goA = r.goAPoint.bind(r); r.goAPoint = (d, f) => { window.__ida = [d.x.toFixed(2), d.y.toFixed(2), d.z.toFixed(2), !!f].join(); goA(d, f); }; });
const devices = await pg.evaluate(() => window.__shelter.rooms.filter(s => s.type !== 'repo' && s.type !== 'coordination').flatMap(s => (s.interactive ?? []).filter(i => !i.id.startsWith('vis:')).map(i => ({ room: s.id, id: i.id }))));
await wait(3000); await still();   // la entrada al refugio
for (const a of devices) {
  await pg.evaluate(id => { window.__game.set({ panel: null, panelData: null }); window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: id } })); }, a.room);
  await wait(500); await still();
  let c = await center(a.room, a.id);
  const ok = await until(async () => { c = await center(a.room, a.id); await pg.mouse.move(c.x, c.y); return (await pg.evaluate(() => { const aim = window.__shelter.aimed; return aim?.type === 'device' ? aim.it.id : null; })) === a.id; }, 10000);
  const ls = await signs();
  if (!ok) console.log('      ', JSON.stringify(await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const aim = window.__shelter.aimed; const j = window.__game.get(); return { onTop: e?.tagName + '.' + (e?.className?.baseVal ?? e?.className), x, y, aimed: aim && (aim.type + ':' + (aim.it?.id ?? aim.h?.id?.name ?? aim.floor)), talking: j.talkingWith, panel: j.panel, room: window.__shelter.currentRoom?.id }; }, [c.x, c.y])));
  // con el Supervisor ya al lado, el letrero es el de siempre (sobre él, con E)
  check(ok && ls.some(l => l.includes(c.text) && /(Clic|E)\s*Usar/.test(l)), `${a.room}/${a.id}${c.measured ? '' : ' (sin medir)'}: letrero «${c.text}» al pasar el ratón`);
  if (a.room === 'logistics' || a.id === 'board') await pg.screenshot({ path: path.join(dir, `apuntar-${a.room}.png`) });
  await pg.evaluate(() => { window.__used = null; });
  // justo antes del clic, otra vez donde esté ahora (la cámara aún puede asentarse)
  await still(); c = await center(a.room, a.id); await pg.mouse.move(c.x, c.y); await wait(300);
  await pg.mouse.click(c.x, c.y);
  check(await until(async () => (await pg.evaluate(() => window.__used)) === a.id, 1500), `${a.room}/${a.id}: el clic lo usa al momento (${await pg.evaluate(() => window.__used + ' → ' + window.__game.get().panel + ' · hablando: ' + window.__game.get().talkingWith + ' · ruta: ' + window.__shelter.supervisor.path.length + ' · apuntado al clic: ' + window.__last + ' · ida: ' + window.__ida + ' · sp: ' + window.__shelter.supervisor.root.position.toArray().map(v => v.toFixed(2)))})`);
  await close();
  await pg.mouse.move(5, 5); await wait(200);
}
// un habitante: «Clic Hablar»
const h = await pg.evaluate(() => {
  const r = window.__shelter, x = r.dwellers.find(h => h.p.root.visible); if (!x) return null;
  window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: x.room.id } }));
  return x.id.name;
});
if (h) {
  await wait(500); await still();
  const p = await pg.evaluate(n => { const x = window.__shelter.dwellers.find(h => h.id.name === n); const v = x.p.root.position.clone(); v.y += 1.0; v.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect(); return { x: lz.left + (v.x + 1) / 2 * lz.width, y: lz.top + (1 - v.y) / 2 * lz.height }; }, h);
  const restsOn = () => pg.evaluate(n => { const x = window.__shelter.dwellers.find(h => h.id.name === n); const v = x.p.root.position.clone(); v.y += 1.0; v.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect(); return { x: lz.left + (v.x + 1) / 2 * lz.width, y: lz.top + (1 - v.y) / 2 * lz.height }; }, h);
  await until(async () => { const q = await restsOn(); await pg.mouse.move(q.x, q.y); return (await pg.evaluate(() => window.__shelter.aimed?.type)) === 'dweller'; }, 6000);
  const ls = await signs();
  check(ls.some(l => l.includes('Clic') && l.includes('Hablar')), `habitante ${h}: letrero con «Clic Hablar»`);
  check(await pg.evaluate(() => document.querySelector('canvas').style.cursor) === 'pointer', 'el cursor es la mano');
}
await close();
// arrastrar mueve la cámara y no manda al Supervisor a ningún sitio; al echar a andar, vuelve al encuadre
await pg.mouse.move(5, 5); await still();
const before = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, sp: window.__shelter.supervisor.root.position.x }));
await pg.mouse.move(800, 600); await pg.mouse.down(); for (let i = 1; i <= 10; i++) await pg.mouse.move(800 - i * 40, 600); await pg.mouse.up();
await still();
const after = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, sp: window.__shelter.supervisor.root.position.x, des: window.__shelter.camera.displacement.x, path: window.__shelter.supervisor.path.length }));
check(after.cam - before.cam > 2, `arrastrar 400 px a la izquierda mueve la cámara a la derecha (${(after.cam - before.cam).toFixed(2)} m)`);
check(Math.abs(after.sp - before.sp) < 0.05 && !after.path, 'arrastrar no hace andar al Supervisor');
await pg.screenshot({ path: path.join(dir, 'apuntar-arrastre.png') });
// andando solo (la ruta de un clic), la cámara no le sigue ni deshace lo arrastrado
const solo = await pg.evaluate(() => { const r = window.__shelter, sp = r.supervisor.root.position; r.goAPoint(sp.clone().setX(sp.x - 2.5)); return { cam: window.__engine.camera.position.x, des: r.camera.displacement.x }; });
await wait(1500);
const afterWalk = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, des: window.__shelter.camera.displacement.x }));
check(Math.abs(afterWalk.cam - solo.cam) < 0.3 && Math.abs(afterWalk.des - solo.des) < 0.05, `andando solo, la cámara se queda donde se dejó (${(afterWalk.cam - solo.cam).toFixed(2)} m)`);
await pg.keyboard.down('KeyD'); await wait(1500); await pg.keyboard.up('KeyD');
check(await until(async () => Math.abs(await pg.evaluate(() => window.__shelter.camera.displacement.x)) < 0.3, 6000), 'al andar, la cámara vuelve a seguir al Supervisor');
check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log(failures ? `${failures} fallo(s)` : 'todo bien');
process.exit(failures ? 1 : 0);

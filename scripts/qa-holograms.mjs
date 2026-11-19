// QA de las copias holográficas (worktrees): abre el refugio, espera a los hologramas y saca capturas.
// Uso: SHELTER_DATOS=… node scripts/qa-holograms.mjs <url> <salida.png> [--cerca] [--estados] [--nacer] [--eval="js"] [--pasos=N]
//   --cerca     encuadra el primer holograma de cerca
//   --estados   simula una sesión dentro de su worktree y captura cada estado (pensando, trabajando, esperando, terminado, avería, sin sesión)
//   --nacer     simula un worktree nuevo de un habitante de la sala: se materializa a su lado y va a su sitio (capturas por pasos)
//   --ayudantes two task worktrees with helpers (4 and 2) and a main-copy conversation with 2: holographic helpers, by their hologram
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const args = process.argv.slice(2);
const [url, output] = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const logs = []; pg.on('console', m => logs.push(m.text())); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null }); });
const steps = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await pg.evaluate(d => window.__step(d), dt); };
const check = () => pg.evaluate(() => [...window.__shelter.holograms.figures.values()].map(f => ({ path: f.path.split('/').slice(-2).join('/'), room: f.room.id, author: f.authorId, state: f.state, pose: f.pose, clip: f.p.currentName, x: +f.p.root.position.x.toFixed(2), z: +f.p.root.position.z.toFixed(2) })));
const near = () => pg.evaluate(() => {
  const r = window.__shelter; const f = [...r.holograms.figures.values()][0]; if (!f) return;
  r.supervisor.root.position.set(f.spot.x - 3.5, r.currentRoom.group.position.y, 1.2);
  r.activityMode = true; r.camara.goal.set(f.spot.x - 0.4, f.spot.y + 1.1, 0); r.camara.distance = 11; r.camara.immediate();
});
const photo = async suffix => { const path = suffix ? output.replace('.png', `_${suffix}.png`) : output; await pg.screenshot({ path: path }); console.log('->', path, JSON.stringify(await check()), JSON.stringify(await pg.evaluate(() => window.__shelter.dwellers.filter(h => h.room === window.__shelter.currentRoom).map(h => [h.id.id, h.state, +h.pos.x.toFixed(2), +h.pos.z.toFixed(2)])))); };

if (opt.ayudantes) {
  const helpers = (k, n) => Array.from({ length: n }, (_, i) => ({ id: `${k}_${i}`, description: `QA helper ${i}`, state: 'trabajando', mode: i % 2 ? 'escribir' : 'leer', tools: 2 }));
  await pg.evaluate(([a, b, c]) => {
    const r = window.__shelter, s = r.currentRoom, h = r.dwellers.find(x => x.room === s), now = Date.now();
    const sess = (id, cwd, helpers) => ({ id, dwellerId: h.id.id, roomId: s.id, cwd, state: 'trabajando', activity: { mode: 'escribir', text: 'QA' }, unread: false, title: 'QA', pending: 0, helpers, tools: 3, turns: 1, created: now, updated: now });
    window.__live.set(e => ({ sessions: { ...e.sessions, qa_a: sess('qa_a', s.path + '/.claude/worktrees/shelter-FAN-101', a), qa_b: sess('qa_b', s.path + '/.claude/worktrees/shelter-FAN-202', b), qa_m: sess('qa_m', s.path, c) } }));
  }, [helpers('a', 4), helpers('b', 2), helpers('m', 2)]);
  for (let i = 0; i < 400; i++) {
    const ready = await pg.evaluate(() => [...window.__shelter.helpers.robots.values()].filter(rb => rb.ready).length);
    if (ready >= 8 && i > 60) break;
    await steps(1); await new Promise(r => setTimeout(r, 20));
  }
  await pg.evaluate(() => { const r = window.__shelter; r.activityMode = true; r.camara.goal.set(r.currentRoom.group.position.x, r.currentRoom.group.position.y + 1.4, 0); r.camara.distance = 26; r.camara.immediate(); });
  await steps(60); await photo('ayudantes');
  console.log(JSON.stringify(await pg.evaluate(() => [...window.__shelter.helpers.robots.values()].map(rb => [rb.a.id, rb.holo?.path.split('/').pop() ?? 'main', +rb.p.root.position.x.toFixed(2), +rb.p.root.position.z.toFixed(2), +rb.p.root.scale.x.toFixed(3)]))));
} else if (opt.nacer) {
  // un worktree nuevo de alguien que vive en la sala: la sesión dentro llega antes que el refresco de repos
  // (en los primeros segundos tras cargar, las copias aparecen ya en su sitio: se espera a que pasen)
  await new Promise(r => setTimeout(r, 9000));
  await pg.evaluate(() => {
    const r = window.__shelter; const s = r.currentRoom; const h = r.dwellers.find(x => x.room === s);
    window.__live.set(e => ({ sessions: { ...e.sessions, qa_spawn: { id: 'qa_nacer', dwellerId: h.id.id, roomId: s.id, cwd: s.path + '/.claude/worktrees/shelter-qa', state: 'trabajando', activity: { mode: 'escribir', text: 'editando src/app.ts' }, unread: false, title: 'QA', pending: 0, helpers: [], tools: 3, turns: 1, created: Date.now(), updated: Date.now() } } }));
  });
  // with __noLoop the loop is stepped by hand: step it until the copy is in the scene
  let inScene = false;
  for (let i = 0; i < 600 && !inScene; i++) {
    inScene = await pg.evaluate(() => [...window.__shelter.holograms.figures.values()].some(f => f.path.endsWith('shelter-qa') && f.p.root.parent));
    if (!inScene) { await steps(1); await new Promise(r => setTimeout(r, 20)); }
  }
  if (!inScene) { console.log('FALLO: the hologram never appeared'); await b.close(); process.exit(1); }
  await pg.evaluate(() => { const r = window.__shelter; r.activityMode = true; r.camara.goal.set(r.currentRoom.group.position.x, r.currentRoom.group.position.y + 1.6, 0); r.camara.distance = 16; r.camara.immediate(); });
  for (const [k, n] of [[0, 4], [1, 10], [2, 14], [3, 30], [4, 60], [5, 120]]) { await steps(n); if (k === 1) await new Promise(r => setTimeout(r, 1500)); await photo('nacer' + k); }
  // y al desechar el worktree, se desvanece
  await pg.evaluate(() => window.__live.set(e => ({ sessions: Object.fromEntries(Object.entries(e.sessions).filter(([k]) => k !== 'qa_nacer')) })));
  await steps(8); await photo('desvanece');
  await steps(40); await new Promise(r => setTimeout(r, 1600)); await steps(2); await photo('fuera');
  console.log('en escena:', await pg.evaluate(() => window.__engine.scene.children.filter(o => o.name?.includes('shelter-qa')).length));
} else {
  await pg.waitForFunction(() => window.__shelter?.holograms?.figures?.size > 0 && [...window.__shelter.holograms.figures.values()].every(f => f.ready), null, { timeout: 30000 }).catch(() => logs.push('SIN HOLOGRAMAS'));
  if (opt.eval) await pg.evaluate(opt.eval);
  if (opt.cerca || opt.estados) await near();
  await steps(+(opt.pasos || 40));
  await photo('');
  if (opt.estados) {
    const session = (state, extra = {}) => pg.evaluate(([state, extra]) => {
      const f = [...window.__shelter.holograms.figures.values()][0];
      const s = { id: 'qa_holo', dwellerId: f.authorId, roomId: f.room.id, cwd: f.path, state, unread: false, title: 'Prueba de QA', pending: 0, helpers: [], tools: 5, turns: 1, created: Date.now(), updated: Date.now(), ...extra };
      window.__live.set(e => ({ sessions: state ? { ...e.sessions, qa_holo: s } : Object.fromEntries(Object.entries(e.sessions).filter(([k]) => k !== 'qa_holo')) }));
    }, [state, extra]);
    for (const [name, state, extra, n] of [
      ['pensando', 'trabajando', { activity: { mode: 'pensar', text: 'pensando…' } }, 80],
      ['trabajando', 'trabajando', { activity: { mode: 'escribir', text: 'editando server/main.ts' } }, 160],
      ['esperando', 'esperando', { pending: { title: 'permiso: git push' } }, 60],
      ['terminado', 'terminada', { unread: true }, 30],
      ['averia', 'error', { error: 'se cortó la conexión' }, 40],
      ['sinsesion', null, {}, 80],
    ]) { await session(state, extra); await steps(n); await photo(name); }
  }
}
for (const l of logs) if (/PAGEERROR|FALLO|error|SIN/i.test(l)) console.log(l);
await b.close();

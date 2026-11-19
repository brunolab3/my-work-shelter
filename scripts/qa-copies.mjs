// QA of the holographic copies as talkers of their own: each copy has its intercom (not its author's), E picks it by
// nearness even with its author beside it, its portrait is the hologram, with nothing to do it stays seated on its
// projector and, if a dweller's job moves to a worktree, the conversation moves to the copy.
// Uso: SHELTER_DATOS=… node scripts/qa-copies.mjs <url> <salida.png>   (QA_RETRATO=1 guarda además el retrato tal cual)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, output] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const logs = []; pg.on('console', m => logs.push(m.text())); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null }); });
const steps = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await pg.evaluate(d => window.__step(d), dt); };
const photo = async suffix => { const path = output.replace('.png', `_${suffix}.png`); await pg.screenshot({ path: path }); console.log('->', path); };
let failures = 0;
const check = (ok, text) => { console.log(ok ? '  ✓' : '  ✗', text); if (!ok) failures++; };
const session = (id, extra) => pg.evaluate(([id, extra]) => {
  const r = window.__shelter, s = r.currentRoom, h = r.dwellers.find(x => x.room === s);
  const base = { id, dwellerId: h.id.id, roomId: s.id, cwd: s.path, state: 'trabajando', activity: { mode: 'escribir', text: 'editando src/app.ts' }, unread: false, title: 'QA ' + id, pending: 0, helpers: [], tools: 3, turns: 1, created: Date.now(), updated: Date.now() };
  const sess = { ...base, ...(window.__live.get().sessions[id] ?? {}), ...extra };
  if (typeof sess.cwd === 'string' && sess.cwd.startsWith('WT:')) sess.cwd = s.path + '/.claude/worktrees/' + sess.cwd.slice(3);
  window.__live.set(e => ({ sessions: { ...e.sessions, [id]: sess } }));
  return { author: h.id.id, room: s.id, path: s.path };
}, [id, extra]);

// en una sala con repo y con alguien dentro
await pg.evaluate(() => { const r = window.__shelter; const s = r.rooms.find(x => x.path && r.dwellers.some(h => h.room === x)); window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: s.id } })); });
await steps(5);
// en los primeros segundos tras cargar, las copias aparecen ya en su sitio: se espera
await new Promise(r => setTimeout(r, 9000));
const { author, path } = await session('qa_a', { cwd: 'WT:shelter-qa-a', state: 'esperando', pending: { id: 'p1', type: 'permiso', title: 'permiso: git push' } });
const idA = 'holo:' + path + '/.claude/worktrees/shelter-qa-a';
console.log('autor', author, 'sala', path);
// el bucle va a mano: se avanza hasta que la copia llega a su sitio
const thatUntil = async (f, arg, max = 600) => { for (let i = 0; i < max; i++) { if (await pg.evaluate(f, arg)) return true; await steps(2); await new Promise(r => setTimeout(r, 20)); } return false; };
check(await thatUntil(id => window.__shelter.holograms.ofId(id)?.ready, idA), 'la copia se materializa y llega a su sitio');
await steps(4);
console.log('1) la copia tiene su propio intercomunicador');
let e = await pg.evaluate(([id, author]) => {
  const j = window.__game.get();
  return { copies: j.copies.map(c => c.id), windows: window.__intercoms?.get().list.map(v => [v.dwellerId, v.tabs.length]), strip: j.copies.find(c => c.id === id)?.state, stateAuthor: j.dwellers.find(h => h.id === author)?.state };
}, [idA, author]);
console.log('   ', JSON.stringify(e));
check(e.copies.includes(idA), 'la copia sale en juego.copias');
check(e.windows?.some(([id]) => id === idA) && !e.windows.some(([id]) => id === author), 'su conversación va en la ventana de la copia, no en la del autor');
check(e.strip === 'esperando' && e.stateAuthor !== 'esperando', 'el aviso es de la copia, no se le cuelga al autor');

console.log('2) con el autor al lado, E habla con quien está más cerca');
// the author right beside the copy; the Overseer just behind it (beside it, in a crowded room, would be another copy)
await pg.evaluate(([id, author]) => {
  const r = window.__shelter, f = r.holograms.ofId(id), h = r.dwellers.find(x => x.id.id === author);
  const fp = f.p.root.position; h.p.stop(); h.pos.set(fp.x + 1.1, fp.y, 1.0); h.fixed = true;
  r.supervisor.root.position.set(fp.x, r.currentRoom.group.position.y, fp.z - 0.6);
}, [idA, author]);
await steps(3);
check(await pg.evaluate(id => window.__shelter.nearby === window.__shelter.holograms.ofId(id) && !window.__shelter.nearest, idA), 'la copia es la elegida (no el autor)');
await photo('elegida');
await pg.keyboard.press('e'); await steps(30);
check(await pg.evaluate(id => window.__game.get().talkingWith === id, idA), 'E abre el intercomunicador de la copia');
await new Promise(r => setTimeout(r, 400)); await steps(10);
await photo('intercom');
console.log('   giro de la copia', await pg.evaluate(id => { const f = window.__shelter.holograms.ofId(id); return [+f.p.root.rotation.y.toFixed(2), +f.p.goalTurn.toFixed(2), f.pose, f.p.currentName]; }, idA));
if (process.env.QA_PORTRAIT) { const png = await pg.evaluate(() => { const R = window.__shelter.portrait; R.r.render(R.scene, R.cam); return [R.canvas.toDataURL(), R.name, R.cam.position.toArray()]; }); console.log('   retrato', png[1], png[2]); }
const header = await pg.evaluate(() => document.querySelector('.consola-rotulo')?.textContent + ' | ' + document.querySelector('.consola-nombre')?.textContent + ' | retrato holo: ' + !!document.querySelector('.retrato-crt.holo canvas'));
console.log('   ', header);
check(/ · Holo\S/.test(header) && /retrato holo: true/.test(header), 'cabecera de copia y retrato holográfico');
await pg.keyboard.press('Escape'); await steps(5);
await pg.evaluate(author => { window.__shelter.dwellers.find(x => x.id.id === author).fixed = false; }, author);

console.log('3) un trabajo del habitante que se muda a un worktree: la conversación sigue con la copia');
await session('qa_b', { cwd: path, state: 'trabajando' });
await steps(2);
await pg.evaluate(author => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: window.__shelter.currentRoom.id, dwellerId: author, talk: true } })), author);
await steps(10);
check(await pg.evaluate(author => window.__game.get().talkingWith === author, author), 'hablando con el autor');
await session('qa_b', { cwd: 'WT:shelter-qa-b' });
const idB = 'holo:' + path + '/.claude/worktrees/shelter-qa-b';
await thatUntil(id => window.__game.get().talkingWith === id, idB);
await steps(20);
e = await pg.evaluate(([idB, author]) => ({ talking: window.__game.get().talkingWith, windows: window.__intercoms?.get().list.map(v => [v.dwellerId.split('/').pop(), v.tabs.map(p => p.view.sessionId ?? p.view.type)]) }), [idB, author]);
console.log('   ', JSON.stringify(e));
check(e.talking === idB, 'el intercomunicador pasa a la copia nueva');
check(!e.windows.some(([id, ps]) => id === author && ps.includes('qa_b')), 'la pestaña ya no está en la ventana del autor');
await photo('traspaso');
await pg.keyboard.press('Escape'); await steps(5);

console.log('4) with nothing to do, the copy stays seated on its projector');
// el worktree simulado solo existe por su sesión: se queda, ya leída y sin nada en marcha
await session('qa_a', { state: 'terminada', unread: false, pending: undefined, activity: undefined });
await pg.evaluate(id => { const r = window.__shelter, f = r.holograms.ofId(id); r.supervisor.root.position.set(f.spot.x + 6, r.currentRoom.group.position.y, 0.2); f.walkClock = 0; }, idA);
const route = [];
for (let k = 0; k < 12; k++) { await steps(25); route.push(await pg.evaluate(id => { const f = window.__shelter.holograms.ofId(id); return [+f.p.root.position.x.toFixed(2), +f.p.root.position.z.toFixed(2), f.pose, f.p.currentName]; }, idA)); }
console.log('   ', JSON.stringify(route));
const xs = route.map(r => r[0]);
check(Math.max(...xs) - Math.min(...xs) < 0.05 && route.every(r => r[2] === 'base'), 'stays on its projector');
await photo('quieta');

console.log(logs.filter(l => /PAGEERROR|Error/.test(l)).slice(0, 10).join('\n'));
await b.close();
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

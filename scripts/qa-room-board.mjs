// QA of a repo room's task board (web/src/world/rooms/taskBoard.ts): one row for the main copy and one per worktree,
// with its task, its conversation's state (and what it's doing or waiting on) and one state for its PRs in this repo;
// a new worktree shows up live; a click on a row talks to that copy (or, the main copy's, to the room's dweller).
// Conversations, PRs and task titles are made up in the page (nothing reaches Claude Code, GitHub or Jira).
// Uso: SHELTER_DATOS=… SHELTER_PUERTO=… node scripts/qa-room-board.mjs <url> <salida.png> [sala]
//   (a test shelter with a repo room that has at least two worktrees in .claude/worktrees/)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, salida, salaPedida] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const logs = []; pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null }); });
const pasos = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await pg.evaluate(d => window.__step(d), dt); };
let failures = 0;
const comprobar = (ok, texto) => { console.log(ok ? '  ✓' : '  ✗', texto); if (!ok) failures++; };

// the room: the one asked for, or the first with two worktrees
const sala = await pg.evaluate(pedida => {
  const r = window.__refugio, repos = window.__live.get().repos;
  const s = r.salas.find(x => pedida ? x.id === pedida : (repos[x.id]?.worktrees ?? []).filter(w => !w.principal).length >= 2);
  if (s) window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: s.id } }));
  return s && { id: s.id, ruta: s.ruta, wts: repos[s.id].worktrees.filter(w => !w.principal).map(w => w.ruta) };
}, salaPedida);
if (!sala) { console.log('No repo room with two worktrees'); process.exit(1); }
console.log('sala', sala.id, sala.wts.length, 'worktrees');
await pasos(5); await new Promise(r => setTimeout(r, 6000)); await pasos(20);
const filas = () => pg.evaluate(id => window.__refugio.salas.find(s => s.id === id).userData.tableroTareas?.board.shown().map(r => ({ principal: r.principal, clave: r.clave, sesion: r.sesion, detalle: r.detalle, pr: r.pr, prs: r.prs, titulo: r.titulo })), sala.id);
const settle = async () => { for (let i = 0; i < 6; i++) { await pasos(6); await new Promise(r => setTimeout(r, 200)); } };

console.log('1) one row for the main copy and one per worktree');
let f = await filas();
comprobar(!!f, 'the room has its task board');
comprobar(f?.[0]?.principal && f.length === sala.wts.length + 1, `main copy first, then ${sala.wts.length} worktrees (${f?.length} rows)`);

console.log('2) states: conversations (waiting, working) and PRs rolled up per task, only this repo\'s');
const [a, c] = sala.wts;
await pg.evaluate(([sala, a, c]) => {
  const h = window.__live.get().estado.habitantes.find(x => x.salaId === sala.id);
  const ses = (id, cwd, extra) => ({ id, dwellerId: h.id, salaId: sala.id, cwd, estado: 'trabajando', sinLeer: false, titulo: 'QA ' + id, pendientes: 0, ayudantes: [], herramientas: 3, turns: 1, created: Date.now(), actualizada: Date.now(), ...extra });
  window.__live.set(e => ({ sesiones: { ...e.sesiones,
    qa_a: ses('qa_a', a, { estado: 'esperando', pending: { id: 'p1', tipo: 'permiso', herramienta: 'Bash', titulo: 'permiso: git push', canAlways: false } }),
    qa_c: ses('qa_c', c + '/src', { actividad: { herramienta: 'Edit', texto: 'editando src/checkout.ts', modo: 'escribir' } }),
    qa_m: ses('qa_m', sala.ruta, { estado: 'ociosa' }) } }));
  const rama = r => window.__live.get().repos[sala.id].worktrees.find(w => w.ruta === r).rama;
  const repo = 'org/' + sala.ruta.split('/').pop();
  const pr = (n, rama, extra) => ({ numero: n, titulo: 'QA PR ' + n, url: 'https://github.com/' + repo + '/pull/' + n, repo, rama, estado: 'abierto', actualizado: Date.now(), ...extra });
  window.__board.set({ prs: [pr(1, rama(a), { revision: 'APPROVED' }), pr(2, rama(a), { revision: 'REVIEW_REQUIRED' }), pr(3, rama(c), { estado: 'borrador' }),
    { ...pr(9, rama(a), { checks: 'FAILURE' }), repo: 'org/otro-repo', url: 'https://github.com/org/otro-repo/pull/9' }] });
}, [sala, a, c]);
await settle();
f = await filas();
console.log('   ', JSON.stringify(f));
const fa = f.find(r => r.principal === false && r.sesion === 'esperando'), fc = f.find(r => r.sesion === 'trabajando');
comprobar(fa?.detalle === 'permiso: git push', 'the waiting copy says what it waits on');
comprobar(fa?.pr === 'revision' && fa?.prs === 2, 'its two PRs in this repo roll up to «in review» (the failing one in another repo doesn\'t count)');
comprobar(fc?.detalle === 'editando src/checkout.ts' && fc?.pr === 'borrador', 'the working copy says what it does, with its draft PR');
comprobar(f[0].sesion === 'abierta', 'the main copy has its open conversation');
await pg.evaluate(() => { const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden'; });
await pg.screenshot({ path: salida }); console.log('->', salida);
await pg.evaluate(() => { const ui = document.getElementById('ui'); if (ui) ui.style.visibility = ''; });

console.log('3) a new worktree shows up live; gone, its row goes');
const nueva = sala.ruta + '/.claude/worktrees/shelter-QA-77';
await pg.evaluate(([id, ruta]) => window.__live.set(e => ({ repos: { ...e.repos, [id]: { ...e.repos[id], worktrees: [...e.repos[id].worktrees, { ruta, rama: 'worktree-shelter-QA-77', principal: false, cambios: 2, advanced: 1 }] } } })), [sala.id, nueva]);
await settle();
f = await filas();
comprobar(f.some(r => r.clave === 'QA-77'), 'the new worktree has its row');
await pg.evaluate(([id, ruta]) => window.__live.set(e => ({ repos: { ...e.repos, [id]: { ...e.repos[id], worktrees: e.repos[id].worktrees.filter(w => w.ruta !== ruta) } } })), [sala.id, nueva]);
await settle();
comprobar(!(await filas()).some(r => r.clave === 'QA-77'), 'removed, its row goes');

console.log('4) a click on a row talks to that copy; on the main copy\'s, to the room\'s dweller');
// the screen point of the centre of row k (the board's mesh, uv → its plane)
const pointOf = k => pg.evaluate(([id, k]) => {
  const s = window.__refugio.salas.find(x => x.id === id); const { mesh, board } = s.userData.tableroTareas;
  const THREE = window.__THREE; const H = board.c.height; const fila = board.filas[k]; const v = 1 - (fila.y0 + fila.y1) / 2 / H;
  const g = mesh.geometry.parameters; const p = new THREE.Vector3((0.3 - 0.5) * g.width, (v - 0.5) * g.height, 0.01).applyMatrix4(mesh.matrixWorld);
  p.project(window.__engine.camera); const r = window.__engine.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}, [sala.id, k]);
const ready = await pg.evaluate(ruta => !!window.__refugio.hologramas.ofId('holo:' + ruta)?.listo, a);
comprobar(ready, 'the copy\'s hologram is in the room');
let pt = await pointOf(f.findIndex(r => r.sesion === 'esperando'));
await pg.mouse.move(pt.x, pt.y); await pasos(3); await pg.mouse.down(); await pg.mouse.up(); await pasos(10);
let hablando = await pg.evaluate(() => window.__juego.get().talkingWith);
comprobar(hablando === 'holo:' + a, `clicking the waiting row talks to its copy (${hablando})`);
await pg.evaluate(() => window.__juego.set({ talkingWith: null })); await pasos(10);
pt = await pointOf(0);
await pg.mouse.move(pt.x, pt.y); await pasos(3); await pg.mouse.down(); await pg.mouse.up(); await pasos(10);
hablando = await pg.evaluate(() => window.__juego.get().talkingWith);
const dueno = await pg.evaluate(id => window.__live.get().estado.habitantes.find(h => h.salaId === id)?.id, sala.id);
comprobar(hablando === dueno, `clicking the main copy's row talks to the room's dweller (${hablando})`);

// leave the made-up conversations out of the shelter's state
await pg.evaluate(() => window.__live.set(e => { const s = { ...e.sesiones }; delete s.qa_a; delete s.qa_c; delete s.qa_m; return { sesiones: s }; }));
for (const l of logs) console.log(l);
console.log(failures ? `✗ ${failures} failed` : '✓ all good');
await b.close();
process.exit(failures ? 1 : 0);

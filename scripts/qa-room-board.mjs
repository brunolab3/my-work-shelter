// QA of a repo room's task board (web/src/world/rooms/taskBoard.ts): one row for the main copy and one per worktree,
// with its task, its conversation's state (and what it's doing or waiting on) and one state for its PRs in this repo;
// a new worktree shows up live; a click on a row talks to that copy (or, the main copy's, to the room's dweller).
// Conversations, PRs and task titles are made up in the page (nothing reaches Claude Code, GitHub or Jira).
// Uso: SHELTER_DATOS=… SHELTER_PUERTO=… node scripts/qa-room-board.mjs <url> <salida.png> [sala]
//   (a test shelter with a repo room that has at least two worktrees in .claude/worktrees/)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, output, requestedRoom] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const logs = []; pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null }); });
const steps = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await pg.evaluate(d => window.__step(d), dt); };
let failures = 0;
const check = (ok, text) => { console.log(ok ? '  ✓' : '  ✗', text); if (!ok) failures++; };

// the room: the one asked for, or the first with two worktrees
const room = await pg.evaluate(requested => {
  const r = window.__shelter, repos = window.__live.get().repos;
  const s = r.rooms.find(x => requested ? x.id === requested : (repos[x.id]?.worktrees ?? []).filter(w => !w.main).length >= 2);
  if (s) window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: s.id } }));
  return s && { id: s.id, path: s.path, wts: repos[s.id].worktrees.filter(w => !w.main).map(w => w.path) };
}, requestedRoom);
if (!room) { console.log('No repo room with two worktrees'); process.exit(1); }
console.log('room', room.id, room.wts.length, 'worktrees');
await steps(5); await new Promise(r => setTimeout(r, 6000)); await steps(20);
const rows = () => pg.evaluate(id => window.__shelter.rooms.find(s => s.id === id).userData.taskBoard?.board.shown().map(r => ({ main: r.main, key: r.key, session: r.session, detail: r.detail, pr: r.pr, prs: r.prs, title: r.title })), room.id);
const settle = async () => { for (let i = 0; i < 6; i++) { await steps(6); await new Promise(r => setTimeout(r, 200)); } };

console.log('1) one row for the main copy and one per worktree');
let f = await rows();
check(!!f, 'the room has its task board');
check(f?.[0]?.main && f.length === room.wts.length + 1, `main copy first, then ${room.wts.length} worktrees (${f?.length} rows)`);

console.log('2) states: conversations (waiting, working) and PRs rolled up per task, only this repo\'s');
const [a, c] = room.wts;
await pg.evaluate(([room, a, c]) => {
  const h = window.__live.get().state.dwellers.find(x => x.roomId === room.id);
  const sess = (id, cwd, extra) => ({ id, dwellerId: h.id, roomId: room.id, cwd, state: 'working', unread: false, title: 'QA ' + id, pending: 0, helpers: [], tools: 3, turns: 1, created: Date.now(), updated: Date.now(), ...extra });
  window.__live.set(e => ({ sessions: { ...e.sessions,
    qa_a: sess('qa_a', a, { state: 'waiting', pending: { id: 'p1', type: 'permission', tool: 'Bash', title: 'permiso: git push', canAlways: false } }),
    qa_c: sess('qa_c', c + '/src', { activity: { tool: 'Edit', text: 'editando src/checkout.ts', mode: 'write' } }),
    qa_m: sess('qa_m', room.path, { state: 'idle' }) } }));
  const branch = r => window.__live.get().repos[room.id].worktrees.find(w => w.path === r).branch;
  const repo = 'org/' + room.path.split('/').pop();
  const pr = (n, branch, extra) => ({ number: n, title: 'QA PR ' + n, url: 'https://github.com/' + repo + '/pull/' + n, repo, branch, state: 'open', updated: Date.now(), ...extra });
  window.__board.set({ prs: [pr(1, branch(a), { review: 'APPROVED' }), pr(2, branch(a), { review: 'REVIEW_REQUIRED' }), pr(3, branch(c), { state: 'draft' }),
    { ...pr(9, branch(a), { checks: 'FAILURE' }), repo: 'org/otro-repo', url: 'https://github.com/org/otro-repo/pull/9' }] });
}, [room, a, c]);
await settle();
f = await rows();
console.log('   ', JSON.stringify(f));
const fa = f.find(r => r.main === false && r.session === 'waiting'), fc = f.find(r => r.session === 'working');
check(fa?.detail === 'permiso: git push', 'the waiting copy says what it waits on');
check(fa?.pr === 'review' && fa?.prs === 2, 'its two PRs in this repo roll up to «in review» (the failing one in another repo doesn\'t count)');
check(fc?.detail === 'editando src/checkout.ts' && fc?.pr === 'draft', 'the working copy says what it does, with its draft PR');
check(f[0].session === 'open', 'the main copy has its open conversation');
await pg.evaluate(() => { const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden'; });
await pg.screenshot({ path: output }); console.log('->', output);
await pg.evaluate(() => { const ui = document.getElementById('ui'); if (ui) ui.style.visibility = ''; });

console.log('3) a new worktree shows up live; gone, its row goes');
const wtPath = room.path + '/.claude/worktrees/shelter-QA-77';
await pg.evaluate(([id, path]) => window.__live.set(e => ({ repos: { ...e.repos, [id]: { ...e.repos[id], worktrees: [...e.repos[id].worktrees, { path, branch: 'worktree-shelter-QA-77', main: false, changes: 2, advanced: 1 }] } } })), [room.id, wtPath]);
await settle();
f = await rows();
check(f.some(r => r.key === 'QA-77'), 'the new worktree has its row');
await pg.evaluate(([id, path]) => window.__live.set(e => ({ repos: { ...e.repos, [id]: { ...e.repos[id], worktrees: e.repos[id].worktrees.filter(w => w.path !== path) } } })), [room.id, wtPath]);
await settle();
check(!(await rows()).some(r => r.key === 'QA-77'), 'removed, its row goes');

console.log('4) a click on a row talks to that copy; on the main copy\'s, to the room\'s dweller');
// the screen point of the centre of row k (the board's mesh, uv → its plane)
const pointOf = k => pg.evaluate(([id, k]) => {
  const s = window.__shelter.rooms.find(x => x.id === id); const { mesh, board } = s.userData.taskBoard;
  const THREE = window.__THREE; const H = board.c.height; const row = board.rows[k]; const v = 1 - (row.y0 + row.y1) / 2 / H;
  const g = mesh.geometry.parameters; const p = new THREE.Vector3((0.3 - 0.5) * g.width, (v - 0.5) * g.height, 0.01).applyMatrix4(mesh.matrixWorld);
  p.project(window.__engine.camera); const r = window.__engine.renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}, [room.id, k]);
const ready = await pg.evaluate(path => !!window.__shelter.holograms.ofId('holo:' + path)?.ready, a);
check(ready, 'the copy\'s hologram is in the room');
let pt = await pointOf(f.findIndex(r => r.session === 'waiting'));
await pg.mouse.move(pt.x, pt.y); await steps(3); await pg.mouse.down(); await pg.mouse.up(); await steps(10);
let talking = await pg.evaluate(() => window.__game.get().talkingWith);
check(talking === 'holo:' + a, `clicking the waiting row talks to its copy (${talking})`);
await pg.evaluate(() => window.__game.set({ talkingWith: null })); await steps(10);
pt = await pointOf(0);
await pg.mouse.move(pt.x, pt.y); await steps(3); await pg.mouse.down(); await pg.mouse.up(); await steps(10);
talking = await pg.evaluate(() => window.__game.get().talkingWith);
const owner = await pg.evaluate(id => window.__live.get().state.dwellers.find(h => h.roomId === id)?.id, room.id);
check(talking === owner, `clicking the main copy's row talks to the room's dweller (${talking})`);

// leave the made-up conversations out of the shelter's state
await pg.evaluate(() => window.__live.set(e => { const s = { ...e.sessions }; delete s.qa_a; delete s.qa_c; delete s.qa_m; return { sessions: s }; }));
for (const l of logs) console.log(l);
console.log(failures ? `✗ ${failures} failed` : '✓ all good');
await b.close();
process.exit(failures ? 1 : 0);

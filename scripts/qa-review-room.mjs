// QA of the Review room (shared/reviews.ts, server/reviewRoom.ts, web/src/world/rooms/review.ts, web/src/ui/Review.tsx),
// with a server of its own on a test shelter and Playwright. GitHub isn't connected there, so the board's data is made up
// in the page (the worktrees and their retirement are covered by server/reviewRoom.test.ts):
// - the room exists in a new shelter, on floor 2 next to Communications, with its dweller; without GitHub the board
//   says so;
// - the wall screen shows three columns with each review in its column (a task across two repos is one card);
// - ⌘K «PRs to review (n)» opens the board: three columns, the cards, the buttons; Enter on a card asks the server to
//   open that review (`revision.abrir`, captured), X is only offered once started;
// - a started review's hologram (the server publishes it as the Review room's worktree) stands in the Review room, its
//   tag with the task, title and repos, and none appears in the repo's room.
// Needs the built client (npx vite build). Usage: node scripts/qa-review-room.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3795)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3795);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-review-'));
process.env.SHELTER_DATOS = DATA;   // the page's token (token.mjs)
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@shelter.example', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@shelter.example' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();

// a repo room for one of the PRs (its holograms must not include the review's)
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-review-repos-')));
const repo = path.join(base, 'web');
mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(path.join(repo, 'README'), 'web'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'start');

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);

const pr = (o) => ({ repo: 'acme/web', number: 12, url: `https://github.com/${o.repo ?? 'acme/web'}/pull/${o.number ?? 12}`, title: 'Cart totals with taxes', author: 'ana', draft: false, branch: 'QA-7-cart', head: 'a'.repeat(40), base: 'main', updated: Date.now(), requested: true, reviewed: false, column: 'review', ...o });
const FOLDER = path.join(DATA, 'salas', 'review', 'QA-7');
const board = started => ({ state: 'ok', reviews: [
  { key: 'QA-7', title: 'Cart totals with taxes', column: 'review', updated: 3, started, ...(started ? { folder: FOLDER } : {}), prs: [pr({}), pr({ repo: 'acme/api', number: 40, author: 'bob' })], missing: ['acme/api'] },
  { key: 'QA-9', title: 'Checkout copy', column: 'changes', updated: 2, started: false, prs: [pr({ number: 13, branch: 'QA-9-copy', title: 'Checkout copy', requested: false, verdict: 'CHANGES_REQUESTED', column: 'changes' })] },
  { key: 'acme/web#14', title: 'Bump deps', column: 'approved', updated: 1, started: false, prs: [pr({ number: 14, branch: 'deps', title: 'Bump deps', requested: false, verdict: 'APPROVED', column: 'approved', draft: true })] },
] });

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('recruit', { path: r }); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the room
  const rooms = await pg.evaluate(() => window.__live.get().state.rooms.map(s => ({ id: s.id, type: s.type, floor: s.floor, side: s.side, orden: s.orden })));
  const rev = rooms.find(s => s.id === 'review'), com = rooms.find(s => s.id === 'comunicaciones');
  check(rev?.type === 'review' && rev.floor === com.floor && rev.side === com.side && rev.orden === com.orden + 1, `the Review room stands next to Communications (${JSON.stringify(rev)})`);
  check(await pg.evaluate(() => window.__live.get().state.dwellers.some(h => h.roomId === 'review')), 'it has its dweller');
  check(await until(() => pg.evaluate(() => window.__live.get().reviews.state === 'off')), 'without GitHub the board says it is off');

  // ---- the wall screen
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: 'review' } })));
  await pg.evaluate(bd => window.__live.set({ reviews: bd }), board(false));
  const shown = () => pg.evaluate(() => window.__shelter.rooms.find(s => s.id === 'review')?.userData.reviewScreen?.shown());
  check(await until(async () => (await shown())?.[1]?.length === 3), 'the wall screen paints the reviews');
  const sc = await shown();
  check(JSON.stringify(sc?.[1]?.map(r => [r[0], r[1]])) === JSON.stringify([['QA-7', 'review'], ['QA-9', 'changes'], ['acme/web#14', 'approved']]), `one card per review in its column (${JSON.stringify(sc?.[1]?.map(r => [r[0], r[1]]))})`);
  check(sc?.[1]?.[0]?.[5]?.length === 2, 'a task across two repos is one card with both PRs');

  // ---- the board, from ⌘K
  const opened = [];
  await pg.exposeFunction('__qaOpened', k => opened.push(k));
  await pg.evaluate(() => { const orig = window.__client.action.bind(window.__client); window.__client.action = (n, d) => n === 'review.open' ? (window.__qaOpened(d.key), Promise.resolve('s1')) : orig(n, d); });
  await pg.keyboard.press('Meta+KeyK');
  await pg.waitForSelector('.buscador input');
  await pg.keyboard.type('review');
  check(await until(async () => (await pg.$$eval('.fila-buscador .txt', f => f.map(x => x.textContent))).some(x => /\(1\)/.test(x ?? ''))), '⌘K offers «PRs to review (1)»');
  await pg.$$eval('.fila-buscador', f => f.find(x => /\(1\)/.test(x.querySelector('.txt')?.textContent ?? ''))?.click());
  check(await until(() => pg.$$eval('.kanban-col', c => c.length === 3)), 'the board opens with three columns');
  const cols = await pg.$$eval('.kanban-col', c => c.map(x => x.querySelectorAll('.ficha-issue').length));
  check(JSON.stringify(cols) === '[1,1,1]', `one card in each column (${JSON.stringify(cols)})`);
  check(await pg.$$eval('.kanban-col:first-child .fila-pr-revision', f => f.length === 2), 'the task card lists both PRs');
  check(!(await pg.$$eval('.botonera button', bs => bs.some(x => /Done with this review|Terminar revisión/.test(x.textContent ?? '')))), 'X is not offered before the review starts');
  await pg.screenshot({ path: path.join(dir, 'review-board.png'), animations: 'disabled', timeout: 15000 }).catch(() => console.log('(no board screenshot: timed out)'));
  await pg.keyboard.press('Enter');
  check(await until(async () => opened.includes('QA-7')), 'Enter opens the selected review (revision.abrir QA-7)');
  await pg.evaluate(() => window.__game.set({ panel: null, panelData: null }));

  // ---- the started review's hologram, in the Review room and not in the repo's
  const publish = async () => pg.evaluate(([bd, folder]) => {
    window.__live.set({ reviews: bd });
    window.__live.set(e => ({ repos: { ...e.repos, review: { path: folder.replace(/\/QA-7$/, ''), exists: true, isGit: false, changes: 0, type: 'generico', worktrees: [{ path: folder, branch: '', main: false, changes: 0, advanced: 0, review: { key: 'QA-7', title: 'Cart totals with taxes', repos: ['acme/web', 'acme/api'] } }] } } }));
  }, [board(true), FOLDER]);
  await publish();
  const copy = () => pg.evaluate(f => window.__game.get().copies.find(c => c.id === 'holo:' + f), FOLDER);
  check(await until(async () => { await publish(); return !!(await copy()); }), 'the started review gets its hologram');
  const c = await copy();
  check(c?.room === 'review', `it stands in the Review room (${c?.room})`);
  check(/QA-7/.test(c?.name ?? '') && /web/.test(c?.name ?? '') && /api/.test(c?.name ?? ''), `its tag names the task and its repos (${c?.name})`);
  const webRoom = await pg.evaluate(() => window.__live.get().state.rooms.find(s => s.type === 'repo')?.id);
  check(!(await pg.evaluate(id => window.__game.get().copies.some(x => x.room === id), webRoom)), 'no hologram for it in the repo room');
  // the room itself, opened straight on it (?sala=review), with the screen and the hologram
  await pg.goto(withToken(`http://127.0.0.1:${PORT}/?sala=review`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
  await publish();
  await until(async () => { await publish(); return !!(await copy()); });
  await sleep(6000); await publish();
  await pg.screenshot({ path: path.join(dir, 'review-room.png'), animations: 'disabled', timeout: 15000 }).catch(() => console.log('(no room screenshot: timed out)'));

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.log('FAIL', e.message); failures++;
} finally {
  await b.close();
  server.kill();
  if (failures) console.log(output.split('\n').slice(-30).join('\n'));
  console.log(failures ? `${failures} failures` : 'all OK');
  process.exit(failures ? 1 : 0);
}

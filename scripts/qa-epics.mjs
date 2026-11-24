// QA of the Jira epics, with an own server on a test shelter and Playwright (Jira in DEMO: its tasks carry two epics):
// - the Planning board groups each column by epic, a header with the epic's diamond, key and summary, tasks without one
//   last with no header; each card of an epic has the diamond in the epic's color (its own, saved by the server), with
//   the epic in its tooltip; the others have none;
// - a holographic copy working REF-236 (epic REF-200): its tag has the diamond, the tag of a copy without an epic doesn't;
// - its intercom: the tab has the diamond, and the bar's ⋯ N list beside the task's marker;
// - a sibling copy, REF-231, arriving later: the epic's copies end up side by side in task order.
// Needs the built client (npx vite build). Usage: node scripts/qa-epics.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3797)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3797);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-epicas-'));
process.env.SHELTER_DATOS = DATA;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const repo = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-epicas-repos-'))), 'tienda');
mkdirSync(repo); execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env: ENV });
writeFileSync(path.join(repo, 'README'), 'tienda'); execFileSync('git', ['-C', repo, 'add', '.'], { env: ENV }); execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'inicio'], { env: ENV });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('recruit', { path: r }); await window.__client.action('integration.mode', { source: 'jira', mode: 'demo' }); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the board
  await pg.evaluate(() => window.__game.set({ panel: 'logistics', panelData: { view: 'jira' } }));
  check(await until(async () => (await pg.$$('.card-issue')).length >= 5), 'the Jira board shows the demo tasks');
  const board = await pg.evaluate(() => [...document.querySelectorAll('.kanban-col')].map(c => ({
    col: c.querySelector('h3').firstChild.textContent.trim(),
    rows: [...c.querySelectorAll('.kanban-epica, .card-issue')].map(el => el.classList.contains('kanban-epica')
      ? { header: el.textContent.trim(), color: el.querySelector('.epic-mark') && getComputedStyle(el.querySelector('.epic-mark')).backgroundColor }
      : { key: el.querySelector('.ident').textContent, epic: el.querySelector('.epic-mark')?.title ?? null, color: el.querySelector('.epic-mark') && getComputedStyle(el.querySelector('.epic-mark')).backgroundColor, task: getComputedStyle(el).borderLeftColor }),
  })));
  console.log(JSON.stringify(board, null, 1));
  const review = board.find(c => /revisi|review/i.test(c.col))?.rows ?? [];
  check(review.length === 3 && /REF-200/.test(review[0].header) && review[1].key === 'REF-236' && /REF-200.*Red fiable/.test(review[1].epic) && review[2].key === 'REF-240' && !review[2].epic,
    'In review: header REF-200 with REF-236 (diamond, tooltip), then REF-240 with no header');
  const todo = board.find(c => /hacer|to do/i.test(c.col))?.rows ?? [];
  check(/REF-200/.test(todo[0]?.header ?? '') && todo[1]?.key === 'REF-231' && todo.at(-1)?.key === 'REF-244' && !todo.some(r => r.header && !/REF-\d+/.test(r.header)), 'To do: the epic group first, tasks without one last with no header');
  const withEpic = board.flatMap(c => c.rows).filter(f => f.key && f.epic);
  check(withEpic.length >= 3 && new Set(board.flatMap(c => c.rows).filter(f => f.epic && /REF-200/.test(f.epic)).map(f => f.color)).size === 1, 'every card of an epic has its diamond, in one color per epic');
  const colors = await pg.evaluate(() => window.__client.action('tasks.colors', { keys: ['REF-200', 'REF-210'] }));
  check(colors['REF-200'] && colors['REF-210'] && colors['REF-200'] !== colors['REF-210'], `each epic has its own saved color (${JSON.stringify(colors)})`);
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'epicas-tablero.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => window.__game.set({ panel: null, panelData: null }));

  // ---- a copy working REF-236 and one without an epic, in the recruited room
  const s = await pg.evaluate(r => window.__shelter.rooms.find(x => x.path === r)?.id, repo);
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: id } })), s);
  await pg.waitForTimeout(3000);
  await pg.evaluate(([s, r]) => {
    const h = window.__shelter.dwellers.find(x => x.room.id === s), now = Date.now();
    const one = (id, wt, title) => ({ id, dwellerId: h.id.id, roomId: s, cwd: r + '/.claude/worktrees/' + wt, state: 'working', activity: { mode: 'write', text: 'editing src/app.ts' }, unread: false, title, pending: 0, helpers: [], tools: 0, turns: 1, created: now, updated: now });
    window.__live.set(e => ({ sessions: { ...e.sessions, qa_epic: one('qa_epica', 'shelter-REF-236', 'Persistent sessions'), qa_without: one('qa_sin', 'shelter-REF-244', 'Terminal tools') } }));
  }, [s, repo]);
  const idA = 'holo:' + repo + '/.claude/worktrees/shelter-REF-236';
  check(await until(() => pg.evaluate(id => !!window.__shelter.holograms.ofId(id)?.ready, idA), 30000), 'the copies materialise');
  await pg.waitForTimeout(1500);
  const labels = await pg.evaluate(() => [...document.querySelectorAll('.label.con-tarea')].map(e => ({ name: e.textContent, epic: getComputedStyle(e.querySelector('.epic-mark')).display !== 'none' ? e.querySelector('.epic-mark').title : null })));
  console.log(JSON.stringify(labels));
  check(labels.some(e => /REF-236|Sesiones/.test(e.name) && /REF-200/.test(e.epic ?? '')) && labels.some(e => /REF-244|terminal/i.test(e.name) && !e.epic), 'the REF-236 copy\'s tag has the epic diamond; REF-244\'s has none');
  const box = await pg.evaluate(() => { const e = [...document.querySelectorAll('.label.con-tarea')].find(x => x.querySelector('.epic-mark').style.display !== 'none'); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 140), y: Math.max(0, r.y - 60), width: r.width + 280, height: r.height + 180 }; });
  await pg.screenshot({ path: path.join(dir, 'epicas-holograma.png'), clip: box });
  await pg.screenshot({ path: path.join(dir, 'epicas-sala.png') });

  // ---- late copies: REF-240 (no epic), then a sibling, REF-231 (epic REF-200): the epic's copies end up side by side,
  // REF-231 before REF-236, the others out of their way; the ones that moved walk to their new spot with their
  // projector (past the shelter's first 30 s: before, they are just put there)
  await pg.waitForFunction(() => performance.now() > 32000, null, { timeout: 60000 });
  const add = (id, wt) => pg.evaluate(([s, r, id, wt]) => {
    const h = window.__shelter.dwellers.find(x => x.room.id === s), now = Date.now();
    window.__live.set(e => ({ sessions: { ...e.sessions, [id]: { id, dwellerId: h.id.id, roomId: s, cwd: r + '/.claude/worktrees/' + wt, state: 'working', activity: { mode: 'write', text: 'editing src/app.ts' }, unread: false, title: wt, pending: 0, helpers: [], tools: 0, turns: 1, created: now, updated: now } } }));
  }, [s, repo, id, wt]);
  const row = () => pg.evaluate(s => [...window.__shelter.holograms.figures.values()].filter(f => f.room.id === s).map(f => ({ task: f.task, spot: +f.spot.x.toFixed(2), x: +f.p.root.position.x.toFixed(2), base: +(f.base?.position.x ?? NaN).toFixed(2), ready: f.ready })).sort((a, b) => a.spot - b.spot), s);
  const walked = new Set();
  const settled = n => until(async () => { const r = await row(); for (const f of r) if (f.ready && Math.abs(f.x - f.spot) >= 0.1) walked.add(f.task); return r.length === n && r.every(f => f.ready && Math.abs(f.x - f.spot) < 0.1 && Math.abs(f.base - f.spot) < 0.01); }, 40000);
  await add('qa_loner', 'shelter-REF-240');
  check(await settled(3), 'REF-240 stands on its projector');
  console.log('before the sibling:', JSON.stringify(await row())); walked.clear();
  await add('qa_sibling', 'shelter-REF-231');
  check(await settled(4), 'the four copies stand on their projectors');
  const order = (await row()).map(f => f.task);
  console.log('after:', JSON.stringify(await row()), 'walked:', [...walked].join(', '));
  const i231 = order.indexOf('REF-231'), i236 = order.indexOf('REF-236');
  check(i231 >= 0 && i236 === i231 + 1, `the epic's copies side by side in task order (${order.join(', ')})`);
  await pg.screenshot({ path: path.join(dir, 'epicas-fila.png') });

  // ---- its intercom: tab and ⋯ N list
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { dwellerId: id, talk: true } })), idA);
  check(await until(async () => !!(await pg.$('.vt-tab .epic-mark'))), 'the tab of the REF-236 conversation has the diamond');
  check(/REF-200/.test(await pg.getAttribute('.vt-tab .epic-mark', 'title').catch(() => '')), 'its tooltip names the epic');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'epicas-pestana.png') });
  await pg.click('.vt-todas');
  check(await until(async () => /REF-200/.test(await pg.getAttribute('.vt-list-row .vt-lista-tarea .epic-mark', 'title').catch(() => '') ?? '')), 'the ⋯ N list has the diamond beside the task\'s marker');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'epicas-lista.png') });
  await pg.keyboard.press('Escape');
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(output.slice(-1500)); }
finally { await b.close(); server.kill('SIGKILL'); }
console.log(failures ? `${failures} failures` : 'all good');
process.exit(failures ? 1 : 0);

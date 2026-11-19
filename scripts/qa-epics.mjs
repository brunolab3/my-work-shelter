// QA of the Jira epics, with an own server on a test shelter and Playwright (Jira in DEMO: its tasks carry two epics):
// - the Planning board groups each column by epic, a header with the epic's diamond, key and summary, tasks without one
//   last under «No epic»; each card of an epic has the diamond in the epic's color (its own, saved by the server), with
//   the epic in its tooltip; the others have none;
// - a holographic copy working REF-236 (epic REF-200): its tag has the diamond, the tag of a copy without an epic doesn't;
// - its intercom: the tab has the diamond, and the bar's ⋯ N list beside the task's marker.
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
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('reclutar', { path: r }); await window.__client.action('integracion.modo', { source: 'jira', mode: 'demo' }); await window.__client.action('guardar', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the board
  await pg.evaluate(() => window.__game.set({ panel: 'logistica', panelData: { view: 'jira' } }));
  check(await until(async () => (await pg.$$('.ficha-issue')).length >= 5), 'the Jira board shows the demo tasks');
  const board = await pg.evaluate(() => [...document.querySelectorAll('.kanban-col')].map(c => ({
    col: c.querySelector('h3').firstChild.textContent.trim(),
    rows: [...c.querySelectorAll('.kanban-epica, .ficha-issue')].map(el => el.classList.contains('kanban-epica')
      ? { header: el.textContent.trim(), color: el.querySelector('.marca-epica') && getComputedStyle(el.querySelector('.marca-epica')).backgroundColor }
      : { key: el.querySelector('.ident').textContent, epic: el.querySelector('.marca-epica')?.title ?? null, color: el.querySelector('.marca-epica') && getComputedStyle(el.querySelector('.marca-epica')).backgroundColor, task: getComputedStyle(el).borderLeftColor }),
  })));
  console.log(JSON.stringify(board, null, 1));
  const review = board.find(c => /revisi|review/i.test(c.col))?.rows ?? [];
  check(review.length === 4 && /REF-200/.test(review[0].header) && review[1].key === 'REF-236' && /REF-200.*Red fiable/.test(review[1].epic) && /no epic|sin épica/i.test(review[2].header ?? '') && review[3].key === 'REF-240' && !review[3].epic,
    'In review: header REF-200 with REF-236 (diamond, tooltip), then «No epic»');
  const todo = board.find(c => /hacer|to do/i.test(c.col))?.rows ?? [];
  check(/REF-200/.test(todo[0]?.header ?? '') && todo[1]?.key === 'REF-231' && /no epic|sin épica/i.test(todo[2]?.header ?? '') && todo[3]?.key === 'REF-244', 'To do: the epic group first, tasks without one last');
  const withEpic = board.flatMap(c => c.rows).filter(f => f.key && f.epic);
  check(withEpic.length >= 3 && new Set(board.flatMap(c => c.rows).filter(f => f.epic && /REF-200/.test(f.epic)).map(f => f.color)).size === 1, 'every card of an epic has its diamond, in one color per epic');
  const colors = await pg.evaluate(() => window.__client.action('tareas.colores', { keys: ['REF-200', 'REF-210'] }));
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
    const one = (id, wt, title) => ({ id, dwellerId: h.id.id, roomId: s, cwd: r + '/.claude/worktrees/' + wt, state: 'trabajando', activity: { mode: 'escribir', text: 'editing src/app.ts' }, unread: false, title, pending: 0, helpers: [], tools: 0, turns: 1, created: now, updated: now });
    window.__live.set(e => ({ sessions: { ...e.sessions, qa_epic: one('qa_epica', 'shelter-REF-236', 'Persistent sessions'), qa_without: one('qa_sin', 'shelter-REF-244', 'Terminal tools') } }));
  }, [s, repo]);
  const idA = 'holo:' + repo + '/.claude/worktrees/shelter-REF-236';
  check(await until(() => pg.evaluate(id => !!window.__shelter.holograms.ofId(id)?.ready, idA), 30000), 'the copies materialise');
  await pg.waitForTimeout(1500);
  const labels = await pg.evaluate(() => [...document.querySelectorAll('.etiqueta.con-tarea')].map(e => ({ name: e.textContent, epic: getComputedStyle(e.querySelector('.marca-epica')).display !== 'none' ? e.querySelector('.marca-epica').title : null })));
  console.log(JSON.stringify(labels));
  check(labels.some(e => /REF-236|Sesiones/.test(e.name) && /REF-200/.test(e.epic ?? '')) && labels.some(e => /REF-244|terminal/i.test(e.name) && !e.epic), 'the REF-236 copy\'s tag has the epic diamond; REF-244\'s has none');
  const box = await pg.evaluate(() => { const e = [...document.querySelectorAll('.etiqueta.con-tarea')].find(x => x.querySelector('.marca-epica').style.display !== 'none'); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 140), y: Math.max(0, r.y - 60), width: r.width + 280, height: r.height + 180 }; });
  await pg.screenshot({ path: path.join(dir, 'epicas-holograma.png'), clip: box });
  await pg.screenshot({ path: path.join(dir, 'epicas-sala.png') });

  // ---- its intercom: tab and ⋯ N list
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { dwellerId: id, talk: true } })), idA);
  check(await until(async () => !!(await pg.$('.vt-pestana .marca-epica'))), 'the tab of the REF-236 conversation has the diamond');
  check(/REF-200/.test(await pg.getAttribute('.vt-pestana .marca-epica', 'title').catch(() => '')), 'its tooltip names the epic');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'epicas-pestana.png') });
  await pg.click('.vt-todas');
  check(await until(async () => /REF-200/.test(await pg.getAttribute('.vt-lista-fila .vt-lista-tarea .marca-epica', 'title').catch(() => '') ?? '')), 'the ⋯ N list has the diamond beside the task\'s marker');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'epicas-lista.png') });
  await pg.keyboard.press('Escape');
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(output.slice(-1500)); }
finally { await b.close(); server.kill('SIGKILL'); }
console.log(failures ? `${failures} failures` : 'all good');
process.exit(failures ? 1 : 0);

// QA of the deploy board's compact view (web/src/ui/Deploy.tsx), with its own server in a test shelter and Playwright:
// your PRs (git.prsBoard stubbed, as in qa-preflight) in several columns, two of one task; C switches to one line per PR
// with its ref, a title cut with an ellipsis, CI, the conflicts mark and the ledger counts, the task block and column
// headers kept; more PRs fit; the choice survives closing and reopening the board; C again goes back.
// Needs the built client (npx vite build). Usage: node scripts/qa-deploy-board.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3795)
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
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-deploy-'));
process.env.SHELTER_DATOS = DATA;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const repo = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-deploy-repos-'))), 'logistica');
mkdirSync(repo); execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env: ENV });
writeFileSync(path.join(repo, 'README'), 'x'); execFileSync('git', ['-C', repo, 'add', '.'], { env: ENV }); execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'inicio'], { env: ENV });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('recruit', { path: r }); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };
  const roomOf = () => pg.evaluate(r => window.__live.get().state?.rooms?.find(s => s.path === r)?.id, repo);
  await until(async () => !!(await roomOf()));
  const id = await roomOf();

  await pg.evaluate(() => {
    const c = window.__client, orig = c.action.bind(c);
    const ledger = (unresolved, unansweredSummaries) => ({ unresolved, outdated: 0, unansweredSummaries });
    const pr = (repo, number, branch, x = {}) => ({ number, title: `PR ${number}: ${'a rather long title that will not fit on one line of the column '.repeat(2)}`, url: `https://github.com/${repo}/pull/${number}`, repo, branch, state: 'open', updated: number, base: 'main', ...x });
    const prs = [
      pr('acme/api', 1, 'QA-1-a', { checks: 'SUCCESS', review: 'REVIEW_REQUIRED', conflicts: false }),
      pr('acme/web', 2, 'QA-1-b', { checks: 'FAILURE', review: 'REVIEW_REQUIRED', conflicts: true, ledger: ledger(2, 1) }),
      pr('acme/api', 3, 'QA-2-x', { checks: 'PENDING', review: 'CHANGES_REQUESTED', ledger: ledger(1, 0) }),
      pr('acme/api', 4, 'QA-3-y', { state: 'draft' }),
      pr('acme/api', 5, 'QA-4-z', { state: 'merged' }),
      ...Array.from({ length: 10 }, (_, k) => pr('acme/ops', 10 + k, `QA-${10 + k}-w`, { checks: 'SUCCESS', review: 'REVIEW_REQUIRED' })),
    ];
    c.action = (n, d) => n === 'git.prsBoard' ? Promise.resolve({ prs }) : n === 'deploy.blockers' || n === 'deploy.order' ? Promise.resolve([]) : orig(n, d);
  });
  const open = () => pg.evaluate(r => window.__game.set({ panel: 'room', panelData: { roomId: r, view: 'deployment' } }), id);
  const close = () => pg.evaluate(() => window.__game.set({ panel: null, panelData: null }));
  await open();
  check(await until(async () => (await pg.$$('.card-pr')).length === 15), 'the board shows the 15 PRs');
  check((await pg.$$('.card-pr-compact')).length === 0, 'normal view by default');
  const height = () => pg.$$eval('.kanban-col', l => Math.max(...l.map(e => e.scrollHeight)));
  const h0 = await height();
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'deploy-normal.png'), animations: 'disabled' });

  await pg.keyboard.press('KeyC');
  check(await until(async () => (await pg.$$('.card-pr-compact')).length === 15), 'C: every PR in compact view');
  const rows = await pg.$$eval('.card-pr-compact', l => l.map(e => ({ h: e.getBoundingClientRect().height, text: e.textContent, cut: e.querySelector('.compact-title').scrollWidth > e.querySelector('.compact-title').clientWidth })));
  check(rows.every(r => r.h < 30), `one line each (heights ${[...new Set(rows.map(r => Math.round(r.h)))].join(', ')} px)`);
  check(rows.every(r => r.cut), 'the long titles cut with an ellipsis');
  const two = rows.find(r => r.text.includes('web#2'));
  check(/CI ✗/.test(two?.text) && /⚠/.test(two?.text) && /💬 2/.test(two?.text) && /✉ 1/.test(two?.text) && /PR 2/.test(two?.text), `web#2 has red CI, conflicts and the ledger (${two?.text})`);
  check(/CI ✓/.test(rows.find(r => r.text.includes('api#1'))?.text) && /CI …/.test(rows.find(r => r.text.includes('api#3'))?.text), 'green and pending CI');
  check(!/CI/.test(rows.find(r => r.text.includes('api#5'))?.text), 'no CI on a merged PR');
  check(await pg.$$eval('.task-block.several .task-block-header', l => l.some(e => /QA-1/.test(e.textContent))), 'the QA-1 task block keeps its header');
  check((await pg.$$('.kanban-col h3')).length >= 4, 'the column headers stay');
  const h1 = await height();
  check(h1 < h0 * 0.3, `more PRs fit (height ${h0} → ${h1} px)`);
  check(await pg.evaluate(() => document.body.textContent.includes('normal view') || document.body.textContent.includes('vista normal')), 'the legend offers going back');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'deploy-compact.png'), animations: 'disabled' });

  await close(); await pg.waitForTimeout(300); await open();
  check(await until(async () => (await pg.$$('.card-pr-compact')).length === 15), 'reopened, the board remembers the compact view');
  await pg.keyboard.press('KeyC');
  check(await until(async () => (await pg.$$('.card-pr-compact')).length === 0 && (await pg.$$('.card-pr')).length === 15), 'C again: back to the normal view');
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (e) { console.log('FAIL ' + e.message); failures++; console.log(output.slice(-2000)); }
finally { await b.close(); server.kill(); }
console.log(failures ? `${failures} failures` : 'all OK');
process.exit(failures ? 1 : 0);

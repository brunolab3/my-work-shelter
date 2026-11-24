// QA del pre-flight de una tarea (web/src/ui/Preflight.tsx), con un servidor propio en un refugio de pruebas y Playwright:
// - a test repo with the worktree of task QA-7 (one uncommitted file), admitted as a room: the real `preflight.tarea`
//   action (no GitHub) gives its part without a PR, with «1 uncommitted» ⚠; the push gate (preflight.puerta) says what
//   is missing (compare and the 0/2 checklist); ⌘K «qa-7» offers no pre-flight while the task has no PR; once your PRs
//   (the board's, `git.prsTablero`) name it, ⌘K offers «Pre-flight QA-7» and opens the box: no table (the real action
//   has no GitHub), it names the room; Esc closes it;
// - a task in two repos (example response), opened with ⌘K over an open panel: a small floating box (not a panel), the
//   panel underneath still open and untouched; one row per PR in merge order, merged ✔ and struck through, red CI ✗,
//   conflicts ✗, the one that waits ⚠; no compare/sync/checklist columns or thread list; the plan part without a PR is
//   named below; the merge order strikes the merged PR; long PR titles truncate with a tooltip; Enter and a click open
//   the PR; a click outside closes the box and nothing else;
// - the Jira board: no F nor button on a task without PRs; on QA-9, F in the legend and a button, both opening the box
//   anchored to its card, the board still open underneath; Esc closes only the box;
// - a task fully merged (example response): its rows struck through, every wave ✔ and «the task has landed»; its
//   production verification below: a row per checkpoint with its state, a signal's where, baseline and evidence in its
//   tooltip, the tracker's status; approving the plan and moving the task to done, each through its action.
// Necesita el cliente compilado (npx vite build). Uso: node scripts/qa-preflight.mjs [carpeta-capturas]   (SHELTER_PUERTO_QA, 3794)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3794);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-preflight-'));
process.env.SHELTER_DATOS = DATA;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();

// el repo de pruebas y el worktree de la tarea
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-preflight-repos-')));
const repo = path.join(base, 'tienda');
mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(path.join(repo, 'README'), 'tienda'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'inicio');
const wt = path.join(base, 'tienda-qa-7');
sh(repo, 'worktree', 'add', '-q', '-b', 'QA-7-carrito', wt);
writeFileSync(path.join(wt, 'carrito.txt'), 'a medias');

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
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

  // ---- la acción de verdad: la parte del worktree, sin PR
  let real = null;
  await until(async () => { real = await pg.evaluate(() => window.__client.action('preflight.task', { key: 'qa-7' }).catch(e => ({ error: e.message }))); return real?.parts?.length > 0; });
  const p = real?.parts?.[0];
  check(real?.key === 'QA-7' && real.parts.length === 1, `preflight.tarea da la tarea con una parte (${JSON.stringify(real?.parts?.map(x => x.branch) ?? real)})`);
  check(p?.worktree === wt && p?.branch === 'QA-7-carrito' && !p?.pr, 'la parte es el worktree de la tarea, sin PR');
  check(p?.sync?.mark === 'warning' && /1/.test(p?.sync?.text ?? ''), `sincronía ⚠ por el archivo sin commitear (${p?.sync?.text})`);
  check(await pg.evaluate(() => window.__client.action('preflight.task', { key: 'rm -rf' }).then(() => false, () => true)), 'una clave que no lo es, rechazada');

  // ---- fase 3: la lista y la puerta
  await pg.evaluate(() => window.__client.action('save', { patch: { checklistPreflight: ['Compare revisado', 'Pruebas con datos reales'] } }));
  check(JSON.stringify(await pg.evaluate(() => window.__client.action('preflight.checklist'))) === '["Compare revisado","Pruebas con datos reales"]', 'la lista guardada vuelve tal cual');
  const puerta = await pg.evaluate(w => window.__client.action('preflight.gate', { path: w }), wt);
  check(puerta?.key === 'QA-7' && puerta.missing.length === 2, `la puerta de push dice lo que falta (${puerta?.missing?.join(' | ')})`);
  check(await pg.evaluate(() => window.__client.action('preflight.gate', { path: '/etc' }).then(() => false, () => true)), 'la puerta no mira carpetas que no son del refugio');

  // ---- the box with the real task, from ⌘K: only offered once the task has a PR
  const offered = async key => (await pg.$$eval('.fila-buscador .txt', f => f.map(x => x.textContent))).includes('Pre-flight ' + key);
  const preflightK = async key => {
    await pg.keyboard.press('Meta+KeyK');
    await pg.waitForSelector('.buscador input');
    await pg.keyboard.type(key.toLowerCase());
    const ok = await until(() => offered(key));
    if (key === 'QA-7') await pg.screenshot({ path: path.join(dir, 'preflight-buscador.png'), animations: 'disabled', timeout: 10000 }).catch(() => console.log('(no ⌘K screenshot: timed out)'));
    await pg.keyboard.press('Enter');
    return ok;
  };
  await pg.keyboard.press('Meta+KeyK');
  await pg.waitForSelector('.buscador input');
  await pg.keyboard.type('qa-7');
  await pg.waitForTimeout(800);
  check(!(await offered('QA-7')), '⌘K offers no pre-flight for a task without PRs');
  await pg.keyboard.press('Escape');
  // your PRs (the board's list) from here on: one for QA-7 and those of the example tasks QA-9 and QA-11
  await pg.evaluate(() => {
    const c = window.__client, orig = c.action.bind(c);
    const pr = (repo, number, branch, state = 'open') => ({ number, title: 'PR ' + number, url: `https://github.com/${repo}/pull/${number}`, repo, branch, state, updated: 0, base: 'main' });
    const prs = [pr('acme/tienda', 7, 'QA-7-algo'), pr('acme/api', 1, 'QA-9-parte-1'), pr('acme/api', 5, 'QA-11-a', 'merged')];
    c.action = (n, d) => n === 'git.prsBoard' ? Promise.resolve({ prs }) : orig(n, d);
    window.__board.set({ prs });
  });
  check(await preflightK('QA-7'), '⌘K offers «Pre-flight QA-7» once a PR names it');
  check(await until(async () => /QA-7/.test(await pg.textContent('.pf-box').catch(() => '')) && !(await pg.isVisible('.pf-tabla')) && /tienda/.test(await pg.textContent('.pf-box'))), 'Enter opens the box: the real action has no GitHub, so no table, and the room working on it is named');
  check((await pg.evaluate(() => window.__game.get().panel)) === null, 'it is not a panel');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-real.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  check(await until(async () => !(await pg.$('.pf-box'))), 'Esc closes it');

  // ---- una tarea en dos repos (respuesta de ejemplo, el modelo de shared/preflight.ts)
  await pg.evaluate(() => {
    const c = window.__client, orig = c.action.bind(c);
    const pr = (repo, number, extra) => ({ number, title: 'PR de ejemplo ' + number, url: `https://github.com/${repo}/pull/${number}`, repo, branch: 'QA-9-parte-' + number, state: 'open', updated: 0, base: 'main', review: 'REVIEW_REQUIRED', checks: 'SUCCESS', head: 'c' + number, ...extra });
    const api = pr('acme/api', 1, { checks: 'FAILURE' }), web = pr('acme/web', 2, { review: 'APPROVED' }), other = pr('acme/web', 3, { review: 'APPROVED', conflicts: true }), done = pr('acme/api', 4, { state: 'merged' });
    const cell = (mark, text) => ({ mark, text });
    const threads = [{ file: 'src/carrito.ts', line: 42, author: 'revisora', text: '¿Qué pasa si el cupón ha caducado?', url: api.url + '#discussion_r1', outdated: false }, { file: 'src/cupon.ts', line: 7, author: 'bot-revisor', text: 'Falta una prueba', url: api.url + '#discussion_r2', outdated: true }];
    const answer = {
      key: 'QA-9', color: '#4dabff', title: 'Carrito con cupones',
      parts: [
        { id: api.url, roomId: 'api', room: 'api', repo: api.repo, branch: api.branch, pr: api, worktree: '/r/api', plan: 'Contrato', sync: cell('warning', 'faltan commits remotos (¿un bot?)'), ci: cell('bad', 'roja'), review: cell('warning', 'esperando revisión · 💬 2 sin resolver'), conflicts: cell('ok', 'fusionable'), blockers: cell('ok', 'bloquea a web#2'), checklist: cell('warning', '1/2 en def5678'), compare: cell('warning', 'es de abc1234; HEAD def5678'), compareFile: '/tmp/no.html', threads, repoItems: ['npm run lint'], ciChecks: [{ name: 'build', state: 'bad' }], waitsOn: [], blocks: [{ ref: web.url, url: web.url, state: 'open', reason: 'plan' }] },
        { id: web.url, roomId: 'web', room: 'web', repo: web.repo, branch: web.branch, pr: web, worktree: '/r/web', sync: cell('ok', 'al día'), ci: cell('ok', 'green'), review: cell('ok', 'approved'), conflicts: cell('ok', 'fusionable'), blockers: cell('warning', 'espera a api#1 (abierto · su CI en rojo)'), checklist: cell('ok', '2/2 en c2c2c2c'), compare: cell('ok', 'validada en c2c2c2c'), threads: [], repoItems: [], ciChecks: [], waitsOn: [{ ref: 'acme/api#1', url: api.url, state: 'open', checks: 'FAILURE', reason: 'plan' }], blocks: [] },
        { id: other.url, roomId: 'web', room: 'web', repo: other.repo, branch: other.branch, pr: other, sync: cell('ok', 'al día'), ci: cell('ok', 'green'), review: cell('ok', 'approved'), conflicts: cell('bad', 'con conflictos'), blockers: cell('none', 'sin bloqueos'), checklist: cell('none', '—'), compare: cell('none', '—'), threads: [], repoItems: [], ciChecks: [], waitsOn: [], blocks: [] },
        { id: done.url, roomId: 'api', room: 'api', repo: done.repo, branch: done.branch, pr: done, sync: cell('none', '—'), ci: cell('none', '—'), review: cell('ok', 'merged'), conflicts: cell('none', '—'), blockers: cell('none', 'sin bloqueos'), checklist: cell('none', '—'), compare: cell('none', '—'), threads: [], repoItems: [], ciChecks: [], waitsOn: [], blocks: [] },
        { id: 'plan:docs', roomId: 'docs', room: 'docs', plan: 'La guía', notStarted: true, sync: cell('none', '—'), ci: cell('none', '—'), review: cell('none', '—'), conflicts: cell('none', '—'), blockers: cell('none', '—'), checklist: cell('none', '—'), compare: cell('none', '—'), threads: [], repoItems: [], ciChecks: [], waitsOn: [], blocks: [] },
      ],
      waves: [['acme/api#4', 'acme/api#1', 'acme/web#3'], ['acme/web#2']], cycle: [], checklist: ['Compare revisado', 'Pruebas con datos reales'],
    };
    // QA-11: everything merged, in two waves
    const m1 = pr('acme/api', 5, { state: 'merged', branch: 'QA-11-a' }), m2 = pr('acme/web', 6, { state: 'merged', branch: 'QA-11-b' });
    const merged = (x, wait) => ({ id: x.url, roomId: x.repo.split('/')[1], room: x.repo.split('/')[1], repo: x.repo, branch: x.branch, pr: x, sync: cell('none', '—'), ci: cell('none', '—'), review: cell('ok', 'merged'), conflicts: cell('none', '—'), blockers: cell(wait ? 'ok' : 'none', wait ? 'lo que esperaba ya está fusionado' : 'sin bloqueos'), checklist: cell('none', '—'), compare: cell('none', '—'), threads: [], repoItems: [], ciChecks: [], waitsOn: wait ? [{ ref: 'acme/api#5', url: m1.url, state: 'merged', reason: 'plan' }] : [], blocks: [] });
    // its production verification (shared/verification.ts): the PR's checkpoint evidenced, the final one waiting for traffic
    const signal = (id, type, what, state, evidence) => ({ id, type, what, where: 'logs of api: «' + id + '»', base: '20 a week', state, ...(evidence ? { evidence: { text: evidence, ts: 1 } } : {}) });
    const verification = { key: 'QA-11', version: 2, updated: 1, points: [
      { id: 'pr-5', type: 'pr', pr: 'acme/api#5', title: 'acme/api#5', services: ['api'], live: { api: 1 }, deadlineHours: 24, state: 'evidenced', open: 1, since: 1, signals: [signal('gone', 'must-disappear', 'the timeout is gone', 'evidenced', '0 since the deploy')] },
      { id: 'final', type: 'final', title: 'Checkout no longer times out', services: [], live: { final: 1 }, deadlineHours: 24, state: 'waiting-traffic', open: 1, since: Date.now(), signals: [signal('ran', 'must-run', 'readiness runs on the new version', 'pending')] },
    ] };
    const tracker = { source: 'jira', state: 'Prod check', board: 'QA', test: 'Prod check', done: 'Done', inProdCheck: true, move: true };
    const landed = { key: 'QA-11', color: '#b48cff', title: 'Ya fusionada', parts: [merged(m1), merged(m2, true)], waves: [['acme/api#5'], ['acme/web#6']], cycle: [], checklist: [], verification, tracker };
    window.__qaVerif = [];
    c.action = (n, d) => n === 'preflight.task' && String(d?.key).toUpperCase() === 'QA-9' ? Promise.resolve(answer) : n === 'preflight.task' && String(d?.key).toUpperCase() === 'QA-11' ? Promise.resolve(landed)
      : n === 'verification.approve' ? (window.__qaVerif.push(n), Promise.resolve({ ...verification, approved: { version: 2, ts: 2 } }))
      : n === 'verification.close' ? (window.__qaVerif.push(n), Promise.resolve({ key: 'QA-11', state: 'Done', category: 'done' })) : orig(n, d);
    window.__game.set({ panel: 'help', panelData: null });
  });
  await pg.waitForSelector('.device');
  // its layout box (offsets ignore the opening animation's transform)
  const box = e => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(',');
  const panelBefore = await pg.$eval('.device', box);
  await preflightK('QA-9');
  check(await until(async () => (await pg.$$('.pf-row')).length === 4), 'four rows: one per PR, none for the plan part without a PR');
  const size = await pg.$eval('.pf-box', e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  check(size.w < 1600 * 0.6 && size.h < 1000 * 0.75, `a small box (${JSON.stringify(size)})`);
  check((await pg.evaluate(() => window.__game.get().panel)) === 'help' && await pg.$eval('.device', box) === panelBefore, 'the panel underneath stays open, same place and size');
  check(await pg.$eval('.pf-row.pf-hecha .pf-parte', e => getComputedStyle(e).textDecorationLine.includes('line-through')), 'the merged PR is struck through');
  check(await pg.$eval('.pf-row .pf-parte', e => e.title.includes('PR de ejemplo') && getComputedStyle(e).textOverflow === 'ellipsis'), 'the PR title truncates, with the full title in its tooltip');
  const headers = await pg.$$eval('.pf-tabla th', th => th.map(x => x.textContent).join('|'));
  check(!/Compare|Checklist|Sincron|Sync/.test(headers) && /Conflict/.test(headers), `no push columns, a conflicts column (${headers})`);
  const states = await pg.$$eval('.pf-state', e => e.map(x => x.textContent));
  check(states.join(' ') === '✔ ✗ ✗ ⚠', `merged ✔, red CI ✗, conflicts ✗, the one that waits ⚠ (not ✗), in merge order (${states.join(' ')})`);
  check(!(await pg.$$('.pf-hilo')).length && !/carrito\.ts/.test(await pg.textContent('.pf-tabla')), 'no review threads listed, only their count');
  check(/docs/.test(await pg.textContent('.pf-box')), 'the plan part without a PR is named below');
  check(/1.*api#4.*api#1.*web#3.*2.*web#2/.test(await pg.textContent('.orden-despliegue')) && await pg.$eval('.orden-despliegue .pf-hecha', e => /api#4/.test(e.textContent)), 'merge order, with the merged PR struck through');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-dos-repos.png'), animations: 'disabled' });
  // outside Electron the GitHub window is a new tab (window.open): what matters is which URL it opens
  await pg.evaluate(() => { window.__open = ''; window.open = u => { window.__open = String(u); return null; }; });
  await pg.click('.pf-row:nth-child(2) .pf-parte');
  check(await until(async () => (await pg.evaluate(() => window.__open)) === 'https://github.com/acme/api/pull/1'), 'clicking a row opens its PR');
  await pg.evaluate(() => { window.__open = ''; });
  await pg.click('.pf-row:nth-child(4) td:last-child .pf-boton');
  check(await until(async () => (await pg.evaluate(() => window.__open)) === 'https://github.com/acme/api/pull/1'), 'clicking the blockers of web#2 opens api#1, the PR it waits for');
  await pg.evaluate(() => { window.__open = ''; });
  await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter');
  check(await until(async () => (await pg.evaluate(() => window.__open)) !== ''), 'Enter opens the selected PR');
  await pg.mouse.click(1590, 990);
  check(await until(async () => !(await pg.$('.pf-box'))), 'a click outside closes the box');
  check((await pg.evaluate(() => window.__game.get().panel)) === 'help' && await pg.$eval('.device', box) === panelBefore, '…and leaves the panel as it was');

  // ---- from the Jira board: F and a button, only on a task with PRs, anchored to its card
  await pg.evaluate(() => {
    const c = window.__client, orig = c.action.bind(c);
    const task = (key, category, state) => ({ key, title: 'Tarea ' + key, url: 'https://jira.example/browse/' + key, state, category, updated: Date.now() });
    const tareas = [task('QA-5', 'new', 'To Do'), task('QA-9', 'indeterminate', 'In Progress')];
    c.action = (n, d) => n === 'integration.panel' && d?.source === 'jira' ? Promise.resolve({ tareas }) : orig(n, d);
    window.__game.set({ panel: 'logistics', panelData: { view: 'jira' } });
  });
  const legend = () => pg.textContent('.device kbd:last-of-type >> xpath=..').catch(() => '');
  check(await until(async () => (await pg.$$('.card-issue')).length === 2 && /QA-5/.test(await pg.textContent('.card-issue.sel').catch(() => ''))), 'the Jira board shows both tasks, QA-5 (no PR) selected');
  check(!/Pre-flight/.test(await legend()) && !(await pg.$('.botonera button:has-text("Pre-flight")')), 'a task without PRs: no F in the legend, no button');
  await pg.keyboard.press('KeyF'); await pg.waitForTimeout(400);
  check(!(await pg.$('.pf-box')), '…and F does nothing');
  await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight');   // past the empty Blocked column
  check(await until(async () => /QA-9/.test(await pg.textContent('.card-issue.sel').catch(() => '')) && /Pre-flight/.test(await legend()) && !!(await pg.$('.botonera button:text-matches("Pre-flight.*QA-9")'))), 'QA-9 (with a PR): F in the legend and a «Pre-flight QA-9» button');
  await pg.keyboard.press('KeyF');
  check(await until(async () => (await pg.$$('.pf-row')).length === 4), 'F opens the pre-flight of QA-9');
  const near = await pg.evaluate(() => { const a = document.querySelector('.card-issue.sel').getBoundingClientRect(), b = document.querySelector('.pf-box').getBoundingClientRect(); return Math.min(Math.abs(b.top - a.bottom), Math.abs(b.bottom - a.top), Math.abs(b.left - a.right), Math.abs(b.right - a.left)) < 40; });
  check(near, 'the box is anchored to the selected card');
  check((await pg.evaluate(() => window.__game.get().panel)) === 'logistics', 'the board stays open underneath');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-jira.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  check(await until(async () => !(await pg.$('.pf-box'))) && (await pg.evaluate(() => window.__game.get().panel)) === 'logistics', 'Esc closes the box, the board stays');
  await pg.click('.botonera button:text-matches("Pre-flight.*QA-9")');
  check(await until(async () => (await pg.$$('.pf-row')).length === 4), 'the button opens it too');
  await pg.keyboard.press('Escape');
  await until(async () => !(await pg.$('.pf-box')));
  await pg.evaluate(() => window.__game.set({ panel: null, panelData: null }));

  // ---- a task fully merged
  await preflightK('QA-11');
  check(await until(async () => (await pg.$$('.pf-row.pf-hecha')).length === 2), 'fully merged: both rows struck through');
  check(await until(async () => (await pg.$$('.orden-despliegue .pf-ola-hecha')).length === 2 && /✔/.test(await pg.textContent('.pf-aterrizada').catch(() => ''))), 'every wave ✔ and «the task has landed»');
  // production verification: the plan unapproved (v2), its checkpoints' states, the signals' where and evidence in their tooltips
  check(await until(async () => (await pg.$$('.pf-verificacion .pf-point')).length === 2), 'the verification plan: one row per checkpoint');
  const verif = await pg.textContent('.pf-verificacion');
  check(/v2/.test(verif) && /(evidenced|comprobado)/.test(verif) && /(waiting for traffic|esperando tráfico)/.test(verif), 'not approved v2, the PR evidenced, the final waiting for traffic');
  check(await pg.$eval('.pf-point li', e => e.title.includes('«gone»') && e.title.includes('20 a week') && e.title.includes('0 since the deploy')), 'a signal\'s where, baseline and evidence in its tooltip');
  check(/Prod check/.test(verif), 'the tracker\'s status and its board\'s prod-check one');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-verificacion.png'), animations: 'disabled' });
  await pg.click('.pf-verificacion button:text-matches("Approve|Aprobar")');
  check(await until(async () => /(approved|aprobado) \(v2\)/.test(await pg.textContent('.pf-verificacion'))), 'approving it: approved (v2), the button gone');
  await pg.click('.pf-verificacion button:text-matches("Done")');
  check(await until(async () => /: Done/.test(await pg.textContent('.pf-verificacion')) && !(await pg.$('.pf-verificacion button'))), 'moving it to done: the tracker says Done');
  check(JSON.stringify(await pg.evaluate(() => window.__qaVerif)) === '["verificacion.aprobar","verificacion.cerrar"]', 'each through its action');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-aterrizada.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(output.slice(-1500)); }
finally { await b.close(); server.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

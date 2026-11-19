// QA of the intercom's «Actions» section (Dialog.tsx) on a hologram with pages + PRs + pre-flight + scheduled at once,
// with its own server in a test shelter and Playwright: the four buttons in order of importance right under the
// dweller's data; each list opens right below its button in a normal and a maximized intercom, and to its right over the
// conversation in a short window; never outside the intercom. Screenshots of each.
// Needs the built client (npx vite build). Usage: node scripts/qa-intercom-actions.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3797)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
import { withToken } from './token.mjs';
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3797);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-acciones-')); process.env.SHELTER_DATOS = DATA;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@x.example', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@x.example' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-acciones-repos-')));
const repo = path.join(base, 'tienda'); mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(path.join(repo, 'README'), 'tienda'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'inicio');
const wt = path.join(repo, '.claude/worktrees/shelter-qa-7'); sh(repo, 'worktree', 'add', '-q', '-b', 'QA-7-carrito', wt);
const pages = [1, 2, 3, 4, 5, 6].map(i => { const f = path.join(base, `plan-${i}.html`); writeFileSync(f, `<h1>Plan ${i}</h1>`); return f; });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: 'ignore' });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  pg.on('pageerror', e => check(false, 'page error: ' + e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('reclutar', { path: r }); await window.__client.action('guardar', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  await pg.waitForFunction(w => window.__game.get().copies.some(c => c.copy?.path === w), wt, { timeout: 30000 });
  const holo = await pg.evaluate(w => window.__game.get().copies.find(c => c.copy?.path === w), wt);
  console.log('copia', holo.id, holo.room);
  await pg.evaluate(([holo, wt, pages]) => {
    const now = Date.now();
    const c = window.__client, orig = c.action.bind(c);
    const pr = (number, branch, state = 'abierto') => ({ number, title: 'Carrito: parte ' + number, url: `https://github.com/acme/tienda/pull/${number}`, repo: 'acme/tienda', branch, state, updated: 0, base: 'main' });
    const prs = [pr(7, 'QA-7-carrito'), pr(8, 'QA-7-carrito-2', 'borrador'), pr(6, 'QA-7-base', 'fusionado')];
    c.action = (n, d) => n === 'git.prsTablero' ? Promise.resolve({ prs }) : orig(n, d);
    window.__board.set({ prs });
    const sess = { id: 'qa_s', claudeId: 'qa_c', dwellerId: holo.copy.authorId, roomId: holo.room, cwd: wt, state: 'terminada', activity: null, unread: false, title: 'QA carrito', pending: 0, helpers: [], tools: 0, turns: 1, created: now, updated: now, model: 'claude-opus-5-5' };
    const entries = pages.map((p, i) => ({ id: 'e' + i, ts: now - i * 1000, type: 'asistente', text: `Plan: [plan ${i + 1}](${p})` }));
    const prog = (id, h, m) => ({ id, created: now, when: now + h * 3600e3, requested: '', message: m, origin: { roomId: holo.room, sessionId: 'qa_s', claudeId: 'qa_c' }, target: { type: 'conversacion', roomId: holo.room, sessionId: 'qa_s', claudeId: 'qa_c', cwd: wt, title: 'QA carrito' } });
    window.__live.set(e => ({ sessions: { ...e.sessions, qa_s: sess }, entries: { ...e.entries, qa_s: entries }, scheduled: [prog('p1', 20, 'Revisar el carrito el lunes'), prog('p2', 50, 'Mirar CI')] }));
    window.__game.set({ talkingWith: holo.id });
  }, [holo, wt, pages]);
  await pg.waitForSelector('.consola-acciones', { timeout: 15000 });
  await sleep(2500);
  const side = async n => { const r = await pg.$eval('.consola', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); await pg.screenshot({ path: `${dir}/${n}.png`, clip: r }); console.log('->', `${dir}/${n}.png`); };
  const buttons = await pg.$$eval('.consola-acciones .consola-x', l => l.map(x => x.textContent));
  check(/📄/.test(buttons[0]) && /⑂/.test(buttons[1]) && /✈/.test(buttons[2]) && /⏰/.test(buttons[3]) && buttons.length === 4, 'pages, PRs, pre-flight and scheduled, in that order: ' + buttons.join(' | '));
  check(await pg.$eval('.consola-acciones', a => a.getBoundingClientRect().top - [...a.parentElement.children].at(-2).getBoundingClientRect().bottom < 30), 'the section sits right under the dweller\'s data');
  // where the open list is: 'debajo' (right below its button) or 'derecha' (to its right), and inside the intercom
  const spot = () => pg.$eval('.paginas-lista', u => {
    const b = u.parentElement.getBoundingClientRect(), l = u.getBoundingClientRect(), z = u.closest('.consola-cuerpo').getBoundingClientRect();
    const inside = l.top >= z.top - 1 && l.bottom <= z.bottom + 1;
    return Math.abs(l.top - b.bottom) < 3 && Math.abs(l.left - b.left) < 3 ? (inside ? 'debajo' : 'fuera') : l.left >= b.right && l.top <= b.bottom && l.bottom >= b.top ? (inside ? 'derecha' : 'fuera') : 'lejos';
  });
  await side('1-cerrado');
  for (const [sel, n] of [['.paginas-principal > .consola-x', '2-paginas'], ['.prs-copia > .consola-x', '3-prs'], ['.programados-sesion > .consola-x', '4-programados']]) {
    await pg.click(sel); await sleep(400); check(await spot() === 'debajo', n + ': the list opens right below its button'); await side(n); await pg.click(sel); await sleep(200);
  }
  await pg.evaluate(() => { const hid = window.__game.get().talkingWith; window.__intercoms.set(e => ({ list: e.list.map(v => v.dwellerId === hid ? { ...v, maximized: true } : v) })); });
  await sleep(800); await side('5-max');
  await pg.click('.paginas-principal > .consola-x'); await sleep(400); check(await spot() === 'debajo', 'maximized: right below its button'); await side('6-max-paginas'); await pg.click('.paginas-principal > .consola-x');
  await pg.click('.programados-sesion > .consola-x'); await sleep(400); check(await spot() === 'debajo', 'maximized: the scheduled list right below its button'); await side('7-max-programados'); await pg.click('.programados-sesion > .consola-x');
  // a short window: below the buttons there's no room, so the list opens to their right, over the conversation
  await pg.setViewportSize({ width: 1400, height: 640 }); await sleep(800);
  await pg.click('.programados-sesion > .consola-x'); await sleep(400); check(['debajo', 'derecha'].includes(await spot()), 'short window: the scheduled list at its button, inside the intercom'); await side('8-bajo-programados'); await pg.click('.programados-sesion > .consola-x');
  await pg.click('.paginas-principal > .consola-x'); await sleep(400); check(await spot() === 'derecha', 'short window: the pages list to the right of its button, inside the intercom'); await side('9-bajo-paginas');
} finally { await b.close(); server.kill(); }
process.exit(failures ? 1 : 0);

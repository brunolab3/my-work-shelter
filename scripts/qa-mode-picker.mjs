// QA of a conversation's permission mode picker (ModePicker in web/src/ui/Dialog.tsx), with its own server in a test
// shelter, Playwright and a real Claude Code session (Haiku, one short reply) with the dweller of a throwaway repo: the mode at the right
// of the status line opens the modes upwards with the current one marked; picking «Plan first» changes the session's
// mode; ⇧Tab in the composer opens it too, ↓ moves; «No limits» asks first (Esc goes back to the list) and then either
// changes or, refused by Claude Code, leaves the label and shows a notice. Screenshots of each.
// Needs the built client (npx vite build). Usage: node scripts/qa-mode-picker.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3798)
// Careful: it starts a real Claude Code session (it uses your plan), in a test shelter, never yours.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3798);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-modo-')); process.env.SHELTER_DATOS = DATA;
// a throwaway repo of its own: the Bridge's folder is the game's, a worktree's hologram when run from one
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@x.example', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@x.example' };
const repo = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-modo-repo-'))), 'tienda'); mkdirSync(repo);
for (const a of [['init', '-q', '-b', 'main'], ['commit', '-q', '--allow-empty', '-m', 'inicio']]) execFileSync('git', ['-C', repo, ...a], { env: ENV });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: 'ignore' });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  pg.on('pageerror', e => check(false, 'page error: ' + e.message));
  const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await sleep(250); } return false; };
  const shot = async name => pg.screenshot({ path: path.join(dir, `mode-${name}.png`), clip: await pg.$eval('.console', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  await pg.evaluate(r => window.__client.action('recruit', { path: r }), repo);
  await pg.waitForFunction(r => { const room = window.__live.get().state?.rooms?.find(x => x.path === r); return room && window.__game.get().dwellers.some(h => h.room === room.id); }, repo, { timeout: 60000 });
  const h = await pg.evaluate(r => { const room = window.__live.get().state.rooms.find(x => x.path === r); return window.__game.get().dwellers.find(h => h.room === room.id); }, repo);
  await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
  await pg.waitForSelector('.console .options-console');
  const options = await pg.evaluate(() => [...document.querySelectorAll('.console .options-console li')].map(l => l.textContent.replace('▶', '').trim()));
  const i = options.findIndex(o => /^(Empezar|Start)/.test(o));
  for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown');
  await pg.keyboard.press('Enter'); await sleep(400);
  await pg.keyboard.type('Reply with the single word OK. Use no tools.', { delay: 1 });
  await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');   // Haiku
  await pg.keyboard.press('Enter');
  check(await until(() => pg.evaluate(id => Object.values(window.__live.get().sessions).some(s => s.dwellerId === id && s.state !== 'closed'), h.id), 20000), 'the conversation starts');
  const sessionId = await pg.evaluate(id => Object.values(window.__live.get().sessions).find(s => s.dwellerId === id && s.state !== 'closed')?.id, h.id);
  const session = () => pg.evaluate(id => window.__live.get().sessions[id], sessionId);
  const trust = await until(async () => (await session())?.pending?.type === 'trust', 8000) && (await session()).pending;
  if (trust) await pg.evaluate(([sessionId, requestId]) => window.__client.send({ t: 'answer', sessionId, requestId, decision: 'no' }), [sessionId, trust.id]);
  check(await until(async () => ['finished', 'idle'].includes((await session())?.state), 90000), 'it replies and goes idle');
  await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
  check(await until(async () => (await pg.$('.console .session')) !== null, 10000), 'the intercom shows the conversation');
  const label = () => pg.$eval('.console .line-state .mode-current', el => el.textContent).catch(() => '');
  check(/Auto|Automático/.test(await label()), `the status line shows the mode as a control: ${await label()}`);

  await pg.click('.console .line-state .mode-current');
  const rows = () => pg.$$eval('.console .mode-list li', l => l.map(x => ({ on: x.classList.contains('on'), text: x.textContent })));
  check((await rows()).length === 5, 'a click opens the five modes');
  check((await rows()).filter(r => r.on).length === 1 && /Auto|Automático/.test((await rows()).find(r => r.on).text), 'the current one is marked');
  check(await pg.$eval('.console .mode-list', el => { const l = el.getBoundingClientRect(), c = el.closest('.console').getBoundingClientRect(); return l.top >= c.top && l.bottom <= c.bottom && l.right <= c.right + 1; }), 'the list opens inside the intercom');
  check((await rows()).some(r => /read-only from now|solo lectura/i.test(r.text)), 'plan says it is read-only until a plan is approved');
  await shot('open');
  await pg.click('.console .mode-list li:nth-child(3) button');
  check(await until(async () => (await session())?.permissionMode === 'plan', 5000), 'picking «Plan first» changes the session to plan');
  check(await until(async () => /Plan/.test(await label()), 3000), 'and the label follows');
  check(await pg.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), 'focus goes back to the composer');

  await pg.focus('.console .session textarea'); await pg.keyboard.press('Shift+Tab');
  check(await until(async () => (await rows()).length === 5, 2000), '⇧Tab in the composer opens it');
  check(await pg.evaluate(() => document.activeElement?.closest('li')?.classList.contains('on')), 'with the current mode focused');
  await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown');   // plan → auto → no limits
  await pg.keyboard.press('Enter');
  check(await until(async () => (await pg.$('.console .mode-confirm')) !== null, 2000), '«No limits» asks first');
  await shot('confirm');
  await pg.keyboard.press('Escape');
  check(await until(async () => (await rows()).length === 5, 2000) && (await session()).permissionMode === 'plan', 'Esc goes back to the list without changing it');
  await pg.click('.console .mode-list li:nth-child(5) button');
  await pg.click('.console .mode-confirm button');
  const took = await until(async () => (await session())?.permissionMode === 'bypassPermissions', 3000);
  if (took) check(/No limits|Sin límites/.test(await label()), 'Claude Code took bypassPermissions and the label follows');
  else {
    check(/Plan/.test(await label()), 'Claude Code refused bypassPermissions: the label stays');
    check(await until(() => pg.evaluate(() => /did not take|no aceptó/.test(document.body.textContent)), 6000), 'and a notice says so');
  }
  await shot('after-bypass');
  await pg.evaluate(id => window.__client.send({ t: 'closeSession', sessionId: id }), sessionId);
} finally {
  await b.close(); server.kill();
}
console.log(failures ? `\n${failures} FAILED` : '\nAll OK');
process.exit(failures ? 1 : 0);

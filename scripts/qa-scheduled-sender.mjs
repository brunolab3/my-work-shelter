// QA of the scheduled messages' sender (web/src/ui/scheduledSender.ts) in the intercom's ⏰ list: with a conversation
// open and in a hologram's list with none, every row names who sent it (the Overseer, another room's dweller, the game,
// or the room that scheduled it) before its target. Own server in a test shelter and Playwright; screenshots of both.
// Needs the built client (npx vite build). Usage: node scripts/qa-scheduled-sender.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3798)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3798);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-remitente-')); process.env.SHELTER_DATOS = DATA;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@x.example', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@x.example' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-remitente-repos-')));
const repo = path.join(base, 'tienda'); mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(path.join(repo, 'README'), 'tienda'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'inicio');
const wt = path.join(repo, '.claude/worktrees/shelter-qa-7'); sh(repo, 'worktree', 'add', '-q', '-b', 'QA-7-carrito', wt);
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: 'ignore' });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  pg.on('pageerror', e => check(false, 'page error: ' + e.message));
  await pg.addInitScript(() => localStorage.setItem('refugio.idioma', 'en'));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.action('reclutar', { path: r }); await window.__client.action('guardar', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); }, repo);
  await pg.waitForFunction(w => window.__game.get().copies.some(c => c.copy?.path === w), wt, { timeout: 90000 });
  const holo = await pg.evaluate(w => window.__game.get().copies.find(c => c.copy?.path === w), wt);
  const roomName = await pg.evaluate(id => window.__live.get().state.rooms.find(r => r.id === id)?.name, holo.room);
  const rows = async () => { await pg.click('.programados-sesion > .consola-x'); await sleep(400); return pg.$$eval('.programados-lista li:not(.programados-grupo)', l => l.map(x => x.children[1]?.textContent)); };
  const shot = async n => { const r = await pg.$eval('.consola', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); await pg.screenshot({ path: `${dir}/${n}.png`, clip: r }); console.log('->', `${dir}/${n}.png`); };
  const set = (withSession) => pg.evaluate(([holo, wt, withSession]) => {
    const now = Date.now(), conv = { type: 'conversacion', roomId: holo.room, sessionId: 'qa_s', claudeId: 'qa_c', cwd: wt, title: 'QA carrito' };
    const item = (id, h, message, extra) => ({ id, created: now, when: now + h * 3600e3, requested: '', message, origin: { roomId: holo.room, sessionId: 'qa_s', claudeId: 'qa_c' }, target: conv, ...extra });
    const scheduled = [
      item('o', 1, 'From the Overseer', { from: { kind: 'overseer' }, overseer: true, afterTurn: true }),
      item('r', 2, 'From another room', { from: { kind: 'room', roomId: 'git', room: 'Version Control', dweller: 'Ana' }, afterTurn: true }),
      item('g', 3, 'From the game', { from: { kind: 'game' } }),
      item('n', 4, 'No sender, to its task', { target: { type: 'sala', room: holo.room, key: 'QA-7' } })];
    const sess = { id: 'qa_s', claudeId: 'qa_c', dwellerId: holo.copy.authorId, roomId: holo.room, cwd: wt, state: 'terminada', activity: null, unread: false, title: 'QA carrito', pending: 0, helpers: [], tools: 0, turns: 1, created: now, updated: now, model: 'claude-opus-5-5' };
    window.__live.set(e => ({ ...e, sessions: withSession ? { qa_s: sess } : {}, scheduled }));
    window.__game.set({ talkingWith: holo.id });
  }, [holo, wt, withSession]);
  const expected = here => ['from the Overseer · ' + here, 'from Version Control (Ana) · ' + here, 'from the game · ' + here, `from ${roomName} · → ${holo.room} QA-7`];
  await set(true); await pg.waitForSelector('.programados-sesion', { timeout: 15000 }); await sleep(1500);
  let got = await rows(); check(JSON.stringify(got) === JSON.stringify(expected('here')), 'intercom with its conversation: ' + JSON.stringify(got));
  await shot('1-intercom-remitente');
  await pg.click('.programados-sesion > .consola-x'); await pg.evaluate(() => window.__game.set({ talkingWith: null })); await sleep(500);
  await set(false); await pg.waitForSelector('.programados-sesion', { timeout: 15000 }); await sleep(1500);
  got = await rows(); check(JSON.stringify(got) === JSON.stringify(expected('→ “QA carrito”')), 'hologram list without a conversation: ' + JSON.stringify(got));
  await shot('2-holograma-remitente');
} finally { await b.close(); server.kill(); }
process.exit(failures ? 1 : 0);

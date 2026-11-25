// QA of arranging the rooms in the bar's ⋯ N list of intercoms (ComTabs in web/src/ui/Dialog.tsx, shared/roomOrder.ts):
// dragging a room's header drops the room at another room's place, keeping the order inside each room; ⇧↑ on a focused
// header moves it up; the order is saved in the game's settings (it comes back after a server restart) and the bar's
// COM chips follow it; a room with no saved place goes last. Conversations are made up in the page (nothing reaches
// Claude Code). Own server in a test shelter and Playwright; needs the built client (npx vite build).
// Usage: node scripts/qa-com-room-order.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3799)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3799);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-orden-')); process.env.SHELTER_DATOS = DATA;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server;
const start = async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);
};
const stop = async () => { server.kill(); for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250); };
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
await start();
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async () => {
  const pg = await b.newPage({ viewport: { width: 900, height: 760 } });
  pg.on('pageerror', e => check(false, 'page error: ' + e.message));
  await pg.addInitScript(() => { localStorage.setItem('shelter.language', 'en'); window.__noLoop = true; });
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  await pg.waitForFunction(() => window.__game.get().dwellers.length >= 3, null, { timeout: 60000 });
  // one intercom per room, two made-up conversations in the first one
  await pg.evaluate(() => {
    const seen = new Set(), hs = window.__game.get().dwellers.filter(h => !seen.has(h.room) && seen.add(h.room)).slice(0, 4);
    const sessions = {}, now = Date.now(), tab = (h, n) => { const id = `qa-${h.room}-${n}`; sessions[id] = { id, dwellerId: h.id, roomId: h.room, cwd: '/tmp', state: 'idle', unread: false, title: `${h.room} ${n}`, pending: 0, helpers: [], tools: 0, turns: 1, updated: now }; return { id: 'p' + id, view: { type: 'session', sessionId: id } }; };
    const list = hs.map((h, i) => ({ dwellerId: h.id, tabs: i ? [tab(h, 1)] : [tab(h, 1), tab(h, 2)], maximized: false, z: i, known: [] }));
    list.forEach(w => { w.active = w.tabs[0].id; });
    window.__live.set(e => ({ ...e, sessions: { ...e.sessions, ...sessions } }));
    window.__intercoms.set({ list });
  });
  await sleep(500);
  return pg;
};
const LIST = '.bar-list-com';
const headers = pg => pg.$$eval(`${LIST} .vt-list-group[data-room]`, l => l.map(x => x.dataset.room));
const rows = pg => pg.$$eval(`${LIST} .vt-list-row .vt-list-name`, l => l.map(x => x.textContent.trim()));
const chips = pg => pg.evaluate(() => [...document.querySelectorAll('.bar-windows .bar-row.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0]));
const listOpen = async pg => { if (!(await pg.$(LIST))) { await pg.evaluate(() => document.querySelector('.vt-all').click()); await sleep(400); } };
try {
  let pg = await open();
  await listOpen(pg);
  const r0 = await headers(pg), names0 = await rows(pg);
  check(r0.length >= 3, `the ⋯ N list has ${r0.length} rooms: ${r0.join(', ')}`);
  // drag the first room's header onto the last room
  await pg.dragAndDrop(`${LIST} .vt-list-group[data-room="${r0[0]}"]`, `${LIST} .vt-list-group[data-room="${r0.at(-1)}"]`);
  await sleep(600);
  const r1 = await headers(pg);
  check(r1.join() === [...r0.slice(1), r0[0]].join(), `dragged to the last room's place, the first room goes last: ${r1.join(', ')}`);
  const inFirst = (await rows(pg)).filter(n => n.startsWith(r0[0] + ' '));
  check(inFirst.join() === names0.filter(n => n.startsWith(r0[0] + ' ')).join(), `its conversations keep their order: ${inFirst.join(', ')}`);
  const saved = await pg.evaluate(() => window.__live.get().state.settings.comRoomOrder);
  check(saved?.join() === r1.join(), `the order is saved in the settings: ${saved}`);
  await pg.screenshot({ path: `${dir}/qa-com-room-order.png` });
  // ⇧↑ on a focused header moves it up one place
  await pg.focus(`${LIST} .vt-list-group[data-room="${r1.at(-1)}"]`); await pg.keyboard.press('Shift+ArrowUp'); await sleep(600);
  const r2 = await headers(pg);
  check(r2.join() === [...r1.slice(0, -2), r1.at(-1), r1.at(-2)].join(), `⇧↑ moves the focused room up: ${r2.join(', ')}`);
  check(await pg.evaluate(r => document.activeElement?.dataset?.room === r, r1.at(-1)), 'and the header keeps the focus');
  await pg.keyboard.press('Escape'); await sleep(200);
  // the bar's COM chips follow the same order (titles say the room's name: compare against the list's headers' text)
  await listOpen(pg);
  const roomNames = await pg.$$eval(`${LIST} .vt-list-group[data-room]`, l => l.map(x => x.textContent.trim()));
  await pg.keyboard.press('Escape'); await sleep(200);
  const cs = await chips(pg);
  check(cs.length > 1 && cs.every((c, i) => roomNames.filter(n => cs.some(x => x.includes(n))).indexOf(roomNames.find(n => c.includes(n))) === i), `the COM chips follow it: ${cs.join(' | ')}`);
  await pg.close();
  // after a restart, in a new page, the order is still there; a room with no saved place goes last
  await stop(); await start();
  pg = await open();
  await listOpen(pg);
  check((await headers(pg)).join() === r2.join(), `after a restart, in a new page, the saved order comes back: ${(await headers(pg)).join(', ')}`);
  await pg.evaluate(r => window.__client.action('com.roomOrder', { order: r.slice(1) }), r2); await sleep(500);
  const r3 = await headers(pg);
  check(r3.join() === [...r2.slice(1), r2[0]].join(), `a room with no saved place goes last: ${r3.join(', ')}`);
} finally {
  await b.close(); server.kill();
}
console.log(failures ? `\n${failures} failures` : '\nall OK');
process.exit(failures ? 1 : 0);

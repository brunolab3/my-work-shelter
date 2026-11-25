// QA of the bar's hover list (talkersOf in web/src/ui/Bar.tsx): a room's COM chip lists every talker of the room, its
// worktrees' holograms too, with no intercom panel or conversation of their own; clicking one of those opens its
// intercom. In a test shelter the Command Bridge points at this checkout, so its real worktrees are holograms with no
// sessions. Own server and Playwright; a screenshot of the list. Needs the built client (npx vite build) and a repo
// with worktrees. Usage: node scripts/qa-bar-hover-worktrees.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3799)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3799);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-barra-holos-')); process.env.SHELTER_DATOS = DATA;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: 'ignore' });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  pg.on('pageerror', e => check(false, 'page error: ' + e.message));
  await pg.addInitScript(() => localStorage.setItem('shelter.language', 'en'));
  await pg.goto(withToken(`http://127.0.0.1:${PORT}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  await pg.waitForFunction(() => window.__game.get().copies.some(c => c.room === 'bridge'), null, { timeout: 60000 });
  const { owner, holos } = await pg.evaluate(() => {
    const g = window.__game.get();
    return { owner: g.dwellers.find(d => d.room === 'bridge'), holos: g.copies.filter(c => c.room === 'bridge').map(c => c.id) };
  });
  check(holos.length > 0, `the Command Bridge has holograms: ${holos.length}`);
  // a fresh shelter assembles its holograms one by one: a hologram can't be talked to before it stands
  const standing = await pg.waitForFunction(ids => ids.every(id => window.__shelter.holograms.ofId(id)?.ready), holos, { timeout: 240000, polling: 1000 }).then(() => true, () => false);
  check(standing, 'every hologram is assembled');
  // only the owner's intercom is open: the holograms have no panel
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: 'bridge', dwellerId: id, talk: true } })), owner.id);
  await pg.waitForFunction(id => window.__game.get().talkingWith === id, owner.id, { timeout: 30000 });
  const CHIP = '.bar-row.com > .chip-terminal:not(.barra-mas)', ROWS = '.peek-bar .bar-peek-row';
  check(await pg.waitForSelector(CHIP, { timeout: 15000 }).then(() => true, () => false), 'the bar shows the Command Bridge chip');
  await pg.hover(CHIP); await sleep(400);
  const rows = await pg.$$eval(ROWS, l => l.map(f => ({ name: f.querySelector('b')?.textContent, holo: f.classList.contains('of-copy'), state: f.querySelector('.peek-bar-state')?.textContent })));
  check(rows.length === holos.length + 1, `its hover lists the owner and every hologram: ${rows.length} rows for ${holos.length + 1} talkers`);
  check(rows[0] && !rows[0].holo && rows.slice(1).every(r => r.holo), 'the owner (with a conversation tab) first, the holograms without one after');
  const tinted = await pg.$$eval(`${ROWS}.of-copy .console-who-photo.holo`, l => l.filter(e => e.style.getPropertyValue('--tone')).length);
  check(tinted === holos.length, `each hologram's bust in its task color: ${tinted}/${holos.length}`);
  const r = await pg.$eval('.peek-bar', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await pg.screenshot({ path: `${dir}/qa-barra-hologramas.png`, clip: r, timeout: 90000 }); console.log('->', `${dir}/qa-barra-hologramas.png`);
  await pg.click(`${ROWS}.of-copy`);
  const opened = await pg.waitForFunction(ids => ids.includes(window.__game.get().talkingWith), holos, { timeout: 15000 }).then(() => true, () => false);
  check(opened, 'clicking a hologram with no panel opens its intercom');
} finally { await b.close(); server.kill(); }
process.exit(failures ? 1 : 0);

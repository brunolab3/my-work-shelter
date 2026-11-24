// QA of the who selector above the portrait (WhoSelector in web/src/ui/Dialog.tsx) in a room whose only talker is its
// own dweller, a robot-looking one: Planning (CM-4, no holograms). The chip shows, names CM-4 and, clicked, opens a list
// with that one row marked as current; Esc closes it. Own server in a test shelter and Playwright; a screenshot of the
// open list. Needs the built client (npx vite build). Usage: node scripts/qa-who-selector.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3799)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3799);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-quien-')); process.env.SHELTER_DATOS = DATA;
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
  await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  await pg.waitForFunction(() => window.__game.get().dwellers.some(d => d.room === 'logistica'), null, { timeout: 60000 });
  const cm = await pg.evaluate(() => window.__game.get().dwellers.find(d => d.room === 'logistica'));
  check(cm.robot, `Planning's dweller looks like a robot: ${cm.name}`);
  await pg.evaluate(id => window.__game.set({ talkingWith: id }), cm.id);
  const CHIP = '.consola .consola-quien > .chip-terminal', ROWS = '.consola .consola-quien-lista .barra-asomo-fila';
  const shown = await pg.waitForSelector(CHIP, { timeout: 15000 }).then(() => true, () => false);
  check(shown, 'the who chip shows in Planning\'s intercom');
  if (!shown) throw new Error('no who chip: nothing more to check');
  check((await pg.textContent(`${CHIP} .consola-quien-nombre`))?.trim() === cm.name, `and names ${cm.name}`);
  await pg.click(CHIP); await sleep(400);
  const rows = await pg.$$eval(ROWS, l => l.map(f => ({ name: f.querySelector('b')?.textContent, current: f.classList.contains('actual') })));
  check(rows.length === 1 && rows[0].name === cm.name && rows[0].current, 'clicked, it opens with its one row, the owner, marked as current: ' + JSON.stringify(rows));
  const r = await pg.$eval('.consola', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  await pg.screenshot({ path: `${dir}/qa-quien-planificacion.png`, clip: r, timeout: 90000 }); console.log('->', `${dir}/qa-quien-planificacion.png`);
  await pg.keyboard.press('Escape'); await sleep(300);
  check(!(await pg.isVisible('.consola .consola-quien-lista')) && await pg.isVisible('.consola'), 'Esc closes the list and only the list');
} finally { await b.close(); server.kill(); }
process.exit(failures ? 1 : 0);

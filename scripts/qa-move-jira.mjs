// QA of moving a task on the Jira board (JiraBoard in web/src/ui/Operations.tsx), with its own server in a test shelter
// and Playwright:
// - the real server refuses `transiciones`/`mover` with a column that isn't the board's or a key that isn't one;
// - with example answers for Jira (panel, transiciones, mover): dragging QA-5 (To Do) onto «En curso» asks Jira for the
//   transitions towards that column and opens a confirmation «QA-5: To Do → In Progress» without writing anything; Esc
//   cancels it and nothing is posted; dragged again, Enter posts that transition, the card says so and lands in its new
//   column, still selected;
// - QA-9 onto «Hecho»: two transitions lead there, listed to pick with ↓; Enter posts the picked one;
// - a column Jira's workflow doesn't reach: a notice, no confirmation;
// - a refused move (403): the card shows the error and stays where it was;
// - ⇧→ on the selected card opens the same confirmation for the next column.
// Necesita el cliente compilado (npx vite build). Uso: node scripts/qa-move-jira.mjs [carpeta-capturas]   (SHELTER_PUERTO_QA, 3795)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3795);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-mover-jira-'));
process.env.SHELTER_DATOS = DATA;

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
  await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the real server checks what it's asked before reaching Jira
  const reject = d => pg.evaluate(([n, d]) => window.__client.action(n, d).then(() => '', e => e.message), d);
  check(/column|columna/i.test(await reject(['integration.transitions', { source: 'jira', key: 'QA-5', column: 'Done' }])), 'transiciones: a column that is not the board\'s is refused');
  check(/key|clave/i.test(await reject(['integration.move', { source: 'jira', key: '../myself', column: 'hecho', id: '1' }])), 'mover: a key that is not one is refused');

  // ---- example answers for Jira from here on; every call is recorded
  await pg.evaluate(() => {
    const c = window.__client, orig = c.action.bind(c);
    const task = (key, category, state) => ({ key, title: 'Tarea ' + key, url: 'https://jira.example/browse/' + key, state, category, updated: Date.now() });
    const tareas = [task('QA-5', 'new', 'To Do'), task('QA-9', 'indeterminate', 'In Progress'), task('QA-12', 'new', 'To Do')];
    const tr = (id, name, a, category) => ({ id, name, a, category });
    const targets = { enCurso: [tr('11', 'Start', 'In Progress', 'indeterminate')], hecho: [tr('31', 'Done', 'Done', 'done'), tr('32', "Won't do", 'Closed', 'done')], revision: [tr('21', 'Review', 'Code Review', 'indeterminate')] };
    window.__calls = [];
    c.action = (n, d) => {
      if (n.startsWith('integration.') && d?.source === 'jira') window.__calls.push([n, d]);
      if (n === 'integration.panel' && d?.source === 'jira') return Promise.resolve({ tareas: tareas.map(x => ({ ...x })) });
      if (n === 'git.prsBoard') return Promise.resolve({ prs: [] });
      if (n === 'integration.transitions') return Promise.resolve({ transitions: (targets[d.column] ?? []).filter(x => x.a !== d.current) });
      if (n === 'integration.move') {
        if (d.key === 'QA-12') return Promise.reject(new Error('Jira won\'t let this token move the task (403)'));
        const x = Object.values(targets).flat().find(y => y.id === d.id), ta = tareas.find(y => y.key === d.key);
        Object.assign(ta, { state: x.a, category: x.category, updated: Date.now() });
        return Promise.resolve({ key: d.key, state: x.a, category: x.category });
      }
      return orig(n, d);
    };
    window.__game.set({ panel: 'logistica', panelData: { view: 'jira' } });
  });
  const calls = n => pg.evaluate(n => window.__calls.filter(x => x[0] === n).map(x => x[1]), n);
  const col = k => `.kanban-col:nth-child(${k})`;   // 1 Por hacer, 2 Bloqueado, 3 En curso, 4 En revisión, 5 Prueba en producción, 6 Hecho
  const card = key => `.ficha-issue:has(.ident:text-is("${key}"))`;
  const confirmation = () => pg.textContent('.mover-jira').catch(() => '');
  check(await until(async () => (await pg.$$('.ficha-issue')).length === 3), 'the board shows the three tasks');

  await pg.dragAndDrop(card('QA-5'), col(3));
  check(await until(async () => /QA-5: To Do → In Progress/.test(await confirmation())), 'dropping QA-5 on «En curso» asks for confirmation «QA-5: To Do → In Progress»');
  const t1 = await calls('integration.transitions');
  check(t1.length === 1 && t1[0].key === 'QA-5' && t1[0].column === 'enCurso' && t1[0].current === 'To Do', `…after asking Jira for the transitions towards that column (${JSON.stringify(t1)})`);
  check(!(await calls('integration.move')).length, '…and nothing is written yet');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-confirmar.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  check(await until(async () => !(await pg.$('.mover-jira'))) && !(await calls('integration.move')).length && (await pg.evaluate(() => window.__game.get().panel)) === 'logistica', 'Esc cancels: nothing posted, the board stays open');

  await pg.dragAndDrop(card('QA-5'), col(3));
  await until(async () => !!(await pg.$('.mover-jira')));
  await pg.keyboard.press('Enter');
  check(await until(async () => (await calls('integration.move')).some(d => d.key === 'QA-5' && d.id === '11' && d.column === 'enCurso')), 'Enter posts that transition (id 11)');
  check(await until(async () => /In Progress/.test(await pg.textContent(`${card('QA-5')} .movida`).catch(() => '')) && !!(await pg.$(`${col(3)} ${card('QA-5')}`))), 'the card says it moved and lands in «En curso»');
  check(await until(async () => /QA-5/.test(await pg.textContent('.ficha-issue.sel').catch(() => ''))), '…still selected');

  await pg.dragAndDrop(card('QA-9'), col(6));
  check(await until(async () => (await pg.$$('.mover-jira li')).length === 2 && /QA-9: In Progress → Done/.test(await confirmation())), 'QA-9 onto «Hecho»: two transitions lead there, listed to pick');
  await pg.keyboard.press('ArrowDown');
  check(await until(async () => /QA-9: In Progress → Closed/.test(await confirmation())), '↓ picks «Won\'t do → Closed»');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-elegir.png'), animations: 'disabled' });
  await pg.keyboard.press('Enter');
  check(await until(async () => (await calls('integration.move')).some(d => d.key === 'QA-9' && d.id === '32')), 'Enter posts the picked one (id 32)');
  check(await until(async () => !!(await pg.$(`${col(6)} ${card('QA-9')}`))), 'QA-9 lands in «Hecho»');

  await pg.dragAndDrop(card('QA-12'), col(2));
  check(await until(async () => /QA-12/.test(await pg.textContent('.aviso-consola').catch(() => ''))) && !(await pg.$('.mover-jira')), 'a column the workflow doesn\'t reach (Bloqueado): a notice, no confirmation');

  const before = (await calls('integration.move')).length;
  await pg.dragAndDrop(card('QA-12'), col(3));
  await until(async () => !!(await pg.$('.mover-jira')));
  await pg.keyboard.press('Enter');
  check(await until(async () => /✗.*403/.test(await pg.textContent(`${card('QA-12')} .movida.mal`).catch(() => ''))) && !!(await pg.$(`${col(1)} ${card('QA-12')}`)), 'a refused move: the card shows the error and stays in «Por hacer»');
  check((await calls('integration.move')).length === before + 1, '…after a single attempt');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-error.png'), animations: 'disabled' });

  // ⇧→ on the selected card (QA-5, in «En curso») → «En revisión»
  await pg.hover(card('QA-5'));
  await pg.keyboard.press('Shift+ArrowRight');
  check(await until(async () => /QA-5: In Progress → Code Review/.test(await confirmation())), '⇧→ on the selected card opens the confirmation for the next column');
  await pg.keyboard.press('Escape');
  check(await until(async () => !(await pg.$('.mover-jira'))) && (await pg.evaluate(() => window.__game.get().panel)) === 'logistica', 'Esc closes only the confirmation');
  check(/⇧←→/.test(await pg.textContent('.ayuda-consola').catch(() => '')), 'the legend names ⇧←→');
  check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(output.slice(-1500)); }
finally { await b.close(); server.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

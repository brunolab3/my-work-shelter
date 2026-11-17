// QA of moving a task on the Jira board (BoardJira in web/src/ui/Operations.tsx), with its own server in a test shelter
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

const RAIZ = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PUERTO = Number(process.env.SHELTER_PUERTO_QA || 3795);
const DATOS = mkdtempSync(path.join(os.tmpdir(), 'ws-mover-jira-'));
process.env.SHELTER_DATOS = DATOS;

const servidor = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: RAIZ, env: { ...process.env, SHELTER_DATOS: DATOS, SHELTER_PUERTO: String(PUERTO), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let salida = ''; servidor.stdout.on('data', d => { salida += d; }); servidor.stderr.on('data', d => { salida += d; });
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PUERTO}/salud`).then(() => true, () => false)); i++) await dormir(250);

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errores = [];
  pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PUERTO}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); await window.__client.accion('guardar', { parche: { doneWelcome: true } }); window.__juego.set({ panel: null, panelData: null }); });
  const hasta = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the real server checks what it's asked before reaching Jira
  const rechaza = d => pg.evaluate(([n, d]) => window.__client.accion(n, d).then(() => '', e => e.message), d);
  ver(/column|columna/i.test(await rechaza(['integracion.transiciones', { fuente: 'jira', clave: 'QA-5', columna: 'Done' }])), 'transiciones: a column that is not the board\'s is refused');
  ver(/key|clave/i.test(await rechaza(['integracion.mover', { fuente: 'jira', clave: '../myself', columna: 'hecho', id: '1' }])), 'mover: a key that is not one is refused');

  // ---- example answers for Jira from here on; every call is recorded
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const tarea = (clave, categoria, estado) => ({ clave, titulo: 'Tarea ' + clave, url: 'https://jira.example/browse/' + clave, estado, categoria, actualizada: Date.now() });
    const tareas = [tarea('QA-5', 'new', 'To Do'), tarea('QA-9', 'indeterminate', 'In Progress'), tarea('QA-12', 'new', 'To Do')];
    const tr = (id, nombre, a, categoria) => ({ id, nombre, a, categoria });
    const destinos = { enCurso: [tr('11', 'Start', 'In Progress', 'indeterminate')], hecho: [tr('31', 'Done', 'Done', 'done'), tr('32', "Won't do", 'Closed', 'done')], revision: [tr('21', 'Review', 'Code Review', 'indeterminate')] };
    window.__llamadas = [];
    c.accion = (n, d) => {
      if (n.startsWith('integracion.') && d?.fuente === 'jira') window.__llamadas.push([n, d]);
      if (n === 'integracion.panel' && d?.fuente === 'jira') return Promise.resolve({ tareas: tareas.map(x => ({ ...x })) });
      if (n === 'git.prsTablero') return Promise.resolve({ prs: [] });
      if (n === 'integracion.transiciones') return Promise.resolve({ transiciones: (destinos[d.columna] ?? []).filter(x => x.a !== d.actual) });
      if (n === 'integracion.mover') {
        if (d.clave === 'QA-12') return Promise.reject(new Error('Jira won\'t let this token move the task (403)'));
        const x = Object.values(destinos).flat().find(y => y.id === d.id), ta = tareas.find(y => y.clave === d.clave);
        Object.assign(ta, { estado: x.a, categoria: x.categoria, actualizada: Date.now() });
        return Promise.resolve({ clave: d.clave, estado: x.a, categoria: x.categoria });
      }
      return orig(n, d);
    };
    window.__juego.set({ panel: 'logistica', panelData: { vista: 'jira' } });
  });
  const llamadas = n => pg.evaluate(n => window.__llamadas.filter(x => x[0] === n).map(x => x[1]), n);
  const col = k => `.kanban-col:nth-child(${k})`;   // 1 Por hacer, 2 Bloqueado, 3 En curso, 4 En revisión, 5 Hecho
  const ficha = clave => `.ficha-issue:has(.ident:text-is("${clave}"))`;
  const confirmacion = () => pg.textContent('.mover-jira').catch(() => '');
  ver(await hasta(async () => (await pg.$$('.ficha-issue')).length === 3), 'the board shows the three tasks');

  await pg.dragAndDrop(ficha('QA-5'), col(3));
  ver(await hasta(async () => /QA-5: To Do → In Progress/.test(await confirmacion())), 'dropping QA-5 on «En curso» asks for confirmation «QA-5: To Do → In Progress»');
  const t1 = await llamadas('integracion.transiciones');
  ver(t1.length === 1 && t1[0].clave === 'QA-5' && t1[0].columna === 'enCurso' && t1[0].actual === 'To Do', `…after asking Jira for the transitions towards that column (${JSON.stringify(t1)})`);
  ver(!(await llamadas('integracion.mover')).length, '…and nothing is written yet');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-confirmar.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => !(await pg.$('.mover-jira'))) && !(await llamadas('integracion.mover')).length && (await pg.evaluate(() => window.__juego.get().panel)) === 'logistica', 'Esc cancels: nothing posted, the board stays open');

  await pg.dragAndDrop(ficha('QA-5'), col(3));
  await hasta(async () => !!(await pg.$('.mover-jira')));
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => (await llamadas('integracion.mover')).some(d => d.clave === 'QA-5' && d.id === '11' && d.columna === 'enCurso')), 'Enter posts that transition (id 11)');
  ver(await hasta(async () => /In Progress/.test(await pg.textContent(`${ficha('QA-5')} .movida`).catch(() => '')) && !!(await pg.$(`${col(3)} ${ficha('QA-5')}`))), 'the card says it moved and lands in «En curso»');
  ver(await hasta(async () => /QA-5/.test(await pg.textContent('.ficha-issue.sel').catch(() => ''))), '…still selected');

  await pg.dragAndDrop(ficha('QA-9'), col(5));
  ver(await hasta(async () => (await pg.$$('.mover-jira li')).length === 2 && /QA-9: In Progress → Done/.test(await confirmacion())), 'QA-9 onto «Hecho»: two transitions lead there, listed to pick');
  await pg.keyboard.press('ArrowDown');
  ver(await hasta(async () => /QA-9: In Progress → Closed/.test(await confirmacion())), '↓ picks «Won\'t do → Closed»');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-elegir.png'), animations: 'disabled' });
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => (await llamadas('integracion.mover')).some(d => d.clave === 'QA-9' && d.id === '32')), 'Enter posts the picked one (id 32)');
  ver(await hasta(async () => !!(await pg.$(`${col(5)} ${ficha('QA-9')}`))), 'QA-9 lands in «Hecho»');

  await pg.dragAndDrop(ficha('QA-12'), col(2));
  ver(await hasta(async () => /QA-12/.test(await pg.textContent('.aviso-consola').catch(() => ''))) && !(await pg.$('.mover-jira')), 'a column the workflow doesn\'t reach (Bloqueado): a notice, no confirmation');

  const antes = (await llamadas('integracion.mover')).length;
  await pg.dragAndDrop(ficha('QA-12'), col(3));
  await hasta(async () => !!(await pg.$('.mover-jira')));
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => /✗.*403/.test(await pg.textContent(`${ficha('QA-12')} .movida.mal`).catch(() => ''))) && !!(await pg.$(`${col(1)} ${ficha('QA-12')}`)), 'a refused move: the card shows the error and stays in «Por hacer»');
  ver((await llamadas('integracion.mover')).length === antes + 1, '…after a single attempt');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'mover-jira-error.png'), animations: 'disabled' });

  // ⇧→ on the selected card (QA-5, in «En curso») → «En revisión»
  await pg.hover(ficha('QA-5'));
  await pg.keyboard.press('Shift+ArrowRight');
  ver(await hasta(async () => /QA-5: In Progress → Code Review/.test(await confirmacion())), '⇧→ on the selected card opens the confirmation for the next column');
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => !(await pg.$('.mover-jira'))) && (await pg.evaluate(() => window.__juego.get().panel)) === 'logistica', 'Esc closes only the confirmation');
  ver(/⇧←→/.test(await pg.textContent('.ayuda-consola').catch(() => '')), 'the legend names ⇧←→');
  ver(!errores.length, 'sin errores en la página' + (errores.length ? ': ' + errores.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(salida.slice(-1500)); }
finally { await b.close(); servidor.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

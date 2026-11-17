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
const RAIZ = path.resolve(import.meta.dirname, '..');
import { withToken } from './token.mjs';
const [dir = '_capturas'] = process.argv.slice(2); mkdirSync(dir, { recursive: true });
const PUERTO = Number(process.env.SHELTER_PUERTO_QA || 3797);
const DATOS = mkdtempSync(path.join(os.tmpdir(), 'ws-acciones-')); process.env.SHELTER_DATOS = DATOS;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@x.example', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@x.example' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-acciones-repos-')));
const repo = path.join(base, 'tienda'); mkdirSync(repo); sh(repo, 'init', '-q', '-b', 'main');
writeFileSync(path.join(repo, 'README'), 'tienda'); sh(repo, 'add', '.'); sh(repo, 'commit', '-q', '-m', 'inicio');
const wt = path.join(repo, '.claude/worktrees/shelter-qa-7'); sh(repo, 'worktree', 'add', '-q', '-b', 'QA-7-carrito', wt);
const paginas = [1, 2, 3, 4, 5, 6].map(i => { const f = path.join(base, `plan-${i}.html`); writeFileSync(f, `<h1>Plan ${i}</h1>`); return f; });
const servidor = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: RAIZ, env: { ...process.env, SHELTER_DATOS: DATOS, SHELTER_PUERTO: String(PUERTO), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: 'ignore' });
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PUERTO}/salud`).then(() => true, () => false)); i++) await dormir(250);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  pg.on('pageerror', e => ver(false, 'page error: ' + e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PUERTO}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.accion('reclutar', { ruta: r }); await window.__client.accion('guardar', { parche: { doneWelcome: true } }); window.__juego.set({ panel: null, panelData: null }); }, repo);
  await pg.waitForFunction(w => window.__juego.get().copias.some(c => c.copia?.ruta === w), wt, { timeout: 30000 });
  const holo = await pg.evaluate(w => window.__juego.get().copias.find(c => c.copia?.ruta === w), wt);
  console.log('copia', holo.id, holo.sala);
  await pg.evaluate(([holo, wt, paginas]) => {
    const now = Date.now();
    const c = window.__client, orig = c.accion.bind(c);
    const pr = (numero, rama, estado = 'abierto') => ({ numero, titulo: 'Carrito: parte ' + numero, url: `https://github.com/acme/tienda/pull/${numero}`, repo: 'acme/tienda', rama, estado, actualizado: 0, base: 'main' });
    const prs = [pr(7, 'QA-7-carrito'), pr(8, 'QA-7-carrito-2', 'borrador'), pr(6, 'QA-7-base', 'fusionado')];
    c.accion = (n, d) => n === 'git.prsTablero' ? Promise.resolve({ prs }) : orig(n, d);
    window.__board.set({ prs });
    const ses = { id: 'qa_s', claudeId: 'qa_c', dwellerId: holo.copia.authorId, salaId: holo.sala, cwd: wt, estado: 'terminada', actividad: null, sinLeer: false, titulo: 'QA carrito', pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, created: now, actualizada: now, modelo: 'claude-opus-5-5' };
    const entradas = paginas.map((p, i) => ({ id: 'e' + i, ts: now - i * 1000, tipo: 'asistente', texto: `Plan: [plan ${i + 1}](${p})` }));
    const prog = (id, h, m) => ({ id, creado: now, cuando: now + h * 3600e3, pedido: '', mensaje: m, origen: { salaId: holo.sala, sesionId: 'qa_s', claudeId: 'qa_c' }, destino: { tipo: 'conversacion', salaId: holo.sala, sesionId: 'qa_s', claudeId: 'qa_c', cwd: wt, titulo: 'QA carrito' } });
    window.__live.set(e => ({ sesiones: { ...e.sesiones, qa_s: ses }, entradas: { ...e.entradas, qa_s: entradas }, programados: [prog('p1', 20, 'Revisar el carrito el lunes'), prog('p2', 50, 'Mirar CI')] }));
    window.__juego.set({ talkingWith: holo.id });
  }, [holo, wt, paginas]);
  await pg.waitForSelector('.consola-acciones', { timeout: 15000 });
  await dormir(2500);
  const lado = async n => { const r = await pg.$eval('.consola', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }); await pg.screenshot({ path: `${dir}/${n}.png`, clip: r }); console.log('->', `${dir}/${n}.png`); };
  const botones = await pg.$$eval('.consola-acciones .consola-x', l => l.map(x => x.textContent));
  ver(/📄/.test(botones[0]) && /⑂/.test(botones[1]) && /✈/.test(botones[2]) && /⏰/.test(botones[3]) && botones.length === 4, 'pages, PRs, pre-flight and scheduled, in that order: ' + botones.join(' | '));
  ver(await pg.$eval('.consola-acciones', a => a.getBoundingClientRect().top - [...a.parentElement.children].at(-2).getBoundingClientRect().bottom < 30), 'the section sits right under the dweller\'s data');
  // where the open list is: 'debajo' (right below its button) or 'derecha' (to its right), and inside the intercom
  const sitio = () => pg.$eval('.paginas-lista', u => {
    const b = u.parentElement.getBoundingClientRect(), l = u.getBoundingClientRect(), z = u.closest('.consola-cuerpo').getBoundingClientRect();
    const dentro = l.top >= z.top - 1 && l.bottom <= z.bottom + 1;
    return Math.abs(l.top - b.bottom) < 3 && Math.abs(l.left - b.left) < 3 ? (dentro ? 'debajo' : 'fuera') : l.left >= b.right && l.top <= b.bottom && l.bottom >= b.top ? (dentro ? 'derecha' : 'fuera') : 'lejos';
  });
  await lado('1-cerrado');
  for (const [sel, n] of [['.paginas-principal > .consola-x', '2-paginas'], ['.prs-copia > .consola-x', '3-prs'], ['.programados-sesion > .consola-x', '4-programados']]) {
    await pg.click(sel); await dormir(400); ver(await sitio() === 'debajo', n + ': the list opens right below its button'); await lado(n); await pg.click(sel); await dormir(200);
  }
  await pg.evaluate(() => { const hid = window.__juego.get().talkingWith; window.__intercoms.set(e => ({ lista: e.lista.map(v => v.dwellerId === hid ? { ...v, maximizada: true } : v) })); });
  await dormir(800); await lado('5-max');
  await pg.click('.paginas-principal > .consola-x'); await dormir(400); ver(await sitio() === 'debajo', 'maximized: right below its button'); await lado('6-max-paginas'); await pg.click('.paginas-principal > .consola-x');
  await pg.click('.programados-sesion > .consola-x'); await dormir(400); ver(await sitio() === 'debajo', 'maximized: the scheduled list right below its button'); await lado('7-max-programados'); await pg.click('.programados-sesion > .consola-x');
  // a short window: below the buttons there's no room, so the list opens to their right, over the conversation
  await pg.setViewportSize({ width: 1400, height: 640 }); await dormir(800);
  await pg.click('.programados-sesion > .consola-x'); await dormir(400); ver(['debajo', 'derecha'].includes(await sitio()), 'short window: the scheduled list at its button, inside the intercom'); await lado('8-bajo-programados'); await pg.click('.programados-sesion > .consola-x');
  await pg.click('.paginas-principal > .consola-x'); await dormir(400); ver(await sitio() === 'derecha', 'short window: the pages list to the right of its button, inside the intercom'); await lado('9-bajo-paginas');
} finally { await b.close(); servidor.kill(); }
process.exit(failures ? 1 : 0);

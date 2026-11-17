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

const RAIZ = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PUERTO = Number(process.env.SHELTER_PUERTO_QA || 3794);
const DATOS = mkdtempSync(path.join(os.tmpdir(), 'ws-preflight-'));
process.env.SHELTER_DATOS = DATOS;
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
  await pg.evaluate(async r => { await window.__ready(); await window.__client.accion('reclutar', { ruta: r }); await window.__client.accion('guardar', { parche: { doneWelcome: true } }); window.__juego.set({ panel: null, panelData: null }); }, repo);
  const hasta = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- la acción de verdad: la parte del worktree, sin PR
  let real = null;
  await hasta(async () => { real = await pg.evaluate(() => window.__client.accion('preflight.tarea', { clave: 'qa-7' }).catch(e => ({ error: e.message }))); return real?.partes?.length > 0; });
  const p = real?.partes?.[0];
  ver(real?.clave === 'QA-7' && real.partes.length === 1, `preflight.tarea da la tarea con una parte (${JSON.stringify(real?.partes?.map(x => x.rama) ?? real)})`);
  ver(p?.worktree === wt && p?.rama === 'QA-7-carrito' && !p?.pr, 'la parte es el worktree de la tarea, sin PR');
  ver(p?.sync?.marca === 'aviso' && /1/.test(p?.sync?.texto ?? ''), `sincronía ⚠ por el archivo sin commitear (${p?.sync?.texto})`);
  ver(await pg.evaluate(() => window.__client.accion('preflight.tarea', { clave: 'rm -rf' }).then(() => false, () => true)), 'una clave que no lo es, rechazada');

  // ---- fase 3: la lista y la puerta
  await pg.evaluate(() => window.__client.accion('guardar', { parche: { checklistPreflight: ['Compare revisado', 'Pruebas con datos reales'] } }));
  ver(JSON.stringify(await pg.evaluate(() => window.__client.accion('preflight.checklist'))) === '["Compare revisado","Pruebas con datos reales"]', 'la lista guardada vuelve tal cual');
  const puerta = await pg.evaluate(w => window.__client.accion('preflight.puerta', { ruta: w }), wt);
  ver(puerta?.clave === 'QA-7' && puerta.falta.length === 2, `la puerta de push dice lo que falta (${puerta?.falta?.join(' | ')})`);
  ver(await pg.evaluate(() => window.__client.accion('preflight.puerta', { ruta: '/etc' }).then(() => false, () => true)), 'la puerta no mira carpetas que no son del refugio');

  // ---- the box with the real task, from ⌘K: only offered once the task has a PR
  const offered = async clave => (await pg.$$eval('.fila-buscador .txt', f => f.map(x => x.textContent))).includes('Pre-flight ' + clave);
  const preflightK = async clave => {
    await pg.keyboard.press('Meta+KeyK');
    await pg.waitForSelector('.buscador input');
    await pg.keyboard.type(clave.toLowerCase());
    const ok = await hasta(() => offered(clave));
    if (clave === 'QA-7') await pg.screenshot({ path: path.join(dir, 'preflight-buscador.png'), animations: 'disabled', timeout: 10000 }).catch(() => console.log('(no ⌘K screenshot: timed out)'));
    await pg.keyboard.press('Enter');
    return ok;
  };
  await pg.keyboard.press('Meta+KeyK');
  await pg.waitForSelector('.buscador input');
  await pg.keyboard.type('qa-7');
  await pg.waitForTimeout(800);
  ver(!(await offered('QA-7')), '⌘K offers no pre-flight for a task without PRs');
  await pg.keyboard.press('Escape');
  // your PRs (the board's list) from here on: one for QA-7 and those of the example tasks QA-9 and QA-11
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const pr = (repo, numero, rama, estado = 'abierto') => ({ numero, titulo: 'PR ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama, estado, actualizado: 0, base: 'main' });
    const prs = [pr('acme/tienda', 7, 'QA-7-algo'), pr('acme/api', 1, 'QA-9-parte-1'), pr('acme/api', 5, 'QA-11-a', 'fusionado')];
    c.accion = (n, d) => n === 'git.prsTablero' ? Promise.resolve({ prs }) : orig(n, d);
    window.__board.set({ prs });
  });
  ver(await preflightK('QA-7'), '⌘K offers «Pre-flight QA-7» once a PR names it');
  ver(await hasta(async () => /QA-7/.test(await pg.textContent('.pf-caja').catch(() => '')) && !(await pg.isVisible('.pf-tabla')) && /tienda/.test(await pg.textContent('.pf-caja'))), 'Enter opens the box: the real action has no GitHub, so no table, and the room working on it is named');
  ver((await pg.evaluate(() => window.__juego.get().panel)) === null, 'it is not a panel');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-real.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => !(await pg.$('.pf-caja'))), 'Esc closes it');

  // ---- una tarea en dos repos (respuesta de ejemplo, el modelo de shared/preflight.ts)
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const pr = (repo, numero, extra) => ({ numero, titulo: 'PR de ejemplo ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama: 'QA-9-parte-' + numero, estado: 'abierto', actualizado: 0, base: 'main', revision: 'REVIEW_REQUIRED', checks: 'SUCCESS', cabeza: 'c' + numero, ...extra });
    const api = pr('acme/api', 1, { checks: 'FAILURE' }), web = pr('acme/web', 2, { revision: 'APPROVED' }), otra = pr('acme/web', 3, { revision: 'APPROVED', conflictos: true }), hecho = pr('acme/api', 4, { estado: 'fusionado' });
    const cel = (marca, texto) => ({ marca, texto });
    const hilos = [{ archivo: 'src/carrito.ts', linea: 42, autor: 'revisora', texto: '¿Qué pasa si el cupón ha caducado?', url: api.url + '#discussion_r1', outdated: false }, { archivo: 'src/cupon.ts', linea: 7, autor: 'bot-revisor', texto: 'Falta una prueba', url: api.url + '#discussion_r2', outdated: true }];
    const respuesta = {
      clave: 'QA-9', color: '#4dabff', titulo: 'Carrito con cupones',
      partes: [
        { id: api.url, salaId: 'api', sala: 'api', repo: api.repo, rama: api.rama, pr: api, worktree: '/r/api', plan: 'Contrato', sync: cel('aviso', 'faltan commits remotos (¿un bot?)'), ci: cel('mal', 'roja'), revision: cel('aviso', 'esperando revisión · 💬 2 sin resolver'), conflictos: cel('ok', 'fusionable'), bloqueos: cel('ok', 'bloquea a web#2'), checklist: cel('aviso', '1/2 en def5678'), compare: cel('aviso', 'es de abc1234; HEAD def5678'), compareArchivo: '/tmp/no.html', hilos, repoItems: ['npm run lint'], ciChecks: [{ nombre: 'build', estado: 'mal' }], esperaA: [], bloquea: [{ ref: web.url, url: web.url, estado: 'abierto', motivo: 'plan' }] },
        { id: web.url, salaId: 'web', sala: 'web', repo: web.repo, rama: web.rama, pr: web, worktree: '/r/web', sync: cel('ok', 'al día'), ci: cel('ok', 'verde'), revision: cel('ok', 'aprobado'), conflictos: cel('ok', 'fusionable'), bloqueos: cel('aviso', 'espera a api#1 (abierto · su CI en rojo)'), checklist: cel('ok', '2/2 en c2c2c2c'), compare: cel('ok', 'validada en c2c2c2c'), hilos: [], repoItems: [], ciChecks: [], esperaA: [{ ref: 'acme/api#1', url: api.url, estado: 'abierto', checks: 'FAILURE', motivo: 'plan' }], bloquea: [] },
        { id: otra.url, salaId: 'web', sala: 'web', repo: otra.repo, rama: otra.rama, pr: otra, sync: cel('ok', 'al día'), ci: cel('ok', 'verde'), revision: cel('ok', 'aprobado'), conflictos: cel('mal', 'con conflictos'), bloqueos: cel('nada', 'sin bloqueos'), checklist: cel('nada', '—'), compare: cel('nada', '—'), hilos: [], repoItems: [], ciChecks: [], esperaA: [], bloquea: [] },
        { id: hecho.url, salaId: 'api', sala: 'api', repo: hecho.repo, rama: hecho.rama, pr: hecho, sync: cel('nada', '—'), ci: cel('nada', '—'), revision: cel('ok', 'fusionado'), conflictos: cel('nada', '—'), bloqueos: cel('nada', 'sin bloqueos'), checklist: cel('nada', '—'), compare: cel('nada', '—'), hilos: [], repoItems: [], ciChecks: [], esperaA: [], bloquea: [] },
        { id: 'plan:docs', salaId: 'docs', sala: 'docs', plan: 'La guía', sinEmpezar: true, sync: cel('nada', '—'), ci: cel('nada', '—'), revision: cel('nada', '—'), conflictos: cel('nada', '—'), bloqueos: cel('nada', '—'), checklist: cel('nada', '—'), compare: cel('nada', '—'), hilos: [], repoItems: [], ciChecks: [], esperaA: [], bloquea: [] },
      ],
      olas: [['acme/api#4', 'acme/api#1', 'acme/web#3'], ['acme/web#2']], ciclo: [], checklist: ['Compare revisado', 'Pruebas con datos reales'],
    };
    // QA-11: everything merged, in two waves
    const m1 = pr('acme/api', 5, { estado: 'fusionado', rama: 'QA-11-a' }), m2 = pr('acme/web', 6, { estado: 'fusionado', rama: 'QA-11-b' });
    const fusionada = (x, espera) => ({ id: x.url, salaId: x.repo.split('/')[1], sala: x.repo.split('/')[1], repo: x.repo, rama: x.rama, pr: x, sync: cel('nada', '—'), ci: cel('nada', '—'), revision: cel('ok', 'fusionado'), conflictos: cel('nada', '—'), bloqueos: cel(espera ? 'ok' : 'nada', espera ? 'lo que esperaba ya está fusionado' : 'sin bloqueos'), checklist: cel('nada', '—'), compare: cel('nada', '—'), hilos: [], repoItems: [], ciChecks: [], esperaA: espera ? [{ ref: 'acme/api#5', url: m1.url, estado: 'fusionado', motivo: 'plan' }] : [], bloquea: [] });
    // its production verification (shared/verification.ts): the PR's checkpoint evidenced, the final one waiting for traffic
    const senal = (id, tipo, que, estado, evidencia) => ({ id, tipo, que, donde: 'logs of api: «' + id + '»', base: '20 a week', estado, ...(evidencia ? { evidencia: { texto: evidencia, ts: 1 } } : {}) });
    const verificacion = { clave: 'QA-11', version: 2, actualizado: 1, puntos: [
      { id: 'pr-5', tipo: 'pr', pr: 'acme/api#5', titulo: 'acme/api#5', servicios: ['api'], vivos: { api: 1 }, plazoHoras: 24, estado: 'evidenced', abierto: 1, desde: 1, señales: [senal('gone', 'must-disappear', 'the timeout is gone', 'evidenced', '0 since the deploy')] },
      { id: 'final', tipo: 'final', titulo: 'Checkout no longer times out', servicios: [], vivos: { final: 1 }, plazoHoras: 24, estado: 'waiting-traffic', abierto: 1, desde: Date.now(), señales: [senal('ran', 'must-run', 'readiness runs on the new version', 'pending')] },
    ] };
    const tracker = { fuente: 'jira', estado: 'Prod check', tablero: 'QA', prueba: 'Prod check', hecho: 'Done', enPrueba: true, mover: true };
    const aterrizada = { clave: 'QA-11', color: '#b48cff', titulo: 'Ya fusionada', partes: [fusionada(m1), fusionada(m2, true)], olas: [['acme/api#5'], ['acme/web#6']], ciclo: [], checklist: [], verificacion, tracker };
    window.__qaVerif = [];
    c.accion = (n, d) => n === 'preflight.tarea' && String(d?.clave).toUpperCase() === 'QA-9' ? Promise.resolve(respuesta) : n === 'preflight.tarea' && String(d?.clave).toUpperCase() === 'QA-11' ? Promise.resolve(aterrizada)
      : n === 'verificacion.aprobar' ? (window.__qaVerif.push(n), Promise.resolve({ ...verificacion, aprobado: { version: 2, ts: 2 } }))
      : n === 'verificacion.cerrar' ? (window.__qaVerif.push(n), Promise.resolve({ clave: 'QA-11', estado: 'Done', categoria: 'done' })) : orig(n, d);
    window.__juego.set({ panel: 'ayuda', panelData: null });
  });
  await pg.waitForSelector('.aparato');
  // its layout box (offsets ignore the opening animation's transform)
  const caja = e => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(',');
  const panelAntes = await pg.$eval('.aparato', caja);
  await preflightK('QA-9');
  ver(await hasta(async () => (await pg.$$('.pf-fila')).length === 4), 'four rows: one per PR, none for the plan part without a PR');
  const tam = await pg.$eval('.pf-caja', e => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  ver(tam.w < 1600 * 0.6 && tam.h < 1000 * 0.75, `a small box (${JSON.stringify(tam)})`);
  ver((await pg.evaluate(() => window.__juego.get().panel)) === 'ayuda' && await pg.$eval('.aparato', caja) === panelAntes, 'the panel underneath stays open, same place and size');
  ver(await pg.$eval('.pf-fila.pf-hecha .pf-parte', e => getComputedStyle(e).textDecorationLine.includes('line-through')), 'the merged PR is struck through');
  ver(await pg.$eval('.pf-fila .pf-parte', e => e.title.includes('PR de ejemplo') && getComputedStyle(e).textOverflow === 'ellipsis'), 'the PR title truncates, with the full title in its tooltip');
  const cabeceras = await pg.$$eval('.pf-tabla th', th => th.map(x => x.textContent).join('|'));
  ver(!/Compare|Checklist|Sincron|Sync/.test(cabeceras) && /Conflict/.test(cabeceras), `no push columns, a conflicts column (${cabeceras})`);
  const estados = await pg.$$eval('.pf-estado', e => e.map(x => x.textContent));
  ver(estados.join(' ') === '✔ ✗ ✗ ⚠', `merged ✔, red CI ✗, conflicts ✗, the one that waits ⚠ (not ✗), in merge order (${estados.join(' ')})`);
  ver(!(await pg.$$('.pf-hilo')).length && !/carrito\.ts/.test(await pg.textContent('.pf-tabla')), 'no review threads listed, only their count');
  ver(/docs/.test(await pg.textContent('.pf-caja')), 'the plan part without a PR is named below');
  ver(/1.*api#4.*api#1.*web#3.*2.*web#2/.test(await pg.textContent('.orden-despliegue')) && await pg.$eval('.orden-despliegue .pf-hecha', e => /api#4/.test(e.textContent)), 'merge order, with the merged PR struck through');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-dos-repos.png'), animations: 'disabled' });
  // outside Electron the GitHub window is a new tab (window.open): what matters is which URL it opens
  await pg.evaluate(() => { window.__abierta = ''; window.open = u => { window.__abierta = String(u); return null; }; });
  await pg.click('.pf-fila:nth-child(2) .pf-parte');
  ver(await hasta(async () => (await pg.evaluate(() => window.__abierta)) === 'https://github.com/acme/api/pull/1'), 'clicking a row opens its PR');
  await pg.evaluate(() => { window.__abierta = ''; });
  await pg.click('.pf-fila:nth-child(4) td:last-child .pf-boton');
  ver(await hasta(async () => (await pg.evaluate(() => window.__abierta)) === 'https://github.com/acme/api/pull/1'), 'clicking the blockers of web#2 opens api#1, the PR it waits for');
  await pg.evaluate(() => { window.__abierta = ''; });
  await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter');
  ver(await hasta(async () => (await pg.evaluate(() => window.__abierta)) !== ''), 'Enter opens the selected PR');
  await pg.mouse.click(1590, 990);
  ver(await hasta(async () => !(await pg.$('.pf-caja'))), 'a click outside closes the box');
  ver((await pg.evaluate(() => window.__juego.get().panel)) === 'ayuda' && await pg.$eval('.aparato', caja) === panelAntes, '…and leaves the panel as it was');

  // ---- from the Jira board: F and a button, only on a task with PRs, anchored to its card
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const tarea = (clave, categoria, estado) => ({ clave, titulo: 'Tarea ' + clave, url: 'https://jira.example/browse/' + clave, estado, categoria, actualizada: Date.now() });
    const tareas = [tarea('QA-5', 'new', 'To Do'), tarea('QA-9', 'indeterminate', 'In Progress')];
    c.accion = (n, d) => n === 'integracion.panel' && d?.fuente === 'jira' ? Promise.resolve({ tareas }) : orig(n, d);
    window.__juego.set({ panel: 'logistica', panelData: { vista: 'jira' } });
  });
  const leyenda = () => pg.textContent('.aparato kbd:last-of-type >> xpath=..').catch(() => '');
  ver(await hasta(async () => (await pg.$$('.ficha-issue')).length === 2 && /QA-5/.test(await pg.textContent('.ficha-issue.sel').catch(() => ''))), 'the Jira board shows both tasks, QA-5 (no PR) selected');
  ver(!/Pre-flight/.test(await leyenda()) && !(await pg.$('.botonera button:has-text("Pre-flight")')), 'a task without PRs: no F in the legend, no button');
  await pg.keyboard.press('KeyF'); await pg.waitForTimeout(400);
  ver(!(await pg.$('.pf-caja')), '…and F does nothing');
  await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('ArrowRight');   // past the empty Blocked column
  ver(await hasta(async () => /QA-9/.test(await pg.textContent('.ficha-issue.sel').catch(() => '')) && /Pre-flight/.test(await leyenda()) && !!(await pg.$('.botonera button:text-matches("Pre-flight.*QA-9")'))), 'QA-9 (with a PR): F in the legend and a «Pre-flight QA-9» button');
  await pg.keyboard.press('KeyF');
  ver(await hasta(async () => (await pg.$$('.pf-fila')).length === 4), 'F opens the pre-flight of QA-9');
  const cerca = await pg.evaluate(() => { const a = document.querySelector('.ficha-issue.sel').getBoundingClientRect(), b = document.querySelector('.pf-caja').getBoundingClientRect(); return Math.min(Math.abs(b.top - a.bottom), Math.abs(b.bottom - a.top), Math.abs(b.left - a.right), Math.abs(b.right - a.left)) < 40; });
  ver(cerca, 'the box is anchored to the selected card');
  ver((await pg.evaluate(() => window.__juego.get().panel)) === 'logistica', 'the board stays open underneath');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-jira.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => !(await pg.$('.pf-caja'))) && (await pg.evaluate(() => window.__juego.get().panel)) === 'logistica', 'Esc closes the box, the board stays');
  await pg.click('.botonera button:text-matches("Pre-flight.*QA-9")');
  ver(await hasta(async () => (await pg.$$('.pf-fila')).length === 4), 'the button opens it too');
  await pg.keyboard.press('Escape');
  await hasta(async () => !(await pg.$('.pf-caja')));
  await pg.evaluate(() => window.__juego.set({ panel: null, panelData: null }));

  // ---- a task fully merged
  await preflightK('QA-11');
  ver(await hasta(async () => (await pg.$$('.pf-fila.pf-hecha')).length === 2), 'fully merged: both rows struck through');
  ver(await hasta(async () => (await pg.$$('.orden-despliegue .pf-ola-hecha')).length === 2 && /✔/.test(await pg.textContent('.pf-aterrizada').catch(() => ''))), 'every wave ✔ and «the task has landed»');
  // production verification: the plan unapproved (v2), its checkpoints' states, the signals' where and evidence in their tooltips
  ver(await hasta(async () => (await pg.$$('.pf-verificacion .pf-punto')).length === 2), 'the verification plan: one row per checkpoint');
  const verif = await pg.textContent('.pf-verificacion');
  ver(/v2/.test(verif) && /(evidenced|comprobado)/.test(verif) && /(waiting for traffic|esperando tráfico)/.test(verif), 'not approved v2, the PR evidenced, the final waiting for traffic');
  ver(await pg.$eval('.pf-punto li', e => e.title.includes('«gone»') && e.title.includes('20 a week') && e.title.includes('0 since the deploy')), 'a signal\'s where, baseline and evidence in its tooltip');
  ver(/Prod check/.test(verif), 'the tracker\'s status and its board\'s prod-check one');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-verificacion.png'), animations: 'disabled' });
  await pg.click('.pf-verificacion button:text-matches("Approve|Aprobar")');
  ver(await hasta(async () => /(approved|aprobado) \(v2\)/.test(await pg.textContent('.pf-verificacion'))), 'approving it: approved (v2), the button gone');
  await pg.click('.pf-verificacion button:text-matches("Done")');
  ver(await hasta(async () => /: Done/.test(await pg.textContent('.pf-verificacion')) && !(await pg.$('.pf-verificacion button'))), 'moving it to done: the tracker says Done');
  ver(JSON.stringify(await pg.evaluate(() => window.__qaVerif)) === '["verificacion.aprobar","verificacion.cerrar"]', 'each through its action');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'preflight-aterrizada.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  ver(!errores.length, 'sin errores en la página' + (errores.length ? ': ' + errores.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(salida.slice(-1500)); }
finally { await b.close(); servidor.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

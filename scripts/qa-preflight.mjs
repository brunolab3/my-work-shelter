// QA del pre-flight de una tarea (web/src/ui/Preflight.tsx), con un servidor propio en un refugio de pruebas y Playwright:
// - un repo de pruebas con el worktree de la tarea QA-7 (con un archivo sin commitear), admitido como sala: la acción
//   `preflight.tarea` de verdad (sin GitHub) da su parte sin PR, con «1 sin commitear» ⚠;
// - la ventana pintada con una tarea en dos repos (respuesta de ejemplo: PR con CI roja, otro que espera a ese, una
//   parte del plan sin empezar): una fila por parte, ✓/⚠/✗ por columna, compare y checklist en «—» y el orden de fusión;
// - ⌘K «qa-7» ofrece «Pre-flight QA-7» y lo abre; Esc lo cierra.
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

  // ---- la ventana con la tarea de verdad
  await pg.evaluate(() => window.__juego.set({ panel: 'preflight', panelData: { clave: 'QA-7' } }));
  ver(await hasta(() => pg.isVisible('.pf-tabla')), 'la ventana pinta la tabla');
  ver((await pg.$$('.pf-fila')).length === 1, 'una fila');
  await pg.screenshot({ path: path.join(dir, 'preflight-real.png') });
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => (await pg.evaluate(() => window.__juego.get().panel)) === null), 'Esc la cierra');

  // ---- una tarea en dos repos (respuesta de ejemplo, el modelo de shared/preflight.ts)
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const pr = (repo, numero, extra) => ({ numero, titulo: 'PR de ejemplo ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama: 'QA-9-parte-' + numero, estado: 'abierto', actualizado: 0, base: 'main', revision: 'REVIEW_REQUIRED', checks: 'SUCCESS', cabeza: 'c' + numero, ...extra });
    const api = pr('acme/api', 1, { checks: 'FAILURE' }), web = pr('acme/web', 2, { revision: 'APPROVED' });
    const cel = (marca, texto) => ({ marca, texto });
    const respuesta = {
      clave: 'QA-9', color: '#4dabff', titulo: 'Carrito con cupones',
      partes: [
        { id: api.url, salaId: 'api', sala: 'api', repo: api.repo, rama: api.rama, pr: api, worktree: '/r/api', plan: 'Contrato', sync: cel('aviso', 'faltan commits remotos (¿un bot?)'), ci: cel('mal', 'roja'), revision: cel('aviso', 'esperando revisión'), bloqueos: cel('ok', 'bloquea a web#2'), esperaA: [], bloquea: [{ ref: web.url, url: web.url, estado: 'abierto', motivo: 'plan' }] },
        { id: web.url, salaId: 'web', sala: 'web', repo: web.repo, rama: web.rama, pr: web, worktree: '/r/web', sync: cel('ok', 'al día'), ci: cel('ok', 'verde'), revision: cel('ok', 'aprobado'), bloqueos: cel('aviso', 'espera a api#1 (abierto · su CI en rojo)'), esperaA: [{ ref: 'acme/api#1', url: api.url, estado: 'abierto', checks: 'FAILURE', motivo: 'plan' }], bloquea: [] },
        { id: 'plan:docs', salaId: 'docs', sala: 'docs', plan: 'La guía', sinEmpezar: true, sync: cel('nada', '—'), ci: cel('nada', '—'), revision: cel('nada', '—'), bloqueos: cel('nada', '—'), esperaA: [], bloquea: [] },
      ],
      olas: [['acme/api#1'], ['acme/web#2']], ciclo: [],
    };
    c.accion = (n, d) => n === 'preflight.tarea' && String(d?.clave).toUpperCase() === 'QA-9' ? Promise.resolve(respuesta) : orig(n, d);
    window.__juego.set({ panel: 'preflight', panelData: { clave: 'QA-9' } });
  });
  ver(await hasta(async () => (await pg.$$('.pf-fila')).length === 3), 'tres filas: dos PR y la parte del plan sin empezar');
  const estados = await pg.$$eval('.pf-estado', e => e.map(x => x.textContent));
  ver(estados.join(' ') === '✗ ⚠ ✗', `estado por parte: CI roja ✗, la que espera ⚠ (no ✗), sin empezar ✗ (${estados.join(' ')})`);
  const vacias = await pg.$$eval('.pf-fila', fs => fs.map(f => [...f.querySelectorAll('td')].slice(-2).map(td => td.textContent).join('')));
  ver(vacias.every(v => v === '——'), 'compare y checklist en «—»');
  ver(/1.*api#1.*2.*web#2/.test(await pg.textContent('.orden-despliegue')), 'el orden de fusión: api#1 → web#2');
  await pg.screenshot({ path: path.join(dir, 'preflight-dos-repos.png') });
  await pg.keyboard.press('Escape');

  // ---- ⌘K
  await pg.keyboard.press('Meta+KeyK');
  await pg.waitForSelector('.buscador input');
  await pg.keyboard.type('qa-7');
  ver(await hasta(async () => (await pg.$$eval('.fila-buscador .txt', f => f.map(x => x.textContent))).includes('Pre-flight QA-7')), '⌘K ofrece «Pre-flight QA-7» (también la del worktree)');
  await pg.screenshot({ path: path.join(dir, 'preflight-buscador.png') });
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => (await pg.evaluate(() => [window.__juego.get().panel, window.__juego.get().panelData?.clave].join(' '))) === 'preflight QA-7'), 'y Enter lo abre');
  ver(!errores.length, 'sin errores en la página' + (errores.length ? ': ' + errores.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(salida.slice(-1500)); }
finally { await b.close(); servidor.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

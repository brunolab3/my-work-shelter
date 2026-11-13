// QA del pre-flight de una tarea (web/src/ui/Preflight.tsx), con un servidor propio en un refugio de pruebas y Playwright:
// - un repo de pruebas con el worktree de la tarea QA-7 (con un archivo sin commitear), admitido como sala: la acción
//   `preflight.tarea` de verdad (sin GitHub) da su parte sin PR, con «1 sin commitear» ⚠;
// - la ventana pintada con una tarea en dos repos (respuesta de ejemplo: PR con CI roja, otro que espera a ese, una
//   parte del plan sin empezar, hilos de revisión sin resolver): una fila por parte, ✓/⚠/✗ por columna, checklist en «—»,
//   el orden de fusión y los hilos (→ los despliega: archivo:línea, autor y primera línea; O abre el hilo);
// - fase 2: la comparación de la tarea de verdad (C) sale sin revisar; validada (V), la parte pasa a ✓ en compare; un
//   commit nuevo en el worktree la deja vieja (⚠);
// - fase 3: la lista «antes de subir» (guardada como en la cámara acorazada) sale en Checklist como 0/2 y la puerta de
//   git push (acción preflight.puerta, la del cliente de git) dice lo que falta;
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

  // ---- fase 3: la lista y la puerta
  await pg.evaluate(() => window.__client.accion('guardar', { parche: { checklistPreflight: ['Compare revisado', 'Pruebas con datos reales'] } }));
  ver(JSON.stringify(await pg.evaluate(() => window.__client.accion('preflight.checklist'))) === '["Compare revisado","Pruebas con datos reales"]', 'la lista guardada vuelve tal cual');
  const puerta = await pg.evaluate(w => window.__client.accion('preflight.puerta', { ruta: w }), wt);
  ver(puerta?.clave === 'QA-7' && puerta.falta.length === 2, `la puerta de push dice lo que falta (${puerta?.falta?.join(' | ')})`);
  ver(await pg.evaluate(() => window.__client.accion('preflight.puerta', { ruta: '/etc' }).then(() => false, () => true)), 'la puerta no mira carpetas que no son del refugio');

  // ---- la ventana con la tarea de verdad
  await pg.evaluate(() => window.__juego.set({ panel: 'preflight', panelData: { clave: 'QA-7' } }));
  ver(await hasta(() => pg.isVisible('.pf-tabla')), 'la ventana pinta la tabla');
  ver((await pg.$$('.pf-fila')).length === 1, 'una fila');
  ver(/0\/2/.test(await pg.$$eval('.pf-fila td', td => td.at(-1)?.textContent ?? '')), 'Checklist: 0/2 en este commit');
  const celdaCompare = () => pg.$$eval('.pf-fila td', td => td[2]?.textContent ?? '');
  ver(/sin compare/.test(await celdaCompare()), `sin compare aún: ✗ (${await celdaCompare()})`);
  // la de la tarea: C la hace (y la abre), V la valida
  await pg.keyboard.press('KeyC');
  ver(await hasta(async () => /sin revisar/.test(await celdaCompare()), 45000), `C hace el compare de la tarea: sin revisar (${await celdaCompare()})`);
  await pg.keyboard.press('KeyV');
  ver(await hasta(async () => /validada/.test(await celdaCompare())), `V lo valida: ✓ en este commit (${await celdaCompare()})`);
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-real.png') });
  sh(wt, 'add', '.'); sh(wt, 'commit', '-q', '-m', 'otro paso');
  await pg.keyboard.press('KeyR');
  ver(await hasta(async () => /HEAD/.test(await celdaCompare())), `un commit nuevo la deja vieja (${await celdaCompare()})`);
  await pg.keyboard.press('Escape');
  ver(await hasta(async () => (await pg.evaluate(() => window.__juego.get().panel)) === null), 'Esc la cierra');

  // ---- una tarea en dos repos (respuesta de ejemplo, el modelo de shared/preflight.ts)
  await pg.evaluate(() => {
    const c = window.__client, orig = c.accion.bind(c);
    const pr = (repo, numero, extra) => ({ numero, titulo: 'PR de ejemplo ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama: 'QA-9-parte-' + numero, estado: 'abierto', actualizado: 0, base: 'main', revision: 'REVIEW_REQUIRED', checks: 'SUCCESS', cabeza: 'c' + numero, ...extra });
    const api = pr('acme/api', 1, { checks: 'FAILURE' }), web = pr('acme/web', 2, { revision: 'APPROVED' });
    const cel = (marca, texto) => ({ marca, texto });
    const hilos = [{ archivo: 'src/carrito.ts', linea: 42, autor: 'revisora', texto: '¿Qué pasa si el cupón ha caducado?', url: api.url + '#discussion_r1', outdated: false }, { archivo: 'src/cupon.ts', linea: 7, autor: 'bot-revisor', texto: 'Falta una prueba', url: api.url + '#discussion_r2', outdated: true }];
    const respuesta = {
      clave: 'QA-9', color: '#4dabff', titulo: 'Carrito con cupones',
      partes: [
        { id: api.url, salaId: 'api', sala: 'api', repo: api.repo, rama: api.rama, pr: api, worktree: '/r/api', plan: 'Contrato', sync: cel('aviso', 'faltan commits remotos (¿un bot?)'), ci: cel('mal', 'roja'), revision: cel('aviso', 'esperando revisión · 💬 2 sin resolver'), bloqueos: cel('ok', 'bloquea a web#2'), checklist: cel('aviso', '1/2 en def5678'), compare: cel('aviso', 'es de abc1234; HEAD def5678'), compareArchivo: '/tmp/no.html', hilos, repoItems: ['npm run lint'], ciChecks: [{ nombre: 'build', estado: 'mal' }], esperaA: [], bloquea: [{ ref: web.url, url: web.url, estado: 'abierto', motivo: 'plan' }] },
        { id: web.url, salaId: 'web', sala: 'web', repo: web.repo, rama: web.rama, pr: web, worktree: '/r/web', sync: cel('ok', 'al día'), ci: cel('ok', 'verde'), revision: cel('ok', 'aprobado'), bloqueos: cel('aviso', 'espera a api#1 (abierto · su CI en rojo)'), checklist: cel('ok', '2/2 en c2c2c2c'), compare: cel('ok', 'validada en c2c2c2c'), hilos: [], repoItems: [], ciChecks: [], esperaA: [{ ref: 'acme/api#1', url: api.url, estado: 'abierto', checks: 'FAILURE', motivo: 'plan' }], bloquea: [] },
        { id: 'plan:docs', salaId: 'docs', sala: 'docs', plan: 'La guía', sinEmpezar: true, sync: cel('nada', '—'), ci: cel('nada', '—'), revision: cel('nada', '—'), bloqueos: cel('nada', '—'), checklist: cel('nada', '—'), compare: cel('nada', '—'), hilos: [], repoItems: [], ciChecks: [], esperaA: [], bloquea: [] },
      ],
      olas: [['acme/api#1'], ['acme/web#2']], ciclo: [], checklist: ['Compare revisado', 'Pruebas con datos reales'],
    };
    c.accion = (n, d) => n === 'preflight.tarea' && String(d?.clave).toUpperCase() === 'QA-9' ? Promise.resolve(respuesta) : orig(n, d);
    window.__juego.set({ panel: 'preflight', panelData: { clave: 'QA-9' } });
  });
  ver(await hasta(async () => (await pg.$$('.pf-fila')).length === 3), 'tres filas: dos PR y la parte del plan sin empezar');
  const estados = await pg.$$eval('.pf-estado', e => e.map(x => x.textContent));
  ver(estados.join(' ') === '✗ ⚠ ✗', `estado por parte: CI roja ✗, la que espera ⚠ (no ✗), sin empezar ✗ (${estados.join(' ')})`);
  ver(/2 hilos/.test(await pg.textContent('.pf-fila')), 'la revisión de api lleva «2 hilos»');
  await pg.keyboard.press('ArrowRight');
  ver(await hasta(async () => (await pg.$$('.pf-hilo')).length === 2), '→ despliega sus dos hilos');
  const hilo = await pg.textContent('.pf-hilo');
  ver(/src\/carrito\.ts:42/.test(hilo) && /revisora/.test(hilo) && /caducado/.test(hilo), `cada hilo con archivo:línea, autor y primera línea (${hilo.trim()})`);
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-hilos.png') });
  await pg.keyboard.press('ArrowDown');
  ver(await pg.$eval('.pf-hilo', e => e.classList.contains('sel')), '↓ elige el primer hilo (O lo abriría en GitHub)');
  await pg.keyboard.press('ArrowLeft');
  ver(await hasta(async () => (await pg.$$('.pf-hilo')).length === 0), '← los recoge');
  ver(/1.*api#1.*2.*web#2/.test(await pg.textContent('.orden-despliegue')), 'el orden de fusión: api#1 → web#2');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-dos-repos.png') });
  await pg.keyboard.press('Escape');

  // ---- ⌘K
  await pg.keyboard.press('Meta+KeyK');
  await pg.waitForSelector('.buscador input');
  await pg.keyboard.type('qa-7');
  ver(await hasta(async () => (await pg.$$eval('.fila-buscador .txt', f => f.map(x => x.textContent))).includes('Pre-flight QA-7')), '⌘K ofrece «Pre-flight QA-7» (también la del worktree)');
  await pg.waitForTimeout(600); await pg.screenshot({ path: path.join(dir, 'preflight-buscador.png') });
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => (await pg.evaluate(() => [window.__juego.get().panel, window.__juego.get().panelData?.clave].join(' '))) === 'preflight QA-7'), 'y Enter lo abre');
  ver(!errores.length, 'sin errores en la página' + (errores.length ? ': ' + errores.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(salida.slice(-1500)); }
finally { await b.close(); servidor.kill('SIGKILL'); }
console.log(failures ? `${failures} fallos` : 'todo bien');
process.exit(failures ? 1 : 0);

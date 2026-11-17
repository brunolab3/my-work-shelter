// QA of the Jira epics, with an own server on a test shelter and Playwright (Jira in DEMO: its tasks carry two epics):
// - the Planning board groups each column by epic, a header with the epic's diamond, key and summary, tasks without one
//   last under «No epic»; each card of an epic has the diamond in the epic's color (its own, saved by the server), with
//   the epic in its tooltip; the others have none;
// - a holographic copy working REF-236 (epic REF-200): its tag has the diamond, the tag of a copy without an epic doesn't;
// - its intercom: the tab has the diamond, and the bar's ⋯ N list beside the task's marker.
// Needs the built client (npx vite build). Usage: node scripts/qa-epics.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3797)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PUERTO = Number(process.env.SHELTER_PUERTO_QA || 3797);
const DATOS = mkdtempSync(path.join(os.tmpdir(), 'ws-epicas-'));
process.env.SHELTER_DATOS = DATOS;
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const repo = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ws-epicas-repos-'))), 'tienda');
mkdirSync(repo); execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env: ENV });
writeFileSync(path.join(repo, 'README'), 'tienda'); execFileSync('git', ['-C', repo, 'add', '.'], { env: ENV }); execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'inicio'], { env: ENV });

const servidor = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: RAIZ, env: { ...process.env, SHELTER_DATOS: DATOS, SHELTER_PUERTO: String(PUERTO), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let salida = ''; servidor.stdout.on('data', d => { salida += d; }); servidor.stderr.on('data', d => { salida += d; });
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PUERTO}/salud`).then(() => true, () => false)); i++) await dormir(250);

const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errores = [];
  pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(withToken(`http://127.0.0.1:${PUERTO}`), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async r => { await window.__ready(); await window.__client.accion('reclutar', { ruta: r }); await window.__client.accion('integracion.modo', { fuente: 'jira', modo: 'demo' }); await window.__client.accion('guardar', { parche: { doneWelcome: true } }); window.__juego.set({ panel: null, panelData: null }); }, repo);
  const hasta = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

  // ---- the board
  await pg.evaluate(() => window.__juego.set({ panel: 'logistica', panelData: { vista: 'jira' } }));
  ver(await hasta(async () => (await pg.$$('.ficha-issue')).length >= 5), 'the Jira board shows the demo tasks');
  const tablero = await pg.evaluate(() => [...document.querySelectorAll('.kanban-col')].map(c => ({
    col: c.querySelector('h3').firstChild.textContent.trim(),
    filas: [...c.querySelectorAll('.kanban-epica, .ficha-issue')].map(el => el.classList.contains('kanban-epica')
      ? { cabecera: el.textContent.trim(), color: el.querySelector('.marca-epica') && getComputedStyle(el.querySelector('.marca-epica')).backgroundColor }
      : { clave: el.querySelector('.ident').textContent, epica: el.querySelector('.marca-epica')?.title ?? null, color: el.querySelector('.marca-epica') && getComputedStyle(el.querySelector('.marca-epica')).backgroundColor, tarea: getComputedStyle(el).borderLeftColor }),
  })));
  console.log(JSON.stringify(tablero, null, 1));
  const revision = tablero.find(c => /revisi|review/i.test(c.col))?.filas ?? [];
  ver(revision.length === 4 && /REF-200/.test(revision[0].cabecera) && revision[1].clave === 'REF-236' && /REF-200.*Red fiable/.test(revision[1].epica) && /no epic|sin épica/i.test(revision[2].cabecera ?? '') && revision[3].clave === 'REF-240' && !revision[3].epica,
    'In review: header REF-200 with REF-236 (diamond, tooltip), then «No epic»');
  const porHacer = tablero.find(c => /hacer|to do/i.test(c.col))?.filas ?? [];
  ver(/REF-200/.test(porHacer[0]?.cabecera ?? '') && porHacer[1]?.clave === 'REF-231' && /no epic|sin épica/i.test(porHacer[2]?.cabecera ?? '') && porHacer[3]?.clave === 'REF-244', 'To do: the epic group first, tasks without one last');
  const conEpica = tablero.flatMap(c => c.filas).filter(f => f.clave && f.epica);
  ver(conEpica.length >= 3 && new Set(tablero.flatMap(c => c.filas).filter(f => f.epica && /REF-200/.test(f.epica)).map(f => f.color)).size === 1, 'every card of an epic has its diamond, in one color per epic');
  const colores = await pg.evaluate(() => window.__client.accion('tareas.colores', { claves: ['REF-200', 'REF-210'] }));
  ver(colores['REF-200'] && colores['REF-210'] && colores['REF-200'] !== colores['REF-210'], `each epic has its own saved color (${JSON.stringify(colores)})`);
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'epicas-tablero.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => window.__juego.set({ panel: null, panelData: null }));

  // ---- a copy working REF-236 and one without an epic, in the recruited room
  const s = await pg.evaluate(r => window.__refugio.salas.find(x => x.ruta === r)?.id, repo);
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: id } })), s);
  await pg.waitForTimeout(3000);
  await pg.evaluate(([s, r]) => {
    const h = window.__refugio.habitantes.find(x => x.sala.id === s), ahora = Date.now();
    const una = (id, wt, titulo) => ({ id, dwellerId: h.id.id, salaId: s, cwd: r + '/.claude/worktrees/' + wt, estado: 'trabajando', actividad: { modo: 'escribir', texto: 'editing src/app.ts' }, sinLeer: false, titulo, pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, created: ahora, actualizada: ahora });
    window.__live.set(e => ({ sesiones: { ...e.sesiones, qa_epica: una('qa_epica', 'shelter-REF-236', 'Persistent sessions'), qa_sin: una('qa_sin', 'shelter-REF-244', 'Terminal tools') } }));
  }, [s, repo]);
  const idA = 'holo:' + repo + '/.claude/worktrees/shelter-REF-236';
  ver(await hasta(() => pg.evaluate(id => !!window.__refugio.hologramas.ofId(id)?.listo, idA), 30000), 'the copies materialise');
  await pg.waitForTimeout(1500);
  const etiquetas = await pg.evaluate(() => [...document.querySelectorAll('.etiqueta.con-tarea')].map(e => ({ nombre: e.textContent, epica: getComputedStyle(e.querySelector('.marca-epica')).display !== 'none' ? e.querySelector('.marca-epica').title : null })));
  console.log(JSON.stringify(etiquetas));
  ver(etiquetas.some(e => /REF-236|Sesiones/.test(e.nombre) && /REF-200/.test(e.epica ?? '')) && etiquetas.some(e => /REF-244|terminal/i.test(e.nombre) && !e.epica), 'the REF-236 copy\'s tag has the epic diamond; REF-244\'s has none');
  const caja = await pg.evaluate(() => { const e = [...document.querySelectorAll('.etiqueta.con-tarea')].find(x => x.querySelector('.marca-epica').style.display !== 'none'); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 140), y: Math.max(0, r.y - 60), width: r.width + 280, height: r.height + 180 }; });
  await pg.screenshot({ path: path.join(dir, 'epicas-holograma.png'), clip: caja });
  await pg.screenshot({ path: path.join(dir, 'epicas-sala.png') });

  // ---- its intercom: tab and ⋯ N list
  await pg.evaluate(id => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { dwellerId: id, talk: true } })), idA);
  ver(await hasta(async () => !!(await pg.$('.vt-pestana .marca-epica'))), 'the tab of the REF-236 conversation has the diamond');
  ver(/REF-200/.test(await pg.getAttribute('.vt-pestana .marca-epica', 'title').catch(() => '')), 'its tooltip names the epic');
  await pg.waitForTimeout(400); await pg.screenshot({ path: path.join(dir, 'epicas-pestana.png') });
  await pg.click('.vt-todas');
  ver(await hasta(async () => /REF-200/.test(await pg.getAttribute('.vt-lista-fila .vt-lista-tarea .marca-epica', 'title').catch(() => '') ?? '')), 'the ⋯ N list has the diamond beside the task\'s marker');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'epicas-lista.png') });
  await pg.keyboard.press('Escape');
  ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
} catch (e) { failures++; console.error(e); console.log(salida.slice(-1500)); }
finally { await b.close(); servidor.kill('SIGKILL'); }
console.log(failures ? `${failures} failures` : 'all good');
process.exit(failures ? 1 : 0);

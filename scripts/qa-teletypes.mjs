// QA of the teletypes (top-left notices): a new one shows on its own and then folds into one "earlier notices" slot
// with the most severe level's color; questions never fold; clicking the slot unfolds them, clicking one dismisses it,
// "read all" dismisses them all; the same in the maximized-window row layout. Notices are injected into the page store
// (no server action, no Claude sessions).
// Usage: node scripts/qa-teletypes.mjs [url] [screenshots-dir]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', dir = '/tmp/qa-teletipos-capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errores = [];
pg.on('pageerror', e => errores.push(e.message));
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const sueltos = () => pg.evaluate(() => [...document.querySelectorAll('.teletipos > .teletipo')].map(e => e.textContent));
const grupo = () => pg.evaluate(() => { const g = document.querySelector('.teletipo.grupo'); return g && { texto: g.textContent, clase: g.className, lista: [...document.querySelectorAll('.teletipos-grupo .lista .teletipo')].map(e => e.textContent) }; });
// `edad`: how long ago it arrived (the id is the arrival time)
const poner = lista => pg.evaluate(lista => window.__live.set(v => ({ avisos: [...v.avisos, ...lista.map(([nivel, texto, edad = 0, pregunta]) => ({ id: Date.now() - edad + Math.random(), nivel, texto, pregunta }))] })), lista);

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); window.__live.set({ avisos: [] }); });

// ---- old ones fold, new ones and questions stay on their own
await poner([['info', 'Repo fever2 synced', 60000], ['aviso', 'Jira token expires in 3 days', 50000], ['info', 'Slack reconnected', 40000], ['info', 'Spotify paused', 30000],
  ['info', 'Room puente: question', 20000, { id: 'q1', si: 'Yes', no: 'No' }], ['info', 'Calendar refreshed', 0]]);
await espera(300);
let g = await grupo();
ver(g && /4/.test(g.texto) && g.lista.length === 0, `the 4 old ones fold into one slot (${g?.texto})`);
ver(g && / aviso/.test(g.clase), 'the slot takes the most severe level\'s color (aviso)');
let s = await sueltos();
ver(s.some(x => /question/.test(x)) && s.some(x => /Calendar/.test(x)) && s.length === 2, 'the question and the new one stay on their own: ' + s.length);
await pg.screenshot({ path: `${dir}/1-plegados.png`, clip: { x: 0, y: 0, width: 700, height: 360 } });
// the new one folds by itself after its few seconds
await espera(5500);
g = await grupo();
ver(g && /5/.test(g.texto) && (await sueltos()).length === 1, `after 5 s the new one folds too (${g?.texto}); the question doesn't`);
await poner([['error', 'Server restarted: reopen the conversation', 30000]]);
await espera(200);
ver(/ error/.test((await grupo()).clase), 'an old error turns the slot red');

// ---- unfold, dismiss one, read all
await pg.click('.teletipo.grupo'); await espera(300);
g = await grupo();
ver(g.lista.length === 6 && /▾/.test(g.texto), `clicking the slot unfolds the 6 (${g.lista.length})`);
await pg.screenshot({ path: `${dir}/2-desplegados.png`, clip: { x: 0, y: 0, width: 700, height: 560 } });
await pg.click('.teletipos-grupo .lista .teletipo >> text=Slack reconnected'); await espera(200);
g = await grupo();
ver(g.lista.length === 5 && !g.lista.some(x => /Slack/.test(x)), 'clicking one dismisses just that one');
ver(await pg.evaluate(() => !window.__live.get().avisos.some(a => /Slack/.test(a.texto))), 'and it leaves the store (doesn\'t come back)');
// maximized row layout: open a terminal-like maximized window by class and check the slot unfolds below
await pg.evaluate(() => { const d = document.createElement('div'); d.className = 'maximizada qa-falsa'; d.style.display = 'none'; document.getElementById('ui').appendChild(d); });
await espera(200);
const caja = await pg.evaluate(() => { const r = document.querySelector('.teletipos').getBoundingClientRect(), l = document.querySelector('.teletipos-grupo .lista').getBoundingClientRect(), q = document.querySelector('.teletipos > .teletipo.pregunta').getBoundingClientRect(); return { fila: r.left > 300, listaDebajo: l.top > 10, preguntaAlLado: q.left > l.left && q.top < l.top }; });
ver(caja.fila && caja.listaDebajo && caja.preguntaAlLado, 'maximized: one row, the unfolded list drops below the slot, the question beside it ' + JSON.stringify(caja));
await pg.screenshot({ path: `${dir}/3-ampliada.png`, clip: { x: 300, y: 0, width: 1300, height: 360 } });
await pg.evaluate(() => document.querySelector('.qa-falsa').remove());
await pg.click('.teletipo.grupo .leer-todos'); await espera(300);
ver(!(await grupo()) && (await sueltos()).length === 1, '"read all" dismisses them all; the question stays');
await pg.click('.teletipo.pregunta button >> nth=0').catch(() => {}); await espera(200);
ver((await sueltos()).length === 0, 'answering the question removes it');
await pg.screenshot({ path: `${dir}/4-leidos.png`, clip: { x: 0, y: 0, width: 700, height: 360 } });

ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
await b.close();
console.log(failures ? `${failures} failures` : 'all OK');
process.exit(failures ? 1 : 0);

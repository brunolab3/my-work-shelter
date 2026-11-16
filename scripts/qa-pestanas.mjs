// QA of many tabs, with no Claude sessions (made-up conversations in the client): 16 conversations of one dweller in
// several states plus 3 of another dweller of the same room. Checks that tabs stay readable and the strip scrolls,
// most urgent first, the active tab does not move when its state changes, ⌘1/⌘9 follow the visible order, the ⋯ list
// (⌘⇧A) filters, goes and closes, the other dweller's conversations stay out of the strip and the selector above the
// portrait lists the room's talkers (bust, state, title and count of their most urgent conversation), keeps its width and switches the
// intercom, by click or keyboard, the bar has one intercom chip per room whose hover lists one row per
// open panel (dweller, holograms), and a terminal with 13 more tabs.
// Usage: SHELTER_DATOS=… node scripts/qa-pestanas.mjs [url] [screenshots-folder]   (best on a test shelter)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errores = [];
pg.on('pageerror', e => errores.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); });
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const hasta = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await espera(200); } return false; };
const pestanas = () => pg.evaluate(() => [...document.querySelectorAll('.consola .vt-pestana')].map(p => ({ nombre: p.querySelector('.vt-pestana-nombre').textContent, estado: (p.className.match(/e-(\w+)/) ?? [])[1], activa: p.classList.contains('activa'), ancho: p.getBoundingClientRect().width })));
const talking = () => pg.evaluate(() => window.__juego.get().talkingWith);
const setLive = (id, extra) => pg.evaluate(([id, extra]) => window.__live.set(e => ({ sesiones: { ...e.sesiones, [id]: { ...e.sesiones[id], ...extra } } })), [id, extra]);

// two dwellers of a room with a folder (the selector shows when the room has more than one talker)
const [h, h2] = await pg.evaluate(() => { const hs = window.__juego.get().habitantes.filter(h => h.ruta && h.sala !== 'puente' && !h.robot); const a = hs.find(x => hs.some(y => y !== x && y.sala === x.sala)) ?? hs[0]; return [a, hs.find(x => x !== a && x.sala === a.sala)]; });
console.log('Dwellers:', h.nombre, '·', h.nameRoom, '|', h2?.nombre, '·', h2?.nameRoom);
const TITULOS = ['Fix flaky checkout test', 'Review PR 4123 billing', 'Investigate Sentry 9981', 'Refactor auth middleware', 'Add retries to webhooks', 'Upgrade Angular to 21', 'Explain the pricing service', 'Draft migration for orders', 'Plan the B2B import', 'Pre-push checks', 'Why is CI red on main', 'Rename partner fields', 'Lint the whole repo', 'Port script to Python', 'Answer reviewer comments', 'Clean old worktrees'];
const ESTADOS = ['ociosa', 'trabajando', 'terminada', 'ociosa', 'esperando', 'trabajando', 'ociosa', 'terminada', 'trabajando', 'ociosa', 'error', 'ociosa', 'trabajando', 'terminada', 'ociosa', 'esperando'];
await pg.evaluate(([h, h2, T, E]) => {
  const sesiones = {}, ahora = Date.now();
  const una = (id, d, titulo, estado, i, cwd) => { sesiones[id] = { id, dwellerId: d.id, salaId: d.sala, cwd, estado, sinLeer: estado === 'terminada' && i % 3 !== 1, titulo, pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, created: ahora - (40 - i) * 60000, actualizada: ahora - (40 - i) * 90000 }; };
  T.forEach((titulo, i) => una('qa-tab-' + i, h, titulo, E[i], i, h.ruta));
  if (h2) ['Deploy notes', 'Bump SDK', 'Flaky e2e'].forEach((titulo, i) => una('qa-tab-b' + i, h2, titulo, ['ociosa', 'esperando', 'trabajando'][i], i, h2.ruta));
  window.__live.set(e => ({ sesiones: { ...e.sesiones, ...sesiones } }));
}, [h, h2, TITULOS, ESTADOS]);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: h.sala, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.consola .vt-pestana');
await hasta(async () => (await pestanas()).length >= 16);
await espera(600);

// ---- readable and scrolling
const ps = await pestanas();
const AJENAS = ['Deploy notes', 'Bump SDK', 'Flaky e2e'];
ver(ps.length >= 16 && !ps.some(p => AJENAS.includes(p.nombre)), `the strip has this dweller's conversations only (${ps.length})`);
ver(ps.every(p => p.ancho >= 80), 'no tab is squeezed below its minimum width: ' + Math.round(Math.min(...ps.map(p => p.ancho))) + 'px');
ver(await pg.evaluate(() => { const c = document.querySelector('.consola .vt-pestanas-tira'); return c.scrollWidth > c.clientWidth; }), 'the strip scrolls sideways');
const enVista = () => pg.evaluate(() => { const c = document.querySelector('.consola .vt-pestanas-tira').getBoundingClientRect(), a = document.querySelector('.consola .vt-pestana.activa').getBoundingClientRect(); return a.left >= c.left - 1 && a.right <= c.right + 1; });
ver(await enVista(), 'the active tab is in view');
await pg.screenshot({ path: `${dir}/qa-pestanas-intercom.png` });

// ---- order: most urgent first
const rango = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };
const sinActiva = (await pestanas()).filter(p => !p.activa).map(p => rango[p.estado] ?? 5);
ver(sinActiva.every((r, i) => !i || sinActiva[i - 1] <= r), 'waiting → unread → failed → working → idle: ' + (await pestanas()).map(p => p.estado).join(' '));

// ---- ⌘1 / ⌘9 follow the visible order; the active tab does not move under you
await pg.keyboard.press('Meta+9'); await espera(400);
let l = await pestanas();
ver(l.at(-1).activa, '⌘9 goes to the last visible tab');
await pg.keyboard.press('Meta+1'); await espera(400);
l = await pestanas();
ver(l[0].activa && await enVista(), '⌘1 goes to the first visible tab, and the strip scrolls to it: ' + l[0].nombre);
// pick an idle tab, then make it the most urgent: it stays where it is until you switch away
const idle = (await pestanas()).findLast(p => p.estado === 'ociosa');
await pg.evaluate(n => [...document.querySelectorAll('.consola .vt-pestana')].find(p => p.querySelector('.vt-pestana-nombre').textContent === n).click(), idle.nombre); await espera(400);
const antes = (await pestanas()).findIndex(p => p.activa);
await setLive('qa-tab-' + TITULOS.indexOf(idle.nombre), { estado: 'esperando' }); await espera(400);
ver((await pestanas()).findIndex(p => p.activa) === antes, 'the active tab keeps its place when its state changes');
await pg.keyboard.press('Meta+1'); await espera(400);
ver((await pestanas()).findIndex(p => p.nombre === idle.nombre) < antes, 'once you switch away it moves up with the waiting ones');

// ---- the ⋯ list
await pg.keyboard.press('Meta+Shift+a'); await espera(400);
ver(await pg.isVisible('.consola .vt-lista'), '⌘⇧A opens the list of every tab');
const filas = () => pg.evaluate(() => document.querySelectorAll('.consola .vt-lista-fila').length);
ver(await filas() === (await pestanas()).length, 'with one row per tab');
await pg.screenshot({ path: `${dir}/qa-pestanas-lista.png` });
const conThe = TITULOS.filter(x => /the/i.test(x));
await pg.keyboard.type('the', { delay: 10 }); await espera(300);
ver(await filas() === conThe.length, `typing filters: ${await filas()} of ${conThe.length}`);
await pg.screenshot({ path: `${dir}/qa-pestanas-filtro.png` });
await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await espera(400);
const elegida = await pg.evaluate(() => document.querySelector('.consola .vt-pestana.activa .vt-pestana-nombre').textContent);
ver(!(await pg.isVisible('.consola .vt-lista')) && conThe.includes(elegida), '↓ Enter goes to a match and closes the list: ' + elegida);
// close every idle one: none is running, so no question
const ociosas = (await pestanas()).filter(p => p.estado === 'ociosa').length;
const total = (await pestanas()).length;
await pg.keyboard.press('Meta+Shift+a'); await espera(300);
await pg.click('.consola .vt-lista-pie button:has-text("idle"), .consola .vt-lista-pie button:has-text("reposo")'); await espera(500);
ver(!(await pg.isVisible('.consola .vt-confirmar')) && (await pestanas()).length === total - ociosas, `«close read or idle» closes the ${ociosas} idle ones without asking`);
if (!(await pg.isVisible('.consola .vt-lista'))) { await pg.keyboard.press('Meta+Shift+a'); await espera(300); }
await pg.focus('.consola .vt-lista-filtro'); await pg.keyboard.press('Escape'); await espera(300);
ver(!(await pg.isVisible('.consola .vt-lista')) && await pg.isVisible('.consola'), 'Esc closes the list and only the list');

// ---- the selector above the portrait: the room's talkers, with their most urgent conversation; it switches
const filasQuien = () => pg.evaluate(() => [...document.querySelectorAll('.consola .consola-quien-lista .barra-asomo-fila')].map(f => ({ texto: f.querySelector('.barra-asomo-titulo').textContent, estado: f.querySelector('.barra-asomo-estado').textContent, n: f.querySelector('small').textContent, actual: f.classList.contains('actual') })));
if (h2) {
  await pg.click('.consola .consola-quien > .chip-terminal'); await espera(300);
  const fq = await filasQuien();
  const de2 = fq.find(f => f.texto.startsWith(h2.nombre));
  ver(fq.find(f => f.actual)?.texto.startsWith(h.nombre) && de2?.texto.includes('Bump SDK') && de2?.n === '3', `the list has the room's talkers, ${h2.nombre} with their waiting conversation and 3 open: ` + JSON.stringify(de2));
  ver(await hasta(() => pg.evaluate(() => [...document.querySelectorAll('.consola .consola-quien-lista .barra-asomo-fila')].every(f => f.querySelector('.consola-quien-foto img')))), 'each talker in the list has its bust');
  const anchoQuien = () => pg.evaluate(() => Math.round(document.querySelector('.consola .consola-quien > .chip-terminal').getBoundingClientRect().width));
  const ancho1 = await anchoQuien();
  await pg.screenshot({ path: `${dir}/qa-pestanas-selector.png` });
  await pg.keyboard.press('Escape'); await espera(200);
  ver(!(await pg.isVisible('.consola .consola-quien-lista')) && await pg.isVisible('.consola'), 'Esc closes the list and only the list');
  await pg.click('.consola .consola-quien > .chip-terminal'); await espera(200);
  await pg.evaluate(n => [...document.querySelectorAll('.consola .consola-quien-lista .barra-asomo-fila')].find(f => f.querySelector('.barra-asomo-titulo').textContent.startsWith(n)).click(), h2.nombre);
  ver(await hasta(async () => await talking() === h2.id), 'picking one switches the intercom to ' + h2.nombre);
  ver((await pestanas()).every(p => AJENAS.includes(p.nombre)), 'whose strip holds only their conversations');
  ver(await anchoQuien() === ancho1, `the selector keeps its width whoever it names: ${ancho1}px`);
  // by keyboard: ↓ until the original dweller, Enter
  await pg.click('.consola .consola-quien > .chip-terminal'); await espera(200);
  const fq2 = await filasQuien(), idx = fq2.findIndex(f => f.texto.startsWith(h.nombre)), cur = fq2.findIndex(f => f.actual);
  for (let k = 0; k < (idx - cur + fq2.length) % fq2.length; k++) await pg.keyboard.press('ArrowDown');
  await pg.keyboard.press('Enter');
  ver(await hasta(async () => await talking() === h.id), 'and back with ↓ and Enter to ' + h.nombre);
} else console.log('--   (no room with two dwellers: no selector)');

// ---- the bar: one intercom chip per room; hovering it lists one row per open panel (dweller, holograms), as the selector
await pg.keyboard.press('Meta+ArrowDown'); await espera(400);
const salasCom = await pg.evaluate(() => [...document.querySelectorAll('.barra-ventanas .com .chip-terminal .tipo')].map(x => x.textContent));
ver(salasCom.length === new Set(salasCom).size && salasCom.includes(h.nameRoom), 'the bar has one intercom chip per room: ' + salasCom.join(', '));
const chip = pg.locator('.barra-ventanas .com .chip-terminal', { has: pg.locator('.tipo', { hasText: h.nameRoom }) }).first();
await chip.hover(); await espera(300);
const asomo = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo .barra-asomo-titulo b')].map(x => x.textContent));
if (h2) ver(asomo.length === new Set(asomo).size && asomo.some(n => n.startsWith(h.nombre)) && asomo.some(n => n.startsWith(h2.nombre)), `hovering ${h.nameRoom}'s chip lists one row per panel: ` + asomo.join(', '));
await pg.screenshot({ path: `${dir}/qa-pestanas-barra.png` });
if (h2 && asomo.length) {
  await pg.evaluate(n => [...document.querySelectorAll('.barra-asomo .barra-asomo-fila')].find(f => f.querySelector('b').textContent.startsWith(n)).click(), h2.nombre);
  ver(await hasta(async () => await talking() === h2.id), 'clicking one opens that panel: ' + h2.nombre);
  await pg.keyboard.press('Meta+ArrowDown'); await espera(400);
}

// ---- a terminal with many tabs
await pg.evaluate(s => window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { salaId: s } })), h.sala);
await pg.waitForSelector('.ventana-terminal .vt-pestana'); await espera(800);
const n0 = await pg.evaluate(() => document.querySelectorAll('.ventana-terminal .vt-pestana').length);   // its tabs outlive the page
for (let i = 0; i < 13; i++) { await pg.keyboard.press('Meta+t'); await espera(250); }
await espera(800);
const term = await pg.evaluate(() => { const c = document.querySelector('.ventana-terminal .vt-pestanas-tira'); return { n: c.querySelectorAll('.vt-pestana').length, scroll: c.scrollWidth > c.clientWidth }; });
ver(term.n === n0 + 13 && term.scroll, `a terminal with ${term.n} tabs scrolls too`);
await pg.keyboard.press('Meta+Shift+a'); await espera(300);
ver(await pg.evaluate(() => document.querySelectorAll('.ventana-terminal .vt-lista-fila').length) === term.n, '⌘⇧A lists the terminal\'s tabs');
await pg.screenshot({ path: `${dir}/qa-pestanas-terminal.png` });
await pg.keyboard.press('Escape'); await espera(200);
await pg.keyboard.press('Meta+Shift+w'); await espera(400);
if (await pg.isVisible('.ventana-terminal .vt-confirmar')) await pg.keyboard.press('Enter');
await espera(600);
ver(!(await pg.isVisible('.ventana-terminal')), 'and ⌘⇧W closes it with all its tabs');

ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

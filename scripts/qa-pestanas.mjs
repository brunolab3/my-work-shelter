// QA of many tabs, with no Claude sessions (made-up conversations in the client): 16 conversations of one dweller in
// several states and tasks plus 3 of a dweller in another room. Checks that tabs stay readable and the strip scrolls,
// most urgent first, the active tab does not move when its state changes, ⌘1/⌘9 follow the visible order, the ⋯ list
// (⌘⇧A) filters, goes and closes, «group by room» puts each room under its header, picking another dweller's tab
// switches the intercom, the dweller/hologram selector, hovering a bar chip lists its conversations, and a terminal
// with 13 more tabs.
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
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); localStorage.setItem('refugio.pestanas.agrupar', '1'); });
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const hasta = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await espera(200); } return false; };
const pestanas = () => pg.evaluate(() => [...document.querySelectorAll('.consola .vt-pestana')].map(p => ({ nombre: p.querySelector('.vt-pestana-nombre').textContent, estado: (p.className.match(/e-(\w+)/) ?? [])[1], activa: p.classList.contains('activa'), ancho: p.getBoundingClientRect().width })));
const talking = () => pg.evaluate(() => window.__juego.get().talkingWith);
const setLive = (id, extra) => pg.evaluate(([id, extra]) => window.__live.set(e => ({ sesiones: { ...e.sesiones, [id]: { ...e.sesiones[id], ...extra } } })), [id, extra]);

// two dwellers with a folder, in different rooms
const [h, h2] = await pg.evaluate(() => { const hs = window.__juego.get().habitantes.filter(h => h.ruta && h.sala !== 'puente' && !h.robot); const a = hs[0]; return [a, hs.find(x => x.sala !== a.sala)]; });
console.log('Dwellers:', h.nombre, '·', h.nameRoom, '|', h2?.nombre, '·', h2?.nameRoom);
const TITULOS = ['Fix flaky checkout test', 'Review PR 4123 billing', 'Investigate Sentry 9981', 'Refactor auth middleware', 'Add retries to webhooks', 'Upgrade Angular to 21', 'Explain the pricing service', 'Draft migration for orders', 'Plan the B2B import', 'Pre-push checks', 'Why is CI red on main', 'Rename partner fields', 'Lint the whole repo', 'Port script to Python', 'Answer reviewer comments', 'Clean old worktrees'];
const ESTADOS = ['ociosa', 'trabajando', 'terminada', 'ociosa', 'esperando', 'trabajando', 'ociosa', 'terminada', 'trabajando', 'ociosa', 'error', 'ociosa', 'trabajando', 'terminada', 'ociosa', 'esperando'];
await pg.evaluate(([h, h2, T, E]) => {
  const sesiones = {}, ahora = Date.now();
  const una = (id, d, titulo, estado, i, cwd) => { sesiones[id] = { id, dwellerId: d.id, salaId: d.sala, cwd, estado, sinLeer: estado === 'terminada' && i % 3 !== 1, titulo, pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, created: ahora - (40 - i) * 60000, actualizada: ahora - (40 - i) * 90000 }; };
  // some of them inside a task's worktree (no hologram): they keep its color and key
  T.forEach((titulo, i) => una('qa-tab-' + i, h, titulo, E[i], i, i % 4 === 1 ? h.ruta + '/.claude/worktrees/shelter-QA-1-tabs' : i % 4 === 2 ? h.ruta + '/.claude/worktrees/shelter-QA-2-lists' : h.ruta));
  if (h2) ['Deploy notes', 'Bump SDK', 'Flaky e2e'].forEach((titulo, i) => una('qa-tab-b' + i, h2, titulo, ['ociosa', 'esperando', 'trabajando'][i], i, h2.ruta));
  window.__live.set(e => ({ sesiones: { ...e.sesiones, ...sesiones } }));
}, [h, h2, TITULOS, ESTADOS]);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: h.sala, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.consola .vt-pestana');
await hasta(async () => (await pestanas()).length >= 16 + (h2 ? 3 : 0));
await espera(600);

// ---- readable and scrolling
const ps = await pestanas();
ver(ps.length >= 16 + (h2 ? 3 : 0), `the strip has every open conversation of every intercom (${ps.length})`);
ver(ps.every(p => p.ancho >= 80), 'no tab is squeezed below its minimum width: ' + Math.round(Math.min(...ps.map(p => p.ancho))) + 'px');
ver(await pg.evaluate(() => { const c = document.querySelector('.consola .vt-pestanas-tira'); return c.scrollWidth > c.clientWidth; }), 'the strip scrolls sideways');
const enVista = () => pg.evaluate(() => { const c = document.querySelector('.consola .vt-pestanas-tira').getBoundingClientRect(), a = document.querySelector('.consola .vt-pestana.activa').getBoundingClientRect(); return a.left >= c.left - 1 && a.right <= c.right + 1; });
ver(await enVista(), 'the active tab is in view');
await pg.screenshot({ path: `${dir}/qa-pestanas-intercom.png` });

// ---- order: by room, then most urgent first
const grupos = await pg.evaluate(() => [...document.querySelectorAll('.consola .vt-grupo')].map(g => g.textContent));
ver(!h2 || (grupos.length === 2 && grupos.includes(h.nameRoom) && grupos.includes(h2.nameRoom)), 'one header per room: ' + grupos.join(', '));
const rango = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };
const deH = (await pestanas()).filter(p => !['Deploy notes', 'Bump SDK', 'Flaky e2e'].includes(p.nombre));
const sinActiva = deH.filter(p => !p.activa).map(p => rango[p.estado] ?? 5);
ver(sinActiva.every((r, i) => !i || sinActiva[i - 1] <= r), 'within a room: waiting → unread → failed → working → idle: ' + deH.map(p => p.estado).join(' '));

// ---- ⌘1 / ⌘9 follow the visible order; the active tab does not move under you
await pg.keyboard.press('Meta+9'); await espera(400);
let l = await pestanas();
ver(l.at(-1).activa, '⌘9 goes to the last visible tab');
await pg.keyboard.press('Meta+1'); await espera(400);
l = await pestanas();
ver(l[0].activa && await enVista(), '⌘1 goes to the first visible tab, and the strip scrolls to it: ' + l[0].nombre);
if (l[0].activa && h2 && grupos[0] === h2.nameRoom) ver(await talking() === h2.id, '…which belongs to the other dweller: the intercom switches to ' + h2.nombre);
// pick an idle tab of h, then make it the most urgent: it stays where it is until you switch away
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: h.sala, dwellerId: h.id, talk: true } })), h);
await hasta(async () => await talking() === h.id);
const idle = (await pestanas()).findLast(p => p.estado === 'ociosa' && !['Deploy notes', 'Bump SDK', 'Flaky e2e'].includes(p.nombre));
await pg.evaluate(n => [...document.querySelectorAll('.consola .vt-pestana')].find(p => p.querySelector('.vt-pestana-nombre').textContent === n).click(), idle.nombre); await espera(400);
const antes = (await pestanas()).findIndex(p => p.activa);
await setLive('qa-tab-' + TITULOS.indexOf(idle.nombre), { estado: 'esperando' }); await espera(400);
ver((await pestanas()).findIndex(p => p.activa) === antes, 'the active tab keeps its place when its state changes');
await pg.keyboard.press('Meta+1'); await espera(400);
if (await talking() !== h.id) { await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: h.sala, dwellerId: h.id, talk: true } })), h); await hasta(async () => await talking() === h.id); }
ver((await pestanas()).findIndex(p => p.nombre === idle.nombre) < antes, 'once you switch away it moves up with the waiting ones');

// ---- the ⋯ list
await pg.keyboard.press('Meta+Shift+a'); await espera(400);
ver(await pg.isVisible('.consola .vt-lista'), '⌘⇧A opens the list of every tab');
const filas = () => pg.evaluate(() => document.querySelectorAll('.consola .vt-lista-fila').length);
ver(await filas() === (await pestanas()).length, 'with one row per tab');
ver(await pg.evaluate(() => [...document.querySelectorAll('.consola .vt-lista-fila')].some(f => f.querySelector('.vt-lista-tarea').textContent === 'QA-1')), 'rows carry their task key');
ver(!h2 || (await pg.evaluate(() => document.querySelectorAll('.consola .vt-lista-grupo').length)) === 2, 'and room headers');
await pg.screenshot({ path: `${dir}/qa-pestanas-lista.png` });
await pg.keyboard.type('qa-2', { delay: 10 }); await espera(300);
ver(await filas() === 4, 'typing filters by task: ' + await filas());
await pg.screenshot({ path: `${dir}/qa-pestanas-filtro.png` });
await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await espera(400);
const elegida = await pg.evaluate(() => document.querySelector('.consola .vt-pestana.activa .vt-pestana-nombre').textContent);
ver(!(await pg.isVisible('.consola .vt-lista')) && TITULOS.indexOf(elegida) % 4 === 2, '↓ Enter goes to the second match and closes the list: ' + elegida);
// close every idle one: none is running, so no question
const ociosas = (await pestanas()).filter(p => p.estado === 'ociosa').length;
const total = (await pestanas()).length;
await pg.keyboard.press('Meta+Shift+a'); await espera(300);
await pg.click('.consola .vt-lista-pie button:has-text("idle"), .consola .vt-lista-pie button:has-text("reposo")'); await espera(500);
ver(!(await pg.isVisible('.consola .vt-confirmar')) && (await pestanas()).length === total - ociosas, `«close read or idle» closes the ${ociosas} idle ones without asking`);
// grouping off: one flat order, no headers
await pg.click('.consola .vt-lista-agrupar input'); await espera(300);
ver((await pg.evaluate(() => document.querySelectorAll('.consola .vt-grupo').length)) === 0, '«group by room» off: no headers');
const plano = (await pestanas()).filter(p => !p.activa).map(p => rango[p.estado] ?? 5);
ver(plano.every((r, i) => !i || plano[i - 1] <= r), 'and one urgency order across rooms');
await pg.click('.consola .vt-lista-agrupar input'); await pg.keyboard.press('Escape'); await espera(300);
ver(!(await pg.isVisible('.consola .vt-lista')) && await pg.isVisible('.consola'), 'Esc closes the list and only the list');

// ---- selector of who to talk to (only when the room has more than one)
if (await pg.isVisible('.consola .consola-quien')) {
  const opciones = await pg.evaluate(() => [...document.querySelectorAll('.consola .consola-quien option')].map(o => [o.value, o.textContent]));
  const otro = opciones.find(([v]) => v !== h.id);
  await pg.selectOption('.consola .consola-quien', otro[0]);
  ver(await hasta(async () => await talking() === otro[0]), 'the selector below the name switches to ' + otro[1]);
  await pg.screenshot({ path: `${dir}/qa-pestanas-selector.png` });
} else console.log('--   (the room has only one dweller and no holograms: no selector)');

// ---- hovering an intercom chip in the bar lists its conversations
await pg.keyboard.press('Meta+ArrowDown'); await espera(400);
const chip = pg.locator('.barra-ventanas .com .chip-terminal:not(.de-copia)', { hasText: h.nombre }).first();
await chip.hover(); await espera(300);
const asomo = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo .barra-asomo-titulo')].map(x => x.textContent));
ver(asomo.length > 1, `hovering ${h.nombre}'s chip lists their ${asomo.length} conversations`);
await pg.screenshot({ path: `${dir}/qa-pestanas-barra.png` });
if (asomo.length) {
  await pg.locator('.barra-asomo .barra-asomo-fila').last().click(); await espera(800);
  const activa = await pg.evaluate(() => document.querySelector('.consola .vt-pestana.activa .vt-pestana-nombre')?.textContent);
  ver(await talking() === h.id && activa === asomo.at(-1), 'clicking one opens the intercom on that conversation: ' + activa);
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

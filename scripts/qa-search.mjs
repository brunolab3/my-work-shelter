// QA del menú del juego (Esc) y del buscador (⌘K), con teclado real (Playwright), sin sesiones de Claude Code:
// - Esc en el refugio abre el menú del juego (Volver, Buscar, Opciones, Atajos, Reiniciar, Superficie, Salir); Opciones,
//   Atajos, Reiniciar y Salir vuelven al menú con Esc; Esc en el menú vuelve al refugio. La O ya no abre nada.
// - La regleta ya no lleva «reiniciar»: lleva ⌘K (buscar) y Esc (menú), que se pueden pulsar.
// - ⌘K abre el buscador desde el refugio y desde un intercomunicador (escribiendo); escribir filtra, Enter ejecuta
//   (plano, ir a una sala, hablar con un habitante); las acciones llevan su tecla; las usadas pasan a «recurrentes».
// Uso: node scripts/qa-search.mjs [url] [carpeta-capturas]   (SHELTER_DATOS para el token; mejor un refugio de pruebas)
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
await pg.evaluate(() => localStorage.removeItem('shelter.search.uses'));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(150); } return false; };
const panel = () => pg.evaluate(() => window.__game.get().panel);
const options = () => pg.evaluate(() => [...document.querySelectorAll('.options-console li')].map(l => l.textContent.replace('▶', '').trim()));
const rows = () => pg.evaluate(() => [...document.querySelectorAll('.row-search')].map(f => ({ txt: f.querySelector('.txt')?.textContent, key: f.querySelector('.key')?.textContent ?? '', active: f.classList.contains('active') })));
const sections = () => pg.evaluate(() => [...document.querySelectorAll('.section-search')].map(s => s.textContent));
const open = () => pg.isVisible('.search');
const chooseMenu = async text => { const i = (await options()).findIndex(o => o.startsWith(text)); for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await wait(300); };

// ---- regleta
check(!(await pg.$('.button-restart')), 'la regleta ya no lleva el botón de reiniciar');
check((await pg.$$eval('.button-door .key', t => t.map(x => x.textContent))).join(' ') === '⌘K Esc', 'lleva ⌘K (buscar) y Esc (menú) a la vista');

// ---- menú del juego
await pg.keyboard.press('Escape');
check(await until(async () => (await panel()) === 'menu'), 'Esc en el refugio abre el menú del juego');
const items = await options();
console.log('   ', items.map(x => x.split(/(?=[A-Z⌘])/)[0]).join(' | '));
check(['Volver al refugio', 'Buscar', 'Opciones', 'Atajos', 'Reiniciar el juego', 'Salir del refugio'].every(t => items.some(o => o.startsWith(t))), 'con volver, buscar, opciones, atajos, reiniciar y salir');
await pg.screenshot({ path: path.join(dir, 'menu-juego.png') });
for (const [name, p] of [['Opciones', 'options'], ['Atajos', 'help'], ['Reiniciar el juego', 'restart'], ['Salir del refugio', 'exit']]) {
  await chooseMenu(name);
  check((await panel()) === p, `«${name}» abre su aparato`);
  await pg.keyboard.press('Escape');
  check(await until(async () => (await panel()) === 'menu'), `y Esc vuelve al menú`);
}
await pg.keyboard.press('Escape');
check(await until(async () => (await panel()) === null), 'Esc en el menú vuelve al refugio');
await pg.keyboard.press('KeyO'); await wait(300);
check((await panel()) === null, 'la O ya no abre las opciones');
await pg.click('.button-door:nth-child(2)');
check(await until(async () => (await panel()) === 'menu'), 'el botón «Esc menú» de la regleta abre el menú');
await pg.keyboard.press('Escape'); await wait(200);

// ---- buscador en el refugio
await pg.keyboard.press('Meta+k');
check(await until(open), '⌘K abre el buscador');
const nRec = await pg.evaluate(() => window.__client.action('conversations.recent', { limit: 20 }).then(r => r.length));
check(nRec === 0 || await until(async () => (await sections()).includes('Conversaciones recientes'), 20000), `trae las conversaciones recientes de todas las salas (${nRec})`);
const f0 = await rows();
check(f0.some(f => f.txt === 'Plano del refugio' && f.key === 'M') && f0.some(f => f.txt === 'Control de versiones' && f.key === 'G'), 'las acciones llevan su tecla a la vista');
console.log('    secciones sin escribir:', (await sections()).join(' | '));
await pg.screenshot({ path: path.join(dir, 'buscador.png') });
await pg.keyboard.type('map');
check((await rows())[0]?.txt === 'Plano del refugio', 'escribir «plano» deja el plano el primero');
await pg.keyboard.press('Enter');
check(await until(async () => (await panel()) === 'map') && !(await open()), 'Enter lo abre y cierra el buscador');
await pg.keyboard.press('Escape'); await wait(300);
await pg.keyboard.press('Meta+k'); await until(open);
check((await sections())[0] === 'Acciones recurrentes' || (await sections()).includes('Acciones recurrentes'), 'lo usado pasa a «Acciones recurrentes»');
check((await rows()).find(f => f.txt === 'Plano del refugio') && (await sections()).indexOf('Acciones recurrentes') < (await sections()).indexOf('Acciones'), 'y va delante de las demás acciones');
await pg.keyboard.type('plann');
check((await rows())[0]?.txt === 'Planning', 'busca sin tildes ni palabras completas («plann» → Planning)');
await pg.keyboard.press('Escape');
check(await until(async () => !(await open())) && (await panel()) === null, 'Esc cierra el buscador (sin abrir el menú)');
// ir a una sala y hablar con un habitante
const h = await pg.evaluate(() => window.__game.get().dwellers.find(h => h.room === 'calendar'));
await pg.keyboard.press('Meta+k'); await until(open);
await pg.keyboard.type(h.name.slice(0, 4).toLowerCase());
const fh = await rows();
check(fh.some(f => f.txt === `Hablar con ${h.name}`), `al escribir salen habitantes («Hablar con ${h.name}»)`);
const k = fh.findIndex(f => f.txt === `Hablar con ${h.name}`);
for (let x = 0; x < k; x++) await pg.keyboard.press('ArrowDown');
await pg.keyboard.press('Enter');
check(await until(() => pg.isVisible('.console'), 30000), 'Enter va con él y abre su intercomunicador');
// ⌘K escribiendo en el intercomunicador
await until(() => pg.isVisible('.console .options-console'));
await pg.keyboard.press('Enter'); await wait(400);   // trabajo nuevo: el foco en la caja de texto
await pg.keyboard.type('draft');
await pg.keyboard.press('Meta+k');
check(await until(open), '⌘K también desde la caja de texto de un intercomunicador');
await pg.keyboard.press('Escape');
check(await until(async () => !(await open())) && await pg.evaluate(() => document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value === 'draft'), 'al cerrarlo, el foco vuelve a la caja con lo escrito');
await pg.keyboard.press('Meta+k'); await until(open);
await pg.keyboard.type('ir a puente');
await pg.keyboard.press('Enter');
check(await until(() => pg.evaluate(() => !window.__game.get().talkingWith && window.__game.get().currentRoom === 'bridge'), 30000), '«Ir a Puente de Mando» baja el intercomunicador y lleva a la sala');

check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTodo OK');
process.exit(failures ? 1 : 0);

// QA del intercomunicador como ventana, con teclado real (Playwright) y sesiones reales de Claude Code (Haiku, dos
// trabajos cortos; el primero pide permiso para crear un archivo y se queda esperando: nunca se aprueba): Esc y ← son «atrás» en los menús; un habitante lleva dos trabajos a la vez en dos pestañas (⌘T);
// ⌘↓ minimiza a la barra y desde la barra se vuelve con lo mismo (también lo escrito sin enviar); ⌘↑ amplía; Esc
// arriba del todo vuelve al refugio sin parar nada; ⌘W con un trabajo en marcha pregunta (Esc cancela, Intro cierra);
// × sin nada en marcha cierra sin preguntar.
// Uso: node scripts/qa-intercom.mjs [url] [carpeta-capturas]   (servidor en marcha; SHELTER_DATOS para el token;
// mejor con un refugio de pruebas: SHELTER_DATOS=/tmp/x npm run dev)
// Ojo: lanza sesiones reales de Claude Code (gastan de tu plan) y puede aprobar permisos: úsalo contra un refugio de
// pruebas (arranca el juego con SHELTER_DATOS=/ruta/temporal), nunca contra el tuyo.
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const tabs = () => pg.evaluate(() => [...document.querySelectorAll('.console .vt-tab')].map(p => p.textContent.replace('×', '').trim()));
const options = () => pg.evaluate(() => [...document.querySelectorAll('.console .options-console li')].map(l => l.textContent.replace('▶', '').trim()));
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(300); } return false; };
const sessionsOf = hid => pg.evaluate(id => Object.values(window.__live.get().sessions).filter(s => s.dwellerId === id && s.state !== 'closed').map(s => s.state), hid);
const chooseMenu = async text => { const i = (await options()).findIndex(o => o.startsWith(text)); for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await wait(400); };

// un habitante de una sala con carpeta, sin trabajos
const h = await pg.evaluate(() => { const hs = window.__game.get().dwellers; const vs = Object.values(window.__live.get().sessions); return hs.find(h => h.path && h.room !== 'bridge' && !h.robot && !vs.some(s => s.dwellerId === h.id && s.state !== 'closed')) ?? hs.find(h => h.path); });
console.log('Habitante:', h.name, '·', h.nameRoom);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.console .options-console');
check((await tabs()).length === 1, 'al hablar se abre el intercomunicador con una pestaña');

// ---- atrás sin bajar a «Volver»
await chooseMenu('Ver su ficha');
check(await pg.isVisible('.console .card'), 'abre la ficha');
await pg.keyboard.press('Escape'); await wait(300);
check(await pg.isVisible('.console') && (await options())[0]?.startsWith('Empezar'), 'Esc en la ficha vuelve al menú (no cierra)');
await chooseMenu('Retomar');
await until(async () => !(await pg.textContent('.console .voice'))?.includes('Buscando'), 8000);
await pg.keyboard.press('ArrowLeft'); await wait(300);
check((await options())[0]?.startsWith('Empezar'), '← en el archivo vuelve al menú');

// ---- primer trabajo (pedirá permiso para escribir: queda «te espera», en marcha; nunca se aprueba)
await chooseMenu('Empezar');
await pg.keyboard.type('Crea con la herramienta Write el archivo qa-intercom-borrar.txt con el texto hola. No hagas nada más.', { delay: 2 });
await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');   // modelo: Haiku (el último)
await pg.keyboard.press('Enter');
check(await until(async () => (await sessionsOf(h.id)).length === 1, 15000), 'el primer trabajo arranca');
check(await until(async () => (await pg.$('.console .session')) !== null, 8000), 'y la pestaña pasa a la conversación');
// ---- segundo trabajo a la vez, en otra pestaña
await pg.keyboard.press('Meta+t'); await wait(500);
check((await tabs()).length === 2 && (await options())[0]?.startsWith('Empezar'), '⌘T abre una pestaña con el menú');
await chooseMenu('Empezar');
await pg.keyboard.type('Responde solo: hola dos.', { delay: 2 });
await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');
await pg.keyboard.press('Enter');
check(await until(async () => (await sessionsOf(h.id)).length === 2, 15000), 'el mismo habitante lleva dos trabajos a la vez (el servidor ya no lo rechaza)');
check(!(await pg.isVisible('.teletype.error')), 'sin avisos de error');
await until(async () => (await sessionsOf(h.id)).some(e => e === 'waiting'), 40000);
await pg.screenshot({ path: `${dir}/qa-intercom-pestanas.png` });
check((await sessionsOf(h.id)).includes('waiting'), 'el primero te espera (permiso) mientras el otro va a lo suyo: ' + (await sessionsOf(h.id)).join(', '));

// ---- minimizar y volver: lo mismo que antes, con lo escrito
await pg.keyboard.press('Meta+1'); await wait(500);
await pg.click('.console .request .options-console li:last-child').catch(() => {});   // «No, y te digo por qué…» deja escribir
await wait(300);
await pg.keyboard.type('borrador sin enviar', { delay: 2 });
await pg.keyboard.press('Meta+ArrowDown'); await wait(600);
check(!(await pg.isVisible('.console')) && await pg.isVisible('.bar-windows .com .chip-terminal'), '⌘↓ minimiza: vuelves al refugio y queda en la barra');
check(await pg.evaluate(() => window.__game.get().talkingWith === null), 'el refugio vuelve a tener el mando (se puede andar)');
const chip = await pg.textContent('.bar-windows .com .chip-terminal');
check(/te espera/.test(chip) && /\(2\)/.test(chip), 'la barra dice cómo va lo más urgente y que hay dos trabajos: ' + chip.trim());
await pg.click('.bar-windows .com .chip-terminal'); await wait(1500);
check(await pg.isVisible('.console') && (await tabs()).length === 2, 'desde la barra se vuelve con el habitante, con sus dos pestañas');
const written = await pg.evaluate(() => document.querySelector('.console textarea')?.value ?? '');
check(written === 'borrador sin enviar', 'y con lo que estaba escrito sin enviar');

// ---- ampliar y restaurar
await pg.keyboard.press('Meta+ArrowUp'); await wait(400);
const width = await pg.evaluate(() => document.querySelector('.console')?.getBoundingClientRect().width);
check(await pg.isVisible('.console.maximized') && width > 1400, '⌘↑ amplía a toda la pantalla');
await pg.screenshot({ path: `${dir}/qa-intercom-ampliado.png` });
await pg.keyboard.press('Meta+ArrowDown'); await wait(400);
check(await pg.isVisible('.console') && !(await pg.isVisible('.console.maximized')), '⌘↓ restaura sin minimizar');

// ---- cerrar con algo en marcha: pregunta
await pg.keyboard.press('Meta+w'); await wait(400);
check(await pg.isVisible('.console .vt-confirm'), '⌘W con un trabajo en marcha pide confirmación');
await pg.screenshot({ path: `${dir}/qa-intercom-confirmar.png` });
await pg.keyboard.press('Escape'); await wait(300);
check(!(await pg.isVisible('.vt-confirm')) && (await tabs()).length === 2 && await pg.isVisible('.console'), 'Esc cancela y no cierra nada');
await pg.keyboard.press('Meta+w'); await wait(300); await pg.keyboard.press('Enter');
check(await until(async () => (await sessionsOf(h.id)).length === 1, 8000) && (await tabs()).length === 1, 'Intro cierra esa conversación y solo esa');
// ---- Esc arriba del todo: al refugio, sin parar nada
await until(async () => (await sessionsOf(h.id))[0] === 'finished' || (await sessionsOf(h.id))[0] === 'idle', 60000);
await pg.evaluate(() => document.querySelector('.console textarea')?.focus());
await pg.keyboard.press('Escape'); await wait(500);
check(!(await pg.isVisible('.console')) && (await sessionsOf(h.id)).length === 1, 'Esc en la conversación vuelve al refugio y la conversación sigue abierta');
await pg.click('.bar-windows .com .chip-terminal'); await wait(1500);
await pg.click('.console .buttons-window button:last-child'); await wait(600);
check(!(await pg.isVisible('.console')) && !(await pg.isVisible('.vt-confirm')) && !(await pg.isVisible('.bar-windows .com .chip-terminal')), '× sin nada en marcha cierra sin preguntar y se va de la barra');
check(await until(async () => (await sessionsOf(h.id)).length === 0, 8000), 'y la conversación queda cerrada (en el archivo)');
// ---- una sala especial (Logística) también trabaja: en su carpeta propia, sin opción de worktree
const lg = await pg.evaluate(() => window.__game.get().dwellers.find(h => h.room === 'logistics'));
if (lg) {
  await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), lg);
  await pg.waitForSelector('.console .options-console');
  await chooseMenu('Empezar');
  check(!(await pg.evaluate(() => [...document.querySelectorAll('.console .row-chips .lbl')].some(x => x.textContent === 'Worktree'))), `${lg.name} (Logística): sin opción de worktree`);
  await pg.keyboard.type('Responde solo: hola desde logística.', { delay: 2 });
  await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft'); await pg.keyboard.press('Enter');
  check(await until(async () => (await sessionsOf(lg.id)).length === 1, 15000) && !(await pg.isVisible('.teletype.error')), `${lg.name} empieza un trabajo (antes: «Esta sala no tiene carpeta»)`);
  const cwd = await pg.evaluate(id => Object.values(window.__live.get().sessions).find(s => s.dwellerId === id && s.state !== 'closed')?.cwd, lg.id);
  check(/\/salas\/logistica$/.test(cwd ?? ''), 'en la carpeta propia de la sala: ' + cwd);
  check(await until(async () => ['finished', 'idle'].includes((await sessionsOf(lg.id))[0]), 60000), 'y termina');
  await pg.click('.console .buttons-window button:last-child'); await wait(600);
  await until(async () => (await sessionsOf(lg.id)).length === 0, 8000);
}
check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

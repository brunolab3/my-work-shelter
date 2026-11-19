// QA de los navegadores del refugio en la ventana real (Electron, por CDP): Linear se abre dentro, centrado al 75 % del
// ancho en 16:9, sin barra de direcciones; carga la web de verdad (sesión propia persist:navegador, con el agente de
// usuario de Electron sin disfrazar: disfrazado, Turnstile tumba el login de Linear); aparece en la fila NAV de la barra;
// se amplía a toda la pantalla, se minimiza (sin recargarse) y vuelve desde la barra; ⌘M y ⌘W con el foco dentro de la web (las recoge Electron en before-input-event y las sube al juego con
// __atajoNavegador; CDP no pasa por ahí, así que aquí se prueba la mitad del juego) minimizan y cierran.
// Uso: node scripts/qa-browser.mjs [puerto-cdp] [carpeta-capturas]
//   (Electron abierto con SHELTER_DEV=1 SHELTER_CDP=<puerto>; para no tocar tus datos ni tus logins: SHELTER_DATOS, SHELTER_PUERTO
//    y --user-data-dir=/ruta/temporal al lanzar Electron)
import { chromium } from 'playwright';
const [port = '9333', dir = '_capturas'] = process.argv.slice(2);
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pg = b.contexts()[0].pages().find(p => !p.url().startsWith('devtools')) ?? b.contexts()[0].pages()[0];
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); window.__browsers.browsers.set({ list: [] }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const state = () => pg.evaluate(() => window.__browsers.browsers.get().list.find(v => v.id === 'linear'));
const box = sel => pg.evaluate(sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; }, sel);
const inWeb = js => pg.evaluate(js => document.querySelector('.ventana-navegador webview').executeJavaScript(js), js);

// abrir desde el panel de Logística, como lo haría el usuario
await pg.evaluate(() => window.__game.set({ panel: 'logistica', panelData: null }));
await pg.waitForSelector('.aparato .opciones-consola li');
const option = await pg.$$eval('.aparato .opciones-consola li', ls => ls.findIndex(l => l.textContent.includes('Abrir Linear aquí mismo')));
check(option >= 0, 'el panel de Logística ofrece «Abrir Linear aquí mismo»');
await pg.click(`.aparato .opciones-consola li:nth-child(${option + 1})`);
await pg.waitForSelector('.ventana-navegador webview', { state: 'attached', timeout: 15000 });
check(!(await pg.$('.aparato')), 'el panel se cierra al abrir el navegador');
await pg.waitForFunction(() => window.__browsers.browsers.get().list.find(v => v.id === 'linear')?.loading === false, null, { timeout: 30000 }).catch(() => {});
await wait(1500);
const v = await state();
check(/^https:\/\/([a-z0-9-]+\.)*linear\.app\//.test(v?.url ?? ''), `carga Linear de verdad (${v?.url})`);
const ua = await inWeb('navigator.userAgent');
check(/Electron\//.test(ua), 'agente de usuario de Electron sin disfrazar (si no, Turnstile tumba el login por email)');
check(/^https:\/\/linear\.app\/login/.test(v?.url ?? ''), 'Linear se abre en /login (la portada manda a «Incompatible Browser» por llevar «Electron»)');
// el aviso de la web pública se salta: de /browser-compatibility a /login
await pg.evaluate(() => document.querySelector('.ventana-navegador webview').loadURL('https://linear.app/browser-compatibility').catch(() => {}));   // el desvío corta esta carga
await pg.waitForFunction(() => /\/login/.test(window.__browsers.browsers.get().list.find(v => v.id === 'linear')?.url ?? ''), null, { timeout: 20000 }).catch(() => {});
await wait(1500);
check(/\/login/.test(await inWeb('location.pathname')), `/browser-compatibility se desvía a /login (${await inWeb('location.href')})`);
// (Linear define su propio «process = {env: {}}»: lo que delataría a Node es process.versions)
check(await inWeb('typeof require === "undefined" && !(window.process && window.process.versions) && !window.__juego'), 'la web no tiene Node ni nada del juego');

// tamaño normal: 75 % del ancho, centrado, cuerpo en 16:9; sin barra de direcciones ni pestañas
const n = await box('.ventana-navegador'), body = await box('.vn-cuerpo');
check(Math.abs(n.w - Math.min(n.vw * 0.75, (n.vh - 110) * 16 / 9)) < 3, `ancho del 75 % (${Math.round(n.w)} de ${n.vw})`);
check(Math.abs(body.w / body.h - 16 / 9) < 0.02, `cuerpo en 16:9 (${Math.round(body.w)}×${Math.round(body.h)})`);
check(Math.abs(n.x + n.w / 2 - n.vw / 2) < 2 && Math.abs(n.y + n.h / 2 - n.vh / 2) < 3, `centrado en la pantalla (${Math.round(n.x)}, ${Math.round(n.y)}, ${Math.round(n.w)}×${Math.round(n.h)})`);
check(!(await pg.$('.ventana-navegador input, .ventana-navegador .vt-pestanas')), 'sin barra de direcciones ni pestañas');
const wv = await box('.ventana-navegador webview');
check(Math.abs(wv.w - body.w) < 1 && Math.abs(wv.h - body.h) < 1, 'la web ocupa todo el cuerpo');
check((await pg.$$eval('.barra-ventanas .nav .chip-terminal', cs => cs.map(c => c.textContent))).some(t => t.startsWith('Linear')), 'aparece en la fila NAV de la barra');
await pg.screenshot({ path: `${dir}/qa-navegador.png` });

// ampliar a toda la pantalla y volver
await pg.click('.ventana-navegador .botones-ventana button:nth-child(2)'); await wait(300);
const m = await box('.ventana-navegador'), mc = await box('.ventana-navegador webview');
check(m.x === 0 && m.y === 0 && m.w === m.vw && m.h === m.vh && mc.h > m.vh - 40, 'ampliado: toda la pantalla');
await pg.screenshot({ path: `${dir}/qa-navegador-ampliado.png` });
await pg.dblclick('.vn-cabeza .vt-titulo'); await wait(300);
check(Math.abs((await box('.ventana-navegador')).w - n.w) < 2, 'doble clic en la cabecera: vuelve al tamaño normal');

// marcar la página para saber si se recarga al minimizar y volver
await inWeb('window.__marcaQA = 1');
await pg.click('.ventana-navegador .botones-ventana button:nth-child(1)'); await wait(300);
check((await state()).minimized && !(await pg.isVisible('.ventana-navegador')), 'minimizado: no se ve');
await pg.click('.barra-ventanas .nav .chip-terminal'); await wait(500);
check(!(await state()).minimized && (await inWeb('window.__marcaQA')) === 1, 'vuelve desde la barra sin recargarse');

// ⌘M y ⌘W con el foco dentro de la web: lo que manda Electron
const fromWeb = code => pg.evaluate(code => { const w = document.querySelector('.ventana-navegador webview'); window.__browserShortcut(w.getWebContentsId(), { code, key: code.slice(3).toLowerCase(), shiftKey: false }); }, code);
await fromWeb('KeyM'); await wait(400);
check((await state()).minimized, '⌘M dentro de la web minimiza');
await pg.evaluate(() => window.__browsers.openBrowser('linear')); await wait(500);
await fromWeb('KeyW'); await wait(400);
check(!(await state()) && !(await pg.$('.ventana-navegador')), '⌘W dentro de la web lo cierra');

check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(failures ? `${failures} fallo(s)` : 'todo bien');
await b.close();
process.exit(failures ? 1 : 0);

// QA de las terminales del juego con teclado real (Playwright): abre la terminal del Puente de Mando, lanza
// Claude Code y comprueba que se comporta como en iTerm: Shift+Enter es salto de línea (no envía), Shift+Tab cambia
// de modo y Esc llega a Claude (no pliega la ventana). No envía nada a Claude: sale con Ctrl+C.
// Luego, como una terminal de sistema operativo: Esc en el prompt no cierra; ⌘T abre pestaña y ⌘1/⌘2 cambian; ⌘M
// minimiza a la barra con el programa vivo y al abrirla se ve lo mismo; ⌘↑ amplía y ⌘↓ restaura; ⌘W con algo en marcha pide
// confirmación (Esc cancela, Intro cierra); × en el prompt cierra sin preguntar.
// Con --reinicio, además: un programa pone modos (kitty, pegado entre corchetes, pantalla alternativa) y escribe más de
// 60 KB; se pulsa «reiniciar» en la regleta y, ya recargado, la ventana sigue abierta y los modos siguen vigentes.
// Uso: node scripts/qa-terminal.mjs [url] [salida.png] [--reinicio]   (servidor en marcha; SHELTER_DATOS para el token;
// el reinicio necesita el servidor bajo el supervisor: ./shelter, npm run dev o node server/supervisor.mjs)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withToken } from './token.mjs';
const withRestart = process.argv.includes('--reinicio');
const [url0 = 'http://127.0.0.1:3778', output = '_capturas/qa-terminal.png'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); });
const wait = ms => pg.waitForTimeout(ms);
// lo que se ve en la pestaña activa de la terminal
const screen = () => pg.evaluate(() => [...document.querySelectorAll('.ventana-terminal .vt-xterm')].filter(x => x.offsetParent).flatMap(x => [...x.querySelectorAll('.xterm-rows > div')]).map(d => d.textContent).join('\n'));
const tabs = () => pg.evaluate(() => [...document.querySelectorAll('.ventana-terminal .vt-tab')].map(p => p.textContent.replace('×', '').trim()));
const focus = () => pg.evaluate(() => [...document.querySelectorAll('.ventana-terminal .vt-xterm')].find(x => x.offsetParent)?.querySelector('textarea')?.focus());
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const p = await screen(); if (f(p)) return p; await wait(250); } return await screen(); };
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };

await pg.evaluate(() => window.dispatchEvent(new CustomEvent('shelter:terminal', { detail: { roomId: 'bridge' } })));
await pg.waitForSelector('.ventana-terminal .xterm-rows');
await until(p => /[%$#❯>]\s*$/m.test(p), 8000);
await pg.click('.ventana-terminal .vt-cuerpo');
await pg.keyboard.type('claude\n', { delay: 15 });
await until(p => /❯|>\s/.test(p) && /Claude Code|Welcome|Tips|\? for shortcuts/i.test(p), 30000);
await wait(1500);
await pg.keyboard.type('primera linea', { delay: 10 });
await pg.keyboard.press('Shift+Enter');
await pg.keyboard.type('segunda linea', { delay: 10 });
let p = await until(x => /segunda linea/.test(x), 5000);
const rows = p.split('\n');
const i1 = rows.findIndex(f => /primera linea/.test(f)), i2 = rows.findIndex(f => /segunda linea/.test(f));
check(i1 >= 0 && i2 === i1 + 1 && !/esc to interrupt/i.test(p), 'Shift+Enter hace salto de línea en Claude Code (no envía)');
await pg.screenshot({ path: output });
await pg.keyboard.press('Shift+Tab');
p = await until(x => /accept edits|plan mode|auto mode|bypass/i.test(x), 4000);
check(/accept edits|plan mode|auto mode|bypass/i.test(p), 'Shift+Tab cambia el modo de permisos');
await pg.keyboard.press('Escape'); await wait(800);
check(await pg.isVisible('.ventana-terminal'), 'Esc llega a Claude Code y no pliega la terminal');
// fuera de Claude: Shift+Enter en el shell vuelve a ser Enter
await pg.keyboard.press('Control+C'); await wait(300); await pg.keyboard.press('Control+C'); await wait(300); await pg.keyboard.press('Control+C');
await until(x => !/\? for shortcuts/.test(x.split('\n').slice(-6).join('\n')), 8000); await wait(1500);
await pg.keyboard.type('echo QA-$((40+2))', { delay: 10 }); await pg.keyboard.press('Shift+Enter');
p = await until(x => /^QA-42/m.test(x), 4000);
check(/^QA-42/m.test(p), 'en el shell, Shift+Enter ejecuta como Enter (como iTerm)');
check(!/\[13;2u|;2u/.test(p), 'sin secuencias sueltas en el shell');

// ---- como una terminal de sistema operativo
await pg.keyboard.press('Escape'); await wait(800);
check(await pg.isVisible('.ventana-terminal') && (await tabs()).length === 1, 'Esc en el prompt no cierra ni esconde la terminal');
await pg.keyboard.press('Control+C'); await wait(300);   // zsh se queda con el Esc como prefijo Meta (igual que en iTerm)
await pg.keyboard.press('Meta+t'); await wait(1200);
check((await tabs()).length === 2, '⌘T abre una pestaña nueva');
await until(x => /[%$#❯>]\s*$/m.test(x), 8000);
await pg.keyboard.type('echo PESTANA-$((1+1)); sleep 300\n', { delay: 8 });
p = await until(x => /^PESTANA-2/m.test(x), 5000);
check(/^PESTANA-2/m.test(p), 'la pestaña nueva tiene su propio shell');
await pg.waitForFunction(() => /sleep/.test(document.querySelector('.vt-tab.active')?.textContent ?? ''), null, { timeout: 4000 }).catch(() => {});
check(/sleep/.test((await tabs())[1] ?? ''), 'la pestaña dice qué corre dentro (sleep)');
await pg.keyboard.press('Meta+1'); await wait(500);
p = await screen();
check(/QA-42/.test(p) && !/PESTANA-2/.test(p), '⌘1 vuelve a la primera pestaña con lo suyo');
await pg.keyboard.press('Meta+2'); await wait(400);
await pg.keyboard.press('Meta+m'); await wait(500);
check(!(await pg.isVisible('.ventana-terminal')) && await pg.isVisible('.barra-ventanas .term .chip-terminal.minimizada'), '⌘M minimiza a la barra de terminales de abajo a la izquierda');
const dock = await pg.evaluate(() => { const r = document.querySelector('.barra-ventanas')?.getBoundingClientRect(); return r && { x: r.x, below: innerHeight - r.bottom }; });
check(!!dock && dock.x < 40 && dock.below < 40, 'la barra está abajo a la izquierda');
await wait(1500);
check(/sleep/.test(await pg.textContent('.barra-ventanas .term .chip-terminal') ?? ''), 'minimizada, lo de dentro sigue en marcha (la barra lo dice)');
await pg.click('.barra-ventanas .term .chip-terminal'); await wait(600);
p = await screen();
check(await pg.isVisible('.ventana-terminal') && /^PESTANA-2/m.test(p), 'al abrirla desde la barra se ve lo mismo que antes');
await pg.keyboard.press('Meta+ArrowUp'); await wait(400);
const max = await pg.evaluate(() => document.querySelector('.ventana-terminal')?.getBoundingClientRect().width);
check(await pg.isVisible('.ventana-terminal.maximizada') && max > 1500, '⌘↑ la amplía a toda la pantalla');
await pg.keyboard.press('Meta+ArrowDown'); await wait(400);
check(!(await pg.isVisible('.ventana-terminal.maximizada')) && await pg.isVisible('.ventana-terminal'), '⌘↓ la restaura (sin minimizarla)');
await pg.keyboard.press('Meta+w'); await wait(400);
check(await pg.isVisible('.vt-confirmar'), '⌘W con algo en marcha pide confirmación');
await pg.keyboard.press('Escape'); await wait(400);
check(!(await pg.isVisible('.vt-confirmar')) && (await tabs()).length === 2, 'Esc cancela y la pestaña sigue');
await pg.keyboard.press('Meta+w'); await wait(400); await pg.keyboard.press('Enter'); await wait(800);
check((await tabs()).length === 1, 'Intro confirma y cierra solo esa pestaña');
await focus();
if (withRestart) {
  const prog = join(tmpdir(), 'qa-terminal-modos.mjs');
  writeFileSync(prog, `process.stdout.write('\\x1b[?1049h\\x1b[?2004h\\x1b[>1u');
for (let i = 0; i < 1500; i++) process.stdout.write('relleno ' + i + ' '.repeat(60) + '\\n');
process.stdout.write('LISTO-MODOS\\n');
process.stdin.setRawMode(true); process.stdin.on('data', d => { process.stdout.write('RECIBIDO:' + JSON.stringify(String(d)) + '\\n'); if (String(d) === 'q') process.exit(0); });`);
  await pg.keyboard.press('Meta+t'); await wait(1200); await until(x => /[%$#❯>]\s*$/m.test(x), 8000);
  await pg.keyboard.type('echo DOS-$((1+1))\n', { delay: 8 }); await until(x => /^DOS-2/m.test(x), 4000);
  await pg.keyboard.press('Meta+1'); await wait(500);
  await pg.keyboard.type(`node ${prog}\n`, { delay: 5 });
  await until(x => /LISTO-MODOS/.test(x), 10000);
  const id0 = await pg.evaluate(() => document.querySelector('.ventana-terminal')?.getBoundingClientRect().toJSON());
  await pg.click('.boton-reiniciar');
  await pg.waitForSelector('.device, .opciones', { timeout: 5000 }).catch(() => {});
  await pg.getByText(/^Reiniciar (el juego|y cortar)/).click();
  await pg.waitForEvent('framenavigated', { timeout: 60000 });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); });
  await pg.waitForSelector('.ventana-terminal .xterm-rows', { state: 'visible', timeout: 15000 }).catch(() => {});
  check(await pg.isVisible('.ventana-terminal'), 'tras reiniciar, la terminal sigue abierta y desplegada');
  const id1 = await pg.evaluate(() => document.querySelector('.ventana-terminal')?.getBoundingClientRect().toJSON());
  check(!!id1 && Math.abs(id1.x - id0.x) < 2 && Math.abs(id1.width - id0.width) < 2, 'y en el mismo sitio');
  await wait(1200);
  await pg.click('.ventana-terminal .vt-cuerpo');
  await pg.keyboard.press('Shift+Enter');
  p = await until(x => /RECIBIDO:/.test(x), 5000);
  check(/RECIBIDO:"\\u001b\[13;2u"/.test(p), 'el programa sigue vivo y el protocolo de kitty sigue activo (Shift+Enter = CSI 13;2 u)');
  check(!/RECIBIDO:"\\u001b\[\?/.test(p), 'el repintado no contesta preguntas viejas al programa');
  check((await tabs()).length === 2, 'con sus dos pestañas');
  await pg.keyboard.press('Meta+2');
  check(/^DOS-2/m.test(await until(x => /^DOS-2/m.test(x), 4000)), 'y la segunda con lo suyo');
  await pg.keyboard.press('Meta+1'); await wait(500);
  await pg.screenshot({ path: output.replace('.png', '-reinicio.png') });
  await pg.click('.ventana-terminal .vt-cabeza button[title^="Cerrar la terminal"]'); await wait(400);
  check(await pg.isVisible('.vt-confirmar'), '× con un programa en marcha pide confirmación');
  await pg.keyboard.press('Escape'); await wait(300);
  await pg.keyboard.press('q'); await wait(1800);
}
await pg.click('.ventana-terminal .vt-cabeza button[title^="Cerrar la terminal"]'); await wait(800);
check(!(await pg.isVisible('.vt-confirmar')) && !(await pg.isVisible('.ventana-terminal')) && !(await pg.isVisible('.barra-ventanas')), '× en el prompt cierra sin preguntar y la barra se va');
check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log('->', output);
await b.close();
process.exit(failures ? 1 : 0);

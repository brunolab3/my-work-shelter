// QA de la barra de ventanas y de la pantalla completa, con teclado real (Playwright), sin sesiones de Claude:
// dos filas (intercomunicadores arriba, terminales abajo); B en el refugio y ⌘B desde una terminal o un
// intercomunicador entran en la barra; ←→ eligen, ↑↓ cambian de fila, Intro abre, Esc sale y devuelve el foco;
// ⌘↑ amplía a toda la ventana (sin regleta ni barra a la vista); quien vive en una sala especial también tiene
// terminal, en la carpeta propia de su sala.
// Uso: node scripts/qa-bar.mjs [url] [carpeta-capturas]   (servidor en marcha; SHELTER_DATOS para el token)
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
const row = c => pg.evaluate(c => [...document.querySelectorAll(`.bar-windows .${c} .chip-terminal`)].map(x => x.textContent.trim()), c);
const marked = () => pg.evaluate(() => { const m = document.querySelector('.bar-windows .chip-terminal.marked'); return m ? (m.closest('.com') ? 'com:' : 'term:') + m.textContent.trim() : null; });
const covers = (x, y, sel) => pg.evaluate(([x, y, sel]) => !!document.elementFromPoint(x, y)?.closest(sel), [x, y, sel]);
const goTalk = h => pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
const hs = await pg.evaluate(() => window.__game.get().dwellers.map(h => ({ id: h.id, room: h.room, path: h.path, name: h.name })));
const withFolder = hs.filter(h => h.path && h.room !== 'bridge'), withoutRepo = hs.find(h => !h.path);
const rooms = [...new Set(hs.filter(h => h.path).map(h => h.room))].slice(0, 2);

// dos terminales minimizadas y un intercomunicador minimizado
for (const s of rooms) { await pg.evaluate(s => window.dispatchEvent(new CustomEvent('shelter:terminal', { detail: { roomId: s } })), s); await wait(1500); await pg.keyboard.press('Meta+m'); await wait(300); }
await goTalk(withFolder[0]); await pg.waitForSelector('.console .options-console');
check((await pg.evaluate(() => [...document.querySelectorAll('.console .options-console li')].map(l => l.textContent))).some(t => t.includes('Abrir su terminal')), `${withFolder[0].name} (sala de repo) ofrece su terminal`);
await pg.keyboard.press('Meta+ArrowDown'); await wait(500);
check((await row('com')).length === 1 && (await row('term')).length === 2, 'dos filas: arriba el intercomunicador, abajo las dos terminales');
const rows = await pg.evaluate(() => [...document.querySelectorAll('.bar-windows .bar-row')].map(f => f.getBoundingClientRect().top));
check(rows.length === 2 && rows[0] < rows[1], 'una fila encima de otra');
await pg.screenshot({ path: `${dir}/qa-barra.png` });

// B en el refugio: a la barra; ↓ a las terminales, → a la segunda, Intro la abre
await pg.keyboard.press('b'); await wait(300);
check(await pg.isVisible('.bar-windows.selecting') && (await marked())?.startsWith('com:'), 'B en el refugio entra en la barra (empieza arriba)');
await pg.screenshot({ path: `${dir}/qa-barra-teclado.png` });
await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowRight'); await wait(200);
const second = await marked();
check(second?.startsWith('term:') && second.includes((await row('term'))[1]), '↓ cambia a la fila de terminales y → elige la segunda');
await pg.keyboard.press('Enter'); await wait(800);
check(!(await pg.isVisible('.bar-windows.selecting')) && (await pg.evaluate(() => document.querySelectorAll('.window-terminal:not([style*="display: none"])').length)) === 1, 'Intro la abre (y sale de la barra)');
check(await pg.evaluate(() => !!document.activeElement?.closest('.window-terminal')), 'con el foco dentro, lista para escribir');
// ⌘B desde la terminal: ↑ al intercomunicador, Intro vuelve con el habitante
await pg.keyboard.press('Meta+b'); await wait(300);
check(await pg.isVisible('.bar-windows.selecting') && (await marked())?.startsWith('term:'), '⌘B desde una terminal entra en la barra, en esa terminal');
await pg.keyboard.press('Escape'); await wait(300);
check(!(await pg.isVisible('.bar-windows.selecting')) && await pg.evaluate(() => !!document.activeElement?.closest('.window-terminal')), 'Esc sale y el foco vuelve a la terminal (no le llega el Esc)');
await pg.keyboard.press('Meta+b'); await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('Enter'); await wait(1500);
check(await pg.isVisible('.console') && await pg.evaluate(id => window.__game.get().talkingWith === id, withFolder[0].id), '↑ e Intro vuelven con el habitante del intercomunicador');

// pantalla completa de verdad
await pg.keyboard.press('Meta+ArrowUp'); await wait(500);
const r = await pg.evaluate(() => document.querySelector('.console')?.getBoundingClientRect().toJSON());
check(r && r.x === 0 && r.y === 0 && r.width === 1600 && r.height === 1000, `⌘↑: el intercomunicador ocupa toda la ventana (${r && [r.x, r.y, r.width, r.height].join(',')})`);
check(await covers(800, 30, '.console') && await covers(60, 980, '.console'), 'tapa la regleta y la barra');
await pg.screenshot({ path: `${dir}/qa-barra-ampliado.png` });
await pg.keyboard.press('Meta+b'); await wait(300);
check(await covers(60, 980, '.bar-windows'), 'con ⌘B la barra sale por encima');
await pg.keyboard.press('Escape'); await pg.keyboard.press('Meta+ArrowDown'); await wait(300);
await pg.keyboard.press('Meta+ArrowDown'); await wait(500);
await pg.keyboard.press('b'); await wait(200);
if ((await marked())?.startsWith('com:')) await pg.keyboard.press('ArrowDown');   // empieza en la ventana abierta, si la hay
await pg.keyboard.press('Enter'); await wait(800);
await pg.keyboard.press('Meta+ArrowUp'); await wait(500);
const t = await pg.evaluate(() => [...document.querySelectorAll('.window-terminal')].find(v => v.style.display !== 'none')?.getBoundingClientRect().toJSON());
check(t && t.x === 0 && t.y === 0 && t.width === 1600 && t.height === 1000 && await covers(800, 30, '.window-terminal'), '⌘↑: la terminal también ocupa toda la ventana');
await pg.keyboard.press('Meta+ArrowDown'); await wait(300);

// sala especial (sin repo): también tiene terminal, en su carpeta de trabajo propia
if (withoutRepo) {
  await goTalk(withoutRepo); await pg.waitForSelector('.console .options-console');
  const ops = await pg.evaluate(() => [...document.querySelectorAll('.console .options-console li')].map(l => l.textContent.replace('▶', '').trim()));
  check(ops.some(t => t.startsWith('Abrir su terminal')), `${withoutRepo.name} (sala especial) ofrece su terminal`);
  await pg.keyboard.press('t'); await wait(1500);
  const cwd = await pg.evaluate(() => [...document.querySelectorAll('.window-terminal')].filter(v => v.style.display !== 'none').sort((a, b) => +b.style.zIndex - +a.style.zIndex)[0]?.querySelector('.vt-path')?.textContent ?? '');   // la de delante
  check(cwd.includes('/salas/' + withoutRepo.room), 'T la abre en su carpeta propia: ' + cwd);
  const id = 'sala:' + withoutRepo.room;
  await pg.evaluate(id => window.__client.send({ t: 'terminalClose', id }), id);
}
// limpieza: se cierran las terminales de la prueba
for (const s of rooms) await pg.evaluate(s => window.__client.send({ t: 'terminalClose', id: 'sala:' + s }), s);
check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

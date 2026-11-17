// QA of the bar's COM row when many rooms have conversations: compact chips (room · state · count, who and what in the
// title) and the «+N» chip for those that don't fit, the waiting ones kept in view; the keyboard goes through them all.
// Conversations are made up in the page (nothing reaches Claude Code).
// Uso: SHELTER_DATOS=… node scripts/qa-barra-com.mjs <url> [carpeta-capturas]   (a test shelter with several rooms)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 760, height: 700 } });
const errores = []; pg.on('pageerror', e => errores.push(e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); });
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const chips = () => pg.evaluate(() => [...document.querySelectorAll('.barra-ventanas .barra-fila.com > .chip-terminal')].map(x => ({ texto: x.textContent.trim(), title: x.title, mas: x.classList.contains('barra-mas'), urgente: x.classList.contains('urgente') })));

// one intercom per room, each with a made-up conversation; the last room's waits for you
const hs = await pg.evaluate(() => { const vistos = new Set(); return window.__juego.get().habitantes.filter(h => !h.robot && !vistos.has(h.sala) && vistos.add(h.sala)).map(h => ({ id: h.id, sala: h.sala, nombre: h.nombre })); });
ver(hs.length >= 6, `${hs.length} rooms with a dweller`);
await pg.evaluate(hs => {
  const sesiones = {}, ahora = Date.now();
  hs.forEach((h, i) => {
    const id = 'qa' + i;
    sesiones[id] = { id, dwellerId: h.id, salaId: h.sala, cwd: '/tmp', estado: i === hs.length - 1 ? 'esperando' : 'ociosa', sinLeer: false, titulo: 'Conversation ' + i, pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, actualizada: ahora - i * 60000 };
  });
  window.__live.set(e => ({ ...e, sesiones: { ...e.sesiones, ...sesiones } }));
  window.__intercoms.set({ lista: hs.map((h, i) => ({ dwellerId: h.id, pestanas: [{ id: 'qp' + i, vista: { tipo: 'sesion', sesionId: 'qa' + i } }], activa: 'qp' + i, maximizada: false, z: i, known: [] })) });
}, hs);
await espera(500);
const cs = await chips();
const mas = cs.find(c => c.mas), vistas = cs.filter(c => !c.mas);
ver(!!mas && vistas.length < hs.length, `«+N» shows up: ${vistas.length} in view, ${mas?.texto}`);
ver(vistas.every(c => !hs.some(h => c.texto.includes(h.nombre))), 'chips without the dweller\'s name');
ver(vistas.every(c => c.title.includes('Conversation')), 'who and the conversation in the title');
ver(vistas.some(c => c.urgente), 'the waiting room stays in view');
const row = await pg.evaluate(() => { const f = document.querySelector('.barra-fila.com'); return f.scrollWidth <= f.clientWidth + 1 && f.getBoundingClientRect().right <= innerWidth; });
ver(row, 'the COM row fits in the window');
await pg.screenshot({ path: `${dir}/qa-barra-com.png` });
await pg.hover('.barra-fila.com > .barra-mas'); await espera(300);
const lista = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo-mas .chip-terminal')].map(x => x.textContent.trim()));
ver(lista.length === hs.length - vistas.length, `hovering «+N» lists the ${lista.length} hidden rooms`);
await pg.screenshot({ path: `${dir}/qa-barra-com-mas.png` });
// keyboard: past the last chip in view, the «+N» chip is marked and its list opens on the room chosen
await pg.mouse.move(400, 100); await espera(400);
await pg.keyboard.press('b'); await espera(200);
for (let i = 0; i < vistas.length; i++) await pg.keyboard.press('ArrowRight');
await espera(200);
const k = await pg.evaluate(() => ({ mas: !!document.querySelector('.barra-fila.com > .barra-mas.marcado'), marcada: document.querySelector('.barra-asomo-mas .chip-terminal.marcado')?.textContent.trim() }));
ver(k.mas && !!k.marcada, `→ past the chips in view goes into «+N» (${k.marcada})`);
await pg.screenshot({ path: `${dir}/qa-barra-com-teclado.png` });
await pg.keyboard.press('Escape');
ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

// QA of the bar's COM row when many rooms have conversations: compact chips (room · state · count, who and what in the
// title) and the «+N» chip for those that don't fit, the waiting ones kept in view and the row sticky when switching
// conversations; its list and each chip's hover, one row per dweller or hologram (bust, name, state; no conversations),
// the one a click opens selected; the ⋯ N list headed by whose the tabs are; the keyboard goes through them all.
// Conversations are made up in the page (nothing reaches Claude Code).
// Uso: SHELTER_DATOS=… node scripts/qa-com-bar.mjs <url> [carpeta-capturas]   (a test shelter with several rooms)
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
const lista = await pg.evaluate(() => ({ grupos: document.querySelectorAll('.barra-asomo-mas .barra-asomo-grupo').length, filas: [...document.querySelectorAll('.barra-asomo-mas .barra-asomo-fila')].map(x => ({ texto: x.textContent, busto: !!x.querySelector('.consola-quien-foto'), sel: x.classList.contains('sel') })) }));
ver(lista.grupos === hs.length - vistas.length && lista.filas.length === lista.grupos, `hovering «+N» lists the ${lista.grupos} hidden rooms, one row per dweller`);
ver(lista.filas.every(x => x.busto && !x.texto.includes('Conversation')), 'each row with its bust and no conversation title');
ver(lista.filas.filter(x => x.sel).length === 1 && lista.filas[0].sel, 'the most important one selected');
await espera(500); await pg.screenshot({ path: `${dir}/qa-barra-com-mas.png` });
// sticky: opening a hidden room swaps out one chip in view; switching between rooms afterwards moves nothing
const nombres = () => pg.evaluate(() => [...document.querySelectorAll('.barra-ventanas .barra-fila.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0]));
const antes = await nombres();
await pg.click('.barra-asomo-mas .barra-asomo-fila'); await espera(400);
const tras = await nombres();
ver(antes.filter(n => !tras.includes(n)).length <= 1 && antes.filter(n => tras.includes(n)).join() === tras.filter(n => antes.includes(n)).join(), `opening a hidden room swaps out at most one chip (the room it frees may bring another back), the rest keep their order (${antes.join(', ')} → ${tras.join(', ')})`);
const masX = () => pg.evaluate(() => document.querySelector('.barra-fila.com > .barra-mas')?.getBoundingClientRect().right);
const x0 = await masX();
for (const i of [0, tras.length - 1, 1]) { await pg.click(`.barra-fila.com > .chip-terminal:not(.barra-mas) >> nth=${i}`); await espera(300); }
ver((await nombres()).join() === tras.join() && (await masX()) === x0, 'switching conversations keeps the row and «+N» where they were');
// a chip's hover, even with a single dweller: who it is, selected
await pg.hover('.barra-fila.com > .chip-terminal:not(.barra-mas) >> nth=0'); await espera(300);
const uno = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo:not(.barra-asomo-mas) .barra-asomo-fila')].map(x => ({ busto: !!x.querySelector('.consola-quien-foto'), sel: x.classList.contains('sel') })));
ver(uno.length === 1 && uno[0].busto && uno[0].sel, 'hovering a chip with one dweller shows them, selected');
await pg.evaluate(() => window.__juego.set({ talkingWith: null })); await espera(300);
// keyboard: past the last chip in view, the «+N» chip is marked and its list opens on the room chosen
await pg.mouse.move(400, 100); await espera(400);
await pg.keyboard.press('b'); await espera(200);
for (let i = 0; i < (await nombres()).length; i++) await pg.keyboard.press('ArrowRight');
await espera(200);
const k = await pg.evaluate(() => ({ mas: !!document.querySelector('.barra-fila.com > .barra-mas.marcado'), marcada: document.querySelector('.barra-asomo-mas .barra-asomo-fila.sel')?.textContent.trim() }));
ver(k.mas && !!k.marcada, `→ past the chips in view goes into «+N» (${k.marcada})`);
await pg.screenshot({ path: `${dir}/qa-barra-com-teclado.png` });
await pg.keyboard.press('Escape');
// a hologram in a hidden room: its own row in «+N», and its own header with its task in the ⋯ N list
await espera(300);
const hidden = await pg.evaluate(() => { const v = new Set([...document.querySelectorAll('.barra-fila.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0])); return window.__juego.get().habitantes.find(h => !h.robot && !v.has(h.nameRoom) && window.__intercoms.get().lista.some(w => w.dwellerId === h.id)); });
ver(!!hidden, 'a hidden room to give a hologram');
if (hidden) {
  await pg.evaluate(h => {
    const id = 'holo:/tmp/shelter-qa-task--x1';
    const copia = { ...h, id, copia: { ruta: '/tmp/shelter-qa-task--x1', rama: 'qa-task', authorId: h.id, nameAuthor: h.nombre, nicknameAuthor: h.mote, cambios: 0, advanced: 0 } };
    window.__juego.set(e => ({ ...e, copias: [...e.copias, copia] }));
    // its intercom before its session, or the game opens one for it first
    window.__intercoms.set(e => ({ lista: [...e.lista, { dwellerId: id, pestanas: [{ id: 'qph', vista: { tipo: 'sesion', sesionId: 'qah' } }], activa: 'qph', maximizada: false, z: 99, known: [] }] }));
    window.__live.set(e => ({ ...e, sesiones: { ...e.sesiones, qah: { id: 'qah', dwellerId: id, salaId: h.sala, cwd: '/tmp/shelter-qa-task--x1', estado: 'esperando', sinLeer: false, titulo: 'Hologram', pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, actualizada: Date.now() } } }));
  }, hidden);
  await espera(300);
  await pg.hover('.barra-fila.com > .barra-mas'); await espera(500);
  const filas = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo-mas .barra-asomo-fila')].map(x => ({ copia: x.classList.contains('de-copia'), texto: x.textContent })));
  ver(filas.filter(f => f.copia).length === 1, `the hologram has its own row in «+N» (${filas.find(f => f.copia)?.texto})`);
  await pg.screenshot({ path: `${dir}/qa-barra-com-holo.png` });
  await pg.mouse.move(400, 100); await espera(400);
  await pg.click('.barra-fila.com .vt-todas'); await espera(400);
  const todas = await pg.evaluate(() => ({ quien: [...document.querySelectorAll('.barra-lista-com .vt-lista-quien')].map(x => ({ busto: !!x.querySelector('.consola-quien-foto'), tarea: !!x.querySelector('.marca-tarea'), copia: x.classList.contains('de-copia') })), filas: document.querySelectorAll('.barra-lista-com .vt-lista-fila').length }));
  ver(todas.quien.length === hs.length + 1 && todas.quien.every(x => x.busto), `⋯ N: one header with a bust per dweller or hologram (${todas.quien.length}) over its ${todas.filas} tabs`);
  ver(todas.quien.filter(x => x.tarea).length === 1 && todas.quien.find(x => x.tarea)?.copia, '⋯ N: the hologram\'s header carries its task');
  await pg.screenshot({ path: `${dir}/qa-barra-com-todas.png` });
}
ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

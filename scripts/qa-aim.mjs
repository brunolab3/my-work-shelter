// QA del ratón sobre lo que se puede usar: al pasar por encima de un aparato (lo que se ve de él: el tablero de
// Logística, la pantalla, el sillón…), de un habitante o del ascensor sale su letrero con «Clic», y un clic lo usa al
// momento (abre su panel) mientras el Supervisor llega andando. Recorre todos los aparatos de las salas especiales.
// Uso: node scripts/qa-apuntar.mjs [url] [carpeta-capturas]   (SHELTER_DATOS para el token; mejor un refugio de pruebas)
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const gpu = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
// sin el Chromium de Playwright descargado, el Google Chrome del Mac
const b = await chromium.launch(gpu).catch(() => chromium.launch({ ...gpu, channel: 'chrome' }));
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errores = [];
pg.on('pageerror', e => errores.push(e.message));
await pg.goto(withToken(url0 + (url0.includes('?') ? '&' : '?') + 'res=0.5'), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); });
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
const hasta = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await espera(150); } return false; };
const letreros = () => pg.evaluate(() => [...document.querySelectorAll('#etiquetas .etiqueta')].map(e => e.textContent));
// el centro en pantalla de la primera zona de un aparato (o de su columna, si la sala no la mide)
const centro = (salaId, id) => pg.evaluate(([salaId, id]) => {
  const r = window.__refugio, s = r.salas.find(x => x.id === salaId), it = s.interactive.find(i => i.id === id);
  const z = it.zones?.[0]; const THREE = r.supervisor.raiz.position.constructor;
  const c = z ? new THREE((z.min.x + z.max.x) / 2, z.max.y - Math.min(0.25, (z.max.y - z.min.y) / 4), z.max.z).add(s.grupo.position) : new THREE(s.grupo.position.x + it.x, s.grupo.position.y + 1.2, it.z - 0.6);
  c.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect();
  return { x: lz.left + (c.x + 1) / 2 * lz.width, y: lz.top + (1 - c.y) / 2 * lz.height, medida: !!z, texto: it.texto, panel: it.panel };
}, [salaId, id]);

// la cámara llega con suavidad: se espera a que se quede quieta (con swiftshader va a pocos fotogramas)
const quieta = async () => { let ant = ''; for (let i = 0; i < 60; i++) { const p = await pg.evaluate(() => window.__engine.camera.position.toArray().map(v => v.toFixed(2)).join()); if (p === ant) return; ant = p; await espera(250); } };
// sin panel ni conversación abiertos (un clic que cae en quien está delante del aparato abre la charla)
// y las ventanas que abre un aparato (el cliente de git, Spotify), minimizadas con ⌘M hasta que se vea el lienzo
const cerrar = async () => {
  await pg.evaluate(() => { if (window.__juego.get().talkingWith) window.dispatchEvent(new CustomEvent('refugio:fin-dialogo')); window.__juego.set({ panel: null, panelData: null, talkingWith: null }); });
  for (let i = 0; i < 4; i++) {
    const x = pg.locator('button.consola-x[title^="Cerrar"]'); if (!(await x.count())) break;
    await x.first().click(); await espera(400);
  }
};
// qué aparato se ha usado (algunos no dejan panel: abren su ventana y lo quitan)
await pg.evaluate(() => { const r = window.__refugio, usar = r.useDevice.bind(r); r.useDevice = (s, it) => { window.__used = it.id; usar(s, it); }; const ap = r.apuntar.bind(r); r.apuntar = n => { const x = ap(n); window.__last = x && (x.tipo + ':' + (x.it?.id ?? x.h?.id?.nombre ?? x.planta ?? '')); return x; }; const goA = r.goAPoint.bind(r); r.goAPoint = (d, f) => { window.__ida = [d.x.toFixed(2), d.y.toFixed(2), d.z.toFixed(2), !!f].join(); goA(d, f); }; });
const devices = await pg.evaluate(() => window.__refugio.salas.filter(s => s.tipo !== 'repo' && s.tipo !== 'coordinacion').flatMap(s => (s.interactive ?? []).filter(i => !i.id.startsWith('vis:')).map(i => ({ sala: s.id, id: i.id }))));
await espera(3000); await quieta();   // la entrada al refugio
for (const a of devices) {
  await pg.evaluate(id => { window.__juego.set({ panel: null, panelData: null }); window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: id } })); }, a.sala);
  await espera(500); await quieta();
  let c = await centro(a.sala, a.id);
  const ok = await hasta(async () => { c = await centro(a.sala, a.id); await pg.mouse.move(c.x, c.y); return (await pg.evaluate(() => { const ap = window.__refugio.apuntado; return ap?.tipo === 'aparato' ? ap.it.id : null; })) === a.id; }, 10000);
  const ls = await letreros();
  if (!ok) console.log('      ', JSON.stringify(await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); const ap = window.__refugio.apuntado; const j = window.__juego.get(); return { encima: e?.tagName + '.' + (e?.className?.baseVal ?? e?.className), x, y, apuntado: ap && (ap.tipo + ':' + (ap.it?.id ?? ap.h?.id?.nombre ?? ap.planta)), talking: j.talkingWith, panel: j.panel, sala: window.__refugio.currentRoom?.id }; }, [c.x, c.y])));
  // con el Supervisor ya al lado, el letrero es el de siempre (sobre él, con E)
  ver(ok && ls.some(l => l.includes(c.texto) && /(Clic|E)\s*Usar/.test(l)), `${a.sala}/${a.id}${c.medida ? '' : ' (sin medir)'}: letrero «${c.texto}» al pasar el ratón`);
  if (a.sala === 'logistica' || a.id === 'tablero') await pg.screenshot({ path: path.join(dir, `apuntar-${a.sala}.png`) });
  await pg.evaluate(() => { window.__used = null; });
  // justo antes del clic, otra vez donde esté ahora (la cámara aún puede asentarse)
  await quieta(); c = await centro(a.sala, a.id); await pg.mouse.move(c.x, c.y); await espera(300);
  await pg.mouse.click(c.x, c.y);
  ver(await hasta(async () => (await pg.evaluate(() => window.__used)) === a.id, 1500), `${a.sala}/${a.id}: el clic lo usa al momento (${await pg.evaluate(() => window.__used + ' → ' + window.__juego.get().panel + ' · hablando: ' + window.__juego.get().talkingWith + ' · ruta: ' + window.__refugio.supervisor.ruta.length + ' · apuntado al clic: ' + window.__last + ' · ida: ' + window.__ida + ' · sp: ' + window.__refugio.supervisor.raiz.position.toArray().map(v => v.toFixed(2)))})`);
  await cerrar();
  await pg.mouse.move(5, 5); await espera(200);
}
// un habitante: «Clic Hablar»
const h = await pg.evaluate(() => {
  const r = window.__refugio, x = r.habitantes.find(h => h.p.raiz.visible); if (!x) return null;
  window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: x.sala.id } }));
  return x.id.nombre;
});
if (h) {
  await espera(500); await quieta();
  const p = await pg.evaluate(n => { const x = window.__refugio.habitantes.find(h => h.id.nombre === n); const v = x.p.raiz.position.clone(); v.y += 1.0; v.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect(); return { x: lz.left + (v.x + 1) / 2 * lz.width, y: lz.top + (1 - v.y) / 2 * lz.height }; }, h);
  const sobre = () => pg.evaluate(n => { const x = window.__refugio.habitantes.find(h => h.id.nombre === n); const v = x.p.raiz.position.clone(); v.y += 1.0; v.project(window.__engine.camera); const lz = document.querySelector('canvas').getBoundingClientRect(); return { x: lz.left + (v.x + 1) / 2 * lz.width, y: lz.top + (1 - v.y) / 2 * lz.height }; }, h);
  await hasta(async () => { const q = await sobre(); await pg.mouse.move(q.x, q.y); return (await pg.evaluate(() => window.__refugio.apuntado?.tipo)) === 'habitante'; }, 6000);
  const ls = await letreros();
  ver(ls.some(l => l.includes('Clic') && l.includes('Hablar')), `habitante ${h}: letrero con «Clic Hablar»`);
  ver(await pg.evaluate(() => document.querySelector('canvas').style.cursor) === 'pointer', 'el cursor es la mano');
}
await cerrar();
// arrastrar mueve la cámara y no manda al Supervisor a ningún sitio; al echar a andar, vuelve al encuadre
await pg.mouse.move(5, 5); await quieta();
const antes = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, sp: window.__refugio.supervisor.raiz.position.x }));
await pg.mouse.move(800, 600); await pg.mouse.down(); for (let i = 1; i <= 10; i++) await pg.mouse.move(800 - i * 40, 600); await pg.mouse.up();
await quieta();
const after = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, sp: window.__refugio.supervisor.raiz.position.x, des: window.__refugio.camara.desplazamiento.x, ruta: window.__refugio.supervisor.ruta.length }));
ver(after.cam - antes.cam > 2, `arrastrar 400 px a la izquierda mueve la cámara a la derecha (${(after.cam - antes.cam).toFixed(2)} m)`);
ver(Math.abs(after.sp - antes.sp) < 0.05 && !after.ruta, 'arrastrar no hace andar al Supervisor');
await pg.screenshot({ path: path.join(dir, 'apuntar-arrastre.png') });
// andando solo (la ruta de un clic), la cámara no le sigue ni deshace lo arrastrado
const solo = await pg.evaluate(() => { const r = window.__refugio, sp = r.supervisor.raiz.position; r.goAPoint(sp.clone().setX(sp.x - 2.5)); return { cam: window.__engine.camera.position.x, des: r.camara.desplazamiento.x }; });
await espera(1500);
const tras = await pg.evaluate(() => ({ cam: window.__engine.camera.position.x, des: window.__refugio.camara.desplazamiento.x }));
ver(Math.abs(tras.cam - solo.cam) < 0.3 && Math.abs(tras.des - solo.des) < 0.05, `andando solo, la cámara se queda donde se dejó (${(tras.cam - solo.cam).toFixed(2)} m)`);
await pg.keyboard.down('KeyD'); await espera(1500); await pg.keyboard.up('KeyD');
ver(await hasta(async () => Math.abs(await pg.evaluate(() => window.__refugio.camara.desplazamiento.x)) < 0.3, 6000), 'al andar, la cámara vuelve a seguir al Supervisor');
ver(!errores.length, 'sin errores en la página' + (errores.length ? ': ' + errores.join(' | ') : ''));
await b.close();
console.log(failures ? `${failures} fallo(s)` : 'todo bien');
process.exit(failures ? 1 : 0);

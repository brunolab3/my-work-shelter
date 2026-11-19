// QA of the next-meeting alert (top bar clock slot + the 1-minute box): amber 10 min before, red pulse 3 min before,
// and 1 min before the box over everything (also over an open panel), once per event; Esc dismisses it. Events are
// injected into the page store (no calendar, no Claude sessions).
// Usage: node scripts/qa-meeting.mjs [url] [screenshots-dir]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', dir = '/tmp/qa-reunion-capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errores = [];
pg.on('pageerror', e => errores.push(e.message));
const espera = ms => pg.waitForTimeout(ms);
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FALLO ') + texto); if (!ok) failures++; };
// one meeting starting in `seg` seconds (plus an all-day one, which never sounds the alarm)
const poner = (id, seg, extra = {}) => pg.evaluate(([id, seg, extra]) => {
  const ahora = Date.now(), dia = new Date().setHours(0, 0, 0, 0);
  window.__live.set({ eventos: [
    { id: 'fiesta', fuente: 'google', titulo: 'Holiday', inicio: dia, fin: dia + 86400_000, allElDay: true },
    { id, fuente: 'google', titulo: 'Sprint planning', inicio: ahora + seg * 1000, fin: ahora + seg * 1000 + 1800_000, allElDay: false, videollamada: 'https://meet.google.com/abc-defg-hij', ...extra },
  ] });
}, [id, seg, extra]);
const slot = () => pg.evaluate(() => { const c = [...document.querySelectorAll('.contador')].find(x => x.querySelector('.tecla')?.textContent === 'C'); return c && { clase: c.className, texto: c.textContent }; });
const caja = () => pg.evaluate(() => { const c = document.querySelector('.reunion-caja'); if (!c) return null; const r = c.getBoundingClientRect(); const encima = document.elementFromPoint(r.x + r.width / 2, r.y + 8); return { texto: c.textContent, encima: !!encima && c.contains(encima) }; });
const barra = { clip: { x: 0, y: 0, width: 1600, height: 90 } };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); });

await poner('m1', 30 * 60);
await espera(1200);
let s = await slot();
ver(s && !/pronto|inminente/.test(s.clase) && /Sprint/.test(s.texto), `30 min before: plain, and the timed meeting beats the all-day one (${s?.clase} · ${s?.texto})`);
await poner('m1', 8 * 60);
await espera(1200);
s = await slot();
ver(s && / pronto/.test(s.clase), `8 min before: amber (${s?.clase})`);
await pg.screenshot({ path: `${dir}/1-ambar.png`, ...barra });
await poner('m1', 2 * 60);
await espera(1200);
s = await slot();
ver(s && / inminente/.test(s.clase), `2 min before: red (${s?.clase})`);
ver(!(await caja()), 'no box yet');
await pg.screenshot({ path: `${dir}/2-rojo.png`, ...barra });

// 1 min before, with a panel open: the box goes over it
await pg.evaluate(() => window.__juego.set({ panel: 'menu', panelData: null }));
await espera(400);
await poner('m1', 50);
await espera(1500);
let c = await caja();
ver(c && /Sprint planning/.test(c.texto) && /1 min/.test(c.texto) && /Join|Unirse/.test(c.texto), `1 min before: the box (${c?.texto})`);
ver(c?.encima, 'the box is on top of the open panel');
await pg.screenshot({ path: `${dir}/3-aviso.png` });
await pg.keyboard.press('Escape');
await espera(400);
ver(!(await caja()), 'Esc dismisses it');
ver(await pg.evaluate(() => window.__juego.get().panel === 'menu'), 'and the panel underneath is still open');
await poner('m1', 45);
await espera(1500);
ver(!(await caja()), 'once per event: it does not come back');
await poner('m2', 40, { videollamada: undefined, enlace: undefined });
await espera(1500);
c = await caja();
ver(c && !/Join|Unirse/.test(c.texto), 'another event shows it again; without a link, no Join');
await pg.keyboard.press('Escape');

ver(!errores.length, 'no page errors' + (errores.length ? ': ' + errores.join(' | ') : ''));
console.log(`\nscreenshots: ${dir}`);
await b.close();
process.exit(failures ? 1 : 0);

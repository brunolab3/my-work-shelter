// QA de lo escrito en el intercomunicador y de ⌘C, con teclado real (Playwright) y una sesión real de Claude Code
// (Haiku, un trabajo corto): ⌘C copia lo seleccionado en la conversación (pulsar ⌘ no se lleva el foco al campo);
// lo escrito en una conversación y en un trabajo nuevo sin lanzar sobrevive a recargar la página; si la conversación
// se cierra sin que la cierre el Supervisor, la pestaña se queda con lo escrito para retomarla; Esc con algo escrito
// solo lo borra a la segunda; cerrar a mano una pestaña con algo escrito pregunta.
// Uso: node scripts/qa-drafts.mjs [url]   (con un refugio de pruebas: SHELTER_DATOS=/tmp/x npm run dev)
// Ojo: lanza sesiones reales de Claude Code (gastan de tu plan) y puede aprobar permisos: úsalo contra un refugio de
// pruebas (arranca el juego con SHELTER_DATOS=/ruta/temporal), nunca contra el tuyo.
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(300); } return false; };
const load = async () => {
  await pg.goto(withToken(url0), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
};
const talk = h => pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
const options = () => pg.evaluate(() => [...document.querySelectorAll('.console .opciones-consola li')].map(l => l.textContent.replace('▶', '').trim()));
const chooseMenu = async text => { const i = (await options()).findIndex(o => o.startsWith(text)); for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await wait(400); };
const field = () => pg.evaluate(() => document.querySelector('.console textarea')?.value ?? null);
const tabs = () => pg.evaluate(() => [...document.querySelectorAll('.console .vt-tab')].map(p => p.textContent.replace('×', '').trim()));

await load();
const h = await pg.evaluate(() => { const hs = window.__game.get().dwellers; return hs.find(h => h.path && h.room !== 'bridge' && !h.robot) ?? hs.find(h => h.path); });
console.log('Habitante:', h.name, '·', h.nameRoom);
await talk(h);
await pg.waitForSelector('.console .opciones-consola');
await chooseMenu('Empezar');
await pg.keyboard.type('Responde solo con la frase: el refugio aguanta.', { delay: 2 });
await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');   // Haiku
await pg.keyboard.press('Enter');
check(await until(async () => (await pg.$('.console .session')) !== null, 20000), 'el trabajo arranca y se ve la conversación');
const sessionId = await pg.evaluate(id => Object.values(window.__live.get().sessions).find(s => s.dwellerId === id && s.state !== 'closed')?.id, h.id);
check(await until(async () => pg.evaluate(id => ['finished', 'idle'].includes(window.__live.get().sessions[id]?.state), sessionId), 90000), 'el trabajo termina');
await until(async () => pg.evaluate(() => /aguanta/i.test(document.querySelector('.console .ent.asistente')?.textContent ?? '')), 10000);

// ---- ⌘C copia lo seleccionado en la conversación
await pg.evaluate(() => { const el = document.querySelector('.console .ent.asistente'); (document.activeElement)?.blur?.(); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await pg.keyboard.down('Meta'); await wait(80);
const after = await pg.evaluate(() => ({ sel: getSelection().toString(), focus: document.activeElement?.tagName }));
check(/aguanta/i.test(after.sel) && after.focus !== 'TEXTAREA', `pulsar ⌘ no se lleva la selección al campo (foco: ${after.focus})`);
await pg.evaluate(() => navigator.clipboard.writeText('-'));
await pg.keyboard.press('c'); await pg.keyboard.up('Meta'); await wait(200);
const copied = await pg.evaluate(() => navigator.clipboard.readText());
check(/aguanta/i.test(copied), `⌘C copia la respuesta seleccionada («${copied.trim().slice(0, 40)}»)`);
// escribir sin estar en el campo sigue llevando a él
await pg.keyboard.type('Esto es un borrador largo de la conversación', { delay: 2 });
check((await field())?.startsWith('Esto es un borrador'), 'escribir fuera del campo lleva a él');

// ---- Esc con algo escrito: a la primera no se borra; a la segunda, sí (y se reescribe)
await pg.focus('.console textarea'); await pg.keyboard.press('Escape'); await wait(150);
check((await field())?.startsWith('Esto es un borrador') && await pg.isVisible('.console'), 'Esc con algo escrito no lo borra a la primera');
await pg.keyboard.press('Escape'); await wait(150);
check((await field()) === '', 'Esc otra vez, enseguida, sí lo borra');
await pg.keyboard.type('Esto es un borrador largo de la conversación', { delay: 2 });

// ---- otra pestaña con un trabajo nuevo sin lanzar
await pg.keyboard.press('Meta+t'); await wait(500);
await chooseMenu('Empezar');
await pg.keyboard.type('Un trabajo nuevo que aún no he lanzado', { delay: 2 });
await wait(500);

// ---- recargar la página («Aplicar los cambios del juego»): todo sigue
await load();
await talk(h);
await pg.waitForSelector('.console');
await until(async () => (await tabs()).length === 2, 8000);
check((await tabs()).length === 2, `tras recargar, las dos pestañas siguen (${(await tabs()).join(' | ')})`);
check((await field()) === 'Un trabajo nuevo que aún no he lanzado', 'y el trabajo nuevo sin lanzar conserva lo escrito');
check(await pg.evaluate(() => document.querySelectorAll(".console .vt-tab .marca-borrador").length === 2), "las dos pestañas con algo escrito llevan ✎");
await pg.keyboard.press('Meta+1'); await wait(400);
check(await pg.$('.console .session') !== null && (await field()) === 'Esto es un borrador largo de la conversación', 'y la conversación conserva su borrador');

// ---- la conversación se cierra sin que el Supervisor la cierre (sola, al reiniciar, desde fuera)
await pg.evaluate(id => window.__client.send({ t: 'closeSession', sessionId: id }), sessionId);
await until(async () => (await pg.$('.console .transcripcion-previa')) !== null, 8000);
check(await pg.$('.console .transcripcion-previa') !== null && (await field()) === 'Esto es un borrador largo de la conversación', 'cerrada sola, la pestaña se queda para retomarla con lo escrito');
await load(); await talk(h); await pg.waitForSelector('.console'); await wait(800);
check((await tabs()).length === 2, 'y sigue ahí tras otra recarga');

// ---- cerrar a mano una pestaña con algo escrito pregunta
await pg.keyboard.press('Meta+w'); await wait(300);
check(await pg.isVisible('.vt-confirmar'), '⌘W con algo escrito pregunta antes de borrarlo');
await pg.keyboard.press('Escape'); await wait(300);
check(!(await pg.isVisible('.vt-confirmar')) && (await tabs()).length === 2 && !!(await field()), 'Esc cancela y lo escrito sigue');
// limpieza: se borra a propósito
await pg.keyboard.press('Meta+Shift+w'); await wait(300); await pg.keyboard.press('Enter'); await wait(500);
check(!(await pg.isVisible('.console')), 'cerrar y borrarlo, confirmado, cierra');

check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' · ') : ''));
await b.close();
console.log(failures ? `\n${failures} fallos` : '\nTodo bien');
process.exit(failures ? 1 : 0);

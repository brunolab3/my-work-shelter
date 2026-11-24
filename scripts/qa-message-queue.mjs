// QA of the queue of a busy conversation (shared/messageQueue.ts), with a real Claude Code session (Haiku, three short
// `sleep` calls): what is sent while it works waits in «Queued (n)» above the composer, with the count on its tab and
// on the dweller's tag; it moves into the log at the next tool boundary, before the turn ends; Withdraw takes one back
// (it never reaches the log) and Edit takes it back to the composer.
// Usage: node scripts/qa-message-queue.mjs [url] [dwellerId] [screenshots-dir]   (with a test shelter:
// SHELTER_DATOS=/tmp/x npm run dev; the dweller defaults to the Command Bridge's, whose room is always the game's own folder)
// Careful: it starts real Claude Code sessions (they use your plan) and may approve permissions: run it against a test
// shelter (start the game with SHELTER_DATOS=/some/temp/folder), never against yours.
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', dwellerId = 'nestor', shots] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(250); } return false; };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const h = await pg.evaluate(id => window.__game.get().dwellers.find(h => h.id === id), dwellerId);
console.log('Dweller:', h.name, '·', h.nameRoom);
// a run before may have left its conversation open: the intercom would open on it instead of the menu
await pg.evaluate(id => { for (const s of Object.values(window.__live.get().sessions)) if (s.dwellerId === id && s.state !== 'cerrada') window.__client.send({ t: 'closeSession', sessionId: s.id }); }, dwellerId);
await wait(1500);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.consola .opciones-consola');
const options = await pg.evaluate(() => [...document.querySelectorAll('.consola .opciones-consola li')].map(l => l.textContent.replace('▶', '').trim()));
const i = options.findIndex(o => /^(Empezar|Start)/.test(o));
for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown');
await pg.keyboard.press('Enter'); await wait(400);
await pg.keyboard.type('Run these Bash commands one at a time, each as its own tool call: `sleep 8; echo one`, `sleep 8; echo two`, `sleep 8; echo three`. Then reply DONE.', { delay: 1 });
await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');   // Haiku
await pg.keyboard.press('Enter');
check(await until(async () => (await pg.$('.consola .sesion')) !== null, 20000), 'the job starts');
const sessionId = await pg.evaluate(id => Object.values(window.__live.get().sessions).find(s => s.dwellerId === id && s.state !== 'cerrada')?.id, h.id);
const session = () => pg.evaluate(id => window.__live.get().sessions[id], sessionId);
// a folder with its own Claude Code config asks for trust first: without it (only your user settings)
await until(async () => (await session())?.pending?.type === 'confianza' || (await session())?.activity, 20000);
const trust = (await session())?.pending;
if (trust?.type === 'confianza') await pg.evaluate(([sessionId, requestId]) => window.__client.send({ t: 'answer', sessionId, requestId, decision: 'no' }), [sessionId, trust.id]);
check(await until(async () => (await session())?.activity?.mode === 'terminal', 60000), 'it is running its first command');
if ((await session())?.pending) { console.log('It waits for you:', (await session()).pending.title, '— answer it (or pick a dweller whose folder needs no permission) and run again'); process.exit(1); }

const send = async text => { await pg.focus('.consola .sesion textarea'); await pg.keyboard.type(text, { delay: 1 }); await pg.keyboard.press('Enter'); };
await send('First queued: also tell me 2+2.');
check(await until(async () => (await session())?.queue?.length === 1), 'a message sent while it works waits in its queue');
check(await pg.$eval('.consola .cola-mensajes', el => /\(1\)/.test(el.textContent)).catch(() => false), 'the intercom shows «Queued (1)» above the composer');
check(!(await pg.evaluate(() => [...document.querySelectorAll('.consola .ent.usuario')].some(e => e.textContent.includes('First queued')))), 'it is not in the log yet');
check(await pg.$eval('.consola .vt-pestana.activa .marca-cola', el => el.textContent.includes('1')).catch(() => false), 'its tab shows ✉ 1');
check(await until(() => pg.evaluate(() => [...document.querySelectorAll('.etiqueta .en-cola')].some(el => el.style.display !== 'none' && el.textContent.includes('1'))), 5000), "the dweller's tag in the shelter shows ✉ 1");

await send('Second queued: withdraw me.');
await send('Third queued: edit me.');
check(await until(async () => (await session())?.queue?.length === 3), 'three wait in the queue');
if (shots) { await wait(300); await pg.screenshot({ path: `${shots}/queue.png` }); await pg.screenshot({ path: `${shots}/queue-intercom.png`, clip: await pg.$eval('.consola', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }); }
// each of the Overseer's rows: [Edit, Withdraw]
const click = (text, button) => pg.evaluate(([text, button]) => { const row = [...document.querySelectorAll('.consola .cola-mensaje')].find(r => r.textContent.includes(text)); row?.querySelectorAll('.cola-acciones button')[button]?.click(); }, [text, button]);
await click('Second queued', 1);
check(await until(async () => !(await session())?.queue?.some(m => m.text.includes('Second queued')), 5000), 'Withdraw takes it out of the queue');
await click('Third queued', 0);
check(await until(async () => (await pg.$eval('.consola .sesion textarea', el => el.value)).includes('Third queued'), 5000), 'Edit takes it back to the composer');
await pg.fill('.consola .sesion textarea', '');

// at the next tool boundary, before the turn ends, the first one moves into the log
check(await until(async () => pg.evaluate(() => [...document.querySelectorAll('.consola .ent.usuario')].some(e => e.textContent.includes('First queued'))), 40000), 'the first one moves into the log when it takes it');
const s = await session();
check(s.state === 'trabajando' && !s.queue?.length, `…while its turn still runs (state ${s.state}), and the queue is empty (${JSON.stringify(s.queue?.map(m => m.text) ?? [])})`);
check(await until(async () => ['terminada', 'ociosa'].includes((await session())?.state), 90000), 'the job ends');
check(!(await pg.evaluate(() => [...document.querySelectorAll('.consola .ent.usuario')].some(e => e.textContent.includes('Second queued')))), 'the withdrawn one never reached the log');

check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await b.close();
console.log(failures ? `${failures} failure(s)` : 'All OK');
process.exit(failures ? 1 : 0);

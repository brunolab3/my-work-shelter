// QA of the teletypes (top-left notices): a new one shows on its own and then folds into one "earlier notices" slot
// with the most severe level's color; questions never fold; clicking the slot unfolds them, clicking one dismisses it,
// "read all" dismisses them all; the same in the maximized-window row layout. Notices are injected into the page store
// (no server action, no Claude sessions).
// Usage: node scripts/qa-teletypes.mjs [url] [screenshots-dir]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', dir = '/tmp/qa-teletipos-capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const loose = () => pg.evaluate(() => [...document.querySelectorAll('.teletipos > .teletipo')].map(e => e.textContent));
const group = () => pg.evaluate(() => { const g = document.querySelector('.teletipo.group'); return g && { text: g.textContent, kind: g.className, list: [...document.querySelectorAll('.teletipos-grupo .lista .teletipo')].map(e => e.textContent) }; });
// `edad`: how long ago it arrived (the id is the arrival time)
const set = list => pg.evaluate(list => window.__live.set(v => ({ notices: [...v.notices, ...list.map(([level, text, age = 0, question]) => ({ id: Date.now() - age + Math.random(), level, text, question }))] })), list);

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); window.__live.set({ notices: [] }); });

// ---- old ones fold, new ones and questions stay on their own
await set([['info', 'Repo fever2 synced', 60000], ['warning', 'Jira token expires in 3 days', 50000], ['info', 'Slack reconnected', 40000], ['info', 'Spotify paused', 30000],
  ['info', 'Room puente: question', 20000, { id: 'q1', si: 'Yes', no: 'No' }], ['info', 'Calendar refreshed', 0]]);
await wait(300);
let g = await group();
check(g && /4/.test(g.text) && g.list.length === 0, `the 4 old ones fold into one slot (${g?.text})`);
check(g && / aviso/.test(g.kind), 'the slot takes the most severe level\'s color (aviso)');
let s = await loose();
check(s.some(x => /question/.test(x)) && s.some(x => /Calendar/.test(x)) && s.length === 2, 'the question and the new one stay on their own: ' + s.length);
await pg.screenshot({ path: `${dir}/1-plegados.png`, clip: { x: 0, y: 0, width: 700, height: 360 } });
// the new one folds by itself after its few seconds
await wait(5500);
g = await group();
check(g && /5/.test(g.text) && (await loose()).length === 1, `after 5 s the new one folds too (${g?.text}); the question doesn't`);
await set([['error', 'Server restarted: reopen the conversation', 30000]]);
await wait(200);
check(/ error/.test((await group()).kind), 'an old error turns the slot red');

// ---- unfold, dismiss one, read all
await pg.click('.teletipo.group'); await wait(300);
g = await group();
check(g.list.length === 6 && /▾/.test(g.text), `clicking the slot unfolds the 6 (${g.list.length})`);
await pg.screenshot({ path: `${dir}/2-desplegados.png`, clip: { x: 0, y: 0, width: 700, height: 560 } });
await pg.click('.teletipos-grupo .lista .teletipo >> text=Slack reconnected'); await wait(200);
g = await group();
check(g.list.length === 5 && !g.list.some(x => /Slack/.test(x)), 'clicking one dismisses just that one');
check(await pg.evaluate(() => !window.__live.get().notices.some(a => /Slack/.test(a.text))), 'and it leaves the store (doesn\'t come back)');
// maximized row layout: open a terminal-like maximized window by class and check the slot unfolds below
await pg.evaluate(() => { const d = document.createElement('div'); d.className = 'maximizada qa-falsa'; d.style.display = 'none'; document.getElementById('ui').appendChild(d); });
await wait(200);
const box = await pg.evaluate(() => { const r = document.querySelector('.teletipos').getBoundingClientRect(), l = document.querySelector('.teletipos-grupo .lista').getBoundingClientRect(), q = document.querySelector('.teletipos > .teletipo.question').getBoundingClientRect(); return { row: r.left > 300, listBelow: l.top > 10, questionBeside: q.left > l.left && q.top < l.top }; });
check(box.row && box.listBelow && box.questionBeside, 'maximized: one row, the unfolded list drops below the slot, the question beside it ' + JSON.stringify(box));
await pg.screenshot({ path: `${dir}/3-ampliada.png`, clip: { x: 300, y: 0, width: 1300, height: 360 } });
await pg.evaluate(() => document.querySelector('.qa-falsa').remove());
await pg.click('.teletipo.group .leer-todos'); await wait(300);
check(!(await group()) && (await loose()).length === 1, '"read all" dismisses them all; the question stays');
await pg.click('.teletipo.question button >> nth=0').catch(() => {}); await wait(200);
check((await loose()).length === 0, 'answering the question removes it');
await pg.screenshot({ path: `${dir}/4-leidos.png`, clip: { x: 0, y: 0, width: 700, height: 360 } });

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log(failures ? `${failures} failures` : 'all OK');
process.exit(failures ? 1 : 0);

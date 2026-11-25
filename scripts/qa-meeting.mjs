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
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
// one meeting starting in `seg` seconds (plus an all-day one, which never sounds the alarm)
const set = (id, seg, extra = {}) => pg.evaluate(([id, seg, extra]) => {
  const now = Date.now(), day = new Date().setHours(0, 0, 0, 0);
  window.__live.set({ events: [
    { id: 'fiesta', source: 'google', title: 'Holiday', start: day, end: day + 86400_000, allDay: true },
    { id, source: 'google', title: 'Sprint planning', start: now + seg * 1000, end: now + seg * 1000 + 1800_000, allDay: false, videollamada: 'https://meet.google.com/abc-defg-hij', ...extra },
  ] });
}, [id, seg, extra]);
const slot = () => pg.evaluate(() => { const c = [...document.querySelectorAll('.counter')].find(x => x.querySelector('.key')?.textContent === 'C'); return c && { kind: c.className, text: c.textContent }; });
const box = () => pg.evaluate(() => { const c = document.querySelector('.meeting-box'); if (!c) return null; const r = c.getBoundingClientRect(); const onTop = document.elementFromPoint(r.x + r.width / 2, r.y + 8); return { text: c.textContent, onTop: !!onTop && c.contains(onTop) }; });
const bar = { clip: { x: 0, y: 0, width: 1600, height: 90 } };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });

await set('m1', 30 * 60);
await wait(1200);
let s = await slot();
check(s && !/soon|imminent/.test(s.kind) && /Sprint/.test(s.text), `30 min before: plain, and the timed meeting beats the all-day one (${s?.kind} · ${s?.text})`);
await set('m1', 8 * 60);
await wait(1200);
s = await slot();
check(s && / soon/.test(s.kind), `8 min before: amber (${s?.kind})`);
await pg.screenshot({ path: `${dir}/1-ambar.png`, ...bar });
await set('m1', 2 * 60);
await wait(1200);
s = await slot();
check(s && / imminent/.test(s.kind), `2 min before: red (${s?.kind})`);
check(!(await box()), 'no box yet');
await pg.screenshot({ path: `${dir}/2-rojo.png`, ...bar });

// 1 min before, with a panel open: the box goes over it
await pg.evaluate(() => window.__game.set({ panel: 'menu', panelData: null }));
await wait(400);
await set('m1', 50);
await wait(1500);
let c = await box();
check(c && /Sprint planning/.test(c.text) && /1 min/.test(c.text) && /Join|Unirse/.test(c.text), `1 min before: the box (${c?.text})`);
check(c?.onTop, 'the box is on top of the open panel');
await pg.screenshot({ path: `${dir}/3-aviso.png` });
await pg.keyboard.press('Escape');
await wait(400);
check(!(await box()), 'Esc dismisses it');
check(await pg.evaluate(() => window.__game.get().panel === 'menu'), 'and the panel underneath is still open');
await set('m1', 45);
await wait(1500);
check(!(await box()), 'once per event: it does not come back');
await set('m2', 40, { videollamada: undefined, link: undefined });
await wait(1500);
c = await box();
check(c && !/Join|Unirse/.test(c.text), 'another event shows it again; without a link, no Join');
await pg.keyboard.press('Escape');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(`\nscreenshots: ${dir}`);
await b.close();
process.exit(failures ? 1 : 0);

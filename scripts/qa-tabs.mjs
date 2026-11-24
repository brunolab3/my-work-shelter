// QA of many tabs, with no Claude sessions (made-up conversations in the client): 16 conversations of one dweller in
// several states plus 3 of another dweller of the same room. Checks that tabs stay readable and the strip scrolls,
// most urgent first, the active tab does not move when its state changes, ⌘1/⌘9 follow the visible order, the bar's ⋯
// list (⌘⇧A) holds every intercom's conversations by room, filters, goes (switching intercom) and closes, the other
// dweller's conversations stay out of the strip and the selector above the portrait lists one row per talker of the
// room, keeps its width and switches the intercom on the picked talker's most urgent conversation, by click or keyboard, the bar has one intercom chip per room whose hover lists one row per open panel (dweller, holograms), and
// a terminal with 13 more tabs, whose ⋯ list stays in its strip.
// Usage: SHELTER_DATOS=… node scripts/qa-tabs.mjs [url] [screenshots-folder]   (best on a test shelter)
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(200); } return false; };
const tabs = () => pg.evaluate(() => [...document.querySelectorAll('.console .vt-tab')].map(p => ({ name: p.querySelector('.vt-pestana-nombre').textContent, state: (p.className.match(/e-(\w+)/) ?? [])[1], active: p.classList.contains('active'), width: p.getBoundingClientRect().width })));
const talking = () => pg.evaluate(() => window.__game.get().talkingWith);
const setLive = (id, extra) => pg.evaluate(([id, extra]) => window.__live.set(e => ({ sessions: { ...e.sessions, [id]: { ...e.sessions[id], ...extra } } })), [id, extra]);

// two dwellers of a room with a folder (the selector shows when the room has more than one talker)
const [h, h2] = await pg.evaluate(() => { const hs = window.__game.get().dwellers.filter(h => h.path && h.room !== 'bridge' && !h.robot); const a = hs.find(x => hs.some(y => y !== x && y.room === x.room)) ?? hs[0]; return [a, hs.find(x => x !== a && x.room === a.room)]; });
console.log('Dwellers:', h.name, '·', h.nameRoom, '|', h2?.name, '·', h2?.nameRoom);
const TITLES = ['Fix flaky checkout test', 'Review PR 4123 billing', 'Investigate Sentry 9981', 'Refactor auth middleware', 'Add retries to webhooks', 'Upgrade Angular to 21', 'Explain the pricing service', 'Draft migration for orders', 'Plan the B2B import', 'Pre-push checks', 'Why is CI red on main', 'Rename partner fields', 'Lint the whole repo', 'Port script to Python', 'Answer reviewer comments', 'Clean old worktrees'];
const STATES = ['idle', 'working', 'finished', 'idle', 'waiting', 'working', 'idle', 'finished', 'working', 'idle', 'error', 'idle', 'working', 'finished', 'idle', 'waiting'];
await pg.evaluate(([h, h2, T, E]) => {
  const sessions = {}, now = Date.now();
  const one = (id, d, title, state, i, cwd) => { sessions[id] = { id, dwellerId: d.id, roomId: d.room, cwd, state, unread: state === 'finished' && i % 3 !== 1, title, pending: 0, helpers: [], tools: 0, turns: 1, created: now - (40 - i) * 60000, updated: now - (40 - i) * 90000 }; };
  T.forEach((title, i) => one('qa-tab-' + i, h, title, E[i], i, h.path));
  if (h2) ['Deploy notes', 'Bump SDK', 'Flaky e2e'].forEach((title, i) => one('qa-tab-b' + i, h2, title, ['idle', 'waiting', 'working'][i], i, h2.path));
  window.__live.set(e => ({ sessions: { ...e.sessions, ...sessions } }));
}, [h, h2, TITLES, STATES]);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.console .vt-tab');
await until(async () => (await tabs()).length >= 16);
await wait(600);

// ---- readable and scrolling
const ps = await tabs();
const FOREIGN = ['Deploy notes', 'Bump SDK', 'Flaky e2e'];
check(ps.length >= 16 && !ps.some(p => FOREIGN.includes(p.name)), `the strip has this dweller's conversations only (${ps.length})`);
check(ps.every(p => p.width >= 80), 'no tab is squeezed below its minimum width: ' + Math.round(Math.min(...ps.map(p => p.width))) + 'px');
check(await pg.evaluate(() => { const c = document.querySelector('.console .vt-pestanas-tira'); return c.scrollWidth > c.clientWidth; }), 'the strip scrolls sideways');
const inView = () => pg.evaluate(() => { const c = document.querySelector('.console .vt-pestanas-tira').getBoundingClientRect(), a = document.querySelector('.console .vt-tab.active').getBoundingClientRect(); return a.left >= c.left - 1 && a.right <= c.right + 1; });
check(await inView(), 'the active tab is in view');
await pg.screenshot({ path: `${dir}/qa-pestanas-intercom.png` });

// ---- order: most urgent first
const rank = { waiting: 0, unread: 1, error: 2, working: 3, idle: 4 };
const inactive = (await tabs()).filter(p => !p.active).map(p => rank[p.state] ?? 5);
check(inactive.every((r, i) => !i || inactive[i - 1] <= r), 'waiting → unread → failed → working → idle: ' + (await tabs()).map(p => p.state).join(' '));

// ---- ⌘1 / ⌘9 follow the visible order; the active tab does not move under you
await pg.keyboard.press('Meta+9'); await wait(400);
let l = await tabs();
check(l.at(-1).active, '⌘9 goes to the last visible tab');
await pg.keyboard.press('Meta+1'); await wait(400);
l = await tabs();
check(l[0].active && await inView(), '⌘1 goes to the first visible tab, and the strip scrolls to it: ' + l[0].name);
// pick an idle tab, then make it the most urgent: it stays where it is until you switch away
const idle = (await tabs()).findLast(p => p.state === 'idle');
await pg.evaluate(n => [...document.querySelectorAll('.console .vt-tab')].find(p => p.querySelector('.vt-pestana-nombre').textContent === n).click(), idle.name); await wait(400);
const before = (await tabs()).findIndex(p => p.active);
await setLive('qa-tab-' + TITLES.indexOf(idle.name), { state: 'waiting' }); await wait(400);
check((await tabs()).findIndex(p => p.active) === before, 'the active tab keeps its place when its state changes');
await pg.keyboard.press('Meta+1'); await wait(400);
check((await tabs()).findIndex(p => p.name === idle.name) < before, 'once you switch away it moves up with the waiting ones');

// ---- the ⋯ list: in the bar's COM row, every open intercom conversation by room (⌘⇧A from the intercom)
const LIST = '.barra-lista-com .vt-lista';
check(!(await pg.isVisible('.console .vt-todas')) && await pg.isVisible('.barra-ventanas .com .vt-todas'), 'the ⋯ N button is in the bar\'s COM row, not in the intercom strip');
await pg.keyboard.press('Meta+Shift+a'); await wait(400);
check(await pg.isVisible(LIST), '⌘⇧A opens the list of every conversation');
const listNames = () => pg.evaluate(() => [...document.querySelectorAll('.barra-lista-com .vt-list-row .vt-lista-nombre')].map(x => x.textContent.replace(/^✎/, '')));
const ours = n => TITLES.includes(n) || FOREIGN.includes(n);
const rows = async () => (await listNames()).filter(ours).length;
const own = (await tabs()).length;
check(await rows() === own + (h2 ? FOREIGN.length : 0), `with one row per conversation, the other dweller's too (${await rows()})`);
check(await pg.evaluate(n => [...document.querySelectorAll('.barra-lista-com .vt-lista-grupo')].some(g => g.textContent === n), h.nameRoom), 'under a header per room');
await pg.screenshot({ path: `${dir}/qa-pestanas-lista.png` });
const comWidth = await pg.evaluate(L => Math.round(document.querySelector(L).getBoundingClientRect().width), LIST);
const withThe = TITLES.filter(x => /the/i.test(x));
await pg.keyboard.type('the', { delay: 10 }); await wait(300);
check(await rows() === withThe.length, `typing filters: ${await rows()} of ${withThe.length}`);
await pg.screenshot({ path: `${dir}/qa-pestanas-filtro.png` });
await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await wait(400);
const picked = await pg.evaluate(() => document.querySelector('.console .vt-tab.active .vt-pestana-nombre').textContent);
check(!(await pg.isVisible(LIST)) && withThe.includes(picked), '↓ Enter goes to a match and closes the list: ' + picked);
// close every idle one: none is running, so no question
const idleCount = (await tabs()).filter(p => p.state === 'idle').length;
const total = (await tabs()).length;
await pg.keyboard.press('Meta+Shift+a'); await wait(300);
await pg.click('.barra-lista-com .vt-lista-pie button:has-text("idle"), .barra-lista-com .vt-lista-pie button:has-text("reposo")'); await wait(500);
check(!(await pg.isVisible('.console .vt-confirmar')) && (await tabs()).length === total - idleCount, `«close read or idle» closes the ${idleCount} idle ones without asking`);
if (!(await pg.isVisible(LIST))) { await pg.keyboard.press('Meta+Shift+a'); await wait(300); }
await pg.focus('.barra-lista-com .vt-lista-filtro'); await pg.keyboard.press('Escape'); await wait(300);
check(!(await pg.isVisible(LIST)) && await pg.isVisible('.console'), 'Esc closes the list and only the list');
// another dweller's conversation: the intercom switches to them, on that tab
if (h2) {
  await pg.click('.barra-ventanas .com .vt-todas'); await wait(300);
  await pg.evaluate(() => [...document.querySelectorAll('.barra-lista-com .vt-list-row')].find(f => f.querySelector('.vt-lista-nombre').textContent === 'Flaky e2e').click());
  check(await until(async () => await talking() === h2.id && (await tabs()).find(p => p.active)?.name === 'Flaky e2e'), `clicking ${h2.name}'s row switches the intercom to them, on that conversation`);
  await pg.click('.barra-ventanas .com .vt-todas'); await wait(300);
  await pg.evaluate(n => [...document.querySelectorAll('.barra-lista-com .vt-list-row')].find(f => f.querySelector('.vt-lista-nombre').textContent === n).click(), picked);
  check(await until(async () => await talking() === h.id), 'and back to ' + h.name);
}

// ---- the selector above the portrait: one row per talker of the room, as the bar's hover list; it switches
const QL = '.console .consola-quien .consola-quien-lista';
const whoList = () => pg.evaluate(QL => [...document.querySelectorAll(`${QL} .bar-peek-row`)].map(f => ({
  name: f.querySelector('b').textContent, title: f.querySelector('.barra-asomo-titulo').textContent.replace(/^✎/, ''), state: (f.className.match(/e-(\w+)/) ?? [])[1],
  photo: !!f.querySelector('.consola-quien-foto'), current: f.classList.contains('current') })), QL);
if (h2) {
  await pg.click('.console .consola-quien > .chip-terminal'); await wait(300);
  const lq = await whoList();
  check(lq.length >= 2 && lq.length === new Set(lq.map(f => f.name)).size && lq.every(f => f.photo), `one row per talker, each with its bust: ${lq.map(f => f.name).join(' | ')}`);
  const row2 = lq.find(f => f.name.startsWith(h2.name));
  check(row2?.state === 'waiting' && row2.title.endsWith('· Bump SDK'), `${h2.name}'s row shows their most urgent conversation, Bump SDK waiting: ` + JSON.stringify(row2));
  check(lq.find(f => f.current)?.name.startsWith(h.name), `${h.name}, in front, is marked`);
  check(!(await pg.isVisible(`${QL} .vt-pestana-x, ${QL} input`)), 'no tabs to close or select in it');
  await pg.screenshot({ path: `${dir}/qa-pestanas-selector.png` });
  const whoWidth = () => pg.evaluate(() => Math.round(document.querySelector('.console .consola-quien > .chip-terminal').getBoundingClientRect().width));
  const width1 = await whoWidth();
  await pg.keyboard.press('Escape'); await wait(200);
  check(!(await pg.isVisible(QL)) && await pg.isVisible('.console'), 'Esc closes the list and only the list');
  await pg.click('.console .consola-quien > .chip-terminal'); await wait(200);
  await pg.mouse.click(5, 5); await wait(200);
  check(!(await pg.isVisible(QL)), 'a click outside closes it');
  await pg.click('.console .consola-quien > .chip-terminal'); await wait(200);
  await pg.evaluate(([QL, n]) => [...document.querySelectorAll(`${QL} .bar-peek-row`)].find(f => f.querySelector('b').textContent.startsWith(n)).click(), [QL, h2.name]);
  check(await until(async () => await talking() === h2.id && (await tabs()).find(p => p.active)?.name === 'Bump SDK'), `picking ${h2.name} switches the intercom to them, on their most urgent conversation (Bump SDK)`);
  check((await tabs()).every(p => FOREIGN.includes(p.name)), 'whose strip holds only their conversations');
  check(await whoWidth() === width1, `the selector keeps its width whoever it names: ${width1}px`);
  // by keyboard: arrows to the first dweller, Enter
  await pg.click('.console .consola-quien > .chip-terminal'); await wait(200);
  const lq2 = await whoList(), from = lq2.findIndex(f => f.current), a = lq2.findIndex(f => f.name.startsWith(h.name));
  for (let k = 0; k < Math.abs(a - from); k++) await pg.keyboard.press(a > from ? 'ArrowDown' : 'ArrowUp');
  await pg.keyboard.press('Enter');
  check(await until(async () => await talking() === h.id), `and back by keyboard to ${h.name}`);
} else console.log('--   (no room with two dwellers: no selector)');

// ---- the bar: one intercom chip per room; hovering it lists one row per open panel (dweller, holograms), as the selector
await pg.keyboard.press('Meta+ArrowDown'); await wait(400);
const intercomRooms = await pg.evaluate(() => [...document.querySelectorAll('.barra-ventanas .com .chip-terminal .tipo')].map(x => x.textContent));
check(intercomRooms.length === new Set(intercomRooms).size && intercomRooms.includes(h.nameRoom), 'the bar has one intercom chip per room: ' + intercomRooms.join(', '));
const chip = pg.locator('.barra-ventanas .com .chip-terminal', { has: pg.locator('.tipo', { hasText: h.nameRoom }) }).first();
await chip.hover(); await wait(300);
const peek = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo .barra-asomo-titulo b')].map(x => x.textContent));
if (h2) check(peek.length === new Set(peek).size && peek.some(n => n.startsWith(h.name)) && peek.some(n => n.startsWith(h2.name)), `hovering ${h.nameRoom}'s chip lists one row per panel: ` + peek.join(', '));
await pg.screenshot({ path: `${dir}/qa-pestanas-barra.png` });
if (h2 && peek.length) {
  await pg.evaluate(n => [...document.querySelectorAll('.barra-asomo .bar-peek-row')].find(f => f.querySelector('b').textContent.startsWith(n)).click(), h2.name);
  check(await until(async () => await talking() === h2.id), 'clicking one opens that panel: ' + h2.name);
  await pg.keyboard.press('Meta+ArrowDown'); await wait(400);
}

// ---- a terminal with many tabs
await pg.evaluate(s => window.dispatchEvent(new CustomEvent('shelter:terminal', { detail: { roomId: s } })), h.room);
await pg.waitForSelector('.ventana-terminal .vt-tab'); await wait(800);
const n0 = await pg.evaluate(() => document.querySelectorAll('.ventana-terminal .vt-tab').length);   // its tabs outlive the page
for (let i = 0; i < 13; i++) { await pg.keyboard.press('Meta+t'); await wait(250); }
await wait(800);
const term = await pg.evaluate(() => { const c = document.querySelector('.ventana-terminal .vt-pestanas-tira'); return { n: c.querySelectorAll('.vt-tab').length, scroll: c.scrollWidth > c.clientWidth }; });
check(term.n === n0 + 13 && term.scroll, `a terminal with ${term.n} tabs scrolls too`);
await pg.keyboard.press('Meta+Shift+a'); await wait(300);
check(await pg.evaluate(() => document.querySelectorAll('.ventana-terminal .vt-list-row').length) === term.n, '⌘⇧A lists the terminal\'s tabs');
await pg.screenshot({ path: `${dir}/qa-pestanas-terminal.png` });
await pg.keyboard.press('Escape'); await wait(200);
await pg.keyboard.press('Meta+Shift+w'); await wait(400);
if (await pg.isVisible('.ventana-terminal .vt-confirmar')) await pg.keyboard.press('Enter');
await wait(600);
check(!(await pg.isVisible('.ventana-terminal')), 'and ⌘⇧W closes it with all its tabs');

check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

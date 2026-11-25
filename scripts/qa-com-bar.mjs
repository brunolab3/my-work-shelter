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
const errors = []; pg.on('pageerror', e => errors.push(e.message));
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const chips = () => pg.evaluate(() => [...document.querySelectorAll('.bar-windows .bar-row.com > .chip-terminal')].map(x => ({ text: x.textContent.trim(), title: x.title, more: x.classList.contains('barra-mas'), urgent: x.classList.contains('urgent') })));

// one intercom per room, each with a made-up conversation; the last room's waits for you
const hs = await pg.evaluate(() => { const seen = new Set(); return window.__game.get().dwellers.filter(h => !h.robot && !seen.has(h.room) && seen.add(h.room)).map(h => ({ id: h.id, room: h.room, name: h.name })); });
check(hs.length >= 6, `${hs.length} rooms with a dweller`);
await pg.evaluate(hs => {
  const sessions = {}, now = Date.now();
  hs.forEach((h, i) => {
    const id = 'qa' + i;
    sessions[id] = { id, dwellerId: h.id, roomId: h.room, cwd: '/tmp', state: i === hs.length - 1 ? 'waiting' : 'idle', unread: false, title: 'Conversation ' + i, pending: 0, helpers: [], tools: 0, turns: 1, updated: now - i * 60000 };
  });
  window.__live.set(e => ({ ...e, sessions: { ...e.sessions, ...sessions } }));
  window.__intercoms.set({ list: hs.map((h, i) => ({ dwellerId: h.id, tabs: [{ id: 'qp' + i, view: { type: 'session', sessionId: 'qa' + i } }], active: 'qp' + i, maximized: false, z: i, known: [] })) });
}, hs);
await wait(500);
const cs = await chips();
const more = cs.find(c => c.more), views = cs.filter(c => !c.more);
check(!!more && views.length < hs.length, `«+N» shows up: ${views.length} in view, ${more?.text}`);
check(views.every(c => !hs.some(h => c.text.includes(h.name))), 'chips without the dweller\'s name');
check(views.every(c => c.title.includes('Conversation')), 'who and the conversation in the title');
check(views.some(c => c.urgent), 'the waiting room stays in view');
const row = await pg.evaluate(() => { const f = document.querySelector('.bar-row.com'); return f.scrollWidth <= f.clientWidth + 1 && f.getBoundingClientRect().right <= innerWidth; });
check(row, 'the COM row fits in the window');
await pg.screenshot({ path: `${dir}/qa-barra-com.png` });
await pg.hover('.bar-row.com > .barra-mas'); await wait(300);
const list = await pg.evaluate(() => ({ groups: document.querySelectorAll('.peek-bar-more .peek-bar-group').length, rows: [...document.querySelectorAll('.peek-bar-more .bar-peek-row')].map(x => ({ text: x.textContent, bust: !!x.querySelector('.console-who-photo'), sel: x.classList.contains('sel') })) }));
check(list.groups === hs.length - views.length && list.rows.length === list.groups, `hovering «+N» lists the ${list.groups} hidden rooms, one row per dweller`);
check(list.rows.every(x => x.bust && !x.text.includes('Conversation')), 'each row with its bust and no conversation title');
check(list.rows.filter(x => x.sel).length === 1 && list.rows[0].sel, 'the most important one selected');
await wait(500); await pg.screenshot({ path: `${dir}/qa-barra-com-mas.png` });
// sticky: opening a hidden room swaps out one chip in view; switching between rooms afterwards moves nothing
const names = () => pg.evaluate(() => [...document.querySelectorAll('.bar-windows .bar-row.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0]));
const before = await names();
await pg.click('.peek-bar-more .bar-peek-row'); await wait(400);
const after = await names();
check(before.filter(n => !after.includes(n)).length <= 1 && before.filter(n => after.includes(n)).join() === after.filter(n => before.includes(n)).join(), `opening a hidden room swaps out at most one chip (the room it frees may bring another back), the rest keep their order (${before.join(', ')} → ${after.join(', ')})`);
const moreX = () => pg.evaluate(() => document.querySelector('.bar-row.com > .barra-mas')?.getBoundingClientRect().right);
const x0 = await moreX();
for (const i of [0, after.length - 1, 1]) { await pg.click(`.bar-row.com > .chip-terminal:not(.barra-mas) >> nth=${i}`); await wait(300); }
check((await names()).join() === after.join() && (await moreX()) === x0, 'switching conversations keeps the row and «+N» where they were');
// a chip's hover, even with a single dweller: who it is, selected
await pg.hover('.bar-row.com > .chip-terminal:not(.barra-mas) >> nth=0'); await wait(300);
const one = await pg.evaluate(() => [...document.querySelectorAll('.peek-bar:not(.peek-bar-more) .bar-peek-row')].map(x => ({ bust: !!x.querySelector('.console-who-photo'), sel: x.classList.contains('sel') })));
check(one.length === 1 && one[0].bust && one[0].sel, 'hovering a chip with one dweller shows them, selected');
await pg.evaluate(() => window.__game.set({ talkingWith: null })); await wait(300);
// keyboard: past the last chip in view, the «+N» chip is marked and its list opens on the room chosen
await pg.mouse.move(400, 100); await wait(400);
await pg.keyboard.press('b'); await wait(200);
for (let i = 0; i < (await names()).length; i++) await pg.keyboard.press('ArrowRight');
await wait(200);
const k = await pg.evaluate(() => ({ more: !!document.querySelector('.bar-row.com > .barra-mas.marked'), marked: document.querySelector('.peek-bar-more .bar-peek-row.sel')?.textContent.trim() }));
check(k.more && !!k.marked, `→ past the chips in view goes into «+N» (${k.marked})`);
await pg.screenshot({ path: `${dir}/qa-barra-com-teclado.png` });
await pg.keyboard.press('Escape');
// a hologram in a hidden room: its own row in «+N», and its own header with its task in the ⋯ N list
await wait(300);
const hidden = await pg.evaluate(() => { const v = new Set([...document.querySelectorAll('.bar-row.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0])); return window.__game.get().dwellers.find(h => !h.robot && !v.has(h.nameRoom) && window.__intercoms.get().list.some(w => w.dwellerId === h.id)); });
check(!!hidden, 'a hidden room to give a hologram');
if (hidden) {
  await pg.evaluate(h => {
    const id = 'holo:/tmp/shelter-qa-task--x1';
    const copy = { ...h, id, copy: { path: '/tmp/shelter-qa-task--x1', branch: 'qa-task', authorId: h.id, nameAuthor: h.name, nicknameAuthor: h.nickname, changes: 0, advanced: 0 } };
    window.__game.set(e => ({ ...e, copies: [...e.copies, copy] }));
    // its intercom before its session, or the game opens one for it first
    window.__intercoms.set(e => ({ list: [...e.list, { dwellerId: id, tabs: [{ id: 'qph', view: { type: 'session', sessionId: 'qah' } }], active: 'qph', maximized: false, z: 99, known: [] }] }));
    window.__live.set(e => ({ ...e, sessions: { ...e.sessions, qah: { id: 'qah', dwellerId: id, roomId: h.room, cwd: '/tmp/shelter-qa-task--x1', state: 'waiting', unread: false, title: 'Hologram', pending: 0, helpers: [], tools: 0, turns: 1, updated: Date.now() } } }));
  }, hidden);
  await wait(300);
  await pg.hover('.bar-row.com > .barra-mas'); await wait(500);
  const rows = await pg.evaluate(() => [...document.querySelectorAll('.peek-bar-more .bar-peek-row')].map(x => ({ copy: x.classList.contains('of-copy'), text: x.textContent })));
  check(rows.filter(f => f.copy).length === 1, `the hologram has its own row in «+N» (${rows.find(f => f.copy)?.text})`);
  await pg.screenshot({ path: `${dir}/qa-barra-com-holo.png` });
  await pg.mouse.move(400, 100); await wait(400);
  await pg.click('.bar-row.com .vt-all'); await wait(400);
  const all = await pg.evaluate(() => ({ who: [...document.querySelectorAll('.bar-list-com .vt-list-who')].map(x => ({ bust: !!x.querySelector('.console-who-photo'), task: !!x.querySelector('.mark-task'), copy: x.classList.contains('of-copy') })), rows: document.querySelectorAll('.bar-list-com .vt-list-row').length }));
  check(all.who.length === hs.length + 1 && all.who.every(x => x.bust), `⋯ N: one header with a bust per dweller or hologram (${all.who.length}) over its ${all.rows} tabs`);
  check(all.who.filter(x => x.task).length === 1 && all.who.find(x => x.task)?.copy, '⋯ N: the hologram\'s header carries its task');
  await pg.screenshot({ path: `${dir}/qa-barra-com-todas.png` });
}
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

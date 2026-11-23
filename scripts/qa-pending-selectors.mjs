// QA of ⚑ pending conversations in the selectors: the bar's COM chips, their hover lists, the «+N» chip and the
// selector above the portrait (closed chip and its +n tag) show pending where they show waiting, in the pending
// colour, and waiting keeps its priority when both. Conversations and flags are made up in the page (nothing reaches
// Claude Code, nothing is saved). Uso: SHELTER_DATOS=… node scripts/qa-pending-selectors.mjs <url> [carpeta-capturas]
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
const pendingColor = await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pendiente').trim());
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

// one intercom per room: a hologram's room (an existing worktree's copy) with its dweller idle and the hologram flagged
// (two talkers: the selector above the portrait); then a room idle and flagged, and a room waiting and flagged (waiting
// wins); the rest idle
const copy = await pg.evaluate(() => { const c = window.__game.get().copies[0]; return c && { id: c.id, room: c.room, path: c.copy.path }; });
check(!!copy, 'the test shelter has a hologram (a worktree)');
const all = await pg.evaluate(() => { const seen = new Set(); return window.__game.get().dwellers.filter(h => !h.robot && !seen.has(h.room) && seen.add(h.room)).map(h => ({ id: h.id, room: h.room, name: h.name, nameRoom: h.nameRoom })); });
const hs = [all.find(h => h.room === copy.room), ...all.filter(h => h.room !== copy.room)];
check(hs.length >= 6 && !!hs[0], `${hs.length} rooms with a dweller`);
await pg.evaluate(({ hs, copy }) => {
  const sessions = {}, now = Date.now();
  hs.forEach((h, i) => {
    const id = 'qa' + i;
    sessions[id] = { id, claudeId: 'c' + i, dwellerId: h.id, roomId: h.room, cwd: '/tmp', state: i === 2 ? 'esperando' : 'ociosa', unread: false, title: 'Conversation ' + i, pending: 0, helpers: [], tools: 0, turns: 1, updated: now - i * 60000 };
  });
  sessions.qah = { id: 'qah', claudeId: 'ch', dwellerId: copy.id, roomId: copy.room, cwd: copy.path, state: 'ociosa', unread: false, title: 'Hologram', pending: 0, helpers: [], tools: 0, turns: 1, updated: now };
  window.__intercoms.set({ list: [...hs.map((h, i) => ({ dwellerId: h.id, tabs: [{ id: 'qp' + i, view: { type: 'sesion', sessionId: 'qa' + i } }], active: 'qp' + i, maximized: false, z: i, known: [] })),
    { dwellerId: copy.id, tabs: [{ id: 'qph', view: { type: 'sesion', sessionId: 'qah' } }], active: 'qph', maximized: false, z: 0, known: [] }] });
  window.__live.set(e => ({ ...e, sessions: { ...e.sessions, ...sessions }, state: { ...e.state, settings: { ...e.state?.settings, flaggedConversations: ['c1', 'c2', 'ch'] } } }));
}, { hs, copy });
await wait(500);
const chipOf = room => pg.evaluate(name => { const x = [...document.querySelectorAll('.barra-fila.com > .chip-terminal:not(.barra-mas)')].find(c => c.title.startsWith(name + ':')); return x && { urgent: x.classList.contains('urgente'), pending: x.classList.contains('pendiente'), border: getComputedStyle(x).borderTopColor, text: x.textContent, title: x.title }; }, room);
const c0 = await chipOf(hs[1].nameRoom), c1 = await chipOf(hs[2].nameRoom);
check(c0?.pending && !c0.urgent && c0.text.includes('⚑') && c0.border === rgb(pendingColor), `a room with a pending conversation: pending chip with ⚑, in the pending colour (${c0?.text})`);
check(c0?.title.includes('Pend') || c0?.title.toLowerCase().includes('pending'), 'its title says so');
check(c1?.urgent && !c1.pending, 'waiting and pending: waiting wins');
await pg.screenshot({ path: `${dir}/qa-pendiente-barra.png` });
// the hover list of a room with a flagged hologram: its row in the pending colour, with ⚑
const c2 = hs[0].nameRoom;
await pg.hover(`.barra-fila.com > .chip-terminal[title^="${c2}:"]`); await wait(400);
const rows = await pg.evaluate(() => [...document.querySelectorAll('.barra-asomo:not(.barra-asomo-mas) .barra-asomo-fila')].map(x => ({ pending: x.classList.contains('pendiente'), copy: x.classList.contains('de-copia'), color: getComputedStyle(x.querySelector('.barra-asomo-estado')).color, mark: !!x.querySelector('.marca-pendiente') })));
check(rows.length === 2 && rows.filter(r => r.pending).length === 1 && rows.find(r => r.pending)?.copy, 'hover: the flagged hologram\'s row is pending, its dweller\'s not');
check(rows.find(r => r.pending)?.color === rgb(pendingColor) && rows.find(r => r.pending)?.mark, 'hover: its state in the pending colour, with ⚑');
await pg.screenshot({ path: `${dir}/qa-pendiente-asomo.png` });
// the selector above the portrait, talking with room 2's dweller: the closed chip pending and the +1 tag in its colour
await pg.mouse.move(400, 100); await wait(300);
await pg.evaluate(id => window.__game.set({ talkingWith: id }), hs[0].id); await wait(800);
const who = await pg.evaluate(() => { const c = document.querySelector('.consola-quien > .chip-terminal'), a = c?.querySelector('.consola-quien-aviso'); return c && { pending: c.classList.contains('pendiente'), urgent: c.classList.contains('urgente'), border: getComputedStyle(c).borderTopColor, tag: a?.className, tagBg: a && getComputedStyle(a).backgroundColor, title: c.title }; });
check(who?.pending && !who.urgent && who.border === rgb(pendingColor), `closed selector chip: pending, outlined in its colour (${who?.border})`);
check(who?.tag?.includes('pendiente') && who.tagBg === rgb(pendingColor), 'its +1 tag in the pending colour');
await pg.screenshot({ path: `${dir}/qa-pendiente-selector.png` });
// narrow: everything still fits
for (const w of [520, 420]) {
  await pg.setViewportSize({ width: w, height: 700 }); await wait(600);
  const fit = await pg.evaluate(() => { const f = document.querySelector('.barra-fila.com'), c = document.querySelector('.consola-quien > .chip-terminal'); return { row: f.scrollWidth <= f.clientWidth + 1 && f.getBoundingClientRect().right <= innerWidth, chip: !c || c.getBoundingClientRect().right <= innerWidth }; });
  check(fit.row && fit.chip, `at ${w}px the COM row and the selector chip fit`);
  await pg.screenshot({ path: `${dir}/qa-pendiente-${w}.png` });
}
// «+N»: pending when a hidden room has a pending conversation and none waits
await pg.evaluate(() => window.__game.set({ talkingWith: null })); await wait(500);
const more = await pg.evaluate(() => { const m = document.querySelector('.barra-fila.com > .barra-mas'); if (!m) return null; return { pending: m.classList.contains('pendiente'), urgent: m.classList.contains('urgente'), hidden: window.__intercoms ? null : null }; });
const hiddenRooms = await pg.evaluate(() => { const v = new Set([...document.querySelectorAll('.barra-fila.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0])); return [...new Set(window.__game.get().dwellers.filter(h => !h.robot).map(h => h.nameRoom))].filter(n => !v.has(n)); });
const flaggedHidden = [hs[0], hs[1], hs[2]].filter(h => hiddenRooms.includes(h.nameRoom)).map(h => h.nameRoom);
check(!!more, `«+N» at 420px (hidden with something: ${flaggedHidden.join(', ') || 'none'})`);
if (more) {
  const waits = hiddenRooms.includes(hs[2].nameRoom);
  check(waits ? more.urgent && !more.pending : flaggedHidden.length ? more.pending : !more.pending, `«+N»: ${waits ? 'urgent (a waiting room behind it)' : flaggedHidden.length ? 'pending' : 'neither'}`);
}
// with nobody waiting any more, «+N» turns pending if a pending room is behind it
await pg.evaluate(() => window.__live.set(e => ({ ...e, sessions: { ...e.sessions, qa2: { ...e.sessions.qa2, state: 'ociosa' } } }))); await wait(500);
const more2 = await pg.evaluate(() => { const m = document.querySelector('.barra-fila.com > .barra-mas'), v = new Set([...document.querySelectorAll('.barra-fila.com > .chip-terminal:not(.barra-mas)')].map(x => x.title.split(':')[0])); return m && { pending: m.classList.contains('pendiente'), urgent: m.classList.contains('urgente'), border: getComputedStyle(m).borderTopColor, inView: [...v] }; });
const pendBehind = [hs[0], hs[1], hs[2]].some(h => more2 && !more2.inView.includes(h.nameRoom));
check(more2 && !more2.urgent && more2.pending === pendBehind && (!pendBehind || more2.border === rgb(pendingColor)), `«+N» with nobody waiting: ${pendBehind ? 'pending, in its colour' : 'not pending (no pending room behind it)'}`);
await pg.screenshot({ path: `${dir}/qa-pendiente-mas.png` });
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

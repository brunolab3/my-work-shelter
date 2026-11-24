// QA: a conversation that opens by itself never takes the intercom away from the Overseer. With real keyboard
// (Playwright) and real Claude Code sessions (Haiku, short jobs): while typing in a conversation, another one opens for
// the same dweller and then one for another dweller (as a room message, a scheduled message or `send_to_room` would);
// the intercom in front, its tab in view, the focus and the text stay put, and typing keeps landing there. The new
// conversations show up as a tab and in the bar, and the Overseer switches to them himself.
// Usage: node scripts/qa-intercom-focus.mjs [url]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
// Careful: it starts real Claude Code sessions (they spend from your plan): use it against a test shelter, never yours.
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(300); } return false; };
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });

const [h, other] = await pg.evaluate(() => { const hs = window.__game.get().dwellers.filter(h => h.path && !h.robot); return [hs.find(h => h.room !== 'bridge') ?? hs[0], hs.find(x => x.room !== (hs.find(h => h.room !== 'bridge') ?? hs[0]).room)]; });
console.log('Dweller:', h.name, '·', h.nameRoom, '| other:', other?.name ?? '—');
// a conversation started from outside the intercom, as the server does for room and scheduled messages
const startOutside = d => pg.evaluate(d => window.__client.ask({ t: 'start', dwellerId: d.id, roomId: d.room, prompt: 'Reply only with: ok.', options: { model: 'haiku' } }), d);
const state = () => pg.evaluate(() => {
  const talking = window.__game.get().talkingWith, w = window.__intercoms.get().list.find(v => v.dwellerId === talking);
  const a = document.activeElement;
  return { talking, active: w?.active, tabs: w?.tabs.length ?? 0, focused: a?.tagName === 'TEXTAREA' && !!a.closest('.console'), field: document.querySelector('.console textarea')?.value ?? null };
});

// one conversation of the dweller, in view, typing in it
const first = await startOutside(h);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
check(await until(async () => (await pg.$('.console .session')) !== null, 20000), 'the intercom shows the conversation');
// a fresh shelter asks first whether to trust the folder's Claude Code setup: «No, work without it» (the last option)
if (await until(async () => (await pg.$('.console .session textarea')) !== null, 5000) === false) {
  await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter');
  check(await until(async () => (await pg.$('.console .session textarea')) !== null, 20000), 'its composer shows');
}
await pg.focus('.console .session textarea');
await pg.keyboard.type('Half a sentence I am still ', { delay: 2 });
const before = await state();

// another conversation of the same dweller opens by itself while typing
const typing = pg.keyboard.type('typing slowly while things happen', { delay: 40 });
const second = await startOutside(h);
await typing;
check(await until(async () => (await state()).tabs === before.tabs + 1, 10000), 'the new conversation of the same dweller gets its tab');
let now = await state();
check(now.talking === before.talking && now.active === before.active, 'the tab in view stays the same');
check(now.focused, 'the composer keeps the focus');
check(now.field === 'Half a sentence I am still typing slowly while things happen', `nothing typed moved or got lost («${now.field}»)`);
const draftElsewhere = await pg.evaluate(sid => window.__intercoms.get().list.flatMap(v => v.tabs).find(p => p.view.sessionId === sid)?.draft ?? '', second);
check(!draftElsewhere, 'the new conversation\'s composer got none of it');

// one for another dweller (a room message, a task from send_to_room): only in the bar
let third;
if (other) {
  const typing2 = pg.keyboard.type(', and more', { delay: 40 });
  third = await startOutside(other);
  await typing2;
  check(await until(() => pg.evaluate(sid => window.__intercoms.get().list.some(v => v.dwellerId !== window.__game.get().talkingWith && v.tabs.some(p => p.view.sessionId === sid)), third), 10000), 'the other dweller\'s conversation waits in its own intercom');
  now = await state();
  check(now.talking === before.talking && now.active === before.active && now.focused, 'the intercom in front, its tab and the focus stay');
  check(now.field?.endsWith('while things happen, and more'), 'and typing keeps landing there');
}

// switching is the Overseer's: ⌘2 goes to the new tab, ⌘1 comes back with the text
await pg.keyboard.press('Meta+2'); await wait(400);
check((await state()).active !== before.active, '⌘2 switches to the new conversation');
await pg.keyboard.press('Meta+1'); await wait(400);
check((await state()).field?.startsWith('Half a sentence'), '⌘1 comes back to the text');

// cleanup
for (const id of [first, second, third].filter(Boolean)) await pg.evaluate(id => window.__client.send({ t: 'closeSession', sessionId: id }), id);
await pg.keyboard.press('Meta+Shift+w'); await wait(300); await pg.keyboard.press('Enter'); await wait(500);
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' · ') : ''));
await b.close();
console.log(failures ? `\n${failures} failures` : '\nAll good');
process.exit(failures ? 1 : 0);

// QA of the holograms' tags: a plain hologram (no ⏰ ✉ ⚑ mark, not waiting, finished nor failed) has no tag at the room's
// framing; hovering its figure shows its full tag (its copy's name ◇ task); zoomed in on the room every hologram shows its
// compact tag with its task (or branch); those that need the Overseer keep theirs; in a chat only hovering one (its tag
// or its figure) shows it whole.
// Usage: SHELTER_DATOS=… node scripts/qa-hologram-task-tags.mjs <url> <output.png>
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, output] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null }); });
const steps = async (n, dt = 0.05) => { for (let i = 0; i < n; i++) await pg.evaluate(d => window.__step(d), dt); };
await pg.waitForFunction(() => window.__shelter?.holograms?.figures?.size > 0 && [...window.__shelter.holograms.figures.values()].every(f => f.ready && f.p.mixer), null, { timeout: 60000 });
// the room of the first hologram, framed as travelling to it does (distRoom), then at `k` times that distance
const frame = k => pg.evaluate(k => {
  const r = window.__shelter, f = [...r.holograms.figures.values()][0];
  r.frameRoom(f.room); const d = r.distRoom * k;
  r.supervisor.root.position.set(f.room.group.position.x - f.room.width / 2 + 0.8, f.room.group.position.y, 1.2);
  r.activityMode = true; r.camera.goal.set(f.room.group.position.x, f.room.group.position.y + 1.6, 0); r.camera.distance = d; r.camera.immediate();
}, k);
// each hologram in that room: whether it is plain (no tag of its own without hover or zoom), its tag as drawn and where it is
const holos = () => pg.evaluate(() => {
  const r = window.__shelter, c = r.motor.renderer.domElement.getBoundingClientRect(), room = [...r.holograms.figures.values()][0].room;
  const needs = new Set(r.holograms.labels(false, false, null).map(x => x.k));
  const intercom = document.querySelector('.console.interactive')?.getBoundingClientRect();
  const free = x => x > c.left + 20 && x < (intercom ? intercom.left : c.right) - 20;
  return [...r.holograms.figures.values()].filter(f => f.ready && f.room === room).map(f => {
    const e = r.labels.map.get(f), el = e?.el, shown = !!el && el.style.display !== 'none';
    const head = f.p.headPoint(), p = head.clone().setY(head.y - 0.6).project(r.motor.camera);
    const body = { x: c.left + (p.x + 1) / 2 * c.width, y: c.top + (1 - p.y) / 2 * c.height };
    const box = shown ? el.getBoundingClientRect() : null;
    return { task: f.task, state: f.state, plain: !needs.has(f), talked: f === r.copyFocused, shown, full: shown && !el.classList.contains('glyph-only'), name: shown ? e.name.textContent : '', taskShown: shown && getComputedStyle(e.task).display !== 'none', body, free: free(body.x), tag: box && box.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2, free: free(box.left + box.width / 2) } : null };
  });
});
// the pointer off the shelter's canvas (onto the interface): nothing hovered
const away = async () => {
  const p = await pg.evaluate(() => { for (let y = 5; y < innerHeight; y += 15) for (let x = 5; x < innerWidth; x += 15) { const e = document.elementFromPoint(x, y); if (e && e.tagName !== 'CANVAS' && !e.closest('#labels')) return { x, y }; } });
  await pg.mouse.move(p.x, p.y); await steps(4);
};
let fail = 0;
const check = (ok, what) => { if (!ok) { console.log('FAIL:', what); fail++; } };
await away();
// the room's framing, no hover: plain holograms have no tag; the others keep their compact one, with their task
await frame(1); await steps(20);
await pg.screenshot({ path: output.replace('.png', '_framed.png') });
let hs = await holos();
console.log('framed', JSON.stringify(hs.map(({ body, tag, ...x }) => x)));
check(hs.some(h => h.plain), 'no plain hologram in the room to test (needs one idle or working, without marks)');
check(hs.filter(h => h.plain).every(h => !h.shown), 'a plain hologram has a tag without hover or zoom');
check(hs.filter(h => !h.plain).every(h => h.shown && h.taskShown), 'a hologram that needs the Overseer lost its compact tag');
// hovering a plain hologram's figure: its full tag
const plain = hs.find(h => h.plain && h.free);
check(!!plain, 'no plain hologram on screen to hover');
if (plain) {
  await pg.mouse.move(plain.body.x, plain.body.y); await steps(4);
  hs = await holos(); const it = hs.find(h => h.task === plain.task && h.plain);
  console.log('hover plain', JSON.stringify(it && { shown: it.shown, full: it.full, name: it.name }));
  check(it?.shown && it.full && it.name.includes(' ◇ '), 'hovering a plain hologram does not show its full tag');
  check(hs.filter(h => h.plain && h !== it).every(h => !h.shown), 'hovering one hologram shows another plain one\'s tag');
  await pg.screenshot({ path: output.replace('.png', '_hover.png') });
  await away();
  hs = await holos(); check(hs.filter(h => h.plain).every(h => !h.shown), 'the tag stays after the pointer leaves');
}
// zoomed in on the room: every hologram shows its compact tag with its task
await frame(0.6); await steps(20);
await pg.screenshot({ path: output.replace('.png', '_zoom.png') });
hs = await holos();
console.log('zoom', JSON.stringify(hs.map(({ body, tag, ...x }) => x)));
check(hs.length && hs.every(h => h.shown && h.taskShown), 'zoomed in, some hologram has no tag with its task');
// talking to a hologram: only the hovered one opens; plain ones have no tag without hover
await frame(1); await steps(5); await away();
await pg.evaluate(() => { const r = window.__shelter; r.interactCopy([...r.holograms.figures.values()][0]); });
await steps(30); await away();
await pg.screenshot({ path: output.replace('.png', '_chat.png') });
hs = await holos();
const rootShown = await pg.evaluate(() => document.getElementById('labels').style.display !== 'none');
console.log('chat', 'root shown', rootShown, JSON.stringify(hs.map(({ body, tag, ...x }) => x)));
check(rootShown, 'the tags layer hides during a chat');
check(hs.filter(h => h.plain).every(h => !h.shown) && hs.every(h => !h.full), 'in a chat, without hover, a plain hologram has a tag or one is full');
for (const f of hs.filter(h => h.free).slice(0, 2)) {
  await pg.mouse.move(f.body.x, f.body.y); await steps(4);
  let it = (await holos()).find(h => h.task === f.task && h.talked === f.talked);
  console.log(`chat hover figure (${f.talked ? 'talked to' : 'other'})`, JSON.stringify(it && { full: it.full, name: it.name }));
  check(it?.full && it.name.includes(' ◇ '), 'hovering a hologram\'s figure in a chat does not show its tag whole');
  if (f.tag?.free) {
    await away();
    await pg.mouse.move(f.tag.x, f.tag.y); await steps(4);
    it = (await holos()).find(h => h.task === f.task && h.talked === f.talked);
    console.log(`chat hover tag (${f.talked ? 'talked to' : 'other'})`, JSON.stringify(it && { full: it.full, name: it.name }));
    check(it?.full, 'hovering a hologram\'s tag in a chat does not show it whole');
  }
  await pg.screenshot({ path: output.replace('.png', '_chat_hover.png') });
}
await away();
hs = await holos(); console.log('chat no hover', JSON.stringify(hs.map(({ body, tag, ...x }) => x)));
check(hs.every(h => !h.full), 'without hovering, holograms\' tags stay compact in a chat');
await b.close();
console.log(fail ? `${fail} FAIL` : 'OK');
process.exit(fail ? 1 : 0);

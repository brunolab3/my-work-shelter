// QA of the holograms' task on their tags: every hologram's tag says its task (or branch), close up, from afar and
// while talking to one of them (only the holograms' tags stay then, and hovering one, its tag or its figure, shows it whole).
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
const frame = distance => pg.evaluate(d => {
  const r = window.__shelter, f = [...r.holograms.figures.values()][0];
  r.supervisor.root.position.set(f.spot.x - 6, f.room.group.position.y, 1.2);
  r.activityMode = true; r.camera.goal.set(f.room.group.position.x, f.room.group.position.y + 1.6, 0); r.camera.distance = d; r.camera.immediate();
}, distance);
const tags = () => pg.evaluate(() => [...document.querySelectorAll('#labels .label')].filter(l => l.style.display !== 'none').map(l => ({ glyphOnly: l.classList.contains('glyph-only'), task: l.querySelector('.task')?.textContent, taskShown: getComputedStyle(l.querySelector('.task')).display !== 'none', name: getComputedStyle(l.children[3]).display !== 'none' ? l.children[3].textContent : '' })));
const holos = () => pg.evaluate(() => [...window.__shelter.holograms.figures.values()].filter(f => f.ready).length);
let fail = 0;
for (const [step, d] of [['close', 16], ['far', 34]]) {
  await frame(d); await steps(20);
  await pg.screenshot({ path: output.replace('.png', `_${step}.png`) });
  const t = await tags(), n = await holos(), withTask = t.filter(x => x.task && x.taskShown);
  console.log(step, 'holograms', n, 'tags with task', withTask.length, JSON.stringify(t));
  if (withTask.length < 1) { console.log('FAIL: no task on the holograms\' tags', step); fail++; }
}
// talking to a hologram: the tags root stays shown, with only the holograms' tags (glyph and task)
await frame(16); await steps(5);
await pg.evaluate(() => { const r = window.__shelter; r.interactCopy([...r.holograms.figures.values()][0]); });
await steps(30);
await pg.screenshot({ path: output.replace('.png', '_chat.png') });
const t = await tags(), shown = await pg.evaluate(() => document.getElementById('labels').style.display !== 'none');
console.log('chat', 'root shown', shown, JSON.stringify(t));
if (!shown || !t.length || t.some(x => !x.task)) { console.log('FAIL: during a chat only holograms\' tags, with their task'); fail++; }
// hovering a hologram's tag, then its figure, during the chat shows its full tag: its copy's name ◇ task
const point = () => pg.evaluate(() => {
  const r = window.__shelter, c = r.motor.renderer.domElement.getBoundingClientRect();
  const intercom = document.querySelector('.console.interactive')?.getBoundingClientRect();
  const free = x => x > c.left + 20 && x < (intercom ? intercom.left : c.right) - 20;
  const fs = [...r.holograms.figures.values()].filter(f => f.ready).map(f => {
    const proj = v => { const p = v.clone().project(r.motor.camera); return { x: c.left + (p.x + 1) / 2 * c.width, y: c.top + (1 - p.y) / 2 * c.height }; };
    const head = f.p.headPoint(), body = proj(head.clone().setY(head.y - 0.6));
    const tag = [...document.querySelectorAll('#labels .label')].find(l => l.style.display !== 'none' && l.querySelector('.task')?.textContent === (f.task ?? '') ) ?? null;
    const box = tag?.getBoundingClientRect();
    return { task: f.task, talked: f === r.copyFocused, tag: box && box.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null, body };
  }).filter(f => free(f.body.x) && f.tag && free(f.tag.x));
  return fs;
});
const hovered = async (label) => {
  await steps(4);
  const t = await pg.evaluate(() => [...document.querySelectorAll('#labels .label')].filter(l => l.style.display !== 'none' && !l.classList.contains('glyph-only')).map(l => l.children[3]?.textContent ?? ''));
  console.log(label, JSON.stringify(t));
  return t;
};
const targets = await point();
console.log('hover targets', JSON.stringify(targets));
if (!targets.length) { console.log('FAIL: no hologram outside the intercom to hover'); fail++; }
for (const f of targets.slice(0, 2)) {
  await pg.mouse.move(f.tag.x, f.tag.y); let t = await hovered(`chat hover tag (${f.talked ? 'talked to' : 'other'})`);
  if (!t.some(n => n.includes(' ◇ '))) { console.log('FAIL: hovering a hologram\'s tag in a chat does not show it whole'); fail++; }
  await pg.mouse.move(f.body.x, f.body.y); t = await hovered(`chat hover figure (${f.talked ? 'talked to' : 'other'})`);
  if (!t.some(n => n.includes(' ◇ '))) { console.log('FAIL: hovering a hologram\'s figure in a chat does not show its tag whole'); fail++; }
  await pg.screenshot({ path: output.replace('.png', '_chat_hover.png') });
}
await pg.mouse.move(5, 450); const away = await hovered('chat no hover');
if (away.length) { console.log('FAIL: without hovering, holograms\' tags stay compact in a chat'); fail++; }
await b.close();
console.log(fail ? `${fail} FAIL` : 'OK');
process.exit(fail ? 1 : 0);

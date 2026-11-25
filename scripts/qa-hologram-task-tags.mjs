// QA of the holograms' task on their tags: every hologram's tag says its task (or branch), close up, from afar and
// while talking to one of them (only the holograms' tags stay then).
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
await b.close();
console.log(fail ? `${fail} FAIL` : 'OK');
process.exit(fail ? 1 : 0);

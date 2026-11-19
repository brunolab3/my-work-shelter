import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const pg = await b.newPage({ viewport: { width: 400, height: 300 } });
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken('' + (process.env.URL || 'http://127.0.0.1:5173/') + ''));
await pg.evaluate(async () => { await window.__ready(); });
console.log(JSON.stringify(await pg.evaluate(() => {
  const r = window.__shelter; const s = r.supervisor; const V = r.camara.goal.constructor;
  const out = {};
  for (const c of ['Walking_A', 'Walking_B', 'Walking_C', 'Running_A', 'Running_B']) {
    s.stop(); s.root.position.set(0, 0, 1.5); s.root.rotation.y = Math.PI / 2; s.goalTurn = Math.PI / 2;
    s.play(c, 0);
    const feet = ['footl', 'footr'].map(n => s.model.getObjectByName(n));
    const samples = [];
    for (let i = 0; i < 120; i++) { s.mixer.update(1 / 60); s.model.updateMatrixWorld(true); samples.push(feet.map(p => p.getWorldPosition(new V()))); }
    const ymin = Math.min(...samples.flat().map(p => p.y));
    let sum = 0, n = 0;
    for (let i = 1; i < samples.length; i++) for (const k of [0, 1]) if (samples[i][k].y < ymin + 0.025 && samples[i - 1][k].y < ymin + 0.025) { sum += (samples[i][k].x - samples[i - 1][k].x) * 60; n++; }
    out[c] = { speedFootSupported: +(sum / n).toFixed(3), samples: n, currentMeasure: +s.speedOf(c).toFixed(3) };
  }
  return out;
}), null, 1));
await b.close();

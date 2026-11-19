import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await pg.addInitScript('window.__noLoop = true;');
await pg.goto(withToken('http://127.0.0.1:5173/?ao=0&msaa=0&sombras=0'));
await pg.evaluate(async () => { await window.__ready(); });
console.log(JSON.stringify(await pg.evaluate(() => {
  const m = window.__shelter.motor; const gl = m.renderer.getContext(); const px = new Uint8Array(4);
  const measured = f => { const ts = []; for (let i = 0; i < 60; i++) { const t = performance.now(); f(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return +ts[30].toFixed(2); };
  const upd = () => { for (const f of m['onUpdate']) f(1 / 60, m.t += 1 / 60); };
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return {
    onlyUpdate: measured(upd),
    onlySync: measured(sync),
    renderDirectWithoutPost: measured(() => { m.renderer.render(m.scene, m.camera); sync(); }),
    composer: measured(() => { m.composer.render(1 / 60); sync(); }),
    objects: (() => { let n = 0, meshes = 0; m.scene.traverse(o => { n++; if (o.isMesh) meshes++; }); return { n, meshes }; })(),
    calls: (() => { m.renderer.info.autoReset = false; m.renderer.info.reset(); m.renderer.render(m.scene, m.camera); const r = { ...m.renderer.info.render }; m.renderer.info.autoReset = true; return r; })(),
  };
}), null, 1));
await b.close();

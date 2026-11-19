// QA de la rutina de los habitantes con el bucle real (no a pasos fijos): cada segundo, qué hace cada habitante de la
// sala (estado/quehacer, clip, posición, sentado) y capturas cada N segundos.
// Uso: SHELTER_DATOS=… node scripts/qa-routine.mjs "<url>?sala=<id>" <salida.png> [segundos=60] [captura cada N s=15] [js de preparación]
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, output, seconds = '60', every = '15', prep = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
pg.on('console', m => { if (/error|fallo|PREP|RUT/i.test(m.text())) console.log('consola:', m.text()); });
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => window.__shelter?.dwellers?.length > 0 && window.__shelter.supervisor, null, { timeout: 90000 });
await new Promise(r => setTimeout(r, 3000));
await pg.evaluate(p => { window.__game.set({ panel: null }); if (p) eval(p); }, prep);
const t0 = Date.now(); let n = 0;
while (Date.now() - t0 < +seconds * 1000) {
  const info = await pg.evaluate(() => { const r = window.__shelter; return r.dwellers.filter(h => h.room === r.currentRoom).map(h => `${h.id.name} ${h.state}/${h.chore} clip=${h.p.currentName} x=${(h.pos.x - h.room.group.position.x).toFixed(2)} z=${h.pos.z.toFixed(2)} y=${(h.pos.y - h.room.group.position.y).toFixed(2)} sent=${h.seated} fps=${window.__fps ?? ''}`).join(' | '); });
  console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(3), info);
  if (n++ % +every === 0) await pg.screenshot({ path: output.replace('.png', `_${String(n).padStart(3, '0')}.png`) });
  await new Promise(r => setTimeout(r, 1000));
}
await b.close();

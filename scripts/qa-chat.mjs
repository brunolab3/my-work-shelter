// QA del intercomunicador que sigue al interlocutor: abre la charla, simula que se pone a trabajar (sesión falsa con texto
// en streaming) y saca capturas: la cámara debe dejarle a la vista en el hueco que no tapa la ventana, también en su mesa.
// Uso: SHELTER_DATOS=… node scripts/qa-chat.mjs <url> <salida.png> [js de preparación; window.__mover=true lo pone de pie lejos]
import { chromium } from 'playwright';
import { withToken } from './token.mjs';
const [url, output, prep = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => window.__shelter?.dwellers?.length > 0 && window.__shelter.supervisor, null, { timeout: 90000 });
await new Promise(r => setTimeout(r, 2500));
await pg.evaluate(p => { window.__game.set({ panel: null }); if (p) eval(p);
  const r = window.__shelter; const h = r.dwellers.find(x => x.room === r.currentRoom); window.__h = h;
  if (window.__move) { h.change('waiting'); h.change('idle'); h.pos.x = r.currentRoom.group.position.x + 4.5; h.pos.z = 1.3; } r.interact(h);
}, prep);
const info = () => pg.evaluate(() => { const h = window.__h; return `${h.state}/${h.chore} ${h.p.currentName} x=${(h.pos.x - h.room.group.position.x).toFixed(1)} habla=${h.talking}`; });
await new Promise(r => setTimeout(r, 1500)); await pg.screenshot({ path: output.replace('.png', '_0.png') }); console.log(0, await info());
await pg.evaluate(() => {
  const h = window.__h, s = h.room;
  window.__live.set(e => ({ sessions: { ...e.sessions, qa: { id: 'qa', dwellerId: h.id.id, roomId: s.id, cwd: s.path, state: 'working', activity: { mode: 'write', text: 'editando src/app.ts' }, unread: false, title: 'QA', pending: 0, helpers: [], tools: 3, turns: 1, created: Date.now(), updated: Date.now() } } }));
  let n = 0; window.__text = setInterval(() => { window.__live.set(e => ({ partial: { ...e.partial, qa: (e.partial.qa ?? '') + 'bla ' } })); if (++n > 80) clearInterval(window.__text); }, 90);
});
for (let i = 1; i <= 4; i++) { await new Promise(r => setTimeout(r, 2500)); await pg.screenshot({ path: output.replace('.png', `_${i}.png`) }); console.log(i, await info()); }
await b.close();

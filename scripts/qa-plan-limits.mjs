// QA of the plan's usage meter in the top bar (PlanMeter in web/src/ui/Hud.tsx): the traffic light by usage against
// the share of the window passed (grey unknown, green, amber, red, «LIMIT» when rejected), the weekly window once known
// and the popover on hover with each window's chart and reset. Limits are injected into the page store (no Claude sessions).
// Usage: node scripts/qa-plan-limits.mjs [url] [screenshots-dir]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', dir = '/tmp/qa-limites-capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const H = 3600_000;
const set = limits => pg.evaluate(l => window.__live.set({ planLimits: l }), limits);
// a window resetting in `inH` hours, with samples every 10 min from its start up to now rising to `utilization`
const lim = (status, utilization, inH, lenH = 5) => {
  const now = Date.now(), resetsAt = inH == null ? null : now + inH * H, start = resetsAt ? resetsAt - lenH * H : now - H;
  const samples = utilization == null ? [] : Array.from({ length: Math.floor((now - start) / 600_000) }, (_, i) => [start + i * 600_000, utilization * i * 600_000 / (now - start)]);
  return { status, utilization, resetsAt, updated: now, samples };
};
const meter = () => pg.evaluate(() => { const m = document.querySelector('.limites'); return m && { light: m.querySelector('.semaforo')?.innerHTML, items: [...m.querySelectorAll('.limite')].map(x => ({ kind: x.className, text: x.textContent })) }; });
const pop = async () => { await pg.hover('.limites'); await pg.waitForTimeout(200); const r = await pg.evaluate(() => document.querySelector('.limites-pop')?.textContent ?? ''); return r; };
const bar = { clip: { x: 0, y: 0, width: 1600, height: 90 }, timeout: 90_000, animations: 'disabled' };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
// the 3D canvas out of the way: a WebGL readback in software rendering makes screenshots time out
await pg.addStyleTag({ content: 'canvas { visibility: hidden !important; }' });

await set({}); await pg.waitForTimeout(300);
let m = await meter();
check(m?.items.length === 1 && /gris/.test(m.items[0].kind) && /—/.test(m.items[0].text) && /luz gris/.test(m.light), `nothing known: 5 h grey (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/1-desconocido.png`, ...bar });
// 5 h: 42 % with half the window passed (ratio 0.84); weekly: 18 % on day 5 (ratio 0.25)
await set({ five_hour: lim('allowed', 42, 2.5), seven_day: lim('allowed', 18, 48, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 2 && /verde/.test(m.items[0].kind) && /42%/.test(m.items[0].text) && /18%/.test(m.items[1].text) && /luz verde/.test(m.light), `green, with the weekly window (${JSON.stringify(m)})`);
let p = await pop();
check(/42 %/.test(p) && /50 %/.test(p) && /(resets|se renueva)/.test(p) && (await pg.locator('.limites-pop svg').count()) === 2, `popover: usage vs pace, reset, a chart per window (${p})`);
await pg.screenshot({ path: `${dir}/2-verde-pop.png`, clip: { x: 1000, y: 0, width: 600, height: 420 }, timeout: 90_000, animations: 'disabled' });
await pg.mouse.move(10, 500);
// 5 h: 55 % at half (1.1, amber); weekly: 50 % on day 1 (3.5, red): the overall light is the weekly one
await set({ five_hour: lim('allowed', 55, 2.5), seven_day: lim('allowed', 50, 144, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(/amarillo/.test(m?.items[0].kind) && /rojo/.test(m?.items[1].kind) && /luz rojo/.test(m?.light) && /(wk|sem)/.test(m?.light), `amber and red; the light names the weekly window (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/3-amarillo-rojo.png`, ...bar });
await set({ five_hour: lim('rejected', 100, 0.5), seven_day: lim('allowed', 60, 30, 168), seven_day_opus: lim('rejected', null, 40, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 3 && /agotado/.test(m.items[0].kind) && /LIMIT|LÍMITE/.test(m.items[0].text) && /agotado/.test(m.items[2].kind), `rejected: LIMIT, and the weekly Opus one shows too (${JSON.stringify(m)})`);
p = await pop();
check(/Opus/.test(p), `popover names the weekly Opus window (${p})`);
await pg.screenshot({ path: `${dir}/4-agotado-pop.png`, clip: { x: 1000, y: 0, width: 600, height: 560 }, timeout: 90_000, animations: 'disabled' });
check(!errors.length, `no page errors ${errors.join(' | ')}`);
await b.close();
console.log(failures ? `${failures} fallos` : 'Todo bien'); process.exit(failures ? 1 : 0);

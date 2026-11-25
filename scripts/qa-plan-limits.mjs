// QA of the plan's usage meter in the top bar (PlanMeter in web/src/ui/Hud.tsx): the traffic light by usage against
// the share of the window passed (grey unknown, green, amber, red, «LIMIT» when rejected), the weekly window once known
// and the popover on hover with each window's chart and reset, and the tokens spent (UsageGraph.tsx, read from the real
// transcripts by the server). Limits are injected into the page store (no Claude sessions).
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
const meter = () => pg.evaluate(() => { const m = document.querySelector('.limits'); return m && { light: m.querySelector('.traffic-light')?.innerHTML, items: [...m.querySelectorAll('.limit')].map(x => ({ kind: x.className, text: x.textContent })) }; });
const pop = async () => { await pg.hover('.limits'); await pg.waitForTimeout(200); const r = await pg.evaluate(() => document.querySelector('.limits-pop')?.textContent ?? ''); return r; };
const bar = { clip: { x: 0, y: 0, width: 1600, height: 90 }, timeout: 90_000, animations: 'disabled' };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
// the 3D canvas out of the way: a WebGL readback in software rendering makes screenshots time out
await pg.addStyleTag({ content: 'canvas { visibility: hidden !important; }' });

await set({}); await pg.waitForTimeout(300);
let m = await meter();
check(m?.items.length === 1 && /gray/.test(m.items[0].kind) && /—/.test(m.items[0].text) && /light gray/.test(m.light), `nothing known: 5 h grey (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/1-desconocido.png`, ...bar });
// 5 h: 42 % with half the window passed (ratio 0.84); weekly: 18 % on day 5 (ratio 0.25)
await set({ five_hour: lim('allowed', 42, 2.5), seven_day: lim('allowed', 18, 48, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 2 && /green/.test(m.items[0].kind) && /42%/.test(m.items[0].text) && /18%/.test(m.items[1].text) && /light green/.test(m.light), `green, with the weekly window (${JSON.stringify(m)})`);
let p = await pop();
check(/42 %/.test(p) && /50 %/.test(p) && /(resets|se renueva)/.test(p) && (await pg.locator('.limits-pop .limit-chart').count()) === 2, `popover: usage vs pace, reset, a chart per window (${p})`);
await pg.screenshot({ path: `${dir}/2-verde-pop.png`, clip: { x: 1000, y: 0, width: 600, height: 420 }, timeout: 90_000, animations: 'disabled' });
await pg.mouse.move(10, 500);
// 5 h: 55 % at half (1.1, amber); weekly: 50 % on day 1 (3.5, red): the overall light is the weekly one
await set({ five_hour: lim('allowed', 55, 2.5), seven_day: lim('allowed', 50, 144, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(/yellow/.test(m?.items[0].kind) && /red/.test(m?.items[1].kind) && /light red/.test(m?.light) && /(wk|sem)/.test(m?.light), `amber and red; the light names the weekly window (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/3-amarillo-rojo.png`, ...bar });
await set({ five_hour: lim('rejected', 100, 0.5), seven_day: lim('allowed', 60, 30, 168), seven_day_opus: lim('rejected', null, 40, 168) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 3 && /exhausted/.test(m.items[0].kind) && /LIMIT|LÍMITE/.test(m.items[0].text) && /exhausted/.test(m.items[2].kind), `rejected: LIMIT, and the weekly Opus one shows too (${JSON.stringify(m)})`);
p = await pop();
check(/Opus/.test(p), `popover names the weekly Opus window (${p})`);
await pg.screenshot({ path: `${dir}/4-agotado-pop.png`, clip: { x: 1000, y: 0, width: 600, height: 560 }, timeout: 90_000, animations: 'disabled' });
// the tokens spent: 5 h by hour with the window's start, a bar's tooltip, 7 days by day; it stays while the pointer is
// in the popover, goes once it leaves, and keyboard focus opens it too
await pg.mouse.move(10, 500);
await set({ five_hour: lim('allowed', 42, 2.5), seven_day: lim('allowed', 18, 48, 168) }); await pg.waitForTimeout(300);
await pg.hover('.limits');
await pg.waitForSelector('.usage-chart svg', { timeout: 60000 });
const graph = () => pg.evaluate(() => { const g = document.querySelector('.usage-chart'); return g && { text: g.textContent, bars: g.querySelectorAll('.usage-target').length, window: !!g.querySelector('.usage-mark'), tab: g.querySelector('.usage-views .active')?.textContent }; });
let g = await graph();
check(g?.bars === 6 && g.window, `spent: 6 hourly bars with the window's start (${JSON.stringify(g)})`);
await pg.hover('.usage-target >> nth=4');
check(await pg.locator('.usage-tip').count() === 1, 'spent: a bar\'s tooltip on hover');
const popBox = async () => { const r = await pg.locator('.limits-pop').boundingBox(); return { clip: { x: r.x - 10, y: 0, width: r.width + 20, height: r.y + r.height + 10 }, timeout: 90_000, animations: 'disabled' }; };
await pg.screenshot({ path: `${dir}/5-gasto-horas.png`, ...(await popBox()) });
await pg.click('.usage-views button >> nth=1');
g = await graph();
check(g?.bars === 8 && g.window, `spent: 7 days by day, 8 daily bars (${JSON.stringify(g)})`);
await pg.screenshot({ path: `${dir}/6-gasto-dias.png`, ...(await popBox()) });
await pg.mouse.move(800, 600);
check(await pg.waitForSelector('.limits-pop', { state: 'detached', timeout: 3000 }).then(() => true, () => false), 'gone once the pointer leaves');
await pg.focus('.limits'); await pg.waitForTimeout(100);
check(await pg.locator('.usage-chart').count() === 1, 'keyboard focus opens it too');
check(!errors.length, `no page errors ${errors.join(' | ')}`);
await b.close();
console.log(failures ? `${failures} fallos` : 'Todo bien'); process.exit(failures ? 1 : 0);

// QA of the plan's usage meter in the top bar (PlanMeter in web/src/ui/Hud.tsx): unknown, green, amber, red and
// «LIMIT» when rejected, the weekly window once known and the tooltip with the resets. Limits are injected into the
// page store (no Claude sessions).
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
const lim = (status, utilization, inH) => ({ status, utilization, resetsAt: inH == null ? null : Date.now() + inH * H, updated: Date.now() });
const meter = () => pg.evaluate(() => { const m = document.querySelector('.limites'); return m && { title: m.title, items: [...m.querySelectorAll('.limite')].map(x => ({ kind: x.className, text: x.textContent })) }; });
const bar = { clip: { x: 0, y: 0, width: 1600, height: 90 }, timeout: 90_000, animations: 'disabled' };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
// the 3D canvas out of the way: a WebGL readback in software rendering makes screenshots time out
await pg.addStyleTag({ content: 'canvas { visibility: hidden !important; }' });

await set({}); await pg.waitForTimeout(300);
let m = await meter();
check(m?.items.length === 1 && /desconocido/.test(m.items[0].kind) && /—/.test(m.items[0].text) && /unknown|desconocido/.test(m.title), `nothing known: 5 h unknown (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/1-desconocido.png`, ...bar });
await set({ five_hour: lim('allowed', 42, 2.5), seven_day: lim('allowed', 18, 80) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 2 && /bajo/.test(m.items[0].kind) && /42%/.test(m.items[0].text) && /18%/.test(m.items[1].text) && /42 %/.test(m.title), `green, with the weekly window (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/2-bajo.png`, ...bar });
await set({ five_hour: lim('allowed_warning', 78, 1), seven_day: lim('allowed', 93, 30) }); await pg.waitForTimeout(300);
m = await meter();
check(/medio/.test(m?.items[0].kind) && /alto/.test(m?.items[1].kind), `amber and red (${JSON.stringify(m?.items)})`);
await pg.screenshot({ path: `${dir}/3-medio-alto.png`, ...bar });
await set({ five_hour: lim('rejected', 100, 0.5), seven_day: lim('allowed', 60, 30), seven_day_opus: lim('rejected', null, 40) }); await pg.waitForTimeout(300);
m = await meter();
check(m?.items.length === 3 && /agotado/.test(m.items[0].kind) && /LIMIT|LÍMITE/.test(m.items[0].text) && /agotado/.test(m.items[2].kind) && /Opus/.test(m.title), `rejected: LIMIT, and the weekly Opus one shows too (${JSON.stringify(m)})`);
await pg.screenshot({ path: `${dir}/4-agotado.png`, ...bar });
console.log(m?.title);
check(!errors.length, `no page errors ${errors.join(' | ')}`);
await b.close();
console.log(failures ? `${failures} fallos` : 'Todo bien'); process.exit(failures ? 1 : 0);

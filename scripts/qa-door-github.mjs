// QA of the Main Gate's «From GitHub…» (web/src/ui/RoomPanels.tsx, server/githubClone.ts): the option in the gate's
// list, your repos filtered as you type (one already cloned marked), a pasted owner/name, and the clone with its
// progress up to the recruit sheet. Saves one screenshot per step.
// Usage: SHELTER_DATOS=… node scripts/qa-door-github.mjs <url> <filter> <repo to clone> [folder]
//   (a test shelter whose repos root is a scratch folder, with GitHub connected: the clone lands in that root)
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url, filter, repo, dir = '_capturas/door-github'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = []; pg.on('pageerror', e => errors.push(e.message));
await pg.addInitScript(() => localStorage.setItem('shelter.language', 'en'));
await pg.goto(withToken(url), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: 'gate', panelData: null }); });
const shot = async n => { await pg.waitForTimeout(400); await pg.locator('.device').screenshot({ path: path.join(dir, n + '.png') }); console.log('saved', n); };
const row = text => pg.locator('.options-console li', { hasText: text }).first();
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };

await row('GitHub').waitFor(); await shot('1-gate');
await row('GitHub').click();
await pg.waitForFunction(() => !/Reading your GitHub|Leyendo tus repos/.test(document.querySelector('.device')?.textContent ?? ''), null, { timeout: 60000 });
check(await pg.locator('.options-console li').count() > 0, 'your repos are listed');
await shot('2-repos');
await pg.locator('.device input').fill(filter); await shot('3-filtered');
check(await pg.locator('.options-console li', { hasText: 'already at' }).count() > 0, 'a repo already under the root is marked');
await pg.locator('.device input').fill(`https://github.com/${repo}.git`);
check(await row(`Go to https://github.com/${repo}.git`).count() === 1 || await row(repo).count() > 0, 'a pasted URL can be opened');
await shot('4-pasted');
await pg.locator('.device input').press('Enter');
await pg.locator('.device', { hasText: 'CLONE' }).waitFor(); await shot('5-destination');
await pg.locator('.device input').fill(await pg.locator('.device input').inputValue().then(v => v.replace(/[^/]+$/, 'group/$&')));
await pg.locator('.device input').press('Enter');
await pg.waitForTimeout(700); await shot('6-cloning');
await pg.locator('.device', { hasText: 'RECRUIT' }).waitFor({ timeout: 300000 }); await shot('7-recruit');
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
process.exit(failures ? 1 : 0);

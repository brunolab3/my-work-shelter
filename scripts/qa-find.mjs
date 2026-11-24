// QA of ⌘F (web/src/ui/FindBar.tsx), with a real keyboard (Playwright), no Claude Code sessions:
// - The intercom: ⌘F with nothing focused opens the bar on the log in view, counts and marks matches, Enter/⇧Enter/↑↓
//   move between them, a new entry is searched too (staying on the same match), Esc closes it and clears the marks.
// - A field elsewhere (a terminal's) keeps ⌘F: no bar.
// - The «Página» window: with the focus in its <iframe>, Electron's Edit → Find calls window.__findShortcut (called here
//   as the menu would); the page's notes layer (server/page/notes.js) finds inside the page only and answers the count.
// The <webview> browsers use Electron's findInPage: only in the app (not in this Chromium).
// Usage: node scripts/qa-find.mjs [url]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173'] = process.argv.slice(2);
const dir = '/tmp/qa-buscar'; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/plan.md`, '# Plan\n\nPush the branch. Then push again.\n\n## Push gate\n\nNothing else to push here.\n');

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = []; pg.on('pageerror', e => errors.push(e.message));
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(150); } return false; };
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });

const bar = () => pg.evaluate(() => { const x = document.querySelector('.barra-buscar'); return x ? { count: x.querySelector('.barra-buscar-cuenta').textContent, host: x.parentElement.className, focused: document.activeElement === x.querySelector('input') } : null; });
const marks = () => pg.evaluate(() => ({ all: CSS.highlights.get('refugio-buscar')?.size ?? 0, current: CSS.highlights.get('refugio-buscar-actual')?.size ?? 0 }));

// ---- the intercom: a conversation's log as the intercom draws it
await pg.evaluate(() => {
  const c = document.createElement('div'); c.className = 'consola interactivo'; c.id = 'qa-consola';
  c.style.cssText = 'position:fixed;right:20px;top:80px;width:620px;height:420px;z-index:999999;display:flex';
  c.innerHTML = '<div class="pantalla-consola fosforo sesion" data-sesion="qa"><div class="lienzo">' +
    Array.from({ length: 40 }, (_, i) => `<div class="ent asistente"><p>Entry ${i}: ${i % 10 === 0 ? 'time to <b>pu</b>sh the branch' : 'nothing here'}</p></div>`).join('') + '</div></div>';
  document.body.append(c);
  document.activeElement?.blur?.();
});
await pg.keyboard.press('Meta+f');
check(await until(async () => (await bar())?.focused), '⌘F with nothing focused opens the bar on the intercom, its field focused');
check((await bar())?.host.includes('sesion'), 'inside the conversation in view');
await pg.keyboard.type('push');
check(await until(async () => (await bar())?.count === '1/4'), `counts the matches, across inline tags (${(await bar())?.count})`);
check((await marks()).all === 4 && (await marks()).current === 1, 'marks them all and the current one');
await pg.keyboard.press('Enter');
check((await bar())?.count === '2/4', 'Enter goes to the next one');
await pg.keyboard.press('Shift+Enter'); await pg.keyboard.press('ArrowUp');
check((await bar())?.count === '4/4', '⇧Enter and ↑ go back, wrapping around');
const scrolled = await pg.evaluate(() => document.querySelector('#qa-consola .lienzo').scrollTop);
check(scrolled > 0, `the log scrolls to the current match (${scrolled})`);
await pg.evaluate(() => { const l = document.querySelector('#qa-consola .lienzo'); l.insertAdjacentHTML('afterbegin', '<div class="ent asistente"><p>An older push</p></div>'); });
check(await until(async () => (await bar())?.count === '5/5'), `an entry loaded above is searched too, on the same match (${(await bar())?.count})`);
await pg.keyboard.press('Meta+a'); await pg.keyboard.type('zzz');
check(await until(async () => /No matches|Sin resultados/.test((await bar())?.count ?? '')), 'no matches says so');
await pg.keyboard.press('Escape');
check(await until(async () => !(await bar())), 'Esc closes it');
check((await marks()).all === 0 && (await marks()).current === 0, 'and clears the marks');
check(await pg.evaluate(() => !!document.querySelector('#qa-consola')), 'Esc stays in the bar (the intercom is still there)');

// ---- a field elsewhere keeps ⌘F
await pg.evaluate(() => { const t = document.createElement('div'); t.className = 'ventana-terminal'; t.id = 'qa-terminal'; t.innerHTML = '<textarea></textarea>'; document.body.append(t); t.querySelector('textarea').focus(); });
await pg.keyboard.press('Meta+f'); await pg.waitForTimeout(300);
check(!(await bar()), 'with the focus in a terminal, ⌘F opens nothing');
await pg.evaluate(() => { document.querySelector('#qa-terminal').remove(); document.querySelector('#qa-consola').remove(); });

// ---- the «Página» window: the page's own text only
const { page } = await pg.evaluate(link => window.__client.action('enlace.local', { path: link }), `${dir}/plan.md`);
await pg.evaluate(async p => { const { openPage } = await import('/src/ui/Browsers.tsx'); openPage(p.url, p.title, undefined, p.path); }, page);
check(await until(() => pg.evaluate(() => !!document.querySelector('.ventana-navegador iframe.vn-pagina'))), 'the plan opens in the «Página» window');
await pg.waitForTimeout(800);
await pg.click('.ventana-navegador iframe.vn-pagina', { position: { x: 200, y: 300 } });
check(await pg.evaluate(() => document.activeElement?.tagName === 'IFRAME'), 'the focus is in the page');
check(await pg.evaluate(() => window.__findShortcut()), 'Edit → Find (window.__findShortcut) takes it');
check(await until(async () => (await bar())?.host.includes('vn-cuerpo')), 'the bar opens on the page window');
await pg.keyboard.press('Meta+a'); await pg.keyboard.type('push');
check(await until(async () => (await bar())?.count === '1/4'), `the page's matches only, not the game's (${(await bar())?.count})`);
await pg.keyboard.press('ArrowDown');
check(await until(async () => (await bar())?.count === '2/4'), '↓ goes to the next one in the page');
const inPage = await pg.frame({ url: /\/pagina\// })?.evaluate(() => ({ all: CSS.highlights.get('refugio-buscar')?.size, current: CSS.highlights.get('refugio-buscar-actual')?.size }));
check(inPage?.all === 4 && inPage?.current === 1, `marked inside the page (${JSON.stringify(inPage)})`);
await pg.keyboard.press('Escape');
check(await until(async () => !(await bar())), 'Esc closes it');
check(await pg.evaluate(() => document.activeElement?.tagName === 'IFRAME'), 'and the focus goes back to the page');
check(await until(async () => (await pg.frame({ url: /\/pagina\// })?.evaluate(() => CSS.highlights.get('refugio-buscar')?.size)) === 0), 'the page\'s marks are cleared');

check(!errors.length, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
await b.close();
console.log(failures ? `\n${failures} FAIL` : '\nall OK');
process.exit(failures ? 1 : 0);

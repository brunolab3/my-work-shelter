// QA of ⌘F (web/src/ui/FindBar.tsx), with a real keyboard (Playwright), no Claude Code sessions:
// - The intercom: ⌘F with nothing focused opens the bar on the conversation, counts its whole log (server, answered here), loads the older pages a match is in, Enter/⇧Enter/↑↓
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

const bar = () => pg.evaluate(() => { const x = document.querySelector('.bar-find'); return x ? { count: x.querySelector('.bar-find-count').textContent, host: x.parentElement.className, focused: document.activeElement === x.querySelector('input') } : null; });
const marks = () => pg.evaluate(() => ({ all: CSS.highlights.get('shelter-find')?.size ?? 0, current: CSS.highlights.get('shelter-find-current')?.size ?? 0 }));

// ---- the intercom: the whole conversation, counted by the server (answered here: 250 entries, 25 of them match, the
// intercom holds the last 100; the rest come in a page at a time as the bar reaches them)
const ALL = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, ts: 1000 + i, type: 'asistente', text: i % 10 === 0 ? `time to push the branch ${i}` : `nothing here ${i}` }));
await pg.evaluate(() => {
  const c = document.createElement('div'); c.className = 'console interactive'; c.id = 'qa-consola';
  c.style.cssText = 'position:fixed;right:20px;top:80px;width:620px;height:420px;z-index:999999;display:flex';
  c.innerHTML = '<div class="screen-console phosphor session" data-session="qa"><div class="canvas"></div></div>';
  document.body.append(c);
  document.activeElement?.blur?.();
});
await pg.evaluate(all => {
  const live = window.__live, client = window.__client;
  const draw = () => {
    const held = live.get().entries.qa ?? [];
    document.querySelector('#qa-consola .canvas').innerHTML = held.map(e => `<div class="ent assistant" data-entry="${e.id}"><p>${e.text.replace('push', '<b>pu</b>sh')}</p></div>`).join('');
  };
  const ask = client.ask.bind(client);
  client.ask = (m, w) => {
    if (m.t === 'logFind' && m.sessionId === 'qa') {
      const q = m.query.toLowerCase(), hits = []; let total = 0;
      for (const e of all) {
        const low = e.text.toLowerCase(); let n = 0;
        for (let p = low.indexOf(q); p >= 0; p = low.indexOf(q, p + q.length)) n++;
        if (n) { hits.push({ id: e.id, n }); total += n; }
      }
      return Promise.resolve({ hits, total });
    }
    if (m.t === 'logPage' && m.sessionId === 'qa') {
      const end = m.before ? all.findIndex(e => e.id === m.before.id) : all.length, start = Math.max(0, end - m.limit);
      return Promise.resolve({ entries: all.slice(start, end), more: start > 0 });
    }
    return ask(m, w);
  };
  live.set({ entries: { qa: all.slice(150) }, older: { qa: true } });
  live.subscribe(draw); draw();
}, ALL);
await pg.keyboard.press('Meta+f');
check(await until(async () => (await bar())?.focused), '⌘F with nothing focused opens the bar on the intercom, its field focused');
check((await bar())?.host.includes('session'), 'inside the conversation in view');
await pg.keyboard.type('push');
check(await until(async () => (await bar())?.count === '25/25'), `counts the whole conversation, newest match first (${(await bar())?.count})`);
check(await until(async () => { const m = await marks(); return m.all === 10 && m.current === 1; }), `marks the held ones and the current one (${JSON.stringify(await marks())})`);
await pg.keyboard.press('Enter');
check(await until(async () => (await bar())?.count === '1/25'), `Enter wraps to the first match, in an entry not held yet (${(await bar())?.count})`);
check(await until(() => pg.evaluate(() => !!document.querySelector('#qa-consola [data-entry="e0"]'))), 'the older pages came in until it is held');
check(await until(() => pg.evaluate(() => CSS.highlights.get('shelter-find-current')?.size === 1)), 'and it is marked');
await pg.keyboard.press('ArrowDown');
check(await until(async () => (await bar())?.count === '2/25'), '↓ goes to the next one');
await pg.keyboard.press('Meta+a'); await pg.keyboard.type('zzz');
check(await until(async () => /No matches|Sin resultados/.test((await bar())?.count ?? '')), 'no matches says so');
await pg.keyboard.press('Escape');
check(await until(async () => !(await bar())), 'Esc closes it');
check((await marks()).all === 0 && (await marks()).current === 0, 'and clears the marks');
check(await pg.evaluate(() => !!document.querySelector('#qa-consola')), 'Esc stays in the bar (the intercom is still there)');

// ---- a field elsewhere keeps ⌘F
await pg.evaluate(() => { const t = document.createElement('div'); t.className = 'window-terminal'; t.id = 'qa-terminal'; t.innerHTML = '<textarea></textarea>'; document.body.append(t); t.querySelector('textarea').focus(); });
await pg.keyboard.press('Meta+f'); await pg.waitForTimeout(300);
check(!(await bar()), 'with the focus in a terminal, ⌘F opens nothing');
await pg.evaluate(() => { document.querySelector('#qa-terminal').remove(); document.querySelector('#qa-consola').remove(); });

// ---- the «Página» window: the page's own text only
const { page } = await pg.evaluate(link => window.__client.action('link.local', { path: link }), `${dir}/plan.md`);
await pg.evaluate(async p => { const { openPage } = await import('/src/ui/Browsers.tsx'); openPage(p.url, p.title, undefined, p.path); }, page);
check(await until(() => pg.evaluate(() => !!document.querySelector('.window-browser iframe.vn-page'))), 'the plan opens in the «Página» window');
await pg.waitForTimeout(800);
await pg.click('.window-browser iframe.vn-page', { position: { x: 200, y: 300 } });
check(await pg.evaluate(() => document.activeElement?.tagName === 'IFRAME'), 'the focus is in the page');
check(await pg.evaluate(() => window.__findShortcut()), 'Edit → Find (window.__findShortcut) takes it');
check(await until(async () => (await bar())?.host.includes('vn-body')), 'the bar opens on the page window');
await pg.keyboard.press('Meta+a'); await pg.keyboard.type('push');
check(await until(async () => (await bar())?.count === '1/4'), `the page's matches only, not the game's (${(await bar())?.count})`);
await pg.keyboard.press('ArrowDown');
check(await until(async () => (await bar())?.count === '2/4'), '↓ goes to the next one in the page');
const inPage = await pg.frame({ url: /\/pagina\// })?.evaluate(() => ({ all: CSS.highlights.get('shelter-find')?.size, current: CSS.highlights.get('shelter-find-current')?.size }));
check(inPage?.all === 4 && inPage?.current === 1, `marked inside the page (${JSON.stringify(inPage)})`);
await pg.keyboard.press('Escape');
check(await until(async () => !(await bar())), 'Esc closes it');
check(await pg.evaluate(() => document.activeElement?.tagName === 'IFRAME'), 'and the focus goes back to the page');
check(await until(async () => (await pg.frame({ url: /\/pagina\// })?.evaluate(() => CSS.highlights.get('shelter-find')?.size)) === 0), 'the page\'s marks are cleared');

check(!errors.length, `no page errors ${errors.length ? JSON.stringify(errors) : ''}`);
await b.close();
console.log(failures ? `\n${failures} FAIL` : '\nall OK');
process.exit(failures ? 1 : 0);

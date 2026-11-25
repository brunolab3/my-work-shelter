// QA of a link's options in replies and in pages of the «Página» window (web/src/ui/linkOptions.ts): a click on a
// link opens it its first way; a right click opens a list at it, the in-game option first and marked; Enter takes it, Esc or a click elsewhere
// closes it; a missing file shows the list with a warning; thumbnails open directly. A second context poses as Electron
// (its user agent) to see the «Open in the game» of a web and its «Web» window (the <webview> itself only loads in Electron).
// Usage: node scripts/qa-link-options.mjs [url] [screenshots folder]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', screenshots = '/tmp/qa-opciones-enlace'] = process.argv.slice(2);
mkdirSync(screenshots, { recursive: true });

const dir = '/tmp/qa-opciones-enlace-archivos'; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/plan.html`, `<h1>The plan</h1><p><a id=abs href="${dir}/codigo.ts">the code</a> · <a id=rel href="punto.png">a picture</a> · <a id=web href="https://example.com/docs/page">a web</a> · <a id=ancla href="#arriba">up</a></p>`);
writeFileSync(`${dir}/codigo.ts`, 'export const x = 1;\n');
// a 1×1 PNG
writeFileSync(`${dir}/punto.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };

async function open(electron) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, ...(electron ? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36' } : {}) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url0).origin });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(withToken(url0), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
  // a reply as the intercom draws it (same markdown())
  await pg.evaluate(async dir => {
    const { markdown } = await import('/src/ui/markdown.ts');
    const box = document.createElement('div'); box.id = 'qa-respuesta'; box.className = 'console interactive';
    box.style.cssText = 'position:fixed;right:20px;top:80px;width:560px;z-index:999999;background:#0b0d0a;padding:12px;color:#cfe';
    box.innerHTML = `<div class="ent asistente">${markdown([
      `The plan: ${dir}/plan.html — the code: ${dir}/codigo.ts — the folder: ${dir}/ — [a missing one](${dir}/falta.html)`,
      `A picture: ${dir}/punto.png`,
      `Webs: [example](https://example.com/docs/page) · [a PR](https://github.com/brunolab3/my-work-shelter/pull/1) · [write](mailto:ana@example.com)`,
    ].join('\n\n'))}</div>`;
    document.body.append(box);
  }, dir);
  return { pg, errors, ctx };
}
const list = pg => pg.evaluate(() => { const c = document.querySelector('.options-link'); return c ? { title: c.querySelector('.oe-title')?.textContent, options: [...c.querySelectorAll('.oe-option')].map(b => b.dataset.action), defaultOpt: c.querySelector('.oe-default')?.dataset.action, focus: document.activeElement?.dataset?.accion, notice: c.querySelector('.oe-notice')?.textContent ?? null } : null; });
const until = async (pg, f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(150); } return false; };
const menu = (pg, href) => pg.click(link(href), { button: 'right' });
const link = href => `#qa-respuesta a[data-local="${href}"]:not(.thumbnail), #qa-respuesta a[href="${href}"]`;
const page = pg => pg.evaluate(() => [...document.querySelectorAll('.window-browser')].map(v => ({ title: v.querySelector('.vt-title')?.textContent, path: v.querySelector('.vt-path')?.textContent, min: v.classList.contains('minimized'), web: v.querySelector('webview')?.getAttribute('src') ?? null, partition: v.querySelector('webview')?.getAttribute('partition') ?? null })));

// --- the game in a browser (outside Electron)
{
  const { pg, errors, ctx } = await open(false);
  await menu(pg, `${dir}/plan.html`);
  check(await until(pg, async () => !!(await list(pg))), 'a right click on a page link opens its options');
  let l = await list(pg);
  check(JSON.stringify(l?.options) === '["juego","mac","finder","copiar"]', `a page: game, default app, Finder, copy (${JSON.stringify(l?.options)})`);
  check(l?.defaultOpt === 'juego' && l?.focus === 'juego', `«Open in the game» first, marked and focused (${l?.defaultOpt}/${l?.focus})`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${screenshots}/1-pagina.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.keyboard.press('ArrowDown');
  check((await list(pg))?.focus === 'mac', '↓ moves to the next option');
  await pg.keyboard.press('Escape');
  check(!(await list(pg)), 'Esc closes it');
  check(await pg.evaluate(() => !document.querySelector('.window-browser')), 'and opens nothing');

  await menu(pg, `${dir}/plan.html`);
  await until(pg, async () => !!(await list(pg)));
  await pg.keyboard.press('Enter');
  check(await until(pg, async () => (await page(pg)).some(v => v.path?.includes('plan.html') || /Página|Page/.test(v.title ?? ''))), `Enter opens it in the game, in the «Página» window (${JSON.stringify(await page(pg))})`);
  check(!(await list(pg)), 'and the list goes');
  await pg.evaluate(() => [...document.querySelectorAll('.window-browser .vn-head button')].find(x => x.textContent === '×')?.click());
  await until(pg, async () => !(await page(pg)).length);

  await menu(pg, `${dir}/codigo.ts`);
  await until(pg, async () => !!(await list(pg)));
  l = await list(pg);
  check(JSON.stringify(l?.options) === '["mac","finder","copiar"]' && l?.defaultOpt === 'mac', `code: editor first, no game option (${JSON.stringify(l?.options)})`);
  // a click elsewhere closes it
  await pg.mouse.click(200, 700);
  check(!(await list(pg)), 'a click elsewhere closes it');

  await menu(pg, `${dir}/falta.html`);
  await until(pg, async () => !!(await list(pg)));
  l = await list(pg);
  check(JSON.stringify(l?.options) === '["copiar"]' && !!l?.notice, `a missing file: a warning and only «copy path» (${JSON.stringify(l)})`);
  await pg.screenshot({ path: `${screenshots}/2-falta.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.click('.options-link [data-action="copy"]');
  check(await pg.evaluate(() => navigator.clipboard.readText()) === `${dir}/falta.html`, '«Copy path» copies it');

  // outside Electron, a web can't be seen inside: the browser first
  await menu(pg, 'https://example.com/docs/page');
  await until(pg, async () => !!(await list(pg)));
  l = await list(pg);
  check(JSON.stringify(l?.options) === '["navegador","copiar"]', `a web outside Electron: browser, copy (${JSON.stringify(l?.options)})`);
  await pg.keyboard.press('Escape');
  await menu(pg, 'mailto:ana@example.com');
  await until(pg, async () => !!(await list(pg)));
  check(JSON.stringify((await list(pg))?.options) === '["navegador","copiar"]', 'mail: mail app, copy address');
  await pg.click('.options-link [data-action="copy"]');
  check(await pg.evaluate(() => navigator.clipboard.readText()) === 'ana@example.com', '«Copy address» copies the address');

  // a left click: the first one directly
  await pg.click(link(`${dir}/plan.html`));
  check(await until(pg, async () => (await page(pg)).length === 1), 'a click opens it in the game directly');
  check(!(await list(pg)), 'without the list');

  // the links of that page, the same way: a right click shows the options at the pointer, a click the first one
  const frame = pg.frameLocator('.window-browser iframe');
  await frame.locator('#web').waitFor({ timeout: 15000 });
  const inFrame = async (id, button) => {
    const r = await frame.locator(id).boundingBox(), x = r.x + 4, y = r.y + r.height / 2;
    await pg.mouse.click(x, y, { button });
    return { x, y };
  };
  const atPointer = ({ x, y }) => pg.evaluate(({ x, y }) => { const r = document.querySelector('.options-link')?.getBoundingClientRect(); return !!r && Math.abs(r.left - Math.max(8, x - 12)) < 2 && (Math.abs(r.top - y - 4) < 2 || Math.abs(r.bottom - y + 4) < 2); }, { x, y });
  let p = await inFrame('#abs', 'right');
  check(await until(pg, async () => !!(await list(pg))), 'a right click on a link of a page opens its options');
  l = await list(pg);
  check(JSON.stringify(l?.options) === '["mac","finder","copiar"]' && l?.title === `${dir}/codigo.ts`, `an absolute path: the file's options (${JSON.stringify(l)})`);
  check(await atPointer(p), 'at the pointer');
  await pg.keyboard.press('Escape');
  await inFrame('#web', 'right');
  await until(pg, async () => !!(await list(pg)));
  check(JSON.stringify((await list(pg))?.options) === '["navegador","copiar"]', 'a web of a page: its options');
  await pg.keyboard.press('Escape');
  await inFrame('#rel', 'right');
  await until(pg, async () => !!(await list(pg)));
  l = await list(pg);
  check(l?.title?.endsWith(`${dir}/punto.png`) && l?.defaultOpt === 'juego', `a relative link: the file next to the page (${JSON.stringify(l)})`);
  await pg.keyboard.press('Escape');
  await inFrame('#ancla');
  await pg.waitForTimeout(500);
  check(!(await list(pg)) && (await page(pg)).some(v => v.path?.includes('plan.html')), 'an anchor of the page stays in it');
  await inFrame('#rel');
  check(await until(pg, () => pg.evaluate(() => !!document.querySelector('.window-browser .vn-image img'))), 'a click on a relative link opens it its first way (the picture, in the game)');
  check(!(await list(pg)), 'without the list');
  await pg.evaluate(() => [...document.querySelectorAll('.window-browser .vn-head button')].find(x => x.textContent === '×')?.click());
  await until(pg, async () => !(await page(pg)).length);
  await pg.click(link(`${dir}/falta.html`));
  check(await until(pg, async () => !!(await list(pg))?.notice), 'a click on a missing file shows the list with its warning');
  await pg.keyboard.press('Escape');

  // a thumbnail is the picture: straight into the game
  await until(pg, () => pg.evaluate(() => !!document.querySelector('#qa-respuesta a.thumbnail img[src]')));
  await pg.click('#qa-respuesta a.thumbnail');
  check(await until(pg, () => pg.evaluate(() => !!document.querySelector('.window-browser .vn-image img'))), 'a thumbnail opens the image directly');
  check(!(await list(pg)), 'without the list');
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

// --- as in Electron: a web inside
{
  const { pg, errors, ctx } = await open(true);
  await menu(pg, 'https://example.com/docs/page');
  await until(pg, async () => !!(await list(pg)));
  let l = await list(pg);
  check(JSON.stringify(l?.options) === '["juego","navegador","copiar"]' && l?.defaultOpt === 'juego', `a web in Electron: game first (${JSON.stringify(l?.options)})`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${screenshots}/3-web.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.keyboard.press('Enter');
  check(await until(pg, async () => (await page(pg)).some(v => v.web === 'https://example.com/docs/page' && v.partition === 'persist:web')), `in the «Web» window, its own session (${JSON.stringify(await page(pg))})`);
  await until(pg, () => pg.evaluate(() => getComputedStyle(document.querySelector('.window-browser')).opacity === '1'));   // after its opening fade
  await pg.screenshot({ path: `${screenshots}/4-ventana-web.png` });

  await menu(pg, 'https://github.com/brunolab3/my-work-shelter/pull/1');
  await until(pg, async () => !!(await list(pg)));
  l = await list(pg);
  check(/GitHub/.test(await pg.evaluate(() => document.querySelector('.options-link .oe-default')?.textContent ?? '')), 'a web with its own browser names it (GitHub)');
  await pg.keyboard.press('Enter');
  check(await until(pg, async () => (await page(pg)).some(v => /GitHub/.test(v.title ?? '') && v.partition === 'persist:navegador' && !v.min)), `opens in the GitHub browser (${JSON.stringify(await page(pg))})`);
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await ctx.close();
}
console.log(`Screenshots: ${screenshots}`);
await b.close();
process.exit(failures ? 1 : 0);

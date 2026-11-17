// QA of a link's options in replies and in pages of the «Página» window (web/src/ui/linkOptions.ts): a click on a
// link opens it its first way; a right click opens a list at it, the in-game option first and marked; Enter takes it, Esc or a click elsewhere
// closes it; a missing file shows the list with a warning; thumbnails open directly. A second context poses as Electron
// (its user agent) to see the «Open in the game» of a web and its «Web» window (the <webview> itself only loads in Electron).
// Usage: node scripts/qa-link-options.mjs [url] [screenshots folder]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173', capturas = '/tmp/qa-opciones-enlace'] = process.argv.slice(2);
mkdirSync(capturas, { recursive: true });

const dir = '/tmp/qa-opciones-enlace-archivos'; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/plan.html`, `<h1>The plan</h1><p><a id=abs href="${dir}/codigo.ts">the code</a> · <a id=rel href="punto.png">a picture</a> · <a id=web href="https://example.com/docs/page">a web</a> · <a id=ancla href="#arriba">up</a></p>`);
writeFileSync(`${dir}/codigo.ts`, 'export const x = 1;\n');
// a 1×1 PNG
writeFileSync(`${dir}/punto.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const ver = (ok, texto) => { console.log((ok ? 'OK   ' : 'FAIL ') + texto); if (!ok) failures++; };

async function abrir(electron) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, ...(electron ? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36' } : {}) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url0).origin });
  const pg = await ctx.newPage();
  const errores = []; pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(withToken(url0), { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
  await pg.evaluate(async () => { await window.__ready(); window.__juego.set({ panel: null, panelData: null }); });
  // a reply as the intercom draws it (same markdown())
  await pg.evaluate(async dir => {
    const { markdown } = await import('/src/ui/markdown.ts');
    const caja = document.createElement('div'); caja.id = 'qa-respuesta'; caja.className = 'consola interactivo';
    caja.style.cssText = 'position:fixed;right:20px;top:80px;width:560px;z-index:999999;background:#0b0d0a;padding:12px;color:#cfe';
    caja.innerHTML = `<div class="ent asistente">${markdown([
      `The plan: ${dir}/plan.html — the code: ${dir}/codigo.ts — the folder: ${dir}/ — [a missing one](${dir}/falta.html)`,
      `A picture: ${dir}/punto.png`,
      `Webs: [example](https://example.com/docs/page) · [a PR](https://github.com/brunolab3/my-work-shelter/pull/1) · [write](mailto:ana@example.com)`,
    ].join('\n\n'))}</div>`;
    document.body.append(caja);
  }, dir);
  return { pg, errores, ctx };
}
const lista = pg => pg.evaluate(() => { const c = document.querySelector('.opciones-enlace'); return c ? { titulo: c.querySelector('.oe-titulo')?.textContent, opciones: [...c.querySelectorAll('.oe-opcion')].map(b => b.dataset.accion), defecto: c.querySelector('.oe-defecto')?.dataset.accion, foco: document.activeElement?.dataset?.accion, aviso: c.querySelector('.oe-aviso')?.textContent ?? null } : null; });
const hasta = async (pg, f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(150); } return false; };
const menu = (pg, href) => pg.click(enlace(href), { button: 'right' });
const enlace = href => `#qa-respuesta a[data-local="${href}"]:not(.miniatura), #qa-respuesta a[href="${href}"]`;
const pagina = pg => pg.evaluate(() => [...document.querySelectorAll('.ventana-navegador')].map(v => ({ titulo: v.querySelector('.vt-titulo')?.textContent, ruta: v.querySelector('.vt-ruta')?.textContent, min: v.classList.contains('minimizada'), web: v.querySelector('webview')?.getAttribute('src') ?? null, particion: v.querySelector('webview')?.getAttribute('partition') ?? null })));

// --- the game in a browser (outside Electron)
{
  const { pg, errores, ctx } = await abrir(false);
  await menu(pg, `${dir}/plan.html`);
  ver(await hasta(pg, async () => !!(await lista(pg))), 'a right click on a page link opens its options');
  let l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["juego","mac","finder","copiar"]', `a page: game, default app, Finder, copy (${JSON.stringify(l?.opciones)})`);
  ver(l?.defecto === 'juego' && l?.foco === 'juego', `«Open in the game» first, marked and focused (${l?.defecto}/${l?.foco})`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${capturas}/1-pagina.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.keyboard.press('ArrowDown');
  ver((await lista(pg))?.foco === 'mac', '↓ moves to the next option');
  await pg.keyboard.press('Escape');
  ver(!(await lista(pg)), 'Esc closes it');
  ver(await pg.evaluate(() => !document.querySelector('.ventana-navegador')), 'and opens nothing');

  await menu(pg, `${dir}/plan.html`);
  await hasta(pg, async () => !!(await lista(pg)));
  await pg.keyboard.press('Enter');
  ver(await hasta(pg, async () => (await pagina(pg)).some(v => v.ruta?.includes('plan.html') || /Página|Page/.test(v.titulo ?? ''))), `Enter opens it in the game, in the «Página» window (${JSON.stringify(await pagina(pg))})`);
  ver(!(await lista(pg)), 'and the list goes');
  await pg.evaluate(() => [...document.querySelectorAll('.ventana-navegador .vn-cabeza button')].find(x => x.textContent === '×')?.click());
  await hasta(pg, async () => !(await pagina(pg)).length);

  await menu(pg, `${dir}/codigo.ts`);
  await hasta(pg, async () => !!(await lista(pg)));
  l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["mac","finder","copiar"]' && l?.defecto === 'mac', `code: editor first, no game option (${JSON.stringify(l?.opciones)})`);
  // a click elsewhere closes it
  await pg.mouse.click(200, 700);
  ver(!(await lista(pg)), 'a click elsewhere closes it');

  await menu(pg, `${dir}/falta.html`);
  await hasta(pg, async () => !!(await lista(pg)));
  l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["copiar"]' && !!l?.aviso, `a missing file: a warning and only «copy path» (${JSON.stringify(l)})`);
  await pg.screenshot({ path: `${capturas}/2-falta.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.click('.opciones-enlace [data-accion="copiar"]');
  ver(await pg.evaluate(() => navigator.clipboard.readText()) === `${dir}/falta.html`, '«Copy path» copies it');

  // outside Electron, a web can't be seen inside: the browser first
  await menu(pg, 'https://example.com/docs/page');
  await hasta(pg, async () => !!(await lista(pg)));
  l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["navegador","copiar"]', `a web outside Electron: browser, copy (${JSON.stringify(l?.opciones)})`);
  await pg.keyboard.press('Escape');
  await menu(pg, 'mailto:ana@example.com');
  await hasta(pg, async () => !!(await lista(pg)));
  ver(JSON.stringify((await lista(pg))?.opciones) === '["navegador","copiar"]', 'mail: mail app, copy address');
  await pg.click('.opciones-enlace [data-accion="copiar"]');
  ver(await pg.evaluate(() => navigator.clipboard.readText()) === 'ana@example.com', '«Copy address» copies the address');

  // a left click: the first one directly
  await pg.click(enlace(`${dir}/plan.html`));
  ver(await hasta(pg, async () => (await pagina(pg)).length === 1), 'a click opens it in the game directly');
  ver(!(await lista(pg)), 'without the list');

  // the links of that page, the same way: a right click shows the options at the pointer, a click the first one
  const marco = pg.frameLocator('.ventana-navegador iframe');
  await marco.locator('#web').waitFor({ timeout: 15000 });
  const enMarco = async (id, button) => {
    const r = await marco.locator(id).boundingBox(), x = r.x + 4, y = r.y + r.height / 2;
    await pg.mouse.click(x, y, { button });
    return { x, y };
  };
  const enPuntero = ({ x, y }) => pg.evaluate(({ x, y }) => { const r = document.querySelector('.opciones-enlace')?.getBoundingClientRect(); return !!r && Math.abs(r.left - Math.max(8, x - 12)) < 2 && (Math.abs(r.top - y - 4) < 2 || Math.abs(r.bottom - y + 4) < 2); }, { x, y });
  let p = await enMarco('#abs', 'right');
  ver(await hasta(pg, async () => !!(await lista(pg))), 'a right click on a link of a page opens its options');
  l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["mac","finder","copiar"]' && l?.titulo === `${dir}/codigo.ts`, `an absolute path: the file's options (${JSON.stringify(l)})`);
  ver(await enPuntero(p), 'at the pointer');
  await pg.keyboard.press('Escape');
  await enMarco('#web', 'right');
  await hasta(pg, async () => !!(await lista(pg)));
  ver(JSON.stringify((await lista(pg))?.opciones) === '["navegador","copiar"]', 'a web of a page: its options');
  await pg.keyboard.press('Escape');
  await enMarco('#rel', 'right');
  await hasta(pg, async () => !!(await lista(pg)));
  l = await lista(pg);
  ver(l?.titulo?.endsWith(`${dir}/punto.png`) && l?.defecto === 'juego', `a relative link: the file next to the page (${JSON.stringify(l)})`);
  await pg.keyboard.press('Escape');
  await enMarco('#ancla');
  await pg.waitForTimeout(500);
  ver(!(await lista(pg)) && (await pagina(pg)).some(v => v.ruta?.includes('plan.html')), 'an anchor of the page stays in it');
  await enMarco('#rel');
  ver(await hasta(pg, () => pg.evaluate(() => !!document.querySelector('.ventana-navegador .vn-imagen img'))), 'a click on a relative link opens it its first way (the picture, in the game)');
  ver(!(await lista(pg)), 'without the list');
  await pg.evaluate(() => [...document.querySelectorAll('.ventana-navegador .vn-cabeza button')].find(x => x.textContent === '×')?.click());
  await hasta(pg, async () => !(await pagina(pg)).length);
  await pg.click(enlace(`${dir}/falta.html`));
  ver(await hasta(pg, async () => !!(await lista(pg))?.aviso), 'a click on a missing file shows the list with its warning');
  await pg.keyboard.press('Escape');

  // a thumbnail is the picture: straight into the game
  await hasta(pg, () => pg.evaluate(() => !!document.querySelector('#qa-respuesta a.miniatura img[src]')));
  await pg.click('#qa-respuesta a.miniatura');
  ver(await hasta(pg, () => pg.evaluate(() => !!document.querySelector('.ventana-navegador .vn-imagen img'))), 'a thumbnail opens the image directly');
  ver(!(await lista(pg)), 'without the list');
  ver(errores.length === 0, `no page errors ${errores.join(' | ')}`);
  await ctx.close();
}

// --- as in Electron: a web inside
{
  const { pg, errores, ctx } = await abrir(true);
  await menu(pg, 'https://example.com/docs/page');
  await hasta(pg, async () => !!(await lista(pg)));
  let l = await lista(pg);
  ver(JSON.stringify(l?.opciones) === '["juego","navegador","copiar"]' && l?.defecto === 'juego', `a web in Electron: game first (${JSON.stringify(l?.opciones)})`);
  await pg.waitForTimeout(250);
  await pg.screenshot({ path: `${capturas}/3-web.png`, clip: { x: 900, y: 60, width: 700, height: 420 } });
  await pg.keyboard.press('Enter');
  ver(await hasta(pg, async () => (await pagina(pg)).some(v => v.web === 'https://example.com/docs/page' && v.particion === 'persist:web')), `in the «Web» window, its own session (${JSON.stringify(await pagina(pg))})`);
  await hasta(pg, () => pg.evaluate(() => getComputedStyle(document.querySelector('.ventana-navegador')).opacity === '1'));   // after its opening fade
  await pg.screenshot({ path: `${capturas}/4-ventana-web.png` });

  await menu(pg, 'https://github.com/brunolab3/my-work-shelter/pull/1');
  await hasta(pg, async () => !!(await lista(pg)));
  l = await lista(pg);
  ver(/GitHub/.test(await pg.evaluate(() => document.querySelector('.opciones-enlace .oe-defecto')?.textContent ?? '')), 'a web with its own browser names it (GitHub)');
  await pg.keyboard.press('Enter');
  ver(await hasta(pg, async () => (await pagina(pg)).some(v => /GitHub/.test(v.titulo ?? '') && v.particion === 'persist:navegador' && !v.min)), `opens in the GitHub browser (${JSON.stringify(await pagina(pg))})`);
  ver(errores.length === 0, `no page errors ${errores.join(' | ')}`);
  await ctx.close();
}
console.log(`Screenshots: ${capturas}`);
await b.close();
process.exit(failures ? 1 : 0);

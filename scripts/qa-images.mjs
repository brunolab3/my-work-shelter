// QA of the Mac's images in replies (web/src/ui/markdown.ts, server/localPages.ts): a reply that embeds or links a
// local image shows one bounded thumbnail per image, served by the game; a missing one leaves no broken picture; a click
// on the thumbnail or on the link opens the image in the «Página» window, not in Preview.
// Usage: node scripts/qa-images.mjs [url]   (with a test shelter: SHELTER_DATOS=/tmp/x npm run dev)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:5173'] = process.argv.slice(2);

// a 320×200 PNG in a temporary folder
const dir = '/tmp/qa-imagenes'; mkdirSync(dir, { recursive: true });
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const [W, H] = [320, 200]; const rows = [];
for (let y = 0; y < H; y++) { const f = Buffer.alloc(1 + W * 3); for (let x = 0; x < W; x++) f.set([x * 255 / W, y * 255 / H, 160], 1 + x * 3); rows.push(f); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr.set([8, 2, 0, 0, 0], 8);
writeFileSync(`${dir}/gradiente.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errors = []; pg.on('pageerror', e => errors.push(e.message));
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FAIL ') + text); if (!ok) failures++; };
const until = async (f, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };

await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });

// a reply as the intercom draws it (same markdown())
await pg.evaluate(async dir => {
  const { markdown } = await import('/src/ui/markdown.ts');
  const box = document.createElement('div'); box.id = 'qa-respuesta'; box.className = 'console interactivo';
  box.style.cssText = 'position:fixed;right:20px;top:80px;width:520px;z-index:999999;background:#0b0d0a;padding:12px;color:#cfe';
  box.innerHTML = `<div class="ent asistente">${markdown(`Here it is: ![the capture](${dir}/gradiente.png)\n\nAlso as a link: ${dir}/gradiente.png and [a missing one](${dir}/falta.png).\n\n\`${dir}/gradiente.png\` in code stays code.`)}</div>`;
  document.body.append(box);
}, dir);
const state = () => pg.evaluate(() => [...document.querySelectorAll('#qa-respuesta a.miniatura img')].map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth, height: i.getBoundingClientRect().height, width: i.getBoundingClientRect().width })));
check(await until(async () => (await state()).every(i => i.w > 0) && (await state()).length === 1), `one thumbnail per image, loaded (${JSON.stringify(await state())})`);
const [mini] = await state();
check(/^\/pagina\/[0-9a-f]{32}\/gradiente\.png$/.test(mini?.src ?? ''), 'served by the game with its own key');
check(mini && mini.height <= 200 && mini.width <= 400, `bounded size (${mini?.width}×${mini?.height})`);
check(await pg.evaluate(() => !document.querySelector('#qa-respuesta img:not([src])')), 'the missing image leaves no broken picture');
check(await pg.evaluate(() => !!document.querySelector('#qa-respuesta code') && !document.querySelector('#qa-respuesta code a')), 'a path in code gets no link nor thumbnail');
await pg.locator('#qa-respuesta').screenshot({ timeout: 120000, path: `${dir}/respuesta.png` });

// a click on the thumbnail: the «Página» window, with the image drawn by the game
await pg.click('#qa-respuesta a.miniatura');
const inWindow = () => pg.evaluate(() => { const i = document.querySelector('.ventana-navegador .vn-imagen img'); return i ? { w: i.naturalWidth, src: i.getAttribute('src') } : null; });
check(await until(async () => (await inWindow())?.w === 320), `the thumbnail opens it in the «Página» window (${JSON.stringify(await inWindow())})`);
check(await pg.evaluate(() => !document.querySelector('.ventana-navegador iframe.vn-pagina')), 'drawn as an image, not in an iframe');
check(await pg.evaluate(() => !document.querySelector('.ventana-navegador').classList.contains('minimizada')), `the window is in view (${await pg.evaluate(() => document.querySelector('.ventana-navegador').className)})`);
await until(async () => pg.evaluate(() => getComputedStyle(document.querySelector('.ventana-navegador')).opacity === '1'));   // after its opening fade
await pg.screenshot({ timeout: 120000, path: `${dir}/ventana.png` });
await pg.click('.ventana-navegador .vn-imagen');
check(await pg.evaluate(() => document.querySelector('.ventana-navegador .vn-imagen')?.classList.contains('real')), 'a click shows it at its own size');

// the link (not the thumbnail) also opens it inside
await pg.evaluate(() => [...document.querySelectorAll('.ventana-navegador .vn-cabeza button')].find(x => x.textContent === '×').click());
check(await until(async () => pg.evaluate(() => !document.querySelector('.ventana-navegador'))), 'the window closes');
await pg.click(`#qa-respuesta a[data-local="${dir}/gradiente.png"]:not(.miniatura)`);
check(await until(async () => (await inWindow())?.w === 320), 'the link opens it in the «Página» window too');
check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(`Screenshots: ${dir}/respuesta.png ${dir}/ventana.png`);
await b.close();
process.exit(failures ? 1 : 0);

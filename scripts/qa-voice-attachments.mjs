// QA de adjuntos y dictado en el intercomunicador, con teclado real (Playwright), un micrófono falso que «dice» una
// frase (Chromium la lee de un WAV hecho con `say`) y una sesión real de Claude Code (Haiku, dos turnos cortos):
// - pegar una captura y soltar un archivo los dejan en la bandeja (con miniatura) y suben al refugio;
// - al empezar el trabajo, la imagen le llega al habitante (dice de qué color es) y el cuaderno la enseña;
// - ⌘D empieza a dictar; Espacio termina (también ⌘D otra vez); Esc descarta lo dictado;
//   Enter mientras se dicta termina y envía.
// Uso: node scripts/qa-voice-attachments.mjs [url] [carpeta-capturas]   (servidor en marcha; SHELTER_DATOS para el token;
// mejor con un refugio de pruebas: SHELTER_DATOS=/tmp/x SHELTER_PUERTO=3791 npx tsx server/main.ts)
// Ojo: lanza sesiones reales de Claude Code (gastan de tu plan) y puede aprobar permisos: úsalo contra un refugio de
// pruebas (arranca el juego con SHELTER_DATOS=/ruta/temporal), nunca contra el tuyo.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';
const [url0 = 'http://127.0.0.1:3778', dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });

// la voz del micrófono falso: la frase, y silencio detrás (Chromium repite el archivo en bucle)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-qa-adj-'));
const PHRASE = 'Revisa el intercomunicador y dime por qué el botón de enviar se ve cortado.';
execFileSync('/usr/bin/say', ['-v', 'Mónica', '-o', path.join(tmp, 'f.aiff'), PHRASE + ' [[slnc 6000]]']);
execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', path.join(tmp, 'f.aiff'), path.join(tmp, 'f.wav')]);
// una captura «grande» toda roja (3000×2000: el servidor la reduce antes de mandarla)
const png = (w, h, [r, g, b]) => {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  const data = deflateSync(Buffer.concat(Array.from({ length: h }, () => row)));
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])) >>> 0); return Buffer.concat([l, Buffer.from(t), d, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
};
const crc = b => { let c, t = crc.t ??= Array.from({ length: 256 }, (_, n) => { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const RED = png(3000, 2000, [220, 20, 30]).toString('base64');

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(tmp, 'f.wav')}`] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.goto(withToken(url0), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const until = async (f, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await wait(250); } return false; };
const options = () => pg.evaluate(() => [...document.querySelectorAll('.consola .opciones-consola li')].map(l => l.textContent.replace('▶', '').trim()));
const chooseMenu = async text => { const i = (await options()).findIndex(o => o.startsWith(text)); for (let k = 0; k < i; k++) await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await wait(400); };
const value = () => pg.$eval('.consola textarea', t => t.value);
const trayAttachments = () => pg.evaluate(() => [...document.querySelectorAll('.consola .bandeja-adjuntos:not(.enviados) .adjunto')].map(a => ({ kind: a.className, img: !!a.querySelector('img'), name: a.querySelector('.nombre-adjunto')?.textContent })));
const paste = (b64, name, type) => pg.evaluate(([b64, name, type]) => {
  const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: type });
  const dt = new DataTransfer(); dt.items.add(f);
  document.querySelector('.consola textarea').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [b64, name, type]);
const drop = (text, name) => pg.evaluate(([text, name]) => {
  const dt = new DataTransfer(); dt.items.add(new File([text], name, { type: 'text/plain' }));
  const z = document.querySelector('.consola .pantalla-consola');
  z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [text, name]);
const norm = s => s.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const similar = t => { const p = norm(PHRASE).split(' '), d = new Set(norm(t).split(' ')); return p.filter(x => d.has(x)).length / p.length; };

// el de Planificación: trabaja en una carpeta propia del refugio (no toca ningún repo)
const h = await pg.evaluate(() => window.__game.get().dwellers.find(h => h.room === 'planificacion'));
console.log('Habitante:', h.name, '·', h.nameRoom);
await pg.evaluate(h => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: h.room, dwellerId: h.id, talk: true } })), h);
await pg.waitForSelector('.consola .opciones-consola').catch(async e => { await pg.screenshot({ path: path.join(dir, 'adjuntos-sin-consola.png') }); throw e; });
await chooseMenu('Empezar');

// ---- adjuntos en el trabajo nuevo
check(await pg.isVisible('.consola .botones-entrada .microfono') && await pg.isVisible('.consola .botones-entrada .boton-entrada'), 'el trabajo nuevo tiene 📎 y 🎙');
await paste(RED, 'image.png', 'image/png');
await drop('notas de prueba del QA', 'notas.txt');
check(await until(async () => { const l = await trayAttachments(); return l.length === 2 && l.every(a => !a.kind.includes('subiendo')); }, 15000), 'pegar una captura y soltar un archivo los dejan en la bandeja, subidos');
const l0 = await trayAttachments();
check(l0[0]?.img && /^captura-\d{6}\.png$/.test(l0[0]?.name ?? ''), `la captura pegada lleva miniatura y nombre de captura (${l0[0]?.name})`);
check(l0[1]?.name === 'notas.txt' && !l0[1]?.img, 'el archivo soltado, con su nombre');
await pg.screenshot({ path: path.join(dir, 'adjuntos-bandeja.png') });
// quitar uno
await pg.click('.consola .bandeja-adjuntos .adjunto:nth-child(2) button');
check((await trayAttachments()).length === 1, '× lo quita de la bandeja');

// ---- dictado: ⌘D empieza y Espacio termina
await pg.focus('.consola textarea');
await pg.keyboard.type('Primero: ', { delay: 2 });
await pg.keyboard.press('Meta+d');
check(await until(() => pg.isVisible('.consola .tira-dictado.escuchando'), 4000), '⌘D empieza a escuchar (tira y micrófono encendidos)');
check(await until(async () => (await value()).length > 'Primero: '.length + 10, 8000), 'lo dicho va apareciendo mientras se habla');
await pg.screenshot({ path: path.join(dir, 'dictado-escuchando.png') });
await wait(3000);
await pg.keyboard.press('Space');
check(await until(() => pg.evaluate(() => !document.querySelector('.consola .tira-dictado')), 8000), 'Espacio termina (sin escribir un espacio)');
const v1 = await value();
console.log('   →', JSON.stringify(v1));
check(v1.startsWith('Primero: ') && similar(v1) > 0.8, 'el texto dictado queda detrás de lo escrito, bien transcrito');
// Esc descarta lo dictado (y deja lo que había)
await pg.keyboard.press('Meta+d');
await until(async () => (await value()).length > v1.length + 5, 8000);
await pg.keyboard.press('Escape');
check(await until(async () => (await value()) === v1, 3000) && await pg.isVisible('.consola .formulario'), 'Esc mientras se dicta lo descarta (sin salir del formulario)');

// ---- empezar con la imagen: Haiku dice de qué color es
await pg.fill('.consola textarea', 'Mira la imagen adjunta. Responde solo con una palabra en español: su color dominante.');
await pg.keyboard.press('Tab'); await pg.keyboard.press('ArrowLeft');   // modelo: Haiku (el último)
await pg.keyboard.press('Enter');
check(await until(() => pg.isVisible('.consola .sesion'), 15000), 'el trabajo arranca y la pestaña pasa a la conversación');
check(await until(() => pg.isVisible('.consola .ent.usuario .bandeja-adjuntos.enviados .adjunto img'), 15000), 'el cuaderno enseña la imagen enviada');
const sid = await pg.evaluate(id => Object.values(window.__live.get().sessions).find(s => s.dwellerId === id && s.state !== 'cerrada')?.id, h.id);
check(await until(() => pg.evaluate(id => ['terminada', 'ociosa', 'error'].includes(window.__live.get().sessions[id]?.state), sid), 90000), 'el habitante responde');
const answer = await pg.evaluate(id => window.__live.get().sessions[id]?.lastText ?? '', sid);
console.log('   →', JSON.stringify(answer));
check(/roj/i.test(answer), 'ha visto la imagen (dice que es roja)');
check((await trayAttachments()).length === 0, 'la bandeja queda vacía al enviar');
await pg.screenshot({ path: path.join(dir, 'adjuntos-cuaderno.png') });

// ---- en la conversación: ⌘D otra vez también termina
await pg.focus('.consola textarea');
await pg.keyboard.press('Meta+d');
await wait(5500);
await pg.keyboard.press('Meta+d');
check(await until(() => pg.evaluate(() => !document.querySelector('.consola .tira-dictado')), 8000), '⌘D otra vez termina');
const v2 = await value();
console.log('   →', JSON.stringify(v2));
check(similar(v2) > 0.8, 'bien transcrito');
// Enter mientras se dicta: termina y envía
await pg.fill('.consola textarea', '');
const before = await pg.evaluate(id => window.__live.get().entries[id]?.filter(e => e.type === 'usuario').length ?? 0, sid);
await pg.keyboard.press('Meta+d');
await until(async () => (await value()).length > 20, 8000);
await pg.keyboard.press('Enter');
check(await until(() => pg.evaluate(([id, n]) => (window.__live.get().entries[id]?.filter(e => e.type === 'usuario').length ?? 0) > n, [sid, before]), 10000), 'Enter mientras se dicta termina y lo envía');
check((await value()) === '', 'y la caja queda vacía');
await wait(500);
await pg.keyboard.press('Control+c');

check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
await b.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTodo OK');
process.exit(failures ? 1 : 0);

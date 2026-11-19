// QA de la discoteca en la ventana real (Electron, por CDP): la sala en la planta de ocio a la izquierda del
// ascensor (cultivos, discoteca, ascensor, galería de tiro); la cabina abre Spotify, que suena en su Chrome sin ventana
// (electron/remoteChrome.cjs) con el mando de la pletina (window.__refugioMusica); con lo que la página le cuenta al sistema (Media
// Session, fingido aquí para no depender de una cuenta) la pletina aparece al minimizar Spotify, abajo a la izquierda
// encima de la barra: compacta y, con el ratón encima o con ⌘J, desplegada; sus mandos (ratón y teclado) llegan a la
// página, la barra de progreso salta con clic y arrastre (también sin «seekto», con la barra de Spotify), Intro vuelve a
// Spotify y, al cerrarlo, desaparece.
// Uso: node scripts/qa-disco.mjs [puerto-cdp=9345] [carpeta=_capturas/discoteca]
//   (Electron abierto con SHELTER_CDP=<puerto>; para no tocar tus datos ni tus logins: SHELTER_DATOS, SHELTER_PUERTO
//    y --user-data-dir=/ruta/temporal al lanzar Electron)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [port = '9345', dir = '_capturas/discoteca'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pg = b.contexts()[0].pages().find(p => !p.url().startsWith('devtools')) ?? b.contexts()[0].pages()[0];
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => { await window.__ready(); window.__game.set({ panel: null, panelData: null }); window.__browsers.browsers.set({ list: [] }); });
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const photo = async n => { await pg.screenshot({ path: `${dir}/${n}.png` }); console.log('->', `${dir}/${n}.png`); };
const inWeb = js => pg.evaluate(js => window.shelterRemoto.orden('evaluar', js), js);
const spotify = () => pg.evaluate(() => window.__browsers.browsers.get().list.find(v => v.id === 'spotify'));

// el sitio: última planta, a la izquierda del ascensor, entre los cultivos y él
const spot = await pg.evaluate(() => {
  const ss = window.__shelter.rooms, max = Math.max(...ss.map(s => s.floor));
  const from = id => ss.find(s => s.id === id);
  return { max, disco: from('discoteca') && { floor: from('discoteca').floor, x: from('discoteca').group.position.x }, cultivos: from('hidroponia')?.group.position.x, galeria: from('galeria')?.group.position.x, pb: ss.filter(s => s.floor === 0).map(s => s.id) };
});
check(spot.disco?.floor === spot.max, `la discoteca está en la última planta (${spot.disco?.floor} de ${spot.max})`);
check(spot.cultivos < spot.disco?.x && spot.disco?.x < 0 && spot.galeria > 0, 'de izquierda a derecha: cultivos, discoteca, ascensor, galería de tiro');
check(!spot.pb.includes('discoteca'), `ya no está a pie de calle (PB: ${spot.pb.join(', ')})`);
await pg.evaluate(() => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: 'discoteca' } })));
await wait(3000); await photo('sala');

// la cabina abre Spotify, dentro
await pg.evaluate(() => window.__game.set({ panel: 'spotify', panelData: null }));
await pg.waitForSelector('.ventana-navegador .vn-lienzo', { state: 'attached', timeout: 15000 });
await pg.waitForFunction(() => window.__browsers.browsers.get().list.find(v => v.id === 'spotify')?.loading === false, null, { timeout: 40000 }).catch(() => {});
await wait(2500);
check(/^https:\/\/open\.spotify\.com\//.test((await spotify())?.url ?? ''), `Spotify se abre dentro del juego (${(await spotify())?.url})`);
check(!/Electron\//.test(await inWeb('navigator.userAgent')), 'Spotify ve un Chrome (con «Electron» solo enseña «abre la app»)');
const drm = await inWeb(`navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' }] }]).then(k => k.keySystem, e => 'no: ' + e.message)`);
check(drm === 'com.widevine.alpha', `Widevine disponible en el navegador de Spotify (${drm})`);
check(await inWeb('typeof window.__refugioMusica?.estado === "function"'), 'el mando de la pletina está en la página de Spotify (en su Chrome)');
await photo('spotify');

// lo que Spotify le cuenta al sistema al sonar, fingido (sin cuenta no suena nada)
await inWeb(`(() => {
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({ title: 'Weightless (Pt. 1) — una versión larguísima para probar la marquesina', artist: 'Marconi Union', album: 'Weightless', artwork: [{ src: 'https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228', sizes: '300x300' }, { src: 'https://i.scdn.co/image/ab67616d0000b273ff9ca10b55ce82ae553c8228', sizes: '640x640' }] });
  ms.playbackState = 'playing';
  window.__qa = [];
  for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) ms.setActionHandler(a, d => { window.__qa.push(a + (d.seekTime != null ? ':' + Math.round(d.seekTime) : '')); if (a === 'play' || a === 'pause') ms.playbackState = a === 'play' ? 'playing' : 'paused'; });
  ms.setPositionState({ duration: 480, position: 83, playbackRate: 1 });
})()`);
await wait(1500);
check(await pg.$('.pletina') === null, 'con Spotify a la vista no hay pletina (están sus mandos)');
await pg.click('.ventana-navegador .vt-cabeza button[title^="Minimizar"]');
await pg.waitForSelector('.pletina', { timeout: 5000 }).catch(() => {});
await wait(1200);
const m = await pg.evaluate(() => window.__live.get().music);
check(m?.state === 'sonando' && m?.hint?.artist === 'Marconi Union' && m?.hint?.duration === 480, `la pletina lee lo que suena (${m?.state} · ${m?.hint?.title?.slice(0, 20)}… · ${m?.hint?.duration}s)`);
check(m?.hint?.cover?.includes('ab67616d0000b273'), 'coge la carátula más grande');
check(await pg.$eval('.pletina-titulo', e => e.textContent.startsWith('Weightless')).catch(() => false), 'al minimizar Spotify aparece la pletina con el tema');
const webLive = await inWeb('location.href').catch(() => null);
check(!!webLive, 'Spotify sigue cargado minimizado (la música no se corta)');
const box = sel => pg.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; }).catch(() => null);
const pl = await box('.pletina'), bar = await box('.barra-ventanas');
check(!!pl && !!bar && pl.x < 60 && pl.b <= bar.y + 1 && Math.abs(pl.x - bar.x) < 2, `a la izquierda, encima de la barra de ventanas (pletina x=${Math.round(pl?.x)} abajo=${Math.round(pl?.b)}; barra x=${Math.round(bar?.x)} arriba=${Math.round(bar?.y)})`);
check(await pg.$('.pletina.compacta') !== null && await pg.$('.pletina .musica-boton') === null, 'compacta: solo disco, tema y artista, sin mandos');
await photo('pletina-compacta');
// con el ratón encima, desplegada; al irse, compacta otra vez
await pg.mouse.move(pl.x + pl.w / 2, pl.y + pl.h / 2); await wait(400);
check(await pg.$('.pletina.abierta .musica-boton') !== null, 'con el ratón encima se despliega con los mandos');
await photo('pletina');
await pg.click('.pletina .musica-boton[title="Tema siguiente"]');
await pg.click('.pletina .musica-boton[title="Pausa"]');
await wait(600);
// arrastre en la barra de progreso: de un cuarto a tres cuartos
let r = await box('.pletina .musica-barra');
await pg.mouse.move(r.x + r.w * 0.25, r.y + r.h / 2); await pg.mouse.down(); await pg.mouse.move(r.x + r.w * 0.5, r.y + r.h / 2, { steps: 4 }); await pg.mouse.move(r.x + r.w * 0.75, r.y + r.h / 2, { steps: 4 }); await pg.mouse.up();
await wait(1200);
const done = await inWeb('window.__qa');
check(done?.length === 3 && done[0] === 'nexttrack' && done[1] === 'pause' && Math.abs(+done[2].split(':')[1] - 360) <= 8, `los mandos llegan a Spotify: siguiente, pausa y saltar arrastrando a los tres cuartos (${JSON.stringify(done)})`);
check((await pg.evaluate(() => window.__live.get().music?.state)) === 'pausa', 'tras la pausa, la pletina dice PAUSA');
// como Spotify de verdad: sin «seekto» en la Media Session, se salta con su barra de progreso (en milisegundos)
await inWeb(`(() => { navigator.mediaSession.setActionHandler('seekto', null);
  const d = document.createElement('div'); d.setAttribute('data-testid', 'playback-progressbar');
  const i = document.createElement('input'); i.type = 'range'; i.min = 0; i.max = 480000; i.step = 5000; d.appendChild(i); document.body.prepend(d);
  i.addEventListener('change', () => window.__qa.push('barra:' + Math.round(i.value / 1000)));
  const dv = document.createElement('div'); dv.setAttribute('data-testid', 'volume-bar');
  const v = document.createElement('input'); v.type = 'range'; v.min = 0; v.max = 1; v.step = 0.01; v.value = 0.8; dv.appendChild(v); document.body.prepend(dv); })()`);
await wait(1500);
r = await box('.pletina .musica-barra');
await pg.mouse.click(r.x + r.w * 0.5, r.y + r.h / 2); await wait(1000);
check((await inWeb('window.__qa'))?.at(-1)?.startsWith('barra:24'), `sin «seekto», salta con la barra de progreso de Spotify (${JSON.stringify((await inWeb('window.__qa'))?.at(-1))})`);
await pg.mouse.move(900, 300); await wait(800);
check(await pg.$('.pletina.compacta') !== null, 'al quitar el ratón vuelve a compacta');
// ⌘J: la pletina en mano, con el teclado
await inWeb('window.__qa = []');
await pg.keyboard.press('Meta+KeyJ'); await wait(300);
check(await pg.$('.pletina.abierta.en-mano .pletina-ayuda') !== null, '⌘J despliega la pletina en mano, con su ayuda');
await photo('pletina-en-mano');
await pg.keyboard.press('Space'); await pg.keyboard.press('Shift+ArrowRight');
const posBefore = await pg.evaluate(() => { const m = window.__live.get().music; return m.position + (m.state === 'sonando' ? (Date.now() - m.measured) / 1000 : 0); });
await pg.keyboard.press('ArrowLeft');
const vol0 = (await pg.evaluate(() => window.__live.get().music?.volume)); await pg.keyboard.press('ArrowDown');
await wait(800);
const keys = await inWeb('window.__qa');
const behind = +(keys?.[2] ?? '').split(':')[1];
check(keys?.[0] === 'play' && keys?.[1] === 'nexttrack' && Math.abs(behind - (posBefore - 10)) <= 5, `Espacio, ⇧→ y ← (10 s atrás desde ${Math.round(posBefore)} s) llegan a Spotify (${JSON.stringify(keys)})`);
check((await pg.evaluate(() => window.__live.get().music?.volume)) === Math.max(0, vol0 - 10), `↓ baja el volumen (${vol0} → ${await pg.evaluate(() => window.__live.get().music?.volume)})`);
check((await pg.evaluate(() => window.__game.get().panel)) === null && (await pg.evaluate(() => window.__game.get().currentRoom)) === 'discoteca', 'las teclas no mueven el refugio');
await pg.keyboard.press('Enter'); await wait(800);
check((await spotify())?.minimized === false && !(await pg.$('.pletina')), 'Intro abre Spotify entero');
await pg.keyboard.press('Meta+KeyJ'); await wait(600);
check((await spotify())?.minimized === true && await pg.$('.pletina.en-mano') !== null, '⌘J con Spotify delante lo minimiza y deja la pletina en mano');
await pg.keyboard.press('Escape'); await wait(400);
check(await pg.$('.pletina.compacta') !== null && await pg.$('.pletina.en-mano') === null, 'Esc la suelta (compacta otra vez)');
await pg.mouse.move(900, 300); await wait(500);
await pg.click('.pletina .pista-atajo'); await wait(400);
check(await pg.$('.pletina.en-mano') !== null && await pg.$('.pletina .pista-atajo') === null, 'su tecla ⌘J (a la derecha) hace lo mismo que el atajo y se oculta mientras está en mano');
await pg.keyboard.press('Escape'); await pg.mouse.move(900, 300); await wait(500);
// desde otra sala, encima de todo
await pg.evaluate(() => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: 'git' } })));
await wait(2500); await photo('pletina-otra-sala');
await pg.click('.pletina-disco'); await wait(800);
check((await spotify())?.minimized === false && !(await pg.$('.pletina')), 'el disco de la pletina trae Spotify delante y la pletina se aparta');
await pg.click('.ventana-navegador .vt-cabeza button[title^="Cerrar el navegador"]'); await wait(1500);
check(!(await pg.$('.pletina')) && (await pg.evaluate(() => window.__live.get().music)) === null, 'al cerrar Spotify, se acaba la música y la pletina');
for (const e of errors) console.log('ERROR de página:', e);
console.log(failures ? `${failures} fallos` : 'todo bien');
await b.close();
process.exit(failures ? 1 : 0);

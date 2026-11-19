// QA de Spotify en Google Chrome sin ventana (electron/remoteChrome.cjs), de punta a punta: juego real (cliente
// compilado) con su precarga real (electron/preload.cjs), el bloque de Spotify real de electron/main.cjs y entrada
// nativa (sendInputEvent) sobre la ventana del juego. Sin cuenta: Spotify sin sesión (no reproduce nada).
//   1. abrir Spotify en el juego: arranca Chrome sin ventana con su perfil, llega imagen al lienzo y el título a la ventana
//   2. la primera vez hereda las cookies de Spotify de los navegadores del refugio
//   3. se presenta como Chrome (sin «HeadlessChrome»), tiene Widevine y el mando de la música (window.__refugioMusica)
//   4. ratón y teclado: clic en el buscador y escribir (con ñ y tildes) llega a la página; la rueda la desplaza
//   5. un enlace de fuera va al navegador del sistema y la página se queda en Spotify
//   6. minimizado no llega imagen; al volver, sí
//   7. cerrar la ventana cierra Chrome; al volver a abrir, el perfil conserva lo suyo
//   8. iniciar sesión («Iniciar sesión» y «Continuar con Google») abre Google Chrome visible (perfil temporal) en ese paso;
//      al cerrar su ventana se cancela, se borra su perfil y Spotify sigue como estaba (abre un momento ventanas de Chrome)
// Uso (servidor de prueba en marcha con SHELTER_DATOS y SHELTER_PUERTO temporales; LAB_DATOS, una carpeta vacía):
//   LAB_LOG=/tmp/x.log LAB_DATOS=/tmp/datos-electron LAB_URL="http://127.0.0.1:<puerto>/#t=<token>" \
//     node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/qa-spotify-chrome.cjs
const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ELECTRON = path.join(__dirname, '..', 'electron');
const source = fs.readFileSync(path.join(ELECTRON, 'main.cjs'), 'utf8');
const block = source.slice(source.indexOf('// --- Spotify (la discoteca)'), source.indexOf('// --- Abierta como aplicación'));
const LOG = process.env.LAB_LOG;
const out = (...a) => fs.appendFileSync(LOG, a.join(' ') + '\n');
let failures = 0;
const check = (ok, text) => { out((ok ? 'OK    ' : 'FALLO ') + text); if (!ok) failures++; };
const outside = [];
app.setName('work-shelter-public'); app.setPath('userData', process.env.LAB_DATA);
const PARTITION = 'persist:navegador';
const sp = new Function('app', 'session', 'shell', 'ipcMain', 'path', 'require', '__dirname', 'PARTICION',
  'let ventana;\n' + block + '\nreturn { fijar: v => { ventana = v; }, get spotify() { return spotify; } };')(
  app, session, { openExternal: u => { outside.push(u); out('      FUERA', u); } }, !process.env.LAB_DEP ? ipcMain : {
    // LAB_DEP: cada orden del juego y cuánto tarda en volver
    handle: (channel, f) => ipcMain.handle(channel, async (e, ...a) => { const t = Date.now(); const id = Math.random().toString(36).slice(2, 6); if (a[0] !== 'entrada') console.log('orden', id, a[0], JSON.stringify(a.slice(1)).slice(0, 80)); try { return await f(e, ...a); } finally { if (a[0] !== 'entrada') console.log('vuelve', id, a[0], Date.now() - t, 'ms'); } }),
  }, path, require, ELECTRON, PARTITION);
const wait = ms => new Promise(r => setTimeout(r, ms));
process.on('uncaughtException', e => { out('ERROR', e.stack); app.exit(2); });
setTimeout(() => { out('ERROR más de 4 minutos'); try { sp.spotify?.close(); } catch {} app.exit(2); }, 240_000);
const profile = () => path.join(process.env.LAB_DATA, 'chrome-spotify');
const chromeLive = () => { try { execFileSync('/usr/bin/pgrep', ['-f', `user-data-dir=${profile()}`]); return true; } catch { return false; } };

app.whenReady().then(async () => {
  // una cookie de Spotify en los navegadores del refugio, para ver que Chrome la hereda
  const sess = session.fromPartition(PARTITION);
  await sess.cookies.set({ url: 'https://open.spotify.com/', name: 'qa_refugio', value: 'heredada', domain: '.spotify.com', path: '/', secure: true, expirationDate: Date.now() / 1000 + 3600 });
  const w = new BrowserWindow({ width: 1600, height: 1000, x: 30, y: 30, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, webviewTag: true, preload: path.join(ELECTRON, 'preload.cjs') } });
  sp.pin(w);
  await w.loadURL(process.env.LAB_URL); w.showInactive();
  const host = s => w.webContents.executeJavaScript(s).catch(e => 'ERR ' + e.message);
  for (let i = 0; i < 120 && (await host('typeof window.__ready')) !== 'function'; i++) await wait(500);
  await host('window.__ready()');
  await host(`window.__fotos = 0; window.shelterRemoto.alFotograma(() => { window.__fotos++; })`);
  const until = async (cond, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await cond()) return true; await wait(250); } return false; };
  const remote = s => host(`window.shelterRemoto.orden('evaluar', ${JSON.stringify(s)})`);
  const list = () => host(`JSON.stringify(window.__navegadores.navegadores.get().lista)`).then(JSON.parse);

  // 1
  await host(`window.__navegadores.abrirNavegador('spotify')`);
  await until(async () => (await host('window.__fotos')) > 3, 30000);
  check(chromeLive(), '1 Chrome sin ventana en marcha con su perfil');
  check((await host('window.__fotos')) > 3, `1 llega imagen (${await host('window.__fotos')} fotogramas)`);
  const canvas = await host(`(()=>{const c=document.querySelector('.vn-lienzo'); const r=c.getBoundingClientRect(); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let distintos=new Set(); for(let i=0;i<d.length;i+=4000) distintos.add(d[i]+','+d[i+1]+','+d[i+2]); return {w:c.width,h:c.height,cssW:r.width,cssH:r.height,x:r.left,y:r.top,colores:distintos.size}})()`);
  out('      lienzo:', JSON.stringify(canvas));
  check(canvas.w > 0 && canvas.colors > 5, '1 el lienzo enseña la página (no está en blanco)');
  check(Math.abs(canvas.w / (await host('devicePixelRatio')) - canvas.cssW) < 3, `1 la página va a la medida de la ventana (${canvas.w} px de imagen para ${Math.round(canvas.cssW)} px CSS)`);
  await until(async () => /Spotify/.test((await list()).find(v => v.id === 'spotify')?.title || ''), 15000);
  check(/Spotify/.test((await list()).find(v => v.id === 'spotify')?.title || ''), `1 el título llega a la ventana («${(await list()).find(v => v.id === 'spotify')?.title}»)`);
  await until(async () => /open\.spotify\.com/.test(String(await remote('location.href'))));

  // 2
  check(/qa_refugio=heredada/.test(String(await remote('document.cookie'))), '2 hereda las cookies de Spotify de los navegadores del refugio');

  // 3
  const ua = String(await remote('navigator.userAgent'));
  check(/Chrome\//.test(ua) && !/Headless/.test(ua), `3 se presenta como Chrome (${ua})`);
  check(/Google Chrome/.test(String(await remote('JSON.stringify(navigator.userAgentData.brands)'))), '3 y en sus pistas (userAgentData), como Google Chrome');
  check(String(await remote(`navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'}]}]).then(a=>a.keySystem,e=>'no '+e.message)`)) === 'com.widevine.alpha', '3 tiene Widevine');
  check((await remote('typeof window.__refugioMusica')) === 'object', '3 tiene el mando de la música (window.__refugioMusica)');
  check(await host(`(async () => { const r = await window.__navegadores.navegadores.get(); return true })()`), '3 (la pletina pregunta por el mismo camino)');

  // 4: clic en el buscador y escribir, con entrada nativa sobre la ventana del juego
  const search = await remote(`(()=>{const e=document.querySelector('input[data-testid="search-input"]')||document.querySelector('form[role="search"] input')||document.querySelector('input[type="search"]'); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  out('      buscador en la página:', JSON.stringify(search));
  const clickIn = async (x, y) => { x = Math.round(canvas.x + x); y = Math.round(canvas.y + y); w.webContents.sendInputEvent({ type: 'mouseMove', x, y }); await wait(100); w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); await wait(80); w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); };
  if (search) await clickIn(search.x, search.y);
  await wait(800);
  check((await host(`document.activeElement && document.activeElement.className`)) === 'vn-teclas', '4 el clic deja el teclado en Spotify');
  check(/^INPUT$/.test(String(await remote('document.activeElement && document.activeElement.tagName'))), '4 y en la página el foco está en el buscador');
  // «can» con pulsaciones de verdad (keyDown + carácter + keyUp); «ción ñu», como caracteres sueltos (dictado, métodos de entrada)
  for (const ch of 'can') { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); w.webContents.sendInputEvent({ type: 'char', keyCode: ch }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); await wait(60); }
  for (const ch of 'ción ñu') { w.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(60); }
  await wait(800);
  const searchField = `(document.querySelector('input[data-testid="search-input"]') || document.activeElement)`;
  const value = await remote(`${searchField}.value`);
  check(value === 'canción ñu', `4 escribir llega a la página, con tildes y ñ («${value}»)`);
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  await wait(500);
  check((await remote(`${searchField}.value`)) === 'canción ñ', '4 las teclas especiales (borrar) también');
  check((await host(`document.querySelectorAll('.menu-pausa, .menu-principal').length`)) === 0, '4 las teclas no se las queda el juego');
  // rueda: llega a la página con su sentido (desplazar ya es cosa de Chrome)
  await remote(`window.__ruedas = []; addEventListener('wheel', e => window.__ruedas.push(Math.sign(e.deltaY)), { capture: true, passive: true })`);
  await host(`window.__ruedasJuego = []; document.querySelector('.vn-lienzo').addEventListener('wheel', e => window.__ruedasJuego.push(Math.sign(e.deltaY)))`);
  for (let i = 0; i < 4; i++) { w.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(canvas.x + canvas.cssW / 2), y: Math.round(canvas.y + 200), deltaX: 0, deltaY: -120, canScroll: true }); await wait(120); }
  await wait(600);
  const inPage = await remote('JSON.stringify(window.__ruedas)'), inGame = await host('JSON.stringify(window.__ruedasJuego)');
  check(JSON.parse(inPage || '[]').length >= 4 && inPage === inGame, `4 la rueda llega a la página, en el mismo sentido (juego ${inGame} → página ${inPage})`);

  // 4b: retraso de punta a punta (juego → Chrome → imagen en el juego) de un clic justo después de mover el ratón: los
  // movimientos no se encolan (antes, un clic tras mover el ratón tardaba ~1 s)
  await remote(`window.__clicT = 0; addEventListener('mousedown', () => { window.__clicT = Date.now(); document.documentElement.style.outline = document.documentElement.style.outline ? '' : '6px solid #f0f'; }, true)`);
  await host(`window.__fotosT = []; window.shelterRemoto.alFotograma(() => window.__fotosT.push(Date.now()))`);
  const delays = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 60; i++) { w.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(canvas.x + 300 + i * 6), y: Math.round(canvas.y + 300 + (i % 7) * 5) }); await wait(8); }
    const t0 = Date.now();
    const x = Math.round(canvas.x + 700), y = Math.round(canvas.y + 400);
    w.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); w.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    let tc = 0; await until(async () => (tc = await remote('window.__clicT')) >= t0, 3000);
    let tf = 0; await until(async () => (tf = await host(`(window.__fotosT.find(t => t >= ${tc}) || 0)`)) > 0, 3000);
    delays.push([tc - t0, tf - t0]);
    await wait(400);
  }
  check(delays.every(([a, b]) => a >= 0 && b > 0 && b < 250), `4 un clic justo después de mover el ratón se ve en el juego en menos de 250 ms (llega a la página / se ve, en ms: ${delays.map(r => r.join('/')).join('  ')})`);

  // 5
  await remote(`location.href = 'https://example.com/'`);
  await wait(2500);
  check(outside.some(u => /example\.com/.test(u)), '5 un enlace de fuera va al navegador del sistema');
  check(/open\.spotify\.com/.test(String(await remote('location.href'))), '5 y la página se queda en Spotify');

  // 6
  await host(`window.__navegadores.navegadores.set(e => ({ lista: e.lista.map(v => v.id === 'spotify' ? { ...v, minimizada: true } : v) }))`);
  await wait(1500); await host('window.__fotos = 0');
  await remote(`document.body.style.outline = '3px solid red'`);   // un cambio que, a la vista, daría imagen
  await wait(2000);
  const minimized = await host('window.__fotos');
  check(minimized === 0, `6 minimizado no llega imagen (${minimized})`);
  check(chromeLive(), '6 y Chrome sigue (la música no se corta)');
  await host(`window.__navegadores.navegadores.set(e => ({ lista: e.lista.map(v => v.id === 'spotify' ? { ...v, minimizada: false } : v) }))`);
  await until(async () => (await host('window.__fotos')) > 0, 5000);
  check((await host('window.__fotos')) > 0, '6 al volver, llega imagen');

  // 7
  await sess.cookies.remove('https://open.spotify.com/', 'qa_refugio');
  await host(`document.querySelector('.ventana-navegador .botones-ventana button:last-child').click()`);
  await until(async () => !chromeLive(), 8000);
  check(!chromeLive(), '7 cerrar la ventana cierra Chrome');
  await host(`window.__navegadores.abrirNavegador('spotify')`);
  await until(async () => /open\.spotify\.com/.test(String(await remote('location.href'))), 30000);
  check(chromeLive() && /qa_refugio=heredada/.test(String(await remote('document.cookie'))), '7 al volver a abrir, el perfil conserva su sesión (ya no la hereda: la tiene)');

  // 8: iniciar sesión, en Chrome visible (la prueba cierra su ventana como lo haría el Supervisor)
  const os = require('node:os');
  const logins = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('work-shelter-login-')).map(n => path.join(os.tmpdir(), n));
  for (const p of logins()) fs.rmSync(p, { recursive: true, force: true });
  const tryLogin = async (name, urlRemote, expected) => {
    await remote(`location.href = ${JSON.stringify(urlRemote)}`);
    await until(async () => logins().length > 0, 15000);
    const login = logins()[0];
    check(!!login, `8 ${name}: se abre Google Chrome con un perfil temporal`);
    if (!login) return;
    let l; for (let i = 0; i < 60 && !l; i++) { try { l = fs.readFileSync(path.join(login, 'DevToolsActivePort'), 'utf8').split('\n'); } catch { await wait(250); } }
    let url = '';
    for (let i = 0; i < 50 && !expected.test(url); i++) { await wait(300); url = ((await (await fetch(`http://127.0.0.1:${l[0].trim()}/json/list`)).json()).find(t => t.type === 'page') || {}).url || ''; }
    check(expected.test(url), `8 ${name}: ese Chrome está en ${expected.source.replace(/\\/g, '')} (${url.slice(0, 60)})`);
    check(/open\.spotify\.com/.test(String(await remote('location.href'))), `8 ${name}: el Chrome de Spotify se queda donde estaba`);
    // el Supervisor cierra la ventana (después de verla un momento)
    await wait(1500);
    for (const t of (await (await fetch(`http://127.0.0.1:${l[0].trim()}/json/list`)).json()).filter(t => t.type === 'page')) await fetch(`http://127.0.0.1:${l[0].trim()}/json/close/${t.id}`);
    await until(async () => !fs.existsSync(login), 15000);
    check(!fs.existsSync(login), `8 ${name}: al cerrar su ventana se cancela y su perfil se borra`);
  };
  await tryLogin('«Iniciar sesión»', 'https://accounts.spotify.com/es/login?continue=https%3A%2F%2Fopen.spotify.com%2F', /accounts\.spotify\.com\/.*login/);
  await tryLogin('«Continuar con Google»', 'https://accounts.spotify.com/es/login/google?continue=https%3A%2F%2Fopen.spotify.com%2F', /accounts\.google\.com/);
  check(chromeLive() && /open\.spotify\.com/.test(String(await remote('location.href'))), '8 Spotify sigue como estaba');

  await host(`window.__navegadores.navegadores.get().lista.some(v => v.id === 'spotify') && document.querySelector('.ventana-navegador .botones-ventana button:last-child').click()`);
  await until(async () => !chromeLive(), 8000);
  out(failures ? `${failures} fallo(s)` : 'todo bien');
  app.exit(failures ? 1 : 0);
});

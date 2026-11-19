// Ventana propia de work-shelter (Electron): carga el juego del servidor local y se comporta como una aplicación.
// Dos maneras de abrirla: desde ./shelter (que ya ha levantado el servidor y pasa SHELTER_URL) o como
// /Applications/work-shelter-public.app (scripts/install-app.mjs), que pasa SHELTER_RAIZ y arranca ella el servidor.
const { app, BrowserWindow, Menu, shell, dialog, session, globalShortcut, webContents, ipcMain, systemPreferences, Notification } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setName('work-shelter-public');
// texts in the game's language (electron/texts.cjs): the last one the game reported
const texts = require('./texts.cjs');
const { tr } = texts;
texts.load(app.getPath('userData'));
// depuración remota (QA por CDP): solo en desarrollo, con SHELTER_DEV=1 además del puerto; abierta, cualquier proceso
// del equipo podría manejar la ventana del juego
if (process.env.SHELTER_CDP && process.env.SHELTER_DEV === '1') app.commandLine.appendSwitch('remote-debugging-port', process.env.SHELTER_CDP);
// la dirección lleva el secreto del arranque: se guarda y se quita del entorno (que no la hereden los Chrome que se lanzan)
const URL_INITIAL = process.env.SHELTER_URL; delete process.env.SHELTER_URL;
const fromApp = !URL_INITIAL && !!process.env.SHELTER_RAIZ;
if (fromApp && !app.requestSingleInstanceLock()) app.exit(0);
let mainWindow, origin, server;
// huella de lo que solo se lee al abrir la app (este archivo, la precarga de Spotify, el supervisor, ./shelter): va al
// servidor, que al reiniciar la compara con la de ahora y, si ha cambiado, pide volver a abrir la app entera (código 76)
let fingerprintApp = '';
try { fingerprintApp = require('../scripts/fingerprints.cjs').fingerprint('app'); } catch (e) { console.error('Sin huella de la app:', e?.message ?? e); }
const RELAY_CODE = 76;
// fuera del juego solo se abren webs y correo: nada de file:, javascript: ni esquemas que lanzan otras apps
const EXTERNAL = ['http:', 'https:', 'mailto:', 'message:'];   // message: abre un correo en Mail (avisos de Mail del Mac)
function openOutside(u) { let x; try { x = new URL(u); } catch { return; } if (EXTERNAL.includes(x.protocol)) shell.openExternal(x.href).catch(() => {}); }
// el juego es su origen exacto (http://127.0.0.1:<puerto>), no algo que empiece igual (http://127.0.0.1:37780…)
const gameOf = u => { try { return !!origin && new URL(u).origin === origin; } catch { return false; } };
// los permisos que usa el juego: el micrófono para dictar (web/src/ui/inputLine.tsx) y el portapapeles (copiar en el
// explorador y las terminales; pegar en la ventana de Spotify, que lo lee para escribirlo en su Chrome); ni cámara ni
// avisos web (los de macOS los da la app: «aviso» más abajo), y solo para la propia página del juego
const GAME_PERMISSIONS = ['media', 'clipboard-read', 'clipboard-sanitized-write'];
const permissionOfGame = (wc, permission, url, details) => !!mainWindow && !mainWindow.isDestroyed() && wc === mainWindow.webContents && gameOf(url) && GAME_PERMISSIONS.includes(permission)
  && (permission !== 'media' || (details?.mediaTypes ?? []).every(t => t === 'audio') && details?.mediaType !== 'video');
// una llamada por IPC vale solo si viene de la página del juego (ni de un navegador del refugio ni de otra web)
const ipcOfGame = e => !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents && gameOf(e.senderFrame?.url);

function create() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1280, minHeight: 760, backgroundColor: '#0a0908', title: 'work-shelter',
    autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, webviewTag: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  browsers(mainWindow);
  // el juego pinta solo con su ventana en primer plano (web/src/engine/focus.ts); un navegador del refugio dentro no cuenta
  const notifyFocus = () => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('foco', mainWindow.isFocused()); };
  mainWindow.on('focus', notifyFocus); mainWindow.on('blur', notifyFocus);
  mainWindow.webContents.on('did-finish-load', notifyFocus);
  mainWindow.once('ready-to-show', () => { if (!hidden) mainWindow.show(); });
  // si la página se cuelga o se cae, se recarga: vuelve dentro del margen del servidor y no se pierde nada
  mainWindow.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') setTimeout(() => { if (!mainWindow.isDestroyed()) mainWindow.reload(); }, 500); });
  // enlaces externos (Outlook, Discord, Linear…) en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => { openOutside(u); return { action: 'deny' }; });
  // la ventana no sale nunca del juego: ni un enlace ni una redirección la llevan a otra web (va al navegador del sistema)
  mainWindow.webContents.on('will-navigate', (e, u) => { u = e.url ?? u; if (!gameOf(u)) { e.preventDefault(); openOutside(u); } });
  mainWindow.webContents.on('will-redirect', (e, u) => { u = e.url ?? u; if (e.isMainFrame !== false && !gameOf(u)) { e.preventDefault(); openOutside(u); } });
  // salir desde el juego (Esc → Salir) ya está confirmado: el título de la página lo avisa
  mainWindow.on('page-title-updated', (e, t) => { if (/sellado/.test(t)) { mainWindow.__exit = true; setTimeout(() => mainWindow.destroy(), 1500); } });
  // cerrar la ventana pide confirmación (salir para todas las sesiones); mientras arranca no hay nada que parar
  mainWindow.on('close', e => {
    if (mainWindow.__exit || !origin) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(mainWindow, { type: 'question', buttons: [tr('stay'), tr('leaveTheShelter')], defaultId: 0, cancelId: 0, message: tr('leaveTheShelterQ'), detail: tr('allSessionsWillStop') });
    if (r === 1) { mainWindow.__exit = true; mainWindow.webContents.executeJavaScript("window.__salirRefugio && window.__salirRefugio()").finally(() => setTimeout(() => mainWindow.destroy(), 600)); }
  });
}
// --- Navegadores del refugio (web/src/ui/Browsers.tsx): cada uno es un <webview> con una sola web dentro ---
// Comparten una sesión propia que se guarda en disco (persist:navegador): un login se hace una vez y dura. Cada
// navegador se queda en el dominio con el que se abrió (y los de inicio de sesión); el resto de enlaces, al navegador
// del sistema. Sin preload ni Node: la página no ve nada del juego.
const PARTITION = 'persist:navegador';
// the «Web» browser: any https page a reply links (web/src/ui/linkOptions.ts), in a session of its own (not the work
// webs' logins), confined like the others to the domain it opened with, and with no permissions but writing the clipboard
const PARTITION_WEB = 'persist:web';
const ACCESS = ['accounts.google.com', 'login.microsoftonline.com', 'login.microsoft.com', 'login.live.com', 'appleid.apple.com', 'okta.com', 'auth0.com', 'onelogin.com'];
// webs que viven en varios dominios: abrir cualquiera de ellos deja pasar a los demás (Outlook salta entre
// outlook.cloud.microsoft, outlook.office.com y outlook.office365.com; los enlaces de invitación de Discord son discord.gg)
const FAMILIES = [['cloud.microsoft', 'office.com', 'office365.com', 'outlook.com', 'microsoft365.com'], ['discord.com', 'discord.gg']];
const domainBase = host => host.split('.').slice(-2).join('.');
const domainsOf = host => { const d = domainBase(host); return FAMILIES.find(f => f.includes(d)) ?? [d]; };
const under = (host, domain) => host === domain || host.endsWith('.' + domain);
function browsers(v) {
  const sess = session.fromPartition(PARTITION);
  // el agente de usuario se deja tal cual (con «Electron»): disfrazarlo de Chrome no cuadra con lo demás que ve
  // Cloudflare Turnstile y el login de Linear por email falla («We were unable to verify it's you»); con el de
  // Electron (el de la app de escritorio de Linear) pasa sin reto
  // las webs pueden escribir en el portapapeles y avisar; leerlo, no
  sess.setPermissionRequestHandler((_wc, permission, ok) => ok(['clipboard-sanitized-write', 'notifications'].includes(permission)));
  session.fromPartition(PARTITION_WEB).setPermissionRequestHandler((_wc, permission, ok) => ok(permission === 'clipboard-sanitized-write'));
  const pending = [];
  v.webContents.on('will-attach-webview', (e, prefs, params) => {
    let url; try { url = new URL(params.src); } catch {}
    if (!url || url.protocol !== 'https:' || ![PARTITION, PARTITION_WEB].includes(params.partition)) { e.preventDefault(); return; }
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true });
    pending.push(domainsOf(url.hostname));
  });
  v.webContents.on('did-attach-webview', (_e, wc) => configureBrowser(v, wc, pending.shift()));
}
function configureBrowser(v, wc, domains) {
  const host = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : null; } catch { return null; } };
  const own = u => { const h = host(u); return !!h && domains.some(d => under(h, d)); };
  const access = u => { const h = host(u); return !!h && ACCESS.some(d => under(h, d)); };
  const outside = u => { if (/^(https?|mailto):/i.test(u)) shell.openExternal(u).catch(() => {}); };   // linear://, zoommtg://, file:… no: abrirían otra app
  wc.on('will-navigate', (e, old) => { const u = e.url ?? old; if (!own(u) && !access(u)) { e.preventDefault(); outside(u); } });
  // new windows: never one of the game's own; login pages and the same web's, inside this browser; the rest, outside
  wc.setWindowOpenHandler(({ url: u }) => {
    if (own(u) || access(u)) wc.loadURL(u); else outside(u);
    return { action: 'deny' };
  });
  // las teclas del navegador las resuelve él; las de ventana del refugio suben al juego (Esc y el resto, a la página)
  wc.on('before-input-event', (e, k) => {
    if (k.type !== 'keyDown' || !k.meta || k.control || k.alt) return;
    const key = k.code;
    if (key === 'KeyR') { e.preventDefault(); k.shift ? wc.reloadIgnoringCache() : wc.reload(); }
    else if (key === 'BracketLeft' && !k.shift) { e.preventDefault(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
    else if (key === 'BracketRight' && !k.shift) { e.preventDefault(); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
    else if (key === 'Equal' || key === 'Minus' || key === 'Digit0') { e.preventDefault(); wc.setZoomLevel(key === 'Digit0' ? 0 : wc.getZoomLevel() + (key === 'Equal' ? 0.5 : -0.5)); }
    else if (key === 'KeyJ' && !k.shift) { e.preventDefault(); v.webContents.executeJavaScript('window.__atajoMusica && window.__atajoMusica()').catch(() => {}); }   // la música
    else if (key === 'KeyK' && !k.shift) { e.preventDefault(); v.webContents.executeJavaScript('window.__atajoBuscador && window.__atajoBuscador()').catch(() => {}); }   // el buscador
    else if (['KeyM', 'KeyW', 'KeyB'].includes(key)) {
      e.preventDefault();
      v.webContents.executeJavaScript(`window.__atajoNavegador && window.__atajoNavegador(${wc.id}, ${JSON.stringify({ code: key, key: k.key, shiftKey: !!k.shift })})`).catch(() => {});
    }
  });
  wc.on('context-menu', (_e, p) => {
    const m = [];
    if (p.linkURL) m.push({ label: own(p.linkURL) ? tr('openLinkInSystemBrowser') : tr('openLink'), click: () => outside(p.linkURL) }, { label: tr('copyLink'), click: () => require('electron').clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.isEditable) m.push({ role: 'undo', label: tr('undo') }, { role: 'redo', label: tr('redo') }, { type: 'separator' }, { role: 'cut', label: tr('cut'), enabled: p.editFlags.canCut }, { role: 'copy', label: tr('copy'), enabled: p.editFlags.canCopy }, { role: 'paste', label: tr('paste'), enabled: p.editFlags.canPaste }, { role: 'pasteAndMatchStyle', label: tr('pastePlain') }, { role: 'selectAll', label: tr('selectAll') });
    else if (p.selectionText) m.push({ role: 'copy', label: tr('copy') });
    m.push({ type: 'separator' }, { label: tr('back'), enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: tr('reload'), click: () => wc.reload() }, { label: tr('openPageInSystemBrowser'), click: () => outside(wc.getURL()) });
    Menu.buildFromTemplate(m.filter((x, i, a) => !(x.type === 'separator' && (i === 0 || a[i - 1].type === 'separator')))).popup({ window: v });
  });
}
// --- Salir a la superficie (tecla de pánico ⇧⌥⌘Esc, desde cualquier app) ---
// El juego desaparece al momento (ventana, Dock y sonido) y lo que tenía abierto (conversaciones y terminales) sigue
// en pestañas de iTerm (server/desktop.ts). La misma tecla, o volver a abrir la app, lo trae tal como estaba.
const PANIC = 'Shift+Alt+Command+Escape';
let hidden = false, serverEnvironment = null;
function panic() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (hidden) { goBack(); return; }
  hidden = true;
  mute(true);
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.hide(); app.hide(); if (app.dock) app.dock.hide();
  if (!origin) return;
  // se lo pide al juego; si la página no contesta (colgada), al servidor con ./shelter superficie
  const page = mainWindow.webContents.executeJavaScript('window.__superficie ? window.__superficie() : Promise.reject(new Error("sin juego"))');
  const deadline = new Promise((_, ko) => setTimeout(() => ko(new Error('el juego no contesta')), 2500));
  Promise.race([page, deadline]).catch(() => {
    const root = path.resolve(__dirname, '..');
    spawn('/bin/bash', [path.join(root, 'shelter'), 'superficie'], { cwd: root, env: serverEnvironment || process.env, stdio: 'ignore', detached: true }).unref();
  });
}
// el sonido del juego, el de los navegadores y la música de la discoteca (en su Chrome)
function mute(si) {
  for (const wc of webContents.getAllWebContents()) if (wc === mainWindow.webContents || wc.getType() === 'webview') wc.setAudioMuted(si);
  spotify?.evaluate(`window.__refugioMusica && window.__refugioMusica.silenciar(${!!si})`).catch(() => {});
}
function goBack() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  hidden = false;
  if (app.dock) app.dock.show();
  mute(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function open(u) { origin = new URL(u).origin; mainWindow.loadURL(u); }   // la URL lleva el secreto en #t=; para comparar, solo el origen

// --- Spotify (la discoteca): suena en Google Chrome sin ventana y el juego enseña su página (electron/remoteChrome.cjs) ---
// La ventana del juego lo maneja por IPC (preload.cjs: window.shelterRemoto): abrir, a la vista o no, tamaño, ratón y
// teclado, atrás y recargar, y el mando de la música. Al cerrar su ventana, se cierra Chrome (y la música).
const SPOTIFY = {
  start: 'https://open.spotify.com/', domains: ['spotify.com'], session: 'sp_dc',
  // iniciar sesión, siempre en Chrome visible (electron/chromeLogin.cjs): sus páginas de login y «Continuar con Google»
  login: {
    host: 'accounts.spotify.com', paths: /^\/([a-z]{2}(-[a-z]{2,4})?\/)?login(\/|$)/i, turn: 'https://open.spotify.com/',
    start: 'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F',
    google: 'https://accounts.spotify.com/login/google?continue=https%3A%2F%2Fopen.spotify.com%2F',
  },
};
let spotify = null;
function chromeSpotify() {
  if (spotify) return spotify;
  const aGame = (channel, ...a) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...a); };
  spotify = require(path.join(__dirname, 'remoteChrome.cjs')).createChromeRemote({
    spot: SPOTIFY, profile: path.join(app.getPath('userData'), 'chrome-spotify'), sess: session.fromPartition(PARTITION),
    onFrame: (jpeg, width, height) => aGame('remoto:fotograma', jpeg, width, height),
    onState: e => aGame('remoto:estado', e),
    openOutside: u => shell.openExternal(u),
    log: m => console.log('[Spotify en Chrome]', m),
  });
  return spotify;
}
const REMOTE_ORDERS = ['abrir', 'visible', 'tamano', 'entrada', 'navegar', 'evaluar', 'cerrar'];
ipcMain.handle('remoto', async (e, orden, ...a) => {
  if (!mainWindow || e.sender !== mainWindow.webContents || !REMOTE_ORDERS.includes(orden)) throw new Error('orden no permitida');
  if (orden === 'cerrar') { spotify?.close(); return null; }
  return chromeSpotify()[orden](...a);
});

// dictado del intercomunicador (web/src/ui/inputLine.tsx): el permiso del micrófono de macOS, pedido por la app
ipcMain.handle('microfono', async e => {
  if (!ipcOfGame(e)) return false;
  if (process.platform !== 'darwin') return true;
  return systemPreferences.getMediaAccessStatus('microphone') === 'granted' || systemPreferences.askForMediaAccess('microphone');
});

// avisos de macOS (web/src/ui/systemNotices.ts): un habitante espera tu respuesta. Solo con el juego en segundo plano y
// sin haber salido a la superficie (sus conversaciones siguen fuera); pulsarlo trae el juego con esa conversación
const notices = new Map();   // conversación → aviso a la vista (que no lo recoja el recolector antes del clic)
const removeNotice = id => { notices.get(id)?.close(); notices.delete(id); };
ipcMain.handle('aviso', (e, id, title, body) => {
  if (!ipcOfGame(e) || typeof id !== 'string' || hidden || mainWindow.isFocused() || !Notification.isSupported()) return false;
  removeNotice(id);
  const n = new Notification({ title: String(title).slice(0, 120), body: String(body).replace(/\s+/g, ' ').slice(0, 300) });
  n.on('click', () => { notices.delete(id); goBack(); if (!mainWindow.isDestroyed()) mainWindow.webContents.send('aviso:clic', id); });
  n.on('close', () => { if (notices.get(id) === n) notices.delete(id); });
  notices.set(id, n); n.show();
  return true;
});
ipcMain.handle('aviso:quitar', (e, id) => { if (ipcOfGame(e)) removeNotice(id); });
// Dock badge (dockBadge in web/src/ui/pendingNotices.ts): pending questions as a number, a finished turn as a dot
ipcMain.handle('insignia', (e, text) => { if (ipcOfGame(e) && app.dock) app.dock.setBadge(String(text ?? '').slice(0, 8)); });

// --- Abierta como aplicación: arranque ---

const BOOT = () => `<!doctype html><meta charset="utf-8"><title>work-shelter</title><style>
html,body{margin:0;height:100%;background:#0a0908;color:#d8cdb8;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;-webkit-user-select:none;cursor:default}
body{display:grid;place-items:center}div{text-align:center}h1{font-weight:500;font-size:15px;letter-spacing:.32em;text-transform:uppercase;margin:0 0 14px;color:#f0e6d2}
p{margin:0;color:#8a8070;min-height:1.5em}p.error{color:#e08060;white-space:pre-wrap;max-width:560px}
i{display:block;width:120px;height:1px;margin:18px auto 0;background:linear-gradient(90deg,transparent,#ffb547,transparent);animation:l 1.8s ease-in-out infinite}
@keyframes l{0%,100%{opacity:.15}50%{opacity:1}}</style><div><h1>work-shelter</h1><p id="m">${tr('opening')}</p><i id="l"></i></div>`;
function notice(text, error = false) {
  if (!mainWindow || origin) return;
  mainWindow.webContents.executeJavaScript(`(()=>{const m=document.getElementById('m');m.textContent=${JSON.stringify(text)};m.className=${JSON.stringify(error ? 'error' : '')};${error ? "document.getElementById('l').remove();" : ''}})()`).catch(() => {});
}

// Una app abierta desde el Finder o el Dock no hereda el PATH de la terminal: se lo pide a tu shell de inicio
function userEnvironment() {
  const mark = '__SHELTER_ENTORNO__';
  return new Promise(resolver => {
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', `printf ${mark}; env -0; printf ${mark}`], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 << 20 }, (err, output) => {
      const environment = {};
      const body = !err && typeof output === 'string' ? output.split(mark)[1] : undefined;
      for (const line of (body || '').split('\0')) { const i = line.indexOf('='); if (i > 0) environment[line.slice(0, i)] = line.slice(i + 1); }
      const base = { ...process.env, ...environment };
      const extra = [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
      // y el Node portátil que descarga ./shelter si no había uno (lo usa el relevo de la app)
      try { const rt = path.join(process.env.SHELTER_RAIZ, '.runtime'); extra.push(...fs.readdirSync(rt).filter(n => n.startsWith('node-')).map(n => path.join(rt, n, 'bin'))); } catch {}
      base.PATH = [...new Set([...(base.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':'), ...extra])].join(':');
      for (const k of Object.keys(base)) if (k.startsWith('ELECTRON_') || k === 'SHELTER_RAIZ') delete base[k];
      resolver(base);
    });
  });
}

async function start() {
  const root = process.env.SHELTER_RAIZ;
  const folderLogs = path.join(os.homedir(), 'Library/Logs/work-shelter-public');
  fs.mkdirSync(folderLogs, { recursive: true });
  const log = fs.createWriteStream(path.join(folderLogs, 'shelter.log'), { flags: 'a', mode: 0o600 });
  log.write(`\n== ${new Date().toISOString()} ==\n`);
  if (!fs.existsSync(path.join(root, 'shelter'))) { notice(tr('gameNotFound', { raiz: root }), true); return; }
  const environment = await userEnvironment();
  serverEnvironment = environment;
  // la app lleva su propia copia de Electron: si no es la del repo (p. ej. tras cambiar de versión en package.json), se
  // reinstala y se vuelve a abrir sola (scripts/relaunch-app.cjs) antes de arrancar nada
  try {
    const handover = require(path.join(root, 'scripts/relaunch-app.cjs'));
    const own = handover.appOf(process.execPath);
    if (handover.hasThatReinstall(own) && !handover.reinstallFailedRecently()) {
      notice(tr('updatingApp', { de: handover.versionElectron(own), a: handover.versionElectron(path.join(root, 'node_modules/electron/dist/Electron.app')) }));
      log.write(`La app lleva otro Electron que el repo: la reinstalo y la vuelvo a abrir.\n`);
      spawn('node', [path.join(root, 'scripts/relaunch-app.cjs'), String(process.pid), own, environment.SHELTER_PUERTO || '3778', process.env.SHELTER_RELEVO_PRUEBA || ''], { cwd: root, env: environment, detached: true, stdio: 'ignore' }).unref();
      if (mainWindow) mainWindow.__exit = true;
      setTimeout(() => app.exit(0), 1500);
      return;
    }
  } catch (e) { log.write(`No he podido comprobar el Electron de la app: ${e?.message ?? e}\n`); }
  server = spawn('/bin/bash', [path.join(root, 'shelter')], { cwd: root, env: { ...environment, SHELTER_DESDE_APP: '1', SHELTER_HUELLA_APP: fingerprintApp }, stdio: ['ignore', 'pipe', 'pipe'] });
  let last = '', rest = '';
  const read = chunk => {
    rest += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
    const lines = rest.split('\n'); rest = lines.pop();
    for (const l of lines) {
      const m = /^SHELTER_URL=(.+)$/.exec(l);
      if (m) { if (!origin) open(m[1].trim()); continue; }   // el secreto no va al registro
      log.write(l + '\n');
      if (l.trim() && !origin) { last = l.trim(); notice(last); }
    }
  };
  server.stdout.on('data', read); server.stderr.on('data', read);
  server.on('exit', code => {
    server = null;
    // «reiniciar» con cambios en la propia app: se vuelve a abrir entera (las terminales siguen en su anfitrión)
    if (code === RELAY_CODE) { log.write('Reinicio con la app entera.\n'); if (mainWindow) mainWindow.__exit = true; app.relaunch(); app.exit(0); return; }
    if (!origin) notice(tr('couldNotStart', { detalle: last ? ':\n' + last : tr('exitCode', { codigo: code }) }), true);
  });
}

const buildMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'work-shelter', submenu: [{ role: 'about', label: tr('about') }, { type: 'separator' }, { label: tr('goToTheSurface'), accelerator: PANIC, registerAccelerator: false, click: panic }, { type: 'separator' }, { role: 'reload', label: tr('reload') }, { role: 'toggleDevTools', label: tr('devTools') }, { role: 'togglefullscreen', label: tr('fullScreen') }, { type: 'separator' }, { role: 'quit', label: tr('quit') }] }, { role: 'editMenu', label: tr('edit') }]));
buildMenu();
// the game reports its language on every load (Options → Language reloads it): menus follow at once
ipcMain.handle('idioma', (e, i) => { if (ipcOfGame(e) && texts.setLanguage(i)) buildMenu(); });
// La caché HTTP del juego se vacía al abrir: lo que se vea es siempre lo que hay ahora en el repo (el servidor está en
// este mismo equipo, recargarlo no cuesta). Solo la del juego: las sesiones de los navegadores no se tocan.
const cacheClean = () => session.defaultSession.clearCache().catch(e => console.error('No he podido vaciar la caché:', e?.message ?? e));
app.whenReady().then(cacheClean).then(() => {
  // permisos de la ventana del juego (los navegadores del refugio tienen su propia sesión, más abajo en navegadores())
  session.defaultSession.setPermissionRequestHandler((wc, permission, ok, details) => ok(permissionOfGame(wc, permission, details?.requestingUrl ?? wc?.getURL(), details)));
  session.defaultSession.setPermissionCheckHandler((wc, permission, asksOrigin, details) => permissionOfGame(wc, permission, asksOrigin || wc?.getURL(), details));
  create();
  if (!globalShortcut.register(PANIC, panic)) console.error('No he podido registrar la tecla de pánico (⇧⌥⌘Esc): la tiene otra app.');
  if (!fromApp) { open(URL_INITIAL || 'http://127.0.0.1:3778'); return; }
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(BOOT()));
  start();
});
// otro clic en el Dock con la app abierta: al frente
app.on('second-instance', () => { if (!mainWindow) return; if (hidden) { goBack(); return; } if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); });
// escondida por la tecla de pánico: un clic en el Dock o abrir la app la trae de vuelta
app.on('activate', () => { if (hidden) goBack(); });
app.on('window-all-closed', () => app.quit());
// el servidor se apaga solo al quedarse sin ventana; si aún arrancaba, se para aquí
// al salir, el Chrome de Spotify se cierra ordenado (guarda su sesión) antes de que la app termine
let spotifyClosed = false;
app.on('will-quit', e => {
  if (spotify?.live && !spotifyClosed) { e.preventDefault(); spotifyClosed = true; Promise.race([spotify.close(), new Promise(r => setTimeout(r, 4000))]).finally(() => app.quit()); return; }
  globalShortcut.unregisterAll(); if (server && !server.killed) server.kill('SIGINT');
});

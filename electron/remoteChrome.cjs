// Spotify suena en Google Chrome, no en el Electron del juego: protege el audio con Widevine y su servidor de licencias
// solo las da a navegadores con firma VMP de producción, que Chrome tiene y un Electron no. Así no hay que pedir nada al
// Supervisor más que tener Chrome instalado.
// Un Google Chrome sin ventana (--headless=new: ni ventana ni icono en el Dock; el sonido sale por los altavoces como el
// de cualquier navegador) con un perfil propio y persistente (Application Support/work-shelter-public/chrome-spotify; la
// primera vez hereda las cookies de Spotify de los navegadores del refugio) abre Spotify, y el juego enseña su página en
// la ventana del navegador de Spotify (Browsers.tsx) con el screencast del protocolo de depuración y le pasa ratón,
// rueda y teclado. La pletina (Disco.tsx) lo maneja con window.__refugioMusica (electron/musicControl.js).
// Se presenta como el Chrome que es (sin «HeadlessChrome»). «Continuar con Google», en Chrome visible (chromeLogin.cjs);
// los enlaces que no son de Spotify, al navegador del sistema. QA: scripts/qa-spotify-chrome.cjs
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { tr } = require('./texts.cjs');
const { CHROME, startSessionInChrome, aSession, ofSession, watch: watchChild } = require('./chromeLogin.cjs');

const wait = ms => new Promise(r => setTimeout(r, ms));
const under = (host, domain) => host === domain || host.endsWith('.' + domain);
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
const REMOTE = fs.readFileSync(path.join(__dirname, 'musicControl.js'), 'utf8');

// conexión al protocolo de depuración (un WebSocket por destino)
async function connect(url, onEvent) {
  const ws = new WebSocket(url);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error(tr('noChromeConnection'))); });
  let n = 0; const pending = new Map();
  ws.onmessage = m => {
    const x = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString());
    if (x.id) { const p = pending.get(x.id); if (p) { pending.delete(x.id); x.error ? p.ko(new Error(`${p.method}: ${x.error.message}`)) : p.ok(x.result); } }
    else if (x.method) onEvent(x.method, x.params);
  };
  ws.onclose = () => { for (const p of pending.values()) p.ko(new Error(tr('chromeClosed'))); pending.clear(); };
  // ninguna orden se queda esperando para siempre (Chrome no contesta a algunas, como la rueda, en ciertos momentos)
  const cdp = (method, params = {}) => new Promise((ok, ko) => {
    if (ws.readyState !== 1) { ko(new Error(tr('chromeNotThere'))); return; }
    const id = ++n; pending.set(id, { ok, ko, method }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { const p = pending.get(id); if (p) { pending.delete(id); p.ko(new Error(tr('noAnswer', { metodo: method }))); } }, 10_000).unref?.();
  });
  return { ws, cdp };
}

// sitio: { inicio, dominios, sesion (cookie de sesión), login: { inicio, vuelta } }; perfil: carpeta del perfil de Chrome;
// ses: la sesión de los navegadores del refugio (de ahí sale la primera sesión y ahí se guarda la de un login nuevo);
// alFotograma(jpeg, ancho, alto) y alEstado({ url, titulo, cargando, vivo }) van a la ventana del juego
function createChromeRemote({ spot, profile, sess, onFrame, onState, openOutside, log = () => {}, chrome = CHROME, headless = true }) {
  let child = null, page = null, browser = null, starting = null, mainFrame = null, idPage = null, leaving = null;
  let size = { width: 1280, height: 800, scale: 1 }, seeing = false, inLogin = false, queue = [], emptying = false;
  const state = { url: '', title: '', loading: false, live: false };
  const notify = p => { Object.assign(state, p); onState({ ...state }); };
  const own = u => spot.domains.some(d => under(hostOf(u), d));
  const ofGoogle = u => /^https:\/\/accounts\.google\.com\//.test(u || '');

  async function start() {
    if (!chrome) throw new Error(tr('spotifyNeedsChrome'));
    fs.mkdirSync(profile, { recursive: true });
    // el de antes tiene que haber salido del todo: si no, el nuevo le cede el perfil y se cierra
    if (leaving) await leaving;
    // un Chrome de antes con este perfil (la app se cerró de golpe) se queda con él: fuera
    const remain = () => { try { execFileSync('/usr/bin/pgrep', ['-f', `user-data-dir=${profile}`]); return true; } catch { return false; } };
    if (remain()) { try { execFileSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch {} for (let i = 0; i < 40 && remain(); i++) await wait(150); }
    fs.rmSync(path.join(profile, 'DevToolsActivePort'), { force: true });
    child = spawn(chrome, [
      ...(headless ? ['--headless=new'] : []), `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--disable-blink-features=AutomationControlled', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check',
      '--disable-search-engine-choice-screen', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', `--force-device-scale-factor=${size.scale}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      'about:blank',
    ], { stdio: 'ignore' });
    watchChild(child);
    const self = child;
    child.on('exit', () => { if (child !== self) return; child = null; page = null; browser = null; notify({ live: false, loading: false }); log('Chrome se ha cerrado.'); });
    let line = null;
    for (let i = 0; i < 80 && child && !line; i++) { try { line = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n'); } catch { await wait(250); } }
    if (!line) throw new Error(tr('chromeDidNotStart'));
    const port = line[0].trim();
    browser = await connect(`ws://127.0.0.1:${port}${line[1].trim()}`, onBrowser);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const t = list.find(x => x.type === 'page');
    idPage = t.id;
    page = await connect(t.webSocketDebuggerUrl, onPage);
    const { cdp } = page;
    // como el Chrome que es: sin «HeadlessChrome» en el agente de usuario ni en sus pistas
    const { userAgent, product } = await browser.cdp('Browser.getVersion');
    const version = (/\/([\d.]+)/.exec(product) || [])[1] || '0';
    const major = version.split('.')[0];
    await cdp('Emulation.setUserAgentOverride', {
      userAgent: userAgent.replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8', platform: 'MacIntel',
      userAgentMetadata: { brands: [{ brand: 'Google Chrome', version: major }, { brand: 'Chromium', version: major }, { brand: 'Not.A/Brand', version: '99' }], fullVersion: version, platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false },
    });
    await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: REMOTE });
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    await browser.cdp('Target.setDiscoverTargets', { discover: true });
    mainFrame = (await cdp('Page.getFrameTree')).frameTree.frame.id;
    await measures();
    // la primera vez, la sesión de Spotify de los navegadores del refugio
    const { cookies } = await browser.cdp('Storage.getCookies');
    if (!cookies.some(c => c.name === spot.session && spot.domains.some(d => under(c.domain.replace(/^\./, ''), d)))) {
      const their = []; for (const d of spot.domains) their.push(...await ofSession(sess, d));
      if (their.length) { await cdp('Network.setCookies', { cookies: their }); log(`sesión de Spotify heredada del navegador del refugio (${their.length} cookies).`); }
    }
    notify({ live: true });
    await cdp('Page.navigate', { url: state.url && own(state.url) ? state.url : spot.start });
    if (seeing) void startImage();
  }
  async function ensure() {
    if (page) return;
    if (!starting) starting = start().catch(e => { log('no arranca: ' + e.message); try { child?.kill('SIGKILL'); } catch {} throw e; }).finally(() => { starting = null; });
    await starting;
  }

  // eventos de la página
  function onPage(method, p) {
    if (method === 'Page.screencastFrame') {
      page?.cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      onFrame(Buffer.from(p.data, 'base64'), p.metadata.deviceWidth, p.metadata.deviceHeight);
    } else if (method === 'Page.frameStartedLoading' && p.frameId === mainFrame) notify({ loading: true });
    else if (method === 'Page.frameStoppedLoading' && p.frameId === mainFrame) notify({ loading: false });
    else if (method === 'Page.frameNavigated' && !p.frame.parentId) notify({ url: p.frame.url });
    else if (method === 'Page.navigatedWithinDocument' && p.frameId === mainFrame) notify({ url: p.url });
    else if (method === 'Fetch.requestPaused') void fetchDocument(p);
  }
  // cada página que se abre en el marco principal: Spotify, dentro; iniciar sesión (su página de login o «Continuar con
  // Google»), en Chrome visible (sin ventana, Spotify contesta con un error a /login/google, y Google rechaza el login en
  // un Chrome manejado así); lo demás, al navegador del sistema. Los marcos de dentro (el reCAPTCHA de Google), siempre
  const isLogin = u => { try { const x = new URL(u); return spot.login && x.hostname === spot.login.host && spot.login.paths.test(x.pathname); } catch { return false; } };
  async function fetchDocument(p) {
    const { cdp } = page ?? {}; if (!cdp) return;
    const u = p.request.url;
    const login = p.frameId === mainFrame && (ofGoogle(u) || isLogin(u));
    if (!login && (p.frameId !== mainFrame || own(u) || u.startsWith('about:'))) { cdp('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return; }
    cdp('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Aborted' }).catch(() => {});
    if (login) void loginInChrome(ofGoogle(u) || /\/google/.test(new URL(u).pathname) ? spot.login.google : spot.login.start);
    else if (/^https?:/.test(u)) openOutside(u);
  }
  // ventanas nuevas que abre la página (enlaces con target=_blank): las de Spotify, en la misma; el resto, fuera
  function onBrowser(method, p) {
    if (method === 'Target.targetInfoChanged' && p.targetInfo.targetId === idPage) { notify({ title: p.targetInfo.title, url: p.targetInfo.url }); return; }
    if (method !== 'Target.targetCreated' || p.targetInfo.type !== 'page' || p.targetInfo.targetId === idPage || !p.targetInfo.openerId) return;
    const close = () => browser?.cdp('Target.closeTarget', { targetId: p.targetInfo.targetId }).catch(() => {});
    const decide = u => { close(); if (ofGoogle(u)) void loginInChrome(spot.login?.google); else if (isLogin(u)) void loginInChrome(spot.login.start); else if (own(u)) page?.cdp('Page.navigate', { url: u }).catch(() => {}); else if (/^https?:/.test(u)) openOutside(u); };
    if (p.targetInfo.url && p.targetInfo.url !== 'about:blank') { decide(p.targetInfo.url); return; }
    // aún sin dirección: se espera a que la tenga
    const watch = async () => { for (let i = 0; i < 20; i++) { await wait(150); const t = (await browser?.cdp('Target.getTargets').catch(() => null))?.targetInfos.find(x => x.targetId === p.targetInfo.targetId); if (!t) return; if (t.url && t.url !== 'about:blank') { decide(t.url); return; } } close(); };
    void watch();
  }
  // iniciar sesión en Chrome visible (perfil temporal); al entrar, sus cookies aquí y en los navegadores del refugio
  async function loginInChrome(start) {
    if (inLogin || !spot.login || !start) return;
    inLogin = true;
    try {
      const r = await startSessionInChrome({
        start, domains: spot.domains, session: spot.session, log,
        copy: async cookies => { await page?.cdp('Network.setCookies', { cookies }); await aSession(sess)(cookies); },
      });
      if (r === 'hecho') await page?.cdp('Page.navigate', { url: spot.login.turn });
      return r;
    } finally { inLogin = false; }
  }

  // la imagen: solo con la ventana a la vista. Sale a la densidad de la pantalla del juego (2 en Retina) porque Chrome
  // arranca con --force-device-scale-factor: sin él, el screencast sin ventana da la mitad de píxeles y se ve borroso
  // mientras la página cambia de proceso (al navegar), Chrome no la acepta: se reintenta
  async function startImage() {
    for (let i = 0; i < 20 && page && seeing; i++) {
      try { await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: Math.round(size.width * size.scale), maxHeight: Math.round(size.height * size.scale), everyNthFrame: 1 }); return; }
      catch { await wait(250); }
    }
  }
  async function measures() {
    await page?.cdp('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: false });
  }

  // el puntero de lo que hay bajo el ratón (la manita en enlaces y botones, el de texto en el buscador): sin ventana,
  // Chrome no lo cuenta; se le pregunta a la página, como mucho cada 90 ms
  let cursorSeen = 0, cursor = 'default';
  function lookCursor(x, y) {
    if (Date.now() - cursorSeen < 90 || !page) return;
    cursorSeen = Date.now();
    page.cdp('Runtime.evaluate', { expression: `(() => { const e = document.elementFromPoint(${+x}, ${+y}); return e ? getComputedStyle(e).cursor : 'default' })()`, returnByValue: true })
      .then(r => { const c = String(r?.result?.value || 'default'); if (c !== cursor) { cursor = c; notify({ cursor: /^[a-z-]+$/.test(c) ? c : 'default' }); } }, () => {});
  }
  async function clear(remote) {
    emptying = true;
    try {
      while (queue.length && page) {
        const e = queue.shift();
        await Promise.race([remote.inputAlready(e).catch(() => {}), wait(e.kind === 'rueda' ? 300 : 1500)]);
      }
    } finally { emptying = false; if (!page) queue = []; }
  }
  const MODS = e => (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.meta ? 4 : 0) | (e.shift ? 8 : 0);
  // las órdenes de edición de macOS: sin ventana, ⌘A, ⌘X, ⌘Z… no hacen nada si no se piden con su nombre
  const EDIT = { KeyA: 'selectAll', KeyX: 'cut', KeyC: 'copy', KeyZ: 'undo' };
  return {
    get state() { return { ...state }; },
    async open() { await ensure(); return { ...state }; },
    async visible(si) { seeing = !!si; if (!page) return; if (seeing) await startImage(); else await page.cdp('Page.stopScreencast').catch(() => {}); },
    async resize(width, height, scale) {
      size = { width: Math.max(320, Math.round(width)), height: Math.max(240, Math.round(height)), scale: Math.min(2, Math.max(1, +scale || 1)) };
      if (!page) return;
      await measures();
      if (seeing) await startImage();
    },
    // ratón, rueda y teclado de la ventana del juego (coordenadas en píxeles CSS de la página)
    // En cola: cada orden espera a que Chrome haya hecho la anterior (si no, un texto se adelanta a una tecla), con un
    // tope corto (Chrome a veces no contesta a la rueda). Lo que se queda viejo esperando no se manda: de los movimientos
    // del ratón seguidos, solo el último; las vueltas de rueda seguidas, sumadas en una. Sin eso, al mover el ratón se
    // acumulaban decenas de movimientos (unos 8 ms cada uno) y un clic tardaba un segundo en llegar. El juego no espera
    input(e) {
      if (!page) return;
      const last = queue[queue.length - 1];
      if (last && e.kind === 'raton' && e.type === 'mouseMoved' && last.kind === 'raton' && last.type === 'mouseMoved') queue[queue.length - 1] = e;
      else if (last && e.kind === 'rueda' && last.kind === 'rueda') queue[queue.length - 1] = { ...e, deltaX: last.deltaX + e.deltaX, deltaY: last.deltaY + e.deltaY };
      else queue.push(e);
      if (!emptying) void clear(this);
    },
    async inputAlready(e) {
      if (!page) return;
      const { cdp } = page;
      if (e.kind === 'raton') {
        await cdp('Input.dispatchMouseEvent', { type: e.type, x: e.x, y: e.y, button: e.button ?? 'none', buttons: e.buttons ?? 0, clickCount: e.clickCount ?? 0, modifiers: MODS(e) });
        if (e.type === 'mouseMoved') lookCursor(e.x, e.y);
      }
      else if (e.kind === 'rueda') await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: MODS(e) });
      else if (e.kind === 'tecla') {
        const base = { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, modifiers: MODS(e) };
        if (e.type === 'keyUp') { await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); return; }
        const text = e.text && !e.meta && !e.ctrl ? e.text : undefined;
        const commands = e.meta && EDIT[e.code] ? [e.shift && e.code === 'KeyZ' ? 'redo' : EDIT[e.code]] : undefined;
        await cdp('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text: text, unmodifiedText: text } : {}), ...(commands ? { commands } : {}) });
      } else if (e.kind === 'texto') await cdp('Input.insertText', { text: String(e.text).slice(0, 5000) });
    },
    async navigate(action) {
      if (!page) return;
      const { cdp } = page;
      if (action === 'recargar') await cdp('Page.reload');
      else if (action === 'atras') { const h = await cdp('Page.getNavigationHistory'); if (h.currentIndex > 0) await cdp('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }); }
      else if (typeof action === 'string' && own(action)) await cdp('Page.navigate', { url: action });
    },
    // código en la página (el mando de la música), como si lo hubiera hecho el Supervisor (gesto de usuario)
    async evaluate(code) {
      if (!page) return null;
      const r = await page.cdp('Runtime.evaluate', { expression: String(code), returnByValue: true, userGesture: true, awaitPromise: true }).catch(() => null);
      return r && !r.exceptionDetails ? r.result.value ?? null : null;
    },
    // cierre ordenado (Browser.close: guarda cookies y perfil en disco); si no contesta, a la fuerza. Devuelve cuándo ha
    // salido (como mucho, 7 s)
    close() {
      const h = child, nav = browser; child = null; page = null; browser = null;
      if (h) {
        leaving = new Promise(r => h.once('exit', r)).then(() => { leaving = null; });
        if (nav) nav.cdp('Browser.close').catch(() => {}); else try { h.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { h.kill('SIGTERM'); } catch {} }, 4000).unref?.();
        setTimeout(() => { try { h.kill('SIGKILL'); } catch {} }, 7000).unref?.();
      }
      notify({ live: false, loading: false });
      return leaving ?? Promise.resolve();
    },
    get live() { return !!child; },
  };
}

module.exports = { createChromeRemote };

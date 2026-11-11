// Spotify suena en Google Chrome, no en el Electron del juego: protege el audio con Widevine y su servidor de licencias
// solo las da a navegadores con firma VMP de producción, que Chrome tiene y un Electron no. Así no hay que pedir nada al
// Supervisor más que tener Chrome instalado.
// Un Google Chrome sin ventana (--headless=new: ni ventana ni icono en el Dock; el sonido sale por los altavoces como el
// de cualquier navegador) con un perfil propio y persistente (Application Support/work-shelter-public/chrome-spotify; la
// primera vez hereda las cookies de Spotify de los navegadores del refugio) abre Spotify, y el juego enseña su página en
// la ventana del navegador de Spotify (Navegadores.tsx) con el screencast del protocolo de depuración y le pasa ratón,
// rueda y teclado. La pletina (Discoteca.tsx) lo maneja con window.__refugioMusica (electron/mandoMusica.js).
// Se presenta como el Chrome que es (sin «HeadlessChrome»). «Continuar con Google», en Chrome visible (loginChrome.cjs);
// los enlaces que no son de Spotify, al navegador del sistema. QA: scripts/qa-spotify-chrome.cjs
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, startSessionInChrome, aSession, ofSession, vigilar } = require('./loginChrome.cjs');

const espera = ms => new Promise(r => setTimeout(r, ms));
const bajo = (host, dominio) => host === dominio || host.endsWith('.' + dominio);
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
const MANDO = fs.readFileSync(path.join(__dirname, 'mandoMusica.js'), 'utf8');

// conexión al protocolo de depuración (un WebSocket por destino)
async function conectar(url, onEvent) {
  const ws = new WebSocket(url);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('sin conexión con Chrome')); });
  let n = 0; const pendientes = new Map();
  ws.onmessage = m => {
    const x = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString());
    if (x.id) { const p = pendientes.get(x.id); if (p) { pendientes.delete(x.id); x.error ? p.ko(new Error(`${p.metodo}: ${x.error.message}`)) : p.ok(x.result); } }
    else if (x.method) onEvent(x.method, x.params);
  };
  ws.onclose = () => { for (const p of pendientes.values()) p.ko(new Error('Chrome se ha cerrado')); pendientes.clear(); };
  // ninguna orden se queda esperando para siempre (Chrome no contesta a algunas, como la rueda, en ciertos momentos)
  const cdp = (method, params = {}) => new Promise((ok, ko) => {
    if (ws.readyState !== 1) { ko(new Error('Chrome no está')); return; }
    const id = ++n; pendientes.set(id, { ok, ko, metodo: method }); ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { const p = pendientes.get(id); if (p) { pendientes.delete(id); p.ko(new Error(`${method}: sin respuesta`)); } }, 10_000).unref?.();
  });
  return { ws, cdp };
}

// sitio: { inicio, dominios, sesion (cookie de sesión), login: { inicio, vuelta } }; perfil: carpeta del perfil de Chrome;
// ses: la sesión de los navegadores del refugio (de ahí sale la primera sesión y ahí se guarda la de un login nuevo);
// alFotograma(jpeg, ancho, alto) y alEstado({ url, titulo, cargando, vivo }) van a la ventana del juego
function createChromeRemote({ sitio, perfil, ses, onFrame, onState, openOutside, apuntar = () => {}, chrome = CHROME, withoutHead = true }) {
  let child = null, page = null, navegador = null, arrancando = null, mainFrame = null, idPage = null, leaving = null;
  let tam = { ancho: 1280, alto: 800, escala: 1 }, seeing = false, inLogin = false, queue = [], emptying = false;
  const estado = { url: '', titulo: '', cargando: false, vivo: false };
  const avisar = p => { Object.assign(estado, p); onState({ ...estado }); };
  const propio = u => sitio.domains.some(d => bajo(hostOf(u), d));
  const ofGoogle = u => /^https:\/\/accounts\.google\.com\//.test(u || '');

  async function arrancar() {
    if (!chrome) throw new Error('Spotify necesita Google Chrome instalado (suena en él: el DRM de Spotify no admite el navegador del juego).');
    fs.mkdirSync(perfil, { recursive: true });
    // el de antes tiene que haber salido del todo: si no, el nuevo le cede el perfil y se cierra
    if (leaving) await leaving;
    // un Chrome de antes con este perfil (la app se cerró de golpe) se queda con él: fuera
    const remain = () => { try { execFileSync('/usr/bin/pgrep', ['-f', `user-data-dir=${perfil}`]); return true; } catch { return false; } };
    if (remain()) { try { execFileSync('/usr/bin/pkill', ['-f', `user-data-dir=${perfil}`]); } catch {} for (let i = 0; i < 40 && remain(); i++) await espera(150); }
    fs.rmSync(path.join(perfil, 'DevToolsActivePort'), { force: true });
    child = spawn(chrome, [
      ...(withoutHead ? ['--headless=new'] : []), `--user-data-dir=${perfil}`, '--remote-debugging-port=0',
      '--disable-blink-features=AutomationControlled', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check',
      '--disable-search-engine-choice-screen', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', `--force-device-scale-factor=${tam.escala}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      'about:blank',
    ], { stdio: 'ignore' });
    vigilar(child);
    const este = child;
    child.on('exit', () => { if (child !== este) return; child = null; page = null; navegador = null; avisar({ vivo: false, cargando: false }); apuntar('Chrome se ha cerrado.'); });
    let linea = null;
    for (let i = 0; i < 80 && child && !linea; i++) { try { linea = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').split('\n'); } catch { await espera(250); } }
    if (!linea) throw new Error('Chrome no ha arrancado.');
    const puerto = linea[0].trim();
    navegador = await conectar(`ws://127.0.0.1:${puerto}${linea[1].trim()}`, onBrowser);
    const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    const t = lista.find(x => x.type === 'page');
    idPage = t.id;
    page = await conectar(t.webSocketDebuggerUrl, onPage);
    const { cdp } = page;
    // como el Chrome que es: sin «HeadlessChrome» en el agente de usuario ni en sus pistas
    const { userAgent, product } = await navegador.cdp('Browser.getVersion');
    const version = (/\/([\d.]+)/.exec(product) || [])[1] || '0';
    const mayor = version.split('.')[0];
    await cdp('Emulation.setUserAgentOverride', {
      userAgent: userAgent.replace('HeadlessChrome', 'Chrome'), acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8', platform: 'MacIntel',
      userAgentMetadata: { brands: [{ brand: 'Google Chrome', version: mayor }, { brand: 'Chromium', version: mayor }, { brand: 'Not.A/Brand', version: '99' }], fullVersion: version, platform: 'macOS', platformVersion: '15.0.0', architecture: 'arm', model: '', mobile: false },
    });
    await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: MANDO });
    await cdp('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    await navegador.cdp('Target.setDiscoverTargets', { discover: true });
    mainFrame = (await cdp('Page.getFrameTree')).frameTree.frame.id;
    await measures();
    // la primera vez, la sesión de Spotify de los navegadores del refugio
    const { cookies } = await navegador.cdp('Storage.getCookies');
    if (!cookies.some(c => c.name === sitio.sesion && sitio.domains.some(d => bajo(c.domain.replace(/^\./, ''), d)))) {
      const their = []; for (const d of sitio.domains) their.push(...await ofSession(ses, d));
      if (their.length) { await cdp('Network.setCookies', { cookies: their }); apuntar(`sesión de Spotify heredada del navegador del refugio (${their.length} cookies).`); }
    }
    avisar({ vivo: true });
    await cdp('Page.navigate', { url: estado.url && propio(estado.url) ? estado.url : sitio.inicio });
    if (seeing) void startImage();
  }
  async function ensure() {
    if (page) return;
    if (!arrancando) arrancando = arrancar().catch(e => { apuntar('no arranca: ' + e.message); try { child?.kill('SIGKILL'); } catch {} throw e; }).finally(() => { arrancando = null; });
    await arrancando;
  }

  // eventos de la página
  function onPage(metodo, p) {
    if (metodo === 'Page.screencastFrame') {
      page?.cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      onFrame(Buffer.from(p.data, 'base64'), p.metadata.deviceWidth, p.metadata.deviceHeight);
    } else if (metodo === 'Page.frameStartedLoading' && p.frameId === mainFrame) avisar({ cargando: true });
    else if (metodo === 'Page.frameStoppedLoading' && p.frameId === mainFrame) avisar({ cargando: false });
    else if (metodo === 'Page.frameNavigated' && !p.frame.parentId) avisar({ url: p.frame.url });
    else if (metodo === 'Page.navigatedWithinDocument' && p.frameId === mainFrame) avisar({ url: p.url });
    else if (metodo === 'Fetch.requestPaused') void documento(p);
  }
  // cada página que se abre en el marco principal: Spotify, dentro; iniciar sesión (su página de login o «Continuar con
  // Google»), en Chrome visible (sin ventana, Spotify contesta con un error a /login/google, y Google rechaza el login en
  // un Chrome manejado así); lo demás, al navegador del sistema. Los marcos de dentro (el reCAPTCHA de Google), siempre
  const isLogin = u => { try { const x = new URL(u); return sitio.login && x.hostname === sitio.login.host && sitio.login.rutas.test(x.pathname); } catch { return false; } };
  async function documento(p) {
    const { cdp } = page ?? {}; if (!cdp) return;
    const u = p.request.url;
    const login = p.frameId === mainFrame && (ofGoogle(u) || isLogin(u));
    if (!login && (p.frameId !== mainFrame || propio(u) || u.startsWith('about:'))) { cdp('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return; }
    cdp('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Aborted' }).catch(() => {});
    if (login) void loginInChrome(ofGoogle(u) || /\/google/.test(new URL(u).pathname) ? sitio.login.google : sitio.login.inicio);
    else if (/^https?:/.test(u)) openOutside(u);
  }
  // ventanas nuevas que abre la página (enlaces con target=_blank): las de Spotify, en la misma; el resto, fuera
  function onBrowser(metodo, p) {
    if (metodo === 'Target.targetInfoChanged' && p.targetInfo.targetId === idPage) { avisar({ titulo: p.targetInfo.title, url: p.targetInfo.url }); return; }
    if (metodo !== 'Target.targetCreated' || p.targetInfo.type !== 'page' || p.targetInfo.targetId === idPage || !p.targetInfo.openerId) return;
    const cerrar = () => navegador?.cdp('Target.closeTarget', { targetId: p.targetInfo.targetId }).catch(() => {});
    const decide = u => { cerrar(); if (ofGoogle(u)) void loginInChrome(sitio.login?.google); else if (isLogin(u)) void loginInChrome(sitio.login.inicio); else if (propio(u)) page?.cdp('Page.navigate', { url: u }).catch(() => {}); else if (/^https?:/.test(u)) openOutside(u); };
    if (p.targetInfo.url && p.targetInfo.url !== 'about:blank') { decide(p.targetInfo.url); return; }
    // aún sin dirección: se espera a que la tenga
    const mirar = async () => { for (let i = 0; i < 20; i++) { await espera(150); const t = (await navegador?.cdp('Target.getTargets').catch(() => null))?.targetInfos.find(x => x.targetId === p.targetInfo.targetId); if (!t) return; if (t.url && t.url !== 'about:blank') { decide(t.url); return; } } cerrar(); };
    void mirar();
  }
  // iniciar sesión en Chrome visible (perfil temporal); al entrar, sus cookies aquí y en los navegadores del refugio
  async function loginInChrome(inicio) {
    if (inLogin || !sitio.login || !inicio) return;
    inLogin = true;
    try {
      const r = await startSessionInChrome({
        inicio, domains: sitio.domains, sesion: sitio.sesion, apuntar,
        copiar: async cookies => { await page?.cdp('Network.setCookies', { cookies }); await aSession(ses)(cookies); },
      });
      if (r === 'hecho') await page?.cdp('Page.navigate', { url: sitio.login.turn });
      return r;
    } finally { inLogin = false; }
  }

  // la imagen: solo con la ventana a la vista. Sale a la densidad de la pantalla del juego (2 en Retina) porque Chrome
  // arranca con --force-device-scale-factor: sin él, el screencast sin ventana da la mitad de píxeles y se ve borroso
  // mientras la página cambia de proceso (al navegar), Chrome no la acepta: se reintenta
  async function startImage() {
    for (let i = 0; i < 20 && page && seeing; i++) {
      try { await page.cdp('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: Math.round(tam.ancho * tam.escala), maxHeight: Math.round(tam.alto * tam.escala), everyNthFrame: 1 }); return; }
      catch { await espera(250); }
    }
  }
  async function measures() {
    await page?.cdp('Emulation.setDeviceMetricsOverride', { width: tam.ancho, height: tam.alto, deviceScaleFactor: tam.escala, mobile: false });
  }

  // el puntero de lo que hay bajo el ratón (la manita en enlaces y botones, el de texto en el buscador): sin ventana,
  // Chrome no lo cuenta; se le pregunta a la página, como mucho cada 90 ms
  let cursorVisto = 0, cursor = 'default';
  function lookCursor(x, y) {
    if (Date.now() - cursorVisto < 90 || !page) return;
    cursorVisto = Date.now();
    page.cdp('Runtime.evaluate', { expression: `(() => { const e = document.elementFromPoint(${+x}, ${+y}); return e ? getComputedStyle(e).cursor : 'default' })()`, returnByValue: true })
      .then(r => { const c = String(r?.result?.value || 'default'); if (c !== cursor) { cursor = c; avisar({ cursor: /^[a-z-]+$/.test(c) ? c : 'default' }); } }, () => {});
  }
  async function vaciar(remoto) {
    emptying = true;
    try {
      while (queue.length && page) {
        const e = queue.shift();
        await Promise.race([remoto.inputAlready(e).catch(() => {}), espera(e.tipo === 'rueda' ? 300 : 1500)]);
      }
    } finally { emptying = false; if (!page) queue = []; }
  }
  const MODS = e => (e.alt ? 1 : 0) | (e.ctrl ? 2 : 0) | (e.meta ? 4 : 0) | (e.shift ? 8 : 0);
  // las órdenes de edición de macOS: sin ventana, ⌘A, ⌘X, ⌘Z… no hacen nada si no se piden con su nombre
  const EDIT = { KeyA: 'selectAll', KeyX: 'cut', KeyC: 'copy', KeyZ: 'undo' };
  return {
    get estado() { return { ...estado }; },
    async abrir() { await ensure(); return { ...estado }; },
    async visible(si) { seeing = !!si; if (!page) return; if (seeing) await startImage(); else await page.cdp('Page.stopScreencast').catch(() => {}); },
    async tamano(ancho, alto, escala) {
      tam = { ancho: Math.max(320, Math.round(ancho)), alto: Math.max(240, Math.round(alto)), escala: Math.min(2, Math.max(1, +escala || 1)) };
      if (!page) return;
      await measures();
      if (seeing) await startImage();
    },
    // ratón, rueda y teclado de la ventana del juego (coordenadas en píxeles CSS de la página)
    // En cola: cada orden espera a que Chrome haya hecho la anterior (si no, un texto se adelanta a una tecla), con un
    // tope corto (Chrome a veces no contesta a la rueda). Lo que se queda viejo esperando no se manda: de los movimientos
    // del ratón seguidos, solo el último; las vueltas de rueda seguidas, sumadas en una. Sin eso, al mover el ratón se
    // acumulaban decenas de movimientos (unos 8 ms cada uno) y un clic tardaba un segundo en llegar. El juego no espera
    entrada(e) {
      if (!page) return;
      const ultima = queue[queue.length - 1];
      if (ultima && e.tipo === 'raton' && e.type === 'mouseMoved' && ultima.tipo === 'raton' && ultima.type === 'mouseMoved') queue[queue.length - 1] = e;
      else if (ultima && e.tipo === 'rueda' && ultima.tipo === 'rueda') queue[queue.length - 1] = { ...e, deltaX: ultima.deltaX + e.deltaX, deltaY: ultima.deltaY + e.deltaY };
      else queue.push(e);
      if (!emptying) void vaciar(this);
    },
    async inputAlready(e) {
      if (!page) return;
      const { cdp } = page;
      if (e.tipo === 'raton') {
        await cdp('Input.dispatchMouseEvent', { type: e.type, x: e.x, y: e.y, button: e.button ?? 'none', buttons: e.buttons ?? 0, clickCount: e.clickCount ?? 0, modifiers: MODS(e) });
        if (e.type === 'mouseMoved') lookCursor(e.x, e.y);
      }
      else if (e.tipo === 'rueda') await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: MODS(e) });
      else if (e.tipo === 'tecla') {
        const base = { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode, modifiers: MODS(e) };
        if (e.type === 'keyUp') { await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); return; }
        const texto = e.texto && !e.meta && !e.ctrl ? e.texto : undefined;
        const commands = e.meta && EDIT[e.code] ? [e.shift && e.code === 'KeyZ' ? 'redo' : EDIT[e.code]] : undefined;
        await cdp('Input.dispatchKeyEvent', { type: texto ? 'keyDown' : 'rawKeyDown', ...base, ...(texto ? { text: texto, unmodifiedText: texto } : {}), ...(commands ? { commands } : {}) });
      } else if (e.tipo === 'texto') await cdp('Input.insertText', { text: String(e.texto).slice(0, 5000) });
    },
    async navegar(accion) {
      if (!page) return;
      const { cdp } = page;
      if (accion === 'recargar') await cdp('Page.reload');
      else if (accion === 'atras') { const h = await cdp('Page.getNavigationHistory'); if (h.currentIndex > 0) await cdp('Page.navigateToHistoryEntry', { entryId: h.entries[h.currentIndex - 1].id }); }
      else if (typeof accion === 'string' && propio(accion)) await cdp('Page.navigate', { url: accion });
    },
    // código en la página (el mando de la música), como si lo hubiera hecho el Supervisor (gesto de usuario)
    async evaluar(codigo) {
      if (!page) return null;
      const r = await page.cdp('Runtime.evaluate', { expression: String(codigo), returnByValue: true, userGesture: true, awaitPromise: true }).catch(() => null);
      return r && !r.exceptionDetails ? r.result.value ?? null : null;
    },
    // cierre ordenado (Browser.close: guarda cookies y perfil en disco); si no contesta, a la fuerza. Devuelve cuándo ha
    // salido (como mucho, 7 s)
    cerrar() {
      const h = child, nav = navegador; child = null; page = null; navegador = null;
      if (h) {
        leaving = new Promise(r => h.once('exit', r)).then(() => { leaving = null; });
        if (nav) nav.cdp('Browser.close').catch(() => {}); else try { h.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { h.kill('SIGTERM'); } catch {} }, 4000).unref?.();
        setTimeout(() => { try { h.kill('SIGKILL'); } catch {} }, 7000).unref?.();
      }
      avisar({ vivo: false, cargando: false });
      return leaving ?? Promise.resolve();
    },
    get vivo() { return !!child; },
  };
}

module.exports = { createChromeRemote };

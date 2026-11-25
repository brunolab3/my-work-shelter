// QA de los navegadores de Comunicaciones en la ventana real (Electron, por CDP), desde el tablón como lo haría el
// Supervisor: un aviso de cada fuente (Enter) se abre en el navegador de su web, dentro y no fuera (los de DEMO llevan
// enlaces de ejemplo y abren su web de inicio); 1–5 abren cada web; Discord y Slack llevan el agente de usuario de
// Chrome (con «Electron/44», Discord se cree «Chrome 44») y Outlook, GitHub y Linear, el de Electron. Gmail no tiene
// navegador dentro (Google no deja iniciar sesión en un Chromium empotrado). Lo que se abriría en el navegador del sistema (window.open) se apunta en vez de abrirse.
// Uso: node scripts/qa-browser-board.mjs [puerto-cdp]
//   (Electron con SHELTER_DEV=1 SHELTER_CDP=<puerto>, --user-data-dir temporal y un refugio de prueba: SHELTER_DATOS, SHELTER_PUERTO)
import { chromium } from 'playwright';
const [port = '9335'] = process.argv.slice(2);
const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pg = b.contexts()[0].pages().find(p => !p.url().startsWith('devtools')) ?? b.contexts()[0].pages()[0];
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(async () => {
  await window.__ready(); window.__game.set({ panel: null, panelData: null }); window.__browsers.browsers.set({ list: [] });
  window.__outside = []; window.open = u => { window.__outside.push(String(u)); return null; };
});
const wait = ms => pg.waitForTimeout(ms);
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const list = () => pg.evaluate(() => window.__browsers.browsers.get().list);
const webOf = (id, js) => pg.evaluate(([id, js]) => { const w = [...document.querySelectorAll('.window-browser')].find(v => v.getAttribute('aria-label') === 'Navegador: ' + id)?.querySelector('webview'); return w ? w.executeJavaScript(js) : null; }, [id, js]);
const NAME = { outlook: 'Outlook', discord: 'Discord', slack: 'Slack', github: 'GitHub', linear: 'Linear' };
const HOST = { outlook: /(^|\.)(cloud\.microsoft|office\.com|office365\.com|microsoftonline\.com|live\.com)$/, discord: /(^|\.)discord\.com$/, slack: /(^|\.)slack\.com$/, github: /(^|\.)github\.com$/, linear: /(^|\.)linear\.app$/ };
const until = async (f, ms = 25000) => { for (let t = 0; t < ms; t += 300) { if (await f()) return true; await wait(300); } return false; };

// el tablón, con avisos de todas las fuentes
await pg.evaluate(() => window.__game.set({ panel: 'comms', panelData: null }));
await pg.waitForSelector('.device .feed-list li');
const buttons = await pg.$$eval('.open-webs button', bs => bs.map(b => b.textContent));
check(buttons.join('|') === '1 · Outlook|2 · Discord|3 · Slack|4 · GitHub|5 · Linear', `botones «Abrir aquí» (${buttons.join(', ')})`);

for (const source of ['outlook', 'discord', 'slack', 'github', 'linear']) {
  await pg.evaluate(() => { window.__browsers.browsers.set({ list: [] }); window.__outside = []; });
  // filtro de la fuente (→ hasta su pestaña) y Enter en el primer aviso
  const k = await pg.$$eval('.device .tabs .chip', (cs, n) => cs.findIndex(c => c.textContent.startsWith(n)), NAME[source]);
  await pg.click(`.device .tabs .chip:nth-child(${k + 1})`);
  const notice = await pg.evaluate(f => window.__live.get().notifications.find(n => n.source === f), source);
  await pg.keyboard.press('Enter');
  await until(async () => (await list()).some(v => v.id === source && !v.loading));
  const v = (await list()).find(x => x.id === source);
  const outside = await pg.evaluate(() => window.__outside);
  check(!!v && !outside.length, `${source}: Enter en un aviso${notice?.demo ? ' de DEMO' : ''} (${notice?.link}) abre su navegador dentro${outside.length ? '; fuera: ' + outside.join(' ') : ''}`);
  await wait(2500);
  const href = await webOf(NAME[source], 'location.href');
  check(HOST[source].test(new URL(href ?? 'about:blank').hostname || 'x'), `${source}: la web carga en su dominio o en su inicio de sesión (${String(href).slice(0, 90)})`);
  const ua = await webOf(NAME[source], 'navigator.userAgent');
  const chrome = source === 'discord' || source === 'slack';
  check(chrome ? !/Electron|work-shelter/.test(ua) && /Chrome\/1\d\d\./.test(ua) : /Electron\//.test(ua), `${source}: agente de usuario ${chrome ? 'de Chrome' : 'de Electron'} (${ua})`);
}

// 1–5 (o su botón): cada web sin pasar por un aviso. Con una web abierta, el foco está dentro y las teclas son suyas
await pg.evaluate(() => { window.__browsers.browsers.set({ list: [] }); window.__outside = []; });
await pg.keyboard.press('Digit3');
await until(async () => (await list()).some(v => v.id === 'slack'));
check((await list()).filter(v => !v.minimized).map(v => v.id).join() === 'slack', '3 abre Slack');
await pg.click('.open-webs button:nth-child(3)');
await until(async () => (await list()).some(v => v.id === 'discord'));
const ahead = (await list()).filter(v => !v.minimized).map(v => v.id);
check(ahead.join() === 'discord', `el botón «2 · Discord» lo abre y Slack pasa a la barra (a la vista: ${ahead.join(', ')})`);
check(!(await pg.evaluate(() => window.__outside)).length, 'nada se ha abierto en el navegador del sistema');
check(!errors.length, 'sin errores en la página' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(failures ? `${failures} fallo(s)` : 'todo bien');
await b.close();
process.exit(failures ? 1 : 0);

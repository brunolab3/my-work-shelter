// Electron's own texts (menus, dialogs, the boot screen, Chrome errors) in the game's language. Electron can't import
// the TS catalogue (shared/texts/) nor read the page's localStorage: the game tells it its language over IPC on every
// load (`idioma` in preload.cjs) and it is remembered in userData for the next boot screen.
const fs = require('node:fs');
const path = require('node:path');

const TEXTS = {
  stay: { es: 'Quedarse', en: 'Stay' },
  leaveTheShelter: { es: 'Salir del refugio', en: 'Leave the shelter' },
  leaveTheShelterQ: { es: '¿Salir del refugio?', en: 'Leave the shelter?' },
  allSessionsWillStop: { es: 'Se pararán todas las sesiones de los habitantes.', en: 'All the dwellers\' sessions will stop.' },
  openLinkInSystemBrowser: { es: 'Abrir el enlace en el navegador del sistema', en: 'Open the link in the system browser' },
  openLink: { es: 'Abrir el enlace', en: 'Open the link' },
  copyLink: { es: 'Copiar el enlace', en: 'Copy the link' },
  undo: { es: 'Deshacer', en: 'Undo' },
  redo: { es: 'Rehacer', en: 'Redo' },
  cut: { es: 'Cortar', en: 'Cut' },
  copy: { es: 'Copiar', en: 'Copy' },
  paste: { es: 'Pegar', en: 'Paste' },
  pastePlain: { es: 'Pegar sin formato', en: 'Paste without formatting' },
  selectAll: { es: 'Seleccionar todo', en: 'Select all' },
  back: { es: 'Atrás', en: 'Back' },
  reload: { es: 'Recargar', en: 'Reload' },
  openPageInSystemBrowser: { es: 'Abrir esta página en el navegador del sistema', en: 'Open this page in the system browser' },
  about: { es: 'Acerca de work-shelter', en: 'About work-shelter' },
  goToTheSurface: { es: 'Salir a la superficie', en: 'Go to the surface' },
  devTools: { es: 'Herramientas de desarrollo', en: 'Developer tools' },
  fullScreen: { es: 'Pantalla completa', en: 'Full screen' },
  quit: { es: 'Salir', en: 'Quit' },
  edit: { es: 'Edición', en: 'Edit' },
  opening: { es: 'Abriendo el refugio…', en: 'Opening the shelter…' },
  gameNotFound: { es: 'No encuentro el juego en {raiz}.\nVuelve a instalar la app (el comando de instalación del README, o ./shelter instalar-app en la carpeta del juego).', en: 'I can\'t find the game in {raiz}.\nReinstall the app (the install command in the README, or ./shelter instalar-app in the game\'s folder).' },
  updatingApp: { es: 'Poniendo al día la app (Electron {de} → {a})…', en: 'Updating the app (Electron {de} → {a})…' },
  couldNotStart: { es: 'work-shelter no ha podido arrancar{detalle}.\nRegistro completo en ~/Library/Logs/work-shelter-public/shelter.log', en: 'work-shelter could not start{detalle}.\nFull log in ~/Library/Logs/work-shelter-public/shelter.log' },
  exitCode: { es: ' (código {codigo})', en: ' (code {codigo})' },
  spotifyNeedsChrome: { es: 'Spotify necesita Google Chrome instalado (suena en él: el DRM de Spotify no admite el navegador del juego).', en: 'Spotify needs Google Chrome installed (it plays there: Spotify\'s DRM does not accept the game\'s browser).' },
  noChromeConnection: { es: 'sin conexión con Chrome', en: 'no connection with Chrome' },
  chromeClosed: { es: 'Chrome se ha cerrado', en: 'Chrome has closed' },
  chromeNotThere: { es: 'Chrome no está', en: 'Chrome is not there' },
  noAnswer: { es: '{metodo}: sin respuesta', en: '{metodo}: no answer' },
  chromeDidNotStart: { es: 'Chrome no ha arrancado.', en: 'Chrome did not start.' },
};

let file = null, actual = 'es';
// where the language is remembered (userData): read once the app is ready
function load(dir) { file = path.join(dir, 'idioma.json'); try { const v = JSON.parse(fs.readFileSync(file, 'utf8')).idioma; if (v === 'es' || v === 'en') actual = v; } catch {} }
function setLanguage(i) {
  if ((i !== 'es' && i !== 'en') || i === actual) return false;
  actual = i; if (file) try { fs.writeFileSync(file, JSON.stringify({ idioma: i })); } catch {}
  return true;
}
function tr(k, vars) {
  const x = TEXTS[k]; const s = x ? (actual === 'en' ? x.en : x.es) : k;
  return vars ? s.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m)) : s;
}
module.exports = { TEXTS, tr, setLanguage, load, idioma: () => actual };

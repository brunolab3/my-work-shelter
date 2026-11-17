import './migrateStorage';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Engine } from './engine/render';
import { watchFirstMap, watchPresence } from './engine/focus';
import { watchSystemNotices } from './ui/systemNotices';
import { Refugio } from './world/shelter';
import { Hud } from './ui/Hud';
import { Dialogo, intercoms } from './ui/Dialog';
import { Paneles } from './ui/Panels';
import { Terminales } from './ui/Terminals';
import { Barra } from './ui/Bar';
import { Navegadores, navegadores, openBrowser } from './ui/Browsers';
import { ClienteGit } from './ui/git/GitClient';
import { windowGit, openGit } from './ui/git/window';
import { Explorador } from './ui/files/Explorer';
import { filesWindow, openFiles } from './ui/files/window';
import { Avisos, Carga, CargaRooms } from './ui/Bridge';
import { Deck } from './ui/Disco';
import { Buscador } from './ui/Search';
import { PreflightPopover } from './ui/Preflight';
import { cliente, vivo } from './net/client';
import { juego } from './ui/gameState';
import { jiraBoard } from './ui/tasks';
import { t, idioma } from '@shared/language';

async function loadSources() {
  const families = ['800 40px "Refugio Titulo"', '600 40px "Refugio Rotulo"', '400 20px "Refugio Mono"', '500 20px "Refugio Mono"', '600 20px "Refugio Mono"', '20px "Refugio CRT"'];
  await Promise.all(families.map(f => document.fonts.load(f, 'ÁÑáñ¿¡')));
}

const fuentes = loadSources();
const motor = new Engine(document.getElementById('mundo')!);
(window as any).__engine = motor;
import('./world/animations').then(m => { (window as any).__anim = m; });   // QA: componer y probar clips desde la página
(window as any).__THREE = THREE;   // para la QA (rayos, cajas)
let refugio: Refugio;
const listo = fuentes.then(() => { refugio = new Refugio(motor); (window as any).__refugio = refugio; return refugio.listo; });
(window as any).__ready = () => listo;
createRoot(document.getElementById('ui')!).render(<><Hud /><Dialogo /><Paneles /><Terminales /><Navegadores /><ClienteGit /><Explorador /><div className="columna-izquierda"><Deck /><Barra /></div><Avisos /><Buscador /><PreflightPopover /><CargaRooms /><Carga /></>);
cliente.conectar();
// Electron's menus and dialogs in the game's language (electron/texts.cjs); changing it reloads the page
(window as any).shelterVentana?.setLanguage?.(idioma())?.catch?.(() => {});
Object.assign(window as any, { __juego: juego, __client: cliente, __live: vivo, __intercoms: intercoms, __browsers: { navegadores, openBrowser }, __git: { windowGit, openGit }, __files: { filesWindow, openFiles }, __board: jiraBoard }); // para QA y depuración
(window as any).__exitShelter = () => new Promise<void>(ok => { cliente.enviar({ t: 'salir' }); setTimeout(ok, 300); });
// tecla de pánico (Electron): lo abierto sale a tu escritorio. Contesta al momento; si no hay conexión, Electron se lo
// pide al servidor por su cuenta (./shelter superficie)
(window as any).__surface = () => { if (!vivo.get().connected) return Promise.reject(new Error(t('windows.noConnection'))); cliente.accion('superficie.sacar', { todo: true, windowNew: true }).catch(() => {}); return Promise.resolve(true); };
motor.arrancar();
// fuera de primer plano el motor deja de pintar y la interfaz deja de animarse
watchFirstMap(activo => motor.onChangeFirstMap(activo));
watchPresence(activo => { cliente.accion('presencia', { activo }).catch(() => {}); });
watchSystemNotices();

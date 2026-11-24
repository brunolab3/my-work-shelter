import './migrateStorage';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { Engine } from './engine/render';
import { watchFirstMap, watchPresence } from './engine/focus';
import { watchSystemNotices } from './ui/systemNotices';
import { watchMemory } from './ui/memoryReload';
import { Shelter } from './world/shelter';
import { Hud } from './ui/Hud';
import { Dialog, intercoms } from './ui/Dialog';
import { Panels } from './ui/Panels';
import { Terminals } from './ui/Terminals';
import { Bar } from './ui/Bar';
import { Browsers, browsers, openBrowser } from './ui/Browsers';
import { GitClient } from './ui/git/GitClient';
import { windowGit, openGit } from './ui/git/window';
import { Explorer } from './ui/files/Explorer';
import { filesWindow, openFiles } from './ui/files/window';
import { Notices, Loading, RoomsLoading } from './ui/Bridge';
import { Deck } from './ui/Disco';
import { Search } from './ui/Search';
import { FindBar } from './ui/FindBar';
import { PreflightPopover } from './ui/Preflight';
import { client, live } from './net/client';
import { juego } from './ui/gameState';
import { jiraBoard } from './ui/tasks';
import { t, language } from '@shared/language';

async function loadSources() {
  const families = ['800 40px "Refugio Titulo"', '600 40px "Refugio Rotulo"', '400 20px "Refugio Mono"', '500 20px "Refugio Mono"', '600 20px "Refugio Mono"', '20px "Refugio CRT"'];
  await Promise.all(families.map(f => document.fonts.load(f, 'ÁÑáñ¿¡')));
}

const sources = loadSources();
const motor = new Engine(document.getElementById('mundo')!);
(window as any).__engine = motor;
import('./world/animations').then(m => { (window as any).__anim = m; });   // QA: componer y probar clips desde la página
(window as any).__THREE = THREE;   // para la QA (rayos, cajas)
let shelter: Shelter;
const ready = sources.then(() => { shelter = new Shelter(motor); (window as any).__shelter = shelter; return shelter.ready; });
(window as any).__ready = () => ready;
createRoot(document.getElementById('ui')!).render(<><Hud /><Dialog /><Panels /><Terminals /><Browsers /><GitClient /><Explorer /><div className="columna-izquierda"><Deck /><Bar /></div><Notices /><Search /><FindBar /><PreflightPopover /><RoomsLoading /><Loading /></>);
client.connect();
// Electron's menus and dialogs in the game's language (electron/texts.cjs); changing it reloads the page
(window as any).shelterVentana?.setLanguage?.(language())?.catch?.(() => {});
Object.assign(window as any, { __game: juego, __client: client, __live: live, __intercoms: intercoms, __browsers: { browsers, openBrowser }, __git: { windowGit, openGit }, __files: { filesWindow, openFiles }, __board: jiraBoard }); // para QA y depuración
(window as any).__exitShelter = () => new Promise<void>(ok => { client.send({ t: 'salir' }); setTimeout(ok, 300); });
// tecla de pánico (Electron): lo abierto sale a tu escritorio. Contesta al momento; si no hay conexión, Electron se lo
// pide al servidor por su cuenta (./shelter superficie)
(window as any).__surface = () => { if (!live.get().connected) return Promise.reject(new Error(t('windows.noConnection'))); client.action('surface.takeOut', { all: true, windowNew: true }).catch(() => {}); return Promise.resolve(true); };
motor.start();
// fuera de primer plano el motor deja de pintar y la interfaz deja de animarse
watchFirstMap(active => motor.onChangeFirstMap(active));
watchPresence(active => { client.action('presence', { active }).catch(() => {}); });
watchSystemNotices();
watchMemory();

// Buscador del refugio (⌘K, desde cualquier sitio: el refugio, un intercomunicador, una terminal o un navegador).
// Todo lo que no es del juego en sí (eso va en el menú de Esc) se encuentra aquí escribiendo, sin acordarse de teclas:
// - Conversaciones: las abiertas (las que te esperan, delante) y las recientes de todas las salas, para retomarlas.
// - Acciones: lo que antes estaba en teclas y botones sueltos (plano, git, cuaderno, terminal, música, webs…), cada
//   una con su tecla a la vista para aprenderla; sin escribir, las que más usas, primero.
// - Al escribir, también habitantes (hablar con…) y salas (ir a…).
// ↑↓ eligen, Enter abre, Esc o ⌘K cierran. Lo elegido se apunta (en este navegador) para ordenar las recurrentes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecentConversation, SessionSummary } from '@shared/protocolo';
import { Store } from './almacen';
import { t, tIs } from '@shared/idioma';
import { juego } from './estadoJuego';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { MAC } from './ventanas';
import { openPanel, goA, ocupados, openGitOfRoom } from './Paneles';
import { minimizeIntercom, openConversation, resumeConversation, hace, sessionALaView } from './Dialogo';
import { aAppClaude, takeASurface } from './superficie';
import { reloadView } from '../motor/render';
import { sessionOwner } from './copias';
import { openBrowser } from './Navegadores';
import { openGit } from './git/ventana';
import { musicShortcut } from './Discoteca';
import { entrar as enterBar } from './Barra';
import { adaptRoom } from './PanelesSala';

export const buscador = new Store<{ abierto: boolean }>({ abierto: false });
let recentLast: RecentConversation[] | null = null;   // las de la última vez: salen al momento mientras se piden otra vez
let antes: Element | null = null;
export function openSearch() {
  if (buscador.get().abierto) return;
  antes = document.activeElement;
  buscador.set({ abierto: true }); SFX.abrir();
}
function closeSearch(backOnFocus = true) {
  if (!buscador.get().abierto) return;
  buscador.set({ abierto: false });
  if (backOnFocus && antes instanceof HTMLElement && document.contains(antes)) antes.focus();
  antes = null;
}
const isCmdK = (e: KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK';
// en captura: antes que las terminales y los intercomunicadores (⌘K es del refugio en todas partes)
addEventListener('keydown', e => {
  if (!isCmdK(e)) return;
  e.preventDefault(); e.stopPropagation();
  if (buscador.get().abierto) closeSearch(); else openSearch();
}, true);
// con el foco en un navegador (<webview>) las teclas no llegan a la página: Electron manda ⌘K aquí
(window as any).__searchShortcut = () => { if (buscador.get().abierto) closeSearch(); else openSearch(); };

// ---------------------------------------------------------------- lo que se puede hacer
// antes de una acción del refugio, se despeja la vista (aparato abierto o intercomunicador delante)
function onShelter() { if (juego.get().panel) juego.set({ panel: null, panelData: null }); minimizeIntercom(); }
const K = MAC ? '⌘' : 'Ctrl+';
interface Action { id: string; texto: string; pista?: string; tecla?: string; claves?: string; f: () => void }
function acciones(): Action[] {
  const j = juego.get();
  const sala = (vivo.get().estado?.salas ?? []).find((s: any) => s.id === j.currentRoom);
  const coordinacion = ((vivo.get().estado?.salas ?? []) as any[]).find(s => s.tipo === 'coordinacion' && s.ruta);
  const withFolder =!!sala && (sala.ruta || sala.carpeta || ['puente', 'git', 'comunicaciones', 'planificacion', 'logistica'].includes(sala.tipo));
  const aLaView = sessionALaView();
  return [
    ...(aLaView ? [{ id: 'app-claude', texto: t('panels.continueTituloInTheClaude', { titulo: aLaView.titulo || t('windows.thisConversation') }), pista: t('panels.itClosesHere'), claves: 'claude app escritorio desktop abrir sacar', f: () => aAppClaude({ sesionId: aLaView.id }) },
      { id: 'remote-control', texto: t('panels.continueTituloOnYourPhone', { titulo: aLaView.titulo || t('windows.thisConversation') }), pista: t('panels.itClosesHere'), claves: 'remote control movil móvil phone telefono teléfono mobile', f: () => takeASurface({ sesiones: [aLaView.id], remoto: true }) }] : []),
    { id: 'todo-al-movil', texto: t('menu.everythingToYourPhone'), pista: t('menu.openConversationsWithRemoteControl'), claves: 'remote control movil móvil phone telefono teléfono mobile superficie todo', f: () => takeASurface({ todo: true, remoto: true, windowNew: true }) },
    { id: 'esperan', texto: t('panels.goToWhoeverIsWaiting'), tecla: 'Q', claves: 'pendiente permiso pregunta urgente', f: () => { const h = ocupados([...j.habitantes, ...j.copias]).find(x => x.estado === 'esperando' || x.estado === 'error'); if (h) goA(h.sala, h.id, true); else SFX.noAllowed(); } },
    { id: 'ocupados', texto: t('panels.whoIsBusy'), pista: t('panels.workingWaitingBrokenDown'), tecla: 'Tab', claves: 'ocupados trabajos estado', f: () => { onShelter(); openPanel('ocupados'); } },
    { id: 'plano', texto: t('panels.shelterMap'), pista: t('panels.fastTravelToAnyRoom'), tecla: 'M', claves: 'mapa viajar salas', f: () => { onShelter(); openPanel('plano'); } },
    { id: 'cuaderno', texto: t('panels.logbookOfAConversation'), pista: t('panels.theFullTranscript'), tecla: 'R', claves: 'transcripcion historial leer', f: () => { onShelter(); openPanel('cuaderno'); } },
    ...(withFolder ? [{ id: 'terminal', texto: t('panels.salaTerminal', { sala: sala.nombre }), pista: t('panels.shellInTheRoomS'), tecla: 'T', claves: 'terminal shell consola pty', f: () => window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { salaId: sala.id } })) }] : []),
    ...(sala && (sala.tipo === 'repo' || sala.tipo === 'coordinacion') ? [{ id: 'adaptar', texto: t('panels.adaptSalaToTheRepo', { sala: sala.nombre }), pista: t('panels.itsDwellerDesignsAScene'), claves: 'decorar decorado escena sala personalizar atrezo', f: () => { onShelter(); adaptRoom(sala.id).catch(() => SFX.error()); } }] : []),
    { id: 'git', texto: t('panels.versionControl'), pista: t('panels.changesCommitsBranchesAndGithub'), tecla: 'G', claves: 'git github commit rama pull push pr', f: () => openGitOfRoom(j.currentRoom) },
    { id: 'comunicaciones', texto: t('world.communications'), pista: t('panels.emailAndChats'), tecla: 'N', claves: 'correo mail chats avisos notificaciones tablon', f: () => { onShelter(); goA('comunicaciones'); } },
    { id: 'planificacion', texto: t('world.calendar'), pista: t('panels.calendarAndMeetings'), tecla: 'C', claves: 'calendario agenda reuniones eventos', f: () => { onShelter(); goA('planificacion'); } },
    { id: 'organizar', texto: t('panels.organizeTheRoomsByTasks'), pista: t('panels.aWorktreeAndAConversation'), claves: 'organizar worktree worktrees tareas pr prs pull requests salas sesiones stack apilados', f: () => { onShelter(); openPanel('organizar'); } },
    { id: 'prs', texto: t('panels.pullRequests'), pista: t('panels.yourPrsAndThoseAwaiting'), claves: 'pr prs pull requests revisiones review github', f: () => openGit({ vista: 'prs' }) },
    { id: 'logistica', texto: t('world.logistics'), pista: t('panels.jiraBoard'), tecla: 'L', claves: 'jira linear tareas issues tablero', f: () => { onShelter(); goA('logistica'); } },
    ...(coordinacion ? [{ id: 'reparto', texto: t('panels.planTasksInSala', { sala: coordinacion.nombre }), pista: t('panels.analyzeAJiraTaskWith'), claves: 'jira tareas planificar planificacion plan repartir reparto coordinacion worktrees salas', f: () => { onShelter(); goA(coordinacion.id); openPanel('sala', { salaId: coordinacion.id, vista: 'reparto' }); } },
      { id: 'despliegue', texto: t('world.deploymentPlan2'), pista: t('panels.yourPrsByStatusAnd', { sala: coordinacion.nombre }), claves: 'despliegue deploy desplegar pr prs pull requests bloqueos dependencias orden fusionar merge', f: () => { onShelter(); goA(coordinacion.id); openPanel('sala', { salaId: coordinacion.id, vista: 'despliegue' }); } }] : []),
    { id: 'musica', texto: t('panels.music'), pista: t('panels.spotifyAndTheDeck'), tecla: `${K}J`, claves: 'spotify musica discoteca pletina', f: () => musicShortcut() },
    { id: 'recargar', texto: t('menu.reloadTheView'), pista: t('menu.ifTheShelterGoesBlack'), claves: 'negro pantalla recargar reload refrescar', f: () => reloadView() },
    { id: 'barra', texto: t('panels.openWindows'), pista: t('panels.theBarAtTheBottom'), tecla: `${K}B`, claves: 'barra ventanas minimizadas', f: () => enterBar() },
    { id: 'chapa', texto: t('world.bodyShop'), pista: t('panels.changeYourLookOrA'), tecla: 'P', claves: 'aspecto ropa pelo probador personaje', f: () => { onShelter(); openPanel('chapa'); } },
    { id: 'inventario', texto: t('panels.inventoryAndShop'), tecla: 'I', claves: 'tienda chatarra accesorios guia', f: () => { onShelter(); openPanel('inventario'); } },
    { id: 'camara', texto: t('world.vault'), pista: t('panels.credentialsIntegrationsAndShelterSettings'), claves: 'credenciales claves integraciones ajustes llavero limite sesiones raiz repos atuendo', f: () => { onShelter(); goA('camara'); openPanel('camara'); } },
    { id: 'web-linear', texto: t('panels.openLinear'), pista: t('panels.web'), claves: 'navegador web', f: () => openBrowser('linear') },
    { id: 'web-outlook', texto: t('panels.openOutlook'), pista: t('panels.web'), claves: 'navegador web correo mail', f: () => openBrowser('outlook') },
    { id: 'web-discord', texto: t('panels.openDiscord'), pista: t('panels.web'), claves: 'navegador web chat', f: () => openBrowser('discord') },
    { id: 'web-slack', texto: t('panels.openSlack'), pista: t('panels.web'), claves: 'navegador web chat', f: () => openBrowser('slack') },
    { id: 'web-github', texto: t('panels.openGithub'), pista: t('panels.web'), claves: 'navegador web notificaciones', f: () => openBrowser('github') },
  ];
}

// ---------------------------------------------------------------- búsqueda
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// cada palabra escrita tiene que estar en el texto (o en sus claves); puntúa más empezar palabra y estar en el título
function score(q: string[], titulo: string, resto = ''): number {
  if (!q.length) return 1;
  const t = normal(titulo), r = normal(resto);
  let p = 0;
  for (const w of q) {
    const i = t.indexOf(w);
    if (i >= 0) p += 3 + (i === 0 || /\W/.test(t[i - 1]) ? 2 : 0);
    else if (r.includes(w)) p += 1;
    else return 0;
  }
  return p;
}
const USES = 'refugio.buscador.usos';
const usos = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(USES) || '{}'); } catch { return {}; } };
function apuntar(id: string) { try { const u = usos(); u[id] = (u[id] ?? 0) + 1; localStorage.setItem(USES, JSON.stringify(u)); } catch {} }

interface Row { id: string; seccion: string; texto: string; pista?: string; tecla?: string; estado?: string; f: () => void; p: number }
const STATE_ORDER: Record<string, number> = { esperando: 0, error: 1, trabajando: 2, arrancando: 2, terminada: 3, ociosa: 4 };
const TXT_STATE: Record<string, string> = { esperando: 'te espera', error: 'avería', trabajando: 'trabajando', arrancando: 'arrancando', terminada: 'terminado', ociosa: 'listo' };

export function Buscador() {
  const abierto = buscador.usar(e => e.abierto);
  return abierto ? <Window /> : null;
}

function Window() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [recientes, setRecent] = useState<RecentConversation[] | null>(recentLast);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const sesiones = vivo.usar(e => e.sesiones);
  const habitantes = juego.usar(e => e.habitantes);
  const copias = juego.usar(e => e.copias);
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  useEffect(() => { entrada.current?.focus(); cliente.accion<RecentConversation[]>('conversaciones.recientes', { limite: 20 }).then(r => { recentLast = r; setRecent(r); }).catch(() => setRecent(x => x ?? [])); }, []);

  const filas = useMemo<Row[]>(() => {
    const palabras = normal(q).split(/\s+/).filter(Boolean);
    const searching = palabras.length > 0;
    const nameOf = (hid: string) => [...habitantes, ...copias].find(h => h.id === hid);
    const out: Row[] = [];
    // conversaciones abiertas: las que te esperan, delante
    const abiertas = Object.values(sesiones).filter(s => s.estado !== 'cerrada').sort((a, b) => (STATE_ORDER[a.estado] ?? 5) - (STATE_ORDER[b.estado] ?? 5) || b.actualizada - a.actualizada);
    for (const s of abiertas as SessionSummary[]) {
      const h = nameOf(sessionOwner(s));
      const p = score(palabras, s.titulo, `${h?.nombre ?? ''} ${h?.nameRoom ?? ''} conversacion chat`);
      if (p) out.push({ id: 'ses:' + s.id, seccion: 'Conversaciones abiertas', texto: s.titulo || t('windows.conversation'), pista: `${h?.nombre ?? '¿?'} · ${h?.nameRoom ?? ''}`, estado: s.estado, f: () => openConversation(s.id), p: p + 2 });
    }
    // recientes del archivo (las que no están abiertas ya)
    const liveIds = new Set(abiertas.map(s => s.claudeId).filter(Boolean));
    let n = 0;
    for (const r of recientes ?? []) {
      if (liveIds.has(r.claudeId) || r.enCurso) continue;
      const h = habitantes.find(x => x.id === r.dwellerId);
      const p = score(palabras, r.titulo, `${h?.nombre ?? ''} ${h?.nameRoom ?? ''} ${r.rama ?? ''} conversacion chat reciente`);
      if (!p || (!searching && n >= 6)) continue;
      n++;
      out.push({ id: 'rec:' + r.claudeId, seccion: 'Conversaciones recientes', texto: r.titulo, pista: `${h?.nombre ?? ''} · ${h?.nameRoom ?? ''} · ${hace(r.modified)}${r.fuera ? ' · ' + t('windows.openOnYourDesktop') : ''}`,
        f: () => { if (r.fuera) { SFX.noAllowed(); vivo.set(v => ({ avisos: [...v.avisos.slice(-4), { id: Date.now(), nivel: 'aviso', texto: t('panels.thatConversationIsStillOpen') }] })); return; } onShelter(); resumeConversation(r.dwellerId, r); }, p });
    }
    // acciones: sin escribir, las recurrentes (las que más usas) delante
    const u = usos();
    const acc = acciones().map(a => ({ a, p: score(palabras, a.texto, `${a.pista ?? ''} ${a.claves ?? ''} ${a.tecla ?? ''}`) })).filter(x => x.p);
    if (!searching) acc.sort((x, y) => (u[y.a.id] ?? 0) - (u[x.a.id] ?? 0));
    for (const { a, p } of acc) out.push({ id: a.id, seccion: !searching && (u[a.id] ?? 0) > 0 ? 'Acciones recurrentes' : 'Acciones', texto: a.texto, pista: a.pista, tecla: a.tecla, f: a.f, p: p + (u[a.id] ?? 0) * 0.01 });
    if (searching) {
      for (const h of habitantes) { const p = score(palabras, t('windows.talkToNombre', { nombre: h.nombre }), `${h.mote} ${h.nameRoom} habitante`); if (p) out.push({ id: 'hab:' + h.id, seccion: 'Habitantes', texto: t('windows.talkToNombre', { nombre: h.nombre }), pista: h.nameRoom, f: () => { onShelter(); goA(h.sala, h.id, true); }, p }); }
      for (const s of salas) { const p = score(palabras, t('panels.goToSala', { sala: s.nombre }), `${s.tipo} sala`); if (p) out.push({ id: 'sala:' + s.id, seccion: 'Salas', texto: t('panels.goToSala', { sala: s.nombre }), pista: s.ruta ? s.ruta.replace(/^\/Users\/[^/]+/, '~') : undefined, f: () => { onShelter(); goA(s.id); }, p }); }
    }
    // con algo escrito, por secciones en el orden de la mejor de cada una
    if (!searching) return out;
    const mejor = new Map<string, number>();
    for (const f of out) mejor.set(f.seccion, Math.max(mejor.get(f.seccion) ?? 0, f.p));
    return out.sort((a, b) => (mejor.get(b.seccion)! - mejor.get(a.seccion)!) || (a.seccion === b.seccion ? b.p - a.p : a.seccion.localeCompare(b.seccion))).slice(0, 40);
  }, [q, sesiones, recientes, habitantes, copias, salas]);

  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { lista.current?.querySelector('.fila-buscador.activa')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const elegir = (k: number) => { const f = filas[k]; if (!f) { SFX.noAllowed(); return; } apuntar(f.id.startsWith('ses:') || f.id.startsWith('rec:') ? 'conversaciones' : f.id); closeSearch(false); SFX.clic(); f.f(); };

  return (
    <div className="fondo-buscador interactivo" onMouseDown={e => { if (e.target === e.currentTarget) closeSearch(); }}>
      <div className="buscador" role="dialog" aria-label={t('panels.shelterSearch')}>
        <div className="buscador-cabeza">
          <span className="prompt-sim">&gt;</span>
          <input ref={entrada} value={q} placeholder={t('panels.searchConversationsActionsDwellersOr')} spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
              else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); setI(x => Math.min(filas.length - 1, x + 1)); SFX.tick(); }
              else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setI(x => Math.max(0, x - 1)); SFX.tick(); }
              else if (e.key === 'PageDown') { e.preventDefault(); setI(x => Math.min(filas.length - 1, x + 8)); }
              else if (e.key === 'PageUp') { e.preventDefault(); setI(x => Math.max(0, x - 8)); }
              else if (e.key === 'Enter') { e.preventDefault(); elegir(i); }
              e.stopPropagation();
            }} />
          <span className="tecla">{K}K</span>
        </div>
        <div className="buscador-lista" ref={lista}>
          {filas.map((f, k) => (
            <div key={f.id}>
              {(k === 0 || filas[k - 1].seccion !== f.seccion) && <div className="seccion-buscador">{tIs(f.seccion)}{f.seccion === 'Conversaciones recientes' && recientes === null ? ' · ' + t('panels.searching') : ''}</div>}
              <div className={'fila-buscador' + (k === i ? ' activa' : '')} onMouseMove={() => { if (k !== i) setI(k); }} onClick={() => elegir(k)}>
                {f.estado && <span className={'piloto ' + (f.estado === 'esperando' ? 'esperando' : f.estado === 'error' ? 'error' : f.estado === 'trabajando' || f.estado === 'arrancando' ? 'trabajando' : 'ociosa')} />}
                <span className="txt">{f.texto}</span>
                {f.pista && <span className="pista">{f.pista}{f.estado ? ` · ${tIs(TXT_STATE[f.estado] ?? f.estado)}` : ''}</span>}
                {f.tecla && <span className="tecla">{f.tecla}</span>}
              </div>
            </div>
          ))}
          {!filas.length && <p className="tenue vacio-buscador">{t('panels.nothingForQTryAnother', { q })}</p>}
        </div>
        <div className="ayuda-consola"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.open')} <kbd>Esc</kbd> {t('menu.close')} <span className="tenue">· {t('panels.gameStuffOptionsRestartQuit')}</span> <kbd>Esc</kbd></div>
      </div>
    </div>
  );
}

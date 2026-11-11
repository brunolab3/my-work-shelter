// Puente entre los datos vivos del servidor y la interfaz: contadores de la regleta, nombre del refugio, chatarra,
// sonido de llegada de notificaciones según prioridad; avisos del servidor como teletipos; pantalla de carga y
// bienvenida del primer arranque.
import React, { useEffect, useState } from 'react';
import { juego } from './estadoJuego';
import { t } from '@shared/idioma';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { Device, Keys, useKeys } from './aparato';
import { LOOK } from './PanelesSala';
import { GAME_NAME } from '@shared/protocolo';
import { STOCK } from '@shared/aspecto';

let views = new Set<string>(); let primera = true;
vivo.subscribe(() => {
  const v = vivo.get(); const e = v.estado;
  const withoutSee = v.notificaciones.filter((n: any) => !n.vista);
  const ahora = Date.now();
  const prox = v.eventos.filter((x: any) => x.fin > ahora).sort((a: any, b: any) => a.inicio - b.inicio)[0];
  const demo = Object.values(v.integraciones).some((i: any) => i.modo === 'demo');
  const p: any = { notificationsWithoutSee: withoutSee.length, eventNext: prox ? { titulo: prox.titulo, inicio: prox.inicio } : null, demo };
  if (e) { p.refugio = e.nombre || GAME_NAME; p.scrap = e.jugador?.scrap ?? 0; }
  const j = juego.get();
  if (Object.keys(p).some(k => (j as any)[k] !== p[k] && JSON.stringify((j as any)[k]) !== JSON.stringify(p[k]))) juego.set(p);
  // llegada de notificaciones: sonido según la prioridad más alta de las nuevas
  const nuevas = withoutSee.filter((n: any) => !views.has(n.id));
  if (nuevas.length && !primera) { const alta = nuevas.some((n: any) => n.prioridad === 'alta'), media = nuevas.some((n: any) => n.prioridad === 'media'); alta ? SFX.highNotice() : media ? SFX.noticeMedia() : SFX.lowNotice(); }
  if (v.notificaciones.length) primera = false;
  views = new Set(v.notificaciones.map((n: any) => n.id));
  // primer arranque
  if (e && !e.doneWelcome && !j.panel && !shownWelcome) { shownWelcome = true; juego.set({ panel: 'bienvenida' }); }
});
let shownWelcome = false;

// ---------------------------------------------------------------- teletipos (avisos del servidor y del juego)
export function Avisos() {
  const avisos = vivo.usar(e => e.avisos);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  // los que preguntan se quedan hasta contestarlos (la respuesta va al servidor: acción aviso.responder)
  useEffect(() => { const ultimo = avisos[avisos.length - 1]; if (!ultimo) return; ultimo.nivel === 'error' ? SFX.error() : SFX.lowNotice(); if (ultimo.pregunta) return; const t = setTimeout(() => setRemoved(q => new Set([...q, ultimo.id])), ultimo.nivel === 'error' ? 9000 : 5000); return () => clearTimeout(t); }, [avisos.length]);
  const quitar = (id: number) => { setRemoved(q => new Set([...q, id])); vivo.set(e => ({ avisos: e.avisos.filter(a => a.id !== id) })); };
  const responder = (a: (typeof avisos)[number], si: boolean) => { cliente.accion('aviso.responder', { id: a.pregunta!.id, si }).catch(() => SFX.noAllowed()); SFX.clic(); quitar(a.id); };
  return <div className="teletipos">{avisos.filter(a => !removed.has(a.id)).map(a => a.pregunta
    ? <div key={a.id} className={'teletipo interactivo pregunta ' + a.nivel}>{a.texto}<div className="botonera"><button className="boton-taller" onClick={() => responder(a, false)}>{a.pregunta.no}</button><button className="boton-taller peligro" onClick={() => responder(a, true)}>{a.pregunta.si}</button></div></div>
    : <div key={a.id} className={'teletipo interactivo ' + a.nivel} onClick={() => setRemoved(q => new Set([...q, a.id]))}>{a.texto}</div>)}</div>;
}

// ---------------------------------------------------------------- pantalla de carga (hasta que la primera sala está lista)
export function Carga() {
  const [p, setP] = useState({ progreso: 0, sala: '' });
  const [fuera, setOutside] = useState(false);
  const [quitada, setQuitada] = useState(false);
  useEffect(() => {
    const f = (e: any) => { setP(e.detail); if (e.detail.progreso > 0) setTimeout(() => setOutside(true), 250); };
    addEventListener('refugio:carga', f);
    return () => removeEventListener('refugio:carga', f);
  }, []);
  useEffect(() => { if (fuera) { const t = setTimeout(() => setQuitada(true), 900); return () => clearTimeout(t); } }, [fuera]);
  if (quitada) return null;
  return (
    <div className={'pantalla-carga' + (fuera ? ' fuera' : '')}>
      <div className="engranaje-carga" aria-hidden />
      <div className="titulo-carga">work-shelter</div>
      <div className="barra-carga"><span style={{ width: `${Math.max(6, p.progreso * 100)}%` }} /></div>
      <div className="texto-carga">{p.sala ? t('panels.poweringUpSala', { sala: p.sala }) : t('panels.loweringTheHatch')}</div>
    </div>
  );
}
// el resto de salas aparece por partes con el refugio ya a la vista: un indicador discreto
export function CargaRooms() {
  const [p, setP] = useState(0);
  useEffect(() => { const f = (e: any) => setP(e.detail.progreso); addEventListener('refugio:carga', f); return () => removeEventListener('refugio:carga', f); }, []);
  if (p >= 1 || p === 0) return null;
  return <div className="carga-salas">{t('panels.poweringUpRooms')} · {Math.round(p * 100)} %</div>;
}

// ---------------------------------------------------------------- bienvenida (primer arranque): lore, Supervisor, nombre,
// raíz de repos (sus repos entran como salas) y, al entrar, a la cámara acorazada a conectar las fuentes (sin datos DEMO)
const CHARACTERS = ['Protagonist_B', 'Protagonist_A', 'Engineer', 'Survivalist', 'Hiker', 'Hoarder', 'Driver', 'SpaceRanger'];
export function Welcome() {
  const e = vivo.usar(x => x.estado);
  const [k, setK] = useState(Math.max(0, CHARACTERS.indexOf(e?.supervisor?.personaje ?? 'Protagonist_B')));
  const [nombre, setNombre] = useState(e?.nombre || GAME_NAME);
  const [raiz, setRaiz] = useState(e?.raizRepos ?? '~');
  const [foco, setFocus] = useState(0);
  // el Supervisor del refugio, detrás, se viste con cada uno (el aspecto entero se cambia luego en Chapa y Pintura)
  const cambiar = (d: number) => { const n = (k + d + CHARACTERS.length) % CHARACTERS.length; setK(n); SFX.tick(); window.dispatchEvent(new CustomEvent('refugio:probar', { detail: { quien: 'supervisor', aspecto: STOCK[CHARACTERS[n]] } })); };
  const entrar = async () => {
    await cliente.accion('guardar', { parche: { doneWelcome: true, nombre: nombre.trim() || GAME_NAME, raizRepos: raiz.trim() || '~', supervisor: { ...(e?.supervisor ?? {}), personaje: CHARACTERS[k], aspecto: null } } });
    SFX.success();
    window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: 'camara' } }));
    juego.set({ panel: 'camara', panelData: null });
  };
  useKeys(ev => {
    if (foco === 0 && (ev.code === 'ArrowLeft' || ev.code === 'KeyA')) cambiar(-1);
    else if (foco === 0 && (ev.code === 'ArrowRight' || ev.code === 'KeyD')) cambiar(1);
    else if (ev.code === 'ArrowDown' || ev.code === 'Tab') setFocus(f => Math.min(3, f + 1));
    else if (ev.code === 'ArrowUp') setFocus(f => Math.max(0, f - 1));
    else if (ev.code === 'Enter') { if (foco === 0) setFocus(1); else entrar(); }
  }, [k, foco, nombre, raiz]);
  const refN = React.useRef<HTMLInputElement>(null), refR = React.useRef<HTMLInputElement>(null);
  useEffect(() => { if (foco === 1) refN.current?.focus(); else if (foco === 2) refR.current?.focus(); else (document.activeElement as HTMLElement)?.blur?.(); }, [foco]);
  return (
    <Device rotulo={t('panels.welcomeOverseerRegistration')} ancho={52} onClose={entrar}>
      <p className="voz">{t('panels.theSurfaceHasBeenSilent')}</p>
      <div className={'fila-chips' + (foco === 0 ? ' activa' : '')} onClick={() => setFocus(0)}>
        <span className="etq">{t('panels.yourLook')}</span>
        <button className="chip" onClick={() => cambiar(-1)}>◀</button><b className="eleccion">{t(LOOK[CHARACTERS[k]])}</b><button className="chip" onClick={() => cambiar(1)}>▶</button>
        <span className="tenue">{t('panels.shownBehindInTheShelter')} <kbd>P</kbd>{t('panels.inChromePaintEverythingCan')}</span>
      </div>
      <label className={'campo-taller' + (foco === 1 ? ' activa' : '')} onClick={() => setFocus(1)}>
        <span className="etq">{t('panels.shelterName2')}</span>
        <input ref={refN} value={nombre} onChange={ev => setNombre(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); entrar(); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(0); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(2); } }} spellCheck={false} />
      </label>
      <label className={'campo-taller' + (foco === 2 ? ' activa' : '')} onClick={() => setFocus(2)}>
        <span className="etq">{t('panels.welcomeReposRoot')}</span>
        <input ref={refR} value={raiz} onChange={ev => setRaiz(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); entrar(); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(1); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(3); } }} spellCheck={false} placeholder="~/Developer" />
      </label>
      <p className="tenue">{t('panels.welcomeReposRootHint')}</p>
      <div className="botonera"><button className={'boton-taller' + (foco === 3 ? ' activa' : '')} onClick={entrar}>{t('panels.openTheShelter')}</button></div>
      <Keys><kbd>←→</kbd>{t('panels.look')} <kbd>↑↓</kbd>{t('panels.move')} <kbd>Enter</kbd>{t('panels.openTheShelterThen')} <kbd>F1</kbd>{t('panels.showsAllTheControls')}</Keys>
    </Device>
  );
}

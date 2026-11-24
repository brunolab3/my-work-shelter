// Puente entre los datos vivos del servidor y la interfaz: contadores de la regleta, nombre del refugio, chatarra,
// sonido de llegada de notificaciones según prioridad; avisos del servidor como teletipos; pantalla de carga y
// bienvenida del primer arranque.
import React, { useEffect, useRef, useState } from 'react';
import { juego } from './gameState';
import { t, tIs } from '@shared/language';
import { live, client, type Notice } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Keys, useKeys } from './device';
import { LOOK } from '@shared/labels';
import { GAME_NAME } from '@shared/protocol';
import { STOCK } from '@shared/appearance';

let views = new Set<string>(); let first = true;
live.subscribe(() => {
  const v = live.get(); const e = v.state;
  const unseen = v.notifications.filter((n: any) => !n.view);
  const demo = Object.values(v.integrations).some((i: any) => i.mode === 'demo');
  const p: any = { notificationsWithoutSee: unseen.length, demo };
  if (e) { p.shelter = e.name || GAME_NAME; p.scrap = e.jugador?.scrap ?? 0; }
  const j = juego.get();
  if (Object.keys(p).some(k => (j as any)[k] !== p[k] && JSON.stringify((j as any)[k]) !== JSON.stringify(p[k]))) juego.set(p);
  // llegada de notificaciones: sonido según la prioridad más alta de las nuevas
  const fresh = unseen.filter((n: any) => !views.has(n.id));
  if (fresh.length && !first) { const high = fresh.some((n: any) => n.priority === 'high'), media = fresh.some((n: any) => n.priority === 'media'); high ? SFX.highNotice() : media ? SFX.noticeMedia() : SFX.lowNotice(); }
  if (v.notifications.length) first = false;
  views = new Set(v.notifications.map((n: any) => n.id));
  // primer arranque
  if (e && !e.doneWelcome && !j.panel && !shownWelcome) { shownWelcome = true; juego.set({ panel: 'welcome' }); }
});
let shownWelcome = false;

// ---------------------------------------------------------------- teletipos (avisos del servidor y del juego)
// A new notice shows on its own for a few seconds and then folds into a single "earlier notices" slot (colored by its
// most severe level) until read: clicking the slot unfolds them, clicking one dismisses it, "read all" dismisses them all.
// Questions are never folded: they stay on their own until answered (the answer goes to the server: aviso.responder).
const freshFor = (a: Notice) => (a.level === 'error' ? 9000 : 5000);
const SEVERITY = ['error', 'warning'];
export function Notices() {
  const notices = live.use(e => e.notices);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(false);
  const heard = useRef(0);
  // the sound, only for a notice that just arrived (not when dismissing one leaves an older one last)
  useEffect(() => { const last = notices[notices.length - 1]; if (!last || last.id <= heard.current) return; heard.current = last.id; last.level === 'error' ? SFX.error() : SFX.lowNotice(); }, [notices]);
  const fresh = (a: Notice) => a.id + freshFor(a) > now;
  // re-render when the next fresh one should fold
  useEffect(() => { const t = notices.filter(a => !a.question && fresh(a)).map(a => a.id + freshFor(a) - Date.now()); if (!t.length) return; const h = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(...t)) + 20); return () => clearTimeout(h); }, [notices, now]);
  const stale = notices.filter(a => !a.question && !fresh(a));
  useEffect(() => { if (!stale.length) setOpen(false); }, [stale.length]);
  const remove = (...ids: number[]) => live.set(e => ({ notices: e.notices.filter(a => !ids.includes(a.id)) }));
  const respond = (a: Notice, si: boolean) => { client.action('notice.answer', { id: a.question!.id, si }).catch(() => SFX.notAllowed()); SFX.click(); remove(a.id); };
  const one = (a: Notice) => a.question
    ? <div key={a.id} className={'teletipo interactivo question ' + a.level}>{a.text}<div className="botonera"><button className="boton-taller" onClick={() => respond(a, false)}>{a.question.no}</button><button className="boton-taller peligro" onClick={() => respond(a, true)}>{a.question.si}</button></div></div>
    : <div key={a.id} className={'teletipo interactivo ' + a.level} title={a.text} onClick={() => remove(a.id)}>{a.text}</div>;
  const level = SEVERITY.find(n => stale.some(a => a.level === n)) ?? 'info';
  // mousedown is cancelled so that dismissing or answering one leaves the focus in what you were typing
  return <div className="teletipos" onMouseDown={e => e.preventDefault()}>
    {stale.length > 0 && <div className={'teletipos-grupo' + (open ? ' open' : '')}>
      <div className={'teletipo interactivo group ' + level} title={t(open ? 'panels.noticesFold' : 'panels.noticesUnfold')} onClick={() => { SFX.click(); setOpen(!open); }}>
        {(open ? '▾ ' : '▸ ') + t('panels.earlierNotices', { n: stale.length })}
        {open && <button className="leer-todos" onClick={e => { e.stopPropagation(); SFX.click(); remove(...stale.map(a => a.id)); }}>{t('panels.readAllNotices')}</button>}
      </div>
      {open && <div className="lista">{stale.map(one)}</div>}
    </div>}
    {notices.filter(a => a.question || fresh(a)).map(one)}
  </div>;
}

// ---------------------------------------------------------------- pantalla de carga (hasta que la primera sala está lista)
export function Loading() {
  const [p, setP] = useState({ progreso: 0, room: '' });
  const [outside, setOutside] = useState(false);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    const f = (e: any) => { setP(e.detail); if (e.detail.progreso > 0) setTimeout(() => setOutside(true), 250); };
    addEventListener('refugio:carga', f);
    return () => removeEventListener('refugio:carga', f);
  }, []);
  useEffect(() => { if (outside) { const t = setTimeout(() => setRemoved(true), 900); return () => clearTimeout(t); } }, [outside]);
  if (removed) return null;
  return (
    <div className={'pantalla-carga' + (outside ? ' fuera' : '')}>
      <div className="engranaje-carga" aria-hidden />
      <div className="titulo-carga">work-shelter</div>
      <div className="barra-carga"><span style={{ width: `${Math.max(6, p.progreso * 100)}%` }} /></div>
      <div className="texto-carga">{p.room ? t('panels.poweringUpSala', { sala: p.room }) : t('panels.loweringTheHatch')}</div>
    </div>
  );
}
// el resto de salas aparece por partes con el refugio ya a la vista: un indicador discreto
export function RoomsLoading() {
  const [p, setP] = useState(0);
  useEffect(() => { const f = (e: any) => setP(e.detail.progreso); addEventListener('refugio:carga', f); return () => removeEventListener('refugio:carga', f); }, []);
  if (p >= 1 || p === 0) return null;
  return <div className="carga-salas">{t('panels.poweringUpRooms')} · {Math.round(p * 100)} %</div>;
}

// ---------------------------------------------------------------- bienvenida (primer arranque): lore, Supervisor, nombre,
// raíz de repos (sus repos entran como salas) y, al entrar, a la cámara acorazada a conectar las fuentes (sin datos DEMO)
const CHARACTERS = ['Protagonist_B', 'Protagonist_A', 'Engineer', 'Survivalist', 'Hiker', 'Hoarder', 'Driver', 'SpaceRanger'];
export function Welcome() {
  const e = live.use(x => x.state);
  const [k, setK] = useState(Math.max(0, CHARACTERS.indexOf(e?.supervisor?.character ?? 'Protagonist_B')));
  const [name, setName] = useState(e?.name || GAME_NAME);
  const [root, setRoot] = useState(e?.reposRoot ?? '~');
  const [focus, setFocus] = useState(0);
  // el Supervisor del refugio, detrás, se viste con cada uno (el aspecto entero se cambia luego en Chapa y Pintura)
  const change = (d: number) => { const n = (k + d + CHARACTERS.length) % CHARACTERS.length; setK(n); SFX.tick(); window.dispatchEvent(new CustomEvent('refugio:probar', { detail: { who: 'supervisor', look: STOCK[CHARACTERS[n]] } })); };
  const enter = async () => {
    await client.action('save', { patch: { doneWelcome: true, name: name.trim() || GAME_NAME, reposRoot: root.trim() || '~', supervisor: { ...(e?.supervisor ?? {}), character: CHARACTERS[k], look: null } } });
    SFX.success();
    window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { roomId: 'vault' } }));
    juego.set({ panel: 'vault', panelData: null });
  };
  useKeys(ev => {
    if (focus === 0 && (ev.code === 'ArrowLeft' || ev.code === 'KeyA')) change(-1);
    else if (focus === 0 && (ev.code === 'ArrowRight' || ev.code === 'KeyD')) change(1);
    else if (ev.code === 'ArrowDown' || ev.code === 'Tab') setFocus(f => Math.min(3, f + 1));
    else if (ev.code === 'ArrowUp') setFocus(f => Math.max(0, f - 1));
    else if (ev.code === 'Enter') { if (focus === 0) setFocus(1); else enter(); }
  }, [k, focus, name, root]);
  const refN = React.useRef<HTMLInputElement>(null), refR = React.useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus === 1) refN.current?.focus(); else if (focus === 2) refR.current?.focus(); else (document.activeElement as HTMLElement)?.blur?.(); }, [focus]);
  return (
    <Device label={t('panels.welcomeOverseerRegistration')} width={52} onClose={enter}>
      <p className="voice">{t('panels.theSurfaceHasBeenSilent')}</p>
      <div className={'fila-chips' + (focus === 0 ? ' active' : '')} onClick={() => setFocus(0)}>
        <span className="etq">{t('panels.yourLook')}</span>
        <button className="chip" onClick={() => change(-1)}>◀</button><b className="eleccion">{tIs(LOOK[CHARACTERS[k]])}</b><button className="chip" onClick={() => change(1)}>▶</button>
        <span className="dim">{t('panels.shownBehindInTheShelter')} <kbd>P</kbd>{t('panels.inChromePaintEverythingCan')}</span>
      </div>
      <label className={'campo-taller' + (focus === 1 ? ' active' : '')} onClick={() => setFocus(1)}>
        <span className="etq">{t('panels.shelterName2')}</span>
        <input ref={refN} value={name} onChange={ev => setName(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); enter(); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(0); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(2); } }} spellCheck={false} />
      </label>
      <label className={'campo-taller' + (focus === 2 ? ' active' : '')} onClick={() => setFocus(2)}>
        <span className="etq">{t('panels.welcomeReposRoot')}</span>
        <input ref={refR} value={root} onChange={ev => setRoot(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); enter(); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus(1); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocus(3); } }} spellCheck={false} placeholder="~/Developer" />
      </label>
      <p className="dim">{t('panels.welcomeReposRootHint')}</p>
      <div className="botonera"><button className={'boton-taller' + (focus === 3 ? ' active' : '')} onClick={enter}>{t('panels.openTheShelter')}</button></div>
      <Keys><kbd>←→</kbd>{t('panels.look')} <kbd>↑↓</kbd>{t('panels.move')} <kbd>Enter</kbd>{t('panels.openTheShelterThen')} <kbd>F1</kbd>{t('panels.showsAllTheControls')}</Keys>
    </Device>
  );
}

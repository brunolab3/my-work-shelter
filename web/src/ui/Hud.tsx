// Interfaz base: una única regleta de acero colgada del borde superior (como un panel de control del refugio)
// con la placa del refugio, la hora real, los contadores de «qué pasa ahora» en ventanas de fósforo (con su tecla
// siempre a la vista) y las dos puertas de lo demás: el buscador (⌘K) y el menú del juego (Esc), que lleva el reinicio.
import React, { useEffect, useRef, useState } from 'react';
import { juego } from './gameState';
import { t, language } from '@shared/language';
import { live } from '../net/client';
import { openSearch } from './Search';
import { minimizeIntercom } from './Dialog';
import { MAC } from './windows';
import { openLink, openNotice } from './Browsers';
import { useKeys } from './device';
import { keyboard } from '../engine/keyboard';
import { SFX } from '../audio/sound';
import { nextEvent, urgency, alertDue, type MeetingEvent } from '@shared/meeting';

const LOC = language() === 'en' ? 'en-GB' : 'es-ES';
const fmtHour = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short' });

function useNow(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}

export const Icon = {
  gear: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.6 2h2.8l.5 2.6 1.9.8 2.2-1.5 2 2-1.5 2.2.8 1.9 2.7.5v2.8l-2.7.5-.8 1.9 1.5 2.2-2 2-2.2-1.5-1.9.8-.5 2.8h-2.8l-.5-2.8-1.9-.8-2.2 1.5-2-2 1.5-2.2-.8-1.9L2 13.4v-2.8l2.6-.5.8-1.9L3.9 6l2-2 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>,
  notice: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22zm-1 6h2v6h-2zm0 8h2v2h-2z"/></svg>,
  restsOn: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 5h20v14H2zm2 2v.5l8 5 8-5V7zm16 2.9-8 5-8-5V17h16z"/></svg>,
  timer: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v5.6l3.7 2.2-1 1.7L11 13.7z"/></svg>,
  nut: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10l5 9-5 9H7l-5-9zm5 5.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>,
  error: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm-3.5 5L7 8.5 10.5 12 7 15.5 8.5 17 12 13.5 15.5 17 17 15.5 13.5 12 17 8.5 15.5 7 12 10.5z"/></svg>,
  restart: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a8 8 0 017.4 5H22l-3.5 4.5L15 9h2.2A6 6 0 106 12H4a8 8 0 018-8zm0 16a8 8 0 01-7.4-5H2l3.5-4.5L9 15H6.8A6 6 0 1018 12h2a8 8 0 01-8 8z"/></svg>,
};

function untilMinutes(ts: number, now: number) {
  const m = Math.round((ts - now) / 60000);
  if (m <= 0) return t('windows.now');
  if (m < 60) return t('panels.inNMin', { n: m });
  // otro día: «mañana a las 10:00» o «en 3 días a las 10:00» (días de calendario, no de 24 h)
  const days = Math.round((new Date(ts).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400_000);
  if (days === 1) return t('panels.tomorrowAt', { hora: fmtHour.format(ts) });
  if (days > 1) return t('panels.inNDaysAt', { n: days, hora: fmtHour.format(ts) });
  const h = Math.floor(m / 60); return t('panels.inHH', { h }) + (m % 60 ? ' ' + t('panels.nMin', { n: m % 60 }) : '');
}

function Counter({ icon, n, text, key, level }: { icon: React.ReactNode; n: number | string; text: string; key: string; level?: 'urgente' | 'apagado' | 'error' | 'pronto' | 'inminente' | '' }) {
  return (
    <div className={'contador ' + (level || '')} title={`${text} (${key})`}>
      <span className="icono">{icon}</span>
      <span className="n">{n}</span>
      <span className="txt">{text}</span>
      <span className="tecla">{key}</span>
    </div>
  );
}

export function Hud() {
  const now = useNow();
  const e = juego.use(s => s);
  const all = [...e.dwellers, ...e.copies];   // con las copias holográficas
  const working = all.filter(h => h.state === 'trabajando' || h.state === 'pensando').length;
  const waiting = all.filter(h => h.state === 'esperando').length;
  const errors = all.filter(h => h.state === 'error').length;
  const connected = live.use(x => x.connected);
  const restarting = live.use(x => x.restarting);
  const next = nextEvent(live.use(x => x.events) as MeetingEvent[], now);
  return (
    <>
    <div className="regleta">
      <span className="tirante izq" /><span className="tirante der" />
      <div className="seg placa-refugio">
        <span className="nombre">{e.shelter}</span>
      </div>
      <div className="seg fosforo hora">
        <span className="hh">{fmtHour.format(now)}</span>
        <span className="fecha">{fmtDate.format(now)}</span>
      </div>
      {!connected && <div className="seg fosforo sin-enlace" title={t('panels.theLinkToTheShelter')}><span className="piloto error" /> {t('panels.noLinkRetrying')}</div>}
      <div className={'seg fosforo contadores' + (connected ? '' : ' viejos')}>
        <Counter icon={Icon.gear} n={working} text={t('windows.working')} key="Tab" level={working ? '' : 'apagado'} />
        <Counter icon={Icon.notice} n={waiting} text={t('panels.waitingForYou')} key="Q" level={waiting ? 'urgente' : 'apagado'} />
        {errors > 0 && <Counter icon={Icon.error} n={errors} text={t('panels.brokenDown')} key="Q" level="error" />}
        <Counter icon={Icon.restsOn} n={e.unseenNotifications} text={t('panels.unseen')} key="N" level={e.unseenNotifications ? '' : 'apagado'} />
        <Counter icon={Icon.timer} n={next ? untilMinutes(next.start, now) : '—'} text={next ? next.title : t('panels.noEvents')} key="C" level={next ? urgency(next, now) : 'apagado'} />
      </div>
      <div className="seg fosforo chatarra" title={t('panels.scrapEarnedWithEveryFinished')}>
        <span className="icono">{Icon.nut}</span><span className="n">{e.scrap.toLocaleString(LOC)}</span>
      </div>
      {/* las dos puertas de todo lo demás, con su tecla a la vista: el buscador (⌘K) y el menú del juego (Esc) */}
      <div className="seg puertas">
        <button className="boton-puerta" onClick={() => openSearch()} title={t('panels.searchConversationsActionsDwellersAnd')}>
          <span className="tecla">{MAC ? '⌘K' : 'Ctrl+K'}</span>{t('panels.search')}
        </button>
        <button className="boton-puerta" onClick={() => { if (juego.get().talkingWith) minimizeIntercom(); juego.set({ panel: 'menu', panelData: null }); }} title={t('panels.gameMenuOptionsShortcutsRestart')}>
          <span className="tecla">Esc</span>{t('panels.menu')}
        </button>
      </div>
    </div>
    {e.demo && <span className="marca-demo" title={t('panels.unconfiguredIntegrationsTheyShowSimulated')}>DEMO</span>}
    {restarting && <Restarting />}
    <MeetingAlert ev={next} now={now} />
    </>
  );
}

// A meeting about to start: once per event, a box over everything (the intercom and the terminals too) with Join and
// Dismiss. It takes the focus while open, so typing in a terminal doesn't go on underneath (as the pre-flight does).
const seenMeetings = new Set<string>();
function MeetingAlert({ ev, now }: { ev: MeetingEvent | null; now: number }) {
  const [open, setOpen] = useState<MeetingEvent | null>(null);
  useEffect(() => { if (!open && alertDue(ev, now, seenMeetings)) { seenMeetings.add(ev!.id); setOpen(ev); SFX.highNotice(); } }, [ev, now, open]);
  // gone by itself once the meeting is over
  useEffect(() => { if (open && open.end <= now) setOpen(null); }, [open, now]);
  return open ? <MeetingBox ev={open} now={now} close={() => setOpen(null)} /> : null;
}

function MeetingBox({ ev, now, close }: { ev: MeetingEvent; now: number; close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const link = ev.videollamada || ev.link;
  const join = () => { if (ev.videollamada) openLink(ev.videollamada); else openNotice(ev); close(); };
  const discard = () => { SFX.close(); close(); };
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, blocked = keyboard.blocked;
    before?.blur?.(); box.current?.focus({ preventScroll: true }); keyboard.blocked = true;
    return () => { keyboard.blocked = blocked; if (before?.isConnected) before.focus?.({ preventScroll: true }); };
  }, []);
  useKeys(e => {
    if (e.metaKey || e.ctrlKey) return false;
    if (e.code === 'Escape') discard();
    else if (e.code === 'Enter' && link) join();
  }, [ev], true);
  return <>
    <div className="reunion-velo interactivo" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }} />
    <div ref={box} className="reunion-caja interactivo" role="alertdialog" aria-label={t('meeting.alert')} tabIndex={-1}>
      <span className="icono">{Icon.timer}</span>
      <div className="reunion-titulo">{ev.title}</div>
      <div className="reunion-cuando">{ev.start > now ? t('meeting.startsIn1') : t('meeting.startsNow')}</div>
      <div className="reunion-botones">
        {link && <button className="boton-puerta" onClick={join}><span className="tecla">Enter</span>{t('meeting.join')}</button>}
        <button className="boton-puerta" onClick={discard}><span className="tecla">Esc</span>{t('meeting.dismiss')}</button>
      </div>
    </div>
  </>;
}

// mientras el servidor se reinicia: al volver el enlace, la página se recarga sola con el cliente nuevo
function Restarting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 25_000); return () => clearTimeout(t); }, []);
  return (
    <div className="despedida interactivo">
      <div className="placa-despedida">{t('panels.restarting')}
        <small>{slow ? t('panels.theServerIsTakingA') : t('panels.terminalsStayOpenILl')}</small>
      </div>
    </div>
  );
}

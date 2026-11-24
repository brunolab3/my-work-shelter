// Interfaz base: una única regleta de acero colgada del borde superior (como un panel de control del refugio)
// con la placa del refugio, la hora real, los contadores de «qué pasa ahora» en ventanas de fósforo (con su tecla
// siempre a la vista) y las dos puertas de lo demás: el buscador (⌘K) y el menú del juego (Esc), que lleva el reinicio.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UsageGraph } from './UsageGraph';
import { juego } from './gameState';
import { t, language } from '@shared/language';
import { live } from '../net/client';
import { openSearch } from './Search';
import { minimizeIntercom } from './Dialog';
import { MAC } from './windows';
import { openLink, openNotice } from './Browsers';
import { useKeys } from './device';
import { RunningThings } from './RunningThings';
import { useFitBar } from './fitBar';
import { keyboard } from '../engine/keyboard';
import { SFX } from '../audio/sound';
import { nextEvent, urgency, alertDue, type MeetingEvent } from '@shared/meeting';
import { BAR_WINDOWS, PACE_YELLOW, describeReset, limitLight, rejectedWindows, windowPace, windowStart, worstLight, type PlanLimit, type PlanLimits } from '@shared/planLimits';

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

function Counter({ icon, n, text, shortcut, level }: { icon: React.ReactNode; n: number | string; text: string; shortcut: string; level?: 'urgent' | 'off' | 'error' | 'pronto' | 'inminente' | '' }) {
  return (
    <div className={'contador ' + (level || '')} title={`${text} (${shortcut})`}>
      <span className="icono">{icon}</span>
      <span className="n">{n}</span>
      <span className="txt">{text}</span>
      <span className="tecla">{shortcut}</span>
    </div>
  );
}

export function Hud() {
  const now = useNow();
  const e = juego.use(s => s);
  const all = [...e.dwellers, ...e.copies];   // con las copias holográficas
  const working = all.filter(h => h.state === 'working' || h.state === 'thinking').length;
  const waiting = all.filter(h => h.state === 'waiting').length;
  const errors = all.filter(h => h.state === 'error').length;
  const connected = live.use(x => x.connected);
  const restarting = live.use(x => x.restarting);
  const next = nextEvent(live.use(x => x.events) as MeetingEvent[], now);
  const bar = useRef<HTMLDivElement>(null);
  useFitBar(bar);
  return (
    <>
    <div ref={bar} className="regleta">
      <span className="tirante left" /><span className="tirante right" />
      <div className="seg placa-refugio">
        <span className="nombre" title={e.shelter}>{e.shelter}</span>
      </div>
      <div className="seg fosforo hour">
        <span className="hh">{fmtHour.format(now)}</span>
        <span className="fecha">{fmtDate.format(now)}</span>
      </div>
      {!connected && <div className="seg fosforo sin-enlace" title={t('panels.theLinkToTheShelter')}><span className="pilot error" /> <span className="txt">{t('panels.noLinkRetrying')}</span></div>}
      <div className={'seg fosforo contadores' + (connected ? '' : ' viejos')}>
        <Counter icon={Icon.gear} n={working} text={t('windows.working')} shortcut="Tab" level={working ? '' : 'off'} />
        <Counter icon={Icon.notice} n={waiting} text={t('panels.waitingForYou')} shortcut="Q" level={waiting ? 'urgent' : 'off'} />
        {errors > 0 && <Counter icon={Icon.error} n={errors} text={t('panels.brokenDown')} shortcut="Q" level="error" />}
        <Counter icon={Icon.restsOn} n={e.unseenNotifications} text={t('panels.unseen')} shortcut="N" level={e.unseenNotifications ? '' : 'off'} />
        <Counter icon={Icon.timer} n={next ? untilMinutes(next.start, now) : '—'} text={next ? next.title : t('panels.noEvents')} shortcut="C" level={next ? urgency(next, now) : 'off'} />
      </div>
      <PlanMeter limits={live.use(x => x.planLimits)} now={now} />
      <RunningThings />
      <div className="seg fosforo chatarra" title={t('panels.scrapEarnedWithEveryFinished')}>
        <span className="icono">{Icon.nut}</span><span className="n">{e.scrap.toLocaleString(LOC)}</span>
      </div>
      {/* las dos puertas de todo lo demás, con su tecla a la vista: el buscador (⌘K) y el menú del juego (Esc) */}
      <div className="seg puertas">
        <button className="boton-puerta" onClick={() => openSearch()} title={t('panels.searchConversationsActionsDwellersAnd')}>
          <span className="tecla">{MAC ? '⌘K' : 'Ctrl+K'}</span><span className="label">{t('panels.search')}</span>
        </button>
        <button className="boton-puerta" onClick={() => { if (juego.get().talkingWith) minimizeIntercom(); juego.set({ panel: 'menu', panelData: null }); }} title={t('panels.gameMenuOptionsShortcutsRestart')}>
          <span className="tecla">Esc</span><span className="label">{t('panels.menu')}</span>
        </button>
      </div>
    </div>
    {e.demo && <span className="marca-demo" title={t('panels.unconfiguredIntegrationsTheyShowSimulated')}>DEMO</span>}
    {restarting && <Restarting />}
    <MeetingAlert ev={next} now={now} />
    </>
  );
}

// The Claude plan's usage (server/planLimits.ts): the 5-hour window, the weekly one once known and any other window
// that has stopped Claude, coloured by usage against the share of the window passed (limitLight): green on pace or
// behind, amber up to 1.25 times it, red above and «LIMIT» when rejected, grey while unknown. First the overall light
// (the worst window, named); hovering or focusing the meter opens each window's chart against pace and its reset.
const LIMIT_SHORT: Record<string, string> = { five_hour: t('panels.limit.shortFiveHour'), seven_day: t('panels.limit.shortWeekly') };
const LIMIT_NAME: Record<string, string> = { five_hour: t('panels.limit.nameFiveHour'), seven_day: t('panels.limit.nameWeekly'), seven_day_opus: t('panels.limit.nameWeeklyOpus'), seven_day_sonnet: t('panels.limit.nameWeeklySonnet') };
const limitName = (w: string) => LIMIT_NAME[w] ?? t('panels.limit.nameOther', { tipo: w });
function PlanMeter({ limits, now }: { limits: PlanLimits; now: number }) {
  const types = [...BAR_WINDOWS.filter(w => w === 'five_hour' || limits[w]), ...rejectedWindows(limits).filter(w => !(BAR_WINDOWS as readonly string[]).includes(w))];
  const worst = worstLight(limits, types, now);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const r = open ? box.current?.getBoundingClientRect() : undefined;
  // the popover takes the pointer and focus too (the spend graph's tabs and bars): while open, a pointer moving outside
  // both closes it (leave events across the portal are unreliable), after a short delay so it can cross the gap; with
  // the keyboard, focus moving into it keeps it open (React focus events bubble here from the portal)
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = () => { clearTimeout(closing.current); setOpen(true); };
  const hide = () => { clearTimeout(closing.current); closing.current = setTimeout(() => setOpen(false), 200); };
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (box.current?.contains(el) || el?.closest?.('.limites-pop')) clearTimeout(closing.current);
      else hide();
    };
    document.addEventListener('pointermove', move, true);
    return () => document.removeEventListener('pointermove', move, true);
  }, [open]);
  return (
    <div ref={box} className="seg fosforo limites" tabIndex={0} aria-label={t('panels.limit.title')}
      onMouseEnter={show} onFocus={show} onBlur={e => { if (!(e.relatedTarget as Element | null)?.closest?.('.limites, .limites-pop')) hide(); }}>
      <span className="semaforo" title={t('panels.limit.light')}>
        <span className={'luz ' + worst.light} />
        <span className="txt">{worst.window ? LIMIT_SHORT[worst.window] ?? t('panels.limit.shortOther') : ''}</span>
      </span>
      {types.map(w => {
        const l = limits[w], rejected = l?.status === 'rejected';
        return (
          <span key={w} className={'limit ' + limitLight(l, w, now) + (rejected ? ' agotado' : '')}>
            <span className="txt">{LIMIT_SHORT[w] ?? t('panels.limit.shortOther')}</span>
            <span className="n">{rejected ? t('panels.limit.reached') : l?.utilization == null ? '—' : Math.round(l.utilization) + '%'}</span>
          </span>
        );
      })}
      {r && createPortal(
        <div className="limites-pop" role="dialog" aria-label={t('panels.limit.title')} style={{ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) }}>
          <div className="limites-pop-titulo">{t('panels.limit.title')}</div>
          {types.map(w => <LimitWindow key={w} type={w} l={limits[w]} now={now} />)}
          <UsageGraph limits={limits} now={now} />
        </div>, document.body)}
    </div>
  );
}

// one window in the popover: its name and figure, the utilization chart over the window's time against the pace
// line (and the amber one at PACE_YELLOW times it), and the reset
const CHART_W = 240, CHART_H = 56;
function LimitWindow({ type, l, now }: { type: string; l: PlanLimit | undefined; now: number }) {
  const light = limitLight(l, type, now), name = limitName(type), pace = windowPace(type, l?.resetsAt ?? null, now);
  const figure = l?.status === 'rejected' ? t('panels.limit.reachedHint') : l?.utilization == null ? t('panels.limit.unknown')
    : pace != null ? t('panels.limit.usedVsPace', { p: Math.round(l.utilization), q: Math.round(pace * 100) }) : t('panels.limit.used', { p: Math.round(l.utilization) });
  const reset = l?.resetsAt ? describeReset(l.resetsAt, now) : null;
  const samples = l?.samples ?? [];
  // x: from the window's start to its reset (or, unknown, over the samples to now); y: 0-100 %
  const known = windowStart(type, l?.resetsAt ?? null), end = l?.resetsAt ?? now, start = known ?? samples[0]?.[0] ?? now - 3_600_000;
  const x = (ms: number) => ((Math.min(Math.max(ms, start), end) - start) / Math.max(1, end - start)) * CHART_W;
  const y = (u: number) => CHART_H - (Math.min(100, Math.max(0, u)) / 100) * CHART_H;
  const pts = [...samples, ...(l?.utilization != null && samples.length ? [[now, l.utilization] as [number, number]] : [])];
  const line = pts.map(([at, u]) => `${x(at).toFixed(1)},${y(u).toFixed(1)}`).join(' ');
  return (
    <div className={'limite-ventana ' + light}>
      <div className="limite-ventana-cab"><span className={'luz ' + light} /><b>{name}</b></div>
      <div className="dim limite-ventana-cifra">{figure}</div>
      {pts.length ? (
        <svg className="limite-grafica" viewBox={`0 0 ${CHART_W} ${CHART_H}`} width={CHART_W} height={CHART_H} role="img" aria-label={t('panels.limit.chart', { nombre: name })}>
          {known != null && <>
            <line className="ritmo" x1={0} y1={CHART_H} x2={CHART_W} y2={0}><title>{t('panels.limit.paceLine')}</title></line>
            <line className="ritmo yellow" x1={0} y1={CHART_H} x2={CHART_W / PACE_YELLOW} y2={0} />
          </>}
          <polygon className="area" points={`${x(pts[0][0]).toFixed(1)},${CHART_H} ${line} ${x(pts[pts.length - 1][0]).toFixed(1)},${CHART_H}`} />
          <polyline className="trazo" points={line} />
          <line className="ahora" x1={x(now)} x2={x(now)} y1={0} y2={CHART_H} />
        </svg>
      ) : <div className="dim limite-sin-muestras">{t('panels.limit.noSamples')}</div>}
      <div className="dim">{reset ? t('panels.limit.resets', { hora: reset.clock, cuando: reset.relative }) : t('panels.limit.noReset')}</div>
    </div>
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
    <div className="farewell interactivo">
      <div className="placa-despedida">{t('panels.restarting')}
        <small>{slow ? t('panels.theServerIsTakingA') : t('panels.terminalsStayOpenILl')}</small>
      </div>
    </div>
  );
}

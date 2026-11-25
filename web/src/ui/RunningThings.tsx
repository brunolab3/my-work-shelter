// The top bar's memory chip: the total memory of the game's processes and its dwellers' (with what they started),
// coloured against the threshold chosen in Options (memoryLight). Hovering or focusing it opens what is running, largest
// first, in sections: the game (with «Reload now» for its window when over the window's limit, memoryReload.ts), what
// Claude itself takes (each dweller's `claude`), the background jobs each one started (labelled with the dweller and its
// conversation, each with Stop) and the servers listening on a local port. The server reads the process
// table only when asked (server/runningThings.ts): once when the game loads and every few seconds while this is open.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@shared/language';
import { formatMb, memoryLight, RUNNING_REFRESH_MS, type DevServer, type GamePart, type ProcessInfo, type RunningSnapshot } from '@shared/runningThings';
import { client, live, addNotice } from '../net/client';
import { juego } from './gameState';
import { intercoms } from './Dialog';
import { memoryReloadButton, reloadForMemory, windowMemory } from './memoryReload';
import { formatAge, memoryThreshold, pollWhileOpen, shortCommand } from './runningList';
import { SFX } from '../audio/sound';

const PART: Record<GamePart, string> = {
  server: t('panels.running.part.server'), supervisor: t('panels.running.part.supervisor'), main: t('panels.running.part.main'),
  renderer: t('panels.running.part.renderer'), gpu: t('panels.running.part.gpu'), terminals: t('panels.running.part.terminals'), helper: '',
};

function dwellerName(sessionId: string) {
  if (!sessionId) return t('panels.running.unknownConversation');
  const s = live.get().sessions[sessionId];
  const g = juego.get();
  return [...g.dwellers, ...g.copies].find(h => h.id === s?.dwellerId)?.name ?? s?.title ?? sessionId;
}
// the dweller and its conversation: «Néstor · Running things indicator»
function who(sessionId: string) {
  const name = dwellerName(sessionId), title = live.get().sessions[sessionId]?.title;
  return title && title !== name ? `${name} · ${title}` : name;
}

export function RunningThings() {
  const [snap, setSnap] = useState<RunningSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const poll = useMemo(() => pollWhileOpen(() => client.action<RunningSnapshot>('processes').then(setSnap), RUNNING_REFRESH_MS), []);
  // once when the game loads, so the chip has a figure; afterwards only while open
  useEffect(() => { client.action<RunningSnapshot>('processes').then(setSnap).catch(() => {}); return () => poll.close(); }, [poll]);
  useEffect(() => { if (open) poll.open(); else poll.close(); }, [open, poll]);
  // the popover has buttons: moving onto it keeps it open
  const show = () => { clearTimeout(closing.current); setOpen(true); };
  const hide = () => { clearTimeout(closing.current); closing.current = setTimeout(() => setOpen(false), 250); };
  const light = memoryLight(snap?.totalMb, memoryThreshold());
  const r = open ? box.current?.getBoundingClientRect() : undefined;
  return (
    <div ref={box} className="seg phosphor processes" tabIndex={0} aria-label={t('panels.running.title')}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) hide(); }}>
      <span className={'light ' + light} />
      <span className="txt">{t('panels.running.short')}</span>
      <span className={'n ' + light}>{snap ? formatMb(snap.totalMb) : '—'}</span>
      {r && createPortal(
        <div className="processes-pop" role="dialog" aria-label={t('panels.running.title')} style={{ top: r.bottom + 6, right: Math.max(8, innerWidth - r.right) }}
          onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) hide(); }}>
          <div className="processes-pop-title">{t('panels.running.title')}</div>
          {!snap ? <div className="dim">{t('panels.running.reading')}</div> : <Lists snap={snap} />}
        </div>, document.body)}
    </div>
  );
}

function Lists({ snap }: { snap: RunningSnapshot }) {
  // the helpers as one line, where their memory puts it among the game's processes
  const helpersAt = snap.game.findIndex(p => p.mb < snap.helpers.mb);
  const gameRows = snap.game.map(p => <Row key={p.pid} p={p} name={PART[p.part]} />);
  if (snap.helpers.count) gameRows.splice(helpersAt < 0 ? gameRows.length : helpersAt, 0, <div key="helpers" className="process">
    <span className="process-name">{t('panels.running.helpers', { n: snap.helpers.count })}</span>
    <span className="process-mb">{formatMb(snap.helpers.mb)}</span><span /><span />
  </div>);
  return <>
    <div className="dim">{t('panels.running.total', { total: formatMb(snap.totalMb), threshold: formatMb(memoryThreshold()) })}</div>
    <section>
      <h4>{t('panels.running.game')} <span className="dim">{formatMb(snap.gameMb)}</span></h4>
      <WindowReload />
      {gameRows}
    </section>
    <section>
      <h4>{t('panels.running.claude')} <span className="dim">{formatMb(snap.dwellers.reduce((s, d) => s + d.mb, 0))}</span></h4>
      {!snap.dwellers.length && <div className="dim">{t('panels.running.noDwellers')}</div>}
      {snap.dwellers.map(d => <Row key={d.pid} p={d} name={who(d.sessionId)} />)}
    </section>
    <section>
      <h4>{t('panels.running.jobs')} <span className="dim">{formatMb(snap.dwellers.reduce((s, d) => s + d.children.reduce((t, c) => t + c.mb, 0), 0))}</span></h4>
      {!snap.dwellers.some(d => d.children.length) && <div className="dim">{t('panels.running.noJobs')}</div>}
      {snap.dwellers.filter(d => d.children.length).map(d => <React.Fragment key={d.pid}>
        <div className="process-of">{who(d.sessionId)}</div>
        {d.children.map(c => <Row key={c.pid} p={c} stoppable />)}
      </React.Fragment>)}
    </section>
    <section>
      <h4>{t('panels.running.devServers')}</h4>
      {!snap.devServers.length && <div className="dim">{t('panels.running.noDevServers')}</div>}
      {snap.devServers.map(p => <Row key={p.pid} p={p} by={by(p)} stoppable={p.sessionId != null} />)}
    </section>
  </>;
}

const by = (p: DevServer) => p.sessionId != null ? t('panels.running.startedBy', { who: who(p.sessionId) })
  : p.parent ? t('panels.running.startedBy', { who: shortCommand(p.parent.command) }) : undefined;

// one process: its name (the full command on hover), ports, memory and age; Stop asks once more before stopping
function Row({ p, name, by, stoppable }: { p: ProcessInfo; name?: string; by?: string; stoppable?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!confirm) return; const i = setTimeout(() => setConfirm(false), 4000); return () => clearTimeout(i); }, [confirm]);
  const stop = () => {
    if (!confirm) { setConfirm(true); SFX.tick(); return; }
    setConfirm(false); setStopping(true);
    client.action('processes.stop', { pid: p.pid }).catch(e => { setStopping(false); addNotice('error', (e as Error).message); });
  };
  return (
    <div className={'process' + (stopping ? ' stopping' : '')} style={{ paddingLeft: `${(p.depth ?? 0) * 0.9}em` }} title={p.command}>
      <span className="process-name">{name ?? shortCommand(p.command)}
        {p.ports?.length ? <span className="dim"> · {t('panels.running.ports', { ports: p.ports.join(', ') })}</span> : null}
        {by && <span className="dim"> · {by}</span>}
      </span>
      <span className="process-mb">{formatMb(p.mb)}</span>
      <span className="proceso-edad dim">{formatAge(p.ageS)}</span>
      {stoppable ? <button className={'process-stop' + (confirm ? ' confirm' : '')} disabled={stopping} onClick={stop}>
        {stopping ? t('panels.running.stopping') : confirm ? t('panels.running.confirmStop') : t('panels.running.stop')}
      </button> : <span />}
    </div>
  );
}

// the game window's renderer over its limit (memoryReload.ts): «Reload now», disabled with its reason during a turn or an upload
function WindowReload() {
  const mb = windowMemory.use(x => x.mb);
  live.use(x => x.sessions); intercoms.use(x => x.list);
  const b = memoryReloadButton();
  if (!b.show || mb == null) return null;
  return (
    <div className="process-reload">
      <span>{t('panels.running.window', { mb: formatMb(mb) })}</span>
      <button className="button-door" disabled={!!b.reason} onClick={() => reloadForMemory()} title={t('menu.memoryReloadKeeps')}>{t('menu.memoryReloadNow')}</button>
      {b.reason && <span className="dim">{t(b.reason)}</span>}
    </div>
  );
}

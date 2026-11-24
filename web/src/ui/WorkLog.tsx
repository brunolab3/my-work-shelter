// The «Sync update» panel in Planning: the work log (shared/workLog.ts, saved by server/workLog.ts), one line per task
// with its PRs, worktrees and conversations across every repo underneath, and a Markdown copy to paste in the sync update.
import React, { useEffect, useMemo, useState } from 'react';
import { t, locale } from '@shared/language';
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Keys, closePanel, useKeys } from './device';
import { goA } from './Panels';
import { openLink } from './Browsers';
import { openPreflight } from './Preflight';
import { taskColor } from '@shared/tasks';
import { knowTasks, useColorsTasks } from './tasks';
import { logRows, prRollup, prStateText, rangeStart, syncText, LOG_RANGES, type Ledger, type LogRange, type LogRow } from '@shared/workLog';
import type { CareerState, LadderProgress } from '@shared/trophies';

export interface WorkLogData { ledger: Ledger; demo: boolean; ladder: { source: 'local' | 'example' | 'none'; file: string; local: string; errors: string[] }; career: CareerState; progress?: LadderProgress }
export const readWorkLog = () => client.action<WorkLogData>('workLog.read', {});
/** The Overseer asks for the ladder's verification: a conversation with Planning's dweller, opened to follow it */
export const verifyLadder = () => client.action<{ roomId: string; dwellerId: string }>('ladder.verify', {}).then(r => { SFX.shortSuccess(); closePanel(); goA(r.roomId, r.dwellerId, true); });
// a plan-mode conversation with that dweller: it asks for the Overseer's instructions and proposes the ladder as a plan
export const draftLadder = () => client.action<{ roomId: string; dwellerId: string }>('ladder.draft', {}).then(r => { SFX.shortSuccess(); closePanel(); goA(r.roomId, r.dwellerId, true); });

const day = (ts: number) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const RANGE_TEXT: Record<LogRange, string> = { day: 'worklog.range.day', week: 'worklog.range.week', twoWeeks: 'worklog.range.twoWeeks', month: 'worklog.range.month', all: 'worklog.range.all' };

/** The two views of Planning's board, on top of both: the Jira board and Sync update (this log) */
export function PlanningModes({ active, onBoard, onUpdate }: { active: 'board' | 'update'; onBoard?: () => void; onUpdate?: () => void }) {
  return (
    <div className="modos-planning">
      <button className={active === 'board' ? 'activa' : ''} onClick={() => { if (active !== 'board') { SFX.click(); onBoard?.(); } }}>{t('worklog.mode.board')}</button>
      <button className={active === 'update' ? 'activa' : ''} onClick={() => { if (active !== 'update') { SFX.click(); onUpdate?.(); } }}>{t('worklog.mode.update')}</button>
    </div>
  );
}

export function WorkLog({ goBack, onBoard }: { goBack: () => void; onBoard: () => void }) {
  const [data, setData] = useState<WorkLogData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState<LogRange>('day');
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const load = () => readWorkLog().then(d => { setData(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => (data ? logRows(data.ledger, rangeStart(range, Date.now())) : []), [data, range]);
  useColorsTasks();
  useEffect(() => knowTasks(rows.map(r => r.key)), [rows]);
  const sel: LogRow | undefined = rows[Math.min(i, rows.length - 1)];
  const toggle = (k: string, v?: boolean) => setOpen(s => { const n = new Set(s); (v ?? !n.has(k)) ? n.add(k) : n.delete(k); return n; });
  const enter = (r?: LogRow) => { if (!r) return; SFX.click(); if (r.prs.length) openPreflight(r.key, document.querySelector('.bitacora-fila.sel')); else openLink(r.task?.url); };
  const copy = () => navigator.clipboard.writeText(syncText(rows)).then(() => { setNotice(t('worklog.copied', { n: rows.length })); SFX.shortSuccess(); }).catch(e => { setNotice(String(e?.message ?? e)); SFX.notAllowed(); });
  useKeys(e => {
    if (e.code === 'Escape') goBack();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, rows.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (sel) toggle(sel.key, true); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (sel) toggle(sel.key, false); }
    else if (e.code === 'Tab') { setRange(r => LOG_RANGES[(LOG_RANGES.indexOf(r) + (e.shiftKey ? LOG_RANGES.length - 1 : 1)) % LOG_RANGES.length]); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyX') { setOpen(s => (s.size ? new Set() : new Set(rows.map(r => r.key)))); SFX.toggle(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') enter(sel);
    else if (e.code === 'KeyC') copy();
    else if (e.code === 'KeyR') { load(); SFX.click(); }
    else return false;
  }, [rows, sel, range]);
  let keyless = false;
  return (
    <Device label={`${t('panels.planning')} · ${t('worklog.title')}${data?.demo ? ' · DEMO' : ''}`} width={92} height onClose={goBack}>
      <PlanningModes active="update" onBoard={onBoard} />
      <p className="voz">{t('worklog.intro')}</p>
      {data?.demo && <p className="tenue">{t('worklog.demo')}</p>}
      {error && <p className="aviso-consola">{error}</p>}
      {notice && <p className="aviso-consola">{notice}</p>}
      <div className="bitacora-periodos">{LOG_RANGES.map(r => <button key={r} className={r === range ? 'activa' : ''} onClick={() => { setRange(r); setI(0); }}>{t(RANGE_TEXT[r])}</button>)}</div>
      {!data && !error && <p className="tenue">{t('worklog.reading')}</p>}
      {data && !rows.length && <p className="tenue">{t('worklog.empty')}</p>}
      <ul className="bitacora">
        {rows.map((r, k) => {
          const head = !r.jira && !keyless; if (!r.jira) keyless = true;
          const expanded = open.has(r.key);
          return (
            <React.Fragment key={r.key}>
              {head && <li className="bitacora-grupo tenue">{t('worklog.noJira')}</li>}
              <li className={'bitacora-fila' + (k === i ? ' sel' : '')} style={{ '--tarea': taskColor(r.key) } as React.CSSProperties}
                onMouseEnter={() => setI(k)} onClick={() => toggle(r.key)} onDoubleClick={() => enter(r)}>
                <div className="bitacora-linea">
                  <span className="cursor">{expanded ? '▾' : '▸'}</span>
                  <b className="bitacora-clave">{r.key}</b>
                  <span className="bitacora-titulo">{r.task?.title ?? r.prs[0]?.title ?? ''}</span>
                  {r.task && <span className={'bitacora-estado c-' + r.task.category}>{r.task.state}</span>}
                  {r.prs.length > 0 && <span className="tenue">{prRollup(r.prs)}</span>}
                  {r.repos.length > 0 && <span className="tenue bitacora-repos">{r.repos.map(x => x.split('/').pop()).join(', ')}</span>}
                </div>
                {expanded && <ul className="bitacora-detalle">
                  {r.prs.map(p => <li key={p.ref} onClick={e => { e.stopPropagation(); openLink(p.url); }} className="enlace">
                    ⇄ {p.repo.split('/').pop()}#{p.number} {p.title} — {p.mergedAt ? t('worklog.mergedOn', { fecha: day(p.mergedAt) }) : prStateText(p.state)} · {day(p.updated)}</li>)}
                  {r.worktrees.map(w => <li key={w.path}>⎇ {w.roomId} · {w.branch ?? w.path.split('/').pop()} — {w.goneAt ? t('worklog.worktreeGone', { fecha: day(w.goneAt) }) : t('worklog.worktreeLive')}</li>)}
                  {r.conversations.map(c => <li key={c.claudeId}>💬 {c.title || c.claudeId.slice(0, 8)} · {c.roomId} · {day(c.last)}</li>)}
                </ul>}
              </li>
            </React.Fragment>
          );
        })}
      </ul>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>→←</kbd>{t('worklog.keyExpand')} <kbd>X</kbd>{t('worklog.keyAll')} <kbd>Tab</kbd>{t('worklog.keyRange')} <kbd>Enter</kbd>{t('worklog.keyOpen')} <kbd>C</kbd>{t('worklog.keyCopy')} <kbd>R</kbd>{t('panels.refresh')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

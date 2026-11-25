// The Review room's board (shared/reviews.ts, server/reviewRoom.ts): others' PRs that ask for the Overseer's review in
// three columns, one card per review (a task across repos, or a lone PR). Enter opens the review: its copies and its
// conversation, where its hologram stands in the room; X retires it (the PR stays on the board).
import React, { useState } from 'react';
import { live, client } from '../net/client';
import { juego } from './gameState';
import { SFX } from '../audio/sound';
import { t } from '@shared/language';
import { Device, Keys, closePanel, useKeys } from './device';
import { REVIEW_COLUMNS, type Review } from '@shared/reviews';
import { taskColor } from '@shared/tasks';
import { openLink } from './Browsers';
import { goA } from './Panels';
import { idCopy } from './copies';
import { useColorsTasks } from './tasks';

export const REVIEW_ROOM = 'review';

/** Opens a review (its copies and conversation) and goes to talk to its hologram once it stands in the room */
export async function openReview(key: string): Promise<void> {
  await client.action('review.open', { key });
  closePanel();
  for (let k = 0; k < 60; k++) {
    const folder = live.get().reviews.reviews.find(r => r.key === key)?.folder;
    if (folder && juego.get().copies.some(c => c.id === idCopy(folder))) { goA(REVIEW_ROOM, idCopy(folder), true); return; }
    await new Promise(r => setTimeout(r, 150));
  }
  goA(REVIEW_ROOM);
}

export function PanelReview() {
  const board = live.use(e => e.reviews);
  useColorsTasks();
  const columns = REVIEW_COLUMNS.map(id => ({ id, list: board.reviews.filter(r => r.column === id) }));
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [notice, setNotice] = useState('');
  const sel: Review | undefined = columns[col]?.list[Math.min(i, (columns[col]?.list.length ?? 1) - 1)];
  const open = (r?: Review) => { if (!r) return; SFX.click(); setNotice(t('reviews.reading')); openReview(r.key).catch(e => { setNotice(e.message); SFX.notAllowed(); }); };
  const done = (r?: Review) => { if (!r?.started) return; SFX.click(); client.action('review.finish', { key: r.key }).then(() => setNotice('')).catch(e => { setNotice(e.message); SFX.notAllowed(); }); };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(columns.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, (columns[col]?.list.length ?? 1) - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') open(sel);
    else if (e.code === 'KeyX') done(sel);
    else if (/^Digit[1-9]$/.test(e.code) && sel?.prs[+e.code.slice(5) - 1]) openLink(sel.prs[+e.code.slice(5) - 1].url);
  }, [columns, col, i, sel]);
  return (
    <Device label={t('reviews.title').toUpperCase()} width={96} height onClose={closePanel}>
      {notice && <p className="notice-console">{notice}</p>}
      {board.state === 'off' && <p className="voice">{t('reviews.noGithub')}</p>}
      {board.state === 'reading' && <p className="dim">{t('reviews.reading')}</p>}
      {board.error && <p className="dim">{board.error}</p>}
      <div className="kanban kanban-jira" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((c, ci) => (
          <div key={c.id} className={'kanban-col' + (ci === col ? ' active' : '')}>
            <h3>{t(`reviews.column.${c.id}`)} <span className="dim">{c.list.length}</span></h3>
            {c.list.map((r, k) => (
              <div key={r.key} className={'card-issue with-task' + (ci === col && k === Math.min(i, c.list.length - 1) ? ' sel' : '')} style={{ '--task': taskColor(r.key) } as React.CSSProperties}
                onMouseEnter={() => { setCol(ci); setI(k); }} onDoubleClick={() => open(r)}>
                <span className="mark-task" />{r.started && <span title={t('reviews.hologram')}>◉ </span>}<span className="ident">{r.key.includes('#') ? '' : r.key}</span> {r.title}
                {r.prs.map(p => (
                  <small key={p.url} className="dim row-pr-review">
                    <a href={p.url} onClick={e => { e.preventDefault(); openLink(p.url); }}>{p.repo}#{p.number}</a> · {t('reviews.byAuthor', { author: p.author })}{p.draft ? ` · ${t('reviews.draft')}` : ''}{p.column !== r.column ? ` · ${t(`reviews.column.${p.column}`)}` : ''}
                  </small>))}
                {r.missing && <small className="dim">{t('reviews.noRoom')}: {r.missing.join(', ')}</small>}
              </div>))}
            {!c.list.length && <p className="dim">{t('reviews.empty')}</p>}
          </div>
        ))}
      </div>
      {sel && <div className="button-bar">
        <button className="button-workshop" onClick={() => open(sel)} title={t('reviews.openHint')}>{sel.started ? t('reviews.continue') : t('reviews.open')}</button>
        {sel.started && <button className="button-workshop" onClick={() => done(sel)} title={t('reviews.doneHint')}>X · {t('reviews.done')}</button>}
        {sel.prs.slice(0, 9).map((p, k) => <button key={p.url} className="button-workshop" onClick={() => openLink(p.url)} title={p.title}>{k + 1} · {p.repo}#{p.number}</button>)}
      </div>}
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.task')} <kbd>Enter</kbd>{t('reviews.open')} {sel?.started && <><kbd>X</kbd>{t('reviews.done')} </>}{sel && <><kbd>1–{Math.min(9, sel.prs.length)}</kbd>{t('reviews.openPR')} </>}<kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

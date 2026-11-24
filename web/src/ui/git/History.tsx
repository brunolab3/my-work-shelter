// Historial del cliente de git: los commits con su grafo de ramas (carriles de colores), las ramas y etiquetas de
// cada uno y, al elegir uno, su mensaje entero, los archivos que tocó y el diff de cada archivo.
import React, { useEffect, useMemo, useState } from 'react';
import { client } from '../../net/client';
import { t, language } from '@shared/language';
import { lanes, type GraphRow } from './diff';
import { DiffViewer } from './DiffViewer';
import { ago, LETTER, type Letter } from './common';

interface CommitGit { hash: string; parents: string[]; author: string; email: string; date: number; subject: string; refs: string[] }
interface Detail { hash: string; parents: string[]; author: string; email: string; date: number; message: string; files: { letter: Letter; path: string; origin?: string; more: number | null; deletions: number | null }[] }

const COLORS = ['#39d353', '#58a6ff', '#ffb347', '#d2a8ff', '#ff7b72', '#56d4dd', '#e3b341', '#f778ba'];
const HEIGHT = 26, STEP = 13;
const fmtDate = new Intl.DateTimeFormat(language() === 'en' ? 'en-GB' : 'es-ES', { dateStyle: 'long', timeStyle: 'short' });

export function HistoryView({ path, signature, parallel, notify }: { path: string; signature: string; parallel: boolean; notify: (t: string, error?: boolean) => void }) {
  const [all, setAll] = useState(false);
  const [n, setN] = useState(300);
  const [data, setData] = useState<{ commits: CommitGit[]; more: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => { setData(null); setSel(null); }, [path]);
  useEffect(() => {
    let live = true;
    client.action<{ commits: CommitGit[]; more: boolean }>('git.log', { path, all, n }).then(d => { if (live) setData(d); }).catch(e => notify(e.message, true));
    return () => { live = false; };
  }, [path, all, n, signature]);
  const rows = useMemo(() => lanes(data?.commits ?? []), [data]);
  const graphWidth = Math.min(14, Math.max(1, ...rows.map(f => Math.max(f.before.length, f.after.length, f.column + 1)))) * STEP + 8;
  const q = filter.trim().toLowerCase();
  const visible = (data?.commits ?? []).map((c, i) => ({ c, f: rows[i] })).filter(({ c }) => !q || c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q) || c.refs.some(r => r.toLowerCase().includes(q)));
  return (
    <div className="gh-historial">
      <div className="gc-herramientas">
        <input className="gc-filtro" placeholder={t('windows.filterByMessageAuthorHash')} value={filter} onChange={e => setFilter(e.target.value)} />
        <label className="gc-casilla"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {t('windows.allBranches')}</label>
        <span className="dim">{data ? t('windows.nCommits', { n: `${data.commits.length}${data.more ? '+' : ''}` }) : t('windows.reading2')}</span>
      </div>
      <div className={'gh-cuerpo' + (sel ? ' con-detalle' : '')}>
        <div className="gh-lista">
          {visible.map(({ c, f }) => (
            <div key={c.hash} className={'gh-fila' + (c.hash === sel ? ' active' : '')} onClick={() => setSel(c.hash === sel ? null : c.hash)}>
              {!q && <Graph f={f} width={graphWidth} merge={c.parents.length > 1} />}
              <span className="gh-asunto">
                {c.refs.map(r => <span key={r} className={'gh-ref' + (r.startsWith('HEAD') ? ' cabeza' : r.startsWith('tag: ') ? ' de-etiqueta' : r.includes('/') && !r.startsWith('HEAD') ? ' remota' : '')}>{r.replace('tag: ', '🏷 ')}</span>)}
                {c.subject}
              </span>
              <span className="gh-autor">{c.author}</span>
              <span className="gh-cuando" title={fmtDate.format(c.date)}>{ago(c.date)}</span>
              <span className="gh-hash">{c.hash.slice(0, 7)}</span>
            </div>
          ))}
          {data && !data.commits.length && <div className="gd-vacio">{t('windows.thisRepoHasNoCommits')}</div>}
          {data?.more && !q && <button className="gd-todo" onClick={() => setN(x => x + 300)}>{t('windows.loadMoreCommits')}</button>}
        </div>
        {sel && <DetailCommit path={path} hash={sel} parallel={parallel} notify={notify} close={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Graph({ f, width, merge }: { f: GraphRow; width: number; merge: boolean }) {
  const x = (k: number) => 6 + k * STEP + STEP / 2, m = HEIGHT / 2;
  const color = (k: number) => COLORS[k % COLORS.length];
  return (
    <svg className="gh-grafo" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
      {f.before.map((h, j) => h === null ? null : f.arrive.includes(j)
        ? <path key={'a' + j} d={`M${x(j)} 0 C${x(j)} ${m * 0.7} ${x(f.column)} ${m * 0.3} ${x(f.column)} ${m}`} stroke={color(j)} />
        : <line key={'a' + j} x1={x(j)} y1={0} x2={x(j)} y2={HEIGHT} stroke={color(j)} />)}
      {f.leave.map(k => <path key={'s' + k} d={k === f.column ? `M${x(k)} ${m} L${x(k)} ${HEIGHT}` : `M${x(f.column)} ${m} C${x(f.column)} ${m + m * 0.7} ${x(k)} ${m + m * 0.3} ${x(k)} ${HEIGHT}`} stroke={color(k)} />)}
      <circle cx={x(f.column)} cy={m} r={merge ? 4.5 : 3.8} fill={merge ? '#0d1117' : color(f.column)} stroke={color(f.column)} strokeWidth={merge ? 2 : 0} />
    </svg>
  );
}

function DetailCommit({ path, hash, parallel, notify, close }: { path: string; hash: string; parallel: boolean; notify: (t: string, error?: boolean) => void; close: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [file, setFile] = useState<Detail['files'][number] | null>(null);
  const [diff, setDiff] = useState<{ text: string; binary: boolean; truncated: boolean } | null>(null);
  useEffect(() => { setD(null); setFile(null); client.action<Detail>('git.detail', { path, hash }).then(x => { setD(x); setFile(x.files[0] ?? null); }).catch(e => notify(e.message, true)); }, [path, hash]);
  useEffect(() => { setDiff(null); if (file) client.action<any>('git.diffCommit', { path, hash, file: file.path, origin: file.origin }).then(setDiff).catch(e => notify(e.message, true)); }, [file?.path, hash]);
  if (!d) return <div className="gh-detalle"><div className="gd-vacio">{t('windows.readingTheCommit')}</div></div>;
  const [subject, ...body] = d.message.split('\n');
  const copy = () => navigator.clipboard?.writeText(d.hash).then(() => notify(t('windows.hashCopiedHash', { hash: d.hash.slice(0, 10) })));
  return (
    <div className="gh-detalle">
      <div className="gh-detalle-cab">
        <div>
          <b>{subject}</b>
          {body.join('\n').trim() && <pre className="gh-cuerpo-msg">{body.join('\n').trim()}</pre>}
          <div className="dim">{d.author} &lt;{d.email}&gt; · {fmtDate.format(d.date)} · <button className="gc-enlace" onClick={copy} title={t('windows.copyTheFullHash')}>{d.hash.slice(0, 10)}</button>{d.parents.length > 1 ? ` · ${t('windows.merge')}` : ''}</div>
        </div>
        <button className="gc-boton icono" onClick={close} title={t('windows.closeDetails')}>×</button>
      </div>
      <div className="gh-detalle-cuerpo">
        <ul className="gh-archivos">
          {d.files.map(a => (
            <li key={a.path} className={a.path === file?.path ? 'active' : ''} onClick={() => setFile(a)} title={a.origin ? `${a.origin} → ${a.path}` : a.path}>
              <span className={'gc-letra l-' + a.letter}>{a.letter}</span>
              <span className="gc-nombre">{a.path.split('/').pop()}</span>
              <span className="gh-stat">{a.more === null ? 'bin' : <><i className="plus">+{a.more}</i> <i className="minus">−{a.deletions}</i></>}</span>
            </li>
          ))}
          {!d.files.length && <li className="dim">{t('windows.noFileChanges')}</li>}
        </ul>
        <div className="gh-diff">{file && (diff ? <DiffViewer text={diff.text} binary={diff.binary} truncated={diff.truncated} mode="commit" parallel={parallel} /> : <div className="gd-vacio">{t('windows.reading')}</div>)}</div>
      </div>
    </div>
  );
}

export { LETTER };

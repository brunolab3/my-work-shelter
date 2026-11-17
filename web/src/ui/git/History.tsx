// Historial del cliente de git: los commits con su grafo de ramas (carriles de colores), las ramas y etiquetas de
// cada uno y, al elegir uno, su mensaje entero, los archivos que tocó y el diff de cada archivo.
import React, { useEffect, useMemo, useState } from 'react';
import { cliente } from '../../red/cliente';
import { t, idioma } from '@shared/idioma';
import { lanes, type GraphRow } from './diff';
import { VisorDiff } from './VisorDiff';
import { hace, LETTER, type Letter } from './comun';

interface CommitGit { hash: string; parents: string[]; autor: string; correo: string; fecha: number; asunto: string; refs: string[] }
interface Detail { hash: string; parents: string[]; autor: string; correo: string; fecha: number; mensaje: string; archivos: { letra: Letter; ruta: string; origen?: string; mas: number | null; menos: number | null }[] }

const COLORS = ['#39d353', '#58a6ff', '#ffb347', '#d2a8ff', '#ff7b72', '#56d4dd', '#e3b341', '#f778ba'];
const HEIGHT = 26, STEP = 13;
const fmtDate = new Intl.DateTimeFormat(idioma() === 'en' ? 'en-GB' : 'es-ES', { dateStyle: 'long', timeStyle: 'short' });

export function Historial({ ruta, firma, paralelo, avisar }: { ruta: string; firma: string; paralelo: boolean; avisar: (t: string, error?: boolean) => void }) {
  const [todas, setAll] = useState(false);
  const [n, setN] = useState(300);
  const [datos, setDatos] = useState<{ commits: CommitGit[]; mas: boolean } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFilter] = useState('');
  useEffect(() => { setDatos(null); setSel(null); }, [ruta]);
  useEffect(() => {
    let vivo = true;
    cliente.accion<{ commits: CommitGit[]; mas: boolean }>('git.historial', { ruta, todas, n }).then(d => { if (vivo) setDatos(d); }).catch(e => avisar(e.message, true));
    return () => { vivo = false; };
  }, [ruta, todas, n, firma]);
  const filas = useMemo(() => lanes(datos?.commits ?? []), [datos]);
  const graphWidth = Math.min(14, Math.max(1, ...filas.map(f => Math.max(f.antes.length, f.after.length, f.columna + 1)))) * STEP + 8;
  const q = filtro.trim().toLowerCase();
  const visibles = (datos?.commits ?? []).map((c, i) => ({ c, f: filas[i] })).filter(({ c }) => !q || c.asunto.toLowerCase().includes(q) || c.autor.toLowerCase().includes(q) || c.hash.startsWith(q) || c.refs.some(r => r.toLowerCase().includes(q)));
  return (
    <div className="gh-historial">
      <div className="gc-herramientas">
        <input className="gc-filtro" placeholder={t('windows.filterByMessageAuthorHash')} value={filtro} onChange={e => setFilter(e.target.value)} />
        <label className="gc-casilla"><input type="checkbox" checked={todas} onChange={e => setAll(e.target.checked)} /> {t('windows.allBranches')}</label>
        <span className="tenue">{datos ? t('windows.nCommits', { n: `${datos.commits.length}${datos.mas ? '+' : ''}` }) : t('windows.reading2')}</span>
      </div>
      <div className={'gh-cuerpo' + (sel ? ' con-detalle' : '')}>
        <div className="gh-lista">
          {visibles.map(({ c, f }) => (
            <div key={c.hash} className={'gh-fila' + (c.hash === sel ? ' activa' : '')} onClick={() => setSel(c.hash === sel ? null : c.hash)}>
              {!q && <Graph f={f} ancho={graphWidth} merge={c.parents.length > 1} />}
              <span className="gh-asunto">
                {c.refs.map(r => <span key={r} className={'gh-ref' + (r.startsWith('HEAD') ? ' cabeza' : r.startsWith('tag: ') ? ' de-etiqueta' : r.includes('/') && !r.startsWith('HEAD') ? ' remota' : '')}>{r.replace('tag: ', '🏷 ')}</span>)}
                {c.asunto}
              </span>
              <span className="gh-autor">{c.autor}</span>
              <span className="gh-cuando" title={fmtDate.format(c.fecha)}>{hace(c.fecha)}</span>
              <span className="gh-hash">{c.hash.slice(0, 7)}</span>
            </div>
          ))}
          {datos && !datos.commits.length && <div className="gd-vacio">{t('windows.thisRepoHasNoCommits')}</div>}
          {datos?.mas && !q && <button className="gd-todo" onClick={() => setN(x => x + 300)}>{t('windows.loadMoreCommits')}</button>}
        </div>
        {sel && <DetailCommit ruta={ruta} hash={sel} paralelo={paralelo} avisar={avisar} cerrar={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Graph({ f, ancho, merge }: { f: GraphRow; ancho: number; merge: boolean }) {
  const x = (k: number) => 6 + k * STEP + STEP / 2, m = HEIGHT / 2;
  const color = (k: number) => COLORS[k % COLORS.length];
  return (
    <svg className="gh-grafo" width={ancho} height={HEIGHT} viewBox={`0 0 ${ancho} ${HEIGHT}`}>
      {f.antes.map((h, j) => h === null ? null : f.arrive.includes(j)
        ? <path key={'a' + j} d={`M${x(j)} 0 C${x(j)} ${m * 0.7} ${x(f.columna)} ${m * 0.3} ${x(f.columna)} ${m}`} stroke={color(j)} />
        : <line key={'a' + j} x1={x(j)} y1={0} x2={x(j)} y2={HEIGHT} stroke={color(j)} />)}
      {f.salen.map(k => <path key={'s' + k} d={k === f.columna ? `M${x(k)} ${m} L${x(k)} ${HEIGHT}` : `M${x(f.columna)} ${m} C${x(f.columna)} ${m + m * 0.7} ${x(k)} ${m + m * 0.3} ${x(k)} ${HEIGHT}`} stroke={color(k)} />)}
      <circle cx={x(f.columna)} cy={m} r={merge ? 4.5 : 3.8} fill={merge ? '#0d1117' : color(f.columna)} stroke={color(f.columna)} strokeWidth={merge ? 2 : 0} />
    </svg>
  );
}

function DetailCommit({ ruta, hash, paralelo, avisar, cerrar }: { ruta: string; hash: string; paralelo: boolean; avisar: (t: string, error?: boolean) => void; cerrar: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [archivo, setFile] = useState<Detail['archivos'][number] | null>(null);
  const [diff, setDiff] = useState<{ texto: string; binario: boolean; recortado: boolean } | null>(null);
  useEffect(() => { setD(null); setFile(null); cliente.accion<Detail>('git.detalle', { ruta, hash }).then(x => { setD(x); setFile(x.archivos[0] ?? null); }).catch(e => avisar(e.message, true)); }, [ruta, hash]);
  useEffect(() => { setDiff(null); if (archivo) cliente.accion<any>('git.diffCommit', { ruta, hash, archivo: archivo.ruta, origen: archivo.origen }).then(setDiff).catch(e => avisar(e.message, true)); }, [archivo?.ruta, hash]);
  if (!d) return <div className="gh-detalle"><div className="gd-vacio">{t('windows.readingTheCommit')}</div></div>;
  const [asunto, ...cuerpo] = d.mensaje.split('\n');
  const copiar = () => navigator.clipboard?.writeText(d.hash).then(() => avisar(t('windows.hashCopiedHash', { hash: d.hash.slice(0, 10) })));
  return (
    <div className="gh-detalle">
      <div className="gh-detalle-cab">
        <div>
          <b>{asunto}</b>
          {cuerpo.join('\n').trim() && <pre className="gh-cuerpo-msg">{cuerpo.join('\n').trim()}</pre>}
          <div className="tenue">{d.autor} &lt;{d.correo}&gt; · {fmtDate.format(d.fecha)} · <button className="gc-enlace" onClick={copiar} title={t('windows.copyTheFullHash')}>{d.hash.slice(0, 10)}</button>{d.parents.length > 1 ? ` · ${t('windows.merge')}` : ''}</div>
        </div>
        <button className="gc-boton icono" onClick={cerrar} title={t('windows.closeDetails')}>×</button>
      </div>
      <div className="gh-detalle-cuerpo">
        <ul className="gh-archivos">
          {d.archivos.map(a => (
            <li key={a.ruta} className={a.ruta === archivo?.ruta ? 'activa' : ''} onClick={() => setFile(a)} title={a.origen ? `${a.origen} → ${a.ruta}` : a.ruta}>
              <span className={'gc-letra l-' + a.letra}>{a.letra}</span>
              <span className="gc-nombre">{a.ruta.split('/').pop()}</span>
              <span className="gh-stat">{a.mas === null ? 'bin' : <><i className="mas">+{a.mas}</i> <i className="menos">−{a.menos}</i></>}</span>
            </li>
          ))}
          {!d.archivos.length && <li className="tenue">{t('windows.noFileChanges')}</li>}
        </ul>
        <div className="gh-diff">{archivo && (diff ? <VisorDiff texto={diff.texto} binario={diff.binario} recortado={diff.recortado} modo="commit" paralelo={paralelo} /> : <div className="gd-vacio">{t('windows.reading')}</div>)}</div>
      </div>
    </div>
  );
}

export { LETTER };

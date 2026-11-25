// Visor de diffs del cliente de git: unificado o en paralelo, con números de línea a cada lado y lo que cambia dentro
// de cada línea marcado. Con cambios de la copia de trabajo o preparados, cada bloque lleva sus botones (preparar,
// descartar o quitar) y se pueden elegir líneas sueltas: clic en el margen (⇧ clic, un tramo) y la barra de abajo
// prepara, descarta o quita solo esas.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@shared/language';
import { readDiff, assemblePatch, chunksAccepts, inParallel, linePairs, changeInLine, type Block, type Line } from './diff';

export type ModeDiff = 'changes' | 'staged' | 'commit';
export type PatchThat = 'stage' | 'unstage' | 'discard';
interface Props { text: string; binary?: boolean; truncated?: boolean; mode: ModeDiff; parallel: boolean; busy?: boolean; onApply?: (patch: string, what: PatchThat, howMuch: string) => void }

const MAX_LINES = 4000;

export function DiffViewer({ text, binary, truncated, mode, parallel, busy, onApply }: Props) {
  const d = useMemo(() => readDiff(text), [text]);
  const chunks = mode !== 'commit' && !!onApply && chunksAccepts(d);
  // líneas elegidas: bloque → índices de línea
  const [picked, setChosen] = useState<Map<number, Set<number>>>(new Map());
  const anchor = useRef<{ b: number; i: number } | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { setChosen(new Map()); anchor.current = null; }, [text]);
  const nChosen = [...picked.values()].reduce((s, x) => s + x.size, 0);

  const pick = (b: number, i: number, segment: boolean) => {
    if (!chunks) return;
    const bl = d.blocks[b]; if (!bl || bl.lines[i].type === ' ' || bl.lines[i].type === '\\') return;
    setChosen(prev => {
      const m = new Map(prev); const s = new Set(m.get(b) ?? []);
      if (segment && anchor.current?.b === b) {
        const [a, z] = [Math.min(anchor.current.i, i), Math.max(anchor.current.i, i)];
        for (let k = a; k <= z; k++) if (bl.lines[k].type === '+' || bl.lines[k].type === '-') s.add(k);
      } else if (s.has(i)) s.delete(i); else s.add(i);
      if (s.size) m.set(b, s); else m.delete(b);
      return m;
    });
    anchor.current = { b, i };
  };
  const apply = (blocks: number[], what: PatchThat, howMuch: string, sel?: Map<number, Set<number>>) => {
    const p = assemblePatch(d, blocks, what === 'stage' ? 'forward' : 'back', sel);
    if (p && onApply) onApply(p, what, howMuch);
  };
  const applyChosen = (what: PatchThat) => apply([...picked.keys()], what, nChosen === 1 ? t('windows.1Line') : t('windows.nLines', { n: nChosen }), picked);

  if (binary) return <div className="gd-empty">{t('windows.binaryFileNoDiffTo')}</div>;
  if (!d.blocks.length) return <div className="gd-empty">{d.header.some(l => l.startsWith('old mode')) ? t('windows.onlyTheFilePermissionsChanged') : d.renamed ? t('windows.renamedWithNoContentChanges') : text.trim() ? t('windows.noContentChanges') : t('windows.emptyFile')}</div>;

  let remaining = all ? Infinity : MAX_LINES;
  return (
    <div className={'gd' + (parallel ? ' parallel' : '') + (chunks ? ' with-chunks' : '')}>
      {truncated && <div className="gd-notice">{t('windows.theDiffIsHugeAnd')}</div>}
      {d.blocks.map((b, bi) => {
        if (remaining <= 0) return null;
        const cut = b.lines.length > remaining; remaining -= b.lines.length;
        return (
          <section key={bi} className="gd-block">
            <header className="gd-header">
              <span className="gd-at">@@ −{b.startOld},{b.oldN} +{b.newStart},{b.newN} @@</span>
              <span className="gd-context">{b.context}</span>
              {chunks && <span className="gd-buttons">
                {mode === 'changes' && <button disabled={busy} onClick={() => apply([bi], 'discard', t('windows.theHunk'))} title={t('windows.revertsThisHunkInThe')}>{t('windows.discardHunk')}</button>}
                {mode === 'changes' && <button disabled={busy} className="main" onClick={() => apply([bi], 'stage', t('windows.theHunk'))} title={t('windows.stageThisHunkForThe')}>{t('windows.stageHunk')}</button>}
                {mode === 'staged' && <button disabled={busy} onClick={() => apply([bi], 'unstage', t('windows.theHunk'))} title={t('windows.removesItFromTheStaged')}>{t('windows.unstageHunk')}</button>}
              </span>}
            </header>
            {parallel ? <Parallel b={b} bi={bi} picked={picked.get(bi)} pick={pick} cut={cut ? b.lines.length + remaining : undefined} />
              : <Unified b={b} bi={bi} picked={picked.get(bi)} pick={pick} cut={cut ? b.lines.length + remaining : undefined} />}
          </section>
        );
      })}
      {remaining <= 0 && !all && <button className="gd-all" onClick={() => setAll(true)}>{t('windows.showTheWholeDiffIt')}</button>}
      {chunks && nChosen > 0 && (
        <div className="gd-choice">
          <span>{nChosen === 1 ? t('windows.1LineSelected') : t('windows.nLinesSelected', { n: nChosen })}</span>
          {mode === 'changes' && <button disabled={busy} className="main" onClick={() => applyChosen('stage')}>{t('windows.stage')}</button>}
          {mode === 'changes' && <button disabled={busy} onClick={() => applyChosen('discard')}>{t('windows.discard2')}</button>}
          {mode === 'staged' && <button disabled={busy} onClick={() => applyChosen('unstage')}>{t('windows.unstage')}</button>}
          <button onClick={() => setChosen(new Map())} title={t('windows.clearSelection')}>×</button>
        </div>
      )}
      {chunks && !nChosen && <div className="gd-hint">{t('windows.clickInTheGutterOf')}</div>}
    </div>
  );
}

// el texto de una línea con lo que cambia dentro marcado
function LocalizedText({ l, other }: { l: Line; other?: Line }) {
  const c = other ? changeInLine(l.type === '-' ? l.text : other.text, l.type === '-' ? other.text : l.text) : null;
  if (!c) return <>{l.text || ' '}</>;
  const [a, z] = l.type === '-' ? c.a : c.b;
  return <>{l.text.slice(0, a)}<mark>{l.text.slice(a, z)}</mark>{l.text.slice(z)}</>;
}
const KIND: Record<string, string> = { '+': 'plus', '-': 'minus', ' ': 'ctx', '\\': 'note' };

interface PropsBlock { b: Block; bi: number; picked?: Set<number>; pick: (b: number, i: number, segment: boolean) => void; cut?: number }
function Unified({ b, bi, picked, pick, cut }: PropsBlock) {
  const pairs = useMemo(() => linePairs(b), [b]);
  const lines = cut !== undefined ? b.lines.slice(0, cut) : b.lines;
  return (
    <table className="gd-table"><tbody>
      {lines.map((l, i) => (
        <tr key={i} className={'gd-l ' + KIND[l.type] + (picked?.has(i) ? ' chosen' : '')}>
          <td className="gd-n" onClick={e => pick(bi, i, e.shiftKey)}>{l.old ?? ''}</td>
          <td className="gd-n" onClick={e => pick(bi, i, e.shiftKey)}>{l.newer ?? ''}</td>
          <td className="gd-sign" onClick={e => pick(bi, i, e.shiftKey)}>{l.type === '\\' ? '' : l.type}</td>
          <td className="gd-c">{l.type === '\\' ? l.text.slice(2) : <LocalizedText l={l} other={pairs.has(i) ? b.lines[pairs.get(i)!] : undefined} />}</td>
        </tr>
      ))}
    </tbody></table>
  );
}

function Parallel({ b, bi, picked, pick, cut }: PropsBlock) {
  const rows = useMemo(() => inParallel(b), [b]);
  const vis = cut !== undefined ? rows.slice(0, cut) : rows;
  const side = (l: (Line & { i: number }) | undefined, other: (Line & { i: number }) | undefined, n: number | undefined) => l
    ? <>
        <td className={'gd-n ' + KIND[l.type] + (picked?.has(l.i) ? ' chosen' : '')} onClick={e => pick(bi, l.i, e.shiftKey)}>{n ?? ''}</td>
        <td className={'gd-c ' + KIND[l.type] + (picked?.has(l.i) ? ' chosen' : '')}><LocalizedText l={l} other={l.type !== ' ' && other && other.type !== ' ' ? other : undefined} /></td>
      </>
    : <><td className="gd-n gap" /><td className="gd-c gap" /></>;
  return (
    <table className="gd-table"><tbody>
      {vis.map((f, k) => <tr key={k} className="gd-l">{side(f.left, f.right, f.left?.old)}{side(f.right, f.left, f.right?.newer)}</tr>)}
    </tbody></table>
  );
}

// Visor de diffs del cliente de git: unificado o en paralelo, con números de línea a cada lado y lo que cambia dentro
// de cada línea marcado. Con cambios de la copia de trabajo o preparados, cada bloque lleva sus botones (preparar,
// descartar o quitar) y se pueden elegir líneas sueltas: clic en el margen (⇧ clic, un tramo) y la barra de abajo
// prepara, descarta o quita solo esas.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@shared/idioma';
import { readDiff, assemblePatch, chunksAccepts, inParallel, parejas, changeInLine, type Block, type Linea } from './diff';

export type ModeDiff = 'cambios' | 'preparados' | 'commit';
export type PatchThat = 'preparar' | 'quitar' | 'descartar';
interface Props { texto: string; binario?: boolean; recortado?: boolean; modo: ModeDiff; paralelo: boolean; ocupado?: boolean; onApply?: (parche: string, que: PatchThat, howMuch: string) => void }

const MAX_LINES = 4000;

export function VisorDiff({ texto, binario, recortado, modo, paralelo, ocupado, onApply }: Props) {
  const d = useMemo(() => readDiff(texto), [texto]);
  const trozos = modo !== 'commit' && !!onApply && chunksAccepts(d);
  // líneas elegidas: bloque → índices de línea
  const [elegidas, setChosen] = useState<Map<number, Set<number>>>(new Map());
  const anchor = useRef<{ b: number; i: number } | null>(null);
  const [todo, setTodo] = useState(false);
  useEffect(() => { setChosen(new Map()); anchor.current = null; }, [texto]);
  const nChosen = [...elegidas.values()].reduce((s, x) => s + x.size, 0);

  const elegir = (b: number, i: number, segment: boolean) => {
    if (!trozos) return;
    const bl = d.blocks[b]; if (!bl || bl.lineas[i].tipo === ' ' || bl.lineas[i].tipo === '\\') return;
    setChosen(prev => {
      const m = new Map(prev); const s = new Set(m.get(b) ?? []);
      if (segment && anchor.current?.b === b) {
        const [a, z] = [Math.min(anchor.current.i, i), Math.max(anchor.current.i, i)];
        for (let k = a; k <= z; k++) if (bl.lineas[k].tipo === '+' || bl.lineas[k].tipo === '-') s.add(k);
      } else if (s.has(i)) s.delete(i); else s.add(i);
      if (s.size) m.set(b, s); else m.delete(b);
      return m;
    });
    anchor.current = { b, i };
  };
  const aplicar = (blocks: number[], que: PatchThat, howMuch: string, sel?: Map<number, Set<number>>) => {
    const p = assemblePatch(d, blocks, que === 'preparar' ? 'adelante' : 'atras', sel);
    if (p && onApply) onApply(p, que, howMuch);
  };
  const applyChosen = (que: PatchThat) => aplicar([...elegidas.keys()], que, nChosen === 1 ? t('windows.1Line') : t('windows.nLines', { n: nChosen }), elegidas);

  if (binario) return <div className="gd-vacio">{t('windows.binaryFileNoDiffTo')}</div>;
  if (!d.blocks.length) return <div className="gd-vacio">{d.cabecera.some(l => l.startsWith('old mode')) ? t('windows.onlyTheFilePermissionsChanged') : d.renombrado ? t('windows.renamedWithNoContentChanges') : texto.trim() ? t('windows.noContentChanges') : t('windows.emptyFile')}</div>;

  let remaining = todo ? Infinity : MAX_LINES;
  return (
    <div className={'gd' + (paralelo ? ' paralelo' : '') + (trozos ? ' con-trozos' : '')}>
      {recortado && <div className="gd-aviso">{t('windows.theDiffIsHugeAnd')}</div>}
      {d.blocks.map((b, bi) => {
        if (remaining <= 0) return null;
        const cut = b.lineas.length > remaining; remaining -= b.lineas.length;
        return (
          <section key={bi} className="gd-bloque">
            <header className="gd-cab">
              <span className="gd-arroba">@@ −{b.startOld},{b.oldN} +{b.newStart},{b.newN} @@</span>
              <span className="gd-contexto">{b.contexto}</span>
              {trozos && <span className="gd-botones">
                {modo === 'cambios' && <button disabled={ocupado} onClick={() => aplicar([bi], 'descartar', t('windows.theHunk'))} title={t('windows.revertsThisHunkInThe')}>{t('windows.discardHunk')}</button>}
                {modo === 'cambios' && <button disabled={ocupado} className="principal" onClick={() => aplicar([bi], 'preparar', t('windows.theHunk'))} title={t('windows.stageThisHunkForThe')}>{t('windows.stageHunk')}</button>}
                {modo === 'preparados' && <button disabled={ocupado} onClick={() => aplicar([bi], 'quitar', t('windows.theHunk'))} title={t('windows.removesItFromTheStaged')}>{t('windows.unstageHunk')}</button>}
              </span>}
            </header>
            {paralelo ? <Parallel b={b} bi={bi} elegidas={elegidas.get(bi)} elegir={elegir} cut={cut ? b.lineas.length + remaining : undefined} />
              : <Unified b={b} bi={bi} elegidas={elegidas.get(bi)} elegir={elegir} cut={cut ? b.lineas.length + remaining : undefined} />}
          </section>
        );
      })}
      {remaining <= 0 && !todo && <button className="gd-todo" onClick={() => setTodo(true)}>{t('windows.showTheWholeDiffIt')}</button>}
      {trozos && nChosen > 0 && (
        <div className="gd-eleccion">
          <span>{nChosen === 1 ? t('windows.1LineSelected') : t('windows.nLinesSelected', { n: nChosen })}</span>
          {modo === 'cambios' && <button disabled={ocupado} className="principal" onClick={() => applyChosen('preparar')}>{t('windows.stage')}</button>}
          {modo === 'cambios' && <button disabled={ocupado} onClick={() => applyChosen('descartar')}>{t('windows.discard2')}</button>}
          {modo === 'preparados' && <button disabled={ocupado} onClick={() => applyChosen('quitar')}>{t('windows.unstage')}</button>}
          <button onClick={() => setChosen(new Map())} title={t('windows.clearSelection')}>×</button>
        </div>
      )}
      {trozos && !nChosen && <div className="gd-pista">{t('windows.clickInTheGutterOf')}</div>}
    </div>
  );
}

// el texto de una línea con lo que cambia dentro marcado
function Texto({ l, otra }: { l: Linea; otra?: Linea }) {
  const c = otra ? changeInLine(l.tipo === '-' ? l.texto : otra.texto, l.tipo === '-' ? otra.texto : l.texto) : null;
  if (!c) return <>{l.texto || ' '}</>;
  const [a, z] = l.tipo === '-' ? c.a : c.b;
  return <>{l.texto.slice(0, a)}<mark>{l.texto.slice(a, z)}</mark>{l.texto.slice(z)}</>;
}
const KIND: Record<string, string> = { '+': 'mas', '-': 'menos', ' ': 'ctx', '\\': 'nota' };

interface PropsBlock { b: Block; bi: number; elegidas?: Set<number>; elegir: (b: number, i: number, segment: boolean) => void; cut?: number }
function Unified({ b, bi, elegidas, elegir, cut }: PropsBlock) {
  const pairs = useMemo(() => parejas(b), [b]);
  const lineas = cut !== undefined ? b.lineas.slice(0, cut) : b.lineas;
  return (
    <table className="gd-tabla"><tbody>
      {lineas.map((l, i) => (
        <tr key={i} className={'gd-l ' + KIND[l.tipo] + (elegidas?.has(i) ? ' elegida' : '')}>
          <td className="gd-n" onClick={e => elegir(bi, i, e.shiftKey)}>{l.viejo ?? ''}</td>
          <td className="gd-n" onClick={e => elegir(bi, i, e.shiftKey)}>{l.nuevo ?? ''}</td>
          <td className="gd-signo" onClick={e => elegir(bi, i, e.shiftKey)}>{l.tipo === '\\' ? '' : l.tipo}</td>
          <td className="gd-c">{l.tipo === '\\' ? l.texto.slice(2) : <Texto l={l} otra={pairs.has(i) ? b.lineas[pairs.get(i)!] : undefined} />}</td>
        </tr>
      ))}
    </tbody></table>
  );
}

function Parallel({ b, bi, elegidas, elegir, cut }: PropsBlock) {
  const filas = useMemo(() => inParallel(b), [b]);
  const vis = cut !== undefined ? filas.slice(0, cut) : filas;
  const lado = (l: (Linea & { i: number }) | undefined, otra: (Linea & { i: number }) | undefined, n: number | undefined) => l
    ? <>
        <td className={'gd-n ' + KIND[l.tipo] + (elegidas?.has(l.i) ? ' elegida' : '')} onClick={e => elegir(bi, l.i, e.shiftKey)}>{n ?? ''}</td>
        <td className={'gd-c ' + KIND[l.tipo] + (elegidas?.has(l.i) ? ' elegida' : '')}><Texto l={l} otra={l.tipo !== ' ' && otra && otra.tipo !== ' ' ? otra : undefined} /></td>
      </>
    : <><td className="gd-n hueco" /><td className="gd-c hueco" /></>;
  return (
    <table className="gd-tabla"><tbody>
      {vis.map((f, k) => <tr key={k} className="gd-l">{lado(f.izq, f.der, f.izq?.viejo)}{lado(f.der, f.izq, f.der?.nuevo)}</tr>)}
    </tbody></table>
  );
}

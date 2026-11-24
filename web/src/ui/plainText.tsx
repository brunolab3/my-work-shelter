// Lo que una herramienta pide hacer (permisos) y la línea de lo que está haciendo, en texto plano: React lo escapa, nada
// pasa por markdown ni HTML. Así un comando, un diff o un contenido no pueden cerrar su bloque y esconder el resto, y los
// caracteres invisibles o de control (espacios de ancho cero, marcas bidi, BOM, escapes de terminal) se ven como ⟦U+XXXX⟧.
import type { InputView } from '@shared/protocol';
import { t as tr } from '@shared/language';

import { INVISIBLE, mark } from '@shared/visible';

/** El texto tal cual, con los caracteres invisibles a la vista */
export function Visible({ t }: { t: string }) {
  if (!INVISIBLE.test(t)) return <>{t}</>;
  INVISIBLE.lastIndex = 0;
  const out: React.ReactNode[] = []; let i = 0;
  for (const m of t.matchAll(INVISIBLE)) {
    out.push(t.slice(i, m.index));
    out.push(<mark key={m.index} className="invisible-marcado" title={tr('windows.invisibleOrControlCharacter')}>{mark(m[0])}</mark>);
    i = m.index! + 1;
  }
  out.push(t.slice(i));
  return <>{out}</>;
}

/** Línea de herramienta («Ejecutando `…`»): lo que va entre la primera y la última comilla invertida, como código */
export function ToolText({ t }: { t: string }) {
  const i = t.indexOf('`'), j = t.lastIndexOf('`');
  if (i < 0 || j <= i) return <Visible t={t} />;
  return <><Visible t={t.slice(0, i)} /><code><Visible t={t.slice(i + 1, j)} /></code><Visible t={t.slice(j + 1)} /></>;
}

/** La vista previa de un permiso: ruta, texto, código o diff (líneas − y +), todo en texto plano */
export function RequestView({ blocks, reason }: { blocks: InputView[]; reason?: string }) {
  return (
    <div className="peticion-detalle">
      {blocks.map((b, k) => {
        if (b.type === 'path') return <p key={k} className="vista-path"><b><Visible t={b.text} /></b></p>;
        if (b.type === 'text') return <p key={k} className="vista-text"><Visible t={b.text} /></p>;
        return (
          <div key={k} className="code">
            <button className="copy" data-copiar tabIndex={-1}>{tr('windows.copy')}</button>
            <pre className={'vista-' + b.type}><code>{b.type === 'diff'
              ? b.text.split('\n').map((l, i) => <span key={i} className={l.startsWith('+ ') ? 'diff-mas' : l.startsWith('- ') ? 'diff-minus' : 'diff-note'}><Visible t={l} />{'\n'}</span>)
              : <Visible t={b.text} />}</code></pre>
          </div>
        );
      })}
      {reason && <p className="vista-motivo"><Visible t={reason} /></p>}
    </div>
  );
}

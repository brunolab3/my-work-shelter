// Piezas comunes de los aparatos del refugio (intercomunicador, plano, cámara acorazada, opciones…): carcasa de chapa con rejilla
// y piloto, pantalla de fósforo, menús con teclado (↑↓ o W/S, Enter/E/Espacio, Esc) y filas de ajuste con ←→.
import React, { useEffect, useRef, useState } from 'react';
import { keyboard } from '../engine/keyboard';
import { SFX } from '../audio/sound';
import { juego } from './gameState';
import { t } from '@shared/language';

export function closePanel() { SFX.close(); juego.set({ panel: null, panelData: null }); }

// Bloquea el movimiento del Supervisor mientras el aparato está abierto
export function useBlocker() { useEffect(() => { keyboard.blocked = true; return () => { keyboard.blocked = false; }; }, []); }

// Captures every key while the device is mounted (the last one mounted wins; `encima`: above every regular one)
export function useKeys(f: (e: KeyboardEvent) => boolean | void, deps: unknown[] = [], onTop = false) {
  const ref = useRef(f); ref.current = f;
  useEffect(() => keyboard.listen(e => { const r = ref.current(e); return r === false ? false : true; }, onTop), deps);
}

export function useMenu(n: number, onChoose: (i: number) => void, extra?: (e: KeyboardEvent) => boolean | void, onEsc: () => void = closePanel) {
  const [i, setI] = useState(0);
  const ref = useRef({ i, n, onChoose, extra, onEsc }); ref.current = { i, n, onChoose, extra, onEsc };
  useEffect(() => { if (i >= n && n > 0) setI(n - 1); }, [n]);
  useEffect(() => keyboard.listen(e => {
    const r = ref.current;
    const x = r.extra?.(e); if (x === true) return true; if (x === false) return false;
    if (!r.n) { if (e.code === 'Escape') { r.onEsc(); } return true; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(v => (v + 1) % r.n); SFX.tick(); return true; }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(v => (v - 1 + r.n) % r.n); SFX.tick(); return true; }
    if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { SFX.click(); r.onChoose(Math.min(r.i, r.n - 1)); return true; }
    if (e.code === 'Escape') { r.onEsc(); return true; }
    return true;
  }), []);
  return [Math.min(i, Math.max(0, n - 1)), setI] as const;
}

export interface ItemMenu { text: React.ReactNode; hint?: React.ReactNode; danger?: boolean; powerOff?: boolean; kind?: string }
export function Options({ items, i, setI, onChoose }: { items: ItemMenu[]; i: number; setI: (n: number) => void; onChoose: (n: number) => void }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => { (ref.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }); }, [i]);
  return (
    <ul className="opciones-consola" ref={ref}>
      {items.map((it, k) => (
        <li key={k} className={(k === i ? 'active' : '') + (it.danger ? ' peligro' : '') + (it.powerOff ? ' off' : '') + (it.kind ? ' ' + it.kind : '')} onMouseEnter={() => setI(k)} onClick={e => { if ((e.target as HTMLElement).closest('a')) return; SFX.click(); onChoose(k); }}>
          <span className="cursor">{k === i ? '▶' : ' '}</span><span className="txt">{it.text}</span>{it.hint && <small>{it.hint}</small>}
        </li>
      ))}
    </ul>
  );
}

// Carcasa de un aparato centrado en pantalla
export function Device({ label, pilot = 'idle', width, height, children, onClose = closePanel, kind = '' }: { label: React.ReactNode; pilot?: string; width?: number; height?: boolean; children: React.ReactNode; onClose?: () => void; kind?: string }) {
  useBlocker();
  useEffect(() => { SFX.open(); }, []);
  return (
    <div className={'device interactivo ' + kind + (height ? ' high' : '')} role="dialog" style={width ? { width: `min(94vw, calc(var(--u) * ${width}))` } : undefined}>
      <div className="consola-bisel">
        <div className="consola-cabeza">
          <span className="rejilla" aria-hidden />
          <span className={'pilot ' + pilot} aria-hidden />
          <span className="consola-rotulo">{label}</span>
          <button className="consola-x" onClick={onClose} title={t('panels.closeEsc')}>Esc</button>
        </div>
        <div className="pantalla-consola fosforo aparato-pantalla">{children}</div>
      </div>
    </div>
  );
}

export function Keys({ children }: { children: React.ReactNode }) { return <p className="ayuda-consola">{children}</p>; }

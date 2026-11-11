// Interfaz base: una única regleta de acero colgada del borde superior (como un panel de control del refugio)
// con la placa del refugio, la hora real, los contadores de «qué pasa ahora» en ventanas de fósforo (con su tecla
// siempre a la vista) y las dos puertas de lo demás: el buscador (⌘K) y el menú del juego (Esc), que lleva el reinicio.
import React, { useEffect, useState } from 'react';
import { juego } from './estadoJuego';
import { t, idioma } from '@shared/idioma';
import { vivo } from '../red/cliente';
import { openSearch } from './Buscador';
import { minimizeIntercom } from './Dialogo';
import { MAC } from './ventanas';

const LOC = idioma() === 'en' ? 'en-GB' : 'es-ES';
const fmtHour = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short' });

function useNow(ms = 1000) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}

export const Icon = {
  engranaje: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.6 2h2.8l.5 2.6 1.9.8 2.2-1.5 2 2-1.5 2.2.8 1.9 2.7.5v2.8l-2.7.5-.8 1.9 1.5 2.2-2 2-2.2-1.5-1.9.8-.5 2.8h-2.8l-.5-2.8-1.9-.8-2.2 1.5-2-2 1.5-2.2-.8-1.9L2 13.4v-2.8l2.6-.5.8-1.9L3.9 6l2-2 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>,
  aviso: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22zm-1 6h2v6h-2zm0 8h2v2h-2z"/></svg>,
  sobre: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 5h20v14H2zm2 2v.5l8 5 8-5V7zm16 2.9-8 5-8-5V17h16z"/></svg>,
  reloj: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm0 2a8 8 0 100 16 8 8 0 000-16zm-1 3h2v5.6l3.7 2.2-1 1.7L11 13.7z"/></svg>,
  nut: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10l5 9-5 9H7l-5-9zm5 5.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/></svg>,
  error: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20 10 10 0 010-20zm-3.5 5L7 8.5 10.5 12 7 15.5 8.5 17 12 13.5 15.5 17 17 15.5 13.5 12 17 8.5 15.5 7 12 10.5z"/></svg>,
  reiniciar: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4a8 8 0 017.4 5H22l-3.5 4.5L15 9h2.2A6 6 0 106 12H4a8 8 0 018-8zm0 16a8 8 0 01-7.4-5H2l3.5-4.5L9 15H6.8A6 6 0 1018 12h2a8 8 0 01-8 8z"/></svg>,
};

function untilMinutes(ts: number, ahora: number) {
  const m = Math.round((ts - ahora) / 60000);
  if (m <= 0) return t('windows.now');
  if (m < 60) return t('panels.inNMin', { n: m });
  const h = Math.floor(m / 60); return t('panels.inHH', { h }) + (m % 60 ? ' ' + t('panels.nMin', { n: m % 60 }) : '');
}

function Counter({ icono, n, texto, tecla, nivel }: { icono: React.ReactNode; n: number | string; texto: string; tecla: string; nivel?: 'urgente' | 'apagado' | 'error' | '' }) {
  return (
    <div className={'contador ' + (nivel || '')} title={`${texto} (${tecla})`}>
      <span className="icono">{icono}</span>
      <span className="n">{n}</span>
      <span className="txt">{texto}</span>
      <span className="tecla">{tecla}</span>
    </div>
  );
}

export function Hud() {
  const ahora = useNow();
  const e = juego.usar(s => s);
  const todos = [...e.habitantes, ...e.copias];   // con las copias holográficas
  const trabajando = todos.filter(h => h.estado === 'trabajando' || h.estado === 'pensando').length;
  const esperando = todos.filter(h => h.estado === 'esperando').length;
  const errores = todos.filter(h => h.estado === 'error').length;
  const connected = vivo.usar(x => x.connected);
  const reiniciando = vivo.usar(x => x.reiniciando);
  return (
    <>
    <div className="regleta">
      <span className="tirante izq" /><span className="tirante der" />
      <div className="seg placa-refugio">
        <span className="nombre">{e.refugio}</span>
      </div>
      <div className="seg fosforo hora">
        <span className="hh">{fmtHour.format(ahora)}</span>
        <span className="fecha">{fmtDate.format(ahora)}</span>
      </div>
      {!connected && <div className="seg fosforo sin-enlace" title={t('panels.theLinkToTheShelter')}><span className="piloto error" /> {t('panels.noLinkRetrying')}</div>}
      <div className={'seg fosforo contadores' + (connected ? '' : ' viejos')}>
        <Counter icono={Icon.engranaje} n={trabajando} texto={t('windows.working')} tecla="Tab" nivel={trabajando ? '' : 'apagado'} />
        <Counter icono={Icon.aviso} n={esperando} texto={t('panels.waitingForYou')} tecla="Q" nivel={esperando ? 'urgente' : 'apagado'} />
        {errores > 0 && <Counter icono={Icon.error} n={errores} texto={t('panels.brokenDown')} tecla="Q" nivel="error" />}
        <Counter icono={Icon.sobre} n={e.notificationsWithoutSee} texto={t('panels.unseen')} tecla="N" nivel={e.notificationsWithoutSee ? '' : 'apagado'} />
        <Counter icono={Icon.reloj} n={e.eventNext ? untilMinutes(e.eventNext.inicio, ahora) : '—'} texto={e.eventNext ? e.eventNext.titulo : t('panels.noEvents')} tecla="C" nivel={e.eventNext ? '' : 'apagado'} />
      </div>
      <div className="seg fosforo chatarra" title={t('panels.scrapEarnedWithEveryFinished')}>
        <span className="icono">{Icon.nut}</span><span className="n">{e.scrap.toLocaleString(LOC)}</span>
      </div>
      {/* las dos puertas de todo lo demás, con su tecla a la vista: el buscador (⌘K) y el menú del juego (Esc) */}
      <div className="seg puertas">
        <button className="boton-puerta" onClick={() => openSearch()} title={t('panels.searchConversationsActionsDwellersAnd')}>
          <span className="tecla">{MAC ? '⌘K' : 'Ctrl+K'}</span>{t('panels.search')}
        </button>
        <button className="boton-puerta" onClick={() => { if (juego.get().talkingWith) minimizeIntercom(); juego.set({ panel: 'menu', panelData: null }); }} title={t('panels.gameMenuOptionsShortcutsRestart')}>
          <span className="tecla">Esc</span>{t('panels.menu')}
        </button>
      </div>
    </div>
    {e.demo && <span className="marca-demo" title={t('panels.unconfiguredIntegrationsTheyShowSimulated')}>DEMO</span>}
    {reiniciando && <Restarting />}
    </>
  );
}

// mientras el servidor se reinicia: al volver el enlace, la página se recarga sola con el cliente nuevo
function Restarting() {
  const [lento, setLento] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLento(true), 25_000); return () => clearTimeout(t); }, []);
  return (
    <div className="despedida interactivo">
      <div className="placa-despedida">{t('panels.restarting')}
        <small>{lento ? t('panels.theServerIsTakingA') : t('panels.terminalsStayOpenILl')}</small>
      </div>
    </div>
  );
}

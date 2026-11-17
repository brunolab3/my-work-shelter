// La música del refugio: Spotify web, en el navegador de la discoteca (Navegadores.tsx). Suena en un Google Chrome sin
// ventana (electron/chromeRemoto.cjs: el DRM de Spotify solo da licencias a navegadores certificados) y el juego enseña
// y maneja su página. En la discoteca se abre Spotify y se elige lo que sea; al
// minimizarlo, la pletina se queda abajo a la izquierda, encima de la barra de ventanas, hasta que se cierre Spotify:
// compacta (disco, tema y artista) y, con el ratón encima o con ⌘J, desplegada con los mandos.
// La pletina lee y maneja la página con el mando que se le inyecta (electron/mandoMusica.js): lo que Spotify le
// cuenta al sistema para las teclas multimedia (tema, artista, carátula, posición) y sus acciones (reproducir, pausa,
// temas, saltar). Lo que suena va a vivo.musica: la sala lo enseña en su pantalla y el ambiente del refugio baja.
// ⌘J (o J en el refugio), como ⌘B con la barra: sin Spotify, lo abre; con Spotify delante, lo minimiza; con la pletina,
// la despliega para manejarla con el teclado (Espacio, ←→ ±10 s, ⇧←→ temas, ↑↓ volumen, Intro abre Spotify, Esc sale).
import React, { useEffect, useRef, useState } from 'react';
import type { MusicState } from '@shared/protocolo';
import { firstMapNow } from '../motor/foco';
import { vivo } from '../red/cliente';
import { SFX, sonido } from '../audio/sonido';
import { openBrowser, onFront, minimizar, navegadores, evaluateIn, IN_ELECTRON } from './Navegadores';
import { Store } from './almacen';
import { juego } from './estadoJuego';
import { writing } from '../motor/teclado';
import { MAC, CMD } from './ventanas';
import { t } from '@shared/idioma';
import { seleccion as barSelection } from './Barra';

/** Spotify en su navegador (si ya estaba abierto, al frente) */
export function openSpotify() { openBrowser('spotify'); }

// ---------------------------------------------------------------- la página de Spotify
// lo que devuelve la página no es de fiar: se queda en texto, números y carátulas del CDN de Spotify
const texto = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '');
const numero = (v: unknown, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
function readPage(e: any): MusicState | null {
  if (!e || typeof e !== 'object') return null;
  const titulo = texto(e.titulo);
  const cover = texto(e.cover);
  return {
    estado: !titulo ? 'parada' : e.sonando === true ? 'sonando' : 'pausa',
    pista: titulo ? { titulo, artista: texto(e.artista), album: texto(e.album), duracion: numero(e.duracion, 86400), cover: cover.startsWith('https://i.scdn.co/') ? cover : undefined } : undefined,
    posicion: numero(e.posicion, 86400), medido: Date.now(), volumen: Math.round(numero(e.volumen, 1) * 100), silence: false, saltar: e.saltar === true,
  };
}
const spotify = () => navegadores.get().lista.some(v => v.id === 'spotify');
const preguntar = (codigo: string, gesture = false) => evaluateIn('spotify', `(() => { const r = window.__refugioMusica; return r ? ${codigo} : null })()`, gesture);
async function leer() {
  if (!spotify()) { if (vivo.get().musica) vivo.set({ musica: null }); return; }
  const m = readPage(await preguntar('r.estado()'));
  const antes = vivo.get().musica;
  if (!m && !antes) return;
  // sin cambios de verdad no se toca vivo (la posición la adelanta la pletina)
  if (m && antes && m.estado === antes.estado && m.pista?.titulo === antes.pista?.titulo && m.volumen === antes.volumen && Math.abs(m.posicion - nowPosition(antes)) < 1.5) return;
  vivo.set({ musica: m });
}
/** Manda una orden a Spotify: alternar, play, pause, nexttrack, previoustrack, seekto (con los segundos) */
async function mandar(accion: string, x?: number) {
  const r = await preguntar(`r.accion(${JSON.stringify(accion)}, ${JSON.stringify(x ?? null)})`, true);
  if (r !== true) SFX.noAllowed();
  setTimeout(leer, 250);
}
const volumen = (v: number) => preguntar(`r.volumen(${v / 100})`, true);

// mientras haya Spotify, se le pregunta cada segundo (más a menudo no hace falta: la posición avanza sola aquí); con el
// juego detrás de otra aplicación, cada 4
if (IN_ELECTRON) {
  let reloj: ReturnType<typeof setInterval> | null = null, tic = 0;
  navegadores.subscribe(() => {
    const hay = navegadores.get().lista.some(v => v.id === 'spotify');
    if (hay && !reloj) reloj = setInterval(() => { if (firstMapNow() || ++tic % 4 === 0) void leer(); }, 1000);
    else if (!hay && reloj) { clearInterval(reloj); reloj = null; vivo.set({ musica: null }); }
  });
}
// con música, el zumbido del refugio baja
vivo.subscribe(() => sonido.dimAmbient(vivo.get().musica?.estado === 'sonando'));

// la posición avanza sola mientras suena
function nowPosition(m: MusicState | null) {
  if (!m) return 0;
  const p = m.estado === 'sonando' ? m.posicion + (Date.now() - m.medido) / 1000 : m.posicion;
  return Math.max(0, m.pista?.duracion ? Math.min(m.pista.duracion, p) : p);
}
function usePosition(m: MusicState | null) {
  const [, setT] = useState(0);
  useEffect(() => { if (m?.estado !== 'sonando') return; const i = setInterval(() => setT(x => x + 1), 500); return () => clearInterval(i); }, [m?.estado]);
  return nowPosition(m);
}
const mmss = (s: number) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- piezas
const I = {
  anterior: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zm3.5 7L19 5v14z" /></svg>,
  siguiente: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM5 5l9.5 7L5 19z" /></svg>,
  sonar: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15L20 12z" /></svg>,
  pausa: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4.5v14H6zm7.5 0H18v14h-4.5z" /></svg>,
  volumen: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.2v2.1a7 7 0 010 13.4v2.1a9 9 0 000-17.6z" /></svg>,
  abrir: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4zm2 4v10h12V8z" /></svg>,
};

function Disco({ m, tam }: { m: MusicState | null; tam: string }) {
  const c = m?.pista?.cover;
  // un disco de vinilo a 33⅓ rpm con la carátula de etiqueta; el brillo no gira con él
  return (
    <div className={'disco-vinilo' + (m?.estado === 'sonando' ? ' girando' : '')} style={{ width: tam, height: tam }} aria-hidden>
      <div className="disco-giro"><div className="disco-etiqueta" style={c ? { backgroundImage: `url("${c}")` } : undefined} /></div>
      <div className="disco-brillo" />
      <div className="disco-eje" />
    </div>
  );
}

// clic o arrastre: mientras se arrastra, la posición que quedaría; al soltar, se salta ahí
function Progress({ m, pos }: { m: MusicState; pos: number }) {
  const d = m.pista?.duracion ?? 0;
  const [arrastre, setDrag] = useState<number | null>(null);
  const puede = !!d && m.saltar;
  const aSeconds = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d); };
  const ver = arrastre ?? pos;
  return (
    <div className="musica-progreso">
      <span>{mmss(ver)}</span>
      <div className={'musica-barra' + (puede ? ' saltable' : '') + (arrastre !== null ? ' arrastrando' : '')} title={puede ? t('windows.clickOrDragToJump') : undefined}
        onPointerDown={e => { if (!puede) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(aSeconds(e)); }}
        onPointerMove={e => { if (arrastre !== null) setDrag(aSeconds(e)); }}
        onPointerUp={e => {
          if (arrastre === null) return;
          const s = aSeconds(e); setDrag(null);
          vivo.set({ musica: { ...m, posicion: s, medido: Date.now() } }); void mandar('seekto', s); SFX.tick();
        }}
        onPointerCancel={() => setDrag(null)}>
        <span style={{ width: d ? `${(ver / d) * 100}%` : '0%' }} />
      </div>
      <span>{d ? mmss(d) : '–:––'}</span>
    </div>
  );
}

function Controls({ m }: { m: MusicState }) {
  const sonando = m.estado === 'sonando';
  return (
    <div className="musica-mandos">
      <button className="musica-boton" onClick={() => { void mandar('previoustrack'); SFX.clic(); }} title={t('windows.previousTrack')}>{I.anterior}</button>
      <button className="musica-boton principal" onClick={() => { void mandar('alternar'); SFX.clic(); }} title={sonando ? t('windows.pause') : t('windows.play')}>{sonando ? I.pausa : I.sonar}</button>
      <button className="musica-boton" onClick={() => { void mandar('nexttrack'); SFX.clic(); }} title={t('windows.nextTrack')}>{I.siguiente}</button>
    </div>
  );
}

// el volumen se manda a ráfagas cortas mientras se arrastra y al soltar
function Volume({ m }: { m: MusicState }) {
  const [v, setV] = useState<number | null>(null);
  const ultimo = useRef(0);
  const mover = (x: number, final = false) => { setV(final ? null : x); if (final || Date.now() - ultimo.current > 120) { ultimo.current = Date.now(); void volumen(x); if (final) setTimeout(leer, 250); } };
  const val = v ?? m.volumen;
  return (
    <label className="musica-volumen" title={t('windows.volumeVal', { val })}>
      {I.volumen}
      <input type="range" min={0} max={100} value={val} onChange={e => mover(+e.target.value)} onPointerUp={e => mover(+(e.target as HTMLInputElement).value, true)} onKeyUp={e => mover(+(e.target as HTMLInputElement).value, true)} />
    </label>
  );
}

// ---------------------------------------------------------------- mando por teclado (⌘J)
export const mandoMusica = new Store<{ activo: boolean }>({ activo: false });
function enterCommand() {
  if (mandoMusica.get().activo) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  mandoMusica.set({ activo: true }); SFX.abrir();
}
function exitCommand(withSound = true) { if (!mandoMusica.get().activo) return; mandoMusica.set({ activo: false }); if (withSound) SFX.cerrar(); }
// con la barra en mano (⌘B), la música se suelta: una cosa cada vez
barSelection.subscribe(() => { if (barSelection.get().actual) exitCommand(false); });

/** ⌘J: sin Spotify, lo abre; con Spotify delante, lo minimiza y pasa a la pletina; con la pletina, la despliega en mano */
export function musicShortcut() {
  const nav = navegadores.get().lista.find(v => v.id === 'spotify');
  if (!nav) { openSpotify(); return; }
  if (!nav.minimizada) minimizar('spotify');
  enterCommand();
}
const SECONDS_STEP = 10, VOLUME_STEP = 10;
// con el foco en un navegador (<webview>), las teclas no llegan a la página: Electron manda ⌘J aquí
(window as any).__musicShortcut = () => { if (mandoMusica.get().activo) exitCommand(); else musicShortcut(); };
if (IN_ELECTRON) addEventListener('keydown', e => {
  const cmdJ = (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey) && !e.altKey && e.code === 'KeyJ';
  if (!mandoMusica.get().activo) {
    const j = juego.get();
    const jLoose = e.code === 'KeyJ' && !e.metaKey && !e.ctrlKey && !e.altKey && !j.talkingWith && !j.panel && !writing(e);
    if (cmdJ || jLoose) { e.preventDefault(); e.stopPropagation(); musicShortcut(); }
    return;
  }
  // ⌘B: a la barra (esta se suelta)
  if ((MAC ? e.metaKey : e.ctrlKey) && e.code === 'KeyB') { exitCommand(false); return; }
  // con la pletina en mano, todas las teclas son suyas
  e.preventDefault(); e.stopPropagation();
  if (e.repeat && !/^Arrow/.test(e.code)) return;
  const m = vivo.get().musica;
  if (cmdJ || e.code === 'Escape') exitCommand();
  else if (e.code === 'Enter' || e.code === 'KeyE') { exitCommand(false); onFront('spotify'); }
  else if (!m) SFX.noAllowed();
  else if (e.code === 'Space' || e.code === 'KeyK') { void mandar('alternar'); SFX.clic(); }
  else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && e.shiftKey) { void mandar(e.code === 'ArrowLeft' ? 'previoustrack' : 'nexttrack'); SFX.clic(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    if (!m.saltar || !m.pista?.duracion) { SFX.noAllowed(); return; }
    const s = Math.max(0, Math.min(m.pista.duracion - 1, nowPosition(m) + (e.code === 'ArrowLeft' ? -SECONDS_STEP : SECONDS_STEP)));
    vivo.set({ musica: { ...m, posicion: s, medido: Date.now() } }); void mandar('seekto', Math.round(s)); SFX.tick();
  }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    const v = Math.max(0, Math.min(100, m.volumen + (e.code === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)));
    vivo.set({ musica: { ...m, volumen: v } }); void volumen(v); SFX.tick();
  }
}, true);

// ---------------------------------------------------------------- pletina (reproductor de bolsillo)
// abajo a la izquierda, encima de la barra de ventanas, mientras Spotify esté abierto y minimizado (con Spotify delante,
// ya están sus mandos). Compacta: el disco, el tema y el artista (y una raya de progreso). Con el ratón encima o con ⌘J,
// desplegada: progreso con salto por clic, mandos y volumen
export function Deck() {
  const m = vivo.usar(e => e.musica);
  const nav = navegadores.usar(e => e.lista.find(v => v.id === 'spotify'));
  const inHand = mandoMusica.usar(e => e.activo);
  const pos = usePosition(m);
  const [encima, setAbove] = useState(false);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  const visible = !!nav && nav.minimizada;
  useEffect(() => { if (!visible) { exitCommand(false); setAbove(false); } }, [visible]);
  // un clic fuera la suelta
  useEffect(() => { if (!inHand) return; const f = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) exitCommand(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [inHand]);
  if (!visible) return null;
  const abierta = encima || inHand;
  const p = m?.pista;
  const sonando = m?.estado === 'sonando';
  const marca = sonando ? 'SONANDO' : m?.estado === 'pausa' ? 'PAUSA' : 'SPOTIFY';
  const d = p?.duracion ?? 0;
  return (
    <div ref={caja} className={'pletina interactivo' + (abierta ? ' abierta' : ' compacta') + (sonando ? ' sonando' : '') + (inHand ? ' en-mano' : '')} role="region" aria-label={t('windows.musicPlayer')}
      onMouseEnter={() => { if (deadline.current) clearTimeout(deadline.current); setAbove(true); }}
      onMouseLeave={() => { deadline.current = setTimeout(() => setAbove(false), 350); }}>
      {inHand && <div className="barra-ayuda pletina-ayuda"><kbd>{t('windows.space')}</kbd> ⏯ <kbd>←→</kbd> ±{SECONDS_STEP} s <kbd>⇧←→</kbd> {t('windows.tracks')} <kbd>↑↓</kbd> {t('windows.volume')} <kbd>{t('windows.enter')}</kbd> Spotify <kbd>Esc</kbd> {t('windows.exit')}</div>}
      <div className="pletina-fila">
        <button className="pletina-disco" onClick={() => onFront('spotify')} title={t('windows.openSpotifyAtajoJTo', { shortcut: CMD })}><Disco m={m} tam="100%" /></button>
        <div className="pletina-cuerpo">
          {abierta && <div className="pletina-cabeza">
            <span className="pletina-marca">{marca}</span>
            <span className="pletina-acciones">
              <button className="consola-x" onClick={() => onFront('spotify')} title={t('windows.openSpotifyEnter')}>{I.abrir}</button>
            </span>
          </div>}
          {p ? <>
            <div className="pletina-titulo" title={`${p.titulo} — ${p.artista}`}><span>{p.titulo}</span></div>
            <div className="pletina-artista">{p.artista}{abierta && p.album ? <span className="tenue"> · {p.album}</span> : null}</div>
            {abierta && <><Progress m={m!} pos={pos} /><div className="pletina-pie"><Controls m={m!} /><Volume m={m!} /></div></>}
          </> : <>
            <div className="pletina-titulo"><span>{t('windows.nothingPlaying')}</span></div>
            <div className="pletina-artista">{abierta ? t('windows.openSpotifyAndPickSomething') : `Spotify · ${CMD}J`}</div>
          </>}
        </div>
      </div>
      {!abierta && d > 0 && <span className="pletina-raya" style={{ width: `${Math.min(100, (pos / d) * 100)}%` }} />}
      {!inHand && <button className="tecla pista-atajo" onClick={() => musicShortcut()} title={t('windows.controlTheMusicWithThe', { shortcut: `${CMD}J` })}>{CMD}J</button>}
    </div>
  );
}

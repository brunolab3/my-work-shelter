// La música del refugio: Spotify web, en el navegador de la discoteca (Browsers.tsx). Suena en un Google Chrome sin
// ventana (electron/remoteChrome.cjs: el DRM de Spotify solo da licencias a navegadores certificados) y el juego enseña
// y maneja su página. En la discoteca se abre Spotify y se elige lo que sea; al
// minimizarlo, la pletina se queda abajo a la izquierda, encima de la barra de ventanas, hasta que se cierre Spotify:
// compacta (disco, tema y artista) y, con el ratón encima o con ⌘J, desplegada con los mandos.
// La pletina lee y maneja la página con el mando que se le inyecta (electron/musicControl.js): lo que Spotify le
// cuenta al sistema para las teclas multimedia (tema, artista, carátula, posición) y sus acciones (reproducir, pausa,
// temas, saltar). Lo que suena va a vivo.musica: la sala lo enseña en su pantalla y el ambiente del refugio baja.
// ⌘J (o J en el refugio), como ⌘B con la barra: sin Spotify, lo abre; con Spotify delante, lo minimiza; con la pletina,
// la despliega para manejarla con el teclado (Espacio, ←→ ±10 s, ⇧←→ temas, ↑↓ volumen, Intro abre Spotify, Esc sale).
import React, { useEffect, useRef, useState } from 'react';
import type { MusicState } from '@shared/protocol';
import { firstMapNow } from '../engine/focus';
import { live } from '../net/client';
import { SFX, sound } from '../audio/sound';
import { openBrowser, onFront, minimize, browsers, evaluateIn, IN_ELECTRON } from './Browsers';
import { Store } from './store';
import { juego } from './gameState';
import { writing } from '../engine/keyboard';
import { MAC, CMD } from './windows';
import { t } from '@shared/language';
import { selection as barSelection } from './Bar';

/** Spotify en su navegador (si ya estaba abierto, al frente) */
export function openSpotify() { openBrowser('spotify'); }

// ---------------------------------------------------------------- la página de Spotify
// lo que devuelve la página no es de fiar: se queda en texto, números y carátulas del CDN de Spotify
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : '');
const number = (v: unknown, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);
function readPage(e: any): MusicState | null {
  if (!e || typeof e !== 'object') return null;
  const title = text(e.title);
  const cover = text(e.cover);
  return {
    state: !title ? 'parada' : e.playing === true ? 'sonando' : 'pausa',
    hint: title ? { title, artist: text(e.artist), album: text(e.album), duration: number(e.duration, 86400), cover: cover.startsWith('https://i.scdn.co/') ? cover : undefined } : undefined,
    position: number(e.position, 86400), measured: Date.now(), volume: Math.round(number(e.volume, 1) * 100), silence: false, seek: e.seek === true,
  };
}
const spotify = () => browsers.get().list.some(v => v.id === 'spotify');
const ask = (code: string, gesture = false) => evaluateIn('spotify', `(() => { const r = window.__refugioMusica; return r ? ${code} : null })()`, gesture);
async function read() {
  if (!spotify()) { if (live.get().music) live.set({ music: null }); return; }
  const m = readPage(await ask('r.estado()'));
  const before = live.get().music;
  if (!m && !before) return;
  // sin cambios de verdad no se toca vivo (la posición la adelanta la pletina)
  if (m && before && m.state === before.state && m.hint?.title === before.hint?.title && m.volume === before.volume && Math.abs(m.position - nowPosition(before)) < 1.5) return;
  live.set({ music: m });
}
/** Manda una orden a Spotify: alternar, play, pause, nexttrack, previoustrack, seekto (con los segundos) */
async function send(action: string, x?: number) {
  const r = await ask(`r.accion(${JSON.stringify(action)}, ${JSON.stringify(x ?? null)})`, true);
  if (r !== true) SFX.notAllowed();
  setTimeout(read, 250);
}
const volume = (v: number) => ask(`r.volumen(${v / 100})`, true);

// mientras haya Spotify, se le pregunta cada segundo (más a menudo no hace falta: la posición avanza sola aquí); con el
// juego detrás de otra aplicación, cada 4
if (IN_ELECTRON) {
  let timer: ReturnType<typeof setInterval> | null = null, tick = 0;
  browsers.subscribe(() => {
    const exists = browsers.get().list.some(v => v.id === 'spotify');
    if (exists && !timer) timer = setInterval(() => { if (firstMapNow() || ++tick % 4 === 0) void read(); }, 1000);
    else if (!exists && timer) { clearInterval(timer); timer = null; live.set({ music: null }); }
  });
}
// con música, el zumbido del refugio baja
live.subscribe(() => sound.dimAmbient(live.get().music?.state === 'sonando'));

// la posición avanza sola mientras suena
function nowPosition(m: MusicState | null) {
  if (!m) return 0;
  const p = m.state === 'sonando' ? m.position + (Date.now() - m.measured) / 1000 : m.position;
  return Math.max(0, m.hint?.duration ? Math.min(m.hint.duration, p) : p);
}
function usePosition(m: MusicState | null) {
  const [, setT] = useState(0);
  useEffect(() => { if (m?.state !== 'sonando') return; const i = setInterval(() => setT(x => x + 1), 500); return () => clearInterval(i); }, [m?.state]);
  return nowPosition(m);
}
const mmss = (s: number) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- piezas
const I = {
  previous: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zm3.5 7L19 5v14z" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM5 5l9.5 7L5 19z" /></svg>,
  sonar: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15L20 12z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4.5v14H6zm7.5 0H18v14h-4.5z" /></svg>,
  volume: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4zM14 3.2v2.1a7 7 0 010 13.4v2.1a9 9 0 000-17.6z" /></svg>,
  open: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16v16H4zm2 4v10h12V8z" /></svg>,
};

function Disco({ m, size }: { m: MusicState | null; size: string }) {
  const c = m?.hint?.cover;
  // un disco de vinilo a 33⅓ rpm con la carátula de etiqueta; el brillo no gira con él
  return (
    <div className={'disco-vinilo' + (m?.state === 'sonando' ? ' girando' : '')} style={{ width: size, height: size }} aria-hidden>
      <div className="disco-giro"><div className="disco-etiqueta" style={c ? { backgroundImage: `url("${c}")` } : undefined} /></div>
      <div className="disco-brillo" />
      <div className="disco-eje" />
    </div>
  );
}

// clic o arrastre: mientras se arrastra, la posición que quedaría; al soltar, se salta ahí
function Progress({ m, pos }: { m: MusicState; pos: number }) {
  const d = m.hint?.duration ?? 0;
  const [drag, setDrag] = useState<number | null>(null);
  const can = !!d && m.seek;
  const toSeconds = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d); };
  const check = drag ?? pos;
  return (
    <div className="musica-progreso">
      <span>{mmss(check)}</span>
      <div className={'musica-barra' + (can ? ' saltable' : '') + (drag !== null ? ' arrastrando' : '')} title={can ? t('windows.clickOrDragToJump') : undefined}
        onPointerDown={e => { if (!can) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(toSeconds(e)); }}
        onPointerMove={e => { if (drag !== null) setDrag(toSeconds(e)); }}
        onPointerUp={e => {
          if (drag === null) return;
          const s = toSeconds(e); setDrag(null);
          live.set({ music: { ...m, position: s, measured: Date.now() } }); void send('seekto', s); SFX.tick();
        }}
        onPointerCancel={() => setDrag(null)}>
        <span style={{ width: d ? `${(check / d) * 100}%` : '0%' }} />
      </div>
      <span>{d ? mmss(d) : '–:––'}</span>
    </div>
  );
}

function Controls({ m }: { m: MusicState }) {
  const playing = m.state === 'sonando';
  return (
    <div className="musica-mandos">
      <button className="musica-boton" onClick={() => { void send('previoustrack'); SFX.click(); }} title={t('windows.previousTrack')}>{I.previous}</button>
      <button className="musica-boton principal" onClick={() => { void send('alternar'); SFX.click(); }} title={playing ? t('windows.pause') : t('windows.play')}>{playing ? I.pause : I.sonar}</button>
      <button className="musica-boton" onClick={() => { void send('nexttrack'); SFX.click(); }} title={t('windows.nextTrack')}>{I.next}</button>
    </div>
  );
}

// el volumen se manda a ráfagas cortas mientras se arrastra y al soltar
function Volume({ m }: { m: MusicState }) {
  const [v, setV] = useState<number | null>(null);
  const last = useRef(0);
  const move = (x: number, final = false) => { setV(final ? null : x); if (final || Date.now() - last.current > 120) { last.current = Date.now(); void volume(x); if (final) setTimeout(read, 250); } };
  const val = v ?? m.volume;
  return (
    <label className="musica-volumen" title={t('windows.volumeVal', { val })}>
      {I.volume}
      <input type="range" min={0} max={100} value={val} onChange={e => move(+e.target.value)} onPointerUp={e => move(+(e.target as HTMLInputElement).value, true)} onKeyUp={e => move(+(e.target as HTMLInputElement).value, true)} />
    </label>
  );
}

// ---------------------------------------------------------------- mando por teclado (⌘J)
export const musicRemote = new Store<{ active: boolean }>({ active: false });
function enterCommand() {
  if (musicRemote.get().active) return;
  (document.activeElement as HTMLElement | null)?.blur?.();
  musicRemote.set({ active: true }); SFX.open();
}
function exitCommand(withSound = true) { if (!musicRemote.get().active) return; musicRemote.set({ active: false }); if (withSound) SFX.close(); }
// con la barra en mano (⌘B), la música se suelta: una cosa cada vez
barSelection.subscribe(() => { if (barSelection.get().current) exitCommand(false); });

/** ⌘J: sin Spotify, lo abre; con Spotify delante, lo minimiza y pasa a la pletina; con la pletina, la despliega en mano */
export function musicShortcut() {
  const nav = browsers.get().list.find(v => v.id === 'spotify');
  if (!nav) { openSpotify(); return; }
  if (!nav.minimized) minimize('spotify');
  enterCommand();
}
const SECONDS_STEP = 10, VOLUME_STEP = 10;
// con el foco en un navegador (<webview>), las teclas no llegan a la página: Electron manda ⌘J aquí
(window as any).__musicShortcut = () => { if (musicRemote.get().active) exitCommand(); else musicShortcut(); };
if (IN_ELECTRON) addEventListener('keydown', e => {
  const cmdJ = (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey) && !e.altKey && e.code === 'KeyJ';
  if (!musicRemote.get().active) {
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
  const m = live.get().music;
  if (cmdJ || e.code === 'Escape') exitCommand();
  else if (e.code === 'Enter' || e.code === 'KeyE') { exitCommand(false); onFront('spotify'); }
  else if (!m) SFX.notAllowed();
  else if (e.code === 'Space' || e.code === 'KeyK') { void send('alternar'); SFX.click(); }
  else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && e.shiftKey) { void send(e.code === 'ArrowLeft' ? 'previoustrack' : 'nexttrack'); SFX.click(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    if (!m.seek || !m.hint?.duration) { SFX.notAllowed(); return; }
    const s = Math.max(0, Math.min(m.hint.duration - 1, nowPosition(m) + (e.code === 'ArrowLeft' ? -SECONDS_STEP : SECONDS_STEP)));
    live.set({ music: { ...m, position: s, measured: Date.now() } }); void send('seekto', Math.round(s)); SFX.tick();
  }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    const v = Math.max(0, Math.min(100, m.volume + (e.code === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP)));
    live.set({ music: { ...m, volume: v } }); void volume(v); SFX.tick();
  }
}, true);

// ---------------------------------------------------------------- pletina (reproductor de bolsillo)
// abajo a la izquierda, encima de la barra de ventanas, mientras Spotify esté abierto y minimizado (con Spotify delante,
// ya están sus mandos). Compacta: el disco, el tema y el artista (y una raya de progreso). Con el ratón encima o con ⌘J,
// desplegada: progreso con salto por clic, mandos y volumen
export function Deck() {
  const m = live.use(e => e.music);
  const nav = browsers.use(e => e.list.find(v => v.id === 'spotify'));
  const inHand = musicRemote.use(e => e.active);
  const pos = usePosition(m);
  const [onTop, setAbove] = useState(false);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = !!nav && nav.minimized;
  useEffect(() => { if (!visible) { exitCommand(false); setAbove(false); } }, [visible]);
  // un clic fuera la suelta
  useEffect(() => { if (!inHand) return; const f = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) exitCommand(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [inHand]);
  if (!visible) return null;
  const open = onTop || inHand;
  const p = m?.hint;
  const playing = m?.state === 'sonando';
  const mark = playing ? 'SONANDO' : m?.state === 'pausa' ? 'PAUSA' : 'SPOTIFY';
  const d = p?.duration ?? 0;
  return (
    <div ref={box} className={'pletina interactivo' + (open ? ' abierta' : ' compacta') + (playing ? ' sonando' : '') + (inHand ? ' en-mano' : '')} role="region" aria-label={t('windows.musicPlayer')}
      onMouseEnter={() => { if (deadline.current) clearTimeout(deadline.current); setAbove(true); }}
      onMouseLeave={() => { deadline.current = setTimeout(() => setAbove(false), 350); }}>
      {inHand && <div className="barra-ayuda pletina-ayuda"><kbd>{t('windows.space')}</kbd> ⏯ <kbd>←→</kbd> ±{SECONDS_STEP} s <kbd>⇧←→</kbd> {t('windows.tracks')} <kbd>↑↓</kbd> {t('windows.volume')} <kbd>{t('windows.enter')}</kbd> Spotify <kbd>Esc</kbd> {t('windows.exit')}</div>}
      <div className="pletina-fila">
        <button className="pletina-disco" onClick={() => onFront('spotify')} title={t('windows.openSpotifyAtajoJTo', { shortcut: CMD })}><Disco m={m} size="100%" /></button>
        <div className="pletina-cuerpo">
          {open && <div className="pletina-cabeza">
            <span className="pletina-marca">{mark}</span>
            <span className="pletina-acciones">
              <button className="consola-x" onClick={() => onFront('spotify')} title={t('windows.openSpotifyEnter')}>{I.open}</button>
            </span>
          </div>}
          {p ? <>
            <div className="pletina-titulo" title={`${p.title} — ${p.artist}`}><span>{p.title}</span></div>
            <div className="pletina-artista">{p.artist}{open && p.album ? <span className="tenue"> · {p.album}</span> : null}</div>
            {open && <><Progress m={m!} pos={pos} /><div className="pletina-pie"><Controls m={m!} /><Volume m={m!} /></div></>}
          </> : <>
            <div className="pletina-titulo"><span>{t('windows.nothingPlaying')}</span></div>
            <div className="pletina-artista">{open ? t('windows.openSpotifyAndPickSomething') : `Spotify · ${CMD}J`}</div>
          </>}
        </div>
      </div>
      {!open && d > 0 && <span className="pletina-raya" style={{ width: `${Math.min(100, (pos / d) * 100)}%` }} />}
      {!inHand && <button className="tecla pista-atajo" onClick={() => musicShortcut()} title={t('windows.controlTheMusicWithThe', { shortcut: `${CMD}J` })}>{CMD}J</button>}
    </div>
  );
}

// Chapa y Pintura: el probador. Se elige a quién (el Supervisor o cualquier habitante menos la Octocat) y se le cambia
// todo: humano o robot, cara, cejas, pelo, barba, sombrero, gafas, torso, brazos, piernas, espalda, complementos y los
// colores de cada cosa. Cada pieza se ve en miniatura sobre el propio personaje, la vista grande se mueve con el ratón
// y el personaje del refugio se va vistiendo a la vez. Nada se guarda hasta pulsar Enter; Esc lo deja como estaba.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego } from './gameState';
import { live, client } from '../net/client';
import { SFX } from '../audio/sound';
import { t, tIs } from '@shared/language';
import { Device, Options, Keys, closePanel, useMenu, useKeys } from './device';
import {
  lookOf, lookOnRandom, setPiece, piecesOf, fits, lookSignature, paletteOf, nameRegion,
  HUMAN_SLOTS, SLOTS_ROBOT, REQUIRED, COLORS_OF, SLOT_NAME, REGIONS, PIECE, STOCK,
  type Look, type Slot, type Region, type Piece,
} from '@shared/appearance';
import { Studio, FOCUS, thumbnail, type Focus } from '../world/figure/studio';

type Cat = Slot | 'colores';
const COLS = 5;

export function PanelBodyshop() {
  const data = juego.use(e => e.panelData);
  const [who, setWho] = useState<string | null>(data?.who ?? null);
  if (!who) return <ChooseClient pick={q => { SFX.open(); setWho(q); }} />;
  return <FittingRoom who={who} goBack={data?.who ? closePanel : () => setWho(null)} />;
}

// ---------------------------------------------------------------- a quién se arregla
function ChooseClient({ pick }: { pick: (q: string) => void }) {
  const dwellers: any[] = live.use(e => e.state?.dwellers ?? []);
  const sup = live.use(e => e.state?.supervisor);
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const items = [
    { text: <><b>{t('world.you')}</b> · {sup?.name ?? t('panels.overseer')}</>, hint: tIs(lookOf({ type: sup?.character, look: sup?.look }).especie), q: 'supervisor', powerOff: false },
    ...dwellers.map(h => ({
      text: <>{h.name} <span className="tenue">«{tIs(h.nickname)}»</span></>,
      hint: h.type === 'Octocat' ? t('panels.itIsWhatItIs') : rooms.find(s => s.id === h.roomId)?.name ?? '',
      q: h.id, powerOff: h.type === 'Octocat',
    })),
  ];
  const ok = (k: number) => { const it = items[k]; if (!it || it.powerOff) { SFX.notAllowed(); return; } pick(it.q); };
  const [i, setI] = useMenu(items.length, ok);
  return (
    <Device label={t('panels.chromePaintBarberShopAnd')} width={40} height>
      <p className="voz">{t('panels.fitoSlipsTheScissorsInto')}</p>
      <div className="lista-desplazable"><Options items={items} i={i} setI={setI} onChoose={ok} /></div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.toTheChair')} <kbd>Esc</kbd>{t('windows.exit')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- el probador
function FittingRoom({ who, goBack }: { who: string; goBack: () => void }) {
  const state = live.get().state;
  const card = who === 'supervisor' ? null : (state?.dwellers as any[] | undefined)?.find(h => h.id === who);
  const name = who === 'supervisor' ? (state?.supervisor?.name ?? t('panels.overseer')) : card?.name ?? who;
  const original = useMemo(() => who === 'supervisor' ? lookOf({ type: state?.supervisor?.character ?? 'Protagonist_B', look: state?.supervisor?.look }) : lookOf(card ?? {}), []);
  const stock = useMemo(() => structuredClone(STOCK[who === 'supervisor' ? state?.supervisor?.character ?? 'Protagonist_B' : card?.type] ?? original), []);
  const [a, setA] = useState<Look>(original);
  const history = useRef<Look[]>([]);
  const speciesBy = useRef<Partial<Record<string, Look>>>({ [original.especie]: original });
  const [cat, setCat] = useState(0);
  const [cur, setCur] = useState(0);
  const [zone, setZone] = useState<'piezas' | 'colores'>('piezas');
  const [row, setRow] = useState(0);
  const [regions, setRegions] = useState<Set<number> | null>(null);
  const [fallback, setDefault] = useState<Partial<Record<Region, string>>>({});
  const [saving, setSaving] = useState(false);

  const cats: Cat[] = [...(a.especie === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS), 'colores'];
  const slot = cats[Math.min(cat, cats.length - 1)];
  const options: (Piece | null)[] = slot === 'colores' ? [] : [...(REQUIRED.includes(slot) ? [] : [null]), ...piecesOf(slot, a.especie).filter(p => fits(p, a.pieces))];
  const setting = slot === 'colores' ? -1 : options.findIndex(p => (p?.id ?? '') === (a.pieces[slot] ?? ''));
  const rows = (COLORS_OF[slot] ?? []).filter(r => !regions || regions.has(REGIONS.indexOf(r)));
  const focus: Focus = FOCUS[slot];

  // el cursor empieza en lo que lleva puesto
  useEffect(() => { setCur(Math.max(0, setting)); setZone(slot === 'colores' ? 'colores' : 'piezas'); setRow(0); }, [slot, a.especie]);

  // el personaje del refugio se viste a la vez (sin guardar)
  const attempt = (x: Look) => window.dispatchEvent(new CustomEvent('refugio:probar', { detail: { who, look: x } }));
  const change = (n: Look, sound = true) => {
    if (lookSignature(n) === lookSignature(a)) return;
    history.current.push(a); if (history.current.length > 80) history.current.shift();
    speciesBy.current[n.especie] = n;
    setA(n); attempt(n); if (sound) SFX.tick();
  };
  const undo = () => { const x = history.current.pop(); if (!x) { SFX.notAllowed(); return; } setA(x); attempt(x); SFX.toggle(); };
  const exit = () => { attempt(original); goBack(); };
  const save = async () => {
    if (saving) return; setSaving(true);
    try { await client.action('look.save', { who, look: a }); SFX.success(); goBack(); }
    catch (e: any) { SFX.notAllowed(); juego.set({ hint: { key: '', text: String(e?.message ?? e) } }); setSaving(false); }
  };
  const otherSpecies = () => {
    const especie = a.especie === 'robot' ? 'humano' : 'robot';
    const n = speciesBy.current[especie] ?? structuredClone(especie === 'robot' ? STOCK.Robot_Two : STOCK.Hiker);
    change(n); setCat(0); SFX.toggle();
  };
  const random = (solo?: Cat) => {
    const r = Math.random;
    if (!solo || solo === 'colores') {
      const n = lookOnRandom(r, a.especie);
      change(solo === 'colores' ? { ...a, colors: n.colors } : n);
    } else {
      const list = options.filter(p => (p?.id ?? '') !== (a.pieces[solo] ?? ''));
      const p = list[Math.floor(r() * list.length)];
      if (p !== undefined) change(setPiece(a, solo, p?.id ?? null));
    }
  };
  const choosePiece = (k: number) => { const p = options[k]; if (p === undefined) return; setCur(k); change(setPiece(a, slot as Slot, p?.id ?? null)); };
  const setColor = (r: Region, c: string | null) => { const n = { ...a, colors: { ...a.colors } }; if (c) n.colors[r] = c; else delete n.colors[r]; change(n); };

  useKeys(e => {
    if (saving) return true;
    const sh = e.shiftKey;
    if (e.code === 'Escape') { exit(); return true; }
    if (e.code === 'Enter') { save(); return true; }
    if (e.code === 'Tab' || e.code === 'KeyE' || e.code === 'KeyQ') { const d = e.code === 'KeyQ' || (e.code === 'Tab' && sh) ? -1 : 1; setCat(c => (c + d + cats.length) % cats.length); SFX.tick(); return true; }
    if (e.code === 'KeyZ' || e.code === 'Backspace') { undo(); return true; }
    if (e.code === 'KeyR') { random(sh ? slot : undefined); SFX.toggle(); return true; }
    if (e.code === 'KeyH') { otherSpecies(); return true; }
    if (e.code === 'KeyO') { change(structuredClone(stock)); SFX.toggle(); return true; }
    if (e.code === 'Comma' || e.code === 'Period') { window.dispatchEvent(new CustomEvent('probador:girar', { detail: e.code === 'Comma' ? -0.4 : 0.4 })); return true; }
    if (zone === 'piezas') {
      const n = options.length;
      const move = (k: number) => { if (k < 0 || k >= n) return false; choosePiece(k); return true; };
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { move(Math.min(n - 1, cur + 1)); return true; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { move(Math.max(0, cur - 1)); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { move(cur - COLS); return true; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        if (cur + COLS < n) move(cur + COLS);
        else if (Math.floor(cur / COLS) < Math.floor((n - 1) / COLS)) move(n - 1);   // última fila, más corta
        else if (rows.length) { setZone('colores'); setRow(0); SFX.tick(); }
        return true;
      }
    } else {
      const r = rows[row]; if (!r) { if (e.code === 'ArrowUp') setZone('piezas'); return true; }
      const pal = [null, ...paletteOf(r, a.especie)];
      const current = Math.max(0, pal.indexOf(a.colors[r] ?? null));
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { setColor(r, pal[(current + 1) % pal.length]); return true; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setColor(r, pal[(current - 1 + pal.length) % pal.length]); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { if (row === 0) { if (slot !== 'colores') setZone('piezas'); } else setRow(row - 1); SFX.tick(); return true; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { setRow(Math.min(rows.length - 1, row + 1)); SFX.tick(); return true; }
    }
    return true;
  }, [a, cat, cur, zone, row, slot, options.length, rows.join(), saving]);

  const piece = a.pieces[slot as Slot] ? PIECE.get(a.pieces[slot as Slot]!) : null;
  return (
    <Device label={<>{t('panels.chromePaint')} · <b>{name.toUpperCase()}</b></>} width={74} height kind="aparato-probador" onClose={exit}>
      <div className="probador">
        <div className="probador-vista">
          <Preview look={a} focus={focus === 'cara' ? 'cabeza' : focus} onMount={(rg, pd) => { setRegions(rg); setDefault(pd); }} />
          <div className="probador-especie">
            <button className={'chip' + (a.especie === 'humano' ? ' activo' : '')} onClick={() => a.especie !== 'humano' && otherSpecies()}>{t('panels.human')}</button>
            <button className={'chip' + (a.especie === 'robot' ? ' activo' : '')} onClick={() => a.especie !== 'robot' && otherSpecies()}>{t('panels.robot')}</button>
            <span className="tenue"><kbd>H</kbd></span>
          </div>
          <div className="probador-acciones">
            <button className="chip" onClick={() => random()} title={t('panels.randomizeAllR')}>⚄ {t('panels.random')}</button>
            <button className="chip" onClick={undo} title={t('panels.undoZ')}>↶ {t('panels.undo')}</button>
            <button className="chip" onClick={() => change(structuredClone(stock))} title={t('panels.asItCameByDefault')}>{t('panels.default')}</button>
          </div>
        </div>
        <div className="probador-panel">
          <div className="probador-pestanas">
            {cats.map((c, k) => (
              <button key={c} className={'pestana-probador' + (k === cat ? ' activa' : '')} onClick={() => { setCat(k); SFX.tick(); }}>
                {c === 'colores' ? t('panels.colors') : tIs(SLOT_NAME[c])}
                {c !== 'colores' && a.pieces[c] && <i className="puesto" />}
              </button>
            ))}
          </div>
          {slot !== 'colores' && (
            <>
              <div className="probador-titulo">
                <h3>{tIs(SLOT_NAME[slot])}</h3>
                <span className="tenue">{t('panels.nOptions', { n: options.length - (REQUIRED.includes(slot) ? 0 : 1) })} · {piece ? <b className="ambar">{tIs(piece.name)}</b> : t('panels.nothing')}</span>
              </div>
              <div className={'probador-rejilla' + (zone === 'piezas' ? ' activa' : '')}>
                {options.map((p, k) => (
                  <Cell key={p?.id ?? 'nada'} piece={p} slot={slot} look={a} focus={focus}
                    cursor={zone === 'piezas' && k === cur} setting={k === setting} onChoose={() => { setZone('piezas'); choosePiece(k); }} />
                ))}
              </div>
            </>
          )}
          {rows.length > 0 && (
            <div className={'probador-colores' + (zone === 'colores' ? ' activa' : '') + (slot === 'colores' ? ' todos' : '')}>
              {slot === 'colores' && <h3>{t('panels.colors')}</h3>}
              {rows.map((r, k) => (
                <RowColor key={r} region={r} especie={a.especie} value={a.colors[r]} fallback={fallback[r]}
                  active={zone === 'colores' && k === row} onSet={c => { setZone('colores'); setRow(k); setColor(r, c); }} />
              ))}
            </div>
          )}
        </div>
      </div>
      <Keys>
        <kbd>Tab</kbd><kbd>Q</kbd><kbd>E</kbd>{t('panels.piece')} <kbd>←→↑↓</kbd>{t('panels.try')} <kbd>R</kbd>{t('panels.random2')} <kbd>⇧R</kbd>{t('panels.onlyThis')} <kbd>Z</kbd>{t('panels.undo2')} <kbd>H</kbd>{t('panels.humanRobot')} <kbd>,</kbd><kbd>.</kbd>{t('panels.rotate')} <kbd>Enter</kbd>{saving ? t('panels.saving') : t('windows.save2')} <kbd>Esc</kbd>{t('panels.leaveItAsItWas')}
      </Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- una opción con su miniatura
function Cell({ piece, slot, look, focus, cursor, setting, onChoose }: { piece: Piece | null; slot: Slot; look: Look; focus: Focus; cursor: boolean; setting: boolean; onChoose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // la miniatura: la figura con esta pieza puesta (sin sombrero si se mira el pelo, sin gafas si se mira la cara)
  const withPiece = useMemo(() => {
    let x = setPiece(look, slot, piece?.id ?? null);
    // (lo que tapa lo que se está eligiendo no sale en su miniatura)
    if (slot === 'pelo' || slot === 'cejas' || slot === 'barba' || slot === 'cara') x = setPiece(x, 'sombrero', null);
    if (slot === 'cara' || slot === 'cejas' || slot === 'barba') x = setPiece(x, 'gafas', null);
    // el pelo hecho para ir bajo su gorra, sin ella, tampoco
    if (x.pieces.pelo && PIECE.get(x.pieces.pelo)?.hidden && !x.pieces.sombrero) x = setPiece(x, 'pelo', null);
    return x;
  }, [lookSignature(look), piece?.id, slot]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let liveAlready = true; setUrl(null);
    thumbnail(withPiece, focus, () => liveAlready && !!ref.current?.isConnected).then(u => { if (liveAlready && u) setUrl(u); });
    return () => { liveAlready = false; };
  }, [lookSignature(withPiece), focus]);
  useEffect(() => { if (cursor) ref.current?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  return (
    <button ref={ref} className={'celda-probador' + (cursor ? ' cursor' : '') + (setting ? ' puesta' : '')} onClick={() => { SFX.click(); onChoose(); }}>
      <span className="foto">{url ? <img src={url} alt="" draggable={false} /> : <span className="cargando" />}{!piece && <span className="nada">∅</span>}</span>
      <span className="nombre">{piece ? tIs(piece.name) : t('windows.nothing')}</span>
    </button>
  );
}

// ---------------------------------------------------------------- una región de color con su paleta
function RowColor({ region, especie, value, fallback, active, onSet }: { region: Region; especie: 'humano' | 'robot'; value?: string; fallback?: string; active: boolean; onSet: (c: string | null) => void }) {
  const pal = paletteOf(region, especie);
  const own = !!value && !pal.includes(value);
  return (
    <div className={'fila-color' + (active ? ' activa' : '')}>
      <span className="etq">{tIs(nameRegion(region, especie))}</span>
      <div className="muestras">
        <button className={'muestra original' + (!value ? ' elegida' : '')} style={{ background: fallback ?? 'transparent' }} title={t('panels.thePieceSOwn')} onClick={() => onSet(null)}>↺</button>
        {pal.map(c => <button key={c} className={'muestra' + (value === c ? ' elegida' : '')} style={{ background: c }} onClick={() => onSet(c)} />)}
        <label className={'muestra libre' + (own ? ' elegida' : '')} style={own ? { background: value } : undefined} title={t('panels.anotherColor')}>
          +<input type="color" value={value ?? fallback ?? '#808080'} onChange={e => onSet(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- la vista grande, que se mueve
function Preview({ look, focus, onMount }: { look: Look; focus: Focus; onMount: (r: Set<number>, d: Partial<Record<Region, string>>) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const studio = useRef<Studio | null>(null);
  const focusRef = useRef(focus); focusRef.current = focus;
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const div = box.current!; const cv = document.createElement('canvas'); div.prepend(cv);
    const { width, height } = div.getBoundingClientRect();
    const e = new Studio(cv, Math.max(50, width), Math.max(50, height)); studio.current = e;
    let t0 = performance.now(), raf = 0;
    const loop = () => { const t = performance.now(); e.update(Math.min(0.05, (t - t0) / 1000)); t0 = t; raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => { const r = div.getBoundingClientRect(); if (r.width > 10 && r.height > 10) { e.r.setSize(r.width, r.height, false); e.cam.aspect = r.width / r.height; e.cam.updateProjectionMatrix(); e.frame(focusRef.current); } });
    ro.observe(div);
    // arrastrar para girar
    let x0: number | null = null;
    const below = (ev: PointerEvent) => { x0 = ev.clientX; div.setPointerCapture(ev.pointerId); };
    const onMove = (ev: PointerEvent) => { if (x0 === null) return; e.rotation += (ev.clientX - x0) * 0.012; x0 = ev.clientX; };
    const above = () => { x0 = null; };
    const rotate = (ev: any) => { e.rotation += ev.detail; };
    div.addEventListener('pointerdown', below); div.addEventListener('pointermove', onMove); div.addEventListener('pointerup', above);
    window.addEventListener('probador:girar', rotate);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('probador:girar', rotate); e.destroy(); cv.remove(); };
  }, []);
  // montar la figura nueva (un instante después: al pasar rápido por las opciones no se monta cada una)
  useEffect(() => {
    const e = studio.current; if (!e) return;
    let valid = true; setLoading(true);
    const tm = setTimeout(async () => {
      const first = !e.p;
      if (await e.set(look) && valid) { e.frame(focusRef.current, first); setLoading(false); if (e.p?.figure) onMount(e.p.figure.regions, e.p.figure.fallback); }
    }, 50);
    return () => { valid = false; clearTimeout(tm); };
  }, [lookSignature(look)]);
  useEffect(() => { const e = studio.current; if (!e) return; if (focus !== 'espalda' && e.rotation > 2) e.rotation = 0.35; e.frame(focus); }, [focus]);
  return <div className={'probador-lienzo' + (loading ? ' cargando' : '')} ref={box}><span className="pista-giro">{t('panels.dragToRotate')}</span></div>;
}

/** Una foto de cuerpo entero de un aspecto (la ficha del recluta) */
export function MiniPortrait({ look }: { look: Look }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let v = true; setUrl(null); thumbnail(look, 'cuerpo').then(u => { if (v && u) setUrl(u); }); return () => { v = false; }; }, [lookSignature(look)]);
  return <div className="retratillo">{url ? <img src={url} alt="" /> : <span className="cargando" />}</div>;
}

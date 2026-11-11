// Chapa y Pintura: el probador. Se elige a quién (el Supervisor o cualquier habitante menos la Octocat) y se le cambia
// todo: humano o robot, cara, cejas, pelo, barba, sombrero, gafas, torso, brazos, piernas, espalda, complementos y los
// colores de cada cosa. Cada pieza se ve en miniatura sobre el propio personaje, la vista grande se mueve con el ratón
// y el personaje del refugio se va vistiendo a la vez. Nada se guarda hasta pulsar Enter; Esc lo deja como estaba.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego } from './estadoJuego';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t, tIs } from '@shared/idioma';
import { Device, Opciones, Keys, closePanel, useMenu, useKeys } from './aparato';
import {
  lookOf, lookOnRandom, setPiece, piecesOf, fits, lookSignature, paletteOf, nameRegion,
  HUMAN_SLOTS, SLOTS_ROBOT, REQUIRED, COLORS_OF, SLOT_NAME, REGIONS, PIECE, STOCK,
  type Look, type Slot, type Region, type Piece,
} from '@shared/aspecto';
import { Estudio, FOCUS, miniatura, type Focus } from '../mundo/figura/estudio';

type Cat = Slot | 'colores';
const COLS = 5;

export function PanelBodyshop() {
  const datos = juego.usar(e => e.panelData);
  const [quien, setWho] = useState<string | null>(datos?.quien ?? null);
  if (!quien) return <ChooseClient elegir={q => { SFX.abrir(); setWho(q); }} />;
  return <Probador quien={quien} volver={datos?.quien ? closePanel : () => setWho(null)} />;
}

// ---------------------------------------------------------------- a quién se arregla
function ChooseClient({ elegir }: { elegir: (q: string) => void }) {
  const habitantes: any[] = vivo.usar(e => e.estado?.habitantes ?? []);
  const sup = vivo.usar(e => e.estado?.supervisor);
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  const items = [
    { texto: <><b>{t('world.you')}</b> · {sup?.nombre ?? t('panels.overseer')}</>, pista: tIs(lookOf({ tipo: sup?.personaje, aspecto: sup?.aspecto }).especie), q: 'supervisor', apagado: false },
    ...habitantes.map(h => ({
      texto: <>{h.nombre} <span className="tenue">«{h.mote}»</span></>,
      pista: h.tipo === 'Octocat' ? t('panels.itIsWhatItIs') : salas.find(s => s.id === h.salaId)?.nombre ?? '',
      q: h.id, apagado: h.tipo === 'Octocat',
    })),
  ];
  const ok = (k: number) => { const it = items[k]; if (!it || it.apagado) { SFX.noAllowed(); return; } elegir(it.q); };
  const [i, setI] = useMenu(items.length, ok);
  return (
    <Device rotulo={t('panels.chromePaintBarberShopAnd')} ancho={40} alto>
      <p className="voz">{t('panels.fitoSlipsTheScissorsInto')}</p>
      <div className="lista-desplazable"><Opciones items={items} i={i} setI={setI} onChoose={ok} /></div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.toTheChair')} <kbd>Esc</kbd>{t('windows.exit')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- el probador
function Probador({ quien, volver }: { quien: string; volver: () => void }) {
  const estado = vivo.get().estado;
  const ficha = quien === 'supervisor' ? null : (estado?.habitantes as any[] | undefined)?.find(h => h.id === quien);
  const nombre = quien === 'supervisor' ? (estado?.supervisor?.nombre ?? t('panels.overseer')) : ficha?.nombre ?? quien;
  const original = useMemo(() => quien === 'supervisor' ? lookOf({ tipo: estado?.supervisor?.personaje ?? 'Protagonist_B', aspecto: estado?.supervisor?.aspecto }) : lookOf(ficha ?? {}), []);
  const stock = useMemo(() => structuredClone(STOCK[quien === 'supervisor' ? estado?.supervisor?.personaje ?? 'Protagonist_B' : ficha?.tipo] ?? original), []);
  const [a, setA] = useState<Look>(original);
  const historial = useRef<Look[]>([]);
  const speciesBy = useRef<Partial<Record<string, Look>>>({ [original.especie]: original });
  const [cat, setCat] = useState(0);
  const [cur, setCur] = useState(0);
  const [zone, setZone] = useState<'piezas' | 'colores'>('piezas');
  const [fila, setRow] = useState(0);
  const [regions, setRegions] = useState<Set<number> | null>(null);
  const [porDefecto, setDefault] = useState<Partial<Record<Region, string>>>({});
  const [saving, setSaving] = useState(false);

  const cats: Cat[] = [...(a.especie === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS), 'colores'];
  const slot = cats[Math.min(cat, cats.length - 1)];
  const opciones: (Piece | null)[] = slot === 'colores' ? [] : [...(REQUIRED.includes(slot) ? [] : [null]), ...piecesOf(slot, a.especie).filter(p => fits(p, a.piezas))];
  const setting = slot === 'colores' ? -1 : opciones.findIndex(p => (p?.id ?? '') === (a.piezas[slot] ?? ''));
  const filas = (COLORS_OF[slot] ?? []).filter(r => !regions || regions.has(REGIONS.indexOf(r)));
  const enfoque: Focus = FOCUS[slot];

  // el cursor empieza en lo que lleva puesto
  useEffect(() => { setCur(Math.max(0, setting)); setZone(slot === 'colores' ? 'colores' : 'piezas'); setRow(0); }, [slot, a.especie]);

  // el personaje del refugio se viste a la vez (sin guardar)
  const probar = (x: Look) => window.dispatchEvent(new CustomEvent('refugio:probar', { detail: { quien, aspecto: x } }));
  const cambiar = (n: Look, sonido = true) => {
    if (lookSignature(n) === lookSignature(a)) return;
    historial.current.push(a); if (historial.current.length > 80) historial.current.shift();
    speciesBy.current[n.especie] = n;
    setA(n); probar(n); if (sonido) SFX.tick();
  };
  const deshacer = () => { const x = historial.current.pop(); if (!x) { SFX.noAllowed(); return; } setA(x); probar(x); SFX.conmutar(); };
  const salir = () => { probar(original); volver(); };
  const guardar = async () => {
    if (saving) return; setSaving(true);
    try { await cliente.accion('aspecto.guardar', { quien, aspecto: a }); SFX.success(); volver(); }
    catch (e: any) { SFX.noAllowed(); juego.set({ hint: { tecla: '', texto: String(e?.message ?? e) } }); setSaving(false); }
  };
  const otherSpecies = () => {
    const especie = a.especie === 'robot' ? 'humano' : 'robot';
    const n = speciesBy.current[especie] ?? structuredClone(especie === 'robot' ? STOCK.Robot_Two : STOCK.Hiker);
    cambiar(n); setCat(0); SFX.conmutar();
  };
  const azar = (solo?: Cat) => {
    const r = Math.random;
    if (!solo || solo === 'colores') {
      const n = lookOnRandom(r, a.especie);
      cambiar(solo === 'colores' ? { ...a, colores: n.colores } : n);
    } else {
      const lista = opciones.filter(p => (p?.id ?? '') !== (a.piezas[solo] ?? ''));
      const p = lista[Math.floor(r() * lista.length)];
      if (p !== undefined) cambiar(setPiece(a, solo, p?.id ?? null));
    }
  };
  const choosePiece = (k: number) => { const p = opciones[k]; if (p === undefined) return; setCur(k); cambiar(setPiece(a, slot as Slot, p?.id ?? null)); };
  const setColor = (r: Region, c: string | null) => { const n = { ...a, colores: { ...a.colores } }; if (c) n.colores[r] = c; else delete n.colores[r]; cambiar(n); };

  useKeys(e => {
    if (saving) return true;
    const sh = e.shiftKey;
    if (e.code === 'Escape') { salir(); return true; }
    if (e.code === 'Enter') { guardar(); return true; }
    if (e.code === 'Tab' || e.code === 'KeyE' || e.code === 'KeyQ') { const d = e.code === 'KeyQ' || (e.code === 'Tab' && sh) ? -1 : 1; setCat(c => (c + d + cats.length) % cats.length); SFX.tick(); return true; }
    if (e.code === 'KeyZ' || e.code === 'Backspace') { deshacer(); return true; }
    if (e.code === 'KeyR') { azar(sh ? slot : undefined); SFX.conmutar(); return true; }
    if (e.code === 'KeyH') { otherSpecies(); return true; }
    if (e.code === 'KeyO') { cambiar(structuredClone(stock)); SFX.conmutar(); return true; }
    if (e.code === 'Comma' || e.code === 'Period') { window.dispatchEvent(new CustomEvent('probador:girar', { detail: e.code === 'Comma' ? -0.4 : 0.4 })); return true; }
    if (zone === 'piezas') {
      const n = opciones.length;
      const mover = (k: number) => { if (k < 0 || k >= n) return false; choosePiece(k); return true; };
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { mover(Math.min(n - 1, cur + 1)); return true; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { mover(Math.max(0, cur - 1)); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { mover(cur - COLS); return true; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        if (cur + COLS < n) mover(cur + COLS);
        else if (Math.floor(cur / COLS) < Math.floor((n - 1) / COLS)) mover(n - 1);   // última fila, más corta
        else if (filas.length) { setZone('colores'); setRow(0); SFX.tick(); }
        return true;
      }
    } else {
      const r = filas[fila]; if (!r) { if (e.code === 'ArrowUp') setZone('piezas'); return true; }
      const pal = [null, ...paletteOf(r, a.especie)];
      const actual = Math.max(0, pal.indexOf(a.colores[r] ?? null));
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { setColor(r, pal[(actual + 1) % pal.length]); return true; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setColor(r, pal[(actual - 1 + pal.length) % pal.length]); return true; }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { if (fila === 0) { if (slot !== 'colores') setZone('piezas'); } else setRow(fila - 1); SFX.tick(); return true; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { setRow(Math.min(filas.length - 1, fila + 1)); SFX.tick(); return true; }
    }
    return true;
  }, [a, cat, cur, zone, fila, slot, opciones.length, filas.join(), saving]);

  const pieza = a.piezas[slot as Slot] ? PIECE.get(a.piezas[slot as Slot]!) : null;
  return (
    <Device rotulo={<>{t('panels.chromePaint')} · <b>{nombre.toUpperCase()}</b></>} ancho={74} alto clase="aparato-probador" onClose={salir}>
      <div className="probador">
        <div className="probador-vista">
          <Preview aspecto={a} enfoque={enfoque === 'cara' ? 'cabeza' : enfoque} onMount={(rg, pd) => { setRegions(rg); setDefault(pd); }} />
          <div className="probador-especie">
            <button className={'chip' + (a.especie === 'humano' ? ' activo' : '')} onClick={() => a.especie !== 'humano' && otherSpecies()}>{t('panels.human')}</button>
            <button className={'chip' + (a.especie === 'robot' ? ' activo' : '')} onClick={() => a.especie !== 'robot' && otherSpecies()}>{t('panels.robot')}</button>
            <span className="tenue"><kbd>H</kbd></span>
          </div>
          <div className="probador-acciones">
            <button className="chip" onClick={() => azar()} title={t('panels.randomizeAllR')}>⚄ {t('panels.random')}</button>
            <button className="chip" onClick={deshacer} title={t('panels.undoZ')}>↶ {t('panels.undo')}</button>
            <button className="chip" onClick={() => cambiar(structuredClone(stock))} title={t('panels.asItCameByDefault')}>{t('panels.default')}</button>
          </div>
        </div>
        <div className="probador-panel">
          <div className="probador-pestanas">
            {cats.map((c, k) => (
              <button key={c} className={'pestana-probador' + (k === cat ? ' activa' : '')} onClick={() => { setCat(k); SFX.tick(); }}>
                {c === 'colores' ? t('panels.colors') : tIs(SLOT_NAME[c])}
                {c !== 'colores' && a.piezas[c] && <i className="puesto" />}
              </button>
            ))}
          </div>
          {slot !== 'colores' && (
            <>
              <div className="probador-titulo">
                <h3>{tIs(SLOT_NAME[slot])}</h3>
                <span className="tenue">{t('panels.nOptions', { n: opciones.length - (REQUIRED.includes(slot) ? 0 : 1) })} · {pieza ? <b className="ambar">{tIs(pieza.nombre)}</b> : t('panels.nothing')}</span>
              </div>
              <div className={'probador-rejilla' + (zone === 'piezas' ? ' activa' : '')}>
                {opciones.map((p, k) => (
                  <Cell key={p?.id ?? 'nada'} pieza={p} slot={slot} aspecto={a} enfoque={enfoque}
                    cursor={zone === 'piezas' && k === cur} setting={k === setting} onChoose={() => { setZone('piezas'); choosePiece(k); }} />
                ))}
              </div>
            </>
          )}
          {filas.length > 0 && (
            <div className={'probador-colores' + (zone === 'colores' ? ' activa' : '') + (slot === 'colores' ? ' todos' : '')}>
              {slot === 'colores' && <h3>{t('panels.colors')}</h3>}
              {filas.map((r, k) => (
                <RowColor key={r} region={r} especie={a.especie} valor={a.colores[r]} porDefecto={porDefecto[r]}
                  activa={zone === 'colores' && k === fila} onSet={c => { setZone('colores'); setRow(k); setColor(r, c); }} />
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
function Cell({ pieza, slot, aspecto, enfoque, cursor, setting, onChoose }: { pieza: Piece | null; slot: Slot; aspecto: Look; enfoque: Focus; cursor: boolean; setting: boolean; onChoose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // la miniatura: la figura con esta pieza puesta (sin sombrero si se mira el pelo, sin gafas si se mira la cara)
  const withPiece = useMemo(() => {
    let x = setPiece(aspecto, slot, pieza?.id ?? null);
    // (lo que tapa lo que se está eligiendo no sale en su miniatura)
    if (slot === 'pelo' || slot === 'cejas' || slot === 'barba' || slot === 'cara') x = setPiece(x, 'sombrero', null);
    if (slot === 'cara' || slot === 'cejas' || slot === 'barba') x = setPiece(x, 'gafas', null);
    // el pelo hecho para ir bajo su gorra, sin ella, tampoco
    if (x.piezas.pelo && PIECE.get(x.piezas.pelo)?.oculta && !x.piezas.sombrero) x = setPiece(x, 'pelo', null);
    return x;
  }, [lookSignature(aspecto), pieza?.id, slot]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let liveAlready = true; setUrl(null);
    miniatura(withPiece, enfoque, () => liveAlready && !!ref.current?.isConnected).then(u => { if (liveAlready && u) setUrl(u); });
    return () => { liveAlready = false; };
  }, [lookSignature(withPiece), enfoque]);
  useEffect(() => { if (cursor) ref.current?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  return (
    <button ref={ref} className={'celda-probador' + (cursor ? ' cursor' : '') + (setting ? ' puesta' : '')} onClick={() => { SFX.clic(); onChoose(); }}>
      <span className="foto">{url ? <img src={url} alt="" draggable={false} /> : <span className="cargando" />}{!pieza && <span className="nada">∅</span>}</span>
      <span className="nombre">{pieza ? tIs(pieza.nombre) : t('windows.nothing')}</span>
    </button>
  );
}

// ---------------------------------------------------------------- una región de color con su paleta
function RowColor({ region, especie, valor, porDefecto, activa, onSet }: { region: Region; especie: 'humano' | 'robot'; valor?: string; porDefecto?: string; activa: boolean; onSet: (c: string | null) => void }) {
  const pal = paletteOf(region, especie);
  const propio = !!valor && !pal.includes(valor);
  return (
    <div className={'fila-color' + (activa ? ' activa' : '')}>
      <span className="etq">{t(nameRegion(region, especie))}</span>
      <div className="muestras">
        <button className={'muestra original' + (!valor ? ' elegida' : '')} style={{ background: porDefecto ?? 'transparent' }} title={t('panels.thePieceSOwn')} onClick={() => onSet(null)}>↺</button>
        {pal.map(c => <button key={c} className={'muestra' + (valor === c ? ' elegida' : '')} style={{ background: c }} onClick={() => onSet(c)} />)}
        <label className={'muestra libre' + (propio ? ' elegida' : '')} style={propio ? { background: valor } : undefined} title={t('panels.anotherColor')}>
          +<input type="color" value={valor ?? porDefecto ?? '#808080'} onChange={e => onSet(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- la vista grande, que se mueve
function Preview({ aspecto, enfoque, onMount }: { aspecto: Look; enfoque: Focus; onMount: (r: Set<number>, d: Partial<Record<Region, string>>) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const estudio = useRef<Estudio | null>(null);
  const enf = useRef(enfoque); enf.current = enfoque;
  const [cargando, setLoading] = useState(true);
  useEffect(() => {
    const div = caja.current!; const cv = document.createElement('canvas'); div.prepend(cv);
    const { width, height } = div.getBoundingClientRect();
    const e = new Estudio(cv, Math.max(50, width), Math.max(50, height)); estudio.current = e;
    let t0 = performance.now(), raf = 0;
    const bucle = () => { const t = performance.now(); e.actualizar(Math.min(0.05, (t - t0) / 1000)); t0 = t; raf = requestAnimationFrame(bucle); };
    raf = requestAnimationFrame(bucle);
    const ro = new ResizeObserver(() => { const r = div.getBoundingClientRect(); if (r.width > 10 && r.height > 10) { e.r.setSize(r.width, r.height, false); e.cam.aspect = r.width / r.height; e.cam.updateProjectionMatrix(); e.encuadrar(enf.current); } });
    ro.observe(div);
    // arrastrar para girar
    let x0: number | null = null;
    const abajo = (ev: PointerEvent) => { x0 = ev.clientX; div.setPointerCapture(ev.pointerId); };
    const mueve = (ev: PointerEvent) => { if (x0 === null) return; e.giro += (ev.clientX - x0) * 0.012; x0 = ev.clientX; };
    const arriba = () => { x0 = null; };
    const girar = (ev: any) => { e.giro += ev.detail; };
    div.addEventListener('pointerdown', abajo); div.addEventListener('pointermove', mueve); div.addEventListener('pointerup', arriba);
    window.addEventListener('probador:girar', girar);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('probador:girar', girar); e.destruir(); cv.remove(); };
  }, []);
  // montar la figura nueva (un instante después: al pasar rápido por las opciones no se monta cada una)
  useEffect(() => {
    const e = estudio.current; if (!e) return;
    let vale = true; setLoading(true);
    const tm = setTimeout(async () => {
      const primera = !e.p;
      if (await e.poner(aspecto) && vale) { e.encuadrar(enf.current, primera); setLoading(false); if (e.p?.figura) onMount(e.p.figura.regions, e.p.figura.porDefecto); }
    }, 50);
    return () => { vale = false; clearTimeout(tm); };
  }, [lookSignature(aspecto)]);
  useEffect(() => { const e = estudio.current; if (!e) return; if (enfoque !== 'espalda' && e.giro > 2) e.giro = 0.35; e.encuadrar(enfoque); }, [enfoque]);
  return <div className={'probador-lienzo' + (cargando ? ' cargando' : '')} ref={caja}><span className="pista-giro">{t('panels.dragToRotate')}</span></div>;
}

/** Una foto de cuerpo entero de un aspecto (la ficha del recluta) */
export function Retratillo({ aspecto }: { aspecto: Look }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let v = true; setUrl(null); miniatura(aspecto, 'cuerpo').then(u => { if (v && u) setUrl(u); }); return () => { v = false; }; }, [lookSignature(aspecto)]);
  return <div className="retratillo">{url ? <img src={url} alt="" /> : <span className="cargando" />}</div>;
}

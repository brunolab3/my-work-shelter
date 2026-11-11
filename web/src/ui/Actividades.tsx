// Actividades del refugio y lo que se lleva encima el Supervisor: inventario, guía de campo, tienda y récords (I);
// galería de tiro, hidroponía, radio y generador; y el cuaderno de las conversaciones (R).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel } from './estadoJuego';
import { t, tIs } from '@shared/idioma';
import { vivo, cliente } from '../red/cliente';
import { SFX, sonido } from '../audio/sonido';
import { Device, Opciones, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './aparato';
import { PIECES, HARVESTS, SHOP, SIGNALS, arma as weaponData } from '@shared/catalogo';
import type { LogInput } from '@shared/protocolo';
import { markdown } from './markdown';
import { ToolText, Visible } from './textoPlano';

export function PanelActivity({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'inventario': return <Inventario />;
    case 'galeria': return <Gallery />;
    case 'hidroponia': return <Hydroponics />;
    case 'radio': return <Radio />;
    case 'generador': return <Generador />;
    case 'cuaderno': return <Log />;
    default: return <Pending panel={panel} />;
  }
}
function Pending({ panel }: { panel: Panel }) {
  useKeys(e => { if (e.code === 'Escape') closePanel(); });
  return <Device rotulo={panel.toUpperCase()} ancho={40}><p className="tenue">{t('panels.thisDeviceDoesnTWork')}</p><Keys><kbd>Esc</kbd>{t('menu.close')}</Keys></Device>;
}
const gameAction = async (n: string, d: Record<string, unknown> = {}) => cliente.accion<any>('juego.' + n, d);
const usePlayer = () => vivo.usar(e => e.estado?.jugador ?? null);

// ---------------------------------------------------------------- inventario, guía, tienda, récords
const TABS = ['Inventario', 'Guía de campo', 'Tienda', 'Récords'] as const;
function Inventario() {
  const j = usePlayer();
  const dwellers = juego.usar(e => e.habitantes.filter(h => !h.robot));
  const sup = vivo.usar(e => e.estado?.supervisor);
  const [p, setP] = useState(0);
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState('');
  const [gift, setGift] = useState<string | null>(null);   // artículo que se está regalando: elegir habitante
  const inv: [string, number][] = Object.entries(j?.inventario ?? {}) as any;
  const filas: { texto: React.ReactNode; pista?: React.ReactNode; detalle: React.ReactNode; f?: () => void; f2?: () => void; apagado?: boolean }[] = useMemo(() => {
    if (!j) return [];
    if (p === 0) return inv.length ? inv.map(([k, n]) => {
      const pieza = PIECES.find(x => 'pieza:' + x.id === k); const cos = HARVESTS[k.slice(8)];
      const nombre = tIs(pieza?.nombre ?? cos?.nombre ?? k); const valor = pieza?.valor ?? cos?.valor ?? 1;
      return { texto: <>{nombre} <span className="tenue">×{n}</span></>, pista: t('panels.valorScrapEach', { valor }), detalle: <><p>{t(pieza?.texto ?? 'Recién cosechada en hidroponía.')}</p><p className="tenue">{t('panels.enterSellOneVSell')}</p></>, f: () => vender(k, 1), f2: () => vender(k, n) };
    }) : [{ texto: <span className="tenue">{t('panels.emptyPockets')}</span>, detalle: <p className="tenue">{t('panels.everyTaskADwellerFinishes')}</p> }];
    if (p === 1) return [
      ...PIECES.map(x => { const tiene = (j.inventario['pieza:' + x.id] ?? 0) > 0 || (j.views ?? []).includes(x.id); return { texto: tiene ? <>{tIs(x.nombre)} <span className={'rareza ' + x.rarity}>{tIs(x.rarity)}</span></> : <span className="tenue">??? <span className={'rareza ' + x.rarity}>{tIs(x.rarity)}</span></span>, detalle: tiene ? <p>{tIs(x.texto)}</p> : <p className="tenue">{t('panels.youHavenTFoundIt')}</p>, apagado: !tiene }; }),
      ...SIGNALS.map(s => { const tiene = (j.signals ?? []).includes(s.id); return { texto: tiene ? <>📻 {tIs(s.titulo)}</> : <span className="tenue">📻 {t('panels.signalNotPickedUp')}</span>, pista: tiene ? `${s.frecuencia.toFixed(1)} MHz` : '', detalle: tiene ? <p>{tIs(s.texto)}</p> : <p className="tenue">{t('panels.tuneTheCommunicationsRadio')}</p>, apagado: !tiene }; }),
    ];
    if (p === 2) return SHOP.map(a => {
      const tiene = (j.tienda ?? []).includes(a.id) || (j.armas ?? []).includes(a.id);
      const puesto = sup?.accesorios?.includes(a.id);
      return {
        texto: <>{tIs(a.nombre)} {tiene && <span className="tenue">· {a.tipo === 'accesorio' ? (puesto ? t('panels.youReWearingIt') : t('panels.yours')) : a.tipo === 'arma' ? (j.arma === a.id ? t('panels.inUse') : t('panels.yours2')) : t('panels.plantable')}</span>}</>,
        pista: tiene ? '' : t('panels.nScrap', { n: a.price }),
        detalle: <><p>{tIs(a.texto)}</p><p className="tenue">{tiene ? (a.tipo === 'accesorio' ? t('panels.enterPutItOnOr') : a.tipo === 'arma' ? t('panels.enterUseItInThe') : t('panels.youCanNowPlantIt')) : t('panels.enterBuyPrecioYouHave', { price: a.price, n: j.scrap })}</p></>,
        f: () => tiene ? (a.tipo === 'accesorio' ? equipar(a.id, 'supervisor') : a.tipo === 'arma' ? useWeapon(a.id) : undefined) : comprar(a.id),
        f2: tiene && a.tipo === 'accesorio' ? () => setGift(a.id) : undefined,
      };
    });
    const r = j.records ?? {};
    return [
      { texto: t('world.targetPractice'), pista: t('panels.nPoints', { n: r.tiro ?? 0 }), detalle: <p>{t('panels.bestRoundInTheShooting', { n: r.shootingRuns ?? 0 })}</p> },
      { texto: t('panels.radio'), pista: t('panels.nTotalSignals', { n: (j.signals ?? []).length, total: SIGNALS.length }), detalle: <p>{t('panels.transmissionsPickedUpFromThe')}</p> },
      { texto: t('panels.harvest'), pista: t('panels.nPieces', { n: r.cosecha ?? 0 }), detalle: <p>{t('panels.everythingHarvestedInHydroponics')}</p> },
      { texto: t('panels.tasksFinished'), pista: `${j.finishedTasks ?? 0}`, detalle: <p>{t('panels.realWorkByTheDwellers')}</p> },
      { texto: t('panels.toolCalls'), pista: `${j.toolsCalls ?? 0}`, detalle: <p>{t('panels.eachOneWatersTheCrops')}</p> },
      { texto: t('panels.generator'), pista: t('panels.nRepairs', { n: r.generador ?? 0 }), detalle: <p>{t('panels.reconnectionsOfTheCommandBridge')}</p> },
    ];
  }, [j, p, sup]);
  const aviso = (m: string, ok = true) => { setMsg(m); ok ? SFX.coins() : SFX.noAllowed(); };
  async function vender(k: string, n: number) { try { const r = await gameAction('vender', { objeto: k, n }); aviso(t('panels.nScrap2', { n: r.scrap })); } catch (e) { aviso((e as Error).message, false); } }
  async function comprar(id: string) { try { await gameAction('comprar', { article: id }); aviso(t('panels.bought')); } catch (e) { aviso((e as Error).message, false); } }
  async function equipar(id: string, quien: string) { try { await gameAction('equipar', { article: id, quien }); SFX.conmutar(); setMsg(''); } catch (e) { aviso((e as Error).message, false); } }
  async function useWeapon(id: string) { try { await gameAction('arma', { arma: id }); SFX.conmutar(); } catch (e) { aviso((e as Error).message, false); } }
  const sel = filas[Math.min(i, filas.length - 1)];
  useKeys(e => {
    if (gift) return false;
    if (e.code === 'Escape' || e.code === 'KeyI') closePanel();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Tab') { setP(x => (x + 1) % TABS.length); setI(0); setMsg(''); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setP(x => (x - 1 + TABS.length) % TABS.length); setI(0); setMsg(''); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(filas.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') sel?.f?.();
    else if ((e.code === 'KeyV' && p === 0) || (e.code === 'KeyG' && p === 2)) sel?.f2?.();
  }, [filas, i, p, gift]);
  if (!j) return null;
  return (
    <Device rotulo={t('panels.overseerSBackpack')} ancho={68}>
      <div className="pestanas">{TABS.map((x, k) => <button key={x} className={'chip' + (k === p ? ' on' : '')} onClick={() => { setP(k); setI(0); }}>{tIs(x)}</button>)}<span className="derecha chatarra-txt">⚙ {t('panels.nScrap', { n: j.scrap })}</span></div>
      <div className="feed">
        <ul className="feed-lista lista-desplazable lista-inv">{filas.map((f, k) => <li key={k} className={(k === i ? 'activa' : '') + (f.apagado ? ' vista' : '')} onMouseEnter={() => setI(k)} onClick={() => f.f?.()} ref={el => { if (k === i) el?.scrollIntoView({ block: 'nearest' }); }}><span className="titulo">{f.texto}</span><span className="cuando">{f.pista}</span></li>)}</ul>
        <div className="feed-detalle">{sel?.detalle}{msg && <p className="aviso-consola">{msg}</p>}</div>
      </div>
      {gift && <Gift article={gift} dwellers={dwellers} cerrar={() => setGift(null)} hecho={(n) => { setGift(null); setMsg(t('panels.nIsNowWearingIt', { n })); }} />}
      <Keys><kbd>←→</kbd>{t('panels.tab')} <kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{p === 0 ? t('panels.sell') : p === 2 ? t('panels.buyPutOn') : t('panels.view')} {p === 0 && <><kbd>V</kbd>{t('panels.sellAll')} </>}{p === 2 && <><kbd>G</kbd>{t('panels.give')} </>}<kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}
function Gift({ article, dwellers, cerrar, hecho }: { article: string; dwellers: { id: string; nombre: string; nameRoom: string }[]; cerrar: () => void; hecho: (n: string) => void }) {
  const items = dwellers.map(h => ({ texto: <><b>{h.nombre}</b> <span className="tenue">· {h.nameRoom}</span></> }));
  const elegir = async (k: number) => { const h = dwellers[k]; try { await gameAction('equipar', { article, quien: h.id }); SFX.shortSuccess(); hecho(h.nombre); } catch (e) { SFX.error(); cerrar(); } };
  const [i, setI] = useMenu(items.length, elegir, undefined, cerrar);
  return <div className="sub-aparato"><p>{t('panels.whoDoYouGiveIt')}</p><div className="lista-desplazable mini"><Opciones items={items} i={i} setI={setI} onChoose={elegir} /></div></div>;
}

// ---------------------------------------------------------------- galería de tiro
function Gallery() {
  const j = usePlayer();
  const [phase, setPhase] = useState<'menu' | 'jugando' | 'fin'>('menu');
  const [res, setRes] = useState<{ puntos: number; record: boolean; prize: number; mejor: number; aciertos: number; shots: number } | null>(null);
  const armas: string[] = j?.armas ?? ['ballesta'];
  const items: (ItemMenu & { f: () => void })[] = [
    { texto: t('panels.startA30SecondRound'), pista: t('panels.withArma', { arma: t(weaponData(j?.arma ?? 'ballesta').nombre).toLowerCase() }), f: () => setPhase('jugando') },
    ...(armas.length > 1 ? [{ texto: t('panels.switchWeapon'), pista: armas.map(a => tIs(weaponData(a).nombre)).join(' · '), f: () => { const k = (armas.indexOf(j.arma) + 1) % armas.length; gameAction('arma', { arma: armas[k] }); SFX.conmutar(); } }] : []),
    { texto: t('panels.maybeLater'), f: closePanel },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), e => (phase !== 'menu' ? false : undefined));
  if (phase === 'jugando') return <ShootingRound arma={j?.arma ?? 'ballesta'} fin={r => { setRes(r); setPhase('fin'); }} />;
  if (phase === 'fin' && res) return <ShootingEnd r={res} otra={() => setPhase('jugando')} />;
  return (
    <Device rotulo={t('panels.shootingGallery')} ancho={46}>
      <p className="voz">{t('panels.aimAtTheBugsNot')}</p>
      <p className="tenue">{t('panels.recordNPointsEvery12', { n: j?.records?.tiro ?? 0 })}</p>
      <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.accept')} <kbd>Esc</kbd>{t('windows.exit')}</Keys>
    </Device>
  );
}
function ShootingRound({ arma, fin }: { arma: string; fin: (r: any) => void }) {
  const ref = useRef({ x: 0, puntos: 0, t: 30, aciertos: 0, shots: 0, racha: 0, fin: false });
  const [, paint] = useState(0);
  const [flashes, setFlashes] = useState<{ id: number; x: number; texto: string }[]>([]);
  const r = (window as any).__refugio;
  useEffect(() => {
    r?.galeria.empezar(arma); juego.set({ hint: null });
    let ult = performance.now(); let raf = 0;
    const bucle = () => {
      const ahora = performance.now(); const dt = Math.min(0.1, (ahora - ult) / 1000); ult = ahora; const s = ref.current;
      const eje = (teclas.has('ArrowRight') || teclas.has('KeyD') ? 1 : 0) - (teclas.has('ArrowLeft') || teclas.has('KeyA') ? 1 : 0);
      s.x = Math.max(-0.95, Math.min(0.95, s.x + eje * dt * (teclas.has('ShiftLeft') ? 2.2 : 1.2)));
      s.t -= dt; if (s.t <= 0 && !s.fin) { s.fin = true; terminar(); return; }
      paint(n => n + 1); raf = requestAnimationFrame(bucle);
    };
    raf = requestAnimationFrame(bucle);
    const abajo = (e: KeyboardEvent) => teclas.add(e.code), arriba = (e: KeyboardEvent) => teclas.delete(e.code);
    addEventListener('keydown', abajo); addEventListener('keyup', arriba);
    const raton = (e: MouseEvent) => { ref.current.x = (e.clientX / innerWidth) * 2 - 1; };
    addEventListener('mousemove', raton);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', abajo); removeEventListener('keyup', arriba); removeEventListener('mousemove', raton); r?.galeria.terminar(); };
  }, []);
  const teclas = useMemo(() => new Set<string>(), []);
  const fire = () => {
    const s = ref.current; if (s.fin || !r) return;
    const res = r.galeria.fire(s.x); s.shots++;
    if (res.acierto) { s.racha++; const extra = s.racha >= 3 ? 5 * (s.racha - 2) : 0; s.puntos += res.puntos + extra; s.aciertos++; setFlashes(d => [...d.slice(-4), { id: Date.now(), x: s.x, texto: `+${res.puntos + extra}${s.racha >= 3 ? ' ' + t('panels.streakN', { n: s.racha }) : ''}` }]); }
    else s.racha = 0;
  };
  const terminar = async () => {
    const s = ref.current;
    try { const res = await gameAction('tiro', { puntos: s.puntos, arma }); if (res.record) SFX.prize(); else SFX.shortSuccess(); fin({ puntos: s.puntos, ...res, aciertos: s.aciertos, shots: s.shots }); }
    catch { fin({ puntos: s.puntos, record: false, prize: 0, mejor: 0, aciertos: s.aciertos, shots: s.shots }); }
  };
  useKeys(e => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { fire(); return true; }
    if (e.code === 'Escape') { ref.current.t = 0; return true; }
    return true;
  });
  const s = ref.current; const y = r?.galeria.heightMira() ?? 0;
  return (
    <div className="ronda-tiro interactivo" onMouseDown={e => { e.preventDefault(); fire(); }}>
      <div className="marcador-tiro"><span>⏱ {Math.max(0, s.t).toFixed(1)} s</span><b>{s.puntos}</b><span>{s.aciertos}/{s.shots} {t('panels.hits')}{s.racha >= 3 ? ' · ' + t('panels.streakN', { n: s.racha }) : ''}</span></div>
      <div className="mira" style={{ left: `${(s.x + 1) / 2 * 100}%`, top: `${(1 - y) / 2 * 100}%` }} />
      {flashes.map(d => <div key={d.id} className="destello-puntos" style={{ left: `${(d.x + 1) / 2 * 100}%`, top: `${(1 - y) / 2 * 100 - 8}%` }}>{d.texto}</div>)}
      <div className="ayuda-tiro"><kbd>←→</kbd> {t('panels.orMouseToAim')} · <kbd>{t('windows.space')}</kbd> {t('panels.orClickToShoot')} · <kbd>Esc</kbd> {t('panels.finish')}</div>
    </div>
  );
}
function ShootingEnd({ r, otra }: { r: any; otra: () => void }) {
  const items = [{ texto: t('panels.anotherRound') }, { texto: t('panels.putTheWeaponDown') }];
  const elegir = (k: number) => (k === 0 ? otra() : closePanel());
  const [i, setI] = useMenu(2, elegir);
  return (
    <Device rotulo={t('panels.galleryResult')} ancho={40} piloto={r.record ? 'trabajando' : 'ociosa'}>
      <div className="titulo-ficha">{t('panels.nPoints', { n: r.puntos })}</div>
      <p>{t('panels.aHitsOutOfD', { a: r.aciertos, d: r.shots })}{r.shots ? ` (${Math.round(r.aciertos / r.shots * 100)} %)` : ''}.</p>
      {r.record ? <p className="aviso-consola">{t('panels.newShelterRecord')}</p> : <p className="tenue">{t('panels.recordN', { n: r.mejor ?? 0 })}</p>}
      <p>+{t('panels.nScrap', { n: r.prize })}</p>
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
    </Device>
  );
}

// ---------------------------------------------------------------- hidroponía
function Hydroponics() {
  const j = usePlayer();
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState('');
  const cultivos: any[] = (j?.cultivos ?? []).slice(0, 3);
  const species: string[] = j?.species ?? ['Lettuce'];
  const [eleccion, setChoice] = useState<Record<number, string>>({});
  const c = cultivos[i];
  const elegida = eleccion[i] ?? c?.especie;
  const cosechar = async () => {
    if (!c) return;
    if (c.phase < 4) { SFX.noAllowed(); setMsg(t('panels.itIsnTRipeYet')); return; }
    try { const r = await gameAction('cosechar', { bancal: i, especie: elegida }); SFX.cosecha(); setMsg(t('panels.nCosechaToTheBackpack', { n: r.n, cosecha: t(r.cosecha ?? '').toLowerCase(), nueva: t(HARVESTS[elegida]?.nombre ?? '').toLowerCase() })); } catch (e) { setMsg((e as Error).message); }
  };
  const plantar = async () => { if (!c || elegida === c.especie) return; try { await gameAction('plantar', { bancal: i, especie: elegida }); SFX.cosecha(); setMsg(t('panels.bedNNowCultivo', { n: i + 1, cultivo: tIs(HARVESTS[elegida].nombre).toLowerCase() })); } catch (e) { setMsg((e as Error).message); } };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(cultivos.length - 1, x + 1)); SFX.tick(); setMsg(''); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); setMsg(''); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowLeft' || e.code === 'KeyA') { const d = e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : -1; const k = (species.indexOf(elegida) + d + species.length) % species.length; setChoice(x => ({ ...x, [i]: species[k] })); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') cosechar();
    else if (e.code === 'KeyP') plantar();
  }, [i, cultivos, elegida]);
  return (
    <Device rotulo={t('panels.hydroponicsBeds')} ancho={56}>
      <p className="voz">{t('panels.everyToolTheDwellersUse')}</p>
      <ul className="opciones-consola bancales">{cultivos.map((x, k) => (
        <li key={k} className={k === i ? 'activa' : ''} onMouseEnter={() => setI(k)} onClick={() => { setI(k); cosechar(); }}>
          <span className="cursor">{k === i ? '▶' : ' '}</span><span className="txt">{t('panels.bedN', { n: k + 1 })} <b>{t(HARVESTS[x.especie]?.nombre ?? '')}</b></span>
          <span className="fases">{[1, 2, 3, 4].map(f => <i key={f} className={f <= x.phase ? 'on' : ''} />)}{x.phase < 4 && <small> {x.progreso}/8</small>}</span>
          <small>{x.phase >= 4 ? t('panels.ripeEnterHarvests') : t('panels.growing')}</small>
        </li>))}</ul>
      <div className="fila-chips activa"><span className="etq">{t('panels.replantWith')}</span><button className="chip" onClick={() => setChoice(x => ({ ...x, [i]: species[(species.indexOf(elegida) - 1 + species.length) % species.length] }))}>◀</button><b className="eleccion">{t(HARVESTS[elegida]?.nombre ?? '')}</b><button className="chip" onClick={() => setChoice(x => ({ ...x, [i]: species[(species.indexOf(elegida) + 1) % species.length] }))}>▶</button>{elegida !== c?.especie && <span className="tenue">{t('panels.pPlantNowWhatWas')}</span>}</div>
      {msg && <p className="aviso-consola">{msg}</p>}
      <p className="tenue">{t('panels.moreSeedsInTheShop')}</p>
      <Keys><kbd>↑↓</kbd>{t('panels.bed')} <kbd>←→</kbd>{t('panels.species')} <kbd>Enter</kbd>{t('panels.harvest2')} <kbd>P</kbd>{t('panels.plant')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- radio
function Radio() {
  const j = usePlayer();
  const captadas: string[] = j?.signals ?? [];
  const [f, setF] = useState(95.0);
  const [fixed, setFixed] = useState(0);
  const [captured, setCaptured] = useState<typeof SIGNALS[number] | null>(null);
  const audio = useRef<ReturnType<typeof sonido.radio>>(null);
  const teclas = useRef(new Set<string>());
  const pendientes = SIGNALS.filter(s => !captadas.includes(s.id));
  const cerca = [...SIGNALS].sort((a, b) => Math.abs(a.frecuencia - f) - Math.abs(b.frecuencia - f))[0];
  const senal = Math.max(0, 1 - Math.abs(cerca.frecuencia - f) / 0.8);
  useEffect(() => { audio.current = sonido.radio(); return () => audio.current?.parar(); }, []);
  useEffect(() => { audio.current?.pin(senal * senal); }, [senal]);
  useEffect(() => {
    let raf = 0, ult = performance.now();
    const bucle = () => {
      const ahora = performance.now(), dt = Math.min(0.1, (ahora - ult) / 1000); ult = ahora;
      const t = teclas.current; const eje = (t.has('ArrowRight') || t.has('KeyD') ? 1 : 0) - (t.has('ArrowLeft') || t.has('KeyA') ? 1 : 0);
      if (eje) setF(x => Math.max(87.5, Math.min(108, x + eje * dt * (t.has('ShiftLeft') || t.has('ShiftRight') ? 4 : 0.7))));
      raf = requestAnimationFrame(bucle);
    };
    raf = requestAnimationFrame(bucle);
    const a = (e: KeyboardEvent) => teclas.current.add(e.code), b = (e: KeyboardEvent) => teclas.current.delete(e.code);
    addEventListener('keydown', a); addEventListener('keyup', b);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', a); removeEventListener('keyup', b); };
  }, []);
  // mantener la aguja en la emisora 1,5 s la capta
  useEffect(() => {
    if (senal < 0.85) { setFixed(0); return; }
    const t = setInterval(() => setFixed(x => x + 0.1), 100); return () => clearInterval(t);
  }, [senal > 0.85, cerca.id]);
  useEffect(() => {
    if (fixed >= 1.5 && captured?.id !== cerca.id) {
      setCaptured(cerca);
      gameAction('radio', { senal: cerca.id }).then(r => { if (r.nueva) SFX.prize(); }).catch(() => {});
    }
  }, [fixed]);
  useKeys(e => { if (e.code === 'Escape') closePanel(); return true; });
  const pct = (x: number) => ((x - 87.5) / (108 - 87.5)) * 100;
  return (
    <Device rotulo={t('panels.communicationsShortwaveRadio')} ancho={60} piloto={senal > 0.85 ? 'trabajando' : 'ociosa'}>
      <div className="dial">
        <div className="escala">{[88, 92, 96, 100, 104].map(m => <span key={m} style={{ left: `${pct(m)}%` }}>{m}</span>)}<span style={{ left: 'auto', right: '4px', transform: 'none' }}>108</span>{SIGNALS.filter(s => captadas.includes(s.id)).map(s => <i key={s.id} className="marca" style={{ left: `${pct(s.frecuencia)}%` }} />)}</div>
        <div className="aguja" style={{ left: `${pct(f)}%` }} />
      </div>
      <div className="lectura-radio"><b>{f.toFixed(1)} MHz</b><span className="medidor"><span style={{ width: `${senal * 100}%` }} /></span><span className="tenue">{senal > 0.85 ? (fixed >= 1.5 ? t('panels.signalPickedUp') : t('panels.tuning')) : senal > 0.3 ? t('panels.somethingSAudible') : t('panels.static')}</span></div>
      {captured && Math.abs(captured.frecuencia - f) < 0.6 ? <div className="transmision"><div className="titulo-ficha">{tIs(captured.titulo)}</div><p>{tIs(captured.texto)}</p></div> : <p className="tenue">{t('panels.turnTheDialSlowlyAnd')}</p>}
      <p className="tenue">{t('panels.nOfTotalSignalsIn', { n: captadas.length, total: SIGNALS.length })}{pendientes.length ? '' : ' · ' + t('panels.allOfThem')}.</p>
      <Keys><kbd>←→</kbd>{t('panels.turnTheDial')} (<kbd>Shift</kbd> {t('panels.fast')}) <kbd>Esc</kbd>{t('panels.turnOff')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- generador: reconectar las fases (puzle de interruptores)
function Generador() {
  const [estado, setState] = useState(() => newPuzzle());
  const [hecho, setDone] = useState(false);
  const [moves, setMoves] = useState(0);
  const [i, setI] = useState(0);
  const pulsar = (k: number) => {
    if (hecho) return;
    // cada interruptor cambia el suyo y los vecinos (como un panel mal cableado)
    const n = estado.map((v, x) => (x === k || x === k - 1 || x === k + 1 ? !v : v));
    setState(n); setMoves(m => m + 1); SFX.clank();
    if (n.every(Boolean)) { setDone(true); SFX.prize(); gameAction('generador', {}).catch(() => {}); }
  };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setI(x => Math.min(estado.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') pulsar(i);
    else if (e.code === 'KeyR') { setState(newPuzzle()); setDone(false); setMoves(0); }
  }, [estado, i, hecho]);
  return (
    <Device rotulo={t('panels.commandBridgePowerCore')} ancho={50} piloto={hecho ? 'trabajando' : 'error'}>
      <p className="voz">{hecho ? t('panels.phasesReconnectedInNMoves', { n: moves }) : t('panels.thePhasesAreCrossedEach')}</p>
      <div className="palancas">{estado.map((v, k) => <button key={k} className={'palanca' + (v ? ' on' : '') + (k === i ? ' activa' : '')} onMouseEnter={() => setI(k)} onClick={() => pulsar(k)}><span className="luz" /><span className="mango" /><small>F{k + 1}</small></button>)}</div>
      <Keys><kbd>←→</kbd>{t('panels.lever')} <kbd>Enter</kbd>{t('panels.operate')} <kbd>R</kbd>{t('panels.newWiring')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}
function newPuzzle(): boolean[] {
  // se parte de todo encendido y se aplican pulsaciones al azar: siempre tiene solución
  let e = Array(7).fill(true) as boolean[];
  for (let k = 0; k < 5; k++) { const p = Math.floor(Math.random() * 7); e = e.map((v, x) => (x === p || x === p - 1 || x === p + 1 ? !v : v)); }
  return e.every(Boolean) ? newPuzzle() : e;
}

// ---------------------------------------------------------------- cuaderno: transcripción completa de una conversación
function Log() {
  const sesiones = vivo.usar(e => e.sesiones);
  const dwellers = juego.usar(e => e.habitantes);
  const pedida = juego.usar(e => e.panelData?.sesionId);
  const lista = Object.values(sesiones).sort((a, b) => b.actualizada - a.actualizada);
  const [sel, setSel] = useState<string | null>(pedida ?? null);
  const items = lista.map(s => ({ texto: <><b>{dwellers.find(h => h.id === s.dwellerId)?.nombre ?? s.dwellerId}</b> <span className="tenue">· {s.titulo ?? t('panels.untitled')}</span></>, pista: tIs(s.estado) }));
  const [i, setI] = useMenu(items.length, k => setSel(lista[k].id), e => (sel ? false : undefined));
  if (sel) return <Transcript sesionId={sel} volver={() => (pedida ? closePanel() : setSel(null))} />;
  return (
    <Device rotulo={t('panels.logbook')} ancho={56}>
      {lista.length ? <Opciones items={items} i={i} setI={setI} onChoose={k => setSel(lista[k].id)} /> : <p className="tenue">{t('panels.thereAreNoConversationsIn')}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('windows.open')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}
function Transcript({ sesionId, volver }: { sesionId: string; volver: () => void }) {
  const [ents, setEntries] = useState<LogInput[] | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { cliente.ask<LogInput[]>({ t: 'cuaderno', sesionId }).then(setEntries).catch(() => setEntries([])); }, [sesionId]);
  useEffect(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [ents]);
  useKeys(e => {
    if (e.code === 'Escape' || e.code === 'KeyR') volver();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'PageDown') caja.current?.scrollBy({ top: e.code === 'PageDown' ? 400 : 60 });
    else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'PageUp') caja.current?.scrollBy({ top: e.code === 'PageUp' ? -400 : -60 });
    else if (e.code === 'Home') caja.current?.scrollTo({ top: 0 }); else if (e.code === 'End') caja.current?.scrollTo({ top: 1e9 });
  });
  return (
    <Device rotulo={t('panels.logbookFullTranscript')} ancho={72} alto onClose={volver}>
      <div ref={caja} className="lienzo cuaderno lista-desplazable">
        {ents === null ? <p className="tenue">{t('panels.openingTheLogbook')}</p> : ents.map((x, k) => <InputC key={k} e={x} />)}
      </div>
      <Keys><kbd>↑↓</kbd> <kbd>{t('panels.pgupPgdn')}</kbd>{t('panels.scroll')} <kbd>{t('panels.homeEnd')}</kbd> <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
function InputC({ e }: { e: LogInput }) {
  const x: any = e;
  if (x.tipo === 'usuario') return <div className="ent usuario"><span className="quien">{t('world.you')} › </span>{x.texto}</div>;
  if (x.tipo === 'asistente') return <div className="ent" dangerouslySetInnerHTML={{ __html: markdown(x.texto ?? '') }} />;
  if (x.tipo === 'herramienta') return <div className={'ent herramienta' + (x.esError ? ' error' : '') + (x.ayudante ? ' de-ayudante' : '')}>⚙ <ToolText t={String(x.texto ?? '')} /> {x.detalle && <code><Visible t={String(x.detalle).slice(0, 400)} /></code>}</div>;
  return <div className={'ent ' + (x.tipo ?? 'sistema')}>{x.texto}</div>;
}

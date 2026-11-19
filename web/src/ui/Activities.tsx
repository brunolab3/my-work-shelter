// Actividades del refugio y lo que se lleva encima el Supervisor: inventario, guía de campo, tienda y récords (I);
// galería de tiro, hidroponía, radio y generador; y el cuaderno de las conversaciones (R).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel } from './gameState';
import { t, tIs } from '@shared/language';
import { live, client } from '../net/client';
import { SFX, sound } from '../audio/sound';
import { Device, Options, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './device';
import { PIECES, HARVESTS, SHOP, SIGNALS, arma as weaponData } from '@shared/catalog';
import type { LogInput, SessionSummary } from '@shared/protocol';
import { recentFirst, sessionRecency } from '@shared/recent';
import { ACTIVITY_TABS, FRESH_HARVEST } from '@shared/labels';
import { markdown } from './markdown';
import { ToolText, Visible } from './plainText';

export function PanelActivity({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'inventario': return <Inventory />;
    case 'galeria': return <Gallery />;
    case 'hidroponia': return <Hydroponics />;
    case 'radio': return <Radio />;
    case 'generador': return <Generator />;
    case 'cuaderno': return <Log />;
    default: return <Pending panel={panel} />;
  }
}
function Pending({ panel }: { panel: Panel }) {
  useKeys(e => { if (e.code === 'Escape') closePanel(); });
  return <Device label={panel.toUpperCase()} width={40}><p className="tenue">{t('panels.thisDeviceDoesnTWork')}</p><Keys><kbd>Esc</kbd>{t('menu.close')}</Keys></Device>;
}
const gameAction = async (n: string, d: Record<string, unknown> = {}) => client.action<any>('juego.' + n, d);
const usePlayer = () => live.use(e => e.state?.jugador ?? null);

// ---------------------------------------------------------------- inventario, guía, tienda, récords
function Inventory() {
  const j = usePlayer();
  const dwellers = juego.use(e => e.dwellers.filter(h => !h.robot));
  const sup = live.use(e => e.state?.supervisor);
  const [p, setP] = useState(0);
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState('');
  const [gift, setGift] = useState<string | null>(null);   // artículo que se está regalando: elegir habitante
  const inv: [string, number][] = Object.entries(j?.inventario ?? {}) as any;
  const rows: { text: React.ReactNode; hint?: React.ReactNode; detail: React.ReactNode; f?: () => void; f2?: () => void; powerOff?: boolean }[] = useMemo(() => {
    if (!j) return [];
    if (p === 0) return inv.length ? inv.map(([k, n]) => {
      const piece = PIECES.find(x => 'pieza:' + x.id === k); const cos = HARVESTS[k.slice(8)];
      const name = tIs(piece?.nombre ?? cos?.nombre ?? k); const value = piece?.valor ?? cos?.valor ?? 1;
      return { text: <>{name} <span className="tenue">×{n}</span></>, hint: t('panels.valorScrapEach', { valor: value }), detail: <><p>{tIs(piece?.texto ?? FRESH_HARVEST)}</p><p className="tenue">{t('panels.enterSellOneVSell')}</p></>, f: () => vender(k, 1), f2: () => vender(k, n) };
    }) : [{ text: <span className="tenue">{t('panels.emptyPockets')}</span>, detail: <p className="tenue">{t('panels.everyTaskADwellerFinishes')}</p> }];
    if (p === 1) return [
      ...PIECES.map(x => { const has = (j.inventario['pieza:' + x.id] ?? 0) > 0 || (j.views ?? []).includes(x.id); return { text: has ? <>{tIs(x.nombre)} <span className={'rareza ' + x.rarity}>{tIs(x.rarity)}</span></> : <span className="tenue">??? <span className={'rareza ' + x.rarity}>{tIs(x.rarity)}</span></span>, detail: has ? <p>{tIs(x.texto)}</p> : <p className="tenue">{t('panels.youHavenTFoundIt')}</p>, powerOff: !has }; }),
      ...SIGNALS.map(s => { const has = (j.signals ?? []).includes(s.id); return { text: has ? <>📻 {tIs(s.titulo)}</> : <span className="tenue">📻 {t('panels.signalNotPickedUp')}</span>, hint: has ? `${s.frecuencia.toFixed(1)} MHz` : '', detail: has ? <p>{tIs(s.texto)}</p> : <p className="tenue">{t('panels.tuneTheCommunicationsRadio')}</p>, powerOff: !has }; }),
    ];
    if (p === 2) return SHOP.map(a => {
      const has = (j.tienda ?? []).includes(a.id) || (j.armas ?? []).includes(a.id);
      const workstation = sup?.accessories?.includes(a.id);
      return {
        text: <>{tIs(a.nombre)} {has && <span className="tenue">· {a.tipo === 'accesorio' ? (workstation ? t('panels.youReWearingIt') : t('panels.yours')) : a.tipo === 'arma' ? (j.arma === a.id ? t('panels.inUse') : t('panels.yours2')) : t('panels.plantable')}</span>}</>,
        hint: has ? '' : t('panels.nScrap', { n: a.price }),
        detail: <><p>{tIs(a.texto)}</p><p className="tenue">{has ? (a.tipo === 'accesorio' ? t('panels.enterPutItOnOr') : a.tipo === 'arma' ? t('panels.enterUseItInThe') : t('panels.youCanNowPlantIt')) : t('panels.enterBuyPrecioYouHave', { price: a.price, n: j.scrap })}</p></>,
        f: () => has ? (a.tipo === 'accesorio' ? equip(a.id, 'supervisor') : a.tipo === 'arma' ? useWeapon(a.id) : undefined) : buy(a.id),
        f2: has && a.tipo === 'accesorio' ? () => setGift(a.id) : undefined,
      };
    });
    const r = j.records ?? {};
    return [
      { text: t('world.targetPractice'), hint: t('panels.nPoints', { n: r.tiro ?? 0 }), detail: <p>{t('panels.bestRoundInTheShooting', { n: r.shootingRuns ?? 0 })}</p> },
      { text: t('panels.radio'), hint: t('panels.nTotalSignals', { n: (j.signals ?? []).length, total: SIGNALS.length }), detail: <p>{t('panels.transmissionsPickedUpFromThe')}</p> },
      { text: t('panels.harvest'), hint: t('panels.nPieces', { n: r.cosecha ?? 0 }), detail: <p>{t('panels.everythingHarvestedInHydroponics')}</p> },
      { text: t('panels.tasksFinished'), hint: `${j.finishedTasks ?? 0}`, detail: <p>{t('panels.realWorkByTheDwellers')}</p> },
      { text: t('panels.toolCalls'), hint: `${j.toolsCalls ?? 0}`, detail: <p>{t('panels.eachOneWatersTheCrops')}</p> },
      { text: t('panels.generator'), hint: t('panels.nRepairs', { n: r.generador ?? 0 }), detail: <p>{t('panels.reconnectionsOfTheCommandBridge')}</p> },
    ];
  }, [j, p, sup]);
  const notice = (m: string, ok = true) => { setMsg(m); ok ? SFX.coins() : SFX.notAllowed(); };
  async function vender(k: string, n: number) { try { const r = await gameAction('vender', { objeto: k, n }); notice(t('panels.nScrap2', { n: r.scrap })); } catch (e) { notice((e as Error).message, false); } }
  async function buy(id: string) { try { await gameAction('comprar', { article: id }); notice(t('panels.bought')); } catch (e) { notice((e as Error).message, false); } }
  async function equip(id: string, who: string) { try { await gameAction('equipar', { article: id, quien: who }); SFX.toggle(); setMsg(''); } catch (e) { notice((e as Error).message, false); } }
  async function useWeapon(id: string) { try { await gameAction('arma', { arma: id }); SFX.toggle(); } catch (e) { notice((e as Error).message, false); } }
  const sel = rows[Math.min(i, rows.length - 1)];
  useKeys(e => {
    if (gift) return false;
    if (e.code === 'Escape' || e.code === 'KeyI') closePanel();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Tab') { setP(x => (x + 1) % ACTIVITY_TABS.length); setI(0); setMsg(''); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setP(x => (x - 1 + ACTIVITY_TABS.length) % ACTIVITY_TABS.length); setI(0); setMsg(''); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(rows.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') sel?.f?.();
    else if ((e.code === 'KeyV' && p === 0) || (e.code === 'KeyG' && p === 2)) sel?.f2?.();
  }, [rows, i, p, gift]);
  if (!j) return null;
  return (
    <Device label={t('panels.overseerSBackpack')} width={68}>
      <div className="pestanas">{ACTIVITY_TABS.map((x, k) => <button key={x} className={'chip' + (k === p ? ' on' : '')} onClick={() => { setP(k); setI(0); }}>{tIs(x)}</button>)}<span className="derecha chatarra-txt">⚙ {t('panels.nScrap', { n: j.scrap })}</span></div>
      <div className="feed">
        <ul className="feed-lista lista-desplazable lista-inv">{rows.map((f, k) => <li key={k} className={(k === i ? 'activa' : '') + (f.powerOff ? ' vista' : '')} onMouseEnter={() => setI(k)} onClick={() => f.f?.()} ref={el => { if (k === i) el?.scrollIntoView({ block: 'nearest' }); }}><span className="titulo">{f.text}</span><span className="cuando">{f.hint}</span></li>)}</ul>
        <div className="feed-detalle">{sel?.detail}{msg && <p className="aviso-consola">{msg}</p>}</div>
      </div>
      {gift && <Gift article={gift} dwellers={dwellers} close={() => setGift(null)} done={(n) => { setGift(null); setMsg(t('panels.nIsNowWearingIt', { n })); }} />}
      <Keys><kbd>←→</kbd>{t('panels.tab')} <kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{p === 0 ? t('panels.sell') : p === 2 ? t('panels.buyPutOn') : t('panels.view')} {p === 0 && <><kbd>V</kbd>{t('panels.sellAll')} </>}{p === 2 && <><kbd>G</kbd>{t('panels.give')} </>}<kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}
function Gift({ article, dwellers, close, done }: { article: string; dwellers: { id: string; name: string; nameRoom: string }[]; close: () => void; done: (n: string) => void }) {
  const items = dwellers.map(h => ({ text: <><b>{h.name}</b> <span className="tenue">· {h.nameRoom}</span></> }));
  const pick = async (k: number) => { const h = dwellers[k]; try { await gameAction('equipar', { article, quien: h.id }); SFX.shortSuccess(); done(h.name); } catch (e) { SFX.error(); close(); } };
  const [i, setI] = useMenu(items.length, pick, undefined, close);
  return <div className="sub-aparato"><p>{t('panels.whoDoYouGiveIt')}</p><div className="lista-desplazable mini"><Options items={items} i={i} setI={setI} onChoose={pick} /></div></div>;
}

// ---------------------------------------------------------------- galería de tiro
function Gallery() {
  const j = usePlayer();
  const [phase, setPhase] = useState<'menu' | 'jugando' | 'fin'>('menu');
  const [res, setRes] = useState<{ points: number; record: boolean; prize: number; best: number; hits: number; shots: number } | null>(null);
  const armas: string[] = j?.armas ?? ['ballesta'];
  const items: (ItemMenu & { f: () => void })[] = [
    { text: t('panels.startA30SecondRound'), hint: t('panels.withArma', { arma: tIs(weaponData(j?.arma ?? 'ballesta').nombre).toLowerCase() }), f: () => setPhase('jugando') },
    ...(armas.length > 1 ? [{ text: t('panels.switchWeapon'), hint: armas.map(a => tIs(weaponData(a).nombre)).join(' · '), f: () => { const k = (armas.indexOf(j.arma) + 1) % armas.length; gameAction('arma', { arma: armas[k] }); SFX.toggle(); } }] : []),
    { text: t('panels.maybeLater'), f: closePanel },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), e => (phase !== 'menu' ? false : undefined));
  if (phase === 'jugando') return <ShootingRound arma={j?.arma ?? 'ballesta'} end={r => { setRes(r); setPhase('fin'); }} />;
  if (phase === 'fin' && res) return <ShootingEnd r={res} other={() => setPhase('jugando')} />;
  return (
    <Device label={t('panels.shootingGallery')} width={46}>
      <p className="voz">{t('panels.aimAtTheBugsNot')}</p>
      <p className="tenue">{t('panels.recordNPointsEvery12', { n: j?.records?.tiro ?? 0 })}</p>
      <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.accept')} <kbd>Esc</kbd>{t('windows.exit')}</Keys>
    </Device>
  );
}
function ShootingRound({ arma, end }: { arma: string; end: (r: any) => void }) {
  const ref = useRef({ x: 0, points: 0, t: 30, hits: 0, shots: 0, gust: 0, end: false });
  const [, paint] = useState(0);
  const [flashes, setFlashes] = useState<{ id: number; x: number; text: string }[]>([]);
  const r = (window as any).__shelter;
  useEffect(() => {
    r?.galeria.start(arma); juego.set({ hint: null });
    let ult = performance.now(); let raf = 0;
    const loop = () => {
      const now = performance.now(); const dt = Math.min(0.1, (now - ult) / 1000); ult = now; const s = ref.current;
      const axis = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      s.x = Math.max(-0.95, Math.min(0.95, s.x + axis * dt * (keys.has('ShiftLeft') ? 2.2 : 1.2)));
      s.t -= dt; if (s.t <= 0 && !s.end) { s.end = true; finish(); return; }
      paint(n => n + 1); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const below = (e: KeyboardEvent) => keys.add(e.code), above = (e: KeyboardEvent) => keys.delete(e.code);
    addEventListener('keydown', below); addEventListener('keyup', above);
    const mouse = (e: MouseEvent) => { ref.current.x = (e.clientX / innerWidth) * 2 - 1; };
    addEventListener('mousemove', mouse);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', below); removeEventListener('keyup', above); removeEventListener('mousemove', mouse); r?.galeria.finish(); };
  }, []);
  const keys = useMemo(() => new Set<string>(), []);
  const fire = () => {
    const s = ref.current; if (s.end || !r) return;
    const res = r.galeria.fire(s.x); s.shots++;
    if (res.accuracy) { s.gust++; const extra = s.gust >= 3 ? 5 * (s.gust - 2) : 0; s.points += res.points + extra; s.hits++; setFlashes(d => [...d.slice(-4), { id: Date.now(), x: s.x, text: `+${res.points + extra}${s.gust >= 3 ? ' ' + t('panels.streakN', { n: s.gust }) : ''}` }]); }
    else s.gust = 0;
  };
  const finish = async () => {
    const s = ref.current;
    try { const res = await gameAction('tiro', { puntos: s.points, arma }); if (res.record) SFX.prize(); else SFX.shortSuccess(); end({ points: s.points, ...res, hits: s.hits, shots: s.shots }); }
    catch { end({ points: s.points, record: false, prize: 0, best: 0, hits: s.hits, shots: s.shots }); }
  };
  useKeys(e => {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') { fire(); return true; }
    if (e.code === 'Escape') { ref.current.t = 0; return true; }
    return true;
  });
  const s = ref.current; const y = r?.galeria.sightHeight() ?? 0;
  return (
    <div className="ronda-tiro interactivo" onMouseDown={e => { e.preventDefault(); fire(); }}>
      <div className="marcador-tiro"><span>⏱ {Math.max(0, s.t).toFixed(1)} s</span><b>{s.points}</b><span>{s.hits}/{s.shots} {t('panels.hits')}{s.gust >= 3 ? ' · ' + t('panels.streakN', { n: s.gust }) : ''}</span></div>
      <div className="mira" style={{ left: `${(s.x + 1) / 2 * 100}%`, top: `${(1 - y) / 2 * 100}%` }} />
      {flashes.map(d => <div key={d.id} className="destello-puntos" style={{ left: `${(d.x + 1) / 2 * 100}%`, top: `${(1 - y) / 2 * 100 - 8}%` }}>{d.text}</div>)}
      <div className="ayuda-tiro"><kbd>←→</kbd> {t('panels.orMouseToAim')} · <kbd>{t('windows.space')}</kbd> {t('panels.orClickToShoot')} · <kbd>Esc</kbd> {t('panels.finish')}</div>
    </div>
  );
}
function ShootingEnd({ r, other }: { r: any; other: () => void }) {
  const items = [{ text: t('panels.anotherRound') }, { text: t('panels.putTheWeaponDown') }];
  const pick = (k: number) => (k === 0 ? other() : closePanel());
  const [i, setI] = useMenu(2, pick);
  return (
    <Device label={t('panels.galleryResult')} width={40} pilot={r.record ? 'trabajando' : 'ociosa'}>
      <div className="titulo-ficha">{t('panels.nPoints', { n: r.points })}</div>
      <p>{t('panels.aHitsOutOfD', { a: r.hits, d: r.shots })}{r.shots ? ` (${Math.round(r.hits / r.shots * 100)} %)` : ''}.</p>
      {r.record ? <p className="aviso-consola">{t('panels.newShelterRecord')}</p> : <p className="tenue">{t('panels.recordN', { n: r.mejor ?? 0 })}</p>}
      <p>+{t('panels.nScrap', { n: r.prize })}</p>
      <Options items={items} i={i} setI={setI} onChoose={pick} />
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
  const [choice, setChoice] = useState<Record<number, string>>({});
  const c = cultivos[i];
  const picked = choice[i] ?? c?.especie;
  const harvest = async () => {
    if (!c) return;
    if (c.phase < 4) { SFX.notAllowed(); setMsg(t('panels.itIsnTRipeYet')); return; }
    try { const r = await gameAction('cosechar', { bancal: i, especie: picked }); SFX.harvest(); setMsg(t('panels.nCosechaToTheBackpack', { n: r.n, cosecha: tIs(r.cosecha ?? '').toLowerCase(), nueva: tIs(HARVESTS[picked]?.nombre ?? '').toLowerCase() })); } catch (e) { setMsg((e as Error).message); }
  };
  const plant = async () => { if (!c || picked === c.especie) return; try { await gameAction('plantar', { bancal: i, especie: picked }); SFX.harvest(); setMsg(t('panels.bedNNowCultivo', { n: i + 1, cultivo: tIs(HARVESTS[picked].nombre).toLowerCase() })); } catch (e) { setMsg((e as Error).message); } };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(cultivos.length - 1, x + 1)); SFX.tick(); setMsg(''); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); setMsg(''); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowLeft' || e.code === 'KeyA') { const d = e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : -1; const k = (species.indexOf(picked) + d + species.length) % species.length; setChoice(x => ({ ...x, [i]: species[k] })); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') harvest();
    else if (e.code === 'KeyP') plant();
  }, [i, cultivos, picked]);
  return (
    <Device label={t('panels.hydroponicsBeds')} width={56}>
      <p className="voz">{t('panels.everyToolTheDwellersUse')}</p>
      <ul className="opciones-consola bancales">{cultivos.map((x, k) => (
        <li key={k} className={k === i ? 'activa' : ''} onMouseEnter={() => setI(k)} onClick={() => { setI(k); harvest(); }}>
          <span className="cursor">{k === i ? '▶' : ' '}</span><span className="txt">{t('panels.bedN', { n: k + 1 })} <b>{tIs(HARVESTS[x.especie]?.nombre ?? '')}</b></span>
          <span className="fases">{[1, 2, 3, 4].map(f => <i key={f} className={f <= x.phase ? 'on' : ''} />)}{x.phase < 4 && <small> {x.progreso}/8</small>}</span>
          <small>{x.phase >= 4 ? t('panels.ripeEnterHarvests') : t('panels.growing')}</small>
        </li>))}</ul>
      <div className="fila-chips activa"><span className="etq">{t('panels.replantWith')}</span><button className="chip" onClick={() => setChoice(x => ({ ...x, [i]: species[(species.indexOf(picked) - 1 + species.length) % species.length] }))}>◀</button><b className="eleccion">{tIs(HARVESTS[picked]?.nombre ?? '')}</b><button className="chip" onClick={() => setChoice(x => ({ ...x, [i]: species[(species.indexOf(picked) + 1) % species.length] }))}>▶</button>{picked !== c?.especie && <span className="tenue">{t('panels.pPlantNowWhatWas')}</span>}</div>
      {msg && <p className="aviso-consola">{msg}</p>}
      <p className="tenue">{t('panels.moreSeedsInTheShop')}</p>
      <Keys><kbd>↑↓</kbd>{t('panels.bed')} <kbd>←→</kbd>{t('panels.species')} <kbd>Enter</kbd>{t('panels.harvest2')} <kbd>P</kbd>{t('panels.plant')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- radio
function Radio() {
  const j = usePlayer();
  const capturedList: string[] = j?.signals ?? [];
  const [f, setF] = useState(95.0);
  const [fixed, setFixed] = useState(0);
  const [captured, setCaptured] = useState<typeof SIGNALS[number] | null>(null);
  const audio = useRef<ReturnType<typeof sound.radio>>(null);
  const keys = useRef(new Set<string>());
  const pending = SIGNALS.filter(s => !capturedList.includes(s.id));
  const near = [...SIGNALS].sort((a, b) => Math.abs(a.frecuencia - f) - Math.abs(b.frecuencia - f))[0];
  const signal = Math.max(0, 1 - Math.abs(near.frecuencia - f) / 0.8);
  useEffect(() => { audio.current = sound.radio(); return () => audio.current?.stop(); }, []);
  useEffect(() => { audio.current?.pin(signal * signal); }, [signal]);
  useEffect(() => {
    let raf = 0, ult = performance.now();
    const loop = () => {
      const now = performance.now(), dt = Math.min(0.1, (now - ult) / 1000); ult = now;
      const t = keys.current; const axis = (t.has('ArrowRight') || t.has('KeyD') ? 1 : 0) - (t.has('ArrowLeft') || t.has('KeyA') ? 1 : 0);
      if (axis) setF(x => Math.max(87.5, Math.min(108, x + axis * dt * (t.has('ShiftLeft') || t.has('ShiftRight') ? 4 : 0.7))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const a = (e: KeyboardEvent) => keys.current.add(e.code), b = (e: KeyboardEvent) => keys.current.delete(e.code);
    addEventListener('keydown', a); addEventListener('keyup', b);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', a); removeEventListener('keyup', b); };
  }, []);
  // mantener la aguja en la emisora 1,5 s la capta
  useEffect(() => {
    if (signal < 0.85) { setFixed(0); return; }
    const t = setInterval(() => setFixed(x => x + 0.1), 100); return () => clearInterval(t);
  }, [signal > 0.85, near.id]);
  useEffect(() => {
    if (fixed >= 1.5 && captured?.id !== near.id) {
      setCaptured(near);
      gameAction('radio', { senal: near.id }).then(r => { if (r.nueva) SFX.prize(); }).catch(() => {});
    }
  }, [fixed]);
  useKeys(e => { if (e.code === 'Escape') closePanel(); return true; });
  const pct = (x: number) => ((x - 87.5) / (108 - 87.5)) * 100;
  return (
    <Device label={t('panels.communicationsShortwaveRadio')} width={60} pilot={signal > 0.85 ? 'trabajando' : 'ociosa'}>
      <div className="dial">
        <div className="escala">{[88, 92, 96, 100, 104].map(m => <span key={m} style={{ left: `${pct(m)}%` }}>{m}</span>)}<span style={{ left: 'auto', right: '4px', transform: 'none' }}>108</span>{SIGNALS.filter(s => capturedList.includes(s.id)).map(s => <i key={s.id} className="marca" style={{ left: `${pct(s.frecuencia)}%` }} />)}</div>
        <div className="aguja" style={{ left: `${pct(f)}%` }} />
      </div>
      <div className="lectura-radio"><b>{f.toFixed(1)} MHz</b><span className="medidor"><span style={{ width: `${signal * 100}%` }} /></span><span className="tenue">{signal > 0.85 ? (fixed >= 1.5 ? t('panels.signalPickedUp') : t('panels.tuning')) : signal > 0.3 ? t('panels.somethingSAudible') : t('panels.static')}</span></div>
      {captured && Math.abs(captured.frecuencia - f) < 0.6 ? <div className="transmision"><div className="titulo-ficha">{tIs(captured.titulo)}</div><p>{tIs(captured.texto)}</p></div> : <p className="tenue">{t('panels.turnTheDialSlowlyAnd')}</p>}
      <p className="tenue">{t('panels.nOfTotalSignalsIn', { n: capturedList.length, total: SIGNALS.length })}{pending.length ? '' : ' · ' + t('panels.allOfThem')}.</p>
      <Keys><kbd>←→</kbd>{t('panels.turnTheDial')} (<kbd>Shift</kbd> {t('panels.fast')}) <kbd>Esc</kbd>{t('panels.turnOff')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- generador: reconectar las fases (puzle de interruptores)
function Generator() {
  const [state, setState] = useState(() => newPuzzle());
  const [done, setDone] = useState(false);
  const [moves, setMoves] = useState(0);
  const [i, setI] = useState(0);
  const press = (k: number) => {
    if (done) return;
    // cada interruptor cambia el suyo y los vecinos (como un panel mal cableado)
    const n = state.map((v, x) => (x === k || x === k - 1 || x === k + 1 ? !v : v));
    setState(n); setMoves(m => m + 1); SFX.clank();
    if (n.every(Boolean)) { setDone(true); SFX.prize(); gameAction('generador', {}).catch(() => {}); }
  };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setI(x => Math.min(state.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') press(i);
    else if (e.code === 'KeyR') { setState(newPuzzle()); setDone(false); setMoves(0); }
  }, [state, i, done]);
  return (
    <Device label={t('panels.commandBridgePowerCore')} width={50} pilot={done ? 'trabajando' : 'error'}>
      <p className="voz">{done ? t('panels.phasesReconnectedInNMoves', { n: moves }) : t('panels.thePhasesAreCrossedEach')}</p>
      <div className="palancas">{state.map((v, k) => <button key={k} className={'palanca' + (v ? ' on' : '') + (k === i ? ' activa' : '')} onMouseEnter={() => setI(k)} onClick={() => press(k)}><span className="luz" /><span className="mango" /><small>F{k + 1}</small></button>)}</div>
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
  const sessions = live.use(e => e.sessions);
  const dwellers = juego.use(e => e.dwellers);
  const requested = juego.use(e => e.panelData?.sessionId);
  // as listed: dweller, then title
  const recency = (s: SessionSummary) => sessionRecency(s, `${dwellers.find(h => h.id === s.dwellerId)?.name ?? s.dwellerId} ${s.title ?? ''}`);
  const list = Object.values(sessions).sort((a, b) => recentFirst(recency(a), recency(b)));
  const [sel, setSel] = useState<string | null>(requested ?? null);
  const items = list.map(s => ({ text: <><b>{dwellers.find(h => h.id === s.dwellerId)?.name ?? s.dwellerId}</b> <span className="tenue">· {s.title ?? t('panels.untitled')}</span></>, hint: tIs(s.state) }));
  const [i, setI] = useMenu(items.length, k => setSel(list[k].id), e => (sel ? false : undefined));
  if (sel) return <Transcript sessionId={sel} goBack={() => (requested ? closePanel() : setSel(null))} />;
  return (
    <Device label={t('panels.logbook')} width={56}>
      {list.length ? <Options items={items} i={i} setI={setI} onChoose={k => setSel(list[k].id)} /> : <p className="tenue">{t('panels.thereAreNoConversationsIn')}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('windows.open')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}
function Transcript({ sessionId, goBack }: { sessionId: string; goBack: () => void }) {
  const [ents, setEntries] = useState<LogInput[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { client.ask<LogInput[]>({ t: 'cuaderno', sessionId }).then(setEntries).catch(() => setEntries([])); }, [sessionId]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [ents]);
  useKeys(e => {
    if (e.code === 'Escape' || e.code === 'KeyR') goBack();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'PageDown') box.current?.scrollBy({ top: e.code === 'PageDown' ? 400 : 60 });
    else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'PageUp') box.current?.scrollBy({ top: e.code === 'PageUp' ? -400 : -60 });
    else if (e.code === 'Home') box.current?.scrollTo({ top: 0 }); else if (e.code === 'End') box.current?.scrollTo({ top: 1e9 });
  });
  return (
    <Device label={t('panels.logbookFullTranscript')} width={72} height onClose={goBack}>
      <div ref={box} className="lienzo cuaderno lista-desplazable">
        {ents === null ? <p className="tenue">{t('panels.openingTheLogbook')}</p> : ents.map((x, k) => <InputC key={k} e={x} />)}
      </div>
      <Keys><kbd>↑↓</kbd> <kbd>{t('panels.pgupPgdn')}</kbd>{t('panels.scroll')} <kbd>{t('panels.homeEnd')}</kbd> <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
function InputC({ e }: { e: LogInput }) {
  const x: any = e;
  if (x.type === 'usuario') return <div className="ent usuario"><span className="quien">{t('world.you')} › </span>{x.text}</div>;
  if (x.type === 'asistente') return <div className="ent" dangerouslySetInnerHTML={{ __html: markdown(x.text ?? '') }} />;
  if (x.type === 'herramienta') return <div className={'ent herramienta' + (x.isError ? ' error' : '') + (x.helper ? ' de-ayudante' : '')}>⚙ <ToolText t={String(x.text ?? '')} /> {x.detail && <code><Visible t={String(x.detail).slice(0, 400)} /></code>}</div>;
  return <div className={'ent ' + (x.type ?? 'sistema')}>{x.text}</div>;
}

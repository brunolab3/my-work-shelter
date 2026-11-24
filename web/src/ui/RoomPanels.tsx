// Aparatos propios de cada sala especial (puerta, panel de sala de repo; cámara acorazada, comunicaciones, planificación, logística
// y actividades en sus propios módulos; la música de la discoteca, en Disco.tsx).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel } from './gameState';
import { live, client } from '../net/client';
import { SFX } from '../audio/sound';
import { t, tIs, trBio } from '@shared/language';
import { Device, Options, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './device';
import { generateRecruit } from '@shared/recruits';
import { PLANNING_ROOM } from '@shared/layout';
import { REPO_TYPE } from '@shared/labels';
import { AREAS, SECTORS, sectorOf } from '@shared/sectors';
import { PanelCamera } from './Vault';
import { PanelCommunications, PanelPlanning, PanelLogistics, JiraBoard } from './Operations';
import { PanelActivity } from './Activities';
import { DeploymentBoard } from './Deploy';
import { OrganizeRooms } from './Organize';
import { PanelReview } from './Review';
import { openSpotify } from './Disco';
import { PanelBodyshop, MiniPortrait } from './FittingRoom';
import { lookOf, lookSummary } from '@shared/appearance';
import { goA } from './Panels';
import { idCopy } from './copies';
import { claimVisitors } from './Dialog';
import { openGit } from './git/window';
import type { InfoRepo } from '@shared/protocol';

// el resumen del aspecto (shared/appearance.ts) sale en español: se traduce por partes
const trSummary = (s: string) => { const k = s.indexOf(': '); return tIs(s.slice(0, k)) + ': ' + s.slice(k + 2).split(', ').map(x => tIs(x)).join(', '); };

// Remote Control de la sala (server/remoteControl.ts)
type StateRC = { state: 'apagado' | 'encendido' | 'aceptar' | 'error'; detail?: string; url?: string; name?: string };

export function RoomPanels({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'puerta': return <Gate />;
    case 'sala': return <RoomPanel />;
    case 'worktree': return <PanelWorktree />;
    case 'visitante': return <PanelVisitor />;
    case 'camara': return <PanelCamera />;
    case 'comunicaciones': return <PanelCommunications />;
    case 'planificacion': return <PanelPlanning />;
    case 'logistica': return <PanelLogistics />;
    case 'spotify': return <OpenSpotify />;
    case 'chapa': return <PanelBodyshop />;
    case 'organizar': return <OrganizeRooms />;
    case 'revision': return <PanelReview />;
    default: return <PanelActivity panel={panel} />;
  }
}

// ---------------------------------------------------------------- Puerta Principal: reclutar y excavar
type Suggestion = { path: string; name: string; isGit: boolean; type: string; modified: number; group?: string };
// the root's folders, most recent first, with the repos inside group folders as `group/repo`; the cap is for a root
// with lots of folders (the home folder) and only counts those, so a group's repos are never hidden by it
function suggestionItems(sugs: Suggestion[] | null, pick: (path: string, name: string) => void): (ItemMenu & { f: () => void })[] {
  let top = 0;
  return (sugs ?? []).filter(s => s.group || top++ < 40).map(s => ({ text: <>{s.group && <span className="tenue">{s.group}/</span>}<b>{s.name}</b> <span className="tenue">{s.isGit ? t('panels.repo') : t('panels.folder')} · {tIs(REPO_TYPE[s.type] ?? s.type)}</span></>, hint: ago(s.modified), f: () => pick(s.path, s.name) }));
}
function ago(ms: number) { const d = (Date.now() - ms) / 86400_000; return d < 1 ? t('panels.today') : d < 2 ? t('panels.yesterday') : d < 30 ? t('windows.nDaysAgo', { n: Math.floor(d) }) : d < 60 ? t('panels.1MonthAgo') : d < 365 ? t('windows.nMonthsAgo', { n: Math.floor(d / 30) }) : t('panels.overAYearAgo'); }

// each step is its own component, with its own menu and keys (the hooks of one step never depend on another's)
function Gate() {
  const root = live.use(e => e.state?.reposRoot ?? '~');
  const [step, setStep] = useState<{ type: 'lista' } | { type: 'ruta'; create: boolean } | { type: 'recluta'; path: string; name: string; create?: boolean; git?: boolean } | { type: 'github' } | { type: 'clonar'; repo: string; name: string }>({ type: 'lista' });
  if (step.type === 'recluta') return <CardNewRecruit {...step} goBack={() => setStep({ type: 'lista' })} />;
  if (step.type === 'github') return <GitHubList goBack={() => setStep({ type: 'lista' })} clone={(repo, name) => setStep({ type: 'clonar', repo, name })} admit={(path, name) => setStep({ type: 'recluta', path, name })} />;
  if (step.type === 'clonar') return <CloneRepo repo={step.repo} name={step.name} root={root} goBack={() => setStep({ type: 'github' })} follow={path => setStep({ type: 'recluta', path, name: step.name })} />;
  if (step.type === 'ruta') return <AskPath create={step.create} root={root} goBack={() => setStep({ type: 'lista' })} follow={(path, git) => setStep({ type: 'recluta', path, name: path.split('/').filter(Boolean).pop() ?? path, create: step.create, git })} />;
  return <DoorList root={root} pick={(path, name) => setStep({ type: 'recluta', path, name })} path={create => setStep({ type: 'ruta', create })} github={() => setStep({ type: 'github' })} />;
}
function DoorList({ root, pick, path, github }: { root: string; pick: (path: string, name: string) => void; path: (create: boolean) => void; github: () => void }) {
  const [sugs, setSuggestions] = useState<Suggestion[] | null>(null);
  useEffect(() => { client.action<Suggestion[]>('suggestions').then(setSuggestions).catch(() => setSuggestions([])); }, []);
  const items: (ItemMenu & { f: () => void })[] = [
    ...suggestionItems(sugs, pick),
    { text: t('panels.anotherFolderTypeThePath'), hint: t('panels.anyPathOnThisMac'), f: () => path(false) },
    { text: t('panels.createANewFolderOr'), hint: t('panels.insideRaiz', { raiz: root }), f: () => path(true) },
    { text: t('panels.fromGitHub'), hint: t('panels.fromGitHubHint'), f: github },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device label={t('panels.mainDoorRecruitment')} width={52}>
      <p className="voz">{t('panels.everyFolderYouAdmitIs')}</p>
      <p className="tenue">{t('panels.suggestionsFrom')} <code>{root}</code> {t('panels.mostRecentFirstTheRoot')}</p>
      <div className="lista-desplazable">
        {sugs === null ? <p className="tenue">{t('panels.readingRaiz', { raiz: root })}</p> : <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />}
      </div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.admit')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

function AskPath({ create, root, goBack, follow }: { create: boolean; root: string; goBack: () => void; follow: (path: string, git: boolean) => void }) {
  const [text, setText] = useState(create ? '' : root.replace(/\/?$/, '/'));
  const [git, setGit] = useState(true);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useKeys(e => { if (e.code === 'Escape') goBack(); });
  const path = create ? root.replace(/\/?$/, '/') + text.trim() : text.trim();
  const valid = create ? /^[\w.\-áéíóúñ ]+$/i.test(text.trim()) : text.trim().length > 1;
  return (
    <Device label={create ? t('panels.doorNewFolder') : t('panels.doorAnotherFolder')} width={52} onClose={goBack}>
      <p>{create ? t('panels.nameOfTheNewFolder') : t('panels.folderPath')}</p>
      <div className="linea-entrada activa">
        <span className="prompt-sim">{create ? root.replace(/\/?$/, '/') : '›'}</span>
        <input ref={ref} className="campo" value={text} onChange={e => setText(e.target.value)} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && valid) { e.preventDefault(); SFX.click(); follow(path, git); } else if (e.key === 'Escape') { e.preventDefault(); goBack(); } else if (e.key === 'Tab' && create) { e.preventDefault(); setGit(g => !g); } }} />
      </div>
      {create && <div className="fila-chips activa"><span className="etq">git init</span><button className={'chip' + (git ? ' on' : '')} onClick={() => setGit(true)}>{t('menu.yes')}</button><button className={'chip' + (!git ? ' on' : '')} onClick={() => setGit(false)}>{t('menu.no')}</button></div>}
      <Keys><kbd>Enter</kbd>{t('panels.continue2')} {create && <><kbd>Tab</kbd>{t('panels.gitYesNo')} </>}<kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// From GitHub: your repos (and your organisations'), filtered as you type, or owner/name or a URL pasted; one already on
// the Mac is admitted from its folder, the rest go to the clone step (server/githubClone.ts)
type RepoGitHub = { repo: string; name: string; isPrivate: boolean; archived: boolean; description: string; pushed: number; cloned?: { path: string; corta: string; room?: string } };
const githubRef = (s: string) => /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])?[\w.-]+\/[\w.-]+?(?:\.git)?\/?$/i.test(s.trim()) || /github\.com\/[\w.-]+\/[\w.-]+/i.test(s);
function GitHubList({ goBack, clone, admit }: { goBack: () => void; clone: (repo: string, name: string) => void; admit: (path: string, name: string) => void }) {
  const [data, setData] = useState<{ repos: RepoGitHub[]; off?: boolean; error?: string } | null>(null);
  const [text, setText] = useState('');
  const [i, setI] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); client.action<{ repos: RepoGitHub[]; off?: boolean; error?: string }>('github.repos').then(setData).catch(err => setData({ repos: [], error: (err as Error).message })); }, []);
  useKeys(e => { if (e.code === 'Escape') goBack(); });
  const pick = (r: RepoGitHub) => {
    if (r.cloned?.room) { SFX.error(); setError(t('panels.githubIsRoom', { sala: r.cloned.room })); return; }
    SFX.click();
    if (r.cloned) admit(r.cloned.path, r.cloned.path.split('/').filter(Boolean).pop() ?? r.name); else clone(r.repo, r.name);
  };
  // owner/name or a URL: checked on the server (it exists, you can read it, it's already cloned)
  const open = async () => {
    if (busy) return; setBusy(true); setError('');
    try { pick(await client.action<RepoGitHub>('github.repo', { text })); }
    catch (err) { SFX.error(); setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const q = text.trim().toLowerCase();
  const list = (data?.repos ?? []).filter(r => !q || r.repo.toLowerCase().includes(q)).slice(0, 60);
  const exact = list.some(r => q.endsWith(r.repo.toLowerCase()) || q.replace(/\.git\/?$|\/$/, '').endsWith(r.repo.toLowerCase()));
  const items: (ItemMenu & { f: () => void })[] = [
    ...(githubRef(text) && !exact ? [{ text: t('panels.githubOpenRef', { repo: text.trim() }), f: open }] : []),
    ...list.map(r => ({
      text: <><b>{r.repo}</b> {(r.isPrivate || r.archived) && <span className="tenue">· {[r.isPrivate && t('panels.githubPrivate'), r.archived && t('panels.githubArchived')].filter(Boolean).join(' · ')}</span>}</>,
      hint: r.cloned ? (r.cloned.room ? t('panels.githubIsRoom', { sala: r.cloned.room }) : t('panels.githubClonedAt', { ruta: r.cloned.corta })) : r.pushed ? t('panels.githubPushed', { cuando: ago(r.pushed) }) : undefined,
      powerOff: !!r.cloned?.room,
      f: () => pick(r),
    })),
  ];
  const k = Math.min(i, Math.max(0, items.length - 1));
  return (
    <Device label={t('panels.doorGitHub')} width={56} onClose={goBack}>
      <p>{t('panels.githubFilter')}</p>
      <div className="linea-entrada activa">
        <span className="prompt-sim">›</span>
        <input ref={ref} className="campo" value={text} spellCheck={false} placeholder="owner/name"
          onChange={e => { setText(e.target.value); setI(0); setError(''); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setI((k + 1) % items.length); SFX.tick(); }
            else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setI((k - 1 + items.length) % items.length); SFX.tick(); }
            else if (e.key === 'Enter' && items[k]) { e.preventDefault(); items[k].f(); }
            else if (e.key === 'Escape') { e.preventDefault(); goBack(); }
          }} />
      </div>
      {data?.off && <p className="tenue">{t('panels.githubOff')}</p>}
      {data?.error && <p className="aviso-consola">{data.error}</p>}
      {error && <p className="aviso-consola">{error}</p>}
      <div className="lista-desplazable">
        {items.length > 0 && <Options items={items} i={k} setI={setI} onChoose={n => items[n].f()} />}
        {data === null ? <p className="tenue">{t('panels.githubReading')}</p> : !items.length && !data.off && <p className="tenue">{t('panels.githubNoMatch')}</p>}
      </div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.continue2')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// The clone: its folder (editable; the root by default, a group subfolder too), then git clone's progress; done, on to
// the recruit sheet. Esc while cloning cancels it (git removes the half-made folder)
type StateClone = { id: string; path: string; state: 'clonando' | 'hecho' | 'error' | 'cancelado'; line: string; pct?: number; error?: string };
function CloneRepo({ repo, name, root, goBack, follow }: { repo: string; name: string; root: string; goBack: () => void; follow: (path: string) => void }) {
  const [text, setText] = useState(root.replace(/\/?$/, '/') + name);
  const [error, setError] = useState('');
  const [clone, setClone] = useState<StateClone | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (clone?.state !== 'clonando') return;
    const h = setInterval(() => client.action<StateClone>('github.cloneStatus', { id: clone.id }).then(c => {
      if (c.state === 'hecho') { clearInterval(h); SFX.shortSuccess(); follow(c.path); }
      else if (c.state === 'clonando') setClone(c);
      else { clearInterval(h); SFX.error(); setClone(null); setError(c.error ?? ''); setTimeout(() => ref.current?.focus()); }
    }).catch(() => {}), 500);
    return () => clearInterval(h);
  }, [clone?.id, clone?.state]);
  const cancel = () => { if (clone) client.action('github.cancel', { id: clone.id }).catch(() => {}); setClone(null); setTimeout(() => ref.current?.focus()); };
  useKeys(e => { if (e.code === 'Escape') { if (clone) cancel(); else goBack(); } });
  const start = async () => {
    if (clone || !text.trim()) return; setError('');
    try { setClone(await client.action<StateClone>('github.clone', { repo, path: text.trim() })); SFX.click(); }
    catch (err) { SFX.error(); setError((err as Error).message); }
  };
  const pct = clone?.pct ?? 0, bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  return (
    <Device label={t('panels.doorClone', { repo })} pilot={clone ? 'trabajando' : 'ociosa'} width={56} onClose={clone ? cancel : goBack}>
      <p>{t('panels.cloneWhere', { raiz: root })}</p>
      <div className={'linea-entrada' + (clone ? '' : ' activa')}>
        <span className="prompt-sim">›</span>
        <input ref={ref} className="campo" value={text} spellCheck={false} disabled={!!clone} onChange={e => { setText(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); start(); } else if (e.key === 'Escape') { e.preventDefault(); goBack(); } }} />
      </div>
      {clone ? <>
        <p>{t('panels.cloning', { repo })}</p>
        <p><code>{bar}</code> {clone.pct !== undefined ? `${clone.pct}%` : ''}</p>
        <p className="tenue">{clone.line}</p>
      </> : <p className="tenue">{t('panels.cloneCredentials')}</p>}
      {error && <p className="aviso-consola">{error}</p>}
      <Keys>{clone ? <><kbd>Esc</kbd>{t('panels.cloneCancel')}</> : <><kbd>Enter</kbd>{t('panels.cloneStart')} <kbd>Esc</kbd>{t('menu.back')}</>}</Keys>
    </Device>
  );
}

function CardNewRecruit({ path, name, create, git, goBack }: { path: string; name: string; create?: boolean; git?: boolean; goBack: () => void }) {
  const used = juego.use(e => e.dwellers.map(h => h.name.toLowerCase()));
  const [seed, setSeed] = useState(() => (Date.now() % 1e9) | 0);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const types = juego.use(e => e.dwellers.map(h => h.type));
  const r = useMemo(() => generateRecruit(seed, used, false, types), [seed]);
  const admit = async () => {
    if (sending) return; setSending(true); setError('');
    try { await client.action('recruit', { path, create, git, dweller: { ...r, roomId: '' } }); SFX.shortSuccess(); closePanel(); }
    catch (err) { SFX.error(); setError((err as Error).message); setSending(false); }
  };
  const items: ItemMenu[] = [{ text: <>{t('panels.digOutTheRoom')} <b>{name}</b> {t('panels.andWelcomeThem')}</> }, { text: t('panels.sendInAnotherRecruit'), hint: 'R' }, { text: t('windows.back') }];
  const pick = (k: number) => { if (k === 0) admit(); else if (k === 1) { setSeed(x => x * 7 + 13); SFX.tick(); } else goBack(); };
  const [i, setI] = useMenu(items.length, pick, e => { if (e.code === 'KeyR') { setSeed(x => x * 7 + 13); SFX.tick(); return true; } }, goBack);
  return (
    <Device label={t('panels.doorRecruitSheet')} width={50} onClose={goBack}>
      <div className="ficha con-retrato">
        <MiniPortrait look={lookOf(r)} />
        <div className="titulo-ficha">{r.name} <span className="mote">«{tIs(r.nickname)}»</span></div>
        <dl>
          <dt>{t('panels.room')}</dt><dd>{name} <span className="tenue">({path}{create ? t('panels.itWillBeCreated') + (git ? t('panels.withGit') : '') : ''})</span></dd>
          <dt>{t('panels.look')}</dt><dd>{trSummary(lookSummary(lookOf(r)))} <span className="tenue">{t('panels.inChromePaintYouCan')}</span></dd>
          <dt>{t('panels.backstory')}</dt><dd>{trBio(r.bio)}</dd>
          <dt>{t('panels.work')}</dt><dd>{t('panels.realClaudeCodeSessionsIn')}</dd>
        </dl>
      </div>
      {error && <p className="aviso-consola">{error}</p>}
      <Options items={items} i={i} setI={setI} onChoose={pick} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>R</kbd>{t('panels.anotherRecruit')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
// la sala pasa a otra carpeta: las sugerencias de la raíz de repos (como en la Puerta) u otra ruta escrita a mano, y
// luego la confirmación (cada paso, su componente: cada uno con su menú y sus teclas)
function LinkRoom({ room, example, goBack }: { room: any; example: boolean; goBack: () => void }) {
  const root = live.use(e => e.state?.reposRoot ?? '~');
  const [step, setStep] = useState<{ type: 'lista' } | { type: 'ruta' } | { type: 'confirmar'; path: string; name: string }>({ type: 'lista' });
  const pick = (path: string, name = path.split('/').filter(Boolean).pop() ?? path) => setStep({ type: 'confirmar', path, name });
  if (step.type === 'ruta') return <AskPath create={false} root={root} goBack={() => setStep({ type: 'lista' })} follow={path => pick(path)} />;
  if (step.type === 'confirmar') return <ConfirmLink room={room} example={example} path={step.path} name={step.name} goBack={() => setStep({ type: 'lista' })} />;
  return <LinkList room={room} root={root} pick={pick} other={() => setStep({ type: 'ruta' })} goBack={goBack} />;
}
function LinkList({ room, root, pick, other, goBack }: { room: any; root: string; pick: (path: string, name: string) => void; other: () => void; goBack: () => void }) {
  const [sugs, setSuggestions] = useState<Suggestion[] | null>(null);
  useEffect(() => { client.action<Suggestion[]>('suggestions').then(setSuggestions).catch(() => setSuggestions([])); }, []);
  const items: (ItemMenu & { f: () => void })[] = [
    ...suggestionItems(sugs, pick),
    { text: t('panels.anotherFolderTypeThePath'), hint: t('panels.anyPathOnThisMac'), f: other },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), undefined, goBack);
  return (
    <Device label={t('panels.roomPanelSalaLink', { sala: room.name })} width={52} onClose={goBack}>
      <p className="tenue">{t('panels.pickTheRoomSNew')} <code>{root}</code> {t('panels.mostRecentFirstThoseThat')}</p>
      <div className="lista-desplazable">
        {sugs === null ? <p className="tenue">{t('panels.readingRaiz', { raiz: root })}</p> : <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />}
      </div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.continue2')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
function ConfirmLink({ room, example, path, name, goBack }: { room: any; example: boolean; path: string; name: string; goBack: () => void }) {
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const link = async () => {
    if (sending) return; setSending(true); setError('');
    try { await client.action('linkRoom', { roomId: room.id, path }); SFX.shortSuccess(); closePanel(); }
    catch (e) { SFX.error(); setError((e as Error).message); setSending(false); }
  };
  const items: ItemMenu[] = [{ text: <>{t('panels.link')} <b>{room.name}</b> {t('panels.to')} <b>{name}</b></> }, { text: t('windows.back') }];
  const [i, setI] = useMenu(items.length, k => (k === 0 ? link() : goBack()), undefined, goBack);
  return (
    <Device label={t('panels.roomPanelSalaLink', { sala: room.name })} width={52} onClose={goBack}>
      <p className="voz">{t('panels.theRoomMovesTo')} <code>{path}</code> {t('panels.andWillBeCalled')} <b>{name}</b>.</p>
      <p className="tenue">{t('panels.theirDwellerStaysWithTheir')}{room.decor ? t('panels.theSetDressingIsRemoved') : ''}. {example ? t('panels.theCopyOfTheExample') : t('panels.thePreviousFolderIsLeft')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      <Options items={items} i={i} setI={setI} onChoose={k => (k === 0 ? link() : goBack())} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}


// ---------------------------------------------------------------- panel de una sala de repositorio
/** «Adaptar la sala al repo»: su habitante lee el repo y le diseña una escena con el atrezo del juego (roomDecor.ts
 *  en el servidor); la conversación queda abierta para seguir retocándola */
export async function adaptRoom(roomId: string) {
  const h = juego.get().dwellers.find(x => x.room === roomId && !x.copy);
  if (!h) { SFX.notAllowed(); return; }
  const prompt = await client.action<string>('room.adaptPrompt');
  client.send({ t: 'start', dwellerId: h.id, roomId, prompt, options: {} });
  closePanel(); goA(roomId, h.id, true);
}

// (vincular a otra carpeta es otra vista con su propio menú: un componente aparte, para no cambiar los hooks del panel)
function RoomPanel() {
  const roomId = juego.use(e => e.panelData?.roomId);
  const room = live.use(e => e.state?.rooms?.find((s: any) => s.id === roomId));
  const example = live.use(e => !!e.repos[roomId]?.example);
  const [link, setLink] = useState(false);
  const [assignment, setAssignment] = useState(() => juego.get().panelData?.view === 'reparto');   // desde el buscador: directo al tablero
  const [deployment, setDeployment] = useState(() => juego.get().panelData?.view === 'despliegue');
  const [organize, setOrganize] = useState(() => juego.get().panelData?.view === 'organizar');
  // abierto directamente en un tablero (la pantalla de la pared, ⌘K): al cerrarlo se vuelve al refugio, no al menú de la sala
  const [direct] = useState(() => !!juego.get().panelData?.view);
  const exit = (f: (v: boolean) => void) => () => (direct ? closePanel() : f(false));
  if (!room) return null;
  if (link) return <LinkRoom room={room} example={example} goBack={() => setLink(false)} />;
  // la sala de coordinación (la carpeta con todos los repos) revisa las tareas y planifica su reparto por salas
  if (assignment) return <JiraBoard coordination={roomId} goBack={exit(setAssignment)} />;
  // y el despliegue: tus PR por estado, sus bloqueos y el orden en que pueden ir
  if (deployment) return <DeploymentBoard roomId={roomId} goBack={exit(setDeployment)} />;
  // un worktree y una conversación por cada tarea con PR abiertos en el repo de la sala
  if (organize) return <OrganizeRooms roomId={roomId} goBack={exit(setOrganize)} />;
  return <RoomMenu roomId={roomId} room={room} onLink={() => setLink(true)} onDistribute={() => setAssignment(true)} onDeploy={() => setDeployment(true)} onOrganize={() => setOrganize(true)} />;
}
function RoomMenu({ roomId, room, onLink, onDistribute, onDeploy, onOrganize }: { roomId: string; room: any; onLink: () => void; onDistribute: () => void; onDeploy: () => void; onOrganize: () => void }) {
  const repo = live.use(e => e.repos[roomId]);
  const dwellers = juego.use(e => e.dwellers.filter(h => h.room === roomId && !h.copy));
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const ofRepo = room.type === 'repo' || room.type === 'coordinacion';
  // la sala de planificación de serie va con la raíz de repos: ni se vincula a otra carpeta ni se retira
  const movable = ofRepo && room.id !== PLANNING_ROOM;
  const [rc, setRc] = useState<StateRC | null>(null);
  useEffect(() => { if (ofRepo) client.action<StateRC>('room.remoteControl', { roomId }).then(setRc).catch(() => {}); }, [roomId, ofRepo]);
  const open =(app: string) => client.action('openIn', { app, path: room.path }).then(() => setNotice(t('panels.opened'))).catch(e => setNotice(e.message));
  const inDevelopment = location.port === '5173';
  const items: (ItemMenu & { f: () => void })[] = [
    ...(room.type === 'puente' ? [{ text: t('panels.applyTheGameSChanges'), hint: inDevelopment ? t('panels.inDevelopmentTheyApplyThemselves') : t('panels.recompilesAndReloadsWithoutCutting'), f: async () => {
      if (inDevelopment) { setNotice(t('panels.withTheDevelopmentServerVite')); return; }
      try { await client.action('applyClient'); setNotice(t('panels.recompilingTheShelterWillReload')); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(room.type === 'coordinacion' && dwellers[0] ? [{ text: <>{t('panels.jiraTasksPlanWith')} <b>{dwellers[0].name}</b> {t('panels.andSplitThemAcrossRooms')}</>, hint: t('panels.eachRepoInItsWorktree'), f: onDistribute }] : []),
    ...(room.type === 'coordinacion' ? [{ text: t('panels.deploymentPlanYourPullRequests'), hint: t('panels.theOrderInWhichThey'), f: onDeploy }] : []),
    ...(room.type === 'repo' && repo?.isGit && dwellers[0] ? [{ text: <>{t('panels.organizeByTasksAWorktree')} <b>{dwellers[0].name}</b> {t('panels.perTask')}</>, hint: t('panels.withUnmergedPrs'), f: onOrganize }] : []),
    ...(repo?.isGit ? [{ text: t('panels.openInTheGitClient'), hint: repo.changes ? t('panels.nChangesG', { n: repo.changes }) : 'G', f: () => { closePanel(); openGit({ path: repo.path, view: 'cambios' }); } }] : []),
    { text: t('panels.openTheRoomSTerminal'), hint: 'T', f: () => { closePanel(); window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { roomId } })); } },
    { text: t('panels.openInFinder'), f: () => open('finder') },
    { text: t('panels.openInTheEditor'), f: () => open('editor') },
    { text: t('panels.openInTerminalApp'), f: () => open('terminal') },
    ...(repo?.worktrees ?? []).filter(w => !w.main).map(w => ({ text: <>{t('panels.holographicCopy')} <b>{w.branch || t('windows.noBranch')}</b> <span className="tenue">(worktree)</span></>, hint: w.busy ? t('panels.insideX', { x: w.busy }) : w.changes ? t('windows.nChanges', { n: w.changes }) : w.advanced ? t('windows.nCommits', { n: w.advanced }) : t('panels.clean2'), f: () => juego.set({ panel: 'worktree', panelData: { roomId, device: 'wt:' + w.path } }) })),
    ...(ofRepo && dwellers[0] && repo?.exists !== false ? [{ text: <>{t('panels.adaptTheRoomToThe')} <b>{dwellers[0].name}</b> {t('panels.designASceneForIt')}</>, hint: room.decor ? t('panels.orTouchUpTheOne') : t('panels.readsTheRepoAndDecorates'), f: () => adaptRoom(roomId).catch(e => setNotice((e as Error).message)) }] : []),
    ...(ofRepo && room.decor ? [{ text: t('panels.backToTheDefaultScene'), hint: t('panels.removesTheSetDressing'), f: async () => {
      try { await client.action('room.removeDecor', { roomId }); setNotice(t('panels.theRoomGoesBackTo')); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(ofRepo && repo?.exists !== false ? [{ text: rc?.state === 'encendido' ? t('panels.turnOffRemoteControl') : t('panels.turnOnRemoteControl'), hint: rc?.state === 'encendido' ? t('panels.stopsShowingOnClaudeAi') : t('panels.thisRepoSSessionsFrom'), f: async () => {
      const switchOn = rc?.state !== 'encendido';
      if (switchOn) setNotice(t('panels.turningOnRemoteControl'));
      try { const r = await client.action<StateRC>('room.remoteControl', { roomId, switchOn }); setRc(r); setNotice(r.detail ?? (r.state === 'encendido' ? t('panels.onOpenTheCodeTab', { nombre: r.name ?? '' }) : t('panels.off'))); }
      catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(rc?.state === 'encendido' && rc.url ? [{ text: t('panels.openItsRemoteControlOn'), hint: t('panels.inTheBrowser'), f: () => { window.open(rc.url, '_blank'); } }] : []),
    // el área del repo decide su sector y su color (verde frontend, amarillo backend, rojo críticos): Enter pasa a la siguiente
    ...(movable ? [{ text: <>{t('panels.repoArea')} <b style={{ color: sectorOf(room.type, room.id, room.area).letter }}>{tIs(sectorOf(room.type, room.id, room.area).name).toLowerCase()}</b></>, hint: 'Enter: ' + AREAS.map(a => tIs(SECTORS[a].name).toLowerCase()).join(' → '), f: async () => {
      const area = AREAS[(AREAS.indexOf(sectorOf(room.type, room.id, room.area).id as any) + 1) % AREAS.length];
      try { await client.action('room.area', { roomId, area }); SFX.click(); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(movable ? [{ text: t('panels.linkTheRoomToAnother'), hint: t('panels.oneOfYourReposThe'), f: onLink }] : []),
    ...(movable ? [{ text: t('panels.hideTheRoom'), hint: t('panels.hideTheRoomHint'), f: async () => {
      try { await client.action('room.hide', { roomId }); closePanel(); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(movable ? [{ text: confirm ? t('panels.surePressEnterAgainTo') : t('panels.removeTheRoomFromThe'), hint: repo?.example ? t('panels.theExampleRepoSCopy') : t('panels.theFolderIsLeftUntouched'), danger: true, f: async () => {
      if (!confirm) { setConfirm(true); return; }
      try { await client.action('removeRoom', { roomId }); closePanel(); } catch (e) { setNotice((e as Error).message); setConfirm(false); }
    } }] : []),
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device label={t('panels.roomPanelSala', { sala: room.name })} width={52}>
      <div className="ficha"><dl>
        <dt>{t('panels.folder')}</dt><dd>{room.path}{repo && repo.exists === false && <span className="aviso-consola"> · {t('panels.notFoundTheRoomStays')}</span>}</dd>
        {repo?.isGit ? <>
          <dt>{t('windows.branch')}</dt><dd>{repo.branch}{repo.changes ? <span className="aviso-consola"> · {t('windows.nUncommittedChanges', { n: repo.changes })}</span> : <span className="tenue"> · {t('panels.clean2')}</span>}</dd>
          <dt>{t('panels.lastCommit')}</dt><dd>{repo.lastCommit?.message ?? '—'} <span className="tenue">{repo.lastCommit ? ago(repo.lastCommit.date) : ''}</span></dd>
        </> : <><dt>git</dt><dd className="tenue">{repo?.subrepos?.length ? t('panels.wingWithNRepos', { n: repo.subrepos.length }) : t('panels.notARepo')}</dd></>}
        <dt>{t('panels.type')}</dt><dd>{tIs(REPO_TYPE[repo?.type ?? ''] ?? repo?.type ?? '—')}{repo?.example && <span className="tenue"> · {t('panels.exampleRepo')}</span>}</dd>
        <dt>{t('panels.dwellers2')}</dt><dd>{dwellers.map(h => h.name).join(', ') || '—'}</dd>
        {ofRepo && rc && <><dt>remote control</dt><dd>{rc.state === 'encendido' ? <>{t('panels.on')} <span className="tenue">· {t('panels.nombreOnClaudeAiCode', { nombre: rc.name ?? '' })}</span></> : rc.state === 'apagado' ? <span className="tenue">{t('panels.off2')}</span> : <span className="aviso-consola">{rc.detail}</span>}</dd></>}
        {ofRepo && <><dt>{t('panels.scene')}</dt><dd>{room.decor ? <>{room.decor.summary || t('panels.customSetDressing')} <span className="tenue">{t('panels.designedByItsDweller')}</span></> : <span className="tenue">{t('panels.theDefaultOneForIts')}</span>}</dd></>}
      </dl></div>
      {notice && <p className="aviso-consola">{notice}</p>}
      <Options items={items} i={i} setI={k => { setI(k); if (k !== items.length - 1) setConfirm(false); }} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- copia holográfica (worktree)
function PanelWorktree() {
  const d = juego.use(e => e.panelData);
  const path: string = String(d?.device ?? '').replace(/^wt:/, '');
  const roomId: string = d?.roomId;
  const dwellers = juego.use(e => e.dwellers.filter(h => h.room === roomId));
  const room = live.use(e => e.state?.rooms?.find((s: any) => s.id === roomId));
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const load = () => client.action<any>('worktree.inspect', { path }).then(setInfo).catch(e => setError(e.message));
  useEffect(() => { load(); }, [path]);
  // el worktree es una copia de su autor: él trabaja dentro e integra; si no es de esta sala, quien esté libre
  const authorId = live.use(e => e.repos?.[roomId]?.worktrees?.find((w: any) => w.path === path)?.author);
  const inside = live.use(e => Object.values(e.sessions).find((s: any) => s.state !== 'cerrada' && (s.cwd === path || s.cwd?.startsWith(path + '/'))) as any);
  const free = dwellers.find(h => h.id === authorId) ?? dwellers.find(h => h.state === 'ocioso' || h.state === 'durmiendo' || h.state === 'terminado') ?? dwellers[0];
  const insideWho = inside && dwellers.find(h => h.id === inside.dwellerId);
  // la copia holográfica habla por su propio intercomunicador (también de lo que hace dentro)
  const copy = juego.use(e => e.copies.find(c => c.id === idCopy(path)));
  const items: (ItemMenu & { f: () => void })[] = info ? [
    ...(copy ? [{ text: <>{t('panels.talkToTheCopyOf')} <b>{copy.copy?.nameAuthor}</b></>, hint: inside ? t('panels.theirConversationInThisWorktree') : t('panels.theirIntercom'), f: () => { closePanel(); goA(roomId, copy.id, true); } }]
      : insideWho ? [{ text: <>{t('panels.talkTo')} <b>{insideWho.name}</b> {t('panels.aboutWhatTheyReDoing')}</>, hint: t('panels.theirConversationInThisWorktree'), f: () => { closePanel(); goA(roomId, insideWho.id, true); } }] : []),
    { text: t('windows.openATerminalInside'), f: async () => { const { openTerminalIn } = await import('./Terminals'); closePanel(); openTerminalIn('wt:' + path, roomId, `${room?.name ?? ''} · ${info.branch}`, path); } },
    ...(copy || free ? [{ text: copy ? <>{t('panels.workInsideWithTheCopy')}</> : <>{t('panels.workInsideWith')} <b>{free!.name}</b></>, hint: t('panels.newSessionInThisWorktree'), f: () => { juego.set({ workIn: { cwd: path, branch: info.branch } }); closePanel(); goA(roomId, copy?.id ?? free!.id, true); } }] : []),
    ...(free ? [{ text: <>{t('panels.mergeHave')} <b>{free.name}</b> {t('panels.mergeTheBranchAndClean')}</>, hint: t('panels.intoBaseWithTheirPermissions', { base: info.base }), f: async () => {
      const prompt = await client.action<string>('worktree.integratePrompt', { path });
      client.send({ t: 'start', dwellerId: free.id, roomId, prompt, options: {} });
      closePanel(); goA(roomId, free.id, true);
    } }] : []),
    { text: info.busy ? t('panels.discardNoSomeoneIsWorking') : confirm ? t('panels.againEnterOrClickDelete') : t('panels.discardTheCopyTurnsOff'), danger: true, powerOff: info.busy, f: async () => {
      if (info.busy) { SFX.notAllowed(); return; }
      if (!confirm) { setConfirm(true); return; }
      try {
        await client.action('worktree.discard', { path, force: info.state.length > 0 || info.commits.length > 0 }); SFX.powerOff(); closePanel();
        // el holograma se apaga ya, sin esperar al próximo repaso de los repos
        client.action<InfoRepo>('repo', { roomId }).then(r => live.set(e => ({ repos: { ...e.repos, [roomId]: r } }))).catch(() => {});
      } catch (e) { setError((e as Error).message); setConfirm(false); }
    } },
  ] : [];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device label={dwellers.find(h => h.id === authorId) ? t('panels.holographicCopyOfNombreRama', { nombre: dwellers.find(h => h.id === authorId)!.name, rama: info?.branch ?? '…' }) : t('panels.holographicCopyRama', { rama: info?.branch ?? '…' })} width={60} pilot={info?.busy ? 'error' : info?.state?.length ? 'esperando' : 'trabajando'}>
      {!info ? <p className="tenue">{error || t('panels.connectingToTheCopy')}</p> : <>
        <div className="ficha"><dl>
          <dt>{t('panels.path')}</dt><dd>{info.path}</dd>
          <dt>{t('windows.branch')}</dt><dd>{info.branch} <span className="tenue">{t('panels.onTopOfBase', { base: info.base })}</span></dd>
          <dt>{t('panels.inside')}</dt><dd>{info.busy ? <span className="aviso-consola">{t('panels.aSessionIsWorking')}</span> : t('panels.nobody')}</dd>
        </dl></div>
        <div className="dos-columnas">
          <div><h3>{t('panels.uncommittedChangesN', { n: info.state.length })}</h3><pre className="lista-git">{info.state.slice(0, 14).join('\n') || '—'}</pre></div>
          <div><h3>{t('panels.commitsToMergeN', { n: info.commits.length })}</h3><pre className="lista-git">{info.commits.slice(0, 14).join('\n') || '—'}</pre></div>
        </div>
        {error && <p className="aviso-consola">{error}</p>}
        {/* el aviso de la confirmación va debajo, para no mover la lista bajo el ratón entre el primer clic y el segundo */}
        <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
        {confirm && <p className="aviso-consola">{t('panels.youWillLoseCambiosUncommitted', { cambios: info.state.length, commits: info.commits.length, base: info.base })}{info.ignored.length ? t('panels.andNIgnoredFilesE', { n: info.ignored.length, ej: info.ignored.slice(0, 3).join(', ') }) : ''}.</p>}
      </>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- visitante: las sesiones de la sala abiertas fuera
// no es un aparato: lleva al intercomunicador del habitante de la sala, con la lista de esas sesiones
function PanelVisitor() {
  const d = juego.use(e => e.panelData);
  useEffect(() => { juego.set({ panel: null, panelData: null }); if (d?.roomId) claimVisitors(d.roomId); }, []);
  return null;
}

// la cabina de la discoteca no es un aparato: abre Spotify, que suena dentro del juego
function OpenSpotify() {
  useEffect(() => { juego.set({ panel: null, panelData: null }); openSpotify(); }, []);
  return null;
}

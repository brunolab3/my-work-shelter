// The Vault's «Trophies and career» panel: the career ladder's steps with each requirement's progress, and every
// trophy earned or on its way (shared/trophies.ts, derived by the server from the work log on each read).
import React, { useEffect, useState } from 'react';
import { t, locale } from '@shared/language';
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Keys, useKeys } from './device';
import { openLink } from './Browsers';
import { fileText, type TrophyKind, type TrophyState } from '@shared/trophies';
import type { Medal } from '@shared/workLog';
import { readWorkLog, verifyLadder, type WorkLogData } from './WorkLog';

const day = (ts: number) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
const KIND_TEXT: Record<TrophyKind, string> = { prsMerged: 'trophies.kind.prsMerged', tasksDone: 'trophies.kind.tasksDone', reviewsGiven: 'trophies.kind.reviewsGiven', multiRepoTasks: 'trophies.kind.multiRepoTasks', verifiedInProd: 'trophies.kind.verifiedInProd', awards: 'trophies.kind.awards' };
const Bar = ({ p }: { p: number }) => <span className="trofeo-barra"><span style={{ width: `${Math.round(p * 100)}%` }} /></span>;

function TrophyLine({ x }: { x: TrophyState }) {
  const r = x.rule;
  return (
    <li className={'trofeo' + (x.earnedAt ? ' ganado' : '')} title={x.facts.map(f => f.ref).join(', ')}>
      <span className="trofeo-icono">{x.earnedAt ? '🏆' : '◌'}</span>
      <b>{fileText(r.name)}</b>
      <span className="tenue">{x.count}/{r.n} {t(KIND_TEXT[r.kind])}{r.within ? ' ' + t('trophies.within', { n: r.within }) : ''}</span>
      {x.earnedAt ? <span className="tenue">{t('trophies.earnedOn', { fecha: day(x.earnedAt) })}</span>
        : r.kind === 'awards' && r.n <= 12 ? <span className="trofeo-medallas">{Array.from({ length: r.n }, (_, k) => <span key={k} className={k < x.count ? 'llena' : ''}>{k < x.count ? '🏅' : '○'}</span>)}</span>   // medals fill up toward the trophy
        : <Bar p={x.progress} />}
      {x.facts.length > 0 && <span className="trofeo-hechos">{x.facts.slice(-4).map(f => <a key={f.ref} onClick={() => openLink(f.url)}>{f.ref}</a>)}</span>}
    </li>
  );
}

const VERDICT_TEXT = { met: 'trophies.verify.met', partial: 'trophies.verify.partial', 'not-met': 'trophies.verify.notMet' } as const;
// the last verification the Overseer asked for (the ladder file's "progress" key): level, summary, and each verdict
function LastVerification({ data }: { data: WorkLogData }) {
  const p = data.progress;
  if (!p) return <p className="tenue">{t('trophies.verify.none')}</p>;
  const steps = data.career.steps;
  const level = steps.find(s => s.step.id === p.level);
  return (
    <div className="verificacion">
      <p><b>{t('trophies.verify.last')}</b> · {day(p.at)} · <b className="nivel">{t('trophies.verify.level', { nivel: level ? fileText(level.step.name) : '—' })}</b></p>
      {p.summary && <p className="tenue">{p.summary}</p>}
      <ul>{steps.flatMap(s => s.requirements).filter(q => p.requirements[q.req.id]).map(q => { const r = p.requirements[q.req.id]; return (
        <li key={q.req.id} className={'v-' + r.verdict}>
          <span>{r.verdict === 'met' ? '✔' : r.verdict === 'partial' ? '◐' : '○'} {fileText(q.req.text)}</span>
          <span className="tenue">{t(VERDICT_TEXT[r.verdict])} · {t(r.byRules ? 'trophies.verify.byRules' : 'trophies.verify.bySession')}{r.notes ? ' — ' + r.notes : ''}</span>
          {r.evidence.length > 0 && <span className="trofeo-hechos">{r.evidence.slice(0, 6).map((x, k) => /^https?:/.test(x) ? <a key={k} onClick={() => openLink(x)}>{x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 36)}</a> : <span key={k} className="tenue">{x} </span>)}</span>}
        </li>); })}</ul>
    </div>
  );
}

export function Trophies({ goBack }: { goBack: () => void }) {
  const [data, setData] = useState<WorkLogData | null>(null);
  const [error, setError] = useState('');
  const load = () => readWorkLog().then(d => { setData(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  // the Overseer's own ladder: made from the example the first time, then opened to edit (R reads it again)
  const openFile = () => client.action<string>('bitacora.escalera', {}).then(file => client.action('enlace.local', { path: file })).then(load).catch(e => setError(e.message));
  // medals the Friday digest proposed: the Overseer accepts (A) or dismisses (D) the selected one (↑↓)
  const medals: Medal[] = Object.values(data?.ledger.medals ?? {}).filter(m => m.state !== 'dismissed').sort((a, b) => Number(b.state === 'proposed') - Number(a.state === 'proposed') || b.proposedAt - a.proposedAt);
  const proposed = medals.filter(m => m.state === 'proposed');
  const [mi, setMi] = useState(0);
  const decide = (m: Medal | undefined, accept: boolean) => { if (!m || data?.demo) return; SFX.click(); client.action('medalla.decidir', { id: m.id, accept }).then(load).catch(e => setError(e.message)); };
  useKeys(e => {
    if (e.code === 'Escape') goBack();
    else if (e.code === 'KeyR') { load(); SFX.click(); }
    else if (e.code === 'KeyO') { openFile(); SFX.click(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') setMi(x => Math.min(x + 1, Math.max(0, proposed.length - 1)));
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') setMi(x => Math.max(0, x - 1));
    else if (e.code === 'KeyV') verifyLadder().catch(x => { SFX.notAllowed(); setError(x.message); });
    else if (e.code === 'KeyA') decide(proposed[mi], true);
    else if (e.code === 'KeyD') decide(proposed[mi], false);
    else return false;
  }, [data, mi]);
  const c = data?.career;
  const byId = new Map((c?.trophies ?? []).map(x => [x.rule.id, x]));
  const earned = (c?.trophies ?? []).filter(x => x.earnedAt).length;
  return (
    <Device label={`${t('panels.vault')} · ${t('trophies.title')}${data?.demo ? ' · DEMO' : ''}`} width={84} height onClose={goBack}>
      <p className="voz">{t('trophies.intro')}</p>
      {data?.demo && <p className="tenue">{t('worklog.demo')}</p>}
      {error && <p className="aviso-consola">{error}</p>}
      {data && <p className="tenue">{data.ladder.source === 'local' ? t('trophies.sourceLocal', { ruta: data.ladder.file }) : data.ladder.source === 'example' ? t('trophies.sourceExample', { ruta: data.ladder.file, local: data.ladder.local }) : t('trophies.sourceNone', { local: data.ladder.local })}</p>}
      {data?.ladder.errors.map((x, k) => <p key={k} className="aviso-consola">{x}</p>)}
      {!data && !error && <p className="tenue">{t('worklog.reading')}</p>}
      {c && c.steps.length > 0 && <>
        <h3 className="trofeos-seccion">{t('trophies.career')}</h3>
        <LastVerification data={data!} />
        <ol className="escalera">
          {c.steps.map(s => (
            <li key={s.step.id} className={'escalon' + (s.complete ? ' cumplido' : '') + (c.current === s.step.id ? ' actual' : '')}>
              <div className="escalon-cabeza"><b>{fileText(s.step.name)}</b> <Bar p={s.progress} /> <span className="tenue">{s.complete ? t('trophies.complete') : c.current === s.step.id ? t('trophies.current') : ''}</span></div>
              <ul>{s.requirements.map(q => (
                <li key={q.req.id} className={q.met ? 'cumplido' : ''}>
                  <span>{q.met ? '✔' : q.measured ? '○' : '·'} {fileText(q.req.text)}</span>
                  {q.measured ? <><Bar p={q.progress} /> <span className="tenue">{q.req.mode === 'any' && q.req.trophies.length > 1 ? t('trophies.anyOf') + ' ' : ''}{q.req.trophies.map(id => (byId.get(id)?.earnedAt ? '🏆 ' : '') + fileText(byId.get(id)?.rule.name)).join(', ')}</span></>
                    : <span className="tenue">{t('trophies.unmeasured')}</span>}
                </li>))}</ul>
            </li>))}
        </ol>
      </>}
      {c && c.trophies.length > 0 && <>
        <h3 className="trofeos-seccion">{t('trophies.list')} <span className="tenue">{t('trophies.menuHint', { n: earned, total: c.trophies.length })}</span></h3>
        <ul className="trofeos">{[...c.trophies].sort((a, b) => Number(!!b.earnedAt) - Number(!!a.earnedAt) || b.progress - a.progress).map(x => <TrophyLine key={x.rule.id} x={x} />)}</ul>
      </>}
      {medals.length > 0 && <>
        <h3 className="trofeos-seccion">{t('trophies.medals')}</h3>
        <p className="tenue">{t('trophies.medalsIntro')}</p>
        <ul className="medallas">{medals.map(m => (
          <li key={m.id} className={m.state + (m.state === 'proposed' && proposed[mi]?.id === m.id ? ' sel' : '')}>
            <span>{m.state === 'accepted' ? '🏅' : '○'}</span>
            <b>{m.requirement}</b> <span>{m.text}</span>
            <span className="trofeo-hechos">{m.evidence.map((x, k) => /^https?:/.test(x) ? <a key={k} onClick={() => openLink(x)}>{x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a> : <span key={k} className="tenue">{x} </span>)}</span>
            {m.state === 'proposed' ? <span className="medalla-botones"><button onClick={() => decide(m, true)}>{t('trophies.medal.accept')}</button><button onClick={() => decide(m, false)}>{t('trophies.medal.dismiss')}</button></span>
              : <span className="tenue">{t('trophies.medal.accepted')} {m.decidedAt ? day(m.decidedAt) : ''}</span>}
          </li>))}</ul>
      </>}
      <Keys>{proposed.length > 0 && <><kbd>↑↓</kbd><kbd>A</kbd><kbd>D</kbd>{t('trophies.keyMedal')} </>}<kbd>V</kbd>{t('trophies.keyVerify')} <kbd>O</kbd>{t('trophies.keyOpenFile')} <kbd>R</kbd>{t('panels.refresh')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

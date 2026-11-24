// Planning's «Trophies and career» panel: each vertical's trophy on top, coloured by the level it reached (bronze,
// silver, gold) with its progress to the next, the medals as a carpet under them, then the career ladder's steps
// (shared/trophies.ts, derived by the server from the work log on each read).
import React, { useEffect, useState } from 'react';
import { t, locale } from '@shared/language';
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Keys, useKeys } from './device';
import { openLink } from './Browsers';
import { DEFAULT_SOURCES, fileText, type RequirementState, type TrophyKind, type TrophyRule, type TrophyState } from '@shared/trophies';
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
      {x.earnedAt ? <span className="tenue">{t('trophies.earnedOn', { fecha: day(x.earnedAt) })}</span> : <Bar p={x.progress} />}
      {x.facts.length > 0 && <span className="trofeo-hechos">{x.facts.slice(-4).map(f => <a key={f.ref} onClick={() => openLink(f.url)}>{f.ref}</a>)}</span>}
    </li>
  );
}

// the level a vertical reached, in its colour, and what it has toward the next
const LevelTag = ({ q }: { q: RequirementState }) => <>
  <span className={'nivel-trofeo ' + (q.level ?? 'ninguno')}>{q.level ? t(`trophies.level.${q.level}`) : '—'}</span>
  <span className="tenue">{t('trophies.awardsCount', { n: q.count })}{q.next ? ' · ' + t('trophies.toNext', { n: q.next.n, nivel: t(`trophies.level.${q.next.level}`) }) : ''}</span>
</>;
// a vertical's trophy: its cup in the colour of its level, filled toward its top level, and the awards that count
function VerticalLine({ q }: { q: RequirementState }) {
  return (
    <li className={'trofeo vertical' + (q.level ? ' ganado ' + q.level : '')} title={q.facts.map(f => f.ref).join(', ')}>
      <span className="trofeo-icono">{q.level ? '🏆' : '◌'}</span>
      <b>{fileText(q.req.text)}</b>
      <LevelTag q={q} />
      <Bar p={q.progress} />
      <span className="trofeo-medallas">{q.medals.map(m => <span key={m.id} className="llena medalla" title={m.text}>🏅</span>)}{q.won.map(id => <span key={id} className="llena" title={id}>🏆</span>)}</span>
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

// a medal entered by hand, for an award that takes them (the Overseer's own word: it counts at once)
function EnterMedal({ awards, done, cancel }: { awards: TrophyRule[]; done: () => void; cancel: () => void }) {
  const [award, setAward] = useState(awards[0]?.id ?? ''), [text, setText] = useState(''), [evidence, setEvidence] = useState(''), [error, setError] = useState('');
  if (!awards.length) return <p className="tenue">{t('trophies.medal.enterNone')}</p>;
  const save = () => client.action('medalla.meter', { award, text, evidence }).then(() => { SFX.click(); done(); }).catch(e => { SFX.notAllowed(); setError(e.message); });
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
  return (
    <div className="medalla-mano" onKeyDown={keys}>
      <label>{t('trophies.medal.enterAward')} <select value={award} onChange={e => setAward(e.target.value)}>{awards.map(a => <option key={a.id} value={a.id}>{fileText(a.name)}</option>)}</select></label>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={t('trophies.medal.enterText')} spellCheck={false} />
      <input value={evidence} onChange={e => setEvidence(e.target.value)} placeholder={t('trophies.medal.enterEvidence')} spellCheck={false} />
      <span className="medalla-botones"><button onClick={save}>{t('trophies.medal.enterSave')}</button><button onClick={cancel}>{t('menu.close')}</button></span>
      {error && <p className="aviso-consola">{error}</p>}
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
  const [entering, setEntering] = useState(false);
  const awards = (data?.career.trophies ?? []).map(x => x.rule).filter(r => r.kind === 'awards');
  const byHand = awards.filter(r => (r.sources ?? DEFAULT_SOURCES).includes('manual'));
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
    else if (e.code === 'KeyM' && !data?.demo) { setEntering(x => !x); SFX.click(); }
    else return false;
  }, [data, mi]);
  const c = data?.career;
  const byId = new Map((c?.trophies ?? []).map(x => [x.rule.id, x]));
  const measured = (c?.trophies ?? []).filter(x => x.rule.kind !== 'awards');
  const won = (c?.verticals ?? []).filter(x => x.met).length;
  const ready = c?.steps.find(s => s.step.id === c.ready);
  return (
    <Device label={`${t('panels.planning')} · ${t('trophies.title')}${data?.demo ? ' · DEMO' : ''}`} width={84} height onClose={goBack}>
      <p className="voz">{t('trophies.intro')}</p>
      {data?.demo && <p className="tenue">{t('worklog.demo')}</p>}
      {error && <p className="aviso-consola">{error}</p>}
      {data && <p className="tenue">{data.ladder.source === 'local' ? t('trophies.sourceLocal', { ruta: data.ladder.file }) : data.ladder.source === 'example' ? t('trophies.sourceExample', { ruta: data.ladder.file, local: data.ladder.local }) : t('trophies.sourceNone', { local: data.ladder.local })}</p>}
      {data?.ladder.errors.map((x, k) => <p key={k} className="aviso-consola">{x}</p>)}
      {!data && !error && <p className="tenue">{t('worklog.reading')}</p>}
      {c && c.verticals.length > 0 && <>
        <h3 className="trofeos-seccion">{t('trophies.list')} <span className="tenue">{t('trophies.menuHint', { n: won, total: c.verticals.length })}</span></h3>
        {ready && <p className="listo-pedir">{t('trophies.ready', { paso: fileText(ready.step.name) })}</p>}
        <ul className="trofeos">{c.verticals.map(q => <VerticalLine key={q.req.id} q={q} />)}</ul>
      </>}
      {measured.length > 0 && <>
        <h3 className="trofeos-seccion">{t('trophies.special')}</h3>
        <ul className="trofeos">{[...measured].sort((a, b) => Number(!!b.earnedAt) - Number(!!a.earnedAt) || b.progress - a.progress).map(x => <TrophyLine key={x.rule.id} x={x} />)}</ul>
      </>}
      {(medals.length > 0 || entering) && <>
        <h3 className="trofeos-seccion">{t('trophies.medals')}</h3>
        <p className="tenue">{t('trophies.medalsIntro')}</p>
        {entering && <EnterMedal awards={byHand} done={() => { setEntering(false); load(); }} cancel={() => setEntering(false)} />}
        <ul className="medallas alfombra">{medals.map(m => (
          <li key={m.id} className={m.state + (m.state === 'proposed' && proposed[mi]?.id === m.id ? ' sel' : '')}>
            <span>{m.state === 'accepted' ? '🏅' : '○'}</span>
            <b>{m.award ? fileText(byId.get(m.award)?.rule.name) || m.award : m.requirement}</b> <span>{m.text}</span>
            {m.source && <span className="tenue">{t(`trophies.source.${m.source}`)}{m.date ? ' · ' + day(m.date) : ''}</span>}
            <span className="trofeo-hechos">{m.evidence.map((x, k) => /^https?:/.test(x) ? <a key={k} onClick={() => openLink(x)}>{x.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}</a> : <span key={k} className="tenue">{x} </span>)}</span>
            {m.state === 'proposed' ? <span className="medalla-botones"><button onClick={() => decide(m, true)}>{t('trophies.medal.accept')}</button><button onClick={() => decide(m, false)}>{t('trophies.medal.dismiss')}</button></span>
              : <span className="tenue">{t('trophies.medal.accepted')} {m.decidedAt ? day(m.decidedAt) : ''}</span>}
          </li>))}</ul>
      </>}
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
                  {q.measured ? <><Bar p={q.progress} /> <LevelTag q={q} /></>
                    : <span className="tenue">{t('trophies.unmeasured')}</span>}
                </li>))}</ul>
            </li>))}
        </ol>
      </>}
      <Keys>{proposed.length > 0 && <><kbd>↑↓</kbd><kbd>A</kbd><kbd>D</kbd>{t('trophies.keyMedal')} </>}{!data?.demo && awards.length > 0 && <><kbd>M</kbd>{t('trophies.keyEnter')} </>}<kbd>V</kbd>{t('trophies.keyVerify')} <kbd>O</kbd>{t('trophies.keyOpenFile')} <kbd>R</kbd>{t('panels.refresh')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

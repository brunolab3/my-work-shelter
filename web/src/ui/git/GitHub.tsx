// Pestaña GitHub del cliente de git: tu matriz de contribuciones (la de cuadritos verdes de tu perfil) en grande, con
// el número de cada día al pasar por encima, y tus rachas (los pull requests tienen su pestaña: PullRequests.tsx).
// Todo viene de `gh` (tu sesión de GitHub); sin él, la matriz cuenta tus commits en los repos del refugio.
import React, { useEffect, useState } from 'react';
import { client } from '../../net/client';
import { GREEN_GITHUB, streaks } from '@shared/contributions';
import { ago } from './common';
import { openLink } from '../Browsers';
import { t, language } from '@shared/language';

interface Data { source: 'github' | 'local'; demo?: boolean; user?: string; name?: string; total: number; days: { date: string; n: number; level: number }[]; error?: string; ts: number }

const LOC = language() === 'en' ? 'en-GB' : 'es-ES';
const DAYS = ['', t('windows.mon'), '', t('windows.wed'), '', t('windows.fri'), ''];
const MONTHS = [t('windows.jan'), t('windows.feb'), t('windows.mar'), t('windows.apr'), t('windows.may'), t('windows.jun'), t('windows.jul'), t('windows.aug'), t('windows.sep'), t('windows.oct'), t('windows.nov'), t('windows.dec')];
const fmtDay = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function GitHub({ notify }: { notify: (t: string, error?: boolean) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [onTop, setAbove] = useState<{ date: string; n: number } | null>(null);
  const read = (force = false) => { setLoading(true); client.action<Data>('git.github', { force }).then(setD).catch(e => notify(e.message, true)).finally(() => setLoading(false)); };
  useEffect(() => read(), []);
  if (!d) return <div className="gd-vacio">{loading ? t('windows.askingGithub') : t('windows.noData')}</div>;
  const offset = d.days.length ? new Date(d.days[0].date + 'T12:00:00').getDay() : 0;
  const weeks = Math.ceil((d.days.length + offset) / 7);
  const { current, best } = streaks(d.days);
  const max = d.days.reduce((m, x) => (x.n > m.n ? x : m), { date: '', n: 0 });
  const months: { col: number; m: number }[] = [];
  // el mes se rotula en la primera semana que empieza en él (la primera columna, a medias, no)
  for (let c = 0, before = -1; c < weeks; c++) { const day = d.days[Math.max(0, c * 7 - offset)]; const m = day ? new Date(day.date + 'T12:00:00').getMonth() : -1; if (m !== before && c > 0 && c < weeks - 2) months.push({ col: c, m }); before = m; }
  const open = (url: string) => openLink(url);   // en el navegador de GitHub del refugio
  return (
    <div className="gg">
      <div className="gg-hoja">
        <div className="gg-cab">
          <div className="gg-quien">
            <div className="gg-usuario">{d.user ? <>@{d.user}{d.name ? <span className="dim"> · {d.name}</span> : null}</> : t('windows.yourCommitsInTheShelter')}</div>
            <div className="dim">{d.source === 'github' ? t('windows.nContributionsInTheLast', { n: d.total.toLocaleString(LOC) }) : t('windows.nCommitsInTheLast', { n: d.total.toLocaleString(LOC) })}</div>
          </div>
          <span className="gg-mandos">
            {d.user && !d.demo && <button className="gc-boton" onClick={() => open(`https://github.com/${d.user}`)}>{t('windows.openYourProfile')}</button>}
            <button className="gc-boton" disabled={loading} onClick={() => read(true)} title={t('windows.askGithubAgainCachedFor')}>{loading ? t('windows.reading') : t('windows.refresh')}</button>
          </span>
        </div>
        {d.error && <div className="gd-aviso">{d.error}</div>}
        <div className="gg-matriz-caja">
          {/* una sola rejilla para meses, días y celdas: las columnas se reparten el ancho que haya (la celda escala y nunca
              rebosa) y las filas salen de las celdas, que son cuadradas */}
          <div className="gg-matriz" style={{ gridTemplateColumns: `auto repeat(${weeks}, minmax(0, 1fr))` }} onMouseLeave={() => setAbove(null)}>
            {months.map(x => <span key={'m' + x.col} className="gg-mes" style={{ gridColumn: `${x.col + 2} / span 3` }}>{MONTHS[x.m]}</span>)}
            {DAYS.map((t, i) => t && <span key={t} className="gg-dia" style={{ gridRow: i + 2 }}>{t}</span>)}
            {d.days.map((x, i) => <span key={x.date} className="gg-celda" style={{ background: GREEN_GITHUB[x.level], gridColumn: Math.floor((i + offset) / 7) + 2, gridRow: ((i + offset) % 7) + 2 }} onMouseEnter={() => setAbove(x)} title={t('windows.nOnDate', { n: x.n, date: x.date })} />)}
          </div>
          <div className="gg-pie">
            <span className="gg-encima">{onTop ? <><b>{onTop.n === 0 ? t('windows.nothing') : onTop.n === 1 ? t('windows.1Contribution') : t('windows.nContributions', { n: onTop.n })}</b> {t('windows.on')} {fmtDay.format(new Date(onTop.date + 'T12:00:00'))}</> : t('windows.hoverOverADayTo')}</span>
            <span className="gg-leyenda">{t('windows.less')} {GREEN_GITHUB.map(c => <i key={c} style={{ background: c }} />)} {t('windows.more')}</span>
          </div>
        </div>
        <div className="gg-cifras">
          <div><small>{t('windows.today')}</small><b>{d.days.at(-1)?.n ?? 0}</b></div>
          <div><small>{t('windows.last7Days')}</small><b>{d.days.slice(-7).reduce((s, x) => s + x.n, 0)}</b></div>
          <div><small>{t('windows.currentStreak')}</small><b className={current ? 'green' : ''}>{current === 1 ? t('windows.nDay', { n: current }) : t('windows.nDays', { n: current })}</b></div>
          <div><small>{t('windows.bestStreak')}</small><b>{best === 1 ? t('windows.nDay', { n: best }) : t('windows.nDays', { n: best })}</b></div>
          <div><small>{t('windows.bestDay')}</small><b>{max.n}</b>{max.date && <small>{new Date(max.date + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short' })}</small>}</div>
        </div>
      </div>
    </div>
  );
}

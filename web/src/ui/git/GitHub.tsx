// Pestaña GitHub del cliente de git: tu matriz de contribuciones (la de cuadritos verdes de tu perfil) en grande, con
// el número de cada día al pasar por encima, y tus rachas (los pull requests tienen su pestaña: PullRequests.tsx).
// Todo viene de `gh` (tu sesión de GitHub); sin él, la matriz cuenta tus commits en los repos del refugio.
import React, { useEffect, useState } from 'react';
import { cliente } from '../../red/cliente';
import { GREEN_GITHUB, rachas } from '@shared/contribuciones';
import { hace } from './comun';
import { openLink } from '../Navegadores';
import { t, idioma } from '@shared/idioma';

interface Datos { fuente: 'github' | 'local'; demo?: boolean; usuario?: string; nombre?: string; total: number; days: { fecha: string; n: number; nivel: number }[]; error?: string; ts: number }

const LOC = idioma() === 'en' ? 'en-GB' : 'es-ES';
const DAYS = ['', t('windows.mon'), '', t('windows.wed'), '', t('windows.fri'), ''];
const MONTHS = [t('windows.jan'), t('windows.feb'), t('windows.mar'), t('windows.apr'), t('windows.may'), t('windows.jun'), t('windows.jul'), t('windows.aug'), t('windows.sep'), t('windows.oct'), t('windows.nov'), t('windows.dec')];
const fmtDay = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function GitHub({ avisar }: { avisar: (t: string, error?: boolean) => void }) {
  const [d, setD] = useState<Datos | null>(null);
  const [cargando, setLoading] = useState(false);
  const [encima, setAbove] = useState<{ fecha: string; n: number } | null>(null);
  const leer = (forzar = false) => { setLoading(true); cliente.accion<Datos>('git.github', { forzar }).then(setD).catch(e => avisar(e.message, true)).finally(() => setLoading(false)); };
  useEffect(() => leer(), []);
  if (!d) return <div className="gd-vacio">{cargando ? t('windows.askingGithub') : t('windows.noData')}</div>;
  const desfase = d.days.length ? new Date(d.days[0].fecha + 'T12:00:00').getDay() : 0;
  const semanas = Math.ceil((d.days.length + desfase) / 7);
  const { actual, mejor } = rachas(d.days);
  const max = d.days.reduce((m, x) => (x.n > m.n ? x : m), { fecha: '', n: 0 });
  const months: { col: number; m: number }[] = [];
  // el mes se rotula en la primera semana que empieza en él (la primera columna, a medias, no)
  for (let c = 0, antes = -1; c < semanas; c++) { const dia = d.days[Math.max(0, c * 7 - desfase)]; const m = dia ? new Date(dia.fecha + 'T12:00:00').getMonth() : -1; if (m !== antes && c > 0 && c < semanas - 2) months.push({ col: c, m }); antes = m; }
  const abrir = (url: string) => openLink(url);   // en el navegador de GitHub del refugio
  return (
    <div className="gg">
      <div className="gg-hoja">
        <div className="gg-cab">
          <div className="gg-quien">
            <div className="gg-usuario">{d.usuario ? <>@{d.usuario}{d.nombre ? <span className="tenue"> · {d.nombre}</span> : null}</> : t('windows.yourCommitsInTheShelter')}</div>
            <div className="tenue">{d.fuente === 'github' ? t('windows.nContributionsInTheLast', { n: d.total.toLocaleString(LOC) }) : t('windows.nCommitsInTheLast', { n: d.total.toLocaleString(LOC) })}</div>
          </div>
          <span className="gg-mandos">
            {d.usuario && !d.demo && <button className="gc-boton" onClick={() => abrir(`https://github.com/${d.usuario}`)}>{t('windows.openYourProfile')}</button>}
            <button className="gc-boton" disabled={cargando} onClick={() => leer(true)} title={t('windows.askGithubAgainCachedFor')}>{cargando ? t('windows.reading') : t('windows.refresh')}</button>
          </span>
        </div>
        {d.error && <div className="gd-aviso">{d.error}</div>}
        <div className="gg-matriz-caja">
          {/* una sola rejilla para meses, días y celdas: las columnas se reparten el ancho que haya (la celda escala y nunca
              rebosa) y las filas salen de las celdas, que son cuadradas */}
          <div className="gg-matriz" style={{ gridTemplateColumns: `auto repeat(${semanas}, minmax(0, 1fr))` }} onMouseLeave={() => setAbove(null)}>
            {months.map(x => <span key={'m' + x.col} className="gg-mes" style={{ gridColumn: `${x.col + 2} / span 3` }}>{MONTHS[x.m]}</span>)}
            {DAYS.map((t, i) => t && <span key={t} className="gg-dia" style={{ gridRow: i + 2 }}>{t}</span>)}
            {d.days.map((x, i) => <span key={x.fecha} className="gg-celda" style={{ background: GREEN_GITHUB[x.nivel], gridColumn: Math.floor((i + desfase) / 7) + 2, gridRow: ((i + desfase) % 7) + 2 }} onMouseEnter={() => setAbove(x)} title={t('windows.nOnFecha', { n: x.n, fecha: x.fecha })} />)}
          </div>
          <div className="gg-pie">
            <span className="gg-encima">{encima ? <><b>{encima.n === 0 ? t('windows.nothing') : encima.n === 1 ? t('windows.1Contribution') : t('windows.nContributions', { n: encima.n })}</b> {t('windows.on')} {fmtDay.format(new Date(encima.fecha + 'T12:00:00'))}</> : t('windows.hoverOverADayTo')}</span>
            <span className="gg-leyenda">{t('windows.less')} {GREEN_GITHUB.map(c => <i key={c} style={{ background: c }} />)} {t('windows.more')}</span>
          </div>
        </div>
        <div className="gg-cifras">
          <div><small>{t('windows.today')}</small><b>{d.days.at(-1)?.n ?? 0}</b></div>
          <div><small>{t('windows.last7Days')}</small><b>{d.days.slice(-7).reduce((s, x) => s + x.n, 0)}</b></div>
          <div><small>{t('windows.currentStreak')}</small><b className={actual ? 'verde' : ''}>{actual === 1 ? t('windows.nDay', { n: actual }) : t('windows.nDays', { n: actual })}</b></div>
          <div><small>{t('windows.bestStreak')}</small><b>{mejor === 1 ? t('windows.nDay', { n: mejor }) : t('windows.nDays', { n: mejor })}</b></div>
          <div><small>{t('windows.bestDay')}</small><b>{max.n}</b>{max.fecha && <small>{new Date(max.fecha + 'T12:00:00').toLocaleDateString(LOC, { day: 'numeric', month: 'short' })}</small>}</div>
        </div>
      </div>
    </div>
  );
}

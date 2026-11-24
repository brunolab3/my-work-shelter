// The tokens spent (server/usageSpend.ts), in the usage light's popover (PlanMeter in Hud.tsx): the last 5 hours by
// hour or the last 7 days by day, stacked bars of new tokens (input + output + cache creation) under cache reads, so
// cache reads don't pass for new spend. The current window (from resetsAt) is shaded from its start, with its reset.
// Tokens, not the plan's allowance: nothing here says what is allowed.
import React, { useEffect, useState } from 'react';
import { t, language } from '@shared/language';
import { client } from '../net/client';
import { type SpendBucket, type SpendBuckets } from '@shared/usageSpend';
import { describeReset, windowStart, type PlanLimits } from '@shared/planLimits';

const LOC = language() === 'en' ? 'en-GB' : 'es-ES';
const fmtHour = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat(LOC, { weekday: 'narrow', day: 'numeric' });
const fmtDayLong = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTokens = new Intl.NumberFormat(LOC, { notation: 'compact', maximumSignificantDigits: 3 });
const fmtExact = new Intl.NumberFormat(LOC);

type View = 'hours' | 'days';
const WINDOW: Record<View, string> = { hours: 'five_hour', days: 'seven_day' };
let last: SpendBuckets | null = null;   // the last buckets read: shown at once when it opens again
let lastView: View = 'hours';

const W = 272, HGT = 100, AXIS = 16, GAP = 2, TIP = 170;

export function UsageGraph({ limits, now }: { limits: PlanLimits; now: number }) {
  const [data, setData] = useState<SpendBuckets | null>(last);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(lastView);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    const read = () => client.action<SpendBuckets>('usage.spend').then(b => { if (on) { last = b; setData(b); setFailed(false); } }).catch(() => on && setFailed(true));
    read();
    const i = setInterval(read, 60_000);
    return () => { on = false; clearInterval(i); };
  }, []);
  const pick = (v: View) => { lastView = v; setView(v); setHover(null); };

  const buckets = data?.[view] ?? [];
  const max = Math.max(1, ...buckets.map(b => b.fresh + b.cacheRead));
  const slot = buckets.length ? W / buckets.length : W, bw = Math.max(2, slot - GAP * 2);
  const y = (n: number) => (n / max) * (HGT - AXIS);
  // a time to its x: linear inside its bucket (days of 23 or 25 hours too)
  const xOf = (ts: number) => {
    const i = buckets.findIndex(b => ts >= b.start && ts < b.end);
    if (i < 0) return ts < (buckets[0]?.start ?? 0) ? null : W;
    const b = buckets[i];
    return i * slot + ((ts - b.start) / (b.end - b.start)) * slot;
  };
  const lim = limits[WINDOW[view]];
  const start = windowStart(WINDOW[view], lim?.resetsAt ?? null);
  const ws = start != null ? xOf(start) : null;
  const label = (b: SpendBucket) => view === 'hours' ? `${fmtHour.format(b.start)}–${fmtHour.format(b.end)}` : fmtDayLong.format(b.start);
  const totals = buckets.reduce((a, b) => ({ fresh: a.fresh + b.fresh, cacheRead: a.cacheRead + b.cacheRead }), { fresh: 0, cacheRead: 0 });
  const h = hover != null ? buckets[hover] : null;
  const name = (v: View) => t(v === 'hours' ? 'panels.spend.hours' : 'panels.spend.days');

  return (
    <div className="uso-grafico">
      <div className="limites-pop-titulo">{t('panels.spend.title')}</div>
      <div className="uso-vistas" role="tablist">
        {(['hours', 'days'] as View[]).map(v => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => pick(v)}>{name(v)}</button>)}
      </div>
      <div className="uso-leyenda">
        <span><i className="uso-muestra nuevos" />{t('panels.spend.fresh')} <b>{fmtTokens.format(totals.fresh)}</b></span>
        <span><i className="uso-muestra cache" />{t('panels.spend.cacheRead')} <b>{fmtTokens.format(totals.cacheRead)}</b></span>
      </div>
      {!data ? <div className="uso-estado dim">{failed ? t('panels.spend.failed') : t('panels.spend.reading')}</div> : (
        <div className="uso-lienzo">
          <svg viewBox={`0 0 ${W} ${HGT}`} width={W} height={HGT} role="img" aria-label={t('panels.spend.chart', { vista: name(view) })} onMouseLeave={() => setHover(null)}>
            {ws != null && <>
              <rect className="uso-ventana" x={ws} y={0} width={Math.max(0, W - ws)} height={HGT - AXIS} />
              <line className="uso-marca" x1={ws} x2={ws} y1={0} y2={HGT - AXIS} />
            </>}
            <line className="uso-base" x1={0} x2={W} y1={HGT - AXIS + 0.5} y2={HGT - AXIS + 0.5} />
            {buckets.map((b, i) => {
              const x = i * slot + GAP, base = HGT - AXIS;
              // a non-zero figure shows at least a sliver; the 2 px gap between the two fills
              const hf = b.fresh ? Math.max(2, y(b.fresh)) : 0, hc = b.cacheRead ? Math.max(2, y(b.cacheRead)) : 0;
              return <g key={b.start} className={hover === i ? 'active' : ''}>
                {hf > 0 && <rect className="uso-barra nuevos" x={x} y={base - hf} width={bw} height={hf} />}
                {hc > 0 && <rect className="uso-barra cache" x={x} y={base - hf - (hf ? GAP : 0) - hc} width={bw} height={hc} />}
                <text className="uso-eje" x={x + bw / 2} y={HGT - 4} textAnchor="middle">{view === 'hours' ? fmtHour.format(b.start) : fmtDay.format(b.start)}</text>
                <rect className="uso-diana" x={i * slot} y={0} width={slot} height={HGT} onMouseEnter={() => setHover(i)} />
              </g>;
            })}
          </svg>
          {h && <div className="uso-tip" style={{ left: Math.min(W - TIP, Math.max(0, hover! * slot + slot / 2 - TIP / 2)) }}>
            <div className="uso-tip-cuando">{label(h)}</div>
            <div><i className="uso-muestra nuevos" />{t('panels.spend.fresh')}: <b>{fmtExact.format(h.fresh)}</b></div>
            <div><i className="uso-muestra cache" />{t('panels.spend.cacheRead')}: <b>{fmtExact.format(h.cacheRead)}</b></div>
          </div>}
        </div>
      )}
      {start != null && lim?.resetsAt && <div className="dim"><i className="uso-muestra ventana" />{t('panels.spend.window', { desde: describeReset(start, now).clock, hasta: describeReset(lim.resetsAt, now).clock })}</div>}
      <div className="dim uso-nota">{t('panels.spend.note')}</div>
    </div>
  );
}

// Calendario del Mac, solo lectura: los eventos de hoy a +14 días de los calendarios de la app Calendario (las cuentas
// de Ajustes del Sistema → Cuentas de internet: Google, Exchange, iCloud…). El refugio no guarda tokens ni secretos.
// Lee con calendar.jxa (osascript, JavaScript para Automatización); la primera vez macOS pide permiso para controlar
// Calendario. Calendario no se abre sola: si está cerrada, el estado lo dice. Las repeticiones las despliega
// normalize.ts (repeticiones): por AppleScript, Calendario solo da el primer evento de cada serie.
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, type Field } from './common.ts';
import { eventsOfCalendarMac, explainErrorCalendar, dayStart, type EventCalendarMac } from './normalize.ts';
import { t } from '../../shared/language.ts';

const READER = path.join(import.meta.dirname, 'calendar.jxa');
const DAYS = 14, DAY = 86_400_000;

export const CALENDAR_FIELDS: Field[] = [
  { name: 'calendarios', label: 'Solo estos calendarios', optional: true, help: 'Nombres de calendario tal como salen en Calendario, separados por comas. Vacío: todos.', example: 'nombre@empresa.example, Festivos' },
];

export interface CalendarResult { cerrada?: boolean; calendarios?: string[]; eventos?: EventCalendarMac[] }
export type Reader = (since: number, until: number) => Promise<CalendarResult>;

export const readCalendar: Reader = (since, until) => new Promise((ok, ko) => {
  if (process.platform !== 'darwin') return ko(new ErrorSource(t('server.macCalendarOnlyWorksOn')));
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', READER, String(since), String(until)], { timeout: 60_000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
    if (err) return ko(new ErrorSource(explainErrorCalendar(`${stderr || ''} ${err.message}`), 120_000));
    try { ok(JSON.parse(String(stdout))); } catch { ko(new ErrorSource(t('integrations.calendarUnreadable', { salida: String(stdout).slice(0, 120) }))); }
  });
});

class Calendar extends ConnectorBase {
  id = 'calendario' as const;
  intervalMs = 5 * 60_000;   // los eventos cambian poco y leer Calendario tarda unos segundos
  constructor(store: Store, private read: Reader = readCalendar) { super(store, new ConfigSource(store, 'calendario', CALENDAR_FIELDS)); }

  private filter(text = this.config.publicFields().calendarios ?? ''): (name: string) => boolean {
    const want = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return want.length ? n => want.includes(n.toLowerCase()) : () => true;
  }
  private async readAlready() {
    const since = dayStart(), until = since + DAYS * DAY;
    const r = await this.read(since, until);
    if (r.cerrada) throw new ErrorSource(t('server.calendarIsClosedOpenIt'));
    const calendars = r.calendarios ?? [];
    if (!calendars.length) throw new ErrorSource(t('server.calendarHasNoCalendarsAdd'));
    return { calendars, events: r.eventos ?? [], since, until };
  }

  protected async pollReal() {
    const { calendars, events, since, until } = await this.readAlready();
    const valid = this.filter(), chosen = calendars.filter(valid);
    if (!chosen.length) throw new ErrorSource(t('server.noCalendarIsCalledThere', { calendarios: this.config.publicFields().calendarios, calendarios2: calendars.join(', ') }));
    const list = eventsOfCalendarMac(events.filter(e => valid(e.calendario)), since, until);
    this.good(t(list.length === 1 ? 'integrations.calendarReadingOne' : 'integrations.calendarReading', { calendarios: chosen.join(', '), n: list.length, dias: DAYS }));
    return { events: list };
  }

  protected async tryReal(v: Record<string, string>) {
    const { calendars } = await this.readAlready();
    const chosen = calendars.filter(this.filter(v.calendarios ?? ''));
    if (!chosen.length) return { ok: false, detail: t('server.noCalendarMatchesThereAre', { calendarios: calendars.join(', ') }) };
    return { ok: true, detail: t('integrations.calendarResponds', { calendarios: chosen.join(', ') }) };
  }
}

export function create(store: Store, reader?: Reader) { return new Calendar(store, reader); }

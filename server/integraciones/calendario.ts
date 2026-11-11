// Calendario del Mac, solo lectura: los eventos de hoy a +14 días de los calendarios de la app Calendario (las cuentas
// de Ajustes del Sistema → Cuentas de internet: Google, Exchange, iCloud…). El refugio no guarda tokens ni secretos.
// Lee con calendario.jxa (osascript, JavaScript para Automatización); la primera vez macOS pide permiso para controlar
// Calendario. Calendario no se abre sola: si está cerrada, el estado lo dice. Las repeticiones las despliega
// normalizar.ts (repeticiones): por AppleScript, Calendario solo da el primer evento de cada serie.
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, type Field } from './comun.ts';
import { eventsOfCalendarMac, explainErrorCalendar, dayStart, type EventCalendarMac } from './normalizar.ts';
import { t } from '../../shared/idioma.ts';

const READER = path.join(import.meta.dirname, 'calendario.jxa');
const DAYS = 14, DAY = 86_400_000;

export const CALENDAR_FIELDS: Field[] = [
  { nombre: 'calendarios', etiqueta: 'Solo estos calendarios', opcional: true, ayuda: 'Nombres de calendario tal como salen en Calendario, separados por comas. Vacío: todos.', ejemplo: 'nombre@empresa.example, Festivos' },
];

export interface CalendarResult { cerrada?: boolean; calendarios?: string[]; eventos?: EventCalendarMac[] }
export type Reader = (desde: number, hasta: number) => Promise<CalendarResult>;

export const readCalendar: Reader = (desde, hasta) => new Promise((ok, ko) => {
  if (process.platform !== 'darwin') return ko(new ErrorSource(t('server.macCalendarOnlyWorksOn')));
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', READER, String(desde), String(hasta)], { timeout: 60_000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
    if (err) return ko(new ErrorSource(explainErrorCalendar(`${stderr || ''} ${err.message}`), 120_000));
    try { ok(JSON.parse(String(stdout))); } catch { ko(new ErrorSource('Calendario devolvió algo que no se entiende: ' + String(stdout).slice(0, 120))); }
  });
});

class Calendario extends ConnectorBase {
  id = 'calendario' as const;
  intervalMs = 5 * 60_000;   // los eventos cambian poco y leer Calendario tarda unos segundos
  constructor(almacen: Store, private leer: Reader = readCalendar) { super(almacen, new ConfigSource(almacen, 'calendario', CALENDAR_FIELDS)); }

  private filtro(texto = this.config.publicos().calendarios ?? ''): (nombre: string) => boolean {
    const want = texto.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return want.length ? n => want.includes(n.toLowerCase()) : () => true;
  }
  private async readAlready() {
    const desde = dayStart(), hasta = desde + DAYS * DAY;
    const r = await this.leer(desde, hasta);
    if (r.cerrada) throw new ErrorSource(t('server.calendarIsClosedOpenIt'));
    const calendarios = r.calendarios ?? [];
    if (!calendarios.length) throw new ErrorSource(t('server.calendarHasNoCalendarsAdd'));
    return { calendarios, eventos: r.eventos ?? [], desde, hasta };
  }

  protected async pollReal() {
    const { calendarios, eventos, desde, hasta } = await this.readAlready();
    const vale = this.filtro(), chosen = calendarios.filter(vale);
    if (!chosen.length) throw new ErrorSource(t('server.noCalendarIsCalledThere', { calendarios: this.config.publicos().calendarios, calendarios2: calendarios.join(', ') }));
    const lista = eventsOfCalendarMac(eventos.filter(e => vale(e.calendario)), desde, hasta);
    this.bien(`Leyendo Calendario: ${chosen.join(', ')}. ${lista.length} evento${lista.length === 1 ? '' : 's'} en ${DAYS} días.`);
    return { eventos: lista };
  }

  protected async tryReal(v: Record<string, string>) {
    const { calendarios } = await this.readAlready();
    const chosen = calendarios.filter(this.filtro(v.calendarios ?? ''));
    if (!chosen.length) return { ok: false, detalle: t('server.noCalendarMatchesThereAre', { calendarios: calendarios.join(', ') }) };
    return { ok: true, detalle: `Calendario responde. Calendarios: ${chosen.join(', ')}.` };
  }
}

export function crear(almacen: Store, lector?: Reader) { return new Calendario(almacen, lector); }

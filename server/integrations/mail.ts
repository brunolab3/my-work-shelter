// Mail del Mac (Gmail sin proyecto en Google Cloud), solo lectura: el correo sin leer de los últimos 7 días en el Buzón
// de entrada de las cuentas de Mail (la app de macOS). La cuenta de Google se añade en Ajustes del Sistema → Cuentas de
// internet (con el inicio de sesión de Apple, que los administradores de Google Workspace suelen permitir), y Mail la
// sincroniza: el refugio no guarda tokens ni secretos. Lee con mail.jxa (osascript, JavaScript para Automatización);
// la primera vez macOS pide permiso para controlar Mail. Mail no se abre sola: si está cerrada, el estado lo dice.
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, type Field } from './comun.ts';
import { mailNotification, explainErrorMail, isGmail, type AccountMail, type MessageMail } from './normalizar.ts';
import type { Notification } from './adaptadores.ts';
import { t } from '../../shared/idioma.ts';

const READER = path.join(import.meta.dirname, 'mail.jxa');
const DAYS = 7, MAXIMO = 25;

export const FIELDS_MAIL: Field[] = [
  { nombre: 'cuentas', etiqueta: 'Solo estas cuentas', opcional: true, ayuda: 'Nombres de cuenta de Mail o direcciones, separados por comas. Vacío: todas las cuentas de Mail.', ejemplo: 'Google, nombre@empresa.example' },
];

export interface ResultMail { cerrada?: boolean; cuentas?: AccountMail[]; mensajes?: MessageMail[] }
export type Reader = (conocidos: string[]) => Promise<ResultMail>;

// osascript con el lector; un error de osascript se explica en español (permiso de Automatización, Mail cerrada…)
export const readMail: Reader = conocidos => new Promise((ok, ko) => {
  if (process.platform !== 'darwin') return ko(new ErrorSource(t('server.macMailOnlyWorksOn')));
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', READER, String(DAYS), String(MAXIMO), JSON.stringify(conocidos)], { timeout: 45_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
    if (err) return ko(new ErrorSource(explainErrorMail(`${stderr || ''} ${err.message}`), 60_000));
    try { ok(JSON.parse(String(stdout))); } catch { ko(new ErrorSource(t('integrations.mailUnreadable', { salida: String(stdout).slice(0, 120) }))); }
  });
});

class Mail extends ConnectorBase {
  id = 'mail' as const;
  intervalMs = 60_000;
  private fragments = new Map<string, string>();   // id → texto ya leído (leer el cuerpo en Mail es lo lento)
  constructor(almacen: Store, private leer: Reader = readMail) { super(almacen, new ConfigSource(almacen, 'mail', FIELDS_MAIL)); }
  protected onRestart() { this.fragments.clear(); }

  private filtro(texto = this.config.publicos().cuentas ?? ''): (c: AccountMail) => boolean {
    const want = texto.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!want.length) return () => true;
    return c => want.some(q => c.nombre.toLowerCase() === q || (c.mails ?? []).some(x => x.toLowerCase() === q));
  }
  private async readAlready() {
    const r = await this.leer([...this.fragments.keys()]);
    if (r.cerrada) throw new ErrorSource(t('server.mailIsClosedOpenIt'));
    const cuentas = r.cuentas ?? [];
    if (!cuentas.length) throw new ErrorSource(t('server.mailHasNoAccountsAdd'));
    return { cuentas, mensajes: r.mensajes ?? [] };
  }
  private describir(cuentas: AccountMail[]) {
    return cuentas.map(c => `${c.mails?.[0] ?? c.nombre}${isGmail(c) ? ' (Gmail)' : ''}`).join(', ');
  }

  protected async pollReal() {
    const { cuentas, mensajes } = await this.readAlready();
    const vale = this.filtro(), elegidas = cuentas.filter(vale);
    if (!elegidas.length) throw new ErrorSource(t('server.noMailAccountMatchesThere', { cuentas: this.config.publicos().cuentas, nombre: cuentas.map(c => c.nombre).join(', ') }));
    const nameBy = new Map(elegidas.map(c => [c.nombre, c]));
    const notificaciones: Notification[] = [];
    for (const m of mensajes) {
      const c = nameBy.get(m.cuenta); if (!c) continue;
      if (m.texto !== undefined) this.fragments.set(m.id, m.texto);
      const n = mailNotification(m, c, this.fragments.get(m.id)); if (n) notificaciones.push(n);
    }
    const live = new Set(mensajes.map(m => m.id)); for (const id of this.fragments.keys()) if (!live.has(id)) this.fragments.delete(id);
    this.bien(t('server.readingMailUnreadEmailsIn', { elegidas: this.describir(elegidas), notificaciones: notificaciones.length, dIAS: DAYS }));
    return { notificaciones, complete: true };   // lo que se lee en Gmail (y Mail sincroniza) sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    const { cuentas } = await this.readAlready();
    const elegidas = cuentas.filter(this.filtro(v.cuentas ?? ''));
    if (!elegidas.length) return { ok: false, detalle: t('server.noMailAccountMatchesThere2', { nombre: cuentas.map(c => c.nombre).join(', ') }) };
    return { ok: true, detalle: t('integrations.mailResponds', { cuentas: this.describir(elegidas) }) };
  }
}

export function crear(almacen: Store, lector?: Reader) { return new Mail(almacen, lector); }

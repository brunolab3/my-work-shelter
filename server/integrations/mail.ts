// Mail del Mac (Gmail sin proyecto en Google Cloud), solo lectura: el correo sin leer de los últimos 7 días en el Buzón
// de entrada de las cuentas de Mail (la app de macOS). La cuenta de Google se añade en Ajustes del Sistema → Cuentas de
// internet (con el inicio de sesión de Apple, que los administradores de Google Workspace suelen permitir), y Mail la
// sincroniza: el refugio no guarda tokens ni secretos. Lee con mail.jxa (osascript, JavaScript para Automatización);
// la primera vez macOS pide permiso para controlar Mail. Mail no se abre sola: si está cerrada, el estado lo dice.
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, type Field } from './common.ts';
import { mailNotification, explainErrorMail, isGmail, type AccountMail, type MessageMail } from './normalize.ts';
import type { Notification } from './adapters.ts';
import { t } from '../../shared/language.ts';

const READER = path.join(import.meta.dirname, 'mail.jxa');
const DAYS = 7, MAX = 25;

export const FIELDS_MAIL: Field[] = [
  { name: 'cuentas', label: 'Solo estas cuentas', optional: true, help: 'Nombres de cuenta de Mail o direcciones, separados por comas. Vacío: todas las cuentas de Mail.', example: 'Google, nombre@empresa.example' },
];

export interface ResultMail { cerrada?: boolean; cuentas?: AccountMail[]; mensajes?: MessageMail[] }
export type Reader = (known: string[]) => Promise<ResultMail>;

// osascript con el lector; un error de osascript se explica en español (permiso de Automatización, Mail cerrada…)
export const readMail: Reader = known => new Promise((ok, ko) => {
  if (process.platform !== 'darwin') return ko(new ErrorSource(t('server.macMailOnlyWorksOn')));
  execFile('/usr/bin/osascript', ['-l', 'JavaScript', READER, String(DAYS), String(MAX), JSON.stringify(known)], { timeout: 45_000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
    if (err) return ko(new ErrorSource(explainErrorMail(`${stderr || ''} ${err.message}`), 60_000));
    try { ok(JSON.parse(String(stdout))); } catch { ko(new ErrorSource(t('integrations.mailUnreadable', { output: String(stdout).slice(0, 120) }))); }
  });
});

class Mail extends ConnectorBase {
  id = 'mail' as const;
  intervalMs = 60_000;
  private fragments = new Map<string, string>();   // id → texto ya leído (leer el cuerpo en Mail es lo lento)
  constructor(store: Store, private read: Reader = readMail) { super(store, new ConfigSource(store, 'mail', FIELDS_MAIL)); }
  protected onRestart() { this.fragments.clear(); }

  private filter(text = this.config.publicFields().cuentas ?? ''): (c: AccountMail) => boolean {
    const want = text.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!want.length) return () => true;
    return c => want.some(q => c.nombre.toLowerCase() === q || (c.mails ?? []).some(x => x.toLowerCase() === q));
  }
  private async readAlready() {
    const r = await this.read([...this.fragments.keys()]);
    if (r.cerrada) throw new ErrorSource(t('server.mailIsClosedOpenIt'));
    const counts = r.cuentas ?? [];
    if (!counts.length) throw new ErrorSource(t('server.mailHasNoAccountsAdd'));
    return { counts, messages: r.mensajes ?? [] };
  }
  private describe(counts: AccountMail[]) {
    return counts.map(c => `${c.mails?.[0] ?? c.nombre}${isGmail(c) ? ' (Gmail)' : ''}`).join(', ');
  }

  protected async pollReal() {
    const { counts, messages } = await this.readAlready();
    const valid = this.filter(), picked = counts.filter(valid);
    if (!picked.length) throw new ErrorSource(t('server.noMailAccountMatchesThere', { accounts: this.config.publicFields().cuentas, name: counts.map(c => c.nombre).join(', ') }));
    const nameBy = new Map(picked.map(c => [c.nombre, c]));
    const notifications: Notification[] = [];
    for (const m of messages) {
      const c = nameBy.get(m.cuenta); if (!c) continue;
      if (m.texto !== undefined) this.fragments.set(m.id, m.texto);
      const n = mailNotification(m, c, this.fragments.get(m.id)); if (n) notifications.push(n);
    }
    const live = new Set(messages.map(m => m.id)); for (const id of this.fragments.keys()) if (!live.has(id)) this.fragments.delete(id);
    this.good(t('server.readingMailUnreadEmailsIn', { chosen: this.describe(picked), notifications: notifications.length, days: DAYS }));
    return { notifications, complete: true };   // lo que se lee en Gmail (y Mail sincroniza) sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    const { counts } = await this.readAlready();
    const picked = counts.filter(this.filter(v.cuentas ?? ''));
    if (!picked.length) return { ok: false, detail: t('server.noMailAccountMatchesThere2', { name: counts.map(c => c.nombre).join(', ') }) };
    return { ok: true, detail: t('integrations.mailResponds', { accounts: this.describe(picked) }) };
  }
}

export function create(store: Store, reader?: Reader) { return new Mail(store, reader); }

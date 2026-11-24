// GitHub: notificaciones sin leer (GET /notifications), solo lectura. Token clásico con el permiso «notifications»
// (o «repo») en el llavero; si no hay token y `gh` tiene sesión iniciada, se usa la suya (`gh auth token`, que ya
// trae «repo»). Se sondea cada minuto (lo que pide GitHub) con Last-Modified: un 304 no gasta cuota. Lo leído en GitHub sale del tablón.
import { execFile } from 'node:child_process';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, delay, type Field } from './common.ts';
import { explainErrorGitHub, notificationsOfGitHub } from './normalize.ts';
import type { Notification } from './adapters.ts';
import { t as tr } from '../../shared/language.ts';

const API = 'https://api.github.com';

export const FIELDS_GITHUB: Field[] = [
  { name: 'token', label: 'Token personal (clásico)', secret: true, optional: true, help: 'github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token, con el permiso «notifications». Vacío: se usa la sesión de la herramienta gh si la tienes iniciada.', example: 'ghp_…' },
];

// Token de `gh` (si está instalado y con sesión). Nunca se guarda: se pide cada vez que hace falta
export function ghToken(): Promise<string | null> {
  return new Promise(resolve => execFile('gh', ['auth', 'token'], { timeout: 10_000 }, (err, output) => resolve(err ? null : String(output).trim() || null)));
}

class GitHub extends ConnectorBase {
  id = 'github' as const;
  intervalMs = 60_000;
  private modified: string | null = null;
  private lastSeen: Notification[] = [];
  private who: string | null = null;
  private ofGh = false;
  constructor(store: Store) { super(store, new ConfigSource(store, 'github', FIELDS_GITHUB)); }
  protected onRestart() { this.modified = null; this.lastSeen = []; this.who = null; this.ofGh = false; }

  private async token(v?: string): Promise<string> {
    const t = v || await this.config.secret('token');
    if (t) { this.ofGh = false; return t; }
    const gh = await ghToken();
    if (gh) { this.ofGh = true; return gh; }
    throw new ErrorSource(tr('server.aGithubTokenIsMissing'));
  }
  private async api(path: string, token: string, headers: Record<string, string> = {}) {
    const r = await ask(API + path, { service: 'GitHub', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'work-shelter', ...headers } });
    if (r.state === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw new ErrorSource(explainErrorGitHub(403, { message: 'rate limit' }), Math.max(60_000, Number(r.headers.get('x-ratelimit-reset')) * 1000 - Date.now() || 0));
    if (r.state === 429) throw new ErrorSource(explainErrorGitHub(403, { message: 'rate limit' }), delay(r, 60));
    if (r.state >= 400) throw new ErrorSource(explainErrorGitHub(r.state, r.json));
    return r;
  }
  protected ready() { return true; }   // sin token puede valer la sesión de gh: lo dice el sondeo

  protected async pollReal() {
    const token = await this.token();
    if (!this.who) this.who = (await this.api('/user', token)).json?.login ?? null;
    const r = await this.api('/notifications?per_page=50', token, this.modified ? { 'If-Modified-Since': this.modified } : {});
    if (r.state !== 304) { this.lastSeen = notificationsOfGitHub(r.json); this.modified = r.headers.get('last-modified'); }
    this.good(tr('server.connectedAsUnreadNotifications', { account: this.who ?? tr('integrations.yourAccount'), gh: this.ofGh ? tr('integrations.ghSession') : '', latest: this.lastSeen.length }));
    return { notifications: this.lastSeen, complete: true };
  }
  protected async tryReal(v: Record<string, string>) {
    try {
      const token = await this.token(v.token);
      const me = (await this.api('/user', token)).json;
      await this.api('/notifications?per_page=1', token);
      return { ok: true, detail: tr('server.validTokenCanReadIts', { account: me?.login ?? tr('integrations.yourAccount'), gh: this.ofGh ? tr('integrations.ghSession') : '' }) };
    } catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
}

export function create(store: Store) { return new GitHub(store); }

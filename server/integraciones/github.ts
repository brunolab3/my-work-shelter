// GitHub: notificaciones sin leer (GET /notifications), solo lectura. Token clásico con el permiso «notifications»
// (o «repo») en el llavero; si no hay token y `gh` tiene sesión iniciada, se usa la suya (`gh auth token`, que ya
// trae «repo»). Se sondea cada minuto (lo que pide GitHub) con Last-Modified: un 304 no gasta cuota. Lo leído en GitHub sale del tablón.
import { execFile } from 'node:child_process';
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, retraso, type Field } from './comun.ts';
import { explainErrorGitHub, notificationsOfGitHub } from './normalizar.ts';
import type { Notification } from './adaptadores.ts';
import { t as tr } from '../../shared/idioma.ts';

const API = 'https://api.github.com';

export const FIELDS_GITHUB: Field[] = [
  { nombre: 'token', etiqueta: 'Token personal (clásico)', secreto: true, opcional: true, ayuda: 'github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token, con el permiso «notifications». Vacío: se usa la sesión de la herramienta gh si la tienes iniciada.', ejemplo: 'ghp_…' },
];

// Token de `gh` (si está instalado y con sesión). Nunca se guarda: se pide cada vez que hace falta
export function ghToken(): Promise<string | null> {
  return new Promise(resolve => execFile('gh', ['auth', 'token'], { timeout: 10_000 }, (err, salida) => resolve(err ? null : String(salida).trim() || null)));
}

class GitHub extends ConnectorBase {
  id = 'github' as const;
  intervalMs = 60_000;
  private modificado: string | null = null;
  private ultimas: Notification[] = [];
  private quien: string | null = null;
  private ofGh = false;
  constructor(almacen: Store) { super(almacen, new ConfigSource(almacen, 'github', FIELDS_GITHUB)); }
  protected onRestart() { this.modificado = null; this.ultimas = []; this.quien = null; this.ofGh = false; }

  private async token(v?: string): Promise<string> {
    const t = v || await this.config.secreto('token');
    if (t) { this.ofGh = false; return t; }
    const gh = await ghToken();
    if (gh) { this.ofGh = true; return gh; }
    throw new ErrorSource(tr('server.aGithubTokenIsMissing'));
  }
  private async api(ruta: string, token: string, cabeceras: Record<string, string> = {}) {
    const r = await ask(API + ruta, { servicio: 'GitHub', cabeceras: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'work-shelter', ...cabeceras } });
    if (r.estado === 403 && r.cabeceras.get('x-ratelimit-remaining') === '0') throw new ErrorSource(explainErrorGitHub(403, { message: 'rate limit' }), Math.max(60_000, Number(r.cabeceras.get('x-ratelimit-reset')) * 1000 - Date.now() || 0));
    if (r.estado === 429) throw new ErrorSource(explainErrorGitHub(403, { message: 'rate limit' }), retraso(r, 60));
    if (r.estado >= 400) throw new ErrorSource(explainErrorGitHub(r.estado, r.json));
    return r;
  }
  protected listo() { return true; }   // sin token puede valer la sesión de gh: lo dice el sondeo

  protected async pollReal() {
    const token = await this.token();
    if (!this.quien) this.quien = (await this.api('/user', token)).json?.login ?? null;
    const r = await this.api('/notifications?per_page=50', token, this.modificado ? { 'If-Modified-Since': this.modificado } : {});
    if (r.estado !== 304) { this.ultimas = notificationsOfGitHub(r.json); this.modificado = r.cabeceras.get('last-modified'); }
    this.bien(tr('server.connectedAsUnreadNotifications', { cuenta: this.quien ?? tr('integrations.yourAccount'), gh: this.ofGh ? tr('integrations.ghSession') : '', ultimas: this.ultimas.length }));
    return { notificaciones: this.ultimas, complete: true };
  }
  protected async tryReal(v: Record<string, string>) {
    try {
      const token = await this.token(v.token);
      const yo = (await this.api('/user', token)).json;
      await this.api('/notifications?per_page=1', token);
      return { ok: true, detalle: tr('server.validTokenCanReadIts', { cuenta: yo?.login ?? tr('integrations.yourAccount'), gh: this.ofGh ? tr('integrations.ghSession') : '' }) };
    } catch (e) { return { ok: false, detalle: (e as Error).message }; }
  }
}

export function crear(almacen: Store) { return new GitHub(almacen); }

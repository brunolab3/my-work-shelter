// Jira Cloud: tus tareas para el tablero de Logística, SOLO lectura (REST v3 con tu correo y un token de API tuyo,
// autenticación básica). No trae avisos al tablón: el sondeo solo comprueba la conexión y cuenta lo abierto.
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, retraso, type Field } from './comun.ts';
import { textoDeADF, type Category, type TaskJira } from '../../shared/tablero.ts';
import { t } from '../../shared/idioma.ts';

export const FIELDS_JIRA: Field[] = [
  { nombre: 'sitio', etiqueta: 'Sitio de Jira', ayuda: 'La dirección de tu Jira Cloud, la que ves en el navegador.', ejemplo: 'empresa.atlassian.net' },
  { nombre: 'correo', etiqueta: 'Correo de tu cuenta de Atlassian', ayuda: 'El correo con el que entras en Jira.', ejemplo: 'tu@empresa.example' },
  { nombre: 'token', etiqueta: 'Token de API', secreto: true, ayuda: 'id.atlassian.com → Seguridad → Crear y gestionar tokens de API → Crear token de API (sin ámbitos: solo se usa para leer).', ejemplo: 'ATATT…' },
];

// Lo asignado a mí que sigue abierto, y lo cerrado en las dos últimas semanas (para ver qué PR se fusionaron)
export const JQL_MY_TASKS = 'assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC';
const FIELDS = ['summary', 'status', 'priority', 'issuetype', 'updated', 'project'];

export const spotOf = (s: string) => {
  const limpio = s.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpio)) throw new ErrorSource(t('server.theJiraSiteIsNot'));
  return limpio;
};

export function jiraTasks(j: any, sitio: string): TaskJira[] {
  return (j?.issues ?? []).filter((x: any) => x?.key && x.fields).map((x: any): TaskJira => {
    const f = x.fields, cat = f.status?.statusCategory?.key;
    return {
      clave: x.key, titulo: f.summary ?? '', url: `https://${sitio}/browse/${x.key}`,
      estado: f.status?.name ?? '¿?', categoria: (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'indeterminate') as Category,
      tipo: f.issuetype?.name, prioridad: f.priority?.name, proyecto: f.project?.name, actualizada: Date.parse(f.updated) || 0,
    };
  });
}

export function explainErrorJira(estado: number, j: any): string | null {
  if (estado < 400) return null;
  if (estado === 401) return t('integrations.jiraRejected');
  if (estado === 403) return t('integrations.jiraForbidden');
  if (estado === 404) return t('integrations.jiraSiteNotFound');
  if (estado === 429) return t('integrations.jiraRateLimited');
  const msg = j?.errorMessages?.[0] ?? Object.values(j?.errors ?? {})[0];
  return t('integrations.jiraResponded', { estado, msg: msg ? ': ' + msg : '' });
}

class Jira extends ConnectorBase {
  id = 'jira' as const;
  intervalMs = 5 * 60_000;
  private quien: string | null = null;
  private panel: { tareas: TaskJira[]; cuando: number } | null = null;
  constructor(almacen: Store) { super(almacen, new ConfigSource(almacen, 'jira', FIELDS_JIRA)); }
  protected onRestart() { this.quien = null; this.panel = null; }

  private async api(ruta: string, v?: Record<string, string>, cuerpo?: unknown) {
    const sitio = spotOf(v?.sitio ?? this.config.publicos().sitio ?? '');
    const correo = v?.correo ?? this.config.publicos().correo ?? '';
    const token = v?.token ?? await this.config.secreto('token');
    if (!correo || !token) throw new ErrorSource(t('server.theJiraEmailOrApi'));
    const r = await ask(`https://${sitio}${ruta}`, {
      servicio: 'Jira', metodo: cuerpo ? 'POST' : 'GET', cuerpo: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cabeceras: { Authorization: 'Basic ' + Buffer.from(`${correo}:${token}`).toString('base64'), Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    });
    const err = explainErrorJira(r.estado, r.json);
    if (err) throw new ErrorSource(err, r.estado === 429 ? retraso(r, 120) : undefined);
    return { json: r.json, sitio };
  }
  private async tasksMy(forzar = false) {
    if (!forzar && this.panel && Date.now() - this.panel.cuando < 2 * 60_000) return this.panel;
    const tareas: TaskJira[] = [];
    let page: string | undefined;
    do {
      const { json, sitio } = await this.api('/rest/api/3/search/jql', undefined, { jql: JQL_MY_TASKS, fields: FIELDS, maxResults: 100, ...(page ? { nextPageToken: page } : {}) });
      tareas.push(...jiraTasks(json, sitio));
      page = json?.isLast === false ? json?.nextPageToken : undefined;
    } while (page && tareas.length < 300);
    return this.panel = { tareas, cuando: Date.now() };
  }

  protected async pollReal() {
    if (!this.quien) this.quien = (await this.api('/rest/api/3/myself')).json?.displayName ?? null;
    const p = await this.tasksMy();
    this.bien(t('integrations.jiraConnected', { quien: this.quien ?? t('integrations.yourAccount'), n: p.tareas.filter(x => x.categoria !== 'done').length }));
    return {};
  }
  protected async tryReal(v: Record<string, string>) {
    const { json, sitio } = await this.api('/rest/api/3/myself', v);
    if (!json?.accountId) return { ok: false, detalle: t('server.jiraDidNotReturnYour') };
    this.quien = json.displayName ?? null;
    return { ok: true, detalle: t('server.connectedAsOn', { displayName: json.displayName, sitio }) };
  }
  protected async ownAction(nombre: string, d: Record<string, any>) {
    if (nombre === 'panel') { const p = await this.tasksMy(!!d.forzar); return { yo: this.quien, ...p }; }
    // una tarea con su descripción (en texto), para planificarla desde la sala de coordinación
    if (nombre === 'tarea') {
      const clave = String(d.clave ?? '').toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/.test(clave)) throw new Error(t('integrations.jiraInvalidKey', { clave }));
      const { json, sitio } = await this.api(`/rest/api/3/issue/${clave}?fields=${[...FIELDS, 'description'].join(',')}`);
      const [tarea] = jiraTasks({ issues: [json] }, sitio);
      return { ...tarea, descripcion: textoDeADF(json?.fields?.description) };
    }
    return super.ownAction(nombre, d);
  }
}

export function crear(almacen: Store) { return new Jira(almacen); }

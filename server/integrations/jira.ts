// Jira Cloud: your tasks for the Logistics board (REST v3 with your email and an API token of yours, basic auth).
// Read-only except for one write: a status transition the Overseer drags and confirms on the board (action `mover`),
// only one Jira's workflow offers for that issue. No notices: polling only checks the connection and counts what's open.
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, retraso, type Field } from './common.ts';
import { textoDeADF, jiraTransitions, transitionsTo, isColumn, type BoardColumn, type Category, type Epic, type TaskJira } from '../../shared/board.ts';
import { t } from '../../shared/language.ts';

export const FIELDS_JIRA: Field[] = [
  { nombre: 'sitio', etiqueta: 'Sitio de Jira', ayuda: 'La dirección de tu Jira Cloud, la que ves en el navegador.', ejemplo: 'empresa.atlassian.net' },
  { nombre: 'correo', etiqueta: 'Correo de tu cuenta de Atlassian', ayuda: 'El correo con el que entras en Jira.', ejemplo: 'tu@empresa.example' },
  { nombre: 'token', etiqueta: 'Token de API', secreto: true, ayuda: 'id.atlassian.com → Seguridad → Crear y gestionar tokens de API → Crear token de API (sin ámbitos: lee tus tareas y, solo cuando lo confirmas en el tablero, cambia su estado).', ejemplo: 'ATATT…' },
];

// Lo asignado a mí que sigue abierto, y lo cerrado en las dos últimas semanas (para ver qué PR se fusionaron)
export const JQL_MY_TASKS = 'assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC';
const FIELDS = ['summary', 'status', 'priority', 'issuetype', 'updated', 'project', 'parent'];

export const spotOf = (s: string) => {
  const limpio = s.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpio)) throw new ErrorSource(t('server.theJiraSiteIsNot'));
  return limpio;
};

/** The task's epic: its parent, only when that is an epic (type Epic or hierarchy level 1; a subtask's parent is a task) */
export function epicOf(parent: any): Epic | undefined {
  const tipo = parent?.fields?.issuetype;
  if (!parent?.key || !(tipo?.hierarchyLevel === 1 || /^epic$/i.test(tipo?.name ?? ''))) return undefined;
  return { clave: String(parent.key).toUpperCase(), titulo: parent.fields?.summary ?? '' };
}

export function jiraTasks(j: any, sitio: string): TaskJira[] {
  return (j?.issues ?? []).filter((x: any) => x?.key && x.fields).map((x: any): TaskJira => {
    const f = x.fields, cat = f.status?.statusCategory?.key;
    return {
      clave: x.key, titulo: f.summary ?? '', url: `https://${sitio}/browse/${x.key}`,
      estado: f.status?.name ?? '?', categoria: (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'indeterminate') as Category,
      tipo: f.issuetype?.name, prioridad: f.priority?.name, proyecto: f.project?.name, actualizada: Date.parse(f.updated) || 0,
      ...(epicOf(f.parent) ? { epica: epicOf(f.parent) } : {}),
    };
  });
}

// escritura: the board's transition, where a 403 means this account or token can't move the issue
export function explainErrorJira(estado: number, j: any, escritura = false): string | null {
  if (estado < 400) return null;
  if (estado === 401) return t('integrations.jiraRejected');
  if (estado === 403) return t(escritura ? 'integrations.jiraCannotTransition' : 'integrations.jiraForbidden');
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

  private async api(ruta: string, v?: Record<string, string>, cuerpo?: unknown, escritura = false) {
    const sitio = spotOf(v?.sitio ?? this.config.publicos().sitio ?? '');
    const correo = v?.correo ?? this.config.publicos().correo ?? '';
    const token = v?.token ?? await this.config.secreto('token');
    if (!correo || !token) throw new ErrorSource(t('server.theJiraEmailOrApi'));
    const r = await ask(`https://${sitio}${ruta}`, {
      servicio: 'Jira', metodo: cuerpo ? 'POST' : 'GET', cuerpo: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cabeceras: { Authorization: 'Basic ' + Buffer.from(`${correo}:${token}`).toString('base64'), Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    });
    const err = explainErrorJira(r.estado, r.json, escritura);
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

  private async transitionsTo(clave: string, columna: BoardColumn, actual?: unknown) {
    const { json } = await this.api(`/rest/api/3/issue/${clave}/transitions`);
    return transitionsTo(jiraTransitions(json), columna, typeof actual === 'string' ? actual : undefined);
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
      const clave = keyOf(d);
      const { json, sitio } = await this.api(`/rest/api/3/issue/${clave}?fields=${[...FIELDS, 'description'].join(',')}`);
      const [tarea] = jiraTasks({ issues: [json] }, sitio);
      return { ...tarea, descripcion: textoDeADF(json?.fields?.description) };
    }
    // the transitions that would take a task to a board column (the board's confirmation lists them)
    if (nombre === 'transiciones') { const { clave, columna } = moveArgs(d); return { transiciones: await this.transitionsTo(clave, columna, d.actual) }; }
    // the one external write: the transition the Overseer confirmed, checked again against what Jira offers now
    if (nombre === 'mover') {
      const { clave, columna } = moveArgs(d);
      const tr = (await this.transitionsTo(clave, columna)).find(x => x.id === String(d.id ?? ''));
      if (!tr) throw new Error(t('integrations.jiraTransitionGone', { clave }));
      await this.api(`/rest/api/3/issue/${clave}/transitions`, undefined, { transition: { id: tr.id } }, true);
      // the search index lags a few seconds behind: the cached board takes the new status now
      const ta = this.panel?.tareas.find(x => x.clave === clave);
      if (ta) Object.assign(ta, { estado: tr.a, categoria: tr.categoria, actualizada: Date.now() });
      return { clave, estado: tr.a, categoria: tr.categoria };
    }
    return super.ownAction(nombre, d);
  }
}

function keyOf(d: Record<string, any>) {
  const clave = String(d.clave ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/.test(clave)) throw new Error(t('integrations.jiraInvalidKey', { clave }));
  return clave;
}
function moveArgs(d: Record<string, any>) {
  const clave = keyOf(d);
  if (!isColumn(d.columna)) throw new Error(t('integrations.jiraInvalidColumn'));
  return { clave, columna: d.columna };
}

export function crear(almacen: Store) { return new Jira(almacen); }

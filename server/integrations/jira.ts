// Jira Cloud: your tasks for the Logistics board (REST v3 with your email and an API token of yours, basic auth).
// Read-only except for one write: a status transition the Overseer drags and confirms on the board (action `mover`),
// only one Jira's workflow offers for that issue. No notices: polling only checks the connection and counts what's open.
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, delay, type Field } from './common.ts';
import { textOfADF, jiraTransitions, transitionsTo, isColumn, prodCheckOf, type BoardColumn, type Category, type Epic, type TaskJira } from '../../shared/board.ts';
import { t } from '../../shared/language.ts';

export const FIELDS_JIRA: Field[] = [
  { name: 'sitio', label: 'Sitio de Jira', help: 'La dirección de tu Jira Cloud, la que ves en el navegador.', example: 'empresa.atlassian.net' },
  { name: 'correo', label: 'Correo de tu cuenta de Atlassian', help: 'El correo con el que entras en Jira.', example: 'tu@empresa.example' },
  { name: 'token', label: 'Token de API', secret: true, help: 'id.atlassian.com → Seguridad → Crear y gestionar tokens de API → Crear token de API (sin ámbitos: lee tus tareas y, solo cuando lo confirmas en el tablero, cambia su estado).', example: 'ATATT…' },
];

// Lo asignado a mí que sigue abierto, y lo cerrado en las dos últimas semanas (para ver qué PR se fusionaron)
export const JQL_MY_TASKS = 'assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC';
const FIELDS = ['summary', 'status', 'priority', 'issuetype', 'updated', 'project', 'parent'];

export const spotOf = (s: string) => {
  const clean = s.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) throw new ErrorSource(t('server.theJiraSiteIsNot'));
  return clean;
};

/** The task's epic: its parent, only when that is an epic (type Epic or hierarchy level 1; a subtask's parent is a task).
 * Also takes the issue itself, so an epic on the board is its own epic */
export function epicOf(parent: any): Epic | undefined {
  const type = parent?.fields?.issuetype;
  if (!parent?.key || !(type?.hierarchyLevel === 1 || /^epic$/i.test(type?.name ?? ''))) return undefined;
  return { key: String(parent.key).toUpperCase(), title: parent.fields?.summary ?? '' };
}

export function jiraTasks(j: any, spot: string): TaskJira[] {
  return (j?.issues ?? []).filter((x: any) => x?.key && x.fields).map((x: any): TaskJira => {
    const f = x.fields, cat = f.status?.statusCategory?.key, epic = epicOf(x) ?? epicOf(f.parent);
    return {
      key: x.key, title: f.summary ?? '', url: `https://${spot}/browse/${x.key}`,
      state: f.status?.name ?? '?', category: (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'indeterminate') as Category,
      type: f.issuetype?.name, priority: f.priority?.name, project: f.project?.name, updated: Date.parse(f.updated) || 0,
      ...(epic ? { epic } : {}),
    };
  });
}

// escritura: the board's transition, where a 403 means this account or token can't move the issue
export function explainErrorJira(state: number, j: any, isWrite = false): string | null {
  if (state < 400) return null;
  if (state === 401) return t('integrations.jiraRejected');
  if (state === 403) return t(isWrite ? 'integrations.jiraCannotTransition' : 'integrations.jiraForbidden');
  if (state === 404) return t('integrations.jiraSiteNotFound');
  if (state === 429) return t('integrations.jiraRateLimited');
  const msg = j?.errorMessages?.[0] ?? Object.values(j?.errors ?? {})[0];
  return t('integrations.jiraResponded', { estado: state, msg: msg ? ': ' + msg : '' });
}

class Jira extends ConnectorBase {
  id = 'jira' as const;
  intervalMs = 5 * 60_000;
  private who: string | null = null;
  private panel: { tareas: TaskJira[]; when: number } | null = null;
  constructor(store: Store) { super(store, new ConfigSource(store, 'jira', FIELDS_JIRA)); }
  protected onRestart() { this.who = null; this.panel = null; }

  private async api(path: string, v?: Record<string, string>, body?: unknown, isWrite = false) {
    const spot = spotOf(v?.sitio ?? this.config.publicFields().sitio ?? '');
    const email = v?.correo ?? this.config.publicFields().correo ?? '';
    const token = v?.token ?? await this.config.secret('token');
    if (!email || !token) throw new ErrorSource(t('server.theJiraEmailOrApi'));
    const r = await ask(`https://${spot}${path}`, {
      service: 'Jira', method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const err = explainErrorJira(r.state, r.json, isWrite);
    if (err) throw new ErrorSource(err, r.state === 429 ? delay(r, 120) : undefined);
    return { json: r.json, spot };
  }
  private async tasksMy(force = false) {
    if (!force && this.panel && Date.now() - this.panel.when < 2 * 60_000) return this.panel;
    const tareas: TaskJira[] = [];
    let page: string | undefined;
    do {
      const { json, spot } = await this.api('/rest/api/3/search/jql', undefined, { jql: JQL_MY_TASKS, fields: FIELDS, maxResults: 100, ...(page ? { nextPageToken: page } : {}) });
      tareas.push(...jiraTasks(json, spot));
      page = json?.isLast === false ? json?.nextPageToken : undefined;
    } while (page && tareas.length < 300);
    return this.panel = { tareas, when: Date.now() };
  }

  private async transitionsTo(key: string, column: BoardColumn, current?: unknown) {
    const { json } = await this.api(`/rest/api/3/issue/${key}/transitions`);
    const jira = (this.store.state.settings as any).verificationJira;   // the prod-check column is Jira's prod-check status
    return transitionsTo(jiraTransitions(json), column, typeof current === 'string' ? current : undefined, prodCheckOf(jira));
  }

  protected async pollReal() {
    if (!this.who) this.who = (await this.api('/rest/api/3/myself')).json?.displayName ?? null;
    const p = await this.tasksMy();
    this.good(t('integrations.jiraConnected', { quien: this.who ?? t('integrations.yourAccount'), n: p.tareas.filter(x => x.category !== 'done').length }));
    return {};
  }
  protected async tryReal(v: Record<string, string>) {
    const { json, spot } = await this.api('/rest/api/3/myself', v);
    if (!json?.accountId) return { ok: false, detail: t('server.jiraDidNotReturnYour') };
    this.who = json.displayName ?? null;
    return { ok: true, detail: t('server.connectedAsOn', { displayName: json.displayName, sitio: spot }) };
  }
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'panel') { const p = await this.tasksMy(!!d.force); return { me: this.who, ...p }; }
    // una tarea con su descripción (en texto), para planificarla desde la sala de coordinación
    if (name === 'task') {
      const key = keyOf(d);
      const { json, spot } = await this.api(`/rest/api/3/issue/${key}?fields=${[...FIELDS, 'description'].join(',')}`);
      const [task] = jiraTasks({ issues: [json] }, spot);
      return { ...task, description: textOfADF(json?.fields?.description) };
    }
    // a project's statuses, for Jira's prod-check and done ones (production verification)
    if (name === 'boardStates') {
      const board = String(d.board ?? '').toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(board)) throw new Error(t('integrations.jiraInvalidKey', { clave: board }));
      const { json } = await this.api(`/rest/api/3/project/${board}/statuses`);
      const all: any[] = ((json ?? []) as any[]).flatMap(x => x?.statuses ?? []);
      const names = (l: any[]) => [...new Set(l.map(s => String(s?.name ?? '')).filter(Boolean))];
      // those in the done category too: the game links the done status by itself when only one is (verificationBoards.ts)
      return { states: names(all), done: names(all.filter(s => s?.statusCategory?.key === 'done')) };
    }
    // the transitions that would take a task to a board column (the board's confirmation lists them)
    if (name === 'transitions') { const { key, column } = moveArgs(d); return { transitions: await this.transitionsTo(key, column, d.current) }; }
    // the one external write: the transition the Overseer confirmed, checked again against what Jira offers now
    if (name === 'move') {
      const { key, column } = moveArgs(d);
      const tr = (await this.transitionsTo(key, column)).find(x => x.id === String(d.id ?? ''));
      if (!tr) throw new Error(t('integrations.jiraTransitionGone', { clave: key }));
      await this.api(`/rest/api/3/issue/${key}/transitions`, undefined, { transition: { id: tr.id } }, true);
      // the search index lags a few seconds behind: the cached board takes the new status now
      const ta = this.panel?.tareas.find(x => x.key === key);
      if (ta) Object.assign(ta, { state: tr.a, category: tr.category, updated: Date.now() });
      return { key, state: tr.a, category: tr.category };
    }
    return super.ownAction(name, d);
  }
}

function keyOf(d: Record<string, any>) {
  const key = String(d.key ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/.test(key)) throw new Error(t('integrations.jiraInvalidKey', { clave: key }));
  return key;
}
function moveArgs(d: Record<string, any>) {
  const key = keyOf(d);
  if (!isColumn(d.column)) throw new Error(t('integrations.jiraInvalidColumn'));
  return { key, column: d.column };
}

export function create(store: Store) { return new Jira(store); }

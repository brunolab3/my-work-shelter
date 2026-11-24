// Linear: paneles y notificaciones por GraphQL con la clave de API personal (llavero), SOLO lectura desde el juego.
// La escritura (crear, mover, asignar, comentar) la hace la conversación del habitante de Logística con el
// MCP oficial de Linear (https://mcp.linear.app/mcp): es el usuario actuando. Ver mcpLinear() y docs/integrations-usage.md.
// Ojo: en GraphQL la clave va en `Authorization: <clave>` SIN «Bearer»; en el MCP, con «Bearer».
import type { McpHttpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, type Field } from './common.ts';
import { readSecret } from './keychain.ts';
import { groupMyIssues, teamsCycles, explainErrorLinear, linearNotifications, teamBoard } from './normalize.ts';
import { t } from '../../shared/language.ts';

const API = 'https://api.linear.app/graphql';
export const MCP_LINEAR = 'https://mcp.linear.app/mcp';
export const MCP_LINEAR_READING = 'https://mcp.linear.app/mcp/readonly';
// Variable de entorno con la que se inyecta la clave al proceso de Claude Code (nunca en argv ni en disco)
export const VAR_KEY_MCP = 'SHELTER_LINEAR_CLAVE';

export const FIELDS_LINEAR: Field[] = [
  { name: 'apiKey', label: 'Clave de API de Linear', secret: true, help: 'En Linear: Settings → Account → Security & access → Personal API keys → nueva clave «work-shelter». Para los paneles basta «Read»; para que el habitante de Logística cree, mueva o comente issues, añade «Write», «Create issues» y «Create comments». Empieza por lin_api_.', example: 'lin_api_…' },
];

export const Q = {
  viewer: `query Viewer { viewer { id name displayName email url organization { id name urlKey } teams { nodes { id key name } } } }`,
  // sin filtro de fecha: lo sin leer del inbox puede tener semanas (la API no filtra por readAt; se descarta lo leído al normalizar)
  notifications: `query Notificaciones { notifications(first: 100, orderBy: createdAt) { nodes { id type category title subtitle url createdAt readAt archivedAt snoozedUntilAt actor { id name displayName } botActor { id name } ... on IssueNotification { issue { id identifier title url priority trashed team { key } } comment { id body } } } } }`,
  myIssues: `query MisIssues($after: String) { viewer { assignedIssues(first: 100, after: $after, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { id identifier title url priority priorityLabel estimate dueDate updatedAt state { id name type color position } team { id key name } project { id name } cycle { id number name } labels { nodes { id name color } } } pageInfo { hasNextPage endCursor } } } }`,
  cycles: `query EquiposYCiclos { teams { nodes { id key name color cyclesEnabled activeCycle { id number name startsAt endsAt isActive progress scopeHistory completedScopeHistory } } } }`,
  teamStates: `query EstadosEquipo($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { states { nodes { name position } } } } }`,
  board: `query Tablero($teamId: String!, $filter: IssueFilter, $after: String) { team(id: $teamId) { id key name states { nodes { id name type color position } } issues(first: 150, after: $after, filter: $filter) { nodes { id identifier title url priority priorityLabel estimate dueDate state { id } assignee { id name avatarUrl } labels { nodes { id name color } } project { id name } } pageInfo { hasNextPage endCursor } } } }`,
};

// Filtros del tablero que el panel puede pedir (sintaxis oficial de IssueFilter)
export function boardFilter(d: { priority?: 'high'; label?: string; project?: string; assignedToMe?: boolean; cycle?: 'current' }) {
  const f: Record<string, unknown> = {};
  if (d.priority === 'high') f.priority = { lte: 2, neq: 0 };
  if (d.label) f.labels = { some: { name: { eq: d.label } } };
  if (d.project) f.project = { id: { eq: d.project } };
  if (d.assignedToMe) f.assignee = { isMe: { eq: true } };
  if (d.cycle === 'current') f.cycle = { isActive: { eq: true } };
  return Object.keys(f).length ? f : undefined;
}

class Linear extends ConnectorBase {
  id = 'linear' as const;
  intervalMs = 60_000;
  private who: any = null;
  private panel: { myIssues: ReturnType<typeof groupMyIssues>; cycles: ReturnType<typeof teamsCycles>; when: number } | null = null;
  constructor(store: Store) { super(store, new ConfigSource(store, 'linear', FIELDS_LINEAR)); }
  protected onRestart() { this.who = null; this.panel = null; }

  async gql(query: string, variables: Record<string, unknown> = {}, key?: string): Promise<any> {
    const k = key ?? await this.config.secret('apiKey');
    if (!k) throw new ErrorSource(t('server.theLinearApiKeyIs'));
    const r = await ask(API, { service: 'Linear', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: k }, body: JSON.stringify({ query: query, variables }) });
    const err = explainErrorLinear(r.state, r.json);
    if (err) {
      const rateLimited = r.json?.errors?.[0]?.extensions?.code === 'RATELIMITED';
      const reset = Number(r.headers.get('x-ratelimit-requests-reset'));
      throw new ErrorSource(err, rateLimited ? Math.max(60_000, reset ? reset - Date.now() : 15 * 60_000) : undefined);
    }
    return r.json;
  }
  private async dataMy(force = false) {
    if (!force && this.panel && Date.now() - this.panel.when < 5 * 60_000) return this.panel;
    const [mine, cycles] = await Promise.all([this.gql(Q.myIssues), this.gql(Q.cycles)]);
    return this.panel = { myIssues: groupMyIssues(mine), cycles: teamsCycles(cycles), when: Date.now() };
  }

  protected async pollReal() {
    if (!this.who) this.who = (await this.gql(Q.viewer)).data?.viewer;
    const notifications = linearNotifications(await this.gql(Q.notifications));
    const p = await this.dataMy().catch(() => this.panel);
    const openSessions = p?.myIssues.reduce((n, g) => n + g.issues.length, 0) ?? 0;
    this.good(t('server.connectedAsOpenIssuesAssigned', { name: this.who?.name ?? '?', linear: this.who?.organization?.name ?? 'Linear', open: openSessions }));
    return { notifications, complete: true };   // las leídas en Linear ya no vienen
  }
  protected async tryReal(v: Record<string, string>) {
    if (/^lin_oauth_/.test(v.apiKey)) return { ok: false, detail: t('server.thatLooksLikeAnOauth') };
    const j = await this.gql(Q.viewer, {}, v.apiKey);
    const me = j.data?.viewer;
    if (!me) return { ok: false, detail: t('server.linearDidNotReturnYour') };
    this.who = me;
    return { ok: true, detail: t('server.connectedAsOnTeams', { name: me.name, name2: me.organization?.name, none: (me.teams?.nodes ?? []).map((t: any) => t.key).join(', ') || t('integrations.none') }) };
  }
  // Paneles (solo lectura): mis issues por estado, ciclo actual por equipo y tablero de un equipo con filtros
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'panel') { const p = await this.dataMy(!!d.force); return { me: this.who, ...p }; }
    if (name === 'board') {
      let team = String(d.team ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(team)) { if (!this.who) this.who = (await this.gql(Q.viewer)).data?.viewer; team = (this.who?.teams?.nodes ?? []).find((t: any) => !d.team || t.key === d.team)?.id ?? ''; }
      if (!team) throw new Error(t('integrations.linearUnknownTeam', { team: d.team ?? '' }));
      return teamBoard(await this.gql(Q.board, { teamId: team, filter: boardFilter(d) }));
    }
    // a board's (team's) statuses, for picking its prod-check and done ones (production verification)
    if (name === 'boardStates') {
      const j = await this.gql(Q.teamStates, { key: String(d.board ?? '').toUpperCase() });
      const nodes: any[] = j?.data?.teams?.nodes?.[0]?.states?.nodes ?? [];
      return { states: [...nodes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map(x => String(x.name ?? '')).filter(Boolean) };
    }
    return super.ownAction(name, d);
  }
}

export function create(store: Store) { return new Linear(store); }

// MCP oficial de Linear para la sesión del habitante de Logística (Agent SDK: transporte 'http').
// Con clave en el llavero, la cabecera usa ${SHELTER_LINEAR_CLAVE}: Claude Code expande variables de entorno en la
// configuración MCP, así que la clave va solo en el entorno del proceso hijo (entornoMcpLinear) y no en argv, donde el
// SDK pone --mcp-config. Sin clave, queda el OAuth interactivo de Claude Code (/mcp → linear → Authenticate).
export async function mcpLinear(op: { onlyReading?: boolean } = {}): Promise<Record<string, McpHttpServerConfig>> {
  const key = await readSecret('linear.apiKey').catch(() => null);
  const url = op.onlyReading ? MCP_LINEAR_READING : MCP_LINEAR;
  return { linear: key ? { type: 'http', url, headers: { Authorization: `Bearer \${${VAR_KEY_MCP}}` } } : { type: 'http', url } };
}
// Entorno a añadir a options.env de query() junto con mcpLinear()
export async function environmentMcpLinear(): Promise<Record<string, string>> {
  const key = await readSecret('linear.apiKey').catch(() => null);
  return key ? { [VAR_KEY_MCP]: key } : {};
}

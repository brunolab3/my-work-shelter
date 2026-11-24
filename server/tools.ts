// Descripción en español de las herramientas de Claude Code (línea de estado, permisos, cuaderno) y ruta que tocan.
// Adaptado de code-town/server/tools.ts (MIT, © 2026 Juan Luis García) — ver LICENSES/code-town-MIT.txt
import path from 'node:path';
import type { Activity, InputView } from '../shared/protocol.ts';
import { t } from '../shared/language.ts';
import { MCP, mcpTool } from './mcpServers.ts';

type Entry = Record<string, unknown>;

const READING = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'TodoWrite', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'TaskOutput', 'BashOutput', 'Skill']);
const WEB = new Set(['WebFetch', 'WebSearch']);
const WRITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const ONLY_READING = /^\s*(cd\s+\S+\s*&&\s*)?(ls|cat|head|tail|wc|grep|rg|find|fd|tree|pwd|echo|which|file|stat|du|df|jq|less|sed\s+-n|git\s+(status|log|diff|show|branch|blame|remote|rev-parse|ls-files|grep)|npm\s+(ls|view)|node\s+--version)\b/;

const s = (v: unknown) => (typeof v === 'string' ? v : '');
export const isAgent = (n: string) => n === 'Agent' || n === 'Task';

export function toolMode(name: string, e: Entry): Activity['mode'] {
  if (WEB.has(name)) return 'web';
  if (READING.has(name) || name.startsWith('mcp__')) return 'read';
  if (WRITING.has(name)) return 'write';
  if (name === 'Bash') return ONLY_READING.test(s(e.command)) ? 'read' : 'terminal';
  if (isAgent(name) || name === 'AskUserQuestion' || name === 'ExitPlanMode') return 'think';
  return 'write';
}

function corta(p: string, cwd: string) {
  if (!p) return '';
  const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;
  const v = rel.startsWith('..') ? p : rel || '.';
  return v.length > 60 ? '…' + v.slice(-58) : v;
}
function truncate(t: string, n = 80) { const u = t.replace(/\s+/g, ' ').trim(); return u.length > n ? u.slice(0, n - 1) + '…' : u; }

export function describeTool(name: string, e: Entry, cwd: string): string {
  switch (name) {
    case 'Read': return t('server.activity.reading', { f: corta(s(e.file_path), cwd) });
    case 'Edit': case 'MultiEdit': return t('server.activity.editing', { f: corta(s(e.file_path), cwd) });
    case 'Write': return t('server.activity.writing', { f: corta(s(e.file_path), cwd) });
    case 'NotebookEdit': return t('server.activity.editingNotebook', { f: corta(s(e.notebook_path), cwd) });
    case 'Bash': return t('server.activity.running', { cmd: truncate(s(e.command), 70) });
    case 'Grep': return t('server.activity.searching', { q: truncate(s(e.pattern), 40) });
    case 'Glob': return t('server.activity.findingFiles', { q: truncate(s(e.pattern), 50) });
    case 'WebFetch': return t('server.activity.fetching', { url: truncate(s(e.url), 60) });
    case 'WebSearch': return t('server.activity.webSearch', { q: truncate(s(e.query), 50) });
    case 'Agent': case 'Task': return t('server.activity.sendingHelper', { que: truncate(s(e.description), 60) });
    case 'TodoWrite': return t('server.activity.todos');
    case 'AskUserQuestion': return t('server.activity.question');
    case 'ExitPlanMode': return t('server.activity.plan');
    case 'Skill': return t('server.activity.skill', { skill: s(e.skill) || s(e.name) });
    // las herramientas del juego para decorar la sala (server/roomDecor.ts)
    case mcpTool(MCP.shelter, 'props_catalogue'): return s(e.search) ? t('server.activity.propsSearch', { q: truncate(s(e.search), 40) }) : t('server.activity.props');
    case mcpTool(MCP.shelter, 'current_decor'): return t('server.activity.decorCurrent');
    case mcpTool(MCP.shelter, 'apply_decor'): return t('server.activity.decorApply');
    case mcpTool(MCP.shelter, 'view_room'): return t('server.activity.decorView');
    case mcpTool(MCP.shelter, 'remove_decor'): return t('server.activity.decorRemove');
    // las del reparto del trabajo desde la sala de coordinación (server/dispatch.ts)
    case mcpTool(MCP.assignment, 'shelter_rooms'): return t('server.activity.shelterRooms');
    // un mensaje o un encargo al habitante de otra sala (server/roomNotices.ts)
    case mcpTool(MCP.rooms, 'send_to_room'): return t('server.activity.sendToRoom', { sala: truncate(s(e.room), 30), clave: s(e.key) ? ' (' + s(e.key) + ')' : '' });
    case mcpTool(MCP.assignment, 'assign_work'): return s(e.key) ? t('server.activity.assignTask', { clave: s(e.key) }) : t('server.activity.assign');
    case mcpTool(MCP.rooms, 'schedule_message'): return t('server.activity.scheduleMessage', { cuando: truncate(s(e.when), 30) });
    case mcpTool(MCP.rooms, 'verification_plan'): return t('server.activity.verificationPlan');
    case mcpTool(MCP.rooms, 'award_propose'): return t('trophies.medal.activity');
    case mcpTool(MCP.rooms, 'verification_report'): return t('server.activity.verificationReport', { punto: truncate([s(e.checkpoint), s(e.signal)].filter(Boolean).join(' › '), 40) });
    default:
      return t('server.activity.using', { nombre: name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name });
  }
}

export function permissionTitle(name: string, e: Entry) {
  const f = s(e.file_path).split('/').pop();
  switch (name) {
    case 'Bash': return t('server.permission.bash');
    case 'Edit': case 'MultiEdit': return f ? t('server.permission.edit', { f }) : t('server.permission.editThis');
    case 'Write': return f ? t('server.permission.write', { f }) : t('server.permission.writeThis');
    case 'NotebookEdit': return t('server.permission.notebook');
    case 'WebFetch': return t('server.permission.webFetch');
    case 'WebSearch': return t('server.permission.webSearch');
    default: return t('server.permission.use', { nombre: name.startsWith('mcp__') ? name.split('__').slice(1).join(' › ') : name });
  }
}

// lo que no cabe se dice (cuánto falta), para que un recorte no pase por el final de verdad
const MAX_LINES_DIFF = 40, MAX_CONTENT = 2500, MAX_JSON = 2000, MAX_EDITS = 6;
function diff(a: string, b: string) {
  const c = (x: string, sign: string) => { const l = x.split('\n'); return [...l.slice(0, MAX_LINES_DIFF).map(y => sign + ' ' + y), ...(l.length > MAX_LINES_DIFF ? [t('server.moreLines', { n: l.length - MAX_LINES_DIFF })] : [])]; };
  return [...c(a, '-'), ...c(b, '+')].join('\n');
}
const truncated = (x: string, n: number) => (x.length > n ? x.slice(0, n) + '\n' + t('server.moreChars', { n: x.length - n }) : x);

// Vista previa exacta de lo que la herramienta va a hacer, en texto plano (ver VistaEntrada en shared/protocol.ts)
export function describeInput(name: string, e: Entry): InputView[] {
  switch (name) {
    case 'Bash': return [{ type: 'code', language: 'bash', text: s(e.command) }];
    case 'Edit': return [{ type: 'path', text: s(e.file_path) }, { type: 'diff', text: diff(s(e.old_string), s(e.new_string)) }];
    case 'MultiEdit': {
      const ed = Array.isArray(e.edits) ? (e.edits as Entry[]) : [];
      return [{ type: 'path', text: s(e.file_path) }, { type: 'text', text: t('server.nEdits', { n: ed.length }) + (ed.length > MAX_EDITS ? t('server.firstEditsShown', { n: MAX_EDITS }) : '') },
        { type: 'diff', text: ed.slice(0, MAX_EDITS).map(x => diff(s(x.old_string), s(x.new_string))).join('\n…\n') }];
    }
    case 'Write': return [{ type: 'path', text: s(e.file_path) }, { type: 'code', text: truncated(s(e.content), MAX_CONTENT) }];
    case 'WebFetch': return [{ type: 'path', text: s(e.url) }, ...(s(e.prompt) ? [{ type: 'text' as const, text: s(e.prompt) }] : [])];
    case 'WebSearch': return [{ type: 'text', text: t('server.quoted', { v: s(e.query) }) }];
    default: return [{ type: 'code', language: 'json', text: truncated(JSON.stringify(e, null, 2) ?? '', MAX_JSON) }];
  }
}

// Ruta del sistema de archivos que toca una llamada (para mandar al ayudante a la sala correcta)
export function toolPath(name: string, e: Entry, cwd: string): string | undefined {
  const abs = (p: string) => (p ? path.resolve(cwd, p.replace(/^~(?=\/)/, process.env.HOME ?? '~')) : undefined);
  switch (name) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'Write': return abs(s(e.file_path));
    case 'NotebookEdit': return abs(s(e.notebook_path));
    case 'Grep': case 'Glob': return abs(s(e.path)) ?? cwd;
    case 'Bash': {
      const cmd = s(e.command);
      const cd = cmd.match(/(?:^|&&|;|\()\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/);
      if (cd) return path.resolve(cwd, cd[1].replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
      const g = cmd.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
      if (g) return path.resolve(cwd, g[1].replace(/^["']|["']$/g, ''));
      const a = cmd.match(/(?:^|[\s'"=(:])(\/(?:Users|home|private|tmp|var|opt)[^\s'"`;|&<>()]*)/);
      return a ? a[1] : undefined;
    }
    default: return undefined;
  }
}

// Descripción en español de las herramientas de Claude Code (línea de estado, permisos, cuaderno) y ruta que tocan.
// Adaptado de code-town/server/tools.ts (MIT, © 2026 Juan Luis García) — ver LICENSES/code-town-MIT.txt
import path from 'node:path';
import type { Activity, InputView } from '../shared/protocolo.ts';
import { t } from '../shared/idioma.ts';

type Entrada = Record<string, unknown>;

const READING = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'TodoWrite', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'TaskOutput', 'BashOutput', 'Skill']);
const WEB = new Set(['WebFetch', 'WebSearch']);
const WRITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const ONLY_READING = /^\s*(cd\s+\S+\s*&&\s*)?(ls|cat|head|tail|wc|grep|rg|find|fd|tree|pwd|echo|which|file|stat|du|df|jq|less|sed\s+-n|git\s+(status|log|diff|show|branch|blame|remote|rev-parse|ls-files|grep)|npm\s+(ls|view)|node\s+--version)\b/;

const s = (v: unknown) => (typeof v === 'string' ? v : '');
export const isAgent = (n: string) => n === 'Agent' || n === 'Task';

export function toolMode(nombre: string, e: Entrada): Activity['modo'] {
  if (WEB.has(nombre)) return 'web';
  if (READING.has(nombre) || nombre.startsWith('mcp__')) return 'leer';
  if (WRITING.has(nombre)) return 'escribir';
  if (nombre === 'Bash') return ONLY_READING.test(s(e.command)) ? 'leer' : 'terminal';
  if (isAgent(nombre) || nombre === 'AskUserQuestion' || nombre === 'ExitPlanMode') return 'pensar';
  return 'escribir';
}

function corta(p: string, cwd: string) {
  if (!p) return '';
  const rel = path.isAbsolute(p) ? path.relative(cwd, p) : p;
  const v = rel.startsWith('..') ? p : rel || '.';
  return v.length > 60 ? '…' + v.slice(-58) : v;
}
function recorta(t: string, n = 80) { const u = t.replace(/\s+/g, ' ').trim(); return u.length > n ? u.slice(0, n - 1) + '…' : u; }

export function describeTool(nombre: string, e: Entrada, cwd: string): string {
  switch (nombre) {
    case 'Read': return t('server.activity.reading', { f: corta(s(e.file_path), cwd) });
    case 'Edit': case 'MultiEdit': return t('server.activity.editing', { f: corta(s(e.file_path), cwd) });
    case 'Write': return t('server.activity.writing', { f: corta(s(e.file_path), cwd) });
    case 'NotebookEdit': return t('server.activity.editingNotebook', { f: corta(s(e.notebook_path), cwd) });
    case 'Bash': return t('server.activity.running', { cmd: recorta(s(e.command), 70) });
    case 'Grep': return t('server.activity.searching', { q: recorta(s(e.pattern), 40) });
    case 'Glob': return t('server.activity.findingFiles', { q: recorta(s(e.pattern), 50) });
    case 'WebFetch': return t('server.activity.fetching', { url: recorta(s(e.url), 60) });
    case 'WebSearch': return t('server.activity.webSearch', { q: recorta(s(e.query), 50) });
    case 'Agent': case 'Task': return t('server.activity.sendingHelper', { que: recorta(s(e.description), 60) });
    case 'TodoWrite': return t('server.activity.todos');
    case 'AskUserQuestion': return t('server.activity.question');
    case 'ExitPlanMode': return t('server.activity.plan');
    case 'Skill': return t('server.activity.skill', { skill: s(e.skill) || s(e.name) });
    // las herramientas del juego para decorar la sala (server/decoradoSala.ts)
    case 'mcp__refugio__catalogo_atrezo': return s(e.buscar) ? t('server.activity.propsSearch', { q: recorta(s(e.buscar), 40) }) : t('server.activity.props');
    case 'mcp__refugio__decorado_actual': return t('server.activity.decorCurrent');
    case 'mcp__refugio__aplicar_decorado': return t('server.activity.decorApply');
    case 'mcp__refugio__ver_sala': return t('server.activity.decorView');
    case 'mcp__refugio__quitar_decorado': return t('server.activity.decorRemove');
    // las del reparto del trabajo desde la sala de coordinación (server/reparto.ts)
    case 'mcp__reparto__salas_del_refugio': return t('server.activity.shelterRooms');
    // un mensaje o un encargo al habitante de otra sala (server/avisosSalas.ts)
    case 'mcp__salas__enviar_a_sala': return t('server.activity.sendToRoom', { sala: recorta(s(e.sala), 30), clave: s(e.clave) ? ' (' + s(e.clave) + ')' : '' });
    case 'mcp__reparto__repartir_trabajo': return s(e.clave) ? t('server.activity.assignTask', { clave: s(e.clave) }) : t('server.activity.assign');
    default:
      return t('server.activity.using', { nombre: nombre.startsWith('mcp__') ? nombre.split('__').slice(1).join(' › ') : nombre });
  }
}

export function permissionTitle(nombre: string, e: Entrada) {
  const f = s(e.file_path).split('/').pop();
  switch (nombre) {
    case 'Bash': return t('server.permission.bash');
    case 'Edit': case 'MultiEdit': return f ? t('server.permission.edit', { f }) : t('server.permission.editThis');
    case 'Write': return f ? t('server.permission.write', { f }) : t('server.permission.writeThis');
    case 'NotebookEdit': return t('server.permission.notebook');
    case 'WebFetch': return t('server.permission.webFetch');
    case 'WebSearch': return t('server.permission.webSearch');
    default: return t('server.permission.use', { nombre: nombre.startsWith('mcp__') ? nombre.split('__').slice(1).join(' › ') : nombre });
  }
}

// lo que no cabe se dice (cuánto falta), para que un recorte no pase por el final de verdad
const MAX_LINES_DIFF = 40, MAX_CONTENT = 2500, MAX_JSON = 2000, MAX_EDITS = 6;
function diff(a: string, b: string) {
  const c = (x: string, signo: string) => { const l = x.split('\n'); return [...l.slice(0, MAX_LINES_DIFF).map(y => signo + ' ' + y), ...(l.length > MAX_LINES_DIFF ? [t('server.moreLines', { n: l.length - MAX_LINES_DIFF })] : [])]; };
  return [...c(a, '-'), ...c(b, '+')].join('\n');
}
const recortado = (x: string, n: number) => (x.length > n ? x.slice(0, n) + '\n' + t('server.moreChars', { n: x.length - n }) : x);

// Vista previa exacta de lo que la herramienta va a hacer, en texto plano (ver VistaEntrada en shared/protocolo.ts)
export function describeInput(nombre: string, e: Entrada): InputView[] {
  switch (nombre) {
    case 'Bash': return [{ tipo: 'codigo', lenguaje: 'bash', texto: s(e.command) }];
    case 'Edit': return [{ tipo: 'ruta', texto: s(e.file_path) }, { tipo: 'diff', texto: diff(s(e.old_string), s(e.new_string)) }];
    case 'MultiEdit': {
      const ed = Array.isArray(e.edits) ? (e.edits as Entrada[]) : [];
      return [{ tipo: 'ruta', texto: s(e.file_path) }, { tipo: 'texto', texto: t('server.nEdits', { n: ed.length }) + (ed.length > MAX_EDITS ? t('server.firstEditsShown', { n: MAX_EDITS }) : '') },
        { tipo: 'diff', texto: ed.slice(0, MAX_EDITS).map(x => diff(s(x.old_string), s(x.new_string))).join('\n…\n') }];
    }
    case 'Write': return [{ tipo: 'ruta', texto: s(e.file_path) }, { tipo: 'codigo', texto: recortado(s(e.content), MAX_CONTENT) }];
    case 'WebFetch': return [{ tipo: 'ruta', texto: s(e.url) }, ...(s(e.prompt) ? [{ tipo: 'texto' as const, texto: s(e.prompt) }] : [])];
    case 'WebSearch': return [{ tipo: 'texto', texto: t('server.quoted', { v: s(e.query) }) }];
    default: return [{ tipo: 'codigo', lenguaje: 'json', texto: recortado(JSON.stringify(e, null, 2) ?? '', MAX_JSON) }];
  }
}

// Ruta del sistema de archivos que toca una llamada (para mandar al ayudante a la sala correcta)
export function toolPath(nombre: string, e: Entrada, cwd: string): string | undefined {
  const abs = (p: string) => (p ? path.resolve(cwd, p.replace(/^~(?=\/)/, process.env.HOME ?? '~')) : undefined);
  switch (nombre) {
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

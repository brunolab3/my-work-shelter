// Las herramientas del juego con las que el habitante de una sala de repo la decora («Adaptar la sala al repo»):
// un servidor MCP dentro del propio proceso (Agent SDK) que solo lee y escribe el decorado de SU sala. El decorado son
// datos (shared/decor.ts), validados aquí antes de guardarlos: nada de lo que escriba el habitante se ejecuta.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sanitizeDecor, reviewDecor, boardSpot, panelSpot, WORK_ZONE, BASES_DECOR, DESCRIPTION_BASE, DECOR_WALLS, DECOR_PALETTES, SIGN_SYMBOLS, GESTURES, LIMITS, PACKS, type BaseDecor, type Decor, type DecorPiece } from '../shared/decor.ts';
import { catalog, catalogInText, propsModel } from './props.ts';
import { t, tIs } from '../shared/language.ts';
import { MCP } from './mcpServers.ts';

export interface CtxDecor {
  room(id: string): { id: string; name: string; type: string; path?: string; style?: string; side: 'left' | 'right'; decor?: Decor } | undefined;
  /** la plantilla que lleva la sala sin decorado (fundición, laboratorio…) */
  template(id: string): string;
  save(id: string, d: Decor | null): void;
  capture(id: string): Promise<{ png: Buffer; review: string[] }>;
}

// la guía va en el idioma del juego: se arma al pedirla (current_decor), no al importar
export const decorGuide = () => t('tool.decor.guide', {
  corridor: LIMITS.corridor, wallView: LIMITS.viewWall, bases: BASES_DECOR.map(b => t('tool.quoted', { v: b }) + ': ' + tIs(DESCRIPTION_BASE[b])).join('. '),
  palettes: DECOR_PALETTES.join(', '), walls: DECOR_WALLS.join(', '), gestures: GESTURES.join(', '), lamps: LIMITS.lamps, pieces: LIMITS.pieces,
  signs: LIMITS.signs, symbols: SIGN_SYMBOLS.join('|'),
});

const num = z.number();
const pointSchema = z.object({ x: num, z: num, rotation: num.optional(), gestures: z.array(z.enum(GESTURES)).optional() });
const decorSchema = () => z.object({
  base: z.enum(BASES_DECOR),
  summary: z.string().optional(), subtitle: z.string().optional(), accent: z.string().optional().describe('#rrggbb'),
  palette: z.enum(DECOR_PALETTES).optional(), walls: z.array(z.enum(DECOR_WALLS)).length(3).optional(), light: num.optional(), mirror: z.boolean().optional(),
  workstation: z.object({ screen: z.enum(['monitor', 'dual', 'computer']).optional(), desk: z.string().optional() }).optional(),
  piece: pointSchema.optional(), hobby: pointSchema.optional(),
  lamps: z.array(z.object({ x: num, z: num, color: z.string().optional(), intensity: num.optional() })).optional(),
  pieces: z.array(z.object({
    model: z.string().describe(t('tool.decor.paramModel')), x: num, z: num, y: num.optional(), rotation: num.optional().describe(t('tool.decor.paramDegrees')),
    height: num.optional(), width: num.optional(), restsOn: z.number().int().optional().describe(t('tool.decor.paramOn')),
    wall: z.boolean().optional(), lying: z.boolean().optional(), color: z.string().optional(), light: z.string().optional(),
  })).optional(),
  signs: z.array(z.object({ x: num, y: num, width: num, title: z.string(), lines: z.array(z.string()), background: z.string().optional(), ink: z.string().optional(), symbol: z.enum(SIGN_SYMBOLS).optional(), rotation: num.optional() })).optional(),
});

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const sizeOf = (p: DecorPiece): [number, number, number] | null => {
  const m = propsModel(p.model); if (!m) return null;
  const k = p.height ? p.height / m.size[1] : p.width ? p.width / m.size[0] : 1;
  return [m.size[0] * k, m.size[1] * k, m.size[2] * k];
};

/** The «shelter» MCP server of a session in room `roomId` (one per launched session) */
export function mcpDecor(roomId: string, ctx: CtxDecor) {
  const room = () => { const s = ctx.room(roomId); if (!s) throw new Error(t('tool.decor.roomGone')); return s; };
  // el habitante a veces pide aplicar y ver a la vez: la foto espera a que lo aplicado llegue al juego
  let applied = 0;
  return createSdkMcpServer({
    name: MCP.shelter, version: '1.0.0',
    tools: [
      tool('current_decor', t('tool.decor.currentDescription'), {},
        async () => {
          const s = room();
          const b = boardSpot();
          const pn = panelSpot(s.side);
          const board = t('tool.decor.yourBoard', { x: b.x.toFixed(2), y: b.y.toFixed(2), width: b.width.toFixed(2), height: b.height.toFixed(2) })
            + '\n' + t('tool.decor.yourPanel', { zone: WORK_ZONE.x, x: pn.x.toFixed(2), z: pn.z.toFixed(2), width: pn.width.toFixed(2), background: pn.background.toFixed(2) });
          return text(`${decorGuide()}\n\n${t('tool.decor.yourRoom', { name: s.name, path: s.path ?? '—' })}\n${board}\n` + (s.decor
            ? `${t('tool.decor.currentDecor')}\n${JSON.stringify(s.decor)}`
            : t('tool.decor.noDecor', { template: ctx.template(roomId), description: tIs(DESCRIPTION_BASE[ctx.template(roomId) as keyof typeof DESCRIPTION_BASE] ?? '') })));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('props_catalogue', t('tool.decor.catalogDescription'),
        { search: z.string().optional().describe(t('tool.decor.paramSearch')), pack: z.string().optional().describe(Object.keys(PACKS).join(', ')) },
        async ({ search: search, pack }) => {
          if (!catalog().length) return text(t('tool.decor.noAssets'));
          if (!search && !pack) return text(Object.entries(PACKS).map(([p, x]) => `${p} (${catalog().filter(m => m.pack === p).length}): ${tIs(x.what)}`).join('\n') + '\n\n' + t('tool.decor.askPack'));
          return text(catalogInText(search ?? '', pack ?? ''));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('apply_decor', t('tool.decor.applyDescription'),
        { decor: decorSchema() },
        async ({ decor: decor }) => {
          room();
          const { decor: d, notices } = sanitizeDecor(decor);
          if (!d) return { ...text(t('tool.decor.notApplied', { notices: notices.join(' ') })), isError: true };
          const review = reviewDecor(d, sizeOf, boardSpot(), room().side);
          ctx.save(roomId, d); applied = Date.now();
          return text([t('tool.decor.applied'), ...(notices.length ? [t('tool.decor.fixedOnValidate'), ...notices.map(a => '- ' + a)] : []), ...(review.length ? [t('tool.decor.looksWrong'), ...review.map(a => '- ' + a)] : []), t('tool.decor.lookWithView')].join('\n'));
        }, { alwaysLoad: true }),
      tool('view_room', t('tool.decor.viewDescription'), {},
        async () => {
          room();
          await new Promise(r => setTimeout(r, 500));
          if (Date.now() - applied < 1500) await new Promise(r => setTimeout(r, 1500));
          try {
            const { png, review } = await ctx.capture(roomId);
            return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: review.length ? t('tool.decor.gameSeesWrong') + '\n' + review.slice(0, 30).map(r => '- ' + r).join('\n') : t('tool.decor.allGood') }] };
          } catch (e) { return { ...text(t('tool.decor.photoFailed', { error: (e as Error).message })), isError: true }; }
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('remove_decor', t('tool.decor.removeDescription'), {},
        async () => { room(); ctx.save(roomId, null); return text(t('tool.decor.removed')); }, { alwaysLoad: true }),
    ],
  });
}

/** Lo que se le pide al habitante con «Adaptar la sala al repo» (sale como mensaje del Supervisor), en el idioma del juego */
export const adaptPrompt = () => t('prompt.adaptRoom');

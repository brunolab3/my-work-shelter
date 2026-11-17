// The names of the game's MCP servers. A dweller sees their tools as `mcp__<name>__<tool>`, where <name> is the key in
// the session's mcpServers: sesiones.ts keys each server by its own name, so this is the one place that fixes both.
export const MCP = { rooms: 'rooms', review: 'review', assignment: 'assignment', plan: 'plan', shelter: 'shelter' } as const;

/** The full tool name a session sees */
export const mcpTool = (server: (typeof MCP)[keyof typeof MCP], tool: string) => `mcp__${server}__${tool}`;

/** Servers that gate themselves (they only touch the room's decor or plan, read the repo, or confirm with the Overseer
 *  what they launch): allowed without asking, and kept out of auto mode's classifier */
export const SELF_GATED = [MCP.shelter, MCP.assignment, MCP.review, MCP.plan];

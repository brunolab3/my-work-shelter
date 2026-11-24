import { describe, expect, it } from 'vitest';
import { CONVERSATION_MARK, descendants, markedChild, parsePs } from './sessionProcesses.ts';

const PS = `
    1     0 /sbin/launchd
  500     1 node server/main.ts
  600   500 /opt/homebrew/bin/claude --output-format stream-json --resume=a
  601   500 /opt/homebrew/bin/claude --output-format stream-json
  700   600 /bin/zsh -c pnpm run serve-legacy
  701   700 node /x/.bin/pnpm run serve-legacy
  702   701 node ng serve --port 5216
  703   702 /x/esbuild --service=0.25.0
  710   601 /bin/zsh -c npm test
  800     1 node orphan-from-a-closed-conversation
`;

describe('processes a conversation started', () => {
  it('reads a ps snapshot', () => {
    expect(parsePs(PS)[2]).toEqual({ pid: 600, ppid: 500, command: '/opt/homebrew/bin/claude --output-format stream-json --resume=a' });
  });
  it('walks every descendant of its claude, and only those', () => {
    expect(descendants(parsePs(PS), 600, 500).map(p => p.pid)).toEqual([700, 701, 702, 703]);
    expect(descendants(parsePs(PS), 601, 500).map(p => p.pid)).toEqual([710]);
  });
  it('never takes the game itself nor PID 1, even in a broken snapshot', () => {
    const rows = parsePs(PS).concat({ pid: 500, ppid: 703, command: 'cycle' }, { pid: 1, ppid: 703, command: 'cycle' });
    expect(descendants(rows, 600, 500).map(p => p.pid)).toEqual([700, 701, 702, 703]);
  });
  it('finds its claude by the mark in its environment', () => {
    const envs = `  600 /opt/homebrew/bin/claude --resume=a HOME=/u ${CONVERSATION_MARK}=s1 PATH=/bin\n  601 /opt/homebrew/bin/claude HOME=/u ${CONVERSATION_MARK}=s10\n`;
    expect(markedChild(envs, 's1')).toBe(600);
    expect(markedChild(envs, 's10')).toBe(601);
    expect(markedChild(envs, 's2')).toBeUndefined();
  });
});

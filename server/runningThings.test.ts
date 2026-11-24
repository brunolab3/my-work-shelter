import { describe, expect, it } from 'vitest';
import { dwellersOf, groupRunning, parseListeners, parseProcs, stopTarget } from './runningThings.ts';
import { memoryLight, parseEtime } from '../shared/runningThings.ts';

// the app (100) → bash → supervisor → server (500) → two dwellers' claude (600, 601) and a git run; the app's renderer
// and GPU; the terminal host, detached; a dev server from a terminal and macOS's AirPlay
const PS = `
    1     0   10000 10-00:00:00 /sbin/launchd
  100     1  512000 2-03:04:05 /Applications/work-shelter.app/Contents/MacOS/Electron
  101   100 2048000    01:02:03 /Applications/work-shelter.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer
  102   100  204800    01:02:03 /Applications/work-shelter.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper --type=gpu-process
  103   100     400    01:02:03 /bin/bash /x/shelter
  104   103    4000    01:02:03 node server/supervisor.mjs
  500   104  153600       10:00 node --import tsx server/main.ts
  600   500  307200       09:00 /opt/homebrew/bin/claude --output-format stream-json
  601   500  204800       08:00 /opt/homebrew/bin/claude --output-format stream-json
  610   500   20480       00:02 git status
  611   500    1024       00:00 ps -axwwo pid=,ppid=,rss=,etime=,command=
  700   600    2048       05:00 /bin/zsh -c pnpm run serve
  701   700   51200       05:00 node /x/.bin/pnpm run serve
  702   701 1048576       04:59 node ng serve --port 4200
  703   700   10240       04:00 node vitest
  710   601  102400       01:00 /bin/zsh -c npm test
  800     1    5120 3-00:00:00 node --import tsx /x/server/terminalHost.ts /tmp/sock
  900   801   81920       30:00 node vite --port 5173
  801     1    2048       30:00 -zsh
  950     1    8192 1-00:00:00 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter
`;
const LSOF = 'p500\nf20\nn127.0.0.1:3778\np702\nf30\nn[::1]:4200\nf31\nn127.0.0.1:4200\np900\nn*:5173\np950\nn*:7000\n';
const ctx = { server: 500, app: 100, terminalHost: '/x/server/terminalHost.ts', dwellers: new Map([[600, 's1'], [601, 's2']]) };
const snap = () => groupRunning(parseProcs(PS), parseListeners(LSOF), ctx, 1);

describe('what is running', () => {
  it('reads ps ages and lsof ports', () => {
    expect(parseEtime('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    expect(parseEtime('04:59')).toBe(299);
    expect(parseListeners(LSOF).get(702)).toEqual([4200]);
  });
  it('the game: the server, its launchers up to the app and the app’s helpers, largest first; not ps itself', () => {
    const g = snap().game;
    expect(g.map(p => [p.pid, p.part])).toEqual([[101, 'renderer'], [100, 'main'], [102, 'gpu'], [500, 'server'], [800, 'terminals'], [104, 'supervisor']]);
    expect(g.find(p => p.pid === 500)?.ports).toEqual([3778]);
  });
  it('the helpers as one line: their count and memory, in the section’s total', () => {
    const s = snap();
    expect(s.helpers.count).toBe(2);
    expect(s.helpers.mb).toBeCloseTo((20480 + 400) / 1024);
    expect(s.gameMb).toBeCloseTo([512000, 2048000, 204800, 400, 4000, 153600, 20480, 5120].reduce((a, b) => a + b) / 1024);
  });
  it('without the app, only the supervisor above the server', () => {
    const s = groupRunning(parseProcs(PS), new Map(), { ...ctx, app: undefined }, 1);
    expect(s.game.map(p => p.pid).sort()).toEqual([104, 500, 800]);
    expect(s.helpers.count).toBe(1);
  });
  it('each dweller with its descendants as a tree, siblings largest first; heaviest dweller first', () => {
    const d = snap().dwellers;
    expect(d.map(x => x.sessionId)).toEqual(['s1', 's2']);
    expect(d[0].children.map(c => [c.pid, c.depth])).toEqual([[700, 1], [701, 2], [702, 3], [703, 2]]);
    expect(d[1].children.map(c => c.pid)).toEqual([710]);
  });
  it('dev servers: every local listener that is not the game’s nor the system’s, with who started it', () => {
    const s = snap().devServers;
    expect(s.map(x => [x.pid, x.ports, x.sessionId, x.parent?.pid])).toEqual([[702, [4200], 's1', 701], [900, [5173], undefined, 801]]);
  });
  it('the total is the game and the dwellers with what they started, not other dev servers', () => {
    const kb = [512000, 2048000, 204800, 400, 4000, 153600, 20480, 5120, 307200, 204800, 2048, 51200, 1048576, 10240, 102400].reduce((a, b) => a + b);
    expect(snap().totalMb).toBeCloseTo(kb / 1024);
  });
  it('colours the chip by the threshold', () => {
    expect([memoryLight(undefined, 8192), memoryLight(6000, 8192), memoryLight(6500, 8192), memoryLight(9000, 8192)]).toEqual(['gray', 'green', 'yellow', 'red']);
  });
  it('stops only what a dweller started, with what that started; never its claude, the game or anything else', () => {
    const rows = parseProcs(PS);
    expect(stopTarget(rows, ctx.dwellers, 700, 500)).toMatchObject({ sessionId: 's1' });
    expect(stopTarget(rows, ctx.dwellers, 700, 500)?.procs.map(p => p.pid)).toEqual([700, 701, 703, 702]);
    expect(stopTarget(rows, ctx.dwellers, 710, 500)?.procs.map(p => p.pid)).toEqual([710]);
    for (const pid of [600, 601, 500, 100, 101, 104, 800, 900, 1, 9999]) expect(stopTarget(rows, ctx.dwellers, pid, 500)).toBeUndefined();
  });
  it('tells each dweller’s claude by its mark or, started before the mark, by the session it resumes', () => {
    const rows = parseProcs(`
  500     1  1000 01:00 node server/main.ts
  600   500  1000 01:00 /opt/homebrew/bin/claude --output-format stream-json
  601   500  1000 01:00 /opt/homebrew/bin/claude --resume=c2 --verbose
  602   500  1000 01:00 /opt/homebrew/bin/claude --verbose
  603   500  1000 01:00 git status
  604   600  1000 01:00 claude --resume=c2
`);
    expect([...dwellersOf(rows, 500, new Map([[600, 's1']]), id => id === 'c2' ? 's2' : undefined)]).toEqual([[600, 's1'], [601, 's2'], [602, '']]);
  });
});

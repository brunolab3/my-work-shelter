import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAge, pollWhileOpen, shortCommand } from './runningList';

describe('the running-things popover', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('reads the processes only while open: at once, then every few seconds after each answer; nothing once closed', async () => {
    const read = vi.fn(() => Promise.resolve());
    const p = pollWhileOpen(read, 4000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).not.toHaveBeenCalled();
    p.open();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_100);
    expect(read).toHaveBeenCalledTimes(3);
    p.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('an answer arriving after closing and reopening does not start a second loop', async () => {
    let answer!: () => void;
    const read = vi.fn(() => new Promise<void>(ok => { answer = ok; }));
    const p = pollWhileOpen(read, 4000);
    p.open(); const first = answer; p.close(); p.open();
    first(); answer();
    await vi.advanceTimersByTimeAsync(4_100);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('names processes and their age', () => {
    expect(shortCommand('/A/work-shelter.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer')).toBe('Electron Helper (Renderer)');
    expect(shortCommand('/opt/homebrew/bin/node ng serve --port 4200')).toBe('node ng serve --port 4200');
    expect([formatAge(45), formatAge(720), formatAge(3 * 3600 + 300), formatAge(2 * 86400 + 3 * 3600)]).toEqual(['45 s', '12 min', '3 h 5 min', '2 d 3 h']);
  });
});

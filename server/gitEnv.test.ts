// The game's git environment (gitEnv.ts): its polling must never take optional locks such as .git/index.lock
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitEnvironment } from './gitEnv.ts';

describe('gitEnvironment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('disables optional locks, even if the server was started with them on', () => {
    vi.stubEnv('GIT_OPTIONAL_LOCKS', '1');
    expect(gitEnvironment().GIT_OPTIONAL_LOCKS).toBe('0');
  });

  it('keeps them disabled with unrelated extras, and only an explicit override changes it', () => {
    expect(gitEnvironment({ GIT_EDITOR: 'true', GCM_INTERACTIVE: 'never' }).GIT_OPTIONAL_LOCKS).toBe('0');
    expect(gitEnvironment({ GIT_OPTIONAL_LOCKS: '1' }).GIT_OPTIONAL_LOCKS).toBe('1');
  });
});

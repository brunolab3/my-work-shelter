// Environment for the git processes the game launches. Many run on their own (each room's state, every 20 s) on folders
// that may come from outside, and a repo's local config (.git/config) can make git run a command when it looks at the
// status (core.fsmonitor): the game's wins (GIT_CONFIG_COUNT, like a `-c`). Diffs also go with --no-ext-diff and
// --no-textconv. GIT_OPTIONAL_LOCKS=0 (like `--no-optional-locks`) keeps `git status` from taking .git/index.lock to
// write the refreshed index, which broke the dwellers' own `git add`/`git commit`. Without the secret or the server
// settings (SHELTER_*), like the sessions.
export function gitEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('SHELTER_') && !k.startsWith('GIT_CONFIG_')) env[k] = v;
  return { ...env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra };
}

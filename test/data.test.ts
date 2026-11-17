// Rules from AGENTS.md that code can check: no real people or companies (only reserved example domains), no secrets,
// and every third-party asset with its licence.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(__dirname, '..');
const BINARY = /\.(glb|gltf|bin|ogg|mp3|wav|png|jpe?g|webp|gif|mp4|woff2?|ttf|otf|ico|icns)$/i;
const tracked = execFileSync('git', ['ls-files'], { cwd: raiz, encoding: 'utf8' }).split('\n').filter(f => f && !BINARY.test(f));
const read = (f: string) => { try { return readFileSync(path.join(raiz, f), 'utf8'); } catch { return ''; } };

// RFC 2606 reserved names, plus Gmail Message-IDs and git's own ssh user
const SAFE_EMAIL = /@([a-z0-9-]+\.)*(example|test|invalid)$|@example\.(com|org|net)$|@mail\.gmail\.com$|^git@github\.com$/i;
// files whose emails belong to third parties by licence (font authors)
const LICENCE_FILE = /^LICENSES\/|\/OFL-[^/]+\.txt$|\/LICENSE\.txt$/;
// token shapes from GitHub, Slack, Linear, Anthropic/OpenAI, AWS and JWTs: split test strings ('ghp' + '_…')
const TOKEN = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|lin_api_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./;

describe('data in the repo', () => {
  it('every email address in tracked files uses a reserved example domain (no real people or companies)', () => {
    const hits = tracked.filter(f => !LICENCE_FILE.test(f)).flatMap(f =>
      [...read(f).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)].map(m => m[0]).filter(e => !SAFE_EMAIL.test(e)).map(e => `${f}: ${e}`));
    expect(hits).toEqual([]);
  });

  it('no token-shaped string in tracked files', () => {
    expect(tracked.filter(f => TOKEN.test(read(f)))).toEqual([]);
  });

  it('every sound in web/public/audio is listed in LICENSES/AUDIO.md (by name or prefix*)', () => {
    const pats = [...read('LICENSES/AUDIO.md').matchAll(/`([^`]+)`/g)].map(m => new RegExp('^' + m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
    const sin = readdirSync(path.join(raiz, 'web/public/audio')).map(f => f.replace(/\.[^.]+$/, '')).filter(s => !pats.some(r => r.test(s)));
    expect(sin).toEqual([]);
  });

  it('every interface font has its OFL next to it, and every third-party piece its licence and a mention in docs/assets.md', () => {
    const dir = path.join(raiz, 'web/public/fonts'), files = readdirSync(dir);
    const ofl = files.filter(f => f.startsWith('OFL-')).map(f => f.slice(4, -4).toLowerCase().replace(/[^a-z0-9]/g, ''));
    expect(files.filter(f => /\.woff2?$/.test(f)).filter(f => !ofl.some(o => f.replace(/[^a-z0-9]/g, '').startsWith(o)))).toEqual([]);
    const terceros = readdirSync(path.join(raiz, 'assets/terceros'));
    const assets = read('docs/assets.md');
    expect(terceros.filter(d => !readdirSync(path.join(raiz, 'assets/terceros', d)).some(f => /^LICEN[CS]E/i.test(f)) || !assets.includes(`assets/terceros/${d}`))).toEqual([]);
  });
});

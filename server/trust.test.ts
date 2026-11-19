// Confianza en la carpeta (sessions.ts): la configuración de proyecto de un repo solo se carga si se ha aceptado en Claude Code
// o en el juego
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { confianza } from './sessions.ts';
import { EXAMPLES_FOLDER } from './examples.ts';
import { ROOMS_FOLDERS } from './state.ts';

describe('confianza en la carpeta', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'confianza-'));
  const claudeJson = path.join(base, '.claude.json');
  const repo = (nombre: string, archivos: string[]) => { const d = path.join(base, nombre); mkdirSync(d, { recursive: true }); for (const f of archivos) { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), '{}'); } return d; };
  it('sin configuración de proyecto no hay nada que cargar', () => {
    expect(confianza(repo('limpio', ['README.md']), claudeJson)).toBe('sin-config');
  });
  it('con hooks, MCP, reglas o instrucciones del repo y sin aceptar la confianza, no se carga', () => {
    expect(confianza(repo('hooks', ['.claude/settings.json']), claudeJson)).toBe('sin-confianza');
    expect(confianza(repo('mcp', ['.mcp.json']), claudeJson)).toBe('sin-confianza');
    expect(confianza(repo('reglas', ['.claude/rules/x.md']), claudeJson)).toBe('sin-confianza');
    expect(confianza(repo('instrucciones', ['.claude/CLAUDE.md']), claudeJson)).toBe('sin-confianza');
  });
  it('el settings.local.json solo cuenta si viene con el repo', () => {
    const propio = repo('local-propio', ['.claude/worktrees/x/README.md', '.claude/settings.local.json']);
    execFileSync('git', ['init', '-q'], { cwd: propio });
    expect(confianza(propio, claudeJson)).toBe('sin-config');
    const ajeno = repo('local-ajeno', ['.claude/settings.local.json']);
    execFileSync('git', ['init', '-q'], { cwd: ajeno }); execFileSync('git', ['add', '-f', '.claude/settings.local.json'], { cwd: ajeno });
    expect(confianza(ajeno, claudeJson)).toBe('sin-confianza');
    expect(confianza(repo('local-sin-git', ['.claude/settings.local.json']), claudeJson)).toBe('sin-confianza');
  });
  it('las carpetas de las salas especiales son de confianza; los repos de ejemplo, no (son de fuera)', () => {
    const s = path.join(ROOMS_FOLDERS, 'prueba-confianza'); mkdirSync(s, { recursive: true }); writeFileSync(path.join(s, 'CLAUDE.md'), '#');
    expect(confianza(s, claudeJson)).toBe('confiada');
    const d = path.join(EXAMPLES_FOLDER, 'express'); mkdirSync(path.join(d, '.claude'), { recursive: true }); writeFileSync(path.join(d, 'CLAUDE.md'), '#');
    expect(confianza(d, claudeJson)).toBe('sin-confianza');
  });
  it('aceptada en el juego («no vuelvas a preguntar») → se carga', () => {
    const d = repo('en-juego/dentro', ['CLAUDE.md']);
    expect(confianza(d, claudeJson, [path.join(base, 'en-juego')])).toBe('confiada');
  });
  it('aceptada en Claude Code (la carpeta o una que la contiene) → se carga', () => {
    const d = repo('aceptado/dentro', ['CLAUDE.md']);
    writeFileSync(claudeJson, JSON.stringify({ projects: { [path.join(base, 'aceptado')]: { hasTrustDialogAccepted: true } } }));
    expect(confianza(d, claudeJson)).toBe('confiada');
  });
  it('a repo cloned from GitHub is a boundary: a trusted folder above it doesn\'t cover it, trust in it does', () => {
    const d = repo('raiz-confiada/clon', ['.claude/settings.json']), w = repo('raiz-confiada/clon/.claude/worktrees/t', ['CLAUDE.md']);
    writeFileSync(claudeJson, JSON.stringify({ projects: { [path.join(base, 'raiz-confiada')]: { hasTrustDialogAccepted: true } } }));
    expect(confianza(d, claudeJson)).toBe('confiada');
    expect(confianza(d, claudeJson, [], [d])).toBe('sin-confianza');
    expect(confianza(w, claudeJson, [], [d])).toBe('sin-confianza');
    expect(confianza(w, claudeJson, [d], [d])).toBe('confiada');
  });
  it('el repo del propio juego es de confianza', () => {
    expect(confianza(path.resolve(import.meta.dirname, '..'), claudeJson)).toBe('confiada');
  });
});

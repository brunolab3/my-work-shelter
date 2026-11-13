import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resumeCommand, hookCommand, desktopScript, quotes, promptContinue, outsideOpen, closeOutside } from './escritorio.ts';

const ID = '0f8a2c1e-4b6d-4e2f-9a1b-3c5d7e9f1a2b';

describe('salir a la superficie: comandos', () => {
  it('retoma la conversación en su carpeta, con sus permisos y modelo', () => {
    expect(resumeCommand({ claudeId: ID, cwd: '/Users/x/mi repo', permisos: 'acceptEdits', modelo: 'opus' }))
      .toBe(`cd '/Users/x/mi repo' && claude --resume ${ID} --model 'opus' --permission-mode acceptEdits`);
    expect(resumeCommand({ claudeId: ID, cwd: '/a', permisos: 'default' })).toBe(`cd '/a' && claude --resume ${ID}`);
    expect(resumeCommand({ claudeId: ID, cwd: '/a', permisos: 'bypassPermissions' })).toContain('--dangerously-skip-permissions');
    expect(resumeCommand({ claudeId: ID, cwd: '/a', permisos: 'inventado; rm -rf /' })).toBe(`cd '/a' && claude --resume ${ID}`);
  });
  it('si estaba trabajando, le pide que siga', () => {
    expect(resumeCommand({ claudeId: ID, cwd: '/a', continuar: true })).toBe(`cd '/a' && claude --resume ${ID} ${quotes(promptContinue())}`);
  });
  it('no acepta identificadores raros ni deja escapar las comillas', () => {
    expect(() => resumeCommand({ claudeId: 'x; rm -rf ~', cwd: '/a' })).toThrow();
    expect(resumeCommand({ claudeId: ID, cwd: '/a', remoto: "Ana · it's", continuar: true })).toBe(`cd '/a' && claude --resume ${ID} --remote-control ${quotes("Ana · it's")} ${quotes(promptContinue())}`);
    expect(resumeCommand({ claudeId: ID, cwd: '/a', remoto: ' ' })).toBe(`cd '/a' && claude --resume ${ID} --remote-control 'work-shelter'`);
    expect(quotes("it's")).toBe(`'it'\\''s'`);
    expect(hookCommand('/r/shelter', '/tmp/s.sock', "sala:a'b::2")).toBe(`exec '/r/shelter' enganchar 'sala:a'\\''b::2' --socket '/tmp/s.sock'`);
  });
});

describe('salir a la superficie: AppleScript', () => {
  const items = [{ titulo: 'Néstor · "arreglo"', comando: `cd '/a' && echo "hola\\n"` }, { titulo: 'Terminal · b', comando: 'exec x' }];
  it('iTerm: una pestaña por cosa, en ventana nueva si se pide', () => {
    const g = desktopScript(items, 'iTerm', true);
    expect(g).toContain('tell application "iTerm"');
    expect(g).toContain('else if true or (count of windows) is 0 then');
    expect(g.match(/write text/g)).toHaveLength(2);
    expect(g.match(/tell w to create tab/g)).toHaveLength(2);   // la del else de la primera y la segunda
    // las comillas y barras del comando se escapan para AppleScript
    expect(g).toContain(`write text "cd '/a' && echo \\"hola\\\\n\\""`);
    expect(g).toContain('set name to "Néstor · \\"arreglo\\""');
  });
  it('Terminal: una ventana por cosa', () => {
    const g = desktopScript(items, 'Terminal', false);
    expect(g.match(/do script/g)).toHaveLength(2);
  });
});

describe('conversaciones abiertas fuera', () => {
  // un Claude Code de fuera sin --resume (un `claude` recién empezado, la app de Claude) solo se ve en su ficha de
  // ~/.claude/sessions: un proceso vivo de verdad con su ficha, como la apunta Claude Code
  it('ve por su ficha la que no se abrió con --resume, nunca la de un hijo del servidor, y la cierra al traerla', async () => {
    const config = mkdtempSync(path.join(os.tmpdir(), 'cc-')); mkdirSync(path.join(config, 'sessions'));
    const hijo = spawn('sleep', ['30']); const id = '7c1d9e40-2a5b-4f8c-b3e6-0d4a8f2c6e19';
    writeFileSync(path.join(config, 'sessions', `${hijo.pid}.json`), JSON.stringify({ pid: hijo.pid, sessionId: id.toUpperCase(), cwd: '/tmp', kind: 'interactive' }));
    const antes = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = config;
    try {
      expect(outsideOpen(process.pid).has(id)).toBe(false);   // hijo del «servidor»: es del juego
      expect(outsideOpen(-1).has(id)).toBe(true);
      const fin = new Promise(ok => hijo.on('exit', ok));
      expect(await closeOutside(id, -1)).toBe(1);
      await fin;
      expect(hijo.signalCode).toBe('SIGTERM');
      expect(outsideOpen(-1).has(id)).toBe(false);
    } finally { if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = antes; hijo.kill('SIGKILL'); }
  });
});

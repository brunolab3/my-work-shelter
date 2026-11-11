import { describe, it, expect } from 'vitest';
import { resumeCommand, hookCommand, desktopScript, quotes, promptContinue } from './escritorio.ts';

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

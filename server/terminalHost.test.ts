// El anfitrión de terminales con un cliente de fuera enganchado (salir a la superficie): el mismo PTY en los dos
// sitios, el tamaño lo manda el de fuera y la terminal sobrevive al apagado del juego mientras siga abierta fuera.
import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const SOCK = path.join(os.tmpdir(), `ws-prueba-${process.pid}.sock`);
let host: ChildProcess | null = null;
afterAll(() => { host?.kill('SIGTERM'); });

// una conexión de líneas JSON que guarda lo recibido y deja esperar a que llegue algo
function connection(first: Record<string, unknown>) {
  const s = net.connect(SOCK);
  const received: any[] = [];
  let text = '', rest = '';
  const waits: (() => void)[] = [];
  s.setEncoding('utf8');
  s.on('connect', () => s.write(JSON.stringify(first) + '\n'));
  s.on('data', (d: string) => {
    rest += d; let i: number;
    while ((i = rest.indexOf('\n')) >= 0) { const m = JSON.parse(rest.slice(0, i)); rest = rest.slice(i + 1); received.push(m); if (m.ev === 'datos') text += m.datos; }
    for (const f of waits.splice(0)) f();
  });
  const closed = new Promise<void>(ok => s.on('close', () => ok()));
  return {
    s, received, closed, text: () => text,
    send: (m: Record<string, unknown>) => s.write(JSON.stringify(m) + '\n'),
    until: (f: () => boolean, ms = 8000) => new Promise<void>((ok, ko) => {
      const end = setTimeout(() => ko(new Error('no ha llegado: ' + text.slice(-300))), ms);
      const watch = () => { if (f()) { clearTimeout(end); ok(); } else waits.push(watch); };
      watch();
    }),
  };
}

describe('anfitrión de terminales con clientes de fuera', () => {
  it('engancha, comparte el PTY, manda el tamaño de fuera y sobrevive al apagado', async () => {
    host = spawn(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'terminalHost.ts'), SOCK], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { if (await new Promise(ok => { const s = net.connect(SOCK); s.on('connect', () => { s.destroy(); ok(true); }); s.on('error', () => ok(false)); })) break; await new Promise(r => setTimeout(r, 100)); }

    const srv = connection({ op: 'servidor' });
    await srv.until(() => srv.received.some(m => m.ev === 'hola'));
    expect(srv.received.find(m => m.ev === 'hola').version).toBe(2);
    srv.send({ op: 'abrir', id: 't1', cwd: os.tmpdir(), cols: 80, filas: 24, shell: '/bin/sh', env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', PS1: '$ ' } });
    srv.send({ op: 'entrada', id: 't1', datos: 'echo dentro-$((1+1))\n' });
    await srv.until(() => srv.text().includes('dentro-2'));

    // de fuera: recibe lo que ya había y escribe en el mismo shell
    const outside = connection({ op: 'enganchar', id: 't1', cols: 100, filas: 30 });
    await outside.until(() => outside.text().includes('dentro-2'));
    await srv.until(() => srv.received.some(m => m.ev === 'fuera' && m.n === 1));
    // el juego pide otro tamaño: mientras haya alguien fuera, manda el de fuera
    srv.send({ op: 'tamano', id: 't1', cols: 70, filas: 20 });
    outside.send({ op: 'entrada', datos: 'echo fuera-$((2+2)); stty size\n' });
    await outside.until(() => /30 100/.test(outside.text()));
    await srv.until(() => srv.text().includes('fuera-4'));

    const list = connection({ op: 'lista' });
    await list.until(() => list.received.some(m => m.ev === 'lista'));
    expect(list.received[0].terminales).toEqual([expect.objectContaining({ id: 't1', fuera: 1 })]);

    // el juego se apaga: la terminal que está fuera sigue
    srv.send({ op: 'apagar' }); srv.s.end();
    await srv.closed;
    outside.send({ op: 'entrada', datos: 'echo sigo-$((3+3))\n' });
    await outside.until(() => outside.text().includes('sigo-6'));

    // un id que no existe se rechaza
    const nobody = connection({ op: 'enganchar', id: 'no-existe', cols: 80, filas: 24 });
    await nobody.until(() => nobody.received.some(m => m.ev === 'error'));

    // un servidor nuevo vuelve a encontrarla; al salir del shell se va y avisa a los dos
    const srv2 = connection({ op: 'servidor' });
    await srv2.until(() => srv2.received.some(m => m.ev === 'hola'));
    expect(srv2.received.find(m => m.ev === 'hola').terminales).toEqual([expect.objectContaining({ id: 't1', fuera: 1 })]);
    outside.send({ op: 'entrada', datos: 'exit\n' });
    await outside.until(() => outside.received.some(m => m.ev === 'fin'));
    await srv2.until(() => srv2.received.some(m => m.ev === 'fin' && m.id === 't1'));
    srv2.s.end();
  }, 30_000);
});

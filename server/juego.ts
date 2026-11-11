// Economía y actividades del refugio, con el servidor como autoridad (la chatarra no se fabrica en el cliente).
// Recompensas ligadas al trabajo real: cada tarea terminada da chatarra y, a veces, una pieza para la guía de campo;
// cada llamada a herramienta hace crecer los cultivos de hidroponía.
// Primera iteración sin terminar, abierta a propósito para quien la quiera rehacer (README, «Lo que está a medias»).
import type { Store } from './estado.ts';
import { PIECES, SHOP, SIGNALS, HARVESTS, INITIAL_SPECIES, rarityOnRandom } from '../shared/catalogo.ts';
import { t as tr } from '../shared/idioma.ts';

const STEPS_BY_PHASE = 8;

export function ensurePlayer(almacen: Store) {
  const j = almacen.estado.jugador as any;
  if (!Number.isFinite(j.scrap) || j.scrap < 0) j.scrap = 0;
  j.species ??= [...INITIAL_SPECIES]; j.armas ??= ['ballesta']; if (!j.armas.includes('ballesta')) j.armas.unshift('ballesta'); j.signals ??= []; j.inventario ??= {}; j.records ??= {}; j.tienda ??= [];
  if (!j.arma || j.arma === 'pistola') j.arma = 'ballesta';
  for (const c of j.cultivos) { c.phase = Math.max(1, Math.min(4, c.phase ?? 1)); c.progreso ??= 0; }
}

export function growCrops(almacen: Store) {
  for (const c of almacen.estado.jugador.cultivos) {
    if (c.phase >= 4) continue;
    c.progreso += 1;
    if (c.progreso >= STEPS_BY_PHASE) { c.phase += 1; c.progreso = 0; }
  }
}

// Tarea terminada: chatarra según el trabajo y una pieza con probabilidad
export function taskReward(almacen: Store, herramientas: number): { scrap: number; pieza?: { id: string; nombre: string; rarity: string } } {
  const scrap = 10 + Math.min(40, Math.round(herramientas / 2));
  let pieza: { id: string; nombre: string; rarity: string } | undefined;
  if (Math.random() < 0.55 + Math.min(0.35, herramientas / 60)) {
    const rarity = rarityOnRandom(Math.random());
    const opciones = PIECES.filter(p => p.rarity === rarity);
    const p = opciones[Math.floor(Math.random() * opciones.length)];
    pieza = { id: p.id, nombre: p.nombre, rarity: p.rarity };
  }
  almacen.cambiar(e => {
    e.jugador.scrap += scrap; e.jugador.finishedTasks++;
    if (pieza) e.jugador.inventario['pieza:' + pieza.id] = (e.jugador.inventario['pieza:' + pieza.id] ?? 0) + 1;
  });
  return { scrap, pieza };
}

// límites de las actividades: una ronda de tiro dura 30 s y no da más de lo que da físicamente; el generador se avería de vez en cuando
const lastTime = new Map<string, number>();
function cooldown(clave: string, ms: number) {
  const t = lastTime.get(clave) ?? 0; if (Date.now() - t < ms) throw new Error(tr('server.notYetWaitAMoment'));
  lastTime.set(clave, Date.now());
}

export function gameAction(nombre: string, d: Record<string, any>, almacen: Store): unknown {
  ensurePlayer(almacen);
  const e = almacen.estado; const j = e.jugador as any;
  switch (nombre) {
    case 'comprar': {
      const a = SHOP.find(x => x.id === d.article); if (!a) throw new Error(tr('server.thatItemIsNotIn'));
      if (j.tienda.includes(a.id) || j.armas.includes(a.id)) throw new Error(tr('server.youAlreadyHaveIt'));
      if (j.scrap < a.price) throw new Error(tr('server.youAreScrapShort', { scrap: a.price - j.scrap }));
      almacen.cambiar(() => {
        j.scrap -= a.price;
        if (a.tipo === 'arma') { j.armas.push(a.id); j.arma = a.id; }
        else if (a.tipo === 'semilla') { j.tienda.push(a.id); if (a.especie && !j.species.includes(a.especie)) j.species.push(a.especie); }
        else { j.tienda.push(a.id); if (!j.outfit.includes(a.id)) j.outfit.push(a.id); }
      });
      return { ok: true, scrap: j.scrap };
    }
    case 'equipar': {
      // accesorio de la tienda para el Supervisor o regalado a un habitante (uno por hueso)
      const a = SHOP.find(x => x.id === d.article && x.tipo === 'accesorio'); if (!a) throw new Error(tr('server.itIsNotAnAccessory'));
      if (!j.tienda.includes(a.id)) throw new Error(tr('server.youHaveToBuyIt'));
      const duenno: any = d.quien === 'supervisor' ? e.supervisor : e.habitantes.find(h => h.id === d.quien);
      if (!duenno) throw new Error(tr('server.iCannotFindWhoTo'));
      const lista: string[] = (duenno.accesorios ??= []);
      almacen.cambiar(() => {
        const i = lista.indexOf(a.id);
        if (i >= 0) lista.splice(i, 1);
        else { for (const otro of [...lista]) if (SHOP.find(x => x.id === otro)?.bone === a.bone) lista.splice(lista.indexOf(otro), 1); lista.push(a.id); }
      });
      return true;
    }
    case 'arma': { if (!j.armas.includes(d.arma)) throw new Error(tr('server.youDoNotHaveThat')); almacen.cambiar(() => { j.arma = d.arma; }); return true; }
    case 'vender': {
      const clave = String(d.objeto);
      if (!/^(pieza|cosecha):[A-Za-z]+$/.test(clave) || !Object.hasOwn(j.inventario, clave) || !(j.inventario[clave] > 0)) throw new Error(tr('server.youHaveNoneLeft'));
      const n = Math.max(1, Math.min(j.inventario[clave], Math.floor(Number(d.n)) || 1));
      const valor = clave.startsWith('pieza:') ? PIECES.find(p => 'pieza:' + p.id === clave)?.valor ?? 1 : HARVESTS[clave.slice(8)]?.valor ?? 1;
      almacen.cambiar(() => { j.inventario[clave] -= n; if (!j.inventario[clave]) delete j.inventario[clave]; j.scrap += valor * n; });
      return { scrap: valor * n };
    }
    case 'cosechar': {
      const c = j.cultivos[Number(d.bancal)]; if (!c) throw new Error(tr('server.thatPlanterDoesNotExist'));
      if (c.phase < 4) throw new Error(tr('server.itIsNotRipeYet'));
      const especie = d.especie && j.species.includes(d.especie) ? d.especie : c.especie;
      almacen.cambiar(() => {
        j.inventario['cosecha:' + c.especie] = (j.inventario['cosecha:' + c.especie] ?? 0) + 3;
        j.records.cosecha = (j.records.cosecha ?? 0) + 3; j.scrap += 4;
        c.especie = especie; c.phase = 1; c.progreso = 0;
      });
      return { cosecha: HARVESTS[c.especie]?.nombre, n: 3 };
    }
    case 'plantar': {
      const c = j.cultivos[Number(d.bancal)]; if (!c) throw new Error(tr('server.thatPlanterDoesNotExist'));
      if (!j.species.includes(d.especie)) throw new Error(tr('server.youHaveNoSeedsOf'));
      almacen.cambiar(() => { c.especie = d.especie; c.phase = 1; c.progreso = 0; });
      return true;
    }
    case 'tiro': {
      cooldown('tiro', 28_000);
      const mult = d.arma === 'escopeta' && j.armas.includes('escopeta') ? 2 : d.arma === 'rifle' && j.armas.includes('rifle') ? 1.5 : 1;
      const puntos = Math.max(0, Math.min(Math.round(600 * mult), Math.round(Number(d.puntos) || 0)));
      const record = puntos > (j.records.tiro ?? 0);
      const prize = Math.floor(puntos / 12);
      almacen.cambiar(() => { if (record) j.records.tiro = puntos; j.scrap += prize; j.records.shootingRuns = (j.records.shootingRuns ?? 0) + 1; });
      return { record, prize, mejor: j.records.tiro };
    }
    case 'radio': {
      const s = SIGNALS.find(x => x.id === d.senal); if (!s) throw new Error(tr('server.unknownSignal'));
      if (j.signals.includes(s.id)) return { nueva: false, prize: 0 };
      almacen.cambiar(() => { j.signals.push(s.id); j.scrap += 15; j.records.radio = j.signals.length; });
      return { nueva: true, prize: 15 };
    }
    case 'generador': { cooldown('generador', 120_000); almacen.cambiar(() => { j.records.generador = (j.records.generador ?? 0) + 1; j.scrap += 8; }); return { prize: 8 }; }
    default: throw new Error('Acción de juego desconocida: ' + nombre);
  }
}

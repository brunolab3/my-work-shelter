import { describe, it, expect } from 'vitest';
import { INITIAL_ROOMS } from './refugioInicial.ts';
import { distribute } from './disposicion.ts';
import { sectorOf, floorSector, roomTone, areaByType, SECTORS } from './sectores.ts';
import { PLANNING_ROOM } from './disposicion.ts';

describe('sectores', () => {
  it('cada sala está en una planta de su sector (el ascensor y el plano dicen lo mismo que el cartel)', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ id: 'r' + i, tipo: 'repo', nombre: 'repo-' + i }));
    for (const salas of [INITIAL_ROOMS, distribute([...INITIAL_ROOMS, ...many])]) {
      const plantas = Math.max(...salas.map(s => s.planta)) + 1;
      for (const s of salas) expect(floorSector(s.planta, plantas).id, s.id).toBe(sectorOf(s.tipo, s.id, (s as any).area).id);
    }
  });
  it('los repos van por su área: verde frontend, amarillo backend y rojo los críticos', () => {
    expect(sectorOf('repo', 'x', 'frontend').id).toBe('frontend');
    expect(sectorOf('repo', 'x', 'critico').id).toBe('critico');
    expect(sectorOf('repo').id).toBe('backend');
    expect(roomTone({ tipo: 'repo', area: 'critico' })[0]).toBe(SECTORS.critico.color);
    expect(sectorOf('coordinacion', PLANNING_ROOM, 'frontend').id).toBe('enlace');
    expect(floorSector(3, 6, [{ planta: 3, tipo: 'repo', orden: 0, area: 'frontend' }, { planta: 3, tipo: 'repo', orden: 1, area: 'frontend' }, { planta: 3, tipo: 'repo', orden: 2 }]).id).toBe('frontend');
  });
  it('el área de serie sale del tipo de proyecto', () => {
    expect(areaByType('web Next.js')).toBe('frontend');
    expect(areaByType('node')).toBe('frontend');
    expect(areaByType('python')).toBe('backend');
    expect(areaByType('carpeta')).toBe('backend');
  });
  it('mando es negro, enlace azul, ocio naranja y acceso violeta', () => {
    expect(sectorOf('camara').id).toBe('mando'); expect(sectorOf('puente').id).toBe('mando');
    expect(sectorOf('planificacion').id).toBe('enlace');
    expect(sectorOf('discoteca').id).toBe('ocio');
    expect(sectorOf('puerta').id).toBe('acceso');
  });
});

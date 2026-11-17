// Música propia de las salas que la tienen (la discoteca sin Spotify, el hilo musical de Chapa y Pintura).
// Contrato con el mundo: `pulsoMusica(sala)` dice si suena y por dónde va el compás, para que las luces y quien baila
// vayan a tiempo. (Lo rellena el motor de audio; mientras no suene nada, devuelve `sonando: false`.)

export interface MusicPulse {
  sonando: boolean;   // suena música en esa sala (la propia o, en la discoteca, Spotify)
  bpm: number;        // golpes por minuto del tema que suena
  phase: number;       // 0..1 dentro del golpe actual (0 = justo en el golpe)
  golpe: number;      // número de golpe desde que empezó el tema (cada 4, un compás)
  energy: number;    // 0..1, cuánto «empuja» ahora el tema (sube en los estribillos, baja en los puentes)
}

const SILENCE: MusicPulse = { sonando: false, bpm: 118, phase: 0, golpe: 0, energy: 0 };
type Source = (sala: string) => MusicPulse | null;
let fuente: Source = () => null;

/** El motor de audio registra aquí de dónde sale el pulso */
export function registrarPulse(f: Source) { fuente = f; }
export function musicPulse(sala: string): MusicPulse { return fuente(sala) ?? SILENCE; }

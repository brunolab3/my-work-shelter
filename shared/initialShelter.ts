// Disposición inicial del refugio (compartida por el servidor y el cliente sin conexión).
// Sin salas de repo de serie: entran solas los repos de la raíz de repos que se elige en la bienvenida (y al cambiarla
// en la cámara acorazada), y los demás, por la Puerta Principal.
import { tonesForRepeated } from './recruits.ts';
import type { Look } from './appearance.ts';
import { distribute, PLANNING_ROOM } from './layout.ts';
export interface InitialRoom { id: string; type: 'repo' | 'coordination' | 'comms' | 'calendar' | 'logistics' | 'git' | 'bridge' | 'vault' | 'gate' | 'hydroponics' | 'gallery' | 'disco' | 'bodyshop' | 'review'; name: string; floor: number; side: 'left' | 'right'; orden: number; variant: string; style?: string }
export interface InitialDweller { id: string; name: string; nickname: string; type: string; bio: string; roomId: string; voice: number; tint?: string; tone?: number; look?: Look }

// el sitio de cada sala (planta, lado, orden) lo decide `distribuir`: aquí solo qué salas hay
export const INITIAL_ROOMS: InitialRoom[] = distribute<Omit<InitialRoom, 'floor' | 'side' | 'orden'>>([
  { id: 'gate', type: 'gate', name: 'Puerta Principal', variant: 'neutral' },
  { id: 'vault', type: 'vault', name: 'Cámara acorazada', variant: 'vault' },
  { id: 'bridge', type: 'bridge', name: 'Puente de Mando', variant: 'bridge' },
  { id: 'comms', type: 'comms', name: 'Comunicaciones', variant: 'comms' },
  // el tipo 'planificacion' es la agenda (calendario) y 'logistica', la sala «Planificación» (el tablero de tareas)
  { id: 'calendar', type: 'calendar', name: 'Agenda', variant: 'plan' },
  { id: 'logistics', type: 'logistics', name: 'Planificación', variant: 'logistics' },
  // git y GitHub: el cliente de git del refugio para todos los repos, la matriz de contribuciones y los pull requests
  { id: 'git', type: 'git', name: 'Control de Versiones', variant: 'logistics' },
  // others' PRs that ask for the Overseer's review: one hologram and conversation per task, in worktrees of its own
  { id: 'review', type: 'review', name: 'Revisión', variant: 'logistics' },
  // planificar tareas de Jira con todos los repos a la vista y repartirlas por salas (tipo 'coordinacion'): su carpeta es
  // la raíz de repos del refugio (la de la cámara acorazada; el servidor la pone)
  { id: PLANNING_ROOM, type: 'coordination', name: 'Logística', variant: 'logistics' },
  { id: 'hydroponics', type: 'hydroponics', name: 'Hidroponía', variant: 'comms' },
  // la discoteca, en la planta de ocio entre los cultivos y el ascensor: la música del refugio (Spotify) para currar
  { id: 'disco', type: 'disco', name: 'Discoteca', variant: 'neutral' },
  { id: 'gallery', type: 'gallery', name: 'Galería de tiro', variant: 'logistics' },
  // barbería y ropería: aquí se cambia el aspecto del Supervisor y de cualquier habitante (humano o robot)
  { id: 'bodyshop', type: 'bodyshop', name: 'Chapa y Pintura', variant: 'neutral' },
]);

/** La sala donde empieza el Supervisor: Planificación, con el tablero de tareas (una sala de servicio: no se retira) */
export const ROOM_SUPERVISOR = 'logistics';

/** Qué es cada sala especial (por tipo): se lee en el plano y, en mayúsculas, bajo el nombre del cartel */
export const ROOM_DESCRIPTION: Record<string, string> = {
  gate: 'Control de acceso', vault: 'Credenciales, llaves y secretos', bridge: 'Código del refugio',
  comms: 'Email y chats', calendar: 'Calendario y agenda', logistics: 'Gestión de tableros', git: 'Git y GitHub', review: 'PR que esperan tu revisión',
  hydroponics: 'Cultivos', gallery: 'Tiro al blanco', disco: 'Música para currar', bodyshop: 'Barbería y ropería', coordination: 'Planificar y repartir tareas',
};

const H = (id: string, name: string, nickname: string, type: string, roomId: string, bio: string, voice: number, look?: Look): InitialDweller => ({ id, name, nickname, type, roomId, bio, voice, ...(look ? { look } : {}) });
/** El guardián de la puerta: un androide como el de la cámara acorazada (del mismo tamaño que todos), en acero
 *  pavonado y con las luces rojas de vigilancia */
export const LOOK_GUARDIAN: Look = { especie: 'robot', pieces: { cabeza: 'cabeza.4GTN', torso: 'torso.4GTN', brazos: 'brazos.4GTN', piernas: 'piernas.4GTN' }, colors: { cabeza1: '#4a4f57', torso1: '#4a4f57', torso2: '#2b2d33', piernas1: '#33363b', piernas2: '#2b2d33', luz: '#ff5a4a' } };
/** El barbero y sastre de Chapa y Pintura */
export const LOOK_FITO: Look = { especie: 'human', pieces: { cara: 'cara.ToySoldier', cejas: 'cejas.Vampire', pelo: 'pelo.Vampire', barba: 'barba.ToySoldier', torso: 'torso.Vampire', brazos: 'brazos.Vampire', piernas: 'piernas.Vampire', gafas: 'gafas.Witch.Glasses' }, colors: { pelo: '#2a1f1a', torso1: '#2b3f6b', torso2: '#d8d2c4', piernas1: '#2b2d33' } };
// una sala, un habitante (lleva varios trabajos a la vez, cada uno en su pestaña).
// Quien comparte modelo con otro habitante lleva otro tono de ropa y pelo: el reparto no tiene gemelos
export const INITIAL_DWELLERS: InitialDweller[] = tonesForRepeated([
  H('nestor', 'Néstor', 'El Arquitecto', 'Survivalist', 'bridge', 'Trazó los planos del refugio cuando aún era un agujero en la roca. Perdió un ojo leyendo código minificado; con el otro ve el refugio entero en su código fuente.', 85),
  H('hanzo', 'Hanzo', 'Doble Factor', '4GTN', 'vault', 'Samurái de la cámara acorazada. Corta en dos cualquier token que asome en un commit y pide el segundo factor hasta para darte los buenos días.', 95),
  H('ondina', 'Ondina', 'Bandeja de Entrada', 'Hoarder', 'comms', 'Escucha la radio, el correo y los rumores. Sobre todo los rumores.', 190),
  H('calixto', 'Calixto', 'Reunión Que Pudo Ser Un Correo', 'Engineer', 'calendar', 'Tiene el calendario más ordenado del refugio y ningún hueco libre.', 120),
  H('mona', 'Octocat', 'La Octogata', 'Octocat', 'git', 'Mitad gata, mitad pulpo, toda control de versiones. Con un tentáculo prepara, con otro hace commit y con un tercero ya está haciendo push. Lleva la cuenta de sus contribuciones y no consiente un force push a main.', 205),
  H('ines', 'Inés', 'Divide y Vencerás', 'SpaceRanger', PLANNING_ROOM, 'Parte cualquier tarea en trozos que caben en un repo cada uno. Antes de tocar una línea quiere saber qué repos se enteran.', 160),
  H('lupe', 'Lupe', 'Lupa en Mano', 'Protagonist_A', 'review', 'Lee los PR de los demás línea a línea y con el ticket al lado. Nunca publica un comentario sin que lo firmes tú.', 175),
  H('cmd', 'CM-4', 'Comandante de Tickets', 'Clanker', 'logistics', 'Robot pesado reconvertido. Mueve issues como antes movía chatarra.', 90),
  H('fermin', 'Fermín', 'Refactor Eterno', 'Hiker', 'hydroponics', 'Fue el bedel del refugio hasta que llegó el Arquitecto. Ahora riega lechugas y sigue diciendo que el refugio se mantiene solo. Sigue mintiendo.', 115),
  H('guardian', 'Guardián', 'Portero', '4GTN', 'gate', 'Vigila la puerta. No deja pasar a nadie sin un package.json.', 80, LOOK_GUARDIAN),
  H('dj80', 'DJ-80', 'El Pinchadiscos', 'Robot_One', 'disco', 'Robot de megafonía reprogramado para pinchar. Asegura que no hay bug que aguante un bajo a 120 BPM. Antes de las doce, nada con letra.', 70),
  H('fito', 'Fito', 'Navaja Suave', 'Hiker', 'bodyshop', 'Corta el pelo, cose dobladillos y endereza abolladuras. Dice que a todo el mundo le queda bien el gris acero. Miente con mucho cariño.', 130, LOOK_FITO),
  H('dora', 'Dora', 'Pulso Firme', 'Survivalist', 'gallery', 'Campeona de tiro del refugio. Afina la puntería con los bugs de producción.', 190),
]);

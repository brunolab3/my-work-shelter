// Disposición inicial del refugio (compartida por el servidor y el cliente sin conexión).
// Sin salas de repo de serie: entran solas los repos de la raíz de repos que se elige en la bienvenida (y al cambiarla
// en la cámara acorazada), y los demás, por la Puerta Principal.
import { tonesForRepeated } from './reclutas.ts';
import type { Look } from './aspecto.ts';
import { distribute, PLANNING_ROOM } from './disposicion.ts';
export interface InitialRoom { id: string; tipo: 'repo' | 'coordinacion' | 'comunicaciones' | 'planificacion' | 'logistica' | 'git' | 'puente' | 'camara' | 'puerta' | 'hidroponia' | 'galeria' | 'discoteca' | 'chapa'; nombre: string; planta: number; lado: 'izq' | 'der'; orden: number; variant: string; estilo?: string }
export interface InitialDweller { id: string; nombre: string; mote: string; tipo: string; bio: string; salaId: string; voz: number; tinte?: string; tone?: number; aspecto?: Look }

// el sitio de cada sala (planta, lado, orden) lo decide `distribuir`: aquí solo qué salas hay
export const INITIAL_ROOMS: InitialRoom[] = distribute<Omit<InitialRoom, 'planta' | 'lado' | 'orden'>>([
  { id: 'puerta', tipo: 'puerta', nombre: 'Puerta Principal', variant: 'neutro' },
  { id: 'camara', tipo: 'camara', nombre: 'Cámara acorazada', variant: 'acorazada' },
  { id: 'puente', tipo: 'puente', nombre: 'Puente de Mando', variant: 'puente' },
  { id: 'comunicaciones', tipo: 'comunicaciones', nombre: 'Comunicaciones', variant: 'comms' },
  // el tipo 'planificacion' es la agenda (calendario) y 'logistica', la sala «Planificación» (el tablero de tareas)
  { id: 'planificacion', tipo: 'planificacion', nombre: 'Agenda', variant: 'plan' },
  { id: 'logistica', tipo: 'logistica', nombre: 'Planificación', variant: 'logistica' },
  // git y GitHub: el cliente de git del refugio para todos los repos, la matriz de contribuciones y los pull requests
  { id: 'git', tipo: 'git', nombre: 'Control de Versiones', variant: 'logistica' },
  // planificar tareas de Jira con todos los repos a la vista y repartirlas por salas (tipo 'coordinacion'): su carpeta es
  // la raíz de repos del refugio (la de la cámara acorazada; el servidor la pone)
  { id: PLANNING_ROOM, tipo: 'coordinacion', nombre: 'Logística', variant: 'logistica' },
  { id: 'hidroponia', tipo: 'hidroponia', nombre: 'Hidroponía', variant: 'comms' },
  // la discoteca, en la planta de ocio entre los cultivos y el ascensor: la música del refugio (Spotify) para currar
  { id: 'discoteca', tipo: 'discoteca', nombre: 'Discoteca', variant: 'neutro' },
  { id: 'galeria', tipo: 'galeria', nombre: 'Galería de tiro', variant: 'logistica' },
  // barbería y ropería: aquí se cambia el aspecto del Supervisor y de cualquier habitante (humano o robot)
  { id: 'chapa', tipo: 'chapa', nombre: 'Chapa y Pintura', variant: 'neutro' },
]);

/** La sala donde empieza el Supervisor: Planificación, con el tablero de tareas (una sala de servicio: no se retira) */
export const ROOM_SUPERVISOR = 'logistica';

/** Qué es cada sala especial (por tipo): se lee en el plano y, en mayúsculas, bajo el nombre del cartel */
export const ROOM_DESCRIPTION: Record<string, string> = {
  puerta: 'Control de acceso', camara: 'Credenciales, llaves y secretos', puente: 'Código del refugio',
  comunicaciones: 'Email y chats', planificacion: 'Calendario y agenda', logistica: 'Gestión de tableros', git: 'Git y GitHub',
  hidroponia: 'Cultivos', galeria: 'Tiro al blanco', discoteca: 'Música para currar', chapa: 'Barbería y ropería', coordinacion: 'Planificar y repartir tareas',
};

const H = (id: string, nombre: string, mote: string, tipo: string, salaId: string, bio: string, voz: number, aspecto?: Look): InitialDweller => ({ id, nombre, mote, tipo, salaId, bio, voz, ...(aspecto ? { aspecto } : {}) });
/** El guardián de la puerta: un androide como el de la cámara acorazada (del mismo tamaño que todos), en acero
 *  pavonado y con las luces rojas de vigilancia */
export const LOOK_GUARDIAN: Look = { especie: 'robot', piezas: { cabeza: 'cabeza.4GTN', torso: 'torso.4GTN', brazos: 'brazos.4GTN', piernas: 'piernas.4GTN' }, colores: { cabeza1: '#4a4f57', torso1: '#4a4f57', torso2: '#2b2d33', piernas1: '#33363b', piernas2: '#2b2d33', luz: '#ff5a4a' } };
/** El barbero y sastre de Chapa y Pintura */
export const LOOK_FITO: Look = { especie: 'humano', piezas: { cara: 'cara.ToySoldier', cejas: 'cejas.Vampire', pelo: 'pelo.Vampire', barba: 'barba.ToySoldier', torso: 'torso.Vampire', brazos: 'brazos.Vampire', piernas: 'piernas.Vampire', gafas: 'gafas.Witch.Glasses' }, colores: { pelo: '#2a1f1a', torso1: '#2b3f6b', torso2: '#d8d2c4', piernas1: '#2b2d33' } };
// una sala, un habitante (lleva varios trabajos a la vez, cada uno en su pestaña).
// Quien comparte modelo con otro habitante lleva otro tono de ropa y pelo: el reparto no tiene gemelos
export const INITIAL_DWELLERS: InitialDweller[] = tonesForRepeated([
  H('nestor', 'Néstor', 'El Arquitecto', 'Survivalist', 'puente', 'Trazó los planos del refugio cuando aún era un agujero en la roca. Perdió un ojo leyendo código minificado; con el otro ve el refugio entero en su código fuente.', 85),
  H('hanzo', 'Hanzo', 'Doble Factor', '4GTN', 'camara', 'Samurái de la cámara acorazada. Corta en dos cualquier token que asome en un commit y pide el segundo factor hasta para darte los buenos días.', 95),
  H('ondina', 'Ondina', 'Bandeja de Entrada', 'Hoarder', 'comunicaciones', 'Escucha la radio, el correo y los rumores. Sobre todo los rumores.', 190),
  H('calixto', 'Calixto', 'Reunión Que Pudo Ser Un Correo', 'Engineer', 'planificacion', 'Tiene el calendario más ordenado del refugio y ningún hueco libre.', 120),
  H('mona', 'Octocat', 'La Octogata', 'Octocat', 'git', 'Mitad gata, mitad pulpo, toda control de versiones. Con un tentáculo prepara, con otro hace commit y con un tercero ya está haciendo push. Lleva la cuenta de sus contribuciones y no consiente un force push a main.', 205),
  H('ines', 'Inés', 'Divide y Vencerás', 'SpaceRanger', PLANNING_ROOM, 'Parte cualquier tarea en trozos que caben en un repo cada uno. Antes de tocar una línea quiere saber qué repos se enteran.', 160),
  H('cmd', 'CM-4', 'Comandante de Tickets', 'Clanker', 'logistica', 'Robot pesado reconvertido. Mueve issues como antes movía chatarra.', 90),
  H('fermin', 'Fermín', 'Refactor Eterno', 'Hiker', 'hidroponia', 'Fue el bedel del refugio hasta que llegó el Arquitecto. Ahora riega lechugas y sigue diciendo que el refugio se mantiene solo. Sigue mintiendo.', 115),
  H('guardian', 'Guardián', 'Portero', '4GTN', 'puerta', 'Vigila la puerta. No deja pasar a nadie sin un package.json.', 80, LOOK_GUARDIAN),
  H('dj80', 'DJ-80', 'El Pinchadiscos', 'Robot_One', 'discoteca', 'Robot de megafonía reprogramado para pinchar. Asegura que no hay bug que aguante un bajo a 120 BPM. Antes de las doce, nada con letra.', 70),
  H('fito', 'Fito', 'Navaja Suave', 'Hiker', 'chapa', 'Corta el pelo, cose dobladillos y endereza abolladuras. Dice que a todo el mundo le queda bien el gris acero. Miente con mucho cariño.', 130, LOOK_FITO),
  H('dora', 'Dora', 'Pulso Firme', 'Survivalist', 'galeria', 'Campeona de tiro del refugio. Afina la puntería con los bugs de producción.', 190),
]);

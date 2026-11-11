// Banco de voces reales (habla inventada, CC0; ver LICENSES/AUDIO.md): por hablante, su tono medio y cuántas sílabas,
// frases y exclamaciones hay en web/public/audio (voz_<id>_sNN, voz_<id>_fNN y los nombres de las exclamaciones).
export interface BenchSpeaker { id: string; f0: number; gender: 'm' | 'f' | 'n'; syllables: number; phrases: number; exclamations: string[] }
export const BANCO: BenchSpeaker[] = [
  { id: 'a', f0: 82, gender: 'm', syllables: 34, phrases: 14, exclamations: ['voz_a_e_hmm1', 'voz_a_e_hmm2', 'voz_a_e_hmm3', 'voz_a_e_oh1', 'voz_a_e_oh2', 'voz_a_e_eh1', 'voz_a_e_eh2', 'voz_a_e_risa1', 'voz_a_e_uf1'] },   // «Expressive Gibberish», dergraph
  { id: 'b', f0: 256, gender: 'f', syllables: 32, phrases: 13, exclamations: ['voz_b_e_risa1', 'voz_b_e_risa2', 'voz_b_e_risa3', 'voz_b_e_risa4', 'voz_b_e_oh1', 'voz_b_e_oh2', 'voz_b_e_oh3', 'voz_b_e_eh1', 'voz_b_e_eh2', 'voz_b_e_eh3', 'voz_b_e_uf1', 'voz_b_e_uf2', 'voz_b_e_uf3'] },   // «baby talk- babble1–6, strained gibberish, censored cursing, blablabla, blehblerbleh, trongwichoo», Reitanna
  { id: 'c', f0: 177, gender: 'f', syllables: 32, phrases: 13, exclamations: ['voz_c_e_hmm1', 'voz_c_e_hmm2', 'voz_c_e_hmm3', 'voz_c_e_risa1', 'voz_c_e_uf1'] },   // «Female Gibberish», cloyen
  { id: 'd', f0: 96, gender: 'm', syllables: 32, phrases: 14, exclamations: ['voz_d_e_oh1', 'voz_d_e_oh2', 'voz_d_e_oh3'] },   // «Mumbo Jumbo 9 Frenchlike», Sadiquecat
];

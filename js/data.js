// data.js — static game constants
export let SOUND_ENABLED = true;
export function setSoundEnabled(val) { SOUND_ENABLED = val; }

export const APLICACION_OPTIONS = [
  { id: 'brebaje',  label: 'Brebaje',  diffMod: 0 },
  { id: 'hemica',   label: 'Hémica',   diffMod: 1 },
  { id: 'corrosiva',label: 'Corrosiva',diffMod: 2 },
  { id: 'inhalable',label: 'Inhalable',diffMod: 3 },
  { id: 'fumigena', label: 'Fumígena', diffMod: 4 },
];

// ---- Modelo de pociones: tipo · campo · polaridad ----
export const TIPOS = ['Reactivo', 'Modificador'];
export const POLARIDADES = ['Beneficioso', 'Maleficioso'];

export const ALL_STATS = ['Fuerza', 'Destreza', 'Constitución', 'Inteligencia', 'Sabiduría', 'Carisma'];
export const ALL_CONDITIONS = [
  'Envenenado', 'Paralizado', 'Derribado', 'Apresado',
  'Aturdido', 'Cegado', 'Ensordecido', 'Incapacitado',
  'Asustado', 'Hechizado',
  'Petrificado', 'Inconsciente', 'Invisible',
];

// Campo = plano del ser sobre el que actúa la poción. Cada campo tiene su disolvente.
// Las características son las acordadas con el DM; los estados son una propuesta.
export const CAMPOS = {
  'Cuerpo': {
    stats: ['Fuerza', 'Constitución'],
    conditions: ['Envenenado', 'Paralizado', 'Derribado', 'Apresado'],
    icon: '💪',
  },
  'Mente': {
    stats: ['Inteligencia', 'Destreza'],
    conditions: ['Aturdido', 'Cegado', 'Ensordecido', 'Incapacitado'],
    icon: '🧠',
  },
  'Alma': {
    stats: ['Sabiduría', 'Carisma'],
    conditions: ['Asustado', 'Hechizado'],
    icon: '👻',
  },
  'Mágico': {
    stats: ALL_STATS,
    conditions: ALL_CONDITIONS,
    icon: '✨',
  },
};
export const CAMPO_NAMES = Object.keys(CAMPOS);

// Valores por defecto de los parámetros (editables en Info → Parámetros)
export const DEFAULT_SETTINGS = {
  disolventes: {
    'Cuerpo': { name: 'Agua',           difficulty: 0 },
    'Mente':  { name: 'Azogue',         difficulty: 1 },
    'Alma':   { name: 'Polvo mágico',   difficulty: 2 },
    'Mágico': { name: 'Esencia mágica', difficulty: 3 },
  },
  polaridadOpuestaDiff: 2,   // modificador de polaridad contraria a la del reactivo
  multiDisolventeDiff: 2,    // multipoción con disolventes distintos
};

// ---- Bloques de efecto ----
// pol: polaridad en la que aparece (null = ambas). campo: solo para ese campo.
// fields: dice (texto "2d6+1d4"), flat, statMod, damageType, stat, rollKind, value, condition, text, spellName, spellLevel
export const EFFECT_KINDS = {
  curacion:      { label: 'Curación',              icon: '❤️', pol: 'Beneficioso', fields: ['dice', 'flat', 'statMod'] },
  pgTemp:        { label: 'PG temporales',         icon: '💛', pol: 'Beneficioso', fields: ['dice', 'flat', 'statMod'] },
  bonificador:   { label: 'Bonificador',           icon: '⬆️', pol: 'Beneficioso', fields: ['stat', 'rollKind', 'value'] },
  ventaja:       { label: 'Ventaja',               icon: '🍀', pol: 'Beneficioso', fields: ['stat', 'rollKind'] },
  resistencia:   { label: 'Resistencia',           icon: '🛡️', pol: 'Beneficioso', fields: ['damageType'] },
  inmunidad:     { label: 'Inmunidad a estado',    icon: '🚫', pol: 'Beneficioso', fields: ['condition'] },
  dano:          { label: 'Daño',                  icon: '⚔️', pol: 'Maleficioso', fields: ['dice', 'flat', 'statMod', 'damageType'] },
  danoContinuo:  { label: 'Daño continuo (por turno)', icon: '🩸', pol: 'Maleficioso', fields: ['dice', 'flat', 'damageType'] },
  penalizacion:  { label: 'Penalización',          icon: '⬇️', pol: 'Maleficioso', fields: ['stat', 'rollKind', 'value'] },
  desventaja:    { label: 'Desventaja',            icon: '🎲', pol: 'Maleficioso', fields: ['stat', 'rollKind'] },
  estado:        { label: 'Estado',                icon: '⛓️', pol: 'Maleficioso', fields: ['condition'] },
  vulnerabilidad:{ label: 'Vulnerabilidad',        icon: '💔', pol: 'Maleficioso', fields: ['damageType'] },
  hechizo:       { label: 'Hechizo',               icon: '📜', pol: null, campo: 'Mágico', fields: ['spellName', 'spellLevel'] },
  especial:      { label: 'Efecto especial',       icon: '🌟', pol: null, fields: ['text', 'dice', 'flat'] },
};

// Bloques con dados: sobre ellos actúan Potenciador, Concentrador y Diluyente
export const DICE_EFFECTS = ['dano', 'curacion', 'pgTemp', 'danoContinuo', 'especial'];

export const ROLL_KINDS = ['Todas las tiradas', 'Pruebas', 'Salvaciones', 'Ataques'];

export function effectKindsFor(campo, polaridad) {
  return Object.entries(EFFECT_KINDS)
    .filter(([, k]) => (!k.pol || k.pol === polaridad) && (!k.campo || k.campo === campo))
    .map(([id, k]) => ({ id, ...k }));
}

// ---- Modificadores ----
export const MOD_KINDS = {
  'Potenciador':  'Suma dados o bonificador al efecto principal.',
  'Prolongador':  'Suma duración.',
  'Economizador': 'Baja la CD (dificultad negativa).',
  'Concentrador': 'Reduce la duración para potenciar el efecto.',
  'Diluyente':    'Alarga la duración a costa de potencia.',
  'Multiplicador':'Multiplica los dados o el total del efecto, y puede cambiar la duración.',
  'Alterador':    'Cambia el tipo de daño y/o añade un efecto secundario.',
  'Añadir efecto':'Añade uno o más bloques de efecto a la poción.',
  'Esencial':     'Solo pociones mágicas: define la duración y la descripción del efecto mágico.',
  'Invertidor':   'Solo pociones mágicas: invierte el efecto (se describe al elaborar).',
  'Otro':         'Sin regla automática; descríbelo en las notas.',
};
// Modificadores que aceptan las pociones mágicas, y los que solo valen para ellas
export const MAGIC_MOD_KINDS = ['Prolongador', 'Esencial', 'Invertidor', 'Alterador'];
export const MAGIC_ONLY_MOD_KINDS = ['Esencial', 'Invertidor'];
export const DIE_TIERS = [4, 6, 8, 10, 12, 20];
export const MOD_KIND_ICONS = {
  'Potenciador': '⚡', 'Prolongador': '⏳', 'Economizador': '💰',
  'Concentrador': '🔻', 'Diluyente': '💧', 'Añadir efecto': '➕', 'Otro': '⚗️',
  'Multiplicador': '✖️', 'Alterador': '🔄', 'Esencial': '💠', 'Invertidor': '🔃',
};

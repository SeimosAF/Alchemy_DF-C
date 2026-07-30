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

export const SUBTIPOS = {
  'Salutífera_Base':  ['Vitalidad', 'Resistencia', 'Otro'],
  'Maliciosa_Base':   ['Dañina', 'Incapacitante', 'Debilitante'],
  'Mágica_Base':      [],
  '_Modificador':     ['Economizador', 'Prolongador', 'Potenciador', 'Otro'],
};

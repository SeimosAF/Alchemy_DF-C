// state.js — persistent app state
import { DEFAULT_SETTINGS } from './data.js';
import { migrateState, MODEL_VERSION } from './model.js';

export const STORAGE_KEY = 'alquimiaAppData_v2';
const BACKUP_KEY = 'alquimiaAppData_v2_backup_modeloAntiguo';

export function getDefaultState() {
  return {
    version: MODEL_VERSION,
    character: { name: '', intMod: 0, bonus: 0 },
    catalog: {},
    inventory: {},
    potions: {},
    potionCatalog: {},
    lootPotions: {},
    damageTypes: ['Fuego','Frío','Rayo','Ácido','Veneno','Necrótico','Radiante','Psíquico','Trueno'],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  };
}

export let state = getDefaultState();

// Fills missing fields and converts data saved with the old model
// (Salutífera / Maliciosa / Mágica) to the new one (campo + polaridad + efectos).
export function normalizeState(s) {
  const def = getDefaultState();
  if (!s.damageTypes)   s.damageTypes   = def.damageTypes;
  if (!s.lootPotions)   s.lootPotions   = {};
  if (!s.potionCatalog) s.potionCatalog = {};
  if (!s.catalog)       s.catalog       = {};
  if (!s.inventory)     s.inventory     = {};
  if (!s.potions)       s.potions       = {};
  if (!s.character)     s.character     = def.character;
  if (!s.settings)      s.settings      = def.settings;
  if (!s.settings.disolventes) s.settings.disolventes = def.settings.disolventes;
  for (const c in def.settings.disolventes)
    if (!s.settings.disolventes[c]) s.settings.disolventes[c] = def.settings.disolventes[c];
  if (s.settings.polaridadOpuestaDiff == null) s.settings.polaridadOpuestaDiff = def.settings.polaridadOpuestaDiff;
  if (s.settings.multiDisolventeDiff  == null) s.settings.multiDisolventeDiff  = def.settings.multiDisolventeDiff;
  return migrateState(s);
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if ((parsed.version || 0) < MODEL_VERSION && !localStorage.getItem(BACKUP_KEY)) {
        try { localStorage.setItem(BACKUP_KEY, raw); } catch (_) {}
      }
      state = normalizeState(parsed);
      saveState();
    } else {
      state = getDefaultState();
    }
  } catch (e) {
    console.error('Error cargando datos', e);
    state = getDefaultState();
  }
}

// setState lets other modules replace the whole state object (import/reset).
export function setState(newState) {
  state = newState;
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

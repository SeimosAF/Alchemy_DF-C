// state.js — persistent app state
export const STORAGE_KEY = 'alquimiaAppData_v2';

export function getDefaultState() {
  return {
    character: { name: '', intMod: 0, bonus: 0 },
    catalog: {},
    inventory: {},
    potions: {},
    potionCatalog: {},
    lootPotions: {},
    damageTypes: ['Fuego','Frío','Rayo','Ácido','Veneno','Necrótico','Radiante','Psíquico','Trueno'],
  };
}

export let state = getDefaultState();

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      if (!state.damageTypes)   state.damageTypes   = getDefaultState().damageTypes;
      if (!state.lootPotions)   state.lootPotions   = {};
      if (!state.potionCatalog) state.potionCatalog = {};
    } else {
      state = getDefaultState();
    }
  } catch (e) {
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

// state.js — persistent app state
import { DEFAULT_SETTINGS } from './data.js';
import { migrateState, MODEL_VERSION } from './model.js';
import * as sync from './sync.js';
import * as auth from './auth.js';

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
    libros: {},          // libros del inventario (módulo Lectura)
    objetos: {},         // inventario general: armas, armaduras, objetos mágicos... (js/objetos.js)
    perfil: {},          // lo que fija el DM: perfil.alquimia.nivel (módulo Alquimia)
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
  if (!s.libros)        s.libros        = {};
  if (!s.objetos)       s.objetos       = {};
  if (!s.perfil)        s.perfil        = {};
  if (!s.character)     s.character     = def.character;
  if (!s.settings)      s.settings      = def.settings;
  if (!s.settings.disolventes) s.settings.disolventes = def.settings.disolventes;
  // El disolvente de Alma se llama Polvo etéreo (antes "Polvo mágico")
  if (s.settings.disolventes.Alma?.name === 'Polvo mágico') s.settings.disolventes.Alma.name = 'Polvo etéreo';
  for (const c in def.settings.disolventes)
    if (!s.settings.disolventes[c]) s.settings.disolventes[c] = def.settings.disolventes[c];
  if (s.settings.polaridadOpuestaDiff == null) s.settings.polaridadOpuestaDiff = def.settings.polaridadOpuestaDiff;
  if (s.settings.multiDisolventeDiff  == null) s.settings.multiDisolventeDiff  = def.settings.multiDisolventeDiff;
  return migrateState(s);
}

const CHARACTER_KEY = 'alquimiaPersonaje';   // en modo servidor el personaje es de cada cuenta y campaña (en este navegador)
const characterKeyCuenta = () => CHARACTER_KEY + (auth.usuario ? ':' + auth.usuario.clave : '');   // de antes de las campañas
const characterKey = () => characterKeyCuenta() + (auth.mesa ? '@' + auth.mesa.id : '');

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if ((parsed.version || 0) < MODEL_VERSION && !localStorage.getItem(BACKUP_KEY)) {
      try { localStorage.setItem(BACKUP_KEY, raw); } catch (_) {}
    }
    return normalizeState(parsed);
  } catch (e) {
    console.error('Error cargando datos', e);
    return null;
  }
}

function localCharacter(fallback) {
  try {
    const c = JSON.parse(localStorage.getItem(characterKey()) || 'null');
    if (c) return c;
    // El personaje de antes de las campañas es el de la primera campaña
    if (auth.mesa?.id === 'primera') {
      const deCuenta = JSON.parse(localStorage.getItem(characterKeyCuenta()) || 'null');
      if (deCuenta) return deCuenta;
    }
    // Primera vez con cuentas: el personaje que tuviera este navegador pasa a la primera cuenta que entre
    const viejo = JSON.parse(localStorage.getItem(CHARACTER_KEY) || 'null');
    if (viejo && auth.usuario) { localStorage.removeItem(CHARACTER_KEY); return viejo; }
  } catch (_) {}
  const def = fallback ? { ...fallback } : getDefaultState().character;
  if (auth.usuario && (!def.name || def.name === 'Mi personaje')) def.name = auth.usuario.nombre;
  return def;
}

// Si hay servidor (servidor.py), los datos viven allí y se comparten.
// Si no, todo sigue como antes: se guardan en este navegador.
export async function loadState() {
  const local = readLocal();
  const conn = await sync.conectar();
  if (!conn) {
    state = local || getDefaultState();
    if (local) saveState();
    sync.pintarEstado();
    return;
  }
  const character = localCharacter(local?.character);
  const datos = conn.datos;
  sync.fijarBase(datos);
  if (sync.servidorVacio(datos) && local && !sync.servidorVacio(sync.aServidor(local)) &&
      confirm(`La campaña «${auth.mesa?.nombre || ''}» está vacía y este navegador tiene datos guardados (de cuando se usaba sin servidor).\n\n¿Subirlos a esta campaña para que los vea toda su mesa?`)) {
    state = local;
    state.character = character;
    sync.guardar(state, [{ t: 'vacio', c: 'meta', id: '-' }]);
  } else {
    state = normalizeState(sync.desdeServidor(datos, character));
    guardarMigracion();
  }
  saveCharacter();
  sync.empezarSondeo();
}

// Sustituye el estado por lo que diga el servidor (cambios de otros o tras un rechazo)
export function applyServerData(datos) {
  state = normalizeState(sync.desdeServidor(datos, state.character));
  guardarMigracion();
}

// Si al cargar se ha puesto al día el formato de los datos, el DM lo guarda en el servidor.
// Un jugador no puede tocar lo común (catálogo, parámetros): se queda como "ya visto" y no se envía.
function guardarMigracion() {
  if (auth.esDM()) sync.guardar(state);
  else sync.fijarBase(sync.aServidor(state));
}

function saveCharacter() {
  try { localStorage.setItem(characterKey(), JSON.stringify(state.character)); } catch (_) {}
}

// setState lets other modules replace the whole state object (import/reset).
export function setState(newState) {
  state = newState;
}

export function saveState() {
  if (sync.modo === 'servidor') {
    saveCharacter();
    sync.guardar(state);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

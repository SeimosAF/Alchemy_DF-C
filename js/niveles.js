// niveles.js — la alquimia se aprende por niveles (los sube el DM).
//
// Cada nivel desbloquea disolventes, polaridades de reactivo, clases de
// modificador, modos de crafteo y métodos de aplicación, y CONSERVA todo lo de
// los niveles anteriores. El último nivel lo desbloquea todo.
//
// Para cambiar el reparto basta con tocar la tabla NIVELES (y, si quieres, el
// texto del diario de Jhon Arbaquel en diario.js). El resto de la app pregunta
// siempre a las funciones de aquí abajo (disolventeOk, reactivoOk...).
//
// El nivel se guarda por jugador en state.perfil.alquimia.nivel. En el servidor
// solo el DM puede cambiarlo. Sin servidor (modo local) no hay DM: empieza en el
// máximo y lo puede cambiar quien use la app.
import { nombreMat } from './utils.js';
import { state, saveState } from './state.js';
import * as auth from './auth.js';
import { setFiltroNivel } from './model.js';

const TODAS = ['Beneficioso', 'Neutro', 'Maleficioso'];

export const NIVELES = [
  { nivel: 1, titulo: 'Aprendiz del agua',
    disolventes: ['Cuerpo'], polaridades: { Cuerpo: ['Beneficioso'] },
    modificadores: [], modos: ['elaboracion'], aplicaciones: ['brebaje'] },
  { nivel: 2, titulo: 'Oficial del caldero',
    polaridades: { Cuerpo: ['Neutro', 'Maleficioso'] },
    modificadores: ['Potenciador', 'Prolongador', 'Economizador'], aplicaciones: ['hemica', 'corrosiva'] },
  { nivel: 3, titulo: 'Destilador de azogue',
    disolventes: ['Mente'], polaridades: { Mente: TODAS },
    modificadores: ['Concentrador', 'Diluyente', 'Añadir efecto'], modos: ['concentracion'], aplicaciones: ['inhalable'] },
  { nivel: 4, titulo: 'Tejedor de lo etéreo',
    disolventes: ['Alma'], polaridades: { Alma: TODAS },
    modificadores: ['Multiplicador', 'Alterador', 'Otro'], modos: ['multipocion'], aplicaciones: ['fumigena'] },
  { nivel: 5, titulo: 'Maestro alquimista',
    disolventes: ['Mágico'], polaridades: { 'Mágico': TODAS },
    modificadores: ['Esencial', 'Invertidor'], todo: true },
];
export const NIVEL_MAX = NIVELES.length;

// Nombres para los textos
export const NOMBRE_MODO = { elaboracion: 'Elaboración', concentracion: 'Concentración', multipocion: 'Multipoción' };
export const NOMBRE_APLIC = { brebaje: 'Brebaje', hemica: 'Hémica', corrosiva: 'Corrosiva', inhalable: 'Inhalable', fumigena: 'Fumígena' };
const POL_PLURAL = { Beneficioso: 'beneficiosos', Neutro: 'neutros', Maleficioso: 'maleficiosos' };

const limitar = n => Math.min(NIVEL_MAX, Math.max(1, parseInt(n) || 1));

// Nivel de un perfil cualquiera (el propio o el de otro jugador, para el DM)
export function nivelDePerfil(perfil, local = !auth.servidor) {
  const n = perfil?.alquimia?.nivel;
  return n == null ? (local ? NIVEL_MAX : 1) : limitar(n);
}
export const nivelActual = () => nivelDePerfil(state.perfil);
export const tituloNivel = n => NIVELES[limitar(n) - 1].titulo;

// ¿Puede cambiar su propio nivel? (el DM, o cualquiera sin servidor)
export const puedeCambiarPropio = () => !auth.servidor || auth.esDM();

// Todo lo desbloqueado hasta el nivel n (acumulado)
function desbloqueado(n = nivelActual()) {
  const d = { disolventes: new Set(), polaridades: {}, modificadores: new Set(), modos: new Set(), aplicaciones: new Set(), todo: false };
  for (const niv of NIVELES.slice(0, limitar(n))) {
    (niv.disolventes || []).forEach(x => d.disolventes.add(x));
    for (const c in niv.polaridades || {}) {
      d.polaridades[c] = d.polaridades[c] || new Set();
      niv.polaridades[c].forEach(p => d.polaridades[c].add(p));
    }
    (niv.modificadores || []).forEach(x => d.modificadores.add(x));
    (niv.modos || []).forEach(x => d.modos.add(x));
    (niv.aplicaciones || []).forEach(x => d.aplicaciones.add(x));
    if (niv.todo) d.todo = true;
  }
  return d;
}

// En qué nivel se desbloquea algo (para poner "🔒 Nivel 3")
function nivelQueAbre(prueba) {
  for (const niv of NIVELES) if (prueba(niv)) return niv.nivel;
  return NIVEL_MAX;
}
export const nivelDisolvente = campo => nivelQueAbre(n => (n.disolventes || []).includes(campo));
export const nivelReactivo = m => nivelQueAbre(n => (n.polaridades?.[m.campo] || []).includes(m.polaridad || 'Neutro'));
export const nivelMod = m => nivelQueAbre(n => (n.modificadores || []).includes(m.modKind || 'Otro'));
export const nivelModo = modo => modo === 'elaboracion' ? 1 : nivelQueAbre(n => (n.modos || []).includes(modo));
export const nivelAplic = id => nivelQueAbre(n => (n.aplicaciones || []).includes(id));

// ---- Preguntas que hace el resto de la app ----
export function disolventeOk(campo) { const d = desbloqueado(); return d.todo || d.disolventes.has(campo); }
export function reactivoOk(m) {
  if (!m) return false;
  const d = desbloqueado();
  return d.todo || (d.disolventes.has(m.campo) && !!d.polaridades[m.campo]?.has(m.polaridad || 'Neutro'));
}
export function modOk(m) { const d = desbloqueado(); return d.todo || d.modificadores.has(m?.modKind || 'Otro'); }
export function modoOk(modo) { const d = desbloqueado(); return d.todo || modo === 'elaboracion' || d.modos.has(modo); }
export function aplicOk(id) { const d = desbloqueado(); return d.todo || d.aplicaciones.has(id); }

// Las reglas de compatibilidad de modificadores (model.js) también miran el nivel
setFiltroNivel(mod => modOk(mod) ? null : `se aprende en el nivel ${nivelMod(mod)} de alquimia`);

// Última comprobación antes de gastar materiales. Devuelve el problema o null.
export function problemaCrafteo(modo, base, mods, aplics, catalog) {
  if (!modoOk(modo)) return `La ${NOMBRE_MODO[modo]} se aprende en el nivel ${nivelModo(modo)} de alquimia.`;
  if (modo === 'elaboracion' && base) {
    if (!disolventeOk(base.campo)) return `Todavía no sabes trabajar ese disolvente (nivel ${nivelDisolvente(base.campo)}).`;
    if (!reactivoOk(base)) return `Ese reactivo se aprende en el nivel ${nivelReactivo(base)} de alquimia.`;
    for (const mid in mods || {}) {
      const m = catalog[mid];
      if (mods[mid] > 0 && m && !modOk(m)) return `«${nombreMat(m)}» se aprende en el nivel ${nivelMod(m)} de alquimia.`;
    }
  }
  for (const a of aplics || []) if (!aplicOk(a)) return `La aplicación ${NOMBRE_APLIC[a] || a} se aprende en el nivel ${nivelAplic(a)}.`;
  return null;
}

// Lo que trae un nivel, en frases (para el diario y el aviso de subida)
export function novedades(n, nombreDisolvente) {
  const niv = NIVELES[limitar(n) - 1];
  const out = [];
  for (const c of niv.disolventes || []) out.push(`Disolvente: <b>${nombreDisolvente(c)}</b> (campo ${c})`);
  for (const c in niv.polaridades || {})
    out.push(`Reactivos de <b>${c}</b>: ${niv.polaridades[c].map(p => POL_PLURAL[p]).join(', ')}`);
  if ((niv.modificadores || []).length) out.push(`Modificadores: <b>${niv.modificadores.join(', ')}</b>`);
  for (const m of niv.modos || []) out.push(`Modo de crafteo: <b>${NOMBRE_MODO[m]}</b>`);
  if ((niv.aplicaciones || []).length) out.push(`Aplicación: <b>${niv.aplicaciones.map(a => NOMBRE_APLIC[a]).join(', ')}</b>`);
  if (niv.todo) out.push('<b>Toda la alquimia queda desbloqueada</b>, también lo que se añada en el futuro');
  return out;
}

// Cambiar el propio nivel (DM o modo local). Para otro jugador, ver dm.js.
export function fijarPropio(n) {
  if (!puedeCambiarPropio()) return false;
  state.perfil = state.perfil || {};
  state.perfil.alquimia = { ...(state.perfil.alquimia || {}), nivel: limitar(n) };
  saveState();
  return true;
}

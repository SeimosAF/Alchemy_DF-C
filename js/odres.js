// odres.js — odres para los disolventes que no son agua (V3.8).
//
// El agua (disolvente de Cuerpo) no hace falta llevarla. El azogue (Mente), el polvo etéreo (Alma)
// y la esencia mágica (Mágico) van en odres, cada uno con su capacidad en litros.
// Cada poción que se elabora gasta 0,5 L de su disolvente (también si sale mal: ya se ha echado al caldero).
// Cada jugador empieza con un odre vacío de 3 L; el DM los rellena con los litros que quiera, les cambia la
// capacidad y da más desde «Inventarios de la mesa».
//
// Un odre: { name, capacidad (L), litros (L), disolvente: 'Mente' | 'Alma' | 'Mágico' | null, creado }
// Se guarda por jugador en la colección «odres» del servidor (o en este navegador sin servidor).
import { state, saveState, genId } from './state.js';
import { CAMPOS } from './data.js';
import { getDisolvente } from './model.js';
import * as auth from './auth.js';
import * as sync from './sync.js';

export const LITROS_POCION = 0.5;
export const CAPACIDAD_INICIAL = 3;
export const CAMPOS_ODRE = ['Mente', 'Alma', 'Mágico'];
export const usaOdre = campo => CAMPOS_ODRE.includes(campo);

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const litros = x => `${String(Math.round((x || 0) * 2) / 2).replace('.', ',')} L`;
export const nombreDisolvente = campo => campo ? getDisolvente(state.settings, campo).name : 'vacío';
// Sin servidor no hay DM aparte: quien usa la app llena sus odres
const puedeLlenar = () => sync.modo !== 'servidor';

// Lee un número de litros de una casilla (acepta coma), redondeado a medio litro
const leerLitros = el => Math.round(parseFloat(String(el?.value ?? '').replace(',', '.')) * 2) / 2;
const casillas = (pref, id, o) => `
        <label class="odre-campo">Dentro <input type="number" class="dm-num" data-${pref}-l="${esc(id)}" min="0" max="100" step="0.5" value="${o.litros || 0}"> L</label>
        <label class="odre-campo">Capacidad <input type="number" class="dm-num" data-${pref}-c="${esc(id)}" min="0.5" max="100" step="0.5" value="${o.capacidad}"> L</label>`;

export function lista(odres = state.odres) {
  return Object.entries(odres || {}).sort(([, a], [, b]) =>
    (CAMPOS_ODRE.indexOf(a.disolvente) + 9 * !a.disolvente) - (CAMPOS_ODRE.indexOf(b.disolvente) + 9 * !b.disolvente)
    || String(a.name).localeCompare(String(b.name), 'es'));
}

// Litros que llevas de un disolvente (sumando todos tus odres)
export function litrosDe(campo, odres = state.odres) {
  return Object.values(odres || {}).filter(o => o.disolvente === campo).reduce((t, o) => t + (o.litros || 0), 0);
}
export const pocionesQueDa = campo => Math.floor(litrosDe(campo) / LITROS_POCION + 1e-9);

// ¿Se puede echar este disolvente al caldero? (null = sí; si no, por qué)
export function problema(campo) {
  if (!usaOdre(campo)) return null;
  if (litrosDe(campo) + 1e-9 >= LITROS_POCION) return null;
  return `No te queda ${nombreDisolvente(campo).toLowerCase()} en los odres (cada poción gasta ${litros(LITROS_POCION)}).`
    + (puedeLlenar() ? ' Llena un odre en Alquimia → Odres.' : ' Pídele al DM que te llene un odre.');
}

// Gasta 0,5 L del odre que menos tenga (así se vacían primero los empezados). Devuelve el id o null.
export function gastar(campo) {
  if (!usaOdre(campo)) return null;
  const cand = Object.entries(state.odres || {}).filter(([, o]) => o.disolvente === campo && (o.litros || 0) + 1e-9 >= LITROS_POCION)
    .sort(([, a], [, b]) => a.litros - b.litros);
  if (!cand.length) return null;
  const [id, o] = cand[0];
  const queda = Math.round((o.litros - LITROS_POCION) * 2) / 2;
  state.odres[id] = { ...o, litros: queda, disolvente: queda > 0 ? o.disolvente : null };   // vacío: sirve para cualquier disolvente
  return id;
}

// Barra de un odre
export function barra(o) {
  const pct = Math.max(0, Math.min(100, ((o.litros || 0) / (o.capacidad || 1)) * 100));
  return `<span class="odre-barra odre-${o.disolvente ? 'c-' + ({ Mente: 'mente', Alma: 'alma', 'Mágico': 'magico' }[o.disolvente]) : 'vacio'}" title="${litros(o.litros)} de ${litros(o.capacidad)}">
    <span class="odre-nivel" style="width:${pct}%"></span></span>`;
}

export function textoOdre(o) {
  return o.disolvente && o.litros > 0
    ? `${CAMPOS[o.disolvente]?.icon || ''} ${esc(nombreDisolvente(o.disolvente))} · ${litros(o.litros)} de ${litros(o.capacidad)}`
    : `Vacío · caben ${litros(o.capacidad)}`;
}

// ---- Alquimia → Odres ----
export function render() {
  const el = document.getElementById('alqOdres');
  if (!el) return;
  const odres = lista();
  const resumen = CAMPOS_ODRE.map(c => {
    const l = litrosDe(c), n = pocionesQueDa(c);
    return `<div class="odre-resumen odre-c-${({ Mente: 'mente', Alma: 'alma', 'Mágico': 'magico' }[c])}">
      <span class="odre-resumen-icono">${CAMPOS[c].icon}</span>
      <span><b>${esc(nombreDisolvente(c))}</b><br><span class="muted">${litros(l)} · ${n} poci${n === 1 ? 'ón' : 'ones'}</span></span></div>`;
  }).join('');
  const filas = odres.map(([id, o]) => `<div class="odre-fila">
      <span class="odre-icono" aria-hidden="true">🫙</span>
      <div class="odre-info">
        <div class="odre-nombre">${esc(o.name)} <span class="muted">· ${litros(o.capacidad)}</span></div>
        ${barra(o)}
        <div class="muted odre-txt">${textoOdre(o)}</div>
      </div>
      ${puedeLlenar() ? `<div class="odre-acciones">
        <select data-odre-disolvente="${esc(id)}" aria-label="Disolvente">${CAMPOS_ODRE.map(c =>
          `<option value="${c}" ${(o.disolvente || 'Mente') === c ? 'selected' : ''}>${esc(nombreDisolvente(c))}</option>`).join('')}</select>
        ${casillas('odre', id, o)}
        <button class="btn btn-sm" data-odre="guardar" data-id="${esc(id)}" title="Guardar disolvente, litros y capacidad">💾</button>
        <button class="btn btn-sm" data-odre="llenar" data-id="${esc(id)}" title="Llenarlo hasta arriba">💧 Llenar</button>
        <button class="btn btn-sm" style="background:#777" data-odre="vaciar" data-id="${esc(id)}" ${o.litros > 0 ? '' : 'disabled'}>Vaciar</button>
        <button class="btn btn-sm btn-danger" data-odre="tirar" data-id="${esc(id)}" title="Tirar el odre">🗑️</button>
      </div>` : ''}
    </div>`).join('') || '<p class="muted">No llevas ningún odre.' + (puedeLlenar() ? '' : ' Pídele uno al DM.') + '</p>';
  el.innerHTML = `
    <p class="muted">El <b>agua</b> no hace falta llevarla. Los demás disolventes van en odres: cada poción gasta
      <b>${litros(LITROS_POCION)}</b> de su disolvente (también si sale mal). ${puedeLlenar() ? '' : 'Los odres los llena el DM.'}</p>
    <div class="odre-resumenes">${resumen}</div>
    <div class="odre-lista">${filas}</div>
    ${puedeLlenar() ? `<div class="btn-row"><button class="btn btn-sm" data-odre="nuevo">➕ Nuevo odre</button></div>` : ''}`;
}

export function init() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-odre]');
    if (!b || b.disabled || !puedeLlenar()) return;
    const id = b.dataset.id, o = state.odres?.[id];
    const accion = b.dataset.odre;
    if (accion === 'nuevo') {
      const t = prompt('Capacidad del odre nuevo, en litros:', String(CAPACIDAD_INICIAL));
      const cap = Math.round(parseFloat(String(t || '').replace(',', '.')) * 2) / 2;
      if (!(cap >= 0.5 && cap <= 100)) return;
      state.odres[genId()] = { name: 'Odre', capacidad: cap, litros: 0, disolvente: null, creado: new Date().toISOString() };
    } else if (!o) return;
    else if (accion === 'guardar') {
      const v = leerOdre(document, 'odre', id, o);
      if (!v) return;
      state.odres[id] = v;
    }
    else if (accion === 'llenar') {
      const d = document.querySelector(`[data-odre-disolvente="${CSS.escape(id)}"]`)?.value || 'Mente';
      if (o.litros > 0 && o.disolvente && o.disolvente !== d && !confirm(`Ese odre lleva ${nombreDisolvente(o.disolvente).toLowerCase()}. ¿Tirarlo y llenarlo de ${nombreDisolvente(d).toLowerCase()}?`)) return;
      state.odres[id] = { ...o, disolvente: d, litros: o.capacidad };
    } else if (accion === 'vaciar') state.odres[id] = { ...o, litros: 0, disolvente: null };
    else if (accion === 'tirar') {
      if (!confirm(`¿Tirar este odre${o.litros > 0 ? ' con ' + litros(o.litros) + ' dentro' : ''}?`)) return;
      delete state.odres[id];
    }
    saveState();
    render();
    alCambiar?.();
  });
}
// Lee disolvente, litros y capacidad de la fila de un odre. Devuelve el odre nuevo o null.
function leerOdre(raiz, pref, id, o, llenar = false) {
  const q = s => raiz.querySelector(`[data-${pref}-${s}="${CSS.escape(id)}"]`);
  const d = q('d')?.value || q('disolvente')?.value || 'Mente';
  const cap = leerLitros(q('c'));
  if (!(cap >= 0.5 && cap <= 100)) { alert('La capacidad va de 0,5 a 100 litros.'); return null; }
  let l = llenar ? cap : leerLitros(q('l'));
  if (!(l >= 0)) l = 0;
  if (l > cap) {
    if (!confirm(`Caben ${litros(cap)}. ¿Dejarlo lleno con ${litros(cap)}?`)) return null;
    l = cap;
  }
  return { ...o, capacidad: cap, litros: l, disolvente: l > 0 ? d : null };
}

let alCambiar = null;
export function setAlCambiar(fn) { alCambiar = fn; }

// ---- Para el panel del DM: los odres de un jugador ----
export function htmlDM(j) {
  const filas = lista(j.odres).map(([id, o]) => `<div class="odre-fila odre-fila-dm">
      <span class="odre-icono" aria-hidden="true">🫙</span>
      <div class="odre-info">
        <div class="odre-nombre">${esc(o.name)} <span class="muted">· ${litros(o.capacidad)}</span></div>
        ${barra(o)}
        <div class="muted odre-txt">${textoOdre(o)}</div>
      </div>
      <div class="odre-acciones">
        <select data-dm-odre-d="${esc(id)}" aria-label="Disolvente">${CAMPOS_ODRE.map(c =>
          `<option value="${c}" ${(o.disolvente || 'Mente') === c ? 'selected' : ''}>${esc(nombreDisolvente(c))}</option>`).join('')}</select>
        ${casillas('dm-odre', id, o)}
        <button class="btn btn-sm" data-dm="odre-poner" data-id="${esc(id)}" title="Guardar disolvente, litros y capacidad">💾</button>
        <button class="btn btn-sm" data-dm="odre-llenar" data-id="${esc(id)}" title="Llenarlo hasta arriba">💧 Llenar</button>
        <button class="btn btn-sm btn-danger" data-dm="odre-quitar" data-id="${esc(id)}" title="Quitar el odre">🗑️</button>
      </div>
    </div>`).join('') || '<p class="muted">No lleva odres.</p>';
  return `<div class="dm-odres">
      <h3>🫙 Odres <span class="muted">· ${CAMPOS_ODRE.map(c => `${CAMPOS[c].icon} ${litros(litrosDe(c, j.odres))}`).join(' · ')}</span></h3>
      <p class="muted dm-nota">Cada poción de azogue, polvo etéreo o esencia mágica gasta ${litros(LITROS_POCION)}. El agua no se lleva.</p>
      ${filas}
      <div class="dm-dar">
        <input type="number" id="dmOdreCap" class="dm-num" min="0.5" max="100" step="0.5" value="${CAPACIDAD_INICIAL}" title="Capacidad en litros"> L
        <button class="btn btn-sm" data-dm="odre-dar">🎁 Dar un odre vacío</button>
      </div>
    </div>`;
}

// Ops del DM sobre los odres de un jugador. Devuelve [ops, resumen] o null.
export function opsDM(accion, id, j, panel) {
  const u = j.clave, o = j.odres?.[id];
  const para = ` (para ${j.nombre})`;
  if (accion === 'odre-dar') {
    const cap = Math.round(parseFloat(String(panel.querySelector('#dmOdreCap')?.value || '').replace(',', '.')) * 2) / 2;
    if (!(cap >= 0.5 && cap <= 100)) { alert('La capacidad va de 0,5 a 100 litros.'); return null; }
    return [[{ t: 'obj', c: 'odres', id: genId(), e: null, u,
      v: { name: 'Odre', capacidad: cap, litros: 0, disolvente: null, creado: new Date().toISOString() } }], `+ odre de ${litros(cap)}${para}`];
  }
  if (!o) return null;
  if (accion === 'odre-quitar') {
    if (!confirm(`¿Quitarle a ${j.nombre} este odre${o.litros > 0 ? ' con ' + litros(o.litros) : ''}?`)) return null;
    return [[{ t: 'obj', c: 'odres', id, e: o, v: null, u }], `quitó un odre${para}`];
  }
  const v = leerOdre(panel, 'dm-odre', id, o, accion === 'odre-llenar');
  if (!v) return null;
  return [[{ t: 'obj', c: 'odres', id, e: o, v, u }],
    `odre de ${litros(v.capacidad)}: ${v.litros > 0 ? litros(v.litros) + ' de ' + nombreDisolvente(v.disolvente).toLowerCase() : 'vacío'}${para}`];
}

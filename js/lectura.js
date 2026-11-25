// lectura.js — módulo de Lectura: libros del inventario y su progreso.
//
// Un libro tiene un número de lecturas (casillas). En cada descanso, corto o
// largo, se avanza una casilla. Algunas casillas piden SÍ O SÍ un descanso largo
// y una tirada de comprensión: d20 + mod. INT (+ bono extra) contra una CD que
// fija el DM. Si falla, no se avanza y se puede volver a intentar en el siguiente
// descanso largo. Al terminar el libro se obtiene su bono (texto libre).
//
// Datos (por jugador, colección "libros" del servidor):
//   { name, descripcion, bono, lecturas, progreso, pruebas: { "4": { cd: 14 } }, historial: [...] }
// El servidor solo deja al DM cambiar "pruebas" (qué casillas piden tirada y su CD).
import { state, saveState, genId } from './state.js';
import * as auth from './auth.js';
import { roll20 } from './utils.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const conSigno = n => (n >= 0 ? '+' : '') + n;
const MAX_LECTURAS = 100;

// El DM (o cualquiera sin servidor) fija las casillas con tirada y su dificultad
export const puedeFijarCD = () => !auth.servidor || auth.esDM();

// ---- Casillas con tirada: texto "4:14, 8" <-> { "4": {cd:14}, "8": {cd:null} } ----
export function textoPruebas(pruebas) {
  return Object.keys(pruebas || {}).map(Number).sort((a, b) => a - b)
    .map(k => pruebas[k]?.cd != null ? `${k}:${pruebas[k].cd}` : String(k)).join(', ');
}
export function leerPruebas(texto, lecturas, conCD = true) {
  const out = {};
  for (const trozo of String(texto || '').split(/[,;\s]+/).filter(Boolean)) {
    const [c, d] = trozo.split(':');
    const k = parseInt(c);
    if (!(k >= 1 && k <= lecturas)) continue;
    const cd = conCD && d !== undefined && d !== '' && !isNaN(parseInt(d)) ? parseInt(d) : null;
    out[String(k)] = { cd };
  }
  return out;
}

export function estadoLibro(l) {
  const total = Math.max(1, parseInt(l.lecturas) || 1);
  const hecho = Math.min(total, l.progreso || 0);
  const siguiente = hecho < total ? hecho + 1 : null;
  const prueba = siguiente ? l.pruebas?.[String(siguiente)] || null : null;
  return { total, hecho, siguiente, prueba, terminado: hecho >= total };
}

// Casillas del libro como una fila de marcas
export function htmlCasillas(l, verCD = puedeFijarCD()) {
  const { total, hecho, siguiente } = estadoLibro(l);
  let html = '';
  for (let i = 1; i <= total; i++) {
    const p = l.pruebas?.[String(i)];
    const cls = i <= hecho ? 'leida' : i === siguiente ? 'siguiente' : '';
    const tit = `Lectura ${i}${p ? ' · descanso largo + tirada de comprensión' + (verCD ? (p.cd != null ? ` (CD ${p.cd})` : ' (CD sin fijar)') : '') : ''}`;
    html += `<span class="lec-casilla ${cls} ${p ? 'prueba' : ''}" title="${tit}">${i <= hecho ? '✓' : p ? '🌙' : i}
      ${p && verCD ? `<small>${p.cd != null ? p.cd : '?'}</small>` : ''}</span>`;
  }
  return `<div class="lec-casillas">${html}</div>`;
}

// ---- Pestaña Lectura ----
let tirando = null;   // id del libro cuya tirada está abierta

export function render() {
  const el = document.getElementById('lecturaLista');
  if (!el) return;
  const libros = Object.entries(state.libros || {}).sort(([, a], [, b]) =>
    (estadoLibro(a).terminado - estadoLibro(b).terminado) || String(a.name).localeCompare(String(b.name)));
  const intMod = parseInt(state.character?.intMod) || 0;
  document.getElementById('lecturaIntMod').textContent = conSigno(intMod);
  if (!libros.length) {
    el.innerHTML = `<div class="lec-vacio">
      <div class="lec-vacio-icono">📚</div>
      <p>No llevas ningún libro encima.</p>
      <p class="muted">Dalos de alta en <a href="#" data-action="ir-libros">Inventario → Libros</a>${auth.servidor ? ' o pídeselos al DM' : ''}.</p>
    </div>`;
    return;
  }
  el.innerHTML = libros.map(([id, l]) => {
    const e = estadoLibro(l);
    const sinCD = e.prueba && e.prueba.cd == null;
    let acciones;
    if (e.terminado) {
      acciones = `<div class="lec-bono-ganado">✨ <b>Libro terminado.</b> ${l.bono ? 'Has obtenido: <span class="lec-bono-txt">' + esc(l.bono) + '</span>' : ''}</div>`;
    } else if (tirando === id && e.prueba) {
      acciones = `<div class="lec-tirada">
        <div class="lec-tirada-tit">🎲 Tirada de comprensión · lectura ${e.siguiente}</div>
        <p class="muted">d20 + mod. INT (${conSigno(intMod)}) + bono extra contra CD ${puedeFijarCD() ? e.prueba.cd : '<i>secreta</i>'}.</p>
        <div class="lec-tirada-campos">
          <label>Tu d20 <input type="number" min="1" max="20" id="lecD20" placeholder="vacío = tira la app"></label>
          <label>Bono extra <input type="number" id="lecBono" value="0"></label>
        </div>
        <div class="btn-row">
          <button class="btn" data-lec="tirar" data-id="${esc(id)}">🌙 Descanso largo: tirar</button>
          <button class="btn btn-sm" style="background:#777" data-lec="cancelar">Cancelar</button>
        </div>
      </div>`;
    } else {
      acciones = `<div class="btn-row">
        <button class="btn" data-lec="corto" data-id="${esc(id)}" ${e.prueba ? 'disabled title="Esta lectura pide un descanso largo y una tirada"' : ''}>☀️ Descanso corto: leer</button>
        <button class="btn btn-largo" data-lec="${e.prueba ? 'abrir-tirada' : 'largo'}" data-id="${esc(id)}" ${sinCD ? 'disabled' : ''}>🌙 Descanso largo: leer${e.prueba ? ' (con tirada)' : ''}</button>
      </div>
      ${e.prueba ? `<p class="lec-aviso">🌙 La lectura ${e.siguiente} es difícil: pide un <b>descanso largo</b> y una <b>tirada de comprensión</b>${sinCD ? '. <b>El DM todavía no ha fijado su dificultad.</b>' : '.'}</p>` : ''}`;
    }
    const intentos = (l.historial || []).length;
    const fallos = (l.historial || []).filter(h => h.ok === false).length;
    const ultimo = (l.historial || []).slice(-1)[0];
    return `<article class="lec-libro ${e.terminado ? 'terminado' : ''}">
      <div class="lec-lomo" aria-hidden="true"></div>
      <div class="lec-cuerpo">
        <div class="lec-cab">
          <h3 class="lec-titulo">📖 ${esc(l.name)}</h3>
          <span class="lec-cuenta">${e.hecho} / ${e.total} lecturas</span>
        </div>
        ${l.descripcion ? `<p class="lec-desc">${esc(l.descripcion)}</p>` : ''}
        <p class="lec-bono"><b>Al terminarlo:</b> ${l.bono ? esc(l.bono) : '<span class="muted">sin bono escrito</span>'}</p>
        ${htmlCasillas(l)}
        ${acciones}
        ${ultimo ? `<p class="muted lec-ultimo">Última vez: ${textoHistorial(ultimo)}</p>` : ''}
        <details class="lec-detalles">
          <summary>Recuento: ${intentos} descanso${intentos === 1 ? '' : 's'} leyendo${fallos ? ` · ${fallos} tirada${fallos === 1 ? '' : 's'} fallada${fallos === 1 ? '' : 's'}` : ''}</summary>
          <ol class="lec-historial">${(l.historial || []).slice().reverse().map(h => `<li>${textoHistorial(h)}</li>`).join('') || '<li class="muted">Aún no lo has abierto.</li>'}</ol>
          ${puedeFijarCD() ? `<div class="lec-dm">
            <label>👑 Casillas con tirada (casilla:CD) <input type="text" data-lec-pruebas="${esc(id)}" value="${esc(textoPruebas(l.pruebas))}" placeholder="p. ej. 4:14, 8:16"></label>
            <button class="btn btn-sm btn-edit" data-lec="guardar-pruebas" data-id="${esc(id)}">Guardar</button>
            <button class="btn btn-sm" style="background:#777" data-lec="reiniciar" data-id="${esc(id)}">↺ Reiniciar lectura</button>
          </div>` : ''}
        </details>
      </div>
    </article>`;
  }).join('');
}

function textoHistorial(h) {
  const f = h.f ? new Date(h.f).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
  const desc = h.d === 'corto' ? '☀️ descanso corto' : '🌙 descanso largo';
  if (!h.tirada) return `${f} · ${desc} · lectura ${h.casilla}`;
  const t = h.tirada;
  return `${f} · ${desc} · lectura ${h.casilla} · 🎲 ${t.d20} ${conSigno(t.mod)}${t.extra ? ' ' + conSigno(t.extra) : ''} = <b>${t.total}</b>`
    + (puedeFijarCD() ? ` vs CD ${t.cd}` : '') + (h.ok ? ' · ✅ entendido' : ' · ❌ no lo entiende');
}

function leer(id, descanso) {
  const l = state.libros[id];
  if (!l) return;
  const e = estadoLibro(l);
  if (e.terminado) return;
  const ahora = new Date().toISOString();
  if (e.prueba) {
    if (descanso !== 'largo') return;
    if (e.prueba.cd == null) { alert('El DM todavía no ha fijado la dificultad de esta lectura.'); return; }
    const manual = parseInt(document.getElementById('lecD20')?.value);
    const d20 = manual >= 1 && manual <= 20 ? manual : roll20();
    const mod = parseInt(state.character?.intMod) || 0;
    const extra = parseInt(document.getElementById('lecBono')?.value) || 0;
    const total = d20 + mod + extra;
    const ok = total >= e.prueba.cd;
    l.historial = [...(l.historial || []), { f: ahora, d: 'largo', casilla: e.siguiente, ok, tirada: { d20, mod, extra, total, cd: e.prueba.cd } }];
    if (ok) l.progreso = e.siguiente;
    tirando = null;
    saveState();
    render();
    renderInventario();
    const fin = ok && estadoLibro(l).terminado;
    aviso(ok ? (fin ? `✨ ¡Has terminado «${l.name}»! ${l.bono ? 'Obtienes: ' + l.bono : ''}` : `✅ Tirada ${total}: entiendes el pasaje y avanzas a la lectura ${e.siguiente}.`)
      : `❌ Tirada ${total}: el pasaje se te resiste. Vuelve a intentarlo en tu próximo descanso largo.`, ok ? 'info' : 'error');
    return;
  }
  l.historial = [...(l.historial || []), { f: ahora, d: descanso, casilla: e.siguiente, ok: true }];
  l.progreso = e.siguiente;
  saveState();
  render();
  renderInventario();
  if (estadoLibro(l).terminado) aviso(`✨ ¡Has terminado «${l.name}»! ${l.bono ? 'Obtienes: ' + l.bono : ''}`);
}

function aviso(texto, tipo = 'info') {
  const caja = document.getElementById('lecturaAviso');
  if (!caja) return;
  caja.innerHTML = `<div class="lec-resultado lec-resultado-${tipo}">${esc(texto)}</div>`;
  caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- Inventario → Libros: dar de alta, editar y quitar ----
let editando = null;

export function renderInventario() {
  const el = document.getElementById('invLibrosList');
  if (!el) return;
  const libros = Object.entries(state.libros || {}).sort(([, a], [, b]) => String(a.name).localeCompare(String(b.name)));
  el.innerHTML = libros.map(([id, l]) => {
    const e = estadoLibro(l);
    return `<div class="inv-row">
      <div class="inv-name">📖 ${esc(l.name)} <span class="muted">· ${e.hecho}/${e.total} lecturas${e.terminado ? ' · terminado' : ''}</span></div>
      <div class="inv-stepper">
        <button class="btn btn-sm btn-edit" data-lec="editar" data-id="${esc(id)}">✏️</button>
        <button class="btn btn-sm btn-danger" data-lec="quitar" data-id="${esc(id)}" title="Quitar del inventario">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<p class="muted">No tienes libros. Añade uno con el formulario.</p>';
  const ayudaCD = document.getElementById('libroPruebasAyuda');
  if (ayudaCD) ayudaCD.textContent = puedeFijarCD()
    ? 'Escribe casilla:CD, por ejemplo «4:14, 8:16». Sin «:CD» la tirada queda pendiente de dificultad.'
    : 'Escribe solo el número de casilla, por ejemplo «4, 8». La dificultad la pondrá el DM.';
}

function leerFormulario() {
  const name = document.getElementById('libroNombre').value.trim();
  const lecturas = Math.min(MAX_LECTURAS, Math.max(1, parseInt(document.getElementById('libroLecturas').value) || 1));
  return {
    name, lecturas,
    bono: document.getElementById('libroBono').value.trim(),
    descripcion: document.getElementById('libroDesc').value.trim(),
    pruebasTxt: document.getElementById('libroPruebas').value,
  };
}

function limpiarFormulario() {
  editando = null;
  for (const id of ['libroNombre', 'libroBono', 'libroDesc', 'libroPruebas']) document.getElementById(id).value = '';
  document.getElementById('libroLecturas').value = 8;
  document.getElementById('libroGuardar').textContent = '➕ Añadir libro';
  document.getElementById('libroCancelar').hidden = true;
  document.getElementById('libroPruebas').disabled = false;
}

function guardarFormulario() {
  const f = leerFormulario();
  if (!f.name) { alert('Ponle un título al libro.'); return; }
  if (editando && state.libros[editando]) {
    const l = state.libros[editando];
    const pruebas = puedeFijarCD() ? leerPruebas(f.pruebasTxt, f.lecturas) : l.pruebas || {};
    state.libros[editando] = { ...l, name: f.name, bono: f.bono, descripcion: f.descripcion, lecturas: f.lecturas,
      progreso: Math.min(l.progreso || 0, f.lecturas), pruebas };
  } else {
    state.libros[genId()] = { name: f.name, bono: f.bono, descripcion: f.descripcion, lecturas: f.lecturas, progreso: 0,
      pruebas: leerPruebas(f.pruebasTxt, f.lecturas, puedeFijarCD()), historial: [], creado: new Date().toISOString() };
  }
  saveState();
  limpiarFormulario();
  renderInventario();
  render();
}

function editar(id) {
  const l = state.libros[id];
  if (!l) return;
  editando = id;
  document.getElementById('libroNombre').value = l.name || '';
  document.getElementById('libroLecturas').value = l.lecturas || 1;
  document.getElementById('libroBono').value = l.bono || '';
  document.getElementById('libroDesc').value = l.descripcion || '';
  document.getElementById('libroPruebas').value = puedeFijarCD() ? textoPruebas(l.pruebas) : Object.keys(l.pruebas || {}).join(', ');
  document.getElementById('libroPruebas').disabled = !puedeFijarCD();   // una vez dado de alta, solo el DM las cambia
  document.getElementById('libroGuardar').textContent = '💾 Guardar cambios';
  document.getElementById('libroCancelar').hidden = false;
  document.getElementById('libroNombre').focus();
}

// Resumen para la tarjeta de la mesa
export function resumen() {
  const libros = Object.values(state.libros || {});
  if (!libros.length) return 'No llevas ningún libro encima';
  const enCurso = libros.filter(l => !estadoLibro(l).terminado);
  const prox = enCurso.find(l => estadoLibro(l).prueba);
  return `<b>${enCurso.length}</b> libro${enCurso.length === 1 ? '' : 's'} a medias · <b>${libros.length - enCurso.length}</b> terminado${libros.length - enCurso.length === 1 ? '' : 's'}`
    + (prox ? `<br>🌙 «${esc(prox.name)}» pide una tirada` : '');
}

export function init() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-lec]');
    if (!b || b.disabled) return;
    const id = b.dataset.id, accion = b.dataset.lec;
    if (accion === 'corto') leer(id, 'corto');
    else if (accion === 'largo') leer(id, 'largo');
    else if (accion === 'abrir-tirada') { tirando = id; render(); document.getElementById('lecD20')?.focus(); }
    else if (accion === 'tirar') leer(id, 'largo');
    else if (accion === 'cancelar') { tirando = null; render(); }
    else if (accion === 'guardar-pruebas') {
      const l = state.libros[id]; if (!l) return;
      const inp = document.querySelector(`[data-lec-pruebas="${CSS.escape(id)}"]`);
      state.libros[id] = { ...l, pruebas: leerPruebas(inp?.value, estadoLibro(l).total) };
      saveState(); render(); aviso('Casillas con tirada guardadas.');
    } else if (accion === 'reiniciar') {
      const l = state.libros[id]; if (!l || !confirm(`¿Volver a empezar «${l.name}» desde la primera lectura? El recuento se conserva.`)) return;
      state.libros[id] = { ...l, progreso: 0 };
      saveState(); render(); renderInventario();
    } else if (accion === 'editar') editar(id);
    else if (accion === 'quitar') {
      const l = state.libros[id]; if (!l || !confirm(`¿Quitar «${l.name}» de tu inventario? Se pierde su progreso de lectura.`)) return;
      delete state.libros[id];
      if (editando === id) limpiarFormulario();
      saveState(); renderInventario(); render();
    } else if (accion === 'guardar-libro') guardarFormulario();
    else if (accion === 'cancelar-libro') limpiarFormulario();
  });
}

// filtros.js — buscadores y filtros de las listas (inventario, compendio, usuarios...).
//
// En index.html basta con poner, encima de una lista:
//     <div class="filtros" data-filtros="inv-mat" data-campos data-tipos data-tengo
//          data-texto="Buscar material…"></div>
// y en app.js decir qué función repinta esa lista (init({ 'inv-mat': renderInvMateriales, ... })).
// La barra se construye sola. Las funciones que pintan preguntan con pasa() / estado()
// si un elemento se ve, y con cuenta() ponen «3 de 12».
// Los filtros se recuerdan mientras la página está abierta (no se guardan).
import { CAMPOS, CAMPO_NAMES } from './data.js';

const estados = {};          // lista -> { q, campo, tipo, tengo, en, ... }
const extra = {};            // lista -> [[f, opciones]] grupos de filtros propios de un módulo
let repintar = {};

// Un módulo puede añadir sus propios grupos de botones a su barra (antes de init):
//   filtros.grupo('objetos', 'cat', [['', 'Todo'], ['arma', '⚔️ Armas'], ...])
export function grupo(lista, f, opciones) { (extra[lista] ||= []).push([f, opciones]); }

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Sin mayúsculas ni tildes: "pocion" encuentra "Poción"
export const norm = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const CLS = { 'Cuerpo': 'cuerpo', 'Mente': 'mente', 'Alma': 'alma', 'Mágico': 'magico' };

export function estado(lista) {
  return estados[lista] || (estados[lista] = { q: '', campo: '', tipo: '', tengo: '', en: '' });
}
export const activo = lista => Object.values(estado(lista)).some(Boolean);

// ¿El texto buscado aparece en alguno de estos textos? (todas las palabras, en cualquier orden)
export function coincide(lista, ...textos) {
  const q = norm(estado(lista).q);
  if (!q) return true;
  const t = norm(textos.filter(Boolean).join(' '));
  return q.split(/\s+/).every(p => t.includes(p));
}

// Filtro de campo: '' (todos), un campo, o 'sin-id' (sin identificar)
export function campoOk(lista, campo, sinIdentificar = false) {
  const c = estado(lista).campo;
  if (!c) return true;
  if (c === 'sin-id') return sinIdentificar;
  return !sinIdentificar && campo === c;
}

// «Mostrando 3 de 12»
export function cuenta(lista, vistos, total) {
  const el = document.querySelector(`[data-filtros="${lista}"] .filtros-cuenta`);
  if (!el) return;
  el.textContent = activo(lista) ? `${vistos} de ${total}` : `${total}`;
  el.title = activo(lista) ? 'Se ven ' + vistos + ' de ' + total : total + ' en total';
}

// Lo que se pinta cuando el filtro no deja nada
export const vacio = lista => `<p class="muted filtros-nada">Nada coincide con la búsqueda.
  <button type="button" class="enlace" data-filtro-limpiar="${esc(lista)}">Quitar filtros</button></p>`;

function chips(lista, f, opciones, valor) {
  return `<div class="filtros-grupo" role="group">${opciones.map(([v, txt, cls = '']) =>
    `<button type="button" class="filtro-chip ${cls} ${valor === v ? 'activo' : ''}" data-filtro="${esc(lista)}" data-f="${f}" data-v="${esc(v)}" aria-pressed="${valor === v}">${txt}</button>`).join('')}</div>`;
}

function construir(caja) {
  const lista = caja.dataset.filtros;
  const e = estado(lista);
  const d = caja.dataset;
  let html = `<label class="filtros-buscar"><span aria-hidden="true">🔍</span>
      <input type="search" data-filtro="${esc(lista)}" data-f="q" value="${esc(e.q)}" placeholder="${esc(d.texto || 'Buscar por nombre…')}" aria-label="${esc(d.texto || 'Buscar por nombre')}">
      <span class="filtros-cuenta"></span></label>`;
  if ('campos' in d) html += chips(lista, 'campo', [['', 'Todos'],
    ...CAMPO_NAMES.map(c => [c, `${CAMPOS[c].icon} ${c}`, 'chip-' + CLS[c]]),
    ...('sinId' in d ? [['sin-id', '❔ Sin identificar', 'chip-sin-id']] : [])], e.campo);
  if ('tipos' in d) html += chips(lista, 'tipo', [['', 'Reactivos y modificadores'], ['Reactivo', '🌿 Reactivos'], ['Modificador', '🧪 Modificadores']], e.tipo);
  if ('tengo' in d) html += chips(lista, 'tengo', [['', 'Todo el catálogo'], ['si', '🎒 Solo lo que tengo']], e.tengo);
  if ('estados' in d) html += chips(lista, 'en', [['', 'Todos'], ['en-linea', '🟢 En línea'], ['dm', '👑 DM']], e.en);
  for (const [f, opciones] of extra[lista] || []) html += chips(lista, f, opciones, e[f] || '');
  caja.innerHTML = html;
}

export function limpiar(lista) {
  estados[lista] = { q: '', campo: '', tipo: '', tengo: '', en: '' };
  document.querySelectorAll(`[data-filtros="${CSS.escape(lista)}"]`).forEach(construir);
  repintar[lista]?.();
}

export function init(funciones) {
  repintar = funciones;
  document.querySelectorAll('[data-filtros]').forEach(construir);
  let espera = null;
  document.addEventListener('input', ev => {
    const i = ev.target.closest('input[data-filtro]');
    if (!i) return;
    estado(i.dataset.filtro).q = i.value;
    clearTimeout(espera);
    espera = setTimeout(() => repintar[i.dataset.filtro]?.(), 120);
  });
  document.addEventListener('click', ev => {
    const l = ev.target.closest('[data-filtro-limpiar]');
    if (l) { limpiar(l.dataset.filtroLimpiar); return; }
    const b = ev.target.closest('button[data-filtro]');
    if (!b) return;
    estado(b.dataset.filtro)[b.dataset.f] = b.dataset.v;
    b.parentElement.querySelectorAll('.filtro-chip').forEach(x => {
      const on = x === b;
      x.classList.toggle('activo', on);
      x.setAttribute('aria-pressed', on);
    });
    repintar[b.dataset.filtro]?.();
  });
  // Escape vacía el buscador
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const i = ev.target.closest?.('input[data-filtro]');
    if (i && i.value) { i.value = ''; estado(i.dataset.filtro).q = ''; repintar[i.dataset.filtro]?.(); }
  });
}

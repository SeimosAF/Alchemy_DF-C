// bolsa.js — la bolsa de monedas del jugador (cabecera del Inventario).
//
// Es un solo número: las monedas de oro (state.bolsa.oro). Con servidor viaja
// como suma/resta (colección «bolsa», tipo num), así que si el DM te da oro
// mientras tú pagas una jarra, se aplican las dos cosas sin pisarse, y nunca
// puede quedar por debajo de 0. Cada cambio queda en el historial de la mesa.
//
// En la casilla se puede escribir el total («250») o lo que se gana o se gasta
// («+50», «-12»). El DM cambia la bolsa de cualquiera desde «Inventarios de la mesa».
import { state, saveState } from './state.js';
import * as sync from './sync.js';

export const MAX = 999999999;
const fmt = n => Number(n || 0).toLocaleString('es-ES');

export function cuantas(bolsa = state.bolsa) {
  const n = bolsa?.oro;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Lee lo escrito: «250» = total, «+50» / «-12» = sumar / restar. Devuelve el total nuevo o null si no se entiende. */
export function leer(texto, antes) {
  const t = String(texto ?? '').replace(/[\s.]/g, '').replace(/[−–]/g, '-').replace(',', '');
  const m = t.match(/^([+-]?)(\d{1,9})$/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  return m[1] === '+' ? antes + n : m[1] === '-' ? antes - n : n;
}

/** Destello de la cantidad ganada o gastada encima de la moneda. */
export function destello(caja, delta) {
  if (!caja || !delta) return;
  const d = document.createElement('span');
  d.className = 'bolsa-destello ' + (delta > 0 ? 'gana' : 'gasta');
  d.textContent = (delta > 0 ? '+' : '−') + fmt(Math.abs(delta));
  caja.appendChild(d);
  setTimeout(() => d.remove(), 1300);
  const moneda = caja.querySelector('.bolsa-moneda');
  if (moneda) { moneda.classList.remove('gira'); void moneda.offsetWidth; moneda.classList.add('gira'); }
}

/** HTML del contador. «attr» distingue el del jugador (data-bolsa) del del DM (data-dm-bolsa). */
export function html(n, attr = 'data-bolsa', etiqueta = 'Tu bolsa') {
  return `<span class="bolsa-moneda" aria-hidden="true"></span>
    <span class="bolsa-texto">
      <span class="bolsa-etiqueta">${etiqueta}</span>
      <span class="bolsa-fila">
        <button type="button" class="bolsa-btn" ${attr}="-1" title="Gastar 1" aria-label="Gastar una moneda" ${n ? '' : 'disabled'}>−</button>
        <input type="text" class="bolsa-num" inputmode="numeric" autocomplete="off" ${attr}-num value="${fmt(n)}" data-antes="${n}"
          aria-label="Monedas de oro" title="Escribe el total, o +50 / -12 para sumar o gastar. Intro para guardar.">
        <span class="bolsa-ud" title="monedas de oro">mo</span>
        <button type="button" class="bolsa-btn" ${attr}="1" title="Ganar 1" aria-label="Ganar una moneda">+</button>
      </span>
    </span>`;
}

let ultimo = null;
export function render() {
  const el = document.getElementById('bolsa');
  if (!el) return;
  const n = cuantas();
  if (el.contains(document.activeElement) && document.activeElement.matches('.bolsa-num')) return;   // a medio escribir
  if (!el.firstChild) el.innerHTML = html(n);
  else {
    el.querySelector('.bolsa-num').value = fmt(n);
    el.querySelector('.bolsa-num').dataset.antes = n;
    el.querySelector('[data-bolsa="-1"]').disabled = !n;
  }
  if (ultimo !== null && n !== ultimo) destello(el, n - ultimo);   // también si cambia desde fuera (el DM)
  ultimo = n;
}

function fijar(nuevo) {
  const antes = cuantas();
  if (nuevo === null) { render(); return; }
  if (nuevo < 0) { sync.aviso(`No te llega: llevas ${fmt(antes)} mo y querías gastar ${fmt(antes - nuevo)}.`, 'error'); render(); return; }
  if (nuevo > MAX) { sync.aviso(`Eso son demasiadas monedas (máximo ${fmt(MAX)}).`, 'error'); render(); return; }
  if (nuevo === antes) { render(); return; }
  state.bolsa = { ...(state.bolsa || {}), oro: nuevo };
  if (!nuevo) delete state.bolsa.oro;
  saveState();
  render();
}

export function init() {
  const el = document.getElementById('bolsa');
  if (!el) return;
  render();
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-bolsa]');
    if (b && !b.disabled) fijar(cuantas() + parseInt(b.dataset.bolsa, 10));
  });
  el.addEventListener('focusin', e => {
    if (!e.target.matches('.bolsa-num')) return;
    e.target.value = cuantas() || '';
    e.target.select();
  });
  el.addEventListener('keydown', e => {
    if (!e.target.matches('.bolsa-num')) return;
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    if (e.key === 'Escape') { e.target.value = cuantas(); e.target.blur(); }
  });
  el.addEventListener('focusout', e => {
    if (!e.target.matches('.bolsa-num')) return;
    const texto = e.target.value;
    setTimeout(() => fijar(texto.trim() === '' ? cuantas() : leer(texto, cuantas())), 0);
  });
}

// cuenta.js — el icono de la cuenta arriba a la derecha y su menú.
//
// Junta en un solo sitio lo que antes ocupaba la cabecera: quién eres, tu mesa,
// tu perfil, quién está en línea, el estado de la conexión, el sonido, exportar /
// importar, tu contraseña, tu foto y cerrar sesión. Las opciones del menú usan
// los mismos data-action que el resto de la app (los atiende app.js).
import * as auth from './auth.js';
import * as avatar from './avatar.js';
import * as sync from './sync.js';
import { SOUND_ENABLED } from './data.js';

let enLinea = 0;
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inicial = n => (String(n || '').trim()[0] || '?').toUpperCase();

const caja = () => document.getElementById('cuenta');
const menu = () => document.getElementById('cuentaMenu');
const boton = () => document.getElementById('cuentaBtn');
export const abierto = () => !!menu() && !menu().hidden;

function rolTxt() {
  if (!auth.servidor) return '💾 Jugando sin servidor';
  return auth.esAdmin() ? '🛡️ Superusuario' : auth.esDM() ? '👑 DM de esta mesa' : '⚔️ Jugador';
}

// El botón (avatar, punto de conexión y cuántos hay en línea)
export function pintar() {
  const b = boton();
  if (!b) return;
  const u = auth.usuario;
  const av = document.getElementById('cuentaAvatar');
  if (av) {
    av.textContent = u ? inicial(u.nombre) : '🧙';
    avatar.poner(av, u?.clave, u?.avatar);
  }
  b.title = u ? `${u.nombre} · ${rolTxt()}${auth.mesa ? ' · ' + auth.mesa.nombre : ''}` : 'Opciones';
  const n = document.getElementById('cuentaOnline');
  if (n) n.textContent = auth.servidor && enLinea > 1 ? String(enLinea) : '';
  if (abierto()) pintarMenu();
}

export function setEnLinea(n) { enLinea = n; pintar(); }

function pintarMenu() {
  const m = menu();
  if (!m) return;
  const u = auth.usuario;
  const srv = auth.servidor;
  const estado = document.getElementById('syncEstado');
  const item = (accion, icono, texto, extra = '', clase = '') =>
    `<button type="button" role="menuitem" class="cuenta-item ${clase}" data-action="${accion}" ${extra}><span class="cuenta-item-icono">${icono}</span><span>${texto}</span></button>`;
  m.innerHTML = `
    <div class="cuenta-cab">
      ${avatar.html(u?.clave, u?.avatar, u ? inicial(u.nombre) : '🧙', 'avatar cuenta-avatar-grande')}
      <div class="cuenta-cab-txt">
        <div class="cuenta-nombre">${esc(u?.nombre || 'Este navegador')}</div>
        <div class="cuenta-rol">${rolTxt()}</div>
        ${auth.mesa ? `<div class="cuenta-mesa">🗺️ ${esc(auth.mesa.nombre)}</div>` : ''}
        ${estado ? `<div class="cuenta-sync sync-${esc(document.body.dataset.sync || 'ok')}" title="${esc(estado.title)}">${esc(estado.textContent)}</div>` : ''}
      </div>
    </div>
    <div class="cuenta-grupo">
      ${item('switch-tab', '🧙', srv ? 'Mi perfil y personaje' : 'Mi personaje', 'data-id="perfil"')}
      ${srv && u ? item('foto-perfil', '📷', u.avatar ? 'Cambiar mi foto' : 'Poner una foto') : ''}
      ${item('switch-tab', '🟢', `Quién está en línea${srv ? ` <span class="nav-contador">${enLinea || ''}</span>` : ''}`, 'data-id="usuarios"')}
      ${srv ? item('cambiar-mesa', '🗺️', 'Cambiar de mesa') : ''}
    </div>
    <div class="cuenta-grupo">
      ${item('toggle-sound', SOUND_ENABLED ? '🔊' : '🔇', SOUND_ENABLED ? 'Sonido activado' : 'Sonido apagado')}
      ${item('export-data', '💾', 'Exportar mis datos')}
      ${item('import-data', '📂', 'Importar datos')}
      ${!srv || auth.esDM() ? item('reset-all', '🗑️', 'Borrar todo', '', 'cuenta-item-peligro') : ''}
    </div>
    ${srv && u ? `<div class="cuenta-grupo">
      ${!auth.esAdmin() ? item('pass-propia', '🔑', 'Cambiar mi contraseña') : ''}
      ${item('salir', '🚪', 'Cerrar sesión', '', 'cuenta-item-peligro')}
    </div>` : ''}`;
}

export function abrir() {
  const m = menu();
  if (!m) return;
  pintarMenu();
  m.hidden = false;
  boton()?.setAttribute('aria-expanded', 'true');
  m.querySelector('.cuenta-item')?.focus({ preventScroll: true });
}
export function cerrar() {
  const m = menu();
  if (!m || m.hidden) return;
  m.hidden = true;
  boton()?.setAttribute('aria-expanded', 'false');
}

export function init() {
  const b = boton();
  if (!b) return;
  b.addEventListener('click', e => { e.stopPropagation(); abierto() ? cerrar() : abrir(); });
  // Al elegir una opción, o al pulsar fuera, se cierra (la opción la atiende app.js por data-action)
  document.addEventListener('click', e => {
    if (!abierto()) return;
    if (!caja()?.contains(e.target) || e.target.closest('.cuenta-item')) setTimeout(cerrar, 0);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && abierto()) { cerrar(); b.focus(); }
    if (!abierto() || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const items = [...menu().querySelectorAll('.cuenta-item')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  });
  pintar();
}

// ---- Ventana para poner o quitar la foto propia ----
export function dialogoFoto(alCambiar = () => {}) {
  if (!auth.servidor || !auth.usuario) return;
  document.getElementById('fotoDialogo')?.remove();
  const u = auth.usuario;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="foto-fondo" id="fotoDialogo" role="dialog" aria-modal="true" aria-labelledby="fotoTitulo">
      <div class="foto-caja">
        <h3 id="fotoTitulo">📷 Tu foto</h3>
        <p class="muted">La ven los demás junto a tu nombre en todas tus mesas. Se recorta en cuadrado y se reduce a ${avatar.LADO}×${avatar.LADO}.</p>
        <div class="foto-vista">${avatar.html(u.clave, u.avatar, inicial(u.nombre), 'avatar foto-avatar', '')}</div>
        <p class="entrada-error" id="fotoError" role="alert"></p>
        <input type="file" id="fotoArchivo" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
        <div class="foto-botones">
          <button type="button" class="btn" data-foto="elegir">🖼️ Elegir imagen…</button>
          <button type="button" class="btn" data-foto="guardar" hidden>💾 Guardar</button>
          ${u.avatar ? '<button type="button" class="btn btn-danger" data-foto="quitar">Quitar foto</button>' : ''}
          <button type="button" class="btn" style="background:#777" data-foto="cerrar">Cerrar</button>
        </div>
      </div>
    </div>`);
  const d = document.getElementById('fotoDialogo');
  const vista = d.querySelector('.foto-avatar');
  const err = d.querySelector('#fotoError');
  const input = d.querySelector('#fotoArchivo');
  const guardar = d.querySelector('[data-foto="guardar"]');
  let lista = null;
  const fuera = () => { d.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') fuera(); };
  document.addEventListener('keydown', tecla);
  d.addEventListener('click', async e => {
    if (e.target === d) return fuera();
    const a = e.target.closest('[data-foto]')?.dataset.foto;
    if (a === 'cerrar') return fuera();
    if (a === 'elegir') return input.click();
    if (a === 'quitar') {
      if (!confirm('¿Quitar tu foto? Volverá a verse tu inicial.')) return;
      const r = await avatar.quitar();
      if (!r.ok) { err.textContent = r.mensaje; return; }
      fuera(); alCambiar(); sync.aviso('Foto quitada.');
      return;
    }
    if (a === 'guardar' && lista) {
      guardar.disabled = true;
      const r = await avatar.subir(lista);
      guardar.disabled = false;
      if (!r.ok) { err.textContent = r.mensaje || 'No se pudo guardar la foto.'; return; }
      fuera(); alCambiar(); sync.aviso('📷 Foto guardada.');
    }
  });
  input.addEventListener('change', async () => {
    err.textContent = '';
    try {
      lista = await avatar.prepararFoto(input.files?.[0]);
      vista.removeAttribute('data-avatar'); vista.removeAttribute('data-avatar-v');   // que no la pise la foto de antes
      vista.style.backgroundImage = `url("${lista}")`;
      vista.classList.add('con-foto');
      guardar.hidden = false;
      guardar.focus();
    } catch (e) { err.textContent = e.message; lista = null; guardar.hidden = true; }
    input.value = '';
  });
  d.querySelector('[data-foto="elegir"]').focus();
}

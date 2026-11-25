// panel.js — la mesa principal (4 tarjetas) y la sala "Usuarios en línea".
import { state } from './state.js';
import * as auth from './auth.js';
import * as modulos from './modulos.js';
import * as niveles from './niveles.js';

let presencia = [];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Tarjetas de la mesa ----
function contar() {
  const mats = Object.values(state.inventory || {}).reduce((a, n) => a + (Number(n) || 0), 0);
  const tipos = Object.values(state.inventory || {}).filter(n => n > 0).length;
  const pots = Object.values(state.potions || {}).reduce((a, p) => a + (p.qty || 0), 0);
  const loot = Object.values(state.lootPotions || {}).reduce((a, p) => a + (p.qty || 0), 0);
  const cat = Object.keys(state.catalog || {}).length;
  const recetas = Object.keys(state.potionCatalog || {}).length;
  const reactivos = Object.entries(state.inventory || {}).filter(([id, n]) => n > 0 && state.catalog[id]?.type === 'Reactivo').length;
  return { mats, tipos, pots, loot, cat, recetas, reactivos };
}

// Resúmenes de las tarjetas (los usa el registro de módulos de app.js)
export function resumenInventario() {
  const c = contar();
  const libros = Object.keys(state.libros || {}).length;
  return `<b>${c.mats}</b> material${c.mats === 1 ? '' : 'es'} de ${c.tipos} tipo${c.tipos === 1 ? '' : 's'}<br><b>${c.pots}</b> poci${c.pots === 1 ? 'ón' : 'ones'}${c.loot ? ` · <b>${c.loot}</b> de botín` : ''}${libros ? ` · <b>${libros}</b> libro${libros === 1 ? '' : 's'}` : ''}`;
}
export function resumenAlquimia() {
  const c = contar();
  const n = niveles.nivelActual();
  return `Nivel <b>${n}</b> · ${esc(niveles.tituloNivel(n))}<br>` + (c.reactivos
    ? `<b>${c.reactivos}</b> reactivo${c.reactivos === 1 ? '' : 's'} listo${c.reactivos === 1 ? '' : 's'} para el caldero`
    : 'El caldero espera: te faltan reactivos');
}
export function resumenUsuarios() {
  if (!auth.servidor) return 'Sin servidor: estás jugando en solitario';
  const en = presencia.filter(p => p.estado === 'en-linea');
  const aus = presencia.filter(p => p.estado === 'ausente');
  return `<span class="avatares">${en.concat(aus).slice(0, 6).map(p =>
    `<span class="avatar avatar-${p.estado}" title="${esc(p.nombre)}">${esc(inicial(p.nombre))}</span>`).join('')}</span>` +
    `<b>${en.length}</b> en línea${aus.length ? ` · ${aus.length} ausente${aus.length === 1 ? '' : 's'}` : ''}`;
}

export function pintarTarjetas() {
  modulos.pintarResumenes();
  const badge = document.getElementById('navOnlineCount');
  if (badge) badge.textContent = auth.servidor ? String(presencia.filter(p => p.estado === 'en-linea').length) : '';
}

// Las tarjetas aparecen una a una cada vez que se vuelve a la mesa
export function animarEntrada() {
  const mesa = document.getElementById('mesaTarjetas');
  if (!mesa) return;
  mesa.classList.remove('aparecer');
  void mesa.offsetWidth;
  mesa.classList.add('aparecer');
  pintarTarjetas();
}

export function pintarSaludo() {
  const el = document.getElementById('mesaSaludo');
  if (!el) return;
  const h = new Date().getHours();
  const franja = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  el.innerHTML = auth.usuario
    ? `${franja}, <span class="mesa-nombre">${esc(auth.usuario.nombre)}</span>${auth.esAdmin() ? ' <span class="rol-dm rol-admin">🛡️ Superusuario</span>' : auth.esDM() ? ' <span class="rol-dm">👑 DM</span>' : ''}`
    : `${franja}, alquimista`;
}

export function pintarCabecera() {
  const u = document.getElementById('usuarioChip');
  if (u) {
    u.hidden = !auth.usuario;
    if (auth.usuario) u.innerHTML = `${auth.esAdmin() ? '🛡️' : auth.esDM() ? '👑' : '⚔️'} ${esc(auth.usuario.nombre)}`;
  }
  for (const id of ['salirBtn', 'mesaSalir']) {
    const salir = document.getElementById(id);
    if (salir) salir.hidden = !auth.usuario;
  }
  document.body.classList.toggle('es-dm', auth.esDM());
  document.body.classList.toggle('es-admin', auth.esAdmin());
  document.body.classList.toggle('modo-local', !auth.servidor);
}

// ---- Usuarios en línea ----
function inicial(n) { return (String(n).trim()[0] || '?').toUpperCase(); }
function haceTxt(s) {
  if (s == null) return 'no ha entrado desde que se encendió el servidor';
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

export function setPresencia(lista) {
  presencia = lista || [];
  pintarTarjetas();
  if (document.getElementById('tab-usuarios')?.classList.contains('active')) renderUsuarios();
}

export function renderUsuarios() {
  const el = document.getElementById('listaUsuarios');
  if (!el) return;
  if (!auth.servidor) {
    el.innerHTML = '<p class="muted">La app está funcionando sin servidor, solo en este navegador. Arráncala con <code>iniciar.bat</code> o con Docker para jugar con otras personas.</p>';
    return;
  }
  const orden = { 'en-linea': 0, ausente: 1, desconectado: 2 };
  // Las cuentas desterradas solo las ve el superusuario (para poder readmitirlas)
  const lista = [...presencia].filter(p => !p.baneado || auth.esAdmin())
    .sort((a, b) => (a.baneado - b.baneado) || orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
  const txtEstado = { 'en-linea': 'En línea', ausente: 'Ausente', desconectado: 'Desconectado' };
  el.innerHTML = lista.map(p => {
    const yo = p.clave === auth.usuario?.clave;
    const acciones = [];
    const admin = p.rol === 'admin';
    if (yo && !admin) acciones.push(`<button class="btn btn-sm" data-usr="pass-propia">🔑 Cambiar mi contraseña</button>`);
    if (auth.esAdmin() && !yo && !admin) {
      if (!p.baneado) acciones.push(p.rol === 'dm'
        ? `<button class="btn btn-sm btn-edit" data-usr="rol" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}" data-rol="jugador">Quitar DM</button>`
        : `<button class="btn btn-sm btn-edit" data-usr="rol" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}" data-rol="dm">👑 Hacer DM</button>`);
      acciones.push(p.baneado
        ? `<button class="btn btn-sm" data-usr="readmitir" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}">🕊️ Readmitir</button>`
        : `<button class="btn btn-sm btn-danger" data-usr="desterrar" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}">🚫 Desterrar</button>`);
    }
    if (auth.esDM() && !yo && !admin && !p.baneado) {
      acciones.push(`<button class="btn btn-sm btn-info" data-usr="pass" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}">🔑 Nueva contraseña</button>`);
      acciones.push(`<button class="btn btn-sm" data-usr="ver-inv" data-clave="${esc(p.clave)}">🎒 Inventario, libros y nivel</button>`);
    }
    const rolTxt = admin ? '<span class="usr-rol rol-dm rol-admin">🛡️ Superusuario</span>'
      : p.rol === 'dm' ? '<span class="usr-rol rol-dm">👑 DM</span>' : '<span class="usr-rol rol-jugador">⚔️ Jugador</span>';
    if (p.baneado) return `<div class="usr-fila usr-desterrado">
      <span class="avatar avatar-grande">🚫</span>
      <div class="usr-info">
        <div class="usr-nombre">${esc(p.nombre)} ${rolTxt}</div>
        <div class="usr-estado">Desterrado de la mesa: no puede entrar</div>
      </div>
      <div class="usr-acciones">${acciones.join('')}</div>
    </div>`;
    return `<div class="usr-fila usr-${p.estado}">
      <span class="avatar avatar-${p.estado} avatar-grande">${esc(inicial(p.nombre))}</span>
      <div class="usr-info">
        <div class="usr-nombre">${esc(p.nombre)}${yo ? ' <span class="muted">(tú)</span>' : ''}
          ${rolTxt}</div>
        <div class="usr-estado"><span class="punto punto-${p.estado}"></span>${txtEstado[p.estado]}
          ${p.estado !== 'desconectado' && p.lugar ? ' · ' + esc(modulos.textoLugar(p.lugar)) : ''}
          ${p.estado === 'desconectado' ? ' · visto ' + haceTxt(p.hace) : ''}</div>
      </div>
      <div class="usr-acciones">${acciones.join('')}</div>
    </div>`;
  }).join('') || '<p class="muted">Todavía no hay nadie más en la mesa.</p>';
}

// Acciones de la lista de usuarios (cambiar rol, contraseñas)
export function initUsuarios(verInventario) {
  document.getElementById('listaUsuarios')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-usr]');
    if (!b) return;
    const accion = b.dataset.usr;
    if (accion === 'ver-inv') { verInventario(b.dataset.clave); return; }
    if (accion === 'rol') {
      const dm = b.dataset.rol === 'dm';
      if (!confirm(dm ? `¿Dar poderes de DM a ${b.dataset.nombre}? Podrá cambiar el inventario, los libros y el nivel de alquimia de todos.` : `¿Quitarle los poderes de DM a ${b.dataset.nombre}?`)) return;
      const r = await auth.cambiarRol(b.dataset.clave, b.dataset.rol);
      if (!r.ok) alert(r.mensaje);
      return;
    }
    if (accion === 'desterrar' || accion === 'readmitir') {
      const ban = accion === 'desterrar';
      if (!confirm(ban ? `¿Desterrar a ${b.dataset.nombre}? Se le cerrará la sesión y no podrá volver a entrar hasta que lo readmitas. Sus datos no se borran.`
        : `¿Readmitir a ${b.dataset.nombre} en la mesa? Podrá volver a entrar con su contraseña.`)) return;
      const r = await auth.desterrar(b.dataset.clave, ban);
      if (!r.ok) alert(r.mensaje);
      return;
    }
    if (accion === 'pass') {
      const n = prompt(`Nueva contraseña para ${b.dataset.nombre} (mínimo 6 caracteres).\nSe le cerrará la sesión y tendrá que entrar con esta.`);
      if (n == null) return;
      const r = await auth.cambiarContrasena({ usuario: b.dataset.clave, nueva: n });
      alert(r.ok ? `Hecho. Dile a ${b.dataset.nombre} su nueva contraseña.` : r.mensaje);
      return;
    }
    if (accion === 'pass-propia') {
      const actual = prompt('Tu contraseña actual:');
      if (actual == null) return;
      const nueva = prompt('Tu contraseña nueva (mínimo 6 caracteres):');
      if (nueva == null) return;
      if (prompt('Repite la contraseña nueva:') !== nueva) { alert('No coinciden. No se ha cambiado nada.'); return; }
      const r = await auth.cambiarContrasena({ actual, nueva });
      alert(r.ok ? 'Contraseña cambiada.' : r.mensaje);
    }
  });
}

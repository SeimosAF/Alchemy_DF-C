// panel.js — la mesa principal (4 tarjetas) y la sala "Usuarios en línea".
// En "Usuarios en línea" el DM también invita jugadores a su campaña, los saca
// y les asigna disciplina; el superusuario además crea y renombra campañas.
import { state } from './state.js';
import * as auth from './auth.js';
import * as modulos from './modulos.js';
import * as niveles from './niveles.js';
import * as sync from './sync.js';
import * as avatar from './avatar.js';
import * as cuenta from './cuenta.js';
import * as filtros from './filtros.js';

let presencia = [];
let cuentas = null;        // cuentas que el DM puede invitar (se piden al abrir la sala)
let admin = null;          // { campanas, cuentas } para el superusuario
let historial = null;      // { lista, puedeDeshacer, fin } historial de cambios de la campaña (DM y superusuario)
let pendientes = [];       // cuentas nuevas de Discord que esperan aprobación (DM y superusuario)
let nPendientes = 0;

export const DISCIPLINAS = {
  alquimista: { icono: '⚗️', nombre: 'Alquimista' },
  cocinero:   { icono: '🍲', nombre: 'Cocinero' },
  hechicero:  { icono: '✨', nombre: 'Hechicero' },
  herrero:    { icono: '⚒️', nombre: 'Herrero' },
  desempleado:   { icono: '🪑', nombre: 'Desempleado' },     // ningún oficio
  pluriempleado: { icono: '🧰', nombre: 'Pluriempleado' },   // todos los oficios
};
// Los oficios que tiene (uno, varios, todos o ninguno), en texto
export const nombreDisciplina = d => {
  if (DISCIPLINAS[d] || !d) { const x = DISCIPLINAS[d] || DISCIPLINAS.alquimista; return `${x.icono} ${x.nombre}`; }
  const l = modulos.listaDisciplinas(d);
  if (!l.length) return nombreDisciplina('desempleado');
  if (l.length === modulos.OFICIOS.length) return nombreDisciplina('pluriempleado');
  return l.map(o => `${DISCIPLINAS[o].icono} ${DISCIPLINAS[o].nombre}`).join(' · ');
};
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
  const objs = Object.values(state.objetos || {}).reduce((t, o) => t + (o.cantidad ?? 1), 0);
  const oro = Number.isInteger(state.bolsa?.oro) ? state.bolsa.oro : 0;
  return `🪙 <b>${oro.toLocaleString('es-ES')}</b> mo · <b>${objs}</b> objeto${objs === 1 ? '' : 's'} · <b>${c.mats}</b> material${c.mats === 1 ? '' : 'es'} de ${c.tipos} tipo${c.tipos === 1 ? '' : 's'}<br><b>${c.pots}</b> poci${c.pots === 1 ? 'ón' : 'ones'}${c.loot ? ` · <b>${c.loot}</b> de botín` : ''}${libros ? ` · <b>${libros}</b> libro${libros === 1 ? '' : 's'}` : ''}`;
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
    avatar.html(p.clave, p.avatar, inicial(p.nombre), `avatar avatar-${p.estado}`, p.nombre)).join('')}</span>` +
    `<b>${en.length}</b> en línea${aus.length ? ` · ${aus.length} ausente${aus.length === 1 ? '' : 's'}` : ''}`;
}

export function pintarTarjetas() {
  modulos.pintarResumenes();
  const n = presencia.filter(p => p.estado === 'en-linea').length;
  const badge = document.getElementById('navOnlineCount');
  if (badge) badge.textContent = auth.servidor ? String(n) : '';
  cuenta.setEnLinea(n);   // el numerito del icono de la cuenta
}

// Las tarjetas aparecen una a una cada vez que se vuelve a la mesa
export function animarEntrada() {
  const mesa = document.getElementById('mesaTarjetas');
  if (!mesa) return;
  mesa.classList.remove('aparecer');
  void mesa.offsetWidth;
  mesa.classList.add('aparecer');
  modulos.recolocarMesa();
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
  const sub = document.getElementById('mesaCampana');
  if (sub) {
    sub.hidden = !auth.mesa;
    const pj = auth.usuario?.personaje?.nombre;
    if (auth.mesa) sub.innerHTML = `Mesa de <b>${esc(auth.mesa.nombre)}</b>${auth.esAdmin() ? '' : ` · ${nombreDisciplina(auth.usuario.disciplina)}`}`
      + (pj ? ` · jugando con <b>${esc(auth.usuario.personaje.retrato || '')} ${esc(pj)}</b>` : auth.esAdmin() ? '' : ' · <a href="#" data-action="switch-tab" data-id="perfil">crea tu personaje en Perfil</a>');
  }
}

// Cabecera: la mesa (pulsar = cambiar de mesa). Quién eres, el perfil y cerrar sesión están en el menú de la cuenta (cuenta.js).
export function pintarCabecera() {
  const m = document.getElementById('mesaChip');
  if (m) {
    m.hidden = !auth.mesa;
    if (auth.mesa) { m.textContent = '🗺️ ' + auth.mesa.nombre; m.title = 'Estás en la campaña «' + auth.mesa.nombre + '». Pulsa para cambiar de mesa.'; }
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

// El sondeo dice cuántas cuentas de Discord esperan aprobación: se avisa al DM si hay alguna nueva
export function setPendientes(n) {
  if (n > nPendientes) sync.aviso(`🎮 ${n === 1 ? 'Una cuenta nueva de Discord espera' : n + ' cuentas nuevas de Discord esperan'} tu aprobación en «Quién está en línea».`);
  const cambia = n !== nPendientes;
  nPendientes = n;
  if (cambia && document.getElementById('tab-usuarios')?.classList.contains('active')) cargarGestion();
}

export function setPresencia(lista) {
  presencia = lista || [];
  pintarTarjetas();
  if (document.getElementById('tab-usuarios')?.classList.contains('active')) renderUsuarios();
}

export function renderUsuarios() {
  const el = document.getElementById('listaUsuarios');
  if (!el) return;
  if (el.contains(document.activeElement) && document.activeElement.matches('select')) return;   // no cerrar un desplegable abierto
  if (el.querySelector('details.usr-disciplinas[open]')) return;   // ni la lista de oficios mientras el DM la marca
  if (!auth.servidor) {
    el.innerHTML = '<p class="muted">La app está funcionando sin servidor, solo en este navegador. Arráncala con <code>iniciar.bat</code> o con Docker para jugar con otras personas.</p>';
    return;
  }
  const orden = { 'en-linea': 0, ausente: 1, desconectado: 2 };
  // Las cuentas desterradas solo las ve el superusuario (para poder readmitirlas)
  const todos = [...presencia].filter(p => !p.baneado || auth.esAdmin());
  const en = filtros.estado('usuarios').en;
  const lista = todos.filter(p => filtros.coincide('usuarios', p.nombre, p.personaje, nombreDisciplina(p.disciplina), p.rol === 'dm' ? 'DM' : '')
      && (!en || (en === 'dm' ? p.rol === 'dm' || p.rol === 'admin' : p.estado === en)))
    .sort((a, b) => (a.baneado - b.baneado) || orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
  filtros.cuenta('usuarios', lista.length, todos.length);
  const txtEstado = { 'en-linea': 'En línea', ausente: 'Ausente', desconectado: 'Desconectado' };
  el.innerHTML = lista.map(p => {
    const yo = p.clave === auth.usuario?.clave;
    const acciones = [];
    const admin = p.rol === 'admin';
    if (!admin && !p.baneado) acciones.push(`<button class="btn btn-sm" data-usr="ver-perfil" data-clave="${esc(p.clave)}">🧙 Perfil</button>`);
    if (auth.esAdmin() && !yo && !admin) {
      if (p.avatar) acciones.push(`<button class="btn btn-sm" data-usr="quitar-foto" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}" title="Por si alguien sube una foto que no toca">🖼️ Quitar foto</button>`);
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
    if (auth.esDM() && !yo && !admin && (p.rol !== 'dm' || auth.esAdmin()))
      acciones.push(`<button class="btn btn-sm btn-danger" data-usr="sacar" data-clave="${esc(p.clave)}" data-nombre="${esc(p.nombre)}" title="Sale de esta campaña. No se borra nada: si vuelve, lo recupera todo.">🚪 Sacar de la mesa</button>`);
    const rolTxt = admin ? '<span class="usr-rol rol-dm rol-admin">🛡️ Superusuario</span>'
      : p.rol === 'dm' ? '<span class="usr-rol rol-dm">👑 DM</span>' : '<span class="usr-rol rol-jugador">⚔️ Jugador</span>';
    // Oficios: el DM marca a cuáles tiene acceso cada jugador; los demás solo los ven.
    // Los DM y el superusuario los tienen todos.
    const tiene = modulos.listaDisciplinas(p.disciplina);
    const disc = admin ? '' : p.rol === 'dm' ? `<span class="usr-disc">🧰 Todos los oficios</span>` : auth.esDM()
      ? `<details class="usr-disciplinas" data-usr-disc="${esc(p.clave)}">
          <summary title="Oficios a los que tiene acceso">${nombreDisciplina(p.disciplina)} ✏️</summary>
          <div class="usr-disciplinas-caja">
            <span class="muted">Oficios de ${esc(p.nombre)}:</span>
            ${modulos.OFICIOS.map(o => `<label><input type="checkbox" value="${o}" ${tiene.includes(o) ? 'checked' : ''}>
              ${DISCIPLINAS[o].icono} ${DISCIPLINAS[o].nombre}</label>`).join('')}
            <span class="muted">Sin ninguno marcado: sin oficio.</span>
          </div>
        </details>`
      : `<span class="usr-disc">${nombreDisciplina(p.disciplina)}</span>`;
    if (p.baneado) return `<div class="usr-fila usr-desterrado">
      <span class="avatar avatar-grande">🚫</span>
      <div class="usr-info">
        <div class="usr-nombre">${esc(p.nombre)} ${rolTxt} ${disc}</div>
        <div class="usr-estado">Desterrado de la mesa: no puede entrar</div>
      </div>
      <div class="usr-acciones">${acciones.join('')}</div>
    </div>`;
    return `<div class="usr-fila usr-${p.estado}">
      ${avatar.html(p.clave, p.avatar, inicial(p.nombre), `avatar avatar-${p.estado} avatar-grande`)}
      <div class="usr-info">
        <div class="usr-nombre">${esc(p.nombre)}${yo ? ' <span class="muted">(tú)</span>' : ''}
          ${rolTxt} ${disc}</div>
        ${p.personaje ? `<div class="usr-pj">juega con <b>${esc(p.personaje)}</b></div>` : ''}
        <div class="usr-estado"><span class="punto punto-${p.estado}"></span>${txtEstado[p.estado]}
          ${p.estado !== 'desconectado' && p.lugar ? ' · ' + esc(modulos.textoLugar(p.lugar)) : ''}
          ${p.estado === 'desconectado' ? ' · visto ' + haceTxt(p.hace) : ''}</div>
      </div>
      <div class="usr-acciones">${acciones.join('')}</div>
    </div>`;
  }).join('') || (todos.length ? filtros.vacio('usuarios') : '<p class="muted">Todavía no hay nadie más en la mesa.</p>');
}

// ---- Gestión de la campaña (DM) y de las campañas (superusuario) ----
// Se pinta al abrir la sala y tras cada cambio, no en cada sondeo (hay casillas de texto).
export async function cargarGestion() {
  if (!auth.servidor) return;
  if (auth.esDM()) {
    const r = await sync.pedir('/api/cuentas').catch(() => null);
    cuentas = r?.j?.ok ? r.j.cuentas : cuentas;
    pendientes = r?.j?.ok ? (r.j.pendientes || []) : pendientes;
  }
  if (auth.esAdmin()) {
    const r = await sync.pedir('/api/campanas').catch(() => null);
    admin = r?.j?.ok ? r.j : admin;
  }
  renderGestion();
  await cargarHistorial();
}

// ---- Historial de cambios de la campaña ----
// Lo ven el DM y el superusuario. Solo el superusuario puede deshacer, y nadie puede borrarlo.
export async function cargarHistorial(mas = false) {
  if (!auth.servidor || !auth.esDM()) { historial = null; renderHistorial(); return; }
  const antes = mas && historial?.lista.length ? historial.lista[historial.lista.length - 1].id : 0;
  const r = await sync.pedir('/api/historial' + (antes ? '?antes=' + antes : '')).catch(() => null);
  if (!r?.j?.ok) return;
  const lista = mas && historial ? [...historial.lista, ...r.j.historial] : r.j.historial;
  historial = { lista, puedeDeshacer: r.j.puedeDeshacer, fin: r.j.historial.length < 50 };
  renderHistorial();
}

const ICONO_TIPO = { datos: '📦', perfil: '🧙', miembros: '👥', mesa: '🗺️', deshacer: '↩️' };
function renderHistorial() {
  const el = document.getElementById('historialMesa');
  if (!el) return;
  if (!historial) { el.innerHTML = ''; return; }
  const fecha = f => { try { return new Date(f).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return f; } };
  const filas = historial.lista.map(h => `<div class="hist-fila ${h.deshechoPor ? 'hist-deshecho' : ''}">
      <span class="hist-icono">${ICONO_TIPO[h.tipo] || '•'}</span>
      <div class="hist-info">
        <div><b>${esc(h.autor)}</b>: ${esc(h.resumen)}</div>
        <div class="hist-meta">${fecha(h.fecha)}${h.afecta.length ? ` · afecta a ${h.afecta.map(esc).join(', ')}` : ''}${h.deshechoPor ? ' · <b>deshecho</b>' : ''}</div>
      </div>
      ${historial.puedeDeshacer && h.deshacible && !h.deshechoPor ? `<button class="btn btn-sm btn-edit" data-usr="deshacer" data-id="${h.id}" data-resumen="${esc(h.resumen)}" data-autor="${esc(h.autor)}">↩️ Deshacer</button>` : ''}
    </div>`).join('');
  el.innerHTML = `<div class="gestion-caja gestion-historial">
      <h3>📜 Historial de cambios de «${esc(auth.mesa?.nombre || '')}»</h3>
      <p class="muted">Quién cambió qué y cuándo en esta campaña: inventarios, catálogo, parámetros, niveles, libros, perfiles y jugadores.
        Nadie puede borrarlo. ${historial.puedeDeshacer ? 'Como superusuario puedes deshacer un cambio si nadie ha tocado después lo mismo.' : 'Solo el superusuario puede deshacer cambios.'}</p>
      <button class="btn btn-sm" data-usr="hist-recargar">🔄 Actualizar</button>
      <div class="hist-lista">${filas || '<p class="muted">Todavía no hay cambios apuntados.</p>'}</div>
      ${!historial.fin ? '<button class="btn btn-sm" data-usr="hist-mas">Ver más antiguos</button>' : ''}
    </div>`;
}

function renderGestion() {
  const el = document.getElementById('mesaGestion');
  if (el) {
    if (!auth.servidor || !auth.esDM() || !auth.mesa) el.innerHTML = '';
    else {
      const fuera = (cuentas || []).filter(c => !c.enMesa && !c.baneado);
      const fecha = f => { try { return new Date(f).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return f || ''; } };
      el.innerHTML = (pendientes.length ? `<div class="gestion-caja gestion-pendientes">
        <h3>🎮 Cuentas de Discord esperando aprobación</h3>
        <p class="muted">Se han creado la cuenta demostrando con Discord quién son (sin la palabra de paso). Si las apruebas, se sientan
          en «${esc(auth.mesa.nombre)}» como jugadores alquimistas y ya pueden entrar con su nombre y contraseña.
          Si no sabes quién es, recházala (se borra; no tenía nada guardado).</p>
        ${pendientes.map(c => `<div class="usr-fila">
          <span class="avatar avatar-grande">⏳</span>
          <div class="usr-info"><div class="usr-nombre">${esc(c.nombre)}</div>
            <div class="usr-estado">Discord: <b>@${esc(c.discord)}</b> · llegó el ${esc(fecha(c.creado))}</div></div>
          <div class="usr-acciones">
            <button class="btn btn-sm" data-usr="aprobar" data-clave="${esc(c.clave)}" data-nombre="${esc(c.nombre)}">✅ Aprobar y sentar en esta mesa</button>
            <button class="btn btn-sm btn-danger" data-usr="rechazar" data-clave="${esc(c.clave)}" data-nombre="${esc(c.nombre)}">✖️ Rechazar</button>
          </div></div>`).join('')}
      </div>` : '') + `<div class="gestion-caja">
        <h3>📜 Invitar a «${esc(auth.mesa.nombre)}»</h3>
        <p class="muted">Cada campaña tiene su propio catálogo, inventarios, libros y niveles. Quien invites empieza aquí con el inventario vacío y como alquimista; márcale sus oficios en la lista de abajo.</p>
        ${fuera.length ? `<div class="dm-dar">
            <select id="mesaInvitar">${fuera.map(c => `<option value="${esc(c.clave)}">${esc(c.nombre)}</option>`).join('')}</select>
            <button class="btn btn-sm" data-usr="invitar">➕ Invitar a la mesa</button>
          </div>` : '<p class="muted">Todas las cuentas ya están en esta mesa. Quien quiera unirse tiene que crearse una cuenta primero (con la palabra de paso de la mesa, o con Discord y tu aprobación).</p>'}
        <h3>🔑 Contraseña de la mesa</h3>
        <p class="muted">${auth.mesa.conClave
          ? 'Esta mesa <b>tiene contraseña</b>: quien sepa su nombre y la contraseña puede unirse solo, sin invitación (entra como jugador alquimista).'
          : 'Esta mesa <b>no tiene contraseña</b>: solo se entra por invitación. Si le pones una, quien la sepa podrá unirse solo.'}</p>
        <div class="dm-dar">
          <input type="password" id="mesaClaveNueva" maxlength="100" autocomplete="new-password" placeholder="${auth.mesa.conClave ? 'Nueva contraseña' : 'Contraseña (mínimo 4)'}">
          <button class="btn btn-sm" data-usr="clave-mesa">${auth.mesa.conClave ? 'Cambiar' : 'Poner'} contraseña</button>
          ${auth.mesa.conClave ? '<button class="btn btn-sm btn-danger" data-usr="quitar-clave-mesa">Quitar contraseña</button>' : ''}
        </div>
      </div>`;
    }
  }
  const ad = document.getElementById('adminCampanas');
  if (!ad) return;
  if (!auth.esAdmin() || !admin) { ad.innerHTML = ''; return; }
  const optsCuentas = admin.cuentas.filter(c => !c.baneado).map(c => `<option value="${esc(c.clave)}">${esc(c.nombre)}</option>`).join('');
  const filas = admin.campanas.map(c => `<div class="usr-fila">
      <span class="avatar avatar-grande">🗺️</span>
      <div class="usr-info">
        <div class="usr-nombre">${esc(c.nombre)}${auth.mesa?.id === c.id ? ' <span class="muted">(aquí estás)</span>' : ''}</div>
        <div class="usr-estado">${c.jugadores} cuenta${c.jugadores === 1 ? '' : 's'} · DM: ${c.dms.length ? c.dms.map(esc).join(', ') : '<b>sin DM</b>'}</div>
      </div>
      <div class="usr-acciones">
        ${auth.mesa?.id === c.id ? '' : `<button class="btn btn-sm" data-usr="ir-mesa" data-id="${esc(c.id)}">🚪 Entrar</button>`}
        <button class="btn btn-sm btn-edit" data-usr="renombrar" data-id="${esc(c.id)}" data-nombre="${esc(c.nombre)}">✏️ Renombrar</button>
      </div></div>`).join('');
  const desterrados = admin.cuentas.filter(c => c.baneado);
  const bloqueos = admin.bloqueos || [];
  const tiempo = s => s >= 3600 ? `${Math.round(s / 3600)} h` : `${Math.max(1, Math.round(s / 60))} min`;
  ad.innerHTML = `<div class="gestion-caja gestion-admin">
      <h3>🛡️ Campañas</h3>
      <p class="muted">Para nombrar DM o invitar gente a una campaña, entra en ella y usa la lista de abajo. Como superusuario entras en todas con poderes de DM.</p>
      ${filas}
      <div class="dm-dar dm-dar-libro">
        <input type="text" id="campNueva" maxlength="40" placeholder="Nombre de la nueva campaña">
        <select id="campNuevaDM"><option value="">DM: (lo nombro después)</option>${optsCuentas}</select>
        <select id="campNuevaCopia"><option value="">Catálogo vacío</option>${admin.campanas.map(c => `<option value="${esc(c.id)}">Copiar catálogo de «${esc(c.nombre)}»</option>`).join('')}</select>
        <button class="btn btn-sm" data-usr="crear-campana">➕ Crear campaña</button>
      </div>
      ${bloqueos.length ? `<h3>🔒 Creación de cuentas bloqueada</h3>
        <p class="muted">Tras 7 fallos seguidos de la palabra de paso de la mesa, desde ese sitio no se pueden crear cuentas durante 24 h.</p>
        ${bloqueos.map(b => `<div class="usr-fila">
          <span class="avatar avatar-grande">${b.quedan ? '🔒' : '⚠️'}</span>
          <div class="usr-info"><div class="usr-nombre">${esc(b.origen)}</div>
            <div class="usr-estado">${b.quedan ? `Bloqueado · quedan ${tiempo(b.quedan)}` : `${b.fallos} fallo${b.fallos === 1 ? '' : 's'} seguido${b.fallos === 1 ? '' : 's'}`} · último intento hace ${tiempo(b.hace)}</div></div>
          <div class="usr-acciones"><button class="btn btn-sm" data-usr="desbloquear" data-origen="${esc(b.origen)}">🔓 ${b.quedan ? 'Desbloquear' : 'Poner a cero'}</button></div>
        </div>`).join('')}` : ''}
      ${desterrados.length ? `<h3>🚫 Cuentas desterradas</h3>${desterrados.map(c => `<div class="usr-fila usr-desterrado">
          <span class="avatar avatar-grande">🚫</span><div class="usr-info"><div class="usr-nombre">${esc(c.nombre)}</div></div>
          <div class="usr-acciones"><button class="btn btn-sm" data-usr="readmitir" data-clave="${esc(c.clave)}" data-nombre="${esc(c.nombre)}">🕊️ Readmitir</button></div>
        </div>`).join('')}` : ''}
    </div>`;
}

// Acciones de la lista de usuarios (cambiar rol, contraseñas)
export function initUsuarios(verInventario, verPerfil = () => {}) {
  const sala = document.getElementById('tab-usuarios');
  sala?.addEventListener('change', async e => {
    const s = e.target.closest('[data-usr-disc]');
    if (!s) return;
    const disciplinas = [...s.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
    const r = await auth.apiMesa('/api/mesa/disciplina', { usuario: s.dataset.usrDisc, disciplinas });
    if (!r.ok) { alert(r.mensaje); s.open = false; }
    else s.querySelector('summary').innerHTML = `${nombreDisciplina(disciplinas.length ? disciplinas.join(',') : 'desempleado')} ✏️`;
    await sync.refrescar({ presencia: true });
  });
  sala?.addEventListener('click', async e => {
    const b = e.target.closest('[data-usr]');
    if (!b) return;
    const accion = b.dataset.usr;
    if (accion === 'ver-inv') { verInventario(b.dataset.clave); return; }
    if (accion === 'ver-perfil') { verPerfil(b.dataset.clave); return; }
    if (accion === 'clave-mesa' || accion === 'quitar-clave-mesa') {
      const clave = accion === 'quitar-clave-mesa' ? '' : document.getElementById('mesaClaveNueva')?.value || '';
      if (accion === 'clave-mesa' && clave.length < 4) { alert('La contraseña de la mesa debe tener al menos 4 caracteres.'); return; }
      if (accion === 'quitar-clave-mesa' && !confirm('¿Quitar la contraseña? Solo se podrá entrar en la mesa por invitación.')) return;
      const r = await auth.apiMesa('/api/mesa/clave', { clave });
      if (!r.ok) { alert(r.mensaje); return; }
      if (auth.mesa) auth.mesa.conClave = r.conClave;
      alert(r.conClave ? `Contraseña puesta. Quien sepa el nombre de la mesa («${auth.mesa?.nombre}») y esta contraseña podrá unirse desde la pantalla de elegir mesa.` : 'Contraseña quitada.');
      renderGestion();
      return;
    }
    if (accion === 'invitar') {
      const clave = document.getElementById('mesaInvitar')?.value;
      if (!clave) return;
      const r = await auth.apiMesa('/api/mesa/miembro', { usuario: clave, accion: 'invitar' });
      if (!r.ok) alert(r.mensaje);
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'sacar') {
      if (!confirm(`¿Sacar a ${b.dataset.nombre} de «${auth.mesa?.nombre}»? No se borra nada: si le vuelves a invitar, recupera su inventario, sus libros y su nivel.`)) return;
      const r = await auth.apiMesa('/api/mesa/miembro', { usuario: b.dataset.clave, accion: 'quitar' });
      if (!r.ok) alert(r.mensaje);
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'aprobar' || accion === 'rechazar') {
      const si = accion === 'aprobar';
      if (!confirm(si ? `¿Aprobar a ${b.dataset.nombre} y sentarle en «${auth.mesa?.nombre}» como jugador?`
        : `¿Rechazar la cuenta de ${b.dataset.nombre}? Se borra; si se vuelve a crear con Discord, aparecerá otra vez aquí.`)) return;
      const r = await auth.apiMesa('/api/usuarios/aprobar', { usuario: b.dataset.clave, aprobar: si });
      if (!r.ok) alert(r.mensaje);
      else sync.aviso(si ? `${b.dataset.nombre} ya está en la mesa: puede entrar con su nombre y contraseña.` : 'Cuenta rechazada.');
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'ir-mesa') { auth.cambiarMesa(b.dataset.id); return; }
    if (accion === 'hist-recargar') { await cargarHistorial(); return; }
    if (accion === 'hist-mas') { await cargarHistorial(true); return; }
    if (accion === 'deshacer') {
      if (!confirm(`¿Deshacer «${b.dataset.resumen}» (de ${b.dataset.autor})? Se vuelve a poner lo que había antes. También quedará apuntado en el historial.`)) return;
      const r = await auth.apiMesa('/api/historial/deshacer', { id: parseInt(b.dataset.id) });
      if (!r.ok) alert(r.mensaje);
      else sync.aviso('Cambio deshecho.');
      await sync.refrescar({ forzar: true });
      await cargarHistorial();
      return;
    }
    if (accion === 'desbloquear') {
      const r = await auth.apiMesa('/api/registro/desbloquear', { origen: b.dataset.origen });
      if (!r.ok) alert(r.mensaje);
      await cargarGestion();
      return;
    }
    if (accion === 'renombrar') {
      const n = prompt('Nuevo nombre de la campaña:', b.dataset.nombre);
      if (!n?.trim()) return;
      const r = await auth.apiMesa('/api/campanas/renombrar', { campana: b.dataset.id, nombre: n.trim() });
      if (!r.ok) alert(r.mensaje);
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'crear-campana') {
      const nombre = document.getElementById('campNueva')?.value.trim();
      if (!nombre) { alert('Ponle un nombre a la campaña.'); return; }
      const r = await auth.apiMesa('/api/campanas/crear', { nombre, dm: document.getElementById('campNuevaDM')?.value || '',
        copiarDe: document.getElementById('campNuevaCopia')?.value || '' });
      if (!r.ok) { alert(r.mensaje); return; }
      alert(`Campaña «${r.campana.nombre}» creada. Entra en ella desde esta lista para invitar a los jugadores.`);
      await cargarGestion();
      return;
    }
    if (accion === 'rol') {
      const dm = b.dataset.rol === 'dm';
      if (!confirm(dm ? `¿Dar poderes de DM en «${auth.mesa?.nombre}» a ${b.dataset.nombre}? Podrá cambiar el inventario, los libros, el nivel y la disciplina de todos los de esta campaña.` : `¿Quitarle los poderes de DM en «${auth.mesa?.nombre}» a ${b.dataset.nombre}?`)) return;
      const r = await auth.cambiarRol(b.dataset.clave, b.dataset.rol);
      if (!r.ok) alert(r.mensaje);
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'desterrar' || accion === 'readmitir') {
      const ban = accion === 'desterrar';
      if (!confirm(ban ? `¿Desterrar a ${b.dataset.nombre}? Se le cerrará la sesión y no podrá volver a entrar hasta que lo readmitas. Sus datos no se borran.`
        : `¿Readmitir a ${b.dataset.nombre} en la mesa? Podrá volver a entrar con su contraseña.`)) return;
      const r = await auth.desterrar(b.dataset.clave, ban);
      if (!r.ok) alert(r.mensaje);
      await cargarGestion(); await sync.refrescar({ presencia: true });
      return;
    }
    if (accion === 'pass') {
      const n = prompt(`Nueva contraseña para ${b.dataset.nombre} (mínimo 6 caracteres).\nSe le cerrará la sesión y tendrá que entrar con esta.`);
      if (n == null) return;
      const r = await auth.cambiarContrasena({ usuario: b.dataset.clave, nueva: n });
      alert(r.ok ? `Hecho. Dile a ${b.dataset.nombre} su nueva contraseña.` : r.mensaje);
      return;
    }
    if (accion === 'quitar-foto') {
      if (!confirm(`¿Quitar la foto de ${b.dataset.nombre}? Podrá poner otra.`)) return;
      const r = await avatar.quitar(b.dataset.clave);
      if (!r.ok) alert(r.mensaje);
      await sync.refrescar({ presencia: true });
    }
  });
}

// Cambiar la contraseña propia (desde el menú de la cuenta)
export async function cambiarMiContrasena() {
  const actual = prompt('Tu contraseña actual:');
  if (actual == null) return;
  const nueva = prompt('Tu contraseña nueva (mínimo 6 caracteres):');
  if (nueva == null) return;
  if (prompt('Repite la contraseña nueva:') !== nueva) { alert('No coinciden. No se ha cambiado nada.'); return; }
  const r = await auth.cambiarContrasena({ actual, nueva });
  alert(r.ok ? 'Contraseña cambiada.' : r.mensaje);
}

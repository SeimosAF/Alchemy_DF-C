// auth.js — pantalla de entrada: crear cuenta y entrar con usuario y contraseña.
//
// Si la app se abre con servidor.py, antes de nada hay que entrar con una cuenta.
// El servidor devuelve un token de sesión que se guarda en este navegador
// (dura 30 días sin usarse). Sin servidor, la pantalla no aparece y la app
// funciona como siempre, guardando en este navegador.
//
// Después de entrar se elige MESA (campaña). Cada campaña tiene su catálogo,
// sus inventarios, sus libros y sus niveles: no se mezclan. Si la cuenta juega
// en una sola, se entra directamente; si juega en varias, se elige en el
// pergamino. La mesa elegida viaja en cada petición (cabecera X-Campana) y el
// servidor comprueba siempre que la cuenta juega en ella.
//
// V3.6: DISCORD (si el servidor tiene DISCORD_CLIENT_ID y DISCORD_CLIENT_SECRET). Se entra siempre
// con nombre y contraseña; Discord sirve para CREAR la cuenta sin la palabra de paso (queda pendiente
// hasta que la apruebe un DM; una cuenta por cada Discord) y para VINCULARLO desde el Perfil.
// Discord vuelve a la app con #discord=... en la dirección:
//   pendiente&n=NOMBRE  -> cuenta creada: espera a que un DM la apruebe en «En línea»
//   vinculado           -> la cuenta que ya tenía sesión ha quedado vinculada
//   error&m=...&modo=   -> se enseña el mensaje
//
// V3.8: CORREO (si el servidor tiene CORREO_USUARIO y CORREO_CLAVE). Quien olvida la contraseña pide
// un enlace con «¿Olvidaste la contraseña?» y le llega a su correo confirmado. Los enlaces vuelven a la
// app con #recuperar=TOKEN (elegir contraseña nueva) o #verificar=TOKEN (confirmar el correo). El token
// va detrás de «#» para que no salga del navegador, y se borra de la dirección nada más leerlo.

const K_SESION = 'alquimiaSesion';
const K_ELEGIR = 'alquimiaElegirMesa';            // sessionStorage: "enséñame el pergamino de mesas"
const kMesa = () => 'alquimiaMesa:' + (usuario?.clave || '-');   // la última mesa de cada cuenta

// { clave, nombre, rol: 'admin' | 'dm' | 'jugador', disciplina }. El rol (DM o jugador) es el de la mesa elegida.
export let usuario = null;
export let servidor = false;    // ¿hay servidor con cuentas?
export let mesa = null;         // { id, nombre, rol, disciplina } la campaña en la que se está jugando
export let campanas = [];       // las campañas de esta cuenta
let otras = [];                 // V3.7: campañas en las que no juega (para el selector)
export let puedeCrear = false;  // ¿puede crear campañas? (el superusuario)
let puedeSolicitar = false;     // V3.8: ¿puede pedir una campaña al superusuario?
let solicitud = null;           // su solicitud de campaña: pendiente, o la última resuelta (7 días)
let info = {};
export let mensajeDiscord = null;   // { texto, tipo } para enseñar al arrancar la app (vinculado, error...)

const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };

export function token() { return lsGet(K_SESION); }
export function cabeceras() {
  const t = token();
  return { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(mesa ? { 'X-Campana': mesa.id } : {}) };
}
// El superusuario «DM» (rol 'admin') puede todo lo que puede un DM, y además desterrar y dar/quitar DM.
export const esDM = () => usuario?.rol === 'dm' || usuario?.rol === 'admin';
export const esAdmin = () => usuario?.rol === 'admin';

async function api(ruta, cuerpo, conToken = false) {
  const headers = { 'Content-Type': 'application/json', ...(conToken ? cabeceras() : {}) };
  const opciones = cuerpo === undefined ? { headers, cache: 'no-store' }
    : { method: 'POST', headers, body: JSON.stringify(cuerpo), cache: 'no-store' };
  const r = await fetch(ruta, opciones);
  let j = null;
  try { j = await r.json(); } catch (_) {}
  return { status: r.status, j };
}

// Con timeout: si no hay servidor (p. ej. npx http-server), no hay que esperar mucho.
async function pedirInfo() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch('/api/info', { cache: 'no-store', signal: ctrl.signal });
    if (r.status === 401) return { antiguo: true };   // servidor antiguo con contraseña global
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.ok && !j.cuentas) return { antiguo: true };   // servidor.py de antes de las cuentas
    return j?.ok && j.cuentas ? j : null;
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

// Lo que trae la dirección al volver de Discord (y se borra de la barra de direcciones)
function leerVueltaCorreo() {
  const m = /^#(recuperar|verificar|alta)=([A-Za-z0-9_\-]{20,100})$/.exec(location.hash);
  if (!m) return null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { location.hash = ''; }
  return { tipo: m[1], token: m[2] };
}

function leerVueltaDiscord() {
  if (!location.hash.startsWith('#discord=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
  return { estado: p.get('discord'), nombre: p.get('n'), mensaje: p.get('m'), modo: p.get('modo') };
}

// Ir a Discord: modo 'crear' (con nombre y contraseña, sin sesión) o 'vincular' (con sesión, desde el Perfil)
export async function empezarDiscord(modo, datos = {}) {
  const r = await api('/api/discord/empezar', { ...datos, modo, origen: location.origin }, modo === 'vincular')
    .catch(() => ({ j: { mensaje: 'No se puede hablar con el servidor. ¿Está encendido?' } }));
  if (!r.j?.ok || !r.j.url) return r.j?.mensaje || 'No se pudo ir a Discord.';
  location.href = r.j.url;
  return null;
}

// Poner, cambiar o quitar el correo de la cuenta (pide la contraseña actual)
export async function ponerCorreo(correo, contrasena) {
  const r = await api('/api/yo/correo', { correo, contrasena }, true).catch(() => ({ j: null }));
  if (r.j?.ok && usuario) {   // solo se refresca el correo (el papel en la mesa no se toca)
    const y = await api('/api/yo', undefined, true).catch(() => null);
    if (y?.j?.usuario) usuario.correo = y.j.usuario.correo;
  }
  return r.j || { ok: false, mensaje: 'No se puede hablar con el servidor.' };
}

export async function desvincularDiscord() {
  const r = await api('/api/discord/desvincular', {}, true).catch(() => null);
  if (r?.j?.ok && usuario) usuario.discord = { vinculado: false, nombre: '' };
  return r?.j || { ok: false, mensaje: 'No hay conexión con el servidor.' };
}

// Resuelve cuando ya se puede arrancar la app: con cuenta (servidor) o sin servidor (local).
export async function iniciar() {
  const pantalla = document.getElementById('pantallaEntrada');
  const vuelta = leerVueltaDiscord();
  const enlace = leerVueltaCorreo();
  info = await pedirInfo();
  if (info?.antiguo) {
    document.body.classList.remove('sin-sesion');
    document.body.classList.add('servidor-antiguo');
    pantalla?.remove();
    document.body.insertAdjacentHTML('afterbegin', `<div class="aviso-antiguo">⚠️ <strong>El servidor que está en marcha es la versión antigua</strong> (sin cuentas).
      Si usas Docker, ejecuta <code>docker-iniciar.bat</code> para reconstruirlo. Si usas <code>iniciar.bat</code>, cierra su ventana y vuelve a abrirlo.
      Luego recarga esta página con Ctrl+F5.</div>`);
    servidor = false;
    info = null;
    return new Promise(() => {});   // no arranca la app contra un servidor que no la entiende
  }
  if (!info) {                       // sin servidor: como siempre
    servidor = false;
    pantalla?.remove();
    document.body.classList.remove('sin-sesion');
    return { modo: 'local' };
  }
  servidor = true;
  let avisoEntrada = null;   // lo que se enseña en el pergamino (cuenta pendiente, error de Discord)
  if (vuelta?.estado === 'creada') {   // V3.9: con Discord la cuenta ya está creada
    avisoEntrada = { modo: 'entrar', nombre: vuelta.nombre || '',
      nota: `🎉 Cuenta <strong>${escH(vuelta.nombre || '')}</strong> creada con Discord. Entra con tu nombre y tu contraseña.` };
  } else if (vuelta?.estado === 'pendiente') {
    avisoEntrada = { modo: 'entrar', nombre: vuelta.nombre || '',
      nota: `⏳ Cuenta <strong>${escH(vuelta.nombre || '')}</strong> creada con Discord. <strong>Tiene que aprobarla el DM</strong>:
      avísale, y cuando lo haga entra aquí con tu nombre y tu contraseña.` };
  } else if (vuelta?.estado === 'vinculado') {
    mensajeDiscord = { texto: '🎮 Discord vinculado a tu cuenta.', tipo: 'info' };
  } else if (vuelta?.estado === 'error') {
    if (vuelta.modo === 'vincular') mensajeDiscord = { texto: vuelta.mensaje || 'No se pudo vincular Discord.', tipo: 'error' };
    else avisoEntrada = { modo: 'crear', error: vuelta.mensaje || 'No se pudo crear la cuenta con Discord.' };
  }
  if (enlace?.tipo === 'recuperar') {
    // Elegir contraseña nueva. Al cambiarla se cierran todas las sesiones de la cuenta, también esta.
    await mostrarPantalla(pantalla, false, { modo: 'nueva', token: enlace.token });
    return { modo: 'servidor', recienEntrado: true };
  }
  if (enlace?.tipo === 'alta') {   // V3.9: el enlace del correo termina de crear la cuenta y entra con ella
    const r = await api('/api/registro/confirmar', { token: enlace.token }).catch(() => ({ j: null }));
    if (r.j?.ok) {
      lsSet(K_SESION, r.j.token);
      mensajeDiscord = { texto: `🎉 Cuenta ${r.j.usuario?.nombre || ''} creada y correo confirmado. ¡Bienvenido a la taberna!`, tipo: 'info' };
    } else avisoEntrada = { modo: 'crear', error: r.j?.mensaje || 'No se pudo crear la cuenta.' };
  }
  if (enlace?.tipo === 'verificar') {
    const r = await api('/api/correo/verificar', { token: enlace.token }).catch(() => ({ j: null }));
    const texto = r.j?.ok ? `📧 Correo ${r.j.correo} confirmado. Si olvidas la contraseña, podrás cambiarla con él.`
      : (r.j?.mensaje || 'No se pudo confirmar el correo.');
    if (token()) mensajeDiscord = { texto, tipo: r.j?.ok ? 'info' : 'error' };
    else avisoEntrada = { modo: 'entrar', nota: escH(texto) };
  }
  if (token()) {
    try {
      if (await cargarYo()) {
        const c = mesaSinPreguntar();
        if (c) {
          ponerMesa(c);
          pantalla?.remove();
          document.body.classList.remove('sin-sesion');
          return { modo: 'servidor' };
        }
        await mostrarPantalla(pantalla, true);   // hay que elegir mesa
        return { modo: 'servidor' };
      }
    } catch (_) {}
    if (!usuario) lsSet(K_SESION, null);
  }
  await mostrarPantalla(pantalla, false, avisoEntrada);
  return { modo: 'servidor', recienEntrado: true };
}

const escH = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Quién soy y en qué campañas juego
async function cargarYo() {
  const r = await api('/api/yo', undefined, true);
  if (r.status !== 200 || !r.j?.usuario) return false;
  usuario = r.j.usuario;
  campanas = r.j.campanas || [];
  otras = r.j.otras || [];
  puedeCrear = !!r.j.puedeCrear;
  puedeSolicitar = !!r.j.puedeSolicitar && !puedeCrear;
  solicitud = r.j.solicitud || null;
  return true;
}

// La mesa a la que se entra sin preguntar: la última que usó (si sigue en ella) o la única que tiene
function mesaSinPreguntar() {
  let forzar = false;
  try { forzar = sessionStorage.getItem(K_ELEGIR) === '1'; sessionStorage.removeItem(K_ELEGIR); } catch (_) {}
  if (forzar) return null;
  const ultima = campanas.find(c => c.id === lsGet(kMesa()));
  return ultima || (campanas.length === 1 ? campanas[0] : null);
}

function ponerMesa(c) {
  mesa = { id: c.id, nombre: c.nombre, rol: c.rol, disciplina: c.disciplina || 'alquimista' };
  usuario.rol = usuario.rol === 'admin' ? 'admin' : c.rol;
  usuario.disciplina = mesa.disciplina;
  lsSet(kMesa(), c.id);
}

// Lo que dice el servidor en cada sondeo (le han hecho DM, le han cambiado la disciplina...)
export function actualizarDesdeServidor(u) {
  if (!u || !usuario || !mesa) return false;
  const pj = JSON.stringify(u.personaje || null);
  const cambia = u.rol !== usuario.rol || (u.disciplina || 'alquimista') !== usuario.disciplina || (u.mesa && u.mesa !== mesa.nombre)
    || pj !== JSON.stringify(usuario.personaje || null) || !!u.conClave !== !!mesa.conClave || (u.acceso || '') !== (mesa.acceso || '');
  usuario.rol = u.rol;
  usuario.disciplina = mesa.disciplina = u.disciplina || 'alquimista';
  usuario.personaje = u.personaje || null;   // su personaje en esta campaña (perfil.js)
  if (u.mesa) mesa.nombre = u.mesa;
  mesa.rol = u.rol;
  mesa.conClave = !!u.conClave;               // ¿la mesa tiene contraseña para unirse?
  mesa.acceso = u.acceso || (u.conClave ? 'clave' : 'invitacion');   // abierta | clave | invitacion
  return cambia;
}

// Volver al pergamino para elegir otra mesa
export function cambiarMesa(id) {
  if (id) lsSet(kMesa(), id);
  else try { sessionStorage.setItem(K_ELEGIR, '1'); } catch (_) {}
  location.reload();
}

// El servidor dice que ya no juega en esta mesa (le han sacado, o la campaña no existe)
let fuera = false;
export function fueraDeMesa(mensaje) {
  if (fuera) return;
  fuera = true;
  lsSet(kMesa(), null);
  alert((mensaje || 'Ya no estás en esta campaña.') + '\n\nVuelve a elegir mesa.');
  location.reload();
}

const NOMBRE_DISC = { alquimista: '⚗️ Alquimista', cocinero: '🍲 Cocinero', hechicero: '✨ Hechicero', herrero: '⚒️ Herrero', desempleado: '🪑 Desempleado', pluriempleado: '🧰 Pluriempleado' };

// El pergamino cambia el formulario de entrada por la lista de mesas. Resuelve con la mesa elegida.
function elegirMesa(pantalla) {
  return new Promise(resolve => {
    const hoja = pantalla.querySelector('.pergamino-hoja');
    hoja.querySelector('.entrada-pestanas')?.setAttribute('hidden', '');
    hoja.querySelector('#entradaForm')?.setAttribute('hidden', '');
    hoja.querySelector('#entradaDiscord')?.setAttribute('hidden', '');
    hoja.querySelector('#entradaUsarClave')?.setAttribute('hidden', '');
    let caja = hoja.querySelector('.entrada-mesas');
    if (!caja) { caja = document.createElement('div'); caja.className = 'entrada-mesas'; hoja.appendChild(caja); }
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let busca = '', abierta = null;   // texto del buscador y la mesa con candado que pide contraseña
    const normal = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    function pintar(error = '') {
      const coincide = c => !busca || normal(c.nombre).includes(normal(busca));
      const mias = campanas.filter(coincide), ajenas = otras.filter(coincide);
      const lista = mias.map(c => `<button type="button" class="mesa-opcion" data-mesa="${esc(c.id)}">
          <span class="mesa-opcion-nombre">${esc(c.nombre)}</span>
          <span class="mesa-opcion-rol">${c.rol === 'admin' ? '🛡️ Superusuario' : c.rol === 'dm' ? '👑 DM' : '⚔️ Jugador'}
            ${c.rol === 'jugador' ? ' · ' + esc(NOMBRE_DISC[c.disciplina] || String(c.disciplina || '').split(',').map(d => NOMBRE_DISC[d] || '').join(' · ')) : ''}</span>
        </button>`).join('') + ajenas.map(c => c.acceso === 'abierta' ? `
        <button type="button" class="mesa-opcion mesa-abierta" data-mesa-abierta="${esc(c.id)}" data-nombre="${esc(c.nombre)}">
          <span class="mesa-opcion-nombre">${esc(c.nombre)}</span>
          <span class="mesa-opcion-rol">Abierta · pulsa para unirte</span>
        </button>` : c.acceso === 'clave' || (!c.acceso && c.conClave) ? `
        <div class="mesa-opcion mesa-ajena ${abierta === c.id ? 'abierta' : ''}">
          <button type="button" class="mesa-ajena-boton" data-mesa-candado="${esc(c.id)}">
            <span class="mesa-opcion-nombre">🔒 ${esc(c.nombre)}</span>
            <span class="mesa-opcion-rol">Con contraseña · pulsa para unirte</span></button>
          ${abierta === c.id ? `<form class="mesa-candado" data-mesa-unir="${esc(c.id)}">
              <input type="password" maxlength="100" autocomplete="off" placeholder="Contraseña de la mesa" aria-label="Contraseña de ${esc(c.nombre)}">
              <button type="submit" class="btn btn-sm">🔓 Entrar</button></form>` : ''}
        </div>` : `
        <div class="mesa-opcion mesa-ajena mesa-cerrada" title="El DM tiene que invitarte">
          <span class="mesa-opcion-nombre">✉️ ${esc(c.nombre)}</span>
          <span class="mesa-opcion-rol">Solo por invitación del DM</span>
        </div>`).join('');
      const total = campanas.length + otras.length;
      caja.innerHTML = `
        <p class="entrada-nota">${campanas.length
          ? `Bienvenido, <strong>${esc(usuario.nombre)}</strong>. ¿A qué mesa te sientas hoy?`
          : `<strong>${esc(usuario.nombre)}</strong>, todavía no te has sentado en ninguna mesa.<br>
             ${puedeCrear ? 'Crea la primera campaña aquí abajo.' : `Únete a una mesa abierta de la lista, entra en una con candado con su contraseña o pide al DM que te invite (dile tu nombre, <strong>${esc(usuario.nombre)}</strong>).${puedeSolicitar ? ' También puedes pedir una campaña propia.' : ''}`}`}</p>
        ${total ? `<input type="search" class="mesa-buscar" placeholder="🔍 Buscar campaña" value="${esc(busca)}" aria-label="Buscar campaña">` : ''}
        <div class="mesa-opciones">${lista || (busca ? '<p class="muted">Ninguna campaña se llama así.</p>' : '')}</div>
        ${!puedeCrear && !otras.length ? `<details class="mesa-unirse" ${campanas.length ? '' : 'open'}>
            <summary>🔑 Unirme a una mesa con su contraseña</summary>
            <form class="mesa-crear" id="mesaUnirseForm">
              <label class="entrada-campo"><span>Nombre de la mesa</span><input type="text" id="mesaUnirseNombre" maxlength="40"></label>
              <label class="entrada-campo"><span>Contraseña de la mesa</span><input type="password" id="mesaUnirseClave" maxlength="100" autocomplete="off"></label>
              <button type="submit" class="btn btn-sm">Unirme</button>
            </form>
          </details>` : ''}
        ${puedeSolicitar ? cajaSolicitud() : ''}
        ${puedeCrear ? `<form class="mesa-crear" id="mesaCrearForm">
            <label class="entrada-campo"><span>Nueva campaña</span>
              <input type="text" id="mesaCrearNombre" maxlength="40" placeholder="Nombre de la campaña"></label>
            <button type="submit" class="btn btn-sm">➕ Crear campaña</button>
          </form>` : ''}
        <p class="entrada-error" role="alert">${esc(error)}</p>
        <div class="mesa-pie">
          ${!campanas.length && !puedeCrear ? '<button type="button" class="mesa-enlace" data-mesa-accion="mirar">🔄 Volver a mirar</button>' : ''}
          <button type="button" class="mesa-enlace" data-mesa-accion="salir">🚪 Cerrar sesión</button>
        </div>`;
    }
    // V3.8: pedir una campaña propia al superusuario (solo una solicitud a la vez)
    function cajaSolicitud() {
      const s = solicitud;
      const fecha = f => { try { return new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }); } catch (_) { return ''; } };
      if (s?.estado === 'pendiente') return `<div class="mesa-solicitud mesa-solicitud-pendiente">
          ⏳ Has pedido la campaña <strong>${esc(s.nombre)}</strong> (${esc(fecha(s.creada))}). Espera a que el superusuario la apruebe:
          cuando lo haga aparecerá en esta lista y tú serás su DM.
          <button type="button" class="mesa-enlace" data-mesa-accion="cancelar-solicitud">✖️ Cancelar la solicitud</button></div>`;
      const aviso = s?.estado === 'rechazada'
        ? `<div class="mesa-solicitud mesa-solicitud-rechazada">❌ El superusuario no aprobó <strong>${esc(s.nombre)}</strong>.${s.nota ? ` Motivo: ${esc(s.nota)}` : ''}</div>`
        : s?.estado === 'aprobada' ? `<div class="mesa-solicitud">✅ Tu campaña <strong>${esc(s.nombre)}</strong> está aprobada: eres su DM.</div>` : '';
      return aviso + `<details class="mesa-unirse mesa-pedir">
          <summary>📜 Pedir una campaña nueva</summary>
          <form class="mesa-crear" id="mesaPedirForm">
            <label class="entrada-campo"><span>Nombre de la campaña</span><input type="text" id="mesaPedirNombre" maxlength="40"></label>
            <label class="entrada-campo"><span>Para qué es <small>(opcional)</small></span><input type="text" id="mesaPedirMotivo" maxlength="300" placeholder="Ej.: campaña de los jueves con mis amigos"></label>
            <button type="submit" class="btn btn-sm">📨 Mandar la solicitud</button>
            <p class="muted">La aprueba el superusuario. Serás el DM. Solo puedes tener una solicitud a la vez.</p>
          </form>
        </details>`;
    }
    pintar();
    caja.oninput = e => {
      if (!e.target.matches('.mesa-buscar')) return;
      busca = e.target.value;
      pintar();
      const q = caja.querySelector('.mesa-buscar');
      q.focus(); q.setSelectionRange(busca.length, busca.length);
    };
    caja.onclick = async e => {
      const cand = e.target.closest('[data-mesa-candado]');
      if (cand) {   // mesa con candado: pide la contraseña ahí mismo
        abierta = abierta === cand.dataset.mesaCandado ? null : cand.dataset.mesaCandado;
        pintar();
        caja.querySelector('.mesa-candado input')?.focus();
        return;
      }
      const ab = e.target.closest('[data-mesa-abierta]');
      if (ab) {   // mesa abierta: se entra directamente, sin contraseña ni invitación
        if (ab.disabled) return;
        ab.disabled = true;
        const r = await api('/api/campanas/unirse', { id: ab.dataset.mesaAbierta }, true).catch(() => ({ j: null }));
        if (!r.j?.ok) { try { await cargarYo(); } catch (_) {} return pintar(r.j?.mensaje || 'No se pudo entrar en la mesa.'); }
        try { await cargarYo(); } catch (_) {}
        caja.onclick = null;
        return resolve(campanas.find(c => c.id === r.j.campana.id) || r.j.campana);
      }
      const b = e.target.closest('[data-mesa], [data-mesa-accion]');
      if (!b) return;
      if (b.dataset.mesa) {
        const c = campanas.find(x => x.id === b.dataset.mesa);
        if (c) { caja.onclick = null; resolve(c); }
        return;
      }
      if (b.dataset.mesaAccion === 'salir') return salir();
      if (b.dataset.mesaAccion === 'cancelar-solicitud') {
        if (!confirm(`¿Cancelar la solicitud de «${solicitud?.nombre}»?`)) return;
        const r = await api('/api/campanas/solicitud/cancelar', {}, true).catch(() => ({ j: null }));
        try { await cargarYo(); } catch (_) {}
        return pintar(r.j?.ok ? '' : (r.j?.mensaje || 'No se pudo cancelar.'));
      }
      if (b.dataset.mesaAccion === 'mirar') {   // también trae la campaña si el superusuario ya la aprobó
        try { await cargarYo(); } catch (_) {}
        pintar(campanas.length ? '' : 'Todavía nadie te ha invitado.');
      }
    };
    caja.onsubmit = async e => {
      e.preventDefault();
      if (e.target.dataset.mesaUnir) {   // unirse a una mesa con candado desde la lista
        const r = await api('/api/campanas/unirse', { id: e.target.dataset.mesaUnir,
          clave: e.target.querySelector('input').value }, true).catch(() => ({ j: null }));
        if (!r.j?.ok) return pintar(r.j?.mensaje || 'No se pudo entrar en la mesa.');
        try { await cargarYo(); } catch (_) {}
        caja.onclick = null;
        return resolve(campanas.find(c => c.id === r.j.campana.id) || r.j.campana);
      }
      if (e.target.id === 'mesaUnirseForm') {   // unirse con la contraseña de la mesa
        const r = await api('/api/campanas/unirse', { nombre: caja.querySelector('#mesaUnirseNombre').value,
          clave: caja.querySelector('#mesaUnirseClave').value }, true).catch(() => ({ j: null }));
        if (!r.j?.ok) return pintar(r.j?.mensaje || 'No se pudo entrar en la mesa.');
        try { await cargarYo(); } catch (_) {}
        caja.onclick = null;
        return resolve(campanas.find(c => c.id === r.j.campana.id) || r.j.campana);
      }
      if (e.target.id === 'mesaPedirForm') {   // pedir una campaña al superusuario
        const nombre = caja.querySelector('#mesaPedirNombre').value.trim();
        if (!nombre) return pintar('Ponle un nombre a la campaña.');
        const r = await api('/api/campanas/solicitar', { nombre, motivo: caja.querySelector('#mesaPedirMotivo').value }, true).catch(() => ({ j: null }));
        if (!r.j?.ok) return pintar(r.j?.mensaje || 'No se pudo mandar la solicitud.');
        solicitud = r.j.solicitud;
        return pintar();
      }
      const nombre = caja.querySelector('#mesaCrearNombre')?.value.trim();
      if (!nombre) return pintar('Ponle un nombre a la campaña.');
      const r = await api('/api/campanas/crear', { nombre }, true).catch(() => ({ j: null }));
      if (!r.j?.ok) return pintar(r.j?.mensaje || 'No se pudo crear la campaña.');
      try { await cargarYo(); } catch (_) {}
      pintar();
    };
  });
}

function mostrarPantalla(pantalla, soloMesa = false, aviso = null) {
  return new Promise(resolve => {
    document.body.classList.add('sin-sesion');
    pantalla.classList.add('visible');
    if (soloMesa) {   // ya ha entrado: solo falta elegir mesa
      const elegida = elegirMesa(pantalla);
      pantalla.style.setProperty('--media-hoja', (pantalla.querySelector('.pergamino-hoja').offsetHeight / 2) + 'px');
      pantalla.classList.add('desenrollar');
      elegida.then(c => sellar(pantalla, c, resolve));
      return;
    }
    // Mide el pergamino para que los rodillos se separen justo lo que mide al desenrollarse
    const hoja = pantalla.querySelector('.pergamino-hoja');
    pantalla.style.setProperty('--media-hoja', (hoja.offsetHeight / 2) + 'px');
    pantalla.classList.add('desenrollar');
    const form = pantalla.querySelector('#entradaForm');
    const error = pantalla.querySelector('#entradaError');
    const nombre = pantalla.querySelector('#entradaNombre');
    const pass = pantalla.querySelector('#entradaPass');
    const pass2 = pantalla.querySelector('#entradaPass2');
    const claveMesa = pantalla.querySelector('#entradaClave');
    const correo = pantalla.querySelector('#entradaCorreo');
    const olvido = pantalla.querySelector('#entradaOlvido');
    const filaNombre = nombre.closest('label'), filaPass = pass.closest('label');
    const tokenNueva = aviso?.token || '';
    const boton = pantalla.querySelector('#entradaBoton');
    const nota = pantalla.querySelector('#entradaNota');
    let modo = aviso?.modo || (info.hayUsuarios ? 'entrar' : 'crear');
    const cajaDiscord = pantalla.querySelector('#entradaDiscord');
    // V3.9: con correo o Discord en el servidor, la cuenta se crea con uno de los dos. La palabra de paso
    // de la mesa queda como opción escondida («por si acaso»), debajo.
    const verificacion = !!(info.correo || info.discord);
    const conDiscord = !!(cajaDiscord && info.discord && info.hayUsuarios);
    const botonClave = pantalla.querySelector('#entradaUsarClave');
    let usarClave = false;

    function pintarModo() {
      pantalla.dataset.modo = modo;
      pantalla.querySelectorAll('[data-entrada-modo]').forEach(b =>
        b.classList.toggle('activo', b.dataset.entradaModo === modo));
      const nuevaPass = modo === 'crear' || modo === 'nueva';
      filaNombre.hidden = modo === 'nueva';
      filaNombre.querySelector('span').textContent = modo === 'olvido' ? 'Nombre o correo' : 'Nombre';
      nombre.maxLength = modo === 'olvido' ? 254 : 24;
      nombre.autocomplete = modo === 'olvido' ? 'email' : 'username';
      filaPass.hidden = modo === 'olvido';
      filaPass.querySelector('span').textContent = modo === 'nueva' ? 'Contraseña nueva' : 'Contraseña';
      pantalla.querySelector('#filaPass2').hidden = !nuevaPass;
      const conClave = verificacion ? usarClave : info.pideClave;
      pantalla.querySelector('#filaClave').hidden = !(modo === 'crear' && conClave);
      pantalla.querySelector('#filaCorreo').hidden = !(modo === 'crear' && info.correo && !usarClave);
      if (botonClave) {
        botonClave.hidden = !(modo === 'crear' && verificacion && info.pideClave);
        botonClave.textContent = usarClave ? '← Crear con correo o Discord' : '¿Tienes la palabra de paso de la mesa?';
      }
      olvido.hidden = !(modo === 'entrar' && info.correo);
      if (cajaDiscord) cajaDiscord.hidden = !(conDiscord && modo === 'crear' && !usarClave);
      pass.autocomplete = nuevaPass ? 'new-password' : 'current-password';
      boton.querySelector('span').textContent = { crear: 'Inscribir mi nombre', olvido: 'Mandarme el enlace',
        nueva: 'Guardar la contraseña' }[modo] || 'Cruzar el umbral';
      error.textContent = '';
      if (modo === 'olvido' || modo === 'nueva') {
        nota.innerHTML = modo === 'olvido'
          ? 'Escribe tu nombre de usuario o tu correo y te mandaremos un enlace para elegir una contraseña nueva. '
            + 'Solo llega si tu cuenta tiene el correo confirmado; si no, pide al DM que te ponga una.'
            + '<br><button type="button" class="entrada-olvido" data-volver-entrar>← Volver a entrar</button>'
          : 'Elige tu contraseña nueva (mínimo 6 caracteres). Al guardarla se cerrarán todas las sesiones abiertas de tu cuenta.';
        return;
      }
      const notaCrear = !info.hayUsuarios ? '👑 Eres el primero en llegar: <strong>tu cuenta será la del DM</strong>, el señor de la mesa.'
        : usarClave || !verificacion
          ? 'Tu nombre quedará escrito en el libro de la mesa.' + (info.pideClave ? ' La <strong>palabra de paso</strong> te la da el DM.' : '')
          : info.correo
            ? 'Escribe tu correo y te mandaremos un enlace para terminar de crear la cuenta'
              + (conDiscord ? ', o rellena nombre y contraseña y usa <strong>Crear con Discord</strong>.' : '.')
            : 'Rellena nombre y contraseña y usa <strong>Crear con Discord</strong>.';
      nota.innerHTML = modo === 'crear' ? notaCrear : 'Escribe el nombre y la contraseña de tu cuenta.';
    }
    olvido.addEventListener('click', () => { modo = 'olvido'; pintarModo(); nombre.focus(); });
    botonClave?.addEventListener('click', () => { usarClave = !usarClave; pintarModo(); (usarClave ? claveMesa : correo).focus(); });
    nota.addEventListener('click', e => {
      if (e.target.closest('[data-volver-entrar]')) { modo = 'entrar'; pintarModo(); nombre.focus(); }
    });
    pintarModo();
    if (aviso?.nombre) nombre.value = aviso.nombre;
    if (aviso?.nota) nota.innerHTML = aviso.nota;
    if (aviso?.error) error.textContent = aviso.error;
    // «Crear con Discord»: en lugar de la palabra de paso (solo si el servidor tiene Discord configurado)
    if (conDiscord) cajaDiscord.querySelector('button').addEventListener('click', async () => {
      if (!nombre.value.trim()) return fallo('Escribe el nombre de tu cuenta.');
      if (pass.value.length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
      if (pass.value !== pass2.value) return fallo('Las dos contraseñas no coinciden.');
      pantalla.classList.add('ocupada');
      const m = await empezarDiscord('crear', { nombre: nombre.value, contrasena: pass.value });
      if (m) { pantalla.classList.remove('ocupada'); fallo(m); }
    });
    pantalla.querySelectorAll('[data-entrada-modo]').forEach(b => b.addEventListener('click', () => {
      modo = b.dataset.entradaModo; pintarModo(); nombre.focus();
    }));
    setTimeout(() => (modo === 'nueva' ? pass : nombre).focus(), 600);

    function fallo(msg) {
      error.textContent = msg;
      form.classList.remove('temblor');
      void form.offsetWidth;   // reinicia la animación
      form.classList.add('temblor');
    }

    // Pedir el enlace (la respuesta es siempre la misma, exista la cuenta o no)
    async function pedirEnlace() {
      if (!nombre.value.trim()) return fallo('Escribe tu nombre de usuario o tu correo.');
      boton.disabled = true;
      pantalla.classList.add('ocupada');
      const r = await api('/api/recuperar', { quien: nombre.value }).catch(() => ({ j: { mensaje: 'No se puede hablar con el servidor. ¿Está encendido?' } }));
      boton.disabled = false;
      pantalla.classList.remove('ocupada');
      if (!r.j?.ok) return fallo(r.j?.mensaje || 'Algo ha fallado. Vuelve a probar.');
      modo = 'entrar'; pintarModo();
      nombre.value = '';
      nota.innerHTML = '📜 ' + escH(r.j.mensaje);
    }
    // Guardar la contraseña nueva con el enlace del correo
    async function guardarNueva() {
      if (pass.value.length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
      if (pass.value !== pass2.value) return fallo('Las dos contraseñas no coinciden.');
      boton.disabled = true;
      pantalla.classList.add('ocupada');
      const r = await api('/api/recuperar/nueva', { token: tokenNueva, nueva: pass.value }).catch(() => ({ j: { mensaje: 'No se puede hablar con el servidor. ¿Está encendido?' } }));
      boton.disabled = false;
      pantalla.classList.remove('ocupada');
      if (!r.j?.ok) {
        if (r.j?.motivo !== 'enlace') return fallo(r.j?.mensaje || 'Algo ha fallado. Vuelve a probar.');
        modo = 'entrar'; pintarModo(); pass.value = pass2.value = '';
        return fallo(r.j.mensaje);
      }
      lsSet(K_SESION, null);
      modo = 'entrar'; pintarModo();
      pass.value = pass2.value = '';
      nombre.value = r.j.nombre || '';
      nota.innerHTML = '🔑 Contraseña cambiada. Ya puedes entrar con ella.';
      pass.focus();
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (modo === 'olvido') return pedirEnlace();
      if (modo === 'nueva') return guardarNueva();
      if (!nombre.value.trim()) return fallo('Escribe tu nombre.');
      if (!pass.value) return fallo('Escribe tu contraseña.');
      if (modo === 'crear' && pass.value.length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
      if (modo === 'crear' && pass.value !== pass2.value) return fallo('Las dos contraseñas no coinciden.');
      const porCorreo = modo === 'crear' && verificacion && !usarClave;
      if (porCorreo && !info.correo) return fallo('Usa «Crear con Discord».');
      if (porCorreo && !correo.value.trim()) return fallo('Escribe tu correo' + (conDiscord ? ' o usa «Crear con Discord».' : '.'));
      if (modo === 'crear' && verificacion && usarClave && !claveMesa.value) return fallo('Escribe la palabra de paso de la mesa.');
      boton.disabled = true;
      pantalla.classList.add('ocupada');
      let r;
      try {
        r = await api(modo === 'crear' ? '/api/registro' : '/api/entrar', {
          nombre: nombre.value, contrasena: pass.value,
          ...(modo !== 'crear' || !porCorreo ? { clave: claveMesa.value } : {}),
          ...(porCorreo ? { correo: correo.value.trim() } : {}),
        });
      } catch (_) {
        r = { status: 0, j: { mensaje: 'No se puede hablar con el servidor. ¿Está encendido?' } };
      }
      boton.disabled = false;
      pantalla.classList.remove('ocupada');
      if (r.status !== 200 || !r.j?.ok) return fallo(r.j?.mensaje || 'Algo ha fallado. Vuelve a probar.');
      if (r.j.alta) {   // con correo: la cuenta se termina de crear desde el enlace que le llega
        const n = nombre.value;
        modo = 'entrar'; pintarModo();
        nombre.value = n; pass.value = pass2.value = correo.value = '';
        nota.innerHTML = '📜 ' + escH(r.j.mensaje);
        return;
      }
      lsSet(K_SESION, r.j.token);
      usuario = r.j.usuario;
      campanas = r.j.campanas || [];
      pass.value = pass2.value = claveMesa.value = correo.value = '';
      try { await cargarYo(); } catch (_) {}
      const c = mesaSinPreguntar() || await elegirMesa(pantalla);
      sellar(pantalla, c, resolve);
    });
  });
}

// El sello se rompe, el pergamino se enrolla y aparece la mesa.
// La pantalla no se quita hasta que el pergamino está cerrado del todo: la mesa empieza a
// cargarse detrás cuando arranca el fundido y la pantalla se retira cuando este termina.
function sellar(pantalla, c, resolve) {
  ponerMesa(c);
  // La hoja puede haber cambiado de alto (p. ej. la lista de mesas): se vuelve a medir
  // para que los dos rodillos se junten justo en el centro
  const hoja = pantalla.querySelector('.pergamino-hoja');
  if (hoja) pantalla.style.setProperty('--media-hoja', (hoja.offsetHeight / 2) + 'px');
  let mesaLista = false, quitada = false;
  const mostrarMesa = () => {
    if (mesaLista) return;
    mesaLista = true;
    document.body.classList.remove('sin-sesion');
    resolve();
  };
  const quitar = () => {
    if (quitada) return;
    quitada = true;
    mostrarMesa();
    pantalla.remove();
  };
  pantalla.addEventListener('animationstart', e => {
    if (e.target === pantalla && e.animationName === 'fundido') mostrarMesa();
  });
  pantalla.addEventListener('animationend', e => {
    if (e.target === pantalla && e.animationName === 'fundido') quitar();
  });
  pantalla.classList.add('sellado');
  // Por si el navegador no avisa (pestaña en segundo plano, animaciones desactivadas…)
  setTimeout(mostrarMesa, 1200);
  setTimeout(quitar, 1800);
}

export async function salir() {
  try { await api('/api/salir', {}, true); } catch (_) {}
  lsSet(K_SESION, null);
  location.reload();
}

let avisada = false;
export function caducada() {
  if (avisada) return;
  avisada = true;
  lsSet(K_SESION, null);
  alert('Tu sesión ha terminado: caducó, te cambiaron la contraseña o el DM te ha desterrado de la mesa. Vuelve a entrar.');
  location.reload();
}

export async function cambiarContrasena(datos) {
  const r = await api('/api/usuarios/contrasena', datos, true);
  return r.j || { ok: false, mensaje: 'No se pudo cambiar.' };
}

export async function desterrar(clave, ban) {
  const r = await api('/api/usuarios/destierro', { usuario: clave, ban }, true);
  return r.j || { ok: false, mensaje: 'No se pudo cambiar.' };
}

export async function cambiarRol(clave, rol) {
  const r = await api('/api/usuarios/rol', { usuario: clave, rol }, true);
  return r.j || { ok: false, mensaje: 'No se pudo cambiar.' };
}

export async function apiMesa(ruta, cuerpo) {
  const r = await api(ruta, cuerpo, true).catch(() => null);
  if (!r) return { ok: false, mensaje: 'No hay conexión con el servidor.' };
  if (r.status === 403 && r.j?.motivo === 'mesa') fueraDeMesa(r.j.mensaje);
  return r.j || { ok: false, mensaje: 'No se pudo cambiar.' };
}

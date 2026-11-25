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

const K_SESION = 'alquimiaSesion';
const K_ELEGIR = 'alquimiaElegirMesa';            // sessionStorage: "enséñame el pergamino de mesas"
const kMesa = () => 'alquimiaMesa:' + (usuario?.clave || '-');   // la última mesa de cada cuenta

// { clave, nombre, rol: 'admin' | 'dm' | 'jugador', disciplina }. El rol (DM o jugador) es el de la mesa elegida.
export let usuario = null;
export let servidor = false;    // ¿hay servidor con cuentas?
export let mesa = null;         // { id, nombre, rol, disciplina } la campaña en la que se está jugando
export let campanas = [];       // las campañas de esta cuenta
export let puedeCrear = false;  // ¿puede crear campañas? (el superusuario)
let info = {};

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

// Resuelve cuando ya se puede arrancar la app: con cuenta (servidor) o sin servidor (local).
export async function iniciar() {
  const pantalla = document.getElementById('pantallaEntrada');
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
  await mostrarPantalla(pantalla);
  return { modo: 'servidor', recienEntrado: true };
}

// Quién soy y en qué campañas juego
async function cargarYo() {
  const r = await api('/api/yo', undefined, true);
  if (r.status !== 200 || !r.j?.usuario) return false;
  usuario = r.j.usuario;
  campanas = r.j.campanas || [];
  puedeCrear = !!r.j.puedeCrear;
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
    || pj !== JSON.stringify(usuario.personaje || null) || !!u.conClave !== !!mesa.conClave;
  usuario.rol = u.rol;
  usuario.disciplina = mesa.disciplina = u.disciplina || 'alquimista';
  usuario.personaje = u.personaje || null;   // su personaje en esta campaña (perfil.js)
  if (u.mesa) mesa.nombre = u.mesa;
  mesa.rol = u.rol;
  mesa.conClave = !!u.conClave;               // ¿la mesa tiene contraseña para unirse?
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

const NOMBRE_DISC = { alquimista: '⚗️ Alquimista', cocinero: '🍲 Cocinero', hechicero: '✨ Hechicero', herrero: '⚒️ Herrero' };

// El pergamino cambia el formulario de entrada por la lista de mesas. Resuelve con la mesa elegida.
function elegirMesa(pantalla) {
  return new Promise(resolve => {
    const hoja = pantalla.querySelector('.pergamino-hoja');
    hoja.querySelector('.entrada-pestanas')?.setAttribute('hidden', '');
    hoja.querySelector('#entradaForm')?.setAttribute('hidden', '');
    let caja = hoja.querySelector('.entrada-mesas');
    if (!caja) { caja = document.createElement('div'); caja.className = 'entrada-mesas'; hoja.appendChild(caja); }
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function pintar(error = '') {
      const lista = campanas.map(c => `<button type="button" class="mesa-opcion" data-mesa="${esc(c.id)}">
          <span class="mesa-opcion-nombre">${esc(c.nombre)}</span>
          <span class="mesa-opcion-rol">${c.rol === 'admin' ? '🛡️ Superusuario' : c.rol === 'dm' ? '👑 DM' : '⚔️ Jugador'}
            ${c.rol !== 'admin' ? ' · ' + esc(NOMBRE_DISC[c.disciplina] || '') : ''}</span>
        </button>`).join('');
      caja.innerHTML = `
        <p class="entrada-nota">${campanas.length
          ? `Bienvenido, <strong>${esc(usuario.nombre)}</strong>. ¿A qué mesa te sientas hoy?`
          : `<strong>${esc(usuario.nombre)}</strong>, todavía no te has sentado en ninguna mesa.<br>
             ${puedeCrear ? 'Crea la primera campaña aquí abajo.' : `Pide al DM de tu campaña que te invite (dile tu nombre, <strong>${esc(usuario.nombre)}</strong>) o únete con la contraseña de la mesa.`}`}</p>
        <div class="mesa-opciones">${lista}</div>
        ${!puedeCrear ? `<details class="mesa-unirse" ${campanas.length ? '' : 'open'}>
            <summary>🔑 Unirme a una mesa con su contraseña</summary>
            <form class="mesa-crear" id="mesaUnirseForm">
              <label class="entrada-campo"><span>Nombre de la mesa</span><input type="text" id="mesaUnirseNombre" maxlength="40"></label>
              <label class="entrada-campo"><span>Contraseña de la mesa</span><input type="password" id="mesaUnirseClave" maxlength="100" autocomplete="off"></label>
              <button type="submit" class="btn btn-sm">Unirme</button>
            </form>
          </details>` : ''}
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
    pintar();
    caja.onclick = async e => {
      const b = e.target.closest('[data-mesa], [data-mesa-accion]');
      if (!b) return;
      if (b.dataset.mesa) {
        const c = campanas.find(x => x.id === b.dataset.mesa);
        if (c) { caja.onclick = null; resolve(c); }
        return;
      }
      if (b.dataset.mesaAccion === 'salir') return salir();
      if (b.dataset.mesaAccion === 'mirar') {
        try { await cargarYo(); } catch (_) {}
        pintar(campanas.length ? '' : 'Todavía nadie te ha invitado.');
      }
    };
    caja.onsubmit = async e => {
      e.preventDefault();
      if (e.target.id === 'mesaUnirseForm') {   // unirse con la contraseña de la mesa
        const r = await api('/api/campanas/unirse', { nombre: caja.querySelector('#mesaUnirseNombre').value,
          clave: caja.querySelector('#mesaUnirseClave').value }, true).catch(() => ({ j: null }));
        if (!r.j?.ok) return pintar(r.j?.mensaje || 'No se pudo entrar en la mesa.');
        try { await cargarYo(); } catch (_) {}
        caja.onclick = null;
        return resolve(campanas.find(c => c.id === r.j.campana.id) || r.j.campana);
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

function mostrarPantalla(pantalla, soloMesa = false) {
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
    const boton = pantalla.querySelector('#entradaBoton');
    const nota = pantalla.querySelector('#entradaNota');
    let modo = info.hayUsuarios ? 'entrar' : 'crear';

    function pintarModo() {
      pantalla.dataset.modo = modo;
      pantalla.querySelectorAll('[data-entrada-modo]').forEach(b =>
        b.classList.toggle('activo', b.dataset.entradaModo === modo));
      pantalla.querySelector('#filaPass2').hidden = modo !== 'crear';
      pantalla.querySelector('#filaClave').hidden = !(modo === 'crear' && info.pideClave);
      pass.autocomplete = modo === 'crear' ? 'new-password' : 'current-password';
      boton.querySelector('span').textContent = modo === 'crear' ? 'Inscribir mi nombre' : 'Cruzar el umbral';
      nota.innerHTML = modo === 'crear'
        ? (info.hayUsuarios
            ? 'Tu nombre quedará escrito en el libro de la mesa.' + (info.pideClave ? ' La <strong>palabra de paso</strong> te la da el DM.' : '')
            : '👑 Eres el primero en llegar: <strong>tu cuenta será la del DM</strong>, el señor de la mesa.')
        : 'Escribe el nombre y la contraseña de tu cuenta.';
      error.textContent = '';
    }
    pintarModo();
    pantalla.querySelectorAll('[data-entrada-modo]').forEach(b => b.addEventListener('click', () => {
      modo = b.dataset.entradaModo; pintarModo(); nombre.focus();
    }));
    setTimeout(() => nombre.focus(), 600);

    function fallo(msg) {
      error.textContent = msg;
      form.classList.remove('temblor');
      void form.offsetWidth;   // reinicia la animación
      form.classList.add('temblor');
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!nombre.value.trim()) return fallo('Escribe tu nombre.');
      if (!pass.value) return fallo('Escribe tu contraseña.');
      if (modo === 'crear' && pass.value.length < 6) return fallo('La contraseña debe tener al menos 6 caracteres.');
      if (modo === 'crear' && pass.value !== pass2.value) return fallo('Las dos contraseñas no coinciden.');
      boton.disabled = true;
      pantalla.classList.add('ocupada');
      let r;
      try {
        r = await api(modo === 'crear' ? '/api/registro' : '/api/entrar', {
          nombre: nombre.value, contrasena: pass.value, clave: claveMesa.value,
        });
      } catch (_) {
        r = { status: 0, j: { mensaje: 'No se puede hablar con el servidor. ¿Está encendido?' } };
      }
      boton.disabled = false;
      pantalla.classList.remove('ocupada');
      if (r.status !== 200 || !r.j?.ok) return fallo(r.j?.mensaje || 'Algo ha fallado. Vuelve a probar.');
      lsSet(K_SESION, r.j.token);
      usuario = r.j.usuario;
      campanas = r.j.campanas || [];
      pass.value = pass2.value = claveMesa.value = '';
      try { await cargarYo(); } catch (_) {}
      const c = mesaSinPreguntar() || await elegirMesa(pantalla);
      sellar(pantalla, c, resolve);
    });
  });
}

// El sello se rompe, el pergamino se enrolla y aparece la mesa
function sellar(pantalla, c, resolve) {
  ponerMesa(c);
  pantalla.classList.add('sellado');
  setTimeout(() => {
    pantalla.remove();
    document.body.classList.remove('sin-sesion');
    resolve();
  }, 1100);
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

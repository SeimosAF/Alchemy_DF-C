// auth.js — pantalla de entrada: crear cuenta y entrar con usuario y contraseña.
//
// Si la app se abre con servidor.py, antes de nada hay que entrar con una cuenta.
// El servidor devuelve un token de sesión que se guarda en este navegador
// (dura 30 días sin usarse). Sin servidor, la pantalla no aparece y la app
// funciona como siempre, guardando en este navegador.

const K_SESION = 'alquimiaSesion';

export let usuario = null;      // { clave, nombre, rol: 'admin' | 'dm' | 'jugador' }
export let servidor = false;    // ¿hay servidor con cuentas?
let info = {};

const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };

export function token() { return lsGet(K_SESION); }
export function cabeceras() { const t = token(); return t ? { Authorization: 'Bearer ' + t } : {}; }
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
      const r = await api('/api/yo', undefined, true);
      if (r.status === 200 && r.j?.usuario) {
        usuario = r.j.usuario;
        pantalla?.remove();
        document.body.classList.remove('sin-sesion');
        return { modo: 'servidor' };
      }
    } catch (_) {}
    lsSet(K_SESION, null);
  }
  await mostrarPantalla(pantalla);
  return { modo: 'servidor', recienEntrado: true };
}

function mostrarPantalla(pantalla) {
  return new Promise(resolve => {
    document.body.classList.add('sin-sesion');
    pantalla.classList.add('visible');
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
      pass.value = pass2.value = claveMesa.value = '';
      // El sello se rompe, el pergamino se enrolla y aparece la mesa
      pantalla.classList.add('sellado');
      setTimeout(() => {
        pantalla.remove();
        document.body.classList.remove('sin-sesion');
        resolve();
      }, 1100);
    });
  });
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

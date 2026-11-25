// sync.js — comunicación con el servidor compartido (modo multiusuario).
//
// Idea: cada vez que la app guarda (saveState), comparamos el estado con la
// última foto que conocemos del servidor y convertimos las diferencias en una
// TRANSACCIÓN: una lista de operaciones que el servidor aplica todas o ninguna.
//   - Stock y cantidades se mandan como "suma/resta" (+2, −1), no como valor final,
//     así dos personas pueden añadir y gastar a la vez sin pisarse.
//   - El servidor rechaza cualquier resta que deje algo por debajo de 0
//     (el caso "alguien gastó el material que necesitabas").
//   - Lo demás (fichas de materiales, ajustes...) se manda con "cómo estaba
//     antes": si otra persona lo cambió entretanto, el servidor lo rechaza.
// Si el servidor rechaza, no se ha guardado nada: recargamos su estado y avisamos.
// Si no hay conexión, la transacción queda en cola y se reintenta (sin duplicarse:
// cada una lleva un id único y el servidor ignora las repetidas).
//
// Cada persona entra con su cuenta (auth.js). El servidor sabe quién es por el
// token de sesión: devuelve lo común de la mesa + SU inventario, y apunta cada
// transacción a su nombre. Con cada sondeo llega también quién está en línea.

import * as auth from './auth.js';

// Colecciones que se guardan en el servidor. Un módulo nuevo con datos propios se añade aquí
// (y en COLECCIONES / POR_JUGADOR de servidor.py).
export const COLS = { inventory: 'num', potions: 'qty', lootPotions: 'qty', catalog: 'obj', potionCatalog: 'obj', libros: 'obj', perfil: 'obj', objetos: 'obj' };
export const META = ['version', 'settings', 'damageTypes'];

const K_COLA_VIEJA = 'alquimiaColaPendiente';            // de antes de las cuentas
const kColaCuenta = () => 'alquimiaColaPendiente:' + (auth.usuario?.clave || '-');   // de antes de las campañas
const kCola = () => kColaCuenta() + '@' + (auth.mesa?.id || '-');   // una cola por cuenta y campaña

const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function stable(x) {
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
  return JSON.stringify(x === undefined ? null : x);
}
const igual = (a, b) => stable(a) === stable(b);
const sinQty = v => { if (!v || typeof v !== 'object') return v; const { qty, ...r } = v; return r; };
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} };

// ---- Estado interno ----
export let modo = 'local';          // 'local' (como siempre) o 'servidor'
let rev = -1;                       // última revisión del servidor que conocemos
let base = null;                    // foto del servidor + nuestros cambios ya enviados
let cola = [];                      // transacciones pendientes de confirmar
let enviando = false;
let reintento = 0;
let cambiosLocales = 0;             // sube con cada saveState: detecta carreras con el sondeo
let hooks = { remoto: () => {}, rechazo: () => {}, presencia: () => {}, usuario: () => {} };
let lugar = 'panel';                // qué parte de la app está mirando (para "Usuarios en línea")

export function setHooks(h) { hooks = { ...hooks, ...h }; }
export function autor() { return auth.usuario?.nombre || 'Anónimo'; }
export function pendientes() { return cola.length; }
export function setLugar(l) { if (l !== lugar) { lugar = l; if (modo === 'servidor') refrescar({ presencia: true }); } }

// ---- Conversión entre el estado de la app y lo que guarda el servidor ----
export function aServidor(s) {
  const d = {};
  for (const c in COLS) d[c] = clone(s[c] || {});
  d.meta = {};
  for (const k of META) if (s[k] !== undefined) d.meta[k] = clone(s[k]);
  return d;
}
export function desdeServidor(d, character) {
  const s = {};
  for (const c in COLS) s[c] = clone(d[c] || {});
  for (const k of META) if (d.meta?.[k] !== undefined) s[k] = clone(d.meta[k]);
  s.character = character;
  return s;
}
export function servidorVacio(d) {
  return Object.keys(COLS).every(c => !Object.keys(d[c] || {}).length);
}

// ---- Diferencias -> operaciones ----
function nombreMat(snap, id) {
  const m = snap.catalog?.[id];
  return m ? (m.name || '???') : 'material';
}
export function diferencias(antes, despues) {
  const ops = [], texto = [];
  for (const c of [...Object.keys(COLS), 'meta']) {
    const tipo = COLS[c] || 'obj';
    const a = antes[c] || {}, b = despues[c] || {};
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[id], vb = b[id];
      if (igual(va, vb)) continue;
      if (tipo === 'num') {
        if (vb === undefined) { ops.push({ t: 'num', c, id, n: 0, borrar: true }); continue; } // material borrado
        const n = (Number(vb) || 0) - (Number(va) || 0);
        ops.push({ t: 'num', c, id, n });
        if (n) texto.push(`${n > 0 ? '+' : ''}${n} ${nombreMat(despues, id)}`);
      } else if (tipo === 'qty') {
        const qa = va ? (va.qty || 0) : 0, qb = vb ? (vb.qty || 0) : 0;
        const op = { t: 'qty', c, id, n: qb - qa };
        if (!va) op.tpl = sinQty(vb);
        else if (vb && !igual(sinQty(va), sinQty(vb))) { op.e = sinQty(va); op.v = sinQty(vb); }
        ops.push(op);
        const nom = (vb || va).name || 'poción';
        if (op.n) texto.push(`${op.n > 0 ? '+' : ''}${op.n} ${nom}`);
        else texto.push(`editó ${nom}`);
      } else {
        ops.push({ t: 'obj', c, id, e: va === undefined ? null : clone(va), v: vb === undefined ? null : clone(vb) });
        if (c === 'catalog') texto.push(!va ? `nuevo material ${vb.name}` : !vb ? `borró ${va.name}` : `editó ${vb.name}`);
        else if (c === 'potionCatalog') texto.push('ficha de poción');
        else if (c === 'libros') texto.push(!va ? `nuevo libro ${vb.name}` : !vb ? `quitó el libro ${va.name}` : `lectura de ${vb.name}`);
        else if (c === 'perfil') texto.push('nivel de alquimia');
        else if (c === 'objetos') texto.push(!va ? `nuevo objeto ${vb.name}` : !vb ? `quitó ${va.name}` : `editó ${vb.name}`);
        else texto.push('ajustes');
      }
    }
  }
  return { ops, resumen: texto.join(', ').slice(0, 300) };
}

// ---- HTTP ----
export async function pedir(ruta, opciones = {}) {
  const headers = {
    'Content-Type': 'application/json', ...auth.cabeceras(),
    'X-Lugar': lugar, 'X-Visible': document.visibilityState === 'hidden' ? '0' : '1',
    ...(opciones.headers || {}),
  };
  const r = await fetch(ruta, { ...opciones, headers, cache: 'no-store' });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (r.status === 401 && j?.motivo === 'sesion') {
    auth.caducada();   // la sesión ya no vale (caducó o el DM cambió la contraseña): vuelta a la entrada
    throw new Error('Sin sesión');
  }
  if (r.status === 403 && j?.motivo === 'mesa') {
    auth.fueraDeMesa(j.mensaje);   // le han sacado de la campaña (o ya no existe): a elegir mesa
    throw new Error('Sin mesa');
  }
  return { status: r.status, j };
}

// ---- Arranque ----
// Devuelve null si no hay servidor (modo local) o { datos } con el estado del servidor.
export async function conectar() {
  if (!auth.servidor || !auth.usuario) return null;   // sin servidor: modo "solo este navegador"
  modo = 'servidor';
  // Transacciones que quedaron sin confirmar (p. ej. se cerró la pestaña sin conexión)
  try { cola = JSON.parse(lsGet(kCola()) || '[]'); } catch (_) { cola = []; }
  // Colas de antes (sin cuentas o sin campañas): eran de la primera campaña, se mandan solo allí
  for (const k of [K_COLA_VIEJA, kColaCuenta()]) {
    const vieja = auth.mesa?.id === 'primera' ? lsGet(k) : null;
    if (!vieja) continue;
    try { cola = [...JSON.parse(vieja), ...cola]; } catch (_) {}
    lsSet(k, null);
    lsSet(kCola(), cola.length ? JSON.stringify(cola) : null);
  }
  while (cola.length) {
    const ok = await enviarUna(cola[0], true);
    if (ok === 'reintentar') break;
  }
  const r = await pedir('/api/estado');
  if (r.j.usuario) auth.actualizarDesdeServidor(r.j.usuario);   // su papel, disciplina y personaje en esta mesa
  rev = r.j.rev;
  base = clone(r.j.datos);
  if (r.j.presencia) hooks.presencia(r.j.presencia);
  pintarEstado();
  return { datos: r.j.datos };
}

// Transacción hecha a mano (herramientas del DM): se manda ya y se espera la respuesta.
// No pasa por la cola porque el DM quiere saber al momento si se ha aplicado.
export async function transaccionDirecta(ops, resumen) {
  const tx = { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()), ops, resumen };
  let r;
  try { r = await pedir('/api/transaccion', { method: 'POST', body: JSON.stringify(tx) }); }
  catch (e) { return { ok: false, mensaje: 'No hay conexión con el servidor. No se ha cambiado nada.' }; }
  if (r.status === 200 && r.j?.ok) { refrescar(); return { ok: true }; }
  return { ok: false, mensaje: r.j?.mensaje || 'El servidor ha rechazado el cambio. No se ha cambiado nada.' };
}

// Llama la app tras montar el estado: fija la foto de partida.
export function fijarBase(snap) { base = clone(snap); }

// ---- Guardar = encolar transacción ----
export function guardar(s, extraOps = []) {
  cambiosLocales++;
  const ahora = aServidor(s);
  const { ops, resumen } = diferencias(base, ahora);
  base = ahora;
  if (!ops.length && !extraOps.length) return;
  cola.push({ id: (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()), ops: [...extraOps, ...ops], resumen });
  lsSet(kCola(), JSON.stringify(cola));
  bombear();
}

async function bombear() {
  if (enviando || !cola.length) return;
  enviando = true;
  pintarEstado();
  const res = await enviarUna(cola[0], false);
  enviando = false;
  if (res === 'reintentar') {
    reintento = Math.min(reintento + 1, 5);
    pintarEstado('sin-conexion');
    setTimeout(bombear, 1000 * 2 ** reintento);
    return;
  }
  reintento = 0;
  if (cola.length) bombear();
  else { pintarEstado(); refrescar(); }
}

// Devuelve 'ok', 'rechazada' o 'reintentar'
async function enviarUna(tx, enArranque) {
  let r;
  try {
    r = await pedir('/api/transaccion', { method: 'POST', body: JSON.stringify(tx) });
  } catch (e) {
    return 'reintentar';
  }
  if (r.status === 200 && r.j?.ok) {
    cola.shift();
    lsSet(kCola(), cola.length ? JSON.stringify(cola) : null);
    return 'ok';
  }
  if (r.status === 409 || r.status === 400 || r.status === 413 || r.status === 403) {
    // Rechazada: no se ha aplicado NADA de esta transacción. Las que venían
    // detrás dependían de ella, así que también se descartan.
    const descartadas = cola.length - 1;
    cola = [];
    lsSet(kCola(), null);
    const msg = (r.j?.mensaje || 'El servidor ha rechazado el cambio.') +
      '\n\nNo se ha guardado nada de esa acción' + (descartadas ? ` (ni de las ${descartadas} siguientes)` : '') +
      ': ni se ha gastado material ni se ha creado nada. La app se ha puesto al día con lo que hay ahora.';
    if (!enArranque) {
      await refrescar({ forzar: true });
      hooks.rechazo(msg, r.j);
    } else {
      alert(msg);
    }
    return 'rechazada';
  }
  return 'reintentar';   // 5xx, proxy caído...
}

// ---- Traer cambios de los demás ----
// Devuelve true si el estado ha cambiado.
export async function refrescar({ forzar = false, silencioso = false, presencia = false } = {}) {
  if (modo !== 'servidor') return false;
  if (!forzar && (cola.length || enviando)) {
    if (presencia) pedirPresencia();
    return false;
  }
  const marca = cambiosLocales;
  let r;
  try { r = await pedir('/api/estado?rev=' + (forzar ? -1 : rev)); }
  catch (_) { pintarEstado('sin-conexion'); return false; }
  if (r.status !== 200 || !r.j?.ok) { pintarEstado('sin-conexion'); return false; }
  if (r.j.presencia) hooks.presencia(r.j.presencia);
  if (r.j.usuario && auth.usuario) {   // le han cambiado el rol, la disciplina o el nombre de la mesa
    const antes = { rol: auth.usuario.rol, disciplina: auth.usuario.disciplina, personaje: JSON.stringify(auth.usuario.personaje || null) };
    if (auth.actualizarDesdeServidor(r.j.usuario)) hooks.usuario(auth.usuario, antes);
  }
  pintarEstado();
  if (r.j.igual) return false;
  if (!forzar && (marca !== cambiosLocales || cola.length || enviando)) return false; // hubo un cambio local mientras tanto
  rev = r.j.rev;
  base = clone(r.j.datos);
  const ajenos = (r.j.cambios || []).filter(c => c.autor !== autor());
  hooks.remoto(r.j.datos, silencioso ? [] : ajenos, { silencioso });
  return true;
}

async function pedirPresencia() {
  try {
    const r = await pedir('/api/presencia');
    if (r.status === 200 && r.j?.presencia) hooks.presencia(r.j.presencia);
  } catch (_) {}
}

let sondeo = null;
export function empezarSondeo() {
  if (modo !== 'servidor' || sondeo) return;
  let n = 0;
  sondeo = setInterval(() => {
    n++;
    // Con la pestaña oculta pregunta mucho menos
    if (document.visibilityState === 'visible' || n % 10 === 0) refrescar();
  }, 3000);
  window.addEventListener('focus', () => refrescar());
  document.addEventListener('visibilitychange', () => refrescar({ presencia: true }));
}

// ---- Indicador y avisos ----
function pintarEstado(forzado) {
  let el = document.getElementById('syncEstado');
  if (!el) {
    const fila = document.querySelector('.header-title-row');
    if (!fila) return;
    el = document.createElement('span');
    el.id = 'syncEstado';
    el.className = 'sync-estado';
    fila.insertBefore(el, document.getElementById('cuenta'));
  }
  let cls, txt, tit;
  if (modo !== 'servidor') { cls = 'local'; txt = '💾 Solo este navegador'; tit = 'Los datos se guardan en este navegador. Arranca servidor.py para compartirlos.'; }
  else if (forzado === 'sin-conexion') { cls = 'off'; txt = cola.length ? `🔴 Sin conexión · ${cola.length} pendiente(s)` : '🔴 Sin conexión'; tit = 'Se reintenta solo. Lo pendiente no se pierde ni se duplica.'; }
  else if (cola.length || enviando) { cls = 'pend'; txt = '🟡 Guardando…'; tit = 'Enviando al servidor'; }
  else { cls = 'ok'; txt = '🟢 Conectado'; tit = 'Conectado al servidor como ' + autor() + (auth.mesa ? ' en «' + auth.mesa.nombre + '»' : '') + '. Los cambios de los demás aparecen solos.'; }
  el.className = 'sync-estado sync-' + cls;
  document.body.dataset.sync = cls;   // el punto del icono de la cuenta (verde, amarillo, rojo); el cartel solo sale si algo va mal
  el.textContent = txt;
  el.title = tit;
}
export { pintarEstado };

export function aviso(texto, tipo = 'info') {
  let caja = document.getElementById('syncAvisos');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'syncAvisos';
    document.body.appendChild(caja);
  }
  const d = document.createElement('div');
  d.className = 'sync-aviso sync-aviso-' + tipo;
  d.textContent = texto;
  caja.appendChild(d);
  setTimeout(() => d.remove(), tipo === 'error' ? 12000 : 5000);
}

// chat.js — el chat de la mesa (V3.9).
//
// Cada campaña tiene su chat: lo leen y escriben los que juegan en ella (y el superusuario).
// Además hay un chat GENERAL para todas las cuentas de la taberna (pestaña 🍺).
// Se abre con el botón 💬 de la cabecera; el número rojo son los mensajes sin leer.
// Dos bots: «Dobby» en el general (versiones nuevas y apagado / encendido del servidor) y
// «Dobby Jr.» en cada mesa, que SOLO anuncia a quien llega por primera vez y a quien se va o
// sacan. El DM de la mesa (y el superusuario) le cambian a Dobby Jr. el nombre y la bienvenida
// con ⚙️; en la bienvenida, {nombre} = quien llega y {mesa} = el nombre de la mesa.
// Moderación: en la mesa, su DM y el superusuario; en el general, solo el superusuario.
//
// Cómo se entera de los mensajes nuevos: cada sondeo de sync.js trae el id del último mensaje
// ('chat' en /api/estado). Si es mayor que el último que tiene, pide solo los nuevos.
// Lo leído se apunta en este navegador (localStorage), por cuenta y por mesa.
//
// Moderación: el DM de la mesa y el superusuario tienen una 🗑️ en cada mensaje para retirarlo (para todos).
// El sondeo trae también cuántos mensajes se han retirado ('chatBorrados'); si cambia, se recarga la lista.
// En los mensajes de los bots, {{hora:FECHA}} se pinta con la hora de quien lo lee («hoy a las 16:13»).
//
// Pestañas del panel: 🗺️ Mesa (este chat), ✉️ Privados (chats de tú a tú con cualquier cuenta de la
// taberna, juegue o no en esta mesa) y 🔔 Avisos (lo que te ha pasado: te han invitado a una mesa, te han
// dado algo, el DM ha cambiado tus cosas o tus oficios...). Privados y avisos son de la CUENTA, no de la
// mesa: se leen igual desde cualquier campaña. El sondeo trae 'buzon' (cuántos sin leer y el último id).
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as avatar from './avatar.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inicial = n => (String(n || '').trim()[0] || '?').toUpperCase();
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
// Lo leído de cada canal, en este navegador: por cuenta y por mesa (el general es uno para todas)
const kLeido = k => `taberna.chatLeido:${auth.usuario?.clave || '-'}:${k.id === 'general' ? '*' : auth.mesa?.id || '-'}`;

let activo = false;
let bot = { nombre: 'Dobby Jr.', bienvenida: '' };   // el bot de esta mesa (lo configura su DM)
let puedeEditarBot = false;

// Los dos chats «de grupo»: el de esta mesa y el GENERAL de toda la taberna (ahí habla Dobby:
// versiones nuevas y apagado / encendido del servidor). Mismo funcionamiento, distinta dirección.
function nuevoCanal(id, url, urlEnviar, urlBorrar) {
  return { id, url, urlEnviar, urlBorrar, mensajes: [], ultimo: 0, hayAnteriores: false, borrados: 0, moderar: false,
    pidiendo: false, pendiente: 0 };
}
const canales = {
  mesa: nuevoCanal('mesa', '/api/chat', '/api/chat/enviar', '/api/chat/borrar'),
  general: nuevoCanal('general', '/api/general', '/api/general/enviar', '/api/general/borrar'),
};
const canalVista = () => canales[vista] || null;

// Vista del panel: 'general' | 'mesa' | 'privados' (lista) | 'conv' (una conversación privada) | 'avisos'
let vista = 'mesa';
let buzon = null;        // { avisos, avisosUltimo, privados, privadosUltimo } del último sondeo
let convs = [];          // conversaciones privadas
let directorioP = [];    // a quién se puede escribir
let conv = null;         // { clave, nombre, avatar, mensajes, ultimo, hayAnteriores }
let avisos = [];
let hayMasAvisos = false;
let pidiendoConv = false;

const $ = id => document.getElementById(id);
const panelChat = () => $('chatPanel');
export const abierto = () => !!panelChat() && !panelChat().hidden;
const leido = k => Number(lsGet(kLeido(k)) || 0);

export async function init() {
  if (!auth.servidor || !auth.mesa || sync.modo !== 'servidor') return;
  activo = true;
  $('chatBtn').hidden = false;
  $('chatBtn').addEventListener('click', () => (abierto() ? cerrar() : abrir()));
  $('chatCerrar').addEventListener('click', cerrar);
  $('chatAjustesBtn').addEventListener('click', alternarAjustes);
  $('chatAnteriores').addEventListener('click', cargarAnteriores);
  $('chatForm').addEventListener('submit', e => { e.preventDefault(); enviar(); });
  $('chatBotForm').addEventListener('submit', e => { e.preventDefault(); guardarBot(); });
  $('chatBotCancelar').addEventListener('click', () => { $('chatBotForm').hidden = true; });
  $('chatMensajes').addEventListener('click', e => {
    const b = e.target.closest('[data-chat-borrar]');
    if (b) borrar(Number(b.dataset.chatBorrar));
  });
  document.querySelector('.chat-pestanas').addEventListener('click', e => {
    const b = e.target.closest('[data-chat-tab]');
    if (b) irA(b.dataset.chatTab);
  });
  $('chatVolver').addEventListener('click', () => irA('privados'));
  $('chatConvsLista').addEventListener('click', e => {
    const b = e.target.closest('[data-conv]');
    if (b) abrirPrivado(b.dataset.conv, b.dataset.nombre);
  });
  $('chatNuevoPara').addEventListener('change', e => {
    const o = e.target.selectedOptions[0];
    if (e.target.value) abrirPrivado(e.target.value, o.dataset.nombre);
    e.target.value = '';
  });
  $('chatAvisosMas').addEventListener('click', () => cargarAvisos(true));
  const caja = $('chatTexto');
  caja.addEventListener('keydown', e => {
    // Intro manda; Mayús+Intro hace un salto de línea
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
  });
  caja.addEventListener('input', () => {
    caja.style.height = 'auto';
    caja.style.height = Math.min(caja.scrollHeight, 120) + 'px';
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && abierto()) cerrar(); });
  await Promise.all([cargar(canales.mesa), cargar(canales.general)]);
}

async function cargar(k) {
  const r = await sync.pedir(k.url).catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  k.mensajes = r.j.mensajes || [];
  k.hayAnteriores = k.mensajes.length >= 60;
  k.ultimo = Math.max(r.j.ultimo || 0, ...k.mensajes.map(m => m.id));
  k.borrados = r.j.borrados || 0;
  if (k.id === 'mesa') {
    bot = r.j.bot || bot;
    puedeEditarBot = !!r.j.puedeEditarBot;
    k.moderar = puedeEditarBot;          // en la mesa moderan su DM y el superusuario
  } else k.moderar = !!r.j.puedeModerar;   // en el general, solo el superusuario
  // La primera vez (en este navegador) no se marca como sin leer todo lo anterior, salvo lo de las últimas horas
  if (lsGet(kLeido(k)) == null) {
    const hace = Date.now() - 6 * 3600e3;
    const viejos = k.mensajes.filter(m => Date.parse(m.fecha) < hace);
    lsSet(kLeido(k), String(viejos.length ? viejos[viejos.length - 1].id : 0));
  }
  pintar(k);
}

// ---- Privados y avisos: lo que dice el sondeo
export function alBuzon(b) {
  if (!activo || !b) return;
  const antes = buzon;
  buzon = b;
  if (antes) {
    if (b.privadosUltimo > antes.privadosUltimo) nuevosPrivados(b.privados > antes.privados);
    if (b.avisosUltimo > antes.avisosUltimo) nuevosAvisos(antes.avisosUltimo);
  }
  pintarContador();
}

async function nuevosPrivados(llegoAlgo) {
  if (vista === 'conv' && conv) await traerConv();
  if (vista === 'privados' || llegoAlgo) await cargarConvs();
  if (llegoAlgo && !(abierto() && vista === 'conv')) {
    const c = convs.find(x => x.sinLeer && !x.mio);
    if (c) sync.aviso(`✉️ ${c.nombre}: ${c.texto.length > 90 ? c.texto.slice(0, 90) + '…' : c.texto}`);
  }
}

async function nuevosAvisos(desde) {
  await cargarAvisos();
  const nuevos = avisos.filter(a => a.id > desde && !a.leido);
  if (!(abierto() && vista === 'avisos')) for (const a of nuevos.slice(0, 2)) sync.aviso('🔔 ' + a.texto);
}

// Lo llama el sondeo (sync.js → app.js) con el id del último mensaje (y cuántos ha retirado la moderación)
export function alSondeo(n, b) { alCanal(canales.mesa, n, b); }
export function alGeneral(n, b) { alCanal(canales.general, n, b); }
function alCanal(k, n, b) {
  if (!activo || typeof n !== 'number') return;
  if (typeof b === 'number' && b !== k.borrados) { k.borrados = b; cargar(k); return; }   // la moderación retiró algo
  if (n > k.ultimo) traerNuevos(k, n);
  else if (n < k.ultimo) cargar(k);   // no debería pasar (base restaurada): se vuelve a cargar entero
}

async function traerNuevos(k, n) {
  if (k.pidiendo) { k.pendiente = Math.max(k.pendiente, n); return; }
  k.pidiendo = true;
  try {
    const r = await sync.pedir(k.url + '?desde=' + k.ultimo).catch(() => null);
    if (!r || r.status !== 200 || !r.j?.ok) return;
    if (k.id === 'mesa') { bot = r.j.bot || bot; puedeEditarBot = !!r.j.puedeEditarBot; k.moderar = puedeEditarBot; }
    const conocidos = new Set(k.mensajes.map(m => m.id));
    const nuevos = (r.j.mensajes || []).filter(m => !conocidos.has(m.id));
    if (!nuevos.length) { k.ultimo = Math.max(k.ultimo, r.j.ultimo || 0); pintarContador(); return; }
    k.mensajes.push(...nuevos);
    if (k.mensajes.length > 500) { k.mensajes = k.mensajes.slice(-500); k.hayAnteriores = true; }
    k.ultimo = Math.max(k.ultimo, ...nuevos.map(m => m.id));
    // Aviso pequeño si no se está viendo ese chat y el mensaje es de otro
    if (!(abierto() && vista === k.id)) {
      for (const m of nuevos.filter(m => m.autor !== auth.usuario?.clave).slice(-2)) {
        const plano = m.bot ? textoBot(m.texto) : m.texto;
        const t = plano.length > 90 ? plano.slice(0, 90) + '…' : plano;
        sync.aviso(`${m.bot ? '🧝' : k.id === 'general' ? '🍺' : '💬'} ${m.nombre}: ${t}`);
      }
    }
    pintar(k);
  } finally {
    k.pidiendo = false;
    if (k.pendiente > k.ultimo) { const p = k.pendiente; k.pendiente = 0; traerNuevos(k, p); }
  }
}

async function cargarAnteriores() {
  const k = canalVista();
  if (!k || !k.mensajes.length) return;
  const r = await sync.pedir(k.url + '?antes=' + k.mensajes[0].id).catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  const viejos = r.j.mensajes || [];
  k.hayAnteriores = viejos.length >= 60;
  const lista = $('chatLista');
  const alto = lista.scrollHeight;
  k.mensajes = [...viejos, ...k.mensajes];
  pintarLista(k);
  lista.scrollTop = lista.scrollHeight - alto;   // que no salte
}

function abrir() {
  const p = panelChat();
  p.hidden = false;
  $('chatBtn').setAttribute('aria-expanded', 'true');
  document.body.classList.add('chat-abierto');
  // Si en la pestaña de ahora no hay nada nuevo, se abre en la primera que tenga novedades
  const nuevoEn = v => (v === 'mesa' || v === 'general') ? sinLeer(canales[v]) : v === 'privados' ? buzon?.privados : v === 'avisos' ? buzon?.avisos : 0;
  if (!nuevoEn(vista)) vista = ['mesa', 'general', 'privados', 'avisos'].find(nuevoEn) || vista;
  irA(vista);
}

// Cambia de pestaña / vista
async function irA(v) {
  vista = v;
  if (v !== 'conv') conv = null;
  const grupo = v === 'mesa' || v === 'general', enConv = v === 'conv';
  document.querySelectorAll('.chat-pestanas [data-chat-tab]').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.chatTab === (enConv ? 'privados' : v))));
  $('chatLista').hidden = !(grupo || enConv);
  $('chatForm').hidden = !(grupo || enConv);
  $('chatConvs').hidden = v !== 'privados';
  $('chatAvisos').hidden = v !== 'avisos';
  $('chatVolver').hidden = !enConv;
  if (v !== 'mesa') $('chatBotForm').hidden = true;
  $('chatTexto').placeholder = enConv ? `Escribe a ${conv?.nombre || ''}…` : v === 'general' ? 'Escribe a toda la taberna…' : 'Escribe a la mesa…';
  pintarCabecera();
  if (grupo) {
    pintar(canales[v]);
    $('chatLista').scrollTop = $('chatLista').scrollHeight;
    marcarLeido(canales[v]);
    if (window.matchMedia('(pointer:fine)').matches) $('chatTexto').focus();
  } else if (v === 'privados') {
    pintarConvs();
    await cargarConvs();
  } else if (v === 'avisos') {
    pintarAvisos();
    await cargarAvisos();
    marcarAvisosLeidos();
  }
  pintarContador();
}

function pintarCabecera() {
  const t = { general: ['🍺', 'Chat general', 'Toda la taberna'], mesa: ['💬', 'Chat de la mesa', auth.mesa?.nombre || ''],
    privados: ['✉️', 'Chats privados', 'De tú a tú'], avisos: ['🔔', 'Avisos', 'Lo que te ha pasado'],
    conv: ['✉️', 'Chat privado con', conv?.nombre || ''] }[vista];
  $('chatIcono').textContent = t[0];
  $('chatSub').textContent = t[1];
  $('chatTitulo').textContent = t[2];
  $('chatAjustesBtn').hidden = !(vista === 'mesa' && puedeEditarBot);
}

function cerrar() {
  panelChat().hidden = true;
  $('chatBtn').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('chat-abierto');
  $('chatBotForm').hidden = true;
}

function marcarLeido(k) {
  if (k.ultimo > leido(k)) lsSet(kLeido(k), String(k.ultimo));
  pintarContador();
}

function sinLeer(k) {
  const l = leido(k);
  return k.mensajes.filter(m => m.id > l && m.autor !== auth.usuario?.clave).length;
}

const num = n => (n ? (n > 99 ? '99+' : String(n)) : '');
function pintarContador() {
  const viendo = v => abierto() && vista === v;
  const nMesa = viendo('mesa') ? 0 : sinLeer(canales.mesa);
  const nGen = viendo('general') ? 0 : sinLeer(canales.general);
  const nPriv = buzon?.privados || 0;
  const nAv = viendo('avisos') ? 0 : (buzon?.avisos || 0);
  $('chatNMesa').textContent = num(nMesa);
  $('chatNGeneral').textContent = num(nGen);
  $('chatNPrivados').textContent = num(nPriv);
  $('chatNAvisos').textContent = num(nAv);
  const n = abierto() ? 0 : nMesa + nGen + nPriv + nAv;
  $('chatContador').textContent = num(n);
  $('chatBtn').title = n ? `Chat · ${n} sin leer` : 'Chat: general, mesa, privados y avisos';
}

function pintar(k) {
  if (!activo || vista !== k.id) { pintarContador(); return; }
  pintarCabecera();
  const lista = $('chatLista');
  const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
  pintarLista(k);
  if (abierto()) {
    if (abajo) lista.scrollTop = lista.scrollHeight;
    marcarLeido(k);
  } else pintarContador();
}

// ---- Chats privados
async function cargarConvs() {
  const r = await sync.pedir('/api/privados').catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  convs = r.j.conversaciones || [];
  directorioP = r.j.directorio || [];
  if (r.j.buzon) buzon = r.j.buzon;
  if (vista === 'privados') pintarConvs();
  pintarContador();
}

function pintarConvs() {
  const sel = $('chatNuevoPara');
  sel.innerHTML = '<option value="">Elige a alguien</option>' + directorioP.map(d =>
    `<option value="${esc(d.clave)}" data-nombre="${esc(d.nombre)}">${esc(d.nombre)}${d.admin ? ' (superusuario)' : ''}</option>`).join('');
  $('chatConvsLista').innerHTML = convs.length ? convs.map(c => `
    <button type="button" class="chat-conv${c.sinLeer ? ' chat-conv-nueva' : ''}" data-conv="${esc(c.clave)}" data-nombre="${esc(c.nombre)}">
      ${avatar.html(c.clave, c.avatar, inicial(c.nombre), 'avatar chat-avatar')}
      <span class="chat-conv-txt"><b>${esc(c.nombre)}</b> <time>${esc(hora(c.fecha))}</time>
        <span class="chat-conv-ultimo">${c.mio ? 'Tú: ' : ''}${esc(c.texto)}</span></span>
      ${c.sinLeer ? `<span class="chat-pestana-n">${num(c.sinLeer)}</span>` : ''}
    </button>`).join('')
    : '<p class="chat-vacio">Aún no tienes chats privados. Elige a alguien arriba, o pulsa «💬 Mensaje» en «En línea».</p>';
}

// Abre la conversación privada con una cuenta (también desde «En línea»)
export async function abrirPrivado(clave, nombre) {
  if (!activo || !clave) return;
  if (!abierto()) {
    panelChat().hidden = false;
    $('chatBtn').setAttribute('aria-expanded', 'true');
    document.body.classList.add('chat-abierto');
  }
  conv = { clave, nombre: nombre || clave, avatar: 0, mensajes: [], ultimo: 0, hayAnteriores: false };
  vista = 'conv';
  await irA('conv');
  pintarConv();
  const r = await sync.pedir('/api/privados/con?u=' + encodeURIComponent(clave)).catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok || conv?.clave !== clave) return;
  conv = { ...r.j.con, mensajes: r.j.mensajes, ultimo: Math.max(0, ...r.j.mensajes.map(m => m.id)), hayAnteriores: r.j.mensajes.length >= 60 };
  pintarCabecera();
  $('chatTexto').placeholder = `Escribe a ${conv.nombre}…`;
  pintarConv();
  $('chatLista').scrollTop = $('chatLista').scrollHeight;
  leidosConv();
  if (window.matchMedia('(pointer:fine)').matches) $('chatTexto').focus();
}

async function traerConv() {
  if (!conv || pidiendoConv) return;
  pidiendoConv = true;
  const clave = conv.clave;
  try {
    const r = await sync.pedir(`/api/privados/con?u=${encodeURIComponent(clave)}&desde=${conv.ultimo}`).catch(() => null);
    if (!r || r.status !== 200 || !r.j?.ok || conv?.clave !== clave) return;
    const ids = new Set(conv.mensajes.map(m => m.id));
    const nuevos = r.j.mensajes.filter(m => !ids.has(m.id));
    if (!nuevos.length) return;
    conv.mensajes.push(...nuevos);
    conv.ultimo = Math.max(conv.ultimo, ...nuevos.map(m => m.id));
    const lista = $('chatLista');
    const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    pintarConv();
    if (abajo) lista.scrollTop = lista.scrollHeight;
    if (abierto()) leidosConv();
  } finally { pidiendoConv = false; }
}

async function leidosConv() {
  if (!conv || !conv.mensajes.some(m => m.autor !== auth.usuario?.clave && !m.leido)) return;
  conv.mensajes.forEach(m => { m.leido = true; });
  await auth.apiMesa('/api/privados/leidos', { con: conv.clave });
  const c = convs.find(x => x.clave === conv?.clave);
  if (buzon && c) buzon.privados = Math.max(0, buzon.privados - c.sinLeer);
  if (c) c.sinLeer = 0;
  sync.refrescar({ silencioso: true });   // el numerito vuelve a venir bien del servidor
}

function pintarConv() {
  $('chatAnteriores').hidden = true;
  const yo = auth.usuario?.clave;
  if (!conv.mensajes.length) {
    $('chatMensajes').innerHTML = `<p class="chat-vacio">Este chat solo lo veis ${esc(conv.nombre)} y tú. ¡Escribe el primero!</p>`;
    return;
  }
  let antes = null;
  $('chatMensajes').innerHTML = conv.mensajes.map(m => {
    const mio = m.autor === yo;
    const seguido = antes && antes.autor === m.autor && Date.parse(m.fecha) - Date.parse(antes.fecha) < 5 * 60e3;
    antes = m;
    return `<div class="chat-msg${mio ? ' chat-mio' : ''}${seguido ? ' chat-seguido' : ''}">
      ${mio ? '' : avatar.html(conv.clave, conv.avatar, inicial(conv.nombre), 'avatar chat-avatar', conv.nombre)}
      <div class="chat-burbuja">${seguido ? '' : `<div class="chat-cab"><time>${esc(hora(m.fecha))}</time></div>`}
      <div class="chat-texto">${esc(m.texto)}</div></div></div>`;
  }).join('');
}

// ---- Avisos personales
async function cargarAvisos(mas = false) {
  const antes = mas && avisos.length ? avisos[avisos.length - 1].id : 0;
  const r = await sync.pedir('/api/avisos' + (antes ? '?antes=' + antes : '')).catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  avisos = mas ? [...avisos, ...r.j.avisos] : r.j.avisos;
  hayMasAvisos = r.j.avisos.length >= 60;
  if (r.j.buzon) buzon = r.j.buzon;
  if (vista === 'avisos') pintarAvisos();
  pintarContador();
}

function pintarAvisos() {
  $('chatAvisosMas').hidden = !hayMasAvisos;
  $('chatAvisosLista').innerHTML = avisos.length ? avisos.map(a => `
    <div class="chat-aviso${a.leido ? '' : ' chat-aviso-nuevo'}">
      <div class="chat-aviso-texto">${esc(a.texto)}</div>
      <div class="chat-aviso-pie"><time>${esc(cuando(a.fecha))}</time>${a.mesa ? ` · 🗺️ ${esc(a.mesa)}` : ''}</div>
    </div>`).join('')
    : '<p class="chat-vacio">Aquí verás lo que te pase: si te invitan a una mesa, te dan algo o el DM cambia tus cosas.</p>';
}

async function marcarAvisosLeidos() {
  const max = Math.max(0, ...avisos.filter(a => !a.leido).map(a => a.id));
  if (!max) return;
  await auth.apiMesa('/api/avisos/leidos', { hasta: max });
  if (buzon) buzon.avisos = 0;
  pintarContador();
  setTimeout(() => { avisos.forEach(a => { a.leido = true; }); if (vista === 'avisos') pintarAvisos(); }, 4000);   // el resaltado dura un poco
}

function hora(f) {
  const d = new Date(f);
  if (isNaN(d)) return '';
  const hoy = new Date();
  const h = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoy.toDateString() ? h : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${h}`;
}

// «hoy a las 16:13», «ayer a las 9:05» o «el vie 27 nov a las 16:13», en la hora de quien lo lee
function cuando(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const h = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(d)) / 864e5);
  if (dias === 0) return `hoy a las ${h}`;
  if (dias === 1) return `ayer a las ${h}`;
  return `el ${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} a las ${h}`;
}
const textoBot = t => String(t).replace(/\{\{hora:([0-9T:+\-.Z]+)\}\}/g, (_, iso) => cuando(iso));

function pintarLista(k) {
  const yo = auth.usuario?.clave;
  $('chatAnteriores').hidden = !k.hayAnteriores;
  if (!k.mensajes.length) {
    $('chatMensajes').innerHTML = `<p class="chat-vacio">${k.id === 'general' ? 'Aún no hay mensajes en el chat general.' : 'Aún no hay mensajes en esta mesa.'} ¡Saluda!</p>`;
    return;
  }
  let antes = null;
  const moderar = m => k.moderar
    ? `<button type="button" class="chat-borrar" data-chat-borrar="${m.id}" title="Borrar este mensaje (para todos)" aria-label="Borrar mensaje">🗑️</button>` : '';
  $('chatMensajes').innerHTML = k.mensajes.map(m => {
    const mio = m.autor === yo;
    const seguido = antes && antes.autor === m.autor && Date.parse(m.fecha) - Date.parse(antes.fecha) < 5 * 60e3;
    antes = m;
    if (m.bot) {
      return `<div class="chat-msg chat-bot${k.id === 'general' ? ' chat-bot-general' : ''}"><span class="avatar chat-avatar chat-avatar-bot" aria-hidden="true">🧝</span>
        <div class="chat-burbuja"><div class="chat-cab"><b>${esc(m.nombre)}</b> <span class="chat-etiqueta">bot</span> <time>${esc(hora(m.fecha))}</time></div>
        <div class="chat-texto">${esc(textoBot(m.texto))}</div></div>${moderar(m)}</div>`;
    }
    return `<div class="chat-msg${mio ? ' chat-mio' : ''}${seguido ? ' chat-seguido' : ''}">
      ${mio ? '' : avatar.html(m.autor, m.avatar, inicial(m.nombre), 'avatar chat-avatar', m.nombre)}
      <div class="chat-burbuja">${seguido ? '' : `<div class="chat-cab">${mio ? '' : `<b>${esc(m.nombre)}</b> `}<time>${esc(hora(m.fecha))}</time></div>`}
      <div class="chat-texto">${esc(m.texto)}</div></div>${moderar(m)}</div>`;
  }).join('');
}

async function enviar() {
  const caja = $('chatTexto');
  const texto = caja.value.trim();
  if (!texto) return;
  const boton = $('chatEnviar');
  boton.disabled = true;
  try {
    const privado = vista === 'conv' && conv;
    const k = canalVista();
    const r = privado ? await auth.apiMesa('/api/privados/enviar', { para: conv.clave, texto })
      : await auth.apiMesa(k.urlEnviar, { texto });
    if (!r.ok) { sync.aviso(r.mensaje || 'No se pudo mandar el mensaje.', 'error'); return; }
    caja.value = '';
    caja.style.height = 'auto';
    if (privado) await traerConv(); else await traerNuevos(k, r.id);
    $('chatLista').scrollTop = $('chatLista').scrollHeight;
  } finally {
    boton.disabled = false;
    caja.focus();
  }
}

function alternarAjustes() {
  const f = $('chatBotForm');
  if (!f.hidden) { f.hidden = true; return; }
  $('chatBotNombre').value = bot.nombre;
  $('chatBotBienvenida').value = bot.bienvenida;
  $('chatBotError').textContent = '';
  f.hidden = false;
  $('chatBotNombre').focus();
}

async function guardarBot() {
  const r = await auth.apiMesa('/api/chat/bot', { nombre: $('chatBotNombre').value, bienvenida: $('chatBotBienvenida').value });
  if (!r.ok) { $('chatBotError').textContent = r.mensaje || 'No se pudo guardar.'; return; }
  bot = r.bot;
  $('chatBotForm').hidden = true;
  sync.aviso(`🧝 Guardado. El bot se llama ahora «${bot.nombre}».`);
}

async function borrar(id) {
  const k = canalVista();
  const m = k?.mensajes.find(x => x.id === id);
  if (!m) return;
  const corto = (m.bot ? textoBot(m.texto) : m.texto).slice(0, 80);
  if (!confirm(`¿Borrar este mensaje de ${m.nombre} para todos?\n\n«${corto}${m.texto.length > 80 ? '…' : ''}»`)) return;
  const r = await auth.apiMesa(k.urlBorrar, { id });
  if (!r.ok) { sync.aviso(r.mensaje || 'No se pudo borrar.', 'error'); return; }
  k.mensajes = k.mensajes.filter(x => x.id !== id);
  k.borrados++;
  pintarLista(k);
}

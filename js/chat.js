// chat.js — el chat de la mesa (V3.9).
//
// Cada campaña tiene su chat: lo leen y escriben los que juegan en ella (y el superusuario).
// Se abre con el botón 💬 de la cabecera; el número rojo son los mensajes sin leer.
// El bot de la mesa (por defecto «Dobby») anuncia en el chat a quien entra en la mesa por
// PRIMERA vez. El DM de la mesa (y el superusuario) le cambian el nombre y el mensaje de
// bienvenida con ⚙️; en la bienvenida, {nombre} = quien llega y {mesa} = el nombre de la mesa.
//
// Cómo se entera de los mensajes nuevos: cada sondeo de sync.js trae el id del último mensaje
// ('chat' en /api/estado). Si es mayor que el último que tiene, pide solo los nuevos.
// Lo leído se apunta en este navegador (localStorage), por cuenta y por mesa.
//
// Moderación: el DM de la mesa y el superusuario tienen una 🗑️ en cada mensaje para retirarlo (para todos).
// El sondeo trae también cuántos mensajes se han retirado ('chatBorrados'); si cambia, se recarga la lista.
// El bot avisa además de cuándo se apaga y se enciende el servidor y de las versiones nuevas; en sus
// mensajes, {{hora:FECHA}} se pinta con la hora de quien lo lee («hoy a las 16:13»).
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as avatar from './avatar.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inicial = n => (String(n || '').trim()[0] || '?').toUpperCase();
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const kLeido = () => `taberna.chatLeido:${auth.usuario?.clave || '-'}:${auth.mesa?.id || '-'}`;

let activo = false;
let mensajes = [];
let ultimo = 0;          // el último id que tenemos
let hayAnteriores = false;
let bot = { nombre: 'Dobby', bienvenida: '' };
let puedeEditarBot = false;
let pidiendo = false;
let pendienteUltimo = 0; // llegó un aviso de mensajes nuevos mientras se pedían otros
let borrados = 0;        // cuántos mensajes ha retirado la moderación (si cambia, se recarga)

const $ = id => document.getElementById(id);
const panelChat = () => $('chatPanel');
export const abierto = () => !!panelChat() && !panelChat().hidden;
const leido = () => Number(lsGet(kLeido()) || 0);

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
  await cargar();
}

async function cargar() {
  const r = await sync.pedir('/api/chat').catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  mensajes = r.j.mensajes || [];
  hayAnteriores = mensajes.length >= 60;
  ultimo = Math.max(r.j.ultimo || 0, ...mensajes.map(m => m.id));
  bot = r.j.bot || bot;
  puedeEditarBot = !!r.j.puedeEditarBot;
  borrados = r.j.borrados || 0;
  // La primera vez en esta mesa (en este navegador) no se marca como sin leer todo lo anterior,
  // salvo lo de las últimas horas
  if (lsGet(kLeido()) == null) {
    const hace = Date.now() - 6 * 3600e3;
    const viejos = mensajes.filter(m => Date.parse(m.fecha) < hace);
    lsSet(kLeido(), String(viejos.length ? viejos[viejos.length - 1].id : 0));
  }
  pintar();
}

// Lo llama el sondeo (sync.js → app.js) con el id del último mensaje de la mesa
export function alSondeo(n, b) {
  if (!activo || typeof n !== 'number') return;
  if (typeof b === 'number' && b !== borrados) { borrados = b; cargar(); return; }   // la moderación retiró algo
  if (n > ultimo) traerNuevos(n);
  else if (n < ultimo) cargar();   // no debería pasar (base restaurada): se vuelve a cargar entero
}

async function traerNuevos(n) {
  if (pidiendo) { pendienteUltimo = Math.max(pendienteUltimo, n); return; }
  pidiendo = true;
  try {
    const r = await sync.pedir('/api/chat?desde=' + ultimo).catch(() => null);
    if (!r || r.status !== 200 || !r.j?.ok) return;
    bot = r.j.bot || bot;
    puedeEditarBot = !!r.j.puedeEditarBot;
    const conocidos = new Set(mensajes.map(m => m.id));
    const nuevos = (r.j.mensajes || []).filter(m => !conocidos.has(m.id));
    if (!nuevos.length) { ultimo = Math.max(ultimo, r.j.ultimo || 0); pintarContador(); return; }
    mensajes.push(...nuevos);
    if (mensajes.length > 500) { mensajes = mensajes.slice(-500); hayAnteriores = true; }
    ultimo = Math.max(ultimo, ...nuevos.map(m => m.id));
    // Aviso pequeño si el chat está cerrado y el mensaje es de otro
    if (!abierto()) {
      for (const m of nuevos.filter(m => m.autor !== auth.usuario?.clave).slice(-2)) {
        const plano = m.bot ? textoBot(m.texto) : m.texto;
        const t = plano.length > 90 ? plano.slice(0, 90) + '…' : plano;
        sync.aviso(`${m.bot ? '🧝' : '💬'} ${m.nombre}: ${t}`);
      }
    }
    pintar();
  } finally {
    pidiendo = false;
    if (pendienteUltimo > ultimo) { const p = pendienteUltimo; pendienteUltimo = 0; traerNuevos(p); }
  }
}

async function cargarAnteriores() {
  if (!mensajes.length) return;
  const r = await sync.pedir('/api/chat?antes=' + mensajes[0].id).catch(() => null);
  if (!r || r.status !== 200 || !r.j?.ok) return;
  const viejos = r.j.mensajes || [];
  hayAnteriores = viejos.length >= 60;
  const lista = $('chatLista');
  const alto = lista.scrollHeight;
  mensajes = [...viejos, ...mensajes];
  pintarLista();
  lista.scrollTop = lista.scrollHeight - alto;   // que no salte
}

function abrir() {
  const p = panelChat();
  p.hidden = false;
  $('chatBtn').setAttribute('aria-expanded', 'true');
  document.body.classList.add('chat-abierto');
  pintar();
  const lista = $('chatLista');
  lista.scrollTop = lista.scrollHeight;
  marcarLeido();
  if (window.matchMedia('(pointer:fine)').matches) $('chatTexto').focus();
}

function cerrar() {
  panelChat().hidden = true;
  $('chatBtn').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('chat-abierto');
  $('chatBotForm').hidden = true;
}

function marcarLeido() {
  if (ultimo > leido()) lsSet(kLeido(), String(ultimo));
  pintarContador();
}

function sinLeer() {
  const l = leido();
  return mensajes.filter(m => m.id > l && m.autor !== auth.usuario?.clave).length;
}

function pintarContador() {
  const n = abierto() ? 0 : sinLeer();
  const c = $('chatContador');
  c.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
  $('chatBtn').title = n ? `Chat de la mesa · ${n} sin leer` : 'Chat de la mesa';
}

function pintar() {
  if (!activo) return;
  $('chatTitulo').textContent = auth.mesa?.nombre || 'Chat de la mesa';
  $('chatAjustesBtn').hidden = !puedeEditarBot;
  const lista = $('chatLista');
  const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
  pintarLista();
  if (abierto()) {
    if (abajo) lista.scrollTop = lista.scrollHeight;
    marcarLeido();
  } else pintarContador();
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

function pintarLista() {
  const yo = auth.usuario?.clave;
  $('chatAnteriores').hidden = !hayAnteriores;
  if (!mensajes.length) {
    $('chatMensajes').innerHTML = `<p class="chat-vacio">Aún no hay mensajes en esta mesa. ¡Saluda!</p>`;
    return;
  }
  let antes = null;
  const moderar = m => puedeEditarBot
    ? `<button type="button" class="chat-borrar" data-chat-borrar="${m.id}" title="Borrar este mensaje (para todos)" aria-label="Borrar mensaje">🗑️</button>` : '';
  $('chatMensajes').innerHTML = mensajes.map(m => {
    const mio = m.autor === yo;
    const seguido = antes && antes.autor === m.autor && Date.parse(m.fecha) - Date.parse(antes.fecha) < 5 * 60e3;
    antes = m;
    if (m.bot) {
      return `<div class="chat-msg chat-bot"><span class="avatar chat-avatar chat-avatar-bot" aria-hidden="true">🧝</span>
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
    const r = await auth.apiMesa('/api/chat/enviar', { texto });
    if (!r.ok) { sync.aviso(r.mensaje || 'No se pudo mandar el mensaje.', 'error'); return; }
    caja.value = '';
    caja.style.height = 'auto';
    await traerNuevos(r.id);
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
  const m = mensajes.find(x => x.id === id);
  if (!m) return;
  const corto = (m.bot ? textoBot(m.texto) : m.texto).slice(0, 80);
  if (!confirm(`¿Borrar este mensaje de ${m.nombre} para todos?\n\n«${corto}${m.texto.length > 80 ? '…' : ''}»`)) return;
  const r = await auth.apiMesa('/api/chat/borrar', { id });
  if (!r.ok) { sync.aviso(r.mensaje || 'No se pudo borrar.', 'error'); return; }
  mensajes = mensajes.filter(x => x.id !== id);
  borrados++;
  pintarLista();
}

// inventario.js — el inventario único (V3.8): todo lo que llevas en una sola lista.
//
// Objetos, materiales, pociones, botín, libros y odres salen juntos, por secciones, con un solo
// buscador y filtros por clase, por oficio y por «mágico». Cada cosa se puede dar a otro jugador
// de la mesa (🤝): el servidor lo hace en una sola transacción (se te quita y se le pone, o nada).
// Quien no es alquimista ve los materiales alquímicos como «Material alquímico», sin más.
import { state, saveState } from './state.js';
import * as sync from './sync.js';
import * as auth from './auth.js';
import * as filtros from './filtros.js';
import * as objetos from './objetos.js';
import * as odres from './odres.js';
import * as lectura from './lectura.js';
import { CAMPOS } from './data.js';
import { nombreMat, catBadge, purityRoman, parsePotKey, parsedToCatKey, getAplicOption } from './utils.js';
import { filaMaterial, buildPotDetail } from './render.js';
import { hasMaleficio } from './model.js';
import { esAlquimista, infoOculta } from './conocimiento.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abiertos = new Set();

// ---- Filtros de la barra (el buscador lo pone filtros.js) ----
const CLASES = [
  ['objetos', '🎒 Objetos'], ['materiales', '⚗️ Materiales'], ['pociones', '🧪 Pociones'],
  ['botin', '🔍 Botín'], ['libros', '📖 Libros'], ['odres', '🫙 Odres'],
];
const OFICIOS = [['alquimia', '⚗️ Alquimia'], ['herreria', '⚒️ Herrería'], ['hechiceria', '✨ Hechicería'], ['cocina', '🍲 Cocina'], ['lectura', '📖 Lectura']];
filtros.grupo('inv', 'clase', [['', 'Todo'], ...CLASES]);
filtros.grupo('inv', 'oficio', [['', 'Cualquier oficio'], ...OFICIOS]);
filtros.grupo('inv', 'marca', [['', 'Todo'], ['magico', '✨ Mágico'], ['equipado', '✋ Equipado']]);

// A qué oficio pertenece cada objeto según su categoría
const OFICIO_OBJETO = { arma: 'herreria', armadura: 'herreria', pergamino: 'hechiceria', consumible: 'cocina' };

const dar = (c, id, extra = '') => auth.servidor && sync.modo === 'servidor'
  ? `<button class="btn btn-sm btn-dar" data-inv="dar" data-c="${c}" data-id="${esc(id)}" ${extra} title="Dárselo a otro jugador de la mesa">🤝</button>` : '';

// ---- Lo que hay, como elementos de la lista ----
function elementos() {
  const alq = esAlquimista();
  const out = [];
  for (const [id, o] of objetos.ordenar(state.objetos)) out.push({
    clase: 'objetos', id, o, oficio: OFICIO_OBJETO[o.categoria] || '', magico: objetos.esMagico(o), equipado: !!o.equipado,
    texto: objetos.textoBusqueda(o),
    html: () => objetos.tarjeta(id, o, false, dar('objetos', id)),
  });
  for (const id of Object.keys(state.inventory || {})) {
    const n = state.inventory[id] || 0, m = state.catalog[id];
    if (!m || n <= 0) continue;
    const generico = !alq, oculto = generico || infoOculta(m);
    out.push({
      clase: 'materiales', id, oficio: 'alquimia', magico: !oculto && m.campo === 'Mágico', orden: generico ? 'Material alquímico' : nombreMat(m),
      texto: generico ? ['material alquímico'] : oculto ? [m.name, m.lugar, m.type, 'sin identificar'] : [m.name, m.lugar, m.type, m.modKind, m.campo, m.polaridad, m.rarity],
      html: () => filaMaterial(id, m, n, { generico, extra: dar('inventory', id) }),
    });
  }
  for (const [pk, p] of Object.entries(state.potions || {})) {
    if (!(p?.qty > 0)) continue;
    const apodo = state.potionCatalog[parsedToCatKey(parsePotKey(pk))]?.apodo;
    out.push({ clase: 'pociones', id: pk, oficio: 'alquimia', magico: p.campo === 'Mágico', orden: p.name || '',
      texto: [p.name, apodo, p.campo, p.polaridad, 'poción'], html: () => filaPocion(pk, p, apodo, alq) });
  }
  for (const [id, l] of Object.entries(state.lootPotions || {})) {
    if (!(l?.qty > 0)) continue;
    out.push({ clase: 'botin', id, oficio: 'alquimia', orden: l.name || '',
      texto: [l.name, l.tipo, l.descripcion, l.identificada ? 'identificada' : 'sin identificar', 'botín poción'], html: () => filaBotin(id, l, alq) });
  }
  for (const [id, l] of Object.entries(state.libros || {})) out.push({ clase: 'libros', id, oficio: 'lectura', orden: l.name || '',
    texto: [l.name, l.bono, l.descripcion, 'libro'], html: () => filaLibro(id, l) });
  for (const [id, o] of odres.lista()) out.push({ clase: 'odres', id, oficio: 'alquimia', magico: o.disolvente === 'Mágico', orden: o.name || '',
    texto: ['odre', o.name, o.disolvente ? odres.nombreDisolvente(o.disolvente) : 'vacío'], html: () => filaOdre(id, o) });
  return out;
}

function filaPocion(pk, pot, apodo, alq) {
  const parsed = parsePotKey(pk);
  const pureza = parsed?.purity > 0 ? 'Pureza ' + purityRoman(parsed.purity) : 'Sin purificar';
  const efectos = pot.isMulti && pot.components?.length ? pot.components.flatMap(c => c.effects || []) : pot.effects;
  const benef = pot.polaridad === 'Neutro' ? !hasMaleficio(efectos) : pot.polaridad !== 'Maleficioso';
  const aplic = pot.aplicacion?.length ? pot.aplicacion.map(a => getAplicOption(a)?.label.split(' ')[0] ?? a).join(', ') : '';
  const k = 'pot:' + pk, abierto = abiertos.has(k);
  return `<div class="inv-item inv-pocion inv-${esc(({ Cuerpo: 'cuerpo', Mente: 'mente', Alma: 'alma', 'Mágico': 'magico' })[pot.campo] || 'magico')}">
      <span class="inv-sello" aria-hidden="true">🧪</span>
      <div class="inv-info">
        <button type="button" class="obj-nombre" data-inv="detalle" data-k="${esc(k)}" aria-expanded="${abierto}">${esc(pot.name || 'Poción')}${apodo ? ` <em class="apodo-badge">"${esc(apodo)}"</em>` : ''} <span class="obj-flecha">${abierto ? '▾' : '▸'}</span></button>
        <div class="inv-etiquetas">${catBadge(pot.campo, pot.polaridad)} <span class="etq">${pureza}</span>${aplic ? `<span class="etq">💊 ${esc(aplic)}</span>` : ''}</div>
        ${abierto ? `<div class="obj-detalle">${buildPotDetail(pot)}</div>` : ''}
      </div>
      <div class="inv-stepper">
        <span class="stepper-count" title="Cantidad">×${pot.qty}</span>
        <button class="btn btn-sm" data-action="use-pot" data-id="${esc(pk)}">${benef ? '🍵 Beber' : '⚔️ Aplicar'}</button>
        ${alq ? `<button class="btn btn-sm btn-edit" data-action="set-apodo" data-id="${esc(pk)}" title="Ponerle un apodo">🏷️</button>` : ''}
        ${dar('potions', pk)}
        <button class="btn btn-sm btn-danger" data-action="del-pot" data-id="${esc(pk)}" title="Tirar la pila">🗑️</button>
      </div>
    </div>`;
}

function filaBotin(id, l, alq) {
  const k = 'loot:' + id, abierto = abiertos.has(k);
  return `<div class="inv-item inv-botin">
      <span class="inv-sello" aria-hidden="true">🔍</span>
      <div class="inv-info">
        <button type="button" class="obj-nombre" data-inv="detalle" data-k="${esc(k)}" aria-expanded="${abierto}">${esc(l.name || 'Poción')} <span class="obj-flecha">${abierto ? '▾' : '▸'}</span></button>
        <div class="inv-etiquetas">${l.identificada ? `<span class="etq">✅ ${esc(l.tipo)}</span>` : '<span class="etq etq-sin-id">❔ Sin identificar</span>'}<span class="etq">Botín</span></div>
        ${abierto ? `<div class="obj-detalle"><textarea rows="2" class="inv-nota" data-action="loot-desc" data-id="${esc(id)}" placeholder="Notas: color, olor, dónde se encontró…">${esc(l.descripcion || '')}</textarea></div>` : ''}
      </div>
      <div class="inv-stepper">
        <span class="stepper-count" title="Cantidad">×${l.qty}</span>
        ${!l.identificada && alq ? `<button class="btn btn-sm btn-info" data-action="identify-loot" data-id="${esc(id)}" title="Ingeniería inversa: gasta una">🔍 Identificar</button>` : ''}
        <button class="btn btn-sm" data-action="use-loot" data-id="${esc(id)}">🧪 Usar</button>
        ${dar('lootPotions', id)}
        <button class="btn btn-sm btn-danger" data-action="del-loot" data-id="${esc(id)}" title="Tirar">🗑️</button>
      </div>
    </div>`;
}

function filaLibro(id, l) {
  const e = lectura.estadoLibro(l);
  return `<div class="inv-item inv-libro">
      <span class="inv-sello" aria-hidden="true">📖</span>
      <div class="inv-info">
        <div class="inv-nombre">${esc(l.name)}</div>
        <div class="inv-etiquetas"><span class="etq">${e.hecho}/${e.total} lecturas${e.terminado ? ' · terminado' : ''}</span>${l.bono ? `<span class="etq">✨ ${esc(l.bono)}</span>` : ''}</div>
      </div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-action="switch-tab" data-id="lectura" title="Ir a Lectura">📖 Leer</button>
        ${dar('libros', id, 'data-aviso="Quien lo reciba empezará a leerlo desde el principio."')}
      </div>
    </div>`;
}

function filaOdre(id, o) {
  return `<div class="inv-item inv-odre">
      <span class="inv-sello" aria-hidden="true">🫙</span>
      <div class="inv-info">
        <div class="inv-nombre">${esc(o.name)} <span class="muted">· ${odres.litros(o.capacidad)}</span></div>
        ${odres.barra(o)}
        <div class="inv-etiquetas"><span class="etq">${odres.textoOdre(o)}</span></div>
      </div>
      <div class="inv-stepper">${dar('odres', id)}</div>
    </div>`;
}

function pasa(x) {
  const e = filtros.estado('inv');
  if (e.clase && x.clase !== e.clase) return false;
  if (e.oficio && x.oficio !== e.oficio) return false;
  if (e.marca === 'magico' && !x.magico) return false;
  if (e.marca === 'equipado' && !x.equipado) return false;
  return filtros.coincide('inv', ...x.texto);
}

const TITULOS = { objetos: '🎒 Objetos', materiales: '⚗️ Materiales alquímicos', pociones: '🧪 Pociones', botin: '🔍 Botín sin identificar', libros: '📖 Libros', odres: '🫙 Odres' };

let pendiente = false;
export function render() {
  if (pendiente) return;
  pendiente = true;
  requestAnimationFrame(() => { pendiente = false; pintar(); });
}

function pintar() {
  const el = document.getElementById('invLista');
  if (!el) return;
  const todos = elementos();
  const vistos = todos.filter(pasa);
  filtros.cuenta('inv', vistos.length, todos.length);
  if (!todos.length) {
    el.innerHTML = '<p class="muted">Todavía no llevas nada. Apunta aquí tus armas, armaduras y el resto de tu equipo con «➕ Objeto».</p>';
    return;
  }
  if (!vistos.length) { el.innerHTML = filtros.vacio('inv'); return; }
  const foco = document.activeElement?.matches?.('#invLista textarea') ? document.activeElement.dataset.id : null;
  if (foco) return;   // no machacar una nota a medio escribir
  el.innerHTML = CLASES.map(([c]) => {
    const lista = vistos.filter(x => x.clase === c);
    if (!lista.length) return '';
    if (c !== 'objetos') lista.sort((a, b) => String(a.orden).localeCompare(String(b.orden), 'es'));
    const n = c === 'materiales' ? lista.reduce((t, x) => t + (state.inventory[x.id] || 0), 0) : lista.length;
    return `<section class="inv-grupo inv-grupo-${c}"><h3 class="inv-grupo-titulo">${TITULOS[c]} <span class="muted">· ${n}</span></h3>
      ${lista.map(x => x.html()).join('')}</section>`;
  }).join('');
}

// ---- Dar a otro jugador ----
let companeros = null;
async function cargarCompaneros() {
  try {
    const r = await sync.pedir('/api/mesa/perfiles');
    if (r.status === 200 && r.j?.ok) companeros = r.j.perfiles.filter(p => p.clave !== auth.usuario?.clave);
  } catch (_) {}
  return companeros || [];
}

function nombreDe(c, id) {
  if (c === 'inventory') return esAlquimista() ? nombreMat(state.catalog[id]) : 'material alquímico';
  if (c === 'potions') return state.potions[id]?.name || 'poción';
  if (c === 'lootPotions') return state.lootPotions[id]?.name || 'poción';
  if (c === 'objetos') return state.objetos[id]?.name || 'objeto';
  if (c === 'libros') return state.libros[id]?.name || 'libro';
  if (c === 'odres') return 'un odre';
  return 'eso';
}
function cuantosHay(c, id) {
  if (c === 'inventory') return state.inventory[id] || 0;
  if (c === 'potions') return state.potions[id]?.qty || 0;
  if (c === 'lootPotions') return state.lootPotions[id]?.qty || 0;
  if (c === 'objetos') return state.objetos[id]?.cantidad ?? 1;
  return 1;
}

async function dialogoDar(c, id, aviso) {
  document.getElementById('darDialogo')?.remove();
  const lista = companeros || await cargarCompaneros();
  if (!lista.length) { alert('No hay nadie más en esta mesa a quien dárselo.'); return; }
  const max = cuantosHay(c, id);
  const nombre = nombreDe(c, id);
  const conCantidad = max > 1;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="foto-fondo" id="darDialogo" role="dialog" aria-modal="true" aria-labelledby="darTitulo">
      <form class="foto-caja dar-caja" novalidate>
        <h3 id="darTitulo">🤝 Dar ${esc(nombre)}</h3>
        <label class="perfil-campo"><span>¿A quién?</span>
          <select name="u" required>${lista.map(p => `<option value="${esc(p.clave)}">${p.rol === 'dm' ? '👑 ' : ''}${esc(p.nombre)}${p.personaje?.nombre ? ' · ' + esc(p.personaje.nombre) : ''}</option>`).join('')}</select></label>
        ${conCantidad ? `<label class="perfil-campo"><span>¿Cuántos? <span class="muted">(tienes ${max})</span></span>
          <input name="n" type="number" min="1" max="${max}" value="1"></label>` : ''}
        ${aviso ? `<p class="muted">${esc(aviso)}</p>` : ''}
        <p class="entrada-error" role="alert"></p>
        <div class="foto-botones">
          <button type="submit" class="btn">🤝 Dar</button>
          <button type="button" class="btn" style="background:#777" data-cerrar>Cancelar</button>
        </div>
      </form>
    </div>`);
  const d = document.getElementById('darDialogo'), f = d.querySelector('form');
  const cerrar = () => { d.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrar(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const u = f.u.value;
    const n = conCantidad ? Math.max(1, Math.min(max, parseInt(f.n.value) || 1)) : 1;
    const quien = lista.find(p => p.clave === u)?.nombre || u;
    const boton = f.querySelector('button[type="submit"]');
    boton.disabled = true;
    // Primero, que se guarde lo que hubiera pendiente (la entrega va directa al servidor)
    for (let i = 0; i < 30 && sync.pendientes(); i++) await new Promise(r => setTimeout(r, 100));
    const op = { t: 'dar', c, id, u };
    if (c !== 'odres' && c !== 'libros') op.n = n;
    const r = await sync.transaccionDirecta([op], `dio ${conCantidad ? n + ' × ' : ''}${nombre} a ${quien}`);
    if (!r.ok) { d.querySelector('.entrada-error').textContent = r.mensaje; boton.disabled = false; return; }
    cerrar();
    sync.aviso(`🤝 Le has dado ${conCantidad ? n + ' × ' : ''}${nombre} a ${quien}.`);
  });
  setTimeout(() => f.u.focus(), 0);
}

export function init() {
  document.addEventListener('inventario:repintar', render);
  const caja = document.getElementById('invSub-todo');
  if (!caja) return;
  caja.addEventListener('click', e => {
    const b = e.target.closest('[data-inv]');
    if (!b || b.disabled) return;
    const a = b.dataset.inv;
    if (a === 'detalle') { const k = b.dataset.k; abiertos.has(k) ? abiertos.delete(k) : abiertos.add(k); render(); }
    else if (a === 'dar') dialogoDar(b.dataset.c, b.dataset.id, b.dataset.aviso);
    else if (a === 'nuevo-loot') {
      import('./form.js').then(f => { if (f.addLoot()) render(); });
    }
  });
}

// Para la tarjeta de la mesa
export function cuantoLlevas() { return elementos().length; }


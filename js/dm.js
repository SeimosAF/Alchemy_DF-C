// dm.js — herramientas del DM: ver y cambiar el inventario de cada jugador,
// sus libros (casillas con tirada y su CD) y su nivel de alquimia.
//
// Todo cambio es una transacción del servidor (todo o nada), igual que las de
// los jugadores:
//   - "+1 / −1" se manda como suma/resta: nunca se pisa lo que haga el jugador a la vez.
//   - "poner exactamente N" lleva el valor que el DM estaba viendo: si el jugador
//     lo cambió entretanto, el servidor lo rechaza y la lista se pone al día.
//   - Nada puede quedar por debajo de 0.
import { state, genId } from './state.js';
import * as sync from './sync.js';
import * as auth from './auth.js';
import { rarityBadge, campoClass } from './utils.js';
import * as niveles from './niveles.js';
import * as lectura from './lectura.js';

let jugadores = [];
let elegido = null;       // clave del jugador que se está mirando
let cargado = false;
let ocupado = false;

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sinQty = v => { const { qty, ...r } = v || {}; return r; };
const nombreMat = id => { const m = state.catalog[id]; return m ? (m.unknown ? '???' : m.name) : 'material borrado'; };

export function visible() {
  const el = document.getElementById('invSub-dm');
  return !!el && el.style.display !== 'none' && document.getElementById('tab-inventario')?.classList.contains('active');
}

export async function recargar() {
  if (!auth.esDM() || !auth.servidor) return;
  try {
    const r = await sync.pedir('/api/jugadores');
    if (r.status !== 200 || !r.j?.ok) return;
    jugadores = r.j.jugadores;
    cargado = true;
    if (!elegido || !jugadores.some(j => j.clave === elegido))
      elegido = (jugadores.find(j => j.clave !== auth.usuario.clave) || jugadores[0])?.clave || null;
    render();
  } catch (_) {}
}

export function elegir(clave) { elegido = clave; render(); }

export function render() {
  const el = document.getElementById('dmPanel');
  if (!el) return;
  if (!auth.servidor) { el.innerHTML = '<p class="muted">Las herramientas del DM necesitan el servidor.</p>'; return; }
  if (!auth.esDM()) { el.innerHTML = '<p class="muted">Solo el DM puede ver esto.</p>'; return; }
  if (!cargado) { el.innerHTML = '<p class="muted">Abriendo los cofres de la mesa…</p>'; recargar(); return; }
  const j = jugadores.find(x => x.clave === elegido);
  const foco = document.activeElement?.dataset?.dmSet;   // no machacar un número a medio escribir
  if (foco && el.contains(document.activeElement)) return;
  if (el.contains(document.activeElement) && document.activeElement.matches('[data-dm-pruebas], #dmLibroNombre, #dmLibroBono, #dmLibroN, #dmLibroPruebas')) return;

  const chips = jugadores.map(x => `<button class="dm-chip ${x.clave === elegido ? 'activo' : ''}" data-dm="elegir" data-clave="${esc(x.clave)}">
      ${x.rol === 'dm' ? '👑' : '⚔️'} ${esc(x.nombre)}${x.clave === auth.usuario.clave ? ' (tú)' : ''}</button>`).join('');
  if (!j) { el.innerHTML = `<div class="dm-chips">${chips}</div><p class="muted">No hay jugadores todavía.</p>`; return; }

  // Materiales: todos los del catálogo, con lo que tiene este jugador
  const ids = Object.keys(state.catalog).sort((a, b) => nombreMat(a).localeCompare(nombreMat(b)));
  const filtro = (document.getElementById('dmFiltro')?.value || '').toLowerCase();
  const soloConStock = document.getElementById('dmSoloStock')?.checked ?? false;
  const filas = ids.filter(id => (!filtro || nombreMat(id).toLowerCase().includes(filtro)) && (!soloConStock || (j.inventory[id] || 0) > 0))
    .map(id => {
      const m = state.catalog[id], n = j.inventory[id] || 0;
      return `<div class="inv-row ${n ? '' : 'dm-cero'}">
        <div class="inv-name"><span class="badge badge-${campoClass(m.campo)}" style="margin-right:4px">${esc(m.type?.[0] || '?')}</span>${esc(nombreMat(id))} ${rarityBadge(m.rarity)}</div>
        <div class="inv-stepper">
          <button class="btn btn-sm" data-dm="mat" data-id="${esc(id)}" data-n="-1" ${n ? '' : 'disabled'}>−</button>
          <input type="number" min="0" class="dm-num" value="${n}" data-dm-set="${esc(id)}" data-antes="${n}" title="Escribe la cantidad exacta y pulsa Intro">
          <button class="btn btn-sm" data-dm="mat" data-id="${esc(id)}" data-n="1">+</button>
        </div>
      </div>`;
    }).join('') || '<p class="muted">Ningún material coincide.</p>';

  // Pociones elaboradas de este jugador
  const pots = Object.entries(j.potions).filter(([, p]) => p.qty > 0);
  const filasPot = pots.map(([pk, p]) => `<div class="inv-row">
      <div class="inv-name">🧪 ${esc(p.name || 'Poción')}</div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-dm="pot" data-id="${esc(pk)}" data-n="-1">−</button>
        <span class="stepper-count">${p.qty}</span>
        <button class="btn btn-sm" data-dm="pot" data-id="${esc(pk)}" data-n="1">+</button>
        <button class="btn btn-sm btn-danger" data-dm="pot-quitar" data-id="${esc(pk)}" title="Quitar toda la pila">🗑️</button>
      </div></div>`).join('') || '<p class="muted">No lleva pociones elaboradas.</p>';

  // Cualquier poción que exista en la mesa se le puede dar (copia de su ficha)
  const todas = new Map();
  for (const x of jugadores) for (const [pk, p] of Object.entries(x.potions)) if (!todas.has(pk)) todas.set(pk, p);
  const optsPot = [...todas.entries()].map(([pk, p]) => `<option value="${esc(pk)}">${esc(p.name || 'Poción')}</option>`).join('');

  const loot = Object.entries(j.lootPotions).filter(([, p]) => p.qty > 0);
  const filasLoot = loot.map(([id, p]) => `<div class="inv-row">
      <div class="inv-name">🔍 ${esc(p.name || 'Poción')} ${p.identificada ? `<span class="muted">· ${esc(p.tipo)}</span>` : '<span class="muted">· sin identificar</span>'}</div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-dm="loot" data-id="${esc(id)}" data-n="-1">−</button>
        <span class="stepper-count">${p.qty}</span>
        <button class="btn btn-sm" data-dm="loot" data-id="${esc(id)}" data-n="1">+</button>
        <button class="btn btn-sm btn-danger" data-dm="loot-quitar" data-id="${esc(id)}" title="Quitar">🗑️</button>
      </div></div>`).join('') || '<p class="muted">No lleva botín.</p>';

  // Nivel de alquimia de este jugador
  const nivel = niveles.nivelDePerfil(j.perfil, false);
  const bloqueNivel = `<div class="dm-nivel">
      <span class="nivel-insignia nivel-insignia-sm"><span class="nivel-num">${nivel}</span><span class="nivel-de">/${niveles.NIVEL_MAX}</span></span>
      <div class="dm-nivel-info"><b>⚗️ Nivel de alquimia:</b> ${esc(niveles.tituloNivel(nivel))}
        <div class="muted">Al subirlo, ${esc(j.nombre)} encontrará una página nueva en el diario de Jhon Arbaquel.</div></div>
      <button class="btn btn-sm" data-dm="nivel" data-n="-1" ${nivel <= 1 ? 'disabled' : ''}>−</button>
      <button class="btn btn-sm" data-dm="nivel" data-n="1" ${nivel >= niveles.NIVEL_MAX ? 'disabled' : ''}>+ Subir</button>
    </div>`;

  // Libros de este jugador
  const libros = Object.entries(j.libros || {});
  const filasLibros = libros.map(([id, l]) => {
    const e = lectura.estadoLibro(l);
    return `<div class="dm-libro">
      <div><b>📖 ${esc(l.name)}</b> <span class="muted">· ${e.hecho}/${e.total}${e.terminado ? ' · terminado' : ''}</span></div>
      ${lectura.htmlCasillas(l, true)}
      <div class="dm-dar">
        <input type="text" data-dm-pruebas="${esc(id)}" value="${esc(lectura.textoPruebas(l.pruebas))}" placeholder="Casillas con tirada: 4:14, 8:16" title="casilla:CD separadas por comas">
        <button class="btn btn-sm btn-edit" data-dm="libro-pruebas" data-id="${esc(id)}">Guardar tiradas</button>
        <button class="btn btn-sm btn-danger" data-dm="libro-quitar" data-id="${esc(id)}" title="Quitar libro">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<p class="muted">No lleva libros.</p>';

  el.innerHTML = `
    <div class="dm-chips">${chips}</div>
    <p class="muted dm-ayuda">Estás cambiando el inventario de <strong>${esc(j.nombre)}</strong>${j.baneado ? ' <b>(desterrado)</b>' : ''}. Cada cambio se guarda al momento y ${esc(j.nombre)} lo ve en unos segundos.</p>
    ${bloqueNivel}
    <div class="dm-grid">
      <div class="dm-col">
        <h3>📦 Materiales</h3>
        <div class="dm-filtros">
          <input type="search" id="dmFiltro" placeholder="Buscar material…" value="${esc(filtro)}">
          <label class="check-label"><input type="checkbox" id="dmSoloStock" ${soloConStock ? 'checked' : ''}> Solo lo que tiene</label>
        </div>
        <div class="dm-lista">${filas}</div>
      </div>
      <div class="dm-col">
        <h3>🧪 Pociones</h3>
        ${filasPot}
        ${optsPot ? `<div class="dm-dar">
          <select id="dmDarPot">${optsPot}</select>
          <input type="number" id="dmDarPotN" min="1" value="1" class="dm-num">
          <button class="btn btn-sm" data-dm="dar-pot">🎁 Dar</button>
        </div>` : ''}
        <h3>🔍 Botín sin identificar</h3>
        ${filasLoot}
        <div class="dm-dar">
          <input type="text" id="dmLootNombre" placeholder="Nombre del botín (p. ej. Frasco turbio)">
          <input type="number" id="dmLootN" min="1" value="1" class="dm-num">
          <button class="btn btn-sm" data-dm="dar-loot">🎁 Dar</button>
        </div>
        <input type="text" id="dmLootDesc" class="dm-desc" placeholder="Descripción secreta (opcional, la verá el jugador)">
        <h3>📚 Libros</h3>
        <p class="muted dm-nota">Casillas con tirada: «casilla:CD» separadas por comas. Esas lecturas piden descanso largo y d20 + INT contra esa CD. El jugador no ve la CD.</p>
        ${filasLibros}
        <div class="dm-dar dm-dar-libro">
          <input type="text" id="dmLibroNombre" placeholder="Título del libro">
          <input type="number" id="dmLibroN" min="1" max="100" value="8" class="dm-num" title="Número de lecturas">
          <input type="text" id="dmLibroBono" placeholder="Bono al terminarlo (p. ej. +1 a Arcanos)">
          <input type="text" id="dmLibroPruebas" placeholder="Tiradas: 4:14, 8:16">
          <button class="btn btn-sm" data-dm="dar-libro">🎁 Dar libro</button>
        </div>
      </div>
    </div>`;
  if (filtro) { const f = document.getElementById('dmFiltro'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

async function enviar(ops, resumen) {
  if (ocupado) return;
  ocupado = true;
  document.getElementById('dmPanel')?.classList.add('ocupado');
  const r = await sync.transaccionDirecta(ops, resumen);
  ocupado = false;
  document.getElementById('dmPanel')?.classList.remove('ocupado');
  if (!r.ok) { sync.aviso(r.mensaje, 'error'); }
  await recargar();
}

export function init() {
  const el = document.getElementById('dmPanel');
  if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-dm]');
    if (!b || b.disabled) return;
    const j = jugadores.find(x => x.clave === elegido);
    const accion = b.dataset.dm, id = b.dataset.id, n = parseInt(b.dataset.n) || 0;
    const para = j ? ` (para ${j.nombre})` : '';
    if (accion === 'elegir') return elegir(b.dataset.clave);
    if (!j) return;
    const u = j.clave;
    if (accion === 'mat')
      return enviar([{ t: 'num', c: 'inventory', id, n, u }], `${n > 0 ? '+' : ''}${n} ${nombreMat(id)}${para}`);
    if (accion === 'pot')
      return enviar([{ t: 'qty', c: 'potions', id, n, u }], `${n > 0 ? '+' : ''}${n} ${j.potions[id]?.name || 'poción'}${para}`);
    if (accion === 'pot-quitar') {
      const p = j.potions[id]; if (!p || !confirm(`¿Quitar todas las «${p.name}» a ${j.nombre}?`)) return;
      return enviar([{ t: 'qty', c: 'potions', id, n: -p.qty, u }], `quitó ${p.qty} ${p.name}${para}`);
    }
    if (accion === 'loot')
      return enviar([{ t: 'qty', c: 'lootPotions', id, n, u }], `${n > 0 ? '+' : ''}${n} ${j.lootPotions[id]?.name || 'botín'}${para}`);
    if (accion === 'loot-quitar') {
      const p = j.lootPotions[id]; if (!p || !confirm(`¿Quitar «${p.name}» a ${j.nombre}?`)) return;
      return enviar([{ t: 'qty', c: 'lootPotions', id, n: -p.qty, u }], `quitó ${p.name}${para}`);
    }
    if (accion === 'dar-pot') {
      const pk = document.getElementById('dmDarPot').value;
      const k = Math.max(1, parseInt(document.getElementById('dmDarPotN').value) || 1);
      let modelo = null;
      for (const x of jugadores) if (x.potions[pk]) { modelo = x.potions[pk]; break; }
      if (!modelo) return;
      return enviar([{ t: 'qty', c: 'potions', id: pk, n: k, u, tpl: sinQty(modelo) }], `+${k} ${modelo.name}${para}`);
    }
    if (accion === 'nivel') {
      const actual = niveles.nivelDePerfil(j.perfil, false);
      const nuevo = Math.min(niveles.NIVEL_MAX, Math.max(1, actual + n));
      if (nuevo === actual) return;
      const antes = j.perfil?.alquimia ?? null;
      return enviar([{ t: 'obj', c: 'perfil', id: 'alquimia', e: antes, v: { ...(antes || {}), nivel: nuevo }, u }],
        `nivel de alquimia ${nuevo}${para}`);
    }
    if (accion === 'libro-pruebas') {
      const l = j.libros?.[id]; if (!l) return;
      const txt = el.querySelector(`[data-dm-pruebas="${CSS.escape(id)}"]`)?.value;
      const nuevo = { ...l, pruebas: lectura.leerPruebas(txt, lectura.estadoLibro(l).total) };
      return enviar([{ t: 'obj', c: 'libros', id, e: l, v: nuevo, u }], `tiradas de «${l.name}»${para}`);
    }
    if (accion === 'libro-quitar') {
      const l = j.libros?.[id]; if (!l || !confirm(`¿Quitar «${l.name}» a ${j.nombre}? Pierde su progreso de lectura.`)) return;
      return enviar([{ t: 'obj', c: 'libros', id, e: l, v: null, u }], `quitó el libro ${l.name}${para}`);
    }
    if (accion === 'dar-libro') {
      const nombre = document.getElementById('dmLibroNombre').value.trim();
      if (!nombre) { alert('Ponle un título al libro.'); return; }
      const lecturas = Math.min(100, Math.max(1, parseInt(document.getElementById('dmLibroN').value) || 1));
      const libro = { name: nombre, bono: document.getElementById('dmLibroBono').value.trim(), descripcion: '', lecturas, progreso: 0,
        pruebas: lectura.leerPruebas(document.getElementById('dmLibroPruebas').value, lecturas), historial: [], creado: new Date().toISOString() };
      return enviar([{ t: 'obj', c: 'libros', id: genId(), e: null, v: libro, u }], `+ libro ${nombre}${para}`);
    }
    if (accion === 'dar-loot') {
      const nombre = document.getElementById('dmLootNombre').value.trim();
      const k = Math.max(1, parseInt(document.getElementById('dmLootN').value) || 1);
      if (!nombre) { alert('Ponle un nombre al botín.'); return; }
      const descripcion = document.getElementById('dmLootDesc').value.trim();
      return enviar([{ t: 'qty', c: 'lootPotions', id: genId(), n: k, u,
        tpl: { name: nombre, descripcion, tipo: '', identificada: false } }], `+${k} ${nombre} (botín)${para}`);
    }
  });
  // Cantidad exacta: al pulsar Intro o salir de la casilla
  const fijar = inp => {
    const j = jugadores.find(x => x.clave === elegido);
    if (!j) return;
    const antes = parseInt(inp.dataset.antes) || 0;
    const ahora = Math.max(0, parseInt(inp.value) || 0);
    if (ahora === antes) { inp.value = antes; return; }
    inp.dataset.antes = ahora;   // evita mandarlo dos veces (Intro + salir)
    const id = inp.dataset.dmSet;
    enviar([{ t: 'num', c: 'inventory', id, n: ahora - antes, e: antes, u: j.clave }], `${nombreMat(id)} = ${ahora} (para ${j.nombre})`);
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.dmSet) { e.preventDefault(); fijar(e.target); e.target.blur(); } });
  el.addEventListener('focusout', e => { if (e.target.dataset?.dmSet) fijar(e.target); });
  el.addEventListener('input', e => { if (e.target.id === 'dmFiltro') render(); });
  el.addEventListener('change', e => { if (e.target.id === 'dmSoloStock') render(); });
}

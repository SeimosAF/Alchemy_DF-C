// objetos.js — inventario general: armas, armaduras, objetos mágicos, equipo, tesoros...
//
// Cada jugador lleva sus objetos en la colección 'objetos' (una por jugador y campaña,
// como los libros). Con servidor se guardan allí y quedan en el historial; el DM puede
// dar, editar y quitar objetos a cualquiera de su campaña (desde dm.js).
//
// Un objeto:
//   { name, categoria, cantidad, rareza, valor, peso, descripcion, notas,
//     sintonizacion, sintonizado, equipado,
//     arma:     { dano: '1d8', tipoDano: 'Cortante', propiedades: 'Versátil (1d10)', bonif: 1 } | null,
//     armadura: { ca: '14 + Des (máx. 2)', tipo: 'Media' } | null,
//     cargas:   { actual: 3, max: 7, recarga: '1d6+1 al amanecer' } | null,
//     creado }
// Los bloques arma / armadura / cargas están pensados para que un futuro módulo de
// armas y efectos los lea sin tener que cambiar cómo se guardan los objetos.
import { state, saveState, genId } from './state.js';
import * as filtros from './filtros.js';
import { repintarInventario } from './utils.js';

export const CATEGORIAS = {
  arma:        { icono: '⚔️', nombre: 'Arma' },
  armadura:    { icono: '🛡️', nombre: 'Armadura o escudo' },
  magico:      { icono: '🪄', nombre: 'Objeto maravilloso' },
  joya:        { icono: '💍', nombre: 'Anillo, amuleto o joya' },
  pergamino:   { icono: '📜', nombre: 'Pergamino o mapa' },
  herramienta: { icono: '🔧', nombre: 'Herramienta' },
  equipo:      { icono: '🎒', nombre: 'Equipo de aventura' },
  consumible:  { icono: '🍖', nombre: 'Consumible' },
  tesoro:      { icono: '💎', nombre: 'Tesoro o moneda' },
  otro:        { icono: '📦', nombre: 'Otro' },
};
export const RAREZAS = ['', 'Común', 'Poco común', 'Rara', 'Muy rara', 'Legendaria', 'Artefacto'];
const CLASE_RAREZA = { 'Común': 'comun', 'Poco común': 'poco', 'Rara': 'rara', 'Muy rara': 'muy', 'Legendaria': 'unico', 'Artefacto': 'artefacto' };
const TIPOS_DANO_ARMA = ['Cortante', 'Perforante', 'Contundente'];
export const MAX_SINTONIA = 3;

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = o => CATEGORIAS[o?.categoria] || CATEGORIAS.otro;
const abiertos = new Set();   // objetos con la descripción desplegada

// Filtros de la barra (los de buscar por nombre los pone filtros.js)
const CORTO = { arma: 'Armas', armadura: 'Armaduras', magico: 'Maravillosos', joya: 'Joyas', pergamino: 'Pergaminos',
  herramienta: 'Herramientas', equipo: 'Equipo', consumible: 'Consumibles', tesoro: 'Tesoros', otro: 'Otros' };
export const esMagico = o => !!(o.rareza || o.sintonizacion || o.arma?.bonif);
export const sintonizados = objs => Object.values(objs || {}).filter(o => o.sintonizado).length;

// ---- Una fila del inventario (la usan el jugador y el panel del DM) ----
// «extra»: botones de más (p. ej. «🤝 Dar» en el inventario del jugador)
export function tarjeta(id, o, dm = false, extra = '') {
  const c = cat(o);
  const n = o.cantidad ?? 1;
  const etqs = [`<span class="etq">${c.icono} ${esc(c.nombre)}</span>`];
  if (o.arma?.dano) etqs.push(`<span class="etq etq-arma" title="Daño">🗡️ ${esc(o.arma.dano)}${o.arma.bonif ? ` ${o.arma.bonif > 0 ? '+' : ''}${o.arma.bonif}` : ''} ${esc((o.arma.tipoDano || '').toLowerCase())}</span>`);
  if (o.arma?.bonif) etqs.push(`<span class="etq etq-magico" title="Bonificador mágico al ataque y al daño">✨ ${o.arma.bonif > 0 ? '+' : ''}${o.arma.bonif} al ataque y daño</span>`);
  if (o.armadura?.ca) etqs.push(`<span class="etq etq-armadura">🛡️ CA ${esc(o.armadura.ca)}${o.armadura.tipo ? ' · ' + esc(o.armadura.tipo) : ''}</span>`);
  if (o.sintonizacion) etqs.push(o.sintonizado ? '<span class="etq etq-sintonia">🔗 Sintonizado</span>' : '<span class="etq etq-sin-sintonia">🔗 Requiere sintonización</span>');
  if (o.equipado) etqs.push('<span class="etq etq-equipado">✋ Equipado</span>');
  if (o.valor) etqs.push(`<span class="etq">💰 ${esc(o.valor)}</span>`);
  if (o.peso) etqs.push(`<span class="etq">⚖️ ${esc(o.peso)}</span>`);
  const cargas = o.cargas?.max ? `<div class="obj-cargas" title="Cargas${o.cargas.recarga ? ' · recarga: ' + esc(o.cargas.recarga) : ''}">
      <button class="btn btn-sm" data-obj="carga" data-id="${esc(id)}" data-n="-1" ${o.cargas.actual > 0 ? '' : 'disabled'} title="Gastar una carga">−</button>
      <span class="obj-cargas-n">⚡ ${o.cargas.actual ?? 0}/${o.cargas.max}</span>
      <button class="btn btn-sm" data-obj="carga" data-id="${esc(id)}" data-n="1" ${(o.cargas.actual ?? 0) < o.cargas.max ? '' : 'disabled'} title="Recuperar una carga">+</button>
    </div>` : '';
  const abierto = abiertos.has(id);
  const detalle = [o.descripcion && `<div class="obj-desc">${esc(o.descripcion).replace(/\n/g, '<br>')}</div>`,
    o.arma?.propiedades && `<div><b>Propiedades:</b> ${esc(o.arma.propiedades)}</div>`,
    o.cargas?.recarga && `<div><b>Recarga:</b> ${esc(o.cargas.recarga)}</div>`,
    o.notas && `<div class="obj-notas"><b>Notas:</b> ${esc(o.notas).replace(/\n/g, '<br>')}</div>`].filter(Boolean).join('');
  return `<div class="obj-item obj-${esc(o.categoria || 'otro')}${o.equipado ? ' obj-equipado' : ''}${n ? '' : ' inv-vacio'}">
      <span class="obj-sello" title="${esc(c.nombre)}">${c.icono}</span>
      <div class="inv-info">
        <button type="button" class="obj-nombre" data-obj="detalle" data-id="${esc(id)}" aria-expanded="${abierto}" title="${detalle ? 'Ver la descripción' : ''}">
          ${esc(o.name)} ${o.rareza ? `<span class="rarity-label rarity-${CLASE_RAREZA[o.rareza] || 'comun'}">${esc(o.rareza)}</span>` : ''}
          ${detalle ? `<span class="obj-flecha">${abierto ? '▾' : '▸'}</span>` : ''}
        </button>
        <div class="inv-etiquetas">${etqs.join('')}</div>
        ${abierto && detalle ? `<div class="obj-detalle">${detalle}</div>` : ''}
      </div>
      <div class="obj-lado">
        <div class="inv-stepper" title="Cantidad">
          <button class="btn btn-sm" data-obj="cant" data-id="${esc(id)}" data-n="-1" ${n ? '' : 'disabled'} aria-label="Quitar uno">−</button>
          <span class="stepper-count">${n}</span>
          <button class="btn btn-sm" data-obj="cant" data-id="${esc(id)}" data-n="1" aria-label="Añadir uno">+</button>
        </div>
        ${cargas}
        <div class="obj-botones">
          ${o.categoria === 'arma' || o.categoria === 'armadura' || o.equipado ? `<button class="btn btn-sm ${o.equipado ? 'activo' : ''}" data-obj="equipar" data-id="${esc(id)}" title="${o.equipado ? 'Quitarse' : 'Equiparse'}">✋</button>` : ''}
          ${o.sintonizacion ? `<button class="btn btn-sm ${o.sintonizado ? 'activo' : ''}" data-obj="sintonizar" data-id="${esc(id)}" title="${o.sintonizado ? 'Romper la sintonía' : 'Sintonizarse (descanso corto)'}">🔗</button>` : ''}
          <button class="btn btn-sm btn-edit" data-obj="editar" data-id="${esc(id)}" title="Editar${dm ? ' (como DM)' : ''}">✏️</button>
          ${extra}
          <button class="btn btn-sm btn-danger" data-obj="quitar" data-id="${esc(id)}" title="Quitar del inventario">🗑️</button>
        </div>
      </div>
    </div>`;
}

export function textoBusqueda(o) {
  return [o.name, cat(o).nombre, o.rareza, o.descripcion, o.notas, o.arma?.tipoDano, o.arma?.propiedades, o.armadura?.tipo];
}
function pasa(o) {
  const e = filtros.estado('objetos');
  if (!filtros.coincide('objetos', o.name, cat(o).nombre, o.rareza, o.descripcion, o.notas, o.arma?.tipoDano, o.arma?.propiedades, o.armadura?.tipo)) return false;
  if (e.cat && (o.categoria || 'otro') !== e.cat) return false;
  if (e.marca === 'equipado' && !o.equipado) return false;
  if (e.marca === 'sintonia' && !o.sintonizado) return false;
  if (e.marca === 'magico' && !esMagico(o)) return false;
  return true;
}

// Lista ordenada: equipado primero, luego por categoría y nombre
export function ordenar(objs) {
  const orden = Object.keys(CATEGORIAS);
  return Object.entries(objs || {}).sort(([, a], [, b]) => (b.equipado - a.equipado)
    || orden.indexOf(a.categoria || 'otro') - orden.indexOf(b.categoria || 'otro')
    || String(a.name).localeCompare(String(b.name), 'es'));
}

// El inventario es una sola lista (js/inventario.js): aquí solo se pinta el resumen de arriba
export function render() {
  repintarInventario();
  const todos = ordenar(state.objetos);
  const s = sintonizados(state.objetos);
  const cab = document.getElementById('objetosResumen');
  if (cab) cab.innerHTML = todos.length
    ? `<span>🎒 <b>${todos.reduce((t, [, o]) => t + (o.cantidad ?? 1), 0)}</b> objeto${todos.length === 1 ? '' : 's'}</span>
       <span>✋ <b>${todos.filter(([, o]) => o.equipado).length}</b> equipado${todos.filter(([, o]) => o.equipado).length === 1 ? '' : 's'}</span>
       <span class="${s > MAX_SINTONIA ? 'obj-aviso' : ''}" title="En D&D 5e puedes estar sintonizado con ${MAX_SINTONIA} objetos a la vez">🔗 <b>${s}</b>/${MAX_SINTONIA} sintonizados</span>`
    : '';
}

export function resumen() {
  const objs = Object.values(state.objetos || {});
  return objs.length ? `<b>${objs.length}</b> objeto${objs.length === 1 ? '' : 's'}` : '';
}

// ---- Cambios en el inventario propio (se guardan y, con servidor, viajan solos) ----
function cambiar(id, nuevo) {
  if (nuevo) state.objetos[id] = nuevo; else delete state.objetos[id];
  saveState();
  render();
}

// Acciones de una fila. «objs» es el inventario que se mira y «guardar(id, nuevo, resumen)» lo cambia:
// el propio del jugador o, en el panel del DM, el de otro jugador.
export function accion(b, objs, guardar, quien = '') {
  const id = b.dataset.id, o = objs[id];
  const a = b.dataset.obj;
  if (a === 'nuevo') return editor(null, v => guardar(genId(), v, `+ ${v.name}`), quien);
  if (!o) return;
  if (a === 'detalle') { abiertos.has(id) ? abiertos.delete(id) : abiertos.add(id); return guardar(null); }
  if (a === 'editar') return editor(o, v => guardar(id, v, `editó ${v.name}`), quien);
  if (a === 'quitar') {
    if (!confirm(`¿Quitar «${o.name}» del inventario${quien ? ' de ' + quien : ''}?`)) return;
    return guardar(id, null, `quitó ${o.name}`);
  }
  if (a === 'cant') {
    const n = Math.max(0, (o.cantidad ?? 1) + (parseInt(b.dataset.n) || 0));
    return guardar(id, { ...o, cantidad: n }, `${o.name}: ${n}`);
  }
  if (a === 'carga') {
    const c = o.cargas || { actual: 0, max: 0 };
    const n = Math.max(0, Math.min(c.max, (c.actual ?? 0) + (parseInt(b.dataset.n) || 0)));
    return guardar(id, { ...o, cargas: { ...c, actual: n } }, `${o.name}: ${n}/${c.max} cargas`);
  }
  if (a === 'equipar') return guardar(id, { ...o, equipado: !o.equipado }, `${o.equipado ? 'se quitó' : 'se equipó'} ${o.name}`);
  if (a === 'sintonizar') {
    if (!o.sintonizado && sintonizados(objs) >= MAX_SINTONIA
      && !confirm(`Ya hay ${MAX_SINTONIA} objetos sintonizados (el máximo en D&D 5e). ¿Sintonizar «${o.name}» de todas formas?`)) return;
    return guardar(id, { ...o, sintonizado: !o.sintonizado }, `${o.sintonizado ? 'rompió la sintonía con' : 'se sintonizó con'} ${o.name}`);
  }
}

export function init() {
  const caja = document.getElementById('invSub-todo');
  if (!caja) return;
  caja.addEventListener('click', e => {
    const b = e.target.closest('[data-obj]');
    if (!b || b.disabled) return;
    accion(b, state.objetos, (id, nuevo) => { if (id === null) return render(); cambiar(id, nuevo); });
  });
}

// ---- Ventana para dar de alta o editar un objeto ----
export function editor(o, alGuardar, quien = '') {
  document.getElementById('objDialogo')?.remove();
  const v = { categoria: 'equipo', cantidad: 1, ...(o || {}) };
  const opc = (lista, sel) => lista.map(([k, t]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const tiposDano = [...new Set([...TIPOS_DANO_ARMA, ...(state.damageTypes || [])])];
  document.body.insertAdjacentHTML('beforeend', `
    <div class="foto-fondo" id="objDialogo" role="dialog" aria-modal="true" aria-labelledby="objTitulo">
      <form class="foto-caja obj-caja" novalidate>
        <h3 id="objTitulo">${o ? '✏️ Editar objeto' : '➕ Nuevo objeto'}${quien ? ` <span class="muted">· ${esc(quien)}</span>` : ''}</h3>
        <div class="obj-form">
          <label class="perfil-campo obj-ancho"><span>Nombre *</span><input name="name" maxlength="120" required value="${esc(v.name || '')}" placeholder="p. ej. Espada larga +1"></label>
          <label class="perfil-campo"><span>Categoría</span><select name="categoria">${opc(Object.entries(CATEGORIAS).map(([k, c]) => [k, `${c.icono} ${c.nombre}`]), v.categoria)}</select></label>
          <label class="perfil-campo"><span>Cantidad</span><input name="cantidad" type="number" min="0" max="99999" value="${v.cantidad ?? 1}"></label>
          <label class="perfil-campo"><span>Rareza</span><select name="rareza">${opc(RAREZAS.map(r => [r, r || '— (objeto normal)']), v.rareza || '')}</select></label>
          <label class="perfil-campo"><span>Valor</span><input name="valor" maxlength="60" value="${esc(v.valor || '')}" placeholder="p. ej. 15 po"></label>
          <label class="perfil-campo"><span>Peso</span><input name="peso" maxlength="30" value="${esc(v.peso || '')}" placeholder="p. ej. 1,5 kg"></label>
          <div class="obj-checks obj-ancho">
            <label class="check-label"><input type="checkbox" name="equipado" ${v.equipado ? 'checked' : ''}> ✋ Equipado</label>
            <label class="check-label"><input type="checkbox" name="sintonizacion" ${v.sintonizacion ? 'checked' : ''}> 🔗 Requiere sintonización</label>
            <label class="check-label"><input type="checkbox" name="sintonizado" ${v.sintonizado ? 'checked' : ''}> Sintonizado</label>
          </div>
          <fieldset class="obj-bloque obj-ancho" data-bloque="arma">
            <legend>⚔️ Arma</legend>
            <label class="perfil-campo"><span>Daño</span><input name="arma.dano" maxlength="40" value="${esc(v.arma?.dano || '')}" placeholder="1d8"></label>
            <label class="perfil-campo"><span>Tipo de daño</span><select name="arma.tipoDano"><option value=""></option>${opc(tiposDano.map(t => [t, t]), v.arma?.tipoDano || '')}</select></label>
            <label class="perfil-campo"><span>Bonificador mágico</span><input name="arma.bonif" type="number" min="-5" max="5" value="${v.arma?.bonif ?? 0}"></label>
            <label class="perfil-campo obj-ancho"><span>Propiedades</span><input name="arma.propiedades" maxlength="300" value="${esc(v.arma?.propiedades || '')}" placeholder="Versátil (1d10), sutil, arrojadiza (6/18 m)…"></label>
          </fieldset>
          <fieldset class="obj-bloque obj-ancho" data-bloque="armadura">
            <legend>🛡️ Armadura</legend>
            <label class="perfil-campo"><span>Clase de armadura</span><input name="armadura.ca" maxlength="60" value="${esc(v.armadura?.ca || '')}" placeholder="14 + Des (máx. 2)"></label>
            <label class="perfil-campo"><span>Tipo</span><select name="armadura.tipo">${opc([['', ''], ['Ligera', 'Ligera'], ['Media', 'Media'], ['Pesada', 'Pesada'], ['Escudo', 'Escudo']], v.armadura?.tipo || '')}</select></label>
          </fieldset>
          <fieldset class="obj-bloque obj-ancho">
            <legend>⚡ Cargas <span class="muted">(si tiene; déjalo a 0 si no)</span></legend>
            <label class="perfil-campo"><span>Máximo</span><input name="cargas.max" type="number" min="0" max="999" value="${v.cargas?.max ?? 0}"></label>
            <label class="perfil-campo"><span>Ahora</span><input name="cargas.actual" type="number" min="0" max="999" value="${v.cargas?.actual ?? v.cargas?.max ?? 0}"></label>
            <label class="perfil-campo"><span>Recarga</span><input name="cargas.recarga" maxlength="120" value="${esc(v.cargas?.recarga || '')}" placeholder="1d6+1 al amanecer"></label>
          </fieldset>
          <label class="perfil-campo obj-ancho"><span>Descripción y efectos</span><textarea name="descripcion" rows="4" maxlength="4000">${esc(v.descripcion || '')}</textarea></label>
          <label class="perfil-campo obj-ancho"><span>Notas</span><textarea name="notas" rows="2" maxlength="2000" placeholder="Dónde se encontró, a quién pertenecía…">${esc(v.notas || '')}</textarea></label>
        </div>
        <p class="entrada-error" role="alert"></p>
        <div class="foto-botones">
          <button type="submit" class="btn">💾 Guardar</button>
          <button type="button" class="btn" style="background:#777" data-cerrar>Cancelar</button>
        </div>
      </form>
    </div>`);
  const d = document.getElementById('objDialogo');
  const f = d.querySelector('form');
  const verBloques = () => {
    const c = f.categoria.value;
    f.querySelector('[data-bloque="arma"]').hidden = c !== 'arma';
    f.querySelector('[data-bloque="armadura"]').hidden = c !== 'armadura';
    f.sintonizado.disabled = !f.sintonizacion.checked;
    if (!f.sintonizacion.checked) f.sintonizado.checked = false;
  };
  verBloques();
  f.addEventListener('change', verBloques);
  const cerrar = () => { d.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-cerrar]')) cerrar(); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const val = n => f.elements[n]?.value.trim() || '';
    const num = (n, min, max) => Math.max(min, Math.min(max, parseInt(f.elements[n]?.value) || 0));
    const name = val('name');
    if (!name) { d.querySelector('.entrada-error').textContent = 'Ponle un nombre.'; f.elements.namedItem('name').focus(); return; }
    const categoria = val('categoria') || 'otro';
    const nuevo = {
      name, categoria, cantidad: num('cantidad', 0, 99999), rareza: val('rareza'), valor: val('valor'), peso: val('peso'),
      descripcion: val('descripcion'), notas: val('notas'),
      equipado: f.equipado.checked, sintonizacion: f.sintonizacion.checked, sintonizado: f.sintonizacion.checked && f.sintonizado.checked,
      arma: categoria === 'arma' ? { dano: val('arma.dano'), tipoDano: val('arma.tipoDano'), propiedades: val('arma.propiedades'), bonif: num('arma.bonif', -5, 5) } : null,
      armadura: categoria === 'armadura' ? { ca: val('armadura.ca'), tipo: val('armadura.tipo') } : null,
      cargas: num('cargas.max', 0, 999) ? { max: num('cargas.max', 0, 999), actual: Math.min(num('cargas.actual', 0, 999), num('cargas.max', 0, 999)), recarga: val('cargas.recarga') } : null,
      creado: o?.creado || new Date().toISOString(),
    };
    cerrar();
    alGuardar(nuevo);
  });
  setTimeout(() => f.elements.namedItem('name').focus(), 0);
}

// Para el panel del DM: dar, editar y quitar objetos a un jugador (transacción en el servidor)
export function accionDM(b, j, enviar) {
  const objs = j.objetos || {};
  accion(b, objs, (id, nuevo, resumen) => {
    if (id === null) return enviar(null);          // solo desplegar: repintar
    return enviar([{ t: 'obj', c: 'objetos', id, e: objs[id] ?? null, v: nuevo, u: j.clave }], `${resumen} (para ${j.nombre})`);
  }, j.nombre);
}

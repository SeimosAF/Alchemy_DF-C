// modulos.js — registro de los módulos de la taberna.
//
// La app es una "mesa" con varios módulos (Inventario, Alquimia, Lectura...).
// Cada módulo se registra aquí con su pestaña, su tarjeta de la mesa y lo que
// hay que hacer al abrirlo. La barra de pestañas y las tarjetas de la mesa se
// construyen solas a partir de esta lista, así que añadir un módulo nuevo
// (cocina, ficha de personaje, armas, mapas...) es:
//   1. Crear su <section id="tab-ID" class="tab-content"> en index.html.
//   2. Crear js/ID.js con su lógica (render, init...).
//   3. Registrarlo en app.js con registrar({...}).
//   4. Si guarda datos de cada jugador, añadir su colección en sync.js (COLS)
//      y en servidor.py (COLECCIONES y POR_JUGADOR).
// Ver docs/ARQUITECTURA.md.
//
// Campos de un módulo:
//   id        nombre de la pestaña: la sección es #tab-<id>
//   icono     emoji
//   titulo    nombre que se ve en la pestaña y en la tarjeta
//   lugar     palabra para "Usuarios en línea" (minúsculas, sin espacios)
//   lugarTxt  "junto al caldero", "leyendo un libro"...
//   tarjeta   { texto, clase, orden } si sale como tarjeta en la mesa (o null)
//   resumen   () => html con el resumen de la tarjeta
//   alMostrar () => lo que hay que pintar al abrir la pestaña
//   pestana   false si no sale en la barra de pestañas (true por defecto)

const lista = [];

export function registrar(m) {
  if (lista.some(x => x.id === m.id)) throw new Error('Módulo repetido: ' + m.id);
  lista.push({ pestana: true, tarjeta: null, ...m });
}
export const todos = () => lista;
export const porId = id => lista.find(m => m.id === id);
export const lugarDe = id => porId(id)?.lugar || 'panel';
export function textoLugar(lugar) {
  return lista.find(m => m.lugar === lugar)?.lugarTxt || 'en la mesa principal';
}

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Barra de pestañas
export function construirPestanas(nav) {
  nav.innerHTML = lista.filter(m => m.pestana).map(m =>
    `<button data-action="switch-tab" data-id="${esc(m.id)}">${m.icono} ${esc(m.nav || m.titulo)}${m.contador ? ` <span class="nav-contador" id="${esc(m.contador)}"></span>` : ''}</button>`).join('');
}

// Tarjetas de la mesa
export function construirTarjetas(mesa) {
  const conTarjeta = lista.filter(m => m.tarjeta).sort((a, b) => (a.tarjeta.orden ?? 99) - (b.tarjeta.orden ?? 99));
  mesa.innerHTML = conTarjeta.map((m, i) => `
    <button class="tarjeta ${esc(m.tarjeta.clase || '')}" data-action="switch-tab" data-id="${esc(m.id)}" style="--i:${i}">
      <span class="tarjeta-esquinas" aria-hidden="true"></span>
      <span class="tarjeta-icono">${m.tarjeta.icono || m.icono}</span>
      <span class="tarjeta-titulo">${esc(m.tarjeta.titulo || m.titulo)}</span>
      <span class="tarjeta-texto">${esc(m.tarjeta.texto || '')}</span>
      <span class="tarjeta-resumen" data-resumen="${esc(m.id)}"></span>
    </button>`).join('');
}

export function pintarResumenes() {
  for (const m of lista) {
    if (!m.resumen) continue;
    const el = document.querySelector(`[data-resumen="${CSS.escape(m.id)}"]`);
    if (el) { try { el.innerHTML = m.resumen(); } catch (e) { console.error(e); } }
  }
}

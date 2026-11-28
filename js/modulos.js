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
//   disciplina  si se indica, el módulo solo lo ve quien tiene esa disciplina
//               ('alquimista', 'cocinero', 'hechicero', 'herrero'). Es la "ranura de oficio":
//               cada jugador ve en ella el módulo de su disciplina (la asigna el DM).
//               Desde V3.7 el DM marca a qué oficios tiene acceso cada jugador: uno, varios
//               (texto con comas: 'alquimista,herrero'), todos ('pluriempleado') o ninguno
//               ('desempleado', la ranura sale vacía). Con más de uno elige cuál usar con los
//               botones de oficio de la mesa. El DM y el superusuario los tienen todos.
//   proximamente  { texto } para un módulo que aún no está hecho: su pestaña se crea sola
//               con un cartel de "próximamente" (no hace falta sección en index.html)

const lista = [];
export const OFICIOS = ['alquimista', 'cocinero', 'hechicero', 'herrero'];
// Lo guardado en la disciplina -> lista de oficios a los que tiene acceso
export function listaDisciplinas(d) {
  if (!d) return ['alquimista'];
  if (d === 'desempleado') return [];
  if (d === 'pluriempleado') return [...OFICIOS];
  return OFICIOS.filter(o => String(d).split(',').includes(o));
}
let disciplina = 'alquimista';
let accesos = ['alquimista'];      // oficios a los que tiene acceso
let oficio = null;                 // el oficio que usa ahora quien tiene varios
const CLAVE_OFICIO = 'taberna.oficioActivo';

export function registrar(m) {
  if (lista.some(x => x.id === m.id)) throw new Error('Módulo repetido: ' + m.id);
  lista.push({ pestana: true, tarjeta: null, ...m });
}
export const todos = () => lista;
export const porId = id => lista.find(m => m.id === id);
// La disciplina de quien juega decide qué módulos de oficio ve
export function setDisciplina(d) { disciplina = d || 'alquimista'; accesos = listaDisciplinas(disciplina); }
export const accesoA = d => accesos.includes(d);
export const disciplinaActual = () => disciplina;
// Los módulos de oficio (los que tienen disciplina)
export const oficios = () => lista.filter(m => m.disciplina);
const esOficio = d => oficios().some(m => m.disciplina === d);
// Qué oficio se ve en la ranura: el único que tiene, el que ha elegido (si tiene varios) o ninguno
const puedeUsar = d => esOficio(d) && accesos.includes(d);
export function oficioActivo() {
  if (accesos.length < 2) return accesos[0] || null;
  if (!puedeUsar(oficio)) {
    try { oficio = localStorage.getItem(CLAVE_OFICIO); } catch (_) {}
    if (!puedeUsar(oficio)) oficio = oficios().find(m => accesos.includes(m.disciplina) && !m.proximamente)?.disciplina || accesos[0];
  }
  return oficio;
}
export function setOficio(d) {
  if (!puedeUsar(d)) return;
  oficio = d;
  try { localStorage.setItem(CLAVE_OFICIO, d); } catch (_) {}
}
// El DM (o el superusuario) ve siempre los oficios que ya existen: lleva el catálogo de la mesa
let dmVeOficios = false;
export function setDM(v) { dmVeOficios = !!v; }
// V3.7: cada disciplina a la que tiene acceso es su propio módulo (bola en la mesa y pestaña),
// aunque aún esté «próximamente». El DM y el superusuario las tienen todas.
export const visible = m => !!m && (!m.disciplina || accesos.includes(m.disciplina) || (dmVeOficios && !m.proximamente));
const visibles = () => lista.filter(visible);
export const lugarDe = id => porId(id)?.lugar || 'panel';
export function textoLugar(lugar) {
  return lista.find(m => m.lugar === lugar)?.lugarTxt || 'en la mesa principal';
}

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Barra de pestañas
export function construirPestanas(nav) {
  nav.innerHTML = visibles().filter(m => m.pestana).map(m =>
    `<button data-action="switch-tab" data-id="${esc(m.id)}">${m.icono} ${esc(m.nav || m.titulo)}${m.contador ? ` <span class="nav-contador" id="${esc(m.contador)}"></span>` : ''}</button>`).join('');
}

// La mesa (V3.7): tu foto es un planeta en el centro y los módulos giran en su órbita (3D).
// Se ven todas, pero solo se eligen las tres de delante (la del centro y sus vecinas); las flechas, el teclado o
// deslizar el dedo hacen girar la órbita con una animación continua. Al pulsar la de delante
// se entra; al pulsar una de los lados, gira hasta ella.
// centro = html del avatar (lo pone app.js, que sabe quién está jugando).
let frente = 0;              // índice (sin acotar) de la opción que está delante
let animPos = null;          // posición animada (sigue a «frente» con suavidad)
let animId = 0;

let observador = null;
let alPortal = null;         // qué hace el planeta (con servidor: abrir el selector de campañas)

export function construirTarjetas(mesa, centro = '', opciones = {}) {
  alPortal = opciones.alPortal || null;
  const items = visibles().filter(m => m.id !== 'panel' && (m.tarjeta || m.pestana === false))
    .map(m => ({ ...m, tarjeta: m.tarjeta || { orden: 9, texto: m.textoMesa || '' } }));
  if (!accesos.length)   // sin oficio: el hueco del oficio sale apagado
    items.push({ id: '', vacia: true, icono: '🪑', titulo: 'Sin oficio',
      tarjeta: { orden: 1, clase: 'tarjeta-sin-oficio', texto: 'Ahora mismo no ejerces ningún oficio. Si quieres uno, pídeselo al DM.' } });
  items.sort((a, b) => (a.tarjeta.orden ?? 99) - (b.tarjeta.orden ?? 99));
  mesa.innerHTML = `<div class="orbita3d">
      <div class="orbita3d-escena">
        <svg class="orbita3d-anillo orbita3d-anillo-atras" aria-hidden="true"></svg>
        <div class="orbita3d-sombra" aria-hidden="true"></div>
        <button class="orbita3d-planeta ${alPortal ? 'es-portal' : ''}" ${alPortal ? 'data-portal="1" title="Portal: cambiar de campaña"'
            : 'data-action="switch-tab" data-id="perfil" title="Tu perfil"'}>
          ${alPortal ? '<span class="orbita3d-remolino" aria-hidden="true"></span>' : ''}
          ${centro}<span class="orbita3d-luz" aria-hidden="true"></span>
          ${alPortal ? '<span class="orbita3d-portal-txt">🌀 Cambiar de campaña</span>' : ''}</button>
        <svg class="orbita3d-anillo orbita3d-anillo-delante" aria-hidden="true"></svg>
        ${items.map((m, i) => {
          const icono = m.tarjeta.icono || m.icono, titulo = m.tarjeta.titulo || m.titulo;
          const datos = `class="orbita3d-item ${esc(m.tarjeta.clase || '')}" data-i="${i}" data-titulo="${esc(titulo)}" data-texto="${esc(m.tarjeta.texto || '')}"`;
          const dentro = `<span class="orbita3d-luna"><span class="orbita3d-icono">${icono}</span><span class="orbita3d-titulo">${esc(titulo)}</span>
              ${m.proximamente ? '<span class="orbita3d-pronto">pronto</span>' : ''}</span>`;
          return m.vacia ? `<div ${datos} aria-disabled="true">${dentro}</div>`
            : `<button ${datos} data-ir="${esc(m.id)}" data-id="${esc(m.id)}" aria-label="${esc(titulo)}">${dentro}
                <span class="orbita3d-resumen" data-resumen="${esc(m.id)}" hidden></span></button>`;
        }).join('')}
      </div>
      <button class="orbita3d-flecha orbita3d-izq" data-orbita="-1" aria-label="Girar a la izquierda">‹</button>
      <button class="orbita3d-flecha orbita3d-der" data-orbita="1" aria-label="Girar a la derecha">›</button>
    </div>
    <div class="orbita-info" aria-live="polite">
      <span class="orbita-info-titulo"></span>
      <span class="orbita-info-texto"></span>
      <span class="orbita-info-resumen"></span>
    </div>`;
  if (animPos === null) animPos = frente;
  colocar(mesa);
  // La mesa se puede construir estando oculta (otra pestaña delante): se recoloca sola en cuanto
  // tiene tamaño de verdad, y cada vez que cambia.
  observador?.disconnect();
  if (window.ResizeObserver) {
    observador = new ResizeObserver(() => colocar(mesa));
    observador.observe(mesa.querySelector('.orbita3d-escena'));
  }
  if (mesa.dataset.orbitaLista) return;
  // Los controles se enganchan una sola vez. Ojo: la marca NO puede llamarse data-orbita, porque
  // closest('[data-orbita]') la encontraría en cualquier clic y giraría siempre a la derecha.
  mesa.dataset.orbitaLista = '1';
  // Flechas, teclado o pulsar una de los lados: el destino avanza y el muelle lleva hasta él
  // conservando la velocidad que hubiera (si ya giraba, no frena de golpe).
  const girar = d => { frente = (moviendo ? Math.round(destino()) : frente) + d; animar(mesa, MUELLE_BOTON); };
  mesa.addEventListener('click', e => {
    if (performance.now() - finArrastre < 350) { e.preventDefault(); e.stopPropagation(); return; }
    const portal = e.target.closest('[data-portal]');
    if (portal && alPortal) { cruzarPortal(mesa, portal); return; }   // el planeta lleva al selector de campañas
    const f = e.target.closest('[data-orbita]');
    if (f) { girar(Number(f.dataset.orbita)); return; }
    const it = e.target.closest('.orbita3d-item');
    if (!it) {   // clic en un hueco de la órbita: gira hacia el lado en el que se ha pulsado
      const esc3d = mesa.querySelector('.orbita3d-escena');
      if (!esc3d?.contains(e.target) || e.target.closest('.orbita3d-planeta')) return;
      const r = esc3d.getBoundingClientRect();
      girar(e.clientX < r.left + r.width / 2 ? -1 : 1);
      return;
    }
    const n = mesa.querySelectorAll('.orbita3d-item').length;
    const rel = relativo(Number(it.dataset.i), frente, n);
    if (Math.round(rel) !== 0) girar(Math.round(rel));   // uno de los lados: primero gira hasta él
  });
  mesa.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { girar(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { girar(1); e.preventDefault(); }
  });
  // Arrastrar las bolas (ratón o dedo). La bola de delante va pegada al dedo, sin retraso; al
  // soltar conserva la velocidad que llevaba y un muelle amortiguado la frena hasta encajar con
  // tres opciones delante. La velocidad nunca cambia de golpe, así que no da tirones.
  const escena = () => mesa.querySelector('.orbita3d-escena');
  let ptr = null;   // { id, x0, pos0, movido, muestras: [[t, pos]] }
  let pintarPendiente = false;
  const pintar = () => {   // como mucho un repintado por fotograma
    if (pintarPendiente) return;
    pintarPendiente = true;
    requestAnimationFrame(() => { pintarPendiente = false; colocar(mesa); });
  };
  mesa.addEventListener('pointerdown', e => {
    const esc3d = escena();
    if (!esc3d || !esc3d.contains(e.target) || e.target.closest('[data-portal]') || (e.button ?? 0) !== 0) return;
    ptr = { id: e.pointerId, x0: e.clientX, pos0: animPos, movido: false, muestras: [] };
  });
  mesa.addEventListener('pointermove', e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x0;
    if (!ptr.movido) {
      if (Math.abs(dx) < 4) return;   // un toque no es un arrastre
      // Se coge la órbita donde esté, aunque estuviera girando: sin saltos
      cancelAnimationFrame(animId);
      ptr.movido = true; moviendo = true; vel = 0;
      ptr.x0 = e.clientX; ptr.pos0 = animPos;
      try { escena().setPointerCapture(e.pointerId); } catch (_) {}
      mesa.querySelector('.orbita3d')?.classList.add('arrastrando');
    }
    animPos = ptr.pos0 - (e.clientX - ptr.x0) / pxPorPaso;
    const t = e.timeStamp || performance.now();
    ptr.muestras.push([t, animPos]);
    while (ptr.muestras.length > 2 && t - ptr.muestras[0][0] > 100) ptr.muestras.shift();
    pintar();
  });
  const soltar = e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const { movido, muestras } = ptr; ptr = null;
    mesa.querySelector('.orbita3d')?.classList.remove('arrastrando');
    if (!movido) return;
    finArrastre = performance.now();   // el clic que llega al soltar no cuenta
    // Velocidad de los últimos ~100 ms (si se quedó quieto antes de soltar, es 0)
    const t = e.timeStamp || performance.now();
    const ult = muestras[muestras.length - 1], pri = muestras[0];
    vel = ult && pri && ult !== pri && t - ult[0] < 80 ? (ult[1] - pri[1]) / Math.max(0.016, (ult[0] - pri[0]) / 1000) : 0;
    vel = Math.max(-16, Math.min(16, vel));
    frente = Math.round(destino());
    animar(mesa, MUELLE_SOLTAR);
  };
  mesa.addEventListener('pointerup', soltar);
  mesa.addEventListener('pointercancel', soltar);
  // Ojo (móvil): el dedo queda «capturado» por la bola que toca; al pasar la captura a la escena, la
  // bola la pierde y eso NO es soltar. Solo cuenta si la pierde la propia escena.
  mesa.addEventListener('lostpointercapture', e => { if (e.target === escena()) soltar(e); });
  window.addEventListener('resize', () => colocar(mesa));
}

// V3.10.1: cruzar el portal. Las lunas caen en espiral hacia el planeta, el remolino se acelera y se
// abre hasta tragarse la pantalla; entonces se recarga en el selector de campañas, que empieza con el
// mismo remolino pintado (js/portal-llegada.js) y el pergamino sale de él (auth.js).
function cruzarPortal(mesa, portal) {
  const orb = portal.closest('.orbita3d');
  if (!orb || orb.classList.contains('cruzando')) return;
  const pr = portal.getBoundingClientRect();
  const cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2;
  const ir = () => {
    try {
      sessionStorage.setItem('taberna.portal', JSON.stringify({
        x: Math.round(cx / innerWidth * 1000) / 10, y: Math.round(cy / innerHeight * 1000) / 10 }));
    } catch (_) {}
    alPortal();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !orb.animate) { alPortal(); return; }
  cancelAnimationFrame(animId); moviendo = true; vel = 0;   // la órbita se queda quieta: ya nada se elige
  orb.classList.add('cruzando');
  // 1) Las lunas caen en espiral, cada una un poco después de la anterior
  const esc = mesa.querySelector('.orbita3d-escena').getBoundingClientRect();
  const px = cx - esc.left, py = cy - esc.top;
  [...mesa.querySelectorAll('.orbita3d-item')].forEach((it, k) => {
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\).*scale\(([-\d.]+)\)/.exec(it.style.transform || '');
    if (!m) return;
    const dx = Number(m[1]) - px, dy = Number(m[2]) - py, s0 = Number(m[3]);
    const r0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx), op0 = Number(it.style.opacity || 1);
    const pasos = [];
    for (let j = 0; j <= 12; j++) {
      const t = j / 12, r = r0 * Math.pow(1 - t, 1.5), a = a0 + t * Math.PI * 1.6;
      pasos.push({ transform: `translate(${(px + r * Math.cos(a)).toFixed(1)}px, ${(py + r * Math.sin(a)).toFixed(1)}px) translate(-50%, -50%) scale(${(s0 * (1 - 0.92 * t)).toFixed(3)}) rotate(${Math.round(t * 300)}deg)`,
        opacity: t < 0.75 ? op0 : op0 * (1 - t) * 4 });
    }
    it.animate(pasos, { duration: 760, delay: 35 * k, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
  });
  // 2) El remolino se abre desde el planeta hasta cubrirlo todo
  const velo = document.createElement('div');
  velo.className = 'portal-velo';
  velo.style.setProperty('--portal-x', cx + 'px');
  velo.style.setProperty('--portal-y', cy + 'px');
  velo.innerHTML = '<div class="portal-giro"></div><div class="portal-ojo"></div>';
  document.body.appendChild(velo);
  const R = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 20;
  const r0 = pr.width / 2;
  velo.animate([
    { clipPath: `circle(${r0 * 0.6}px at ${cx}px ${cy}px)`, opacity: 0 },
    { clipPath: `circle(${r0 * 1.1}px at ${cx}px ${cy}px)`, opacity: 1, offset: 0.3 },
    { clipPath: `circle(${R}px at ${cx}px ${cy}px)`, opacity: 1 }
  ], { duration: 900, delay: 300, easing: 'cubic-bezier(.7,0,.6,1)', fill: 'forwards' });
  setTimeout(ir, 1250);
  // Si se vuelve con «atrás» y el navegador recupera la página tal cual, que no se quede tapada
  addEventListener('pageshow', e => { if (e.persisted) location.reload(); }, { once: true });
}

// Distancia (en posiciones, con signo y por el camino corto) de la opción i a la que está delante
function relativo(i, pos, n) {
  let r = ((i - pos) % n + n) % n;
  if (r > n / 2) r -= n;
  return r;
}

let vel = 0;                 // velocidad de giro (posiciones por segundo)
let moviendo = false;        // arrastrando o girando: no se entra en nada
let finArrastre = 0;
let pxPorPaso = 200;         // píxeles de arrastre por posición (lo calcula colocar: la bola de delante sigue al dedo)
const ROZAMIENTO = 2.4;      // cuánto frena al soltar: decide hasta dónde llega lanzándola
const MUELLE_SOLTAR = 4.2;   // rigidez del muelle al soltar (más bajo = más suave)
const MUELLE_BOTON = 6.5;    // con las flechas, algo más rápido
// Dónde se pararía girando libremente con la velocidad actual
const destino = () => animPos + vel / ROZAMIENTO;

// Muelle con amortiguación crítica hacia «frente»: parte de la posición y la velocidad actuales,
// así que enlaza sin saltos con el arrastre o con un giro anterior.
function animar(mesa, w = MUELLE_BOTON) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { animPos = frente; vel = 0; moviendo = false; colocar(mesa); return; }
  moviendo = true;
  cancelAnimationFrame(animId);
  let t0 = performance.now();
  const paso = t => {
    let dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
    while (dt > 0) {   // pasos pequeños: estable con cualquier fotograma
      const h = Math.min(dt, 1 / 240);
      const a = w * w * (frente - animPos) - 2 * w * vel;
      vel += a * h; animPos += vel * h; dt -= h;
    }
    if (Math.abs(frente - animPos) < 0.0015 && Math.abs(vel) < 0.02) { animPos = frente; vel = 0; moviendo = false; }
    colocar(mesa);
    if (moviendo) animId = requestAnimationFrame(paso);
  };
  animId = requestAnimationFrame(paso);
}

// Proyección en perspectiva: la órbita es un círculo de verdad, inclinado hacia quien mira.
// Lo de delante se ve más grande, más abajo y más separado; lo de detrás, pequeño y apretado.
function geometria(w, h) {
  const movil = w < 520;
  const R = movil ? w * 0.42 : Math.min(300, w * 0.42);
  const f = movil ? 520 : 820;                       // distancia de la «cámara»
  const fi = 21 * Math.PI / 180;                     // inclinación de la órbita
  const cx = w / 2, cy = h / 2 - (movil ? 26 : 40);
  const proyectar = ang => {
    const x = R * Math.sin(ang), z = R * Math.cos(ang);           // z > 0: hacia quien mira
    const zc = z * Math.cos(fi);
    const s = f / (f - zc);
    return { x: cx + x * s, y: cy + z * Math.sin(fi) * s, s, prof: (Math.cos(ang) + 1) / 2 };
  };
  return { movil, cx, cy, R, proyectar };
}

// El anillo: dos dibujos, la mitad de atrás (debajo del planeta) y la de delante (encima),
// con el trazo más grueso y brillante cuanto más cerca está.
function pintarAnillo(svg, g, w, h, delante) {
  if (!svg) return;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  const N = 96;
  let html = '';
  for (let k = 0; k < N; k++) {
    const a1 = k / N * 2 * Math.PI, a2 = (k + 1) / N * 2 * Math.PI;
    const esDelante = Math.cos((a1 + a2) / 2) >= 0;
    if (esDelante !== delante) continue;
    const p = g.proyectar(a1), q = g.proyectar(a2);
    const ancho = (0.6 + 2.6 * p.prof) * (g.movil ? 0.8 : 1);
    html += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"
      stroke-width="${ancho.toFixed(2)}" stroke-opacity="${(0.18 + 0.62 * p.prof).toFixed(2)}"/>`;
  }
  svg.innerHTML = html;
}

// Pone cada opción en su sitio de la órbita según animPos. Se ven todas; solo se pueden
// elegir las tres de delante (la del centro y sus vecinas).
function colocar(mesa) {
  const esc3d = mesa.querySelector('.orbita3d-escena');
  if (!esc3d) return;
  const items = [...mesa.querySelectorAll('.orbita3d-item')];
  const n = items.length || 1;
  const w = esc3d.clientWidth, h = esc3d.clientHeight;
  if (!w || !h) return;   // aún oculta: ya se colocará cuando se vea
  const g = geometria(w, h);
  if (esc3d.dataset.medida !== `${w}x${h}`) {   // el anillo solo se redibuja si cambia el tamaño
    esc3d.dataset.medida = `${w}x${h}`;
    pintarAnillo(esc3d.querySelector('.orbita3d-anillo-atras'), g, w, h, false);
    pintarAnillo(esc3d.querySelector('.orbita3d-anillo-delante'), g, w, h, true);
    const pl = esc3d.querySelector('.orbita3d-planeta'), so = esc3d.querySelector('.orbita3d-sombra');
    if (pl) pl.style.top = g.cy + 'px';
    if (so) so.style.top = (g.cy + (g.movil ? 70 : 105)) + 'px';
  }
  const paso = 2 * Math.PI / n;
  pxPorPaso = Math.max(60, g.R * paso * g.proyectar(0).s);   // la bola de delante va al ritmo del dedo
  const base = g.movil ? 0.62 : 0.72;
  for (const it of items) {
    const rel = relativo(Number(it.dataset.i), animPos, n);
    const p = g.proyectar(rel * paso);
    const elegible = n <= 3 || Math.abs(relativo(Number(it.dataset.i), moviendo ? Math.round(animPos) : frente, n)) <= 1;
    it.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${(base * p.s).toFixed(3)})`;
    it.style.zIndex = String(p.prof >= 0.5 ? 100 + Math.round(p.prof * 100) : Math.round(p.prof * 40));
    it.style.opacity = (0.45 + 0.55 * p.prof).toFixed(3);
    it.style.setProperty('--sombra', (0.55 * (1 - p.prof)).toFixed(3));   // lo de atrás, más oscuro (sin filtros: va más fluido)
    it.style.pointerEvents = elegible ? '' : 'none';
    it.tabIndex = elegible ? 0 : -1;
    it.setAttribute('aria-hidden', String(!elegible));
    it.classList.toggle('bloqueada', !elegible);
    const alFrente = Math.abs(rel) < 0.5 && !moviendo;
    it.classList.toggle('al-frente', alFrente);
    // Solo se entra por el de delante: los de los lados primero giran
    if (it.dataset.ir !== undefined) {
      if (alFrente) it.setAttribute('data-action', 'switch-tab'); else it.removeAttribute('data-action');
    }
  }
  // El centro de atención: lo que hay delante
  const ref = moviendo ? Math.round(animPos) : frente;
  const delante = items.find(x => Math.round(relativo(Number(x.dataset.i), ref, n)) === 0);
  const info = mesa.querySelector('.orbita-info');
  if (info && delante && info.dataset.i !== delante.dataset.i) {
    info.dataset.i = delante.dataset.i;
    info.querySelector('.orbita-info-titulo').textContent = delante.dataset.titulo;
    info.querySelector('.orbita-info-texto').textContent = delante.dataset.texto;
    info.querySelector('.orbita-info-resumen').innerHTML = delante.querySelector('.orbita3d-resumen')?.innerHTML || '';
    info.classList.remove('cambia'); void info.offsetWidth; info.classList.add('cambia');
  }
}
// Cuando se repintan los resúmenes, el de delante también se actualiza
export function recolocarMesa() {
  const mesa = document.getElementById('mesaTarjetas');
  if (mesa?.querySelector('.orbita3d-escena')) colocar(mesa);
}
export function refrescarInfoMesa() {
  const mesa = document.getElementById('mesaTarjetas');
  const info = mesa?.querySelector('.orbita-info');
  if (!info) return;
  const it = mesa.querySelector(`.orbita3d-item[data-i="${info.dataset.i}"]`);
  info.querySelector('.orbita-info-resumen').innerHTML = it?.querySelector('.orbita3d-resumen')?.innerHTML || '';
}

// V3.7: ya no hay «oficio de hoy»: cada disciplina tiene su bola en la mesa y su pestaña
export function construirSelectorOficio(el) {
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

// Pestañas de los módulos que aún no existen: un cartel de "próximamente"
export function construirProximamente(antesDe) {
  for (const m of lista) {
    if (!m.proximamente || document.getElementById('tab-' + m.id)) continue;
    const s = document.createElement('section');
    s.id = 'tab-' + m.id;
    s.className = 'tab-content';
    s.innerHTML = `<div class="panel proximamente">
        <div class="proximamente-icono">${m.icono}</div>
        <h2>${esc(m.titulo)}</h2>
        <p class="proximamente-sello">Próximamente</p>
        <p class="muted">${esc(m.proximamente.texto || 'Este oficio todavía se está escribiendo.')}</p>
      </div>`;
    antesDe.parentNode.insertBefore(s, antesDe);
  }
}

export function pintarResumenes() {
  for (const m of visibles()) {
    if (!m.resumen) continue;
    const el = document.querySelector(`[data-resumen="${CSS.escape(m.id)}"]`);
    if (el) { try { el.innerHTML = m.resumen(); } catch (e) { console.error(e); } }
  }
  refrescarInfoMesa();
}

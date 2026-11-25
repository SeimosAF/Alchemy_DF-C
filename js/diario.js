// diario.js — el diario de Jhon Arbaquel: el tutorial de la alquimia.
//
// Una página por nivel de alquimia. Jhon cuenta sus avances y explica lo que
// se acaba de desbloquear. Las páginas de niveles que aún no tienes están
// "pegadas". Cuando el DM te sube de nivel, el diario se abre solo en la página
// nueva la próxima vez que vayas al caldero.
//
// La lista "Lo que ahora sabes hacer" de cada página sale de la tabla NIVELES
// (niveles.js), así que si cambias el reparto el diario sigue diciendo la verdad.
import { state } from './state.js';
import * as auth from './auth.js';
import { getDisolvente } from './model.js';
import * as niveles from './niveles.js';

export const PAGINAS = [
  { nivel: 1, fecha: 'Primer día de la siembra', titulo: 'El agua y la salvia',
    texto: `
      <p>Hoy el viejo Breuna me ha dejado por fin tocar su caldero. «Agua, chico. Antes de soñar con azogues y polvos de estrella, aprende a
      que el agua te obedezca.» Así que eso he hecho toda la tarde.</p>
      <p>Lo apunto para no olvidarlo: toda poción empieza por su <b>disolvente</b>. El agua es el disolvente del <b>Cuerpo</b>: carne,
      sangre y hueso. Primero el agua en el caldero; después el <b>reactivo</b>, que es quien de verdad lleva el efecto (mi salvia salvaje,
      que cierra heridas). Un reactivo solo se disuelve en el disolvente de su campo: echar salvia en otra cosa es tirarla.</p>
      <p>Breuna dice que de momento solo me deja las mezclas <b>salutíferas</b>, las que curan y fortalecen. Las que hacen daño «ya
      vendrán, cuando no tiembles».</p>
      <p>La dificultad la calculo así: <b>10</b>, más lo que pida el disolvente, más lo que pida el reactivo, más el método de aplicación
      (beberla no suma nada). Nunca baja de 6. Y para lograrlo tiro <b>d20 + mi INT + mi bono de alquimista</b>. Si fallo, los
      materiales se pierden igual. El caldero no perdona.</p>` },
  { nivel: 2, fecha: 'Décimo día de la siembra', titulo: 'Lo que cura también hiere',
    texto: `
      <p>He quemado dos ollas y una ceja, pero Breuna ha asentido. Hoy me ha enseñado su estante cerrado: reactivos del Cuerpo que no
      curan, sino que <b>dañan</b>, y otros <b>neutros</b> que no son ni una cosa ni otra.</p>
      <p>Lo importante: las pociones nocivas piden una <b>salvación</b> a quien las sufre, con una característica del Cuerpo
      (Fuerza o Constitución).</p>
      <p>Y por fin, los <b>modificadores</b>: pizcas que se añaden después del reactivo y cambian la poción. El <b>Potenciador</b> suma
      dados, el <b>Prolongador</b> alarga el efecto y el <b>Economizador</b> baja la dificultad. Cada modificador suma su propia
      dificultad (por cada vez que lo echas), y si va en contra de la polaridad del reactivo, el caldero se resiste un poco más.</p>
      <p>También he aprendido a no tener que hacérsela beber a nadie: <b>Hémica</b> (que toque la sangre, +1) y <b>Corrosiva</b>
      (basta con la piel, +2).</p>` },
  { nivel: 3, fecha: 'Primera luna del estío', titulo: 'El metal que piensa',
    texto: `
      <p>Azogue. Plata que corre. Breuna lo guarda en un frasco de plomo y no me ha dejado olerlo hasta hoy. El azogue es el disolvente de
      la <b>Mente</b>: ingenio, reflejos, sentidos. Sus pociones juegan con Inteligencia y Destreza, y es más difícil de domar que el agua.</p>
      <p>Con el azogue llega una técnica nueva: la <b>Concentración</b>. Dos pociones del mismo reactivo se reducen juntas en una sola más
      pura. Se pierden las dos, pero lo que queda vale el doble.</p>
      <p>Y dos modificadores que se miran el uno al otro: el <b>Concentrador</b> (menos duración, más potencia) y el <b>Diluyente</b>
      (más duración, menos potencia). Con <b>Añadir efecto</b> puedo meter un bloque de efecto más en la misma poción.</p>
      <p>Breuna me ha enseñado a hacer pociones <b>Inhalables</b> (+3): basta con olerlas a un paso de distancia.</p>` },
  { nivel: 4, fecha: 'Noche sin luna del estío', titulo: 'Polvo que parece agua',
    texto: `
      <p>No sé cómo describirlo. Un polvo tan fino que se derrama como un líquido y que no moja. <b>Polvo etéreo</b>, el disolvente del
      <b>Alma</b>: voluntad, fe, presencia. Sus pociones se resisten con Sabiduría o Carisma.</p>
      <p>Ahora puedo hacer <b>Multipociones</b>: dos pociones distintas en un solo frasco. Si sus disolventes no son el mismo, cuesta más.</p>
      <p>Modificadores nuevos: el <b>Multiplicador</b> (multiplica dados o el total del efecto), el <b>Alterador</b> (cambia el tipo de
      daño o añade un efecto secundario) y todos esos raros que Breuna llama «<b>otros</b>» y que hay que describir a mano.</p>
      <p>Y la <b>Fumígena</b> (+4): una nube de tres pasos que respira todo el que esté dentro. No se mezcla con la inhalable.</p>` },
  { nivel: 5, fecha: 'Fin del año', titulo: 'Hechizos embotellados',
    texto: `
      <p>Breuna ha muerto este invierno y me ha dejado su caldero y una caja que no abría nunca. Dentro, frascos de <b>Esencia mágica</b>
      y planos de los ingenieros alquimistas: hechizos metidos en una botella. No es alquimia como la nuestra; por eso las pociones
      <b>Mágicas</b> se disipan y las naturales no.</p>
      <p>Las mágicas solo aceptan algunos modificadores: <b>Prolongador</b>, <b>Alterador</b> y dos que solo valen para ellas, el
      <b>Esencial</b> (fija la duración y el efecto) y el <b>Invertidor</b> (le da la vuelta al efecto). No se concentran ni se mezclan.</p>
      <p>Ya no me queda nada por aprender del caldero de Breuna. A partir de aquí, lo que descubra será mío. Firmo este diario como
      <b>maestro alquimista</b>.</p>
      <p class="diario-firma">— Jhon Arbaquel</p>` },
];

const K_VISTO = () => 'alquimiaDiarioVisto:' + (auth.usuario?.clave || 'local');
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

const visto = () => parseInt(lsGet(K_VISTO())) || 0;
export const hayPaginaNueva = () => visto() < niveles.nivelActual();

let pagina = 1;

function nombreDisolvente(c) { return getDisolvente(state.settings, c).name; }

function htmlPagina(n) {
  const nivel = niveles.nivelActual();
  const p = PAGINAS[n - 1];
  if (n > nivel) {
    return `<div class="diario-pegada">
      <div class="diario-candado">🔒</div>
      <p>Estas páginas están pegadas con algo seco y verdoso. Por los bordes se adivina la letra de Jhon…</p>
      <p class="muted">Se abren cuando el DM te suba al <b>nivel ${n}</b> de alquimia.</p>
    </div>`;
  }
  const nueva = n > visto();
  return `${nueva ? '<div class="diario-nueva">✒️ Página nueva</div>' : ''}
    <div class="diario-fecha">${p.fecha}</div>
    <h3 class="diario-titulo">${p.titulo}</h3>
    <div class="diario-texto">${p.texto}</div>
    <div class="diario-aprendido">
      <div class="diario-aprendido-tit">Lo que ahora sabes hacer · Nivel ${n}: ${niveles.tituloNivel(n)}</div>
      <ul>${niveles.novedades(n, nombreDisolvente).map(x => `<li>${x}</li>`).join('')}</ul>
    </div>`;
}

function pintar() {
  const modal = document.getElementById('diarioModal');
  if (!modal) return;
  modal.querySelector('.diario-pagina').innerHTML = htmlPagina(pagina);
  modal.querySelector('.diario-num').textContent = `Página ${pagina} de ${PAGINAS.length}`;
  modal.querySelector('[data-diario="ant"]').disabled = pagina <= 1;
  modal.querySelector('[data-diario="sig"]').disabled = pagina >= PAGINAS.length;
  // Una página leída queda vista
  if (pagina <= niveles.nivelActual() && pagina > visto()) {
    const v = pagina;
    setTimeout(() => { if (v > visto()) { lsSet(K_VISTO(), String(v)); pintarBarra(); } }, 1200);
  }
}

function crearModal() {
  if (document.getElementById('diarioModal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="diarioModal" class="diario-modal" hidden>
      <div class="diario-libro" role="dialog" aria-modal="true" aria-label="Diario de Jhon Arbaquel">
        <button class="diario-cerrar" data-diario="cerrar" title="Cerrar">✕</button>
        <div class="diario-cabecera">📓 Diario de Jhon Arbaquel</div>
        <div class="diario-pagina"></div>
        <div class="diario-pie">
          <button class="btn btn-sm" data-diario="ant">◀ Anterior</button>
          <span class="diario-num"></span>
          <button class="btn btn-sm" data-diario="sig">Siguiente ▶</button>
        </div>
      </div>
    </div>`);
  const modal = document.getElementById('diarioModal');
  modal.addEventListener('click', e => {
    const b = e.target.closest('[data-diario]');
    if (e.target === modal || b?.dataset.diario === 'cerrar') return cerrar();
    if (b?.dataset.diario === 'ant' && pagina > 1) { pagina--; pintar(); }
    if (b?.dataset.diario === 'sig' && pagina < PAGINAS.length) { pagina++; pintar(); }
  });
  document.addEventListener('keydown', e => {
    if (modal.hidden) return;
    if (e.key === 'Escape') cerrar();
    if (e.key === 'ArrowLeft' && pagina > 1) { pagina--; pintar(); }
    if (e.key === 'ArrowRight' && pagina < PAGINAS.length) { pagina++; pintar(); }
  });
}

export function abrir(n) {
  crearModal();
  const nivel = niveles.nivelActual();
  pagina = n || (hayPaginaNueva() ? Math.min(visto() + 1, nivel) : nivel);
  const modal = document.getElementById('diarioModal');
  modal.hidden = false;
  modal.classList.remove('abriendo'); void modal.offsetWidth; modal.classList.add('abriendo');
  pintar();
}

function cerrar() {
  const modal = document.getElementById('diarioModal');
  if (modal) modal.hidden = true;
  pintarBarra();
}

// Al entrar en Alquimia: si hay una página que no has leído, el diario se abre solo
export function alEntrarEnAlquimia() {
  pintarBarra();
  if (hayPaginaNueva()) setTimeout(() => abrir(), 350);
}

// Barra de nivel que se ve arriba en la pestaña Alquimia
export function pintarBarra() {
  const el = document.getElementById('alqNivelBar');
  if (!el) return;
  const n = niveles.nivelActual();
  const cambiar = niveles.puedeCambiarPropio();
  el.innerHTML = `
    <div class="nivel-insignia" title="Nivel de alquimia">
      <span class="nivel-num">${n}</span><span class="nivel-de">/${niveles.NIVEL_MAX}</span>
    </div>
    <div class="nivel-info">
      <div class="nivel-titulo">⚗️ ${niveles.tituloNivel(n)}</div>
      <div class="nivel-pasos">${niveles.NIVELES.map(x => `<span class="nivel-paso ${x.nivel <= n ? 'hecho' : ''}" title="Nivel ${x.nivel}: ${x.titulo}"></span>`).join('')}</div>
      <div class="muted nivel-nota">${n >= niveles.NIVEL_MAX ? 'Toda la alquimia está a tu alcance.'
        : cambiar ? (auth.servidor ? 'Como DM puedes cambiar tu propio nivel. El de cada jugador, en Inventario → Inventarios de la mesa.' : 'Sin servidor no hay DM: cambia tu nivel aquí.')
        : 'El DM decide cuándo subes de nivel.'}</div>
    </div>
    <div class="nivel-acciones">
      ${cambiar ? `<button class="btn btn-sm" data-action="nivel-propio" data-id="-1" ${n <= 1 ? 'disabled' : ''} title="Bajar nivel">−</button>
        <button class="btn btn-sm" data-action="nivel-propio" data-id="1" ${n >= niveles.NIVEL_MAX ? 'disabled' : ''} title="Subir nivel">+</button>` : ''}
      <button class="btn btn-diario ${hayPaginaNueva() ? 'con-novedad' : ''}" data-action="abrir-diario">📓 Diario de Jhon Arbaquel</button>
      <button class="btn btn-sm btn-info" data-action="switch-tab" data-id="info">📜 Compendio</button>
    </div>`;
}

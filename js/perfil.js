// perfil.js — módulo Perfil: el personaje de cada jugador en cada campaña.
//
// La CUENTA (nombre de usuario) es la persona; el PERSONAJE es a quien juega en
// esa campaña: nombre, raza, clase, nivel, mod. INT, bono de alquimista, retrato
// y notas. Con servidor el personaje se guarda allí (uno por campaña):
//   - cada jugador edita el suyo;
//   - el DM (y el superusuario) pueden editar el de cualquiera de su campaña;
//   - el nombre de usuario no lo cambia nadie desde aquí.
// Todos los de la campaña pueden ver los perfiles de los demás.
// La foto (avatar) es de la CUENTA, no del personaje: si la hay, se ve en lugar del retrato (ver avatar.js).
// Sin servidor, solo hay un perfil (el de este navegador, en state.character).
import { state, saveState } from './state.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { nombreDisciplina } from './panel.js';
import * as niveles from './niveles.js';
import * as avatar from './avatar.js';

let perfiles = [];
let elegido = null;          // clave del perfil que se está mirando
let editando = false;
let alCambiarPropio = () => {};

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VACIO = { nombre: '', raza: '', clase: '', nivel: 1, intMod: 0, bono: 0, retrato: '', notas: '' };

// ---- Conversión con state.character (lo que usan la barra, la lectura y el caldero) ----
export function aCharacter(p) {
  return { ...(p || VACIO), name: p?.nombre || '', intMod: p?.intMod || 0, bonus: p?.bono || 0 };
}
export function aPersonaje(ch) {
  const p = { ...VACIO };
  for (const k of Object.keys(VACIO)) if (ch?.[k] !== undefined) p[k] = ch[k];
  p.nombre = String(ch?.name ?? ch?.nombre ?? '').slice(0, 40);
  p.intMod = Math.max(-5, Math.min(10, parseInt(ch?.intMod) || 0));
  p.bono = Math.max(0, Math.min(20, parseInt(ch?.bonus ?? ch?.bono) || 0));
  p.nivel = Math.max(1, Math.min(30, parseInt(p.nivel) || 1));
  return p;
}
const tienePropio = () => auth.servidor && auth.mesa && !auth.esAdmin();
export const nombrePersonaje = () => (auth.servidor ? auth.usuario?.personaje?.nombre : state.character?.name) || '';

// ---- Guardar el propio ----
let espera = null;
export function subirPropio() {
  if (!tienePropio()) return;
  clearTimeout(espera);
  espera = setTimeout(async () => {
    const personaje = aPersonaje(state.character);
    const r = await auth.apiMesa('/api/mesa/personaje', { personaje });
    if (r.ok) { auth.usuario.personaje = r.personaje; alCambiarPropio(); if (visible()) cargar(); }
    else sync.aviso(r.mensaje, 'error');
  }, 700);
}

// Al cargar: el personaje sale del servidor. Si allí no hay ninguno, se sube el de este navegador.
export function alCargar() {
  if (!tienePropio()) return;
  if (auth.usuario.personaje) state.character = aCharacter(auth.usuario.personaje);
  // Un personaje que este navegador ya tenía guardado (no el nombre de usuario puesto por defecto)
  else if (state.character?.name && state.character.name !== auth.usuario.nombre && state.character.name !== 'Mi personaje') subirPropio();
  else state.character = aCharacter(null);
}

// El servidor dice que el personaje propio ha cambiado (p. ej. lo ha editado el DM)
export function alCambiarEnServidor() {
  if (!tienePropio() || !auth.usuario.personaje) return;
  state.character = aCharacter(auth.usuario.personaje);
  alCambiarPropio();
  if (visible() && !editando) cargar();
}

export function visible() { return document.getElementById('tab-perfil')?.classList.contains('active'); }

export async function cargar() {
  if (!auth.servidor) { render(); return; }
  try {
    const r = await sync.pedir('/api/mesa/perfiles');
    if (r.status === 200 && r.j?.ok) perfiles = r.j.perfiles;
  } catch (_) {}
  if (!elegido || !perfiles.some(p => p.clave === elegido))
    elegido = (perfiles.find(p => p.clave === auth.usuario?.clave) || perfiles[0])?.clave || null;
  render();
}

export function ver(clave) { elegido = clave; editando = false; cargar(); }

function puedeEditar(p) {
  if (!auth.servidor) return true;
  return !!p && (p.clave === auth.usuario?.clave || auth.esDM());
}

function retrato(p, clase = '') {
  const r = p?.personaje?.retrato;
  const ini = (p?.personaje?.nombre || p?.nombre || '?').trim()[0]?.toUpperCase() || '?';
  return avatar.html(p?.clave, p?.avatar, r || ini, `perfil-retrato ${clase}`);
}

export function render() {
  const el = document.getElementById('perfilPanel');
  if (!el) return;
  if (editando && el.contains(document.activeElement)) return;   // no machacar lo que se está escribiendo
  // Sin servidor: un solo perfil, el de este navegador
  const lista = auth.servidor ? perfiles
    : [{ clave: '-', nombre: 'Este navegador', rol: 'jugador', disciplina: 'alquimista', personaje: aPersonaje(state.character), local: true }];
  if (!auth.servidor) elegido = '-';
  if (auth.servidor && auth.esAdmin() && !lista.length) { el.innerHTML = '<p class="muted">Todavía no hay nadie en esta campaña.</p>'; return; }
  const p = lista.find(x => x.clave === elegido);
  const chips = auth.servidor ? `<div class="dm-chips">${lista.map(x => `<button class="dm-chip ${x.clave === elegido ? 'activo' : ''}" data-perfil="ver" data-clave="${esc(x.clave)}">
      ${x.avatar ? avatar.html(x.clave, x.avatar, '', 'avatar avatar-mini') : esc(x.personaje?.retrato || '')} ${esc(x.personaje?.nombre || x.nombre)}${x.personaje?.nombre ? ` <span class="muted">(${esc(x.nombre)})</span>` : ''}${x.clave === auth.usuario?.clave ? ' · tú' : ''}</button>`).join('')}</div>` : '';
  if (!p) { el.innerHTML = chips + '<p class="muted">Elige un perfil.</p>'; return; }
  const pj = { ...VACIO, ...(p.personaje || {}) };
  const yo = p.clave === auth.usuario?.clave || p.local;
  const nivelAlq = p.local ? niveles.nivelActual() : (p.nivelAlquimia || 1);
  const rolTxt = p.rol === 'dm' ? '👑 DM' : '⚔️ Jugador';
  const cabecera = `<div class="perfil-cab">
      ${retrato(p, 'perfil-retrato-grande')}
      <div>
        <h3 class="perfil-nombre">${esc(pj.nombre || 'Sin nombre de personaje')}</h3>
        <div class="perfil-sub">${[pj.raza, pj.clase].filter(Boolean).map(esc).join(' · ') || '<span class="muted">Raza y clase sin escribir</span>'}${pj.nivel ? ` · nivel ${pj.nivel}` : ''}</div>
        ${auth.servidor ? `<div class="perfil-cuenta">Jugador: <b>${esc(p.nombre)}</b> <span class="muted">(nombre de usuario: no se puede cambiar)</span> · ${rolTxt}</div>` : ''}
        <div class="perfil-cuenta">${nombreDisciplina(p.disciplina)} · ⚗️ alquimia nivel ${nivelAlq} (${esc(niveles.tituloNivel(nivelAlq))})</div>
      </div>
    </div>`;
  if (!editando) {
    el.innerHTML = `${chips}
      <div class="perfil-ficha">${cabecera}
        <div class="perfil-datos">
          <div><span>Mod. INT</span><b>${pj.intMod >= 0 ? '+' : ''}${pj.intMod}</b></div>
          <div><span>Bono alquimista</span><b>+${pj.bono}</b></div>
          <div><span>Nivel</span><b>${pj.nivel}</b></div>
        </div>
        ${pj.notas ? `<div class="perfil-notas">${esc(pj.notas).replace(/\n/g, '<br>')}</div>` : '<p class="muted">Sin notas.</p>'}
        <div class="perfil-botones">
          ${puedeEditar(p) ? `<button class="btn" data-perfil="editar">✏️ ${yo ? 'Editar mi perfil' : 'Editar este perfil (como DM)'}</button>` : ''}
          ${yo && auth.servidor ? `<button class="btn" data-action="foto-perfil">📷 ${p.avatar ? 'Cambiar mi foto' : 'Poner una foto'}</button>` : ''}
        </div>
        ${yo ? cajaCorreo() : ''}
        ${yo ? cajaDiscord() : ''}
      </div>`;
    return;
  }
  const campo = (k, etiqueta, extra = '') => `<label class="perfil-campo"><span>${etiqueta}</span>${extra || `<input type="text" data-pj="${k}" value="${esc(pj[k])}" maxlength="40">`}</label>`;
  el.innerHTML = `${chips}
    <div class="perfil-ficha">${cabecera}
      ${!yo ? `<p class="muted">Estás editando el perfil de <b>${esc(p.nombre)}</b> como DM. Lo verá al momento.</p>` : ''}
      <div class="perfil-form">
        ${campo('nombre', 'Nombre del personaje')}
        ${campo('raza', 'Raza')}
        ${campo('clase', 'Clase')}
        ${campo('nivel', 'Nivel', `<input type="number" data-pj="nivel" min="1" max="30" value="${pj.nivel}">`)}
        ${campo('intMod', 'Mod. INT', `<input type="number" data-pj="intMod" min="-5" max="10" value="${pj.intMod}">`)}
        ${campo('bono', 'Bono alquimista', `<input type="number" data-pj="bono" min="0" max="20" value="${pj.bono}">`)}
        ${campo('retrato', auth.servidor ? 'Emoji (si no hay foto)' : 'Retrato (un emoji)', `<input type="text" data-pj="retrato" maxlength="8" value="${esc(pj.retrato)}" placeholder="🧙">`)}
        <label class="perfil-campo perfil-campo-ancho"><span>Notas (historia, rasgos…)</span><textarea data-pj="notas" maxlength="2000" rows="5">${esc(pj.notas)}</textarea></label>
      </div>
      <div class="perfil-botones">
        <button class="btn" data-perfil="guardar">💾 Guardar</button>
        <button class="btn" style="background:#777" data-perfil="cancelar">Cancelar</button>
      </div>
    </div>`;
}

// Vincular la cuenta con Discord (solo la propia, y no el superusuario)
function cajaDiscord() {
  const u = auth.usuario;
  if (!auth.servidor || !u || auth.esAdmin() || !u.discordActivo) return '';
  const d = u.discord || {};
  return d.vinculado
    ? `<div class="perfil-discord">🎮 Discord vinculado${d.nombre ? ` como <b>@${esc(d.nombre)}</b>` : ''}.
        <button class="btn btn-sm" data-perfil="discord-quitar">Desvincular</button></div>`
    : `<div class="perfil-discord">🎮 Vincula tu cuenta con Discord para que el DM sepa quién eres.
        <button class="btn-discord" data-perfil="discord-vincular">Vincular con Discord</button></div>`;
}

// Correo para recuperar la contraseña (solo lo ve su dueño; el superusuario no usa correo)
function cajaCorreo() {
  const u = auth.usuario;
  if (!auth.servidor || !u || auth.esAdmin() || !u.correoActivo) return '';
  const c = u.correo || {};
  const pendiente = c.pendiente ? `<div class="muted">⏳ Falta confirmar <b>${esc(c.pendiente)}</b>: abre el enlace que te hemos mandado.
      <button class="btn btn-sm" data-perfil="correo-poner" data-correo="${esc(c.pendiente)}">Reenviar</button></div>` : '';
  return c.correo
    ? `<div class="perfil-discord perfil-correo">📧 Correo: <b>${esc(c.correo)}</b> <span class="muted">(solo lo ves tú; sirve para cambiar la contraseña si la olvidas)</span>
        <button class="btn btn-sm" data-perfil="correo-poner">Cambiar</button>
        <button class="btn btn-sm btn-danger" data-perfil="correo-quitar">Quitar</button>${pendiente}</div>`
    : `<div class="perfil-discord perfil-correo">📧 Pon tu correo para poder cambiar la contraseña si la olvidas. Solo lo verás tú.
        <button class="btn btn-sm" data-perfil="correo-poner">Poner correo</button>${pendiente}</div>`;
}

function leerForm(el) {
  const p = { ...VACIO };
  el.querySelectorAll('[data-pj]').forEach(i => {
    const k = i.dataset.pj;
    p[k] = i.type === 'number' ? parseInt(i.value) || 0 : i.value.trim();
  });
  p.nivel = Math.max(1, Math.min(30, p.nivel || 1));
  p.intMod = Math.max(-5, Math.min(10, p.intMod));
  p.bono = Math.max(0, Math.min(20, p.bono));
  return p;
}

export function init(onCambioPropio) {
  alCambiarPropio = onCambioPropio || alCambiarPropio;
  const el = document.getElementById('perfilPanel');
  if (!el) return;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-perfil]');
    if (!b) return;
    const a = b.dataset.perfil;
    if (a === 'ver') { elegido = b.dataset.clave; editando = false; render(); return; }
    if (a === 'discord-vincular') { const m = await auth.empezarDiscord('vincular'); if (m) alert(m); return; }
    if (a === 'discord-quitar') {
      if (!confirm('¿Desvincular Discord de tu cuenta?')) return;
      const r = await auth.desvincularDiscord();
      if (!r.ok) alert(r.mensaje); else sync.aviso('Discord desvinculado.');
      render();
      return;
    }
    if (a === 'correo-poner' || a === 'correo-quitar') {
      const quitar = a === 'correo-quitar';
      if (quitar && !confirm('¿Quitar el correo? Si olvidas la contraseña, tendrá que ponerte una el DM.')) return;
      const correo = quitar ? '' : (b.dataset.correo || prompt('Tu correo:', auth.usuario.correo?.correo || ''));
      if (!quitar && !correo?.trim()) return;
      const contrasena = prompt('Para comprobar que eres tú, escribe tu contraseña actual:');
      if (!contrasena) return;
      const r = await auth.ponerCorreo(correo.trim(), contrasena);
      if (!r.ok) { alert(r.mensaje); return; }
      sync.aviso(quitar ? 'Correo quitado.' : `Te hemos mandado un enlace a ${r.pendiente}. Ábrelo para confirmar el correo.`);
      render();
      return;
    }
    if (a === 'editar') { editando = true; document.activeElement?.blur(); render(); el.querySelector('[data-pj="nombre"]')?.focus(); return; }
    if (a === 'cancelar') { editando = false; document.activeElement?.blur(); render(); return; }
    if (a === 'guardar') {
      const personaje = leerForm(el);
      if (!auth.servidor) {   // sin servidor: se guarda en este navegador
        state.character = { ...state.character, ...aCharacter(personaje) };
        saveState(); editando = false; document.activeElement?.blur(); alCambiarPropio(); render(); return;
      }
      const p = perfiles.find(x => x.clave === elegido);
      const r = await auth.apiMesa('/api/mesa/personaje', { usuario: p.clave, personaje });
      if (!r.ok) { alert(r.mensaje); return; }
      if (p.clave === auth.usuario.clave) {
        auth.usuario.personaje = r.personaje;
        state.character = aCharacter(r.personaje);
        alCambiarPropio();
      }
      editando = false;
      document.activeElement?.blur();
      sync.aviso(p.clave === auth.usuario.clave ? 'Perfil guardado.' : `Perfil de ${p.nombre} guardado.`);
      await cargar();
    }
  });
}


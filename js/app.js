// app.js — arranque, módulos de la mesa, navegación y delegación de eventos
import { state, loadState, saveState, setState, getDefaultState, normalizeState, applyServerData } from './state.js';
import * as sync from './sync.js';
import { SOUND_ENABLED, setSoundEnabled } from './data.js';
import { togglePotCatEntry, renderAll, renderCatMateriales, renderInvMateriales, renderInvPociones, renderCatPociones, renderLoot, usePotion, setApodo, delPotion, renderSettings, onSettingChange } from './render.js';
import {
  updateMatForm, addMat, editMat, deleteMat, cancelDelete,
  addDiceRow, removeDiceRow, updateNoPurificable, populateDamageTypeSelect,
  addLoot, deleteLoot, identifyLoot, resetForm,
  addEffect, removeEffect, onEffectFieldChange,
} from './form.js';
import {
  craftSetMode, craftConfirm, renderCrafteo, updateAplicacionPanel, updateCraftSummary,
  craftSelectedSolvent, craftSelectedBase, craftSelectedMods, craftPotionPicks,
  setCraftSelectedSolvent, setCraftSelectedBase, setCraftSelectedMods, setCraftPotionPicks,
} from './crafting.js';
import { renderCauldron, syncCaulAplics, setCaulCraftState, brewCauldron } from './cauldron.js';
import * as auth from './auth.js';
import * as panel from './panel.js';
import * as dm from './dm.js';
import * as modulos from './modulos.js';
import * as lectura from './lectura.js';
import * as niveles from './niveles.js';
import * as diario from './diario.js';
import * as perfil from './perfil.js';
import * as cuenta from './cuenta.js';
import * as avatar from './avatar.js';
import * as filtros from './filtros.js';
import * as objetos from './objetos.js';
import * as bolsa from './bolsa.js';
import * as inventario from './inventario.js';
import * as odres from './odres.js';

// ---- Cauldron toggle state ----
let caulActive = false;

// ---- Expose functions needed by inline onclick in rendered HTML ----
window.togglePotCatEntry = togglePotCatEntry;
window.addDiceRow = addDiceRow;
window.removeDiceRow = removeDiceRow;

// ---- Navigation ----
// Alquimia (V3.8): todo lo de la alquimia junto. Alta de materiales y parámetros, solo el DM (o sin servidor).
const ALQ_SUBS = ['caldero', 'materiales', 'recetario', 'odres', 'alta', 'parametros'];
let alqSub = 'caldero';
function showAlqSubtab(id) {
  if ((id === 'alta' || id === 'parametros') && sync.modo === 'servidor' && !auth.esDM()) id = 'caldero';
  if (!ALQ_SUBS.includes(id)) id = 'caldero';
  alqSub = id;
  ALQ_SUBS.forEach(s => {
    const el = document.getElementById('alqSub-' + s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.querySelectorAll('[data-action="alq-subtab"]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-id') === id);
  });
  if (id === 'caldero') { if (caulActive) renderCauldron(); else renderCrafteo(); }
  if (id === 'materiales') renderCatMateriales();
  if (id === 'recetario') renderCatPociones();
  if (id === 'odres') odres.render();
  if (id === 'parametros') renderSettings();
}

// Inventario (V3.8): una sola lista con todo; el DM tiene además los inventarios de la mesa
function showInvSubtab(id) {
  if (id === 'dm' && !auth.esDM()) id = 'todo';
  if (id !== 'dm') id = 'todo';
  ['todo','dm'].forEach(s => {
    const el = document.getElementById('invSub-' + s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.querySelectorAll('[data-action="inv-subtab"]').forEach(b => {
    b.className = 'subtab-btn' + (b.getAttribute('data-id') === id ? ' active' : '') + (b.getAttribute('data-id') === 'dm' ? ' subtab-dm solo-dm' : '');
  });
  if (id === 'todo') { objetos.render(); inventario.render(); }
  if (id === 'dm') { dm.render(); dm.recargar(); }
}

// ---- Módulos de la mesa ----
// Cada módulo es una pestaña (y quizá una tarjeta de la mesa). Ver modulos.js
// y docs/ARQUITECTURA.md para añadir uno nuevo (cocina, ficha, armas...).
modulos.registrar({ id: 'panel', icono: '🏰', titulo: 'Mesa', lugar: 'panel', lugarTxt: 'en la mesa principal',
  alMostrar() { panel.pintarSaludo(); panel.animarEntrada(); } });
modulos.registrar({ id: 'inventario', icono: '🎒', titulo: 'Inventario', lugar: 'inventario', lugarTxt: 'revisando su inventario',
  tarjeta: { orden: 0, clase: 'tarjeta-inventario', texto: 'Todo lo que llevas: objetos, materiales, pociones, libros y odres' },
  resumen: () => panel.resumenInventario(),
  alMostrar() {
    objetos.render(); bolsa.render(); inventario.render();
    if (document.getElementById('invSub-dm')?.style.display !== 'none') { dm.render(); dm.recargar(); }
  } });
// Ranura de oficio (orden 1): cada jugador ve la de su disciplina, que le asigna el DM.
// Desempleado: ninguna. Con varias: todas, cada una con su bola en la mesa y su pestaña.
modulos.registrar({ id: 'crafteo', icono: '⚗️', titulo: 'Alquimia', lugar: 'alquimia', lugarTxt: 'junto al caldero',
  disciplina: 'alquimista',
  tarjeta: { orden: 1, clase: 'tarjeta-alquimia', texto: 'El caldero, tus materiales, el recetario y los odres' },
  resumen: () => panel.resumenAlquimia(),
  alMostrar() { showAlqSubtab(alqSub); diario.alEntrarEnAlquimia(); } });
modulos.registrar({ id: 'cocina', icono: '🍲', titulo: 'Cocina', lugar: 'cocina', lugarTxt: 'entre fogones',
  disciplina: 'cocinero', proximamente: { texto: 'Guisos, banquetes y raciones que dan fuerza para el camino. Los fogones de la taberna aún se están encendiendo.' },
  tarjeta: { orden: 1, clase: 'tarjeta-cocina', texto: 'Guisos que dan fuerza' },
  resumen: () => 'Próximamente' });
modulos.registrar({ id: 'hechiceria', icono: '✨', titulo: 'Hechicería', lugar: 'hechiceria', lugarTxt: 'trazando runas',
  disciplina: 'hechicero', proximamente: { texto: 'Pergaminos, runas y conjuros preparados. El grimorio todavía está en blanco.' },
  tarjeta: { orden: 1, clase: 'tarjeta-hechiceria', texto: 'Runas, pergaminos y conjuros' },
  resumen: () => 'Próximamente' });
modulos.registrar({ id: 'herreria', icono: '⚒️', titulo: 'Herrería', lugar: 'herreria', lugarTxt: 'junto a la forja',
  disciplina: 'herrero', proximamente: { texto: 'Armas, armaduras y sus efectos. La forja aún se está calentando.' },
  tarjeta: { orden: 1, clase: 'tarjeta-herreria', texto: 'Armas, armaduras y temple' },
  resumen: () => 'Próximamente' });
modulos.registrar({ id: 'lectura', icono: '📖', titulo: 'Lectura', lugar: 'lectura', lugarTxt: 'leyendo un libro',
  tarjeta: { orden: 2, clase: 'tarjeta-lectura', texto: 'Tus libros: darlos de alta y leerlos' },
  resumen: () => lectura.resumen(),
  alMostrar() { lectura.render(); lectura.renderInventario(); } });
// Perfil y En línea no tienen pestaña: se abren desde el menú de la cuenta (arriba a la derecha)
modulos.registrar({ id: 'perfil', icono: '🧙', titulo: 'Perfil', lugar: 'perfil', lugarTxt: 'mirando perfiles', pestana: false,
  textoMesa: 'Tu personaje, tu foto y los perfiles de la mesa',
  alMostrar() { perfil.cargar(); } });
modulos.registrar({ id: 'usuarios', icono: '🟢', titulo: 'En línea', lugar: 'usuarios', lugarTxt: 'mirando quién anda por aquí',
  contador: 'navOnlineCount', pestana: false,
  tarjeta: { orden: 3, clase: 'tarjeta-usuarios', icono: '🔮', titulo: 'Usuarios en línea', texto: 'Quién está en la mesa ahora' },
  resumen: () => panel.resumenUsuarios(),
  alMostrar() { panel.renderUsuarios(); panel.cargarGestion(); } });

function switchTab(id) {
  if (!modulos.visible(modulos.porId(id))) id = 'panel';
  modulos.todos().forEach(m => {
    const el = document.getElementById('tab-' + m.id);
    if (el) el.className = 'tab-content' + (m.id === id ? ' active' : '');
  });
  document.querySelectorAll('nav.tab-bar [data-action="switch-tab"]').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-id') === id);
  });
  document.body.dataset.vista = id;
  sync.setLugar(modulos.lugarDe(id));
  modulos.porId(id).alMostrar?.();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const vistaActual = () => document.body.dataset.vista;

// "Ver perfil" en la lista de usuarios
function verPerfilDe(clave) {
  switchTab('perfil');
  perfil.ver(clave);
}

// Cuando cambia el personaje propio (desde el perfil, la barra o porque lo editó el DM)
function alCambiarPersonaje() {
  panel.pintarSaludo();
  if (vistaActual() === 'lectura') lectura.render();
  if (vistaActual() === 'usuarios') panel.renderUsuarios();
}

// El DM pulsa "Ver inventario" en la lista de usuarios
function verInventarioDe(clave) {
  switchTab('inventario');
  showInvSubtab('dm');
  dm.elegir(clave);
}

// Pestañas y tarjetas según la disciplina (la ranura de oficio)
function construirModulos() {
  // El DM y el superusuario tienen acceso a todos los oficios y eligen cuál usar
  modulos.setDisciplina(sync.modo === 'servidor' && auth.esDM() ? 'pluriempleado' : auth.usuario?.disciplina);
  modulos.setDM(sync.modo === 'servidor' && auth.esDM());
  modulos.construirPestanas(document.getElementById('barraModulos'));
  const u = auth.usuario;
  modulos.construirTarjetas(document.getElementById('mesaTarjetas'),
    avatar.html(u?.clave, u?.avatar, u ? (String(u.nombre || '').trim()[0] || '?').toUpperCase() : '🧙', 'avatar orbita-avatar'),
    { alPortal: sync.modo === 'servidor' ? () => auth.cambiarMesa() : null });   // el planeta es el portal a las campañas
  modulos.construirSelectorOficio(document.getElementById('mesaOficios'));
  document.querySelectorAll('nav.tab-bar [data-action="switch-tab"]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-id') === vistaActual()));
  panel.pintarTarjetas();
}

// Pluriempleado: cambia el oficio de la ranura (si estaba en el antiguo, pasa al nuevo)
function elegirOficio(d) {
  const enOficio = !!modulos.porId(vistaActual())?.disciplina;
  modulos.setOficio(d);
  construirModulos();
  if (enOficio) switchTab(modulos.oficios().find(m => m.disciplina === d)?.id || 'panel');
  else panel.animarEntrada();
}

// Cosas que solo ve el DM (o que cambian si el DM da o quita poderes)
function aplicarRol() {
  if (vistaActual()) {   // (ya arrancada)
    construirModulos();
    if (!modulos.visible(modulos.porId(vistaActual()))) switchTab('panel');
    if (vistaActual() === 'crafteo') showAlqSubtab(alqSub);   // si ya no es DM, fuera del alta de materiales
    renderAll();   // el catálogo y el inventario dependen de quién mira
  }
  panel.pintarCabecera();
  cuenta.pintar();
  panel.pintarSaludo();
  diario.pintarBarra();
  lectura.render(); lectura.renderInventario();
  if (!auth.esDM() && document.getElementById('invSub-dm')?.style.display !== 'none') showInvSubtab('todo');
  if (document.getElementById('tab-usuarios')?.classList.contains('active')) { panel.renderUsuarios(); panel.cargarGestion(); }
}

// Acciones que con servidor solo puede hacer el DM (el servidor también lo comprueba)
function soloDM(que) {
  if (sync.modo !== 'servidor' || auth.esDM()) return false;
  alert(`Solo el DM puede ${que}: afecta a toda la mesa.`);
  return true;
}

// ---- Cauldron toggle ----
// Re-hide text panels after anything that might call renderCrafteo() internally
function hideCauldronTextPanels() {
  ['craftElaboracionPanels','craftAplicacionPanel','craftConfirmPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showCauldron() {
  caulActive = true;
  const caulPanel = document.getElementById('craftCalderoPanel');
  const btn       = document.getElementById('caulToggleBtn');
  if (caulPanel) caulPanel.style.display = 'block';
  hideCauldronTextPanels();
  if (btn) { btn.textContent = '📋 Vista Texto'; btn.classList.add('active'); }
  renderCauldron();
}

function hideCauldron() {
  caulActive = false;
  const caulPanel    = document.getElementById('craftCalderoPanel');
  const elaborPanels = document.getElementById('craftElaboracionPanels');
  const confirmPanel = document.getElementById('craftConfirmPanel');
  const btn          = document.getElementById('caulToggleBtn');
  if (caulPanel)    caulPanel.style.display    = 'none';
  if (elaborPanels) elaborPanels.style.display = 'block';
  if (confirmPanel) confirmPanel.style.display = 'block';
  if (btn) { btn.textContent = '🫧 Vista Caldero'; btn.classList.remove('active'); }
  renderCrafteo();
}

function toggleCauldron() {
  caulActive ? hideCauldron() : showCauldron();
}

// ---- Personaje ----
// El personaje (nombre, mod. INT, bono) se edita en Perfil (perfil.js); ya no hay barra arriba.
// Al poner o quitar la foto propia: se repinta donde sale
function alCambiarFoto() {
  cuenta.pintar();
  panel.pintarTarjetas();
  if (vistaActual() === 'usuarios') panel.renderUsuarios();
  if (vistaActual() === 'perfil') perfil.cargar();
}

// ---- Import / Export ----
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alquimia_v2_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Servidor compartido: cambios de otras personas y rechazos ----
function rerenderAfterServer() {
  const caulBusy = document.querySelector('#caulStage.caul-brewing');
  // Si otra persona borró algo que tenías elegido en el caldero, se quita de la selección
  if (craftSelectedBase && !state.catalog[craftSelectedBase]) { setCraftSelectedBase(null); setCraftSelectedMods({}); }
  const mods = Object.fromEntries(Object.entries(craftSelectedMods).filter(([mid]) => state.catalog[mid]));
  if (Object.keys(mods).length !== Object.keys(craftSelectedMods).length) setCraftSelectedMods(mods);
  if (craftPotionPicks.some(pk => !state.potions[pk])) setCraftPotionPicks(craftPotionPicks.filter(pk => state.potions[pk]));
  renderAll();
  if (caulBusy) return;
  if (caulActive) renderCauldron(); else renderCrafteo();
  populateDamageTypeSelect();
  if (document.getElementById('settingsPanel')?.contains(document.activeElement)) return;
  renderSettings();
}
sync.setHooks({
  presencia(lista) { panel.setPresencia(lista); },
  pendientes(n) { panel.setPendientes(n); },   // cuentas de Discord esperando aprobación (solo DM)
  usuario(u, antes) {
    aplicarRol();
    if (antes && antes.rol !== u.rol) sync.aviso(auth.esDM() ? '👑 Ahora eres DM de la mesa.' : 'Ya no eres DM de la mesa.');
    if (antes && antes.personaje !== JSON.stringify(u.personaje || null)) perfil.alCambiarEnServidor();
    if (antes && antes.disciplina !== u.disciplina && !auth.esDM()) {
      construirModulos();
      if (!modulos.visible(modulos.porId(vistaActual()))) switchTab('panel');
      sync.aviso(`El DM ha cambiado tus oficios: ${panel.nombreDisciplina(u.disciplina)}.`);
    }
  },
  remoto(datos, cambios) {
    const nivelAntes = niveles.nivelActual();
    applyServerData(datos);
    rerenderAfterServer();
    panel.pintarTarjetas();
    lectura.renderInventario();
    objetos.render();
    bolsa.render();
    if (alqSub === 'odres') odres.render();
    if (vistaActual() === 'lectura' && !document.getElementById('tab-lectura')?.contains(document.activeElement)) lectura.render();
    const nivelAhora = niveles.nivelActual();
    if (nivelAhora !== nivelAntes) {
      diario.pintarBarra();
      if (nivelAhora > nivelAntes) {
        sync.aviso(`📓 ¡Subes al nivel ${nivelAhora} de alquimia! Jhon Arbaquel ha escrito una página nueva en su diario.`);
        if (vistaActual() === 'crafteo') diario.alEntrarEnAlquimia();
      } else sync.aviso(`Tu nivel de alquimia ahora es ${nivelAhora}.`);
    }
    if (dm.visible()) dm.recargar();
    for (const c of cambios) sync.aviso(`${c.autor}: ${c.resumen || 'ha hecho cambios'}`);
  },
  rechazo(msg) {
    // refrescar() ya ha llamado a remoto() con el estado bueno del servidor
    sync.aviso(msg.split('\n')[0], 'error');
    // Si lo rechazado era una elaboración que ya se veía como hecha, se corrige el resultado
    const nota = `<div class="result-box fail"><div class="verdict">⚠️ No se ha guardado</div><p>${msg.split('\n')[0]}</p><p>No se ha gastado nada ni se ha creado la poción.</p></div>`;
    const res = document.getElementById('craftResult');
    if (res?.innerHTML.trim()) res.innerHTML = nota;
    const notif = document.getElementById('caulNotifArea');
    if (caulActive && notif?.querySelector('.caul-notif')) notif.innerHTML = `<div class="caul-notif caul-notif-fail">${nota}</div>`;
    alert('⚠️ ' + msg);
  },
});

// Antes de gastar materiales, trae lo último del servidor (no hace nada en modo local)
async function freshThenCraft() {
  await sync.refrescar({ silencioso: true });
  return craftConfirm();
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await auth.iniciar();          // pantalla de entrada (solo si hay servidor)
  avatar.init();                 // las fotos de perfil se cargan solas donde aparezcan
  cuenta.init();                 // icono de la cuenta arriba a la derecha
  panel.pintarCabecera();
  await loadState();
  perfil.alCargar();             // con servidor, el personaje sale del perfil de esta campaña
  updateMatForm();
  // Buscadores y filtros de las listas (ver filtros.js)
  filtros.init({
    'inv': inventario.render, 'cat-mat': () => renderCatMateriales(), 'cat-pot': renderCatPociones, 'usuarios': () => panel.renderUsuarios(),
  });
  renderAll();
  renderCrafteo();
  dm.init();
  lectura.init();
  objetos.init();
  inventario.init();
  objetos.render();
  odres.init();
  odres.setAlCambiar(() => { if (caulActive) renderCauldron(); else renderCrafteo(); panel.pintarTarjetas(); });
  bolsa.init();
  panel.initUsuarios(verInventarioDe, verPerfilDe);
  perfil.init(alCambiarPersonaje);
  modulos.construirProximamente(document.querySelector('script[src="js/app.js"]'));
  construirModulos();
  diario.pintarBarra();
  switchTab('panel');            // las tarjetas aparecen una a una
  if (auth.mensajeDiscord) sync.aviso(auth.mensajeDiscord.texto, auth.mensajeDiscord.tipo);   // vuelta de Discord

  // Form triggers
  ['matCampo','matPolaridad','matUnknown','matType','matModKind'].forEach(id =>
    document.getElementById(id).addEventListener('change', updateMatForm));
  document.getElementById('matDurationMode').addEventListener('change', function () {
    document.getElementById('durationModValueRow').style.display = this.value === 'none' ? 'none' : 'block';
  });
  // Effect block fields
  const effRows = document.getElementById('effectRows');
  effRows.addEventListener('change', e => { if (e.target.dataset.eidx != null) onEffectFieldChange(e.target); });
  effRows.addEventListener('input',  e => { if (e.target.dataset.eidx != null) onEffectFieldChange(e.target); });
  // Parámetros
  document.getElementById('settingsPanel').addEventListener('change', e => {
    if (e.target.dataset.setting) { onSettingChange(e.target); updateMatForm(); renderCatPociones(); }
  });
  document.getElementById('matDurationInstant').addEventListener('change', function () {
    document.getElementById('durationDiceSection').style.display = this.checked ? 'none' : 'block';
    updateNoPurificable();
  });

  // Aplicación checkboxes
  document.querySelectorAll('[name="craftAplic"]').forEach(cb => {
    cb.addEventListener('change', () => { updateAplicacionPanel(); updateCraftSummary(); });
  });

  // Import file
  document.getElementById('importFile').addEventListener('change', function () {
    if (this.files?.[0]) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const imported = normalizeState(JSON.parse(e.target.result));
          if (sync.modo === 'servidor' && !auth.esDM()) {
            // El nivel de alquimia y las tiradas de los libros solo los cambia el DM: se conservan los de ahora
            imported.perfil = state.perfil;
            // Lo común de la mesa (catálogo, parámetros) solo lo cambia el DM: se conserva el de ahora
            imported.catalog = state.catalog;
            imported.potionCatalog = { ...imported.potionCatalog, ...state.potionCatalog };
            imported.settings = state.settings;
            // Los odres los llena el DM y los descubrimientos los apunta el servidor: se conservan
            imported.odres = state.odres;
            imported.descubrimientos = state.descubrimientos;
            imported.damageTypes = [...new Set([...(state.damageTypes || []), ...(imported.damageTypes || [])])];
            for (const mid in imported.inventory) if (!state.catalog[mid]) delete imported.inventory[mid];
            for (const [lid, l] of Object.entries(imported.libros || {})) {
              const ya = state.libros?.[lid];
              l.pruebas = ya ? ya.pruebas || {} : Object.fromEntries(Object.keys(l.pruebas || {}).map(k => [k, { cd: null }]));
            }
          }
          setState(imported);
          saveState();
                  resetForm();
          renderAll();
          renderCrafteo();
          lectura.render(); lectura.renderInventario(); objetos.render(); bolsa.render(); diario.pintarBarra();
          alert('Datos importados.');
        } catch (err) { alert('Error al importar: ' + err.message); }
      };
      reader.readAsText(this.files[0]);
    }
  });

  // ---- Global event delegation ----
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    switch (action) {
      case 'switch-tab':    switchTab(id); break;
      case 'elegir-oficio': elegirOficio(id); break;
      case 'salir':         if (confirm('¿Cerrar sesión en este navegador?')) auth.salir(); break;
      case 'cambiar-mesa':  auth.cambiarMesa(); break;
      case 'foto-perfil':   cuenta.dialogoFoto(alCambiarFoto); break;
      case 'pass-propia':   panel.cambiarMiContrasena(); break;
      case 'alq-subtab':    showAlqSubtab(id); break;
      case 'inv-subtab':    showInvSubtab(id); break;
      case 'craft-set-mode':
        if (craftSetMode(id) === false) break;
        // If switching away from elaboración, close cauldron
        if (id !== 'elaboracion' && caulActive) {
          caulActive = false;
          hideCauldron();
        }
        // Show/hide the toggle bar based on mode
        { const tb = document.getElementById('caulToggleBar');
          if (tb) tb.style.display = id === 'elaboracion' ? 'flex' : 'none'; }
        break;

      case 'add-mat':
        addMat(renderCrafteo); break;
      case 'add-effect': addEffect(); break;
      case 'remove-effect': removeEffect(id); break;
      case 'cancel-edit-mat':
        resetForm(); break;
      case 'edit-mat':
        if (soloDM('editar o identificar componentes del catálogo')) break;
        editMat(id);
        showAlqSubtab('alta');
        break;
      case 'mat-renovar': {   // V3.9: el material vuelve a ser nuevo (nadie lo conoce: sale del catálogo de los jugadores)
        if (soloDM('volver a poner materiales como nuevos')) break;
        const m = state.catalog[id];
        if (!m || !state.descubrimientos?.[id]) break;
        if (!confirm(`¿Volver a poner «${m.name}» como nuevo? Desaparecerá del catálogo de todos los jugadores hasta que se lo vuelvas a dar. Lo que ya lleven en el inventario no se toca.`)) break;
        delete state.descubrimientos[id];
        saveState(); renderCatMateriales();
        break;
      }
      case 'delete-mat':
        if (soloDM('borrar componentes del catálogo')) break;
        deleteMat(id, craftSelectedBase, craftSelectedMods, renderCrafteo);
        break;
      case 'cancel-delete':
        cancelDelete(); break;

      case 'toggle-mat-detail': {
        const dd = document.getElementById('matdetail_' + id);
        if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        break;
      }
      case 'inv-inc':
        state.inventory[id] = (state.inventory[id] || 0) + 1;
        saveState(); renderInvMateriales(); if (alqSub === 'materiales') renderCatMateriales();
        if (caulActive) renderCauldron(); else renderCrafteo();
        break;
      case 'inv-dec':
        if ((state.inventory[id] || 0) > 0) {
          state.inventory[id]--;
          saveState(); renderInvMateriales(); if (alqSub === 'materiales') renderCatMateriales();
          if (caulActive) renderCauldron(); else renderCrafteo();
        }
        break;

      case 'craft-pick-solvent':
        // Cambiar de disolvente vacía el caldero
        setCraftSelectedSolvent(craftSelectedSolvent === id ? null : id);
        setCraftSelectedBase(null);
        setCraftSelectedMods({});
        renderCrafteo(); break;
      case 'craft-pick-base':
        setCraftSelectedBase(craftSelectedBase === id ? null : id);
        setCraftSelectedMods({});
        renderCrafteo(); break;
      case 'craft-mod-inc': {
        const newMods = { ...craftSelectedMods };
        newMods[id] = (newMods[id] || 0) + 1;
        setCraftSelectedMods(newMods);
        renderCrafteo(); break;
      }
      case 'craft-mod-dec': {
        const newMods2 = { ...craftSelectedMods };
        if ((newMods2[id] || 0) > 0) {
          newMods2[id]--;
          if (!newMods2[id]) delete newMods2[id];
          setCraftSelectedMods(newMods2);
        }
        renderCrafteo(); break;
      }
      case 'craft-pick-pot': {
        const pickCount = craftPotionPicks.filter(x => x === id).length;
        const pickQty = state.potions[id]?.qty ?? 0;
        if (pickCount >= 2 || (pickCount >= 1 && pickQty < 2)) {
          setCraftPotionPicks(craftPotionPicks.filter(x => x !== id));
        } else if (craftPotionPicks.length >= 2 && pickCount === 0) {
          setCraftPotionPicks([craftPotionPicks[1], id]);
        } else {
          setCraftPotionPicks([...craftPotionPicks, id]);
        }
        renderCrafteo(); break;
      }
      case 'toggle-cauldron': toggleCauldron(); break;
      case 'abrir-diario': diario.abrir(); break;
      case 'nivel-propio': {
        const n = niveles.nivelActual() + (parseInt(id) || 0);
        if (niveles.fijarPropio(n)) {
          diario.pintarBarra(); panel.pintarTarjetas();
          if (caulActive) renderCauldron(); else renderCrafteo();
          if (parseInt(id) > 0) diario.alEntrarEnAlquimia();
        }
        break;
      }
      case 'ir-libros': {
        e.preventDefault();
        switchTab('lectura');
        const alta = document.getElementById('libroAlta');
        if (alta) { alta.open = true; setTimeout(() => alta.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }
        break;
      }

      case 'caul-elaborar': {
        const fresh = sync.refrescar({ silencioso: true });   // mientras gira el caldero
        brewCauldron(async () => {
        await fresh;
        syncCaulAplics();
        const caulBonusEl = document.getElementById('caulBonus');
        const craftBonusEl2 = document.getElementById('craftBonus');
        if (caulBonusEl && craftBonusEl2) craftBonusEl2.value = caulBonusEl.value;
        // Capture reactivo campo BEFORE craftConfirm() resets craftSelectedBase
        const prevCategory = state.catalog[craftSelectedBase]?.campo ?? null;
        const prevPolaridad = state.catalog[craftSelectedBase]?.polaridad ?? null;
        if (!craftConfirm()) { setCaulCraftState(null, null); renderCauldron(); return; }   // resets craftSelectedBase
        const craftResultEl   = document.getElementById('craftResult');
        const craftResultHTML = craftResultEl?.innerHTML || '';
        const isSuccess       = !!craftResultEl?.querySelector('.result-box.success');
        setCaulCraftState(isSuccess ? 'success' : 'fail', prevCategory, prevPolaridad);
        hideCauldronTextPanels();
        renderCauldron();   // renders in result state; triggers particles via setTimeout
        // Inject notification into the zone above the cauldron
        const notifArea = document.getElementById('caulNotifArea');
        if (notifArea && craftResultHTML) {
          notifArea.innerHTML = `<div class="caul-notif caul-notif-${isSuccess ? 'success' : 'fail'} ${isSuccess ? 'caul-anim-success' : 'caul-anim-fail'}">${craftResultHTML}</div>`;
        }
      }); break; }
      case 'caul-retry':
        setCaulCraftState(null, null);
        setCraftSelectedSolvent(null);
        setCraftSelectedBase(null);
        setCraftSelectedMods({});
        renderCauldron();   // liquid transitions blue via CSS, shows fresh base-picker
        break;
      case 'caul-reset':
        setCaulCraftState(null, null);
        setCraftSelectedSolvent(null);
        setCraftSelectedBase(null);
        setCraftSelectedMods({});
        renderCauldron();
        break;
      case 'caul-mod-remove': {
        const newMods3 = { ...craftSelectedMods };
        delete newMods3[id];
        setCraftSelectedMods(newMods3);
        renderCauldron();
        break;
      }

      case 'craft-confirm': freshThenCraft(); break;
      case 'craft-reset':
        setCraftSelectedSolvent(null);
        setCraftSelectedBase(null);
        setCraftSelectedMods({});
        setCraftPotionPicks([]);
        document.getElementById('craftResult').innerHTML = '';
        renderCrafteo(); break;

      case 'use-pot':  usePotion(id); break;
      case 'set-apodo': setApodo(id); break;
      case 'del-pot':  delPotion(id); break;
      case 'toggle-pot-detail': {
        const pdEl = document.getElementById('potdetail_' + id.replace(/[^a-z0-9]/gi, '_'));
        if (pdEl) pdEl.style.display = pdEl.style.display === 'none' ? 'block' : 'none';
        break;
      }

      case 'identify-loot': identifyLoot(id); renderLoot(); break;
      case 'use-loot': {
        const li = state.lootPotions[id];
        if (li) {
          alert(`Usando: ${li.name}\n${li.descripcion || 'Sin descripción'}`);
          li.qty--; if (li.qty <= 0) delete state.lootPotions[id];
          saveState(); renderLoot();
        }
        break;
      }
      case 'del-loot': deleteLoot(id); renderLoot(); break;

      case 'add-damage-type': {
        const nt = prompt('Nuevo tipo de daño:');
        if (nt?.trim()) {
          const t = nt.trim();
          if (!state.damageTypes.includes(t)) { state.damageTypes.push(t); saveState(); }
          populateDamageTypeSelect();
        }
        break;
      }
      case 'toggle-sound':
        setSoundEnabled(!SOUND_ENABLED);
        cuenta.pintar();
        break;
      case 'export-data': exportData(); break;
      case 'import-data': document.getElementById('importFile').click(); break;
      case 'reset-all':
        if (sync.modo === 'servidor' && !auth.esDM()) { alert('Solo el DM puede borrar los datos de la mesa.'); break; }
        if (confirm(sync.modo === 'servidor'
            ? '¿Borrar TODOS los datos DEL SERVIDOR? Se borra el catálogo de materiales y pociones para toda la mesa y tu propio inventario (el de los demás jugadores pierde los materiales borrados). No se puede deshacer (salvo con las copias de seguridad).'
            : '¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
          setState(getDefaultState());
          saveState(); resetForm(); renderAll(); renderCrafteo();
          lectura.render(); lectura.renderInventario(); objetos.render(); bolsa.render(); diario.pintarBarra();
        }
        break;
    }
  });

  // Loot textarea blur (save description)
  document.addEventListener('blur', e => {
    if (e.target?.getAttribute('data-action') === 'loot-desc') {
      const lid = e.target.getAttribute('data-id');
      if (state.lootPotions[lid]) {
        state.lootPotions[lid].descripcion = e.target.value;
        saveState();
      }
    }
  }, true);
});

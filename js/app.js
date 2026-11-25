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

// ---- Cauldron toggle state ----
let caulActive = false;

// ---- Expose functions needed by inline onclick in rendered HTML ----
window.togglePotCatEntry = togglePotCatEntry;
window.addDiceRow = addDiceRow;
window.removeDiceRow = removeDiceRow;

// ---- Navigation ----
function showInfoSubtab(id) {
  ['identificacion','catalogo','pociones','parametros'].forEach(s => {
    const el = document.getElementById('infoSub-' + s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.querySelectorAll('[data-action="info-subtab"]').forEach(b => {
    b.className = 'subtab-btn' + (b.getAttribute('data-id') === id ? ' active' : '');
  });
  if (id === 'catalogo') renderCatMateriales();
  if (id === 'pociones') renderCatPociones();
  if (id === 'parametros') renderSettings();
}

function showInvSubtab(id) {
  if (id === 'dm' && !auth.esDM()) id = 'materiales';
  ['materiales','pociones','loot','libros','dm'].forEach(s => {
    const el = document.getElementById('invSub-' + s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.querySelectorAll('[data-action="inv-subtab"]').forEach(b => {
    b.className = 'subtab-btn' + (b.getAttribute('data-id') === id ? ' active' : '');
  });
  if (id === 'pociones') renderInvPociones();
  if (id === 'loot') renderLoot();
  if (id === 'libros') lectura.renderInventario();
  if (id === 'dm') { dm.render(); dm.recargar(); }
}

// ---- Módulos de la mesa ----
// Cada módulo es una pestaña (y quizá una tarjeta de la mesa). Ver modulos.js
// y docs/ARQUITECTURA.md para añadir uno nuevo (cocina, ficha, armas...).
modulos.registrar({ id: 'panel', icono: '🏰', titulo: 'Mesa', lugar: 'panel', lugarTxt: 'en la mesa principal',
  alMostrar() { panel.pintarSaludo(); panel.animarEntrada(); } });
modulos.registrar({ id: 'inventario', icono: '🎒', titulo: 'Inventario', lugar: 'inventario', lugarTxt: 'revisando su inventario',
  tarjeta: { orden: 0, clase: 'tarjeta-inventario', texto: 'Tus materiales, pociones, botín y libros' },
  resumen: () => panel.resumenInventario(),
  alMostrar() {
    renderInvMateriales(); renderInvPociones(); lectura.renderInventario();
    if (document.getElementById('invSub-dm')?.style.display !== 'none') { dm.render(); dm.recargar(); }
  } });
modulos.registrar({ id: 'crafteo', icono: '⚗️', titulo: 'Alquimia', lugar: 'alquimia', lugarTxt: 'junto al caldero',
  tarjeta: { orden: 1, clase: 'tarjeta-alquimia', texto: 'Enciende el caldero y elabora' },
  resumen: () => panel.resumenAlquimia(),
  alMostrar() { if (caulActive) renderCauldron(); else renderCrafteo(); diario.alEntrarEnAlquimia(); } });
modulos.registrar({ id: 'lectura', icono: '📖', titulo: 'Lectura', lugar: 'lectura', lugarTxt: 'leyendo un libro',
  tarjeta: { orden: 2, clase: 'tarjeta-lectura', texto: 'Tus libros y lo que llevas leído' },
  resumen: () => lectura.resumen(),
  alMostrar() { lectura.render(); } });
modulos.registrar({ id: 'info', icono: '📜', titulo: 'Compendio', lugar: 'compendio', lugarTxt: 'consultando el compendio',
  alMostrar() {} });
modulos.registrar({ id: 'usuarios', icono: '🟢', titulo: 'En línea', lugar: 'usuarios', lugarTxt: 'mirando quién anda por aquí',
  contador: 'navOnlineCount',
  tarjeta: { orden: 3, clase: 'tarjeta-usuarios', icono: '🔮', titulo: 'Usuarios en línea', texto: 'Quién está en la mesa ahora' },
  resumen: () => panel.resumenUsuarios(),
  alMostrar() { panel.renderUsuarios(); } });

function switchTab(id) {
  if (!modulos.porId(id)) id = 'panel';
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

// El DM pulsa "Ver inventario" en la lista de usuarios
function verInventarioDe(clave) {
  switchTab('inventario');
  showInvSubtab('dm');
  dm.elegir(clave);
}

// Cosas que solo ve el DM (o que cambian si el DM da o quita poderes)
function aplicarRol() {
  panel.pintarCabecera();
  panel.pintarSaludo();
  diario.pintarBarra();
  lectura.render(); lectura.renderInventario();
  if (!auth.esDM() && document.getElementById('invSub-dm')?.style.display !== 'none') showInvSubtab('materiales');
  if (document.getElementById('tab-usuarios')?.classList.contains('active')) panel.renderUsuarios();
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

// ---- Character ----
function syncCharacter() {
  state.character.name   = document.getElementById('charName').value;
  state.character.intMod = parseInt(document.getElementById('charInt').value) || 0;
  state.character.bonus  = parseInt(document.getElementById('charBonus').value) || 0;
  saveState();
  if (vistaActual() === 'lectura') lectura.render();   // la tirada de comprensión usa el mod. INT
}

function loadCharacterUI() {
  document.getElementById('charName').value  = state.character.name || '';
  document.getElementById('charInt').value   = state.character.intMod || 0;
  document.getElementById('charBonus').value = state.character.bonus || 0;
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
  usuario() {
    aplicarRol();
    sync.aviso(auth.esDM() ? '👑 Ahora eres DM de la mesa.' : 'Ya no eres DM de la mesa.');
  },
  remoto(datos, cambios) {
    const nivelAntes = niveles.nivelActual();
    applyServerData(datos);
    rerenderAfterServer();
    panel.pintarTarjetas();
    lectura.renderInventario();
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
  panel.pintarCabecera();
  await loadState();
  loadCharacterUI();
  updateMatForm();
  renderAll();
  renderCrafteo();
  dm.init();
  lectura.init();
  panel.initUsuarios(verInventarioDe);
  modulos.construirPestanas(document.getElementById('barraModulos'));
  modulos.construirTarjetas(document.getElementById('mesaTarjetas'));
  diario.pintarBarra();
  switchTab('panel');            // las tarjetas aparecen una a una

  // Character fields
  ['charName','charInt','charBonus'].forEach(id => {
    document.getElementById(id).addEventListener('change', syncCharacter);
  });

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
            imported.damageTypes = [...new Set([...(state.damageTypes || []), ...(imported.damageTypes || [])])];
            for (const mid in imported.inventory) if (!state.catalog[mid]) delete imported.inventory[mid];
            for (const [lid, l] of Object.entries(imported.libros || {})) {
              const ya = state.libros?.[lid];
              l.pruebas = ya ? ya.pruebas || {} : Object.fromEntries(Object.keys(l.pruebas || {}).map(k => [k, { cd: null }]));
            }
          }
          setState(imported);
          saveState();
          loadCharacterUI();
          resetForm();
          renderAll();
          renderCrafteo();
          lectura.render(); lectura.renderInventario(); diario.pintarBarra();
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
      case 'salir':         if (confirm('¿Cerrar sesión en este navegador?')) auth.salir(); break;
      case 'info-subtab':   showInfoSubtab(id); break;
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
        showInfoSubtab('identificacion');
        break;
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
        saveState(); renderInvMateriales();
        if (caulActive) renderCauldron(); else renderCrafteo();
        break;
      case 'inv-dec':
        if ((state.inventory[id] || 0) > 0) {
          state.inventory[id]--;
          saveState(); renderInvMateriales();
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
      case 'ir-libros': e.preventDefault(); switchTab('inventario'); showInvSubtab('libros'); break;

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

      case 'add-loot': addLoot(); renderLoot(); break;
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
        document.getElementById('muteBtn').textContent = SOUND_ENABLED ? '🔊' : '🔇';
        break;
      case 'export-data': exportData(); break;
      case 'import-data': document.getElementById('importFile').click(); break;
      case 'reset-all':
        if (sync.modo === 'servidor' && !auth.esDM()) { alert('Solo el DM puede borrar los datos de la mesa.'); break; }
        if (confirm(sync.modo === 'servidor'
            ? '¿Borrar TODOS los datos DEL SERVIDOR? Se borra el catálogo de materiales y pociones para toda la mesa y tu propio inventario (el de los demás jugadores pierde los materiales borrados). No se puede deshacer (salvo con las copias de seguridad).'
            : '¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
          setState(getDefaultState());
          saveState(); loadCharacterUI(); resetForm(); renderAll(); renderCrafteo();
          lectura.render(); lectura.renderInventario(); diario.pintarBarra();
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

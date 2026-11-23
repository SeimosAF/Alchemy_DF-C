// app.js — init, navigation, event delegation
import { state, loadState, saveState, setState, getDefaultState, normalizeState } from './state.js';
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
  craftSelectedBase, craftSelectedMods, craftPotionPicks,
  setCraftSelectedBase, setCraftSelectedMods, setCraftPotionPicks,
} from './crafting.js';
import { renderCauldron, syncCaulAplics, setCaulCraftState } from './cauldron.js';

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
  ['materiales','pociones','loot'].forEach(s => {
    const el = document.getElementById('invSub-' + s);
    if (el) el.style.display = s === id ? 'block' : 'none';
  });
  document.querySelectorAll('[data-action="inv-subtab"]').forEach(b => {
    b.className = 'subtab-btn' + (b.getAttribute('data-id') === id ? ' active' : '');
  });
  if (id === 'pociones') renderInvPociones();
  if (id === 'loot') renderLoot();
}

function switchTab(id) {
  ['info','inventario','crafteo'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.className = 'tab-content' + (t === id ? ' active' : '');
  });
  document.querySelectorAll('[data-action="switch-tab"]').forEach(b => {
    b.className = b.getAttribute('data-id') === id ? 'active' : '';
  });
  if (id === 'inventario') { renderInvMateriales(); renderInvPociones(); }
  if (id === 'crafteo') renderCrafteo();
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

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  loadCharacterUI();
  updateMatForm();
  renderAll();
  renderCrafteo();

  // Character fields
  ['charName','charInt','charBonus'].forEach(id => {
    document.getElementById(id).addEventListener('change', syncCharacter);
  });

  // Form triggers
  ['matCampo','matPolaridad','matUnknown','matType','matModKind'].forEach(id =>
    document.getElementById(id).addEventListener('change', updateMatForm));
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
<<<<<<< Updated upstream
=======
  document.getElementById('matDurationMode').addEventListener('change', function () {
    document.getElementById('durationModValueRow').style.display = this.value === 'none' ? 'none' : 'block';
  });
  document.getElementById('matPenaltyType').addEventListener('change', function () {
    document.getElementById('penaltyValueRow').style.display = this.value === 'disadvantage' ? 'none' : 'block';
  });
>>>>>>> Stashed changes

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
          setState(imported);
          saveState();
          loadCharacterUI();
          resetForm();
          renderAll();
          renderCrafteo();
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
      case 'info-subtab':   showInfoSubtab(id); break;
      case 'inv-subtab':    showInvSubtab(id); break;
      case 'craft-set-mode':
        craftSetMode(id);
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
        editMat(id);
        showInfoSubtab('identificacion');
        break;
      case 'delete-mat':
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

      case 'caul-elaborar': {
        syncCaulAplics();
        const caulBonusEl = document.getElementById('caulBonus');
        const craftBonusEl2 = document.getElementById('craftBonus');
        if (caulBonusEl && craftBonusEl2) craftBonusEl2.value = caulBonusEl.value;
        // Capture reactivo campo BEFORE craftConfirm() resets craftSelectedBase
        const prevCategory = state.catalog[craftSelectedBase]?.campo ?? null;
        craftConfirm();   // resets craftSelectedBase; may call renderCrafteo()
        const craftResultEl   = document.getElementById('craftResult');
        const craftResultHTML = craftResultEl?.innerHTML || '';
        const isSuccess       = !!craftResultEl?.querySelector('.result-box.success');
        setCaulCraftState(isSuccess ? 'success' : 'fail', prevCategory);
        hideCauldronTextPanels();
        renderCauldron();   // renders in result state; triggers particles via setTimeout
        // Inject notification into the zone above the cauldron
        const notifArea = document.getElementById('caulNotifArea');
        if (notifArea && craftResultHTML) {
          notifArea.innerHTML = `<div class="caul-notif caul-notif-${isSuccess ? 'success' : 'fail'} ${isSuccess ? 'caul-anim-success' : 'caul-anim-fail'}">${craftResultHTML}</div>`;
        }
        break;
      }
      case 'caul-retry':
        setCaulCraftState(null, null);
        setCraftSelectedBase(null);
        setCraftSelectedMods({});
        renderCauldron();   // liquid transitions blue via CSS, shows fresh base-picker
        break;
      case 'caul-reset':
        setCaulCraftState(null, null);
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

      case 'craft-confirm': craftConfirm(); break;
      case 'craft-reset':
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
        if (confirm('¿Borrar TODOS los datos? Esta acción no se puede deshacer.')) {
          setState(getDefaultState());
          saveState(); loadCharacterUI(); resetForm(); renderAll(); renderCrafteo();
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

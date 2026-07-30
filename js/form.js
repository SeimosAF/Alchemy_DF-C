// form.js — material identification form management
import { state, saveState, genId } from './state.js';
import { SUBTIPOS } from './data.js';
import { renderCatMateriales, renderInvMateriales } from './render.js';

// Form state
export let editingMatId = null;
export let deletePendingId = null;
let diceRowCounter = 0;

// ---- Dice rows ----
export function addDiceRow(which) {
  const cid = which === 'pool' ? 'dicePoolRows' : 'durationDiceRows';
  const container = document.getElementById(cid);
  const rowId = `dr_${which}_${diceRowCounter++}`;
  const div = document.createElement('div');
  div.className = 'dice-row';
  div.id = rowId;
  div.innerHTML = `<input type="number" min="1" max="20" value="1" style="width:50px"> × d`
    + `<select><option>4</option><option selected>6</option><option>8</option><option>10</option><option>12</option><option>20</option></select>`
    + ` <button type="button" class="btn btn-sm btn-danger" onclick="window.removeDiceRow('${rowId}')">✕</button>`;
  container.appendChild(div);
  updateNoPurificable();
}

export function removeDiceRow(rowId) {
  const el = document.getElementById(rowId);
  if (el) el.parentNode.removeChild(el);
  updateNoPurificable();
}

function getDiceRows(which) {
  const cid = which === 'pool' ? 'dicePoolRows' : 'durationDiceRows';
  const container = document.getElementById(cid);
  if (!container) return [];
  const rows = [];
  for (const div of container.getElementsByClassName('dice-row')) {
    const inp = div.getElementsByTagName('input');
    const sel = div.getElementsByTagName('select');
    if (inp.length && sel.length)
      rows.push({ count: parseInt(inp[0].value) || 1, sides: parseInt(sel[0].value) || 6 });
  }
  return rows;
}

function clearDiceRows(which) {
  const el = document.getElementById(which === 'pool' ? 'dicePoolRows' : 'durationDiceRows');
  if (el) el.innerHTML = '';
}

function populateDiceRows(which, rows) {
  clearDiceRows(which);
  if (!rows?.length) return;
  rows.forEach(row => {
    addDiceRow(which);
    const cid = which === 'pool' ? 'dicePoolRows' : 'durationDiceRows';
    const container = document.getElementById(cid);
    const divs = container.getElementsByClassName('dice-row');
    const last = divs[divs.length - 1];
    const inp = last.getElementsByTagName('input');
    const sel = last.getElementsByTagName('select');
    if (inp[0]) inp[0].value = row.count || 1;
    if (sel[0]) sel[0].value = row.sides || 6;
  });
}

export function updateNoPurificable() {
  if (document.getElementById('matType').value !== 'Base') return;
  const hasDice = getDiceRows('pool').length > 0 || getDiceRows('duration').length > 0;
  const cb = document.getElementById('matNoPurificable');
  if (!hasDice) { cb.checked = true; cb.disabled = true; }
  else { cb.disabled = false; }
}

// ---- Damage type select ----
export function populateDamageTypeSelect() {
  const sel = document.getElementById('matDamageType');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Elige o añade --</option>';
  (state.damageTypes || []).forEach(t => {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

function getSubtipos(cat, type) {
  if (type === 'Modificador') return SUBTIPOS['_Modificador'];
  return SUBTIPOS[`${cat}_${type}`] || [];
}

// ---- Main form update ----
export function updateMatForm() {
  const isUnknown = document.getElementById('matUnknown').checked;
  const knownFields = document.getElementById('matKnownFields');
  if (knownFields) knownFields.style.display = isUnknown ? 'none' : 'block';
  if (isUnknown) return;

  const cat = document.getElementById('matCategory').value;
  const type = document.getElementById('matType').value;
  const subSel = document.getElementById('matSubtipo');
  const subs = getSubtipos(cat, type);
  const curSub = subSel.value;
  subSel.innerHTML = '';
  if (!subs.length) {
    subSel.innerHTML = '<option value="">(ninguno)</option>';
    subSel.disabled = true;
  } else {
    subSel.disabled = false;
    subs.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; subSel.appendChild(o); });
    if (subs.includes(curSub)) subSel.value = curSub;
  }
  const sub = subSel.value;
  const isBase = type === 'Base', isMod = type === 'Modificador';

  document.getElementById('baseFlagsSection').style.display = isBase ? 'flex' : 'none';
  const showPool = (isBase && (sub === 'Vitalidad' || sub === 'Dañina')) || sub === 'Potenciador';
  document.getElementById('dicePoolSection').style.display = showPool ? 'block' : 'none';
  if (showPool) {
    document.getElementById('dicePoolLabel').textContent =
      sub === 'Potenciador' ? 'Dados de bonificación' : sub === 'Dañina' ? 'Dados de daño' : 'Dados de curación';
  }
  document.getElementById('statModSection').style.display = showPool ? 'block' : 'none';

  const showDmg = isBase && (sub === 'Resistencia' || sub === 'Debilitante');
  document.getElementById('damageTypeSection').style.display = showDmg ? 'block' : 'none';
  if (showDmg) {
    document.getElementById('damageTypeLabel').textContent =
      sub === 'Resistencia' ? 'Resistencia a tipo de daño' : 'Tipo de daño que inflige';
    populateDamageTypeSelect();
  }

  const showIncap = isBase && sub === 'Incapacitante';
  document.getElementById('incapacitanteSection').style.display = showIncap ? 'block' : 'none';
  if (showIncap) {
    const pt = document.getElementById('matPenaltyType').value;
    document.getElementById('penaltyValueRow').style.display = pt === 'disadvantage' ? 'none' : 'block';
  }

  const showDur = isBase || sub === 'Prolongador';
  document.getElementById('durationSection').style.display = showDur ? 'block' : 'none';
  if (showDur) {
    const inst = document.getElementById('matDurationInstant').checked;
    document.getElementById('durationDiceSection').style.display = inst ? 'none' : 'block';
  }

  document.getElementById('maxUsesSection').style.display = isMod ? 'block' : 'none';
  document.getElementById('diffHint').textContent =
    sub === 'Economizador' ? '(debe ser negativo)' : '(modificador a la CD)';

  if (isBase) updateNoPurificable();
}

// ---- Read form ----
function readFormData() {
  const cat = document.getElementById('matCategory').value;
  const type = document.getElementById('matType').value;
  const sub = document.getElementById('matSubtipo').value;
  const data = {
    name: document.getElementById('matName').value.trim(),
    lugar: document.getElementById('matLugar').value.trim(),
    category: cat, type, subtipo: sub,
    rarity: document.getElementById('matRarity').value,
    difficulty: parseInt(document.getElementById('matDifficulty').value) || 0,
    description: document.getElementById('matDesc').value.trim(),
    unknown: document.getElementById('matUnknown').checked,
    discriminante: false, noPurificable: false,
    dicePool: [], flatBonus: 0, statMod: '',
    damageType: '', penaltyType: '', penaltyValue: 0,
    durationInstant: false, durationDice: [], durationFlat: 0, maxUses: 0,
  };
  if (type === 'Base') {
    data.discriminante = document.getElementById('matDiscriminante').checked;
    data.noPurificable = document.getElementById('matNoPurificable').checked;
  }
  const showPool = (type === 'Base' && (sub === 'Vitalidad' || sub === 'Dañina')) || sub === 'Potenciador';
  if (showPool) {
    data.dicePool = getDiceRows('pool');
    data.flatBonus = parseInt(document.getElementById('matFlatBonus').value) || 0;
    data.statMod = document.getElementById('matStatMod').value.trim();
  }
  if (type === 'Base' && (sub === 'Resistencia' || sub === 'Debilitante'))
    data.damageType = document.getElementById('matDamageType').value;
  if (type === 'Base' && sub === 'Incapacitante') {
    data.penaltyType = document.getElementById('matPenaltyType').value;
    data.penaltyValue = parseInt(document.getElementById('matPenaltyValue').value) || 1;
  }
  if (type === 'Base' || sub === 'Prolongador') {
    data.durationInstant = document.getElementById('matDurationInstant').checked;
    if (!data.durationInstant) {
      data.durationDice = getDiceRows('duration');
      data.durationFlat = parseInt(document.getElementById('matDurationFlat').value) || 0;
    }
  }
  if (type === 'Modificador') data.maxUses = parseInt(document.getElementById('matMaxUses').value) || 0;
  return data;
}

// ---- Reset form ----
export function resetForm() {
  ['matName','matLugar','matDesc','matStatMod'].forEach(id => { document.getElementById(id).value = ''; });
  ['matDifficulty','matFlatBonus','matDurationFlat','matMaxUses'].forEach(id => { document.getElementById(id).value = '0'; });
  document.getElementById('matPenaltyValue').value = '1';
  document.getElementById('matCategory').value = 'Salutífera';
  document.getElementById('matType').value = 'Base';
  document.getElementById('matRarity').value = 'Común';
  ['matUnknown','matDiscriminante','matNoPurificable','matDurationInstant'].forEach(id => { document.getElementById(id).checked = false; });
  clearDiceRows('pool'); clearDiceRows('duration');
  editingMatId = null;
  document.getElementById('matFormTitle').textContent = '➕ Identificar material';
  document.getElementById('matSubmitBtn').textContent = '➕ Añadir material';
  document.getElementById('matCancelEditBtn').style.display = 'none';
  updateMatForm();
}

// ---- CRUD ----
// renderCrafteo is passed as a callback to avoid circular imports (crafting.js → form.js)
export function addMat(renderCrafteo) {
  const data = readFormData();
  if (!data.name) { alert('El material necesita un nombre.'); return; }
  if (editingMatId) {
    const m = state.catalog[editingMatId];
    for (const k in data) m[k] = data[k];
  } else {
    const id = genId();
    state.catalog[id] = data;
    if (!(id in state.inventory)) state.inventory[id] = 0;
  }
  saveState(); resetForm(); renderCatMateriales(); renderInvMateriales(); renderCrafteo();
}

export function editMat(id) {
  const m = state.catalog[id]; if (!m) return;
  editingMatId = id;
  document.getElementById('matName').value = m.name || '';
  document.getElementById('matLugar').value = m.lugar || '';
  document.getElementById('matCategory').value = m.category || 'Salutífera';
  document.getElementById('matType').value = m.type || 'Base';
  document.getElementById('matRarity').value = m.rarity || 'Común';
  document.getElementById('matDifficulty').value = m.difficulty || 0;
  document.getElementById('matDesc').value = m.description || '';
  document.getElementById('matUnknown').checked = !!m.unknown;
  updateMatForm();
  document.getElementById('matSubtipo').value = m.subtipo || '';
  updateMatForm(); // second pass to update conditional sections
  if (m.type === 'Base') {
    document.getElementById('matDiscriminante').checked = !!m.discriminante;
    document.getElementById('matNoPurificable').checked = !!m.noPurificable;
  }
  document.getElementById('matFlatBonus').value = m.flatBonus || 0;
  document.getElementById('matStatMod').value = m.statMod || '';
  document.getElementById('matDurationInstant').checked = !!m.durationInstant;
  document.getElementById('matDurationFlat').value = m.durationFlat || 0;
  document.getElementById('matMaxUses').value = m.maxUses || 0;
  document.getElementById('matPenaltyValue').value = m.penaltyValue || 1;
  if (m.penaltyType) document.getElementById('matPenaltyType').value = m.penaltyType;
  populateDiceRows('pool', m.dicePool);
  populateDiceRows('duration', m.durationDice);
  if (m.damageType) { populateDamageTypeSelect(); document.getElementById('matDamageType').value = m.damageType; }
  if (m.durationInstant) document.getElementById('durationDiceSection').style.display = 'none';
  document.getElementById('matFormTitle').textContent = '✏️ Editar material';
  document.getElementById('matSubmitBtn').textContent = '💾 Guardar cambios';
  document.getElementById('matCancelEditBtn').style.display = 'inline-block';
  // Caller (app.js) is responsible for switching to the identificación subtab
}

export function deleteMat(id, craftSelectedBase, craftSelectedMods, renderCrafteo) {
  if (deletePendingId === id) {
    delete state.catalog[id]; delete state.inventory[id];
    if (craftSelectedBase === id) craftSelectedBase = null;
    delete craftSelectedMods[id];
    deletePendingId = null; saveState();
    renderCatMateriales(); renderInvMateriales(); renderCrafteo();
  } else {
    deletePendingId = id; renderCatMateriales(id);
  }
}

export function cancelDelete() {
  deletePendingId = null; renderCatMateriales();
}

// ---- LOOT CRUD ----
export function addLoot() {
  const name = document.getElementById('lootName').value.trim();
  const qty = parseInt(document.getElementById('lootQty').value) || 1;
  if (!name) { alert('La poción loot necesita un nombre.'); return; }
  const id = genId();
  state.lootPotions[id] = { name, qty, descripcion: '', tipo: '', identificada: false };
  document.getElementById('lootName').value = '';
  document.getElementById('lootQty').value = '1';
  saveState();
}

export function deleteLoot(id) {
  if (!confirm('¿Eliminar esta poción loot?')) return;
  delete state.lootPotions[id];
  saveState();
}

export function identifyLoot(id) {
  const loot = state.lootPotions[id]; if (!loot) return;
  if (loot.qty < 1) { alert('No quedan unidades.'); return; }
  const bases = [];
  for (const bid in state.catalog) if (state.catalog[bid].type === 'Base') bases.push({ id: bid, m: state.catalog[bid] });
  if (!bases.length) { alert('No tienes bases identificadas para comparar.'); return; }
  const opts = bases.map((b, i) => `${i + 1}. ${b.m.unknown ? '???' : b.m.name} (${b.m.category})`);
  const choice = prompt('Ingeniería inversa: consume 1 unidad.\n\n' + opts.join('\n') + '\n\nNúmero:');
  if (choice == null) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= bases.length) { alert('Opción no válida.'); return; }
  const base = bases[idx];
  loot.tipo = (base.m.unknown ? '???' : base.m.name) + ' (' + base.m.category + ')';
  loot.identificada = true;
  loot.qty--;
  if (loot.qty <= 0) delete state.lootPotions[id];
  saveState();
  document.getElementById('lootResult').innerHTML =
    `<div class="result-box success"><p>✅ Identificada como: <strong>${loot.tipo}</strong> (consumida 1 unidad)</p></div>`;
}

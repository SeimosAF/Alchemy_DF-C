// form.js — material identification form management
import { state, saveState, genId } from './state.js';
import {
  CAMPOS, ALL_STATS, ROLL_KINDS, EFFECT_KINDS, MOD_KINDS, MOD_KIND_ICONS, effectKindsFor,
} from './data.js';
import { parseDice, formatDice, getDisolvente, hasMaleficio } from './model.js';
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
  if (document.getElementById('matType').value !== 'Reactivo') return;
  const hasDice = formEffects.some(e => e.dice?.length) || getDiceRows('duration').length > 0;
  const cb = document.getElementById('matNoPurificable');
  if (!hasDice) { cb.checked = true; cb.disabled = true; }
  else if (cb.disabled) { cb.disabled = false; cb.checked = false; }
}

// ---- Effect blocks editor ----
let formEffects = [];

function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function optionList(values, cur, emptyLabel) {
  const opts = emptyLabel != null ? [`<option value="">${emptyLabel}</option>`] : [];
  values.forEach(v => opts.push(`<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`));
  if (cur && !values.includes(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
  return opts.join('');
}

function fieldHtml(e, f, idx, campo) {
  const c = CAMPOS[campo] || CAMPOS['Mágico'];
  const d = `data-eidx="${idx}" data-field="${f}"`;
  switch (f) {
    case 'dice':       return `<label>Dados <input type="text" ${d} value="${esc(formatDice(e.dice))}" placeholder="2d6+1d4" style="width:100px"></label>`;
    case 'flat':       return `<label>Bono <input type="number" ${d} value="${e.flat || 0}" style="width:60px"></label>`;
    case 'statMod':    return `<label>+ mod. <select ${d}>${optionList(ALL_STATS, e.statMod, '—')}</select></label>`;
    case 'damageType': return `<label>Tipo <select ${d}>${optionList(state.damageTypes || [], e.damageType, '— tipo de daño —')}</select></label>`;
    case 'stat':       return `<label>Característica <select ${d}>${optionList(c.stats, e.stat, 'Cualquiera')}</select></label>`;
    case 'rollKind':   return `<label>Tiradas <select ${d}>${optionList(ROLL_KINDS, e.rollKind || ROLL_KINDS[0])}</select></label>`;
    case 'value':      return `<label>Valor <input type="number" ${d} value="${e.value || 1}" min="0" style="width:60px"></label>`;
    case 'condition':  return `<label>Estado <select ${d}>${optionList(c.conditions, e.condition, '— estado —')}</select></label>`;
    case 'text':       return `<label class="effect-text">Descripción <input type="text" ${d} value="${esc(e.text)}" placeholder="Brilla en la oscuridad..."></label>`;
    case 'spellName':  return `<label>Hechizo <input type="text" ${d} value="${esc(e.spellName)}" placeholder="Bola de fuego" style="width:140px"></label>`;
    case 'spellLevel': return `<label>Nivel <input type="number" ${d} value="${e.spellLevel || 1}" min="0" max="9" style="width:55px"></label>`;
  }
  return '';
}

function currentCampoPol() {
  return {
    campo: document.getElementById('matCampo').value,
    polaridad: document.getElementById('matPolaridad').value,
  };
}

export function renderEffectsEditor() {
  const { campo, polaridad } = currentCampoPol();
  const rowsEl = document.getElementById('effectRows');
  const sel = document.getElementById('effectKindSelect');
  if (!rowsEl || !sel) return;
  const kinds = effectKindsFor(campo, polaridad);
  const prev = sel.value;
  sel.innerHTML = kinds.map(k => `<option value="${k.id}">${k.icon} ${k.label}</option>`).join('');
  if (kinds.some(k => k.id === prev)) sel.value = prev;

  if (!formEffects.length) {
    rowsEl.innerHTML = '<p class="muted" style="margin:4px 0 8px">Sin efectos todavía. Elige uno abajo y pulsa «Añadir efecto».</p>';
  } else {
    rowsEl.innerHTML = formEffects.map((e, idx) => {
      const k = EFFECT_KINDS[e.kind] || { label: e.kind, icon: '•', fields: [] };
      const fits = kinds.some(x => x.id === e.kind);
      return `<div class="effect-row${fits ? '' : ' effect-row-warn'}">
        <div class="effect-row-head">
          <strong>${k.icon} ${k.label}</strong>
          ${fits ? '' : '<span class="muted" title="No encaja con el campo o la polaridad elegidos">⚠️ no encaja</span>'}
          <button type="button" class="btn btn-sm btn-danger" data-action="remove-effect" data-id="${idx}">✕</button>
        </div>
        <div class="effect-row-fields">${k.fields.map(f => fieldHtml(e, f, idx, campo)).join('')}</div>
      </div>`;
    }).join('');
  }
  updateSaveSection();
}

export function addEffect() {
  const kind = document.getElementById('effectKindSelect').value;
  if (!kind) return;
  const e = { kind };
  if (EFFECT_KINDS[kind].fields.includes('rollKind')) e.rollKind = ROLL_KINDS[0];
  if (EFFECT_KINDS[kind].fields.includes('value')) e.value = 1;
  if (kind === 'hechizo') e.spellLevel = 1;
  formEffects.push(e);
  renderEffectsEditor();
  updateNoPurificable();
}

export function removeEffect(idx) {
  formEffects.splice(parseInt(idx), 1);
  renderEffectsEditor();
  updateNoPurificable();
}

export function onEffectFieldChange(el) {
  const idx = parseInt(el.dataset.eidx), f = el.dataset.field;
  const e = formEffects[idx]; if (!e) return;
  if (f === 'dice') e.dice = parseDice(el.value);
  else if (['flat', 'value', 'spellLevel'].includes(f)) e[f] = parseInt(el.value) || 0;
  else e[f] = el.value;
  if (f === 'dice') updateNoPurificable();
}

function updateSaveSection() {
  const type = document.getElementById('matType').value;
  const show = type === 'Reactivo' && hasMaleficio(formEffects);
  const sec = document.getElementById('saveSection');
  sec.style.display = show ? 'grid' : 'none';
  const { campo } = currentCampoPol();
  const statSel = document.getElementById('matSaveStat');
  const cur = statSel.value;
  const stats = (CAMPOS[campo] || CAMPOS['Mágico']).stats;
  statSel.innerHTML = optionList(stats, stats.includes(cur) ? cur : stats[0]);
}

// ---- Damage type list (used by effect rows) ----
export function populateDamageTypeSelect() {
<<<<<<< Updated upstream
  renderEffectsEditor();
=======
  [
    { id: 'matDamageType',       empty: '-- Elige o añade --' },
    { id: 'matChangeDamageType', empty: '-- No cambia --' },
  ].forEach(({ id, empty }) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${empty}</option>`;
    (state.damageTypes || []).forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });
}

function getSubtipos(cat, type) {
  if (type === 'Modificador') return SUBTIPOS[`${cat}_${type}`] || SUBTIPOS['_Modificador'];
  return SUBTIPOS[`${cat}_${type}`] || [];
>>>>>>> Stashed changes
}

// ---- Main form update ----
export function updateMatForm() {
  const isUnknown = document.getElementById('matUnknown').checked;
  const knownFields = document.getElementById('matKnownFields');
  if (knownFields) knownFields.style.display = isUnknown ? 'none' : 'block';
  if (isUnknown) return;

  const type = document.getElementById('matType').value;
  const { campo, polaridad } = currentCampoPol();
  const isBase = type === 'Reactivo', isMod = type === 'Modificador';

  // Mod kind select
  const mkSel = document.getElementById('matModKind');
  if (!mkSel.options.length) mkSel.innerHTML = Object.keys(MOD_KINDS).map(k => `<option value="${k}">${MOD_KIND_ICONS[k]} ${k}</option>`).join('');
  document.getElementById('modKindWrap').style.visibility = isMod ? 'visible' : 'hidden';
  const modKind = isMod ? mkSel.value : '';
  const mkHint = document.getElementById('modKindHint');
  mkHint.style.display = isMod ? 'block' : 'none';
  mkHint.textContent = isMod ? MOD_KINDS[modKind] || '' : '';

  // Campo hint: disolvente + características
  const solv = getDisolvente(state.settings, campo);
  const c = CAMPOS[campo];
  let hint = `Disolvente: <strong>${solv.name}</strong> (${solv.difficulty >= 0 ? '+' : ''}${solv.difficulty} CD) · Características: ${c.stats.length === 6 ? 'todas' : c.stats.join(' y ')}`;
  if (campo === 'Mágico') hint += ' · Las pociones mágicas no admiten modificadores, concentración ni multipoción.';
  if (isMod) hint = `Se puede usar con reactivos de campo ${campo}${campo === 'Mágico' ? '' : ' (o desde cualquier campo si el modificador es Mágico)'}. ${polaridad === 'Maleficioso' ? 'Con un reactivo beneficioso' : 'Con un reactivo maleficioso'} suma +${state.settings?.polaridadOpuestaDiff ?? 2} a la CD.`;
  document.getElementById('campoHint').innerHTML = hint;

  document.getElementById('baseFlagsSection').style.display = isBase ? 'flex' : 'none';

  const showEffects = isBase || modKind === 'Añadir efecto';
  document.getElementById('effectsSection').style.display = showEffects ? 'block' : 'none';
  document.getElementById('effectsLabel').textContent = isBase ? 'Efectos del reactivo' : 'Efectos que añade el modificador';
  if (showEffects) renderEffectsEditor();
  else document.getElementById('saveSection').style.display = 'none';

  const showPool = modKind === 'Potenciador';
  document.getElementById('dicePoolSection').style.display = showPool ? 'block' : 'none';
  document.getElementById('statModSection').style.display = showPool ? 'block' : 'none';

  const showTrade = modKind === 'Concentrador' || modKind === 'Diluyente';
  document.getElementById('tradeSection').style.display = showTrade ? 'block' : 'none';
  if (showTrade) {
    const conc = modKind === 'Concentrador';
    document.getElementById('tradeFactorLabel').textContent = conc ? 'Divide la duración entre' : 'Multiplica la duración por';
    document.getElementById('tradeDiceLabel').textContent = conc ? 'Dados que suma al efecto principal' : 'Dados que resta al efecto principal (mín. 1)';
  }

<<<<<<< Updated upstream
  const showDur = isBase || modKind === 'Prolongador';
=======
  const showIncap = isBase && sub === 'Incapacitante';
  document.getElementById('incapacitanteSection').style.display = showIncap ? 'block' : 'none';
  if (showIncap) {
    const pt = document.getElementById('matPenaltyType').value;
    document.getElementById('penaltyValueRow').style.display = pt === 'disadvantage' ? 'none' : 'block';
  }

  const showDur = isBase || sub === 'Prolongador' || sub === 'Esencial';
>>>>>>> Stashed changes
  document.getElementById('durationSection').style.display = showDur ? 'block' : 'none';
  if (showDur) {
    const isProlongador = sub === 'Prolongador';
    // Prolongadores no pueden ser instantáneos; Esencial y Bases sí pueden
    document.getElementById('durationInstantRow').style.display = isProlongador ? 'none' : 'block';
    if (isProlongador) {
      document.getElementById('durationDiceSection').style.display = 'block';
    } else {
      const inst = document.getElementById('matDurationInstant').checked;
      document.getElementById('durationDiceSection').style.display = inst ? 'none' : 'block';
    }
  }

  document.getElementById('potenciadorSection').style.display   = (isMod && sub === 'Potenciador')   ? 'block' : 'none';
  document.getElementById('maxUsesSection').style.display       = isMod ? 'block' : 'none';
  document.getElementById('multiplicadorSection').style.display = (isMod && sub === 'Multiplicador') ? 'block' : 'none';
  if (isMod && sub === 'Multiplicador') {
    const dm = document.getElementById('matDurationMode').value;
    document.getElementById('durationModValueRow').style.display = dm === 'none' ? 'none' : 'block';
  }
  document.getElementById('esencialSection').style.display   = (isMod && sub === 'Esencial')   ? 'block' : 'none';
  document.getElementById('invertidorSection').style.display = (isMod && sub === 'Invertidor') ? 'block' : 'none';
  document.getElementById('alteradorSection').style.display  = (isMod && sub === 'Alterador')  ? 'block' : 'none';
  if (isMod && (sub === 'Alterador' || sub === 'Resistencia' || sub === 'Debilitante')) populateDamageTypeSelect();
  document.getElementById('diffHint').textContent =
    modKind === 'Economizador' ? '(debe ser negativo)' : '(modificador a la CD; el disolvente se suma aparte)';

  if (isBase) updateNoPurificable();
}

// ---- Read form ----
function readFormData() {
  const type = document.getElementById('matType').value;
  const { campo, polaridad } = currentCampoPol();
  const modKind = type === 'Modificador' ? document.getElementById('matModKind').value : '';
  const data = {
    name: document.getElementById('matName').value.trim(),
    lugar: document.getElementById('matLugar').value.trim(),
    type, campo, polaridad, modKind,
    rarity: document.getElementById('matRarity').value,
    difficulty: parseInt(document.getElementById('matDifficulty').value) || 0,
    description: document.getElementById('matDesc').value.trim(),
    unknown: document.getElementById('matUnknown').checked,
    discriminante: false, noPurificable: false,
    effects: [], save: null,
    dicePool: [], flatBonus: 0, statMod: '',
    tradeFactor: 2, tradeDice: 1,
    durationInstant: false, durationDice: [], durationFlat: 0, maxUses: 0,
  };
  if (type === 'Reactivo') {
    data.discriminante = document.getElementById('matDiscriminante').checked;
    data.noPurificable = document.getElementById('matNoPurificable').checked;
  }
<<<<<<< Updated upstream
  if (type === 'Reactivo' || modKind === 'Añadir efecto')
    data.effects = JSON.parse(JSON.stringify(formEffects));
  if (type === 'Reactivo' && hasMaleficio(data.effects))
    data.save = { stat: document.getElementById('matSaveStat').value, onSuccess: document.getElementById('matSaveOn').value };
  if (modKind === 'Potenciador') {
    data.dicePool = getDiceRows('pool');
=======
  const showPool = (type === 'Base' && (sub === 'Vitalidad' || sub === 'Dañina')) || sub === 'Potenciador';
  if (showPool) {
    data.dicePool  = getDiceRows('pool');
>>>>>>> Stashed changes
    data.flatBonus = parseInt(document.getElementById('matFlatBonus').value) || 0;
    data.statMod   = document.getElementById('matStatMod').value.trim();
    if (sub === 'Potenciador') {
      data.dieUpgrade = parseInt(document.getElementById('matDieUpgrade').value) || 0;
    }
  }
  if (modKind === 'Concentrador' || modKind === 'Diluyente') {
    data.tradeFactor = parseFloat(document.getElementById('matTradeFactor').value) || 2;
    data.tradeDice = parseInt(document.getElementById('matTradeDice').value) || 0;
  }
  if (type === 'Reactivo' || modKind === 'Prolongador') {
    data.durationInstant = document.getElementById('matDurationInstant').checked;
    if (!data.durationInstant) {
      data.durationDice = getDiceRows('duration');
      data.durationFlat = parseInt(document.getElementById('matDurationFlat').value) || 0;
    }
  }
  if (type === 'Modificador') {
    data.maxUses = parseInt(document.getElementById('matMaxUses').value) || 0;
    data.effectMultiplier   = 1;
    data.durationMultiplier = 1;
    data.changeDamageType   = '';
    data.addSecondaryEffect = '';
    data.distributeEffect   = false;
    if (sub === 'Multiplicador') {
      data.effectMultiplier  = parseFloat(document.getElementById('matEffectMultiplier').value)  || 2;
      data.effectTarget      = document.getElementById('matEffectTarget').value;        // 'dice' | 'total'
      data.durationMode      = document.getElementById('matDurationMode').value;        // 'none' | 'multiply' | 'flat'
      data.durationModValue  = parseFloat(document.getElementById('matDurationModValue').value) || 2;
      data.distributeEffect  = document.getElementById('matDistributeEffect').checked;
    }
    if (sub === 'Alterador') {
      data.changeDamageType   = document.getElementById('matChangeDamageType').value;
      data.addSecondaryEffect = document.getElementById('matAddSecondaryEffect').value.trim();
    }
    // Esencial: la descripción del efecto mágico va en matDesc (siempre visible),
    // y la duración en los campos estándar de durationSection
  }
  return data;
}

// ---- Reset form ----
export function resetForm() {
  ['matName','matLugar','matDesc','matStatMod'].forEach(id => { document.getElementById(id).value = ''; });
  ['matDifficulty','matFlatBonus','matDurationFlat','matMaxUses'].forEach(id => { document.getElementById(id).value = '0'; });
  document.getElementById('matTradeFactor').value = '2';
  document.getElementById('matTradeDice').value = '1';
  document.getElementById('matCampo').value = 'Cuerpo';
  document.getElementById('matPolaridad').value = 'Beneficioso';
  document.getElementById('matType').value = 'Reactivo';
  document.getElementById('matRarity').value = 'Común';
  document.getElementById('matSaveOn').value = 'anula';
  ['matUnknown','matDiscriminante','matNoPurificable','matDurationInstant'].forEach(id => { document.getElementById(id).checked = false; });
  clearDiceRows('pool'); clearDiceRows('duration');
<<<<<<< Updated upstream
  formEffects = [];
=======
  document.getElementById('matEffectMultiplier').value   = '2';
  document.getElementById('matDurationMultiplier').value = '1';
  document.getElementById('matDieUpgrade').value          = '0';
  document.getElementById('matEffectMultiplier').value   = '2';
  document.getElementById('matEffectTarget').value       = 'dice';
  document.getElementById('matDurationMode').value       = 'none';
  document.getElementById('matDurationModValue').value   = '2';
  document.getElementById('durationModValueRow').style.display = 'none';
  document.getElementById('matDistributeEffect').checked = false;
  document.getElementById('matChangeDamageType').value   = '';
  document.getElementById('matAddSecondaryEffect').value = '';
>>>>>>> Stashed changes
  editingMatId = null;
  document.getElementById('matFormTitle').textContent = '➕ Identificar componente';
  document.getElementById('matSubmitBtn').textContent = '➕ Añadir componente';
  document.getElementById('matCancelEditBtn').style.display = 'none';
  updateMatForm();
}

// ---- CRUD ----
// renderCrafteo is passed as a callback to avoid circular imports (crafting.js → form.js)
export function addMat(renderCrafteo) {
  const data = readFormData();
  if (!data.name) { alert('El componente necesita un nombre.'); return; }
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
  document.getElementById('matType').value = m.type || 'Reactivo';
  document.getElementById('matCampo').value = m.campo || 'Cuerpo';
  document.getElementById('matPolaridad').value = m.polaridad || 'Beneficioso';
  document.getElementById('matRarity').value = m.rarity || 'Común';
  document.getElementById('matDifficulty').value = m.difficulty || 0;
  document.getElementById('matDesc').value = m.description || '';
  document.getElementById('matUnknown').checked = !!m.unknown;
  formEffects = JSON.parse(JSON.stringify(m.effects || []));
  updateMatForm();
  if (m.type === 'Modificador') document.getElementById('matModKind').value = m.modKind || 'Otro';
  document.getElementById('matDurationInstant').checked = !!m.durationInstant;
  updateMatForm(); // second pass to update conditional sections
  if (m.type === 'Reactivo') {
    document.getElementById('matDiscriminante').checked = !!m.discriminante;
    document.getElementById('matNoPurificable').checked = !!m.noPurificable;
  }
  if (m.save) {
    document.getElementById('matSaveStat').value = m.save.stat || '';
    document.getElementById('matSaveOn').value = m.save.onSuccess ?? 'anula';
  }
  document.getElementById('matFlatBonus').value = m.flatBonus || 0;
  document.getElementById('matStatMod').value = m.statMod || '';
  document.getElementById('matTradeFactor').value = m.tradeFactor || 2;
  document.getElementById('matTradeDice').value = m.tradeDice ?? 1;
  document.getElementById('matDurationFlat').value = m.durationFlat || 0;
  document.getElementById('matMaxUses').value = m.maxUses || 0;
  populateDiceRows('pool', m.dicePool);
  populateDiceRows('duration', m.durationDice);
<<<<<<< Updated upstream
=======
  if (m.damageType) { populateDamageTypeSelect(); document.getElementById('matDamageType').value = m.damageType; }
  if (m.subtipo === 'Potenciador') {
    document.getElementById('matDieUpgrade').value = m.dieUpgrade || 0;
  }
  if (m.subtipo === 'Multiplicador') {
    document.getElementById('matEffectMultiplier').value   = m.effectMultiplier ?? 2;
    document.getElementById('matEffectTarget').value       = m.effectTarget      || 'dice';
    document.getElementById('matDurationMode').value       = m.durationMode      || 'none';
    document.getElementById('matDurationModValue').value   = m.durationModValue  ?? 2;
    document.getElementById('durationModValueRow').style.display = (m.durationMode && m.durationMode !== 'none') ? 'block' : 'none';
    document.getElementById('matDistributeEffect').checked = !!m.distributeEffect;
  }
  if (m.subtipo === 'Alterador') {
    populateDamageTypeSelect();
    if (m.changeDamageType) document.getElementById('matChangeDamageType').value = m.changeDamageType;
    document.getElementById('matAddSecondaryEffect').value = m.addSecondaryEffect || '';
  }
>>>>>>> Stashed changes
  if (m.durationInstant) document.getElementById('durationDiceSection').style.display = 'none';
  document.getElementById('matFormTitle').textContent = '✏️ Editar componente';
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
  for (const bid in state.catalog) if (state.catalog[bid].type === 'Reactivo') bases.push({ id: bid, m: state.catalog[bid] });
  if (!bases.length) { alert('No tienes reactivos identificados para comparar.'); return; }
  const opts = bases.map((b, i) => `${i + 1}. ${b.m.unknown ? '???' : b.m.name} (${b.m.campo} · ${b.m.polaridad})`);
  const choice = prompt('Ingeniería inversa: consume 1 unidad.\n\n' + opts.join('\n') + '\n\nNúmero:');
  if (choice == null) return;
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= bases.length) { alert('Opción no válida.'); return; }
  const base = bases[idx];
  loot.tipo = (base.m.unknown ? '???' : base.m.name) + ' (' + base.m.campo + ' · ' + base.m.polaridad + ')';
  loot.identificada = true;
  loot.qty--;
  if (loot.qty <= 0) delete state.lootPotions[id];
  saveState();
  document.getElementById('lootResult').innerHTML =
    `<div class="result-box success"><p>✅ Identificada como: <strong>${loot.tipo}</strong> (consumida 1 unidad)</p></div>`;
}

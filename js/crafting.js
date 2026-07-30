// crafting.js — craft mode state, logic, and rendering
import { state, saveState, genId } from './state.js';
import { APLICACION_OPTIONS } from './data.js';
import {
  getAplicOption, potCatKey, potKey, parsePotKey,
  roll20, calcBonus, mergeDice,
} from './utils.js';
import {
  renderElaboracion, renderPotPicker,
  renderInvMateriales, renderInvPociones,
} from './render.js';

// ---- Craft state (use setters from other modules — cannot reassign exported lets directly) ----
export let craftMode = 'elaboracion';
export let craftSelectedBase = null;
export let craftSelectedMods = {};
export let craftPotionPicks = [];

export function setCraftMode(v)         { craftMode = v; }
export function setCraftSelectedBase(v) { craftSelectedBase = v; }
export function setCraftSelectedMods(v) { craftSelectedMods = v; }
export function setCraftPotionPicks(v)  { craftPotionPicks = v; }

// ---- Aplicación helpers ----
function getCheckedAplics() {
  return [...document.querySelectorAll('[name="craftAplic"]:checked')].map(cb => cb.value);
}

function getAplicDiff() {
  return getCheckedAplics().reduce((t, a) => {
    const o = getAplicOption(a); return o ? t + o.diffMod : t;
  }, 0);
}

export function updateAplicacionPanel() {
  const show = craftSelectedBase !== null || craftPotionPicks.length === 2;
  document.getElementById('craftAplicacionPanel').style.display = show ? 'block' : 'none';
  const inh = document.getElementById('aplicInhalable');
  const fum = document.getElementById('aplicFumigena');
  const conflict = inh?.checked && fum?.checked;
  document.getElementById('aplicConflictWarn').style.display = conflict ? 'block' : 'none';
  const checked = getCheckedAplics();
  APLICACION_OPTIONS.forEach(opt => {
    const el = document.getElementById('ad-' + opt.id);
    if (!el) return;
    el.textContent = (opt.diffMod >= 0 ? '+' : '') + opt.diffMod;
    el.className = 'aplic-diff' + (checked.includes(opt.id) ? ' selected' : '');
  });
  document.getElementById('aplicDiffTotal').textContent = (getAplicDiff() >= 0 ? '+' : '') + getAplicDiff();
}

export function updateCraftSummary() {
  let dc = '—', canCraft = false;
  const checkedAplics = getCheckedAplics();
  const conflict = checkedAplics.includes('inhalable') && checkedAplics.includes('fumigena');
  if (craftMode === 'elaboracion' && craftSelectedBase) {
    const base = state.catalog[craftSelectedBase];
    const baseDiff = base?.difficulty || 0;
    let modDiff = 0;
    for (const mid in craftSelectedMods) if (state.catalog[mid]) modDiff += (state.catalog[mid].difficulty || 0) * craftSelectedMods[mid];
    dc = Math.max(6, 10 + baseDiff + modDiff + getAplicDiff());
    canCraft = checkedAplics.length > 0 && !conflict;
  } else if (craftPotionPicks.length === 2 && (craftMode === 'concentracion' || craftMode === 'multipocion')) {
    const p1 = state.potions[craftPotionPicks[0]];
    const p2 = state.potions[craftPotionPicks[1]];
    if (p1 && p2) {
      const pp1 = parsePotKey(craftPotionPicks[0]);
      const pp2 = parsePotKey(craftPotionPicks[1]);
      const sameBase = pp1 && pp2 && pp1.baseId === pp2.baseId;
      if (craftMode === 'concentracion' && !sameBase) dc = '⚠️ Bases distintas';
      else {
        dc = Math.max(6, 10 + (p1.baseDifficulty || 0) + (p1.modDifficulty || 0) + (p2.baseDifficulty || 0) + (p2.modDifficulty || 0) + getAplicDiff());
        canCraft = checkedAplics.length > 0 && !conflict;
      }
    }
  }
  document.getElementById('craftDifficulty').textContent = dc;
  document.getElementById('craftConfirmBtn').disabled = !canCraft;
}

export function craftSetMode(mode) {
  craftMode = mode;
  craftSelectedBase = null;
  craftSelectedMods = {};
  craftPotionPicks = [];
  document.getElementById('craftResult').innerHTML = '';
  renderCrafteo();
}

export function renderCrafteo() {
  ['elaboracion','concentracion','multipocion'].forEach(m => {
    const btn = document.querySelector(`[data-action="craft-set-mode"][data-id="${m}"]`);
    if (btn) btn.className = 'btn mode-btn' + (craftMode === m ? ' active' : '');
  });
  const hints = {
    elaboracion: 'Combina una base con modificadores opcionales.',
    concentracion: '2 pociones de la misma base → sube de pureza (consume ambas). Sin purificar + sin purificar = Pureza I.',
    multipocion: '2 pociones de bases distintas → multipoción (consume ambas).',
  };
  document.getElementById('craftModeHint').textContent = hints[craftMode] || '';
  document.getElementById('craftElaboracionPanels').style.display = craftMode === 'elaboracion' ? 'block' : 'none';
  document.getElementById('craftConcentracionPanels').style.display = craftMode === 'concentracion' ? 'block' : 'none';
  document.getElementById('craftMultipocionPanels').style.display = craftMode === 'multipocion' ? 'block' : 'none';

  if (craftMode === 'elaboracion') renderElaboracion(craftSelectedBase, craftSelectedMods);
  else if (craftMode === 'concentracion') renderPotPicker(document.getElementById('craftPotionList'), craftPotionPicks);
  else renderPotPicker(document.getElementById('craftMultiList'), craftPotionPicks);
  updateAplicacionPanel();
  updateCraftSummary();
}

// ---- Confirm craft ----
export function craftConfirm() {
  if (craftMode === 'elaboracion') confirmCraftElab();
  else if (craftMode === 'concentracion') confirmCraftConc();
  else confirmCraftMulti();
}

function confirmCraftElab() {
  if (!craftSelectedBase) return;
  const aplics = getCheckedAplics();
  if (!aplics.length) { alert('Elige al menos un método de aplicación.'); return; }
  if (aplics.includes('inhalable') && aplics.includes('fumigena')) { alert('Inhalable y Fumígena no son compatibles.'); return; }

  const base = state.catalog[craftSelectedBase];
  const baseDiff = base.difficulty || 0;
  let modDiff = 0;
  const modsObj = {};
  for (const mid in craftSelectedMods) {
    if (craftSelectedMods[mid] > 0) {
      modsObj[mid] = craftSelectedMods[mid];
      if (state.catalog[mid]) modDiff += (state.catalog[mid].difficulty || 0) * craftSelectedMods[mid];
    }
  }
  const dc = Math.max(6, 10 + baseDiff + modDiff + getAplicDiff());
  const bonus = calcBonus(), roll = roll20(), total = roll + bonus, success = total >= dc;
  const resultEl = document.getElementById('craftResult');

  state.inventory[craftSelectedBase]--;
  for (const mid in modsObj) state.inventory[mid] -= modsObj[mid];

  if (success) {
    const modDiceExtra = [], modDurDice = [];
    let modFlatExtra = 0, modStatMod = '', modDurFlat = 0;
    for (const mid in modsObj) {
      const mm = state.catalog[mid]; if (!mm) continue;
      if (mm.subtipo === 'Potenciador') {
        if (mm.dicePool) modDiceExtra.push(...mm.dicePool);
        modFlatExtra += mm.flatBonus || 0;
        if (mm.statMod && !modStatMod) modStatMod = mm.statMod;
      }
      if (mm.subtipo === 'Prolongador') {
        if (mm.durationDice) modDurDice.push(...mm.durationDice);
        modDurFlat += mm.durationFlat || 0;
      }
    }
    const finalPool = [...(base.dicePool || []), ...modDiceExtra];
    const finalFlat = (base.flatBonus || 0) + modFlatExtra;
    const finalStat = base.statMod || modStatMod;
    const finalDurDice = [...(base.durationDice || []), ...modDurDice];
    const finalDurFlat = (base.durationFlat || 0) + modDurFlat;
    const finalDurInst = base.durationInstant && !modDurDice.length && !modDurFlat;

    const ck = potCatKey(craftSelectedBase, modsObj);
    if (!state.potionCatalog[ck]) {
      const apodo = prompt('Primera vez creando esta poción. ¿Quieres darle un apodo? (deja vacío para omitir)');
      state.potionCatalog[ck] = { apodo: apodo != null ? apodo.trim() : '' };
    }
    const modNames = Object.keys(modsObj).map(mid => state.catalog[mid] ? (state.catalog[mid].unknown ? '???' : state.catalog[mid].name) : null).filter(Boolean);
    const bn = base.unknown ? '???' : base.name;
    const potName = bn + (modNames.length ? ` (${modNames.join(', ')})` : '') + '.';
    const pk = potKey(craftSelectedBase, modsObj, aplics, 0);
    if (state.potions[pk]) state.potions[pk].qty++;
    else state.potions[pk] = {
      qty: 1, name: potName, category: base.category, subtipo: base.subtipo || '',
      baseId: craftSelectedBase, baseName: bn, pureUnits: 0,
      dicePool: finalPool, flatBonus: finalFlat, statMod: finalStat,
      damageType: base.damageType || '', penaltyType: base.penaltyType || '', penaltyValue: base.penaltyValue || 0,
      modDifficulty: modDiff, baseDifficulty: baseDiff, aplicacion: aplics,
      durationInstant: finalDurInst, durationDice: finalDurDice, durationFlat: finalDurFlat,
      noPurificable: base.noPurificable || false, description: base.description || '', isMulti: false,
    };
    saveState();
    const ai = state.potionCatalog[ck];
    const al = ai?.apodo ? ` "${ai.apodo}"` : '';
    resultEl.innerHTML = `<div class="result-box success"><div class="verdict">✅ ¡Éxito! d20(${roll})+bono(${bonus})=${total} vs CD ${dc}</div><p>Elaborada: <strong>${potName}</strong>${al}</p></div>`;
  } else {
    saveState();
    resultEl.innerHTML = `<div class="result-box fail"><div class="verdict puterio">❌ Fallido. d20(${roll})+bono(${bonus})=${total} vs CD ${dc}</div><p>Se pierden los materiales.</p></div>`;
  }
  craftSelectedBase = null; craftSelectedMods = {}; craftPotionPicks = [];
  renderCrafteo(); renderInvMateriales(); renderInvPociones();
}

function confirmCraftConc() {
  if (craftPotionPicks.length < 2) return;
  const [pk1, pk2] = craftPotionPicks;
  const pot1 = state.potions[pk1], pot2 = state.potions[pk2];
  if (!pot1 || !pot2) return;
  const pp1 = parsePotKey(pk1), pp2 = parsePotKey(pk2);
  if (!pp1 || !pp2 || pp1.baseId !== pp2.baseId) { alert('Concentración: misma base requerida.'); return; }
  const aplics = getCheckedAplics();
  if (!aplics.length) { alert('Elige al menos un método de aplicación.'); return; }
  if (aplics.includes('inhalable') && aplics.includes('fumigena')) { alert('Inhalable y Fumígena no son compatibles.'); return; }

  const dc = Math.max(6, 10 + (pot1.baseDifficulty || 0) + (pot1.modDifficulty || 0) + (pot2.baseDifficulty || 0) + (pot2.modDifficulty || 0) + getAplicDiff());
  const bonus = calcBonus(), roll = roll20(), total = roll + bonus, success = total >= dc;
  const resultEl = document.getElementById('craftResult');
  pot1.qty--; if (pot1.qty <= 0) delete state.potions[pk1];
  pot2.qty--; if (pot2.qty <= 0) delete state.potions[pk2];

  if (success) {
    const newPurity = Math.max(pp1.purity, pp2.purity) + 1;
    const modsObj = {};
    [pp1.mods, pp2.mods].forEach(ms => {
      if (ms) ms.split(',').forEach(m => { if (m) modsObj[m] = (modsObj[m] || 0) + 1; });
    });
    const ck = potCatKey(pp1.baseId, modsObj);
    if (!state.potionCatalog[ck]) state.potionCatalog[ck] = { apodo: '' };
    const bn = pot1.baseName || '???';
    const mns = Object.keys(modsObj).map(m2 => state.catalog[m2] ? (state.catalog[m2].unknown ? '???' : state.catalog[m2].name) : null).filter(Boolean);
    const potName = bn + (mns.length ? ` (${mns.join(', ')})` : '') + `. Nivel de Pureza ${_purityRoman(newPurity)}.`;
    const npk = potKey(pp1.baseId, modsObj, aplics, newPurity);
    const hasDice = (pot1.dicePool?.length ?? 0) > 0 || (pot2.dicePool?.length ?? 0) > 0;
    const concDicePool = hasDice ? mergeDice(pot1.dicePool, pot2.dicePool) : [];
    const concDurDice = hasDice ? (pot1.durationDice || []) : mergeDice(pot1.durationDice, pot2.durationDice);
    if (state.potions[npk]) state.potions[npk].qty++;
    else state.potions[npk] = {
      qty: 1, name: potName, category: pot1.category, subtipo: pot1.subtipo || '',
      baseId: pp1.baseId, baseName: bn, pureUnits: newPurity,
      dicePool: concDicePool, flatBonus: pot1.flatBonus || 0, statMod: pot1.statMod || pot2.statMod || '',
      damageType: pot1.damageType || '', penaltyType: pot1.penaltyType || '', penaltyValue: pot1.penaltyValue || 0,
      modDifficulty: Math.max(pot1.modDifficulty || 0, pot2.modDifficulty || 0),
      baseDifficulty: Math.max(pot1.baseDifficulty || 0, pot2.baseDifficulty || 0),
      aplicacion: aplics, durationInstant: pot1.durationInstant,
      durationDice: concDurDice, durationFlat: pot1.durationFlat || 0,
      noPurificable: pot1.noPurificable, description: pot1.description || '', isMulti: false,
    };
    saveState();
    resultEl.innerHTML = `<div class="result-box success"><div class="verdict">✅ ¡Éxito! d20(${roll})+bono(${bonus})=${total} vs CD ${dc}</div><p>Concentrada: <strong>${potName}</strong></p></div>`;
  } else {
    saveState();
    resultEl.innerHTML = `<div class="result-box fail"><div class="verdict puterio">❌ Fallido. d20(${roll})+bono(${bonus})=${total} vs CD ${dc}</div><p>Se pierden las pociones.</p></div>`;
  }
  craftPotionPicks = []; renderCrafteo(); renderInvPociones();
}

function confirmCraftMulti() {
  if (craftPotionPicks.length < 2) return;
  const [pk1, pk2] = craftPotionPicks;
  const pot1 = state.potions[pk1], pot2 = state.potions[pk2];
  if (!pot1 || !pot2) return;
  const pp1 = parsePotKey(pk1), pp2 = parsePotKey(pk2);
  if (!pp1 || !pp2) return;
  const aplics = getCheckedAplics();
  if (!aplics.length) { alert('Elige al menos un método de aplicación.'); return; }
  if (aplics.includes('inhalable') && aplics.includes('fumigena')) { alert('Inhalable y Fumígena no son compatibles.'); return; }

  const bonus = calcBonus();
  const resultEl = document.getElementById('craftResult');
  const sameBase = pp1.baseId === pp2.baseId;
  let desc = '';

  pot1.qty--; if (pot1.qty <= 0) delete state.potions[pk1];
  pot2.qty--; if (pot2.qty <= 0) delete state.potions[pk2];

  if (sameBase) {
    const dcPur = Math.max(6, 10 + (pot1.baseDifficulty || 0) + (pot1.modDifficulty || 0) + (pot2.baseDifficulty || 0) + (pot2.modDifficulty || 0) + getAplicDiff());
    const rollPur = roll20(), totalPur = rollPur + bonus;
    desc += `🔮 Purificación: d20(${rollPur})+bono(${bonus})=${totalPur} vs CD ${dcPur}`;
    if (totalPur < dcPur) {
      saveState();
      resultEl.innerHTML = `<div class="result-box fail"><div class="verdict puterio">❌ Fallo en purificación. ${desc}</div><p>Se pierden las pociones.</p></div>`;
      craftPotionPicks = []; renderCrafteo(); renderInvPociones(); return;
    }
    desc += ' ✅<br>';
  }

  const dc = Math.max(6, 10 + (pot1.baseDifficulty || 0) + (pot1.modDifficulty || 0) + (pot2.baseDifficulty || 0) + (pot2.modDifficulty || 0) + getAplicDiff());
  const roll = roll20(), total = roll + bonus, success = total >= dc;
  desc += (sameBase ? '⚗️ Multipoción: ' : '') + `d20(${roll})+bono(${bonus})=${total} vs CD ${dc}`;

  if (success) {
    const apodoM = prompt('¿Apodo para esta multipoción? (deja vacío para omitir)');
    const n1 = pot1.name || '???', n2 = pot2.name || '???';
    const multiName = `[Multi] ${n1} + ${n2}.`;
    const multiPk = `multi_${pp1.baseId}_${pp2.baseId}_${genId()}_p1`;
    const multiCk = 'multi_' + [pp1.baseId, pp2.baseId].sort().join('_');
    if (!state.potionCatalog[multiCk]) state.potionCatalog[multiCk] = { apodo: apodoM != null ? apodoM.trim() : '' };
    const durInst = pot1.durationInstant && pot2.durationInstant;
    const comp1 = { name: n1, category: pot1.category || '', dicePool: pot1.dicePool || [], flatBonus: pot1.flatBonus || 0, statMod: pot1.statMod || '', damageType: pot1.damageType || '', penaltyType: pot1.penaltyType || '', penaltyValue: pot1.penaltyValue || 0, durationInstant: !!pot1.durationInstant, durationDice: pot1.durationDice || [], durationFlat: pot1.durationFlat || 0, description: pot1.description || '' };
    const comp2 = { name: n2, category: pot2.category || '', dicePool: pot2.dicePool || [], flatBonus: pot2.flatBonus || 0, statMod: pot2.statMod || '', damageType: pot2.damageType || '', penaltyType: pot2.penaltyType || '', penaltyValue: pot2.penaltyValue || 0, durationInstant: !!pot2.durationInstant, durationDice: pot2.durationDice || [], durationFlat: pot2.durationFlat || 0, description: pot2.description || '' };
    state.potions[multiPk] = {
      qty: 1, name: multiName, category: pot1.category || pot2.category || 'Mágica', subtipo: '',
      baseId: pp1.baseId, baseName: `${pot1.baseName || '???'} + ${pot2.baseName || '???'}`, pureUnits: 0,
      dicePool: [...(pot1.dicePool || []), ...(pot2.dicePool || [])],
      flatBonus: (pot1.flatBonus || 0) + (pot2.flatBonus || 0),
      statMod: pot1.statMod || pot2.statMod || '',
      damageType: pot1.damageType || pot2.damageType || '',
      modDifficulty: (pot1.modDifficulty || 0) + (pot2.modDifficulty || 0),
      baseDifficulty: (pot1.baseDifficulty || 0) + (pot2.baseDifficulty || 0),
      aplicacion: aplics, durationInstant: durInst,
      durationDice: [...(pot1.durationDice || []), ...(pot2.durationDice || [])],
      durationFlat: (pot1.durationFlat || 0) + (pot2.durationFlat || 0),
      noPurificable: pot1.noPurificable && pot2.noPurificable,
      description: [pot1.description, pot2.description].filter(Boolean).join(' / '),
      isMulti: true, components: [comp1, comp2],
    };
    saveState();
    const al = apodoM?.trim() ? ` "${apodoM.trim()}"` : '';
    resultEl.innerHTML = `<div class="result-box success"><div class="verdict">✅ ¡Éxito! ${desc}</div><p>Multipoción: <strong>${multiName}</strong>${al}</p></div>`;
  } else {
    saveState();
    resultEl.innerHTML = `<div class="result-box fail"><div class="verdict puterio">❌ Fallido. ${desc}</div><p>Se pierden las pociones.</p></div>`;
  }
  craftPotionPicks = []; renderCrafteo(); renderInvPociones();
}

// Inline purityRoman to avoid dynamic import
function _purityRoman(n) {
  return (['I','II','III','IV','V','VI','VII','VIII','IX','X'][n - 1] || 'I');
}

// crafting.js — craft mode state, logic, and rendering
import { state, saveState, genId } from './state.js';
import { APLICACION_OPTIONS } from './data.js';
import {
  getAplicOption, potCatKey, potKey, parsePotKey,
  roll20, calcBonus,
} from './utils.js';
import { elabDC, applyModifiers, modCompat, getDisolvente, mergePools } from './model.js';
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
    dc = elabDC(base, compatMods(base, craftSelectedMods), state.catalog, state.settings, getAplicDiff()).dc;
    canCraft = checkedAplics.length > 0 && !conflict;
  } else if (craftPotionPicks.length === 2 && (craftMode === 'concentracion' || craftMode === 'multipocion')) {
    const p1 = state.potions[craftPotionPicks[0]];
    const p2 = state.potions[craftPotionPicks[1]];
    if (p1 && p2) {
      const pp1 = parsePotKey(craftPotionPicks[0]);
      const pp2 = parsePotKey(craftPotionPicks[1]);
      const sameBase = pp1 && pp2 && pp1.baseId === pp2.baseId;
      if (craftMode === 'concentracion' && !sameBase) dc = '⚠️ Reactivos distintos';
      else if (p1.campo === 'Mágico' || p2.campo === 'Mágico') dc = '⚠️ Las mágicas no se combinan';
      else {
        dc = pairDC(p1, p2, craftMode === 'multipocion');
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
    elaboracion: 'Combina un reactivo (su campo fija el disolvente) con modificadores opcionales.',
    concentracion: '2 pociones del mismo reactivo → sube de pureza (consume ambas). Sin purificar + sin purificar = Pureza I. Las mágicas no se concentran.',
    multipocion: '2 pociones → multipoción (consume ambas). Con disolventes distintos la CD sube. Las mágicas no se combinan.',
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

// ---- Difficulty helpers ----
// Only modifiers compatible with the reactivo count (campo / polaridad rules in model.js)
function compatMods(base, mods) {
  const out = {};
  for (const mid in mods) {
    if (mods[mid] > 0 && state.catalog[mid] && modCompat(base, state.catalog[mid], state.settings).ok) out[mid] = mods[mid];
  }
  return out;
}

function potDiff(p) {
  return (p.baseDifficulty || 0) + (p.modDifficulty || 0) + (p.extraDifficulty || 0);
}

function pairDC(p1, p2, isMulti) {
  const mixed = isMulti && p1.campo && p2.campo && p1.campo !== p2.campo;
  const extra = mixed ? (state.settings?.multiDisolventeDiff ?? 2) : 0;
  return Math.max(6, 10 + potDiff(p1) + potDiff(p2) + extra + getAplicDiff());
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
  const modsObj = compatMods(base, craftSelectedMods);
  const d = elabDC(base, modsObj, state.catalog, state.settings, getAplicDiff());
  const dc = d.dc;
  const bonus = calcBonus(), roll = roll20(), total = roll + bonus, success = total >= dc;
  const resultEl = document.getElementById('craftResult');

  state.inventory[craftSelectedBase]--;
  for (const mid in modsObj) state.inventory[mid] -= modsObj[mid];

  if (success) {
<<<<<<< Updated upstream
    const applied = applyModifiers(base, modsObj, state.catalog);
    const solv = getDisolvente(state.settings, base.campo);
=======
    const modDiceExtra = [], modDurDice = [];
    let modFlatExtra = 0, modStatMod = '', modDurFlat = 0;
    let effectMultFactor = 1, effectTotalFactor = 1, durationMultFactor = 1;
    let totalDieUpgrade = 0;
    let isDistributed = false;
    let finalDamageType = base.damageType || '';
    const secondaryEffects = [];
    // Mágica-specific
    let esencialDesc = '', esencialDurInst = false, esencialDurDice = [], esencialDurFlat = 0;
    let isInverted = false, invertedEffect = '';

    for (const mid in modsObj) {
      const mm = state.catalog[mid]; if (!mm) continue;
      const qty = modsObj[mid] || 1;
      if (mm.subtipo === 'Potenciador') {
        (mm.dicePool || []).forEach(d => modDiceExtra.push({ count: (d.count || 1) * qty, sides: d.sides }));
        modFlatExtra += (mm.flatBonus || 0) * qty;
        if (mm.statMod && !modStatMod) modStatMod = mm.statMod;
        totalDieUpgrade += (mm.dieUpgrade || 0) * qty;
      }
      if (mm.subtipo === 'Prolongador') {
        (mm.durationDice || []).forEach(d => modDurDice.push({ count: (d.count || 1) * qty, sides: d.sides }));
        modDurFlat += (mm.durationFlat || 0) * qty;
      }
      if (mm.subtipo === 'Multiplicador') {
        const ef = mm.effectMultiplier || 1;
        if (mm.effectTarget === 'total') {
          effectTotalFactor *= Math.pow(ef, qty);    // multiplica el total ya tirado
        } else {
          effectMultFactor  *= Math.pow(ef, qty);    // multiplica el número de dados
        }
        if (mm.durationMode === 'multiply') {
          durationMultFactor *= Math.pow(mm.durationModValue || 1, qty);
        } else if (mm.durationMode === 'flat') {
          modDurFlat += Math.round((mm.durationModValue || 0) * qty);
        }
        if (mm.distributeEffect) isDistributed = true;
      }
      if (mm.subtipo === 'Alterador') {
        if (mm.changeDamageType)   finalDamageType = mm.changeDamageType;
        if (mm.addSecondaryEffect) secondaryEffects.push(mm.addSecondaryEffect);
      }
      if (mm.subtipo === 'Esencial') {
        // Para pociones Mágicas: el Esencial define la duración y la descripción del efecto
        esencialDurInst  = !!mm.durationInstant;
        esencialDurDice  = mm.durationDice  || [];
        esencialDurFlat  = mm.durationFlat  || 0;
        esencialDesc     = mm.description   || '';
      }
      if (mm.subtipo === 'Invertidor') {
        isInverted = true;
      }
    }

    // Tier upgrade: mejora los dados de la base (d4→d6→d8→d10→d12→d20)
    const DIE_TIERS = [4, 6, 8, 10, 12, 20];
    const upgradedBase = (base.dicePool || []).map(d => {
      if (!totalDieUpgrade) return { count: d.count, sides: d.sides };
      const idx = DIE_TIERS.indexOf(d.sides);
      const newSides = idx >= 0 ? DIE_TIERS[Math.min(idx + totalDieUpgrade, DIE_TIERS.length - 1)] : d.sides;
      return { count: d.count, sides: newSides };
    });

    // Additive pool + multiplicative pass
    let finalPool = [...upgradedBase, ...modDiceExtra];
    if (effectMultFactor !== 1) {
      finalPool = finalPool.map(d => ({ count: Math.max(1, Math.round((d.count || 1) * effectMultFactor)), sides: d.sides }));
    }
    const finalFlat = (base.flatBonus || 0) + modFlatExtra;
    const finalStat = base.statMod || modStatMod;

    // Para pociones Mágicas: la duración la dicta el modificador Esencial
    const isMagicaPotion = base.category === 'Mágica';
    let finalDurDice, finalDurFlat, finalDurInst;
    if (isMagicaPotion) {
      finalDurDice = [...esencialDurDice];
      finalDurFlat = esencialDurFlat;
      finalDurInst = esencialDurInst && !esencialDurDice.length && !esencialDurFlat;
    } else {
      finalDurDice = [...(base.durationDice || []), ...modDurDice];
      finalDurFlat = (base.durationFlat || 0) + modDurFlat;
      finalDurInst = base.durationInstant && !modDurDice.length && !modDurFlat;
    }
    if (durationMultFactor !== 1 && !finalDurInst) {
      finalDurDice = finalDurDice.map(d => ({ count: Math.max(1, Math.round((d.count || 1) * durationMultFactor)), sides: d.sides }));
      finalDurFlat = Math.round(finalDurFlat * durationMultFactor);
    }
    // Distribuidor: instant → force 2 turns
    if (isDistributed && finalDurInst) { finalDurInst = false; finalDurFlat = 2; }

    const secondaryEffect = secondaryEffects.join(' / ');

>>>>>>> Stashed changes
    const ck = potCatKey(craftSelectedBase, modsObj);
    if (!state.potionCatalog[ck]) {
      const apodo = prompt('Primera vez creando esta poción. ¿Quieres darle un apodo? (deja vacío para omitir)');
      const entry = { apodo: apodo != null ? apodo.trim() : '' };
      if (isInverted) {
        const invDesc = prompt('Poción invertida: describe el efecto de la inversión (deja vacío para omitir)');
        entry.invertedEffect = invDesc != null ? invDesc.trim() : '';
      }
      state.potionCatalog[ck] = entry;
    }
    invertedEffect = state.potionCatalog[ck].invertedEffect || '';
    const modNames = Object.keys(modsObj).map(mid => state.catalog[mid] ? (state.catalog[mid].unknown ? '???' : state.catalog[mid].name) : null).filter(Boolean);
    const bn = base.unknown ? '???' : base.name;
    const potName = bn + (modNames.length ? ` (${modNames.join(', ')})` : '') + '.';
    const pk = potKey(craftSelectedBase, modsObj, aplics, 0);
    if (state.potions[pk]) state.potions[pk].qty++;
    else state.potions[pk] = {
      qty: 1, name: potName, campo: base.campo, polaridad: base.polaridad, disolvente: solv.name,
      baseId: craftSelectedBase, baseName: bn, pureUnits: 0,
<<<<<<< Updated upstream
      effects: applied.effects,
      durationInstant: applied.durationInstant, durationDice: applied.durationDice,
      durationFlat: applied.durationFlat, durationMult: applied.durationMult,
      save: base.save || null, craftDC: dc,
      modDifficulty: d.modDiff, baseDifficulty: d.baseDiff, extraDifficulty: d.solvDiff + d.polDiff,
      aplicacion: aplics,
      noPurificable: base.noPurificable || false, description: base.description || '', isMulti: false,
=======
      dicePool: finalPool, flatBonus: finalFlat, statMod: finalStat,
      damageType: finalDamageType, penaltyType: base.penaltyType || '', penaltyValue: base.penaltyValue || 0,
      modDifficulty: modDiff, baseDifficulty: baseDiff, aplicacion: aplics,
      durationInstant: finalDurInst, durationDice: finalDurDice, durationFlat: finalDurFlat,
      noPurificable: base.noPurificable || false,
      description: isMagicaPotion ? esencialDesc : (base.description || ''),
      isMulti: false, isDistributed, secondaryEffect,
      isInverted, invertedEffect,
      effectTotalMultiplier: effectTotalFactor !== 1 ? effectTotalFactor : undefined,
>>>>>>> Stashed changes
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
  if (!pp1 || !pp2 || pp1.baseId !== pp2.baseId) { alert('Concentración: hace falta el mismo reactivo.'); return; }
  if (pot1.campo === 'Mágico') { alert('Las pociones mágicas no se pueden concentrar.'); return; }
  const aplics = getCheckedAplics();
  if (!aplics.length) { alert('Elige al menos un método de aplicación.'); return; }
  if (aplics.includes('inhalable') && aplics.includes('fumigena')) { alert('Inhalable y Fumígena no son compatibles.'); return; }

  const dc = pairDC(pot1, pot2, false);
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
    const eff1 = pot1.effects || [], eff2 = pot2.effects || [];
    const hasDice = eff1.some(e => e.dice?.length) || eff2.some(e => e.dice?.length);
    const concEffects = eff1.map((e, i) => {
      const c = JSON.parse(JSON.stringify(e));
      const o = eff2[i];
      if (o && o.kind === e.kind && (e.dice?.length || o.dice?.length)) c.dice = mergePools(e.dice, o.dice);
      return c;
    });
    // Keep blocks of the second potion that have no counterpart in the first
    eff2.forEach((o, i) => {
      const e = eff1[i];
      if (!e || e.kind !== o.kind || !(e.dice?.length || o.dice?.length)) {
        if (!(e && JSON.stringify(e) === JSON.stringify(o))) concEffects.push(JSON.parse(JSON.stringify(o)));
      }
    });
    const concDurDice = hasDice ? (pot1.durationDice || []) : mergePools(pot1.durationDice, pot2.durationDice);
    if (state.potions[npk]) state.potions[npk].qty++;
    else state.potions[npk] = {
      qty: 1, name: potName, campo: pot1.campo, polaridad: pot1.polaridad, disolvente: pot1.disolvente,
      baseId: pp1.baseId, baseName: bn, pureUnits: newPurity,
      effects: concEffects,
      save: pot1.save || null, craftDC: Math.max(pot1.craftDC || 0, dc),
      modDifficulty: Math.max(pot1.modDifficulty || 0, pot2.modDifficulty || 0),
      baseDifficulty: Math.max(pot1.baseDifficulty || 0, pot2.baseDifficulty || 0),
      extraDifficulty: Math.max(pot1.extraDifficulty || 0, pot2.extraDifficulty || 0),
      aplicacion: aplics, durationInstant: pot1.durationInstant,
      durationDice: concDurDice, durationFlat: pot1.durationFlat || 0, durationMult: pot1.durationMult || 1,
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
  if (pot1.campo === 'Mágico' || pot2.campo === 'Mágico') { alert('Las pociones mágicas no se pueden combinar.'); return; }
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
    const dcPur = pairDC(pot1, pot2, false);
    const rollPur = roll20(), totalPur = rollPur + bonus;
    desc += `🔮 Purificación: d20(${rollPur})+bono(${bonus})=${totalPur} vs CD ${dcPur}`;
    if (totalPur < dcPur) {
      saveState();
      resultEl.innerHTML = `<div class="result-box fail"><div class="verdict puterio">❌ Fallo en purificación. ${desc}</div><p>Se pierden las pociones.</p></div>`;
      craftPotionPicks = []; renderCrafteo(); renderInvPociones(); return;
    }
    desc += ' ✅<br>';
  }

  const dc = pairDC(pot1, pot2, true);
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
    const comp = (p, n) => ({
      name: n, campo: p.campo || '', polaridad: p.polaridad || '', disolvente: p.disolvente || '',
      effects: JSON.parse(JSON.stringify(p.effects || [])), save: p.save || null, craftDC: p.craftDC || 0,
      durationInstant: !!p.durationInstant, durationDice: p.durationDice || [], durationFlat: p.durationFlat || 0,
      durationMult: p.durationMult || 1, description: p.description || '',
    });
    const sameCampo = pot1.campo === pot2.campo, samePol = pot1.polaridad === pot2.polaridad;
    state.potions[multiPk] = {
      qty: 1, name: multiName,
      campo: sameCampo ? pot1.campo : '', polaridad: samePol ? pot1.polaridad : '',
      baseId: pp1.baseId, baseName: `${pot1.baseName || '???'} + ${pot2.baseName || '???'}`, pureUnits: 0,
      effects: [...(pot1.effects || []), ...(pot2.effects || [])],
      craftDC: dc,
      modDifficulty: (pot1.modDifficulty || 0) + (pot2.modDifficulty || 0),
      baseDifficulty: (pot1.baseDifficulty || 0) + (pot2.baseDifficulty || 0),
      extraDifficulty: (pot1.extraDifficulty || 0) + (pot2.extraDifficulty || 0),
      aplicacion: aplics, durationInstant: durInst,
      durationDice: [...(pot1.durationDice || []), ...(pot2.durationDice || [])],
      durationFlat: (pot1.durationFlat || 0) + (pot2.durationFlat || 0),
      noPurificable: pot1.noPurificable && pot2.noPurificable,
      description: [pot1.description, pot2.description].filter(Boolean).join(' / '),
      isMulti: true, components: [comp(pot1, n1), comp(pot2, n2)],
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

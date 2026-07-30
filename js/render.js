// render.js — all DOM rendering functions
import { state, saveState } from './state.js';
import { getAplicOption } from './utils.js';
import {
  rarityBadge, catBadge, purityRoman,
  parsePotKey, parsedToCatKey, parseCatKey,
  rollDice,
} from './utils.js';

// ---- CAT MATERIALES ----
function buildMatDetail(m) {
  const parts = [];
  if (m.description) parts.push(`<strong>Descripción:</strong> ${m.description}`);
  if (m.type === 'Base') {
    if (m.discriminante) parts.push('⚠️ Base <em>Discriminante</em>');
    if (m.noPurificable) parts.push('🚫 No purificable');
    if (m.durationInstant) parts.push('⚡ Duración: Instantánea');
    else if (m.durationDice?.length) {
      const ds = m.durationDice.map(d => `${d.count}d${d.sides}`).join('+');
      parts.push('⏱️ Duración: ' + ds + (m.durationFlat ? ` + ${m.durationFlat} turno(s)` : ''));
    } else if (m.durationFlat) {
      parts.push(`⏱️ Duración: ${m.durationFlat} turno(s)`);
    }
  }
  if (m.dicePool?.length) {
    const ds = m.dicePool.map(d => `${d.count}d${d.sides}`).join('+');
    parts.push('🎲 Dados: ' + ds + (m.flatBonus ? ` + ${m.flatBonus}` : '') + (m.statMod ? ` + mod.${m.statMod}` : ''));
  }
  if (m.damageType) parts.push(`🛡️ Tipo de daño: ${m.damageType}`);
  if (m.penaltyType) parts.push(`⬇️ Penalización: ${m.penaltyType}${m.penaltyValue ? ` (${m.penaltyValue})` : ''}`);
  if (m.type === 'Modificador' && m.maxUses) parts.push(`🔢 Máx usos por poción: ${m.maxUses}`);
  return parts.length ? parts.join('<br>') : '<em class="muted">Sin detalles adicionales.</em>';
}

function makeMatCard(id, m, deletePendingId) {
  const dn = m.unknown ? '<em>???</em>' : m.name;
  const lugar = m.lugar || '???';
  const isPending = deletePendingId === id;
  const delHtml = isPending
    ? `<button class="btn btn-sm btn-danger" data-action="delete-mat" data-id="${id}">⚠️ Confirmar</button>
       <button class="btn btn-sm" style="background:#777" data-action="cancel-delete">✖</button>`
    : `<button class="btn btn-sm btn-danger" data-action="delete-mat" data-id="${id}">🗑️</button>`;

  const div = document.createElement('div');
  div.className = 'mat-card';
  div.innerHTML = `
    <div class="mat-card-header">
      <div>
        <div class="mat-card-title">${dn}</div>
        <div class="mat-card-meta">
          ${catBadge(m.category)}
          <span class="badge badge-${m.type === 'Base' ? 'base' : 'mod'}">${m.type}</span>
          ${m.subtipo ? `<span class="badge badge-sub">${m.subtipo}</span>` : ''}
          ${rarityBadge(m.rarity)}
          · 📍 ${lugar} · Dif: ${m.difficulty >= 0 ? '+' : ''}${m.difficulty}
        </div>
      </div>
      <div class="mat-card-actions">
        <button class="btn btn-sm btn-info" data-action="toggle-mat-detail" data-id="${id}">ℹ️</button>
        <button class="btn btn-sm btn-edit" data-action="edit-mat" data-id="${id}">✏️</button>
        ${delHtml}
      </div>
    </div>
    <div class="mat-card-detail" id="matdetail_${id}" style="display:none">${buildMatDetail(m)}</div>`;
  return div;
}

export function renderCatMateriales(deletePendingId = null) {
  const bases = [], mods = [];
  for (const id in state.catalog) {
    (state.catalog[id].type === 'Base' ? bases : mods).push({ id, m: state.catalog[id] });
  }
  const bEl = document.getElementById('catBaseList');
  const mEl = document.getElementById('catModList');
  if (!bEl || !mEl) return;
  if (!bases.length) bEl.innerHTML = '<p class="muted">No hay bases registradas.</p>';
  else { bEl.innerHTML = ''; bases.forEach(x => bEl.appendChild(makeMatCard(x.id, x.m, deletePendingId))); }
  if (!mods.length) mEl.innerHTML = '<p class="muted">No hay modificadores registrados.</p>';
  else { mEl.innerHTML = ''; mods.forEach(x => mEl.appendChild(makeMatCard(x.id, x.m, deletePendingId))); }
}

// ---- CAT POCIONES ----
// Exposed globally in app.js for inline onclick
export function togglePotCatEntry(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export function renderCatPociones() {
  const el = document.getElementById('potionCatalogList');
  if (!el) return;
  const catKeys = Object.keys(state.potionCatalog);
  if (!catKeys.length) { el.innerHTML = '<p class="muted">Todavía no has creado ninguna poción.</p>'; return; }

  const groups = {};
  catKeys.forEach(ck => {
    const parsed = parseCatKey(ck); if (!parsed) return;
    const base = state.catalog[parsed.baseId]; if (!base) return;
    const cat = base.category || 'Mágica';
    const sub = base.subtipo || '(Sin subtipo)';
    if (!groups[cat]) groups[cat] = {};
    if (!groups[cat][sub]) groups[cat][sub] = [];
    groups[cat][sub].push({ ck, parsed, base });
  });

  let html = '';
  ['Salutífera','Maliciosa','Mágica'].forEach(cat => {
    if (!groups[cat]) return;
    html += `<div class="pot-cat-group"><div class="pot-cat-title">${catBadge(cat)} ${cat}</div>`;
    for (const sub in groups[cat]) {
      html += `<div style="font-size:.85em;color:#666;margin:6px 0 2px"><strong>${sub}</strong></div>`;
      groups[cat][sub].forEach(item => {
        const info = state.potionCatalog[item.ck] || {};
        const bn = item.base.unknown ? '???' : item.base.name;
        const modNames = (item.parsed.mods || '').split(',')
          .filter(Boolean)
          .map(mid => state.catalog[mid] ? (state.catalog[mid].unknown ? '???' : state.catalog[mid].name) : null)
          .filter(Boolean);
        const formula = bn + (modNames.length ? ` (${modNames.join(', ')})` : '');
        const apodo = info.apodo ? ` <em class="apodo-badge">"${info.apodo}"</em>` : '';
        const listId = 'potcl_' + item.ck.replace(/[^a-z0-9]/gi, '_');

        const purities = [];
        for (const pk in state.potions) {
          const pp = parsePotKey(pk);
          if (pp && pp.baseId === item.parsed.baseId && pp.mods === item.parsed.mods && !purities.includes(pp.purity))
            purities.push(pp.purity);
        }
        if (!purities.length) purities.push(0);
        purities.sort((a, b) => a - b);

        html += `<div class="pot-base-block">
          <button class="pot-base-toggle" onclick="window.togglePotCatEntry('${listId}')">▶ <strong>${formula}</strong>${apodo}</button>
          <div id="${listId}" class="pot-purity-list" style="display:none">`;
        purities.forEach(p => {
          let totalQty = 0;
          for (const pk2 in state.potions) {
            const pp2 = parsePotKey(pk2);
            if (pp2 && pp2.baseId === item.parsed.baseId && pp2.mods === item.parsed.mods && pp2.purity === p)
              totalQty += (state.potions[pk2].qty || 0);
          }
          const pLabel = p === 0 ? 'Sin purificar' : `Nivel de Pureza ${purityRoman(p)}.`;
          html += `<div class="pot-purity-item">${pLabel} <span class="muted">(x${totalQty} en inv.)</span></div>`;
        });
        html += '</div></div>';
      });
    }
    html += '</div>';
  });
  el.innerHTML = html || '<p class="muted">Sin resultados.</p>';
}

// ---- INV MATERIALES ----
export function renderInvMateriales() {
  const el = document.getElementById('invMatList'); if (!el) return;
  const ids = Object.keys(state.catalog);
  if (!ids.length) { el.innerHTML = '<p class="muted">No hay materiales. Ve a Info → Identificación.</p>'; return; }
  el.innerHTML = ids.map(id => {
    const m = state.catalog[id];
    const qty = state.inventory[id] || 0;
    const dn = m.unknown ? '???' : m.name;
    const cc = m.category === 'Salutífera' ? 'sal' : m.category === 'Maliciosa' ? 'mal' : 'mag';
    return `<div class="inv-row">
      <div class="inv-name"><span class="badge badge-${cc}" style="margin-right:4px">${m.type[0]}</span>${dn} ${rarityBadge(m.rarity)}</div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-action="inv-dec" data-id="${id}">−</button>
        <span class="stepper-count">${qty}</span>
        <button class="btn btn-sm" data-action="inv-inc" data-id="${id}">+</button>
      </div>
    </div>`;
  }).join('');
}

// ---- INV POCIONES ----
function buildCompSummary(c) {
  const parts = [];
  if (c.dicePool?.length) {
    let s = c.dicePool.map(d => `${d.count}d${d.sides}`).join('+');
    if (c.flatBonus) s += ` + ${c.flatBonus}`;
    if (c.statMod) s += ` + mod.${c.statMod}`;
    parts.push('🎲 ' + s);
  } else if (c.flatBonus) {
    parts.push('🎲 ' + c.flatBonus + (c.statMod ? ` + mod.${c.statMod}` : ''));
  }
  if (c.damageType) parts.push(`🛡️ ${c.damageType}`);
  if (c.penaltyType) parts.push(`⬇️ ${c.penaltyType}${c.penaltyValue ? ` (${c.penaltyValue})` : ''}`);
  return parts;
}

function buildCompDur(c) {
  if (c.durationInstant) return '⚡ Instantánea';
  if (c.durationDice?.length) {
    const d = c.durationDice.map(x => `${x.count}d${x.sides}`).join('+');
    return '⏱️ ' + d + (c.durationFlat ? ` + ${c.durationFlat}` : '') + ' turno(s)';
  }
  if (c.durationFlat) return `⏱️ ${c.durationFlat} turno(s)`;
  return '';
}

export function buildPotDetail(pot) {
  if (pot.isMulti && pot.components?.length) {
    let h = '<table class="multi-detail-table"><thead><tr><th>Componente</th><th>Efecto</th><th>Duración</th></tr></thead><tbody>';
    pot.components.forEach(c => {
      const eff = buildCompSummary(c).join(' | ') || '—';
      const dur = buildCompDur(c) || '—';
      h += `<tr><td><strong>${c.name}</strong>${catBadge(c.category || '')}</td><td>${eff}</td><td>${dur}</td></tr>`;
    });
    h += '</tbody></table>';
    const allEff = [], allDur = [];
    pot.components.forEach(c => {
      buildCompSummary(c).forEach(e => { if (!allEff.includes(e)) allEff.push(e); });
      const d = buildCompDur(c); if (d && !allDur.includes(d)) allDur.push(d);
    });
    h += `<div class="multi-summary"><strong>📋 Resumen:</strong> ${allEff.length ? allEff.join(' + ') : 'Sin efecto directo'}${allDur.length ? ' &nbsp;| ' + allDur.join(' / ') : ''}</div>`;
    if (pot.aplicacion?.length)
      h += '<br>💊 ' + pot.aplicacion.map(a => (getAplicOption(a)?.label ?? a)).join(', ');
    return h;
  }

  const parts = [];
  if (pot.description) parts.push(`<strong>Descripción:</strong> ${pot.description}`);
  if (pot.dicePool?.length) {
    let ds = pot.dicePool.map(d => `${d.count}d${d.sides}`).join('+');
    if (pot.flatBonus) ds += ` + ${pot.flatBonus}`;
    if (pot.statMod) ds += ` + mod.${pot.statMod}`;
    parts.push('🎲 Dados: ' + ds);
  } else if (pot.flatBonus) {
    parts.push('🎲 Bono fijo: ' + pot.flatBonus + (pot.statMod ? ` + mod.${pot.statMod}` : ''));
  }
  if (pot.damageType) parts.push(`🛡️ Tipo de daño: ${pot.damageType}`);
  if (pot.penaltyType) parts.push(`⬇️ Penalización: ${pot.penaltyType}${pot.penaltyValue ? ` (${pot.penaltyValue})` : ''}`);
  if (pot.durationInstant) parts.push('⚡ Duración: Instantánea');
  else if (pot.durationDice?.length) {
    let ds = pot.durationDice.map(d => `${d.count}d${d.sides}`).join('+');
    if (pot.durationFlat) ds += ` + ${pot.durationFlat}`;
    parts.push(`⏱️ Duración: ${ds} turno(s)`);
  } else if (pot.durationFlat) {
    parts.push(`⏱️ Duración: ${pot.durationFlat} turno(s)`);
  }
  if (pot.noPurificable) parts.push('🚫 No purificable');
  if (pot.aplicacion?.length)
    parts.push('💊 Aplicación: ' + pot.aplicacion.map(a => (getAplicOption(a)?.label ?? a)).join(', '));
  return parts.length ? parts.join('<br>') : '<em class="muted">Sin detalles adicionales.</em>';
}

export function renderInvPociones() {
  const el = document.getElementById('invPotList'); if (!el) return;
  let html = '', hasPots = false;
  for (const pk in state.potions) {
    const pot = state.potions[pk];
    if (!pot || pot.qty <= 0) continue;
    hasPots = true;
    const parsed = parsePotKey(pk);
    const purityN = parsed ? parsed.purity : 0;
    const purity = purityN > 0 ? purityRoman(purityN) : 'Sin purificar';
    const catKey = parsedToCatKey(parsed);
    const catInfo = state.potionCatalog[catKey] || {};
    const apodo = catInfo.apodo ? ` <em class="apodo-badge">"${catInfo.apodo}"</em>` : '';
    const cat = pot.category || '';
    const cc = cat === 'Salutífera' ? 'sal' : cat === 'Maliciosa' ? 'mal' : 'mag';
    const isSalMag = cat === 'Salutífera' || cat === 'Mágica';
    const actionLabel = isSalMag ? '🍵 Beber' : '⚔️ Aplicar';
    const aplicLabel = pot.aplicacion?.length
      ? ' [' + pot.aplicacion.map(a => (getAplicOption(a)?.label.split(' ')[0] ?? a)).join(', ') + ']'
      : '';
    const pkEsc = pk.replace(/[^a-z0-9]/gi, '_');
    html += `<div class="pot-card">
      <div class="pot-card-header">
        <div>
          <div class="pot-name">${pot.name || 'Poción'}${apodo}</div>
          <div class="pot-meta">${catBadge(cat)}${purityN > 0 ? ' Pureza ' + purity : ' Sin purificar'}${aplicLabel} · x${pot.qty}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-sm" data-action="use-pot" data-id="${pk}">${actionLabel}</button>
          <button class="btn btn-sm btn-edit" data-action="set-apodo" data-id="${pk}">🏷️</button>
          <button class="btn btn-sm btn-danger" data-action="del-pot" data-id="${pk}">🗑️</button>
          <button class="btn btn-sm btn-info" data-action="toggle-pot-detail" data-id="${pk}">ℹ️</button>
        </div>
      </div>
      <div class="mat-card-detail" id="potdetail_${pkEsc}" style="display:none">${buildPotDetail(pot)}</div>
    </div>`;
  }
  el.innerHTML = hasPots ? html : '<p class="muted">No tienes pociones. Ve a Crafteo para elaborar.</p>';
}

// ---- USE / APODO / DEL POTION ----
export function usePotion(pk) {
  const pot = state.potions[pk];
  if (!pot || pot.qty <= 0) return;
  const cat = pot.category || '';
  const isSalMag = cat === 'Salutífera' || cat === 'Mágica';
  const effectRoll = rollDice(pot.dicePool || []);
  const effectTotal = effectRoll + (pot.flatBonus || 0);
  const hasEffect = (pot.dicePool?.length ?? 0) > 0;
  const hasDur = !pot.durationInstant && ((pot.durationDice?.length ?? 0) > 0 || pot.durationFlat > 0);
  let durStr = '';
  if (pot.durationInstant) durStr = 'Instantánea';
  else if (hasDur) { const dr = rollDice(pot.durationDice || []); durStr = (dr + (pot.durationFlat || 0)) + ' turno(s)'; }

  let effectDesc = '';
  if (hasEffect) {
    const statStr = pot.statMod ? ` + mod.${pot.statMod}` : '';
    if (cat === 'Salutífera' && pot.subtipo === 'Vitalidad')
      effectDesc = `<p>❤️ Curación: <strong>${effectTotal}</strong>${statStr}</p>`;
    else if (cat === 'Maliciosa') {
      if (pot.subtipo === 'Dañina')
        effectDesc = `<p>⚔️ Daño: <strong>${effectTotal}</strong>${pot.damageType ? ` (${pot.damageType})` : ''}${statStr}</p>`;
      else if (pot.subtipo === 'Incapacitante')
        effectDesc = `<p>⬇️ Penalización: ${pot.penaltyType}${pot.penaltyValue ? ` (${pot.penaltyValue})` : ''}</p>`;
      else if (pot.subtipo === 'Debilitante')
        effectDesc = `<p>🛡️ Tipo de daño: ${pot.damageType || '???'}</p>`;
    } else {
      effectDesc = `<p>✨ Efecto: <strong>${effectTotal}</strong>${statStr}</p>`;
    }
  } else {
    if (pot.damageType) effectDesc = `<p>🛡️ Resistencia a: ${pot.damageType}</p>`;
    if (pot.penaltyType) effectDesc = `<p>⬇️ Penalización: ${pot.penaltyType}</p>`;
  }
  const durDesc = hasDur ? `<p>⏱️ Duración: <strong>${durStr}</strong></p>` : pot.durationInstant ? '<p>⚡ Instantánea</p>' : '';
  const desc = pot.description ? `<p class="muted-i">${pot.description}</p>` : '';

  document.getElementById('drinkResult').innerHTML =
    `<div class="result-box success"><div class="verdict">✅ ${isSalMag ? 'Bebida' : 'Aplicada'}: ${pot.name || 'esta poción'}</div>${desc}${effectDesc}${durDesc}</div>`;

  pot.qty--;
  if (pot.qty <= 0) delete state.potions[pk];
  saveState();
  renderInvPociones();
}

export function setApodo(pk) {
  const ck = parsedToCatKey(parsePotKey(pk));
  if (!ck) return;
  if (!state.potionCatalog[ck]) state.potionCatalog[ck] = { apodo: '' };
  const cur = state.potionCatalog[ck].apodo || '';
  const r = prompt('Apodo para esta poción (vacío = quitar):', cur);
  if (r != null) {
    state.potionCatalog[ck].apodo = r.trim();
    saveState();
    renderInvPociones();
    renderCatPociones();
  }
}

export function delPotion(pk) {
  if (!confirm('¿Eliminar toda la pila de esta poción?')) return;
  delete state.potions[pk];
  saveState();
  renderInvPociones();
}

// ---- LOOT ----
export function renderLoot() {
  const el = document.getElementById('lootPotList'); if (!el) return;
  const ids = Object.keys(state.lootPotions);
  if (!ids.length) { el.innerHTML = '<p class="muted">No hay pociones loot.</p>'; return; }
  el.innerHTML = ids.map(id => {
    const loot = state.lootPotions[id];
    const tipoLabel = loot.identificada
      ? `<span class="loot-tipo">${loot.tipo}</span>`
      : '<span class="loot-tipo" style="color:#888">Sin identificar</span>';
    return `<div class="loot-card">
      <div class="loot-card-header">
        <div>
          <div class="loot-name">${loot.name || 'Poción'}${loot.qty > 1 ? ` (x${loot.qty})` : ''}</div>
          ${tipoLabel}
        </div>
        <div style="display:flex;gap:4px">
          ${!loot.identificada
            ? `<button class="btn btn-sm btn-info" data-action="identify-loot" data-id="${id}">🔍 Inv. inversa</button>`
            : `<button class="btn btn-sm" data-action="use-loot" data-id="${id}">🧪 Usar</button>`}
          <button class="btn btn-sm btn-danger" data-action="del-loot" data-id="${id}">🗑️</button>
        </div>
      </div>
      <div style="margin-top:6px">
        <textarea rows="2" style="width:100%;font-size:.85em;border:1px solid #ccc;border-radius:4px;padding:4px;font-family:inherit"
          data-action="loot-desc" data-id="${id}">${loot.descripcion || ''}</textarea>
      </div>
    </div>`;
  }).join('');
}

// ---- CRAFTEO PANEL RENDERERS ----
export function renderElaboracion(craftSelectedBase, craftSelectedMods) {
  const baseList = [];
  for (const id in state.catalog) {
    if (state.catalog[id].type === 'Base' && (state.inventory[id] || 0) > 0)
      baseList.push({ id, m: state.catalog[id] });
  }

  const bEl = document.getElementById('craftBaseList');
  if (!baseList.length) {
    bEl.innerHTML = '<p class="muted">No tienes bases en el inventario.</p>';
    document.getElementById('craftModPanel').style.display = 'none';
    return;
  }
  bEl.innerHTML = baseList.map(item => {
    const picked = craftSelectedBase === item.id;
    return `<div class="craft-pot-row">
      <span>${item.m.unknown ? '???' : item.m.name} ${catBadge(item.m.category)} ${rarityBadge(item.m.rarity)} (x${state.inventory[item.id]})</span>
      <button class="btn btn-sm btn-pick${picked ? ' picked' : ''}" data-action="craft-pick-base" data-id="${item.id}">${picked ? '✅ Elegida' : 'Elegir'}</button>
    </div>`;
  }).join('');

  if (!craftSelectedBase) { document.getElementById('craftModPanel').style.display = 'none'; return; }
  const base = state.catalog[craftSelectedBase];
  document.getElementById('craftModPanel').style.display = 'block';
  if (base?.discriminante) { document.getElementById('craftModList').innerHTML = '<p class="muted-i">Base discriminante: sin modificadores.</p>'; return; }

  const modList = [];
  for (const mid in state.catalog) {
    if (state.catalog[mid].type === 'Modificador' && (state.inventory[mid] || 0) > 0)
      modList.push({ id: mid, m: state.catalog[mid] });
  }
  if (!modList.length) { document.getElementById('craftModList').innerHTML = '<p class="muted">No tienes modificadores en el inventario.</p>'; return; }

  document.getElementById('craftModList').innerHTML = modList.map(item => {
    const used = craftSelectedMods[item.id] || 0;
    const maxU = item.m.maxUses || 99;
    const baseUnique = base?.rarity === 'Única';
    const modUnique = item.m.rarity === 'Única';
    const otherModsPicked = Object.keys(craftSelectedMods).some(k => craftSelectedMods[k] > 0 && k !== item.id);
    const blocked = baseUnique || (modUnique && used === 0 && otherModsPicked);
    const canAdd = !blocked && used < maxU && used < (state.inventory[item.id] || 0);
    const blockedNote = baseUnique ? ' <span class="muted">(base única)</span>'
      : (modUnique && blocked) ? ' <span class="muted">(única: va sola)</span>' : '';
    return `<div class="mod-row">
      <span class="mod-label">${item.m.unknown ? '???' : item.m.name} ${rarityBadge(item.m.rarity)} dif:${item.m.difficulty >= 0 ? '+' : ''}${item.m.difficulty} (x${state.inventory[item.id]})${blockedNote}</span>
      <div class="stepper">
        <button class="btn btn-sm" data-action="craft-mod-dec" data-id="${item.id}" ${used <= 0 ? 'disabled' : ''}>−</button>
        <span class="count">${used}</span>
        <button class="btn btn-sm" data-action="craft-mod-inc" data-id="${item.id}" ${!canAdd ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }).join('');
}

export function renderPotPicker(el, craftPotionPicks) {
  if (!el) return;
  const pots = [];
  for (const pk in state.potions) if (state.potions[pk]?.qty > 0) pots.push({ pk, pot: state.potions[pk] });
  if (!pots.length) { el.innerHTML = '<p class="muted">No tienes pociones.</p>'; return; }
  el.innerHTML = pots.map(item => {
    const parsed = parsePotKey(item.pk);
    const purityN = parsed ? parsed.purity : 0;
    const purity = purityN > 0 ? purityRoman(purityN) : 'sin purif.';
    const pickCount = craftPotionPicks.filter(x => x === item.pk).length;
    const isPicked = pickCount > 0;
    const pickLabel = pickCount >= 2 ? '✅ ×2' : isPicked ? '✅ (1)' : 'Elegir';
    return `<div class="craft-pot-row">
      <span>${item.pot.name || 'Poción'} [${purityN > 0 ? 'Pureza ' + purity : 'sin purif.'}] (x${item.pot.qty}) ${catBadge(item.pot.category || '')}</span>
      <button class="btn btn-sm btn-pick${isPicked ? ' picked' : ''}" data-action="craft-pick-pot" data-id="${item.pk}">${pickLabel}</button>
    </div>`;
  }).join('');
}

// ---- FULL RE-RENDER (without crafteo — crafting.js owns that) ----
export function renderAll() {
  renderCatMateriales();
  renderCatPociones();
  renderInvMateriales();
  renderInvPociones();
  renderLoot();
}

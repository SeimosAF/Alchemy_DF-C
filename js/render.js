// render.js — all DOM rendering functions
import { state, saveState } from './state.js';
import { getAplicOption } from './utils.js';
import {
  rarityBadge, catBadge, campoBadge, campoClass, purityRoman,
  parsePotKey, parsedToCatKey, parseCatKey,
} from './utils.js';
import { CAMPOS, CAMPO_NAMES, EFFECT_KINDS, MOD_KIND_ICONS } from './data.js';
import {
  effectText, durationText, saveText, formatDice, rollPool, getDisolvente, modCompat, elabDC,
} from './model.js';

// ---- CAT MATERIALES ----
function buildMatDetail(m) {
  const parts = [];
  if (m.description) parts.push(`<strong>Descripción:</strong> ${m.description}`);
  const solv = getDisolvente(state.settings, m.campo);
  if (m.type === 'Reactivo') parts.push(`🫗 Disolvente: ${solv.name}`);
  if (m.type === 'Modificador') parts.push(`${MOD_KIND_ICONS[m.modKind] || '⚗️'} ${m.modKind || 'Otro'}`);
  (m.effects || []).forEach(e => parts.push(effectText(e)));
  if (m.type === 'Reactivo') {
    if (m.discriminante) parts.push('⚠️ Reactivo <em>discriminante</em>');
    if (m.noPurificable) parts.push('🚫 No purificable');
    const dt = durationText(m); if (dt) parts.push(dt);
    const sv = saveText(m); if (sv) parts.push(sv);
  }
  if (m.modKind === 'Potenciador' && (m.dicePool?.length || m.flatBonus))
    parts.push('🎲 Suma: ' + [formatDice(m.dicePool), m.flatBonus ? String(m.flatBonus) : '', m.statMod ? 'mod.' + m.statMod : ''].filter(Boolean).join(' + '));
  if (m.modKind === 'Prolongador') { const dt = durationText(m); if (dt) parts.push('Suma ' + dt); }
  if (m.modKind === 'Concentrador') parts.push(`🔻 Duración ÷${m.tradeFactor || 2}, +${m.tradeDice ?? 1} dado(s) al efecto principal`);
  if (m.modKind === 'Diluyente') parts.push(`💧 Duración ×${m.tradeFactor || 2}, −${m.tradeDice ?? 1} dado(s) al efecto principal`);
  if (m.type === 'Modificador' && m.maxUses) parts.push(`🔢 Máx usos por poción: ${m.maxUses}`);
  if (m.subtipo === 'Potenciador' && m.dieUpgrade) parts.push(`⬆️ Mejora tier de dado ×${m.dieUpgrade} paso(s) (d4→d6→…→d20)`);
  if (m.subtipo === 'Multiplicador') {
    if (m.effectMultiplier && m.effectMultiplier !== 1) {
      const tgt = m.effectTarget === 'total' ? 'total del efecto' : 'número de dados';
      parts.push(`✖️ Efecto ×${m.effectMultiplier} (sobre ${tgt})`);
    }
    if (m.durationMode === 'multiply' && m.durationModValue && m.durationModValue !== 1)
      parts.push(`✖️ Duración ×${m.durationModValue}`);
    if (m.durationMode === 'flat' && m.durationModValue)
      parts.push(`⏱️ +${m.durationModValue} turno(s) de duración`);
    if (m.distributeEffect) parts.push('📊 Distribuye el efecto por turnos');
  }
  if (m.subtipo === 'Alterador') {
    if (m.changeDamageType) parts.push(`🔄 Cambia tipo de daño → ${m.changeDamageType}`);
    if (m.addSecondaryEffect) parts.push(`✨ Efecto secundario: ${m.addSecondaryEffect}`);
  }
  if (m.subtipo === 'Esencial') parts.push('✨ Define el efecto mágico de la poción (Mágica)');
  if (m.subtipo === 'Invertidor') parts.push('🔃 Invierte el efecto de la poción mágica');
  return parts.length ? parts.join('<br>') : '<em class="muted">Sin detalles adicionales.</em>';
}

function makeUnknownCard(id, m, deletePendingId) {
  const isPending = deletePendingId === id;
  const delHtml = isPending
    ? `<button class="btn btn-sm btn-danger" data-action="delete-mat" data-id="${id}">⚠️ Confirmar</button>
       <button class="btn btn-sm" style="background:#777" data-action="cancel-delete">✖</button>`
    : `<button class="btn btn-sm btn-danger" data-action="delete-mat" data-id="${id}">🗑️</button>`;
  const lugar = m.lugar || 'Desconocido';
  const div = document.createElement('div');
  div.className = 'mat-card';
  div.innerHTML = `
    <div class="mat-card-header">
      <div>
        <div class="mat-card-title">${m.name || '(Sin nombre)'}</div>
        <div class="mat-card-meta">
          <span class="badge" style="background:#555;color:#ddd">Sin identificar</span>
          ${rarityBadge(m.rarity)}
          · 📍 ${lugar}
        </div>
      </div>
      <div class="mat-card-actions">
        <button class="btn btn-sm btn-edit" data-action="edit-mat" data-id="${id}">✏️</button>
        ${delHtml}
      </div>
    </div>`;
  return div;
}

function makeMatCard(id, m, deletePendingId) {
  const dn = m.name;
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
          ${catBadge(m.campo, m.polaridad)}
          <span class="badge badge-${m.type === 'Reactivo' ? 'base' : 'mod'}">${m.type}</span>
          ${m.modKind ? `<span class="badge badge-sub">${m.modKind}</span>` : ''}
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
  const bases = [], mods = [], unknowns = [];
  for (const id in state.catalog) {
<<<<<<< Updated upstream
    (state.catalog[id].type === 'Reactivo' ? bases : mods).push({ id, m: state.catalog[id] });
=======
    const m = state.catalog[id];
    if (m.unknown) unknowns.push({ id, m });
    else if (m.type === 'Base') bases.push({ id, m });
    else mods.push({ id, m });
>>>>>>> Stashed changes
  }
  const bEl = document.getElementById('catBaseList');
  const mEl = document.getElementById('catModList');
  const uEl = document.getElementById('catUnknownList');
  if (!bEl || !mEl) return;
  if (!bases.length) bEl.innerHTML = '<p class="muted">No hay reactivos registrados.</p>';
  else { bEl.innerHTML = ''; bases.forEach(x => bEl.appendChild(makeMatCard(x.id, x.m, deletePendingId))); }
  if (!mods.length) mEl.innerHTML = '<p class="muted">No hay modificadores registrados.</p>';
  else { mEl.innerHTML = ''; mods.forEach(x => mEl.appendChild(makeMatCard(x.id, x.m, deletePendingId))); }
  if (uEl) {
    if (!unknowns.length) uEl.innerHTML = '<p class="muted">No hay materiales sin identificar.</p>';
    else { uEl.innerHTML = ''; unknowns.forEach(x => uEl.appendChild(makeUnknownCard(x.id, x.m, deletePendingId))); }
  }
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
    const cat = base.campo || 'Mágico';
    const sub = base.polaridad || '(Sin polaridad)';
    if (!groups[cat]) groups[cat] = {};
    if (!groups[cat][sub]) groups[cat][sub] = [];
    groups[cat][sub].push({ ck, parsed, base });
  });

  let html = '';
  CAMPO_NAMES.forEach(cat => {
    if (!groups[cat]) return;
    const solv = getDisolvente(state.settings, cat);
    html += `<div class="pot-cat-group"><div class="pot-cat-title">${campoBadge(cat)} <span class="muted">· ${solv.name}</span></div>`;
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
    const cc = campoClass(m.campo);
    return `<div class="inv-row">
      <div class="inv-name"><span class="badge badge-${cc}" style="margin-right:4px" title="${m.type} · ${m.campo}">${m.type[0]}</span>${dn} ${rarityBadge(m.rarity)}</div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-action="inv-dec" data-id="${id}">−</button>
        <span class="stepper-count">${qty}</span>
        <button class="btn btn-sm" data-action="inv-inc" data-id="${id}">+</button>
      </div>
    </div>`;
  }).join('');
}

// ---- INV POCIONES ----
export function buildPotDetail(pot) {
  const aplic = pot.aplicacion?.length
    ? '💊 Aplicación: ' + pot.aplicacion.map(a => (getAplicOption(a)?.label ?? a)).join(', ') : '';
  if (pot.isMulti && pot.components?.length) {
    let h = '<table class="multi-detail-table"><thead><tr><th>Componente</th><th>Efecto</th><th>Duración</th></tr></thead><tbody>';
    pot.components.forEach(c => {
      const eff = (c.effects || []).map(effectText).join('<br>') || '—';
      h += `<tr><td><strong>${c.name}</strong> ${catBadge(c.campo, c.polaridad)}</td><td>${eff}</td><td>${durationText(c) || '—'}</td></tr>`;
    });
    h += '</tbody></table>';
    const sv = pot.components.map(saveText).filter(Boolean);
    if (sv.length) h += sv.join('<br>') + '<br>';
    if (aplic) h += aplic;
    return h;
  }
  const parts = [];
  if (pot.description) parts.push(`<strong>Descripción:</strong> ${pot.description}`);
<<<<<<< Updated upstream
  if (pot.disolvente) parts.push(`🫗 Disolvente: ${pot.disolvente}`);
  (pot.effects || []).forEach(e => parts.push(effectText(e)));
  const dt = durationText(pot); if (dt) parts.push(dt);
  const sv = saveText(pot); if (sv) parts.push(sv);
=======
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
  if (pot.effectTotalMultiplier && pot.effectTotalMultiplier !== 1)
    parts.push(`✖️ Total del efecto ×${pot.effectTotalMultiplier} (se aplica al usar)`);
  if (pot.isDistributed) parts.push('📊 Efecto distribuido por turno');
  if (pot.secondaryEffect) parts.push(`✨ Efecto secundario: ${pot.secondaryEffect}`);
  if (pot.isInverted) {
    parts.push('🔃 <strong>Poción invertida</strong>');
    if (pot.invertedEffect) parts.push(`↩️ Efecto invertido: ${pot.invertedEffect}`);
  }
>>>>>>> Stashed changes
  if (pot.noPurificable) parts.push('🚫 No purificable');
  if (aplic) parts.push(aplic);
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
    const isBenef = pot.polaridad !== 'Maleficioso';
    const actionLabel = isBenef ? '🍵 Beber' : '⚔️ Aplicar';
    const aplicLabel = pot.aplicacion?.length
      ? ' [' + pot.aplicacion.map(a => (getAplicOption(a)?.label.split(' ')[0] ?? a)).join(', ') + ']'
      : '';
    const pkEsc = pk.replace(/[^a-z0-9]/gi, '_');
    html += `<div class="pot-card">
      <div class="pot-card-header">
        <div>
          <div class="pot-name">${pot.name || 'Poción'}${apodo}</div>
          <div class="pot-meta">${catBadge(pot.campo, pot.polaridad)}${purityN > 0 ? ' Pureza ' + purity : ' Sin purificar'}${aplicLabel} · x${pot.qty}</div>
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
function rollEffectLine(e, mult) {
  const k = EFFECT_KINDS[e.kind] || { icon: '•', label: e.kind };
  const hasAmount = e.dice?.length || e.flat;
  if (!hasAmount) return `<p>${effectText(e)}</p>`;
  const r = rollPool(e.dice) + (e.flat || 0);
  const statStr = e.statMod ? ` + mod.${e.statMod}` : '';
  const what = {
    curacion: 'Curación', pgTemp: 'PG temporales', dano: 'Daño', danoContinuo: 'Daño por turno', especial: e.text || 'Efecto',
  }[e.kind] || k.label;
  const dmg = e.damageType ? ` (${e.damageType})` : '';
  return `<p>${k.icon} ${what}: <strong>${r}</strong>${statStr}${dmg} <span class="muted">[${formatDice(e.dice)}${e.flat ? '+' + e.flat : ''}]</span></p>`;
}

function rollDuration(p) {
  if (p.durationInstant) return '<p>⚡ Instantánea</p>';
  if (!(p.durationDice?.length || p.durationFlat)) return '';
  const raw = rollPool(p.durationDice) + (p.durationFlat || 0);
  const mult = p.durationMult || 1;
  const tot = Math.max(1, Math.floor(raw * mult));
  return `<p>⏱️ Duración: <strong>${tot} turno(s)</strong>${mult !== 1 ? ` <span class="muted">(${raw} × ${mult})</span>` : ''}</p>`;
}

export function usePotion(pk) {
  const pot = state.potions[pk];
  if (!pot || pot.qty <= 0) return;
<<<<<<< Updated upstream
  const isBenef = pot.polaridad !== 'Maleficioso';
  let body = '';
  const blocks = pot.isMulti && pot.components?.length ? pot.components : [pot];
  blocks.forEach(b => {
    if (blocks.length > 1) body += `<p><strong>${b.name}</strong></p>`;
    (b.effects || []).forEach(e => { body += rollEffectLine(e, b.durationMult); });
    body += rollDuration(b);
    const sv = saveText({ ...b, craftDC: b.craftDC || pot.craftDC });
    if (sv) body += `<p>${sv}</p>`;
  });
=======
  const cat = pot.category || '';
  const isSalMag = cat === 'Salutífera' || cat === 'Mágica';
  const effectRoll = rollDice(pot.dicePool || []);
  const effectTotal = Math.round((effectRoll + (pot.flatBonus || 0)) * (pot.effectTotalMultiplier || 1));
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
>>>>>>> Stashed changes
  const desc = pot.description ? `<p class="muted-i">${pot.description}</p>` : '';

  document.getElementById('drinkResult').innerHTML =
    `<div class="result-box success"><div class="verdict">✅ ${isBenef ? 'Bebida' : 'Aplicada'}: ${pot.name || 'esta poción'}</div>${desc}${body}</div>`;

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
    if (state.catalog[id].type === 'Reactivo' && (state.inventory[id] || 0) > 0)
      baseList.push({ id, m: state.catalog[id] });
  }

  const bEl = document.getElementById('craftBaseList');
  if (!baseList.length) {
    bEl.innerHTML = '<p class="muted">No tienes reactivos en el inventario.</p>';
    document.getElementById('craftModPanel').style.display = 'none';
    return;
  }
  bEl.innerHTML = baseList.map(item => {
    const picked = craftSelectedBase === item.id;
    const solv = getDisolvente(state.settings, item.m.campo);
    return `<div class="craft-pot-row">
      <span>${item.m.unknown ? '???' : item.m.name} ${catBadge(item.m.campo, item.m.polaridad)} ${rarityBadge(item.m.rarity)} <span class="muted">· ${solv.name}</span> (x${state.inventory[item.id]})</span>
      <button class="btn btn-sm btn-pick${picked ? ' picked' : ''}" data-action="craft-pick-base" data-id="${item.id}">${picked ? '✅ Elegido' : 'Elegir'}</button>
    </div>`;
  }).join('');

  if (!craftSelectedBase) { document.getElementById('craftModPanel').style.display = 'none'; return; }
  const base = state.catalog[craftSelectedBase];
  document.getElementById('craftModPanel').style.display = 'block';
  if (base?.discriminante) { document.getElementById('craftModList').innerHTML = '<p class="muted-i">Reactivo discriminante: sin modificadores.</p>'; return; }
  if (base?.campo === 'Mágico') { document.getElementById('craftModList').innerHTML = '<p class="muted-i">Las pociones mágicas no admiten modificadores.</p>'; return; }

  const isMagica = base?.category === 'Mágica';
  const MAGICA_SUBS    = new Set(['Prolongador', 'Esencial', 'Invertidor', 'Alterador']);
  const MAG_ONLY_SUBS  = new Set(['Esencial', 'Invertidor']); // solo disponibles para Mágica
  const modList = [];
  for (const mid in state.catalog) {
    if (state.catalog[mid].type !== 'Modificador' || (state.inventory[mid] || 0) <= 0) continue;
    const msub = state.catalog[mid].subtipo || '';
    if (isMagica  && !MAGICA_SUBS.has(msub))   continue; // Mágica: solo sus 4 subtipos
    if (!isMagica && MAG_ONLY_SUBS.has(msub))  continue; // no-Mágica: sin Esencial ni Invertidor
    modList.push({ id: mid, m: state.catalog[mid] });
  }
  if (!modList.length) { document.getElementById('craftModList').innerHTML = '<p class="muted">No tienes modificadores en el inventario.</p>'; return; }

  document.getElementById('craftModList').innerHTML = modList.map(item => {
    const used = craftSelectedMods[item.id] || 0;
    const maxU = item.m.maxUses || 99;
    const compat = modCompat(base, item.m, state.settings);
    const baseUnique = base?.rarity === 'Única';
    const modUnique = item.m.rarity === 'Única';
    const otherModsPicked = Object.keys(craftSelectedMods).some(k => craftSelectedMods[k] > 0 && k !== item.id);
    const blocked = !compat.ok || baseUnique || (modUnique && used === 0 && otherModsPicked);
    const canAdd = !blocked && used < maxU && used < (state.inventory[item.id] || 0);
    const blockedNote = !compat.ok ? ` <span class="muted">(no compatible: ${compat.reason})</span>`
      : baseUnique ? ' <span class="muted">(reactivo único)</span>'
      : (modUnique && blocked) ? ' <span class="muted">(única: va sola)</span>'
      : compat.extraDiff ? ` <span class="muted">(polaridad contraria: +${compat.extraDiff} CD)</span>` : '';
    return `<div class="mod-row${compat.ok ? '' : ' mod-row-off'}">
      <span class="mod-label">${MOD_KIND_ICONS[item.m.modKind] || ''} ${item.m.unknown ? '???' : item.m.name} ${campoBadge(item.m.campo)} ${rarityBadge(item.m.rarity)} dif:${item.m.difficulty >= 0 ? '+' : ''}${item.m.difficulty} (x${state.inventory[item.id]})${blockedNote}</span>
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
  let magicHidden = 0;
  for (const pk in state.potions) {
    const p = state.potions[pk];
    if (!(p?.qty > 0)) continue;
    if (p.campo === 'Mágico') { magicHidden++; continue; }
    pots.push({ pk, pot: p });
  }
  const note = magicHidden ? `<p class="muted-i">Las pociones mágicas no se pueden concentrar ni combinar (${magicHidden} oculta${magicHidden > 1 ? 's' : ''}).</p>` : '';
  if (!pots.length) { el.innerHTML = '<p class="muted">No tienes pociones que se puedan usar aquí.</p>' + note; return; }
  el.innerHTML = pots.map(item => {
    const parsed = parsePotKey(item.pk);
    const purityN = parsed ? parsed.purity : 0;
    const purity = purityN > 0 ? purityRoman(purityN) : 'sin purif.';
    const pickCount = craftPotionPicks.filter(x => x === item.pk).length;
    const isPicked = pickCount > 0;
    const pickLabel = pickCount >= 2 ? '✅ ×2' : isPicked ? '✅ (1)' : 'Elegir';
    return `<div class="craft-pot-row">
      <span>${item.pot.name || 'Poción'} [${purityN > 0 ? 'Pureza ' + purity : 'sin purif.'}] (x${item.pot.qty}) ${catBadge(item.pot.campo, item.pot.polaridad)}</span>
      <button class="btn btn-sm btn-pick${isPicked ? ' picked' : ''}" data-action="craft-pick-pot" data-id="${item.pk}">${pickLabel}</button>
    </div>`;
  }).join('') + note;
}

// ---- PARÁMETROS ----
export function renderSettings() {
  const el = document.getElementById('settingsPanel'); if (!el) return;
  const st = state.settings;
  el.innerHTML = `<table class="settings-table">
    <thead><tr><th>Campo</th><th>Características</th><th>Disolvente</th><th>CD</th></tr></thead>
    <tbody>${CAMPO_NAMES.map(c => {
      const d = st.disolventes[c];
      const stats = CAMPOS[c].stats.length === 6 ? 'Todas' : CAMPOS[c].stats.join(', ');
      return `<tr><td>${campoBadge(c)}</td><td class="muted">${stats}</td>
        <td><input type="text" data-setting="solvName" data-campo="${c}" value="${d.name}"></td>
        <td><input type="number" data-setting="solvDiff" data-campo="${c}" value="${d.difficulty}" style="width:60px"></td></tr>`;
    }).join('')}</tbody></table>
    <div class="form-row-2" style="margin-top:12px">
      <div class="form-row"><label>Modificador de polaridad contraria (+CD)</label>
        <input type="number" data-setting="polaridadOpuestaDiff" value="${st.polaridadOpuestaDiff}" style="width:70px"></div>
      <div class="form-row"><label>Multipoción con disolventes distintos (+CD)</label>
        <input type="number" data-setting="multiDisolventeDiff" value="${st.multiDisolventeDiff}" style="width:70px"></div>
    </div>`;
}

export function onSettingChange(inp) {
  const st = state.settings;
  const k = inp.dataset.setting, c = inp.dataset.campo;
  if (k === 'solvName') st.disolventes[c].name = inp.value.trim() || st.disolventes[c].name;
  else if (k === 'solvDiff') st.disolventes[c].difficulty = parseInt(inp.value) || 0;
  else st[k] = parseInt(inp.value) || 0;
  saveState();
}

// ---- FULL RE-RENDER (without crafteo — crafting.js owns that) ----
export function renderAll() {
  renderCatMateriales();
  renderCatPociones();
  renderInvMateriales();
  renderInvPociones();
  renderLoot();
}

// render.js — all DOM rendering functions
import { state, saveState } from './state.js';
import { getAplicOption, nombreMat, notaSinIdentificar, repintarInventario } from './utils.js';
import {
  rarityBadge, catBadge, campoBadge, campoClass, purityRoman,
  parsePotKey, parsedToCatKey, parseCatKey,
} from './utils.js';
import { CAMPOS, CAMPO_NAMES, EFFECT_KINDS, MOD_KIND_ICONS } from './data.js';
import * as niveles from './niveles.js';
import * as auth from './auth.js';
import * as filtros from './filtros.js';
import * as odres from './odres.js';
import { infoOculta, descubierto, veTodo, sinDar, quienesLoConocen } from './conocimiento.js';
import {
  effectText, durationText, saveText, formatDice, rollPool, getDisolvente, modCompat, elabDC, hasMaleficio,
} from './model.js';

// Alquimia → Materiales: el DM puede filtrar los que aún no ha dado a nadie y los desconocidos
filtros.grupo('cat-mat', 'dm', [['', 'Todos', 'solo-dm'], ['sin-dar', '🆕 Sin dar a nadie', 'solo-dm chip-sin-dar'], ['oculto', '🙈 Desconocidos', 'solo-dm']]);

// Distintivos que solo ve el DM: aún no lo tiene ningún jugador / los jugadores no saben qué hace
function marcasDM(id, m) {
  if (!(veTodo() && auth.servidor)) return m.unknown ? '<span class="badge badge-oculto" title="Marcado como desconocido">🙈 Desconocido</span>' : '';
  const n = quienesLoConocen(id).length;
  return (n ? `<span class="badge badge-conocido" title="Jugadores que lo han recibido alguna vez">👥 Lo conocen ${n}</span>
      <button class="btn btn-sm btn-renovar" data-action="mat-renovar" data-id="${id}"
        title="Vuelve a ser nuevo: desaparece del catálogo de los jugadores hasta que se lo vuelvas a dar">🆕 Volver a nuevo</button>`
            : '<span class="badge badge-sin-dar" title="Ningún jugador lo ha recibido todavía: no sale en su catálogo">🆕 Sin dar a nadie</span>')
    + (m.unknown ? ' <span class="badge badge-oculto" title="Los jugadores ven el nombre y el lugar, pero no qué hace">🙈 Desconocido para los jugadores</span>' : '');
}
// Sin servidor no hay DM que reparta: los materiales se suman al inventario desde el catálogo
const stepLocal = id => auth.servidor ? '' : `<span class="inv-stepper mat-card-stepper" title="En tu inventario">
    <button class="btn btn-sm" data-action="inv-dec" data-id="${id}" ${(state.inventory[id] || 0) ? '' : 'disabled'}>−</button>
    <span class="stepper-count">${state.inventory[id] || 0}</span>
    <button class="btn btn-sm" data-action="inv-inc" data-id="${id}">+</button></span>`;
const enInv = id => (state.inventory[id] || 0) > 0 ? ` · <span class="mat-tengo">🎒 tienes ${state.inventory[id]}</span>` : '';

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
  if (m.modKind === 'Potenciador' && m.dieUpgrade) parts.push(`⬆️ Mejora el dado ${m.dieUpgrade} paso(s) (d4→d6→…→d20)`);
  if (m.modKind === 'Multiplicador') {
    if (m.effectMultiplier && m.effectMultiplier !== 1)
      parts.push(`✖️ Efecto ×${m.effectMultiplier} (sobre ${m.effectTarget === 'total' ? 'el total' : 'el número de dados'})`);
    if (m.durationMode === 'multiply' && m.durationModValue && m.durationModValue !== 1) parts.push(`✖️ Duración ×${m.durationModValue}`);
    if (m.durationMode === 'flat' && m.durationModValue) parts.push(`⏱️ +${m.durationModValue} turno(s) de duración`);
    if (m.distributeEffect) parts.push('📊 Distribuye el efecto entre los turnos');
  }
  if (m.modKind === 'Alterador') {
    if (m.changeDamageType) parts.push(`🔄 Cambia el tipo de daño a ${m.changeDamageType}`);
    if (m.addSecondaryEffect) parts.push(`✨ Efecto secundario: ${m.addSecondaryEffect}`);
  }
  if (m.modKind === 'Esencial') { const dt = durationText(m); parts.push('💠 Define el efecto mágico' + (dt ? ' · ' + dt : '')); }
  if (m.modKind === 'Invertidor') parts.push('🔃 Invierte el efecto de la poción mágica');
  if (m.type === 'Modificador' && m.maxUses) parts.push(`🔢 Máx usos por poción: ${m.maxUses}`);
  return parts.length ? parts.join('<br>') : '<em class="muted">Sin detalles adicionales.</em>';
}

function makeUnknownCard(id, m, deletePendingId) {
  const isPending = deletePendingId === id;
  const delHtml = isPending
    ? `<button class="btn btn-sm btn-danger solo-dm-o-local" data-action="delete-mat" data-id="${id}">⚠️ Confirmar</button>
       <button class="btn btn-sm" style="background:#777" data-action="cancel-delete">✖</button>`
    : `<button class="btn btn-sm btn-danger solo-dm-o-local" data-action="delete-mat" data-id="${id}" title="Borrar del catálogo (solo DM)">🗑️</button>`;
  const div = document.createElement('div');
  div.className = 'mat-card';
  div.innerHTML = `
    <div class="mat-card-header">
      <div>
        <div class="mat-card-title">${m.name || '(Sin nombre)'}</div>
        <div class="mat-card-meta">
          <span class="badge" style="background:#555;color:#ddd">❔ Sin identificar</span>
          ${rarityBadge(m.rarity)} · 📍 ${m.lugar || 'Desconocido'}${enInv(id)}
        </div>
        <div class="muted mat-card-nota">Aún no sabes qué hace: el DM te lo dará a conocer.</div>
      </div>
      <div class="mat-card-actions">
        <button class="btn btn-sm btn-edit solo-dm-o-local" data-action="edit-mat" data-id="${id}" title="Editar o identificar (solo DM)">✏️</button>
        ${delHtml}
      </div>
    </div>`;
  return div;
}

function makeMatCard(id, m, deletePendingId) {
  const dn = nombreMat(m);
  const lugar = m.lugar || '???';
  const isPending = deletePendingId === id;
  const delHtml = isPending
    ? `<button class="btn btn-sm btn-danger solo-dm-o-local" data-action="delete-mat" data-id="${id}">⚠️ Confirmar</button>
       <button class="btn btn-sm" style="background:#777" data-action="cancel-delete">✖</button>`
    : `<button class="btn btn-sm btn-danger solo-dm-o-local" data-action="delete-mat" data-id="${id}" title="Borrar del catálogo (solo DM)">🗑️</button>`;

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
          · 📍 ${lugar} · Dif: ${m.difficulty >= 0 ? '+' : ''}${m.difficulty}${enInv(id)}
        </div>
        ${marcasDM(id, m) ? `<div class="mat-card-marcas">${marcasDM(id, m)}</div>` : ''}
      </div>
      <div class="mat-card-actions">
        ${stepLocal(id)}
        <button class="btn btn-sm btn-info" data-action="toggle-mat-detail" data-id="${id}">ℹ️</button>
        <button class="btn btn-sm btn-edit solo-dm-o-local" data-action="edit-mat" data-id="${id}" title="Editar o identificar (solo DM)">✏️</button>
        ${delHtml}
      </div>
    </div>
    <div class="mat-card-detail" id="matdetail_${id}" style="display:none">${buildMatDetail(m)}</div>`;
  return div;
}

// Texto en el que busca el buscador de un material (nombre, lugar, tipo, campo...)
function textoMat(m) {
  return infoOculta(m) ? [m.name, m.lugar, m.type, 'sin identificar']
    : [m.name, m.lugar, m.type, m.modKind, m.campo, m.polaridad, m.rarity, m.description, m.unknown ? 'desconocido' : ''];
}
function matPasa(lista, m, id) {
  const e = filtros.estado(lista);
  if (e.dm === 'sin-dar' && !sinDar(id)) return false;
  if (e.dm === 'oculto' && !m.unknown) return false;
  const campoOk = e.campo === 'sin-id' ? !!m.unknown : filtros.campoOk(lista, m.campo, infoOculta(m));
  return filtros.coincide(lista, ...textoMat(m), veTodo() && sinDar(id) ? 'sin dar nuevo' : '')
    && campoOk
    && (!e.tipo || m.type === e.tipo);
}

export function renderCatMateriales(deletePendingId = null) {
  const bases = [], mods = [], unknowns = [];
  // Cada jugador ve solo los materiales que ha recibido alguna vez (el DM, todos)
  const conocidos = Object.keys(state.catalog).filter(descubierto);
  const total = conocidos.length;
  for (const id of conocidos) {
    const m = state.catalog[id];
    if (!matPasa('cat-mat', m, id)) continue;
    if (m.unknown) unknowns.push({ id, m });
    else (m.type === 'Reactivo' ? bases : mods).push({ id, m });
  }
  const orden = (a, b) => nombreMat(a.m).localeCompare(nombreMat(b.m), 'es');
  bases.sort(orden); mods.sort(orden); unknowns.sort(orden);
  const tit = document.getElementById('catUnknownTitulo');
  if (tit) tit.textContent = veTodo() ? '🙈 Desconocidos para los jugadores' : '❓ Sin identificar';
  const nadaTotal = document.getElementById('catMatNada');
  filtros.cuenta('cat-mat', bases.length + mods.length + unknowns.length, total);
  const filtrando = filtros.activo('cat-mat');
  // Con filtro, las secciones que se quedan vacías se esconden
  for (const [id, n] of [['catUnknownList', unknowns.length], ['catBaseList', bases.length], ['catModList', mods.length]])
    document.getElementById(id)?.closest('.panel')?.toggleAttribute('hidden', filtrando && !n);
  const nadaEl = nadaTotal;
  if (nadaEl) nadaEl.innerHTML = !total
    ? `<p class="muted">${veTodo() ? 'Todavía no hay materiales. Dalos de alta en «➕ Alta de materiales».' : 'Aún no conoces ningún material. Cuando el DM te dé uno, aparecerá aquí.'}</p>`
    : filtrando && !(bases.length + mods.length + unknowns.length) ? filtros.vacio('cat-mat') : '';
  if (!total) for (const id of ['catUnknownList', 'catBaseList', 'catModList']) document.getElementById(id)?.closest('.panel')?.setAttribute('hidden', '');
  const uEl = document.getElementById('catUnknownList');
  if (uEl) {
    if (!unknowns.length) uEl.innerHTML = '<p class="muted">No hay materiales sin identificar.</p>';
    else { uEl.innerHTML = ''; unknowns.forEach(x => uEl.appendChild(infoOculta(x.m) ? makeUnknownCard(x.id, x.m, deletePendingId) : makeMatCard(x.id, x.m, deletePendingId))); }
    // Para los jugadores, la sección de «sin identificar» solo sale si hay alguno
    if (!veTodo() && !unknowns.length) uEl.closest('.panel')?.setAttribute('hidden', '');
  }
  const bEl = document.getElementById('catBaseList');
  const mEl = document.getElementById('catModList');
  if (!bEl || !mEl) return;
  if (!bases.length) bEl.innerHTML = '<p class="muted">No hay reactivos registrados.</p>';
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
  let vistos = 0;
  catKeys.forEach(ck => {
    const parsed = parseCatKey(ck); if (!parsed) return;
    const base = state.catalog[parsed.baseId]; if (!base) return;
    // Solo las recetas cuyos materiales conoces (y sabes qué hacen)
    const ids = [parsed.baseId, ...(parsed.mods || '').split(',').filter(Boolean)];
    if (ids.some(mid => !state.catalog[mid] || !descubierto(mid) || infoOculta(state.catalog[mid]))) return;
    const cat = base.campo || 'Mágico';
    const mods = (parsed.mods || '').split(',').filter(Boolean).map(mid => state.catalog[mid]?.name);
    if (!filtros.coincide('cat-pot', base.name, state.potionCatalog[ck]?.apodo, base.polaridad, cat, ...mods)
      || !filtros.campoOk('cat-pot', cat)) return;
    vistos++;
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
        const bn = nombreMat(item.base);
        const modNames = (item.parsed.mods || '').split(',')
          .filter(Boolean)
          .map(mid => state.catalog[mid] ? nombreMat(state.catalog[mid]) : null)
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
  filtros.cuenta('cat-pot', vistos, catKeys.length);
  el.innerHTML = html || (filtros.activo('cat-pot') ? filtros.vacio('cat-pot') : '<p class="muted">Sin resultados.</p>');
}

// ---- INV MATERIALES ----
// Cada fila dice en claro qué es: un sello con el icono y el color de su campo
// (💪 Cuerpo, 🧠 Mente, 👻 Alma, ✨ Mágico, ❔ sin identificar) y etiquetas legibles.
const escR = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// «generico»: quien no es alquimista solo ve «Material alquímico». «extra»: botones de más (🤝 Dar).
export function filaMaterial(id, m, qty, { generico = false, extra = '' } = {}) {
  const sinId = infoOculta(m) || generico;
  const cc = sinId ? 'sin-id' : campoClass(m.campo);   // sin identificar: no se delata su campo
  const icono = generico ? '⚗️' : sinId ? '❔' : (CAMPOS[m.campo]?.icon || '✨');
  const tipo = m.type === 'Reactivo' ? '🌿 Reactivo' : `🧪 Modificador${m.modKind && !sinId ? ' · ' + escR(m.modKind) : ''}`;
  const pol = !sinId && m.polaridad
    ? `<span class="etq etq-${m.polaridad === 'Maleficioso' ? 'malef' : m.polaridad === 'Neutro' ? 'neutro' : 'benef'}">${m.polaridad === 'Maleficioso' ? '☠️' : m.polaridad === 'Neutro' ? '⚖️' : '💚'} ${escR(m.polaridad)}</span>` : '';
  const etqs = generico
    ? '<span class="etq">⚗️ Para alquimistas</span>'
    : sinId
    ? `<span class="etq">${tipo}</span><span class="etq etq-sin-id">❔ Sin identificar</span>${m.lugar ? `<span class="etq">📍 ${escR(m.lugar)}</span>` : ''}`
    : `<span class="etq">${tipo}</span><span class="etq etq-${cc}">${icono} ${escR(m.campo)}</span>${pol}`;
  const nombre = generico ? 'Material alquímico' : escR(nombreMat(m)) + (m.rarity ? ' ' + rarityBadge(m.rarity) : '');
  return `<div class="inv-item inv-${cc}${qty ? '' : ' inv-vacio'}">
      <span class="inv-sello" title="${generico ? 'Material alquímico' : sinId ? 'Sin identificar' : 'Campo: ' + escR(m.campo)}">${icono}</span>
      <div class="inv-info">
        <div class="inv-nombre">${nombre}</div>
        <div class="inv-etiquetas">${etqs}</div>
      </div>
      <div class="inv-stepper">
        <button class="btn btn-sm" data-action="inv-dec" data-id="${id}" aria-label="Quitar uno" title="Quitar uno" ${qty ? '' : 'disabled'}>−</button>
        <span class="stepper-count" title="Cantidad">${qty}</span>
        ${generico ? '' : `<button class="btn btn-sm" data-action="inv-inc" data-id="${id}" aria-label="Añadir uno" title="Añadir uno">+</button>`}
        ${extra}
      </div>
    </div>`;
}

export function renderInvMateriales() { repintarInventario(); }

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
  if (pot.disolvente) parts.push(`🫗 Disolvente: ${pot.disolvente}`);
  (pot.effects || []).forEach(e => parts.push(effectText(e)));
  const dt = durationText(pot); if (dt) parts.push(dt);
  const sv = saveText(pot); if (sv) parts.push(sv);
  if (pot.effectTotalMultiplier && pot.effectTotalMultiplier !== 1)
    parts.push(`✖️ Total del efecto ×${pot.effectTotalMultiplier} (se aplica al usar)`);
  if (pot.isDistributed) parts.push('📊 Efecto distribuido entre los turnos');
  if (pot.isInverted) parts.push('🔃 <strong>Poción invertida</strong>' + (pot.invertedEffect ? `: ${pot.invertedEffect}` : ''));
  if (pot.noPurificable) parts.push('🚫 No purificable');
  if (aplic) parts.push(aplic);
  return parts.length ? parts.join('<br>') : '<em class="muted">Sin detalles adicionales.</em>';
}

export function renderInvPociones() { repintarInventario(); }

// ---- USE / APODO / DEL POTION ----
function rollEffectLine(e, totalMult) {
  const k = EFFECT_KINDS[e.kind] || { icon: '•', label: e.kind };
  const hasAmount = e.dice?.length || e.flat;
  if (!hasAmount) return `<p>${effectText(e)}</p>`;
  const r = Math.round((rollPool(e.dice) + (e.flat || 0)) * (totalMult || 1));
  const statStr = e.statMod ? ` + mod.${e.statMod}` : '';
  const what = {
    curacion: 'Curación', pgTemp: 'PG temporales', dano: 'Daño', danoContinuo: 'Daño por turno', especial: e.text || 'Efecto',
  }[e.kind] || k.label;
  const dmg = e.damageType ? ` (${e.damageType})` : '';
  return `<p>${k.icon} ${what}: <strong>${r}</strong>${statStr}${dmg} <span class="muted">[${formatDice(e.dice)}${e.flat ? '+' + e.flat : ''}${totalMult && totalMult !== 1 ? ' ×' + totalMult : ''}]</span></p>`;
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
  const isBenef = pot.polaridad === 'Neutro' ? !hasMaleficio(pot.isMulti && pot.components?.length ? pot.components.flatMap(c => c.effects || []) : pot.effects) : pot.polaridad !== 'Maleficioso';
  let body = '';
  const blocks = pot.isMulti && pot.components?.length ? pot.components : [pot];
  blocks.forEach(b => {
    if (blocks.length > 1) body += `<p><strong>${b.name}</strong></p>`;
    (b.effects || []).forEach(e => { body += rollEffectLine(e, b.effectTotalMultiplier); });
    if (b.isDistributed) body += '<p class="muted">📊 Reparte el efecto entre los turnos de duración.</p>';
    if (b.isInverted) body += `<p>🔃 Invertida${b.invertedEffect ? ': ' + b.invertedEffect : ''}</p>`;
    body += rollDuration(b);
    const sv = saveText({ ...b, craftDC: b.craftDC || pot.craftDC });
    if (sv) body += `<p>${sv}</p>`;
  });
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
export function renderLoot() { repintarInventario(); }

// ---- CRAFTEO PANEL RENDERERS ----
// Paso 1: disolventes. Devuelve cuántos reactivos en inventario hay para cada campo.
export function reactivosPorCampo() {
  const n = {};
  for (const id in state.catalog) {
    const m = state.catalog[id];
    if (m.type === 'Reactivo' && (state.inventory[id] || 0) > 0 && niveles.reactivoOk(m) && !infoOculta(m)) n[m.campo] = (n[m.campo] || 0) + 1;
  }
  return n;
}

export function renderElaboracion(craftSelectedSolvent, craftSelectedBase, craftSelectedMods) {
  const sEl = document.getElementById('craftSolventList');
  const counts = reactivosPorCampo();
  sEl.innerHTML = '<div class="solv-grid">' + CAMPO_NAMES.map(c => {
    const solv = getDisolvente(state.settings, c);
    const picked = craftSelectedSolvent === c;
    if (!niveles.disolventeOk(c)) return `<button class="solv-btn solv-${campoClass(c)} solv-bloqueado" disabled title="Se aprende en el nivel ${niveles.nivelDisolvente(c)} de alquimia">
      <span class="solv-name">🔒 ${solv.name}</span>
      <span class="solv-sub">${c} · nivel ${niveles.nivelDisolvente(c)} de alquimia</span>
    </button>`;
    const sinOdre = odres.problema(c);
    if (sinOdre) return `<button class="solv-btn solv-${campoClass(c)} solv-bloqueado" disabled title="${sinOdre}">
      <span class="solv-name">🫙 ${solv.name}</span>
      <span class="solv-sub">${c} · no te queda en los odres</span>
    </button>`;
    return `<button class="solv-btn solv-${campoClass(c)}${picked ? ' picked' : ''}" data-action="craft-pick-solvent" data-id="${c}">
      <span class="solv-name">${CAMPOS[c].icon} ${solv.name}</span>
      <span class="solv-sub">${c} · CD ${solv.difficulty >= 0 ? '+' : ''}${solv.difficulty} · ${counts[c] || 0} reactivo${counts[c] === 1 ? '' : 's'}${odres.usaOdre(c) ? ` · 🫙 ${odres.litros(odres.litrosDe(c))}` : ''}</span>
    </button>`;
  }).join('') + '</div>';

  const reactPanel = document.getElementById('craftReactivoPanel');
  const bEl = document.getElementById('craftBaseList');
  if (!craftSelectedSolvent) {
    reactPanel.style.display = 'none';
    document.getElementById('craftModPanel').style.display = 'none';
    return;
  }
  reactPanel.style.display = 'block';

  const baseList = [];
  let bloqueados = 0;
  for (const id in state.catalog) {
    const m = state.catalog[id];
    if (m.type === 'Reactivo' && m.campo === craftSelectedSolvent && (state.inventory[id] || 0) > 0 && !infoOculta(m)) {
      if (niveles.reactivoOk(m)) baseList.push({ id, m }); else bloqueados++;
    }
  }
  const notaBloq = bloqueados ? `<p class="muted nivel-bloq">🔒 Tienes ${bloqueados} reactivo${bloqueados === 1 ? '' : 's'} de este disolvente que aún no sabes usar: se aprende${bloqueados === 1 ? '' : 'n'} en un nivel superior de alquimia.</p>` : '';
  if (!baseList.length) {
    bEl.innerHTML = `<p class="muted">No tienes reactivos que sepas disolver en ${getDisolvente(state.settings, craftSelectedSolvent).name}.</p>${notaBloq}`;
    document.getElementById('craftModPanel').style.display = 'none';
    return;
  }
  bEl.innerHTML = baseList.map(item => {
    const picked = craftSelectedBase === item.id;
    return `<div class="craft-pot-row">
      <span>${nombreMat(item.m)} ${catBadge(item.m.campo, item.m.polaridad)} ${rarityBadge(item.m.rarity)} (x${state.inventory[item.id]})</span>
      <button class="btn btn-sm btn-pick${picked ? ' picked' : ''}" data-action="craft-pick-base" data-id="${item.id}">${picked ? '✅ Elegido' : 'Elegir'}</button>
    </div>`;
  }).join('') + notaBloq;

  if (!craftSelectedBase) { document.getElementById('craftModPanel').style.display = 'none'; return; }
  const base = state.catalog[craftSelectedBase];
  document.getElementById('craftModPanel').style.display = 'block';
  if (base?.discriminante) { document.getElementById('craftModList').innerHTML = '<p class="muted-i">Reactivo discriminante: sin modificadores.</p>'; return; }

  const modList = [];
  for (const mid in state.catalog) {
    if (state.catalog[mid].type === 'Modificador' && (state.inventory[mid] || 0) > 0 && !infoOculta(state.catalog[mid]))
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
      <span class="mod-label">${MOD_KIND_ICONS[item.m.modKind] || ''} ${nombreMat(item.m)} ${campoBadge(item.m.campo)} ${rarityBadge(item.m.rarity)} dif:${item.m.difficulty >= 0 ? '+' : ''}${item.m.difficulty} (x${state.inventory[item.id]})${blockedNote}</span>
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
  const soloVer = auth.servidor && !auth.esDM() ? 'disabled title="Solo el DM puede cambiar los parámetros"' : '';
  el.innerHTML = (soloVer ? '<p class="muted">🔒 Solo el DM puede cambiar los parámetros. Aquí puedes consultarlos.</p>' : '') + `<table class="settings-table">
    <thead><tr><th>Campo</th><th>Características</th><th>Disolvente</th><th>CD</th></tr></thead>
    <tbody>${CAMPO_NAMES.map(c => {
      const d = st.disolventes[c];
      const stats = CAMPOS[c].stats.length === 6 ? 'Todas' : CAMPOS[c].stats.join(', ');
      return `<tr><td>${campoBadge(c)}</td><td class="muted">${stats}</td>
        <td><input type="text" data-setting="solvName" data-campo="${c}" value="${d.name}" ${soloVer}></td>
        <td><input type="number" data-setting="solvDiff" data-campo="${c}" value="${d.difficulty}" style="width:60px" ${soloVer}></td></tr>`;
    }).join('')}</tbody></table>
    <div class="form-row-2" style="margin-top:12px">
      <div class="form-row"><label>Modificador de polaridad contraria (+CD)</label>
        <input type="number" data-setting="polaridadOpuestaDiff" value="${st.polaridadOpuestaDiff}" style="width:70px" ${soloVer}></div>
      <div class="form-row"><label>Multipoción con disolventes distintos (+CD)</label>
        <input type="number" data-setting="multiDisolventeDiff" value="${st.multiDisolventeDiff}" style="width:70px" ${soloVer}></div>
    </div>`;
}

export function onSettingChange(inp) {
  if (auth.servidor && !auth.esDM()) return;
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

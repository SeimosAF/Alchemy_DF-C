// cauldron.js — visual drag-and-drop crafting interface (Elaboración only)
import { state } from './state.js';
import { APLICACION_OPTIONS } from './data.js';
import { rarityBadge, getAplicOption, campoBadge } from './utils.js';
import { MOD_KIND_ICONS, EFFECT_KINDS } from './data.js';
import { elabDC, modCompat, getDisolvente } from './model.js';
import {
  craftSelectedBase, craftSelectedMods,
  setCraftSelectedBase, setCraftSelectedMods,
} from './crafting.js';

// ── Module state ──────────────────────────────────────────────────────────────
export const caulAplics = new Set(['brebaje']);
let caulCraftState = null;   // null | 'success' | 'fail'
let caulResultCat  = null;   // category of last crafted base

export function setCaulCraftState(s, category) {
  caulCraftState = s;
  caulResultCat  = category ?? null;
}

// ── Category config ───────────────────────────────────────────────────────────
// Color del líquido según el campo (es decir, según el disolvente)
const CAT = {
  'Cuerpo': { liquidFill: '#6a0c0c', waveFill: '#9e1f1f', cardClass: 'caul-card-cuerpo', icon: '💪', rainbow: false },
  'Mente':  { liquidFill: '#4a5560', waveFill: '#8a98a6', cardClass: 'caul-card-mente',  icon: '🧠', rainbow: false },
  'Alma':   { liquidFill: '#2c5f6e', waveFill: '#7fc4d4', cardClass: 'caul-card-alma',   icon: '👻', rainbow: false },
  'Mágico': { liquidFill: '#2a0e6e', waveFill: '#4e1fa8', cardClass: 'caul-card-mag',    icon: '✨', rainbow: true  },
};
const LIQUID_DEFAULT = { liquidFill: '#1a4882', waveFill: '#2060b8', rainbow: false };
const LIQUID_FAIL    = { liquidFill: '#060606', waveFill: '#0e0e0e', rainbow: false };

function reactivoIcon(m) {
  const first = (m.effects || [])[0];
  return (first && EFFECT_KINDS[first.kind]?.icon) || CAT[m.campo]?.icon || '⚗️';
}

// ── SVG ───────────────────────────────────────────────────────────────────────
function caulSVG() {
  return `<svg id="caulSvg" viewBox="0 0 240 290" xmlns="http://www.w3.org/2000/svg"
    style="width:100%;max-width:280px;display:block;margin:auto;overflow:visible">
  <defs>
    <clipPath id="caulClip">
      <path d="M 42 92 C 18 116 18 198 54 222 Q 120 242 186 222 C 222 198 222 116 198 92 Z"/>
    </clipPath>
    <radialGradient id="caulBodyGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%"   stop-color="#4a2e1a"/>
      <stop offset="100%" stop-color="#180a02"/>
    </radialGradient>
    <radialGradient id="caulRimGrad" cx="50%" cy="25%" r="75%">
      <stop offset="0%"   stop-color="#5c3820"/>
      <stop offset="100%" stop-color="#280f04"/>
    </radialGradient>
  </defs>

  <circle class="caul-smoke cs1" cx="95"  cy="78" r="9"/>
  <circle class="caul-smoke cs2" cx="120" cy="64" r="12"/>
  <circle class="caul-smoke cs3" cx="147" cy="72" r="8"/>
  <circle class="caul-smoke cs4" cx="106" cy="52" r="7"/>
  <circle class="caul-smoke cs5" cx="137" cy="46" r="10"/>

  <rect class="caul-leg" x="64"  y="224" width="13" height="42" rx="5" transform="rotate(-9 70 224)"/>
  <rect class="caul-leg" x="113" y="226" width="14" height="40" rx="5"/>
  <rect class="caul-leg" x="163" y="224" width="13" height="42" rx="5" transform="rotate(9 169 224)"/>

  <path fill="url(#caulBodyGrad)"
    d="M 36 90 C 8 116 8 200 48 226 Q 120 248 192 226 C 232 200 232 116 204 90 Z"/>

  <g clip-path="url(#caulClip)">
    <rect id="caulLiquid" class="caul-liquid" x="0" y="130" width="240" height="130"/>
    <!-- Full period = 160px (crest+trough), animation translateX(-160px) = seamless loop -->
    <path id="caulWave" class="caul-wave"
      d="M -160 132 Q -120 120 -80 132 Q -40 144 0 132 Q 40 120 80 132 Q 120 144 160 132 Q 200 120 240 132 Q 280 144 320 132 Q 360 120 400 132 L 400 270 L -160 270 Z"/>
    <g id="caulBubbles"></g>
    <ellipse class="caul-shine" cx="92" cy="138" rx="24" ry="4"/>
  </g>

  <path fill="none" stroke="#0d0603" stroke-width="2" opacity="0.6"
    d="M 36 90 C 8 116 8 200 48 226 Q 120 248 192 226 C 232 200 232 116 204 90 Z"/>
  <path class="caul-highlight" d="M 60 108 C 46 132 46 180 62 212"/>

  <ellipse cx="120" cy="92" rx="84" ry="14" class="caul-rim-shadow"/>
  <ellipse cx="120" cy="90" rx="87" ry="17" fill="url(#caulRimGrad)"/>
  <ellipse cx="120" cy="89" rx="72" ry="11" class="caul-rim-inner"/>
  <path fill="none" stroke="rgba(255,220,160,0.18)" stroke-width="2" d="M 60 82 Q 120 68 180 82"/>

  <path class="caul-handle-out" d="M 42 98 Q 8 98 8 118 Q 8 140 42 140"/>
  <path class="caul-handle-out" d="M 198 98 Q 232 98 232 118 Q 232 140 198 140"/>
  <path class="caul-handle-in"  d="M 42 98 Q 8 98 8 118 Q 8 140 42 140"/>
  <path class="caul-handle-in"  d="M 198 98 Q 232 98 232 118 Q 232 140 198 140"/>
</svg>`;
}

// ── Liquid color ──────────────────────────────────────────────────────────────
function updateLiquid(category) {
  const svg    = document.getElementById('caulSvg');
  const liquid = document.getElementById('caulLiquid');
  const wave   = document.getElementById('caulWave');
  if (!svg || !liquid || !wave) return;

  let cfg;
  if      (caulCraftState === 'fail')   cfg = LIQUID_FAIL;
  else if (category && CAT[category])   cfg = CAT[category];
  else                                  cfg = LIQUID_DEFAULT;

  liquid.style.fill = cfg.liquidFill;
  wave.style.fill   = cfg.waveFill;
  svg.classList.toggle('caul-rainbow',       !!cfg.rainbow);
  svg.classList.toggle('caul-state-fail',    caulCraftState === 'fail');
  svg.classList.toggle('caul-state-success', caulCraftState === 'success');
}

// ── Particle effects ──────────────────────────────────────────────────────────
export function triggerBubbles(category) {
  const container = document.getElementById('caulBubbles');
  if (!container) return;
  const ns  = 'http://www.w3.org/2000/svg';
  const col = ({ 'Cuerpo':'rgba(220,50,50,0.8)', 'Mente':'rgba(190,200,215,0.85)', 'Alma':'rgba(140,220,240,0.8)', 'Mágico':'rgba(160,90,255,0.8)' })[category] || 'rgba(180,220,255,0.7)';
  for (let i = 0; i < 7; i++) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(54 + Math.random() * 132));
    c.setAttribute('cy', '148');
    c.setAttribute('r',  String(2 + Math.random() * 5));
    c.setAttribute('fill', col);
    c.style.cssText = `animation:caul-bubble ${0.55+Math.random()*0.85}s ease-out ${i*0.08}s forwards;`;
    container.appendChild(c);
    setTimeout(() => c.remove(), 2000);
  }
}

function spawnSuccessBubbles() {
  const container = document.getElementById('caulBubbles');
  if (!container) return;
  const ns = 'http://www.w3.org/2000/svg';
  const palettes = {
    'Cuerpo': ['rgba(255,50,50,.9)','rgba(255,100,80,.9)','rgba(200,30,30,.9)'],
    'Mente':  ['rgba(200,210,225,.9)','rgba(160,175,190,.9)','rgba(235,240,245,.9)'],
    'Alma':   ['rgba(140,220,240,.9)','rgba(200,245,255,.9)','rgba(90,180,210,.9)'],
    'Mágico': ['rgba(180,80,255,.9)','rgba(255,80,230,.9)','rgba(120,60,255,.9)'],
  };
  const palette = palettes[caulResultCat] || ['rgba(60,140,255,.9)','rgba(100,180,255,.9)','rgba(40,100,220,.9)'];
  for (let i = 0; i < 20; i++) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', String(50 + Math.random() * 140));
    c.setAttribute('cy', '148');
    c.setAttribute('r',  String(3 + Math.random() * 8));
    c.setAttribute('fill', palette[Math.floor(Math.random() * palette.length)]);
    c.style.cssText = `animation:caul-bubble ${0.5+Math.random()*1.0}s ease-out ${i*0.06}s forwards;`;
    container.appendChild(c);
    setTimeout(() => c.remove(), 2500);
  }
}

function spawnSuccessSparkles() {
  const svg = document.getElementById('caulSvg');
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const palettes = {
    'Cuerpo': ['#ff4040','#ff7060','#ff2020','#ffaa80','#ff8040'],
    'Mente':  ['#d8e0ea','#b0bccb','#ffffff','#e8eef5','#ffe060'],
    'Alma':   ['#9ee8f8','#c8f6ff','#60c8e0','#ffffff','#ffe060'],
    'Mágico': ['#c060ff','#ff60ee','#8040ff','#ffccff','#ffd060'],
  };
  const palette = palettes[caulResultCat] || ['#40aaff','#60ccff','#2080ff','#ffe060','#ffffff'];
  for (let i = 0; i < 22; i++) {
    const c = document.createElementNS(ns, 'circle');
    const dx = (Math.random() - 0.5) * 90;
    const dy = -(50 + Math.random() * 90);
    const dur = 0.55 + Math.random() * 0.75;
    c.setAttribute('cx', String(45 + Math.random() * 150));
    c.setAttribute('cy', '128');
    c.setAttribute('r',  String(2 + Math.random() * 5));
    c.setAttribute('fill', palette[Math.floor(Math.random() * palette.length)]);
    c.style.cssText = `animation:caul-sparkle ${dur}s ease-out ${i*0.045}s forwards;--sdx:${dx}px;--sdy:${dy}px;`;
    svg.appendChild(c);
    setTimeout(() => { if (c.parentNode) c.parentNode.removeChild(c); }, (dur + i * 0.045 + 0.2) * 1000);
  }
}

function spawnFailSmoke() {
  const svg = document.getElementById('caulSvg');
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  [85, 105, 120, 138, 95, 128, 112].forEach((x, i) => {
    const c = document.createElementNS(ns, 'circle');
    const r  = 13 + Math.random() * 12;
    const dx = (Math.random() - 0.5) * 35;
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', '76');
    c.setAttribute('r',  String(r));
    c.setAttribute('fill', 'rgba(8,5,12,0.78)');
    c.style.cssText = `filter:blur(5px);animation:caul-smoke ${0.9+Math.random()*0.5}s ease-out ${i*0.1}s infinite;--sdx:${dx}px;`;
    svg.appendChild(c);
  });
}

// ── Difficulty ────────────────────────────────────────────────────────────────
function compatSelected(base) {
  const out = {};
  for (const mid in craftSelectedMods) {
    const m = state.catalog[mid];
    if (m && craftSelectedMods[mid] > 0 && modCompat(base, m, state.settings).ok) out[mid] = craftSelectedMods[mid];
  }
  return out;
}

function getDC() {
  if (!craftSelectedBase) return null;
  const base = state.catalog[craftSelectedBase];
  if (!base) return null;
  const aplDiff = [...caulAplics].reduce((t, id) => t + (getAplicOption(id)?.diffMod ?? 0), 0);
  return elabDC(base, compatSelected(base), state.catalog, state.settings, aplDiff).dc;
}

// ── Material card renderers ───────────────────────────────────────────────────
function renderBases() {
  const bases = Object.keys(state.catalog)
    .filter(id => state.catalog[id].type === 'Reactivo' && (state.inventory[id] || 0) > 0);
  if (!bases.length)
    return `<div class="caul-panel-header">🌿 Reactivos</div>
      <p class="muted" style="padding:8px 12px">No tienes reactivos en el inventario.</p>`;
  return `<div class="caul-panel-header">🌿 Arrastra un reactivo al caldero</div>
    <div class="caul-cards">
      ${bases.map(id => {
        const m   = state.catalog[id];
        const cfg = CAT[m.campo] || {};
        const icon = reactivoIcon(m);
        const solv = getDisolvente(state.settings, m.campo);
        return `<div class="caul-card ${cfg.cardClass||''} ${m.campo==='Mágico'?'caul-shimmer':''}"
            draggable="true" data-drag-type="base" data-drag-id="${id}" title="Arrastra al caldero">
          <div class="caul-card-icon">${icon}</div>
          <div class="caul-card-body">
            <div class="caul-card-name">${m.unknown?'???':m.name}</div>
            <div class="caul-card-sub">${m.campo} · ${m.polaridad} · ${solv.name} · dif:${m.difficulty>=0?'+':''}${m.difficulty}</div>
            <div class="caul-card-stock">${rarityBadge(m.rarity)} ×${state.inventory[id]}</div>
          </div>
          <div class="caul-card-grab">⠿</div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderModifiers() {
  const base = state.catalog[craftSelectedBase];
  if (base?.discriminante)
    return `<div class="caul-panel-header">🚫 Reactivo discriminante</div>
      <p class="muted-i" style="padding:8px 12px">Este reactivo no acepta modificadores.</p>`;


  const mods = Object.keys(state.catalog)
    .filter(id => state.catalog[id].type === 'Modificador' && (state.inventory[id] || 0) > 0);
  const chips = Object.entries(craftSelectedMods)
    .filter(([,qty]) => qty > 0)
    .map(([mid, qty]) => {
      const m = state.catalog[mid];
      return `<span class="caul-mod-chip">${m?(m.unknown?'???':m.name):mid} ×${qty}
        <button class="caul-chip-del" data-action="caul-mod-remove" data-id="${mid}">✕</button>
      </span>`;
    }).join('');
  return `<div class="caul-panel-header">🧪 Modificadores <span class="caul-panel-hint">(arrastra al caldero)</span></div>
    ${chips ? `<div class="caul-selected-mods">${chips}</div>` : ''}
    ${!mods.length
      ? `<p class="muted" style="padding:8px 12px">No tienes modificadores.</p>`
      : `<div class="caul-cards">
          ${mods.map(id => {
            const m = state.catalog[id];
            const used   = craftSelectedMods[id] || 0;
            const maxU   = m.maxUses || 99;
            const compat = modCompat(base, m, state.settings);
            const canAdd = compat.ok && used < maxU && used < (state.inventory[id] || 0);
            const icon   = MOD_KIND_ICONS[m.modKind] || '🌿';
            return `<div class="caul-card caul-card-mod ${!canAdd?'caul-card-exhausted':''}"
                draggable="${canAdd}" data-drag-type="mod" data-drag-id="${id}"
                title="${!compat.ok?'No compatible: '+compat.reason:canAdd?'Arrastra al caldero':'Límite alcanzado'}">
              <div class="caul-card-icon">${icon}</div>
              <div class="caul-card-body">
                <div class="caul-card-name">${m.unknown?'???':m.name}${used>0?` <strong class="caul-used-count">×${used}</strong>`:''}</div>
                <div class="caul-card-sub">${m.modKind||''} · ${m.campo} · dif:${m.difficulty>=0?'+':''}${m.difficulty}${compat.extraDiff?` · +${compat.extraDiff} polaridad`:''}</div>
                <div class="caul-card-stock">${rarityBadge(m.rarity)} ×${state.inventory[id]}</div>
              </div>
              <div class="caul-card-grab">${canAdd?'⠿':'🔒'}</div>
            </div>`;
          }).join('')}
        </div>`}`;
}

// ── Drop handler ──────────────────────────────────────────────────────────────
function handleDrop(type, id) {
  if (caulCraftState) return;  // locked during result state
  if (type === 'base') {
    setCraftSelectedBase(id);
    setCraftSelectedMods({});
    triggerBubbles(state.catalog[id]?.campo);
    renderCauldron();
  } else if (type === 'mod') {
    if (!craftSelectedBase) return;
    const m = state.catalog[id]; if (!m) return;
    if (!modCompat(state.catalog[craftSelectedBase], m, state.settings).ok) return;
    const used  = craftSelectedMods[id] || 0;
    const maxU  = m.maxUses || 99;
    if (used < maxU && used < (state.inventory[id] || 0)) {
      setCraftSelectedMods({ ...craftSelectedMods, [id]: used + 1 });
      triggerBubbles(null);
      renderCauldron();
    }
  }
}

// ── Drag & drop wiring ────────────────────────────────────────────────────────
function attachDnD() {
  const zone = document.getElementById('caulDropZone');
  if (!zone || caulCraftState) return;  // no DnD during result state

  document.querySelectorAll('#craftCalderoPanel .caul-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: card.dataset.dragType, id: card.dataset.dragId }));
      e.dataTransfer.effectAllowed = 'copy';
      setTimeout(() => card.classList.add('caul-card-dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('caul-card-dragging'));
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; zone.classList.add('caul-drop-active'); });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('caul-drop-active'); });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('caul-drop-active');
    try { const { type, id } = JSON.parse(e.dataTransfer.getData('text/plain')); handleDrop(type, id); }
    catch (_) {}
  });
}

// ── Main render ───────────────────────────────────────────────────────────────
export function renderCauldron() {
  const panel = document.getElementById('craftCalderoPanel');
  if (!panel || panel.style.display === 'none') return;

  const inResult = caulCraftState !== null;
  const hasBase  = craftSelectedBase !== null;
  const base     = hasBase ? state.catalog[craftSelectedBase] : null;
  const dc       = getDC();
  const conflict = caulAplics.has('inhalable') && caulAplics.has('fumigena');
  const canCraft = hasBase && caulAplics.size > 0 && !conflict && !inResult;

  // Potion name preview (shown in notif area when not in result state)
  let preview = '<em class="caul-empty-hint">⬇ Arrastra un reactivo para empezar</em>';
  if (base) {
    const bn = (getDisolvente(state.settings, base.campo).name) + ' + ' + (base.unknown ? '???' : base.name);
    const modNames = Object.keys(craftSelectedMods)
      .filter(mid => craftSelectedMods[mid] > 0 && state.catalog[mid])
      .map(mid => state.catalog[mid].unknown ? '???' : state.catalog[mid].name);
    preview = `⚗️ <strong>${bn}${modNames.length ? ` + ${modNames.join(', ')}` : ''}</strong>`;
  }

  const prevBonus = document.getElementById('caulBonus')?.value ?? '0';

  panel.innerHTML = `
<div class="caul-layout">

  <!-- ═══ LEFT COLUMN ═══ -->
  <div class="caul-left">

    <!-- ROW 1 · Notification / preview zone -->
    <div class="caul-notif-zone" id="caulNotifArea">
      ${!inResult ? `<div class="caul-brew-preview">${preview}</div>` : ''}
    </div>

    <!-- ROW 2 · Cauldron SVG -->
    <div class="caul-svg-section">
      <div class="caul-svg-wrap${inResult ? ' caul-state-'+caulCraftState : ''}" id="caulDropZone">
        ${caulSVG()}
        ${!inResult ? `<div class="caul-drop-hint"><span>${hasBase ? '+ Suelta modificadores' : '⬇ Suelta un reactivo'}</span></div>` : ''}
      </div>
    </div>

    <!-- ROW 3 · Controls -->
    <div class="caul-controls">
      <div class="caul-aplic-wrap">
        <div class="caul-aplic-title">💊 Aplicación</div>
        <div class="caul-aplic-grid">
          ${APLICACION_OPTIONS.map(opt => `
            <label class="caul-aplic-btn${caulAplics.has(opt.id) ? ' active' : ''}${inResult ? ' caul-aplic-disabled' : ''}">
              <input type="checkbox" name="caulAplic" value="${opt.id}" ${caulAplics.has(opt.id) ? 'checked' : ''} ${inResult ? 'disabled' : ''}>
              <span class="caul-aplic-name">${opt.label}</span>
              <span class="caul-aplic-diff">${opt.diffMod >= 0 ? '+' : ''}${opt.diffMod}</span>
            </label>`).join('')}
        </div>
        ${conflict ? `<p class="caul-conflict">⚠️ Inhalable y Fumígena no son compatibles</p>` : ''}
      </div>

      <div class="caul-bottom">
        ${inResult
          ? `<button class="btn caul-retry-btn" data-action="caul-retry">🔄 Reintentar</button>`
          : `<button class="btn caul-elaborar-btn" data-action="caul-elaborar" ${!canCraft ? 'disabled' : ''}>🎲 Elaborar</button>`
        }
        <div class="caul-dc-box">
          <div class="caul-dc-label">CD</div>
          <div class="caul-dc-val" id="caulDcVal">${dc ?? '—'}</div>
        </div>
      </div>

      <div class="caul-bonus-row">
        <label class="caul-bonus-label">Bono extra:
          <input type="number" id="caulBonus" value="${prevBonus}" ${inResult ? 'disabled' : ''}
            style="width:54px;padding:3px 6px;border:1px solid #c9b89a;border-radius:4px;font-size:.85em">
        </label>
        ${hasBase && !inResult ? `<button class="btn btn-sm caul-reset-btn" data-action="caul-reset">✖ Vaciar</button>` : ''}
      </div>
    </div>

  </div><!-- /caul-left -->

  <!-- ═══ RIGHT COLUMN · Materials ═══ -->
  <div class="caul-right ${inResult ? 'caul-right-locked' : ''}">
    ${hasBase && !inResult ? renderModifiers() : renderBases()}
  </div>

</div>`;

  updateLiquid(base?.campo ?? null);
  attachDnD();

  if (!inResult) {
    // Aplicación live listeners
    panel.querySelectorAll('[name="caulAplic"]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? caulAplics.add(cb.value) : caulAplics.delete(cb.value);
        cb.closest('.caul-aplic-btn').classList.toggle('active', cb.checked);
        const newConflict = caulAplics.has('inhalable') && caulAplics.has('fumigena');
        const newCanCraft = hasBase && caulAplics.size > 0 && !newConflict;
        const dcEl  = document.getElementById('caulDcVal');
        const btnEl = panel.querySelector('[data-action="caul-elaborar"]');
        if (dcEl)  dcEl.textContent = getDC() ?? '—';
        if (btnEl) btnEl.disabled   = !newCanCraft;
      });
    });
    // Sync craftBonus ↔ caulBonus
    const caulBonusEl  = document.getElementById('caulBonus');
    const craftBonusEl = document.getElementById('craftBonus');
    if (caulBonusEl && craftBonusEl)
      caulBonusEl.addEventListener('input', () => { craftBonusEl.value = caulBonusEl.value; });
  } else {
    // Trigger visual effects after SVG is in DOM
    setTimeout(() => {
      if (caulCraftState === 'success') { spawnSuccessSparkles(); spawnSuccessBubbles(); }
      else                               spawnFailSmoke();
    }, 60);
  }
}

// ── Sync aplics to hidden craftAplic checkboxes ───────────────────────────────
export function syncCaulAplics() {
  APLICACION_OPTIONS.forEach(opt => {
    const cb = document.querySelector(`[name="craftAplic"][value="${opt.id}"]`);
    if (cb) cb.checked = caulAplics.has(opt.id);
  });
}

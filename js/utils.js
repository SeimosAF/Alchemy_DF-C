// utils.js — pure helper functions (no side-effects, no DOM access)
import { APLICACION_OPTIONS } from './data.js';
import { state } from './state.js';

// ---- Badges ----
export function rarityClass(r) {
  return 'rarity-' + ({ 'Común':'comun','Poco Común':'poco','Rara':'rara','Muy Rara':'muy','Única':'unico' }[r] || 'comun');
}
export function rarityBadge(r) {
  return `<span class="rarity-label ${rarityClass(r)}">${r}</span>`;
}
const CAMPO_CLS = { 'Cuerpo': 'cuerpo', 'Mente': 'mente', 'Alma': 'alma', 'Mágico': 'magico' };
export function campoClass(campo) { return CAMPO_CLS[campo] || 'magico'; }
export function campoBadge(campo) {
  if (!campo) return '';
  return `<span class="badge badge-${campoClass(campo)}">${campo}</span>`;
}
export function polBadge(pol) {
  if (!pol) return '';
  return `<span class="badge badge-${pol === 'Maleficioso' ? 'malef' : pol === 'Neutro' ? 'neutro' : 'benef'}">${pol}</span>`;
}
// Campo + polaridad juntos (sustituye a la antigua "categoría")
export function catBadge(campo, pol) {
  return campoBadge(campo) + (pol ? ' ' + polBadge(pol) : '');
}
export function purityRoman(n) {
  return (['I','II','III','IV','V','VI','VII','VIII','IX','X'][n - 1] || 'I');
}

// ---- Aplicación helpers ----
export function getAplicOption(id) {
  return APLICACION_OPTIONS.find(o => o.id === id) || null;
}

// ---- Potion key helpers ----
export function potCatKey(baseId, modsObj) {
  return baseId + '_m' + Object.keys(modsObj).sort().join(',');
}
export function potKey(baseId, modsObj, aplicIds, purity) {
  return baseId + '_m' + Object.keys(modsObj).sort().join(',')
    + '_a' + [...aplicIds].sort().join(',')
    + '_p' + purity;
}
export function parsePotKey(key) {
  const m = key.match(/^(.+)_m(.*)_a(.*)_p(\d+)$/);
  if (!m) return null;
  return { baseId: m[1], mods: m[2], aplics: m[3], purity: parseInt(m[4]) };
}
export function parsedToCatKey(p) {
  return p ? p.baseId + '_m' + p.mods : '';
}
export function parseCatKey(ck) {
  const m = ck.match(/^(.+)_m(.*)$/);
  if (!m) return null;
  return { baseId: m[1], mods: m[2] };
}

// ---- Dice / rolls ----
export function rollDice(pool) {
  if (!pool) return 0;
  return pool.reduce((t, d) => {
    for (let j = 0; j < (d.count || 1); j++) t += Math.floor(Math.random() * (d.sides || 6)) + 1;
    return t;
  }, 0);
}
export function roll20() { return Math.floor(Math.random() * 20) + 1; }

export function calcBonus() {
  return (state.character.intMod || 0)
    + (state.character.bonus || 0)
    + (parseInt(document.getElementById('craftBonus').value) || 0);
}

// ---- Misc ----
export function mergeDice(pool1, pool2) {
  const res = (pool1 || []).map(d => ({ count: d.count, sides: d.sides }));
  for (const d of (pool2 || [])) {
    const hit = res.find(r => r.sides === d.sides);
    if (hit) hit.count += d.count;
    else res.push({ count: d.count, sides: d.sides });
  }
  return res;
}

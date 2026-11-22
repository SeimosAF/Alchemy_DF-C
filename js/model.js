// model.js — pure rules of the potion model (no DOM, no state import)
// Modelo: un componente es Reactivo o Modificador, tiene un Campo (Cuerpo, Mente, Alma, Mágico)
// que fija su disolvente, una Polaridad (Beneficioso / Maleficioso) y una lista de bloques de efecto.
import { EFFECT_KINDS, DICE_EFFECTS, DEFAULT_SETTINGS } from './data.js';

export const MODEL_VERSION = 3;

// ---- Dice helpers ----
export function parseDice(str) {
  if (!str) return [];
  const pool = [];
  String(str).toLowerCase().replace(/\s/g, '').split('+').forEach(part => {
    const m = part.match(/^(\d*)d(\d+)$/);
    if (m) pool.push({ count: parseInt(m[1] || '1'), sides: parseInt(m[2]) });
  });
  return pool;
}
export function formatDice(pool) {
  return (pool || []).filter(d => d.count > 0).map(d => `${d.count}d${d.sides}`).join('+');
}
export function rollPool(pool) {
  return (pool || []).reduce((t, d) => {
    for (let j = 0; j < (d.count || 1); j++) t += Math.floor(Math.random() * (d.sides || 6)) + 1;
    return t;
  }, 0);
}
export function mergePools(a, b) {
  const res = (a || []).map(d => ({ count: d.count, sides: d.sides }));
  for (const d of (b || [])) {
    const hit = res.find(r => r.sides === d.sides);
    if (hit) hit.count += d.count; else res.push({ count: d.count, sides: d.sides });
  }
  return res;
}

// ---- Disolvente ----
export function getDisolvente(settings, campo) {
  const ds = (settings && settings.disolventes) || DEFAULT_SETTINGS.disolventes;
  return ds[campo] || DEFAULT_SETTINGS.disolventes[campo] || { name: '?', difficulty: 0 };
}

// ---- Text ----
export function effectText(e) {
  const k = EFFECT_KINDS[e.kind] || { label: e.kind, icon: '•' };
  const dice = formatDice(e.dice);
  const amount = [dice, e.flat ? String(e.flat) : '', e.statMod ? `mod.${e.statMod}` : ''].filter(Boolean).join(' + ');
  const rk = e.rollKind && e.rollKind !== 'Todas las tiradas' ? e.rollKind.toLowerCase() + ' de ' : '';
  switch (e.kind) {
    case 'curacion':     return `${k.icon} Curación ${amount || '—'}`;
    case 'pgTemp':       return `${k.icon} ${amount || '—'} PG temporales`;
    case 'dano':         return `${k.icon} Daño ${amount || '—'}${e.damageType ? ' ' + e.damageType.toLowerCase() : ''}`;
    case 'danoContinuo': return `${k.icon} ${amount || '—'}${e.damageType ? ' ' + e.damageType.toLowerCase() : ''} por turno`;
    case 'bonificador':  return `${k.icon} +${e.value || 0} a ${rk}${e.stat || 'tiradas'}`;
    case 'penalizacion': return `${k.icon} −${Math.abs(e.value || 0)} a ${rk}${e.stat || 'tiradas'}`;
    case 'ventaja':      return `${k.icon} Ventaja en ${rk}${e.stat || 'tiradas'}`;
    case 'desventaja':   return `${k.icon} Desventaja en ${rk}${e.stat || 'tiradas'}`;
    case 'resistencia':  return `${k.icon} Resistencia a ${e.damageType || '???'}`;
    case 'vulnerabilidad': return `${k.icon} Vulnerable a ${e.damageType || '???'}`;
    case 'inmunidad':    return `${k.icon} Inmune a ${(e.condition || '???').toLowerCase()}`;
    case 'estado':       return `${k.icon} ${e.condition || '???'}`;
    case 'hechizo':      return `${k.icon} ${e.spellName || 'Hechizo'}${e.spellLevel ? ` (nivel ${e.spellLevel})` : ''}`;
    case 'especial':     return `${k.icon} ${e.text || 'Efecto especial'}${amount ? ` (${amount})` : ''}`;
    default:             return `${k.icon} ${k.label}`;
  }
}

export function durationText(p) {
  if (p.durationInstant) return '⚡ Instantánea';
  const d = formatDice(p.durationDice);
  const base = [d, p.durationFlat ? String(p.durationFlat) : ''].filter(Boolean).join(' + ');
  if (!base) return '';
  const mult = p.durationMult && p.durationMult !== 1 ? ` ×${fmtMult(p.durationMult)}` : '';
  return `⏱️ ${base} turno(s)${mult}`;
}
function fmtMult(m) {
  if (m === 0.5) return '½';
  if (m === 0.25) return '¼';
  return Number.isInteger(m) ? String(m) : m.toFixed(2);
}

export function saveText(p) {
  if (!p.save || !p.save.stat) return '';
  const dc = p.craftDC ? ` CD ${p.craftDC}` : '';
  const on = p.save.onSuccess === 'mitad' ? 'mitad de efecto' : p.save.onSuccess === 'anula' ? 'sin efecto' : '';
  return `🎯 Salvación de ${p.save.stat}${dc}${on ? ` (si la supera: ${on})` : ''}`;
}

export function hasMaleficio(effects) {
  return (effects || []).some(e => EFFECT_KINDS[e.kind]?.pol === 'Maleficioso');
}

// ---- Compatibilidad de modificadores ----
// Regla propuesta (pendiente de confirmar): el modificador debe ser del mismo campo que el
// reactivo o de campo Mágico. Polaridad contraria → +settings.polaridadOpuestaDiff a la CD.
// Las pociones Mágicas no admiten modificadores.
export function modCompat(reactivo, mod, settings) {
  if (!reactivo || !mod) return { ok: false, reason: '' };
  if (reactivo.campo === 'Mágico') return { ok: false, reason: 'las pociones mágicas no admiten modificadores' };
  if (reactivo.discriminante) return { ok: false, reason: 'reactivo discriminante' };
  if (mod.campo !== reactivo.campo && mod.campo !== 'Mágico')
    return { ok: false, reason: `campo ${mod.campo}` };
  const instant = reactivo.durationInstant;
  if (instant && (mod.modKind === 'Concentrador' || mod.modKind === 'Diluyente'))
    return { ok: false, reason: 'el reactivo es instantáneo' };
  const opposite = mod.polaridad && reactivo.polaridad && mod.polaridad !== reactivo.polaridad;
  const s = settings || DEFAULT_SETTINGS;
  return { ok: true, extraDiff: opposite ? (s.polaridadOpuestaDiff ?? 2) : 0, opposite };
}

// ---- CD de elaboración ----
export function elabDC(reactivo, modsObj, catalog, settings, aplicDiff) {
  const solv = getDisolvente(settings, reactivo.campo);
  let modDiff = 0, polDiff = 0;
  for (const mid in modsObj) {
    const m = catalog[mid]; if (!m || !modsObj[mid]) continue;
    modDiff += (m.difficulty || 0) * modsObj[mid];
    const c = modCompat(reactivo, m, settings);
    if (c.ok && c.extraDiff) polDiff += c.extraDiff;
  }
  const baseDiff = reactivo.difficulty || 0;
  const dc = Math.max(6, 10 + (solv.difficulty || 0) + baseDiff + modDiff + polDiff + (aplicDiff || 0));
  return { dc, solvDiff: solv.difficulty || 0, baseDiff, modDiff, polDiff };
}

// ---- Aplicar modificadores al reactivo ----
function firstDiceEffect(effects) {
  return effects.find(e => DICE_EFFECTS.includes(e.kind) && (e.dice?.length || e.flat));
}
function addDice(e, n) {
  if (!e.dice?.length) { if (n > 0) e.flat = (e.flat || 0) + n; return; }
  e.dice[0].count = Math.max(1, e.dice[0].count + n);
}

export function applyModifiers(reactivo, modsObj, catalog) {
  const out = {
    effects: JSON.parse(JSON.stringify(reactivo.effects || [])),
    durationInstant: !!reactivo.durationInstant,
    durationDice: (reactivo.durationDice || []).map(d => ({ ...d })),
    durationFlat: reactivo.durationFlat || 0,
    durationMult: 1,
  };
  for (const mid in modsObj) {
    const m = catalog[mid]; const qty = modsObj[mid] || 0;
    if (!m || !qty) continue;
    for (let i = 0; i < qty; i++) {
      const main = firstDiceEffect(out.effects);
      switch (m.modKind) {
        case 'Potenciador':
          if (main) {
            main.dice = mergePools(main.dice, m.dicePool);
            main.flat = (main.flat || 0) + (m.flatBonus || 0);
            if (m.statMod && !main.statMod) main.statMod = m.statMod;
          }
          break;
        case 'Prolongador':
          out.durationDice = mergePools(out.durationDice, m.durationDice);
          out.durationFlat += m.durationFlat || 0;
          if (m.durationDice?.length || m.durationFlat) out.durationInstant = false;
          break;
        case 'Concentrador':
          out.durationMult /= (m.tradeFactor || 2);
          if (main) addDice(main, m.tradeDice || 1);
          break;
        case 'Diluyente':
          out.durationMult *= (m.tradeFactor || 2);
          if (main) addDice(main, -(m.tradeDice || 1));
          break;
        case 'Añadir efecto':
          (m.effects || []).forEach(e => out.effects.push(JSON.parse(JSON.stringify(e))));
          break;
      }
    }
  }
  return out;
}

// ---- Migración desde el modelo antiguo (Salutífera / Maliciosa / Mágica + subtipos) ----
const LEGACY_CAT = {
  'Salutífera': { campo: 'Cuerpo', polaridad: 'Beneficioso' },
  'Maliciosa':  { campo: 'Cuerpo', polaridad: 'Maleficioso' },
  'Mágica':     { campo: 'Mágico', polaridad: 'Beneficioso' },
};

export function legacyEffects(o) {
  const dice = (o.dicePool || []).map(d => ({ count: d.count, sides: d.sides }));
  const flat = o.flatBonus || 0, statMod = o.statMod || '';
  const effects = [];
  switch (o.subtipo) {
    case 'Vitalidad':   effects.push({ kind: 'curacion', dice, flat, statMod }); break;
    case 'Dañina':      effects.push({ kind: 'dano', dice, flat, statMod, damageType: o.damageType || '' }); break;
    case 'Resistencia': effects.push({ kind: 'resistencia', damageType: o.damageType || '' }); break;
    case 'Debilitante': effects.push({ kind: 'danoContinuo', dice, flat, damageType: o.damageType || '' }); break;
    case 'Incapacitante':
      if (o.penaltyType === 'flat' || o.penaltyType === 'both')
        effects.push({ kind: 'penalizacion', stat: '', rollKind: 'Todas las tiradas', value: o.penaltyValue || 1 });
      if (o.penaltyType === 'disadvantage' || o.penaltyType === 'both')
        effects.push({ kind: 'desventaja', stat: '', rollKind: 'Todas las tiradas' });
      break;
    default:
      if (dice.length || flat) effects.push({ kind: 'especial', text: o.subtipo || 'Efecto', dice, flat, statMod });
  }
  return effects;
}

function migrateCatalogItem(m) {
  if (m.campo) return m;
  const map = LEGACY_CAT[m.category] || LEGACY_CAT['Mágica'];
  m.campo = map.campo; m.polaridad = map.polaridad;
  if (m.type === 'Base') {
    m.type = 'Reactivo';
    m.effects = legacyEffects(m);
    m.save = m.polaridad === 'Maleficioso' ? { stat: 'Constitución', onSuccess: 'mitad' } : null;
  } else {
    m.type = 'Modificador';
    m.modKind = ['Potenciador', 'Prolongador', 'Economizador'].includes(m.subtipo) ? m.subtipo : 'Otro';
    m.effects = [];
  }
  m.legacy = { category: m.category, subtipo: m.subtipo };
  delete m.category; delete m.subtipo;
  return m;
}

function migratePotion(p) {
  if (p.campo) return p;
  const map = LEGACY_CAT[p.category] || LEGACY_CAT['Mágica'];
  p.campo = map.campo; p.polaridad = map.polaridad;
  p.effects = legacyEffects(p);
  p.durationMult = 1;
  p.extraDifficulty = 0;
  if (p.components) p.components.forEach(c => {
    const cm = LEGACY_CAT[c.category] || LEGACY_CAT['Mágica'];
    c.campo = cm.campo; c.polaridad = cm.polaridad;
    c.effects = legacyEffects(c);
  });
  return p;
}

export function migrateState(s) {
  if ((s.version || 0) >= MODEL_VERSION) return s;
  for (const id in s.catalog) migrateCatalogItem(s.catalog[id]);
  for (const pk in s.potions) migratePotion(s.potions[pk]);
  s.version = MODEL_VERSION;
  return s;
}

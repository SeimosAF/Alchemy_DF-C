// cauldron.js — interfaz visual de elaboración (arrastrar/clic al caldero)
// La escena del caldero (SVG + efectos) se crea una sola vez y se conserva entre
// renderizados, para que los colores se mezclen y las animaciones no se reinicien.
import { state } from './state.js';
import { APLICACION_OPTIONS, SOUND_ENABLED } from './data.js';
import { rarityBadge, getAplicOption, nombreMat } from './utils.js';
import { MOD_KIND_ICONS, EFFECT_KINDS } from './data.js';
import { elabDC, modCompat, getDisolvente } from './model.js';
import { CAMPOS, CAMPO_NAMES } from './data.js';
import {
  craftSelectedSolvent, craftSelectedBase, craftSelectedMods,
  setCraftSelectedSolvent, setCraftSelectedBase, setCraftSelectedMods,
} from './crafting.js';
import { reactivosPorCampo } from './render.js';
import * as niveles from './niveles.js';

// ── Module state ──────────────────────────────────────────────────────────────
export const caulAplics = new Set(['brebaje']);
let caulCraftState = null;   // null | 'success' | 'fail'
let caulResultCat  = null;   // campo del último reactivo elaborado
let caulResultPol  = null;   // polaridad del último reactivo elaborado
let resultPending  = false;  // hay que lanzar los efectos del resultado en el próximo render
let brewing        = false;  // animación de "removiendo" en curso
let flying         = false;  // un ingrediente va de camino al caldero
let curLook        = null;   // colores actuales del líquido
let ambientTimer   = null;
let skullTimer     = 0;      // ticks hasta la próxima calavera de humo

export function setCaulCraftState(s, category, polaridad) {
  caulCraftState = s;
  caulResultCat  = category ?? null;
  caulResultPol  = polaridad ?? null;
  resultPending  = !!s;
  if (!s) clearResultFx();
}

// ── Colores ───────────────────────────────────────────────────────────────────
const CAT = {
  'Cuerpo': { cardClass: 'caul-card-cuerpo', icon: '💪' },
  'Mente':  { cardClass: 'caul-card-mente',  icon: '🧠' },
  'Alma':   { cardClass: 'caul-card-alma',   icon: '👻' },
  'Mágico': { cardClass: 'caul-card-mag',    icon: '✨' },
};
// deep = color del fondo del líquido, light = brillo de la superficie y de la luz que desprende
const LIQUID_FAIL = { deep: '#0b0a08', light: '#2a2418', rainbow: false, fail: true };
const SOLV_LOOK = {
  'Cuerpo': { tex: 'agua',    deep: '#123a78', light: '#5fa8ff', rainbow: false },
  'Mente':  { tex: 'azogue',  deep: '#4d5662', light: '#e4ecf5', rainbow: false },
  'Alma':   { tex: 'polvo',   deep: '#2b6f82', light: '#aef0ff', rainbow: false },
  'Mágico': { tex: 'esencia', deep: '#2a0e6e', light: '#b48cff', rainbow: true  },
};
// Beneficioso = colores vivos y luminosos; Maleficioso = tonos turbios y apagados.
const POL_LOOK = {
  'Beneficioso': {
    'Cuerpo': { deep: '#0f7a52', light: '#7dffc4' },
    'Mente':  { deep: '#4a64a8', light: '#d6e2ff' },
    'Alma':   { deep: '#2a98b8', light: '#d8fbff' },
    'Mágico': { deep: '#5a2ec0', light: '#e2b8ff' },
  },
  'Maleficioso': {
    'Cuerpo': { deep: '#142204', light: '#8ee02c' },   // ácido
    'Mente':  { deep: '#030304', light: '#24232b' },   // alquitrán
    'Alma':   { deep: '#0f0718', light: '#7a44c0' },   // pesadilla
    'Mágico': { deep: '#2a0103', light: '#ff2a12' },   // infernal
  },
};
const POL_CLASS = { 'Beneficioso': 'benef', 'Maleficioso': 'malef', 'Neutro': 'neutro' };

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const f = n => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
function shiftHex(hex, dh, ds = 0, dl = 0) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + dh, Math.max(0, Math.min(1, s + ds)), Math.max(0, Math.min(1, l + dl)));
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
// Cada modificador desplaza un poco el tono, para que se note que "algo" ha cambiado.
function modHueShift(mods) {
  let shift = 0;
  for (const mid in mods) {
    if (!(mods[mid] > 0)) continue;
    let hsh = 0; for (const ch of mid) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    shift += ((Math.abs(hsh) % 50) - 25) * Math.min(mods[mid], 3) * .6;
  }
  return Math.max(-45, Math.min(45, shift));
}

function reactivoIcon(m) {
  const first = (m.effects || [])[0];
  return (first && EFFECT_KINDS[first.kind]?.icon) || CAT[m.campo]?.icon || '⚗️';
}

// ── Sonido (sintetizado, sin archivos) ────────────────────────────────────────
let actx = null;
function ac() {
  if (!SOUND_ENABLED) return null;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (_) { return null; }
}
function tone({ type = 'sine', f0, f1, dur, vol = .15, delay = 0, filter }) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + .015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (filter) { const fl = a.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filter; o.connect(fl); node = fl; }
  node.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + dur + .05);
}
function noise({ dur, vol = .1, delay = 0, freq = 800 }) {
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(); s.buffer = buf;
  const fl = a.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  s.connect(fl); fl.connect(g); g.connect(a.destination); s.start(t);
}
const sfx = {
  plop()  { tone({ f0: 520 + Math.random() * 200, f1: 140, dur: .16, vol: .2 }); noise({ dur: .12, vol: .05, freq: 1500 }); },
  pour()  { noise({ dur: .6, vol: .08, freq: 900 }); tone({ f0: 300, f1: 160, dur: .4, vol: .06, delay: .1 }); },
  blip()  { tone({ f0: 300 + Math.random() * 500, f1: 900, dur: .07, vol: .05 }); },
  brew()  { for (let i = 0; i < 14; i++) tone({ f0: 200 + Math.random() * 400, f1: 700, dur: .08, vol: .05, delay: i * .1 + Math.random() * .05 });
            tone({ type: 'sawtooth', f0: 70, f1: 140, dur: 1.5, vol: .05, filter: 400 }); },
  success() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: .6, vol: .12, delay: i * .08 }));
              tone({ type: 'sine', f0: 2093, dur: 1.2, vol: .04, delay: .4 }); },
  skull(tex) {
    if (tex === 'esencia') { tone({ type: 'sawtooth', f0: 55, f1: 41, dur: 1.6, vol: .09, filter: 300 }); tone({ type: 'sawtooth', f0: 82, f1: 61, dur: 1.6, vol: .06, filter: 300 }); }
    else if (tex === 'polvo') { tone({ type: 'sine', f0: 660, f1: 440, dur: 1.4, vol: .05 }); tone({ type: 'sine', f0: 698, f1: 466, dur: 1.4, vol: .04 }); }
    else noise({ dur: 1.2, vol: .05, freq: tex === 'agua' ? 2500 : 300 });
  },
  heart() { [784, 988, 1175].forEach((f, i) => tone({ type: 'sine', f0: f, dur: .9, vol: .05, delay: i * .12 })); },
  fail()  { tone({ type: 'sawtooth', f0: 140, f1: 38, dur: .7, vol: .18, filter: 500 }); noise({ dur: .9, vol: .14, freq: 400, delay: .05 }); },
};

// ── Escena SVG ────────────────────────────────────────────────────────────────
const SURF = { cx: 150, cy: 124, rx: 97, ry: 17 };   // superficie del líquido

function flamePath(x, w, h) {
  const b = 304;
  return `M ${x - w} ${b} C ${x - w} ${b - h * .45} ${x - w * .3} ${b - h * .6} ${x} ${b - h}
          C ${x + w * .3} ${b - h * .6} ${x + w} ${b - h * .45} ${x + w} ${b} Z`;
}

function caulSVG() {
  const backFlames  = [[104, 16, 46], [128, 18, 62], [152, 20, 70], [176, 18, 60], [198, 15, 44]];
  const frontFlames = [[118, 10, 26], [150, 12, 34], [182, 10, 24]];
  const embers = Array.from({ length: 9 }, (_, i) => i);
  return `<svg id="caulSvg" class="caul-empty" viewBox="0 -20 300 345" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
  <defs>
    <clipPath id="caulSurfClip"><ellipse cx="150" cy="119" rx="100" ry="20"/></clipPath>
    <radialGradient id="caulSurfGrad" cx="50%" cy="45%" r="60%">
      <stop id="caulStopLight" offset="0%"  stop-color="#5fa8ff"/>
      <stop id="caulStopDeep"  offset="85%" stop-color="#123a78"/>
    </radialGradient>
    <radialGradient id="caulGlowGrad" cx="50%" cy="60%" r="50%">
      <stop id="caulStopGlow" offset="0%" stop-color="#5fa8ff" stop-opacity=".75"/>
      <stop offset="100%" stop-color="#5fa8ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="caulBodyLit" x1="0" y1="0" x2="0" y2="1">
      <stop id="caulStopBody" offset="0%" stop-color="#5fa8ff" stop-opacity=".32"/>
      <stop offset="35%" stop-color="#5fa8ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="caulIron" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"  stop-color="#0a0a0d"/>
      <stop offset="28%" stop-color="#3b3a44"/>
      <stop offset="45%" stop-color="#25242b"/>
      <stop offset="100%" stop-color="#07070a"/>
    </linearGradient>
    <linearGradient id="caulFireLit" x1="0" y1="0" x2="0" y2="1">
      <stop offset="45%"  stop-color="#ff7a1a" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ff7a1a" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="caulRim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#5a5964"/>
      <stop offset="55%" stop-color="#24232a"/>
      <stop offset="100%" stop-color="#0d0d10"/>
    </linearGradient>
    <linearGradient id="caulFlame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#ff3d0a" stop-opacity=".0"/>
      <stop offset="25%" stop-color="#ff5a14"/>
      <stop offset="70%" stop-color="#ffb02e"/>
      <stop offset="100%" stop-color="#fff3b0"/>
    </linearGradient>
    <radialGradient id="caulFireGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ff9a3a" stop-opacity=".75"/>
      <stop offset="100%" stop-color="#ff6a00" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="caulBeam" cx="50%" cy="100%" r="100%">
      <stop offset="0%" stop-color="#fff" stop-opacity=".95"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="caulGrainPat" width="10" height="10" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.1" fill="rgba(255,255,255,.75)"/>
      <circle cx="7" cy="5" r=".8" fill="rgba(255,255,255,.55)"/>
      <circle cx="4" cy="8" r=".6" fill="rgba(255,255,255,.5)"/>
    </pattern>
  </defs>

  <!-- Fuego -->
  <ellipse class="caul-fireglow" cx="150" cy="296" rx="140" ry="42" fill="url(#caulFireGlow)"/>
  <ellipse cx="150" cy="314" rx="112" ry="9" fill="rgba(0,0,0,.55)"/>
  <rect x="92" y="300" width="116" height="11" rx="5.5" fill="#3a2212" transform="rotate(-8 150 305)"/>
  <rect x="92" y="300" width="116" height="11" rx="5.5" fill="#2c180c" transform="rotate(9 150 305)"/>
  <g class="caul-fire">
    ${backFlames.map(([x, w, h], i) => `<path class="caul-flame cf${i}" d="${flamePath(x, w, h)}" fill="url(#caulFlame)"/>`).join('')}
  </g>
  <g class="caul-embers">
    ${embers.map(i => `<circle class="caul-ember ce${i}" cx="${110 + i * 10}" cy="296" r="${1.2 + (i % 3) * .5}"/>`).join('')}
  </g>

  <!-- Patas traseras -->
  <path d="M 78 250 L 66 300 L 80 300 L 96 258 Z" fill="#141418"/>
  <path d="M 222 250 L 234 300 L 220 300 L 204 258 Z" fill="#141418"/>

  <!-- Cuerpo -->
  <g class="caul-body">
    <path d="M 38 124 C 26 205 78 286 150 288 C 222 286 274 205 262 124 Z" fill="url(#caulIron)"/>
    <path class="caul-firelit" d="M 38 124 C 26 205 78 286 150 288 C 222 286 274 205 262 124 Z" fill="url(#caulFireLit)"/>
    <path class="caul-bodylit" d="M 38 124 C 26 205 78 286 150 288 C 222 286 274 205 262 124 Z" fill="url(#caulBodyLit)"/>
    <path d="M 34 168 Q 150 200 266 168" fill="none" stroke="#16161b" stroke-width="9"/>
    <path d="M 34 165 Q 150 197 266 165" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>
    ${[60, 95, 150, 205, 240].map(x => { const y = 168 + 32 * (1 - Math.pow((x - 150) / 116, 2)) * .5; return `<circle cx="${x}" cy="${y.toFixed(1)}" r="3" fill="#2e2d35" stroke="rgba(255,255,255,.18)" stroke-width=".8"/>`; }).join('')}
    <path d="M 58 140 C 50 190 70 238 104 262" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="7" stroke-linecap="round"/>
    <path d="M 64 150 C 60 180 66 205 78 224" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="2" stroke-linecap="round"/>
  </g>

  <!-- Llamas delanteras y pata delantera -->
  <g class="caul-fire caul-fire-front">
    ${frontFlames.map(([x, w, h], i) => `<path class="caul-flame cf${i + 5}" d="${flamePath(x, w, h)}" fill="url(#caulFlame)"/>`).join('')}
  </g>
  <path d="M 140 284 L 136 312 L 164 312 L 160 284 Z" fill="#1a1a1f"/>

  <!-- Asas -->
  <path d="M 44 138 C 14 132 10 172 40 176" fill="none" stroke="#0c0c0f" stroke-width="9" stroke-linecap="round"/>
  <path d="M 44 138 C 14 132 10 172 40 176" fill="none" stroke="#3a3942" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M 256 138 C 286 132 290 172 260 176" fill="none" stroke="#0c0c0f" stroke-width="9" stroke-linecap="round"/>
  <path d="M 256 138 C 286 132 290 172 260 176" fill="none" stroke="#3a3942" stroke-width="3.5" stroke-linecap="round"/>

  <!-- Borde y boca -->
  <ellipse cx="150" cy="121" rx="117" ry="27" fill="url(#caulRim)"/>
  <ellipse cx="150" cy="119" rx="100" ry="20" fill="#040405"/>
  <g class="caul-liquid-g" clip-path="url(#caulSurfClip)">
    <ellipse id="caulSurface" class="caul-surface" cx="${SURF.cx}" cy="${SURF.cy}" rx="${SURF.rx}" ry="${SURF.ry}" fill="url(#caulSurfGrad)"/>
    <g transform="translate(${SURF.cx} ${SURF.cy}) scale(1 .18)">
      <g class="caul-swirl">
        <path d="M 0 -80 A 80 80 0 0 1 80 0" />
        <path d="M 0 80 A 80 80 0 0 1 -80 0" />
        <path d="M 45 -20 A 50 50 0 0 1 -10 50" />
        <path d="M -45 20 A 50 50 0 0 1 10 -50" />
        <path d="M 20 -8 A 22 22 0 0 1 -8 20" />
      </g>
    </g>
    <rect class="caul-grain" x="40" y="100" width="230" height="45" fill="url(#caulGrainPat)"/>
    <ellipse class="caul-spec" cx="118" cy="120" rx="34" ry="4"/>
    <g id="caulBubbles"></g>
    <ellipse cx="150" cy="119" rx="100" ry="20" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="9"/>
  </g>
  <ellipse class="caul-rimglow" cx="150" cy="119" rx="101" ry="21" fill="none" stroke-width="2.5"/>
  <path d="M 36 125 Q 150 160 264 125" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.6"/>
  <path d="M 52 108 Q 150 86 248 108" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1.4"/>

  <!-- Luz del líquido, vapor y efectos -->
  <ellipse class="caul-glow" cx="150" cy="104" rx="135" ry="70" fill="url(#caulGlowGrad)"/>
  <g class="caul-steam">
    ${[0, 1, 2, 3, 4, 5].map(i => `<ellipse class="caul-wisp cw${i}" cx="${108 + i * 17}" cy="112" rx="${14 + (i % 3) * 4}" ry="${9 + (i % 2) * 3}"/>`).join('')}
  </g>
  <rect class="caul-beam" x="70" y="-20" width="160" height="140" fill="url(#caulBeam)"/>
  <g id="caulFx"></g>
</svg>`;
}

// ── Aplicar color/estado al líquido ──────────────────────────────────────────
function computeLook(solventCampo, base) {
  if (caulCraftState === 'fail') return LIQUID_FAIL;
  if (caulCraftState === 'success') {
    if (curLook && !curLook.fail) return curLook;           // conserva el color con que se elaboró
    const c = caulResultCat, sl = SOLV_LOOK[c]; if (!sl) return null;
    return { ...sl, ...(POL_LOOK[caulResultPol]?.[c] || {}), pol: caulResultPol };
  }
  const solvCampo = solventCampo || base?.campo;
  const sl = SOLV_LOOK[solvCampo];
  if (!sl) return null;
  const pol = base?.polaridad || null;
  const look = { ...sl, ...(POL_LOOK[pol]?.[solvCampo] || {}), pol };
  const dh = base ? modHueShift(craftSelectedMods) : 0;
  if (dh) { look.deep = shiftHex(look.deep, dh, .05); look.light = shiftHex(look.light, dh, .05, .03); }
  return look;
}

function applyLook(look) {
  const svg = document.getElementById('caulSvg');
  const stage = document.getElementById('caulStage');
  if (!svg) return;
  curLook = look;
  svg.classList.toggle('caul-empty', !look);
  ['agua', 'azogue', 'polvo', 'esencia'].forEach(t => svg.classList.toggle('caul-tex-' + t, look?.tex === t && !look?.fail));
  ['benef', 'malef', 'neutro'].forEach(c => svg.classList.toggle('caul-pol-' + c, POL_CLASS[look?.pol] === c && !look?.fail));
  svg.classList.toggle('caul-rainbow', !!look?.rainbow && look?.pol !== 'Maleficioso' && !look?.fail);
  svg.classList.toggle('caul-state-fail', caulCraftState === 'fail');
  stage?.classList.toggle('caul-demon', look?.tex === 'esencia' && look?.pol === 'Maleficioso' && !look?.fail);
  stage?.classList.toggle('caul-tar', look?.tex === 'azogue' && look?.pol === 'Maleficioso' && !look?.fail);
  svg.classList.toggle('caul-state-success', caulCraftState === 'success');
  if (!look) { stage?.style.setProperty('--caul-glow', 'rgba(0,0,0,0)'); return; }
  const set = (id, c) => { const el = document.getElementById(id); if (el) el.style.stopColor = c; };
  set('caulStopLight', look.light);
  set('caulStopDeep',  look.deep);
  set('caulStopGlow',  look.light);
  set('caulStopBody',  look.light);
  document.querySelectorAll('#caulSvg .caul-swirl path').forEach(p => p.style.stroke = look.light);
  const rg = svg.querySelector('.caul-rimglow'); if (rg) rg.style.stroke = hexA(look.light, .55);
  svg.querySelectorAll('.caul-wisp').forEach(w => w.style.fill = look.fail ? 'rgba(20,16,14,.75)' : hexA(look.light, look.pol === 'Maleficioso' ? .32 : .22));
  stage?.style.setProperty('--caul-glow', hexA(look.light, look.fail ? 0 : look.pol === 'Maleficioso' ? .18 : .34));
}

// ── Utilidades de efectos ─────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const rnd = (a, b) => a + Math.random() * (b - a);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function surfPoint(spread = .85) {
  const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  return [SURF.cx + Math.cos(ang) * SURF.rx * r, SURF.cy + Math.sin(ang) * SURF.ry * r];
}

// Burbuja que se hincha en la superficie y revienta
function spawnBubble(big = false, at = null, size = null, swellMs = 650) {
  const g = document.getElementById('caulBubbles'); if (!g || !curLook) return;
  const [x, y] = at || surfPoint();
  const r = size || (big ? rnd(6, 11) : rnd(2, 5.5));
  const dark = curLook.fail || curLook.pol === 'Maleficioso';
  const b = svgEl('g', {}, g);
  svgEl('circle', { cx: x, cy: y, r, fill: dark ? curLook.deep : hexA(curLook.light, .55),
    stroke: dark ? hexA(curLook.light, .5) : 'rgba(255,255,255,.75)', 'stroke-width': .8 }, b);
  svgEl('circle', { cx: x - r * .35, cy: y - r * .4, r: r * .28, fill: 'rgba(255,255,255,.8)' }, b);
  b.style.transformBox = 'fill-box'; b.style.transformOrigin = 'center bottom';
  const tar = curLook.tex === 'azogue' && curLook.pol === 'Maleficioso';
  const dur = size ? swellMs : (big ? rnd(900, 1600) : rnd(350, 900)) * (tar ? 3 : dark ? 1.6 : 1);
  const an = b.animate([{ transform: 'scale(0.1)' }, { transform: 'scale(1)' }],
    { duration: dur, easing: 'cubic-bezier(.3,.7,.4,1)' });
  an.onfinish = () => { b.remove(); popRing(x, y, r, dark); if (big || Math.random() < .3) droplets(x, y, big ? 4 : 2, big ? 18 : 10); };
}
function popRing(x, y, r, dark) {
  const g = document.getElementById('caulBubbles'); if (!g || !curLook) return;
  const e = svgEl('ellipse', { cx: x, cy: y, rx: r, ry: r * .35, fill: 'none',
    stroke: dark ? hexA(curLook.light, .6) : 'rgba(255,255,255,.7)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, g);
  e.style.transformBox = 'fill-box'; e.style.transformOrigin = 'center';
  e.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }],
    { duration: 500, easing: 'ease-out' }).onfinish = () => e.remove();
}
// Gotitas que saltan y caen describiendo una parábola
function droplets(x, y, n, h, color) {
  const fx = document.getElementById('caulFx'); if (!fx || !curLook) return;
  for (let i = 0; i < n; i++) {
    const c = svgEl('circle', { cx: x, cy: y, r: rnd(1.2, 3), fill: color || curLook.light }, fx);
    const dx = rnd(-1, 1) * h * 1.3, hh = rnd(.5, 1) * h;
    c.animate([
      { transform: 'translate(0,0)', opacity: 1, easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: `translate(${dx * .5}px,${-hh}px)`, opacity: 1, offset: .45, easing: 'cubic-bezier(.6,0,.9,.5)' },
      { transform: `translate(${dx}px,${rnd(4, 14)}px)`, opacity: 0 },
    ], { duration: rnd(450, 800) }).onfinish = () => c.remove();
  }
}
function splash(x = SURF.cx, big = false) {
  const y = SURF.cy + rnd(-4, 4);
  droplets(x, y, big ? 22 : 12, big ? 70 : 45);
  for (let i = 0; i < 3; i++) setTimeout(() => popRing(x, y, 8 + i * 6, false), i * 110);
  surfFlash();
}
function surfFlash() {
  const s = document.getElementById('caulSurface'); if (!s) return;
  s.animate([{ filter: 'brightness(1.9)' }, { filter: 'brightness(1)' }], { duration: 700, easing: 'ease-out' });
  const gl = document.querySelector('#caulSvg .caul-glow');
  gl?.animate([{ opacity: 1 }, { opacity: .55 }], { duration: 900, easing: 'ease-out' });
}
function twinkle() {
  const fx = document.getElementById('caulFx'); if (!fx || !curLook) return;
  const [x, y0] = surfPoint(1);
  const y = y0 - rnd(0, 60);
  const s = svgEl('path', { d: `M ${x} ${y - 5} L ${x + 1.3} ${y - 1.3} L ${x + 5} ${y} L ${x + 1.3} ${y + 1.3} L ${x} ${y + 5} L ${x - 1.3} ${y + 1.3} L ${x - 5} ${y} L ${x - 1.3} ${y - 1.3} Z`,
    fill: Math.random() < .5 ? '#fff' : curLook.light }, fx);
  s.style.transformBox = 'fill-box'; s.style.transformOrigin = 'center';
  s.animate([{ transform: 'scale(0) rotate(0)', opacity: 0 }, { transform: 'scale(1) rotate(45deg)', opacity: 1, offset: .4 },
    { transform: 'scale(0) rotate(90deg) translateY(-10px)', opacity: 0 }], { duration: rnd(700, 1300) }).onfinish = () => s.remove();
}
function floatText(text, color) {
  const fxh = document.getElementById('caulFxHtml'); if (!fxh) return;
  const d = document.createElement('div');
  d.className = 'caul-float-text'; d.textContent = text;
  if (color) d.style.color = color;
  fxh.appendChild(d);
  setTimeout(() => d.remove(), 1700);
}

// Bucle ambiental: burbujas, chispas y gotas según el estado del caldero
function ambientTick() {
  const panel = document.getElementById('craftCalderoPanel');
  if (!panel || panel.style.display === 'none' || !document.getElementById('caulSvg')) return;
  if (!curLook || reduceMotion() || document.hidden) return;
  const malef = curLook.pol === 'Maleficioso';
  let rate = craftSelectedBase ? .55 : .3;
  if (curLook.tex === 'azogue' && malef) rate = .3;
  if (brewing) rate = 2.2;
  if (caulCraftState === 'success') rate = .35;
  if (caulCraftState === 'fail') rate = .12;
  if (malef && !brewing) rate *= .45;
  let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  while (n-- > 0) spawnBubble(malef || curLook.fail ? Math.random() < .6 : Math.random() < .1);
  const sparkly = (curLook.rainbow || curLook.tex === 'polvo' || curLook.pol === 'Beneficioso') && !malef && !curLook.fail;
  if (sparkly && Math.random() < (caulCraftState === 'success' ? .9 : brewing ? .8 : .3)) twinkle();
  if (brewing && Math.random() < .5) droplets(surfPoint()[0], SURF.cy, 2, 30);
  if (brewing && Math.random() < .3) sfx.blip();
  if (curLook.tex === 'esencia' && malef && Math.random() < (brewing ? .9 : .45)) hellSpark();
  if (!caulCraftState && !brewing && craftSelectedBase && --skullTimer <= 0) {
    if (malef) spawnSkull(curLook.tex);
    else if (curLook.pol === 'Beneficioso') spawnHeart();
    skullTimer = Math.round(rnd(38, 55));
  }
}
function startAmbient() {
  if (ambientTimer) return;
  ambientTimer = setInterval(ambientTick, 140);
}

// ── Calaveras de humo (pociones maleficiosas) ─────────────────────────────────
// Cuerpo: ácido · Mente: alquitrán · Alma: pesadilla · Mágico: demonio con cuernos
const SKULLS = {
  agua:    { cls: 'caul-skull-acid',      fill: '#9cff3a', eyes: '#1a3300', drips: '#b6ff4a', horns: false },
  azogue:  { cls: 'caul-skull-tar',       fill: '#0c0a08', eyes: '#000',    drips: '#050403', horns: false },
  polvo:   { cls: 'caul-skull-nightmare', fill: '#6a3aa8', eyes: '#f2c8ff', drips: null,      horns: false },
  esencia: { cls: 'caul-skull-demon',     fill: '#4a0606', eyes: '#ff4a12', drips: null,      horns: true  },
};
let skullSeq = 0;
function skullSVG(k, id) {
  const horns = k.horns ? `
      <path d="M 27 26 C 12 20 4 4 10 -16 C 14 -2 24 8 37 14 Z"/>
      <path d="M 73 26 C 88 20 96 4 90 -16 C 86 -2 76 8 63 14 Z"/>` : '';
  const drips = k.drips ? [32, 46, 58, 70].map((x, i) =>
      `<ellipse class="caul-skull-drip" style="animation-delay:${i * .35}s" cx="${x}" cy="94" rx="2.2" ry="3.2" fill="${k.drips}"/>`).join('') : '';
  return `<svg viewBox="0 -20 100 130" width="120" height="156" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="sk${id}" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${id % 50}">
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" scale="${k.cls === 'caul-skull-nightmare' ? 16 : 9}"/>
        <feGaussianBlur stdDeviation="1.2"/>
      </filter>
      <mask id="skm${id}">
        <g fill="#fff">
          <path d="M50 8 C 25 8 12 25 12 46 C 12 60 18 68 26 72 L 26 84 C 26 88 30 91 34 91 L 66 91 C 70 91 74 88 74 84 L 74 72 C 82 68 88 60 88 46 C 88 25 75 8 50 8 Z"/>${horns}
        </g>
        <g fill="#000">
          <path d="M 22 44 C 22 36 30 33 37 35 C 44 37 46 44 44 52 C 42 58 30 60 25 55 C 22 52 22 48 22 44 Z"/>
          <path d="M 78 44 C 78 36 70 33 63 35 C 56 37 54 44 56 52 C 58 58 70 60 75 55 C 78 52 78 48 78 44 Z"/>
          <path d="M 50 58 L 44 70 L 50 68 L 56 70 Z"/>
          ${[37, 45, 53, 61].map(x => `<rect x="${x}" y="77" width="3" height="14" rx="1"/>`).join('')}
        </g>
      </mask>
    </defs>
    <g filter="url(#sk${id})">
      <rect x="-10" y="-30" width="120" height="140" fill="${k.fill}" mask="url(#skm${id})"/>
      <g class="caul-skull-eyes" fill="${k.eyes}">
        <ellipse cx="34" cy="46" rx="6" ry="6"/><ellipse cx="66" cy="46" rx="6" ry="6"/>
      </g>
    </g>
    ${drips}
  </svg>`;
}
// La figura (calavera o corazón) nace del líquido: la superficie se hincha, revienta
// y la figura sale por la línea del líquido (lo que queda por debajo no se ve).
function emergeFromLiquid({ cls, html, color, big, drips }) {
  const fxh = document.getElementById('caulFxHtml');
  const surf = document.getElementById('caulSurface');
  if (!fxh || !surf || reduceMotion()) return false;
  const fr = fxh.getBoundingClientRect(), sr = surf.getBoundingClientRect();
  if (!sr.width) return false;
  const off = rnd(-.15, .15);                                   // desplazamiento lateral (fracción del ancho)
  const svgX = SURF.cx + off * SURF.rx * 2, svgY = SURF.cy + rnd(-3, 3);
  const px = sr.left - fr.left + sr.width * (.5 + off);
  const waterline = sr.top - fr.top + sr.height * .5;
  const SWELL = 600;
  spawnBubble(true, [svgX, svgY], big ? 18 : 14, SWELL);       // 1) la superficie se hincha
  setTimeout(() => {                                            // 2) revienta y emerge
    if (!document.getElementById('caulFxHtml')) return;
    const well = document.createElement('div');
    well.className = 'caul-skull-well';
    well.style.height = `${waterline}px`;
    const d = document.createElement('div');
    d.className = `caul-skull ${cls}${big ? ' caul-skull-big' : ''}`;
    d.style.left = `${px}px`;
    d.innerHTML = html;
    well.appendChild(d);
    fxh.appendChild(well);
    // Subida en un solo tramo con una única curva (sin tirones entre fotogramas clave)
    const dx = rnd(-30, 30), dur = big ? 4200 : 4800;
    d.animate([
      { transform: 'translate(-50%, 95%) scale(.7)' },
      { transform: `translate(calc(-50% + ${dx}px), -45%) scale(1.25)` },
    ], { duration: dur, easing: 'cubic-bezier(.25,.55,.4,1)', fill: 'forwards' });
    d.animate([{ opacity: 1 }, { opacity: 1, offset: .35 }, { opacity: 0 }],
      { duration: dur, easing: 'linear', fill: 'forwards' });
    droplets(svgX, svgY, big ? 18 : 12, big ? 55 : 40, color);
    for (let i = 0; i < 3; i++) setTimeout(() => popRing(svgX, svgY, 9 + i * 7, true), i * 120);
    surfFlash();
    if (drips) [900, 1500, 2100].forEach(t => setTimeout(() => popRing(svgX + rnd(-12, 12), svgY, 4, true), t));
    setTimeout(() => well.remove(), dur + 100);
  }, SWELL);
  return true;
}
function spawnSkull(tex, big = false) {
  const k = SKULLS[tex]; if (!k) return;
  if (emergeFromLiquid({ cls: k.cls, html: skullSVG(k, ++skullSeq), color: k.drips || k.fill, big, drips: !!k.drips }))
    sfx.skull(tex);
}

// Corazón (reactivo beneficioso): del color del líquido, con brillo y chispas
function heartSVG(look, id) {
  const sparks = [[18, 20], [84, 26], [12, 62], [90, 60], [50, 2]].map(([x, y], i) =>
    `<path class="caul-heart-spark" style="animation-delay:${i * .3}s" d="M ${x} ${y - 5} L ${x + 1.4} ${y - 1.4} L ${x + 5} ${y} L ${x + 1.4} ${y + 1.4} L ${x} ${y + 5} L ${x - 1.4} ${y + 1.4} L ${x - 5} ${y} L ${x - 1.4} ${y - 1.4} Z" fill="#fff"/>`).join('');
  return `<svg viewBox="0 -6 100 106" width="112" height="119" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="hf${id}" x="-30%" y="-30%" width="160%" height="160%">
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="${id % 50}"/>
        <feDisplacementMap in="SourceGraphic" scale="6"/>
        <feGaussianBlur stdDeviation="1"/>
      </filter>
      <radialGradient id="hg${id}" cx="40%" cy="35%" r="70%">
        <stop offset="0%" stop-color="#fff" stop-opacity=".9"/>
        <stop offset="35%" stop-color="${look.light}"/>
        <stop offset="100%" stop-color="${look.deep}"/>
      </radialGradient>
    </defs>
    <g filter="url(#hf${id})">
      <path d="M50 90 C 20 68 6 52 6 33 C 6 19 17 9 30 9 C 39 9 46 14 50 21 C 54 14 61 9 70 9 C 83 9 94 19 94 33 C 94 52 80 68 50 90 Z" fill="url(#hg${id})" opacity=".85"/>
      <ellipse cx="30" cy="28" rx="9" ry="6" fill="#fff" opacity=".55" transform="rotate(-30 30 28)"/>
    </g>
    ${sparks}
  </svg>`;
}
let heartSeq = 0;
function spawnHeart(big = false) {
  if (!curLook) return;
  if (emergeFromLiquid({ cls: 'caul-heart' + (curLook.rainbow ? ' caul-heart-rainbow' : ''), html: heartSVG(curLook, ++heartSeq), color: curLook.light, big }))
    sfx.heart();
}

// Chispas rojas que suben de la mágica maleficiosa
function hellSpark() {
  const fx = document.getElementById('caulFx'); if (!fx) return;
  const [x, y] = surfPoint(.9);
  const c = svgEl('circle', { cx: x, cy: y, r: rnd(1, 2.4), fill: Math.random() < .5 ? '#ff5a1a' : '#ffb02e' }, fx);
  c.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${rnd(-25, 25)}px,${-rnd(60, 130)}px)`, opacity: 0 }],
    { duration: rnd(900, 1700), easing: 'ease-out' }).onfinish = () => c.remove();
}

// ── Ingrediente volando hasta el caldero ──────────────────────────────────────
function flyIn(icon, from, done) {
  const target = document.getElementById('caulSurface')?.getBoundingClientRect();
  if (!target || reduceMotion()) { done(); return; }
  const tx = target.left + target.width / 2, ty = target.top + target.height / 2;
  const fx = from.x, fy = from.y;
  const d = document.createElement('div');
  d.className = 'caul-fly'; d.textContent = icon;
  document.body.appendChild(d);
  const peak = Math.min(fy, ty) - 90;
  flying = true;
  const an = d.animate([
    { transform: `translate(${fx}px,${fy}px) translate(-50%,-50%) scale(1) rotate(0deg)`, easing: 'cubic-bezier(.2,.6,.4,1)' },
    { transform: `translate(${(fx + tx) / 2}px,${peak}px) translate(-50%,-50%) scale(1.25) rotate(200deg)`, offset: .5, easing: 'cubic-bezier(.6,0,.9,.6)' },
    { transform: `translate(${tx}px,${ty}px) translate(-50%,-50%) scale(.35) rotate(380deg)`, opacity: .9 },
  ], { duration: 620 });
  an.onfinish = () => { d.remove(); flying = false; done(); };
}

// ── Brewing / resultado ───────────────────────────────────────────────────────
// Se llama desde app.js al pulsar Elaborar: anima el caldero y luego tira el dado.
export function brewCauldron(done) {
  const stage = document.getElementById('caulStage');
  if (brewing || !stage || reduceMotion()) { if (!brewing) done(); return; }
  brewing = true;
  stage.classList.add('caul-brewing');
  const btn = document.querySelector('[data-action="caul-elaborar"]');
  if (btn) { btn.disabled = true; btn.textContent = '🌀 Removiendo…'; }
  sfx.brew();
  setTimeout(() => {
    stage.classList.remove('caul-brewing');
    brewing = false;
    done();
  }, 1500);
}

function clearResultFx() {
  document.getElementById('caulFxHtml')?.querySelectorAll('.caul-bottle, .caul-smoke-cloud').forEach(e => e.remove());
  document.getElementById('caulStage')?.classList.remove('caul-res-success', 'caul-res-fail');
}

function bottleSVG(look) {
  return `<svg viewBox="0 0 60 80" width="64" height="86" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bottleLiq" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${look.light}"/><stop offset="100%" stop-color="${look.deep}"/></linearGradient></defs>
    <rect x="23" y="4" width="14" height="7" rx="2" fill="#8a5a2b"/>
    <path d="M 24 11 L 24 26 C 10 31 6 42 6 52 C 6 68 18 77 30 77 C 42 77 54 68 54 52 C 54 42 50 31 36 26 L 36 11 Z"
      fill="rgba(255,255,255,.18)" stroke="rgba(255,255,255,.85)" stroke-width="2"/>
    <path d="M 9 50 C 9 66 20 74 30 74 C 40 74 51 66 51 50 C 42 46 18 54 9 50 Z" fill="url(#bottleLiq)"/>
    <path d="M 14 44 C 13 50 14 58 18 64" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

function playSuccess() {
  const stage = document.getElementById('caulStage');
  const fx = document.getElementById('caulFx');
  const fxh = document.getElementById('caulFxHtml');
  if (!stage || !fx || !curLook) return;
  stage.classList.add('caul-res-success');
  sfx.success();
  splash(SURF.cx, true);
  const beam = document.querySelector('#caulSvg .caul-beam');
  if (beam) { beam.style.fill = 'url(#caulBeam)'; beam.animate([{ opacity: 0, transform: 'scaleX(.2)' }, { opacity: .9, transform: 'scaleX(1)', offset: .25 }, { opacity: 0, transform: 'scaleX(.6)' }], { duration: 1400, easing: 'ease-out' }); }
  // Estallido de estrellas
  for (let i = 0; i < 26; i++) {
    const ang = rnd(-Math.PI * .95, -Math.PI * .05), dist = rnd(60, 150);
    const c = svgEl('circle', { cx: SURF.cx + rnd(-30, 30), cy: SURF.cy - 6, r: rnd(1.5, 4),
      fill: [curLook.light, '#fff', '#ffe27a'][i % 3] }, fx);
    c.animate([{ transform: 'translate(0,0)', opacity: 1 },
      { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist}px)`, opacity: 0 }],
      { duration: rnd(700, 1300), delay: i * 18, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'backwards' }).onfinish = () => c.remove();
  }
  // Frasco que sube del caldero
  if (fxh) {
    const b = document.createElement('div');
    b.className = 'caul-bottle';
    b.style.setProperty('--bottle-glow', curLook.light);
    b.innerHTML = bottleSVG(curLook);
    fxh.appendChild(b);
  }
}

function playFail() {
  const stage = document.getElementById('caulStage');
  const fxh = document.getElementById('caulFxHtml');
  if (!stage) return;
  stage.classList.add('caul-res-fail');
  sfx.fail();
  if (caulResultPol === 'Maleficioso') setTimeout(() => spawnSkull(SOLV_LOOK[caulResultCat]?.tex, true), 500);
  setTimeout(() => { spawnBubble(true); spawnBubble(true); droplets(SURF.cx, SURF.cy, 16, 55, '#15120d'); }, 120);
  if (fxh) {
    const cloud = document.createElement('div');
    cloud.className = 'caul-smoke-cloud';
    cloud.innerHTML = Array.from({ length: 9 }, (_, i) => `<span style="--i:${i};--dx:${Math.round(rnd(-60, 60))}px;--s:${rnd(.8, 1.5).toFixed(2)}"></span>`).join('');
    fxh.appendChild(cloud);
  }
}

// ── Dificultad ────────────────────────────────────────────────────────────────
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

// ── Tarjetas de materiales ────────────────────────────────────────────────────
function renderSolvents() {
  const counts = reactivosPorCampo();
  return `<div class="caul-panel-header">💧 Echa un disolvente al caldero <span class="caul-panel-hint">(arrastra o haz clic)</span></div>
    <div class="caul-cards">
      ${CAMPO_NAMES.map(c => {
        const solv = getDisolvente(state.settings, c);
        const cfg  = CAT[c] || {};
        if (!niveles.disolventeOk(c)) return `<div class="caul-card ${cfg.cardClass || ''} caul-card-exhausted caul-card-bloqueada" title="Se aprende en el nivel ${niveles.nivelDisolvente(c)} de alquimia">
          <div class="caul-card-icon">🔒</div>
          <div class="caul-card-body">
            <div class="caul-card-name">${solv.name}</div>
            <div class="caul-card-sub">${c} · nivel ${niveles.nivelDisolvente(c)} de alquimia</div>
          </div>
        </div>`;
        return `<div class="caul-card ${cfg.cardClass || ''} ${c === 'Mágico' ? 'caul-shimmer' : ''}"
            draggable="true" data-drag-type="solv" data-drag-id="${c}" data-icon="${CAMPOS[c].icon}" data-label="${solv.name}" title="Arrastra al caldero o haz clic">
          <div class="caul-card-icon">${CAMPOS[c].icon}</div>
          <div class="caul-card-body">
            <div class="caul-card-name">${solv.name}</div>
            <div class="caul-card-sub">${c} · dif:${solv.difficulty >= 0 ? '+' : ''}${solv.difficulty}</div>
            <div class="caul-card-stock">${counts[c] || 0} reactivo${counts[c] === 1 ? '' : 's'} disponibles</div>
          </div>
          <div class="caul-card-grab">⠿</div>
        </div>`;
      }).join('')}
    </div>`;
}

function renderBases() {
  const solvName = getDisolvente(state.settings, craftSelectedSolvent).name;
  const todas = Object.keys(state.catalog)
    .filter(id => state.catalog[id].type === 'Reactivo' && state.catalog[id].campo === craftSelectedSolvent && (state.inventory[id] || 0) > 0);
  const bases = todas.filter(id => niveles.reactivoOk(state.catalog[id]));
  const bloq = todas.length - bases.length;
  const notaBloq = bloq ? `<p class="muted nivel-bloq" style="padding:4px 12px">🔒 ${bloq} reactivo${bloq === 1 ? '' : 's'} de este disolvente se aprende${bloq === 1 ? '' : 'n'} en un nivel superior de alquimia.</p>` : '';
  if (!bases.length)
    return `<div class="caul-panel-header">🌿 Reactivos</div>
      <p class="muted" style="padding:8px 12px">No tienes reactivos que sepas disolver en ${solvName}.</p>${notaBloq}`;
  return `<div class="caul-panel-header">🌿 Añade un reactivo al caldero <span class="caul-panel-hint">(arrastra o haz clic)</span></div>
    <div class="caul-cards">
      ${bases.map(id => {
        const m   = state.catalog[id];
        const cfg = CAT[m.campo] || {};
        const icon = reactivoIcon(m);
        const name = nombreMat(m);
        return `<div class="caul-card ${cfg.cardClass || ''} ${m.campo === 'Mágico' ? 'caul-shimmer' : ''}"
            draggable="true" data-drag-type="base" data-drag-id="${id}" data-icon="${icon}" data-label="${name}" title="Arrastra al caldero o haz clic">
          <div class="caul-card-icon">${icon}</div>
          <div class="caul-card-body">
            <div class="caul-card-name">${name}</div>
            <div class="caul-card-sub">${m.campo} · ${m.polaridad} · dif:${m.difficulty >= 0 ? '+' : ''}${m.difficulty}</div>
            <div class="caul-card-stock">${rarityBadge(m.rarity)} ×${state.inventory[id]}</div>
          </div>
          <div class="caul-card-grab">⠿</div>
        </div>`;
      }).join('')}
    </div>${notaBloq}`;
}

function renderModifiers() {
  const base = state.catalog[craftSelectedBase];
  if (base?.discriminante)
    return `<div class="caul-panel-header">🚫 Reactivo discriminante</div>
      <p class="muted-i" style="padding:8px 12px">Este reactivo no acepta modificadores.</p>`;

  const mods = Object.keys(state.catalog)
    .filter(id => state.catalog[id].type === 'Modificador' && (state.inventory[id] || 0) > 0);
  const chips = Object.entries(craftSelectedMods)
    .filter(([, qty]) => qty > 0)
    .map(([mid, qty]) => {
      const m = state.catalog[mid];
      return `<span class="caul-mod-chip">${m ? nombreMat(m) : mid} ×${qty}
        <button class="caul-chip-del" data-action="caul-mod-remove" data-id="${mid}">✕</button>
      </span>`;
    }).join('');
  return `<div class="caul-panel-header">🧪 Modificadores <span class="caul-panel-hint">(arrastra o haz clic)</span></div>
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
            const name   = nombreMat(m);
            return `<div class="caul-card caul-card-mod ${!canAdd ? 'caul-card-exhausted' : ''}"
                draggable="${canAdd}" data-drag-type="mod" data-drag-id="${id}" data-icon="${icon}" data-label="${name}"
                title="${!compat.ok ? 'No compatible: ' + compat.reason : canAdd ? 'Arrastra al caldero o haz clic' : 'Límite alcanzado'}">
              <div class="caul-card-icon">${icon}</div>
              <div class="caul-card-body">
                <div class="caul-card-name">${name}${used > 0 ? ` <strong class="caul-used-count">×${used}</strong>` : ''}</div>
                <div class="caul-card-sub">${m.modKind || ''} · ${m.campo} · dif:${m.difficulty >= 0 ? '+' : ''}${m.difficulty}${compat.extraDiff ? ` · +${compat.extraDiff} polaridad` : ''}</div>
                <div class="caul-card-stock">${rarityBadge(m.rarity)} ×${state.inventory[id]}</div>
              </div>
              <div class="caul-card-grab">${canAdd ? '⠿' : '🔒'}</div>
            </div>`;
          }).join('')}
        </div>`}`;
}

// ── Añadir ingredientes ───────────────────────────────────────────────────────
// Devuelve una función que aplica el cambio, o null si el ingrediente no vale ahora.
function prepareAdd(type, id) {
  if (caulCraftState || brewing) return null;
  if (type === 'solv') {
    if (!CAMPOS[id] || !niveles.disolventeOk(id)) return null;
    return () => { setCraftSelectedSolvent(id); setCraftSelectedBase(null); setCraftSelectedMods({}); };
  }
  if (type === 'base') {
    if (!craftSelectedSolvent || state.catalog[id]?.campo !== craftSelectedSolvent || !niveles.reactivoOk(state.catalog[id])) return null;
    return () => { setCraftSelectedBase(id); setCraftSelectedMods({}); };
  }
  if (type === 'mod') {
    if (!craftSelectedBase) return null;
    const m = state.catalog[id]; if (!m) return null;
    if (!modCompat(state.catalog[craftSelectedBase], m, state.settings).ok) return null;
    const used = craftSelectedMods[id] || 0;
    if (used >= (m.maxUses || 99) || used >= (state.inventory[id] || 0)) return null;
    return () => setCraftSelectedMods({ ...craftSelectedMods, [id]: used + 1 });
  }
  return null;
}

function addIngredient(type, id, from, icon, label) {
  if (flying) return;
  const apply = prepareAdd(type, id);
  if (!apply) return;
  const wasEmpty = !curLook;
  flyIn(icon || '⚗️', from, () => {
    if (!prepareAdd(type, id)) return;   // el estado cambió mientras volaba
    apply();
    renderCauldron();
    if (type === 'solv') {
      sfx.pour();
      if (wasEmpty) document.querySelector('#caulSvg .caul-liquid-g')?.animate(
        [{ transform: 'translateY(14px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 700, easing: 'ease-out' });
    } else sfx.plop();
    if (type === 'base') skullTimer = 7;
    splash(SURF.cx + rnd(-25, 25), type !== 'mod');
    if (label) floatText((type === 'mod' ? '+ ' : '') + label, curLook?.light);
  });
}

// ── Montaje de la interfaz ───────────────────────────────────────────────────
function buildSkeleton(panel) {
  panel.innerHTML = `
<div class="caul-layout">
  <div class="caul-left">
    <div class="caul-notif-zone" id="caulNotifArea"></div>
    <div class="caul-svg-section">
      <div class="caul-stage" id="caulStage">
        <div class="caul-svg-wrap" id="caulDropZone">
          ${caulSVG()}
          <div class="caul-fx-html" id="caulFxHtml"></div>
          <div class="caul-drop-hint" id="caulDropHint"><span></span></div>
        </div>
      </div>
    </div>
    <div class="caul-controls" id="caulControls"></div>
  </div>
  <div class="caul-right" id="caulRight"></div>
</div>`;
  curLook = null;
  const zone = document.getElementById('caulDropZone');
  zone.addEventListener('dragover', e => {
    if (caulCraftState || brewing) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('caul-drop-active');
  });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('caul-drop-active'); });
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('caul-drop-active');
    try {
      const { type, id, icon, label } = JSON.parse(e.dataTransfer.getData('text/plain'));
      addIngredient(type, id, { x: e.clientX, y: e.clientY }, icon, label);
    } catch (_) {}
  });
  startAmbient();
}

function attachCards(panel) {
  panel.querySelectorAll('#caulRight .caul-card[draggable="true"]').forEach(card => {
    const payload = () => ({ type: card.dataset.dragType, id: card.dataset.dragId, icon: card.dataset.icon, label: card.dataset.label });
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', JSON.stringify(payload()));
      e.dataTransfer.effectAllowed = 'copy';
      setTimeout(() => card.classList.add('caul-card-dragging'), 0);
    });
    card.addEventListener('dragend', () => card.classList.remove('caul-card-dragging'));
    card.addEventListener('click', () => {
      const r = card.querySelector('.caul-card-icon').getBoundingClientRect();
      const p = payload();
      addIngredient(p.type, p.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, p.icon, p.label);
    });
  });
}

// ── Render principal ──────────────────────────────────────────────────────────
export function renderCauldron() {
  const panel = document.getElementById('craftCalderoPanel');
  if (!panel || panel.style.display === 'none') return;
  if (!panel.querySelector('.caul-layout') || !document.getElementById('caulSvg')) buildSkeleton(panel);

  for (const a of [...caulAplics]) if (!niveles.aplicOk(a)) caulAplics.delete(a);   // p. ej. el DM ha bajado el nivel
  if (!caulAplics.size && niveles.aplicOk('brebaje')) caulAplics.add('brebaje');
  const inResult = caulCraftState !== null;
  const hasSolv  = craftSelectedSolvent !== null;
  const hasBase  = craftSelectedBase !== null;
  const base     = hasBase ? state.catalog[craftSelectedBase] : null;
  const dc       = getDC();
  const conflict = caulAplics.has('inhalable') && caulAplics.has('fumigena');
  const canCraft = hasBase && caulAplics.size > 0 && !conflict && !inResult && !brewing;

  // Zona superior: nombre de la mezcla (en resultado la rellena app.js)
  if (!inResult) {
    let preview = '<em class="caul-empty-hint">El caldero está vacío: echa un disolvente para empezar</em>';
    if (hasSolv && !base) preview = `⚗️ <strong>${getDisolvente(state.settings, craftSelectedSolvent).name}</strong> <em class="caul-empty-hint">· ahora añade un reactivo</em>`;
    if (base) {
      const bn = getDisolvente(state.settings, base.campo).name + ' + ' + nombreMat(base);
      const modNames = Object.keys(craftSelectedMods)
        .filter(mid => craftSelectedMods[mid] > 0 && state.catalog[mid])
        .map(mid => nombreMat(state.catalog[mid]));
      preview = `⚗️ <strong>${bn}${modNames.length ? ` + ${modNames.join(', ')}` : ''}</strong>`;
    }
    document.getElementById('caulNotifArea').innerHTML = `<div class="caul-brew-preview">${preview}</div>`;
  }

  const hint = document.getElementById('caulDropHint');
  hint.style.display = inResult ? 'none' : '';
  hint.firstElementChild.textContent = hasBase ? '+ Añade modificadores' : hasSolv ? '⬇ Añade un reactivo' : '⬇ Echa un disolvente';

  const prevBonus = document.getElementById('caulBonus')?.value ?? '0';
  document.getElementById('caulControls').innerHTML = `
      <div class="caul-aplic-wrap">
        <div class="caul-aplic-title">💊 Aplicación</div>
        <div class="caul-aplic-grid">
          ${APLICACION_OPTIONS.map(opt => {
            const ok = niveles.aplicOk(opt.id);
            return `
            <label class="caul-aplic-btn${caulAplics.has(opt.id) ? ' active' : ''}${inResult || !ok ? ' caul-aplic-disabled' : ''}" ${ok ? '' : `title="Se aprende en el nivel ${niveles.nivelAplic(opt.id)} de alquimia"`}>
              <input type="checkbox" name="caulAplic" value="${opt.id}" ${caulAplics.has(opt.id) ? 'checked' : ''} ${inResult || !ok ? 'disabled' : ''}>
              <span class="caul-aplic-name">${ok ? '' : '🔒 '}${opt.label}</span>
              <span class="caul-aplic-diff">${opt.diffMod >= 0 ? '+' : ''}${opt.diffMod}</span>
            </label>`; }).join('')}
        </div>
        ${conflict ? `<p class="caul-conflict">⚠️ Inhalable y Fumígena no son compatibles</p>` : ''}
      </div>
      <div class="caul-bottom">
        ${inResult
          ? `<button class="btn caul-retry-btn" data-action="caul-retry">🔄 Otra poción</button>`
          : `<button class="btn caul-elaborar-btn${canCraft ? ' caul-ready' : ''}" data-action="caul-elaborar" ${!canCraft ? 'disabled' : ''}>🎲 Elaborar</button>`}
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
        ${hasSolv && !inResult ? `<button class="btn btn-sm caul-reset-btn" data-action="caul-reset">✖ Vaciar</button>` : ''}
      </div>`;

  const right = document.getElementById('caulRight');
  right.classList.toggle('caul-right-locked', inResult);
  right.innerHTML = inResult
    ? `<div class="caul-panel-header">${caulCraftState === 'success' ? '✨ ¡Poción lista!' : '💨 La mezcla se ha echado a perder'}</div>
       <p class="muted" style="padding:8px 12px">Pulsa «Otra poción» para volver a empezar.</p>`
    : hasBase ? renderModifiers() : hasSolv ? renderBases() : renderSolvents();

  applyLook(computeLook(craftSelectedSolvent, base));
  attachCards(panel);

  if (!inResult) {
    panel.querySelectorAll('[name="caulAplic"]').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? caulAplics.add(cb.value) : caulAplics.delete(cb.value);
        cb.closest('.caul-aplic-btn').classList.toggle('active', cb.checked);
        const newConflict = caulAplics.has('inhalable') && caulAplics.has('fumigena');
        const newCanCraft = hasBase && caulAplics.size > 0 && !newConflict && !brewing;
        const dcEl  = document.getElementById('caulDcVal');
        const btnEl = panel.querySelector('[data-action="caul-elaborar"]');
        if (dcEl)  dcEl.textContent = getDC() ?? '—';
        if (btnEl) { btnEl.disabled = !newCanCraft; btnEl.classList.toggle('caul-ready', newCanCraft); }
      });
    });
    const caulBonusEl  = document.getElementById('caulBonus');
    const craftBonusEl = document.getElementById('craftBonus');
    if (caulBonusEl && craftBonusEl)
      caulBonusEl.addEventListener('input', () => { craftBonusEl.value = caulBonusEl.value; });
  } else if (resultPending) {
    resultPending = false;
    clearResultFx();
    setTimeout(() => caulCraftState === 'success' ? playSuccess() : caulCraftState === 'fail' && playFail(), 30);
  }
}

// ── Sincroniza la aplicación con las casillas ocultas de la vista texto ──────
export function syncCaulAplics() {
  APLICACION_OPTIONS.forEach(opt => {
    const cb = document.querySelector(`[name="craftAplic"][value="${opt.id}"]`);
    if (cb) cb.checked = caulAplics.has(opt.id);
  });
}

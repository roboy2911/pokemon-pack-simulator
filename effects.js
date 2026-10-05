// Pull effects: sparkles, confetti and a flash when a rare card is revealed. Classic script.
// Can be turned off in the Shop tab (Appearance) and respects the "reduce motion" setting.

let fxKey = 'pokemonPackFx';
let fxOn = true;
try { if (localStorage.getItem(fxKey) === 'off') { fxOn = false; } } catch (e) {}

function setFx(on) {
  fxOn = !!on;
  try { localStorage.setItem(fxKey, fxOn ? 'on' : 'off'); } catch (e) {}
}

function fxReduced() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

function fxLayer() {
  let el = document.getElementById('fx-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fx-layer';
    document.body.appendChild(el);
  }
  return el;
}

// tier: 1 = small, 2 = medium, 3 = big (same tiers as the reveal chimes)
function fxReveal(tier) {
  if (!fxOn || !(tier >= 1)) { return; }
  let top = (typeof stackCards !== 'undefined' && typeof topIndex !== 'undefined') ? stackCards[topIndex] : null;
  if (top) { top.classList.add('fx-glow' + Math.min(3, tier)); }
  if (fxReduced()) { return; }
  let layer = fxLayer();
  let pack = document.getElementById('pack');
  let r = pack ? pack.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
  let cx = r.left + r.width / 2;
  let cy = r.top + Math.min(r.height, 400) / 2;
  if (tier >= 3) {
    let flash = document.createElement('div');
    flash.className = 'fx-flash';
    layer.appendChild(flash);
    setTimeout(function () { if (flash.parentNode) { flash.parentNode.removeChild(flash); } }, 700);
  }
  let count = tier === 1 ? 14 : (tier === 2 ? 36 : 80);
  let palettes = {
    1: ['#ffffff', '#bfe3ff', '#e9f6ff'],
    2: ['#ffe27a', '#ffc933', '#fff3b0', '#ffffff'],
    3: ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b388ff', '#ffffff']
  };
  let colors = palettes[Math.min(3, tier)];
  for (let i = 0; i < count; i++) {
    let p = document.createElement('div');
    p.className = 'fx-p' + (tier >= 2 && i % 3 === 0 ? ' fx-rect' : '');
    let angle = Math.random() * Math.PI * 2;
    let dist = 90 + Math.random() * (tier === 1 ? 90 : 240);
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.setProperty('--dx', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--dy', Math.round(Math.sin(angle) * dist - 40) + 'px');
    p.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
    p.style.animationDuration = (0.9 + Math.random() * 0.8) + 's';
    layer.appendChild(p);
    setTimeout(function () { if (p.parentNode) { p.parentNode.removeChild(p); } }, 1900);
  }
}

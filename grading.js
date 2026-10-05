// Card grading. Classic script, loaded after script.js, effects.js and achievements.js.
// You send one card away, wait, and it comes back in a slab with a grade from 1 to 10.
// The grade comes from that copy's hidden score (the score itself is never shown).
// Slabs and pending submissions live in the "settled" map ("gr:slabs", "gr:sub") so they save online with everything else.

let gradeTiers = [
  { id: 'g12', name: 'Economy', cost: 1000, hours: 12 },
  { id: 'g6', name: 'Standard', cost: 5000, hours: 6 },
  { id: 'g3', name: 'Express', cost: 10000, hours: 3 },
  { id: 'g1', name: 'Priority', cost: 25000, hours: 1 }
];

// How much a grade changes a card's market value
let gradeMult = { 10: 3, 9: 1.8, 8: 1.3, 7: 1, 6: 0.9, 5: 0.8, 4: 0.6, 3: 0.5, 2: 0.4, 1: 0.3 };
let gradeMax = 20;          // most submissions waiting at once
let gradeFast = false;      // tests only: skip the reveal delays

function gradeFromScore(score) {
  let s = Number(score) || 0;
  if (s >= 990) { return 10; }
  if (s >= 965) { return 9; }
  if (s >= 930) { return 8; }
  if (s >= 890) { return 7; }
  if (s >= 850) { return 6; }
  if (s >= 800) { return 5; }
  if (s >= 750) { return 4; }
  if (s >= 700) { return 3; }
  if (s >= 650) { return 2; }
  return 1;
}

function gradeTier(id) {
  for (let i = 0; i < gradeTiers.length; i++) { if (gradeTiers[i].id === id) { return gradeTiers[i]; } }
  return null;
}

function gradeName(g) {
  let names = { 10: 'Gem Mint', 9: 'Mint', 8: 'Near Mint-Mint', 7: 'Near Mint', 6: 'Excellent-Mint', 5: 'Excellent', 4: 'Very Good', 3: 'Good', 2: 'Fair', 1: 'Poor' };
  return names[g] || '';
}

// Cleans one slab or submission read from the save (it may come from an online save)
function grCleanCard(c) {
  if (!c || typeof c !== 'object') { return null; }
  let key = typeof c.key === 'string' ? c.key.slice(0, 300) : '';
  if (!key) { return null; }
  let img = typeof c.img === 'string' ? c.img : '';
  if (img !== '' && !goodImageUrl(img)) { return null; }
  let score = Math.floor(Number(c.score));
  if (!(score >= 0 && score <= 1000)) { return null; }
  return {
    id: typeof c.id === 'string' ? c.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '',
    key: key, img: img,
    rarity: typeof c.rarity === 'string' ? c.rarity.slice(0, 40) : 'Common',
    name: typeof c.name === 'string' ? c.name.slice(0, 40) : '',
    color: (typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color)) ? c.color : '',
    score: score, t: Math.floor(Number(c.t)) || 0
  };
}

function grCleanSlabMap(raw) {
  let out = {};
  if (!raw || typeof raw !== 'object') { return out; }
  for (let id in raw) {
    let c = grCleanCard(raw[id]);
    if (!c || !c.id) { continue; }
    c.grade = Math.max(1, Math.min(10, Math.floor(Number(raw[id].grade)) || gradeFromScore(c.score)));
    out[c.id] = c;
  }
  return out;
}

// A list of slabs from a trade (cleaned, at most max long)
function grCleanSlabList(arr, max) {
  let out = [];
  if (!Array.isArray(arr)) { return out; }
  for (let i = 0; i < arr.length && out.length < max; i++) {
    let c = grCleanCard(arr[i]);
    if (!c || !c.id) { continue; }
    c.grade = Math.max(1, Math.min(10, Math.floor(Number(arr[i].grade)) || gradeFromScore(c.score)));
    out.push(c);
  }
  return out;
}

function grSlabs() {
  return grCleanSlabMap(settled['gr:slabs']);
}

function grSubs() {
  let raw = settled['gr:sub'];
  let out = [];
  if (!Array.isArray(raw)) { return out; }
  for (let i = 0; i < raw.length; i++) {
    let c = grCleanCard(raw[i]);
    if (!c || !c.id) { continue; }
    let tier = gradeTier(raw[i].tier);
    if (!tier) { continue; }
    c.tier = tier.id;
    c.ready = Math.floor(Number(raw[i].ready)) || 0;
    out.push(c);
  }
  return out;
}

function grSave(slabs, subs) {
  if (slabs) { settled['gr:slabs'] = slabs; }
  if (subs) { settled['gr:sub'] = subs; }
  saveSettled();
  cloudChanged();
}

function grNewId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Adds a slab to your collection (used by the reveal and by market / auction returns)
function slabAdd(card) {
  let slabs = grSlabs();
  let c = grCleanCard(card);
  if (!c) { return null; }
  c.id = c.id && !slabs[c.id] ? c.id : grNewId();
  c.grade = Math.max(1, Math.min(10, Math.floor(Number(card.grade)) || gradeFromScore(c.score)));
  slabs[c.id] = c;
  grSave(slabs, null);
  return c;
}

// Takes a slab out of your collection. Returns the slab or null.
function slabTake(id) {
  let slabs = grSlabs();
  let c = slabs[id];
  if (!c) { return null; }
  delete slabs[id];
  grSave(slabs, null);
  return c;
}

// Market value in AUD of a slab, or null while the price is still loading
function slabValue(slab) {
  if (slab.rarity === 'Energy') { return null; }
  let id = priceIdFromUrl(slab.img || slab.key);
  if (!id || !priceCache[id]) { return null; }
  return priceCache[id].eur * eurToAud * (gradeMult[slab.grade] || 1);
}

function slabSellValue(slab) {
  return Math.max(1, Math.round(sellValue(slab.rarity, slab.key) * (gradeMult[slab.grade] || 1)));
}

// ---------- Sending a card away ----------

function gradeSubmit(key, tierId) {
  if (typeof unlimited !== 'undefined' && unlimited) { return; }
  let tier = gradeTier(tierId);
  let data = loadCollection();
  let card = data.cards[key];
  if (!tier || !card || card.count < 1 || card.rarity === 'Energy') { return; }
  let subs = grSubs();
  if (subs.length >= gradeMax) { toast('You can only have ' + gradeMax + ' cards at the grader at once.'); return; }
  if (coins < tier.cost) { toast('Not enough coins (' + tier.cost.toLocaleString() + ' needed).'); return; }
  // your best copy goes
  let g = scoresOf(card, key);
  let bestAt = 0;
  for (let i = 1; i < g.length; i++) { if (g[i] > g[bestAt]) { bestAt = i; } }
  let score = g[bestAt];
  g.splice(bestAt, 1);
  if (g.length === 0) { delete data.cards[key]; } else { card.g = g; card.count = g.length; }
  coins = coins - tier.cost;
  let now = Date.now();
  subs.push({ id: grNewId(), key: key, img: card.img || '', rarity: card.rarity, name: card.name || '', color: card.color || '', score: score, tier: tier.id, ready: now + tier.hours * 3600000, t: now });
  saveCollection(data);
  saveCoins();
  updateShop();
  grSave(null, subs);
  logEvent('grade_send', { k: key, r: card.rarity, tier: tier.id, coins: tier.cost });
  toast('Sent for grading. Back in ' + tier.hours + ' hour' + (tier.hours === 1 ? '' : 's') + '.');
  renderCollection();
  renderGrading();
}

// ---------- Getting it back ----------

function gradeCountdown(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  let h = Math.floor(s / 3600);
  let m = Math.floor((s % 3600) / 60);
  let sec = s % 60;
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + (h ? '' : sec + 's');
}

function gradeSubGrades(slab) {
  let seed = 0;
  let src = slab.id + slab.key;
  for (let i = 0; i < src.length; i++) { seed = (Math.imul(seed, 31) + src.charCodeAt(i)) >>> 0; }
  let names = ['Centering', 'Corners', 'Edges', 'Surface'];
  let out = [];
  for (let i = 0; i < 4; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    let o = slab.grade === 10 ? 0 : ((seed >>> 8) % 5 - 2) * 0.5;
    let v = slab.grade + o;
    if (slab.grade < 10) { v = Math.min(v, 9.5); }
    v = Math.max(1, Math.min(10, v));
    out.push({ name: names[i], v: v });
  }
  return out;
}

function slabHtml(slab, small) {
  let img = slab.img ? '<img src="' + esc(slab.img) + '" alt="" draggable="false">' : energyBox({ name: slab.name, color: slab.color || '#888888' }, 300, 418);
  return '<div class="slab g' + slab.grade + (small ? ' small' : '') + '"><div class="slab-top"><span class="slab-name">' + esc(slab.name || slab.rarity) + '</span><span class="slab-grade">' + slab.grade + '</span></div>' +
    '<div class="slab-card">' + img + '</div></div>';
}

function gradeReveal(id) {
  let subs = grSubs();
  let at = -1;
  for (let i = 0; i < subs.length; i++) { if (subs[i].id === id) { at = i; } }
  if (at === -1) { return; }
  let sub = subs[at];
  if (sub.ready > Date.now()) { return; }
  // Move it into your slabs first, so closing the page mid-reveal loses nothing
  subs.splice(at, 1);
  let slab = slabAdd({ id: sub.id, key: sub.key, img: sub.img, rarity: sub.rarity, name: sub.name, color: sub.color, score: sub.score, t: Date.now(), grade: gradeFromScore(sub.score) });
  grSave(null, subs);
  if (!slab) { renderGrading(); return; }
  logEvent('grade_done', { k: sub.key, r: sub.rarity, grade: slab.grade });
  if (typeof achEvent === 'function') {
    achEvent('graded');
    if (slab.grade === 10) { achEvent('grade10'); }
  }
  playGradeReveal(slab);
  renderGrading();
}

function playGradeReveal(slab) {
  let el = document.getElementById('gr-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gr-overlay';
    document.body.appendChild(el);
  }
  let subsG = gradeSubGrades(slab);
  let rows = '';
  for (let i = 0; i < subsG.length; i++) {
    rows += '<div class="gr-sub" id="gr-sub' + i + '"><span>' + subsG[i].name + '</span><b>' + subsG[i].v.toFixed(1) + '</b></div>';
  }
  el.innerHTML = '<div class="gr-box"><div class="gr-title" id="gr-title">Grading in progress...</div>' +
    '<div class="gr-stage" id="gr-stage">' + slabHtml(slab) + '<div class="gr-seal" id="gr-seal"></div></div>' +
    '<div class="gr-subs">' + rows + '</div>' +
    '<div class="gr-final" id="gr-final"></div>' +
    '<button class="dev-btn" id="gr-close" style="display:none">Done</button></div>';
  el.style.display = 'flex';
  let stage = document.getElementById('gr-stage');
  let close = function () { el.style.display = 'none'; el.innerHTML = ''; renderGrading(); };
  document.getElementById('gr-close').onclick = close;
  let done = function () {
    document.getElementById('gr-title').textContent = gradeName(slab.grade);
    let fin = document.getElementById('gr-final');
    fin.innerHTML = '<span class="gr-num g' + slab.grade + '">' + slab.grade + '</span>';
    fin.classList.add('show');
    stage.classList.add('done');
    document.getElementById('gr-close').style.display = '';
    if (typeof fxReveal === 'function') {
      let tier = slab.grade >= 10 ? 3 : (slab.grade >= 9 ? 2 : (slab.grade >= 8 ? 1 : 0));
      if (tier) { fxReveal(tier); }
    }
    if (typeof playTone === 'function') { playTone(slab.grade >= 9 ? 880 : 520, 0, 0.25, 0.2, 'triangle'); }
  };
  if (gradeFast) {
    for (let i = 0; i < 4; i++) { document.getElementById('gr-sub' + i).classList.add('show'); }
    done();
    return;
  }
  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  let step = reduced ? 150 : 750;
  for (let i = 0; i < 4; i++) {
    setTimeout(function () {
      let r = document.getElementById('gr-sub' + i);
      if (r) { r.classList.add('show'); }
      if (typeof playTone === 'function') { playTone(400 + i * 80, 0, 0.08, 0.12, 'sine'); }
    }, step * (i + 1));
  }
  setTimeout(function () {
    let t = document.getElementById('gr-title');
    if (t) { t.textContent = 'Sealing the slab...'; }
  }, step * 5);
  setTimeout(function () { if (document.getElementById('gr-final')) { done(); } }, step * 6.5);
}

// ---------- The Grading tab ----------

let gradePick = '';      // card chosen to send
let gradeTierPick = 'g12';
let gradeTimer = null;

function gradeSellSlab(id) {
  let slabs = grSlabs();
  let slab = slabs[id];
  if (!slab) { return; }
  let value = slabSellValue(slab);
  if (!confirm('Quick-sell this grade ' + slab.grade + ' slab for ' + value + ' coins?')) { return; }
  slabTake(id);
  addCoins(value);
  logEvent('slab_sell', { k: slab.key, r: slab.rarity, grade: slab.grade, coins: value });
  renderGrading();
}

function gradePickerHtml() {
  let data = loadCollection();
  let keys = Object.keys(data.cards).filter(function (k) { return data.cards[k].rarity !== 'Energy'; });
  keys.sort(function (a, b) {
    let ra = priceIdFromUrl(data.cards[a].img || a), rb = priceIdFromUrl(data.cards[b].img || b);
    let pa = ra && priceCache[ra] ? priceCache[ra].eur : 0, pb = rb && priceCache[rb] ? priceCache[rb].eur : 0;
    return pb - pa;
  });
  if (!keys.length) { return '<div class="tempty">You have no cards to grade yet.</div>'; }
  let html = '';
  for (let i = 0; i < keys.length && i < 400; i++) {
    let c = data.cards[keys[i]];
    html += '<button class="gr-pick' + (gradePick === keys[i] ? ' sel' : '') + '" data-gkey="' + esc(keys[i]) + '" title="' + esc(c.name || c.rarity) + '"><img src="' + esc(c.img || '') + '" alt="" loading="lazy">' + (c.count > 1 ? '<span class="gr-x">x' + c.count + '</span>' : '') + '</button>';
  }
  return '<div class="gr-picker">' + html + '</div>';
}

function renderGrading() {
  let root = document.getElementById('grade-root');
  if (!root) { return; }
  if (typeof unlimited !== 'undefined' && unlimited) { root.innerHTML = ''; return; }
  let now = Date.now();
  let subs = grSubs();
  let slabs = grSlabs();
  let ids = Object.keys(slabs).sort(function (a, b) { return slabs[b].t - slabs[a].t; });

  let tiers = '';
  for (let i = 0; i < gradeTiers.length; i++) {
    let t = gradeTiers[i];
    tiers += '<button class="gr-tier' + (gradeTierPick === t.id ? ' sel' : '') + '" data-gtier="' + t.id + '"><b>' + t.name + '</b><br>' + t.hours + ' hour' + (t.hours === 1 ? '' : 's') + '<br>' + t.cost.toLocaleString() + ' coins</button>';
  }
  let pickCard = gradePick ? loadCollection().cards[gradePick] : null;
  if (!pickCard) { gradePick = ''; }

  let wait = '';
  for (let i = 0; i < subs.length; i++) {
    let s = subs[i];
    let left = s.ready - now;
    wait += '<div class="gr-wait"><img src="' + esc(s.img || '') + '" alt=""><div class="gr-wait-info"><div>' + esc(s.name || s.rarity) + '</div>' +
      (left > 0 ? '<div class="gr-count" data-ready="' + s.ready + '">' + gradeCountdown(left) + '</div>' : '<div class="gr-count ready">Ready!</div>') + '</div>' +
      (left > 0 ? '' : '<button class="dev-btn" data-greveal="' + s.id + '">Reveal grade</button>') + '</div>';
  }

  let slabHtmls = '';
  for (let i = 0; i < ids.length; i++) {
    let sl = slabs[ids[i]];
    let v = slabValue(sl);
    slabHtmls += '<div class="gr-slabbox">' + slabHtml(sl, true) +
      '<div class="gr-meta">' + (v === null ? '' : esc(currencySymbol + v.toFixed(2)) + ' value<br>') + 'x' + gradeMult[sl.grade] + ' on price</div>' +
      '<button class="link-btn" data-gsell="' + sl.id + '">Quick-sell ' + slabSellValue(sl) + '</button></div>';
  }

  root.innerHTML = '<div class="tcard"><h3>Send a card for grading</h3>' +
    '<div class="tmsg">Your best copy of the card you pick is sent away and comes back in a slab with a grade from 1 to 10. Grades change the card\'s value: 10 is worth 3x, 9 is 1.8x, but 5 and below are worth less than the raw card. The grade is decided by the card\'s hidden condition, so it can\'t be predicted.</div>' +
    '<div class="gr-tiers">' + tiers + '</div>' +
    gradePickerHtml() +
    '<div style="margin-top:10px"><button class="dev-btn" id="gr-send"' + (gradePick ? '' : ' disabled') + '>' + (gradePick ? 'Send selected card' : 'Pick a card first') + '</button></div></div>' +
    (subs.length ? '<div class="tcard"><h3>At the grader (' + subs.length + ')</h3>' + wait + '</div>' : '') +
    '<div class="tcard"><h3>My slabs (' + ids.length + ')</h3>' + (slabHtmls ? '<div class="gr-slabs">' + slabHtmls + '</div>' : '<div class="tempty">No graded cards yet.</div>') + '</div>';
}

document.addEventListener('click', function (e) {
  let t = e.target.closest ? e.target.closest('[data-gkey],[data-gtier],[data-greveal],[data-gsell],#gr-send') : null;
  if (!t || !document.getElementById('grade-root') || !document.getElementById('grade-root').contains(t)) { return; }
  if (t.dataset.gkey) { gradePick = t.dataset.gkey; renderGrading(); }
  else if (t.dataset.gtier) { gradeTierPick = t.dataset.gtier; renderGrading(); }
  else if (t.dataset.greveal) { gradeReveal(t.dataset.greveal); }
  else if (t.dataset.gsell) { gradeSellSlab(t.dataset.gsell); }
  else if (t.id === 'gr-send' && gradePick) {
    let tier = gradeTier(gradeTierPick);
    if (!tier) { return; }
    if (!confirm('Send this card for grading (' + tier.name + ', ' + tier.cost.toLocaleString() + ' coins, ' + tier.hours + ' hour' + (tier.hours === 1 ? '' : 's') + ')?')) { return; }
    let key = gradePick;
    gradePick = '';
    gradeSubmit(key, tier.id);
  }
});

// Tick the countdowns, and tell you when something is ready
let gradeNotified = {};
function gradeTick() {
  let now = Date.now();
  let subs = grSubs();
  let newlyReady = 0;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].ready <= now && !gradeNotified[subs[i].id]) { gradeNotified[subs[i].id] = true; newlyReady++; }
  }
  if (newlyReady) {
    toast(newlyReady === 1 ? 'A graded card is ready to reveal!' : newlyReady + ' graded cards are ready to reveal!');
    addBadge('grading', newlyReady);
    if (curView === 'grading') { renderGrading(); }
    return;
  }
  if (curView === 'grading') {
    document.querySelectorAll('.gr-count[data-ready]').forEach(function (el) {
      let left = Number(el.dataset.ready) - now;
      if (left <= 0) { renderGrading(); } else { el.textContent = gradeCountdown(left); }
    });
  }
}
gradeTimer = setInterval(gradeTick, 1000);

window.renderGrading = renderGrading;
window.gradeSubmit = gradeSubmit;
window.addEventListener('cloud-ready', function () { gradeNotified = {}; renderGrading(); });
window.addEventListener('cloud-out', function () { gradeNotified = {}; renderGrading(); });
renderGrading();

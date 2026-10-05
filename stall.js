// Card Stall. Classic script, loaded after script.js, grading.js and achievements.js.
// You stock a stall with cards and slabs and set prices. Bot customers visit over time and buy what looks fair.
// While you are away the visits are worked out when you come back (up to 24 hours of them).
// Everything lives in the "settled" map under "st:stall", so it saves online with the rest of the save.

let stallSlotBase = 3;
let stallSlotMax = 12;
let stallCatchUp = 24 * 3600000;     // most time that is caught up after being away
let stallLogMax = 14;
let stallBaseChance = 0.01;          // chance a customer buys an item priced at what they think it is worth
let stallChanceCap = 0.5;            // no price makes a sale more likely than this
let stallTestRandom = null;          // tests only: replaces Math.random

let stallUpgrades = [
  { id: 'slots', name: 'Shelf space', desc: 'One more shelf slot per level', max: 9, cost: function (lv) { return 1000 * (lv + 1) * (lv + 1); } },
  { id: 'sign', name: 'Shop sign', desc: 'Customers will pay 5% more per level', max: 5, cost: function (lv) { return 3000 * (lv + 1) * (lv + 1); } },
  { id: 'speed', name: 'Advertising', desc: 'Customers arrive faster (every 10 minutes at first, about every 42 seconds at the top level)', max: 5, cost: function (lv) { return 2500 * (lv + 1) * (lv + 1); } },
  { id: 'decor', name: 'Decorations', desc: 'A fancier stall (looks only)', max: 4, cost: function (lv) { return 5000 * (lv + 1); } }
];

let stallDecorNames = ['Plain table', 'Striped awning', 'Neon sign', 'Golden counter', 'Grand boutique'];

// ---------- The saved data ----------

function stallRand() {
  return stallTestRandom ? stallTestRandom() : Math.random();
}

function stallDay(now) {
  return new Date(now === undefined ? Date.now() : now).toISOString().slice(0, 10);
}

function stallCleanItem(c) {
  if (!c || typeof c !== 'object') { return null; }
  let key = typeof c.key === 'string' ? c.key.slice(0, 300) : '';
  if (!key) { return null; }
  let img = typeof c.img === 'string' ? c.img : '';
  if (img !== '' && !goodImageUrl(img)) { return null; }
  let score = Math.floor(Number(c.score));
  if (!(score >= 0 && score <= 1000)) { return null; }
  let price = Math.floor(Number(c.price));
  if (!(price >= 1)) { return null; }
  let out = {
    key: key, img: img,
    rarity: typeof c.rarity === 'string' ? c.rarity.slice(0, 40) : 'Common',
    name: typeof c.name === 'string' ? c.name.slice(0, 40) : '',
    color: (typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color)) ? c.color : '',
    score: score, price: Math.min(price, 10000000)
  };
  if (c.slab) {
    out.slab = true;
    out.id = typeof c.id === 'string' ? c.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : '';
    out.grade = Math.max(1, Math.min(10, Math.floor(Number(c.grade)) || 1));
    if (!out.id) { return null; }
  }
  return out;
}

function stallState() {
  let raw = settled['st:stall'];
  if (!raw || typeof raw !== 'object') { raw = {}; }
  let lv = raw.lv && typeof raw.lv === 'object' ? raw.lv : {};
  let st = { lv: {}, shelf: [], t: 0, earn: 0, sold: 0, day: { d: '', e: 0 }, log: [] };
  for (let i = 0; i < stallUpgrades.length; i++) {
    let u = stallUpgrades[i];
    st.lv[u.id] = Math.max(0, Math.min(u.max, Math.floor(Number(lv[u.id])) || 0));
  }
  let slots = stallSlots(st);
  if (Array.isArray(raw.shelf)) {
    for (let i = 0; i < raw.shelf.length && st.shelf.length < slots; i++) {
      let it = stallCleanItem(raw.shelf[i]);
      if (it) { st.shelf.push(it); }
    }
  }
  st.t = Math.floor(Number(raw.t)) || 0;
  st.earn = Math.max(0, Math.floor(Number(raw.earn)) || 0);
  st.sold = Math.max(0, Math.floor(Number(raw.sold)) || 0);
  if (raw.day && typeof raw.day === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.day.d))) {
    st.day = { d: raw.day.d, e: Math.max(0, Math.floor(Number(raw.day.e)) || 0) };
  }
  if (Array.isArray(raw.log)) {
    for (let i = 0; i < raw.log.length && st.log.length < stallLogMax; i++) {
      let l = raw.log[i];
      if (!l || typeof l !== 'object') { continue; }
      st.log.push({ t: Math.floor(Number(l.t)) || 0, what: String(l.what || '').slice(0, 80), price: Math.floor(Number(l.price)) || 0, who: String(l.who || '').slice(0, 20) });
    }
  }
  return st;
}

function stallSave(st) {
  settled['st:stall'] = st;
  saveSettled();
  cloudChanged();
}

function stallSlots(st) {
  return Math.min(stallSlotMax, stallSlotBase + (st.lv.slots || 0));
}

// Seconds between customers: 10 minutes at level 0, about 42 seconds at level 5.
// A fully upgraded stall that is always restocked at fair prices makes roughly 300 sales a day.
function stallInterval(st) {
  return Math.round(600 * Math.pow(0.07, (st.lv.speed || 0) / 5)) * 1000;
}

function stallSignBonus(st) {
  return 0.05 * (st.lv.sign || 0);
}

// ---------- What things are worth ----------

// What a customer thinks the item is worth: the market value in coins (quick-sell pays only 40% of this).
// If the price has not loaded yet it is worked back from the fixed quick-sell table.
function stallFair(it) {
  let m = marketCoins(it.key);
  if (it.slab) {
    let mult = typeof gradeMult !== 'undefined' ? (gradeMult[it.grade] || 1) : 1;
    return Math.max(1, Math.round(m !== null ? m * mult : tableSellValue(it.rarity, it.key) * mult / quickSellShare));
  }
  return Math.max(1, Math.round(m !== null ? m : tableSellValue(it.rarity, it.key) / quickSellShare));
}

function stallSetOf(key) {
  return cardSet(key);
}

function stallSetName(id) {
  return SETS[id] ? SETS[id].name : 'Unknown set';
}

function stallItemName(it) {
  let base = it.name || it.rarity;
  return (it.slab ? 'Grade ' + it.grade + ' ' : '') + base + ' (' + stallSetName(stallSetOf(it.key)) + ')';
}

// The set that collectors are chasing today (the same for every player)
let stallSets = ['30th', 'asc', 'tu', 'pe', 'pf'];
function stallHotSet(day) {
  let seed = 7;
  let s = String(day);
  for (let i = 0; i < s.length; i++) { seed = (Math.imul(seed, 31) + s.charCodeAt(i)) >>> 0; }
  return stallSets[seed % stallSets.length];
}

let stallTypes = [
  { id: 'casual', name: 'Casual shopper', weight: 15 },
  { id: 'flipper', name: 'Flipper', weight: 35 },
  { id: 'collector', name: 'Collector', weight: 40 },
  { id: 'whale', name: 'Whale', weight: 10 }
];

function stallPickType() {
  let r = stallRand() * 100;
  for (let i = 0; i < stallTypes.length; i++) {
    r -= stallTypes[i].weight;
    if (r < 0) { return stallTypes[i]; }
  }
  return stallTypes[0];
}

// The most this customer will pay for an item, as a number of coins
function stallWilling(it, cust, st, hot) {
  let fair = stallFair(it);
  let m = 1.1;
  if (cust.type.id === 'flipper') { m = 0.9; }
  if (cust.type.id === 'collector') { m = stallSetOf(it.key) === cust.wants ? (cust.wants === hot ? 1.5 : 1.3) : 0.8; }
  if (cust.type.id === 'whale') { m = (it.slab || fair >= 500) ? 1.7 : 0.6; }
  m = Math.min(2, m + stallSignBonus(st));
  return Math.floor(fair * m);
}

function stallCustomer(hot) {
  let type = stallPickType();
  let c = { type: type, wants: '' };
  if (type.id === 'collector') {
    c.wants = stallRand() < 0.6 ? hot : stallSets[Math.floor(stallRand() * stallSets.length) % stallSets.length];
  }
  return c;
}

// Chance that this customer buys this item on this visit.
// 1% when the price matches what they think it is worth; cheaper is likelier, dearer is rarer.
function stallChance(it, cust, st, hot) {
  let willing = Math.max(1, stallWilling(it, cust, st, hot));
  return Math.min(stallChanceCap, stallBaseChance * Math.pow(willing / it.price, 2));
}

// One customer visits. Returns the index they bought from, or -1.
function stallVisit(st, cust, hot) {
  let order = [];
  for (let i = 0; i < st.shelf.length; i++) { order.push(i); }
  order.sort(function (a, b) { return st.shelf[b].price - st.shelf[a].price; });
  for (let n = 0; n < order.length; n++) {
    let i = order[n];
    if (stallRand() < stallChance(st.shelf[i], cust, st, hot)) { return i; }
  }
  return -1;
}

// ---------- Working out the visits ----------

// Runs every visit since the stall was last looked at. Returns { sold, coins }.
function stallRun(now) {
  let st = stallState();
  let res = { sold: 0, coins: 0 };
  now = now === undefined ? Date.now() : now;
  if (!st.shelf.length) {
    st.t = now;
    settled['st:stall'] = st;
    return res;
  }
  if (!st.t || st.t > now) { st.t = now; }
  if (now - st.t > stallCatchUp) { st.t = now - stallCatchUp; }
  let step = stallInterval(st);
  let n = Math.min(2500, Math.floor((now - st.t) / step));
  if (n < 1) { return res; }
  let hot = stallHotSet(stallDay(now));
  let when = st.t;
  for (let k = 0; k < n; k++) {
    when += step;
    if (!st.shelf.length) { when = now; break; }
    let cust = stallCustomer(hot);
    let at = stallVisit(st, cust, hot);
    if (at === -1) { continue; }
    let it = st.shelf.splice(at, 1)[0];
    res.sold++;
    res.coins += it.price;
    let day = stallDay(when);
    if (st.day.d !== day) { st.day = { d: day, e: 0 }; }
    st.day.e += it.price;
    st.earn += it.price;
    st.sold += 1;
    st.log.unshift({ t: when, what: stallItemName(it), price: it.price, who: cust.type.name + (cust.wants ? ' (wanted ' + stallSetName(cust.wants) + ')' : '') });
  }
  st.log = st.log.slice(0, stallLogMax);
  st.t = st.shelf.length ? when : now;
  if (res.sold) {
    settled['st:stall'] = st;
    addCoins(res.coins);
    stallSave(st);
    logEvent('stall_sold', { n: res.sold, coins: res.coins });
    if (typeof achEvent === 'function') { achEvent('stallsold', res.sold); }
  } else {
    settled['st:stall'] = st;
    saveSettled();
  }
  return res;
}

// ---------- Stocking and taking back ----------

function stallStockCard(key) {
  if (typeof unlimited !== 'undefined' && unlimited) { return false; }
  stallRun();
  let st = stallState();
  if (st.shelf.length >= stallSlots(st)) { toast('Your shelves are full.'); return false; }
  let data = loadCollection();
  let card = data.cards[key];
  if (!card || card.count < 1 || card.rarity === 'Energy') { return false; }
  let score = takeCopies(card, key, 1)[0];
  if (card.count < 1) { delete data.cards[key]; }
  let it = { key: key, img: card.img || '', rarity: card.rarity, name: card.name || '', color: card.color || '', score: score };
  it.price = Math.max(1, Math.round(stallFair(it) * 1.05));
  st.shelf.push(it);
  if (st.shelf.length === 1) { st.t = Date.now(); }
  saveCollection(data);
  stallSave(st);
  return true;
}

function stallStockSlab(id) {
  if (typeof unlimited !== 'undefined' && unlimited) { return false; }
  stallRun();
  let st = stallState();
  if (st.shelf.length >= stallSlots(st)) { toast('Your shelves are full.'); return false; }
  let slab = slabTake(id);
  if (!slab) { return false; }
  let it = { key: slab.key, img: slab.img, rarity: slab.rarity, name: slab.name, color: slab.color, score: slab.score, slab: true, id: slab.id, grade: slab.grade };
  it.price = Math.max(1, Math.round(stallFair(it) * 1.05));
  st.shelf.push(it);
  if (st.shelf.length === 1) { st.t = Date.now(); }
  stallSave(st);
  return true;
}

function stallTakeBack(index) {
  stallRun();
  let st = stallState();
  let it = st.shelf[index];
  if (!it) { return false; }
  st.shelf.splice(index, 1);
  if (it.slab) {
    slabAdd({ id: it.id, key: it.key, img: it.img, rarity: it.rarity, name: it.name, color: it.color, score: it.score, grade: it.grade, t: Date.now() });
  } else {
    let data = loadCollection();
    addCopies(data, it.key, it, [it.score]);
    saveCollection(data);
  }
  stallSave(st);
  return true;
}

function stallSetPrice(index, value) {
  let st = stallState();
  let it = st.shelf[index];
  if (!it) { return false; }
  let p = Math.floor(Number(value));
  if (!(p >= 1)) { return false; }
  it.price = Math.min(p, 10000000);
  stallSave(st);
  return true;
}

function stallBuyUpgrade(id) {
  if (typeof unlimited !== 'undefined' && unlimited) { return false; }
  let up = null;
  for (let i = 0; i < stallUpgrades.length; i++) { if (stallUpgrades[i].id === id) { up = stallUpgrades[i]; } }
  if (!up) { return false; }
  stallRun();
  let st = stallState();
  let lv = st.lv[id] || 0;
  if (lv >= up.max) { return false; }
  let cost = up.cost(lv);
  if (coins < cost) { toast('Not enough money (' + aud(cost) + ' needed).'); return false; }
  coins = coins - cost;
  saveCoins();
  updateShop();
  st.lv[id] = lv + 1;
  stallSave(st);
  logEvent('stall_upgrade', { u: id, lv: lv + 1, coins: cost });
  return true;
}

// ---------- Numbers for the leaderboard and profile ----------

function stallPublic() {
  let st = stallState();
  let today = stallDay();
  return { total: st.earn, sold: st.sold, day: st.day.d, dayEarn: st.day.d === today ? st.day.e : 0 };
}

// ---------- The Stall tab ----------

let stallPickTab = 'cards';
let stallTimer = null;

function stallCountdown(ms) {
  let s = Math.max(0, Math.ceil(ms / 1000));
  let m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

function stallPickerHtml() {
  let html = '';
  if (stallPickTab === 'slabs') {
    let slabs = typeof grSlabs === 'function' ? grSlabs() : {};
    let ids = Object.keys(slabs).sort(function (a, b) { return slabSellValue(slabs[b]) - slabSellValue(slabs[a]); });
    if (!ids.length) { return '<div class="tempty">You have no slabs. Grade a card first.</div>'; }
    for (let i = 0; i < ids.length && i < 200; i++) {
      let s = slabs[ids[i]];
      html += '<button class="gr-pick" data-stslab="' + esc(s.id) + '" title="' + esc(stallItemName({ name: s.name, rarity: s.rarity, key: s.key, slab: true, grade: s.grade })) + '"><img src="' + esc(s.img || '') + '" alt="" loading="lazy"><span class="gr-x">G' + s.grade + '</span></button>';
    }
    return '<div class="gr-picker">' + html + '</div>';
  }
  let data = loadCollection();
  let keys = Object.keys(data.cards).filter(function (k) { return data.cards[k].rarity !== 'Energy'; });
  keys.sort(function (a, b) { return sellValue(data.cards[b].rarity, b) - sellValue(data.cards[a].rarity, a); });
  if (!keys.length) { return '<div class="tempty">You have no cards to stock yet.</div>'; }
  for (let i = 0; i < keys.length && i < 300; i++) {
    let c = data.cards[keys[i]];
    html += '<button class="gr-pick" data-stcard="' + esc(keys[i]) + '" title="' + esc(c.name || c.rarity) + '"><img src="' + esc(c.img || '') + '" alt="" loading="lazy">' + (c.count > 1 ? '<span class="gr-x">x' + c.count + '</span>' : '') + '</button>';
  }
  return '<div class="gr-picker">' + html + '</div>';
}

function renderStall() {
  let root = document.getElementById('stall-root');
  if (!root) { return; }
  if (typeof unlimited !== 'undefined' && unlimited) { root.innerHTML = '<div class="tempty">The stall is not available in Unlimited mode.</div>'; return; }
  let st = stallState();
  let now = Date.now();
  let pub = stallPublic();
  let hot = stallHotSet(stallDay(now));
  let slots = stallSlots(st);
  let next = st.shelf.length ? Math.max(0, st.t + stallInterval(st) - now) : 0;

  let shelf = '';
  for (let i = 0; i < slots; i++) {
    let it = st.shelf[i];
    if (!it) { shelf += '<div class="st-slot empty">Empty<br>shelf</div>'; continue; }
    let fair = stallFair(it);
    let img = it.img ? '<img src="' + esc(it.img) + '" alt="" draggable="false">' : '';
    shelf += '<div class="st-slot' + (it.slab ? ' slab g' + it.grade : '') + '">' + img +
      '<div class="st-name">' + esc(it.slab ? 'Grade ' + it.grade : it.rarity) + '</div>' +
      '<div class="st-fair">Fair ' + aud(fair) + '</div>' +
      '<input class="tinput st-price" type="number" min="0.2" step="0.2" data-stprice="' + i + '" value="' + audVal(it.price) + '" aria-label="Price in A$">' +
      '<button class="link-btn" data-sttake="' + i + '">Take back</button></div>';
  }

  let ups = '';
  for (let i = 0; i < stallUpgrades.length; i++) {
    let u = stallUpgrades[i];
    let lv = st.lv[u.id] || 0;
    ups += '<div class="st-up"><div><b>' + u.name + '</b> (level ' + lv + '/' + u.max + ')<br><span class="st-dim">' + u.desc + '</span></div>' +
      (lv >= u.max ? '<span class="st-dim">Maxed</span>' : '<button class="dev-btn" data-stup="' + u.id + '">' + aud(u.cost(lv)) + '</button>') + '</div>';
  }

  let log = '';
  for (let i = 0; i < st.log.length; i++) {
    let l = st.log[i];
    log += '<div class="st-log">Sold <b>' + esc(l.what) + '</b> for ' + aud(l.price) + ' <span class="st-dim">to a ' + esc(l.who) + '</span></div>';
  }

  root.innerHTML = '<div class="tcard st-banner d' + (st.lv.decor || 0) + '"><h3>' + esc(stallDecorNames[st.lv.decor || 0]) + '</h3>' +
    '<div class="tmsg">Customers visit about every ' + (stallInterval(st) >= 120000 ? Math.round(stallInterval(st) / 60000 * 10) / 10 + ' minutes' : Math.round(stallInterval(st) / 1000) + ' seconds') + ', even while you are away (up to 24 hours). Each customer has only about a 1% chance of buying something at its fair value. Cheaper prices sell more often and dearer ones less. Collectors pay extra for the set they are chasing, flippers want bargains, and whales go for slabs and big hits.</div>' +
    '<div class="st-stats"><span>Today: <b>' + aud(pub.dayEarn) + '</b></span><span>All time: <b>' + aud(st.earn) + '</b></span><span>Sold: <b>' + st.sold + '</b></span>' +
    '<span>Hot set today: <b>' + esc(stallSetName(hot)) + '</b></span>' +
    (st.shelf.length ? '<span>Next customer: <b id="st-next" data-next="' + (now + next) + '">' + stallCountdown(next) + '</b></span>' : '') + '</div></div>' +
    '<div class="tcard"><h3>Shelves (' + st.shelf.length + '/' + slots + ')</h3><div class="st-shelf">' + shelf + '</div></div>' +
    '<div class="tcard"><h3>Stock the stall</h3><div class="gr-tiers"><button class="gr-tier' + (stallPickTab === 'cards' ? ' sel' : '') + '" data-sttab="cards"><b>Cards</b></button><button class="gr-tier' + (stallPickTab === 'slabs' ? ' sel' : '') + '" data-sttab="slabs"><b>Slabs</b></button></div>' +
    '<div class="tmsg">Tap a card to put it on a shelf. One copy goes on the shelf (your lowest condition one) and comes back if you take it down.</div>' + stallPickerHtml() + '</div>' +
    '<div class="tcard"><h3>Upgrades</h3>' + ups + '</div>' +
    '<div class="tcard"><h3>Recent sales</h3>' + (log || '<div class="tempty">No sales yet.</div>') + '</div>';
}

document.addEventListener('click', function (e) {
  let root = document.getElementById('stall-root');
  let t = e.target.closest ? e.target.closest('[data-stcard],[data-stslab],[data-sttake],[data-stup],[data-sttab]') : null;
  if (!t || !root || !root.contains(t)) { return; }
  if (t.dataset.sttab) { stallPickTab = t.dataset.sttab; renderStall(); return; }
  if (t.dataset.stcard) { stallStockCard(t.dataset.stcard); }
  else if (t.dataset.stslab) { stallStockSlab(t.dataset.stslab); }
  else if (t.dataset.sttake) { stallTakeBack(Number(t.dataset.sttake)); }
  else if (t.dataset.stup) { stallBuyUpgrade(t.dataset.stup); }
  renderStall();
  if (typeof renderCollection === 'function') { renderCollection(); }
  if (typeof renderGrading === 'function') { renderGrading(); }
});

document.addEventListener('change', function (e) {
  let t = e.target;
  if (!t || !t.dataset || t.dataset.stprice === undefined) { return; }
  stallSetPrice(Number(t.dataset.stprice), audIn(t.value));
  renderStall();
});

// Check the stall every few seconds, and tell the player when something sold
let stallLastSold = -1;
function stallTick() {
  if (typeof unlimited !== 'undefined' && unlimited) { return; }
  let res = stallRun();
  if (res.sold) {
    toast('Your stall sold ' + res.sold + ' item' + (res.sold === 1 ? '' : 's') + ' for ' + aud(res.coins) + '!');
    if (curView !== 'stall') { addBadge('stall', res.sold); }
    if (curView === 'stall') { renderStall(); }
    return;
  }
  if (curView === 'stall') {
    let el = document.getElementById('st-next');
    if (el) {
      let left = Number(el.dataset.next) - Date.now();
      el.textContent = stallCountdown(left);
    }
  }
}
stallTimer = setInterval(stallTick, 3000);

window.renderStall = renderStall;
window.stallPublic = stallPublic;
window.addEventListener('cloud-ready', function () { setTimeout(stallTick, 500); renderStall(); });
window.addEventListener('cloud-out', renderStall);
renderStall();
setTimeout(stallTick, 1500);

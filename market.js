// Marketplace (Firebase). Loaded as a module after cloud.js.
// Players list single cards for coins. A 5% fee on each sale goes to the community bank (used for giveaways).
import { db, me, pushNow } from './cloud.js';
import {
  collection, doc, setDoc, updateDoc, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FEE_RATE = 0.05;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const MAX_PRICE = 10000000;
const MAX_OPEN = 20;      // most listings one player can have open
const MAX_BATCH = 10;     // most copies listed in one go

let openMap = {};         // all open listings
let mineMap = {};         // listings I am selling
let boughtMap = {};       // listings I bought
let unsubs = [];
let chain = Promise.resolve();
let busy = false;
let loadErr = '';
let lastErr = '';
let ui = { rarity: 'All', sort: 'cheap', pick: null, qty: 1, price: '' };

function $(id) { return document.getElementById(id); }

function feeFor(price) { return Math.floor(price * FEE_RATE); }

// Listing data comes from other players, so it is cleaned before use.
function cardOf(l) {
  if (!l || !l.card || typeof l.card.key !== 'string') { return null; }
  let raw = {};
  raw[l.card.key] = { count: 1, rarity: l.card.rarity, img: l.card.img || '', name: l.card.name || '', color: l.card.color || '' };
  let clean = cleanBackup({ cards: raw, packs: 0 });
  return clean ? clean.cards[l.card.key] : null;
}

function priceOf(l) {
  let p = Math.floor(Number(l && l.price));
  return (p >= 1 && p <= MAX_PRICE) ? p : 0;
}

function logMarket(type, data) {
  if (window.cloudLog) { window.cloudLog(type, data); }
}

function refreshGame() {
  updateShop();
  renderCollection();
}

function removeOne(key) {
  let data = loadCollection();
  if (!data.cards[key] || data.cards[key].count < 1) { return false; }
  data.cards[key].count -= 1;
  if (data.cards[key].count <= 0) { delete data.cards[key]; }
  saveCollection(data);
  return true;
}

function addOne(key, card) {
  let data = loadCollection();
  if (!data.cards[key]) {
    data.cards[key] = { count: 0, rarity: card.rarity, img: card.img, name: card.name, color: card.color };
  }
  data.cards[key].count += 1;
  saveCollection(data);
}

function timeLeft(l) {
  let ms = (l.expires || 0) - Date.now();
  if (ms <= 0) { return 'expired'; }
  let h = Math.floor(ms / 3600000);
  if (h >= 24) { return Math.floor(h / 24) + 'd ' + (h % 24) + 'h left'; }
  return h + 'h ' + Math.floor((ms % 3600000) / 60000) + 'm left';
}

function label(key) {
  key = String(key || '');
  let a = key.match(/\/me02\.5\/(\d{3})\//);
  if (a) { return 'AH #' + Number(a[1]); }
  if (key.indexOf('energy-asc-') === 0) { return key.slice(11) + ' Energy'; }
  let m = key.match(/\/30th\/(\d{3})\//);
  if (m) { return '#' + Number(m[1]); }
  let cc = key.match(/30ccc-(\d+)/);
  if (cc) { return 'CC' + Number(cc[1]); }
  if (key.indexOf('energy-') === 0) { return key.slice(7) + ' Energy'; }
  let x = key.match(/30c-([A-Za-z0-9]+)\.webp/);
  if (x) { return 'Mew ' + x[1]; }
  return '';
}

// ----- Drawing -----

function tile(l, id, mode) {
  let card = cardOf(l);
  let price = priceOf(l);
  if (!card || !price) { return ''; }
  let c = me();
  let mine = c && l.seller === c.uid;
  let action = '';
  if (mode === 'browse') {
    action = mine ? '<div class="mk-note">Your listing</div>'
      : '<button class="dev-btn mk-btn" data-act="buy" data-id="' + esc(id) + '">Buy</button>';
  } else if (mode === 'mine') {
    action = '<button class="dev-btn dev-ghost mk-btn" data-act="cancel" data-id="' + esc(id) + '">Cancel</button>';
  }
  let extra = '';
  if (mode === 'browse') { extra = '<div class="mk-seller">' + esc(l.sellerName || '') + '</div>'; }
  return '<div class="mk-tile">' + binderSlotHtml({ label: '' }, card, 96, 132) +
    '<div class="mk-name">' + esc(label(l.card.key)) + ' <span class="mk-rar">' + esc(card.rarity) + '</span></div>' +
    '<div class="mk-price">' + price.toLocaleString() + ' coins</div>' + extra +
    '<div class="mk-time">' + esc(timeLeft(l)) + '</div>' + action + '</div>';
}

function render() {
  let root = $('market-root');
  if (!root) { return; }
  let c = me();
  if (!c) {
    root.innerHTML = '<div class="tcard"><h3>Marketplace</h3><div class="tempty">Sign in (button at the top left) to buy and sell cards.</div></div>';
    return;
  }
  if (!$('mk-browse')) {
    root.innerHTML =
      '<div class="tcard"><h3>Marketplace</h3><div class="tlabel">Sell cards to other players for coins. A 5% fee is taken from each sale. All fees go to a community bank that is used for giveaways in our Discord.</div></div>' +
      '<div id="mk-sell"></div><div class="tsec-title">For sale</div><div id="mk-filters"></div><div id="mk-browse"></div>' +
      '<div class="tsec-title">Your listings</div><div id="mk-mine"></div>';
    drawSell();
    drawFilters();
  }
  drawBrowse();
  drawMine();
}

function drawFilters() {
  let opts = '<option>All</option>';
  for (let i = 0; i < rarityOrder.length; i++) {
    opts += '<option' + (ui.rarity === rarityOrder[i] ? ' selected' : '') + '>' + esc(rarityOrder[i]) + '</option>';
  }
  $('mk-filters').innerHTML = '<div class="adm-edit">' +
    '<select class="tinput" id="mk-rarity">' + opts + '</select>' +
    '<select class="tinput" id="mk-sort">' +
    '<option value="cheap"' + (ui.sort === 'cheap' ? ' selected' : '') + '>Cheapest first</option>' +
    '<option value="dear"' + (ui.sort === 'dear' ? ' selected' : '') + '>Most expensive first</option>' +
    '<option value="new"' + (ui.sort === 'new' ? ' selected' : '') + '>Newest first</option></select></div>';
  $('mk-rarity').onchange = function () { ui.rarity = this.value; drawBrowse(); };
  $('mk-sort').onchange = function () { ui.sort = this.value; drawBrowse(); };
}

function drawBrowse() {
  let box = $('mk-browse');
  if (!box) { return; }
  let now = Date.now();
  let list = [];
  for (let id in openMap) {
    let l = openMap[id];
    if (l.status !== 'open' || (l.expires || 0) <= now) { continue; }
    let card = cardOf(l);
    if (!card || !priceOf(l)) { continue; }
    if (ui.rarity !== 'All' && card.rarity !== ui.rarity) { continue; }
    list.push([id, l]);
  }
  list.sort(function (a, b) {
    if (ui.sort === 'cheap') { return priceOf(a[1]) - priceOf(b[1]); }
    if (ui.sort === 'dear') { return priceOf(b[1]) - priceOf(a[1]); }
    return (b[1].created || 0) - (a[1].created || 0);
  });
  let html = '';
  for (let i = 0; i < list.length && i < 120; i++) { html += tile(list[i][1], list[i][0], 'browse'); }
  if (loadErr) { box.innerHTML = '<div class="tmsg">Could not load the marketplace (' + esc(loadErr) + '). The database rules for listings may not be published yet.</div>'; return; }
  box.innerHTML = html ? '<div class="mk-grid">' + html + '</div>' + (list.length > 120 ? '<div class="tempty">Showing the first 120 of ' + list.length + '. Use the filters to narrow it down.</div>' : '')
    : '<div class="tempty">Nothing for sale' + (ui.rarity !== 'All' ? ' in ' + esc(ui.rarity) : '') + ' right now.</div>';
}

function drawMine() {
  let box = $('mk-mine');
  if (!box) { return; }
  let open = '', hist = '';
  let ids = Object.keys(mineMap);
  ids.sort(function (a, b) { return (mineMap[b].updated || 0) - (mineMap[a].updated || 0); });
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    let l = mineMap[ids[i]];
    if (l.status === 'open') { open += tile(l, ids[i], 'mine'); }
    else if (n < 8) {
      let card = cardOf(l);
      if (!card) { continue; }
      let text = l.status === 'sold' ? 'Sold for ' + priceOf(l).toLocaleString() + ' coins' : (l.status === 'expired' ? 'Expired, returned' : 'Cancelled, returned');
      hist += '<div class="adm-line">' + esc(label(l.card.key)) + ' (' + esc(card.rarity) + '): ' + esc(text) + '</div>';
      n++;
    }
  }
  let bought = '';
  let bids = Object.keys(boughtMap).sort(function (a, b) { return (boughtMap[b].updated || 0) - (boughtMap[a].updated || 0); });
  for (let i = 0; i < bids.length && i < 8; i++) {
    let l = boughtMap[bids[i]];
    let card = cardOf(l);
    if (!card) { continue; }
    bought += '<div class="adm-line">Bought ' + esc(label(l.card.key)) + ' (' + esc(card.rarity) + ') from ' + esc(l.sellerName || '') + ' for ' + priceOf(l).toLocaleString() + ' coins</div>';
  }
  box.innerHTML = (open ? '<div class="mk-grid">' + open + '</div>' : '<div class="tempty">You have nothing listed.</div>') +
    (hist || bought ? '<div class="tlabel" style="margin-top:12px">Recent activity</div>' + hist + bought : '');
}

function myOpenCount() {
  let n = 0;
  for (let id in mineMap) { if (mineMap[id].status === 'open') { n++; } }
  return n;
}

function cheapestFor(key) {
  let best = 0;
  let now = Date.now();
  for (let id in openMap) {
    let l = openMap[id];
    if (l.status !== 'open' || (l.expires || 0) <= now || !l.card || l.card.key !== key) { continue; }
    let p = priceOf(l);
    if (p && (!best || p < best)) { best = p; }
  }
  return best;
}

function drawSell() {
  let box = $('mk-sell');
  if (!box) { return; }
  let cards = loadCollection().cards;
  let keys = Object.keys(cards).sort(function (a, b) {
    let ra = rarityOrder.indexOf(cards[a].rarity); if (ra === -1) { ra = 99; }
    let rb = rarityOrder.indexOf(cards[b].rarity); if (rb === -1) { rb = 99; }
    return ra - rb;
  });
  if (ui.pick && !cards[ui.pick]) { ui.pick = null; }
  let grid = '';
  for (let i = 0; i < keys.length; i++) {
    let k = keys[i];
    grid += '<div class="tpick' + (ui.pick === k ? ' sel' : '') + '" data-act="mkpick" data-key="' + esc(k) + '">' +
      binderSlotHtml({ label: '' }, cards[k], 64, 88) + '</div>';
  }
  let hint = '';
  if (ui.pick) {
    let c = cards[ui.pick];
    let cheap = cheapestFor(ui.pick);
    hint = '<div class="tlabel">Selected: ' + esc(label(ui.pick)) + ' (' + esc(c.rarity) + '), you own ' + c.count +
      '. Quick-sell value: ' + sellValue(c.rarity) + ' coins.' + (cheap ? ' Cheapest listed now: ' + cheap.toLocaleString() + ' coins.' : '') + '</div>';
  } else {
    hint = '<div class="tlabel">Tap a card to select it.</div>';
  }
  box.innerHTML = '<div class="tcard"><h3>Sell a card</h3>' +
    (keys.length ? '<div class="tpicker">' + grid + '</div>' : '<div class="tempty">You have no cards to sell.</div>') + hint +
    '<div class="adm-edit">Price (each): <input class="tinput tcoin-in" id="mk-price" type="number" min="1" placeholder="coins" value="' + esc(ui.price) + '"> ' +
    'Copies: <input class="tinput tcoin-in" id="mk-qty" type="number" min="1" max="' + MAX_BATCH + '" value="' + ui.qty + '" style="width:70px"> ' +
    '<button class="dev-btn" data-act="list">List for sale</button></div>' +
    '<div class="tcoins" id="mk-after"></div>' +
    '<div class="tmsg" id="mk-msg"></div></div>';
  $('mk-price').oninput = function () { ui.price = this.value; updateAfter(); };
  $('mk-qty').oninput = function () { ui.qty = Math.max(1, Math.floor(Number(this.value)) || 1); };
  updateAfter();
}

function updateAfter() {
  let el = $('mk-after');
  if (!el) { return; }
  let p = Math.floor(Number(ui.price));
  if (p >= 1) {
    el.textContent = 'You receive ' + (p - feeFor(p)).toLocaleString() + ' coins per sale (fee ' + feeFor(p).toLocaleString() + ').';
  } else {
    el.textContent = '';
  }
}

function setMsg(text, ok) {
  let el = $('mk-msg');
  if (!el) { return; }
  el.textContent = text;
  el.className = 'tmsg' + (ok ? ' ok' : '');
}

// ----- Selling -----

async function listCards() {
  let c = me();
  if (!c || busy) { return; }
  let cards = loadCollection().cards;
  if (!ui.pick || !cards[ui.pick]) { setMsg('Tap a card to sell first.'); return; }
  let price = Math.floor(Number(ui.price));
  if (!(price >= 1) || price > MAX_PRICE) { setMsg('Enter a price between 1 and ' + MAX_PRICE.toLocaleString() + ' coins.'); return; }
  let qty = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number(ui.qty)) || 1));
  if (qty > cards[ui.pick].count) { setMsg('You only own ' + cards[ui.pick].count + ' of that card.'); return; }
  if (myOpenCount() + qty > MAX_OPEN) { setMsg('You can have at most ' + MAX_OPEN + ' cards listed at once.'); return; }
  let key = ui.pick;
  let src = cards[key];
  let card = { key: key, rarity: src.rarity || 'Common', img: src.img || '', name: src.name || '', color: src.color || '' };
  busy = true;
  setMsg('Listing...', true);
  let done = 0;
  for (let i = 0; i < qty; i++) {
    // The card is held in the listing until it sells or you cancel
    if (!removeOne(key)) { break; }
    try {
      await pushNow();
      await setDoc(doc(collection(db, 'listings')), {
        seller: c.uid, sellerName: c.name, buyer: '', buyerName: '',
        card: card, price: price, status: 'open', sellerDone: false, buyerDone: false,
        created: Date.now(), expires: Date.now() + WEEK, updated: Date.now()
      });
      done++;
    } catch (e) {
      lastErr = (e && e.code) ? e.code : 'error';
      addOne(key, card);
      try { await pushNow(); } catch (e2) {}
      break;
    }
  }
  busy = false;
  refreshGame();
  if (done) {
    logMarket('market_list', { k: key, r: card.rarity, price: price, n: done });
    setMsg('Listed ' + done + ' x ' + label(key) + ' for ' + price.toLocaleString() + ' coins each.', true);
  } else {
    setMsg('Could not list that (' + lastErr + '). Nothing was lost. If it says permission-denied, publish the new database rules.');
  }
  drawSell();
  if (done) { setMsg('Listed ' + done + ' x ' + label(key) + ' for ' + price.toLocaleString() + ' coins each.', true); }
  else { setMsg('Could not list that (' + lastErr + '). Nothing was lost. If it says permission-denied, publish the new database rules.'); }
}

async function cancelListing(id) {
  let l = mineMap[id];
  if (!l || l.status !== 'open') { return; }
  try {
    await updateDoc(doc(db, 'listings', id), { status: 'cancelled', updated: Date.now() });
    logMarket('market_cancel', { k: l.card.key, price: priceOf(l) });
  } catch (e) {
    $('info').innerText = 'Could not cancel that listing (it may have just sold).';
  }
}

// ----- Buying -----

async function buyListing(id) {
  let c = me();
  let l = openMap[id];
  if (!c || !l || busy) { return; }
  let card = cardOf(l);
  let price = priceOf(l);
  if (!card || !price || l.status !== 'open' || l.seller === c.uid) { return; }
  if ((l.expires || 0) <= Date.now()) { $('info').innerText = 'That listing has expired.'; return; }
  if (coins < price) { $('info').innerText = 'Not enough coins (' + price.toLocaleString() + ' needed).'; return; }
  if (!confirm('Buy ' + label(l.card.key) + ' (' + card.rarity + ') from ' + (l.sellerName || 'this player') + ' for ' + price.toLocaleString() + ' coins?')) { return; }
  busy = true;
  coins = coins - price;
  saveCoins();
  updateShop();
  try {
    await pushNow();
    await updateDoc(doc(db, 'listings', id), { status: 'sold', buyer: c.uid, buyerName: c.name, updated: Date.now() });
  } catch (e) {
    coins = coins + price;
    saveCoins();
    updateShop();
    try { await pushNow(); } catch (e2) {}
    $('info').innerText = 'Could not buy that (someone else may have got it first). You were not charged.';
    busy = false;
    return;
  }
  busy = false;
  logMarket('market_buy', { k: l.card.key, r: card.rarity, price: price, from: l.sellerName || '' });
  runProcess();
}

// ----- Paying out -----

function runProcess() {
  chain = chain.then(processAll).catch(function () {});
}

async function processAll() {
  let c = me();
  if (!c) { return; }
  let notes = [];
  let now = Date.now();

  for (let id in mineMap) {
    let l = mineMap[id];
    if (l.status === 'open' && (l.expires || 0) <= now) {
      try {
        await updateDoc(doc(db, 'listings', id), { status: 'expired', updated: Date.now() });
      } catch (e) {}
      continue;
    }
    if (l.status === 'open' || l.sellerDone) { continue; }
    let card = cardOf(l);
    let price = priceOf(l);
    if (l.status === 'sold') {
      let key = 'mkt:' + id + ':sell';
      if (!settled[key]) {
        let got = Math.max(0, price - feeFor(price));
        coins = coins + got;
        settled[key] = true;
        saveSettled();
        saveCoins();
        await pushNow();
        logMarket('market_sold', { k: l.card.key, price: price, fee: feeFor(price), to: l.buyerName || '' });
        notes.push('Sold ' + label(l.card.key) + ' for ' + got.toLocaleString() + ' coins.');
      }
    } else if (l.status === 'cancelled' || l.status === 'expired') {
      let key = 'mkt:' + id + ':ret';
      if (!settled[key] && card) {
        addOne(l.card.key, card);
        settled[key] = true;
        saveSettled();
        await pushNow();
        notes.push(label(l.card.key) + ' was returned to your collection.');
      }
    }
    try {
      await updateDoc(doc(db, 'listings', id), { sellerDone: true, updated: Date.now() });
      l.sellerDone = true;
    } catch (e) {}
  }

  for (let id in boughtMap) {
    let l = boughtMap[id];
    if (l.status !== 'sold' || l.buyerDone) { continue; }
    let card = cardOf(l);
    let key = 'mkt:' + id + ':buy';
    if (!settled[key] && card) {
      addOne(l.card.key, card);
      settled[key] = true;
      saveSettled();
      await pushNow();
      notes.push('You bought ' + label(l.card.key) + '!');
    }
    try {
      await updateDoc(doc(db, 'listings', id), { buyerDone: true, updated: Date.now() });
      l.buyerDone = true;
    } catch (e) {}
  }

  if (notes.length) { $('info').innerText = notes.join(' '); }
  refreshGame();
  if (typeof checkRewards === 'function') { checkRewards(); }
  render();
  drawSell();
}

// ----- Listening -----

function stopListening() {
  for (let i = 0; i < unsubs.length; i++) { unsubs[i](); }
  unsubs = [];
}

function startListening() {
  stopListening();
  let c = me();
  if (!c) { return; }
  function watch(q, map, dropRemoved) {
    return onSnapshot(q, function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') { if (dropRemoved) { delete map[ch.doc.id]; } }
        else { map[ch.doc.id] = ch.doc.data(); }
      });
      render();
      runProcess();
    }, function (err) {
      loadErr = (err && err.code) ? err.code : 'error';
      render();
    });
  }
  unsubs.push(watch(query(collection(db, 'listings'), where('status', '==', 'open')), openMap, true));
  unsubs.push(watch(query(collection(db, 'listings'), where('seller', '==', c.uid)), mineMap, false));
  unsubs.push(watch(query(collection(db, 'listings'), where('buyer', '==', c.uid)), boughtMap, false));
}

function reset() {
  openMap = {}; mineMap = {}; boughtMap = {};
  loadErr = '';
  ui = { rarity: 'All', sort: 'cheap', pick: null, qty: 1, price: '' };
  if ($('market-root')) { $('market-root').innerHTML = ''; }
}

window.addEventListener('cloud-ready', function () { reset(); startListening(); render(); });
window.addEventListener('cloud-out', function () { stopListening(); reset(); render(); });

window.renderMarket = function () {
  if (me() && $('mk-sell')) { drawSell(); }
  render();
  runProcess();
};

setInterval(function () { if ($('mk-browse')) { drawBrowse(); drawMine(); } }, 60000);

$('market-view').addEventListener('click', function (e) {
  let el = e.target.closest('[data-act]');
  if (!el) { return; }
  let act = el.dataset.act;
  if (act === 'mkpick') {
    ui.pick = el.dataset.key;
    let p = document.querySelector('#mk-sell .tpicker');
    let s = p ? p.scrollTop : 0;
    drawSell();
    p = document.querySelector('#mk-sell .tpicker');
    if (p) { p.scrollTop = s; }
  }
  else if (act === 'list') { listCards(); }
  else if (act === 'buy') { buyListing(el.dataset.id); }
  else if (act === 'cancel') { cancelListing(el.dataset.id); }
});

// If sign-in finished before this file loaded, start now
if (me()) { startListening(); }
render();

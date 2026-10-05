// Auctions (Firebase). Loaded as a module after cloud.js.
// Sellers start a timed auction for one card. Highest bid when the timer ends wins.
// Bids are held (coins taken) until you are outbid, then refunded. 5% of the winning bid goes to the community bank.
import { db, me, pushNow } from './cloud.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const FEE_RATE = 0.05;
const MAX_PRICE = 10000000;
const MAX_OPEN = 10;        // most auctions one player can run at once
const MAX_BIDS = 60;        // an auction closes to new bids after this many
const SNIPE_MS = 2 * 60 * 1000;   // a bid in the last 2 minutes pushes the end out to 2 minutes from now
const DURATIONS = [[1, '1 hour'], [6, '6 hours'], [24, '24 hours'], [72, '3 days']];

let openMap = {};      // all open auctions
let mineMap = {};      // auctions I started
let bidMap = {};       // auctions I have bid on
let unsubs = [];
let chain = Promise.resolve();
let busy = false;
let loadErr = '';
let ui = { rarity: 'All', sort: 'soon', pick: null, cond: 'NM', price: '', hours: 24, bids: {} };

function $(id) { return document.getElementById(id); }

function feeFor(price) { return Math.floor(price * FEE_RATE); }

function cardOf(a) {
  if (!a || !a.card || typeof a.card.key !== 'string') { return null; }
  let raw = {};
  raw[a.card.key] = { count: 1, rarity: a.card.rarity, img: a.card.img || '', name: a.card.name || '', color: a.card.color || '', g: [a.card.g] };
  let clean = cleanBackup({ cards: raw, packs: 0 });
  return clean ? clean.cards[a.card.key] : null;
}

function scoreOfCard(card) {
  return (card && Array.isArray(card.g) && card.g.length) ? card.g[0] : undefined;
}

function num(v) {
  let n = Math.floor(Number(v));
  return n >= 0 && n <= MAX_PRICE ? n : 0;
}

function bidsOf(a) { return Math.max(0, Math.floor(Number(a && a.bids)) || 0); }

function nextMin(a) {
  if (bidsOf(a) > 0) { return num(a.bid) + Math.max(1, Math.floor(num(a.bid) * 0.05)); }
  return Math.max(1, num(a.start));
}

function logAuction(type, data) {
  if (window.cloudLog) { window.cloudLog(type, data); }
}

function refreshGame() {
  updateShop();
  renderCollection();
}

function label(key) {
  key = String(key || '');
  let tu = key.match(/\/sm9\/(\d{1,3})[\/.]/);
  if (tu) { return 'TU #' + Number(tu[1]); }
  if (key.indexOf('energy-tu-') === 0) { return key.slice(10) + ' Energy'; }
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

function removeOne(key, cond) {
  let data = loadCollection();
  if (!data.cards[key] || data.cards[key].count < 1) { return -1; }
  let got = takeCopies(data.cards[key], key, 1, cond);
  if (!got.length) { return -1; }
  if (data.cards[key].count <= 0) { delete data.cards[key]; }
  saveCollection(data);
  return got[0];
}

function addOne(key, card, score) {
  let data = loadCollection();
  addCopies(data, key, card, [score]);
  saveCollection(data);
}

function timeLeft(a) {
  let ms = (a.ends || 0) - Date.now();
  if (ms <= 0) { return 'Ended'; }
  let s = Math.floor(ms / 1000);
  let d = Math.floor(s / 86400); s -= d * 86400;
  let h = Math.floor(s / 3600); s -= h * 3600;
  let m = Math.floor(s / 60); s -= m * 60;
  if (d) { return d + 'd ' + h + 'h left'; }
  if (h) { return h + 'h ' + m + 'm left'; }
  return m + 'm ' + s + 's left';
}

// ----- Drawing -----

function tile(a, id, mode) {
  let card = cardOf(a);
  if (!card || !num(a.start)) { return ''; }
  let c = me();
  let mine = c && a.seller === c.uid;
  let n = bidsOf(a);
  let priceLine = n > 0 ? 'Bid: ' + num(a.bid).toLocaleString() + ' coins' : 'Start: ' + num(a.start).toLocaleString() + ' coins';
  let who = n > 0 ? '<div class="mk-seller">Top: ' + esc(a.bidderName || '?') + ' (' + n + ' bid' + (n === 1 ? '' : 's') + ')</div>' : '<div class="mk-seller">No bids yet</div>';
  let action = '';
  let ended = (a.ends || 0) <= Date.now();
  if (mode === 'browse') {
    if (mine) {
      action = '<div class="mk-note">Your auction</div>';
    } else if (c && a.bidder === c.uid) {
      action = '<div class="au-win">You are the top bidder</div>';
    } else if (ended) {
      action = '<div class="mk-note">Ended, closing...</div>';
    } else if (n >= MAX_BIDS) {
      action = '<div class="mk-note">Bidding is full</div>';
    } else {
      let min = nextMin(a);
      let val = ui.bids[id] !== undefined ? ui.bids[id] : min;
      action = '<div class="au-bidrow"><input type="number" min="' + min + '" value="' + esc(val) + '" data-bid-input="' + esc(id) + '">' +
        '<button class="dev-btn" data-act="bid" data-id="' + esc(id) + '">Bid</button></div>' +
        '<div class="mk-note">Min ' + min.toLocaleString() + '</div>';
    }
  } else if (mode === 'mine') {
    if (n === 0 && !ended) {
      action = '<button class="dev-btn dev-ghost mk-btn" data-act="cancel" data-id="' + esc(id) + '">Cancel</button>';
    }
  }
  let cond = card.rarity !== 'Energy' && card.g ? '<div class="mk-cond' + (card.g[0] < condNM ? ' lp' : '') + '">' + condOf(card.g[0]) + '</div>' : '';
  let extra = mode === 'browse' ? '<div class="mk-seller">Seller: ' + esc(a.sellerName || '') + '</div>' : '';
  return '<div class="mk-tile">' + binderSlotHtml({ label: '' }, card, 96, 132) +
    '<div class="mk-name">' + esc(label(a.card.key)) + ' <span class="mk-rar">' + esc(card.rarity) + '</span></div>' + cond +
    '<div class="mk-price">' + priceLine + '</div>' + who + extra +
    '<div class="mk-time" data-ends="' + (a.ends || 0) + '">' + esc(timeLeft(a)) + '</div>' + action + '</div>';
}

function render() {
  let root = $('auction-root');
  if (!root) { return; }
  let c = me();
  if (!c) {
    root.innerHTML = '<div class="tcard"><h3>Auctions</h3><div class="tempty">Sign in (button at the top left) to bid and sell.</div></div>';
    return;
  }
  if (!$('au-browse')) {
    root.innerHTML =
      '<div class="tcard"><h3>Auctions</h3><div class="tlabel">Put a card up for a timed auction. The highest bid when time runs out wins. Coins for a bid are held until someone outbids you, then you get them back. A bid in the last 2 minutes extends the timer. A 5% fee is taken from the winning bid and goes to the community bank for giveaways.</div></div>' +
      '<div id="au-sell"></div><div class="tsec-title">Live auctions</div><div id="au-filters"></div><div id="au-browse"></div>' +
      '<div class="tsec-title">Your bids</div><div id="au-bids"></div>' +
      '<div class="tsec-title">Your auctions</div><div id="au-mine"></div>';
    drawSell();
    drawFilters();
  }
  drawBrowse();
  drawBids();
  drawMine();
}

function drawFilters() {
  let opts = '<option>All</option>';
  for (let i = 0; i < rarityOrder.length; i++) {
    opts += '<option' + (ui.rarity === rarityOrder[i] ? ' selected' : '') + '>' + esc(rarityOrder[i]) + '</option>';
  }
  $('au-filters').innerHTML = '<div class="adm-edit">' +
    '<select class="tinput" id="au-rarity">' + opts + '</select>' +
    '<select class="tinput" id="au-sort">' +
    '<option value="soon"' + (ui.sort === 'soon' ? ' selected' : '') + '>Ending soonest</option>' +
    '<option value="high"' + (ui.sort === 'high' ? ' selected' : '') + '>Highest bid</option>' +
    '<option value="new"' + (ui.sort === 'new' ? ' selected' : '') + '>Newest first</option></select></div>';
  $('au-rarity').onchange = function () { ui.rarity = this.value; drawBrowse(); };
  $('au-sort').onchange = function () { ui.sort = this.value; drawBrowse(); };
}

function topPrice(a) { return bidsOf(a) > 0 ? num(a.bid) : num(a.start); }

function drawBrowse() {
  let box = $('au-browse');
  if (!box) { return; }
  let now = Date.now();
  let list = [];
  for (let id in openMap) {
    let a = openMap[id];
    if (a.status !== 'open' || (a.ends || 0) <= now) { continue; }
    let card = cardOf(a);
    if (!card || !num(a.start)) { continue; }
    if (ui.rarity !== 'All' && card.rarity !== ui.rarity) { continue; }
    list.push([id, a]);
  }
  list.sort(function (x, y) {
    if (ui.sort === 'soon') { return (x[1].ends || 0) - (y[1].ends || 0); }
    if (ui.sort === 'high') { return topPrice(y[1]) - topPrice(x[1]); }
    return (y[1].created || 0) - (x[1].created || 0);
  });
  if (loadErr) { box.innerHTML = '<div class="tmsg">Could not load auctions (' + esc(loadErr) + '). The database rules for auctions may not be published yet.</div>'; return; }
  let html = '';
  for (let i = 0; i < list.length && i < 120; i++) { html += tile(list[i][1], list[i][0], 'browse'); }
  box.innerHTML = html ? '<div class="au-grid">' + html + '</div>' : '<div class="tempty">No live auctions' + (ui.rarity !== 'All' ? ' in ' + esc(ui.rarity) : '') + ' right now.</div>';
}

function drawBids() {
  let box = $('au-bids');
  if (!box) { return; }
  let c = me();
  let ids = Object.keys(bidMap).sort(function (x, y) { return (bidMap[y].updated || 0) - (bidMap[x].updated || 0); });
  let html = '';
  let n = 0;
  for (let i = 0; i < ids.length && n < 12; i++) {
    let a = bidMap[ids[i]];
    let card = cardOf(a);
    if (!card) { continue; }
    let winning = c && a.bidder === c.uid;
    let text;
    if (a.status === 'open') {
      text = winning ? 'You are winning at ' + num(a.bid).toLocaleString() + ' coins (' + timeLeft(a) + ')' : 'Outbid, now at ' + num(a.bid).toLocaleString() + ' coins (' + timeLeft(a) + ')';
    } else if (a.status === 'sold') {
      text = winning ? 'You won it for ' + num(a.bid).toLocaleString() + ' coins' : 'Lost (sold for ' + num(a.bid).toLocaleString() + ' coins), your coins were refunded';
    } else {
      text = 'Closed';
    }
    html += '<div class="adm-line">' + esc(label(a.card.key)) + ' (' + esc(card.rarity) + '): ' + esc(text) + '</div>';
    n++;
  }
  box.innerHTML = html || '<div class="tempty">You have not bid on anything.</div>';
}

function drawMine() {
  let box = $('au-mine');
  if (!box) { return; }
  let open = '', hist = '';
  let ids = Object.keys(mineMap).sort(function (x, y) { return (mineMap[y].updated || 0) - (mineMap[x].updated || 0); });
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    let a = mineMap[ids[i]];
    if (a.status === 'open') { open += tile(a, ids[i], 'mine'); }
    else if (n < 8) {
      let card = cardOf(a);
      if (!card) { continue; }
      let text = a.status === 'sold' ? 'Sold to ' + (a.bidderName || '?') + ' for ' + num(a.bid).toLocaleString() + ' coins' : (a.status === 'unsold' ? 'No bids, returned' : 'Cancelled, returned');
      hist += '<div class="adm-line">' + esc(label(a.card.key)) + ' (' + esc(card.rarity) + '): ' + esc(text) + '</div>';
      n++;
    }
  }
  box.innerHTML = (open ? '<div class="au-grid">' + open + '</div>' : '<div class="tempty">You have no auctions running.</div>') +
    (hist ? '<div class="tlabel" style="margin-top:12px">Recent activity</div>' + hist : '');
}

function myOpenCount() {
  let n = 0;
  for (let id in mineMap) { if (mineMap[id].status === 'open') { n++; } }
  return n;
}

function drawSell() {
  let box = $('au-sell');
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
    let shown = Object.assign({}, cards[k], { g: scoresOf(cards[k], k) });
    grid += '<div class="tpick' + (ui.pick === k ? ' sel' : '') + '" data-act="aupick" data-key="' + esc(k) + '">' +
      binderSlotHtml({ label: '' }, shown, 64, 88) + '</div>';
  }
  let hint = '<div class="tlabel">Tap a card to select it.</div>';
  if (ui.pick) {
    let c = cards[ui.pick];
    let g = scoresOf(c, ui.pick);
    let nmN = 0, lpN = 0;
    for (let i = 0; i < g.length; i++) { if (g[i] >= condNM) { nmN++; } else { lpN++; } }
    let condPick = '';
    if (c.rarity !== 'Energy' && nmN && lpN) {
      condPick = ' Condition: <select class="tinput" id="au-cond"><option value="NM"' + (ui.cond === 'NM' ? ' selected' : '') + '>Near Mint (' + nmN + ')</option><option value="LP"' + (ui.cond === 'LP' ? ' selected' : '') + '>Lightly Played (' + lpN + ')</option></select>';
    } else {
      ui.cond = nmN ? 'NM' : 'LP';
    }
    hint = '<div class="tlabel">Selected: ' + esc(label(ui.pick)) + ' (' + esc(c.rarity) + '), you own ' + c.count +
      '. Quick-sell value: ' + sellValue(c.rarity, ui.pick) + ' coins.' + condPick + '</div>';
  }
  let durOpts = '';
  for (let i = 0; i < DURATIONS.length; i++) {
    durOpts += '<option value="' + DURATIONS[i][0] + '"' + (Number(ui.hours) === DURATIONS[i][0] ? ' selected' : '') + '>' + DURATIONS[i][1] + '</option>';
  }
  box.innerHTML = '<div class="tcard"><h3>Start an auction</h3>' +
    (keys.length ? '<div class="tpicker">' + grid + '</div>' : '<div class="tempty">You have no cards to auction.</div>') + hint +
    '<div class="adm-edit">Starting bid: <input class="tinput tcoin-in" id="au-price" type="number" min="1" placeholder="coins" value="' + esc(ui.price) + '"> ' +
    'Length: <select class="tinput" id="au-hours">' + durOpts + '</select> ' +
    '<button class="dev-btn" data-act="start">Start auction</button></div>' +
    '<div class="tmsg" id="au-msg"></div></div>';
  if ($('au-cond')) { $('au-cond').onchange = function () { ui.cond = this.value; }; }
  $('au-price').oninput = function () { ui.price = this.value; };
  $('au-hours').onchange = function () { ui.hours = Number(this.value); };
}

function setMsg(text, ok) {
  let el = $('au-msg');
  if (!el) { return; }
  el.textContent = text;
  el.className = 'tmsg' + (ok ? ' ok' : '');
}

// ----- Starting an auction -----

async function startAuction() {
  let c = me();
  if (!c || busy) { return; }
  let cards = loadCollection().cards;
  if (!ui.pick || !cards[ui.pick]) { setMsg('Tap a card to auction first.'); return; }
  let start = Math.floor(Number(ui.price));
  if (!(start >= 1) || start > MAX_PRICE) { setMsg('Enter a starting bid between 1 and ' + MAX_PRICE.toLocaleString() + ' coins.'); return; }
  let hours = DURATIONS.some(function (d) { return d[0] === Number(ui.hours); }) ? Number(ui.hours) : 24;
  if (myOpenCount() >= MAX_OPEN) { setMsg('You can run at most ' + MAX_OPEN + ' auctions at once.'); return; }
  let key = ui.pick;
  let src = cards[key];
  let cond = src.rarity === 'Energy' ? null : ui.cond;
  let have = scoresOf(src, key).filter(function (v) { return cond === null || (cond === 'NM' ? v >= condNM : v < condNM); }).length;
  if (have < 1) { setMsg('You do not own that card in that condition.'); return; }
  busy = true;
  setMsg('Starting...', true);
  let score = removeOne(key, cond);
  let card = { key: key, rarity: src.rarity || 'Common', img: src.img || '', name: src.name || '', color: src.color || '', g: score };
  let ok = false;
  let err = '';
  if (score >= 0) {
    // The card is held in the auction until it ends or you cancel
    try {
      await pushNow();
      let now = Date.now();
      await setDoc(doc(collection(db, 'auctions')), {
        seller: c.uid, sellerName: c.name, card: card, start: start,
        bid: 0, bidder: '', bidderName: '', bids: 0, bidLog: [], bidderIds: [],
        status: 'open', sellerDone: false, winnerDone: false,
        created: now, ends: now + hours * 3600000, updated: now
      });
      ok = true;
    } catch (e) {
      err = (e && e.code) ? e.code : 'error';
      addOne(key, card, score);
      try { await pushNow(); } catch (e2) {}
    }
  }
  busy = false;
  refreshGame();
  drawSell();
  if (ok) {
    logAuction('auction_list', { k: key, r: card.rarity, start: start, hours: hours });
    setMsg('Auction started for ' + label(key) + ' at ' + start.toLocaleString() + ' coins.', true);
  } else {
    setMsg('Could not start that (' + (err || 'no card') + '). Nothing was lost. If it says permission-denied, publish the new database rules.');
  }
}

async function cancelAuction(id) {
  let a = mineMap[id];
  if (!a || a.status !== 'open' || bidsOf(a) > 0) { return; }
  try {
    await updateDoc(doc(db, 'auctions', id), { status: 'cancelled', updated: Date.now() });
    logAuction('auction_cancel', { k: a.card.key });
  } catch (e) {
    $('info').innerText = 'Could not cancel that auction (someone may have just bid).';
  }
}

// ----- Bidding -----

async function placeBid(id) {
  let c = me();
  let a = openMap[id];
  if (!c || !a || busy) { return; }
  let card = cardOf(a);
  if (!card || a.status !== 'open' || a.seller === c.uid || a.bidder === c.uid) { return; }
  if ((a.ends || 0) <= Date.now()) { $('info').innerText = 'That auction has ended.'; return; }
  if (bidsOf(a) >= MAX_BIDS) { $('info').innerText = 'That auction has reached its bid limit.'; return; }
  let amount = Math.floor(Number($('au-browse').querySelector('[data-bid-input="' + id + '"]').value));
  let min = nextMin(a);
  if (!(amount >= min)) { $('info').innerText = 'Your bid must be at least ' + min.toLocaleString() + ' coins.'; return; }
  if (amount > MAX_PRICE) { $('info').innerText = 'That bid is too high.'; return; }
  if (coins < amount) { $('info').innerText = 'Not enough coins (' + amount.toLocaleString() + ' needed).'; return; }
  if (!confirm('Bid ' + amount.toLocaleString() + ' coins on ' + label(a.card.key) + ' (' + card.rarity + ')? Your coins are held until you are outbid.')) { return; }
  busy = true;
  coins = coins - amount;
  saveCoins();
  updateShop();
  let n = bidsOf(a) + 1;
  let now = Date.now();
  let log = Array.isArray(a.bidLog) ? a.bidLog.slice() : [];
  log.push({ u: c.uid, a: amount, s: n });
  let ids = Array.isArray(a.bidderIds) ? a.bidderIds.slice() : [];
  if (ids.indexOf(c.uid) === -1) { ids.push(c.uid); }
  let ends = a.ends || 0;
  if (ends - now < SNIPE_MS) { ends = now + SNIPE_MS; }
  try {
    await pushNow();
    await updateDoc(doc(db, 'auctions', id), {
      bid: amount, bidder: c.uid, bidderName: c.name, bids: n, bidLog: log, bidderIds: ids, ends: ends, updated: now
    });
  } catch (e) {
    coins = coins + amount;
    saveCoins();
    updateShop();
    try { await pushNow(); } catch (e2) {}
    $('info').innerText = 'Could not place that bid (someone may have bid first). You were not charged.';
    busy = false;
    return;
  }
  busy = false;
  delete ui.bids[id];
  logAuction('auction_bid', { k: a.card.key, amount: amount, seller: a.sellerName || '' });
  if (window.questEvent) { window.questEvent('bid'); }
  $('info').innerText = 'Bid placed: ' + amount.toLocaleString() + ' coins on ' + label(a.card.key) + '.';
  runProcess();
}

// ----- Paying out -----

function runProcess() {
  chain = chain.then(processAll).catch(function () {});
}

async function pay(key, apply) {
  if (settled[key]) { return false; }
  apply();
  settled[key] = true;
  saveSettled();
  saveCoins();
  await pushNow();
  return true;
}

async function closeIfEnded(id, a) {
  if (a.status !== 'open' || (a.ends || 0) > Date.now()) { return; }
  let status = bidsOf(a) > 0 ? 'sold' : 'unsold';
  try {
    await updateDoc(doc(db, 'auctions', id), { status: status, updated: Date.now() });
    a.status = status;
  } catch (e) {}
}

async function processAll() {
  let c = me();
  if (!c) { return; }
  let notes = [];

  for (let id in mineMap) {
    let a = mineMap[id];
    if (a.status === 'open') { await closeIfEnded(id, a); }
    if (a.status === 'open' || a.sellerDone) { continue; }
    let card = cardOf(a);
    if (a.status === 'sold') {
      let price = num(a.bid);
      let got = Math.max(0, price - feeFor(price));
      let did = await pay('aucsell:' + id, function () { coins = coins + got; });
      if (did) {
        logAuction('auction_sold', { k: a.card.key, price: price, fee: feeFor(price), to: a.bidderName || '' });
        if (window.achEvent) { window.achEvent('sold'); }
        notes.push('Your ' + label(a.card.key) + ' sold at auction for ' + got.toLocaleString() + ' coins.');
      }
    } else if (card) {
      let did = await pay('aucret:' + id, function () { addOne(a.card.key, card, scoreOfCard(card)); });
      if (did) {
        logAuction(a.status === 'unsold' ? 'auction_unsold' : 'auction_cancel', { k: a.card.key });
        notes.push(label(a.card.key) + ' was returned to your collection.');
      }
    }
    try {
      await updateDoc(doc(db, 'auctions', id), { sellerDone: true, updated: Date.now() });
      a.sellerDone = true;
    } catch (e) {}
  }

  for (let id in bidMap) {
    let a = bidMap[id];
    if (a.status === 'open') { await closeIfEnded(id, a); }
    let log = Array.isArray(a.bidLog) ? a.bidLog : [];
    let n = bidsOf(a);
    // Refund every bid of mine that is not the winning one
    for (let i = 0; i < log.length; i++) {
      let e = log[i];
      if (!e || e.u !== c.uid) { continue; }
      let isTop = e.s === n && a.bidder === c.uid && (a.status === 'open' || a.status === 'sold');
      if (isTop) { continue; }
      let amt = num(e.a);
      let did = await pay('aucref:' + id + ':' + e.s, function () { coins = coins + amt; });
      if (did) {
        logAuction('auction_refund', { k: a.card ? a.card.key : '', amount: amt });
        notes.push('You were outbid on ' + label(a.card.key) + '. ' + amt.toLocaleString() + ' coins refunded.');
      }
    }
    if (a.status === 'sold' && a.bidder === c.uid && !a.winnerDone) {
      let card = cardOf(a);
      if (card) {
        let did = await pay('aucwin:' + id, function () { addOne(a.card.key, card, scoreOfCard(card)); });
        if (did) {
          logAuction('auction_won', { k: a.card.key, price: num(a.bid) });
          if (window.achEvent) { window.achEvent('win'); }
          notes.push('You won ' + label(a.card.key) + ' for ' + num(a.bid).toLocaleString() + ' coins!');
        }
      }
      try {
        await updateDoc(doc(db, 'auctions', id), { winnerDone: true, updated: Date.now() });
        a.winnerDone = true;
      } catch (e) {}
    }
  }

  if (notes.length) { $('info').innerText = notes.join(' '); notifyAll('auction', notes); }
  updateShop();
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
  unsubs.push(watch(query(collection(db, 'auctions'), where('status', '==', 'open')), openMap, true));
  unsubs.push(watch(query(collection(db, 'auctions'), where('seller', '==', c.uid)), mineMap, false));
  unsubs.push(watch(query(collection(db, 'auctions'), where('bidderIds', 'array-contains', c.uid)), bidMap, false));
}

function reset() {
  openMap = {}; mineMap = {}; bidMap = {};
  loadErr = '';
  ui = { rarity: 'All', sort: 'soon', pick: null, cond: 'NM', price: '', hours: 24, bids: {} };
  if ($('auction-root')) { $('auction-root').innerHTML = ''; }
}

window.addEventListener('cloud-ready', function () { reset(); startListening(); render(); });
window.addEventListener('cloud-out', function () { stopListening(); reset(); render(); });

window.renderAuction = function () {
  if (me() && $('au-sell')) { drawSell(); }
  render();
  runProcess();
};

// Countdown text ticks every second without redrawing the page
setInterval(function () {
  let els = document.querySelectorAll('#auction-root [data-ends]');
  for (let i = 0; i < els.length; i++) { els[i].textContent = timeLeft({ ends: Number(els[i].dataset.ends) }); }
}, 1000);

// Redraw lists (drops ended auctions) and close ended ones every 15 seconds while the tab is showing
setInterval(function () {
  if ($('au-browse') && $('auction-view') && $('auction-view').style.display !== 'none') { drawBrowse(); drawBids(); drawMine(); runProcess(); }
}, 15000);

$('auction-view').addEventListener('input', function (e) {
  let el = e.target.closest('[data-bid-input]');
  if (el) { ui.bids[el.dataset.bidInput] = el.value; }
});

$('auction-view').addEventListener('click', function (e) {
  let el = e.target.closest('[data-act]');
  if (!el) { return; }
  let act = el.dataset.act;
  if (act === 'aupick') {
    ui.pick = el.dataset.key;
    let p = document.querySelector('#au-sell .tpicker');
    let s = p ? p.scrollTop : 0;
    drawSell();
    p = document.querySelector('#au-sell .tpicker');
    if (p) { p.scrollTop = s; }
  }
  else if (act === 'start') { startAuction(); }
  else if (act === 'bid') { placeBid(el.dataset.id); }
  else if (act === 'cancel') { cancelAuction(el.dataset.id); }
});

// If sign-in finished before this file loaded, start now
if (me()) { startListening(); }
render();

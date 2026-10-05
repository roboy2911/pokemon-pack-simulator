// Admin tools and admin adjustments (Firebase). Loaded as a module after cloud.js.
//  - Every player's browser listens for adjustments an admin has queued for them.
//  - The Players tab of the dev panel (admins only) shows and edits player info.
import { db, me, pushNow } from './cloud.js';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, setDoc, deleteDoc, onSnapshot, query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const MAX_COINS = 10000000;

function $(id) { return document.getElementById(id); }

// ------------------------------------------------------------------
// Part 1: applying adjustments an admin queued for this player
// ------------------------------------------------------------------

let opsUnsub = null;
let pendingOps = {};
let opsChain = Promise.resolve();

function stopOps() {
  if (opsUnsub) { opsUnsub(); opsUnsub = null; }
  pendingOps = {};
}

function startOps() {
  stopOps();
  let c = me();
  if (!c) { return; }
  opsUnsub = onSnapshot(
    query(collection(db, 'users', c.uid, 'adminOps'), where('done', '==', false)),
    function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type !== 'removed') { pendingOps[ch.doc.id] = ch.doc.data(); }
      });
      opsChain = opsChain.then(runOps).catch(function () {});
    },
    function () {}
  );
}

async function runOps() {
  let c = me();
  if (!c) { return; }
  let notes = [];
  let ids = Object.keys(pendingOps);
  for (let i = 0; i < ids.length; i++) {
    let id = ids[i];
    let op = pendingOps[id];
    let key = 'op:' + id;
    if (!settled[key]) {
      let text = applyOp(op, key);
      if (text) { notes.push(text); }
      saveSettled();
      try { await pushNow(); } catch (e) {}
      if (window.cloudLog) { window.cloudLog('admin', { op: String(op.type), text: text || '', by: String(op.byName || '') }); }
    }
    try {
      await updateDoc(doc(db, 'users', c.uid, 'adminOps', id), { done: true });
      delete pendingOps[id];
    } catch (e) {}
  }
  if (notes.length) {
    $('info').innerText = 'An admin changed your account: ' + notes.join(' ');
    updateShop();
    renderCollection();
    if (typeof checkRewards === 'function') { checkRewards(); }
  }
}

function applyOp(op, key) {
  if (!op || typeof op !== 'object') { return ''; }
  if (op.type === 'coins') {
    let amount = Math.max(-MAX_COINS, Math.min(MAX_COINS, Math.floor(Number(op.amount) || 0)));
    coins = Math.max(0, coins + amount);
    settled[key] = true;
    saveCoins();
    return (amount >= 0 ? '+' : '') + aud(amount) + '.';
  }
  if (op.type === 'cards') {
    let items = Array.isArray(op.items) ? op.items.slice(0, 40) : [];
    let adds = {};
    let takes = {};
    for (let i = 0; i < items.length; i++) {
      let it = items[i];
      if (!it || typeof it.key !== 'string') { continue; }
      let n = Math.floor(Number(it.n));
      if (!n) { continue; }
      if (n > 0) {
        adds[it.key] = { count: Math.min(n, 999), rarity: it.rarity, img: it.img || '', name: it.name || '', color: it.color || '' };
      } else {
        takes[it.key] = Math.min(-n, 999);
      }
    }
    let clean = cleanBackup({ cards: adds, packs: 0 });
    let data = loadCollection();
    let given = 0, taken = 0;
    if (clean) {
      for (let k in clean.cards) {
        let c = clean.cards[k];
        let fresh = [];
        for (let j = 0; j < c.count; j++) { fresh.push(rollScore()); }
        addCopies(data, k, c, fresh);
        given += c.count;
      }
    }
    for (let k in takes) {
      if (!data.cards[k]) { continue; }
      let n = Math.min(takes[k], data.cards[k].count);
      takeCopies(data.cards[k], k, n);
      taken += n;
      if (data.cards[k].count <= 0) { delete data.cards[k]; }
    }
    settled[key] = true;
    saveCollection(data);
    let parts = [];
    if (given) { parts.push(given + ' card(s) added.'); }
    if (taken) { parts.push(taken + ' card(s) removed.'); }
    return parts.join(' ') || 'Cards adjusted.';
  }
  if (op.type === 'reset') {
    let fresh = { coins: 500, lastDaily: 0, streak: 0, collection: { cards: {}, packs: 0 }, settled: {} };
    fresh.settled[key] = true;
    applySaveData(fresh);
    return 'Your account was reset.';
  }
  settled[key] = true;
  return '';
}

window.addEventListener('cloud-ready', startOps);
window.addEventListener('cloud-out', stopOps);

// ------------------------------------------------------------------
// Part 2: the Players tab (admins only)
// ------------------------------------------------------------------

let adm = null;   // state for the open panel

function fmtTime(t) {
  if (!t) { return '-'; }
  try { return new Date(t).toLocaleString(); } catch (e) { return String(t); }
}

function cardLabel(key) {
  key = String(key || '');
  let bs = key.match(/\/base1\/(\d{1,3})[\/.]/);
  if (bs) { return 'BS #' + Number(bs[1]); }
  let pf = key.match(/\/sv04\.5\/(\d{3})\//);
  if (pf) { return 'PF #' + Number(pf[1]); }
  if (key.indexOf('energy-pf-') === 0) { return key.slice(10) + ' Energy'; }
  let pe = key.match(/\/sv08\.5\/(\d{3})\//);
  if (pe) { return 'PE #' + Number(pe[1]); }
  if (key.indexOf('energy-pe-') === 0) { return key.slice(10) + ' Energy'; }
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
  return key.slice(-12);
}

function itemsText(list) {
  if (!Array.isArray(list) || !list.length) { return 'no cards'; }
  let parts = [];
  for (let i = 0; i < list.length && i < 12; i++) {
    parts.push((list[i].n > 1 ? list[i].n + 'x ' : '') + cardLabel(list[i].k) + (list[i].r ? ' (' + list[i].r + ')' : ''));
  }
  return parts.join(', ') + (list.length > 12 ? ' ...' : '');
}

function describeLog(e) {
  let t = e.type;
  if (t === 'pack') {
    let counts = {};
    let cards = Array.isArray(e.cards) ? e.cards : [];
    for (let i = 0; i < cards.length; i++) { counts[cards[i].r] = (counts[cards[i].r] || 0) + 1; }
    let parts = [];
    for (let r in counts) { parts.push(counts[r] + ' ' + r); }
    return 'Opened a pack: ' + parts.join(', ');
  }
  if (t === 'sell') { return 'Sold ' + cardLabel(e.k) + ' (' + e.r + ') for ' + aud(e.coins) + ''; }
  if (t === 'sellAll') { return 'Sold ' + e.n + ' spare cards for ' + aud(e.coins) + ''; }
  if (t === 'daily') { return 'Claimed daily reward: ' + aud(e.coins) + ' (day ' + e.streak + ')'; }
  if (t === 'reward') { return 'Reward ' + e.kind + ': ' + aud(e.coins) + ''; }
  if (t === 'quest') { return 'Quest ' + e.id + ' claimed: ' + aud(e.coins) + ''; }
  if (t === 'login') { return 'Signed in'; }
  if (t === 'trade_sent') { return 'Sent a trade to ' + e.toName + ': gives ' + itemsText(e.give) + ' + ' + (e.giveCoins || 0) + ' coins, wants ' + itemsText(e.get) + ' + ' + (e.getCoins || 0) + ' coins'; }
  if (t === 'trade_accept') { return 'Accepted a trade from ' + e.fromName + ': paid ' + itemsText(e.give) + ' + ' + (e.giveCoins || 0) + ' coins'; }
  if (t === 'trade_declined') { return 'Declined a trade from ' + e.with; }
  if (t === 'trade_cancelled') { return 'Cancelled a trade to ' + e.with; }
  if (t === 'trade_paid') { return 'Trade ' + e.status + ': received ' + itemsText(e.got) + ' + ' + aud(e.gotCoins || 0); }
  if (t === 'market_list') { return 'Listed ' + (e.n || 1) + 'x ' + cardLabel(e.k) + ' (' + e.r + ') for ' + aud(e.price) + ' each'; }
  if (t === 'market_buy') { return 'Bought ' + cardLabel(e.k) + ' (' + e.r + ') from ' + e.from + ' for ' + aud(e.price) + ''; }
  if (t === 'market_sold') { return 'Sold ' + cardLabel(e.k) + ' to ' + e.to + ' for ' + aud(e.price) + ' (fee ' + aud(e.fee) + ')'; }
  if (t === 'market_cancel') { return 'Cancelled a listing of ' + cardLabel(e.k) + ' at ' + aud(e.price) + ''; }
  if (t === 'auction_list') { return 'Started an auction for ' + cardLabel(e.k) + ' (' + e.r + ') from ' + aud(e.start) + ', ' + e.hours + 'h'; }
  if (t === 'auction_bid') { return 'Bid ' + aud(e.amount) + ' on ' + cardLabel(e.k) + ' from ' + (e.seller || '?'); }
  if (t === 'auction_sold') { return 'Auction of ' + cardLabel(e.k) + ' sold to ' + e.to + ' for ' + aud(e.price) + ' (fee ' + aud(e.fee) + ')'; }
  if (t === 'auction_won') { return 'Won the auction for ' + cardLabel(e.k) + ' at ' + aud(e.price) + ''; }
  if (t === 'auction_unsold') { return 'Auction of ' + cardLabel(e.k) + ' ended with no bids, card returned'; }
  if (t === 'auction_cancel') { return 'Cancelled an auction of ' + cardLabel(e.k); }
  if (t === 'auction_refund') { return 'Outbid on ' + cardLabel(e.k) + ', refunded ' + aud(e.amount) + ''; }
  if (t === 'admin') { return 'Admin change (' + e.op + ') by ' + (e.by || '?') + ': ' + (e.text || ''); }
  return t;
}

function tradeText(t) {
  return t.fromName + ' -> ' + t.toName + ' [' + t.status + ']: gives ' + itemsText(compactItems(t.offerItems)) + ' + ' + (t.offerCoins || 0) +
    ' coins, wants ' + itemsText(compactItems(t.askItems)) + ' + ' + (t.askCoins || 0) + ' coins';
}

function compactItems(items) {
  let out = [];
  let list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) { out.push({ k: list[i].key, n: list[i].n, r: list[i].rarity }); }
  return out;
}

function parseCards(json) {
  let cards = {};
  try { cards = JSON.parse(json || '{}'); } catch (e) { cards = {}; }
  let clean = cleanBackup({ cards: cards, packs: 0 });
  return clean ? clean.cards : {};
}

function msg(text, ok) {
  let el = $('adm-msg');
  if (!el) { return; }
  el.textContent = text;
  el.className = 'dev-msg' + (ok ? ' good' : '');
}

window.renderAdmin = async function (root) {
  let c = me();
  if (!c) {
    root.innerHTML = '<div class="dev-note">Sign in to the game first (button at the top left), then open this tab again.</div>';
    return;
  }
  root.innerHTML = '<div class="dev-note">Checking admin access...</div>';
  let isAdmin = false;
  try {
    let snap = await getDoc(doc(db, 'admins', c.uid));
    isAdmin = snap.exists();
  } catch (e) { isAdmin = false; }
  if (!isAdmin) {
    root.innerHTML = '<div class="dev-note">This account is not an admin.<br>To make it one, in the Firebase console open Firestore Database, create a collection called <b>admins</b>, and add a document whose ID is this account\'s user ID:</div>' +
      '<input class="dev-input" readonly value="' + esc(c.uid) + '" onclick="this.select()">' +
      '<div class="dev-note">Then close and reopen this tab.</div>';
    return;
  }
  adm = { root: root, me: c, view: 'list', users: [], filter: '', uid: null, detail: null, mode: 'give', rarity: 'Common', pick: null };
  root.onclick = adminClick;
  root.oninput = function (e) {
    if (e.target.id === 'adm-filter') { adm.filter = e.target.value.toLowerCase(); drawList(); }
  };
  loadList();
};

async function loadList() {
  adm.root.innerHTML = '<div class="dev-note">Loading players...</div>';
  try {
    let snap = await getDocs(query(collection(db, 'users'), limit(300)));
    adm.users = [];
    snap.forEach(function (d) { adm.users.push({ uid: d.id, data: d.data() }); });
    adm.users.sort(function (a, b) { return (b.data.updated || 0) - (a.data.updated || 0); });
    adm.hidden = {};
    try {
      let ex = await getDocs(collection(db, 'lbExcluded'));
      ex.forEach(function (d) { adm.hidden[d.id] = true; });
    } catch (e) {}
    adm.view = 'list';
    drawList();
    loadBank();
  } catch (e) {
    adm.root.innerHTML = '<div class="dev-msg">Could not load players. Check that the database rules are published.</div>';
  }
}


// ----- Marketplace bank: 5% of every sale, used for giveaways -----

async function loadBank() {
  try {
    let sold = await getDocs(query(collection(db, 'listings'), where('status', '==', 'sold'), limit(2000)));
    let fees = 0, sales = 0;
    sold.forEach(function (d) {
      let p = Math.floor(Number(d.data().price)) || 0;
      fees += Math.floor(p * 0.05);
      sales++;
    });
    try {
      let sa = await getDocs(query(collection(db, 'auctions'), where('status', '==', 'sold'), limit(2000)));
      sa.forEach(function (d) {
        let p = Math.floor(Number(d.data().bid)) || 0;
        fees += Math.floor(p * 0.05);
        sales++;
      });
    } catch (e) {}
    let paid = 0;
    let log = [];
    let snap = await getDocs(query(collection(db, 'bankLog'), limit(500)));
    snap.forEach(function (d) {
      let x = d.data();
      paid += Math.floor(Number(x.amount)) || 0;
      log.push(x);
    });
    log.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    adm.bank = { fees: fees, sales: sales, paid: paid, log: log };
  } catch (e) {
    adm.bank = { error: true };
  }
  if (adm.view === 'list') { drawBank(); }
}

function drawBank() {
  let box = $('adm-bank');
  if (!box) { return; }
  let b = adm.bank;
  if (!b) { box.innerHTML = '<div class="dev-note">Loading marketplace bank...</div>'; return; }
  if (b.error) { box.innerHTML = '<div class="dev-msg">Could not load the bank. Check the database rules.</div>'; return; }
  let lines = '';
  for (let i = 0; i < b.log.length && i < 8; i++) {
    lines += '<div class="adm-line"><span class="adm-time">' + esc(fmtTime(b.log[i].t)) + '</span> ' +
      aud((b.log[i].amount || 0)) + ': ' + esc(b.log[i].note || '') + '</div>';
  }
  box.innerHTML = '<div class="adm-sec" style="margin-top:6px">Marketplace bank</div>' +
    '<div class="adm-grid"><div><b>Available</b><br>' + aud((b.fees - b.paid)) + '</div>' +
    '<div><b>Fees collected</b><br>' + aud(b.fees) + ' (' + b.sales + ' sales)</div>' +
    '<div><b>Paid out</b><br>' + aud(b.paid) + '</div></div>' +
    '<div class="dev-note">Fees are 5% of each sale. Paying a giveaway to a player (open them, tick "pay from bank") records it here. You can also record a payout you made some other way:</div>' +
    '<div class="adm-edit"><input class="dev-input" id="bank-amt" type="number" min="0.2" placeholder="Amount (A$)" step="0.2" style="width:130px"> ' +
    '<input class="dev-input" id="bank-note" placeholder="Note (e.g. Discord giveaway)" style="width:240px"> ' +
    '<button class="dev-btn" data-act="bankrecord">Record payout</button></div>' +
    '<div class="dev-msg" id="bank-msg"></div>' + (lines || '<div class="tempty">No payouts recorded yet.</div>');
}

// ----- Announcement banner shown to every player -----

async function loadAnnounce() {
  try {
    let s = await getDoc(doc(db, 'announcements', 'current'));
    adm.ann = s.exists() ? s.data() : { text: '', active: false };
  } catch (e) {
    adm.ann = { error: true };
  }
  if (adm.view === 'list') { drawAnnounce(); }
}

function drawAnnounce() {
  let box = $('adm-announce');
  if (!box) { return; }
  if (!adm.ann) { box.innerHTML = '<div class="dev-note">Loading announcement...</div>'; loadAnnounce(); return; }
  if (adm.ann.error) { box.innerHTML = '<div class="dev-msg">Could not load the announcement. Check the database rules.</div>'; return; }
  let text = adm.annDraft !== undefined ? adm.annDraft : (adm.ann.text || '');
  box.innerHTML = '<div class="adm-sec" style="margin-top:6px">Announcement banner</div>' +
    '<div class="dev-note">' + (adm.ann.active && adm.ann.text ? 'Currently showing to players.' : 'Nothing is showing right now.') + ' Players can close it; posting again shows it to everyone again.</div>' +
    '<textarea class="dev-input" id="ann-text" maxlength="300" rows="2" placeholder="Message for all players (300 characters max)">' + esc(text) + '</textarea>' +
    '<div class="adm-edit"><button class="dev-btn" data-act="annpost">Post</button> <button class="dev-btn dev-ghost" data-act="annclear">Remove banner</button></div>' +
    '<div class="dev-msg" id="ann-msg"></div>';
  $('ann-text').oninput = function () { adm.annDraft = this.value; };
}

function drawList() {
  let rows = '';
  for (let i = 0; i < adm.users.length; i++) {
    let u = adm.users[i];
    let name = String(u.data.name || '(no name)');
    if (adm.filter && name.toLowerCase().indexOf(adm.filter) === -1) { continue; }
    let unique = Object.keys(parseCards(u.data.cardsJson)).length;
    rows += '<tr data-act="open" data-uid="' + esc(u.uid) + '"><td>' + esc(name) + ((adm.hidden && adm.hidden[u.uid]) ? ' <span class="dev-note">(hidden from leaderboard)</span>' : '') + '</td><td>' + aud(u.data.coins || 0) +
      '</td><td>' + (u.data.packs || 0) + '</td><td>' + unique + '</td><td>' + esc(fmtTime(u.data.updated)) + '</td></tr>';
  }
  adm.root.innerHTML = '<div id="adm-bank"></div><div id="adm-announce"></div><div class="dev-note">' + adm.users.length + ' player(s). Click one to see everything about them.</div>' +
    '<input class="dev-input" id="adm-filter" placeholder="Filter by username" value="' + esc(adm.filter) + '">' +
    '<table class="adm-table"><tr><th>Username</th><th>Money</th><th>Packs</th><th>Unique cards</th><th>Last saved</th></tr>' + rows + '</table>';
  drawBank();
  drawAnnounce();
  let f = $('adm-filter');
  if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

async function openUser(uid) {
  adm.uid = uid;
  adm.view = 'detail';
  adm.pick = null;
  adm.root.innerHTML = '<div class="dev-note">Loading player...</div>';
  let out = { user: null, logs: [], trades: [], ops: [], errors: [] };
  try {
    let s = await getDoc(doc(db, 'users', uid));
    out.user = s.exists() ? s.data() : null;
  } catch (e) { out.errors.push('player'); }
  try {
    let s = await getDocs(query(collection(db, 'users', uid, 'log'), orderBy('t', 'desc'), limit(100)));
    s.forEach(function (d) { out.logs.push(d.data()); });
  } catch (e) { out.errors.push('history'); }
  try {
    let a = await getDocs(query(collection(db, 'trades'), where('from', '==', uid), limit(50)));
    let b = await getDocs(query(collection(db, 'trades'), where('to', '==', uid), limit(50)));
    a.forEach(function (d) { out.trades.push(d.data()); });
    b.forEach(function (d) { out.trades.push(d.data()); });
    out.trades.sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); });
  } catch (e) { out.errors.push('trades'); }
  try {
    let s = await getDocs(query(collection(db, 'users', uid, 'adminOps'), orderBy('t', 'desc'), limit(20)));
    s.forEach(function (d) { out.ops.push(d.data()); });
  } catch (e) { out.errors.push('admin changes'); }
  try {
    let ex = await getDoc(doc(db, 'lbExcluded', uid));
    out.hidden = ex.exists();
  } catch (e) { out.hidden = false; }
  adm.detail = out;
  drawDetail();
}

function allCardsFor(rarity) {
  let list = [];
  if (rarity === 'Energy') {
    for (let i = 0; i < energies.length; i++) {
      list.push({ key: 'energy-' + energies[i].name, rarity: 'Energy', img: energies[i].image, name: energies[i].name, color: energies[i].color, count: 1 });
    }
    for (let i = 0; i < ascEnergies.length; i++) {
      list.push({ key: 'energy-asc-' + ascEnergies[i].name, rarity: 'Energy', img: ascEnergies[i].image, name: ascEnergies[i].name, color: ascEnergies[i].color, count: 1 });
    }
    for (let i = 0; i < tuEnergies.length; i++) {
      list.push({ key: 'energy-tu-' + tuEnergies[i].name, rarity: 'Energy', img: tuEnergies[i].image, name: tuEnergies[i].name, color: tuEnergies[i].color, count: 1 });
    }
    for (let i = 0; i < peEnergies.length; i++) {
      list.push({ key: 'energy-pe-' + peEnergies[i].name, rarity: 'Energy', img: peEnergies[i].image, name: peEnergies[i].name, color: peEnergies[i].color, count: 1 });
      list.push({ key: 'energy-pf-' + peEnergies[i].name, rarity: 'Energy', img: peEnergies[i].image, name: peEnergies[i].name, color: peEnergies[i].color, count: 1 });
    }
  } else {
    let urls = (byRarity[rarity] || []).concat(ascByRarity[rarity] || [], tuByRarity[rarity] || [], peByRarity[rarity] || [], pfByRarity[rarity] || [], bsByRarity[rarity] || []);
    for (let i = 0; i < urls.length; i++) {
      list.push({ key: urls[i], rarity: rarity, img: urls[i], name: '', color: '', count: 1 });
    }
  }
  return list;
}

function pickerHtml(list) {
  let html = '';
  for (let i = 0; i < list.length; i++) {
    let card = list[i];
    let on = adm.pick && adm.pick.key === card.key;
    html += '<div class="tpick' + (on ? ' sel' : '') + '" data-act="pickcard" data-i="' + i + '">' +
      binderSlotHtml({ label: '' }, card, 56, 77) + '<div class="tcount">' + esc(cardLabel(card.key)) + '</div></div>';
  }
  return '<div class="tpicker adm-picker">' + html + '</div>';
}

function currentPickList() {
  if (adm.mode === 'take') {
    let cards = parseCards(adm.detail.user && adm.detail.user.cardsJson);
    let out = [];
    for (let k in cards) { out.push({ key: k, rarity: cards[k].rarity, img: cards[k].img, name: cards[k].name, color: cards[k].color, count: cards[k].count }); }
    return out;
  }
  return allCardsFor(adm.rarity);
}

function drawDetail() {
  let d = adm.detail;
  let u = d.user;
  if (!u) {
    adm.root.innerHTML = '<button class="dev-btn dev-ghost" data-act="back">Back</button><div class="dev-msg">Could not load that player.</div>';
    return;
  }
  let cards = parseCards(u.cardsJson);
  let keys = Object.keys(cards);
  let total = 0;
  for (let i = 0; i < keys.length; i++) { total += cards[keys[i]].count; }

  let chips = '';
  let owned = {};
  for (let i = 0; i < keys.length; i++) { owned[cards[keys[i]].rarity] = (owned[cards[keys[i]].rarity] || 0) + 1; }
  let sets = [['30th', '30th', byRarity], ['asc', 'Ascended Heroes', ascByRarity], ['tu', 'Team Up', tuByRarity], ['pe', 'Prismatic Evolutions', peByRarity], ['pf', 'Paldean Fates', pfByRarity]];
  for (let q = 0; q < sets.length; q++) {
    let own = {};
    for (let i = 0; i < keys.length; i++) {
      if (cardSet(keys[i]) === sets[q][0]) { own[cards[keys[i]].rarity] = (own[cards[keys[i]].rarity] || 0) + 1; }
    }
    let part = '';
    for (let i = 0; i < rarityOrder.length; i++) {
      let r = rarityOrder[i];
      let t = r === 'Energy' ? energies.length : (sets[q][2][r] ? sets[q][2][r].length : 0);
      if (t) { part += '<span class="chip">' + esc(r) + ' ' + Math.min(own[r] || 0, t) + '/' + t + '</span>'; }
    }
    if (part) { chips += '<div class="dev-note" style="margin:6px 0 2px">' + esc(sets[q][1]) + '</div>' + part; }
  }
  keys.sort(function (a, b) {
    let ra = rarityOrder.indexOf(cards[a].rarity); if (ra === -1) { ra = 99; }
    let rb = rarityOrder.indexOf(cards[b].rarity); if (rb === -1) { rb = 99; }
    return ra - rb;
  });
  let thumbs = '';
  for (let i = 0; i < keys.length; i++) { thumbs += binderSlotHtml({ label: '' }, cards[keys[i]], 56, 77); }

  // Hidden per-copy scores (0-1000). Only shown here in the dev panel.
  let scoreRows = '';
  let sumAll = 0, nAll = 0, nmAll = 0, lpAll = 0;
  for (let i = 0; i < keys.length; i++) {
    let c = cards[keys[i]];
    if (c.rarity === 'Energy') { continue; }
    let g = scoresOf(c, keys[i]).slice().sort(function (x, y) { return y - x; });
    for (let j = 0; j < g.length; j++) { sumAll += g[j]; nAll++; if (g[j] >= condNM) { nmAll++; } else { lpAll++; } }
    let shown = g.slice(0, 30).map(function (v) { return v + (v >= condNM ? '' : ' (LP)'); }).join(', ') + (g.length > 30 ? ' ...' : '');
    scoreRows += '<div class="adm-line"><b>' + esc(cardLabel(keys[i])) + '</b> ' + esc(c.rarity) + ': ' + esc(shown) + '</div>';
  }
  let scoreHtml = '<div class="adm-sec">Card scores (hidden from players)</div>' +
    '<div class="dev-note">' + nAll + ' cards, average ' + (nAll ? Math.round(sumAll / nAll) : 0) + ' / 1000, ' + nmAll + ' Near Mint, ' + lpAll + ' Lightly Played. Cards from before conditions existed show a fixed score based on their key.</div>' +
    (scoreRows ? '<details><summary class="dev-note" style="cursor:pointer">Show every card score</summary>' + scoreRows + '</details>' : '');

  let logHtml = '';
  for (let i = 0; i < d.logs.length; i++) {
    logHtml += '<div class="adm-line"><span class="adm-time">' + esc(fmtTime(d.logs[i].t)) + '</span> ' + esc(describeLog(d.logs[i])) + '</div>';
  }
  let tradeHtml = '';
  for (let i = 0; i < d.trades.length; i++) {
    tradeHtml += '<div class="adm-line"><span class="adm-time">' + esc(fmtTime(d.trades[i].updated)) + '</span> ' + esc(tradeText(d.trades[i])) + '</div>';
  }
  let opsHtml = '';
  for (let i = 0; i < d.ops.length; i++) {
    let o = d.ops[i];
    let what = o.type === 'coins' ? (o.amount >= 0 ? '+' : '') + aud(o.amount) + '' : (o.type === 'cards' ? itemsText(compactItems(o.items)) : 'reset account');
    opsHtml += '<div class="adm-line"><span class="adm-time">' + esc(fmtTime(o.t)) + '</span> ' + esc(what) + ' by ' + esc(o.byName || '?') + ' [' + (o.done ? 'applied' : 'waiting for player') + ']</div>';
  }
  let errs = d.errors.length ? '<div class="dev-msg">Could not load: ' + esc(d.errors.join(', ')) + '. Check the database rules.</div>' : '';

  let rarityOptions = '';
  for (let i = 0; i < rarityOrder.length; i++) {
    rarityOptions += '<option' + (rarityOrder[i] === adm.rarity ? ' selected' : '') + '>' + esc(rarityOrder[i]) + '</option>';
  }
  let list = currentPickList();
  let pickText = adm.pick ? 'Selected: ' + cardLabel(adm.pick.key) : 'Tap a card to select it';

  adm.root.innerHTML =
    '<button class="dev-btn dev-ghost" data-act="back">&lsaquo; All players</button> <button class="dev-btn dev-ghost" data-act="refresh">Refresh</button>' +
    '<h3 class="adm-h">' + esc(u.name || '(no name)') + '</h3>' + errs +
    '<div class="adm-grid">' +
    '<div><b>Money</b><br>' + aud(u.coins || 0) + '</div>' +
    '<div><b>Packs opened</b><br>' + (u.packs || 0) + '</div>' +
    '<div><b>Unique / total cards</b><br>' + keys.length + ' / ' + total + '</div>' +
    '<div><b>Daily streak</b><br>' + (u.streak || 0) + '</div>' +
    '<div><b>Last daily</b><br>' + esc(fmtTime(u.lastDaily)) + '</div>' +
    '<div><b>Last saved</b><br>' + esc(fmtTime(u.updated)) + '</div>' +
    '</div>' +
    '<div class="dev-note">User ID: ' + esc(adm.uid) + '</div>' +

    '<div class="adm-sec">Collection</div><div class="chips">' + chips + '</div>' +
    '<div class="tthumbs" style="margin-top:8px">' + (thumbs || '<span class="tempty">No cards.</span>') + '</div>' +

    scoreHtml +
    '<div class="adm-sec">Edit this player</div>' +
    '<div class="dev-note">Changes are queued and apply the next time the player has the game open.</div>' +
    '<div class="adm-edit"><input class="dev-input" id="adm-coins" type="number" placeholder="A$ to add (negative removes)" step="0.2" style="width:220px"> ' +
    '<label class="dev-note"><input type="checkbox" id="adm-frombank"> Pay from marketplace bank (giveaway)</label> ' +
    '<button class="dev-btn" data-act="sendcoins">Send money change</button></div>' +
    '<div class="adm-edit"><button class="dev-btn' + (adm.mode === 'give' ? '' : ' dev-ghost') + '" data-act="modegive">Give cards</button> ' +
    '<button class="dev-btn' + (adm.mode === 'take' ? '' : ' dev-ghost') + '" data-act="modetake">Take cards</button> ' +
    (adm.mode === 'give' ? '<select class="dev-input" id="adm-rarity" style="width:auto">' + rarityOptions + '</select> ' : '') +
    '<input class="dev-input" id="adm-qty" type="number" min="1" value="1" style="width:80px"> ' +
    '<button class="dev-btn" data-act="sendcards">' + (adm.mode === 'give' ? 'Give' : 'Take') + '</button> <span class="dev-note">' + esc(pickText) + '</span></div>' +
    pickerHtml(list) +
    '<div class="adm-edit"><button class="dev-btn' + (d.hidden ? '' : ' dev-ghost') + '" data-act="lbtoggle">' + (d.hidden ? 'Hidden from leaderboard (click to show)' : 'Hide from leaderboard') + '</button></div>' +
    '<div class="adm-edit"><button class="dev-btn adm-danger" data-act="reset">Reset this player</button></div>' +
    '<div class="dev-msg" id="adm-msg"></div>' +

    '<div class="adm-sec">Admin changes</div>' + (opsHtml || '<div class="tempty">None.</div>') +
    '<div class="adm-sec">Trades (' + d.trades.length + ')</div>' + (tradeHtml || '<div class="tempty">None.</div>') +
    '<div class="adm-sec">Activity history (latest 100)</div>' + (logHtml || '<div class="tempty">Nothing recorded yet. History starts from when this update went live.</div>');
}

async function sendOp(op) {
  op.by = adm.me.uid;
  op.byName = adm.me.name;
  op.t = Date.now();
  op.done = false;
  await addDoc(collection(db, 'users', adm.uid, 'adminOps'), op);
}

async function adminClick(e) {
  let el = e.target.closest('[data-act]');
  if (!el) { return; }
  let act = el.dataset.act;
  if (act === 'open') { openUser(el.dataset.uid); }
  else if (act === 'back') { loadList(); }
  else if (act === 'refresh') { openUser(adm.uid); }
  else if (act === 'modegive') { adm.mode = 'give'; adm.pick = null; drawDetail(); }
  else if (act === 'modetake') { adm.mode = 'take'; adm.pick = null; drawDetail(); }
  else if (act === 'pickcard') {
    let list = currentPickList();
    adm.pick = list[Number(el.dataset.i)] || null;
    let q = $('adm-qty') ? $('adm-qty').value : '1';
    let s = adm.root.querySelector('.adm-picker') ? adm.root.querySelector('.adm-picker').scrollTop : 0;
    drawDetail();
    if ($('adm-qty')) { $('adm-qty').value = q; }
    if (adm.root.querySelector('.adm-picker')) { adm.root.querySelector('.adm-picker').scrollTop = s; }
  }
  else if (act === 'sendcoins') {
    let amount = audIn($('adm-coins').value);
    if (!amount) { msg('Type an amount in A$.'); return; }
    if (Math.abs(amount) > MAX_COINS) { msg('That is too much money.'); return; }
    if (!confirm('Change ' + (adm.detail.user.name || 'this player') + "'s money by " + aud(amount) + '?')) { return; }
    try {
      await sendOp({ type: 'coins', amount: amount });
      if (amount > 0 && $('adm-frombank') && $('adm-frombank').checked) {
        await addDoc(collection(db, 'bankLog'), { amount: amount, note: 'Giveaway to ' + (adm.detail.user.name || 'a player'), to: adm.uid, by: adm.me.uid, t: Date.now() });
        adm.bank = null;
      }
      openUser(adm.uid); setTimeout(function () { msg('Queued.', true); }, 600); }
    catch (err) { msg('Could not queue that. Check the database rules.'); }
  }
  else if (act === 'annpost' || act === 'annclear') {
    let am = $('ann-msg');
    let text = act === 'annpost' ? String($('ann-text').value || '').trim().slice(0, 300) : '';
    if (act === 'annpost' && !text) { am.textContent = 'Type a message first.'; return; }
    try {
      await setDoc(doc(db, 'announcements', 'current'), { text: text, active: act === 'annpost', by: adm.me.name || '', updated: Date.now() });
      adm.ann = { text: text, active: act === 'annpost' };
      if (act === 'annclear') { adm.annDraft = undefined; }
      drawAnnounce();
      let m2 = $('ann-msg');
      if (m2) { m2.style.color = '#2e7d32'; m2.textContent = act === 'annpost' ? 'Posted.' : 'Removed.'; }
    } catch (err) { am.textContent = 'Could not save. Check the database rules (announcements).'; }
  }
  else if (act === 'bankrecord') {
    let amt = audIn($('bank-amt').value);
    let note = String($('bank-note').value || '').slice(0, 100);
    let bm = $('bank-msg');
    if (!(amt >= 1)) { bm.textContent = 'Type an amount in A$.'; return; }
    try {
      await addDoc(collection(db, 'bankLog'), { amount: amt, note: note || 'Payout', by: adm.me.uid, t: Date.now() });
      adm.bank = null;
      drawBank();
      loadBank();
    } catch (err) { bm.textContent = 'Could not record that. Check the database rules.'; }
  }
  else if (act === 'sendcards') {
    if (!adm.pick) { msg('Tap a card first.'); return; }
    let n = Math.floor(Number($('adm-qty').value));
    if (!(n >= 1) || n > 999) { msg('Quantity must be 1 to 999.'); return; }
    let p = adm.pick;
    let item = { key: p.key, n: adm.mode === 'give' ? n : -n, rarity: p.rarity, img: p.img || '', name: p.name || '', color: p.color || '' };
    if (!confirm((adm.mode === 'give' ? 'Give ' : 'Take ') + n + 'x ' + cardLabel(p.key) + ' ' + (adm.mode === 'give' ? 'to ' : 'from ') + (adm.detail.user.name || 'this player') + '?')) { return; }
    try { await sendOp({ type: 'cards', items: [item] }); openUser(adm.uid); setTimeout(function () { msg('Queued.', true); }, 600); }
    catch (err) { msg('Could not queue that. Check the database rules.'); }
  }
  else if (act === 'lbtoggle') {
    try {
      if (adm.detail.hidden) {
        await deleteDoc(doc(db, 'lbExcluded', adm.uid));
      } else {
        await setDoc(doc(db, 'lbExcluded', adm.uid), { name: adm.detail.user.name || '', by: adm.me.uid, t: Date.now() });
      }
      adm.detail.hidden = !adm.detail.hidden;
      drawDetail();
      msg(adm.detail.hidden ? 'Hidden from the leaderboard.' : 'Shown on the leaderboard again.', true);
    } catch (err) { msg('Could not change that. Publish the new database rules first.'); }
  }
  else if (act === 'reset') {
    let name = adm.detail.user.name || 'this player';
    if (!confirm('RESET ' + name + '? This wipes their cards and money.')) { return; }
    if (!confirm('Really reset ' + name + '? This cannot be undone.')) { return; }
    try { await sendOp({ type: 'reset' }); openUser(adm.uid); setTimeout(function () { msg('Queued.', true); }, 600); }
    catch (err) { msg('Could not queue that. Check the database rules.'); }
  }
}

document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'adm-rarity' && adm) {
    adm.rarity = e.target.value;
    adm.pick = null;
    drawDetail();
  }
});

// If sign-in finished before this file loaded, start now
if (me()) { startOps(); }

// Trading between players (Firebase). Loaded as a module after cloud.js.
import { db, me, pushNow } from './cloud.js';
import {
  collection, doc, getDoc, setDoc, updateDoc, onSnapshot, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const MAX_ITEMS = 40;
const MAX_N = 999;
const MAX_COINS = 10000000;

let trades = {};
let unsubs = [];
let chain = Promise.resolve();
let busy = false;
let draft = emptyDraft();

function $(id) { return document.getElementById(id); }

function emptyDraft() {
  return { friend: null, give: {}, get: {}, giveCoins: 0, getCoins: 0 };
}

function coinsClamp(v) {
  return Math.min(MAX_COINS, Math.max(0, Math.floor(Number(v) || 0)));
}

// ----- Turning trade data into safe card maps -----

// Trade documents come from other players, so everything is cleaned before use.
function itemsToMap(items) {
  let raw = {};
  if (!Array.isArray(items)) { return {}; }
  for (let i = 0; i < items.length && i < MAX_ITEMS; i++) {
    let it = items[i];
    if (!it || typeof it.key !== 'string') { continue; }
    let n = Math.min(MAX_N, Math.floor(Number(it.n)));
    if (!(n >= 1)) { continue; }
    raw[it.key] = { count: n, rarity: it.rarity, img: it.img || '', name: it.name || '', color: it.color || '', g: it.g };
  }
  let clean = cleanBackup({ cards: raw, packs: 0 });
  return clean ? clean.cards : {};
}

function mapToItems(map) {
  let out = [];
  for (let key in map) {
    let c = map[key];
    let item = { key: key, n: c.count, rarity: c.rarity || 'Common', img: c.img || '', name: c.name || '', color: c.color || '' };
    if (Array.isArray(c.g) && c.g.length) { item.g = c.g.slice(0, c.count); }
    out.push(item);
  }
  return out;
}

function owns(map, coinsAmt) {
  let data = loadCollection();
  for (let key in map) {
    if (!data.cards[key] || data.cards[key].count < map[key].count) { return false; }
  }
  return coins >= coinsAmt;
}

function refreshGame() {
  updateShop();
  renderCollection();
}

function logTrade(type, extra) {
  if (window.cloudLog) { window.cloudLog(type, extra); }
}

function compact(items) {
  let out = [];
  let list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length && i < MAX_ITEMS; i++) {
    out.push({ k: String(list[i].key).slice(0, 160), n: list[i].n, r: list[i].rarity || '' });
  }
  return out;
}

function takeItems(map, coinsAmt) {
  let data = loadCollection();
  for (let key in map) {
    // lowest scoring copies go first; the scores travel with the cards
    map[key].g = takeCopies(data.cards[key], key, map[key].count);
    if (data.cards[key].count <= 0) { delete data.cards[key]; }
  }
  saveCollection(data);
  coins = coins - coinsAmt;
  saveCoins();
  refreshGame();
}

function giveItems(map, coinsAmt) {
  let data = loadCollection();
  for (let key in map) {
    let c = map[key];
    addCopies(data, key, c, scoresOf(c, key));
  }
  saveCollection(data);
  coins = coins + coinsAmt;
  saveCoins();
  refreshGame();
}

function sortedKeys(map) {
  return Object.keys(map).sort(function (a, b) {
    let ra = rarityOrder.indexOf(map[a].rarity); if (ra === -1) { ra = 99; }
    let rb = rarityOrder.indexOf(map[b].rarity); if (rb === -1) { rb = 99; }
    if (ra !== rb) { return ra - rb; }
    return a < b ? -1 : 1;
  });
}

// ----- Showing trades -----

function thumbs(items, coinsAmt) {
  let map = itemsToMap(items);
  let keys = sortedKeys(map);
  let html = '';
  for (let i = 0; i < keys.length; i++) {
    html += binderSlotHtml({ label: '' }, map[keys[i]], 56, 77);
  }
  if (!keys.length && !coinsAmt) { html = '<span class="tempty">Nothing</span>'; }
  let c = coinsClamp(coinsAmt);
  let coinsLine = c ? '<div class="tcoins">+ ' + c.toLocaleString() + ' coins</div>' : '';
  return '<div class="tthumbs">' + html + '</div>' + coinsLine;
}

function tradeCard(t, id, uid) {
  let incoming = t.to === uid;
  let other = incoming ? t.fromName : t.toName;
  let youGet = incoming ? [t.offerItems, t.offerCoins] : [t.askItems, t.askCoins];
  let youGive = incoming ? [t.askItems, t.askCoins] : [t.offerItems, t.offerCoins];
  let title = incoming ? esc(other || 'Someone') + ' sent you an offer' : 'Offer to ' + esc(other || 'someone');
  let buttons = '';
  if (t.status === 'open' && incoming) {
    buttons = '<div class="tbtns"><button class="dev-btn" data-act="accept" data-id="' + esc(id) + '">Accept</button>' +
      '<button class="dev-btn dev-ghost" data-act="decline" data-id="' + esc(id) + '">Decline</button></div>';
  } else if (t.status === 'open') {
    buttons = '<div class="tbtns"><button class="dev-btn dev-ghost" data-act="cancel" data-id="' + esc(id) + '">Cancel offer</button></div>';
  }
  let status = t.status === 'open' ? 'Waiting' : t.status.charAt(0).toUpperCase() + t.status.slice(1);
  return '<div class="tcard"><h3>' + title + ' <span class="tstatus">&middot; ' + esc(status) + '</span></h3>' +
    '<div class="trow"><div class="tside"><div class="tlabel">You get</div>' + thumbs(youGet[0], youGet[1]) + '</div>' +
    '<div class="tside"><div class="tlabel">You give</div>' + thumbs(youGive[0], youGive[1]) + '</div></div>' + buttons + '</div>';
}

function render() {
  let root = $('trade-root');
  if (!root) { return; }
  let c = me();
  if (!c) {
    root.innerHTML = '<div class="tcard"><h3>Trading</h3><div class="tempty">Sign in (button at the top left) to trade with other players.</div></div>';
    updateBadge();
    return;
  }
  if (!$('trade-inbox')) {
    root.innerHTML = '<div id="trade-new"></div><div id="trade-inbox"></div>';
    renderNew();
  }
  let ids = Object.keys(trades);
  let list = [];
  for (let i = 0; i < ids.length; i++) { list.push([ids[i], trades[ids[i]]]); }
  list.sort(function (a, b) { return (b[1].updated || 0) - (a[1].updated || 0); });
  let inc = '', out = '', hist = '';
  let histCount = 0;
  for (let i = 0; i < list.length; i++) {
    let id = list[i][0], t = list[i][1];
    if (t.status === 'open' && t.to === c.uid) { inc += tradeCard(t, id, c.uid); }
    else if (t.status === 'open') { out += tradeCard(t, id, c.uid); }
    else if (histCount < 10) { hist += tradeCard(t, id, c.uid); histCount++; }
  }
  $('trade-inbox').innerHTML =
    '<div class="tsec-title">Offers for you</div>' + (inc || '<div class="tempty">No offers right now.</div>') +
    '<div class="tsec-title">Offers you sent</div>' + (out || '<div class="tempty">None waiting.</div>') +
    (hist ? '<div class="tsec-title">Recent trades</div>' + hist : '');
  updateBadge();
}

function updateBadge() {
  let c = me();
  let n = 0;
  if (c) {
    for (let id in trades) {
      if (trades[id].status === 'open' && trades[id].to === c.uid) { n++; }
    }
  }
  let tab = $('tab-trades');
  if (tab) { tab.textContent = n ? 'Trades (' + n + ')' : 'Trades'; }
}

// ----- Building a new offer -----

function setMsg(text, ok) {
  let el = $('trade-msg');
  if (!el) { return; }
  el.textContent = text;
  el.className = 'tmsg' + (ok ? ' ok' : '');
}

function pickerHtml(side, source) {
  let keys = sortedKeys(source);
  if (!keys.length) { return '<div class="tempty">No cards.</div>'; }
  let html = '';
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];
    let card = source[key];
    let n = draft[side][key] || 0;
    let shown = Object.assign({}, card, { g: scoresOf(card, key) });
    html += '<div class="tpick' + (n ? ' sel' : '') + '" data-act="pick" data-side="' + side + '" data-key="' + esc(key) + '">' +
      binderSlotHtml({ label: '' }, shown, 64, 88) +
      '<div class="tcount">' + n + '/' + card.count + '</div>' +
      (n ? '<button class="tminus" data-act="unpick" data-side="' + side + '" data-key="' + esc(key) + '">-</button>' : '') +
      '</div>';
  }
  return '<div class="tpicker">' + html + '</div>';
}

function renderNew() {
  let box = $('trade-new');
  if (!box) { return; }
  let keepMsg = $('trade-msg') ? $('trade-msg').textContent : '';
  let keepOk = $('trade-msg') ? $('trade-msg').classList.contains('ok') : false;
  if (!draft.friend) {
    box.innerHTML = '<div class="tcard"><h3>New offer</h3>' +
      '<div class="tlabel">Type the exact username of the player you want to trade with.</div>' +
      '<input class="tinput" id="trade-name" placeholder="Username" maxlength="20"> ' +
      '<button class="dev-btn" data-act="find">Find player</button>' +
      '<div class="tmsg" id="trade-msg"></div></div>';
    $('trade-name').onkeydown = function (e) { if (e.key === 'Enter') { findFriend(); } };
  } else {
    let mine = loadCollection().cards;
    box.innerHTML = '<div class="tcard"><h3>Trade with ' + esc(draft.friend.name) + ' <button class="link-btn" data-act="change">change</button></h3>' +
      '<div class="trow">' +
      '<div class="tside"><div class="tlabel">You give (tap cards to add, - to remove)</div>' + pickerHtml('give', mine) +
      '<div class="tcoins">Coins: <input class="tinput tcoin-in" id="trade-give-coins" type="number" min="0" value="' + draft.giveCoins + '"> (you have ' + coins.toLocaleString() + ')</div></div>' +
      '<div class="tside"><div class="tlabel">You get</div>' + pickerHtml('get', draft.friend.cards) +
      '<div class="tcoins">Coins: <input class="tinput tcoin-in" id="trade-get-coins" type="number" min="0" value="' + draft.getCoins + '"> (they have ' + coinsClamp(draft.friend.coins).toLocaleString() + ')</div></div>' +
      '</div><div class="tbtns"><button class="dev-btn" data-act="send">Send offer</button></div>' +
      '<div class="tmsg" id="trade-msg"></div></div>';
    $('trade-give-coins').oninput = function () { draft.giveCoins = coinsClamp(this.value); };
    $('trade-get-coins').oninput = function () { draft.getCoins = coinsClamp(this.value); };
  }
  if (keepMsg) { setMsg(keepMsg, keepOk); }
}

async function findFriend() {
  let c = me();
  if (!c) { return; }
  let raw = ($('trade-name').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (raw.length < 3) { setMsg('Type a username (3 or more letters).'); return; }
  setMsg('Searching...', true);
  try {
    let u = await getDoc(doc(db, 'usernames', raw));
    if (!u.exists()) { setMsg('No player with that username.'); return; }
    let uid = u.data().uid;
    if (uid === c.uid) { setMsg("That's you!"); return; }
    let s = await getDoc(doc(db, 'users', uid));
    if (!s.exists()) { setMsg('That player has no saved game yet.'); return; }
    let d = s.data();
    let cards = {};
    try { cards = JSON.parse(d.cardsJson || '{}'); } catch (e) { cards = {}; }
    let clean = cleanBackup({ cards: cards, packs: 0 });
    draft = emptyDraft();
    draft.friend = {
      uid: uid,
      name: String(d.name || u.data().name || raw).replace(/[^A-Za-z0-9_]/g, '').slice(0, 20),
      cards: clean ? clean.cards : {},
      coins: d.coins || 0
    };
    renderNew();
  } catch (e) {
    setMsg('Could not look that up (offline?).');
  }
}

function sourceFor(side) {
  return side === 'give' ? loadCollection().cards : (draft.friend ? draft.friend.cards : {});
}

function pick(side, key, delta) {
  let source = sourceFor(side);
  if (!source[key]) { return; }
  let n = (draft[side][key] || 0) + delta;
  n = Math.max(0, Math.min(source[key].count, n));
  if (n === 0) { delete draft[side][key]; } else { draft[side][key] = n; }
  let scroll = {};
  document.querySelectorAll('.tpicker').forEach(function (el, i) { scroll[i] = el.scrollTop; });
  renderNew();
  document.querySelectorAll('.tpicker').forEach(function (el, i) { el.scrollTop = scroll[i] || 0; });
}

function buildItems(side) {
  let source = sourceFor(side);
  let out = [];
  for (let key in draft[side]) {
    let c = source[key];
    if (!c) { continue; }
    out.push({ key: key, n: draft[side][key], rarity: c.rarity || 'Common', img: c.img || '', name: c.name || '', color: c.color || '' });
  }
  return out;
}

async function sendOffer() {
  let c = me();
  if (!c || !draft.friend || busy) { return; }
  let giveItems_ = buildItems('give');
  let getItems_ = buildItems('get');
  let giveCoins = coinsClamp(draft.giveCoins);
  let getCoins = coinsClamp(draft.getCoins);
  if (!giveItems_.length && !getItems_.length && !giveCoins && !getCoins) { setMsg('Add something to the offer first.'); return; }
  if (giveItems_.length > MAX_ITEMS || getItems_.length > MAX_ITEMS) { setMsg('Too many different cards (max ' + MAX_ITEMS + ' per side).'); return; }
  let giveMap = itemsToMap(giveItems_);
  if (!owns(giveMap, giveCoins)) { setMsg("You don't have enough of those cards or coins."); return; }
  busy = true;
  setMsg('Sending...', true);
  // Your side of the offer is held in the trade until it is accepted or cancelled.
  takeItems(giveMap, giveCoins);
  giveItems_ = mapToItems(giveMap);
  try {
    await pushNow();
    await setDoc(doc(collection(db, 'trades')), {
      from: c.uid, fromName: c.name, to: draft.friend.uid, toName: draft.friend.name,
      offerItems: giveItems_, offerCoins: giveCoins,
      askItems: getItems_, askCoins: getCoins,
      status: 'open', fromDone: false, toDone: false,
      created: Date.now(), updated: Date.now()
    });
    let name = draft.friend.name;
    if (window.questEvent) { window.questEvent('trade'); }
    logTrade('trade_sent', { to: draft.friend.uid, toName: name, give: compact(giveItems_), giveCoins: giveCoins, get: compact(getItems_), getCoins: getCoins });
    draft = emptyDraft();
    renderNew();
    setMsg('Offer sent to ' + name + '!', true);
  } catch (e) {
    giveItems(giveMap, giveCoins);
    try { await pushNow(); } catch (e2) {}
    setMsg('Could not send the offer. Nothing was lost.');
    renderNew();
  }
  busy = false;
}

// ----- Answering offers -----

async function acceptOffer(id) {
  let c = me();
  let t = trades[id];
  if (!c || !t || t.status !== 'open' || t.to !== c.uid || busy) { return; }
  let ask = itemsToMap(t.askItems);
  let askCoins = coinsClamp(t.askCoins);
  if (!owns(ask, askCoins)) { $('info').innerText = "You don't have what they asked for."; return; }
  busy = true;
  takeItems(ask, askCoins);
  try {
    await pushNow();
    await updateDoc(doc(db, 'trades', id), { status: 'accepted', askItems: mapToItems(ask), updated: Date.now() });
  } catch (e) {
    giveItems(ask, askCoins);
    try { await pushNow(); } catch (e2) {}
    $('info').innerText = 'Could not accept that offer (it may have been cancelled). Nothing was lost.';
    busy = false;
    return;
  }
  busy = false;
  logTrade('trade_accept', { id: id, from: t.from, fromName: t.fromName, give: compact(mapToItems(ask)), giveCoins: askCoins });
  runProcess();
}

async function setStatus(id, status) {
  let t = trades[id];
  if (!t || t.status !== 'open') { return; }
  try {
    await updateDoc(doc(db, 'trades', id), { status: status, updated: Date.now() });
    logTrade('trade_' + status, { id: id, with: me() ? (t.to === me().uid ? t.fromName : t.toName) : '' });
  } catch (e) {
    $('info').innerText = 'Could not update that offer.';
  }
}

// ----- Paying out finished trades -----

function runProcess() {
  chain = chain.then(processAll).catch(function () {});
}

async function processAll() {
  let c = me();
  if (!c) { return; }
  let notes = [];
  let ids = Object.keys(trades);
  for (let i = 0; i < ids.length; i++) {
    let id = ids[i];
    let t = trades[id];
    let role = t.to === c.uid ? 'to' : (t.from === c.uid ? 'from' : null);
    if (!role || t.status === 'open') { continue; }
    let flag = role === 'to' ? 'toDone' : 'fromDone';
    if (t[flag]) { continue; }
    let items = null, coinsAmt = 0;
    if (role === 'to') {
      if (t.status !== 'accepted') { continue; }
      items = t.offerItems; coinsAmt = t.offerCoins;
    } else if (t.status === 'accepted') {
      items = t.askItems; coinsAmt = t.askCoins;
    } else {
      items = t.offerItems; coinsAmt = t.offerCoins;
    }
    let key = id + ':' + role;
    if (!settled[key]) {
      giveItems(itemsToMap(items), coinsClamp(coinsAmt));
      settled[key] = true;
      saveSettled();
      await pushNow();
      logTrade('trade_paid', { id: id, status: t.status, got: compact(mapToItems(itemsToMap(items))), gotCoins: coinsClamp(coinsAmt) });
      if (t.status === 'accepted') {
        notes.push('Trade with ' + (role === 'to' ? t.fromName : t.toName) + ' complete!');
      } else {
        notes.push('Your offer to ' + t.toName + ' came back (' + t.status + ').');
      }
    }
    try {
      let patch = { updated: Date.now() };
      patch[flag] = true;
      await updateDoc(doc(db, 'trades', id), patch);
      t[flag] = true;
    } catch (e) {}
  }
  if (notes.length) { $('info').innerText = notes.join(' '); }
  refreshGame();
  if (typeof checkRewards === 'function') { checkRewards(); }
  render();
}

// ----- Listening for trades -----

function stopListening() {
  for (let i = 0; i < unsubs.length; i++) { unsubs[i](); }
  unsubs = [];
}

function startListening() {
  stopListening();
  let c = me();
  if (!c) { return; }
  let handler = function (snap) {
    snap.docChanges().forEach(function (ch) { trades[ch.doc.id] = ch.doc.data(); });
    render();
    runProcess();
  };
  let onError = function () {};
  unsubs.push(onSnapshot(query(collection(db, 'trades'), where('to', '==', c.uid)), handler, onError));
  unsubs.push(onSnapshot(query(collection(db, 'trades'), where('from', '==', c.uid)), handler, onError));
}

window.addEventListener('cloud-ready', function () {
  trades = {};
  draft = emptyDraft();
  if ($('trade-root')) { $('trade-root').innerHTML = ''; }
  startListening();
  render();
});

window.addEventListener('cloud-out', function () {
  stopListening();
  trades = {};
  draft = emptyDraft();
  if ($('trade-root')) { $('trade-root').innerHTML = ''; }
  render();
});

window.renderTrades = function () {
  if ($('trade-root') && me() && $('trade-new')) { renderNew(); }
  render();
  runProcess();
};

$('trade-view').addEventListener('click', function (e) {
  let el = e.target.closest('[data-act]');
  if (!el) { return; }
  let act = el.dataset.act;
  if (act === 'find') { findFriend(); }
  else if (act === 'change') { draft = emptyDraft(); renderNew(); }
  else if (act === 'pick') { pick(el.dataset.side, el.dataset.key, 1); }
  else if (act === 'unpick') { e.stopPropagation(); pick(el.dataset.side, el.dataset.key, -1); }
  else if (act === 'send') { sendOffer(); }
  else if (act === 'accept') { acceptOffer(el.dataset.id); }
  else if (act === 'decline') { setStatus(el.dataset.id, 'declined'); }
  else if (act === 'cancel') { setStatus(el.dataset.id, 'cancelled'); }
});

// If sign-in finished before this file loaded, start now
if (me()) { startListening(); }
render();

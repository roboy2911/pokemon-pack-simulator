// Player profiles (Firebase). Loaded as a module after cloud.js.
// Shows a player's stats, set progress, rarest pull and their showcase binder. Opened from the Leaderboard tab.
import { db, me } from './cloud.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let state = { uid: '', data: null, err: '', loading: false, page: 0 };

function $(id) { return document.getElementById(id); }

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

function safeUid(uid) { return typeof uid === 'string' && /^[A-Za-z0-9]{1,40}$/.test(uid) ? uid : ''; }

function showBoard(on) {
  if ($('board-root')) { $('board-root').style.display = on ? '' : 'none'; }
  if ($('profile-root')) { $('profile-root').style.display = on ? 'none' : ''; }
}

function bar(label, o, t) {
  o = num(o); t = num(t);
  if (o === null || !t) { return ''; }
  let pct = Math.min(100, Math.round(o / t * 100));
  return '<div class="pf-set"><div class="pf-set-top"><span>' + esc(label) + '</span><span>' + o + ' / ' + t + ' (' + pct + '%)</span></div>' +
    '<div class="q-bar"><div class="q-fill" style="width:' + pct + '%"></div></div></div>';
}

function showcaseHtml(d) {
  let b = d.binders;
  if (!b || !b.list || !b.showcase) { return ''; }
  let binder = null;
  for (let i = 0; i < b.list.length; i++) { if (b.list[i].id === b.showcase) { binder = b.list[i]; } }
  if (!binder) { return ''; }
  if (state.page >= binder.pages.length) { state.page = binder.pages.length - 1; }
  if (state.page < 0) { state.page = 0; }
  let page = binder.pages[state.page];
  let w = window.innerWidth < 500 ? 84 : 110;
  let h = Math.round(w * 151 / 110);
  let grid = '';
  for (let i = 0; i < page.length; i++) {
    let key = page[i];
    let card = key ? d.cards[key] : null;
    if (card) {
      grid += binderSlotHtml({ label: '' }, Object.assign({}, card, { count: 1 }), w, h);
    } else {
      grid += '<div class="bslot blank" style="width:' + w + 'px; height:' + h + 'px;"></div>';
    }
  }
  return '<div class="pf-sec">Showcase: ' + esc(binder.name) + '</div>' +
    '<div class="binder"><div class="pf-grid">' + grid + '</div>' +
    '<div class="binder-nav"><button class="daily-btn" data-pf="prev"' + (state.page === 0 ? ' disabled' : '') + '>&lsaquo; Prev</button>' +
    '<span class="mb-light">Page ' + (state.page + 1) + ' of ' + binder.pages.length + '</span>' +
    '<button class="daily-btn" data-pf="next"' + (state.page >= binder.pages.length - 1 ? ' disabled' : '') + '>Next &rsaquo;</button></div></div>';
}

function draw() {
  let root = $('profile-root');
  if (!root) { return; }
  let back = '<button class="link-btn" data-pf="back">&lsaquo; Back to leaderboard</button>';
  if (state.loading) { root.innerHTML = back + '<div class="coll-empty">Loading profile...</div>'; return; }
  if (state.err) { root.innerHTML = back + '<div class="dev-msg" style="text-align:center">' + esc(state.err) + '</div>'; return; }
  let d = state.data;
  if (!d) { root.innerHTML = back; return; }
  let c = me();
  let value = (d.lb && num(d.lb.value) !== null) ? 'A$' + d.lb.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
  let best = '';
  if (d.lb && d.lb.best && typeof d.lb.best.img === 'string' && goodImageUrl(d.lb.best.img)) {
    best = '<div class="pf-sec">Rarest pull</div><div class="pf-best"><img src="' + esc(d.lb.best.img) + '" alt="" width="110">' +
      '<div><div><b>' + esc(String(d.lb.best.rarity || '')) + '</b></div>' +
      (num(d.lb.best.price) !== null ? '<div class="q-count">A$' + d.lb.best.price.toFixed(2) + '</div>' : '') + '</div></div>';
  }
  let sets = d.lb ? (bar('30th Celebration', d.lb.o30, d.lb.t30) + bar('Ascended Heroes', d.lb.oAsc, d.lb.tAsc) + bar('Team Up', d.lb.oTu, d.lb.tTu)) : '';
  root.innerHTML = back +
    '<div class="pf-card"><div class="pf-name">' + esc(d.name) + (c && c.uid === state.uid ? ' <span class="q-count">(you)</span>' : '') + '</div>' +
    '<div class="adm-grid">' +
    '<div><b>Packs opened</b><br>' + (d.packs || 0).toLocaleString() + '</div>' +
    '<div><b>Unique cards</b><br>' + Object.keys(d.cards).length.toLocaleString() + '</div>' +
    '<div><b>Collection value</b><br>' + esc(value) + '</div>' +
    '</div>' +
    (sets ? '<div class="pf-sec">Set progress</div>' + sets : '') + best + showcaseHtml(d) + '</div>';
}

async function openProfile(uid) {
  uid = safeUid(uid);
  if (!uid || !me()) { return; }
  state = { uid: uid, data: null, err: '', loading: true, page: 0 };
  showBoard(false);
  draw();
  try {
    let u = await getDoc(doc(db, 'users', uid));
    if (!u.exists()) { state.err = 'That player has no saved game yet.'; state.loading = false; draw(); return; }
    let x = u.data();
    let cards = {};
    try {
      let raw = JSON.parse(x.cardsJson || '{}');
      let clean = cleanBackup({ cards: raw, packs: 0 });
      cards = clean ? clean.cards : {};
    } catch (e) { cards = {}; }
    let binders = null;
    try { binders = cleanBinders(JSON.parse(x.bindersJson || 'null')); } catch (e) { binders = null; }
    let lb = null;
    try {
      let l = await getDoc(doc(db, 'leaderboard', uid));
      if (l.exists()) { lb = l.data(); }
    } catch (e) { lb = null; }
    state.data = {
      name: String(x.name || '(no name)').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || '(no name)',
      packs: Math.max(0, Math.floor(Number(x.packs)) || 0),
      cards: cards, binders: binders, lb: lb
    };
  } catch (e) {
    state.err = 'Could not load that profile.';
  }
  state.loading = false;
  draw();
}

window.openProfile = openProfile;
window.closeProfile = function () { state = { uid: '', data: null, err: '', loading: false, page: 0 }; showBoard(true); };

if ($('profile-root')) {
  $('profile-root').addEventListener('click', function (e) {
    let el = e.target.closest('[data-pf]');
    if (!el) { return; }
    let act = el.dataset.pf;
    if (act === 'back') { window.closeProfile(); }
    else if (act === 'prev') { state.page = Math.max(0, state.page - 1); draw(); }
    else if (act === 'next') { state.page = state.page + 1; draw(); }
  });
}

window.addEventListener('cloud-out', function () { window.closeProfile(); });

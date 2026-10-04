// Leaderboard (Firebase). Loaded as a module after cloud.js.
// Each player's browser saves a small stats doc (leaderboard/{uid}); admins can hide players (lbExcluded/{uid}).
import { db, me } from './cloud.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let ui = { cat: 'packs' };
let rows = [];
let hidden = {};
let loading = false;
let err = '';
let loaded = false;

function $(id) { return document.getElementById(id); }

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

function pct(o, t) {
  o = num(o); t = num(t);
  if (o === null || !t) { return null; }
  return Math.min(100, o / t * 100);
}

// Value used to rank a player in the chosen category (null = not in this ranking)
function score(r) {
  if (ui.cat === 'packs') { return num(r.packs); }
  if (ui.cat === 'value') { return num(r.value); }
  if (ui.cat === 'c30') { return pct(r.o30, r.t30); }
  if (ui.cat === 'casc') { return pct(r.oAsc, r.tAsc); }
  if (ui.cat === 'ctu') { return pct(r.oTu, r.tTu); }
  if (ui.cat === 'best') { return r.best && num(r.best.price) !== null ? r.best.price : null; }
  return null;
}

function show(r) {
  let s = score(r);
  if (ui.cat === 'packs') { return s.toLocaleString() + ' packs'; }
  if (ui.cat === 'value') { return 'A$' + s.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  if (ui.cat === 'c30') { return s.toFixed(1) + '% (' + r.o30 + '/' + r.t30 + ')'; }
  if (ui.cat === 'casc') { return s.toFixed(1) + '% (' + r.oAsc + '/' + r.tAsc + ')'; }
  if (ui.cat === 'ctu') { return s.toFixed(1) + '% (' + r.oTu + '/' + r.tTu + ')'; }
  return 'A$' + s.toFixed(2);
}

function bestImg(r) {
  let b = r.best;
  if (ui.cat !== 'best' || !b || typeof b.img !== 'string') { return ''; }
  let ok = false;
  try { ok = typeof goodImageUrl === 'function' && goodImageUrl(b.img); } catch (e) {}
  if (!ok) { return ''; }
  return '<img class="lb-img" src="' + esc(b.img) + '" alt="">';
}

function draw() {
  let root = $('board-root');
  if (!root) { return; }
  let c = me();
  if (!c) {
    root.innerHTML = '<div class="coll-empty">Sign in to see the leaderboard.</div>';
    return;
  }
  let cats = [['packs', 'Packs opened'], ['value', 'Collection value'], ['c30', '30th Celebration completion'], ['casc', 'Ascended Heroes completion'], ['ctu', 'Team Up completion'], ['best', 'Rarest pull (most valuable card)']];
  let opts = '';
  for (let i = 0; i < cats.length; i++) {
    opts += '<option value="' + cats[i][0] + '"' + (ui.cat === cats[i][0] ? ' selected' : '') + '>' + cats[i][1] + '</option>';
  }
  let list = [];
  for (let i = 0; i < rows.length; i++) {
    if (hidden[rows[i].uid]) { continue; }
    let s = score(rows[i]);
    if (s === null || !(s > 0)) { continue; }
    list.push({ r: rows[i], s: s });
  }
  list.sort(function (a, b) { return b.s - a.s; });
  let html = '';
  for (let i = 0; i < Math.min(list.length, 50); i++) {
    let r = list[i].r;
    html += '<tr class="' + (r.uid === c.uid ? 'me' : '') + '"><td class="lb-rank">' + (i + 1) + '</td><td>' + bestImg(r) + esc(String(r.name || '(no name)').slice(0, 30)) + '</td><td class="lb-val">' + esc(show(r)) + '</td></tr>';
  }
  let note = '';
  if (hidden[c.uid]) { note = '<div class="dev-note" style="text-align:center">You are hidden from the leaderboard.</div>'; }
  root.innerHTML =
    '<div class="lb-bar"><select class="sort-select" id="lb-cat">' + opts + '</select>' +
    '<button class="daily-btn" id="lb-refresh">Refresh</button></div>' + note +
    (err ? '<div class="dev-msg" style="text-align:center">' + esc(err) + '</div>' : '') +
    (loading ? '<div class="coll-empty">Loading...</div>' : (html ? '<table class="lb-table">' + html + '</table>' : '<div class="coll-empty">Nobody on this board yet. Stats update each time a player saves.</div>')) +
    '<div class="dev-note" style="text-align:center;margin-top:10px">Collection value uses real card prices in A$. Stats update when a player saves online.</div>';
  $('lb-cat').onchange = function () { ui.cat = this.value; draw(); };
  $('lb-refresh').onclick = function () { load(); };
}

async function load() {
  if (!me() || loading) { draw(); return; }
  loading = true;
  err = '';
  draw();
  try {
    let snap = await getDocs(collection(db, 'leaderboard'));
    rows = [];
    snap.forEach(function (d) { let x = d.data(); x.uid = d.id; rows.push(x); });
    let ex = await getDocs(collection(db, 'lbExcluded'));
    hidden = {};
    ex.forEach(function (d) { hidden[d.id] = true; });
    loaded = true;
  } catch (e) {
    err = (e && e.code === 'permission-denied') ? 'The leaderboard needs the updated database rules (see the instructions).' : 'Could not load the leaderboard.';
  }
  loading = false;
  draw();
}

window.renderBoard = function () {
  if (me() && !loaded) { load(); } else { draw(); if (me()) { load(); } }
};

window.addEventListener('cloud-ready', function () { loaded = false; rows = []; hidden = {}; if ($('board-view') && $('board-view').style.display !== 'none') { load(); } else { draw(); } });
window.addEventListener('cloud-out', function () { loaded = false; rows = []; hidden = {}; draw(); });
draw();

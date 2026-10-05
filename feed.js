// Live pull feed (Firebase). Loaded as a module after cloud.js.
// When a player pulls a top-tier card, it is posted to the "pulls" collection and shown to everyone in the Leaderboard tab.
import { db, me } from './cloud.js';
import { collection, addDoc, onSnapshot, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let unsub = null;
let pulls = [];
let err = '';

function $(id) { return document.getElementById(id); }

function ago(t) {
  let s = Math.max(0, Math.floor((Date.now() - (Number(t) || 0)) / 1000));
  if (s < 60) { return 'just now'; }
  if (s < 3600) { return Math.floor(s / 60) + 'm ago'; }
  if (s < 86400) { return Math.floor(s / 3600) + 'h ago'; }
  return Math.floor(s / 86400) + 'd ago';
}

let scrollPos = 0;
let paused = false;
let pauseUntil = 0;

function draw() {
  let root = $('feed-root');
  if (!root) { return; }
  if (!me()) { root.innerHTML = ''; return; }
  let old = root.querySelector('.feed-strip');
  if (old) { scrollPos = old.scrollLeft; }
  let items = '';
  let n = 0;
  for (let i = 0; i < pulls.length; i++) {
    let p = pulls[i];
    let img = typeof p.img === 'string' && goodImageUrl(p.img) ? p.img : '';
    if (!img) { continue; }
    n++;
    items += '<div class="feed-item"><img src="' + esc(img) + '" alt="" loading="lazy">' +
      '<div class="feed-name">' + esc(String(p.name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20)) + '</div>' +
      '<div class="feed-rar">' + esc(String(p.rarity || '').slice(0, 30)) + '</div>' +
      '<div class="feed-time">' + esc(ago(p.t)) + '</div></div>';
  }
  // With enough cards the row is repeated once so it can loop without a jump
  let loop = n >= 4;
  root.innerHTML = '<div class="tcard"><h3>Recent big pulls</h3>' +
    (err ? '<div class="tmsg">' + esc(err) + '</div>' : '') +
    (items ? '<div class="feed-strip" id="feed-strip"><div class="feed-track">' + items + (loop ? items : '') + '</div></div>' : '<div class="tempty">No big pulls yet. Be the first!</div>') + '</div>';
  let strip = $('feed-strip');
  if (strip) {
    strip.dataset.loop = loop ? '1' : '';
    strip.scrollLeft = scrollPos;
    let hold = function () { paused = true; };
    let letGo = function () { paused = false; pauseUntil = Date.now() + 2500; };
    strip.addEventListener('mouseenter', hold);
    strip.addEventListener('mouseleave', letGo);
    strip.addEventListener('touchstart', hold, { passive: true });
    strip.addEventListener('touchend', letGo, { passive: true });
    strip.addEventListener('wheel', function () { pauseUntil = Date.now() + 2500; }, { passive: true });
  }
}

// Slowly scrolls the row sideways. Stops while you hold or touch it, and for people who prefer less motion.
function autoScroll() {
  let strip = $('feed-strip');
  if (!strip || paused || Date.now() < pauseUntil) { return; }
  if (!strip.dataset.loop) { return; }
  let half = strip.scrollWidth / 2;
  if (!(half > strip.clientWidth)) { return; }
  let next = strip.scrollLeft + 1;
  if (next >= half) { next -= half; }
  strip.scrollLeft = next;
}
let reduceMotion = false;
try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
if (!reduceMotion) { setInterval(autoScroll, 35); }

function start() {
  stop();
  if (!me()) { draw(); return; }
  try {
    unsub = onSnapshot(query(collection(db, 'pulls'), orderBy('t', 'desc'), limit(12)), function (snap) {
      pulls = [];
      err = '';
      snap.forEach(function (d) { pulls.push(d.data()); });
      draw();
    }, function (e) {
      err = (e && e.code === 'permission-denied') ? 'The pull feed needs the updated database rules.' : 'Could not load the pull feed.';
      draw();
    });
  } catch (e) { err = 'Could not load the pull feed.'; draw(); }
}

function stop() {
  if (unsub) { unsub(); unsub = null; }
  pulls = [];
}

// Called by the game when you reveal a top-tier card
window.postPull = async function (item) {
  let c = me();
  if (!c || !item || typeof item.key !== 'string' || typeof item.img !== 'string') { return; }
  try {
    await addDoc(collection(db, 'pulls'), {
      uid: c.uid, name: c.name, key: item.key.slice(0, 300), img: item.img.slice(0, 300),
      rarity: String(item.rarity || '').slice(0, 40), t: Date.now()
    });
  } catch (e) {}
};

window.addEventListener('cloud-ready', start);
window.addEventListener('cloud-out', function () { stop(); draw(); });
setInterval(draw, 60000);
if (me()) { start(); }

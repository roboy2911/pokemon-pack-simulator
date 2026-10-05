// Announcement banner (Firebase). Loaded as a module after cloud.js.
// An admin posts one message from the dev panel; everyone sees it at the top of the page until they close it.
import { db } from './cloud.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let current = null;
let dismissKey = 'pokemonPackAnnDismissed';

function dismissed() {
  try { return localStorage.getItem(dismissKey) || ''; } catch (e) { return ''; }
}

function draw() {
  let el = document.getElementById('announce-banner');
  if (!el) { return; }
  if (!current || !current.active || !current.text || String(current.updated) === dismissed()) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.innerHTML = '<span class="ann-text"></span><button class="ann-x" aria-label="Close">&times;</button>';
  el.querySelector('.ann-text').textContent = String(current.text).slice(0, 300);
  el.style.display = 'flex';
  el.querySelector('.ann-x').onclick = function () {
    try { localStorage.setItem(dismissKey, String(current.updated)); } catch (e) {}
    draw();
  };
}

try {
  onSnapshot(doc(db, 'announcements', 'current'), function (snap) {
    current = snap.exists() ? snap.data() : null;
    draw();
  }, function () {});
} catch (e) {}

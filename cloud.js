// Accounts and online saving (Firebase). Loaded as a module after script.js.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA95Rtq8utQKsolyt-F7rapba5EyVQ-K58',
  authDomain: 'pokemon-packs.firebaseapp.com',
  projectId: 'pokemon-packs',
  storageBucket: 'pokemon-packs.firebasestorage.app',
  messagingSenderId: '140469588538',
  appId: '1:140469588538:web:21bd5cb2a317cb4c665b03'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let user = null;
let userName = '';
let ready = false;          // true once the first load from the cloud has finished
let pushTimer = null;
let status = 'Not signed in';
let pendingName = '';       // username chosen on the sign-up form
let mode = 'signin';        // which form is showing

// Used by trade.js
export { db, auth };
export function me() {
  if (user && ready) { return { uid: user.uid, name: userName }; }
  return null;
}
export { pushNow };

const $ = function (id) { return document.getElementById(id); };

function safeName(text) {
  return String(text || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
}

function setStatus(text) {
  status = text;
  let el = $('acct-status');
  if (el) { el.textContent = text; }
}

function updateButton() {
  let btn = $('acct-btn');
  if (!btn) { return; }
  btn.textContent = user ? (userName || 'Account') : 'Sign in';
}

function friendlyError(e) {
  let code = (e && e.code) || '';
  if (code === 'auth/email-already-in-use') { return 'That email already has an account. Try signing in.'; }
  if (code === 'auth/invalid-email') { return 'That email address does not look right.'; }
  if (code === 'auth/weak-password') { return 'Password must be at least 6 characters.'; }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') { return 'Wrong email or password.'; }
  if (code === 'auth/too-many-requests') { return 'Too many tries. Wait a bit and try again.'; }
  if (code === 'auth/network-request-failed') { return 'No internet connection.'; }
  if (code === 'auth/operation-not-allowed') { return 'Email sign-in is not turned on in Firebase.'; }
  return 'Something went wrong (' + (code || 'unknown') + ').';
}

// ----- Saving and loading -----

function userRef() {
  return doc(db, 'users', user.uid);
}

async function pushNow() {
  if (!user || !ready) { return; }
  let data = getSaveData();
  setStatus('Saving...');
  await setDoc(userRef(), {
    name: userName,
    nameLower: userName.toLowerCase(),
    coins: data.coins,
    lastDaily: data.lastDaily,
    packs: data.collection.packs || 0,
    cardsJson: JSON.stringify(data.collection.cards || {}),
    settledJson: JSON.stringify(data.settled || {}),
    updated: Date.now()
  });
  setStatus('Saved online');
}

function schedulePush() {
  if (!user || !ready) { return; }
  clearTimeout(pushTimer);
  setStatus('Saving...');
  pushTimer = setTimeout(function () {
    pushNow().catch(function () { setStatus('Could not save (offline?)'); });
  }, 1000);
}

function parseCloud(d) {
  let cards = {};
  try { cards = JSON.parse(d.cardsJson || '{}'); } catch (e) { cards = {}; }
  let settledMap = {};
  try { settledMap = JSON.parse(d.settledJson || '{}'); } catch (e) { settledMap = {}; }
  return { coins: d.coins, lastDaily: d.lastDaily, collection: { cards: cards, packs: d.packs || 0 }, settled: settledMap };
}

async function pullAndMerge() {
  ready = false;
  setStatus('Loading your save...');
  try {
    let snap = await getDoc(userRef());
    if (!snap.exists()) {
      // New account: upload what is on this device
      ready = true;
      await pushNow();
    } else {
      let cloud = parseCloud(snap.data());
      let linked = '';
      try { linked = localStorage.getItem('pokemonPackLinkedUid') || ''; } catch (e) {}
      let ok = true;
      if (linked !== user.uid && hasLocalProgress()) {
        ok = confirm('This account already has a saved game. Load it? This replaces the cards and coins currently on this device.');
      }
      if (!ok) {
        ready = false;
        await signOut(auth);
        return;
      }
      applySaveData(cloud);
      ready = true;
      setStatus('Saved online');
    }
    try { localStorage.setItem('pokemonPackLinkedUid', user.uid); } catch (e) {}
    cloudPush = schedulePush;
    try { await ensureUsername(); } catch (e) {}
    window.dispatchEvent(new Event('cloud-ready'));
  } catch (e) {
    ready = false;
    setStatus('Could not load your save (offline?)');
  }
}

async function doSignOut() {
  if (user && ready) {
    try {
      clearTimeout(pushTimer);
      await pushNow();
    } catch (e) {
      if (!confirm('Could not save online. Sign out anyway and lose unsaved progress on this device?')) { return; }
    }
  }
  cloudPush = null;
  ready = false;
  window.dispatchEvent(new Event('cloud-out'));
  try { localStorage.removeItem('pokemonPackLinkedUid'); } catch (e) {}
  // Your save lives online now, so clear this device for the next person
  applySaveData(null);
  await signOut(auth);
  closeBox();
}

// Usernames are unique: each one is claimed in the 'usernames' collection
async function ensureUsername() {
  let lower = userName.toLowerCase();
  for (let tries = 0; tries < 5; tries++) {
    if (lower.length >= 3) {
      let snap = await getDoc(doc(db, 'usernames', lower));
      if (snap.exists()) {
        if (snap.data().uid === user.uid) { return; }
      } else {
        try {
          await setDoc(doc(db, 'usernames', lower), { uid: user.uid, name: userName });
          return;
        } catch (e) { /* someone else got it first */ }
      }
    }
    let pick = prompt('The username "' + userName + '" is not available. Choose a new one (letters, numbers, _):');
    let n = safeName(pick);
    if (n.length < 3) { n = (safeName(userName) + 'player').slice(0, 14) + Math.floor(100 + Math.random() * 900); }
    userName = n;
    lower = n.toLowerCase();
    try { await updateProfile(user, { displayName: userName }); } catch (e) {}
    updateButton();
    schedulePush();
  }
}

// ----- Sign-in screen -----

function openBox() { $('acct-overlay').style.display = 'flex'; }
function closeBox() { $('acct-overlay').style.display = 'none'; }

function showAccount() {
  if (user) {
    $('acct-box').innerHTML =
      '<h3>' + esc(userName || 'Account') + '</h3>' +
      '<div class="dev-note">' + esc(user.email || '') + '</div>' +
      '<div class="dev-msg" id="acct-status" style="color:#5a554c">' + esc(status) + '</div>' +
      '<button class="dev-btn" id="acct-out">Sign out</button> ' +
      '<button class="dev-btn dev-ghost" id="acct-close">Close</button>';
    $('acct-out').onclick = doSignOut;
    $('acct-close').onclick = closeBox;
  } else {
    showForm();
  }
  openBox();
}

function showForm() {
  let up = mode === 'signup';
  $('acct-box').innerHTML =
    '<h3>' + (up ? 'Create account' : 'Sign in') + '</h3>' +
    '<div class="dev-note">' + (up ? 'Your cards and coins on this device will be saved to the new account.' : 'Sign in to load your saved game.') + '</div>' +
    (up ? '<input class="dev-input" id="acct-name" placeholder="Username (letters, numbers, _)" maxlength="20" autocomplete="username">' : '') +
    '<input class="dev-input" id="acct-email" type="email" placeholder="Email" autocomplete="email">' +
    '<input class="dev-input" id="acct-pass" type="password" placeholder="Password (6+ characters)" autocomplete="' + (up ? 'new-password' : 'current-password') + '">' +
    '<div class="dev-msg" id="acct-msg"></div>' +
    '<button class="dev-btn" id="acct-go">' + (up ? 'Create account' : 'Sign in') + '</button> ' +
    '<button class="dev-btn dev-ghost" id="acct-close">Cancel</button>' +
    '<div class="acct-links"><a href="#" id="acct-switch">' + (up ? 'I already have an account' : 'Create a new account') + '</a>' +
    (up ? '' : ' &middot; <a href="#" id="acct-reset">Forgot password?</a>') + '</div>';
  $('acct-close').onclick = closeBox;
  $('acct-switch').onclick = function (e) { e.preventDefault(); mode = up ? 'signin' : 'signup'; showForm(); };
  if (!up) {
    $('acct-reset').onclick = async function (e) {
      e.preventDefault();
      let email = $('acct-email').value.trim();
      if (!email) { $('acct-msg').textContent = 'Type your email first.'; return; }
      try {
        await sendPasswordResetEmail(auth, email);
        $('acct-msg').style.color = '#2e7d32';
        $('acct-msg').textContent = 'Password reset email sent. Check your inbox.';
      } catch (err) {
        $('acct-msg').style.color = '#b3261e';
        $('acct-msg').textContent = friendlyError(err);
      }
    };
  }
  async function submit() {
    let msg = $('acct-msg');
    msg.style.color = '#b3261e';
    let email = $('acct-email').value.trim();
    let pass = $('acct-pass').value;
    let name = up ? safeName($('acct-name').value) : '';
    if (up && name.length < 3) { msg.textContent = 'Username needs at least 3 letters, numbers or _.'; return; }
    if (!email || !pass) { msg.textContent = 'Fill in your email and password.'; return; }
    msg.style.color = '#5a554c';
    msg.textContent = 'One moment...';
    $('acct-go').disabled = true;
    try {
      if (up) {
        let taken = await getDoc(doc(db, 'usernames', name.toLowerCase()));
        if (taken.exists()) {
          msg.style.color = '#b3261e';
          msg.textContent = 'That username is taken. Try another.';
          $('acct-go').disabled = false;
          return;
        }
        pendingName = name;
        let cred = await createUserWithEmailAndPassword(auth, email, pass);
        try { await updateProfile(cred.user, { displayName: name }); } catch (e) {}
        try { await setDoc(doc(db, 'usernames', name.toLowerCase()), { uid: cred.user.uid, name: name }); } catch (e) {}
        userName = name;
        updateButton();
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
      closeBox();
    } catch (err) {
      msg.style.color = '#b3261e';
      msg.textContent = friendlyError(err);
      $('acct-go').disabled = false;
    }
  }
  $('acct-go').onclick = submit;
  $('acct-pass').onkeydown = function (e) { if (e.key === 'Enter') { submit(); } };
  setTimeout(function () { $((up ? 'acct-name' : 'acct-email')).focus(); }, 0);
}

$('acct-btn').onclick = showAccount;
$('acct-overlay').addEventListener('click', function (e) {
  if (e.target.id === 'acct-overlay') { closeBox(); }
});

window.addEventListener('pagehide', function () {
  if (user && ready) { clearTimeout(pushTimer); pushNow().catch(function () {}); }
});

onAuthStateChanged(auth, async function (u) {
  user = u;
  if (!u) {
    userName = '';
    cloudPush = null;
    ready = false;
    setStatus('Not signed in');
    updateButton();
    window.dispatchEvent(new Event('cloud-out'));
    return;
  }
  userName = safeName(u.displayName) || pendingName || safeName((u.email || 'player').split('@')[0]) || 'player';
  updateButton();
  await pullAndMerge();
  // If an existing account has no saved name yet, keep the doc name in sync
  updateButton();
});

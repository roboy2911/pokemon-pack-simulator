// Daily quests. Three goals a day (the same for every player on the same date), paid in coins.
// Progress and claims live in the "settled" map, so they are saved online with the rest of the save.
// Classic script, loaded after script.js (uses its globals).

let questPool = {
  packs: [
    { id: 'packs3', text: 'Open 3 packs', type: 'pack', target: 3, reward: 100 },
    { id: 'packs5', text: 'Open 5 packs', type: 'pack', target: 5, reward: 200 }
  ],
  skill: [
    { id: 'rare', text: 'Pull a Rare Holo or better', type: 'rare', target: 1, reward: 150 },
    { id: 'sell5', text: 'Sell 5 spare cards', type: 'sell', target: 5, reward: 100 }
  ],
  social: [
    { id: 'list', text: 'List a card on the Market (sign in)', type: 'list', target: 1, reward: 100 },
    { id: 'bid', text: 'Place a bid in an auction (sign in)', type: 'bid', target: 1, reward: 100 },
    { id: 'trade', text: 'Send a trade offer (sign in)', type: 'trade', target: 1, reward: 100 },
    { id: 'binder', text: 'Put 3 cards in one of your binders', type: 'binder', target: 3, reward: 80 }
  ]
};
let questBonus = 100;   // extra coins for finishing all three

function questDate() {
  let d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function questHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}

// The three quests for a date
function questsFor(date) {
  let out = [];
  let groups = ['packs', 'skill', 'social'];
  for (let g = 0; g < groups.length; g++) {
    let list = questPool[groups[g]];
    out.push(list[questHash(date + ':' + groups[g]) % list.length]);
  }
  return out;
}

// Old days are cleaned out so the saved data does not grow
function questPrune(date) {
  let changed = false;
  for (let k in settled) {
    if ((k.indexOf('qp:') === 0 || k.indexOf('quest:') === 0) && k.split(':')[1] !== date) {
      delete settled[k];
      changed = true;
    }
  }
  if (changed) { saveSettled(); }
}

function questProgress(date, q) {
  return Math.min(q.target, Math.floor(Number(settled['qp:' + date + ':' + q.id])) || 0);
}

// Called by the game when something happens ('pack', 'rare', 'sell', 'list', 'bid', 'trade', 'binder')
function questEvent(type, n) {
  if (typeof unlimited !== 'undefined' && unlimited) { return; }
  n = n === undefined ? 1 : n;
  if (typeof achEvent === 'function') { achEvent(type, n); }
  let date = questDate();
  let changed = false;
  let list = questsFor(date);
  for (let i = 0; i < list.length; i++) {
    let q = list[i];
    if (q.type !== type) { continue; }
    let key = 'qp:' + date + ':' + q.id;
    let have = questProgress(date, q);
    if (have >= q.target) { continue; }
    settled[key] = Math.min(q.target, have + n);
    changed = true;
  }
  if (changed) {
    saveSettled();
    if (typeof cloudChanged === 'function') { cloudChanged(); }
    renderQuests();
  }
}

function questClaim(id) {
  let date = questDate();
  let list = questsFor(date);
  for (let i = 0; i < list.length; i++) {
    let q = list[i];
    if (q.id !== id) { continue; }
    let key = 'quest:' + date + ':' + q.id;
    if (settled[key] || questProgress(date, q) < q.target) { return; }
    settled[key] = true;
    saveSettled();
    addCoins(q.reward);
    logEvent('quest', { id: q.id, coins: q.reward });
    if (typeof achEvent === 'function') { achEvent('quest'); }
    let msg = 'Quest done: +' + q.reward + ' coins.';
    let all = list.every(function (x) { return settled['quest:' + date + ':' + x.id]; });
    if (all && !settled['quest:' + date + ':bonus']) {
      settled['quest:' + date + ':bonus'] = true;
      saveSettled();
      addCoins(questBonus);
      logEvent('quest', { id: 'bonus', coins: questBonus });
      msg += ' All three done: +' + questBonus + ' bonus coins!';
    }
    let info = document.getElementById('info');
    if (info) { info.innerText = msg; }
    renderQuests();
    return;
  }
}

function renderQuests() {
  let box = document.getElementById('quests-box');
  if (!box) { return; }
  let date = questDate();
  questPrune(date);
  let list = questsFor(date);
  let rows = '';
  let doneCount = 0;
  for (let i = 0; i < list.length; i++) {
    let q = list[i];
    let have = questProgress(date, q);
    let claimed = !!settled['quest:' + date + ':' + q.id];
    if (claimed) { doneCount++; }
    let pct = Math.round(have / q.target * 100);
    let action = claimed ? '<span class="q-done">Claimed</span>'
      : (have >= q.target ? '<button class="daily-btn q-claim" data-quest="' + q.id + '">Claim +' + q.reward + '</button>'
        : '<span class="q-reward">+' + q.reward + ' coins</span>');
    rows += '<div class="q-row"><div class="q-main"><div class="q-text">' + esc(q.text) + '</div>' +
      '<div class="q-bar"><div class="q-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="q-count">' + have + ' / ' + q.target + '</div></div><div class="q-act">' + action + '</div></div>';
  }
  box.innerHTML = '<div class="q-card"><div class="q-head"><b>Daily quests</b> <span class="q-sub">Finish all 3 for +' + questBonus + ' bonus coins. New quests tomorrow.</span></div>' + rows + '</div>';
}

document.getElementById('quests-box').addEventListener('click', function (e) {
  let el = e.target.closest('[data-quest]');
  if (el) { questClaim(el.dataset.quest); }
});

// New day while the page is open, and a fresh look after signing in (the save is loaded then)
let questLastDate = questDate();
setInterval(function () {
  let d = questDate();
  if (d !== questLastDate) { questLastDate = d; renderQuests(); }
}, 60000);
window.addEventListener('cloud-ready', renderQuests);
window.addEventListener('cloud-out', renderQuests);
renderQuests();

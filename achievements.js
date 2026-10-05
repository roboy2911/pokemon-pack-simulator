// Achievements: badges for things you do in the game. Classic script, loaded after script.js and quests.js.
// Unlocks and counters live in the "settled" map ("ach:<id>" and "achs:<counter>"), so they save online with the rest of the save.

let achList = [
  { id: 'first_pack', name: 'First Rip', desc: 'Open your first pack', test: function (s) { return s.packs >= 1; } },
  { id: 'packs_10', name: 'Pack Fan', desc: 'Open 10 packs', test: function (s) { return s.packs >= 10; } },
  { id: 'packs_50', name: 'Pack Addict', desc: 'Open 50 packs', test: function (s) { return s.packs >= 50; } },
  { id: 'packs_100', name: 'Pack Master', desc: 'Open 100 packs', test: function (s) { return s.packs >= 100; } },
  { id: 'packs_500', name: 'Pack Legend', desc: 'Open 500 packs', test: function (s) { return s.packs >= 500; } },
  { id: 'packs_1000', name: 'Thousand Club', desc: 'Open 1,000 packs', test: function (s) { return s.packs >= 1000; } },
  { id: 'unique_50', name: 'Collector', desc: 'Collect 50 different cards', test: function (s) { return s.unique >= 50; } },
  { id: 'unique_200', name: 'Serious Collector', desc: 'Collect 200 different cards', test: function (s) { return s.unique >= 200; } },
  { id: 'unique_500', name: 'Hoarder', desc: 'Collect 500 different cards', test: function (s) { return s.unique >= 500; } },
  { id: 'holo', name: 'Shiny', desc: 'Pull a Rare Holo or better', test: function (s) { return s.c.rare >= 1; } },
  { id: 'big_hit', name: 'Big Hit', desc: 'Pull a medium-rarity hit (Ultra Rare or better)', test: function (s) { return s.c.tier2 >= 1; } },
  { id: 'jackpot', name: 'Jackpot', desc: 'Pull a top-tier card (secret, rainbow or special art)', test: function (s) { return s.c.tier3 >= 1; } },
  { id: 'god', name: 'God Pack', desc: 'Open a god pack', test: function (s) { return s.c.god >= 1; } },
  { id: 'set_half', name: 'Halfway There', desc: 'Collect half of any set', test: function (s) { return s.bestSet >= 0.5; } },
  { id: 'set_full', name: 'Set Complete', desc: 'Collect every card in a set', test: function (s) { return s.bestSet >= 1; } },
  { id: 'trader', name: 'First Trade', desc: 'Finish a trade with another player', test: function (s) { return s.c.tradedone >= 1; } },
  { id: 'seller', name: 'Open for Business', desc: 'List a card on the Market', test: function (s) { return s.c.list >= 1; } },
  { id: 'sold', name: 'Made a Sale', desc: 'Sell a card to another player', test: function (s) { return s.c.sold >= 1; } },
  { id: 'bidder', name: 'Going Once', desc: 'Place a bid in an auction', test: function (s) { return s.c.bid >= 1; } },
  { id: 'winner', name: 'Winning Bid', desc: 'Win an auction', test: function (s) { return s.c.win >= 1; } },
  { id: 'binder', name: 'Organised', desc: 'Put a card in one of your binders', test: function (s) { return s.c.binder >= 1; } },
  { id: 'cleaner', name: 'Spring Cleaning', desc: 'Sell 50 spare cards', test: function (s) { return s.c.sell >= 50; } },
  { id: 'quests', name: 'Quest Runner', desc: 'Claim 10 daily quests', test: function (s) { return s.c.quest >= 10; } },
  { id: 'grader', name: 'Slabbed', desc: 'Get a card graded', test: function (s) { return s.c.graded >= 1; } },
  { id: 'gem', name: 'Gem Mint', desc: 'Get a grade 10', test: function (s) { return s.c.grade10 >= 1; } },
  { id: 'streak7', name: 'Weekly Visitor', desc: 'Reach a 7 day daily-reward streak', test: function (s) { return s.streak >= 7; } }
];

function achCounter(name) {
  return Math.floor(Number(settled['achs:' + name])) || 0;
}

// Highest share of any set you have collected (0 to 1)
function achBestSet() {
  let best = 0;
  let data = loadCollection();
  let keys = Object.keys(data.cards);
  let sets = [['30th', function () { return setReady('30th'); }], ['asc', function () { return typeof ascLoaded !== 'undefined' && ascLoaded; }], ['tu', function () { return typeof tuLoaded !== 'undefined' && tuLoaded; }], ['pe', function () { return typeof peLoaded !== 'undefined' && peLoaded; }], ['pf', function () { return typeof pfLoaded !== 'undefined' && pfLoaded; }]];
  for (let q = 0; q < sets.length; q++) {
    if (!sets[q][1]()) { continue; }
    let all = setKeys(sets[q][0]);
    let total = Object.keys(all).length;
    if (!total) { continue; }
    let n = 0;
    for (let i = 0; i < keys.length; i++) { if (all[keys[i]]) { n++; } }
    best = Math.max(best, n / total);
  }
  return best;
}

function achStats() {
  let data = loadCollection();
  let c = {};
  let names = ['rare', 'tier2', 'tier3', 'god', 'tradedone', 'list', 'sold', 'bid', 'win', 'binder', 'sell', 'quest', 'graded', 'grade10'];
  for (let i = 0; i < names.length; i++) { c[names[i]] = achCounter(names[i]); }
  return { packs: data.packs || 0, unique: Object.keys(data.cards).length, c: c, streak: (typeof streak !== 'undefined' ? streak : 0), bestSet: achBestSet() };
}

function achUnlockedIds() {
  let out = [];
  for (let i = 0; i < achList.length; i++) { if (settled['ach:' + achList[i].id]) { out.push(achList[i].id); } }
  return out;
}

// Unlocks anything newly earned. The first time ever, it quietly catches up without pop-ups.
function achCheck() {
  if (typeof unlimited !== 'undefined' && unlimited) { return; }
  let quiet = !settled['ach:init'];
  let s = achStats();
  let changed = false;
  for (let i = 0; i < achList.length; i++) {
    let a = achList[i];
    if (settled['ach:' + a.id]) { continue; }
    let ok = false;
    try { ok = a.test(s); } catch (e) { ok = false; }
    if (!ok) { continue; }
    settled['ach:' + a.id] = Date.now();
    changed = true;
    if (!quiet) {
      toast('Achievement unlocked: ' + a.name);
      logEvent('achievement', { id: a.id });
    }
  }
  if (quiet) { settled['ach:init'] = Date.now(); changed = true; }
  if (changed) {
    saveSettled();
    if (typeof cloudChanged === 'function') { cloudChanged(); }
    renderAchievements();
  }
}

// Called by the game when something happens
function achEvent(type, n) {
  if (typeof unlimited !== 'undefined' && unlimited) { return; }
  settled['achs:' + type] = achCounter(type) + (n === undefined ? 1 : n);
  saveSettled();
  achCheck();
}

function renderAchievements() {
  let root = document.getElementById('ach-root');
  if (!root) { return; }
  let done = achUnlockedIds().length;
  let html = '<div class="tcard"><h3>Achievements</h3><div class="tlabel">' + done + ' of ' + achList.length + ' unlocked. Your badges show on your profile.</div>' +
    '<div class="progress-bar"><div class="progress-fill" style="width:' + Math.round(done / achList.length * 100) + '%"></div></div></div><div class="ach-grid">';
  for (let i = 0; i < achList.length; i++) {
    let a = achList[i];
    let got = !!settled['ach:' + a.id];
    html += '<div class="ach-item' + (got ? ' got' : '') + '"><div class="ach-name">' + esc(a.name) + '</div><div class="ach-desc">' + esc(a.desc) + '</div><div class="ach-state">' + (got ? 'Unlocked' : 'Locked') + '</div></div>';
  }
  root.innerHTML = html + '</div>';
}

window.achEvent = achEvent;
window.renderAchievements = renderAchievements;
window.addEventListener('cloud-ready', function () { achCheck(); renderAchievements(); });
window.addEventListener('cloud-out', renderAchievements);
renderAchievements();
setTimeout(achCheck, 3000);

// Quiet catch-up on load so later unlocks get their pop-up
try { achCheck(); } catch (e) {}

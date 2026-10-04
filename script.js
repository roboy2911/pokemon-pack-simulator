let byRarity = {};

// Which way to turn sideways cards: 90 = clockwise, -90 = counterclockwise
let rotateDirection = -90;

// Card size on screen
let cardW = 240;
let cardH = 330;

// Card size in the collection grid
let thumbW = 110;
let thumbH = 151;

// Your pack picture, and how much of its top gets torn off (0.1 = top 10%)
let packImageUrl = 'https://images.squarespace-cdn.com/content/v1/5e3b1164feb39b444b58f15b/71dbc8d9-d9e4-47fb-b30b-f01b52b2d03b/Pokemon_TCG_30th_Celebration_Booster_Wrap.png';
let tearFraction = 0.1;
let packRatio = null;

// Prices (CardDex gives euros; this converts them)
let priceApi = 'https://api.carddex.dev/v1/cards/';
let priceField = 'avg_7d';
let eurToAud = 1.62;
let currencySymbol = 'A$';
let priceStoreKey = 'pokemonPackPrices';
let priceMaxAge = 24 * 60 * 60 * 1000;
let priceCache = {};
let failedIds = {};
let priceQueue = [];
let queueRunning = false;

// Sound (all sounds are generated in the browser, no files needed)
let soundOn = true;
let soundVolume = 0.6;
let soundStoreKey = 'pokemonPackSound';
let audioCtx = null;

// Which rarities get a chime when revealed: 1 = small, 2 = medium, 3 = big fanfare
let hitTiers = {
  'Double rare': 1,
  'Illustration rare': 1,
  'Classic Collection': 2,
  'Special illustration rare': 3,
  'Futuristic Rare': 3,
  'RGB Mew': 3,
  'Ultra Rare': 2,
  'Mega Attack Rare': 3,
  'Mega Hyper Rare': 3
};

let stackCards = [];
let topIndex = 0;
let currentItems = [];

// Pack ripping state
let packSealed = false;
let ripping = false;
let ripDirection = 1;
let packId = 0;

// Collection
let rarityOrder = ['RGB Mew', 'Futuristic Rare', 'Mega Hyper Rare', 'Mega Attack Rare', 'Special illustration rare', 'Ultra Rare', 'Illustration rare', 'Classic Collection', 'Double rare', 'Rare', 'Pikachu Rare', 'Uncommon', 'Common', 'Energy'];
let storeKey = 'pokemonPackCollection';

// Coins and shop
let coinStoreKey = 'pokemonPackCoins';
let dailyStoreKey = 'pokemonPackDaily';
let coins = 500;            // starting coins for a new player
let packCost = 100;         // price of one pack
let dailyReward = 150;      // coins for the daily reward
let dailyWait = 20 * 60 * 60 * 1000;  // hours between daily rewards (20h)
let lastDaily = 0;
let streak = 0;              // days in a row the daily reward was claimed
let streakStoreKey = 'pokemonPackStreak';
let dailyStreakWindow = 44 * 60 * 60 * 1000;  // claim within 44h of the last claim to keep the streak
let dailyStreakBonus = 50;   // extra coins per streak day
let dailyStreakMax = 6;      // bonus stops growing after this many extra days
let settled = {};   // trades already paid out to this account (stops double payouts)
let settledStoreKey = 'pokemonPackSettled';
// Coins you get for selling one spare copy of a card
let sellValues = {
  'Energy': 2,
  'Common': 5,
  'Uncommon': 7,
  'Rare': 10,
  'Ultra Rare': 150,
  'Mega Attack Rare': 600,
  'Mega Hyper Rare': 5000,
  'Pikachu Rare': 15,
  'Classic Collection': 200,
  'Illustration rare': 100,
  'Double rare': 25,
  'Futuristic Rare': 1000,
  'Special illustration rare': 500,
  'RGB Mew': 10000
};
let sortMode = 'price';
let sortStoreKey = 'pokemonPackSort';

// Only pictures from these sites are accepted when importing a backup
let allowedImageHosts = ['assets.tcgdex.net', 'images.carddex.dev', 'cardgamer.com', 'pkmncards.com'];

// Holo strength per rarity: 0 = none, 1 = maximum. 0.8 and above also get sparkles.
let holoLevels = {
  'Energy': 0.5,
  'Reverse holo': 0.6,
  'No foil': 0,
  'Uncommon': 0.4,
  'Ultra Rare': 0.9,
  'Mega Attack Rare': 1,
  'Mega Hyper Rare': 1,
  'Common': 0.35,
  'Pikachu Rare': 0.5,
  'Rare': 0.55,
  'Double rare': 0.65,
  'Illustration rare': 0.8,
  'Classic Collection': 0.85,
  'Special illustration rare': 1,
  'Futuristic Rare': 1,
  'RGB Mew': 1
};

// Overall holo strength: 1 = full, 0.5 = half, 0 = off
let holoStrength = 0.4;

let defaultSlots = [
  { 'Common': 100 },
  { 'Common': 100 },
  { 'Common': 70.3, 'Illustration rare': 19.7, 'Classic Collection': 10 },
  { 'Rare': 71.6, 'Double rare': 22.7, 'Special illustration rare': 4.88, 'Futuristic Rare': 0.83, 'RGB Mew': 0.025 }
];

let slots = JSON.parse(JSON.stringify(defaultSlots));

// Load saved custom rates (if any)
function loadRates() {
  try {
    let saved = JSON.parse(localStorage.getItem('customRates'));
    if (Array.isArray(saved) && saved.length === defaultSlots.length) {
      let ok = true;
      for (let i = 0; i < saved.length; i++) {
        for (let r in defaultSlots[i]) {
          if (typeof saved[i][r] !== 'number' || !(saved[i][r] >= 0)) { ok = false; }
        }
      }
      if (ok) {
        slots = saved.map(function (s, i) {
          let o = {};
          for (let r in defaultSlots[i]) { o[r] = s[r]; }
          return o;
        });
      }
    }
  } catch (e) {}
}
loadRates();

// ---------- Sets ----------
// Everything that differs between sets lives here. The 30th Celebration code below is unchanged;
// Ascended Heroes (TCGdex id me02.5) is added next to it.
let curSet = '30th';
let setStoreKey = 'pokemonPackSet';
let ascByRarity = {};
let ascLoaded = false;
let ascLoading = false;
let ascCount = 295;
let ascMainCount = 217;      // cards 001-217 are the main set, 218-295 are the secret rares
let ascCacheKey = 'pokemonAscCards_v1';
let ascCacheMaxAge = 24 * 60 * 60 * 1000;
let godNow = false;          // true while the pack on screen is a god pack

// Ascended Heroes pack: 1 energy + 9 cards. Each def is one kind of slot, n = how many of them.
let ascDefaultDefs = [
  { name: 'Commons (x3)', n: 3, rates: { 'Common': 100 } },
  { name: 'Uncommons (x3)', n: 3, rates: { 'Uncommon': 100 } },
  { name: 'Reverse holo slot', n: 1, rev: true, rates: { 'Common': 45, 'Uncommon': 42, 'Rare': 13 } },
  { name: 'Reverse holo / IR / SIR slot', n: 1, revUnless: ['Illustration rare', 'Special illustration rare'], rates: { 'Common': 43.75, 'Uncommon': 43.75, 'Illustration rare': 11.1, 'Special illustration rare': 1.43 } },
  { name: 'Rare slot', n: 1, rates: { 'Rare': 71.6, 'Double rare': 20, 'Ultra Rare': 4.76, 'Mega Attack Rare': 3.45, 'Mega Hyper Rare': 0.185 } },
  { name: 'God pack chance (percent of all packs)', n: 0, raw: true, rates: { 'God pack %': 0.05 } },
  { name: 'God pack: what each of the 9 cards can be', n: 0, rates: { 'Double rare': 40, 'Illustration rare': 25, 'Ultra Rare': 14, 'Special illustration rare': 12, 'Mega Attack Rare': 7.5, 'Mega Hyper Rare': 1.5 } }
];
let ascDefaultSlots = ascDefaultDefs.map(function (d) { return d.rates; });
let ascSlots = JSON.parse(JSON.stringify(ascDefaultSlots));

function loadAscRates() {
  try {
    let saved = JSON.parse(localStorage.getItem('customRatesAsc'));
    if (Array.isArray(saved) && saved.length === ascDefaultSlots.length) {
      let ok = true;
      for (let i = 0; i < saved.length; i++) {
        for (let r in ascDefaultSlots[i]) {
          if (!saved[i] || typeof saved[i][r] !== 'number' || !(saved[i][r] >= 0)) { ok = false; }
        }
      }
      if (ok) {
        ascSlots = saved.map(function (s, i) {
          let o = {};
          for (let r in ascDefaultSlots[i]) { o[r] = s[r]; }
          return o;
        });
      }
    }
  } catch (e) {}
}
loadAscRates();

let SETS = {
  '30th': {
    id: '30th',
    name: '30th Celebration',
    cost: 100,
    packImage: 'https://images.squarespace-cdn.com/content/v1/5e3b1164feb39b444b58f15b/71dbc8d9-d9e4-47fb-b30b-f01b52b2d03b/Pokemon_TCG_30th_Celebration_Booster_Wrap.png',
    packLabel: '30th<br>Celebration',
    rarityKey: 'customRates'
  },
  'asc': {
    id: 'asc',
    name: 'Ascended Heroes',
    cost: 150,
    packImage: 'https://tse2.mm.bing.net/th/id/OIP.jMhsGp9APOaSzVZVII2dRAAAAA?r=0&rs=1&pid=ImgDetMain&o=7&rm=3',
    packLabel: 'Ascended<br>Heroes',
    rarityKey: 'customRatesAsc'
  }
};

// Which set a card belongs to, from its key
function cardSet(key) {
  key = String(key || '');
  if (key.indexOf('/me02.5/') !== -1 || key.indexOf('energy-asc-') === 0) { return 'asc'; }
  return '30th';
}

function tableFor(setId) {
  return setId === 'asc' ? ascByRarity : byRarity;
}

function setReady(setId) {
  return setId === 'asc' ? ascLoaded : !!byRarity['Common'];
}

// Turns whatever TCGdex calls a rarity into the names this game uses
function normRarity(text) {
  let t = String(text || '').toLowerCase();
  if (t.indexOf('hyper') !== -1) { return 'Mega Hyper Rare'; }
  if (t.indexOf('attack') !== -1) { return 'Mega Attack Rare'; }
  if (t.indexOf('special illustration') !== -1) { return 'Special illustration rare'; }
  if (t.indexOf('illustration') !== -1) { return 'Illustration rare'; }
  if (t.indexOf('double') !== -1) { return 'Double rare'; }
  if (t.indexOf('ultra') !== -1) { return 'Ultra Rare'; }
  if (t.indexOf('uncommon') !== -1) { return 'Uncommon'; }
  if (t.indexOf('common') !== -1) { return 'Common'; }
  return 'Rare';
}


let energies = [
  { name: 'Grass', color: '#4caf50', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-009.png' },
  { name: 'Fire', color: '#e64a19', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-010.png' },
  { name: 'Water', color: '#1e88e5', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-011.png' },
  { name: 'Lightning', color: '#fbc02d', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-012.png' },
  { name: 'Psychic', color: '#8e24aa', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-013.png' },
  { name: 'Fighting', color: '#8d6e63', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-014.png' },
  { name: 'Darkness', color: '#37474f', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-015.png' },
  { name: 'Metal', color: '#90a4ae', image: 'https://cardgamer.com/wp-content/uploads/2026/08/30th-Celebration-Energy-016.png' }
];

// Ascended Heroes energy: same colours and names, art from the Mega Evolution Energies set (mee 001-008); a coloured box shows if a picture fails.
// If a picture is missing the game shows a coloured box instead.
let ascEnergies = energies.map(function (e, i) {
  return { name: e.name, color: e.color, image: 'https://pkmncards.com/wp-content/uploads/mee_en_' + String(i + 1).padStart(3, '0') + '_std.png' };
});

function energyKey(energy) {
  return (curSet === 'asc' ? 'energy-asc-' : 'energy-') + energy.name;
}

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Sound ----------

function getAudio() {
  if (!audioCtx) {
    let AudioClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioClass) {
      return null;
    }
    audioCtx = new AudioClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playNoise(duration, startFreq, endFreq, volume, q) {
  let ctx = getAudio();
  if (!ctx || !soundOn) {
    return;
  }
  let now = ctx.currentTime;
  let length = Math.floor(ctx.sampleRate * duration);
  let buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  let data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  let source = ctx.createBufferSource();
  source.buffer = buffer;
  let filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(startFreq, now);
  filter.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  let gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume * soundVolume, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
}

function playTone(freq, delay, duration, volume, type) {
  let ctx = getAudio();
  if (!ctx || !soundOn) {
    return;
  }
  let t = ctx.currentTime + delay;
  let osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  let gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume * soundVolume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

function playRip() {
  playNoise(0.55, 700, 4000, 0.6, 0.8);
  playNoise(0.3, 2500, 7000, 0.3, 0.5);
}

function playSwipe() {
  playNoise(0.22, 600, 2200, 0.3, 1.2);
}

function playHit(rarity) {
  let tier = hitTiers[rarity];
  if (!tier) {
    return;
  }
  if (tier === 1) {
    playTone(1046.5, 0, 0.35, 0.22, 'sine');
    playTone(1318.5, 0.1, 0.4, 0.22, 'sine');
  } else if (tier === 2) {
    playTone(1046.5, 0, 0.35, 0.22, 'sine');
    playTone(1318.5, 0.09, 0.35, 0.22, 'sine');
    playTone(1568, 0.18, 0.5, 0.22, 'sine');
  } else {
    let notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
    for (let i = 0; i < notes.length; i++) {
      playTone(notes[i], i * 0.08, 0.7, 0.2, 'triangle');
    }
    playNoise(0.9, 3000, 9000, 0.14, 2);
  }
}

function loadSound() {
  try {
    if (localStorage.getItem(soundStoreKey) === 'off') {
      soundOn = false;
    }
  } catch (e) {
  }
  document.getElementById('sound-btn').innerText = soundOn ? 'Sound: on' : 'Sound: off';
}

function toggleSound() {
  soundOn = !soundOn;
  try {
    localStorage.setItem(soundStoreKey, soundOn ? 'on' : 'off');
  } catch (e) {
  }
  document.getElementById('sound-btn').innerText = soundOn ? 'Sound: on' : 'Sound: off';
  if (soundOn) {
    playTone(880, 0, 0.15, 0.2, 'sine');
  }
}

// ---------- Cards ----------

function loadPackImage() {
  let img = new Image();
  img.onload = function () {
    packRatio = img.naturalHeight / img.naturalWidth;
  };
  img.onerror = function () {
    packRatio = null;
  };
  img.src = packImageUrl;
}

function cardImage(url) {
  return '<img src="' + esc(url) + '" width="' + cardW + '" onload="fixSideways(this)" onerror="retryImage(this)">';
}

function holoHtml(rarity) {
  let level = holoLevels[rarity];
  if (level === undefined) {
    level = 0.4;
  }
  let classes = 'holo idle';
  if (level >= 0.8) {
    classes = classes + ' high';
  }
  return '<div class="' + classes + '" style="--holo:' + (level * holoStrength) + '"><div class="sparkle"></div></div>';
}

function fixSideways(img) {
  if (img.dataset.fixed) {
    return;
  }
  let w = Number(img.dataset.w) || cardW;
  let h = Number(img.dataset.h) || cardH;
  if (img.naturalWidth > img.naturalHeight) {
    img.dataset.fixed = 'yes';
    let wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative; width:' + w + 'px; height:' + h + 'px; overflow:hidden;';
    let turn = 'translateX(' + w + 'px) rotate(90deg)';
    if (rotateDirection === -90) {
      turn = 'translateY(' + h + 'px) rotate(-90deg)';
    }
    img.style.cssText = 'position:absolute; top:0; left:0; width:' + h + 'px; height:' + w + 'px; transform-origin:top left; transform:' + turn + ';';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
  }
}

function energyBox(energy, w, h) {
  w = w || cardW;
  h = h || cardH;
  return '<div style="width:' + w + 'px; height:' + h + 'px; background:' + energy.color + '; color:white; text-align:center; line-height:' + h + 'px; font-weight:bold; font-size:' + Math.round(22 * w / cardW) + 'px;">' + esc(energy.name) + ' Energy</div>';
}

function energyHtml(energy) {
  if (energy.image !== '') {
    return '<img src="' + esc(energy.image) + '" width="' + cardW + '" data-energy="' + esc(energy.name) + '" onload="fixSideways(this)" onerror="retryImage(this)">';
  }
  return energyBox(energy);
}

function retryImage(img) {
  let tries = Number(img.dataset.tries || 0);
  if (tries < 3) {
    img.dataset.tries = tries + 1;
    let base = img.src.split('?')[0];
    setTimeout(function () {
      img.src = base + '?retry=' + (tries + 1);
    }, 500);
  } else if (img.dataset.energy) {
    for (let i = 0; i < energies.length; i++) {
      if (energies[i].name === img.dataset.energy) {
        img.outerHTML = energyBox(energies[i], Number(img.dataset.w) || cardW, Number(img.dataset.h) || cardH);
      }
    }
  }
}

function pickFrom(list) {
  let index = Math.floor(Math.random() * list.length);
  return list[index];
}

function pickRarity(rates, table) {
  table = table || byRarity;
  let usable = [];
  let sum = 0;
  for (let rarity in rates) {
    let w = rates[rarity];
    if (w > 0 && table[rarity] && table[rarity].length > 0) {
      usable.push(rarity);
      sum = sum + w;
    }
  }
  if (usable.length === 0) {
    // all weights zero: fall back to the default rates for this slot
    for (let rarity in rates) {
      if (table[rarity] && table[rarity].length > 0) { return rarity; }
    }
    return null;
  }
  let roll = Math.random() * sum;
  let total = 0;
  for (let i = 0; i < usable.length; i++) {
    total = total + rates[usable[i]];
    if (roll < total) {
      return usable[i];
    }
  }
  return usable[usable.length - 1];
}

function preload(url) {
  return new Promise(function (resolve) {
    let img = new Image();
    img.onload = function () { resolve(null); };
    img.onerror = function () { resolve(url); };
    img.src = url;
  });
}

async function preloadAll(urls) {
  let failed = urls;
  for (let attempt = 0; attempt < 3; attempt++) {
    let stillFailed = [];
    for (let i = 0; i < failed.length; i += 25) {
      let batch = failed.slice(i, i + 25);
      let jobs = [];
      for (let j = 0; j < batch.length; j++) {
        jobs.push(preload(batch[j]));
      }
      let results = await Promise.all(jobs);
      for (let k = 0; k < results.length; k++) {
        if (results[k] !== null) {
          stillFailed.push(results[k]);
        }
      }
    }
    failed = stillFailed;
    if (failed.length === 0) {
      break;
    }
  }
  return failed;
}

// ---------- Prices ----------

function priceIdFromUrl(url) {
  let id = null;
  let asc = url.match(/\/me02\.5\/(\d{3})\//);
  if (asc) { return 'me02.5-' + asc[1]; }
  let main = url.match(/\/30th\/(\d{3})\//);
  if (main) {
    id = '30c-' + main[1];
  } else {
    let other = url.match(/\/cards\/[^\/]+\/([^\/]+)\.webp/);
    if (other) {
      id = other[1];
    }
  }
  if (id && /^[A-Za-z0-9-]+$/.test(id)) {
    return id;
  }
  return null;
}

function loadPriceCache() {
  try {
    let saved = localStorage.getItem(priceStoreKey);
    if (saved) {
      priceCache = JSON.parse(saved);
    }
  } catch (e) {
    priceCache = {};
  }
}

function savePriceCache() {
  try {
    localStorage.setItem(priceStoreKey, JSON.stringify(priceCache));
  } catch (e) {
  }
}

async function fetchPrice(id) {
  if (id.indexOf('me02.5-') === 0) {
    try {
      let res = await fetch('https://api.tcgdex.net/v2/en/cards/' + id);
      if (!res.ok) { return null; }
      let card = await res.json();
      return ascEur(card);
    } catch (e) {
      return null;
    }
  }
  try {
    let response = await fetch(priceApi + id + '?include=prices');
    if (!response.ok) {
      return null;
    }
    let json = await response.json();
    let prices = json.data.prices;
    if (!prices || prices.length === 0) {
      return null;
    }
    let p = prices[0];
    let eur = p[priceField];
    if (eur === null || eur === undefined) {
      eur = p.trend_price;
    }
    if (eur === null || eur === undefined) {
      eur = p.avg_price;
    }
    if (eur === null || eur === undefined) {
      return null;
    }
    return eur;
  } catch (e) {
    return null;
  }
}

function isFresh(id) {
  let cached = priceCache[id];
  return cached && Date.now() - cached.t < priceMaxAge;
}

async function getPrice(id) {
  if (isFresh(id)) {
    return priceCache[id].eur;
  }
  if (failedIds[id]) {
    return null;
  }
  let eur = await fetchPrice(id);
  if (eur === null) {
    if (priceCache[id]) {
      return priceCache[id].eur;
    }
    failedIds[id] = true;
    return null;
  }
  priceCache[id] = { eur: eur, t: Date.now() };
  savePriceCache();
  return eur;
}

function priceText(id) {
  let cached = priceCache[id];
  if (cached) {
    return currencySymbol + (cached.eur * eurToAud).toFixed(2);
  }
  if (failedIds[id]) {
    return '\u2014';
  }
  return '...';
}

function updatePriceLabels(id) {
  let labels = document.querySelectorAll('[data-price-id="' + id + '"]');
  for (let i = 0; i < labels.length; i++) {
    labels[i].innerText = priceText(id);
  }
  if (sortMode === 'price') {
    sortCollectionDom();
  }
  if (stackCards.length > 0 && topIndex >= stackCards.length) {
    showProgress();
  }
}

function loadPackPrices(items) {
  for (let i = 0; i < items.length; i++) {
    let id = items[i].cardId;
    if (id) {
      getPrice(id).then(function () {
        updatePriceLabels(id);
      });
    }
  }
}

function queuePrice(id) {
  if (priceQueue.indexOf(id) === -1) {
    priceQueue.push(id);
  }
  runQueue();
}

async function runQueue() {
  if (queueRunning) {
    return;
  }
  queueRunning = true;
  while (priceQueue.length > 0) {
    let id = priceQueue.shift();
    await getPrice(id);
    updatePriceLabels(id);
    await new Promise(function (resolve) {
      setTimeout(resolve, 2200);
    });
  }
  queueRunning = false;
}

function packValueText() {
  let total = 0;
  let missing = 0;
  let pending = 0;
  for (let i = 0; i < currentItems.length; i++) {
    let id = currentItems[i].cardId;
    if (!id) {
      continue;
    }
    if (priceCache[id]) {
      total = total + priceCache[id].eur * eurToAud;
    } else if (failedIds[id]) {
      missing = missing + 1;
    } else {
      pending = pending + 1;
    }
  }
  let text = 'Pack value: ' + currencySymbol + total.toFixed(2) + '.';
  if (missing > 0) {
    text = text + ' (' + missing + ' without a price)';
  }
  if (pending > 0) {
    text = text + ' (still loading prices)';
  }
  return text;
}

// ---------- Collection ----------

function loadCollection() {
  try {
    let saved = localStorage.getItem(storeKey);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
  }
  return { cards: {}, packs: 0 };
}

function saveCollection(data) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(data));
  } catch (e) {
  }
  cloudChanged();
}

function loadSortMode() {
  try {
    let saved = localStorage.getItem(sortStoreKey);
    if (saved === 'price' || saved === 'rarity') {
      sortMode = saved;
    }
  } catch (e) {
  }
  document.getElementById('coll-sort').value = sortMode;
}

function changeSort(value) {
  sortMode = value;
  try {
    localStorage.setItem(sortStoreKey, sortMode);
  } catch (e) {
  }
  sortCollectionDom();
}

function collPrice(el) {
  let id = el.dataset.pid;
  if (id && priceCache[id]) {
    return priceCache[id].eur;
  }
  return -1;
}

function sortCollectionDom() {
  let grid = document.getElementById('coll-grid');
  let cards = Array.from(grid.querySelectorAll('.coll-card'));
  if (cards.length === 0) {
    return;
  }
  cards.sort(function (a, b) {
    if (sortMode === 'price') {
      let pa = collPrice(a);
      let pb = collPrice(b);
      if (pa !== pb) {
        return pb - pa;
      }
    }
    let ra = Number(a.dataset.rank);
    let rb = Number(b.dataset.rank);
    if (ra !== rb) {
      return ra - rb;
    }
    return a.dataset.key < b.dataset.key ? -1 : 1;
  });
  for (let i = 0; i < cards.length; i++) {
    grid.appendChild(cards[i]);
  }
}

function addToCollection(items) {
  let data = loadCollection();
  data.packs = data.packs + 1;
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    if (!data.cards[item.key]) {
      data.cards[item.key] = { count: 0, rarity: item.rarity, img: item.img || '', name: item.name || '', color: item.color || '' };
    }
    data.cards[item.key].count = data.cards[item.key].count + 1;
  }
  saveCollection(data);
  renderCollection();
}

function renderProgress(data) {
  let box = document.getElementById('coll-progress');
  let table = tableFor(curSet);
  if (!setReady(curSet)) {
    box.innerHTML = '<div class="progress-text">Loading ' + esc(SETS[curSet].name) + '...</div>';
    return;
  }
  let owned = {};
  let keys = Object.keys(data.cards);
  for (let i = 0; i < keys.length; i++) {
    if (cardSet(keys[i]) !== curSet) { continue; }
    let r = data.cards[keys[i]].rarity;
    owned[r] = (owned[r] || 0) + 1;
  }
  let totalAll = 0;
  let ownedAll = 0;
  let chips = '';
  for (let i = 0; i < rarityOrder.length; i++) {
    let r = rarityOrder[i];
    let total = 0;
    if (r === 'Energy') {
      total = energies.length;
    } else if (table[r]) {
      total = table[r].length;
    }
    if (total === 0) {
      continue;
    }
    let have = Math.min(owned[r] || 0, total);
    totalAll = totalAll + total;
    ownedAll = ownedAll + have;
    let done = '';
    if (have === total) {
      done = ' done';
    }
    chips = chips + '<span class="chip' + done + '">' + esc(r) + ' ' + have + '/' + total + '</span>';
  }
  let pct = 0;
  if (totalAll > 0) {
    pct = Math.round(ownedAll / totalAll * 100);
  }
  box.innerHTML =
    '<div class="progress-text">' + esc(SETS[curSet].name) + ': ' + ownedAll + ' of ' + totalAll + ' cards collected (' + pct + '%)</div>' +
    '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="chips">' + chips + '</div>';
}

let collSetFilter = 'all';
let collSetKey = 'pokemonPackCollSet';

function changeCollSet(value) {
  collSetFilter = (value === '30th' || value === 'asc') ? value : 'all';
  try { localStorage.setItem(collSetKey, collSetFilter); } catch (e) {}
  renderCollection();
}

function renderCollection() {
  let data = loadCollection();
  let keys = Object.keys(data.cards);
  let grid = document.getElementById('coll-grid');
  let stats = document.getElementById('coll-stats');

  renderProgress(data);
  renderBinder();

  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    total = total + data.cards[keys[i]].count;
  }
  stats.innerText = keys.length + ' unique \u00b7 ' + total + ' total \u00b7 ' + data.packs + ' packs opened';

  if (keys.length === 0) {
    grid.innerHTML = '<div class="coll-empty">No cards yet. Rip a pack to start your collection!</div>';
    return;
  }

  let html = '';
  for (let i = 0; i < keys.length; i++) {
    if (collSetFilter !== 'all' && cardSet(keys[i]) !== collSetFilter) { continue; }
    let card = data.cards[keys[i]];
    let inner = '';
    let id = null;
    if (card.img) {
      let energyAttr = '';
      if (card.rarity === 'Energy') {
        energyAttr = ' data-energy="' + esc(card.name) + '"';
      } else {
        id = priceIdFromUrl(card.img);
      }
      inner = '<img src="' + esc(card.img) + '" width="' + thumbW + '" data-w="' + thumbW + '" data-h="' + thumbH + '"' + energyAttr + ' onload="fixSideways(this)" onerror="retryImage(this)">';
    } else {
      let safeColor = '#888888';
      if (/^#[0-9a-fA-F]{3,8}$/.test(card.color)) {
        safeColor = card.color;
      }
      inner = energyBox({ name: card.name, color: safeColor }, thumbW, thumbH);
    }
    let badge = '';
    if (card.count > 1) {
      badge = '<div class="coll-badge">x' + card.count + '</div>';
    }
    let price = '<div class="coll-price">\u2014</div>';
    if (id) {
      price = '<div class="coll-price" data-price-id="' + esc(id) + '">' + esc(priceText(id)) + '</div>';
    }
    let sell = '<button class="coll-sell" data-sell="' + esc(keys[i]) + '">Sell +' + sellValue(card.rarity) + '</button>';
    let rank = rarityOrder.indexOf(card.rarity);
    if (rank === -1) {
      rank = 99;
    }
    html = html + '<div class="coll-card" data-pid="' + esc(id || '') + '" data-rank="' + rank + '" data-key="' + esc(keys[i]) + '">' + inner + badge + price + sell + '</div>';
  }
  if (html === '') {
    html = '<div class="coll-empty">No cards from this set yet.</div>';
  }
  grid.innerHTML = html;
  sortCollectionDom();

  let labels = grid.querySelectorAll('[data-price-id]');
  for (let i = 0; i < labels.length; i++) {
    let id = labels[i].dataset.priceId;
    if (!isFresh(id) && !failedIds[id]) {
      queuePrice(id);
    }
  }
}

function clearCollection() {
  if (confirm('Clear your whole collection? This cannot be undone.')) {
    try {
      localStorage.removeItem(storeKey);
    } catch (e) {
    }
    cloudChanged();
    renderCollection();
  }
}



// ---------- Online saving hooks (used by cloud.js) ----------

// Called whenever coins or cards change. cloud.js replaces cloudPush when you sign in.
let cloudPush = null;
function cloudChanged() {
  if (cloudPush) { cloudPush(); }
}

// Everything that gets saved online
function getSaveData() {
  return { coins: coins, lastDaily: lastDaily, streak: streak, collection: loadCollection(), settled: settled };
}

// Replace what's on this device with saved data (does not trigger an online save)
function applySaveData(d) {
  coins = (d && d.coins >= 0) ? d.coins : 500;
  lastDaily = (d && d.lastDaily > 0) ? d.lastDaily : 0;
  streak = (d && d.streak > 0) ? d.streak : 0;
  let collection = (d && d.collection) ? d.collection : { cards: {}, packs: 0 };
  settled = (d && d.settled && typeof d.settled === 'object') ? d.settled : {};
  try {
    localStorage.setItem(settledStoreKey, JSON.stringify(settled));
    localStorage.setItem(coinStoreKey, String(coins));
    localStorage.setItem(dailyStoreKey, String(lastDaily));
    localStorage.setItem(streakStoreKey, String(streak));
    localStorage.setItem(storeKey, JSON.stringify(collection));
  } catch (e) {
  }
  updateShop();
  renderCollection();
}

// True if this device has any progress at all
function hasLocalProgress() {
  let c = loadCollection();
  return c.packs > 0 || Object.keys(c.cards).length > 0 || coins !== 500;
}

// ---------- Coins and shop ----------

function loadCoins() {
  try {
    let saved = localStorage.getItem(coinStoreKey);
    if (saved !== null) {
      let n = parseInt(saved, 10);
      if (n >= 0) { coins = n; }
    }
    let d = parseInt(localStorage.getItem(dailyStoreKey), 10);
    if (d > 0) { lastDaily = d; }
    let st = parseInt(localStorage.getItem(streakStoreKey), 10);
    if (st > 0) { streak = st; }
    let s = JSON.parse(localStorage.getItem(settledStoreKey) || '{}');
    if (s && typeof s === 'object') { settled = s; }
  } catch (e) {
  }
}

function saveCoins() {
  try {
    localStorage.setItem(coinStoreKey, String(coins));
    localStorage.setItem(dailyStoreKey, String(lastDaily));
    localStorage.setItem(streakStoreKey, String(streak));
  } catch (e) {
  }
  cloudChanged();
}

// Writes an entry to your online activity history (does nothing if signed out)
function logEvent(type, data) {
  if (window.cloudLog) { window.cloudLog(type, data || {}); }
}

function saveSettled() {
  try { localStorage.setItem(settledStoreKey, JSON.stringify(settled)); } catch (e) {}
}

function addCoins(amount) {
  coins = coins + amount;
  saveCoins();
  updateShop();
}

function sellValue(rarity) {
  return sellValues[rarity] || 1;
}

function dailyText() {
  let left = lastDaily + dailyWait - Date.now();
  if (left <= 0) {
    return '';
  }
  let mins = Math.ceil(left / 60000);
  let h = Math.floor(mins / 60);
  return h + 'h ' + (mins % 60) + 'm';
}

function updateShop() {
  let c = document.getElementById('coin-count');
  if (c) { c.innerText = coins.toLocaleString(); }
  let btn = document.getElementById('open-btn');
  if (btn) {
    btn.innerText = 'Open Pack · ' + packCost + ' coins';
    btn.classList.toggle('poor', coins < packCost);
  }
  let d = document.getElementById('daily-btn');
  if (d) {
    let wait = dailyText();
    if (wait) {
      d.innerText = 'Daily reward in ' + wait + (streak > 1 ? ' \u00b7 ' + streak + ' day streak' : '');
      d.disabled = true;
    } else {
      let next = nextDaily();
      d.innerText = 'Claim daily reward (+' + next.amount + ')' + (next.streak > 1 ? ' \u00b7 day ' + next.streak : '');
      d.disabled = false;
    }
  }
}

// What the next daily claim would give
function nextDaily() {
  let n = 1;
  if (lastDaily > 0 && Date.now() - lastDaily < dailyStreakWindow) { n = streak + 1; }
  let amount = dailyReward + dailyStreakBonus * Math.min(n - 1, dailyStreakMax);
  return { streak: n, amount: amount };
}

function claimDaily() {
  if (dailyText()) { return; }
  let next = nextDaily();
  streak = next.streak;
  lastDaily = Date.now();
  addCoins(next.amount);
  playTone(880, 0, 0.12, 0.2, 'sine');
  playTone(1320, 0.1, 0.18, 0.2, 'sine');
  document.getElementById('info').innerText = 'You claimed ' + next.amount + ' coins! Day ' + streak + ' streak.';
  logEvent('daily', { coins: next.amount, streak: streak });
}

function sellDuplicate(key) {
  let data = loadCollection();
  let card = data.cards[key];
  if (!card || card.count < 1) {
    return;
  }
  let value = sellValue(card.rarity);
  if (card.count === 1) {
    if (!confirm('This is your last copy. Sell it for ' + value + ' coins? It will leave your collection.')) {
      return;
    }
    delete data.cards[key];
  } else {
    card.count = card.count - 1;
  }
  saveCollection(data);
  addCoins(value);
  playTone(660, 0, 0.1, 0.18, 'triangle');
  logEvent('sell', { k: key, r: card.rarity, coins: value });
  renderCollection();
}

function sellAllDuplicates() {
  let data = loadCollection();
  let total = 0;
  let sold = 0;
  for (let key in data.cards) {
    let card = data.cards[key];
    if (card.count > 1) {
      let extra = card.count - 1;
      total = total + extra * sellValue(card.rarity);
      sold = sold + extra;
      card.count = 1;
    }
  }
  if (sold === 0) {
    document.getElementById('info').innerText = 'You have no spare copies to sell.';
    return;
  }
  if (!confirm('Sell ' + sold + ' spare cards for ' + total + ' coins? You keep one of each card.')) {
    return;
  }
  saveCollection(data);
  addCoins(total);
  playTone(660, 0, 0.1, 0.18, 'triangle');
  playTone(990, 0.1, 0.16, 0.18, 'triangle');
  document.getElementById('info').innerText = 'Sold ' + sold + ' spare cards for ' + total + ' coins.';
  logEvent('sellAll', { n: sold, coins: total });
  renderCollection();
}


// ---------- Binder ----------

let binderPage = 0;
let binderPerPage = 9;   // 3 x 3 pockets, like a real binder page
let viewStoreKey = 'pokemonPackView';

// Builds the list of pages for the chosen set. Each section starts on a new page.
function binderPages(setId) {
  setId = setId || curSet;
  let sections = [];

  if (setId === 'asc') {
    let main = [];
    let secret = [];
    for (let rarity in ascByRarity) {
      for (let i = 0; i < ascByRarity[rarity].length; i++) {
        let url = ascByRarity[rarity][i];
        let m = url.match(/\/me02\.5\/(\d{3})\//);
        if (!m) { continue; }
        let n = Number(m[1]);
        let slot = { key: url, rarity: rarity, label: String(n), num: n };
        if (n <= ascMainCount) { main.push(slot); } else { secret.push(slot); }
      }
    }
    main.sort(function (a, b) { return a.num - b.num; });
    secret.sort(function (a, b) { return a.num - b.num; });
    sections.push({ title: 'Main set', slots: main });
    sections.push({ title: 'Secret rares', slots: secret });
    let aen = [];
    for (let i = 0; i < ascEnergies.length; i++) {
      aen.push({ key: 'energy-asc-' + ascEnergies[i].name, rarity: 'Energy', label: ascEnergies[i].name });
    }
    sections.push({ title: 'Energies', slots: aen });
  } else {
    let main = [];
    for (let rarity in byRarity) {
      for (let i = 0; i < byRarity[rarity].length; i++) {
        let url = byRarity[rarity][i];
        let m = url.match(/\/30th\/(\d{3})\//);
        if (m) {
          main.push({ key: url, rarity: rarity, label: String(Number(m[1])), num: Number(m[1]) });
        }
      }
    }
    main.sort(function (a, b) { return a.num - b.num; });
    sections.push({ title: 'Main set', slots: main });

    let cc = [];
    let ccList = byRarity['Classic Collection'] || [];
    for (let i = 0; i < ccList.length; i++) {
      cc.push({ key: ccList[i], rarity: 'Classic Collection', label: 'CC ' + (i + 1) });
    }
    sections.push({ title: 'Classic Collection', slots: cc });

    let rgb = [];
    let rgbList = byRarity['RGB Mew'] || [];
    let rgbNames = ['R', 'G', 'B'];
    for (let i = 0; i < rgbList.length; i++) {
      rgb.push({ key: rgbList[i], rarity: 'RGB Mew', label: 'Mew ' + (rgbNames[i] || (i + 1)) });
    }
    sections.push({ title: 'RGB Mew', slots: rgb });

    let en = [];
    for (let i = 0; i < energies.length; i++) {
      en.push({ key: 'energy-' + energies[i].name, rarity: 'Energy', label: energies[i].name });
    }
    sections.push({ title: 'Energies', slots: en });
  }

  let pages = [];
  for (let s = 0; s < sections.length; s++) {
    let sec = sections[s];
    let count = Math.ceil(sec.slots.length / binderPerPage);
    for (let p = 0; p < count; p++) {
      pages.push({
        title: sec.title,
        part: p + 1,
        parts: count,
        slots: sec.slots.slice(p * binderPerPage, (p + 1) * binderPerPage)
      });
    }
  }
  if (pages.length === 0) {
    pages.push({ title: 'Loading', part: 1, parts: 1, slots: [] });
  }
  return pages;
}

function binderSlotHtml(slot, card, w, h) {
  if (!card) {
    return '<div class="bslot empty" style="width:' + w + 'px; height:' + h + 'px;"><span>' + esc(slot.label) + '</span></div>';
  }
  let inner = '';
  if (card.img) {
    let energyAttr = '';
    if (card.rarity === 'Energy') {
      energyAttr = ' data-energy="' + esc(card.name) + '"';
    }
    inner = '<img src="' + esc(card.img) + '" width="' + w + '" data-w="' + w + '" data-h="' + h + '"' + energyAttr + ' onload="fixSideways(this)" onerror="retryImage(this)">';
  } else {
    let safeColor = '#888888';
    if (/^#[0-9a-fA-F]{3,8}$/.test(card.color)) {
      safeColor = card.color;
    }
    inner = energyBox({ name: card.name, color: safeColor }, w, h);
  }
  let badge = '';
  if (card.count > 1) {
    badge = '<div class="coll-badge">x' + card.count + '</div>';
  }
  return '<div class="bslot" style="width:' + w + 'px; height:' + h + 'px;">' + inner + badge + '</div>';
}

function renderBinder() {
  let box = document.getElementById('binder-page');
  if (!box) { return; }
  if (!setReady(curSet)) {
    box.innerHTML = '<div class="coll-empty">Loading cards...</div>';
    return;
  }
  let data = loadCollection();
  let pages = binderPages();
  if (binderPage >= pages.length) { binderPage = pages.length - 1; }
  if (binderPage < 0) { binderPage = 0; }
  let page = pages[binderPage];

  let w = 130;
  if (window.innerWidth < 500) { w = 96; }
  let h = Math.round(w * 151 / 110);

  let owned = 0;
  let html = '';
  for (let i = 0; i < binderPerPage; i++) {
    let slot = page.slots[i];
    if (!slot) {
      html += '<div class="bslot blank" style="width:' + w + 'px; height:' + h + 'px;"></div>';
      continue;
    }
    let card = data.cards[slot.key] || null;
    if (card) { owned++; }
    html += binderSlotHtml(slot, card, w, h);
  }
  box.innerHTML = html;

  let title = page.title;
  if (page.parts > 1) { title += ' · ' + page.part + '/' + page.parts; }
  document.getElementById('binder-title').innerText = title;
  document.getElementById('binder-count').innerText = owned + ' of ' + page.slots.length + ' on this page';

  let sel = document.getElementById('binder-select');
  if (sel.options.length !== pages.length || sel.dataset.set !== curSet) {
    sel.dataset.set = curSet;
    let opts = '';
    for (let i = 0; i < pages.length; i++) {
      let t = pages[i].title;
      if (pages[i].parts > 1) { t += ' ' + pages[i].part; }
      opts += '<option value="' + i + '">Page ' + (i + 1) + ' - ' + esc(t) + '</option>';
    }
    sel.innerHTML = opts;
  }
  sel.value = String(binderPage);
  document.getElementById('binder-prev').disabled = binderPage === 0;
  document.getElementById('binder-next').disabled = binderPage >= pages.length - 1;
}

function binderGo(delta) {
  binderPage = binderPage + delta;
  playSwipe();
  renderBinder();
}

function binderJump(value) {
  binderPage = Number(value) || 0;
  renderBinder();
}

function showView(name) {
  let views = { collection: 'coll-view', binder: 'binder-view', trades: 'trade-view', market: 'market-view' };
  let tabs = { collection: 'tab-coll', binder: 'tab-binder', trades: 'tab-trades', market: 'tab-market' };
  if (!views[name]) { name = 'collection'; }
  for (let v in views) {
    let el = document.getElementById(views[v]);
    if (el) { el.style.display = (v === name) ? '' : 'none'; }
    let tab = document.getElementById(tabs[v]);
    if (tab) { tab.classList.toggle('active', v === name); }
  }
  try { localStorage.setItem(viewStoreKey, name); } catch (e) {}
  if (name === 'binder') { renderBinder(); }
  if (name === 'trades' && window.renderTrades) { window.renderTrades(); }
  if (name === 'market' && window.renderMarket) { window.renderMarket(); }
}

function loadView() {
  let name = 'collection';
  try {
    let saved = localStorage.getItem(viewStoreKey);
    if (saved === 'binder' || saved === 'trades' || saved === 'market') { name = saved; }
  } catch (e) {}
  showView(name);
}


// ---------- Reward coins ----------

let rewardPackMilestones = [[10, 200], [25, 400], [50, 800], [100, 1500], [250, 4000], [500, 8000], [1000, 20000]];
let rewardPageBonus = { 'Main set': 50, 'Classic Collection': 150, 'RGB Mew': 1000, 'Energies': 50 };
let rewardRarityBonus = {
  'Energy': 100,
  'Common': 300,
  'Rare': 300,
  'Pikachu Rare': 200,
  'Double rare': 500,
  'Illustration rare': 1000,
  'Classic Collection': 2000,
  'Special illustration rare': 3000,
  'Futuristic Rare': 5000,
  'RGB Mew': 10000
};
// Ascended Heroes rewards
let ascPageBonus = { 'Main set': 100, 'Secret rares': 400, 'Energies': 50 };
let ascRarityBonus = {
  'Energy': 100,
  'Common': 400,
  'Uncommon': 400,
  'Rare': 400,
  'Double rare': 800,
  'Illustration rare': 1500,
  'Ultra Rare': 1500,
  'Special illustration rare': 4000,
  'Mega Attack Rare': 5000,
  'Mega Hyper Rare': 8000
};
let rewardNote = '';   // shown after a pack finishes

// Checks every reward and pays out any that were just earned. Each is paid once per account.
function checkRewards() {
  if (!byRarity['Common']) { return; }
  let data = loadCollection();
  let notes = [];
  let total = 0;

  function grant(key, amount, text) {
    if (settled[key]) { return; }
    settled[key] = true;
    total = total + amount;
    notes.push(text + ' +' + amount);
    logEvent('reward', { kind: key, coins: amount });
  }

  for (let i = 0; i < rewardPackMilestones.length; i++) {
    let m = rewardPackMilestones[i];
    if (data.packs >= m[0]) { grant('reward:packs:' + m[0], m[1], m[0] + ' packs opened'); }
  }

  function setRewards(setId) {
    let asc = setId === 'asc';
    let table = tableFor(setId);
    let prefix = asc ? 'reward:asc:' : 'reward:';
    let pageBonus = asc ? ascPageBonus : rewardPageBonus;
    let rarityBonus = asc ? ascRarityBonus : rewardRarityBonus;
    let tag = asc ? 'Ascended Heroes: ' : '';
    let list = asc ? ascEnergies : energies;

    let pages = binderPages(setId);
    for (let i = 0; i < pages.length; i++) {
      let page = pages[i];
      if (page.slots.length === 0) { continue; }
      let all = true;
      for (let s = 0; s < page.slots.length; s++) {
        if (!data.cards[page.slots[s].key]) { all = false; break; }
      }
      if (all) {
        grant(prefix + 'page:' + page.title + ':' + page.part, pageBonus[page.title] || 50, tag + 'Binder page ' + (i + 1) + ' complete');
      }
    }

    for (let r in rarityBonus) {
      let keys = [];
      if (r === 'Energy') {
        for (let i = 0; i < list.length; i++) { keys.push((asc ? 'energy-asc-' : 'energy-') + list[i].name); }
      } else if (table[r]) {
        keys = table[r];
      }
      if (keys.length === 0) { continue; }
      let all = true;
      for (let i = 0; i < keys.length; i++) {
        if (!data.cards[keys[i]]) { all = false; break; }
      }
      if (all) { grant(prefix + 'rarity:' + r, rarityBonus[r], tag + 'All ' + r + ' cards collected'); }
    }
  }

  setRewards('30th');
  if (ascLoaded) { setRewards('asc'); }

  if (total > 0) {
    coins = coins + total;
    saveSettled();
    saveCoins();
    updateShop();
    rewardNote = 'Rewards: ' + notes.join(', ') + ' coins!';
    playTone(784, 0, 0.12, 0.2, 'sine');
    playTone(988, 0.1, 0.12, 0.2, 'sine');
    playTone(1319, 0.2, 0.2, 0.2, 'sine');
    // If no pack is being swiped right now, show it straight away
    if (topIndex >= stackCards.length || stackCards.length === 0) {
      document.getElementById('info').innerText = rewardNote;
      rewardNote = '';
    }
  }
}

window.addEventListener('cloud-ready', function () { checkRewards(); });

// ---------- Backup and restore ----------

function exportCollection() {
  let data = loadCollection();
  let backup = {
    app: 'pokemon-pack-simulator',
    version: 1,
    exported: new Date().toISOString(),
    packs: data.packs,
    cards: data.cards
  };
  let blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  let url = URL.createObjectURL(blob);
  let link = document.createElement('a');
  link.href = url;
  link.download = 'pokemon-collection-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

function goodImageUrl(url) {
  try {
    let parsed = new URL(url);
    return parsed.protocol === 'https:' && allowedImageHosts.indexOf(parsed.hostname) !== -1;
  } catch (e) {
    return false;
  }
}

function cleanBackup(raw) {
  if (!raw || typeof raw !== 'object' || !raw.cards || typeof raw.cards !== 'object') {
    return null;
  }
  let cards = {};
  let keys = Object.keys(raw.cards);
  for (let i = 0; i < keys.length; i++) {
    let key = keys[i];
    let c = raw.cards[key];
    if (!c || typeof c !== 'object') {
      continue;
    }
    let count = Math.floor(Number(c.count));
    if (!(count >= 1)) {
      continue;
    }
    let img = '';
    if (typeof c.img === 'string') {
      img = c.img;
    }
    if (img !== '' && !goodImageUrl(img)) {
      continue;
    }
    if (key.indexOf('energy-') !== 0 && !goodImageUrl(key)) {
      continue;
    }
    let rarity = 'Common';
    if (typeof c.rarity === 'string') {
      rarity = c.rarity.slice(0, 40);
    }
    let name = '';
    if (typeof c.name === 'string') {
      name = c.name.slice(0, 40);
    }
    let color = '';
    if (typeof c.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c.color)) {
      color = c.color;
    }
    cards[key] = { count: Math.min(count, 100000), rarity: rarity, img: img, name: name, color: color };
  }
  if (Object.keys(cards).length === 0) {
    return null;
  }
  let packs = Math.floor(Number(raw.packs));
  if (!(packs >= 0)) {
    packs = 0;
  }
  return { cards: cards, packs: packs };
}

function importCollection(event) {
  let input = event.target;
  let file = input.files[0];
  if (!file) {
    return;
  }
  let reader = new FileReader();
  reader.onload = function () {
    let clean = null;
    try {
      clean = cleanBackup(JSON.parse(reader.result));
    } catch (e) {
      clean = null;
    }
    if (!clean) {
      alert("That file doesn't look like a collection backup.");
    } else {
      let message = 'Replace your current collection with this backup (' + Object.keys(clean.cards).length + ' unique cards, ' + clean.packs + ' packs)?';
      if (confirm(message)) {
        saveCollection(clean);
        renderCollection();
      }
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ---------- Pack and stack ----------

function layoutStack() {
  for (let i = 0; i < stackCards.length; i++) {
    let depth = i - topIndex;
    if (depth < 0) {
      continue;
    }
    let card = stackCards[i];
    card.style.zIndex = 100 - depth;
    card.style.transition = 'transform 0.25s, opacity 0.5s, top 0.5s';
    card.style.transform = 'translateY(' + (depth * 8) + 'px) scale(' + (1 - depth * 0.04) + ')';
    card.style.display = depth > 3 ? 'none' : 'block';
  }
}

function showProgress() {
  let info = document.getElementById('info');
  if (topIndex >= stackCards.length) {
    info.innerText = (godNow ? 'GOD PACK! ' : '') + 'Pack finished! ' + packValueText() + ' Click Open Pack for another.';
    if (rewardNote) {
      info.innerText = info.innerText + ' ' + rewardNote;
      rewardNote = '';
    }
  } else {
    info.innerText = (godNow ? 'GOD PACK! ' : '') + 'Card ' + (topIndex + 1) + ' of ' + stackCards.length + ' - swipe it away';
  }
}

function buildStack(items) {
  let pack = document.getElementById('pack');
  packId = packId + 1;
  currentItems = items;
  pack.innerHTML = '';

  let packH = cardH;
  if (packRatio) {
    packH = Math.round(cardW * packRatio);
  }
  let boxH = Math.max(cardH, packH);

  pack.style.width = cardW + 'px';
  pack.style.height = (boxH + 30) + 'px';
  pack.style.setProperty('--cw', cardW + 'px');
  pack.style.setProperty('--ch', cardH + 'px');
  pack.classList.add('sealed');
  stackCards = [];
  topIndex = 0;
  for (let i = 0; i < items.length; i++) {
    let div = document.createElement('div');
    div.className = 'stackcard';
    div.style.width = cardW + 'px';
    div.style.height = cardH + 'px';
    div.style.marginTop = ((boxH - cardH) / 2) + 'px';
    let tag = '<div class="pricetag">\u2014</div>';
    if (items[i].cardId) {
      tag = '<div class="pricetag" data-price-id="' + esc(items[i].cardId) + '">' + esc(priceText(items[i].cardId)) + '</div>';
    }
    div.innerHTML = items[i].html + holoHtml(items[i].holo || items[i].rarity) + tag;
    pack.appendChild(div);
    stackCards.push(div);
  }

  if (packRatio) {
    let tearH = Math.round(packH * tearFraction);
    let picture = 'url(' + packImageUrl + ')';
    let size = cardW + 'px ' + packH + 'px';
    pack.insertAdjacentHTML('beforeend',
      '<div class="boosterpack imagepack" id="boosterpack" style="height:' + packH + 'px">' +
      '<div class="packtop" style="height:' + tearH + 'px; background:' + picture + ' 0 0 / ' + size + ' no-repeat;"></div>' +
      '<div class="packbody" style="top:' + tearH + 'px; height:' + (packH - tearH) + 'px; background:' + picture + ' 0 -' + tearH + 'px / ' + size + ' no-repeat;"></div>' +
      '</div>');
  } else {
    pack.insertAdjacentHTML('beforeend',
      '<div class="boosterpack" id="boosterpack">' +
      '<div class="packtop"></div>' +
      '<div class="packbody"><div class="packlabel">' + SETS[curSet].packLabel + '</div><div class="packsub">Booster Pack</div></div>' +
      '</div>');
  }

  packSealed = true;
  ripping = false;
  layoutStack();
  document.getElementById('info').innerText = 'Swipe across the top of the pack to rip it open (or just tap it).';
}

function ripPack() {
  if (!packSealed) {
    return;
  }
  packSealed = false;
  playRip();
  addToCollection(currentItems);
  let packLog = [];
  for (let i = 0; i < currentItems.length; i++) { packLog.push({ k: currentItems[i].key, r: currentItems[i].rarity }); }
  if (godNow) {
    logEvent('pack', { cards: packLog, god: true });
  } else {
    logEvent('pack', { cards: packLog });
  }
  checkRewards();

  let myId = packId;
  let pack = document.getElementById('pack');
  let sealedPack = document.getElementById('boosterpack');
  let top = sealedPack.querySelector('.packtop');
  let body = sealedPack.querySelector('.packbody');

  top.style.transition = 'transform 0.6s ease-out, opacity 0.6s';
  top.style.transform = 'translate(' + (ripDirection * cardW * 0.9) + 'px, -90px) rotate(' + (ripDirection * 35) + 'deg)';
  top.style.opacity = '0';

  setTimeout(function () {
    if (myId !== packId) {
      return;
    }
    body.style.transition = 'transform 0.6s ease-in, opacity 0.5s';
    body.style.transform = 'translateY(60px)';
    body.style.opacity = '0';
    pack.classList.remove('sealed');
  }, 250);

  setTimeout(function () {
    if (myId !== packId) {
      return;
    }
    sealedPack.remove();
    showProgress();
  }, 950);
}

function pickUnique(table, rarity, used) {
  let list = table[rarity];
  let url = pickFrom(list);
  for (let tries = 0; tries < 12 && used[url]; tries++) { url = pickFrom(list); }
  used[url] = true;
  return url;
}

// Builds the cards of one Ascended Heroes pack
function buildAscItems() {
  let energy = pickFrom(ascEnergies);
  let items = [{
    html: energyHtml(energy),
    rarity: 'Energy',
    key: 'energy-asc-' + energy.name,
    img: energy.image,
    name: energy.name,
    color: energy.color,
    cardId: null,
    holo: 'No foil'
  }];
  let used = {};
  let chance = ascSlots[5]['God pack %'];
  let hits = ascSlots[6];
  let god = chance > 0 && Math.random() * 100 < chance && pickRarity(hits, ascByRarity) !== null;
  if (god) {
    for (let i = 0; i < 9; i++) {
      let rarity = pickRarity(hits, ascByRarity);
      let url = pickUnique(ascByRarity, rarity, used);
      items.push({ html: cardImage(url), rarity: rarity, key: url, img: url, cardId: priceIdFromUrl(url) });
    }
    godNow = true;
    return items;
  }
  for (let d = 0; d < 5; d++) {
    let def = ascDefaultDefs[d];
    for (let k = 0; k < def.n; k++) {
      let rarity = pickRarity(ascSlots[d], ascByRarity);
      if (!rarity) { continue; }
      let url = pickUnique(ascByRarity, rarity, used);
      let rev = false;
      if (def.rev) { rev = true; }
      if (def.revUnless && def.revUnless.indexOf(rarity) === -1) { rev = true; }
      let item = { html: cardImage(url), rarity: rarity, key: url, img: url, cardId: priceIdFromUrl(url) };
      if (rev) {
        item.holo = 'Reverse holo';
      } else if (rarity === 'Common' || rarity === 'Uncommon') {
        item.holo = 'No foil';
      }
      items.push(item);
    }
  }
  godNow = false;
  return items;
}

function openPack() {
  getAudio();
  if (!setReady(curSet)) {
    document.getElementById('info').innerText = 'Still loading, try again in a second.';
    if (curSet === 'asc') { loadAsc(); }
    return;
  }
  if (packSealed) {
    document.getElementById('info').innerText = 'Rip the pack you already bought first!';
    return;
  }
  if (coins < packCost) {
    document.getElementById('info').innerText = 'Not enough coins. Sell spare cards or claim your daily reward.';
    return;
  }
  coins = coins - packCost;
  saveCoins();
  updateShop();
  let items = [];
  godNow = false;
  if (curSet === 'asc') {
    items = buildAscItems();
  } else {
    let energy = pickFrom(energies);
    items = [{
      html: energyHtml(energy),
      rarity: 'Energy',
      key: 'energy-' + energy.name,
      img: energy.image,
      name: energy.name,
      color: energy.color,
      cardId: null
    }];
    for (let i = 0; i < slots.length; i++) {
      let rarity = pickRarity(slots[i]);
      if (!rarity) { continue; }
      let url = pickFrom(byRarity[rarity]);
      items.push({ html: cardImage(url), rarity: rarity, key: url, img: url, cardId: priceIdFromUrl(url) });
    }
    let pikachu = pickFrom(byRarity['Pikachu Rare']);
    items.push({ html: cardImage(pikachu), rarity: 'Pikachu Rare', key: pikachu, img: pikachu, cardId: priceIdFromUrl(pikachu) });
  }
  buildStack(items);
  loadPackPrices(items);
  if (godNow) {
    playHit('Mega Hyper Rare');
    document.getElementById('info').innerText = 'GOD PACK! Every card in it is a hit. Swipe across the top to rip it open.';
  }
}

function updateGlare(e) {
  if (topIndex >= stackCards.length) {
    return;
  }
  let card = stackCards[topIndex];
  let holo = card.querySelector('.holo');
  if (!holo) {
    return;
  }
  let rect = card.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width * 100;
  let y = (e.clientY - rect.top) / rect.height * 100;
  x = Math.max(0, Math.min(100, x));
  y = Math.max(0, Math.min(100, y));
  holo.classList.remove('idle');
  holo.style.setProperty('--mx', x + '%');
  holo.style.setProperty('--my', y + '%');
  holo.style.setProperty('--bx', x + '%');
  holo.style.setProperty('--by', y + '%');
}

let dragging = false;
let startX = 0;
let startY = 0;

function endRip(e) {
  ripping = false;
  if (!packSealed) {
    return;
  }
  let dx = e.clientX - startX;
  let dy = e.clientY - startY;
  if (Math.sqrt(dx * dx + dy * dy) < 8) {
    ripPack();
    return;
  }
  let top = document.querySelector('#boosterpack .packtop');
  if (top) {
    top.style.transition = 'transform 0.25s';
    top.style.transform = '';
  }
}

function setupSwipe() {
  let pack = document.getElementById('pack');

  pack.addEventListener('dragstart', function (e) {
    e.preventDefault();
  });

  pack.addEventListener('pointerdown', function (e) {
    getAudio();
    if (packSealed) {
      ripping = true;
      startX = e.clientX;
      startY = e.clientY;
      pack.setPointerCapture(e.pointerId);
      return;
    }
    if (topIndex >= stackCards.length) {
      return;
    }
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    pack.setPointerCapture(e.pointerId);
    stackCards[topIndex].style.transition = 'none';
  });

  pack.addEventListener('pointermove', function (e) {
    if (ripping) {
      let rdx = e.clientX - startX;
      let top = document.querySelector('#boosterpack .packtop');
      if (top) {
        top.style.transition = 'none';
        top.style.transform = 'translate(' + (rdx * 0.4) + 'px, ' + (-Math.min(Math.abs(rdx), 60) * 0.3) + 'px) rotate(' + (rdx * 0.1) + 'deg)';
      }
      if (Math.abs(rdx) > cardW * 0.45) {
        ripping = false;
        ripDirection = rdx > 0 ? 1 : -1;
        ripPack();
      }
      return;
    }
    if (packSealed) {
      return;
    }
    updateGlare(e);
    if (!dragging) {
      return;
    }
    let dx = e.clientX - startX;
    let dy = e.clientY - startY;
    stackCards[topIndex].style.transform = 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + (dx * 0.06) + 'deg)';
  });

  pack.addEventListener('pointerleave', function () {
    let holos = pack.querySelectorAll('.holo');
    for (let i = 0; i < holos.length; i++) {
      holos[i].classList.add('idle');
    }
  });

  function endDrag(e) {
    if (ripping) {
      endRip(e);
      return;
    }
    if (!dragging) {
      return;
    }
    dragging = false;
    let dx = e.clientX - startX;
    let dy = e.clientY - startY;
    let distance = Math.sqrt(dx * dx + dy * dy);
    let card = stackCards[topIndex];
    if (distance > 90) {
      let flyX = dx / distance * 700;
      let flyY = dy / distance * 700;
      card.style.transition = 'transform 0.35s, opacity 0.35s';
      card.style.transform = 'translate(' + flyX + 'px, ' + flyY + 'px) rotate(' + (flyX * 0.08) + 'deg)';
      card.style.opacity = '0';
      topIndex++;
      layoutStack();
      showProgress();
      playSwipe();
      if (topIndex < currentItems.length) {
        let revealed = currentItems[topIndex].rarity;
        let myId = packId;
        setTimeout(function () {
          if (myId === packId) {
            playHit(revealed);
          }
        }, 180);
      }
    } else {
      card.style.transition = 'transform 0.25s';
      card.style.transform = 'translateY(0px) scale(1)';
    }
  }

  pack.addEventListener('pointerup', endDrag);
  // A cancelled touch (for example the page started scrolling) just puts everything back
  pack.addEventListener('pointercancel', function () {
    if (ripping) {
      ripping = false;
      let top = document.querySelector('#boosterpack .packtop');
      if (top) {
        top.style.transition = 'transform 0.25s';
        top.style.transform = '';
      }
    }
    if (dragging) {
      dragging = false;
      let card = stackCards[topIndex];
      if (card) {
        card.style.transition = 'transform 0.25s';
        card.style.transform = 'translateY(0px) scale(1)';
      }
    }
  });
}

async function getCard(padded) {
  let response = await fetch('https://api.tcgdex.net/v2/en/cards/30th-' + padded);
  return await response.json();
}

async function loadCards() {
  document.getElementById('info').innerText = 'Loading...';
  let requests = [];
  for (let n = 1; n <= 158; n++) {
    let padded = String(n).padStart(3, '0');
    requests.push(getCard(padded));
  }
  let allCards = await Promise.all(requests);
  for (let i = 0; i < allCards.length; i++) {
    let card = allCards[i];
    let padded = String(i + 1).padStart(3, '0');
    let url = 'https://assets.tcgdex.net/en/me/30th/' + padded + '/low.webp';
    if (!byRarity[card.rarity]) {
      byRarity[card.rarity] = [];
    }
    byRarity[card.rarity].push(url);
  }
  byRarity['Classic Collection'] = [];
  for (let n = 1; n <= 30; n++) {
    let padded = String(n).padStart(3, '0');
    byRarity['Classic Collection'].push('https://images.carddex.dev/cards/30ccc/30ccc-' + padded + '.webp');
  }
  byRarity['RGB Mew'] = [
    'https://images.carddex.dev/cards/30c/30c-R.webp',
    'https://images.carddex.dev/cards/30c/30c-G.webp',
    'https://images.carddex.dev/cards/30c/30c-B.webp'
  ];

  document.getElementById('info').innerText = 'Ready! Click Open Pack.';
  renderProgress(loadCollection());
  renderBinder();

  let allUrls = [];
  for (let rarity in byRarity) {
    for (let i = 0; i < byRarity[rarity].length; i++) {
      allUrls.push(byRarity[rarity][i]);
    }
  }
  preloadAll(allUrls);
  checkRewards();
  loadAsc();
}

// ---------- Ascended Heroes data ----------

// TCGdex gives prices in euros inside each card
function ascEur(card) {
  let p = card && card.pricing && card.pricing.cardmarket;
  if (!p) { return null; }
  let v = p.avg7;
  if (typeof v !== 'number') { v = p.trend; }
  if (typeof v !== 'number') { v = p.avg; }
  if (typeof v !== 'number') { return null; }
  return v;
}

async function getAscCard(padded) {
  try {
    let res = await fetch('https://api.tcgdex.net/v2/en/cards/me02.5-' + padded);
    if (!res.ok) { return null; }
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function loadAsc() {
  if (ascLoaded || ascLoading) { return; }
  ascLoading = true;
  let info = {};
  let stamp = Date.now();
  try {
    let cache = JSON.parse(localStorage.getItem(ascCacheKey));
    if (cache && cache.cards && Date.now() - cache.t < ascCacheMaxAge) {
      info = cache.cards;
      stamp = cache.t;
    }
  } catch (e) {}

  for (let pass = 0; pass < 3; pass++) {
    let missing = [];
    for (let n = 1; n <= ascCount; n++) {
      let padded = String(n).padStart(3, '0');
      if (!info[padded]) { missing.push(padded); }
    }
    if (missing.length === 0) { break; }
    if (curSet === 'asc') { document.getElementById('info').innerText = 'Loading Ascended Heroes... ' + (ascCount - missing.length) + '/' + ascCount; }
    for (let i = 0; i < missing.length; i += 40) {
      let batch = missing.slice(i, i + 40);
      let results = await Promise.all(batch.map(getAscCard));
      for (let j = 0; j < batch.length; j++) {
        let card = results[j];
        if (card && card.rarity) {
          info[batch[j]] = { r: normRarity(card.rarity), e: ascEur(card) };
        }
      }
    }
    stamp = Date.now();
  }

  let have = Object.keys(info).length;
  if (have === 0) {
    ascLoading = false;
    if (curSet === 'asc') { document.getElementById('info').innerText = 'Could not load Ascended Heroes. Check your connection and reload.'; }
    return;
  }
  if (have >= ascCount) {
    try { localStorage.setItem(ascCacheKey, JSON.stringify({ t: stamp, cards: info })); } catch (e) {}
  }

  ascByRarity = {};
  let urls = [];
  for (let n = 1; n <= ascCount; n++) {
    let padded = String(n).padStart(3, '0');
    let c = info[padded];
    if (!c) { continue; }
    let url = 'https://assets.tcgdex.net/en/me/me02.5/' + padded + '/low.webp';
    if (!ascByRarity[c.r]) { ascByRarity[c.r] = []; }
    ascByRarity[c.r].push(url);
    urls.push(url);
    if (typeof c.e === 'number') {
      let id = 'me02.5-' + padded;
      if (!priceCache[id] || stamp > priceCache[id].t) { priceCache[id] = { eur: c.e, t: stamp }; }
    }
  }
  savePriceCache();
  ascLoaded = true;
  ascLoading = false;
  if (curSet === 'asc') {
    document.getElementById('info').innerText = 'Ready! Click Open Pack.';
    preloadAll(urls);
  }
  renderCollection();
  checkRewards();
}

// ---------- Choosing a set ----------

function applySet() {
  let cfg = SETS[curSet];
  packCost = cfg.cost;
  packImageUrl = cfg.packImage;
  packRatio = null;
  loadPackImage();
  let sub = document.querySelector('.subtitle');
  if (sub) { sub.innerText = cfg.name; }
  let sel = document.getElementById('set-select');
  if (sel) { sel.value = curSet; }
  binderPage = 0;
  updateShop();
}

function changeSet(value) {
  if (!SETS[value] || value === curSet) { return; }
  curSet = value;
  try { localStorage.setItem(setStoreKey, curSet); } catch (e) {}
  applySet();
  if (curSet === 'asc' && !ascLoaded) {
    loadAsc();
  } else if (curSet === 'asc') {
    let urls = [];
    for (let r in ascByRarity) { urls = urls.concat(ascByRarity[r]); }
    preloadAll(urls);
  }
  if (!packSealed) {
    document.getElementById('info').innerText = setReady(curSet) ? 'Ready! Click Open Pack.' : 'Loading...';
  }
  renderCollection();
}

function loadSetChoice() {
  try {
    let saved = localStorage.getItem(setStoreKey);
    if (SETS[saved]) { curSet = saved; }
    let f = localStorage.getItem(collSetKey);
    if (f === '30th' || f === 'asc') { collSetFilter = f; }
  } catch (e) {}
  let fs = document.getElementById('coll-set');
  if (fs) { fs.value = collSetFilter; }
}


// ---------- Hidden dev panel ----------
// The password is never stored here, only a salted hash of it.
let shineSeed = 'e496f99a498caff9ed406d471267cc5a';
let shineKey = '54dc83c1347710061a7d23a83f5355a39e7cf1099a5224c5ad274e11f1268649';

let devClicks = 0;
let devClickTimer = null;
let devFails = 0;
let devLockUntil = 0;

function hexToBytes(hex) {
  let out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

async function checkPassword(text) {
  if (!window.crypto || !crypto.subtle) { return false; }
  let key = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  let bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(shineSeed), iterations: 200000, hash: 'SHA-256' },
    key, 256
  );
  return bytesToHex(bits) === shineKey;
}

let devSet = '30th';

function devSlotsFor(setId) { return setId === 'asc' ? ascSlots : slots; }
function devDefaultsFor(setId) { return setId === 'asc' ? ascDefaultSlots : defaultSlots; }

function saveRates() {
  try {
    localStorage.setItem('customRates', JSON.stringify(slots));
    localStorage.setItem('customRatesAsc', JSON.stringify(ascSlots));
  } catch (e) {}
}

function closeDev() {
  document.getElementById('dev-box').classList.remove('wide');
  document.getElementById('dev-overlay').style.display = 'none';
  document.getElementById('dev-box').innerHTML = '';
}

function showLogin() {
  let box = document.getElementById('dev-box');
  box.innerHTML =
    '<input class="dev-input" id="dev-pass" type="password" placeholder="Password" autocomplete="off">' +
    '<div class="dev-msg" id="dev-msg"></div>' +
    '<button class="dev-btn" id="dev-go">Enter</button> ' +
    '<button class="dev-btn dev-ghost" id="dev-cancel">Cancel</button>';
  document.getElementById('dev-overlay').style.display = 'flex';
  let input = document.getElementById('dev-pass');
  input.focus();
  async function submit() {
    let msg = document.getElementById('dev-msg');
    let now = Date.now();
    if (now < devLockUntil) {
      msg.textContent = 'Try again in ' + Math.ceil((devLockUntil - now) / 1000) + 's';
      return;
    }
    msg.textContent = 'Checking...';
    let ok = false;
    try { ok = await checkPassword(input.value); } catch (e) { ok = false; }
    if (ok) {
      devFails = 0;
      showDevPanel();
    } else {
      devFails++;
      input.value = '';
      if (devFails >= 5) {
        devFails = 0;
        devLockUntil = Date.now() + 30000;
        msg.textContent = 'Too many tries. Locked for 30s.';
      } else {
        msg.textContent = 'Wrong password.';
      }
    }
  }
  document.getElementById('dev-go').onclick = submit;
  input.onkeydown = function (e) { if (e.key === 'Enter') { submit(); } };
  document.getElementById('dev-cancel').onclick = closeDev;
}

function effectiveText(slotIndex, rarity) {
  let rates = devSlotsFor(devSet)[slotIndex];
  let table = tableFor(devSet);
  if (devSet === 'asc' && slotIndex === 5) { return ''; }
  let sum = 0;
  for (let r in rates) {
    if (rates[r] > 0 && table[r] && table[r].length > 0) { sum += rates[r]; }
  }
  if (sum <= 0 || !(rates[rarity] > 0) || !table[rarity] || table[rarity].length === 0) { return '0%'; }
  let pct = rates[rarity] / sum * 100;
  return (pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)) + '%';
}

function devTabs(active) {
  return '<div class="dev-tabs">' +
    '<button class="dev-tab' + (active === 'rates' ? ' on' : '') + '" id="dev-tab-rates">Pull rates</button>' +
    '<button class="dev-tab' + (active === 'players' ? ' on' : '') + '" id="dev-tab-players">Players</button></div>';
}

function wireDevTabs() {
  document.getElementById('dev-tab-rates').onclick = function () { showDevPanel(); };
  document.getElementById('dev-tab-players').onclick = function () { showPlayersTab(); };
}

function showPlayersTab() {
  let box = document.getElementById('dev-box');
  box.classList.add('wide');
  box.innerHTML = devTabs('players') + '<div id="admin-root"></div>' +
    '<div class="dev-btns"><button class="dev-btn dev-ghost" id="dev-close">Close</button></div>';
  document.getElementById('dev-overlay').style.display = 'flex';
  wireDevTabs();
  document.getElementById('dev-close').onclick = closeDev;
  if (window.renderAdmin) {
    window.renderAdmin(document.getElementById('admin-root'));
  } else {
    document.getElementById('admin-root').innerHTML = '<div class="dev-note">The admin tools did not load.</div>';
  }
}

function showDevPanel() {
  let box = document.getElementById('dev-box');
  box.classList.remove('wide');
  let list = devSlotsFor(devSet);
  let defaults = devDefaultsFor(devSet);
  let html = devTabs('rates') + '<h3>Pull rates</h3><div class="dev-note">Changes apply to the next pack and are saved in this browser only.</div>' +
    '<div class="dev-tabs"><button class="dev-tab' + (devSet === '30th' ? ' on' : '') + '" id="dev-set-30th">30th Celebration</button>' +
    '<button class="dev-tab' + (devSet === 'asc' ? ' on' : '') + '" id="dev-set-asc">Ascended Heroes</button></div>';
  for (let i = 0; i < list.length; i++) {
    let title = devSet === 'asc' ? ascDefaultDefs[i].name : 'Slot ' + (i + 1);
    html += '<div class="dev-slot"><div class="dev-slot-title">' + esc(title) + '</div>';
    for (let r in defaults[i]) {
      html += '<div class="dev-row">' +
        '<span class="dev-label">' + esc(r) + '</span>' +
        '<input class="dev-range" type="range" min="0" max="100" step="0.005" data-s="' + i + '" data-r="' + esc(r) + '" value="' + list[i][r] + '">' +
        '<input class="dev-num" type="number" min="0" max="100" step="any" data-s="' + i + '" data-r="' + esc(r) + '" value="' + list[i][r] + '">' +
        '<span class="dev-eff" data-s="' + i + '" data-r="' + esc(r) + '"></span></div>';
    }
    html += '</div>';
  }
  html += '<div class="dev-btns"><button class="dev-btn dev-ghost" id="dev-coins">+1000 coins</button> ' +
    '<button class="dev-btn" id="dev-reset">Reset to default</button> ' +
    '<button class="dev-btn dev-ghost" id="dev-close">Close</button></div>';
  box.innerHTML = html;
  document.getElementById('dev-overlay').style.display = 'flex';
  wireDevTabs();
  document.getElementById('dev-set-30th').onclick = function () { devSet = '30th'; showDevPanel(); };
  document.getElementById('dev-set-asc').onclick = function () { devSet = 'asc'; showDevPanel(); };

  function refreshLabels() {
    box.querySelectorAll('.dev-eff').forEach(function (el) {
      el.textContent = effectiveText(Number(el.dataset.s), el.dataset.r);
    });
  }
  function setValue(el, value) {
    let v = parseFloat(value);
    if (!(v >= 0)) { v = 0; }
    if (v > 100) { v = 100; }
    devSlotsFor(devSet)[Number(el.dataset.s)][el.dataset.r] = v;
    box.querySelectorAll('input[data-s="' + el.dataset.s + '"]').forEach(function (other) {
      if (other.dataset.r === el.dataset.r && other !== el) { other.value = v; }
    });
    saveRates();
    refreshLabels();
  }
  box.querySelectorAll('.dev-range').forEach(function (el) {
    el.oninput = function () { setValue(el, el.value); };
  });
  box.querySelectorAll('.dev-num').forEach(function (el) {
    el.oninput = function () { setValue(el, el.value); };
  });
  document.getElementById('dev-reset').onclick = function () {
    if (devSet === 'asc') {
      ascSlots = JSON.parse(JSON.stringify(ascDefaultSlots));
      try { localStorage.removeItem('customRatesAsc'); } catch (e) {}
    } else {
      slots = JSON.parse(JSON.stringify(defaultSlots));
      try { localStorage.removeItem('customRates'); } catch (e) {}
    }
    showDevPanel();
  };
  document.getElementById('dev-close').onclick = closeDev;
  document.getElementById('dev-coins').onclick = function () { addCoins(1000); };
  refreshLabels();
}

// Hidden trigger: click the subtitle 5 times within 2 seconds
function setupDevTrigger() {
  let el = document.querySelector('.subtitle');
  if (!el) { return; }
  el.addEventListener('click', function () {
    devClicks++;
    clearTimeout(devClickTimer);
    devClickTimer = setTimeout(function () { devClicks = 0; }, 2000);
    if (devClicks >= 5) {
      devClicks = 0;
      showLogin();
    }
  });
  document.getElementById('dev-overlay').addEventListener('click', function (e) {
    if (e.target.id === 'dev-overlay') { closeDev(); }
  });
}

setupDevTrigger();
loadCoins();
document.getElementById('coll-grid').addEventListener('click', function (e) {
  let btn = e.target.closest('[data-sell]');
  if (btn) { sellDuplicate(btn.dataset.sell); }
});
updateShop();
setInterval(updateShop, 30000);
loadView();
loadPriceCache();
loadSortMode();
loadSound();
setupSwipe();
loadSetChoice();
applySet();
renderCollection();
loadCards();

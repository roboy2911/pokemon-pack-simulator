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
  'RGB Mew': 3
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
let rarityOrder = ['RGB Mew', 'Futuristic Rare', 'Special illustration rare', 'Illustration rare', 'Classic Collection', 'Double rare', 'Rare', 'Pikachu Rare', 'Common', 'Energy'];
let storeKey = 'pokemonPackCollection';
let sortMode = 'price';
let sortStoreKey = 'pokemonPackSort';

// Only pictures from these sites are accepted when importing a backup
let allowedImageHosts = ['assets.tcgdex.net', 'images.carddex.dev', 'cardgamer.com'];

// Holo strength per rarity: 0 = none, 1 = maximum. 0.8 and above also get sparkles.
let holoLevels = {
  'Energy': 0.5,
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

function pickRarity(rates) {
  let usable = [];
  let sum = 0;
  for (let rarity in rates) {
    let w = rates[rarity];
    if (w > 0 && byRarity[rarity] && byRarity[rarity].length > 0) {
      usable.push(rarity);
      sum = sum + w;
    }
  }
  if (usable.length === 0) {
    // all weights zero: fall back to the default rates for this slot
    for (let rarity in rates) {
      if (byRarity[rarity] && byRarity[rarity].length > 0) { return rarity; }
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
  if (!byRarity['Common']) {
    box.innerHTML = '';
    return;
  }
  let owned = {};
  let keys = Object.keys(data.cards);
  for (let i = 0; i < keys.length; i++) {
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
    } else if (byRarity[r]) {
      total = byRarity[r].length;
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
    '<div class="progress-text">' + ownedAll + ' of ' + totalAll + ' cards collected (' + pct + '%)</div>' +
    '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="chips">' + chips + '</div>';
}

function renderCollection() {
  let data = loadCollection();
  let keys = Object.keys(data.cards);
  let grid = document.getElementById('coll-grid');
  let stats = document.getElementById('coll-stats');

  renderProgress(data);

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
    let rank = rarityOrder.indexOf(card.rarity);
    if (rank === -1) {
      rank = 99;
    }
    html = html + '<div class="coll-card" data-pid="' + esc(id || '') + '" data-rank="' + rank + '" data-key="' + esc(keys[i]) + '">' + inner + badge + price + '</div>';
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
    renderCollection();
  }
}

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
    info.innerText = 'Pack finished! ' + packValueText() + ' Click Open Pack for another.';
  } else {
    info.innerText = 'Card ' + (topIndex + 1) + ' of ' + stackCards.length + ' - swipe it away';
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
    div.innerHTML = items[i].html + holoHtml(items[i].rarity) + tag;
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
      '<div class="packbody"><div class="packlabel">30th<br>Celebration</div><div class="packsub">Booster Pack</div></div>' +
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

function openPack() {
  getAudio();
  if (!byRarity['Common']) {
    document.getElementById('info').innerText = 'Still loading, try again in a second.';
    return;
  }
  let energy = pickFrom(energies);
  let items = [{
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
  buildStack(items);
  loadPackPrices(items);
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
  pack.addEventListener('pointercancel', endDrag);
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

  let allUrls = [];
  for (let rarity in byRarity) {
    for (let i = 0; i < byRarity[rarity].length; i++) {
      allUrls.push(byRarity[rarity][i]);
    }
  }
  preloadAll(allUrls);
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

function saveRates() {
  try { localStorage.setItem('customRates', JSON.stringify(slots)); } catch (e) {}
}

function closeDev() {
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
  let rates = slots[slotIndex];
  let sum = 0;
  for (let r in rates) {
    if (rates[r] > 0 && byRarity[r] && byRarity[r].length > 0) { sum += rates[r]; }
  }
  if (sum <= 0 || !(rates[rarity] > 0) || !byRarity[rarity] || byRarity[rarity].length === 0) { return '0%'; }
  let pct = rates[rarity] / sum * 100;
  return (pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)) + '%';
}

function showDevPanel() {
  let box = document.getElementById('dev-box');
  let html = '<h3>Pull rates</h3><div class="dev-note">Changes apply to the next pack and are saved in this browser only.</div>';
  for (let i = 0; i < slots.length; i++) {
    html += '<div class="dev-slot"><div class="dev-slot-title">Slot ' + (i + 1) + '</div>';
    for (let r in defaultSlots[i]) {
      let max = Math.max(100, Math.ceil(defaultSlots[i][r]));
      html += '<div class="dev-row">' +
        '<span class="dev-label">' + esc(r) + '</span>' +
        '<input class="dev-range" type="range" min="0" max="100" step="0.005" data-s="' + i + '" data-r="' + esc(r) + '" value="' + slots[i][r] + '">' +
        '<input class="dev-num" type="number" min="0" max="100" step="any" data-s="' + i + '" data-r="' + esc(r) + '" value="' + slots[i][r] + '">' +
        '<span class="dev-eff" data-s="' + i + '" data-r="' + esc(r) + '"></span></div>';
    }
    html += '</div>';
  }
  html += '<div class="dev-btns"><button class="dev-btn" id="dev-reset">Reset to default</button> ' +
    '<button class="dev-btn dev-ghost" id="dev-close">Close</button></div>';
  box.innerHTML = html;
  document.getElementById('dev-overlay').style.display = 'flex';

  function refreshLabels() {
    box.querySelectorAll('.dev-eff').forEach(function (el) {
      el.textContent = effectiveText(Number(el.dataset.s), el.dataset.r);
    });
  }
  function setValue(el, value) {
    let v = parseFloat(value);
    if (!(v >= 0)) { v = 0; }
    if (v > 100) { v = 100; }
    slots[Number(el.dataset.s)][el.dataset.r] = v;
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
    slots = JSON.parse(JSON.stringify(defaultSlots));
    try { localStorage.removeItem('customRates'); } catch (e) {}
    showDevPanel();
  };
  document.getElementById('dev-close').onclick = closeDev;
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
loadPriceCache();
loadSortMode();
loadSound();
setupSwipe();
renderCollection();
loadPackImage();
loadCards();
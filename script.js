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

let stackCards = [];
let topIndex = 0;
let currentItems = [];

// Pack ripping state
let packSealed = false;
let ripping = false;
let ripDirection = 1;
let packId = 0;

// Collection: best cards first
let rarityOrder = ['RGB Mew', 'Futuristic Rare', 'Special illustration rare', 'Illustration rare', 'Classic Collection', 'Double rare', 'Rare', 'Pikachu Rare', 'Common', 'Energy'];
let storeKey = 'pokemonPackCollection';

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

let slots = [
  { 'Common': 100 },
  { 'Common': 100 },
  { 'Common': 70.3, 'Illustration rare': 19.7, 'Classic Collection': 10 },
  { 'Rare': 71.6, 'Double rare': 22.7, 'Special illustration rare': 4.88, 'Futuristic Rare': 0.83, 'RGB Mew': 0.025 }
];

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
  return '<img src="' + url + '" width="' + cardW + '" onload="fixSideways(this)" onerror="retryImage(this)">';
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
  return '<div style="width:' + w + 'px; height:' + h + 'px; background:' + energy.color + '; color:white; text-align:center; line-height:' + h + 'px; font-weight:bold; font-size:' + Math.round(22 * w / cardW) + 'px;">' + energy.name + ' Energy</div>';
}

function energyHtml(energy) {
  if (energy.image !== '') {
    return '<img src="' + energy.image + '" width="' + cardW + '" data-energy="' + energy.name + '" onload="fixSideways(this)" onerror="retryImage(this)">';
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
  let sum = 0;
  for (let rarity in rates) {
    sum = sum + rates[rarity];
  }
  let roll = Math.random() * sum;
  let total = 0;
  for (let rarity in rates) {
    total = total + rates[rarity];
    if (roll < total) {
      return rarity;
    }
  }
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

function renderCollection() {
  let data = loadCollection();
  let keys = Object.keys(data.cards);
  let grid = document.getElementById('coll-grid');
  let stats = document.getElementById('coll-stats');

  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    total = total + data.cards[keys[i]].count;
  }
  stats.innerText = keys.length + ' unique \u00b7 ' + total + ' total \u00b7 ' + data.packs + ' packs opened';

  if (keys.length === 0) {
    grid.innerHTML = '<div class="coll-empty">No cards yet. Rip a pack to start your collection!</div>';
    return;
  }

  keys.sort(function (a, b) {
    let ra = rarityOrder.indexOf(data.cards[a].rarity);
    let rb = rarityOrder.indexOf(data.cards[b].rarity);
    if (ra === -1) { ra = 99; }
    if (rb === -1) { rb = 99; }
    if (ra !== rb) {
      return ra - rb;
    }
    return a < b ? -1 : 1;
  });

  let html = '';
  for (let i = 0; i < keys.length; i++) {
    let card = data.cards[keys[i]];
    let inner = '';
    if (card.img) {
      let energyAttr = '';
      if (card.rarity === 'Energy') {
        energyAttr = ' data-energy="' + card.name + '"';
      }
      inner = '<img src="' + card.img + '" width="' + thumbW + '" data-w="' + thumbW + '" data-h="' + thumbH + '"' + energyAttr + ' onload="fixSideways(this)" onerror="retryImage(this)">';
    } else {
      inner = energyBox({ name: card.name, color: card.color }, thumbW, thumbH);
    }
    let badge = '';
    if (card.count > 1) {
      badge = '<div class="coll-badge">x' + card.count + '</div>';
    }
    html = html + '<div class="coll-card">' + inner + badge + '</div>';
  }
  grid.innerHTML = html;
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
    info.innerText = 'Pack finished! Click Open Pack for another.';
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
    div.innerHTML = items[i].html + holoHtml(items[i].rarity);
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
    color: energy.color
  }];
  for (let i = 0; i < slots.length; i++) {
    let rarity = pickRarity(slots[i]);
    let url = pickFrom(byRarity[rarity]);
    items.push({ html: cardImage(url), rarity: rarity, key: url, img: url });
  }
  let pikachu = pickFrom(byRarity['Pikachu Rare']);
  items.push({ html: cardImage(pikachu), rarity: 'Pikachu Rare', key: pikachu, img: pikachu });
  buildStack(items);
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

  let allUrls = [];
  for (let rarity in byRarity) {
    for (let i = 0; i < byRarity[rarity].length; i++) {
      allUrls.push(byRarity[rarity][i]);
    }
  }
  preloadAll(allUrls);
}

setupSwipe();
renderCollection();
loadPackImage();
loadCards();
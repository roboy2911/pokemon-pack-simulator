// Card inspection: tap a card in your collection to see it large, tilt it, and see its details. Classic script.

let inspKey = '';

function inspectClose() {
  let el = document.getElementById('insp-overlay');
  if (el) { el.style.display = 'none'; }
  document.body.style.overflow = '';
  inspKey = '';
}

function inspectCard(key) {
  let data = loadCollection();
  let card = data.cards[key];
  if (!card) { return; }
  inspKey = key;
  let el = document.getElementById('insp-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'insp-overlay';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.id === 'insp-overlay' || e.target.closest('[data-insp="close"]')) { inspectClose(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && inspKey) { inspectClose(); } });
  }
  let cfg = SETS[cardSet(key)];
  let id = card.rarity === 'Energy' ? null : priceIdFromUrl(card.img || key);
  let g = scoresOf(card, key);
  let nm = 0, lp = 0;
  for (let i = 0; i < g.length; i++) { if (g[i] >= condNM) { nm++; } else { lp++; } }
  let rows = '<div class="insp-row"><span>Set</span><b>' + esc(cfg ? cfg.name : '') + '</b></div>' +
    '<div class="insp-row"><span>Rarity</span><b>' + esc(card.rarity) + '</b></div>' +
    '<div class="insp-row"><span>Copies</span><b>' + card.count + '</b></div>';
  if (card.rarity !== 'Energy') {
    rows += '<div class="insp-row"><span>Condition</span><b>' + (nm ? nm + ' Near Mint' : '') + (nm && lp ? ', ' : '') + (lp ? lp + ' Lightly Played' : '') + '</b></div>';
  }
  if (id) { rows += '<div class="insp-row"><span>Market price</span><b>' + esc(priceText(id)) + '</b></div>'; }
  rows += '<div class="insp-row"><span>Quick-sell</span><b>' + sellValue(card.rarity, key) + ' coins</b></div>';
  let img = '';
  if (card.img) {
    img = '<img src="' + esc(card.img) + '" alt="" draggable="false">';
  } else {
    let safe = /^#[0-9a-fA-F]{3,8}$/.test(card.color) ? card.color : '#888888';
    img = energyBox({ name: card.name, color: safe }, 300, 418);
  }
  el.innerHTML = '<div class="insp-box"><button class="insp-x" data-insp="close" aria-label="Close">&times;</button>' +
    '<div class="insp-stage"><div class="insp-card" id="insp-card">' + img + '<div class="insp-shine"></div></div></div>' +
    '<div class="insp-info">' + rows + '</div><div class="insp-hint">Move over the card to tilt it. Tap outside to close.</div></div>';
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  let stage = el.querySelector('.insp-stage');
  let cardEl = document.getElementById('insp-card');
  let move = function (e) {
    let r = cardEl.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width;
    let y = (e.clientY - r.top) / r.height;
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    cardEl.style.transform = 'rotateY(' + ((x - 0.5) * 28) + 'deg) rotateX(' + ((0.5 - y) * 28) + 'deg)';
    cardEl.style.setProperty('--sx', (x * 100) + '%');
    cardEl.style.setProperty('--sy', (y * 100) + '%');
  };
  let reset = function () { cardEl.style.transform = ''; };
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerleave', reset);
  stage.addEventListener('pointerup', function (e) { if (e.pointerType === 'touch') { reset(); } });
}

// Tap a card picture in the collection grid
(function () {
  let grid = document.getElementById('coll-grid');
  if (!grid) { return; }
  grid.addEventListener('click', function (e) {
    let img = e.target.closest('.coll-card img');
    if (!img) { return; }
    let cardEl = img.closest('.coll-card');
    if (cardEl && cardEl.dataset.key) { inspectCard(cardEl.dataset.key); }
  });
})();

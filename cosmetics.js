// Shop (coin sinks) and appearance settings. Classic script, loaded after script.js.
// Cosmetics are only for looks: binder colours, profile titles and profile frames.
// What you own and what you wear is kept in the "settled" map, so it is saved online with the rest of the save.

let themeKey = 'pokemonPackTheme';

let cosItems = {
  binder: [
    { id: 'navy', name: 'Navy', price: 0, bg: '#2f3a4f', page: '#243044' },
    { id: 'red', name: 'Crimson', price: 300, bg: '#5a2a30', page: '#431f24' },
    { id: 'green', name: 'Forest', price: 300, bg: '#2f4a3a', page: '#233a2c' },
    { id: 'purple', name: 'Royal', price: 300, bg: '#46335e', page: '#35264a' },
    { id: 'black', name: 'Midnight', price: 500, bg: '#1d1d22', page: '#131316' },
    { id: 'gold', name: 'Gold', price: 1000, bg: '#7a6220', page: '#5c4a16' }
  ],
  title: [
    { id: 'none', name: 'No title', price: 0, text: '' },
    { id: 'collector', name: 'Collector', price: 500, text: 'Collector' },
    { id: 'trader', name: 'Trader', price: 500, text: 'Trader' },
    { id: 'packrat', name: 'Pack Rat', price: 500, text: 'Pack Rat' },
    { id: 'sniper', name: 'Auction Sniper', price: 1500, text: 'Auction Sniper' },
    { id: 'legend', name: 'Legend', price: 5000, text: 'Legend' }
  ],
  frame: [
    { id: 'none', name: 'No frame', price: 0, color: '' },
    { id: 'bronze', name: 'Bronze', price: 300, color: '#b87333' },
    { id: 'silver', name: 'Silver', price: 600, color: '#b8c0cc' },
    { id: 'gold', name: 'Gold', price: 1500, color: '#e8b923' },
    { id: 'rainbow', name: 'Rainbow', price: 5000, color: 'rainbow' }
  ]
};
let cosKinds = [['binder', 'Binder colours'], ['title', 'Profile titles'], ['frame', 'Profile frames']];

function cosItem(kind, id) {
  let list = cosItems[kind] || [];
  for (let i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
  return null;
}

function cosOwns(kind, id) {
  let it = cosItem(kind, id);
  if (!it) { return false; }
  return it.price === 0 || !!settled['cos:own:' + kind + ':' + id];
}

function cosEquipped(kind) {
  let id = settled['cos:eq:' + kind];
  if (typeof id === 'string' && cosOwns(kind, id)) { return id; }
  return kind === 'binder' ? 'navy' : 'none';
}

// What other players see on your profile (saved with your leaderboard stats)
function cosPublic() {
  return { title: cosEquipped('title'), frame: cosEquipped('frame') };
}

function cosApply() {
  let root = document.documentElement;
  let b = cosItem('binder', cosEquipped('binder'));
  if (b) {
    root.style.setProperty('--binder-bg', b.bg);
    root.style.setProperty('--binder-page', b.page);
  }
}

function applyTheme() {
  let dark = false;
  try { dark = localStorage.getItem(themeKey) === 'dark'; } catch (e) {}
  document.documentElement.classList.toggle('dark', dark);
}

function setTheme(name) {
  try { localStorage.setItem(themeKey, name === 'dark' ? 'dark' : 'light'); } catch (e) {}
  applyTheme();
  renderShop();
}

function cosBuy(kind, id) {
  let it = cosItem(kind, id);
  if (!it || cosOwns(kind, id)) { return; }
  if (coins < it.price) { toast('Not enough coins (' + it.price.toLocaleString() + ' needed).'); return; }
  if (!confirm('Buy ' + it.name + ' for ' + it.price.toLocaleString() + ' coins?')) { return; }
  coins = coins - it.price;
  settled['cos:own:' + kind + ':' + id] = true;
  settled['cos:eq:' + kind] = id;
  saveSettled();
  saveCoins();
  updateShop();
  logEvent('shop', { kind: kind, id: id, coins: it.price });
  cosApply();
  renderShop();
  toast('Bought and equipped: ' + it.name + '.');
}

function cosEquip(kind, id) {
  if (!cosOwns(kind, id)) { return; }
  settled['cos:eq:' + kind] = id;
  saveSettled();
  if (typeof cloudChanged === 'function') { cloudChanged(); }
  cosApply();
  renderShop();
}

function swatch(kind, it) {
  if (kind === 'binder') { return '<span class="shop-sw" style="background:' + it.bg + '"></span>'; }
  if (kind === 'frame') {
    if (it.color === 'rainbow') { return '<span class="shop-sw shop-rainbow"></span>'; }
    return '<span class="shop-sw" style="background:#fff; border:3px solid ' + (it.color || '#ccc') + '"></span>';
  }
  return '<span class="shop-sw shop-title">' + esc(it.text || 'Aa') + '</span>';
}

function renderShop() {
  let root = document.getElementById('shop-root');
  if (!root) { return; }
  let dark = document.documentElement.classList.contains('dark');
  let html = '<div class="tcard"><h3>Appearance</h3><div class="adm-edit">' +
    '<button class="dev-btn' + (dark ? ' dev-ghost' : '') + '" data-shop="theme" data-v="light">Light</button> ' +
    '<button class="dev-btn' + (dark ? '' : ' dev-ghost') + '" data-shop="theme" data-v="dark">Dark</button> ' +
    '<button class="dev-btn' + (fxOn ? '' : ' dev-ghost') + '" data-shop="fx">Pull effects: ' + (fxOn ? 'on' : 'off') + '</button></div>' +
    '<div class="tlabel">Pull effects are the sparkles and confetti when you reveal a rare card.</div></div>' +
    '<div class="tcard"><h3>Coin shop</h3><div class="tlabel">Spend coins on looks. Titles and frames show on your profile. You have <b>' + coins.toLocaleString() + '</b> coins.</div></div>';
  for (let k = 0; k < cosKinds.length; k++) {
    let kind = cosKinds[k][0];
    let items = '';
    for (let i = 0; i < cosItems[kind].length; i++) {
      let it = cosItems[kind][i];
      let owned = cosOwns(kind, it.id);
      let on = cosEquipped(kind) === it.id;
      let action = on ? '<span class="q-done">Equipped</span>'
        : (owned ? '<button class="daily-btn" data-shop="equip" data-kind="' + kind + '" data-id="' + it.id + '">Equip</button>'
          : '<button class="daily-btn" data-shop="buy" data-kind="' + kind + '" data-id="' + it.id + '">' + it.price.toLocaleString() + ' coins</button>');
      items += '<div class="shop-item">' + swatch(kind, it) + '<div class="shop-name">' + esc(it.name) + '</div>' + action + '</div>';
    }
    html += '<div class="tcard"><h3>' + cosKinds[k][1] + '</h3><div class="shop-grid">' + items + '</div></div>';
  }
  root.innerHTML = html;
}

(function () {
  let root = document.getElementById('shop-root');
  if (root) {
    root.addEventListener('click', function (e) {
      let el = e.target.closest('[data-shop]');
      if (!el) { return; }
      let act = el.dataset.shop;
      if (act === 'theme') { setTheme(el.dataset.v); }
      else if (act === 'fx') { setFx(!fxOn); renderShop(); }
      else if (act === 'buy') { cosBuy(el.dataset.kind, el.dataset.id); }
      else if (act === 'equip') { cosEquip(el.dataset.kind, el.dataset.id); }
    });
  }
  window.renderShop = renderShop;
  window.addEventListener('cloud-ready', function () { cosApply(); renderShop(); });
  window.addEventListener('cloud-out', function () { cosApply(); renderShop(); });
  applyTheme();
  cosApply();
  renderShop();
})();

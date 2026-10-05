// Custom binders: players make their own named binders and choose which cards go where.
// A binder is only a display. The cards stay in your collection and can still be sold or traded.
// Classic script, loaded after script.js (uses its globals).

let bindersKey = 'pokemonPackBinders';
let MB_MAX_BINDERS = 8;
let MB_MAX_PAGES = 20;
let MB_PER_PAGE = 9;

let mbPage = 0;
let mbSlot = null;        // selected slot index on the current page
let mbSet = 'all';        // picker filter
let mbRarity = 'All';
let mbMsg = '';
let binderPaneName = 'my';

// ----- Saving and loading -----

function newBinderPage() {
  let p = [];
  for (let i = 0; i < MB_PER_PAGE; i++) { p.push(null); }
  return p;
}

// Anything from storage or the cloud is cleaned before use
function cleanBinders(raw) {
  let out = { list: [], sel: '' };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) { return out; }
  for (let i = 0; i < raw.list.length && out.list.length < MB_MAX_BINDERS; i++) {
    let b = raw.list[i];
    if (!b || typeof b !== 'object' || !Array.isArray(b.pages)) { continue; }
    let id = typeof b.id === 'string' ? b.id.replace(/[^a-z0-9]/gi, '').slice(0, 20) : '';
    if (!id) { continue; }
    let name = typeof b.name === 'string' ? b.name.replace(/[<>]/g, '').trim().slice(0, 24) : '';
    let pages = [];
    for (let p = 0; p < b.pages.length && pages.length < MB_MAX_PAGES; p++) {
      let src = Array.isArray(b.pages[p]) ? b.pages[p] : [];
      let page = [];
      for (let s = 0; s < MB_PER_PAGE; s++) {
        let k = src[s];
        page.push(typeof k === 'string' && k.length > 0 && k.length <= 300 ? k : null);
      }
      pages.push(page);
    }
    if (!pages.length) { pages.push(newBinderPage()); }
    out.list.push({ id: id, name: name || 'Binder', pages: pages });
  }
  if (typeof raw.sel === 'string') {
    for (let i = 0; i < out.list.length; i++) { if (out.list[i].id === raw.sel) { out.sel = raw.sel; } }
  }
  if (!out.sel && out.list.length) { out.sel = out.list[0].id; }
  if (typeof raw.showcase === 'string') {
    for (let i = 0; i < out.list.length; i++) { if (out.list[i].id === raw.showcase) { out.showcase = raw.showcase; } }
  }
  return out;
}

function loadBinders() {
  try {
    let saved = localStorage.getItem(bindersKey);
    if (saved) { return cleanBinders(JSON.parse(saved)); }
  } catch (e) {}
  return { list: [], sel: '' };
}

function saveBinders(b) {
  try { localStorage.setItem(bindersKey, JSON.stringify(b)); } catch (e) {}
  if (typeof cloudChanged === 'function') { cloudChanged(); }
}

function currentBinder(b) {
  for (let i = 0; i < b.list.length; i++) { if (b.list[i].id === b.sel) { return b.list[i]; } }
  return b.list[0] || null;
}

function usedCount(binder, key) {
  let n = 0;
  for (let p = 0; p < binder.pages.length; p++) {
    for (let s = 0; s < binder.pages[p].length; s++) { if (binder.pages[p][s] === key) { n++; } }
  }
  return n;
}

// ----- Switching between My binders and Set binders -----

function binderPane(name) {
  binderPaneName = name === 'set' ? 'set' : 'my';
  let my = document.getElementById('mybinder-pane');
  let set = document.getElementById('setbinder-pane');
  if (my) { my.style.display = binderPaneName === 'my' ? '' : 'none'; }
  if (set) { set.style.display = binderPaneName === 'set' ? '' : 'none'; }
  let a = document.getElementById('bsw-my');
  let c = document.getElementById('bsw-set');
  if (a) { a.classList.toggle('active', binderPaneName === 'my'); }
  if (c) { c.classList.toggle('active', binderPaneName === 'set'); }
  if (binderPaneName === 'my') { renderMyBinders(); } else if (typeof renderBinder === 'function') { renderBinder(); }
}

// ----- Drawing -----

function mbPickerHtml(binder, cards) {
  let keys = Object.keys(cards).filter(function (k) {
    if (mbSet !== 'all' && cardSet(k) !== mbSet) { return false; }
    if (mbRarity !== 'All' && cards[k].rarity !== mbRarity) { return false; }
    return true;
  });
  keys.sort(function (a, b) {
    let ra = rarityOrder.indexOf(cards[a].rarity); if (ra === -1) { ra = 99; }
    let rb = rarityOrder.indexOf(cards[b].rarity); if (rb === -1) { rb = 99; }
    return ra - rb || (a < b ? -1 : 1);
  });
  if (!keys.length) { return '<div class="tempty">No cards match.</div>'; }
  let html = '';
  for (let i = 0; i < keys.length && i < 400; i++) {
    let k = keys[i];
    let shown = Object.assign({}, cards[k], { count: 1 });
    html += '<div class="tpick" draggable="true" data-mb="pick" data-key="' + esc(k) + '">' +
      binderSlotHtml({ label: '' }, shown, 64, 88) +
      '<div class="tcount">' + usedCount(binder, k) + '/' + cards[k].count + '</div></div>';
  }
  return '<div class="tpicker mb-picker" id="mb-picker">' + html + '</div>' +
    (keys.length > 400 ? '<div class="tempty">Showing the first 400. Use the filters to narrow it down.</div>' : '');
}

function renderMyBinders() {
  let root = document.getElementById('mybinder-pane');
  if (!root) { return; }
  let b = loadBinders();
  let binder = currentBinder(b);
  let keepPicker = document.getElementById('mb-picker');
  let keepScroll = keepPicker ? keepPicker.scrollTop : 0;

  let opts = '';
  for (let i = 0; i < b.list.length; i++) {
    opts += '<option value="' + esc(b.list[i].id) + '"' + (binder && b.list[i].id === binder.id ? ' selected' : '') + '>' + esc(b.list[i].name) + '</option>';
  }
  let top = '<div class="mb-bar">' +
    (b.list.length ? '<select class="sort-select" id="mb-select" data-mb="select">' + opts + '</select> ' : '') +
    '<button class="link-btn" data-mb="new">+ New binder</button>' +
    (binder ? ' <button class="link-btn" data-mb="rename">Rename</button> <button class="link-btn" data-mb="delete">Delete</button> <button class="link-btn" data-mb="showcase">' + (b.showcase === binder.id ? 'Shown on your profile \u2713' : 'Show on my profile') + '</button>' : '') +
    '</div>';

  if (!binder) {
    root.innerHTML = top + '<div class="tcard"><h3>Your binders</h3><div class="tempty">You have no binders yet. Make one, then choose which cards go in it. The cards stay in your collection.</div></div>';
    return;
  }

  if (mbPage >= binder.pages.length) { mbPage = binder.pages.length - 1; }
  if (mbPage < 0) { mbPage = 0; }
  let page = binder.pages[mbPage];
  let cards = loadCollection().cards;

  let w = window.innerWidth < 500 ? 96 : 130;
  let h = Math.round(w * 151 / 110);
  let filled = 0;
  let grid = '';
  for (let i = 0; i < MB_PER_PAGE; i++) {
    let key = page[i];
    let card = key ? cards[key] : null;
    let sel = mbSlot === i ? ' sel' : '';
    if (card) {
      filled++;
      let shown = Object.assign({}, card, { count: 1 });
      grid += '<div class="mb-slot' + sel + '" draggable="true" data-mb="slot" data-i="' + i + '">' + binderSlotHtml({ label: '' }, shown, w, h) + '</div>';
    } else {
      grid += '<div class="mb-slot' + sel + '" data-mb="slot" data-i="' + i + '">' + binderSlotHtml({ label: key ? 'Missing' : '+' }, null, w, h) + '</div>';
    }
  }

  let pageOpts = '';
  for (let i = 0; i < binder.pages.length; i++) { pageOpts += '<option value="' + i + '"' + (i === mbPage ? ' selected' : '') + '>Page ' + (i + 1) + '</option>'; }

  let setOpts = [['all', 'All sets'], ['30th', '30th Celebration'], ['asc', 'Ascended Heroes'], ['tu', 'Team Up']].map(function (o) {
    return '<option value="' + o[0] + '"' + (mbSet === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  let rarOpts = '<option>All</option>' + rarityOrder.map(function (r) {
    return '<option' + (mbRarity === r ? ' selected' : '') + '>' + esc(r) + '</option>';
  }).join('');

  let selKey = mbSlot !== null ? page[mbSlot] : null;
  let hint = mbSlot === null ? 'Tap a slot, then tap a card below. Or drag a card onto a slot. Tapping a card with no slot selected fills the next empty slot.'
    : 'Slot ' + (mbSlot + 1) + ' selected.' + (selKey ? ' ' : ' Now tap a card below.');

  root.innerHTML = top +
    '<div class="binder"><div class="binder-head"><div id="mb-title">' + esc(binder.name) + '</div>' +
    '<div id="binder-count">' + filled + ' of ' + MB_PER_PAGE + ' filled on this page</div></div>' +
    '<div id="mb-page">' + grid + '</div>' +
    '<div class="binder-nav"><button class="daily-btn" data-mb="prev"' + (mbPage === 0 ? ' disabled' : '') + '>&lsaquo; Prev</button>' +
    '<select class="sort-select" id="mb-pagesel" data-mb="pagesel">' + pageOpts + '</select>' +
    '<button class="daily-btn" data-mb="next"' + (mbPage >= binder.pages.length - 1 ? ' disabled' : '') + '>Next &rsaquo;</button></div>' +
    '<div class="binder-nav">' +
    (binder.pages.length < MB_MAX_PAGES ? '<button class="link-btn mb-light" data-mb="addpage">+ Add page</button>' : '') +
    (binder.pages.length > 1 ? '<button class="link-btn mb-light" data-mb="delpage">Delete this page</button>' : '') +
    (selKey ? '<button class="link-btn mb-light" data-mb="clear">Remove card from slot</button>' : '') +
    '</div></div>' +
    '<div class="tcard mb-pick-card"><h3>Your cards</h3><div class="tlabel">' + esc(hint) + '</div>' +
    '<div class="adm-edit"><select class="tinput" data-mb="setfilter">' + setOpts + '</select> <select class="tinput" data-mb="rarfilter">' + rarOpts + '</select></div>' +
    '<div class="tmsg" id="mb-msg">' + esc(mbMsg) + '</div>' +
    '<div id="mb-pickwrap">' + mbPickerHtml(binder, cards) + '</div></div>';

  let np = document.getElementById('mb-picker');
  if (np) { np.scrollTop = keepScroll; }
}

// ----- Actions -----

function mbSetMsg(text) {
  mbMsg = text;
  let el = document.getElementById('mb-msg');
  if (el) { el.textContent = text; }
}

function mbUpdate(fn) {
  let b = loadBinders();
  let binder = currentBinder(b);
  if (!binder) { return; }
  fn(b, binder);
  saveBinders(b);
  renderMyBinders();
}

function mbPlace(slotIndex, key) {
  let cards = loadCollection().cards;
  if (!cards[key]) { return; }
  mbMsg = '';
  mbUpdate(function (b, binder) {
    let page = binder.pages[mbPage];
    if (page[slotIndex] === key) { return; }
    if (usedCount(binder, key) >= cards[key].count) {
      mbMsg = 'You only own ' + cards[key].count + ' of that card, so it can only be in your binder ' + cards[key].count + ' time' + (cards[key].count === 1 ? '' : 's') + '.';
      return;
    }
    page[slotIndex] = key;
    mbSlot = null;
    if (typeof questEvent === 'function') { questEvent('binder'); }
  });
}

function mbNew() {
  let b = loadBinders();
  if (b.list.length >= MB_MAX_BINDERS) { mbSetMsg('You can have up to ' + MB_MAX_BINDERS + ' binders.'); alert('You can have up to ' + MB_MAX_BINDERS + ' binders.'); return; }
  let name = prompt('Name your new binder (up to 24 letters):', 'My binder');
  if (name === null) { return; }
  name = name.replace(/[<>]/g, '').trim().slice(0, 24) || 'My binder';
  let id = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  b.list.push({ id: id, name: name, pages: [newBinderPage()] });
  b.sel = id;
  mbPage = 0;
  mbSlot = null;
  saveBinders(b);
  renderMyBinders();
}

function mbRename() {
  mbUpdate(function (b, binder) {
    let name = prompt('Rename this binder (up to 24 letters):', binder.name);
    if (name === null) { return; }
    name = name.replace(/[<>]/g, '').trim().slice(0, 24);
    if (name) { binder.name = name; }
  });
}

function mbDelete() {
  let b = loadBinders();
  let binder = currentBinder(b);
  if (!binder) { return; }
  if (!confirm('Delete the binder "' + binder.name + '"? Your cards are not deleted, only the binder layout.')) { return; }
  b.list = b.list.filter(function (x) { return x.id !== binder.id; });
  b.sel = b.list.length ? b.list[0].id : '';
  mbPage = 0;
  mbSlot = null;
  saveBinders(b);
  renderMyBinders();
}

function mbHandleClick(el) {
  let act = el.dataset.mb;
  if (act === 'new') { mbNew(); }
  else if (act === 'rename') { mbRename(); }
  else if (act === 'delete') { mbDelete(); }
  else if (act === 'showcase') {
    mbUpdate(function (b, binder) { b.showcase = b.showcase === binder.id ? '' : binder.id; });
  }
  else if (act === 'slot') {
    let i = Number(el.dataset.i);
    mbSlot = mbSlot === i ? null : i;
    mbMsg = '';
    renderMyBinders();
  }
  else if (act === 'pick') {
    let b = loadBinders();
    let binder = currentBinder(b);
    if (!binder) { return; }
    let slot = mbSlot;
    if (slot === null) {
      let page = binder.pages[mbPage];
      for (let i = 0; i < page.length; i++) { if (!page[i]) { slot = i; break; } }
      if (slot === null) { mbSetMsg('This page is full. Pick a slot to replace, or add a page.'); return; }
    }
    mbPlace(slot, el.dataset.key);
  }
  else if (act === 'prev') { mbPage = Math.max(0, mbPage - 1); mbSlot = null; if (typeof playSwipe === 'function') { playSwipe(); } renderMyBinders(); }
  else if (act === 'next') { mbPage = mbPage + 1; mbSlot = null; if (typeof playSwipe === 'function') { playSwipe(); } renderMyBinders(); }
  else if (act === 'addpage') {
    mbUpdate(function (b, binder) {
      if (binder.pages.length < MB_MAX_PAGES) { binder.pages.push(newBinderPage()); mbPage = binder.pages.length - 1; mbSlot = null; }
    });
  }
  else if (act === 'delpage') {
    mbUpdate(function (b, binder) {
      if (binder.pages.length < 2) { return; }
      if (binder.pages[mbPage].some(function (k) { return k; }) && !confirm('Delete this page? The cards stay in your collection.')) { return; }
      binder.pages.splice(mbPage, 1);
      mbPage = Math.min(mbPage, binder.pages.length - 1);
      mbSlot = null;
    });
  }
  else if (act === 'clear') {
    if (mbSlot === null) { return; }
    mbUpdate(function (b, binder) { binder.pages[mbPage][mbSlot] = null; });
  }
}

function mbHandleChange(el) {
  let act = el.dataset.mb;
  if (act === 'select') {
    let b = loadBinders();
    b.sel = el.value;
    mbPage = 0;
    mbSlot = null;
    saveBinders(b);
    renderMyBinders();
  }
  else if (act === 'pagesel') { mbPage = Number(el.value) || 0; mbSlot = null; renderMyBinders(); }
  else if (act === 'setfilter') { mbSet = el.value; renderMyBinders(); }
  else if (act === 'rarfilter') { mbRarity = el.value; renderMyBinders(); }
}

// ----- Drag and drop (desktop) -----

let mbDrag = null;

function mbBind() {
  let root = document.getElementById('mybinder-pane');
  if (!root || root.dataset.bound) { return; }
  root.dataset.bound = '1';
  root.addEventListener('click', function (e) {
    let el = e.target.closest('[data-mb]');
    if (!el || el.tagName === 'SELECT') { return; }
    mbHandleClick(el);
  });
  root.addEventListener('change', function (e) {
    let el = e.target.closest('select[data-mb]');
    if (el) { mbHandleChange(el); }
  });
  root.addEventListener('dragstart', function (e) {
    let el = e.target.closest('[data-mb="pick"], [data-mb="slot"]');
    if (!el) { return; }
    mbDrag = el.dataset.mb === 'pick' ? { type: 'card', key: el.dataset.key } : { type: 'slot', i: Number(el.dataset.i) };
    try { e.dataTransfer.setData('text/plain', 'binder'); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
  });
  root.addEventListener('dragover', function (e) {
    if (mbDrag && e.target.closest('[data-mb="slot"], #mb-pickwrap')) { e.preventDefault(); }
  });
  root.addEventListener('drop', function (e) {
    if (!mbDrag) { return; }
    let slotEl = e.target.closest('[data-mb="slot"]');
    let drag = mbDrag;
    mbDrag = null;
    if (slotEl) {
      e.preventDefault();
      let to = Number(slotEl.dataset.i);
      if (drag.type === 'card') {
        mbPlace(to, drag.key);
      } else if (drag.i !== to) {
        mbUpdate(function (b, binder) {
          let page = binder.pages[mbPage];
          let tmp = page[to];
          page[to] = page[drag.i];
          page[drag.i] = tmp;
        });
      }
    } else if (e.target.closest('#mb-pickwrap') && drag.type === 'slot') {
      // dropping a placed card back onto the card list removes it from the binder
      e.preventDefault();
      mbUpdate(function (b, binder) { binder.pages[mbPage][drag.i] = null; });
    }
  });
  root.addEventListener('dragend', function () { mbDrag = null; });
}

mbBind();
binderPane('my');

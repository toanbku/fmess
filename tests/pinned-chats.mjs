// Pinned chats: live merge of server-synced mobile pins (threadTags bit 14)
// with local desktop overrides, native MWThreadList.react slot wiring,
// list-view scoping, and reused context-menu validation.
// `node tests/pinned-chats.mjs`
import { readdirSync, readFileSync } from 'node:fs';

const injectDir = new URL('../src-tauri/src/inject/', import.meta.url);
const script = readdirSync(injectDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => readFileSync(new URL(name, injectDir), 'utf8').replace(/\r\n/g, '\n'))
  .join('');

// Extract just 17-pinned-chats.js for focused unit testing with minimal mocks.
const pinnedPart = readFileSync(new URL('../src-tauri/src/inject/17-pinned-chats.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function harness({ settings = {}, userId = '10001', pathname = '/messages/', lang = 'en' } = {}) {
  const invokes = [];
  const errors = [];
  const docListeners = new Map();
  const winListeners = new Map();
  let currentPath = pathname;
  let currentUid = userId;
  let currentLang = lang;
  const bodyChildren = [];
  const rootChildren = [];

  class FakeElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.attrs = new Map();
      this.dataset = {};
      this.style = {};
      this.children = [];
      this.parentElement = null;
      this.className = '';
      this._text = '';
      this.listeners = new Map();
    }
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
    }
    set textContent(v) {
      this._text = String(v ?? '');
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'id') this.id = String(v);
    }
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    hasAttribute(k) {
      return this.attrs.has(k);
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n instanceof FakeFragment) {
          this.append(...n.children);
          continue;
        }
        n.parentElement = this;
        this.children.push(n);
      }
    }
    insertBefore(node, ref) {
      const list = node instanceof FakeFragment ? node.children : [node];
      const idx = ref ? this.children.indexOf(ref) : -1;
      for (const n of list) n.parentElement = this;
      if (idx >= 0) this.children.splice(idx, 0, ...list);
      else this.children.unshift(...list);
    }
    remove() {
      if (!this.parentElement) return;
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    click() {
      const ev = { preventDefault() {}, stopPropagation() {} };
      for (const fn of this.listeners.get('click') ?? []) fn(ev);
    }
    closest(sel) {
      if (sel === '[role="main"]') return null;
      if (sel === '[data-fmess-thread-id]') return this.hasAttribute('data-fmess-thread-id') ? this : null;
      return null;
    }
    getBoundingClientRect() {
      return { width: 240, height: 180, left: 0, top: 0 };
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (matches(child, sel)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] ?? null;
    }
  }
  class FakeFragment {
    constructor() {
      this.children = [];
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
  }
  function matches(el, sel) {
    if (sel === '[role="menuitem"]') return el.getAttribute('role') === 'menuitem';
    if (sel === '[data-fmess-pin-item]') return el.hasAttribute('data-fmess-pin-item');
    if (sel === 'a[href*="/t/"]') return el.tagName === 'A' && (el.getAttribute('href') ?? '').includes('/t/');
    if (sel.startsWith('[role="menu"]')) {
      return el.getAttribute('role') === 'menu' && el.getAttribute('data-fmess-ui') !== 'reactions' && el.id !== 'fmess-pinned-fallback-menu';
    }
    return false;
  }

  const body = new FakeElement('body');
  const document = {
    body,
    documentElement: new FakeElement('html'),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeFragment(),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    querySelector: (sel) => body.querySelector(sel),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent: () => true,
  };

  const window = {
    opener: null,
    innerWidth: 1200,
    innerHeight: 800,
    __fmessDebug: true,
    __fmessErrors: errors,
    addEventListener: (type, fn) => {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    require: () => {
      throw new Error('not mocked');
    },
  };

  // Inject `language` variable expected by 17-pinned-chats.js
  const wrappedFn = new Function(
    'window',
    'document',
    'location',
    'Element',
    'Node',
    'KeyboardEvent',
    'MutationObserver',
    'setInterval',
    'setTimeout',
    'clearTimeout',
    'settings',
    'LIST_PANE',
    'onChatsPage',
    'currentUserId',
    'int64',
    'loadModules',
    'moduleFunction',
    'invoke',
    'withRoot',
    'say',
    'initialLang',
    `let language = initialLang;
    ${pinnedPart}
    return {
      pinnedStore,
      computeEffectivePins,
      normalizeAccountPins,
      pinThread,
      unpinThread,
      movePinnedThread,
      applyPinnedSettings,
      isPinnedListView,
      isServerPinnedThread,
      wrapPinnedThreadListFactory,
      pinMenuSpecFor,
      noteThreadMenuOpen,
      injectIntoNativeMenu,
      setServerPins: (list) => {
        serverPinnedThreads = list;
        serverPinnedIdSet = new Set(list.map((e) => e.id));
        recomputePinnedSnapshot();
      },
      setLang: (l) => { language = l; },
      recompute: (f) => recomputePinnedSnapshot(f),
    };`,
  );

  const api = wrappedFn(
    window,
    document,
    { get pathname() { return currentPath; } },
    FakeElement,
    FakeElement,
    class KeyboardEvent {},
    class MutationObserver { observe() {} disconnect() {} },
    () => 0,
    () => 0,
    () => {},
    settings,
    'data-fmess-list',
    () => /^\/messages(\/|$)/.test(currentPath),
    () => currentUid,
    (v) => (Array.isArray(v) ? (BigInt(v[0]) << 32n) + BigInt(v[1] >>> 0) : BigInt(v ?? 0)),
    () => Promise.resolve(),
    (m) => (typeof m === 'function' ? m : m?.default),
    (command, args) => {
      invokes.push({ command, args });
      return Promise.resolve();
    },
    (cb) => cb({ append: (el) => rootChildren.push(el) }),
    (en, vi) => (currentLang === 'vi' ? vi : en),
    lang,
  );

  return {
    api,
    invokes,
    errors,
    document,
    body,
    FakeElement,
    setPath: (p) => { currentPath = p; },
    setUser: (u) => { currentUid = u; api.recompute(); },
    setLang: (l) => { currentLang = l; api.setLang(l); },
  };
}

const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. Joined inject script syntax check (smoke)
check('joined inject script contains pinned chats and MWThreadList wrapper', script.includes('wrapPinnedThreadListFactory') && script.includes('cr:34927'));

// 2. Live merge of server-synced mobile pins + local pins + hides + custom order
{
  const h = harness({
    settings: {
      pinnedChats: {
        10001: { pinned: ['300', '400'], hidden: ['200'], order: [] },
      },
    },
  });
  h.api.setServerPins([
    { id: '100', lastActivity: 5000 },
    { id: '200', lastActivity: 4000 },
    { id: '300', lastActivity: 3000 }, // also in local.pinned -> should upgrade to synced without duplicate
  ]);
  const snap = h.api.pinnedStore.getSnapshot();
  check(
    'merges synced mobile pins with local pins, hides locally hidden synced pin, deduplicates upgrades',
    same(snap, [
      { id: '100', source: 'synced' },
      { id: '300', source: 'synced' },
      { id: '400', source: 'local' },
    ]),
    snap,
  );

  // Move 400 up -> custom order persisted
  h.api.movePinnedThread('400', -1);
  check(
    'movePinnedThread reorders across synced and local pins and persists',
    same(
      h.api.pinnedStore.getSnapshot().map((p) => p.id),
      ['100', '400', '300'],
    ) && h.invokes.at(-1)?.command === 'set_pinned_chats',
    { snap: h.api.pinnedStore.getSnapshot(), last: h.invokes.at(-1) },
  );

  // Unpin synced pin 100 -> adds to hidden, removes from snapshot
  h.api.unpinThread('100');
  check(
    'unpinning a synced pin hides it locally',
    same(
      h.api.pinnedStore.getSnapshot().map((p) => p.id),
      ['400', '300'],
    ) && h.invokes.at(-1)?.args?.chats?.hidden?.includes('100'),
    h.invokes.at(-1),
  );

  // Restoring hidden synced pin 100 -> removes from hidden and restores as synced
  h.api.pinThread('100');
  check(
    'pinning a locally hidden synced pin restores it as synced',
    h.api.pinnedStore.getSnapshot().some((p) => p.id === '100' && p.source === 'synced') &&
      !h.invokes.at(-1)?.args?.chats?.hidden?.includes('100'),
    h.api.pinnedStore.getSnapshot(),
  );
}

// 3. Logged-out state (USER_ID=0) clears effective pins
{
  const h = harness({ settings: { pinnedChats: { 10001: { pinned: ['555'], hidden: [], order: [] } } } });
  h.api.recompute();
  check('logged-in account sees its pins', h.api.pinnedStore.getSnapshot().length === 1);
  h.setUser('0');
  check('logged-out (USER_ID=0) hides all pins', h.api.pinnedStore.getSnapshot().length === 0);
}

// 4. List-view scoping (All inbox vs filter tabs vs archived/requests)
{
  const h = harness();
  const idStr = (v) => String(v);
  check('inbox All tab (filter=0) allows pins', h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: 0 }, idStr));
  check('inbox All tab (filter=null) allows pins', h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: null }, idStr));
  check('Unread/Groups tab (filter!=0) disables pins', !h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: 2 }, idStr));
  check('customThreadFilter disables pins', !h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: 0, customThreadFilter: () => true }, idStr));
  check('non-inbox lsEntryPoint disables pins', !h.api.isPinnedListView({ lsEntryPoint: 'archivedThreadList', filter: 0 }, idStr));
  h.setPath('/messages/archived/t/123/');
  check('/messages/archived/ route disables pins', !h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: 0 }, idStr));
  h.setPath('/messages/requests/');
  check('/messages/requests/ route disables pins', !h.api.isPinnedListView({ lsEntryPoint: 'inboxThreadList', filter: 0 }, idStr));
}

// 5. Server bit-14 detection (I64 array and fallback)
{
  const h = harness();
  check('detects bit 14 on [0, 16384]', h.api.isServerPinnedThread({ threadTags: [0, 16384] }));
  check('detects bit 14 on [0, 53259]', h.api.isServerPinnedThread({ threadTags: [0, 53259] }));
  check('rejects unpinned [0, 37003]', !h.api.isServerPinnedThread({ threadTags: [0, 37003] }));
  check('rejects [0, 0]', !h.api.isServerPinnedThread({ threadTags: [0, 0] }));
}

// 6. Reused native [role="menu"] staleness check across threads & languages
{
  const h = harness({ settings: { pinnedChats: { 10001: { pinned: ['901'], hidden: [], order: [] } } } });
  h.api.setServerPins([{ id: '900', lastActivity: 1000 }]);

  const menu = new h.FakeElement('div');
  menu.setAttribute('role', 'menu');
  const native1 = new h.FakeElement('div');
  native1.setAttribute('role', 'menuitem');
  const native2 = new h.FakeElement('div');
  native2.setAttribute('role', 'menuitem');
  menu.append(native1, native2);
  h.body.append(menu);

  const rowA = new h.FakeElement('div');
  rowA.setAttribute('data-fmess-thread-id', '900'); // synced pin
  h.api.noteThreadMenuOpen(rowA);
  h.api.injectIntoNativeMenu();
  const itemsA = menu.querySelectorAll('[data-fmess-pin-item]').map((el) => el.textContent);
  check('synced pin menu shows Hide pin (this device) + Move pin down', same(itemsA, ['Hide pin (this device)', 'Move pin down']), itemsA);

  // Reuse SAME menu DOM node for unpinned thread 999
  const rowB = new h.FakeElement('div');
  rowB.setAttribute('data-fmess-thread-id', '999');
  h.api.noteThreadMenuOpen(rowB);
  h.api.injectIntoNativeMenu();
  const itemsB = menu.querySelectorAll('[data-fmess-pin-item]').map((el) => el.textContent);
  check('reused menu updates for unpinned thread', same(itemsB, ['Pin chat (this device)']), itemsB);

  // If React replaces the previously open menu with a new menu node, watch stays active
  const menu2 = new h.FakeElement('div');
  menu2.setAttribute('role', 'menu');
  const m2n1 = new h.FakeElement('div');
  m2n1.setAttribute('role', 'menuitem');
  const m2n2 = new h.FakeElement('div');
  m2n2.setAttribute('role', 'menuitem');
  menu2.append(m2n1, m2n2);
  menu.remove();
  h.body.append(menu2);
  h.api.injectIntoNativeMenu();
  const itemsB2 = menu2.querySelectorAll('[data-fmess-pin-item]').map((el) => el.textContent);
  check('replacement menu node still receives pin items after prior menu was open', same(itemsB2, ['Pin chat (this device)']), itemsB2);

  // Switch language to Vietnamese and reopen on local pin 901
  h.setLang('vi');
  const rowC = new h.FakeElement('div');
  rowC.setAttribute('data-fmess-thread-id', '901');
  h.api.noteThreadMenuOpen(rowC);
  h.api.injectIntoNativeMenu();
  const itemsC = menu2.querySelectorAll('[data-fmess-pin-item]').map((el) => el.textContent);
  check('reused menu updates for Vietnamese language', same(itemsC, ['Bỏ ghim đoạn chat', 'Đưa ghim lên']), itemsC);
}

// 7. Hidden synced pin that was later unpinned on mobile offers normal local pin
{
  const h = harness({
    settings: {
      pinnedChats: { 10001: { pinned: [], hidden: ['500'], order: [] } },
    },
  });
  h.api.setServerPins([]); // 500 is no longer pinned on mobile
  const specs = h.api.pinMenuSpecFor('500').map((s) => s.action);
  check('stale hidden id offers local pin instead of restore', same(specs, ['pin']), specs);
  h.api.pinThread('500');
  const snap = h.api.pinnedStore.getSnapshot();
  check(
    'pinning stale hidden id pins locally and removes it from hidden',
    same(snap, [{ id: '500', source: 'local' }]) && !h.invokes.at(-1)?.args?.chats?.hidden?.includes('500'),
    { snap, last: h.invokes.at(-1) },
  );
}

// 7. applyPinnedSettings updates store (prevents reload revert)
{
  const h = harness();
  h.api.applyPinnedSettings({ 10001: { pinned: ['777'], hidden: [], order: [] } });
  check('applyPinnedSettings updates live snapshot', same(h.api.pinnedStore.getSnapshot(), [{ id: '777', source: 'local' }]), h.api.pinnedStore.getSnapshot());
}

console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);

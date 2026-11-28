  // Pinned chats at the top of the unfiltered inbox list.
  //
  // Messenger's chat list (MWThreadList.react) ships an optional pinned slot
  // (cr:34927, currently null on facebook.com) and filters pinned threads out
  // of the chronological list via MWLSPinnedThreadUtils.useFilterPinnedThreads.
  // Mobile-pinned chats already sync into LSDatabaseSingleton.tables.threads
  // as bit 14 (1 << 14 = 16384) of threadTags, though facebook.com has no
  // client-side write API for pinning. fMess fills cr:34927 with Messenger's
  // own MWThreadListItem rows, live-merging server-synced mobile pins with
  // per-account local overrides persisted in settings.json.
  const PINNED_SECTION_SLOT = 'cr:34927';
  const PINNED_UTILS_MODULE = 'MWLSPinnedThreadUtils';
  const INBOX_ENTRY_POINT = 'inboxThreadList';
  const PINNED_TAG_BIT = 16384n;
  const MAX_PINNED_CHATS = 50;
  const THREAD_ID_RE = /^\d{1,32}$/;

  const emptyAccountPins = () => ({ pinned: [], hidden: [], order: [] });
  const sanitizePinIds = (list, limit = MAX_PINNED_CHATS) => {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      if (out.length >= limit) break;
      const id = typeof raw === 'string' ? raw : '';
      if (THREAD_ID_RE.test(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };
  const normalizeAccountPins = (raw) => {
    if (!raw || typeof raw !== 'object') return emptyAccountPins();
    const hidden = sanitizePinIds(raw.hidden, MAX_PINNED_CHATS);
    const hiddenSet = new Set(hidden);
    const pinned = sanitizePinIds(raw.pinned, MAX_PINNED_CHATS).filter((id) => !hiddenSet.has(id));
    const order = sanitizePinIds(raw.order, MAX_PINNED_CHATS * 2).filter((id) => !hiddenSet.has(id));
    return { pinned, hidden, order };
  };
  const normalizePinnedMap = (raw) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [account, value] of Object.entries(raw)) {
      if (!THREAD_ID_RE.test(account) || account === '0') continue;
      const normalized = normalizeAccountPins(value);
      if (normalized.pinned.length || normalized.hidden.length || normalized.order.length) {
        out[account] = normalized;
      }
    }
    return out;
  };

  let pinnedByAccount = normalizePinnedMap(settings.pinnedChats);
  let activePinnedAccount = null;
  let serverPinnedThreads = []; // [{ id, lastActivity }] sorted desc by lastActivity
  let pinnedSnapshot = []; // [{ id, source: 'synced' | 'local' }]
  let pinnedIdSet = new Set();
  let serverPinnedIdSet = new Set();
  const pinnedListeners = new Set();

  const currentPinnedAccount = () => {
    const id = currentUserId();
    return id && THREAD_ID_RE.test(String(id)) && String(id) !== '0' ? String(id) : null;
  };

  const getAccountPins = (account = activePinnedAccount ?? currentPinnedAccount()) =>
    (account && pinnedByAccount[account]) || emptyAccountPins();

  const computeEffectivePins = (serverList, local) => {
    const hiddenSet = new Set(local.hidden);
    const serverSet = new Set();
    const byId = new Map();
    const defaults = [];
    for (const entry of serverList) {
      if (!entry?.id || !THREAD_ID_RE.test(entry.id)) continue;
      serverSet.add(entry.id);
      if (hiddenSet.has(entry.id) || byId.has(entry.id)) continue;
      const item = { id: entry.id, source: 'synced' };
      byId.set(entry.id, item);
      defaults.push(item);
    }
    for (const id of local.pinned) {
      if (serverSet.has(id) || hiddenSet.has(id) || byId.has(id)) continue;
      const item = { id, source: 'local' };
      byId.set(id, item);
      defaults.push(item);
    }
    if (!local.order.length) return defaults;
    const ordered = [];
    const placed = new Set();
    for (const id of local.order) {
      const item = byId.get(id);
      if (item && !placed.has(id)) {
        placed.add(id);
        ordered.push(item);
      }
    }
    for (const item of defaults) {
      if (!placed.has(item.id)) ordered.push(item);
    }
    return ordered;
  };

  const recomputePinnedSnapshot = (forceEmit = false) => {
    activePinnedAccount = currentPinnedAccount();
    const next = activePinnedAccount ? computeEffectivePins(serverPinnedThreads, getAccountPins(activePinnedAccount)) : [];
    const same =
      !forceEmit &&
      next.length === pinnedSnapshot.length &&
      next.every((item, i) => item.id === pinnedSnapshot[i]?.id && item.source === pinnedSnapshot[i]?.source);
    if (same) return;
    pinnedSnapshot = next;
    pinnedIdSet = new Set(next.map((item) => item.id));
    for (const listener of [...pinnedListeners]) listener();
  };

  const pinnedStore = {
    subscribe(listener) {
      pinnedListeners.add(listener);
      return () => pinnedListeners.delete(listener);
    },
    getSnapshot: () => pinnedSnapshot,
    getIds: () => pinnedIdSet,
  };

  const persistAccountPins = (account, next) => {
    const clean = normalizeAccountPins(next);
    if (clean.pinned.length || clean.hidden.length || clean.order.length) {
      pinnedByAccount[account] = clean;
    } else {
      delete pinnedByAccount[account];
    }
    recomputePinnedSnapshot();
    invoke('set_pinned_chats', { account, chats: clean }).catch(() => {});
  };

  const pinThread = (threadId) => {
    const account = currentPinnedAccount();
    if (!account || !THREAD_ID_RE.test(threadId)) return false;
    const cur = getAccountPins(account);
    if (cur.hidden.includes(threadId) && serverPinnedIdSet.has(threadId)) {
      persistAccountPins(account, {
        pinned: cur.pinned,
        hidden: cur.hidden.filter((id) => id !== threadId),
        order: cur.order,
      });
      return true;
    }
    if (pinnedIdSet.has(threadId) || cur.pinned.length >= MAX_PINNED_CHATS) return false;
    persistAccountPins(account, {
      pinned: [...cur.pinned, threadId],
      hidden: cur.hidden.filter((id) => id !== threadId),
      order: cur.order.length ? [...cur.order, threadId] : [],
    });
    return true;
  };

  const unpinThread = (threadId) => {
    const account = currentPinnedAccount();
    if (!account || !THREAD_ID_RE.test(threadId)) return false;
    const cur = getAccountPins(account);
    const isServer = serverPinnedIdSet.has(threadId);
    const nextPinned = cur.pinned.filter((id) => id !== threadId);
    const nextHidden = isServer && !cur.hidden.includes(threadId) ? [...cur.hidden, threadId] : cur.hidden;
    const nextOrder = cur.order.filter((id) => id !== threadId);
    if (
      nextPinned.length === cur.pinned.length &&
      nextHidden.length === cur.hidden.length &&
      nextOrder.length === cur.order.length
    ) {
      return false;
    }
    persistAccountPins(account, { pinned: nextPinned, hidden: nextHidden, order: nextOrder });
    return true;
  };

  const movePinnedThread = (threadId, delta) => {
    const account = currentPinnedAccount();
    if (!account || !delta) return false;
    const ids = pinnedSnapshot.map((item) => item.id);
    const index = ids.indexOf(threadId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return false;
    const nextOrder = [...ids];
    [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
    const cur = getAccountPins(account);
    persistAccountPins(account, { pinned: cur.pinned, hidden: cur.hidden, order: nextOrder });
    return true;
  };

  function applyPinnedSettings(nextMap) {
    if (nextMap && typeof nextMap === 'object') {
      pinnedByAccount = normalizePinnedMap(nextMap);
    }
    // Always re-emit so localized tooltips update when language changes.
    recomputePinnedSnapshot(true);
  }

  // Live reader for server-synced mobile pins (threads.threadTags bit 14).
  const isServerPinnedThread = (thread, nativeCheck) => {
    if (!thread) return false;
    if (typeof nativeCheck === 'function') {
      try {
        return Boolean(nativeCheck(thread.threadTags));
      } catch {}
    }
    try {
      return (int64(thread.threadTags) & PINNED_TAG_BIT) !== 0n;
    } catch {
      return false;
    }
  };

  let serverSyncStarted = false;
  let serverSyncTimer = 0;
  const startServerPinnedSync = async () => {
    if (serverSyncStarted || window.opener) return;
    serverSyncStarted = true;
    try {
      await loadModules(['ReQL', 'LSDatabaseSingleton']);
      const ReQL = window.require('ReQL');
      const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
      if (!db?.tables?.threads || typeof ReQL?.fromTableAscending !== 'function') return;
      let nativeIsPinned = null;
      try {
        nativeIsPinned = window.require(PINNED_UTILS_MODULE)?.isPinnedThread ?? null;
      } catch {}
      const readServerPins = async () => {
        try {
          const all = await ReQL.toArrayAsync(ReQL.fromTableAscending(db.tables.threads));
          const found = [];
          for (const thread of all) {
            if (thread.folderName !== 'inbox' || int64(thread.parentThreadKey) !== 0n) continue;
            if (!isServerPinnedThread(thread, nativeIsPinned)) continue;
            const id = String(int64(thread.threadKey));
            if (!THREAD_ID_RE.test(id)) continue;
            found.push({ id, lastActivity: Number(int64(thread.lastActivityTimestampMs)) });
          }
          found.sort((a, b) => b.lastActivity - a.lastActivity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          const same =
            found.length === serverPinnedThreads.length &&
            found.every((entry, i) => entry.id === serverPinnedThreads[i]?.id && entry.lastActivity === serverPinnedThreads[i]?.lastActivity);
          if (!same) {
            serverPinnedThreads = found;
            serverPinnedIdSet = new Set(found.map((entry) => entry.id));
            recomputePinnedSnapshot();
          }
        } catch {}
      };
      await readServerPins();
      const table = ReQL.fromTableAscending(db.tables.threads);
      if (typeof table?.subscribe === 'function') {
        table.subscribe(() => {
          clearTimeout(serverSyncTimer);
          serverSyncTimer = setTimeout(readServerPins, 300);
        });
      }
    } catch {
      serverSyncStarted = false;
    }
  };

  if (!window.opener) {
    window.addEventListener('load', () => setTimeout(() => startServerPinnedSync(), 1500));
    setInterval(() => {
      const account = currentPinnedAccount();
      if (account !== activePinnedAccount) recomputePinnedSnapshot();
      if (account && !serverSyncStarted) startServerPinnedSync();
    }, 2000);
  }

  // Whether a MWThreadList render is the main unfiltered "All chats" inbox.
  const isNonInboxRoute = () => /^\/messages\/(archived|requests|filtered|marketplace|spam)(\/|$)/.test(location.pathname);
  const isPinnedListView = (props, idToString) => {
    if (!props || typeof props !== 'object') return false;
    if (props.lsEntryPoint !== INBOX_ENTRY_POINT || props.customThreadFilter != null) return false;
    if (isNonInboxRoute()) return false;
    if (props.filter == null) return true;
    try {
      return String(idToString(props.filter)) === '0';
    } catch {
      return false;
    }
  };

  const hasMethods = (value, names) =>
    Boolean(value && (typeof value === 'object' || typeof value === 'function') && names.every((name) => typeof value[name] === 'function'));

  const keepEveryThread = () => true;

  const listExports = (result, args) => {
    for (const candidate of [result, ...args.slice(-2)]) {
      for (const value of [candidate, candidate?.exports]) {
        if (value && typeof value === 'object' && typeof value.default === 'function') return value;
      }
    }
    return null;
  };

  const sameArity = (fn, original) => {
    try {
      Object.defineProperty(fn, 'length', { value: original.length });
    } catch {}
    return fn;
  };

  const pinTooltip = (source) =>
    source === 'synced'
      ? say('Pinned (synced across devices)', 'Đã ghim (đồng bộ các thiết bị)')
      : say('Pinned on this device only', 'Chỉ ghim trên thiết bị này');

  // Pin SVG paths: filled pushpin for synced mobile pins, outline for local-only desktop pins.
  const PIN_SVG_PATH = 'M16 3a1 1 0 0 1 .7 1.7L15 6.4v3.2l2.4 2.4a1 1 0 0 1-.7 1.7H13v5.8a1 1 0 1 1-2 0v-5.8H7.3a1 1 0 0 1-.7-1.7L9 9.6V6.4L7.3 4.7A1 1 0 0 1 8 3h8Z';

  function createPinnedParts(load) {
    const react = load('react');
    const i64 = load('I64');
    const queries = load('ReQL');
    const suspense = load('ReQLSuspense');
    const useReStore = moduleFunction(load('useReStore'));
    const ThreadListItem = moduleFunction(load('MWThreadListItem.react'));
    const ThreadKeyProvider = load('MWThreadKey.react')?.MWThreadKeyProvider;
    const DialogProvider = moduleFunction(load('CometTransientDialogProvider.react'));
    if (
      !hasMethods(react, ['createElement', 'createContext', 'useContext', 'useSyncExternalStore', 'useMemo']) ||
      !react.Suspense ||
      typeof react.Component !== 'function' ||
      !hasMethods(i64, ['of_string', 'to_string', 'equal']) ||
      !hasMethods(queries, ['fromTableAscending']) ||
      !hasMethods(suspense, ['useFirst']) ||
      typeof useReStore !== 'function' ||
      !ThreadListItem ||
      !ThreadKeyProvider ||
      !DialogProvider
    ) {
      return null;
    }

    const h = react.createElement;
    const { Suspense, useContext, useMemo, useSyncExternalStore } = react;
    let authority = null;
    let intEnum = null;
    try {
      const rawAuth = load('LSAuthorityLevel');
      authority = rawAuth?.default ?? rawAuth ?? null;
      intEnum = load('LSIntEnum') ?? null;
    } catch {}
    const partial = authority?.CLIENT_PARTIAL;
    const complete = (thread) =>
      typeof partial !== 'number' || !hasMethods(intEnum, ['toNumber']) || intEnum.toNumber(thread.authorityLevel) > partial;

    let routerContext = null;
    try {
      routerContext = moduleFunction(window.require('CometRouterDispatcherContext'));
    } catch {}
    const router = routerContext?.Provider ? routerContext : react.createContext(null);
    const ListView = react.createContext(false);

    let failed = false;
    const failureListeners = new Set();
    const subscribeFailure = (listener) => {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    };
    const hasFailed = () => failed;

    class Boundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        window.__fmessErrors?.push(`pinned: ${error?.message ?? error}`);
        if (failed) return;
        failed = true;
        for (const listener of [...failureListeners]) listener();
      }
      render() {
        return this.state.failed ? null : (this.props.children ?? null);
      }
    }

    function PinBadge(props) {
      const source = props.source;
      const tip = pinTooltip(source);
      const isSynced = source === 'synced';
      return h(
        'span',
        {
          className: 'fmess-pin-badge',
          'data-fmess-pin-source': source,
          title: tip,
          'aria-label': tip,
        },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: 13, height: 13, 'aria-hidden': 'true' },
          h('path', {
            d: PIN_SVG_PATH,
            fill: isSynced ? 'currentColor' : 'none',
            stroke: isSynced ? 'none' : 'currentColor',
            strokeWidth: isSynced ? 0 : 1.75,
            strokeLinejoin: 'round',
          }),
        ),
      );
    }

    function FallbackRow(props) {
      const pin = props.pin;
      const dispatcher = useContext(router);
      const path = `/messages/t/${pin.id}/`;
      const label = say('Pinned chat', 'Đoạn chat đã ghim');
      const open = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (!hasMethods(dispatcher, ['go'])) return;
        event.preventDefault();
        try {
          dispatcher.go(path, {});
        } catch {
          location.assign(path);
        }
      };
      return h(
        'div',
        {
          role: 'row',
          className: 'fmess-pinned-fallback',
          'data-fmess-pinned-row': pin.source,
          'data-fmess-thread-id': pin.id,
        },
        h(
          'div',
          { role: 'gridcell' },
          h(
            'a',
            {
              href: path,
              role: 'link',
              'aria-label': label,
              onClick: open,
            },
            h(
              'svg',
              { className: 'fmess-pinned-fallback-avatar', viewBox: '0 0 40 40', 'aria-hidden': 'true' },
              h('circle', { cx: 20, cy: 20, r: 20 }),
              h('path', {
                d: 'M20 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 10c4.4 0 8 2.2 8 5v2H12v-2c0-2.8 3.6-5 8-5Z',
                fill: 'currentColor',
                opacity: 0.55,
              }),
            ),
            h('span', { dir: 'auto' }, label),
          ),
        ),
        h(PinBadge, { source: pin.source }),
      );
    }

    function PinnedRow(props) {
      const pin = props.pin;
      const list = props.list;
      const db = useReStore();
      const thread = suspense.useFirst(
        () => queries.fromTableAscending(db?.tables?.threads).getKeyRange(i64.of_string(pin.id)),
        [db, pin.id],
        'FMessPinnedChats.row',
      );
      if (!thread || !complete(thread)) return h(FallbackRow, { pin });
      // Archived and other folders' threads stay where Messenger lists them.
      if (thread.folderName && thread.folderName !== 'inbox') return null;
      if (list.parentThreadKey != null && !i64.equal(thread.parentThreadKey, list.parentThreadKey)) return null;
      const selected = list.selectedThreadKey != null && i64.equal(list.selectedThreadKey, thread.threadKey);
      return h(
        'div',
        {
          className: 'fmess-pinned-row',
          'data-fmess-pinned-row': pin.source,
          'data-fmess-thread-id': pin.id,
        },
        h(
          ThreadKeyProvider,
          { id: thread.threadKey },
          h(
            DialogProvider,
            null,
            h(ThreadListItem, {
              lsEntryPoint: list.lsEntryPoint,
              lsSubEntryPoint: list.lsSubEntryPoint,
              messagingEntrypoint: list.messagingEntrypoint,
              onClose: list.onClose,
              selected,
              showFollowUpReminder: false,
              size: 56,
              thread,
            }),
          ),
        ),
        h(PinBadge, { source: pin.source }),
      );
    }

    function FMessPinnedChats(props) {
      const shown = useContext(ListView);
      const pins = useSyncExternalStore(pinnedStore.subscribe, pinnedStore.getSnapshot);
      const broken = useSyncExternalStore(subscribeFailure, hasFailed);
      if (!shown || broken || pins.length === 0) return null;
      return h(
        Boundary,
        null,
        h(
          'div',
          { className: 'fmess-pinned-chats', 'data-fmess-ui': 'pinned-chats', role: 'rowgroup' },
          ...pins.map((pin) => h(Suspense, { key: pin.id, fallback: null }, h(PinnedRow, { pin, list: props }))),
        ),
      );
    }

    function useFMessFilterPinnedThreads() {
      const shown = useContext(ListView);
      const ids = useSyncExternalStore(pinnedStore.subscribe, pinnedStore.getIds);
      const broken = useSyncExternalStore(subscribeFailure, hasFailed);
      return useMemo(
        () =>
          shown && !broken && ids.size
            ? (thread) => {
                const key = thread?.threadKey;
                return key == null || !ids.has(String(i64.to_string(key)));
              }
            : keepEveryThread,
        [shown, broken, ids],
      );
    }

    const utilsCache = new WeakMap();
    return {
      Section: FMessPinnedChats,
      utils(original) {
        if (!original || typeof original !== 'object') return original;
        let patched = utilsCache.get(original);
        if (!patched) {
          patched = { ...original, useFilterPinnedThreads: useFMessFilterPinnedThreads };
          utilsCache.set(original, patched);
        }
        return patched;
      },
      wrapList(List) {
        return function FMessThreadList(props) {
          const shown = isPinnedListView(props, (value) => i64.to_string(value));
          return h(ListView.Provider, { value: shown }, h(List, props));
        };
      },
    };
  }

  function wrapPinnedThreadListFactory(factory) {
    return sameArity(function (...args) {
      const req = args[1];
      const load = args[3];
      if (typeof req !== 'function' || typeof load !== 'function') return Reflect.apply(factory, this, args);
      let parts = null;
      try {
        parts = createPinnedParts(load);
      } catch (error) {
        window.__fmessErrors?.push(`pinned: ${error?.message ?? error}`);
      }
      args[1] = sameArity(function (...names) {
        if (parts && names[0] === PINNED_SECTION_SLOT) return parts.Section;
        const value = Reflect.apply(req, this, names);
        return parts && names[0] === PINNED_UTILS_MODULE ? parts.utils(value) : value;
      }, req);
      args[3] = sameArity(function (...names) {
        if (parts && names[0] === PINNED_SECTION_SLOT) return parts.Section;
        const value = Reflect.apply(load, this, names);
        return parts && names[0] === PINNED_UTILS_MODULE ? parts.utils(value) : value;
      }, load);
      const result = Reflect.apply(factory, this, args);
      try {
        const exports = parts && listExports(result, args);
        if (parts && exports) exports.default = parts.wrapList(exports.default);
      } catch (error) {
        window.__fmessErrors?.push(`pinned: ${error?.message ?? error}`);
      }
      return result;
    }, factory);
  }

  // Native thread-row menu injection (works for both ⋯ button clicks and
  // right-click via 10-contextmenu.js). Messenger reuses [role="menu"] nodes
  // across threads, so injected items are always verified against the active
  // threadId, pin state, ordering, and language.
  const PIN_ITEM_ATTR = 'data-fmess-pin-item';
  let pendingMenu = null;
  let lastNoted = { id: null, at: 0 };
  let menuObserver = null;
  let menuTimeout = 0;
  let menuDefer = 0;

  const threadIdFromRow = (row) => {
    const direct = row?.closest?.('[data-fmess-thread-id]')?.getAttribute('data-fmess-thread-id');
    if (direct && THREAD_ID_RE.test(direct)) return direct;
    const href = row?.querySelector?.('a[href*="/t/"]')?.getAttribute('href') ?? '';
    const match = href.match(/\/t\/(\d+)/);
    return match ? match[1] : null;
  };

  const stopMenuWatch = () => {
    clearTimeout(menuTimeout);
    menuTimeout = 0;
    clearTimeout(menuDefer);
    menuDefer = 0;
    menuObserver?.disconnect();
    menuObserver = null;
    pendingMenu = null;
  };

  const pinMenuSpecFor = (threadId) => {
    if (!currentPinnedAccount() || !THREAD_ID_RE.test(threadId)) return [];
    const cur = getAccountPins();
    const entry = pinnedSnapshot.find((item) => item.id === threadId);
    const items = [];
    if (entry) {
      if (entry.source === 'synced') {
        items.push({
          action: 'unpin',
          label: say('Hide pin (this device)', 'Ẩn ghim (thiết bị này)'),
          icon: 'unpin',
          run: () => unpinThread(threadId),
        });
      } else {
        items.push({
          action: 'unpin',
          label: say('Unpin chat', 'Bỏ ghim đoạn chat'),
          icon: 'unpin',
          run: () => unpinThread(threadId),
        });
      }
      const index = pinnedSnapshot.findIndex((item) => item.id === threadId);
      if (index > 0) {
        items.push({
          action: 'move-up',
          label: say('Move pin up', 'Đưa ghim lên'),
          icon: 'up',
          run: () => movePinnedThread(threadId, -1),
        });
      }
      if (index >= 0 && index < pinnedSnapshot.length - 1) {
        items.push({
          action: 'move-down',
          label: say('Move pin down', 'Đưa ghim xuống'),
          icon: 'down',
          run: () => movePinnedThread(threadId, 1),
        });
      }
    } else if (cur.hidden.includes(threadId) && serverPinnedIdSet.has(threadId)) {
      items.push({
        action: 'restore',
        label: say('Restore synced pin', 'Khôi phục ghim đồng bộ'),
        icon: 'pin-synced',
        run: () => pinThread(threadId),
      });
    } else if (cur.pinned.length < MAX_PINNED_CHATS) {
      items.push({
        action: 'pin',
        label: say('Pin chat (this device)', 'Ghim đoạn chat (thiết bị này)'),
        icon: 'pin-local',
        run: () => pinThread(threadId),
      });
    }
    return items;
  };

  const menuIconSvg = (kind) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    if (kind === 'up') {
      path.setAttribute('d', 'M12 6l-6 6h4v6h4v-6h4l-6-6Z');
      path.setAttribute('fill', 'currentColor');
    } else if (kind === 'down') {
      path.setAttribute('d', 'M12 18l6-6h-4V6h-4v6H6l6 6Z');
      path.setAttribute('fill', 'currentColor');
    } else if (kind === 'unpin') {
      path.setAttribute('d', 'M3.3 3.3a1 1 0 0 1 1.4 0l16 16a1 1 0 1 1-1.4 1.4l-6.3-6.3v5.1a1 1 0 1 1-2 0v-5.8H7.3a1 1 0 0 1-.7-1.7L9 9.6V8.4L3.3 4.7a1 1 0 0 1 0-1.4ZM16 3a1 1 0 0 1 .7 1.7L15 6.4v3.2l1.6 1.6-6.9-6.9L8 3h8Z');
      path.setAttribute('fill', 'currentColor');
    } else if (kind === 'pin-synced') {
      path.setAttribute('d', PIN_SVG_PATH);
      path.setAttribute('fill', 'currentColor');
    } else {
      path.setAttribute('d', PIN_SVG_PATH);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.75');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(path);
    return svg;
  };

  const dismissOpenMenu = () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }),
    );
  };

  const buildMenuItem = (spec, threadId, signature) => {
    const el = document.createElement('div');
    el.className = 'fmess-pin-menuitem';
    el.setAttribute('role', 'menuitem');
    el.setAttribute('tabindex', '0');
    el.setAttribute(PIN_ITEM_ATTR, spec.action);
    el.dataset.threadId = threadId;
    el.dataset.signature = signature;
    const icon = document.createElement('span');
    icon.className = 'fmess-pin-menuitem-icon';
    icon.append(menuIconSvg(spec.icon));
    const text = document.createElement('span');
    text.className = 'fmess-pin-menuitem-label';
    text.textContent = spec.label;
    el.append(icon, text);
    const activate = (event) => {
      event.preventDefault();
      event.stopPropagation();
      spec.run();
      dismissOpenMenu();
    };
    el.addEventListener('click', activate);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    return el;
  };

  const visibleThreadMenu = () =>
    [...document.querySelectorAll('[role="menu"]:not([data-fmess-ui="reactions"]):not(#fmess-pinned-fallback-menu)')]
      .filter((menu) => {
        if (menu.closest('[role="main"]')) return false;
        const box = menu.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        const nativeItems = [...menu.querySelectorAll('[role="menuitem"]')].filter((item) => !item.hasAttribute(PIN_ITEM_ATTR));
        return nativeItems.length >= 2;
      })
      .at(-1) ?? null;

  const injectIntoNativeMenu = () => {
    if (!pendingMenu) return false;
    if (Date.now() > pendingMenu.expiresAt) {
      stopMenuWatch();
      return false;
    }
    const menu = visibleThreadMenu();
    if (!menu) return false;
    const { threadId, previousMenu } = pendingMenu;
    const specs = pinMenuSpecFor(threadId);
    const signature = `${threadId}|${language}|${specs.map((s) => `${s.action}:${s.label}`).join(',')}`;
    const existing = [...menu.querySelectorAll(`[${PIN_ITEM_ATTR}]`)];
    const unchanged = existing.length === specs.length && existing.every((el) => el.dataset.signature === signature);
    if (!unchanged) {
      for (const old of existing) old.remove();
      if (specs.length) {
        const firstNative = [...menu.querySelectorAll('[role="menuitem"]')].find((item) => !item.hasAttribute(PIN_ITEM_ATTR));
        const container = firstNative?.parentElement ?? menu;
        const fragment = document.createDocumentFragment();
        for (const spec of specs) fragment.append(buildMenuItem(spec, threadId, signature));
        container.insertBefore(fragment, firstNative ?? container.firstChild);
      }
    }
    // If a menu was already open when this click started, keep watching until
    // React either replaces it with the new menu or the watch window expires.
    if (menu !== previousMenu) stopMenuWatch();
    return true;
  };

  const noteThreadMenuOpen = (row) => {
    if (!onChatsPage() || isNonInboxRoute() || !currentPinnedAccount()) return;
    const threadId = threadIdFromRow(row);
    if (!threadId) return;
    const now = Date.now();
    if (lastNoted.id === threadId && now - lastNoted.at < 120) return;
    lastNoted = { id: threadId, at: now };
    const previousMenu = visibleThreadMenu();
    stopMenuWatch();
    pendingMenu = { threadId, previousMenu, expiresAt: now + 2000 };
    menuDefer = setTimeout(() => {
      menuDefer = 0;
      injectIntoNativeMenu();
    }, 0);
    menuObserver = new MutationObserver(() => injectIntoNativeMenu());
    if (document.body) menuObserver.observe(document.body, { childList: true, subtree: true });
    menuTimeout = setTimeout(stopMenuWatch, 2000);
  };

  // Fallback context menu only for unloaded FallbackRows (which lack a native ⋯ button).
  let fallbackMenu = null;
  const closeFallbackMenu = () => {
    fallbackMenu?.remove();
    fallbackMenu = null;
  };
  const openFallbackMenu = (threadId, x, y) => {
    closeFallbackMenu();
    const specs = pinMenuSpecFor(threadId);
    if (!specs.length) return;
    const menu = document.createElement('div');
    menu.id = 'fmess-pinned-fallback-menu';
    menu.setAttribute('role', 'menu');
    const signature = `${threadId}|${language}`;
    for (const spec of specs) {
      const item = buildMenuItem({ ...spec, run: () => (spec.run(), closeFallbackMenu()) }, threadId, signature);
      menu.append(item);
    }
    menu.style.left = `${Math.min(x, Math.max(8, window.innerWidth - 220))}px`;
    menu.style.top = `${Math.min(y, Math.max(8, window.innerHeight - 120))}px`;
    document.body.append(menu);
    fallbackMenu = menu;
  };

  if (!window.opener) {
    document.addEventListener(
      'mousedown',
      (event) => {
        if (fallbackMenu && event.target instanceof Node && !fallbackMenu.contains(event.target)) closeFallbackMenu();
        if (event.button !== 0 || !(event.target instanceof Element)) return;
        const btn = event.target.closest('[role="button"][aria-haspopup="menu"]');
        const row = btn?.closest(`[${LIST_PANE}] [role="row"], [role="navigation"] [role="grid"] [role="row"]`);
        if (row) noteThreadMenuOpen(row);
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;
        const btn = event.target.closest('[role="button"][aria-haspopup="menu"]');
        const row = btn?.closest(`[${LIST_PANE}] [role="row"], [role="navigation"] [role="grid"] [role="row"]`);
        if (row) noteThreadMenuOpen(row);
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'contextmenu',
      (event) => {
        if (!(event.target instanceof Element) || !onChatsPage()) return;
        const fallback = event.target.closest('.fmess-pinned-fallback');
        if (fallback) {
          const id = fallback.getAttribute('data-fmess-thread-id');
          if (id && !fallbackMenu) {
            event.preventDefault();
            openFallbackMenu(id, event.clientX, event.clientY);
          } else {
            closeFallbackMenu();
          }
          return;
        }
        const row = event.target.closest(`[${LIST_PANE}] [role="row"], [role="navigation"] [role="grid"] [role="row"]`);
        if (row) noteThreadMenuOpen(row);
      },
      true,
    );
    document.addEventListener('keydown', (event) => event.key === 'Escape' && closeFallbackMenu(), { capture: true, passive: true });
    window.addEventListener('blur', closeFallbackMenu, { passive: true });
  }

  // Scoped styles for pinned rows, badges, and injected native menu items.
  const pinnedStyle = document.createElement('style');
  pinnedStyle.id = 'fmess-pinned-style';
  pinnedStyle.textContent = `
    .fmess-pinned-chats { container-type: inline-size; }
    .fmess-pinned-row, .fmess-pinned-fallback { position: relative; }
    .fmess-pin-badge {
      position: absolute;
      top: 7px;
      inset-inline-end: 14px;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      pointer-events: auto;
      opacity: 0.85;
      transition: opacity 0.12s ease;
    }
    .fmess-pin-badge[data-fmess-pin-source="synced"] {
      color: var(--accent, #0866ff);
    }
    .fmess-pin-badge[data-fmess-pin-source="local"] {
      color: var(--secondary-icon, #65676b);
    }
    .fmess-pinned-row:hover .fmess-pin-badge,
    .fmess-pinned-fallback:hover .fmess-pin-badge { opacity: 1; }
    @container (max-width: 120px) {
      .fmess-pin-badge { top: 4px; inset-inline-end: 8px; }
      .fmess-pinned-fallback span { display: none; }
    }
    .fmess-pinned-fallback a {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 8px;
      padding: 8px;
      border-radius: 8px;
      color: var(--primary-text, #050505);
      text-decoration: none;
      font-size: 15px;
      line-height: 20px;
      font-weight: 500;
    }
    .fmess-pinned-fallback a:hover { background: var(--hover-overlay, rgba(0, 0, 0, 0.05)); }
    .fmess-pinned-fallback-avatar { flex: none; width: 56px; height: 56px; color: var(--secondary-icon, #65676b); }
    .fmess-pinned-fallback-avatar circle { fill: var(--secondary-button-background, rgba(127, 127, 127, 0.2)); }
    .fmess-pinned-fallback span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fmess-pin-menuitem {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0 8px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--primary-text, #050505);
      font-size: 15px;
      line-height: 20px;
      font-weight: 500;
      user-select: none;
    }
    .fmess-pin-menuitem:hover,
    .fmess-pin-menuitem:focus-visible {
      background: var(--hover-overlay, rgba(0, 0, 0, 0.05));
      outline: none;
    }
    .fmess-pin-menuitem-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      flex: none;
      color: var(--primary-icon, var(--primary-text, #050505));
    }
    #fmess-pinned-fallback-menu {
      position: fixed;
      z-index: 2147483000;
      min-width: 200px;
      padding: 6px 0;
      border-radius: 8px;
      background: var(--card-background, var(--surface-background, #fff));
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    }
  `;
  withRoot((root) => root.append(pinnedStyle));

  if (window.__fmessDebug) {
    window.__fmessPinned = {
      state: () => ({
        account: activePinnedAccount ?? currentPinnedAccount(),
        serverPinned: serverPinnedThreads,
        local: getAccountPins(),
        effective: pinnedSnapshot,
      }),
      pin: pinThread,
      unpin: unpinThread,
      move: movePinnedThread,
    };
  }

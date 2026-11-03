  // A theme can draw buttons on the chat list (the Zalo look's bar down its
  // left side) and list them in --fmess-buttons on the list: "name left top
  // size" each, comma-separated, a negative top counting from the bottom.
  // fMess lights the one under the pointer (--fmess-hover-left/-top and
  // data-fmess-hover="<name>" on the list, for a theme's label) and runs
  // those it knows: "account" opens the account menu, as the account button
  // does, and "settings" opens fMess's Settings.
  const themeButtonAt = (list, x, y) => {
    const box = list.getBoundingClientRect();
    for (const spec of IN_POPUP ? [] : getComputedStyle(list).getPropertyValue('--fmess-buttons').split(',')) {
      const [name, left, top, size] = spec.trim().replace(/"/g, '').split(/\s+/);
      if (!name || !(Number(size) > 0)) continue;
      const button = { name, left: box.left + Number(left), size: Number(size) };
      button.top = Number(top) < 0 ? box.bottom + Number(top) - button.size : box.top + Number(top);
      if (x >= button.left && x <= button.left + button.size && y >= button.top && y <= button.top + button.size) return button;
    }
    return null;
  };
  let hoveredList = null;
  document.addEventListener(
    'mousemove',
    (event) => {
      const list = event.target instanceof Element && event.target.closest('[role="navigation"]');
      const unlight = (el) => (el.style.removeProperty('--fmess-hover-top'), el.style.removeProperty('cursor'), el.removeAttribute('data-fmess-hover'));
      if (hoveredList && hoveredList !== list) unlight(hoveredList);
      hoveredList = list || null;
      if (!list) return;
      const button = themeButtonAt(list, event.clientX, event.clientY);
      if (!button) return unlight(list);
      const box = list.getBoundingClientRect();
      list.style.setProperty('--fmess-hover-left', `${button.left - box.left}px`);
      list.style.setProperty('--fmess-hover-top', `${button.top - box.top}px`);
      list.style.cursor = 'pointer';
      if (list.getAttribute('data-fmess-hover') !== button.name) list.setAttribute('data-fmess-hover', button.name);
    },
    { passive: true },
  );
  document.addEventListener(
    'click',
    (event) => {
      const list = event.target instanceof Element && event.target.closest('[role="navigation"]');
      const button = list && themeButtonAt(list, event.clientX, event.clientY);
      if (!button || !['account', 'settings'].includes(button.name)) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.name === 'settings') invoke('open_settings').catch(() => {});
      else invoke('show_account_menu', { name: currentAccount()?.name ?? '', x: button.left + button.size + 6, y: button.top }).catch(() => {});
    },
    true,
  );

  // The same for buttons a theme draws anywhere in the window (the Teams
  // look's "…" and picture at the right of its title bar): --fmess-window-
  // buttons on :root, "name left top size" in px from the window's top left,
  // a negative left counting from the right edge and a negative top from the
  // bottom (left = width + left - size). fMess lights the one under the
  // pointer (--fmess-window-hover-left/-top and data-fmess-window-hover on
  // :root) and runs "account" and "settings" as above; the account menu
  // opens under the button, kept inside the window (about 200px wide).
  // "sidebar" folds the theme's sidebar (the Teams look's app bar) away and
  // back: data-fmess-sidebar-collapsed on <html>, kept for next time, for
  // the theme to fold it. A press there doesn't drag the window, though the
  // title strip is under it.
  // The list is read again at most once a second, not on every move.
  const SIDEBAR_COLLAPSED = 'data-fmess-sidebar-collapsed';
  const SIDEBAR_COLLAPSED_KEY = 'fmess.sidebarCollapsed';
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') withRoot((root) => root.setAttribute(SIDEBAR_COLLAPSED, ''));
  } catch {}
  const toggleSidebar = () => {
    const collapsed = document.documentElement.toggleAttribute(SIDEBAR_COLLAPSED);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {}
  };
  let windowButtons = { at: 0, specs: [] };
  const windowButtonAt = (x, y) => {
    if (performance.now() - windowButtons.at > 1000) {
      const value = IN_POPUP ? '' : getComputedStyle(document.documentElement).getPropertyValue('--fmess-window-buttons');
      windowButtons = { at: performance.now(), specs: value.split(',').map((spec) => spec.trim().replace(/"/g, '').split(/\s+/)) };
    }
    for (const [name, left, top, size] of windowButtons.specs) {
      if (!name || !(Number(size) > 0)) continue;
      const button = { name, size: Number(size) };
      button.left = Number(left) < 0 ? innerWidth + Number(left) - button.size : Number(left);
      button.top = Number(top) < 0 ? innerHeight + Number(top) - button.size : Number(top);
      if (x >= button.left && x <= button.left + button.size && y >= button.top && y <= button.top + button.size) return button;
    }
    return null;
  };
  let litWindowButton = '';
  document.addEventListener(
    'mousemove',
    (event) => {
      const button = windowButtonAt(event.clientX, event.clientY);
      const lit = button ? `${button.left} ${button.top}` : '';
      if (lit === litWindowButton) return;
      litWindowButton = lit;
      const root = document.documentElement;
      if (!button) return (root.style.removeProperty('--fmess-window-hover-top'), root.style.removeProperty('cursor'), root.removeAttribute('data-fmess-window-hover'));
      root.style.setProperty('--fmess-window-hover-left', `${button.left}px`);
      root.style.setProperty('--fmess-window-hover-top', `${button.top}px`);
      root.setAttribute('data-fmess-window-hover', button.name);
      root.style.cursor = 'pointer';
    },
    { passive: true },
  );
  const onWindowButton = (event) => {
    const button = windowButtonAt(event.clientX, event.clientY);
    if (!button) return null;
    event.preventDefault();
    event.stopImmediatePropagation();
    return button;
  };
  // Before Tauri's drag strip sees them (it starts a drag on mousedown, and
  // maximizes on a double click's mouseup).
  window.addEventListener('mousedown', onWindowButton, true);
  window.addEventListener('mouseup', onWindowButton, true);
  window.addEventListener(
    'click',
    (event) => {
      const button = onWindowButton(event);
      if (button?.name === 'settings') invoke('open_settings').catch(() => {});
      else if (button?.name === 'sidebar') toggleSidebar();
      else if (button?.name === 'account') invoke('show_account_menu', { name: currentAccount()?.name ?? '', x: Math.max(0, Math.min(button.left, innerWidth - 200)), y: button.top + button.size + 4 }).catch(() => {});
    },
    true,
  );

  // A theme can also ask for a search box of its own (--fmess-search-box: 1
  // on :root; the Teams look's is in its title bar): a button that focuses
  // Messenger's search field, as ⌘K does, for the theme to show. It carries
  // the field's placeholder, so it reads in Facebook's language.
  const SEARCH_BOX = 'fmess-search-box';
  setInterval(() => {
    let box = document.getElementById(SEARCH_BOX);
    if (IN_POPUP || getComputedStyle(document.documentElement).getPropertyValue('--fmess-search-box').trim() !== '1') return box?.remove();
    if (!box) {
      box = document.createElement('div');
      box.id = SEARCH_BOX;
      box.setAttribute('role', 'button');
      box.tabIndex = 0;
      // Keeps the focus where it is until the click moves it to the field.
      box.addEventListener('mousedown', (event) => event.preventDefault());
      box.addEventListener('click', () => shortcuts.search());
      document.body.append(box);
    }
    const placeholder = document.querySelector('[role="navigation"] input[type="search"]')?.placeholder ?? '';
    if (box.textContent !== placeholder) box.textContent = placeholder;
  }, 500);
  // While Messenger's search field has the focus, <html> carries
  // data-fmess-searching, so a theme can show the field (and its results)
  // where its own box was.
  // data-fmess-search-results too while Messenger shows its results (a
  // listbox under the field), so the field and the results can be drawn as
  // one card.
  const SEARCHING = 'data-fmess-searching';
  const SEARCH_RESULTS = 'data-fmess-search-results';
  const isSearchField = (el) => el instanceof Element && el.matches('[role="navigation"] input[type="search"]');
  const resultsWatcher = new MutationObserver(() => {
    document.documentElement.toggleAttribute(SEARCH_RESULTS, Boolean(document.querySelector('ul[role="listbox"]')));
  });
  document.addEventListener('focusin', (event) => {
    if (!isSearchField(event.target)) return;
    document.documentElement.setAttribute(SEARCHING, '');
    resultsWatcher.observe(document.body, { childList: true, subtree: true });
  });
  document.addEventListener('focusout', (event) => {
    if (!isSearchField(event.target) || isSearchField(event.relatedTarget)) return;
    resultsWatcher.disconnect();
    document.documentElement.removeAttribute(SEARCHING);
    document.documentElement.removeAttribute(SEARCH_RESULTS);
  });

  // A theme can put quick reactions in a message's hover actions (the Teams
  // look's emoji row): --fmess-quick-reactions on :root, emoji as codepoints
  // ("1f44d 2764 1f606 1f62e"). fMess adds them first in the hovered
  // message's actions, in a .fmess-quick-reactions group of buttons
  // (.fmess-quick-reaction, data-emoji) holding Messenger's own picture of
  // the emoji, so themes that swap Messenger's emoji swap these too. A click
  // opens Messenger's reaction picker for that message (its react button,
  // found by its icon) and picks the same emoji there, which also takes the
  // reaction back if it is already yours; an emoji the picker doesn't show
  // just closes it.
  const REACT_ICON = 'M111 203a9.5';
  // Messenger's emoji URLs carry a checksum, so they are learnt from the
  // pictures it shows (its reaction picker has these six); one not seen yet
  // is written as text.
  const emojiPictures = new Map(
    Object.entries({ '1f44d': 't55', 2764: 'tf3', '1f606': 't2d', '1f62e': 't1a', '1f622': 't67', '1f621': 'te6' }).map(
      ([emoji, sum]) => [emoji, `https://static.xx.fbcdn.net/images/emoji.php/v9/${sum}/2/32/${emoji}.png`],
    ),
  );
  const emojiName = (text) => [...(text ?? '')].map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== 'fe0f').join('_');
  const learnEmoji = (root) => {
    for (const img of root.querySelectorAll('img[src*="/images/emoji.php/"]')) {
      const emoji = img.getAttribute('src').match(/\/([0-9a-f_]+)\.png/)?.[1];
      if (emoji) emojiPictures.set(emoji.replace(/_fe0f/g, ''), img.getAttribute('src'));
    }
  };
  let quickReactions = { at: 0, list: [] };
  const quickReactionList = () => {
    if (performance.now() - quickReactions.at > 1000) {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--fmess-quick-reactions');
      const list = value.trim().toLowerCase().split(/\s+/).filter((emoji) => /^[0-9a-f_]+$/.test(emoji));
      // Another theme (or none): the buttons added for the last one go.
      if (list.join() !== quickReactions.list.join()) for (const group of document.querySelectorAll('.fmess-quick-reactions')) group.remove();
      quickReactions = { at: performance.now(), list };
    }
    return quickReactions.list;
  };
  const reactButton = (row) =>
    [...row.querySelectorAll('[role="toolbar"] [role="button"]')].find((button) =>
      button.querySelector('svg path')?.getAttribute('d')?.startsWith(REACT_ICON),
    );
  const addQuickReactions = (row) => {
    const list = quickReactionList();
    const react = list.length && reactButton(row);
    if (!react) return;
    // The actions' own box: the react button's ancestor that holds the others too.
    let item = react;
    while (item.parentElement && item.parentElement.querySelectorAll('[role="button"]').length === 1) item = item.parentElement;
    const actions = item.parentElement;
    if (!actions || actions.querySelector(':scope > .fmess-quick-reactions')) return;
    learnEmoji(row);
    const group = document.createElement('div');
    group.className = 'fmess-quick-reactions';
    group.setAttribute('role', 'group');
    for (const emoji of list) {
      const button = document.createElement('div');
      button.className = 'fmess-quick-reaction';
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.dataset.emoji = emoji;
      const text = String.fromCodePoint(...emoji.split('_').map((c) => parseInt(c, 16)));
      button.setAttribute('aria-label', text);
      if (emojiPictures.has(emoji)) {
        const img = document.createElement('img');
        img.src = emojiPictures.get(emoji);
        img.alt = text;
        img.draggable = false;
        button.append(img);
      } else button.textContent = text;
      group.append(button);
    }
    actions.prepend(group);
  };
  document.addEventListener(
    'mouseover',
    (event) => {
      const row = event.target instanceof Element && event.target.closest('[role="main"] [data-scope="messages_table"]');
      if (!row || !quickReactionList().length) return;
      // The actions are drawn a moment after the pointer arrives.
      for (const ms of [0, 120, 400]) setTimeout(() => addQuickReactions(row), ms);
    },
    { capture: true, passive: true },
  );
  const pickReaction = async (row, emoji) => {
    reactButton(row)?.click();
    const picker = await waitFor(
      () => [...document.querySelectorAll('[role="menu"]')].find((menu) => menu.querySelector('[role="menuitemradio"] img[alt]')),
      1500,
    );
    if (!picker) return;
    learnEmoji(picker);
    const choice = [...picker.querySelectorAll('[role="menuitemradio"]')].find((option) => emojiName(option.querySelector('img')?.getAttribute('alt')) === emoji);
    if (choice) choice.click();
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  };
  // The buttons fMess adds (the search box, quick reactions) take Enter and
  // Space as buttons do.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const button = event.target instanceof Element && event.target.closest(`#fmess-search-box, .fmess-quick-reaction, #${NAV} :is([role="button"], [role="switch"])`);
      if (!button) return;
      event.preventDefault();
      button.click();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof Element && event.target.closest('.fmess-quick-reaction');
      const row = button?.closest('[data-scope="messages_table"]');
      if (!row) return;
      event.preventDefault();
      event.stopPropagation();
      pickReaction(row, button.dataset.emoji).catch(() => {});
      // The actions close once a reaction is picked, as Messenger's own do:
      // the row carries data-fmess-reacted until the pointer leaves it.
      row.setAttribute('data-fmess-reacted', '');
      row.addEventListener('mouseleave', () => row.removeAttribute('data-fmess-reacted'), { once: true });
    },
    true,
  );

  // Google Chat's nav, folded into a rail at the left that opens over the
  // page under the pointer: "New chat", then its sections, Direct messages
  // (people, most recent first) and Spaces (every group). A theme that sets
  // --fmess-nav: 1 on :root gets #fmess-nav (on <body>, outside Messenger's
  // page) to draw, made of copies of the chat list's rows, kept in step:
  //   .fmess-nav-new (role=button) opens Messenger's new message;
  //   .fmess-nav-section[data-section="shortcuts"|"people"|"spaces"], with
  //   data-collapsed while folded and data-unread (how many unread): a
  //   .fmess-nav-header (role=button, aria-expanded) that folds it, holding
  //   .fmess-nav-unread (role=switch, aria-checked): Chat's "Toggle unread
  //   filter", which leaves only the section's unread chats; then
  //   .fmess-nav-rows (copies of Messenger's rows, data-fmess-nav-chat=<id>,
  //   aria-current="page" on the open chat's link), then .fmess-nav-more
  //   (role=button, aria-expanded): "Show all", and back.
  // Shortcuts has no rows (Messenger has nothing like Chat's Home, Mentions
  // and Starred). People shows NAV_FOLDED.people, Spaces NAV_FOLDED.spaces,
  // plus any unread or open one; "Show all" shows them all. Folds are
  // remembered (by fMess). The rows are read under the All tab only, so
  // the Unread filter doesn't empty the nav.
  //
  // Every group: Messenger's list holds only recent chats; an older group
  // shows only under its Groups tab, which loads them a few at a time over
  // several seconds. So fMess opens the Groups tab once while the loading
  // screen is up (the third tab, by place: the labels are translated), keeps
  // a copy of each group's row and goes back to All. The copies are kept by
  // fMess, so later launches show them at once; they are made again
  // once a week, and a group's copy is renewed from its live row whenever it
  // has one. A copy loses its unread dot once Messenger's records say the
  // group is read.
  const NAV = 'fmess-nav';
  // Kept by fMess, not in localStorage (Facebook clears keys it doesn't
  // know): store.rs, window.__fmessStore.
  const pageStore = window.__fmessStore && typeof window.__fmessStore === 'object' ? window.__fmessStore : {};
  const storeSet = (key, value) => {
    pageStore[key] = value;
    invoke('set_page_store', { key, value }).catch(() => {});
  };
  const NAV_KEY = 'nav';
  const NAV_FOLDED = { people: 3, spaces: 10 };
  const SPACES_KEY = 'spaces';
  const SPACES_FRESH_MS = 7 * 24 * 3600e3;
  const spaces = { state: 'idle', at: 0, rows: new Map(), readAt: 0, savedAt: 0, renewedAt: 0 };
  const wantsSpaces = () => !IN_POPUP && getComputedStyle(document.documentElement).getPropertyValue('--fmess-nav').trim() === '1';
  const listTabs = () => [...document.querySelectorAll('[role="navigation"] [role="tablist"] + [role="tablist"] [role="tab"]')];
  const listRows = () => [...document.querySelectorAll('[role="navigation"] [role="grid"] [role="row"]')];
  const rowChatId = (row) => row.querySelector('a[href*="/t/"]')?.getAttribute('href')?.match(/\/t\/(\d+)/)?.[1] ?? null;
  const rowUnread = (row) => Boolean(row.querySelector('a [role="button"]:not([aria-haspopup])'));
  const spaceCopy = (row, id) => {
    const copy = row.cloneNode(true);
    // The row's menu and Messenger's marks don't work in a copy.
    for (const el of copy.querySelectorAll('[aria-haspopup], [id]')) el.remove();
    for (const el of [copy, ...copy.querySelectorAll('[data-fmess-ui], [aria-current]')]) {
      el.removeAttribute('data-fmess-ui');
      el.removeAttribute('aria-current');
    }
    copy.setAttribute('data-fmess-space', id);
    return copy;
  };
  const saveSpaces = () => storeSet(SPACES_KEY, { at: spaces.savedAt, rows: [...spaces.rows].map(([id, copy]) => [id, copy.outerHTML]) });
  // Copies from an earlier launch, when they are less than a week old.
  // (A load cut short keeps the earlier copies of groups it didn't reach.)
  const restoreSpaces = () => {
    try {
      const saved = pageStore[SPACES_KEY];
      if (!saved?.rows?.length || !(Date.now() - saved.at < SPACES_FRESH_MS)) return false;
      const template = document.createElement('template');
      spaces.rows.clear();
      for (const [id, html] of saved.rows) {
        template.innerHTML = html;
        const copy = template.content.firstElementChild;
        if (copy && /^\d+$/.test(id)) spaces.rows.set(id, copy);
      }
      spaces.savedAt = saved.at;
      spaces.state = 'done';
      return true;
    } catch {
      return false;
    }
  };
  // Asked by the loading screen: keep it up while the groups load.
  function spacesHolding() {
    if (window.opener || !onChatsPage() || !document.querySelector('[role="grid"] [role="row"]') || !wantsSpaces()) return false;
    if (spaces.state === 'idle' && !restoreSpaces()) loadSpaces();
    return spaces.state === 'loading' && Date.now() - spaces.at < 18000;
  }
  async function loadSpaces() {
    spaces.state = 'loading';
    spaces.at = Date.now();
    const selected = (tab) => tab?.getAttribute('aria-selected') === 'true';
    try {
      const tabs = await waitFor(() => {
        const found = listTabs();
        return found.length >= 3 && selected(found[0]) ? found : null;
      }, 5000);
      if (!tabs) throw new Error('no tabs');
      // The Groups tab comes back empty while Messenger is still loading the
      // list: wait until All's rows have stopped changing for a second.
      let lastAll = null;
      let steadyAll = 0;
      await waitFor(() => {
        const now = listRows().map(rowChatId).join();
        steadyAll = now && now === lastAll ? steadyAll + 1 : 0;
        lastAll = now;
        return steadyAll >= 10;
      }, 6000);
      const before = listRows().map(rowChatId).join();
      tabs[2].click();
      // The Groups tab's rows come a few at a time, seconds apart, and more
      // as the list is scrolled: scrolled to its end until they differ from
      // All's and stop changing for 3 s.
      let last = null;
      let steady = 0;
      await waitFor(() => {
        const rows = listRows();
        const now = rows.map(rowChatId).join();
        steady = now === last ? steady + 1 : 0;
        last = now;
        for (let el = rows.at(-1)?.parentElement; el && !el.matches('[role="navigation"]'); el = el.parentElement) {
          if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
            el.scrollTop = el.scrollHeight;
            break;
          }
        }
        return selected(listTabs()[2]) && now !== before && steady >= 30;
      }, 11000);
      if (selected(listTabs()[2])) {
        const fresh = new Map();
        for (const row of listRows()) {
          const id = rowChatId(row);
          if (id && !fresh.has(id)) fresh.set(id, spaceCopy(row, id));
        }
        // Cut short (it stops after 11 s): the groups it didn't reach keep
        // their earlier copies, after the ones it did.
        const complete = steady >= 30;
        if (!complete) for (const [id, copy] of spaces.rows) if (!fresh.has(id)) fresh.set(id, copy);
        // Nothing came: a failure, not "no groups" (kept for next launch).
        if (!fresh.size) throw new Error('no groups');
        spaces.rows = fresh;
        spaces.savedAt = Date.now();
        saveSpaces();
      }
      listTabs()[0]?.click();
      await waitFor(() => selected(listTabs()[0]), 2000);
      // The list was scrolled to its end: back to the top.
      for (let el = listRows()[0]?.parentElement; el && !el.matches('[role="navigation"]'); el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
          el.scrollTop = 0;
          break;
        }
      }
      spaces.state = 'done';
      spaces.readAt = 0;
      syncNav();
    } catch {
      spaces.state = 'failed';
      spaces.at = Date.now();
      if (listTabs()[0]?.getAttribute('aria-selected') !== 'true') listTabs()[0]?.click();
    }
  }
  // Read groups lose their copy's unread dot (the dot is the row's button
  // without a menu; themes style a row without it as read).
  async function markReadSpaces(copies) {
    try {
      const ReQL = window.require('ReQL');
      const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
      for (const copy of copies) {
        const dot = copy.querySelector('[role="button"]:not([aria-haspopup])');
        if (!dot) continue;
        const chat = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(int64Key(copy.getAttribute('data-fmess-space'))));
        if (chat && int64(chat.lastReadWatermarkTimestampMs) >= int64(chat.lastActivityTimestampMs)) dot.remove();
      }
    } catch {}
  }
  // The nav's own state: which sections are folded, which show all.
  // Shortcuts starts folded, as in Chat.
  const navState = (() => {
    const saved = pageStore[NAV_KEY];
    if (saved && typeof saved === 'object') return { collapsed: {}, expanded: {}, ...saved };
    return { collapsed: { shortcuts: true }, expanded: {} };
  })();
  const saveNav = () => storeSet(NAV_KEY, navState);
  const navButton = (className) => {
    const button = document.createElement('div');
    button.className = className;
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    return button;
  };
  const navSections = {};
  // The rows last read under the All tab: [{ id, row (live), copy (stored) }].
  let navPeople = [];
  let navGroups = [];
  const navCopies = new Map(); // id → { sig, copy } shown in the nav
  const buildNav = () => {
    const nav = document.createElement('nav');
    nav.id = NAV;
    nav.append(navButton('fmess-nav-new'));
    for (const name of ['shortcuts', 'people', 'spaces']) {
      const section = document.createElement('div');
      section.className = 'fmess-nav-section';
      section.setAttribute('data-section', name);
      const header = navButton('fmess-nav-header');
      if (name !== 'shortcuts') {
        const unread = document.createElement('div');
        unread.className = 'fmess-nav-unread';
        unread.setAttribute('role', 'switch');
        unread.tabIndex = 0;
        header.append(unread);
      }
      const rows = document.createElement('div');
      rows.className = 'fmess-nav-rows';
      const more = navButton('fmess-nav-more');
      section.append(header, rows);
      if (name !== 'shortcuts') section.append(more);
      navSections[name] = { section, header, rows, more };
      nav.append(section);
    }
    return nav;
  };
  // A copy of a row for the nav, made again only when the row changed.
  const navCopy = (id, row) => {
    const sig = `${row.textContent}|${rowUnread(row)}`;
    const known = navCopies.get(id);
    if (known?.sig === sig) return known.copy;
    const copy = spaceCopy(row, id);
    copy.removeAttribute('data-fmess-space');
    copy.setAttribute('data-fmess-nav-chat', id);
    navCopies.set(id, { sig, copy });
    return copy;
  };
  function syncNav() {
    let nav = document.getElementById(NAV);
    if (!wantsSpaces() || window.opener || !onChatsPage()) {
      document.getElementById(BACK)?.remove();
      leaveFullChat();
      return void nav?.remove();
    }
    // A failed load is tried again at the next launch (behind the loading
    // screen), not now, in sight.
    if (spaces.state === 'idle' && !restoreSpaces()) loadSpaces();
    if (!nav) {
      nav = buildNav();
      document.body.append(nav);
    }
    syncBack();
    // No chat open: nothing to fill the page with.
    if (!/\/t\//.test(location.pathname)) leaveFullChat();
    // Read the list under the All tab only (not while the Groups tab loads).
    const allTab = listTabs()[0];
    if (spaces.state !== 'loading' && (!allTab || allTab.getAttribute('aria-selected') === 'true')) {
      const items = [...document.querySelectorAll('[data-fmess-chats-list] > [data-fmess-chat]')];
      const rowOf = (item) => item.querySelector('[role="row"]');
      navPeople = items.filter((item) => item.getAttribute('data-fmess-chat') === 'person' && rowOf(item)).map((item) => ({ id: rowChatId(item), row: rowOf(item) }));
      navGroups = items.filter((item) => item.getAttribute('data-fmess-chat') === 'group' && rowOf(item)).map((item) => ({ id: rowChatId(item), row: rowOf(item) }));
      // A group's stored copy is renewed from its live row, once a minute.
      if (spaces.state === 'done' && Date.now() - spaces.renewedAt > 60000 && navGroups.length) {
        spaces.renewedAt = Date.now();
        for (const { id, row } of navGroups) if (id) spaces.rows.set(id, spaceCopy(row, id));
        saveSpaces();
      }
    }
    const live = new Set(navGroups.map((group) => group.id));
    const groups = [...navGroups, ...[...spaces.rows].filter(([id]) => !live.has(id)).map(([id, copy]) => ({ id, row: copy }))];
    const open = location.pathname.match(/\/t\/(\d+)/)?.[1];
    const fill = (name, chats) => {
      const { section, header, rows, more } = navSections[name];
      const expanded = Boolean(navState.expanded[name]);
      const unreadOnly = Boolean(navState.unread?.[name]);
      const pool = unreadOnly ? chats.filter((chat) => rowUnread(chat.row) || chat.id === open) : chats;
      const shown = expanded || unreadOnly ? pool : pool.filter((chat, i) => i < NAV_FOLDED[name] || chat.id === open || rowUnread(chat.row));
      header.querySelector('.fmess-nav-unread')?.setAttribute('aria-checked', String(unreadOnly));
      section.toggleAttribute('data-unread-only', unreadOnly);
      const copies = shown.filter((chat) => chat.id).map((chat) => navCopy(chat.id, chat.row));
      if (copies.length !== rows.childElementCount || copies.some((copy, i) => rows.children[i] !== copy)) rows.replaceChildren(...copies);
      for (const copy of copies) {
        const link = copy.querySelector('a[role="link"]');
        if (copy.getAttribute('data-fmess-nav-chat') === open) link?.setAttribute('aria-current', 'page');
        else link?.removeAttribute('aria-current');
      }
      more.hidden = unreadOnly || (!expanded && shown.length >= chats.length);
      more.setAttribute('aria-expanded', String(expanded));
      section.setAttribute('data-unread', String(chats.filter((chat) => rowUnread(chat.row)).length));
      section.toggleAttribute('data-collapsed', Boolean(navState.collapsed[name]));
      header.setAttribute('aria-expanded', String(!navState.collapsed[name]));
    };
    fill('people', navPeople);
    fill('spaces', groups);
    const shortcuts = navSections.shortcuts;
    shortcuts.section.toggleAttribute('data-collapsed', Boolean(navState.collapsed.shortcuts));
    shortcuts.header.setAttribute('aria-expanded', String(!navState.collapsed.shortcuts));
    if (spaces.state === 'done' && Date.now() - spaces.readAt > 5000) {
      spaces.readAt = Date.now();
      markReadSpaces([...spaces.rows.values()]);
    }
  }
  // As in Chat, a chat opened from the nav fills the page (data-fmess-
  // full-chat on <html>, with #fmess-back, Chat's "Go back", for the theme
  // to place); one opened from the list (Home) sits beside it. Going back
  // shows the list again, the chat beside it (Chat closes it, but Messenger
  // opens its newest chat on an empty page anyway).
  const FULL_CHAT = 'data-fmess-full-chat';
  const BACK = 'fmess-back';
  const syncBack = () => {
    let back = document.getElementById(BACK);
    if (!document.getElementById(NAV)) return void back?.remove();
    if (back) return;
    back = navButton('fmess-back');
    back.id = BACK;
    back.setAttribute('aria-label', say('Go back', 'Quay lại'));
    document.body.append(back);
  };
  const leaveFullChat = () => document.documentElement.removeAttribute(FULL_CHAT);
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(`#${BACK}`)) {
        event.preventDefault();
        event.stopPropagation();
        leaveFullChat();
        return;
      }
      // A chat picked in the list (not fMess's nav, which clicks the list's
      // links itself) goes back to the split view.
      if (event.isTrusted && event.target.closest('[role="navigation"] [role="grid"] a[href*="/t/"]')) leaveFullChat();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element && event.target.closest(`#${NAV} .fmess-nav-new, #${NAV} .fmess-nav-unread, #${NAV} .fmess-nav-header, #${NAV} .fmess-nav-more, #${NAV} a[href*="/t/"]`);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const name = target.closest('.fmess-nav-section')?.getAttribute('data-section');
      if (target.matches('.fmess-nav-new')) document.querySelector('[role="navigation"] a[href="/messages/new/"]')?.click();
      else if (target.matches('.fmess-nav-unread')) navState.unread = { ...navState.unread, [name]: !navState.unread?.[name] };
      else if (target.matches('.fmess-nav-header')) navState.collapsed[name] = !navState.collapsed[name];
      else if (target.matches('.fmess-nav-more')) navState.expanded[name] = !navState.expanded[name];
      else openChatInPage(target.getAttribute('href'), true);
      saveNav();
      setTimeout(syncNav, 50);
    },
    true,
  );

  // A theme can open chats in pop-ups, as Google Chat does
  // (--fmess-popups: 1 on :root). A chat row under the pointer, in the list
  // or in the nav (#fmess-nav), gets a button (.fmess-popup-open, put in
  // the row for the theme to place, or hide), and
  // a click opens the chat in #fmess-popups: one .fmess-popup[data-chat]
  // each, newest first, its .fmess-popup-head (.fmess-popup-picture with
  // --fmess-popup-picture, .fmess-popup-name, then .fmess-popup-minimize,
  // .fmess-popup-full and .fmess-popup-close) over the chat in a frame
  // (iframe[data-fmess-popup]), where this script runs in pop-up mode
  // (01-start.js: html[data-fmess-popup] there). data-minimized folds one to
  // its head; a click on the head unfolds it. Each pop-up is a whole
  // Messenger, so there are POPUP_MAX at most: the oldest goes.
  const POPUPS = 'fmess-popups';
  const POPUP_MAX = 3;
  // The settings fMess sent last (20-theme.js), for the pop-ups' pages: theirs
  // date from the window's start.
  let popupSettings = null;
  let popupWish = { at: 0, on: false };
  const wantsPopups = () => {
    if (IN_POPUP || window.opener) return false;
    if (performance.now() - popupWish.at > 1000) {
      const on = getComputedStyle(document.documentElement).getPropertyValue('--fmess-popups').trim() === '1';
      popupWish = { at: performance.now(), on };
    }
    return popupWish.on;
  };
  const popupFrames = () => [...document.querySelectorAll(`#${POPUPS} iframe[${POPUP}]`)];
  // In a pop-up Messenger lays out for a narrow window: the list alone, the
  // chat's panes (drawn all the same) hidden beside it, absolute, hidden
  // and 600px wide. fMess marks them (data-fmess-popup-pane) and shows them
  // in the pop-up's width; a theme hides the list.
  const POPUP_PANE = 'data-fmess-popup-pane';
  const popupStyle = document.createElement('style');
  popupStyle.textContent = `
    /* Hide Profile Pictures (Settings) covers the pop-ups' heads too. */
    html[${AVATARS_HIDDEN}] .fmess-popup-picture { --fmess-popup-picture: none !important; }
    html[${POPUP}] [${POPUP_PANE}] {
      position: relative !important;
      visibility: visible !important;
      flex: 1 1 auto !important;
      width: auto !important;
      min-width: 0 !important;
    }
  `;
  withRoot((root) => root.append(popupStyle));
  if (IN_POPUP) {
    setInterval(() => {
      const starts = [document.querySelector('[role="main"] [role="log"]'), document.querySelector('[role="main"] [role="textbox"]')];
      for (const start of starts) {
        for (let el = start?.parentElement; el && el !== document.body; el = el.parentElement) {
          if (el.hasAttribute(POPUP_PANE)) continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' && style.position === 'absolute') el.setAttribute(POPUP_PANE, '');
        }
      }
    }, 500);
  }
  // A chat in the page, as the nav opens one: the list's own link when the
  // chat has one (Messenger knows its kind), otherwise its address; full
  // fills the page when the theme has the nav.
  const openChatInPage = (href, full) => {
    if (full && document.getElementById(NAV)) document.documentElement.setAttribute(FULL_CHAT, '');
    const liveLink = [...document.querySelectorAll('[role="navigation"] [role="grid"] a[href*="/t/"]')].find((link) => link.getAttribute('href') === href);
    if (liveLink) liveLink.click();
    else {
      history.pushState(null, '', href);
      dispatchEvent(new PopStateEvent('popstate'));
    }
  };
  const popupButton = (className, label) => {
    const button = navButton(className);
    button.setAttribute('aria-label', label);
    button.title = label;
    return button;
  };
  // A chat's address, name and picture, from a row's link or the chat's
  // header.
  const chatOf = (root, href) => {
    const picture = root.querySelector('img');
    const image = root.querySelector('svg image');
    return {
      href,
      // The first words are the name (a hidden "Active now" can come before
      // them in a row's text).
      name: (root.querySelector('span[dir="auto"], h1, h2, h3')?.textContent || root.innerText.split('\n').find((line) => line.trim()) || '').trim(),
      src: picture?.getAttribute('src') || image?.getAttribute('href') || image?.getAttribute('xlink:href') || '',
    };
  };
  const openPopup = ({ href, name, src }) => {
    const id = href?.match(/\/t\/([^/?#]+)/)?.[1];
    if (!id) return;
    let box = document.getElementById(POPUPS);
    if (!box) {
      box = document.createElement('div');
      box.id = POPUPS;
      document.body.append(box);
    }
    // Moving a frame reloads it, so a pop-up already open stays where it is.
    const known = [...box.children].find((popup) => popup.getAttribute('data-chat') === id);
    if (known) {
      known.removeAttribute('data-minimized');
      return known.querySelector('iframe')?.contentWindow?.focus();
    }
    const popup = document.createElement('section');
    popup.className = 'fmess-popup';
    popup.setAttribute('data-chat', id);
    popup.setAttribute('data-href', href);
    popup.setAttribute('aria-label', name);
    const head = document.createElement('div');
    head.className = 'fmess-popup-head';
    const face = document.createElement('div');
    face.className = 'fmess-popup-picture';
    // The initial under the picture, for a theme to show without one.
    face.textContent = [...name][0] ?? '';
    if (src) face.style.setProperty('--fmess-popup-picture', `url("${src.replace(/["\\]/g, '\\$&')}")`);
    const title = document.createElement('div');
    title.className = 'fmess-popup-name';
    title.textContent = name;
    head.append(
      face,
      title,
      popupButton('fmess-popup-minimize', say('Minimize', 'Thu nhỏ')),
      popupButton('fmess-popup-full', say('Open in full screen', 'Mở toàn màn hình')),
      popupButton('fmess-popup-close', say('Close', 'Đóng')),
    );
    const frame = document.createElement('iframe');
    // Before it loads: the frame's page reads it at its start (01-start.js).
    frame.setAttribute(POPUP, '');
    frame.className = 'fmess-popup-frame';
    frame.title = name;
    frame.allow = 'microphone; camera; autoplay; clipboard-read; clipboard-write; fullscreen';
    frame.addEventListener('load', () => {
      try {
        if (popupSettings) frame.contentWindow?.__fmessApplySettings?.(popupSettings);
      } catch {}
    });
    frame.src = href;
    popup.append(head, frame);
    box.prepend(popup);
    const popups = [...box.children];
    for (const old of popups.slice(POPUP_MAX)) old.remove();
  };
  // The button joins a row when the pointer comes to it (rows come and go
  // as the list scrolls); it sits outside the row's link.
  document.addEventListener(
    'mouseover',
    (event) => {
      const row = event.target instanceof Element && event.target.closest(`[role="navigation"] [role="grid"] [role="row"], #${NAV} [data-fmess-nav-chat]`);
      if (!row || row.querySelector(':scope > .fmess-popup-open') || !row.querySelector('a[href*="/t/"]') || !wantsPopups()) return;
      row.append(popupButton('fmess-popup-open', say('Open in a pop-up', 'Mở trong cửa sổ bật lên')));
    },
    { passive: true },
  );
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const open = target?.closest('.fmess-popup-open');
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        const link = open.closest('[role="row"]')?.querySelector('a[href*="/t/"]');
        if (link) openPopup(chatOf(link, link.getAttribute('href')));
        return;
      }
      if (target?.closest('.fmess-popup-current')) {
        event.preventDefault();
        event.stopPropagation();
        const header = document.querySelector('[role="main"] [data-fmess-ui="chat-header"]');
        if (!header || !/\/t\//.test(location.pathname)) return;
        // Out of the page, into a pop-up, as Chat does (the page shows the
        // list again; Messenger keeps the chat open beside it).
        leaveFullChat();
        openPopup(chatOf(header, location.pathname));
        return;
      }
      const popup = target?.closest(`#${POPUPS} > .fmess-popup`);
      if (!popup || !target.closest('.fmess-popup-head')) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.closest('.fmess-popup-close')) popup.remove();
      else if (target.closest('.fmess-popup-full')) {
        openChatInPage(popup.getAttribute('data-href'), true);
        popup.remove();
      } else popup.toggleAttribute('data-minimized');
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof Element)) return;
    if (!event.target.matches('.fmess-popup-open, .fmess-popup-current, .fmess-popup-head > [role="button"]')) return;
    event.preventDefault();
    event.target.click();
  });
  // The open chat's header gets one too (.fmess-popup-current), after the
  // chat's name, as Chat's. Another theme (or none): the pop-ups and the
  // buttons go.
  setInterval(() => {
    if (IN_POPUP) return;
    if (wantsPopups()) {
      const header = document.querySelector('[role="main"] [data-fmess-ui="chat-header"]');
      if (!header || header.querySelector('.fmess-popup-current')) return;
      // A person's name is a link; a group's a heading.
      const name = header.querySelector('a[role="link"]') ?? header.querySelector('h1, h2, h3');
      name?.after(popupButton('fmess-popup-current', say('Open in a pop-up', 'Mở trong cửa sổ bật lên')));
      return;
    }
    document.getElementById(POPUPS)?.remove();
    for (const button of document.querySelectorAll('.fmess-popup-open, .fmess-popup-current')) button.remove();
  }, 1000);

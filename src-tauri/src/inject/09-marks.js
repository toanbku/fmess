  // Marks for themes that don't depend on the language. Facebook translates
  // its aria-labels (a Vietnamese Facebook says "Tìm kiếm", not "Search"), so
  // a theme that only matched them worked in English. fMess marks the parts
  // themes style with data-fmess-ui, found by where they are and by their
  // icons: composer (the message box) and in it voice-clip, attach, sticker,
  // gif, more-actions (any other button there), emoji, like and send, and
  // while recording a voice clip voice-bar, voice-play and voice-cancel;
  // chat-header and in it audio-call, video-call and info (which shows the
  // details); details; list-menu (⋯ above the chat list); reactions (the
  // reaction picker) and in it more-emojis.
  const UI = 'data-fmess-ui';
  // The start of the path each icon begins with.
  const COMPOSER_ICONS = [
    ['M102 926.75 102 929', 'voice-clip'],
    ['M99.825 918.322', 'attach'],
    ['M106.617 923.049', 'sticker'],
    ['M460.25 1079a', 'gif'],
    ['M210.5,405 C209.121', 'emoji'],
    // Facebook's redrawn 16px icons (seen 2026-11-03), beside the older ones.
    ['M8 .5A3.5 3.5 0 0 0', 'voice-clip'],
    ['M7 4.25a1.25 1.25 0', 'attach'],
    ['M8.305 1h-.61c', 'sticker'],
    ['M7.695 1h.61c', 'gif'],
  ];
  // Messenger's own like button, a thumbs-up (a chat's own one is an emoji picture).
  const THUMBS_UP = 'M16,9.1c';
  const mark = (el, name) => {
    if (el && el.getAttribute(UI) !== name) el.setAttribute(UI, name);
  };
  const markComposer = (composer) => {
    mark(composer, 'composer');
    // The bar above the box while replying, or with a link's preview.
    mark(composer.previousElementSibling, 'composer-bar');
    const field = [...composer.children].find((child) => child.querySelector('[role="textbox"]'));
    // The span holds the like button, or send once there is text (or a
    // voice clip). It is the last part, except while recording, when the
    // cancel button comes after it.
    const tail = [...composer.children].findLast((child) => child.tagName === 'SPAN');
    // Recording a voice clip: the field is hidden and a bar with the clip's
    // timer, its stop (then play/pause) button and its scrubber takes its place.
    const bar = composer.querySelector('[role="timer"]')?.closest('[role="region"] > *');
    if (bar && bar !== tail) mark(bar, 'voice-bar');
    for (const button of composer.querySelectorAll('[role="button"]')) {
      const path = button.querySelector('svg path')?.getAttribute('d') ?? '';
      const icon = COMPOSER_ICONS.find(([start]) => path.startsWith(start))?.[1];
      const like = button.querySelector('img') || path.startsWith(THUMBS_UP);
      if (icon) mark(button, icon);
      else if (tail?.contains(button)) mark(button, like ? 'like' : 'send');
      else if (bar?.contains(button)) mark(button, 'voice-play');
      else if (bar) mark(button, 'voice-cancel');
      else if (!field?.contains(button)) mark(button, 'more-actions');
    }
  };
  let markedInfo = null;
  function markUi(main, list, log, details) {
    const composer = main?.querySelector('[role="textbox"][contenteditable="true"]')?.closest('[role="region"]');
    if (composer) markComposer(composer);
    mark(details, 'details');
    mark(list?.querySelector('[role="button"][aria-haspopup="menu"]:not([role="grid"] *)'), 'list-menu');
    // The header's button with aria-expanded opens the details; the calls are
    // the two buttons before it on the same line.
    if (log && !(markedInfo?.isConnected && main.contains(markedInfo))) {
      const info = [...main.querySelectorAll('[role="button"][aria-expanded]')].find(
        (button) => !log.contains(button) && !composer?.contains(button) && !details?.contains(button),
      );
      if (info) {
        markedInfo = info;
        mark(info, 'info');
        let header = info;
        while (header.parentElement && !header.parentElement.contains(log)) header = header.parentElement;
        mark(header, 'chat-header');
        const buttons = [...header.querySelectorAll('[role="button"]')];
        const top = info.getBoundingClientRect().top;
        const calls = buttons
          .slice(0, buttons.indexOf(info))
          .filter((button) => button.querySelector('svg') && Math.abs(button.getBoundingClientRect().top - top) < 8)
          .slice(-2);
        if (calls.length === 2) {
          mark(calls[0], 'audio-call');
          mark(calls[1], 'video-call');
        }
      }
    }
    markReactions();
    markChatKinds(list);
  }
  // Which chats are with one person and which are groups (Google Chat lists
  // them apart, as "Direct messages" and "Spaces"), from Messenger's own
  // record of each chat. Each item of the chat list is marked
  // data-fmess-chat="person", "group", or "other" (Marketplace, the loading
  // row), and the list holding them data-fmess-chats-list, with
  // data-fmess-has-people and data-fmess-has-groups while it has some. The
  // items are the list's children, so a theme can reorder them (flex order).
  // The nav a theme can ask for is built from them (17-theme-hooks, syncNav).
  const CHAT_KIND = 'data-fmess-chat';
  const chatKinds = new Map(); // chat id → 'person' | 'group'
  const kindsAsked = new Set();
  let kindsList = null;
  const kindsWatcher = new MutationObserver(() => markChatKinds());
  const chatIdOf = (item) => item.querySelector('[role="row"] a[href*="/t/"]')?.getAttribute('href')?.match(/\/t\/(\d+)/)?.[1] ?? null;
  async function askChatKinds(ids) {
    for (const id of ids) kindsAsked.add(id);
    try {
      await loadModules(['ReQL', 'LSDatabaseSingleton', 'LSMessagingThreadTypeUtil']);
      const ReQL = window.require('ReQL');
      const util = window.require('LSMessagingThreadTypeUtil');
      const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
      await Promise.all(
        ids.map(async (id) => {
          const chat = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(int64Key(id)));
          if (chat) chatKinds.set(id, util.isGroup(chat.threadType) ? 'group' : 'person');
          // Not loaded yet: asked again on a later pass.
          else kindsAsked.delete(id);
        }),
      );
    } catch {
      for (const id of ids) kindsAsked.delete(id);
      return;
    }
    markChatKinds();
  }
  function markChatKinds(list) {
    const row = (list ?? document.querySelector('[data-fmess-list]'))?.querySelector('[role="grid"] [role="row"]');
    if (!row) return;
    // The list is the rows' nearest ancestor with more than one child; each
    // row sits alone in a few wrappers under it.
    let item = row;
    while (item.parentElement && item.parentElement.childElementCount === 1 && item.parentElement.getAttribute('role') !== 'grid') item = item.parentElement;
    const chats = item.parentElement;
    if (!chats || chats.getAttribute('role') === 'grid') return;
    if (chats !== kindsList) {
      kindsList?.removeAttribute('data-fmess-chats-list');
      kindsWatcher.disconnect();
      kindsWatcher.observe(chats, { childList: true });
      chats.setAttribute('data-fmess-chats-list', '');
      kindsList = chats;
    }
    const ask = [];
    let people = false;
    let groups = false;
    for (const child of chats.children) {
      const id = chatIdOf(child);
      if (id && !chatKinds.has(id) && !kindsAsked.has(id)) ask.push(id);
      const kind = id ? chatKinds.get(id) ?? 'person' : 'other';
      if (child.getAttribute(CHAT_KIND) !== kind) child.setAttribute(CHAT_KIND, kind);
      people ||= kind === 'person';
      groups ||= kind === 'group';
    }
    chats.toggleAttribute('data-fmess-has-people', people);
    chats.toggleAttribute('data-fmess-has-groups', groups);
    if (ask.length) askChatKinds(ask);
    syncNav();
  }
  // The picker is opened by a click and lives outside the chat.
  function markReactions() {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!menu.querySelector('[role="menuitemradio"] img[alt]')) continue;
      mark(menu, 'reactions');
      mark(menu.querySelector('[role="button"]'), 'more-emojis');
    }
  }
  // Typing turns the like button into send.
  let typedFrame = 0;
  document.addEventListener(
    'input',
    (event) => {
      const composer = event.target instanceof Element && event.target.closest(`[${UI}="composer"]`);
      if (composer) typedFrame ||= requestAnimationFrame(() => ((typedFrame = 0), markComposer(composer)));
    },
    { capture: true, passive: true },
  );


// Checks how chats look in the running app, across kinds of chat, fMess's
// looks and light/dark, and takes a picture of each. Run it with
// tests/app/chat-check.sh, which fills in OUT and THEMES and reads the result.
// It is a probe (FMESS_PROBE, debug builds): the body of an async function.
//
// It changes nothing that stays: it opens chats that are already read, puts
// each look's CSS in the page for a moment, switches Messenger's dark mode
// (Facebook's setting) and back, and puts everything as it was. It clicks
// nothing else.
const OUT = __OUT__;
const THEMES = __THEMES__;
const MAX_CHATS = __MAX_CHATS__;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const main = () => document.querySelector('[role="main"]');
const result = { chats: [], failures: [], notes: [] };

// Colours ------------------------------------------------------------------
const parseColours = (value) =>
  [...String(value).matchAll(/rgba?\(([^)]+)\)/g)].map((m) => {
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  });

// The chats to look at -------------------------------------------------------
const loadModules = (names) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000);
    window.require('Bootloader').loadModules(names, () => (clearTimeout(timer), resolve()), 'fmess-check');
  });
await loadModules(['ReQL', 'LSDatabaseSingleton', 'MWPIsThreadUnread', 'LSMessagingThreadTypeUtil']);
const ReQL = window.require('ReQL');
const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
const { isThreadUnreadForViewer } = window.require('MWPIsThreadUnread');
const { isGroup } = window.require('LSMessagingThreadTypeUtil');
const key = (id) => [Number(BigInt(id) >> 32n), Number(BigInt(id) & 0xffffffffn)];
const candidates = [];
for (const link of document.querySelectorAll('[role="navigation"] a[href*="/t/"], a[href*="/messages/"][href*="/t/"]')) {
  const id = link.getAttribute('href').match(/\/t\/(\d+)/)?.[1];
  if (!id || candidates.some((c) => c.id === id)) continue;
  const thread = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(key(id)));
  if (!thread) continue;
  // An unread chat would be marked read by opening it.
  if (isThreadUnreadForViewer(thread)) continue;
  candidates.push({ id, link, e2ee: link.getAttribute('href').includes('/e2ee/'), group: Boolean(isGroup(thread.threadType)) });
}

// Messenger's chat theme, once a chat is open: a gradient, a colour of its
// own, or the default.
const chatTheme = () => {
  const box = main()?.querySelector('[style*="--chat-outgoing-message-background-gradient"], [style*="--chat-outgoing-message-bubble-background-color"]');
  if (!box) return 'default';
  const gradient = box.style.getPropertyValue('--chat-outgoing-message-background-gradient').trim();
  if (gradient && !/initial|none/.test(gradient)) return 'gradient';
  const colour = box.style.getPropertyValue('--chat-outgoing-message-bubble-background-color').trim().toLowerCase();
  return colour && !['#0866ff', '#0099ff', '#0084ff'].includes(colour) ? 'colour' : 'default';
};
const openChat = async (candidate) => {
  candidate.link.click();
  // Encrypted chats can take a while to decrypt their messages.
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    if (location.pathname.includes(candidate.id) && main()?.querySelector('[data-message-id] [dir="auto"]')) break;
  }
  await sleep(2500);
};

// Pick one chat for each kind and chat theme found, up to MAX_CHATS.
const picked = [];
const seen = new Set();
for (const candidate of candidates) {
  if (picked.length >= MAX_CHATS) break;
  const kind = candidate.group ? 'group' : candidate.e2ee ? 'e2ee' : 'normal';
  // Open only chats whose kind could still add something new.
  if ([...seen].filter((k) => k.startsWith(kind + '/')).length >= 3) continue;
  await openChat(candidate);
  const theme = chatTheme();
  const label = `${kind}/${theme}`;
  if (seen.has(label)) continue;
  seen.add(label);
  picked.push({ ...candidate, kind, theme, label });
}
for (const kind of ['e2ee', 'normal', 'group']) {
  if (![...seen].some((k) => k.startsWith(kind + '/'))) result.notes.push(`no read ${kind} chat in the list to check`);
}
for (const theme of ['default', 'gradient', 'colour']) {
  if (![...seen].some((k) => k.endsWith('/' + theme))) result.notes.push(`no chat with a ${theme} Messenger theme found`);
}

// Looks and modes ------------------------------------------------------------
const themeStyle = () => document.getElementById('fmess-theme');
const userTheme = themeStyle()?.textContent ?? null;
const setLook = (css) => {
  let style = themeStyle();
  if (css == null) return style?.remove();
  if (!style) {
    style = document.createElement('style');
    style.id = 'fmess-theme';
    document.documentElement.append(style);
  }
  style.textContent = css;
};
// Light and dark: Messenger's own setting (the one fMess's Settings change),
// so the whole page, inline colours included, follows; changing classes alone
// left it half light, half dark. It is Facebook's setting, so it is changed
// once per mode and put back as it was at the end.
await loadModules(['CometDarkMode']);
const darkMode = window.require('CometDarkMode');
const startedWith = darkMode.getDarkModeSetting?.();
const setMode = async (mode) => {
  const value = mode === 'dark' ? 'ENABLED' : 'DISABLED';
  if (window.__fmessSetDarkMode) window.__fmessSetDarkMode(value);
  else darkMode.saveDarkModeSetting(value, { onRevert() {} });
  await sleep(1500);
};

// The checks -----------------------------------------------------------------
// An emoji drawn as a picture: its alt text is the emoji (a profile picture's
// is a name).
const isEmoji = (img) => /\p{Extended_Pictographic}/u.test(img.alt || '') && !/[\p{L}\p{N}]{2}/u.test(img.alt);
const onlyEmoji = (el) => { const text = el.textContent.replace(/\s/g, ''); return text.length > 0 && /^[\p{Extended_Pictographic}\u200d\ufe0f\p{Emoji_Modifier}]+$/u.test(text) && !el.querySelector('img:not([alt])'); };
const visible = (el) => {
  const r = el.getBoundingClientRect();
  const m = main().getBoundingClientRect();
  return r.width > 8 && r.height > 8 && r.top > m.top + 60 && r.bottom < m.bottom - 80;
};
// A bubble: the nearest element in the message that paints one (a colour,
// a picture, or the thick outline of a see-through bubble) with rounded
// corners; failing that, the nearest with rounded corners and padding (a
// theme may paint bubbles with a pseudo-element). Names above messages,
// "You replied to…" and "Sent" have neither.
const radiusOf = (st) => Math.max(...[st.borderTopLeftRadius, st.borderTopRightRadius, st.borderBottomLeftRadius, st.borderBottomRightRadius].map(parseFloat));
const bubbleOf = (el) => {
  const message = el.closest('[data-message-id]');
  let padded = null;
  for (let e = el.parentElement; e && message?.contains(e); e = e.parentElement) {
    const st = getComputedStyle(e);
    const radius = radiusOf(st);
    const painted = (parseColours(st.backgroundColor)[0]?.a ?? 0) > 0.05 || st.backgroundImage !== 'none' || (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 4);
    if (painted && radius >= 4) return e;
    if (!padded && radius >= 6 && parseFloat(st.paddingLeft) >= 6 && parseFloat(st.paddingTop) >= 3) padded = e;
  }
  return padded;
};
// What a check gives back: points to read in the picture taken right after
// (inside a bubble's padding, just outside it, under a quote, beside an emoji),
// with the colours they are compared to. The pixels are read by
// chat-check.sh: elementsFromPoint misses what pseudo-elements and pictures
// paint (theme wallpapers, some bubbles), and pixels are what people see.
const rgb = (value) => parseColours(value)[0] ?? null;
const faded = (el, until) => {
  let opacity = 1;
  for (let e = el; e && e !== until.parentElement; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
  return opacity < 0.95 || (rgb(getComputedStyle(el).color)?.a ?? 1) < 0.95;
};
const check = () => {
  const out = { viewport: [innerWidth, innerHeight], bubbles: [], quotes: [], icons: [], containerGradient: false };
  const m = main();
  const middle = m.getBoundingClientRect().left + m.getBoundingClientRect().width / 2;
  const box = m.querySelector('[style*="background-image"][style*="--chat-outgoing-message-background-gradient"]');
  out.containerGradient = Boolean(box && getComputedStyle(box).backgroundImage !== 'none');
  // Text in bubbles only: not a link's card (a shared post) or the message a
  // reply quotes (a button), which Messenger dims on purpose.
  const texts = [...m.querySelectorAll('[data-message-id] [dir="auto"]')].filter((t) => t.textContent.trim().length > 1 && visible(t) && !t.closest('blockquote, a[href], [role="button"]') && !t.querySelector('[dir="auto"], blockquote') && !onlyEmoji(t));
  for (const text of texts.slice(-12)) {
    const bubble = bubbleOf(text);
    if (!bubble) continue;
    const b = bubble.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const own = mr.right - b.right < b.left - mr.left;
    const st = getComputedStyle(bubble);
    // Right beside the text (before it, or just above it), inside the bubble:
    // what the words are read on.
    const t = text.getBoundingClientRect();
    const inside = t.left - b.left >= 5 ? [Math.round(t.left - 3), Math.round(t.top + t.height / 2)]
      : t.top - b.top >= 4 ? [Math.round(t.left + Math.min(t.width / 2, 20)), Math.round(t.top - 2)]
      : [Math.round(b.left + b.width / 2), Math.round(b.top + 2)];
    // Something over the bubble there (the pinned message, a theme's card
    // under the pointer): nothing to read.
    const top = document.elementFromPoint(...inside);
    if (!top || !bubble.contains(top)) continue;
    // Messenger draws some bubbles see-through on purpose: a bubble with no
    // colour at all is a window onto the chat's own background (gradient
    // themes), and is checked.
    const alpha = rgb(st.backgroundColor)?.a ?? 0;
    // A bubble drawn as a thin border on nothing (an unsent message): no
    // fill to compare. (It has the thick outline of a see-through window
    // too; a window has no border.)
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(st[`border${side}Width`]) > 0 && (rgb(st[`border${side}Color`])?.a ?? 0) > 0.05) || st.boxShadow !== 'none';
    if (alpha <= 0.05 && st.backgroundImage === 'none' && bordered) continue;
    out.bubbles.push({
      who: own ? 'own' : 'theirs',
      words: text.textContent.trim().slice(0, 24),
      faded: faded(text, bubble.closest('[data-message-id]')) || (alpha > 0.05 && alpha < 0.9),
      text: rgb(getComputedStyle(text).color),
      inside,
      // A few points out: a theme's wallpaper (WhatsApp's doodles) can match
      // the bubble at one of them.
      outside: [10, 17, 24].map((d) => [Math.round(own ? b.left - d : b.right + d), Math.round(b.top + b.height / 2)]),
    });
  }
  for (const quote of [...m.querySelectorAll('[data-message-id] blockquote')].filter(visible).slice(-4)) {
    const q = quote.getBoundingClientRect();
    const under = [Math.round(q.left + 7), Math.round(q.top + Math.min(10, q.height / 2))];
    // Under the pinned message, say: nothing to read.
    if (!quote.contains(document.elementFromPoint(...under))) continue;
    out.quotes.push({
      text: rgb(getComputedStyle(quote.lastElementChild).color),
      bar: rgb(getComputedStyle(quote.firstElementChild).backgroundColor),
      // Between the bar and the text.
      under,
    });
  }
  // Emoji-only messages ("icons"), as pictures or as big text, have no
  // bubble: beside the emoji is the chat's own background, as further out.
  const iconParts = [];
  for (const msg of [...m.querySelectorAll('[data-message-id]')].filter(visible)) {
    const pics = [...msg.querySelectorAll('img')].filter((img) => isEmoji(img) && img.getBoundingClientRect().width >= 28 && img.getBoundingClientRect().width <= 140);
    const words = [...msg.querySelectorAll('[dir="auto"]')].filter((t) => t.textContent.trim() && !t.querySelector('[dir="auto"]'));
    if (pics.length && !words.length) iconParts.push(pics[0]);
    else if (words.length === 1 && onlyEmoji(words[0])) iconParts.push(words[0]);
  }
  for (const part of iconParts.slice(-3)) {
    const r = part.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    // On the side away from the senders' pictures: the chat's middle.
    const toward = mr.right - r.right < r.left - mr.left ? -1 : 1;
    const x = toward < 0 ? r.left : r.right;
    out.icons.push({ alt: part.alt || part.textContent.trim(), beside: [Math.round(x + toward * 5), Math.round(r.top + r.height / 2)], further: [30, 40, 50].map((d) => [Math.round(x + toward * d), Math.round(r.top + r.height / 2)]) });
  }
  return out;
};

// Where to look in a chat: a screen with text bubbles and, if one can be
// found within 8 screens back, a quote or an emoji-only message, so those are
// checked too. Otherwise the latest messages.
const scroller = () => { const m = main()?.querySelector('[data-message-id]'); for (let e = m; e; e = e.parentElement) { const st = getComputedStyle(e); if (/(auto|scroll)/.test(st.overflowY) && e.scrollHeight > e.clientHeight) return e; } return null; };
const screenHas = () => {
  const m = main();
  const texts = [...m.querySelectorAll('[data-message-id] [dir="auto"]')].filter((t) => t.textContent.trim().length > 1 && visible(t) && !t.closest('blockquote, a[href], [role="button"]')).length;
  const quote = [...m.querySelectorAll('[data-message-id] blockquote')].some(visible);
  const icon = [...m.querySelectorAll('[data-message-id]')].some((msg) => { if (!visible(msg)) return false; const words = [...msg.querySelectorAll('[dir="auto"]')].filter((t) => t.textContent.trim() && !t.querySelector('[dir="auto"]')); return words.length ? words.length === 1 && onlyEmoji(words[0]) : [...msg.querySelectorAll('img')].some((img) => isEmoji(img) && img.getBoundingClientRect().width >= 28); });
  return { texts, quote, icon };
};
const positionChat = async () => {
  const sc = scroller();
  if (!sc) return screenHas();
  let here = screenHas();
  if (here.texts && (here.quote || here.icon)) return here;
  const bottom = sc.scrollTop;
  for (let i = 0; i < 8; i++) {
    sc.scrollTop -= sc.clientHeight * 0.8;
    await sleep(800);
    const at = screenHas();
    if (at.texts && (at.quote || at.icon)) return at;
  }
  sc.scrollTop = bottom;
  await sleep(800);
  here = screenHas();
  // No text in the latest screen (photos, links): the first screen back with some.
  for (let i = 0; i < 6 && !here.texts; i++) {
    sc.scrollTop -= sc.clientHeight * 0.8;
    await sleep(800);
    here = screenHas();
  }
  return here;
};

// Toasts ---------------------------------------------------------------------
// Facebook draws its toasts ("All chats loaded.", "Link copied") the other way
// round from the page: dark on a light page, light on a dark one. A theme's
// colours for the page leaked into them: white text on a white toast.
let pushToast = null;
const toastCard = (el) => {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (parseColours(getComputedStyle(e).backgroundColor)[0]?.a > 0.5) return e;
  }
  return null;
};
const checkToast = async () => {
  if (!pushToast) {
    await loadModules(['cometPushToast']);
    pushToast = window.require('cometPushToast').cometPushToast;
  }
  let node = null;
  let text = '';
  // Facebook can hold a toast back (one already showing, a busy page): again.
  for (let attempt = 0; attempt < 3 && !node; attempt++) {
    text = `fMess check toast ${Date.now() % 100000}`;
    pushToast({ message: text }, 4000);
    for (let i = 0; i < 30 && !node; i++) {
      await sleep(150);
      node = [...document.querySelectorAll('span, div')].find((e) => e.childElementCount === 0 && e.textContent === text);
    }
    if (!node) await sleep(2000);
  }
  if (!node) return { missing: { focused: document.hasFocus(), visibility: document.visibilityState } };
  await sleep(500); // it slides in
  const r = node.getBoundingClientRect();
  const card = toastCard(node);
  let inside = [r.right + 6, r.top + r.height / 2];
  const at = document.elementFromPoint(...inside);
  if (card && !(at && card.contains(at))) inside = [r.left + r.width / 2, Math.min(r.bottom + 4, card.getBoundingClientRect().bottom - 3)];
  // Its close button: the middle of the cross against the button's face just
  // inside its top edge.
  const close = card && [...card.querySelectorAll('[role="button"], button')].pop();
  const buttons = [];
  if (close) {
    const b = close.getBoundingClientRect();
    buttons.push({ cross: [b.left + b.width / 2, b.top + b.height / 2], face: [b.left + b.width / 2, b.top + Math.min(4, b.height / 4)] });
  }
  return { viewport: [innerWidth, innerHeight], bubbles: [], quotes: [], icons: [], containerGradient: false, toasts: [{ text: rgb(getComputedStyle(node).color), inside, where: text, buttons }] };
};

// Run ------------------------------------------------------------------------
const snapshot = async (file) => {
  window.__fmessSnapshotDone = null;
  window.__fmessSnapshotRequest = `${OUT}/${file}`;
  for (let i = 0; i < 40 && window.__fmessSnapshotDone !== `${OUT}/${file}`; i++) await sleep(250);
};
const entries = new Map(picked.map((chat) => [chat.label, { label: chat.label, e2ee: chat.e2ee, group: chat.group, theme: chat.theme, runs: [] }]));
const toasts = { label: 'toast', toast: true, runs: [], missing: [] };
try {
  for (const mode of ['light', 'dark']) {
    await setMode(mode);
    for (const chat of picked) {
      await openChat(chat);
      let has = await positionChat();
      if (!has.texts) {
        await sleep(6000);
        has = await positionChat();
      }
      entries.get(chat.label).has = has;
      for (const [look, css] of Object.entries(THEMES)) {
        setLook(css);
        await sleep(600);
        const file = `${chat.label.replace('/', '-')}-${look}-${mode}.png`;
        // The points must match the picture: Messenger can still be moving
        // the messages (older ones coming in), so check, take the picture,
        // check again, and go again if anything moved.
        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
          res = check();
          await snapshot(file);
          if (JSON.stringify(check()) === JSON.stringify(res)) break;
          res.moved = true;
          await sleep(1200);
        }
        entries.get(chat.label).runs.push({ look, mode, file, ...res });
      }
      setLook(userTheme);
    }
    for (const [look, css] of Object.entries(THEMES)) {
      setLook(css);
      await sleep(400);
      const file = `toast-${look}-${mode}.png`;
      const res = await checkToast().catch((error) => ({ missing: String(error) }));
      if (res.missing) {
        toasts.missing.push({ look, mode, why: res.missing });
      } else {
        await snapshot(file);
        toasts.runs.push({ look, mode, file, ...res });
      }
      await sleep(4000); // until it's gone
    }
    setLook(userTheme);
  }
} finally {
  setLook(userTheme);
  if (startedWith && window.__fmessSetDarkMode) window.__fmessSetDarkMode(startedWith);
  else if (startedWith) darkMode.saveDarkModeSetting(startedWith, { onRevert() {} });
}
result.chats = [...entries.values(), toasts];
const seenAny = (k) => result.chats.some((c) => c.has?.[k]);
if (!seenAny('quote')) result.notes.push('no quote found in the chats checked: quotes not checked');
if (!seenAny('icon')) result.notes.push('no emoji-only message found in the chats checked: emoji messages not checked');
for (const c of result.chats) if (!c.toast && !c.has?.texts) result.notes.push(`${c.label}: no text bubble found to check`);
result.darkModeWas = startedWith;
return result;

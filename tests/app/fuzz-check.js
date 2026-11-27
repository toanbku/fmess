// Probe for tests/app/fuzz-check.sh: random sequences of what a person does
// in fMess, with real clicks and keys (probe.rs), checking after each step
// what must always hold. The idea of property-based UI testing (Bombadil),
// on WebKit and with fMess's own probe.
//
// It runs on a real account, so it only does what nobody else sees and
// changes nothing, except in the chats listed in a local file (never in the
// repo, see fuzz-check.sh): there it may type, send and reply. It never
// types in another chat's message box (friends would see "typing…"), never
// clicks a menu's items, a reaction or a call button, and opens only chats
// already read.
//
// __SEED__ picks the sequence; the same seed does the same steps (Messenger's
// live data aside). The probe returns "again" to go on after a reload; where
// it is, and the random generator's state, are kept in sessionStorage.
const SEED = __SEED__;
const STEPS = __STEPS__;
const CONFIG = __CONFIG__;
const OUT = __OUT__;
// fMess's look for this run, put in the page as Settings would (not saved):
// a theme's CSS, or null for Messenger's own.
const LOOK = __LOOK__;
const KEY = 'fmess.fuzz';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = JSON.parse(sessionStorage.getItem(KEY) || 'null') ?? { rng: SEED >>> 0, step: 0, log: [], violations: [], sends: 0, widths: {}, drafts: {}, known: [] };
const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));
// mulberry32, its state kept across reloads.
const random = () => {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];

// Real input ----------------------------------------------------------------
const input = async (steps) => {
  const done = window.__fmessInputDone || 0;
  window.__fmessInputRequest = steps;
  for (let i = 0; i < 100 && (window.__fmessInputDone || 0) === done; i++) await sleep(100);
};
const point = (el, dx = 0.5) => {
  const box = el.getBoundingClientRect();
  return [box.x + Math.min(box.width * dx, box.width - 4), box.y + box.height / 2];
};
const visible = (el) => Boolean(el) && el.getBoundingClientRect().width > 0;

// The page --------------------------------------------------------------------
const composer = () => document.querySelector('[role="main"] [contenteditable="true"][role="textbox"]');
const searchField = () => document.querySelector('[role="navigation"] input[type="search"]');
const threadOf = (path) => path?.match(/\/t\/(\d+)/)?.[1] ?? null;
const openThread = () => threadOf(location.pathname);
const whitelisted = () => Boolean(CONFIG.sendTo?.[openThread()]);
const viewerOpen = () => document.documentElement.hasAttribute('data-fmess-media');
const replying = () => Boolean(document.querySelector('[data-fmess-ui="reply-text"]'));
// Message text, not in a link (dragging a link drags it, it selects nothing).
const messageTexts = () =>
  [...document.querySelectorAll('[role="main"] [role="log"] [data-message-id] [dir="auto"]')].filter((el) => {
    if (el.closest('a[href]')) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.top > 120 && box.bottom < innerHeight - 120 && el.textContent.trim().length >= 3;
  });
const photoOnScreen = () =>
  [...document.querySelectorAll('[role="main"] [role="log"] img:not([src*="emoji.php"])')].find((img) => {
    const box = img.getBoundingClientRect();
    return box.width > 120 && box.height > 80 && box.top > 120 && box.bottom < innerHeight - 140;
  });
const boxWidth = () => Math.round(composer()?.getBoundingClientRect().width ?? 0);

// What the probe saw go wrong, with the step and a picture.
const violate = async (rule, detail) => {
  state.violations.push({ step: state.step, rule, detail });
  window.__fmessErrors?.push(`[fuzz] step ${state.step} VIOLATION ${rule}: ${detail}`);
  save();
  window.__fmessSnapshotDone = null;
  window.__fmessSnapshotRequest = `${OUT}/violation-${state.step}.png`;
  for (let i = 0; i < 50 && !window.__fmessSnapshotDone; i++) await sleep(100);
};
// A known bug, counted once, not a failure (#72).
const known = (what) => state.known.includes(what) || state.known.push(what);

// Never let the webview's own context menu open: an NSMenu blocks the app
// until it is closed, and nobody is there to close it.
window.addEventListener('contextmenu', (event) => event.defaultPrevented || event.preventDefault());
// fMess's script's own errors.
const scriptErrors = [];
window.addEventListener('error', (event) => /user-script/.test(`${event.filename} ${event.error?.stack}`) && scriptErrors.push(String(event.message).slice(0, 200)));
const themeStyle = () => document.getElementById('fmess-theme');
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
setLook(LOOK);
// Nobody sees "typing…" from a test, even where it may type.
window.__fmessApplySettings?.({ ...window.__fmessSettings, blockTyping: true });

// Chats it may open: those already read (opening an unread one marks it seen).
const loadModules = (names) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 10000);
    window.require('Bootloader').loadModules(names, (...modules) => (clearTimeout(timer), resolve(modules)), 'fmess-fuzz');
  });
await loadModules(['ReQL', 'LSDatabaseSingleton', 'MWPIsThreadUnread', 'I64']);
const ReQL = window.require('ReQL');
const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
const { isThreadUnreadForViewer } = window.require('MWPIsThreadUnread');
const key = (id) => [Number(BigInt(id) >> 32n), Number(BigInt(id) & 0xffffffffn)];
const readChat = async (id) => {
  const thread = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(key(id)));
  return Boolean(thread) && !isThreadUnreadForViewer(thread);
};
const chatRows = async () => {
  const rows = [];
  for (const link of document.querySelectorAll('[role="grid"] [role="row"] a[href*="/messages/"]')) {
    const id = threadOf(link.getAttribute('href'));
    const box = link.getBoundingClientRect();
    if (!id || box.width === 0 || box.top < 100 || box.bottom > innerHeight - 20) continue;
    if (CONFIG.sendTo?.[id] || (await readChat(id))) rows.push({ id, link });
  }
  return rows;
};
const waitForChat = async (before) => {
  for (let i = 0; i < 100; i++) {
    if (composer() && composer() !== before && document.querySelector('[role="main"] [data-message-id]')) return true;
    await sleep(200);
  }
  return false;
};
// Takes back text it typed into a whitelisted chat's box (never sent).
const clearBox = async () => {
  for (let i = 0; i < 40 && composer()?.textContent; i++) await input([{ key: 'Backspace' }]);
};
// Elsewhere only what it typed, should typing have landed in the box: a
// draft of anh's own stays as it was.
const takeBack = async (typed) => {
  if (!composer()?.textContent.endsWith(typed)) return;
  await input([{ click: point(composer(), 0.98) }]);
  for (let i = 0; i < typed.length; i++) await input([{ key: 'Backspace' }]);
};
const closeViewer = async () => {
  for (let i = 0; i < 3 && viewerOpen(); i++) {
    const close = [...document.querySelectorAll('[role="button"][aria-label]')].find((b) => visible(b) && /^(close|đóng)$/i.test(b.getAttribute('aria-label')));
    await input(close ? [{ click: point(close) }] : [{ key: 'Escape' }]);
    await sleep(800);
  }
};

// The steps -----------------------------------------------------------------
const word = () => pick(['zq', 'ab', 'xin chao', 'test', 'ê']);
const ACTIONS = {
  async openChat() {
    const rows = await chatRows();
    const before = composer();
    const target = CONFIG.sendTo && random() < 0.35 ? Object.keys(CONFIG.sendTo)[0] : pick(rows)?.id;
    if (!target) return 'no chat';
    if (target === openThread()) return 'already open';
    // Search results take the list's place: back to the list first.
    if (document.activeElement === searchField() || searchField()?.value) {
      await input([{ click: point(searchField()) }, { key: 'Escape' }]);
      await sleep(700);
    }
    const row = (await chatRows()).find((r) => r.id === target);
    if (!row) return 'not on screen';
    // Only where the row itself is under the pointer (not a panel over it).
    const [x, y] = point(row.link, 0.3);
    if (!row.link.contains(document.elementFromPoint(x, y))) return 'covered';
    await input([{ click: [x, y] }]);
    if (!(await waitForChat(before))) await violate('chat opens', `${CONFIG.sendTo?.[target] ? 'the whitelisted chat' : 'a chat'} showed no messages in 20 s`);
    await sleep(1200);
    if (!replying()) state.widths[openThread()] ??= boxWidth();
    state.drafts[openThread()] = composer()?.textContent ?? '';
    return CONFIG.sendTo?.[target] ? 'whitelisted chat' : 'a read chat';
  },
  async search() {
    const field = searchField();
    // A theme's own search box (Teams', in its title bar) when it has one: the
    // list's field is folded away there until it is used.
    const themed = document.getElementById('fmess-search-box');
    const target = visible(themed) ? themed : field;
    if (!visible(target)) return 'no search field';
    const [x, y] = point(target, 0.3);
    if (!target.contains(document.elementFromPoint(x, y))) return 'search field covered';
    await input([{ click: [x, y] }]);
    await sleep(700);
    if (document.activeElement !== searchField()) return violate('a clicked field keeps the keyboard', `the search field; keyboard on ${document.activeElement?.tagName}`);
    const text = word();
    // Messenger keeps what was typed there before (Escape leaves it), and
    // the click puts the cursor anywhere in it.
    const before = searchField().value.length;
    await input([{ type: text }]);
    await sleep(500);
    const value = searchField()?.value ?? '';
    // Or the old text was selected (a theme's search box, as ⌘K does) and
    // the new replaces it.
    const replaced = target === themed && value === text;
    if (!replaced && (!value.includes(text) || value.length !== before + text.length)) await violate('typing goes where the keyboard is', `typed "${text}", the search field went from ${before} to ${value.length} characters`);
    if (!whitelisted() && composer()?.textContent.endsWith(text)) {
      await violate('typing goes where the keyboard is', 'text landed in the message box');
      await takeBack(text);
    }
    if (random() < 0.7) await input([{ key: 'Escape' }]);
    await sleep(500);
    return `typed "${text}"`;
  },
  async shortcut() {
    window.__fmessShortcut?.('search');
    await sleep(800);
    if (document.activeElement !== searchField()) return violate('⌘K puts the keyboard in the search field', `keyboard on ${document.activeElement?.tagName}`);
    await input([{ type: word() }, { key: 'Escape' }]);
    await sleep(500);
  },
  async viewer() {
    const photo = photoOnScreen();
    if (!photo || !composer()) return 'no photo on screen';
    const withText = Boolean(composer().textContent);
    await input([{ click: point(photo) }]);
    for (let i = 0; i < 20 && !viewerOpen(); i++) await sleep(200);
    if (!viewerOpen()) return 'viewer did not open';
    await sleep(600);
    if (random() < 0.4) {
      const big = [...document.querySelectorAll('img')].filter(visible).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      if (big) await input([{ click: point(big), count: 2 }]);
      await sleep(600);
      await input([{ key: 'Escape' }]);
      await sleep(600);
      if (!viewerOpen()) await violate('Escape zooms out before it closes', 'the viewer closed instead');
    }
    await input([{ key: 'Escape' }]);
    await sleep(1200);
    if (viewerOpen()) {
      if (withText) known('#72: Escape leaves the viewer open while the message box has text');
      else await violate('Escape closes the viewer', 'still open');
      await closeViewer();
    }
    return withText ? 'viewer, box with text' : 'viewer';
  },
  async replyCancel() {
    const text = pick(messageTexts());
    const log = document.querySelector('[role="main"] [role="log"]')?.getBoundingClientRect();
    if (!text || !log || replying()) return 'nothing to reply to';
    const box = text.getBoundingClientRect();
    const theirs = box.left + box.width / 2 < log.left + log.width / 2;
    const x = theirs ? Math.min(log.right - 30, box.right + 260) : Math.max(log.left + 30, box.left - 260);
    await input([{ click: [x, box.top + box.height / 2], count: 2 }]);
    await sleep(1000);
    if (!replying()) return 'no reply started';
    const bar = document.querySelector('[data-fmess-ui="composer-bar"]');
    const close = bar && [...bar.querySelectorAll('[role="button"]')].filter(visible).at(-1);
    if (close) await input([{ click: point(close) }]);
    await sleep(1000);
    return 'reply started and dropped';
  },
  async rightClick() {
    const target = random() < 0.5 ? pick(messageTexts()) : pick((await chatRows()).map((r) => r.link));
    if (!target) return 'nothing to right-click';
    await input([{ rightClick: point(target, 0.3) }]);
    await sleep(900);
    const opened = document.querySelector('[role="menu"], [role="dialog"]');
    await input([{ key: 'Escape' }]);
    await sleep(700);
    if (document.querySelector('[role="menu"]')) {
      await violate('Escape closes a menu', 'a menu stayed open');
      document.body.click();
    }
    return opened ? 'menu opened and closed' : 'no menu';
  },
  async select() {
    const text = pick(messageTexts());
    if (!text) return 'no text';
    // Along its first line (between two lines there is no text).
    const box = text.getClientRects()[0] ?? text.getBoundingClientRect();
    getSelection().removeAllRanges();
    await input([{ drag: [box.x + 1, box.y + box.height / 2, box.right - 1, box.y + box.height / 2] }]);
    await sleep(700);
    const selected = String(getSelection()).trim().length;
    getSelection().removeAllRanges();
    const hit = document.elementFromPoint(box.x + 2, box.y + box.height / 2);
    // Teams' hover card hangs in a strip across the chat (its bridge, so the
    // card stays while the pointer goes up to it): text under it can't be
    // dragged across while the card shows.
    if (!selected && hit?.closest('[role="toolbar"]') && document.getElementById('fmess-theme')?.textContent.includes('A bridge to the card')) {
      known("Teams: text under a message's hover card strip can't be selected while the card shows");
    } else if (!selected) {
      const keyboard = document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName;
      await violate('message text can be selected', `nothing selected: ${text.getClientRects().length} line(s) at y ${Math.round(box.y)}, pointer on ${text.contains(hit) ? 'the text' : hit?.tagName}, user-select ${getComputedStyle(text).webkitUserSelect}, keyboard on ${keyboard}, in a dialog: ${Boolean(text.closest('[role="dialog"]'))}`);
    }
  },
  async scroll() {
    const log = document.querySelector('[role="main"] [role="log"]');
    const scroller = log && [log, ...(function* up(el) { for (let e = el.parentElement; e; e = e.parentElement) yield e; })(log)].find((el) => el.scrollHeight > el.clientHeight + 10);
    if (!scroller) return 'nothing to scroll';
    scroller.scrollTop += (random() < 0.6 ? -1 : 1) * Math.round(200 + random() * 900);
    await sleep(900);
  },
  async reload() {
    state.reloading = true;
    save();
    setTimeout(() => location.reload(), 200);
    return 'again';
  },
  // Only in a whitelisted chat.
  async send() {
    if (!whitelisted() || state.sends >= (CONFIG.maxSendsPerRun ?? 5)) return 'skipped';
    const reply = random() < 0.4;
    if (reply) await ACTIONS.replyStart();
    await input([{ click: point(composer()) }]);
    const text = `fMess test ${SEED}-${state.step}${reply ? ' (reply)' : ''}`;
    await input([{ type: text }, { key: 'Enter' }]);
    state.sends += 1;
    save();
    for (let i = 0; i < 50; i++) {
      if (messageTexts().some((el) => el.textContent.includes(text)) || [...document.querySelectorAll('[role="main"] [role="log"]')].some((l) => l.textContent.includes(text))) break;
      await sleep(200);
    }
    if (![...document.querySelectorAll('[role="main"] [role="log"]')].some((l) => l.textContent.includes(text))) await violate('a sent message shows in the chat', `"${text}" not there after 10 s`);
    // Messenger empties the box a moment after the message shows.
    for (let i = 0; i < 15 && composer()?.textContent; i++) await sleep(200);
    if (composer()?.textContent) await violate('the message box empties once sent', `"${composer().textContent.slice(0, 30)}" 3 s after`);
    await sleep(800);
    return reply ? 'sent a reply' : 'sent a message';
  },
  async replyStart() {
    const text = pick(messageTexts());
    const log = document.querySelector('[role="main"] [role="log"]')?.getBoundingClientRect();
    if (!text || !log) return;
    const box = text.getBoundingClientRect();
    const theirs = box.left + box.width / 2 < log.left + log.width / 2;
    const x = theirs ? Math.min(log.right - 30, box.right + 260) : Math.max(log.left + 30, box.left - 260);
    await input([{ click: [x, box.top + box.height / 2], count: 2 }]);
    await sleep(900);
  },
  async draft() {
    if (!whitelisted()) return 'skipped';
    await input([{ click: point(composer()) }, { type: word() }]);
    await sleep(400);
    // Something else while text waits in the box, then it goes.
    await pick([ACTIONS.viewer, ACTIONS.search, ACTIONS.select, ACTIONS.rightClick])();
    if (!whitelisted()) return 'left the chat';
    await input([{ click: point(composer()) }]);
    await clearBox();
    return 'draft, then something else';
  },
};
const WEIGHTS = { openChat: 4, search: 3, shortcut: 2, viewer: 3, replyCancel: 3, rightClick: 2, select: 3, scroll: 3, reload: 1, send: 2, draft: 2 };
const weighted = Object.entries(WEIGHTS).flatMap(([name, weight]) => Array(weight).fill(name));

// After every step.
const checkAlways = async () => {
  if (scriptErrors.length) await violate("no errors from fMess's script", scriptErrors.splice(0).join(' | '));
  if (/Couldn.t load chats/.test(document.body.innerText)) await violate("no \"Couldn't load chats\"", 'the error screen shows');
  const id = openThread();
  if (id && composer() && !replying() && !viewerOpen() && state.widths[id]) {
    const width = boxWidth();
    if (width < state.widths[id] * 0.9) await violate('the message box keeps its width', `${state.widths[id]} → ${width} px`);
  }
  if (id && !whitelisted() && composer() && (composer().textContent ?? '') !== (state.drafts[id] ?? '')) {
    await violate('nothing typed in a chat off the whitelist', 'its message box changed');
    state.drafts[id] = composer().textContent;
  }
};

// Chats unread now, by id: none of them may become read, but a whitelisted
// one (it is opened on purpose).
const unreadNow = async () => {
  const threads = await ReQL.toArrayAsync(ReQL.fromTableDescending(db.tables.threads.index('lastActivityTimestampMs')).take(100));
  return threads.filter((t) => isThreadUnreadForViewer(t)).map((t) => window.require('I64').to_string(t.threadKey));
};
state.unreadAtStart ??= await unreadNow().catch(() => null);
save();

// The run ---------------------------------------------------------------------
if (state.reloading) {
  state.reloading = false;
  await waitForChat(null);
  await sleep(2500);
  await checkAlways();
}
if (!openThread()) await ACTIONS.openChat();
else state.drafts[openThread()] ??= composer()?.textContent ?? '';
while (state.step < STEPS) {
  state.step += 1;
  // A dialog a step left open (the pinned messages, say) goes first.
  if (!viewerOpen() && document.querySelector('[role="dialog"]')) {
    await input([{ key: 'Escape' }]);
    await sleep(600);
  }
  const name = pick(weighted);
  let result;
  try {
    result = await ACTIONS[name]();
  } catch (error) {
    result = `probe error: ${error}`;
  }
  state.log.push(`${state.step} ${name}${typeof result === 'string' ? `: ${result}` : ''}`);
  // Also in app.log as it goes, should the run be stopped.
  window.__fmessErrors?.push(`[fuzz] ${state.log.at(-1)}`);
  save();
  if (result === 'again') return 'again';
  await checkAlways();
  save();
}
await closeViewer();
if (whitelisted()) await clearBox();
setLook(window.__fmessSettings?.theme?.css ?? null);
const unreadAtEnd = await unreadNow().catch(() => null);
const madeRead = (state.unreadAtStart ?? []).filter((id) => unreadAtEnd && !unreadAtEnd.includes(id) && !CONFIG.sendTo?.[id]);
if (madeRead.length) await violate('chats unread stay unread', `${madeRead.length} became read during the run (or were read on another device meanwhile)`);
sessionStorage.removeItem(KEY);
return { seed: SEED, steps: state.log, violations: state.violations, known: state.known, sends: state.sends };

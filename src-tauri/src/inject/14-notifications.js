  const shown = new Map();
  let nextId = Math.floor(Math.random() * 1e9);
  // When the page last raised a notification itself (see notifyNewestChat).
  let lastPageNotification = 0;
  let raisingFallback = false;
  // Messenger may raise the same message twice; browsers show one notification
  // per tag (Messenger uses the message id), so fMess does too.
  const shownTags = new Set();
  // The few notifications fMess writes itself are in fMess's language
  // (settings.lang), not Facebook's: English, or Vietnamese.
  let language = settings.lang;
  const say = (en, vi) => (language === 'vi' ? vi : en);

  const invoke = (command, args) =>
    window.__TAURI_INTERNALS__
      ? window.__TAURI_INTERNALS__.invoke(command, args)
      : Promise.reject(new Error('fMess bridge unavailable'));

  // Sender and chat of a message notification, by message id (Messenger's
  // tag), read as MWDesktopNotifications does (see MODULE_PATCHES).
  const messageDetails = new Map();
  // The chat and time of each message Messenger is about to notify about, by
  // message id; and, per chat, the newest message it did notify about, which
  // fMess's own notification (notifyNewestChat) then leaves alone.
  const pageMessages = new Map();
  const pageNotifiedUpTo = new Map();
  // A message sent over LATE_MS ago, or in a chat read past it (on another
  // device, say), needs no notification.
  async function isOldNews(db, message) {
    const sent = int64(message?.timestampMs);
    if (sent && serverNow() - Number(sent) > LATE_MS) return true;
    const ReQL = window.require('ReQL');
    const chat = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(message.threadKey));
    return Boolean(chat && sent) && int64(chat.lastReadWatermarkTimestampMs) >= sent;
  }
  async function readMessageDetails(db, message) {
    const ReQL = window.require('ReQL');
    const first = (table, ...key) => ReQL.firstAsync(ReQL.fromTableAscending(table).getKeyRange(...key));
    const [thread, contact, participant] = await Promise.all([
      first(db.tables.threads, message.threadKey),
      first(db.tables.contacts, message.senderId),
      first(db.tables.participants, message.threadKey, message.senderId),
    ]);
    if (!thread || !contact) return null;
    const picture = (name, row) => {
      try {
        return moduleFunction(window.require(name))(row) ?? null;
      } catch {
        return null;
      }
    };
    const isGroup = window.require('LSMessagingThreadTypeUtil').isGroup(thread.threadType);
    return {
      thread: String(int64(message.threadKey)),
      sender: participant?.nickname || contact.name || '',
      senderPicture:
        picture('getLSMediaContactProfilePictureLargeUrl', contact) ?? picture('getLSMediaContactProfilePictureUrl', contact),
      group: isGroup ? { name: thread.threadName || null, picture: picture('getLSMediaThreadPictureUrl', thread) } : null,
    };
  }
  // A picture for a native notification, as base64; none rather than a late
  // notification when it is slow or large.
  const pictureData = async (url) => {
    if (!url || typeof url !== 'string') return null;
    try {
      const response = await fetch(url);
      const blob = response.ok ? await response.blob() : null;
      if (!blob || blob.size > 4_000_000) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    } catch {
      return null;
    }
  };
  const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  // Whether a notification rings, on Windows. Messenger asks for no silence,
  // so in a browser its notifications ring with Windows' sound; fMess's were
  // silent, and with Messenger's own sound not playing either, new messages
  // made no sound at all (#36). Messenger also plays its sound for a new
  // message (at most three times a chat), around when it notifies: before,
  // or just after, as it first asks whether its sounds are on. When that
  // sound just played, the notification stays quiet; when the notification
  // rings, it holds Messenger's sound back for a moment. Either way a message
  // rings once. macOS and Linux notifications stay silent, with Messenger's
  // sound.
  // Live checks on a Mac decide as on Windows (window.__fmessRingAnywhere).
  const ringsHere = /^Win/.test(navigator.platform);
  const shouldRing = async (notification) => {
    if (!(ringsHere || (window.__fmessDebug && window.__fmessRingAnywhere)) || notification.silent || messengerPrefs?.soundsOn === false || isMuted()) return false;
    const sound = lastSound;
    const rings = Date.now() - sound.at > 3000 || !(await within(sound.played, 1500));
    if (rings) quietSoundsUntil = Date.now() + 3000;
    return rings;
  };
  const sendNotification = async (notification) => {
    const ring = shouldRing(notification);
    const details = await within(messageDetails.get(String(notification.tag)) ?? Promise.resolve(null), 2000);
    // With people's pictures hidden (Privacy), notifications go without them.
    const pictures = !privacy.hideAvatars;
    const [icon, image, senderPicture, groupPicture] = await within(
      Promise.all([
        details || !pictures ? null : pictureData(notification.icon),
        pictureData(notification.image),
        details && pictures ? pictureData(details.senderPicture) : null,
        details?.group && pictures ? pictureData(details.group.picture) : null,
      ]),
      3000,
    ) ?? [];
    const message = details && {
      thread: details.thread,
      sender: details.sender,
      senderPicture: senderPicture ?? null,
      group: details.group && { name: details.group.name, picture: groupPicture ?? null },
    };
    return invoke('notify', {
      id: notification.fmessId,
      title: notification.title,
      body: notification.body,
      icon: icon ?? null,
      image: image ?? null,
      message: message || null,
      sound: await ring,
    });
  };

  class FMessNotification extends EventTarget {
    static get permission() {
      return 'granted';
    }

    // tauri-plugin-notification's page script sets it once it has asked
    // fMess (is_permission_granted), after this class took its place; in
    // strict code a property with no setter would throw.
    static set permission(_) {}

    static requestPermission(callback) {
      callback?.('granted');
      return Promise.resolve('granted');
    }

    constructor(title, options = {}) {
      super();
      this.title = String(title ?? '');
      this.body = String(options.body ?? '');
      this.tag = options.tag ?? '';
      this.icon = options.icon ?? '';
      this.image = options.image ?? '';
      this.data = options.data ?? null;
      this.silent = Boolean(options.silent);
      this.onclick = this.onshow = this.onclose = this.onerror = null;
      if (!raisingFallback) lastPageNotification = Date.now();
      if (this.tag) {
        if (shownTags.has(this.tag)) return;
        shownTags.add(this.tag);
        if (shownTags.size > 500) shownTags.delete(shownTags.values().next().value);
        const message = pageMessages.get(String(this.tag));
        if (message && !raisingFallback && message.sent > (pageNotifiedUpTo.get(message.thread) ?? 0)) {
          pageNotifiedUpTo.set(message.thread, message.sent);
        }
      }
      // The native side takes an i32 id.
      this.fmessId = nextId++ % 0x7fffffff;
      shown.set(this.fmessId, this);
      if (shown.size > 100) shown.delete(shown.keys().next().value);
      sendNotification(this).then(
        () => this.fmessFire('show'),
        () => this.fmessFire('error'),
      );
    }

    close() {
      if (shown.delete(this.fmessId)) this.fmessFire('close');
    }

    fmessFire(type) {
      const event = new Event(type);
      this[`on${type}`]?.call(this, event);
      this.dispatchEvent(event);
    }
  }

  window.Notification = FMessNotification;

  // Some code paths notify through a service worker registration instead.
  if (window.ServiceWorkerRegistration) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      new FMessNotification(title, options);
      return Promise.resolve();
    };
  }

  // Keep navigator.permissions in agreement with Notification.permission.
  const query = navigator.permissions?.query?.bind(navigator.permissions);
  if (query) {
    navigator.permissions.query = (descriptor) =>
      descriptor?.name === 'notifications'
        ? Promise.resolve({
            name: 'notifications',
            state: 'granted',
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
          })
        : query(descriptor);
  }

  // facebook.com only notifies through Web Push, which embedded WebKit lacks,
  // so new messages never reach the shim above. fMess calls this instead when
  // the unread count in the title goes up while the window is in the
  // background, and it notifies about the newest chat in the list.
  // A chat row reads "<name> <preview> · <age>" on screen. It also carries
  // text only screen readers get, clipped to 1px: "Active now" before the name,
  // and "Unread message:" after it when the chat is unread. Emoji are images.
  const rowTexts = (row) => {
    const texts = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const isEmoji = node instanceof HTMLImageElement && node.alt && node.getBoundingClientRect().width <= 24;
      if (node.nodeType !== Node.TEXT_NODE && !isEmoji) continue;
      const text = isEmoji ? node.alt : node.textContent.trim();
      const box = (isEmoji ? node : node.parentElement)?.getBoundingClientRect();
      if (text && box) texts.push({ text, visible: box.width > 1 && box.height > 1 });
    }
    return texts;
  };
  const isUnreadChat = (row) => {
    const texts = rowTexts(row);
    const name = texts.findIndex((part) => part.visible);
    return name >= 0 && texts.slice(name + 1).some((part) => !part.visible);
  };
  // The chat rows that count as unread, each chat once. Messenger decides, by
  // the test behind a row's "Unread message:" (MWPIsThreadUnread), and muted
  // chats are left out, as the badge on Facebook's top bar leaves them out
  // (MWChatBadgeCountUpdates): a busy muted group would otherwise keep the
  // Dock badge up. A chat missing from Messenger's copy falls back to the
  // row's hidden text.
  const isMutedChat = (chat) => {
    const until = int64(chat.muteExpireTimeMs);
    return until === -1n || until > BigInt(Math.floor(serverNow()));
  };
  const unreadChats = async (rows) => {
    let isUnreadInMessenger = null;
    try {
      await loadModules(['ReQL', 'LSDatabaseSingleton', 'MWPIsThreadUnread']);
      const ReQL = window.require('ReQL');
      const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
      const { isThreadUnreadForViewer } = window.require('MWPIsThreadUnread');
      if (typeof isThreadUnreadForViewer === 'function') {
        isUnreadInMessenger = async (thread) => {
          const chat = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(int64Key(thread)));
          return chat ? isThreadUnreadForViewer(chat) && !isMutedChat(chat) : undefined;
        };
      }
    } catch {}
    const counted = new Set();
    const unread = [];
    for (const row of rows) {
      const href = row.getAttribute('href');
      if (counted.has(href)) continue;
      counted.add(href);
      const thread = href?.match(/\/t\/(\d+)/)?.[1];
      const known = thread && isUnreadInMessenger ? await isUnreadInMessenger(thread).catch(() => undefined) : undefined;
      if (known ?? isUnreadChat(row)) unread.push(row);
    }
    // Whether Messenger's copy answered: then no chat means none to count.
    unread.fromMessenger = Boolean(isUnreadInMessenger);
    return unread;
  };
  const chatSummary = (row) => {
    const texts = rowTexts(row).filter((part) => part.visible).map((part) => part.text);
    const age = texts.lastIndexOf('·');
    const preview = (age > 0 ? texts.slice(1, age) : texts.slice(1)).join(' ').replace(/\s+/g, ' ');
    return { name: texts[0] ?? '', preview };
  };

  // Messenger's copy of the chat a row links to: { thread, chat }, or null.
  const chatRecord = async (row) => {
    const thread = row.getAttribute('href')?.match(/\/t\/(\d+)/)?.[1];
    if (!thread) return null;
    await loadModules(['ReQL', 'LSDatabaseSingleton']);
    const ReQL = window.require('ReQL');
    const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
    const chat = await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(int64Key(thread)));
    return chat ? { thread, chat } : null;
  };
  // Whether a chat has nothing to notify about, as Messenger's copy of it
  // says: its newest message is your own, came in late, or Messenger
  // notified about it already.
  const nothingNew = ({ thread, chat }) => {
    const me = currentUserId();
    if (!me) return false;
    const lastActivity = Number(int64(chat.lastActivityTimestampMs));
    return (
      int64(chat.snippetSenderContactId) === BigInt(me) ||
      serverNow() - lastActivity > LATE_MS ||
      lastActivity <= (pageNotifiedUpTo.get(thread) ?? -1)
    );
  };
  // What fMess's own notification last said about each chat, and the chat's
  // last activity then: when the count rose twice in a row, or rose again
  // later for another reason (a computer back from sleep), the same message
  // came up two or more times (#22). Messenger's copy keeps no id for a
  // chat's newest message, so a notification counts as said again when the
  // chat's last activity is the same, or when the name and preview are the
  // same and the chat hasn't been read since (another "ok" after you read
  // the first one is new).
  const fallbackShown = new Map();
  const saidAlready = (href, said, record) => {
    const before = fallbackShown.get(href);
    if (!before) return false;
    const activity = record ? Number(int64(record.chat.lastActivityTimestampMs)) : null;
    if (activity !== null && activity === before.activity) return true;
    if (said !== before.said) return false;
    const readUpTo = record ? Number(int64(record.chat.lastReadWatermarkTimestampMs)) : null;
    return readUpTo === null || before.activity === null || readUpTo < before.activity;
  };

  // Facebook raises its own notifications (see MODULE_PATCHES). In case it
  // stops doing so, notify about the newest unread chat when the count rises
  // and Facebook stayed quiet.
  const notifyNewestChat = async () => {
    const links = chatLinks();
    const unread = await unreadChats(links);
    // A message you send from your phone in an encrypted chat can leave that
    // chat unread here, and a computer back from sleep catches up on chats
    // all at once; Messenger notifies about neither.
    // With no unread chat, the newest chat is tried only when Messenger's copy
    // couldn't be read. When it could, the chats were read or muted while
    // fMess waited, and the newest one may be a muted group.
    let link;
    let record = null;
    for (const row of unread.length || unread.fromMessenger ? unread : links.slice(0, 1)) {
      const found = await chatRecord(row).catch(() => null);
      if (!found || !nothingNew(found)) {
        link = row;
        record = found;
        break;
      }
    }
    // Messenger itself stays quiet during Do Not Disturb.
    if (!link || isMuted() || Date.now() - lastPageNotification < 4000) return;
    const chat = chatSummary(link);
    const href = link.getAttribute('href');
    const said = `${chat.name}\n${chat.preview}`;
    if (saidAlready(href, said, record)) return;
    fallbackShown.set(href, { said, activity: record ? Number(int64(record.chat.lastActivityTimestampMs)) : null });
    if (fallbackShown.size > 100) fallbackShown.delete(fallbackShown.keys().next().value);
    raisingFallback = true;
    try {
      const notification = new FMessNotification(chat.name || 'Messenger', {
        body: chat.preview || say('New message', 'Tin nhắn mới'),
        icon: link.querySelector('img')?.currentSrc,
      });
      notification.onclick = () => chatLinks().find((row) => row.getAttribute('href') === href)?.click();
    } finally {
      raisingFallback = false;
    }
  };


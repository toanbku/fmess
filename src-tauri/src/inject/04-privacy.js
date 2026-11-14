  // Privacy (fMess Settings): don't let people see that you're typing.
  //
  // Messenger sends requests over the /ws/lightspeed WebSocket. A frame holds
  // parts: a type byte and a 2-byte stream id, then, except in the part that
  // closes a stream (0x0e), a 3-byte length and that many bytes; all little
  // endian. Each request has a stream of its own, and its data part (0x0d) is
  // two flag bytes and the request as JSON, nesting more JSON in strings.
  // Requests are edited rather than dropped, so every stream still gets its
  // answer and nothing is retried: typing (type 4, label "3") says
  // is_typing 0. Typing in encrypted chats goes to Messenger's worker instead
  // (sendChatStateFromComposer) and is edited on its way there.
  const privacy = { blockTyping: Boolean(settings.blockTyping), hideAvatars: false, redactMode: false };

  // Privacy (fMess Settings): people's pictures as their initials, for
  // screens others can see. A person's picture in the chat list, the chat's
  // header, beside messages and in the details is drawn as a circle with the
  // first letter of the name, its colour following the name; one whose name
  // fMess can't tell (the small "seen" pictures) as a grey circle. Pictures
  // there are hidden until fMess has looked at them, so a photo never shows
  // for a moment; those that aren't people's (photos sent) are let through.
  const AVATARS_HIDDEN = 'data-fmess-hide-avatars';
  const AVATAR = 'data-fmess-avatar';
  const AVATAR_PLACES = ':is([role="navigation"] [role="row"], [data-fmess-ui="chat-header"], [role="log"], [data-fmess-ui="details"])';
  const AVATAR_COLOURS = ['#c4314b', '#e3008c', '#8764b8', '#4f6bed', '#0078d4', '#038387', '#498205', '#ca5010'];
  const avatarStyle = document.createElement('style');
  avatarStyle.textContent = `
    html[${AVATARS_HIDDEN}] ${AVATAR_PLACES} :is(img:not([src*="emoji.php"]), svg image):not([${AVATAR}]) { visibility: hidden !important; }
  `;
  withRoot((root) => root.append(avatarStyle));
  const initialPictures = new Map();
  const initialPicture = (name) => {
    const letter = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '').toLocaleUpperCase();
    const colour = letter ? AVATAR_COLOURS[[...name].reduce((hash, c) => (hash * 31 + c.codePointAt(0)) >>> 0, 7) % AVATAR_COLOURS.length] : '#bcc0c4';
    const key = `${letter}${colour}`;
    if (!initialPictures.has(key)) {
      const text = letter
        ? `<text x='20' y='20' dy='.35em' text-anchor='middle' font-family='-apple-system,system-ui,sans-serif' font-size='18' font-weight='600' fill='white'>${letter}</text>`
        : '';
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='${colour}'/>${text}</svg>`;
      initialPictures.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
    }
    return initialPictures.get(key);
  };
  // The name a picture stands for, from where it is; '' for a grey circle,
  // null for a picture that isn't a person's.
  const pictureName = (picture) => {
    const box = picture.getBoundingClientRect();
    if (!box.width || Math.abs(box.width - box.height) > 2 || box.width > 100) return box.width ? null : undefined;
    const row = picture.closest('[role="navigation"] [role="row"]');
    if (row) return picture.tagName === 'IMG' ? row.querySelector('a[role="link"] span[dir="auto"]')?.textContent ?? '' : picture.closest('svg')?.getAttribute('aria-label') ?? '';
    const header = picture.closest('[data-fmess-ui="chat-header"]');
    if (header) return header.querySelector('h1, h2, h3')?.textContent ?? '';
    if (picture.closest('[role="log"]')) return box.width > 40 ? null : box.width > 20 ? picture.getAttribute('alt') ?? '' : '';
    return picture.closest('svg')?.getAttribute('aria-label') ?? picture.getAttribute('alt') ?? '';
  };
  const coverPicture = (picture) => {
    const name = pictureName(picture);
    if (name === undefined) return;
    if (name === null) return picture.setAttribute(AVATAR, 'none');
    const url = initialPicture(name);
    if (picture.tagName === 'IMG') picture.style.setProperty('content', `url("${url}")`, 'important');
    else {
      if (!picture.hasAttribute('data-fmess-href')) picture.setAttribute('data-fmess-href', picture.getAttribute('href') ?? picture.getAttribute('xlink:href') ?? '');
      picture.setAttribute('href', url);
    }
    picture.setAttribute(AVATAR, 'initial');
  };
  const uncoverPicture = (picture) => {
    if (picture.tagName === 'IMG') picture.style.removeProperty('content');
    else if (picture.hasAttribute('data-fmess-href')) {
      picture.setAttribute('href', picture.getAttribute('data-fmess-href'));
      picture.removeAttribute('data-fmess-href');
    }
    picture.removeAttribute(AVATAR);
  };
  const coverPicturesIn = (root) => {
    if (!privacy.hideAvatars) return;
    for (const picture of root.querySelectorAll(`${AVATAR_PLACES} :is(img:not([src*="emoji.php"]), svg image):not([${AVATAR}])`)) coverPicture(picture);
  };
  // New pictures are looked at in the frame they arrive in; a picture not
  // laid out yet (no size) waits for the next look. Facebook may also give a
  // picture already looked at another source (or another person): it is
  // looked at again, and a picture's own source kept for when the switch is
  // turned off is the new one. (fMess's own initials don't count.)
  let pictureFrame = 0;
  const avatarWatcher = new MutationObserver((records) => {
    for (const { type, target } of records) {
      if (type !== 'attributes' || !target.hasAttribute?.(AVATAR)) continue;
      const source = target.getAttribute('href') ?? target.getAttribute('src') ?? '';
      if (source.startsWith('data:image/svg+xml')) continue;
      if (target.hasAttribute('data-fmess-href')) target.setAttribute('data-fmess-href', source);
      target.removeAttribute(AVATAR);
    }
    pictureFrame ||= requestAnimationFrame(() => ((pictureFrame = 0), coverPicturesIn(document)));
  });
  let avatarTimer = 0;
  const setHideAvatars = (hide) => {
    if (hide === privacy.hideAvatars) return;
    privacy.hideAvatars = hide;
    withRoot((root) => root.toggleAttribute(AVATARS_HIDDEN, hide));
    avatarWatcher.disconnect();
    clearInterval(avatarTimer);
    cancelAnimationFrame(pictureFrame);
    pictureFrame = 0;
    if (hide) {
      withRoot((root) => avatarWatcher.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] }));
      avatarTimer = setInterval(() => coverPicturesIn(document), 1000);
      coverPicturesIn(document);
    } else for (const picture of document.querySelectorAll(`[${AVATAR}]`)) uncoverPicture(picture);
  };
  setHideAvatars(Boolean(settings.hideAvatars));

  const REDACT = 'data-fmess-redact';
  const UNREDACT = 'data-fmess-unredact';
  const redactStyle = document.createElement('style');
  redactStyle.textContent = `
    /* Redact colors: light mode default, dark mode adapts to deep black and subdued media/avatars */
    html[${REDACT}] {
      --fmess-redact-pill: #484a4d;
      --fmess-redact-media: brightness(0.35);
      --fmess-redact-avatar: brightness(0.8);
    }
    html[${REDACT}]:is([data-fmess-dark], .__fb-dark-mode) {
      --fmess-redact-pill: #000000;
      --fmess-redact-media: brightness(0.12);
      --fmess-redact-avatar: brightness(0.35);
    }
    /* Redact contact names, snippet previews, message bubbles, pinned banners, tooltips, and dialog messages with solid charcoal pills */
    html[${REDACT}] [role="navigation"] [role="row"] [dir="auto"],
    html[${REDACT}] [data-fmess-ui="chat-header"] [dir="auto"]:not([role="button"] *),
    html[${REDACT}] [role="main"] :is([role="banner"], [data-fmess-ui="pinned-banner"]) :is([dir="auto"], span):not(:has([dir="auto"])):not(:has(span)):not([role="button"]):not([role="button"] *),
    html[${REDACT}] [role="main"] [role="log"] [dir="auto"]:not(:has([dir="auto"])),
    html[${REDACT}] [role="main"] [data-fmess-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]),
    html[${REDACT}] [role="dialog"] :is([role="article"], [role="listitem"], [dir="auto"], time):not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *),
    html[${REDACT}] [role="tooltip"] {
      background: var(--fmess-redact-pill) !important;
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
      border-radius: 4px !important;
      box-decoration-break: clone !important;
      -webkit-box-decoration-break: clone !important;
      padding: 2px 4px !important;
      user-select: none !important;
    }
    /* Ensure all text descendants inside redacted containers have transparent fill so diacritics/spans never poke out */
    html[${REDACT}] :is(
      [role="navigation"] [role="row"],
      [role="main"] :is([role="banner"], [data-fmess-ui="pinned-banner"]),
      [role="main"] [role="log"],
      [data-fmess-ui="chat-header"]
    ) [dir="auto"]:not([${UNREDACT}]) *,
    html[${REDACT}] [role="tooltip"] *,
    html[${REDACT}] [role="main"] [data-fmess-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]) *,
    html[${REDACT}] [role="dialog"] [dir="auto"]:not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *) * {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
    }
    /* Hide image emojis inside redacted text spans */
    html[${REDACT}] :is(
      [role="navigation"] [role="row"],
      [role="main"] :is([role="banner"], [data-fmess-ui="pinned-banner"]),
      [role="main"] [role="log"],
      [data-fmess-ui="chat-header"]
    ) [dir="auto"]:not([${UNREDACT}]) img,
    html[${REDACT}] [role="main"] [data-fmess-ui="details"] > div:first-child [dir="auto"]:not([role="button"] *):not([role="tab"] *):not([role="listitem"] *):not([${UNREDACT}]) img,
    html[${REDACT}] [role="dialog"] [dir="auto"]:not([role="dialog"] h2 *):not([role="dialog"] [role="heading"] *):not([role="button"] *) img {
      opacity: 0 !important;
      visibility: hidden !important;
    }
    /* Redact message reactions attached to bubbles */
    html[${REDACT}] [role="main"] [role="log"] [role="button"]:is(:has(img[src*="emoji.php"]), [aria-label*="reaction" i], [aria-label*="cảm xúc" i]) {
      filter: grayscale(1) contrast(0) brightness(0.6) !important;
    }
    /* Exclude composer input and buttons so composition remains visible */
    html[${REDACT}] :is([role="textbox"], [role="textbox"] *, input, textarea, [data-fmess-ui="composer"], [data-fmess-ui="composer"] *) {
      color: inherit !important;
      -webkit-text-fill-color: initial !important;
      user-select: auto !important;
    }
    /* Specifically preserve Profile, Notifications/Mute, and Search action buttons and labels in details sidebar */
    html[${REDACT}] [${UNREDACT}],
    html[${REDACT}] [${UNREDACT}] * {
      background: transparent !important;
      color: var(--primary-text, inherit) !important;
      -webkit-text-fill-color: currentColor !important;
      user-select: auto !important;
    }
    /* Redact media (photos, videos, lightbox viewer, previews) synchronously on DOM insertion without route delay */
    html[${REDACT}] :is(img:not([src*="emoji.php"]), video) {
      filter: contrast(0) var(--fmess-redact-media) !important;
      user-select: none !important;
    }
    /* Redact avatars: flat gray circle without entropy (higher specificity overrides general media rule) */
    html[${REDACT}] #fmess-account,
    html[${REDACT}] :is([role="navigation"] [role="row"], [data-fmess-ui="chat-header"], [role="log"], [data-fmess-ui="details"] > div:first-child, [role="dialog"], [role="complementary"]) :is(img:not([src*="emoji.php"]), svg image, [role="img"]:not([aria-label*="emoji"])) {
      filter: grayscale(1) contrast(0) var(--fmess-redact-avatar) !important;
    }
  `;
  withRoot((root) => root.append(redactStyle));

  const updateRedactions = (root = document) => {
    if (!privacy.redactMode) return;
    const detailsTop = root.querySelector?.('[data-fmess-ui="details"] > div:first-child');
    if (detailsTop) {
      // Action buttons (Profile, Mute, Search) are icon-only buttons with adjacent text labels in the top header
      for (const btn of detailsTop.querySelectorAll('[role="button"]:not([aria-expanded])')) {
        if (btn.querySelector('[dir="auto"]')) continue;
        const label = btn.parentElement?.querySelector('[dir="auto"]');
        if (label && !label.hasAttribute(UNREDACT)) label.setAttribute(UNREDACT, '');
      }
      for (const span of detailsTop.querySelectorAll('[dir="auto"]')) {
        const text = span.textContent?.trim().toLowerCase();
        if (['profile', 'trang cá nhân', 'notifications', 'thông báo', 'mute', 'tắt thông báo', 'search', 'tìm kiếm'].includes(text) && !span.hasAttribute(UNREDACT)) {
          span.setAttribute(UNREDACT, '');
        }
      }
    }
    const main = root.querySelector?.('[role="main"]') ?? (typeof document !== 'undefined' ? document.querySelector('[role="main"]') : null);
    if (main) {
      const header = main.querySelector('[data-fmess-ui="chat-header"]');
      const log = main.querySelector('[role="log"]');
      if (header && log) {
        let curr = log;
        while (curr && curr !== header.parentElement && curr !== main) {
          let prev = curr.previousElementSibling;
          while (prev) {
            if (!prev.contains(header) && prev !== header) {
              if (!prev.hasAttribute('data-fmess-ui')) {
                prev.setAttribute('data-fmess-ui', 'pinned-banner');
              }
            }
            prev = prev.previousElementSibling;
          }
          curr = curr.parentElement;
        }
        let next = header.nextElementSibling;
        while (next && !next.contains(log)) {
          if (!next.hasAttribute('data-fmess-ui')) {
            next.setAttribute('data-fmess-ui', 'pinned-banner');
          }
          next = next.nextElementSibling;
        }
      }
    }
  };

  let redactFrame = 0;
  const redactWatcher = new MutationObserver(() => {
    redactFrame ||= requestAnimationFrame(() => ((redactFrame = 0), updateRedactions(document)));
  });

  const setRedactMode = (enabled) => {
    if (enabled === privacy.redactMode) return;
    privacy.redactMode = enabled;
    withRoot((root) => root.toggleAttribute(REDACT, enabled));
    redactWatcher.disconnect();
    cancelAnimationFrame(redactFrame);
    redactFrame = 0;
    if (enabled) {
      withRoot((root) => redactWatcher.observe(root, { childList: true, subtree: true, characterData: true }));
      updateRedactions(document);
    } else {
      for (const el of document.querySelectorAll(`[${UNREDACT}]`)) {
        el.removeAttribute(UNREDACT);
      }
      for (const el of document.querySelectorAll('[data-fmess-ui="pinned-banner"]')) {
        el.removeAttribute('data-fmess-ui');
      }
    }
  };
  setRedactMode(Boolean(settings.redactMode));

  const currentUserId = () => {
    try {
      return window.require('CurrentUserInitialData').USER_ID || null;
    } catch {
      return null;
    }
  };
  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  // Edits the JSON object in text with edit(value), which returns true when it
  // changed something; null when nothing changed. Ids are 64-bit numbers, so
  // only JSON that a parse and stringify give back unchanged is edited.
  const editJson = (text, edit) => {
    const value = parseJson(text);
    if (!value || typeof value !== 'object' || JSON.stringify(value) !== text) return null;
    return edit(value) ? JSON.stringify(value) : null;
  };
  // Same for object[key], which may hold the JSON as a string.
  const editNested = (object, key, edit) => {
    const value = object?.[key];
    if (value && typeof value === 'object') return edit(value);
    const edited = typeof value === 'string' ? editJson(value, edit) : null;
    if (edited === null) return false;
    object[key] = edited;
    return true;
  };

  const TYPING_LABEL = '3';
  const editRequest = (request) => {
    if (request.type === 4 && privacy.blockTyping) {
      return editNested(
        request,
        'payload',
        (update) =>
          update.label === TYPING_LABEL &&
          editNested(update, 'payload', (typing) => {
            if (!typing.is_typing) return false;
            typing.is_typing = 0;
            return true;
          }),
      );
    }
    return false;
  };
  const PART_DATA = 0x0d;
  const PART_CLOSE = 0x0e;
  // The frame with its requests edited, or null when nothing changed.
  const editFrame = (bytes) => {
    const parts = [];
    let edited = false;
    for (let pos = 0; pos < bytes.length; ) {
      if (bytes[pos] === PART_CLOSE) {
        parts.push(bytes.subarray(pos, pos + 3));
        pos += 3;
        continue;
      }
      if (pos + 6 > bytes.length) return null;
      const end = pos + 6 + (bytes[pos + 3] | (bytes[pos + 4] << 8) | (bytes[pos + 5] << 16));
      if (end > bytes.length) return null;
      let part = bytes.subarray(pos, end);
      const json = bytes[pos] === PART_DATA && end > pos + 8 ? new TextDecoder().decode(bytes.subarray(pos + 8, end)) : null;
      const request = json && editJson(json, editRequest);
      if (request) {
        const encoded = new TextEncoder().encode(request);
        const length = encoded.length + 2;
        part = new Uint8Array(8 + encoded.length);
        part.set(bytes.subarray(pos, pos + 3));
        part.set([length & 0xff, (length >> 8) & 0xff, length >> 16], 3);
        part.set(bytes.subarray(pos + 6, pos + 8), 6);
        part.set(encoded, 8);
        edited = true;
      }
      parts.push(part);
      pos = end;
    }
    if (!edited) return null;
    const frame = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    parts.reduce((offset, part) => (frame.set(part, offset), offset + part.length), 0);
    return frame;
  };
  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    const bytes =
      !privacy.blockTyping || !String(this.url).includes('/ws/lightspeed')
        ? null
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : null;
    return nativeSend.call(this, (bytes && editFrame(bytes)) || data);
  };
  // Requests to the worker are batches: [{type: 'request', content: {name, arg}}].
  const CHAT_STATE = 'sendChatStateFromComposer';
  const CHAT_IDLE = 'idle';
  const nativePostMessage = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (privacy.blockTyping && Array.isArray(message) && message.some((item) => item?.content?.name === CHAT_STATE)) {
      // Seen so far: typing and idle. Anything but idle shows the dots.
      message = message.map((item) =>
        item?.content?.name === CHAT_STATE && item.content.arg?.state !== CHAT_IDLE
          ? { ...item, content: { ...item.content, arg: { ...item.content.arg, state: CHAT_IDLE } } }
          : item,
      );
    }
    return nativePostMessage.call(this, message, ...rest);
  };


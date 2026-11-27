// Same measurements in fMess and in Chrome: frame times while the chat list
// and the messages scroll, and how long opening a chat takes. Opens read
// chats only, types nothing.
window.__fmessBench = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise(requestAnimationFrame);
  const stats = (d) => {
    if (!d.length) return null;
    const s = [...d].sort((a, b) => a - b);
    const at = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { frames: d.length, fps: Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)), median: at(0.5), p95: at(0.95), max: +s[s.length - 1].toFixed(1), over34ms: d.filter((x) => x > 34).length, over50ms: d.filter((x) => x > 50).length };
  };
  const framesFor = async (ms, each) => {
    const d = []; let last = await nextFrame(); const end = last + ms;
    while (last < end) { each?.(); const t = await nextFrame(); d.push(t - last); last = t; }
    return d;
  };
  // The box that scrolls around an element.
  const scroller = (from) => {
    for (let el = from?.parentElement; el; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 50) return el;
    }
    return null;
  };
  const threadOf = (path) => path.match(/\/t\/([^/]+)/)?.[1];
  // Scrolls at 1500 px/s whatever the frame rate, turning back at either end.
  const scrollFor = async (el, ms, startDown) => {
    let dir = startDown ? 1 : -1; let last = performance.now();
    return stats(await framesFor(ms, () => {
      const now = performance.now(); el.scrollTop += dir * 1.5 * (now - last); last = now;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) dir = -1; else if (el.scrollTop <= 0) dir = 1;
    }));
  };
  const out = { engine: /Chrome\//.test(navigator.userAgent) ? 'Chrome ' + navigator.userAgent.match(/Chrome\/(\d+)/)[1] : 'WebKit (fMess)', size: `${innerWidth}x${innerHeight}@${devicePixelRatio}x` };
  out.idle = stats(await framesFor(1500));
  const rows = [...document.querySelectorAll('[role="navigation"] [role="row"] a[role="link"][href*="/t/"]')].filter((a) => ![...a.querySelectorAll('span')].some((s) => parseInt(getComputedStyle(s).fontWeight) >= 600)).slice(0, 6);
  // Opening chats: from the click until its messages are drawn.
  out.openChat = [];
  const jank = [];
  for (const row of rows) {
    const thread = threadOf(new URL(row.href).pathname);
    const shown = new Set([...document.querySelectorAll('[role="main"] [data-message-id]')].map((m) => m.dataset.messageId));
    const fresh = () => [...document.querySelectorAll('[role="main"] [data-message-id]')].filter((m) => !shown.has(m.dataset.messageId)).length > 3;
    const t0 = performance.now();
    row.click();
    const frames = [];
    let last = t0, done = null;
    while (performance.now() - t0 < 8000) {
      const t = await nextFrame(); frames.push(t - last); last = t;
      if (!done && threadOf(location.pathname) === thread && fresh()) done = t - t0;
      if (done && t - t0 > done + 500) break;
    }
    out.openChat.push(done ? Math.round(done) : 'timeout');
    jank.push(...frames);
    await sleep(800);
  }
  out.openChatFrames = stats(jank);
  const list = scroller(document.querySelector('[role="navigation"] [role="row"]'));
  out.scrollChatList = list ? await scrollFor(list, 4000, true) : 'no list';
  if (list) list.scrollTop = 0;
  await sleep(1000);
  const log = scroller(document.querySelector('[role="main"] [role="log"] [data-message-id]'));
  out.scrollMessages = log ? await scrollFor(log, 4000, false) : 'no log';
  if (log) log.scrollTop = log.scrollHeight;
  return out;
};

// Types a Vietnamese sentence into the open chat's message box, a character
// every 80 ms, and measures each one: the page's own work, and the time until
// the frame that shows it. Never presses Enter; clears the box at the end.
window.__fmessTyping = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise(requestAnimationFrame);
  const stats = (d) => {
    const s = [...d].sort((a, b) => a - b);
    const at = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { n: d.length, median: at(0.5), p95: at(0.95), max: +s[s.length - 1].toFixed(1) };
  };
  // A read chat with a message box.
  if (!document.querySelector('[role="main"] [contenteditable="true"][role="textbox"]')) {
    const row = [...document.querySelectorAll('[role="navigation"] [role="row"] a[role="link"][href*="/t/"]')].find((a) => ![...a.querySelectorAll('span')].some((s) => parseInt(getComputedStyle(s).fontWeight) >= 600));
    row?.click();
    await sleep(3500);
  }
  const box = document.querySelector('[role="main"] [contenteditable="true"][role="textbox"]');
  if (!box) return { error: 'no message box' };
  if (box.textContent.trim()) return { error: 'the message box has a draft; left alone' };
  box.focus();
  await sleep(300);
  const text = 'xin chào các bạn, mình đang thử gõ tiếng Việt có dấu nè';
  const work = [], toScreen = [], frames = [];
  let last = await nextFrame();
  let typing = true;
  (async () => { while (typing) { const t = await nextFrame(); frames.push(t - last); last = t; } })();
  for (const ch of text) {
    const t0 = performance.now();
    document.execCommand('insertText', false, ch);
    work.push(performance.now() - t0);
    await nextFrame();
    await nextFrame();
    toScreen.push(performance.now() - t0);
    await sleep(Math.max(0, 80 - (performance.now() - t0)));
  }
  typing = false;
  const typed = box.textContent === text;
  // Empty the box again.
  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  await sleep(500);
  const fps = Math.round(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length));
  return { engine: /Chrome\//.test(navigator.userAgent) ? 'Chrome' : 'fMess', typedCorrectly: typed, boxEmptyAfter: !box.textContent.trim(), pageWorkMs: stats(work), keyToScreenMs: stats(toScreen), framesWhileTyping: { fps, over34ms: frames.filter((x) => x > 34).length, over50ms: frames.filter((x) => x > 50).length } };
};

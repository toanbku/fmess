// Live check, wake: what fMess does when the computer comes back from sleep
// (19-recover.js), with the clock jump a sleep leaves made up by the probe
// (window.__fmessCheckAwake, debug builds). Run by live-check.sh, which reads
// what it returns and what happens after (the page's recover: lines).
//
// __CASE__ is one of:
//   quiet   jumps too small to reload (a hidden page's late timer, a short
//           sleep), then a message being typed holds a real wake's reload
//           back until it's sent; returns, then empties the box: the page
//           should reload
//   wake    a sleep of six minutes, three seconds after returning: the page
//           should reload once Facebook answers (live-check.sh may cut the
//           network first)
const CASE = '__CASE__';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = window.__fmessCheckAwake;
if (typeof check !== 'function') return { error: 'no __fmessCheckAwake: not a debug build with 19-recover.js?' };
// A sleep of `ms`: a tick now (the clock where the timer expects it), then
// one as late as the sleep left it.
const sleep = (ms) => {
  check(Date.now());
  check(Date.now() + 15_000 + ms);
};
const reloads = () => performance.getEntriesByType('navigation')[0]?.type;
window.__fmessLiveMark = 'same page';
const result = { case: CASE, navigation: reloads() };

if (CASE === 'quiet') {
  sleep(70_000);
  await pause(4000);
  result.afterLateTimer = window.__fmessLiveMark;
  sleep(2 * 60_000);
  await pause(4000);
  result.afterShortSleep = window.__fmessLiveMark;
  // Typing: an editable box with text, focused (not Messenger's own box, so
  // nobody sees "typing…").
  const box = document.createElement('div');
  box.contentEditable = 'true';
  box.textContent = 'a message being typed';
  box.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(box);
  box.focus();
  result.typingFocused = document.activeElement === box;
  sleep(6 * 60_000);
  await pause(10_000);
  result.whileTyping = window.__fmessLiveMark;
  // Sent: the box empties; the reload should follow within a few seconds.
  setTimeout(() => {
    box.textContent = '';
  }, 2000);
  return result;
}

if (CASE === 'wake') {
  setTimeout(() => sleep(6 * 60_000), 3000);
  return result;
}
return { error: `unknown case ${CASE}` };

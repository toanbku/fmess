// Waits (up to 24 min) for someone to type in the open chat, then compares the
// typing dots' picture and bubble with an incoming message's. Reads only.
// Run with FMESS_PROBE_WAIT=1500; keep the loop time-based (a counted loop of
// 200 ms sleeps once gave up after 5 minutes).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findDots = () => [...document.querySelectorAll('[role="main"] [role="log"] [aria-hidden="true"]')].find((el) => !el.closest('[data-message-id]') && el.querySelector(':scope > div[role="presentation"] + div div[role="presentation"]'));
let dots = null;
const until = Date.now() + 24 * 60 * 1000;
while (!(dots = findDots()) && Date.now() < until) await sleep(200);
if (!dots) return { found: false };
const left = (el) => el && Math.round(el.getBoundingClientRect().left);
const typingPic = dots.querySelector(':scope > div[role="presentation"] svg, :scope > div[role="presentation"] img');
const typingBubble = dots.querySelector(':scope > div:nth-child(2) [role="presentation"]');
let msgPic = null, msgBubble = null;
for (const row of [...document.querySelectorAll('[role="main"] [data-message-id]')].reverse()) {
  const rl = row.getBoundingClientRect().left;
  msgPic = [...row.querySelectorAll('img, svg')].find((e) => { const r = e.getBoundingClientRect(); return r.width >= 24 && r.width <= 40 && r.left < rl + 60; });
  if (msgPic) { msgBubble = [...row.querySelectorAll('[role="presentation"]')].find((e) => e.querySelector('[dir="auto"]') && e.getBoundingClientRect().left > msgPic.getBoundingClientRect().right); break; }
}
return { typingPicture: left(typingPic), messagePicture: left(msgPic), typingBubble: left(typingBubble), messageBubble: left(msgBubble), pictureColumnPadding: getComputedStyle(dots.firstElementChild).paddingLeft };

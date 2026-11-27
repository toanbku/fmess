// Opens a photo in a read encrypted chat and checks fMess's handling of the viewer. Reads only; closes it at the end.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findPhoto = () => [...document.querySelectorAll('[role="main"] [data-message-id] img')].reverse().find((img) => { const r = img.getBoundingClientRect(); return r.width >= 100 && r.height >= 80 && r.top > 80 && r.bottom < innerHeight - 80; });
const barLink = () => [...document.querySelectorAll('a[download]')].find((a) => !a.closest('[role="main"]') && a.getBoundingClientRect().width > 0 && a.getBoundingClientRect().top < 120);
const html = document.documentElement;
const pseudo = (which) => { const s = getComputedStyle(html, which); return s.display === 'none' || s.content === 'none' || s.visibility === 'hidden' ? 'hidden' : 'shown'; };
const esc = () => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
const r = { before: { flag: html.hasAttribute('data-fmess-media'), titleAndBadge: pseudo('::before') + '/' + pseudo('::after') } };
let found = false;
for (const row of [...document.querySelectorAll('[role="navigation"] [role="row"] a[role="link"][href*="/e2ee/t/"]')].slice(0, 30)) {
  if ([...row.querySelectorAll('span')].some((s) => parseInt(getComputedStyle(s).fontWeight) >= 600)) continue;
  row.click(); await sleep(3500);
  const photo = findPhoto(); if (!photo) continue;
  (photo.closest('[role="button"], a') || photo).click(); await sleep(2500);
  found = true; break;
}
if (!found) return 'no photo';
r.open = { flag: html.hasAttribute('data-fmess-media'), titleAndBadge: pseudo('::before') + '/' + pseudo('::after'), barTop: Math.round(barLink()?.getBoundingClientRect().top ?? -1), innerHeight };
// Zoom with a double-click on the middle of the photo.
const big = [...document.querySelectorAll('img')].filter((i) => i.getBoundingClientRect().width > 300).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
const b = big.getBoundingClientRect();
big.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
await sleep(600);
const zoomed = () => [...document.querySelectorAll('img')].filter((i) => /scale\(/.test(i.style.transform)).map((i) => `${i.style.transform.match(/scale\(([\d.]+)\)/)[1]} on ${i.src.slice(0, 12)} ${Math.round(i.getBoundingClientRect().width)}px natural ${i.naturalWidth}`);
r.zoomedBy = zoomed();
r.measured = `${big.src.slice(0, 12)} natural ${big.naturalWidth}`;
esc(); await sleep(800);
r.afterFirstEscape = { zoom: zoomed(), viewerStillOpen: Boolean(barLink()) };
esc(); await sleep(1500);
r.afterSecondEscape = { viewerOpen: Boolean(barLink()), flag: html.hasAttribute('data-fmess-media'), titleAndBadge: pseudo('::before') + '/' + pseudo('::after') };
return r;

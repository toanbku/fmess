// Dresses the open window in demo content for the website: a 1:1 chat's last
// messages and the chat list get made-up names, pictures and lines. Nothing
// real stays visible: earlier messages, cards and banners are hidden.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVisible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
const out = { notes: [] };

const avatar = (letter, a, b) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="44" font-weight="600" fill="#fff">${letter}</text></svg>`,
  );
// DEMO_LANG = 'vi' (set before this file) gives Vietnamese names, lines and labels.
const VI = typeof DEMO_LANG !== 'undefined' && DEMO_LANG === 'vi';
const PEOPLE = (VI
  ? [
      ['Minh Anh', 'Bạn: 7h quán cũ nha?', '1 phút', 'M', '#ff8a65', '#f06292'],
      ['Team thiết kế', 'Long: icon mới lên rồi nha!', '12 phút', 'T', '#7c4dff', '#b388ff'],
      ['Hoàng Nam', 'Bạn: 8h gặp nha', '1 giờ', 'H', '#42a5f5', '#26c6da'],
      ['Thu Hà', 'Đã gửi một ảnh', '3 giờ', 'T', '#66bb6a', '#26a69a'],
      ['Quốc Bảo', 'Haha y chang 😂', '5 giờ', 'Q', '#ffca28', '#ffa726'],
      ['Hội leo núi', 'Khoa: 7h sáng tập trung nha', '8 giờ', 'L', '#26a69a', '#9ccc65'],
      ['Đức Long', 'Bạn: cảm ơn nhé!', '1 ngày', 'Đ', '#ec407a', '#ab47bc'],
      ['Phương Linh', 'Rảnh thì gọi mình nha', '2 ngày', 'P', '#5c6bc0', '#29b6f6'],
      ['Tuấn Kiệt', 'Hàng tới rồi nè 📦', '3 ngày', 'K', '#8d6e63', '#ff8a65'],
      ['CLB đọc sách', 'Hà: chương 5 đỉnh thật', '4 ngày', 'C', '#ef5350', '#ffa726'],
      ['Gia Huy', 'Bạn: 👍', '5 ngày', 'G', '#26c6da', '#5c6bc0'],
      ['Ngọc Trâm', 'Thứ Hai gặp nhé', '1 tuần', 'N', '#ab47bc', '#ff7043'],
    ]
  : [
      ['Mia Chen', 'You: 7pm, the usual place?', '1m', 'M', '#ff8a65', '#f06292'],
      ['Design team', 'Leo: new icons are up!', '12m', 'D', '#7c4dff', '#b388ff'],
      ['Sam Rivera', 'You: see you at 8', '1h', 'S', '#42a5f5', '#26c6da'],
      ['Jun Park', 'Sent a photo', '3h', 'J', '#66bb6a', '#26a69a'],
      ['Ana Souza', 'Haha same 😂', '5h', 'A', '#ffca28', '#ffa726'],
      ['Weekend hike', 'Kai: 7am at the trailhead', '8h', 'W', '#26a69a', '#9ccc65'],
      ['Leo Martins', 'You: thanks!', '1d', 'L', '#ec407a', '#ab47bc'],
      ['Priya Nair', 'Call me when you can', '2d', 'P', '#5c6bc0', '#29b6f6'],
      ['Tom Becker', 'The package arrived 📦', '3d', 'T', '#8d6e63', '#ff8a65'],
      ['Book club', 'Ana: chapter 5 was wild', '4d', 'B', '#ef5350', '#ffa726'],
      ['Noah Kim', 'You: 👍', '5d', 'N', '#26c6da', '#5c6bc0'],
      ['Ella Rossi', 'See you Monday', '1w', 'E', '#ab47bc', '#ff7043'],
    ]
).map(([name, snippet, time, letter, a, b]) => ({ name, snippet, time, pic: avatar(letter, a, b) }));
const ME = VI ? { name: 'Khoa Trần', pic: avatar('K', '#0866ff', '#a033ff') } : { name: 'Alex Kim', pic: avatar('A', '#0866ff', '#a033ff') };
const SCRIPT = VI
  ? [['in', 'Ủa đang xài laptop mới hả?'], ['in', 'Tưởng Messenger khai tử app trên Mac rồi mà 🤔'], ['out', 'Khai tử thật 😅'], ['out', 'Đây là fMess, thông báo, gọi điện đủ cả 🎉'], ['out', 'Tối nay đi ăn không? 🍜'], ['out', '7h quán cũ nha?']]
  : [['in', 'Still on the new laptop?'], ['in', 'Thought Messenger killed the Mac app 🤔'], ['out', 'They did 😅'], ['out', 'This is fMess: notifications, calls, everything 🎉'], ['out', 'Dinner tonight? 🍜'], ['out', '7pm, the usual place?']];
const ACTIVE = VI ? 'Đang hoạt động' : 'Active now';

const setPic = (el, url) => {
  if (el instanceof HTMLImageElement) {
    el.srcset = '';
    el.src = url;
  } else {
    el.setAttribute('href', url);
    el.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
  }
};
const textNodes = (root) => {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent.trim() && isVisible(n.parentElement)) nodes.push(n);
  return nodes;
};

// 1. A read 1:1 chat whose last messages are text, from both sides.
const rows = () => [...document.querySelectorAll('[role="navigation"] [role="row"] a[href*="/messages/"]')].filter(isVisible);
for (let i = 0; i < 40 && !rows().length; i++) await sleep(250);
const util = window.require('LSMessagingThreadTypeUtil');
const ReQL = window.require('ReQL');
const db = await window.require('LSDatabaseSingleton').LSDatabaseSingleton;
const int64Key = (id) => {
  const v = BigInt(id);
  return [Number(v >> 32n), Number(v & 0xffffffffn)];
};
const logRows = () => {
  const log = document.querySelector('[role="main"] [role="log"]');
  return log ? [...log.querySelectorAll('[data-message-id]')].filter(isVisible) : [];
};
const bubbleTexts = (row) =>
  [...row.querySelectorAll('[role="presentation"] > [dir="auto"]')].filter((b) => isVisible(b) && parseFloat(getComputedStyle(b.parentElement).paddingTop) > 0);
const side = (row) => {
  const main = document.querySelector('[role="main"] [role="log"]').getBoundingClientRect();
  const box = bubbleTexts(row)[0]?.getBoundingClientRect();
  return box && box.left + box.width / 2 > main.left + main.width / 2 ? 'out' : 'in';
};
const isTextRow = (row) =>
  bubbleTexts(row).length === 1 &&
  ![...row.querySelectorAll('[aria-label]')].some((e) => isVisible(e) && /reacted|reaction/i.test(e.getAttribute('aria-label'))) &&
  row.getBoundingClientRect().height < 300 &&
  ![...row.querySelectorAll('img, video, image')].some((m) => isVisible(m) && m.getBoundingClientRect().width > 40);
// DEMO_CHAT = '<thread id>' (set before this file) tries that chat first.
const PIN = typeof DEMO_CHAT !== 'undefined' ? String(DEMO_CHAT) : '';
let chosen = null;
const pinned = PIN && rows().find((link) => link.getAttribute('href').includes(PIN));
for (const link of pinned ? [pinned, ...rows().slice(0, 15)] : rows().slice(0, 15)) {
  if (/Unread message/i.test(link.textContent)) continue;
  const id = link.getAttribute('href').match(/\/t\/(\d+)/)?.[1];
  const thread = id && (await ReQL.firstAsync(ReQL.fromTableAscending(db.tables.threads).getKeyRange(int64Key(id))));
  if (!thread || util.isGroup(thread.threadType)) continue;
  link.click();
  for (let i = 0; i < 20 && logRows().length < 6; i++) await sleep(250);
  await sleep(1200);
  const last = logRows().slice(-6);
  const sides = last.map(side);
  if (last.length >= 5 && last.every(isTextRow) && sides.includes('in') && sides.includes('out')) {
    chosen = { link, last };
    break;
  }
}
if (!chosen) return { error: 'no suitable chat' };
out.chat = 'found';

// Details pane closed.
const details = document.querySelector('[role="main"] [aria-label="Conversation information"]');
if (document.querySelector('[role="main"] [role="button"][aria-label="Search"]')) details?.click();
await sleep(600);

// 2. The messages: the last ones get demo lines, everything else in the log goes.
const keep = new Set(chosen.last);
const log = document.querySelector('[role="main"] [role="log"]');
for (const row of log.querySelectorAll('[data-message-id]')) if (!keep.has(row)) row.style.display = 'none';
// Whatever else is in the log (dates, cards, banners) unless it holds a kept row.
const hideOthers = (el) => {
  for (const child of el.children) {
    if ([...keep].some((row) => child === row || child.contains(row))) {
      if (!keep.has(child)) hideOthers(child);
    } else child.style.display = 'none';
  }
};
hideOthers(log);
const sides = chosen.last.map(side);
const used = new Set();
const lineFor = (side) => {
  const i = SCRIPT.findIndex(([s], k) => s === side && !used.has(k));
  if (i < 0) return '👍';
  used.add(i);
  return SCRIPT[i][1];
};
chosen.last.forEach((row, i) => {
  const text = lineFor(sides[i]);
  const blocks = bubbleTexts(row);
  blocks.forEach((block, j) => {
    const nodes = textNodes(block);
    nodes.forEach((n, k) => (n.textContent = j === 0 && k === 0 ? text : ''));
    for (const img of block.querySelectorAll('img')) img.style.display = 'none';
  });
  // Anything else written in the row (names, "Edited", reply previews) goes.
  for (const n of textNodes(row)) if (!blocks.some((b) => b.contains(n))) n.parentElement.style.visibility = 'hidden';
  for (const pic of row.querySelectorAll('img, image')) if (!blocks.some((b) => b.contains(pic))) setPic(pic, PEOPLE[0].pic);
});

// 3. The chat list.
// The open chat is Mia's wherever it sits in the list; the rest in order.
let next = 1;
rows().slice(0, PEOPLE.length).forEach((link) => {
  const p = link === chosen.link ? PEOPLE[0] : PEOPLE[next++] ?? PEOPLE[PEOPLE.length - 1];
  const nodes = textNodes(link).filter((n) => n.parentElement.getBoundingClientRect().width > 2).map((n) => ({ n, top: n.parentElement.getBoundingClientRect().top }));
  const firstTop = Math.min(...nodes.map((x) => x.top));
  const line1 = nodes.filter((x) => x.top < firstTop + 8).map((x) => x.n);
  const line2 = nodes.filter((x) => x.top >= firstTop + 8 && x.top < firstTop + 34).map((x) => x.n);
  for (const x of nodes) if (x.top >= firstTop + 34) x.n.textContent = '';
  line1.forEach((n, k) => (n.textContent = k === 0 ? p.name : ''));
  const age = line2.findIndex((n) => n.textContent.trim() === '·');
  line2.forEach((n, k) => {
    if (k === 0) n.textContent = p.snippet;
    else if (k === age) n.textContent = ' · ';
    else if (age > 0 && k === age + 1) n.textContent = p.time;
    else n.textContent = '';
  });
  for (const img of link.querySelectorAll('img')) if (img.getBoundingClientRect().width <= 24) img.style.display = 'none';
  for (const pic of link.querySelectorAll('img, image')) if (isVisible(pic.closest('svg') || pic)) setPic(pic, p.pic);
});
// Rows further down get hidden content too.
for (const link of rows().slice(PEOPLE.length)) link.style.visibility = 'hidden';

// 4. The header, the account and banners.
const main = document.querySelector('[role="main"]');
const header = details?.closest('[role="main"] div:has([role="log"]) > div');
if (header) {
  const top = header.getBoundingClientRect().top;
  for (const child of header.querySelectorAll('*')) {
    const r = child.getBoundingClientRect();
    if (r.top >= top + 56 && r.height > 20 && !child.contains(details)) child.style.display = 'none';
  }
  const nodes = textNodes(header).filter((n) => n.parentElement.getBoundingClientRect().width > 2);
  const nameAt = Math.max(0, nodes.findIndex((n) => n.parentElement.closest('h1, h2, h3')));
  nodes.forEach((n, k) => (n.textContent = k === nameAt ? PEOPLE[0].name : k === nameAt + 1 ? ACTIVE : ''));
  for (const pic of header.querySelectorAll('img, image')) setPic(pic, PEOPLE[0].pic);
}
// The chat's own colour and quick reaction back to Messenger's (a theme sets its own colours).
if (!document.getElementById('fmess-theme')?.textContent) {
  for (const host of document.querySelectorAll('[style*="--chat-outgoing-message-bubble-background-color"]')) {
    host.style.setProperty('--chat-outgoing-message-bubble-background-color', '#0866ff');
    host.style.setProperty('--chat-outgoing-message-background-gradient', 'none');
    host.style.setProperty('--chat-outgoing-message-text-color', '#ffffff');
  }
}
const like = [...main.querySelectorAll('[aria-label="Thread composer"] [role="button"][aria-label^="Send a"]')].find((b) => !/voice/i.test(b.getAttribute('aria-label')));
if (like?.querySelector('img')) {
  for (const img of like.querySelectorAll('img')) img.style.display = 'none';
  const thumb = document.createElement('span');
  thumb.textContent = '👍';
  thumb.style.cssText = 'font-size: 20px; line-height: 20px;';
  like.querySelector('div')?.append(thumb);
}
const account = document.getElementById('fmess-account');
if (account) {
  account.style.backgroundImage = `url("${ME.pic}")`;
  account.textContent = '';
}
document.documentElement.style.setProperty('--fmess-avatar', `url("${ME.pic}")`);
document.documentElement.setAttribute('data-fmess-name', ME.name);
document.documentElement.removeAttribute('data-fmess-unread');
// The composer's "Write to …" placeholder names the person too.
for (const el of main.querySelectorAll('[aria-label="Thread composer"] *')) {
  if (!el.children.length && /Write to|Aa/.test(el.textContent) && isVisible(el)) el.textContent = 'Aa';
}
// Notification prompts above the list.
for (const el of document.querySelectorAll('[role="navigation"] [role="alert"], [role="navigation"] [role="banner"]')) el.style.display = 'none';
if (VI) {
  const LABELS = { Chats: 'Đoạn chat', All: 'Tất cả', Unread: 'Chưa đọc', Groups: 'Nhóm', Communities: 'Cộng đồng' };
  for (const el of document.querySelectorAll('[role="navigation"] h1 a, [role="navigation"] [role="tab"]')) for (const n of textNodes(el)) if (LABELS[n.textContent.trim()]) n.textContent = LABELS[n.textContent.trim()];
  const search = document.querySelector('[role="navigation"] input[type="search"]');
  if (search) search.placeholder = 'Tìm kiếm trên Messenger';
  for (const el of document.querySelectorAll('[role="navigation"] [role="tablist"] > *')) if (!el.querySelector('[role="tab"]')) el.style.display = 'none';
  const theme = document.getElementById('fmess-theme')?.textContent ?? '';
  const words = document.createElement('style');
  if (/name: WhatsApp/.test(theme)) words.textContent = '[role="navigation"] label:has(input[type="search"]:placeholder-shown)::after { content: "Tìm kiếm" !important; }';
  if (/name: Zalo/.test(theme)) search && (search.placeholder = 'Tìm kiếm');
  document.documentElement.append(words);
}
// Hover and selection states off.
getSelection().removeAllRanges();
document.activeElement?.blur?.();

await sleep(800);
// 5. What could still be real: pictures from Facebook's content servers.
const realPics = [...document.querySelectorAll('img, image')].filter((p) => {
  const src = p.getAttribute('src') || p.getAttribute('href') || p.getAttribute('xlink:href') || '';
  return /scontent|fbcdn\.net\/v\/|lookaside/.test(src) && isVisible(p.closest('svg') || p);
});
out.realPicsLeft = realPics.length;
out.realPicsWhere = realPics.slice(0, 6).map((p) => {
  const r = (p.closest('svg') || p).getBoundingClientRect();
  return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}`;
});
out.size = [innerWidth, innerHeight];
return out;

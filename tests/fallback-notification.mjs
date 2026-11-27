// Runs fMess's own notification for new messages (notifyNewestChat, used when
// Messenger stays quiet) against a fake chat list: it says each message once.
// `node tests/fallback-notification.mjs`
import { readdirSync, readFileSync } from 'node:fs';

// The page script's parts, joined in file-name order as build.rs does.
// Windows checkouts may have CRLF line ends.
const parts = new URL('../src-tauri/src/inject/', import.meta.url);
const src = readdirSync(parts)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => readFileSync(new URL(name, parts), 'utf8'))
  .join('')
  .replace(/\r\n/g, '\n');
const fallback = src.match(/  const chatRecord = async[\s\S]*?\n  const notifyNewestChat = async[\s\S]*?\n  };\n/)[0];

const ME = '1';
const NOW = 1_000_000_000;

// A chat list: each chat has a row (name, preview, unread) and Messenger's
// copy of it (who sent the newest message, when, and read up to when).
function world(chats) {
  const w = { notices: [], now: NOW, chats, pageNotifiedUpTo: new Map(), fromMessenger: true };
  const row = (chat) => ({ chat, getAttribute: (name) => (name === 'href' ? `/messages/t/${chat.id}/` : null), querySelector: () => null });
  const env = {
    chatLinks: () => w.chats.map(row),
    unreadChats: async (rows) => Object.assign(rows.filter((r) => r.chat.unread), { fromMessenger: w.fromMessenger }),
    chatSummary: (r) => ({ name: r.chat.name, preview: r.chat.preview }),
    currentUserId: () => ME,
    loadModules: async () => {},
    window: {
      require: (name) =>
        ({
          ReQL: { firstAsync: async (row) => row, fromTableAscending: (table) => ({ getKeyRange: (key) => table[key] }) },
          LSDatabaseSingleton: {
            LSDatabaseSingleton: Promise.resolve({
              tables: {
                get threads() {
                  return Object.fromEntries(
                    w.chats.map((c) => [c.id, { snippetSenderContactId: c.from, lastActivityTimestampMs: c.at, lastReadWatermarkTimestampMs: c.readTo ?? 0 }]),
                  );
                },
              },
            }),
          },
        })[name],
    },
    int64: (value) => BigInt(value ?? 0),
    int64Key: (id) => String(id),
    serverNow: () => w.now,
    LATE_MS: 2 * 60 * 1000,
    pageNotifiedUpTo: w.pageNotifiedUpTo,
    isMuted: () => false,
    lastPageNotification: 0,
    raisingFallback: false,
    FMessNotification: class {
      constructor(title, { body }) {
        w.notices.push(`${title}: ${body}`);
      }
    },
    say: (en) => en,
  };
  const run = new Function(...Object.keys(env), `${fallback}return notifyNewestChat;`);
  w.notify = run(...Object.values(env));
  return w;
}

const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}`);

{
  // The count rose twice in a row for one message.
  const w = world([{ id: '10', name: 'An', preview: 'hi', unread: true, from: '2', at: NOW - 1000 }]);
  await Promise.all([w.notify(), w.notify()]);
  await w.notify();
  check('one message, one notification', w.notices.length === 1, w.notices);
}
{
  // Hours later the chat's activity moves (a reaction, a computer back from
  // sleep) while its row still shows the same message.
  const w = world([{ id: '10', name: 'Trung', preview: 'Reacted 😆 to your message', unread: true, from: '2', at: NOW - 1000 }]);
  await w.notify();
  w.now += 3 * 3600 * 1000;
  w.chats[0].at = w.now - 1000;
  await w.notify();
  check('the same row is not said again', w.notices.length === 1, w.notices);
  w.chats[0].preview = 'ok';
  w.chats[0].at = w.now;
  await w.notify();
  check('a new message in that chat is', w.notices.length === 2 && w.notices[1] === 'Trung: ok', w.notices);
}
{
  // Messenger notified about the chat's newest message itself.
  const w = world([{ id: '10', name: 'An', preview: 'hi', unread: true, from: '2', at: NOW - 1000 }]);
  w.pageNotifiedUpTo.set('10', NOW - 1000);
  await w.notify();
  check('nothing when Messenger said it already', w.notices.length === 0, w.notices);
  w.chats[0].preview = 'are you there?';
  w.chats[0].at = NOW;
  await w.notify();
  check('a newer message Messenger left out is said', w.notices.length === 1, w.notices);
}
{
  // Old news and your own messages stay quiet, as before.
  const w = world([
    { id: '10', name: 'Me', preview: 'You: hi', unread: true, from: ME, at: NOW },
    { id: '11', name: 'Old', preview: 'hey', unread: true, from: '2', at: NOW - 10 * 60 * 1000 },
  ]);
  await w.notify();
  check('own and late messages stay quiet', w.notices.length === 0, w.notices);
}

{
  // Two messages that read the same: "ok", you read it, then a new "ok".
  const w = world([{ id: '10', name: 'An', preview: 'ok', unread: true, from: '2', at: NOW - 1000 }]);
  await w.notify();
  w.chats[0].readTo = NOW - 1000;
  w.now += 60 * 1000;
  w.chats[0].at = w.now - 1000;
  await w.notify();
  check('the same words after reading are a new message', w.notices.length === 2, w.notices);
}
{
  // The chat that raised the count was read or muted while fMess waited;
  // the newest chat in the list is a muted group.
  const w = world([{ id: '20', name: 'Muted group', preview: 'spam', unread: false, from: '2', at: NOW - 500 }]);
  await w.notify();
  check('no unread chat left: nothing, not the newest chat', w.notices.length === 0, w.notices);
  w.fromMessenger = false;
  await w.notify();
  check("without Messenger's copy, the newest chat is tried", w.notices.length === 1, w.notices);
}

console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exit(1);

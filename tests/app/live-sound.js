// Live check, sound: whether a notification rings, decided as on Windows
// (window.__fmessRingAnywhere, debug builds; see shouldRing in
// 14-notifications.js), with Messenger's real sound (playChatTabSound, played
// by SoundPlayer through fMess's Web Audio) and Messenger's real preferences:
// Do Not Disturb and its sounds, turned off and back on as they were, and the
// Mac muted (live-check.sh mutes it on "sound: mute"). Each case raises a test
// notification "fMess live check S<n>"; live-check.sh compares what fMess's
// native side was told (its debug log) with what the case wants, and checks
// that Messenger's sound did play where the case needs it.
const lazy = (names) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${names}`)), 20000);
    window.requireLazy(names, (...modules) => {
      clearTimeout(timer);
      resolve(modules);
    });
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text) => window.__fmessErrors?.push(`sound: ${text}`);
const read = window.__fmessReadMessengerPrefs;
const report = window.__fmessReportMessengerPrefs;
const set = window.__fmessSetMessengerPref;
if (!read || !report || !set) return { error: 'no debug hooks for Messenger preferences' };
const before = await read();
if (!before) return { error: "couldn't read Messenger's preferences" };
const cases = [];
const notes = [`before: Messenger's sounds ${before.soundsOn ? 'on' : 'off'}, Do Not Disturb ${before.muteUntil === 0 ? 'off' : `until ${before.muteUntil}`}`];

// Messenger plays its sound through Sound, which it waits for without loading
// it (requireDeferred): until a real message has loaded it, nothing plays.
const [popper, ReQL, database, player, I64, user] = await lazy(['MWLSChatPopperCommon', 'ReQL', 'LSDatabaseSingleton', 'SoundPlayer', 'I64', 'CurrentUser', 'Sound']);
const db = await database.LSDatabaseSingleton;
// Messenger plays its sound only for someone else's message.
const recent = await ReQL.toArrayAsync(ReQL.fromTableDescending(db.tables.messages).take(200));
const theirs = recent.find((row) => I64.to_string(row.senderId) !== user.getID());
if (!theirs) return { error: 'no message from someone else on this computer' };
// And only for a message sent just now (Sound skips old ones): as if it had
// just come in.
const fresh = () => ({ ...theirs, timestampMs: I64.of_float(Date.now()) });
// Whether Messenger asked SoundPlayer to play, and whether a sound came out
// (fMess plays Messenger's sounds through Web Audio).
let plays = 0;
let heard = 0;
const playerPlay = player.play;
player.play = function (...args) {
  plays += 1;
  return playerPlay.apply(this, args);
};
const sourceStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function (...args) {
  heard += 1;
  return sourceStart.apply(this, args);
};
// Messenger's sound for a new message, waited for (Messenger first asks
// whether its sounds are on, which can take a moment).
let pinged = null;
const ping = async () => {
  const before = plays;
  try {
    popper.playChatTabSound(fresh());
  } catch (error) {
    notes.push(`playChatTabSound threw ${error}`);
  }
  for (let i = 0; i < 20 && plays === before; i++) await pause(100);
  await pause(300);
  pinged = plays > before;
};
let count = 0;
// want: whether it rings; ping: whether Messenger's sound must have played
// (true) or must not have (false) just before.
const notify = async (name, want, { ping: wantPing, ...options } = {}) => {
  const id = `S${++count}`;
  new Notification(`fMess live check ${id}`, { body: name, tag: `fmess-live-${id}-${Date.now()}`, ...options });
  await pause(1500);
  cases.push({ id, name, want, ping: wantPing ?? null, pinged });
  pinged = null;
};
// The notification first, Messenger's sound just after: it rings, and
// Messenger's sound is held back.
const notifyThenPing = async (name) => {
  const id = `S${++count}`;
  new Notification(`fMess live check ${id}`, { body: name, tag: `fmess-live-${id}-${Date.now()}` });
  const before = { plays, heard };
  await pause(50);
  try {
    popper.playChatTabSound(fresh());
  } catch {}
  await pause(2000);
  cases.push({ id, name, want: true, ping: null, pinged: null, heldBack: plays > before.plays && heard === before.heard, asked: plays > before.plays });
};
// Long enough that Messenger's last sound no longer counts (3 s).
const later = () => pause(3500);
const refresh = async () => {
  await report();
  await pause(500);
};
const restoreMute = async () => {
  const until = before.muteUntil;
  await set('muteFor', until === 0 ? 0 : until < 0 ? -1 : Math.max(until * 1000 - Date.now(), 0));
};

try {
  window.__fmessRingAnywhere = true;
  await refresh();
  await ping();
  await notify("after Messenger's sound played, the notification is quiet (one sound)", false, { ping: true });
  await later();
  await notifyThenPing("Messenger's sound coming just after: the notification rings and Messenger's sound is held back (one sound)");
  await later();
  await notify("with no sound from Messenger (its 4th message in a chat), it rings", true);
  await notify('a notification asking for silence is quiet', false, { silent: true });

  say('mute');
  await pause(4000);
  await ping();
  await notify("the Mac muted: Messenger's sound still played (silently), so quiet", false, { ping: true });
  await later();
  await notify("the Mac muted, no sound from Messenger: it rings (the system keeps it quiet)", true);
  say('unmute');
  await pause(3000);

  await set('muteFor', 10 * 60_000);
  await refresh();
  await ping();
  await notify('during Do Not Disturb it is quiet, and so is Messenger', false);
  await restoreMute();
  await refresh();
  await later();
  await notify('Do Not Disturb off again: it rings', true);

  await set('soundsOn', false);
  await refresh();
  await ping();
  await notify("with Messenger's sounds off it is quiet, and Messenger plays none", false, { ping: false });
  await set('soundsOn', true);
  await refresh();
  await later();
  await notify("Messenger's sounds on again: it rings", true);
  await later();
  await ping();
  await notify("Messenger's sounds on again: its sound plays, so quiet", false, { ping: true });

  window.__fmessRingAnywhere = false;
  await notify('on macOS notifications stay silent (Messenger plays its own sound)', false);
} catch (error) {
  notes.push(`stopped: ${error}`);
} finally {
  window.__fmessRingAnywhere = false;
  player.play = playerPlay;
  AudioBufferSourceNode.prototype.start = sourceStart;
  await set('soundsOn', before.soundsOn).catch(() => {});
  await restoreMute().catch(() => {});
  await refresh().catch(() => {});
  const after = await read().catch(() => null);
  notes.push(`after: Messenger's sounds ${after?.soundsOn ? 'on' : 'off'}, Do Not Disturb ${after?.muteUntil === 0 ? 'off' : `until ${after?.muteUntil}`}`);
}
return { cases, notes };

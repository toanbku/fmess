// Live check, "Couldn't load chats" (#24): the encrypted chats' worker dies
// and can't start again, as it did in the background on macOS 27. Messenger's
// own calls: setPreventWorkerRestart, terminateWorker; then the worker gets
// work (reading ahead encrypted chats further down the list, which opens no
// chat). live-check.sh watches what fMess does (its recover: lines).
//
// __CASE__: first  fMess should reload by itself
//           again  as if it had just done so: the screen should stay
const CASE = '__CASE__';
const lazy = (names) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${names}`)), 20000);
    window.requireLazy(names, (...modules) => {
      clearTimeout(timer);
      resolve(modules);
    });
  });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const [setup, ReQL, database, util, preload] = await lazy([
  'MAWSetupWorker',
  'ReQL',
  'LSDatabaseSingleton',
  'LSMessagingThreadTypeUtil',
  'MAWPreloadSecureMessages',
]);
if (CASE === 'again') sessionStorage.setItem('fmess.recovered', JSON.stringify({ at: Date.now(), reason: 'chats error' }));
const db = await database.LSDatabaseSingleton;
const chats = await ReQL.toArrayAsync(ReQL.fromTableDescending(db.tables.threads.index('lastActivityTimestampMs')).take(60));
const secure = chats.filter((chat) => util.isArmadilloSecure(chat.threadType)).slice(15, 18);
setup.setPreventWorkerRestart(true);
await Promise.race([setup.terminateWorker('fmess_live_check'), pause(10000)]);
window.__fmessErrors?.push(`chats-error: worker killed @${Date.now()}`);
for (const chat of secure) {
  await Promise.race([preload.preloadSecureMessages(db, chat.threadKey, 20, chat.authorityLevel).catch(() => null), pause(15000)]);
}
await pause(2000);
return { case: CASE, secureChats: secure.length, shown: /Couldn.t load chats/.test(document.body.innerText) };

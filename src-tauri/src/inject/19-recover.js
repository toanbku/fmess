  // Getting Messenger back by itself. Three things left it stuck until the
  // page was reloaded by hand, and fMess now reloads it then:
  //  - Sleep: while the computer sleeps, the page's connections to Facebook
  //    die without the page noticing. After a night's sleep, messages sent in
  //    the morning sat at "Sending". Sleep shows as a jump in the clock between
  //    two ticks of a timer, since timers don't run while the computer
  //    sleeps; a hidden page's timers can run late, but by about a minute
  //    (Chromium's), well under SLEPT_MS. As Ferdium does (reloadAfterResume).
  //  - A connection that stays down: Messenger keeps four WebSockets to
  //    gateway.facebook.com (lightspeed: messages; realtime; rpsignaling:
  //    calls; streamcontroller). After five minutes offline it took 77 s to
  //    bring messages back once the network was, and it had given up on the
  //    calls one for good (live checks, tests/app/live-check.sh). So once
  //    Facebook answers again, a socket that has worked before and is still
  //    down DOWN_MS later gets the page reloaded.
  //  - "Couldn't load chats": the encrypted chats' worker died and couldn't
  //    start again (#24: in the background, on macOS 27). Messenger offers
  //    Reload; fMess reloads once by itself. Should the screen come back
  //    soon after, it stays, for Messenger's own Reload (which can also clear
  //    and fetch again the encrypted chats stored on this computer).
  //  - Encrypted chats that never load, with no error screen: their rows in
  //    the list show grey bars where the last message and its time go, and
  //    an open one spins for good. STUCK_MS of that in the list, or
  //    CHAT_STUCK_MS of an open one spinning with no message, while online,
  //    reloads; stuck again soon after, fMess starts again (recover.rs). Seen after a reload that a Mac's dark wake
  //    cut short (below). Treated as the error screen.
  // A reload waits for an empty message box (a message being typed is let be
  // until it's sent), for Facebook to answer and for the computer to have
  // been awake STEADY_MS, and comes at most every AGAIN_MS. Messages left
  // waiting go out after it. A Mac wakes in the dark for a few seconds now
  // and then (DarkWake: its lid shut, for mail or backups) and sleeps again:
  // a reload there was cut short mid-load and left the encrypted chats stuck
  // until fMess was quit (0.1.36, a night's sleep). Nor does it come in the
  // page's first SETTLED_MS: a reload while Messenger's encrypted chats'
  // worker starts can leave that worker hung for good (2 of 8 reloads 3 s in,
  // tests/app/fuzz-check.sh; Messenger: "WorkerHealthStatus:
  // shared_exists_and_connected").
  const RECOVER = {
    tickMs: 15_000,
    sleptMs: 5 * 60_000,
    downMs: 30_000,
    retryMs: 3_000,
    againMs: 2 * 60_000,
    chatsErrorAgainMs: 10 * 60_000,
    steadyMs: 20_000,
    settledMs: 30_000,
    stuckMs: 90_000,
    chatStuckMs: 60_000,
  };
  const STUCK = 'encrypted chats stuck';
  // Debug builds: what happened, for live checks (with the time, in ms).
  const recoverNote = (text) => window.__fmessErrors?.push(`recover: ${text} @${Date.now()}`);
  const lastRecovery = () => {
    try {
      return JSON.parse(sessionStorage.getItem('fmess.recovered') || 'null');
    } catch {
      return null;
    }
  };

  // Messenger's WebSockets to Facebook, by kind (the path after /ws/): the
  // newest of each is the one in use (Messenger leaves a dead one behind
  // without closing it, and opens another).
  const gatewaySockets = new Map();
  if (!window.opener) {
    const Native = window.WebSocket;
    window.WebSocket = new Proxy(Native, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(String(args[0]));
          const kind = url.hostname.endsWith('facebook.com') && url.pathname.startsWith('/ws/') ? url.pathname.slice(4) : null;
          if (kind) {
            const entry = { socket, since: Date.now(), open: false, worked: gatewaySockets.get(kind)?.worked ?? false };
            gatewaySockets.set(kind, entry);
            socket.addEventListener('open', () => {
              entry.open = true;
              entry.worked = true;
              entry.since = Date.now();
            });
            socket.addEventListener('close', () => {
              entry.open = false;
              entry.since = Date.now();
            });
          }
        } catch {}
        return socket;
      },
    });
  }
  // Kinds that have worked and have been down for DOWN_MS.
  const deadSockets = (now) =>
    [...gatewaySockets]
      .filter(([, entry]) => entry.worked && !entry.open && now - entry.since >= RECOVER.downMs)
      .map(([kind]) => kind);

  let recovering = false;
  const typing = () => {
    const box = document.activeElement;
    return Boolean(box?.isContentEditable && box.textContent.trim());
  };
  // Whether Facebook answers. On a network that's still dead a request gets
  // no answer at all, hence the timeout. And after one, WebKit kept sending
  // requests to www.facebook.com down its old, dead connection until it gave
  // up on it, 44 s later (live checks): m.facebook.com, which the page
  // doesn't use, is asked at the same time on a connection of its own (no
  // CORS there, so only whether it answers counts).
  const answering = () => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 5_000);
    const ask = { cache: 'no-store', credentials: 'omit', signal: timeout.signal };
    return Promise.any([
      fetch('/favicon.ico', ask).then((response) => response.ok || Promise.reject(new Error(`HTTP ${response.status}`))),
      fetch('https://m.facebook.com/favicon.ico', { ...ask, mode: 'no-cors' }),
    ])
      .then(
        () => true,
        () => false,
      )
      .finally(() => clearTimeout(timer));
  };
  // Reloads for `reason` as soon as it may.
  const recover = (reason) => {
    if (recovering || window.opener) return;
    const last = lastRecovery();
    const chats = reason === 'chats error' || reason === STUCK;
    const again = chats ? RECOVER.chatsErrorAgainMs : RECOVER.againMs;
    const recent = last && Date.now() - last.at < again && (!chats || last.reason === reason);
    // Stuck again soon after a reload for it: the worker outlives reloads, so
    // fMess starts again (recover.rs, at most every 30 minutes).
    const restart = recent && reason === STUCK;
    if (recent && !restart) {
      recoverNote(`not again so soon: ${reason}`);
      return;
    }
    recovering = true;
    recoverNote(reason);
    // Awake since when: the tries come every few seconds, so a longer gap
    // between two is a sleep, and the count starts again.
    let awakeSince = Date.now();
    let lastTry = awakeSince;
    const attempt = async () => {
      const now = Date.now();
      if (now - lastTry > RECOVER.retryMs + 12_000) awakeSince = now;
      lastTry = now;
      const awake = now - awakeSince >= RECOVER.steadyMs && performance.now() >= RECOVER.settledMs;
      if (awake && !typing() && navigator.onLine !== false && (await answering())) {
        if (restart) {
          recoverNote('starting fMess again');
          const started = await invoke('restart_for_stuck_chats', { reason }).catch(() => false);
          if (!started) {
            recoverNote(`not again so soon: ${reason}`);
            recovering = false;
          }
          return;
        }
        recoverNote('reloading');
        try {
          sessionStorage.setItem('fmess.recovered', JSON.stringify({ at: Date.now(), reason }));
        } catch {}
        location.reload();
        return;
      }
      setTimeout(attempt, RECOVER.retryMs);
    };
    attempt();
  };
  if (!window.opener) {
    const last = lastRecovery();
    // At the time of the reload: a note made just before it is lost with the page.
    if (last && Date.now() - last.at < 60_000) window.__fmessErrors?.push(`recover: reloaded (${last.reason}) @${last.at}`);
    let lastTick = Date.now();
    // Since when Facebook has answered while a socket was down.
    let answeringSince = 0;
    // Since when every encrypted chat in the list has shown no last message,
    // and since when the open encrypted chat has spun with none of its own.
    let stuckSince = 0;
    let chatStuckSince = 0;
    const openChatStuck = () =>
      /\/e2ee\/t\//.test(location.pathname) &&
      Boolean(document.querySelector?.('[role="main"] [role="log"] [data-visualcompletion="loading-state"]')) &&
      !document.querySelector?.('[role="main"] [data-message-id]');
    const encryptedChatsStuck = () => {
      const rows = [...(document.querySelectorAll?.('[role="navigation"] [role="grid"] a[href*="/e2ee/t/"]') ?? [])].filter(
        (row) => row.getBoundingClientRect().width > 0,
      );
      // A loaded row has the name, the last message and its time; a stuck one
      // the name alone (grey bars for the rest). By lines, not words: no
      // language's text is matched.
      return rows.length >= 3 && rows.every((row) => row.innerText.split('\n').filter((line) => line.trim()).length <= 1);
    };
    const tick = async (now = Date.now()) => {
      const slept = now - lastTick - RECOVER.tickMs;
      lastTick = now;
      if (recovering) return;
      if (slept >= RECOVER.sleptMs) return recover(`slept ${Math.round(slept / 1000)} s`);
      if (!encryptedChatsStuck() || navigator.onLine === false) stuckSince = 0;
      else if (!stuckSince) stuckSince = now;
      else if (now - stuckSince >= RECOVER.stuckMs) return recover(STUCK);
      if (!openChatStuck() || navigator.onLine === false) chatStuckSince = 0;
      else if (!chatStuckSince) chatStuckSince = now;
      else if (now - chatStuckSince >= RECOVER.chatStuckMs) return recover(STUCK);
      const dead = deadSockets(now);
      if (!dead.length || !(await answering())) {
        answeringSince = 0;
        return;
      }
      answeringSince ||= now;
      if (now - answeringSince >= RECOVER.downMs) recover(`down: ${dead.join(', ')}`);
    };
    setInterval(tick, RECOVER.tickMs);
    // Messenger's own word that the encrypted chats' worker hangs: its calls
    // to it time out while it is there and connected. Twice in two minutes.
    let workerHangs = [];
    window.addEventListener('unhandledrejection', (event) => {
      if (!/shared_exists_and_connected/.test(String(event.reason?.message ?? event.reason))) return;
      const now = Date.now();
      workerHangs = workerHangs.filter((at) => now - at < 2 * 60_000).concat(now);
      if (workerHangs.length >= 2 && !recovering) recover(STUCK);
    });
    // Probes: a tick as if the computer had slept, and the sockets' state.
    if (window.__fmessDebug) {
      window.__fmessCheckAwake = tick;
      window.__fmessGatewaySockets = () => Object.fromEntries([...gatewaySockets].map(([kind, entry]) => [kind, { open: entry.open, worked: entry.worked, since: entry.since }]));
    }
  }


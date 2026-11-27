// Runs fMess's handling of Messenger's sounds (SoundPlayer's sounds through Web
// Audio, so WebKit doesn't make fMess Now Playing) against fake media
// elements and a fake Web Audio, and whether a notification rings on Windows
// (shouldRing). `node tests/sounds.mjs`
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
const patch = src.match(/    SoundPlayer\(exports\) \{[\s\S]*?\n    \},\n/)[0];
const sounds = src.match(/  const nativePlay = HTMLMediaElement\.prototype\.play;[\s\S]*?\n  HTMLMediaElement\.prototype\.pause = [\s\S]*?\n  };\n/)[0];
const within = src.match(/  const within = .*\n/)[0];
const ring = src.match(/  const ringsHere = [\s\S]*?\n  };\n/)[0];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function world({ fetchFails = false, fetchDelay = 0, nativeFails = false, platform = 'MacIntel', soundsOn = true } = {}) {
  const w = { muted: false, sources: [] };
  class HTMLMediaElement {
    play() {
      this.nativePlays = (this.nativePlays ?? 0) + 1;
      return nativeFails ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    }
    pause() {}
  }
  class HTMLAudioElement extends HTMLMediaElement {
    constructor(url) {
      super();
      Object.assign(this, { src: url, currentSrc: url, loop: false, srcObject: null, muted: false, volume: 1 });
    }
  }
  class AudioContext {
    state = 'suspended';
    destination = {};
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.state = 'suspended';
      return Promise.resolve();
    }
    decodeAudioData(data) {
      return Promise.resolve({ data });
    }
    createGain() {
      return { gain: { value: 1 }, connect: (next) => next };
    }
    createBufferSource() {
      const source = {
        connect: (next) => next,
        start() {
          source.started = true;
          w.sources.push(source);
        },
        stop() {
          source.stopped = true;
          source.onended?.();
        },
      };
      return source;
    }
  }
  const fetch = async () => {
    await sleep(fetchDelay);
    if (fetchFails) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => 'bytes' };
  };
  const env = { HTMLMediaElement, HTMLAudioElement, AudioContext, fetch, isMuted: () => w.muted, navigator: { platform }, messengerPrefs: { soundsOn }, window: {} };
  const run = new Function(...Object.keys(env), `let soundPlayerCalls = 0;\n${sounds}${within}${ring}return ({ ${patch} shouldRing });`);
  // Messenger's SoundPlayer: play() plays one of its elements, at once.
  const exports = {
    play(element, options = {}) {
      if (options.loop) element.loop = true;
      return element.play();
    },
  };
  const page = run(...Object.values(env));
  page.SoundPlayer(exports);
  w.soundPlayer = exports;
  w.shouldRing = (notification = {}) => page.shouldRing({ silent: false, ...notification });
  w.audio = (url = 'https://static.xx.fbcdn.net/rsrc.php/x.ogg') => new HTMLAudioElement(url);
  return w;
}

const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}`);

{
  const w = world();
  const sound = w.audio();
  await w.soundPlayer.play(sound);
  check("Messenger's sound plays through Web Audio", w.sources.length === 1 && !sound.nativePlays, { sources: w.sources.length, native: sound.nativePlays });
}
{
  const w = world();
  const voice = w.audio('blob:https://www.facebook.com/voice');
  await voice.play();
  check('other audio (a voice message) stays a media element', w.sources.length === 0 && voice.nativePlays === 1, voice);
}
{
  const w = world();
  const ring = w.audio();
  await w.soundPlayer.play(ring, { loop: true });
  check('a looping sound (a call ringing) stays a media element', w.sources.length === 0 && ring.nativePlays === 1, ring);
}
{
  const w = world();
  const sound = w.audio();
  await w.soundPlayer.play(sound);
  sound.pause();
  check('pause() stops the sound', w.sources[0]?.stopped === true, w.sources);
}
{
  const w = world({ fetchDelay: 30 });
  const sound = w.audio();
  const playing = w.soundPlayer.play(sound);
  sound.pause();
  await playing;
  check('pause() while the sound loads: it never starts', w.sources.length === 0 && !sound.nativePlays, { sources: w.sources.length, native: sound.nativePlays });
}
{
  const w = world();
  w.muted = true;
  const sound = w.audio();
  const voice = w.audio('blob:https://www.facebook.com/voice');
  await w.soundPlayer.play(sound);
  await voice.play();
  check("Do Not Disturb quiets Messenger's sounds only", w.sources.length === 0 && !sound.nativePlays && voice.nativePlays === 1, { sound, voice });
}
{
  const w = world({ fetchFails: true });
  const sound = w.audio();
  await w.soundPlayer.play(sound);
  check('if Web Audio fails, the element plays as before', w.sources.length === 0 && sound.nativePlays === 1, sound);
}

// Windows: Messenger plays its sound just before it notifies.
{
  const w = world({ platform: 'Win32' });
  w.soundPlayer.play(w.audio()).catch(() => {});
  check("Windows: after Messenger's sound played, the notification is quiet", (await w.shouldRing()) === false);
}
{
  const w = world({ platform: 'Win32', fetchFails: true, nativeFails: true });
  w.soundPlayer.play(w.audio()).catch(() => {});
  check("Windows: when Messenger's sound couldn't play, the notification rings", (await w.shouldRing()) === true);
}
{
  const w = world({ platform: 'Win32' });
  check('Windows: with no sound from Messenger (its fourth message in a chat), the notification rings', (await w.shouldRing()) === true);
}
{
  const w = world({ platform: 'Win32' });
  const rang = await w.shouldRing();
  const sound = w.audio();
  await w.soundPlayer.play(sound);
  check("Windows: Messenger's sound coming just after a notification that rang is held back", rang === true && w.sources.length === 0 && !sound.nativePlays, { rang, sources: w.sources.length });
}
{
  const w = world({ platform: 'Win32' });
  await w.soundPlayer.play(w.audio());
  await w.shouldRing();
  check("Windows: a quiet notification doesn't hold Messenger's next sound back", w.sources.length === 1, { sources: w.sources.length });
}
{
  const w = world({ platform: 'Win32', soundsOn: false });
  check("Windows: with Messenger's sounds off, the notification is quiet", (await w.shouldRing()) === false);
}
{
  const w = world({ platform: 'Win32' });
  w.muted = true;
  check('Windows: during Do Not Disturb, the notification is quiet', (await w.shouldRing()) === false);
}
{
  const w = world({ platform: 'Win32' });
  check('Windows: a notification asking for silence is quiet', (await w.shouldRing({ silent: true })) === false);
}
{
  const w = world({ platform: 'MacIntel' });
  check('macOS: notifications stay silent (Messenger plays its own sound)', (await w.shouldRing()) === false);
}

console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exit(1);

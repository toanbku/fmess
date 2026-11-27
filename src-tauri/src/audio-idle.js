// Runs in every frame. Messenger keeps AudioContexts running for good, in the
// page and in its hidden proxy frame, and WebKit's open output session stops
// the Mac from idle sleeping (coreaudiod's PreventUserIdleSystemSleep). So
// a context is suspended while no sound plays and resumed when one starts.
// Contexts that take a stream (calls), a media element, a worklet or a script
// processor are left alone: their sound isn't scheduled by start().
(() => {
  if (window.__fmessAudioIdle || window.opener) return;
  window.__fmessAudioIdle = true;
  // The browser's own timers: Facebook's, swapped in once its scripts load,
  // can't clear a timer made before them (#51).
  const setTimeout = window.setTimeout.bind(window);
  const clearTimeout = window.clearTimeout.bind(window);
  const IDLE_MS = 3000;
  const timers = new WeakMap();
  const streaming = new WeakSet();
  const contexts = new WeakSet();
  const scheduleSuspend = (ctx) => {
    clearTimeout(timers.get(ctx));
    timers.set(
      ctx,
      setTimeout(() => {
        if (ctx.state === 'running' && !streaming.has(ctx)) ctx.suspend().catch(() => {});
      }, IDLE_MS),
    );
  };
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Native = window[name];
    if (!Native) continue;
    window[name] = class extends Native {
      constructor(...args) {
        super(...args);
        contexts.add(this);
        const addModule = this.audioWorklet?.addModule;
        if (addModule) {
          this.audioWorklet.addModule = (...moduleArgs) => (streaming.add(this), addModule.apply(this.audioWorklet, moduleArgs));
        }
        this.addEventListener('statechange', () => this.state === 'running' && scheduleSuspend(this));
        scheduleSuspend(this);
      }
      createMediaStreamSource(...args) {
        streaming.add(this);
        return super.createMediaStreamSource(...args);
      }
      createMediaElementSource(...args) {
        streaming.add(this);
        return super.createMediaElementSource(...args);
      }
      createScriptProcessor(...args) {
        streaming.add(this);
        return super.createScriptProcessor(...args);
      }
    };
  }
  if (typeof AudioScheduledSourceNode !== 'undefined') {
    const nativeStart = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (...args) {
      const ctx = this.context;
      if (contexts.has(ctx)) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        // A looping or long sound keeps the context awake.
        if (this.loop || this.buffer?.duration > 2) clearTimeout(timers.get(ctx));
        else scheduleSuspend(ctx);
      }
      return nativeStart.apply(this, args);
    };
  }
})();

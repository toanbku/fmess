// How fast the photo viewer zooms for each way of zooming: a pinch follows the
// fingers, a Ctrl + wheel notch zooms about 15%, and a two-finger scroll with
// Ctrl zooms by distance, not by how many events it sends.
// `node tests/viewer-zoom.mjs`
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
const block = src.match(/  let ctrlKeyDown = false;[\s\S]*?\n  const zoomFactor = [\s\S]*?\n  };\n/)[0];

function world() {
  const listeners = {};
  const window = {
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
  };
  const zoomFactor = new Function('window', `${block}return zoomFactor;`)(window);
  const fire = (type, event = {}) => (listeners[type] ?? []).forEach((listener) => listener(event));
  // Zooming by a run of wheel events, all with ctrlKey as zooming ones have.
  const zoomBy = (deltas, deltaMode = 0) => deltas.reduce((scale, deltaY) => scale * zoomFactor({ deltaY, deltaMode, ctrlKey: true }), 1);
  return { fire, zoomBy };
}

const results = [];
const near = (a, b) => Math.abs(a - b) < 0.01;
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
const times = (n, value) => Array.from({ length: n }, () => value);

{
  const w = world();
  // Chromium: deltaY = -100 × ln(scale) for each step of a pinch.
  const scale = w.zoomBy(times(10, -100 * Math.log(1.1)));
  check('a pinch follows the fingers (10 × 1.1 = 2.59)', near(scale, 1.1 ** 10), scale);
}
{
  const w = world();
  w.fire('keydown', { ctrlKey: true });
  const notch = w.zoomBy([-100]);
  check('Ctrl + one wheel notch: about 15%', near(notch, 2 ** 0.2), notch);
  const lines = w.zoomBy([-3], 1);
  check('a notch counted in lines: the same at most', lines <= 2 ** 0.24 + 0.01, lines);
  // A two-finger scroll of 500 px, as 50 events of 10 px or 10 of 50 px.
  const fine = w.zoomBy(times(50, -10));
  const coarse = w.zoomBy(times(10, -50));
  check('Ctrl + a scroll zooms by distance, not by events', near(fine, coarse) && near(fine, 2), { fine, coarse });
  w.fire('keyup', { ctrlKey: false });
  const pinch = w.zoomBy([-100 * Math.log(1.2)]);
  check('after Ctrl is let go, a pinch follows the fingers again', near(pinch, 1.2), pinch);
}
{
  const w = world();
  // The window didn't have the keyboard: no Ctrl key seen.
  const notch = w.zoomBy([-100]);
  check('a whole notch with no Ctrl key seen is still a wheel', near(notch, 2 ** 0.2), notch);
  w.fire('keydown', { ctrlKey: true });
  w.fire('blur');
  const pinch = w.zoomBy([-100 * Math.log(1.2)]);
  check('leaving the window forgets the Ctrl key', near(pinch, 1.2), pinch);
}
{
  const w = world();
  w.fire('keydown', { ctrlKey: true });
  const out = w.zoomBy([100]);
  check('zooming out is the same step back', near(out, 2 ** -0.2), out);
}

console.log(results.join('\n'));
if (results.some((line) => line.startsWith('FAIL'))) process.exit(1);

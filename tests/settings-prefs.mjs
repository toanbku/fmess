// What the Settings window sends when one of Messenger's Preferences is
// changed there: the sounds switch, Do Not Disturb and Dark Mode (#43: the
// switch sent nothing, as a checkbox's value is "on").
// `node tests/settings-prefs.mjs`
import { readFileSync } from 'node:fs';

// Windows checkouts may have CRLF line ends.
const html = readFileSync(new URL('../ui/settings.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const block = html.match(/  for \(const input of prefInputs\) \{[\s\S]*?\n  \}\n/)[0];

// An input as the window has it. With no value attribute, a checkbox's value
// is "on", as in every browser engine.
class Input {
  constructor(type, pref, value) {
    this.type = type;
    this.dataset = { pref };
    this.value = value ?? (type === 'checkbox' ? 'on' : '');
    this.checked = false;
    this.listeners = [];
  }
  addEventListener(type, listener) {
    if (type === 'change') this.listeners.push(listener);
  }
  change(update) {
    Object.assign(this, update);
    this.listeners.forEach((listener) => listener());
  }
}

function world() {
  const sent = [];
  const inputs = {
    soundsOn: new Input('checkbox', 'soundsOn'),
    muteFor: new Input('select-one', 'muteFor', '0'),
    darkMode: new Input('select-one', 'darkMode', 'DISABLED'),
  };
  const invoke = (command, args) => {
    sent.push({ command, ...args });
    return Promise.resolve();
  };
  new Function('prefInputs', 'invoke', 'errorBox', block)(Object.values(inputs), invoke, { textContent: '' });
  return { sent, inputs };
}

const results = [];
const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

{
  const w = world();
  w.inputs.soundsOn.change({ checked: true });
  w.inputs.soundsOn.change({ checked: false });
  const want = [
    { command: 'set_messenger_pref', name: 'soundsOn', value: true },
    { command: 'set_messenger_pref', name: 'soundsOn', value: false },
  ];
  check('the sounds switch sends on, then off', same(w.sent, want), w.sent);
}
{
  const w = world();
  w.inputs.muteFor.change({ value: '3600000' });
  w.inputs.muteFor.change({ value: '-1' });
  w.inputs.muteFor.change({ value: '0' });
  const want = [3600000, -1, 0].map((value) => ({ command: 'set_messenger_pref', name: 'muteFor', value }));
  check('Do Not Disturb sends milliseconds as a number', same(w.sent, want), w.sent);
}
{
  const w = world();
  w.inputs.muteFor.change({ value: 'on' });
  check('Do Not Disturb\'s "Until 10:00" entry sends nothing', w.sent.length === 0, w.sent);
}
{
  const w = world();
  w.inputs.darkMode.change({ value: 'USE_SYSTEM' });
  check('Dark Mode sends its setting', same(w.sent, [{ command: 'set_messenger_pref', name: 'darkMode', value: 'USE_SYSTEM' }]), w.sent);
}

console.log(results.join('\n'));
if (results.some((result) => result.startsWith('FAIL'))) process.exit(1);

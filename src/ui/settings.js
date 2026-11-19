// The settings panel. Every control in the form has a `name` matching a setting key
// (see DEFAULTS in src/storage.js). When you change something we wait a moment (so
// dragging a slider doesn't save 50 times), then save; saving triggers Chrome's change
// announcement, which is what actually updates the scene.
//
// THE ASCII LOOK. The real controls (sliders, checkboxes, the theme list) are kept, so mouse,
// keyboard and screen readers all work as normal, but each is dressed up as text:
//   - a slider is drawn as a bar of characters, [######------], with the real slider laid
//     invisibly on top of it, so dragging and arrow keys still work
//   - a checkbox is drawn as [x] or [ ]
//   - the theme list gets < and > arrows on either side that step through the themes
// decorate() adds those pieces once; refreshOutputs() keeps the bars and numbers up to date.
const BAR = 12; // how many characters long a slider's bar is
const FORMATS = {
  speed: (v) => `${v}x`,
  density: (v) => `${v}x`,
  pads: (v) => `${v}x`,
  flowers: (v) => `${v}x`,
  waves: (v) => `${v}x`,
};

export function initSettings({ scenes, onChange }) {
  const toggle = document.getElementById('settings-toggle');
  const panel = document.getElementById('settings-panel');
  const form = document.getElementById('settings-form');

  const fillSelect = (select, options) => {
    for (const [value, { label }] of Object.entries(options)) select.add(new Option(label, value));
  };
  fillSelect(form.elements.scene, scenes);
  decorate(form);

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });

  const readValue = (el) => (el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value);

  const refreshOutputs = () => {
    for (const out of form.querySelectorAll('output[data-for]')) {
      const key = out.dataset.for;
      out.textContent = FORMATS[key](readValue(form.elements[key]));
    }
    for (const bar of form.querySelectorAll('.bar')) bar.dataset.text = barText(bar.querySelector('input'));
  };

  let pending = {};
  let timer = 0;
  form.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.name) return;
    pending[el.name] = readValue(el);
    refreshOutputs();
    clearTimeout(timer);
    timer = setTimeout(() => {
      onChange(pending);
      pending = {};
    }, 250);
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  return {
    // Show the given settings in the form (skipping whatever you're typing in right now).
    show(settings) {
      for (const [key, value] of Object.entries(settings)) {
        const el = form.elements[key];
        if (!el || el === document.activeElement) continue;
        if (el.type === 'checkbox') el.checked = Boolean(value);
        else el.value = value;
      }
      // Options that belong to one theme only show while that theme is picked.
      for (const el of form.querySelectorAll('[data-scene]')) el.hidden = el.dataset.scene !== settings.scene;
      refreshOutputs();
    },
  };
}

// A slider's value as a bar of characters: filled with # up to the value, - after it.
function barText(input) {
  const min = Number(input.min), max = Number(input.max), v = Number(input.value);
  const filled = Math.round(((v - min) / (max - min || 1)) * BAR);
  return `[${'#'.repeat(filled)}${'-'.repeat(BAR - filled)}]`;
}

// Adds the ASCII dressing around the form's controls (see the note at the top).
function decorate(form) {
  for (const input of form.querySelectorAll('input[type="range"]')) {
    const bar = document.createElement('span');
    bar.className = 'bar';
    input.replaceWith(bar);
    bar.append(input); // the real slider, see-through, on top of the characters
  }
  for (const input of form.querySelectorAll('input[type="checkbox"]')) {
    const box = document.createElement('span');
    box.className = 'box';
    box.setAttribute('aria-hidden', 'true');
    input.after(box);
  }
  for (const select of form.querySelectorAll('select')) {
    const pick = document.createElement('span');
    pick.className = 'pick';
    // Tie the row's label to the list itself; otherwise clicking the label would press the
    // first button inside it (the < arrow).
    select.id ||= `setting-${select.name}`;
    const label = select.closest('label');
    if (label) label.htmlFor = select.id;
    select.replaceWith(pick);
    const arrow = (text, step, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => {
        const n = select.options.length;
        select.selectedIndex = (select.selectedIndex + step + n) % n;
        select.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return b;
    };
    pick.append(arrow('<', -1, 'previous theme'), select, arrow('>', 1, 'next theme'));
  }
}

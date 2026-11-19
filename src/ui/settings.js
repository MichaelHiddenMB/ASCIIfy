// The settings panel. Every control in the form has a `name` matching a setting key
// (see DEFAULTS in src/storage.js). When you change something we wait a moment (so
// dragging a slider doesn't save 50 times), then save; saving triggers Chrome's change
// announcement, which is what actually updates the scene.
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

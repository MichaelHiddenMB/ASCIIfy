// The clock draws the time in big block letters, each one a tiny picture 5 rows tall.
const GLYPHS = {
  0: ['███', '█ █', '█ █', '█ █', '███'],
  1: [' █ ', '██ ', ' █ ', ' █ ', '███'],
  2: ['███', '  █', '███', '█  ', '███'],
  3: ['███', '  █', '███', '  █', '███'],
  4: ['█ █', '█ █', '███', '  █', '  █'],
  5: ['███', '█  ', '███', '  █', '███'],
  6: ['███', '█  ', '███', '█ █', '███'],
  7: ['███', '  █', '  █', '  █', '  █'],
  8: ['███', '█ █', '███', '█ █', '███'],
  9: ['███', '█ █', '███', '  █', '███'],
  ':': [' ', '█', ' ', '█', ' '],
  ' ': [' ', ' ', ' ', ' ', ' '],
  A: ['███', '█ █', '███', '█ █', '█ █'],
  P: ['███', '█ █', '███', '█  ', '█  '],
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
};

function bigText(str) {
  const lines = ['', '', '', '', ''];
  [...str].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return;
    for (let r = 0; r < 5; r++) lines[r] += (i ? ' ' : '') + glyph[r];
  });
  return lines.join('\n');
}

function greeting(hour, name) {
  const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}.` : `${part}.`;
}

export function initClock() {
  const root = document.getElementById('clock');
  const timeEl = document.getElementById('clock-time');
  const greetingEl = document.getElementById('greeting');
  let opts = { name: '', clock24: false };
  let lastKey = '';

  function tick() {
    const now = new Date();
    let h = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    let suffix = '';
    if (!opts.clock24) {
      suffix = h < 12 ? 'AM' : 'PM';
      h = h % 12 || 12;
    }
    const time = `${opts.clock24 ? String(h).padStart(2, '0') : h}:${minutes}`;
    // Only touch the page when something visible actually changed.
    const key = `${time}${suffix}${opts.name}`;
    if (key === lastKey) return;
    lastKey = key;
    timeEl.textContent = bigText(suffix ? `${time} ${suffix}` : time);
    timeEl.setAttribute('aria-label', `${time} ${suffix}`.trim());
    greetingEl.textContent = greeting(now.getHours(), opts.name);
  }

  tick();
  setInterval(tick, 1000);

  return {
    update(settings) {
      opts = { name: settings.name.trim(), clock24: settings.clock24 };
      root.hidden = !settings.showClock;
      lastKey = '';
      tick();
    },
  };
}

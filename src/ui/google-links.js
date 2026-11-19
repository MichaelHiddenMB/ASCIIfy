// The quick links in the top right corner, the same ones Google's own new tab page has:
// "gmail", "images", the apps grid and your profile picture.
//
// The apps grid and the account menu are Google's real ones, not copies. On google.com,
// both are small separate pages that Google serves from ogs.google.com and shows inside an
// <iframe> (a window onto another page, set into this one). We do the same, so you get
// your own arrangement of apps, your accounts, "Manage your Google Account", sign out, and
// so on, exactly as Google draws them.
//
// Two things make that possible:
//   - Google's pages normally tell the browser "only let google.com show me in a frame"
//     (the X-Frame-Options and Content-Security-Policy headers). allowFraming() asks Chrome,
//     through its declarativeNetRequest API (rules for changing web requests), to drop
//     that instruction, but only for frames that this extension's own page opens.
//   - The host_permissions in manifest.json let this page talk to Google as you, with your
//     sign-in, the way a Google page would.
//
// Your profile picture comes from the same place Chrome's own new tab page gets it: a
// small description of Google's top bar at www.google.com/async/newtab_ogb. We read it as
// plain text and pick out the picture and your name; none of Google's code runs here.
// The picture itself (on lh3.google.com) only loads with your sign-in attached, so we
// download it ourselves and keep a copy, instead of pointing an <img> at it.
//
// SWITCHING ACCOUNTS. If you're signed in to several Google accounts, Google numbers them
// 0, 1, 2... and every address says which one it means: /u/1/ in the path, or authuser=1.
// When you pick another account in the account menu, Google sends the whole tab to
// www.google.com/webhp?authuser=1 (checked on google.com), which would take you away from
// ASCIIfy. So watchMenus() watches where the tab is about to go (with Chrome's
// webNavigation API, which reports each page move in a tab). If, while a menu is open, the
// tab heads to Google with another account number, we remember that number and start a
// fresh new tab page instead, so ASCIIfy shows the photo, apps, gmail and images for the
// account you picked.
//
// Anything that goes wrong is reported in the page's console with an [ASCIIfy] label.
const ACCOUNT_KEY = 'asciify:google-authuser'; // which of your Google accounts is showing
const CACHE_KEY = 'asciify:google-account'; // remembered, so the picture shows instantly next time
const SIGN_IN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.google.com%2F';

// Which account number to show (0 is the first one you signed in to).
function readAuthuser() {
  try {
    return Number(localStorage.getItem(ACCOUNT_KEY)) || 0;
  } catch {
    return 0;
  }
}
const AUTHUSER = readAuthuser();

// Google's dark or light menus, matching the computer's setting (dm=1 asks for dark).
const DARK = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 1 : 0;

// The settings google.com itself opens these two with (checked against google.com's own page).
const MENU_QUERY = 'eom=1&origin=https%3A%2F%2Fwww.google.com&pid=1&spid=538&hl=en';
const APPS_URL = `https://ogs.google.com/u/${AUTHUSER}/widget/app?${MENU_QUERY}&cn=app&dm=${DARK}`;
const ACCOUNT_URL = `https://ogs.google.com/u/${AUTHUSER}/widget/account?${MENU_QUERY}&cn=account&dm=${DARK}`;
const BAR_URL = `https://www.google.com/async/newtab_ogb?hl=en&async=fixed:0&authuser=${AUTHUSER}`;

// A head-and-shoulders outline, for the profile button while we don't know who you are.
const PERSON_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 6zm0 14a8 8 0 0 1-6.3-3.1c.9-1.7 3.6-2.6 6.3-2.6s5.4.9 6.3 2.6A8 8 0 0 1 12 20z"/></svg>';

// THE MENUS' SHAPE. Google's menu page draws a rounded card with a margin around it. On
// google.com, Google's own scripts introduce themselves to the page, which then makes that
// margin see-through; we can't run those scripts, so the margin stays solid white. Instead
// we show the frame through a "window" cut exactly to the card's size and rounded corners
// (overflow: hidden in newtab.css), with the frame shifted so the card lines up with it, and
// draw the card's shadow ourselves. All the numbers were measured on google.com:
//   frame: the size Google gives the frame; inset: where the card starts inside it
//   (left, top); card: the card's own width and height.
const SHAPES = {
  apps: { frame: [370, 570], inset: [12, 7], card: [341, 543] },
  account: { frame: [424, 570], inset: [12, 7], card: [395, 543] },
};

// Google's close button (the X at the top right of the account menu) only works once Google's
// scripts have introduced themselves, so we lay our own invisible button over the same
// spot. Its centre, measured from the card's top left corner:
const ACCOUNT_CLOSE_AT = [365, 27];


export function initGoogleLinks() {
  const strip = document.getElementById('google-links');
  const appsButton = strip.querySelector('.gl-apps');
  const profile = strip.querySelector('.gl-profile');
  const signIn = strip.querySelector('.gl-sign-in');
  const inExtension = Boolean(globalThis.chrome?.runtime?.id);
  let open = null; // { kind, el, button } while a menu is showing
  let framing = null;

  // "gmail" and "images" open as the account that's showing.
  strip.querySelector('.gl-gmail').href = `https://mail.google.com/mail/u/${AUTHUSER}/`;
  strip.querySelector('.gl-images').href = `https://www.google.com/imghp?authuser=${AUTHUSER}`;
  if (inExtension) watchMenus();

  // See SWITCHING ACCOUNTS at the top. Chrome tells every listener about every page move in
  // every tab, so we first find out which tab we are and ignore the rest. frameId 0 means the
  // whole tab (rather than a frame inside it).
  async function watchMenus() {
    const nav = chrome.webNavigation;
    const me = await chrome.tabs?.getCurrent?.();
    if (!nav || !me) return;
    nav.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
      if (tabId !== me.id || frameId !== 0 || !open) return;
      let u;
      try {
        u = new URL(url);
      } catch {
        return;
      }
      const n = /(^|\.)google\.com$/.test(u.hostname) ? accountNumber(u) : null;
      // Another account: stay on ASCIIfy, as that account. Anything else (your account
      // page, signing out, an app...) is left to open as normal.
      if (n !== null && n !== AUTHUSER) switchTo(n);
    });
  }

  // Show ASCIIfy as account number n (forgetting the old account's picture). Google is
  // already taking the tab to google.com, so we send it to a fresh new tab page instead,
  // which replaces Google's trip and starts ASCIIfy again as the new account.
  function switchTo(n) {
    try {
      localStorage.setItem(ACCOUNT_KEY, String(n));
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    chrome.tabs.getCurrent((tab) => chrome.tabs.update(tab.id, { url: 'chrome://newtab/' }));
  }

  // ---- the menus: Google's own pages in a frame ----
  async function openMenu(kind, button) {
    closeMenu();
    // Outside the extension (e.g. testing from a local web server) Google won't allow the
    // frame, so just go to the page instead.
    if (!inExtension) {
      location.href = kind === 'apps' ? 'https://about.google/products/' : 'https://myaccount.google.com/';
      return;
    }
    framing ??= allowFraming();
    await framing;
    const { frame: [fw, fh], inset: [ix, iy], card: [cw, ch] } = SHAPES[kind];
    // The window, cut to the card (see THE MENUS' SHAPE at the top).
    const box = document.createElement('div');
    box.className = 'gl-menu';
    const r = button.getBoundingClientRect();
    const top = r.bottom + 6 + iy; // the frame starts just under the button, as on google.com
    box.style.top = `${top}px`;
    box.style.width = `${cw}px`;
    box.style.height = `${Math.min(ch, innerHeight - top - 8)}px`;
    // On google.com both menus' frames end 31px to the right of the apps button; the card
    // ends a margin's width inside that.
    const apps = appsButton.getBoundingClientRect();
    box.style.right = `${Math.max(8, innerWidth - apps.right - 31 + (fw - ix - cw))}px`;
    const frame = document.createElement('iframe');
    frame.src = kind === 'apps' ? APPS_URL : ACCOUNT_URL;
    frame.title = kind === 'apps' ? 'Google apps' : 'Google Account';
    frame.style.width = `${fw}px`;
    frame.style.height = `${fh}px`;
    frame.style.left = `${-ix}px`;
    frame.style.top = `${-iy}px`;
    box.append(frame);
    if (kind === 'account') {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'gl-menu-close';
      close.title = 'Close';
      close.setAttribute('aria-label', 'Close');
      close.style.left = `${ACCOUNT_CLOSE_AT[0]}px`;
      close.style.top = `${ACCOUNT_CLOSE_AT[1]}px`;
      close.addEventListener('click', closeMenu);
      box.append(close);
    }
    document.body.append(box);
    button.classList.add('open');
    button.setAttribute('aria-expanded', 'true');
    open = { kind, el: box, button };
  }

  function closeMenu() {
    if (!open) return;
    open.el.remove();
    open.button.classList.remove('open');
    open.button.setAttribute('aria-expanded', 'false');
    open = null;
  }

  const toggle = (kind, button) => (open?.kind === kind ? closeMenu() : openMenu(kind, button));
  appsButton.addEventListener('click', () => toggle('apps', appsButton));
  profile.addEventListener('click', () => toggle('account', profile));

  // Clicking anywhere else, pressing Escape, or resizing the window closes the menu. (Clicks
  // inside the menu land in Google's page, not ours, so they never close it.)
  document.addEventListener('pointerdown', (e) => {
    if (open && !open.el.contains(e.target) && !open.button.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  window.addEventListener('resize', closeMenu);

  // ---- the profile picture ----
  // The button can be in one of three states: your account (its photo), 'signed-out' (Google's
  // blue "Sign in" button instead), or null while we can't tell, which shows a plain person
  // icon that still opens Google's account menu (where Google itself shows who you are).
  function showAccount(state) {
    profile.hidden = state === 'signed-out';
    signIn.hidden = state !== 'signed-out';
    if (state && state !== 'signed-out' && state.photo) {
      const img = profile.querySelector('img') ?? document.createElement('img');
      img.alt = '';
      if (img.getAttribute('src') !== state.photo) img.src = state.photo;
      profile.replaceChildren(img);
      profile.title = state.label;
      profile.setAttribute('aria-label', state.label);
    } else {
      if (!profile.querySelector('svg')) profile.innerHTML = PERSON_ICON;
      const label = state?.label ?? 'Google Account';
      profile.title = label;
      profile.setAttribute('aria-label', label);
    }
  }

  // What we saw last time, so the photo shows the moment the tab opens.
  function cached() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch {
      return null;
    }
  }

  // Asks Google who's signed in. The reply is JSON with a short guard in front, holding the
  // top bar's HTML. DOMParser turns that HTML into elements we can search, without running
  // any of it. Signed in, it has a "Google Account: name (email)" link with your picture in
  // it; signed out, it has no such link.
  async function loadAccount() {
    let text;
    try {
      const res = await fetch(BAR_URL, { credentials: 'include' });
      if (!res.ok) throw new Error(`Google answered ${res.status}`);
      text = await res.text();
    } catch (err) {
      console.error('[ASCIIfy] could not ask Google who is signed in:', err);
      return null; // couldn't tell
    }
    let html = '';
    try {
      const data = JSON.parse(text.slice(text.indexOf('{')));
      html = data?.update?.ogb?.html?.private_do_not_access_or_else_safe_html_wrapped_value ?? '';
    } catch (err) {
      console.error('[ASCIIfy] Google\'s reply was not in the expected shape:', err);
      return null;
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = doc.querySelector('a[aria-label^="Google Account"]');
    if (!link) return 'signed-out';
    const label = link.getAttribute('aria-label').replace(/\s+/g, ' ').trim();
    const src = link.querySelector('img')?.getAttribute('src');
    return { photo: src ? await downloadPhoto(src) : null, label };
  }

  // Downloads the picture with your sign-in attached and turns it into a "data URL" (the
  // whole image written out as text), which an <img> can show and localStorage can keep.
  async function downloadPhoto(src) {
    try {
      // Ask for a bigger copy so it's sharp (the address ends in its size, e.g. =s32-c).
      const res = await fetch(src.replace(/=s\d+/, '=s96'), { credentials: 'include' });
      if (!res.ok) throw new Error(`Google answered ${res.status}`);
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('[ASCIIfy] could not download your profile picture:', err);
      return null;
    }
  }

  signIn.href = SIGN_IN_URL;
  showAccount(cached());
  if (inExtension) {
    loadAccount().then((state) => {
      // Don't forget a known account just because Google didn't answer this time.
      if (state === null && cached()) return;
      showAccount(state);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
      } catch {}
    });
  }

  return {
    update(settings) {
      strip.hidden = !settings.showGoogleLinks;
      if (strip.hidden) closeMenu();
    },
  };
}

// The account number an address is for (/u/1/ in the path, or authuser=1), or null if it
// doesn't say. authuser can also be an email address; we only follow the numbers.
function accountNumber(u) {
  const param = u.searchParams.get('authuser');
  if (param !== null && /^\d+$/.test(param)) return Number(param);
  const path = u.pathname.match(/\/u\/(\d+)(\/|$)/);
  return path ? Number(path[1]) : null;
}

// Lets this extension's page show ogs.google.com in a frame (see the note at the top). The
// rule only matches frames opened by this extension (initiatorDomains is our own id), so
// other websites can't use it. Session rules last until Chrome closes, and setting the rule
// again replaces it, so doing it once per tab is fine.
function allowFraming() {
  const dnr = chrome.declarativeNetRequest;
  if (!dnr) return Promise.resolve();
  return dnr
    .updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ['ogs.google.com'],
            resourceTypes: ['sub_frame'],
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'X-Frame-Options', operation: 'remove' },
              { header: 'Content-Security-Policy', operation: 'remove' },
            ],
          },
        },
      ],
    })
    .catch((err) => console.error('[ASCIIfy] could not set up the rule that lets Google\'s menus show:', err));
}

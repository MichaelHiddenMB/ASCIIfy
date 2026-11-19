// The bookmarks bar along the top of the page.
//
// Why we draw our own: Chrome only shows its bookmarks bar on its *own* new tab page. When an
// extension replaces that page, Chrome hides the bar, and there's no setting an extension can
// flip to bring it back. So instead we read the same bookmarks through chrome.bookmarks
// (Chrome's bookmarks API, which needs the "bookmarks" permission in manifest.json) and draw
// a bar that works like Chrome's: links with their site icons, folders that open as drop-down
// menus (with sub-folders opening to the side), a » menu for whatever doesn't fit, and
// "Other bookmarks" on the right. It redraws itself whenever a bookmark is added, removed,
// renamed or moved, in any window.
//
// The site icons come from Chrome's favicon cache through the special _favicon/ address,
// which needs the "favicon" permission.
const api = globalThis.chrome?.bookmarks;

// Chrome's folder icon, as a small drawing that takes the text color.
const FOLDER_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3.5h4.2l1.4 1.5H14v7.5H2z" opacity=".9"/></svg>';

// A plain globe, for sites Chrome has no icon for.
const GLOBE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true" class="bm-globe"><g fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2.3 6h11.4M2.3 10h11.4"/></g></svg>';

// Addresses a normal link can't open from an extension page (Chrome blocks them), so we ask
// Chrome's tabs API to open them instead.
const SPECIAL = /^(chrome|chrome-extension|edge|about|file|view-source):/i;

export function initBookmarks() {
  const bar = document.getElementById('bookmarks');
  const items = bar.querySelector('.bm-items');
  const more = bar.querySelector('.bm-more');
  const otherSlot = bar.querySelector('.bm-other');

  // Outside the extension (e.g. testing from a local web server) there are no bookmarks.
  if (!api) return { update() {} };

  let wanted = true; // the "show bookmarks bar" setting
  let hasAny = false;
  let barNodes = []; // what's in the bookmarks bar folder
  let overflowFrom = Infinity; // index of the first item pushed into the » menu
  const menus = []; // the open drop-down menus, outermost first
  let hoverTimer = 0;

  // ---- reading the bookmarks ----
  async function load() {
    let root;
    try {
      [root] = await api.getTree();
    } catch {
      return;
    }
    const top = root.children ?? [];
    // Chrome labels its two main folders; older versions only have the fixed ids "1" and "2".
    const barFolder = top.find((f) => f.folderType === 'bookmarks-bar') ?? top.find((f) => f.id === '1') ?? top[0];
    const other = top.find((f) => f.folderType === 'other') ?? top.find((f) => f.id === '2');
    barNodes = barFolder?.children ?? [];

    closeMenus();
    items.replaceChildren(...barNodes.map((node) => makeItem(node, 0)));
    otherSlot.replaceChildren();
    if (other?.children?.length) otherSlot.append(makeItem({ ...other, title: 'Other bookmarks' }, 0));
    hasAny = barNodes.length > 0 || otherSlot.childElementCount > 0;
    refresh();
  }

  function refresh() {
    bar.hidden = !(wanted && hasAny);
    if (!bar.hidden) layout();
  }

  // ---- fitting the bar to the window ----
  // Like Chrome, items that don't fit are hidden from the bar and listed in the » menu
  // instead. We show everything, measure, then hide from the first item that sticks out.
  function layout() {
    const children = [...items.children];
    for (const el of children) el.hidden = false;
    more.hidden = true;
    overflowFrom = Infinity;
    if (items.scrollWidth <= items.clientWidth) return;
    more.hidden = false; // showing » takes some room, so measure after it's in place
    const right = items.getBoundingClientRect().right;
    const first = children.findIndex((el) => el.getBoundingClientRect().right > right);
    if (first < 0) return;
    overflowFrom = first;
    for (const el of children.slice(first)) el.hidden = true;
  }

  // ---- one bookmark or folder ----
  // depth 0 means it sits in the bar; depth n means it's in the nth menu down.
  function makeItem(node, depth) {
    const inMenu = depth > 0;
    const el = node.url ? makeLink(node) : document.createElement('button');
    el.classList.add(inMenu ? 'bm-row' : 'bm');
    if (inMenu) el.setAttribute('role', 'menuitem');
    el.title = node.url ? `${node.title}\n${node.url}` : node.title;

    const label = document.createElement('span');
    label.className = 'bm-label';
    // A bookmark with no name shows just its icon in the bar (as in Chrome), and its address in a menu.
    label.textContent = node.title || (inMenu ? node.url ?? '' : '');

    if (node.url) {
      el.prepend(siteIcon(node.url));
      el.append(label);
      if (!label.textContent) {
        el.classList.add('icon-only');
        label.remove();
      }
    } else {
      el.type = 'button';
      el.setAttribute('aria-haspopup', 'menu');
      el.setAttribute('aria-expanded', 'false');
      el.insertAdjacentHTML('afterbegin', FOLDER_ICON);
      el.append(label);
      if (inMenu) el.insertAdjacentHTML('beforeend', '<span class="bm-arrow" aria-hidden="true">&gt;</span>');
      el.addEventListener('click', () => {
        if (menus[depth]?.owner === el) closeMenus(depth);
        else openMenu(node.children ?? [], el, depth);
      });
    }

    // Hovering: inside a menu, resting on a folder opens it and resting on anything else
    // closes the sub-menu that was open. In the bar, once one folder is open, sliding over
    // to another folder switches to it (the way menus in a menu bar behave).
    el.addEventListener('pointerenter', () => {
      clearTimeout(hoverTimer);
      if (!inMenu) {
        if (menus.length && !node.url && menus[0].owner !== el) openMenu(node.children ?? [], el, 0);
        return;
      }
      hoverTimer = setTimeout(() => {
        if (node.url) closeMenus(depth);
        else if (menus[depth]?.owner !== el) openMenu(node.children ?? [], el, depth);
      }, 180);
    });
    return el;
  }

  function makeLink(node) {
    const a = document.createElement('a');
    if (/^javascript:/i.test(node.url)) {
      // Bookmarklets run on the page you're looking at, and there's no website here to run on.
      a.classList.add('bm-dead');
      a.title = `${node.title}\n(bookmarklets only work on a website)`;
      return a;
    }
    a.href = node.url;
    a.addEventListener('click', (e) => {
      closeMenus();
      if (!SPECIAL.test(node.url) || !globalThis.chrome?.tabs) return; // a normal link: let it go
      e.preventDefault();
      const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
      if (newTab) chrome.tabs.create({ url: node.url, active: e.shiftKey });
      else chrome.tabs.update({ url: node.url });
    });
    a.addEventListener('auxclick', (e) => {
      if (e.button === 1 && SPECIAL.test(node.url) && globalThis.chrome?.tabs) {
        e.preventDefault();
        chrome.tabs.create({ url: node.url, active: false });
      }
    });
    return a;
  }

  // The site's icon, or a plain globe if Chrome doesn't have one.
  function siteIcon(url) {
    const icons = globalThis.chrome?.runtime?.getURL?.('/_favicon/');
    const globe = () => {
      const span = document.createElement('span');
      span.innerHTML = GLOBE_ICON;
      return span.firstChild;
    };
    if (!icons) return globe();
    const img = document.createElement('img');
    img.className = 'bm-icon';
    img.alt = '';
    img.width = img.height = 16;
    img.addEventListener('error', () => img.replaceWith(globe()), { once: true });
    img.src = `${icons}?pageUrl=${encodeURIComponent(url)}&size=32`;
    return img;
  }

  // ---- drop-down menus ----
  // menus[d] is the menu opened from something at depth d: menus[0] hangs below the bar,
  // menus[1] opens to the side of a folder inside menus[0], and so on. Opening a menu at
  // depth d first closes whatever was open at d and deeper.
  function openMenu(nodes, owner, depth) {
    closeMenus(depth);
    // The box draws the top two + corners and the list inside it the bottom two, the same
    // way the settings panel does (an element can only add two of these drawn-in pieces).
    const menu = document.createElement('div');
    menu.className = 'bm-menu';
    const list = document.createElement('div');
    list.className = 'bm-list';
    list.setAttribute('role', 'menu');
    if (nodes.length) list.append(...nodes.map((node) => makeItem(node, depth + 1)));
    else list.insertAdjacentHTML('beforeend', '<div class="bm-empty">(empty)</div>');
    menu.append(list);
    document.body.append(menu);
    place(menu, owner.getBoundingClientRect(), depth === 0);
    owner.classList.add('open');
    owner.setAttribute('aria-expanded', 'true');
    menus[depth] = { el: menu, owner };
  }

  function closeMenus(depth = 0) {
    while (menus.length > depth) {
      const { el, owner } = menus.pop();
      el.remove();
      owner.classList.remove('open');
      owner.setAttribute('aria-expanded', 'false');
    }
  }

  // Put a menu below its button (in the bar) or beside it (in a menu), flipping it to the
  // other side or sliding it up if it would run off the screen.
  function place(menu, r, below) {
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let x = below ? r.left : r.right - 2;
    let y = below ? r.bottom + 3 : r.top - 5;
    if (x + w > innerWidth - 4) x = below ? innerWidth - 4 - w : r.left - w + 2;
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - 4 - h))}px`;
  }

  // The » button lists everything that didn't fit in the bar.
  more.addEventListener('click', () => {
    if (menus[0]?.owner === more) closeMenus();
    else openMenu(barNodes.slice(overflowFrom), more, 0);
  });

  // Clicking anywhere else, or pressing Escape, closes the menus.
  document.addEventListener('pointerdown', (e) => {
    if (menus.length && !bar.contains(e.target) && !e.target.closest?.('.bm-menu')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });

  // When the window gets wider or narrower, refit the bar (and close any menu, which would
  // now be in the wrong place).
  let resizeFrame = 0;
  let lastWidth = innerWidth;
  window.addEventListener('resize', () => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    closeMenus();
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => !bar.hidden && layout());
  });

  // Redraw whenever the bookmarks change (from any window, or from syncing).
  let reloadTimer = 0;
  const reload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 50); // a big import fires many events; redraw once
  };
  for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    api[event]?.addListener(reload);
  }
  load();

  return {
    update(settings) {
      if (wanted === settings.showBookmarks) return;
      wanted = settings.showBookmarks;
      if (!wanted) closeMenus();
      refresh();
    },
  };
}

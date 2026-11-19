// Runs before the page is first shown, so a new tab never flashes an empty screen.
//
// The scene takes a moment to start: its code has to load and the saved settings have to
// arrive from chrome.storage, which is asynchronous. Until the first frame is drawn the page
// would show only its plain background color. So every tab saves a small picture of its last
// frame (a "snapshot", see saveSnapshot in main.js) in localStorage, which, unlike
// chrome.storage, can be read instantly. Here we put that picture behind the page, so a new
// tab opens on a still of the scene and the live animation takes over a moment later.
//
// This is a plain script, not a module, and it's loaded without "defer", so it runs right
// away while the page is still loading, before anything is drawn.
try {
  const snapshot = localStorage.getItem('asciify:snapshot');
  if (snapshot) document.documentElement.style.setProperty('--snapshot', `url("${snapshot}")`);
} catch {
  // Storage blocked or unavailable: the page just starts on its background color.
}

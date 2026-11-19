// The search bar hands your text to chrome.search, Chrome's built-in search feature, so it
// uses whatever search engine you've chosen in Chrome's settings. If you type something
// that looks like a web address (e.g. "github.com"), it goes straight there instead.
const LOOKS_LIKE_URL = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;

export function initSearch() {
  const form = document.getElementById('search');
  const input = document.getElementById('search-input');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (LOOKS_LIKE_URL.test(text)) {
      location.href = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    } else if (globalThis.chrome?.search?.query) {
      chrome.search.query({ text, disposition: 'CURRENT_TAB' });
    } else {
      location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
    }
  });

  return {
    update(settings) {
      form.hidden = !settings.showSearch;
    },
  };
}

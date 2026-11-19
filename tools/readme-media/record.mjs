// Records the animated previews in the README (docs/media/*.webp).
//
//   node tools/readme-media/record.mjs            record every preview
//   node tools/readme-media/record.mjs beach      record just one (names are in jobs.js)
//
// How it works: this starts a tiny local web server for the repo, then opens capture.html in
// a hidden ("headless") Chrome. That page runs the real scenes, but instead of playing them in
// real time it steps the world forward one frame at a time, with a fixed random seed so every
// recording comes out the same, and posts each finished frame back here as a PNG. Finally
// build.py stitches the frames into looping animated WebP images (it needs Python with Pillow:
// `pip install pillow`).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'asciify-media-'));
const FRAMES = path.join(WORK, 'frames');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const jobs = process.argv[2] || 'all';
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };

let chrome;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      res.end('ok');
      if (url.pathname === '/frame') {
        const dir = path.join(FRAMES, url.searchParams.get('name'));
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${url.searchParams.get('i').padStart(3, '0')}.png`);
        fs.writeFileSync(file, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
      } else if (url.pathname === '/log') {
        console.log(body);
      } else if (url.pathname === '/done') {
        chrome.kill();
        server.close();
        const out = path.join(REPO, 'docs/media');
        const py = spawnSync('python3', [path.join(HERE, 'build.py'), FRAMES, out], { stdio: 'inherit' });
        fs.rmSync(WORK, { recursive: true, force: true });
        process.exit(py.status ?? 1);
      }
    });
    return;
  }
  // /tools/readme-media/capture.html and everything it imports come straight from the repo.
  const file = path.join(REPO, path.normalize(url.pathname));
  if (!file.startsWith(REPO)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(0, () => {
  const { port } = server.address();
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(WORK, 'chrome')}`,
    `http://localhost:${port}/tools/readme-media/capture.html?jobs=${jobs}`,
  ], { stdio: 'ignore' });
});

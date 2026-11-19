// The game loop works like a flipbook: about 30 times a second it updates the world (moves
// everything a little) and then draws the new picture.
//
// It uses a "fixed timestep": every update moves time forward by exactly the same amount
// (1/30th of a second). The browser calls us whenever it's ready to paint, which can be
// 60 or 120 times a second, so we keep a running total of elapsed time and only step the
// world when a full step's worth has built up. Animals then move at the same speed on
// fast and slow computers.
export function createLoop({ fps = 30, update, render }) {
  const step = 1 / fps;
  let speed = 1;
  let saved = 0; // time that has passed but not been "spent" on an update yet
  let last = 0;
  let rafId = 0;
  let running = false;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    // Cap the gap so a long freeze doesn't make everything teleport.
    saved += Math.min((now - last) / 1000, 0.25);
    last = now;
    let elapsed = 0; // how much world time passed in this batch of updates
    while (saved >= step) {
      update(step * speed);
      saved -= step;
      elapsed += step * speed;
    }
    if (elapsed > 0) render(elapsed);
  }

  function start() {
    if (running || document.hidden) return;
    running = true;
    last = performance.now();
    saved = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  // Pause while the tab is in the background so we don't use battery for nothing.
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  return {
    start,
    stop,
    setSpeed(s) { speed = s; },
  };
}

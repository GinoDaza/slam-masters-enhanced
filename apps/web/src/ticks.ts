/**
 * Ticks while the page is hidden: browsers stop its animation frames and slow its timers down to
 * one a second, but not a worker's. Returns the function that stops them.
 */
export function hiddenTicks(tick: (now: number) => void): () => void {
  let worker: Worker | null = null;
  const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000 / 60)'], { type: 'text/javascript' }));
  const watch = () => {
    if (document.hidden && !worker) {
      worker = new Worker(url);
      worker.onmessage = () => document.hidden && tick(performance.now());
    } else if (!document.hidden) {
      worker?.terminate();
      worker = null;
    }
  };
  document.addEventListener('visibilitychange', watch);
  watch();
  return () => {
    document.removeEventListener('visibilitychange', watch);
    worker?.terminate();
    URL.revokeObjectURL(url);
  };
}

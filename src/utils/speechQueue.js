/**
 * Voice synthesis in order of arrival, with at most `maxInFlight` requests
 * sent to Rust at a time. Rust makes one sentence at a time anyway; keeping
 * the rest here lets a sentence that is already too late be dropped before it
 * is made, instead of piling up CPU work for audio that is never played.
 * @param {number} [maxInFlight] 2: the next sentence is already waiting in Rust
 *   while the current one is made, so nothing waits on the round trip.
 */
export function createSpeechQueue(maxInFlight = 2) {
  /** @type {{ task: () => Promise<any>, skip: () => boolean, resolve: (value: any) => void, reject: (error: unknown) => void }[]} */
  const waiting = [];
  let running = 0;

  const pump = () => {
    while (running < maxInFlight && waiting.length > 0) {
      const job = /** @type {(typeof waiting)[number]} */ (waiting.shift());
      if (job.skip()) {
        job.resolve(null);
        continue;
      }
      running += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  return {
    /**
     * Queues `task`. `skip` is asked right before it starts: if it says yes,
     * the task never runs and the result is `null`.
     * @template T
     * @param {() => Promise<T>} task @param {() => boolean} [skip]
     * @returns {Promise<T | null>}
     */
    run(task, skip = () => false) {
      return new Promise((resolve, reject) => {
        waiting.push({ task, skip, resolve, reject });
        pump();
      });
    },
  };
}

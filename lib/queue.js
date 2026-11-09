/**
 * In-flight request serializer with priority and optional wait timeout.
 *
 * Upstream AutoClaw (autoglm-api.autoglm.ai) strictly limits accounts to
 * 1 concurrent active generation. Parallel requests (subagents, background
 * tools, simultaneous turns) are rejected by upstream with HTTP 406, so this
 * queue serializes them in-process.
 *
 * Ordering: a lower rank runs first (interactive < normal < background) and
 * each rank keeps FIFO arrival order. A slot is never held by a waiter, so a
 * high-priority arrival cannot deadlock a running normal request; it only
 * jumps ahead of queued work.
 */

const RANKS = { interactive: 0, normal: 1, background: 2 };

function normalizeRank(priority) {
  if (typeof priority === "number" && Number.isFinite(priority)) return priority;
  const name = String(priority || "normal").toLowerCase();
  return RANKS[name] ?? RANKS.normal;
}

export class InFlightQueue {
  constructor(options = {}) {
    this.maxDepth = options.maxDepth ?? (parseInt(process.env.GLMP_QUEUE_MAX_DEPTH, 10) || 50);
    const envWait = parseInt(process.env.GLMP_QUEUE_WAIT_MS, 10);
    this.waitTimeoutMs = options.waitTimeoutMs ?? (Number.isFinite(envWait) && envWait > 0 ? envWait : 0);
    this._activeCount = 0;
    this._queue = [];
    this._seq = 0;
  }

  get activeCount() {
    return this._activeCount;
  }

  get waitingCount() {
    return this._queue.length;
  }

  configure({ maxDepth, waitTimeoutMs } = {}) {
    if (Number.isFinite(maxDepth) && maxDepth >= 1) this.maxDepth = Math.floor(maxDepth);
    if (Number.isFinite(waitTimeoutMs) && waitTimeoutMs >= 0) this.waitTimeoutMs = Math.floor(waitTimeoutMs);
    return this;
  }

  _dispatch() {
    if (this._activeCount > 0) return;
    if (this._queue.length === 0) return;

    let best = 0;
    for (let i = 1; i < this._queue.length; i++) {
      const a = this._queue[i];
      const b = this._queue[best];
      if (a.rank < b.rank || (a.rank === b.rank && a.seq < b.seq)) best = i;
    }

    const [job] = this._queue.splice(best, 1);
    clearTimeout(job.timer);
    job.timer = null;
    this._activeCount++;

    let released = false;
    job.resolve(() => {
      if (released) return;
      released = true;
      this._activeCount--;
      this._dispatch();
    });
  }

  /**
   * Enqueues an execution slot.
   * Resolves with a `release` function when the slot is ready.
   *
   * @param {string|number} priority interactive | normal | background
   * @returns {Promise<() => void>}
   */
  async acquire(priority = "normal") {
    if (process.env.GLMP_QUEUE === "0") return () => {};

    if (this._queue.length >= this.maxDepth) {
      throw Object.assign(
        new Error(`In-flight queue depth exceeded limit (${this.maxDepth})`),
        { code: "QUEUE_OVERFLOW", status: 429 }
      );
    }

    if (this._activeCount === 0) {
      this._activeCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this._activeCount--;
        this._dispatch();
      };
    }

    return new Promise((resolve, reject) => {
      const job = {
        rank: normalizeRank(priority),
        seq: ++this._seq,
        resolve,
        timer: null,
      };

      if (this.waitTimeoutMs > 0) {
        job.timer = setTimeout(() => {
          const idx = this._queue.indexOf(job);
          if (idx === -1) return; // already dispatched
          this._queue.splice(idx, 1);
          reject(Object.assign(
            new Error(`Timed out after ${this.waitTimeoutMs}ms waiting for the upstream generation slot`),
            { code: "QUEUE_TIMEOUT", status: 503 }
          ));
        }, this.waitTimeoutMs);
      }

      this._queue.push(job);
    });
  }
}

// Global shared queue instance across entrypoints
export const globalInFlightQueue = new InFlightQueue();

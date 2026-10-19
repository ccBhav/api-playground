const { DEFAULT_REQUESTS_PER_SECOND } = require("./constants");
const { sleep } = require("./transport");

/**
 * Paces requests so a process stays under MYOB's per-API-key limit instead of hitting it and
 * retrying. Share one limiter between every client that uses the same API key.
 *
 * @typedef {Object} RateLimiter
 * @property {(signal?: AbortSignal) => Promise<void>} acquire - Resolves when the next request may
 *   be sent. Rejects with `MyobAbortError` if `signal` fires while waiting.
 */

/**
 * @typedef {Object} RateLimitOptions
 * @property {number} [requestsPerSecond] - Defaults to 8, MYOB's limit per API key.
 * @property {number} [burst] - Requests allowed back to back before pacing starts. Defaults to
 *   `requestsPerSecond`.
 */

/**
 * `false` turns pacing off; options build a new limiter; a `RateLimiter` is used as-is.
 * @typedef {false | RateLimitOptions | RateLimiter} RateLimitSetting
 */

/** @param {number | undefined} value @param {string} name */
const positive = (value, name) => {
  if (value !== undefined && !(typeof value === "number" && value > 0)) {
    throw new TypeError(`createRateLimiter: \`${name}\` must be a positive number`);
  }
};

/**
 * A token bucket: `burst` requests go out at once, then one every `1 / requestsPerSecond` seconds.
 * It only coordinates requests inside this process; several processes sharing one API key should
 * each get a share of the limit (e.g. `requestsPerSecond: 8 / processCount`).
 *
 * @param {RateLimitOptions} [options]
 * @returns {RateLimiter}
 */
const createRateLimiter = (options = {}) => {
  positive(options.requestsPerSecond, "requestsPerSecond");
  positive(options.burst, "burst");
  const requestsPerSecond = options.requestsPerSecond ?? DEFAULT_REQUESTS_PER_SECOND;
  const burst = options.burst ?? requestsPerSecond;
  let tokens = burst;
  let updatedAt = Date.now();

  /** @param {AbortSignal} [signal] */
  const acquire = async (signal) => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - updatedAt) / 1000) * requestsPerSecond);
    updatedAt = now;
    // Taking a token below zero reserves a later slot, so waiters are served in order.
    tokens -= 1;
    if (tokens >= 0) return;
    try {
      await sleep((-tokens / requestsPerSecond) * 1000, signal);
    } catch (error) {
      tokens += 1;
      throw error;
    }
  };

  return { acquire };
};

/** @param {unknown} value @returns {value is RateLimiter} */
const isRateLimiter = (value) => typeof (/** @type {any} */ (value)?.acquire) === "function";

/**
 * @param {RateLimitSetting | undefined} setting
 * @param {RateLimiter | undefined} fallback - Used when `setting` is undefined.
 * @returns {RateLimiter | undefined}
 */
const toRateLimiter = (setting, fallback) => {
  if (setting === undefined) return fallback;
  if (setting === false) return undefined;
  if (isRateLimiter(setting)) return setting;
  return createRateLimiter(setting);
};

module.exports = { createRateLimiter, toRateLimiter };

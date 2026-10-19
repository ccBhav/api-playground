const { version } = require("../package.json");
const { MyobAbortError, MyobConnectionError, MyobTimeoutError } = require("./errors");

const USER_AGENT = `myob-sdk/${version} node/${process.versions.node}`;

/**
 * `User-Agent` for the SDK, with the calling app appended when given (e.g. `"constructionclock/1.4"`).
 * @param {string} [appName]
 */
const userAgentFor = (appName) => (appName ? `${USER_AGENT} ${appName}` : USER_AGENT);

const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * One `fetch`, bounded by `timeoutMs` (which also covers reading the body) and the caller's
 * `signal`. Anything `fetch` throws comes back as a `MyobConnectionError`, `MyobTimeoutError` or
 * `MyobAbortError`.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit & { method: string }} init
 * @param {{ timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<{ response: Response, text: string }>}
 */
const fetchWithTimeout = async (fetchImpl, url, init, { timeoutMs, signal }) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const where = `MYOB ${init.method} ${url}`;
  if (signal?.aborted) {
    throw new MyobAbortError(`${where} was aborted`, { cause: signal.reason });
  }
  try {
    const response = await fetchImpl(url, { ...init, signal: combined });
    return { response, text: await response.text() };
  } catch (error) {
    if (signal?.aborted) {
      throw new MyobAbortError(`${where} was aborted`, { cause: signal.reason });
    }
    // A custom `fetch` may enforce its own timeout and throw a "TimeoutError" DOMException.
    if (timeout.aborted || /** @type {any} */ (error)?.name === "TimeoutError") {
      throw new MyobTimeoutError(`${where} timed out after ${timeoutMs}ms`, {
        cause: error,
        method: init.method,
        url,
        timeoutMs,
      });
    }
    const reason = /** @type {any} */ (error)?.cause?.message ?? /** @type {any} */ (error)?.message;
    throw new MyobConnectionError(`${where} failed to connect: ${reason}`, {
      cause: error,
      method: init.method,
      url,
    });
  }
};

/**
 * Wait before retry number `retry` (0-based): exponential backoff with jitter, or `Retry-After`
 * when the server sent one.
 * @param {number} retry
 * @param {number} [retryAfterSeconds]
 */
const retryDelayMs = (retry, retryAfterSeconds) => {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const base = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** retry, MAX_RETRY_DELAY_MS);
  return base / 2 + Math.random() * (base / 2);
};

/**
 * @param {number} ms
 * @param {AbortSignal} [signal] - Abandons the wait (with `MyobAbortError`) when it fires.
 * @returns {Promise<void>}
 */
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new MyobAbortError("MYOB request was aborted while waiting", { cause: signal?.reason }));
    };
    if (signal?.aborted) return abort();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });

module.exports = { USER_AGENT, userAgentFor, fetchWithTimeout, retryDelayMs, sleep };

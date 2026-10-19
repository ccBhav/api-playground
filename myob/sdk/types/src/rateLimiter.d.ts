/**
 * Paces requests so a process stays under MYOB's per-API-key limit instead of hitting it and
 * retrying. Share one limiter between every client that uses the same API key.
 */
export type RateLimiter = {
    /**
     * - Resolves when the next request may
     * be sent. Rejects with `MyobAbortError` if `signal` fires while waiting.
     */
    acquire: (signal?: AbortSignal) => Promise<void>;
};
export type RateLimitOptions = {
    /**
     * - Defaults to 8, MYOB's limit per API key.
     */
    requestsPerSecond?: number | undefined;
    /**
     * - Requests allowed back to back before pacing starts. Defaults to
     * `requestsPerSecond`.
     */
    burst?: number | undefined;
};
/**
 * `false` turns pacing off; options build a new limiter; a `RateLimiter` is used as-is.
 */
export type RateLimitSetting = false | RateLimitOptions | RateLimiter;
/**
 * A token bucket: `burst` requests go out at once, then one every `1 / requestsPerSecond` seconds.
 * It only coordinates requests inside this process; several processes sharing one API key should
 * each get a share of the limit (e.g. `requestsPerSecond: 8 / processCount`).
 *
 * @param {RateLimitOptions} [options]
 * @returns {RateLimiter}
 */
export function createRateLimiter(options?: RateLimitOptions): RateLimiter;
/**
 * @param {RateLimitSetting | undefined} setting
 * @param {RateLimiter | undefined} fallback - Used when `setting` is undefined.
 * @returns {RateLimiter | undefined}
 */
export function toRateLimiter(setting: RateLimitSetting | undefined, fallback: RateLimiter | undefined): RateLimiter | undefined;

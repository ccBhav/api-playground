export const USER_AGENT: string;
/**
 * `User-Agent` for the SDK, with the calling app appended when given (e.g. `"constructionclock/1.4"`).
 * @param {string} [appName]
 */
export function userAgentFor(appName?: string): string;
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
export function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit & {
    method: string;
}, { timeoutMs, signal }: {
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<{
    response: Response;
    text: string;
}>;
/**
 * Wait before retry number `retry` (0-based): exponential backoff with jitter, or `Retry-After`
 * when the server sent one.
 * @param {number} retry
 * @param {number} [retryAfterSeconds]
 */
export function retryDelayMs(retry: number, retryAfterSeconds?: number): number;
/**
 * @param {number} ms
 * @param {AbortSignal} [signal] - Abandons the wait (with `MyobAbortError`) when it fires.
 * @returns {Promise<void>}
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void>;

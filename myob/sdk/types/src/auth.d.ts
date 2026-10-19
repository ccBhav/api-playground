export type MyobTokens = import("./tokens").MyobTokens;
export type StoredMyobTokens = import("./tokens").StoredMyobTokens;
export type MyobLogger = import("./options").MyobLogger;
export type RateLimiter = import("./rateLimiter").RateLimiter;
export type RateLimitSetting = import("./rateLimiter").RateLimitSetting;
export type MyobAuthConfig = {
    /**
     * - API key from the MYOB developer dashboard. Defaults to
     * `process.env.MYOB_CLIENT_ID`.
     */
    clientId?: string | undefined;
    /**
     * - Defaults to `process.env.MYOB_CLIENT_SECRET`.
     */
    clientSecret?: string | undefined;
    /**
     * - Must exactly match the one registered with MYOB. Defaults to
     * `process.env.MYOB_REDIRECT_URI`.
     */
    redirectUri?: string | undefined;
    /**
     * - Defaults to `SCOPES.ALL`.
     */
    scopes?: string | readonly string[] | undefined;
    /**
     * - Sent as `x-myobapi-version`. Defaults to `"v2"`.
     */
    apiVersion?: string | undefined;
    /**
     * - Timeout for token requests. Defaults to 60000.
     */
    timeoutMs?: number | undefined;
    /**
     * - Paces AccountRight calls from every client made with
     * this auth (they share one API key). Defaults to 8 requests a second; `false` turns it off.
     */
    rateLimit?: import("./rateLimiter").RateLimitSetting | undefined;
    /**
     * - Appended to the `User-Agent`, e.g. `"constructionclock/1.4"`.
     */
    appName?: string | undefined;
    logger?: import("./options").MyobLogger | undefined;
    /**
     * - Custom `fetch` for proxies, tracing or tests.
     */
    fetch?: typeof fetch | undefined;
};
/**
 * Per-call overrides for token requests.
 */
export type TokenRequestOptions = {
    /**
     * - Defaults to the auth's `timeoutMs`.
     */
    timeoutMs?: number | undefined;
    /**
     * - Cancels the request with `MyobAbortError`.
     */
    signal?: AbortSignal | undefined;
};
export type CallbackOptionsOnly = {
    /**
     * - The `state` you passed to `getAuthorizeUrl`. When given,
     * a callback with any other `state` throws `MyobAuthError` with code `state_mismatch`.
     */
    expectedState?: string | undefined;
};
export type CallbackOptions = CallbackOptionsOnly & TokenRequestOptions;
export type CallbackResult = {
    tokens: MyobTokens;
    /**
     * - The company file the user picked, if MYOB sent one.
     */
    businessId: string | undefined;
    /**
     * - Echo of the `state` passed to `getAuthorizeUrl`.
     */
    state: string | undefined;
};
export type ConnectOptions = {
    /**
     * - Stored tokens (needs at least `refreshToken`).
     */
    tokens: StoredMyobTokens;
    /**
     * - Persist new tokens here. It is awaited;
     * if it throws, the error reaches the caller, but the connection keeps the new tokens so it
     * stays usable.
     */
    onRefresh?: ((tokens: MyobTokens) => unknown) | undefined;
    /**
     * - Refresh this many seconds before expiry. Defaults to 60.
     */
    skewSeconds?: number | undefined;
    /**
     * - Read this
     * company's tokens from your database. Needed when more than one process (API servers, workers)
     * can refresh the same company: before refreshing, and after an `invalid_grant`, the connection
     * reloads and adopts tokens another process saved instead of using a dead refresh token.
     */
    loadTokens?: (() => Promise<StoredMyobTokens | null | undefined>) | undefined;
    /**
     * - Run `refresh` while
     * holding a lock shared by every process for this company (e.g. a Redis or Mongo lock). With
     * `loadTokens`, this makes concurrent refreshes across processes safe.
     */
    withRefreshLock?: (<T>(refresh: () => Promise<T>) => Promise<T>) | undefined;
};
export type MyobConnection = {
    /**
     * - A valid access token, refreshing first if needed.
     */
    getAccessToken: () => Promise<string>;
    /**
     * - Refresh now, e.g.
     * after MYOB rejected `rejectedAccessToken` with a 401. Skips the refresh if the connection has
     * already moved past that token.
     */
    forceRefresh: (rejectedAccessToken?: string) => Promise<string>;
    /**
     * - Headers every AccountRight API call needs.
     */
    headers: () => Promise<Record<string, string>>;
    /**
     * - The tokens currently held (latest after any refresh).
     */
    getTokens: () => MyobTokens;
    /**
     * - Shared pacing for this API key; clients use it by default.
     */
    rateLimiter?: import("./rateLimiter").RateLimiter | undefined;
    /**
     * - `User-Agent` clients send, including the auth's `appName`.
     */
    userAgent?: string | undefined;
};
export type MyobAuth = {
    getAuthorizeUrl: (options?: {
        state?: string;
        prompt?: string | null;
    }) => string;
    exchangeCode: (code: string, options?: TokenRequestOptions) => Promise<MyobTokens>;
    refresh: (refreshToken: string, options?: TokenRequestOptions) => Promise<MyobTokens>;
    handleCallback: (query: Record<string, unknown> | URLSearchParams | string, options?: CallbackOptions) => Promise<CallbackResult>;
    connect: (options: ConnectOptions) => MyobConnection;
};
/**
 * Create a MYOB OAuth client. Holds config only, never tokens, so one instance can
 * serve every company; use `connect` for a per-company token holder.
 *
 * @param {MyobAuthConfig} [config] - `clientId`, `clientSecret` and `redirectUri` fall back to
 *   `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET` and `MYOB_REDIRECT_URI`.
 * @returns {MyobAuth}
 */
export function createMyobAuth(config?: MyobAuthConfig): MyobAuth;

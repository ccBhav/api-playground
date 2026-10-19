const {
  API_VERSION,
  AUTHORIZE_URL,
  DEFAULT_EXPIRY_SKEW_SECONDS,
  DEFAULT_TIMEOUT_MS,
  SCOPES,
  TOKEN_URL,
} = require("./constants");
const { parseBody } = require("./body");
const { MyobAuthError } = require("./errors");
const { checkOptions, required, requiredOrEnv, toLogger } = require("./options");
const { toRateLimiter } = require("./rateLimiter");
const { fromStored, isExpired, toTokens } = require("./tokens");
const { fetchWithTimeout, userAgentFor } = require("./transport");

/** @typedef {import("./tokens").MyobTokens} MyobTokens */
/** @typedef {import("./tokens").StoredMyobTokens} StoredMyobTokens */
/** @typedef {import("./options").MyobLogger} MyobLogger */
/** @typedef {import("./rateLimiter").RateLimiter} RateLimiter */
/** @typedef {import("./rateLimiter").RateLimitSetting} RateLimitSetting */

/**
 * @typedef {Object} MyobAuthConfig
 * @property {string} [clientId] - API key from the MYOB developer dashboard. Defaults to
 *   `process.env.MYOB_CLIENT_ID`.
 * @property {string} [clientSecret] - Defaults to `process.env.MYOB_CLIENT_SECRET`.
 * @property {string} [redirectUri] - Must exactly match the one registered with MYOB. Defaults to
 *   `process.env.MYOB_REDIRECT_URI`.
 * @property {string | readonly string[]} [scopes] - Defaults to `SCOPES.ALL`.
 * @property {string} [apiVersion] - Sent as `x-myobapi-version`. Defaults to `"v2"`.
 * @property {number} [timeoutMs] - Timeout for token requests. Defaults to 60000.
 * @property {RateLimitSetting} [rateLimit] - Paces AccountRight calls from every client made with
 *   this auth (they share one API key). Defaults to 8 requests a second; `false` turns it off.
 * @property {string} [appName] - Appended to the `User-Agent`, e.g. `"constructionclock/1.4"`.
 * @property {MyobLogger} [logger]
 * @property {typeof fetch} [fetch] - Custom `fetch` for proxies, tracing or tests.
 */

/**
 * Per-call overrides for token requests.
 * @typedef {Object} TokenRequestOptions
 * @property {number} [timeoutMs] - Defaults to the auth's `timeoutMs`.
 * @property {AbortSignal} [signal] - Cancels the request with `MyobAbortError`.
 */

/**
 * @typedef {Object} CallbackOptionsOnly
 * @property {string} [expectedState] - The `state` you passed to `getAuthorizeUrl`. When given,
 *   a callback with any other `state` throws `MyobAuthError` with code `state_mismatch`.
 */

/** @typedef {CallbackOptionsOnly & TokenRequestOptions} CallbackOptions */

/**
 * @typedef {Object} CallbackResult
 * @property {MyobTokens} tokens
 * @property {string | undefined} businessId - The company file the user picked, if MYOB sent one.
 * @property {string | undefined} state - Echo of the `state` passed to `getAuthorizeUrl`.
 */

/**
 * @typedef {Object} ConnectOptions
 * @property {StoredMyobTokens} tokens - Stored tokens (needs at least `refreshToken`).
 * @property {(tokens: MyobTokens) => unknown} [onRefresh] - Persist new tokens here. It is awaited;
 *   if it throws, the error reaches the caller, but the connection keeps the new tokens so it
 *   stays usable.
 * @property {number} [skewSeconds] - Refresh this many seconds before expiry. Defaults to 60.
 * @property {() => Promise<StoredMyobTokens | null | undefined>} [loadTokens] - Read this
 *   company's tokens from your database. Needed when more than one process (API servers, workers)
 *   can refresh the same company: before refreshing, and after an `invalid_grant`, the connection
 *   reloads and adopts tokens another process saved instead of using a dead refresh token.
 * @property {<T>(refresh: () => Promise<T>) => Promise<T>} [withRefreshLock] - Run `refresh` while
 *   holding a lock shared by every process for this company (e.g. a Redis or Mongo lock). With
 *   `loadTokens`, this makes concurrent refreshes across processes safe.
 */

/**
 * @typedef {Object} MyobConnection
 * @property {() => Promise<string>} getAccessToken - A valid access token, refreshing first if needed.
 * @property {(rejectedAccessToken?: string) => Promise<string>} forceRefresh - Refresh now, e.g.
 *   after MYOB rejected `rejectedAccessToken` with a 401. Skips the refresh if the connection has
 *   already moved past that token.
 * @property {() => Promise<Record<string, string>>} headers - Headers every AccountRight API call needs.
 * @property {() => MyobTokens} getTokens - The tokens currently held (latest after any refresh).
 * @property {RateLimiter} [rateLimiter] - Shared pacing for this API key; clients use it by default.
 * @property {string} [userAgent] - `User-Agent` clients send, including the auth's `appName`.
 */

/**
 * @typedef {Object} MyobAuth
 * @property {(options?: { state?: string, prompt?: string | null }) => string} getAuthorizeUrl
 * @property {(code: string, options?: TokenRequestOptions) => Promise<MyobTokens>} exchangeCode
 * @property {(refreshToken: string, options?: TokenRequestOptions) => Promise<MyobTokens>} refresh
 * @property {(query: Record<string, unknown> | URLSearchParams | string, options?: CallbackOptions) => Promise<CallbackResult>} handleCallback
 * @property {(options: ConnectOptions) => MyobConnection} connect
 */

const CONFIG_KEYS = [
  "clientId", "clientSecret", "redirectUri", "scopes", "apiVersion", "timeoutMs", "rateLimit",
  "appName", "logger", "fetch",
];
const CONNECT_KEYS = ["tokens", "onRefresh", "skewSeconds", "loadTokens", "withRefreshLock"];
const TOKEN_REQUEST_KEYS = ["timeoutMs", "signal"];
const CALLBACK_KEYS = ["expectedState", ...TOKEN_REQUEST_KEYS];

/** Epoch ms of `expiresAt` (Date, ISO string or epoch ms), or 0 when missing or invalid. */
const expiryOf = (/** @type {StoredMyobTokens | null | undefined} */ tokens) => {
  const time = tokens?.expiresAt ? new Date(tokens.expiresAt).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
};

/**
 * Normalise whatever the redirect route has into URLSearchParams:
 * Express `req.query`, URLSearchParams, a full URL, or a path like `/callback?code=...`.
 * @param {Record<string, unknown> | URLSearchParams | string} input
 */
const toSearchParams = (input) => {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") {
    return new URL(input, "http://localhost").searchParams;
  }
  return new URLSearchParams(
    Object.entries(input ?? {}).map(([key, value]) => [
      key,
      String(Array.isArray(value) ? value[0] : value),
    ]),
  );
};

/**
 * Create a MYOB OAuth client. Holds config only, never tokens, so one instance can
 * serve every company; use `connect` for a per-company token holder.
 *
 * @param {MyobAuthConfig} [config] - `clientId`, `clientSecret` and `redirectUri` fall back to
 *   `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET` and `MYOB_REDIRECT_URI`.
 * @returns {MyobAuth}
 */
const createMyobAuth = (config = {}) => {
  const logger = toLogger(config.logger);
  checkOptions("createMyobAuth", config, CONFIG_KEYS, logger);
  const clientId = requiredOrEnv("createMyobAuth", config, "clientId", "MYOB_CLIENT_ID");
  const clientSecret = requiredOrEnv("createMyobAuth", config, "clientSecret", "MYOB_CLIENT_SECRET");
  const redirectUri = requiredOrEnv("createMyobAuth", config, "redirectUri", "MYOB_REDIRECT_URI");
  const scopes = config.scopes ?? SCOPES.ALL;
  const scope = typeof scopes === "string" ? scopes : scopes.join(" ");
  const apiVersion = config.apiVersion ?? API_VERSION;
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rateLimiter = toRateLimiter(config.rateLimit ?? {}, undefined);
  const userAgent = userAgentFor(config.appName);
  const fetchImpl = config.fetch ?? globalThis.fetch;
  let warnedAboutState = false;

  /**
   * Token requests time out but are never retried: MYOB invalidates a refresh token as soon as it
   * is used, so resending one whose response was lost would only get `invalid_grant`.
   * @param {Record<string, string>} form
   * @param {TokenRequestOptions} [options]
   * @returns {Promise<MyobTokens>}
   */
  const postToken = async (form, options = {}) => {
    const { response, text } = await fetchWithTimeout(
      fetchImpl,
      TOKEN_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": userAgent,
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          ...form,
        }).toString(),
      },
      { timeoutMs: options.timeoutMs ?? defaultTimeoutMs, signal: options.signal },
    );
    const receivedAt = Date.now();
    const body = parseBody(text);
    logger.debug("MYOB token request", { grantType: form.grant_type, status: response.status });

    if (!response.ok) {
      const code = typeof body === "object" ? body?.error : undefined;
      const description =
        typeof body === "object" ? body?.error_description : undefined;
      throw new MyobAuthError(
        `MYOB token request failed (${response.status}): ${description ?? code ?? body}`,
        { status: response.status, code, description, body },
      );
    }
    if (typeof body !== "object" || !body?.access_token) {
      throw new MyobAuthError("MYOB token response had no access_token", {
        status: response.status,
        body,
      });
    }
    return toTokens(body, receivedAt);
  };

  /**
   * URL to send the user to so they can log in and grant access.
   * @param {{ state?: string, prompt?: string | null }} [options]
   *   `prompt` defaults to "consent" so the user can pick a company file; pass null to omit it.
   */
  const getAuthorizeUrl = ({ state, prompt = "consent" } = {}) => {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    if (prompt) url.searchParams.set("prompt", prompt);
    if (state) url.searchParams.set("state", state);
    return url.toString();
  };

  /**
   * Swap the one-time code from the redirect for tokens. MYOB codes expire in a few minutes.
   * @param {string} code
   * @param {TokenRequestOptions} [options]
   */
  const exchangeCode = (code, options) => {
    if (!code) throw new TypeError("exchangeCode: `code` is required");
    checkOptions("exchangeCode options", options, TOKEN_REQUEST_KEYS, logger);
    return postToken(
      { grant_type: "authorization_code", code, redirect_uri: redirectUri, scope },
      options,
    );
  };

  /**
   * Get a fresh access token. The returned refresh token replaces the old one.
   * @param {string} refreshToken
   * @param {TokenRequestOptions} [options]
   */
  const refresh = (refreshToken, options) => {
    if (!refreshToken) {
      throw new TypeError("refresh: `refreshToken` is required");
    }
    checkOptions("refresh options", options, TOKEN_REQUEST_KEYS, logger);
    return postToken({ grant_type: "refresh_token", refresh_token: refreshToken }, options);
  };

  /**
   * Handle MYOB's redirect back to `redirectUri` in one call.
   * @param {Record<string, unknown> | URLSearchParams | string} query
   * @param {CallbackOptions} [options]
   * @returns {Promise<CallbackResult>}
   */
  const handleCallback = async (query, options = {}) => {
    checkOptions("handleCallback options", options, CALLBACK_KEYS, logger);
    const { expectedState, ...requestOptions } = options;
    const params = toSearchParams(query);
    const state = params.get("state") ?? undefined;

    const error = params.get("error");
    if (error) {
      const description = params.get("error_description") ?? undefined;
      throw new MyobAuthError(
        `MYOB authorization failed: ${description ?? error}`,
        { code: error, description, body: Object.fromEntries(params) },
      );
    }

    if (expectedState !== undefined && state !== expectedState) {
      throw new MyobAuthError("MYOB callback `state` does not match `expectedState`", {
        code: "state_mismatch",
      });
    }
    if (expectedState === undefined && state && !warnedAboutState) {
      warnedAboutState = true;
      logger.warn("handleCallback: pass `{ expectedState }` so the SDK checks `state` for you");
    }

    const code = params.get("code");
    if (!code) {
      throw new MyobAuthError("MYOB callback had no `code` parameter", {
        body: Object.fromEntries(params),
      });
    }

    return {
      tokens: await exchangeCode(code, requestOptions),
      businessId: params.get("businessId") ?? undefined,
      state,
    };
  };

  /**
   * Hold one company's tokens and refresh them on demand. Concurrent callers in this process
   * share a single in-flight refresh, since MYOB invalidates the old refresh token on use. Pass
   * `loadTokens` (and ideally `withRefreshLock`) when other processes refresh the same company.
   *
   * @param {ConnectOptions} options
   * @returns {MyobConnection}
   */
  const connect = (options) => {
    checkOptions("connect", options, CONNECT_KEYS, logger);
    const tokens = required("connect", options, "tokens");
    const { onRefresh, skewSeconds = DEFAULT_EXPIRY_SKEW_SECONDS, loadTokens, withRefreshLock } = options;
    let current = fromStored(tokens);
    /** @type {Promise<MyobTokens> | null} */
    let inFlight = null;

    /**
     * Adopt the stored tokens if another process saved newer ones than we hold.
     * @returns {Promise<boolean>} Whether newer tokens were adopted.
     */
    const adoptStoredTokens = async () => {
      if (!loadTokens) return false;
      const stored = await loadTokens();
      if (!stored?.refreshToken || stored.refreshToken === current.refreshToken) return false;
      if (expiryOf(stored) <= expiryOf(current)) return false;
      current = fromStored(stored);
      logger.debug("MYOB tokens reloaded from storage", { expiresAt: new Date(expiryOf(current)).toISOString() });
      return true;
    };

    const refreshNow = async () => {
      if ((await adoptStoredTokens()) && !isExpired(current, { skewSeconds })) return current;
      if (!current.refreshToken) {
        throw new MyobAuthError(
          "Access token expired and no refresh token is stored; the user must reconnect",
          { code: "no_refresh_token" },
        );
      }
      let next;
      try {
        next = await refresh(current.refreshToken);
      } catch (error) {
        // Another process used this refresh token first; its tokens are in storage.
        if (error instanceof MyobAuthError && error.code === "invalid_grant" && (await adoptStoredTokens())) {
          return current;
        }
        throw error;
      }
      current = next;
      logger.debug("MYOB tokens refreshed", { expiresAt: next.expiresAt.toISOString() });
      await onRefresh?.(next);
      return next;
    };

    const refreshOnce = () => {
      inFlight ??= (async () => {
        try {
          return await (withRefreshLock ? withRefreshLock(refreshNow) : refreshNow());
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const getAccessToken = async () => {
      if (inFlight) return (await inFlight).accessToken;
      if (isExpired(current, { skewSeconds })) {
        return (await refreshOnce()).accessToken;
      }
      return current.accessToken;
    };

    /** @param {string} [rejectedAccessToken] */
    const forceRefresh = async (rejectedAccessToken) => {
      if (inFlight) return (await inFlight).accessToken;
      if (rejectedAccessToken && current.accessToken !== rejectedAccessToken) {
        return current.accessToken;
      }
      return (await refreshOnce()).accessToken;
    };

    const headers = async () => ({
      Authorization: `Bearer ${await getAccessToken()}`,
      "x-myobapi-key": clientId,
      "x-myobapi-version": apiVersion,
      Accept: "application/json",
    });

    return {
      getAccessToken,
      forceRefresh,
      headers,
      getTokens: () => ({ ...current }),
      rateLimiter,
      userAgent,
    };
  };

  return { getAuthorizeUrl, exchangeCode, refresh, handleCallback, connect };
};

module.exports = { createMyobAuth };

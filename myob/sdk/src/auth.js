const {
  API_VERSION,
  AUTHORIZE_URL,
  DEFAULT_EXPIRY_SKEW_SECONDS,
  SCOPES,
  TOKEN_URL,
} = require("./constants");
const { parseBody } = require("./body");
const { MyobAuthError } = require("./errors");
const { isExpired, toTokens } = require("./tokens");

/** @typedef {import("./tokens").MyobTokens} MyobTokens */

/**
 * @typedef {Object} MyobAuthConfig
 * @property {string} clientId - API key from the MYOB developer dashboard.
 * @property {string} clientSecret
 * @property {string} redirectUri - Must exactly match the one registered with MYOB.
 * @property {string | readonly string[]} [scopes] - Defaults to `SCOPES.ALL`.
 * @property {typeof fetch} [fetch] - Override for tests.
 */

/**
 * @typedef {Object} CallbackResult
 * @property {MyobTokens} tokens
 * @property {string | undefined} businessId - The company file the user picked, if MYOB sent one.
 * @property {string | undefined} state - Echo of the `state` passed to `getAuthorizeUrl`; verify it.
 */

/**
 * @typedef {Object} MyobConnection
 * @property {() => Promise<string>} getAccessToken - A valid access token, refreshing first if needed.
 * @property {() => Promise<Record<string, string>>} headers - Headers every AccountRight API call needs.
 * @property {() => MyobTokens} getTokens - The tokens currently held (latest after any refresh).
 */

const required = (config, name) => {
  if (!config?.[name]) {
    throw new TypeError(`createMyobAuth: \`${name}\` is required`);
  }
  return config[name];
};

/**
 * Normalise whatever the redirect route has into URLSearchParams:
 * Express `req.query`, URLSearchParams, a full URL, or a path like `/callback?code=...`.
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
 * serve every company; use {@link connect} for a per-company token holder.
 *
 * @param {MyobAuthConfig} config
 */
const createMyobAuth = (config) => {
  const clientId = required(config, "clientId");
  const clientSecret = required(config, "clientSecret");
  const redirectUri = required(config, "redirectUri");
  const scopes = config.scopes ?? SCOPES.ALL;
  const scope = typeof scopes === "string" ? scopes : scopes.join(" ");
  const fetchImpl = config.fetch ?? globalThis.fetch;

  /** @returns {Promise<MyobTokens>} */
  const postToken = async (form) => {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        ...form,
      }).toString(),
    });
    const receivedAt = Date.now();
    const body = parseBody(await response.text());

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
   */
  const exchangeCode = (code) => {
    if (!code) throw new TypeError("exchangeCode: `code` is required");
    return postToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope,
    });
  };

  /**
   * Get a fresh access token. The returned refresh token replaces the old one.
   * @param {string} refreshToken
   */
  const refresh = (refreshToken) => {
    if (!refreshToken) {
      throw new TypeError("refresh: `refreshToken` is required");
    }
    return postToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  };

  /**
   * Handle MYOB's redirect back to `redirectUri` in one call.
   * @param {Record<string, unknown> | URLSearchParams | string} query
   * @returns {Promise<CallbackResult>}
   */
  const handleCallback = async (query) => {
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

    const code = params.get("code");
    if (!code) {
      throw new MyobAuthError("MYOB callback had no `code` parameter", {
        body: Object.fromEntries(params),
      });
    }

    return {
      tokens: await exchangeCode(code),
      businessId: params.get("businessId") ?? undefined,
      state,
    };
  };

  /**
   * Hold one company's tokens and refresh them on demand. Concurrent callers share a
   * single in-flight refresh, since MYOB invalidates the old refresh token on use.
   *
   * @param {Object} options
   * @param {Partial<MyobTokens>} options.tokens - Stored tokens (needs at least `refreshToken`).
   * @param {(tokens: MyobTokens) => unknown} [options.onRefresh] - Persist new tokens here.
   *   It is awaited; if it throws, the error reaches the caller, but the connection keeps the
   *   new tokens so it stays usable.
   * @param {number} [options.skewSeconds]
   * @returns {MyobConnection}
   */
  const connect = ({
    tokens,
    onRefresh,
    skewSeconds = DEFAULT_EXPIRY_SKEW_SECONDS,
  }) => {
    let current = /** @type {MyobTokens} */ ({ ...tokens });
    /** @type {Promise<MyobTokens> | null} */
    let inFlight = null;

    const refreshOnce = () => {
      inFlight ??= (async () => {
        try {
          if (!current.refreshToken) {
            throw new MyobAuthError(
              "Access token expired and no refresh token is stored; the user must reconnect",
            );
          }
          const next = await refresh(current.refreshToken);
          current = next;
          await onRefresh?.(next);
          return next;
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

    const headers = async () => ({
      Authorization: `Bearer ${await getAccessToken()}`,
      "x-myobapi-key": clientId,
      "x-myobapi-version": API_VERSION,
      Accept: "application/json",
    });

    return { getAccessToken, headers, getTokens: () => ({ ...current }) };
  };

  return {
    getAuthorizeUrl,
    exchangeCode,
    refresh,
    handleCallback,
    isExpired,
    connect,
  };
};

module.exports = { createMyobAuth };

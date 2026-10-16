const {
  DEFAULT_EXPIRY_SKEW_SECONDS,
  DEFAULT_SCOPE,
  TOKEN_URL,
} = require("./constants");
const { parseBody } = require("./body");
const { WagepointAuthError } = require("./errors");
const { isExpired, toTokens } = require("./tokens");

/** @typedef {import("./tokens").WagepointTokens} WagepointTokens */

/**
 * @typedef {Object} WagepointAuthConfig
 * @property {string} clientId - Issued by Wagepoint.
 * @property {string} clientSecret - Issued by Wagepoint. Server-side only; never log it.
 * @property {string | readonly string[]} [scope] - Defaults to `DEFAULT_SCOPE` ("services").
 * @property {string} [tokenUrl] - Defaults to `TOKEN_URL`.
 * @property {typeof fetch} [fetch] - Override for tests.
 */

/**
 * @typedef {Object} WagepointConnection
 * @property {() => Promise<string>} getAccessToken - A valid access token, requesting one first if needed.
 * @property {(staleAccessToken?: string) => Promise<string>} renew - Get a new token after a 401.
 *   Pass the token that was rejected: if another caller already replaced it, that newer token is
 *   returned instead of requesting yet another.
 * @property {() => Promise<Record<string, string>>} headers - `Authorization` and `Accept` headers.
 * @property {() => WagepointTokens | null} getTokens - The token currently held, if any.
 */

const required = (config, name) => {
  if (!config?.[name]) {
    throw new TypeError(`createWagepointAuth: \`${name}\` is required`);
  }
  return config[name];
};

/**
 * Create a Wagepoint OAuth client for the client credentials grant. Holds config only, never
 * tokens; use {@link connect} for a token holder that caches and renews the token.
 *
 * @param {WagepointAuthConfig} config
 */
const createWagepointAuth = (config) => {
  const clientId = required(config, "clientId");
  const clientSecret = required(config, "clientSecret");
  const scopes = config.scope ?? DEFAULT_SCOPE;
  const scope = typeof scopes === "string" ? scopes : scopes.join(" ");
  const tokenUrl = config.tokenUrl ?? TOKEN_URL;
  const fetchImpl = config.fetch ?? globalThis.fetch;

  /**
   * Exchange the client credentials for a new access token. Most code wants {@link connect}, which
   * caches the token; Wagepoint asks integrations not to request one per API call.
   * @returns {Promise<WagepointTokens>}
   */
  const requestToken = async () => {
    const response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      }).toString(),
    });
    const receivedAt = Date.now();
    const body = parseBody(await response.text());

    if (!response.ok) {
      const code = typeof body === "object" ? body?.error : undefined;
      const description =
        typeof body === "object" ? body?.error_description : undefined;
      throw new WagepointAuthError(
        `Wagepoint token request failed (${response.status}): ${description ?? code ?? body}`,
        { status: response.status, code, description, body },
      );
    }
    if (typeof body !== "object" || !body?.access_token) {
      throw new WagepointAuthError("Wagepoint token response had no access_token", {
        status: response.status,
        body,
      });
    }
    return toTokens(body, receivedAt);
  };

  /**
   * Hold an access token and request a new one when it expires. Concurrent callers share a single
   * in-flight token request.
   *
   * @param {Object} [options]
   * @param {Partial<WagepointTokens> | null} [options.tokens] - A stored token to start from, so
   *   restarts or other processes don't need a new one.
   * @param {(tokens: WagepointTokens) => unknown} [options.onToken] - Persist each new token here.
   *   It is awaited; if it throws, the error reaches the caller, but the connection keeps the new
   *   token so it stays usable.
   * @param {number} [options.skewSeconds]
   * @returns {WagepointConnection}
   */
  const connect = ({
    tokens,
    onToken,
    skewSeconds = DEFAULT_EXPIRY_SKEW_SECONDS,
  } = {}) => {
    /** @type {WagepointTokens | null} */
    let current = tokens?.accessToken ? /** @type {WagepointTokens} */ ({ ...tokens }) : null;
    /** @type {Promise<WagepointTokens> | null} */
    let inFlight = null;

    const requestOnce = () => {
      inFlight ??= (async () => {
        try {
          const next = await requestToken();
          current = next;
          await onToken?.(next);
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
        return (await requestOnce()).accessToken;
      }
      return /** @type {WagepointTokens} */ (current).accessToken;
    };

    const renew = async (staleAccessToken) => {
      if (inFlight) return (await inFlight).accessToken;
      if (
        staleAccessToken &&
        current?.accessToken &&
        current.accessToken !== staleAccessToken &&
        !isExpired(current, { skewSeconds })
      ) {
        return current.accessToken;
      }
      return (await requestOnce()).accessToken;
    };

    const headers = async () => ({
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
    });

    return {
      getAccessToken,
      renew,
      headers,
      getTokens: () => (current ? { ...current } : null),
    };
  };

  return { requestToken, isExpired, connect };
};

module.exports = { createWagepointAuth };

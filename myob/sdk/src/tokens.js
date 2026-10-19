const { DEFAULT_EXPIRY_SKEW_SECONDS, DEFAULT_TOKEN_LIFETIME_SECONDS } = require("./constants");

/**
 * Tokens in the shape the SDK hands out and accepts back. Safe to store as-is
 * (e.g. in Mongo); `expiresAt` may come back as a Date, ISO string or epoch ms.
 *
 * @typedef {Object} MyobTokens
 * @property {string} accessToken
 * @property {string} refreshToken - MYOB rotates this on every refresh; always persist the latest.
 * @property {Date} expiresAt - Absolute expiry of the access token.
 * @property {string} [scope]
 * @property {string} [tokenType]
 */

/**
 * Tokens as you hand them back to the SDK from storage: like {@link MyobTokens}, but every field is
 * optional and `expiresAt` may be whatever your database returns (a Date, an ISO string or epoch ms).
 *
 * @typedef {Omit<Partial<MyobTokens>, "expiresAt"> & { expiresAt?: Date | string | number | null }} StoredMyobTokens
 */

/**
 * Convert MYOB's token response into {@link MyobTokens}.
 * @param {Record<string, any>} raw - JSON body from the token endpoint.
 * @param {number} [now] - Epoch ms the response was received.
 * @returns {MyobTokens}
 */
const toTokens = (raw, now = Date.now()) => {
  // Without a usable expires_in, expiresAt would be an Invalid Date and every call would refresh.
  const seconds = Number(raw.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TOKEN_LIFETIME_SECONDS;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: new Date(now + lifetime * 1000),
    scope: raw.scope,
    tokenType: raw.token_type,
  };
};

/**
 * True when the access token is missing, expired, or within `skewSeconds` of expiring.
 * @param {StoredMyobTokens | null | undefined} tokens
 * @param {{ skewSeconds?: number, now?: number }} [options]
 */
const isExpired = (
  tokens,
  { skewSeconds = DEFAULT_EXPIRY_SKEW_SECONDS, now = Date.now() } = {},
) => {
  if (!tokens?.accessToken || !tokens.expiresAt) return true;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - skewSeconds * 1000 <= now;
};

/**
 * Stored tokens with `expiresAt` turned into a Date (epoch 0, i.e. expired, when missing or
 * invalid), so the SDK only ever hands out {@link MyobTokens}. Other fields are kept.
 * @template {StoredMyobTokens} T
 * @param {T} stored
 * @returns {Omit<T, "expiresAt"> & MyobTokens}
 */
const fromStored = (stored) => {
  const time = stored.expiresAt ? new Date(stored.expiresAt).getTime() : 0;
  return /** @type {any} */ ({ ...stored, expiresAt: new Date(Number.isNaN(time) ? 0 : time) });
};

module.exports = { toTokens, isExpired, fromStored };

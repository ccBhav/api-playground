const { DEFAULT_EXPIRY_SKEW_SECONDS } = require("./constants");

/**
 * Tokens in the shape the SDK hands out and accepts back. Safe to store as-is (e.g. in Redis or
 * Mongo) so several processes can share one token; `expiresAt` may come back as a Date, ISO string
 * or epoch ms. The client credentials grant has no refresh token: a new token is simply requested.
 *
 * @typedef {Object} WagepointTokens
 * @property {string} accessToken
 * @property {Date} expiresAt - Absolute expiry of the access token.
 * @property {string} [scope]
 * @property {string} [tokenType]
 */

/**
 * Convert Wagepoint's token response into {@link WagepointTokens}.
 * @param {Record<string, any>} raw - JSON body from the token endpoint.
 * @param {number} [now] - Epoch ms the response was received.
 * @returns {WagepointTokens}
 */
const toTokens = (raw, now = Date.now()) => ({
  accessToken: raw.access_token,
  expiresAt: new Date(now + Number(raw.expires_in) * 1000),
  scope: raw.scope,
  tokenType: raw.token_type,
});

/**
 * True when the access token is missing, expired, or within `skewSeconds` of expiring.
 * @param {Partial<WagepointTokens> | null | undefined} tokens
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

module.exports = { toTokens, isExpired };

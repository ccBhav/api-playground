/**
 * Tokens in the shape the SDK hands out and accepts back. Safe to store as-is
 * (e.g. in Mongo); `expiresAt` may come back as a Date, ISO string or epoch ms.
 */
export type MyobTokens = {
    accessToken: string;
    /**
     * - MYOB rotates this on every refresh; always persist the latest.
     */
    refreshToken: string;
    /**
     * - Absolute expiry of the access token.
     */
    expiresAt: Date;
    scope?: string | undefined;
    tokenType?: string | undefined;
};
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
 * Convert MYOB's token response into {@link MyobTokens}.
 * @param {Record<string, any>} raw - JSON body from the token endpoint.
 * @param {number} [now] - Epoch ms the response was received.
 * @returns {MyobTokens}
 */
export function toTokens(raw: Record<string, any>, now?: number): MyobTokens;
/**
 * True when the access token is missing, expired, or within `skewSeconds` of expiring.
 * @param {Partial<MyobTokens> | null | undefined} tokens
 * @param {{ skewSeconds?: number, now?: number }} [options]
 */
export function isExpired(tokens: Partial<MyobTokens> | null | undefined, { skewSeconds, now }?: {
    skewSeconds?: number;
    now?: number;
}): boolean;

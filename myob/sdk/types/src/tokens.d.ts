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
 * Tokens as you hand them back to the SDK from storage: like {@link MyobTokens}, but every field is
 * optional and `expiresAt` may be whatever your database returns (a Date, an ISO string or epoch ms).
 */
export type StoredMyobTokens = Omit<Partial<MyobTokens>, "expiresAt"> & {
    expiresAt?: Date | string | number | null;
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
export function toTokens(raw: Record<string, any>, now?: number): MyobTokens;
/**
 * True when the access token is missing, expired, or within `skewSeconds` of expiring.
 * @param {StoredMyobTokens | null | undefined} tokens
 * @param {{ skewSeconds?: number, now?: number }} [options]
 */
export function isExpired(tokens: StoredMyobTokens | null | undefined, { skewSeconds, now }?: {
    skewSeconds?: number;
    now?: number;
}): boolean;
/**
 * Stored tokens with `expiresAt` turned into a Date (epoch 0, i.e. expired, when missing or
 * invalid), so the SDK only ever hands out {@link MyobTokens}. Other fields are kept.
 * @template {StoredMyobTokens} T
 * @param {T} stored
 * @returns {Omit<T, "expiresAt"> & MyobTokens}
 */
export function fromStored<T extends StoredMyobTokens>(stored: T): Omit<T, "expiresAt"> & MyobTokens;

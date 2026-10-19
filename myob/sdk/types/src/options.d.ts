/**
 * Anything with `debug` and `warn` methods, e.g. `console` or a pino/winston logger. The SDK logs
 * method, URL, status, timing, retries and token refreshes; never headers, tokens or bodies.
 */
export type MyobLogger = {
    debug?: ((message: string, details?: Record<string, unknown>) => void) | undefined;
    warn?: ((message: string, details?: Record<string, unknown>) => void) | undefined;
};
/**
 * Anything with `debug` and `warn` methods, e.g. `console` or a pino/winston logger. The SDK logs
 * method, URL, status, timing, retries and token refreshes; never headers, tokens or bodies.
 *
 * @typedef {Object} MyobLogger
 * @property {(message: string, details?: Record<string, unknown>) => void} [debug]
 * @property {(message: string, details?: Record<string, unknown>) => void} [warn]
 */
/**
 * Fill in a logger: `debug` is dropped and `warn` goes to `process.emitWarning` unless given.
 * @param {MyobLogger} [logger]
 * @returns {Required<MyobLogger>}
 */
export function toLogger(logger?: MyobLogger): Required<MyobLogger>;
/**
 * Throw a `TypeError` naming the missing parameter.
 * @param {string} where - e.g. `"createMyobAuth"`.
 * @param {Record<string, any> | undefined} object
 * @param {string} name
 */
export function required(where: string, object: Record<string, any> | undefined, name: string): any;
/**
 * Like `required`, but falls back to an environment variable, and names it in the error.
 * @param {string} where
 * @param {Record<string, any> | undefined} object
 * @param {string} name
 * @param {string} envName
 * @returns {string}
 */
export function requiredOrEnv(where: string, object: Record<string, any> | undefined, name: string, envName: string): string;
/**
 * Warn (once per key) about option keys the SDK doesn't know, suggesting the closest valid one.
 * Without a compiler, this is how a JS caller finds out `timout` was a typo.
 *
 * @param {string} where
 * @param {object | undefined} options
 * @param {readonly string[]} allowed
 * @param {Required<MyobLogger>} logger
 */
export function checkOptions(where: string, options: object | undefined, allowed: readonly string[], logger: Required<MyobLogger>): void;

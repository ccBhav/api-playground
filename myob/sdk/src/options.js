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
const toLogger = (logger) => ({
  debug: (message, details) => logger?.debug?.(message, details),
  warn: (message, details) =>
    logger?.warn ? logger.warn(message, details) : process.emitWarning(message, "MyobSdkWarning"),
});

/**
 * Throw a `TypeError` naming the missing parameter.
 * @param {string} where - e.g. `"createMyobAuth"`.
 * @param {Record<string, any> | undefined} object
 * @param {string} name
 */
const required = (where, object, name) => {
  const value = object?.[name];
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${where}: \`${name}\` is required`);
  }
  return value;
};

/**
 * Like `required`, but falls back to an environment variable, and names it in the error.
 * @param {string} where
 * @param {Record<string, any> | undefined} object
 * @param {string} name
 * @param {string} envName
 * @returns {string}
 */
const requiredOrEnv = (where, object, name, envName) => {
  const value = object?.[name] ?? process.env[envName];
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${where}: \`${name}\` is required (pass it, or set ${envName})`);
  }
  return value;
};

/** @param {string} a @param {string} b */
const editDistance = (a, b) => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
};

const warnedKeys = new Set();

/**
 * Warn (once per key) about option keys the SDK doesn't know, suggesting the closest valid one.
 * Without a compiler, this is how a JS caller finds out `timout` was a typo.
 *
 * @param {string} where
 * @param {object | undefined} options
 * @param {readonly string[]} allowed
 * @param {Required<MyobLogger>} logger
 */
const checkOptions = (where, options, allowed, logger) => {
  for (const key of Object.keys(options ?? {})) {
    if (allowed.includes(key) || warnedKeys.has(`${where}:${key}`)) continue;
    warnedKeys.add(`${where}:${key}`);
    const [closest] = allowed
      .map((name) => ({ name, distance: editDistance(key.toLowerCase(), name.toLowerCase()) }))
      .filter(({ distance }) => distance <= Math.max(3, Math.floor(key.length / 3)))
      .sort((a, b) => a.distance - b.distance);
    logger.warn(`${where}: unknown option "${key}"${closest ? ` (did you mean "${closest.name}"?)` : ""}`);
  }
};

module.exports = { toLogger, required, requiredOrEnv, checkOptions };

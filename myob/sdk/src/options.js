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
 * The name in `allowed` closest to `key` (ignoring case), if any is close enough to be a typo.
 * @param {string} key
 * @param {readonly string[]} allowed
 * @param {number} [maxDistance]
 */
const closestName = (key, allowed, maxDistance = Math.max(3, Math.floor(key.length / 3))) =>
  allowed
    .map((name) => ({ name, distance: editDistance(key.toLowerCase(), name.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.name;

/**
 * Warn once per key, so a loop doesn't flood the logs.
 * @param {Required<MyobLogger>} logger
 * @param {string} id
 * @param {string} message
 */
const warnOnce = (logger, id, message) => {
  if (warnedKeys.has(id)) return;
  warnedKeys.add(id);
  logger.warn(message);
};

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
    if (allowed.includes(key)) continue;
    const closest = closestName(key, allowed);
    warnOnce(logger, `${where}:${key}`, `${where}: unknown option "${key}"${closest ? ` (did you mean "${closest}"?)` : ""}`);
  }
};

/**
 * A list query sends unknown keys to MYOB as-is (e.g. `StartDate`), and MYOB ignores ones it
 * doesn't know, so a typo like `fitler` would silently return every record. Warn (once per key)
 * when a key looks like a misspelt OData option, or is a request option in the wrong argument.
 *
 * @param {string} where
 * @param {Record<string, unknown> | undefined} query
 * @param {readonly string[]} queryKeys - The OData keys, e.g. `filter`.
 * @param {readonly string[]} requestKeys - Request option names, e.g. `timeoutMs`.
 * @param {Required<MyobLogger>} logger
 */
const checkQuery = (where, query, queryKeys, requestKeys, logger) => {
  for (const key of Object.keys(query ?? {})) {
    if (queryKeys.includes(key)) continue;
    if (requestKeys.includes(key)) {
      warnOnce(logger, `${where}:${key}`, `${where}: "${key}" is a request option, so it was sent to MYOB as a query parameter; pass it in the options argument instead`);
      continue;
    }
    const closest = closestName(key.replace(/^\$/, ""), queryKeys, 2);
    if (closest) {
      warnOnce(logger, `${where}:${key}`, `${where}: "${key}" isn't a query option the SDK knows, so it was sent to MYOB as-is (did you mean "${closest}"?)`);
    }
  }
};

module.exports = { toLogger, required, requiredOrEnv, checkOptions, checkQuery };

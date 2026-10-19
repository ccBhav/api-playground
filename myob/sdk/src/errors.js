/**
 * Everything the SDK throws (apart from `TypeError` for bad arguments) extends `MyobError`:
 *
 * ```
 * MyobError
 * ├── MyobConnectionError        no response: DNS, TLS, reset
 * │   └── MyobTimeoutError       no response within `timeoutMs`
 * ├── MyobAbortError             the caller's `signal` fired
 * ├── MyobAuthError              MYOB's OAuth server said no
 * └── MyobApiError               an AccountRight call got a non-2xx response
 *     ├── MyobBadRequestError          400
 *     ├── MyobAuthenticationError      401
 *     ├── MyobPermissionDeniedError    403
 *     ├── MyobNotFoundError            404
 *     ├── MyobConflictError            409, 412 (stale RowVersion)
 *     ├── MyobRateLimitError           429, or MYOB's 403 "over QPS"
 *     └── MyobInternalServerError      5xx
 * ```
 */
class MyobError extends Error {
  /**
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** No response from MYOB: DNS, TLS or a dropped connection. `cause` is the underlying error. */
class MyobConnectionError extends MyobError {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, method?: string, url?: string }} [details]
   */
  constructor(message, { cause, method, url } = {}) {
    super(message, { cause });
    this.method = method;
    this.url = url;
  }
}

/** MYOB didn't answer within `timeoutMs`. */
class MyobTimeoutError extends MyobConnectionError {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, method?: string, url?: string, timeoutMs?: number }} [details]
   */
  constructor(message, { timeoutMs, ...details } = {}) {
    super(message, details);
    this.timeoutMs = timeoutMs;
  }
}

/** The caller aborted the request through `signal`. `cause` is the signal's reason. */
class MyobAbortError extends MyobError {}

/**
 * Thrown when MYOB's OAuth server rejects a request, or redirects back with `?error=`.
 *
 * `code` is the OAuth error string when MYOB sends one (e.g. `invalid_grant` means the
 * refresh token is dead and the user has to reconnect). `state_mismatch` means the callback's
 * `state` didn't match `expectedState`, and `no_refresh_token` that the token expired with no
 * refresh token to renew it.
 *
 * Branch on `reconnectRequired` rather than on the class: a token request can also fail because
 * MYOB's OAuth server is down (`retryable`), and that is no reason to disconnect the company.
 */
class MyobAuthError extends MyobError {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {number} [details.status] - HTTP status, absent for redirect errors.
   * @param {string} [details.code] - OAuth `error` value.
   * @param {string} [details.description] - OAuth `error_description` value.
   * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
   */
  constructor(message, { status, code, description, body } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.description = description;
    this.body = body;
  }

  /** True when the stored tokens can never work again and the user has to connect to MYOB again. */
  get reconnectRequired() {
    return this.code === "invalid_grant" || this.code === "no_refresh_token";
  }

  /** True when MYOB's OAuth server failed (5xx) or rate-limited (429), so trying later may work. */
  get retryable() {
    return this.status === 429 || (this.status !== undefined && this.status >= 500);
  }
}

/**
 * One entry of MYOB's `Errors` array.
 * @typedef {Object} MyobErrorDetail
 * @property {string} [Name] - e.g. `"OAuthTokenIsInvalid"`.
 * @property {string} [Message]
 * @property {string} [AdditionalDetails]
 * @property {number | string} [ErrorCode]
 * @property {string} [Severity]
 */

/**
 * Thrown when an AccountRight API call returns a non-2xx response. Branch on the subclass
 * (`MyobNotFoundError`, `MyobConflictError`, ...) or on `status`.
 *
 * MYOB's error body looks like `{ Errors: [{ Name, Message, AdditionalDetails, ErrorCode, Severity }] }`;
 * those entries are exposed as `errors`, and the first `Name` as `code`.
 */
class MyobApiError extends MyobError {
  /**
   * @param {string} message
   * @param {Object} details
   * @param {number} details.status - HTTP status.
   * @param {string} details.method
   * @param {string} details.url
   * @param {MyobErrorDetail[]} [details.errors] - MYOB's `Errors` array, if sent.
   * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
   * @param {Headers} [details.headers] - Response headers.
   * @param {string} [details.code] - First `Errors[].Name`, if any.
   * @param {string} [details.requestId] - From the response headers, if MYOB sent one.
   * @param {number} [details.retryAfter] - Seconds, from `Retry-After`.
   * @param {boolean} [details.afterRetry] - The SDK resent the request after an attempt whose
   *   outcome is unknown (timeout, dropped connection, 5xx), so that attempt may have succeeded.
   */
  constructor(message, { status, method, url, errors = [], body, headers, code, requestId, retryAfter, afterRetry = false }) {
    super(message);
    this.status = status;
    this.method = method;
    this.url = url;
    this.errors = errors;
    this.body = body;
    this.headers = headers;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.afterRetry = afterRetry;
  }

  /**
   * True when sending the same request again may succeed (408, 429, rate limits, 5xx apart from
   * 501 Not Implemented). The SDK retries these itself for GET/PUT/DELETE, and for POST only on
   * rate limits.
   */
  get retryable() {
    return this.status === 408 || (this.status >= 500 && this.status !== 501);
  }
}

class MyobBadRequestError extends MyobApiError {}
class MyobAuthenticationError extends MyobApiError {}
class MyobPermissionDeniedError extends MyobApiError {}
class MyobNotFoundError extends MyobApiError {}
/** 409 or 412: usually a stale `RowVersion`. Re-read the record and apply the change again. */
class MyobConflictError extends MyobApiError {}
class MyobRateLimitError extends MyobApiError {
  get retryable() {
    return true;
  }
}
class MyobInternalServerError extends MyobApiError {}

// Header names MYOB's gateway may use for a request ID; none is documented, so try the usual ones.
const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "x-correlation-id", "x-mashery-message-id"];

/**
 * MYOB's gateway answers "too many requests" with 403 and an "over QPS/rate" message rather than
 * 429 (an observed gateway behaviour, not in MYOB's docs), so look for that too.
 * @param {number} status
 * @param {Headers} headers
 * @param {unknown} data
 */
const isRateLimited = (status, headers, data) => {
  if (status === 429) return true;
  if (status !== 403) return false;
  const text = `${headers.get("x-error-detail-header") ?? ""} ${typeof data === "string" ? data : JSON.stringify(data ?? "")}`;
  return /over\s*(qps|queries|rate)|rate\s*limit/i.test(text);
};

/**
 * `Retry-After` in seconds (it may be a number of seconds or an HTTP date), or undefined.
 * @param {Headers} headers
 */
const parseRetryAfter = (headers) => {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
};

/**
 * `url` without its query string, for error messages: `$filter` values can hold customer names
 * and other personal data that shouldn't end up in logs. The full URL stays on `error.url`.
 * @param {string} url
 */
const withoutQuery = (url) => url.split("?")[0];

/**
 * Build the right `MyobApiError` subclass for a failed response.
 * @param {{ method: string, url: string, status: number, statusText?: string, headers: Headers, data: unknown, afterRetry?: boolean }} response
 * @returns {MyobApiError}
 */
const apiErrorFromResponse = ({ method, url, status, statusText, headers, data, afterRetry = false }) => {
  const body = /** @type {any} */ (data);
  /** @type {MyobErrorDetail[]} */
  const errors = Array.isArray(body?.Errors) ? body.Errors : [];
  const summary = errors
    .map((e) => [e.Name, e.Message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  const code = errors.find((e) => e.Name)?.Name;
  const requestId = REQUEST_ID_HEADERS.map((name) => headers.get(name)).find(Boolean) ?? undefined;
  const detail = summary || (typeof data === "string" ? data.slice(0, 500) : "") || statusText || "";
  const message =
    `MYOB ${method} ${withoutQuery(url)} failed (${status}): ${detail}` +
    (requestId ? ` (request_id: ${requestId})` : "") +
    (afterRetry ? " (after a retry: an earlier attempt may have succeeded, so re-read before trying again)" : "");
  const details = { status, method, url, errors, body: data, headers, code, requestId, retryAfter: parseRetryAfter(headers), afterRetry };

  if (isRateLimited(status, headers, data)) return new MyobRateLimitError(message, details);
  if (status === 400) return new MyobBadRequestError(message, details);
  if (status === 401) return new MyobAuthenticationError(message, details);
  if (status === 403) return new MyobPermissionDeniedError(message, details);
  if (status === 404) return new MyobNotFoundError(message, details);
  if (status === 409 || status === 412) return new MyobConflictError(message, details);
  if (status >= 500) return new MyobInternalServerError(message, details);
  return new MyobApiError(message, details);
};

module.exports = {
  MyobError,
  MyobConnectionError,
  MyobTimeoutError,
  MyobAbortError,
  MyobAuthError,
  MyobApiError,
  MyobBadRequestError,
  MyobAuthenticationError,
  MyobPermissionDeniedError,
  MyobNotFoundError,
  MyobConflictError,
  MyobRateLimitError,
  MyobInternalServerError,
  apiErrorFromResponse,
  withoutQuery,
};

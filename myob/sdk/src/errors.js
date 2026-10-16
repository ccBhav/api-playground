/**
 * Thrown when MYOB's OAuth server rejects a request, or redirects back with `?error=`.
 *
 * `code` is the OAuth error string when MYOB sends one (e.g. `invalid_grant` means the
 * refresh token is dead and the user has to reconnect).
 */
class MyobAuthError extends Error {
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
    this.name = "MyobAuthError";
    this.status = status;
    this.code = code;
    this.description = description;
    this.body = body;
  }
}

/**
 * Thrown when an AccountRight API call returns a non-2xx response.
 *
 * MYOB's error body looks like `{ Errors: [{ Name, Message, AdditionalDetails, ErrorCode, Severity }] }`;
 * those entries are exposed as `errors`. A 401 with `Name: "OAuthTokenIsInvalid"` or a missing
 * company-file login are the usual auth problems; a 409/412 usually means a stale `RowVersion`.
 */
class MyobApiError extends Error {
  /**
   * @param {string} message
   * @param {Object} details
   * @param {number} details.status - HTTP status.
   * @param {string} details.method
   * @param {string} details.url
   * @param {Array<Record<string, unknown>>} [details.errors] - MYOB's `Errors` array, if sent.
   * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
   */
  constructor(message, { status, method, url, errors = [], body }) {
    super(message);
    this.name = "MyobApiError";
    this.status = status;
    this.method = method;
    this.url = url;
    this.errors = errors;
    this.body = body;
  }
}

module.exports = { MyobAuthError, MyobApiError };

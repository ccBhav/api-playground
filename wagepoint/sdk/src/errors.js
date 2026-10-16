/**
 * Thrown when Wagepoint's token endpoint rejects the client credentials.
 *
 * `code` is the OAuth error string when Wagepoint sends one (e.g. `invalid_client` means the
 * client ID or secret is wrong, `invalid_scope` that the scope isn't allowed for this client).
 */
class WagepointAuthError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {number} [details.status] - HTTP status.
   * @param {string} [details.code] - OAuth `error` value.
   * @param {string} [details.description] - OAuth `error_description` value.
   * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
   */
  constructor(message, { status, code, description, body } = {}) {
    super(message);
    this.name = "WagepointAuthError";
    this.status = status;
    this.code = code;
    this.description = description;
    this.body = body;
  }
}

/**
 * Thrown when a Wagepoint API call returns a non-2xx response.
 *
 * The quick start doesn't document the error body, so `body` is kept raw and `detail` is a best
 * guess at a readable message from it. `headers` is kept so you can log Wagepoint's correlation
 * headers when reporting a problem to them.
 */
class WagepointApiError extends Error {
  /**
   * @param {string} message
   * @param {Object} details
   * @param {number} details.status - HTTP status.
   * @param {string} details.method
   * @param {string} details.url
   * @param {string} [details.detail] - Readable summary pulled from the body, if any.
   * @param {Headers} [details.headers] - Response headers.
   * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
   */
  constructor(message, { status, method, url, detail, headers, body }) {
    super(message);
    this.name = "WagepointApiError";
    this.status = status;
    this.method = method;
    this.url = url;
    this.detail = detail;
    this.headers = headers;
    this.body = body;
  }
}

module.exports = { WagepointAuthError, WagepointApiError };

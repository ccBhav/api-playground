/**
 * One entry of MYOB's `Errors` array.
 */
export type MyobErrorDetail = {
    /**
     * - e.g. `"OAuthTokenIsInvalid"`.
     */
    Name?: string | undefined;
    Message?: string | undefined;
    AdditionalDetails?: string | undefined;
    ErrorCode?: string | number | undefined;
    Severity?: string | undefined;
};
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
export class MyobError extends Error {
    /**
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(message: string, options?: ErrorOptions);
}
/** No response from MYOB: DNS, TLS or a dropped connection. `cause` is the underlying error. */
export class MyobConnectionError extends MyobError {
    /**
     * @param {string} message
     * @param {{ cause?: unknown, method?: string, url?: string }} [details]
     */
    constructor(message: string, { cause, method, url }?: {
        cause?: unknown;
        method?: string;
        url?: string;
    });
    method: string | undefined;
    url: string | undefined;
}
/** MYOB didn't answer within `timeoutMs`. */
export class MyobTimeoutError extends MyobConnectionError {
    /**
     * @param {string} message
     * @param {{ cause?: unknown, method?: string, url?: string, timeoutMs?: number }} [details]
     */
    constructor(message: string, { timeoutMs, ...details }?: {
        cause?: unknown;
        method?: string;
        url?: string;
        timeoutMs?: number;
    });
    timeoutMs: number | undefined;
}
/** The caller aborted the request through `signal`. `cause` is the signal's reason. */
export class MyobAbortError extends MyobError {
}
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
export class MyobAuthError extends MyobError {
    /**
     * @param {string} message
     * @param {Object} [details]
     * @param {number} [details.status] - HTTP status, absent for redirect errors.
     * @param {string} [details.code] - OAuth `error` value.
     * @param {string} [details.description] - OAuth `error_description` value.
     * @param {unknown} [details.body] - Raw response body (parsed JSON when possible).
     */
    constructor(message: string, { status, code, description, body }?: {
        status?: number | undefined;
        code?: string | undefined;
        description?: string | undefined;
        body?: unknown;
    });
    status: number | undefined;
    code: string | undefined;
    description: string | undefined;
    body: unknown;
    /** True when the stored tokens can never work again and the user has to connect to MYOB again. */
    get reconnectRequired(): boolean;
    /** True when MYOB's OAuth server failed (5xx) or rate-limited (429), so trying later may work. */
    get retryable(): boolean;
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
export class MyobApiError extends MyobError {
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
    constructor(message: string, { status, method, url, errors, body, headers, code, requestId, retryAfter, afterRetry }: {
        status: number;
        method: string;
        url: string;
        errors?: MyobErrorDetail[] | undefined;
        body?: unknown;
        headers?: Headers | undefined;
        code?: string | undefined;
        requestId?: string | undefined;
        retryAfter?: number | undefined;
        afterRetry?: boolean | undefined;
    });
    status: number;
    method: string;
    url: string;
    errors: MyobErrorDetail[];
    body: unknown;
    headers: Headers | undefined;
    code: string | undefined;
    requestId: string | undefined;
    retryAfter: number | undefined;
    afterRetry: boolean;
    /**
     * True when sending the same request again may succeed (408, 429, rate limits, 5xx apart from
     * 501 Not Implemented). The SDK retries these itself for GET/PUT/DELETE, and for POST only on
     * rate limits.
     */
    get retryable(): boolean;
}
export class MyobBadRequestError extends MyobApiError {
}
export class MyobAuthenticationError extends MyobApiError {
}
export class MyobPermissionDeniedError extends MyobApiError {
}
export class MyobNotFoundError extends MyobApiError {
}
/** 409 or 412: usually a stale `RowVersion`. Re-read the record and apply the change again. */
export class MyobConflictError extends MyobApiError {
}
export class MyobRateLimitError extends MyobApiError {
}
export class MyobInternalServerError extends MyobApiError {
}
/**
 * Build the right `MyobApiError` subclass for a failed response.
 * @param {{ method: string, url: string, status: number, statusText?: string, headers: Headers, data: unknown, afterRetry?: boolean }} response
 * @returns {MyobApiError}
 */
export function apiErrorFromResponse({ method, url, status, statusText, headers, data, afterRetry }: {
    method: string;
    url: string;
    status: number;
    statusText?: string;
    headers: Headers;
    data: unknown;
    afterRetry?: boolean;
}): MyobApiError;
/**
 * `url` without its query string, for error messages: `$filter` values can hold customer names
 * and other personal data that shouldn't end up in logs. The full URL stays on `error.url`.
 * @param {string} url
 */
export function withoutQuery(url: string): string;

const { API_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, RESOURCES } = require("./constants");
const { parseBody } = require("./body");
const {
  MyobAuthenticationError,
  MyobConnectionError,
  MyobNotFoundError,
  MyobRateLimitError,
  apiErrorFromResponse,
} = require("./errors");
const { checkOptions, required, toLogger } = require("./options");
const { toRateLimiter } = require("./rateLimiter");
const { RESOURCE_PATHS } = require("./resources");
const { USER_AGENT, fetchWithTimeout, retryDelayMs, sleep, userAgentFor } = require("./transport");

/** @typedef {import("./auth").MyobAuth} MyobAuth */
/** @typedef {import("./auth").MyobConnection} MyobConnection */
/** @typedef {import("./options").MyobLogger} MyobLogger */
/** @typedef {import("./tokens").MyobTokens} MyobTokens */
/** @typedef {import("./rateLimiter").RateLimitSetting} RateLimitSetting */
/** @typedef {import("./errors").MyobError} MyobError */
/** @typedef {import("./models").Timesheet} Timesheet */
/** @typedef {import("./models").Company} Company */
/** @typedef {import("./resources").MyobResources} MyobResources */

/**
 * A MYOB record. Fields are MYOB's PascalCase names; see the AccountRight API reference.
 * @typedef {{ UID?: string, RowVersion?: string, [field: string]: unknown }} MyobRecord
 */

/**
 * A company file from `listCompanyFiles()`.
 * @typedef {{ Id: string, Name?: string, Uri?: string, [field: string]: unknown }} MyobCompanyFile
 */

/**
 * OData options are camelCase here and sent as `$top`, `$skip`, `$filter` and `$orderby`.
 * Any other key is sent as-is (e.g. `StartDate` for timesheets).
 * MYOB allows `top` up to 1000 and defaults to 400.
 *
 * @typedef {Object} ListQuery
 * @property {number} [top]
 * @property {number} [skip]
 * @property {string} [filter] - e.g. `"LastName eq 'Smith'"`.
 * @property {string} [orderBy] - e.g. `"LastModified desc"`.
 */

/**
 * Passed to `hooks.onRequest` before each attempt; the same `state` object reaches `onResponse`
 * or `onError` for that attempt, so a tracing span can be stored on it.
 *
 * @typedef {Object} RequestContext
 * @property {string} method
 * @property {string} url
 * @property {number} attempt - 1 for the first try, 2 for the first retry, and so on.
 * @property {Record<string, unknown>} state - Yours to use.
 * @property {(name: string, value: string) => void} setHeader - Add a request header, e.g. `traceparent`.
 */

/**
 * @typedef {RequestContext & { status: number, headers: Headers, durationMs: number }} ResponseContext
 */

/**
 * No response: connection error, timeout or abort.
 * @typedef {RequestContext & { error: MyobError, durationMs: number }} ErrorContext
 */

/**
 * Observability hooks, called for every attempt (retries included). Their return values are
 * ignored, and an exception in one is logged as a warning instead of failing the request.
 *
 * @typedef {Object} MyobHooks
 * @property {(context: RequestContext) => unknown} [onRequest]
 * @property {(context: ResponseContext) => unknown} [onResponse] - Any HTTP response, error statuses included.
 * @property {(context: ErrorContext) => unknown} [onError]
 */

/**
 * Per-request overrides; the last argument of every client method.
 * @typedef {Object} RequestOptions
 * @property {number} [timeoutMs] - Per attempt. Defaults to the client's `timeoutMs`.
 * @property {number} [maxRetries] - Defaults to the client's `maxRetries`.
 * @property {AbortSignal} [signal] - Cancels the request, including any wait between retries.
 * @property {Record<string, string>} [headers] - Extra headers for this request.
 * @property {(response: ResponseContext) => unknown} [onResponse] - Receives the raw response
 *   (status, headers, timing) that the call returns or throws on; once per page for `iterate`/`all`.
 */

/** @typedef {RequestOptions & { returnBody?: boolean }} WriteOptions */

/**
 * @typedef {Object} RawResponse
 * @property {number} status
 * @property {Headers} headers
 */

/**
 * @template [T=MyobRecord]
 * @typedef {Object} Page
 * @property {T[]} items
 * @property {number | undefined} count - Total matching records, when MYOB sends it.
 * @property {string | null} nextPageLink - Absolute URL of the next page, or null on the last one.
 * @property {RawResponse} response
 */

/**
 * @template [T=MyobRecord]
 * @typedef {Object} CreateResult
 * @property {string | undefined} uid - Taken from MYOB's `Location` header.
 * @property {string | undefined} location
 * @property {T | undefined} data - The created record when `returnBody` was set.
 */

/**
 * One collection, e.g. `api.employees`.
 * @template [T=MyobRecord]
 * @typedef {Object} Resource
 * @property {string} path - Relative to the company file, e.g. `"Contact/Employee"`.
 * @property {(query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<Page<T>>} list
 * @property {(query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => AsyncGenerator<T, void, undefined>} iterate
 * @property {(query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<T[]>} all
 * @property {(uid: string, options?: RequestOptions) => Promise<T>} retrieve
 * @property {(body: Partial<T>, options?: WriteOptions) => Promise<CreateResult<T>>} create
 * @property {(uid: string, body: Partial<T>, options?: WriteOptions) => Promise<T | undefined>} update
 * @property {(uid: string, options?: RequestOptions) => Promise<void>} delete
 */

/**
 * A timesheet period. Sent as `StartDate` and `EndDate`, in the format MYOB documents
 * (e.g. `"2026-10-12T00:00:00"`).
 * @typedef {Object} TimesheetPeriod
 * @property {string} startDate
 * @property {string} endDate
 */

/**
 * `api.timesheets`. MYOB addresses a timesheet by employee UID and period rather than by its own UID.
 * @typedef {Object} TimesheetsResource
 * @property {string} path
 * @property {(query: TimesheetPeriod & ListQuery, options?: RequestOptions) => Promise<Page<Timesheet>>} list
 * @property {(query: TimesheetPeriod & ListQuery, options?: RequestOptions) => AsyncGenerator<Timesheet, void, undefined>} iterate
 * @property {(query: TimesheetPeriod & ListQuery, options?: RequestOptions) => Promise<Timesheet[]>} all
 * @property {(employeeUid: string, period: TimesheetPeriod, options?: RequestOptions) => Promise<Timesheet>} retrieve
 * @property {(employeeUid: string, timesheet: Timesheet, options?: WriteOptions) => Promise<Timesheet | undefined>} update -
 *   Replaces the employee's timesheet for the period in `timesheet.StartDate`/`EndDate`.
 */

/**
 * Pass either `connection`, or `auth` plus `tokens` (the client then calls `auth.connect` itself).
 *
 * @typedef {Object} MyobClientConfig
 * @property {MyobConnection} [connection] - From `createMyobAuth(...).connect(...)`.
 * @property {MyobAuth} [auth] - From `createMyobAuth(...)`; use with `tokens`.
 * @property {Partial<MyobTokens> & { businessId?: string }} [tokens] - Stored tokens; their
 *   `businessId` is used when `businessId` isn't given.
 * @property {(tokens: MyobTokens) => unknown} [onRefresh] - With `auth`: persist refreshed tokens.
 * @property {number} [skewSeconds] - With `auth`: see `connect`.
 * @property {import("./auth").ConnectOptions["loadTokens"]} [loadTokens] - With `auth`: see `connect`.
 * @property {import("./auth").ConnectOptions["withRefreshLock"]} [withRefreshLock] - With `auth`: see `connect`.
 * @property {string} [businessId] - The company file. Needed for everything except `listCompanyFiles`.
 * @property {{ username: string, password?: string }} [companyFileCredentials] - Only for company
 *   files that ask for their own login; sent as `x-myobapi-cftoken`.
 * @property {string} [baseUrl] - Defaults to `API_BASE_URL`.
 * @property {number} [timeoutMs] - Per attempt. Defaults to 60000.
 * @property {number} [maxRetries] - Defaults to 2.
 * @property {RateLimitSetting} [rateLimit] - Defaults to the connection's shared limiter (8
 *   requests a second per API key, set on `createMyobAuth`). `false` turns pacing off.
 * @property {MyobHooks} [hooks]
 * @property {string} [appName] - Appended to the `User-Agent`. Defaults to the auth's `appName`.
 * @property {MyobLogger} [logger]
 * @property {typeof fetch} [fetch] - Custom `fetch` for proxies, tracing or tests.
 */

const CONFIG_KEYS = [
  "connection", "auth", "tokens", "onRefresh", "skewSeconds", "loadTokens", "withRefreshLock",
  "businessId", "companyFileCredentials", "baseUrl", "timeoutMs", "maxRetries", "rateLimit",
  "hooks", "appName", "logger", "fetch",
];
const REQUEST_KEYS = ["timeoutMs", "maxRetries", "signal", "headers", "onResponse"];
const ODATA_KEYS = /** @type {Record<string, string>} */ ({
  top: "$top",
  skip: "$skip",
  filter: "$filter",
  orderBy: "$orderby",
});
// Methods that are safe to resend after a lost response. MYOB has no idempotency keys, so POST
// is only retried when the gateway rate-limited it, which means MYOB never processed it.
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

/**
 * `x-myobapi-cftoken` value: Base64 of `username:password` for the company file.
 * @param {{ username: string, password?: string }} credentials
 */
const encodeCfToken = ({ username, password = "" }) =>
  Buffer.from(`${username}:${password}`).toString("base64");

/**
 * Build the query string by hand: URLSearchParams would turn `$top` into `%24top` and spaces in
 * `$filter` into `+`, which is not what MYOB's docs show.
 * @param {Record<string, unknown>} [query]
 */
const toQueryString = (query = {}) =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${ODATA_KEYS[key] ?? encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");

/** A 401 that a fresh access token could fix, as opposed to e.g. bad company-file credentials. */
const isStaleTokenError = (/** @type {import("./errors").MyobApiError} */ error) =>
  error.errors.length === 0 || error.errors.some((e) => /oauth|token/i.test(String(e.Name ?? "")));

/**
 * @param {string} where
 * @param {Partial<TimesheetPeriod> | undefined} period
 */
const periodQuery = (where, period) => {
  for (const name of /** @type {const} */ (["startDate", "endDate"])) {
    if (typeof period?.[name] !== "string" || !period[name]) {
      throw new TypeError(`${where}: \`${name}\` is required`);
    }
  }
  return { StartDate: period?.startDate, EndDate: period?.endDate };
};

/**
 * @param {MyobClientConfig} config
 * @returns {MyobConnection}
 */
const resolveConnection = (config) => {
  if (config.connection) return config.connection;
  if (config.auth) {
    return config.auth.connect({
      tokens: required("createMyobClient", config, "tokens"),
      onRefresh: config.onRefresh,
      skewSeconds: config.skewSeconds,
      loadTokens: config.loadTokens,
      withRefreshLock: config.withRefreshLock,
    });
  }
  throw new TypeError(
    "createMyobClient: `connection` (from myob.connect()) or `auth` plus `tokens` is required",
  );
};

/**
 * Client for one company file. Every call gets fresh headers from the connection, so tokens are
 * refreshed automatically. Requests are paced, time out, and failures that are safe to retry are
 * retried with backoff; a 401 for a stale token triggers one refresh and a retry.
 *
 * @param {MyobClientConfig} config
 */
const createMyobClient = (config) => {
  const logger = toLogger(config?.logger);
  checkOptions("createMyobClient", config, CONFIG_KEYS, logger);
  const connection = resolveConnection(config ?? {});
  const businessId = config.businessId ?? config.tokens?.businessId;
  const baseUrl = (config.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const baseOrigin = new URL(baseUrl).origin;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const rateLimiter = toRateLimiter(config.rateLimit, connection.rateLimiter);
  const hooks = config.hooks ?? {};
  const userAgent = config.appName ? userAgentFor(config.appName) : (connection.userAgent ?? USER_AGENT);
  const cfToken = config.companyFileCredentials
    ? encodeCfToken(config.companyFileCredentials)
    : undefined;
  const warnedDeprecations = new Set();

  // Absolute URLs (NextPageLink, Location, a company file's Uri) are followed only to the
  // configured base URL's origin or to MYOB's https hosts, so the bearer token goes nowhere else.
  /** @param {URL} url */
  const isTrustedUrl = (url) =>
    url.origin === baseOrigin ||
    (url.protocol === "https:" && (url.hostname === "myob.com" || url.hostname.endsWith(".myob.com")));

  /**
   * @param {string} path
   * @param {Record<string, unknown>} [query]
   */
  const resolveUrl = (path, query) => {
    if (typeof path !== "string" || !path) {
      throw new TypeError("createMyobClient: `path` must be a non-empty string");
    }
    let url;
    if (/^https?:\/\//i.test(path)) {
      url = new URL(path);
      if (!isTrustedUrl(url)) {
        throw new TypeError(`Refusing to send MYOB credentials to ${url.origin}`);
      }
    } else {
      if (!businessId) {
        throw new TypeError("createMyobClient: `businessId` is required for company-file calls");
      }
      url = new URL(`${baseUrl}/${encodeURIComponent(businessId)}/${path.replace(/^\/+/, "")}`);
    }
    const extra = toQueryString(query);
    if (extra) url.search = url.search ? `${url.search}&${extra}` : `?${extra}`;
    return url.toString();
  };

  /**
   * @param {string} where
   * @param {string} path
   * @param {string} uid
   */
  const recordPath = (where, path, uid) => {
    if (typeof uid !== "string" || !uid) {
      throw new TypeError(`${where}: \`uid\` must be a non-empty string`);
    }
    return `${path.replace(/\/+$/, "")}/${encodeURIComponent(uid)}`;
  };

  /**
   * Surface MYOB's `Deprecation` / `Sunset` headers (once per endpoint) before the endpoint goes.
   * @param {string} method
   * @param {string} url
   * @param {Headers} headers
   */
  const warnIfDeprecated = (method, url, headers) => {
    const deprecation = headers.get("deprecation");
    const sunset = headers.get("sunset");
    if (!deprecation && !sunset) return;
    const endpoint = `${method} ${new URL(url).pathname}`;
    if (warnedDeprecations.has(endpoint)) return;
    warnedDeprecations.add(endpoint);
    logger.warn(`MYOB marks ${endpoint} as deprecated`, { deprecation, sunset });
  };

  /**
   * Call a hook without letting it break the request.
   * @param {string} name
   * @param {((context: any) => unknown) | undefined} hook
   * @param {object} context
   */
  const callHook = (name, hook, context) => {
    if (!hook) return;
    /** @param {unknown} error */
    const warn = (error) =>
      logger.warn(`MYOB ${name} hook threw: ${/** @type {any} */ (error)?.message ?? error}`);
    try {
      const result = /** @type {any} */ (hook(context));
      if (typeof result?.catch === "function") result.catch(warn);
    } catch (error) {
      warn(error);
    }
  };

  /**
   * Send any request. Most code wants the helpers below; use this for anything they don't cover.
   *
   * @template [T=unknown]
   * @param {string} method
   * @param {string} path - Relative to the company file, or an absolute MYOB URL.
   * @param {{ query?: Record<string, unknown>, body?: unknown } & RequestOptions} [options]
   * @returns {Promise<RawResponse & { data: T }>}
   */
  const request = async (method, path, options = {}) => {
    const { query, body, ...requestOptions } = options;
    checkOptions("request options", requestOptions, REQUEST_KEYS, logger);
    const { signal, headers: extraHeaders, onResponse } = requestOptions;
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
    const maxRetries = requestOptions.maxRetries ?? defaultMaxRetries;
    const url = resolveUrl(path, query);
    let retries = 0;
    let refreshedToken = false;
    // Set once an attempt failed in a way that MYOB may still have applied it (timeout, dropped
    // connection, 408, 5xx). A resend can then fail only because the first one worked.
    let outcomeUnknown = false;

    for (let attempt = 1; ; attempt++) {
      await rateLimiter?.acquire(signal);
      const authHeaders = await connection.headers();
      /** @type {Record<string, string>} */
      const headers = { ...authHeaders, "User-Agent": userAgent, ...extraHeaders };
      if (cfToken) headers["x-myobapi-cftoken"] = cfToken;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      /** @type {RequestContext} */
      const context = {
        method,
        url,
        attempt,
        state: {},
        setHeader: (name, value) => {
          headers[name] = value;
        },
      };
      callHook("onRequest", hooks.onRequest, context);

      const started = Date.now();
      let result;
      try {
        result = await fetchWithTimeout(
          fetchImpl,
          url,
          { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
          { timeoutMs, signal },
        );
      } catch (error) {
        callHook("onError", hooks.onError, { ...context, error, durationMs: Date.now() - started });
        const canRetry =
          error instanceof MyobConnectionError && IDEMPOTENT_METHODS.has(method) && retries < maxRetries;
        if (!canRetry) throw error;
        outcomeUnknown = true;
        const delay = retryDelayMs(retries++);
        logger.debug("MYOB request failed, retrying", { method, url, error: error.message, delayMs: delay });
        await sleep(delay, signal);
        continue;
      }

      const { response, text } = result;
      /** @type {ResponseContext} */
      const responseContext = {
        ...context,
        status: response.status,
        headers: response.headers,
        durationMs: Date.now() - started,
      };
      logger.debug("MYOB request", { method, url, status: response.status, ms: responseContext.durationMs });
      callHook("onResponse", hooks.onResponse, responseContext);
      warnIfDeprecated(method, url, response.headers);
      const data = text ? parseBody(text) : undefined;
      if (response.ok) {
        callHook("onResponse", onResponse, responseContext);
        return { status: response.status, headers: response.headers, data };
      }

      const error = apiErrorFromResponse({
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data,
        afterRetry: outcomeUnknown,
      });

      // The earlier attempt deleted the record; the caller asked for it gone, and it is.
      if (method === "DELETE" && outcomeUnknown && error instanceof MyobNotFoundError) {
        logger.debug("MYOB DELETE got 404 after a retry; treating it as deleted", { url });
        callHook("onResponse", onResponse, responseContext);
        return { status: response.status, headers: response.headers, data: /** @type {T} */ (undefined) };
      }

      if (
        error instanceof MyobAuthenticationError &&
        !refreshedToken &&
        connection.forceRefresh &&
        isStaleTokenError(error)
      ) {
        refreshedToken = true;
        logger.debug("MYOB rejected the access token, refreshing", { method, url });
        await connection.forceRefresh(authHeaders.Authorization?.replace(/^Bearer /, ""));
        continue;
      }

      const canRetry =
        error.retryable &&
        retries < maxRetries &&
        (IDEMPOTENT_METHODS.has(method) || error instanceof MyobRateLimitError);
      if (!canRetry) {
        callHook("onResponse", onResponse, responseContext);
        throw error;
      }
      // A rate-limited request was never processed; a 408 or 5xx may have been.
      if (!(error instanceof MyobRateLimitError)) outcomeUnknown = true;
      const delay = retryDelayMs(retries++, error.retryAfter);
      logger.debug("MYOB request failed, retrying", { method, url, status: error.status, delayMs: delay });
      await sleep(delay, signal);
    }
  };

  /**
   * GET a resource and return its body as-is.
   * @template [T=unknown]
   * @param {string} path
   * @param {Record<string, unknown>} [query]
   * @param {RequestOptions} [options]
   * @returns {Promise<T>}
   */
  const get = async (path, query, options) => {
    /** @type {RawResponse & { data: T }} */
    const response = await request("GET", path, { ...options, query });
    return response.data;
  };

  /**
   * Company files this login can see. Doesn't need `businessId`.
   * @param {RequestOptions} [options]
   * @returns {Promise<MyobCompanyFile[]>}
   */
  const listCompanyFiles = (options) => get(`${baseUrl}/`, undefined, options);

  /**
   * One page of a collection.
   * @template [T=MyobRecord]
   * @param {string} path - e.g. `RESOURCES.CUSTOMERS`, or a `nextPageLink`.
   * @param {ListQuery & Record<string, unknown>} [query]
   * @param {RequestOptions} [options]
   * @returns {Promise<Page<T>>}
   */
  const list = async (path, query, options) => {
    /** @type {RawResponse & { data: any }} */
    const { status, headers, data } = await request("GET", path, { ...options, query });
    return {
      items: data?.Items ?? [],
      count: data?.Count,
      nextPageLink: data?.NextPageLink ?? null,
      response: { status, headers },
    };
  };

  /**
   * Every record in a collection, page by page, following `NextPageLink`.
   * `top` sets the page size, not a total limit; break out of the loop to stop early.
   * @template [T=MyobRecord]
   * @param {string} path
   * @param {ListQuery & Record<string, unknown>} [query]
   * @param {RequestOptions} [options]
   * @returns {AsyncGenerator<T, void, undefined>}
   */
  async function* iterate(path, query, options) {
    /** @type {Page<T>} */
    let page = await list(path, query, options);
    yield* page.items;
    while (page.nextPageLink) {
      page = await list(page.nextPageLink, undefined, options);
      yield* page.items;
    }
  }

  /**
   * Every record in a collection, as an array. Prefer `iterate` for big collections.
   * @template [T=MyobRecord]
   * @param {string} path
   * @param {ListQuery & Record<string, unknown>} [query]
   * @param {RequestOptions} [options]
   * @returns {Promise<T[]>}
   */
  const all = async (path, query, options) => {
    /** @type {T[]} */
    const items = [];
    for await (const item of iterate(path, query, options)) items.push(/** @type {T} */ (item));
    return items;
  };

  /**
   * One record by UID.
   * @template [T=MyobRecord]
   * @param {string} path
   * @param {string} uid
   * @param {RequestOptions} [options]
   * @returns {Promise<T>}
   */
  const retrieve = async (path, uid, options) =>
    get(recordPath("retrieve", path, uid), undefined, options);

  /**
   * Create a record. MYOB answers 201 with the new record's URL in `Location`.
   * Pass `{ returnBody: true }` to also get the created record back in `data`.
   * @template [T=MyobRecord]
   * @param {string} path
   * @param {Partial<T>} body
   * @param {WriteOptions} [options]
   * @returns {Promise<CreateResult<T>>}
   */
  const create = async (path, body, { returnBody, ...options } = {}) => {
    if (typeof body !== "object" || body === null) {
      throw new TypeError("create: `body` must be an object");
    }
    /** @type {RawResponse & { data: T | undefined }} */
    const response = await request("POST", path, {
      ...options,
      body,
      query: returnBody ? { returnBody: true } : undefined,
    });
    const location = response.headers.get("location") ?? undefined;
    return {
      uid: location?.replace(/\/+$/, "").split("/").pop(),
      location,
      data: response.data,
    };
  };

  /**
   * Replace a record. `body` must include the `UID` and the current `RowVersion`; MYOB rejects the
   * update with `MyobConflictError` if someone changed the record since you read it.
   * @template [T=MyobRecord]
   * @param {string} path
   * @param {string} uid
   * @param {Partial<T>} body
   * @param {WriteOptions} [options]
   * @returns {Promise<T | undefined>} The updated record when `returnBody` is set.
   */
  const update = async (path, uid, body, { returnBody, ...options } = {}) => {
    if (typeof body !== "object" || body === null) {
      throw new TypeError("update: `body` must be an object");
    }
    /** @type {RawResponse & { data: T | undefined }} */
    const response = await request("PUT", recordPath("update", path, uid), {
      ...options,
      body,
      query: returnBody ? { returnBody: true } : undefined,
    });
    return response.data;
  };

  /**
   * Delete a record.
   * @param {string} path
   * @param {string} uid
   * @param {RequestOptions} [options]
   * @returns {Promise<void>}
   */
  const remove = async (path, uid, options) => {
    await request("DELETE", recordPath("delete", path, uid), options);
  };

  /**
   * @template T
   * @param {string} path
   * @returns {Resource<T>}
   */
  const resource = (path) => ({
    path,
    list: (query, options) => list(path, query, options),
    iterate: (query, options) => iterate(path, query, options),
    all: (query, options) => all(path, query, options),
    retrieve: (uid, options) => retrieve(path, uid, options),
    create: (body, options) => create(path, body, options),
    update: (uid, body, options) => update(path, uid, body, options),
    delete: (uid, options) => remove(path, uid, options),
  });

  const resources = /** @type {MyobResources} */ (
    Object.fromEntries(Object.entries(RESOURCE_PATHS).map(([name, path]) => [name, resource(path)]))
  );

  /** @type {TimesheetsResource} */
  const timesheets = {
    path: RESOURCES.TIMESHEETS,
    list: async ({ startDate, endDate, ...query } = /** @type {any} */ ({}), options) =>
      list(RESOURCES.TIMESHEETS, { ...query, ...periodQuery("timesheets.list", { startDate, endDate }) }, options),
    iterate: ({ startDate, endDate, ...query } = /** @type {any} */ ({}), options) =>
      iterate(RESOURCES.TIMESHEETS, { ...query, ...periodQuery("timesheets.iterate", { startDate, endDate }) }, options),
    all: async ({ startDate, endDate, ...query } = /** @type {any} */ ({}), options) =>
      all(RESOURCES.TIMESHEETS, { ...query, ...periodQuery("timesheets.all", { startDate, endDate }) }, options),
    retrieve: async (employeeUid, period, options) =>
      get(
        recordPath("timesheets.retrieve", RESOURCES.TIMESHEETS, employeeUid),
        periodQuery("timesheets.retrieve", period),
        options,
      ),
    update: async (employeeUid, timesheet, options) =>
      update(RESOURCES.TIMESHEETS, employeeUid, timesheet, options),
  };

  const company = {
    /**
     * The company file's details.
     * @param {RequestOptions} [options]
     * @returns {Promise<Company>}
     */
    retrieve: (options) => get(RESOURCES.COMPANY, undefined, options),
  };

  return {
    businessId,
    connection,
    ...resources,
    timesheets,
    company,
    request,
    get,
    listCompanyFiles,
    list,
    iterate,
    all,
    retrieve,
    create,
    update,
    delete: remove,
  };
};

module.exports = { createMyobClient, encodeCfToken };

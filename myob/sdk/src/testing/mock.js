const { API_BASE_URL, API_VERSION, RESOURCES } = require("../constants");
const { createMyobClient } = require("../client");
const { RESOURCE_PATHS } = require("../resources");
const { createFactories } = require("./factories");

/** @typedef {import("./factories").MyobFactories} MyobFactories */
/** @typedef {import("../client").MyobClientConfig} MyobClientConfig */
/** @typedef {ReturnType<typeof createMyobClient>} MyobClient */

/**
 * A request the mock received, parsed.
 * @typedef {Object} MockRequest
 * @property {string} operation - e.g. `"employees.list"`, or `"GET Sale/Order/Item"` for a route
 *   added with `onRequest`.
 * @property {string} method
 * @property {string} url
 * @property {{ uid?: string }} params - `uid` is the record UID (the employee UID for timesheets).
 * @property {Record<string, string>} query - Decoded, with OData keys as sent (`$top`, `$filter`).
 * @property {any} body - Parsed JSON body, if any.
 * @property {Record<string, string>} headers
 */

/**
 * @typedef {Object} MockResponse
 * @property {number} status
 * @property {unknown} [body]
 * @property {Record<string, string>} [headers]
 */

/**
 * @typedef {Object} MockErrorBody
 * @property {string} [name] - MYOB's `Errors[].Name`, e.g. `"ResourceNotFound"`.
 * @property {string} [message]
 * @property {string} [requestId] - Sent as `x-request-id`.
 */

/**
 * @typedef {Object} MockHandlers
 * @property {(status: number, body?: unknown | ((request: MockRequest) => unknown), headers?: Record<string, string>) => MockHandlers} reply
 *   Answer every matching request (the latest `reply` wins).
 * @property {(status: number, body?: unknown | ((request: MockRequest) => unknown), headers?: Record<string, string>) => MockHandlers} replyOnce
 *   Answer the next matching request only. Queued `replyOnce`s run in order before any `reply`.
 * @property {(status: number, error?: MockErrorBody, options?: { once?: boolean }) => MockHandlers} replyError
 *   An error in MYOB's `{ Errors: [...] }` shape, so the SDK throws its real error class.
 * @property {(pages: unknown[][]) => MockHandlers} replyPages - Successive pages linked by
 *   `NextPageLink`, so `iterate`/`all` page for real. Each page answers once.
 * @property {(options?: { once?: boolean }) => MockHandlers} networkError - `MyobConnectionError`.
 * @property {(options?: { once?: boolean }) => MockHandlers} timeout - `MyobTimeoutError`.
 */

/**
 * @typedef {Object} MyobMock
 * @property {readonly string[]} operations - Every operation name `on` accepts.
 * @property {(operation: string) => MockHandlers} on
 * @property {(method: string, path: string) => MockHandlers} onRequest - Handle a path the typed
 *   operations don't cover, as called through the generic methods (`api.get("Sale/Order/Item")`).
 *   `path` is relative to the company file and matched exactly, without the query string. Its
 *   calls are recorded under the operation `"<METHOD> <path>"`. Checked before the typed operations.
 * @property {(operation?: string) => MockRequest[]} calls - Requests received, in order.
 * @property {() => string[]} pending - Operations with handlers that were set up but never used;
 *   usually a sign of a broken test.
 * @property {() => void} reset - Drop all handlers, `onRequest` routes and recorded calls.
 */

/**
 * @typedef {Object} CreateMockMyobOptions
 * @property {number} [seed] - Seed for `fake`; the same seed gives the same records. Defaults to 1.
 * @property {string} [businessId]
 * @property {Omit<MyobClientConfig, "connection" | "auth" | "tokens" | "fetch" | "businessId">} [client] -
 *   Extra client options. Retries and rate limiting are off unless set here.
 */

/**
 * @typedef {{ name: string, method: string, path: string | null, kind: "root" | "collection" | "record", resource: string }} Operation
 */

const MOCK_ACCESS_TOKEN = "mock-access-token";

/** @type {Operation[]} */
const OPERATIONS = [
  { name: "companyFiles.list", method: "GET", path: null, kind: "root", resource: "companyFiles" },
  { name: "company.retrieve", method: "GET", path: RESOURCES.COMPANY, kind: "collection", resource: "company" },
  ...Object.entries({ ...RESOURCE_PATHS }).flatMap(([resource, path]) =>
    /** @type {const} */ ([
      ["list", "GET", "collection"],
      ["create", "POST", "collection"],
      ["retrieve", "GET", "record"],
      ["update", "PUT", "record"],
      ["delete", "DELETE", "record"],
    ]).map(([verb, method, kind]) => ({ name: `${resource}.${verb}`, method, path, kind, resource })),
  ),
  { name: "timesheets.list", method: "GET", path: RESOURCES.TIMESHEETS, kind: "collection", resource: "timesheets" },
  { name: "timesheets.retrieve", method: "GET", path: RESOURCES.TIMESHEETS, kind: "record", resource: "timesheets" },
  { name: "timesheets.update", method: "PUT", path: RESOURCES.TIMESHEETS, kind: "record", resource: "timesheets" },
];
const OPERATION_NAMES = Object.freeze(OPERATIONS.map((operation) => operation.name));

/** @type {Record<number, string>} */
const ERROR_NAMES = {
  400: "ValidationError",
  401: "OAuthTokenIsInvalid",
  403: "AccessDenied",
  404: "ResourceNotFound",
  409: "RowVersionMismatch",
  412: "RowVersionMismatch",
  429: "RateLimitExceeded",
  500: "InternalError",
};

/**
 * A real `createMyobClient` over a fake `fetch`, for unit-testing code that uses the SDK without
 * calling MYOB. URL building, response parsing, paging and error classes all run for real; the
 * mock only decides which response comes back. Unhandled operations get a realistic default
 * response from `fake`. A request that matches no operation never reaches the network: it gets a
 * 501, which the client throws as a (non-retried) `MyobInternalServerError` naming the request.
 *
 * @param {CreateMockMyobOptions} [options]
 * @returns {{ client: MyobClient, mock: MyobMock, fake: MyobFactories }}
 */
const createMockMyob = ({ seed = 1, businessId = "00000000-0000-4000-8000-000000000001", client: clientOptions = {} } = {}) => {
  const fake = createFactories({ seed });
  const baseUrl = (clientOptions.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const companyPath = `${basePath}/${encodeURIComponent(businessId)}/`;

  /** @typedef {{ respond: (request: MockRequest) => MockResponse, once: boolean, used: boolean }} Handler */
  /** @type {Map<string, Handler[]>} */
  let handlers = new Map();
  /** @type {MockRequest[]} */
  let received = [];
  /** @type {Map<string, { method: string, path: string }>} */
  let routes = new Map();

  /** @type {Record<string, (overrides?: any) => any>} */
  const factories = {
    contacts: fake.customer,
    customers: fake.customer,
    suppliers: fake.supplier,
    employees: fake.employee,
    jobs: fake.job,
    accounts: fake.account,
    taxCodes: fake.taxCode,
    items: fake.item,
    activities: fake.activity,
    payrollCategories: fake.payrollCategory,
    timesheets: fake.timesheet,
  };
  const factoryFor = (/** @type {string} */ resource) => factories[resource] ?? fake.record;

  /**
   * @param {string} method
   * @param {URL} url
   * @returns {{ operation: Operation, params: { uid?: string } } | undefined}
   */
  const match = (method, url) => {
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname === basePath) {
      const operation = OPERATIONS.find((o) => o.kind === "root" && o.method === method);
      return operation && { operation, params: {} };
    }
    if (!url.pathname.startsWith(companyPath)) return undefined;
    const rest = decodeURIComponent(pathname.slice(companyPath.length));
    const routeName = `${method} ${rest}`;
    if (routes.has(routeName)) {
      return { operation: { name: routeName, method, path: rest, kind: "collection", resource: "custom" }, params: {} };
    }
    const exact = OPERATIONS.find((o) => o.kind === "collection" && o.method === method && o.path === rest);
    if (exact) return { operation: exact, params: {} };
    const slash = rest.lastIndexOf("/");
    const parent = rest.slice(0, slash);
    const uid = rest.slice(slash + 1);
    const record = OPERATIONS.find((o) => o.kind === "record" && o.method === method && o.path === parent);
    return record && uid ? { operation: record, params: { uid } } : undefined;
  };

  /** @param {MockRequest} request @param {Operation} operation @returns {MockResponse} */
  const defaultResponse = (request, operation) => {
    const factory = factoryFor(operation.resource);
    const verb = operation.name.split(".")[1];
    const returnBody = request.query.returnBody === "true";
    if (operation.name === "companyFiles.list") return { status: 200, body: [fake.companyFile()] };
    if (operation.name === "company.retrieve") return { status: 200, body: fake.company() };
    if (operation.name === "timesheets.retrieve") {
      return {
        status: 200,
        body: fake.timesheet({
          Employee: { UID: request.params.uid },
          ...(request.query.StartDate && { StartDate: request.query.StartDate }),
          ...(request.query.EndDate && { EndDate: request.query.EndDate }),
        }),
      };
    }
    switch (verb) {
      case "list": {
        const items = fake.many(factory, 3);
        return { status: 200, body: { Items: items, NextPageLink: null, Count: items.length } };
      }
      case "retrieve":
        return { status: 200, body: factory({ UID: request.params.uid }) };
      case "create": {
        const uid = fake.uid();
        const location = `${request.url.split("?")[0].replace(/\/+$/, "")}/${uid}`;
        return {
          status: 201,
          headers: { Location: location },
          body: returnBody ? { ...factory(), ...request.body, UID: uid } : undefined,
        };
      }
      case "update":
        return { status: 200, body: returnBody ? request.body : undefined };
      default:
        return { status: 200 };
    }
  };

  /** @param {string} name */
  const assertOperation = (name) => {
    if (!OPERATION_NAMES.includes(name) && !routes.has(name)) {
      throw new TypeError(`myob-sdk/testing: unknown operation "${name}". Known: ${OPERATION_NAMES.join(", ")}`);
    }
  };

  /** @param {string} name @returns {Handler | undefined} */
  const nextHandler = (name) => {
    const list = handlers.get(name) ?? [];
    const once = list.find((h) => h.once && !h.used);
    if (once) return once;
    return list.filter((h) => !h.once).at(-1);
  };

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const found = match(method, url);
    if (!found) {
      // A response rather than a throw: the client would report a throw as a connection error.
      const message = `myob-sdk/testing: no MYOB operation matches ${method} ${url}; handle it with mock.onRequest(method, path)`;
      return new Response(JSON.stringify({ Errors: [{ Name: "MockNoOperation", Message: message, Severity: "Error" }] }), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { operation, params } = found;
    /** @type {MockRequest} */
    const request = {
      operation: operation.name,
      method,
      url: url.toString(),
      params,
      query: Object.fromEntries(url.searchParams),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      headers: { .../** @type {Record<string, string>} */ (init.headers) },
    };
    received.push(request);
    const handler = nextHandler(operation.name);
    if (handler) handler.used = true;
    const { status, body, headers } = handler
      ? handler.respond(request)
      : routes.has(operation.name)
        ? { status: 200, body: undefined, headers: undefined }
        : defaultResponse(request, operation);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };

  /** @type {MyobMock["on"]} */
  const on = (name) => {
    assertOperation(name);
    /** @param {Handler["respond"]} respond @param {boolean} once */
    const add = (respond, once) => {
      handlers.set(name, [...(handlers.get(name) ?? []), { respond, once, used: false }]);
      return builder;
    };
    /** @param {unknown} body @param {MockRequest} request */
    const resolve = (body, request) => (typeof body === "function" ? body(request) : body);
    /** @type {MockHandlers} */
    const builder = {
      reply: (status, body, headers) => add((request) => ({ status, body: resolve(body, request), headers }), false),
      replyOnce: (status, body, headers) => add((request) => ({ status, body: resolve(body, request), headers }), true),
      replyError: (status, error = {}, { once = false } = {}) =>
        add(
          () => ({
            status,
            body: {
              Errors: [
                {
                  Name: error.name ?? ERROR_NAMES[status] ?? "Error",
                  Message: error.message ?? `Mock ${status} response`,
                  Severity: "Error",
                },
              ],
            },
            headers: error.requestId ? { "x-request-id": error.requestId } : undefined,
          }),
          once,
        ),
      replyPages: (pages) => {
        const total = pages.reduce((sum, page) => sum + page.length, 0);
        pages.forEach((items, index) => {
          add((request) => {
            const next = new URL(request.url);
            next.searchParams.set("$skip", String(pages.slice(0, index + 1).reduce((sum, page) => sum + page.length, 0)));
            return {
              status: 200,
              body: { Items: items, Count: total, NextPageLink: index < pages.length - 1 ? next.toString() : null },
            };
          }, true);
        });
        return builder;
      },
      networkError: ({ once = false } = {}) =>
        add(() => {
          throw new TypeError("fetch failed", { cause: new Error("ECONNRESET (myob-sdk/testing)") });
        }, once),
      timeout: ({ once = false } = {}) =>
        add(() => {
          throw new DOMException("The operation timed out (myob-sdk/testing)", "TimeoutError");
        }, once),
    };
    return builder;
  };

  /** @type {MyobMock["onRequest"]} */
  const onRequest = (method, path) => {
    if (typeof method !== "string" || typeof path !== "string" || !path) {
      throw new TypeError("myob-sdk/testing: onRequest(method, path) needs a method and a path");
    }
    const route = { method: method.toUpperCase(), path: path.replace(/^\/+|\/+$/g, "").split("?")[0] };
    const name = `${route.method} ${route.path}`;
    routes.set(name, route);
    return on(name);
  };

  /** @type {MyobMock} */
  const mock = {
    operations: OPERATION_NAMES,
    on,
    onRequest,
    calls: (name) => {
      if (name !== undefined) assertOperation(name);
      return received.filter((request) => name === undefined || request.operation === name);
    },
    pending: () =>
      [...handlers.entries()]
        .filter(([, list]) => list.some((handler) => !handler.used))
        .map(([name]) => name),
    reset: () => {
      handlers = new Map();
      received = [];
      routes = new Map();
    },
  };

  const client = createMyobClient({
    maxRetries: 0,
    rateLimit: false,
    ...clientOptions,
    businessId,
    fetch: fetchImpl,
    connection: {
      headers: async () => ({
        Authorization: `Bearer ${MOCK_ACCESS_TOKEN}`,
        "x-myobapi-key": "mock-client-id",
        "x-myobapi-version": API_VERSION,
        Accept: "application/json",
      }),
      getAccessToken: async () => MOCK_ACCESS_TOKEN,
      forceRefresh: async () => MOCK_ACCESS_TOKEN,
      getTokens: () => ({
        accessToken: MOCK_ACCESS_TOKEN,
        refreshToken: "mock-refresh-token",
        expiresAt: new Date(Date.now() + 20 * 60_000),
      }),
    },
  });

  return { client, mock, fake };
};

module.exports = { createMockMyob };

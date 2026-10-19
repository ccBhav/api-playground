# myob-sdk

A small Node client for the MYOB AccountRight / MYOB Business API: OAuth, typed resources
(`api.employees`, `api.timesheets`, ...) and a generic client for anything else in a company file.

- CommonJS, Node ≥ 20.3, no runtime dependencies (it uses the built-in `fetch`). Ships `.d.ts`
  types generated from the JSDoc, so editors autocomplete it from JS or TS.
- Safe by default: requests are paced under MYOB's rate limit, every request times out (60s), and
  failures that are safe to retry are retried with backoff. If MYOB rejects an access token, the
  client refreshes it once and resends the request.
- Multi-tenant: one auth serves every company. The client never stores tokens; you keep them
  (e.g. in Mongo) and hand them back in. It can coordinate token refreshes across processes.
- Comes with `myob-sdk/testing`, a mock client for your own unit tests.

## Quick start

```js
const { createMyobAuth, createMyobClient } = require("myob-sdk");

// Reads MYOB_CLIENT_ID, MYOB_CLIENT_SECRET and MYOB_REDIRECT_URI unless you pass them.
const myob = createMyobAuth({ appName: "constructionclock/1.4" });

// 1. Send the user to MYOB to log in and pick a company file
app.get("/myob/connect", (req, res) => {
  res.redirect(myob.getAuthorizeUrl({ state: req.session.myobState }));
});

// 2. MYOB redirects back here with ?code=...&businessId=...
app.get("/myob/callback", async (req, res) => {
  const { tokens, businessId } = await myob.handleCallback(req.query, {
    expectedState: req.session.myobState, // throws MyobAuthError (code "state_mismatch") otherwise
  });
  await saveMyobConnection(companyId, { ...tokens, businessId });
  res.redirect("/settings/integrations");
});

// 3. Later, when calling the API for that company. businessId comes from the stored tokens.
const api = createMyobClient({
  auth: myob,
  tokens: company.connectedIntegration.myob,
  onRefresh: (tokens) => saveMyobConnection(companyId, tokens),
  loadTokens: () => loadMyobConnection(companyId), // when more than one process can refresh
});

const { items } = await api.customers.list({ filter: "IsActive eq true", top: 50 });
for await (const employee of api.employees.iterate()) {
  // every employee, across pages, typed as Employee
}
const sheet = await api.timesheets.retrieve(employeeUid, {
  startDate: "2026-10-12T00:00:00",
  endDate: "2026-10-18T00:00:00",
});
```

## The OAuth flow

1. The user opens `getAuthorizeUrl()`, logs in to MYOB and grants access.
2. MYOB redirects to `redirectUri` with a one-time `code` and the `businessId` of the company file
   they picked. **The code expires in a few minutes**, so exchange it straight away.
3. You exchange the code for an access token and a refresh token.
4. **The access token lasts 20 minutes.** After that you trade the refresh token for a new pair.
   **MYOB issues a new refresh token on every refresh and the old one stops working**, so always
   save the latest one. `connect()` does the refreshing for you.

## API

### `createMyobAuth(config?)`

| Option         | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `clientId`     | yes, or `MYOB_CLIENT_ID` | API key from the [MYOB developer dashboard](https://developer.myob.com/dashboard). Also sent as `x-myobapi-key`. |
| `clientSecret` | yes, or `MYOB_CLIENT_SECRET` |                                                          |
| `redirectUri`  | yes, or `MYOB_REDIRECT_URI` | Must exactly match the redirect URI registered with MYOB. |
| `scopes`       | no       | Array or space-separated string. Defaults to `SCOPES.ALL`.       |
| `apiVersion`   | no       | Sent as `x-myobapi-version`. Defaults to `"v2"` (`API_VERSION`).  |
| `timeoutMs`    | no       | Timeout for token requests. Default `60000`.                     |
| `rateLimit`    | no       | Pacing shared by every client made from this auth. Default 8 requests a second. See [Rate limiting](#rate-limiting). |
| `appName`      | no       | Appended to the `User-Agent`, e.g. `"constructionclock/1.4"`, so MYOB support can identify your traffic. |
| `logger`       | no       | See [Logging](#logging).                                         |
| `fetch`        | no       | Custom `fetch`, for proxies, tracing or tests.                   |

Throws a `TypeError` naming the option and its env var if a required one is missing, and warns
about unknown options (`unknown option "redirectUrl" (did you mean "redirectUri"?)`). Returns an
object with the methods below.

Token requests time out but are **never retried**: MYOB kills a refresh token as soon as it's used,
so resending one whose response got lost would only fail with `invalid_grant`.

### `getAuthorizeUrl({ state?, prompt? })` → `string`

Builds the MYOB login URL. Pass a random `state` and check it in the callback. `prompt` defaults to
`"consent"` so the user always sees the company-file picker; pass `null` to leave it out.

### `handleCallback(query, { expectedState?, timeoutMs?, signal? })` → `Promise<{ tokens, businessId, state }>`

Does everything the redirect route needs in one call. `query` can be Express's `req.query`, a
`URLSearchParams`, or a URL string (full or `/path?code=...`). If MYOB redirected back with
`?error=` (e.g. the user clicked *Deny*), it throws a `MyobAuthError` whose `code` is that error.

Pass `expectedState` (the `state` you gave `getAuthorizeUrl`) and the SDK checks it before using the
code. A mismatch throws a `MyobAuthError` with code `state_mismatch`. If the callback has a `state`
but you didn't pass `expectedState`, the SDK warns once. `timeoutMs` and `signal` apply to the code
exchange.

### `exchangeCode(code, { timeoutMs?, signal? })` → `Promise<MyobTokens>`

The lower-level step inside `handleCallback`: swaps an authorization code for tokens.

### `refresh(refreshToken, { timeoutMs?, signal? })` → `Promise<MyobTokens>`

Gets a new token pair. Save the returned `refreshToken`; the one you passed in is now dead.

### `connect({ tokens, onRefresh?, skewSeconds?, loadTokens?, withRefreshLock? })` → connection

Holds one company's tokens and refreshes them when needed.

- `tokens`: whatever you stored. It needs `refreshToken`, and ideally `accessToken` and `expiresAt`.
- `onRefresh(tokens)`: called (and awaited) after every refresh. Save the new tokens here.
- `skewSeconds`: refresh this many seconds before expiry. Default `60`.
- `loadTokens()` and `withRefreshLock(fn)`: see [Running more than one process](#running-more-than-one-process).

The connection has:

| Member             | What it is                                                                  |
| ------------------ | --------------------------------------------------------------------------- |
| `getAccessToken()` | `Promise<string>`: a valid access token, refreshing first if needed.         |
| `forceRefresh(rejectedToken?)` | `Promise<string>`: refresh now. If the connection has already moved past `rejectedToken`, it returns the current token without refreshing. The client calls this on a 401. |
| `headers()`        | `Promise<object>`: `Authorization`, `x-myobapi-key`, `x-myobapi-version: v2` and `Accept` headers for any AccountRight request. |
| `getTokens()`      | The tokens it currently holds, including any refreshed ones.                 |
| `rateLimiter`      | The auth's shared limiter, which clients use by default (unset with `rateLimit: false`). |
| `userAgent`        | The `User-Agent` clients send, including `appName`.                          |

If several requests in one process find an expired token at the same time, they share **one**
refresh call. This matters because MYOB invalidates the old refresh token as soon as it's used.

If `onRefresh` throws, that error reaches the caller. The connection still keeps the new tokens,
so later calls on it keep working.

#### Running more than one process

The shared refresh above only works inside one process. If two processes (two API servers, or an
API server and a worker) refresh the same company at once, one of them uses a refresh token the
other has just killed, gets `invalid_grant`, and the company looks disconnected. To prevent that:

- **`loadTokens`** (an async function that reads this company's tokens from your database). Before
  refreshing, the connection reloads and adopts newer tokens another process saved. After an
  `invalid_grant`, it reloads once more and adopts the other process's tokens instead of failing.
  "Newer" means a later `expiresAt`.
- **`withRefreshLock`** (`(fn) => Promise`), which runs `fn` while holding a lock shared by every
  process for this company, e.g. a Redis or Mongo lock keyed on the company. With `loadTokens`,
  this makes concurrent refreshes safe. Without a lock, `loadTokens` alone recovers from most races
  but not all of them, for example when the other process hasn't saved its tokens yet.

```js
const api = createMyobClient({
  auth: myob,
  tokens: saved,
  onRefresh: (tokens) => saveMyobConnection(companyId, tokens),
  loadTokens: () => loadMyobConnection(companyId),
  withRefreshLock: (fn) => locks.withLock(`myob-refresh:${companyId}`, fn),
});
```

### `createMyobClient(config)`

A client for one company file. Every call asks the connection for headers, so expired tokens are
refreshed for you.

Pass **either** `auth` + `tokens` (the client calls `auth.connect` for you) **or** a `connection`
you made yourself.

| Option                   | Required | Description                                                        |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `auth`                   | one of   | From `createMyobAuth(...)`. Use with `tokens`.                     |
| `tokens`                 | with `auth` | Stored tokens. Their `businessId` is used if `businessId` isn't given. |
| `onRefresh`, `skewSeconds`, `loadTokens`, `withRefreshLock` | no | With `auth`: passed to `connect`. |
| `connection`             | one of   | From `myob.connect(...)`.                                          |
| `businessId`             | mostly   | The company file. Every call except `companyFiles.list()` needs it. |
| `companyFileCredentials` | no       | `{ username, password }`, only for files that ask for their own login. Sent as `x-myobapi-cftoken`. |
| `baseUrl`                | no       | Defaults to `API_BASE_URL`.                                        |
| `timeoutMs`              | no       | Per attempt. Default `60000`.                                      |
| `maxRetries`             | no       | Default `2`. See [Retries](#retries).                              |
| `rateLimit`              | no       | Defaults to the connection's shared limiter. See [Rate limiting](#rate-limiting). |
| `hooks`                  | no       | See [Hooks](#hooks).                                               |
| `appName`                | no       | Defaults to the auth's `appName`.                                  |
| `logger`                 | no       | See [Logging](#logging).                                           |
| `fetch`                  | no       | Custom `fetch`, for proxies, tracing or tests.                     |

Every method takes optional [request options](#request-options) as its last argument.

#### Typed resources

| Resource                 | Path                         | Record type        |
| ------------------------ | ---------------------------- | ------------------ |
| `api.customers`          | `Contact/Customer`           | `Customer`         |
| `api.suppliers`          | `Contact/Supplier`           | `Supplier`         |
| `api.employees`          | `Contact/Employee`           | `Employee`         |
| `api.contacts`           | `Contact` (all types)        | `MyobContact`      |
| `api.jobs`               | `GeneralLedger/Job`          | `Job`              |
| `api.accounts`           | `GeneralLedger/Account`      | `Account`          |
| `api.taxCodes`           | `GeneralLedger/TaxCode`      | `TaxCode`          |
| `api.items`              | `Inventory/Item`             | `Item`             |
| `api.activities`         | `TimeBilling/Activity`       | `Activity`         |
| `api.activitySlips`      | `TimeBilling/ActivitySlip`   | `MyobRecord`       |
| `api.payrollCategories`  | `Payroll/PayrollCategory`    | `PayrollCategory`  |
| `api.invoices`, `api.itemInvoices`, `api.serviceInvoices` | `Sale/Invoice[/Item\|/Service]` | `MyobRecord` |

Each one has the same methods:

| Method                              | Returns                                                         |
| ----------------------------------- | --------------------------------------------------------------- |
| `list(query?)`                      | One page: `{ items, count, nextPageLink, nextPage(), response: { status, headers } }`. `nextPage()` fetches the next page (typed the same, with the same request options) or resolves `null` on the last one. |
| `iterate(query?)`                   | Async iterator over every record, following `NextPageLink`.      |
| `all(query?)`                       | Every record as an array. Prefer `iterate` for big collections.  |
| `retrieve(uid)`                     | One record.                                                      |
| `create(body, { returnBody? })`     | `{ uid, location, data }`. The UID comes from MYOB's `Location` header. |
| `update(uid, body, { returnBody? })`| PUTs the record. `body` needs `UID` and the current `RowVersion`. |
| `delete(uid)`                       | Deletes the record.                                              |

MYOB rejects verbs a resource doesn't support (e.g. creating on `api.contacts`) with an API error.

The record types are a starting point taken from MYOB's API reference, not full schemas: every
field is optional, unknown fields pass through, and enum fields accept values the SDK doesn't know.
Check a field against the reference before relying on it, and add fields to `src/models.js` as you
need them.

#### Timesheets

MYOB addresses a timesheet by employee UID and period, not by its own UID, so `api.timesheets`
takes a `{ startDate, endDate }` period (sent as `StartDate` and `EndDate`, in the format MYOB
documents, e.g. `"2026-10-12T00:00:00"`):

| Method                                    | Returns                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `list({ startDate, endDate, ...query })`, `iterate(...)`, `all(...)` | Every employee's timesheet for the period. |
| `retrieve(employeeUid, { startDate, endDate })` | One employee's timesheet.                           |
| `update(employeeUid, timesheet, { returnBody? })` | Replaces it for the period in `timesheet.StartDate`/`EndDate`. |

#### Company

`api.company.retrieve()` returns the company file's details. `api.companyFiles.list()` returns the
company files this login can see, and doesn't need `businessId`. (`api.listCompanyFiles()` still
works but is deprecated.)

#### Generic methods

For anything the typed resources don't cover. `path` is relative to the company file (e.g.
`RESOURCES.CUSTOMERS` or `"Sale/Order/Item"`). It can also be an absolute URL such as a
`NextPageLink`, but only on the `baseUrl`'s origin or an `https://*.myob.com` host; the client
refuses any other host so the token never leaks.

| Method                               | Returns                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `get(path, query?)`                  | The response body as-is.                                         |
| `list(path, query?)`, `iterate(path, query?)`, `all(path, query?)` | As on a resource.    |
| `retrieve(path, uid)`, `create(path, body)`, `update(path, uid, body)`, `delete(path, uid)` | As on a resource. |
| `request(method, path, { query?, body? })` | Anything else: `{ status, headers, data }`.               |

From TypeScript, these take a type parameter, e.g. `api.retrieve<Employee>(path, uid)` or
`api.request<MyShape>("GET", path)`. `get` and `request` return `unknown` without one.

The client also exposes `connection`, so `api.connection.getTokens()` gives you the latest tokens.
UIDs and `businessId` are URI-encoded for you.

`query` takes the OData options `top` (max 1000, MYOB default 400), `skip`, `filter` and `orderBy`,
sent as `$top`, `$skip`, `$filter` and `$orderby`. Other keys are sent as-is. MYOB ignores
parameters it doesn't know, so a typo would quietly return every record: the SDK warns (once per
key) when a list query key looks like a misspelt OData option (`fitler`, `orderby`, `$filter`), or
is a request option such as `timeoutMs` passed in the query instead of the options argument.

`RESOURCES` has the paths of the common resources (`RESOURCES.CUSTOMERS`, `RESOURCES.TIMESHEETS`, ...).

### Request options

| Option       | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| `timeoutMs`  | Overrides the client's timeout for this call (per attempt).                   |
| `maxRetries` | Overrides the client's `maxRetries` for this call. `0` turns retries off.     |
| `signal`     | An `AbortSignal`. Cancels the request, and any wait for a rate-limit slot or between retries, with `MyobAbortError`. |
| `headers`    | Extra headers for this call.                                                  |
| `onResponse` | `(response) => void`, called with the raw response (`status`, `headers`, `durationMs`) that the call returns or throws on. For `iterate` and `all`, once per page. |

```js
await api.invoices.list({ top: 1000 }, { timeoutMs: 120_000, signal: req.signal });

let requestId;
const employee = await api.employees.retrieve(uid, {
  onResponse: (response) => (requestId = response.headers.get("x-request-id")),
});
```

### Retries

The client retries up to `maxRetries` times (default 2). It waits with exponential backoff and
jitter, starting around 0.5s, or for as long as MYOB's `Retry-After` header asks (capped at 60s).

| Failure                                    | GET / PUT / DELETE | POST |
| ------------------------------------------ | ------------------ | ---- |
| Connection error or timeout                | retried            | not retried (MYOB has no idempotency keys, so it could create the record twice) |
| 408, 5xx                                   | retried            | not retried |
| 429, or MYOB's 403 "over QPS" rate-limit answer | retried       | retried (the gateway rejected it, so MYOB never processed it) |
| 401 for a stale token                      | refresh once, then resend | refresh once, then resend |
| 409 / 412 (stale `RowVersion`), other 4xx  | not retried        | not retried |

A timeout, dropped connection, 408 or 5xx doesn't tell you whether MYOB applied the request, so a
resend can fail only because the first attempt worked:

- A **DELETE** that gets 404 after such a retry is treated as deleted, since the record is gone.
- Any other error after such a retry has `afterRetry: true` and says so in its message. The usual
  case is a **PUT** that gets `MyobConflictError`: the first attempt went through and changed the
  `RowVersion`. Re-read the record before trying again.

MYOB allows about 8 requests a second per API key. Recognising its 403 "over QPS" answer as a rate
limit is based on how its API gateway behaves, not on MYOB's docs.

### Rate limiting

Every client made from one `createMyobAuth` shares one limiter, because MYOB's limit is per API key
and every tenant uses the same key. By default it allows bursts of 8 and then 8 requests a second.
Requests wait for a slot instead of hitting the limit and retrying.

```js
createMyobAuth({ rateLimit: { requestsPerSecond: 4 } }); // e.g. two processes share the key
createMyobAuth({ rateLimit: false });                     // no pacing

// For clients built from your own connection, or to share pacing across auth instances:
const limiter = createRateLimiter({ requestsPerSecond: 8, burst: 8 });
createMyobClient({ connection, businessId, rateLimit: limiter });
```

The limiter only coordinates requests inside one process. If several processes share the API key,
give each one a share of the limit (`requestsPerSecond: 8 / processCount`). The retry on 429 still
catches what gets through.

### Hooks

For tracing and metrics. Each hook is called for every attempt, retries included:

```js
createMyobClient({
  auth: myob,
  tokens,
  hooks: {
    onRequest: (ctx) => {
      ctx.state.span = tracer.startSpan("myob.request", { attributes: { method: ctx.method, url: ctx.url } });
      ctx.setHeader("traceparent", currentTraceparent());
    },
    onResponse: (ctx) => ctx.state.span.end({ status: ctx.status, attempt: ctx.attempt }),
    onError: (ctx) => ctx.state.span.end({ error: ctx.error }), // no response: connection, timeout, abort
  },
});
```

`ctx` has `method`, `url`, `attempt` (1 for the first try) and `state`, an object that carries from
`onRequest` to `onResponse`/`onError` for that attempt. Each attempt fires `onRequest`, then exactly
one of `onResponse` or `onError`. `onResponse` adds `status`, `headers` and `durationMs`, and fires
for error statuses too. `onError` adds `error` and `durationMs`; it also fires when the attempt
fails before anything is sent, i.e. the access token couldn't be refreshed or the `signal` fired
while waiting for a rate-limit slot. A hook that throws is logged as a warning and doesn't fail the
request.

### Logging

Pass any object with `debug` and `warn` methods, such as `console` or a pino logger, as `logger`.
The SDK logs the method, URL, status, timing, retries and token refreshes. It never logs headers,
tokens or bodies. Without a logger, warnings (unknown options, a missing `expectedState`, MYOB's
`Deprecation`/`Sunset` headers, a throwing hook) go to `process.emitWarning`, and debug output is
dropped.

### `isExpired(tokens, { skewSeconds? })` → `boolean`

True if the access token is missing, expired, or within `skewSeconds` (default 60) of expiring.

## Tokens

```js
/** @typedef {Object} MyobTokens
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {Date}   expiresAt   absolute expiry of the access token
 * @property {string} [scope]
 * @property {string} [tokenType]
 */
```

The object is plain and safe to store as-is. When you hand it back, `expiresAt` can be a `Date`,
an ISO string or epoch milliseconds, so whatever your database returns will work. The input type is
`StoredMyobTokens` (every field optional, `expiresAt?: Date | string | number`), so TypeScript
accepts tokens read from JSON without a cast; `connection.getTokens()` always gives back a `Date`. If MYOB leaves
`expires_in` out of a token response, the SDK assumes the documented 20 minutes.

## Errors

Everything the SDK throws, apart from `TypeError` for bad arguments, extends `MyobError`:

```
MyobError
├── MyobConnectionError        no response: DNS, TLS, connection reset (`cause` has the details)
│   └── MyobTimeoutError       no response within `timeoutMs`
├── MyobAbortError             your `signal` fired
├── MyobAuthError              MYOB's OAuth server said no, or `state` didn't match
└── MyobApiError               an AccountRight call got a non-2xx response
    ├── MyobBadRequestError          400
    ├── MyobAuthenticationError      401
    ├── MyobPermissionDeniedError    403
    ├── MyobNotFoundError            404
    ├── MyobConflictError            409, 412 (stale RowVersion: re-read and try again)
    ├── MyobRateLimitError           429, or MYOB's 403 "over QPS"
    └── MyobInternalServerError      5xx
```

`MyobAuthError`:

| Property      | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `status`      | HTTP status (not set for errors in the redirect).              |
| `code`        | OAuth error, e.g. `invalid_grant`, `access_denied`; or `state_mismatch`, or `no_refresh_token` (the token expired and none is stored). |
| `reconnectRequired` | `true` for `invalid_grant` and `no_refresh_token`: the stored tokens are dead and the user must connect again. |
| `retryable`   | `true` when MYOB's OAuth server failed (5xx) or rate-limited (429). Don't disconnect the company for these; try later. |
| `description` | OAuth `error_description`, if MYOB sent one.                   |
| `body`        | The raw response body (parsed JSON when possible).             |

`MyobApiError` and its subclasses:

| Property     | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `status`     | HTTP status.                                                               |
| `code`       | The first `Errors[].Name`, e.g. `OAuthTokenIsInvalid`.                      |
| `errors`     | MYOB's `Errors` array of `{ Name, Message, AdditionalDetails, ErrorCode, Severity }`. |
| `requestId`  | From the response headers, when MYOB sends one. Quote it to MYOB support.  |
| `retryable`  | `true` for 408, 429, rate limits and 5xx other than 501. The client has already retried these where it was safe to. |
| `retryAfter` | Seconds, from `Retry-After`.                                               |
| `afterRetry` | `true` when an earlier attempt of this request may have succeeded. See [Retries](#retries). |
| `method`, `url`, `headers`, `body` | The request, plus the raw response headers and body.  |

```js
const { MyobAuthError, MyobConflictError } = require("myob-sdk");

try {
  await api.customers.update(uid, customer);
} catch (error) {
  if (error instanceof MyobConflictError) {
    // Someone else changed it (or our own earlier attempt did: see error.afterRetry).
    // Re-read, re-apply, retry.
  } else if (error instanceof MyobAuthError && error.reconnectRequired) {
    // The refresh token is dead (revoked, expired, or already used). The user must reconnect.
  } else if (error instanceof MyobAuthError && error.retryable) {
    // MYOB's OAuth server is having trouble. Keep the connection and try again later.
  }
  throw error;
}
```

A token refresh inside an API call can still throw `MyobAuthError`.

## Testing your code: `myob-sdk/testing`

`createMockMyob()` gives you a **real** client over a fake `fetch`, so URL building, paging and
error classes run exactly as in production; the mock only decides which response comes back. It
has no dependencies and works with any test runner.

```js
const { createMockMyob } = require("myob-sdk/testing");
const { MyobNotFoundError } = require("myob-sdk");

const { client, mock, fake } = createMockMyob({ seed: 1 });

mock.on("employees.list").replyPages([fake.many(fake.employee, 2), [fake.employee({ FirstName: "Aroha" })]]);
mock.on("timesheets.update").reply(200);
mock.on("customers.retrieve").replyError(404, { requestId: "req-1" });

await syncTimesheets(client);                      // your code, given the mock's client

expect(mock.calls("timesheets.update")).toHaveLength(3);
expect(mock.calls("timesheets.update")[0].body.Lines).toHaveLength(1);
expect(mock.pending()).toEqual([]);                // every handler was used
```

- **Operations** are named after the SDK methods: `employees.list`, `employees.retrieve`,
  `employees.create`, `employees.update`, `employees.delete` (and the same for every typed
  resource), `timesheets.list/retrieve/update`, `company.retrieve` and `companyFiles.list`.
  `mock.operations` lists them all. The generic methods (`api.list(RESOURCES.EMPLOYEES)`) match the
  same operations.
- **Other paths:** `mock.onRequest("GET", "Sale/Order/Item")` takes the same handlers, for paths you
  call through the generic methods. The path is relative to the company file and matched exactly
  (without the query string); calls are recorded as `mock.calls("GET Sale/Order/Item")`.
- **Handlers:** `reply(status, body | (req) => body, headers?)`, `replyOnce(...)` (queued in order,
  ahead of any `reply`), `replyError(status, { name?, message?, requestId? })` in MYOB's error
  shape, `replyPages([[...], [...]])` linked by `NextPageLink`, `networkError()` and `timeout()`
  (both take `{ once: true }`).
- **Defaults:** an operation without a handler gets a realistic success response built by `fake`.
  A request that matches no operation never reaches the network: it gets a 501, which the client
  throws as a `MyobInternalServerError` (not retried) whose message names the request and
  `mock.onRequest`.
- **`req`** (in computed replies and `mock.calls()`) has `operation`, `method`, `url`,
  `params.uid`, `query` and the parsed `body`.
- **`fake`** has seeded factories typed against the SDK's record types: `employee`, `customer`,
  `supplier`, `job`, `activity`, `payrollCategory`, `account`, `taxCode`, `item`, `timesheet`,
  `company`, `companyFile`, `record`, plus `uid()`, `many(factory, n, overrides?)` and
  `seed(n)`. Overrides always win. The same seed gives the same records.
- Retries and rate limiting are off in the mock's client so error tests don't wait. Pass
  `client: { maxRetries: 2 }` to turn retries back on.

## Exports

| Export             | What it is                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| `createMyobAuth`   | See above.                                                              |
| `createMyobClient` | See above.                                                              |
| `createRateLimiter`| See [Rate limiting](#rate-limiting).                                    |
| `MyobError` and subclasses | The error classes above.                                        |
| `isExpired`        | See above.                                                              |
| `RESOURCES`        | Common resource paths.                                                  |
| `encodeCfToken`    | `({ username, password }) => string`, the `x-myobapi-cftoken` value.    |
| `SCOPES`           | Scope names (`SCOPES.COMPANY_FILE`, `SCOPES.SALES`, …) plus `SCOPES.ALL`. |
| `API_BASE_URL`     | `https://api.myob.com/accountright`                                     |
| `API_VERSION`      | The pinned `x-myobapi-version`, `v2`.                                   |

Named types (`MyobTokens`, `Employee`, `Timesheet`, `Resource`, `RequestOptions`, `Page`,
`MyobClient`, `MyobHooks`, …) are exported from the package's `.d.ts`. `myob-sdk/testing` exports
`createMockMyob` and `createFactories`. Nothing else is importable; `myob-sdk/src/...` is blocked
by the `exports` map.

## Development

```sh
npm install
npm test             # vitest, with a fake fetch, so no network needed
npm run typecheck    # tsc over the JSDoc, plus a TS consumer (test/types/consumer.ts) of the .d.ts
npm run build:types  # regenerate types/ after changing JSDoc; commit the result
npm run check        # typecheck + test
npm run test:live    # read-only smoke test against real MYOB (see below)
```

CI (`.github/workflows/myob-sdk.yml`) runs the typecheck and tests on Node 20, 22 and 24. It also
regenerates `types/` and fails if the result differs from what's committed. `types/` is the public
API, so every change to it shows up in review.

To try it against real MYOB, use the playground one level up. Copy `../.env.example` to `../.env`,
fill it in, then run `npm start` from `myob/`. It starts an example web app on
`http://localhost:8080` where you can connect to MYOB, pick a company file and page through any
`RESOURCES` entry. Tokens are saved to `.tokens.json`, standing in for a database.

`npm run test:live` reuses that connection for a read-only smoke test (company files, company,
employees, accounts). It writes refreshed tokens back to `.tokens.json`.

## Not covered yet

- Recorded-HTTP tests (real MYOB responses replayed as fixtures). The live smoke test is the only
  check against MYOB's real response shapes.
- A stateful mock mode where `create` → `retrieve` → `list` stay consistent, and a `delay()`
  handler for testing your own timeouts.
- Rate limiting across processes. Each process paces itself; split the limit between them.
- Typed resources for anything beyond the table above. Use the generic methods with a path.

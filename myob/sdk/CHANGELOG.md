# Changelog

## Unreleased

### Added
- Timeouts on every request (`timeoutMs`, default 60s), per client and per request.
- Automatic retries (`maxRetries`, default 2) with exponential backoff, jitter and `Retry-After`.
  GET/PUT/DELETE are retried on connection errors, timeouts, 408, 429 and 5xx. POST is retried only
  on rate limits.
- A 401 for a stale access token triggers one refresh and a resend (`connection.forceRefresh`).
- Request options as the last argument of every client method: `timeoutMs`, `maxRetries`, `signal`,
  `headers`.
- `createMyobClient({ auth, tokens, onRefresh })` as a shortcut for `connect` + `connection`.
  `businessId` defaults to `tokens.businessId`.
- `handleCallback(query, { expectedState })` checks the OAuth `state`.
- Error hierarchy under `MyobError`: `MyobConnectionError`, `MyobTimeoutError`, `MyobAbortError`,
  and `MyobApiError` subclasses by status. API errors carry `code`, `requestId`, `headers`,
  `retryable` and `retryAfter`.
- `User-Agent: myob-sdk/<version> node/<version>`.
- `logger` option, and warnings for unknown options and for MYOB `Deprecation`/`Sunset` headers.
- `apiVersion` option on `createMyobAuth`, and the `API_VERSION` export.
- `retrieve` and `delete` methods, and `response` (status and headers) on `list()` pages.
- `.d.ts` types generated from the JSDoc, and an `exports` map.
- Typed resources: `api.customers`, `api.employees`, `api.jobs`, `api.activities`,
  `api.payrollCategories` and more, each with `list/iterate/all/retrieve/create/update/delete`;
  `api.timesheets` (addressed by employee UID and `{ startDate, endDate }`); `api.company.retrieve()`.
- Record types (`Employee`, `Timesheet`, `Job`, `Activity`, `PayrollCategory`, `Customer`, ...),
  open to unknown fields and enum values. The generic methods take a type parameter, and `get` and
  `request` return `unknown` instead of `any`.
- Rate limiting: every client from one `createMyobAuth` shares a limiter (8 requests a second by
  default, `rateLimit` option, `createRateLimiter` export).
- `loadTokens` and `withRefreshLock` on `connect` (and `createMyobClient`), so several processes
  can refresh the same company without killing each other's refresh tokens.
- `hooks: { onRequest, onResponse, onError }` on `createMyobClient`, and an `onResponse` request
  option for the raw response of any call.
- `afterRetry` on API errors, set when an earlier attempt of the request may have succeeded.
- `timeoutMs` and `signal` options on `exchangeCode`, `refresh` and `handleCallback`.
- `clientId`, `clientSecret` and `redirectUri` fall back to `MYOB_CLIENT_ID`, `MYOB_CLIENT_SECRET`
  and `MYOB_REDIRECT_URI`.
- `appName` option, appended to the `User-Agent`.
- `myob-sdk/testing`: `createMockMyob()` (a real client over a fake `fetch`, with handlers per
  operation) and seeded `createFactories()`.
- An opt-in, read-only live smoke test (`npm run test:live`), and CI that also checks the committed
  `types/` matches the source.

### Changed
- Network failures are wrapped in `MyobConnectionError` instead of surfacing raw `fetch` errors.
- `MyobAuthError` and `MyobApiError` now extend `MyobError`.
- `businessId` and UIDs are URI-encoded.
- A token response without `expires_in` is treated as lasting 20 minutes instead of expiring at once.
- Only the package root and `myob-sdk/testing` can be imported (`myob-sdk/src/...` is blocked).
- A DELETE that gets 404 after retrying a timeout, dropped connection or 5xx resolves, since the
  earlier attempt deleted the record.
- Absolute URLs on a custom `baseUrl`'s origin are followed even over http, so `listCompanyFiles`
  and paging work against a local mock server.
- A custom `fetch` that throws a `TimeoutError` gives `MyobTimeoutError`.
- Supported Node versions widened from ≥ 24 to ≥ 20.3.

### Removed
- `getById`: use `retrieve`. `remove`: use `delete`. `myob.isExpired`: use the top-level `isExpired`.

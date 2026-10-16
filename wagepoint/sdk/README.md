# wagepoint-sdk

A small Node client for the Wagepoint Public API: OAuth (client credentials) plus a client for
companies, people and time entries.

- CommonJS, Node ≥ 24, no runtime dependencies (it uses the built-in `fetch`).
- Built from Wagepoint's *Public API quick start*. Anything that guide doesn't cover (error body
  shape, rate limits, other endpoints) is marked as a guess below.

## How it differs from the MYOB SDK

Same shape (`createXAuth` → `connect()` → `createXClient`), different OAuth grant. Wagepoint uses
the **client credentials** grant: your server trades the client ID and secret for a token. There is
no user login, redirect, authorization code or refresh token. One token covers every company your
credentials can see, so one connection serves the whole app, and companies are picked by
`companyId`.

## Quick start

```js
const { createWagepointAuth, createWagepointClient } = require("wagepoint-sdk");

const wagepoint = createWagepointAuth({
  clientId: process.env.WAGEPOINT_CLIENT_ID,
  clientSecret: process.env.WAGEPOINT_CLIENT_SECRET,
});

// One per process (or share the token via onToken / tokens, e.g. in Redis)
const conn = wagepoint.connect({
  tokens: await cache.get("wagepoint:token"),
  onToken: (tokens) => cache.set("wagepoint:token", tokens),
});

// 1. Find the company. Match on a stable field, never on position.
const root = createWagepointClient({ connection: conn });
const { items: companies } = await root.listCompanies();
const company = companies.find((c) => c.company_code === "ABC1234");

// 2. Map people by ID (never by name). Save company.id and the mapping.
const api = createWagepointClient({ connection: conn, companyId: company.id });
for await (const person of api.iterate("persons")) {
  // person.id is the person_id for time entries
}

// 3. Submit time, keeping the idempotency key with the batch
const { items, idempotencyKey } = await api.createTimeEntries([
  { person_id: 12345, work_date: "2026-08-25", hours: 8, notes: "Regular shift" },
]);

// 4. Read it back
const { items: entries } = await api.listTimeEntries({
  fromDate: "2026-08-25",
  toDate: "2026-08-25",
  personIds: [12345],
});
```

## API

### `createWagepointAuth(config)`

| Option         | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `clientId`     | yes      | Issued by Wagepoint.                                             |
| `clientSecret` | yes      | Issued by Wagepoint. Server-side only.                           |
| `scope`        | no       | String or array. Defaults to `"services"`.                       |
| `tokenUrl`     | no       | Defaults to `TOKEN_URL`.                                         |
| `fetch`        | no       | Custom `fetch`, mainly for tests.                                |

Throws a `TypeError` if a required option is missing. Returns `{ requestToken, connect, isExpired }`.

### `requestToken()` → `Promise<WagepointTokens>`

Requests a new access token. Wagepoint asks you to cache tokens rather than request one per call,
so most code wants `connect()`.

### `connect({ tokens?, onToken?, skewSeconds? })` → connection

Holds an access token and requests a new one when it expires.

- `tokens`: a stored token to start from (`{ accessToken, expiresAt }`), so restarts and other
  processes can reuse it.
- `onToken(tokens)`: called (and awaited) for every new token. Save it here.
- `skewSeconds`: renew this many seconds before expiry. Default `60`.

| Method               | Returns                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `getAccessToken()`   | `Promise<string>`: a valid token, requesting one first if needed.         |
| `renew(staleToken?)` | `Promise<string>`: a new token after a 401. If another caller already replaced `staleToken`, returns that one instead of requesting again. |
| `headers()`          | `Promise<object>`: `Authorization` and `Accept`.                          |
| `getTokens()`        | The token it holds, or `null` before the first one.                       |

Concurrent callers share **one** token request. If `onToken` throws, that error reaches the caller,
but the connection keeps the new token.

### `createWagepointClient(config)`

| Option       | Required | Description                                                       |
| ------------ | -------- | ----------------------------------------------------------------- |
| `connection` | yes      | From `wagepoint.connect()`.                                       |
| `companyId`  | mostly   | The `id` from `listCompanies()`. Every call except that one needs it. |
| `baseUrl`    | no       | Defaults to `API_BASE_URL` (`https://api.wagepoint.com`).          |
| `fetch`      | no       | Custom `fetch`, mainly for tests.                                 |

Paths starting with `/` are relative to the API root (e.g. `RESOURCES.COMPANIES`, `/v1/companies`).
Other paths are relative to the company, `/v1/companies/{companyId}/` (e.g. `"persons"`). Absolute
URLs are refused, so the token only ever goes to `baseUrl`.

A **401 is retried once** with a new token from `connection.renew()`, as Wagepoint's guide says to.
That is safe for `createTimeEntries`, because the retry sends the same `Idempotency-Key`.

| Method                                         | Returns                                                     |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `listCompanies(query?)`                        | One page of companies.                                      |
| `listPersons(query?)`                          | One page of the company's people.                           |
| `createTimeEntries(entries, { idempotencyKey? })` | `{ items, idempotencyKey }`. 1–100 entries; a key is generated if you don't pass one. |
| `listTimeEntries({ fromDate, toDate, personIds?, ...query })` | One page of entries in the inclusive date range. |
| `get(path, query?)`                            | The response body as-is.                                    |
| `list(path, query?)`                           | One page: `{ items, after, hasMore, pageSize }`.            |
| `iterate(path, query?)`                        | Async iterator over every record, following `page_info.after`. |
| `all(path, query?)`                            | Every record as an array. Prefer `iterate` for big collections. |
| `request(method, path, { query?, body?, headers? })` | Anything else: `{ status, headers, data }`.           |

**Pagination.** `query.pageSize` is sent as `page_size` and `query.after` as `after`. Other keys go
as-is, and arrays become repeated keys. `iterate` keeps `page_size` the same on every page (default
100), as Wagepoint requires, and treats `after` as an opaque cursor.

**Time entries.** Each entry is `{ person_id, work_date: "YYYY-MM-DD", hours, notes? }`, sent in
Wagepoint's own snake_case. More than 100 entries throws a `TypeError` before anything is sent.
Split them into batches, and give each batch its own key. Store the key with the batch: if the
outcome is unknown (network error, crash), resend the **same** batch with the **same** key, and
Wagepoint won't create duplicates. New entries come back with `status: "pending"`.

*Guess:* the quick start says `listTimeEntries` can filter by "one or more person IDs" but shows
only one, so several IDs are sent as repeated `person_id=` parameters. Confirm this with Wagepoint
before relying on it.

## Tokens

```js
/** @typedef {Object} WagepointTokens
 * @property {string} accessToken
 * @property {Date}   expiresAt   absolute expiry of the access token
 * @property {string} [scope]
 * @property {string} [tokenType]
 */
```

The object is plain and safe to cache. When you hand it back, `expiresAt` can be a `Date`, an ISO
string or epoch milliseconds.

## Errors

A failed token request throws a `WagepointAuthError` with `status`, `code` (OAuth error, e.g.
`invalid_client`, `invalid_scope`), `description` and `body`.

A failed API call throws a `WagepointApiError` with:

| Property  | Meaning                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `status`  | HTTP status.                                                              |
| `method`, `url` | The request.                                                        |
| `detail`  | A best-effort readable message (*guess*: the guide doesn't document the error body, so this reads `title`, `detail`, `message` and `errors` if they're present). |
| `headers` | Response headers. Log Wagepoint's correlation headers from here, never the token. |
| `body`    | The raw response body (parsed JSON when possible).                        |

The guide's rule: never silently drop time data on a 400, a 401 or any other failure. Network
failures are not wrapped. They reach you as normal `fetch` errors, and for `createTimeEntries`
they're the case where you retry with the same idempotency key.

## Exports

`createWagepointAuth`, `createWagepointClient`, `WagepointAuthError`, `WagepointApiError`,
`RESOURCES` (`COMPANIES`, `PERSONS`, `TIME_ENTRIES`), `API_BASE_URL`, `TOKEN_URL`, `DEFAULT_SCOPE`,
`MAX_TIME_ENTRIES_PER_REQUEST` and `isExpired`.

## Development

```sh
npm install
npm test        # vitest, with a fake fetch, so no network needed
```

To try it against real Wagepoint, use the playground one level up. Copy `../.env.example` to
`../.env`, fill in the client ID and secret, then run `npm start` from `wagepoint/`.

## Not covered yet

- Retrying on rate limits or 5xx errors (the guide doesn't document limits). Both reach you as a
  `WagepointApiError`.
- Endpoints beyond the quick start (companies, persons, time entries).

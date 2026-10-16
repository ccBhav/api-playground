# myob-sdk

A small Node client for the MYOB AccountRight / MYOB Business API: OAuth plus a generic client for
reading and writing company-file resources.

- CommonJS, Node ≥ 24, no runtime dependencies (it uses the built-in `fetch`).
- Multi-tenant: one client serves every company. The client never stores tokens; you keep them
  (e.g. in Mongo) and hand them back in.

## Quick start

```js
const { createMyobAuth, createMyobClient, RESOURCES } = require("myob-sdk");

const myob = createMyobAuth({
  clientId: process.env.MYOB_CLIENT_ID,
  clientSecret: process.env.MYOB_CLIENT_SECRET,
  redirectUri: process.env.MYOB_REDIRECT_URI, // must match the one registered with MYOB
});

// 1. Send the user to MYOB to log in and pick a company file
app.get("/myob/connect", (req, res) => {
  res.redirect(myob.getAuthorizeUrl({ state: req.session.myobState }));
});

// 2. MYOB redirects back here with ?code=...&businessId=...
app.get("/myob/callback", async (req, res) => {
  const { tokens, businessId, state } = await myob.handleCallback(req.query);
  if (state !== req.session.myobState) throw new Error("state mismatch");
  await saveMyobConnection(companyId, { ...tokens, businessId });
  res.redirect("/settings/integrations");
});

// 3. Later, when calling the API for that company
const conn = myob.connect({
  tokens: company.connectedIntegration.myob,
  onRefresh: (tokens) => saveMyobConnection(companyId, tokens),
});

const api = createMyobClient({
  connection: conn,
  businessId: company.connectedIntegration.myob.businessId,
});

const { items } = await api.list(RESOURCES.CUSTOMERS, { filter: "IsActive eq true", top: 50 });
for await (const employee of api.iterate(RESOURCES.EMPLOYEES)) {
  // every employee, across pages
}
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

### `createMyobAuth(config)`

| Option         | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `clientId`     | yes      | API key from the [MYOB developer dashboard](https://developer.myob.com/dashboard). Also sent as `x-myobapi-key`. |
| `clientSecret` | yes      |                                                                  |
| `redirectUri`  | yes      | Must exactly match the redirect URI registered with MYOB.        |
| `scopes`       | no       | Array or space-separated string. Defaults to `SCOPES.ALL`.       |
| `fetch`        | no       | Custom `fetch`, mainly for tests.                                |

Throws a `TypeError` if a required option is missing. Returns an object with the methods below.

### `getAuthorizeUrl({ state?, prompt? })` → `string`

Builds the MYOB login URL. Pass a random `state` and check it in the callback. `prompt` defaults to
`"consent"` so the user always sees the company-file picker; pass `null` to leave it out.

### `handleCallback(query)` → `Promise<{ tokens, businessId, state }>`

Does everything the redirect route needs in one call. `query` can be Express's `req.query`, a
`URLSearchParams`, or a URL string (full or `/path?code=...`). If MYOB redirected back with
`?error=` (e.g. the user clicked *Deny*), it throws a `MyobAuthError` whose `code` is that error.

### `exchangeCode(code)` → `Promise<MyobTokens>`

The lower-level step inside `handleCallback`: swaps an authorization code for tokens.

### `refresh(refreshToken)` → `Promise<MyobTokens>`

Gets a new token pair. Save the returned `refreshToken`; the one you passed in is now dead.

### `connect({ tokens, onRefresh?, skewSeconds? })` → connection

Holds one company's tokens and refreshes them when needed.

- `tokens`: whatever you stored. It needs `refreshToken`, and ideally `accessToken` and `expiresAt`.
- `onRefresh(tokens)`: called (and awaited) after every refresh. Save the new tokens here.
- `skewSeconds`: refresh this many seconds before expiry. Default `60`.

The connection has:

| Method             | Returns                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `getAccessToken()` | `Promise<string>`: a valid access token, refreshing first if needed.         |
| `headers()`        | `Promise<object>`: `Authorization`, `x-myobapi-key`, `x-myobapi-version: v2` and `Accept` headers for any AccountRight request. |
| `getTokens()`      | The tokens it currently holds, including any refreshed ones.                 |

If several requests find an expired token at the same time, they share **one** refresh call. This
matters because MYOB invalidates the old refresh token as soon as it's used.

If `onRefresh` throws, that error reaches the caller. The connection still keeps the new tokens,
so later calls on it keep working.

### `createMyobClient(config)`

A client for one company file. Every call asks the connection for headers, so expired tokens are
refreshed for you.

| Option                   | Required | Description                                                        |
| ------------------------ | -------- | ------------------------------------------------------------------ |
| `connection`             | yes      | From `myob.connect(...)`.                                          |
| `businessId`             | mostly   | The company file. Every call except `listCompanyFiles()` needs it. |
| `companyFileCredentials` | no       | `{ username, password }`, only for files that ask for their own login. Sent as `x-myobapi-cftoken`. |
| `baseUrl`                | no       | Defaults to `API_BASE_URL`.                                        |
| `fetch`                  | no       | Custom `fetch`, mainly for tests.                                  |

`path` below is relative to the company file (e.g. `RESOURCES.CUSTOMERS` or `"Sale/Invoice/Item"`).
It can also be an absolute `https://*.myob.com` URL such as a `NextPageLink`. The client refuses
any other host so the token never leaks.

| Method                               | Returns                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `listCompanyFiles()`                 | Company files this login can see.                               |
| `get(path, query?)`                  | The response body as-is.                                         |
| `list(path, query?)`                 | One page: `{ items, count, nextPageLink }`.                      |
| `iterate(path, query?)`              | Async iterator over every record, following `NextPageLink`.      |
| `all(path, query?)`                  | Every record as an array. Prefer `iterate` for big collections.  |
| `getById(path, uid)`                 | One record.                                                      |
| `create(path, body, { returnBody? })`| `{ uid, location, data }`. The UID comes from MYOB's `Location` header. |
| `update(path, uid, body, { returnBody? })` | PUTs the record. `body` needs `UID` and the current `RowVersion`. |
| `remove(path, uid)`                  | Deletes the record.                                              |
| `request(method, path, { query?, body? })` | Anything else: `{ status, headers, data }`.               |

`query` takes the OData options `top` (max 1000, MYOB default 400), `skip`, `filter` and `orderBy`,
sent as `$top`, `$skip`, `$filter` and `$orderby`. Other keys are sent as-is.

`RESOURCES` has paths for the common resources: `COMPANY`, `ACCOUNTS`, `JOBS`, `TAX_CODES`,
`CONTACTS`, `CUSTOMERS`, `SUPPLIERS`, `EMPLOYEES`, `INVOICES`, `ITEM_INVOICES`, `SERVICE_INVOICES`,
`ITEMS`, `ACTIVITIES`, `ACTIVITY_SLIPS`, `PAYROLL_CATEGORIES` and `TIMESHEETS`.

### `isExpired(tokens, { skewSeconds? })` → `boolean`

True if the access token is missing, expired, or within `skewSeconds` (default 60) of expiring.
Also exported at the top level.

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
an ISO string or epoch milliseconds, so whatever your database returns will work.

## Errors

Any failed token request throws a `MyobAuthError`:

| Property      | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `status`      | HTTP status (not set for errors in the redirect).              |
| `code`        | OAuth error, e.g. `invalid_grant`, `access_denied`.            |
| `description` | OAuth `error_description`, if MYOB sent one.                   |
| `body`        | The raw response body (parsed JSON when possible).             |

```js
const { MyobAuthError } = require("myob-sdk");

try {
  await conn.headers();
} catch (error) {
  if (error instanceof MyobAuthError && error.code === "invalid_grant") {
    // The refresh token is dead (revoked, expired, or already used). The user must reconnect.
  }
  throw error;
}
```

Any failed API call throws a `MyobApiError` with `status`, `method`, `url`, `body` and `errors`
(MYOB's `Errors` array of `{ Name, Message, AdditionalDetails, ErrorCode, Severity }`). A token
refresh inside an API call can still throw `MyobAuthError`.

Network failures are not wrapped. They reach you as the normal `fetch` errors, so you can treat
them as temporary.

## Exports

| Export           | What it is                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| `createMyobAuth` | See above.                                                              |
| `createMyobClient` | See above.                                                            |
| `MyobAuthError`  | Error class for auth failures.                                          |
| `MyobApiError`   | Error class for failed API calls.                                       |
| `RESOURCES`      | Common resource paths.                                                  |
| `encodeCfToken`  | `({ username, password }) => string`, the `x-myobapi-cftoken` value.    |
| `SCOPES`         | Scope names (`SCOPES.COMPANY_FILE`, `SCOPES.SALES`, …) plus `SCOPES.ALL`. |
| `API_BASE_URL`   | `https://api.myob.com/accountright`                                     |
| `isExpired`      | See above.                                                              |

## Development

```sh
npm install
npm test        # vitest, with a fake fetch, so no network needed
```

To try it against real MYOB, use the playground one level up. Copy `../.env.example` to `../.env`,
fill it in, then run `npm start` from `myob/`. It starts an example web app on
`http://localhost:8080` where you can connect to MYOB, pick a company file and page through any
`RESOURCES` entry. Tokens are saved to `.tokens.json`, standing in for a database.

## Not covered yet

- Retrying on rate limits (MYOB allows about 8 requests a second per key) or on a 401 from a
  revoked token. Both reach you as a `MyobApiError`.
- Typed helpers for specific resources. Use the generic methods with a `RESOURCES` path.

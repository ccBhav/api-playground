const { randomUUID } = require("node:crypto");

const {
  API_BASE_URL,
  DEFAULT_PAGE_SIZE,
  MAX_TIME_ENTRIES_PER_REQUEST,
  RESOURCES,
} = require("./constants");
const { parseBody } = require("./body");
const { WagepointApiError } = require("./errors");

/** @typedef {import("./auth").WagepointConnection} WagepointConnection */

/**
 * Paging options for list endpoints. Other keys are sent as-is (snake_case, as Wagepoint expects);
 * arrays are sent as repeated keys.
 *
 * @typedef {Object} ListQuery
 * @property {number} [pageSize] - Sent as `page_size`. Keep it the same on every page of a sequence.
 * @property {string} [after] - The opaque cursor from the previous page's `after`.
 */

/**
 * @typedef {Object} Page
 * @property {Array<Record<string, any>>} items
 * @property {string | null} after - Cursor for the next page, or null on the last one.
 * @property {boolean} hasMore
 * @property {number | undefined} pageSize - The page size Wagepoint used.
 */

/**
 * @typedef {Object} TimeEntryInput
 * @property {number} person_id - Wagepoint person ID (from `listPersons`).
 * @property {string} work_date - `YYYY-MM-DD`.
 * @property {number} hours
 * @property {string} [notes]
 */

/**
 * @typedef {Object} WagepointClientConfig
 * @property {WagepointConnection} connection - From `createWagepointAuth(...).connect()`.
 * @property {string | number} [companyId] - Needed for everything except `listCompanies`.
 * @property {string} [baseUrl] - Defaults to `API_BASE_URL`.
 * @property {typeof fetch} [fetch] - Override for tests.
 */

const QUERY_KEYS = { pageSize: "page_size" };

const toSearchParams = (query = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const name = QUERY_KEYS[key] ?? key;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(name, String(item));
    }
  }
  return params;
};

/**
 * Best-effort readable message from an error body. The quick start doesn't document the error
 * shape, so this handles OAuth-style, ProblemDetails-style and `{ message }`-style bodies.
 */
const describeError = (body) => {
  if (typeof body === "string") return body.slice(0, 500);
  if (!body || typeof body !== "object") return "";
  const parts = [body.title, body.detail ?? body.message ?? body.error_description ?? body.error]
    .filter((part) => typeof part === "string" && part);
  const { errors } = body;
  if (Array.isArray(errors)) {
    for (const e of errors) {
      parts.push(typeof e === "string" ? e : [e?.field, e?.message].filter(Boolean).join(": "));
    }
  } else if (errors && typeof errors === "object") {
    for (const [field, messages] of Object.entries(errors)) {
      parts.push(`${field}: ${[].concat(messages).join(", ")}`);
    }
  }
  return [...new Set(parts.filter(Boolean))].join("; ");
};

/**
 * Client for the Wagepoint API, optionally scoped to one company. Every call gets a token from the
 * connection, so expired tokens are replaced automatically, and a 401 is retried once with a new
 * token.
 *
 * @param {WagepointClientConfig} config
 */
const createWagepointClient = (config) => {
  const { connection, companyId } = config ?? {};
  if (!connection?.getAccessToken) {
    throw new TypeError(
      "createWagepointClient: `connection` is required (from wagepoint.connect())",
    );
  }
  const baseUrl = (config.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = config.fetch ?? globalThis.fetch;

  const resolveUrl = (path, query) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
      throw new TypeError(`Use a path, not an absolute URL: ${path}`);
    }
    let url;
    if (path.startsWith("/")) {
      url = new URL(`${baseUrl}${path}`);
    } else {
      if (companyId === undefined || companyId === null || companyId === "") {
        throw new TypeError(
          "createWagepointClient: `companyId` is required for company calls",
        );
      }
      url = new URL(
        `${baseUrl}${RESOURCES.COMPANIES}/${encodeURIComponent(String(companyId))}/${path}`,
      );
    }
    const extra = toSearchParams(query).toString();
    if (extra) url.search = url.search ? `${url.search}&${extra}` : `?${extra}`;
    return url.toString();
  };

  /**
   * Send any request. Most code wants the helpers below; use this for anything they don't cover.
   *
   * @param {string} method
   * @param {string} path - `/v1/...` from the API root, or relative to the company (e.g. `"persons"`).
   * @param {{ query?: Record<string, unknown>, body?: unknown, headers?: Record<string, string> }} [options]
   * @returns {Promise<{ status: number, headers: Headers, data: any }>}
   */
  const request = async (method, path, { query, body, headers: extraHeaders } = {}) => {
    const url = resolveUrl(path, query);

    const send = async (token) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...extraHeaders,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      return fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };

    const token = await connection.getAccessToken();
    let response = await send(token);
    // Wagepoint's guidance: on 401, get a new token and retry. Safe for POSTs too, since time
    // entries carry an Idempotency-Key.
    if (response.status === 401 && connection.renew) {
      response = await send(await connection.renew(token));
    }

    const text = await response.text();
    const data = text ? parseBody(text) : undefined;

    if (!response.ok) {
      const detail = describeError(data) || response.statusText;
      throw new WagepointApiError(
        `Wagepoint ${method} ${url} failed (${response.status})${detail ? `: ${detail}` : ""}`,
        { status: response.status, method, url, detail, headers: response.headers, body: data },
      );
    }
    return { status: response.status, headers: response.headers, data };
  };

  /**
   * GET a resource and return its body as-is.
   * @param {string} path
   * @param {Record<string, unknown>} [query]
   */
  const get = async (path, query) => (await request("GET", path, { query })).data;

  /**
   * One page of a collection.
   * @param {string} path - e.g. `RESOURCES.PERSONS`.
   * @param {ListQuery & Record<string, unknown>} [query]
   * @returns {Promise<Page>}
   */
  const list = async (path, query) => {
    const data = await get(path, query);
    const pageInfo = data?.page_info ?? {};
    return {
      items: data?.items ?? [],
      after: pageInfo.after ?? null,
      hasMore: Boolean(pageInfo.has_more),
      pageSize: pageInfo.page_size,
    };
  };

  /**
   * Every record in a collection, page by page, following `page_info.after`. `pageSize` (default
   * 100) sets the page size, not a total limit; break out of the loop to stop early.
   * @param {string} path
   * @param {ListQuery & Record<string, unknown>} [query]
   * @returns {AsyncGenerator<Record<string, any>>}
   */
  async function* iterate(path, query = {}) {
    const firstQuery = { ...query, pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE };
    let page = await list(path, firstQuery);
    yield* page.items;
    while (page.hasMore && page.after) {
      page = await list(path, { ...firstQuery, after: page.after });
      yield* page.items;
    }
  }

  /**
   * Every record in a collection, as an array. Prefer `iterate` for big collections.
   * @param {string} path
   * @param {ListQuery & Record<string, unknown>} [query]
   */
  const all = async (path, query) => {
    const items = [];
    for await (const item of iterate(path, query)) items.push(item);
    return items;
  };

  /**
   * One page of the companies these credentials can access. Doesn't need `companyId`. Pick the
   * right one by a stable field such as `company_code`, not by position.
   * @param {ListQuery} [query]
   */
  const listCompanies = (query) => list(RESOURCES.COMPANIES, query);

  /**
   * One page of the company's people. Map them to your own records by `id`, never by name.
   * @param {ListQuery & Record<string, unknown>} [query]
   */
  const listPersons = (query) => list(RESOURCES.PERSONS, query);

  /**
   * Submit 1 to 100 time entries. Wagepoint answers 201 with the created entries.
   *
   * An `Idempotency-Key` is generated when you don't pass one. Store the returned key with the
   * batch: if the outcome is unknown (e.g. a network error), retry the exact same batch with the
   * same key so Wagepoint doesn't create duplicates.
   *
   * @param {TimeEntryInput[]} entries
   * @param {{ idempotencyKey?: string }} [options]
   * @returns {Promise<{ items: Array<Record<string, any>>, idempotencyKey: string }>}
   */
  const createTimeEntries = async (entries, { idempotencyKey = randomUUID() } = {}) => {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError("createTimeEntries: `entries` must be a non-empty array");
    }
    if (entries.length > MAX_TIME_ENTRIES_PER_REQUEST) {
      throw new TypeError(
        `createTimeEntries: at most ${MAX_TIME_ENTRIES_PER_REQUEST} entries per request (got ${entries.length}); split them into batches, each with its own idempotency key`,
      );
    }
    const { data } = await request("POST", RESOURCES.TIME_ENTRIES, {
      body: { entries },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    return { items: data?.items ?? [], idempotencyKey };
  };

  /**
   * Time entries worked between two dates, inclusive.
   * @param {{ fromDate: string, toDate: string, personIds?: Array<string | number> } & ListQuery & Record<string, unknown>} query
   *   Dates are `YYYY-MM-DD`. `personIds` filters to those people (sent as repeated `person_id`).
   * @returns {Promise<Page>}
   */
  const listTimeEntries = ({ fromDate, toDate, personIds, ...rest } = /** @type {any} */ ({})) => {
    if (!fromDate || !toDate) {
      throw new TypeError("listTimeEntries: `fromDate` and `toDate` are required");
    }
    return list(RESOURCES.TIME_ENTRIES, {
      from_date: fromDate,
      to_date: toDate,
      person_id: personIds,
      ...rest,
    });
  };

  return {
    companyId,
    request,
    get,
    list,
    iterate,
    all,
    listCompanies,
    listPersons,
    createTimeEntries,
    listTimeEntries,
  };
};

module.exports = { createWagepointClient };

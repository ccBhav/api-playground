const { API_BASE_URL } = require("./constants");
const { parseBody } = require("./body");
const { MyobApiError } = require("./errors");

/** @typedef {import("./auth").MyobConnection} MyobConnection */

/**
 * OData options are camelCase here and sent as `$top`, `$skip`, `$filter` and `$orderby`.
 * Any other key is sent as-is (e.g. `returnBody`, or `StartDate` for timesheets).
 * MYOB allows `top` up to 1000 and defaults to 400.
 *
 * @typedef {Object} ListQuery
 * @property {number} [top]
 * @property {number} [skip]
 * @property {string} [filter] - e.g. `"LastName eq 'Smith'"`.
 * @property {string} [orderBy] - e.g. `"LastModified desc"`.
 */

/**
 * @typedef {Object} Page
 * @property {Array<Record<string, any>>} items
 * @property {number | undefined} count - Total matching records, when MYOB sends it.
 * @property {string | null} nextPageLink - Absolute URL of the next page, or null on the last one.
 */

/**
 * @typedef {Object} MyobClientConfig
 * @property {MyobConnection} connection - From `createMyobAuth(...).connect(...)`.
 * @property {string} [businessId] - The company file. Needed for everything except `listCompanyFiles`.
 * @property {{ username: string, password: string }} [companyFileCredentials] - Only for company
 *   files that ask for their own login; sent as `x-myobapi-cftoken`.
 * @property {string} [baseUrl] - Defaults to `API_BASE_URL`.
 * @property {typeof fetch} [fetch] - Override for tests.
 */

const ODATA_KEYS = { top: "$top", skip: "$skip", filter: "$filter", orderBy: "$orderby" };

/**
 * `x-myobapi-cftoken` value: Base64 of `username:password` for the company file.
 * @param {{ username: string, password?: string }} credentials
 */
const encodeCfToken = ({ username, password = "" }) =>
  Buffer.from(`${username}:${password}`).toString("base64");

/**
 * Build the query string by hand: URLSearchParams would turn `$top` into `%24top` and spaces in
 * `$filter` into `+`, which is not what MYOB's docs show.
 */
const toQueryString = (query = {}) =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${ODATA_KEYS[key] ?? encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");

const describeErrors = (body) => {
  const errors = Array.isArray(body?.Errors) ? body.Errors : [];
  const summary = errors
    .map((e) => [e.Name, e.Message].filter(Boolean).join(": "))
    .filter(Boolean)
    .join("; ");
  return { errors, summary };
};

/**
 * Client for one company file. Every call gets fresh headers from the connection, so tokens are
 * refreshed automatically.
 *
 * @param {MyobClientConfig} config
 */
const createMyobClient = (config) => {
  const { connection, businessId, companyFileCredentials } = config ?? {};
  if (!connection?.headers) {
    throw new TypeError("createMyobClient: `connection` is required (from myob.connect())");
  }
  const baseUrl = (config.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
  const baseHost = new URL(baseUrl).hostname;
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const cfToken = companyFileCredentials ? encodeCfToken(companyFileCredentials) : undefined;

  // Absolute URLs (NextPageLink, Location, a company file's Uri) are followed only on MYOB hosts,
  // so the bearer token is never sent anywhere else.
  const isMyobHost = (url) =>
    url.protocol === "https:" &&
    (url.hostname === baseHost ||
      url.hostname === "myob.com" ||
      url.hostname.endsWith(".myob.com"));

  const resolveUrl = (path, query) => {
    let url;
    if (/^https?:\/\//i.test(path)) {
      url = new URL(path);
      if (!isMyobHost(url)) {
        throw new TypeError(`Refusing to send MYOB credentials to ${url.origin}`);
      }
    } else {
      if (!businessId) {
        throw new TypeError("createMyobClient: `businessId` is required for company-file calls");
      }
      url = new URL(`${baseUrl}/${businessId}/${path.replace(/^\/+/, "")}`);
    }
    const extra = toQueryString(query);
    if (extra) url.search = url.search ? `${url.search}&${extra}` : `?${extra}`;
    return url.toString();
  };

  /**
   * Send any request. Most code wants the helpers below; use this for anything they don't cover.
   *
   * @param {string} method
   * @param {string} path - Relative to the company file, or an absolute MYOB URL.
   * @param {{ query?: Record<string, unknown>, body?: unknown }} [options]
   * @returns {Promise<{ status: number, headers: Headers, data: any }>}
   */
  const request = async (method, path, { query, body } = {}) => {
    const url = resolveUrl(path, query);
    const headers = { ...(await connection.headers()) };
    if (cfToken) headers["x-myobapi-cftoken"] = cfToken;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? parseBody(text) : undefined;

    if (!response.ok) {
      const { errors, summary } = describeErrors(data);
      const detail = summary || (typeof data === "string" ? data : "") || response.statusText;
      throw new MyobApiError(`MYOB ${method} ${url} failed (${response.status}): ${detail}`, {
        status: response.status,
        method,
        url,
        errors,
        body: data,
      });
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
   * Company files this login can see. Doesn't need `businessId`.
   * @returns {Promise<Array<Record<string, any>>>}
   */
  const listCompanyFiles = () => get(`${baseUrl}/`);

  /**
   * One page of a collection.
   * @param {string} path - e.g. `RESOURCES.CUSTOMERS`, or a `nextPageLink`.
   * @param {ListQuery & Record<string, unknown>} [query]
   * @returns {Promise<Page>}
   */
  const list = async (path, query) => {
    const data = await get(path, query);
    return {
      items: data?.Items ?? [],
      count: data?.Count,
      nextPageLink: data?.NextPageLink ?? null,
    };
  };

  /**
   * Every record in a collection, page by page, following `NextPageLink`.
   * `top` sets the page size, not a total limit; break out of the loop to stop early.
   * @param {string} path
   * @param {ListQuery & Record<string, unknown>} [query]
   * @returns {AsyncGenerator<Record<string, any>>}
   */
  async function* iterate(path, query) {
    let page = await list(path, query);
    yield* page.items;
    while (page.nextPageLink) {
      page = await list(page.nextPageLink);
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
   * One record by UID.
   * @param {string} path
   * @param {string} uid
   */
  const getById = (path, uid) => get(`${path.replace(/\/+$/, "")}/${uid}`);

  /**
   * Create a record. MYOB answers 201 with the new record's URL in `Location`.
   * Pass `{ returnBody: true }` to also get the created record back in `data`.
   * @param {string} path
   * @param {Record<string, unknown>} body
   * @param {{ returnBody?: boolean }} [options]
   * @returns {Promise<{ uid: string | undefined, location: string | undefined, data: any }>}
   */
  const create = async (path, body, { returnBody } = {}) => {
    const response = await request("POST", path, {
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
   * update if someone changed the record since you read it.
   * @param {string} path
   * @param {string} uid
   * @param {Record<string, unknown>} body
   * @param {{ returnBody?: boolean }} [options]
   * @returns {Promise<any>} The updated record when `returnBody` is set, otherwise undefined.
   */
  const update = async (path, uid, body, { returnBody } = {}) =>
    (
      await request("PUT", `${path.replace(/\/+$/, "")}/${uid}`, {
        body,
        query: returnBody ? { returnBody: true } : undefined,
      })
    ).data;

  /**
   * Delete a record.
   * @param {string} path
   * @param {string} uid
   */
  const remove = async (path, uid) => {
    await request("DELETE", `${path.replace(/\/+$/, "")}/${uid}`);
  };

  return {
    businessId,
    request,
    get,
    listCompanyFiles,
    list,
    iterate,
    all,
    getById,
    create,
    update,
    remove,
  };
};

module.exports = { createMyobClient, encodeCfToken };

import { describe, test, expect, vi, afterEach } from "vitest";

const {
  createMyobClient,
  encodeCfToken,
  MyobApiError,
  MyobAbortError,
  MyobConflictError,
  MyobConnectionError,
  MyobInternalServerError,
  MyobNotFoundError,
  MyobRateLimitError,
  MyobTimeoutError,
  RESOURCES,
} = require("..");

const BASE = "https://api.myob.com/accountright";

const jsonResponse = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const connection = {
  headers: async () => ({
    Authorization: "Bearer access-1",
    "x-myobapi-key": "client-id",
    "x-myobapi-version": "v2",
    Accept: "application/json",
  }),
};

const setup = (responses = [], config = {}) => {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const api = createMyobClient({ connection, businessId: "biz-1", fetch, ...config });
  const call = (n = 0) => ({ url: fetch.mock.calls[n][0], ...fetch.mock.calls[n][1] });
  return { api, fetch, call };
};

describe("createMyobClient", () => {
  test("throws without a connection", () => {
    expect(() => createMyobClient({ businessId: "biz-1" })).toThrow(/connection/);
  });

  test("throws on company-file calls without a businessId", async () => {
    const { api } = setup([], { businessId: undefined });

    await expect(api.get("Company")).rejects.toThrow(/businessId/);
  });
});

describe("get", () => {
  test("sends the connection's headers to the company file", async () => {
    const { api, call } = setup([jsonResponse(200, { Name: "Clearwater" })]);

    const company = await api.get(RESOURCES.COMPANY);

    expect(company).toEqual({ Name: "Clearwater" });
    expect(call()).toMatchObject({
      url: `${BASE}/biz-1/Company`,
      method: "GET",
      body: undefined,
      headers: {
        Authorization: "Bearer access-1",
        "x-myobapi-key": "client-id",
        "x-myobapi-version": "v2",
      },
    });
    expect(call().headers).not.toHaveProperty("x-myobapi-cftoken");
  });

  test("adds the company-file token when credentials are given", async () => {
    const { api, call } = setup([jsonResponse(200, {})], {
      companyFileCredentials: { username: "Administrator", password: "" },
    });

    await api.get(RESOURCES.COMPANY);

    expect(call().headers["x-myobapi-cftoken"]).toBe(encodeCfToken({ username: "Administrator" }));
    expect(encodeCfToken({ username: "Administrator", password: "pw" })).toBe(
      Buffer.from("Administrator:pw").toString("base64"),
    );
  });

  test("refuses to send credentials to a non-MYOB host", async () => {
    const { api, fetch } = setup();

    await expect(api.get("https://evil.example.com/steal")).rejects.toThrow(/Refusing/);
    await expect(api.get("http://api.myob.com/accountright/")).rejects.toThrow(/Refusing/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("listCompanyFiles", () => {
  test("hits the API root and works without a businessId", async () => {
    const { api, call } = setup([jsonResponse(200, [{ Id: "biz-1" }])], {
      businessId: undefined,
    });

    expect(await api.listCompanyFiles()).toEqual([{ Id: "biz-1" }]);
    expect(call().url).toBe(`${BASE}/`);
  });
});

describe("list", () => {
  test("sends OData options with literal $ keys and percent-encoded values", async () => {
    const { api, call } = setup([jsonResponse(200, { Items: [], Count: 0, NextPageLink: null })]);

    await api.list(RESOURCES.CUSTOMERS, {
      top: 20,
      skip: 40,
      filter: "LastName eq 'O''Brien'",
      orderBy: "LastModified desc",
      skipped: undefined,
    });

    expect(call().url).toBe(
      `${BASE}/biz-1/Contact/Customer?$top=20&$skip=40` +
        `&$filter=LastName%20eq%20%27O%27%27Brien%27&$orderby=LastModified%20desc`,
    );
  });

  test("returns items, count and nextPageLink", async () => {
    const next = `${BASE}/biz-1/Contact/Customer?$top=1&$skip=1`;
    const { api } = setup([
      jsonResponse(200, { Items: [{ UID: "c1" }], Count: 2, NextPageLink: next }),
    ]);

    const page = await api.list(RESOURCES.CUSTOMERS, { top: 1 });

    expect(page).toMatchObject({ items: [{ UID: "c1" }], count: 2, nextPageLink: next });
    expect(page.response.status).toBe(200);
  });
});

describe("iterate / all", () => {
  test("follows NextPageLink until it runs out", async () => {
    const page2 = "https://arl2.api.myob.com/accountright/biz-1/Contact/Customer?$top=2&$skip=2";
    const { api, fetch, call } = setup([
      jsonResponse(200, { Items: [{ UID: "c1" }, { UID: "c2" }], NextPageLink: page2 }),
      jsonResponse(200, { Items: [{ UID: "c3" }], NextPageLink: null }),
    ]);

    const customers = await api.all(RESOURCES.CUSTOMERS, { top: 2 });

    expect(customers.map((c) => c.UID)).toEqual(["c1", "c2", "c3"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(call(1).url).toBe(page2);
  });

  test("stops fetching when the caller breaks early", async () => {
    const { api, fetch } = setup([
      jsonResponse(200, { Items: [{ UID: "c1" }], NextPageLink: `${BASE}/biz-1/next` }),
    ]);

    for await (const customer of api.iterate(RESOURCES.CUSTOMERS)) {
      expect(customer.UID).toBe("c1");
      break;
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("retrieve / create / update / delete", () => {
  test("retrieve appends the UID", async () => {
    const { api, call } = setup([jsonResponse(200, { UID: "c1" })]);

    await api.retrieve(`${RESOURCES.CUSTOMERS}/`, "c1");

    expect(call().url).toBe(`${BASE}/biz-1/Contact/Customer/c1`);
  });

  test("create posts JSON and reads the new UID from Location", async () => {
    const location = `${BASE}/biz-1/Contact/Customer/new-uid`;
    const { api, call } = setup([jsonResponse(201, undefined, { Location: location })]);

    const result = await api.create(RESOURCES.CUSTOMERS, { CompanyName: "Acme" });

    expect(result).toEqual({ uid: "new-uid", location, data: undefined });
    expect(call()).toMatchObject({
      url: `${BASE}/biz-1/Contact/Customer`,
      method: "POST",
      body: JSON.stringify({ CompanyName: "Acme" }),
    });
    expect(call().headers["Content-Type"]).toBe("application/json");
  });

  test("create with returnBody asks MYOB for the record", async () => {
    const { api, call } = setup([
      jsonResponse(201, { UID: "new-uid" }, { Location: `${BASE}/biz-1/Contact/Customer/new-uid` }),
    ]);

    const result = await api.create(RESOURCES.CUSTOMERS, {}, { returnBody: true });

    expect(call().url).toBe(`${BASE}/biz-1/Contact/Customer?returnBody=true`);
    expect(result.data).toEqual({ UID: "new-uid" });
  });

  test("update PUTs to the record", async () => {
    const { api, call } = setup([jsonResponse(200, undefined)]);
    const body = { UID: "c1", RowVersion: "123", CompanyName: "Acme" };

    expect(await api.update(RESOURCES.CUSTOMERS, "c1", body)).toBeUndefined();
    expect(call()).toMatchObject({
      url: `${BASE}/biz-1/Contact/Customer/c1`,
      method: "PUT",
      body: JSON.stringify(body),
    });
  });

  test("delete DELETEs the record", async () => {
    const { api, call } = setup([jsonResponse(200, undefined)]);

    await api.delete(RESOURCES.CUSTOMERS, "c1");

    expect(call()).toMatchObject({ url: `${BASE}/biz-1/Contact/Customer/c1`, method: "DELETE" });
  });
});

describe("errors", () => {
  test("maps MYOB's Errors array to MyobApiError", async () => {
    const body = {
      Errors: [
        { Name: "OAuthTokenIsInvalid", Message: "The supplied OAuth token is not valid", ErrorCode: 31001 },
      ],
    };
    const { api } = setup([jsonResponse(401, body)]);

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error).toBeInstanceOf(MyobApiError);
    expect(error).toMatchObject({
      status: 401,
      method: "GET",
      url: `${BASE}/biz-1/Company`,
      errors: body.Errors,
      body,
    });
    expect(error.message).toMatch(/OAuthTokenIsInvalid: The supplied OAuth token is not valid/);
  });

  test("keeps a non-JSON error body", async () => {
    const { api } = setup([new Response("Service Unavailable", { status: 503 })], { maxRetries: 0 });

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error).toMatchObject({ status: 503, errors: [], body: "Service Unavailable" });
  });
});

/** Run a request to completion under fake timers, so retry waits take no real time. */
const settle = async (promise) => {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return result;
};

describe("defaults", () => {
  test("sends a User-Agent naming the SDK and Node versions", async () => {
    const { api, call } = setup([jsonResponse(200, {})]);

    await api.get(RESOURCES.COMPANY);

    expect(call().headers["User-Agent"]).toMatch(/^myob-sdk\/\d+\.\d+\.\d+ node\/\d+/);
  });

  test("adds per-request headers", async () => {
    const { api, call } = setup([jsonResponse(200, {})]);

    await api.get(RESOURCES.COMPANY, undefined, { headers: { "x-trace": "abc" } });

    expect(call().headers["x-trace"]).toBe("abc");
  });

  test("encodes the UID and names a missing one", async () => {
    const { api, call } = setup([jsonResponse(200, {})]);

    await api.retrieve(RESOURCES.CUSTOMERS, "a/b");

    expect(call().url).toBe(`${BASE}/biz-1/Contact/Customer/a%2Fb`);
    await expect(api.retrieve(RESOURCES.CUSTOMERS)).rejects.toThrow(/`uid`/);
  });

  test("warns about unknown options, suggesting the closest one", () => {
    const warn = vi.fn();

    createMyobClient({ connection, businessId: "biz-1", timout: 5, logger: { warn } });

    expect(warn).toHaveBeenCalledWith('createMyobClient: unknown option "timout" (did you mean "timeoutMs"?)', undefined);
  });

  test("builds the connection from auth + tokens and takes businessId from the tokens", async () => {
    const auth = { connect: vi.fn(() => connection) };
    const onRefresh = vi.fn();
    const tokens = { refreshToken: "r", businessId: "biz-9" };
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse(200, {}));

    const api = createMyobClient({ auth, tokens, onRefresh, fetch });
    await api.get(RESOURCES.COMPANY);

    expect(auth.connect).toHaveBeenCalledWith({ tokens, onRefresh, skewSeconds: undefined });
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/biz-9/Company`);
  });

  test("names both ways to pass auth when neither is given", () => {
    expect(() => createMyobClient({ auth: { connect: vi.fn() } })).toThrow(/`tokens` is required/);
  });
});

describe("timeouts and cancellation", () => {
  const hang = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  test("throws MyobTimeoutError when MYOB doesn't answer in time", async () => {
    const { api, fetch } = setup([], { timeoutMs: 20, maxRetries: 0 });
    fetch.mockImplementation(hang);

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error).toBeInstanceOf(MyobTimeoutError);
    expect(error).toBeInstanceOf(MyobConnectionError);
    expect(error.timeoutMs).toBe(20);
  });

  test("throws MyobAbortError, without retrying, when the caller aborts", async () => {
    const { api, fetch } = setup();
    fetch.mockImplementation(hang);
    const controller = new AbortController();

    const pending = api.get(RESOURCES.COMPANY, undefined, { signal: controller.signal }).catch((e) => e);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();

    expect(await pending).toBeInstanceOf(MyobAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("doesn't call MYOB at all with an already-aborted signal", async () => {
    const { api, fetch } = setup();

    const error = await api.get(RESOURCES.COMPANY, undefined, { signal: AbortSignal.abort() }).catch((e) => e);

    expect(error).toBeInstanceOf(MyobAbortError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("retries", () => {
  afterEach(() => vi.useRealTimers());

  test("retries a GET on 5xx and connection errors, then succeeds", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([new Response("busy", { status: 503 })]);
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetch.mockResolvedValueOnce(jsonResponse(200, { Name: "Clearwater" }));

    const { value } = await settle(api.get(RESOURCES.COMPANY));

    expect(value).toEqual({ Name: "Clearwater" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("gives up after maxRetries with a typed error", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([
      new Response("down", { status: 500 }),
      new Response("down", { status: 500 }),
      new Response("down", { status: 500 }),
    ]);

    const { error } = await settle(api.get(RESOURCES.COMPANY));

    expect(error).toBeInstanceOf(MyobInternalServerError);
    expect(error.retryable).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("waits for Retry-After on a 429", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([
      jsonResponse(429, {}, { "Retry-After": "5" }),
      jsonResponse(200, {}),
    ]);

    const pending = api.get(RESOURCES.COMPANY);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("treats MYOB's 403 over-QPS answer as a rate limit", async () => {
    const { api } = setup([new Response("Developer Over Qps", { status: 403 })], { maxRetries: 0 });

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error).toBeInstanceOf(MyobRateLimitError);
  });

  test("retries a POST only when it was rate limited", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([
      jsonResponse(429, {}),
      jsonResponse(500, {}),
    ]);

    const { error } = await settle(api.create(RESOURCES.CUSTOMERS, {}));

    expect(error).toBeInstanceOf(MyobInternalServerError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("never resends a POST after a connection error", async () => {
    const { api, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("ECONNRESET") }));

    const error = await api.create(RESOURCES.CUSTOMERS, {}).catch((e) => e);

    expect(error).toBeInstanceOf(MyobConnectionError);
    expect(error.message).toMatch(/ECONNRESET/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("does not retry a stale RowVersion conflict", async () => {
    const { api, fetch } = setup([jsonResponse(409, { Errors: [{ Name: "RowVersionMismatch" }] })]);

    const error = await api.update(RESOURCES.CUSTOMERS, "c1", { UID: "c1" }).catch((e) => e);

    expect(error).toBeInstanceOf(MyobConflictError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("401 refresh", () => {
  const body = { Errors: [{ Name: "OAuthTokenIsInvalid", Message: "Token is not valid" }] };

  const refreshingConnection = () => {
    let token = "access-1";
    return {
      headers: async () => ({ Authorization: `Bearer ${token}` }),
      forceRefresh: vi.fn(async () => {
        token = "access-2";
        return token;
      }),
    };
  };

  test("refreshes once and resends with the new token", async () => {
    const conn = refreshingConnection();
    const { api, call } = setup([jsonResponse(401, body), jsonResponse(200, { ok: true })], { connection: conn });

    expect(await api.get(RESOURCES.COMPANY)).toEqual({ ok: true });
    expect(conn.forceRefresh).toHaveBeenCalledWith("access-1");
    expect(call(1).headers.Authorization).toBe("Bearer access-2");
  });

  test("gives up if the new token is rejected too", async () => {
    const conn = refreshingConnection();
    const { api, fetch } = setup([jsonResponse(401, body), jsonResponse(401, body)], { connection: conn });

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error.status).toBe(401);
    expect(conn.forceRefresh).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("error details", () => {
  test("carries the code, request ID and headers, and picks the subclass", async () => {
    const { api } = setup([
      jsonResponse(404, { Errors: [{ Name: "ResourceNotFound", Message: "No such customer" }] }, { "x-request-id": "req-1" }),
    ]);

    const error = await api.retrieve(RESOURCES.CUSTOMERS, "c1").catch((e) => e);

    expect(error).toBeInstanceOf(MyobNotFoundError);
    expect(error).toBeInstanceOf(MyobApiError);
    expect(error).toMatchObject({ name: "MyobNotFoundError", code: "ResourceNotFound", requestId: "req-1" });
    expect(error.headers.get("x-request-id")).toBe("req-1");
    expect(error.message).toMatch(/\(404\): ResourceNotFound: No such customer \(request_id: req-1\)/);
  });
});

describe("custom baseUrl", () => {
  test("follows absolute URLs on the configured base URL's origin, even over http", async () => {
    const local = "http://localhost:3000/accountright";
    const { api, call } = setup(
      [
        jsonResponse(200, [{ Id: "f1" }]),
        jsonResponse(200, { Items: [{ UID: "1" }], NextPageLink: `${local}/biz-1/Contact?$skip=1` }),
        jsonResponse(200, { Items: [{ UID: "2" }], NextPageLink: null }),
      ],
      { baseUrl: local },
    );

    expect(await api.listCompanyFiles()).toEqual([{ Id: "f1" }]);
    expect(await api.all("Contact")).toEqual([{ UID: "1" }, { UID: "2" }]);
    expect(call(2).url).toBe(`${local}/biz-1/Contact?$skip=1`);
  });

  test("still refuses other http origins", async () => {
    const { api } = setup([], { baseUrl: "http://localhost:3000/accountright" });

    await expect(api.get("http://localhost:4000/accountright/")).rejects.toThrow(/Refusing/);
  });
});

describe("retries whose earlier attempt may have worked", () => {
  afterEach(() => vi.useRealTimers());

  test("a DELETE that gets 404 after a retry counts as deleted", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([new Response("busy", { status: 503 }), jsonResponse(404, {})]);

    const { value, error } = await settle(api.delete(RESOURCES.CUSTOMERS, "c1"));

    expect(error).toBeUndefined();
    expect(value).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a DELETE that gets 404 on its first attempt still throws", async () => {
    const { api } = setup([jsonResponse(404, {})]);

    await expect(api.delete(RESOURCES.CUSTOMERS, "c1")).rejects.toBeInstanceOf(MyobNotFoundError);
  });

  test("a PUT conflict after a lost attempt is flagged afterRetry", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup();
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    fetch.mockResolvedValueOnce(jsonResponse(409, { Errors: [{ Name: "RowVersionMismatch" }] }));

    const { error } = await settle(api.update(RESOURCES.CUSTOMERS, "c1", { UID: "c1" }));

    expect(error).toBeInstanceOf(MyobConflictError);
    expect(error.afterRetry).toBe(true);
    expect(error.message).toMatch(/after a retry/);
  });

  test("a conflict after a rate-limit retry is not flagged, since MYOB never processed the first", async () => {
    vi.useFakeTimers();
    const { api } = setup([jsonResponse(429, {}), jsonResponse(409, {})]);

    const { error } = await settle(api.update(RESOURCES.CUSTOMERS, "c1", { UID: "c1" }));

    expect(error.afterRetry).toBe(false);
  });
});

describe("rate limiting", () => {
  afterEach(() => vi.useRealTimers());

  test("paces requests to the configured rate", async () => {
    vi.useFakeTimers();
    const { api, fetch } = setup([jsonResponse(200, {}), jsonResponse(200, {}), jsonResponse(200, {})], {
      rateLimit: { requestsPerSecond: 2, burst: 1 },
    });

    const all = Promise.all([api.get("A"), api.get("B"), api.get("C")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    await all;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  test("uses the connection's shared limiter by default", async () => {
    const acquire = vi.fn(async () => {});
    const { api } = setup([jsonResponse(200, {})], { connection: { ...connection, rateLimiter: { acquire } } });

    await api.get("A");

    expect(acquire).toHaveBeenCalledTimes(1);
  });

  test("an abort while waiting for a slot rejects with MyobAbortError", async () => {
    const { api, fetch } = setup([jsonResponse(200, {})], { rateLimit: { requestsPerSecond: 1, burst: 1 } });
    await api.get("A");
    const controller = new AbortController();

    const pending = api.get("B", undefined, { signal: controller.signal }).catch((e) => e);
    controller.abort();

    expect(await pending).toBeInstanceOf(MyobAbortError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("hooks and raw responses", () => {
  test("onRequest can add headers and share state with onResponse", async () => {
    const seen = [];
    const { api, call } = setup([jsonResponse(200, {}, { "x-request-id": "r1" })], {
      hooks: {
        onRequest: (ctx) => {
          ctx.state.span = "span-1";
          ctx.setHeader("traceparent", "00-abc-def-01");
        },
        onResponse: (ctx) => seen.push([ctx.state.span, ctx.status, ctx.attempt, ctx.headers.get("x-request-id")]),
      },
    });

    await api.get("A");

    expect(call().headers.traceparent).toBe("00-abc-def-01");
    expect(seen).toEqual([["span-1", 200, 1, "r1"]]);
  });

  test("onError sees connection errors, once per attempt", async () => {
    const onError = vi.fn();
    const { api, fetch } = setup([], { hooks: { onError }, maxRetries: 0 });
    fetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(api.get("A")).rejects.toBeInstanceOf(MyobConnectionError);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, error: expect.any(MyobConnectionError) }));
  });

  test("a throwing hook is logged, not fatal", async () => {
    const logger = { warn: vi.fn() };
    const { api } = setup([jsonResponse(200, { ok: true })], {
      logger,
      hooks: { onRequest: () => { throw new Error("boom"); } },
    });

    expect(await api.get("A")).toEqual({ ok: true });
    expect(logger.warn.mock.calls[0][0]).toMatch(/onRequest hook threw: boom/);
  });

  test("onResponse gives the raw response for any method", async () => {
    const { api } = setup([jsonResponse(200, { UID: "c1" }, { "x-request-id": "r9" })]);
    let raw;

    await api.customers.retrieve("c1", { onResponse: (response) => (raw = response) });

    expect(raw.status).toBe(200);
    expect(raw.headers.get("x-request-id")).toBe("r9");
  });

  test("appName is appended to the User-Agent", async () => {
    const { api, call } = setup([jsonResponse(200, {})], { appName: "constructionclock/2.0" });

    await api.get("A");

    expect(call().headers["User-Agent"]).toMatch(/^myob-sdk\/\S+ node\/\S+ constructionclock\/2\.0$/);
  });

  test("a custom fetch's own TimeoutError becomes MyobTimeoutError", async () => {
    const { api, fetch } = setup([], { maxRetries: 0 });
    fetch.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    await expect(api.get("A")).rejects.toBeInstanceOf(MyobTimeoutError);
  });
});

describe("typed resources", () => {
  test("each resource maps to its path", async () => {
    const { api, call } = setup([
      jsonResponse(200, { Items: [{ UID: "e1" }], NextPageLink: null, Count: 1 }),
      jsonResponse(200, { UID: "e1" }),
      jsonResponse(201, undefined, { Location: `${BASE}/biz-1/GeneralLedger/Job/j1` }),
      jsonResponse(200, undefined),
      jsonResponse(200, undefined),
    ]);

    const page = await api.employees.list({ top: 5 });
    await api.employees.retrieve("e1");
    const created = await api.jobs.create({ Number: "100", Name: "Fit-out" });
    await api.jobs.update("j1", { UID: "j1", RowVersion: "1" });
    await api.payrollCategories.delete("p1");

    expect(page.items).toEqual([{ UID: "e1" }]);
    expect(call(0).url).toBe(`${BASE}/biz-1/Contact/Employee?$top=5`);
    expect(call(1).url).toBe(`${BASE}/biz-1/Contact/Employee/e1`);
    expect(call(2)).toMatchObject({ url: `${BASE}/biz-1/GeneralLedger/Job`, method: "POST" });
    expect(created.uid).toBe("j1");
    expect(call(3)).toMatchObject({ url: `${BASE}/biz-1/GeneralLedger/Job/j1`, method: "PUT" });
    expect(call(4)).toMatchObject({ url: `${BASE}/biz-1/Payroll/PayrollCategory/p1`, method: "DELETE" });
    expect(api.employees.path).toBe(RESOURCES.EMPLOYEES);
  });

  test("timesheets are addressed by employee and period", async () => {
    const { api, call } = setup([
      jsonResponse(200, { Items: [], NextPageLink: null }),
      jsonResponse(200, { Employee: { UID: "e1" } }),
      jsonResponse(200, undefined),
    ]);
    const period = { startDate: "2026-10-12T00:00:00", endDate: "2026-10-18T00:00:00" };

    await api.timesheets.list({ ...period, top: 100 });
    await api.timesheets.retrieve("e1", period);
    await api.timesheets.update("e1", { Employee: { UID: "e1" }, StartDate: period.startDate, EndDate: period.endDate, Lines: [] });

    expect(call(0).url).toBe(
      `${BASE}/biz-1/Payroll/Timesheet?$top=100&StartDate=2026-10-12T00%3A00%3A00&EndDate=2026-10-18T00%3A00%3A00`,
    );
    expect(call(1).url).toBe(
      `${BASE}/biz-1/Payroll/Timesheet/e1?StartDate=2026-10-12T00%3A00%3A00&EndDate=2026-10-18T00%3A00%3A00`,
    );
    expect(call(2)).toMatchObject({ url: `${BASE}/biz-1/Payroll/Timesheet/e1`, method: "PUT" });
  });

  test("timesheets need a period", async () => {
    const { api } = setup();

    await expect(api.timesheets.list({ startDate: "2026-10-12T00:00:00" })).rejects.toThrow(/endDate/);
    await expect(api.timesheets.retrieve("e1")).rejects.toThrow(/startDate/);
  });

  test("company.retrieve reads the company file's details", async () => {
    const { api, call } = setup([jsonResponse(200, { Name: "Clearwater" })]);

    expect(await api.company.retrieve()).toEqual({ Name: "Clearwater" });
    expect(call().url).toBe(`${BASE}/biz-1/Company`);
  });

  test("the deprecated getById and remove aliases are gone", () => {
    const { api } = setup();

    expect(api).not.toHaveProperty("getById");
    expect(api).not.toHaveProperty("remove");
  });
});

import { describe, test, expect, vi } from "vitest";

const { createWagepointClient, WagepointApiError, RESOURCES } = require("..");

const BASE = "https://api.wagepoint.com";

const jsonResponse = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const page = (items, { after = null, hasMore = false, pageSize = 100 } = {}) => ({
  items,
  page_info: { after, page_size: pageSize, has_more: hasMore },
});

const makeConnection = () => {
  let token = "access-1";
  return {
    getAccessToken: vi.fn(async () => token),
    renew: vi.fn(async () => {
      token = "access-2";
      return token;
    }),
  };
};

const setup = (responses = [], config = {}) => {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const connection = makeConnection();
  const api = createWagepointClient({ connection, companyId: 38715, fetch, ...config });
  const call = (n = 0) => ({ url: fetch.mock.calls[n][0], ...fetch.mock.calls[n][1] });
  return { api, fetch, call, connection };
};

describe("createWagepointClient", () => {
  test("throws without a connection", () => {
    expect(() => createWagepointClient({ companyId: 1 })).toThrow(/connection/);
  });

  test("throws on company calls without a companyId", async () => {
    const { api } = setup([], { companyId: undefined });

    await expect(api.get(RESOURCES.PERSONS)).rejects.toThrow(/companyId/);
  });

  test("refuses absolute URLs", async () => {
    const { api } = setup();

    await expect(api.get("https://evil.example/v1/companies")).rejects.toThrow(/absolute URL/);
  });
});

describe("listCompanies", () => {
  test("calls /v1/companies without a companyId and returns a page", async () => {
    const company = { id: 38715, name: "Example Company", company_code: "ABC1234" };
    const { api, call } = setup([jsonResponse(200, page([company]))], { companyId: undefined });

    const result = await api.listCompanies();

    expect(result).toEqual({ items: [company], after: null, hasMore: false, pageSize: 100 });
    expect(call()).toMatchObject({
      url: `${BASE}/v1/companies`,
      method: "GET",
      body: undefined,
      headers: { Authorization: "Bearer access-1", Accept: "application/json" },
    });
    expect(call().headers).not.toHaveProperty("Content-Type");
  });
});

describe("listPersons", () => {
  test("sends page_size and the cursor under the company", async () => {
    const { api, call } = setup([jsonResponse(200, page([]))]);

    await api.listPersons({ pageSize: 50, after: "abc==" });

    expect(call().url).toBe(`${BASE}/v1/companies/38715/persons?page_size=50&after=abc%3D%3D`);
  });
});

describe("iterate / all", () => {
  test("follows page_info.after, keeping page_size the same", async () => {
    const { api, call, fetch } = setup([
      jsonResponse(200, page([{ id: 1 }, { id: 2 }], { after: "c1", hasMore: true })),
      jsonResponse(200, page([{ id: 3 }], { after: null, hasMore: false })),
    ]);

    const people = await api.all(RESOURCES.PERSONS);

    expect(people.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(call(0).url).toBe(`${BASE}/v1/companies/38715/persons?page_size=100`);
    expect(call(1).url).toBe(`${BASE}/v1/companies/38715/persons?page_size=100&after=c1`);
  });

  test("stops early when the caller breaks", async () => {
    const { api, fetch } = setup([
      jsonResponse(200, page([{ id: 1 }, { id: 2 }], { after: "c1", hasMore: true })),
    ]);

    for await (const person of api.iterate(RESOURCES.PERSONS)) {
      if (person.id === 1) break;
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("createTimeEntries", () => {
  const entry = { person_id: 12345, work_date: "2026-08-25", hours: 8, notes: "Shift" };

  test("posts the batch with an Idempotency-Key and returns the created items", async () => {
    const created = { id: 99101, ...entry, status: "pending" };
    const { api, call } = setup([jsonResponse(201, { items: [created] })]);

    const result = await api.createTimeEntries([entry], { idempotencyKey: "key-1" });

    expect(result).toEqual({ items: [created], idempotencyKey: "key-1" });
    expect(call()).toMatchObject({
      url: `${BASE}/v1/companies/38715/time-entries`,
      method: "POST",
      headers: {
        Authorization: "Bearer access-1",
        "Content-Type": "application/json",
        "Idempotency-Key": "key-1",
      },
    });
    expect(JSON.parse(call().body)).toEqual({ entries: [entry] });
  });

  test("generates an idempotency key when none is given", async () => {
    const { api, call } = setup([jsonResponse(201, { items: [] })]);

    const { idempotencyKey } = await api.createTimeEntries([entry]);

    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(call().headers["Idempotency-Key"]).toBe(idempotencyKey);
  });

  test("rejects empty and oversized batches without calling Wagepoint", async () => {
    const { api, fetch } = setup();

    await expect(api.createTimeEntries([])).rejects.toThrow(/non-empty/);
    await expect(api.createTimeEntries(Array(101).fill(entry))).rejects.toThrow(/at most 100/);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("retries a 401 once with a new token and the same idempotency key", async () => {
    const { api, call, connection } = setup([
      jsonResponse(401, { message: "Unauthorized" }),
      jsonResponse(201, { items: [{ id: 1 }] }),
    ]);

    await api.createTimeEntries([entry], { idempotencyKey: "key-1" });

    expect(connection.renew).toHaveBeenCalledWith("access-1");
    expect(call(1).headers).toMatchObject({
      Authorization: "Bearer access-2",
      "Idempotency-Key": "key-1",
    });
    expect(call(1).body).toBe(call(0).body);
  });
});

describe("listTimeEntries", () => {
  test("sends the date range and repeats person_id", async () => {
    const { api, call } = setup([jsonResponse(200, { items: [{ id: 1 }] })]);

    const result = await api.listTimeEntries({
      fromDate: "2026-08-25",
      toDate: "2026-08-31",
      personIds: [12345, 67890],
    });

    expect(result.items).toEqual([{ id: 1 }]);
    expect(result.hasMore).toBe(false);
    expect(call().url).toBe(
      `${BASE}/v1/companies/38715/time-entries?from_date=2026-08-25&to_date=2026-08-31&person_id=12345&person_id=67890`,
    );
  });

  test("requires both dates", () => {
    const { api } = setup();

    expect(() => api.listTimeEntries({ fromDate: "2026-08-25" })).toThrow(/toDate/);
  });
});

describe("errors", () => {
  test("throws WagepointApiError with a readable detail and the response headers", async () => {
    const { api } = setup([
      jsonResponse(
        400,
        { title: "Validation failed", errors: { "entries[0].hours": ["Must be positive"] } },
        { "X-Correlation-Id": "corr-1" },
      ),
    ]);

    const error = await api.listPersons().catch((e) => e);

    expect(error).toBeInstanceOf(WagepointApiError);
    expect(error).toMatchObject({
      status: 400,
      method: "GET",
      url: `${BASE}/v1/companies/38715/persons`,
      detail: "Validation failed; entries[0].hours: Must be positive",
    });
    expect(error.headers.get("x-correlation-id")).toBe("corr-1");
  });

  test("gives up after one 401 retry", async () => {
    const { api, fetch } = setup([
      jsonResponse(401, { message: "Unauthorized" }),
      jsonResponse(401, { message: "Still unauthorized" }),
    ]);

    const error = await api.listCompanies().catch((e) => e);

    expect(error).toMatchObject({ status: 401, detail: "Still unauthorized" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("keeps a non-JSON error body as text", async () => {
    const { api } = setup([new Response("upstream down", { status: 503, statusText: "Unavailable" })]);

    const error = await api.listPersons().catch((e) => e);

    expect(error).toMatchObject({ status: 503, body: "upstream down", detail: "upstream down" });
  });
});

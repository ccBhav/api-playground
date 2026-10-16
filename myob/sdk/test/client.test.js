import { describe, test, expect, vi } from "vitest";

const { createMyobClient, encodeCfToken, MyobApiError, RESOURCES } = require("..");

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

    expect(await api.list(RESOURCES.CUSTOMERS, { top: 1 })).toEqual({
      items: [{ UID: "c1" }],
      count: 2,
      nextPageLink: next,
    });
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

describe("getById / create / update / remove", () => {
  test("getById appends the UID", async () => {
    const { api, call } = setup([jsonResponse(200, { UID: "c1" })]);

    await api.getById(`${RESOURCES.CUSTOMERS}/`, "c1");

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

  test("remove DELETEs the record", async () => {
    const { api, call } = setup([jsonResponse(200, undefined)]);

    await api.remove(RESOURCES.CUSTOMERS, "c1");

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
    const { api } = setup([new Response("Service Unavailable", { status: 503 })]);

    const error = await api.get(RESOURCES.COMPANY).catch((e) => e);

    expect(error).toMatchObject({ status: 503, errors: [], body: "Service Unavailable" });
  });
});

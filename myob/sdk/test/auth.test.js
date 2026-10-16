import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { createMyobAuth, MyobAuthError, SCOPES, isExpired } = require("..");

const NOW = new Date("2026-10-13T00:00:00.000Z").getTime();

const tokenBody = (overrides = {}) => ({
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: "1200",
  token_type: "bearer",
  scope: "sme-company-file",
  ...overrides,
});

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const setup = (...responses) => {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const myob = createMyobAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://localhost:8080/callback",
    scopes: [SCOPES.COMPANY_FILE, SCOPES.SALES],
    fetch,
  });
  const sentForm = (call = 0) =>
    Object.fromEntries(new URLSearchParams(fetch.mock.calls[call][1].body));
  return { myob, fetch, sentForm };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMyobAuth", () => {
  test("throws when required config is missing", () => {
    expect(() => createMyobAuth({ clientId: "x", redirectUri: "y" })).toThrow(
      /clientSecret/,
    );
  });
});

describe("getAuthorizeUrl", () => {
  test("builds the MYOB authorize URL with encoded params", () => {
    const { myob } = setup();

    const url = new URL(myob.getAuthorizeUrl({ state: "abc 123" }));

    expect(url.origin + url.pathname).toBe(
      "https://secure.myob.com/oauth2/account/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "http://localhost:8080/callback",
      response_type: "code",
      scope: "sme-company-file sme-sales",
      prompt: "consent",
      state: "abc 123",
    });
  });

  test("omits prompt when null", () => {
    const { myob } = setup();

    const url = new URL(myob.getAuthorizeUrl({ prompt: null }));

    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.has("state")).toBe(false);
  });
});

describe("exchangeCode", () => {
  test("posts the authorization_code grant and returns camelCase tokens", async () => {
    const { myob, fetch, sentForm } = setup(jsonResponse(200, tokenBody()));

    const tokens = await myob.exchangeCode("the-code");

    expect(fetch.mock.calls[0][0]).toBe("https://secure.myob.com/oauth2/v1/authorize");
    expect(fetch.mock.calls[0][1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(sentForm()).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "http://localhost:8080/callback",
      scope: "sme-company-file sme-sales",
    });
    expect(tokens).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(NOW + 1200 * 1000),
      scope: "sme-company-file",
      tokenType: "bearer",
    });
  });

  test("maps an OAuth error response to MyobAuthError", async () => {
    const { myob } = setup(
      jsonResponse(400, { error: "invalid_grant", error_description: "Code expired" }),
    );

    const error = await myob.exchangeCode("old-code").catch((e) => e);

    expect(error).toBeInstanceOf(MyobAuthError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_grant",
      description: "Code expired",
    });
  });

  test("keeps a non-JSON error body", async () => {
    const { myob } = setup(new Response("Bad Gateway", { status: 502 }));

    const error = await myob.exchangeCode("c").catch((e) => e);

    expect(error).toMatchObject({ status: 502, code: undefined, body: "Bad Gateway" });
  });
});

describe("refresh", () => {
  test("posts the refresh_token grant", async () => {
    const { myob, sentForm } = setup(
      jsonResponse(200, tokenBody({ access_token: "access-2", refresh_token: "refresh-2" })),
    );

    const tokens = await myob.refresh("refresh-1");

    expect(sentForm()).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    expect(tokens.refreshToken).toBe("refresh-2");
  });
});

describe("handleCallback", () => {
  test("accepts an Express-style query object", async () => {
    const { myob, sentForm } = setup(jsonResponse(200, tokenBody()));

    const result = await myob.handleCallback({
      code: "the-code",
      businessId: "biz-1",
      state: "s1",
    });

    expect(sentForm().code).toBe("the-code");
    expect(result).toMatchObject({
      businessId: "biz-1",
      state: "s1",
      tokens: { accessToken: "access-1" },
    });
  });

  test("accepts a URL string and decodes an escaped code", async () => {
    const { myob, sentForm } = setup(jsonResponse(200, tokenBody()));

    await myob.handleCallback("/callback?code=a%2Bb%3D&businessId=biz-1");

    expect(sentForm().code).toBe("a+b=");
  });

  test("throws MyobAuthError when MYOB redirects with an error", async () => {
    const { myob, fetch } = setup();

    const error = await myob
      .handleCallback(new URLSearchParams({ error: "access_denied" }))
      .catch((e) => e);

    expect(error).toBeInstanceOf(MyobAuthError);
    expect(error.code).toBe("access_denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("throws when there is no code", async () => {
    const { myob } = setup();

    await expect(myob.handleCallback({})).rejects.toThrow(/no `code`/);
  });
});

describe("isExpired", () => {
  test("treats tokens inside the skew window as expired", () => {
    const tokens = { accessToken: "a", expiresAt: new Date(NOW + 30_000) };

    expect(isExpired(tokens)).toBe(true);
    expect(isExpired(tokens, { skewSeconds: 0 })).toBe(false);
  });

  test("accepts expiresAt as an ISO string, as stored in a database", () => {
    expect(
      isExpired({ accessToken: "a", expiresAt: new Date(NOW + 600_000).toISOString() }),
    ).toBe(false);
  });

  test("is expired when expiresAt is missing or invalid", () => {
    expect(isExpired({ accessToken: "a" })).toBe(true);
    expect(isExpired({ accessToken: "a", expiresAt: "nope" })).toBe(true);
    expect(isExpired(null)).toBe(true);
  });
});

describe("connect", () => {
  const fresh = {
    accessToken: "stored-access",
    refreshToken: "stored-refresh",
    expiresAt: new Date(NOW + 600_000),
  };
  const expired = { ...fresh, expiresAt: new Date(NOW - 1000) };

  test("uses the stored token while it is fresh", async () => {
    const { myob, fetch } = setup();
    const onRefresh = vi.fn();

    const conn = myob.connect({ tokens: fresh, onRefresh });

    expect(await conn.getAccessToken()).toBe("stored-access");
    expect(fetch).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("refreshes an expired token and hands the new tokens to onRefresh", async () => {
    const { myob, sentForm } = setup(
      jsonResponse(200, tokenBody({ access_token: "access-2", refresh_token: "refresh-2" })),
    );
    const onRefresh = vi.fn();

    const conn = myob.connect({ tokens: expired, onRefresh });

    expect(await conn.getAccessToken()).toBe("access-2");
    expect(sentForm().refresh_token).toBe("stored-refresh");
    expect(onRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-2", refreshToken: "refresh-2" }),
    );
    expect(conn.getTokens().refreshToken).toBe("refresh-2");
  });

  test("shares one refresh between concurrent callers", async () => {
    const { myob, fetch } = setup(jsonResponse(200, tokenBody({ access_token: "access-2" })));

    const conn = myob.connect({ tokens: expired });
    const results = await Promise.all([
      conn.getAccessToken(),
      conn.getAccessToken(),
      conn.headers(),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe("access-2");
    expect(results[1]).toBe("access-2");
    expect(results[2].Authorization).toBe("Bearer access-2");
  });

  test("keeps the new tokens even if onRefresh fails", async () => {
    const { myob } = setup(jsonResponse(200, tokenBody({ access_token: "access-2" })));

    const conn = myob.connect({
      tokens: expired,
      onRefresh: () => {
        throw new Error("db down");
      },
    });

    await expect(conn.getAccessToken()).rejects.toThrow("db down");
    expect(await conn.getAccessToken()).toBe("access-2");
  });

  test("headers include the MYOB API key and version", async () => {
    const { myob } = setup();

    expect(await myob.connect({ tokens: fresh }).headers()).toEqual({
      Authorization: "Bearer stored-access",
      "x-myobapi-key": "client-id",
      "x-myobapi-version": "v2",
      Accept: "application/json",
    });
  });

  test("throws when the token is expired and there is no refresh token", async () => {
    const { myob } = setup();

    const conn = myob.connect({ tokens: { ...expired, refreshToken: undefined } });

    await expect(conn.getAccessToken()).rejects.toBeInstanceOf(MyobAuthError);
  });
});

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { createMyobAuth, MyobAuthError, MyobTimeoutError, SCOPES, isExpired } = require("..");

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
    }, { expectedState: "s1" });

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
    await expect(conn.getAccessToken()).rejects.toMatchObject({ reconnectRequired: true });
  });

  test("accepts expiresAt as stored (ISO string) and hands back a Date", async () => {
    const { myob, fetch } = setup();

    const conn = myob.connect({ tokens: { ...fresh, expiresAt: fresh.expiresAt.toISOString() } });

    expect(await conn.getAccessToken()).toBe("stored-access");
    expect(fetch).not.toHaveBeenCalled();
    expect(conn.getTokens().expiresAt).toEqual(fresh.expiresAt);
  });
});

describe("hardening", () => {
  test("handleCallback rejects a state that doesn't match expectedState, before using the code", async () => {
    const { myob, fetch } = setup();

    const error = await myob
      .handleCallback({ code: "c", state: "forged" }, { expectedState: "mine" })
      .catch((e) => e);

    expect(error).toBeInstanceOf(MyobAuthError);
    expect(error.code).toBe("state_mismatch");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("handleCallback accepts a matching expectedState", async () => {
    const { myob } = setup(jsonResponse(200, tokenBody()));

    const { state } = await myob.handleCallback({ code: "c", state: "mine" }, { expectedState: "mine" });

    expect(state).toBe("mine");
  });

  test("assumes MYOB's 20-minute lifetime when expires_in is missing", async () => {
    const { myob } = setup(jsonResponse(200, tokenBody({ expires_in: undefined })));

    const tokens = await myob.exchangeCode("c");

    expect(tokens.expiresAt).toEqual(new Date(NOW + 1_200_000));
  });

  test("times out a token request", async () => {
    vi.useRealTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
    );
    const myob = createMyobAuth({ clientId: "a", clientSecret: "b", redirectUri: "c", timeoutMs: 20, fetch });

    await expect(myob.exchangeCode("code")).rejects.toBeInstanceOf(MyobTimeoutError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("connect names the missing tokens", () => {
    const { myob } = setup();

    expect(() => myob.connect({})).toThrow(/connect: `tokens` is required/);
  });

  test("forceRefresh skips the refresh when the rejected token was already replaced", async () => {
    const { myob, fetch } = setup(jsonResponse(200, tokenBody({ access_token: "access-2" })));
    const conn = myob.connect({
      tokens: { accessToken: "access-1", refreshToken: "r", expiresAt: new Date(NOW + 600_000) },
    });

    const [first, second] = await Promise.all([conn.forceRefresh("access-1"), conn.forceRefresh("access-1")]);
    const later = await conn.forceRefresh("access-1");

    expect([first, second, later]).toEqual(["access-2", "access-2", "access-2"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("apiVersion overrides x-myobapi-version", async () => {
    const myob = createMyobAuth({ clientId: "a", clientSecret: "b", redirectUri: "c", apiVersion: "v3" });

    const headers = await myob
      .connect({ tokens: { accessToken: "t", expiresAt: new Date(NOW + 600_000) } })
      .headers();

    expect(headers["x-myobapi-version"]).toBe("v3");
  });
});

describe("MyobAuthError flags", () => {
  test("invalid_grant needs a reconnect; a 5xx from the OAuth server is retryable", async () => {
    const { myob } = setup(
      jsonResponse(400, { error: "invalid_grant" }),
      new Response("<html>Bad gateway</html>", { status: 502 }),
    );

    const dead = await myob.refresh("r1").catch((e) => e);
    const down = await myob.refresh("r1").catch((e) => e);

    expect(dead).toMatchObject({ reconnectRequired: true, retryable: false });
    expect(down).toMatchObject({ reconnectRequired: false, retryable: true });
  });
});

describe("environment variables", () => {
  const ENV = ["MYOB_CLIENT_ID", "MYOB_CLIENT_SECRET", "MYOB_REDIRECT_URI"];
  const saved = {};
  beforeEach(() => {
    for (const name of ENV) saved[name] = process.env[name];
  });
  afterEach(() => {
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  test("falls back to MYOB_CLIENT_ID, MYOB_CLIENT_SECRET and MYOB_REDIRECT_URI", () => {
    process.env.MYOB_CLIENT_ID = "env-id";
    process.env.MYOB_CLIENT_SECRET = "env-secret";
    process.env.MYOB_REDIRECT_URI = "https://example.com/cb";

    const url = new URL(createMyobAuth().getAuthorizeUrl());

    expect(url.searchParams.get("client_id")).toBe("env-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://example.com/cb");
  });

  test("names the env var when a credential is missing", () => {
    for (const name of ENV) delete process.env[name];

    expect(() => createMyobAuth({ clientId: "x", redirectUri: "y" })).toThrow(/MYOB_CLIENT_SECRET/);
  });
});

describe("token request options", () => {
  test("exchangeCode honours an aborted signal without calling MYOB", async () => {
    const { myob, fetch } = setup();

    const error = await myob.exchangeCode("c", { signal: AbortSignal.abort() }).catch((e) => e);

    expect(error.name).toBe("MyobAbortError");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("handleCallback passes request options through to the token request", async () => {
    const { myob, fetch } = setup(jsonResponse(200, tokenBody()));
    const controller = new AbortController();

    await myob.handleCallback({ code: "c" }, { signal: controller.signal, timeoutMs: 1000 });

    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("connect across processes", () => {
  const expired = { accessToken: "a-1", refreshToken: "r-1", expiresAt: new Date(NOW - 1000) };
  const newer = { accessToken: "a-2", refreshToken: "r-2", expiresAt: new Date(NOW + 1_200_000) };

  test("adopts newer tokens another process saved instead of refreshing", async () => {
    const { myob, fetch } = setup();
    const onRefresh = vi.fn();

    const conn = myob.connect({ tokens: expired, onRefresh, loadTokens: async () => ({ ...newer, expiresAt: newer.expiresAt.toISOString() }) });

    expect(await conn.getAccessToken()).toBe("a-2");
    expect(fetch).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("ignores stored tokens that are older than the ones it holds", async () => {
    const { myob, fetch } = setup(jsonResponse(200, tokenBody({ access_token: "a-3", refresh_token: "r-3" })));
    const older = { accessToken: "a-0", refreshToken: "r-0", expiresAt: new Date(NOW - 5000) };

    const conn = myob.connect({ tokens: expired, loadTokens: async () => older });

    expect(await conn.getAccessToken()).toBe("a-3");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("recovers from invalid_grant when another process refreshed first", async () => {
    const { myob } = setup(jsonResponse(400, { error: "invalid_grant" }));
    let stored = expired;
    const loadTokens = vi.fn(async () => stored);
    const conn = myob.connect({ tokens: expired, loadTokens });
    // The other process saves its tokens while our refresh is in flight.
    const pending = conn.getAccessToken();
    stored = newer;

    expect(await pending).toBe("a-2");
    expect(loadTokens).toHaveBeenCalledTimes(2);
  });

  test("still throws invalid_grant when storage has nothing newer", async () => {
    const { myob } = setup(jsonResponse(400, { error: "invalid_grant" }));

    const conn = myob.connect({ tokens: expired, loadTokens: async () => expired });

    await expect(conn.getAccessToken()).rejects.toMatchObject({ code: "invalid_grant" });
  });

  test("runs the refresh inside withRefreshLock", async () => {
    const { myob } = setup(jsonResponse(200, tokenBody({ access_token: "a-3" })));
    const events = [];
    const withRefreshLock = async (fn) => {
      events.push("lock");
      try {
        return await fn();
      } finally {
        events.push("unlock");
      }
    };
    const loadTokens = async () => {
      events.push("load");
      return expired;
    };

    const conn = myob.connect({ tokens: expired, loadTokens, withRefreshLock });

    expect(await conn.getAccessToken()).toBe("a-3");
    expect(events).toEqual(["lock", "load", "unlock"]);
  });
});

describe("connection extras", () => {
  test("shares one rate limiter per auth, and carries appName in the User-Agent", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(200, tokenBody()));
    const myob = createMyobAuth({ clientId: "i", clientSecret: "s", redirectUri: "r", appName: "constructionclock/1.0", fetch });

    const a = myob.connect({ tokens: { refreshToken: "x" } });
    const b = myob.connect({ tokens: { refreshToken: "y" } });
    await myob.refresh("x");

    expect(a.rateLimiter).toBeDefined();
    expect(a.rateLimiter).toBe(b.rateLimiter);
    expect(a.userAgent).toMatch(/ constructionclock\/1\.0$/);
    expect(fetch.mock.calls[0][1].headers["User-Agent"]).toMatch(/ constructionclock\/1\.0$/);
  });

  test("rateLimit: false turns pacing off", () => {
    const myob = createMyobAuth({ clientId: "i", clientSecret: "s", redirectUri: "r", rateLimit: false });

    expect(myob.connect({ tokens: { refreshToken: "x" } }).rateLimiter).toBeUndefined();
  });

  test("the deprecated myob.isExpired alias is gone", () => {
    const { myob } = setup();

    expect(myob).not.toHaveProperty("isExpired");
  });
});

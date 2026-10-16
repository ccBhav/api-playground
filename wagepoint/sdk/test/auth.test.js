import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { createWagepointAuth, WagepointAuthError, isExpired } = require("..");

const NOW = new Date("2026-10-16T00:00:00.000Z").getTime();
const TOKEN_URL = "https://payroll.wagepoint.com/prod/identity/connect/token";

const tokenBody = (overrides = {}) => ({
  access_token: "access-1",
  expires_in: 3600,
  token_type: "Bearer",
  scope: "services",
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
  const wagepoint = createWagepointAuth({
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch,
  });
  const sentForm = (call = 0) =>
    Object.fromEntries(new URLSearchParams(fetch.mock.calls[call][1].body));
  return { wagepoint, fetch, sentForm };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createWagepointAuth", () => {
  test("throws when required config is missing", () => {
    expect(() => createWagepointAuth({ clientId: "x" })).toThrow(/clientSecret/);
  });
});

describe("requestToken", () => {
  test("posts the client_credentials grant and returns camelCase tokens", async () => {
    const { wagepoint, fetch, sentForm } = setup(jsonResponse(200, tokenBody()));

    const tokens = await wagepoint.requestToken();

    expect(fetch.mock.calls[0][0]).toBe(TOKEN_URL);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(sentForm()).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "services",
    });
    expect(tokens).toEqual({
      accessToken: "access-1",
      expiresAt: new Date(NOW + 3600 * 1000),
      scope: "services",
      tokenType: "Bearer",
    });
  });

  test("sends a custom scope list space-separated", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse(200, tokenBody()));
    const wagepoint = createWagepointAuth({
      clientId: "c",
      clientSecret: "s",
      scope: ["services", "extra"],
      fetch,
    });

    await wagepoint.requestToken();

    expect(new URLSearchParams(fetch.mock.calls[0][1].body).get("scope")).toBe("services extra");
  });

  test("maps an OAuth error response to WagepointAuthError", async () => {
    const { wagepoint } = setup(
      jsonResponse(400, { error: "invalid_client", error_description: "Bad secret" }),
    );

    const error = await wagepoint.requestToken().catch((e) => e);

    expect(error).toBeInstanceOf(WagepointAuthError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_client",
      description: "Bad secret",
    });
    expect(error.message).toMatch(/Bad secret/);
  });

  test("throws when the response has no access_token", async () => {
    const { wagepoint } = setup(jsonResponse(200, { token_type: "Bearer" }));

    await expect(wagepoint.requestToken()).rejects.toThrow(/no access_token/);
  });

  test("keeps a non-JSON error body as text", async () => {
    const { wagepoint } = setup(new Response("<html>Bad gateway</html>", { status: 502 }));

    const error = await wagepoint.requestToken().catch((e) => e);

    expect(error).toMatchObject({ status: 502, body: "<html>Bad gateway</html>" });
  });
});

describe("connect", () => {
  test("requests a token on first use and caches it", async () => {
    const { wagepoint, fetch } = setup(jsonResponse(200, tokenBody()));
    const conn = wagepoint.connect();

    expect(await conn.getAccessToken()).toBe("access-1");
    expect(await conn.getAccessToken()).toBe("access-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("reuses a stored token that is still valid", async () => {
    const { wagepoint, fetch } = setup();
    const conn = wagepoint.connect({
      tokens: { accessToken: "stored", expiresAt: new Date(NOW + 600_000).toISOString() },
    });

    expect(await conn.headers()).toEqual({
      Authorization: "Bearer stored",
      Accept: "application/json",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("requests a new token once the stored one is within the skew window", async () => {
    const { wagepoint, fetch } = setup(jsonResponse(200, tokenBody({ access_token: "new" })));
    const onToken = vi.fn();
    const conn = wagepoint.connect({
      tokens: { accessToken: "old", expiresAt: NOW + 30_000 },
      onToken,
    });

    expect(await conn.getAccessToken()).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "new" }));
    expect(conn.getTokens()).toMatchObject({ accessToken: "new" });
  });

  test("concurrent callers share one token request", async () => {
    const { wagepoint, fetch } = setup(jsonResponse(200, tokenBody()));
    const conn = wagepoint.connect();

    const tokens = await Promise.all([conn.getAccessToken(), conn.getAccessToken(), conn.headers()]);

    expect(tokens.slice(0, 2)).toEqual(["access-1", "access-1"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("keeps the new token when onToken throws", async () => {
    const { wagepoint, fetch } = setup(jsonResponse(200, tokenBody()));
    const conn = wagepoint.connect({
      onToken: () => {
        throw new Error("db down");
      },
    });

    await expect(conn.getAccessToken()).rejects.toThrow("db down");
    expect(await conn.getAccessToken()).toBe("access-1");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("allows a retry after a failed token request", async () => {
    const { wagepoint } = setup(
      jsonResponse(500, { error: "server_error" }),
      jsonResponse(200, tokenBody()),
    );
    const conn = wagepoint.connect();

    await expect(conn.getAccessToken()).rejects.toBeInstanceOf(WagepointAuthError);
    expect(await conn.getAccessToken()).toBe("access-1");
  });

  test("getTokens is null before the first token", () => {
    const { wagepoint } = setup();

    expect(wagepoint.connect().getTokens()).toBeNull();
  });
});

describe("renew", () => {
  test("requests a new token even when the current one looks valid", async () => {
    const { wagepoint, fetch } = setup(
      jsonResponse(200, tokenBody({ access_token: "a" })),
      jsonResponse(200, tokenBody({ access_token: "b" })),
    );
    const conn = wagepoint.connect();
    const first = await conn.getAccessToken();

    expect(await conn.renew(first)).toBe("b");
    expect(await conn.getAccessToken()).toBe("b");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("returns the newer token if another caller already replaced the rejected one", async () => {
    const { wagepoint, fetch } = setup(jsonResponse(200, tokenBody({ access_token: "b" })));
    const conn = wagepoint.connect({
      tokens: { accessToken: "a", expiresAt: NOW + 600_000 },
    });

    await conn.renew("a");
    expect(await conn.renew("a")).toBe("b");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("isExpired", () => {
  test("treats missing tokens and bad dates as expired", () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired({ accessToken: "a" })).toBe(true);
    expect(isExpired({ accessToken: "a", expiresAt: "not a date" })).toBe(true);
  });

  test("honours the skew", () => {
    const tokens = { accessToken: "a", expiresAt: NOW + 90_000 };

    expect(isExpired(tokens)).toBe(false);
    expect(isExpired(tokens, { skewSeconds: 120 })).toBe(true);
  });
});

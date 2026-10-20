/**
 * Example app: a tiny zero-dependency web app showing how a backend uses the SDK.
 *
 *   npm start              http://localhost:8080 (or PORT)
 *   npm run start:ngrok    same, but MYOB redirects through an ngrok tunnel (see runner/ngrok.sh)
 *
 * Flow: Connect → MYOB login → back to MYOB_REDIRECT_URI → browse the company file's resources.
 * Tokens and the chosen businessId live in .tokens.json, standing in for the database row a real
 * app keeps per company. If the file needs its own login, set MYOB_CF_USERNAME / MYOB_CF_PASSWORD.
 */
const { AsyncLocalStorage } = require("node:async_hooks");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const {
  createMyobAuth,
  createMyobClient,
  MyobApiError,
  MyobAuthError,
  RESOURCES,
} = require("../sdk");

const TOKENS_FILE = path.join(__dirname, "..", ".tokens.json");
const PAGE_SIZE = 20;

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

const redirectUri = required("MYOB_REDIRECT_URI");
const callbackPath = new URL(redirectUri).pathname;
// PORT is set when the redirect URI is a tunnel (e.g. ngrok) rather than localhost
const port = Number(process.env.PORT || new URL(redirectUri).port || 8080);

// Space- or comma-separated. MYOB's consent page errors if the app asks for a scope it isn't
// allowed, so this lets you narrow it down. Defaults to every scope the SDK knows.
const scopes = process.env.MYOB_SCOPES?.split(/[\s,]+/).filter(Boolean);

const myob = createMyobAuth({
  clientId: required("MYOB_CLIENT_ID"),
  clientSecret: required("MYOB_CLIENT_SECRET"),
  redirectUri,
  scopes: scopes?.length ? scopes : undefined,
});

// --- "Database" -------------------------------------------------------------------------------

const load = async () => {
  try {
    return JSON.parse(await fs.readFile(TOKENS_FILE, "utf8"));
  } catch {
    return null;
  }
};

const save = (connection) =>
  fs.writeFile(TOKENS_FILE, `${JSON.stringify(connection, null, 2)}\n`);

const forget = () => fs.rm(TOKENS_FILE, { force: true });

/** The API calls made while handling the current page request, shown raw at the bottom of the page. */
const apiCalls = new AsyncLocalStorage();

const SECRET_HEADERS = /^(authorization|x-myobapi-cftoken)$/i;

const parseBody = (text) => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * A `fetch` that records each API request and its response (one entry per attempt, so retries show)
 * into the current page's `apiCalls`. Only the API client uses this, not auth, so token requests
 * (which carry the client secret) are never recorded, and the bearer and company file tokens are
 * redacted.
 * @type {typeof fetch}
 */
const recordingFetch = async (url, init = {}) => {
  const headers = Object.fromEntries(
    [...new Headers(init.headers)].map(([name, value]) => [name, SECRET_HEADERS.test(name) ? "[redacted]" : value]),
  );
  const call = { request: { method: init.method ?? "GET", url: String(url), headers, body: parseBody(init.body) } };
  apiCalls.getStore()?.push(call);
  try {
    const response = await fetch(url, init);
    call.response = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers),
      body: parseBody(await response.clone().text()),
    };
    return response;
  } catch (error) {
    call.error = String(error?.message ?? error);
    throw error;
  }
};

/** Build an API client for the stored connection, persisting tokens whenever they refresh. */
const clientFor = (saved) => {
  let current = saved;
  return createMyobClient({
    auth: myob,
    tokens: saved, // includes businessId
    onRefresh: async (tokens) => {
      current = { ...current, ...tokens };
      await save(current);
    },
    companyFileCredentials: process.env.MYOB_CF_USERNAME
      ? { username: process.env.MYOB_CF_USERNAME, password: process.env.MYOB_CF_PASSWORD }
      : undefined,
    fetch: recordingFetch,
  });
};

// --- HTML -------------------------------------------------------------------------------------

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const page = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)} · MYOB example</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  nav a { margin-right: 1rem; } table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
  pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; } .error { color: #b00020; }
  .button { display: inline-block; padding: .5rem 1rem; background: #6100a5; color: #fff; border-radius: 4px; text-decoration: none; }
  .muted { color: #777; }
</style></head>
<body><nav><a href="/">Home</a><a href="/files">Company files</a></nav><h1>${esc(title)}</h1>${body}${apiCallsHtml()}</body></html>`;

/** Every request/response from `recordingFetch` for this page, as raw JSON. */
const apiCallsHtml = () => {
  const calls = apiCalls.getStore();
  return calls?.length
    ? `<h2>Raw API calls (${calls.length})</h2><pre>${esc(JSON.stringify(calls, null, 2))}</pre>`
    : "";
};

/** A short display name for any MYOB record. */
const labelOf = (record) =>
  record.CompanyName ??
  record.Name ??
  ([record.FirstName, record.LastName].filter(Boolean).join(" ") ||
    record.Number ||
    record.DisplayID ||
    record.UID);

const COLUMN_PRIORITY = ["DisplayID", "Number", "Date", "Status", "TotalAmount", "BalanceDueAmount", "IsActive", "LastModified"];

const table = (resource, items) => {
  if (!items.length) return `<p class="muted">No records.</p>`;
  const columns = COLUMN_PRIORITY.filter((key) => items.some((item) => item[key] != null)).slice(0, 5);
  const head = ["Name", ...columns].map((c) => `<th>${esc(c)}</th>`).join("");
  const rows = items
    .map((item) => {
      const name = item.UID
        ? `<a href="/r/${resource}/${encodeURIComponent(item.UID)}">${esc(labelOf(item))}</a>`
        : esc(labelOf(item));
      return `<tr><td>${name}</td>${columns.map((c) => `<td>${esc(item[c])}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
};

const errorHtml = (error) => {
  if (error instanceof MyobAuthError) {
    return `<p class="error">MYOB rejected the login (${esc(error.code ?? error.status)}): ${esc(error.description ?? error.message)}</p>
      <p><a class="button" href="/connect">Reconnect</a></p>`;
  }
  if (error instanceof MyobApiError) {
    const detail = error.errors.length
      ? `<ul>${error.errors.map((e) => `<li><b>${esc(e.Name)}</b>: ${esc(e.Message)} ${esc(e.AdditionalDetails ?? "")}</li>`).join("")}</ul>`
      : `<pre>${esc(typeof error.body === "string" ? error.body : JSON.stringify(error.body, null, 2))}</pre>`;
    return `<p class="error">MYOB returned ${error.status} for ${esc(error.method)} ${esc(error.url)}</p>${detail}`;
  }
  return `<pre class="error">${esc(error.stack ?? error)}</pre>`;
};

// --- Routes -----------------------------------------------------------------------------------

/** Pending OAuth `state` values, so the callback can check the redirect came from our /connect. */
const pendingStates = new Set();

const send = (res, status, html) =>
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);

const redirect = (res, location) => res.writeHead(302, { Location: location }).end();

const notConnected = (res) =>
  send(res, 200, page("Not connected", `<p><a class="button" href="/connect">Connect to MYOB</a></p>`));

const routes = {
  "GET /": async (_req, res, { saved }) => {
    if (!saved) return notConnected(res);
    const links = Object.keys(RESOURCES)
      .filter((key) => key !== "COMPANY")
      .map((key) => `<li><a href="/r/${key}">${esc(key)}</a> <span class="muted">${esc(RESOURCES[key])}</span></li>`)
      .join("");
    let company = "";
    if (saved.businessId) {
      try {
        const info = await clientFor(saved).get(RESOURCES.COMPANY);
        company = `<p>Company: <b>${esc(info.CompanyName ?? info.Name)}</b></p>`;
      } catch (error) {
        company = errorHtml(error);
      }
    }
    send(
      res,
      200,
      page(
        "MYOB example",
        `${company}
        <p>Company file: <code>${esc(saved.businessId ?? "none")}</code> · <a href="/files">change</a></p>
        <p class="muted">Access token expires ${esc(new Date(saved.expiresAt).toLocaleString())}; it refreshes on the next call after that.</p>
        ${saved.businessId ? `<h2>Resources</h2><ul>${links}</ul>` : ""}
        <p><a href="/connect">Reconnect</a> · <a href="/disconnect">Disconnect</a></p>`,
      ),
    );
  },

  "GET /connect": (_req, res) => {
    const state = randomUUID();
    pendingStates.add(state);
    redirect(res, myob.getAuthorizeUrl({ state }));
  },

  "GET /disconnect": async (_req, res) => {
    await forget();
    redirect(res, "/");
  },

  "GET /files": async (_req, res, { saved }) => {
    if (!saved) return notConnected(res);
    const files = await clientFor(saved).companyFiles.list();
    const rows = files
      .map(
        (file) => `<tr><td>${esc(file.Name)}</td><td>${esc(file.ProductVersion)}</td><td>${
          file.Id === saved.businessId
            ? "<b>selected</b>"
            : `<a href="/files/select?id=${encodeURIComponent(file.Id)}">use this</a>`
        }</td></tr>`,
      )
      .join("");
    send(res, 200, page("Company files", `<table><tr><th>Name</th><th>Version</th><th></th></tr>${rows}</table>`));
  },

  "GET /files/select": async (_req, res, { saved, query }) => {
    if (!saved) return notConnected(res);
    await save({ ...saved, businessId: query.get("id") });
    redirect(res, "/");
  },
};

/** `/r/:resource` lists a page of records; `/r/:resource/:uid` shows one record. */
const resourceRoute = async (res, { saved, query }, resource, uid) => {
  const resourcePath = RESOURCES[resource];
  if (!resourcePath) return send(res, 404, page("Not found", `<p>Unknown resource ${esc(resource)}</p>`));
  if (!saved) return notConnected(res);
  const api = clientFor(saved);

  if (uid) {
    const record = await api.retrieve(resourcePath, uid);
    return send(
      res,
      200,
      page(labelOf(record), `<p><a href="/r/${resource}">← ${esc(resource)}</a></p><pre>${esc(JSON.stringify(record, null, 2))}</pre>`),
    );
  }

  const skip = Math.max(0, Number(query.get("skip")) || 0);
  const { items, count } = await api.list(resourcePath, { top: PAGE_SIZE, skip });
  const prev = skip > 0 ? `<a href="?skip=${Math.max(0, skip - PAGE_SIZE)}">← previous</a>` : "";
  const hasMore = count != null ? skip + items.length < count : items.length === PAGE_SIZE;
  const next = hasMore ? `<a href="?skip=${skip + PAGE_SIZE}">next →</a>` : "";
  const range = items.length ? `${skip + 1}–${skip + items.length}` : "0";
  send(
    res,
    200,
    page(
      resource,
      `<p class="muted">${esc(resourcePath)} · showing ${range}${count != null ? ` of ${count}` : ""}</p>
      ${table(resource, items)}<p>${prev} ${next}</p>`,
    ),
  );
};

/** MYOB redirects here with ?code=...&businessId=... (or ?error=...). */
const handleCallback = async (res, query) => {
  const state = query.get("state");
  if (!pendingStates.delete(state)) {
    return send(res, 400, page("Login failed", `<p class="error">Unknown or reused state. <a href="/connect">Try again</a>.</p>`));
  }
  const { tokens, businessId } = await myob.handleCallback(query, { expectedState: state });
  await save({ ...tokens, businessId });
  redirect(res, "/");
};

const server = http.createServer((req, res) => apiCalls.run([], () => handle(req, res)));

const handle = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const query = url.searchParams;
  try {
    if (req.method === "GET" && url.pathname === callbackPath && (query.has("code") || query.has("error"))) {
      return await handleCallback(res, query);
    }
    const context = { saved: await load(), query };
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, context);

    const match = url.pathname.match(/^\/r\/([A-Z_]+)(?:\/([^/]+))?$/);
    if (req.method === "GET" && match) {
      return await resourceRoute(res, context, match[1], match[2] && decodeURIComponent(match[2]));
    }
    send(res, 404, page("Not found", ""));
  } catch (error) {
    console.error(error);
    send(res, error instanceof MyobApiError ? 502 : 500, page("Something went wrong", errorHtml(error)));
  }
};

server.listen(port, () => {
  const local = `http://localhost:${port}/`;
  console.log(`MYOB example app on ${local}`);
  console.log(`MYOB redirects to ${redirectUri}`);
  console.log(`Scopes: ${scopes?.length ? scopes.join(" ") : "all (MYOB_SCOPES not set)"}`);
  if (process.platform === "darwin" && !process.argv.includes("--no-open")) execFile("open", [local]);
});

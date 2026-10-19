/**
 * Example app: a tiny zero-dependency web app showing how a backend uses the SDK.
 *
 *   npm start              http://localhost:8080 (or PORT)
 *
 * Flow (the quick start's happy path): pick a company → list its people → log time for one →
 * read the entries back. There's no login step: Wagepoint uses the client credentials grant, so
 * the app gets a token with WAGEPOINT_CLIENT_ID / WAGEPOINT_CLIENT_SECRET on the first call.
 * The token and chosen companyId live in .tokens.json, standing in for the cache and database row a
 * real app keeps.
 *
 * Logging time writes real, pending time entries to the company's payroll.
 */
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const {
  createWagepointAuth,
  createWagepointClient,
  WagepointApiError,
  WagepointAuthError,
  RESOURCES,
} = require("../sdk");

const TOKENS_FILE = path.join(__dirname, "..", ".tokens.json");
const PAGE_SIZE = 20;
const MAX_FORM_BYTES = 10_000;

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

const port = Number(process.env.PORT || 8080);
const scope = process.env.WAGEPOINT_SCOPE?.split(/[\s,]+/).filter(Boolean);

const wagepoint = createWagepointAuth({
  clientId: required("WAGEPOINT_CLIENT_ID"),
  clientSecret: required("WAGEPOINT_CLIENT_SECRET"),
  scope: scope?.length ? scope : undefined,
  tokenUrl: process.env.WAGEPOINT_TOKEN_URL || undefined,
});
const baseUrl = process.env.WAGEPOINT_API_BASE_URL || undefined;

// --- "Database" -------------------------------------------------------------------------------

const load = async () => {
  try {
    return JSON.parse(await fs.readFile(TOKENS_FILE, "utf8"));
  } catch {
    return {};
  }
};

const save = (state) => fs.writeFile(TOKENS_FILE, `${JSON.stringify(state, null, 2)}\n`);

/** One connection for the whole app: the token covers every company these credentials can see. */
let connection;
const getConnection = async () => {
  connection ??= wagepoint.connect({
    tokens: await load(),
    onToken: async (tokens) => save({ ...(await load()), ...tokens }),
  });
  return connection;
};

/**
 * Records the URL and body of each POST to the API into `sent`, so the page can show what was sent.
 * Only the API client uses this, not auth, so the token request (which carries the client secret)
 * is never recorded.
 * @param {{ url: string, body: unknown }[]} sent
 * @returns {typeof fetch}
 */
const recordingFetch = (sent) => (url, init = {}) => {
  if (init.method === "POST") {
    sent.push({ url: String(url), body: init.body === undefined ? undefined : JSON.parse(init.body) });
  }
  return fetch(url, init);
};

const clientFor = async (state, sent = []) =>
  createWagepointClient({
    connection: await getConnection(),
    companyId: state.companyId ?? process.env.WAGEPOINT_COMPANY_ID ?? undefined,
    baseUrl,
    fetch: recordingFetch(sent),
  });

// --- HTML -------------------------------------------------------------------------------------

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const page = (title, body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)} · Wagepoint example</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 1000px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  nav a { margin-right: 1rem; } table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
  pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; } .error { color: #b00020; }
  .button, button { display: inline-block; padding: .5rem 1rem; background: #0b6b5c; color: #fff; border: 0; border-radius: 4px; text-decoration: none; font: inherit; cursor: pointer; }
  form.inline { display: flex; gap: .75rem; flex-wrap: wrap; align-items: end; margin: 1rem 0; }
  label { display: flex; flex-direction: column; font-size: 13px; color: #555; }
  input { font: inherit; padding: .3rem .4rem; } .muted { color: #777; } .warn { background: #fff4e5; padding: .5rem .75rem; }
</style></head>
<body><nav><a href="/">Home</a><a href="/companies">Companies</a><a href="/persons">People</a><a href="/time-entries">Time entries</a></nav>
<h1>${esc(title)}</h1>${body}</body></html>`;

const table = (columns, rows) => {
  if (!rows.length) return `<p class="muted">No records.</p>`;
  const head = columns.map(([label]) => `<th>${esc(label)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${columns.map(([, cell]) => `<td>${cell(row)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
};

const nameOf = (person) =>
  [person.first_name, person.last_name].filter(Boolean).join(" ") || person.email || person.id;

const errorHtml = (error) => {
  if (error instanceof WagepointAuthError) {
    return `<p class="error">Wagepoint rejected the client credentials (${esc(error.code ?? error.status)}): ${esc(error.description ?? error.message)}</p>
      <p class="muted">Check WAGEPOINT_CLIENT_ID / WAGEPOINT_CLIENT_SECRET in .env, then restart.</p>`;
  }
  if (error instanceof WagepointApiError) {
    const headers = [...(error.headers?.entries() ?? [])]
      .filter(([name]) => /correlation|request-id|trace/i.test(name))
      .map(([name, value]) => `${esc(name)}: ${esc(value)}`)
      .join("<br>");
    return `<p class="error">Wagepoint returned ${error.status} for ${esc(error.method)} ${esc(error.url)}</p>
      ${error.detail ? `<p>${esc(error.detail)}</p>` : ""}
      ${headers ? `<p class="muted">${headers}</p>` : ""}
      <pre>${esc(typeof error.body === "string" ? error.body : JSON.stringify(error.body, null, 2))}</pre>`;
  }
  return `<pre class="error">${esc(error.stack ?? error)}</pre>`;
};

/** The POSTs recorded by `recordingFetch`; more than one means the SDK retried. */
const sentHtml = (sent) =>
  sent.length
    ? `<h2>Sent to Wagepoint</h2>${sent
        .map(
          ({ url, body }) =>
            `<p><code>POST ${esc(url)}</code></p>${body === undefined ? "" : `<pre>${esc(JSON.stringify(body, null, 2))}</pre>`}`,
        )
        .join("")}`
    : "";

const noCompany = (res) =>
  send(res, 200, page("No company selected", `<p><a class="button" href="/companies">Pick a company</a></p>`));

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// --- Routes -----------------------------------------------------------------------------------

const send = (res, status, html) =>
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);

const redirect = (res, location) => res.writeHead(302, { Location: location }).end();

const readForm = async (req) => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_FORM_BYTES) throw new Error("Form too large");
  }
  return new URLSearchParams(raw);
};

const routes = {
  "GET /": async (_req, res, { state }) => {
    const tokens = (await getConnection()).getTokens();
    let company = "";
    const api = await clientFor(state);
    if (api.companyId) {
      company = `<p>Company ID: <code>${esc(api.companyId)}</code>${state.companyName ? ` · <b>${esc(state.companyName)}</b>` : ""} · <a href="/companies">change</a></p>
        <ol><li><a href="/persons">List people</a> and pick one</li><li>Log time for them</li><li><a href="/time-entries">Read the entries back</a></li></ol>`;
    } else {
      company = `<p><a class="button" href="/companies">Pick a company</a></p>`;
    }
    send(
      res,
      200,
      page(
        "Wagepoint example",
        `${company}
        <p class="muted">${
          tokens
            ? `Access token expires ${esc(new Date(tokens.expiresAt).toLocaleString())}; a new one is requested on the next call after that.`
            : "No access token yet; one is requested on the first API call."
        }</p>`,
      ),
    );
  },

  "GET /companies": async (_req, res, { state }) => {
    const api = await clientFor(state);
    const companies = await api.all(RESOURCES.COMPANIES);
    const rows = table(
      [
        ["ID", (c) => esc(c.id)],
        ["Name", (c) => esc(c.name)],
        ["DBA", (c) => esc(c.dba)],
        ["Code", (c) => `<code>${esc(c.company_code)}</code>`],
        ["Status", (c) => esc(c.status)],
        [
          "",
          (c) =>
            String(c.id) === String(api.companyId)
              ? "<b>selected</b>"
              : `<a href="/companies/select?id=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name ?? "")}">use this</a>`,
        ],
      ],
      companies,
    );
    send(res, 200, page("Companies", rows));
  },

  "GET /companies/select": async (_req, res, { state, query }) => {
    await save({ ...state, companyId: query.get("id"), companyName: query.get("name") || undefined });
    redirect(res, "/");
  },

  "GET /persons": async (_req, res, { state, query }) => {
    const api = await clientFor(state);
    if (!api.companyId) return noCompany(res);
    const after = query.get("after") || undefined;
    const { items, hasMore, after: next } = await api.listPersons({ pageSize: PAGE_SIZE, after });
    const rows = table(
      [
        ["ID", (p) => `<code>${esc(p.id)}</code>`],
        ["Name", (p) => esc(nameOf(p))],
        ["Email", (p) => esc(p.email)],
        ["Status", (p) => esc(p.status)],
        ["Type", (p) => esc(p.person_type)],
        ["", (p) => `<a href="/time-entries?person_id=${encodeURIComponent(p.id)}">time / log time</a>`],
      ],
      items,
    );
    const nav = [
      after ? `<a href="/persons">← first page</a>` : "",
      hasMore && next ? `<a href="/persons?after=${encodeURIComponent(next)}">next →</a>` : "",
    ].join(" ");
    send(res, 200, page("People", `${rows}<p>${nav}</p>`));
  },

  "GET /time-entries": async (_req, res, { state, query }) => {
    const api = await clientFor(state);
    if (!api.companyId) return noCompany(res);
    const fromDate = query.get("from_date") || daysAgo(14);
    const toDate = query.get("to_date") || today();
    const personId = query.get("person_id") || "";

    const entries = await api.listTimeEntries({
      fromDate,
      toDate,
      personIds: personId ? [personId] : undefined,
    });
    const rows = table(
      [
        ["ID", (e) => esc(e.id)],
        ["Person", (e) => `<code>${esc(e.person_id)}</code>`],
        ["Date", (e) => esc(e.work_date)],
        ["Hours", (e) => esc(e.hours)],
        ["Notes", (e) => esc(e.notes)],
        ["Status", (e) => esc(e.status)],
      ],
      entries.items,
    );

    send(
      res,
      200,
      page(
        "Time entries",
        `<form class="inline" method="get">
          <label>From<input type="date" name="from_date" value="${esc(fromDate)}"></label>
          <label>To<input type="date" name="to_date" value="${esc(toDate)}"></label>
          <label>Person ID (optional)<input name="person_id" value="${esc(personId)}"></label>
          <button>Filter</button>
        </form>
        ${rows}
        ${entries.hasMore ? `<p class="muted">More entries exist than shown; narrow the range.</p>` : ""}
        <h2>Log time</h2>
        <p class="warn">This creates a real pending time entry in the company's Wagepoint payroll.</p>
        <form class="inline" method="post" action="/time-entries">
          <input type="hidden" name="idempotency_key" value="${esc(randomUUID())}">
          <label>Person ID<input name="person_id" value="${esc(personId)}" required inputmode="numeric"></label>
          <label>Work date<input type="date" name="work_date" value="${esc(today())}" required></label>
          <label>Hours<input type="number" name="hours" step="0.01" min="0" required></label>
          <label>Notes<input name="notes" value="Logged from the Wagepoint example app"></label>
          <button>Submit</button>
        </form>
        <p class="muted">The form carries its own Idempotency-Key, so submitting it twice creates the entry once.</p>`,
      ),
    );
  },

  "POST /time-entries": async (req, res, { state }) => {
    const sent = [];
    const api = await clientFor(state, sent);
    if (!api.companyId) return noCompany(res);
    const form = await readForm(req);
    const entry = {
      person_id: Number(form.get("person_id")),
      work_date: form.get("work_date"),
      hours: Number(form.get("hours")),
      notes: form.get("notes") || undefined,
    };
    let created;
    try {
      created = await api.createTimeEntries([entry], {
        idempotencyKey: form.get("idempotency_key") || undefined,
      });
    } catch (error) {
      console.error(error);
      const status = error instanceof WagepointApiError ? 502 : 500;
      return send(res, status, page("Something went wrong", `${errorHtml(error)}${sentHtml(sent)}`));
    }
    const { items, idempotencyKey } = created;
    const verify = `/time-entries?from_date=${encodeURIComponent(entry.work_date)}&to_date=${encodeURIComponent(entry.work_date)}&person_id=${encodeURIComponent(entry.person_id)}`;
    send(
      res,
      201,
      page(
        "Time entry created",
        `<p class="muted">Idempotency-Key: <code>${esc(idempotencyKey)}</code></p>
        <pre>${esc(JSON.stringify(items, null, 2))}</pre>
        <p><a class="button" href="${esc(verify)}">Read it back</a></p>
        ${sentHtml(sent)}`,
      ),
    );
  },
};

/** Browsers send Origin on cross-site POSTs; refuse them so another site can't log time here. */
const isSameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method !== "GET" && !isSameOrigin(req)) {
      return send(res, 403, page("Forbidden", `<p class="error">Cross-origin request refused.</p>`));
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, page("Not found", ""));
    await route(req, res, { state: await load(), query: url.searchParams });
  } catch (error) {
    console.error(error);
    send(res, error instanceof WagepointApiError ? 502 : 500, page("Something went wrong", errorHtml(error)));
  }
});

server.listen(port, () => {
  const local = `http://localhost:${port}/`;
  console.log(`Wagepoint example app on ${local}`);
  console.log(`Scope: ${scope?.length ? scope.join(" ") : "services (WAGEPOINT_SCOPE not set)"}`);
  if (process.platform === "darwin" && !process.argv.includes("--no-open")) execFile("open", [local]);
});

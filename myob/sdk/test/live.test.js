// Read-only smoke test against real MYOB. Skipped unless MYOB_LIVE=1 (`npm run test:live`).
// It reuses the playground's connection: run `npm start` from myob/ and connect once first. Token
// refreshes are written back to myob/.tokens.json, as the playground does.
import { describe, test, expect, beforeAll } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const { createMyobAuth, createMyobClient } = require("..");

const PLAYGROUND = path.join(__dirname, "..", "..");
const TOKENS_FILE = path.join(PLAYGROUND, ".tokens.json");
const TIMEOUT_MS = 30_000;

describe.skipIf(process.env.MYOB_LIVE !== "1")("live MYOB (read-only)", () => {
  /** @type {ReturnType<typeof createMyobClient>} */
  let api;
  let saved;

  beforeAll(() => {
    try {
      process.loadEnvFile(path.join(PLAYGROUND, ".env"));
    } catch {
      // Fine if the variables are already in the environment.
    }
    if (!fs.existsSync(TOKENS_FILE)) {
      throw new Error("No myob/.tokens.json: run `npm start` from myob/ and connect to MYOB first");
    }
    const read = () => JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    saved = read();
    api = createMyobClient({
      auth: createMyobAuth({ appName: "myob-sdk-live-test" }),
      tokens: saved,
      loadTokens: async () => read(),
      onRefresh: async (tokens) => {
        saved = { ...read(), ...tokens };
        fs.writeFileSync(TOKENS_FILE, `${JSON.stringify(saved, null, 2)}\n`);
      },
    });
  });

  test("lists company files, including the connected one", async () => {
    const files = await api.companyFiles.list();

    expect(Array.isArray(files)).toBe(true);
    expect(files.map((file) => file.Id)).toContain(saved.businessId);
  }, TIMEOUT_MS);

  test("reads the company file's details", async () => {
    const company = await api.company.retrieve();

    expect(typeof company.Name).toBe("string");
  }, TIMEOUT_MS);

  test("lists one page of employees, with the documented page shape", async () => {
    let status;
    const page = await api.employees.list({ top: 1 }, { onResponse: (response) => (status = response.status) });

    expect(status).toBe(200);
    expect(Array.isArray(page.items)).toBe(true);
    for (const employee of page.items) expect(typeof employee.UID).toBe("string");
  }, TIMEOUT_MS);

  test("lists accounts", async () => {
    const page = await api.accounts.list({ top: 5 });

    expect(page.items.length).toBeGreaterThan(0);
  }, TIMEOUT_MS);
});

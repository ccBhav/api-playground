// Compiled (not run) by `npm run typecheck`: checks the shipped .d.ts from a TS caller's side.
import myob = require("myob-sdk");
import type { Employee, MyobRecord, Page, RequestOptions, Timesheet, ResponseContext } from "myob-sdk";
import testing = require("myob-sdk/testing");

const auth = myob.createMyobAuth({ clientId: "id", clientSecret: "secret", redirectUri: "https://x/cb" });

async function main(): Promise<void> {
  const { tokens, businessId } = await auth.handleCallback("/cb?code=c&state=s", { expectedState: "s" });
  const api = myob.createMyobClient({ auth, tokens: { ...tokens, businessId }, onRefresh: () => {} });

  const options: RequestOptions = { timeoutMs: 5_000, signal: AbortSignal.timeout(10_000) };
  const page: Page = await api.list(myob.RESOURCES.CUSTOMERS, { top: 50, filter: "IsActive eq true" }, options);
  const status: number = page.response.status;
  for await (const record of api.iterate(myob.RESOURCES.EMPLOYEES)) {
    const uid: string | undefined = record.UID;
  }

  const created = await api.create(myob.RESOURCES.CUSTOMERS, { CompanyName: "Acme" });
  const customer: MyobRecord = await api.retrieve(myob.RESOURCES.CUSTOMERS, created.uid ?? "");
  await api.update(myob.RESOURCES.CUSTOMERS, customer.UID ?? "", { ...customer, Notes: "updated" });
  await api.delete(myob.RESOURCES.CUSTOMERS, customer.UID ?? "");

  try {
    await api.get(myob.RESOURCES.COMPANY);
  } catch (error) {
    if (error instanceof myob.MyobConflictError) error.errors.map((e) => e.Name);
    if (error instanceof myob.MyobRateLimitError) error.retryAfter?.toFixed();
    if (error instanceof myob.MyobApiError) error.requestId?.toUpperCase();
  }

  // @ts-expect-error: `uid` is required
  await api.retrieve(myob.RESOURCES.CUSTOMERS);

  // Typed resources
  const employees: Page<Employee> = await api.employees.list({ top: 10 });
  const firstName: string | null | undefined = employees.items[0]?.FirstName;
  for await (const job of api.jobs.iterate()) job.Number?.toUpperCase();
  const category = await api.payrollCategories.retrieve("uid");
  if (category.Type === "Wage" || category.Type === "SomethingMyobAddsLater") void category;
  const period = { startDate: "2026-10-12T00:00:00", endDate: "2026-10-18T00:00:00" };
  const sheet: Timesheet = await api.timesheets.retrieve("employee-uid", period);
  await api.timesheets.update("employee-uid", { ...sheet, Lines: [] });
  // @ts-expect-error: a period is required
  await api.timesheets.list({ top: 5 });
  const companyName: string | undefined = (await api.company.retrieve()).Name;

  // Tokens as stored (expiresAt as a string), typed paging, company files, auth errors
  const stored = { accessToken: "a", refreshToken: "r", expiresAt: "2026-10-19T00:00:00Z", businessId: "b" };
  const fromStorage = myob.createMyobClient({ auth, tokens: stored, loadTokens: async () => stored });
  const expiresAt: Date = fromStorage.connection.getTokens().expiresAt;
  const nextEmployees: Page<Employee> | null = await employees.nextPage();
  const files: { Id: string }[] = await api.companyFiles.list();
  try {
    await auth.refresh("r");
  } catch (error) {
    if (error instanceof myob.MyobAuthError && (error.reconnectRequired || error.retryable)) void error.code;
  }

  // Generics on the generic methods
  const typed: Employee = await api.retrieve<Employee>(myob.RESOURCES.EMPLOYEES, "uid");
  const raw = await api.request<{ Name: string }>("GET", myob.RESOURCES.COMPANY);
  const name: string = raw.data.Name;
  const unknownBody: unknown = await api.get(myob.RESOURCES.COMPANY);

  // Raw responses, hooks, rate limiting
  await api.employees.retrieve("uid", { onResponse: (response: ResponseContext) => response.headers.get("x-request-id") });
  const limiter = myob.createRateLimiter({ requestsPerSecond: 4 });
  myob.createMyobClient({
    auth,
    tokens,
    rateLimit: limiter,
    appName: "constructionclock/1.0",
    loadTokens: async () => tokens,
    withRefreshLock: (fn) => fn(),
    hooks: { onRequest: (ctx) => ctx.setHeader("traceparent", "x"), onError: (ctx) => ctx.error.message },
  });

  // The mock
  const { client, mock, fake } = testing.createMockMyob({ seed: 1 });
  mock.on("employees.list").replyPages([[fake.employee()], [fake.employee({ FirstName: "Ana" })]]);
  mock.on("customers.retrieve").replyError(404, { name: "ResourceNotFound" });
  const mocked: Employee[] = await client.employees.all();
  mock.onRequest("GET", "Sale/Order/Item").reply(200, { Items: [] });

  void [status, firstName, companyName, typed, name, unknownBody, mocked, expiresAt, nextEmployees, files];
}

void main;

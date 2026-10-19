import { describe, test, expect } from "vitest";

const { createMockMyob, createFactories } = require("../testing");
const { MyobNotFoundError, MyobConflictError, MyobConnectionError, MyobTimeoutError } = require("..");

describe("createMockMyob", () => {
  test("answers unhandled operations with realistic defaults", async () => {
    const { client } = createMockMyob();

    const { items } = await client.employees.list();
    const employee = await client.employees.retrieve("e-1");
    const created = await client.jobs.create({ Number: "100" });
    const files = await client.listCompanyFiles();

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ IsIndividual: true, UID: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(employee.UID).toBe("e-1");
    expect(created.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(files[0].Id).toBeDefined();
  });

  test("is deterministic for a seed", async () => {
    const a = await createMockMyob({ seed: 7 }).client.customers.list();
    const b = await createMockMyob({ seed: 7 }).client.customers.list();
    const c = await createMockMyob({ seed: 8 }).client.customers.list();

    expect(a.items).toEqual(b.items);
    expect(a.items).not.toEqual(c.items);
  });

  test("reply and replyOnce, computed from the request", async () => {
    const { client, mock, fake } = createMockMyob();
    mock.on("employees.retrieve").reply(200, (req) => fake.employee({ UID: req.params.uid, FirstName: "Aroha" }));
    mock.on("employees.retrieve").replyOnce(200, { UID: "first" });

    expect((await client.employees.retrieve("x")).UID).toBe("first");
    expect(await client.employees.retrieve("y")).toMatchObject({ UID: "y", FirstName: "Aroha" });
  });

  test("replyError throws the SDK's real error classes", async () => {
    const { client, mock } = createMockMyob();
    mock.on("customers.retrieve").replyError(404, { requestId: "req-1" });
    mock.on("customers.update").replyError(409);

    const notFound = await client.customers.retrieve("c1").catch((e) => e);
    const conflict = await client.customers.update("c1", { UID: "c1" }).catch((e) => e);

    expect(notFound).toBeInstanceOf(MyobNotFoundError);
    expect(notFound).toMatchObject({ code: "ResourceNotFound", requestId: "req-1" });
    expect(conflict).toBeInstanceOf(MyobConflictError);
  });

  test("replyPages drives real paging", async () => {
    const { client, mock, fake } = createMockMyob();
    mock.on("jobs.list").replyPages([fake.many(fake.job, 2), fake.many(fake.job, 1)]);

    const jobs = await client.jobs.all({ top: 2 });

    expect(jobs).toHaveLength(3);
    expect(mock.calls("jobs.list")).toHaveLength(2);
    expect(mock.calls("jobs.list")[1].query.$skip).toBe("2");
    expect(mock.pending()).toEqual([]);
  });

  test("networkError and timeout", async () => {
    const { client, mock } = createMockMyob();
    mock.on("accounts.list").networkError({ once: true });
    mock.on("accounts.list").timeout({ once: true });

    await expect(client.accounts.list()).rejects.toBeInstanceOf(MyobConnectionError);
    await expect(client.accounts.list()).rejects.toBeInstanceOf(MyobTimeoutError);
    expect((await client.accounts.list()).items).toHaveLength(3);
  });

  test("records calls with parsed body and query, and reports pending handlers", async () => {
    const { client, mock } = createMockMyob();
    mock.on("timesheets.update").reply(200);
    mock.on("activities.list").reply(200, { Items: [] });
    const period = { startDate: "2026-10-12T00:00:00", endDate: "2026-10-18T00:00:00" };

    await client.timesheets.update("e1", { StartDate: period.startDate, EndDate: period.endDate, Lines: [] });
    const sheet = await client.timesheets.retrieve("e1", period);

    expect(mock.calls("timesheets.update")[0]).toMatchObject({ params: { uid: "e1" }, body: { Lines: [] } });
    expect(sheet).toMatchObject({ Employee: { UID: "e1" }, StartDate: period.startDate });
    expect(mock.pending()).toEqual(["activities.list"]);
    mock.reset();
    expect(mock.calls()).toEqual([]);
  });

  test("fails loudly on unknown operations and unmatched requests", async () => {
    const { client, mock } = createMockMyob();

    expect(() => mock.on("employee.list")).toThrow(/unknown operation "employee.list"/);
    await expect(client.get("Sale/Order")).rejects.toThrow(/no MYOB operation matches GET/);
  });

  test("the generic methods match operations too", async () => {
    const { client, mock } = createMockMyob();
    mock.on("customers.list").reply(200, { Items: [{ UID: "c1" }] });

    const page = await client.list("Contact/Customer");

    expect(page.items).toEqual([{ UID: "c1" }]);
  });
});

describe("createFactories", () => {
  test("overrides win and seed restarts the sequence", () => {
    const fake = createFactories({ seed: 3 });
    const first = fake.employee({ FirstName: "Pita" });
    fake.seed(3);
    const again = fake.employee({ FirstName: "Pita" });

    expect(first.FirstName).toBe("Pita");
    expect(again).toEqual(first);
    expect(fake.timesheet().Lines?.[0].Entries).toHaveLength(5);
  });
});

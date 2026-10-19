/** @typedef {import("../models").Customer} Customer */
/** @typedef {import("../models").Supplier} Supplier */
/** @typedef {import("../models").Employee} Employee */
/** @typedef {import("../models").Job} Job */
/** @typedef {import("../models").Activity} Activity */
/** @typedef {import("../models").PayrollCategory} PayrollCategory */
/** @typedef {import("../models").Account} Account */
/** @typedef {import("../models").TaxCode} TaxCode */
/** @typedef {import("../models").Item} Item */
/** @typedef {import("../models").Timesheet} Timesheet */
/** @typedef {import("../models").Company} Company */
/** @typedef {import("../models").MyobRef} MyobRef */
/** @typedef {import("../client").MyobRecord} MyobRecord */
/** @typedef {import("../client").MyobCompanyFile} MyobCompanyFile */

const FIRST_NAMES = ["Aroha", "Ben", "Chloe", "Dev", "Ella", "Finn", "Grace", "Hemi", "Isla", "Jack", "Mia", "Noah"];
const LAST_NAMES = ["Smith", "Ngata", "Patel", "Williams", "Brown", "Wilson", "Taylor", "Kaur", "Li", "Walker"];
const COMPANY_WORDS = ["Harbour", "Summit", "Kauri", "Coastal", "Ironbark", "Southern", "Totara", "Redwood"];
const COMPANY_KINDS = ["Builders", "Construction", "Plumbing", "Electrical", "Roofing", "Joinery"];
const ACTIVITY_NAMES = ["Site labour", "Travel", "Supervision", "Installation", "Demolition", "Cleanup"];
const PAY_CATEGORIES = /** @type {const} */ ([
  ["Base Hourly", "Wage"], ["Overtime (1.5x)", "Wage"], ["Holiday Pay", "Entitlement"],
  ["KiwiSaver", "Superannuation"], ["Union Fees", "Deduction"],
]);
// MYOB's factories should never depend on the wall clock, so dates count back from this.
const REFERENCE_DATE = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

/**
 * mulberry32: a tiny seeded PRNG, so the same seed always gives the same records.
 * @param {number} seed
 */
const prng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Seeded factories for MYOB records, typed against the SDK's own record types. Every factory takes
 * overrides, which win over the generated values.
 *
 * Zero-dependency on purpose (the SDK has none), so names come from small built-in lists rather
 * than faker.
 *
 * @param {{ seed?: number }} [options]
 */
const createFactories = ({ seed = 1 } = {}) => {
  let random = prng(seed);
  /** @param {number} min @param {number} max */
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  /** @template T @param {readonly T[]} values @returns {T} */
  const pick = (values) => values[int(0, values.length - 1)];
  const hex = (/** @type {number} */ length) =>
    Array.from({ length }, () => int(0, 15).toString(16)).join("");
  const uid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;
  const rowVersion = () => `-${int(1, 9)}${Array.from({ length: 18 }, () => int(0, 9)).join("")}`;
  const pastDate = (/** @type {number} */ maxDays) =>
    new Date(REFERENCE_DATE - int(0, maxDays) * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "");
  const base = () => ({ UID: uid(), RowVersion: rowVersion(), LastModified: pastDate(365) });
  const displayId = (/** @type {string} */ prefix) => `${prefix}${String(int(1, 99999)).padStart(5, "0")}`;
  const companyName = () => `${pick(COMPANY_WORDS)} ${pick(COMPANY_KINDS)} Ltd`;

  /** @param {Partial<Customer>} [overrides] @returns {Customer} */
  const customer = (overrides) => ({
    ...base(),
    DisplayID: displayId("CUS"),
    IsIndividual: false,
    IsActive: true,
    CompanyName: companyName(),
    FirstName: null,
    LastName: null,
    CurrentBalance: int(0, 500_000) / 100,
    ...overrides,
  });

  /** @param {Partial<Supplier>} [overrides] @returns {Supplier} */
  const supplier = (overrides) => ({
    ...base(),
    DisplayID: displayId("SUP"),
    IsIndividual: false,
    IsActive: true,
    CompanyName: companyName(),
    FirstName: null,
    LastName: null,
    ...overrides,
  });

  /** @param {Partial<Employee>} [overrides] @returns {Employee} */
  const employee = (overrides) => ({
    ...base(),
    DisplayID: displayId("EMP"),
    IsIndividual: true,
    IsActive: true,
    CompanyName: null,
    FirstName: pick(FIRST_NAMES),
    LastName: pick(LAST_NAMES),
    EmployeePayrollDetails: { UID: uid() },
    ...overrides,
  });

  /** @param {Partial<Job>} [overrides] @returns {Job} */
  const job = (overrides) => ({
    ...base(),
    Number: String(int(100, 9999)),
    Name: `${pick(COMPANY_WORDS)} St ${pick(["renovation", "new build", "fit-out", "extension"])}`,
    Description: null,
    IsHeader: false,
    IsActive: true,
    ParentJob: null,
    LinkedCustomer: null,
    PercentComplete: int(0, 100),
    StartDate: pastDate(180),
    FinishDate: null,
    TrackReimbursables: false,
    ...overrides,
  });

  /** @param {Partial<Activity>} [overrides] @returns {Activity} */
  const activity = (overrides) => ({
    ...base(),
    DisplayID: displayId("ACT"),
    Name: pick(ACTIVITY_NAMES),
    Description: null,
    Type: "Hourly",
    Status: pick(["Chargeable", "NonChargeable"]),
    UnitOfMeasurement: "Hour",
    IsActive: true,
    ...overrides,
  });

  /** @param {Partial<PayrollCategory>} [overrides] @returns {PayrollCategory} */
  const payrollCategory = (overrides) => {
    const [name, type] = pick(PAY_CATEGORIES);
    return { ...base(), Name: name, Type: type, ...overrides };
  };

  /** @param {Partial<Account>} [overrides] @returns {Account} */
  const account = (overrides) => ({
    ...base(),
    DisplayID: `${int(1, 6)}-${String(int(1000, 9999))}`,
    Name: pick(["Sales", "Wages & Salaries", "Materials", "Subcontractors", "Bank"]),
    Type: pick(["Income", "Expense", "CostOfSales", "Asset"]),
    IsHeader: false,
    IsActive: true,
    CurrentBalance: int(0, 10_000_000) / 100,
    ...overrides,
  });

  /** @param {Partial<TaxCode>} [overrides] @returns {TaxCode} */
  const taxCode = (overrides) => ({
    ...base(),
    Code: pick(["GST", "GSTX", "N-T", "FRE"]),
    Description: "Goods & Services Tax",
    Type: "GoodsAndServicesTax",
    Rate: pick([0, 10, 15]),
    ...overrides,
  });

  /** @param {Partial<Item>} [overrides] @returns {Item} */
  const item = (overrides) => ({
    ...base(),
    Number: displayId("ITM"),
    Name: pick(["Timber 90x45", "Plasterboard sheet", "Roofing screw (box)", "Concrete bag"]),
    IsActive: true,
    IsBought: true,
    IsSold: true,
    IsInventoried: true,
    ...overrides,
  });

  /** A record of a resource without a dedicated factory. @param {Partial<MyobRecord>} [overrides] @returns {MyobRecord} */
  const record = (overrides) => ({ ...base(), ...overrides });

  /**
   * A timesheet with one line of five weekdays from `StartDate`.
   * @param {Partial<Timesheet>} [overrides]
   * @returns {Timesheet}
   */
  const timesheet = (overrides = {}) => {
    const start = overrides.StartDate ?? "2025-12-29T00:00:00";
    const startMs = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
    const day = (/** @type {number} */ offset) =>
      new Date(startMs + offset * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "");
    const person = employee();
    return {
      Employee: { UID: person.UID, Name: `${person.LastName}, ${person.FirstName}`, DisplayID: person.DisplayID },
      StartDate: start,
      EndDate: day(6),
      Lines: [
        {
          PayrollCategory: { UID: uid(), Name: "Base Hourly" },
          Job: { UID: uid(), Number: String(int(100, 9999)) },
          Activity: null,
          Customer: null,
          Notes: null,
          Entries: [0, 1, 2, 3, 4].map((offset) => ({
            UID: uid(),
            Date: day(offset),
            Hours: pick([7.5, 8, 8, 8.5, 9]),
            Processed: false,
          })),
        },
      ],
      ...overrides,
    };
  };

  /** @param {Partial<Company>} [overrides] @returns {Company} */
  const company = (overrides) => ({ Name: companyName(), SerialNumber: String(int(1e11, 9e11)), ...overrides });

  /** @param {Partial<MyobCompanyFile>} [overrides] @returns {MyobCompanyFile} */
  const companyFile = (overrides) => {
    const id = uid();
    return {
      Id: id,
      Name: companyName(),
      Uri: `https://api.myob.com/accountright/${id}`,
      Country: "NZ",
      ProductVersion: "2025.4",
      ...overrides,
    };
  };

  /**
   * `count` records from one factory.
   * @template T
   * @param {(overrides?: Partial<T>) => T} factory
   * @param {number} count
   * @param {Partial<T>} [overrides]
   * @returns {T[]}
   */
  const many = (factory, count, overrides) => Array.from({ length: count }, () => factory(overrides));

  return {
    /** Restart the sequence, e.g. between tests. @param {number} next */
    seed: (next) => {
      random = prng(next);
    },
    uid,
    customer,
    supplier,
    employee,
    job,
    activity,
    payrollCategory,
    account,
    taxCode,
    item,
    record,
    timesheet,
    company,
    companyFile,
    many,
  };
};

/** @typedef {ReturnType<typeof createFactories>} MyobFactories */

module.exports = { createFactories };

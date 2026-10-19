export type Customer = import("../models").Customer;
export type Supplier = import("../models").Supplier;
export type Employee = import("../models").Employee;
export type Job = import("../models").Job;
export type Activity = import("../models").Activity;
export type PayrollCategory = import("../models").PayrollCategory;
export type Account = import("../models").Account;
export type TaxCode = import("../models").TaxCode;
export type Item = import("../models").Item;
export type Timesheet = import("../models").Timesheet;
export type Company = import("../models").Company;
export type MyobRef = import("../models").MyobRef;
export type MyobRecord = import("../client").MyobRecord;
export type MyobCompanyFile = import("../client").MyobCompanyFile;
export type MyobFactories = ReturnType<typeof createFactories>;
/**
 * Seeded factories for MYOB records, typed against the SDK's own record types. Every factory takes
 * overrides, which win over the generated values.
 *
 * Zero-dependency on purpose (the SDK has none), so names come from small built-in lists rather
 * than faker.
 *
 * @param {{ seed?: number }} [options]
 */
export function createFactories({ seed }?: {
    seed?: number;
}): {
    /** Restart the sequence, e.g. between tests. @param {number} next */
    seed: (next: number) => void;
    uid: () => string;
    customer: (overrides?: Partial<Customer>) => Customer;
    supplier: (overrides?: Partial<Supplier>) => Supplier;
    employee: (overrides?: Partial<Employee>) => Employee;
    job: (overrides?: Partial<Job>) => Job;
    activity: (overrides?: Partial<Activity>) => Activity;
    payrollCategory: (overrides?: Partial<PayrollCategory>) => PayrollCategory;
    account: (overrides?: Partial<Account>) => Account;
    taxCode: (overrides?: Partial<TaxCode>) => TaxCode;
    item: (overrides?: Partial<Item>) => Item;
    record: (overrides?: Partial<MyobRecord>) => MyobRecord;
    timesheet: (overrides?: Partial<Timesheet>) => Timesheet;
    company: (overrides?: Partial<Company>) => Company;
    companyFile: (overrides?: Partial<MyobCompanyFile>) => MyobCompanyFile;
    many: <T>(factory: (overrides?: Partial<T>) => T, count: number, overrides?: Partial<T>) => T[];
};

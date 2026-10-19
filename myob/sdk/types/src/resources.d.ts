export type MyobContact = import("./models").MyobContact;
export type Customer = import("./models").Customer;
export type Supplier = import("./models").Supplier;
export type Employee = import("./models").Employee;
export type Job = import("./models").Job;
export type Account = import("./models").Account;
export type TaxCode = import("./models").TaxCode;
export type Item = import("./models").Item;
export type Activity = import("./models").Activity;
export type PayrollCategory = import("./models").PayrollCategory;
export type MyobRecord = import("./client").MyobRecord;
/**
 * The client's typed resources (`api.employees`, `api.jobs`, ...). Each name maps to a path in
 * `RESOURCE_PATHS` below; adding a resource means adding it to both.
 */
export type MyobResources = {
    /**
     * - Every contact type; read-only in practice.
     */
    contacts: import("./client").Resource<MyobContact>;
    customers: import("./client").Resource<Customer>;
    suppliers: import("./client").Resource<Supplier>;
    employees: import("./client").Resource<Employee>;
    jobs: import("./client").Resource<Job>;
    accounts: import("./client").Resource<Account>;
    taxCodes: import("./client").Resource<TaxCode>;
    items: import("./client").Resource<Item>;
    /**
     * - Every invoice layout; read-only in practice.
     */
    invoices: import("./client").Resource<MyobRecord>;
    itemInvoices: import("./client").Resource<MyobRecord>;
    serviceInvoices: import("./client").Resource<MyobRecord>;
    activities: import("./client").Resource<Activity>;
    activitySlips: import("./client").Resource<MyobRecord>;
    payrollCategories: import("./client").Resource<PayrollCategory>;
};
/** @typedef {import("./models").MyobContact} MyobContact */
/** @typedef {import("./models").Customer} Customer */
/** @typedef {import("./models").Supplier} Supplier */
/** @typedef {import("./models").Employee} Employee */
/** @typedef {import("./models").Job} Job */
/** @typedef {import("./models").Account} Account */
/** @typedef {import("./models").TaxCode} TaxCode */
/** @typedef {import("./models").Item} Item */
/** @typedef {import("./models").Activity} Activity */
/** @typedef {import("./models").PayrollCategory} PayrollCategory */
/** @typedef {import("./client").MyobRecord} MyobRecord */
/**
 * The client's typed resources (`api.employees`, `api.jobs`, ...). Each name maps to a path in
 * `RESOURCE_PATHS` below; adding a resource means adding it to both.
 *
 * @typedef {Object} MyobResources
 * @property {import("./client").Resource<MyobContact>} contacts - Every contact type; read-only in practice.
 * @property {import("./client").Resource<Customer>} customers
 * @property {import("./client").Resource<Supplier>} suppliers
 * @property {import("./client").Resource<Employee>} employees
 * @property {import("./client").Resource<Job>} jobs
 * @property {import("./client").Resource<Account>} accounts
 * @property {import("./client").Resource<TaxCode>} taxCodes
 * @property {import("./client").Resource<Item>} items
 * @property {import("./client").Resource<MyobRecord>} invoices - Every invoice layout; read-only in practice.
 * @property {import("./client").Resource<MyobRecord>} itemInvoices
 * @property {import("./client").Resource<MyobRecord>} serviceInvoices
 * @property {import("./client").Resource<Activity>} activities
 * @property {import("./client").Resource<MyobRecord>} activitySlips
 * @property {import("./client").Resource<PayrollCategory>} payrollCategories
 */
/** @type {Readonly<Record<keyof MyobResources, string>>} */
export const RESOURCE_PATHS: Readonly<Record<keyof MyobResources, string>>;

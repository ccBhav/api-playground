const { RESOURCES } = require("./constants");

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
const RESOURCE_PATHS = Object.freeze({
  contacts: RESOURCES.CONTACTS,
  customers: RESOURCES.CUSTOMERS,
  suppliers: RESOURCES.SUPPLIERS,
  employees: RESOURCES.EMPLOYEES,
  jobs: RESOURCES.JOBS,
  accounts: RESOURCES.ACCOUNTS,
  taxCodes: RESOURCES.TAX_CODES,
  items: RESOURCES.ITEMS,
  invoices: RESOURCES.INVOICES,
  itemInvoices: RESOURCES.ITEM_INVOICES,
  serviceInvoices: RESOURCES.SERVICE_INVOICES,
  activities: RESOURCES.ACTIVITIES,
  activitySlips: RESOURCES.ACTIVITY_SLIPS,
  payrollCategories: RESOURCES.PAYROLL_CATEGORIES,
});

module.exports = { RESOURCE_PATHS };

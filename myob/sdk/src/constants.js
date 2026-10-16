const AUTHORIZE_URL = "https://secure.myob.com/oauth2/account/authorize";
const TOKEN_URL = "https://secure.myob.com/oauth2/v1/authorize";
const API_BASE_URL = "https://api.myob.com/accountright";
const API_VERSION = "v2";

/** Seconds before `expiresAt` that a token is already treated as expired. */
const DEFAULT_EXPIRY_SKEW_SECONDS = 60;

const SCOPE_NAMES = {
  COMPANY_FILE: "sme-company-file",
  COMPANY_SETTINGS: "sme-company-settings",
  GENERAL_LEDGER: "sme-general-ledger",
  BANKING: "sme-banking",
  SALES: "sme-sales",
  PURCHASES: "sme-purchases",
  INVENTORY: "sme-inventory",
  TIME_BILLING: "sme-timebilling",
  PAYROLL: "sme-payroll",
  CONTACTS_CUSTOMER: "sme-contacts-customer",
  CONTACTS_SUPPLIER: "sme-contacts-supplier",
  CONTACTS_EMPLOYEE: "sme-contacts-employee",
};

const SCOPES = Object.freeze({
  ...SCOPE_NAMES,
  ALL: Object.freeze(Object.values(SCOPE_NAMES)),
});

/**
 * AccountRight resource paths, relative to `{API_BASE_URL}/{businessId}/`. Any other path from the
 * MYOB docs works too; these are just the common ones.
 */
const RESOURCES = Object.freeze({
  COMPANY: "Company",
  ACCOUNTS: "GeneralLedger/Account",
  JOBS: "GeneralLedger/Job",
  TAX_CODES: "GeneralLedger/TaxCode",
  CONTACTS: "Contact",
  CUSTOMERS: "Contact/Customer",
  SUPPLIERS: "Contact/Supplier",
  EMPLOYEES: "Contact/Employee",
  INVOICES: "Sale/Invoice",
  ITEM_INVOICES: "Sale/Invoice/Item",
  SERVICE_INVOICES: "Sale/Invoice/Service",
  ITEMS: "Inventory/Item",
  ACTIVITIES: "TimeBilling/Activity",
  ACTIVITY_SLIPS: "TimeBilling/ActivitySlip",
  PAYROLL_CATEGORIES: "Payroll/PayrollCategory",
  TIMESHEETS: "Payroll/Timesheet",
});

module.exports = {
  AUTHORIZE_URL,
  TOKEN_URL,
  API_BASE_URL,
  API_VERSION,
  DEFAULT_EXPIRY_SKEW_SECONDS,
  SCOPES,
  RESOURCES,
};

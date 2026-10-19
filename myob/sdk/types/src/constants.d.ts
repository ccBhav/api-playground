export const AUTHORIZE_URL: "https://secure.myob.com/oauth2/account/authorize";
export const TOKEN_URL: "https://secure.myob.com/oauth2/v1/authorize";
export const API_BASE_URL: "https://api.myob.com/accountright";
export const API_VERSION: "v2";
/** Seconds before `expiresAt` that a token is already treated as expired. */
export const DEFAULT_EXPIRY_SKEW_SECONDS: 60;
/** MYOB access tokens last 20 minutes; used if a token response leaves out `expires_in`. */
export const DEFAULT_TOKEN_LIFETIME_SECONDS: 1200;
export const DEFAULT_TIMEOUT_MS: 60000;
export const DEFAULT_MAX_RETRIES: 2;
/** MYOB allows 8 calls a second per API key. */
export const DEFAULT_REQUESTS_PER_SECOND: 8;
export const SCOPES: Readonly<{
    ALL: readonly string[];
    COMPANY_FILE: string;
    COMPANY_SETTINGS: string;
    GENERAL_LEDGER: string;
    BANKING: string;
    SALES: string;
    PURCHASES: string;
    INVENTORY: string;
    TIME_BILLING: string;
    PAYROLL: string;
    CONTACTS_CUSTOMER: string;
    CONTACTS_SUPPLIER: string;
    CONTACTS_EMPLOYEE: string;
}>;
/**
 * AccountRight resource paths, relative to `{API_BASE_URL}/{businessId}/`. Any other path from the
 * MYOB docs works too; these are just the common ones.
 */
export const RESOURCES: Readonly<{
    COMPANY: "Company";
    ACCOUNTS: "GeneralLedger/Account";
    JOBS: "GeneralLedger/Job";
    TAX_CODES: "GeneralLedger/TaxCode";
    CONTACTS: "Contact";
    CUSTOMERS: "Contact/Customer";
    SUPPLIERS: "Contact/Supplier";
    EMPLOYEES: "Contact/Employee";
    INVOICES: "Sale/Invoice";
    ITEM_INVOICES: "Sale/Invoice/Item";
    SERVICE_INVOICES: "Sale/Invoice/Service";
    ITEMS: "Inventory/Item";
    ACTIVITIES: "TimeBilling/Activity";
    ACTIVITY_SLIPS: "TimeBilling/ActivitySlip";
    PAYROLL_CATEGORIES: "Payroll/PayrollCategory";
    TIMESHEETS: "Payroll/Timesheet";
}>;

/**
 * Record types for the resources ConstructionClock uses, from MYOB's AccountRight API reference.
 * They are deliberately loose: every field is optional and unknown fields pass through, so a field
 * MYOB adds (or one left out here) never breaks a caller. Server enums are open (`(string & {})`).
 *
 * These are a starting point, not MYOB's full schemas. Check a field against the API reference
 * before relying on it, and add fields here as they're needed.
 */

/**
 * A link to another record, as MYOB embeds them (e.g. `Employee` on a timesheet).
 * @typedef {Object} MyobRef
 * @property {string} [UID]
 * @property {string} [Name]
 * @property {string} [DisplayID]
 * @property {string} [Number] - Jobs are referenced by number.
 * @property {string} [URI]
 */

/**
 * Fields every AccountRight record has.
 * @typedef {Object} MyobRecordBase
 * @property {string} [UID]
 * @property {string} [RowVersion] - Send back unchanged on update; MYOB uses it to detect conflicts.
 * @property {string} [URI]
 * @property {string} [LastModified] - ISO date-time.
 */

/**
 * Fields shared by customers, suppliers and employees.
 * @typedef {MyobRecordBase & {
 *   DisplayID?: string,
 *   IsIndividual?: boolean,
 *   IsActive?: boolean,
 *   CompanyName?: string | null,
 *   FirstName?: string | null,
 *   LastName?: string | null,
 *   Addresses?: Array<Record<string, unknown>>,
 *   Notes?: string | null,
 *   CurrentBalance?: number,
 *   [field: string]: unknown,
 * }} MyobContact
 */

/** @typedef {MyobContact & { SellingDetails?: Record<string, unknown> }} Customer */
/** @typedef {MyobContact & { BuyingDetails?: Record<string, unknown> }} Supplier */

/**
 * @typedef {MyobContact & {
 *   EmployeePayrollDetails?: MyobRef,
 *   EmployeePaymentDetails?: MyobRef,
 *   EmployeeStandardPay?: MyobRef,
 * }} Employee
 */

/**
 * @typedef {MyobRecordBase & {
 *   Number?: string,
 *   Name?: string,
 *   Description?: string | null,
 *   IsHeader?: boolean,
 *   IsActive?: boolean,
 *   ParentJob?: MyobRef | null,
 *   LinkedCustomer?: MyobRef | null,
 *   PercentComplete?: number,
 *   StartDate?: string | null,
 *   FinishDate?: string | null,
 *   Contact?: string | null,
 *   Manager?: string | null,
 *   TrackReimbursables?: boolean,
 *   [field: string]: unknown,
 * }} Job
 */

/**
 * A time-billing activity.
 * @typedef {MyobRecordBase & {
 *   DisplayID?: string,
 *   Name?: string,
 *   Description?: string | null,
 *   Type?: "Hourly" | "NonHourly" | (string & {}),
 *   Status?: "Chargeable" | "NonChargeable" | (string & {}),
 *   UnitOfMeasurement?: string | null,
 *   ChargeableDetails?: Record<string, unknown> | null,
 *   IsActive?: boolean,
 *   [field: string]: unknown,
 * }} Activity
 */

/**
 * @typedef {MyobRecordBase & {
 *   Name?: string,
 *   Type?: "Wage" | "Superannuation" | "Deduction" | "Expense" | "Entitlement" | "Tax" | (string & {}),
 *   [field: string]: unknown,
 * }} PayrollCategory
 */

/**
 * @typedef {MyobRecordBase & {
 *   DisplayID?: string,
 *   Name?: string,
 *   Type?: "Asset" | "Liability" | "Equity" | "Income" | "CostOfSales" | "Expense" | "OtherIncome" | "OtherExpense" | (string & {}),
 *   IsHeader?: boolean,
 *   IsActive?: boolean,
 *   CurrentBalance?: number,
 *   [field: string]: unknown,
 * }} Account
 */

/**
 * @typedef {MyobRecordBase & {
 *   Code?: string,
 *   Description?: string,
 *   Type?: string,
 *   Rate?: number,
 *   [field: string]: unknown,
 * }} TaxCode
 */

/**
 * @typedef {MyobRecordBase & {
 *   Number?: string,
 *   Name?: string,
 *   IsActive?: boolean,
 *   IsBought?: boolean,
 *   IsSold?: boolean,
 *   IsInventoried?: boolean,
 *   [field: string]: unknown,
 * }} Item
 */

/**
 * One day's hours on a timesheet line.
 * @typedef {{ UID?: string, Date?: string, Hours?: number, Processed?: boolean, [field: string]: unknown }} TimesheetEntry
 */

/**
 * @typedef {{
 *   PayrollCategory?: MyobRef,
 *   Job?: MyobRef | null,
 *   Activity?: MyobRef | null,
 *   Customer?: MyobRef | null,
 *   Notes?: string | null,
 *   Entries?: TimesheetEntry[],
 *   [field: string]: unknown,
 * }} TimesheetLine
 */

/**
 * One employee's timesheet for a period. MYOB has no UID for a timesheet: it is addressed by the
 * employee's UID plus `StartDate` and `EndDate`.
 * @typedef {{
 *   Employee?: MyobRef,
 *   StartDate?: string,
 *   EndDate?: string,
 *   Lines?: TimesheetLine[],
 *   URI?: string,
 *   [field: string]: unknown,
 * }} Timesheet
 */

/**
 * The company file's own details, from `api.company.retrieve()`.
 * @typedef {{ Name?: string, SerialNumber?: string, URI?: string, [field: string]: unknown }} Company
 */

module.exports = {};

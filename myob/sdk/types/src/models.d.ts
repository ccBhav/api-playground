/**
 * A link to another record, as MYOB embeds them (e.g. `Employee` on a timesheet).
 */
export type MyobRef = {
    UID?: string | undefined;
    Name?: string | undefined;
    DisplayID?: string | undefined;
    /**
     * - Jobs are referenced by number.
     */
    Number?: string | undefined;
    URI?: string | undefined;
};
/**
 * Fields every AccountRight record has.
 */
export type MyobRecordBase = {
    UID?: string | undefined;
    /**
     * - Send back unchanged on update; MYOB uses it to detect conflicts.
     */
    RowVersion?: string | undefined;
    URI?: string | undefined;
    /**
     * - ISO date-time.
     */
    LastModified?: string | undefined;
};
/**
 * Fields shared by customers, suppliers and employees.
 */
export type MyobContact = MyobRecordBase & {
    DisplayID?: string;
    IsIndividual?: boolean;
    IsActive?: boolean;
    CompanyName?: string | null;
    FirstName?: string | null;
    LastName?: string | null;
    Addresses?: Array<Record<string, unknown>>;
    Notes?: string | null;
    CurrentBalance?: number;
    [field: string]: unknown;
};
export type Customer = MyobContact & {
    SellingDetails?: Record<string, unknown>;
};
export type Supplier = MyobContact & {
    BuyingDetails?: Record<string, unknown>;
};
export type Employee = MyobContact & {
    EmployeePayrollDetails?: MyobRef;
    EmployeePaymentDetails?: MyobRef;
    EmployeeStandardPay?: MyobRef;
};
export type Job = MyobRecordBase & {
    Number?: string;
    Name?: string;
    Description?: string | null;
    IsHeader?: boolean;
    IsActive?: boolean;
    ParentJob?: MyobRef | null;
    LinkedCustomer?: MyobRef | null;
    PercentComplete?: number;
    StartDate?: string | null;
    FinishDate?: string | null;
    Contact?: string | null;
    Manager?: string | null;
    TrackReimbursables?: boolean;
    [field: string]: unknown;
};
/**
 * A time-billing activity.
 */
export type Activity = MyobRecordBase & {
    DisplayID?: string;
    Name?: string;
    Description?: string | null;
    Type?: "Hourly" | "NonHourly" | (string & {});
    Status?: "Chargeable" | "NonChargeable" | (string & {});
    UnitOfMeasurement?: string | null;
    ChargeableDetails?: Record<string, unknown> | null;
    IsActive?: boolean;
    [field: string]: unknown;
};
export type PayrollCategory = MyobRecordBase & {
    Name?: string;
    Type?: "Wage" | "Superannuation" | "Deduction" | "Expense" | "Entitlement" | "Tax" | (string & {});
    [field: string]: unknown;
};
export type Account = MyobRecordBase & {
    DisplayID?: string;
    Name?: string;
    Type?: "Asset" | "Liability" | "Equity" | "Income" | "CostOfSales" | "Expense" | "OtherIncome" | "OtherExpense" | (string & {});
    IsHeader?: boolean;
    IsActive?: boolean;
    CurrentBalance?: number;
    [field: string]: unknown;
};
export type TaxCode = MyobRecordBase & {
    Code?: string;
    Description?: string;
    Type?: string;
    Rate?: number;
    [field: string]: unknown;
};
export type Item = MyobRecordBase & {
    Number?: string;
    Name?: string;
    IsActive?: boolean;
    IsBought?: boolean;
    IsSold?: boolean;
    IsInventoried?: boolean;
    [field: string]: unknown;
};
/**
 * One day's hours on a timesheet line.
 */
export type TimesheetEntry = {
    UID?: string;
    Date?: string;
    Hours?: number;
    Processed?: boolean;
    [field: string]: unknown;
};
export type TimesheetLine = {
    PayrollCategory?: MyobRef;
    Job?: MyobRef | null;
    Activity?: MyobRef | null;
    Customer?: MyobRef | null;
    Notes?: string | null;
    Entries?: TimesheetEntry[];
    [field: string]: unknown;
};
/**
 * One employee's timesheet for a period. MYOB has no UID for a timesheet: it is addressed by the
 * employee's UID plus `StartDate` and `EndDate`.
 */
export type Timesheet = {
    Employee?: MyobRef;
    StartDate?: string;
    EndDate?: string;
    Lines?: TimesheetLine[];
    URI?: string;
    [field: string]: unknown;
};
/**
 * The company file's own details, from `api.company.retrieve()`.
 */
export type Company = {
    Name?: string;
    SerialNumber?: string;
    URI?: string;
    [field: string]: unknown;
};

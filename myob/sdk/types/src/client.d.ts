export type MyobAuth = import("./auth").MyobAuth;
export type MyobConnection = import("./auth").MyobConnection;
export type MyobLogger = import("./options").MyobLogger;
export type MyobTokens = import("./tokens").MyobTokens;
export type RateLimitSetting = import("./rateLimiter").RateLimitSetting;
export type MyobError = import("./errors").MyobError;
export type Timesheet = import("./models").Timesheet;
export type Company = import("./models").Company;
export type MyobResources = import("./resources").MyobResources;
/**
 * A MYOB record. Fields are MYOB's PascalCase names; see the AccountRight API reference.
 */
export type MyobRecord = {
    UID?: string;
    RowVersion?: string;
    [field: string]: unknown;
};
/**
 * A company file from `companyFiles.list()`.
 */
export type MyobCompanyFile = {
    Id: string;
    Name?: string;
    Uri?: string;
    [field: string]: unknown;
};
/**
 * OData options are camelCase here and sent as `$top`, `$skip`, `$filter` and `$orderby`.
 * Any other key is sent as-is (e.g. `StartDate` for timesheets).
 * MYOB allows `top` up to 1000 and defaults to 400.
 */
export type ListQuery = {
    top?: number | undefined;
    skip?: number | undefined;
    /**
     * - e.g. `"LastName eq 'Smith'"`.
     */
    filter?: string | undefined;
    /**
     * - e.g. `"LastModified desc"`.
     */
    orderBy?: string | undefined;
};
/**
 * Passed to `hooks.onRequest` before each attempt; the same `state` object reaches `onResponse`
 * or `onError` for that attempt, so a tracing span can be stored on it.
 */
export type RequestContext = {
    method: string;
    url: string;
    /**
     * - 1 for the first try, 2 for the first retry, and so on.
     */
    attempt: number;
    /**
     * - Yours to use.
     */
    state: Record<string, unknown>;
    /**
     * - Add a request header, e.g. `traceparent`.
     */
    setHeader: (name: string, value: string) => void;
};
export type ResponseContext = RequestContext & {
    status: number;
    headers: Headers;
    durationMs: number;
};
/**
 * No response: connection error, timeout or abort, or the attempt failed before it was sent (the
 * access token couldn't be refreshed, or the caller aborted while waiting for a rate-limit slot).
 * `error` is the error the call throws: a `MyobError`, or whatever your `onRefresh` threw.
 */
export type ErrorContext = RequestContext & {
    error: Error;
    durationMs: number;
};
/**
 * Observability hooks, called for every attempt (retries included). `onRequest` fires first, then
 * exactly one of `onResponse` or `onError`. Their return values are ignored, and an exception in
 * one is logged as a warning instead of failing the request.
 */
export type MyobHooks = {
    onRequest?: ((context: RequestContext) => unknown) | undefined;
    /**
     * - Any HTTP response, error statuses included.
     */
    onResponse?: ((context: ResponseContext) => unknown) | undefined;
    onError?: ((context: ErrorContext) => unknown) | undefined;
};
/**
 * Per-request overrides; the last argument of every client method.
 */
export type RequestOptions = {
    /**
     * - Per attempt. Defaults to the client's `timeoutMs`.
     */
    timeoutMs?: number | undefined;
    /**
     * - Defaults to the client's `maxRetries`.
     */
    maxRetries?: number | undefined;
    /**
     * - Cancels the request, including any wait between retries.
     */
    signal?: AbortSignal | undefined;
    /**
     * - Extra headers for this request.
     */
    headers?: Record<string, string> | undefined;
    /**
     * - Receives the raw response
     * (status, headers, timing) that the call returns or throws on; once per page for `iterate`/`all`.
     */
    onResponse?: ((response: ResponseContext) => unknown) | undefined;
};
export type WriteOptions = RequestOptions & {
    returnBody?: boolean;
};
export type RawResponse = {
    status: number;
    headers: Headers;
};
export type Page<T = MyobRecord> = {
    items: T[];
    /**
     * - Total matching records, when MYOB sends it.
     */
    count: number | undefined;
    /**
     * - Absolute URL of the next page, or null on the last one.
     */
    nextPageLink: string | null;
    /**
     * - Fetch the next page (with the same request
     * options), or null on the last one.
     */
    nextPage: () => Promise<Page<T> | null>;
    response: RawResponse;
};
export type CreateResult<T = MyobRecord> = {
    /**
     * - Taken from MYOB's `Location` header.
     */
    uid: string | undefined;
    location: string | undefined;
    /**
     * - The created record when `returnBody` was set.
     */
    data: T | undefined;
};
/**
 * One collection, e.g. `api.employees`.
 */
export type Resource<T = MyobRecord> = {
    /**
     * - Relative to the company file, e.g. `"Contact/Employee"`.
     */
    path: string;
    list: (query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<Page<T>>;
    iterate: (query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => AsyncGenerator<T, void, undefined>;
    all: (query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<T[]>;
    retrieve: (uid: string, options?: RequestOptions) => Promise<T>;
    create: (body: Partial<T>, options?: WriteOptions) => Promise<CreateResult<T>>;
    update: (uid: string, body: Partial<T>, options?: WriteOptions) => Promise<T | undefined>;
    delete: (uid: string, options?: RequestOptions) => Promise<void>;
};
/**
 * A timesheet period. Sent as `StartDate` and `EndDate`, in the format MYOB documents
 * (e.g. `"2026-10-12T00:00:00"`).
 */
export type TimesheetPeriod = {
    startDate: string;
    endDate: string;
};
/**
 * `api.timesheets`. MYOB addresses a timesheet by employee UID and period rather than by its own UID.
 */
export type TimesheetsResource = {
    path: string;
    list: (query: TimesheetPeriod & ListQuery, options?: RequestOptions) => Promise<Page<Timesheet>>;
    iterate: (query: TimesheetPeriod & ListQuery, options?: RequestOptions) => AsyncGenerator<Timesheet, void, undefined>;
    all: (query: TimesheetPeriod & ListQuery, options?: RequestOptions) => Promise<Timesheet[]>;
    retrieve: (employeeUid: string, period: TimesheetPeriod, options?: RequestOptions) => Promise<Timesheet>;
    /**
     * -
     * Replaces the employee's timesheet for the period in `timesheet.StartDate`/`EndDate`.
     */
    update: (employeeUid: string, timesheet: Timesheet, options?: WriteOptions) => Promise<Timesheet | undefined>;
};
/**
 * Pass either `connection`, or `auth` plus `tokens` (the client then calls `auth.connect` itself).
 */
export type MyobClientConfig = {
    /**
     * - From `createMyobAuth(...).connect(...)`.
     */
    connection?: import("./auth").MyobConnection | undefined;
    /**
     * - From `createMyobAuth(...)`; use with `tokens`.
     */
    auth?: import("./auth").MyobAuth | undefined;
    /**
     * - Stored tokens; their
     * `businessId` is used when `businessId` isn't given.
     */
    tokens?: (Omit<Partial<import("./tokens").MyobTokens>, "expiresAt"> & {
        expiresAt?: Date | string | number | null;
    } & {
        businessId?: string;
    }) | undefined;
    /**
     * - With `auth`: persist refreshed tokens.
     */
    onRefresh?: ((tokens: MyobTokens) => unknown) | undefined;
    /**
     * - With `auth`: see `connect`.
     */
    skewSeconds?: number | undefined;
    /**
     * - With `auth`: see `connect`.
     */
    loadTokens?: import("./auth").ConnectOptions["loadTokens"];
    /**
     * - With `auth`: see `connect`.
     */
    withRefreshLock?: import("./auth").ConnectOptions["withRefreshLock"];
    /**
     * - The company file. Needed for everything except `companyFiles.list`.
     */
    businessId?: string | undefined;
    /**
     * - Only for company
     * files that ask for their own login; sent as `x-myobapi-cftoken`.
     */
    companyFileCredentials?: {
        username: string;
        password?: string;
    } | undefined;
    /**
     * - Defaults to `API_BASE_URL`.
     */
    baseUrl?: string | undefined;
    /**
     * - Per attempt. Defaults to 60000.
     */
    timeoutMs?: number | undefined;
    /**
     * - Defaults to 2.
     */
    maxRetries?: number | undefined;
    /**
     * - Defaults to the connection's shared limiter (8
     * requests a second per API key, set on `createMyobAuth`). `false` turns pacing off.
     */
    rateLimit?: import("./rateLimiter").RateLimitSetting | undefined;
    hooks?: MyobHooks | undefined;
    /**
     * - Appended to the `User-Agent`. Defaults to the auth's `appName`.
     */
    appName?: string | undefined;
    logger?: import("./options").MyobLogger | undefined;
    /**
     * - Custom `fetch` for proxies, tracing or tests.
     */
    fetch?: typeof fetch | undefined;
};
/**
 * Client for one company file. Every call gets fresh headers from the connection, so tokens are
 * refreshed automatically. Requests are paced, time out, and failures that are safe to retry are
 * retried with backoff; a 401 for a stale token triggers one refresh and a retry.
 *
 * @param {MyobClientConfig} config
 */
export function createMyobClient(config: MyobClientConfig): {
    timesheets: TimesheetsResource;
    company: {
        /**
         * The company file's details.
         * @param {RequestOptions} [options]
         * @returns {Promise<Company>}
         */
        retrieve: (options?: RequestOptions) => Promise<Company>;
    };
    companyFiles: {
        /**
         * Company files this login can see. Doesn't need `businessId`.
         * @param {RequestOptions} [options]
         * @returns {Promise<MyobCompanyFile[]>}
         */
        list: (options?: RequestOptions) => Promise<MyobCompanyFile[]>;
    };
    request: <T = unknown>(method: string, path: string, options?: {
        query?: Record<string, unknown>;
        body?: unknown;
    } & RequestOptions) => Promise<RawResponse & {
        data: T;
    }>;
    get: <T = unknown>(path: string, query?: Record<string, unknown>, options?: RequestOptions) => Promise<T>;
    listCompanyFiles: (options?: RequestOptions) => Promise<MyobCompanyFile[]>;
    list: <T = MyobRecord>(path: string, query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<Page<T>>;
    iterate: <T = MyobRecord>(path: string, query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => AsyncGenerator<T, void, undefined>;
    all: <T = MyobRecord>(path: string, query?: ListQuery & Record<string, unknown>, options?: RequestOptions) => Promise<T[]>;
    retrieve: <T = MyobRecord>(path: string, uid: string, options?: RequestOptions) => Promise<T>;
    create: <T = MyobRecord>(path: string, body: Partial<T>, { returnBody, ...options }?: WriteOptions) => Promise<CreateResult<T>>;
    update: <T = MyobRecord>(path: string, uid: string, body: Partial<T>, { returnBody, ...options }?: WriteOptions) => Promise<T | undefined>;
    delete: (path: string, uid: string, options?: RequestOptions) => Promise<void>;
    /**
     * - Every contact type; read-only in practice.
     */
    contacts: import("./client").Resource<import("./resources").MyobContact>;
    customers: import("./client").Resource<import("./resources").Customer>;
    suppliers: import("./client").Resource<import("./resources").Supplier>;
    employees: import("./client").Resource<import("./resources").Employee>;
    jobs: import("./client").Resource<import("./resources").Job>;
    accounts: import("./client").Resource<import("./resources").Account>;
    taxCodes: import("./client").Resource<import("./resources").TaxCode>;
    items: import("./client").Resource<import("./resources").Item>;
    /**
     * - Every invoice layout; read-only in practice.
     */
    invoices: import("./client").Resource<import("./resources").MyobRecord>;
    itemInvoices: import("./client").Resource<import("./resources").MyobRecord>;
    serviceInvoices: import("./client").Resource<import("./resources").MyobRecord>;
    activities: import("./client").Resource<import("./resources").Activity>;
    activitySlips: import("./client").Resource<import("./resources").MyobRecord>;
    payrollCategories: import("./client").Resource<import("./resources").PayrollCategory>;
    businessId: string | undefined;
    connection: import("./auth").MyobConnection;
};
/**
 * `x-myobapi-cftoken` value: Base64 of `username:password` for the company file.
 * @param {{ username: string, password?: string }} credentials
 */
export function encodeCfToken({ username, password }: {
    username: string;
    password?: string;
}): string;

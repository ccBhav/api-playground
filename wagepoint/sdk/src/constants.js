const TOKEN_URL = "https://payroll.wagepoint.com/prod/identity/connect/token";
const API_BASE_URL = "https://api.wagepoint.com";

/** The scope Wagepoint's quick start requests for the public API. */
const DEFAULT_SCOPE = "services";

/** Seconds before `expiresAt` that a token is already treated as expired. */
const DEFAULT_EXPIRY_SKEW_SECONDS = 60;

/** Wagepoint's list page size in its examples; also the size `iterate` uses when none is given. */
const DEFAULT_PAGE_SIZE = 100;

/** Wagepoint accepts 1 to 100 time entries per POST. */
const MAX_TIME_ENTRIES_PER_REQUEST = 100;

/**
 * Resource paths. A path starting with `/` is relative to `API_BASE_URL`; any other path is relative
 * to the client's company, i.e. `{API_BASE_URL}/v1/companies/{companyId}/`.
 */
const RESOURCES = Object.freeze({
  COMPANIES: "/v1/companies",
  PERSONS: "persons",
  TIME_ENTRIES: "time-entries",
});

module.exports = {
  TOKEN_URL,
  API_BASE_URL,
  DEFAULT_SCOPE,
  DEFAULT_EXPIRY_SKEW_SECONDS,
  DEFAULT_PAGE_SIZE,
  MAX_TIME_ENTRIES_PER_REQUEST,
  RESOURCES,
};

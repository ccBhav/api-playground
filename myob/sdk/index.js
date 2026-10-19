const { createMyobAuth } = require("./src/auth");
const { createMyobClient, encodeCfToken } = require("./src/client");
const { API_BASE_URL, API_VERSION, RESOURCES, SCOPES } = require("./src/constants");
const {
  MyobError,
  MyobConnectionError,
  MyobTimeoutError,
  MyobAbortError,
  MyobAuthError,
  MyobApiError,
  MyobBadRequestError,
  MyobAuthenticationError,
  MyobPermissionDeniedError,
  MyobNotFoundError,
  MyobConflictError,
  MyobRateLimitError,
  MyobInternalServerError,
} = require("./src/errors");
const { createRateLimiter } = require("./src/rateLimiter");
const { isExpired } = require("./src/tokens");

/** @typedef {import("./src/auth").MyobAuth} MyobAuth */
/** @typedef {import("./src/auth").MyobAuthConfig} MyobAuthConfig */
/** @typedef {import("./src/auth").MyobConnection} MyobConnection */
/** @typedef {import("./src/auth").ConnectOptions} ConnectOptions */
/** @typedef {import("./src/auth").CallbackOptions} CallbackOptions */
/** @typedef {import("./src/auth").CallbackResult} CallbackResult */
/** @typedef {import("./src/auth").TokenRequestOptions} TokenRequestOptions */
/** @typedef {import("./src/client").MyobClientConfig} MyobClientConfig */
/** @typedef {import("./src/client").RequestOptions} RequestOptions */
/** @typedef {import("./src/client").WriteOptions} WriteOptions */
/** @typedef {import("./src/client").MyobHooks} MyobHooks */
/** @typedef {import("./src/client").RequestContext} RequestContext */
/** @typedef {import("./src/client").ResponseContext} ResponseContext */
/** @typedef {import("./src/client").ErrorContext} ErrorContext */
/** @typedef {import("./src/client").TimesheetPeriod} TimesheetPeriod */
/** @typedef {import("./src/client").TimesheetsResource} TimesheetsResource */
/** @template [T=MyobRecord] @typedef {import("./src/client").Resource<T>} Resource */
/** @typedef {import("./src/client").ListQuery} ListQuery */
/** @typedef {import("./src/client").MyobRecord} MyobRecord */
/** @typedef {import("./src/client").MyobCompanyFile} MyobCompanyFile */
/** @template [T=MyobRecord] @typedef {import("./src/client").CreateResult<T>} CreateResult */
/** @typedef {import("./src/client").RawResponse} RawResponse */
/** @template [T=MyobRecord] @typedef {import("./src/client").Page<T>} Page */
/** @typedef {ReturnType<typeof createMyobClient>} MyobClient */
/** @typedef {import("./src/errors").MyobErrorDetail} MyobErrorDetail */
/** @typedef {import("./src/options").MyobLogger} MyobLogger */
/** @typedef {import("./src/tokens").MyobTokens} MyobTokens */
/** @typedef {import("./src/rateLimiter").RateLimiter} RateLimiter */
/** @typedef {import("./src/rateLimiter").RateLimitOptions} RateLimitOptions */
/** @typedef {import("./src/rateLimiter").RateLimitSetting} RateLimitSetting */
/** @typedef {import("./src/resources").MyobResources} MyobResources */
/** @typedef {import("./src/models").MyobRef} MyobRef */
/** @typedef {import("./src/models").MyobContact} MyobContact */
/** @typedef {import("./src/models").Customer} Customer */
/** @typedef {import("./src/models").Supplier} Supplier */
/** @typedef {import("./src/models").Employee} Employee */
/** @typedef {import("./src/models").Job} Job */
/** @typedef {import("./src/models").Activity} Activity */
/** @typedef {import("./src/models").PayrollCategory} PayrollCategory */
/** @typedef {import("./src/models").Account} Account */
/** @typedef {import("./src/models").TaxCode} TaxCode */
/** @typedef {import("./src/models").Item} Item */
/** @typedef {import("./src/models").Timesheet} Timesheet */
/** @typedef {import("./src/models").TimesheetLine} TimesheetLine */
/** @typedef {import("./src/models").TimesheetEntry} TimesheetEntry */
/** @typedef {import("./src/models").Company} Company */

module.exports = {
  createMyobAuth,
  createMyobClient,
  createRateLimiter,
  MyobError,
  MyobConnectionError,
  MyobTimeoutError,
  MyobAbortError,
  MyobAuthError,
  MyobApiError,
  MyobBadRequestError,
  MyobAuthenticationError,
  MyobPermissionDeniedError,
  MyobNotFoundError,
  MyobConflictError,
  MyobRateLimitError,
  MyobInternalServerError,
  SCOPES,
  RESOURCES,
  API_BASE_URL,
  API_VERSION,
  encodeCfToken,
  isExpired,
};

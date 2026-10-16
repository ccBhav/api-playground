const { createWagepointAuth } = require("./src/auth");
const { createWagepointClient } = require("./src/client");
const {
  API_BASE_URL,
  DEFAULT_SCOPE,
  MAX_TIME_ENTRIES_PER_REQUEST,
  RESOURCES,
  TOKEN_URL,
} = require("./src/constants");
const { WagepointApiError, WagepointAuthError } = require("./src/errors");
const { isExpired } = require("./src/tokens");

module.exports = {
  createWagepointAuth,
  createWagepointClient,
  WagepointAuthError,
  WagepointApiError,
  RESOURCES,
  API_BASE_URL,
  TOKEN_URL,
  DEFAULT_SCOPE,
  MAX_TIME_ENTRIES_PER_REQUEST,
  isExpired,
};

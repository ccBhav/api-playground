/**
 * Credentials come from the environment — `make run` sources `.env` (gitignored)
 * before starting node. See `.env.example` for the variables to set.
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
};

export const CONFIG = {
  BASE_URL: process.env.PAYWORKS_BASE_URL ?? "https://connect.payworks.ca",
  CUSTOMER_NUMBER: required("PAYWORKS_CUSTOMER_NUMBER"),
  CLIENT_ID: required("PAYWORKS_CLIENT_ID"),
  CLIENT_SECRET: required("PAYWORKS_CLIENT_SECRET"),
  APIS: {
    EMPLOYEE: "employee",
    AUTH: "authenticate",
    TIMESHEET: "ca-pw-timemanagement-exp",
    PAYROLL: "ca-pw-payroll-exp",
  },
};

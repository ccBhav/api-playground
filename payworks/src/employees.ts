import axios from "axios";
import { CONFIG } from "./config.ts";

/**
 * Payworks sits behind a gateway that caps the request URI at roughly 1536
 * bytes and answers an over-long URL with a misleading 404 "Resource not
 * found". Keep the serialized query comfortably under that, so batches shrink
 * automatically as employee ids get longer.
 */
const MAX_QUERY_LENGTH = 1400;

const paramLength = (employeeId: number) =>
  `employeeIds=${employeeId}&`.length;

/** Split ids into batches bounded by serialized query length. */
const chunk = (employeeIds: number[]): number[][] => {
  const batches: number[][] = [];
  let batch: number[] = [];
  let length = 0;

  for (const employeeId of employeeIds) {
    const next = paramLength(employeeId);
    if (batch.length > 0 && length + next > MAX_QUERY_LENGTH) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(employeeId);
    length += next;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
};

const fetchEmployeeBatch = async (token: any, employeeIds: number[]) => {
  try {
    const response = await axios.get(
      `${CONFIG.BASE_URL}/${CONFIG.APIS.EMPLOYEE}/api/v1/employees`,
      {
        auth: {
          username: CONFIG.CLIENT_ID,
          password: CONFIG.CLIENT_SECRET,
        },
        headers: {
          Accept: "application/json",
          ...token,
        },
        params: { employeeIds },
        paramsSerializer: { indexes: null },
        timeout: 10_000,
      },
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        "getEmployees failed",
        error.response?.status,
        error.response?.data,
      );
    }
    throw error;
  }
};

export const getEmployees = async (token: any, employeeIds: number[]) => {
  const results = [];
  for (const batch of chunk(employeeIds)) {
    const data = await fetchEmployeeBatch(token, batch);
    results.push(...(Array.isArray(data) ? data : [data]));
  }

  return results;
};

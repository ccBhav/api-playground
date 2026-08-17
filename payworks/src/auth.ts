// https://connect.payworks.ca/authenticate/api/v1/auth
import axios from "axios";
import { CONFIG } from "./config.ts";

type AuthResponse = {
  access_token: string;
  expires_in: number;
};

export const auth = async () => {
  const body = {
    customerNumber: CONFIG.CUSTOMER_NUMBER,
  };

  try {
    const response = await axios.post<AuthResponse>(
      `${CONFIG.BASE_URL}/${CONFIG.APIS.AUTH}/api/v1/auth`,
      body,
      {
        auth: {
          username: CONFIG.CLIENT_ID,
          password: CONFIG.CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10_000,
      },
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Payworks answered, but with a non-2xx status
      console.error(
        "auth failed",
        error.response?.status,
        error.response?.data,
      );
    }
    throw error;
  }
};

import Welcome from "../components/Auth/Welcome";
import { AuthSource } from "../services/auth";
import { getApiHost } from "../services/utils";

const apiHost = getApiHost();

let token: string;
let createdAt: number;
let loggingIn: Promise<{ isAuthenticated: boolean }>;

async function refreshToken(): Promise<void> {
  // Token expires after 30 minutes, if we're within 29 minutes, no need to refresh
  if (token && createdAt > Date.now() - 29 * 60 * 1000) {
    return;
  }

  const res = await fetch(apiHost + "/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  const data: {
    token?: string;
    email?: string;
  } = await res.json();

  token = data.token || "";
  createdAt = Date.now();
}

const localAuthSource: AuthSource = {
  init: async () => {
    await refreshToken();

    return {
      isAuthenticated: !!token,
    };
  },
  login: async ({ setAuthComponent }) => {
    if (token) {
      return {
        isAuthenticated: true,
      };
    }

    if (loggingIn) {
      return loggingIn;
    }
    loggingIn = new Promise((resolve) => {
      setAuthComponent(() => {
        return (
          <Welcome
            onSuccess={(t) => {
              token = t;
              createdAt = Date.now();
              setAuthComponent(null);
              resolve({
                isAuthenticated: true,
              });
              loggingIn = null;
            }}
          />
        );
      });
    });
    return loggingIn;
  },
  logout: async () => {
    token = "";
    createdAt = 0;
    await fetch(apiHost + "/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  },
  getJWT: async () => {
    await refreshToken();
    return token;
  },
};

export default localAuthSource;

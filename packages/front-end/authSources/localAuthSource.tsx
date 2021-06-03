import Welcome from "../components/Auth/Welcome";
import { AuthSource } from "../services/auth";
import { getApiHost } from "../services/env";

let newInstallation = false;
let token: string;
let createdAt: number;
let loggingIn: Promise<{ isAuthenticated: boolean }>;

async function refreshToken(): Promise<void> {
  // Token expires after 30 minutes, if we're within 29 minutes, no need to refresh
  if (token && createdAt > Date.now() - 29 * 60 * 1000) {
    return;
  }

  const res = await fetch(getApiHost() + "/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    // try parsing json to get an error message
    return res
      .json()
      .then(async (data) => {
        console.log(data);
        throw new Error(data?.message || "Error connecting to the API");
      })
      .catch((e) => {
        throw new Error(e.message);
      });
  }
  const data: {
    token?: string;
    email?: string;
    newInstallation?: boolean;
  } = await res.json();

  token = data.token || "";
  newInstallation = data.newInstallation || false;
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
            firstTime={newInstallation}
            onSuccess={(t) => {
              newInstallation = false;
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
    await fetch(getApiHost() + "/auth/logout", {
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

import {
  AuthSource,
  getLastSSOConnectionId,
  setLastSSOConnectionId,
} from "../services/auth";
import {
  getApiHost,
  getSelfHostedSSOConnection,
  isCloud,
} from "../services/env";
import { UserManager, User } from "oidc-client-ts";
import { SSOConnectionParams } from "back-end/types/sso-connection";

export async function lookupByEmail(email: string) {
  if (!isCloud()) {
    throw new Error("Only available on GrowthBook Cloud");
  }

  const domain = email.split("@")[1];
  if (!domain) {
    throw new Error("Please enter a valid email address");
  }
  const res = await window.fetch(`${getApiHost()}/auth/sso`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain,
    }),
  });
  const json: { message?: string; ssoConnectionId?: string } = await res.json();
  if (!json?.ssoConnectionId) {
    throw new Error(
      json?.message || "No SSO Connection found for that email address."
    );
  }

  setLastSSOConnectionId(json.ssoConnectionId);
}

export async function getSSOConnection(): Promise<SSOConnectionParams> {
  // Self-hosted SSO from env variables
  if (!isCloud()) {
    const ssoConnection = getSelfHostedSSOConnection();
    if (!ssoConnection) {
      throw new Error("No self-hosted SSO connection in environment variables");
    }
    return ssoConnection;
  }

  // Cloud Enterprise SSO
  const ssoConnectionId = getLastSSOConnectionId();
  if (ssoConnectionId) {
    try {
      const res = await window.fetch(
        `${getApiHost()}/auth/sso/${ssoConnectionId}`
      );

      const json: {
        message?: string;
        params?: SSOConnectionParams;
      } = await res.json();
      if (!json?.params) {
        throw new Error(json?.message || "Failed to fetch SSO connection");
      }
      const params = json.params;
      setLastSSOConnectionId(params.id);
      return params;
    } catch (e) {
      setLastSSOConnectionId("");
      throw e;
    }
  }

  // Default Cloud SSO
  return {
    id: "gbcloud",
    authority: "https://growthbook.auth0.com",
    clientId: "5xji4zoOExGgygEFlNXTwAUs3y68zU4D",
  };
}

let userManager: UserManager, ssoConnectionId: string;
async function getUserManager() {
  if (!userManager) {
    const config = await getSSOConnection();
    ssoConnectionId = config.id;
    userManager = new UserManager({
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: window.location.origin,
    });
  }
  return userManager;
}

let currentUser: User;
const oidcAuthSource: AuthSource = {
  init: async (router) => {
    const userManager = await getUserManager();

    console.log(router);

    // If we were just redirected back to the app from the SSO provider
    if (router.asPath === "/oauth/callback") {
      const user = await userManager.signinCallback();
      if (user) {
        currentUser = user;
        const state: { as?: string } = user.state;
        console.log(state);
        if (state.as) {
          router.replace(state.as, state.as, { shallow: true });
        }
      }
    } else {
      const user = await userManager.signinSilent({
        extraTokenParams: {
          scope: "openid email profile",
        },
      });
      if (user) {
        currentUser = user;
      }
    }

    return {
      isAuthenticated: !!currentUser,
    };
  },
  login: async ({ router }) => {
    let screen = "login";
    try {
      if (window.localStorage.getItem("gb_current_project") === null) {
        screen = "signup";
      }
    } catch (e) {
      // ignore
    }

    const userManager = await getUserManager();
    await userManager.signinRedirect({
      extraQueryParams: {
        screen_hint: screen,
      },
      state: {
        as: router.asPath,
      },
    });
    return null;
  },
  logout: async () => {
    const userManager = await getUserManager();
    setLastSSOConnectionId("");
    await userManager.signoutRedirect();
  },
  getJWT: async () => {
    return currentUser?.access_token || "";
  },
  getAuthSourceId: () => {
    return ssoConnectionId || "";
  },
};

export default oidcAuthSource;

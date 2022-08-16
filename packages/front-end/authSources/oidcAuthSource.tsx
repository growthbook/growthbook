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
import { SSOConnectionInterface } from "back-end/types/sso-connection";

export async function getSSOConnection(): Promise<SSOConnectionInterface> {
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
      if (!res.ok) {
        throw new Error("Failed to fetch SSO connection");
      }
      const json: SSOConnectionInterface = await res.json();
      if (!json) {
        throw new Error("Invalid SSO connection response");
      }

      const { authority, clientId } = json;
      if (!authority || !clientId) {
        throw new Error("Invalid SSO connection data");
      }

      setLastSSOConnectionId(ssoConnectionId);

      return { authority, clientId, id: ssoConnectionId };
    } catch (e) {
      setLastSSOConnectionId("");
      throw e;
    }
  }

  // Default Cloud SSO
  return {
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

import {
  AuthSource,
  getLastSSOConfigId,
  setLastSSOConfigId,
} from "../services/auth";
import { getApiHost, getSelfHostedSSOConfig, isCloud } from "../services/env";
import { UserManager, User } from "oidc-client-ts";

export type SSOConfig = {
  ssoConfigId?: string;
  authority: string;
  clientId: string;
};

export async function getSSOConfig(): Promise<SSOConfig> {
  // Self-hosted SSO from env variables
  if (!isCloud()) {
    const ssoConfig = getSelfHostedSSOConfig();
    if (!ssoConfig) {
      throw new Error(
        "No self-hosted SSO configuration in environment variables"
      );
    }
    return ssoConfig;
  }

  // Cloud Enterprise SSO
  const ssoConfigId = getLastSSOConfigId();
  if (ssoConfigId) {
    try {
      const res = await window.fetch(`${getApiHost()}/sso/${ssoConfigId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch SSO configs");
      }
      const json: { authority?: string; clientId?: string } = await res.json();
      if (!json) {
        throw new Error("Invalid SSO config response");
      }

      const { authority, clientId } = json;
      if (!authority || !clientId) {
        throw new Error("Invalid SSO config data");
      }

      return { authority, clientId, ssoConfigId };
    } catch (e) {
      setLastSSOConfigId("");
      throw e;
    }
  }

  // Default Cloud SSO
  return {
    authority: "https://growthbook.auth0.com",
    clientId: "5xji4zoOExGgygEFlNXTwAUs3y68zU4D",
  };
}

let userManager: UserManager, ssoConfigId: string;
async function getUserManager() {
  if (!userManager) {
    const config = await getSSOConfig();
    ssoConfigId = config.ssoConfigId;
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
    if (router.asPath === "/oidc/callback") {
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
    await userManager.signoutRedirect();
  },
  getJWT: async () => {
    return currentUser?.access_token || "";
  },
  getAuthSourceId: () => {
    return ssoConfigId || "";
  },
};

export default oidcAuthSource;

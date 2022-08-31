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
    clientId: "5xji4zoOExGgygEFlNXTwAUs3y68zU4D",
    metadata: {
      issuer: "https://growthbook.auth0.com/",
      authorization_endpoint: "https://growthbook.auth0.com/authorize",
      end_session_endpoint:
        "https://growthbook.auth0.com/v2/logout?client_id=5xji4zoOExGgygEFlNXTwAUs3y68zU4D",
      id_token_signing_alg_values_supported: ["HS256", "RS256"],
      jwks_uri: "https://growthbook.auth0.com/.well-known/jwks.json",
      token_endpoint: "https://growthbook.auth0.com/oauth/token",
    },
  };
}

let userManager: UserManager, ssoConnectionId: string;
async function getUserManager() {
  if (!userManager) {
    let screen = "login";
    try {
      if (window.localStorage.getItem("gb_current_project") === null) {
        screen = "signup";
      }
    } catch (e) {
      // ignore
    }

    const config = await getSSOConnection();
    ssoConnectionId = config.id;
    userManager = new UserManager({
      authority: config.metadata.issuer,
      metadata: config.metadata,
      client_id: config.clientId,
      redirect_uri: window.location.origin + "/oauth/callback",
      silentRequestTimeoutInSeconds: 3,
      scope: "openid profile email",
      extraQueryParams: {
        screen_hint: screen,
        audience: "https://api.growthbook.io",
        ...(config.extraQueryParams || {}),
      },
    });
  }
  return userManager;
}

let currentUser: User;
const oidcAuthSource: AuthSource = {
  init: async (router) => {
    const userManager = await getUserManager();

    // If we were just redirected back to the app from the SSO provider
    console.log(router.pathname);
    if (router.pathname === "/oauth/callback") {
      try {
        const user = await userManager.signinCallback();
        if (user) {
          currentUser = user;
          const state: { as?: string } = user.state;
          if (state.as && state.as.match(/^\//)) {
            if (state.as.match(/^\/oauth\/callback/)) {
              router.replace("/", "/", { shallow: true });
            } else {
              router.replace(state.as, state.as, { shallow: true });
            }
          }
        }
      } catch (e) {
        console.error("signinCallback error", e);
      }
    } else {
      try {
        const user = await userManager.signinSilent({});
        if (user) {
          currentUser = user;
        }
      } catch (e) {
        console.error("signinSilent error", e);
      }
    }

    return {
      isAuthenticated: !!currentUser,
    };
  },
  login: async ({ router }) => {
    const userManager = await getUserManager();
    await userManager.signinRedirect({
      state: {
        as: router.asPath,
      },
    });
    // User will be redirected above to the SSO login page
    return {
      isAuthenticated: false,
    };
  },
  logout: async () => {
    const userManager = await getUserManager();
    setLastSSOConnectionId("");
    await userManager.signoutRedirect();
  },
  getJWT: async () => {
    return currentUser?.id_token || "";
  },
  getAuthSourceId: () => {
    return ssoConnectionId || "";
  },
};

export default oidcAuthSource;

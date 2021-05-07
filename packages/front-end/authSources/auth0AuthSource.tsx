import createAuth0Client, { Auth0Client } from "@auth0/auth0-spa-js";
import { AuthSource } from "../services/auth";

let auth0Client: Auth0Client;
const auth0AuthSource: AuthSource = {
  init: async (router) => {
    auth0Client = await createAuth0Client({
      domain: "growthbook.auth0.com",
      client_id: "5xji4zoOExGgygEFlNXTwAUs3y68zU4D",
      redirect_uri:
        typeof window !== "undefined" ? window.location.origin : null,
      audience: "https://api.growthbook.io",
    });

    if (
      window.location.search.includes("code=") &&
      window.location.search.includes("state=")
    ) {
      const { appState } = await auth0Client.handleRedirectCallback();
      router.replace(appState.path, appState.as, { shallow: true });
    }

    const isAuthenticated = await auth0Client.isAuthenticated();

    return {
      isAuthenticated,
    };
  },
  login: async ({ router }) => {
    await auth0Client.loginWithRedirect({
      appState: {
        path: router.route,
        as: router.asPath,
      },
    });
    return null;
  },
  logout: async () => {
    auth0Client.logout();
    // Auth0 performs a redirect on logout, give it 5 seconds to complete
    return new Promise((resolve) => setTimeout(resolve, 5000));
  },
  getJWT: async () => {
    const token = await auth0Client.getTokenSilently({
      scope: "openid email profile",
    });
    return token;
  },
};

export default auth0AuthSource;

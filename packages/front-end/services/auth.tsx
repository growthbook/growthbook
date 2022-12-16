import React, {
  useState,
  useEffect,
  useContext,
  ReactElement,
  ReactNode,
  useCallback,
} from "react";
import { useRouter } from "next/router";
import {
  MemberRole,
  MemberRoleInfo,
  OrganizationInterface,
} from "back-end/types/organization";
import {
  IdTokenResponse,
  UnauthenticatedResponse,
} from "back-end/types/sso-connection";
import * as Sentry from "@sentry/react";
import Modal from "../components/Modal";
import { DocLink } from "../components/DocLink";
import Welcome from "../components/Auth/Welcome";
import { getApiHost, getAppOrigin, isCloud, isSentryEnabled } from "./env";

export type UserOrganizations = { id: string; name: string }[];

export type ApiCallType<T> = (url: string, options?: RequestInit) => Promise<T>;

export interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  apiCall: <T>(url: string, options?: RequestInit) => Promise<T>;
  orgId?: string;
  setOrgId?: (orgId: string) => void;
  organizations?: UserOrganizations;
  setOrganizations?: (orgs: UserOrganizations) => void;
  specialOrg?: null | Partial<OrganizationInterface>;
  setOrgName?: (name: string) => void;
  setSpecialOrg?: (org: null | Partial<OrganizationInterface>) => void;
}

export const AuthContext = React.createContext<AuthContextValue>({
  isAuthenticated: false,
  loading: true,
  logout: async () => {
    /* do nothing  */
  },
  apiCall: async () => {
    // eslint-disable-next-line
    let x: any;
    return x;
  },
});
export const useAuth = (): AuthContextValue => useContext(AuthContext);

// Only run one refresh operation at a time
let _currentRefreshOperation: null | Promise<
  UnauthenticatedResponse | IdTokenResponse | { error: Error }
> = null;
async function refreshToken() {
  if (!_currentRefreshOperation) {
    _currentRefreshOperation = fetch(getApiHost() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) {
          // try parsing json to get an error message
          return res
            .json()
            .then(async (data) => {
              throw new Error(data?.message || "Error connecting to the API");
            })
            .catch((e) => {
              throw new Error(e.message);
            });
        }
        return res.json();
      })
      .catch((e) => {
        return { error: e };
      });
    _currentRefreshOperation.finally(() => {
      _currentRefreshOperation = null;
    });
  }

  const data = await _currentRefreshOperation;

  if ("error" in data) {
    throw data.error;
  }

  return data;
}

const isLocal = (url: string) => url.includes("localhost");

function getDetailedError(error: string): string | ReactElement {
  const curUrl = window.location.origin;
  if (!isCloud()) {
    // Using a custom domain to access the app, but env variables are still localhost
    if (
      !isLocal(curUrl) &&
      (isLocal(getApiHost()) || isLocal(getAppOrigin()))
    ) {
      return (
        <div>
          <div>
            <strong>{error}.</strong>
          </div>{" "}
          It looks like you are using a custom domain. Make sure to set the
          environment variables{" "}
          <code className="font-weight-bold">APP_ORIGIN</code> and{" "}
          <code className="font-weight-bold">API_HOST</code>.{" "}
          <DocLink docSection="config_domains_and_ports">View docs</DocLink>
        </div>
      );
    }
  }
  return error;
}

// Logout that always works, even if the user wasn't fully authenticated properly
export async function safeLogout() {
  const res = await fetch(getApiHost() + `/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  const json = await res.json();
  await redirectWithTimeout(json?.redirectURI || window.location.origin);
}

export async function redirectWithTimeout(url: string, timeout: number = 5000) {
  // If the URL is the same as the current one, do a reload instead
  // This is the only way to force the page to refresh if the URL contains a hash
  // TODO: this will still break if the paths are identical, but only the hash changed
  if (url === window.location.href) {
    window.location.reload();
  } else {
    window.location.href = url;
  }

  await new Promise((resolve) => setTimeout(resolve, timeout));
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState<string>(null);
  const [organizations, setOrganizations] = useState<UserOrganizations>([]);
  const [
    specialOrg,
    setSpecialOrg,
  ] = useState<Partial<OrganizationInterface> | null>(null);
  const [authComponent, setAuthComponent] = useState<ReactElement | null>(null);
  const [initError, setInitError] = useState("");
  const [sessionError, setSessionError] = useState(false);
  const router = useRouter();
  const initialOrgId = router.query.org ? router.query.org + "" : null;

  async function init() {
    const resp = await refreshToken();
    if ("token" in resp) {
      setInitError("");
      setToken(resp.token);
      setLoading(false);
    } else if ("redirectURI" in resp) {
      if (resp.confirm) {
        setAuthComponent(
          <Modal
            open={true}
            header="Sign In Required"
            submit={async () => {
              await redirectWithTimeout(resp.redirectURI);
            }}
            close={async () => {
              await safeLogout();
            }}
            closeCta="Cancel"
            cta="Sign In"
          >
            <p>You must sign in with your SSO provider to continue.</p>
          </Modal>
        );
      } else {
        try {
          const redirectAddress =
            window.location.pathname + (window.location.search || "");
          window.sessionStorage.setItem(
            "postAuthRedirectPath",
            redirectAddress
          );
        } catch (e) {
          // ignore
        }
        // Don't need to confirm, just redirect immediately
        window.location.href = resp.redirectURI;
      }
    } else if ("showLogin" in resp) {
      setLoading(false);
      setAuthComponent(
        <Welcome
          firstTime={resp.newInstallation}
          onSuccess={(t) => {
            setToken(t);
            setAuthComponent(null);
          }}
        />
      );
    } else {
      console.log(resp);
      throw new Error("Unknown refresh response");
    }
  }

  // Start auth flow to get an id token
  useEffect(() => {
    init().catch((e) => {
      setInitError(e.message);
      console.error(e);
    });
  }, []);

  const orgList = [...organizations];
  if (specialOrg && !orgList.map((o) => o.id).includes(specialOrg.id)) {
    orgList.push({
      id: specialOrg.id,
      name: specialOrg.name,
    });
  }

  const _makeApiCall = useCallback(
    async (url: string, token: string, options: RequestInit = {}) => {
      const init = { ...options };
      init.headers = init.headers || {};
      init.headers["Authorization"] = `Bearer ${token}`;
      init.credentials = "include";

      if (init.body) {
        init.headers["Content-Type"] = "application/json";
      }

      if (orgId) {
        init.headers["X-Organization"] = orgId;
      }

      const response = await fetch(getApiHost() + url, init);

      const responseData = await response.json();
      return responseData;
    },
    [orgId]
  );

  const apiCall = useCallback(
    async (url: string, options: RequestInit = {}) => {
      let responseData = await _makeApiCall(url, token, options);

      if (responseData.status && responseData.status >= 400) {
        // Id token expired, try silently refreshing and doing the API call again
        if (responseData.message === "jwt expired") {
          const resp = await refreshToken();
          if ("token" in resp) {
            setToken(resp.token);
            responseData = await _makeApiCall(url, resp.token, options);
            // Still failing
            if (responseData.status && responseData.status >= 400) {
              throw new Error(responseData.message || "There was an error");
            }
            return responseData;
          } else if ("redirectURI" in resp) {
            try {
              const redirectAddress =
                window.location.pathname + (window.location.search || "");
              window.sessionStorage.setItem(
                "postAuthRedirectPath",
                redirectAddress
              );
            } catch (e) {
              // ignore
            }
            // Don't need to confirm, just redirect immediately
            await redirectWithTimeout(resp.redirectURI);
          }
          setSessionError(true);
          throw new Error(
            "Your session has expired. Refresh the page to continue."
          );
        }

        throw new Error(responseData.message || "There was an error");
      }

      return responseData;
    },
    [token, _makeApiCall]
  );

  const wrappedSetOrganizations = useCallback(
    (orgs: UserOrganizations) => {
      setOrganizations(orgs);
      if (orgId && orgs.map((o) => o.id).includes(orgId)) {
        return;
      } else if (specialOrg?.id === orgId) {
        return;
      } else if (
        !orgId &&
        initialOrgId &&
        orgs.map((o) => o.id).includes(initialOrgId)
      ) {
        setOrgId(initialOrgId);
        return;
      }

      if (orgs.length > 0) {
        setOrgId(orgs[0].id);
      }
    },
    [initialOrgId, orgId, specialOrg]
  );

  if (initError) {
    return (
      <Modal
        header="logo"
        open={true}
        cta="Try Again"
        submit={async () => {
          try {
            await init();
          } catch (e) {
            setInitError(e.message);
            console.error(e);
            throw new Error("Still receiving error");
          }
        }}
      >
        <p>
          Error connecting to the GrowthBook API at <code>{getApiHost()}</code>.
        </p>
        <p>Received the following error message:</p>
        <div className="alert alert-danger">{getDetailedError(initError)}</div>
      </Modal>
    );
  }

  if (sessionError) {
    return (
      <Modal
        open={true}
        cta="OK"
        submit={async () => {
          await redirectWithTimeout(window.location.href);
        }}
        autoCloseOnSubmit={false}
      >
        <h3>You&apos;ve been logged out</h3>
        <p>Sign back in to keep using GrowthBook</p>
      </Modal>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        loading,
        logout: async () => {
          const res: { redirectURI: string } = await apiCall(`/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
          setOrgId(null);
          setOrganizations([]);
          setSpecialOrg(null);
          setToken("");
          if (isSentryEnabled()) {
            Sentry.setUser(null);
          }
          await redirectWithTimeout(res.redirectURI || window.location.origin);
        },
        apiCall,
        orgId,
        setOrgId,
        organizations: orgList,
        setOrganizations: wrappedSetOrganizations,
        setOrgName: (name) => {
          const orgs = [...organizations];
          orgs.forEach((o, i) => {
            if (o.id === orgId) {
              orgs[i] = {
                ...o,
                name,
              };
            }
          });
          setOrganizations(orgs);
        },
        specialOrg,
        setSpecialOrg,
      }}
    >
      <>
        {children}
        {authComponent}
      </>
    </AuthContext.Provider>
  );
};

export function roleSupportsEnvLimit(role: MemberRole): boolean {
  return ["engineer", "experimenter"].includes(role);
}

export function roleHasAccessToEnv(
  role: MemberRoleInfo,
  env: string
): "yes" | "no" | "N/A" {
  if (!roleSupportsEnvLimit(role.role)) return "N/A";

  if (!role.limitAccessByEnvironment) return "yes";

  if (role.environments.includes(env)) return "yes";

  return "no";
}

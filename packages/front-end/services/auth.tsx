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
  MemberRoleInfo,
  OrganizationInterface,
} from "shared/types/organization";
import {
  IdTokenResponse,
  UnauthenticatedResponse,
} from "shared/types/sso-connection";
import * as Sentry from "@sentry/nextjs";
import { roleSupportsEnvLimit } from "shared/permissions";
import Modal from "@/components/Modal";
import { DocLink } from "@/components/DocLink";
import Welcome from "@/components/Auth/Welcome";
import { getApiHost, getAppOrigin, isCloud, isSentryEnabled } from "./env";
import { useProject, LOCALSTORAGE_PROJECT_KEY } from "./DefinitionsContext";

export type UserOrganizations = { id: string; name: string }[];
// eslint-disable-next-line
type ErrorHandler = (responseData: any) => void;
export type ApiCallType<T> = (
  url: string,
  options?: RequestInit,
  errorHandler?: ErrorHandler,
) => Promise<T>;

export interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  apiCall: <T>(
    url: string | null,
    options?: RequestInit,
    errorHandler?: ErrorHandler,
  ) => Promise<T>;
  orgId: string | null;
  setOrgId?: (orgId: string) => void;
  organizations?: UserOrganizations;
  setOrganizations?: (orgs: UserOrganizations, superAdmin: boolean) => void;
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
  orgId: null,
});

export const useAuth = (): AuthContextValue => useContext(AuthContext);

const passthroughQueryParams = ["hypgen", "hypothesis"];

// Only run one refresh operation at a time
let _currentRefreshOperation: null | Promise<
  UnauthenticatedResponse | IdTokenResponse | { error: Error }
> = null;
async function refreshToken() {
  if (!_currentRefreshOperation) {
    let url = getApiHost() + "/auth/refresh";

    // If this is an IdP-initiated Enterprise SSO login on Cloud
    // Send a hint to the back-end with the SSO Connection ID
    // This way, we can bypass several steps - "Login with Enterprise SSO", enter email, etc.
    if (isCloud()) {
      const params = new URL(window.location.href).searchParams;
      const ssoId = params.get("ssoId");
      if (ssoId) {
        url += "?ssoId=" + ssoId;
      }
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.forEach((v, k) => {
      if (passthroughQueryParams.includes(k)) {
        url += `${url.indexOf("?") > -1 ? "&" : "?"}${k}=${v}`;
      }
    });

    _currentRefreshOperation = fetch(url, {
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

const isUnregisteredCloudUser = () => {
  if (!isCloud()) return false;

  try {
    const currentProject = window.localStorage.getItem(
      LOCALSTORAGE_PROJECT_KEY,
    );
    return currentProject === null;
  } catch (_) {
    return true;
  }
};

const addCloudRegisterParam = (uri: string) => {
  const url = new URL(uri);
  url.searchParams.append("screen_hint", "signup");
  return url.toString();
};

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

export const AuthProvider: React.FC<{
  exitOnNoAuth?: boolean;
  children: ReactNode;
}> = ({ exitOnNoAuth = true, children }) => {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<UserOrganizations>([]);
  const [specialOrg, setSpecialOrg] =
    useState<Partial<OrganizationInterface> | null>(null);
  const [authComponent, setAuthComponent] = useState<ReactElement | null>(null);
  const [initError, setInitError] = useState("");
  const [sessionError, setSessionError] = useState(false);
  const router = useRouter();
  const initialOrgId = router.query.org ? router.query.org + "" : null;

  const [, setProject] = useProject();

  async function init() {
    const resp = await refreshToken();
    if ("token" in resp) {
      setInitError("");
      setToken(resp.token);
      setLoading(false);
    } else if (!exitOnNoAuth) {
      setInitError("");
      setLoading(false);
    } else if ("redirectURI" in resp) {
      if (resp.confirm) {
        setAuthComponent(
          <Modal
            trackingEventModalType=""
            open={true}
            submit={async () => {
              await redirectWithTimeout(resp.redirectURI);
            }}
            close={async () => {
              await safeLogout();
            }}
            closeCta="Cancel"
            cta="Sign In"
          >
            <h3>Sign In Required</h3>
            <p>
              You must sign in with your Enterprise SSO provider to continue.
            </p>
          </Modal>,
        );
      } else {
        try {
          const redirectAddress =
            window.location.pathname + (window.location.search || "");
          window.sessionStorage.setItem(
            "postAuthRedirectPath",
            redirectAddress,
          );
        } catch (e) {
          // ignore
        }

        // Don't need to confirm, just redirect immediately
        if (isUnregisteredCloudUser()) {
          window.location.href = addCloudRegisterParam(resp.redirectURI);
        } else {
          window.location.href = resp.redirectURI;
        }
      }
    } else if ("showLogin" in resp) {
      setLoading(false);
      setAuthComponent(
        <Welcome
          firstTime={resp.newInstallation}
          onSuccess={(t, pid) => {
            setToken(t);
            if (pid) {
              setProject(pid);
            }
            setAuthComponent(null);
          }}
        />,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orgList = [...organizations];
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'string | undefined' is not assig... Remove this comment to see the full error message
  if (specialOrg && !orgList.map((o) => o.id).includes(specialOrg.id)) {
    orgList.push({
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
      id: specialOrg.id,
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
      name: specialOrg.name,
    });
  }

  const _makeApiCall = useCallback(
    async (url: string, token: string, options: RequestInit = {}) => {
      const init = { ...options };
      init.headers = init.headers || {};
      init.headers["Authorization"] = `Bearer ${token}`;
      init.credentials = "include";

      if (init.body && !init.headers["Content-Type"]) {
        init.headers["Content-Type"] = "application/json";
      }

      if (orgId && !init.headers["X-Organization"]) {
        init.headers["X-Organization"] = orgId;
      }

      const response = await fetch(getApiHost() + url, init);

      const contentType = response.headers.get("Content-Type");

      let responseData;

      if (contentType && contentType.startsWith("image/")) {
        responseData = await response.blob();
      } else {
        responseData = await response.json();
      }

      return responseData;
    },
    [orgId],
  );

  const apiCall = useCallback(
    async (
      url: string | null,
      options: RequestInit = {},
      errorHandler: ErrorHandler | null = null,
    ) => {
      if (typeof url !== "string") return;

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
                redirectAddress,
              );
            } catch (e) {
              // ignore
            }
            // Don't need to confirm, just redirect immediately
            await redirectWithTimeout(resp.redirectURI);
          }
          setSessionError(true);
          throw new Error(
            "Your session has expired. Refresh the page to continue.",
          );
        }

        if (errorHandler) {
          errorHandler(responseData);
        }
        throw new Error(responseData.message || "There was an error");
      }

      return responseData;
    },
    [token, _makeApiCall],
  );

  const wrappedSetOrganizations = useCallback(
    (orgs: UserOrganizations, superAdmin: boolean) => {
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
        try {
          const pickedOrg = localStorage.getItem("gb-last-picked-org");
          if (
            pickedOrg &&
            !router.query.org &&
            (superAdmin ||
              orgs.map((o) => o.id).includes(JSON.parse(pickedOrg)))
          ) {
            setOrgId(JSON.parse(pickedOrg));
          } else {
            setOrgId(orgs[0].id);
          }
        } catch (e) {
          setOrgId(orgs[0].id);
        }
      }
    },
    [initialOrgId, orgId, router.query.org, specialOrg?.id],
  );

  if (initError) {
    return (
      <Modal
        trackingEventModalType=""
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
        trackingEventModalType=""
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

export function roleHasAccessToEnv(
  role: MemberRoleInfo,
  env: string,
  org: Partial<OrganizationInterface>,
): "yes" | "no" | "N/A" {
  if (!roleSupportsEnvLimit(role.role, org)) return "N/A";

  if (!role.limitAccessByEnvironment) return "yes";

  if (role.environments.includes(env)) return "yes";

  return "no";
}

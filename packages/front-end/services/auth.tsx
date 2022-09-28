import React, {
  useState,
  useEffect,
  useContext,
  ReactElement,
  ReactNode,
  useMemo,
  useCallback,
} from "react";
import { useRouter } from "next/router";
import {
  MemberRole,
  OrganizationInterface,
  OrganizationSettings,
  Permissions,
} from "back-end/types/organization";
import Modal from "../components/Modal";
import { getApiHost, getAppOrigin, isCloud } from "./env";
import { DocLink } from "../components/DocLink";
import {
  IdTokenResponse,
  UnauthenticatedResponse,
} from "back-end/types/sso-connection";
import Welcome from "../components/Auth/Welcome";

export type OrganizationMember = {
  id: string;
  name: string;
  role: MemberRole;
  permissions?: Permissions;
  settings?: OrganizationSettings;
  freeSeats?: number;
  discountCode?: string;
  hasActiveSubscription?: boolean;
};

export type UserOrganizations = OrganizationMember[];

export type ApiCallType<T> = (url: string, options?: RequestInit) => Promise<T>;

export function getDefaultPermissions(): Permissions {
  return {
    addComments: false,
    createIdeas: false,
    createPresentations: false,
    publishFeatures: false,
    createFeatures: false,
    createFeatureDrafts: false,
    createAnalyses: false,
    createDimensions: false,
    createMetrics: false,
    createSegments: false,
    runQueries: false,
    editDatasourceSettings: false,
    createDatasources: false,
    organizationSettings: false,
    superDelete: false,
  };
}

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
  window.location.href = url;
  await new Promise((resolve) => setTimeout(resolve, timeout));
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  console.log("rendering AuthProvider");
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState<string>(null);
  const [organizations, setOrganizations] = useState<UserOrganizations>([]);
  const [
    specialOrg,
    setSpecialOrg,
  ] = useState<Partial<OrganizationInterface> | null>(null);
  const [authComponent, setAuthComponent] = useState<ReactElement | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const initialOrgId = router.query.org ? router.query.org + "" : null;

  const init = useCallback(async function init() {
    const resp = await refreshToken();
    if ("token" in resp) {
      setError("");
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
  }, []);

  // Start auth flow to get an id token
  useEffect(() => {
    init().catch((e) => {
      setError(e.message);
      console.error(e);
    });
  }, []);

  const orgList = useMemo(() => {
    const innerOrgList = [...organizations];
    if (specialOrg && !innerOrgList.map((o) => o.id).includes(specialOrg.id)) {
      innerOrgList.push({
        id: specialOrg.id,
        name: specialOrg.name,
        role: "admin",
      });
    }
    return innerOrgList;
  }, [organizations, specialOrg]);

  const tryAgainSubmit = useCallback(async () => {
    try {
      await init();
    } catch (e) {
      setError(e.message);
      console.error(e);
      throw new Error("Still receiving error");
    }
  }, [init]);

  if (error) {
    return (
      <Modal header="logo" open={true} cta="Try Again" submit={tryAgainSubmit}>
        <p>
          Error connecting to the GrowthBook API at <code>{getApiHost()}</code>.
        </p>
        <p>Received the following error message:</p>
        <div className="alert alert-danger">{getDetailedError(error)}</div>
      </Modal>
    );
  }

  const _makeApiCall = async (
    url: string,
    token: string,
    options: RequestInit = {}
  ) => {
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
  };

  const apiCall = async (url: string, options: RequestInit = {}) => {
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
        }
        // TODO: Handle cases where the token couldn't be refreshed automatically
      }

      throw new Error(responseData.message || "There was an error");
    }

    return responseData;
  };

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
          await redirectWithTimeout(res.redirectURI || window.location.origin);
        },
        apiCall,
        orgId,
        setOrgId,
        organizations: orgList,
        setOrganizations: (orgs) => {
          setOrganizations(orgs);
          if (orgId && orgs.map((o) => o.id).includes(orgId)) {
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

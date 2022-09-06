import React, { useState, useEffect, useContext, FC } from "react";
import { useRouter } from "next/router";
import {
  MemberRole,
  OrganizationInterface,
  OrganizationSettings,
  Permissions,
} from "back-end/types/organization";
import Modal from "../components/Modal";
import { getApiHost, getAppOrigin, isCloud } from "./env";
import { ReactElement } from "react";
import { ReactNode } from "react";
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

async function refreshToken() {
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
  const data: UnauthenticatedResponse | IdTokenResponse = await res.json();
  return data;
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
  const [AuthComponent, setAuthComponent] = useState<FC | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const initialOrgId = router.query.org ? router.query.org + "" : null;

  async function init() {
    const resp = await refreshToken();
    if ("token" in resp) {
      setError("");
      setToken(resp.token);
      setLoading(false);
    } else if ("redirectURI" in resp) {
      window.location.href = resp.redirectURI;
    } else if ("showLogin" in resp) {
      setLoading(false);
      setAuthComponent(() => {
        return (
          <Welcome
            firstTime={resp.newInstallation}
            onSuccess={(t) => {
              setToken(t);
              setAuthComponent(null);
            }}
          />
        );
      });
    } else {
      console.log(resp);
      throw new Error("Unknown refresh response");
    }
  }

  // Start auth flow to get an id token
  useEffect(() => {
    init().catch((e) => {
      setError(e.message);
      console.error(e);
    });
  }, []);

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

  const orgList = [...organizations];
  if (specialOrg && !orgList.map((o) => o.id).includes(specialOrg.id)) {
    orgList.push({
      id: specialOrg.id,
      name: specialOrg.name,
      role: "admin",
    });
  }

  if (error && !isCloud()) {
    return (
      <Modal
        header="logo"
        open={true}
        cta="Try Again"
        submit={async () => {
          try {
            await init();
          } catch (e) {
            setError(e.message);
            console.error(e);
            throw new Error("Still receiving error");
          }
        }}
      >
        <p>
          Error connecting to the GrowthBook API at <code>{getApiHost()}</code>.
        </p>
        <p>Received the following error message:</p>
        <div className="alert alert-danger">{getDetailedError(error)}</div>
      </Modal>
    );
  }

  const apiCall = async (url: string, options: RequestInit = {}) => {
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

    if (responseData.status && responseData.status >= 400) {
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
          // TODO: redirectURI
          const res: { redirectURI: string } = await apiCall(`/auth/logout`, {
            method: "POST",
            credentials: "include",
          });
          setOrgId(null);
          setOrganizations([]);
          setSpecialOrg(null);
          setToken("");
          if (res.redirectURI) {
            window.location.href = res.redirectURI;
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
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
      {children}
      {AuthComponent && <AuthComponent />}
    </AuthContext.Provider>
  );
};

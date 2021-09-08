import React, { useState, useEffect, useContext, FC } from "react";
import { NextRouter, useRouter } from "next/router";
import auth0AuthSource from "../authSources/auth0AuthSource";
import localAuthSource from "../authSources/localAuthSource";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "back-end/types/organization";
import Modal from "../components/Modal";
import { getApiHost, isCloud } from "./env";

export type MemberRole = "collaborator" | "designer" | "developer" | "admin";

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export type OrganizationMember = {
  id: string;
  name: string;
  role: MemberRole;
  subscriptionStatus?: SubscriptionStatus;
  trialEnd?: Date;
  settings?: OrganizationSettings;
};

export type UserOrganizations = OrganizationMember[];

export type ApiCallType<T> = (url: string, options?: RequestInit) => Promise<T>;

export interface AuthContextValue {
  isAuthenticated: boolean;
  loading: boolean;
  login: () => Promise<void>;
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
  login: async () => {
    /* do nothing */
  },
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

export interface AuthSource {
  init: (
    router: NextRouter
  ) => Promise<{
    isAuthenticated: boolean;
  }>;
  login: (helpers: {
    router: NextRouter;
    setAuthComponent: (c: FC) => void;
  }) => Promise<null | {
    isAuthenticated: boolean;
  }>;
  logout: () => Promise<void>;
  getJWT: () => Promise<string>;
}

export const AuthProvider: React.FC = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const authSource = isCloud() ? auth0AuthSource : localAuthSource;

  useEffect(() => {
    authSource
      .init(router)
      .then(({ isAuthenticated }) => {
        setIsAuthenticated(isAuthenticated);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        console.error(e);
      });
  }, []);

  const orgList = [...organizations];
  if (specialOrg && !orgList.map((o) => o.id).includes(specialOrg.id)) {
    orgList.push({
      id: specialOrg.id,
      name: specialOrg.name,
      role: "admin",
    });
  }

  if (error && authSource === localAuthSource) {
    return (
      <Modal
        header="logo"
        open={true}
        cta="Try Again"
        submit={async () => {
          try {
            const { isAuthenticated } = await authSource.init(router);
            setError("");
            setIsAuthenticated(isAuthenticated);
            setLoading(false);
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
        <div className="alert alert-danger">{error}</div>
      </Modal>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        loading,
        login: async () => {
          const res = await authSource.login({
            router,
            setAuthComponent: (c) => setAuthComponent(() => c),
          });
          if (res) {
            setIsAuthenticated(res.isAuthenticated);
          }
        },
        logout: async () => {
          await authSource.logout();
          setOrgId(null);
          setOrganizations([]);
          setSpecialOrg(null);
          setIsAuthenticated(false);
        },
        apiCall: async (url, options: RequestInit = {}) => {
          const token = await authSource.getJWT();

          const init = { ...options };
          init.headers = init.headers || {};
          init.headers["Authorization"] = `Bearer ${token}`;

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
        },
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

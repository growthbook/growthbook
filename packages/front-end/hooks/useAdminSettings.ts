import { ApiKeyInterface } from "back-end/types/apikey";
import { OrganizationInterface } from "back-end/types/organization";
import { SSOConnectionInterface } from "back-end/types/sso-connection";
import { useCallback, useEffect, useState } from "react";
import { MemberInfo } from "../components/Settings/MemberList";
import { useAuth } from "../services/auth";
import usePermissions from "./usePermissions";

type OrgSettingsResponse = {
  organization: OrganizationInterface & { members: MemberInfo[] };
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
};

export function useAdminSettings() {
  const permissions = usePermissions();

  const [data, setData] = useState<OrgSettingsResponse | null>(null);
  const [error, setError] = useState("");

  const { apiCall } = useAuth();

  const refresh = useCallback(
    async function refresh() {
      if (!permissions.organizationSettings) return;
      try {
        const res = await apiCall<OrgSettingsResponse>(`/organization`, {
          method: "GET",
        });
        setData(res);
        setError("");
      } catch (e) {
        setError(e.message);
      }
    },
    [apiCall, permissions.organizationSettings]
  );

  useEffect(() => {
    refresh();
  }, [permissions.organizationSettings, refresh]);

  return { data, error, refresh };
}

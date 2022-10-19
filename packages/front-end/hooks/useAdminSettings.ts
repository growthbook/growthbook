import { ApiKeyInterface } from "back-end/types/apikey";
import { OrganizationInterface } from "back-end/types/organization";
import { SSOConnectionInterface } from "back-end/types/sso-connection";
import { useEffect, useState } from "react";
import { MemberInfo } from "../components/Settings/MemberList";
import { useAuth } from "../services/auth";

type OrgSettingsResponse = {
  organization: OrganizationInterface & { members: MemberInfo[] };
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: SSOConnectionInterface | null;
};

export function useAdminSettings() {
  const [data, setData] = useState<OrgSettingsResponse | null>(null);
  const [error, setError] = useState("");

  const { apiCall } = useAuth();

  async function refresh() {
    try {
      const res = await apiCall<OrgSettingsResponse>(`/organization`, {
        method: "GET",
      });
      setData(res);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  return { data, error, refresh };
}

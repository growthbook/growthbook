import { FC, useCallback, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { useUser } from "@/services/UserContext";
import { isCloud, isMultiOrg } from "@/services/env";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { useAuth } from "@/services/auth";
import OrgsTable from "./OrgsTable";

const Admin: FC = () => {
  const { apiCall } = useAuth();
  const { superAdmin } = useUser();
  const [orgs, setOrgs] = useState<OrganizationInterface[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadOrgs = useCallback(
    async (page: number, search: string) => {
      setLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          organizations: OrganizationInterface[];
          total: number;
        }>(`/admin/organizations?${params.toString()}`);
        setOrgs(res.organizations);
        setTotal(res.total);
        setError("");
      } catch (e) {
        setError(e.message);
      }

      setLoading(false);
    },
    [apiCall]
  );

  if (!superAdmin)
    return (
      <div className="alert alert-danger">
        Only super admins can view this page
      </div>
    );

  return (
    <div className="container-fluid p-3 pagecontents">
      <h1>GrowthBook Admin</h1>

      <OrgsTable
        loading={loading}
        error={error}
        orgs={orgs}
        total={total}
        loadOrgs={loadOrgs}
      />

      {!isCloud() && (
        <div>
          <ShowLicenseInfo showInput={false} />{" "}
          <div className="divider border-bottom mb-3 mt-3" />
        </div>
      )}

      {!isCloud() && isMultiOrg() && (
        <div className="divider border-top mt-3">
          <OrphanedUsersList enableAdd={false} />
        </div>
      )}
    </div>
  );
};

export default Admin;

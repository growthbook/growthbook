import { FC, useCallback, useEffect, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import clsx from "clsx";
import { FaPlus, FaSearch } from "react-icons/fa";
import { date } from "shared/dates";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "../components/LoadingOverlay";
import { useAuth } from "../services/auth";
import CreateOrganization from "../components/CreateOrganization";

const numberFormatter = new Intl.NumberFormat();

const Admin: FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  const { admin } = useUser();

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
      } catch (e) {
        setError(e.message);
      }

      setLoading(false);
    },
    [apiCall]
  );

  useEffect(() => {
    if (!admin) return;

    loadOrgs(page, search);
    // eslint-disable-next-line
  }, [admin]);

  const [orgModalOpen, setOrgModalOpen] = useState(false);

  if (!admin) {
    return (
      <div className="alert alert-danger">
        Only super admins can view this page
      </div>
    );
  }

  return (
    <div className="container-fluid p-3 pagecontents">
      {orgModalOpen && (
        <CreateOrganization
          isAdmin={true}
          onCreate={() => {
            loadOrgs(page, search);
          }}
          close={() => setOrgModalOpen(false)}
        />
      )}
      <button
        className="btn btn-primary float-right"
        onClick={(e) => {
          e.preventDefault();
          setOrgModalOpen(true);
        }}
      >
        <FaPlus /> New Organization
      </button>
      <h1>GrowthBook Admin</h1>
      <p>Click an organization name below to switch to it.</p>

      <div className="mb-2 row align-items-center">
        <div className="col-auto">
          <form
            className="d-flex form form-inline"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              loadOrgs(1, search);
            }}
          >
            <Field
              label="Org name / email"
              labelClassName="mr-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
            />
            <div>
              <button type="submit" className="btn btn-primary">
                <FaSearch />
              </button>
            </div>
          </form>
        </div>
        <div className="col-auto">
          <span className="text-muted">
            {numberFormatter.format(total)} matching organization
            {total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="position-relative">
        {loading && <LoadingOverlay />}
        <table className="table appbox">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Id</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr
                key={o.id}
                className={clsx({
                  "table-warning": orgId === o.id,
                })}
              >
                <td>
                  <a
                    className={clsx("mb-1 h5")}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (setOrgId) {
                        setOrgId(o.id);
                      }
                      if (setSpecialOrg) {
                        setSpecialOrg(o);
                      }
                    }}
                  >
                    {o.name}
                  </a>
                </td>
                <td>{o.ownerEmail}</td>
                <td>{date(o.dateCreated)}</td>
                <td>
                  <small>{o.id}</small>
                </td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          currentPage={page}
          numItemsTotal={total}
          perPage={50}
          onPageChange={(page) => setPage(page)}
        />
      </div>
    </div>
  );
};

export default Admin;

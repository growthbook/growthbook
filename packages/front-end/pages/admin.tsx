import { FC, useCallback, useEffect, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import clsx from "clsx";
import {
  FaAngleDown,
  FaAngleRight,
  FaPencilAlt,
  FaPlus,
  FaSearch,
  FaSpinner,
} from "react-icons/fa";
import { date } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import { LicenseInterface } from "enterprise";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import Code from "@/components/SyntaxHighlighting/Code";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { isCloud, isMultiOrg } from "@/services/env";
import EditOrganization from "@/components/Admin/EditOrganization";
import LoadingOverlay from "@/components/LoadingOverlay";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import { useAuth } from "@/services/auth";

const numberFormatter = new Intl.NumberFormat();

function OrganizationRow({
  organization,
  current,
  switchTo,
  showExternalId,
  onEdit,
}: {
  organization: OrganizationInterface;
  switchTo: (organization: OrganizationInterface) => void;
  current: boolean;
  showExternalId: boolean;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOrgModalOpen, setEditOrgModalOpen] = useState(false);

  const { settings, members, ...otherAttributes } = organization;
  const [license, setLicense] = useState<LicenseInterface | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const { apiCall } = useAuth();

  useEffect(() => {
    if (isCloud() && expanded && !license) {
      const fetchLicense = async () => {
        setLicenseLoading(true);
        const res = await apiCall<{
          status: number;
          licenseData: LicenseInterface;
        }>(`/license`, {
          method: "GET",
          headers: { "X-Organization": organization.id },
        });

        setLicenseLoading(false);
        if (res.status !== 200) {
          throw new Error("There was an error fetching the license");
        }

        setLicense(res.licenseData);
      };

      fetchLicense();
    }
  }, [expanded, apiCall, license, organization]);

  return (
    <>
      {editOrgModalOpen && (
        <EditOrganization
          id={organization.id}
          currentName={organization.name}
          currentExternalId={organization.externalId || ""}
          currentLicenseKey={organization.licenseKey || ""}
          currentOwner={organization.ownerEmail}
          onEdit={onEdit}
          close={() => setEditOrgModalOpen(false)}
        />
      )}
      <tr
        className={clsx({
          "table-warning": current,
        })}
      >
        <td>
          <a
            className={clsx("mb-1 h5")}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              switchTo(organization);
            }}
          >
            {organization.name}
          </a>
        </td>
        <td>{organization.ownerEmail}</td>
        <td>{date(organization.dateCreated)}</td>
        <td>
          <small>{organization.id}</small>
        </td>
        {showExternalId && (
          <td>
            <small>{organization.externalId}</small>
          </td>
        )}
        <td className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setEditOrgModalOpen(true);
            }}
            style={{ lineHeight: "40px" }}
          >
            <FaPencilAlt />
          </a>
        </td>
        <td style={{ width: 40 }} className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
            style={{ fontSize: "1.2em", lineHeight: "40px" }}
          >
            {expanded ? <FaAngleDown /> : <FaAngleRight />}
          </a>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={isCloud() ? 6 : 7} className="bg-light">
            <div className="mb-3">
              <h3>Info</h3>
              <Code language="json" code={stringify(otherAttributes)} />
            </div>
            <div className="mb-3">
              <Collapsible
                trigger={
                  <h3>
                    Settings <FaAngleRight className="chevron" />
                  </h3>
                }
                transitionTime={150}
              >
                <Code language="json" code={stringify(settings)} />
              </Collapsible>
            </div>
            <Collapsible
              trigger={
                <h3>
                  Members <FaAngleRight className="chevron" />
                </h3>
              }
              transitionTime={150}
            >
              <Code language="json" code={stringify(members)} />
            </Collapsible>
            {isCloud() && (
              <div className="mt-3">
                <Collapsible
                  trigger={
                    <h3>
                      License <FaAngleRight className="chevron" />
                    </h3>
                  }
                  transitionTime={150}
                >
                  {licenseLoading && <FaSpinner />}
                  {(license && (
                    <Code language="json" code={stringify(license)} />
                  )) ||
                    "No license found for this organization."}
                </Collapsible>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const Admin: FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  const { license, superAdmin } = useUser();
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

  useEffect(() => {
    if (!superAdmin) return;

    loadOrgs(page, search);
    // eslint-disable-next-line
  }, [superAdmin]);

  const [orgModalOpen, setOrgModalOpen] = useState(false);

  if (!superAdmin) {
    return (
      <div className="alert alert-danger">
        Only super admins can view this page
      </div>
    );
  }
  if (!isCloud() && license?.plan != "enterprise") {
    return (
      <div className="alert alert-danger">
        You must be on an enterprise license to view this page
      </div>
    );
  }

  return (
    <div className="container-fluid p-3 pagecontents">
      {orgModalOpen && (
        <CreateOrganization
          showExternalId={!isCloud()}
          onCreate={() => {
            loadOrgs(page, search);
          }}
          close={() => setOrgModalOpen(false)}
        />
      )}
      <h1>GrowthBook Admin</h1>
      {!isCloud() && (
        <div>
          <ShowLicenseInfo showInput={false} />{" "}
          <div className="divider border-bottom mb-3 mt-3" />
        </div>
      )}
      <h4>Organizations</h4>
      <button
        className="btn btn-primary float-right"
        onClick={(e) => {
          e.preventDefault();
          setOrgModalOpen(true);
        }}
      >
        <FaPlus /> New Organization
      </button>
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
              label="Search:"
              labelClassName="mr-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
            />
            <div>
              <button type="submit" className="btn btn-primary ml-2">
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
        <table className="table appbox" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Id</th>
              {!isCloud() && <th>External Id</th>}
              <th style={{ width: "14px" }}></th>
              <th style={{ width: "40px" }}></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <OrganizationRow
                organization={o}
                showExternalId={!isCloud()}
                key={o.id}
                current={o.id === orgId}
                onEdit={() => {
                  loadOrgs(page, search);
                }}
                switchTo={(org) => {
                  if (setOrgId) {
                    setOrgId(org.id);
                  }

                  try {
                    localStorage.setItem("gb-last-picked-org", `"${o.id}"`);
                  } catch (e) {
                    console.warn("Cannot set gb-last-picked-org");
                  }
                  if (setSpecialOrg) {
                    setSpecialOrg(org);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
        <Pagination
          currentPage={page}
          numItemsTotal={total}
          perPage={50}
          onPageChange={(page) => {
            setPage(page);
            loadOrgs(page, search);
          }}
        />
      </div>
      {!isCloud() && isMultiOrg() && (
        <div className="divider border-top mt-3">
          <OrphanedUsersList
            mutateUsers={() => {
              loadOrgs(page, search);
            }}
            numUsersInAccount={0}
            enableAdd={false}
          />
        </div>
      )}
    </div>
  );
};

export default Admin;

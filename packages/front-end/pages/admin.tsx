import { FC, useCallback, useEffect, useState } from "react";
import {
  ExpandedMember,
  OrganizationInterface,
} from "back-end/types/organization";
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
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import Modal from "@/components/Modal";
import Toggle from "@/components/Forms/Toggle";

interface memberOrgProps {
  id: string;
  name: string;
  members: number;
  role: string;
}
interface ssoInfoProps {
  id: string;
  emailDomains: string[];
  organization: string;
}
const numberFormatter = new Intl.NumberFormat();

function OrganizationRow({
  organization,
  current,
  switchTo,
  showExternalId,
  showVerfiedDomain,
  onEdit,
  ssoInfo,
}: {
  organization: OrganizationInterface;
  switchTo: (organization: OrganizationInterface) => void;
  current: boolean;
  showExternalId: boolean;
  showVerfiedDomain: boolean;
  onEdit: () => void;
  ssoInfo: ssoInfoProps | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOrgModalOpen, setEditOrgModalOpen] = useState(false);
  const [orgMembers, setOrgMembers] = useState<Map<
    string,
    ExpandedMember
  > | null>(null);
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

  useEffect(() => {
    if (expanded && !orgMembers) {
      const fetchOrgMembers = async () => {
        const res = await apiCall<{
          members: ExpandedMember[];
        }>(`/admin/organization/${organization.id}/members`);

        const memberMap = new Map();
        if (res.members.length > 0) {
          res.members.forEach((member) => {
            memberMap.set(member.id, member);
          });
        }
        setOrgMembers(memberMap);
      };

      fetchOrgMembers();
    }
  }, [expanded, apiCall, orgMembers, organization]);

  return (
    <>
      {editOrgModalOpen && (
        <EditOrganization
          id={organization.id}
          disablable={!current}
          currentDisabled={organization.disabled || false}
          currentName={organization.name}
          currentExternalId={organization.externalId || ""}
          currentLicenseKey={organization.licenseKey || ""}
          currentOwner={organization.ownerEmail}
          currentDomain={organization.verifiedDomain || ""}
          currentAutoApproveMembers={organization.autoApproveMembers || false}
          currentLegacyEnterprise={organization.enterprise || false}
          onEdit={onEdit}
          close={() => setEditOrgModalOpen(false)}
        />
      )}
      <tr
        className={clsx({
          "table-warning": current,
          "table-danger": organization.disabled,
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
        {showVerfiedDomain && (
          <td>
            <small>{organization.verifiedDomain}</small>
          </td>
        )}
        {showExternalId && (
          <td>
            <small>{organization.externalId}</small>
          </td>
        )}
        <td>{organization.members.length ?? 0}</td>
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
          <td colSpan={8} className="bg-light">
            <h3>Summary</h3>
            <div
              className="mb-3 bg-white border p-3"
              style={{ border: "1px solid var(--border-color-200)" }}
            >
              <div className="row">
                <div className="col-2 text-right">Name:</div>
                <div className="col-auto font-weight-bold">
                  {organization.name}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">ID:</div>
                <div className="col-auto font-weight-bold">
                  {organization.id}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Verified Domain:</div>
                <div className="col-auto font-weight-bold">
                  {organization.verifiedDomain}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Auto Approve Members:</div>
                <div className="col-auto font-weight-bold">
                  {organization.autoApproveMembers ? "on" : "off"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">SSO Enabled:</div>
                <div className="col-auto font-weight-bold">
                  {ssoInfo
                    ? `yes (${
                        ssoInfo.id
                      } for domains: ${ssoInfo.emailDomains.join(", ")})`
                    : "no"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Restrict Login Method:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.restrictLoginMethod ? "yes" : "no"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Num Members:</div>
                <div className="col-auto font-weight-bold">
                  {organization.members.length}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Num Invited:</div>
                <div className="col-auto font-weight-bold">
                  {organization.invites.length}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Subscription:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.subscription?.planNickname
                    ? organization?.subscription?.planNickname +
                      " (" +
                      organization?.subscription?.status +
                      ")"
                    : "none"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Seats on subscription:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.subscription?.qty &&
                  organization?.subscription?.status === "active"
                    ? organization.subscription.qty
                    : "-"}
                  {organization?.freeSeats
                    ? ` ${organization.freeSeats} free seats`
                    : ""}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Enterprise (legacy):</div>
                <div className="col-auto font-weight-bold">
                  {organization?.enterprise ? "yes" : "no"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">License Key:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.licenseKey ? organization.licenseKey : "-"}
                </div>
              </div>
            </div>
            <div className="mb-3">
              <Collapsible
                trigger={
                  <h3>
                    Other Attributes <FaAngleRight className="chevron" />
                  </h3>
                }
                transitionTime={150}
              >
                <Code language="json" code={stringify(otherAttributes)} />
              </Collapsible>
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
              <Code
                language="json"
                code={stringify(
                  members.map((m) => {
                    const mInfo = orgMembers?.get(m.id) ?? null;
                    return {
                      name: mInfo?.name ?? "-",
                      email: mInfo?.email ?? "-",
                      ...m,
                    };
                  })
                )}
              />
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

function MemberRow({
  member,
  current,
  memberOrgs,
  onEdit,
}: {
  member: ExpandedMember;
  current: boolean;
  memberOrgs: memberOrgProps[];
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editMemberModalOpen, setEditMemberModalOpen] = useState(false);

  return (
    <>
      {editMemberModalOpen && (
        <EditMember
          member={member}
          onEdit={onEdit}
          close={() => setEditMemberModalOpen(false)}
        />
      )}
      <tr
        className={clsx({
          "table-warning": current,
        })}
      >
        <td>{member.name}</td>
        <td>{member.email}</td>
        <td>{member.id}</td>
        <td>{member.dateCreated ? date(member.dateCreated) : "-"}</td>
        <td>{member.verified ? "Yes" : "No"}</td>
        <td>
          {memberOrgs.length ? memberOrgs.map((mo) => mo.name).join(", ") : "-"}
        </td>
        <td className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setEditMemberModalOpen(true);
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
          <td colSpan={8} className="bg-light">
            <div className="mb-3">
              <h3>Organization Info</h3>
              <div className="row">
                {memberOrgs.length === 0 && "No organizations found"}
                {memberOrgs.map((o) => (
                  <div className="mb-2 col-3" key={o.id + member.id}>
                    <div>
                      <span className="font-weight-bold">Name:</span> {o.name}
                    </div>
                    <div>
                      <span className="font-weight-bold">Org Id:</span> {o.id}
                    </div>
                    <div>
                      <span className="font-weight-bold">Members:</span>{" "}
                      {o.members}
                    </div>
                    <div>
                      <span className="font-weight-bold">Role:</span> {o.role}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const Admin: FC = () => {
  const [activeTab, setActiveTab] = useState("organizations");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [memberPage, setMemberPage] = useState(1);
  const [memberSearch, setMemberSearch] = useState("");

  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  const { license, superAdmin } = useUser();
  const [orgs, setOrgs] = useState<OrganizationInterface[]>([]);
  const [ssoConnections, setSsoConnections] = useState<ssoInfoProps[]>([]);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<ExpandedMember[]>([]);
  const [memberOrgs, setMemberOrgs] = useState<{
    string?: memberOrgProps[];
  }>({});
  const [totalMembers, setTotalMembers] = useState(0);
  const [error, setError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [loading, setLoading] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);

  const loadOrgs = useCallback(
    async (page: number, search: string) => {
      setLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          organizations: OrganizationInterface[];
          ssoConnections: ssoInfoProps[];
          total: number;
        }>(`/admin/organizations?${params.toString()}`);
        setOrgs(res.organizations);
        setTotal(res.total);
        setSsoConnections(res.ssoConnections);
        setError("");
      } catch (e) {
        setError(e.message);
      }

      setLoading(false);
    },
    [apiCall]
  );

  const loadMembers = useCallback(
    async (page: number, search: string) => {
      setMemberLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          members: ExpandedMember[];
          total: number;
          memberOrgs: { string: memberOrgProps[] };
        }>(`/admin/members?${params.toString()}`);
        setMembers(res.members);
        setMemberOrgs(res.memberOrgs);
        setTotalMembers(res.total);
        setMemberError("");
      } catch (e) {
        setError(e.message);
      }

      setMemberLoading(false);
    },
    [apiCall]
  );

  useEffect(() => {
    if (!superAdmin) return;

    loadOrgs(page, search);
    loadMembers(memberPage, memberSearch);
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
        <>
          <div
            className="p-3 bg-white"
            style={{ border: "1px solid var(--border-color-200)" }}
          >
            <ShowLicenseInfo showInput={false} />{" "}
          </div>
          <div className="divider border-bottom mb-3 mt-3" />
        </>
      )}
      <ControlledTabs
        newStyle={true}
        className="mb-3"
        active={activeTab}
        setActive={(tab) => {
          if (tab) {
            setActiveTab(tab);
          }
        }}
      >
        <Tab display="Organizations" id="organizations">
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
                  <th style={{ width: "260px" }}>Owner</th>
                  <th>Created</th>
                  <th>Id</th>
                  {isCloud() && <th>Verified Domain</th>}
                  {!isCloud() && <th>External Id</th>}
                  <th style={{ width: "120px" }}>Members</th>
                  <th style={{ width: "14px" }}></th>
                  <th style={{ width: "40px" }}></th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <OrganizationRow
                    organization={o}
                    ssoInfo={ssoConnections.find(
                      (sso) => sso.organization === o.id
                    )}
                    showExternalId={!isCloud()}
                    showVerfiedDomain={isCloud()}
                    key={o.id}
                    current={o.id === orgId}
                    onEdit={() => {
                      loadOrgs(page, search);
                    }}
                    switchTo={(org) => {
                      if (setOrgId) {
                        setOrgId(org.id);
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
        </Tab>
        <Tab display="Members" id="members">
          <div className="mb-2 row align-items-center">
            <div className="col-auto">
              <form
                className="d-flex form form-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  setMemberPage(1);
                  loadMembers(1, memberSearch);
                }}
              >
                <Field
                  label="Search:"
                  labelClassName="mr-2"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
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
                {numberFormatter.format(totalMembers)}{" "}
                {memberSearch ? "matching" : ""} member
                {totalMembers === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          {memberError && (
            <div className="alert alert-danger">{memberError}</div>
          )}
          <div className="position-relative">
            {memberLoading && <LoadingOverlay />}
            <table className="table appbox" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>email</th>
                  <th>Id</th>
                  <th>Created</th>
                  <th title="Verified Email">Verified</th>
                  <th>Orgs</th>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <MemberRow
                    member={m}
                    memberOrgs={memberOrgs[m.id] ?? []}
                    key={m.id}
                    current={m.id === orgId}
                    onEdit={() => {
                      loadMembers(memberPage, memberSearch);
                    }}
                  />
                ))}
              </tbody>
            </table>
            <Pagination
              currentPage={memberPage}
              numItemsTotal={totalMembers}
              perPage={50}
              onPageChange={(page) => {
                setMemberPage(page);
                loadMembers(memberPage, memberSearch);
              }}
            />
          </div>
        </Tab>
      </ControlledTabs>
    </div>
  );
};

const EditMember: FC<{
  onEdit: () => void;
  close?: () => void;
  member: ExpandedMember;
}> = ({ onEdit, close, member }) => {
  const [verified, setVerified] = useState(member.verified);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/member", {
      method: "PUT",
      body: JSON.stringify({
        userId: member.id,
        verified: verified,
        email: email,
        name: name,
      }),
    });
    onEdit();
  };

  return (
    <Modal
      submit={handleSubmit}
      open={true}
      header={"Edit Member"}
      cta={"Update"}
      close={close}
      inline={!close}
    >
      <div className="form-group">
        Name
        <input
          type="text"
          className="form-control"
          value={name}
          required
          minLength={3}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-3">
          Email
          <input
            type="email"
            className="form-control"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <label>Verified Email </label>
          <Toggle
            label="Verified"
            id="verified"
            className=" ml-2"
            value={verified}
            setValue={(e) => setVerified(e)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default Admin;

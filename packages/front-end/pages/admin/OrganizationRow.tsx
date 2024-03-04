import { useEffect, useState } from "react";
import { OrganizationInterface } from "@back-end/types/organization";
import { UserInterface } from "@back-end/types/user";
import clsx from "clsx";
import { FaAngleDown, FaAngleRight, FaPencilAlt } from "react-icons/fa";
import { date } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import Code from "@/components/SyntaxHighlighting/Code";
import { isCloud } from "@/services/env";
import { useAuth } from "@/services/auth";
import EditOrganization from "@/components/Admin/EditOrganization";
import MembersRow from "./MembersRow";

export default function OrganizationRow({
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
  const { apiCall } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [editOrgModalOpen, setEditOrgModalOpen] = useState(false);
  const [users, setUsers] = useState<UserInterface[]>([]);
  const [usersError, setUsersError] = useState("");
  const usersById = users.reduce((acc, user) => {
    if (!acc[user.id]) acc[user.id] = user;
    return acc;
  }, {} as Record<string, UserInterface>);

  const { settings, members, ...otherAttributes } = organization;

  useEffect(() => {
    if (!expanded) return;
    const fetch = async () => {
      try {
        const res = await apiCall<{
          users: UserInterface[];
        }>(`/admin/organization/${organization.id}/users`);
        setUsers(res.users);
      } catch (e) {
        setUsersError(`Error fetching users: ${e}`);
      }
    };
    fetch();
  }, [organization.id, apiCall, expanded]);

  return (
    <>
      {editOrgModalOpen && (
        <EditOrganization
          id={organization.id}
          currentName={organization.name}
          currentExternalId={organization.externalId || ""}
          showExternalId={!isCloud()}
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
          <td colSpan={5} className="bg-light">
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
              {members.map((m) => (
                <MembersRow key={m.id} member={m} user={usersById[m.id]} />
              ))}
              {usersError && (
                <div>
                  There was an error fetching users for this row: {usersError}
                </div>
              )}
            </Collapsible>
          </td>
        </tr>
      )}
    </>
  );
}

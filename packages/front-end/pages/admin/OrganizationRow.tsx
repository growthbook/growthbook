import { useState } from "react";
import { OrganizationInterface } from "@back-end/types/organization";
import { UserInterface } from "@back-end/types/user";
import clsx from "clsx";
import {
  FaAngleDown,
  FaAngleRight,
  FaPencilAlt,
  FaTrash,
} from "react-icons/fa";
import { date } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";
import EditOrganization from "@/components/Admin/EditOrganization";
import Code from "@/components/SyntaxHighlighting/Code";
import DeleteOrganizationModal from "@/components/Admin/DeleteOrganizationModal";
import MembersTable from "./MembersTable";

export default function OrganizationRow({
  organization,
  current,
  switchTo,
  showExternalId,
  onUpdate,
}: {
  organization: OrganizationInterface;
  switchTo: (organization: OrganizationInterface) => void;
  current: boolean;
  showExternalId: boolean;
  onUpdate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOrgModalOpen, setEditOrgModalOpen] = useState(false);
  const [deleteOrgModalOpen, setDeleteOrgModalOpen] = useState(false);

  const { settings, members, ...otherAttributes } = organization;

  const { data, error: usersError, mutate } = useApi<{
    users: UserInterface[];
  }>(`/admin/organization/${organization.id}/users`);
  const users = data?.users || [];

  return (
    <>
      {editOrgModalOpen && (
        <EditOrganization
          id={organization.id}
          currentName={organization.name}
          currentExternalId={organization.externalId || ""}
          showExternalId={!isCloud()}
          onEdit={onUpdate}
          close={() => setEditOrgModalOpen(false)}
        />
      )}
      {deleteOrgModalOpen && (
        <DeleteOrganizationModal
          id={organization.id}
          currentName={organization.name}
          onDelete={() => window.location.reload()}
          close={() => setDeleteOrgModalOpen(false)}
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
            className="w-100 h-100 mx-2"
            onClick={(e) => {
              e.preventDefault();
              setEditOrgModalOpen(true);
            }}
            style={{ lineHeight: "40px" }}
          >
            <FaPencilAlt />
          </a>
          <a
            href="#"
            className="w-100 h-100 mx-2 text-danger"
            onClick={(e) => {
              e.preventDefault();
              setDeleteOrgModalOpen(true);
            }}
            style={{ lineHeight: "40px" }}
          >
            <FaTrash />
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
              <MembersTable users={users} members={members} mutate={mutate} />
              {usersError && (
                <div>
                  There was an error fetching users for this row:{" "}
                  {usersError.message}
                </div>
              )}
            </Collapsible>
          </td>
        </tr>
      )}
    </>
  );
}

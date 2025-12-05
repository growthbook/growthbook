import { FC, useState } from "react";
import { FaCheck, FaTimes, FaUserCheck } from "react-icons/fa";
import { PendingMember } from "back-end/types/organization";
import { datetime } from "shared/dates";
import { roleHasAccessToEnv, useAuth } from "@/services/auth";
import ProjectBadges from "@/components/ProjectBadges";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useEnvironments } from "@/services/features";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useDefinitions } from "@/services/DefinitionsContext";
import ChangeRoleModal from "@/components/Settings/Team/ChangeRoleModal";
import { useUser } from "@/services/UserContext";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const PendingMemberList: FC<{
  pendingMembers: PendingMember[];
  mutate: () => void;
  project: string;
}> = ({ pendingMembers, mutate, project }) => {
  const { apiCall } = useAuth();
  const [roleModalUser, setRoleModalUser] = useState<PendingMember | null>(
    null,
  );
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const { organization } = useUser();

  return (
    <div className="my-4">
      <h5>Pending Members{` (${pendingMembers.length})`}</h5>
      <div className="text-muted mb-2">
        Members who have requested to join this organization. They must be
        manually approved.
      </div>
      {roleModalUser && (
        <ChangeRoleModal
          displayInfo={roleModalUser.name || roleModalUser.email}
          roleInfo={{
            environments: roleModalUser.environments || [],
            limitAccessByEnvironment: !!roleModalUser.limitAccessByEnvironment,
            role: roleModalUser.role,
            projectRoles: roleModalUser.projectRoles,
          }}
          close={() => setRoleModalUser(null)}
          onConfirm={async (value) => {
            await apiCall(`/member/${roleModalUser.id}/role`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            mutate();
          }}
        />
      )}
      <Table variant="standard" className="appbox">
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Date Joined</TableColumnHeader>
            <TableColumnHeader>{project ? "Project Role" : "Global Role"}</TableColumnHeader>
            {!project && <TableColumnHeader>Project Roles</TableColumnHeader>}
            {environments.map((env) => (
              <TableColumnHeader key={env.id}>{env.id}</TableColumnHeader>
            ))}
            <TableColumnHeader />
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {pendingMembers.map((member) => {
            const roleInfo =
              (project &&
                member.projectRoles?.find((r) => r.project === project)) ||
              member;
            return (
              <TableRow key={member.id}>
                <TableCell>{member.name}</TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>{member.dateCreated && datetime(member.dateCreated)}</TableCell>
                <TableCell>{roleInfo.role}</TableCell>
                {!project && (
                  <TableCell className="col-3">
                    {/* @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'. */}
                    {member.projectRoles.map((pr) => {
                      const p = projects.find((p) => p.id === pr.project);
                      if (p?.name) {
                        return (
                          <div key={`project-tags-${p.id}`}>
                            <ProjectBadges
                              resourceType="member"
                              projectIds={[p.id]}
                            />
                            — {pr.role}
                          </div>
                        );
                      }
                      return null;
                    })}
                  </TableCell>
                )}
                {environments.map((env) => {
                  const access = roleHasAccessToEnv(
                    roleInfo,
                    env.id,
                    organization,
                  );
                  return (
                    <TableCell key={env.id}>
                      {access === "N/A" ? (
                        <span className="text-muted">N/A</span>
                      ) : access === "yes" ? (
                        <FaCheck className="text-success" />
                      ) : (
                        <FaTimes className="text-danger" />
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <button
                    className="btn btn-outline-success px-2"
                    onClick={async () => {
                      await apiCall(`/member/${member.id}/approve`, {
                        method: "POST",
                      });
                      mutate();
                    }}
                  >
                    <FaUserCheck /> Approve
                  </button>
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <button
                      className="dropdown-item"
                      onClick={(e) => {
                        e.preventDefault();
                        setRoleModalUser(member);
                      }}
                    >
                      Edit Role
                    </button>
                    <DeleteButton
                      link={true}
                      text="Remove User"
                      useIcon={false}
                      className="dropdown-item"
                      displayName={member.email}
                      onClick={async () => {
                        await apiCall(`/member/${member.id}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                    />
                  </MoreMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default PendingMemberList;

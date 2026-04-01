import React, { FC } from "react";
import { FaCheck, FaFilter, FaTimes } from "react-icons/fa";
import { ApiKeyInterface, ApiKeyWithRole } from "shared/types/apikey";
import { getRoleDisplayName } from "shared/permissions";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { roleHasAccessToEnv } from "@/services/auth";
import Tooltip from "@/ui/Tooltip";

type ApiKeysTableProps = {
  onDelete: (keyId: string | undefined) => () => Promise<void>;
  keys: ApiKeyInterface[];
  canCreateKeys: boolean;
  canDeleteKeys: boolean;
  onReveal: (keyId: string | undefined) => () => Promise<string>;
};

export const ApiKeysTable: FC<ApiKeysTableProps> = ({
  keys = [],
  onDelete,
  canCreateKeys,
  canDeleteKeys,
  onReveal,
}) => {
  const { organization } = useUser();
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table mb-3 appbox gbtable">
        <thead>
          <tr>
            <th style={{ width: 150 }}>Description</th>
            <th>Key</th>
            <th>Global Role</th>
            <th>Project Roles</th>
            {environments.map((env) => (
              <th key={env.id}>{env.id}</th>
            ))}

            {canDeleteKeys && <th style={{ width: 30 }}></th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id}>
              <td>{key.description}</td>
              <td style={{ minWidth: 270 }}>
                {canCreateKeys ? (
                  <ClickToReveal
                    valueWhenHidden="secret_abcdefghijklmnop123"
                    getValue={onReveal(key.id)}
                  />
                ) : (
                  <em>hidden</em>
                )}
              </td>
              <td>
                {key.role ? getRoleDisplayName(key.role, organization) : "-"}
              </td>
              <td>
                {key.projectRoles?.map((pr) => {
                  const p = projects.find((p) => p.id === pr.project);
                  if (p?.name) {
                    return (
                      <div key={`project-tags-${p.id}`}>
                        <ProjectBadges
                          resourceType="member"
                          projectIds={[p.id]}
                        />{" "}
                        — {getRoleDisplayName(pr.role, organization)}
                        {pr.limitAccessByEnvironment &&
                          pr.environments.length > 0 && (
                            <Tooltip
                              content={`Limited to: ${pr.environments.join(", ")}`}
                            >
                              <span>
                                <FaFilter
                                  className="text-muted ml-1"
                                  size={10}
                                />
                              </span>
                            </Tooltip>
                          )}
                      </div>
                    );
                  }
                  return null;
                })}
              </td>
              {environments.map((env) => {
                const access = !key.role
                  ? "N/A"
                  : roleHasAccessToEnv(
                      key as ApiKeyWithRole,
                      env.id,
                      organization,
                    );
                return (
                  <td key={env.id}>
                    {access === "N/A" ? (
                      <span className="text-muted">N/A</span>
                    ) : access === "yes" ? (
                      <FaCheck className="text-success" />
                    ) : (
                      <FaTimes className="text-danger" />
                    )}
                  </td>
                );
              })}
              {canDeleteKeys && (
                <td>
                  <MoreMenu>
                    <DeleteButton
                      onClick={onDelete(key.id)}
                      className="dropdown-item"
                      displayName="API Key"
                      text="Delete key"
                    />
                  </MoreMenu>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

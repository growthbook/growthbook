import React, { FC } from "react";
import { FaCheck, FaFilter, FaTimes } from "react-icons/fa";
import { ApiKeyInterface, ApiKeyWithRole } from "shared/types/apikey";
import { getRoleDisplayName } from "shared/permissions";
import { ago, datetime } from "shared/dates";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { roleHasAccessToEnv } from "@/services/auth";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";

type ApiKeysTableProps = {
  onDelete: (keyId: string | undefined) => () => Promise<void>;
  keys: ApiKeyInterface[];
  canCreateKeys: boolean;
  canDeleteKeys: boolean;
  onReveal: (keyId: string | undefined) => () => Promise<string>;
  onToggleDisabled?: (
    keyId: string | undefined,
    disabled: boolean,
  ) => () => Promise<void>;
};

export const ApiKeysTable: FC<ApiKeysTableProps> = ({
  keys = [],
  onDelete,
  canCreateKeys,
  canDeleteKeys,
  onReveal,
  onToggleDisabled,
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
            <th>Last Used</th>
            {canDeleteKeys && <th style={{ width: 30 }}></th>}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr
              key={key.id}
              style={key.disabled ? { opacity: 0.55 } : undefined}
            >
              <td>
                {key.description}
                {key.disabled && (
                  <Badge ml="2" color="red" variant="soft" label="Disabled" />
                )}
              </td>
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
              <td>
                {key.lastUsed ? (
                  <Tooltip content={datetime(key.lastUsed)}>
                    <span>{ago(key.lastUsed)}</span>
                  </Tooltip>
                ) : (
                  <span className="text-muted">Never</span>
                )}
              </td>
              {canDeleteKeys && (
                <td>
                  <MoreMenu>
                    {onToggleDisabled && (
                      <button
                        className="dropdown-item"
                        onClick={async (e) => {
                          e.preventDefault();
                          await onToggleDisabled(key.id, !key.disabled)();
                        }}
                      >
                        {key.disabled ? "Enable key" : "Disable key"}
                      </button>
                    )}
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

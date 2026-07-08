import React, { FC, useState } from "react";
import { FaCheck, FaFilter, FaTimes } from "react-icons/fa";
import { BsThreeDotsVertical } from "react-icons/bs";
import { IconButton } from "@radix-ui/themes";
import { ApiKeyInterface, ApiKeyWithRole } from "shared/types/apikey";
import { getRoleDisplayName } from "shared/permissions";
import { ago, datetime } from "shared/dates";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { roleHasAccessToEnv } from "@/services/auth";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import ConfirmDialog from "@/ui/ConfirmDialog";

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
  onEdit?: (key: ApiKeyInterface) => void;
  onShowAuditLog?: (key: ApiKeyInterface) => void;
};

export const ApiKeysTable: FC<ApiKeysTableProps> = ({
  keys = [],
  onDelete,
  canCreateKeys,
  canDeleteKeys,
  onReveal,
  onToggleDisabled,
  onEdit,
  onShowAuditLog,
}) => {
  const { organization } = useUser();
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );
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
                  <Tooltip
                    content={
                      key.disabled
                        ? `${datetime(key.lastUsed)}. This is the last time a request was attempted, successful or not.`
                        : datetime(key.lastUsed)
                    }
                  >
                    <span>{ago(key.lastUsed)}</span>
                  </Tooltip>
                ) : key.lastUsed === null ? (
                  <span className="text-muted">Never</span>
                ) : (
                  <Tooltip content="This key was created before usage tracking was added, so we don't know when it was last used.">
                    <span className="text-muted">Unknown</span>
                  </Tooltip>
                )}
              </td>
              {canDeleteKeys && (
                <td>
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                      >
                        <BsThreeDotsVertical size={18} />
                      </IconButton>
                    }
                    menuPlacement="end"
                    variant="soft"
                  >
                    <DropdownMenuGroup>
                      {/* Only org secret keys (not PATs) can be edited in place */}
                      {onEdit && key.secret && !key.userId && (
                        <DropdownMenuItem onClick={() => onEdit(key)}>
                          Edit permissions & description
                        </DropdownMenuItem>
                      )}
                      {onToggleDisabled && (
                        <DropdownMenuItem onClick={() => setPendingToggle(key)}>
                          {key.disabled ? "Enable key" : "Disable key"}
                        </DropdownMenuItem>
                      )}
                      {onShowAuditLog && (
                        <DropdownMenuItem onClick={() => onShowAuditLog(key)}>
                          Audit log
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        color="red"
                        confirmation={{
                          submit: onDelete(key.id),
                          confirmationTitle: "Delete API Key",
                          cta: "Delete",
                          getConfirmationContent: async () =>
                            "Are you sure? This action cannot be undone.",
                        }}
                      >
                        Delete key
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {pendingToggle && onToggleDisabled && (
        <ConfirmDialog
          title={
            !pendingToggle.disabled ? "Disable API key?" : "Enable API key?"
          }
          content={
            !pendingToggle.disabled
              ? `Any request using this key will be rejected until it is re-enabled.`
              : `This key will immediately start accepting requests again.`
          }
          yesText={!pendingToggle.disabled ? "Disable" : "Enable"}
          onConfirm={async () => {
            const target = pendingToggle;
            await onToggleDisabled(target.id, !target.disabled)();
            setPendingToggle(null);
          }}
          onCancel={() => setPendingToggle(null)}
        />
      )}
    </div>
  );
};

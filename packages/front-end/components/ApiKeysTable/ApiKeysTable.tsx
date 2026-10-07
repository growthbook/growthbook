import React, { FC, useState } from "react";
import { FaCheck, FaFilter, FaTimes } from "react-icons/fa";
import { ApiKeyInterface, ApiKeyWithRole } from "shared/types/apikey";
import {
  apiKeyToggleRequiresAdmin,
  getRoleDisplayName,
  roleHasAccessToEnv,
} from "shared/permissions";
import { ago, datetime } from "shared/dates";
import { getExpirationStatus } from "shared/api-key-expiration";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import ApiKeyRowMenu from "@/components/ApiKeysTable/ApiKeyRowMenu";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import ProjectBadges from "@/components/ProjectBadges";
import { useEnvironments } from "@/services/features";
import { useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import ExpiresCell from "@/components/ApiKeysTable/ExpiresCell";

const ADMIN_LOCKED_REASON =
  "An administrator disabled this token. Ask them to re-enable it, or delete it and create a new one.";

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
  onCopy?: (key: ApiKeyInterface) => void;
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
  onCopy,
}) => {
  const { organization, userId, users, settings } = useUser();
  const canManageTokens = usePermissionsUtil().canDeleteApiKey();
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );
  const isDisabledByAdmin = (key: ApiKeyInterface) =>
    !!key.userId &&
    !!key.disabled &&
    !!key.disabledBy &&
    key.disabledBy !== userId;
  const isAdminLocked = (key: ApiKeyInterface) =>
    !canManageTokens && apiKeyToggleRequiresAdmin(key, userId || "");
  const disabledByTitle = (key: ApiKeyInterface) => {
    const disabler = key.disabledBy ? users.get(key.disabledBy) : undefined;
    return `Disabled by ${disabler?.name || disabler?.email || "a former member"}`;
  };
  // Data cells dim, never the actions cell that holds Enable.
  const dimStyle = (key: ApiKeyInterface) =>
    key.disabled ? { opacity: 0.55 } : undefined;
  const [showExpired, setShowExpired] = useState(false);
  const expiredCount = keys.filter(
    (k) => getExpirationStatus(k.expiresAt) === "expired",
  ).length;
  const visibleKeys = showExpired
    ? keys
    : keys.filter((k) => getExpirationStatus(k.expiresAt) !== "expired");
  const { items: sortedKeys, SortableTH } = useSearch({
    items: visibleKeys.map((key, i) => ({
      id: key.id || key.key,
      // 1-based: useSearch treats a falsy sort value as missing.
      order: i + 1,
      // No expiry sorts after every dated key, as on Manage PATs.
      expiresAtSort: key.expiresAt
        ? new Date(key.expiresAt).getTime()
        : Number.MAX_SAFE_INTEGER,
      key,
    })),
    localStorageKey: "apiKeysTable",
    defaultSortField: "order",
    searchFields: [],
  });
  return (
    <>
      {expiredCount > 0 && (
        <Switch
          mb="2"
          size="sm"
          label={`Show expired keys (${expiredCount})`}
          value={showExpired}
          onChange={setShowExpired}
        />
      )}
      <div style={{ overflowX: "auto" }}>
        <table
          className="table mb-3 appbox gbtable"
          style={{ width: "auto", minWidth: "100%" }}
        >
          <thead>
            <tr>
              <th style={{ minWidth: 150 }}>Description</th>
              <th>Key</th>
              <th>Global Role</th>
              <th>Project Roles</th>
              {/* Relative spans like "in about 2 months" otherwise wrap and
                double every row's height. */}
              <th style={{ whiteSpace: "nowrap" }}>Last Used</th>
              <SortableTH
                field="expiresAtSort"
                style={{ whiteSpace: "nowrap" }}
              >
                Expires
              </SortableTH>
              {environments.map((env) => (
                <th key={env.id}>{env.id}</th>
              ))}
              {canDeleteKeys && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {!visibleKeys.length && (
              <tr>
                <td
                  colSpan={6 + environments.length + (canDeleteKeys ? 1 : 0)}
                  style={{ textAlign: "center" }}
                >
                  <Text color="text-low">All of these keys have expired.</Text>
                </td>
              </tr>
            )}
            {sortedKeys.map(({ key }) => (
              <tr key={key.id}>
                <td style={dimStyle(key)}>
                  {key.description}
                  {key.disabled && (
                    <Tooltip
                      content={
                        isAdminLocked(key)
                          ? ADMIN_LOCKED_REASON
                          : disabledByTitle(key)
                      }
                      enabled={
                        isAdminLocked(key) || (!key.userId && !!key.disabledBy)
                      }
                    >
                      <span>
                        <Badge
                          ml="2"
                          color="red"
                          variant="soft"
                          label={
                            isDisabledByAdmin(key)
                              ? "Disabled by admin"
                              : "Disabled"
                          }
                        />
                      </span>
                    </Tooltip>
                  )}
                </td>
                <td style={{ minWidth: 270, ...dimStyle(key) }}>
                  {canCreateKeys ? (
                    <ClickToReveal
                      valueWhenHidden="secret_abcdefghijklmnop123"
                      getValue={onReveal(key.id)}
                    />
                  ) : (
                    <em>hidden</em>
                  )}
                </td>
                <td style={dimStyle(key)}>
                  {key.role ? getRoleDisplayName(key.role, organization) : "-"}
                </td>
                <td style={dimStyle(key)}>
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
                <td style={{ whiteSpace: "nowrap", ...dimStyle(key) }}>
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
                    <Text color="text-low">Never</Text>
                  ) : (
                    <Tooltip content="This key was created before usage tracking was added, so we don't know when it was last used.">
                      <Text color="text-low">Unknown</Text>
                    </Tooltip>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap", ...dimStyle(key) }}>
                  <ExpiresCell
                    expiresAt={key.expiresAt}
                    maxLifetimeDays={
                      key.userId
                        ? settings?.maxPatLifetimeDays
                        : settings?.maxApiKeyLifetimeDays
                    }
                  />
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
                    <td key={env.id} style={dimStyle(key)}>
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
                    <ApiKeyRowMenu
                      apiKey={key}
                      canDeleteKeys={canDeleteKeys}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      onToggleClick={
                        onToggleDisabled ? setPendingToggle : undefined
                      }
                      toggleLockedReason={
                        isAdminLocked(key) ? ADMIN_LOCKED_REASON : undefined
                      }
                      onShowAuditLog={onShowAuditLog}
                      onCopy={onCopy}
                    />
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
            color={!pendingToggle.disabled ? "red" : "violet"}
            onConfirm={async () => {
              const target = pendingToggle;
              await onToggleDisabled(target.id, !target.disabled)();
              setPendingToggle(null);
            }}
            onCancel={() => setPendingToggle(null)}
          />
        )}
      </div>
    </>
  );
};

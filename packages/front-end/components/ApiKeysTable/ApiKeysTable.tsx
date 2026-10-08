import React, { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { apiKeyToggleRequiresAdmin } from "shared/permissions";
import { ago, datetime } from "shared/dates";
import { getExpirationStatus } from "shared/api-key-expiration";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import ApiKeyRowMenu from "@/components/ApiKeysTable/ApiKeyRowMenu";
import ExpiresCell from "@/components/ApiKeysTable/ExpiresCell";
import { RequiresRequesterIcon } from "@/components/Settings/RequesterIcons";
import {
  CollapsedRuleRows,
  projectRuleRows,
  ruleRows,
} from "@/components/Settings/Team/RoleRuleLabel";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import Switch from "@/ui/Switch";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

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
  const { getProjectById } = useDefinitions();
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
  const { items: sortedKeys, SortableTableColumnHeader } = useSearch({
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
      <Table variant="surface" layout="fixed" mb="3">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width="15%">Description</TableColumnHeader>
            <TableColumnHeader width="270px">Key</TableColumnHeader>
            <TableColumnHeader width="16%">Role</TableColumnHeader>
            <TableColumnHeader width="16%">Project Roles</TableColumnHeader>
            <TableColumnHeader width="150px">Last Used</TableColumnHeader>
            <SortableTableColumnHeader
              field="expiresAtSort"
              style={{ width: 180 }}
            >
              Expires
            </SortableTableColumnHeader>
            {canDeleteKeys && <TableColumnHeader width="40px" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!visibleKeys.length && (
            <TableRow>
              <TableCell
                colSpan={canDeleteKeys ? 7 : 6}
                style={{ textAlign: "center" }}
              >
                <Text color="text-low">All of these keys have expired.</Text>
              </TableCell>
            </TableRow>
          )}
          {sortedKeys.map(({ key }) => (
            <TableRow key={key.id}>
              <TableCell style={dimStyle(key)}>
                {key.requireRequestedBy && <RequiresRequesterIcon />}
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
              </TableCell>
              <TableCell style={dimStyle(key)}>
                {canCreateKeys ? (
                  <ClickToReveal
                    valueWhenHidden="secret_abcdefghijklmnop123"
                    getValue={onReveal(key.id)}
                  />
                ) : (
                  <em>hidden</em>
                )}
              </TableCell>
              <TableCell style={dimStyle(key)}>
                {key.role ? (
                  <CollapsedRuleRows
                    rows={ruleRows({ ...key, role: key.role }, organization)}
                  />
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell style={dimStyle(key)}>
                <CollapsedRuleRows
                  rows={projectRuleRows(
                    key.projectRoles ?? [],
                    getProjectById,
                    organization,
                  )}
                />
              </TableCell>
              <TableCell style={{ whiteSpace: "nowrap", ...dimStyle(key) }}>
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
                    <span>
                      <Text color="text-low">Unknown</Text>
                    </span>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell style={{ whiteSpace: "nowrap", ...dimStyle(key) }}>
                <ExpiresCell
                  expiresAt={key.expiresAt}
                  maxLifetimeDays={
                    key.userId
                      ? settings?.maxPatLifetimeDays
                      : settings?.maxApiKeyLifetimeDays
                  }
                />
              </TableCell>
              {canDeleteKeys && (
                <TableCell>
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
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
    </>
  );
};

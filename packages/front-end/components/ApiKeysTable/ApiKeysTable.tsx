import React, { FC, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiClockCountdown, PiIdentificationCard, PiInfo } from "react-icons/pi";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  actsAsUser,
  canManageApiKeySecret,
  canSetApiKeyDisabled,
} from "shared/permissions";
import { ago, datetime, datetimeWithZone } from "shared/dates";
import { getExpirationStatus, isExpired } from "shared/api-key-expiration";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import {
  RotateApiKeyModal,
  RotatedApiKey,
  RotatedApiKeyModal,
} from "@/components/ApiKeysTable/RotateApiKeyModal";
import CopyableCode from "@/components/Settings/CopyableCode";
import HumanInTheLoopIcon from "@/components/Confirmations/HumanInTheLoopIcon";
import ApiKeyRowMenu from "@/components/ApiKeysTable/ApiKeyRowMenu";
import ExpiresCell from "@/components/ApiKeysTable/ExpiresCell";
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
  canDeleteKeys: boolean;
  onReveal: (keyId: string | undefined) => () => Promise<string>;
  onToggleDisabled?: (
    keyId: string | undefined,
    disabled: boolean,
  ) => () => Promise<void>;
  onEdit?: (key: ApiKeyInterface) => void;
  onShowAuditLog?: (key: ApiKeyInterface) => void;
  onCopy?: (key: ApiKeyInterface) => void;
  onRotate?: (
    keyId: string,
    gracePeriodHours: number,
  ) => Promise<RotatedApiKey>;
  onRevokePrevious?: (keyId: string) => Promise<void>;
};

const canRotate = (key: ApiKeyInterface) =>
  !!key.id && !!key.secret && !isExpired(key.expiresAt);

const hasActivePreviousKey = (key: ApiKeyInterface) =>
  !!key.previousKeyExpiresAt && !isExpired(key.previousKeyExpiresAt);

export const ApiKeysTable: FC<ApiKeysTableProps> = ({
  keys = [],
  onDelete,
  canDeleteKeys,
  onReveal,
  onToggleDisabled,
  onEdit,
  onShowAuditLog,
  onCopy,
  onRotate,
  onRevokePrevious,
}) => {
  const { organization, userId, users, settings } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getProjectById } = useDefinitions();
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );
  const [rotating, setRotating] = useState<ApiKeyInterface | null>(null);
  const [rotated, setRotated] = useState<RotatedApiKey | null>(null);
  const isDisabledByAdmin = (key: ApiKeyInterface) =>
    !!key.userId &&
    !!key.disabled &&
    !!key.disabledBy &&
    key.disabledBy !== userId;
  const canToggle = (key: ApiKeyInterface) =>
    canSetApiKeyDisabled(permissionsUtil, key, userId || "", !key.disabled);
  const canManageSecret = (key: ApiKeyInterface) =>
    canManageApiKeySecret(permissionsUtil, key, userId || "");
  const maxLifetimeDays = (key: ApiKeyInterface) =>
    key.userId ? settings?.maxPatLifetimeDays : settings?.maxApiKeyLifetimeDays;
  // A PAT the owner can't toggle keeps a locked toggle that explains why; org keys hide it.
  const isAdminLocked = (key: ApiKeyInterface) =>
    !!key.userId && !canToggle(key);
  const hasActions =
    canDeleteKeys ||
    !!(onEdit || onToggleDisabled || onCopy || onShowAuditLog || onRotate);
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
        <Flex justify="end" mb="2">
          <Switch
            size="sm"
            label={`Show expired keys (${expiredCount})`}
            value={showExpired}
            onChange={setShowExpired}
          />
        </Flex>
      )}
      <Table variant="surface" layout="fixed" minTableWidth={950} mb="3">
        <TableHeader>
          <TableRow style={{ whiteSpace: "nowrap" }}>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader width="170px">Key</TableColumnHeader>
            <TableColumnHeader width="110px">
              Internal ID{" "}
              <Tooltip content="Identifies this key in logs and server settings. REST requests authenticate with the secret key, not this ID.">
                <Box
                  as="span"
                  display="inline-block"
                  tabIndex={0}
                  aria-label="More information about Internal ID"
                >
                  <PiInfo />
                </Box>
              </Tooltip>
            </TableColumnHeader>
            <TableColumnHeader>Role</TableColumnHeader>
            <TableColumnHeader>Project Roles</TableColumnHeader>
            <TableColumnHeader width="120px">Last Used</TableColumnHeader>
            <SortableTableColumnHeader
              field="expiresAtSort"
              style={{ width: 150 }}
            >
              Expires
            </SortableTableColumnHeader>
            {hasActions && <TableColumnHeader width="40px" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {!visibleKeys.length && (
            <TableRow>
              <TableCell
                colSpan={hasActions ? 8 : 7}
                style={{ textAlign: "center" }}
              >
                <Text color="text-low">All of these keys have expired.</Text>
              </TableCell>
            </TableRow>
          )}
          {sortedKeys.map(({ key }) => (
            <TableRow key={key.id}>
              <TableCell style={dimStyle(key)}>
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
                {!key.userId && actsAsUser(key) && (
                  <KeyTrait
                    icon={<PiIdentificationCard size={18} />}
                    color="var(--brown-10)"
                    tooltip="Every request must name a member with X-GrowthBook-Requested-By. The key acts as that member."
                  >
                    Acts as user
                  </KeyTrait>
                )}
                {key.confirmRules && (
                  <KeyTrait
                    icon={<HumanInTheLoopIcon size={18} />}
                    color="var(--violet-11)"
                    tooltip="Risky actions made with this key wait for a person to confirm them."
                  >
                    Human-in-the-Loop
                  </KeyTrait>
                )}
                {hasActivePreviousKey(key) && (
                  <KeyTrait
                    icon={<PiClockCountdown size={18} />}
                    color="var(--amber-11)"
                    tooltip={`The previous secret works until ${datetimeWithZone(key.previousKeyExpiresAt as Date)}. ${
                      key.previousKeyLastUsed
                        ? `Last used ${datetimeWithZone(key.previousKeyLastUsed)}.`
                        : "Not used since the rotation."
                    }`}
                  >
                    Previous secret active
                  </KeyTrait>
                )}
              </TableCell>
              <TableCell style={dimStyle(key)}>
                {canManageSecret(key) ? (
                  <ClickToReveal
                    // Remounts on rotation so a revealed secret isn't the old one.
                    key={String(key.keyIssuedAt)}
                    valueWhenHidden="secret_abcdefghijkl"
                    getValue={onReveal(key.id)}
                  />
                ) : (
                  <Tooltip content="Revealing a key's value requires permission to create API keys.">
                    <span>
                      <Text color="text-low">Hidden</Text>
                    </span>
                  </Tooltip>
                )}
              </TableCell>
              <TableCell style={dimStyle(key)}>
                {key.id ? <CopyableCode value={key.id} muted /> : "-"}
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
              <TableCell style={dimStyle(key)}>
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
              <TableCell style={dimStyle(key)}>
                <ExpiresCell
                  expiresAt={key.expiresAt}
                  maxLifetimeDays={maxLifetimeDays(key)}
                />
              </TableCell>
              {hasActions && (
                <TableCell>
                  <ApiKeyRowMenu
                    apiKey={key}
                    canDeleteKeys={canDeleteKeys}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onToggleClick={
                      onToggleDisabled && (canToggle(key) || isAdminLocked(key))
                        ? setPendingToggle
                        : undefined
                    }
                    toggleLockedReason={
                      isAdminLocked(key) ? ADMIN_LOCKED_REASON : undefined
                    }
                    onShowAuditLog={onShowAuditLog}
                    onCopy={onCopy}
                    onRotate={
                      onRotate && canRotate(key) && canManageSecret(key)
                        ? setRotating
                        : undefined
                    }
                    onRevokePrevious={
                      onRevokePrevious &&
                      hasActivePreviousKey(key) &&
                      canManageSecret(key)
                        ? () => onRevokePrevious(key.id as string)
                        : undefined
                    }
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
      {rotating && onRotate && (
        <RotateApiKeyModal
          apiKey={rotating}
          maxLifetimeDays={maxLifetimeDays(rotating)}
          onRotate={async (gracePeriodHours) =>
            setRotated(await onRotate(rotating.id as string, gracePeriodHours))
          }
          close={() => setRotating(null)}
        />
      )}
      {rotated && (
        <RotatedApiKeyModal rotated={rotated} close={() => setRotated(null)} />
      )}
    </>
  );
};

function KeyTrait({
  icon,
  color,
  tooltip,
  children,
}: {
  icon: ReactNode;
  color: string;
  tooltip: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <Flex align="start" gap="1" mt="1" width="fit-content" style={{ color }}>
        {/* One text line tall, so the icon sits on the first row. */}
        <Flex flexShrink="0" align="center" height="16px">
          {icon}
        </Flex>
        <Text size="sm">{children}</Text>
      </Flex>
    </Tooltip>
  );
}

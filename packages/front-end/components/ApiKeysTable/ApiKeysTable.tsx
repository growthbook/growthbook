import React, { FC, useState } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { requesterExtension } from "shared/permissions";
import { ago, datetime } from "shared/dates";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import ApiKeyRowMenu from "@/components/ApiKeysTable/ApiKeyRowMenu";
import {
  ExtendsWithRequesterIcon,
  RequiresRequesterIcon,
} from "@/components/Settings/RequesterIcons";
import {
  CollapsedRuleRows,
  projectRuleRows,
  ruleRows,
} from "@/components/Settings/Team/RoleRuleLabel";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

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
  const { getProjectById } = useDefinitions();
  // A key that extends with all of its requester's permissions lists that
  // after its own rules.
  const keyRoleRows = (key: ApiKeyInterface, role: string) => {
    const rows = ruleRows({ ...key, role }, organization);
    if (requesterExtension(key) !== "all") return rows;
    return [
      ...rows,
      {
        key: "requester",
        node: (
          <>
            <ExtendsWithRequesterIcon />
            Member&apos;s permissions
          </>
        ),
      },
    ];
  };
  const [pendingToggle, setPendingToggle] = useState<ApiKeyInterface | null>(
    null,
  );

  return (
    <>
      <Table variant="surface" layout="fixed" mb="3">
        <TableHeader>
          <TableRow>
            <TableColumnHeader width="16%">Description</TableColumnHeader>
            <TableColumnHeader width="24%">Key</TableColumnHeader>
            <TableColumnHeader width="20%">Role</TableColumnHeader>
            <TableColumnHeader width="20%">Project Roles</TableColumnHeader>
            <TableColumnHeader width="150px">Last Used</TableColumnHeader>
            {canDeleteKeys && <TableColumnHeader width="4%" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow
              key={key.id}
              style={key.disabled ? { opacity: 0.55 } : undefined}
            >
              <TableCell>
                {key.requireRequestedBy && <RequiresRequesterIcon />}
                {key.description}
                {key.disabled && (
                  <Badge ml="2" color="red" variant="soft" label="Disabled" />
                )}
              </TableCell>
              <TableCell>
                {canCreateKeys ? (
                  <ClickToReveal
                    valueWhenHidden="secret_abcdefghijklmnop123"
                    getValue={onReveal(key.id)}
                  />
                ) : (
                  <em>hidden</em>
                )}
              </TableCell>
              <TableCell>
                {key.role ? (
                  <CollapsedRuleRows rows={keyRoleRows(key, key.role)} />
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell>
                <CollapsedRuleRows
                  rows={projectRuleRows(
                    key.projectRoles ?? [],
                    getProjectById,
                    organization,
                  )}
                />
              </TableCell>
              <TableCell style={{ whiteSpace: "nowrap" }}>
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
                    onShowAuditLog={onShowAuditLog}
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

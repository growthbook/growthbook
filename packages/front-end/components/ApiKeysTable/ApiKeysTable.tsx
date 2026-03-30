import React, { FC } from "react";
import { ApiKeyInterface } from "shared/types/apikey";
import { getRoleDisplayName } from "shared/permissions";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useUser } from "@/services/UserContext";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

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
  return (
    <Table variant="list" stickyHeader roundedCorners className="mb-3">
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: 150 }}>
            Description
          </TableColumnHeader>
          <TableColumnHeader>Key</TableColumnHeader>
          <TableColumnHeader>Role</TableColumnHeader>
          {canDeleteKeys ? <TableColumnHeader style={{ width: 30 }} /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key) => (
          <TableRow key={key.id}>
            <TableCell>{key.description}</TableCell>
            <TableCell style={{ minWidth: 295 }}>
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
              {key.role ? getRoleDisplayName(key.role, organization) : "-"}
            </TableCell>
            {canDeleteKeys ? (
              <TableCell
                style={{ cursor: "initial" }}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreMenu>
                  <DeleteButton
                    onClick={onDelete(key.id)}
                    className="dropdown-item"
                    displayName="API Key"
                    text="Delete key"
                  />
                </MoreMenu>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

import React, { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import {
  Table,
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
  return (
    <Table variant="standard" className="mb-3 appbox">
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: 150 }}>Description</TableColumnHeader>
          <TableColumnHeader>Key</TableColumnHeader>
          <TableColumnHeader>Role</TableColumnHeader>
          {canDeleteKeys && <TableColumnHeader style={{ width: 30 }}></TableColumnHeader>}
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
            <TableCell>{key.role || "-"}</TableCell>
            {canDeleteKeys && (
              <TableCell>
                <MoreMenu>
                  <DeleteButton
                    onClick={onDelete(key.id)}
                    className="dropdown-item"
                    displayName="API Key"
                    text="Delete key"
                  />
                </MoreMenu>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

import React, { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import ClickToReveal from "@front-end/components/Settings/ClickToReveal";
import MoreMenu from "@front-end/components/Dropdown/MoreMenu";
import DeleteButton from "@front-end/components/DeleteButton/DeleteButton";

type ApiKeysTableProps = {
  onDelete: (keyId: string | undefined) => () => Promise<void>;
  keys: ApiKeyInterface[];
  canManageKeys: boolean;
  onReveal: (keyId: string | undefined) => () => Promise<string>;
};

export const ApiKeysTable: FC<ApiKeysTableProps> = ({
  keys = [],
  onDelete,
  canManageKeys,
  onReveal,
}) => {
  return (
    <table className="table mb-3 appbox gbtable">
      <thead>
        <tr>
          <th style={{ width: 150 }}>Description</th>
          <th>Key</th>
          <th>Role</th>
          {canManageKeys && <th style={{ width: 30 }}></th>}
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>{key.description}</td>
            <td style={{ minWidth: 295 }}>
              {canManageKeys ? (
                <ClickToReveal
                  valueWhenHidden="secret_abcdefghijklmnop123"
                  getValue={onReveal(key.id)}
                />
              ) : (
                <em>hidden</em>
              )}
            </td>
            <td>{key.role || "-"}</td>
            {canManageKeys && (
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
  );
};

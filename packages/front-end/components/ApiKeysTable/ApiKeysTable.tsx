import React, { FC } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import ClickToReveal from "@/components/Settings/ClickToReveal";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";

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
    <table className="table mb-3 appbox gbtable">
      <thead>
        <tr>
          <th style={{ width: 150 }}>描述</th>
          <th>密钥</th>
          <th>角色</th>
          {canDeleteKeys && <th style={{ width: 30 }}></th>}
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>{key.description}</td>
            <td style={{ minWidth: 295 }}>
              {canCreateKeys ? (
                <ClickToReveal
                  valueWhenHidden="love and peace"
                  getValue={onReveal(key.id)}
                />
              ) : (
                <em>Hide</em>
              )}
            </td>
            <td>{key.role || "-"}</td>
            {canDeleteKeys && (
              <td>
                <MoreMenu>
                  <DeleteButton
                    onClick={onDelete(key.id)}
                    className="dropdown-item"
                    displayName="API密钥"
                    text="删除密钥"
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

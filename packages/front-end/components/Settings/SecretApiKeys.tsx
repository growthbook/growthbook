import { FC, useState } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton/DeleteButton";
import { useAuth } from "../../services/auth";
import { FaKey } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";
import MoreMenu from "../Dropdown/MoreMenu";
import usePermissions from "../../hooks/usePermissions";
import ClickToRevealKey from "./ClickToRevealKey";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

  const permissions = usePermissions();

  const canManageKeys = permissions.manageApiKeys;

  const secretKeys = keys.filter((k) => k.secret);

  return (
    <div className="mb-5">
      {open && canManageKeys && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          secret={true}
        />
      )}
      <h1>Secret API Keys</h1>
      <p>
        Secret keys have full read and write access to your account. Because of
        this, they must be kept secure and{" "}
        <strong>must not be exposed to users</strong>.
      </p>
      {secretKeys.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Description</th>
              <th>Key</th>
              {canManageKeys && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {secretKeys.map((key) => (
              <tr key={key.id}>
                <td>{key.description}</td>
                <td>
                  {canManageKeys ? (
                    <ClickToRevealKey keyId={key.id} />
                  ) : (
                    <em>hidden</em>
                  )}
                </td>
                {canManageKeys && (
                  <td>
                    <MoreMenu id={key.key + "_actions"}>
                      <DeleteButton
                        onClick={async () => {
                          await apiCall(`/keys`, {
                            method: "DELETE",
                            body: JSON.stringify({
                              id: key.id,
                            }),
                          });
                          mutate();
                        }}
                        className="dropdown-item"
                        displayName="Secret Api Key"
                        text="Delete key"
                      />
                    </MoreMenu>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManageKeys && (
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <FaKey /> Create New Secret Key
        </button>
      )}
    </div>
  );
};

export default SecretApiKeys;

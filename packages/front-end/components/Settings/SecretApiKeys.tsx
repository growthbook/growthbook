import { FC, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import { FaKey } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "../DeleteButton/DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import ApiKeysModal from "./ApiKeysModal";
import ClickToReveal from "./ClickToReveal";

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
                <td style={{ minWidth: 295 }}>
                  {canManageKeys ? (
                    <ClickToReveal
                      valueWhenHidden="secret_abcdefghijklmnop123"
                      getValue={async () => {
                        const res = await apiCall<{ key: SecretApiKey }>(
                          `/keys/reveal`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              id: key.id,
                            }),
                          }
                        );
                        if (!res.key.key) {
                          throw new Error("Could not load the secret key");
                        }
                        return res.key.key;
                      }}
                    />
                  ) : (
                    <em>hidden</em>
                  )}
                </td>
                {canManageKeys && (
                  <td>
                    <MoreMenu>
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

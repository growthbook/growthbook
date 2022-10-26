import { FC, useState } from "react";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaEye, FaEyeSlash, FaKey } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";
import MoreMenu from "../Dropdown/MoreMenu";
import usePermissions from "../../hooks/usePermissions";
import Tooltip from "../Tooltip";
import { RevealedPrivateKey } from "../Features/SDKEndpoints";

const SecretApiKeys: FC<{ keys: ApiKeyInterface[]; mutate: () => void }> = ({
  keys,
  mutate,
}) => {
  const [
    revealedPrivateKey,
    setRevealedPrivateKey,
  ] = useState<RevealedPrivateKey | null>({});
  const [currentCopiedString, setCurrentCopiedString] = useState("");
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
              <th>Description</th>
              <th>Key</th>
              {canManageKeys && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {secretKeys.map((key) => {
              const hidden = !revealedPrivateKey || !revealedPrivateKey[key.id];
              return (
                <tr key={key.id}>
                  <td>{key.description}</td>
                  <td>
                    {canManageKeys && (
                      <div className="d-flex flex-row align-items-center justify-content-start">
                        <span
                          role="button"
                          onClick={async () => {
                            if (hidden) {
                              const res = await apiCall<{ key: SecretApiKey }>(
                                `/keys/reveal`,
                                {
                                  method: "POST",
                                  body: JSON.stringify({
                                    id: key.id,
                                  }),
                                }
                              );
                              if (!res.key?.key) {
                                throw new Error(
                                  "Could not load secret key value"
                                );
                              }
                              setRevealedPrivateKey({
                                [key.id]: res.key.key,
                              });
                            } else {
                              setRevealedPrivateKey(null);
                            }
                          }}
                        >
                          {hidden ? <FaEyeSlash /> : <FaEye />}
                        </span>
                        <Tooltip
                          role="button"
                          tipMinWidth="45px"
                          tipPosition="top"
                          body={
                            hidden
                              ? "Click the eye to reveal"
                              : currentCopiedString === key.id
                              ? "Copied!"
                              : "Copy"
                          }
                          style={{ paddingLeft: "5px" }}
                          onClick={(e) => {
                            e.preventDefault();
                            if (!hidden) {
                              navigator.clipboard
                                .writeText(revealedPrivateKey[key.id])
                                .then(() => {
                                  setCurrentCopiedString(key.id);
                                })
                                .catch((e) => {
                                  console.error(e);
                                });
                            }
                          }}
                        >
                          <input
                            role="button"
                            type={hidden ? "password" : "text"}
                            value={
                              hidden
                                ? "key is hidden"
                                : revealedPrivateKey[key.id]
                            }
                            disabled={true}
                            style={{
                              border: "none",
                              outline: "none",
                              backgroundColor: "#fff",
                            }}
                          />
                        </Tooltip>
                      </div>
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
              );
            })}
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

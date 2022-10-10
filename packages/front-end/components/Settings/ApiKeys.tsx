import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface, SecretApiKey } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaKey } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";
import Link from "next/link";
import { DocLink } from "../DocLink";
import CopyToClipboard from "../CopyToClipboard";
import MoreMenu from "../Dropdown/MoreMenu";
import ClickToReveal from "./ClickToReveal";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<"" | "secret" | "publishable">("");

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const publishableKeys = data.keys.filter((k) => !k.secret);
  const secretKeys = data.keys.filter((k) => k.secret);

  const envCounts = new Map();
  publishableKeys.forEach((k) => {
    if (k.environment) {
      envCounts.set(
        k.environment,
        envCounts.has(k.environment) ? envCounts.get(k.environment) + 1 : 1
      );
    }
  });

  return (
    <div>
      {open && (
        <ApiKeysModal
          close={() => setOpen("")}
          onCreate={mutate}
          secret={open === "secret"}
        />
      )}
      <p>
        Use API keys to fetch feature definitions for our SDKs and interact with
        our REST API. <DocLink docSection="api">View Documentation</DocLink>
      </p>
      <div className="mb-5">
        <div className="row align-items-center mb-2">
          <div className="col">
            <h2>Publishable API Keys</h2>
          </div>
          <div className="col-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setOpen("publishable");
              }}
            >
              <FaKey /> Create New Publishable Key
            </button>
          </div>
        </div>
        <p>
          Publishable keys have extremely restricted readonly access to your
          account and can be safely exposed to users (e.g. in your HTML source
          code).
        </p>
        <p>
          Publishable keys are scoped to a specific environment.{" "}
          <Link href={`/environments`}>
            <a>Manage environments</a>
          </Link>
        </p>

        {publishableKeys.length > 0 && (
          <table className="table mb-3 appbox gbtable">
            <thead>
              <tr>
                <th>Description</th>
                <th>Key</th>
                <th>Environment</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {publishableKeys.map((key) => (
                <tr key={key.key}>
                  <td>{key.description}</td>
                  <td>
                    <CopyToClipboard text={key.key} />
                  </td>
                  <td>
                    <Link href={`/environments`}>
                      <a>{key.environment ?? "production"}</a>
                    </Link>
                  </td>
                  <td>
                    <MoreMenu id={key.key + "_actions"}>
                      <DeleteButton
                        onClick={async () => {
                          await apiCall(`/keys`, {
                            method: "DELETE",
                            body: JSON.stringify({
                              id: key.id || "",
                              key: key.key,
                            }),
                          });
                          mutate();
                        }}
                        className="dropdown-item"
                        displayName="Publishable Api Key"
                        text="Delete key"
                      />
                    </MoreMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mb-3">
        <div className="row mb-2 align-items-center">
          <div className="col">
            <h2>Secret API Keys</h2>
          </div>
          <div className="col-auto">
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.preventDefault();
                setOpen("secret");
              }}
            >
              <FaKey /> Create New Secret Key
            </button>
          </div>
        </div>
        <p>
          Secret keys have full read and write access to your account. Because
          of this, they must be kept secure and{" "}
          <strong>must not be exposed to users</strong>.
        </p>

        {secretKeys.length > 0 && (
          <table className="table mb-3 appbox gbtable">
            <thead>
              <tr>
                <th>Description</th>
                <th>Key</th>
                <th style={{ width: 30 }}></th>
              </tr>
            </thead>
            <tbody>
              {secretKeys.map((key) => (
                <tr key={key.id}>
                  <td>{key.description}</td>
                  <td>
                    <ClickToReveal
                      valueWhenHidden="Reveal key"
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
                        if (!res.key?.key) {
                          throw new Error("Could not load secret key value");
                        }
                        return res.key.key;
                      }}
                    >
                      {(value) => <CopyToClipboard text={value} />}
                    </ClickToReveal>
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ApiKeys;

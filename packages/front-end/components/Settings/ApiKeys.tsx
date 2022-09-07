import { FC, useMemo, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaKey } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";
import Link from "next/link";
import { DocLink } from "../DocLink";
import track from "../../services/track";
import Tooltip from "../Tooltip";

export const apiAuthEnv = "access";

const ApiKeys: FC = () => {
  const { data, error: keyError, mutate } = useApi<{ keys: ApiKeyInterface[] }>(
    "/keys"
  );
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

  const hasPublicKey = useMemo(() => {
    return !!data?.keys.find((k) => k.environment === apiAuthEnv);
  }, [data]);

  if (keyError) {
    return <div className="alert alert-danger">{keyError.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const envCounts = new Map();
  data.keys.forEach((k) => {
    if (k.environment) {
      envCounts.set(
        k.environment,
        envCounts.has(k.environment) ? envCounts.get(k.environment) + 1 : 1
      );
    }
  });

  async function handleCreatePublicApiKey() {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify({
        environment: apiAuthEnv,
        description: "access_token for APIs that require authentication",
      }),
    });
    track("Create Public API Key", {});
    mutate();
  }

  return (
    <div>
      {open && <ApiKeysModal close={() => setOpen(false)} onCreate={mutate} />}
      <p>
        API keys can be used with our SDKs (Javascript, React, Go, Ruby, PHP,
        Python, Android) or the Visual Editor.{" "}
        <DocLink docSection="api">View Documentation</DocLink>
      </p>

      {data.keys.length > 0 && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Key</th>
              <th>Environment</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.key}>
                <td>{key.key}</td>
                <td>
                  <Link href={`/settings/environments`}>
                    <a>{key.environment ?? "production"}</a>
                  </Link>
                </td>
                <td>{key.description}</td>
                <td>
                  <div className="tr-hover actions">
                    <DeleteButton
                      onClick={async () => {
                        await apiCall(`/key/${encodeURIComponent(key.key)}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                      displayName="Api Key"
                      style={{ fontSize: "19px" }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <FaKey /> Create New Key
      </button>

      <Tooltip body="Access Tokens are limited to one per organization and are used for API requests that require authentication">
        {/* buttons do not work when wrapped in a span so this is a div */}
        <div
          className={`btn btn-primary ml-3 ${hasPublicKey ? "disabled" : ""}`}
          // disabled={hasPublicKey}
          onClick={(e) => {
            if (hasPublicKey) return;
            e.preventDefault();
            handleCreatePublicApiKey();
          }}
        >
          <FaKey /> Create Access Token
        </div>
      </Tooltip>
      <Link href={`/settings/environments`}>
        <a className="btn btn-outline-primary ml-3">Manage environments</a>
      </Link>
    </div>
  );
};

export default ApiKeys;

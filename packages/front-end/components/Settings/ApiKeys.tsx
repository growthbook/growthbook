import { FC, useState } from "react";
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
import CopyToClipboard from "../CopyToClipboard";

const ApiKeys: FC = () => {
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [showAccessToken, setShowAccessToken] = useState(false);

  const { data, error: keyError, mutate } = useApi<{ keys: ApiKeyInterface[] }>(
    "/keys"
  );
  const {
    data: hasAccessTokenData,
    error: hasAccessTokenError,
    mutate: hasAccessTokenMutate,
  } = useApi<{ hasAccessToken: boolean }>(`/has-access-token`);

  if (hasAccessTokenError) {
    return (
      <div className="alert alert-danger">{hasAccessTokenError.message}</div>
    );
  }
  if (keyError) {
    return <div className="alert alert-danger">{keyError.message}</div>;
  }
  if (!data || !hasAccessTokenData) {
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

  async function handleCreateAccessToken() {
    await apiCall("/access-token", { method: "POST" });
    track("Create access_token", {});
    hasAccessTokenMutate();
  }

  async function handleShowAccessToken() {
    const { accessToken } = await apiCall<{ accessToken: string }>(
      "/access-token",
      { method: "GET" }
    );
    setAccessToken(accessToken);
    setShowAccessToken(!showAccessToken);
  }

  return (
    <div>
      {open && <ApiKeysModal close={() => setOpen(false)} onCreate={mutate} />}
      <h1>Access Token</h1>
      <p>
        The access_token is used to make CRUD operations on behalf of your
        organization. You can authenticate certain API requests using your
        access_token.{" "}
        <DocLink docSection="api_authentication">View Documentation</DocLink>
      </p>
      {hasAccessTokenData.hasAccessToken && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>
                Key{" "}
                <a
                  className="cursor-pointer"
                  onClick={() => handleShowAccessToken()}
                >
                  (show key)
                </a>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="flex">
                {showAccessToken ? (
                  <CopyToClipboard text={accessToken} />
                ) : (
                  "*********"
                )}
              </td>
              <td>
                <DeleteButton
                  onClick={async () => {
                    await apiCall("/access-token", { method: "DELETE" });
                    setAccessToken("");
                    setShowAccessToken(false);
                    hasAccessTokenMutate();
                  }}
                  displayName="Access Token"
                  style={{ fontSize: "19px" }}
                />
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <Tooltip body="Access Tokens are limited to one per organization and are used for API requests that require authentication">
        {/* buttons do not work when wrapped in a span so this must be a div */}
        <div
          className={`btn btn-primary cursor-pointer ${
            hasAccessTokenData.hasAccessToken ? "disabled" : ""
          }`}
          onClick={(e) => {
            if (hasAccessTokenData.hasAccessToken) return;
            e.preventDefault();
            handleCreateAccessToken();
          }}
        >
          <FaKey /> Create Access Token
        </div>
      </Tooltip>

      <h1 className="mt-4">API Keys</h1>
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
                        await apiCall(`/key/${key.key}`, {
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
      <Link href={`/settings/environments`}>
        <a className="btn btn-outline-primary ml-3">Manage environments</a>
      </Link>
    </div>
  );
};

export default ApiKeys;

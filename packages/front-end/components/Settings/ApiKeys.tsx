import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaExclamationTriangle, FaKey, FaPencilAlt } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";
import Link from "next/link";
import { useEnvironments } from "../../services/features";
import Tooltip from "../Tooltip";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<boolean | ApiKeyInterface>(false);

  const environments = useEnvironments();
  const environmentIds = environments.map((e) => e.id);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
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

  function canDelete(env: string) {
    if (!env) return true;
    if (!environmentIds.includes(env)) return true;
    if (envCounts.get(env) > 1) return true;
    return false;
  }

  return (
    <div>
      {open && (
        <ApiKeysModal
          close={() => setOpen(false)}
          onCreate={mutate}
          existing={open !== true ? open : undefined}
        />
      )}
      <p>
        API keys can be used with our SDKs (Javascript, React, Go, Ruby, PHP,
        Python, Android) or the Visual Editor.{" "}
        <a
          href="https://docs.growthbook.io/app/api"
          target="_blank"
          rel="noreferrer"
        >
          View Documentation
        </a>
      </p>

      {data.keys.length > 0 && (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Key</th>
              <th>Environment</th>
              <th>Description</th>
              <th>
                Includes Drafts{" "}
                <Tooltip text="Includes unpublished feature changes. Useful for dev API keys" />
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.key}>
                <td>{key.key}</td>
                <td>
                  {key.environment ?? "production"}
                  {key.environment &&
                    !environmentIds.includes(key.environment) && (
                      <Tooltip text="This environment no longer exists. It is safe to delete this API key.">
                        <FaExclamationTriangle className="text-danger ml-2" />
                      </Tooltip>
                    )}
                </td>
                <td>{key.description}</td>
                <td>{key.includeDrafts ? "yes" : "no"}</td>
                <td>
                  <button
                    className="btn btn-outline-primary mr-2"
                    onClick={(e) => {
                      e.preventDefault();
                      setOpen(key);
                    }}
                    type="button"
                  >
                    <FaPencilAlt />
                  </button>
                  {canDelete(key.environment) && (
                    <DeleteButton
                      onClick={async () => {
                        await apiCall(`/key/${key.key}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                      displayName="Api Key"
                    />
                  )}
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

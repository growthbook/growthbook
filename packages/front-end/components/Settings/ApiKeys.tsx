import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaKey } from "react-icons/fa";
import ApiKeysModal from "./ApiKeysModal";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {open && <ApiKeysModal close={() => setOpen(false)} onCreate={mutate} />}
      <p>
        API keys can be used with our SDKs (Javascript, React, PHP, Ruby, Go,
        Kotlin, or Python) or the Visual Editor.{" "}
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.key}>
                <td>{key.key}</td>
                <td>{key.environment ?? "dev, production"}</td>
                <td>{key.description}</td>
                <td>
                  <DeleteButton
                    onClick={async () => {
                      await apiCall(`/key/${key.key}`, { method: "DELETE" });
                      mutate();
                    }}
                    displayName="Api Key"
                    className="tr-hover"
                  />
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
    </div>
  );
};

export default ApiKeys;

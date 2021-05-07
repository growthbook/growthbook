import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { ApiKeyInterface } from "back-end/types/apikey";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import { FaKey } from "react-icons/fa";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";

const ApiKeys: FC = () => {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>("/keys");
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);
  const [value, inputProps] = useForm({
    description: "",
  });

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const onSubmit = async () => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
  };

  return (
    <div>
      {open && (
        <Modal
          close={() => setOpen(false)}
          header="Create New Key"
          open={true}
          submit={onSubmit}
          cta="Create"
        >
          <div className="form-group">
            <label>Description (optional)</label>
            <textarea {...inputProps.description} className="form-control" />
          </div>
        </Modal>
      )}

      <p>
        API keys can be used with our SDKs (Javascript, PHP, Ruby) or a custom
        implementation.{" "}
        <a
          href="https://docs.growthbook.io/api"
          target="_blank"
          rel="noreferrer"
        >
          View Documentation
        </a>
      </p>

      {data.keys.length > 0 && (
        <table className="table mb-3">
          <thead>
            <tr>
              <th>Key</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map((key) => (
              <tr key={key.key}>
                <td>{key.key}</td>
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
        className="btn btn-success"
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

import Link from "next/link";
import React, { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import EnvironmentModal from "../../components/Settings/EnvironmentModal";
import { useAuth } from "../../services/auth";
import { Environment } from "back-end/types/organization";
import useApi from "../../hooks/useApi";
import { ApiKeyInterface } from "back-end/types/apikey";
import LoadingOverlay from "../../components/LoadingOverlay";
import { GBAddCircle } from "../../components/Icons";
import ValueDisplay from "../../components/Features/ValueDisplay";

export type EnvironmentApiResponse = {
  status: number;
  apiKeys: ApiKeyInterface[];
  environments: Environment[];
};

const EnvironmentsPage: FC = () => {
  const { data, error, mutate } = useApi<EnvironmentApiResponse>(
    `/environments`
  );

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<Environment> | null>(null);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const numKeys = new Map();
  data.apiKeys.forEach((k) => {
    if (k?.environment) {
      numKeys.set(
        k.environment,
        numKeys.has(k.environment) ? numKeys.get(k.environment) + 1 : 1
      );
    }
  });

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <EnvironmentModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => {
            console.log("mutate called");
            mutate();
          }}
        />
      )}
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Environments</h1>
      <p>Create and edit environments for feature flags and their rules.</p>
      {data.environments?.length > 0 ? (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Environment name</th>
              <th>Id</th>
              <th>Description</th>
              <th>Show toggle</th>
              <th>keys</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.environments.map((e) => {
              return (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>
                    <ValueDisplay
                      value={e.toggleOnList.toString()}
                      type={"boolean"}
                      full={false}
                    />
                  </td>
                  <td>{numKeys.has(e.id) ? numKeys.get(e.id) : 0}</td>
                  <td>
                    <button
                      className="btn btn-outline-primary tr-hover"
                      onClick={(ev) => {
                        ev.preventDefault();
                        setModalOpen(e);
                      }}
                    >
                      <FaPencilAlt />
                    </button>{" "}
                    <DeleteButton
                      deleteMessage="Are you you want to delete this environment? This action cannot be undone and will also delete the API keys for this environment."
                      displayName={`environment: ${e.name}`}
                      onClick={async () => {
                        await apiCall(`/environment/${e.id}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                      className="tr-hover"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p>Click the button below to an environment</p>
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen({});
        }}
      >
        <span className="h4 pr-2 m-0 d-inline-block">
          <GBAddCircle />
        </span>{" "}
        Create New Environment
      </button>
    </div>
  );
};
export default EnvironmentsPage;

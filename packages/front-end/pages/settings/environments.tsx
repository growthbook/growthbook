import Link from "next/link";
import React, { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaPencilAlt } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import EnvironmentModal from "../../components/Settings/EnvironmentModal";
import { useAuth } from "../../services/auth";
import { Environment } from "back-end/types/organization";
import { GBAddCircle } from "../../components/Icons";
import ValueDisplay from "../../components/Features/ValueDisplay";
import { useEnvironments } from "../../hooks/useEnvironments";
import useUser from "../../hooks/useUser";

const EnvironmentsPage: FC = () => {
  const environments = useEnvironments();
  const { update } = useUser();

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<Environment> | null>(null);

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <EnvironmentModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={update}
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
      {environments.length > 0 ? (
        <table className="table mb-3 appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Description</th>
              <th>Show toggle</th>
              <th style={{ width: 120 }}></th>
            </tr>
          </thead>
          <tbody>
            {environments.map((e) => {
              return (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.description}</td>
                  <td>
                    <ValueDisplay
                      value={e.toggleOnList.toString()}
                      type={"boolean"}
                      full={false}
                    />
                  </td>
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
                    {environments.length > 1 && (
                      <DeleteButton
                        deleteMessage="Are you you want to delete this environment?"
                        displayName={`environment: ${e.id}`}
                        onClick={async () => {
                          await apiCall(`/organization`, {
                            method: "PUT",
                            body: JSON.stringify({
                              settings: {
                                environments: environments.filter(
                                  (env) => env.id !== e.id
                                ),
                              },
                            }),
                          });
                          update();
                        }}
                        className="tr-hover"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p>Click the button below to add your first environment</p>
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
